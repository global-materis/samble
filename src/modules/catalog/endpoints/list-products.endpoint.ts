import { asc, eq } from 'drizzle-orm';
import { Endpoint, HttpGet, Group, Query } from '../../../../lib';
import { ListProductsQuery } from '../dto/list-products.query';
import { products } from '../tables/product.table';
import { ProductBadges } from '../tokens/product-badges.token';

@Group('products')
@HttpGet()
@Query(ListProductsQuery)
export class ListProductsEndpoint extends Endpoint<
  null,
  null,
  ListProductsQuery
> {
  async main() {
    this.auth.assert('catalog.products.view');

    // The string comparison is the point: see ListProductsQuery.
    const onlyEnabled = this.query.onlyEnabled === 'true';

    // `$dynamic()` is what lets a condition be added to a query that is already
    // built. Without it the builder is done once `.from()` is called, and the
    // usual workaround is two nearly identical queries.
    const query = this.db.select().from(products).$dynamic();
    const rows = await (
      onlyEnabled ? query.where(eq(products.enabled, true)) : query
    ).orderBy(asc(products.id));

    // Whoever is installed. With no extension this is an empty array, and the
    // endpoint neither knows nor cares which module put something in it.
    const badges = this.all(ProductBadges);

    return rows.map((product) => ({
      ...product,
      badges: badges
        .map((badge) => badge.for(product))
        .filter((text): text is string => text !== null),
    }));
  }
}
