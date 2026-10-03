import { token } from '../../../../lib';

/** What other modules may ask catalog about its products. */
export interface ProductCatalog {
  count(): Promise<number>;
  totalStock(): Promise<number>;
}

export const ProductCatalog = token<ProductCatalog>(
  'catalog.products',
  'contract',
);
