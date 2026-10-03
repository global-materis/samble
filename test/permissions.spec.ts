import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import {
  Auth,
  AuthError,
  defineModule,
  ForbiddenError,
  PermissionRegistry,
} from '../lib';

/**
 * Estas suites prueban el chequeo EN EJECUCIÓN con su propio vocabulario
 * (`billing.*`), a propósito independiente de lo que declare la app de `src/`.
 *
 * Dentro de este repo `PermissionKey` se estrecha a las claves de la demo —
 * dos aplicaciones comparten el mismo programa de TypeScript — así que el
 * ensanche va acá una sola vez, en vez de un @ts-expect-error por línea. Una
 * app de verdad sólo declara las suyas y no necesita nada de esto.
 */
type AuthSinTipar = Omit<Auth, 'assert' | 'can'> & {
  assert(...keys: string[]): void;
  can(...keys: string[]): boolean;
};

const crearAuth = (...args: ConstructorParameters<typeof Auth>): AuthSinTipar =>
  new Auth(...args) as unknown as AuthSinTipar;

const modules = () => [
  defineModule({
    id: 'billing',
    permissions: [
      { key: 'billing.view', label: 'Ver facturación' },
      { key: 'billing.void', label: 'Anular' },
    ],
  }),
  defineModule({
    id: 'catalog',
    permissions: [{ key: 'catalog.manage', label: 'Gestionar catálogo' }],
  }),
];

const actor = () => ({
  actor: {} as SambleAuth.Actor,
  permissions: ['billing.view'],
});

describe('PermissionRegistry', () => {
  it('junta lo que declara cada módulo, con su dueño', () => {
    const registro = PermissionRegistry.from(modules());

    expect(registro.size()).toBe(3);
    expect(registro.list()).toContainEqual({
      key: 'catalog.manage',
      label: 'Gestionar catálogo',
      moduleId: 'catalog',
    });
  });

  it('"*" siempre es conocido: es del framework', () => {
    expect(new PermissionRegistry().has('*')).toBe(true);
  });

  it('sugiere las claves del mismo módulo', () => {
    // Un typo casi siempre cae dentro de un módulo que el autor conoce.
    expect(PermissionRegistry.from(modules()).suggest('billing.veiw')).toEqual([
      'billing.view',
      'billing.void',
    ]);
  });

  it('sin vecinos, no inventa sugerencias', () => {
    expect(PermissionRegistry.from(modules()).suggest('otra.cosa')).toEqual([]);
  });
});

describe('Auth con registro', () => {
  const registro = () => PermissionRegistry.from(modules());

  it('una clave que nadie declara es error de programación, NO un 403', () => {
    // Responder 403 mandaría a depurar roles y concesiones en vez del typo.
    const auth = crearAuth(actor(), true, registro());

    expect(() => auth.assert('billing.veiw')).toThrow(/Unknown permission/);
    expect(() => auth.assert('billing.veiw')).not.toThrow(ForbiddenError);
    expect(() => auth.assert('billing.veiw')).not.toThrow(AuthError);
  });

  it('el mensaje nombra las candidatas del módulo', () => {
    expect(() =>
      crearAuth(actor(), true, registro()).can('billing.veiw'),
    ).toThrow(/Did you mean: billing.view, billing.void/);
  });

  it('can también valida: devolver false callado es el mismo bug', () => {
    expect(() => crearAuth(actor(), true, registro()).can('nope.nope')).toThrow(
      /Unknown permission/,
    );
  });

  it('una clave declarada sigue comportándose igual', () => {
    const auth = crearAuth(actor(), true, registro());

    expect(auth.can('billing.view')).toBe(true);
    expect(auth.can('billing.void')).toBe(false);
    expect(() => auth.assert('billing.void')).toThrow(ForbiddenError);
    expect(() => auth.assert('billing.view')).not.toThrow();
  });

  it('un anónimo con clave desconocida falla por la clave, no por el 401', () => {
    // El orden importa: primero el error del programador, que es el arreglable.
    expect(() => crearAuth(null, true, registro()).assert('no.existe')).toThrow(
      /Unknown permission/,
    );
  });

  it('sin registro no valida: un Auth construido a mano sigue sirviendo', () => {
    expect(() => crearAuth(actor(), true).can('lo.que.sea')).not.toThrow();
  });
});
