# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-alpha.1] - Unreleased

### Added

- First release. A backend framework for Node whose unit is the installable
  module: each module declares its own routes, tables, migrations, permissions
  and contracts, and mounts into the application with `Samble.create({ modules })`.
- Contracts, extension points and schedules between modules, resolved at boot.
- Per-module migrations with their own ledger, and `samble migration:generate`.
- Authentication seam (`this.auth`, an `auth` resolver, declared permissions).
- `view()`, `pdf()`, `csv()` and `file()` responses, OpenAPI docs, health checks.
- The `samble` CLI: `init`, `module`, `endpoint`, `migrate`, `doctor`, `build`.
