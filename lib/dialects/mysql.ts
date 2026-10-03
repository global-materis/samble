import { randomBytes } from 'crypto';
import { is, sql, type SQL } from 'drizzle-orm';
import { MySqlDatabase, MySqlTable, MySqlView } from 'drizzle-orm/mysql-core';
import type {
  Database,
  DatabaseOptions,
  Transaction,
} from '../modules/database';
import {
  driverOptions,
  drizzleKit,
  requireDriver,
  type Dialect,
  type SchemaSnapshot,
} from './dialect';

interface MySqlKit {
  generateMySQLDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
  ) => Promise<SchemaSnapshot>;
  generateMySQLMigration: (
    previous: SchemaSnapshot,
    current: SchemaSnapshot,
  ) => Promise<string[]>;
}

type Drizzle = (config: Record<string, unknown>) => Database;

interface AdminConnection {
  query: (statement: string) => Promise<unknown>;
  end: () => Promise<void>;
}

const execute = (db: Transaction, query: SQL) =>
  (db as unknown as MySqlDatabase<any, any, any, any>).execute(query);

/** `mysql://user:pass@host:port` as the fields `mysql2` takes. */
function connectionFrom(url: string): Record<string, unknown> {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

/** What `openTest` created, so `closeTest` can drop exactly that. */
const testDatabases = new WeakMap<
  object,
  { name: string; admin: AdminConnection }
>();

/**
 * MySQL and MariaDB, over `mysql2`.
 *
 * WORTH KNOWING: MySQL commits every DDL statement the moment it runs, inside a
 * transaction or not. A migration that creates two tables and fails on the
 * second leaves the first one behind, and it is NOT recorded as applied — so
 * the next run fails on "already exists". Postgres and SQLite roll the whole
 * migration back. Keep MySQL migrations to one DDL statement where it matters,
 * or write them to be re-runnable (`if not exists`).
 */
export const mysql: Dialect = {
  name: 'mysql',
  driver: 'mysql2',

  open(options: DatabaseOptions, schema) {
    const { connectionString, max, ...connection } = driverOptions(options);
    const { drizzle } = requireDriver<{ drizzle: Drizzle }>(
      'mysql',
      'mysql2',
      'drizzle-orm/mysql2',
    );
    return drizzle({
      connection: {
        ...(connectionString ? { uri: connectionString } : {}),
        ...(max ? { connectionLimit: max } : {}),
        ...connection,
      },
      schema,
      // Required by Drizzle whenever a schema is passed. `planetscale` is the
      // other value, for that service only.
      mode: 'default',
    });
  },

  owns: (db) => is(db, MySqlDatabase),

  // No enums to collect here: in MySQL an enum is a column type, not an object
  // of the schema, so the table carries it.
  isSchemaObject: (value) => is(value, MySqlTable) || is(value, MySqlView),

  async run(db, query) {
    await execute(db, query);
  },

  // `mysql2` answers `[rows, fields]`.
  async rows<T>(db: Transaction, query: SQL) {
    const [found] = (await execute(db, query)) as unknown as [T[], unknown];
    return found;
  },

  async tableExists(db, name) {
    const found = await this.rows<{ total: number | string }>(
      db,
      sql`select count(*) as total from information_schema.tables
            where table_schema = database() and table_name = ${name}`,
    );
    return Number(found[0]?.total ?? 0) > 0;
  },

  modulesTable: [
    sql`
      create table if not exists _modules (
        id varchar(100) primary key,
        installed_at timestamp not null default current_timestamp,
        updated_at timestamp not null default current_timestamp
      )
    `,
  ],

  migrationsTable: [
    sql`
      create table if not exists _module_migrations (
        module varchar(100) not null,
        name varchar(255) not null,
        ranAt timestamp not null default current_timestamp,
        primary key (module, name)
      )
    `,
  ],

  statementMethod: 'execute',

  emptySnapshot: () => drizzleKit<MySqlKit>().generateMySQLDrizzleJson({}),

  snapshot: (schema, previousId) =>
    drizzleKit<MySqlKit>().generateMySQLDrizzleJson(schema, previousId),

  diff: (previous, current) =>
    drizzleKit<MySqlKit>().generateMySQLMigration(previous, current),

  // Not yet: Drizzle Kit's push for this engine compares the WHOLE database and
  // takes no table filter, so it would report samble's own `_modules` and
  // `_module_migrations` — and any other table living there — as drift, or
  // stop to ask whether they were renamed. Refused rather than answered wrong.
  async drift() {
    throw new Error(
      'Comparing the live schema is not available on mysql yet: Drizzle Kit cannot limit that comparison to the tables of the modules on this engine. Generating migrations works; only --check / schemaDrift() does not.',
    );
  },

  /**
   * There is no MySQL inside the process, so a test needs a server:
   * `SAMBLE_TEST_MYSQL_URL` (`mysql://root@localhost:3306`), with an account
   * allowed to create databases. Each call creates a database of its own
   * (`samble_test_<random>`) and `closeTest` drops it, so tests running in
   * parallel never see each other and nothing that was already on the server
   * is touched.
   */
  async openTest(schema) {
    const url = process.env.SAMBLE_TEST_MYSQL_URL;
    if (!url) {
      throw new Error(
        'A MySQL test database needs a server: set SAMBLE_TEST_MYSQL_URL (for example mysql://root@localhost:3306) to an account that may create databases. Each test gets a database of its own, dropped when it closes.',
      );
    }

    const promise = requireDriver<{
      createConnection: (
        config: Record<string, unknown>,
      ) => Promise<AdminConnection>;
    }>('mysql', 'mysql2', 'mysql2/promise');
    const server = connectionFrom(url);
    const name = `samble_test_${randomBytes(6).toString('hex')}`;

    const admin = await promise.createConnection(server);
    await admin.query(`create database \`${name}\``);

    const db = this.open(
      { dialect: 'mysql', ...server, database: name },
      schema,
    );
    testDatabases.set(db, { name, admin });
    return db;
  },

  async closeTest(db) {
    await (db.$client as { end: () => Promise<void> }).end();
    const created = testDatabases.get(db);
    if (!created) return;
    testDatabases.delete(db);
    await created.admin.query(`drop database if exists \`${created.name}\``);
    await created.admin.end();
  },
};
