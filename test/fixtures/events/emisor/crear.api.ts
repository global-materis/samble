import { Endpoint, HttpPost, Group } from '../../../../lib';
import { Registrado } from '../shared';

@Group('demo')
@HttpPost('crear')
export class CrearApi extends Endpoint {
  async main() {
    await this.notify(Registrado, { id: 7 });
    return { ok: true };
  }
}
