import { Endpoint, HttpGet } from '../../../../lib';

@HttpGet('things')
export default class ListThings extends Endpoint {
  public async main() {
    return { ok: true };
  }
}
