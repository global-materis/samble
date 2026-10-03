import { file } from './file';
import { Output } from './output';

/** A column: the key to read, optionally with the header to print. */
export type CsvColumn = string | { key: string; header: string };

export interface CsvOptions {
  /** Name the browser saves it under. */
  filename?: string;
  /**
   * Which columns to write, in order, and how to title them. Without this,
   * every key found in the rows is written, first-seen order, key as header —
   * which exports whatever the query happened to select, internal ids
   * included.
   */
  columns?: CsvColumn[];
  /** Separator. `;` is what a spreadsheet expects in several locales. */
  delimiter?: string;
  /**
   * Byte order mark, on by default. Without it a spreadsheet opens the file as
   * the local codepage and every accent turns to noise — the single most
   * common complaint about exported CSVs.
   */
  bom?: boolean;
  /** `true` (default) offers a download rather than showing it in place. */
  download?: boolean;
}

interface ResolvedColumn {
  key: string;
  header: string;
}

/** Declared columns, or every key the rows carry, first-seen order. */
function resolveColumns(
  rows: readonly object[],
  declared?: CsvColumn[],
): ResolvedColumn[] {
  if (declared) {
    return declared.map((column) =>
      typeof column === 'string' ? { key: column, header: column } : column,
    );
  }
  const keys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
  return [...keys].map((key) => ({ key, header: key }));
}

/** One cell as text. A Date goes out in ISO so it sorts and reimports. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Quotes a cell when it would otherwise break the row.
 *
 * Surrounding spaces are quoted too: a spreadsheet trims them, and a name that
 * arrives with trailing whitespace is usually the reason a lookup fails later.
 */
export function escapeCsvCell(text: string, delimiter: string): string {
  const needsQuotes =
    text.includes(delimiter) || /["\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Answers with a CSV file built from a list of rows.
 *
 * @example
 * const clients = await this.clients.find();
 * return csv(clients, {
 *   filename: 'Clientes.csv',
 *   columns: [
 *     { key: 'name', header: 'Nombre' },
 *     { key: 'createdAt', header: 'Alta' },
 *   ],
 * });
 */
export function csv(
  // `object` and not `Record<string, unknown>`: what gets exported is almost
  // always the result of a query, and a row may come back as a class,
  // which has no index signature. Demanding one would mean casting at every
  // call site.
  rows: readonly object[],
  options: CsvOptions = {},
): Output {
  const { delimiter = ',', bom = true, filename, download = true } = options;
  const columns = resolveColumns(rows, options.columns);

  let body = '';
  if (columns.length > 0) {
    const lines = [
      columns
        .map((column) => escapeCsvCell(column.header, delimiter))
        .join(delimiter),
      ...rows.map((row) =>
        columns
          .map((column) =>
            escapeCsvCell(
              toText((row as Record<string, unknown>)[column.key]),
              delimiter,
            ),
          )
          .join(delimiter),
      ),
    ];
    // CRLF and a trailing newline: RFC 4180, and what every spreadsheet reads
    // without arguing.
    body = lines.join('\r\n') + '\r\n';
  }

  return file((bom ? '\uFEFF' : '') + body, {
    type: 'text/csv',
    filename,
    download,
  });
}
