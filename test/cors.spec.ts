import 'reflect-metadata';
import { afterEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { CorsConfig, CorsConfigError, Database, Samble } from '../lib';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';

/**
 * CORS: el mecanismo lo pone samble, la política la pone la aplicación — el
 * mismo corte que `auth`.
 *
 * Está adentro porque TODO backend con un frontend lo necesita, y lo que más
 * se rompe no es el middleware sino la combinación imposible: `*` con
 * credenciales. Un navegador la rechaza, así que samble la rechaza al arrancar.
 */
describe('CORS', () => {
  let db: Database;
  let app: Samble;

  const build = async (cors: CorsConfig) => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [],
      version: '2.0.0',
      cors,
    });
    await app.start(0);
    return app.getApp();
  };

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('un origen de la lista recibe la cabecera', async () => {
    const server = await build({
      origin: ['https://app.example.com'],
      credentials: true,
    });

    const res = await request(server)
      .get('/api/nada')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('uno que no está NO recibe la cabecera, y la petición no falla', async () => {
    // Lo que manda el estándar: la cabecera se omite y el NAVEGADOR bloquea.
    // Fallar acá rompería a cualquier llamador que no sea un navegador.
    const server = await build({ origin: ['https://app.example.com'] });

    const res = await request(server)
      .get('/api/nada')
      .set('Origin', 'https://otro.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).toBe(404); // llegó hasta el 404 normal
  });

  it('sin cabecera Origin pasa: curl y servidor a servidor no son CORS', async () => {
    const server = await build({ origin: ['https://app.example.com'] });

    const res = await request(server).get('/api/nada');

    expect(res.status).toBe(404);
  });

  it('responde el preflight sin llegar a una ruta', async () => {
    const server = await build({
      origin: ['https://app.example.com'],
      credentials: true,
    });

    const res = await request(server)
      .options('/api/nada')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('las cabeceras están también cuando la respuesta es un error', async () => {
    // Sin esto el navegador esconde el motivo y sólo dice "CORS", que es el
    // peor mensaje posible para depurar un 500.
    const server = await build({ origin: ['https://app.example.com'] });

    const res = await request(server)
      .get('/api/no-existe')
      .set('Origin', 'https://app.example.com');

    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
  });

  it('cualquier origen sirve mientras no haya credenciales', async () => {
    const server = await build({ origin: true });

    const res = await request(server)
      .get('/api/nada')
      .set('Origin', 'https://cualquiera.com');

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('pero `*` con credenciales no arranca: el navegador lo rechazaría', async () => {
    db = await createTestDb();

    await expect(
      Samble.create({
        auth: cualquiera,
        db,
        modules: [],
        version: '2.0.0',
        cors: { origin: true, credentials: true },
      }),
    ).rejects.toThrow(CorsConfigError);
  });

  it("'*' escrito a mano cuenta como cualquier origen", async () => {
    db = await createTestDb();

    await expect(
      Samble.create({
        auth: cualquiera,
        db,
        modules: [],
        version: '2.0.0',
        cors: { origin: '*', credentials: true },
      }),
    ).rejects.toThrow(/cannot be combined/);
  });

  it('sin la opción no se manda ninguna cabecera', async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [],
      version: '2.0.0',
    });
    await app.start(0);

    const res = await request(app.getApp())
      .get('/api/nada')
      .set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
