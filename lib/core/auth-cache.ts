import { Request } from 'express';
import { AuthResolver, AuthResult } from './auth';

/** How many callers a cache keeps before it drops the least recently used. */
const DEFAULT_MAX = 5000;

/** What the application tells the cache. All of it is policy, not mechanism. */
export interface AuthCacheOptions {
  /**
   * The caller this request belongs to, or `null` to resolve it fresh and store
   * nothing.
   *
   * The framework cannot compute this. Which part of a request is the
   * credential is exactly what the resolver hides, so the key comes from the
   * only place that knows.
   *
   * Prefer the IDENTITY over the credential — the user id, not the session id.
   * A role change or a suspension is then one `invalidate(userId)` and every
   * device that user is signed in on refreshes at once, instead of having to
   * enumerate their sessions.
   *
   * Reading it from the session also keeps remote sign-out immediate for free:
   * a session destroyed server-side loads no `userId`, the key is `null`, and
   * the cache is never consulted.
   *
   * @example
   * key: (request) => request.session?.userId ?? null
   */
  key: (request: Request) => string | number | null | undefined;

  /**
   * Milliseconds an entry stays usable. Required, because it is the one number
   * that decides how stale an authorization decision may be, and a framework
   * picking that quietly is a framework that decided your security policy.
   *
   * It is a safety net, not the mechanism: revoking should call
   * {@link CachedAuthResolver.invalidate}, and the TTL is what covers the paths
   * nobody remembered.
   */
  ttl: number;

  /** Entries kept before the least recently used one is dropped. Default 5000. */
  max?: number;
}

/** An {@link AuthResolver} with the handles to empty what it remembers. */
export type CachedAuthResolver = AuthResolver & {
  /**
   * Forgets one caller, so their next request resolves fresh.
   *
   * Call it from every path that changes what somebody may do: signing out,
   * changing a role, suspending or deleting a user. Without it the change waits
   * for the TTL, which is the cache's floor and not its contract.
   *
   * Takes whatever `key` returns.
   */
  invalidate(key: string | number): void;

  /** Forgets everybody. For a permission model that changed underneath. */
  clear(): void;
};

interface Entry {
  expires: number;
  /**
   * The resolution in flight, not the value.
   *
   * A cold cache and a screen that fires eight requests at once would otherwise
   * run the resolver eight times — precisely the moment the cache was for.
   * Storing the promise means the first request resolves and the other seven
   * wait on it.
   */
  result: Promise<AuthResult | null>;
}

/**
 * Remembers what the resolver answered, per caller, for a while.
 *
 * The resolver runs on every request and usually queries: measured through a
 * whole HTTP request against an in-process Postgres, that query was a third of
 * the request. It is a fixed tax on every call, including the cheap reads that
 * are most of an API.
 *
 * What it costs is freshness. samble resolves permissions per request precisely
 * so that revoking a role takes effect on the next one; a cache trades some of
 * that back, which is why `ttl` is required and `invalidate` exists.
 *
 * There is no timer: entries expire when they are next read and the least
 * recently used one is dropped at `max`, so nothing here keeps a process alive
 * or needs shutting down.
 *
 * Two things it deliberately does NOT cache:
 *
 * - **Anonymous and unrecognized calls.** A `null` key and a `null` result both
 *   resolve fresh every time. Caching a `null` is how somebody signs in and
 *   stays anonymous until the TTL runs out.
 * - **A resolver that threw.** A malformed credential is a 401 every time, not
 *   a remembered one.
 *
 * The cached result is SHARED between requests, so treat the actor as
 * immutable. Writing to `this.auth.actor` was already a mistake; with a cache
 * it is a mistake other requests can see.
 *
 * @example
 * // src/config/auth.ts
 * export const auth = cacheAuth(defineAuth(sessionAuth, bearerAuth), {
 *   key: (request) => request.session?.userId ?? null,
 *   ttl: 15_000,
 * });
 *
 * @example
 * // wherever what somebody may do changes
 * auth.invalidate(userId);
 */
export function cacheAuth(
  resolver: AuthResolver,
  options: AuthCacheOptions,
): CachedAuthResolver {
  const { key, ttl, max = DEFAULT_MAX } = options;

  // Build time, not request time: a `ttl` of 0 is a cache that never hits and
  // a `max` of 0 is one that never keeps anything, and both look like a working
  // cache from the outside.
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error(
      `cacheAuth(): ttl must be a positive number of milliseconds, got ${ttl}.`,
    );
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`cacheAuth(): max must be a positive integer, got ${max}.`);
  }

  const entries = new Map<string, Entry>();

  const cached: AuthResolver = async (request, context) => {
    const raw = key(request);
    if (raw === null || raw === undefined || raw === '') {
      return resolver(request, context);
    }

    const id = String(raw);
    const hit = entries.get(id);
    if (hit) {
      if (hit.expires > Date.now()) {
        // Re-inserting makes the Map's insertion order a least-recently-used
        // order, which is the whole bookkeeping this needs: no second structure
        // and no allocation.
        entries.delete(id);
        entries.set(id, hit);
        return hit.result;
      }
      entries.delete(id);
    }

    const pending = Promise.resolve(resolver(request, context)).then(
      (result) => result ?? null,
    );
    // Stored BEFORE awaiting, so the requests that arrive while this one is in
    // flight find it. The TTL counts from here rather than from the answer,
    // which errs toward fresher.
    entries.set(id, { expires: Date.now() + ttl, result: pending });

    if (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }

    let result: AuthResult | null;
    try {
      result = await pending;
    } catch (error) {
      entries.delete(id);
      throw error;
    }

    if (result === null) entries.delete(id);
    return result;
  };

  return Object.assign(cached, {
    invalidate: (value: string | number) => {
      entries.delete(String(value));
    },
    clear: () => {
      entries.clear();
    },
  });
}
