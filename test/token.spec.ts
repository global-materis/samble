import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { Container, Database, Reaction, token } from '../lib';

const fakeDb = {} as Database;

/**
 * `token()` reemplazó a `contract()`, `slot()` y `event()`.
 *
 * Lo que compra: el "de qué tipo es" pasa a ser una propiedad DEL TOKEN, que es
 * de donde ya lo leían el contenedor y los decoradores. Antes se afirmaba en dos
 * lugares —el token y el nombre del decorador— y dos lugares que pueden
 * discrepar son la única razón por la que existía un error de "los cruzaste".
 */
describe('token()', () => {
  it('lleva el id y la clase que se le pidió', () => {
    expect(token('billing.service', 'contract')).toEqual({
      id: 'billing.service',
      kind: 'contract',
    });
    expect(token('billing.payment-methods', 'slot')).toEqual({
      id: 'billing.payment-methods',
      kind: 'slot',
    });
    expect(token('billing.nightly-close', 'schedule')).toEqual({
      id: 'billing.nightly-close',
      kind: 'schedule',
    });
  });

  it('rechaza un id vacío, que si no choca con el próximo id vacío', () => {
    expect(() => token('', 'contract')).toThrow(/non-empty string/);
    expect(() => token('   ', 'slot')).toThrow(/non-empty string/);
  });

  it('rechaza una clase que no existe, nombrando las tres', () => {
    expect(() => token('demo.x', 'contrato' as never)).toThrow(
      /unknown kind "contrato"/,
    );
  });

  it('ya no existe el tipo evento: una reacción es una ranura', () => {
    // La fusión: lo que distinguía a un evento era de quién es la falla, y eso
    // lo decide el VERBO con que se lee la ranura, no un tipo aparte.
    expect(() => token('demo.viejo', 'event' as never)).toThrow(
      /unknown kind "event"/,
    );
  });
});

/**
 * Éste es un test de TIPOS: ts-jest compila el archivo, así que un
 * `@ts-expect-error` que deja de ser necesario ROMPE la suite. Es la única
 * forma de fijar que los tokens no se pueden cruzar, porque el chequeo no
 * existe en tiempo de ejecución.
 */
describe('los tokens no se pueden cruzar (en compilación)', () => {
  const Contrato = token<{ hola(): void }>('demo.contrato', 'contract');
  const Ranura = token<{ id: string }>('demo.ranura', 'slot');
  const Aviso = token<Reaction<{ n: number }>>('demo.aviso', 'slot');
  const Nocturno = token('demo.nocturno', 'schedule');

  it('el contenedor no acepta el token equivocado', () => {
    const container = new Container(fakeDb);

    // @ts-expect-error una ranura no es un contrato
    expect(() => container.get(Ranura)).toThrow();
    // @ts-expect-error un horario no es un contrato
    expect(() => container.get(Nocturno)).toThrow();
    // @ts-expect-error un contrato no es una ranura
    expect(container.all(Contrato)).toEqual([]);
  });

  it('notify() sólo acepta una ranura DE REACCIONES', async () => {
    const container = new Container(fakeDb);

    // La ranura que devuelve algo no sirve para anunciar: su aporte no tiene
    // `on(payload)`, y es el tipo el que lo dice.

    // @ts-expect-error un aporte que no es una reacción
    await container.notify(Ranura, { n: 1 });
    // @ts-expect-error un contrato no es una ranura
    await container.notify(Contrato, { n: 1 });

    // La que sí lo es compila, y sin nadie anotado no hace nada.
    await expect(container.notify(Aviso, { n: 1 })).resolves.toBeUndefined();
    expect(container.countFor(Aviso)).toBe(0);
  });
});
