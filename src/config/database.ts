/**
 * Which database engine this demo runs on, told to the compiler once: it is
 * what types `this.db` in every endpoint. `samble init` writes this same file
 * for the engine the operator chose.
 */
declare global {
  namespace SambleDatabase {
    interface Config {
      dialect: 'postgres';
    }
  }
}

export {};
