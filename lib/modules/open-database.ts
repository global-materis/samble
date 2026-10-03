import { detectDialect, dialectNamed } from '../dialects';
import { Database, DatabaseOptions } from './database';
import { collectModuleTables } from './collect-tables';
import type { ResolvedModule } from './module-manifest';

/**
 * Tells a live connection from the options to open one.
 *
 * By asking the dialects, not by `instanceof`: Drizzle's `is()` compares an
 * entity kind, so it holds when the application and samble resolve different
 * copies of `drizzle-orm`, and it recognizes a connection built over any driver
 * of an engine samble runs on — `pg`, PGlite, `mysql2`, libsql.
 */
export function isDatabase(
  value: DatabaseOptions | Database,
): value is Database {
  return detectDialect(value) !== null;
}

/**
 * Opens the connection samble owns, with every module's tables in its schema.
 *
 * The dialect requires its driver HERE and not at import time: an application
 * installs the driver of the engine it runs and no other, and one that hands
 * samble a connection of its own never reaches this function at all.
 *
 * The schema is passed even though samble's own type erases it: Drizzle needs it
 * to resolve a table reference back to a name, and the schema diff reads it to
 * work out what the database is missing.
 */
export function openDatabase(
  options: DatabaseOptions,
  modules: ResolvedModule[],
): Database {
  return dialectNamed(options.dialect ?? 'postgres').open(
    options,
    collectModuleTables(modules),
  );
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
