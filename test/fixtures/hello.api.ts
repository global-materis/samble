import { Endpoint, HttpGet, Group } from '../../lib';

@Group('saludo')
@HttpGet('hola')
export class HelloApi extends Endpoint {
  main() {
    return { ok: true, msg: 'ruta viva' };
  }
}

/** Extra export on purpose: the reader must ignore it without crashing. */
export const NO_ES_UNA_API = { cualquier: 'cosa' };
