import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { connect, loadApp } from './app-loader';
import { runBuild } from './build';
import { printDoctor, runDoctor } from './doctor';
import {
  createProject,
  ENGINE_CHOICES,
  GitResult,
  initGit,
  install,
} from './init';
import {
  createEndpoint,
  createTable,
  createMigration,
  createModule,
  createProvider,
  createStrategy,
  createRoutine,
  createToken,
} from './generators';
import { generateMigration, snapshotPath } from './migration-generator';
import { CliError, parseTarget } from './names';
import { Plan } from './plan';
import type Samble from '../core/samble';
import type { SchemaSnapshot } from '../modules/schema-diff';
import type { DialectName } from '../modules/database';
import { dialectNamed } from '../dialects';
import { apply } from './writer';

/**
 * `npx samble ...`
 *
 * What it is for: a module is a SHAPE — a manifest, globs that must match, a
 * migrations index, permission keys namespaced by module id — and every one of
 * those is a place to be off by one convention and find out at boot, or worse,
 * not at all (a routes glob that matches nothing starts fine and answers 404).
 * The CLI writes the shape; the author writes the code.
 *
 * It deliberately does NOT know about the running application: no database, no
 * config file, no registry of what exists. It reads arguments and writes files.
 */

const version = (): string => {
  let dir = __dirname;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === '@samble/core') return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return '1.x';
};

interface CommonFlags {
  dir: string;
  from: string;
  force?: boolean;
}

/** Writes a plan and says what happened, in the order it happened. */
function report(target: Plan, flags: CommonFlags): void {
  const result = apply(target, { root: process.cwd(), force: flags.force });

  result.created.forEach((file) => console.log(`  created  ${file}`));
  result.edited.forEach((file) => console.log(`  updated  ${file}`));
  if (result.hints.length > 0) {
    console.log('');
    result.hints.forEach((hint) => console.log(`  next     ${hint}`));
  }
}

/**
 * Which engine, asked on the terminal.
 *
 * The engine is the operator's choice, so `init` asks instead of assuming. With
 * no terminal to ask on — a script, CI — it does not guess either: it takes
 * Postgres and says so, and `--db` is how a script chooses.
 */
async function askDialect(): Promise<DialectName> {
  if (!process.stdin.isTTY) {
    console.log(
      '  database postgres (no terminal to ask on; pass --db to choose)',
    );
    return 'postgres';
  }

  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    console.log('Which database will this project run on?');
    ENGINE_CHOICES.forEach((choice, index) =>
      console.log(`  ${index + 1}) ${choice.label}`),
    );
    for (;;) {
      const answer = (await rl.question('Choose 1-3 [1]: ')).trim() || '1';
      const chosen = ENGINE_CHOICES[Number(answer) - 1];
      if (chosen) return chosen.dialect;
      console.log(`  "${answer}" is not one of the options.`);
    }
  } finally {
    rl.close();
  }
}

/**
 * The engine this project runs on, as `samble init` recorded it in
 * `package.json` (`"samble": { "dialect": "mysql" }`).
 *
 * The generators stay pure — they take the dialect as an option — and this is
 * the one place that reads it, for the two that write engine-specific code: a
 * table and a migration. A project with no record is `postgres`, which is what
 * every project was before the engine became a choice. An unknown value is an
 * error, not a fallback: writing Postgres code into a MySQL project is worse
 * than stopping.
 */
function projectDialect(): DialectName {
  const file = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(file)) return 'postgres';
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    samble?: { dialect?: string };
  };
  const recorded = pkg.samble?.dialect;
  return recorded ? dialectNamed(recorded).name : 'postgres';
}

/**
 * The snapshot a module last recorded, or none.
 *
 * A module with no snapshot has never generated a migration, so its first diff
 * is against nothing — which is exactly what an empty snapshot says. A file that
 * is there but unreadable is an error, though: silently treating corruption as
 * "no history" would generate a migration that recreates every table.
 */
function readSnapshot(
  modulesDir: string,
  moduleId: string,
): SchemaSnapshot | undefined {
  const file = path.join(process.cwd(), snapshotPath(modulesDir, moduleId));
  // `undefined` and not an empty snapshot built here: which empty snapshot
  // depends on the engine, and the application is the one that knows it.
  if (!fs.existsSync(file)) return undefined;

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SchemaSnapshot;
  } catch (error) {
    throw new CliError(
      `${snapshotPath(modulesDir, moduleId)} is not readable JSON: ${
        (error as Error).message
      }\\nFix it, or delete it to start the history over.`,
    );
  }
}

/**
 * Runs something without letting it write to stdout.
 *
 * `drizzle-kit`'s `pushSchema` prints a spinner — "Pulling schema from
 * database..." — straight to stdout, and this CLI's output is a report with a
 * fixed shape. Doing it HERE and not inside `schemaDrift()` is the point: the
 * library muzzles nothing, so a script that calls it keeps whatever drizzle-kit
 * wants to show. The CLI owns its own output and only there.
 */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof write;
  try {
    return await work();
  } finally {
    process.stdout.write = write;
  }
}

/** What the live database is missing, for `--check`. */
async function reportDrift(app: Samble): Promise<void> {
  const drift = await quietly(() => app.schemaDrift());

  console.log('');
  if (drift.length === 0) {
    console.log('  checked   the live database matches the code.');
    return;
  }
  console.log(
    `  checked   the live database is missing ${drift.length} statement(s):`,
  );
  drift.forEach((query) => console.log(`            ${query}`));
}

/** What happened with git, in the one line that follows the created files. */
function gitLine(result: GitResult): string {
  if (result.status === 'committed') {
    return 'repository created, and the scaffold is its first commit — the next diff is only your own work.';
  }
  if (result.status === 'initialized') {
    return `repository created, nothing committed: ${result.reason}`;
  }
  return `no repository: ${result.reason}`;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('samble')
    .description('Scaffolding and builds for a samble application.')
    .version(version());

  program
    .command('init [name]')
    .description(
      'A project that runs: package.json, tsconfig, .env, entry point',
    )
    .option('--skip-install', 'write the files and stop')
    .option('--no-git', 'do not create a repository, or the first commit')
    .option('--dir <path>', 'where modules will live', 'src/modules')
    .option(
      '--db <engine>',
      `database engine: ${ENGINE_CHOICES.map((c) => c.dialect).join(', ')}`,
    )
    .action(async (name: string | undefined, flags) => {
      const dialect = flags.db
        ? dialectNamed(flags.db).name
        : await askDialect();
      const project = name ?? path.basename(process.cwd());
      // With a name, the project is a NEW folder; without one, it is this one.
      const root = name ? path.resolve(process.cwd(), name) : process.cwd();

      const result = apply(
        createProject({
          name: project,
          sambleVersion: `^${version()}`,
          modulesDir: flags.dir,
          dialect,
        }),
        { root },
      );
      result.created.forEach((file) => console.log(`  created  ${file}`));

      if (!flags.skipInstall) {
        console.log('\nInstalling dependencies...');
        install(root);
      }

      // After the install, so the lockfile is in the first commit.
      const git = flags.git ? initGit(root) : null;

      console.log('');
      if (git) console.log(`  git      ${gitLine(git)}`);
      if (name) console.log(`  next     cd ${name}`);
      // Until the dependencies are installed, `npx samble` would go to the
      // registry and resolve the `latest` tag — a different major, with a
      // different CLI. With them in place, the local one answers.
      if (flags.skipInstall) console.log('  next     npm install');
      result.hints.forEach((hint) => console.log(`  next     ${hint}`));
    });

  const common = (command: Command): Command =>
    command
      .option('--dir <path>', 'where modules live', 'src/modules')
      .option(
        '--from <specifier>',
        'what the generated code imports samble from',
        '@samble/core',
      )
      .option('--force', 'overwrite files that already exist');

  common(
    program
      .command('module <name>')
      .description(
        'A module: its manifest, its permissions and a first endpoint',
      )
      .option('--label <text>', 'human name, for a "modules" screen')
      .option(
        '--entry <file>',
        'file holding Samble.create({ modules: [...] })',
        'src/index.ts',
      ),
  ).action((name, flags) => {
    report(
      createModule({
        name,
        modulesDir: flags.dir,
        from: flags.from,
        label: flags.label,
        entry: flags.entry,
      }),
      flags,
    );
  });

  common(
    program
      .command('endpoint <module/name>')
      .description('An HTTP endpoint inside a module')
      .option('--method <verb>', 'get, post, put, patch, delete, query', 'get')
      .option('--path <path>', 'path under the group, e.g. ":id"')
      .option(
        '--group <name>',
        'route prefix (@Group); defaults to the module id',
      )
      .option(
        '--permission <key>',
        'assert this key instead of the module default, declaring it too',
      )
      .option('--public', 'no permission line at all'),
  ).action((target, flags) => {
    report(
      createEndpoint({
        target,
        modulesDir: flags.dir,
        from: flags.from,
        method: flags.method,
        path: flags.path,
        group: flags.group,
        permission: flags.public ? false : flags.permission,
      }),
      flags,
    );
  });

  common(
    program
      .command('routine <module/name>')
      .description('Work on a schedule, addressed by its own schedule token')
      .option('--cron <expression>', 'node-cron expression', '0 7 * * *')
      .option(
        '--no-autostart',
        'register it stopped, for a schedule somebody starts',
      ),
  ).action((target, flags) => {
    report(
      createRoutine({
        target,
        modulesDir: flags.dir,
        from: flags.from,
        cron: flags.cron,
        autostart: flags.autostart,
      }),
      flags,
    );
  });

  common(
    program
      .command('token <module/name> <kind>')
      .description(
        'What this module shares: contract (exactly one answers) or slot (as many as are deployed)',
      )
      .option(
        '--reaction',
        'for a slot: the host announces into it and reads nothing back',
      ),
  ).action((target, kind, flags) => {
    if (kind !== 'contract' && kind !== 'slot') {
      // The same two the runtime takes, in the same order as token(id, kind),
      // so the command reads like the call it writes. A schedule's token is
      // written beside its Routine, by `samble routine`.
      throw new CliError(
        `samble token ${target} <kind>: the kind is 'contract' (exactly one provider) or 'slot' (as many as are deployed), and got "${kind}". A schedule's token is written by \`samble routine\`.`,
      );
    }

    report(
      createToken({
        target,
        kind,
        reaction: flags.reaction,
        modulesDir: flags.dir,
        from: flags.from,
      }),
      flags,
    );
  });

  common(
    program
      .command('provider <module/name>')
      .description('The class that answers a contract, found by its folder'),
  ).action((target, flags) => {
    report(
      createProvider({ target, modulesDir: flags.dir, from: flags.from }),
      flags,
    );
  });

  common(
    program
      .command('strategy <module/name> <slot>')
      .description(
        "One implementation of another module's extension point, run by them",
      ),
  ).action((target, slot, flags) => {
    report(
      createStrategy({ target, slot, modulesDir: flags.dir, from: flags.from }),
      flags,
    );
  });

  common(
    program
      .command('table <module/name>')
      .description('A table, found by its folder')
      .option('--name <name>', 'the table name in SQL'),
  ).action((target, flags) => {
    report(
      createTable({
        target,
        modulesDir: flags.dir,
        from: flags.from,
        table: flags.name,
        dialect: projectDialect(),
      }),
      flags,
    );
  });

  common(
    program
      .command('migration <module/name>')
      .description("A migration, added to the module's own ledger"),
  ).action((target, flags) => {
    report(
      createMigration({
        target,
        modulesDir: flags.dir,
        from: flags.from,
        dialect: projectDialect(),
      }),
      flags,
    );
  });

  program
    .command('migration:generate <module/name>')
    .description(
      "The SQL that takes this module's schema to what its code says",
    )
    .option('--entry <file>', 'file exporting createApp()')
    .option('--dir <path>', 'where modules live', 'src/modules')
    .option('--print', 'show the SQL and write nothing')
    .option('--check', 'also report what the live database is missing')
    .option('--force', 'overwrite a file that already exists')
    .action(async (target: string, flags) => {
      const app = await loadApp({ root: process.cwd(), entry: flags.entry });
      try {
        const { module: moduleId } = parseTarget(target, 'migration');
        // No connection. The comparison is between what the module's tables say
        // and what its last snapshot said, and neither of those is in a
        // database — which is what makes writing a migration something you can
        // do with nothing running.
        const previous = readSnapshot(flags.dir, moduleId);
        const diff = await app.pendingSchema(moduleId, previous);

        if (flags.print) {
          if (diff.up.length === 0) {
            console.log(
              `Nothing to generate: "${moduleId}" has no changes since its last migration.`,
            );
          } else {
            diff.up.forEach((query) => console.log(`  ${query}`));
          }
          if (flags.check) await reportDrift(app);
          return;
        }

        report(
          generateMigration({
            target,
            diff,
            snapshot: await app.snapshotOf(moduleId, previous),
            method: app.dialect.statementMethod,
            modulesDir: flags.dir,
          }),
          flags,
        );

        if (flags.check) await reportDrift(app);
      } finally {
        await app.close();
      }
    });

  program
    .command('migrate')
    .description(
      'Runs the pending migrations of every module, in dependency order',
    )
    .option('--entry <file>', 'file exporting createApp()')
    .option('--dry-run', 'say what would run, change nothing')
    .action(async (flags) => {
      const app = await loadApp({ root: process.cwd(), entry: flags.entry });
      try {
        await connect(app);
        const ran = await app.migrate({ dryRun: flags.dryRun });

        if (ran.length === 0) {
          console.log(
            flags.dryRun
              ? 'Nothing pending.'
              : 'Nothing to migrate: everything already ran.',
          );
          return;
        }

        const verb = flags.dryRun ? 'pending' : 'applied';
        ran.forEach((entry) =>
          console.log(`  ${verb}  ${entry.module}:${entry.name}`),
        );
        console.log(`
${ran.length} migration(s) ${verb}.`);
      } finally {
        await app.close();
      }
    });

  program
    .command('migrate:status')
    .description('What each module declares, and what of it already ran')
    .option('--entry <file>', 'file exporting createApp()')
    .action(async (flags) => {
      const app = await loadApp({ root: process.cwd(), entry: flags.entry });
      try {
        await connect(app);
        const status = await app.migrationStatus();

        if (status.length === 0) {
          console.log('This application declares no modules.');
          return;
        }

        for (const mod of status) {
          console.log(`
${mod.module}`);

          if (mod.migrations.length === 0) {
            // The one failure that looks identical from the database: the
            // file is written, but samble is not looking where it landed.
            console.log(
              "  none declared  (wrote one? it goes in the module's migrations/ folder)",
            );
            continue;
          }

          for (const migration of mod.migrations) {
            console.log(
              `  ${migration.applied ? '[x]' : '[ ]'}  ${migration.name}`,
            );
          }
        }
        console.log('');
      } finally {
        await app.close();
      }
    });

  program
    .command('doctor')
    .description(
      'Is this machine ready to run this application? Changes nothing',
    )
    .option('--entry <file>', 'file exporting createApp()')
    .action(async (flags) => {
      const result = await runDoctor({
        root: process.cwd(),
        entry: flags.entry,
      });
      printDoctor(result);
      // The exit code is the point: this is meant to run inside an install
      // script, where nobody reads the output unless it stops.
      if (!result.ok) process.exitCode = 1;
    });

  program
    .command('build')
    .description('Compiles the application, optionally to V8 bytecode')
    .option('--project <file>', 'tsconfig to compile with', 'tsconfig.json')
    .option('--out <dir>', 'where the build goes', 'build')
    .option('--assets <dir>', 'folder holding what was never TypeScript', 'src')
    .option('--bytecode', 'compile to .jsc and delete the readable .js')
    .option(
      '--only <dir>',
      'limit the bytecode step to this part of the output',
    )
    .action(async (flags) => {
      const result = await runBuild({
        root: process.cwd(),
        project: flags.project,
        out: flags.out,
        assets: flags.assets,
        bytecode: flags.bytecode,
        bytecodeDir: flags.only,
        log: (message) => console.log(message),
      });
      console.log(
        `\nBuild at ${path.relative(process.cwd(), result.out) || '.'}`,
      );
      if (flags.bytecode) {
        console.log(
          'Remember: the application must require("bytenode") before start(), and the .jsc is tied to this Node version.',
        );
      }
    });

  return program;
}

/** Entry point. Errors meant for the author print as one line, not a stack. */
export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
