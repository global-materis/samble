import 'reflect-metadata';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { AuthResolver, collectModuleTables, Database, Samble } from '../lib';
import identity from '../src/modules/identity/module';
import catalog from '../src/modules/catalog/module';
import reports from '../src/modules/reports/module';
import { closeTestDb, createTestDb, query } from './helpers/test-db';

/**
 * Runs the demo app under `src/` end to end.
 *
 * It exists because the previous demo had silently rotted — `@Priority` was
 * backwards so `/users/all` resolved to the `:id` route, and the endpoint that
 * rendered a page could never do it because nothing ever called
 * `setTemplates`. Example code nobody executes stops being an example.
 *
 * The session is replaced by a header-driven resolver: everything else —
 * migrations, routes, permissions, contracts, the transaction — is the real
 * thing.
 */
const headerAuth: AuthResolver = (req) => {
  const raw = req.headers['x-user'];
  if (!raw) return null;
  const perms = req.headers['x-perms'];
  return {
    actor: { userId: Number(raw) },
    permissions: typeof perms === 'string' ? perms.split(',') : [],
  };
};

const STAFF = ['catalog.products.view', 'catalog.products.manage'];

describe('la app de ejemplo (src/)', () => {
  let db: Database;
  let app: Samble;
  const server = () => app.getApp();

  beforeAll(async () => {
    // Las entidades se pasan a mano A PROPÓSITO: `create()` solo las agrega
    // cuando recibe OPCIONES de conexión. Si le das un DataSource ya
    // construido, sus entidades son asunto tuyo — como aquí.
    db = await createTestDb(collectModuleTables([identity, catalog, reports]));
    app = await Samble.create({
      db,
      modules: [identity, catalog, reports],
      version: '2.0.0',
      basePath: '/api',
      auth: headerAuth,
      // Como en src/index.ts.
      health: { path: '/health' },
      docs: {
        path: '/docs',
        info: { title: 'Samble Demo API', version: '2.0.0' },
      },
    });
    // Igual que src/index.ts: las vistas viven dentro del módulo que las usa.
    await app.setTemplates(
      'pug',
      path.join(__dirname, '../src/modules/*/views'),
    );
    await app.start(0);
  });

  afterAll(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('las migraciones de cada módulo crearon sus tablas y sembraron datos', async () => {
    const users = await query(
      db,
      'select username, role from demo_users order by id',
    );
    const products = await query(
      db,
      'select name from demo_products order by id',
    );

    expect(users).toEqual([
      { username: 'owner', role: 'owner' },
      { username: 'staff', role: 'staff' },
    ]);
    expect(products).toHaveLength(2);
  });

  it('el catálogo de permisos sale de los módulos, no de una lista central', async () => {
    const permisos = app.permissions();

    expect(permisos).toHaveLength(5);
    expect(permisos).toContainEqual({
      key: 'catalog.products.manage',
      label: 'Create and restock products',
      moduleId: 'catalog',
    });
    expect(permisos.map((p) => p.key)).toContain('reports.view');
  });

  it('sin @Group, el módulo sirve bajo su propio id', async () => {
    // `reports` no declara @Group, así que `summary` cuelga de /api/reports:
    // el id del módulo, sin repetirlo en el decorador.
    const res = await request(server())
      .get('/api/reports/summary')
      .set('x-user', '1')
      .set('x-perms', '*');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userCount: 2, productCount: 2 });
  });

  it('sin actor, un endpoint gateado responde 401', async () => {
    const res = await request(server()).get('/api/products');

    expect(res.status).toBe(401);
  });

  it('con actor pero sin el permiso, 403 — no 401', async () => {
    const res = await request(server())
      .get('/api/products')
      .set('x-user', '2')
      .set('x-perms', 'identity.users.view');

    expect(res.status).toBe(403);
  });

  it('con el permiso, responde', async () => {
    const res = await request(server())
      .get('/api/products')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('la contribución mira cada producto y puede decir que no', async () => {
    const res = await request(server())
      .get('/api/products')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    // Los sembrados tienen 12 y 40 de stock. El que sí califica se crea más
    // abajo, y ahí se ve el otro lado.
    expect(
      res.body.every((p: { badges: string[] }) => p.badges.length === 0),
    ).toBe(true);
  });

  it('"*" concede todo, que es lo que significa owner', async () => {
    const res = await request(server())
      .get('/api/users')
      .set('x-user', '1')
      .set('x-perms', '*');

    expect(res.status).toBe(200);
    // La contraseña no sale del proceso.
    expect(res.body[0]).not.toHaveProperty('password');
  });

  /**
   * La pagina de `src/public/` lee ESTOS campos. Sin esto se rompe en silencio
   * el dia que un endpoint cambie de forma, que es exactamente la podredumbre
   * que esta suite existe para evitar.
   */
  describe('las formas que consume la web', () => {
    it('/auth/me dice si hay sesion, quien es y que puede', async () => {
      const res = await request(server())
        .get('/api/auth/me')
        .set('x-user', '2')
        .set('x-perms', STAFF.join(','));

      expect(res.body).toEqual({
        authenticated: true,
        userId: 2,
        permissions: STAFF,
      });
    });

    it('/auth/me contesta al anonimo en vez de lanzar 401', async () => {
      const res = await request(server()).get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authenticated: false });
    });

    it('un usuario trae exactamente la proyeccion, ni un campo mas', async () => {
      const res = await request(server())
        .get('/api/users')
        .set('x-user', '1')
        .set('x-perms', '*');

      expect(Object.keys(res.body[0]).sort()).toEqual([
        'fullName',
        'id',
        'role',
        'username',
      ]);
    });

    it('un fallo trae title, detail y status: lo que la pagina imprime', async () => {
      const res = await request(server())
        .get('/api/users')
        .set('x-user', '2')
        .set('x-perms', 'catalog.products.view');

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        status: 403,
        title: expect.any(String),
        detail: expect.any(String),
      });
    });
  });

  it('valida el cuerpo antes de llegar a main()', async () => {
    const res = await request(server())
      .post('/api/products')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','))
      .send({ name: '', stock: -1 });

    expect(res.status).toBe(422);
    expect(res.body.errors).toHaveProperty('name');
    expect(res.body.errors).toHaveProperty('stock');
  });

  it('crear devuelve 201 porque el endpoint fija httpStatus', async () => {
    const res = await request(server())
      .post('/api/products')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','))
      .send({ name: 'Router 4G', stock: 5 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Router 4G', stock: 5 });
  });

  it('la ranura la llena otro módulo, sin que el anfitrión lo sepa', async () => {
    // "Router 4G" se creó con stock 5 en la prueba anterior. El badge lo pone
    // `reports`; `catalog` nunca nombra "Low stock" ni sabe que existe.
    const res = await request(server())
      .get('/api/products')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    const router = res.body.find(
      (p: { name: string }) => p.name === 'Router 4G',
    );
    expect(router.badges).toEqual(['Low stock']);
  });

  it('el restock escribe producto y movimiento en una transacción', async () => {
    const res = await request(server())
      .post('/api/products/1/restock')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','))
      .send({ quantity: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, stock: 22 });

    const moves = await query(
      db,
      'select product_id, quantity, user_id from demo_stock_moves',
    );
    expect(moves).toEqual([{ product_id: 1, quantity: 10, user_id: 2 }]);
  });

  it('si la transacción falla, no deja media escritura', async () => {
    const antes = await query(db, 'select count(*) as n from demo_stock_moves');

    const res = await request(server())
      .post('/api/products/9999/restock')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','))
      .send({ quantity: 10 });

    expect(res.status).toBe(404);
    const despues = await query(
      db,
      'select count(*) as n from demo_stock_moves',
    );
    expect(despues).toEqual(antes);
  });

  it('la página vive FUERA de /api, donde va una vista', async () => {
    // `@Group('products', { mount: '/' })`. Bajo /api sería
    // `/api/products/page`, una URL que nadie enlazaría.
    const res = await request(server())
      .get('/products/page')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Antenna 5GHz');
  });

  it('y bajo /api esa misma ruta no existe', async () => {
    const res = await request(server())
      .get('/api/products/page')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    // Se la come `/:id` como parámetro y el DTO lo frena: prueba de que el
    // grupo se montó en otro lado, no en los dos.
    expect(res.status).toBe(422);
  });

  it('@Priority(1) registra /export ANTES que /:id', async () => {
    // Al revés, ':id' se comería la ruta y el DTO daría 422 sobre "export".
    // Es el caso que `@Priority` existe para resolver: dos rutas del MISMO
    // grupo que se solapan.
    const res = await request(server())
      .get('/api/products/export')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    expect(res.status).toBe(200);
  });

  it('el mismo catálogo, como planilla: csv() sale de main()', async () => {
    const res = await request(server())
      .get('/api/products/export')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/csv');
    // El nombre del archivo lleva acento: viaja saneado y en UTF-8.
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Cat_logo de productos.csv"; filename*=UTF-8\'\'Cat%C3%A1logo%20de%20productos.csv',
    );
    // \uFEFF y no el carácter suelto: un BOM escrito literal es invisible en
    // el editor, y cualquiera lo borra sin darse cuenta de qué era.
    const texto = res.text.replace(/^\uFEFF/, '');
    expect(texto.split('\r\n')[0]).toBe('Producto,Precio,Stock');
    // Las columnas se declararon: el id interno NO se exporta.
    expect(texto).not.toContain('id');
  });

  it('el CSV también pasa por los permisos', async () => {
    const res = await request(server()).get('/api/products/export');

    expect(res.status).toBe(401);
  });

  it('/health contesta sin credenciales y fuera del basePath', async () => {
    // Un balanceador no inicia sesión, y no sabe de prefijos de aplicación.
    const res = await request(server()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
  });

  it('@ApiHidden deja la página fuera del spec, pero montada', async () => {
    const res = await request(server()).get('/docs.json');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toContain('/api/products');
    expect(Object.keys(res.body.paths)).not.toContain('/api/products/page');
  });

  it('un id no numérico lo frena el DTO, antes de main()', async () => {
    const res = await request(server())
      .get('/api/products/abc')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    expect(res.status).toBe(422);
  });

  it('un id inexistente es 404 lanzado desde main()', async () => {
    const res = await request(server())
      .get('/api/products/9999')
      .set('x-user', '2')
      .set('x-perms', STAFF.join(','));

    expect(res.status).toBe(404);
  });
});
