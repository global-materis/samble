import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { Database } from './database';
import type { ModuleTable, ResolvedModule } from './module-manifest';

/**
 * What a module's tables are missing from the database, as SQL.
 *
 * This is Drizzle Kit's own work: it knows how to compare two descriptions of a
 * schema and emit the statements that close the gap. samble only decides WHAT to
 * compare and where the answer is written.
 */
export interface SchemaDiff {
  /** Statements that bring the database up to the tables. */
  up: string[];
  /** Statements that undo them, in the order they must run. */
  down: string[];
}

/**
 * A description of one module's schema at a point in time.
 *
 * Opaque on purpose: the shape is Drizzle Kit's, it is versioned by Drizzle Kit,
 * and samble writes it to a file and hands it back unread. Reaching into it here
 * would make samble's own code depend on a format it does not own.
 */
export type SchemaSnapshot = Record<string, unknown>;

/**
 * Drizzle Kit, loaded when it is needed and not before.
 *
 * It is an OPTIONAL peer: it pulls in `esbuild` and `tsx`, and only
 * `samble migration:generate` needs it. An application that runs migrations
 * someone else generated — which is every deploy — must not be made to install
 * a build toolchain to do it.
 */
interface DrizzleKit {
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
  ) => Promise<{ statementsToExecute: string[]; warnings: string[] }>;
}

const kit = (): DrizzleKit => {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports --
       Optional peer: see above. */
    return require('drizzle-kit/api') as DrizzleKit;
  } catch {
    throw new Error(
      'drizzle-kit is needed to compare schemas, and it is not installed. ' +
        'Add it as a dev dependency: npm install --save-dev drizzle-kit',
    );
  }
};

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
export function emptySnapshot(): SchemaSnapshot {
  return kit().generateDrizzleJson({});
}

/**
 * What this module's tables describe right now.
 *
 * `previous` chains the snapshots: each one records the id of the one it
 * followed, which is how Drizzle Kit can tell a history from a pile of files.
 */
export function moduleSnapshot(
  mod: ResolvedModule,
  previous?: SchemaSnapshot,
): SchemaSnapshot {
  return kit().generateDrizzleJson(
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
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
): Promise<SchemaDiff> {
  const { generateMigration } = kit();

  return {
    up: await generateMigration(previous, current),
    down: await generateMigration(current, previous),
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
  db: Database,
  modules: ResolvedModule[],
): Promise<string[]> {
  const tables = modules.flatMap((mod) => mod.tables);
  const { pushSchema } = kit();

  const { statementsToExecute } = await pushSchema(asSchema(tables), db);
  return statementsToExecute;
}

/**
 * Which module owns each table, from the tables each one declares.
 *
 * Pure, and needing no connection: a table carries its own name, so this is
 * answerable from the code alone. It is what lets a report about the schema say
 * which module a name belongs to.
 *
 * Only real tables: an enum or a sequence has no name to key on here, and
 * nothing asks this question about them.
 */
export function tableOwners(modules: ResolvedModule[]): Map<string, string> {
  const owners = new Map<string, string>();

  for (const mod of modules) {
    for (const table of mod.tables) {
      if (is(table, PgTable)) owners.set(getTableName(table), mod.id);
    }
  }

  return owners;
}
