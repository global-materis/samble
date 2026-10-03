import type { SQL } from 'drizzle-orm';
import type { MySqlDatabase } from 'drizzle-orm/mysql-core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
// A cycle (`dialects` imports the types here) that is only used at call time,
// never at import time, so it is harmless.
import { dialectOf } from '../dialects';

/**
 * The database engines samble runs on.
 *
 * The engine is the OPERATOR's choice, not the framework's: samble keeps one
 * adapter per engine (`lib/dialects/`) and loads only the driver of the one in
 * use, so nobody installs a package for an engine they do not run.
 */
export type DialectName = 'postgres' | 'mysql' | 'sqlite';

declare global {
  /**
   * What this application's database is, told to the compiler once.
   *
   * Drizzle's database type depends on the engine — `pg`, `mysql2` and
   * `libsql` hand back different classes with different methods — so
   * `this.db` can only be typed after the application says which one it runs.
   * `samble init` writes the declaration in `src/config/database.ts`, reading
   * the engine off the options the application connects with, so the compiler
   * and the driver cannot be told two different engines:
   *
   * ```typescript
   * declare global {
   *   namespace SambleDatabase {
   *     interface Config {
   *       dialect: ReturnType<typeof databaseFromEnv>['dialect'];
   *     }
   *   }
   * }
   *
   * export default function databaseFromEnv() {
   *   return { dialect: 'mysql', ... } satisfies DatabaseOptions;
   * }
   * ```
   *
   * It has to be ONE engine. `satisfies` keeps `'mysql'` as written; annotating
   * the function `: DatabaseOptions` instead widens it to every engine, and
   * then `this.db` is {@link DialectMustBeOneEngine}, so the mistake is named
   * where it shows up.
   *
   * A global namespace for the same reason as `SambleAuth`: an interface
   * re-exported from the package entry cannot be merged from outside. Left
   * empty, the dialect is `postgres`.
   */
  namespace SambleDatabase {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Config {}
  }
}

/** `true` when T is a union of more than one member. */
type IsUnion<T, U = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

/**
 * The dialect a `SambleDatabase.Config` declares: `postgres` when it declares
 * none, and `never` when what it declares is not exactly one engine.
 *
 * The `never` is deliberate. A declaration widened to `DialectName` (or to
 * `DialectName | undefined`, which is what `ReturnType<...>['dialect']` gives
 * for a function annotated `: DatabaseOptions`) used to fall through to
 * `postgres` in silence — compiling against one engine while connecting to
 * another, the one mistake this declaration exists to prevent.
 */
export type DialectOf<C> = C extends { dialect: infer D }
  ? true extends IsUnion<D>
    ? never
    : [D] extends [DialectName]
      ? D
      : never
  : 'postgres';

/** The dialect this application declared, `postgres` when it declared none. */
export type SelectedDialect = DialectOf<SambleDatabase.Config>;

/**
 * What `this.db` is when the declared dialect is not exactly one engine.
 *
 * A type and not a compile error, because a declaration cannot raise one: the
 * error appears where the database is used, and its NAME is the message —
 * "Property 'select' does not exist on type 'DialectMustBeOneEngine'". Hover
 * it for the fix.
 */
export interface DialectMustBeOneEngine {
  'SambleDatabase.Config declares more than one engine. In src/config/database.ts, end the returned options with `satisfies DatabaseOptions` instead of annotating the function `: DatabaseOptions`, which widens the dialect to every engine.': never;
}

/* The type arguments are the driver's result kind and the SCHEMA, and samble is
   agnostic about all of them on purpose. Naming the schema would mean a
   connection built with tables is a different type from one built without, and
   samble would accept only one of them. `any` here costs nothing that matters:
   the schema generic only types the relational api (`db.query.users`), which
   samble cannot offer anyway, while `db.select().from(table)` takes its types
   from the TABLE and stays exact. Measured, not assumed. */
/** Drizzle's database class for each engine. */
export interface DatabaseOf {
  postgres: PgDatabase<any, any, any>;
  mysql: MySqlDatabase<any, any, any, any>;
  sqlite: BaseSQLiteDatabase<'async', any, any, any>;
}

/**
 * A connection that is inside a transaction, which is all a migration gets.
 *
 * Drizzle's transaction object extends its database, so this is the database
 * minus the one thing a transaction has no business handing out: the client
 * behind it, which is how you would start a SECOND connection and step outside
 * the transaction you were given.
 *
 * Typed by the dialect the application declared (see `SambleDatabase.Config`).
 */
export type Transaction = [SelectedDialect] extends [never]
  ? DialectMustBeOneEngine
  : DatabaseOf[SelectedDialect];

/**
 * The database, as everything in samble sees it.
 *
 * Typed by the engine, never by the driver: the driver-specific types differ
 * only in what `execute()` hands back, and naming one of them here would mean
 * the framework only ran on that driver. The suite runs on PGlite and an
 * application runs on `pg`; both are the postgres type.
 *
 * `$client` is added because the base type does not declare it while every
 * driver has it. It is the way out of the one thing samble cannot give a module:
 * the RELATIONAL api (`db.query.users.findMany()`) needs the whole schema, with
 * its types, at compile time — and samble's schema is the union of what the
 * installed modules contribute, which is only known at runtime. A module that
 * wants it builds its own instance over the same connection:
 *
 *     const db = drizzle(this.db.$client as Pool, { schema: myTables });
 *
 * and then it sees exactly its own tables, which is the right scope anyway.
 * `db.select().from(table)` needs none of that and is fully typed as it is.
 */
// Conditional at the top, not `Transaction & {...}`: an intersection prints
// as `Database` in an error, and a declaration that is not one engine has to
// print as the name that explains it.
export type Database = [SelectedDialect] extends [never]
  ? DialectMustBeOneEngine
  : DatabaseOf[SelectedDialect] & {
      /** The driver's own client: a `pg` Pool, a `mysql2` pool, a libsql client. */
      readonly $client: unknown;
    };

/**
 * How to reach the database, when samble is the one connecting.
 *
 * The connection fields keep the names `pg` and `mysql2` both use, written out
 * instead of imported so samble's public types do not depend on any driver's
 * types being installed. The index signature keeps the rest of each driver's
 * options available: anything else here reaches the driver untouched.
 */
export interface DatabaseOptions {
  /** Which engine. Defaults to `postgres`. */
  dialect?: DialectName;
  /** `postgres://...` or `mysql://...`, instead of the separate fields. */
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | Record<string, unknown>;
  /** SQLite: `file:data/app.db`, `:memory:`, or a libsql server URL. */
  url?: string;
  /** SQLite through a libsql server: its token. */
  authToken?: string;
  /** Pool size, for the engines that pool. */
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  [key: string]: unknown;
}

/**
 * The rows of a statement, typed by the caller.
 *
 * Framework tables only: `_modules` and `_module_migrations`. Each engine hands
 * rows back in its own shape — `{ rows }` from `pg`, `[rows, fields]` from
 * `mysql2`, a result set from libsql — so the reading belongs to the dialect.
 * Application code reads through `db.select()`, which types itself from the
 * table and needs nothing from this file.
 */
export async function rows<T>(db: Transaction, query: SQL): Promise<T[]> {
  return dialectOf(db).rows<T>(db, query);
}

/** Runs a statement and discards whatever it answers. Framework tables only. */
export async function run(db: Transaction, query: SQL): Promise<void> {
  await dialectOf(db).run(db, query);
}

/** Whether a table exists in the schema the connection is pointed at. */
export async function tableExists(
  db: Transaction,
  name: string,
): Promise<boolean> {
  return dialectOf(db).tableExists(db, name);
}
