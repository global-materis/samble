import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

/**
 * How to reach the database, when samble is the one connecting.
 *
 * These are `pg`'s pool options, written out instead of imported so samble's
 * public types do not depend on `@types/pg` being installed in the consumer's
 * project. The index signature is what keeps the rest of them available:
 * anything else here reaches the driver untouched.
 */
export interface DatabaseOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | Record<string, unknown>;
  /** Pool size. */
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  [key: string]: unknown;
}

/**
 * A connection that is inside a transaction, which is all a migration gets.
 *
 * Drizzle's transaction object extends its database, so this is the database
 * minus the one thing a transaction has no business handing out: the client
 * behind it, which is how you would start a SECOND connection and step outside
 * the transaction you were given.
 */
/* The three type arguments are the driver's result kind and the SCHEMA, and
   samble is agnostic about all three on purpose. Naming the schema would mean a
   connection built with tables is a different type from one built without, and
   samble would accept only one of them. `any` here costs nothing that matters:
   the schema generic only types the relational api (`db.query.users`), which
   samble cannot offer anyway, while `db.select().from(table)` takes its types
   from the TABLE and stays exact. Measured, not assumed. */
export type Transaction = PgDatabase<any, any, any>;

/**
 * The database, as everything in samble sees it.
 *
 * Driver-agnostic on purpose, and not `NodePgDatabase`: the driver-specific
 * types differ only in what `execute()` hands back, and naming one of them here
 * would mean the framework only ran on that driver. The suite
 * runs on PGlite and an application runs on `pg`; both are this type, and a
 * caller may hand over an instance built over anything else Drizzle supports.
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
  /** The driver's own client: a `pg` Pool, a PGlite instance, a socket. */
  readonly $client: unknown;
};

/**
 * The rows of a statement, typed by the caller.
 *
 * The cast is the point of this function. `execute()` is typed through the
 * driver's result kind, and the driver-agnostic type samble uses leaves that
 * `unknown` — correctly, because `pg` answers with `{ rows, rowCount, fields }`
 * and another driver answers with something else. Every caller here wants the
 * rows, so the assertion is written once, here, instead of at each of them.
 *
 * Framework tables only: `_modules` and `_module_migrations`. Application code
 * reads through `db.select()`, which types itself from the table and needs
 * nothing from this file.
 */
export async function rows<T>(db: Transaction, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as { rows: T[] };
  return result.rows;
}

/**
 * Whether a table exists in the schema the connection is pointed at.
 *
 * `current_schema()` and not `'public'`: an application that puts samble's
 * tables in a schema of its own sets `search_path`, and asking about the wrong
 * schema would answer "no" and then fail creating what is already there.
 */
export async function tableExists(
  db: Transaction,
  name: string,
): Promise<boolean> {
  const found = await rows<{ exists: boolean }>(
    db,
    // `to_regclass` resolves through search_path and answers null instead of
    // throwing for a name that is not there.
    sql`select to_regclass(${name}) is not null as exists`,
  );

  return found[0]?.exists === true;
}
