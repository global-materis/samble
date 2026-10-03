/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Ships the demo app as V8 bytecode and boots it — `npm run demo:bytecode`.
 *
 * It answers one question about samble and nothing else: can a module be
 * delivered to a machine whose owner should not read the source?
 *
 * The compiling is NOT done here: it calls `samble build --bytecode`, the same
 * code path a consumer gets, so this script cannot quietly drift from the
 * command it is supposed to demonstrate.
 *
 * It cannot be a jest test: jest's runtime intercepts `require`, so bytenode's
 * `Module._extensions['.jsc']` never runs and the file is parsed as text. What
 * jest covers is the glob and the preference order (`test/module-loader.spec.ts`).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, '.bytecode');

// El CLI es TypeScript y este script corre con node a secas.
require('ts-node').register({ transpileOnly: true, cwd: root });
const { runBuild } = require('../../lib/cli/build');

const get = (port, url, headers) =>
  new Promise((resolve, reject) => {
    http
      .get({ port, path: url, headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            type: res.headers['content-type'],
            body,
          }),
        );
      })
      .on('error', reject);
  });

async function main() {
  const result = await runBuild({
    root,
    project: 'tsconfig.json',
    out,
    assets: 'src',
    bytecode: true,
    // Sólo la aplicación: `lib/` es el framework, público y en npm.
    bytecodeDir: 'src',
    log: (message) => console.log(message),
  });

  console.log(`\n=== Arrancando desde el bytecode (${result.compiled} .jsc)`);
  require('reflect-metadata');
  const { DataSource } = require('typeorm');
  const { PGliteDriver } = require('typeorm-pglite');
  const { Samble, Logger, collectModuleEntities } = require(
    path.join(out, 'lib'),
  );

  require(path.join(out, 'src/config/session-auth')); // amplía SambleAuth.Actor
  const modules = ['identity', 'catalog', 'reports'].map(
    (id) => require(path.join(out, `src/modules/${id}/module`)).default,
  );

  Logger.configure({ dir: path.join(out, 'logs') });
  const db = new DataSource({
    type: 'postgres',
    driver: new PGliteDriver().driver,
    database: 'bytecode_demo',
    entities: collectModuleEntities(modules),
    synchronize: false,
    logging: false,
  });
  await db.initialize();

  const app = await Samble.create({
    db,
    modules,
    version: '2.0.0',
    basePath: '/api',
    // Por cabecera: acá se prueba la carga, no el login.
    auth: (req) =>
      req.headers['x-user']
        ? {
            actor: { userId: Number(req.headers['x-user']) },
            permissions: String(req.headers['x-perms'] || '').split(','),
          }
        : null,
  });
  await app.setTemplates('pug', path.join(out, 'src/modules/*/views'));

  const port = 4399;
  await app.start(port);

  const headers = {
    'x-user': '2',
    'x-perms': 'catalog.products.view,catalog.products.manage',
  };
  const answers = [
    ['GET /api/products', await get(port, '/api/products', headers)],
    ['GET /api/products/page', await get(port, '/api/products/page', headers)],
    [
      'GET /api/products/export',
      await get(port, '/api/products/export', headers),
    ],
  ];

  console.log('\n=== Respuestas');
  for (const [name, res] of answers) {
    console.log(
      `${name.padEnd(24)} ${res.status} ${String(res.type)
        .split(';')[0]
        .padEnd(16)} ${JSON.stringify(res.body.slice(0, 60))}`,
    );
  }

  await app.close();
  // log4js escribe en diferido: sin esto el mapa queda a medias.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  console.log('\n=== Mapa de rutas (.bytecode/logs/router.log)');
  console.log(
    fs.readFileSync(path.join(out, 'logs/router.log'), 'utf8').trim(),
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
