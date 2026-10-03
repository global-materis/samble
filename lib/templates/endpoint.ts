import { Request, Response } from 'express';
import { Database } from '../modules/database';
import { HttpStatus } from '../interfaces/http-status';
import type { UploadedFile } from '../interfaces/uploaded-file';
import { Auth } from '../core/auth';
import type {
  ScheduleHandle,
  Scheduler,
  ScheduleToken,
} from '../modules/schedules';
import type { Container, Contract } from '../modules/container';
import type { Reaction, Slot } from '../modules/slots';
import type { Output } from '../outputs/output';

export type DataJson =
  Record<string, any> | Response<any, Record<string, any>> | Output | null;

/**
 * Endpoint parents
 * @template P Params data
 * @template B Body data
 * @template Q Queries data
 */
export abstract class Endpoint<
  P extends Record<string, any> | null = null,
  B extends Record<string, any> | null = null,
  Q extends Record<string, any> | null = null,
> {
  public body: B;
  public params: P;
  public query: Q;
  public file: UploadedFile;
  public files:
    | {
        [fieldname: string]: UploadedFile[];
      }
    | UploadedFile[];
  public request: Request<P, any, B, Q>;
  public response: Response;
  public db: Database;
  public httpStatus: HttpStatus = HttpStatus.OK;

  /**
   * The id of this request: the same string in the `x-request-id` header the
   * caller got back, in every log line written while serving it, and in the
   * error body if it failed.
   *
   * Worth putting in whatever you record — an audit row, a job you enqueue, a
   * call to another service — because that is what ties a user saying "it
   * failed" to the lines that say why.
   */
  public get requestId(): string {
    return (this.request as { requestId?: string }).requestId ?? '';
  }

  /**
   * Who is making this request, and what they may do.
   *
   * Filled by the application's `auth` resolver, so the endpoint never learns
   * where the identity came from — a cookie session, a bearer token from the
   * mobile app, an API key from a third-party extension all arrive here the
   * same way.
   *
   * GOTCHA: per-request state, assigned AFTER the instance is built. Not
   * readable from the constructor or a field initializer (`db` and `container`
   * are).
   *
   * @example
   * const userId = this.auth.actor.userId;   // 401 if anonymous
   * this.auth.assert('billing.void');        // 403 if not allowed
   * if (this.auth.optional) { ... }          // public endpoint
   */
  public auth: Auth = new Auth();

  /**
   * Container of the application this endpoint belongs to. Injected on the
   * prototype like `db`, so it is available before the instance is built.
   */
  public container?: Container;

  /** Scheduler of this application, injected like `db`. */
  public scheduler?: Scheduler;

  /**
   * Resolves a contract another module provides.
   *
   * The endpoint imports the contract, never the implementation — which is
   * what lets the providing module change, or be swapped, without touching
   * anyone who calls it.
   *
   * @example
   * const billing = this.get(BillingService);
   * await billing.emitirCargo({ ... });
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
   * Runs before {@link main}, inside the instance.
   *
   * Kept while `error()` and `final()` were dropped because it is the only
   * guard that sees validated state: `this.params`, `this.body` and
   * `this.auth` are already there, where a `@Use` middleware only gets the raw
   * request. Throwing from here skips `main()` and maps like any other error.
   */
  public previous(): void | Promise<void> {}

  /**
   * Main method of the endpoint.
   *
   * Returns the data to answer with — serialized as JSON — or one of the
   * outputs (`view()`, `pdf()`, `csv()`, `file()`) when the answer is not
   * JSON. Returning `null` answers an empty body.
   */
  public abstract main(): DataJson | Promise<DataJson>;
}
