# samble — the long version

> The README is the summary. This is everything: the reasoning behind each
> decision, the failure each one prevents, and the parts that only matter once
> you are deep in.

Samble is a lightweight and simple backend framework. Its main goal is to facilitate the development of modern APIs with minimal configuration while following best practices. Samble is inspired by the architecture and ease of use of frameworks like NestJS, offering modular organization, intuitive route handling, database integration through Drizzle, and support for scheduled tasks.

With Samble, you can quickly define your API modules and controllers, associate middlewares and schema validations, and manage recurring or scheduled tasks. The framework prioritizes ease of use, low resource consumption, and a short learning curve, without sacrificing the power needed to build robust and scalable applications.

This project is designed for developers who are looking for a simple and fast alternative to launch backend services without the overhead of complex configurations, while maintaining a solid and extensible structure.

## Requirements

- **Node.js >= 20**
- **PostgreSQL** reachable at startup
- `reflect-metadata` is loaded by the framework itself — you do not need to import it

## Install

```bash
npm install samble
```

`samble` relies on a few peer dependencies you provide in your app: `drizzle-orm`, `express`, `class-validator` and `typescript`. Add `express-session` only if your auth resolver uses cookie sessions — the framework no longer depends on it.

## Feature status

| Feature                     | Status |
| --------------------------- | ------ |
| Routing                     | ✔      |
| Schema validation           | ✔      |
| Scheduler / Routines        | ✔      |
| API docs (Swagger / OpenAPI)| ✔      |
| Non-JSON answers (view/PDF/CSV) | ✔  |
| Static files                | ✔      |
| Cookie manager              | ✔      |
| Environment vars            | ✔      |
| Testing                     | ✔      |
| Configurable logging        | ✔      |
| Graceful shutdown           | ✔      |
| Installable modules         | ✔      |
| Contracts between modules   | ✔      |
| Per-module migrations       | ✔      |
| Authentication seam         | ✔      |
| Reactions between modules   | ✔      |
| Extension points (slots)    | ✔      |
| Scaffolding CLI             | ✔      |

## Command line

```bash
npx @samble/core@alpha init my-app     # only the first command needs the tag:
                                # until 1.0.0 every release is published
                                # under `alpha`, not `latest`.
npx samble module billing
npx samble endpoint billing/issue-charge --method post
npx samble table billing/charge
npx samble migration billing/create-charges
npx samble build --bytecode
```

A module is a **shape**: a manifest, globs that have to match, a migrations
index, permission keys namespaced by the module id. Every one of those is a
place to be one convention off and find out at boot — or not at all, since a
`routes` glob that matches nothing starts cleanly and answers 404. The CLI
writes the shape; you write the code.

| Command | What it writes |
| --- | --- |
| `init [name]` | A project that runs: `package.json`, `tsconfig.json`, `.env`, entry point — and `npm install` (`--skip-install` to stop before it) |
| `module <name>` | `module.ts`, its permissions file and a first endpoint |
| `endpoint <module>/<name>` | An endpoint (`--method`, `--path`, `--group`, `--public`) |
| `routine <module>/<name>` | Work on a schedule (`--cron`) |
| `contract <module>/<name>` | A capability this module publishes: token and shape |
| `provider <module>/<name>` | The class that answers it |
| `strategy <module>/<name> <slot>` | What this module contributes to someone else's extension point |
| `token <module>/<name> slot --reaction` | Something this module announces, for whoever reacts |
| `slot <module>/<name>` | An extension point others may fill |
| `table <module>/<name>` | A table and its row types (`--name`) |
| `migration <module>/<name>` | A timestamped migration |
| `migrate` | Runs pending migrations without starting the server (`--dry-run`, `--entry`) |
| `migrate:status` | What each module declares, and what of it already ran |
| `build` | `tsc` + the files that were never TypeScript (`--bytecode`, `--out`, `--project`) |

Shared flags: `--dir <path>` (where modules live, `src/modules` by default),
`--from <specifier>` (what generated code imports samble from) and `--force`.

> Every command and every flag, with what each one writes and why:
> [docs/cli.md](./cli.md).

Two things it does **not** do, on purpose:

- It does not know your application: no database, no config file, no registry of
  what exists. It reads arguments and writes files.
- It edits files it did not write **only** where the shape is certain — adding
  the module to `modules: []` in the entry point, adding a key to the manifest's
  `permissions: []`. Anything less certain prints as an instruction instead. A scaffolder that silently mangles a file you wrote is
  worse than one that tells you what to add.

Note how few of those there are. Most generators write a file and edit nothing
at all, because the [standard layout](#the-standard-layout) is what registers
it — there is no list to keep in sync.

> Templates kept as loose assets nobody compiles drift until they generate
> decorators the framework no longer has. These templates are part of the same build as everything else, and
> `test/cli.spec.ts` scaffolds a module and **boots it** — a template that stops
> matching the framework fails the suite.

## Defining endpoints

Every endpoint is **its own class** that extends `Endpoint` and implements `main()`. Routing metadata comes from decorators; the class is discovered by the `routes` glob of the module it belongs to (see [Modules](#modules)).

```typescript
import { Endpoint, Group, HttpGet, Params, NotFoundError } from '@samble/core';
import { IsUUID } from 'class-validator';

class UserParams {
  @IsUUID()
  id: string;
}

@Group('users')
@HttpGet(':id')
@Params(UserParams)
export class GetUserApi extends Endpoint<UserParams> {
  // `this.db` is available in field initializers.
  async main() {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, this.params.id))
      .limit(1);

    if (!user) throw new NotFoundError('User not found');
    return user; // serialized as JSON with status `this.httpStatus` (default 200)
  }
}
```

- **Lifecycle**: `previous()` → `main()`. `previous()` is optional and runs on the same instance, with `params`, `body`, `query` and `auth` already in place — throwing from it skips `main()`, which is what makes it a guard. There is no `error()` or `final()` hook: throw the right error class and the framework maps it, and wrap work that must commit or roll back in `this.db.transaction(cb)`.
- **Request state** (`this.params`, `this.body`, `this.query`, `this.request`, `this.response`, `this.file(s)`) is injected per request.
- **Errors**: throw a framework error to get a mapped HTTP status — `NotFoundError` (404), `AuthError` (401), `ForbiddenError` (403), `CustomerError` (406), `SchemaError` (422), `CustomError(status, ...)`. Any other thrown value becomes a 500. Unmatched routes answer the same shape with 404. See [Failures](#failures).
- **Who is asking** is `this.auth` (see [Authentication](#authentication)).

### Transactions

There is no transaction hook and no transaction decorator. Use Drizzle's own:

```typescript
async main() {
  return this.db.transaction(async (manager) => {
    const charge = await manager.save(Charge, { ... });
    await manager.update(Subscription, id, { lastChargeId: charge.id });
    return charge;
  });
}
```

Commit, rollback and release are the callback's contract, so they cannot be forgotten. Spreading them across lifecycle hooks — `startTransaction` in one method, `commit` in another, `rollback` in a third — hides the transaction's boundaries from the code that depends on them; that is why those hooks are gone.

### HTTP verb decorators

| Decorator     | HTTP method |
| ------------- | ----------- |
| `@HttpGet`    | GET         |
| `@HttpPost`   | POST        |
| `@HttpPut`    | PUT         |
| `@HttpDelete` | DELETE      |
| `@HttpPatch`  | PATCH       |
| `@HttpQuery`  | QUERY       |

**About `@HttpQuery`**: QUERY is a safe, idempotent method that (unlike GET) allows a body — useful for searches whose criteria are too large for the query string. Declare the criteria with `@Body`. Note that QUERY is an IETF draft (`draft-ietf-httpbis-safe-method-w-body`): it needs a Node whose HTTP parser recognizes it, may not be supported by proxies/CDNs, and is excluded from the OpenAPI spec. If the runtime doesn't support the verb, the route is skipped with a clear log line instead of crashing startup.

### The group: @Group

A route hangs from the **id of the module** that loaded it. No decorator is
needed for that, which is the common case:

```typescript
// module.ts declares id: 'catalog'
@HttpGet(':id')                            // /api/catalog/:id
```

`@Group` overrides the prefix when the URL should not carry the module id —
because one module serves more than one resource (`identity` serving `auth`
**and** `users`), or because several modules contribute to the same prefix:

```typescript
@Group('products')                         // /api/products/:id
```

The two identities are deliberately separate: the module id names the
INSTALLABLE UNIT (permissions, `requires`, the `_modules` row), the group names
the URL. Renaming one must not rename the other.

### Where a group is mounted

`Samble.create({ basePath: '/api' })` prefixes every route. A group can say it
hangs somewhere else:

```typescript
@Group('products')                         // /api/products
@Group('products', { mount: '/' })         // /products
@Group('checkout', { mount: '/shop' })     // /shop/checkout
```

The override is per GROUP — per `@Group` decorator — and not per application
or per module, because that is where the split actually falls: in a monolith
that serves pages and an API, the same module has JSON endpoints that belong
under `/api` and a page that does not. `/api/products/page` is not a URL
anybody would link to.

Two consequences:

- Routes under different prefixes cannot shadow each other, so `@Priority` is
  not needed between them.
- The route map (`router.log`) prints the real URL of each one, so a group that
  ended up somewhere unexpected is visible at startup.

### Schema, middleware and priority

```typescript
@Group('users')
@HttpPost()
@Body(CreateUserDto)          // validated with class-validator before main()
@Use(requireAuth)             // a (req, res, next) function
@Priority(1)                  // registers before `:param` routes in the same module
export class CreateUserApi extends Endpoint<null, CreateUserDto> {
  main() {
    return { created: this.body.name };
  }
}
```

`@Use` takes a middleware **function** `(req, res, next)` — a function can set headers and choose the status, which is why there is no base class for it.

## Modules

A module declares its own tables, migrations, routes, routines, permissions and
the contracts it publishes, and `_modules` records what is installed and at what
version.

**Every module present in the code runs.** There is no on and off: what limits
who reaches what is permissions — a role, a plan, whatever the business says —
which is the application's policy and has nothing to do with what is deployed.
Deciding it twice, once by deployment and once by permission, is how an
installation ends up in a state nobody can explain.

```typescript
// modules/billing/module.ts
import { defineModule, token } from '@samble/core';

export interface BillingService {
  issueCharge(input: IssueChargeInput): Promise<Charge>;
}
export const BillingService = token<BillingService>(
  'billing.service',
  'contract',
);

export default defineModule({
  id: 'billing',
  requires: ['identity'],     // checked at startup
  dir: __dirname,             // the folder everything is found from

  permissions: ['billing.view', 'billing.void'],
});
```

A manifest is where the pieces are **wired**, and nothing else: no paths,
because the folders are the layout below, and no implementation, because that
is a class in `providers/`.

### The standard layout

The manifest above lists no paths, and that is the point: what it says is what
is particular to **this** module. The folders are found from `dir`:

| Folder | What samble loads from it |
| --- | --- |
| `tables/*.table.ts` | the tables, and the enums they use |
| `migrations/*.ts` | the migration classes |
| `endpoints/*.endpoint.ts` | the endpoints, mounted under the module id |
| `routines/*.routine.ts` | the scheduled routines |
| `strategies/*.strategy.ts` | the `Strategy` classes: what it contributes to other modules' extension points, reactions included |
| `providers/*.provider.ts` | the `Provider` classes: the contracts this module answers |
| `strategies/*.strategy.ts` | the `Strategy` classes: what it contributes to other modules' extension points |

Writing the file is all there is to do. `samble table billing/charge`
writes `tables/charge.table.ts` and edits **nothing**: the folder is what
declares it.

Only decorated entities and migration classes are taken. An enum, a DTO or a
helper exported from the same file is ignored, so a folder can hold what
belongs with it.

One more folder is convention without being a glob, because there is nothing
in it to discover — a token is imported by name:

| Folder | What goes in it |
| --- | --- |
| `tokens/*.token.ts` | every contract, extension point and schedule this module shares |

It is the module's public face: the only files another module ever
imports — and the reason `samble init` writes a path alias, because those are
the deep paths:

```typescript
import { UserDirectory } from '@/identity/tokens/user-directory.token';
//                            ^ src/modules/, however deep you are
```

A `paths` alias is **compile-time only**: `tsc` type-checks it and then emits
`require("@/…")` verbatim, which Node has never heard of. `samble build`
rewrites them to relative paths in the output, and `npm run dev` resolves them
with `tsconfig-paths`. Change the alias in `tsconfig.json` and change the `dev`
script with it.

**Naming a field says something else**, and only for that field:

```typescript
export default defineModule({
  id: 'billing',
  dir: __dirname,

  // A DDD layout: the endpoints are elsewhere. Entities, migrations, routines
  // and strategies keep coming from the standard folders.
  routes: './presentation/controllers/**/*.controller.ts',
});
```

Two rules are worth knowing:

- **Everything hangs off `dir`.** Without it there is nothing to resolve
  against — a glob would land on whatever the process's working directory
  happens to be — so samble applies no default at all, and the module has to
  list its entities by hand. Always `dir: __dirname`.
- **An explicit `[]` means "none".** `entities: []` is an author saying this
  module has no entities, so no default applies.

A glob you WROTE that finds nothing is reported at startup; a default that
finds nothing is not, because a module with no routines is an ordinary module.

Start the application from its modules. `Samble.create` owns the connection,
because the schema is the union of what every module contributes, which the
application cannot assemble by hand without knowing each module's internals:

```typescript
const app = await Samble.create({
  db: { type: 'postgres', host, database },
  modules: [identity, billing, inventory],
  version: '2.0.0',      // this app's own version, reported by /health
  basePath: '/api',      // prefix for module routes
});

await app.start(4000);
```

Four more options, all of them policy the application owns and samble only
mounts: `cors`, `auth`, `docs` (the generated OpenAPI UI) and `health`. See
[the CLI guide](./cli.md#samble-init-name) for what `samble init` wires by
default.

### Failures

Every failure answers the same shape, as `application/problem+json`
([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) — which is also how a
client tells a failure from a payload that happens to have a `status` field:

```json
{
  "type": "/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request body is not valid",
  "code": "schema",
  "errors": { "email": "must be an email" },
  "requestId": "9f2c1a7b4e30"
}
```

- **`title` is stable and names the KIND of problem; `detail` is about this
  occurrence.** Show `detail`, group by `title`.
- **Branch on `code`**, not on `title` or `type`. Its values are the
  `ErrorIdentifier` enum: `schema`, `customer`, `not_found`, `internal`,
  `unauthorized`, `forbidden`, `custom`.
- **`errors` says which FIELD is at fault**, so a form can put the message
  under the right input instead of in a banner. It is an extension member,
  which the RFC allows precisely for this, and it is the reason the shape
  exists at all.
- **`requestId`** is the same id the response header carries and every log line
  of that request was written with.

`CustomError(status, message, payload)` puts `payload` under `response`, for
the case where the client needs data about the failure and not just words.

### One id per request

Read from `x-request-id` or generated, echoed in the response, and present in
**every log line written while serving that request** — the access line,
anything an endpoint logs, anything a provider or a strategy logs deep inside:

```
GET /api/products 200 4.4 ms - 139 [44e9e203a52f]
[44e9e203a52f] restock of product 12 failed, rolling back
```

It reaches those inner lines through `AsyncLocalStorage` rather than being
passed down, because the lines worth correlating are written where nobody
handed anything in. In an endpoint it is `this.requestId`; anywhere else,
`currentRequestId()`.

Worth putting in whatever you record — an audit row, a job you enqueue, a call
to another service — because that is what ties "a user says it failed" to the
lines that say why.

An incoming header is client input: it is accepted only if it matches
`[A-Za-z0-9._:-]{1,128}` and replaced by a generated id otherwise, since a
newline in a header would otherwise become a forged log entry. Replaced rather
than sanitized — a half-cleaned id is not the one the caller is holding, so it
would correlate nothing.

```typescript
requestId: { header: 'x-correlation-id' }   // if your gateway already sends one
```

### Health

```typescript
health: { path: '/health' }      // 200 while it can serve, 503 while it cannot
```

Unauthenticated and outside `basePath`, because that is what a load balancer, a
container runtime or an uptime check can read. Kept out of the access log: a
probe every few seconds otherwise buries every real request.

The database check is a **round trip**, not `isInitialized` — that flag stays
true after a connection drops, since the pool only finds out when something
asks, so a check reading it reports `pass` through the one outage it exists
for. And it answers 503 **as soon as shutdown begins**, before the server stops
accepting, which is the window a balancer needs to drain.

```json
{ "status": "pass", "uptime": 1284 }
{ "status": "fail", "uptime": 1284, "checks": { "database": "fail" } }
```

Thin on purpose: a probe cannot authenticate, so versions and module counts
would be a map of your installation for whoever finds it. `details: true` adds
them, for when it sits behind a gate.

#### Your own checks

samble only knows what it owns: the process is up and the database answers.
Whether a queue has to be connected, a payments provider reachable or a cache
warm is knowledge the framework cannot guess — so it takes it:

```typescript
health: {
  path: '/health',
  checks: {
    queue: () => bridge.isConnected(),
    payments: async () => (await gateway.ping()).ok,
  },
}
```

`true` passes. **Throwing counts as `fail`**, because a dependency that is down
usually announces itself by throwing, and this is the one place where an
exception is an answer rather than a failure. One `fail` makes the whole
endpoint 503 and names the culprit in `checks`.

They all run in parallel on every request, so the probe waits for the slowest
one rather than for their sum — keep them cheap anyway. A check that hangs is
cut off at `timeout` (2s by default) and counted as `fail`: a probe that never
answers reads to a balancer as a network problem instead of as an unwell
instance. `server` and `database` are samble's own names and are refused at
startup, so an application check can never quietly replace the database's
answer.

This is the seam `/readyz` would have been. It is not split into `/livez` and
`/readyz` because the split only pays off once a platform treats the two
differently — restart vs. take out of rotation — and samble has one honest
answer to give either way.

On boot it reads `_modules`, resolves the dependency graph, runs each module's
pending migrations **in dependency order**, registers the contracts, and mounts
the routes. Any failure there stops the boot: serving half-mounted is worse than
not starting.

### Shipping a module compiled, or as a package

The `routes` and `routines` globs are **extension-agnostic**. Write them however
you like — `'./endpoints/*.endpoint.ts'`, `'./endpoints/*.endpoint.js'` or
`'./endpoints/*.endpoint'` — and
samble looks for `.ts`, `.js`, `.cjs`, `.mjs` and `.jsc`. You declare *which*
files; the extension is not your problem.

That is what lets **one manifest** work in four places:

- from source in development (`.ts`)
- from a build you ship to a customer's server (`.js`)
- from `node_modules`, when the module is published as a package
- from a **V8 bytecode** build (`.jsc`), for an installation you do not control

```typescript
import billing from '@acme/samble-billing';   // a module someone else wrote

const app = await Samble.create({ db, modules: [identity, billing] });
```

If a source tree and its build sit side by side, only one of each file is
loaded (`.ts` wins, `.jsc` loses to anything readable), so routes are never
registered twice. `*.d.ts` files are skipped.

#### Loading a module compiled to V8 bytecode

`npx samble build --bytecode` compiles the project, copies what was never
TypeScript (templates, static files) and turns each `.js` into a `.jsc` holding
V8's code cache, with the readable file deleted. samble loads those like any
other module file — **as long as the application registers the extension
first**:

```javascript
require('bytenode');        // registers Module._extensions['.jsc']
const app = await Samble.create({ db, modules: [identity, catalog] });
```

samble does **not** depend on bytenode, and does not compile anything: what a
`.jsc` file is depends on the Node build that produced it, and that is the
application's decision, not the framework's.

`npm run demo:bytecode` does the whole thing on the example app — compiles it,
deletes every `.js`, boots from the `.jsc` files and prints the route map — so
the claim on this page is something you can run. Worth knowing before you plan
around it:

- A `.jsc` is **tied to the Node/V8 version that produced it**. Another version
  fails with `Invalid or incompatible cached data`, so the runtime has to ship
  with the build.
- It is **opacity, not encryption**. The logic is no longer readable as source,
  but string literals, identifiers, property and class names survive in the
  cache — and so does everything that was never JavaScript: templates, SQL
  migrations, static files, environment variables.

### Calling another module

A module reaches another through its contract, never by importing it — which is
what lets the provider change or be swapped without touching its callers.

> **First, decide whether you need this at all.** A module is the unit of
> installation, and the test is whether it can be **absent**. When the answer is
> never — every module ships together and who sees what is decided by
> permissions rather than by installation — those modules are an organisation of
> the code, and a direct import between them is simpler and better typed.
> Contracts and extension points are the **extension surface**: what
> lets something you did not write, or that may not be installed, take part.
> They are not the default tissue between folders of the same product. A wiring
> that is the exception is read carefully; a wiring that is everywhere stops
> marking a boundary at all. See
> [when a direct import is fine](../es/wiring.md#cuándo-un-import-directo-sí-va)
> (Spanish; the English page is owed).

```typescript
@Group('sales')
@HttpPost('/')
export default class CreateSale extends Endpoint<never, CreateSaleDto> {
  async main() {
    const billing = this.get(BillingService);
    const charge = await billing.issueCharge({ ... });
    return { chargeId: charge.id };
  }
}
```

Declare it in the manifest so a missing provider stops the boot instead of
failing on whichever request needed it first:

```typescript
consumes: [BillingService],
```

Routines get the same `this.get()`.

#### The two halves

A contract is deliberately split in two, and they live in different folders.

```typescript
// billing/tokens/billing-service.token.ts — the promise
export interface BillingService {
  issueCharge(input: IssueChargeInput): Promise<Charge>;
}
export const BillingService = token<BillingService>(
  'billing.service',
  'contract',
);
```

```typescript
// billing/providers/billing-service.provider.ts — how it is kept
@Provides(BillingService)
export class BillingServiceProvider extends Provider implements BillingService {
  async issueCharge(input: IssueChargeInput) {
    const [charge] = await this.db.insert(charges).values(input).returning();
    return charge;
  }
}
```

The consumer imports the **contract file** and never the provider. Nothing
lists the provider: the folder is what registers it and the decorator says
which contract it answers.

- **`this.db`, `this.get()`, `this.all()` and `this.notify()`** are injected
  before the instance is built, so a field initializer can already reach for a
  repository — the same as an endpoint, a routine or a strategy.
- **Built on first use, then reused.** A contract nobody calls costs nothing,
  and the boot does not hang on something one endpoint needs.
- **Exactly one provider.** Two modules answering the same contract is an error
  at boot, because otherwise the caller would get one of them by load order.
- Two implementations asking for each other is reported by name instead of
  exhausting the stack.
- A `Provider` with no decorator is skipped with a warning: a file being
  written is not a broken installation.



### Extension points

Two ways modules meet, and they are not interchangeable:

| | Who answers | Who runs it | Whose failure it is |
| --- | --- | --- | --- |
| **Contract** (`get`) | exactly one | the caller, who waits for the answer | the caller's |
| **Slot** (`all`) | however many contributions | the host, and it uses what they return | the host's |
| the same slot, **announced** (`notify`) | however many contributions | the host, and it discards the answers | **theirs** |

The last two rows are **the same slot**: all that changes is the verb the host
reads it with, and with it whose failure it is. There used to be a third
mechanism — an event, with its own bus and base class — and that was the whole of
what it added.

A slot is what a third-party extension plugs into: the host does not know what
will exist, so it declares the shape and enumerates whatever is installed.

```typescript
// catalog opens the point
export interface ProductBadge {
  id: string;
  for(product: { id: number; stock: number }): string | null;
}
export const ProductBadges = token<ProductBadge>(
  'catalog.product-badges',
  'slot',
);
```

```typescript
// any module fills it, without catalog changing — strategies/low-stock-badge.strategy.ts
@Fills(ProductBadges)
export class LowStockBadge extends Strategy implements ProductBadge {
  readonly id = 'low-stock';
  for(product) { return product.stock < 10 ? 'Low stock' : null; }
}
```

```typescript
// catalog reads whoever showed up
const badges = this.all(ProductBadges);
```

**Watch the direction.** The module that OPENS the slot is the one extensions
depend on: `catalog` knows nothing about who fills it, while a contributor
imports its token. Backwards, the host would depend on its own extensions and
none of them could be removed.

- A contribution is a **`Strategy`**, not a `Provider`: its own folder
  (`strategies/`), its own decorator (`@Fills`) and its own base class. The
  interface it implements belongs to the **host**, and the host is the only one
  that runs it. A `Provider` is the other thing entirely: your module's public
  face answering a contract that is yours.
- An empty array is a normal answer: a slot nobody filled is a feature nobody
  installed.
- They are built on first read and cached, and a contribution that asks for its
  own slot is reported instead of exhausting the stack.
- Order is dependency order, so it is stable across boots.

### Permissions

A module declares the vocabulary of what can be gated inside it:

```typescript
permissions: [
  'billing.view',
  'billing.void',
  // Text only where the key cannot carry it on its own — most often for a
  // module installed from elsewhere, whose namespace the operator did not write.
  { key: 'billing.impersonate', label: 'Act as another operator' },
],
```

This is the ONLY place a key is spelled.
`PermissionsOf<typeof billing>` reads the spellings off it, so a typo in an
endpoint does not compile and there is no second list to keep in sync — see
[Authorization](./authorization.md#2-declare-the-keys-the-module-can-gate).

Keys **must** be namespaced with the module id. Every module, including one
someone else wrote, shares a single permission space, and the namespace is what
keeps two of them from claiming the same key.

The `label` is optional because a key like `billing.invoices.void` already says
it, and a label that restates it is one more string to keep true. It is read by
one thing only: the screen where a role is built.

Endpoints then demand them (see [Authentication](#authentication)), and the
application builds its "who may do what" screen from the catalog instead of a
central file somebody has to remember to edit:

```typescript
app.permissions();
// [{ key: 'billing.view', moduleId: 'billing' }, ...]
```

**A key no installed module declares is refused**, with a plain `Error` (500)
and a suggestion — not a 403. A 403 would send whoever debugs it to look at
roles and grants, when the problem is a typo:

```
Unknown permission "billing.veiw": no installed module declares it.
Add it to that module's "permissions" in defineModule().
Did you mean: billing.view, billing.void?
```

The check runs **before** the 401, so an undeclared key surfaces on the first
request even while you are still anonymous.

### Announcing something, for whoever reacts

A contract is a call: you ask a particular module for something and wait.
Announcing is the other thing: *this happened*, and whoever cares reacts. It is
the same slot as above, read with `notify()`.

```typescript
// catalog/tokens/product-restocked.token.ts — the host declares the PAYLOAD
export interface RestockPayload {
  productId: number;
  quantity: number;
  userId: number;
}
export const ProductRestocked = token<Reaction<RestockPayload>>(
  'catalog.product.restocked',
  'slot',
);
```

`Reaction<T>` supplies the method, so nobody has to agree on a name for it.

```typescript
// in an endpoint or a routine of `catalog`
await this.notify(ProductRestocked, { productId, quantity, userId });
```

```typescript
// reports/strategies/restock-log.strategy.ts
@Fills(ProductRestocked)
export class RestockLog extends Strategy implements Reaction<RestockPayload> {
  async on(payload: RestockPayload) {
    await this.get(UserDirectory).find(payload.userId);
  }
}
```

The file goes in the module's `strategies/` folder, the same way a routine goes
in `routines/`. Nothing to declare.

The rules that keep announcing from turning into a call with extra steps:

- **A reaction that throws does not fail the announcer.** The failure is logged
  with the module and the slot; the request goes on. If the outcome matters to
  the caller, it wants a contract.
- **A slot nobody filled is normal**: `notify()` is a no-op.
- Reactions run in parallel and `notify()` resolves once they have all settled.
  **It is not a queue**: a slow reaction still slows you down.
- **One hop, and no further.** A reaction that tries to announce something of its
  own is refused by name, naming both slots. Without that it becomes A → B → C
  and "why was this email sent" stops having an answer.

**GOTCHA:** reactions read on their own connection. Announcing inside
`db.transaction()` means they will not see the uncommitted rows — announce
*after* it commits, or put what they need in the payload.

## Trying a local build

To test an unpublished version against your own project:

```bash
cd samble && npm run build && npm pack       # -> samble-<version>.tgz
cd ../your-project && npm install ../samble/samble-<version>.tgz
```

A tarball is closer to what npm actually installs than `npm link`, which
resolves through symlinks and can hide a missing file or a bad `files` entry.

## Authentication

> Step by step, with recipes and a troubleshooting table:
> [docs/authorization.md](./authorization.md).

`auth` is **required**. It is the one option with no sensible default: any
default the framework picked would be the framework deciding who may do what. An
application that gates nothing writes one all the same —

```typescript
auth: defineAuth(async () => ({
  actor: {} as SambleAuth.Actor,
  permissions: ['*'],
})),
```

— because "everyone is allowed" is an answer somebody chose, and this way it
reads like one instead of being the silence of an option nobody passed.

A project made by `samble init` comes with it written. `src/config/auth.ts` lets
EVERYONE through with every permission — not authentication, but enough that
`this.auth`, `this.auth.assert(...)` and the compiler-checked permission keys
all work from the first request. So the scaffold writes the
`this.auth.assert(...)` line **live**: the gate is in place and open, which is
the only order in which closing it is a one-line change. A scaffold that ships
the assertion commented teaches that endpoints are ungated by default, and the
day somebody writes real authentication every endpoint written until then is
still open. `--public` leaves the line out for the ones meant to be.

When you do want it: endpoints never learn how a caller was identified. One
resolver turns a request into an **actor**, and every endpoint reads it as
`this.auth`.

```typescript
const auth = defineAuth(async (request, { db }) => {
  const userId = request.session?.userId;  // or a bearer token, or an API key
  if (!userId) return null;                // anonymous

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;                  // deleted mid-session

  return {
    actor: { userId },
    permissions: user.role === 'owner' ? ['*'] : ['billing.view'],
  };
});

const app = await Samble.create({ db, modules: [identity, billing], auth });
```

`defineAuth` types the callback's arguments without an annotation and refuses a
result that would make `this.auth` lie — an object with no `actor` reports
`isAuthenticated` while `actor` is `undefined`, so the 401 never happens. Give
it several strategies and they are tried in order, first one to recognize the
caller wins: `defineAuth(sessionAuth, bearerAuth, apiKeyAuth)`. The plain
`AuthResolver` type still works as `auth` too.

The resolver runs on every request, and in most applications it queries. Once
that shows up in a measurement, `cacheAuth` remembers the answer per caller with
an explicit `invalidate` for the paths that change what somebody may do — see
[Caching what the resolver answered](./authorization.md#caching-what-the-resolver-answered).

That is the whole feature. samble stores no roles and no users: it receives a
list of keys per request and compares strings. Which keys somebody holds is
**your** application's rule, wherever you keep it.

The resolver also gets `get`, to resolve a contract instead of querying:

```typescript
const auth = defineAuth(async (request, { get }) => {
  const userId = request.session?.userId;
  if (!userId) return null;
  const permissions = await get(UserDirectory).permissionsOf(userId);
  return permissions ? { actor: { userId }, permissions } : null;
});
```

Worth it for ONE reason, and only when it applies: the resolver usually lives
outside the modules, so querying directly means importing an entity from a
module's internals. Fine while you own every module; not fine once one of them
is installed from somewhere else, or is meant to be swapped. The demo under
`src/` uses the contract to show this, which makes the simple case look harder
than it is — start with `db`.

Declare the actor's shape **once**, anywhere in your app, and it is typed
everywhere:

```typescript
declare global {
  namespace SambleAuth {
    interface Actor {
      userId: number;
      tenant: string;
    }
  }
}
```

Then, inside an endpoint:

```typescript
this.auth.actor.userId          // typed; throws AuthError (401) if anonymous
this.auth.optional              // Actor | null, for endpoints open to everyone
this.auth.isAuthenticated       // boolean
this.auth.can('billing.void')   // boolean, false when anonymous
this.auth.assert('billing.void')// 401 if anonymous, 403 if signed in but not allowed
```

Notes:

- `this.auth.actor` **throws on purpose**. Reading the caller and checking it
  exists were two steps that had to be written together every time, and
  forgetting the second failed silently. Use `optional` where anonymous is a
  valid case.
- 401 and 403 are not interchangeable: 401 tells a client to authenticate, 403
  tells it not to bother. `assert()` picks the right one.
- The permission keys are the ones modules declare in their manifest. `*` grants
  everything.
- The resolver runs once per request, before `previous()`, so keep it cheap.
  Throwing from it is legitimate — a malformed token is a 401 — and maps through
  the normal error handling.
- It receives `{ db, get }` as a second argument. Without it, an application
  whose permissions live in the database had to close over an imported
  connection, or copy them into the session at login and let them go
  stale — a revoked role would keep working until the next sign-in.
- `this.auth` is **per-request state**: like `params` and `body`, it is not
  readable from a constructor or a field initializer.
- Without a resolver, reading `this.auth.actor` raises a plain `Error` (500), not
  a 401: an app that never wired auth up has a bug, not an unauthorized visitor.

## Bootstrapping

`Samble.create()` is the only way to build an application, and **modules are the only way to mount anything**. There is no glob-mounting API: a route or a routine belongs to a module or it does not exist.

```typescript
import { Samble } from '@samble/core';
import identity from './modules/identity/module';
import billing from './modules/billing/module';

const app = await Samble.create({
  db: { host, database /* ... */ },      // or a connection you already own
  modules: [identity, billing],
  version: '3.0.0',
  basePath: '/api',
});

await app.start(5000);
```

`start()`:

- fails fast if the database can't be reached (throws, so the process exits non-zero and your orchestrator restarts it);
- aborts if the module graph is broken or a migration fails — serving half-mounted is worse than not starting;
- registers `SIGTERM`/`SIGINT` handlers for a **graceful shutdown** (stops the routines, drains in-flight requests, closes the database). You can also trigger it with `app.shutdown()`, or `app.close()` to stop without ending the process.

An empty `modules` array is allowed but warns on start: the app will serve nothing beyond what you mounted by hand through `getApp()`.

### CORS

samble owns the CORS mechanism — the headers, the preflight, the order — and you own the policy, the same split as `auth`:

```typescript
Samble.create({
  cors: {
    origin: ['https://app.example.com'],   // exact, scheme and port included
    credentials: true,                     // cookies; forces an explicit list
  },
});
```

Left out, no CORS headers are sent at all, which is right for an API no browser calls cross-origin.

`origin: true` allows anyone and is only valid WITHOUT credentials — a browser refuses `Access-Control-Allow-Origin: *` on a request carrying cookies, so samble refuses that combination at startup rather than letting you meet it in a console.

An origin that is not on the list simply does not get the header, and the request goes through: that is what the standard says, and it keeps server-to-server callers working. The browser is what blocks it, and samble logs the refusal so there is a trace on this side too. It is mounted before everything else, so a preflight never reaches a route and the headers are present on an error response as well.

### API versioning

**The version goes in the URL, and it is a convention rather than something the framework knows about.** Two versions of the same resource coexist with what is already there, either way round:

```typescript
@Group('v1/products')                     // → /api/v1/products/:id
@Group('products', { mount: '/api/v2' })  // → /api/v2/products/:id
```

Two separate classes, each with its own DTOs and its own `main()`. They mount and answer side by side, and nothing else has to be declared.

Having both up is the easy part. What turns it into a **migration** rather than two routes nobody dares delete is [`@Deprecated`](#deprecated-a-route-on-its-way-out).

#### `@Deprecated`: a route on its way out

Marks the old one **without taking it down**:

```typescript
@Deprecated({
  sunset: '2027-01-31',
  use: '/api/v2/products/:id',
  note: 'Returns the flat price. v2 nests it under `amount`.',
})
@Group('v1/products')
@HttpGet(':id')
export class ProductV1 extends Endpoint { ... }
```

All three are optional, and a bare `@Deprecated()` already says the one thing that cannot be left out: that it is going.

| | What it is | Where it shows up |
| --- | --- | --- |
| `sunset` | The day it **stops answering**, as `YYYY-MM-DD`. Samble does not switch it off then — deleting the class stays your decision. It is a promise you publish, and publishing it is what makes it something a caller can plan around. | the `Sunset` header and the description |
| `use` | The path that **replaces** it. Without it a caller learns it is on borrowed time but not where to move, which is the half of the message that costs you the support thread. | the `Link` header and the description |
| `note` | One line on **what changed**, for whoever reads `/docs`. Documentation only. | the description |

And it does three things:

- **The spec says so.** `deprecated: true` on the operation, which Swagger UI strikes through, plus the sunset date and the successor at the top of the description.
- **The caller is told, on every response.** `Deprecation: true`, `Sunset` when there is a date, and `Link: <...>; rel="successor-version"` when there is a successor. A client that never reads the docs still gets the signal. The headers go out **whatever the route answers** — 200, 404, or the DTO's 422 that never reaches `main()` — because a route being on its way out does not depend on how one call went.
- **You find out who is still calling**, which is *the* question that blocks deleting a route. The first hit leaves a warning in `warn.log`. **Once per route, not once per request**: what you want to learn is that the caller exists, and a line per request would bury everything else. How often and from where is already in the access log.

> It is not `@ApiHidden`. Hiding the old version removes the one place a client could have read which version to move to; this marks it and keeps it visible.

`Sunset` is RFC 8594 and the `Link` relation is registered by RFC 8288. The `Deprecation` header is still an IETF draft, and samble sends its boolean form.

## Swagger / OpenAPI

Samble generates an OpenAPI 3.0.3 spec straight from the decorators you already use for routing — no separate annotations, no extra build step. Enable it with a single call:

```typescript
const app = await Samble.create({
  // ...
  docs: {
    path: '/docs',
    info: {
      title: 'My API',
      version: '1.0.0',
      description: 'Optional Markdown description',
    },
  },
});
```

This mounts:

- `GET /docs` → interactive Swagger UI
- `GET /docs.json` → raw OpenAPI 3 JSON

Left out, nothing is exposed. `samble init` turns it on, and it stays on in
every environment — but it does publish the full shape of your API to anyone
who finds the URL, so put it behind your own gate, or drop the option, if that
is not what you want. There is no second way to turn it on: it is an option of
the application, decided where every other one is.

### What gets documented automatically

| Source | Result in the spec |
| --- | --- |
| `@Group(name)` or the module id, + `@HttpGet`/`@HttpPost`/... | path + HTTP method |
| `@Body(Dto)` | `requestBody` (JSON) referencing a reusable schema |
| `@Params(Dto)` | typed path parameters (always required) |
| `@Query(Dto)` | typed query parameters (required driven by `@IsOptional`) |
| `:foo` in the path without `@Params` | inferred as a `string` path parameter |
| the group | default tag for the endpoint |
| `@ApiHidden()` | excluded (mounted, but kept out of the spec) |
| `@HttpQuery` | excluded (QUERY is not an OpenAPI operation) |

DTOs are turned into JSON Schema via [`class-validator-jsonschema`](https://github.com/epiphone/class-validator-jsonschema). Decorators like `@IsString`, `@IsEnum`, `@IsUUID`, `@IsOptional`, `@MinLength`, etc. map to their OpenAPI equivalents out of the box, so anything you already validate is also documented.

### Adding richer docs (optional)

Four extra decorators let you polish the output. They are fully optional — leave them off and you still get a valid spec.

```typescript
import {
  Endpoint,
  Body,
  Group,
  HttpPost,
  ApiTag,
  ApiSummary,
  ApiDescription,
  ApiResponse,
} from '@samble/core';
import { IsEmail, IsString, MinLength } from 'class-validator';

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class UserDto {
  @IsString()
  id: string;

  @IsEmail()
  email: string;
}

class ErrorDto {
  @IsString()
  message: string;
}

@Group('users')
@HttpPost()
@Body(CreateUserDto)
@ApiTag('users')
@ApiSummary('Create a user')
@ApiDescription('Creates a new user. Email must be unique.')
@ApiResponse(201, { description: 'Created', Schema: UserDto })
@ApiResponse(409, { description: 'Email already in use', Schema: ErrorDto })
export class CreateUserApi extends Endpoint<null, CreateUserDto> {
  async main() {
    // ...your logic
  }
}
```

| Decorator | Purpose |
| --- | --- |
| `@ApiTag(...names)` | Group endpoints under one or more tags (overrides the default module tag). |
| `@ApiSummary(text)` | Short one-line summary shown in the endpoint list. |
| `@ApiDescription(text)` | Longer description (Markdown supported). |
| `@ApiResponse(status, { description?, Schema? })` | Document additional status codes and their response shape. Stack as many as you need. |
| `@ApiHidden()` | Mount the endpoint but leave it out of the spec — a page, a webhook, an internal route. |

### Current limitations

- Only `application/json` request/response bodies are documented — `multipart/form-data` and `application/x-www-form-urlencoded` are not auto-generated yet.
- No `securitySchemes` are emitted, so endpoints render as unauthenticated in the UI.
- The spec is built once when `start()` runs (not per-request).

## Logging

`Samble.create()` writes `logs/` next to the process, and the console gets
everything either way. Nothing to turn on: a developer who has to discover an
option before they can read what their application did is a developer who never
reads it.

```
logs/
├─ app.log        every level, in one chronological stream
├─ info.log
├─ warn.log
├─ error.log
└─ router.log     the route map — the only one with something in it on boot
```

All five exist from the first boot, empty. **An empty `error.log` says nothing
went wrong; a missing one says nothing at all**, and sends you looking for the
reason it was never created.

`app.log` is the neutral one and is where you read what happened — the split
files are for grepping one kind of thing. The route map stays out of it: it is
a map, not a chronology, and it would be fifty lines of boot noise in front of
the first thing that matters.

The option exists to move it, rename a file, or drop one:

```typescript
logs: { dir: '/var/log/app' }              // somewhere else
logs: { dir: null }                        // console only — what a container wants
logs: { files: { error: 'errores' } }      // errores.log
logs: { files: { info: false } }           // no info.log
logs: { level: 'off' }                     // silence everything, write no files
```

Dropping `info`, `warn` or `error` loses nothing — those lines are still in
`app.log` and on the console — so it is about what you want to grep on its own.
`router` is the exception: it is in no other file, so `false` means there is no
map, and it falls back to the console.

`dir: null` is the container answer: inside one the disk is not where anyone
reads logs, and the files go with the container.

Environment variables override nothing the application passed, and are there
for the same container case:

| Variable          | Description |
| ----------------- | ----------- |
| `SAMBLE_LOG_DIR`   | Directory for the files, when the application does not name one. |
| `SAMBLE_LOG_LEVEL` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `off` (default `trace`). |

`off` writes no files at all — creating them for a logger that says nothing
would leave a directory of empty files behind every test run. And if the
directory cannot be created (permissions, read-only FS), samble degrades to the
console instead of failing to start.

### The route map (`router.log`)

Every boot writes the routes in the order they were mounted:

```
[MAP] /api — registration order; the first match answers
#01 auto GET    /api/auth/me  (MeEndpoint)
#06 p1   GET    /api/products/page  (ProductsPageEndpoint)
#07 p1   GET    /api/products/export  (ExportProductsEndpoint)
#08 p2   GET    /api/products/:id  (GetProductEndpoint)
#10 auto GET    /api/products  (ListProductsEndpoint)
```

It answers one question: **which route wins**. Express matches in registration
order, so `/products/:id` mounted before `/products/page` swallows the page and
the handler receives the literal string `"page"` — a bug that looks like a data
problem. `#nn` is the position across the whole mount, and `p1`/`auto` is the
`@Priority` that put it there (`auto` = none declared, which is the normal
case). It lands in `router.log`; with `dir: null` — or `files: { router: false }`
— it goes to the console instead, because losing the map silently is worse than
printing it.

## Answers that are not JSON

`main()` normally returns data and samble serializes it. When the answer is a
page, a document or a file, return one of the **outputs** instead:

```typescript
import { csv, file, pdf, view } from '@samble/core';

@Group('clients')
@HttpGet()
@Query(ListClientsDto)
export class ListClientsApi extends Endpoint<null, null, ListClientsDto> {
  async main() {
    const clients = await this.db.select().from(clientsTable);

    if (this.query.format === 'csv') {
      return csv(clients, {
        filename: 'Clientes.csv',
        columns: [
          { key: 'name', header: 'Nombre' },
          { key: 'createdAt', header: 'Alta' },
        ],
      });
    }

    return { clients };   // plain data is still JSON
  }
}
```

The decision is made **inside `main()`, with the data in hand** — the same
endpoint can answer JSON or a file depending on what was asked.

| Output | What it does |
| --- | --- |
| `view(template, data?)` | Renders a template and sends the HTML. A template that fails to render comes back as samble's error contract, not an Express stack page. |
| `pdf(content, options?)` | `application/pdf`. Shown in the browser by default; `download: true` saves it. samble does not build the document — pass the bytes from whatever produced them. |
| `csv(rows, options?)` | Builds the file from a list of rows. `columns` chooses which fields go out and their headers; a BOM is written by default so a spreadsheet reads accents correctly. |
| `file(content, options?)` | The general case — any MIME type. `pdf` and `csv` are this with the defaults filled in. |

`content` may be a `Buffer`, a `Uint8Array`, a string or a **stream**, which is
piped rather than buffered. Filenames with accents are sent both sanitized and
as UTF-8 (RFC 5987), so they survive old clients.

Templates still need an engine and a root path:

```typescript
await samble.setTemplates('pug', './views');   // or 'ejs'
```

Pages are usually worth marking `@ApiHidden()` so they stay out of the OpenAPI
spec.

## Routines

Work the application does on its own, on a clock. The third way in, next to an
endpoint (answers a request) and a strategy (one implementation among however
many are deployed): nobody calls
a routine, the schedule does.

```typescript
import { Cron, Routine } from '@samble/core';

@Cron('0 * * * *', { timezone: 'America/Lima' })  // every hour
export class HourlyReport extends Routine {
  start(now: Date | 'manual' | 'init') {
    // this.db, this.get(Contract) and this.notify(Slot, payload) all work here
  }
}
```

The file goes in the module's `routines/` folder and that is all it takes.
Everything is stopped on graceful shutdown.

Two things worth knowing:

- **Set the `timezone`.** Without it the expression is read in the timezone of
  whatever machine the process ended up on, which is how a "7am" routine runs
  at 2am on a server abroad.
- **`now` is not always a `Date`.** It is `'init'` when the routine was
  declared with `{ runOnInit: true }` and ran at startup, and `'manual'` for a
  tick nothing scheduled. Branch on it when the first run should differ.

> Renamed from `Task` / `@Schedule`. "Task" is the most common noun in
> business software — a work order, a case, a to-do — and an application with
> its own `Task` entity had to alias one of the two in every file that used
> both. The old names were removed.

## Environment configuration

`ConfigService` reads from `process.env` (it loads a `.env` file on import via `dotenv`). What matters about each method is **when it fails**.

`ConfigService.require([...])` goes **first in `createApp()`**, before a single value is read, and it names **every** variable that is missing rather than the first one: whoever is filling in a `.env` on a server wants one list, not one more failure per round trip. An **empty value counts as missing** — `DB_PASSWORD=` is what a template looks like before anyone edited it.

`get()` **throws**, naming the variable. It used to be typed `string` and hand back `undefined`, so the value travelled on and broke somewhere else: `+ConfigService.get('DB_PORT')` was `NaN`, and `NaN` reaches the driver as a port, which fails as a connection problem. Use `number()` and `boolean()` for typed values — they fail as what they are — and `optional()` for a value that may legitimately be absent, because saying so reads as a decision while a `get()` wrapped in `?? ''` reads as someone working around a type.

**Careful with reading the environment at module level**: that happens on *import*, which is before `createApp()` runs, so `require()` never gets to report it. A config file that needs a variable should export a **function** called from `createApp()` — which is what `samble init`'s scaffolded session does, for exactly this reason.

An installed **module** names what it needs in its manifest (`env: ['WA_BRIDGE_URL']`). It is checked at boot, **before the database is opened**, and the error gathers every module's missing variables into one list. It goes in the manifest rather than in the module's code so the question "what does this module need from me?" can be answered *without running anything* — which is what [`samble doctor`](./cli.md#samble-doctor) does. Declare only what is REQUIRED: a variable with a default in code is read with `optional()`.

```typescript
import { ConfigService } from '@samble/core';

ConfigService.get('DB_HOST');
ConfigService.mode(); // 'development' | 'production' from NODE_ENV
```

The variables your app needs (database host, credentials, port, etc.) are yours to define and pass to `db` in `Samble.create`; samble does not require any specific names beyond the logging ones above.

## Example app

[`src/`](https://github.com/global-materis/samble/tree/main/src) is a small but complete
Samble application, and [`http/demo.http`](https://github.com/global-materis/samble/tree/main/http/demo.http)
walks the whole flow request by request — 401 vs 403, validation, transactions,
and a module extending another one without either knowing.

Three modules, on purpose:

| Module | | What it shows |
| --- | --- | --- |
| `identity` | | Table + migration with seed data, login/logout/me, a contract other modules consume, permissions, a projection so the password never leaves |
| `catalog` | | `requires`, validation DTOs, `@Priority` done right, a page with `view()`, an export with `csv()`, `db.transaction()` for two writes that must land together |
| `reports` | | Owns no table: it reads the other two through their contracts, fills catalog's extension point and reacts to what it announces — the shape an extension has |

```bash
cp .env.template .env      # fill in DB_* and SECRET_KEY
npm run dev                # migrations run on boot; two users are seeded
```

It is covered by `test/demo-app.spec.ts`, which boots those same three modules
against an in-process Postgres. Example code nobody runs stops being an
example.
