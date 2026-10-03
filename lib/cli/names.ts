/**
 * Name handling for the generators.
 *
 * Everything the CLI writes — folders, files, classes, permission keys — comes
 * from one name the author typed, so the conversion has to be predictable in
 * both directions: `create endpoint catalog/list-products` must always produce
 * `list-products.api.ts` and `ListProductsApi`, whether it was typed as
 * `list-products`, `listProducts` or `ListProducts`.
 */

/** `MyModule`, `my_module`, `my module` -> `my-module`. */
export function toKebab(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** `list-products` -> `ListProducts`. */
export function toPascal(value: string): string {
  return toKebab(value)
    .split('-')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/** `list-products` -> `listProducts`, for a variable name. */
export function toCamel(value: string): string {
  const pascal = toPascal(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `list-products` -> `list_products`, for a default table name. */
export function toSnake(value: string): string {
  return toKebab(value).replace(/-/g, '_');
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export interface Target {
  /** The module this belongs to. */
  module: string;
  /** The thing being created, inside that module. */
  name: string;
}

/**
 * Reads `<module>/<name>`.
 *
 * Everything except a module itself belongs to one, and saying so in the
 * argument keeps the CLI stateless: no "current module", no config file to fall
 * out of date with the folder it describes.
 */
export function parseTarget(raw: string, what: string): Target {
  const parts = String(raw)
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 2) {
    throw new CliError(
      `Say which module it belongs to: samble ${what} <module>/<name> (e.g. "catalog/${
        toKebab(raw) || 'something'
      }").`,
    );
  }

  return { module: toKebab(parts[0]), name: toKebab(parts[1]) };
}

/** A timestamp prefix: milliseconds, which is what orders a migration. */
export function timestamp(): number {
  return Date.now();
}
