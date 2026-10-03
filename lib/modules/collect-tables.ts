import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import {
  ModuleDefinitionError,
  ModuleTable,
  ResolvedModule,
} from './module-manifest';

/**
 * Gathers what every module puts in the schema, as the one object Drizzle takes.
 *
 * Note it takes **every module present in the code**: the schema is exactly
 * the union of what the modules declare. A module whose code is gone stops
 * contributing here, and its tables stay in the database untouched — removing
 * code never removes data.
 *
 * Keyed by position and not by name because Drizzle reads the table's own name
 * out of the object; the keys of this record are never SQL. Inventing names
 * would only create a second place for two modules to collide.
 *
 * The same table contributed by two modules is an error. It means one of them
 * is reaching into the other's domain, and left alone it surfaces later as a
 * duplicate-relation failure with neither module's name in it.
 */
export function collectModuleTables(
  modules: ResolvedModule[],
): Record<string, ModuleTable> {
  const owner = new Map<ModuleTable, string>();
  const schema: Record<string, ModuleTable> = {};
  let index = 0;

  for (const mod of modules) {
    for (const table of mod.tables) {
      const previous = owner.get(table);
      if (previous) {
        // The SQL name when there is one: an enum or a sequence has no
        // `getTableName`, and a message that says "a table" is still better
        // than one that says `[object Object]`.
        const named = is(table, PgTable)
          ? `"${getTableName(table)}"`
          : 'A table';
        throw new ModuleDefinitionError(
          `${named} is declared by both "${previous}" and "${mod.id}". It belongs to exactly one module.`,
          mod.id,
        );
      }
      owner.set(table, mod.id);
      schema[String(index)] = table;
      index += 1;
    }
  }

  return schema;
}
