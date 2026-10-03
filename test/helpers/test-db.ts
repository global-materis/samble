import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from '../../lib';

/**
 * A real Postgres for tests, running inside the process: PGlite, no Docker and
 * no server. Dialect differences that SQLite would hide — schemas, timestamptz,
 * enums, DDL in transactions — behave the way they will in production.
 *
 * ONE PGlite per test file. Jest gives each file its own module registry, so
 * this module-level client is created once per file and shared by every
 * `createTestDb()` in it: booting PGlite costs a couple of seconds and dropping
 * the schema costs milliseconds.
 */
let client: PGlite | null = null;
let current: Database | null = null;

/**
 * @param schema What the connection knows about, normally
 * `collectModuleTables([...])`. Empty is fine: samble's own bookkeeping is
 * plain SQL, and a query built from a table object carries the table with it.
 */
export async function createTestDb(
  schema: Record<string, unknown> = {},
): Promise<Database> {
  client ??= new PGlite();

  const db = drizzle(client, { schema });
  await resetSchema(db);

  current = db;
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (client) await client.close();
  client = null;
  current = null;
}

/** The connection the file is using, for a helper that does not receive it. */
export function testDb(): Database {
  if (!current) throw new Error('createTestDb() has not run in this file.');
  return current;
}

/**
 * Empties the database without tearing down the connection.
 *
 * Create the database once per test file and reset between cases — same
 * isolation, a fraction of the time.
 */
export async function resetSchema(db: Database): Promise<void> {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`create schema public`);
}

/**
 * Raw SQL, for a test that is checking the database and not the query builder.
 *
 * `sql.raw` because the text is written in the test, not composed from input:
 * this is where a suite asserts what a migration left behind, and building that
 * assertion through the builder would test the builder.
 */
export async function query<T = Record<string, unknown>>(
  db: Database,
  text: string,
): Promise<T[]> {
  const result = (await db.execute(sql.raw(text))) as { rows: T[] };
  return result.rows;
}

/** Table names in the public schema, for asserting what a migration created. */
export async function tableNames(db: Database): Promise<string[]> {
  const result = (await db.execute(sql`
    select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
  `)) as { rows: Array<{ table_name: string }> };

  return result.rows.map((row) => row.table_name);
}
