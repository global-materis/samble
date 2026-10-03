/* eslint-disable @typescript-eslint/no-empty-object-type -- the point of
   this file: the application fills these by declaration merging, and samble
   declares them empty so it is not the one choosing their shape. */
import { Request } from 'express';
import type { Database } from '../modules/database';
import { AuthError, CustomError, ForbiddenError } from '../utilities/errors';
import { HttpStatus } from '../interfaces/http-status';
import type { Contract } from '../modules/container';
import { GRANT_ALL, PermissionRegistry } from '../modules/permissions';

declare global {
  /**
   * Types the application fills in by declaration merging. It lives in the
   * global scope on purpose: an interface re-exported from the package entry
   * cannot be merged from outside, so this is the only shape a consumer can
   * actually widen.
   */
  namespace SambleAuth {
    /**
     * Whoever is making the request.
     *
     * samble declares it EMPTY deliberately. The framework has no business
     * deciding what an actor looks like — a user id, a tenant, an API key
     * issued to a third-party extension are all valid, and baking one of them
     * into the framework is what made `getSession('userId')` impossible to
     * move away from.
     *
     * @example
     * // anywhere in the application, once
     * declare global {
     *   namespace SambleAuth {
     *     interface Actor {
     *       userId: number;
     *       role: UserRole;
     *     }
     *   }
     * }
     */
    interface Actor {}

    /**
     * Every permission key the application declares, as the KEYS of this
     * interface. Fill it once and `assert` / `can` stop taking any string:
     *
     * ```typescript
     * // src/config/permissions.ts, once
     * import { permissions as tasks } from '../modules/tasks/permissions';
     * import { permissions as billing } from '../modules/billing/permissions';
     *
     * declare global {
     *   namespace SambleAuth {
     *     interface Permissions
     *       extends PermissionsOf<typeof tasks>,
     *         PermissionsOf<typeof billing> {}
     *   }
     * }
     * ```
     *
     * From then on `this.auth.assert('tasks.manage')` is a plain string that
     * the compiler checks, and `'tasks.mange'` does not build. Left empty —
     * the default — any string is accepted, so this is opt-in and adding it
     * later breaks nothing that was already right.
     */
    interface Permissions {}
  }
}

/**
 * A key the application declared, or any string while it has declared none.
 *
 * The fallback is what keeps this additive: an application that never fills
 * `SambleAuth.Permissions` keeps compiling exactly as before.
 */
export type PermissionKey = [keyof SambleAuth.Permissions] extends [never]
  ? string
  : (keyof SambleAuth.Permissions & string) | typeof GRANT_ALL;

/** Whoever is making the request, as the application declared it. */
export type Actor = SambleAuth.Actor;

/** What an {@link AuthResolver} hands back when it recognizes the caller. */
export interface AuthResult {
  /** The actor itself. Shape is the application's. */
  actor: Actor;
  /**
   * Permission keys this actor holds, matched against the `permissions` each
   * module declares in its manifest. `*` grants everything.
   */
  permissions?: readonly string[];
}

/**
 * What a resolver gets besides the request.
 *
 * Without it, any application whose permissions live in the database had to
 * close over an imported DataSource singleton — the exact global the module
 * container exists to avoid — or copy them into the session at login and let
 * them go stale.
 */
export interface AuthContext {
  /** The open connection, with every module's tables in its schema. */
  db: Database;

  /**
   * Resolves a contract a module provides, so the policy for who may do what
   * can stay inside the module that owns it.
   *
   * @example
   * auth: async (req, { get }) => {
   *   const userId = req.session?.userId;
   *   if (!userId) return null;
   *   const directory = get(UserDirectory);
   *   return { actor: { userId }, permissions: await directory.permissionsOf(userId) };
   * }
   */
  get<T>(token: Contract<T>): T;
}

/**
 * Turns a request into whoever is behind it, or `null` when nobody is.
 *
 * This is the seam that keeps the transport out of the endpoints: a cookie
 * session today, a bearer token from the mobile app, an API key from a
 * third-party extension — all of them are this one function.
 *
 * Passed as `Samble.create({ auth })`.
 *
 * It runs once per request, before `previous()`, so keep it cheap. Throwing
 * from here is legitimate (a malformed token is a 401) and maps through the
 * usual error handling.
 */
export type AuthResolver = (
  request: Request,
  context: AuthContext,
) => AuthResult | null | undefined | Promise<AuthResult | null | undefined>;

/**
 * Per-request view of who is asking and what they may do.
 *
 * Reachable as `this.auth` inside an {@link Endpoint}.
 */
export class Auth {
  private readonly granted: Set<string>;

  /**
   * @param result What the resolver returned, or `null` for an anonymous call.
   * @param configured Whether the application has a resolver at all. It tells
   * "nobody is logged in" (a 401) apart from "this app never wired auth up"
   * (a programming mistake, which must not look like a 401 to the client).
   */
  constructor(
    private readonly result: AuthResult | null = null,
    private readonly configured = false,
    /**
     * What the installed modules declare. Without it — an `Auth` built by
     * hand — keys are not checked.
     */
    private readonly registry?: PermissionRegistry,
  ) {
    this.granted = new Set(result?.permissions ?? []);
  }

  /** True when the resolver recognized the caller. */
  public get isAuthenticated(): boolean {
    return this.result !== null;
  }

  /**
   * The actor, or `null`. For endpoints that serve signed-in and anonymous
   * callers alike — everywhere else prefer {@link actor}, which fails loudly.
   */
  public get optional(): Actor | null {
    return this.result?.actor ?? null;
  }

  /**
   * The actor. THROWS `AuthError` (401) when the call is anonymous.
   *
   * The throw is the point: reading the actor and checking it exists were two
   * steps that had to be written together every single time, and forgetting
   * the second one failed silently.
   */
  public get actor(): Actor {
    return this.requireActor();
  }

  /** Permission keys held by this actor. Empty when anonymous. */
  public get permissions(): string[] {
    return [...this.granted];
  }

  /**
   * Whether the actor holds every permission given. Anonymous is always false.
   *
   * @example
   * if (!this.auth.can('billing.void')) return this.readOnlyView();
   */
  public can(...permissions: PermissionKey[]): boolean {
    permissions.forEach((permission) => this.assertDeclared(permission));
    if (!this.result) return false;
    if (this.granted.has(GRANT_ALL)) return true;
    return permissions.every((permission) => this.granted.has(permission));
  }

  /**
   * Demands the permissions, or stops the request: `AuthError` (401) when
   * nobody is signed in, `ForbiddenError` (403) when someone is but lacks one.
   *
   * The two statuses are not interchangeable — 401 tells a client to
   * authenticate, 403 tells it not to bother.
   *
   * @example
   * this.auth.assert('billing.void');
   */
  public assert(...permissions: PermissionKey[]): void {
    // BEFORE the 401 on purpose: an undeclared key is a code error, and it must
    // not stay hidden until someone signs in. In development the first request
    // is usually anonymous, which is exactly when you want to hear about it.
    permissions.forEach((permission) => this.assertDeclared(permission));
    this.requireActor();
    if (this.can(...permissions)) return;
    const missing = permissions.filter(
      (permission) => !this.granted.has(permission),
    );
    throw new ForbiddenError(
      `Missing permission: ${missing.join(', ')}.`,
      missing,
    );
  }

  /**
   * Refuses a key no module declares.
   *
   * It answers 500 rather than 403 ON PURPOSE: a key that exists nowhere is a
   * mistake in the code, and answering 403 would send whoever debugs it to
   * look at roles and grants instead of at the typo.
   *
   * It is a `CustomError` and not a plain `Error` because an unexpected
   * `Error`'s message is no longer sent to the client — a foreign message was
   * never written for one to read. This message WAS: it names the key, and
   * offers the nearest spelling. Muting it would defeat the whole reason this
   * check runs before the 401.
   */
  private assertDeclared(permission: string): void {
    if (!this.registry || this.registry.has(permission)) return;

    const near = this.registry.suggest(permission);
    const hint = near.length > 0 ? ` Did you mean: ${near.join(', ')}?` : '';
    throw new CustomError(
      HttpStatus.INTERNAL_SERVER_ERROR,
      `Unknown permission "${permission}": no installed module declares it. Add it to that module's "permissions" in defineModule().${hint}`,
    );
  }

  private requireActor(): Actor {
    if (this.result) return this.result.actor;
    if (!this.configured) {
      throw new Error(
        'This application resolves no actor: pass `auth` to Samble.create() before reading this.auth.',
      );
    }
    throw new AuthError('Unauthorized.');
  }
}

/**
 * Packs one or more strategies into the single resolver `Samble.create()` takes.
 *
 * With one argument it is the seam itself, named: the callback's `request` and
 * `context` are typed without annotating anything, and the result is checked
 * before it reaches an endpoint.
 *
 * With several it is what every application ends up writing by hand. The
 * resolver is ONE function by design, but the ways into an application are
 * plural — a cookie session for the web, a bearer token for the mobile app, an
 * API key for a third-party extension — and chaining them inside a single body
 * turns the seam into an if/else ladder where order and short-circuiting are
 * re-invented per project. Here order is the argument order, and the first
 * strategy that recognizes the caller wins.
 *
 * @example
 * // one strategy
 * export default defineAuth(async (request, { db }) => {
 *   const userId = request.session?.userId;
 *   if (!userId) return null;
 *   const user = await db.getRepository(User).findOneBy({ id: userId });
 *   if (!user) return null;
 *   return { actor: { userId }, permissions: PERMISSIONS_BY_ROLE[user.role] };
 * });
 *
 * @example
 * // three, tried in order
 * export default defineAuth(sessionAuth, bearerAuth, apiKeyAuth);
 *
 * @param resolver The first strategy. At least one is required.
 * @param fallbacks Tried in order, only while the previous ones return `null`.
 */
export function defineAuth(
  resolver: AuthResolver,
  ...fallbacks: AuthResolver[]
): AuthResolver {
  const strategies = [resolver, ...fallbacks];

  // An indexed loop, not `for...of strategies.entries()`: this runs on every
  // single request, and `entries()` would allocate two iterators and a
  // throwaway `[index, strategy]` pair per strategy tried, for nothing.
  return async (request, context) => {
    for (let index = 0; index < strategies.length; index += 1) {
      const result = await strategies[index](request, context);
      if (result === null || result === undefined) continue;
      if (result.actor === null || typeof result.actor !== 'object') {
        throw noActor(index, strategies.length);
      }
      if (
        result.permissions !== undefined &&
        !Array.isArray(result.permissions)
      ) {
        throw badPermissions(index, strategies.length, result.permissions);
      }
      return result;
    }

    return null;
  };
}

/**
 * Refuses a result that would make `this.auth` lie.
 *
 * A resolver that returns an object without an `actor` leaves `Auth` in a
 * state no endpoint can defend against: `isAuthenticated` is true while
 * `actor` is `undefined`, so the 401 that should have happened never does and
 * the failure surfaces later, somewhere else. A `permissions` string instead
 * of a list is the same kind of quiet wrong — `new Set('tasks.view')` holds
 * ten letters and matches no key.
 *
 * Both are mistakes in the code, so both throw a plain `Error` (a 500) rather
 * than a 401: answering "unauthorized" would send whoever debugs it to look at
 * roles and grants instead of at the resolver.
 *
 * The two checks are inlined at the call site and only these builders run, so
 * the happy path costs two comparisons and allocates no message.
 */
function noActor(index: number, total: number): Error {
  const name = which(index, total);

  return new Error(
    `${name} passed to defineAuth() returned no actor. Return \`null\` for an anonymous call, or \`{ actor, permissions }\` for a recognized one.`,
  );
}

function badPermissions(
  index: number,
  total: number,
  permissions: unknown,
): Error {
  const name = which(index, total);

  return new Error(
    `${name} passed to defineAuth() returned \`permissions\` as ${typeof permissions}, not a list. Use \`['${GRANT_ALL}']\` to grant everything, or a list of the keys the actor holds.`,
  );
}

function which(index: number, total: number): string {
  return total === 1 ? 'The resolver' : `Resolver #${index + 1}`;
}
