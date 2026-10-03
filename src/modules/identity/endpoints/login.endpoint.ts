import { eq } from 'drizzle-orm';
import {
  Body,
  CustomerError,
  Endpoint,
  HttpPost,
  Group,
} from '../../../../lib';
import { LoginDto } from '../dto/login.dto';
import { UserProjection } from '../domain/user.projection';
import { users } from '../tables/user.table';
import { verifyPassword } from '../services/password';

/**
 * The ONLY place that writes to the session. Everywhere else reads the actor
 * through `this.auth`, which is what lets the transport change (a token, an
 * API key) without touching any other endpoint.
 */
@Group('auth')
@HttpPost('login')
@Body(LoginDto)
export class LoginEndpoint extends Endpoint<null, LoginDto> {
  async main() {
    // `loginColumns` instead of a bare `select()`: this is the one case that
    // may see the hash, and saying so is what tells it apart from a place
    // that forgot.
    const [user] = await this.db
      .select(UserProjection.loginColumns)
      .from(users)
      .where(eq(users.username, this.body.username))
      .limit(1);

    // Same answer for "no such user" and "wrong password", on purpose.
    if (!user || !verifyPassword(this.body.password, user.password)) {
      throw new CustomerError('Wrong username or password.');
    }

    // The session holds the id and nothing else. Permissions are resolved per
    // request by the auth resolver, through this module's contract.
    this.request.session.userId = user.id;

    return UserProjection.asPublic(user);
  }
}
