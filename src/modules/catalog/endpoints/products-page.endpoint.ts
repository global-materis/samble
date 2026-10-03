import { asc } from 'drizzle-orm';
import {
  ApiHidden,
  DataJson,
  Endpoint,
  HttpGet,
  Group,
  view,
} from '../../../../lib';
import { products } from '../tables/product.table';

/**
 * An HTML page instead of JSON.
 *
 * Two things worth copying here:
 *
 * - `view()` is returned from `main()`, not declared on the class. The endpoint
 *   could just as well answer JSON on another branch — the choice is made with
 *   the data in hand.
 * - `mount: '/'` takes it OFF the application's `/api` prefix: this answers
 *   at `/products/page`, because `/api/products/page` is not a URL anybody
 *   would link to. The JSON endpoints of this same module keep the prefix.
 *   Being under another prefix also means `:id` cannot shadow it, so no
 *   `@Priority` is needed here.
 */
@Group('products', { mount: '/' })
@HttpGet('page')
@ApiHidden()
export default class ProductsPageEndpoint extends Endpoint {
  public async main(): Promise<DataJson> {
    return view('products', {
      products: await this.db.select().from(products).orderBy(asc(products.id)),
    });
  }
}
