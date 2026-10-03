import { Endpoint, HttpPost, Group } from '../../../../lib';

@Group('auth')
@HttpPost('logout')
export class LogoutEndpoint extends Endpoint {
  main() {
    this.request.session.userId = undefined;
    return { ok: true };
  }
}
