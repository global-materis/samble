import type { Transaction } from '../lib';
import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { defineModule } from '../lib/modules/define-module';
import {
  ModuleMigrationError,
  ModuleMigrator,
  orderMigrations,
} from '../lib/modules/module-migrator';
import {
  closeTestDb,
  createTestDb,
  resetSchema,
  tableNames,
} from './helpers/test-db';
import type { Database } from '../lib';

/* ------------------------------------------------------------------ *
 * Orden: regla pura, sin base de datos.
 * ------------------------------------------------------------------ */

describe('orderMigrations', () => {
  it('ordena por el sello de tiempo del nombre, no por el orden de entrada', () => {
    class Segunda2000 {}
    class Primera1000 {}
    class Tercera3000 {}

    const order = orderMigrations([Segunda2000, Primera1000, Tercera3000], 'm');

    expect(order.map((m) => m.name)).toEqual([
      'Primera1000',
      'Segunda2000',
      'Tercera3000',
    ]);
  });

  it('compara los sellos como números, no como texto', () => {
    // Como texto, "10000" va antes que "9000" y el orden se invierte en
    // silencio. Con sellos de distinto largo es el error fácil de cometer.
    class Vieja9000 {}
    class Nueva10000 {}

    expect(
      orderMigrations([Nueva10000, Vieja9000], 'm').map((m) => m.name),
    ).toEqual(['Vieja9000', 'Nueva10000']);
  });

  it('acepta sellos de tiempo reales de 13 dígitos', () => {
    class Vieja1780449821400 {}
    class Nueva1788700000000 {}

    expect(
      orderMigrations([Nueva1788700000000, Vieja1780449821400], 'm').map(
        (m) => m.name,
      ),
    ).toEqual(['Vieja1780449821400', 'Nueva1788700000000']);
  });

  it('exige sello de tiempo en vez de adivinar el orden', () => {
    class SinSello {}
    expect(() => orderMigrations([SinSello], 'billing')).toThrow(
      /must end with a timestamp/,
    );
  });

  it('rechaza dos migraciones con el mismo sello', () => {
    class UnaCosa1000 {}
    class OtraCosa1000 {}

    expect(() =>
      orderMigrations([UnaCosa1000, OtraCosa1000], 'billing'),
    ).toThrow(/share the timestamp 1000, so their order is undefined/);
  });

  it('sin migraciones devuelve una lista vacía', () => {
    expect(orderMigrations([], 'billing')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Ejecución: contra Postgres de verdad (PGlite).
 * ------------------------------------------------------------------ */

class CrearClientes1000 {
  async up(db: Transaction) {
    await db.execute(sql.raw('create table clientes (id int primary key)'));
  }
}

class AgregarNombre2000 {
  async up(db: Transaction) {
    await db.execute(sql.raw('alter table clientes add column nombre text'));
  }
}

/** Depende de que la tabla del módulo "identity" ya exista. */
class CrearCargos500 {
  async up(db: Transaction) {
    await db.execute(
      sql.raw(
        'create table cargos (id int primary key, cliente int references clientes(id))',
      ),
    );
  }
}

class Rompe9000 {
  async up(db: Transaction) {
    await db.execute(sql.raw('create table a_medias (id int)'));
    await db.execute(sql.raw('esto no es sql'));
  }
}

describe('ModuleMigrator', () => {
  let db: Database;
  let migrator: ModuleMigrator;

  beforeAll(async () => {
    db = await createTestDb();
    migrator = new ModuleMigrator(db);
  });

  beforeEach(async () => {
    await resetSchema(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  const identity = defineModule({
    id: 'identity',
    migrations: [AgregarNombre2000, CrearClientes1000],
  });

  const billing = defineModule({
    id: 'billing',
    requires: ['identity'],
    migrations: [CrearCargos500],
  });

  it('crea la tabla de registro al correr', async () => {
    await migrator.run([]);
    expect(await tableNames(db)).toContain('_module_migrations');
  });

  it('aplica las migraciones de un módulo en orden', async () => {
    const ran = await migrator.run([identity]);

    expect(ran.map((m) => m.name)).toEqual([
      'CrearClientes1000',
      'AgregarNombre2000',
    ]);
    expect(await tableNames(db)).toContain('clientes');
  });

  it('respeta el orden de módulos por encima del sello de tiempo', async () => {
    // CrearCargos500 tiene el sello MÁS BAJO de todos, pero pertenece a un
    // módulo que depende de identity: debe correr después igual. Con el runner
    // de TypeORM correría primero y fallaría por la clave foránea.
    const ran = await migrator.run([identity, billing]);

    expect(ran.map((m) => `${m.module}:${m.name}`)).toEqual([
      'identity:CrearClientes1000',
      'identity:AgregarNombre2000',
      'billing:CrearCargos500',
    ]);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(['cargos', 'clientes']),
    );
  });

  it('no repite lo ya aplicado', async () => {
    await migrator.run([identity]);
    const segunda = await migrator.run([identity]);

    expect(segunda).toEqual([]);
  });

  it('aplica solo lo nuevo cuando el módulo suma una migración', async () => {
    const soloLaPrimera = defineModule({
      id: 'identity',
      migrations: [CrearClientes1000],
    });

    await migrator.run([soloLaPrimera]);
    const ran = await migrator.run([identity]);

    expect(ran.map((m) => m.name)).toEqual(['AgregarNombre2000']);
  });

  it('informa lo pendiente sin aplicarlo', async () => {
    await migrator.ensureTable();
    const pending = await migrator.pending([identity]);

    expect(pending.map((m) => m.name)).toEqual([
      'CrearClientes1000',
      'AgregarNombre2000',
    ]);
    expect(await tableNames(db)).not.toContain('clientes');
  });

  it('deja de estar pendiente una vez aplicada', async () => {
    await migrator.run([identity]);
    expect(await migrator.pending([identity])).toEqual([]);
  });

  it('revierte por completo una migración que falla', async () => {
    const roto = defineModule({
      id: 'roto',
      migrations: [Rompe9000],
    });

    await expect(migrator.run([roto])).rejects.toThrow(ModuleMigrationError);

    // La tabla que alcanzó a crear antes de fallar no debe quedar.
    expect(await tableNames(db)).not.toContain('a_medias');
  });

  it('una migración fallida no queda registrada', async () => {
    const roto = defineModule({
      id: 'roto',
      migrations: [Rompe9000],
    });

    await migrator.run([]).catch(() => undefined);
    await migrator.run([roto]).catch(() => undefined);

    expect(await migrator.applied()).not.toContain('roto:Rompe9000');
  });

  it('lo aplicado antes del fallo se conserva', async () => {
    const roto = defineModule({
      id: 'roto',
      migrations: [Rompe9000],
    });

    await migrator.run([identity, roto]).catch(() => undefined);

    // identity quedó migrado: una transacción por migración, no por corrida.
    expect(await tableNames(db)).toContain('clientes');
    expect(await migrator.pending([identity])).toEqual([]);
  });

  it('el error dice de qué módulo y migración se trata', async () => {
    const roto = defineModule({
      id: 'roto',
      migrations: [Rompe9000],
    });

    try {
      await migrator.run([roto]);
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleMigrationError);
      expect((error as ModuleMigrationError).moduleId).toBe('roto');
      expect((error as ModuleMigrationError).migrationName).toBe('Rompe9000');
    }
  });
});
