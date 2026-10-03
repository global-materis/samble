import { ConfigService, type DatabaseOptions } from '../../lib';

/**
 * Which database engine this demo runs on, told to the compiler: it is what
 * types `this.db` in every endpoint. Read off the `dialect` databaseFromEnv()
 * returns, so the compiler and the driver cannot disagree. `samble init` writes
 * this same file for the engine the operator chose.
 */
declare global {
  namespace SambleDatabase {
    interface Config {
      dialect: ReturnType<typeof databaseFromEnv>['dialect'];
    }
  }
}

/**
 * The database the demo runs on, as the environment describes it. Its
 * variables are required here, where they are read, and not in createApp(): a
 * caller that hands in a database of its own needs none of them.
 */
export default function databaseFromEnv() {
  ConfigService.require([
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_NAME',
  ]);

  return {
    // The engine is the operator's choice; this demo runs on Postgres. Said
    // here once: the declaration above reads it.
    dialect: 'postgres',
    host: ConfigService.get('DB_HOST'),
    port: ConfigService.number('DB_PORT'),
    user: ConfigService.get('DB_USERNAME'),
    password: ConfigService.get('DB_PASSWORD'),
    database: ConfigService.get('DB_NAME'),
  } satisfies DatabaseOptions;
}
