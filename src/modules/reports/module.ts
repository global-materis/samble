import { defineModule } from '../../../lib';
import { UserDirectory } from '@/identity/tokens/user-directory.token';
import { ProductCatalog } from '@/catalog/tokens/product-catalog.token';

/**
 * The one that only READS. It owns no table and answers no contract: it reaches
 * `identity` and `catalog` through theirs, and fills catalog's extension point
 * with a badge.
 *
 * Which makes it the module shaped like an extension — the case the three
 * wirings exist for. `identity` and `catalog` ship together and could import
 * each other directly; this one is written as if somebody else had written it.
 */
export default defineModule({
  id: 'reports',
  label: 'Reports',
  dir: __dirname,

  requires: ['identity', 'catalog'],

  // Declaring what it calls turns a missing provider into a refusal to start,
  // instead of a 500 on whichever request happened to need it first. This is a
  // declaration, not logic, which is why it belongs here — what FILLS catalog's
  // extension point is a class in ./strategies, and nothing lists it either.
  consumes: [UserDirectory, ProductCatalog],

  permissions: ['reports.view'],
});
