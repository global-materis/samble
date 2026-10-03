import { Endpoint, HttpGet, Group, Priority } from '../../../../../lib';

/** Constante exportada junto a la clase: el cargador debe ignorarla. */
export const CHARGES_LIMIT = 50;

@Priority(1)
@HttpGet('cargos')
@Group('facturacion')
export default class ListCharges extends Endpoint {
  main() {
    return { charges: [], limit: CHARGES_LIMIT };
  }
}
