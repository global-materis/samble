import { eq, sql } from 'drizzle-orm';
import {
  Body,
  Endpoint,
  HttpPost,
  Group,
  NotFoundError,
  Params,
} from '../../../../lib';
import { ProductIdDto } from '../dto/product-id.dto';
import { RestockDto } from '../dto/restock.dto';
import { products } from '../tables/product.table';
import { stockMoves } from '../tables/stock-move.table';
import { ProductRestocked } from '../tokens/product-restocked.token';

/**
 * Two writes that must land together — this is what `db.transaction()` is for.
 *
 * samble has no transaction hook and no transaction decorator on purpose:
 * commit, rollback and release are the callback's contract, so they cannot be
 * forgotten, and the transaction's boundaries stay visible in the code that
 * depends on them.
 */
@Group('products')
@HttpPost(':id/restock')
@Params(ProductIdDto)
@Body(RestockDto)
export class RestockProductEndpoint extends Endpoint<ProductIdDto, RestockDto> {
  async main() {
    this.auth.assert('catalog.products.manage');

    const productId = +this.params.id;
    const { quantity } = this.body;
    const userId = this.auth.actor.userId;

    const result = await this.db.transaction(async (tx) => {
      // The increment happens in the database, not in JavaScript. Reading the
      // stock, adding to it and writing it back is a lost update the moment two
      // restocks overlap — and a demo that shows the racy version teaches it.
      const [updated] = await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${quantity}` })
        .where(eq(products.id, productId))
        .returning({ id: products.id, stock: products.stock });

      // No row updated means no such product. One statement instead of a read
      // and then a write, and it cannot disagree with itself.
      if (!updated) throw new NotFoundError('Product not found.');

      await tx.insert(stockMoves).values({ productId, quantity, userId });

      return updated;
    });

    // AFTER the transaction commits, never inside it: a reaction reads on its
    // own connection and would not see the uncommitted rows.
    await this.notify(ProductRestocked, {
      productId,
      quantity,
      stock: result.stock,
      userId,
    });

    return result;
  }
}
