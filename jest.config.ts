import type { Config } from 'jest';

/**
 * ts-jest puro: el framework es decorator-driven, así que la transformación
 * DEBE honrar `experimentalDecorators` y `emitDecoratorMetadata` del
 * tsconfig. Transformar con babel-jest rompería los decoradores.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  /**
   * Lo que genera el CLI importa `samble` como lo haría un proyecto consumidor.
   * Sin esto, la prueba tendría que generar rutas relativas y dejaría de
   * probar el caso real.
   */
  moduleNameMapper: {
    '^samble$': '<rootDir>/lib',
    // El mismo alias que `samble init` escribe: la demo lo usa, así que jest
    // tiene que resolverlo igual que el build.
    '^@/(.*)$': '<rootDir>/src/modules/$1',
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
  /**
   * Los 5s por defecto alcanzaban hasta que las suites que levantan PGlite
   * pasaron a competir por CPU entre workers: un `beforeAll` que arma la base,
   * corre migraciones y arranca la app tarda más que eso bajo carga, y fallaba
   * por tiempo, no por lógica. El límite sigue existiendo para atajar un
   * cuelgue de verdad.
   */
  testTimeout: 30000,
  /**
   * Y subir el timeout no alcanzaba: con un worker por core, cada suite que
   * levanta PGlite —un Postgres en WASM— pelea por el mismo CPU, y el arranque
   * de `demo-app` se pasaba de los 30s de forma intermitente. Era carga, no
   * lógica: la misma suite tarda 3s corriendo sola. Con la mitad de los workers
   * no sólo deja de fallar, además la corrida completa baja de ~48s a ~21s,
   * porque dejar de sobresuscribir el CPU sale más barato que el paralelismo.
   */
  maxWorkers: '50%',
  verbose: true,
};

export default config;
