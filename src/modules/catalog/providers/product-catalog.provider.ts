import { sum } from 'drizzle-orm';
import { Provider, Provides } from '../../../../lib';
import { ProductCatalog } from '../tokens/product-catalog.token';
import { products } from '../tables/product.table';

@Provides(ProductCatalog)
export class ProductCatalogProvider extends Provider implements ProductCatalog {
  public count(): Promise<number> {
    return this.db.$count(products);
  }

  public async totalStock(): Promise<number> {
    // `sum()` comes back as a string — Postgres returns numeric for it, and a
    // numeric does not fit in a JavaScript number in general, so the driver
    // refuses to guess. It is null on an empty table.
    const [row] = await this.db
      .select({ total: sum(products.stock) })
      .from(products);

    return Number(row?.total ?? 0);
  }
}
