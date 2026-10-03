import type { MySqlTable, MySqlView } from 'drizzle-orm/mysql-core';
import type {
  PgEnum,
  PgMaterializedView,
  PgSchema,
  PgSequence,
  PgTable,
  PgView,
} from 'drizzle-orm/pg-core';
import type { SQLiteTable, SQLiteView } from 'drizzle-orm/sqlite-core';
import type { Contract } from './container';

/**
 * Something a module puts in the database schema.
 *
 * Usually a table — `pgTable`, `mysqlTable` or `sqliteTable`, all of one
 * module's in the engine the application runs on. On Postgres an ENUM has to be in this list too, and that is not a
 * detail: a table with an enum column generates
 * `"status" "order_status" NOT NULL` referencing a type that nothing creates,
 * so leaving the enum out produces a migration that fails when it runs. Views,
 * sequences and schemas are here for the same reason — whatever the generator
 * has to see to emit correct DDL.
 *
 * A module declares its own; it does not go looking for others'. The glob in
 * `tables/` is a convenience for finding the module's own.
 */
export type ModuleTable =
  | PgTable
  | PgEnum<[string, ...string[]]>
  | PgSequence
  | PgView
  | PgMaterializedView
  | PgSchema
  | MySqlTable
  | MySqlView
  | SQLiteTable
  | SQLiteView;

/**
 * Migrations contributed by a module. Either an array of migration classes or
 * the namespace object from `import * as migrations`. Normally neither: they
 * are found in the module's `migrations/` folder.
 */
export type ModuleMigrations = Function[] | Record<string, unknown>;

/** A glob (or list of globs), relative to the module folder. */
export type ModulePattern = string | string[];

/** The fields a module describes with globs. */
export type ModuleGlobField =
  'tables' | 'migrations' | 'routes' | 'routines' | 'providers' | 'strategies';

/**
 * Where samble looks when the manifest says nothing.
 *
 * A module that keeps this layout declares none of these fields, which is the
 * whole point: the manifest is then only what is particular to the module —
 * its id, what it needs, what it exposes — and not a list of paths that are
 * the same in every module ever written.
 *
 * Naming a field is how you say something else. It replaces the default for
 * that field only, and the rest keep working.
 *
 * All of them need `dir`. Without it a glob resolves against whatever the
 * process's working directory happens to be, so samble applies no default
 * rather than scanning a folder it was never pointed at.
 */
export const MODULE_LAYOUT: Readonly<Record<ModuleGlobField, string>> = {
  tables: './tables/*.table.ts',
  migrations: './migrations/*.ts',
  routes: './endpoints/*.endpoint.ts',
  routines: './routines/*.routine.ts',
  providers: './providers/*.provider.ts',
  strategies: './strategies/*.strategy.ts',
};

/**
 * A permission declared by the module that uses it.
 *
 * The key MUST be namespaced with the module id (`billing.view`, not `view`).
 * Third-party modules share one permission space, and the namespace is what
 * keeps two of them from claiming the same key.
 */
export interface ModulePermission<K extends string = string> {
  /** The key itself, namespaced under the module id: `billing.invoices.void`. */
  key: K;

  /**
   * What this lets somebody do, for the screen where a role is built.
   *
   * OPTIONAL on purpose. A key like `billing.invoices.void` already says it,
   * and a label that restates it in a sentence is one more string to keep
   * true. Write one where the key cannot carry the meaning by itself — which
   * is most likely for a module installed from somewhere else, where the
   * operator is reading a namespace they did not write and the key is all they
   * have.
   */
  label?: string;
}

/**
 * How a module declares one permission: the key alone, or the key with text.
 *
 * @example
 * permissions: [
 *   'billing.invoices.view',
 *   'billing.invoices.void',
 *   { key: 'billing.impersonate', label: 'Act as another operator' },
 * ]
 */
export type PermissionDeclaration<K extends string = string> =
  K | ModulePermission<K>;

/** The key a single declaration carries, whichever form it took. */
type KeyOfDeclaration<E> = E extends string
  ? E
  : E extends { key: infer K extends string }
    ? K
    : never;

/**
 * Every key a declaration list carries, as a union.
 *
 * This is what lets {@link PermissionsOf} read the spellings straight off a
 * module, so a key is written once — in the manifest — instead of once there
 * and again in the file that teaches them to the compiler.
 */
export type PermissionKeysOf<P> = P extends readonly (infer E)[]
  ? KeyOfDeclaration<E>
  : never;

/**
 * What a module declares about itself. This is the module's public face: the
 * registry reads it to resolve dependencies, run migrations and mount routes,
 * and it is readable without evaluating any decorator.
 *
 * Every field here is honored by a subsystem that exists: the manifest never
 * describes something the framework cannot do.
 */
export interface ModuleManifest<
  P extends readonly PermissionDeclaration[] = readonly PermissionDeclaration[],
> {
  /** Unique id: lowercase, digits and dashes (`billing`, `customer-portal`). */
  id: string;

  /** Human-readable name, shown wherever modules are listed. */
  label?: string;

  /** Ids of the modules this one needs. Resolved in topological order. */
  requires?: string[];

  /**
   * Environment variables this module cannot run without.
   *
   * Checked at boot, before the database is opened: an installation missing one
   * refuses to start and the error names the module and every variable that is
   * absent. An empty value counts as absent, because `KEY=` is what a template
   * looks like before anyone filled it in.
   *
   * It belongs in the MANIFEST rather than in the module's code so that it can be
   * answered without running anything — which is what `samble doctor` does, and
   * what makes "what does this module need from me?" a question an installer can
   * ask before the first boot.
   *
   * Only what is REQUIRED. A variable with a default in code is read with
   * `ConfigService.optional()` and is not declared here — declaring it would
   * refuse a boot that had a perfectly good default.
   *
   * @example
   * env: ['WA_BRIDGE_URL', 'WA_BRIDGE_TOKEN'],
   */
  env?: string[];

  /**
   * Folder the module lives in — pass `__dirname`.
   *
   * Everything samble finds by itself is found from here: the standard layout
   * ({@link MODULE_LAYOUT}) and any glob the manifest declares. Without it
   * there is nothing to resolve against — paths would land on whatever the
   * process's working directory happens to be — so samble looks for nothing at
   * all, and a module with no `dir` has to list its tables by hand.
   *
   * Explicit because inferring it from the call stack is fragile and silent
   * when wrong.
   */
  dir?: string;

  /**
   * The tables, or a glob that finds them. Defaults to
   * `./tables/*.table.ts`.
   *
   * A glob is read when the manifest is — the same moment an `import` at the
   * top of this file would have been — so the whole schema is known before the
   * connection is built. Only what belongs in a schema is kept: a type, a
   * helper or a DTO living in the same folder is ignored.
   *
   * An explicit `[]` means the module owns no tables, and no default applies.
   */
  tables?: ModuleTable[] | ModulePattern;

  /**
   * The migration classes, the namespace object from `import * as migrations`,
   * or a glob. Defaults to `./migrations/*.ts`.
   *
   * Order never comes from this field: it is the timestamp at the end of each
   * class name, which is why a glob loses nothing.
   */
  migrations?: ModuleMigrations | ModulePattern;

  /**
   * Globs for this module's endpoints and scheduled routines. Default to
   * `./endpoints/*.endpoint.ts` and `./routines/*.routine.ts`.
   */
  routes?: ModulePattern;
  routines?: ModulePattern;

  /**
   * Glob for this module's `Provider` classes — how it answers the contracts it
   * owns. Defaults to `./providers/*.provider.ts`.
   *
   * There is no glob for the TOKENS themselves: one is imported by name, so
   * there is nothing to discover. `tokens/` is still where all three kinds
   * go, and `samble token` writes them there — a convention for people, not
   * a glob.
   */
  providers?: ModulePattern;

  /**
   * Glob for this module's `Strategy` classes — what it contributes to
   * extension points OTHER modules opened. Defaults to
   * `./strategies/*.strategy.ts`.
   *
   * A separate folder from `providers/` because it is a separate relationship:
   * a provider is this module's own public face, answering a contract it owns,
   * while a strategy implements somebody else's domain interface and is run by
   * them. Keeping them apart is what makes the two legible in a file tree.
   */
  strategies?: ModulePattern;

  /**
   * What this module can gate: the keys, as they will be asserted.
   *
   * This is the ONLY place a key is spelled. `PermissionsOf<typeof thisModule>`
   * carries the spellings into the type system, so a typo in an endpoint does
   * not compile and nothing has to be kept in sync by hand.
   *
   * @example
   * permissions: ['billing.invoices.view', 'billing.invoices.void']
   */
  permissions?: P;

  /**
   * Contracts this module calls.
   *
   * A declaration, not logic, which is why it belongs here: it turns a missing
   * provider into a refusal to start instead of a failure on the first request
   * that happens to need it. samble cannot see which contracts a module calls
   * by reading its code.
   */
  consumes?: Contract<any>[];
}

/**
 * A validated manifest with every default applied, which is what the registry
 * consumes. Optional collections become empty ones, so nothing downstream has
 * to guard against `undefined`.
 */
export interface ResolvedModule<K extends string = string> {
  id: string;
  label: string;
  requires: string[];
  /** Environment variables this module needs. Checked at boot. */
  env: string[];
  dir: string | null;
  tables: ModuleTable[];
  migrations: Function[];
  routes: string[];
  routines: string[];
  providers: string[];
  strategies: string[];
  permissions: ModulePermission<K>[];
  /**
   * Just the keys, for granting everything one module has.
   *
   * @example
   * auditor: [...identity.permissionKeys],
   */
  permissionKeys: K[];
  consumes: Contract<any>[];

  /**
   * Fields that came from {@link MODULE_LAYOUT} instead of the manifest.
   *
   * What it is for: a glob the author wrote and that finds nothing is a
   * mistake worth reporting; a default that finds nothing just means the
   * module has no endpoints, or no routines, and reporting it would be noise on
   * every boot.
   */
  implicit: ModuleGlobField[];
}

/** Thrown when a manifest is malformed. Always a startup-time error. */
export class ModuleDefinitionError extends Error {
  constructor(
    message: string,
    /** Id of the offending module, when it could be read. */
    public moduleId: string | null = null,
  ) {
    super(message);
    this.name = 'ModuleDefinitionError';
  }
}
