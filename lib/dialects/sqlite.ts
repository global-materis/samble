import { is, sql, type SQL } from 'drizzle-orm';
import {
  BaseSQLiteDatabase,
  SQLiteTable,
  SQLiteView,
} from 'drizzle-orm/sqlite-core';
import type {
  Database,
  DatabaseOptions,
  Transaction,
} from '../modules/database';
import {
  drizzleKit,
  requireDriver,
  type Dialect,
  type SchemaSnapshot,
} from './dialect';

interface SQLiteKit {
  generateSQLiteDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
  ) => Promise<SchemaSnapshot>;
  generateSQLiteMigration: (
    previous: SchemaSnapshot,
    current: SchemaSnapshot,
  ) => Promise<string[]>;
}

type Drizzle = (config: Record<string, unknown>) => Database;

type Async = BaseSQLiteDatabase<'async', any, any, any>;
const asSqlite = (db: Transaction) => db as unknown as Async;

/**
 * SQLite, over `@libsql/client`: a local file (`file:data/app.db`) or a libsql
 * server.
 *
 * libsql and not `better-sqlite3` because it is asynchronous: Drizzle's
 * `better-sqlite3` transactions are SYNCHRONOUS, and every transaction in
 * samble — a migration, `this.db.transaction(async ...)` in an endpoint — awaits
 * inside its callback.
 */
export const sqlite: Dialect = {
  name: 'sqlite',
  driver: '@libsql/client',

  open(options: DatabaseOptions, schema) {
    if (!options.url) {
      throw new Error(
        'The sqlite dialect needs a `url`: file:data/app.db for a local file, or a libsql server URL.',
      );
    }
    const { drizzle } = requireDriver<{ drizzle: Drizzle }>(
      'sqlite',
      '@libsql/client',
      'drizzle-orm/libsql',
    );
    return drizzle({
      connection: { url: options.url, authToken: options.authToken },
      schema,
    });
  },

  owns: (db) => is(db, BaseSQLiteDatabase),

  isSchemaObject: (value) => is(value, SQLiteTable) || is(value, SQLiteView),

  async run(db, query) {
    await asSqlite(db).run(query);
  },

  async rows<T>(db: Transaction, query: SQL) {
    return (await asSqlite(db).all(query)) as T[];
  },

  async tableExists(db, name) {
    const found = await this.rows<{ total: number }>(
      db,
      sql`select count(*) as total from sqlite_master
            where type = 'table' and name = ${name}`,
    );
    return Number(found[0]?.total ?? 0) > 0;
  },

  modulesTable: [
    sql`
      create table if not exists _modules (
        id text primary key,
        installed_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      )
    `,
  ],

  migrationsTable: [
    sql`
      create table if not exists _module_migrations (
        module text not null,
        name text not null,
        "ranAt" text not null default current_timestamp,
        primary key (module, name)
      )
    `,
  ],

  // Drizzle's SQLite database has no `execute`: a statement is `run`.
  statementMethod: 'run',

  emptySnapshot: () => drizzleKit<SQLiteKit>().generateSQLiteDrizzleJson({}),

  snapshot: (schema, previousId) =>
    drizzleKit<SQLiteKit>().generateSQLiteDrizzleJson(schema, previousId),

  diff: (previous, current) =>
    drizzleKit<SQLiteKit>().generateSQLiteMigration(previous, current),

  // Not yet: Drizzle Kit's push for this engine compares the WHOLE database and
  // takes no table filter, so it would report samble's own `_modules` and
  // `_module_migrations` — and any other table living there — as drift, or
  // stop to ask whether they were renamed. Refused rather than answered wrong.
  async drift() {
    throw new Error(
      'Comparing the live schema is not available on sqlite yet: Drizzle Kit cannot limit that comparison to the tables of the modules on this engine. Generating migrations works; only --check / schemaDrift() does not.',
    );
  },

  // In memory: nothing on disk, nothing to clean up, and gone when closed.
  // Checked rather than assumed: libsql keeps `:memory:` shared between the
  // client and its transactions (a migration and the endpoint after it see the
  // same tables), and a temporary FILE could not be used instead — on Windows
  // libsql keeps the file locked after `close()`, so it could never be deleted.
  async openTest(schema) {
    return this.open({ dialect: 'sqlite', url: ':memory:' }, schema);
  },

  async closeTest(db) {
    (db.$client as { close: () => void }).close();
  },
};
