import { AuthError, AuthResolver } from '../../../lib';

declare global {
  namespace SambleAuth {
    interface Actor {
      userId: number;
    }
  }
}

/**
 * Stands in for a real application's resolver: reads headers instead of a
 * session, which is the whole point — the endpoints cannot tell.
 */
export const testAuthResolver: AuthResolver = (request) => {
  const raw = request.headers['x-user'];
  if (!raw) return null;
  if (raw === 'roto') throw new AuthError('Malformed credential.');

  const perms = request.headers['x-perms'];
  return {
    actor: { userId: Number(raw) },
    permissions: typeof perms === 'string' ? perms.split(',') : [],
  };
};
