import { Provider, Provides } from '../../../../lib';
import { ThingCount } from '../tokens/thing-count.token';

/** Lo que el archivo exporta además del proveedor, que es lo normal. */
export const NOT_A_PROVIDER = 42;

@Provides(ThingCount)
export class ThingCountProvider extends Provider implements ThingCount {
  public total(): number {
    return 7;
  }
}
