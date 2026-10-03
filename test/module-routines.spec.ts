import path from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it } from '@jest/globals';
import Samble from '../lib/core/samble';
import { defineModule } from '../lib/modules/define-module';
import { beats, heard, Heartbeat } from './fixtures/modules/heartbeat/shared';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';
import type { Database } from '../lib';

const heartbeatDir = path.join(__dirname, 'fixtures/modules/heartbeat');

const heartbeat = () =>
  defineModule({
    id: 'heartbeat',
    dir: heartbeatDir,
    // Sin globs: `routines/` es la disposición estándar.
  });

/** Espera a que se cumpla una condición, sin dormir a ciegas. */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 4000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

describe('rutinas de los módulos', () => {
  let db: Database;
  let app: Samble | undefined;

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    app = undefined;
    await closeTestDb();
    beats.count = 0;
    beats.sawDb = false;
    beats.sawContainer = false;
    heard.count = 0;
  });

  it('arranca la rutina de un módulo, y su horario se alcanza por el token', async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [heartbeat()],
      version: '2.0.0-dev.0',
    });
    await app.start(0);

    expect(await waitFor(() => beats.count > 0)).toBe(true);

    // Y el Scheduler llega a un endpoint. Es el camino que se rompe en
    // silencio: el campo se asigna sobre el prototipo desde `endpoint-handler`,
    // así que un nombre que no coincida compila igual y deja `this.schedule()`
    // inservible adentro de un endpoint.
    const respuesta = await request(app.getApp()).get('/api/latido/estado');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.programado).toBe(true);

    // Desde afuera de todo módulo también, por el token.
    expect(app.schedules()).toEqual(['heartbeat.beat-task']);
    app.schedule(Heartbeat).stop();

    expect(
      (await request(app.getApp()).get('/api/latido/estado')).body.programado,
    ).toBe(false);
  });

  it('su emit LLEGA a los oyentes: el bus también se le inyecta', async () => {
    // Estuvo roto: el bus nunca se le pasaba a la rutina y `emit` se va en
    // silencio cuando no hay uno. Una rutina que anuncia y nadie escucha es
    // exactamente lo que no se nota hasta que importa.
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [heartbeat()],
      version: '2.0.0-dev.0',
    });
    await app.start(0);

    expect(await waitFor(() => heard.count > 0)).toBe(true);
  });

  it('le inyecta db y contenedor, como a un endpoint', async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [heartbeat()],
      version: '2.0.0-dev.0',
    });
    await app.start(0);

    await waitFor(() => beats.count > 0);

    expect(beats.sawDb).toBe(true);
    expect(beats.sawContainer).toBe(true);
  });

  it('cerrar la aplicación detiene la rutina', async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [heartbeat()],
      version: '2.0.0-dev.0',
    });
    await app.start(0);

    await waitFor(() => beats.count > 0);
    await app.close({ database: false });

    const tras = beats.count;
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(beats.count).toBe(tras);
  });
});
