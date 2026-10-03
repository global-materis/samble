import fs from 'fs';
import path from 'path';
import type Samble from '../core/samble';
import { CliError } from './names';

/**
 * Loads the application so a command can operate on it.
 *
 * The CLI still knows nothing about your database: it asks YOUR entry point to
 * build the app, and the app already knows where its data lives. That is the
 * whole contract, and it is one function:
 *
 * ```typescript
 * export async function createApp() {
 *   return Samble.create({ db, modules, version });
 * }
 *
 * if (require.main === module) void main();   // importing it starts nothing
 * ```
 *
 * The guard on the last line is what lets a command import the file without a
 * server coming up behind it. `samble init` writes both.
 */

export interface LoadOptions {
  /** Project root. */
  root: string;
  /** Entry point. Defaults to `src/index.ts`, then `build/index.js`. */
  entry?: string;
}

const CONTRACT = `
  export async function createApp() {
    return Samble.create({ db, modules, version });
  }

  // importing this file must not start a server
  if (require.main === module) void main();
`;

function resolveEntry(options: LoadOptions): string {
  const candidates = options.entry
    ? [options.entry]
    : ['src/index.ts', 'build/index.js', 'dist/index.js'];

  for (const candidate of candidates) {
    const full = path.resolve(options.root, candidate);
    if (fs.existsSync(full)) return full;
  }

  throw new CliError(
    options.entry
      ? `No "${options.entry}" here.`
      : `Could not find the entry point (tried ${candidates.join(
          ', ',
        )}). Pass --entry <file>.`,
  );
}

/**
 * Teaches Node to require the project's TypeScript.
 *
 * `transpileOnly` on purpose: a type error somewhere else in the application
 * is not a reason to refuse to run a migration, and the compiler already has
 * its own command.
 */
function registerTypeScript(root: string): void {
  let tsNode: string;
  try {
    tsNode = require.resolve('ts-node', { paths: [root] });
  } catch {
    throw new CliError(
      'Reading a .ts entry point needs ts-node (npm i -D ts-node), or point --entry at the build (samble build, then --entry build/index.js).',
    );
  }

  const { register } = require(tsNode);
  register({ transpileOnly: true, cwd: root });
}

export async function loadApp(options: LoadOptions): Promise<Samble> {
  const entry = resolveEntry(options);
  if (entry.endsWith('.ts')) registerTypeScript(options.root);

  const exported = require(entry);
  const createApp = exported?.createApp ?? exported?.default?.createApp;

  if (typeof createApp !== 'function') {
    throw new CliError(
      `${path.relative(
        options.root,
        entry,
      )} does not export createApp().\n${CONTRACT}`,
    );
  }

  const app = (await createApp()) as Samble;

  if (!app || typeof app.migrate !== 'function') {
    throw new CliError(
      `createApp() in ${path.relative(
        options.root,
        entry,
      )} must return what Samble.create() gives back.`,
    );
  }

  return app;
}

/**
 * Opens the connection, turning a driver error into something actionable.
 *
 * Straight out of `samble init` the `.env` is a template, so the first
 * `samble migrate` anybody runs fails inside the Postgres driver — a SASL or
 * ECONNREFUSED stack that reads like the framework broke. It is the most
 * likely first command and deserved the least cryptic failure.
 */
export async function connect(app: Samble): Promise<void> {
  try {
    await app.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Could not reach the database: ${detail}\n\n` +
        'Check the DB_* values in .env. The database itself has to exist — samble creates tables, not databases.',
    );
  }
}
