# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-alpha.2] - Unreleased

### Added

- **The database engine is the operator's choice**: PostgreSQL, MySQL/MariaDB
  or SQLite (libsql), through one adapter per engine in `lib/dialects/`. Only
  the driver of the engine in use is loaded: `pg`, `mysql2` or
  `@libsql/client`. `db: { dialect }` in `Samble.create()`; a connection handed
  in is recognized by itself (`app.dialect`).
- `this.db` is typed by the engine through `SambleDatabase.Config`, which
  `samble init` declares in `src/config/database.ts`.
- `samble init` asks which database (or `--db <engine>`) and writes the driver,
  `.env`, test database, table template and session store suggestion for it,
  recording the choice in `package.json` (`samble.dialect`). `samble table` and
  `samble migration` follow it.
- A module whose tables were written for another engine is refused at boot, by
  name.

- `app.db`: the connection samble opened or was handed, for what the
  application plugs in beside it — an `express-session` store over the same
  pool (`app.db.$client`) instead of a second one. samble installs no store:
  which one depends on the engine, and the engine is the application's choice.
- `openTestDatabase({ dialect })` / `closeTestDatabase()`: a real database of
  the app's engine to boot it in a test — PGlite, SQLite in memory, or a
  database of its own on the MySQL server `SAMBLE_TEST_MYSQL_URL` points at,
  dropped on close.
- `samble init` writes a test that boots the whole app (`test/app.spec.ts`),
  `test/tsconfig.json`, the jest configuration in `package.json` and the `test`
  script with its dev dependencies.

### Changed

- The scaffold's `createApp(options)` takes `{ db }`; with a connection it does
  not require the `DB_*` variables.
- The scaffold's `buildSession(store?)` takes an optional store and documents
  building one over `app.db.$client`.

### Fixed

- `schemaDrift()` / `migration:generate --check` compared the WHOLE database:
  it reported samble's `_modules` as drift and, on `_module_migrations` or any
  table it did not know, Drizzle Kit stopped to ask and called
  `process.exit(1)`. It is now limited to the modules' tables (Postgres), and a
  Drizzle Kit exit becomes an error. On MySQL and SQLite it is refused with a
  clear message until Drizzle Kit can be limited the same way.
- The README and the guide still showed TypeORM options (`type: 'postgres'`,
  `synchronize`) for `db`.
- The scaffold's `package.json` was not what Prettier writes; a project made
  with `--skip-install` failed `prettier --check`.

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
