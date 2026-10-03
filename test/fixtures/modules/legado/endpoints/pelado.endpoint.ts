import {
  DataJson,
  Deprecated,
  Endpoint,
  Group,
  HttpGet,
} from '../../../../../lib';

/** Sin fecha ni sucesor: la forma mínima todavía dice lo que importa. */
@Deprecated()
@Group('v1/pelado')
@HttpGet('/')
export class Pelado extends Endpoint {
  main(): DataJson {
    return { ok: true };
  }
}
