import path from 'path';
import { plan, Plan } from './plan';
import {
  CliError,
  parseTarget,
  Target,
  timestamp,
  toCamel,
  toKebab,
  toPascal,
  toSnake,
} from './names';

/**
 * The templates.
 *
 * They are TypeScript strings and not `.txt` files on purpose. Templates kept as
 * assets are never copied by the build, and they drift until they generate
 * decorators the framework no longer has — a generator nobody
 * could compile and nothing could test. Here they are part of the same build as
 * everything else, and `test/cli.spec.ts` scaffolds a module and BOOTS it, so a
 * template that stops matching the framework fails the suite.
 *
 * They carry NO comments. `samble init` explains the project once, because that
 * file is written once; a generator runs again every day, and an explanation in
 * its output is copied into the tenth endpoint, where it is noise the author has
 * to read past or delete. What the author has to KNOW is printed as a hint by
 * the command that wrote the file — said once, where it is new — and the
 * reasoning lives in the docs.
 */

export interface CommonOptions {
  /** Where modules live, relative to the project root. */
  modulesDir: string;
  /**
   * What the generated code imports the framework from. `samble` everywhere
   * except inside this repository, where the demo imports `lib/` by path.
   */
  from: string;
}

const HTTP_DECORATORS: Record<string, string> = {
  get: 'HttpGet',
  post: 'HttpPost',
  put: 'HttpPut',
  patch: 'HttpPatch',
  delete: 'HttpDelete',
  query: 'HttpQuery',
};

/** Where a module's folder is. */
const moduleDir = (options: CommonOptions, id: string): string =>
  path.posix.join(options.modulesDir.replace(/\\/g, '/'), id);

/** How deep a file inside a module sits, for a relative import of the demo. */
const relativeFrom = (from: string, depth: number): string =>
  from.startsWith('.')
    ? `${'../'.repeat(depth)}${from.replace(/^\.\//, '')}`
    : from;

export interface ModuleOptions extends CommonOptions {
  name: string;
  label?: string;
  /**
   * The file holding `Samble.create({ modules: [...] })`. The module is
   * registered there, which is the step everyone forgets and which shows up as
   * "my routes are 404".
   */
  entry?: string;
}

export function createModule(options: ModuleOptions): Plan {
  const id = toKebab(options.name);
  if (!id) throw new CliError('A module needs a name: samble module <name>.');

  const dir = moduleDir(options, id);
  const label =
    options.label ?? toPascal(id).replace(/([a-z])([A-Z])/g, '$1 $2');
  const from = relativeFrom(options.from, 2);

  const manifest = `${importLine(['defineModule'], from)}

export default defineModule({
  id: '${id}',
  label: '${label}',
  dir: __dirname,

  requires: [],
  permissions: ['${id}.view'],
});
`;

  const endpoint = endpointSource({
    className: `${toPascal(id)}Endpoint`,
    // No `@Group`: the id is the prefix, so the scaffold does not repeat it.
    group: null,
    decorator: 'HttpGet',
    routePath: '',
    // Declared in the manifest, and asserted from the start: `init` writes a
    // resolver that grants everything, so the gate exists and is open.
    permission: { key: `${id}.view` },
    from: relativeFrom(options.from, 3),
  });

  const entry = options.entry ?? 'src/index.ts';
  const variable = toCamel(id);
  const importPath = path.posix.relative(
    path.posix.dirname(entry.replace(/\\/g, '/')),
    `${dir}/module`,
  );

  return plan(
    [
      { path: `${dir}/module.ts`, content: manifest },
      { path: `${dir}/endpoints/${id}.endpoint.ts`, content: endpoint },
    ],
    [
      {
        path: entry,
        arrayEntry: {
          field: 'modules',
          value: variable,
          importLine: `import ${variable} from '${
            importPath.startsWith('.') ? importPath : `./${importPath}`
          }';`,
        },
      },
      {
        // Without this the module's keys stay unchecked: `assert` falls back to
        // accepting any string, and a typo goes back to being a 500.
        path: 'src/config/permissions.ts',
        append: permissionsDeclaration(id, options.modulesDir),
        // The import path, not the whole block: prettier in the consumer's
        // project rewraps it and may change the quotes, and a verbatim check
        // would then append a second copy of what is already there.
        appendUnless: modulePathMarker(id, options.modulesDir),
      },
    ],
    [
      'The manifest names no paths: tables/, migrations/, endpoints/, routines/, providers/ and strategies/ are found from `dir`. Name a field only to say something else.',
      `Everything this module can gate is spelled once, in \`permissions\`. Give a key a { key, label } when it does not say it on its own — the label is what a roles screen shows.`,
    ],
  );
}

/**
 * The permission line.
 *
 * It is LIVE, because `samble init` writes a resolver that lets everyone
 * through: the gate is in place and open, which is the only order in which
 * closing it is a one-line change. A scaffold that ships the assertion
 * commented teaches that endpoints are ungated by default, and the day
 * somebody writes real authentication every endpoint written until then is
 * still open.
 *
 * `--public` leaves it out, for the handful that are meant to be.
 */
function permissionBlock(permission: { key: string } | null): string {
  if (!permission) return '';
  return `    this.auth.assert('${permission.key}');\n\n`;
}

/**
 * Teaches the compiler one module's keys, by appending to the application's
 * `config/permissions.ts`.
 *
 * One `declare global` block per module, merged by TypeScript, and the import
 * is inline — so adding a module is a pure APPEND and no existing line in that
 * file ever has to be reopened.
 */
/**
 * The bit of the appended block that survives a formatter.
 *
 * Quotes are left out on purpose: prettier picks its own, and this has to match
 * either way.
 */
function modulePathMarker(id: string, modulesDir: string): string {
  const from = path.posix.relative(
    'src/config',
    `${modulesDir.replace(/\\/g, '/')}/${id}/module`,
  );
  return from.startsWith('.') ? from : `./${from}`;
}

function permissionsDeclaration(id: string, modulesDir: string): string {
  const from = modulePathMarker(id, modulesDir);
  // The module is reached with an inline `import(...)`, so a new block needs no
  // new import line. `PermissionsOf` cannot be: an interface may only extend an
  // identifier, so that one comes from the file's own import, which `init`
  // writes. The empty-interface rule is disabled at the top of that file, so
  // the block carries no comment of its own.
  return `
declare global {
  namespace SambleAuth {
    interface Permissions extends PermissionsOf<
      typeof import('${from}').default
    > {}
  }
}`;
}

function endpointSource(args: {
  className: string;
  /** `null` leaves the decorator out: the module id is already the prefix. */
  group: string | null;
  decorator: string;
  routePath: string;
  permission: { key: string } | null;
  from: string;
}): string {
  const route = args.routePath ? `'${args.routePath}'` : '';
  const assertion = permissionBlock(args.permission);
  const imports = ['DataJson', 'Endpoint', args.decorator];
  if (args.group) imports.splice(2, 0, 'Group');
  const group = args.group ? `@Group('${args.group}')\n` : '';
  return `${importLine(imports, args.from)}

${group}@${args.decorator}(${route})
export default class ${args.className} extends Endpoint {
  public async main(): Promise<DataJson> {
${assertion}    return { ok: true };
  }
}
`;
}

export interface EndpointOptions extends CommonOptions {
  target: string;
  method?: string;
  /** Path under the group, e.g. \`:id\`. Empty means the group itself. */
  path?: string;
  /** Route prefix (`@Group`). Defaults to the module id, with no decorator. */
  group?: string;
  /**
   * A key to assert LIVE, or `false` for an endpoint with no permission line
   * at all. Left out, the key is `<module>.view` and the assertion is written
   * commented, because asserting needs an `auth` resolver and a fresh project
   * has none.
   */
  permission?: string | false;
}

export function createEndpoint(options: EndpointOptions): Plan {
  const target = parseTarget(options.target, 'endpoint');
  const method = (options.method ?? 'get').toLowerCase();
  const decorator = HTTP_DECORATORS[method];
  if (!decorator) {
    throw new CliError(
      `"${method}" is not an HTTP method samble mounts. Use one of: ${Object.keys(
        HTTP_DECORATORS,
      ).join(', ')}.`,
    );
  }

  const dir = moduleDir(options, target.module);
  // `Endpoint`, never `Api`: `Api` is an old base-class name, and a generator
  // that keeps writing the old name teaches the old framework.
  const className = `${toPascal(target.name)}Endpoint`;

  const asked = typeof options.permission === 'string';
  const permission =
    options.permission === false
      ? null
      : {
          key: asked ? (options.permission as string) : `${target.module}.view`,
        };

  // A key that no module declares is a 500, not a 403 — on purpose, because it
  // is a typo and not a missing grant. So asking for one here has to DECLARE
  // it too, or the generator would write code that cannot run.
  const own = permission?.key.startsWith(`${target.module}.`) ?? false;
  const edits =
    permission && own
      ? [
          {
            path: `${dir}/module.ts`,
            arrayEntry: {
              field: 'permissions',
              value: `'${permission.key}'`,
              unless: `'${permission.key}'`,
            },
          },
        ]
      : [];

  const hints = [
    'Validate what comes in with @Body(Dto) / @Params(Dto) / @Query(Dto).',
    'A literal route that a `:param` sibling would swallow needs @Priority(1); the router log shows the resulting order.',
  ];
  if (permission && !own) {
    hints.push(
      `"${permission.key}" belongs to another module, so it was not declared here. It must exist in that module's permissions or the assertion is a 500, not a 403.`,
    );
  } else if (permission && asked) {
    hints.push(
      `"${permission.key}" was added to ${target.module}'s manifest. Give it a { key, label } there if the key does not say it on its own — the label is what a roles screen shows.`,
    );
  } else if (permission) {
    hints.push(
      `It asserts "${permission.key}" because that is the key a module starts with. An endpoint that WRITES wants its own: pass --permission ${target.module}.<key>.`,
    );
  }

  return plan(
    [
      {
        path: `${dir}/endpoints/${target.name}.endpoint.ts`,
        content: endpointSource({
          className,
          group: options.group ?? null,
          decorator,
          routePath: options.path ?? '',
          permission,
          from: relativeFrom(options.from, 3),
        }),
      },
    ],
    edits,
    hints,
  );
}

export interface RoutineOptions extends CommonOptions {
  target: string;
  cron?: string;
  /** `false` writes it registered but stopped, for a schedule somebody starts. */
  autostart?: boolean;
}

export function createRoutine(options: RoutineOptions): Plan {
  const target = parseTarget(options.target, 'routine');
  const dir = moduleDir(options, target.module);
  const className = `${toPascal(target.name)}Routine`;
  const tokenName = toPascal(target.name);
  const cron = options.cron ?? '0 7 * * *';
  const from = relativeFrom(options.from, 3);
  const autostart = options.autostart === false;

  // TWO files, and both belong to this module: unlike a slot's, a routine's
  // token is not somebody else's — a module owns its own schedule, so the token
  // goes where the module's other tokens go.
  const tokenContent = `${importLine(['token'], from)}

export const ${tokenName} = token('${target.module}.${target.name}', 'schedule');
`;

  const content = `${importLine(['Cron', 'Routine'], from)}
${importLine([tokenName], `../tokens/${target.name}.token`)}

@Cron(${tokenName}, '${cron}'${autostart ? ', { autostart: false }' : ''})
export default class ${className} extends Routine {
  public async start(now: Date | 'manual' | 'init'): Promise<void> {
    console.log('[${target.module}] ${target.name} ran', now);
  }
}
`;

  return plan(
    [
      { path: `${dir}/tokens/${target.name}.token.ts`, content: tokenContent },
      { path: `${dir}/routines/${target.name}.routine.ts`, content },
    ],
    [],
    [
      `Cron expression: '${cron}' — change it in the @Cron decorator. Set a timezone there too, or it follows the server's.`,
      autostart
        ? `It is registered and NOT running: start it with this.schedule(${tokenName}).start() from an endpoint, or app.schedule(${tokenName}).start() from outside.`
        : `It starts once the server is listening and stops on shutdown. this.schedule(${tokenName}).stop() pauses it without a restart, and start() on something already running does nothing.`,
      "`this.db`, `this.get(Contract)` and `this.notify(Slot, payload)` work here exactly as in an endpoint. `now` is a Date, or 'init' when @Cron got runOnInit.",
    ],
  );
}

/**
 * A named import, and a `token(id, kind)` declaration, wrapped the way prettier
 * would wrap them.
 *
 * The scaffolded project runs `prettier --check`, and the width depends on the
 * module and the name, which only the generator knows: `samble token
 * subscriptions/invoice-line-renderers slot` goes past 80 columns and
 * `samble token shop/tags slot` does not. Getting it wrong means a generated
 * file fails the project's own lint on the first commit.
 */
function importLine(names: string[], from: string): string {
  const oneLine = `import { ${names.join(', ')} } from '${from}';`;

  if (oneLine.length <= 80) return oneLine;

  const listed = names.map((name) => `  ${name},`).join('\n');
  return `import {\n${listed}\n} from '${from}';`;
}

function tokenDeclaration(args: {
  constName: string;
  typeName: string;
  id: string;
  kind: 'contract' | 'slot';
}): string {
  const { constName, typeName, id, kind } = args;
  const oneLine = `export const ${constName} = token<${typeName}>('${id}', '${kind}');`;

  if (oneLine.length <= 80) return oneLine;

  return `export const ${constName} = token<${typeName}>(\n  '${id}',\n  '${kind}',\n);`;
}

export interface TokenOptions extends CommonOptions {
  target: string;
  kind: 'contract' | 'slot';
  /** For a slot: the host announces into it and reads nothing back. */
  reaction?: boolean;
}

/**
 * A token: the one file another module imports.
 *
 * All three go in `tokens/` because they are one thing — a name with a type,
 * and how many may answer it. Splitting them across `contracts/`, `slots/` and
 * `schedules/` asked the author to file a decision they had already made in the
 * call itself.
 *
 * samble does NOT glob that folder: a token is imported by name, so there is
 * nothing to discover. The folder is for people.
 */
export function createToken(options: TokenOptions): Plan {
  const target = parseTarget(options.target, 'token');
  const dir = moduleDir(options, target.module);
  const from = relativeFrom(options.from, 3);
  const id = `${target.module}.${target.name}`;
  const name = toPascal(target.name);

  let body: string;
  let hints: string[];

  if (options.kind === 'slot' && options.reaction) {
    // A reaction slot: the host ANNOUNCES and reads nothing back. What the
    // module declares is the payload; `Reaction<T>` is the method, so nobody
    // has to invent a name for it.
    const payload = `${name}Payload`;

    body = `export interface ${payload} {
  id: number;
}

${tokenDeclaration({
  constName: name,
  typeName: `Reaction<${payload}>`,
  id,
  kind: 'slot',
})}`;

    hints = [
      `Announce it: await this.notify(${name}, { id }) from an endpoint, a routine, a provider or a strategy.`,
      `React to it from any module: samble strategy <module>/<name> ${target.name}, then implement Reaction<${payload}>.`,
      'A reaction that throws does NOT fail whoever announced it: the failure is logged with its module. When the outcome matters to the caller, that is a contract.',
      'Reactions read on their own connection, so they cannot see rows a transaction has not committed. Announce AFTER it commits, or put what they need in the payload.',
    ];
  } else if (options.kind === 'slot') {
    // A slot has TWO names: the token is the collection, the interface is ONE
    // contribution. A trailing "s" is the usual difference; rename if it
    // guessed wrong.
    const item = name.endsWith('s') ? name.slice(0, -1) : `${name}Entry`;

    body = `export interface ${item} {
  id: string;
}

${tokenDeclaration({ constName: name, typeName: item, id, kind: 'slot' })}`;

    hints = [
      `${item} is the shape of ONE contribution; ${name} is the collection.`,
      `Read it: const filled = this.all(${name}). An empty array is a normal answer — a slot nobody filled is a feature nobody installed.`,
      `Fill it from another module: samble strategy <module>/<name> ${target.name}`,
      `Note the direction: "${target.module}" opens it and knows nothing about who fills it, which is what keeps the host independent of its own extensions.`,
    ];
  } else {
    body = `export interface ${name} {
  describe(): Promise<string>;
}

${tokenDeclaration({ constName: name, typeName: name, id, kind: 'contract' })}`;

    hints = [
      'Rename describe(): it is the promise the rest of the application relies on.',
      `Answer it: samble provider ${target.module}/${target.name}`,
      `It is what other modules may ask "${target.module}" for WITHOUT importing anything else from it: they import this file, and the implementation stays private, in ./providers.`,
      `A module that CALLS it should list it in \`consumes\`, so a missing provider stops the boot instead of the first request that needs it.`,
    ];
  }

  const content = `${importLine(
    options.kind === 'slot' && options.reaction
      ? ['Reaction', 'token']
      : ['token'],
    from,
  )}

${body}
`;

  return plan(
    [{ path: `${dir}/tokens/${target.name}.token.ts`, content }],
    [],
    hints,
  );
}

export interface ProviderOptions extends CommonOptions {
  target: string;
}

/**
 * The class that answers a contract this module owns.
 *
 * Filling somebody ELSE's extension point is a different command, because it is
 * a different relationship: see {@link createStrategy}.
 */
export function createProvider(options: ProviderOptions): Plan {
  const target = parseTarget(options.target, 'provider');
  const dir = moduleDir(options, target.module);
  const name = toPascal(target.name);
  const from = relativeFrom(options.from, 3);

  const tokenImport = importLine([name], `../tokens/${target.name}.token`);

  const content = `${importLine(['Provides', 'Provider'], from)}
${tokenImport}

@Provides(${name})
export class ${name}Provider extends Provider implements ${name} {
  public async describe(): Promise<string> {
    return '${target.module}';
  }
}
`;

  return plan(
    [{ path: `${dir}/providers/${target.name}.provider.ts`, content }],
    [],
    [
      'Nothing lists it: the folder is what registers it, and the decorator says which contract it answers.',
      'It is the half the consumer never sees: change how it works and nothing outside the file moves.',
      '`this.db`, `this.get(Contract)`, `this.all(Slot)` and `this.notify(Slot, payload)` are injected BEFORE the instance is built, so a field initializer can already reach for a repository. Built the first time someone asks for it, then reused.',
    ],
  );
}

export interface StrategyOptions extends CommonOptions {
  target: string;
  /** The extension point it fills, as the host named it. */
  slot: string;
}

/**
 * One implementation of a domain interface another module opened.
 *
 * Its own command, and its own folder, because it is not this module's public
 * face: nobody asks for it by name, the host runs it, and the interface it
 * implements belongs to the host. A `Provider` answering a contract is the
 * other relationship entirely.
 */
export function createStrategy(options: StrategyOptions): Plan {
  const target = parseTarget(options.target, 'strategy');
  const dir = moduleDir(options, target.module);
  const name = toPascal(target.name);
  const from = relativeFrom(options.from, 3);

  // A slot has TWO names: the token is the collection, the interface is ONE
  // contribution. A strategy implements the interface and is registered under
  // the token — mixing them up does not compile, so the template must not.
  const slotFile = toKebab(options.slot);
  const token = toPascal(options.slot);
  const implemented = token.endsWith('s')
    ? token.slice(0, -1)
    : `${token}Entry`;

  const content = `${importLine(['Fills', 'Strategy'], from)}
${importLine([implemented, token], `@/<module>/tokens/${slotFile}.token`)}

@Fills(${token})
export class ${name} extends Strategy implements ${implemented} {
  public readonly id = '${target.name}';
}
`;

  return plan(
    [{ path: `${dir}/strategies/${target.name}.strategy.ts`, content }],
    [],
    [
      'Point the import at the module that opened the slot — replace <module>: an extension imports the token, never the other way round.',
      `Implement ${implemented} as the host declared it. The host decides what a contribution receives and what it may answer, including answering null for "does not apply".`,
      'Throwing here FAILS the host\u2019s request when the host reads the slot with all(). A slot the host announces into with notify() is isolated instead: the failure is logged and the announcer answers anyway.',
      'Built once and reused for the life of the application, so never keep per-request state in one.',
    ],
  );
}

export interface TableOptions extends CommonOptions {
  target: string;
  /** The name in SQL. Defaults to `<module>_<name>`, both snake_cased. */
  table?: string;
}

/**
 * A table, and the two row types that go with it.
 *
 * The prefix is not decoration: every module's tables share one namespace, and
 * `billing_charge` is what keeps two modules from both wanting `charge`. It is
 * also what makes a database readable by module at a glance.
 *
 * `$inferSelect` and `$inferInsert` are written out because they are what the
 * rest of the module passes around — a function taking a row wants the type,
 * and deriving it at each call site is how two of them end up disagreeing.
 */
export function createTable(options: TableOptions): Plan {
  const target = parseTarget(options.target, 'table');
  const dir = moduleDir(options, target.module);
  const rowType = toPascal(target.name);
  const constName = toCamel(target.name);
  const table =
    options.table ?? `${toSnake(target.module)}_${toSnake(target.name)}`;

  const content = `${importLine(
    ['pgTable', 'serial', 'text'],
    'drizzle-orm/pg-core',
  )}

export const ${constName} = pgTable('${table}', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export type ${rowType} = typeof ${constName}.$inferSelect;
export type New${rowType} = typeof ${constName}.$inferInsert;
`;

  return plan(
    [{ path: `${dir}/tables/${target.name}.table.ts`, content }],
    [],
    [
      `The table is not created by declaring it: generate the migration — samble migration:generate ${target.module}/create-${target.name}.`,
      `Read it: this.db.select().from(${constName}), typed from the table without passing a schema anywhere.`,
      'An ENUM has to be EXPORTED from a file under tables/, not only used by a column: a schema without it generates DDL that references a type nothing creates.',
    ],
  );
}

export interface MigrationOptions extends CommonOptions {
  target: string;
  /** Injectable for tests; defaults to now. */
  now?: number;
}

export function createMigration(options: MigrationOptions): Plan {
  const target = parseTarget(options.target, 'migration');
  const dir = moduleDir(options, target.module);
  const stamp = options.now ?? timestamp();
  const className = `${toPascal(target.name)}${stamp}`;
  const file = `${stamp}-${target.name}`;
  const from = relativeFrom(options.from, 3);

  const content = `import { sql } from 'drizzle-orm';
import type { Migration, Transaction } from '${from}';

export class ${className} implements Migration {
  public async up(db: Transaction): Promise<void> {
    await db.execute(
      sql.raw(\`
        -- what this migration creates
      \`),
    );

    throw new Error(
      '${className} has no SQL yet: write it, or delete the file.',
    );
  }

  public async down(db: Transaction): Promise<void> {
    await db.execute(
      sql.raw(\`
        -- how to undo it
      \`),
    );
  }
}
`;

  return plan(
    [{ path: `${dir}/migrations/${file}.ts`, content }],
    [],
    [
      'Migrations run per module, before any route is mounted. Inside a module the trailing timestamp is the order — nothing lists them, and samble refuses a migration class without one.',
      'It THROWS until you write its SQL, and deleting that line is the last step. An empty migration SUCCEEDS — a query that is only a comment runs fine — so it would be recorded as applied, `samble migrate` would keep answering "nothing to migrate", and the SQL written afterwards would never run.',
      `Or let it be written from your tables: samble migration:generate ${target.module}/${target.name}`,
    ],
  );
}

/** Everything the CLI can scaffold, for the help text and for tests. */
export const GENERATORS = {
  module: createModule,
  endpoint: createEndpoint,
  routine: createRoutine,
  token: createToken,
  provider: createProvider,
  strategy: createStrategy,
  table: createTable,
  migration: createMigration,
} as const;

export type { Target };
