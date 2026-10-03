import { getTableName, is, sql, Table, type SQL } from 'drizzle-orm';
import {
  isPgEnum,
  isPgMaterializedView,
  isPgSchema,
  isPgSequence,
  isPgView,
  PgDatabase,
  PgTable,
} from 'drizzle-orm/pg-core';
import type {
  Database,
  DatabaseOptions,
  Transaction,
} from '../modules/database';
import {
  driverOptions,
  drizzleKit,
  requireDriver,
  withoutExit,
  type Dialect,
  type SchemaSnapshot,
} from './dialect';

interface PgKit {
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
  ) => SchemaSnapshot;
  generateMigration: (
    previous: SchemaSnapshot,
    current: SchemaSnapshot,
  ) => Promise<string[]>;
  pushSchema: (
    imports: Record<string, unknown>,
    db: unknown,
    schemaFilters?: string[],
    tablesFilter?: string[],
  ) => Promise<{ statementsToExecute: string[] }>;
}

type Drizzle = (config: Record<string, unknown>) => Database;
type DrizzleOver = (
  client: unknown,
  config: Record<string, unknown>,
) => Database;

const execute = (db: Transaction, query: SQL) =>
  (db as unknown as PgDatabase<any, any, any>).execute(query);

/**
 * PostgreSQL, over `pg` — and PGlite in tests, which is the same dialect in
 * process.
 */
export const postgres: Dialect = {
  name: 'postgres',
  driver: 'pg',

  open(options: DatabaseOptions, schema) {
    const { drizzle } = requireDriver<{ drizzle: Drizzle }>(
      'postgres',
      'pg',
      'drizzle-orm/node-postgres',
    );
    return drizzle({ connection: driverOptions(options), schema });
  },

  owns: (db) => is(db, PgDatabase),

  // Six kinds, not one. A table with an ENUM column emits DDL that REFERENCES
  // the type, so a schema without the enum generates a migration that fails
  // when it runs. Views, sequences and schemas are here for the same reason.
  isSchemaObject: (value) =>
    is(value, PgTable) ||
    isPgEnum(value) ||
    isPgSequence(value) ||
    isPgView(value) ||
    isPgMaterializedView(value) ||
    isPgSchema(value),

  async run(db, query) {
    await execute(db, query);
  },

  async rows<T>(db: Transaction, query: SQL) {
    const result = (await execute(db, query)) as unknown as { rows: T[] };
    return result.rows;
  },

  async tableExists(db, name) {
    // `to_regclass` resolves through search_path — an application that puts
    // samble's tables in a schema of its own is asked about the right one —
    // and answers null instead of throwing for a name that is not there.
    const found = await this.rows<{ exists: boolean }>(
      db,
      sql`select to_regclass(${name}) is not null as exists`,
    );
    return found[0]?.exists === true;
  },

  modulesTable: [
    sql`
      create table if not exists _modules (
        id varchar(100) primary key,
        installed_at timestamp with time zone not null default now(),
        updated_at timestamp with time zone not null default now()
      )
    `,
    // An installation created before modules lost their version has a
    // `version` column that is `not null` with no default, so leaving it would
    // make the insert of the next module fail — and the failure would arrive
    // on a deploy, not on the upgrade. Only Postgres installations predate it.
    sql`alter table _modules drop column if exists version`,
  ],

  // `"ranAt"` stays quoted and camelCased: an installation that already has
  // this table got it under that name, and renaming a column samble never
  // reads would be churn with a migration attached.
  migrationsTable: [
    sql`
      create table if not exists _module_migrations (
        module varchar(100) not null,
        name varchar(255) not null,
        "ranAt" timestamp with time zone not null default now(),
        primary key (module, name)
      )
    `,
  ],

  statementMethod: 'execute',

  async emptySnapshot() {
    return drizzleKit<PgKit>().generateDrizzleJson({});
  },

  async snapshot(schema, previousId) {
    return drizzleKit<PgKit>().generateDrizzleJson(schema, previousId);
  },

  diff: (previous, current) =>
    drizzleKit<PgKit>().generateMigration(previous, current),

  // Limited to the modules' own tables. Without the filter Drizzle Kit
  // compares the WHOLE database: samble's `_modules` and `_module_migrations`,
  // a session store's table, anything else living there — and either reports
  // them as drift to drop or stops to ask whether they were renamed.
  async drift(schema, db) {
    const tables = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableName(table as Table));
    const { statementsToExecute } = await withoutExit(() =>
      drizzleKit<PgKit>().pushSchema(schema, db, undefined, tables),
    );
    return statementsToExecute;
  },

  // PGlite: a real Postgres in WASM, inside the process. No server, no Docker
  // and no `.env`. It loads its WASM with a dynamic import, which under jest
  // needs `--experimental-vm-modules`.
  async openTest(schema) {
    const { PGlite } = requireDriver<{
      PGlite: new () => { waitReady: Promise<void> };
    }>('postgres', '@electric-sql/pglite', '@electric-sql/pglite');
    const { drizzle } = requireDriver<{ drizzle: DrizzleOver }>(
      'postgres',
      '@electric-sql/pglite',
      'drizzle-orm/pglite',
    );
    // Ready before it is handed over: PGlite loads its WASM in the background,
    // and a test that failed before its first query would otherwise close it
    // mid-load, after jest has already torn the environment down.
    const client = new PGlite();
    await client.waitReady;
    return drizzle(client, { schema });
  },

  async closeTest(db) {
    await (db.$client as { close: () => Promise<void> }).close();
  },
};
