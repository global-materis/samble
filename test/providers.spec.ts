import 'reflect-metadata';
import path from 'path';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { buildContainer } from '../lib/modules/build-container';
import { defineModule } from '../lib/modules/define-module';
import { ContractError } from '../lib/modules/container';
import { token } from '../lib/modules/token';
import { Provider } from '../lib/templates/provider';
import { Strategy } from '../lib/templates/strategy';
import { Provides } from '../lib/decorators/provides.decorator';
import { Fills } from '../lib/decorators/fills.decorator';
import { Badges, built, Greeter } from './fixtures/proveedores/shared';
import type { Database } from '../lib';

/**
 * La implementación de un contrato es una CLASE en `providers/`, y el token
 * sale de su decorador.
 *
 * Lo que compra: `module.ts` vuelve a ser sólo el lugar donde se enlazan las
 * piezas. Donde antes había una fábrica dentro del manifiesto —el lugar donde
 * más código de un módulo terminaba viviendo— ahora hay un archivo con nombre,
 * en una carpeta que se encuentra sola.
 */

/** El contenedor sólo pasa el DataSource al construir: alcanza con un doble. */
const fakeDb = { marca: 'la de verdad' } as unknown as Database;

const demo = defineModule({
  id: 'demo',
  dir: path.join(__dirname, 'fixtures/proveedores'),
});

describe('proveedores por carpeta', () => {
  beforeEach(() => {
    built.greeter = 0;
    built.clock = 0;
  });

  it('registra el contrato sin que el manifiesto lo nombre', async () => {
    // El manifiesto de `demo` no dice `provides` en ninguna parte.
    const container = await buildContainer([demo], fakeDb);

    expect(container.providerOf(Greeter)).toBe('demo');
    expect(container.get(Greeter).hello()).toBe('hola fijo');
  });

  it('le inyecta db antes de construir, como a un endpoint', async () => {
    // `sawDb` es un inicializador de campo: si `db` llegara en el constructor
    // o después, sería false y `this.db.getRepository(...)` no compilaría como
    // patrón.
    const container = await buildContainer([demo], fakeDb);

    expect(
      (container.get(Greeter) as unknown as { sawDb: boolean }).sawDb,
    ).toBe(true);
  });

  it('sigue construyéndose al primer uso, y una sola vez', async () => {
    const container = await buildContainer([demo], fakeDb);

    // Cargar la carpeta no construye nada: un contrato que nadie llama no
    // cuesta.
    expect(built.greeter).toBe(0);

    container.get(Greeter).hello();
    container.get(Greeter).hello();

    expect(built.greeter).toBe(1);
    // Y `hello()` resolvió Clock por su cuenta.
    expect(built.clock).toBe(1);
  });

  it('@Fills llena la ranura de otro módulo', async () => {
    const container = await buildContainer([demo], fakeDb);

    expect(container.all(Badges).map((badge) => badge.id)).toEqual(['loud']);
  });

  it('un Provider sin decorador se salta, no rompe el arranque', async () => {
    // `naked.provider.ts` está en la carpeta a propósito.
    const container = await buildContainer([demo], fakeDb);

    expect(container.ids().sort()).toEqual(['demo.clock', 'demo.greeter']);
  });
});

describe('@Provides es sólo para contratos', () => {
  it('acepta un contrato', () => {
    const Contrato = token<{ id: string }>('demo.contrato', 'contract');

    expect(() => {
      @Provides(Contrato)
      class Uno extends Provider {}
      return Uno;
    }).not.toThrow();
  });

  it('rechaza una ranura, y manda a @Fills con su carpeta', () => {
    // El error tiene que decir las tres cosas que hay que cambiar: el
    // decorador, la clase base y la carpeta.
    const Ranura = token<{ id: string }>('demo.ranura', 'slot');

    expect(() => {
      @Provides(Ranura as never)
      class Mal extends Provider {}
      return Mal;
    }).toThrow(
      /@Fills\(\) on a class extending Strategy, in the module's strategies\//,
    );
  });

  it('rechaza un horario, y dice qué corre sobre uno', () => {
    const Nocturno = token('demo.nocturno', 'schedule');

    expect(() => {
      @Provides(Nocturno as never)
      class Mal extends Provider {}
      return Mal;
    }).toThrow(/and got a schedule.*@Cron\(token, expression\)/);
  });

  it('rechaza lo que no es un token', () => {
    expect(() => {
      @Provides({ id: 'demo.mano' } as never)
      class Mal extends Provider {}
      return Mal;
    }).toThrow(/something that is not a token/);
  });
});

describe('@Fills es sólo para ranuras', () => {
  it('acepta una ranura', () => {
    const Ranura = token<{ id: string }>('demo.ranura.ok', 'slot');

    expect(() => {
      @Fills(Ranura)
      class Uno extends Strategy {}
      return Uno;
    }).not.toThrow();
  });

  it('rechaza un contrato, y manda a @Provides', () => {
    const Contrato = token<{ id: string }>('demo.contrato.no', 'contract');

    expect(() => {
      @Fills(Contrato as never)
      class Mal extends Strategy {}
      return Mal;
    }).toThrow(/@Provides\(\) on a class extending Provider/);
  });

  it('rechaza un horario', () => {
    const Nocturno = token('demo.nocturno.no', 'schedule');

    expect(() => {
      @Fills(Nocturno as never)
      class Mal extends Strategy {}
      return Mal;
    }).toThrow(/Nothing fills a schedule/);
  });

  it('rechaza lo que no es un token', () => {
    expect(() => {
      @Fills({ id: 'demo.mano' } as never)
      class Mal extends Strategy {}
      return Mal;
    }).toThrow(/something that is not a token/);
  });
});

describe('un contrato tiene exactamente un proveedor', () => {
  it('dos módulos respondiendo el mismo es un error de arranque', async () => {
    // El MISMO directorio montado dos veces: dos módulos con la misma clase.
    // Sin esto, el consumidor recibiría uno u otro según el orden de carga, que
    // es la clase de error que cambia entre despliegues.
    const otro = defineModule({
      id: 'otro',
      dir: path.join(__dirname, 'fixtures/proveedores'),
    });

    await expect(buildContainer([demo, otro], fakeDb)).rejects.toThrow(
      ContractError,
    );
  });
});
