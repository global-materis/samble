import type { RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import type { Database } from '../modules/database';

/**
 * Is this application able to serve?
 *
 * Every platform that runs a backend asks the same question the same way: an
 * unauthenticated GET that answers 200 or 503. A load balancer takes an
 * instance out of rotation on 503, a container runtime restarts it, an uptime
 * check pages someone. Without it, the only way to know a process is wedged is
 * that requests start failing.
 *
 * It answers what a probe needs and nothing more. A health endpoint is
 * normally reachable without credentials — a load balancer cannot sign in —
 * so the default body says whether it can serve and stops there. Versions,
 * module names and counts are a map of your installation for whoever finds it.
 */

/**
 * One application-owned answer to "can I serve?". `true` passes.
 *
 * Throwing and returning `false` are the same thing on purpose: a dependency
 * that is down usually announces itself by throwing, and a health check is the
 * one place where an exception is an ANSWER rather than a failure.
 */
export type HealthCheck = () => boolean | Promise<boolean>;

/** samble's own names. An application check may not take one of these. */
const RESERVED = ['server', 'database'];

export interface HealthConfig {
  /** Where it answers. Outside `basePath` on purpose. Defaults to `/health`. */
  path?: string;

  /**
   * Adds the application version and the per-check breakdown even when
   * everything passes. Off by default: useful behind a gate, information
   * disclosure in front of one.
   */
  details?: boolean;

  /**
   * What ELSE has to be true for this application to serve.
   *
   * samble can only check what it owns — the process is up and the database
   * answers. Whether a queue must be connected, a payments provider must be
   * reachable or a cache must be warm is the application's knowledge, and no
   * framework can guess it. This is where that knowledge goes; samble keeps
   * owning the 200/503, the shape and the timeout.
   *
   * Every check runs on every request, in parallel, so keep them cheap: a
   * probe hitting this every few seconds is the normal case.
   *
   * @example
   * health: {
   *   path: '/health',
   *   checks: {
   *     queue: () => bridge.isConnected(),
   *     payments: async () => (await gateway.ping()).ok,
   *   },
   * }
   */
  checks?: Record<string, HealthCheck>;

  /**
   * How long a check may take before it counts as failed, in milliseconds.
   * Defaults to 2000.
   *
   * A probe that never answers is worse than one that answers `fail`: the
   * caller is a balancer with its own timeout, and a hung request reads to it
   * as a network problem rather than as this instance being unwell.
   */
  timeout?: number;
}

/** `pass` while it can serve, `fail` while it cannot. */
export type HealthStatus = 'pass' | 'fail';

export interface HealthReport {
  status: HealthStatus;
  /** Seconds since the process started, rounded. */
  uptime: number;
  version?: string;
  checks?: Record<string, HealthStatus | string>;
}

export interface HealthSources {
  db: () => Database;
  /** The APPLICATION's version, not samble's. */
  version?: string;
  /** True once an ordered shutdown has begun. */
  isShuttingDown: () => boolean;
}

/**
 * The database check is a round TRIP, not a flag.
 *
 * `isInitialized` stays true after the connection drops: the pool remembers it
 * once connected and only finds out otherwise when something asks. A health
 * check that reads the flag reports `pass` through an outage, which is the one
 * moment it exists for.
 */
async function databaseAnswers(db: Database): Promise<boolean> {
  try {
    // One statement, and no "is it initialized" shortcut: a pool reports itself
    // open while every connection in it is broken, and a probe that trusts a
    // flag over a round trip answers healthy right through an outage.
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** Runs one application check without letting it throw or hang. */
async function settle(check: HealthCheck, timeout: number): Promise<boolean> {
  try {
    const expired = new Promise<false>((resolve) => {
      // Unref'd: a pending health timer must not be the reason the process
      // refuses to exit.
      setTimeout(() => resolve(false), timeout).unref?.();
    });
    return (await Promise.race([Promise.resolve(check()), expired])) === true;
  } catch {
    return false;
  }
}

export function buildHealth(
  config: HealthConfig,
  sources: HealthSources,
): RequestHandler {
  const startedAt = Date.now();
  const custom = Object.entries(config.checks ?? {});
  const timeout = config.timeout ?? 2000;

  // At build time, not on the first probe: a name collision would silently
  // replace samble's own answer with the application's, and the endpoint would
  // keep reporting `pass` for a database nobody looked at.
  const taken = custom.find(([name]) => RESERVED.includes(name));
  if (taken) {
    throw new Error(
      `Health check "${taken[0]}" uses a name samble reserves (${RESERVED.join(
        ', ',
      )}). Rename it.`,
    );
  }

  return (_request, response, next) => {
    void (async () => {
      try {
        const uptime = Math.round((Date.now() - startedAt) / 1000);
        const checks: Record<string, HealthStatus | string> = {};

        // Reported BEFORE the server stops accepting, which is the whole point:
        // it gives a load balancer the window to stop sending traffic while
        // the in-flight requests finish.
        const draining = sources.isShuttingDown();
        if (draining) checks.server = 'shutting-down';

        // All at once: the probe waits for the slowest check, not for their
        // sum, and one slow dependency does not decide the endpoint's latency.
        const [database, ...answers] = await Promise.all([
          databaseAnswers(sources.db()),
          ...custom.map(([, check]) => settle(check, timeout)),
        ]);

        checks.database = database ? 'pass' : 'fail';
        custom.forEach(([name], index) => {
          checks[name] = answers[index] ? 'pass' : 'fail';
        });

        const healthy = database && answers.every(Boolean);
        const status: HealthStatus = !draining && healthy ? 'pass' : 'fail';

        const report: HealthReport = { status, uptime };
        if (config.details) report.version = sources.version;
        if (config.details || status === 'fail') report.checks = checks;

        // 503 and not 500: this is "not able to serve right now", which is
        // what a probe is asking, and what tells a balancer to retry later.
        response.status(status === 'pass' ? 200 : 503).json(report);
      } catch (error) {
        next(error);
      }
    })();
  };
}
