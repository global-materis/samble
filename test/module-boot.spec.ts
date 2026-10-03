import type { Transaction } from '../lib';
import { sql } from 'drizzle-orm';
import path from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it } from '@jest/globals';
import Samble from '../lib/core/samble';
import { defineModule } from '../lib/modules/define-module';
import { ModuleStore } from '../lib/modules/module-store';
import { ModuleMigrator } from '../lib/modules/module-migrator';
import { closeTestDb, createTestDb, tableNames } from './helpers/test-db';
import { cualquiera } from './helpers/auth';
import type { Database } from '../lib';

const billingDir = path.join(__dirname, 'fixtures/modules/billing');

class CrearCargos1000 {
  async up(db: Transaction) {
    await db.execute(sql.raw('create table cargos_demo (id int primary key)'));
  }
}

const billing = () =>
  defineModule({
    id: 'billing',
    dir: billingDir,
    routes: './controllers/*.controller.ts',
    migrations: [CrearCargos1000],
  });

/** Opcional: instalado pero apagado salvo que se lo encienda. */
const news = () =>
  defineModule({
    id: 'news',
    dir: billingDir,
    routes: './controllers/*.controller.ts',
  });

const siteDir = path.join(__dirname, 'fixtures/modules/site');

/** Un módulo que sirve una vista Y una API. */
const site = () =>
  defineModule({
    id: 'site',
    dir: siteDir,
    routes: './endpoints/*.endpoint.ts',
  });

describe('un grupo con su propio basePath', () => {
  let db: Database;
  let app: Samble;

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('la vista queda fuera del prefijo y la API dentro, desde el MISMO módulo', async () => {
    // Es el caso de un monolito: `/api/tienda/inicio` no es una URL que nadie
    // vaya a enlazar, pero `/api/tienda/items` sí es la API.
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [site()],
      basePath: '/api',
      version: '2.0.0',
    });
    await app.start(0);
    const server = app.getApp();

    expect((await request(server).get('/tienda/inicio')).status).toBe(200);
    expect((await request(server).get('/api/tienda/items')).status).toBe(200);
  });

  it('y ninguna de las dos contesta en el lugar de la otra', async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [site()],
      basePath: '/api',
      version: '2.0.0',
    });
    await app.start(0);
    const server = app.getApp();

    expect((await request(server).get('/api/tienda/inicio')).status).toBe(404);
    expect((await request(server).get('/tienda/items')).status).toBe(404);
  });
});

describe('arranque con módulos', () => {
  let db: Database;
  let app: Samble;

  const boot = async (modules: ReturnType<typeof billing>[]) => {
    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: modules,
      version: '2.0.0-dev.0',
    });
    await app.start(0);
    return app.getApp();
  };

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('monta las rutas del módulo y responde', async () => {
    db = await createTestDb();
    const server = await boot([billing()]);

    const res = await request(server).get('/api/facturacion/cargos');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ charges: [], limit: 50 });
  });

  it('corre las migraciones del módulo antes de montar', async () => {
    db = await createTestDb();
    await boot([billing()]);

    expect(await tableNames(db)).toContain('cargos_demo');
  });

  it('registra el módulo en _modules', async () => {
    db = await createTestDb();
    await boot([billing()]);

    const stored = await new ModuleStore(db).list();
    expect(stored).toEqual([{ id: 'billing' }]);
  });

  it('un módulo presente en el código responde desde el primer arranque', async () => {
    // No hay instalación en dos tiempos: lo que está desplegado, sirve.
    db = await createTestDb();
    const server = await boot([news()]);

    const res = await request(server).get('/api/facturacion/cargos');

    expect(res.status).toBe(200);
  });

  it('no repite las migraciones en el segundo arranque', async () => {
    db = await createTestDb();
    await boot([billing()]);
    await app.close({ database: false });

    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [billing()],
      version: '2.0.0-dev.0',
    });
    await app.start(0);

    expect(await new ModuleMigrator(db).pending([billing()])).toEqual([]);
  });

  it('no arranca si falta una dependencia', async () => {
    db = await createTestDb();
    const huerfano = defineModule({
      id: 'billing',
      requires: ['fantasma'],
    });

    app = await Samble.create({ auth: cualquiera, db, modules: [huerfano] });
    await expect(app.start(0)).rejects.toThrow(/is not installed/);
  });

  it('sin módulos, el arranque es el de siempre', async () => {
    db = await createTestDb();
    app = await Samble.create({ auth: cualquiera, db, modules: [] });
    await app.start(0);

    expect(await tableNames(db)).not.toContain('_modules');
  });
});
