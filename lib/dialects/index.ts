import type { DialectName } from '../modules/database';
import type { Dialect } from './dialect';
import { mysql } from './mysql';
import { postgres } from './postgres';
import { sqlite } from './sqlite';

export type { Dialect, SchemaSnapshot } from './dialect';

/** Every engine samble runs on, by name. */
export const DIALECTS: Readonly<Record<DialectName, Dialect>> = {
  postgres,
  mysql,
  sqlite,
};

export const DIALECT_NAMES = Object.keys(DIALECTS) as DialectName[];

/** A dialect by name, or an error that lists the ones there are. */
export function dialectNamed(name: string): Dialect {
  const found = DIALECTS[name as DialectName];
  if (!found) {
    throw new Error(
      `Unknown database dialect "${name}". samble runs on: ${DIALECT_NAMES.join(', ')}.`,
    );
  }
  return found;
}

/**
 * The dialect a connection was built for, read off the connection itself.
 *
 * So an application never says it twice: options carry `dialect`, and a
 * connection handed in (PGlite in a test, a pool the app built) already IS one.
 * Drizzle's `is()` compares an entity kind, not a class identity, so it holds
 * when the app and samble resolve different copies of `drizzle-orm`.
 */
export function detectDialect(db: unknown): Dialect | null {
  return Object.values(DIALECTS).find((dialect) => dialect.owns(db)) ?? null;
}

export function dialectOf(db: unknown): Dialect {
  const found = detectDialect(db);
  if (!found) {
    throw new Error(
      `This is not a Drizzle connection samble knows: it runs on ${DIALECT_NAMES.join(', ')}.`,
    );
  }
  return found;
}

/**
 * The engine a module's schema object belongs to — a `pgTable`, a
 * `mysqlTable`... — so a module written for one engine is refused by name on
 * another, at boot, instead of failing at its first query.
 */
export function dialectOfSchemaObject(value: unknown): Dialect | null {
  return (
    Object.values(DIALECTS).find((dialect) => dialect.isSchemaObject(value)) ??
    null
  );
}
