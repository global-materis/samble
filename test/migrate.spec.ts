import type { Transaction } from '../lib';
import { sql } from 'drizzle-orm';
import path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import Samble from '../lib/core/samble';
import { defineModule } from '../lib/modules/define-module';
import {
  closeTestDb,
  createTestDb,
  query,
  tableNames,
} from './helpers/test-db';
import { cualquiera } from './helpers/auth';
import type { Database } from '../lib';

/**
 * Migrar sin levantar el servidor.
 *
 * Hasta ahora las migraciones sólo corrían dentro de `start()`, que además
 * monta rutas y arranca crons. En un despliegue eso obliga a "levantar la app
 * para migrar": si la migración falla, el servidor ya está arriba. Separarlo
 * permite `migrate` y después `start`, y que el primero rompa la release.
 */

const dir = path.join(__dirname, 'fixtures/modules/billing');

class CrearCargos1000 {
  async up(db: Transaction) {
    await db.execute(sql.raw('create table cargos_demo (id int primary key)'));
  }
}

class CrearNotas2000 {
  async up(db: Transaction) {
    await db.execute(sql.raw('create table notas_demo (id int primary key)'));
  }
}

const billing = () =>
  defineModule({
    id: 'billing',
    dir,
    routes: './controllers/*.controller.ts',
    migrations: [CrearCargos1000],
  });

/** Opcional: instala APAGADO, así que no migra. */
const news = () =>
  defineModule({
    id: 'news',
    dir,
    migrations: [CrearNotas2000],
  });

/** Un módulo cuyo índice de migraciones no exporta nada. */
const sinMigraciones = () =>
  defineModule({
    id: 'vacio',
    dir,
    migrations: {},
  });

describe('app.migrate()', () => {
  let db: Database;
  let app: Samble;

  const build = async (modules: ReturnType<typeof billing>[]) => {
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules,
      version: '2.0.0',
    });
    return app;
  };

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('corre las migraciones sin montar nada', async () => {
    db = await createTestDb();
    const application = await build([billing()]);

    const ran = await application.migrate();

    expect(ran).toEqual([{ module: 'billing', name: 'CrearCargos1000' }]);
    expect(await tableNames(db)).toContain('cargos_demo');
  });

  it('la segunda vez no repite nada', async () => {
    db = await createTestDb();
    const application = await build([billing()]);

    await application.migrate();
    expect(await application.migrate()).toEqual([]);
  });

  it('migra TODOS los módulos del código, en orden de dependencias', async () => {
    db = await createTestDb();
    const application = await build([billing(), news()]);

    const ran = await application.migrate();

    expect(ran.map((entry) => entry.module)).toEqual(['billing', 'news']);
    expect(await tableNames(db)).toContain('notas_demo');
  });

  it('--dry-run dice qué correría y no toca la base', async () => {
    db = await createTestDb();
    const application = await build([billing()]);

    const pending = await application.migrate({ dryRun: true });

    expect(pending).toEqual([{ module: 'billing', name: 'CrearCargos1000' }]);
    expect(await tableNames(db)).not.toContain('cargos_demo');
    // Tampoco registró el módulo: un ensayo no instala nada.
    const registrados = await query(db, 'select id from _modules');
    expect(registrados).toEqual([]);
  });

  it('migra sin que nadie haya arrancado ni conectado antes', async () => {
    // Es la diferencia con start(): un comando que sólo migra no debería tener
    // que preparar la conexión por su cuenta. Acá no se llama a connect() ni a
    // start() en ningún momento.
    db = await createTestDb();
    const application = await build([billing()]);

    await application.migrate();

    expect(await tableNames(db)).toContain('cargos_demo');
  });
});

describe('app.migrationStatus()', () => {
  let db: Database;
  let app: Samble;

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('dice qué declaró cada módulo y qué de eso ya corrió', async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [billing(), news()],
      version: '2.0.0',
    });

    expect(await app.migrationStatus()).toEqual([
      {
        module: 'billing',
        migrations: [{ name: 'CrearCargos1000', applied: false }],
      },
      {
        module: 'news',
        migrations: [{ name: 'CrearNotas2000', applied: false }],
      },
    ]);

    await app.migrate();

    const despues = await app.migrationStatus();
    expect(despues[0].migrations[0].applied).toBe(true);
    expect(despues[1].migrations[0].applied).toBe(true);
  });

  it('un módulo sin migraciones declaradas se ve como tal', async () => {
    // Es el caso que desde la base es indistinguible de "todavía no corrió":
    // el archivo existe pero el índice no lo exporta.
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [sinMigraciones()],
      version: '2.0.0',
    });

    expect(await app.migrationStatus()).toEqual([
      { module: 'vacio', migrations: [] },
    ]);
  });
});
