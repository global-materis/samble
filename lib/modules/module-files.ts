import path from 'path';
import { Glob, globSync } from 'glob';
import slash from 'slash';

/**
 * Finding a module's files: the glob, the extension and the one-file rule.
 *
 * Separate from the loader because `defineModule()` needs it too — tables and
 * migrations resolve when the manifest is read, long before any endpoint is
 * mounted — and importing the loader from there would pull in Express, the
 * decorators and every template.
 */

/**
 * Extensions a module's files may have, in the order samble prefers them when
 * the same file exists more than once.
 *
 * `.jsc` is V8 bytecode (bytenode) and comes LAST on purpose: when a readable
 * file sits beside the compiled one, the readable one wins, so a developer
 * stepping through a module is not handed the opaque copy. The application
 * must `require('bytenode')` before `start()` — samble does not depend on it,
 * because what a `.jsc` file is depends on the Node that produced it, and a
 * framework has no business deciding that for its consumer.
 */
export const MODULE_EXTENSIONS = [
  '.ts',
  '.js',
  '.cjs',
  '.mjs',
  '.jsc',
] as const;

/**
 * Turns a module's glob into an absolute one, resolved against the module's own
 * folder rather than the process's working directory — so a module keeps
 * working wherever it is mounted from, and whatever `cwd` the process has.
 *
 * Exported for testing: path handling is where this quietly goes wrong.
 */
export function resolveModulePattern(
  pattern: string,
  dir: string | null,
): string {
  if (path.isAbsolute(pattern)) return pattern;
  return path.resolve(dir ?? process.cwd(), pattern);
}

/**
 * Makes a glob indifferent to the extension, so ONE manifest works from source
 * and from a build.
 *
 * `routes: './apis/*.api.ts'` used to find nothing once compiled: `dir` is
 * `__dirname`, which after `tsc` points at the build output where every file
 * ends in `.js`. samble warned and started with zero routes — an installation
 * that boots and answers 404 to everything, with one line in the log. The same
 * thing blocked a module shipped as a package, which is only ever `.js`.
 *
 * The author declares WHICH files, samble decides the extension.
 *
 * Exported for testing.
 */
export function withModuleExtensions(pattern: string): string {
  const known = MODULE_EXTENSIONS.find((ext) => pattern.endsWith(ext));
  const base = known ? pattern.slice(0, -known.length) : pattern;
  return `${base}.{${MODULE_EXTENSIONS.map((ext) => ext.slice(1)).join(',')}}`;
}

/**
 * One file per module, when a source tree and its build sit side by side.
 *
 * Matching every extension means `user.api.ts` and `user.api.js` can both turn
 * up — compiling in place is enough — and loading both would register every
 * route twice. Type declarations are dropped for the same reason: `*.api.d.ts`
 * matches the `.ts` branch but is not a module.
 *
 * Exported for testing.
 */
export function pickOneFilePerModule(paths: string[]): string[] {
  const rank = (file: string) => {
    const index = MODULE_EXTENSIONS.findIndex((ext) => file.endsWith(ext));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const chosen = new Map<string, string>();
  for (const file of paths) {
    if (file.endsWith('.d.ts')) continue;

    const ext = MODULE_EXTENSIONS.find((candidate) => file.endsWith(candidate));
    const key = ext ? file.slice(0, -ext.length) : file;
    const current = chosen.get(key);
    if (!current || rank(file) < rank(current)) chosen.set(key, file);
  }

  return [...chosen.values()];
}

/**
 * The glob, absolute and extension-agnostic, plus what to ignore.
 *
 * The `node_modules` exclusion is anchored to the module's own folder, NOT
 * global: a module installed as a package LIVES under `node_modules`, and an
 * unanchored ignore of that name would silently match none of its files.
 * Anchored, it still keeps a broad glob from descending into a nested one.
 */
function toGlob(pattern: string, dir: string | null) {
  return {
    pattern: slash(withModuleExtensions(resolveModulePattern(pattern, dir))),
    ignore: dir ? [slash(path.join(dir, '**/node_modules/**'))] : [],
  };
}

/** Every file matching the module's glob, whatever extension it ended up with. */
export async function readFiles(
  pattern: string,
  dir: string | null,
): Promise<string[]> {
  const { pattern: resolved, ignore } = toGlob(pattern, dir);

  const found: string[] = [];
  for await (const file of new Glob(resolved, { ignore, absolute: true })) {
    found.push(file);
  }

  return pickOneFilePerModule(found);
}

/** {@link readFiles}, without waiting. */
export function readFilesSync(pattern: string, dir: string | null): string[] {
  const { pattern: resolved, ignore } = toGlob(pattern, dir);
  return pickOneFilePerModule(globSync(resolved, { ignore, absolute: true }));
}

/** Everything the matched files export, with the files they came from. */
export interface ReadResult {
  files: string[];
  exported: unknown[];
}

/** Reads every export matching the module's patterns. */
export async function readExports(
  patterns: string[],
  dir: string | null,
): Promise<ReadResult> {
  const result: ReadResult = { files: [], exported: [] };

  for (const pattern of patterns) {
    for (const file of await readFiles(pattern, dir)) {
      result.files.push(file);
      result.exported.push(...Object.values(await require(file)));
    }
  }

  return result;
}

/**
 * {@link readExports}, without waiting — which is what a manifest needs.
 *
 * `defineModule()` runs while its own file is being required, so loading an
 * entity here is the same thing an `import` at the top of that file already
 * did: a synchronous `require`, at the same moment, in the same order.
 */
export function readExportsSync(
  patterns: string[],
  dir: string | null,
): ReadResult {
  const result: ReadResult = { files: [], exported: [] };

  for (const pattern of patterns) {
    for (const file of readFilesSync(pattern, dir)) {
      result.files.push(file);
      // Synchronous, and that is the point: this runs at the same moment a
      // top-of-file `import` would have, so the DataSource is built knowing
      // every module's entities.
      result.exported.push(...Object.values(require(file)));
    }
  }

  return result;
}
