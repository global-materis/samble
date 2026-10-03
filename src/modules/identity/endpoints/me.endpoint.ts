import { Endpoint, HttpGet, Group } from '../../../../lib';

/** Reads the actor without touching the session. */
@Group('auth')
@HttpGet('me')
export class MeEndpoint extends Endpoint {
  main() {
    // `optional` instead of `actor`: this endpoint answers the anonymous too,
    // so it must not throw.
    if (!this.auth.isAuthenticated) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      userId: this.auth.actor.userId,
      permissions: this.auth.permissions,
    };
  }
}
