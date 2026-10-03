import { token } from '../../../../lib';
import type { PublicUser } from '../domain/user.projection';

/**
 * What other modules may ask about users — WITHOUT importing anything else
 * from here. They import this file; the implementation stays private.
 *
 * `PublicUser` is the exception, and it is the point: what crosses this
 * boundary is the projection, not the row. The same shape would be the API an
 * out-of-process extension sees.
 *
 * The interface and the token share a name on purpose: TypeScript keeps types
 * and values in separate namespaces, so one import gives you both the shape
 * the compiler checks and the identity the container resolves.
 */
export interface UserDirectory {
  count(): Promise<number>;
  find(userId: number): Promise<PublicUser | null>;
}

export const UserDirectory = token<UserDirectory>(
  'identity.directory',
  'contract',
);
