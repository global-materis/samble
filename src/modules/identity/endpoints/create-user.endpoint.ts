import { eq } from 'drizzle-orm';
import {
  Body,
  CustomerError,
  Endpoint,
  HttpPost,
  HttpStatus,
  Group,
} from '../../../../lib';
import { UserProjection } from '../domain/user.projection';
import { CreateUserDto } from '../dto/create-user.dto';
import { users } from '../tables/user.table';
import { hashPassword } from '../services/password';

@Group('users')
@HttpPost()
@Body(CreateUserDto)
export class CreateUserEndpoint extends Endpoint<null, CreateUserDto> {
  async main() {
    this.auth.assert('identity.users.manage');

    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, this.body.username))
      .limit(1);

    if (taken) {
      throw new CustomerError('That username is taken.', {
        username: 'Already in use',
      });
    }

    const [user] = await this.db
      .insert(users)
      .values({
        username: this.body.username,
        fullName: this.body.fullName,
        password: hashPassword(this.body.password),
        role: this.body.role,
      })
      .returning(UserProjection.columns);

    this.httpStatus = HttpStatus.CREATED;
    return user;
  }
}
