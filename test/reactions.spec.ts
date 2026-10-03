import 'reflect-metadata';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import {
  Container,
  ContractError,
  Database,
  defineModule,
  Samble,
  Reaction,
  Strategy,
  token,
} from '../lib';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { visto } from './fixtures/events/shared';
import { cualquiera } from './helpers/auth';

/**
 * `notify()` es la otra forma de leer una ranura: el anfitrión llama a todos los
 * aportes y descarta las respuestas. Lo que compra, y lo único que el bus de
 * eventos agregaba sobre una ranura, es de quién es la falla.
 */

const fakeDb = {} as Database;

describe('notify (sin servidor)', () => {
  interface Hecho {
    n: number;
  }
  const Hecho = token<Reaction<Hecho>>('demo.hecho', 'slot');

  it('una ranura que nadie llenó no es un error: anunciar no hace nada', async () => {
    const container = new Container(fakeDb);

    await expect(container.notify(Hecho, { n: 1 })).resolves.toBeUndefined();
    expect(container.countFor(Hecho)).toBe(0);
  });

  it('entrega la carga a cada reacción', async () => {
    const recibido: number[] = [];

    class Uno extends Strategy implements Reaction<Hecho> {
      on(p: Hecho) {
        recibido.push(p.n * 10);
      }
    }
    class Dos extends Strategy implements Reaction<Hecho> {
      async on(p: Hecho) {
        recibido.push(p.n * 100);
      }
    }

    const container = new Container(fakeDb);
    container.contribute('a', Hecho, Uno);
    container.contribute('b', Hecho, Dos);

    await container.notify(Hecho, { n: 3 });

    expect(recibido.sort((x, y) => x - y)).toEqual([30, 300]);
  });

  it('una reacción que falla NO rompe a quien anunció ni a las demás', async () => {
    // La invariante que justifica que `notify` exista y no sea un `all().map()`:
    // "esto pasó", no "hacé esto por mí". Si al que anuncia le importa el
    // resultado, quiere un contrato.
    const recibido: number[] = [];

    class Roto extends Strategy implements Reaction<Hecho> {
      on() {
        throw new Error('revienta');
      }
    }
    class Sano extends Strategy implements Reaction<Hecho> {
      on(p: Hecho) {
        recibido.push(p.n);
      }
    }

    const container = new Container(fakeDb);
    container.contribute('roto', Hecho, Roto);
    container.contribute('sano', Hecho, Sano);

    // `Roto.on()` tira SINCRÓNICAMENTE, que es el caso que se escapa: sin
    // envolver cada reacción en una async, el throw sale del `.map()` antes de
    // que `allSettled` lo vea y voltea a quien anunció.
    await expect(container.notify(Hecho, { n: 5 })).resolves.toBeUndefined();
    expect(recibido).toEqual([5]);
  });

  it('le inyecta db a la reacción, como a cualquier Strategy', async () => {
    let vistoDb: unknown = null;

    class MiraDb extends Strategy implements Reaction<Hecho> {
      on() {
        vistoDb = this.db;
      }
    }

    const container = new Container(fakeDb);
    container.contribute('a', Hecho, MiraDb);
    await container.notify(Hecho, { n: 1 });

    expect(vistoDb).toBe(fakeDb);
  });

  it('un salto y no más: una reacción no puede anunciar otra cosa', async () => {
    // Sin esto vuelve A → B → C y "por qué se mandó este correo" deja de tener
    // respuesta.
    const Otro = token<Reaction<Hecho>>('demo.otro', 'slot');
    const corrio = { cascada: 0, final: 0, suelto: 0 };
    let rechazo: unknown = null;

    class Cascada extends Strategy implements Reaction<Hecho> {
      async on(p: Hecho) {
        corrio.cascada += 1;
        // El error se captura acá para poder mirarlo: lo que importa afuera es
        // que el anuncio de arriba responde igual.
        await (this.container as Container).notify(Otro, p).catch((error) => {
          rechazo = error;
        });
      }
    }
    class Final extends Strategy implements Reaction<Hecho> {
      on() {
        corrio.final += 1;
      }
    }

    const container = new Container(fakeDb);
    container.contribute('a', Hecho, Cascada);
    container.contribute('b', Otro, Final);

    await expect(container.notify(Hecho, { n: 1 })).resolves.toBeUndefined();

    // La reacción corrió, su anuncio fue rechazado por nombre, y la segunda
    // ranura NO se leyó: eso es la cascada cortada.
    expect(corrio.cascada).toBe(1);
    expect(corrio.final).toBe(0);
    expect(rechazo).toBeInstanceOf(ContractError);
    expect((rechazo as Error).message).toMatch(
      /"demo.otro" is being announced from inside a reaction to "demo.hecho"/,
    );

    // Y fuera de una reacción, el mismo anuncio funciona.
    class Suelto extends Strategy implements Reaction<Hecho> {
      on() {
        corrio.suelto += 1;
      }
    }
    const limpio = new Container(fakeDb);
    limpio.contribute('b', Otro, Suelto);
    await limpio.notify(Otro, { n: 1 });
    expect(corrio.suelto).toBe(1);
  });

  it('dos anuncios en paralelo no se confunden entre sí', async () => {
    // El guardia está scopeado al contexto async de cada llamada. Con un Set
    // compartido, dos peticiones simultáneas se habrían rechazado entre ellas.
    const corridas: number[] = [];

    class Lenta extends Strategy implements Reaction<Hecho> {
      async on(p: Hecho) {
        await new Promise((listo) => setTimeout(listo, 20));
        corridas.push(p.n);
      }
    }

    const container = new Container(fakeDb);
    container.contribute('a', Hecho, Lenta);

    await Promise.all([
      container.notify(Hecho, { n: 1 }),
      container.notify(Hecho, { n: 2 }),
    ]);

    expect(corridas.sort()).toEqual([1, 2]);
  });

  it('el error de cascada es un ContractError con el id de la ranura', () => {
    expect(new ContractError('x', 'demo.otro').contractId).toBe('demo.otro');
  });
});

describe('reacciones entre módulos', () => {
  let db: Database;
  let app: Samble | undefined;

  const emisor = () =>
    defineModule({
      id: 'emisor',
      dir: path.join(__dirname, 'fixtures/events/emisor'),
      routes: './*.api.ts',
    });

  const oyente = () =>
    defineModule({
      id: 'oyente',
      dir: path.join(__dirname, 'fixtures/events/oyente'),
    });

  const boot = async () => {
    app = await Samble.create({
      auth: cualquiera,
      db,
      modules: [emisor(), oyente()],
      version: '2.0.0-dev.0',
    });
    await app.start(0);
    return app.getApp();
  };

  beforeEach(async () => {
    db = await createTestDb();
    visto.ids = [];
  });

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    app = undefined;
    await closeTestDb();
  });

  it('reacciona sin que quien anuncia la nombre', async () => {
    const server = await boot();

    const res = await request(server).post('/api/demo/crear');

    expect(res.status).toBe(200);
    expect(visto.ids).toEqual([7]);
  });
});
