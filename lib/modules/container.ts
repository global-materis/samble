import { AsyncLocalStorage } from 'node:async_hooks';
import { Database } from './database';
import { Logger } from '../utilities/logger';
import type { Provider } from '../templates/provider';
import type { Strategy } from '../templates/strategy';
import type { Scheduler } from './schedules';
import type { Reaction, Slot } from './slots';

/**
 * A capability one module publishes and others consume.
 *
 * It carries its type at compile time and its identity at run time, so a
 * consumer imports *this* — never the implementation, which stays private to
 * the module that owns it. That asymmetry is what lets a module be swapped or
 * removed without its consumers knowing.
 *
 * Declared with `token(id, 'contract')`.
 */
export interface Contract<T> {
  readonly id: string;
  /**
   * Set by `token()`, and the only place this is written down. Without it the
   * three kinds of token would be structurally identical and each could be
   * passed where another goes, which is the one confusion that matters here: a
   * contract has exactly one provider and a slot has as many as are deployed.
   */
  readonly kind: 'contract';
  /** Phantom field: carries T so `get()` returns the right type. Never set. */
  readonly __type?: T;
}

/** A class that implements a contract. */
export type ProviderClass = new () => Provider;

/** A class that fills an extension point. */
export type StrategyClass = new () => Strategy;

export class ContractError extends Error {
  constructor(
    message: string,
    public contractId: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

interface Registration {
  ProviderClass: ProviderClass;
  moduleId: string;
  instance?: unknown;
  resolving?: boolean;
}

interface SlotRegistration {
  StrategyClass: StrategyClass;
  moduleId: string;
}

/**
 * Holds the contracts the modules publish, and hands them out.
 *
 * One container per application rather than a process-wide singleton: two
 * applications in one process — a test suite, a worker beside a server — must
 * not see each other's implementations.
 *
 * Implementations are built the first time they are asked for, not at startup.
 * A module that is never called never pays for its dependencies, and startup
 * does not hang on something only one endpoint needs.
 */
export class Container {
  private registry = new Map<string, Registration>();
  private slots = new Map<string, SlotRegistration[]>();
  /** Built contributions per slot, cached like a contract's instance. */
  private filled = new Map<string, unknown[]>();
  /**
   * The slot a `notify()` is currently announcing, scoped to the async context
   * of that call.
   *
   * A plain `Set` would be wrong here and it is worth saying why: `notify()`
   * awaits, so two concurrent requests would each see the other's entry and
   * refuse a cascade that is not one. `AsyncLocalStorage` scopes it to the one
   * chain of calls, which is exactly what "a reaction announced something" is.
   */
  private readonly announcing = new AsyncLocalStorage<string>();
  private scheduler?: Scheduler;
  private resolvingSlots = new Set<string>();

  constructor(private readonly db: Database) {}

  /**
   * Registers what a module provides.
   *
   * Two modules publishing the same contract is an error: whoever consumed it
   * would get one of them by load order, which is the kind of bug that changes
   * between deploys.
   */
  register(
    moduleId: string,
    token: Contract<unknown>,
    ProviderClass: ProviderClass,
  ): void {
    const { id } = token;
    const existing = this.registry.get(id);

    if (existing) {
      throw new ContractError(
        `Contract "${id}" is provided by both "${existing.moduleId}" and "${moduleId}". Exactly one module can provide it.`,
        id,
      );
    }

    this.registry.set(id, { ProviderClass, moduleId });
  }

  has<T>(token: Contract<T>): boolean {
    return this.registry.has(token.id);
  }

  /** Which module provides a contract, for diagnostics. */
  providerOf<T>(token: Contract<T>): string | null {
    return this.registry.get(token.id)?.moduleId ?? null;
  }

  /** Every registered contract id, for startup reporting. */
  ids(): string[] {
    return [...this.registry.keys()];
  }

  get<T>(token: Contract<T>): T {
    const registration = this.registry.get(token.id);

    if (!registration) {
      throw new ContractError(
        `No module provides the contract "${token.id}". Check that the module providing it is installed.`,
        token.id,
      );
    }

    if ('instance' in registration && registration.instance !== undefined) {
      return registration.instance as T;
    }

    // Two implementations asking for each other would recurse until the stack
    // gives out, with a trace that says nothing about which contracts are at
    // fault.
    if (registration.resolving) {
      throw new ContractError(
        `Contract "${token.id}" is being resolved while it is still being built: its implementation depends on itself.`,
        token.id,
      );
    }

    registration.resolving = true;
    try {
      registration.instance = this.build(registration.ProviderClass);
      return registration.instance as T;
    } finally {
      registration.resolving = false;
    }
  }

  /**
   * Records what a module contributes to an extension point.
   *
   * Unlike a contract, MORE THAN ONE is the normal case — refusing a second
   * one would defeat the purpose. Order is the order modules are registered in,
   * which by the time this runs is dependency order, so it is stable across
   * boots.
   */
  public contribute(
    moduleId: string,
    target: Slot<unknown>,
    StrategyClass: StrategyClass,
  ): void {
    const current = this.slots.get(target.id) ?? [];
    current.push({ StrategyClass, moduleId });
    this.slots.set(target.id, current);
  }

  /**
   * Everything the modules contributed to an extension point.
   *
   * An empty array is a normal answer: an extension point nobody filled is a
   * feature nobody installed, not an error.
   *
   * Built on first use and cached, like a contract's implementation.
   */
  public all<T>(target: Slot<T>): T[] {
    const cached = this.filled.get(target.id);
    if (cached) return cached as T[];

    const registrations = this.slots.get(target.id);
    if (!registrations || registrations.length === 0) return [];

    // A contribution whose factory asks for its own slot would recurse until
    // the stack gives out, with a trace naming nothing useful.
    if (this.resolvingSlots.has(target.id)) {
      throw new ContractError(
        `Extension point "${target.id}" is being filled while it is still being filled: a contribution asks for the slot it belongs to.`,
        target.id,
      );
    }

    this.resolvingSlots.add(target.id);
    try {
      const built = registrations.map(({ StrategyClass }) =>
        this.build(StrategyClass),
      );
      this.filled.set(target.id, built);
      return built as T[];
    } finally {
      this.resolvingSlots.delete(target.id);
    }
  }

  /**
   * Announces something to whoever filled an extension point, and reads nothing
   * back.
   *
   * The other way to read a slot. Where {@link all} hands the contributions over
   * for the caller to use, this CALLS every one of them with what happened and
   * discards the answers — and the difference that matters is whose failure it
   * is: a reaction that throws is logged with its module id, the others still
   * run, and whoever announced it answers normally. That guarantee is the only
   * thing the event bus ever added over a slot, which is why it is here and the
   * bus is gone.
   *
   * It resolves once every reaction settled, so it is awaited: this is not a
   * queue, and a slow reaction still slows the request. When the work must
   * outlive the request, that is a job and samble does not have one yet.
   *
   * A slot nobody filled is a no-op, which is the normal case for an extension
   * point nobody installed.
   *
   * @example
   * await this.notify(ProductRestocked, { productId, stock });
   */
  public async notify<T>(target: Slot<Reaction<T>>, payload: T): Promise<void> {
    const registrations = this.slots.get(target.id);
    if (!registrations || registrations.length === 0) return;

    // One hop, and no further. A reaction that announces something of its own
    // is how "why was this email sent" stops having an answer: A triggers B
    // triggers C, and the trace names none of them. Refused by name instead.
    const from = this.announcing.getStore();
    if (from) {
      throw new ContractError(
        `Extension point "${target.id}" is being announced from inside a reaction to "${from}". A reaction must not announce another one: have the host announce both, or make the second one a contract so the dependency is visible.`,
        target.id,
      );
    }

    const reactions = this.all(target);

    const settled = await this.announcing.run(target.id, () =>
      // `async` and not a bare call: `Promise.allSettled` only catches a
      // REJECTED promise, so a reaction that throws synchronously would escape
      // the mapper and fail the announcer — defeating the one guarantee this
      // method exists for. The wrapper turns the throw into a rejection.
      Promise.allSettled(
        reactions.map(async (reaction) => reaction.on(payload)),
      ),
    );

    settled.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const { StrategyClass, moduleId } = registrations[index];
      Logger.error(
        `Reaction ${StrategyClass.name} (module "${moduleId}") failed on "${target.id}"`,
        result.reason,
      );
    });
  }

  /** Extension points with at least one contribution, for the startup log. */
  public slotIds(): string[] {
    return [...this.slots.keys()];
  }

  /** How many modules filled an extension point. */
  public countFor<T>(target: Slot<T>): number {
    return this.slots.get(target.id)?.length ?? 0;
  }

  /**
   * Hands the container the scheduler, so a provider or a strategy can start
   * and stop a schedule. Set afterwards for the same reason as the bus: the
   * scheduler needs the container to build its routines.
   */
  public useScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler;
  }

  /**
   * Builds an implementation.
   *
   * `db`, `container` and `scheduler` go on the PROTOTYPE first, so a field
   * initializer — `private readonly users = this.db.getRepository(User)` —
   * already has them when the constructor runs. Then they are copied onto the
   * instance, which pins them: a second application in the same process
   * registering the same class cannot change what this one already built.
   */
  private build(UnitClass: ProviderClass | StrategyClass): unknown {
    const proto = UnitClass.prototype;
    proto.db = this.db;
    proto.container = this;
    proto.scheduler = this.scheduler;

    const instance = new UnitClass();
    instance.db = this.db;
    instance.container = this;
    instance.scheduler = this.scheduler;

    return instance;
  }
}
