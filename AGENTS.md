# AGENTS.md

Guidance for coding agents working in this repository. It covers **samble only**;
nothing here is about whatever consumes it.

## Versioning

Published under the `alpha` dist-tag until 1.0.0; `latest` is reserved for the
stable line. `scripts/publish-guard.js` refuses anything else.

## What this repo is

`samble` is a lightweight NestJS-inspired backend framework published to npm. It
is **not** an application. Dual layout:

- **`lib/`** — the published framework. This is what ships (`dist/` + `types/`).
  **Edit here.**
- **`src/`** — a sample app that dogfoods the framework (`npm run dev`). It
  imports `lib/` by relative path, never by package name. Not published.
  Three modules — `identity` and `catalog` own tables, `reports` owns none and
  is the one shaped like an extension — with per-module migrations.
  **`test/demo-app.spec.ts` boots it against PGlite** — keep it that way. The
  previous demo had rotted unnoticed: `@Priority` was backwards so the literal
  route resolved to `:id`, and the endpoint rendering a page could never do it
  because nothing called `setTemplates`. Both were invisible without a test.
  `http/demo.http` is the request-by-request walkthrough.
- **`test/`** — jest suite. Not published.

- **`bin/` + `lib/cli/`** — the CLI (`npx samble init`, `samble module ...`,
  `samble migrate`, `samble build`). Its templates are **TypeScript strings inside the build**
  (loose `.txt` assets nobody compiles drift until they generate decorators the
  framework no longer has), and `test/cli.spec.ts` scaffolds a
  module and BOOTS it against PGlite. If a template stops matching the
  framework, the suite fails. **Do not turn the templates back into assets.**

- **`README.md`** is the short version, on purpose; **`docs/en/guide.md`** is the
  long one. Only the README ships in the tarball (`files`). Put the reasoning in
  the guide, not in the README.

- **`docs/` is split by language**: `docs/en/` is the source, `docs/es/` is the
  translation, and `docs/README.md` is the index. `docs/es/wiring.md` (contracts and
  slots) and `docs/es/openapi.md` (the generated spec) are **Spanish only
  for now**, on the author's call; their English pages are owed. **English is what matches the code** — change it first, then bring the
  Spanish page across in the same commit. Code, identifiers and the framework's
  own JSDoc stay English on both sides; only the prose is translated.

- **`docs/*/api.md` lists what an APPLICATION writes** — 101 of the 161 exports.
  The other 60 are the module registry, the migrator, the loaders and the
  decorators' metadata: public because the CLI is a separate process, and left
  out on purpose so the page is a working reference and not a dump. It is also
  the one doc that can go stale silently, since adding a name to `lib/index.ts`
  fails nothing. Regenerate the list from the emitted `.d.ts` through the
  TypeScript API rather than reading the diff, and decide which side of the line
  a new name falls on.

Comments and JSDoc are in **English**: they ship inside the `.d.ts`.

The CLI's generators are **pure**: they return a plan (`files`, `edits`,
`hints`) and the writer is the only part that touches disk, which is what makes
the templates testable. `applyEdit()` returns `null` rather than guessing when
a file does not look the way the edit expects — a manifest somebody rewrote by
hand gets an instruction, not a mangled file.

`samble migrate` / `migrate:status` load the application through
`lib/cli/app-loader.ts`, which requires the project's entry point and calls its
exported `createApp()`. That is the ONLY way the CLI reaches a database, and it
is why every entry template separates `createApp()` from `main()` behind
`if (require.main === module)`. `Samble.migrate()` and `start()` share
`prepareModules()`: two definitions of "which modules count" would migrate a
set nobody runs.

`tsconfig.json` maps `samble` -> `lib` (`paths`) and `jest.config.ts` maps it at
runtime (`moduleNameMapper`), so generated code can import `'@samble/core'` like a
consumer does and still be type-checked here. In `test/cli.spec.ts`, **do not
call `jest.resetModules()` before requiring a generated manifest**: a fresh
registry gives it a different `Endpoint` class, `instanceof` fails in the
loader, and zero routes mount.

## Commands

```bash
npm run dev     # nodemon → ts-node ./src/index.ts (the demo runs on PostgreSQL)
npm run build   # clears dist/ + types/, then tsc -p tsconfig.build.json
npm run clear   # rimraf ./dist ./types
npm test        # jest, with --experimental-vm-modules (PGlite needs it)
                # SAMBLE_TEST_MYSQL_URL=mysql://root@localhost:3306 npm test
                # also runs the MySQL column of test/dialects.spec.ts
npm run lint    # eslint . --ext .ts  (formatting included, see below)
npm run lint:fix
npm run format  # prettier --write .  (json, css, html too)
npm pack        # tarball, to install into a consumer project
```

Single file: `npx jest test/<file>.spec.ts`. Single test: `npx jest -t "name"`.

**One config, four files, no overlap.** `.editorconfig` is the shape of a file
for any editor; `.prettierrc` repeats the same values for the formatter;
`eslint.config.mjs` says what the code MEANS and leaves formatting alone;
`.gitattributes` pins the working tree to LF, which keeps a Windows checkout
from making the formatter want to rewrite every line of half the repo.

**Prettier does not run as an ESLint rule**, which is Prettier's own
recommendation: as a rule it is slower, fills the editor with squiggles over
things that fix themselves on save, and adds a layer that can break. So
`npm run lint` does NOT cover formatting — `npm run format:check` does, and both
run in CI. `eslint-config-prettier` goes last in the config, because it works by
turning the conflicting rules off.

This file and the `eslint.config.mjs` that `samble init` writes are deliberately
the same shape. A framework whose own tooling disagrees with what it generates
teaches the wrong thing twice.

Type-aware rules are on (`projectService: true`), which is what pays for
`no-floating-promises` — a promise nobody awaited is work that silently did not
happen, in somebody else's request. `require()` is allowed only in the files
that load the application's own files by path at run time, which is the one
thing an `import` cannot do.

`tsconfig.json` includes `./test`, so the specs are typechecked by
`npx tsc --noEmit` and ESLint can read types in them.

`npm run build` **clears first on purpose**. Without it the tarball kept files
from deleted modules, and a consumer could deep-import code no longer in the
source.

Node **>=20**.

## Architecture

### Boot, in order

`Samble.create(options)` builds the DataSource; `start(port)` runs the cycle. The
order is not incidental — each step depends on the one before:

1. **DataSource** — built with the tables of **every module present in the
   code**, then initialized. An already-initialized DataSource is adopted rather
   than re-initialized.
2. **`_modules`** — `ModuleStore.sync()` reconciles code against what the
   installation recorded: what to install, and what is recorded but gone.
3. **Resolve** — `resolveModules()` orders the graph by dependency and refuses
   duplicate ids, missing dependencies and cycles.
4. **Migrate** — `ModuleMigrator.run()`, per module, in that order.
5. **Contracts** — `buildContainer()` registers what modules provide and refuses
   a consumed contract nobody provides.
6. **Mount** — routes and tasks. Then `listen`.

Any failure in 2–5 aborts the boot. Serving half-mounted is worse than not
starting.

### Modules are the only way in

`Samble.create()` is the sole entry point — the constructor and `useModules()`
are private — and there is no glob-mounting API. `setApis`/`addApis`/`setTasks`
were removed: they let an application define routes outside any module, which
made the manifest optional and the module system a second-class path. The
consequence is deliberate: **anything that serves a request lives in a module**,
so a route can always be traced to something named, versioned and declared.

Practical fallout for tests: a route-level test needs a real database now,
because booting modules touches `_modules`. Use the PGlite harness. That is a
feature — those tests exercise the path consumers actually use.

### Module globs are extension-agnostic (and node_modules-safe)

`withModuleExtensions()` rewrites `./endpoints/*.endpoint.ts` to
`./endpoints/*.endpoint.{ts,js,cjs,mjs,jsc}`, and `pickOneFilePerModule()` keeps one file
per name (`.ts` wins, `.jsc` loses to anything readable) and drops `*.d.ts`.

Why it matters: `dir` is `__dirname`, so after `tsc` it points at the build,
where nothing ends in `.ts`. The old literal glob found zero files, samble logged
one warning and started **serving 404 to everything** — a deployment that looks
alive. The same thing blocked a module published as a package, which only ever
ships `.js`.

The `node_modules` ignore is **anchored to the module's `dir`**, not global: a
module installed as a package lives under `node_modules`, and an unanchored
ignore of that name matches none of its files.

`.jsc` is V8 bytecode (bytenode). samble **loads** it and nothing more: no
dependency on bytenode, no compilation step. The application calls
`require('bytenode')` before `start()`, because what a `.jsc` is depends on the
Node build that produced it — a `.jsc` from another version is rejected with
`Invalid or incompatible cached data`. Verified end to end by `npm run demo:bytecode`
(`scripts/bytecode/run.js`): the whole demo under `src/` compiled to 38 `.jsc`
files with no `.js` beside them boots, mounts the same 11 routes in the same
order, and answers JSON, a pug page and a CSV. **It cannot be a jest test** —
jest's runtime intercepts `require`, so bytenode's `Module._extensions['.jsc']`
never runs and the file is parsed as text; jest covers the glob and the
preference order instead.
Without `.jsc` in the list it installed, migrated, registered contracts and
served **404 to everything** — the same failure the `.ts`→`.js` fix cured.
Packaging and licensing stay OUT of samble: MIT framework, product problem.

### Module system (`lib/modules/`)

| File | Responsibility |
| --- | --- |
| `module-manifest.ts` | Types + `ModuleDefinitionError` |
| `define-module.ts` | Declares a module; validates what it knows alone |
| `resolve-modules.ts` | Graph: order and cycles |
| `reconcile-modules.ts` | Code vs. recorded state (**pure**) |
| `module-store.ts` | `_modules` I/O |
| `module-migrator.ts` | Per-module migrations + `_module_migrations` |
| `module-loader.ts` | Reads endpoints/tasks from a module's globs, any extension |
| `container.ts` / `build-container.ts` | Contracts (`register`) and slot contributions (`contribute`) |
| `schedules.ts` | `token(id, 'schedule')`, the `Scheduler` and a routine's lifecycle |
| `slots.ts` | Extension points: `token(id, 'slot')`, filled by a `Strategy` |
| `permissions.ts` | Registry of what the modules declare |
| `collect-tables.ts` | Union of every module's tables, as one schema |

Decisions that are easy to undo by accident, so do not:

- **There is no enable/disable, and that is a decision.** Every module present in the code runs, and what limits who
  reaches what is permissions — a role, a plan — which is the application's
  policy. Deciding it twice, once by deployment and once by permission, is how
  an installation reaches a state nobody can explain. The four lifecycle hooks
  (`onInstall`, `onEnable`, `onDisable`, `onUninstall`) went with it: they were
  declared, typed and documented, and **nothing ever called them**.
- **A module does not declare a host range: `engine` was removed.** The modules ARE the application — same repository, released
  together — so a folder pinning which versions of its own repository it
  supports is a constraint that cannot fail. The scaffold proved it: the
  generator wrote `engine: '^1.0.0'` while `samble init` wrote the app at
  `1.0.0`. It was conditional on top of that: `version` is optional in
  `Samble.create()`, and without it the check was skipped in silence. `version`
  survives with one consumer, `/health`; a module's own `version` survives for
  the `_modules` ledger, which compares it to detect an upgrade or a downgrade.
  Host compatibility belongs to the extension design, for the day a module
  actually travels — do not reintroduce it before then.
- **A module has no version of its own, removed right after `engine`.** Nothing ever compared it — not against another module, not
  against the application — but a per-module semver reads as "separate packages,
  compatible only when the numbers agree", which is the opposite of what a module
  is here. Its one real product was the boot warning that a deploy had gone
  BACKWARDS, and with every manifest at `1.0.0` forever that warning could not
  fire. `_modules` records PRESENCE: `ModuleState` is `{ id }`, and
  `reconcileModules()` answers what to install and what is recorded but gone.
  `ensureTable()` runs `alter table _modules drop column if exists version`
  because the old column was `not null` with NO default, so leaving it would
  break the next module's insert — on a deploy, not on the upgrade. That ALTER is
  deliberate and covered by a test; do not "clean it up".
- **`@Deprecated` marks a route; it never stops answering.** The sunset date is
  a promise published in a header and in the spec, not a switch — samble must not
  start refusing the route when the day arrives, because when to delete it is the
  application's decision. Its warning fires ONCE per route per process, not per
  request: the question is whether the caller still exists, and a line per request
  would bury the log while the access log already has the volume. The handler is
  registered BEFORE the middleware and the DTO check, so the headers are set on a
  422 too. And it is not `@ApiHidden`: hiding the old version removes the one
  place a client could read which version to move to.
- **Configuration fails at boot, by name, all at once.** `ConfigService.get()`
  used to be typed `string` and return `undefined`, so a missing variable reached
  a driver or became `NaN` at a port, and the failure surfaced as something else
  entirely. Three rules hold this together and each one is load-bearing: an EMPTY
  value counts as missing (`KEY=` is an unedited template, not a decision);
  `require()` reports EVERY missing variable rather than the first, because the
  person filling in a `.env` on a server wants one list; and a module declares its
  own in the MANIFEST, not in its code, so "what does this module need?" is
  answerable without running anything. The module check runs BEFORE the database
  opens — if the credentials are what is missing, naming the variable beats an
  `ECONNREFUSED`.
- **Nothing samble scaffolds may read the environment at module level.** That
  happens on import, which is before `createApp()` and therefore before
  `require()` can report anything. The scaffolded session is a FUNCTION for this
  reason alone; do not "simplify" it back into a top-level call.
- **`samble doctor` changes nothing, and a dependent check reports SKIPPED.** It
  runs inside install scripts, so it must stay side-effect free and keep exiting
  non-zero on a failure. When a check fails, the ones that needed it are
  `skipped`, never passed: "we did not get to ask" is not "it is fine" — the same
  distinction a license client has to make about a network it could not reach.
  Pending migrations are a WARNING, because on a fresh install that is the normal
  state. It identifies a `ConfigError` by `name` and not only by `instanceof`,
  because the application and the CLI are not always the same copy of the module
  (npm link, a monorepo, source beside a build) — found by running it, not by
  reasoning.
- **An ENUM is collected like a table.** A table with an enum column emits DDL
  that references the type, so a schema without the enum generates a migration
  that fails when it runs. Measured, not assumed.
- **Migrations order by module first**, by timestamp only *within* a module. An
  ORM's runner sorts globally, so an older module would migrate before the
  dependency it needs. Stamps compare as **numbers** (`"9000"` sorts after
  `"10000"` as text).
- **A module whose code vanished is reported, never deleted.**
- **A slot accepts many contributions; a contract refuses a second provider.**
  That asymmetry IS the difference between them. Do not "fix" either one.
- **A contract and a slot are answered by different classes, on purpose.**
  `@Provides` on a `Provider` in `providers/` answers a contract this module
  owns; `@Fills` on a `Strategy` in `strategies/` implements another module's
  domain interface, which that module runs. One decorator for both would mean that a diff could not tell them apart without
  opening the token's file — while the consequences differ, starting with whose
  request dies when the class throws. Each decorator now refuses the other's
  token and names the three things to change.
- **The module that opens a slot must not depend on its contributors.**
  Extensions import the host's token, never the reverse — otherwise core
  depends on its own extensions and none can be removed.
- **An undeclared permission key throws a plain `Error` (500), not a 403.** A
  key that exists nowhere is a mistake in the code; answering 403 would send
  whoever debugs it to look at roles and grants instead of at the typo. The
  check runs BEFORE the 401 for the same reason: in development the first
  request is usually anonymous, which is exactly when the author should hear
  about it.
- **The registry is built from every module present in the code** — like
  tables. A key exists because a manifest declares it.
- **`this.get(Token)`, not a free `inject()`.** Resolving without an explicit
  receiver needs a process-wide container, and two apps in one process would see
  each other's implementations. The container is per application.
- **Framework tables are queried directly**, not through a repository. Depending
  on an entity would force every consumer to register an internal class.

### Discovery and per-request state (both lines)

No central registration: files are found by **glob**, `require()`d, and every
export that extends the base class is introspected via `reflect-metadata`.
Anything else is ignored — `Reflect.getMetadata` throws on a primitive.

`EndpointHandler` injects `db` and `container` on the **prototype** (stable,
available in field initializers) and the request state (`params`, `body`,
`query`, …) on the **instance**, after `new`. With everything on the prototype,
two concurrent requests to the same endpoint overwrote each other. There is a
regression test for it. **Do not revert to prototype-wide state.**

Consequence: request state is **not** readable in constructors or field
initializers. Only `db` and `container` are.

`auth` follows the same rule and for the same reason: it is resolved per request
and assigned on the **instance**. There is a regression test with two concurrent
callers whose actors must not cross.

### Auth seam

`lib/core/auth.ts`. One `AuthResolver` (`SambleOptions.auth`) turns a request
plus an `AuthContext` (`{ db, get }`) into `{ actor, permissions }`; endpoints
read `this.auth`.

- `Actor` is declared **empty** in a `declare global { namespace SambleAuth }`
  block. An interface re-exported from the package entry cannot be merged from
  outside, so a global namespace is the only shape a consumer can widen. Do not
  "tidy" it into a plain exported interface — augmentation silently stops
  merging and apps get `{}`.
- The framework deliberately does not define `userId`: baking one actor shape in
  is exactly what makes a `getSession('userId')` API impossible to move off.
- Resolution happens **inside** the handler's `try`, so a resolver that throws on
  a bad credential becomes a 401 instead of an unhandled rejection.
- `Auth` carries a `configured` flag so "no resolver wired" (a bug, 500) reads
  differently from "nobody is signed in" (a 401).
- The resolver gets `{ db, get }` because without it an app whose permissions
  live in the database had to close over an imported DataSource singleton — the
  exact global the container exists to avoid — or freeze them into the session
  at login. The context is built **once per handler**, not per request: the
  DataSource and container are stable, only the request changes.

### Answers that are not JSON (`lib/outputs/`)

`main()` returns data and samble serializes it; returning an `Output` instead
(`view`, `pdf`, `csv`, `file`) writes the response itself. The handler checks
`instanceof Output` after `headersSent`, applies `httpStatus`, and `await`s
`send()`.

- It replaced `@Template`, which decided at **boot** from class metadata: an
  endpoint was a view forever, could not branch to JSON, and PDF/CSV had nothing
  to use. **Do not reintroduce a per-format decorator** — the format depends on
  the request, and only `main()` sees it.
- `view()` renders with the **callback** form on purpose. `res.render(path, data)`
  hands a broken template to Express's error handler, which answers a stack in
  HTML and bypasses samble's error contract entirely.
- A stream that breaks mid-transfer destroys the response. Bytes are already on
  the wire, so `headersSent` is what stops the catch from writing a JSON error
  into the middle of a file the client is still downloading.
- `csv(rows)` and `view(tpl, data)` take `object`, not `Record<string, unknown>`:
  a row may come back as a class with no index signature, so the stricter type
  forced a cast at every call site. There is a test for it.
- Endpoints that relied on `@Template` to stay out of the OpenAPI spec now say
  `@ApiHidden()`.

### The route map (`router` log)

`Logger.router(reader, { order, basePath })`, numbered with a counter that is
**global to the whole mount**, not per module: what decides which route answers
is the order Express saw them in, across every router. A per-module number would
read like a map and not be one. `p1`/`auto` shows the `@Priority` behind the
position. `@Priority` stays: it is optional, and it exists exactly for literal
routes that would otherwise be swallowed by a `:param` sibling.

### Errors

`ErrorControl` maps `SchemaError` (422), `CustomerError` (406), `NotFoundError`
(404), `AuthError` (401), `ForbiddenError` (403), `CustomError` (free status) and
a native `Error` (500). The `ForbiddenError` branch must stay **above** the
generic-object branch, which also answers 403 but echoes the raw object back.
The 404 fallback reuses `NotFoundError`, so an unmatched route answers with the
same contract.

## Testing

`test/helpers/test-db.ts` runs **real Postgres in-process** via PGlite — no
Docker. Dialect differences SQLite would hide behave as in production.

`drizzle-orm/pglite` takes a PGlite instance directly, and the helper keeps ONE
per test file — jest gives each file its own module registry. Isolation comes
from dropping and recreating the `public` schema. Create the database **once per
file** (`beforeAll`) and reset between cases (`beforeEach`): that took the
migrator suite from 28s to 3s.

**Never assert on a `pgTable`.** A failing `expect` that holds one crashes
jest-worker with "Converting circular structure to JSON", and the crash HIDES the
real failures: the run reports the suite as "failed to run" while claiming every
test passed. Assert on `getTableName(table)`.

Jest runs with `--experimental-vm-modules` (PGlite uses dynamic imports). Import
globals from `@jest/globals` — there is no `@types/jest`. ts-jest only, never
babel-jest: it breaks `emitDecoratorMetadata`.

`tsc -p tsconfig.json` does **not** cover `test/`. A broken import in a spec is
only caught by running jest.

Pure rules are exported and tested without a database: `reconcileModules`,
`orderMigrations`, `resolveModules`, `toEndpointReaders`, `collectModuleTables`.
Keep that split — the decision is the part worth testing.

## Build and release

- `tsconfig.build.json`: `rootDir: "."` (keeps the `dist/lib` layout; without it
  tsc infers `lib/` as root and `main` fails to resolve) and `incremental: false`
  (a stale `.tsbuildinfo` with a cleared `dist/` made tsc emit nothing).
- `removeComments: false` → comments ship. Hence the English rule.
- Peer deps, not bundled: `drizzle-orm`, `express`,
  `class-validator`, `typescript`. `reflect-metadata` and `semver` are direct.
  `drizzle-kit` is an OPTIONAL peer, required lazily: it pulls in esbuild and tsx
  and only `migration:generate` needs it.
- Not published yet. To test in a consumer: `npm run build && npm pack`, then
  install the `.tgz`. A tarball is closer to what npm installs than `npm link`,
  which resolves through symlinks and hides a bad `files` entry.

## Dialects (`lib/dialects/`)

Decided 2026-10-02, the author's call: **the database engine is the operator's
choice**, and nobody installs a driver for an engine they do not run. One
`Dialect` per engine (`postgres.ts`, `mysql.ts`, `sqlite.ts`) implements
everything that differs: opening the connection, recognizing schema objects,
running a statement and reading rows, `tableExists`, the DDL of `_modules` and
`_module_migrations`, Drizzle Kit's schema functions, the statement method of a
migration and the test database.

Rules that are easy to break, so do not:

- **Nothing outside `lib/dialects/` branches on the engine's name.** If a new
  engine needs something the interface does not say, the interface grows. The
  only exceptions are the CLI templates (`init`, the table and migration
  generators), which WRITE engine-specific code and are data-driven
  (`ENGINES`, `TABLE_SHAPES`) for that reason.
- **The dialect is read off the connection** (`dialectOf(db)`, Drizzle's `is()`
  on the database class), never stored beside it. Options carry `dialect`; a
  connection handed in already IS one. `is()` compares entity kinds, so it holds
  across copies of `drizzle-orm`.
- **Drivers are required lazily** (`requireDriver`), checked by NAME first so
  the error says `npm install mysql2` instead of a stack from inside Drizzle.
- **`this.db` is typed by a global declaration**, `SambleDatabase.Config`, for
  the same reason `SambleAuth` is global: an exported interface cannot be merged
  from outside. `Transaction = DatabaseOf[SelectedDialect]`; empty means
  Postgres. Inside this repo it is Postgres, so code here that touches a MySQL
  or SQLite connection goes through the dialect, never through `db.execute`.
- **`define-module` collects schema objects of EVERY engine** — it runs before
  anyone knows the engine — and `Samble.create()` refuses a mismatch by module
  and engine name (`assertModulesMatch`).
- **SQLite is libsql, not better-sqlite3**: Drizzle's better-sqlite3 transactions
  are synchronous and every samble transaction awaits. Its test database is
  `:memory:` — measured: libsql shares it with its transactions, and a temp
  FILE cannot be deleted on Windows because libsql keeps it locked after
  `close()`.
- **MySQL tests need a server.** `openTest` creates `samble_test_<random>` on
  `SAMBLE_TEST_MYSQL_URL` and drops it on close; it never touches anything else
  there. MySQL DDL commits implicitly, so a migration is not atomic there — said
  in the guide, not hidden.
- **MariaDB refuses `serial AUTO_INCREMENT`**, which is how Drizzle Kit writes a
  MySQL `serial()`. Templates and fixtures use `int().autoincrement()`.
- **Live drift is Postgres-only.** `pushSchema` takes a `tablesFilter` there and
  samble passes the modules' tables — WITHOUT it, Drizzle Kit compared the whole
  database, reported `_modules` as drift, and on `_module_migrations` (composite
  key) or any unknown table stopped to ask "renamed?" and called
  `process.exit(1)` with no terminal. That was a latent bug on Postgres too,
  found by `dialects.spec.ts`. MySQL/SQLite push takes no filter, so `drift`
  throws a clear error there. `withoutExit` turns any Drizzle Kit exit into an
  error: a library must not end the process.

`test/dialects.spec.ts` takes the same module through every engine — tables,
a GENERATED migration, migrate, routes, a rolled-back transaction, drift — and
uses its own folder (`test/.generated-dialects`): `cli.spec.ts` empties
`test/.generated` on start, and the two run in parallel workers. That race made
the suite flaky until it moved.

## Sessions are the application's; tests are samble's

**Sessions.** Putting them in a database used to mean a store package that
wanted its own pool, so the application opened a connection beside samble's,
built the drizzle instance itself and took the schema out of samble's hands —
and a module ended up owning a `sessions` table that is infrastructure, not
domain. A samble-owned store was built and then REMOVED (2026-10-02, author's
call): where sessions live depends on the engine, and the engine is the
operator's choice — samble must neither impose one nor make anybody install a
package for an engine they do not run. What samble gives instead is
`app.db` (a getter over `dbSource`): the store the application picks is built
over `app.db.$client`, the same pool. The demo does exactly that with
`connect-pg-simple`. The scaffold's `buildSession(store?)` stays engine-neutral
and documents the pattern.

**Tests.** An application had no sanctioned way to boot itself on a test
database, so it invented one. `openTestDatabase()` / `closeTestDatabase()`
(`lib/modules/test-database.ts`) open PGlite and hand it to the SAME
`createApp()` the deployment runs: the scaffold's `createApp(db =
databaseFromEnv())` takes the database as its argument, and `databaseFromEnv()`
(`src/config/database.ts`) requires the `DB_*` variables where it reads them,
so a test that hands in its own needs none. A DEFAULT and not a required
argument because the CLI (`app-loader.ts`) calls `createApp()` bare; an
optional `{ db }` bag was tried first and read as noise — nobody could tell
what it was for, and it forced `options.db ? … : …` on the required list. `await client.waitReady` is
load-bearing: a test that failed before its first query closed PGlite mid-load,
after jest had torn the environment down. `samble init` writes
`test/app.spec.ts`, `test/tsconfig.json` (so the type-aware lint reads tests
while the root keeps `rootDir: src`) and the jest config INSIDE `package.json` —
a `jest.config.ts` at the root belongs to no tsconfig and the linter refuses it.
Per engine since the dialects: PGlite, SQLite in memory, or a MySQL server.

`test/cli.spec.ts` boots the generated `createApp(db)` on
`openTestDatabase()` with NO `.env`. That test is what caught the scaffold
reading `CORS_ORIGIN` with `get()` (which throws) instead of `optional()`.

## The two ways modules meet

Keep them distinct; collapsing them is the easiest way to ruin this design.

| | Answers | Who runs it | Whose failure it is |
| --- | --- | --- | --- |
| `contract` / `get` / `@Provides` on a `Provider` | exactly one; a second is refused | the caller, waiting for the answer | the caller's |
| `slot` / `all` / `@Fills` on a `Strategy` | however many are deployed | the host, using what they return | the host's |
| the same slot / `notify` / the same `Strategy` typed `Reaction<T>` | however many are deployed | the host, discarding the answers | **theirs**, logged |

`Contract` and `Slot` each carry a `kind` literal so neither can be passed where
the other goes. They are otherwise structurally identical, and that one
confusion is the one that matters: one provider versus many.

- **There was a third kind, `'event'`, and it was removed
  because it was a slot plus one guarantee.** The bus, `Listener` and `@On` added
  exactly this: a contributor's failure cannot become the caller's. Everything
  else was identical, and "returns nothing" is a `void` signature. The guarantee
  became the verb — `notify()` instead of `all()` — and the 259 lines of bus went
  away. samble never emitted an event itself, which is the evidence that settled
  it. Do not reintroduce a parallel mechanism for this; if a DURABLE one is ever
  needed — persisted, retried, surviving the process and the replica — that is an
  outbox, a different thing, and it gets its own name.
- **`notify()` guarantees two things that cost real code**, so do not simplify
  them away. Each reaction runs inside an `async` wrapper, because
  `Promise.allSettled` only catches a REJECTED promise and a synchronous throw
  would otherwise escape the mapper and fail the announcer — defeating the one
  reason the method exists. And the no-cascade guard is scoped with
  `AsyncLocalStorage`, not a shared `Set`, because `notify` awaits: with a Set,
  two concurrent requests refuse a cascade that is not one.

**They are the EXTENSION surface, not the default tissue between modules.**
A module is the unit of installation, and the test is whether it can be
**absent**. An application whose modules all ship together — every one `core`,
with permissions rather than installation deciding who sees what — has modules
that are an organisation of the code, and between those a direct import is
simpler and better typed. Of the five costs of a direct import that
`docs/es/wiring.md` lists, only two survive when nothing is ever turned off: the
import pulls the whole tree at boot, and two crossed imports still produce a
mute `undefined`. Wiring still earns its place where the implementation must be
swappable, where the other side is written by somebody else, or where the
announcer must not break when a reaction fails — that last one has no import
equivalent.

The failure mode is not under-wiring. A wiring that is the exception gets read
carefully; a wiring that is everywhere stops marking a boundary at all.

Note what the manifest asks for, because it is the evidence: **`consumes` is a
field and `provides` is not.** Provision is DISCOVERED — samble reads
`providers/` and takes the token off the decorator — while consumption has to be
DECLARED, because the framework cannot see which contracts your code calls. That
field buys exactly one thing: failing at boot instead of on the first request
that needed it.

## Still missing

The license gate — which arguably does not belong in an MIT framework at all and
should live in the product.

There is still no **grant store**: the resolver hands the actor's permission
list over and the framework trusts it. That is deliberate — who holds what is
the application's policy — but it means samble validates the keys, never the
grants.

## TypeORM → Drizzle: what it costs

Decided 2026-09-29, in progress. The audit said yes; this is the list of what is
given up, kept open on purpose so it can be revisited with better options.

Verified before deciding: `drizzle-kit/api`'s `pushSchema(schema, db)` reads the
LIVE schema and returns the statements without applying them, which is what
`schemaDiff()` does with TypeORM today; `generateMigration(prev, cur)` over
snapshots returns `up` AND `down` with no database at all; `is(value, PgTable)`
replaces `getMetadataArgsStorage()` and, unlike it, needs no open connection.

The chosen baseline is **a snapshot per module** (`migrations/meta/`), because it
gives `down` and does not need a connected database to generate. `pushSchema` is
kept for reporting drift between the code and the real database.

What it costs:

1. **The relational query API (`db.query.users.findMany()`) is unavailable.** It
   needs the whole schema, with its types, at COMPILE time; in samble the schema
   is the union of what the installed modules contribute, assembled at runtime.
   `db.select().from(table)` stays fully typed. A module that wants the
   relational API can build its own instance over the same client:
   `drizzle(this.db.$client, { schema: itsOwnTables })` — one line, and it sees
   only its own tables, which is the right scope anyway. **Open**: whether samble
   should hand that instance to a module itself.

2. **`find({ relations: [...] })` and eager loading go away.** A consumer who
   reads through a repository gets explicit joins instead. Cascades, subscribers
   and `save()`'s upsert-ish semantics have no equivalent either. This is the
   biggest change for existing application code, bigger than the syntax.

3. **`QueryRunner`'s DDL helpers go away** in migrations: no `hasTable`,
   `createTable(new Table(...))`, `addColumn`. Migrations become SQL, which is
   arguably what they always were, but it IS a loss for anyone who used them.

4. ~~Samble becomes Postgres-only in its types.~~ **Reversed 2026-10-02**: the
   engine is the operator's choice, and samble runs on Postgres, MySQL/MariaDB
   and SQLite through `lib/dialects/`. See *Dialects* below.

5. **`hasDataLoss` cannot be trusted.** Measured: dropping a column with data
   reported `hasDataLoss: false` and zero warnings. No samble decision leans on
   that field. **Open**: whether to detect destructive statements ourselves.

6. **The snapshot is a committed artifact that can drift.** Two authors adding a
   migration to the same module conflict on one JSON file, and a migration
   edited by hand leaves the snapshot describing a schema that never existed.
   Today's live diff has no such artifact. **Open**: `migrate:status` comparing
   snapshot against the live database is the mitigation, not a fix.

7. **`drizzle-kit` pulls in `esbuild` and `tsx`**, and only
   `migration:generate` needs it, so it goes in as an optional peer. It also
   writes a spinner straight to stdout — measured: four lines, even with no TTY.
   The CLI silences it in `quietly()`, and `liveDrift()` does NOT: a library that
   muzzles another one's output is a surprise, and only the CLI owns its output.

8. **Drizzle v1 is still a release candidate** (`1.0.0-rc.5`). Pinning the stable
   `drizzle-orm@0.45` and `drizzle-kit@0.31` means a second, smaller migration
   later. **Open**: whether to wait for v1 instead.

## Deferred on purpose

**A `samble.json`.** Proposed (2026-09-29) as somewhere to turn generator
behaviour off. Turned down for that: a switch for "comments yes/no" is a knob on
a default that should just be right, and it doubles the output to maintain and
test. What would earn the file is what a project repeats on every invocation and
is not a matter of taste — `--dir`, the entry file `samble module` edits, the `@/`
alias. Waiting for a SECOND such field, so it is born with two or three concrete
ones instead of as a drawer.

**The extension story, and the fork it waits on.** Decided 2026-09-30 that
modules are organisation and are never turned off; extensions are a separate
concern. What that needs is not designed yet, and one question blocks it: does an
extension run IN this process (WordPress-shaped: hooks, shared database, and the
host must survive bad third-party code) or OUTSIDE it (its own project, its own
database, an HTTP contract)? They lead to different frameworks, and the answer
depends on whether the authors are third parties or us.

Measured against the hook model while comparing: samble has actions
(`notify()` over a `Reaction<T>` slot) but **no filter** — nothing takes a value
through N contributors in order and returns it changed. A slot folds to one in a line
(`this.all(X).reduce(...)`), so the primitive may not be needed; what IS missing
is **declared priority**. A slot's order is module dependency order — stable
across boots, but a contributor cannot ask to run early, and in a chained filter
that is the whole point. Also missing: **discovery**. Modules arrive as a list
passed to `Samble.create({ modules })`, and nobody can put a third party's plugin
in a list written before it existed.

**`ConfigService.get()`** still returns `string` for a key that may be missing.
The options are to throw (with a `getOptional()` beside it) or to type it
`string | undefined`. Undecided.
