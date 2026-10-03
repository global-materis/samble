import { integer, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from '@jest/globals';
import { defineModule } from '../lib/modules/define-module';
import { ModuleDefinitionError } from '../lib/modules/module-manifest';

const base = { id: 'billing' };

describe('defineModule — identidad', () => {
  it('acepta un manifiesto mínimo y aplica los valores por defecto', () => {
    const mod = defineModule(base);

    expect(mod.id).toBe('billing');
    expect(mod.label).toBe('billing');
    expect(mod.requires).toEqual([]);
    expect(mod.tables).toEqual([]);
    expect(mod.migrations).toEqual([]);
    expect(mod.routes).toEqual([]);
    expect(mod.permissions).toEqual([]);
  });

  it('exige un id', () => {
    expect(() => defineModule({ ...base, id: '' })).toThrow(
      ModuleDefinitionError,
    );
  });

  it.each(['Billing', 'customer_portal', '1billing', 'customer-', 'cliente ñ'])(
    'rechaza el id inválido %s',
    (id) => {
      expect(() => defineModule({ ...base, id })).toThrow(/must be lowercase/);
    },
  );

  it('acepta ids con guiones', () => {
    expect(defineModule({ ...base, id: 'customer-portal' }).id).toBe(
      'customer-portal',
    );
  });

  it('usa el label cuando viene, y el id cuando no', () => {
    expect(defineModule({ ...base, label: 'Facturación' }).label).toBe(
      'Facturación',
    );
    expect(defineModule({ ...base, label: '   ' }).label).toBe('billing');
  });
});

describe('defineModule — dependencias', () => {
  it('conserva las dependencias declaradas', () => {
    expect(
      defineModule({ ...base, requires: ['identity', 'customers'] }).requires,
    ).toEqual(['identity', 'customers']);
  });

  it('un módulo no puede requerirse a sí mismo', () => {
    expect(() => defineModule({ ...base, requires: ['billing'] })).toThrow(
      /cannot require itself/,
    );
  });

  it('rechaza dependencias duplicadas', () => {
    expect(() =>
      defineModule({ ...base, requires: ['identity', 'identity'] }),
    ).toThrow(/duplicated dependencies: identity/);
  });

  it('rechaza un id de dependencia inválido', () => {
    expect(() => defineModule({ ...base, requires: ['Identity'] })).toThrow(
      /is not a valid module id/,
    );
  });
});

describe('defineModule — permisos', () => {
  it('acepta permisos con el espacio de nombres del módulo', () => {
    const mod = defineModule({
      ...base,
      permissions: [
        { key: 'billing.view', label: 'Ver facturación' },
        { key: 'billing.charge.cancel', label: 'Anular cargos' },
      ],
    });

    expect(mod.permissions).toHaveLength(2);
  });

  it('exige que la clave lleve el id del módulo por delante', () => {
    expect(() =>
      defineModule({
        ...base,
        permissions: [{ key: 'invoices.view', label: 'Ver' }],
      }),
    ).toThrow(/must be namespaced as "billing\./);
  });

  it('exige una clave con puntos', () => {
    expect(() =>
      defineModule({
        ...base,
        permissions: [{ key: 'billing', label: 'Ver' }],
      }),
    ).toThrow(/not a dotted lowercase key/);
  });

  it('la clave sola alcanza: la etiqueta es opcional', () => {
    // La clave ya dice mucho, y una etiqueta que la repite en una oración es
    // una cadena más que alguien tiene que mantener verdadera.
    const mod = defineModule({
      ...base,
      permissions: ['billing.view', 'billing.charge.cancel'],
    });

    expect(mod.permissions).toEqual([
      { key: 'billing.view' },
      { key: 'billing.charge.cancel' },
    ]);
  });

  it('se pueden mezclar claves sueltas con claves que llevan texto', () => {
    const mod = defineModule({
      ...base,
      permissions: [
        'billing.view',
        { key: 'billing.charge.cancel', label: 'Anular cargos ya cobrados' },
      ],
    });

    expect(mod.permissions).toEqual([
      { key: 'billing.view' },
      { key: 'billing.charge.cancel', label: 'Anular cargos ya cobrados' },
    ]);
  });

  it('expone sólo las claves, para conceder todo lo de un módulo', () => {
    const mod = defineModule({
      ...base,
      permissions: ['billing.view', { key: 'billing.void', label: 'Anular' }],
    });

    // `auditor: [...billing.permissionKeys]` en un rol, sin listarlas a mano.
    expect(mod.permissionKeys).toEqual(['billing.view', 'billing.void']);
  });

  it('una etiqueta vacía es un error, no una decisión', () => {
    // Quien la escribió quiso decir algo. Omitir el campo es la forma de no
    // decir nada.
    expect(() =>
      defineModule({
        ...base,
        permissions: [{ key: 'billing.view', label: '   ' }],
      }),
    ).toThrow(/has an empty "label"/);
  });

  it('un objeto en vez de un arreglo se rechaza nombrando el cambio', () => {
    expect(() =>
      defineModule({
        ...base,
        // Lo que devolvía declarePermissions, que ya no existe.
        permissions: { view: 'billing.view' } as never,
      }),
    ).toThrow(/must be an array of keys/);
  });

  it('rechaza claves duplicadas', () => {
    expect(() =>
      defineModule({
        ...base,
        permissions: [
          { key: 'billing.view', label: 'Ver' },
          { key: 'billing.view', label: 'Ver otra vez' },
        ],
      }),
    ).toThrow(/duplicated permission keys: billing\.view/);
  });
});

describe('defineModule — aportes', () => {
  const cargos = pgTable('cargos', { id: integer('id').primaryKey() });
  const facturas = pgTable('facturas', { id: integer('id').primaryKey() });

  it('rechaza la misma tabla dos veces', () => {
    expect(() => defineModule({ ...base, tables: [cargos, cargos] })).toThrow(
      /the same table is listed twice/,
    );
  });

  it('conserva las tablas declaradas', () => {
    expect(
      defineModule({ ...base, tables: [cargos, facturas] }).tables,
    ).toHaveLength(2);
  });

  it('normaliza un glob suelto a un arreglo', () => {
    const mod = defineModule({ ...base, routes: './controllers/**/*.ts' });
    expect(mod.routes).toEqual(['./controllers/**/*.ts']);
  });

  it('acepta varios globs', () => {
    const mod = defineModule({ ...base, routines: ['./a/*.ts', './b/*.ts'] });
    expect(mod.routines).toEqual(['./a/*.ts', './b/*.ts']);
  });

  it('aplana el objeto de "import * as migrations" a un arreglo', () => {
    class CreateCharges {}
    class AddDueDate {}
    // Lo que entrega un namespace import: clases más lo que no lo es.
    const migrations = { CreateCharges, AddDueDate, __esModule: true };

    const mod = defineModule({ ...base, migrations });

    expect(mod.migrations).toEqual([CreateCharges, AddDueDate]);
  });

  it('acepta migraciones ya en arreglo', () => {
    class CreateCharges {}
    expect(
      defineModule({ ...base, migrations: [CreateCharges] }).migrations,
    ).toEqual([CreateCharges]);
  });
});

describe('defineModule — errores', () => {
  it('el error dice de qué módulo se trata', () => {
    try {
      defineModule({ ...base, requires: ['billing'] });
      throw new Error('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleDefinitionError);
      expect((error as ModuleDefinitionError).moduleId).toBe('billing');
    }
  });

  it('un manifiesto que no es objeto falla claro', () => {
    expect(() => defineModule(undefined as never)).toThrow(
      /expects a manifest object/,
    );
  });
});
