import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { readAliases, rewriteAliases } from '../lib/cli/aliases';
import { runBuild } from '../lib/cli/build';

/**
 * Un alias de `paths` es SÓLO de compilación: `tsc` lo verifica y después lo
 * emite tal cual, que es algo que Node nunca entendió. Sin este paso el build
 * type-chequea y revienta en el primer require.
 *
 * El workspace va dentro del repo a propósito: así `require.resolve` encuentra
 * el TypeScript de acá, como lo encontraría el de un proyecto de verdad.
 */
const workspace = path.join(__dirname, '.aliases');

describe('rewriteAliases', () => {
  const aliases = [{ prefix: '@/', target: '/out/modules' }];

  it('convierte el alias en una ruta relativa al archivo', () => {
    const code = `const x = require("@/identity/tokens/user.token");`;

    expect(
      rewriteAliases(code, '/out/modules/reports/endpoints/s.js', aliases),
    ).toBe(`const x = require("../../identity/tokens/user.token");`);
  });

  it('desde la raíz de la salida queda con ./', () => {
    const code = `require('@/identity/module');`;

    expect(rewriteAliases(code, '/out/index.js', aliases)).toBe(
      `require('./modules/identity/module');`,
    );
  });

  it('no toca lo que no es un alias', () => {
    const code = `require("express"); require("./local"); require("../otro");`;

    expect(rewriteAliases(code, '/out/a/b.js', aliases)).toBe(code);
  });
});

describe('el propio repo', () => {
  it('si el tsconfig tiene paths, tiene también el require de ts-node', () => {
    // Esto se rompió de verdad: la demo pasó a usar `@/`, el tsconfig ganó el
    // alias y `npm run dev` murió en el primer import, porque `paths` es cosa
    // del compilador y ts-node no lo resuelve solo. La suite no lo vio porque
    // jest resuelve con su propio moduleNameMapper.
    const raw = fs.readFileSync(
      path.join(__dirname, '../tsconfig.json'),
      'utf8',
    );

    if (!raw.includes('"paths"')) return;
    expect(raw).toContain(
      '"ts-node": { "require": ["tsconfig-paths/register"] }',
    );
  });
});

describe('readAliases', () => {
  const root = path.join(workspace, 'read');

  it('lee paths de un tsconfig CON comentarios y quita el nivel de rootDir', () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      `{
  "compilerOptions": {
    // Un tsconfig escrito a mano tiene comentarios: JSON.parse no sirve.
    "baseUrl": ".",
    "paths": { "@/*": ["src/modules/*"], "exacto": ["src/x.ts"] }
  }
}`,
    );

    const aliases = readAliases(root, 'tsconfig.json', '/out', 'src', false);

    // El mapeo exacto se ignora: resolverlo es trabajo de un compilador.
    expect(aliases).toHaveLength(1);
    expect(aliases[0].prefix).toBe('@/');
    expect(aliases[0].target).toBe(path.resolve('/out', 'modules'));
  });

  it('si la salida conservó el nivel src/, el destino también', () => {
    const aliases = readAliases(root, 'tsconfig.json', '/out', 'src', true);

    expect(aliases[0].target).toBe(path.resolve('/out', 'src/modules'));
  });
});

describe('samble build (de punta a punta)', () => {
  const root = path.join(workspace, 'proyecto');

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('lo compilado CORRE: el alias quedó resuelto', async () => {
    fs.mkdirSync(path.join(root, 'src/modules/identity'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      `{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node10",
    "ignoreDeprecations": "6.0",
    "rootDir": "src",
    "outDir": "build",
    "paths": { "@/*": ["./src/modules/*"] },
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}`,
    );
    fs.writeFileSync(
      path.join(root, 'src/modules/identity/quien.ts'),
      `export const quien = 'identity';\n`,
    );
    fs.writeFileSync(
      path.join(root, 'src/index.ts'),
      `import { quien } from '@/identity/quien';\nexport const dice = () => quien;\n`,
    );

    const result = await runBuild({ root, out: 'build' });

    const emitido = fs.readFileSync(path.join(result.out, 'index.js'), 'utf8');
    expect(emitido).not.toContain('@/identity');

    // La prueba de verdad: requerirlo.
    const { dice } = require(path.join(result.out, 'index.js'));
    expect(dice()).toBe('identity');
  });
});
