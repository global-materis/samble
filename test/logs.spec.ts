import 'reflect-metadata';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from '@jest/globals';
import { Database, defineModule, Samble, Logger } from '../lib';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';

/**
 * Los archivos existen desde el primer arranque, vacíos.
 *
 * Un `error.log` vacío dice "no pasó nada"; uno que no existe no dice nada y
 * manda a buscar por qué nunca se creó. Y `router.log` —el mapa de qué
 * contesta dónde, en orden de registro— es la respuesta más rápida a "por qué
 * mi ruta da 404": una carpeta mal nombrada o un grupo repetido se ven de un
 * vistazo ahí y de ninguna otra manera.
 */
describe('archivos de log', () => {
  let db: Database;
  let app: Samble | undefined;
  let dir: string;

  const site = defineModule({
    id: 'site',
    dir: path.join(__dirname, 'fixtures/modules/site'),
  });

  const raiz = process.cwd();

  const temporal = (sufijo = '') =>
    path.join(os.tmpdir(), `samble-logs-${Date.now()}${sufijo}`);

  /**
   * Una sola base para todo el archivo. Levantar PGlite cuesta segundos;
   * crearla por caso fue exactamente lo que una vez hizo que la suite entera
   * empezara a dar timeouts.
   */
  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(closeTestDb);

  const levantar = async (
    logs?: Parameters<typeof Samble.create>[0]['logs'],
  ) => {
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [site],
      version: '2.0.0',
      basePath: '/api',
      ...(logs === undefined ? {} : { logs }),
    });
    await app.start(0);
    return app;
  };

  /**
   * El appender escribe asíncrono: sin esperar el vaciado, el archivo se lee
   * vacío. Es la misma razón por la que `shutdown()` lo espera antes de salir
   * del proceso. Y como `flush` CIERRA los appenders, va una sola vez, al
   * final de cada caso y después de lo último que se escriba.
   */
  const vaciar = () => Logger.flush();

  afterEach(async () => {
    // Si un caso se queda sin tiempo, jest lo abandona y su `finally` puede no
    // correr: sin esto el directorio de trabajo quedaría en un temporal para
    // todo lo que sigue.
    if (process.cwd() !== raiz) process.chdir(raiz);
    await app?.close({ database: false }).catch(() => undefined);
    app = undefined;
    // Volver a consola, o el resto de la suite escribiría en el temporal.
    Logger.configure({ level: 'off' });
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('crea los cinco archivos, y sólo el mapa trae algo', async () => {
    dir = temporal();
    expect(fs.existsSync(dir)).toBe(false);

    // La suite silencia el logger (test/setup.ts); acá hay que volver a
    // encenderlo, que es justamente lo que se está probando.
    await levantar({ dir, level: 'trace' });
    await vaciar();

    expect(fs.readdirSync(dir).sort()).toEqual([
      'app.log',
      'error.log',
      'info.log',
      'router.log',
      'warn.log',
    ]);
    expect(fs.readFileSync(path.join(dir, 'router.log'), 'utf8')).not.toBe('');
    // Nada salió mal todavía, y eso es exactamente lo que el archivo dice.
    expect(fs.readFileSync(path.join(dir, 'error.log'), 'utf8')).toBe('');
    expect(fs.readFileSync(path.join(dir, 'warn.log'), 'utf8')).toBe('');
  });

  it('el mapa lleva verbo, ruta completa y la clase que responde', async () => {
    dir = temporal();

    await levantar({ dir, level: 'trace' });
    await vaciar();

    const mapa = fs.readFileSync(path.join(dir, 'router.log'), 'utf8');
    expect(mapa).toContain('registration order; the first match answers');
    // Lo que hace falta para entender un 404 sin adivinar.
    expect(mapa).toMatch(/GET\s+\/api\/tienda\/items\s+\(ItemsEndpoint\)/);
  });

  it('app.log es el neutral: lleva todo menos el mapa', async () => {
    dir = temporal();

    await levantar({ dir, level: 'trace' });
    await vaciar();

    const neutral = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
    const info = fs.readFileSync(path.join(dir, 'info.log'), 'utf8');
    expect(neutral).toContain('Serving on :');
    expect(info).toContain('Serving on :');
    // El mapa es un mapa, no una cronología: cincuenta líneas de arranque
    // delante de lo primero que importa.
    expect(neutral).not.toContain('the first match answers');
  });

  it('sin decir dónde, es `logs/` al lado del proceso, resuelto una vez', async () => {
    // Es el punto de la decisión: quien tiene que descubrir una opción antes
    // de poder leer lo que hizo su aplicación, no la lee nunca. Se prueba
    // parándose en un temporal, no tocando variables de entorno: el nombre
    // por defecto es parte de lo que se está afirmando.
    const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'samble-cwd-'));
    const previo = process.cwd();
    process.chdir(casa);

    try {
      await levantar({ level: 'trace' });

      // Y la ruta queda absoluta desde el arranque: el appender abre el
      // archivo cuando ESCRIBE, no cuando se configura, así que un `logs/`
      // relativo empezaría a escribir en otro lado apenas el proceso cambie
      // de directorio.
      process.chdir(previo);
      Logger.info('después de cambiar de directorio');
      await vaciar();

      expect(fs.readdirSync(path.join(casa, 'logs')).sort()).toEqual([
        'app.log',
        'error.log',
        'info.log',
        'router.log',
        'warn.log',
      ]);
      expect(
        fs.readFileSync(path.join(casa, 'logs', 'app.log'), 'utf8'),
      ).toContain('después de cambiar de directorio');
      // Y no en el directorio de trabajo nuevo. Se mira la línea, no la
      // existencia de la carpeta: la raíz del repo no es propiedad de esta
      // prueba —un `npm run dev` corriendo al lado escribe su propio `logs/`—
      // y afirmar que no existe convierte eso en un fallo intermitente.
      const vecino = path.join(previo, 'logs', 'app.log');
      if (fs.existsSync(vecino)) {
        expect(fs.readFileSync(vecino, 'utf8')).not.toContain(
          'después de cambiar de directorio',
        );
      }
    } finally {
      process.chdir(previo);
      fs.rmSync(casa, { recursive: true, force: true });
    }
  });

  it('se puede renombrar un archivo', async () => {
    dir = temporal('-renombrado');

    await levantar({ dir, level: 'trace', files: { error: 'errores' } });
    await vaciar();

    expect(fs.existsSync(path.join(dir, 'errores.log'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'error.log'))).toBe(false);
  });

  it('apagar un nivel no pierde sus líneas: siguen en el neutral', async () => {
    dir = temporal('-apagado');

    await levantar({ dir, level: 'trace', files: { info: false } });
    Logger.info('algo que igual hay que poder leer');
    await vaciar();

    expect(fs.existsSync(path.join(dir, 'info.log'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'app.log'), 'utf8')).toContain(
      'algo que igual hay que poder leer',
    );
  });

  it('con dir null no toca el disco: es lo que quiere un contenedor', async () => {
    dir = temporal('-off');

    await levantar({ dir: null, level: 'trace' });
    await vaciar();

    expect(fs.existsSync(dir)).toBe(false);
  });

  it('con level off tampoco: no deja una carpeta de archivos vacíos', async () => {
    dir = temporal('-silencio');

    await levantar({ dir, level: 'off' });
    await vaciar();

    expect(fs.existsSync(dir)).toBe(false);
  });
});
