import { DataJson, Endpoint, Group, HttpGet } from '../../../../../lib';

@Group('productos', { mount: '/api/v2' })
@HttpGet(':id')
export class V2 extends Endpoint {
  main(): DataJson {
    return { forma: 'nueva' };
  }
}
