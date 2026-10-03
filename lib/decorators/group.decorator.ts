import { Endpoint } from '../templates/endpoint';

export const GROUP = Symbol('__group__');

export interface GroupMetadata {
  /** The prefix every endpoint of this class hangs from. */
  name: string;
  /**
   * Replaces the application's `basePath` for this group. `null` means "use
   * the application's".
   */
  mountAt: string | null;
}

export interface GroupOptions {
  /**
   * Where this group hangs from, instead of the application's `basePath`.
   *
   * An application that serves pages AND an API cannot use one prefix for
   * both: `/api/products/page` is a URL nobody would link to. The API keeps
   * the application's prefix; the pages declare their own.
   *
   * `'/'` (or `''`) mounts at the site root.
   */
  mount?: string;
}

/**
 * Overrides the URL prefix of an endpoint.
 *
 * It is OPTIONAL: without it, the endpoint hangs from the id of the module
 * that loaded it, which is the common case and needs no decorator. Declare a
 * group when the URL should not carry the module id — because the module
 * serves more than one resource (`auth` and `users` from `identity`), or
 * because several modules contribute to the same prefix.
 *
 * The two identities are deliberately separate: the module id names the
 * INSTALLABLE UNIT (permissions, `requires`, the `_modules` row), the group
 * names the URL. Renaming one must not rename the other.
 *
 * @param name The prefix: `@Group('products')` + `@HttpGet(':id')` answers at
 * `<app basePath>/products/:id`.
 * @param options `mount` overrides the application's prefix for this group.
 *
 * @example
 * // module.ts declares id: 'catalog'
 * @HttpGet(':id')                           // /api/catalog/:id
 * @Group('products')                        // /api/products/:id
 * @Group('products', { mount: '/' })        // /products/:id
 * @Group('checkout', { mount: '/shop' })    // /shop/checkout/:id
 */
export function Group(name: string, options: GroupOptions = {}) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(
      GROUP,
      { name, mountAt: options.mount ?? null } as GroupMetadata,
      target,
    );
  };
}
