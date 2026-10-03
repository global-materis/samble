import { Fills, Strategy } from '../../../../lib';
import {
  ProductBadge,
  ProductBadges,
} from '@/catalog/tokens/product-badges.token';

/**
 * What this module adds to catalog's product list — without catalog knowing it
 * exists, and without editing a single line of it.
 *
 * `ProductBadge` is catalog's domain interface: it decides that a badge answers
 * per product and may answer `null`. This class is one implementation of it,
 * and `catalog` is the only one that runs it.
 */
@Fills(ProductBadges)
export class LowStockBadge extends Strategy implements ProductBadge {
  public readonly id = 'low-stock';

  public for(product: { stock: number }): string | null {
    return product.stock < 10 ? 'Low stock' : null;
  }
}
