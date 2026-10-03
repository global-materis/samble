import * as fs from 'fs';
import * as path from 'path';
import EndpointReader from '../core/endpoint-reader';
import slash from 'slash';
import { currentRequestId } from '../core/request-id';
import log4js, {
  configureLogger,
  flushLogger,
  getLogFile,
  LogFiles,
  LoggerOptions,
} from '../services/log4js';

/**
 * Prefixes a line with the request being served, when there is one.
 *
 * This is what makes a request id worth having: the lines to correlate are the
 * ones written deep inside — a provider, a listener, a repository — and none of
 * them has been handed anything.
 */
const tagged = (message: any) => {
  const id = currentRequestId();
  if (!id) return message;
  return typeof message === 'string' ? `[${id}] ${message}` : message;
};

export class Logger {
  /**
   * Configures the log destination. By default samble writes rotating files to
   * `logs/` AND the console; `dir: null` leaves the console alone.
   *
   * Call before `start()` so startup is logged — `Samble.create()` already
   * does.
   *
   * @example
   * Logger.configure({ dir: '/var/log/app' });        // somewhere else
   * Logger.configure({ dir: null });                  // console only
   * Logger.configure({ files: { error: 'errores' } }); // rename one
   * Logger.configure({ level: 'off' });               // silence everything
   */
  static configure(options: LoggerOptions = {}) {
    return configureLogger(options);
  }

  /**
   * Waits for what is buffered to reach the disk, and closes the appenders.
   *
   * Called at the very end of `shutdown()`: the file appender writes
   * asynchronously, so exiting right after a log line loses it — including the
   * last line of an ordered shutdown, which is the one somebody reads when a
   * restart goes wrong.
   *
   * Anything logged after this needs {@link Logger.configure} again, which is
   * why it belongs at the end of a process's life and nowhere else.
   */
  static flush(): Promise<void> {
    return flushLogger();
  }

  /**
   * Logs a message at the 'info' level to the file and console.
   * @param message Main message to log.
   * @param args Extra arguments for the logger.
   * @returns Result of the log4js info call.
   */
  static info(message: any, ...args: any[]) {
    return log4js.getLogger('info').info(tagged(message), ...args);
  }

  /**
   * Logs a message at the 'warn' level to the file and console.
   * @param message Main message to log.
   * @param args Extra arguments for the logger.
   * @returns Result of the log4js warn call.
   */
  static warn(message: any, ...args: any[]) {
    return log4js.getLogger('warn').warn(tagged(message), ...args);
  }

  /**
   * Logs a message at the 'error' level to the file and console.
   * @param message Main message to log.
   * @param args Extra arguments for the logger.
   * @returns Result of the log4js error call.
   */
  static error(message: any, ...args: any[]) {
    return log4js.getLogger('error').error(tagged(message), ...args);
  }

  /**
   * Writes one line of the route map ('router' log, `router.log` when file
   * logging is on).
   *
   * The map exists for one question: WHICH ROUTE WINS. Express matches in
   * registration order, so `/products/:id` registered before `/products/page`
   * swallows the page and the handler receives the literal string "page" — a
   * bug that looks like a data problem. The listing prints routes in the order
   * they were mounted, with the `@Priority` that put each one there, so the
   * answer is read off the file instead of guessed.
   *
   * @param message A line of text, or the endpoint to print.
   * @param options `order` is the position in the whole mount (1 = matched
   * first); `basePath` completes the URL.
   */
  static router(
    message: string | EndpointReader,
    options: { order?: number; basePath?: string } = {},
  ) {
    const logRouter = log4js.getLogger('router');
    if (message instanceof EndpointReader) {
      const order =
        options.order === undefined
          ? '   '
          : `#${String(options.order).padStart(2, '0')}`;
      // `auto` and not `-`: no `@Priority` is the normal case, not a gap.
      const priority =
        message.priority === null ? 'auto' : `p${message.priority}`;
      const method = message.method.toUpperCase().padEnd(6);
      const pathname = slash(
        path.join('/', options.basePath ?? '', message.group, message.pathname),
      );
      const name = message.getEndpointClass().name;
      return logRouter.trace(
        `${order} ${priority.padEnd(4)} ${method} ${pathname}  (${name})`,
      );
    }
    return logRouter.trace(message);
  }

  /**
   * Empties one log file. Does nothing when that file is not being written.
   *
   * It asks for the path rather than building `<category>.log`, because the
   * names are the application's to change.
   *
   * @param category `app`, `info`, `warn`, `error` or `router`.
   * @returns true when the file was emptied.
   */
  static clear(category: keyof LogFiles) {
    const file = getLogFile(category);
    if (!file) return false;
    try {
      fs.writeFileSync(file, '');
      return true;
    } catch {
      return false;
    }
  }
}
