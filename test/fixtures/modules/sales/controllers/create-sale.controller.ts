import { Endpoint, HttpPost, Group } from '../../../../../lib';
import { BillingService } from '../../contracts';

/**
 * Ventas necesita facturar, pero NO importa el módulo de facturación: solo su
 * contrato. Es el caso que define el sistema de paquetes.
 */
@HttpPost('ventas')
@Group('inventario')
export default class CreateSale extends Endpoint {
  async main() {
    const billing = this.get(BillingService);
    const cargo = await billing.emitirCargo({ cliente: 'c1', monto: 120 });
    return { venta: 'v1', cargoId: cargo.id };
  }
}
