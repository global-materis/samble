import path from 'path';
import type { SchemaDiff, SchemaSnapshot } from '../modules/schema-diff';
import { CliError, parseTarget, toPascal } from './names';
import { Plan, plan } from './plan';

/**
 * Where a module remembers what its schema looked like.
 *
 * Inside `migrations/` because that is what it belongs to, and in a `meta/`
 * subfolder so the `migrations/*.ts` glob never sees it. One file, not one per
 * migration: the migrations themselves are the history, and this is only the
 * baseline the next diff is taken from.
 */
export const MODULE_SNAPSHOT = 'migrations/meta/snapshot.json';

/** That path inside one module's folder. */
export const snapshotPath = (modulesDir: string, moduleId: string): string =>
  path.posix.join(modulesDir.split('\\').join('/'), moduleId, MODULE_SNAPSHOT);

export interface GenerateMigrationOptions {
  /** `<module>/<name>`. */
  target: string;
  /** What Drizzle Kit says is missing, both ways. */
  diff: SchemaDiff;
  /** What the NEXT generate compares against, written beside the migration. */
  snapshot: SchemaSnapshot;
  modulesDir?: string;
  /**
   * What the generated code imports the framework from. `samble` everywhere
   * except inside this repository, where the demo imports `lib/` by path.
   */
  from?: string;
  /** Fixed clock, for tests. */
  now?: number;
  /**
   * How the engine runs a raw statement: `execute`, or `run` on SQLite, where
   * Drizzle has no `execute`. The dialect's `statementMethod`.
   */
  method?: 'execute' | 'run';
}

/** What prettier wraps at, and what samble therefore has to wrap at. */
const WIDTH = 80;

/** Written like this so the generator's own source stays readable. */
const BACKTICK = String.fromCharCode(96);

/** Inside a template literal, only these two can end it early. */
const escape = (sql: string): string =>
  sql.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/**
 * One statement, wrapped the way prettier would wrap it.
 *
 * Third time this rule shows up — after the generated import and the token
 * declaration — and for the same reason: the scaffolded project runs
 * `prettier --check`, so a generated file that is one column too wide fails the
 * consumer's own lint on the first commit. Here the width is a piece of SQL
 * nobody can predict, which is why it is computed instead of guessed.
 *
 * Three forms, and prettier picks between them by measuring:
 *
 *     await db.execute(sql.raw(`DROP TABLE "x";`));          // fits
 *     await db.execute(                                     // does not
 *       sql.raw(`ALTER TABLE ...`),
 *     );
 *     await db.execute(                                     // nor does that
 *       sql.raw(
 *         `ALTER TABLE ... a long one ...`,
 *       ),
 *     );
 *
 * A multi-line statement — every `CREATE TABLE` Drizzle Kit writes — always
 * takes the middle form: prettier cannot fold a literal that already has
 * newlines in it, and it will not leave it on the same line as the call.
 */
const statement = (query: string, method: string): string => {
  const literal = `${BACKTICK}${escape(query)}${BACKTICK}`;
  const oneLine = `    await db.${method}(sql.raw(${literal}));`;

  if (!literal.includes('\n') && oneLine.length <= WIDTH) return oneLine;

  const inner = `      sql.raw(${literal}),`;
  if (literal.includes('\n') || inner.length <= WIDTH) {
    return `    await db.${method}(\n${inner}\n    );`;
  }

  return [
    `    await db.${method}(`,
    '      sql.raw(',
    `        ${literal},`,
    '      ),',
    '    );',
  ].join('\n');
};

const statements = (queries: string[], method: string): string =>
  queries.map((query) => statement(query, method)).join('\n');

/**
 * The `down()`, or nothing at all.
 *
 * No method when the diff has no way back. An empty `down()` would claim this
 * migration is undone by doing nothing, which is a different statement from "the
 * undo has not been written" — and `Migration.down` is optional precisely so the
 * difference can be said. It also keeps an unused parameter out of a file that
 * has to pass the consumer's lint.
 */
const undo = (queries: string[], method: string): string => {
  if (queries.length === 0) return '';

  return `
  public async down(db: Transaction): Promise<void> {
${statements(queries, method)}
  }
`;
};

/**
 * Turns a module's schema diff into a migration in that module.
 *
 * The split of labour is the whole idea. Drizzle Kit compares what the module's
 * tables describe against what its last snapshot described, and writes the SQL —
 * it does that far better than anything hand-rolled, and it is the part that has
 * to be right. What it does not know is that modules exist, which is why the
 * comparison is set up per module: a diff is always this module's tables against
 * this module's snapshot, so there is no attribution to get wrong and nothing
 * from another module can be filed here by accident.
 *
 * A statement may still NAME another module's table — a foreign key points
 * somewhere — and that is correct. The constraint belongs to the module that
 * declared it, and samble migrates in dependency order, so what it points at
 * already exists.
 *
 * Two files, always. A migration written without its snapshot means the next one
 * is generated against a schema that is already out of date, and comes out
 * trying to create what exists.
 */
export function generateMigration(options: GenerateMigrationOptions): Plan {
  const target = parseTarget(options.target, 'migration');
  const modulesDir = options.modulesDir ?? 'src/modules';
  const dir = path.posix.join(modulesDir.split('\\').join('/'), target.module);

  if (options.diff.up.length === 0) {
    throw new CliError(
      `Nothing to generate: "${target.module}" has no changes since its last migration.`,
    );
  }

  const stamp = options.now ?? Date.now();
  const className = `${toPascal(target.name)}${stamp}`;
  const from = options.from ?? '@samble/core';
  const method = options.method ?? 'execute';

  const content = `import { sql } from 'drizzle-orm';
import type { Migration, Transaction } from '${from}';

export class ${className} implements Migration {
  public async up(db: Transaction): Promise<void> {
${statements(options.diff.up, method)}
  }
${undo(options.diff.down, method)}}
`;

  const hints = [
    'Read it before running it: a diff cannot tell a rename from a drop plus an add, so a renamed column comes out as losing one and gaining another — and on a table with rows, that is the data.',
    `The snapshot beside it is what the next generate compares against. Commit both: without it the next migration is written against a schema that no longer matches.`,
  ];
  if (options.diff.down.length === 0) {
    hints.push(
      'It has no down(): the diff found no way back, and an empty one would claim this is undone by doing nothing. Write it if this has to be reversible.',
    );
  }

  return plan(
    [
      { path: `${dir}/migrations/${stamp}-${target.name}.ts`, content },
      {
        path: snapshotPath(modulesDir, target.module),
        content: `${JSON.stringify(options.snapshot, null, 2)}\n`,
        // Replaced on every generate: it is where the LAST migration left the
        // schema. Without this, a module could only ever have one migration
        // before the writer refused to touch the snapshot again.
        replaces: true,
      },
    ],
    [],
    hints,
  );
}
