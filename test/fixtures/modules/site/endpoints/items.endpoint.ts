import { DataJson, Endpoint, HttpGet, Group } from '../../../../../lib';

/** El mismo módulo, pero esto sí es API: conserva el prefijo. */
@Group('tienda')
@HttpGet('items')
export default class ItemsEndpoint extends Endpoint {
  main(): DataJson {
    return { items: [] };
  }
}
