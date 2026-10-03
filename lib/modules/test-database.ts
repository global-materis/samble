import { dialectNamed, dialectOf } from '../dialects';
import { collectModuleTables } from './collect-tables';
import type { Database, DialectName } from './database';
import type { ResolvedModule } from './module-manifest';

/** What {@link openTestDatabase} takes. */
export interface TestDatabaseOptions {
  /** The engine the application runs on. Defaults to `postgres`. */
  dialect?: DialectName;
  /**
   * Passed to the connection's schema. Optional: queries built from a table
   * object carry the table with them, and migrations are SQL. What reads it is
   * the schema diff (`pendingSchema`, `schemaDrift`).
   */
  modules?: ResolvedModule[];
}

/**
 * A real, fresh, empty database of the application's engine, for a test.
 *
 * Hand it to `createApp(db)` — the shape `samble init` writes — and the
 * test runs the same boot a deployment does: `_modules`, every module's
 * migrations, contracts, routes and the auth resolver. Only the connection
 * differs. That is the point: a suite that replaces the database with mocks
 * proves the mocks. The dialect matters for the same reason — enums,
 * timestamps, partial indexes and DDL inside a transaction behave here the way
 * they will in production.
 *
 * Per engine:
 * - **postgres**: PGlite, a Postgres inside the process (`@electric-sql/pglite`,
 *   a dev dependency). Under jest it needs `--experimental-vm-modules`, which
 *   the `test` script `samble init` writes passes.
 * - **sqlite**: in memory, gone when closed.
 * - **mysql**: there is no MySQL inside the process, so it needs a server —
 *   `SAMBLE_TEST_MYSQL_URL` — and creates a database of its own there, dropped
 *   on close.
 *
 * Each call is a fresh database, so a test file that needs isolation opens one
 * in `beforeAll`. Close it with {@link closeTestDatabase}: samble does not close
 * a connection it did not open.
 */
export async function openTestDatabase(
  options: TestDatabaseOptions = {},
): Promise<Database> {
  return dialectNamed(options.dialect ?? 'postgres').openTest(
    collectModuleTables(options.modules ?? []),
  );
}

/** Closes what {@link openTestDatabase} opened, and discards the database. */
export async function closeTestDatabase(db: Database): Promise<void> {
  await dialectOf(db).closeTest(db);
}
