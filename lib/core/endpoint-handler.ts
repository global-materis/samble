/// <reference types="multer" />
//
// `req.file` / `req.files` below come from multer's augmentation of Express's
// `Request`. TypeScript 6 no longer pulls a module-shaped @types package in
// just because it is installed. It is named HERE, in an internal file, and not
// in the public templates: what an application reads is `UploadedFile`, which
// is samble's own type and needs nobody's global namespace.
import { Request, Response } from 'express';
import EndpointReader from './endpoint-reader';
import schemaValidator from '../services/schema-validator';
import { HttpStatus } from '../interfaces/http-status';
import { ErrorIdentifier } from '../interfaces/type-error';
import { Database } from '../modules/database';
import ErrorControl from '../utilities/error-control';
import type { Container, Contract } from '../modules/container';
import { Auth, AuthContext, AuthResolver } from './auth';
import type { PermissionRegistry } from '../modules/permissions';
import type { Scheduler } from '../modules/schedules';
import { Output } from '../outputs/output';
import { Logger } from '../utilities/logger';

export default class EndpointHandler {
  constructor(
    private endpointReader: EndpointReader,
    private dbSource: Database,
    private container?: Container,
    private authResolver?: AuthResolver,
    private permissions?: PermissionRegistry,
    private scheduler?: Scheduler,
  ) {}

  /**
   * Built once and reused: the connection and the container are stable for the
   * whole life of this handler, only the request changes.
   */
  private context: AuthContext | null = null;

  private authContext = (): AuthContext => {
    if (!this.context) {
      this.context = {
        db: this.dbSource,
        get: <T>(token: Contract<T>): T => {
          if (!this.container) {
            throw new Error(
              `Cannot resolve the contract "${token.id}": this application has no modules. Start it with Samble.create({ modules }).`,
            );
          }
          return this.container.get(token);
        },
      };
    }
    return this.context;
  };

  /**
   * One warning per route, not per request.
   *
   * The question a deprecation has to answer is "is anyone STILL calling this",
   * and one line answers it. A line per request would answer it again forever
   * and bury everything else in the log; how much and from where is what the
   * access log is for.
   */
  private announced = false;

  /**
   * `@Deprecated`: tells the caller, and tells you that the caller exists.
   *
   * Registered FIRST, before the middleware and the DTO check, so the headers
   * are on the way out whatever the route ends up answering — including a 422
   * that never reaches `main()`. A route on its way out does not stop being on
   * its way out because one call was malformed.
   */
  public deprecation = (req: Request, res: Response, next: () => void) => {
    const deprecated = this.endpointReader.deprecated;
    if (!deprecated) return next();

    // The boolean form: the `Deprecation` header is still an IETF draft, and
    // the one thing every draft of it agrees on is that its presence means this.
    res.setHeader('Deprecation', 'true');
    // RFC 8594, and the format is not negotiable: an HTTP-date or nothing.
    if (deprecated.sunsetHeader) {
      res.setHeader('Sunset', deprecated.sunsetHeader);
    }
    // The relation is registered (RFC 8288), so a client library that follows
    // links finds the replacement without anyone reading prose.
    if (deprecated.use) {
      res.setHeader('Link', `<${deprecated.use}>; rel="successor-version"`);
    }

    if (!this.announced) {
      this.announced = true;
      const parts = [
        `Deprecated route called: ${req.method} ${req.originalUrl}`,
      ];
      if (deprecated.sunset) {
        parts.push(`It stops answering on ${deprecated.sunset}.`);
      }
      if (deprecated.use) parts.push(`Successor: ${deprecated.use}.`);
      parts.push(
        'Logged once per process — the access log has every call and who made it.',
      );
      Logger.warn(parts.join(' '));
    }

    next();
  };

  public middleware = (req: Request, res: Response, next: () => void) => {
    this.endpointReader.MiddlewareClass(req, res, next);
  };

  public schema = async (req: Request, res: Response, next: () => void) => {
    let message = '';
    let errors: Record<string, any> | null = null;

    const schemasClass: Array<[new () => any, any, string]> = [
      [this.endpointReader.ParamsSchema, req.params, 'Invalid parameters'],
      [this.endpointReader.BodySchema, req.body, 'Invalid body'],
      [this.endpointReader.QuerySchema, req.query, 'Invalid query'],
    ];

    for (const [schemaClass, object, msg] of schemasClass) {
      if (!schemaClass) continue;
      const result = await schemaValidator(schemaClass, object);
      if (result) {
        message = msg;
        errors = result;
        break;
      }
    }

    if (!errors) {
      next();
      return;
    }

    res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      message,
      type: ErrorIdentifier.SCHEMA,
      errors,
    });
  };

  public main = async (req: Request, res: Response) => {
    const EndpointClass = this.endpointReader.getEndpointClass();
    // `db` is stable across requests, so it lives on the prototype: it is
    // available during field initializers (e.g.
    // `private rep = this.db.getRepository(...)`), which run inside `new`.
    EndpointClass.prototype.db = this.dbSource;
    // Like `db`: on the prototype, so it is there before the instance exists
    // and a field initializer can already reach it.
    EndpointClass.prototype.container = this.container;
    // Same rule as `db` and `container`: stable for the life of the handler, so
    // it goes on the prototype and is there before the instance exists.
    // Same rule again: an endpoint is where an operator's "pause this schedule"
    // button lands, so the runner has to be reachable from `main()`.
    EndpointClass.prototype.scheduler = this.scheduler;

    const endpointClass = new EndpointClass();
    // The rest of the state is PER REQUEST and is assigned on the INSTANCE, not
    // the prototype. With the prototype, two concurrent requests to the same
    // endpoint overwrote each other: one `await`ed inside `main()` while the
    // other rewrote `prototype.query/params/body` before the first one read
    // them, so both ended up with the last one's data. Assigning on the
    // instance gives each request its own state. (cast: the instance is typed
    // with the default `null` generics; the real state comes from the DTOs.)
    const state = endpointClass as unknown as Record<string, unknown>;
    state.params = this.endpointReader.ParamsSchema ? req.params : null;
    state.body = this.endpointReader.BodySchema ? req.body : null;
    state.query = this.endpointReader.QuerySchema ? req.query : null;
    state.files = req.files;
    state.file = req.file;
    state.request = req;
    state.response = res;
    // Anonymous until the resolver says otherwise, so an endpoint still finds
    // an `auth` if resolution itself blows up.
    state.auth = new Auth(
      null,
      this.authResolver !== undefined,
      this.permissions,
    );
    try {
      // Inside the try on purpose: a resolver that throws on a malformed token
      // should become a 401 through the usual mapping, not an unhandled
      // rejection that leaves the request hanging.
      if (this.authResolver) {
        state.auth = new Auth(
          (await this.authResolver(req, this.authContext())) ?? null,
          true,
          this.permissions,
        );
      }
      await endpointClass.previous();
      const dataResponse = await endpointClass.main();
      // The controller may have written directly to `this.response` (binaries,
      // HTML, streams). If it already ended the response, don't overwrite it.
      if (res.headersSent) return;
      // Not JSON: a page, a PDF, a spreadsheet. The endpoint decided that at
      // run time, with the data in hand, so nothing here had to be declared up
      // front. `httpStatus` still applies — a view answering 404 is normal.
      if (dataResponse instanceof Output) {
        res.status(endpointClass.httpStatus);
        await dataResponse.send(res);
        return;
      }
      res.status(endpointClass.httpStatus).json(dataResponse);
    } catch (error) {
      // One layer of catching is enough now that no endpoint hook runs in here:
      // the nested catch only existed because `error()` could itself throw.
      const errResult = new ErrorControl(error);
      // Includes a template that failed to render and a stream that broke
      // mid-transfer. The second one has already sent bytes, so `headersSent`
      // is what keeps this from writing a JSON error into the middle of a
      // file the client is still downloading.
      if (res.headersSent) return;
      errResult.send(res);
    }
  };
}
