import { eq } from 'drizzle-orm';
import { Provider, Provides } from '../../../../lib';
import { UserProjection, type PublicUser } from '../domain/user.projection';
import { UserDirectory } from '../tokens/user-directory.token';
import { users } from '../tables/user.table';

/**
 * The half the consumer never sees. Change how users are stored and nothing
 * outside this file moves.
 */
@Provides(UserDirectory)
export class UserDirectoryProvider extends Provider implements UserDirectory {
  public count(): Promise<number> {
    return this.db.$count(users);
  }

  public async find(userId: number): Promise<PublicUser | null> {
    const [user] = await this.db
      .select(UserProjection.columns)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }
}
