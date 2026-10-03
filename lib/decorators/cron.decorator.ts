import cron from 'node-cron';
import { Routine } from '../templates/routine';
import type { ScheduleToken } from '../modules/schedules';

/**
 * Which schedule this routine runs on, and when.
 *
 * The token comes first because it is the identity: it is what `app.schedule()`
 * and `this.schedule()` start and stop, and a schedule nobody can address is a
 * schedule nobody can pause. The expression is the WHEN — it IS a cron
 * expression, so the decorator says so: five fields
 * (`minute hour day month weekday`) or six with seconds first.
 *
 * Both are checked when this file is imported, not at boot: an unknown token
 * kind and a malformed expression are otherwise a routine that silently never
 * runs.
 *
 * `timezone` is worth setting on purpose: without it the expression is read in
 * the timezone of whatever machine the process ended up on, which is how a
 * "7am" routine ends up running at 2am on a server abroad.
 *
 * @example
 * export const DailySummary = token('reports.daily-summary', 'schedule');
 *
 * \@Cron(DailySummary, '0 7 * * *', { timezone: 'America/Lima' })
 * export class DailySummaryRoutine extends Routine { ... }
 *
 * @example
 * // Deployed, addressable, and not running until somebody starts it.
 * \@Cron(NightlyBackup, '0 3 * * *', { autostart: false })
 * export class BackupRoutine extends Routine { ... }
 */
export const CRON = Symbol('__cron__');

/**
 * What `@Cron` takes beside the expression.
 *
 * node-cron's own options, minus two that samble owns: `scheduled`, which is
 * replaced by {@link CronOptions.autostart} and applied through the runner so
 * the schedule stays startable, and `name`, which the token already is.
 */
export interface CronOptions extends Omit<
  cron.ScheduleOptions,
  'scheduled' | 'name'
> {
  /**
   * Whether the clock starts by itself once the server is listening. Defaults
   * to `true`.
   *
   * `false` is for a schedule whose moment is decided by the application rather
   * than by the deployment — a sync somebody triggers, a schedule an operator
   * turns on from a screen. It is registered and addressable either way, so
   * `this.schedule(Token).start()` is what turns it on.
   */
  autostart?: boolean;
}

export interface CronMetadata {
  token: ScheduleToken;
  expression: string;
  /** What reaches node-cron, with samble's own options taken out. */
  options: cron.ScheduleOptions;
  autostart: boolean;
}

export function Cron(
  token: ScheduleToken,
  expression: string,
  options: CronOptions = {},
) {
  const kind = (token as { kind?: string } | null | undefined)?.kind;

  if (kind === 'contract' || kind === 'slot') {
    throw new Error(
      `@Cron() takes a schedule token, and got a ${kind}. A schedule is addressed on its own: declare it with token(id, 'schedule'), which is what start() and stop() take.`,
    );
  }

  if (kind !== 'schedule') {
    throw new Error(
      `@Cron() takes a schedule token as its first argument, and got ${JSON.stringify(
        token,
      )}. Declare one with token(id, 'schedule'), then pass the cron expression.`,
    );
  }

  if (typeof expression !== 'string' || !cron.validate(expression)) {
    throw new Error(
      `@Cron(${token.id}): ${JSON.stringify(
        expression,
      )} is not a cron expression. Five fields (minute hour day month weekday), or six with seconds first — "0 7 * * *" is every day at 07:00.`,
    );
  }

  const { autostart = true, ...rest } = options;

  return function (RoutineClass: new () => Routine) {
    Reflect.defineMetadata(
      CRON,
      { token, expression, options: rest, autostart } as CronMetadata,
      RoutineClass,
    );
  };
}
