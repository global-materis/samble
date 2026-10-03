import { sql } from 'drizzle-orm';
import { dialectOf } from '../dialects';
import { Database, rows, run, tableExists, Transaction } from './database';
import { ResolvedModule } from './module-manifest';

/**
 * What a migration is.
 *
 * Samble's own interface, and not the ORM's. It used to be TypeORM's
 * `MigrationInterface`, which made every application's migrations depend on a
 * type from a package they might swap — for a shape samble already decides: a
 * class whose name ends in a timestamp, with an `up`, run inside a transaction
 * samble owns. Nothing in it comes from the driver.
 *
 * `down` is optional because samble never runs it: there is no `migrate:revert`.
 * It is declared so what `samble migration:generate` writes has somewhere to put
 * the undo it already computed, for whoever needs it by hand.
 */
export interface Migration {
  up(db: Transaction): Promise<void>;
  down?(db: Transaction): Promise<void>;
}

/** A migration that ran, as the installation records it. */
export interface AppliedMigration {
  module: string;
  name: string;
}

export class ModuleMigrationError extends Error {
  constructor(
    message: string,
    public moduleId: string,
    public migrationName: string | null = null,
  ) {
    super(message);
    this.name = 'ModuleMigrationError';
  }
}

/** Trailing digits in a class name: `CreateCharges1780449821400`, `M002Seed`. */
const TIMESTAMP_PATTERN = /(\d+)$/;

/**
 * Orders a module's migrations by the timestamp at the end of their class name,
 * the convention every tool in this space already uses.
 *
 * A migration without a timestamp is an error rather than a guess. Declaration
 * order is not a contract: `import * as migrations` hands over an object whose
 * key order nobody controls, and getting migration order wrong is discovered in
 * production, on data that already exists.
 *
 * Pure and exported so the rule can be tested without a database.
 */
export function orderMigrations(
  migrations: Function[],
  moduleId: string,
): Function[] {
  const stamped = migrations.map((migration) => {
    const match = TIMESTAMP_PATTERN.exec(migration.name);
    if (!match) {
      throw new ModuleMigrationError(
        `Module "${moduleId}": migration "${migration.name}" must end with a timestamp (e.g. "${migration.name}1780449821400").`,
        moduleId,
        migration.name,
      );
    }
    // Compared as a number, not as text: "9000" sorts after "10000"
    // lexicographically, which would silently invert two migrations whose
    // stamps have different lengths. A 13-digit timestamp is well within
    // Number's safe range.
    return { migration, stamp: Number(match[1]) };
  });

  const seen = new Map<number, string>();
  for (const { migration, stamp } of stamped) {
    const previous = seen.get(stamp);
    if (previous) {
      throw new ModuleMigrationError(
        `Module "${moduleId}": "${migration.name}" and "${previous}" share the timestamp ${stamp}, so their order is undefined.`,
        moduleId,
        migration.name,
      );
    }
    seen.set(stamp, migration.name);
  }

  return stamped
    .sort((a, b) => a.stamp - b.stamp)
    .map((entry) => entry.migration);
}

/**
 * Runs each module's migrations, in the order the modules were resolved.
 *
 * An ORM's own runner cannot do this: it sorts every migration it knows about
 * by timestamp, globally. A module written last year would then migrate before
 * the dependency it needs, because its timestamp is older. Ordering by module
 * first, and by timestamp only inside a module, is what makes a dependency's
 * tables exist before the dependent touches them.
 *
 * One transaction per migration, so a failure leaves the ones before it applied
 * and recorded instead of rolling back an entire deploy's worth of schema.
 */
export class ModuleMigrator {
  constructor(private readonly db: Database) {}

  /**
   * Creates `_module_migrations`. Like `_modules`, it cannot come from a
   * migration — it is the ledger those migrations are recorded in.
   */
  async ensureTable(): Promise<void> {
    for (const statement of dialectOf(this.db).migrationsTable) {
      await run(this.db, statement);
    }
  }

  /**
   * What already ran, keyed as `module:name`.
   *
   * A database where the ledger does not exist yet has simply run nothing —
   * asking is not a reason to create it. That is what makes reading the state
   * (a status command, a dry run) leave no trace.
   */
  async applied(): Promise<Set<string>> {
    if (!(await tableExists(this.db, '_module_migrations'))) return new Set();

    const found = await rows<AppliedMigration>(
      this.db,
      sql`select module, name from _module_migrations`,
    );
    return new Set(found.map((row) => `${row.module}:${row.name}`));
  }

  /** Migrations declared but not yet applied, in the order they would run. */
  async pending(modules: ResolvedModule[]): Promise<AppliedMigration[]> {
    const done = await this.applied();
    const pending: AppliedMigration[] = [];

    for (const mod of modules) {
      for (const migration of orderMigrations(mod.migrations, mod.id)) {
        if (done.has(`${mod.id}:${migration.name}`)) continue;
        pending.push({ module: mod.id, name: migration.name });
      }
    }

    return pending;
  }

  /**
   * Applies every pending migration and returns what ran.
   *
   * @param modules Already resolved, so iterating them is dependency order.
   */
  async run(modules: ResolvedModule[]): Promise<AppliedMigration[]> {
    await this.ensureTable();
    const done = await this.applied();
    const ran: AppliedMigration[] = [];

    for (const mod of modules) {
      for (const migration of orderMigrations(mod.migrations, mod.id)) {
        const key = `${mod.id}:${migration.name}`;
        if (done.has(key)) continue;

        await this.apply(mod.id, migration);
        ran.push({ module: mod.id, name: migration.name });
      }
    }

    return ran;
  }

  private async apply(moduleId: string, migration: Function): Promise<void> {
    const instance = new (migration as new () => Migration)();

    if (typeof instance.up !== 'function') {
      throw new ModuleMigrationError(
        `Module "${moduleId}": migration "${migration.name}" has no up().`,
        moduleId,
        migration.name,
      );
    }

    try {
      // Drizzle rolls the transaction back when the callback throws, so the
      // failure path is the ordinary one: no runner to release, and nothing
      // left half-applied to clean up here.
      await this.db.transaction(async (tx) => {
        await instance.up(tx);
        // Recorded in the same transaction: a migration that ran without
        // leaving its row would run again on the next boot, over data it
        // already changed.
        await run(
          tx as Transaction,
          sql`
            insert into _module_migrations (module, name)
            values (${moduleId}, ${migration.name})
          `,
        );
      });
    } catch (error) {
      throw new ModuleMigrationError(
        `Module "${moduleId}": migration "${migration.name}" failed: ${
          (error as Error).message
        }`,
        moduleId,
        migration.name,
      );
    }
  }
}
