import 'reflect-metadata';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import {
  Auth,
  AuthError,
  defineAuth,
  defineModule,
  ForbiddenError,
  Samble,
} from '../lib';
import type { AuthContext } from '../lib';
import type { Request } from 'express';
import { ErrorIdentifier } from '../lib/interfaces/type-error';
import { testAuthResolver } from './fixtures/auth/actor';
import { closeTestDb, createTestDb, query } from './helpers/test-db';
import { Grants } from './fixtures/grants/tokens/grants.token';

/**
 * Estas suites prueban el chequeo EN EJECUCIÓN con su propio vocabulario
 * (`billing.*`), a propósito independiente de lo que declare la app de `src/`.
 *
 * Dentro de este repo `PermissionKey` se estrecha a las claves de la demo —
 * dos aplicaciones comparten el mismo programa de TypeScript — así que el
 * ensanche va acá una sola vez, en vez de un @ts-expect-error por línea. Una
 * app de verdad sólo declara las suyas y no necesita nada de esto.
 */
type AuthSinTipar = Omit<Auth, 'assert' | 'can'> & {
  assert(...keys: string[]): void;
  can(...keys: string[]): boolean;
};

const crearAuth = (...args: ConstructorParameters<typeof Auth>): AuthSinTipar =>
  new Auth(...args) as unknown as AuthSinTipar;

const actorDe = (userId: number) => ({ userId }) as SambleAuth.Actor;

describe('Auth (sin servidor)', () => {
  it('distingue "nadie inició sesión" de "la app no configuró auth"', () => {
    // Sin resolutor es un error de programación: NO debe verse como un 401,
    // porque el cliente no puede hacer nada al respecto.
    expect(() => crearAuth(null, false).actor).toThrow(/pass `auth`/);

    // Con resolutor, que no haya actor es la respuesta legítima.
    expect(() => crearAuth(null, true).actor).toThrow(AuthError);
  });

  it('optional devuelve null en vez de lanzar', () => {
    const auth = crearAuth(null, true);

    expect(auth.optional).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it('expone el actor tal como lo devolvió el resolutor', () => {
    const auth = crearAuth({ actor: actorDe(7) }, true);

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.actor.userId).toBe(7);
    expect(auth.optional).toEqual({ userId: 7 });
  });

  it('can exige TODOS los permisos dados', () => {
    const auth = crearAuth(
      { actor: actorDe(1), permissions: ['billing.view', 'billing.emit'] },
      true,
    );

    expect(auth.can('billing.view')).toBe(true);
    expect(auth.can('billing.view', 'billing.emit')).toBe(true);
    expect(auth.can('billing.view', 'billing.void')).toBe(false);
    expect(auth.can('billing.void')).toBe(false);
  });

  it('"*" concede todo', () => {
    const auth = crearAuth({ actor: actorDe(1), permissions: ['*'] }, true);

    expect(auth.can('lo.que.sea')).toBe(true);
  });

  it('un anónimo no puede nada, aunque no se le pida permiso', () => {
    const auth = crearAuth(null, true);

    expect(auth.can('billing.view')).toBe(false);
    expect(auth.permissions).toEqual([]);
  });

  it('assert separa 401 de 403', () => {
    expect(() => crearAuth(null, true).assert('billing.view')).toThrow(
      AuthError,
    );

    const auth = crearAuth(
      { actor: actorDe(1), permissions: ['billing.view'] },
      true,
    );
    expect(() => auth.assert('billing.view')).not.toThrow();

    try {
      auth.assert('billing.view', 'billing.void');
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      // Nombra lo que falta, no lo que sobra: es lo accionable.
      expect((error as ForbiddenError).missing).toEqual(['billing.void']);
    }
  });

  it('assert sin permisos solo exige estar identificado', () => {
    expect(() => crearAuth(null, true).assert()).toThrow(AuthError);
    expect(() => crearAuth({ actor: actorDe(1) }, true).assert()).not.toThrow();
  });
});

describe('Auth (extremo a extremo)', () => {
  const fixtures = defineModule({
    id: 'secretos',
    dir: path.join(__dirname, 'fixtures/auth'),
    routes: './*.api.ts',
    // Declarado: desde el registro de permisos, exigir una clave que ningún
    // módulo declara es un error de programación, no un 403.
    permissions: [{ key: 'secretos.ver', label: 'Ver secretos' }],
  });

  let samble: Samble;
  const app = () => samble.getApp();

  beforeAll(async () => {
    const db = await createTestDb();
    samble = await Samble.create({
      db,
      modules: [fixtures],
      version: '2.0.0-dev.0',
      auth: testAuthResolver,
    });
    await samble.start(0);
  });

  afterAll(async () => {
    await samble.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('el endpoint lee el actor sin saber de dónde salió', async () => {
    const res = await request(app()).get('/api/yo/actual').set('x-user', '42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 42 });
  });

  it('sin actor, leerlo devuelve 401 con el contrato de error del framework', async () => {
    const res = await request(app()).get('/api/yo/actual');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorIdentifier.UNAUTHORIZED });
  });

  it('un resolutor que lanza se mapea como cualquier otro error', async () => {
    const res = await request(app())
      .get('/api/yo/actual')
      .set('x-user', 'roto');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      code: ErrorIdentifier.UNAUTHORIZED,
      detail: 'Malformed credential.',
    });
  });

  it('un endpoint público atiende al anónimo', async () => {
    const res = await request(app()).get('/api/yo/publico');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anonimo: true, actor: null });
  });

  it('permiso faltante es 403, no 401', async () => {
    const res = await request(app()).get('/api/yo/secreto').set('x-user', '42');

    expect(res.status).toBe(403);
    // `missing` viaja estructurado, además de estar dentro del `detail`: una
    // pantalla puede ofrecer "pedir acceso a esto" sin parsear la oración.
    expect(res.body).toMatchObject({
      code: ErrorIdentifier.FORBIDDEN,
      missing: ['secretos.ver'],
    });
    expect(res.body.detail).toContain('secretos.ver');
  });

  it('con el permiso, pasa', async () => {
    const res = await request(app())
      .get('/api/yo/secreto')
      .set('x-user', '42')
      .set('x-perms', 'secretos.ver');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('un permiso que nadie declara es 500, no 403', async () => {
    // Un 403 mandaría a revisar roles; el 500 dice que el código está mal.
    const res = await request(app())
      .get('/api/yo/roto')
      .set('x-user', '42')
      .set('x-perms', 'secretos.ver');

    expect(res.status).toBe(500);
    expect(res.body.detail).toMatch(/Unknown permission "secretos.vre"/);
    expect(res.body.detail).toMatch(/Did you mean: secretos.ver/);
  });

  it('dos peticiones simultáneas no se pisan el actor', async () => {
    // El mismo riesgo que obligó a mover params/body/query del prototipo a la
    // instancia: si `auth` viviera en el prototipo, el segundo actor
    // sobrescribiría al primero mientras este await-ea dentro de main().
    const [uno, dos] = await Promise.all([
      request(app()).get('/api/yo/lento').set('x-user', '1'),
      request(app()).get('/api/yo/lento').set('x-user', '2'),
    ]);

    expect(uno.body).toEqual({ userId: 1 });
    expect(dos.body).toEqual({ userId: 2 });
  });
});

describe('el resolutor recibe db y contratos', () => {
  // La política de permisos vive en el módulo que la posee, y el resolutor
  // llega a ella por contrato — sin importar el módulo ni cerrar sobre un
  // DataSource global.
  const grantsModule = defineModule({
    id: 'grants',
    // Su proveedor está en ./providers, y el token en ./contracts.
    dir: path.join(__dirname, 'fixtures/grants'),
  });

  const fixtures = defineModule({
    id: 'secretos',
    requires: ['grants'],
    dir: path.join(__dirname, 'fixtures/auth'),
    routes: './*.api.ts',
    permissions: [{ key: 'secretos.ver', label: 'Ver secretos' }],
  });

  let samble: Samble;
  const visto: { db: boolean } = { db: false };

  beforeAll(async () => {
    const db = await createTestDb();
    await query(
      db,
      'create table permisos_demo (user_id int primary key, perms varchar)',
    );
    await query(db, "insert into permisos_demo values (7, 'secretos.ver')");
    await query(db, "insert into permisos_demo values (8, 'otra.cosa')");

    samble = await Samble.create({
      db,
      modules: [grantsModule, fixtures],
      version: '2.0.0-dev.0',
      auth: async (request, ctx) => {
        visto.db = typeof ctx.db.execute === 'function';
        const raw = request.headers['x-user'];
        if (!raw) return null;

        const permissions = await ctx.get(Grants).forUser(Number(raw));
        if (!permissions) return null;

        return { actor: { userId: Number(raw) }, permissions };
      },
    });
    await samble.start(0);
  });

  afterAll(async () => {
    await samble?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('el DataSource llega vivo en el contexto', async () => {
    await request(samble.getApp()).get('/api/yo/publico');

    expect(visto.db).toBe(true);
  });

  it('los permisos salen de la base, por contrato', async () => {
    const res = await request(samble.getApp())
      .get('/api/yo/secreto')
      .set('x-user', '7');

    expect(res.status).toBe(200);
  });

  it('otro usuario, otros permisos: 403', async () => {
    const res = await request(samble.getApp())
      .get('/api/yo/secreto')
      .set('x-user', '8');

    expect(res.status).toBe(403);
  });

  it('un usuario que ya no existe deja de ser actor, sin re-login', async () => {
    const res = await request(samble.getApp())
      .get('/api/yo/actual')
      .set('x-user', '999');

    expect(res.status).toBe(401);
  });
});

describe('defineAuth', () => {
  /**
   * El resolutor sólo necesita el request y el contexto; acá no hay ni servidor
   * ni base, así que los dos van falsos y con lo mínimo que se mira.
   */
  const pedido = { headers: {} } as unknown as Request;
  const contexto = {
    db: {} as never,
    get: () => {
      throw new Error('no se usa');
    },
  } as unknown as AuthContext;

  it('pasa el request y el contexto tal cual al callback', async () => {
    const resolver = defineAuth(async (request, context) => {
      expect(request).toBe(pedido);
      expect(context).toBe(contexto);
      return { actor: actorDe(1), permissions: ['billing.read'] };
    });

    await expect(resolver(pedido, contexto)).resolves.toEqual({
      actor: { userId: 1 },
      permissions: ['billing.read'],
    });
  });

  it('con varias estrategias se queda con la primera que reconoce', async () => {
    const llamadas: string[] = [];

    const resolver = defineAuth(
      async () => {
        llamadas.push('sesión');
        return null;
      },
      async () => {
        llamadas.push('token');
        return { actor: actorDe(7) };
      },
      async () => {
        llamadas.push('api-key');
        return { actor: actorDe(99) };
      },
    );

    await expect(resolver(pedido, contexto)).resolves.toEqual({
      actor: { userId: 7 },
    });

    // La tercera no corre: el corto circuito es el punto de encadenarlas.
    expect(llamadas).toEqual(['sesión', 'token']);
  });

  it('si ninguna reconoce a nadie, la llamada es anónima', async () => {
    const resolver = defineAuth(
      async () => null,
      // `undefined` también significa "no lo reconozco": un `return` pelado
      // dentro de un if es la forma más fácil de escribirlo sin querer.
      async () => undefined,
    );

    await expect(resolver(pedido, contexto)).resolves.toBeNull();
  });

  it('un resultado sin actor es error de código, no un 401', async () => {
    // `isAuthenticated` diría true con `actor` en undefined: el 401 que
    // correspondía nunca pasa y la falla aparece después, en otra parte.
    const resolver = defineAuth(async () => ({ permissions: ['*'] }) as never);

    await expect(resolver(pedido, contexto)).rejects.toThrow(
      /The resolver passed to defineAuth\(\) returned no actor/,
    );
    await expect(resolver(pedido, contexto)).rejects.not.toBeInstanceOf(
      AuthError,
    );
  });

  it('permissions como texto en vez de lista también se rechaza', async () => {
    // `new Set('billing.read')` guarda doce letras y no coincide con ninguna
    // clave: sin este chequeo el síntoma es "los permisos no funcionan".
    const resolver = defineAuth(
      async () => ({ actor: actorDe(1), permissions: 'billing.read' }) as never,
    );

    await expect(resolver(pedido, contexto)).rejects.toThrow(
      /returned `permissions` as string, not a list/,
    );
  });

  it('nombra cuál de las estrategias devolvió mal', async () => {
    const resolver = defineAuth(
      async () => null,
      async () => ({}) as never,
    );

    await expect(resolver(pedido, contexto)).rejects.toThrow(/Resolver #2/);
  });
});
