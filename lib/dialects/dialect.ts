import type { SQL } from 'drizzle-orm';
import type {
  Database,
  DatabaseOptions,
  DialectName,
  Transaction,
} from '../modules/database';

/**
 * A description of one module's schema at a point in time.
 *
 * Opaque on purpose: the shape is Drizzle Kit's, it is versioned by Drizzle Kit
 * and it differs per engine. samble writes it to a file and hands it back
 * unread; reaching into it would make samble depend on a format it does not
 * own.
 */
export type SchemaSnapshot = Record<string, unknown>;

/**
 * Everything samble does that depends on the database engine, in one place.
 *
 * The rest of the framework talks to a `Dialect` and never to an engine, which
 * is what lets the operator choose Postgres, MySQL or SQLite without the
 * framework choosing for them. Each dialect requires its driver LAZILY: an
 * application installs the driver of the engine it runs and nothing else.
 *
 * Adding an engine is writing one of these. If a new one needs something this
 * interface does not say, the interface grows — samble code outside
 * `lib/dialects/` must never branch on the engine's name.
 */
export interface Dialect {
  readonly name: DialectName;

  /** The npm package an application installs to run on this engine. */
  readonly driver: string;

  /**
   * Opens the connection samble owns, with every module's tables in its
   * schema.
   */
  open(options: DatabaseOptions, schema: Record<string, unknown>): Database;

  /** Whether a connection (or a transaction) was built for this engine. */
  owns(db: unknown): boolean;

  /**
   * Whether a module export is a schema object of THIS engine: a table, and
   * whatever else the schema generator has to see (Postgres enums, views...).
   */
  isSchemaObject(value: unknown): boolean;

  /** Runs a statement and discards what it answers. */
  run(db: Transaction, query: SQL): Promise<void>;

  /** Runs a query and returns its rows. */
  rows<T>(db: Transaction, query: SQL): Promise<T[]>;

  /** Whether a table exists where the connection points. */
  tableExists(db: Transaction, name: string): Promise<boolean>;

  /**
   * The statements that create `_modules`, idempotent: `if not exists`, so a
   * second boot does nothing.
   */
  readonly modulesTable: SQL[];

  /** The same for `_module_migrations`, the ledger of what ran. */
  readonly migrationsTable: SQL[];

  /**
   * How a migration file runs one raw statement on this engine — `execute`,
   * except on SQLite, where Drizzle calls it `run`. What the generated
   * migrations are written with.
   */
  readonly statementMethod: 'execute' | 'run';

  /** Drizzle Kit's schema functions for this engine. */
  emptySnapshot(): Promise<SchemaSnapshot>;
  snapshot(
    schema: Record<string, unknown>,
    previousId?: string,
  ): Promise<SchemaSnapshot>;
  diff(previous: SchemaSnapshot, current: SchemaSnapshot): Promise<string[]>;
  /** What the LIVE database lacks to match `schema`. Reads, changes nothing. */
  drift(schema: Record<string, unknown>, db: Database): Promise<string[]>;

  /**
   * A fresh, empty database for a test. In-process where the engine allows it;
   * see each dialect for where it is not.
   */
  openTest(schema: Record<string, unknown>): Promise<Database>;
  /** Closes what `openTest` opened, and discards it. */
  closeTest(db: Database): Promise<void>;
}

/**
 * Drizzle Kit, loaded when it is needed and not before.
 *
 * It is an OPTIONAL peer: it pulls in `esbuild` and `tsx`, and only
 * `samble migration:generate` needs it. An application that runs migrations
 * someone else generated — which is every deploy — must not be made to install
 * a build toolchain to do it.
 */
export function drizzleKit<T>(): T {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports --
       Optional peer: see above. */
    return require('drizzle-kit/api') as T;
  } catch {
    throw new Error(
      'drizzle-kit is needed to compare schemas, and it is not installed. ' +
        'Add it as a dev dependency: npm install --save-dev drizzle-kit',
    );
  }
}

/** The options as the driver takes them: `dialect` is samble's, not its. */
export function driverOptions(
  options: DatabaseOptions,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...options };
  delete rest.dialect;
  return rest;
}

/**
 * Runs Drizzle Kit's live-schema comparison without letting it end the
 * process.
 *
 * When it meets something it cannot decide alone — is this table new, or a
 * renamed one? — it asks on the terminal, and with no terminal, or when its
 * introspection fails, it calls `process.exit(1)` from inside the library.
 * That would take the whole application down from `samble migrate:status
 * --check` or from `schemaDrift()` in a test, with nothing logged. Here the
 * exit becomes an error the caller can read, and the real `exit` is restored
 * whatever happens.
 */
export async function withoutExit<T>(work: () => Promise<T>): Promise<T> {
  const exit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(
      `drizzle-kit stopped while comparing the live schema (exit ${code ?? 0}). It does that when it needs an interactive answer — a table that may have been renamed — or cannot read a table. Run it where it can ask, or compare by generating a migration instead.`,
    );
  }) as typeof process.exit;
  try {
    return await work();
  } finally {
    process.exit = exit;
  }
}

/**
 * Drizzle's module for a driver, required when the dialect is used and not
 * before.
 *
 * The driver is checked FIRST and by name: Drizzle's module requires it inside,
 * and "Cannot find module 'mysql2'" thrown from samble reads like samble's bug.
 */
export function requireDriver<T>(
  dialect: DialectName,
  driver: string,
  drizzleModule: string,
): T {
  try {
    require.resolve(driver);
  } catch {
    throw new Error(
      `The ${dialect} dialect needs "${driver}", and it is not installed: npm install ${driver}`,
    );
  }
  /* eslint-disable-next-line @typescript-eslint/no-require-imports --
     Optional peers, loaded per engine. */
  return require(drizzleModule) as T;
}
