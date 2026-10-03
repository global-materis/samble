import { users, type User } from '../tables/user.table';

/** What a user is, seen from OUTSIDE this module. */
export type PublicUser = Pick<User, 'id' | 'username' | 'fullName' | 'role'>;

/**
 * The shape a user has when it leaves this module, in one place.
 *
 * This replaces a rule that was written three times, in three comments, in
 * three endpoints — name the columns, the password must not leave the process
 * — while the one place that legitimately needs the hash looked exactly like a
 * place that had forgotten. Here the safe shape is the default and the
 * exception has a name.
 *
 * A class with statics and no instances: the members belong together and are
 * found together, and the call site says where the rule lives
 * (`UserProjection.asPublic(row)`) instead of importing three loose names.
 *
 * Nothing here runs a query or touches `db`. It declares which columns a
 * caller may ask for, and converts a row someone already has. That is what
 * makes it testable with no database, and what makes it the same artifact
 * whether the caller is another module or something outside the process.
 */
export class UserProjection {
  /** A namespace for the rule, not something to instantiate. */
  private constructor() {}

  /** The default. Pass it to `select()` and the hash never leaves Postgres. */
  public static readonly columns = {
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
  };

  /**
   * The only column set that carries the hash — named after the case that
   * needs it, not after the field, so `grep loginColumns` is the entire audit
   * of who may see it. A sensitive column added to the table joins neither set
   * on its own.
   */
  public static readonly loginColumns = {
    ...UserProjection.columns,
    password: users.password,
  };

  /**
   * For a row already in hand.
   *
   * Written out field by field, never spread: a spread carries whatever the
   * row happens to have, which is the failure this class exists to prevent.
   */
  public static asPublic(row: PublicUser): PublicUser {
    return {
      id: row.id,
      username: row.username,
      fullName: row.fullName,
      role: row.role,
    };
  }
}
