import { dialectOfSchemaObject } from '../dialects';
import {
  MODULE_LAYOUT,
  ModuleDefinitionError,
  ModuleTable,
  ModuleGlobField,
  ModuleManifest,
  ModuleMigrations,
  ModulePattern,
  ModulePermission,
  PermissionDeclaration,
  PermissionKeysOf,
  ResolvedModule,
} from './module-manifest';
import { readExportsSync } from './module-files';
import { Logger } from '../utilities/logger';

/** Lowercase, starting with a letter: `billing`, `customer-portal`. */
const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Dot-separated segments: `billing.view`, `billing.charge.cancel`. */
const PERMISSION_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9-]*)+$/;

const fail = (message: string, moduleId: string | null = null): never => {
  throw new ModuleDefinitionError(message, moduleId);
};

const toArray = (pattern: ModulePattern | undefined): string[] => {
  if (pattern === undefined) return [];
  return Array.isArray(pattern) ? pattern : [pattern];
};

/**
 * Migrations arrive either as an array or as the namespace object from
 * `import * as migrations`. Both are flattened to one ordered array.
 */
const toMigrations = (migrations: ModuleMigrations | undefined): Function[] => {
  if (migrations === undefined) return [];
  const values = Array.isArray(migrations)
    ? migrations
    : Object.values(migrations);
  return values.filter(
    (value): value is Function => typeof value === 'function',
  );
};

/**
 * Tells a glob from the thing itself.
 *
 * `tables` and `migrations` take either, and an array of strings is the only
 * ambiguous case. An EMPTY array is not a glob: it is an author saying this
 * module has none, which is exactly what stops the default from applying.
 */
const isGlob = (value: unknown): value is ModulePattern =>
  typeof value === 'string' ||
  (Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string'));

/** What a field resolves to, and whether the author asked for it. */
interface Globs {
  patterns: string[];
  implicit: boolean;
}

/**
 * A field's globs: the manifest's, or the layout's.
 *
 * No `dir`, no default. A glob without one resolves against whatever the
 * process's working directory happens to be, and a framework scanning a folder
 * nobody pointed it at is worse than a module that mounts nothing.
 */
const globsFor = (
  field: ModuleGlobField,
  declared: ModulePattern | undefined,
  dir: string | null,
): Globs => {
  if (declared !== undefined) {
    return { patterns: toArray(declared), implicit: false };
  }
  if (!dir) return { patterns: [], implicit: false };
  return { patterns: [MODULE_LAYOUT[field]], implicit: true };
};

/**
 * Whether an export belongs in the database schema, of ANY engine.
 *
 * The manifest is imported before anyone knows which engine the application
 * runs on, so it collects every engine's schema objects and `Samble.create()`
 * refuses, by name, one that does not match. What counts per engine is the
 * dialect's call: on Postgres an ENUM has to be collected too — a table with an
 * enum column emits DDL that REFERENCES the type, so a schema without it
 * generates a migration that fails when it runs.
 *
 * Everything else exported from the same folder — a TypeScript type, a row
 * type, a helper, a DTO — is ignored, which is what lets a table file also
 * export the things that go with it.
 */
const isTable = (value: unknown): value is ModuleTable =>
  dialectOfSchemaObject(value) !== null;

/**
 * A migration class.
 *
 * Only applied to what a GLOB found. With an explicit array or namespace the
 * author already said what these are, and second-guessing that would silently
 * drop a migration written in some way samble did not foresee.
 */
const isMigration = (value: unknown): value is Function =>
  typeof value === 'function' &&
  typeof (value.prototype as { up?: unknown } | undefined)?.up === 'function';

/**
 * Loads what a glob points at, and says so when it points at nothing.
 *
 * The warning is only for a glob the AUTHOR wrote: a default finding nothing
 * means the module owns no tables, which is an ordinary module.
 */
const loadFromGlobs = <T>(
  field: 'tables' | 'migrations',
  globs: Globs,
  dir: string | null,
  id: string,
  keep: (value: unknown) => value is T,
): T[] => {
  if (globs.patterns.length === 0) return [];

  const { files, exported } = readExportsSync(globs.patterns, dir);
  // A namespace index re-exporting the same things is common and harmless: the
  // same table found twice is one table.
  const found = [...new Set(exported.filter(keep))];

  if (found.length === 0 && !globs.implicit) {
    Logger.warn(
      files.length === 0
        ? `Module "${id}": "${field}" (${globs.patterns.join(
            ', ',
          )}) matched no files. Check the glob and "dir".`
        : `Module "${id}": "${field}" matched ${
            files.length
          } file(s), none of which exports a${
            field === 'tables' ? ' table' : ' migration'
          }.`,
    );
  }

  return found;
};

const duplicates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
};

const validatePermissions = (
  permissions: ModulePermission[],
  id: string,
): void => {
  for (const permission of permissions) {
    if (!permission || typeof permission.key !== 'string') {
      fail(`Module "${id}": every permission needs a "key".`, id);
    }
    if (!PERMISSION_PATTERN.test(permission.key)) {
      fail(
        `Module "${id}": permission "${permission.key}" is not a dotted lowercase key (e.g. "${id}.view").`,
        id,
      );
    }
    // Third-party modules share one permission space; the namespace is what
    // stops two of them from claiming the same key.
    if (!permission.key.startsWith(`${id}.`)) {
      fail(
        `Module "${id}": permission "${permission.key}" must be namespaced as "${id}.<something>".`,
        id,
      );
    }
    // The label is optional, but an empty or non-string one is a mistake, not a
    // choice: whoever wrote it meant to say something.
    if (
      permission.label !== undefined &&
      (typeof permission.label !== 'string' || permission.label.trim() === '')
    ) {
      fail(
        `Module "${id}": permission "${permission.key}" has an empty "label". Give it text, or drop the field and let the key speak.`,
        id,
      );
    }
  }

  const repeated = duplicates(permissions.map((p) => p.key));
  if (repeated.length > 0) {
    fail(
      `Module "${id}": duplicated permission keys: ${repeated.join(', ')}.`,
      id,
    );
  }
};

/**
 * Declares a module and validates everything that can be known without looking
 * at the other modules: shape, formats and internal duplicates. Relational
 * checks — that a dependency exists, that ids are unique — belong to the
 * registry, which is the only one that sees every module at once.
 *
 * Validating here means a malformed manifest fails when its file is imported,
 * pointing at the module that wrote it, instead of surfacing later as a
 * confusing startup error.
 *
 * Paths are the exception: with `dir`, the standard layout
 * ({@link MODULE_LAYOUT}) is where tables, migrations, endpoints, routines and
 * strategies are found. A manifest names one of those fields only to put it
 * somewhere else, so what is left is what is particular to the module.
 *
 * @example
 * export default defineModule({
 *   id: 'billing',
 *   dir: __dirname,
 *   requires: ['identity'],
 *   permissions: [{ key: 'billing.view', label: 'View billing' }],
 * });
 *
 * @example
 * // Same module, with its endpoints somewhere else.
 * export default defineModule({
 *   id: 'billing',
 *   dir: __dirname,
 *   routes: './presentation/controllers/*.controller.ts',
 * });
 */
export function defineModule<
  const P extends readonly PermissionDeclaration[] =
    readonly PermissionDeclaration[],
>(manifest: ModuleManifest<P>): ResolvedModule<PermissionKeysOf<P>> {
  if (!manifest || typeof manifest !== 'object') {
    fail('defineModule() expects a manifest object.');
  }

  const { id } = manifest;
  if (!id || typeof id !== 'string') {
    fail('A module needs a non-empty "id".');
  }
  if (!ID_PATTERN.test(id)) {
    fail(
      `Module id "${id}" must be lowercase, start with a letter and use dashes (e.g. "customer-portal").`,
    );
  }

  const requires = manifest.requires ?? [];
  if (!Array.isArray(requires)) {
    fail(`Module "${id}": "requires" must be an array of module ids.`, id);
  }
  for (const dependency of requires) {
    if (typeof dependency !== 'string' || !ID_PATTERN.test(dependency)) {
      fail(`Module "${id}": "${dependency}" is not a valid module id.`, id);
    }
    if (dependency === id) {
      fail(`Module "${id}" cannot require itself.`, id);
    }
  }
  const repeatedDeps = duplicates(requires);
  if (repeatedDeps.length > 0) {
    fail(
      `Module "${id}": duplicated dependencies: ${repeatedDeps.join(', ')}.`,
      id,
    );
  }

  const env = manifest.env ?? [];
  if (!Array.isArray(env)) {
    fail(`Module "${id}": "env" must be an array of variable names.`, id);
  }
  for (const name of env) {
    // Checked here rather than at boot: a typo in a NAME is a module that
    // demands a variable nobody will ever set, and the file being imported is
    // where the typo can be pointed at.
    if (typeof name !== 'string' || name.trim() === '') {
      fail(
        `Module "${id}": "env" takes variable names, and got ${JSON.stringify(
          name,
        )}.`,
        id,
      );
    }
  }
  const repeatedEnv = duplicates(env);
  if (repeatedEnv.length > 0) {
    fail(
      `Module "${id}": duplicated env variables: ${repeatedEnv.join(', ')}.`,
      id,
    );
  }

  const declared = manifest.permissions ?? [];
  if (!Array.isArray(declared)) {
    fail(
      `Module "${id}": "permissions" must be an array of keys, e.g. ["${id}.view"]. (declarePermissions() was removed: pass the keys here instead.)`,
      id,
    );
  }
  // A bare key and a key with text end up the same shape, so nothing
  // downstream has to know which form the author chose.
  // The cast carries what the runtime cannot prove: normalizing erases which
  // literals were declared, and the type parameter is the only record of them.
  const permissions = (declared as readonly PermissionDeclaration[]).map(
    (entry) => (typeof entry === 'string' ? { key: entry } : entry),
  ) as ModulePermission<PermissionKeysOf<P>>[];
  validatePermissions(permissions, id);

  const consumes = manifest.consumes ?? [];
  if (!Array.isArray(consumes)) {
    fail(`Module "${id}": "consumes" must be an array.`, id);
  }
  for (const token of consumes) {
    if (!token?.id) {
      fail(
        `Module "${id}": every consumed entry must be a contract token.`,
        id,
      );
    }
  }

  const dir = manifest.dir ?? null;

  const implicit: ModuleGlobField[] = [];
  const globs = (field: ModuleGlobField, declared?: ModulePattern): Globs => {
    const resolved = globsFor(field, declared, dir);
    if (resolved.implicit) implicit.push(field);
    return resolved;
  };

  const declaredTables = manifest.tables;
  const tableGlobs = isGlob(declaredTables) ? declaredTables : undefined;
  let tables: ModuleTable[];
  if (declaredTables === undefined || tableGlobs !== undefined) {
    tables = loadFromGlobs(
      'tables',
      globs('tables', tableGlobs),
      dir,
      id,
      isTable,
    );
  } else {
    // Not a glob, so it is the list itself — `isGlob` already ruled out the
    // string forms.
    const listed = declaredTables as ModuleTable[];
    if (!Array.isArray(listed)) {
      fail(`Module "${id}": "tables" must be an array, or a glob.`, id);
    }
    if (listed.some((entry) => typeof entry === 'string')) {
      fail(
        `Module "${id}": "tables" mixes globs with tables. It is one or the other.`,
        id,
      );
    }
    if (new Set(listed).size !== listed.length) {
      fail(`Module "${id}": the same table is listed twice.`, id);
    }
    tables = listed;
  }

  const declaredMigrations = manifest.migrations;
  const migrationGlobs = isGlob(declaredMigrations)
    ? declaredMigrations
    : undefined;
  const migrations =
    declaredMigrations === undefined || migrationGlobs !== undefined
      ? loadFromGlobs(
          'migrations',
          globs('migrations', migrationGlobs),
          dir,
          id,
          isMigration,
        )
      : toMigrations(declaredMigrations as ModuleMigrations);

  const routes = globs('routes', manifest.routes);
  const routines = globs('routines', manifest.routines);
  const providers = globs('providers', manifest.providers);
  const strategies = globs('strategies', manifest.strategies);

  return {
    id,
    label: manifest.label?.trim() || id,
    requires,
    env,
    dir,
    tables,
    migrations,
    routes: routes.patterns,
    routines: routines.patterns,
    providers: providers.patterns,
    strategies: strategies.patterns,
    implicit,
    permissions,
    permissionKeys: permissions.map((permission) => permission.key),
    consumes,
  };
}
