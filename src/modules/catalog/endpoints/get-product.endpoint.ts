import { eq } from 'drizzle-orm';
import {
  Endpoint,
  HttpGet,
  Group,
  NotFoundError,
  Params,
  Priority,
} from '../../../../lib';
import { ProductIdDto } from '../dto/product-id.dto';
import { products } from '../tables/product.table';

/** Priority 2: the `:id` route must come after the literal `/page`. */
@Group('products')
@HttpGet(':id')
@Params(ProductIdDto)
@Priority(2)
export class GetProductEndpoint extends Endpoint<ProductIdDto> {
  async main() {
    this.auth.assert('catalog.products.view');

    const [product] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, +this.params.id))
      .limit(1);

    // Thrown, not returned: the framework maps it to a 404 with the same shape
    // as every other error.
    if (!product) throw new NotFoundError('Product not found.');

    return product;
  }
}
