import { Endpoint, HttpPost, Group, Priority } from '../../../../../lib';

@Priority(2)
@HttpPost('cargos')
@Group('facturacion')
export default class CreateCharge extends Endpoint {
  main() {
    return { created: true };
  }
}
