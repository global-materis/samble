# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-alpha.2] - Unreleased

### Added

- `app.db`: the connection samble opened or was handed, for what the
  application plugs in beside it — an `express-session` store over the same
  pool (`app.db.$client`) instead of a second one. samble installs no store:
  which one depends on the engine, and the engine is the application's choice.
- `openTestDatabase()` / `closeTestDatabase()`: a real Postgres inside the
  process (PGlite) to boot an application in a test. `@electric-sql/pglite` is
  an optional peer.
- `samble init` writes a test that boots the whole app (`test/app.spec.ts`),
  `test/tsconfig.json`, the jest configuration in `package.json` and the `test`
  script with its dev dependencies.

### Changed

- The scaffold's `createApp(options)` takes `{ db }`; with a connection it does
  not require the `DB_*` variables.
- The scaffold's `buildSession(store?)` takes an optional store and documents
  building one over `app.db.$client`.

### Fixed

- The scaffold read `CORS_ORIGIN` with `ConfigService.get()`, which throws when
  it is missing; it now uses `optional()`.
- The scaffold's auth example and the guide's transaction example still used
  TypeORM calls; both are Drizzle now.
- The docs said `migration:generate` needs nothing; it needs the variables
  `createApp()` requires (it builds the app, without connecting).

## [1.0.0-alpha.1] - 2026-10-02

### Added

- First release, published as `@samble/core`; the binary is `samble`. A backend framework for Node whose unit is the installable
  module: each module declares its own routes, tables, migrations, permissions
  and contracts, and mounts into the application with `Samble.create({ modules })`.
- Contracts, extension points and schedules between modules, resolved at boot.
- Per-module migrations with their own ledger, and `samble migration:generate`.
- Authentication seam (`this.auth`, an `auth` resolver, declared permissions).
- `view()`, `pdf()`, `csv()` and `file()` responses, OpenAPI docs, health checks.
- The `samble` CLI: `init`, `module`, `endpoint`, `migrate`, `doctor`, `build`.
