import type { Contract } from '../modules/container';
import { Provider } from '../templates/provider';

/** Where a {@link Provider} plugs in: the contract it answers. */
export const PROVIDES = Symbol('__provides__');

export interface ProvidesMetadata {
  target: Contract<unknown>;
}

/**
 * Declares the contract this class is the implementation of.
 *
 * A contract ONLY. An extension point is a different relationship — as many
 * answers as are deployed, all of them read by the module that opened it — so
 * it has its own decorator and its own base class: `@Fills` on a `Strategy`.
 * One decorator for both would mean a diff
 * could not tell a contract's implementation from a contribution to somebody
 * else's extension point without opening the token's file.
 *
 * @example
 * \@Provides(UserDirectory)
 * export class UserDirectoryProvider
 *   extends Provider
 *   implements UserDirectory {}
 */
export function Provides<T>(target: Contract<T>) {
  const kind = (target as { kind?: string } | null | undefined)?.kind;

  if (kind === 'slot') {
    throw new Error(
      `@Provides() takes a contract, and got an extension point. An extension point takes as many answers as are deployed: use @Fills() on a class extending Strategy, in the module's strategies/ folder.`,
    );
  }

  if (kind === 'schedule') {
    throw new Error(
      `@Provides() takes a contract, and got a schedule. Nothing provides a schedule: a Routine runs on it, declared with @Cron(token, expression).`,
    );
  }

  if (kind !== 'contract') {
    throw new Error(
      `@Provides() takes a contract, and got something that is not a token. Declare one with token(id, 'contract').`,
    );
  }

  return function (ProviderClass: new () => Provider) {
    Reflect.defineMetadata(
      PROVIDES,
      { target } as ProvidesMetadata,
      ProviderClass,
    );
  };
}
