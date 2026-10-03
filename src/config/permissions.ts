import type { PermissionsOf } from '../../lib';

/**
 * Every key the installed modules declare, taught to the compiler ONCE.
 *
 * With this file, `this.auth.assert('catalog.products.view')` is a plain string
 * that TypeScript checks: misspell it and the build fails, instead of the
 * framework answering 500 on the first request that reaches the line.
 *
 * Each module spells its own keys in its own manifest — this only reads the
 * spellings back off it, so there is no second list to keep in sync.
 *
 * The module is reached with an inline `import(...)`, which is what makes
 * adding one a pure APPEND: a new block needs no new import line, and nothing
 * already here is reopened. It is also type-only, so naming a module cannot
 * introduce an import cycle. `PermissionsOf` is the exception and comes from
 * the import above, because an interface may only extend an identifier.
 *
 * One block per module, and interface merging joins them. That is also why this
 * is an interface and not a union: a union cannot be merged, so every new
 * module would have to reopen one declaration.
 */
declare global {
  namespace SambleAuth {
    interface Permissions extends PermissionsOf<
      typeof import('../modules/catalog/module').default
    > {}
  }
}

declare global {
  namespace SambleAuth {
    interface Permissions extends PermissionsOf<
      typeof import('../modules/identity/module').default
    > {}
  }
}

declare global {
  namespace SambleAuth {
    interface Permissions extends PermissionsOf<
      typeof import('../modules/reports/module').default
    > {}
  }
}
