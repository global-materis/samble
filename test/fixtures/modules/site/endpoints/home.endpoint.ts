import { DataJson, Endpoint, HttpGet, Group } from '../../../../../lib';

/** Una vista: vive en la raíz, no bajo el prefijo de la API. */
@Group('tienda', { mount: '/' })
@HttpGet('inicio')
export default class HomeEndpoint extends Endpoint {
  main(): DataJson {
    return { pagina: true };
  }
}
