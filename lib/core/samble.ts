import { sql } from 'drizzle-orm';
import { NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import EndpointHandler from './endpoint-handler';
import EndpointReader from './endpoint-reader';
import PatternResolve from './pattern-resolver';
import Server, { RouterOption } from './server';
import { Logger } from '../utilities/logger';
import type { LoggerOptions } from '../services/log4js';
import ErrorControl from '../utilities/error-control';
import { NotFoundError } from '../utilities/errors';
import { ConfigError, ConfigService } from '../utilities/config-service';
import { ErrorType } from '../interfaces/type-error';
import { Routine } from '../templates/routine';
import { Scheduler, ScheduleHandle, ScheduleToken } from '../modules/schedules';
import path from 'path';
import { OpenAPIGenerator, OpenAPIInfo } from '../services/openapi-generator';
import { ResolvedModule } from '../modules/module-manifest';
import { ModuleStore } from '../modules/module-store';
import { AppliedMigration, ModuleMigrator } from '../modules/module-migrator';
import { reconcileModules } from '../modules/reconcile-modules';
import { resolveModules } from '../modules/resolve-modules';
import {
  LoadedModule,
  loadModules,
  loadModuleRoutines,
} from '../modules/module-loader';
import { buildContainer } from '../modules/build-container';
import { Container } from '../modules/container';
import {
  PermissionRegistry,
  RegisteredPermission,
} from '../modules/permissions';
import { AuthResolver } from './auth';
import { buildCors, CorsConfig } from './cors';
import { buildHealth, HealthConfig } from './health';
import { buildRequestId, RequestIdConfig } from './request-id';
import {
  diffSnapshots,
  emptySnapshot,
  liveDrift,
  moduleSnapshot,
  SchemaDiff,
  SchemaSnapshot,
  tableOwners,
} from '../modules/schema-diff';
import { Database, DatabaseOptions, run } from '../modules/database';
import { dialectOf, dialectOfSchemaObject, type Dialect } from '../dialects';
import { ModuleDefinitionError } from '../modules/module-manifest';
import {
  closeClient,
  isDatabase,
  openDatabase,
} from '../modules/open-database';

/** One module's migrations, and which of them already ran. */
export interface ModuleMigrationStatus {
  module: string;
  migrations: Array<{ name: string; applied: boolean }>;
}

/** What {@link Samble.create} takes. */
export interface SambleOptions {
  /**
   * How to reach the database, or a connection the application already owns.
   *
   * With options samble opens the pool itself and builds the schema from the
   * modules. With an instance, the connection and its schema are the caller's
   * business — samble has nothing to add to one it did not build.
   */
  db: DatabaseOptions | Database;

  /**
   * Manifests built with `defineModule()`. Required, and the ONLY way to mount
   * routes or routines: an application is its modules.
   */
  modules: ResolvedModule[];

  /** Prefix for every module route. Defaults to `/api`. */
  basePath?: string;

  /**
   * The application's own version, not samble's. Reported by `/health` when
   * `details` is on, which is how a deployment says what it is running.
   */
  version?: string;

  /**
   * Turns a request into whoever is behind it.
   *
   * Required, and it is the one option with no sensible default: a framework
   * that decided this for you would be deciding who may do what. Returning
   * `null` is how it says nobody is behind this request, and that `null` is
   * what turns `this.auth.assert(...)` into a 401.
   *
   * An application that gates nothing still writes one — `defineAuth(async
   * () => ({ actor: {} as SambleAuth.Actor, permissions: ['*'] }))` — because
   * "everyone is allowed" is an answer somebody chose, and it reads like one.
   * `samble init` writes exactly that, so a new project answers from the first
   * request.
   */
  auth: AuthResolver;

  /**
   * Who may call this API from a browser. Left out, no CORS headers are sent,
   * which is right for an API no browser calls cross-origin.
   *
   * It is mounted before anything else so a preflight is answered without
   * reaching a route, and so the headers are present on an error too.
   */
  cors?: CorsConfig;

  /**
   * One id per request, in the log lines, the error body and a response
   * header. Always on; this only changes which header carries it, for a
   * gateway that already sends its own.
   */
  requestId?: RequestIdConfig;

  /**
   * Interactive documentation, generated from the same decorators that mount
   * the routes — so it cannot drift from what the API actually does.
   *
   * Left out, nothing is exposed. The full shape of an API is a map for
   * whoever finds it, and where that is acceptable is the application's call,
   * not the framework's.
   */
  docs?: DocsConfig;

  /**
   * Can this application serve? An unauthenticated 200/503 that a load
   * balancer, a container runtime or an uptime check can read.
   *
   * Left out, nothing is mounted — but there is little reason to: every
   * platform that runs a backend expects it.
   */
  health?: HealthConfig;

  /**
   * Where the logs go, and under what names.
   *
   * Left out, samble writes `logs/` next to the process — `app.log` with
   * everything in one stream, `info`/`warn`/`error` split out for grepping,
   * and `router.log`, the map of what answers where in registration order,
   * which is the fastest answer to "why is my route a 404". The console gets
   * everything either way.
   *
   * There is nothing to turn ON here: it is for moving the directory
   * (`dir`), renaming or dropping a file (`files`), or writing none at all
   * (`dir: null`), which is what a container wants — inside one the disk is
   * not where anyone reads logs, and the files go with the container.
   */
  logs?: LoggerOptions;
}

/**
 * Where the generated OpenAPI documentation is served.
 *
 * The spec comes from the same `@Group`/`@HttpGet`/`@Body`/`@Params`/`@Query`
 * decorators that mount the routes — there is nothing to annotate twice, and
 * nothing that can drift. `@ApiTag`, `@ApiSummary`, `@ApiDescription`,
 * `@ApiResponse` and `@ApiHidden` add detail or hold a route back.
 */
export interface DocsConfig {
  /** The UI. The raw OpenAPI 3 JSON is served at `<path>.json`. */
  path?: string;
  /** Title, version and Markdown description shown at the top of the UI. */
  info?: OpenAPIInfo;
}

/**
 * `3 routes`, `1 route`, and '' for none — so a summary line can drop the
 * parts that have nothing to say instead of printing `0 contracts`.
 */
const count = (total: number, noun: string): string =>
  total === 0 ? '' : `${total} ${noun}${total === 1 ? '' : 's'}`;

/**
 * This framework allows you to configure API and routine patterns based on
 * modules, resolving their routes and dynamically loading what they declare.
 */
/**
 * Refuses, at boot and by name, a module whose tables were written for another
 * engine — a `pgTable` in an application on MySQL. Left alone it would fail at
 * the module's first query, with an error that names neither the module nor
 * the engine.
 */
function assertModulesMatch(dialect: Dialect, modules: ResolvedModule[]) {
  for (const mod of modules) {
    for (const table of mod.tables) {
      if (dialect.isSchemaObject(table)) continue;
      const other = dialectOfSchemaObject(table)?.name ?? 'another engine';
      throw new ModuleDefinitionError(
        `Module "${mod.id}" declares tables for ${other}, and this application runs on ${dialect.name}. A module's tables are written for the engine the application runs on.`,
        mod.id,
      );
    }
  }
}

export default class Samble extends Server {
  private modules: ResolvedModule[] = [];
  private moduleBasePath = '/api';
  private loadedModules: LoadedModule[] = [];
  private container?: Container;
  private permissionRegistry = new PermissionRegistry();
  private authResolver: AuthResolver;
  private moduleRoutines: Array<new () => Routine> = [];
  private scheduler?: Scheduler;
  private templatesAsync: Promise<string[]>[] = [];
  private started = false;
  private shuttingDown = false;
  private swaggerConfig: {
    path: string;
    info?: OpenAPIInfo;
  } | null = null;

  /**
   * Splits a module's endpoints by where each one hangs from.
   *
   * An application that serves pages AND an API cannot share one prefix:
   * `/api/products/page` is not a URL anybody would link to. So a group can
   * declare its own with `@Group(name, { mount })`, and the same module
   * ends up mounted in more than one place — which is why this returns groups
   * rather than one base path per module.
   *
   * Insertion order is kept, so `@Priority` still decides who answers first
   * among routes that could shadow each other. Routes under different prefixes
   * cannot shadow each other at all.
   */
  private byBasePath = (
    readers: EndpointReader[],
  ): Map<string, EndpointReader[]> => {
    const groups = new Map<string, EndpointReader[]>();
    for (const reader of readers) {
      const base = reader.mountAt ?? this.moduleBasePath;
      const current = groups.get(base) ?? [];
      current.push(reader);
      groups.set(base, current);
    }
    return groups;
  };

  /**
   * Groups EndpointReaders by their URL prefix: `@Group`, or the module id.
   *
   * One Express Router per group is what keeps `@Priority` deciding among
   * routes that could shadow each other and nothing else.
   *
   * @param endpointReaders Array of EndpointReader instances.
   * @returns An object holding the EndpointReaders grouped by prefix.
   */
  private groupEndpointReaders = (endpointReaders: EndpointReader[]) => {
    return endpointReaders.reduce(
      (acc, endpointReader) => {
        const group = endpointReader.group;
        if (!acc[group]) {
          acc[group] = [];
        }
        acc[group].push(endpointReader);
        return acc;
      },
      {} as { [group: string]: typeof endpointReaders },
    );
  };

  /**
   * Private on purpose: {@link Samble.create} is the only way in.
   *
   * A hand-built instance could only ever be an application with no modules —
   * and therefore no routes and no routines — or one whose connection never
   * learned about its modules' tables, which fails later, at the first query.
   *
   * @param dbSource The open connection every endpoint, routine and provider
   * is handed.
   * @param ownsConnection Whether samble opened it, and may therefore close it.
   */
  private constructor(
    private dbSource: Database,
    private readonly ownsConnection: boolean,
  ) {
    super();
    this.dialect = dialectOf(dbSource);
  }

  /**
   * The engine this application runs on, read off its connection: options
   * carry `dialect`, and a connection handed in already is one.
   */
  public readonly dialect: Dialect;

  /**
   * Builds an application from its modules, owning the DataSource.
   *
   * This is the inversion modules require. The schema is the union of what
   * every module contributes, which the application cannot assemble by hand
   * without knowing each module's internals. So samble builds it.
   *
   * Tables come from every module present in the code: the schema is exactly
   * the union of what the modules declare, and nothing else decides it.
   *
   * A connection can still be passed instead of options, for an application
   * that already owns one. Its schema is then its own business, and samble does
   * not close what it did not open.
   *
   * @example
   * const app = await Samble.create({
   *   db: { dialect: 'postgres', host, database },
   *   modules: [identity, billing],
   *   version: '3.0.0',
   * });
   * await app.start(4000);
   */
  public static create = async (options: SambleOptions): Promise<Samble> => {
    const modules = options.modules;

    // Two branches instead of a cast: the narrowing is what says which of the
    // two shapes `db` was, and it is also the answer to who closes it.
    let database: Database;
    let ownsConnection: boolean;
    if (isDatabase(options.db)) {
      database = options.db;
      ownsConnection = false;
    } else {
      database = openDatabase(options.db, modules);
      ownsConnection = true;
    }

    const app = new Samble(database, ownsConnection);
    assertModulesMatch(app.dialect, modules);

    // Before anything else, so a failure during boot is still visible through
    // it. Always, not only when `logs` is passed: the files are the default,
    // and a developer who has to find an option before they can read what
    // their application did is a developer who never reads it.
    Logger.configure(options.logs ?? {});

    // First, and before any `app.use()` the caller adds: a preflight has no
    // business reaching a route, and a response that fails still needs the
    // headers or the browser hides the reason.
    if (options.cors) app.use(buildCors(options.cors));

    // Right after, so everything downstream — every log line, every error
    // body, the access log — is written under the same id, and the client is
    // handed it in a header whether the request succeeded or not.
    app.use(buildRequestId(options.requestId));

    if (options.health) {
      const path = options.health.path ?? '/health';
      app.quietPaths.add(path);
      app.mountGet(
        path,
        buildHealth(options.health, {
          db: () => app.dbSource,
          version: options.version,
          isShuttingDown: () => app.shuttingDown,
        }),
      );
    }

    if (options.docs) {
      app.swaggerConfig = {
        path: options.docs.path ?? '/docs',
        info: options.docs.info,
      };
    }

    app.authResolver = options.auth;
    app.useModules(modules, { basePath: options.basePath });

    return app;
  };

  /**
   * Every permission the installed modules declare, with the module that owns
   * each one.
   *
   * This is what a "who may do what" screen is built from: the catalog comes
   * from the modules, so adding a feature adds its permission without editing
   * a central list somebody has to remember. A key exists because a manifest
   * declares it; what limits who reaches it is the role, not the deployment.
   *
   * Populated during `start()`, so call it after.
   */
  public permissions = (): RegisteredPermission[] =>
    this.permissionRegistry.list();

  /**
   * The connection samble opened (or was handed), for what the application
   * plugs in beside it — a session store over the same pool, say:
   *
   * ```typescript
   * new PgStore({ pool: app.db.$client as Pool })
   * ```
   *
   * The engine is the application's choice, so the store package is too:
   * samble hands over the connection and installs nothing for it. `$client`
   * is the driver's own object (a `pg` Pool, a PGlite instance, ...).
   *
   * Read-only. Endpoints, routines and providers already get it as `this.db`;
   * this is for code that runs outside them, in `createApp()`.
   */
  public get db(): Database {
    return this.dbSource;
  }

  /**
   * The handle of a schedule: `start()`, `stop()`, `runNow()`.
   *
   * Here as well as on every unit so the decision can be made OUTSIDE a
   * module: a deployment that wants one schedule off, a script that runs a
   * nightly job by hand, a test that stops the clock before asserting.
   *
   * Populated during `start()`, so call it after.
   *
   * @example
   * const app = await createApp();
   * await app.start(5050);
   * app.schedule(NightlyBackup).stop();
   */
  public schedule = (token: ScheduleToken): ScheduleHandle => {
    if (!this.scheduler) {
      throw new Error(
        `Cannot reach the schedule "${token.id}": the application has not started yet, so no schedule is registered. Call it after start().`,
      );
    }
    return this.scheduler.handle(token);
  };

  /** Ids of every registered schedule, whether on or stopped. */
  public schedules = (): string[] => this.scheduler?.ids() ?? [];

  /**
   * Configures the template engine and the views directory.
   *
   * @param engine Template engine (e.g. 'ejs' or 'pug').
   * @param root Root directory where the templates live.
   */
  public setTemplates = async (
    engine: 'ejs' | 'pug',
    root: string | string[],
  ) => {
    this.app.set('view engine', engine);
    const patternResolvers = Array.isArray(root)
      ? root.map((r) => new PatternResolve<string>(r))
      : [new PatternResolve<string>(root)];
    const modules = patternResolvers
      .map(async (r) => {
        await r.readPath();
        return r.getPaths();
      })
      .flat();

    this.templatesAsync = modules;
  };

  /**
   * Registers the modules this application is made of.
   *
   * On start they go through the full cycle: their state is read from
   * `_modules`, the graph is resolved into dependency order, their pending
   * migrations run in that order, and then each one gets its routes,
   * and routines mounted.
   *
   * @param modules Manifests built with `defineModule()`.
   * @param options `basePath` prefixes every module route (default `/api`).
   */
  private useModules = (
    modules: ResolvedModule[],
    options: { basePath?: string } = {},
  ) => {
    this.modules = modules;
    if (options.basePath) this.moduleBasePath = options.basePath;
  };

  /**
   * Brings the installation in line with the modules in the code and prepares
   * what has to be mounted.
   *
   * Order is not incidental: state is read before resolving, resolving before
   * migrating, and migrating before anything is mounted — a route must never
   * answer against a table its migration has not created yet.
   */
  /**
   * Reconciles the installation with the modules in the code and returns the
   * ones that are active, in dependency order.
   *
   * Shared by `start()` and by the migration commands so there is ONE
   * definition of "which modules count": a CLI that resolved them differently
   * from the server would migrate a set nobody runs.
   *
   * @param write `false` computes the same answer without recording anything,
   * for a dry run.
   */
  private prepareModules = async (write = true): Promise<ResolvedModule[]> => {
    const store = new ModuleStore(this.dbSource);
    await store.ensureTable();

    const reconciliation = write
      ? await store.sync(this.modules)
      : reconcileModules(this.modules, await store.list());

    if (write) {
      for (const entry of reconciliation.install) {
        Logger.info(`Module "${entry.id}" installed`);
      }
      for (const entry of reconciliation.orphaned) {
        Logger.warn(
          `Module "${entry.id}" is recorded but no longer in the code. Its data was left untouched.`,
        );
      }
    }

    return resolveModules(this.modules);
  };

  /**
   * Opens the connection if the caller has not. A command that only migrates
   * has no reason to call `start()`, and `start()` would mount an HTTP server
   * it never wanted.
   *
   * Public so a caller can tell "could not reach the database" apart from
   * anything that happens afterwards — `migrate()` calls it anyway, and a
   * driver error surfacing from there reads like a framework crash.
   */
  public connect = async (): Promise<void> => {
    // A pool connects lazily, so "is it initialized" has no answer worth
    // having: the first real query is when a wrong host or password shows up.
    // Asking for one here is what keeps that error at the point where the
    // caller asked to connect, instead of inside their first request.
    await run(this.dbSource, sql`select 1`);
  };

  /**
   * Runs every pending migration and mounts nothing.
   *
   * This is what `start()` already does before mounting a single route — same
   * reconciliation, same order — exposed on its own because the moment you
   * deploy to a machine you do not watch, "migrate, then start" has to be two
   * steps: the first one can fail loudly and stop the release, instead of a
   * server that came up and answered wrong.
   *
   * @param options `dryRun` answers what WOULD run, recording nothing.
   * @returns What ran, in the order it ran.
   *
   * @example
   * const app = await createApp();
   * const ran = await app.migrate();
   * await app.close();
   */
  public migrate = async (
    options: { dryRun?: boolean } = {},
  ): Promise<AppliedMigration[]> => {
    await this.connect();

    const active = await this.prepareModules(!options.dryRun);
    const migrator = new ModuleMigrator(this.dbSource);

    if (options.dryRun) return migrator.pending(active);

    const ran = await migrator.run(active);
    for (const entry of ran) {
      Logger.info(`Migration applied: ${entry.module}:${entry.name}`);
    }
    return ran;
  };

  /**
   * What ONE module's schema needs to go from `previous` to what its code says.
   *
   * Per module, and against a snapshot rather than against the live database.
   * That is what makes it answerable with nothing running: generating a
   * migration is a question about two descriptions of a schema, and needing a
   * database to ask it meant you could not write one on a plane.
   *
   * Per module is also what removes a decision that used to be guesswork. A
   * whole-schema diff has to be attributed — which module does this table
   * belong to? — and the answer decided where the migration was filed, which
   * decides what order it runs in. Comparing one module's tables against one
   * module's snapshot has nothing to attribute.
   *
   * @example
   * const app = await createApp();
   * const { up, down } = await app.pendingSchema('billing', stored);
   */
  public pendingSchema = async (
    moduleId: string,
    previous?: SchemaSnapshot,
  ): Promise<SchemaDiff> =>
    diffSnapshots(
      this.dialect,
      previous ?? (await emptySnapshot(this.dialect)),
      await moduleSnapshot(this.dialect, this.moduleOrFail(moduleId)),
    );

  /**
   * What one module's tables describe right now, to store beside the migration
   * generated from it.
   *
   * `previous` chains them: every snapshot records the id of the one before it,
   * which is what makes a history out of a pile of files.
   */
  public snapshotOf = (
    moduleId: string,
    previous?: SchemaSnapshot,
  ): Promise<SchemaSnapshot> =>
    moduleSnapshot(this.dialect, this.moduleOrFail(moduleId), previous);

  /**
   * What the LIVE database is missing to match every module's tables.
   *
   * The other question, and the one snapshots cannot answer: has the schema
   * drifted from the code? A migration applied by hand, a column dropped in a
   * console, a snapshot nobody committed all show up here and nowhere else.
   *
   * Reads the schema and changes nothing.
   */
  public schemaDrift = async (): Promise<string[]> => {
    await this.connect();
    return liveDrift(this.dialect, this.dbSource, this.modules);
  };

  private moduleOrFail = (moduleId: string): ResolvedModule => {
    const found = this.modules.find((mod) => mod.id === moduleId);
    if (!found) {
      throw new Error(
        `No module "${moduleId}" in this application. It has: ${
          this.modules.map((mod) => mod.id).join(', ') || 'none'
        }.`,
      );
    }
    return found;
  };

  /**
   * Which module owns each table, from the tables each one declares.
   *
   * What makes a whole-database diff filable: the schema is one namespace and
   * has no idea modules exist, so the mapping has to come from here.
   */
  public tableOwners = (): Map<string, string> => tableOwners(this.modules);

  /**
   * What each module declares and what of it already ran.
   *
   * Written for the question people actually ask — "why didn't my migration
   * run?" — so it reports DECLARED count too: zero declared means the module's
   * `migrations` index exports nothing, which looks identical from the
   * database and is the most common cause.
   */
  public migrationStatus = async (): Promise<ModuleMigrationStatus[]> => {
    await this.connect();

    // Ordered the way they will migrate, which is the order worth reading.
    const active = await this.prepareModules(false);
    // No `ensureTable()`: reading the state must not create anything.
    const applied = await new ModuleMigrator(this.dbSource).applied();

    return active.map((mod) => ({
      module: mod.id,
      migrations: mod.migrations.map((migration) => ({
        name: migration.name,
        applied: applied.has(`${mod.id}:${migration.name}`),
      })),
    }));
  };

  private bootModules = async () => {
    const active = await this.prepareModules();

    const migrator = new ModuleMigrator(this.dbSource);
    const ran = await migrator.run(active);
    for (const entry of ran) {
      Logger.info(`Migration applied: ${entry.module}:${entry.name}`);
    }

    // Built before anything is mounted: a module consuming a contract nobody
    // provides must stop the boot, not the first request that needs it.
    this.container = await buildContainer(active, this.dbSource);

    // The bus and the container reference each other: an implementation may
    // emit, a listener may resolve a contract. Wired here, in the open.
    // From every module present in the code, like the tables: a permission key
    // exists because a manifest declares it.
    this.permissionRegistry = PermissionRegistry.from(this.modules);

    this.loadedModules = await loadModules(active);

    // Schedules are REGISTERED here and started at the end of `start()`, after
    // `listen`: a boot that fails on the way there never leaves a cron ticking
    // against a half-built application. Registering early is what makes a
    // duplicate token or a missing `@Cron` a boot-time complaint.
    this.scheduler = new Scheduler(this.dbSource);
    this.scheduler.useWiring(this.container);
    // Both directions: a routine reaches contracts and slots, and a provider or
    // a strategy reaches a schedule.
    this.container.useScheduler(this.scheduler);
    this.moduleRoutines = [];
    for (const mod of active) {
      for (const RoutineClass of await loadModuleRoutines(mod)) {
        this.moduleRoutines.push(RoutineClass);
        this.scheduler.register(mod.id, RoutineClass);
      }
    }
    // Two lines, not six. What each wiring kind is CALLED belongs to the map
    // in `router.log` and to `app.permissions()`; a boot that went well only
    // has to say what got wired and how much of it, and a boot that did not
    // says so by the number being zero.
    Logger.info(
      `Modules: ${active.map((mod) => mod.id).join(', ') || 'none'}` +
        ` (${active.length} of ${this.modules.length})`,
    );

    const wiring = [
      count(this.container.ids().length, 'contract'),
      count(this.container.slotIds().length, 'extension point'),
      count(this.permissionRegistry.size(), 'permission'),
    ].filter(Boolean);

    if (wiring.length > 0) Logger.info(`Wiring: ${wiring.join(', ')}`);
  };

  /**
   * Starts the main framework flow: connects to the database,
   * resolves APIs and routines, creates routes, and starts the HTTP server.
   *
   * @param port Port where the HTTP server will be started.
   */
  /**
   * What the installed modules need from the environment, and whether it is
   * there.
   *
   * Public because an installer wants the answer WITHOUT starting the
   * application — `samble doctor` is this plus the checks that do need a
   * connection. It reports rather than throws, so a caller can print every
   * problem at once.
   */
  public checkEnv = (): { moduleId: string; missing: string[] }[] => {
    return this.modules
      .map((mod) => ({
        moduleId: mod.id,
        missing: ConfigService.whichMissing(mod.env),
      }))
      .filter((entry) => entry.missing.length > 0);
  };

  public start = async (port: number) => {
    if (this.started) return;
    this.started = true;
    const startedAt = Date.now();

    // BEFORE the connection on purpose. A module missing a variable is not a
    // database problem, and if the database credentials are what is missing then
    // naming the variable beats a driver's ECONNREFUSED. Everything at once, so
    // somebody filling in a `.env` on a server gets one list.
    const incomplete = this.checkEnv();
    if (incomplete.length > 0) {
      this.started = false;
      const detail = incomplete
        .map((entry) => `  ${entry.moduleId}: ${entry.missing.join(', ')}`)
        .join('\n');
      const names = incomplete.flatMap((entry) => entry.missing);
      throw new ConfigError(
        `Missing environment variables declared by installed modules:\n${detail}\n\nEach module names what it cannot run without in its manifest ("env"). Set them, or run \`samble doctor\` to see everything this installation is still missing.`,
        names,
      );
    }

    // Initialize the database. If it fails it is a FATAL error: rethrow so the
    // process exits with a non-zero code and the orchestrator (Docker/PM2)
    // restarts it, instead of staying alive with no server.
    try {
      await this.connect();
    } catch (error) {
      Logger.error('Fatal: could not connect to the database', error);
      this.started = false;
      throw error;
    }

    if (this.modules.length === 0) {
      // Not fatal — an application may mount its own Express handlers through
      // `getApp()` — but it is almost always a mistake worth saying out loud.
      Logger.warn(
        'This application declares no modules: it will serve nothing but what you mounted by hand.',
      );
    } else {
      try {
        await this.bootModules();
      } catch (error) {
        // A broken module graph or a failed migration is fatal: serving
        // half-mounted is worse than not starting.
        Logger.error('Fatal: could not load modules', error);
        this.started = false;
        throw error;
      }
    }

    if (this.templatesAsync.length > 0) {
      const templates = await Promise.all(this.templatesAsync);
      this.app.set('views', templates.flat());
    }

    // Every route belongs to a module. Grouping by module keeps each one's
    // routers, OpenAPI spec and logging together, so a route can always be
    // traced back to the module that owns it.
    const resolvedGroups: Array<{
      basePath: string;
      endpointReaders: EndpointReader[];
    }> = [];
    for (const loaded of this.loadedModules) {
      if (loaded.readers.length === 0) continue;
      for (const [basePath, endpointReaders] of this.byBasePath(
        loaded.readers,
      )) {
        resolvedGroups.push({ basePath, endpointReaders });
      }
    }

    // Mount Swagger UI first so /<docsPath> doesn't get shadowed by a
    // module router that happens to share its prefix.
    if (this.swaggerConfig) {
      const generator = new OpenAPIGenerator();
      const spec = generator.generate({
        groups: resolvedGroups,
        info: this.swaggerConfig.info,
      });
      const docsPath = this.swaggerConfig.path;
      const jsonPath = docsPath.replace(/\/$/, '') + '.json';
      this.app.get(jsonPath, (_req, res) => {
        res.json(spec);
      });
      this.app.use(docsPath, swaggerUi.serve, swaggerUi.setup(spec));
    }

    // Create routes and attach handlers, once per group.
    //
    // The counter is global to the whole mount, not per module: what decides
    // which route answers is the order Express saw them in, across every
    // router. A per-module number would read as a map and be one.
    Logger.clear('router');
    Logger.router('[MAP] registration order; the first match answers');
    let order = 0;
    for (const { basePath, endpointReaders } of resolvedGroups) {
      const endpointReadersByGroup = this.groupEndpointReaders(endpointReaders);
      Object.entries(endpointReadersByGroup).forEach(
        ([group, groupReaders]) => {
          const options = groupReaders.map((endpointReader) => {
            const endpointHandler = new EndpointHandler(
              endpointReader,
              this.dbSource,
              this.container,
              this.authResolver,
              this.permissionRegistry,
              this.scheduler,
            );
            const option = new RouterOption(
              endpointReader.pathname,
              endpointReader.method,
            );
            // First, so the headers are set whatever answers: a `@Use` guard
            // that rejects, the DTO check, or `main()`.
            if (endpointReader.deprecated) {
              option.setHandler(endpointHandler.deprecation);
            }
            if (endpointReader.hasMiddleware()) {
              option.setHandler(endpointHandler.middleware);
            }
            if (endpointReader.hasSchema()) {
              option.setHandler(endpointHandler.schema);
            }
            option.setHandler(endpointHandler.main);
            order += 1;
            Logger.router(endpointReader, { order, basePath });
            return option;
          });
          this.router(path.join(basePath, group), options);
        },
      );
    }

    // 404 fallback: goes AFTER every router so it only catches what none of
    // them handled, and the error handler after that — Express only recognizes
    // one registered last.
    this.registerNotFoundHandler();
    this.registerErrorHandler();

    // Start the HTTP server
    const boundPort = await this.listen(port);

    // Only the ones that did not ask to stay stopped. The rest are registered
    // and addressable, waiting for `app.schedule(Token).start()`.
    this.scheduler?.startAll();

    this.registerShutdownHooks();

    // The one line somebody actually waits for. `order` is how many routes
    // mounted: ZERO here is the failure that used to look like a healthy boot,
    // where a glob matched nothing and the application served 404 to
    // everything while saying `Done!`.
    const routines = this.scheduler?.ids().length ?? 0;
    const ticking = this.scheduler?.scheduledCount() ?? 0;
    const serving = [
      count(order, 'route'),
      // A routine whose schedule is off is not a failure, but it is the
      // kind of thing somebody needs to see at a glance.
      routines === 0
        ? ''
        : `${count(routines, 'routine')}${
            ticking === routines ? '' : ` (${routines - ticking} stopped)`
          }`,
      this.swaggerConfig ? `docs at ${this.swaggerConfig.path}` : '',
    ].filter(Boolean);

    Logger.info(
      `Serving on :${boundPort} - ${serving.join(', ')}` +
        ` (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
    );
  };

  /**
   * Registers the final handler for unmatched routes, so a 404 responds with
   * the SAME error contract as the rest of the framework
   * (`{ message, response, errorFields, identifier }`) instead of Express's
   * default HTML.
   *
   * It is registered at the end of startup, so any route added by hand via
   * `getApp()` AFTER `start()` would sit behind this fallback and never be
   * reached: add those before starting.
   */
  /**
   * Maps anything a MIDDLEWARE throws to the same contract an endpoint answers.
   *
   * Without it Express falls back to its own handler, which replies with an
   * HTML stack page: a client that only knows samble's error shape gets
   * something it cannot parse, and the stack goes out with it. A rejected CORS
   * origin is the usual way to meet this, which is why it looked like samble was
   * missing CORS support rather than missing this.
   *
   * Four arguments and registered LAST — that is how Express tells an error
   * handler from an ordinary one.
   */
  private registerErrorHandler = () => {
    this.app.use(
      (error: unknown, _req: Request, res: Response, next: NextFunction) => {
        // Bytes are already on the wire (a file mid-transfer): only Express can
        // close that connection properly.
        if (res.headersSent) return next(error);

        new ErrorControl(error as ErrorType).send(res);
      },
    );
  };

  private registerNotFoundHandler = () => {
    this.app.use((req: Request, res: Response) => {
      new ErrorControl(
        new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`),
      ).send(res);
    });
  };

  /**
   * Registers SIGTERM/SIGINT handlers for an ordered shutdown.
   * Uses `process.once` so a second signal does not re-enter.
   */
  private registerShutdownHooks = () => {
    process.once('SIGTERM', () => void this.shutdown('SIGTERM'));
    process.once('SIGINT', () => void this.shutdown('SIGINT'));
  };

  /**
   * Ordered shutdown: stops the routines, stops accepting new requests and
   * waits for in-flight ones, closes the database connection and ends the
   * process. Safe against multiple calls.
   *
   * @param signal Signal or reason that triggered the shutdown (informational).
   */
  /**
   * Stops the application without ending the process: routines first, then
   * the HTTP server, then the database connection.
   *
   * `shutdown()` is the signal handler and exits the process, which makes it
   * unusable for a test or for anything embedding samble inside a larger
   * process. This is the same ordered stop, minus the exit.
   *
   * @param options `database: false` leaves the connection open, for when the
   * DataSource is owned by the caller and outlives the server.
   */
  public close = async (options: { database?: boolean } = {}) => {
    const { database = true } = options;

    // Marked HERE and not only in `shutdown()`: this is where draining
    // actually begins, and the health check reads it so a load balancer can
    // stop sending traffic before the server stops accepting it.
    this.shuttingDown = true;

    // Stop the schedules so nothing new starts.
    this.scheduler?.stopAll();

    try {
      await this.closeServer();
    } catch (error) {
      Logger.error('Error closing HTTP server', error);
    }

    if (database && this.ownsConnection) {
      try {
        await closeClient(this.dbSource.$client);
      } catch (error) {
        Logger.error('Error closing database connection', error);
      }
    }

    this.started = false;
  };

  public shutdown = async (signal: string = 'manual') => {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    Logger.info(`Shutting down (${signal})...`);

    // Safety net: if the ordered shutdown hangs (e.g. keep-alive connections),
    // force the exit so the restart is not blocked.
    const forceExit = setTimeout(() => {
      Logger.error('Shutdown timed out; forcing exit.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    await this.close();

    Logger.info('Shutdown complete.');
    // Exiting right after a log line loses it: the file appender writes
    // asynchronously, and this is the line somebody reads when a restart went
    // wrong.
    await Logger.flush();
    process.exit(0);
  };
}
