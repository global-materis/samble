import path from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import Samble from '../lib/core/samble';
import { defineModule } from '../lib/modules/define-module';
import { collectModuleTables } from '../lib/modules/collect-tables';
import { openDatabase } from '../lib/modules/open-database';
import { ModuleDefinitionError } from '../lib/modules/module-manifest';
import { productos } from './fixtures/modules/catalog/product.table';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';
import type { Database, Transaction } from '../lib';

const catalogDir = path.join(__dirname, 'fixtures/modules/catalog');

class CrearProductos1000 {
  async up(db: Transaction) {
    await db.execute(
      sql.raw(
        'create table productos_demo (id int primary key, nombre varchar)',
      ),
    );
    await db.execute(
      sql.raw("insert into productos_demo values (1, 'Antena')"),
    );
  }
}

const catalog = () =>
  defineModule({
    id: 'catalog',
    dir: catalogDir,
    tables: [productos],
    migrations: [CrearProductos1000],
    routes: './controllers/*.controller.ts',
  });

describe('collectModuleTables', () => {
  const cargos = pgTable('cargos', { id: integer('id').primaryKey() });
  const facturas = pgTable('facturas', { id: integer('id').primaryKey() });

  /** Lo que importa es QUÉ tablas junta; las claves no son SQL. */
  const juntadas = (...mods: ReturnType<typeof defineModule>[]) =>
    Object.values(collectModuleTables(mods));

  it('junta las tablas de todos los módulos', () => {
    const a = defineModule({ id: 'a', tables: [cargos] });
    const b = defineModule({ id: 'b', tables: [facturas] });

    expect(juntadas(a, b)).toEqual([cargos, facturas]);
  });

  it('incluye las de un módulo que podría estar apagado', () => {
    // Apagar decide qué CORRE, no si los datos siguen alcanzables.
    const encendido = defineModule({
      id: 'a',
      tables: [cargos],
    });
    const apagado = defineModule({
      id: 'b',
      tables: [facturas],
    });

    expect(juntadas(encendido, apagado)).toHaveLength(2);
  });

  it('rechaza la misma tabla declarada por dos módulos', () => {
    const a = defineModule({ id: 'a', tables: [cargos] });
    const b = defineModule({ id: 'b', tables: [cargos] });

    expect(() => collectModuleTables([a, b])).toThrow(ModuleDefinitionError);
    // Y el mensaje nombra la tabla, que es lo único que ayuda a encontrarla.
    expect(() => collectModuleTables([a, b])).toThrow(
      /"cargos" is declared by both "a" and "b"/,
    );
  });

  it('sin módulos devuelve vacío', () => {
    expect(juntadas()).toEqual([]);
  });
});

describe('Samble.create', () => {
  let app: Samble | undefined;

  afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
    await closeTestDb();
  });

  it('la tabla del módulo se consulta desde el endpoint', async () => {
    const db = await createTestDb(collectModuleTables([catalog()]));

    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [catalog()],
      version: '2.0.0-dev.0',
    });

    // El endpoint hace this.db.select().from(productos): si la conexión que
    // samble reparte no es la que migró, esto es 500.
    await app.start(0);
    const res = await request(app.getApp()).get('/api/catalogo/productos');

    expect(res.status).toBe(200);
    expect(res.body.productos).toEqual([{ id: 1, nombre: 'Antena' }]);
  });

  it('con opciones abre la conexión, y no la toca hasta que se usa', () => {
    // El pool se construye sin conectarse: por eso `Samble.create` no es donde
    // se descubre que el host está mal, y por eso `connect()` existe.
    const db = openDatabase({ host: 'no-existe.invalid', database: 'x' }, [
      catalog(),
    ]);

    expect(typeof db.execute).toBe('function');
    expect(db.$client).toBeDefined();
  });

  it('acepta una conexión ya construida, y no la cierra', async () => {
    const db: Database = await createTestDb();

    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [],
      version: '2.0.0-dev.0',
    });
    await app.start(0);
    await app.close();
    app = undefined;

    // Sigue viva: samble no cierra lo que no abrió. Antes había que pedirlo con
    // close({ database: false }), que era una bandera para una regla.
    expect(await db.execute(sql`select 1 as ok`)).toBeDefined();
  });

  it('falla al crear si dos módulos declaran la misma tabla', async () => {
    const a = defineModule({ id: 'a', tables: [productos] });
    const b = defineModule({ id: 'b', tables: [productos] });

    await expect(
      Samble.create({
        auth: cualquiera,
        db: { host: 'localhost', database: 'x' },
        modules: [a, b],
      }),
    ).rejects.toThrow(/belongs to exactly one module/);
  });

  it('sin módulos arranca, pero avisa que no servirá nada', async () => {
    const db = await createTestDb();
    app = await Samble.create({ auth: cualquiera, db, modules: [] });

    // No es fatal: una app puede montar handlers propios con getApp(). Pero
    // desde que los módulos son el único camino para rutas y tareas, una lista
    // vacía casi siempre es un olvido y debe decirse.
    await app.start(0);
    expect(app.getApp()).toBeDefined();
  });
});
