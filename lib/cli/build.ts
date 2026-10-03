import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { applyAliases, readAliases } from './aliases';
import { CliError } from './names';

export interface BuildOptions {
  /** Project root. */
  root: string;
  /** tsconfig to compile with. */
  project?: string;
  /** Where the build goes. */
  out?: string;
  /**
   * Folder holding what was never TypeScript — templates, static files. Its
   * non-`.ts` files are copied next to the compiled output.
   */
  assets?: string;
  /** Compiles the output to V8 bytecode and deletes the readable `.js`. */
  bytecode?: boolean;
  /**
   * Which part of the output to turn into bytecode, relative to `out`. The
   * whole output by default.
   */
  bytecodeDir?: string;
  log?: (message: string) => void;
}

export interface BuildResult {
  out: string;
  assets: number;
  compiled: number;
  /** Readable `.js` left inside the bytecode folder. Should be zero. */
  readable: number;
}

/**
 * Compiles a samble application, optionally to V8 bytecode.
 *
 * The bytecode part is a DELIVERY FORMAT and nothing more. samble does not
 * decide whether your code should be readable, does not depend on bytenode, and
 * has no opinion about licensing — it only knows how to produce the build and,
 * at run time, how to load it. Two things the caller owns:
 *
 * - a `.jsc` is tied to the Node/V8 that produced it, so the runtime ships with
 *   the build;
 * - it is opacity, not encryption: strings, identifiers and class names survive,
 *   and templates, SQL and static files were never bytecode at all.
 */
export async function runBuild(options: BuildOptions): Promise<BuildResult> {
  const log = options.log ?? (() => undefined);
  const root = options.root;
  const project = options.project ?? 'tsconfig.json';
  const out = path.resolve(root, options.out ?? 'build');
  const assetsDir = options.assets ?? 'src';

  if (!fs.existsSync(path.resolve(root, project))) {
    throw new CliError(`No "${project}" here. Pass --project <file>.`);
  }

  log(`Compiling with ${project}...`);
  fs.rmSync(out, { recursive: true, force: true });
  compileTypeScript(root, project, out);

  // Where tsc put things depends on the rootDir it inferred: a project whose
  // `include` is only `src` emits straight into `out`, one that also compiles
  // other folders keeps the `src/` level. Asking the output is more reliable
  // than reproducing that rule.
  const emittedUnderAssets = fs.existsSync(path.join(out, assetsDir));
  const assetsTarget = emittedUnderAssets ? path.join(out, assetsDir) : out;
  const assets = copyAssets(path.resolve(root, assetsDir), assetsTarget);
  log(`Copied ${assets} file(s) that were never TypeScript.`);

  // `tsc` type-checks a path alias and then emits it verbatim, which Node has
  // never heard of. Without this the build throws on its first require.
  const aliases = readAliases(
    root,
    project,
    out,
    assetsDir,
    emittedUnderAssets,
  );
  const rewritten = applyAliases(out, aliases);
  if (rewritten > 0) {
    log(
      `Resolved ${aliases
        .map((a) => a.prefix)
        .join(', ')} in ${rewritten} file(s).`,
    );
  }

  let compiled = 0;
  let readable = 0;
  if (options.bytecode) {
    const bytecodeRoot = options.bytecodeDir
      ? path.join(out, options.bytecodeDir)
      : out;
    log('Compiling to V8 bytecode...');
    compiled = toBytecode(bytecodeRoot);
    readable = countJs(bytecodeRoot);
    log(`${compiled} file(s) as .jsc; readable .js left: ${readable}`);
  }

  return { out, assets, compiled, readable };
}

/**
 * Runs the project's own TypeScript, by path.
 *
 * Not `npx tsc`: on Windows, spawning a `.cmd` from a modern Node fails with
 * EINVAL unless a shell is requested, and asking for a shell to run a compiler
 * is how quoting bugs get in.
 */
function compileTypeScript(root: string, project: string, out: string): void {
  let compiler: string;
  try {
    compiler = require.resolve('typescript/bin/tsc', { paths: [root] });
  } catch {
    throw new CliError(
      'TypeScript is not installed here. Add it with: npm i -D typescript',
    );
  }

  try {
    execFileSync(
      process.execPath,
      [compiler, '-p', project, '--outDir', out, '--incremental', 'false'],
      { cwd: root, stdio: 'inherit' },
    );
  } catch {
    throw new CliError('The build failed: fix the TypeScript errors above.');
  }
}

/** Everything that is not TypeScript: templates, static files, JSON. */
function copyAssets(from: string, to: string): number {
  if (!fs.existsSync(from)) return 0;

  let count = 0;
  const walk = (dir: string, target: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      const destination = path.join(target, entry.name);
      if (entry.isDirectory()) {
        walk(source, destination);
        continue;
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      count += 1;
    }
  };
  walk(from, to);
  return count;
}

/** Every `.js` becomes a `.jsc`, and the readable one is removed. */
function toBytecode(dir: string): number {
  let bytenode: {
    compileFile(args: { filename: string; output: string }): void;
  };
  try {
    // Required lazily and never declared as a dependency: an application that
    // ships readable JavaScript should not install a bytecode compiler.
    bytenode = require('bytenode');
  } catch {
    throw new CliError(
      'Building to bytecode needs bytenode: npm i -D bytenode',
    );
  }

  let count = 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      bytenode.compileFile({ filename: full, output: `${full}c` });
      fs.unlinkSync(full);
      count += 1;
    }
  };
  walk(dir);
  return count;
}

function countJs(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countJs(full);
    else if (entry.name.endsWith('.js')) count += 1;
  }
  return count;
}
