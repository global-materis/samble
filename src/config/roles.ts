import type { PermissionKey } from '../../lib';
import { UserRole } from '../modules/identity/tables/user.table';

/**
 * Role -> permission keys.
 *
 * It lives HERE, with the application's own configuration, and not inside a
 * module, because it is the application's policy: which keys somebody holds is
 * a decision about this business, while a module only declares which keys
 * EXIST (its manifest).
 *
 * To grant everything one module has, spread its keys instead of listing them:
 * `[...catalog.permissionKeys]`. That stays right when the module gains a key.
 *
 * `PermissionKey` is why these are plain strings and still safe: it resolves to
 * the union of everything the installed modules declare (see
 * `config/permissions.ts`), so a key renamed in a module stops compiling here.
 *
 * samble never sees this file. It receives the resulting list of strings from
 * the resolver and compares them. Swap it for a table of roles in the database
 * and nothing else changes — but a list read from a table is `string[]`, and
 * the compiler stops helping at the point the data does.
 *
 * `*` grants every permission, which is what `owner` means here. Note what it
 * costs: an owner can never prove a gate works, so test with `staff`.
 */
export const PERMISSIONS_BY_ROLE: Record<UserRole, PermissionKey[]> = {
  owner: ['*'],
  staff: [
    'identity.users.view',
    'catalog.products.view',
    'catalog.products.manage',
  ],
};
