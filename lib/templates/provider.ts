import type { Database } from '../modules/database';
import type { Container, Contract } from '../modules/container';
import type { Reaction, Slot } from '../modules/slots';
import type {
  ScheduleHandle,
  Scheduler,
  ScheduleToken,
} from '../modules/schedules';

/**
 * How a module answers a contract, or fills someone else's extension point.
 *
 * It is the implementation that a token deliberately leaves out: the consumer
 * imports the token, never this. Which one it answers is the `@Provides`
 * decorator — the same one whether the token is a contract or an extension
 * point — and the file lives in the module's `providers/` folder, so nothing
 * lists it.
 *
 * A class and not a function on purpose. A decorator cannot be put on an
 * object literal or an arrow function, so the class is what makes the folder
 * work at all — the same reason an endpoint, a routine and a listener are
 * classes. And it is where most of a module's real work ends up living, which
 * is exactly what should not be inside `module.ts`.
 *
 * Built the FIRST time someone asks for it and then reused, so a contract
 * nobody calls costs nothing.
 *
 * @example
 * \@Provides(UserDirectory)
 * export class UserDirectoryProvider
 *   extends Provider
 *   implements UserDirectory
 * {
 *   private readonly users = this.db.getRepository(User);
 *
 *   count() {
 *     return this.users.count();
 *   }
 * }
 */
export abstract class Provider {
  /** The open connection, injected before the instance is built. */
  public db: Database;

  /** Container of the application this provider belongs to. */
  public container?: Container;

  /** Scheduler of this application, injected like `db`. */
  public scheduler?: Scheduler;

  /**
   * Resolves another contract. Same rule as everywhere else: this knows the
   * contract, never who implements it.
   *
   * Two implementations asking for each other is caught by name at boot rather
   * than recursing until the stack gives out.
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
   * An empty array is a normal answer: a slot nobody filled is a feature
   * nobody installed.
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
}
