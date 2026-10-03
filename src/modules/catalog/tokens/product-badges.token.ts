import { token } from '../../../../lib';

/**
 * An open extension point: catalog does not know which badges will exist, so
 * it declares the shape and shows whatever is installed.
 *
 * Note the direction. The module that OPENS the slot is the one extensions
 * depend on — `catalog` knows nothing about who fills it, while a contributor
 * imports this token. Backwards, the host would depend on its own extensions
 * and none of them could be removed.
 */
export interface ProductBadge {
  id: string;
  /** The text to show, or `null` when it does not apply to that product. */
  for(product: { id: number; stock: number }): string | null;
}

export const ProductBadges = token<ProductBadge>(
  'catalog.product-badges',
  'slot',
);
