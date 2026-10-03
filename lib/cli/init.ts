import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import type { DialectName } from '../modules/database';
import { CliError, toKebab } from './names';
import { plan, Plan } from './plan';

/**
 * `samble init` — a project that runs.
 *
 * The pieces are small but there are enough of them to get one wrong and spend
 * an evening on it: decorators need two compiler flags, and a validated DTO
 * breaks under `strictPropertyInitialization`. Neither is interesting, and both
 * are the same every time.
 */

export interface InitOptions {
  /** Project name. Also the folder, when it is not the current one. */
  name: string;
  /** Version of samble to depend on. */
  sambleVersion: string;
  /** Where modules will live. */
  modulesDir?: string;
  /**
   * The database engine. The operator's choice: it decides the driver, the
   * \`.env\`, the test database and the session store suggested — and nothing
   * for another engine is installed. Defaults to \`postgres\`.
   */
  dialect?: DialectName;
}

/**
 * What changes per engine in a new project, in one table.
 *
 * Kept as data so the rest of \`init\` reads the same for every engine, and so
 * a fourth engine is one more row here instead of a branch in every template.
 */
interface EngineScaffold {
  label: string;
  /** Runtime driver. */
  driver: Record<string, string>;
  /** Only what the TEST database needs on this engine. */
  testDeps: Record<string, string>;
  /** The variables createApp() requires, besides SESSION_SECRET. */
  required: string[];
  /** The \`db\` option, as code. */
  options: string;
  /** The .env lines for the database. */
  env: (name: string) => string;
  /** How a session store for this engine is built over app.db. */
  sessionStore: string;
  /** Extra lines for .gitignore. */
  ignore: string[];
}

const ENGINES: Record<DialectName, EngineScaffold> = {
  postgres: {
    label: 'PostgreSQL',
    driver: { pg: '^8.11.2' },
    testDeps: { '@electric-sql/pglite': '^0.5.8' },
    required: ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'],
    options: `{
      dialect: 'postgres',
      host: ConfigService.get('DB_HOST'),
      // \`number\` and not \`+get(...)\`: a value with a stray space or a
      // comment on the line would reach the driver as NaN.
      port: ConfigService.number('DB_PORT'),
      user: ConfigService.get('DB_USERNAME'),
      password: ConfigService.get('DB_PASSWORD'),
      database: ConfigService.get('DB_NAME'),
    }`,
    env: (name) => `DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=
DB_NAME=${name}
`,
    sessionStore: ` *   // npm install connect-pg-simple
 *   const PgStore = connectPgSimple(session);
 *   app.use(buildSession(new PgStore({ pool: app.db.$client as Pool })));`,
    ignore: [],
  },
  mysql: {
    label: 'MySQL / MariaDB',
    driver: { mysql2: '^3.11.0' },
    testDeps: {},
    // No DB_PASSWORD: read with optional() below, see why there.
    required: ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_NAME'],
    options: `{
      dialect: 'mysql',
      host: ConfigService.get('DB_HOST'),
      // \`number\` and not \`+get(...)\`: a value with a stray space or a
      // comment on the line would reach the driver as NaN.
      port: ConfigService.number('DB_PORT'),
      user: ConfigService.get('DB_USERNAME'),
      // optional(): a local MySQL often has an EMPTY root password, and an
      // empty value counts as missing for require().
      password: ConfigService.optional('DB_PASSWORD') ?? '',
      database: ConfigService.get('DB_NAME'),
    }`,
    env: (name) => `DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_NAME=${name}

# Where the tests create (and drop) a database of their own. There is no MySQL
# inside the process, so they need a server: an account allowed to create
# databases.
SAMBLE_TEST_MYSQL_URL=mysql://root@localhost:3306
`,
    sessionStore: ` *   // npm install express-mysql-session
 *   const MySQLStore = expressMySqlSession(session);
 *   app.use(buildSession(new MySQLStore({}, app.db.$client as Pool)));`,
    ignore: [],
  },
  sqlite: {
    label: 'SQLite',
    driver: { '@libsql/client': '^0.18.0' },
    testDeps: {},
    required: ['DB_URL'],
    options: `{
      dialect: 'sqlite',
      url: ConfigService.get('DB_URL'),
      // Only for a libsql server; a local file needs none.
      authToken: ConfigService.optional('DB_AUTH_TOKEN'),
    }`,
    env: (
      name,
    ) => `# A local file, or a libsql server URL (then also DB_AUTH_TOKEN).
DB_URL=file:${name}.db
`,
    sessionStore: ` *   // SQLite has no store over a libsql client yet: pick one that keeps its
 *   // own file, or keep sessions in memory while this is a single process.`,
    ignore: ['*.db', '*.db-journal', '*.db-wal', '*.db-shm'],
  },
};

/** Every engine, in the order \`init\` offers them. */
export const ENGINE_CHOICES: { dialect: DialectName; label: string }[] = (
  Object.keys(ENGINES) as DialectName[]
).map((dialect) => ({ dialect, label: ENGINES[dialect].label }));

export function createProject(options: InitOptions): Plan {
  const name = toKebab(options.name);
  if (!name) throw new CliError('A project needs a name: samble init <name>.');

  const modulesDir = options.modulesDir ?? 'src/modules';
  const dialect = options.dialect ?? 'postgres';
  const engine = ENGINES[dialect];
  // Wrapped the way prettier wraps it: the project runs `prettier --check`,
  // and prettier joins the call onto one line whenever it fits in 80.
  const requiredCall = (names: string[]) => {
    const list = `[${names.map((name) => `'${name}'`).join(', ')}]`;
    const spread = `...(options.db ? [] : ${list})`;
    const oneLine = `  ConfigService.require(['SESSION_SECRET', ${spread}]);`;
    if (oneLine.length <= 80) return oneLine;
    const item = `    ${spread},`;
    const entry =
      item.length <= 80
        ? item
        : `    ...(options.db\n      ? []\n      : ${list}),`;
    return `  ConfigService.require([\n    'SESSION_SECRET',\n${entry}\n  ]);`;
  };
  const json = (deps: Record<string, string>) =>
    Object.entries(deps)
      .map(([pkg, range]) => `,\n    "${pkg}": "${range}"`)
      .join('');

  const pkg = `{
  "name": "${name}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts",
    "build": "samble build",
    "start": "node build/index.js",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
  },
  "dependencies": {
    "class-validator": "^0.14.0",
    "drizzle-orm": "^0.45.3",
    "express": "^4.18.2",
    "express-session": "^1.18.1",
    "@samble/core": "${options.sambleVersion}",
    "reflect-metadata": "^0.1.13"${json(engine.driver)}
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@jest/globals": "^30.5.2",
    "@types/express": "^4.17.21",
    "drizzle-kit": "^0.31.11",
    "@types/express-session": "^1.18.0",
    "@types/node": "^24.0.0",
    "@types/supertest": "^7.2.1",
    "eslint": "^10.11.0",
    "eslint-config-prettier": "^10.1.8",
    "jest": "^30.5.2",
    "nodemon": "^3.1.0",
    "prettier": "^3.9.9",
    "supertest": "^7.3.1",
    "ts-jest": "^29.4.14",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.70.1"${json(engine.testDeps)}
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": [
      "<rootDir>/test"
    ],
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/${modulesDir}/$1"
    },
    "testTimeout": 30000
  },
  "engines": {
    "node": ">=22.13"
  },
  "samble": {
    "dialect": "${dialect}"
  }
}
`;

  const tsconfig = `{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node10",
    // TS 6 marca \`node10\` como deprecado y TS 7 lo quita. Migrar el resolver
    // cambia cómo se resuelve cada paquete, así que es su propia tarea.
    "ignoreDeprecations": "6.0",
    "rootDir": "src",
    "outDir": "build",
    // \`@/billing/tokens/x.token\` instead of
    // \`../../billing/tokens/x.token\`. A module only ever imports another
    // module's TOKENS, and those are the deep paths.
    //
    // A path alias is compile-time only: \`tsc\` checks it and then emits it
    // verbatim, which Node does not understand. \`samble build\` rewrites them
    // to relative paths, and \`npm run dev\` resolves them with
    // tsconfig-paths. Change this and change the dev script with it.
    "paths": { "@/*": ["./${modulesDir}/*"] },
    "strict": true,
    // Validated DTOs declare fields the constructor never assigns: the
    // validator fills them. With this on, every one of them is an error.
    "strictPropertyInitialization": false,
    // What makes the decorators work. Removing either one turns every route
    // into a silent no-op.
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  // ts-node reads this. Without it the alias above type-checks and
  // \`npm run dev\` dies on the first import: \`paths\` is the compiler's
  // business and Node has never heard of \`@/\`. \`samble build\` rewrites
  // them in the output, so the built app needs nothing.
  "ts-node": { "require": ["tsconfig-paths/register"] },
  "include": ["src"]
}
`;

  const index = `import { ConfigService, Samble, type Database } from '@samble/core';
import auth from './config/auth';
import './config/database';
import buildSession from './config/session';

/** What a caller may hand in instead of reading it from the environment. */
export interface AppOptions {
  /**
   * An open connection. A test passes \`await openTestDatabase()\` — a real
   * Postgres inside the process — and gets the same boot a deployment does.
   * Left out, samble opens one from the environment.
   */
  db?: Database;
}

/**
 * The application: a database, the modules it is made of, and how a request
 * becomes whoever is behind it.
 *
 * Exported so a test or a script can build it without starting a server.
 */
export async function createApp(options: AppOptions = {}) {
  // FIRST, before a single value is read: it names EVERY variable that is
  // missing, instead of one per run. \`samble doctor\` reports the same list
  // without starting anything, which is what an install script should call.
${requiredCall(engine.required)}

  const app = await Samble.create({
    db: options.db ?? ${engine.options},

    // \`samble module <name>\` registers it here.
    modules: [],

    // THIS application's version, not samble's. It is what \`/health\` reports
    // when \`details\` is on, so a deployment can say what it is running.
    version: '1.0.0',

    basePath: '/api',

    // Can this application serve? An unauthenticated 200/503 that a load
    // balancer, a container runtime or an uptime check reads. It answers 503
    // while the database does not, and while the app is shutting down — which
    // is what gives a balancer the window to stop sending traffic before the
    // process stops accepting it. Outside \`basePath\`, and kept out of the
    // access log so a probe every few seconds does not bury every real
    // request.
    // \`checks\` is where YOUR dependencies go: samble only knows the process
    // and the database, and whether a queue, a provider or a warm cache has
    // to be up for this application to serve is something it cannot guess.
    //   checks: { queue: () => bridge.isConnected() },
    health: { path: '/health' },

    // Interactive docs at /docs, the raw OpenAPI 3 at /docs.json — generated
    // from the same decorators that mount the routes, so they cannot drift
    // from what the API does.
    //
    // Worth knowing: this publishes the full shape of your API to anyone who
    // finds the URL. Put it behind your own gate, or drop the option in
    // production, if that is not what you want.
    docs: {
      path: '/docs',
      info: { title: 'API', version: '1.0.0' },
    },

    // Rotating files in \`logs/\`: \`app.log\` with everything in one stream,
    // \`info\`/\`warn\`/\`error\` split out for grepping, and \`router.log\` — the
    // map of what answers where, in registration order, which is the fastest
    // answer to "why is my route a 404".
    //
    // This is only for moving the directory, renaming a file
    // (\`files: { error: 'errores' }\`) or dropping one
    // (\`files: { info: false }\`). \`dir: null\` writes none at all, which is
    // what a container wants: there the disk is not where anyone reads logs,
    // and the files go with the container.
    logs: { dir: 'logs' },

    // No option for the request id: it is always on. Every log line written
    // while serving a request carries it, and so does the error body and the
    // \`x-request-id\` response header. \`requestId: { header: '...' }\` only
    // changes which header carries it, for a gateway that sends its own.

    // Who may call this API from a browser. \`credentials\` sends and accepts
    // cookies, which a session needs — and which forces an explicit list: a
    // browser refuses \`*\` on a request that carries them.
    cors: {
      origin: (ConfigService.optional('CORS_ORIGIN') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      credentials: true,
    },

    // How a request becomes whoever is behind it. See ./config/auth.ts — it
    // lets EVERYONE through, with every permission, so a new project answers
    // from the first request instead of 401ing at a resolver you have not
    // written yet. Replace it before this has users.
    auth,
  });

  // Cookie sessions, before the routes: what a login writes into
  // \`this.request.session\` is what src/config/auth.ts reads back on the next
  // request. Middleware added here runs ahead of every module's routes.
  // In memory until you pass a store — see ./config/session.ts.
  app.use(buildSession());

  return app;
}

async function main() {
  const app = await createApp();
  await app.start(+ConfigService.get('SERVER_PORT') || 3000);
}

// Importing this file must not start a server.
if (require.main === module) void main();
`;

  // Generated per project rather than left as a placeholder: a shared secret
  // signs every session cookie, and a default one that nobody changes is the
  // same as no signature at all.
  const sessionSecret = randomBytes(32).toString('hex');

  const env = `NODE_ENV=development
SERVER_PORT=3000

# Signs the session cookie. Generated for this project; changing it logs
# everyone out, and every process serving this app needs the same value.
SESSION_SECRET=${sessionSecret}

# Origins allowed to call this API from a browser, comma separated. Exact,
# with scheme and port. Empty means no browser may.
CORS_ORIGIN=http://localhost:5173

${engine.env(name.replace(/-/g, '_'))}`;

  const ignore = `node_modules
build
coverage
.env
logs
*.log
.eslintcache
${engine.ignore.map((line) => `${line}\n`).join('')}`;

  // --- How a file is shaped, decided once -----------------------------------
  //
  // Four files, and each one exists because a different reader needs it:
  //
  //   .editorconfig   every editor, including the ones that run no tooling
  //   .prettierrc     Prettier itself, which overrides .editorconfig
  //   eslint.config   what the code MEANS, with formatting left to Prettier
  //   .gitattributes  what git writes to disk, on every machine
  //
  // The values agree across all four on purpose. They also match what the
  // generators emit, so `npm run format` never rewrites a file `samble module`
  // just wrote.

  const editorconfig = `# The shape of a file, for editors that run no tooling at all. Every editor
# worth using reads this, and Prettier reads it too — though .prettierrc wins
# where the two overlap, which is why both carry the same values.
#
# https://editorconfig.org
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
max_line_length = 80

# Two trailing spaces are a line break in Markdown. Trimming them edits the
# text.
[*.md]
trim_trailing_whitespace = false
max_line_length = off

[*.{json,yml,yaml}]
max_line_length = off

# Tabs are part of the format.
[Makefile]
indent_style = tab
`;

  const gitattributes = `# The working tree is LF, on every machine.
#
# Without this, git on Windows checks files out as CRLF while .editorconfig and
# .prettierrc both say LF — so the formatter wants to rewrite every line of
# half the repo, and every diff is noise. \`eol=lf\` wins over whatever
# \`core.autocrlf\` happens to be set to locally, so a Windows and a Linux
# machine agree without anybody configuring git.
* text=auto eol=lf

# Never touched: a byte is a byte.
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.pdf binary
*.woff binary
*.woff2 binary
*.tgz binary
*.pem binary
`;

  // Kept to what the generators emit. Change a value here and the first
  // \`npm run format\` rewrites every file the CLI wrote.
  const prettierrc = `{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80,
  "endOfLine": "lf"
}
`;

  const prettierignore = `build
coverage
logs
node_modules
package-lock.json
`;

  const eslintConfig = `// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat';

/**
 * ESLint decides what the code MEANS. Prettier decides what it LOOKS LIKE.
 *
 * They are kept apart on purpose, which is what Prettier itself recommends:
 * running the formatter as an ESLint rule is slower, fills the editor with red
 * squiggles over things that fix themselves on save, and adds a layer that can
 * break. So \`eslint-config-prettier\` only turns OFF the stylistic rules that
 * would argue with the formatter, and \`npm run format\` is what formats.
 * It goes last in the array, because it works by overriding what came before.
 *
 * Flat config, because \`.eslintrc\` was removed in ESLint 10.
 */
export default defineConfig([
  globalIgnores(['build', 'coverage', 'logs']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],

    languageOptions: {
      parserOptions: {
        // Type information, which the two rules at the bottom need. It costs
        // some speed; it is the only way a linter can see a missing \`await\`.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // \`declare global { namespace SambleAuth { ... } }\` is how an application
      // tells samble what an actor is and which permission keys exist. Ambient
      // declarations stay allowed; a namespace used as a value does not.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],

      // \`interface Permissions extends PermissionsOf<typeof mod> {}\` is empty
      // BECAUSE the keys come from the \`extends\`. Declaration merging needs one
      // such block per module, and there is nothing to put inside them.
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],

      // A warning and not an error: an entity, a query result or a third-party
      // callback will hand you \`any\`, and a build that fails on it teaches
      // people to write \`as unknown as T\` instead.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],

      // The two type-aware rules worth their cost in a backend. A repository
      // call whose promise nobody awaited is data that silently did not get
      // written — no other rule can see it.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // Everything else type-aware lives in \`tseslint.configs.recommendedTypeChecked\`.
  // It catches more and reports a lot against the \`any\`s that come out of an
  // ORM, so turn it on when the codebase is ready to answer for them.

  prettier,
]);
`;

  const vscodeSettings = `{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "files.eol": "\\n",
  "files.insertFinalNewline": true,
  "files.trimTrailingWhitespace": true,
  "[markdown]": {
    "files.trimTrailingWhitespace": false
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
`;

  const vscodeExtensions = `{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "EditorConfig.EditorConfig"
  ]
}
`;

  const permissionTypes = `import type { PermissionsOf } from '@samble/core';

/**
 * Every permission key the installed modules declare, taught to the compiler.
 *
 * With a module listed here, \`this.auth.assert('tasks.manage')\` is a plain
 * string that TypeScript CHECKS: misspell it and the build fails, instead of
 * the framework answering 500 on the first request that reaches the line.
 *
 * Each module spells its own keys ONCE, in its manifest. This file only reads
 * those spellings back off it, so there is no second list to keep in sync.
 * \`samble module\` appends one block per module and interface merging joins
 * them, so nothing below ever has to be reopened — which is also why this is an
 * interface and not a union: a union cannot be merged.
 *
 * \`unknown\` is "no modules yet": every string is accepted and the run-time
 * check is the only net. The blocks that get appended look like this, and this
 * first one can go once there is a real one:
 *
 * declare global {
 *   namespace SambleAuth {
 *     interface Permissions
 *       extends PermissionsOf<typeof import('../modules/<name>/module').default> {}
 *   }
 * }
 */
declare global {
  namespace SambleAuth {
    interface Permissions extends PermissionsOf<unknown> {}
  }
}
`;

  const sessionFile = `import session, { type Store } from 'express-session';
import { ConfigService } from '@samble/core';

/**
 * What the session carries.
 *
 * Every field declared here shows up typed on \`this.request.session\`, in
 * every endpoint, and on \`request.session\` inside the auth resolver. That is
 * the whole reason this block exists: without it TypeScript knows the session
 * is there but not what is in it.
 */
declare module 'express-session' {
  interface SessionData {
    /** Written at login, read by src/config/auth.ts. */
    userId?: number;
  }
}

/**
 * Cookie sessions, mounted before the routes in src/index.ts.
 *
 * \`saveUninitialized: false\` is what keeps a cookie from being handed to
 * every visitor who never signs in, and \`resave: false\` keeps a request that
 * changed nothing from writing to the store.
 *
 * WORTH KNOWING: without a \`store\` they live in memory. Fine while you
 * develop, and wrong in production for two reasons that both bite — they are
 * lost on every restart, and a second process does not see the first one's.
 * When this has users, keep them in the database you already run: pick the
 * \`express-session\` store for YOUR engine and build it over the connection
 * samble opened, \`app.db.$client\`, so there is no second pool. In src/index.ts:
 *
${engine.sessionStore}
 *
 * samble installs no store on purpose: which one depends on the engine, and
 * that is your choice.
 *
 * It is a FUNCTION, and that part matters: reading the environment at module
 * level would happen on import, which is before createApp() runs and therefore
 * before ConfigService.require() can say what is missing. Called from inside
 * createApp(), a missing SESSION_SECRET is reported with everything else.
 */
export default function buildSession(store?: Store) {
  return session({
    store,
    secret: ConfigService.get('SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Over HTTPS only, once this is deployed. Left off in development because
      // a secure cookie is not sent over http://localhost.
      secure: ConfigService.mode() === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}
`;

  const authFile = `import { defineAuth, Logger } from '@samble/core';

/**
 * Whoever is making the request, as THIS application defines it.
 *
 * samble leaves it empty on purpose — a user id, a tenant, an API key issued to
 * an extension are all valid — so the shape is yours. It starts with the one
 * field the session carries; add what your endpoints need to read off
 * \`this.auth.actor\`, and it is typed everywhere at once.
 */
declare global {
  namespace SambleAuth {
    interface Actor {
      userId: number;
    }
  }
}

let warned = false;

/**
 * Turns a request into whoever is behind it. THIS ONE LETS EVERYONE THROUGH.
 *
 * It is here so a new project answers from the first request: \`this.auth\`
 * works, \`this.auth.assert(...)\` passes, the permission keys are checked by
 * the compiler, and nothing 401s at a resolver nobody has written yet. The
 * gate is in place and open. It is NOT authentication.
 *
 * Replace the body with how your application recognizes a caller — a session,
 * a bearer token, an API key — and return \`null\` when it recognizes nobody.
 * That \`null\` is what turns an assertion into a 401.
 *
 * \`defineAuth\` also takes SEVERAL strategies, tried in order, for when more
 * than one kind of client calls the same endpoints:
 * \`defineAuth(sessionAuth, bearerAuth, apiKeyAuth)\`. And once a real resolver
 * shows up in a measurement, \`cacheAuth\` wraps it — read its docs first, it
 * trades freshness for the lookup and needs an \`invalidate\` wired in.
 *
 * \`db\` and \`get\` come in for exactly that: permissions are usually a query,
 * and \`get\` reaches a module's contract when this file must not import that
 * module's tables.
 *
 * Declare what an actor IS at the same time. samble leaves it empty on purpose
 * — a user id, a tenant, an API key issued to an extension are all valid, and
 * a framework that picks one is a framework you fight later. Declared once,
 * \`this.auth.actor\` is typed in every endpoint and routine:
 *
 * @example
 * declare global {
 *   namespace SambleAuth {
 *     interface Actor {
 *       userId: number;
 *     }
 *   }
 * }
 *
 * const auth = defineAuth(async (request, { db }) => {
 *   const userId = request.session?.userId;
 *   if (!userId) return null;
 *   const [user] = await db
 *     .select({ role: users.role })
 *     .from(users)
 *     .where(eq(users.id, userId));
 *   if (!user) return null;
 *   return { actor: { userId }, permissions: PERMISSIONS_BY_ROLE[user.role] };
 * });
 */
const auth = defineAuth(async (request) => {
  if (!warned) {
    warned = true;
    Logger.warn(
      'Everyone is allowed: src/config/auth.ts still grants every permission to every request.',
    );
  }

  return {
    // Half real already: \`0\` is nobody, and the moment a login writes
    // \`request.session.userId\`, \`this.auth.actor.userId\` is the signed-in
    // user in every endpoint. What is still missing is the other half — who
    // this user IS and what they may do.
    actor: { userId: request.session?.userId ?? 0 },
    // \`*\` grants everything. Real ones are the keys your modules declare,
    // which src/config/permissions.ts carries into the type system.
    permissions: ['*'],
  };
});

export default auth;
`;

  // Its own tsconfig so the editor and the type-aware lint rules see the
  // tests, while the root one keeps \`rootDir: src\` for the build.
  const testTsconfig = `{
  "extends": "../tsconfig.json",
  "compilerOptions": { "rootDir": "..", "noEmit": true },
  "include": [".", "../src"]
}
`;

  const appSpec = `import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import {
  closeTestDatabase,
  openTestDatabase,
  type Database,
  type Samble,
} from '@samble/core';
import { createApp } from '../src';

/**
 * The application itself, booted on a real Postgres inside the process: the
 * same migrations, routes, auth and sessions a deployment runs. Only the
 * connection differs, and no server or .env is needed.
 */
describe('the application', () => {
  let db: Database;
  let app: Samble;

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= 'test';
    db = await openTestDatabase(${
      dialect === 'postgres' ? '' : `{ dialect: '${dialect}' }`
    });
    app = await createApp({ db });
    await app.start(0);
  });

  afterAll(async () => {
    await app?.close();
    await closeTestDatabase(db);
  });

  it('answers the health probe', async () => {
    const res = await request(app.getApp()).get('/health');
    expect(res.status).toBe(200);
  });
});
`;

  const databaseTypes = `/**
 * Which database engine this application runs on, told to the compiler once.
 *
 * Drizzle's database type depends on the engine, so \`this.db\` is typed from
 * this — in every endpoint, routine and migration. Change the engine and change
 * it here, beside \`dialect\` in src/index.ts and in package.json.
 */
declare global {
  namespace SambleDatabase {
    interface Config {
      dialect: '${dialect}';
    }
  }
}

export {};
`;

  return plan(
    [
      { path: 'package.json', content: pkg },
      { path: 'tsconfig.json', content: tsconfig },
      { path: '.gitignore', content: ignore },
      { path: '.gitattributes', content: gitattributes },
      { path: '.editorconfig', content: editorconfig },
      { path: '.prettierrc', content: prettierrc },
      { path: '.prettierignore', content: prettierignore },
      { path: 'eslint.config.mjs', content: eslintConfig },
      { path: '.vscode/settings.json', content: vscodeSettings },
      { path: '.vscode/extensions.json', content: vscodeExtensions },
      { path: '.env', content: env },
      { path: '.env.template', content: env.replace(/=.+$/gm, '=') },
      { path: 'src/index.ts', content: index },
      { path: 'src/config/database.ts', content: databaseTypes },
      { path: 'src/config/permissions.ts', content: permissionTypes },
      { path: 'src/config/auth.ts', content: authFile },
      { path: 'src/config/session.ts', content: sessionFile },
      { path: 'test/tsconfig.json', content: testTsconfig },
      { path: 'test/app.spec.ts', content: appSpec },
    ],
    [],
    [
      dialect === 'sqlite'
        ? `The database is a file (DB_URL in .env), created on the first run.`
        : `Fill in .env (the database has to exist; samble creates tables, not databases).`,
      ...(dialect === 'mysql'
        ? [
            `npm test needs a MySQL server (SAMBLE_TEST_MYSQL_URL in .env): each test creates a database of its own there and drops it.`,
          ]
        : []),
      `Once it runs: /health answers the probes, /docs has the API, and logs/ has the route map.`,
      `src/config/auth.ts lets EVERYONE through, so endpoints answer from the first request. Replace it before this has users.`,
      // Inside the project it is the local install that answers, so no
      // version or tag is needed here.
      `Create your first module: npx samble module <name>${
        modulesDir === 'src/modules' ? '' : ` --dir ${modulesDir}`
      }`,
      `Formatting is decided: .editorconfig for every editor, .prettierrc for Prettier, eslint.config.mjs for what the code means, .gitattributes so the tree is LF everywhere. npm run lint / npm run format.`,
      ...(dialect === 'mysql'
        ? []
        : [
            `npm test boots the whole app on a ${engine.label} inside the process (openTestDatabase): no server, no .env.`,
          ]),
      `Then: npm run dev`,
    ],
  );
}

/**
 * Installs the dependencies of the project just created.
 *
 * `shell: true` because on Windows `npm` is a `.cmd`, and spawning one from a
 * modern Node without a shell fails with EINVAL. The arguments are fixed, so
 * there is nothing here for a shell to reinterpret.
 */
export function install(cwd: string): void {
  try {
    execFileSync('npm', ['install'], { cwd, stdio: 'inherit', shell: true });
  } catch {
    throw new CliError(
      'npm install failed. The project is written: fix the error above and run it yourself.',
    );
  }
}
/** What `samble init` left behind, version-control wise. */
export type GitResult =
  | { status: 'committed' }
  | { status: 'initialized'; reason: string }
  | { status: 'skipped'; reason: string };

export interface GitOptions {
  /** Injectable for tests: the environment git runs in, identity included. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Puts the new project under git, and makes the scaffold its first commit.
 *
 * The commit is the point. Sixteen files nobody typed are not the author's
 * work, and with no commit of their own they end up inside the first real one,
 * where nobody reviewing it can tell the two apart. Committed on their own, the
 * next `git diff` is only what the author did, and `git checkout .` has
 * somewhere to go back to from the first minute.
 *
 * It runs AFTER `npm install`, so the lockfile is in that commit — the one file
 * a fresh clone needs to get the same tree.
 *
 * Three things stop it, and none of them is an error:
 *
 *  - No git on the machine. The project is written, it just is not tracked.
 *  - The folder is ALREADY inside a repository. A nested one would hide the
 *    project from the repository that already tracks it, and running
 *    `samble init my-app` inside a monorepo is a normal thing to do.
 *  - The commit itself fails, most often because git has no identity here. The
 *    repository stays, and git's own complaint is the hint.
 */
export function initGit(cwd: string, options: GitOptions = {}): GitResult {
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    })
      .toString()
      .trim();

  try {
    git(['--version']);
  } catch {
    return { status: 'skipped', reason: 'git is not installed' };
  }

  try {
    git(['rev-parse', '--git-dir']);
    return {
      status: 'skipped',
      reason: 'the folder is already inside a git repository',
    };
  } catch {
    // Not a repository yet, which is the whole case for this function.
  }

  try {
    try {
      // `-b main`: without `init.defaultBranch` set, git still starts on
      // "master" and prints a paragraph about it. Older gits do not know the
      // flag, and the name of a branch is not worth failing a scaffold over.
      git(['init', '-b', 'main']);
    } catch {
      git(['init']);
    }

    git(['add', '-A']);
    git(['commit', '-m', 'Initial commit: samble project scaffold']);
    return { status: 'committed' };
  } catch (error) {
    return { status: 'initialized', reason: gitComplaint(error) };
  }
}

/** git's own complaint, first line of it, so the hint is not ours to invent. */
function gitComplaint(error: unknown): string {
  const streams = [
    (error as { stderr?: Buffer }).stderr,
    (error as { stdout?: Buffer }).stdout,
  ];

  const text = streams
    .map((stream) => stream?.toString().trim() ?? '')
    .find((value) => value.length > 0);

  const first = text?.split('\n').find((line) => line.trim().length > 0);
  return first?.trim() ?? 'git refused to commit';
}
