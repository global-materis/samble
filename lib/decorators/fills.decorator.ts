import type { Slot } from '../modules/slots';
import { Strategy } from '../templates/strategy';

/** Where a {@link Strategy} plugs in: the extension point it fills. */
export const FILLS = Symbol('__fills__');

export interface FillsMetadata {
  target: Slot<unknown>;
}

/**
 * Declares the extension point this strategy fills.
 *
 * Separate from `@Provides` on purpose, and that is the whole point of it: a
 * contract has exactly one answer and an extension point takes as many as are
 * deployed, so the two are different relationships. One decorator for both
 * meant a diff could not tell them apart without opening the token's file,
 * which is where a reviewer stops reading.
 *
 * @example
 * \@Fills(PaymentMethods)
 * export class CashMethod extends Strategy implements PaymentMethod {
 *   public readonly id = 'cash';
 *   public readonly label = 'Cash';
 * }
 */
export function Fills<T>(target: Slot<T>) {
  const kind = (target as { kind?: string } | null | undefined)?.kind;

  if (kind === 'contract') {
    throw new Error(
      `@Fills() takes an extension point, and got a contract. A contract has exactly one answer: use @Provides() on a class extending Provider, in the module's providers/ folder.`,
    );
  }

  if (kind === 'schedule') {
    throw new Error(
      `@Fills() takes an extension point, and got a schedule. Nothing fills a schedule: a Routine runs on it, declared with @Cron(token, expression).`,
    );
  }

  if (kind !== 'slot') {
    throw new Error(
      `@Fills() takes an extension point, and got something that is not a token. Declare one with token(id, 'slot').`,
    );
  }

  return function (StrategyClass: new () => Strategy) {
    Reflect.defineMetadata(FILLS, { target } as FillsMetadata, StrategyClass);
  };
}
