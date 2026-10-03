import { asc } from 'drizzle-orm';
import { Endpoint, HttpGet, Group } from '../../../../lib';
import { UserProjection } from '../domain/user.projection';
import { users } from '../tables/user.table';

@Group('users')
@HttpGet()
export class ListUsersEndpoint extends Endpoint {
  main() {
    // 401 when anonymous, 403 when signed in without the key.
    this.auth.assert('identity.users.view');

    return this.db
      .select(UserProjection.columns)
      .from(users)
      .orderBy(asc(users.id));
  }
}
