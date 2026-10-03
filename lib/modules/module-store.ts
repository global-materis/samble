import { sql } from 'drizzle-orm';
import { dialectOf } from '../dialects';
import { Database, rows, run } from './database';
import { ResolvedModule } from './module-manifest';
import {
  ModuleState,
  Reconciliation,
  reconcileModules,
} from './reconcile-modules';

/**
 * Reads and writes what the installation remembers about its modules.
 *
 * Statements are written directly instead of going through a table object: this
 * table belongs to the framework, and declaring it as one would force every
 * application to hand samble's internals to its own `drizzle()` call — and to
 * fail at boot, confusingly, when it forgot. `_module_migrations` works the same
 * way.
 *
 * Deliberately thin: the decision lives in `reconcileModules()`, which is pure
 * and tested on its own. What is left here is the I/O that only a real database
 * can exercise.
 */
export class ModuleStore {
  constructor(private readonly db: Database) {}

  /**
   * Creates `_modules` when it is missing.
   *
   * It cannot come from a migration: this table is read *before* any module's
   * migrations run, to know which modules there are. So the framework creates
   * it itself, and `if not exists` is what makes a second boot a no-op without
   * a round trip to ask.
   */
  async ensureTable(): Promise<void> {
    // The DDL is the dialect's: column types differ per engine. On Postgres it
    // also drops the old `version` column — see `dialects/postgres.ts`.
    for (const statement of dialectOf(this.db).modulesTable) {
      await run(this.db, statement);
    }
  }

  async list(): Promise<ModuleState[]> {
    return rows<ModuleState>(this.db, sql`select id from _modules order by id`);
  }

  /**
   * Brings the table in line with the code and returns what changed, so the
   * caller can report it. Runs in one transaction: a half-applied module table
   * would leave the next boot guessing.
   */
  async sync(modules: ResolvedModule[]): Promise<Reconciliation> {
    const stored = await this.list();
    const result = reconcileModules(modules, stored);

    if (result.install.length === 0) return result;

    await this.db.transaction(async (tx) => {
      for (const entry of result.install) {
        await run(tx, sql`insert into _modules (id) values (${entry.id})`);
      }
    });

    return result;
  }

  /**
   * Forgets a module. Only the row: its tables and their contents stay, which
   * is what makes reinstalling it a safe operation.
   */
  async forget(id: string): Promise<void> {
    await run(this.db, sql`delete from _modules where id = ${id}`);
  }
}
