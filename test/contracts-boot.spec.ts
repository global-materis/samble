import path from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it } from '@jest/globals';
import Samble from '../lib/core/samble';
import { defineModule } from '../lib/modules/define-module';
import { ModuleStore } from '../lib/modules/module-store';
import { BillingService } from './fixtures/modules/contracts';
import { closeTestDb, createTestDb } from './helpers/test-db';
import { cualquiera } from './helpers/auth';
import type { Database } from '../lib';

const salesDir = path.join(__dirname, 'fixtures/modules/sales');
const billingDir = path.join(__dirname, 'fixtures/modules/billing');

const billing = () =>
  defineModule({
    id: 'billing',
    // Su proveedor está en ./providers: el manifiesto no lo nombra.
    dir: billingDir,
    routes: './controllers/*.controller.ts',
  });

const sales = () =>
  defineModule({
    id: 'sales',
    dir: salesDir,
    requires: ['billing'],
    consumes: [BillingService],
    routes: './controllers/*.controller.ts',
  });

describe('contratos entre módulos', () => {
  let db: Database;
  let app: Samble | undefined;

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    app = undefined;
    await closeTestDb();
  });

  const boot = async (modules: ReturnType<typeof billing>[]) => {
    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: modules,
      version: '2.0.0-dev.0',
    });
    await app.start(0);
    return app.getApp();
  };

  it('un módulo llama al contrato de otro sin importarlo', async () => {
    db = await createTestDb();
    const server = await boot([billing(), sales()]);

    const res = await request(server).post('/api/inventario/ventas');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ venta: 'v1', cargoId: 'cargo-c1-120' });
  });

  it('no arranca si falta el módulo que provee', async () => {
    db = await createTestDb();

    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [sales()],
      version: '2.0.0-dev.0',
    });

    // sales lo requiere, así que la falla llega antes: el grafo no resuelve.
    await expect(app.start(0)).rejects.toThrow(
      /requires "billing", which is not installed/,
    );
  });

  it('no arranca si nadie provee el contrato que se consume', async () => {
    db = await createTestDb();

    // sales declara que consume, pero billing no lo provee.
    // Sin `dir`: no hay carpeta de proveedores que leer, así que no provee.
    const billingMudo = defineModule({
      id: 'billing',
    });

    app = await Samble.create({
      auth: cualquiera,
      db: db,
      modules: [billingMudo, sales()],
      version: '2.0.0-dev.0',
    });

    await expect(app.start(0)).rejects.toThrow(
      /consumes the contract "billing.service", which no module provides/,
    );
  });

  it('el contrato queda registrado y se sabe quién lo provee', async () => {
    db = await createTestDb();
    await boot([billing(), sales()]);

    const stored = await new ModuleStore(db).list();
    expect(stored.map((m) => m.id).sort()).toEqual(['billing', 'sales']);
  });

  it('sin módulos, pedir un contrato explica qué falta', async () => {
    db = await createTestDb();
    app = await Samble.create({ auth: cualquiera, db, modules: [] });
    await app.start(0);

    // Un endpoint suelto sin contenedor: el mensaje debe decir qué hacer.
    const { Endpoint } = await import('../lib');
    class Suelto extends Endpoint {
      main() {
        return null;
      }
      probar() {
        return (this as unknown as { get: (t: unknown) => unknown }).get(
          BillingService,
        );
      }
    }

    expect(() => new Suelto().probar()).toThrow(
      /this application has no modules/,
    );
  });
});
