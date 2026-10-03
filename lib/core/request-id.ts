import { randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import type { RequestHandler } from 'express';

/**
 * One id per request, carried through everything that request touches.
 *
 * Without it, "a user says it failed" and the log are two separate things: you
 * have a timestamp, a rough endpoint and a haystack. With it, the client is
 * holding the exact string that every line of that request was written with.
 *
 * It travels in `AsyncLocalStorage` rather than being passed down. The log
 * lines worth correlating are the ones written deep inside — a provider, a
 * listener, a repository — and threading a parameter through all of them to
 * reach the interesting case is how the idea gets abandoned halfway.
 */
export interface RequestIdConfig {
  /**
   * Header read on the way in and echoed on the way out. Defaults to
   * `x-request-id`. Set it to whatever your gateway or CDN already sends, so
   * one id spans the whole hop chain instead of restarting here.
   */
  header?: string;
}

const storage = new AsyncLocalStorage<string>();

/** The id of the request being served, or `null` outside one. */
export const currentRequestId = (): string | null => storage.getStore() ?? null;

/**
 * Twelve hex characters, not a UUID.
 *
 * It is prefixed to every log line, so length is not free: 36 characters of
 * UUID per line buys entropy nobody needs to tell two requests apart inside
 * one log file.
 */
const generate = (): string => randomBytes(6).toString('hex');

/**
 * A header value is client input.
 *
 * Accepted verbatim it lands in every log line, which is how a newline in a
 * header turns into a forged log entry. Anything outside this alphabet is
 * replaced by a generated id rather than sanitized: a half-cleaned id is not
 * the one the caller is holding, so it would correlate nothing.
 */
const USABLE = /^[A-Za-z0-9._:-]{1,128}$/;

export function buildRequestId(config: RequestIdConfig = {}): RequestHandler {
  const header = (config.header ?? 'x-request-id').toLowerCase();

  return (request, response, next) => {
    const incoming = request.headers[header];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = candidate && USABLE.test(candidate) ? candidate : generate();

    // Echoed so the caller can quote it, and set BEFORE the chain runs: a
    // response that never reaches a route still carries it.
    response.setHeader(header, id);
    (request as { requestId?: string }).requestId = id;

    storage.run(id, () => next());
  };
}
