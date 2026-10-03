import { Endpoint, HttpGet } from '../../../../lib';

@HttpGet('legacy')
export default class Legacy extends Endpoint {
  public async main() {
    return { ok: true };
  }
}
