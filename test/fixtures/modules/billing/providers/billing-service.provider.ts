import { Provider, Provides } from '../../../../../lib';
import { BillingService } from '../../contracts';

/** La implementación vive en el módulo que la publica, y sólo ahí. */
@Provides(BillingService)
export class BillingServiceProvider extends Provider implements BillingService {
  public async emitirCargo(input: { cliente: string; monto: number }) {
    return { id: `cargo-${input.cliente}-${input.monto}` };
  }
}
