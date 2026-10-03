import {
  DataJson,
  Deprecated,
  Endpoint,
  Group,
  HttpGet,
} from '../../../../../lib';

/** Sólo la usa la prueba del aviso, para llegar sin estrenar. */
@Deprecated({ sunset: '2027-06-30' })
@Group('v1/solo-log')
@HttpGet('/')
export class SoloLog extends Endpoint {
  main(): DataJson {
    return { ok: true };
  }
}
