import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { runDoctor } from '../lib/cli/doctor';
import Samble from '../lib/core/samble';
import { defineModule } from '../lib/modules/define-module';
import { ConfigError, ConfigService } from '../lib/utilities/config-service';
import { cualquiera } from './helpers/auth';

/**
 * La configuración, con el fallo en el lugar correcto.
 *
 * Todo lo de acá existe por el mismo motivo: una variable que falta en el
 * servidor de otro tiene que decirlo por su nombre, al arrancar, y no llegarle
 * al driver como `undefined` ni a un puerto como `NaN` — que es el mismo error
 * tres capas lejos de su causa.
 */

const tocadas: string[] = [];

/** Pone una variable y la anota para limpiarla. */
const poner = (name: string, value: string) => {
  tocadas.push(name);
  process.env[name] = value;
};

const quitar = (name: string) => {
  tocadas.push(name);
  delete process.env[name];
};

afterEach(() => {
  tocadas.forEach((name) => delete process.env[name]);
  tocadas.length = 0;
});

describe('ConfigService.require', () => {
  it('nombra TODAS las que faltan, no la primera', () => {
    // Quien está llenando un .env en un servidor quiere una lista, no un fallo
    // más por cada viaje de ida y vuelta.
    poner('CFG_PRESENTE', 'si');

    expect(() =>
      ConfigService.require(['CFG_PRESENTE', 'CFG_FALTA_A', 'CFG_FALTA_B']),
    ).toThrow(/CFG_FALTA_A, CFG_FALTA_B/);
  });

  it('no lanza cuando están todas', () => {
    poner('CFG_A', '1');
    poner('CFG_B', '2');

    expect(() => ConfigService.require(['CFG_A', 'CFG_B'])).not.toThrow();
  });

  it('una vacía cuenta como ausente: `KEY=` es una plantilla sin llenar', () => {
    poner('CFG_VACIA', '');

    expect(() => ConfigService.require(['CFG_VACIA'])).toThrow(/CFG_VACIA/);
  });

  it('el error lleva los nombres aparte del mensaje', () => {
    try {
      ConfigService.require(['CFG_X', 'CFG_Y']);
      throw new Error('tenía que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).names).toEqual(['CFG_X', 'CFG_Y']);
    }
  });
});

describe('ConfigService.get', () => {
  it('lanza nombrando la variable en vez de devolver undefined', () => {
    // Antes estaba tipada `string` y devolvía `undefined`: el valor seguía
    // viaje y rompía en otro lado.
    quitar('CFG_NO_ESTA');

    expect(() => ConfigService.get('CFG_NO_ESTA')).toThrow(/CFG_NO_ESTA/);
  });

  it('devuelve el valor cuando está', () => {
    poner('CFG_HAY', 'valor');

    expect(ConfigService.get('CFG_HAY')).toBe('valor');
  });
});

describe('ConfigService.optional', () => {
  it('ausente es undefined, no una excepción', () => {
    quitar('CFG_OPC');

    expect(ConfigService.optional('CFG_OPC')).toBeUndefined();
  });

  it('decir que es opcional es el punto', () => {
    poner('CFG_OPC', 'x');

    expect(ConfigService.optional('CFG_OPC')).toBe('x');
  });
});

describe('ConfigService.number', () => {
  it('convierte, tolerando espacios', () => {
    poner('CFG_PUERTO', ' 5432 ');

    expect(ConfigService.number('CFG_PUERTO')).toBe(5432);
  });

  it('lo que no es número falla como lo que es, no como NaN', () => {
    // `+get('DB_PORT')` daba NaN, y NaN le llega al driver como puerto: el
    // fallo salía como un problema de conexión.
    poner('CFG_PUERTO', 'postgres');

    expect(() => ConfigService.number('CFG_PUERTO')).toThrow(
      /must be a number, and it is "postgres"/,
    );
  });

  it('ausente lanza por ausente', () => {
    quitar('CFG_PUERTO');

    expect(() => ConfigService.number('CFG_PUERTO')).toThrow(/is not set/);
  });
});

describe('ConfigService.boolean', () => {
  it('acepta las formas usuales, sin importar mayúsculas', () => {
    for (const valor of ['true', '1', 'YES', 'On']) {
      poner('CFG_FLAG', valor);
      expect(ConfigService.boolean('CFG_FLAG')).toBe(true);
    }
    for (const valor of ['false', '0', 'NO', 'Off']) {
      poner('CFG_FLAG', valor);
      expect(ConfigService.boolean('CFG_FLAG')).toBe(false);
    }
  });

  it('lo que no entiende lanza, en vez de leerse como false', () => {
    // `ENABLE_X=maybe` valiendo "no" en silencio es cómo una función queda
    // apagada mientras su .env dice que está encendida.
    poner('CFG_FLAG', 'maybe');

    expect(() => ConfigService.boolean('CFG_FLAG')).toThrow(
      /must be a boolean/,
    );
  });
});

describe('el env que declara un módulo', () => {
  it('queda en el manifiesto resuelto', () => {
    const mod = defineModule({ id: 'wa', env: ['WA_URL', 'WA_TOKEN'] });

    expect(mod.env).toEqual(['WA_URL', 'WA_TOKEN']);
  });

  it('sin declarar nada, es una lista vacía', () => {
    expect(defineModule({ id: 'wa' }).env).toEqual([]);
  });

  it('rechaza un nombre que no es un nombre, al importar el archivo', () => {
    // Un typo en el NOMBRE es un módulo que exige una variable que nadie va a
    // poner nunca, y el archivo que se importa es donde se puede señalar.
    expect(() => defineModule({ id: 'wa', env: ['  '] })).toThrow(
      /"env" takes variable names/,
    );
  });

  it('rechaza duplicados', () => {
    expect(() => defineModule({ id: 'wa', env: ['A', 'A'] })).toThrow(
      /duplicated env variables: A/,
    );
  });
});

describe('el arranque y el env de los módulos', () => {
  let app: Samble | undefined;

  afterEach(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    app = undefined;
  });

  /** Una base que NO existe: si alguien la toca, el error sería del driver. */
  const baseInalcanzable = {
    host: '127.0.0.1',
    port: 1,
    user: 'nadie',
    password: 'nada',
    database: 'ninguna',
  };

  it('se niega a arrancar nombrando el módulo y la variable', async () => {
    quitar('WA_URL');
    app = await Samble.create({
      auth: cualquiera,
      db: baseInalcanzable,
      modules: [defineModule({ id: 'wa', env: ['WA_URL'] })],
    });

    await expect(app.start(0)).rejects.toThrow(/wa: WA_URL/);
  });

  it('el env se mira ANTES de la base', async () => {
    // La base de este caso no existe. Si el orden fuera al revés, el error
    // sería del driver y nadie sabría que falta una variable.
    quitar('WA_URL');
    app = await Samble.create({
      auth: cualquiera,
      db: baseInalcanzable,
      modules: [defineModule({ id: 'wa', env: ['WA_URL'] })],
    });

    await expect(app.start(0)).rejects.toBeInstanceOf(ConfigError);
  });

  it('junta lo que falta de todos los módulos en un solo error', async () => {
    quitar('WA_URL');
    quitar('SMTP_HOST');
    app = await Samble.create({
      auth: cualquiera,
      db: baseInalcanzable,
      modules: [
        defineModule({ id: 'wa', env: ['WA_URL'] }),
        defineModule({ id: 'correo', env: ['SMTP_HOST'] }),
      ],
    });

    const error = (await app.start(0).catch((e) => e)) as ConfigError;
    expect(error.names.sort()).toEqual(['SMTP_HOST', 'WA_URL']);
  });

  it('checkEnv informa sin lanzar, que es lo que necesita un chequeo', async () => {
    quitar('WA_URL');
    poner('SMTP_HOST', 'localhost');
    app = await Samble.create({
      auth: cualquiera,
      db: baseInalcanzable,
      modules: [
        defineModule({ id: 'wa', env: ['WA_URL'] }),
        defineModule({ id: 'correo', env: ['SMTP_HOST'] }),
      ],
    });

    expect(app.checkEnv()).toEqual([{ moduleId: 'wa', missing: ['WA_URL'] }]);
  });

  it('con todo puesto, el env deja pasar y el fallo pasa a ser el de la base', async () => {
    // La prueba de que el guardia no es lo único que puede fallar: una vez que
    // el env está completo, el arranque sigue y muere donde corresponde.
    poner('WA_URL', 'http://localhost:9999');
    app = await Samble.create({
      auth: cualquiera,
      db: baseInalcanzable,
      modules: [defineModule({ id: 'wa', env: ['WA_URL'] })],
    });

    await expect(app.start(0)).rejects.not.toBeInstanceOf(ConfigError);
  });
});

describe('samble doctor', () => {
  it('cuando la app no carga, lo que dependía queda SALTEADO y no en ok', async () => {
    // "No llegamos a preguntar" no es "está bien". Es la misma distinción que
    // tiene que hacer un cliente de licencias con una red que no respondió.
    const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'samble-doctor-'));
    try {
      const result = await runDoctor({ root: vacio });
      const estado = Object.fromEntries(
        result.checks.map((check) => [check.name, check.status]),
      );

      expect(result.ok).toBe(false);
      expect(estado['Database']).toBe('skipped');
      expect(estado['Migrations']).toBe('skipped');
    } finally {
      fs.rmSync(vacio, { recursive: true, force: true });
    }
  });

  it('un ConfigError de createApp se reporta como el env de la aplicación', async () => {
    // El `ConfigService.require()` de la propia aplicación corre dentro de
    // createApp, así que doctor lo tiene que leer como lo que es —el entorno
    // contestando— y no como una entrada rota.
    delete process.env.DOCTOR_FALTA_A;
    delete process.env.DOCTOR_FALTA_B;

    const result = await runDoctor({
      root: process.cwd(),
      entry: 'test/fixtures/doctor-entry.ts',
    });
    const env = result.checks.find(
      (check) => check.name === 'Environment (application)',
    );

    expect(result.ok).toBe(false);
    expect(env?.status).toBe('fail');
    expect(env?.detail).toContain('DOCTOR_FALTA_A, DOCTOR_FALTA_B');
  });

  it('Node se mira antes de cargar nada, así que la fila está siempre', async () => {
    const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'samble-doctor-'));
    try {
      const result = await runDoctor({ root: vacio });

      expect(result.checks[0].name).toBe('Node');
      expect(result.checks[0].status).toBe('ok');
    } finally {
      fs.rmSync(vacio, { recursive: true, force: true });
    }
  });
});

describe('samble doctor — el error de otra copia del módulo', () => {
  it('reconoce un ConfigError por NOMBRE, no por instanceof', async () => {
    // Si esto se rompe, doctor culpa al punto de entrada por una variable que
    // falta, y quien instala sale a buscar un bug que no existe.
    const result = await runDoctor({
      root: process.cwd(),
      entry: 'test/fixtures/doctor-foreign-config-error.ts',
    });
    const env = result.checks.find(
      (check) => check.name === 'Environment (application)',
    );

    expect(env?.status).toBe('fail');
    expect(env?.detail).toContain('DE_OTRA_COPIA');
    // Y NO lo reporta como punto de entrada roto.
    expect(
      result.checks.find((check) => check.name === 'Entry point'),
    ).toBeUndefined();
  });
});
