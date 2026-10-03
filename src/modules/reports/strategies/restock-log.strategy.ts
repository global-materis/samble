import { Fills, Reaction, Strategy } from '../../../../lib';
import {
  ProductRestocked,
  RestockPayload,
} from '@/catalog/tokens/product-restocked.token';
import { UserDirectory } from '@/identity/tokens/user-directory.token';

/**
 * Reacts to something `catalog` announced, and enriches it with data owned by
 * `identity` — without either module knowing this exists.
 *
 * Nothing in `catalog` mentions this file. Take `reports` out of
 * `Samble.create({ modules })` and the restock still works: it just stops being
 * logged, which is what `notify()` means. Throwing here would be logged with
 * this module's id and the restock would still answer.
 */
@Fills(ProductRestocked)
export class RestockLog extends Strategy implements Reaction<RestockPayload> {
  async on(payload: RestockPayload) {
    const who = await this.get(UserDirectory).find(payload.userId);
    console.log(
      `[reports] ${who?.fullName ?? 'someone'} restocked #${payload.productId} ` +
        `by ${payload.quantity} (now ${payload.stock})`,
    );
  }
}
