import {
  DELETE,
  GET,
  HTTPMetadata,
  PATCH,
  POST,
  PUT,
  QUERY_METHOD,
} from '../decorators/http.decorator';
import { GROUP, GroupMetadata } from '../decorators/group.decorator';
import {
  BODY,
  PARAMS,
  QUERY,
  RequestMetadata,
} from '../decorators/request.decorator';
import { MiddlewareFn, USE, UseMetadata } from '../decorators/use.decorator';
import { PRIORITY, PriorityMetadata } from '../decorators/priority.decorator';
import { Endpoint } from '../templates/endpoint';
import {
  API_DESCRIPTION,
  API_HIDDEN,
  API_RESPONSES,
  API_SUMMARY,
  API_TAG,
  ApiDescriptionMetadata,
  ApiHiddenMetadata,
  ApiResponseEntry,
  ApiResponsesMetadata,
  ApiSummaryMetadata,
  ApiTagMetadata,
} from '../decorators/openapi.decorator';
import {
  DEPRECATED,
  DeprecatedMetadata,
} from '../decorators/deprecated.decorator';

export default class EndpointReader {
  /**
   * The URL prefix this endpoint hangs from: `@Group`, or the id of the module
   * that loaded it. Empty only for an endpoint read outside any module and
   * without the decorator, which mounts straight at the base path.
   */
  public group = '';
  /**
   * `@Group(name, { mount })`: where this group hangs from instead of the
   * application's prefix. `null` = the application's.
   */
  public mountAt: string | null = null;
  public pathname: string;
  public method: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'query';
  public priority: number | null = null;
  public ParamsSchema: new () => Record<string, any> = undefined;
  public BodySchema: new () => Record<string, any> = undefined;
  public QuerySchema: new () => Record<string, any> = undefined;
  public MiddlewareClass: MiddlewareFn = undefined;
  public apiTags: string[] = [];
  public apiSummary: string | null = null;
  public apiDescription: string | null = null;
  public apiResponses: ApiResponseEntry[] = [];
  /** `@ApiHidden`: mounted, but kept out of the OpenAPI spec. */
  public apiHidden = false;
  /** `@Deprecated`: answers as always, and says it is on its way out. */
  public deprecated: DeprecatedMetadata | null = null;

  /**
   * `@Group` wins; otherwise the module id, which is why the decorator is only
   * needed when the URL should not carry it.
   */
  private readGroup = (fallback?: string) => {
    const declared = Reflect.getMetadata(
      GROUP,
      this.EndpointClass,
    ) as GroupMetadata;
    if (declared) {
      this.group = declared.name;
      this.mountAt = declared.mountAt ?? null;
      return;
    }
    this.group = fallback ?? '';
  };

  private getHttp = () => {
    const MethodKeys: [typeof this.method, symbol][] = [
      ['get', GET],
      ['post', POST],
      ['put', PUT],
      ['delete', DELETE],
      ['patch', PATCH],
      ['query', QUERY_METHOD],
    ];
    for (const [method, KEY] of MethodKeys) {
      const metadata = Reflect.getMetadata(
        KEY,
        this.EndpointClass,
      ) as HTTPMetadata;
      if (metadata) {
        this.pathname = metadata.path;
        this.method = method;
        break;
      }
    }
  };

  private getPriority = () => {
    const priorityDefine = Reflect.getMetadata(
      PRIORITY,
      this.EndpointClass,
    ) as PriorityMetadata;
    if (priorityDefine) {
      this.priority = priorityDefine.number;
    }
  };

  private getUse = () => {
    const useDefine = Reflect.getMetadata(
      USE,
      this.EndpointClass,
    ) as UseMetadata;
    if (useDefine) {
      this.MiddlewareClass = useDefine.middleware;
    }
  };

  private getParams = () => {
    const paramsDefine = Reflect.getMetadata(
      PARAMS,
      this.EndpointClass,
    ) as RequestMetadata;
    if (paramsDefine) {
      this.ParamsSchema = paramsDefine.Schema;
    }
  };

  private getBody = () => {
    const bodyDefine = Reflect.getMetadata(
      BODY,
      this.EndpointClass,
    ) as RequestMetadata;
    if (bodyDefine) {
      this.BodySchema = bodyDefine.Schema;
    }
  };

  private getQuery = () => {
    const queryDefine = Reflect.getMetadata(
      QUERY,
      this.EndpointClass,
    ) as RequestMetadata;
    if (queryDefine) {
      this.QuerySchema = queryDefine.Schema;
    }
  };

  private getOpenApi = () => {
    const tagDefine = Reflect.getMetadata(
      API_TAG,
      this.EndpointClass,
    ) as ApiTagMetadata;
    if (tagDefine) {
      this.apiTags = tagDefine.tags;
    }
    const summaryDefine = Reflect.getMetadata(
      API_SUMMARY,
      this.EndpointClass,
    ) as ApiSummaryMetadata;
    if (summaryDefine) {
      this.apiSummary = summaryDefine.summary;
    }
    const descDefine = Reflect.getMetadata(
      API_DESCRIPTION,
      this.EndpointClass,
    ) as ApiDescriptionMetadata;
    if (descDefine) {
      this.apiDescription = descDefine.description;
    }
    const responsesDefine = Reflect.getMetadata(
      API_RESPONSES,
      this.EndpointClass,
    ) as ApiResponsesMetadata;
    if (responsesDefine) {
      this.apiResponses = responsesDefine.responses;
    }
    const hiddenDefine = Reflect.getMetadata(
      API_HIDDEN,
      this.EndpointClass,
    ) as ApiHiddenMetadata;
    if (hiddenDefine) {
      this.apiHidden = hiddenDefine.hidden;
    }
    this.deprecated =
      (Reflect.getMetadata(
        DEPRECATED,
        this.EndpointClass,
      ) as DeprecatedMetadata) ?? null;
  };

  /**
   * @param EndpointClass The decorated class.
   * @param defaultGroup Id of the module that loaded it, used as the prefix
   * when the class declares no `@Group`.
   */
  constructor(
    private EndpointClass: new () => Endpoint,
    defaultGroup?: string,
  ) {
    this.readGroup(defaultGroup);
    this.getHttp();
    this.getPriority();
    this.getUse();
    this.getParams();
    this.getBody();
    this.getQuery();
    this.getOpenApi();
  }

  /**
   * A class with no HTTP verb is a file being written, not a startup failure.
   *
   * The group is NOT checked: it used to be, and forgetting `@Module` dropped
   * the endpoint in silence — a clean boot answering 404 forever. Now there is
   * always a prefix to fall back to.
   */
  public isInvalid = (): boolean => {
    return !this.method;
  };

  public getEndpointClass = () => {
    return this.EndpointClass;
  };

  public hasMiddleware = () => {
    return !!this.MiddlewareClass;
  };

  public hasSchema = () => {
    return !!this.ParamsSchema || !!this.BodySchema || !!this.QuerySchema;
  };
}
