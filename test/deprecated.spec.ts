import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import Samble from '../lib/core/samble';
import { Logger } from '../lib';
import { defineModule } from '../lib/modules/define-module';
import { Deprecated } from '../lib/decorators/deprecated.decorator';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';

const legado = () =>
  defineModule({
    id: 'legado',
    dir: path.join(__dirname, 'fixtures/modules/legado'),
  });

describe('@Deprecated', () => {
  let app: Samble;
  const server = () => app.getApp();

  beforeAll(async () => {
    const db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      basePath: '/api',
      modules: [legado()],
      docs: { path: '/docs' },
    });
    await app.start(0);
  });

  afterAll(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
  });

  describe('la ruta sigue contestando', () => {
    it('marcarla no la apaga: ese es el punto', async () => {
      const res = await request(server()).get('/api/v1/productos/7');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ forma: 'vieja', id: '7' });
    });

    it('y la sucesora contesta al lado, en la misma app', async () => {
      // Las dos versiones vivas al mismo tiempo es lo que le da plazo a quien
      // no puede actualizar hoy — una app en una tienda, por ejemplo.
      const res = await request(server()).get('/api/v2/productos/7');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ forma: 'nueva' });
    });
  });

  describe('lo que recibe quien llama', () => {
    it('manda Deprecation, Sunset y el sucesor', async () => {
      const res = await request(server()).get('/api/v1/productos/7');

      expect(res.headers.deprecation).toBe('true');
      // RFC 8594: un HTTP-date, no la fecha como la escribiste.
      expect(res.headers.sunset).toBe('Sun, 31 Jan 2027 00:00:00 GMT');
      expect(res.headers.link).toBe(
        '</api/v2/productos/:id>; rel="successor-version"',
      );
    });

    it('sin fecha ni sucesor, manda Deprecation y nada más', async () => {
      const res = await request(server()).get('/api/v1/pelado');

      expect(res.status).toBe(200);
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.sunset).toBeUndefined();
      expect(res.headers.link).toBeUndefined();
    });

    it('una ruta que no está marcada no manda nada', async () => {
      const res = await request(server()).get('/api/v2/productos/7');

      expect(res.headers.deprecation).toBeUndefined();
      expect(res.headers.sunset).toBeUndefined();
    });

    it('también cuando el DTO frena la petición antes de main()', async () => {
      // El 422 sale del validador, que corre ANTES de main. Si los encabezados
      // se pusieran ahí, una llamada mal formada no se enteraría de que la
      // ruta se está yendo — y es justo la que más lo necesita.
      const res = await request(server()).get('/api/v1/productos/abc');

      expect(res.status).toBe(422);
      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.sunset).toBe('Sun, 31 Jan 2027 00:00:00 GMT');
    });
  });

  describe('lo que dice el spec', () => {
    it('marca la operación como deprecated', async () => {
      const res = await request(server()).get('/docs.json');

      expect(res.body.paths['/api/v1/productos/{id}'].get.deprecated).toBe(
        true,
      );
    });

    it('la descripción abre con la fecha y el sucesor', async () => {
      const res = await request(server()).get('/docs.json');
      const { description } = res.body.paths['/api/v1/productos/{id}'].get;

      expect(description).toContain('**Deprecated.**');
      expect(description).toContain('2027-01-31');
      expect(description).toContain('/api/v2/productos/:id');
      // La nota viaja también, después de lo que cambia qué hacés.
      expect(description).toContain('lo anida en `importe`');
    });

    it('NO la esconde: @ApiHidden la sacaría del spec', async () => {
      // Esconder la versión vieja le quita al cliente el único lugar donde
      // podía leer a cuál moverse.
      const res = await request(server()).get('/docs.json');

      expect(res.body.paths['/api/v1/productos/{id}']).toBeDefined();
    });

    it('una ruta sin marcar no queda con deprecated', async () => {
      const res = await request(server()).get('/docs.json');

      expect(
        res.body.paths['/api/v2/productos/{id}'].get.deprecated,
      ).toBeUndefined();
    });
  });

  describe('la fecha se valida al importar', () => {
    it('una fecha que no parsea falla ahí, no en una cabecera ilegible', () => {
      expect(() => Deprecated({ sunset: 'el 31 de enero' })).toThrow(
        /is not a date/,
      );
    });

    it('la forma mínima no exige nada', () => {
      expect(() => Deprecated()).not.toThrow();
    });
  });
});

/**
 * El aviso va a `warn.log`, así que hace falta un logger encendido — la suite
 * lo silencia (`test/setup.ts`) — y una aplicación nueva, porque el contador de
 * "ya avisé" vive en el manejador de cada ruta.
 */
describe('@Deprecated — el aviso en el log', () => {
  let app: Samble | undefined;
  let dir: string;

  afterAll(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
    Logger.configure({ level: 'off' });
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('avisa UNA vez por ruta, no una por petición', async () => {
    // La pregunta que un deprecado tiene que contestar es «¿alguien todavía la
    // llama?», y una línea la contesta. Una por petición la contestaría para
    // siempre y taparía todo lo demás: cuántas veces y desde dónde es trabajo
    // del log de accesos, que ya registra cada una.
    dir = path.join(os.tmpdir(), `samble-deprecated-${Date.now()}`);
    const db = await createTestDb();
    app = await Samble.create({
      auth: cualquiera,
      db,
      basePath: '/api',
      modules: [legado()],
      logs: { dir, level: 'trace' },
    });
    await app.start(0);

    await request(app.getApp()).get('/api/v1/solo-log');
    await request(app.getApp()).get('/api/v1/solo-log');
    await request(app.getApp()).get('/api/v1/solo-log');

    // `flush` CIERRA los appenders: va después de lo último que se escribe.
    await Logger.flush();

    const avisos = fs
      .readFileSync(path.join(dir, 'warn.log'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('/api/v1/solo-log'));

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Deprecated route called');
    expect(avisos[0]).toContain('2027-06-30');
  });
});
