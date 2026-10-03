import { getTableName, is, Table } from 'drizzle-orm';
import type { Dialect, SchemaSnapshot } from '../dialects';
import type { Database } from './database';
import type { ModuleTable, ResolvedModule } from './module-manifest';

export type { SchemaSnapshot } from '../dialects';

/**
 * What a module's tables are missing from the database, as SQL.
 *
 * This is Drizzle Kit's own work: it knows how to compare two descriptions of a
 * schema and emit the statements that close the gap, per engine. samble only
 * decides WHAT to compare and where the answer is written.
 */
export interface SchemaDiff {
  /** Statements that bring the database up to the tables. */
  up: string[];
  /** Statements that undo them, in the order they must run. */
  down: string[];
}

/**
 * One module's tables as the record Drizzle takes.
 *
 * Keyed by position: Drizzle reads each table's name out of the object itself,
 * so these keys are never SQL and inventing names for them would only create
 * something else to get wrong.
 */
const asSchema = (tables: ModuleTable[]): Record<string, unknown> =>
  Object.fromEntries(tables.map((table, index) => [String(index), table]));

/** The snapshot of a schema with nothing in it, for a module's first migration. */
export function emptySnapshot(dialect: Dialect): Promise<SchemaSnapshot> {
  return dialect.emptySnapshot();
}

/**
 * What this module's tables describe right now.
 *
 * `previous` chains the snapshots: each one records the id of the one it
 * followed, which is how Drizzle Kit can tell a history from a pile of files.
 */
export function moduleSnapshot(
  dialect: Dialect,
  mod: ResolvedModule,
  previous?: SchemaSnapshot,
): Promise<SchemaSnapshot> {
  return dialect.snapshot(
    asSchema(mod.tables),
    previous?.id as string | undefined,
  );
}

/**
 * The statements between two snapshots, both ways.
 *
 * `down` is the same question asked backwards, which is why it is trustworthy
 * in the same measure the `up` is — and why neither can tell a rename from a
 * drop plus an add.
 */
export async function diffSnapshots(
  dialect: Dialect,
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
): Promise<SchemaDiff> {
  return {
    up: await dialect.diff(previous, current),
    down: await dialect.diff(current, previous),
  };
}

/**
 * What the LIVE database is missing to match every module's tables.
 *
 * Not how migrations are generated — that is the snapshots, which need no
 * database and answer per module. This is the other question: has the schema
 * drifted from the code? A migration applied by hand, a column dropped in a
 * console, a snapshot that was never committed all show up here and nowhere
 * else.
 *
 * Reads the schema and changes nothing.
 */
export async function liveDrift(
  dialect: Dialect,
  db: Database,
  modules: ResolvedModule[],
): Promise<string[]> {
  const tables = modules.flatMap((mod) => mod.tables);
  return dialect.drift(asSchema(tables), db);
}

/**
 * Which module owns each table, from the tables each one declares.
 *
 * Pure, and needing no connection: a table carries its own name, so this is
 * answerable from the code alone. It is what lets a report about the schema say
 * which module a name belongs to.
 *
 * Only real tables, of any engine: an enum or a sequence has no name to key on
 * here, and nothing asks this question about them.
 */
export function tableOwners(modules: ResolvedModule[]): Map<string, string> {
  const owners = new Map<string, string>();

  for (const mod of modules) {
    for (const table of mod.tables) {
      if (is(table, Table)) owners.set(getTableName(table), mod.id);
    }
  }

  return owners;
}
