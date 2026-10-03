import 'reflect-metadata';
import { afterEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { Database, Samble, NotFoundError } from '../lib';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';

/**
 * Lo que lanza un MIDDLEWARE sale con el mismo contrato que un endpoint.
 *
 * Sin esto contestaba Express con su página HTML de stack: un cliente que sólo
 * conoce la forma de error de samble recibe algo que no puede leer, y el stack
 * se va con la respuesta. El camino típico para toparse con eso es un origen
 * rechazado por CORS — por eso parecía que a samble le faltaba CORS y en
 * realidad le faltaba esto.
 */
describe('un middleware que lanza', () => {
  let db: Database;
  let app: Samble;

  const build = async (middleware: Parameters<Samble['use']>[0]) => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [],
      version: '2.0.0',
    });
    app.use(middleware);
    await app.start(0);
    return app.getApp();
  };

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  it('un Error pelado es 500 con el contrato, no una página HTML', async () => {
    const server = await build((_req, _res, next) => {
      next(new Error('Not allowed by CORS'));
    });

    const res = await request(server).get('/api/lo-que-sea');

    expect(res.status).toBe(500);
    expect(res.type).toBe('application/problem+json');
    expect(res.body).toEqual({
      type: '/problems/internal',
      title: 'Internal server error',
      status: 500,
      // NO 'Not allowed by CORS': el mensaje de un Error inesperado no sale.
      // Acá viene de `cors`, y el de al lado viene de un driver con la
      // consulta y sus parámetros adentro.
      detail: 'Internal server error.',
      code: 'internal',
      errors: {},
      // El mismo id que se fue en la cabecera y con el que se escribió cada
      // línea de log de esta petición.
      requestId: res.headers['x-request-id'],
    });
    // Lo que se filtraba antes.
    expect(res.text).not.toContain('at ');
  });

  it('un error del framework conserva su estado', async () => {
    const server = await build((_req, _res, next) => {
      next(new NotFoundError('No existe'));
    });

    const res = await request(server).get('/api/lo-que-sea');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('lanzar sincrónicamente cuenta igual', async () => {
    const server = await build(() => {
      throw new Error('explotó');
    });

    const res = await request(server).get('/api/lo-que-sea');

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe('Internal server error.');
    // Y el mensaje real no aparece por ninguna parte del cuerpo.
    expect(res.text).not.toContain('explotó');
  });

  it('si ya salieron bytes, no escribe un JSON en el medio', async () => {
    const server = await build((_req, res, next) => {
      res.write('a medio enviar');
      next(new Error('tarde'));
    });

    // Express corta la conexión en vez de completar la respuesta, y ESO es lo
    // que impide pegar un error JSON detrás de lo que ya viajó. Un archivo a
    // medio descargar termina roto, que es honesto; con un JSON al final
    // terminaría corrupto y parecería completo.
    await expect(request(server).get('/api/lo-que-sea')).rejects.toThrow(
      /aborted/i,
    );
  });

  it('sin error, el 404 sigue siendo el de siempre', async () => {
    const server = await build((_req, _res, next) => next());

    const res = await request(server).get('/api/lo-que-sea');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});
