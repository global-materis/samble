import { defineModule } from '../../../lib';

/**
 * Catalog: products and their stock.
 *
 * What it publishes is in `tokens/`; how it answers is in `providers/`. None
 * of it is named here, which is what leaves the manifest saying only what is
 * particular to this module.
 */
export default defineModule({
  id: 'catalog',
  label: 'Catalog',
  dir: __dirname,

  // Declared, and checked at boot: catalog refuses to start without identity.
  requires: ['identity'],

  // Everything this module can gate, spelled ONCE — here. The endpoints
  // assert these strings and `config/permissions.ts` carries them into the
  // type system, so a typo anywhere else does not compile.
  permissions: [
    'catalog.products.view',
    // Text only where the key cannot carry it: "manage" does not say that
    // restocking is part of it. The other modules pass bare keys.
    { key: 'catalog.products.manage', label: 'Create and restock products' },
  ],
});
