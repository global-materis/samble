import { Endpoint, HttpGet, Group } from '../../../lib';

/**
 * Este fixture es una mini-app con su PROPIO vocabulario, y comparte programa
 * de TypeScript con la demo de `src/`. Sin declararlo acá, `assert` sólo
 * aceptaría las claves de la demo.
 */
declare global {
  namespace SambleAuth {
    interface Permissions {
      'secretos.ver': true;
    }
  }
}

@Group('yo')
@HttpGet('actual')
export class WhoAmIApi extends Endpoint {
  main() {
    return { userId: this.auth.actor.userId };
  }
}

/** Awaits mid-request, so two callers overlap inside `main()`. */
@Group('yo')
@HttpGet('lento')
export class SlowWhoAmIApi extends Endpoint {
  async main() {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { userId: this.auth.actor.userId };
  }
}

@Group('yo')
@HttpGet('publico')
export class PublicApi extends Endpoint {
  main() {
    return {
      anonimo: !this.auth.isAuthenticated,
      actor: this.auth.optional,
    };
  }
}

@Group('yo')
@HttpGet('secreto')
export class SecretApi extends Endpoint {
  main() {
    this.auth.assert('secretos.ver');
    return { ok: true };
  }
}

/** Exige una clave que ningún módulo declara: un typo, básicamente. */
@Group('yo')
@HttpGet('roto')
export class TypoApi extends Endpoint {
  main() {
    // @ts-expect-error el typo AHORA lo agarra el compilador; esta prueba
    // cubre la red de ejecución, que sigue haciendo falta cuando la clave
    // llega como dato y no como literal.
    this.auth.assert('secretos.vre');
    return { ok: true };
  }
}
