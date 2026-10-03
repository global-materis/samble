<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/global-materis/samble/main/assets/brand/samble-mark.svg">
    <img alt="Samble" src="https://raw.githubusercontent.com/global-materis/samble/main/assets/brand/samble-mark-light.svg" width="112" height="112">
  </picture>
</p>

<h1 align="center">Samble</h1>

[![npm](https://img.shields.io/npm/v/@samble/core/alpha?label=npm)](https://www.npmjs.com/package/@samble/core)
[![types](https://img.shields.io/npm/types/@samble/core)](https://www.npmjs.com/package/@samble/core)
[![node](https://img.shields.io/node/v/@samble/core/alpha)](https://www.npmjs.com/package/@samble/core)
[![downloads](https://img.shields.io/npm/dm/@samble/core)](https://www.npmjs.com/package/@samble/core)
[![install size](https://packagephobia.com/badge?p=@samble/core@alpha)](https://packagephobia.com/result?p=@samble/core@alpha)
[![Socket](https://socket.dev/api/badge/npm/package/@samble/core)](https://socket.dev/npm/package/@samble/core)
[![license](https://img.shields.io/github/license/global-materis/samble)](LICENSE)

Backend framework for Node whose unit is the **installable module**: a folder
that declares its own routes, tables, migrations, permissions and contracts,
and installs into another application as one piece.

Express + Drizzle + class-validator underneath, decorators on top.

## Start

```bash
npx @samble/core@alpha init my-app    # package.json, tsconfig, .env, entry point
cd my-app
npx samble module billing
npm run dev
```

**`@alpha` matters on that first command.** Until 1.0.0 every release is
published under the `alpha` tag, and `latest` is reserved for the stable line.
Inside the project it no longer matters: `npx` finds the local install first.

Into a project you already have:

```bash
npm i @samble/core@alpha
npm i drizzle-orm express class-validator reflect-metadata pg
```

## The application

```typescript
import { ConfigService, Samble } from '@samble/core';
import billing from './modules/billing/module';

const app = await Samble.create({
  db: { type: 'postgres', host: ConfigService.get('DB_HOST'), synchronize: false },
  modules: [billing],   // the only way to mount anything
  version: '1.0.0',     // this app's own version; /health reports it
  basePath: '/api',
  // OPTIONAL. Only endpoints that read `this.auth` need it.
  auth: async (request, { db, get }) => ({ actor: { userId: 1 }, permissions: ['billing.view'] }),
});

await app.start(3000);
```

On boot samble reconciles what is installed, runs each module's pending
migrations in dependency order, and mounts the routes.

## A module

```typescript
export default defineModule({
  id: 'billing',
  dir: __dirname,          // the folder everything below is found from
  requires: ['identity'],

  permissions: [{ key: 'billing.view', label: 'View billing' }],
  consumes: [UserDirectory],
});
```

No paths, because a module keeps the standard layout and samble finds it from
`dir`:

```
billing/
├── module.ts
├── tables/*.table.ts           migrations/*.ts
├── endpoints/*.endpoint.ts     routines/*.routine.ts
├── providers/*.provider.ts     strategies/*.strategy.ts
└── tokens/*.token.ts           (contracts, slots and schedules)
```

Name a field — `routes: './apis/*.api.ts'` — only to say something else; it
replaces that one and the rest keep working. The globs are
**extension-agnostic**, so the same manifest runs from source, from a build,
from `node_modules` and from bytecode.

## An endpoint

```typescript
@HttpPost()
@Body(CreateChargeDto)          // validated before main() runs
export default class CreateChargeApi extends Endpoint<null, CreateChargeDto> {
  public async main(): Promise<DataJson> {
    this.auth.assert('billing.charge');            // 401 anonymous, 403 not allowed
    const who = await this.get(UserDirectory).find(this.auth.actor.userId);

    const [charge] = await this.db
      .insert(charges)
      .values({ ...this.body, by: who?.fullName })
      .returning();
    await this.notify(ChargeCreated, { chargeId: charge.id });

    this.httpStatus = HttpStatus.CREATED;
    return charge;
  }
}
```

`main()` returns data and samble serializes it. When the answer is not JSON,
return an output: `view('invoice', data)`, `pdf(bytes)`, `csv(rows)`,
`file(content)`.

A route hangs from the module id. `@Group` overrides that when the URL should
not carry it — one module serving `auth` and `users`, or several contributing
to the same prefix. `mount` takes the group off the application's `basePath`,
which is what a monolith serving pages *and* an API needs, because
`/api/charges/page` is not a URL anybody would link to:

```typescript
@HttpGet(':id')                         // /api/billing/:id   ← the module id
@Group('charges')                       // /api/charges/:id
@Group('charges', { mount: '/' })       // /charges/:id       ← a page
@Group('checkout', { mount: '/shop' })  // /shop/checkout/:id
```

Both can live in the same module: the JSON endpoints keep the prefix, the page
declares its own.

## How modules meet

| | Who answers | Whose failure it is |
| --- | --- | --- |
| **Contract** — `token(id, 'contract')` / `@Provides` on a `Provider` / `this.get()` | exactly one; a second provider is an error | the caller's, and it waits for the answer |
| **Slot** — `token(id, 'slot')` / `@Fills` on a `Strategy` / `this.all()` | as many as are deployed | the host's: it calls them and uses what they return |
| **the same slot, announced into** — `Reaction<T>` / `this.notify()` | as many as are deployed | **theirs**: a failure is logged and the announcer answers anyway |

Two relationships, not three. An event used to be the third, and all it added
over a slot was that last row — so the guarantee became a verb and the bus went
away. A third token kind, `'schedule'`, is not a wiring at all: it names a clock
that `app.schedule(Token)` starts and stops.

They are not interchangeable, and the types refuse to mix them.

## CLI

```bash
npx samble init [name]                        # a project that runs
npx samble module billing              # manifest, first endpoint, migrations index
npx samble endpoint billing/issue --method post
npx samble table billing/charge        # found by its folder
npx samble migration billing/create-charges
npx samble contract billing/service
npx samble provider billing/service
npx samble strategy billing/cash payment-methods      # fills someone else's slot
npx samble routine billing/nightly --cron "0 7 * * *"   # + its schedule token
npx samble token billing/charge-created slot --reaction  # something to react to

npx samble doctor                             # is this machine ready? changes nothing, exits 1 on a problem
npx samble migrate                            # run pending migrations, no server
npx samble migrate --dry-run                  # what would run
npx samble migrate:status                     # what each module declares, and what ran

npx samble build [--bytecode]                 # .jsc delivery, for a machine you do not control
```

`migrate` asks YOUR entry point for the application — it looks for an exported
`createApp()` — so the CLI never needs to know where your database is. That is
why `samble init` writes the entry point with `createApp()` separate from
`main()`, guarded by `if (require.main === module)`: importing the file must not
start a server.

## Also in the box

Swagger from the same decorators, scheduled routines, per-module migrations with
their own ledger, template rendering, a route map in `router.log`, configurable
logging, graceful shutdown.

## More

- [The long guide](https://github.com/global-materis/samble/blob/main/docs/en/guide.md) — every feature, and why each one is the way it is
- [Authorization](https://github.com/global-materis/samble/blob/main/docs/en/authorization.md) — permissions and the session user, step by step
- [The CLI](https://github.com/global-materis/samble/blob/main/docs/en/cli.md) — every command, every flag, and what each one writes
- [The API](https://github.com/global-materis/samble/blob/main/docs/en/api.md) — every name the package exports, with its type
- **En español:** [la guía](https://github.com/global-materis/samble/blob/main/docs/es/guide.md) · [autorización](https://github.com/global-materis/samble/blob/main/docs/es/authorization.md) · [el CLI](https://github.com/global-materis/samble/blob/main/docs/es/cli.md)
- [`src/`](https://github.com/global-materis/samble/tree/main/src) — a small, complete application (three modules), covered by `test/demo-app.spec.ts`
- [`http/demo.http`](https://github.com/global-materis/samble/blob/main/http/demo.http) — the whole flow, request by request
- [CHANGELOG](https://github.com/global-materis/samble/blob/main/CHANGELOG.md)
- [`assets/brand/`](https://github.com/global-materis/samble/tree/main/assets/brand) — the mark: on dark, on light, one ink (`currentColor`) and a small-size cut for 16–32 px. Brand color: malachite `#22A07C`.

Node >= 20. MIT.
