import { Database } from '../modules/database';
import type { Container, Contract } from '../modules/container';
import type { Reaction, Slot } from '../modules/slots';
import type {
  ScheduleHandle,
  Scheduler,
  ScheduleToken,
} from '../modules/schedules';

/**
 * Work the application does on its own, on a clock.
 *
 * The third way into an application, next to {@link Endpoint} (answers a
 * request) and a {@link Strategy} (one implementation among however many are
 * deployed): nobody calls a routine, the clock does. It gets `db`, contracts and
 * the slots injected the same way, so it can do anything an endpoint can — it
 * just has no request and nobody waiting for an answer.
 *
 * The WHEN is the `@Cron` decorator; this class is the WHAT.
 *
 * A routine belongs to its module: it is discovered under that module's
 * `routines/`, scheduled once the HTTP server is listening, and cleared on
 * shutdown. A boot that failed never leaves a clock running.
 *
 * @example
 * \@Cron('0 7 * * *')
 * export default class DailySummary extends Routine {
 *   public async start(): Promise<void> {
 *     const total = await this.get(ProductCatalog).count();
 *     await this.notify(SummaryReady, { total });
 *   }
 * }
 */
export abstract class Routine {
  public db: Database;

  /** Container of the application this routine belongs to, injected like `db`. */
  public container?: Container;

  /** Scheduler of this application, injected like `db`. */
  public scheduler?: Scheduler;

  /**
   * Resolves a contract another module provides. Same rule as an endpoint: the
   * routine knows the contract, never the implementation.
   */
  protected get<T>(token: Contract<T>): T {
    if (!this.container) {
      throw new Error(
        `Cannot resolve the contract "${token.id}": this application has no modules. Start it with Samble.create({ modules }).`,
      );
    }
    return this.container.get(token);
  }

  /**
   * Everything the installed modules contributed to an extension point.
   *
   * Where {@link get} asks ONE module for a capability, this asks whoever
   * showed up. An empty array is a normal answer: a slot nobody filled is a
   * feature nobody installed.
   *
   * Contributions come from whatever modules are present, so a deployment
   * without that module answers one item short — a payment method, a channel,
   * a report.
   *
   * @example
   * const methods = this.all(PaymentMethods);
   * return methods.map((m) => ({ id: m.id, label: m.label }));
   */
  protected all<T>(target: Slot<T>): T[] {
    if (!this.container) {
      throw new Error(
        `Cannot read the extension point "${target.id}": this application has no modules. Start it with Samble.create({ modules }).`,
      );
    }
    return this.container.all(target);
  }

  /**
   * Announces something to whoever filled an extension point, and reads nothing
   * back.
   *
   * The counterpart of {@link all}: that one hands the contributions over for
   * you to call, this one calls every one of them with what happened and
   * discards the answers. The difference that matters is whose failure it is —
   * a reaction that throws is logged with its module and the rest still run, so
   * announcing something cannot break you. When the outcome matters, that is a
   * contract.
   *
   * It is awaited: it resolves once every reaction settled, so a slow reaction
   * still slows this down. It is not a queue.
   *
   * GOTCHA: reactions read on their own connection. Announcing inside
   * `db.transaction()` means they cannot see the uncommitted rows — announce
   * after it commits, or put what they need in the payload.
   *
   * @example
   * await this.notify(ProductRestocked, { productId, stock });
   */
  protected async notify<T>(
    target: Slot<Reaction<T>>,
    payload: T,
  ): Promise<void> {
    if (!this.container) {
      throw new Error(
        `Cannot announce "${target.id}": this application has no modules. Start it with Samble.create({ modules }).`,
      );
    }
    await this.container.notify(target, payload);
  }

  /**
   * The handle of a schedule: `start()`, `stop()`, `runNow()`.
   *
   * What it is for is the schedule an operator decides, not the deployment: a
   * sync somebody triggers, a nightly job that gets paused during a migration.
   * `start()` on something already running does nothing and says so, so the
   * same button pressed twice cannot produce two clocks.
   *
   * @example
   * const backup = this.schedule(NightlyBackup);
   * backup.start();
   * return { running: backup.isRunning() };
   */
  protected schedule(token: ScheduleToken): ScheduleHandle {
    if (!this.scheduler) {
      throw new Error(
        `Cannot reach the schedule "${token.id}": this application has no scheduler. Start it with Samble.create({ modules }).`,
      );
    }
    return this.scheduler.handle(token);
  }

  /**
   * What the routine does.
   *
   * `now` is the moment the schedule fired, and the two strings come from
   * node-cron: `'init'` when the routine was declared with
   * `@Cron(expression, { runOnInit: true })` and runs once at startup, and
   * `'manual'` for a tick nothing scheduled. Branch on it when the routine
   * should behave differently the first time — and remember `now` is not
   * always a Date.
   *
   * Throwing here does not stop the schedule: the next tick runs anyway, which
   * is what keeps one bad night from silently disabling a routine forever.
   */
  abstract start(now: Date | 'manual' | 'init'): any;
}
