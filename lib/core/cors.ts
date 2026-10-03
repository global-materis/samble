import cors from 'cors';
import type { RequestHandler } from 'express';
import { Logger } from '../utilities/logger';

/**
 * Who may call this API from a browser.
 *
 * Passed as `Samble.create({ cors })`. samble owns the mechanism — the headers,
 * the preflight, the order — and you own the policy, the same split as `auth`.
 * Without it no CORS headers are sent at all, which is the right answer for an
 * API no browser calls cross-origin.
 */
export interface CorsConfig {
  /**
   * Exact origins, scheme and port included: `https://app.example.com`, not
   * `app.example.com`.
   *
   * `true` allows any origin, which is only valid WITHOUT credentials — a
   * browser refuses `Access-Control-Allow-Origin: *` on a request carrying
   * cookies, so samble refuses the combination at startup instead of letting
   * you find out in a console.
   */
  origin: string | string[] | boolean;

  /**
   * Send and accept cookies. Needed by a session, and it forces an explicit
   * origin list.
   */
  credentials?: boolean;

  /** Defaults to the methods samble can mount. */
  methods?: string[];
  /** Request headers the browser may send. Defaults to what the preflight asked for. */
  allowedHeaders?: string[];
  /** Response headers the browser may READ. Nothing beyond the safelist by default. */
  exposedHeaders?: string[];
  /** Seconds a browser may cache the preflight. */
  maxAge?: number;
}

/** Thrown at startup by a CORS policy that cannot work. */
export class CorsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorsConfigError';
  }
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * Builds the middleware, refusing a policy that browsers would.
 *
 * A refused origin gets NO `Access-Control-Allow-Origin` header and the
 * request goes through — which is what the standard says and what keeps
 * server-to-server callers working. The browser is what blocks it. The log
 * line exists because otherwise that block has no trace on this side, and the
 * developer only sees a message in a console with no server to compare against.
 */
export function buildCors(config: CorsConfig): RequestHandler {
  const anyOrigin = config.origin === true || config.origin === '*';

  if (anyOrigin && config.credentials) {
    throw new CorsConfigError(
      'CORS: `credentials: true` cannot be combined with any origin — a browser rejects "Access-Control-Allow-Origin: *" on a request that carries cookies. List the origins that may sign in.',
    );
  }

  const list =
    typeof config.origin === 'string' && config.origin !== '*'
      ? [config.origin]
      : Array.isArray(config.origin)
        ? config.origin
        : null;

  if (list && list.length === 0) {
    // Almost always an env var that arrived empty, and the symptom is every
    // browser request failing with nothing in the server log.
    Logger.warn(
      'CORS: the allowed origin list is empty, so no browser may call this API. Check CORS_ORIGIN.',
    );
  }

  return cors({
    // Any origin answers a literal `*`, which is cacheable by anything in
    // between. Reflecting the caller's origin instead would be equivalent for
    // the browser and worse for every cache, and is one missing `Vary` away
    // from being a bug.
    origin: list
      ? (origin, callback) => {
          // No Origin header: curl, a server, a same-origin page. CORS does not
          // apply, and refusing here would break every non-browser caller.
          if (!origin) return callback(null, true);
          if (list.includes(origin)) return callback(null, true);

          Logger.warn(
            `CORS: refused origin ${origin}. Allowed: ${
              list.join(', ') || '(none)'
            }`,
          );
          // `false`, not an error: omit the header and let the browser decide.
          callback(null, false);
        }
      : '*',
    credentials: config.credentials ?? false,
    methods: config.methods ?? DEFAULT_METHODS,
    allowedHeaders: config.allowedHeaders,
    exposedHeaders: config.exposedHeaders,
    maxAge: config.maxAge,
  });
}
