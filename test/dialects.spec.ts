import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import {
  closeTestDatabase,
  defineModule,
  openTestDatabase,
  Samble,
  tableExists,
  type AuthResolver,
  type Database,
  type DialectName,
  type ResolvedModule,
} from '../lib';
import { generateMigration } from '../lib/cli/migration-generator';
import { apply } from '../lib/cli/writer';
import { pgTable, serial } from 'drizzle-orm/pg-core';

/**
 * The same module on every engine, through the path an application takes:
 * tables written for that engine, a migration GENERATED from them, `migrate`,
 * routes that read and write through Drizzle, a transaction that rolls back,
 * and a live schema that matches the code afterwards.
 *
 * Postgres (PGlite) and SQLite (a temporary file) always run. MySQL needs a
 * server, so it runs when `SAMBLE_TEST_MYSQL_URL` points at one — a database is
 * created for the suite and dropped at the end — and is skipped, saying so,
 * when it does not.
 */

// Its own folder, not under test/.generated: cli.spec.ts empties that one when
// it starts, and the two files run in parallel workers.
const workspace = path.join(__dirname, '.generated-dialects');
const fixtures = path.join(__dirname, 'fixtures', 'dialects');

const anyone: AuthResolver = () => ({
  actor: {} as SambleAuth.Actor,
  permissions: ['*'],
});

/**
 * Identical on every engine, so it is written once. `any` because one
 * TypeScript program hosts three engines here, and `this.db` is typed for the
 * one an application declares — a real application has exactly one.
 */
const endpoints = `import { Endpoint, HttpGet, HttpPost } from '@samble/core';
import { notes } from '../tables/note.table';

@HttpGet()
export class ListNotes extends Endpoint {
  async main() {
    const db: any = this.db;
    return db.select().from(notes).orderBy(notes.id);
  }
}

@HttpPost()
export class AddNote extends Endpoint {
  async main() {
    const db: any = this.db;
    await db.transaction(async (tx: any) => {
      await tx.insert(notes).values({ text: this.request.body.text });
    });
    this.httpStatus = 201;
    return db.select().from(notes).orderBy(notes.id);
  }
}

@HttpPost('broken')
export class BrokenNote extends Endpoint {
  async main() {
    const db: any = this.db;
    await db.transaction(async (tx: any) => {
      await tx.insert(notes).values({ text: 'never kept' });
      throw new Error('rolled back');
    });
    return null;
  }
}
`;

/** Copies the engine's table, writes the endpoints, returns the module dir. */
function scaffold(dialect: DialectName): string {
  const dir = path.join(workspace, dialect, 'notes');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'endpoints'), { recursive: true });
  fs.copyFileSync(
    path.join(fixtures, dialect, 'tables', 'note.table.ts'),
    path.join(dir, 'tables', 'note.table.ts'),
  );
  fs.writeFileSync(path.join(dir, 'endpoints', 'notes.endpoint.ts'), endpoints);
  return dir;
}

const notesModule = (dir: string): ResolvedModule =>
  defineModule({ id: 'notes', dir }) as ResolvedModule;

const mysqlUrl = process.env.SAMBLE_TEST_MYSQL_URL;
const engines: DialectName[] = ['postgres', 'sqlite', 'mysql'];

for (const dialect of engines) {
  const skip = dialect === 'mysql' && !mysqlUrl;
  const suite = skip ? describe.skip : describe;

  suite(`on ${dialect}`, () => {
    let db: Database;
    let app: Samble;
    let migration: string;

    beforeAll(async () => {
      const dir = scaffold(dialect);

      // 1. The migration, generated from the tables, the way
      //    `samble migration:generate` does it.
      const draft = await Samble.create({
        db: await openTestDatabase({ dialect }),
        modules: [notesModule(dir)],
        auth: anyone,
        logs: { dir: null },
      });
      const plan = generateMigration({
        target: 'notes/create-notes',
        diff: await draft.pendingSchema('notes'),
        snapshot: await draft.snapshotOf('notes'),
        modulesDir: path.join(workspace, dialect),
        method: draft.dialect.statementMethod,
        now: 1000,
      });
      await closeTestDatabase(draft.db);
      apply(plan, { root: '/', force: true });
      migration = fs.readFileSync(
        path.join(dir, 'migrations', '1000-create-notes.ts'),
        'utf8',
      );

      // 2. The application, which migrates and serves.
      db = await openTestDatabase({ dialect });
      app = await Samble.create({
        db,
        modules: [notesModule(dir)],
        auth: anyone,
        logs: { dir: null },
      });
      await app.start(0);
    });

    afterAll(async () => {
      await app?.close();
      if (db) await closeTestDatabase(db);
    });

    it('reads its dialect off the connection', () => {
      expect(app.dialect.name).toBe(dialect);
    });

    it('writes the migration with the method the engine has', () => {
      expect(migration).toContain(
        dialect === 'sqlite' ? 'await db.run(' : 'await db.execute(',
      );
      expect(migration.toLowerCase()).toContain('create table');
    });

    it('created its own bookkeeping and the module table', async () => {
      expect(await tableExists(db, '_modules')).toBe(true);
      expect(await tableExists(db, '_module_migrations')).toBe(true);
      expect(await tableExists(db, 'notes')).toBe(true);
      expect(await tableExists(db, 'nothing_here')).toBe(false);
    });

    it('records what ran, so a second boot runs nothing', async () => {
      expect(await app.migrationStatus()).toEqual([
        {
          module: 'notes',
          migrations: [{ name: 'CreateNotes1000', applied: true }],
        },
      ]);
      expect(await app.migrate()).toEqual([]);
    });

    it('serves reads and writes through Drizzle', async () => {
      const added = await request(app.getApp())
        .post('/api/notes')
        .send({ text: 'hola' });
      expect(added.status).toBe(201);
      expect(added.body).toEqual([{ id: 1, text: 'hola' }]);
    });

    it('rolls a failed transaction back', async () => {
      const broken = await request(app.getApp()).post('/api/notes/broken');
      expect(broken.status).toBe(500);

      const list = await request(app.getApp()).get('/api/notes');
      expect(list.body).toEqual([{ id: 1, text: 'hola' }]);
    });

    if (dialect === 'postgres') {
      // Limited to the modules' tables: `_modules` and `_module_migrations`
      // live in the same database and are not drift.
      it('leaves the live schema matching the code', async () => {
        expect(await app.schemaDrift()).toEqual([]);
      });
    } else {
      it('refuses to compare the live schema, instead of answering wrong', async () => {
        await expect(app.schemaDrift()).rejects.toThrow(
          `Comparing the live schema is not available on ${dialect} yet`,
        );
      });
    }
  });
}

describe('a module written for another engine', () => {
  it('is refused at boot, by name', async () => {
    const db = await openTestDatabase({ dialect: 'sqlite' });
    const pgOnly = {
      id: 'legacy',
      tables: [pgTable('legacy_rows', { id: serial('id').primaryKey() })],
    } as unknown as ResolvedModule;

    try {
      await expect(
        Samble.create({ db, modules: [pgOnly], auth: anyone }),
      ).rejects.toThrow(
        'Module "legacy" declares tables for postgres, and this application runs on sqlite.',
      );
    } finally {
      await closeTestDatabase(db);
    }
  });
});

if (!mysqlUrl) {
  // Said out loud: a skipped engine is not a passing one.
  console.warn(
    'dialects.spec: MySQL skipped — set SAMBLE_TEST_MYSQL_URL (mysql://root@localhost:3306) to run it.',
  );
}

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});
