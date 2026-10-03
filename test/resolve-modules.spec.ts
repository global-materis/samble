import { describe, expect, it } from '@jest/globals';
import { defineModule } from '../lib/modules/define-module';
import {
  ModuleResolutionError,
  resolveModules,
} from '../lib/modules/resolve-modules';
import type { ModuleManifest } from '../lib/modules/module-manifest';

const mod = (id: string, extra: Partial<ModuleManifest> = {}) =>
  defineModule({ id, ...extra });

const ids = (modules: ReturnType<typeof mod>[]) => modules.map((m) => m.id);

describe('resolveModules — orden', () => {
  it('pone la dependencia antes que quien la pide', () => {
    const billing = mod('billing', { requires: ['identity'] });
    const identity = mod('identity');

    expect(ids(resolveModules([billing, identity]))).toEqual([
      'identity',
      'billing',
    ]);
  });

  it('ordena una cadena larga', () => {
    const c = mod('c', { requires: ['b'] });
    const b = mod('b', { requires: ['a'] });
    const a = mod('a');

    expect(ids(resolveModules([c, b, a]))).toEqual(['a', 'b', 'c']);
  });

  it('respeta un diamante de dependencias', () => {
    const top = mod('top', { requires: ['left', 'right'] });
    const left = mod('left', { requires: ['base'] });
    const right = mod('right', { requires: ['base'] });
    const base = mod('base');

    const order = ids(resolveModules([top, left, right, base]));

    expect(order[0]).toBe('base');
    expect(order[3]).toBe('top');
    expect(order).toHaveLength(4);
  });

  it('los módulos sin relación conservan el orden de entrada', () => {
    const order = ids(resolveModules([mod('a'), mod('b'), mod('c')]));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('es determinista entre corridas', () => {
    const build = () => [
      mod('billing', { requires: ['identity'] }),
      mod('support', { requires: ['identity'] }),
      mod('identity'),
    ];

    expect(ids(resolveModules(build()))).toEqual(ids(resolveModules(build())));
  });
});

describe('resolveModules — grafos inválidos', () => {
  it('rechaza dos módulos con el mismo id', () => {
    expect(() => resolveModules([mod('billing'), mod('billing')])).toThrow(
      /share the id "billing"/,
    );
  });

  it('rechaza una dependencia que no está instalada', () => {
    expect(() =>
      resolveModules([mod('billing', { requires: ['ghost'] })]),
    ).toThrow(/requires "ghost", which is not installed/);
  });

  it('nombra el ciclo que encontró', () => {
    const a = mod('a', { requires: ['b'] });
    const b = mod('b', { requires: ['c'] });
    const c = mod('c', { requires: ['a'] });

    expect(() => resolveModules([a, b, c])).toThrow(
      /Dependency cycle: a -> b -> c -> a/,
    );
  });

  it('detecta un ciclo de dos', () => {
    const a = mod('a', { requires: ['b'] });
    const b = mod('b', { requires: ['a'] });

    expect(() => resolveModules([a, b])).toThrow(
      /Dependency cycle: a -> b -> a/,
    );
  });

  it('el error es un ModuleResolutionError y dice de qué módulo se trata', () => {
    try {
      resolveModules([mod('billing', { requires: ['ghost'] })]);
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleResolutionError);
      expect((error as ModuleResolutionError).moduleId).toBe('billing');
    }
  });
});

describe('resolveModules — todos los módulos entran', () => {
  it('no hay nada que filtrar: lo que está en el código, corre', () => {
    // No existe encender ni apagar. Quién alcanza qué lo deciden los permisos,
    // que son política de la aplicación y no tienen que ver con lo desplegado.
    expect(ids(resolveModules([mod('a'), mod('b')]))).toEqual(['a', 'b']);
  });

  it('rechaza depender de algo que no está', () => {
    const support = mod('support', { requires: ['ghost'] });

    expect(() => resolveModules([support])).toThrow(
      /requires "ghost", which is not installed/,
    );
  });

  it('la dependencia entra en el orden aunque venga después', () => {
    const news = mod('news', { requires: ['identity'] });
    const identity = mod('identity');

    expect(ids(resolveModules([news, identity]))).toEqual(['identity', 'news']);
  });
});
