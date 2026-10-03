import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { Container, ContractError } from '../lib/modules/container';
import { Provider } from '../lib/templates/provider';
import { Clock, Greeter } from './fixtures/proveedores/shared';
import { buildContainer } from '../lib/modules/build-container';
import { defineModule } from '../lib/modules/define-module';
import type { Database } from '../lib';

/** El contenedor solo pasa el DataSource al construir: alcanza con un doble. */
const fakeDb = {} as Database;

/**
 * Los tokens salen del módulo de prueba: `demo.clock` y `demo.greeter` viven
 * en `fixtures/proveedores/contracts`, con sus proveedores al lado.
 */
const proveedoresDir = path.join(__dirname, 'fixtures/proveedores');

describe('Container', () => {
  /** Lo mínimo que es un proveedor: una clase que extiende `Provider`. */
  const clockClass = (now: () => string) =>
    class extends Provider implements Clock {
      now = now;
    };

  it('construye la clase y le inyecta db', () => {
    class RealClock extends Provider implements Clock {
      /** Inicializador de campo: `db` tiene que estar ANTES del constructor. */
      private readonly visto = this.db === fakeDb;

      now() {
        return this.visto ? 'con db' : 'sin db';
      }
    }

    const container = new Container(fakeDb);
    container.register('demo', Clock, RealClock);

    expect(container.get(Clock).now()).toBe('con db');
  });

  it('construye una sola vez y reutiliza', () => {
    let veces = 0;
    class Contada extends Provider implements Clock {
      constructor() {
        super();
        veces += 1;
      }
      now() {
        return 'x';
      }
    }

    const container = new Container(fakeDb);
    container.register('demo', Clock, Contada);

    container.get(Clock);
    container.get(Clock);

    expect(veces).toBe(1);
  });

  it('no construye nada hasta que se lo piden', () => {
    let construido = false;
    class Perezosa extends Provider implements Clock {
      constructor() {
        super();
        construido = true;
      }
      now() {
        return 'x';
      }
    }

    const container = new Container(fakeDb);
    container.register('demo', Clock, Perezosa);

    expect(construido).toBe(false);
  });

  it('una implementación puede pedir otro contrato', () => {
    class Saludo extends Provider implements Greeter {
      hello() {
        return `hola, son las ${this.get(Clock).now()}`;
      }
    }

    const container = new Container(fakeDb);
    container.register(
      'a',
      Clock,
      clockClass(() => '12:00'),
    );
    container.register('b', Greeter, Saludo);

    expect(container.get(Greeter).hello()).toBe('hola, son las 12:00');
  });

  it('avisa cuando nadie provee el contrato', () => {
    const container = new Container(fakeDb);

    expect(() => container.get(Clock)).toThrow(ContractError);
    expect(() => container.get(Clock)).toThrow(
      /No module provides the contract "demo.clock"/,
    );
  });

  it('rechaza dos módulos proveyendo el mismo contrato', () => {
    const container = new Container(fakeDb);
    container.register(
      'a',
      Clock,
      clockClass(() => 'a'),
    );

    expect(() =>
      container.register(
        'b',
        Clock,
        clockClass(() => 'b'),
      ),
    ).toThrow(/provided by both "a" and "b"/);
  });

  it('detecta un ciclo al CONSTRUIR, en vez de agotar la pila', () => {
    // Cada una resuelve la otra MIENTRAS se construye: eso sí es un ciclo.
    class RelojCiclico extends Provider implements Clock {
      private readonly otro = this.get(Greeter);
      now() {
        return 'x';
      }
    }
    class SaludoCiclico extends Provider implements Greeter {
      private readonly otro = this.get(Clock);
      hello() {
        return 'y';
      }
    }

    const container = new Container(fakeDb);
    container.register('a', Clock, RelojCiclico);
    container.register('b', Greeter, SaludoCiclico);

    expect(() => container.get(Clock)).toThrow(/depends on itself/);
  });

  it('dos contratos pueden referenciarse mutuamente si se resuelven al usarse', () => {
    // Referencia mutua PEREZOSA: cada método resuelve al otro recién cuando se
    // lo llama, así que ninguna construcción depende de la otra. Es válido y
    // conviene que siga siéndolo: es como dos módulos se llaman entre sí.
    class RelojQuePregunta extends Provider implements Clock {
      now() {
        return `via ${this.get(Greeter).hello()}`;
      }
    }
    class Saludo extends Provider implements Greeter {
      hello() {
        return 'saludo';
      }
    }

    const container = new Container(fakeDb);
    container.register('a', Clock, RelojQuePregunta);
    container.register('b', Greeter, Saludo);

    expect(container.get(Clock).now()).toBe('via saludo');
  });

  it('la instancia queda fijada a SU aplicación', () => {
    // La inyección es por prototipo, que es lo que hace andar un inicializador
    // de campo. Si quedara sólo ahí, una segunda aplicación en el mismo proceso
    // registrando la misma clase le cambiaría el `db` a la primera.
    class Compartida extends Provider implements Clock {
      now() {
        return 'x';
      }
    }
    const otraDb = { otra: true } as unknown as Database;

    const primera = new Container(fakeDb);
    primera.register('a', Clock, Compartida);
    const instancia = primera.get(Clock);

    const segunda = new Container(otraDb);
    segunda.register('a', Clock, Compartida);
    segunda.get(Clock);

    expect((instancia as unknown as Provider & { db: Database }).db).toBe(
      fakeDb,
    );
  });

  it('dice quién provee cada contrato', () => {
    const container = new Container(fakeDb);
    container.register(
      'billing',
      Clock,
      clockClass(() => 'x'),
    );

    expect(container.providerOf(Clock)).toBe('billing');
    expect(container.providerOf(Greeter)).toBeNull();
    expect(container.ids()).toEqual(['demo.clock']);
  });
});

describe('buildContainer', () => {
  const proveedor = defineModule({
    id: 'demo',
    dir: proveedoresDir,
  });

  it('registra lo que la carpeta providers/ de cada módulo activo contiene', async () => {
    const container = await buildContainer([proveedor], fakeDb);

    expect(container.get(Clock).now()).toBe('fijo');
    expect(container.providerOf(Greeter)).toBe('demo');
  });

  it('acepta un consumidor cuyo contrato existe', async () => {
    const consumidor = defineModule({
      id: 'inventory',
      requires: ['demo'],
      consumes: [Clock],
    });

    await expect(
      buildContainer([proveedor, consumidor], fakeDb),
    ).resolves.toBeDefined();
  });

  it('no arranca si nadie provee lo que un módulo consume', async () => {
    const solitario = defineModule({
      id: 'inventory',
      consumes: [Greeter],
    });

    await expect(buildContainer([solitario], fakeDb)).rejects.toThrow(
      /consumes the contract "demo.greeter", which no module provides/,
    );
  });

  it('el orden de registro no importa para validar el consumo', async () => {
    const consumidor = defineModule({
      id: 'inventory',
      consumes: [Clock],
    });

    await expect(
      buildContainer([consumidor, proveedor], fakeDb),
    ).resolves.toBeDefined();
  });

  it('sin módulos queda vacío', async () => {
    expect((await buildContainer([], fakeDb)).ids()).toEqual([]);
  });
});
