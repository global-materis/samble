import fs from 'fs';
import path from 'path';
import semver from 'semver';
import type Samble from '../core/samble';
import { ConfigError } from '../utilities/config-service';
import { connect, loadApp } from './app-loader';

/**
 * `samble doctor` — is this machine ready to run this application?
 *
 * It exists for the install, which is the moment nobody is watching the logs:
 * a server somebody else set up, a container that restarts, a `.env` filled in
 * from a template. Every failure it reports is one that would otherwise surface
 * later, somewhere else, looking like a different problem — a missing variable
 * as a driver error, a wrong Node as a syntax error, a migration nobody ran as a
 * 500 on the first request that touches the column.
 *
 * It CHANGES NOTHING. No migration runs, no table is created, no license is
 * activated. An installer can run it before, during and after, and twice.
 *
 * The order is not incidental: each check is the reason the next one can be
 * trusted. Node before loading the code, the environment before the connection,
 * the connection before asking what migrations are pending. When one fails, the
 * ones that depended on it are reported as SKIPPED rather than passed, because
 * "we did not get to ask" is not "it is fine" — the same distinction a license
 * client has to make about a network it could not reach.
 */

export type DoctorStatus = 'ok' | 'fail' | 'warn' | 'skipped';

export interface DoctorCheck {
  /** Short label, printed as the row. */
  name: string;
  status: DoctorStatus;
  /** One line: what was found, or what to do about it. */
  detail?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** False when any check failed. What the exit code is built from. */
  ok: boolean;
}

export interface DoctorOptions {
  root: string;
  /** The file exporting `createApp()`. Defaults to the usual entry points. */
  entry?: string;
}

/**
 * Is this the environment answering, rather than a broken entry point?
 *
 * By NAME and not only by `instanceof`. The application imports `samble` and so
 * does this command, and they are not always the same copy of the module — a
 * `npm link`, a monorepo, two versions in the tree, or the source running beside
 * a build. When they are not, `instanceof` is false against an error that is one,
 * and the report blames the entry point for a missing variable. The `name` is set
 * in the constructor precisely so this check does not depend on identity.
 */
function isConfigError(error: unknown): error is Error {
  return (
    error instanceof ConfigError ||
    (error instanceof Error && error.name === 'ConfigError')
  );
}

/** samble's own `engines.node`, which is the floor the application inherits. */
function requiredNode(): string | null {
  let dir = __dirname;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === '@samble/core') return pkg.engines?.node ?? null;
    }
    dir = path.dirname(dir);
  }
  return null;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const skip = (name: string, detail: string) =>
    checks.push({ name, status: 'skipped', detail });

  // ---- Node -------------------------------------------------------------
  const range = requiredNode();
  if (!range) {
    checks.push({
      name: 'Node',
      status: 'warn',
      detail: `${process.version} — could not read samble's engines.node to compare`,
    });
  } else if (semver.satisfies(process.version, range)) {
    checks.push({ name: 'Node', status: 'ok', detail: process.version });
  } else {
    checks.push({
      name: 'Node',
      status: 'fail',
      detail: `${process.version}, and samble needs ${range}`,
    });
  }

  // ---- The application itself ------------------------------------------
  // `createApp()` is where the application's own `ConfigService.require()` runs,
  // so a ConfigError here is the environment answering, not a broken entry
  // point. Reported as the environment check, which is what it is.
  let app: Samble;
  try {
    app = await loadApp({ root: options.root, entry: options.entry });
    checks.push({
      name: 'Entry point',
      status: 'ok',
      detail: 'createApp() ran',
    });
  } catch (error) {
    if (isConfigError(error)) {
      checks.push({
        name: 'Environment (application)',
        status: 'fail',
        detail: error.message,
      });
    } else {
      checks.push({
        name: 'Entry point',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    skip('Environment (modules)', 'the application did not load');
    skip('Database', 'the application did not load');
    skip('Migrations', 'the application did not load');
    return { checks, ok: false };
  }

  checks.push({ name: 'Environment (application)', status: 'ok' });

  try {
    // ---- Environment the modules declare --------------------------------
    const incomplete = app.checkEnv();
    if (incomplete.length === 0) {
      checks.push({ name: 'Environment (modules)', status: 'ok' });
    } else {
      checks.push({
        name: 'Environment (modules)',
        status: 'fail',
        detail: incomplete
          .map((entry) => `${entry.moduleId} needs ${entry.missing.join(', ')}`)
          .join('; '),
      });
    }

    // ---- Database --------------------------------------------------------
    let connected = false;
    try {
      await connect(app);
      connected = true;
      checks.push({ name: 'Database', status: 'ok', detail: 'answered' });
    } catch (error) {
      checks.push({
        name: 'Database',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    // ---- Migrations ------------------------------------------------------
    if (!connected) {
      skip('Migrations', 'the database did not answer');
    } else {
      try {
        const pending = await app.migrate({ dryRun: true });
        if (pending.length === 0) {
          checks.push({
            name: 'Migrations',
            status: 'ok',
            detail: 'nothing pending',
          });
        } else {
          // A WARNING, not a failure: pending migrations are the normal state of
          // a fresh install. What would be wrong is not knowing.
          checks.push({
            name: 'Migrations',
            status: 'warn',
            detail: `${pending.length} pending — run \`samble migrate\``,
          });
        }
      } catch (error) {
        checks.push({
          name: 'Migrations',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }

  return { checks, ok: !checks.some((check) => check.status === 'fail') };
}

/** The symbol in front of each row. */
const MARK: Record<DoctorStatus, string> = {
  ok: '[ok]',
  fail: '[!!]',
  warn: '[ ~]',
  skipped: '[--]',
};

export function printDoctor(result: DoctorResult, log = console.log): void {
  log('');
  for (const check of result.checks) {
    const detail = check.detail ? `  ${check.detail}` : '';
    log(`${MARK[check.status]}  ${check.name}${detail}`);
  }

  const failed = result.checks.filter(
    (check) => check.status === 'fail',
  ).length;
  log('');
  log(
    result.ok
      ? 'Ready to run.'
      : `${failed} ${failed === 1 ? 'check' : 'checks'} failed: this installation will not start as it is.`,
  );
  log('');
}
