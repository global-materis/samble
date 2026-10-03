import { Endpoint } from '../templates/endpoint';

export const GET = Symbol('__get__');
export const POST = Symbol('__post__');
export const PUT = Symbol('__put__');
export const DELETE = Symbol('__delete__');
export const PATCH = Symbol('__patch__');
export const QUERY_METHOD = Symbol('__query_method__');

export interface HTTPMetadata {
  path: string;
}

const httpDecorator = (KEY: symbol) => {
  return (path: string = '') => {
    return function (target: new () => Endpoint<any, any, any>) {
      Reflect.defineMetadata(KEY, { path } as HTTPMetadata, target);
    };
  };
};

/** Registers the class as an HTTP GET endpoint. */
export const HttpGet = httpDecorator(GET);
/** Registers the class as an HTTP POST endpoint. */
export const HttpPost = httpDecorator(POST);
/** Registers the class as an HTTP PUT endpoint. */
export const HttpPut = httpDecorator(PUT);
/** Registers the class as an HTTP DELETE endpoint. */
export const HttpDelete = httpDecorator(DELETE);
/** Registers the class as an HTTP PATCH endpoint. */
export const HttpPatch = httpDecorator(PATCH);
/**
 * Registers the class as an HTTP QUERY endpoint: a safe, idempotent method
 * that, unlike GET, allows a body. Meant for searches whose criteria are too
 * large or complex for the query string; declare those criteria with `@Body`.
 *
 * Note: QUERY is an IETF draft (`draft-ietf-httpbis-safe-method-w-body`), not a
 * finalized standard. It requires a Node whose HTTP parser recognizes it and
 * may not be supported by proxies, CDNs or intermediate clients.
 */
export const HttpQuery = httpDecorator(QUERY_METHOD);
