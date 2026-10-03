import type { ModulePermission, ResolvedModule } from './module-manifest';

/** A permission together with the module that declared it. */
export interface RegisteredPermission extends ModulePermission {
  moduleId: string;
}

/** Granting this holds every permission. Always valid to ask about. */
export const GRANT_ALL = '*';

/**
 * Every permission the installed modules declare.
 *
 * It closes the half of the feature that was missing: modules listed their
 * permissions and nothing read the list, so `assert('billing.veiw')` was not a
 * mistake the framework could see — it was a 403 in production, sending whoever
 * debugged it to look at roles instead of at a typo.
 *
 * Built from every module present in the code, for the same reason the schema
 * is: a key exists because a manifest declares it. What limits who reaches it
 * is the role or the plan — the application's policy, not this list.
 */
export class PermissionRegistry {
  private readonly byKey = new Map<string, RegisteredPermission>();

  constructor(permissions: RegisteredPermission[] = []) {
    for (const permission of permissions) {
      this.byKey.set(permission.key, permission);
    }
  }

  static from(modules: ResolvedModule[]): PermissionRegistry {
    return new PermissionRegistry(
      modules.flatMap((mod) =>
        mod.permissions.map((permission) => ({
          ...permission,
          moduleId: mod.id,
        })),
      ),
    );
  }

  /** `*` is the framework's own, so it is always known. */
  public has(key: string): boolean {
    return key === GRANT_ALL || this.byKey.has(key);
  }

  /**
   * The catalog, for the screen where someone builds a role. This is the
   * practical reason to declare permissions at all: the list of what can be
   * granted comes from the modules, instead of a central file somebody has to
   * remember to edit.
   */
  public list(): RegisteredPermission[] {
    return [...this.byKey.values()];
  }

  public size(): number {
    return this.byKey.size;
  }

  /**
   * Keys that share the namespace of the one asked for, to put in the error.
   *
   * A typo is nearly always inside a module the author knows, so listing that
   * module's keys is more useful — and cheaper — than edit distance.
   */
  public suggest(key: string): string[] {
    const namespace = key.split('.')[0];
    return this.list()
      .filter((permission) => permission.key.startsWith(`${namespace}.`))
      .map((permission) => permission.key)
      .sort();
  }
}

/**
 * Teaches the compiler the keys a module declares.
 *
 * A key is spelled ONCE, in that module's manifest; this reads the spellings
 * back off it. Declare it per module in one file and `assert` / `can` stop
 * taking any string:
 *
 * ```typescript
 * // src/config/permissions.ts
 * import type identity from '../modules/identity/module';
 * import type billing from '../modules/billing/module';
 *
 * declare global {
 *   namespace SambleAuth {
 *     interface Permissions extends PermissionsOf<typeof identity> {}
 *   }
 * }
 *
 * declare global {
 *   namespace SambleAuth {
 *     interface Permissions extends PermissionsOf<typeof billing> {}
 *   }
 * }
 * ```
 *
 * One block per module, and interface merging joins them. That is why
 * `samble module` can add a module by APPENDING here instead of editing a
 * list, and why this is an interface and not a union: a union cannot be
 * merged, so every new module would have to reopen one declaration.
 *
 * `import type` is deliberate — nothing is imported at run time, so this file
 * cannot introduce a cycle with the modules it names.
 */
export type PermissionsOf<M> = M extends {
  permissions: readonly (infer E)[];
}
  ? { [K in KeyOf<E>]: true }
  : Record<never, never>;

/** The key carried by one entry of a resolved module's permission list. */
type KeyOf<E> = E extends { key: infer K extends string } ? K : never;
