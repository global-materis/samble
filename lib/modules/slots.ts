/**
 * An open extension point: a place one module defines and MANY may fill.
 *
 * It is the third way modules meet, and the three are not interchangeable:
 *
 * - a **contract** has exactly one provider — "give me the billing service";
 * - a **slot** has any number of contributions, and the definer either READS
 *   them — "whoever can take a payment, step forward" — or ANNOUNCES into them
 *   with `notify()` — "this happened, for whoever cares".
 *
 * Slots are what a third-party extension plugs into: `billing` does not know
 * the payment methods that will exist, so it defines the shape and enumerates
 * whatever is installed.
 *
 * Declared with `token(id, 'slot')`, where the type is the shape of ONE
 * contribution.
 *
 * @example
 * export interface PaymentMethod {
 *   id: string;
 *   label: string;
 *   charge(amount: number): Promise<void>;
 * }
 * export const PaymentMethods = token<PaymentMethod>(
 *   'billing.payment-methods',
 *   'slot',
 * );
 */
export interface Slot<T> {
  readonly id: string;
  /** Set by `token()`. Tells a slot from a contract and from a schedule. */
  readonly kind: 'slot';
  /** Phantom field: carries T so `all()` returns the right type. Never set. */
  readonly __type?: T;
}

/**
 * One reaction to something that happened.
 *
 * The shape a slot takes when the host is ANNOUNCING rather than asking: the
 * host passes what happened and reads nothing back. It is what `notify()`
 * accepts, and the `void` return is not a detail — it is the whole difference
 * between the two ways of reading a slot:
 *
 * | | What it does | Whose failure it is |
 * | --- | --- | --- |
 * | `all(Token)` | hands you the contributions, you call them | **yours** |
 * | `notify(Token, payload)` | calls every one, discards the answers | **theirs** |
 *
 * There used to be a separate mechanism for this — an event bus, a `Listener`
 * base class and an `@On` decorator — and all it added over a slot was that one
 * guarantee about whose failure it is. So the guarantee stayed and the
 * mechanism went: a reaction is an ordinary `Strategy` filling an ordinary
 * slot, and the verb at the call site is what says the announcer cannot be
 * broken by it.
 *
 * @example
 * export interface RestockPayload {
 *   productId: number;
 *   stock: number;
 * }
 * export const ProductRestocked = token<Reaction<RestockPayload>>(
 *   'catalog.product.restocked',
 *   'slot',
 * );
 */
export interface Reaction<T> {
  /**
   * Handles what happened.
   *
   * Throwing does NOT fail whoever announced it: the failure is logged with
   * this module's id and the other reactions still run. If the outcome matters
   * to the caller, it wants a contract, not this.
   */
  on(payload: T): void | Promise<void>;
}
