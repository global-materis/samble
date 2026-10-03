import { Database } from '../modules/database';
import type { Container, Contract } from '../modules/container';
import type { Reaction, Slot } from '../modules/slots';
import type {
  ScheduleHandle,
  Scheduler,
  ScheduleToken,
} from '../modules/schedules';

/**
 * One implementation of a domain interface another module opened.
 *
 * The interface belongs to the HOST: `catalog` decides what a product badge
 * is, what it receives and what it may answer. A strategy implements that
 * interface and nothing else — it is not its module's public face, nobody asks
 * for it by name, and the only thing it ever sees is what the host passes.
 *
 * Which is exactly how it differs from a {@link Provider}:
 *
 * | | Answers to | How many | Who calls it |
 * | --- | --- | --- | --- |
 * | {@link Provider} | a contract, with `@Provides` | exactly one | whoever resolved it |
 * | **Strategy** | an extension point, with `@Fills` | as many as are deployed | **the host, and only the host** |
 *
 * Two consequences worth knowing before writing one:
 *
 * - **Whose failure it is depends on how the host reads the slot.** With
 *   `all()` the host calls you directly, so throwing fails its request. With
 *   `notify()` the failure is logged with this module's id and the host answers
 *   anyway — which is what the host picks when the slot is for side effects.
 * - **It is built once and reused** for the life of the application, so it is
 *   effectively a singleton. Never keep per-request state in one.
 *
 * @example
 * \@Fills(ProductBadges)
 * export class LowStockBadge extends Strategy implements ProductBadge {
 *   public readonly id = 'low-stock';
 *
 *   public for(product: { stock: number }): string | null {
 *     return product.stock < 10 ? 'Low stock' : null;
 *   }
 * }
 */
export abstract class Strategy {
  /** The open connection, injected before the instance is built. */
  public db: Database;

  /** Container of the application this strategy belongs to. */
  public container?: Container;

  /** Scheduler of this application, injected like `db`. */
  public scheduler?: Scheduler;

  /**
   * Resolves a contract. A strategy may depend on contracts like anything
   * else — including one the host provides.
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
   * Everything contributed to an extension point.
   *
   * Reading the slot this very class fills is reported instead of recursing
   * until the stack gives out.
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
