import fs from 'fs';
import path from 'path';
import slash from 'slash';

/**
 * Path aliases, carried from the compiler into the build.
 *
 * `tsconfig`'s `paths` is a COMPILE-TIME map: `tsc` type-checks
 * `import { X } from '@/identity/tokens/x.token'` and then emits
 * `require("@/identity/tokens/x.token")` verbatim. Node has never heard
 * of `@/`, so the build throws MODULE_NOT_FOUND on its first require — the
 * failure everyone hits once and nobody enjoys.
 *
 * So `samble build` rewrites them back to relative paths. Rewriting is on the
 * build's side on purpose: the alternative is a loader hook the deployed
 * process has to remember to install, and a build that only runs under a
 * wrapper is not a build.
 */

/** A prefix alias (`@/`) and the absolute folder it points at in the OUTPUT. */
export interface Alias {
  prefix: string;
  target: string;
}

/**
 * Reads `compilerOptions.paths` with the project's own TypeScript, which is
 * what understands the comments and the `extends` chain a hand-written
 * tsconfig has.
 *
 * Only prefix aliases are taken — `"@/*": ["src/modules/*"]`, one target. An
 * exact mapping or a list of fallbacks resolves by trying each in turn, which
 * is a compiler's job and not something a text rewrite can honour.
 */
export function readAliases(
  root: string,
  project: string,
  out: string,
  /** Folder the sources live in, e.g. `src`. */
  sourceDir: string,
  /** True when the output kept the `sourceDir` level. */
  keptSourceLevel: boolean,
): Alias[] {
  let ts: typeof import('typescript');
  try {
    ts = require(require.resolve('typescript', { paths: [root] }));
  } catch {
    return [];
  }

  const configPath = path.resolve(root, project);
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  } as never);

  const paths = parsed?.options.paths;
  if (!paths) return [];

  const aliases: Alias[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!pattern.endsWith('/*') || targets.length !== 1) continue;
    const target = targets[0];
    if (!target.endsWith('/*')) continue;

    // Where that folder ended up: `tsc` strips the rootDir level, so
    // `src/modules` is emitted as `modules` unless the output kept `src`.
    //
    // The leading `./` comes off first: without `baseUrl` — deprecated in TS 6
    // and gone in TS 7 — a `paths` target has to be relative, so it is written
    // `./src/modules/*` and the comparison below would miss it.
    const withoutStar = target.slice(0, -2).replace(/^\.\//, '');
    const emitted =
      keptSourceLevel || !withoutStar.startsWith(`${sourceDir}/`)
        ? withoutStar
        : withoutStar.slice(sourceDir.length + 1);

    aliases.push({
      prefix: pattern.slice(0, -1),
      target: path.resolve(out, emitted),
    });
  }

  return aliases;
}

/** `require("@/x/y")` — what tsc emits for an import in CommonJS. */
const REQUIRE = /require\((['"])([^'"]+)\1\)/g;

/**
 * Rewrites every aliased specifier in one emitted file to a relative path.
 *
 * Pure, and exported for testing: this is the step that turns a build that
 * type-checks into a build that runs.
 */
export function rewriteAliases(
  code: string,
  file: string,
  aliases: Alias[],
): string {
  if (aliases.length === 0) return code;

  return code.replace(REQUIRE, (whole, quote: string, specifier: string) => {
    const alias = aliases.find((entry) => specifier.startsWith(entry.prefix));
    if (!alias) return whole;

    const absolute = path.resolve(
      alias.target,
      specifier.slice(alias.prefix.length),
    );
    let relative = slash(path.relative(path.dirname(file), absolute));
    if (!relative.startsWith('.')) relative = `./${relative}`;

    return `require(${quote}${relative}${quote})`;
  });
}

/** Rewrites the whole output. Returns how many files changed. */
export function applyAliases(out: string, aliases: Alias[]): number {
  if (aliases.length === 0) return 0;

  let changed = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;

      const code = fs.readFileSync(full, 'utf8');
      const rewritten = rewriteAliases(code, full, aliases);
      if (rewritten !== code) {
        fs.writeFileSync(full, rewritten);
        changed += 1;
      }
    }
  };

  walk(out);
  return changed;
}
