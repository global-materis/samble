import { describe, expect, it } from '@jest/globals';
import { defineModule } from '../lib/modules/define-module';
import { reconcileModules } from '../lib/modules/reconcile-modules';
import type { ModuleState } from '../lib/modules/reconcile-modules';
import type { ModuleManifest } from '../lib/modules/module-manifest';

const mod = (id: string, extra: Partial<ModuleManifest> = {}) =>
  defineModule({ id, ...extra });

const stored = (id: string): ModuleState => ({ id });

describe('reconcileModules — instalación', () => {
  it('registra un módulo nuevo', () => {
    const result = reconcileModules([mod('news')], []);

    expect(result.install).toEqual([{ id: 'news' }]);
  });

  it('no reinstala lo que ya está registrado', () => {
    const result = reconcileModules([mod('news')], [stored('news')]);

    expect(result.install).toEqual([]);
  });

  it('presencia, no versión: volver a desplegar el mismo id no cambia nada', () => {
    // Un módulo no tiene versión propia. Dos despliegues del mismo id son el
    // mismo módulo, y la fila ya existe: no hay actualización que reportar.
    const primero = reconcileModules([mod('billing')], []);
    const segundo = reconcileModules([mod('billing')], [stored('billing')]);

    expect(primero.install).toEqual([{ id: 'billing' }]);
    expect(segundo.install).toEqual([]);
  });
});

describe('reconcileModules — huérfanos', () => {
  it('reporta un módulo cuyo código desapareció', () => {
    const result = reconcileModules(
      [mod('news')],
      [stored('news'), stored('legacy-thing')],
    );

    expect(result.orphaned).toEqual([{ id: 'legacy-thing' }]);
  });

  it('no lo confunde con algo a instalar', () => {
    const result = reconcileModules([], [stored('legacy-thing')]);

    expect(result.install).toEqual([]);
  });

  it('no lo borra: reportarlo es todo lo que hace', () => {
    // La fila se queda, y sus tablas también. Qué hacer con esos datos es una
    // decisión de quien opera la instalación, no de una secuencia de arranque.
    const result = reconcileModules([], [stored('legacy-thing')]);

    expect(result.orphaned).toHaveLength(1);
  });
});

describe('reconcileModules — instalación en blanco', () => {
  it('sin nada registrado, instala todo', () => {
    const result = reconcileModules(
      [mod('identity'), mod('billing'), mod('news'), mod('support')],
      [],
    );

    expect(result.install).toHaveLength(4);
    expect(result.orphaned).toEqual([]);
  });

  it('sin módulos ni registros no pasa nada', () => {
    expect(reconcileModules([], [])).toEqual({ install: [], orphaned: [] });
  });
});
