import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';
import type { AuthContext, AuthResult } from '../lib';
import { AuthError, cacheAuth, defineAuth } from '../lib';

/**
 * La caché es puro mecanismo: no necesita base ni servidor, sólo un resolutor
 * que cuente cuántas veces lo llamaron.
 */
const contexto = { db: {}, get: () => null } as unknown as AuthContext;

const pedidoDe = (userId: number | null) =>
  ({ session: userId === null ? {} : { userId } }) as unknown as Request;

const actorDe = (userId: number) => ({ userId }) as SambleAuth.Actor;

/** Un resolutor que lleva la cuenta de sus llamadas. */
function contador(
  responder: (userId: number) => AuthResult | null = (userId) => ({
    actor: actorDe(userId),
    permissions: ['billing.read'],
  }),
) {
  const espia = { llamadas: 0 };
  const resolver = defineAuth(async (request) => {
    espia.llamadas += 1;
    const userId = (request as unknown as { session?: { userId?: number } })
      .session?.userId;
    return userId ? responder(userId) : null;
  });
  return { espia, resolver };
}

const porUsuario = (request: Request) =>
  (request as unknown as { session?: { userId?: number } }).session?.userId ??
  null;

describe('cacheAuth', () => {
  it('la segunda petición del mismo usuario no vuelve a resolver', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(7), contexto);

    expect(espia.llamadas).toBe(1);
  });

  it('cada usuario tiene su propia entrada: nadie ve el actor de otro', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    const a = await auth(pedidoDe(7), contexto);
    const b = await auth(pedidoDe(8), contexto);
    const a2 = await auth(pedidoDe(7), contexto);

    expect(a?.actor).toEqual({ userId: 7 });
    expect(b?.actor).toEqual({ userId: 8 });
    expect(a2?.actor).toEqual({ userId: 7 });
    expect(espia.llamadas).toBe(2);
  });

  it('invalidate obliga a resolver de nuevo, y sólo a ese usuario', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(8), contexto);
    expect(espia.llamadas).toBe(2);

    auth.invalidate(7);

    await auth(pedidoDe(7), contexto); // vuelve a resolver
    await auth(pedidoDe(8), contexto); // sigue cacheado
    expect(espia.llamadas).toBe(3);
  });

  it('los permisos nuevos se ven en la petición siguiente al invalidate', async () => {
    // Esto es lo que compra `invalidate`: sin él, el cambio de rol espera el
    // TTL, que es el piso de la caché y no su contrato.
    let permisos = ['billing.read'];
    const { resolver } = contador((userId) => ({
      actor: actorDe(userId),
      permissions: permisos,
    }));
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    await auth(pedidoDe(7), contexto);
    permisos = ['billing.read', 'billing.void'];

    expect((await auth(pedidoDe(7), contexto))?.permissions).toEqual([
      'billing.read',
    ]);

    auth.invalidate(7);

    expect((await auth(pedidoDe(7), contexto))?.permissions).toEqual([
      'billing.read',
      'billing.void',
    ]);
  });

  it('clear olvida a todos', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(8), contexto);
    auth.clear();
    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(8), contexto);

    expect(espia.llamadas).toBe(4);
  });

  it('vencido el TTL, resuelve de nuevo', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 20 });

    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(7), contexto);
    expect(espia.llamadas).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 30));

    await auth(pedidoDe(7), contexto);
    expect(espia.llamadas).toBe(2);
  });

  it('una llamada anónima no se cachea y no ocupa lugar', async () => {
    // La key es null, así que no hay nada con qué indexar. Si se cacheara el
    // `null`, alguien que inicia sesión seguiría anónimo hasta que venza.
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    expect(await auth(pedidoDe(null), contexto)).toBeNull();
    expect(await auth(pedidoDe(null), contexto)).toBeNull();

    expect(espia.llamadas).toBe(2);
  });

  it('un usuario que el resolutor no reconoce tampoco se cachea', async () => {
    // Con key pero sin resultado: cachear ese `null` es lo que deja a alguien
    // afuera después de que lo dieron de alta.
    let existe = false;
    const { espia, resolver } = contador((userId) =>
      existe ? { actor: actorDe(userId), permissions: [] } : null,
    );
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    expect(await auth(pedidoDe(7), contexto)).toBeNull();
    expect(espia.llamadas).toBe(1);

    existe = true;

    // Sin esperar ningún TTL.
    expect(await auth(pedidoDe(7), contexto)).not.toBeNull();
    expect(espia.llamadas).toBe(2);
  });

  it('un resolutor que lanza no queda cacheado', async () => {
    let falla = true;
    const resolver = defineAuth(async () => {
      if (falla) throw new AuthError('Credencial mal formada.');
      return { actor: actorDe(7), permissions: [] };
    });
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    // `rejects.toThrow(AuthError)` NO sirve: las clases de error de samble no
    // extienden `Error`, y el matcher de jest descarta un rechazo que no lo es.
    await expect(auth(pedidoDe(7), contexto)).rejects.toBeInstanceOf(AuthError);

    falla = false;

    // Si el rechazo hubiese quedado guardado, esto seguiría lanzando.
    await expect(auth(pedidoDe(7), contexto)).resolves.not.toBeNull();
  });

  it('peticiones simultáneas con caché fría resuelven una sola vez', async () => {
    // Es el momento exacto para el que sirve la caché: una pantalla que dispara
    // ocho peticiones a la vez no debe disparar ocho consultas.
    const espia = { llamadas: 0 };
    const resolver = defineAuth(async (request) => {
      espia.llamadas += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const userId = (request as unknown as { session?: { userId?: number } })
        .session?.userId;
      return userId ? { actor: actorDe(userId), permissions: [] } : null;
    });
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000 });

    // `Promise.resolve` porque un AuthResolver puede contestar sin await: el
    // tipo es `AuthResult | Promise<AuthResult>`, y `Promise.all` sobre
    // un iterable que quizá no tenga promesas es justo lo que
    // `await-thenable` marca.
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve(auth(pedidoDe(7), contexto)),
      ),
    );

    expect(espia.llamadas).toBe(1);
    resultados.forEach((result) =>
      expect(result?.actor).toEqual({ userId: 7 }),
    );
  });

  it('al llegar a max suelta la entrada menos usada, no la más vieja', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, { key: porUsuario, ttl: 30_000, max: 2 });

    await auth(pedidoDe(1), contexto); // [1]
    await auth(pedidoDe(2), contexto); // [1, 2]
    await auth(pedidoDe(1), contexto); // acierto: 1 pasa a ser el más reciente
    expect(espia.llamadas).toBe(2);

    await auth(pedidoDe(3), contexto); // [1, 3] — se va el 2, no el 1
    expect(espia.llamadas).toBe(3);

    await auth(pedidoDe(1), contexto); // sigue ahí
    expect(espia.llamadas).toBe(3);

    await auth(pedidoDe(2), contexto); // se fue
    expect(espia.llamadas).toBe(4);
  });

  it('un ttl o un max inservibles se rechazan al construir, no en la primera petición', async () => {
    const { resolver } = contador();

    expect(() => cacheAuth(resolver, { key: porUsuario, ttl: 0 })).toThrow(
      /ttl must be a positive number/,
    );
    expect(() => cacheAuth(resolver, { key: porUsuario, ttl: -5 })).toThrow(
      /ttl must be a positive number/,
    );
    expect(() =>
      cacheAuth(resolver, { key: porUsuario, ttl: 1000, max: 0 }),
    ).toThrow(/max must be a positive integer/);
  });

  it('la key puede ser texto, y invalidate acepta lo mismo que devuelve', async () => {
    const { espia, resolver } = contador();
    const auth = cacheAuth(resolver, {
      key: (request) => {
        const userId = porUsuario(request);
        return userId === null ? null : `u:${userId}`;
      },
      ttl: 30_000,
    });

    await auth(pedidoDe(7), contexto);
    await auth(pedidoDe(7), contexto);
    expect(espia.llamadas).toBe(1);

    auth.invalidate('u:7');

    await auth(pedidoDe(7), contexto);
    expect(espia.llamadas).toBe(2);
  });
});
