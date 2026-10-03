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
   * `samble init` writes the declaration in `src/config/database.ts`:
   *
   * ```typescript
   * declare global {
   *   namespace SambleDatabase {
   *     interface Config {
   *       dialect: 'mysql';
   *     }
   *   }
   * }
   * ```
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

/** The dialect this application declared, `postgres` when it declared none. */
export type SelectedDialect = SambleDatabase.Config extends {
  dialect: infer D extends DialectName;
}
  ? D
  : 'postgres';

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
export type Transaction = DatabaseOf[SelectedDialect];

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
export type Database = Transaction & {
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
