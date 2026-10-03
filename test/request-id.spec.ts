import 'reflect-metadata';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { currentRequestId, Database, defineModule, Samble } from '../lib';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';

/**
 * Un id por petición, en la cabecera, en el cuerpo del error y en cada línea
 * de log escrita mientras se atendía.
 *
 * Sin él, "un usuario dice que falló" y el log son dos cosas separadas: hay
 * una hora aproximada, un endpoint más o menos y un pajar. Con él, el cliente
 * tiene en la mano exactamente la cadena con la que se escribió todo.
 */
describe('x-request-id', () => {
  let db: Database;
  let app: Samble;

  const site = defineModule({
    id: 'site',
    dir: path.join(__dirname, 'fixtures/modules/site'),
  });

  beforeAll(async () => {
    db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [site],
      version: '2.0.0',
      basePath: '/api',
    });
    await app.start(0);
  });

  afterAll(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  const server = () => app.getApp();

  it('genera uno y lo devuelve en la cabecera', async () => {
    const res = await request(server()).get('/api/tienda/items');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{12}$/);
  });

  it('cada petición trae el suyo', async () => {
    const a = await request(server()).get('/api/tienda/items');
    const b = await request(server()).get('/api/tienda/items');

    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('respeta el que ya viene: un id atraviesa toda la cadena de saltos', async () => {
    // Si una pasarela o un CDN ya puso uno, reiniciarlo acá parte la traza en
    // dos justo donde hace falta seguirla.
    const res = await request(server())
      .get('/api/tienda/items')
      .set('x-request-id', 'gateway-abc123');

    expect(res.headers['x-request-id']).toBe('gateway-abc123');
  });

  it('descarta uno que no sirve: una cabecera es entrada del cliente', async () => {
    // Aceptado tal cual va a parar a cada línea de log, que es como un salto
    // de línea en una cabecera se convierte en una entrada de log falsificada.
    // Se reemplaza en vez de limpiarse: un id a medio limpiar ya no es el que
    // tiene el llamador, así que no correlacionaría nada.
    const res = await request(server())
      .get('/api/tienda/items')
      .set('x-request-id', 'con espacios y símbolos ñ');

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{12}$/);
  });

  it('el cuerpo del error trae el mismo id que la cabecera', async () => {
    const res = await request(server()).get('/api/no-existe');

    expect(res.status).toBe(404);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('también viaja en una respuesta que no llega a ninguna ruta', async () => {
    const res = await request(server()).get('/nada/de/nada');

    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('la cabecera se puede cambiar por la que ya usa tu pasarela', async () => {
    // Reusa el MISMO DataSource: `createTestDb()` cierra el anterior, que es
    // el que está sirviendo a esta suite.
    const suya = await Samble.create({
      auth: cualquiera,
      db,
      modules: [],
      version: '2.0.0',
      requestId: { header: 'x-correlation-id' },
    });
    await suya.start(0);

    const res = await request(suya.getApp())
      .get('/nada')
      .set('x-correlation-id', 'desde-el-borde');

    expect(res.headers['x-correlation-id']).toBe('desde-el-borde');
    await suya.close({ database: false });
  });

  it('sobrevive a los await: es lo que lo hace servir para algo', async () => {
    // El id viaja en AsyncLocalStorage, no pasado como parámetro. Las líneas
    // que interesa correlacionar son las que se escriben adentro —un
    // proveedor, un oyente, un repositorio— y ninguna recibió nada.
    const suya = await Samble.create({
      auth: cualquiera,
      db,
      modules: [],
      version: '2.0.0',
    });

    let visto: string | null = 'no corrió';
    suya.use(async (_req, res, next) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await Promise.resolve();
      visto = currentRequestId();
      next();
    });
    await suya.start(0);

    const res = await request(suya.getApp()).get('/nada');

    expect(visto).toBe(res.headers['x-request-id']);
    await suya.close({ database: false });
  });

  it('fuera de una petición no hay id, y eso no es un error', () => {
    // Una rutina, un script, el arranque: no hay a qué correlacionar.
    expect(currentRequestId()).toBeNull();
  });
});
