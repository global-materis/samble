import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import {
  createEndpoint,
  createTable,
  createMigration,
  createModule,
  createProvider,
  createStrategy,
  createRoutine,
  createToken,
} from '../lib/cli/generators';
import { applyEdit } from '../lib/cli/writer';
import { apply } from '../lib/cli/writer';
import { createProject, initGit } from '../lib/cli/init';
import { parseTarget, toKebab, toPascal } from '../lib/cli/names';
import {
  AuthResolver,
  buildContainer,
  closeTestDatabase,
  collectModuleTables,
  Database,
  openTestDatabase,
  Samble,
  ResolvedModule,
} from '../lib';
import { closeTestDb, createTestDb, query } from './helpers/test-db';
import { cualquiera } from './helpers/auth';

/**
 * El CLI escribe la FORMA de un módulo, y esta prueba es la razón por la que
 * se puede volver a tener uno.
 *
 * El CLI de 1.x se borró porque sus plantillas eran archivos sueltos que nadie
 * compilaba: derivaron hasta generar decoradores que el framework ya no tenía.
 * Acá las plantillas son parte del build Y lo generado se ARRANCA de verdad:
 * si una plantilla deja de coincidir con el framework, esta suite se cae.
 */

const workspace = path.join(__dirname, '.generated');
const modulesDir = 'src/modules';

const scaffold = (plan: ReturnType<typeof createModule>) =>
  apply(plan, { root: workspace, force: true });

const sambleVersion = '^2.0.0-alpha.1';

const read = (file: string) =>
  fs.readFileSync(path.join(workspace, file), 'utf8');

/** Todo lo generado bajo un módulo, para recorrerlo archivo por archivo. */
const generated = (dir: string): string[] => {
  const full = path.join(workspace, dir);
  return fs
    .readdirSync(full, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? generated(`${dir}/${entry.name}`)
        : [`${dir}/${entry.name}`],
    );
};

describe('nombres', () => {
  it('normaliza venga como venga', () => {
    expect(toKebab('MyModule')).toBe('my-module');
    expect(toKebab('my_module')).toBe('my-module');
    expect(toKebab('listProducts')).toBe('list-products');
    expect(toPascal('list-products')).toBe('ListProducts');
  });

  it('exige decir a qué módulo pertenece', () => {
    expect(() => parseTarget('list-products', 'endpoint')).toThrow(
      /samble endpoint <module>\/<name>/,
    );
    expect(parseTarget('catalog/list-products', 'endpoint')).toEqual({
      module: 'catalog',
      name: 'list-products',
    });
  });
});

describe('ediciones sobre archivos que el generador no escribió', () => {
  it('ante un archivo que no reconoce NO adivina', () => {
    // Devolver null es lo que convierte la edición en una instrucción escrita,
    // en vez de dejar un manifiesto hecho a mano a medio editar.
    expect(
      applyEdit('export default {}', {
        path: 'x',
        arrayEntry: {
          field: 'tables',
          value: 'productos',
          importLine: 'import x',
        },
      }),
    ).toBeNull();
  });

  it('agrega al arreglo y trae su import', () => {
    const source =
      "import { defineModule } from '@samble/core';\n\nexport default defineModule({\n  tables: [],\n});\n";
    const after = applyEdit(source, {
      path: 'x',
      arrayEntry: {
        field: 'tables',
        value: 'productos',
        importLine: "import { productos } from './tables/product.table';",
      },
    });

    expect(after).toContain('tables: [productos]');
    expect(after).toContain(
      "import { productos } from './tables/product.table';",
    );
  });

  it('no rompe un arreglo que prettier ya partió en varias líneas', () => {
    // Prettier agrega una coma final al envolver un arreglo, y agregar detrás
    // de ella producía `'a',, 'b'`: el generador rompiendo un archivo que él
    // mismo había escrito.
    const source = `export default defineModule({
  permissions: [
    'inventory.view',
    'inventory.count',
  ],
});
`;

    const after = applyEdit(source, {
      path: 'x',
      arrayEntry: {
        field: 'permissions',
        value: "'inventory.export'",
        unless: "'inventory.export'",
      },
    })!;

    expect(after).not.toContain(',,');
    expect(after).toContain("'inventory.count', 'inventory.export'");
  });

  it('no duplica una entrada que ya está', () => {
    const source = `export default defineModule({
  permissions: ['a.view'],
});
`;
    const after = applyEdit(source, {
      path: 'x',
      arrayEntry: {
        field: 'permissions',
        value: "'a.view'",
        unless: "'a.view'",
      },
    });

    expect(after).toBe(source);
  });

  it('no vuelve a agregar un bloque que ya está, aunque lo hayan reformateado', () => {
    // El caso real: prettier del proyecto del consumidor reenvuelve la línea y
    // puede cambiar las comillas. Comparar el bloque entero, verbatim, hacía que
    // la segunda corrida apendara una copia de lo que ya estaba.
    const bloque = createModule({
      name: 'tasks',
      modulesDir: 'src/modules',
      from: '@samble/core',
    }).edits.find((edit) => edit.path === 'src/config/permissions.ts')!;

    const base = `import type { PermissionsOf } from '@samble/core';
`;
    const unaVez = applyEdit(base, bloque)!;

    // Tal cual: lo reconoce.
    expect(applyEdit(unaVez, bloque)).toBe(unaVez);

    // Reformateado — comillas dobles y otro corte de línea — también.
    const reformateado = unaVez
      .replace("'../modules/tasks/module'", '"../modules/tasks/module"')
      .replace(
        `interface Permissions
      extends`,
        'interface Permissions extends',
      );
    expect(reformateado).not.toBe(unaVez);
    expect(applyEdit(reformateado, bloque)).toBe(reformateado);

    // Reindentado a mano, igual.
    const aMano = unaVez.replace(
      '  namespace SambleAuth {',
      '    namespace SambleAuth {',
    );
    expect(applyEdit(aMano, bloque)).toBe(aMano);
  });

  it('el índice de migraciones deja de ser un módulo vacío al llegar la primera', () => {
    const after = applyEdit('export {};\n', {
      path: 'x',
      append: "export * from './1-create';",
    });

    expect(after).toBe("export * from './1-create';\n");
  });
});

describe('lo generado entra en el ancho de prettier', () => {
  // Ninguna línea de un archivo generado puede pasar de 80 columnas: el
  // proyecto que `samble init` arma corre `prettier --check`, así que romperlo
  // le rompe el lint al consumidor en su primer commit.
  it('parte el import cuando no entra, y no cuando sí', () => {
    const corto = createProvider({
      target: 'reports/flag',
      modulesDir: 'src/modules',
      from: '@samble/core',
    }).files[0].content;

    expect(corto).toContain(
      "import { Provides, Provider } from '@samble/core';",
    );
    expect(corto).toContain("import { Flag } from '../tokens/flag.token';");

    // El import de una ranura trae DOS nombres y una ruta con el alias: es el
    // que se pasa de largo.
    const largo = createStrategy({
      target: 'reports/low-stock',
      slot: 'product-badges',
      modulesDir: 'src/modules',
      from: '@samble/core',
    }).files[0].content;

    expect(largo).toContain(
      [
        'import {',
        '  ProductBadge,',
        '  ProductBadges,',
        "} from '@/<module>/tokens/product-badges.token';",
      ].join('\n'),
    );

    for (const linea of largo.split('\n')) {
      expect(linea.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('el token generado entra en el ancho de prettier', () => {
  // El proyecto que `samble init` arma corre `prettier --check`, así que una
  // línea de más de 80 columnas en un archivo generado rompe el lint del
  // consumidor en su primer commit. El ancho depende del módulo y del nombre,
  // que sólo el generador conoce.
  const contenido = (target: string) =>
    createToken({
      target,
      kind: 'slot',
      modulesDir: 'src/modules',
      from: '@samble/core',
    }).files[0].content;

  it('lo deja en una línea cuando entra', () => {
    const linea = contenido('shop/tags')
      .split('\n')
      .find((l) => l.startsWith('export const'));

    expect(linea).toBe("export const Tags = token<Tag>('shop.tags', 'slot');");
    expect(linea!.length).toBeLessThanOrEqual(80);
  });

  it('lo parte como lo partiría prettier cuando no entra', () => {
    expect(contenido('subscriptions/invoice-line-renderers')).toContain(
      [
        'export const InvoiceLineRenderers = token<InvoiceLineRenderer>(',
        "  'subscriptions.invoice-line-renderers',",
        "  'slot',",
        ');',
      ].join('\n'),
    );
  });
});

describe('samble init', () => {
  it('escribe un proyecto que arranca, no una carpeta vacía', () => {
    const files = createProject({ name: 'Mi App', sambleVersion }).files;
    const paths = files.map((file) => file.path);

    expect(paths).toEqual([
      'package.json',
      'tsconfig.json',
      '.gitignore',
      '.gitattributes',
      '.editorconfig',
      '.prettierrc',
      '.prettierignore',
      'eslint.config.mjs',
      '.vscode/settings.json',
      '.vscode/extensions.json',
      '.env',
      '.env.template',
      'src/index.ts',
      'src/config/database.ts',
      'src/config/permissions.ts',
      'src/config/auth.ts',
      'src/config/session.ts',
      'test/tsconfig.json',
      'test/app.spec.ts',
    ]);
  });

  it('el motor lo elige el operador, y se instala sólo el suyo', () => {
    const conMotor = (dialect: 'postgres' | 'mysql' | 'sqlite') => {
      const archivos = createProject({
        name: 'mi-app',
        sambleVersion,
        dialect,
      }).files;
      const busca = (ruta: string) =>
        archivos.find((file) => file.path === ruta)!.content;
      return { busca, pkg: JSON.parse(busca('package.json')) };
    };
    const drivers = ['pg', 'mysql2', '@libsql/client'];

    for (const [dialect, driver] of [
      ['postgres', 'pg'],
      ['mysql', 'mysql2'],
      ['sqlite', '@libsql/client'],
    ] as const) {
      const { busca, pkg } = conMotor(dialect);

      // Su driver y ningún otro: nadie instala un paquete para un motor que
      // no corre.
      expect(pkg.dependencies).toHaveProperty(driver);
      drivers
        .filter((otro) => otro !== driver)
        .forEach((otro) => expect(pkg.dependencies).not.toHaveProperty(otro));
      // PGlite es Postgres: sólo lo trae quien prueba sobre Postgres.
      expect(pkg.devDependencies['@electric-sql/pglite'] !== undefined).toBe(
        dialect === 'postgres',
      );

      // Queda anotado donde lo leen los generadores (tablas, migraciones)…
      expect(pkg.samble).toEqual({ dialect });
      // …en el arranque…
      expect(busca('src/config/database.ts')).toContain(
        `dialect: '${dialect}',`,
      );
      expect(busca('src/index.ts')).toContain(
        "import databaseFromEnv from './config/database';",
      );
      // …y en el compilador, que tipa `this.db` según el motor: LEÍDO de esas
      // opciones, no repetido, y con `satisfies` para que siga siendo UN motor.
      expect(busca('src/config/database.ts')).toContain(
        "dialect: ReturnType<typeof databaseFromEnv>['dialect'];",
      );
      expect(busca('src/config/database.ts')).toContain(
        '} satisfies DatabaseOptions;',
      );
      expect(busca('src/config/database.ts')).not.toContain(
        `dialect: '${dialect}';`,
      );
    }

    // Cada motor con sus variables, y las pruebas sobre su propia base.
    expect(conMotor('postgres').busca('.env')).toContain('DB_PORT=5432');
    expect(conMotor('postgres').busca('test/app.spec.ts')).toContain(
      'openTestDatabase()',
    );

    const mysql = conMotor('mysql');
    expect(mysql.busca('.env')).toContain('DB_PORT=3306');
    // No hay MySQL dentro del proceso: las pruebas necesitan un servidor.
    expect(mysql.busca('.env')).toContain(
      'SAMBLE_TEST_MYSQL_URL=mysql://root@localhost:3306',
    );
    expect(mysql.busca('test/app.spec.ts')).toContain(
      "openTestDatabase({ dialect: 'mysql' })",
    );
    // Un MySQL local suele tener la clave de root VACÍA, y require() cuenta
    // un valor vacío como faltante.
    const requeridas = mysql
      .busca('src/config/database.ts')
      .split('ConfigService.require([')[1]
      .split(']);')[0];
    expect(requeridas).not.toContain('DB_PASSWORD');
    expect(mysql.busca('src/config/database.ts')).toContain(
      "ConfigService.optional('DB_PASSWORD') ?? ''",
    );

    const sqlite = conMotor('sqlite');
    expect(sqlite.busca('.env')).toContain('DB_URL=file:mi_app.db');
    expect(sqlite.busca('src/config/database.ts')).toContain(
      "ConfigService.require(['DB_URL']);",
    );
    expect(sqlite.busca('.gitignore')).toContain('*.db');
  });

  it('nace con pruebas que arrancan la app entera, sin servidor ni .env', () => {
    const archivos = createProject({ name: 'mi-app', sambleVersion }).files;
    const busca = (ruta: string) =>
      archivos.find((file) => file.path === ruta)!.content;

    const pkg = JSON.parse(busca('package.json'));
    // PGlite carga su WASM con un import dinámico: sin el flag, jest no puede.
    expect(pkg.scripts.test).toContain('--experimental-vm-modules');
    // La config va en el package.json y no en un jest.config.ts: un .ts suelto
    // en la raíz no pertenece a ningún tsconfig y el lint con tipos lo rechaza.
    expect(pkg.jest).toMatchObject({
      preset: 'ts-jest',
      roots: ['<rootDir>/test'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/modules/$1' },
    });
    [
      'jest',
      'ts-jest',
      '@jest/globals',
      'supertest',
      '@types/supertest',
      '@electric-sql/pglite',
    ].forEach((dep) => expect(pkg.devDependencies).toHaveProperty(dep));

    // El tsconfig raíz deja `rootDir: src` para el build; las pruebas tienen
    // el suyo, que es el que encuentran el editor y ESLint.
    const testTsconfig = busca('test/tsconfig.json');
    expect(testTsconfig).toContain('"extends": "../tsconfig.json"');
    expect(testTsconfig).toContain('"include": [".", "../src"]');

    // La prueba usa el MISMO createApp() que el despliegue: solo cambia la
    // conexión.
    const spec = busca('test/app.spec.ts');
    expect(spec).toContain('openTestDatabase()');
    expect(spec).toContain('createApp(db)');

    // La base se elige a la vista: por defecto la del entorno, y sus variables
    // se exigen donde se leen. createApp() solo exige lo suyo, así que una
    // prueba que trae su base no necesita ninguna DB_*.
    const entry = busca('src/index.ts');
    expect(entry).toContain(
      'db: Database | DatabaseOptions = databaseFromEnv()',
    );
    expect(entry).toContain("ConfigService.require(['SESSION_SECRET']);");
    expect(entry).not.toContain('options.db');
    expect(busca('src/config/database.ts')).toContain(
      'export default function databaseFromEnv() {',
    );
    expect(spec).toContain('closeTestDatabase(db)');
  });

  it('la sesión viene puesta: sin eso, `request.session` no compila', () => {
    const archivos = createProject({ name: 'mi-app', sambleVersion }).files;
    const busca = (ruta: string) =>
      archivos.find((file) => file.path === ruta)!.content;

    // El caso que esto ataja: el resolutor de auth que se genera lee
    // `request.session?.userId`, y un login escribe `this.request.session`.
    // Sin el paquete Y sus tipos, ninguna de las dos cosas compila, y
    // `declare module 'express-session'` tampoco puede aumentar un módulo que
    // no se resuelve.
    const pkg = JSON.parse(busca('package.json'));
    expect(pkg.dependencies['express-session']).toBeDefined();
    expect(pkg.devDependencies['@types/express-session']).toBeDefined();

    // Lo que lleva la sesión se declara una vez, y queda tipado en todos lados.
    const session = busca('src/config/session.ts');
    expect(session).toContain("declare module 'express-session'");
    expect(session).toContain('interface SessionData');
    expect(session).toContain('userId?: number');
    // Sin cookie para quien nunca inició sesión.
    expect(session).toContain('saveUninitialized: false');
    expect(session).toContain('httpOnly: true');

    // Es una FUNCION, no una sesion ya construida: leer el entorno en el tope
    // del modulo pasa al importar, que es ANTES de createApp() y por lo tanto
    // antes de que require() pueda decir que falta algo.
    // El store es opcional: cuál usar depende del motor, y el motor lo elige
    // la app. samble no instala ninguno; el comentario dice cómo armarlo sobre
    // su conexión (`app.db.$client`) sin abrir otra.
    expect(session).toContain(
      'export default function buildSession(store?: Store)',
    );
    expect(session).toContain('app.db.$client');

    // Y montada ANTES de las rutas, o lo que el login escriba no se lee.
    const index = busca('src/index.ts');
    expect(index).toContain("import buildSession from './config/session'");
    expect(index).toContain('app.use(buildSession());');
    const pkg2 = JSON.parse(busca('package.json'));
    expect(pkg2.dependencies).not.toHaveProperty('connect-pg-simple');

    // SESSION_SECRET entra en la lista que createApp() chequea primero: el
    // andamio lo escribe en el .env, asi que una instalacion sin el tiene que
    // enterarse antes de leer nada.
    expect(index).toContain("ConfigService.require(['SESSION_SECRET']);");

    // El secreto se genera por proyecto: uno por defecto que nadie cambia es
    // lo mismo que no firmar la cookie.
    const env = busca('.env');
    expect(env).toMatch(/^SESSION_SECRET=[0-9a-f]{64}$/m);
    // Y NO viaja en la plantilla que se commitea.
    expect(busca('.env.template')).toContain('SESSION_SECRET=');
    expect(busca('.env.template')).not.toMatch(/SESSION_SECRET=.+/);
  });

  it('el actor generado tiene forma, y el userId sale de la sesión', () => {
    const archivos = createProject({ name: 'mi-app', sambleVersion }).files;
    const auth = archivos.find(
      (file) => file.path === 'src/config/auth.ts',
    )!.content;

    // `{} as SambleAuth.Actor` mentía: en cuanto la app declara `userId`,
    // `this.auth.actor.userId` decía `number` y valía `undefined`.
    expect(auth).not.toContain('{} as SambleAuth.Actor');
    expect(auth).toContain('interface Actor');
    expect(auth).toContain('userId: number');
    expect(auth).toContain('request.session?.userId ?? 0');
    // Y sigue sin bloquear nada mientras no haya autenticación de verdad.
    expect(auth).toContain("permissions: ['*']");
  });

  it('el formato del documento queda decidido, no a criterio de cada editor', () => {
    const archivos = createProject({ name: 'mi-app', sambleVersion }).files;
    const busca = (ruta: string) =>
      archivos.find((file) => file.path === ruta)!.content;

    // Los cuatro dicen lo mismo, cada uno a un lector distinto: el editor que
    // no corre nada, Prettier, el linter y git.
    expect(busca('.editorconfig')).toContain('end_of_line = lf');
    expect(busca('.editorconfig')).toContain('max_line_length = 80');
    expect(busca('.prettierrc')).toContain('"endOfLine": "lf"');
    expect(busca('.prettierrc')).toContain('"printWidth": 80');
    // Sin esto, git en Windows saca CRLF mientras los otros dos piden LF, y el
    // formateador quiere reescribir la mitad del repo.
    expect(busca('.gitattributes')).toContain('* text=auto eol=lf');

    // Flat config: `.eslintrc` se eliminó en ESLint 10.
    const eslint = busca('eslint.config.mjs');
    expect(eslint).toContain("from 'eslint/config'");
    // Prettier NO corre como regla de ESLint, que es lo que Prettier mismo
    // recomienda: sólo se apagan las reglas que discutirían con él.
    expect(eslint).toContain("from 'eslint-config-prettier/flat'");
    expect(eslint).not.toContain('eslint-plugin-prettier');
    expect(eslint).not.toContain('prettier/prettier');

    // Las dos reglas que el andamiaje necesita para lintear su propia salida.
    expect(eslint).toContain('allowDeclarations: true');
    expect(eslint).toContain("allowInterfaces: 'with-single-extends'");
    // Y la que justifica pagar información de tipos.
    expect(eslint).toContain('no-floating-promises');

    const pkg = JSON.parse(busca('package.json'));
    expect(pkg.scripts).toMatchObject({
      lint: 'eslint .',
      'lint:fix': 'eslint . --fix',
      format: 'prettier --write .',
      'format:check': 'prettier --check .',
    });
    // Node 20 llegó a fin de vida en abril de 2026; 22 es la línea más vieja que
    // todavía recibe seguridad.
    expect(pkg.engines.node).toBe('>=22.13');
    [
      'eslint',
      '@eslint/js',
      'typescript-eslint',
      'eslint-config-prettier',
      'prettier',
    ].forEach((dep) => expect(pkg.devDependencies).toHaveProperty(dep));
  });

  it('el archivo de permisos ya no necesita ningún eslint-disable', () => {
    // La regla queda CONFIGURADA para el caso (`no-empty-object-type` con
    // `with-single-extends`), que es mejor que apagarla: un `{}` de verdad
    // sigue reportándose.
    const permisos = createProject({
      name: 'mi-app',
      sambleVersion,
    }).files.find((file) => file.path === 'src/config/permissions.ts')!.content;

    expect(permisos).not.toContain('eslint-disable');
  });

  it('permisos y auth quedan ESCRITOS, no comentados', () => {
    // El pedido es que no haya que configurar nada para empezar: el bloque de
    // permisos existe desde el primer día —`create module` le agrega uno por
    // módulo y el merge de interfaces los junta— y hay un resolutor de verdad
    // enchufado en el index.
    const archivos = createProject({ name: 'mi-app', sambleVersion }).files;
    const busca = (ruta: string) =>
      archivos.find((file) => file.path === ruta)!.content;

    const permisos = busca('src/config/permissions.ts');
    expect(permisos).toContain('declare global {');
    expect(permisos).toContain(
      'interface Permissions extends PermissionsOf<unknown> {}',
    );

    const auth = busca('src/config/auth.ts');
    // Deja pasar a todos, y lo dice en voz alta una vez.
    expect(auth).toContain("permissions: ['*']");
    expect(auth).toContain('Logger.warn(');

    const index = busca('src/index.ts');
    expect(index).toContain("import auth from './config/auth';");
    expect(index).toMatch(/^\s*auth,$/m);
  });

  it('el package.json es válido y trae lo que el framework necesita', () => {
    const [pkg] = createProject({ name: 'mi-app', sambleVersion }).files;
    const parsed = JSON.parse(pkg.content);

    expect(parsed.name).toBe('mi-app');
    expect(parsed.dependencies['@samble/core']).toBe(sambleVersion);
    // Son peer dependencies de samble: sin ellas no arranca nada.
    expect(Object.keys(parsed.dependencies)).toEqual(
      expect.arrayContaining(['drizzle-orm', 'express', 'class-validator']),
    );
    expect(parsed.scripts.build).toBe('samble build');
  });

  it('deja listo lo que todo backend termina necesitando', () => {
    const index = createProject({ name: 'mi-app', sambleVersion }).files.find(
      (file) => file.path === 'src/index.ts',
    )!.content;

    // Los tres quedan encendidos: un proyecto recién creado tiene que poder
    // contestar un probe, mostrar su API y dejar el mapa de rutas sin que
    // nadie descubra una opción antes.
    //
    // Salud: un 200/503 sin credenciales, que es lo que lee un balanceador.
    expect(index).toContain("health: { path: '/health' }");
    // Documentación viva, generada de los mismos decoradores que montan.
    expect(index).toContain("path: '/docs'");
    // Archivos de log en `logs/`, con `router.log` adentro.
    expect(index).toContain("logs: { dir: 'logs' }");
    // Nada condicionado al entorno: apagarlos es una decisión que se toma
    // mirando el archivo, no una que venga tomada de fábrica.
    expect(index).not.toContain("=== 'production'");

    const env = createProject({ name: 'mi-app', sambleVersion }).files.find(
      (file) => file.path === '.env',
    )!.content;
    expect(env).toContain('NODE_ENV=development');
  });

  it('el tsconfig trae los dos flags sin los cuales nada funciona', () => {
    const tsconfig = createProject({ name: 'mi-app', sambleVersion }).files[1];

    expect(tsconfig.content).toContain('"experimentalDecorators": true');
    expect(tsconfig.content).toContain('"emitDecoratorMetadata": true');
    // Con esto en true, cada campo de una entidad es un error.
    expect(tsconfig.content).toContain('"strictPropertyInitialization": false');

    // Y el alias: sin el require de ts-node, `npm run dev` muere en el primer
    // import que lo use.
    // Relativo y sin `baseUrl`: TS 6 lo marca deprecado y TS 7 lo quita, así
    // que un `paths` va relativo al propio tsconfig.
    expect(tsconfig.content).toContain(
      '"paths": { "@/*": ["./src/modules/*"] }',
    );
    expect(tsconfig.content).not.toContain('"baseUrl"');
    expect(tsconfig.content).toContain(
      '"ts-node": { "require": ["tsconfig-paths/register"] }',
    );
  });
});

describe('samble init deja el proyecto en git', () => {
  // El commit es el punto. Dieciséis archivos que nadie tipeó no son trabajo
  // del autor, y sin un commit propio terminan adentro del primero de verdad,
  // donde quien lo revise no puede distinguir una cosa de la otra.

  /** Una identidad de git que no depende de cómo esté esta máquina. */
  const sinIdentidad = (dir: string): NodeJS.ProcessEnv => {
    const env = { ...process.env };

    // Un archivo que no existe es una config vacía: así el commit falla por
    // falta de identidad en CUALQUIER máquina, no sólo en una sin configurar.
    env.GIT_CONFIG_GLOBAL = path.join(dir, 'sin-config');
    env.GIT_CONFIG_SYSTEM = path.join(dir, 'sin-config');
    delete env.GIT_AUTHOR_NAME;
    delete env.GIT_AUTHOR_EMAIL;
    delete env.GIT_COMMITTER_NAME;
    delete env.GIT_COMMITTER_EMAIL;
    delete env.EMAIL;

    return env;
  };

  const conIdentidad = (dir: string): NodeJS.ProcessEnv => ({
    ...sinIdentidad(dir),
    GIT_AUTHOR_NAME: 'Prueba',
    GIT_AUTHOR_EMAIL: 'prueba@example.com',
    GIT_COMMITTER_NAME: 'Prueba',
    GIT_COMMITTER_EMAIL: 'prueba@example.com',
  });

  const creadas: string[] = [];

  /** Una carpeta FUERA del repositorio de samble: adentro vería el de arriba. */
  const afuera = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'samble-git-'));
    creadas.push(dir);
    return dir;
  };

  const proyecto = (): string => {
    const dir = afuera();
    apply(createProject({ name: 'git-app', sambleVersion }), { root: dir });
    return dir;
  };

  const git = (dir: string, args: string[]): string =>
    execFileSync('git', args, { cwd: dir, env: conIdentidad(dir) })
      .toString()
      .trim();

  afterAll(() => {
    creadas.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  it('el andamiaje es el primer commit, y lo ignorado queda afuera', () => {
    const dir = proyecto();
    // Lo que el install deja al lado, para que .gitignore tenga qué ignorar.
    fs.mkdirSync(path.join(dir, 'node_modules/samble'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/samble/index.js'), '');

    expect(initGit(dir, { env: conIdentidad(dir) })).toEqual({
      status: 'committed',
    });
    expect(git(dir, ['log', '--oneline'])).toContain(
      'Initial commit: samble project scaffold',
    );

    const versionados = git(dir, ['show', '--name-only', '--format=']).split(
      '\n',
    );

    expect(versionados).toContain('package.json');
    expect(versionados).toContain('src/index.ts');
    expect(versionados.some((file) => file.startsWith('node_modules'))).toBe(
      false,
    );
    // Y .env tampoco: lo escribe el andamiaje con un secreto de sesión adentro.
    expect(versionados).not.toContain('.env');
    expect(versionados).toContain('.env.template');
  });

  it('la rama arranca en main, no en master', () => {
    const dir = proyecto();
    initGit(dir, { env: conIdentidad(dir) });

    expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  });

  it('no anida un repositorio adentro de otro', () => {
    // `samble init my-app` adentro de un monorepo es normal, y un repositorio
    // anidado esconde el proyecto del que ya lo versiona.
    const padre = afuera();
    execFileSync('git', ['init'], {
      cwd: padre,
      env: conIdentidad(padre),
      stdio: 'ignore',
    });
    const hijo = path.join(padre, 'my-app');
    fs.mkdirSync(hijo);

    expect(initGit(hijo, { env: conIdentidad(hijo) })).toEqual({
      status: 'skipped',
      reason: 'the folder is already inside a git repository',
    });
    expect(fs.existsSync(path.join(hijo, '.git'))).toBe(false);
  });

  it('sin identidad el repositorio igual queda, y el porqué lo dice git', () => {
    const dir = proyecto();

    const result = initGit(dir, { env: sinIdentidad(dir) });

    expect(result.status).toBe('initialized');
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
    // El texto es de git, no nuestro: inventarlo sería adivinar por qué falló.
    expect((result as { reason: string }).reason).toMatch(
      /identity|author|user\.email/i,
    );
  });
});

describe('un módulo generado y puesto a andar', () => {
  let db: Database;
  let app: Samble;
  const server = () => app.getApp();

  const auth: AuthResolver = (req) =>
    req.headers['x-perms']
      ? {
          // El actor lo define la app (declaration merging); acá alcanza con
          // que exista uno.
          actor: { userId: 1 },
          permissions: String(req.headers['x-perms']).split(','),
        }
      : null;

  let inventory: ResolvedModule;

  /** Reemplaza el andamiaje por una migración de verdad, como haría un autor. */
  const escribirMigracion = () => {
    const carpeta = path.join(workspace, modulesDir, 'inventory/migrations');
    const archivo = fs
      .readdirSync(carpeta)
      .find((name) => name.endsWith('-create-items.ts')) as string;
    const ruta = path.join(carpeta, archivo);

    // Escribe el SQL y saca el freno: el throw y la línea en blanco que lo
    // separa del SQL.
    const lineas = fs.readFileSync(ruta, 'utf8').split('\n');
    const desde = lineas.findIndex((line) => line.includes('throw new Error('));
    const hasta = lineas.findIndex(
      (line, i) => i > desde && line.trim() === ');',
    );
    lineas.splice(desde - 1, hasta - desde + 2);

    fs.writeFileSync(
      ruta,
      lineas
        .join('\n')
        .replace(
          '      -- what this migration creates',
          '      create table inv_items (id serial primary key)',
        )
        .replace('      -- how to undo it', '      drop table inv_items'),
    );
  };

  beforeAll(async () => {
    fs.rmSync(workspace, { recursive: true, force: true });

    // El camino real: primero el proyecto, después los módulos.
    scaffold(createProject({ name: 'inventory-app', sambleVersion }));
    scaffold(
      createModule({ name: 'Inventory', modulesDir, from: '@samble/core' }),
    );
    scaffold(
      createEndpoint({
        target: 'inventory/count-items',
        modulesDir,
        from: '@samble/core',
        method: 'post',
        path: 'count',
        // `--permission`: la aserción se escribe VIVA. Es opt-in justamente
        // porque exige un resolutor `auth`, que un proyecto recién creado no
        // tiene. Clave NUEVA a propósito: el generador tiene que declararla.
        permission: 'inventory.count',
      }),
    );
    scaffold(
      createTable({
        target: 'inventory/item',
        modulesDir,
        from: '@samble/core',
      }),
    );
    scaffold(
      createEndpoint({
        target: 'inventory/ping',
        modulesDir,
        from: '@samble/core',
        path: 'ping',
        // `--public`: sin aserción, para los pocos que de verdad lo son.
        permission: false,
      }),
    );
    scaffold(
      createRoutine({
        target: 'inventory/nightly',
        modulesDir,
        from: '@samble/core',
      }),
    );
    scaffold(
      createMigration({
        target: 'inventory/create-items',
        modulesDir,
        from: '@samble/core',
      }),
    );
    // Lo que hace un autor a continuación: escribir el SQL y sacar el freno.
    // Sin eso el andamiaje se niega a correr, a propósito — una migración
    // vacía se anotaría como aplicada y lo que se escribiera después no
    // correría nunca.
    escribirMigracion();
    scaffold(
      createToken({
        target: 'inventory/stock',
        kind: 'contract',
        modulesDir,
        from: '@samble/core',
      }),
    );
    scaffold(
      createProvider({
        target: 'inventory/stock',
        modulesDir,
        from: '@samble/core',
      }),
    );
    scaffold(
      createToken({
        target: 'inventory/item-added',
        kind: 'slot',
        reaction: true,
        modulesDir,
        from: '@samble/core',
      }),
    );
    scaffold(
      createToken({
        target: 'inventory/labels',
        kind: 'slot',
        modulesDir,
        from: '@samble/core',
      }),
    );

    // Antes que nada: el archivo que le enseña al compilador las claves de
    // ESTA app. Sin él, los endpoints generados se tipan contra las claves de
    // la demo de `src/` — que comparte programa de TypeScript con las pruebas —
    // y `assert('inventory.count')` no compila. Una app de verdad lo tiene
    // siempre; acá hay dos apps en el mismo tsconfig.
    require(path.join(workspace, 'src/config/permissions.ts'));

    // Sin resetModules(): reiniciar el registro le daría al módulo generado una
    // copia NUEVA de samble, y su `Endpoint` ya no sería el mismo que el del
    // cargador — `instanceof` falla y no se monta ninguna ruta.
    const manifest = path.join(workspace, modulesDir, 'inventory/module.ts');
    inventory = require(manifest).default as ResolvedModule;

    db = await createTestDb(collectModuleTables([inventory]));
    app = await Samble.create({
      db,
      modules: [inventory],
      // La versión de LA APLICACIÓN, no la de samble: lo que reporta
      // `/health`. Ningún módulo la mira.
      version: '1.0.0',
      basePath: '/api',
      auth,
    });
    await app.start(0);
  });

  afterAll(async () => {
    await app?.close({ database: false }).catch(() => undefined);
    await closeTestDb();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('el manifiesto quedó válido: el módulo sirve', () => {
    // defineModule valida al importarse, así que llegar hasta acá ya significa
    // que id, versión y claves de permiso pasaron.
    // Sin `label`: el andamiaje no inventa una etiqueta que repita la clave.
    // Escribirla es opcional y queda para donde la clave no alcanza.
    expect(app.permissions()).toEqual([
      { key: 'inventory.view', moduleId: 'inventory' },
      // La segunda la declaró `endpoint --permission`.
      { key: 'inventory.count', moduleId: 'inventory' },
    ]);
  });

  it('el archivo se llama endpoint, no api: `Api` era la clase base de 1.x', () => {
    // Un generador que sigue escribiendo el nombre viejo enseña el framework
    // viejo. La carpeta y el sufijo son convención del CLI, no del framework.
    const file = `${modulesDir}/inventory/endpoints/inventory.endpoint.ts`;

    expect(fs.existsSync(path.join(workspace, file))).toBe(true);
    expect(read(file)).toContain('class InventoryEndpoint extends Endpoint');

    // Y la carpeta es lo único que lo dice: el manifiesto no repite el camino.
    expect(read(`${modulesDir}/inventory/module.ts`)).not.toContain('routes:');
    expect(inventory.implicit).toContain('routes');
  });

  it('el endpoint que vino con el módulo responde, sin declarar grupo', async () => {
    // La plantilla NO escribe `@Group`: `/api/inventory` existe porque el
    // prefijo sale del id del módulo. Si ese default se rompe, esto es 404.
    expect(
      read(`${modulesDir}/inventory/endpoints/inventory.endpoint.ts`),
    ).not.toContain('@Group');

    // Con la clave que el módulo declara: el andamiaje gatea de entrada.
    const res = await request(server())
      .get('/api/inventory')
      .set('x-perms', 'inventory.view');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('y sin ella no responde: la puerta está puesta, no de adorno', async () => {
    expect((await request(server()).get('/api/inventory')).status).toBe(401);
  });

  it('trae la aserción VIVA, con la clave que declara el manifiesto', () => {
    // Las dos mitades del andamiaje coinciden: `init` escribe un resolutor que
    // deja pasar a todos, así que la aserción puede nacer encendida. Al revés
    // —comentada— enseña que un endpoint es abierto por defecto, y el día que
    // alguien escriba autenticación de verdad todos los ya escritos siguen
    // abiertos.
    const endpoint = read(
      `${modulesDir}/inventory/endpoints/inventory.endpoint.ts`,
    );

    expect(endpoint).toMatch(/^\s*this\.auth\.assert\('inventory\.view'\);/m);
    expect(endpoint).not.toContain('// this.auth.assert(');
  });

  it('nada de lo generado lleva un comentario', () => {
    // `samble init` explica el proyecto una vez, porque ese archivo se escribe
    // una vez. Un generador corre todos los días, y su explicación termina
    // copiada en el décimo endpoint, donde ya es ruido que hay que leer de
    // largo o borrar. Lo que el autor tiene que SABER lo imprime el comando
    // como pista, dicho una vez, donde es nuevo.
    const archivos = generated(`${modulesDir}/inventory`);

    // Los ocho: manifiesto, dos endpoints, entidad, rutina, oyente,
    // migración, tres tokens y el proveedor.
    expect(archivos.length).toBeGreaterThanOrEqual(10);

    for (const archivo of archivos) {
      const contenido = read(archivo);

      expect({ archivo, tiene: contenido.includes('//') }).toEqual({
        archivo,
        tiene: false,
      });
      expect({ archivo, tiene: contenido.includes('/*') }).toEqual({
        archivo,
        tiene: false,
      });
    }
  });

  it('las claves se declaran en UN lugar: el manifiesto', () => {
    // El punto de partida: la clave escrita una vez, donde el módulo se
    // declara. No hay un permissions.ts por módulo que mantener al lado.
    expect(
      fs.existsSync(
        path.join(workspace, `${modulesDir}/inventory/permissions.ts`),
      ),
    ).toBe(false);

    const manifest = read(`${modulesDir}/inventory/module.ts`);
    expect(manifest).toContain("permissions: ['inventory.view'");
    // Y `config/permissions.ts` las LEE del manifiesto, no las repite.
    expect(read('src/config/permissions.ts')).toContain(
      "typeof import('../modules/inventory/module').default",
    );
  });

  it('el endpoint agregado después se monta con su método y su ruta', async () => {
    const res = await request(server())
      .post('/api/inventory/count')
      .set('x-perms', 'inventory.count');

    expect(res.status).toBe(200);
  });

  it('con --permission la aserción sí va viva: anónimo es 401', async () => {
    const res = await request(server()).post('/api/inventory/count');

    expect(res.status).toBe(401);
  });

  it('y con OTRO permiso es 403: hay actor, le falta la clave', async () => {
    const res = await request(server())
      .post('/api/inventory/count')
      .set('x-perms', 'inventory.view');

    expect(res.status).toBe(403);
  });

  it('--permission declara la clave donde viven, no sólo la assertea', () => {
    // Sin esto sería un 500 "Unknown permission" en vez de un 403: el
    // generador habría escrito código que no puede correr.
    expect(read(`${modulesDir}/inventory/module.ts`)).toContain(
      "'inventory.count'",
    );
    // El endpoint la exige como cadena, que es como se lee mejor. Lo que la
    // hace segura es el bloque que `create module` agregó acá:
    expect(
      read(`${modulesDir}/inventory/endpoints/count-items.endpoint.ts`),
    ).toContain("this.auth.assert('inventory.count');");
    expect(read('src/config/permissions.ts')).toContain(
      "typeof import('../modules/inventory/module').default",
    );
    expect(app.permissions().map((permission) => permission.key)).toEqual([
      'inventory.view',
      'inventory.count',
    ]);
  });

  it('un endpoint --public contesta sin resolutor: auth sigue siendo opcional', async () => {
    // El framework no exige `auth`: un endpoint que nunca toca `this.auth` no
    // necesita a nadie que resuelva. Lo que cambió es el andamiaje, no la
    // regla — y `--public` es cómo se pide un endpoint que de verdad lo es.
    const abierto = read(`${modulesDir}/inventory/endpoints/ping.endpoint.ts`);
    expect(abierto).not.toContain('this.auth');

    const sinAuth = await Samble.create({
      auth: cualquiera,
      db,
      modules: [
        require(path.join(workspace, modulesDir, 'inventory/module.ts'))
          .default,
      ],
      version: '1.0.0',
      basePath: '/api',
    });
    await sinAuth.start(0);

    try {
      const res = await request(sinAuth.getApp()).get('/api/inventory/ping');
      expect(res.status).toBe(200);
    } finally {
      await sinAuth.close({ database: false });
    }
  });

  it('la tabla la encuentra la carpeta: el manifiesto no la lista', () => {
    // Escribir la tabla es todo lo que hay que hacer. Que el manifiesto no la
    // nombre no es un olvido: `./tables/*.table.ts` es donde samble mira.
    const manifest = read(`${modulesDir}/inventory/module.ts`);

    expect(manifest).not.toContain('tables:');
    expect(manifest).not.toContain('item.table');
    // El nombre SQL, con el prefijo del módulo: es lo que evita que dos módulos
    // quieran la misma tabla.
    expect(
      inventory.tables.map((table) => getTableName(table as PgTable)),
    ).toEqual(['inventory_item']);
  });

  it('la migración corrió y quedó anotada en el registro del módulo', async () => {
    const rows = await query(
      db,
      'select module, name from _module_migrations order by name',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].module).toBe('inventory');
    expect(rows[0].name).toMatch(/^CreateItems\d+$/);
  });

  it('el módulo quedó registrado en el punto de entrada, sin editar a mano', () => {
    const entry = read('src/index.ts');

    expect(entry).toContain(
      "import inventory from './modules/inventory/module';",
    );
    expect(entry).toContain('modules: [inventory]');
  });

  it('createApp(db) arranca la app generada sobre openTestDatabase()', async () => {
    // Lo que corre `npm test` en un proyecto recién creado: el mismo
    // createApp() del despliegue, con la conexión de prueba y sin DB_* en el
    // entorno.
    process.env.SESSION_SECRET ??= 'test';
    const { createApp } = require(path.join(workspace, 'src/index.ts'));
    const testDb = await openTestDatabase();
    const generada: Samble = await createApp(testDb);
    try {
      await generada.start(0);
      expect((await request(generada.getApp()).get('/health')).status).toBe(
        200,
      );
      expect(
        (await request(generada.getApp()).get('/api/inventory/ping')).status,
      ).toBe(200);
      expect(
        await query(testDb, `select to_regclass('inv_items')::text as found`),
      ).toEqual([{ found: 'inv_items' }]);
    } finally {
      await generada.close();
      await closeTestDatabase(testDb);
    }
  });

  it('el punto de entrada compila y expone createApp() sin arrancar nada', () => {
    // Requerirlo lo TYPECHEQUEA (ts-jest) y, como `require.main` no es él, no
    // levanta ningún servidor: por eso la plantilla separa createApp() de main().
    const entry = require(path.join(workspace, 'src/index.ts'));

    expect(typeof entry.createApp).toBe('function');
  });

  it('el contrato y su proveedor quedan enchufados, sin manifiesto', async () => {
    // Dos archivos: el token en tokens/, la clase en providers/. El
    // manifiesto no nombra ninguno y el contenedor igual lo resuelve.
    const manifestoLeido = read(`${modulesDir}/inventory/module.ts`);
    expect(manifestoLeido).not.toContain('provides');

    expect(
      read(`${modulesDir}/inventory/providers/stock.provider.ts`),
    ).toContain('@Provides(Stock)');

    const container = await buildContainer([inventory], db);
    expect(container.providerOf({ id: 'inventory.stock' } as never)).toBe(
      'inventory',
    );
  });

  it('una estrategia implementa la INTERFAZ, no el token', () => {
    // Una ranura tiene dos nombres: el token es la colección y la interfaz es
    // UNA contribución. Implementar el token no compila, así que la plantilla
    // no puede confundirlos.
    const plan = createStrategy({
      target: 'reports/low-stock',
      modulesDir,
      from: '@samble/core',
      slot: 'product-badges',
    });
    const archivo = plan.files[0];

    // Carpeta y sufijo propios: en el árbol de archivos se ve que no es un
    // proveedor, que es la mitad de para qué está separado.
    expect(archivo.path).toBe(
      `${modulesDir}/reports/strategies/low-stock.strategy.ts`,
    );
    expect(archivo.content).toContain('@Fills(ProductBadges)');
    expect(archivo.content).toContain(
      'extends Strategy implements ProductBadge',
    );
    // Y el import trae las dos mitades, con el alias. Va partido porque en una
    // línea se pasa de 80 columnas — el ancho lo cubre su propia prueba.
    expect(archivo.content).toContain('ProductBadge,');
    expect(archivo.content).toContain(
      "} from '@/<module>/tokens/product-badges.token';",
    );
    // El cuerpo es el de una contribución, no el de un contrato.
    expect(archivo.content).toContain("public readonly id = 'low-stock';");
    expect(archivo.content).not.toContain('describe()');
    // Y no habla de proveedores en ninguna parte.
    expect(archivo.content).not.toContain('Provider');
  });

  it('un proveedor ya no sabe llenar ranuras: para eso está la estrategia', () => {
    // La señal de que la división es real: el generador de proveedores escribe
    // SIEMPRE la implementación de un contrato.
    const archivo = createProvider({
      target: 'reports/flag',
      modulesDir,
      from: '@samble/core',
    }).files[0];

    expect(archivo.path).toBe(
      `${modulesDir}/reports/providers/flag.provider.ts`,
    );
    expect(archivo.content).toContain('@Provides(Flag)');
    expect(archivo.content).not.toContain('Fills');
  });

  it('los tres tipos de token caen en la MISMA carpeta', () => {
    // `tokens/` es la cara pública del módulo. samble no la globea —un token se
    // importa por nombre— así que existe para ubicarse, y la sostiene el CLI.
    // Separarlos en contracts/, slots/ y events/ pedía archivar una decisión
    // que ya está tomada dentro del archivo, en el segundo argumento.
    expect(read(`${modulesDir}/inventory/tokens/stock.token.ts`)).toContain(
      "token<Stock>('inventory.stock', 'contract')",
    );

    // Una ranura DE REACCIONES: el módulo declara la carga y `Reaction<T>`
    // aporta el método, así que nadie tiene que inventarle un nombre.
    const reaccion = read(`${modulesDir}/inventory/tokens/item-added.token.ts`);
    expect(reaccion).toContain('export interface ItemAddedPayload {');
    expect(reaccion).toContain('token<Reaction<ItemAddedPayload>>(');
    expect(reaccion).toContain("'inventory.item-added',");
    expect(reaccion).toContain("'slot',");
    // Y el import trae `Reaction`, o el archivo generado no compila.
    expect(reaccion).toContain(
      "import { Reaction, token } from '@samble/core';",
    );

    const ranura = read(`${modulesDir}/inventory/tokens/labels.token.ts`);
    // El token nombra la colección, la interfaz nombra UNA contribución.
    expect(ranura).toContain('export interface Label {');
    expect(ranura).toContain("token<Label>('inventory.labels', 'slot')");
  });

  it('rutina, estrategia y migración no tocan el manifiesto', () => {
    // Cuatro generadores escribieron archivos y NINGUNO editó module.ts. Eso
    // es lo que hace que un módulo se pueda leer de un vistazo: lo que dice es
    // lo particular de este módulo, no la lista de carpetas que tienen todos.
    const manifest = read(`${modulesDir}/inventory/module.ts`);

    expect(manifest).not.toContain('routines:');
    expect(manifest).not.toContain('strategies:');
    expect(manifest).not.toContain('migrations');

    expect(inventory.routines).toEqual(['./routines/*.routine.ts']);
    expect(inventory.strategies).toEqual(['./strategies/*.strategy.ts']);
    expect(inventory.migrations.map((migration) => migration.name)).toEqual([
      expect.stringMatching(/^CreateItems\d+$/),
    ]);

    // Y ya no hay un índice de migraciones que mantener a mano.
    expect(
      fs.existsSync(
        path.join(workspace, modulesDir, 'inventory/migrations/index.ts'),
      ),
    ).toBe(false);
  });
});

describe('lo que escribe código del motor sigue al motor del proyecto', () => {
  const tabla = (dialect?: 'postgres' | 'mysql' | 'sqlite') =>
    createTable({
      target: 'billing/charge',
      modulesDir,
      from: '@samble/core',
      dialect,
    }).files[0].content;
  const migracion = (dialect?: 'postgres' | 'mysql' | 'sqlite') =>
    createMigration({
      target: 'billing/create-charges',
      modulesDir,
      from: '@samble/core',
      dialect,
      now: 1,
    }).files[0].content;

  it('la tabla usa el constructor de su motor', () => {
    expect(tabla()).toContain("pgTable('billing_charge'");
    expect(tabla('postgres')).toContain("from 'drizzle-orm/pg-core'");
    expect(tabla('sqlite')).toContain("sqliteTable('billing_charge'");
    expect(tabla('sqlite')).toContain('primaryKey({ autoIncrement: true })');
    expect(tabla('mysql')).toContain("mysqlTable('billing_charge'");
    // int().autoincrement() y no serial(): Drizzle Kit escribe un serial como
    // `serial AUTO_INCREMENT`, que MariaDB rechaza.
    expect(tabla('mysql')).toContain("int('id').autoincrement().primaryKey()");
    expect(tabla('mysql')).not.toContain('serial');
  });

  it('la migración usa el método que tiene el motor', () => {
    expect(migracion()).toContain('await db.execute(');
    expect(migracion('mysql')).toContain('await db.execute(');
    // La base de Drizzle para SQLite no tiene `execute`.
    expect(migracion('sqlite')).toContain('await db.run(');
    expect(migracion('sqlite')).not.toContain('execute');
  });

  it('lo generado entra en el ancho de prettier en los tres', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      for (const linea of [
        ...tabla(dialect).split('\n'),
        ...migracion(dialect).split('\n'),
      ]) {
        expect(linea.length).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('lo que escribe init ya viene formateado, en los tres motores', () => {
  // El proyecto corre `prettier --check` en CI: un archivo del andamiaje que
  // prettier reescribiría le rompe el lint en su primer commit. Medirlo con
  // prettier mismo es la única forma de no adivinar dónde parte una línea.
  it('prettier no cambiaría nada', async () => {
    const prettier = await import('prettier');
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const archivos = createProject({
        name: 'mi-app',
        sambleVersion,
        dialect,
      }).files;
      const opciones = JSON.parse(
        archivos.find((file) => file.path === '.prettierrc')!.content,
      );
      for (const archivo of archivos) {
        if (!/\.(ts|json|mjs)$/.test(archivo.path)) continue;
        const listo = await prettier.check(archivo.content, {
          ...opciones,
          filepath: archivo.path,
        });
        expect({ dialect, archivo: archivo.path, listo }).toEqual({
          dialect,
          archivo: archivo.path,
          listo: true,
        });
      }
    }
  });
});
