import 'reflect-metadata';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Cron, Routine, ScheduleError, Scheduler, token } from '../lib';
import type { Database } from '../lib';

/**
 * Una task es un singleton con ciclo de vida: una instancia para toda la vida de
 * la aplicación, construida al primer arranque, y el token es lo único que hace
 * falta para prenderla o apagarla desde afuera.
 */

const fakeDb = {} as Database;

const runners: Scheduler[] = [];
const nuevo = (): Scheduler => {
  const runner = new Scheduler(fakeDb);
  runners.push(runner);
  return runner;
};

afterEach(() => {
  // Un reloj que queda andando se lleva puesto al test siguiente, y jest avisa
  // del handle abierto mucho después, en otro archivo.
  runners.forEach((runner) => runner.stopAll());
  runners.length = 0;
});

describe('el token de un horario', () => {
  it('es un cuarto tipo, y no lleva tipo propio', () => {
    const Nocturna = token('demo.nocturna', 'schedule');

    expect(Nocturna).toEqual({ id: 'demo.nocturna', kind: 'schedule' });
  });

  it('un kind inventado se reporta nombrando los cuatro', () => {
    expect(() => token('demo.x', 'cron' as never)).toThrow(
      /'schedule' \(a clock that can be started and stopped\)/,
    );
  });
});

describe('@Cron valida al importar el archivo, no al arrancar', () => {
  it('pide un token de horario, y rechaza los otros dos por su nombre', () => {
    for (const kind of ['contract', 'slot'] as const) {
      const otro = token<{ x: number }>(`demo.${kind}`, kind as 'contract');

      expect(() => {
        @Cron(otro as never, '0 7 * * *')
        class Mal extends Routine {
          start() {}
        }
        return Mal;
      }).toThrow(new RegExp(`got a ${kind}`));
    }
  });

  it('rechaza una expresión que no es cron, con un ejemplo', () => {
    // Antes esto compilaba y la task simplemente no corría nunca.
    const T = token('demo.mala-expresion', 'schedule');

    expect(() => {
      @Cron(T, 'todas las noches')
      class Mal extends Routine {
        start() {}
      }
      return Mal;
    }).toThrow(/is not a cron expression/);
  });
});

describe('registro', () => {
  it('una Routine sin @Cron se saltea con aviso, no rompe el arranque', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    class Pelada extends Routine {
      start() {}
    }

    const runner = nuevo();
    expect(() => runner.register('demo', Pelada)).not.toThrow();
    expect(runner.ids()).toEqual([]);

    warn.mockRestore();
  });

  it('dos clases en el mismo token no se componen: un horario es un reloj', () => {
    const T = token('demo.una-sola', 'schedule');

    @Cron(T, '0 7 * * *')
    class Una extends Routine {
      start() {}
    }
    @Cron(T, '0 8 * * *')
    class Otra extends Routine {
      start() {}
    }

    const runner = nuevo();
    runner.register('a', Una);

    expect(() => runner.register('b', Otra)).toThrow(ScheduleError);
    // El error nombra a las dos clases y a los dos módulos.
    expect(() => runner.register('b', Otra)).toThrow(
      /Una \(module "a"\) and by Otra \(module "b"\)/,
    );
  });

  it('un token que nadie registró lista los que sí', () => {
    const Existe = token('demo.existe', 'schedule');
    const Noexiste = token('demo.noexiste', 'schedule');

    @Cron(Existe, '0 7 * * *')
    class Hay extends Routine {
      start() {}
    }

    const runner = nuevo();
    runner.register('demo', Hay);

    expect(() => runner.handle(Noexiste)).toThrow(/Registered: demo\.existe/);
  });
});

describe('arrancar y parar', () => {
  const Auto = token('demo.auto', 'schedule');
  const Manual = token('demo.manual', 'schedule');

  @Cron(Auto, '0 7 * * *')
  class AutoRoutine extends Routine {
    start() {}
  }

  @Cron(Manual, '0 7 * * *', { autostart: false })
  class ManualRoutine extends Routine {
    start() {}
  }

  const conLasDos = (): Scheduler => {
    const runner = nuevo();
    runner.register('demo', AutoRoutine);
    runner.register('demo', ManualRoutine);
    return runner;
  };

  it('startAll respeta autostart: false', () => {
    const runner = conLasDos();
    runner.startAll();

    expect(runner.handle(Auto).isScheduled()).toBe(true);
    // Registrada y direccionable, pero quieta.
    expect(runner.handle(Manual).isScheduled()).toBe(false);
    expect(runner.ids()).toEqual(['demo.auto', 'demo.manual']);
    expect(runner.scheduledCount()).toBe(1);
  });

  it('arrancar dos veces no hace nada la segunda, y lo dice', () => {
    const runner = conLasDos();
    const manual = runner.handle(Manual);

    expect(manual.start()).toBe(true);
    expect(manual.start()).toBe(false);
    expect(manual.isScheduled()).toBe(true);
    expect(runner.scheduledCount()).toBe(1);
  });

  it('parar lo que no corre devuelve false', () => {
    const runner = conLasDos();

    expect(runner.handle(Manual).stop()).toBe(false);
  });

  it('parar y volver a arrancar reusa LA MISMA instancia', () => {
    // Es lo que hace que `stop()` signifique algo: el reloj se detiene y lo que
    // la task tenga en la mano queda como estaba.
    let construidas = 0;
    const T = token('demo.contada', 'schedule');

    @Cron(T, '0 7 * * *')
    class Contada extends Routine {
      public readonly n: number;
      constructor() {
        super();
        construidas += 1;
        this.n = construidas;
      }
      start() {}
    }

    const runner = nuevo();
    runner.register('demo', Contada);
    const task = runner.handle(T);

    task.start();
    task.stop();
    task.start();

    expect(construidas).toBe(1);
  });

  it('no construye nada hasta que arranca: un horario parado no cuesta', () => {
    let construidas = 0;
    const T = token('demo.perezosa', 'schedule');

    @Cron(T, '0 7 * * *', { autostart: false })
    class Perezosa extends Routine {
      constructor() {
        super();
        construidas += 1;
      }
      start() {}
    }

    const runner = nuevo();
    runner.register('demo', Perezosa);
    runner.startAll();

    expect(construidas).toBe(0);

    runner.handle(T).start();
    expect(construidas).toBe(1);
  });

  it('stopAll deja todo quieto, que es el apagado ordenado', () => {
    const runner = conLasDos();
    runner.startAll();
    runner.handle(Manual).start();
    expect(runner.scheduledCount()).toBe(2);

    runner.stopAll();

    expect(runner.scheduledCount()).toBe(0);
  });
});

describe('lo que la Routine recibe', () => {
  it('db y el runner llegan antes de construir, como a un proveedor', () => {
    const T = token('demo.inyectada', 'schedule');

    @Cron(T, '0 7 * * *', { autostart: false })
    class Inyectada extends Routine {
      public readonly vioDb = !!this.db;
      public readonly vioRunner = !!this.scheduler;
      start() {}
    }

    const runner = nuevo();
    runner.register('demo', Inyectada);
    runner.handle(T).start();

    const instancia = runner.instanceOf(T) as Inyectada;
    expect(instancia.vioDb).toBe(true);
    // Y el runner tambien: `this.schedule(T).stop()` adentro de start() es el caso
    // de "corre una vez y no vuelvas".
    expect(instancia.vioRunner).toBe(true);
  });
});

describe('ejecuciones secuenciales: nunca dos a la vez', () => {
  /**
   * El caso que importa: facturación, cortes, generación de deudas. node-cron
   * NO espera — su reloj dispara de nuevo haya terminado o no la corrida
   * anterior. Dos corridas superpuestas de un job que mueve dinero no es una
   * caída, es plata duplicada.
   */
  const demorada = (ms: number) => {
    const T = token(`demo.lenta-${ms}`, 'schedule');
    const corridas = { entradas: 0, salidas: 0 };

    @Cron(T, '* * * * * *', { autostart: false })
    class Lenta extends Routine {
      async start() {
        corridas.entradas += 1;
        await new Promise((listo) => setTimeout(listo, ms));
        corridas.salidas += 1;
      }
    }

    const runner = nuevo();
    runner.register('demo', Lenta);
    return { runner, task: runner.handle(T), corridas, T };
  };

  it('un segundo disparo durante una corrida se descarta, y lo dice', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { runner, task, corridas, T } = demorada(60);

    const primera = task.runNow();
    // Mientras la primera está en vuelo.
    expect(task.isExecuting()).toBe(true);
    await expect(task.runNow()).resolves.toBe(false);

    await expect(primera).resolves.toBe(true);

    // Entró una sola vez, y el salto quedó contado.
    expect(corridas.entradas).toBe(1);
    expect(corridas.salidas).toBe(1);
    expect(runner.skippedCount(T)).toBe(1);

    warn.mockRestore();
  });

  it('una tras otra sí corren: el guardia es por superposición, no un candado', async () => {
    const { task, corridas } = demorada(5);

    await task.runNow();
    await task.runNow();
    await task.runNow();

    expect(corridas.entradas).toBe(3);
    expect(corridas.salidas).toBe(3);
  });

  it('una corrida que revienta NO deja el horario trabado para siempre', async () => {
    // Si la bandera se filtrara en el error, el horario quedaría "ejecutando" y no
    // volvería a correr nunca, en silencio. Es el peor final posible.
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const T = token('demo.revienta', 'schedule');
    let veces = 0;

    @Cron(T, '* * * * * *', { autostart: false })
    class Revienta extends Routine {
      async start() {
        veces += 1;
        throw new Error('la noche salió mal');
      }
    }

    const runner = nuevo();
    runner.register('demo', Revienta);
    const task = runner.handle(T);

    await expect(task.runNow()).resolves.toBe(true);
    expect(task.isExecuting()).toBe(false);

    // Y la siguiente corre igual, que es la regla: una mala noche no apaga un
    // trabajo nocturno para siempre.
    await task.runNow();
    expect(veces).toBe(2);

    error.mockRestore();
  });

  it('se puede correr a mano un horario que nadie arrancó', async () => {
    const { task, corridas } = demorada(1);

    expect(task.isScheduled()).toBe(false);
    await expect(task.runNow()).resolves.toBe(true);

    expect(corridas.salidas).toBe(1);
    // Y correrla a mano no prende el reloj.
    expect(task.isScheduled()).toBe(false);
  });

  it('parar el reloj no corta una corrida en vuelo', async () => {
    const { task, corridas } = demorada(40);
    task.start();

    const corriendo = task.runNow();
    task.stop();

    expect(task.isScheduled()).toBe(false);
    // Sigue en vuelo: parar decide si VIENE otra, no mata la actual.
    expect(task.isExecuting()).toBe(true);

    await corriendo;
    expect(corridas.salidas).toBe(1);
    expect(task.isExecuting()).toBe(false);
  });
});
