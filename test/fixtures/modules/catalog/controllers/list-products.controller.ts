import { Endpoint, HttpGet, Group } from '../../../../../lib';
import { productos } from '../product.table';

@HttpGet('productos')
@Group('catalogo')
export default class ListProducts extends Endpoint {
  async main() {
    // Lo que importa: consultar la tabla que aporta el módulo, desde `this.db`.
    return { productos: await this.db.select().from(productos) };
  }
}
