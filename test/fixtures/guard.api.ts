import { AuthError, Endpoint, HttpGet, HttpStatus, Group } from '../../lib';

/** `previous()` runs on the same instance, before `main()`. */
@Group('guardia')
@HttpGet('abierto')
export class OpenGuardApi extends Endpoint {
  previous() {
    this.httpStatus = HttpStatus.ACCEPTED;
  }

  main() {
    return { ok: true };
  }
}

/** Throwing from `previous()` must skip `main()` entirely. */
@Group('guardia')
@HttpGet('cerrado')
export class ClosedGuardApi extends Endpoint {
  previous() {
    throw new AuthError('Sin pase.');
  }

  main() {
    // Reaching this would answer 200: the assertion on 401 is what proves it
    // never ran.
    return { ok: true };
  }
}
