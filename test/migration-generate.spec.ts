import 'reflect-metadata';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { sql } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { ModuleMigrator } from '../lib/modules/module-migrator';
import * as schemaDiff from '../lib/modules/schema-diff';
import { tableOwners, type SchemaSnapshot } from '../lib/modules/schema-diff';
import { postgres } from '../lib/dialects/postgres';
import {
  generateMigration,
  snapshotPath,
} from '../lib/cli/migration-generator';
import { createMigration } from '../lib/cli/generators';
import { apply } from '../lib/cli/writer';
import type { ResolvedModule } from '../lib/modules/module-manifest';

// This suite runs on Postgres (PGlite); the other engines are in
// dialects.spec.ts. The wrappers bind the dialect and accept a snapshot still
// being computed, so each case reads like the question it asks.
type Snap = SchemaSnapshot | Promise<SchemaSnapshot>;
const emptySnapshot = () => schemaDiff.emptySnapshot(postgres);
const moduleSnapshot = async (mod: ResolvedModule, previous?: Snap) =>
  schemaDiff.moduleSnapshot(postgres, mod, await previous);
const diffSnapshots = async (previous: Snap, current: Snap) =>
  schemaDiff.diffSnapshots(postgres, await previous, await current);
const liveDrift = (db: Database, modules: ResolvedModule[]) =>
  schemaDiff.liveDrift(postgres, db, modules);
import {
  closeTestDb,
  createTestDb,
  query,
  resetSchema,
  tableNames,
} from './helpers/test-db';
import type { Database, Migration, Transaction } from '../lib';

const usuarios = pgTable('gen_users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

const facturas = pgTable('gen_invoices', {
  id: serial('id').primaryKey(),
  total: text('total').notNull(),
  // A OTRO módulo: la constraint es de quien la declara.
  userId: integer('user_id')
    .notNull()
    .references(() => usuarios.id),
});

const modulo = (id: string, tables: unknown[]): ResolvedModule =>
  ({ id, tables }) as unknown as ResolvedModule;

const users = modulo('users', [usuarios]);
const billing = modulo('billing', [facturas]);

/**
 * El reparto de trabajo: Drizzle Kit compara dos descripciones de un esquema y
 * escribe el SQL —eso lo hace mejor que cualquier cosa a mano y es la parte que
 * TIENE que estar bien—. Lo que samble decide es QUÉ se compara, y eso es por
 * módulo: sus tablas contra su propio snapshot.
 *
 * Ninguna de estas pruebas necesita base de datos, y eso es el punto: escribir
 * una migración dejó de requerir un Postgres andando.
 */
describe('migration:generate', () => {
  it('desde cero: crea la tabla, y el down la borra', async () => {
    const diff = await diffSnapshots(emptySnapshot(), moduleSnapshot(users));

    expect(diff.up.join('\n')).toMatch(/create table[\s\S]*gen_users/i);
    expect(diff.down.join('\n')).toMatch(/drop table[\s\S]*gen_users/i);
  });

  it('con el snapshot al día, no hay nada que generar', async () => {
    const snap = moduleSnapshot(users);

    expect((await diffSnapshots(snap, snap)).up).toEqual([]);
  });

  it('incremental: una columna nueva es un ALTER, no un CREATE', async () => {
    const antes = moduleSnapshot(modulo('users', [usuarios]));

    const conNota = pgTable('gen_users', {
      id: serial('id').primaryKey(),
      name: text('name').notNull(),
      note: text('note'),
    });

    const diff = await diffSnapshots(
      antes,
      moduleSnapshot(modulo('users', [conNota]), antes),
    );

    expect(diff.up).toHaveLength(1);
    expect(diff.up[0]).toMatch(/alter table "gen_users" add column "note"/i);
  });

  it('el diff de un módulo trae SÓLO sus tablas', async () => {
    // Esto es lo que reemplazó a adivinar de quién era cada tabla: comparar las
    // tablas de un módulo contra el snapshot de ese módulo no tiene nada que
    // atribuir. Antes, un diff de todo el esquema había que repartirlo.
    const diff = await diffSnapshots(emptySnapshot(), moduleSnapshot(users));

    expect(diff.up.join('\n')).not.toMatch(/create table[^;]*gen_invoices/i);
  });

  it('una FK a otro módulo queda en el módulo que la declara', async () => {
    // Y nombra la tabla del otro. Corre bien porque samble migra en orden de
    // dependencias: para cuando esto se aplica, gen_users ya existe.
    const diff = await diffSnapshots(emptySnapshot(), moduleSnapshot(billing));

    expect(diff.up.join('\n')).toMatch(
      /add constraint[\s\S]*references "public"\."gen_users"/i,
    );
  });

  it('escribe una migración que samble sabe correr, y su snapshot', async () => {
    const diff = await diffSnapshots(emptySnapshot(), moduleSnapshot(users));

    const { files } = generateMigration({
      target: 'users/create-users',
      diff,
      snapshot: await moduleSnapshot(users),
      now: 1789779741336,
    });

    expect(files.map((file) => file.path)).toEqual([
      'src/modules/users/migrations/1789779741336-create-users.ts',
      'src/modules/users/migrations/meta/snapshot.json',
    ]);

    const [migracion, snapshot] = files;
    // El sello al final del nombre es lo que ordena dentro del módulo; sin él
    // samble rechaza la clase.
    expect(migracion.content).toContain(
      'export class CreateUsers1789779741336 implements Migration',
    );
    expect(migracion.content).toMatch(/async up\(db: Transaction\)/);
    expect(migracion.content).toMatch(/async down\(db: Transaction\)/);
    expect(migracion.content).toMatch(/gen_users/);

    // El snapshot es lo que comparará el siguiente generate. Sin él, el próximo
    // se escribiría contra un esquema vacío y volvería a crear todo.
    expect(JSON.parse(snapshot.content)).toMatchObject({
      dialect: 'postgresql',
    });
  });

  it('la SEGUNDA migración se puede escribir: el snapshot se reemplaza', async () => {
    // El caso que se escapó hasta probarlo en un proyecto de verdad. El writer
    // se niega a pisar un archivo que ya existe —una migración es historia— y
    // el snapshot cae en la misma bolsa, así que el segundo generate de un
    // módulo moría con "Already there". Es lo contrario: el snapshot existe
    // para ser reemplazado.
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'samble-snap-'));

    try {
      const primera = generateMigration({
        target: 'users/create-users',
        diff: await diffSnapshots(emptySnapshot(), moduleSnapshot(users)),
        snapshot: await moduleSnapshot(users),
        now: 1,
      });
      apply(primera, { root: raiz });

      const conNota = pgTable('gen_users', {
        id: serial('id').primaryKey(),
        name: text('name').notNull(),
        note: text('note'),
      });
      const antes = moduleSnapshot(users);
      const despues = moduleSnapshot(modulo('users', [conNota]), antes);

      const segunda = generateMigration({
        target: 'users/add-note',
        diff: await diffSnapshots(antes, despues),
        snapshot: await despues,
        now: 2,
      });

      // Sin --force, que es lo que haría un autor.
      const result = apply(segunda, { root: raiz });

      // La migración es nueva; el snapshot se reporta como actualizado, no
      // como creado: decirle "created" de un archivo que ya estaba es una
      // mentira chica que importa el día que busque qué cambió.
      expect(result.created).toEqual([
        'src/modules/users/migrations/2-add-note.ts',
      ]);
      expect(result.edited).toContain(
        'src/modules/users/migrations/meta/snapshot.json',
      );

      // Y la primera migración sigue intacta: esa sí es historia.
      expect(
        fs.existsSync(
          path.join(raiz, 'src/modules/users/migrations/1-create-users.ts'),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('el camino del snapshot es uno solo, y lo dice el módulo', () => {
    expect(snapshotPath('src/modules', 'users')).toBe(
      'src/modules/users/migrations/meta/snapshot.json',
    );
  });

  it('se niega cuando no hay cambios, en vez de escribir una vacía', async () => {
    const snap = await moduleSnapshot(users);
    const diff = await diffSnapshots(snap, snap);

    expect(() =>
      generateMigration({ target: 'users/nada', diff, snapshot: snap }),
    ).toThrow(/Nothing to generate: "users" has no changes/);
  });

  it('la migración generada entra en el ancho de prettier', async () => {
    const vacio = await emptySnapshot();
    // Tercera vez que aparece esta regla —después del import y del token— y por
    // la misma razón: el proyecto que `samble init` arma corre
    // `prettier --check`, así que un archivo generado una columna más ancho le
    // rompe el lint al consumidor en su primer commit. Acá el ancho es un
    // pedazo de SQL que nadie puede prever.
    const generado = (query: string) =>
      generateMigration({
        target: 'users/x',
        diff: { up: [query], down: [] },
        snapshot: vacio,
        now: 1,
      }).files[0].content;

    // Corta: entra en una línea.
    expect(generado('DROP TABLE "x";')).toContain(
      '    await db.execute(sql.raw(`DROP TABLE "x";`));',
    );

    // Larga: prettier baja el sql.raw y después el literal.
    const larga =
      'ALTER TABLE "billing_charge" ADD COLUMN "amount" integer DEFAULT 0 NOT NULL;';
    expect(generado(larga)).toContain(
      [
        '    await db.execute(',
        '      sql.raw(',
        `        \`${larga}\`,`,
        '      ),',
        '    );',
      ].join('\n'),
    );

    // Y ninguna línea se pasa, salvo el literal mismo, que prettier no parte.
    for (const query of ['DROP TABLE "x";', larga]) {
      const lineas = generado(query)
        .split('\n')
        .filter((linea) => !linea.includes('ALTER TABLE'));
      for (const linea of lineas) {
        expect(linea.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it('sin vuelta atrás no escribe un down() vacío', async () => {
    // Un `down()` vacío afirma que esto se deshace no haciendo nada, que es una
    // cosa distinta de "la vuelta no está escrita". `Migration.down` es opcional
    // justamente para poder decir la diferencia — y de paso no deja un
    // parámetro sin usar en un archivo que tiene que pasar el lint del que lo
    // recibe.
    const { files, hints } = generateMigration({
      target: 'users/x',
      diff: { up: ['DROP TABLE "x";'], down: [] },
      snapshot: await emptySnapshot(),
      now: 1,
    });

    expect(files[0].content).not.toContain('down(');
    expect(hints.join(' ')).toMatch(/It has no down\(\)/);
  });

  it('no rompe el literal cuando el SQL trae backticks', async () => {
    const diff = { up: ['SELECT `raro`, "${x}"'], down: [] };

    const [archivo] = generateMigration({
      target: 'users/raro',
      diff,
      snapshot: await emptySnapshot(),
      now: 1,
    }).files;

    expect(archivo.content).toContain('SELECT \\`raro\\`');
    expect(archivo.content).toContain('\\${x}');
  });

  it('sabe de qué módulo es cada tabla, sin conexión ni metadata', () => {
    expect(tableOwners([users, billing])).toEqual(
      new Map([
        ['gen_users', 'users'],
        ['gen_invoices', 'billing'],
      ]),
    );
  });
});

/**
 * La otra pregunta, la que el snapshot no puede contestar: ¿se separó la base
 * viva de lo que dice el código?
 */
describe('deriva contra la base viva', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await resetSchema(db);
  });

  afterAll(closeTestDb);

  it('dice qué le falta a la base, y no la toca', async () => {
    const falta = await liveDrift(db, [users]);

    expect(falta.join('\n')).toMatch(/create table[\s\S]*gen_users/i);
    // Preguntar no es aplicar: la tabla sigue sin existir.
    const existe = await query<{ t: string | null }>(
      db,
      "select to_regclass('public.gen_users') as t",
    );
    expect(existe[0].t).toBeNull();
  });

  it('con la base al día no reporta nada', async () => {
    await db.execute(
      sql.raw(
        'create table gen_users (id serial primary key, name text not null)',
      ),
    );

    expect(await liveDrift(db, [users])).toEqual([]);
  });
});

/**
 * El círculo completo: lo que el diff escribe, corriendo de verdad.
 *
 * Todo lo de arriba compara descripciones de un esquema. Esto contesta la otra
 * pregunta, la que ninguna cantidad de tipos contesta: ¿el SQL que Drizzle Kit
 * produce se aplica a un Postgres?
 */
describe('el SQL generado corre', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await resetSchema(db);
  });

  afterAll(closeTestDb);

  /** Una migración que corre lo que el diff escribió, como el archivo generado. */
  const migracion = (nombre: string, up: string[]): Function => {
    const clase = class {
      public async up(tx: Transaction): Promise<void> {
        for (const query of up) await tx.execute(sql.raw(query));
      }
    };
    Object.defineProperty(clase, 'name', { value: nombre });
    return clase;
  };

  it('crea la tabla, y después le agrega la columna', async () => {
    const migrator = new ModuleMigrator(db);

    // Primera migración: desde cero.
    const inicial = await diffSnapshots(emptySnapshot(), moduleSnapshot(users));
    await migrator.run([
      {
        id: 'users',
        migrations: [migracion('CreateUsers1000', inicial.up)],
      } as unknown as ResolvedModule,
    ]);

    expect(await tableNames(db)).toContain('gen_users');

    // Segunda: incremental, contra el snapshot de la primera.
    const antes = moduleSnapshot(users);
    const conNota = pgTable('gen_users', {
      id: serial('id').primaryKey(),
      name: text('name').notNull(),
      note: text('note'),
    });
    const segunda = await diffSnapshots(
      antes,
      moduleSnapshot(modulo('users', [conNota]), antes),
    );

    await migrator.run([
      {
        id: 'users',
        migrations: [
          migracion('CreateUsers1000', inicial.up),
          migracion('AddNote2000', segunda.up),
        ],
      } as unknown as ResolvedModule,
    ]);

    // La columna está, y la primera migración NO volvió a correr: si lo hubiera
    // hecho, el create table habría fallado y esto sería un throw.
    const columnas = await query<{ column_name: string }>(
      db,
      `select column_name from information_schema.columns
        where table_name = 'gen_users' order by column_name`,
    );
    expect(columnas.map((c) => c.column_name)).toEqual(['id', 'name', 'note']);
  });

  it('el down deshace lo que el up hizo', async () => {
    const diff = await diffSnapshots(emptySnapshot(), moduleSnapshot(users));

    for (const q of diff.up) await db.execute(sql.raw(q));
    expect(await tableNames(db)).toContain('gen_users');

    for (const q of diff.down) await db.execute(sql.raw(q));
    expect(await tableNames(db)).not.toContain('gen_users');
  });
});

/**
 * La trampa que esto cierra: una migración VACÍA se aplica sin error.
 *
 * Una consulta que es sólo un comentario corre bien, así que samble la anota
 * como aplicada — y desde ahí no tiene razón para volver a correrla. El SQL
 * que se escriba después no se ejecuta nunca, y `samble migrate` sigue
 * contestando "nothing to migrate" sobre una tabla que jamás se creó.
 */
describe('una migración sin escribir', () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await resetSchema(db);
  });

  afterAll(closeTestDb);

  const conMigracion = (clase: Function): ResolvedModule =>
    ({ id: 'users', migrations: [clase] }) as unknown as ResolvedModule;

  it('el andamiaje se niega a correr hasta que tenga SQL', async () => {
    const [archivo] = createMigration({
      target: 'users/create-users',
      modulesDir: 'src/modules',
      from: '@samble/core',
      now: 1789779741336,
    }).files;

    expect(archivo.content).toContain('has no SQL yet');
  });

  it('y al negarse no deja rastro: vuelve a estar pendiente', async () => {
    class CreateUsers1000 implements Migration {
      public async up(db: Transaction): Promise<void> {
        await db.execute(
          sql.raw(`
          -- what this migration creates
        `),
        );
        throw new Error(
          'CreateUsers1000 has no SQL yet: write it, or delete the file.',
        );
      }
      public async down(): Promise<void> {}
    }

    const migrator = new ModuleMigrator(db);
    const modulos = [conMigracion(CreateUsers1000)];

    await expect(migrator.run(modulos)).rejects.toThrow(/has no SQL yet/);

    // Lo que importa: sigue pendiente. Si se hubiera anotado, escribir el SQL
    // después no habría servido de nada.
    expect(await migrator.pending(modulos)).toEqual([
      { module: 'users', name: 'CreateUsers1000' },
    ]);
  });

  it('sin el freno, una vacía queda anotada y ya no vuelve a correr', async () => {
    // Este es el comportamiento que hacía falta atajar, escrito como prueba
    // para que se vea por qué el andamiaje lanza.
    class Vacia1000 implements Migration {
      public async up(db: Transaction): Promise<void> {
        await db.execute(
          sql.raw(`
          -- what this migration creates
        `),
        );
      }
      public async down(): Promise<void> {}
    }

    const migrator = new ModuleMigrator(db);
    const modulos = [conMigracion(Vacia1000)];

    await migrator.run(modulos);

    expect(await migrator.pending(modulos)).toEqual([]);
  });
});
