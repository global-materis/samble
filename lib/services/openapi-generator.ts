import { validationMetadatasToSchemas } from 'class-validator-jsonschema';
import path from 'path';
import slash from 'slash';
import EndpointReader from '../core/endpoint-reader';
import type { DeprecatedMetadata } from '../decorators/deprecated.decorator';

export interface OpenAPIInfo {
  title?: string;
  version?: string;
  description?: string;
}

interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: any;
  description?: string;
}

interface OpenAPIRequestBody {
  required: boolean;
  content: {
    'application/json': {
      schema: any;
    };
  };
}

interface OpenAPIResponse {
  description: string;
  content?: {
    'application/json': {
      schema: any;
    };
  };
}

interface OpenAPIOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
}

export interface OpenAPIDocument {
  openapi: '3.0.3';
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components: {
    schemas: Record<string, any>;
  };
  tags?: { name: string }[];
}

const REF_PREFIX = '#/components/schemas/';

/**
 * Express path params (`:foo`) -> OpenAPI path params (`{foo}`).
 */
function expressToOpenApiPath(p: string): string {
  return p.replace(/:([A-Za-z_][\w]*)/g, '{$1}');
}

/**
 * Compose the full path from basePath + module name + endpoint pathname,
 * normalising slashes.
 */
function fullPath(basePath: string, group: string, pathname: string): string {
  const joined = slash(path.join('/', basePath, group, pathname || ''));
  return expressToOpenApiPath(joined);
}

/**
 * Folds a deprecation into the operation's description.
 *
 * `deprecated: true` alone tells a reader that the route is going and nothing
 * else — not when, not where to. Those two answers are what makes the flag
 * actionable, and the description is the only field in the operation that can
 * carry them.
 *
 * It goes FIRST, before whatever `@ApiDescription` says: a reader who stops at
 * the first line has read the part that changes what they do.
 */
function describeDeprecation(
  described: string | null,
  deprecated: DeprecatedMetadata | null,
): string | undefined {
  if (!deprecated) return described ?? undefined;

  const lines: string[] = ['**Deprecated.**'];
  if (deprecated.sunset) {
    lines[0] += ` Stops answering on ${deprecated.sunset}.`;
  }
  if (deprecated.use) lines[0] += ` Use \`${deprecated.use}\` instead.`;
  if (deprecated.note) lines.push(deprecated.note);
  if (described) lines.push(described);

  return lines.join('\n\n');
}

/**
 * Convert a class-validator-jsonschema generated schema into OpenAPI parameters.
 * For path params, force required=true (OpenAPI requires it).
 */
function paramsFromSchema(
  schema: any,
  location: 'path' | 'query',
): OpenAPIParameter[] {
  if (!schema?.properties) return [];
  const required: string[] = schema.required || [];
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.includes(name),
    schema: propSchema,
  }));
}

export interface OpenAPIGroup {
  basePath: string;
  endpointReaders: EndpointReader[];
}

/**
 * Generate an OpenAPI 3.0.3 spec from one or more groups of registered
 * EndpointReaders. Each group has its own basePath; routes are emitted at
 * `path.join(group.basePath, reader.group, reader.pathname)`.
 */
export class OpenAPIGenerator {
  generate(args: {
    groups: OpenAPIGroup[];
    info?: OpenAPIInfo;
  }): OpenAPIDocument;
  generate(args: {
    endpointReaders: EndpointReader[];
    basePath: string;
    info?: OpenAPIInfo;
  }): OpenAPIDocument;
  generate(args: any): OpenAPIDocument {
    const groups: OpenAPIGroup[] =
      'groups' in args
        ? args.groups
        : [{ basePath: args.basePath, endpointReaders: args.endpointReaders }];

    // Convert all class-validator decorated DTOs into JSON schemas at once.
    // class-validator-jsonschema reads the global metadata storage, so any DTO
    // imported by the time this runs is included automatically.
    const schemas = validationMetadatasToSchemas({
      refPointerPrefix: REF_PREFIX,
    }) as Record<string, any>;

    const paths: OpenAPIDocument['paths'] = {};
    const tagSet = new Set<string>();

    for (const group of groups) {
      for (const reader of group.endpointReaders) {
        if (reader.apiHidden) continue; // `@ApiHidden`: mounted, undocumented
        // OpenAPI 3 does not define QUERY as an operation: including it would
        // produce an invalid document, so it is omitted from the spec.
        if (reader.method === 'query') continue;

        const url = fullPath(group.basePath, reader.group, reader.pathname);
        paths[url] = paths[url] || {};

        const tags =
          reader.apiTags.length > 0 ? reader.apiTags : [reader.group];
        tags.forEach((t) => tagSet.add(t));

        const parameters: OpenAPIParameter[] = [];
        if (reader.ParamsSchema) {
          parameters.push(
            ...paramsFromSchema(schemas[reader.ParamsSchema.name], 'path'),
          );
        }
        if (reader.QuerySchema) {
          parameters.push(
            ...paramsFromSchema(schemas[reader.QuerySchema.name], 'query'),
          );
        }
        // Infer path params from the URL if @Params didn't declare them.
        // OpenAPI requires every {placeholder} in a path to have a parameter.
        const declaredPathNames = new Set(
          parameters.filter((p) => p.in === 'path').map((p) => p.name),
        );
        const inUrl = url.matchAll(/\{([^}]+)\}/g);
        for (const m of inUrl) {
          if (!declaredPathNames.has(m[1])) {
            parameters.push({
              name: m[1],
              in: 'path',
              required: true,
              schema: { type: 'string' },
            });
          }
        }

        let requestBody: OpenAPIRequestBody | undefined;
        if (reader.BodySchema) {
          requestBody = {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: REF_PREFIX + reader.BodySchema.name },
              },
            },
          };
        }

        const responses: Record<string, OpenAPIResponse> = {};
        if (reader.apiResponses.length > 0) {
          for (const r of reader.apiResponses) {
            const entry: OpenAPIResponse = {
              description: r.description ?? `Status ${r.status}`,
            };
            if (r.Schema) {
              entry.content = {
                'application/json': {
                  schema: { $ref: REF_PREFIX + r.Schema.name },
                },
              };
            }
            responses[String(r.status)] = entry;
          }
        } else {
          responses['200'] = { description: 'OK' };
        }

        const op: OpenAPIOperation = {
          tags,
          responses,
        };
        if (reader.apiSummary) op.summary = reader.apiSummary;
        const description = describeDeprecation(
          reader.apiDescription,
          reader.deprecated,
        );
        if (description) op.description = description;
        // Swagger UI strikes the operation through, which is the one signal a
        // reader gets without opening it.
        if (reader.deprecated) op.deprecated = true;
        if (parameters.length > 0) op.parameters = parameters;
        if (requestBody) op.requestBody = requestBody;

        paths[url][reader.method] = op;
      }
    }

    return {
      openapi: '3.0.3',
      info: {
        title: args.info?.title ?? 'API',
        version: args.info?.version ?? '1.0.0',
        description: args.info?.description,
      },
      paths,
      components: { schemas },
      tags: Array.from(tagSet)
        .sort()
        .map((name) => ({ name })),
    };
  }
}
