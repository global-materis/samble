import { collectModuleTables } from './collect-tables';
import { Database } from './database';
import { closeClient } from './open-database';
import type { ResolvedModule } from './module-manifest';

/**
 * A real Postgres for an application's tests, inside the process: PGlite, with
 * no server, no Docker and no `.env`.
 *
 * Hand it to `createApp({ db })` — the shape `samble init` writes — and the
 * test runs the same boot a deployment does: `_modules`, every module's
 * migrations, contracts, routes and the auth resolver.
 * Only the connection differs. That is the point: a suite that replaces the
 * database with mocks proves the mocks.
 *
 * Postgres because samble is Postgres-only (see `Database`), and because the
 * dialect is the thing under test — enums,
 * `timestamptz`, partial indexes and DDL inside a transaction behave here the
 * way they will in production.
 *
 * Each call is a FRESH, empty database, so a test file that needs isolation
 * opens one in `beforeAll`. Close it with {@link closeTestDatabase}: samble does
 * not close a connection it did not open.
 *
 * `@electric-sql/pglite` is an optional peer, required lazily, so an
 * application only installs it as a dev dependency. PGlite loads its WASM with
 * a dynamic import, which under jest needs `--experimental-vm-modules`; the
 * `test` script `samble init` writes passes it.
 *
 * @param modules Passed to the connection's schema. Optional: queries built
 * from a table object carry the table with them, and migrations are SQL. What
 * reads it is the schema diff (`pendingSchema`, `schemaDrift`).
 */
export async function openTestDatabase(
  modules: ResolvedModule[] = [],
): Promise<Database> {
  /* eslint-disable @typescript-eslint/no-require-imports --
     Optional peers, required lazily: see above. */
  const { PGlite } = require('@electric-sql/pglite') as {
    PGlite: new () => { waitReady: Promise<void> };
  };
  const { drizzle } = require('drizzle-orm/pglite') as {
    drizzle: (client: unknown, config: Record<string, unknown>) => Database;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */

  // Ready before it is handed over: PGlite loads its WASM in the background,
  // and a test that failed before its first query would otherwise close it
  // mid-load, after jest has already torn the environment down.
  const client = new PGlite();
  await client.waitReady;
  return drizzle(client, { schema: collectModuleTables(modules) });
}

/** Closes what {@link openTestDatabase} opened. */
export async function closeTestDatabase(db: Database): Promise<void> {
  await closeClient(db.$client);
}
