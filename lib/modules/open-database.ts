import { Database, DatabaseOptions } from './database';
import { collectModuleTables } from './collect-tables';
import type { ResolvedModule } from './module-manifest';

/**
 * Tells a live connection from the options to open one.
 *
 * Structural, not `instanceof`: the instance may come from any of Drizzle's
 * drivers, and an application that built one over `pg` and one over PGlite
 * would fail an identity check against whichever class samble happened to name.
 * `execute` and `transaction` are what samble actually uses.
 */
export function isDatabase(
  value: DatabaseOptions | Database,
): value is Database {
  const candidate = value as Partial<Database>;
  return (
    typeof candidate.execute === 'function' &&
    typeof candidate.transaction === 'function'
  );
}

/**
 * Opens the connection samble owns, with every module's tables in its schema.
 *
 * `drizzle-orm/node-postgres` is required HERE and not imported at the top,
 * because requiring it pulls in `pg`. An application that hands samble a
 * connection of its own — PGlite in a test suite, a serverless driver, a socket
 * — never reaches this function, and must not be made to install a driver it
 * does not use.
 *
 * The schema is passed even though samble's own type erases it: Drizzle needs it
 * to resolve a table reference back to a name, and `pushSchema` reads it to
 * work out what the database is missing.
 */
export function openDatabase(
  options: DatabaseOptions,
  modules: ResolvedModule[],
): Database {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports --
     Lazy on purpose: see above. */
  const { drizzle } = require('drizzle-orm/node-postgres') as {
    drizzle: (config: Record<string, unknown>) => Database;
  };

  return drizzle({
    connection: options,
    schema: collectModuleTables(modules),
  });
}

/**
 * Closes whatever the driver put behind the connection.
 *
 * Every driver names this differently — a `pg` pool ends, a PGlite instance
 * closes — and Drizzle's own type says nothing about the client at all. Asking
 * the object what it can do is the only thing that works across drivers, and a
 * client that can do neither is one samble has no business closing.
 */
export async function closeClient(client: unknown): Promise<void> {
  const candidate = client as {
    end?: () => Promise<void> | void;
    close?: () => Promise<void> | void;
  };

  if (typeof candidate?.end === 'function') {
    await candidate.end();
    return;
  }
  if (typeof candidate?.close === 'function') {
    await candidate.close();
  }
}
