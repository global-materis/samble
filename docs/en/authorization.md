# Authorization

Who is making the request, and what they are allowed to do.

samble stores **no users and no roles**. It receives a list of permission keys
per request and compares strings. Everything below is about who produces that
list and who checks it.

## The three responsibilities

They are separate on purpose, and nothing works until all three are present.

| Responsibility | Where it lives | Who decides |
| --- | --- | --- |
| Which keys **exist** | the module's manifest | the module |
| Which keys somebody **holds** | your `auth` resolver | your application |
| Which keys an endpoint **demands** | `this.auth.assert(...)` | the endpoint |

The endpoint never learns that users exist. The user never learns that
endpoints exist. They meet at the key.

---

# Step by step

## 1. What a new project starts with

`samble init` writes `src/config/auth.ts`: a resolver that lets **everyone**
through with every permission, and warns once in the log the first time it
does. It is not authentication. It is there so `this.auth` works, the generated
`this.auth.assert(...)` lines pass, and the permission keys are checked by the
compiler from the first request — the gate in place and open, so closing it
later is one file.

Replace its body (step 3) and everything already written starts being enforced.

`auth` is required by `Samble.create()`, so "who is calling" always has an
answer somebody chose. What stays optional is **gating**: an endpoint that never
reads `this.auth` checks nothing, and that is what `--public` scaffolds.

```typescript
@HttpGet()
export default class ListTasksEndpoint extends Endpoint {
  public async main() {
    return this.db.select().from(tasks);
  }
}
```

This answers 200 to anybody. Everything that follows is what you add when that
stops being what you want.

## 2. Declare the keys the module can gate

In the manifest, and nowhere else. This is the only place a key is spelled:

```typescript
// src/modules/tasks/module.ts
export default defineModule({
  id: 'tasks',
  version: '1.0.0',
  core: true,
  dir: __dirname,

  permissions: [
    'tasks.view',
    'tasks.manage',
    // Text only where the key cannot carry it on its own.
    { key: 'tasks.assign', label: 'Hand a task to somebody else' },
  ],
});
```

Then name the module once, in the application's `src/config/permissions.ts`:

```typescript
import type { PermissionsOf } from '@samble/core';

declare global {
  namespace SambleAuth {
    interface Permissions
      extends PermissionsOf<typeof import('../modules/tasks/module').default> {}
  }
}
```

That is what makes the keys CHECKED while they stay plain strings:
`this.auth.assert('tasks.manage')` reads the way it always did, and
`'tasks.mange'` does not compile — TypeScript even suggests the right spelling.
It **reads** the keys off the manifest rather than restating them, so there is
no second list to keep in sync.

One `declare global` block per module, merged by TypeScript, so adding a module
is an append and nothing here is ever reopened. That is also why this is an
interface and not a union: a union cannot be merged, so every new module would
have to reopen one declaration. And the module is reached with a type-only
inline `import(...)`, so naming it costs no import line and cannot create a
cycle.

`samble init` writes `config/permissions.ts` with an empty starter block, and
`samble module` appends the real one. `samble endpoint tasks/assign --permission
tasks.assign` adds the key to the module's array in the same pass. Nothing has
to be wired by hand.

Two rules the manifest enforces at import time, before anything boots:

- **The key must start with the module id.** `tasks.view` is valid inside the
  `tasks` module; `billing.view` is not. Every installed module, including
  third-party ones, shares a single key space, so the id is what keeps two
  modules from meaning different things by the same word.
- **A `label`, if you write one, cannot be empty.** Whoever wrote it meant to
  say something; omitting the field is how you say nothing.

### When to write a label

The label is **optional**, and the reason is that a key like
`billing.invoices.void` already says it. A label that restates the key in a
sentence is one more string somebody has to keep true, and it buys nothing.

Write one when the key cannot carry the meaning by itself. Two cases where it
usually cannot:

- The key hides part of what it grants. `tasks.manage` does not say that
  reassigning is included.
- The module came from **somewhere else**. The operator is then reading a
  namespace they did not write, and the key is all they have.

What a label does NOT do: it never reaches a client. A 403 carries the **key**,
in `detail` and in `missing` — see [403](#403--signed-in-not-allowed). The
label is for the screen where a role is built, which is the only thing that
reads `app.permissions()`. If your roles are fixed in code, nothing reads it and
bare keys are the honest choice.

It is also not developer documentation: TypeScript shows no docs for a string
literal, so neither a label nor a JSDoc comment appears when you type
`assert('tasks.…')`. Whatever explains a key to whoever writes code belongs in
the module's own README or beside the key in the manifest.

The catalog of every declared key is `app.permissions()`:

```typescript
[
  { key: 'tasks.view', moduleId: 'tasks' },
  { key: 'tasks.manage', moduleId: 'tasks' },
  { key: 'tasks.assign', label: 'Hand a task to somebody else', moduleId: 'tasks' },
]
```

To grant everything one module has, spread its keys instead of listing them —
`[...tasks.permissionKeys]` — so a role stays right when the module gains a key.

It is built from every module **present in the code**. A key exists because a
manifest declares it, and that depends on nothing else.

## 3. Turn a request into an actor

One function, passed to `Samble.create()`. It runs once per request.

```typescript
// src/config/roles.ts — your policy, not the framework's
import { permissions as tasks } from '../modules/tasks/permissions';

export const PERMISSIONS_BY_ROLE: Record<UserRole, string[]> = {
  owner: ['*'],                                  // everything, see below
  agent: ['tasks.view', 'tasks.manage'],         // checked, see step 2
  viewer: ['tasks.view'],
  auditor: [...tasks],                           // everything THIS module has
};
```

```typescript
// src/config/session-auth.ts
import { defineAuth } from '@samble/core';

const sessionAuth = defineAuth(async (request, { db }) => {
  const userId = request.session?.userId;
  if (!userId) return null;                 // anonymous

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;                   // deleted mid-session

  return {
    actor: { userId },
    permissions: PERMISSIONS_BY_ROLE[user.role],
  };
});
```

```typescript
// src/index.ts
const app = await Samble.create({ db, modules, version, auth: sessionAuth });
```

Three things about the return value:

- **`null` means anonymous.** Not an error: an endpoint that demands nothing
  still answers.
- **`actor` is whatever your application says it is.** samble declares the shape
  empty and you widen it once (see *Typing the actor* below). A user id, a
  tenant, an API key issued to an integration are all valid.
- **`permissions` is a plain list of strings.** Where it comes from is yours: a
  constant like the one above, a column, a join table, a call to another
  service.

The session holds **only the user id**. Permissions are read per request, not
copied in at login, so removing a role takes effect on the next request rather
than the next sign-in. That costs one lookup per request. Start there, and
reach for *Caching what the resolver answered* below only once it shows up in a
measurement.

`defineAuth` is what `samble init` writes and what the examples here use. It
types the callback's two arguments without annotating anything, and it checks
the result before an endpoint can read it: an object without an `actor` would
otherwise leave `this.auth` saying `isAuthenticated` while `actor` is
`undefined` — the 401 that should have happened never does, and the failure
turns up later somewhere else. That is a mistake in the code, so it throws a
500, not a 401.

The `AuthResolver` type is still exported, and `auth:` still takes any plain
function of that shape. Nothing that already works stops working.

### More than one way in

The resolver is one function, but the ways into an application are plural: a
cookie for the web, a bearer token for the mobile app, an API key for an
integration. Pass them in order instead of chaining `if`s inside one body — the
first one that recognizes the caller wins, and the rest are never called.

```typescript
export default defineAuth(sessionAuth, bearerAuth, apiKeyAuth);
```

Each one is an ordinary resolver returning `null` for "not mine", so each stays
readable on its own and a new kind of client is one more argument. When all of
them return `null` the call is anonymous, exactly as a single resolver's `null`
is.

### Caching what the resolver answered

That one lookup per request is a fixed tax, paid on the cheap reads that are
most of an API too. Measured through a whole HTTP request against an in-process
Postgres, it was about 40% of the request.

`cacheAuth` remembers the answer per caller:

```typescript
// src/config/auth.ts
export const auth = cacheAuth(defineAuth(sessionAuth, bearerAuth), {
  key: (request) => request.session?.userId ?? null, // null = resolve fresh
  ttl: 15_000,
  max: 5_000, // optional, defaults to 5000
});
```

```typescript
// wherever what somebody may do changes: signing out, a role, a suspension
auth.invalidate(userId);
```

**`invalidate` is not optional.** The TTL is the floor, not the contract:
without the call, a revoked role keeps working until it expires. samble cannot
make the call for you, because it does not know where your roles change.

**Key on the identity, not the credential.** The user id, not the session id: a
role change is then one call and every device that user is signed in on
refreshes, instead of you enumerating their sessions. Reading it from the
session also keeps remote sign-out immediate for free — a session destroyed
server-side loads no `userId`, so the key is `null` and the cache is never
consulted.

Three things it refuses to cache, each because caching it is a bug:

| Not cached | Why |
| --- | --- |
| a `null` key | there is nothing to index the request by |
| a `null` result | it is how somebody signs in and stays anonymous until the TTL runs out |
| a resolver that threw | a malformed credential is a 401 every time, not a remembered one |

Requests that arrive while a resolution is in flight wait on it instead of
starting their own, so a screen firing eight calls at once against a cold cache
still runs the resolver once — which is the moment you wanted the cache for.

There is no timer. Entries expire when they are next read and the least recently
used one is dropped at `max`, so nothing here keeps a process alive or needs
shutting down.

Two limits to know before turning it on:

- **The result is shared between requests.** Treat the actor as immutable.
  Writing to `this.auth.actor` was already a mistake; with a cache it is one
  that other requests can see.
- **It lives in one process.** With more than one replica, `invalidate` in one
  does not reach the others and the guarantee quietly drops back to the TTL.
  Run one process, or keep the TTL short enough that you would accept it as the
  only guarantee.

## 4. Demand a key

```typescript
@HttpPost()
@Body(CreateTaskDto)
export default class CreateTaskEndpoint extends Endpoint<null, CreateTaskDto> {
  public async main() {
    this.auth.assert('tasks.manage');

    const [task] = await this.db
      .insert(tasks)
      .values({ ...this.body, createdBy: this.auth.actor.userId })
      .returning();

    return task;
  }
}
```

`assert()` on the first line, before any work. Reading `this.auth.actor` after
it is safe: if the call were anonymous, `assert` would already have stopped the
request.

## 5. Read what happens

With the resolver above and a user whose role is `agent`
(`['tasks.view', 'tasks.manage']`):

| Request | `assert` | Result |
| --- | --- | --- |
| `POST /api/tasks`, signed in | `tasks.manage` | **200** — holds it |
| `POST /api/tasks/1/assign`, signed in | `tasks.assign` | **403** — known, not allowed |
| `POST /api/tasks`, no cookie | `tasks.manage` | **401** — resolver returned `null` |
| `POST /api/tasks`, owner | `tasks.manage` | **200** — `*` holds everything |
| `GET /api/tasks` (no assert) | — | **200** — anyone, even anonymous |

---

# The three failures, and what each one means

They are different on purpose. Reading the status tells you where to look.

## 401 — nobody is signed in

```json
{
  "type": "/problems/unauthorized",
  "title": "Not authenticated",
  "status": 401,
  "detail": "Unauthorized.",
  "code": "unauthorized",
  "errors": {},
  "requestId": "6eac410efc74"
}
```

The resolver returned `null` and an endpoint demanded something. Tells the
client: authenticate and try again.

## 403 — signed in, not allowed

```json
{
  "type": "/problems/forbidden",
  "title": "Not allowed",
  "status": 403,
  "detail": "Missing permission: tasks.assign.",
  "code": "forbidden",
  "errors": {},
  "missing": ["tasks.assign"],
  "requestId": "6eac410efc74"
}
```

`missing` is the keys `assert()` found absent, structured. They are inside
`detail` as prose too, but a screen that wants to offer "request access to this"
should not have to parse a sentence for them. It exposes nothing new, and it is
absent on a 401 — nobody is signed in, so no key is what is missing.

Tells the client: do not bother retrying. Look at the role, the grant, or the
policy in your resolver.

## 500 — the code is wrong

Two cases, both programming mistakes rather than answers to the caller.

**A key nobody declares:**

```
Unknown permission "tasks.assing": no installed module declares it.
Add it to that module's "permissions" in defineModule().
Did you mean: tasks.assign, tasks.manage, tasks.view?
```

Checked **before** the 401, deliberately: the first request in development is
usually anonymous, which is exactly when you want to hear about a typo. If this
answered 403 you would go looking at roles instead of at the spelling.

**No resolver at all:**

```
This application resolves no actor: pass `auth` to Samble.create()
before reading this.auth.
```

The application never wired authorization up. That is not an unauthorized
visitor, so it must not look like one.

---

# `assert` and `can`

Two verbs, two different jobs.

```typescript
this.auth.assert('tasks.manage');     // stop the request: 401 or 403
if (this.auth.can('tasks.assign')) {  // branch: never throws
  ...
}
```

Use `assert` when the answer is "you may not have this". Use `can` when the
answer changes shape instead of being refused — a column not everyone sees, a
total only a manager gets, an action the response advertises or does not.

```typescript
public async main() {
  this.auth.assert('tasks.view');

  const tasks = await this.repo.find();

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    // Only somebody who could act on it needs to know who is on it.
    assignee: this.auth.can('tasks.assign') ? task.assignee : undefined,
  }));
}
```

Both take **several keys and require all of them**:

```typescript
this.auth.assert('tasks.manage', 'tasks.assign');   // AND, not OR
```

For "one of these", use `can` twice — there is no `assertAny`, on purpose:
writing the OR out makes it visible in review, which is where a permissive gate
should be noticed.

```typescript
if (!this.auth.can('tasks.manage') && !this.auth.can('tasks.assign')) {
  throw new ForbiddenError('You cannot touch this task.');
}
```

## The rest of `this.auth`

| | What it gives | When anonymous |
| --- | --- | --- |
| `this.auth.actor` | the actor | **throws** 401 |
| `this.auth.optional` | the actor or `null` | `null` |
| `this.auth.isAuthenticated` | `boolean` | `false` |
| `this.auth.permissions` | the keys held | `[]` |
| `this.auth.can(...)` | `boolean` | `false` |
| `this.auth.assert(...)` | nothing | **throws** 401 |

`actor` throwing is the point: reading it and checking it existed were two
steps that had to be written together every single time, and forgetting the
second failed silently.

---

# `*`

A resolver may return `['*']`, which holds every permission — present and
future. It is what "owner" usually means.

```typescript
owner: ['*'],
```

It is always a valid key to ask about, even though no module declares it, and
it never trips the unknown-key check. Two consequences worth knowing:

- A module installed next month is immediately usable by an owner, with no edit
  to the role.
- An owner can never be used to test that a gate works. Test with the role that
  should be refused.

---

# Typing the actor

samble declares `Actor` empty. Widen it **once**, anywhere in your application,
and every endpoint sees it:

```typescript
declare global {
  namespace SambleAuth {
    interface Actor {
      userId: number;
      tenantId: string;
    }
  }
}
```

From then on `this.auth.actor.tenantId` is typed, and a resolver that forgets to
return it does not compile.

It is a global namespace and not an exported interface because an interface
re-exported from the package cannot be merged from outside — this is the only
shape a consumer can actually widen.

---

# Recipes

## A public endpoint inside a gated module

Do nothing. No `assert`, no decorator:

```typescript
@HttpGet('public-board')
export default class PublicBoardEndpoint extends Endpoint {
  public async main() {
    return this.repo.findBy({ isPublic: true });
  }
}
```

## Signed in, but no particular permission

```typescript
public async main() {
  const userId = this.auth.actor.userId;   // 401 if anonymous, and that is all
  return this.repo.findBy({ createdBy: userId });
}
```

## Yours, or anybody's with the permission

```typescript
public async main() {
  const task = await this.repo.findOneBy({ id: this.params.id });
  if (!task) throw new NotFoundError('Task not found');

  const mine = task.createdBy === this.auth.actor.userId;
  if (!mine && !this.auth.can('tasks.manage')) {
    throw new ForbiddenError('This task is not yours.');
  }

  return task;
}
```

## Serving both anonymous and signed-in callers

```typescript
public async main() {
  const actor = this.auth.optional;        // null instead of throwing
  return actor
    ? this.repo.findBy({ createdBy: actor.userId })
    : this.repo.findBy({ isPublic: true });
}
```

## Everything one module declares

A set spreads into its keys, which is the "this role owns this module" grant
without listing them one by one — and without `*`, which would also hand over
every other module:

```typescript
import { permissions as tasks } from '../modules/tasks/permissions';
import { permissions as billing } from '../modules/billing/permissions';

manager: [...tasks, ...billing],
```

## Policy in the database instead of a constant

The resolver is the only thing that changes. Nothing else in the application
knows the difference.

```typescript
const sessionAuth = defineAuth(async (request, { db }) => {
  const userId = request.session?.userId;
  if (!userId) return null;

  const rows = await db.query(
    `select p.key from user_roles ur
       join role_permissions p on p.role_id = ur.role_id
      where ur.user_id = $1`,
    [userId],
  );

  return { actor: { userId }, permissions: rows.map((row) => row.key) };
});
```

To validate the roles screen against what actually exists, feed it
`app.permissions()` — the list comes from the modules, so a module added later
shows up without editing a central file.

---

# Where `this.auth` does not exist

Only an `Endpoint` has it, because only a request has an actor behind it.

- **A routine** runs because the clock said so. Nobody asked for it, so there is
  nothing to authorize. If it acts on somebody's behalf, that has to be data it
  reads, not an ambient actor.
- **A reaction** (`Reaction<T>`) runs because another module announced something.
  If the actor matters, the payload carries it — `RestockPayload` in the demo
  carries `userId` for exactly this reason.
- **The resolver itself** obviously cannot use it.

---

# Rules for keys

- Must start with the module id, then at least one more dotted segment:
  `tasks.view`, `tasks.board.export`. The manifest refuses a key that does not,
  so the prefix is not a convention you can forget.
- Lowercase, digits and dashes: `customer-portal.view` is fine, `Tasks.View` is
  not.
- No duplicates inside one module.
- All of this is checked when the manifest is imported, so a bad key is a
  refusal to start rather than a surprise later.

A useful convention, not a rule: `<module>.<thing>.<action>` once a module gates
more than a couple of things — `catalog.products.view`,
`catalog.products.manage`. The typo suggestion lists the keys sharing the first
segment, so a consistent namespace makes the error message useful.

---

# Troubleshooting

| Symptom | Cause |
| --- | --- |
| 500 `resolves no actor` | No `auth` in `Samble.create()`, and something read `this.auth`. |
| 500 `Unknown permission` | The key is in no manifest — usually a typo, sometimes a key written in the endpoint and never declared. |
| 403 for everybody, always | The resolver returns `permissions: []`, or the role map has no entry for that role (`undefined` reaches the check as empty). |
| 401 while signed in | The resolver returned `null`: the session has no `userId`, or the user row is gone. |
| Everything passes, nothing is gated | The scaffold resolver in `src/config/auth.ts` is still there: it grants `*` to everyone. It warns once in the log the first time it does. |
| A key vanished from the roles screen | You are listing from somewhere other than `app.permissions()`, which reads the manifests. |
| Works for the owner, not for anyone else | `*` holds everything. Test with a role that should be refused. |
