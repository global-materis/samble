import { Endpoint, HttpGet } from '../../../../lib';
import { UserDirectory } from '@/identity/tokens/user-directory.token';
import { ProductCatalog } from '@/catalog/tokens/product-catalog.token';

/**
 * The whole point of contracts: this reads data owned by two other modules and
 * imports NOTHING from either — only their tokens. Swap how `identity` stores
 * users and this file does not change.
 *
 * And no `@Group`: the module id is `reports`, so this answers at
 * `/api/reports/summary` without saying so twice. `catalog` and `identity` do
 * declare one, because their URLs are not their ids.
 */
@HttpGet('summary')
export class SummaryEndpoint extends Endpoint {
  async main() {
    this.auth.assert('reports.view');

    const users = this.get(UserDirectory);
    const catalog = this.get(ProductCatalog);

    const [userCount, productCount, totalStock] = await Promise.all([
      users.count(),
      catalog.count(),
      catalog.totalStock(),
    ]);

    return { userCount, productCount, totalStock };
  }
}
