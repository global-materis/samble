import { Reaction, token } from '../../../../lib';

/**
 * Announced after stock goes up, for whoever is deployed to react.
 *
 * It is a slot like any other — the difference is only in how catalog READS it:
 * `notify()` calls every reaction and discards the answers, so a reaction that
 * throws gets logged and the restock still responds. With `all()` the failure
 * would be catalog's.
 *
 * What the module declares here is the PAYLOAD. `Reaction<T>` supplies the
 * method, so nobody has to agree on a name for it.
 */
export interface RestockPayload {
  productId: number;
  quantity: number;
  stock: number;
  userId: number;
}

export const ProductRestocked = token<Reaction<RestockPayload>>(
  'catalog.product.restocked',
  'slot',
);
