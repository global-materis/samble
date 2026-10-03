import cookieParser from 'cookie-parser';
import express, {
  Express,
  RequestHandler,
  NextFunction,
  Request,
  Response,
  Router,
} from 'express';
import morgan from 'morgan';
import http from 'http';
import { Logger } from '../utilities/logger';
import slash from 'slash';
import path from 'path';

export type Handler = (req: Request, res: Response, next: () => void) => void;

export class RouterOption {
  private handlers: Handler[] = [];

  constructor(
    public path: string,
    public method: string,
  ) {}

  public setHandler = (handler: Handler) => {
    this.handlers.push(handler);
  };

  getHandlers = () => {
    return this.handlers;
  };
}

/**
 * morgan's `dev` line, plus the id of the request.
 *
 * Written out rather than composed because morgan does not expose its named
 * formats: `dev` is a format string with a colour picked from the status, and
 * an access line that cannot be tied to an id is the one line you have for a
 * request that was slow instead of broken.
 */
morgan.format('samble', (tokens, request, response) => {
  const status = response.headersSent ? response.statusCode : undefined;
  const colour =
    status === undefined
      ? 0
      : status >= 500
        ? 31
        : status >= 400
          ? 33
          : status >= 300
            ? 36
            : 32;
  const id = (request as { requestId?: string }).requestId;

  return [
    '[0m',
    tokens.method(request, response),
    ' ',
    tokens.url(request, response),
    ` [${colour}m`,
    status ?? '-',
    ' [0m',
    tokens['response-time'](request, response) ?? '-',
    ' ms - ',
    tokens.res(request, response, 'content-length') ?? '-',
    id ? ` [${id}]` : '',
    '[0m',
  ].join('');
});

export default class Server {
  protected app: Express;
  protected server?: http.Server;

  /**
   * Paths kept out of the access log.
   *
   * A liveness probe runs every few seconds forever. Logging it buries every
   * real request under it, which is how an access log stops being read.
   *
   * A `Set` filled later rather than a constructor argument: morgan reads it
   * per request, and the options that decide what goes in it are read after
   * this runs.
   */
  protected quietPaths = new Set<string>();

  /**
   * Initializes the Express application and sets up basic middleware such as
   * the body parser, cookie parser and morgan for request logging.
   */
  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(
      morgan('samble', {
        skip: (request) => this.quietPaths.has(request.path),
      }),
    );
  }

  /**
   * Registers multiple routes under a given prefix in the application.
   * @param prefix Group prefix under which the routes are registered.
   * @param options Array of RouterOption describing the routes, methods and handlers.
   */
  protected router = (prefix: string, options: RouterOption[]) => {
    const router = Router();
    options.forEach((option) => {
      const fullPath = slash(path.join('/', option.path));
      const register = router[option.method];
      // A verb may not exist in the runtime (e.g. QUERY on a Node whose HTTP
      // parser does not recognize it yet): skip the route with a clear error
      // instead of crashing startup with "is not a function".
      if (typeof register !== 'function') {
        Logger.error(
          `HTTP method "${option.method.toUpperCase()}" is not supported by this Node/Express version; skipping route ${fullPath}`,
        );
        return;
      }
      register.call(router, fullPath, ...option.getHandlers());
    });
    this.app.use(slash(path.join('/', prefix)), router);
  };

  /**
   * Starts the server listening on the given port.
   *
   * It resolves with the port the server is ACTUALLY on, which is not always
   * the one asked for: port 0 means "any free one", and reporting the 0 back
   * is how a test's log ends up naming a port nothing is listening on.
   *
   * @param port Port the HTTP server will listen on, or 0 for any free one.
   * @returns Promise resolving to the bound port.
   */
  protected listen = (port: number): Promise<number> => {
    return new Promise<number>((resolve) => {
      this.server = this.app.listen(port, () => {
        const address = this.server?.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  };

  /**
   * Closes the HTTP server: stops accepting new connections and waits for
   * in-flight requests to finish. Resolves immediately if there is no server.
   */
  protected closeServer = () => {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  };

  /**
   * Returns the internal Express application instance.
   * @returns The Express instance.
   */
  public getApp = () => {
    return this.app;
  };

  /**
   * Lets you add middleware or extra logic to the Express application.
   * @param callback Function that receives the Express instance to modify it.
   */
  public use = (
    callback: (req: Request, res: Response, next: NextFunction) => any,
  ) => {
    this.app.use.bind(this.app);
    this.app.use(callback);
  };

  /**
   * Answers GET on ONE exact path, ahead of the module routers.
   *
   * `use(path, handler)` would also match everything under it, which turns
   * `/health/anything` into a 200 and hides a typo in a probe's URL.
   */
  protected mountGet = (pathname: string, handler: RequestHandler) => {
    this.app.get(pathname, handler);
  };

  /**
   * Registers a directory of static files in the Express application under the
   * given path. Files in the provided root directory are served directly when
   * requested through the pathname.
   *
   * @param pathname Base path where the static files are available (e.g. '/public').
   * @param root Absolute or relative path to the directory the files are served from.
   */
  public static = (pathname: string, root: string) => {
    this.app.use(pathname, express.static(root));
  };
}
