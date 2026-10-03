import * as log4js from 'log4js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The files samble writes, and what each one is for.
 *
 * A name renames the file (`error: 'errores'` writes `errores.log`); `false`
 * turns it off. Turning off `info`, `warn` or `error` loses nothing — those
 * lines are in the neutral log and on the console as well — so this is about
 * what you want to be able to `grep` on its own, not about silencing anything.
 */
export interface LogFiles {
  /**
   * The neutral one: every level in one chronological stream, which is how you
   * read what actually happened. Defaults to `app`.
   *
   * The route map stays out of it on purpose — it is a map, not a chronology,
   * and it would be fifty lines of boot noise in front of the first thing that
   * matters.
   */
  app?: string | false;
  /** Defaults to `info`. */
  info?: string | false;
  /** Defaults to `warn`. */
  warn?: string | false;
  /** Defaults to `error`. */
  error?: string | false;
  /**
   * What answers where, in registration order. Defaults to `router`.
   *
   * The only one that is NOT also somewhere else: `false` means there is no
   * map, which is a real choice and not a duplicate you are dropping.
   */
  router?: string | false;
}

export interface LoggerOptions {
  /**
   * Directory to write log files to. Defaults to `logs` next to the process,
   * created on start. `null` writes to the console ONLY — which is what a
   * container wants, where the disk is not where anyone reads logs and the
   * files go with the container. Can also come from `SAMBLE_LOG_DIR`.
   */
  dir?: string | null;
  /**
   * Minimum level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off'.
   * Defaults to 'trace'. Can also be set with `SAMBLE_LOG_LEVEL`.
   *
   * `off` writes no files at all: creating them for a logger that says nothing
   * would leave a directory of empty files behind every test run.
   */
  level?: string;
  /** Rename or turn off each file. Everything has a default. */
  files?: LogFiles;
}

/** 10MB */
const MAX_LOG_SIZE = 10485760;

/** Every file samble writes, with its default name and its pattern label. */
const FILES: Array<{ key: keyof LogFiles; label: string }> = [
  { key: 'app', label: 'LOG' },
  { key: 'info', label: 'INFO' },
  { key: 'warn', label: 'WARN' },
  { key: 'error', label: 'ERROR' },
  { key: 'router', label: 'ROUTER' },
];

const CONSOLE_APPENDER = {
  type: 'console',
  layout: {
    type: 'pattern',
    pattern: '%[%d{dd-MM-yy hh:mm:ss}%] %[%5p%] %m',
  },
};

const fileAppender = (file: string, label: string) => ({
  type: 'file',
  filename: file,
  maxLogSize: MAX_LOG_SIZE,
  backups: 3,
  compress: true,
  layout: {
    type: 'pattern',
    pattern: `[%d{dd/MM/yyyy hh:mm:ss}] [${label}] %m`,
  },
});

let currentDir: string | null = null;
let currentFiles: Partial<Record<keyof LogFiles, string>> = {};

/** Log directory in use, or `null` if writing to the console only. */
export const getLogDir = () => currentDir;

/**
 * Absolute path of one log file, or `null` when it is not being written.
 *
 * Names are configurable, so anything that needs to touch a file by hand —
 * `Logger.clear`, a test — has to ask instead of assuming `<category>.log`.
 */
export const getLogFile = (key: keyof LogFiles): string | null =>
  currentFiles[key] ?? null;

/**
 * (Re)configures the logger.
 *
 * It writes `logs/` next to the process by default: the route map alone earns
 * it, and a developer who has to discover an option before they can read what
 * their application did is a developer who never reads it. `dir: null` turns
 * the files off and leaves the console, which is what a container wants.
 *
 * If the directory cannot be created (permissions, read-only FS), it degrades
 * to console logging instead of failing to start.
 */
export function configureLogger(options: LoggerOptions = {}) {
  const level = options.level ?? process.env.SAMBLE_LOG_LEVEL ?? 'trace';
  let dir =
    options.dir !== undefined
      ? options.dir
      : (process.env.SAMBLE_LOG_DIR ?? 'logs');

  // A logger that says nothing has no files to say it in. Without this, every
  // test run and every `level: 'off'` process would leave a directory of empty
  // files behind it.
  if (level === 'off') dir = null;

  if (dir) {
    // Resolved ONCE, here. A relative `logs/` means "next to wherever the
    // process happens to be standing", and the appender opens its file when it
    // writes, not when it is configured: a process that chdirs afterwards
    // silently starts a second log directory somewhere else.
    dir = path.resolve(dir);
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch {
      // No write permission: fall back to console only.
      dir = null;
    }
  }
  currentDir = dir;
  currentFiles = {};

  const appenders: Record<string, unknown> = { console: CONSOLE_APPENDER };

  // Declared up front so a category can name an appender that is off and get
  // `undefined` back, rather than each one re-deriving the rules.
  if (dir) {
    for (const { key, label } of FILES) {
      const name = options.files?.[key] ?? key;
      if (name === false) continue;
      const file = path.join(dir, `${name}.log`);
      currentFiles[key] = file;
      appenders[key] = fileAppender(file, label);
      // Created empty on start, not on the first line that happens to be of
      // this kind: an empty `error.log` says "nothing went wrong", while a
      // missing one says nothing at all and sends you looking for the reason.
      try {
        fs.appendFileSync(file, '');
      } catch {
        // The directory was writable a moment ago; if this fails the appender
        // will report it far more usefully than a crash here.
      }
    }
  }

  /** Console, the neutral file, and this level's own file, in that order. */
  const levelled = (key: keyof LogFiles) =>
    ['console', 'app', key].filter(
      (name) => name === 'console' || appenders[name],
    );

  const router = appenders.router ? ['router'] : ['console'];

  return log4js.configure({
    appenders,
    categories: {
      default: { appenders: ['console'], level },
      info: { appenders: levelled('info'), level },
      warn: { appenders: levelled('warn'), level },
      error: { appenders: levelled('error'), level },
      // Never doubled into `app`: the map belongs to the boot, not to the
      // story of what the application did. And when its file is off there is
      // no second copy to fall back to, so it goes to the console instead of
      // disappearing.
      router: { appenders: router, level },
    },
  } as log4js.Configuration);
}

/**
 * Waits for what is buffered to reach the disk.
 *
 * The file appender writes asynchronously, so `process.exit()` right after a
 * log line loses it — including the last line of an ordered shutdown, which is
 * the one somebody reads when a restart goes wrong.
 *
 * It SHUTS DOWN the appenders, so anything logged after this needs
 * {@link configureLogger} again. That is why it belongs at the end of a
 * process's life and nowhere else.
 */
export function flushLogger(): Promise<void> {
  return new Promise((resolve) => {
    log4js.shutdown(() => resolve());
  });
}

/**
 * Console only, until an application asks for more.
 *
 * Importing the package must not create a directory: this runs on `import`,
 * and a CLI command or a script that merely reads something from samble has no
 * business leaving `logs/` behind. The files start when `Samble.create()` does.
 */
export default configureLogger({ dir: null });
