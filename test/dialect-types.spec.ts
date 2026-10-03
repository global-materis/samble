import { describe, expect, it } from '@jest/globals';
import type { DatabaseOptions, DialectName, DialectOf } from '../lib';

/**
 * Un test de TIPOS: ts-jest compila el archivo, así que una afirmación que deja
 * de cumplirse, o un `@ts-expect-error` que deja de ser necesario, ROMPE la
 * suite. El motor que tipa `this.db` no existe en tiempo de ejecución: esta es
 * la única forma de fijarlo.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const holds = <T extends true>(): T => true as T;

// Las dos formas de escribir src/config/database.ts.
function withSatisfies() {
  return { dialect: 'mysql', host: 'localhost' } satisfies DatabaseOptions;
}
function annotated(): DatabaseOptions {
  return { dialect: 'mysql', host: 'localhost' };
}

describe('el motor que declara SambleDatabase.Config (en compilación)', () => {
  it('las dos formas devuelven lo mismo: la diferencia es solo de tipos', () => {
    expect(withSatisfies().dialect).toBe('mysql');
    expect(annotated().dialect).toBe('mysql');
  });

  it('sin declaración, es postgres', () => {
    expect(holds<Equal<DialectOf<object>, 'postgres'>>()).toBe(true);
  });

  it('con `satisfies`, es el motor escrito en las opciones', () => {
    type Declared = {
      dialect: ReturnType<typeof withSatisfies>['dialect'];
    };
    expect(holds<Equal<DialectOf<Declared>, 'mysql'>>()).toBe(true);
    // @ts-expect-error y no otro: el tipo sigue al valor
    holds<Equal<DialectOf<Declared>, 'postgres'>>();
  });

  it('anotado `: DatabaseOptions`, son todos los motores, y NO cae en postgres', () => {
    // Antes caía en postgres en silencio: compilaba contra un motor y se
    // conectaba a otro. Ahora es `never`, y `this.db` pasa a ser
    // DialectMustBeOneEngine, que nombra el error donde aparece.
    type Declared = { dialect: ReturnType<typeof annotated>['dialect'] };
    expect(holds<Equal<DialectOf<Declared>, never>>()).toBe(true);
    expect(holds<Equal<DialectOf<{ dialect: DialectName }>, never>>()).toBe(
      true,
    );
  });

  it('un motor que samble no conoce tampoco pasa', () => {
    expect(holds<Equal<DialectOf<{ dialect: 'oracle' }>, never>>()).toBe(true);
  });
});
