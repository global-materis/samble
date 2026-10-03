import 'reflect-metadata';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import {
  buildContainer,
  Container,
  Database,
  defineModule,
  Provider,
  Strategy,
  token,
} from '../lib';
import { PaymentMethod, PaymentMethods } from './fixtures/pagos/shared';

const fakeDb = {} as Database;
const pagos = (nombre: string) =>
  path.join(__dirname, 'fixtures/pagos', nombre);

describe('ranuras de extensión', () => {
  it('una ranura que nadie llenó devuelve vacío, no falla', async () => {
    // Es una función que nadie instaló, no un error.
    const billing = defineModule({ id: 'billing' });
    const container = await buildContainer([billing], fakeDb);

    expect(container.all(PaymentMethods)).toEqual([]);
    expect(container.countFor(PaymentMethods)).toBe(0);
  });

  it('acepta VARIAS: en eso se diferencia de un contrato', async () => {
    const efectivo = defineModule({
      id: 'cash',
      dir: pagos('efectivo'),
    });
    const banco = defineModule({
      id: 'bank',
      dir: pagos('banco'),
    });

    const container = await buildContainer([efectivo, banco], fakeDb);

    // El orden es el de los módulos, que para entonces es orden de
    // dependencias: estable entre arranques.
    expect(container.all(PaymentMethods).map((m) => m.id)).toEqual([
      'cash',
      'bank',
    ]);
  });

  it('un módulo que no está no aporta nada', async () => {
    // Quitar la extensión del despliegue retira lo que agregó.
    const efectivo = defineModule({
      id: 'cash',
      dir: pagos('efectivo'),
    });

    expect((await buildContainer([], fakeDb)).all(PaymentMethods)).toEqual([]);
    expect(
      (await buildContainer([efectivo], fakeDb)).all(PaymentMethods),
    ).toHaveLength(1);
  });

  it('una estrategia resuelve contratos, como un proveedor', () => {
    const Tasa = token<{ valor: number }>('fx.rate', 'contract');

    class TasaProvider extends Provider {
      public readonly valor = 3.7;
    }
    class EnDolares extends Strategy implements PaymentMethod {
      public readonly id = 'usd';
      public readonly label = `Dólares a ${this.get(Tasa).valor}`;
    }

    const container = new Container(fakeDb);
    container.register('fx', Tasa, TasaProvider);
    container.contribute('pay', PaymentMethods, EnDolares);

    expect(container.all(PaymentMethods)[0].label).toBe('Dólares a 3.7');
  });

  it('se construye una sola vez y se cachea', () => {
    let veces = 0;
    class Contada extends Strategy implements PaymentMethod {
      public readonly id = 'x';
      public readonly label = 'X';
      constructor() {
        super();
        veces += 1;
      }
    }

    const container = new Container(fakeDb);
    container.contribute('x', PaymentMethods, Contada);

    container.all(PaymentMethods);
    container.all(PaymentMethods);

    expect(veces).toBe(1);
  });

  it('una contribución que pide su propia ranura se reporta, no revienta la pila', () => {
    class SePideASiMisma extends Strategy implements PaymentMethod {
      public readonly id = 'x';
      public readonly label = 'X';
      private readonly otras = this.all(PaymentMethods);
    }

    const container = new Container(fakeDb);
    container.contribute('x', PaymentMethods, SePideASiMisma);

    expect(() => container.all(PaymentMethods)).toThrow(
      /is being filled while it is still being filled/,
    );
  });
});
