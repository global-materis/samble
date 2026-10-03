import { Body, Endpoint, HttpPost, HttpStatus, Group } from '../../../../lib';
import { CreateProductDto } from '../dto/create-product.dto';
import { products } from '../tables/product.table';

@Group('products')
@HttpPost()
@Body(CreateProductDto)
export class CreateProductEndpoint extends Endpoint<null, CreateProductDto> {
  async main() {
    this.auth.assert('catalog.products.manage');

    // `returning()` and not a second read: the row the database wrote is the
    // one to answer with, and asking for it again is a round trip that can
    // disagree with what was just inserted.
    const [product] = await this.db
      .insert(products)
      .values({ name: this.body.name, stock: this.body.stock })
      .returning();

    this.httpStatus = HttpStatus.CREATED;
    return product;
  }
}
