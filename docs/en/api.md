# The API, name by name

What an application writes: the 99 names you reach for, and what each one is
called. The reasoning lives in [the guide](./guide.md), the authorization rules
in [Authorization](./authorization.md), and the commands in
[the CLI](./cli.md).

The first four sections are enough to build something.

> Taken from the emitted `.d.ts` through the TypeScript API, so the signatures
> are what the compiler sees, shortened only where a generic default adds
> nothing.
>
> `samble` exports 41 more names — the module registry, the migrator, the loaders,
> the metadata the decorators store. They are public because the CLI is a
> separate process and has to reach them, not because an application needs them.
> They are in the types if you ever do.

---

## 1. Standing the application up

| Name | Type | What it is |
| --- | --- | --- |
| `Samble` | class | The application. Built by `Samble.create()`, never with `new`. |
| `Samble.create` | `(options: SambleOptions) => Promise<Samble>` | Resolves the modules, opens the database, reconciles what is installed, and hands back an application that has not started listening. |
| `SambleOptions` | interface | Everything an application decides: `db`, `modules`, `basePath`, `version`, `auth`, `cors`, `requestId`, `docs`, `health`, `logs`. |
| `DocsConfig` | interface | `{ path?, info? }` — where `/docs` answers and what the OpenAPI document says about itself. |
| `ConfigService` | class | The environment, with the failure in the right place. `.require(names)` goes first in `createApp()` and names EVERY missing variable; `.get(name)` throws when it is absent; `.number(name)` / `.boolean(name)` validate the format; `.optional(name)` returns `string \| undefined`; `.whichMissing(names)` reports without throwing; `.all()`, `.mode()`. An empty value counts as missing. |
| `ConfigError` | class | What `ConfigService` throws. Carries `names` with the variables involved, beside the message. |
| `MODE` | `'production' \| 'development'` | What `ConfigService.mode()` returns. |
| `openTestDatabase` | `(modules?) => Promise<Database>` | A fresh Postgres inside the process (PGlite), for `createApp({ db })` in a test. |
| `closeTestDatabase` | `(db: Database) => Promise<void>` | Closes what `openTestDatabase()` opened. samble does not close a connection it did not open. |

### What a `Samble` gives you

| Member | Type | What it does |
| --- | --- | --- |
| `start` | `(port: number) => Promise<void>` | Mounts routes, starts the routines, listens. |
| `close` | `(options?: { database?: boolean }) => Promise<void>` | Stops without ending the process: routines, then the server, then the connection. What a test calls. |
| `shutdown` | `(signal?: string) => Promise<void>` | `close()` and then exit. What a signal handler calls. |
| `connect` | `() => Promise<void>` | Opens the connection without mounting anything, for a command that only touches the database. |
| `migrate` | `(options?: { dryRun?: boolean }) => Promise<AppliedMigration[]>` | Runs every pending migration, per module, in dependency order. `dryRun` answers what WOULD run. |
| `migrationStatus` | `() => Promise<ModuleMigrationStatus[]>` | What each module declares and what of it already ran. |
| `pendingSchema` | `(moduleId, previous?) => Promise<SchemaDiff>` | The SQL one module needs to go from `previous` to what its code says. Needs no database. What `migration:generate` is built on. |
| `snapshotOf` | `(moduleId, previous?) => SchemaSnapshot` | What that module's tables describe now, to store beside the migration. |
| `schemaDrift` | `() => Promise<string[]>` | What the LIVE database is missing to match every module. The question snapshots cannot answer. |
| `tableOwners` | `() => Map<string, string>` | Which module owns each table, read off the tables each one declares. |
| `permissions` | `() => RegisteredPermission[]` | Every key the installed modules declare, with its module. The catalog a roles screen renders. |
| `getApp` | `() => Express` | The Express application, for anything samble does not wrap. |
| `use` | `(middleware) => void` | Adds middleware to that application. |
| `db` | `Database` (getter) | The connection samble opened or was handed, for what the app plugs in beside it — a session store over the same pool. `$client` is the driver's own object. |
| `static` | `(pathname: string, root: string) => void` | Serves a directory of files under a URL prefix. |
| `setTemplates` | `(engine: 'ejs' \| 'pug', root: string \| string[]) => Promise<void>` | Configures the engine `view()` renders with. |

---

## 2. What you write

Four base classes. A file exporting one is found by the folder it is in — see
[the standard layout](./cli.md#why-most-commands-edit-nothing).

| Name | Type | What it is |
| --- | --- | --- |
| `Endpoint<B, P, Q>` | class | One HTTP endpoint. Generics are the validated body, params and query. |
| `Routine` | class | Work on a clock. `@Cron` says which schedule it runs on, and when. |
| `Provider` | class | Answers a contract — exactly one. Marked with `@Provides`. |
| `Strategy` | class | Fills ANOTHER module's extension point, and that module runs it. Marked with `@Fills`. |
| `DataJson` | `Record<string, any> \| Response \| Output \| null` | What an endpoint's `main()` may return. |
| `UploadedFile` | interface | One file off a multipart request. samble's own type, not a global. |

### Inside an `Endpoint`

| Member | Type | What it is |
| --- | --- | --- |
| `main` | `() => DataJson \| Promise<DataJson>` | The endpoint. The one method you must write. |
| `previous` | `() => void \| Promise<void>` | Runs before `main`, on the same instance. |
| `body` `params` `query` | `B` `P` `Q` | Validated input. `null` unless a `@Body` / `@Params` / `@Query` schema says otherwise. |
| `auth` | `Auth` | Who is asking and what they may do. |
| `db` | `Database` | The connection, injected. |
| `container` | `Container` | Contracts other modules provide. |
| `scheduler` | `Scheduler` | For `this.schedule(Token)`: start, stop or run a schedule. |
| `file` / `files` | `UploadedFile` / `UploadedFile[]` or a map | Multipart uploads. |
| `request` / `response` | Express `Request` / `Response` | The raw pair, for what samble does not cover. |
| `httpStatus` | `HttpStatus` | Set it to answer something other than 200. |
| `requestId` | `string` | The id in the `x-request-id` header and in every log line of this request. |

`Routine` has `start(now: Date \| 'manual' \| 'init')` and a `Reaction<T>` has
`on(payload: T)`. All of them get `db`, `container` and `scheduler` the same way,
and all of them have `get()`, `all()` and `notify()`.

---

## 3. Decorators

| Name | Type | What it does |
| --- | --- | --- |
| `HttpGet` `HttpPost` `HttpPut` `HttpPatch` `HttpDelete` `HttpQuery` | `(path?: string) => ClassDecorator` | Method and path. Without a path the endpoint answers at its group's root. |
| `Group` | `(name: string, options?: GroupOptions) => ClassDecorator` | The URL segment before the path. Defaults to the module id, so the scaffold writes none. |
| `Priority` | `(number: number) => ClassDecorator` | Mount order, for a literal route a `:param` sibling would otherwise swallow. |
| `Use` | `(middleware: MiddlewareFn) => ClassDecorator` | Express middleware for this endpoint only. |
| `Body` `Params` `Query` | `(Schema: new () => object) => ClassDecorator` | Validates that part of the request against a class-validator DTO, and types it. |
| `Cron` | `(token: ScheduleToken, expression: string, options?: CronOptions) => ClassDecorator` | Which schedule a routine runs on, and when. `{ autostart: false }` registers it stopped. |
| `Provides` | `<T>(token: Contract<T>) => ClassDecorator` | The contract a provider answers. |
| `Fills` | `<T>(token: Slot<T>) => ClassDecorator` | The extension point a strategy fills. |
| `ApiTag` `ApiSummary` `ApiDescription` `ApiResponse` `ApiHidden` | class decorators | What `/docs` says about this endpoint, or that it says nothing. |
| `Deprecated` | `(options?: { sunset?, use?, note? }) => ClassDecorator` | Marks the route as going away WITHOUT taking it down: `deprecated: true` in the spec, `Deprecation` / `Sunset` / `Link` headers on every response, and one warning per route the first time it is called. |
| `MiddlewareFn` | `(req, res, next) => void` | What `@Use` takes. |
| `GroupOptions` | interface | What `@Group` takes besides the name. |

---

## 4. Modules, permissions and authorization

### Declaring a module

| Name | Type | What it is |
| --- | --- | --- |
| `defineModule` | `<const P>(manifest: ModuleManifest<P>) => ResolvedModule<PermissionKeysOf<P>>` | Declares a module and validates it at import time. The `const` parameter is what keeps the permission keys as literals. |
| `ModuleManifest<P>` | interface | What a module says about itself: `id`, `label`, `requires`, `dir`, `permissions`, `consumes` and the glob fields. |
| `ResolvedModule<K>` | interface | The manifest with every default applied. Also carries `permissionKeys: K[]`. |
| `ModulePermission<K>` | interface | `{ key, label? }`. The label is optional because a key usually says it. |
| `PermissionDeclaration<K>` | `K \| ModulePermission<K>` | One entry of `permissions`: a key, or a key with text. |
| `ModulePattern` | `string \| string[]` | A glob field's value. |
| `ModuleTable` | `PgTable \| PgEnum \| PgSequence \| PgView \| ...` | Something the module puts in the schema. An enum belongs in this list: without it, a table with an enum column generates DDL that references a type nothing creates. |
| `ModuleMigrations` | `Function[] \| Record<string, unknown>` | A list of migration classes, or a namespace import of them. |
| `ModuleDefinitionError` | class | Thrown by `defineModule` when the manifest is wrong. At import, before anything boots. |

### Teaching the compiler the keys

| Name | Type | What it is |
| --- | --- | --- |
| `PermissionsOf<M>` | conditional type | Reads a module's keys into the shape `SambleAuth.Permissions` wants. One `declare global` block per module. |
| `RegisteredPermission` | interface | `ModulePermission` plus the `moduleId` that declared it. What `app.permissions()` returns. |
| `PermissionKey` | conditional type | A declared key, or any string while an application has declared none. What `assert` and `can` take. |

### Turning a request into an actor

| Name | Type | What it is |
| --- | --- | --- |
| `defineAuth` | `(resolver: AuthResolver, ...fallbacks: AuthResolver[]) => AuthResolver` | The `auth` resolver. Several strategies are tried in order, first one to recognize the caller wins. |
| `cacheAuth` | `(resolver: AuthResolver, options: AuthCacheOptions) => CachedAuthResolver` | Remembers the answer per caller. Trades freshness for the lookup, so `ttl` is required. |
| `AuthCacheOptions` | interface | `{ key, ttl, max? }`. The key is the application's: which part of a request is the credential is what the resolver hides. |
| `CachedAuthResolver` | `AuthResolver & { invalidate(key), clear() }` | `invalidate` is not optional — the TTL is the floor, not the contract. |
| `AuthResolver` | `(request, context) => AuthResult \| null \| undefined \| Promise<…>` | The seam. `null` means anonymous. |
| `AuthResult` | interface | `{ actor, permissions? }`. |
| `AuthContext` | interface | `{ db, get }` — what a resolver gets besides the request. |
| `Actor` | `SambleAuth.Actor` | Whoever is calling, as the application declared it. Empty until it does. |
| `Auth` | class | `this.auth`: `isAuthenticated`, `optional`, `actor`, `permissions`, `can(...)`, `assert(...)`. `actor` and `assert` throw; `optional` and `can` do not. |

---

## 5. Wiring between modules

| Name | Type | What it is |
| --- | --- | --- |
| `token` | `<T>(id, kind) => Contract<T> \| Slot<T> \| ScheduleToken` | Declares the one thing two modules share. The kind you pass decides which type comes back. |
| `TokenKind` | `'contract' \| 'slot' \| 'schedule'` | Which relationship it is. It lives on the token and nowhere else. |
| `Contract<T>` | interface | A capability with exactly one provider: `token(id, 'contract')`. |
| `Slot<T>` | interface | An extension point filled by however many modules are installed: `token(id, 'slot')`. `container.all()` answers an array, and empty is a normal answer. |
| `Reaction<T>` | interface | The shape of a contribution when the host **announces** rather than asks: one `on(payload)`. It is what `notify()` takes. |
| `ScheduleToken` | interface | A clock that can be started and stopped: `token(id, 'schedule')`. It carries no type, because nothing is handed over. |
| `Container` | class | Resolves them: `.get(contract)`, `.all(slot)`, `.notify(slot, payload)`, `.has()`, `.providerOf()`, `.ids()`. Reachable as `this.container`. |
| `ContractError` | class | Nobody provides that contract, two modules do, or a reaction tried to announce something. |
| `Scheduler` | class | `.handle(token)`, `.startAll()`, `.stopAll()`, `.ids()`. Reachable as `app.schedule(token)` or `this.schedule(token)`. |
| `ScheduleHandle` | interface | `.start()`, `.stop()`, `.isScheduled()`, `.isExecuting()`, `.runNow()`. |
| `ScheduleError` | class | No such schedule, or two classes claim it. |

---

## 6. Answering with something other than JSON

| Name | Type | What it is |
| --- | --- | --- |
| `view` | `(template: string, data?: object) => Output` | Renders a template with the engine `setTemplates` configured. |
| `pdf` | `(content: Buffer \| Uint8Array \| Readable, options?: PdfOptions) => Output` | Sends a PDF, inline or as a download. |
| `csv` | `(rows: readonly object[], options?: CsvOptions) => Output` | Turns rows into a CSV, with the columns you name. |
| `file` | `(content: FileContent, options?: FileOptions) => Output` | Any file: bytes, a string or a stream. |
| `Output` | abstract class | What all four return, and what `main()` may hand back. Extend it for a format samble does not have. |
| `FileContent` | `Buffer \| Uint8Array \| string \| Readable` | What `file()` accepts. |
| `FileOptions` `PdfOptions` `CsvOptions` `CsvColumn` | interfaces / types | Filename, download or inline, content type; and for CSV, the columns and their headers. |

---

## 7. Failing

Throw one of these anywhere and the framework answers the right status, in one
shape — RFC 9457 `application/problem+json`. All six extend `Error`.

| Name | Type | Answers |
| --- | --- | --- |
| `SchemaError<T>` | `(message, fieldsError?)` | 422, with which field is at fault. |
| `CustomerError<T>` | `(message, fieldsError?)` | 406 — the request is understood and refused. |
| `NotFoundError` | `(message)` | 404. |
| `AuthError` | `(message)` | 401 — authenticate and try again. |
| `ForbiddenError` | `(message, missing?)` | 403 — do not bother. `missing` names the keys and reaches the client. |
| `CustomError` | `(status, message, response?)` | Whatever status you pass, with a payload. |
| `ProblemBody` | interface | The body: `type`, `title`, `status`, `detail`, `code`, `errors`, `requestId?`, `missing?`, `response?`. |
| `ErrorIdentifier` | enum | The machine-readable `code`. Branch on this, not on `title`. |
| `HttpStatus` | enum | The status codes, by name. |

---

## 8. Logs, health, CORS, docs

| Name | Type | What it is |
| --- | --- | --- |
| `Logger` | class | `.info()`, `.warn()`, `.error()`, `.router()`, `.configure()`, `.flush()`, `.clear(category)`. Writes to `logs/` by file and level. |
| `LoggerOptions` | interface | `{ dir?, level?, files? }` — where the logs go, and which to turn off. |
| `LogFiles` | interface | The five files (`app`, `info`, `warn`, `error`, `router`), each renameable or `false`. |
| `HealthConfig` | interface | `{ path?, details?, checks?, timeout? }`. Without it there is no `/health` route at all. |
| `HealthCheck` | `() => boolean \| Promise<boolean>` | One check the application owns. Named anything except `server` and `database`. |
| `HealthReport` | interface | What `/health` answers. |
| `HealthStatus` | `'pass' \| 'fail'` | Per check, and overall. |
| `RequestIdConfig` | interface | `{ header?, generate? }` — trust an incoming id, or make one. |
| `currentRequestId` | `() => string` | The id of the request being handled, from anywhere in the call stack. |
| `CorsConfig` | interface | Origins, methods, headers, credentials. |
| `CorsConfigError` | class | The CORS options contradict themselves, refused at boot. |
| `OpenAPIInfo` | interface | The title and version `/docs` reports, passed as `docs.info`. |

---

## Not exported, on purpose

`SambleAuth` is a **global namespace**, not an export: an interface re-exported
from a package cannot be merged from outside, and merging is the whole point. An
application widens `SambleAuth.Actor` and `SambleAuth.Permissions` with
`declare global`, which is what `src/config/auth.ts` and
`src/config/permissions.ts` are for.
