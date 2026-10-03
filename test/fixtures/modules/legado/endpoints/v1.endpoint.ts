import {
  DataJson,
  Deprecated,
  Endpoint,
  Group,
  HttpGet,
  Params,
} from '../../../../../lib';
import { ProductoIdDto } from '../dto/producto-id.dto';

/** La forma vieja: sigue contestando, y lo dice en cada respuesta. */
@Deprecated({
  sunset: '2027-01-31',
  use: '/api/v2/productos/:id',
  note: 'Devuelve el precio plano. v2 lo anida en `importe`.',
})
@Group('v1/productos')
@HttpGet(':id')
@Params(ProductoIdDto)
export default class V1 extends Endpoint<ProductoIdDto> {
  main(): DataJson {
    return { forma: 'vieja', id: this.params.id };
  }
}
