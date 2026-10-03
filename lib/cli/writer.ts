import fs from 'fs';
import path from 'path';
import { CliError } from './names';
import { FileEdit, Plan } from './plan';

export interface WriteOptions {
  /** Project root every path in the plan is relative to. */
  root: string;
  /** Overwrites files that already exist. Off by default. */
  force?: boolean;
}

export interface WriteResult {
  created: string[];
  edited: string[];
  /** Edits that did not apply, turned into instructions. */
  hints: string[];
}

/**
 * Writes a plan.
 *
 * It refuses to overwrite anything unless asked, and it checks EVERY file
 * before writing the first one: a generator that half-creates a module leaves
 * the author reconstructing what it did.
 */
export function apply(target: Plan, options: WriteOptions): WriteResult {
  const absolute = (file: string) => path.resolve(options.root, file);

  if (!options.force) {
    const existing = target.files.filter(
      (file) => !file.replaces && fs.existsSync(absolute(file.path)),
    );
    if (existing.length > 0) {
      throw new CliError(
        `Already there: ${existing
          .map((file) => file.path)
          .join(', ')}. Use --force to overwrite.`,
      );
    }
  }

  const created: string[] = [];
  const replaced: string[] = [];
  for (const file of target.files) {
    const full = absolute(file.path);
    // Reported as updated, not created: the author is being told what happened,
    // and "created" about a file that was already there is a small lie that
    // matters the day they go looking for what changed.
    const already = file.replaces && fs.existsSync(full);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.content, 'utf8');
    (already ? replaced : created).push(file.path);
  }

  const edited: string[] = [...replaced];
  const hints = [...target.hints];
  for (const edit of target.edits) {
    const full = absolute(edit.path);
    if (!fs.existsSync(full)) {
      hints.push(describe(edit));
      continue;
    }
    const before = fs.readFileSync(full, 'utf8');
    const after = applyEdit(before, edit);
    if (after === null) {
      hints.push(describe(edit));
      continue;
    }
    if (after !== before) {
      fs.writeFileSync(full, after, 'utf8');
      edited.push(edit.path);
    }
  }

  return { created, edited, hints };
}

/**
 * Applies one edit, or answers `null` when the file does not look the way the
 * edit expects.
 *
 * Returning `null` rather than guessing is the whole policy: these edits only
 * ever run against shapes the module template itself produced, and a manifest
 * somebody rewrote by hand gets an instruction instead of a mangled file.
 */
export function applyEdit(source: string, edit: FileEdit): string | null {
  if (edit.append !== undefined) {
    if (source.includes(edit.appendUnless ?? edit.append)) return source;
    // The empty migrations index carries `export {}` so it is a module at all;
    // the first real export replaces it. Only an export replaces it, though:
    // `config/permissions.ts` carries the same line for the same reason, and
    // what gets appended there is a `declare global` block — which needs the
    // file to STAY a module.
    const cleaned = /^\s*export\s/.test(edit.append)
      ? source.replace(/^export \{\};\r?\n/m, '')
      : source;
    const separator =
      cleaned.endsWith('\n') || cleaned.length === 0 ? '' : '\n';
    return `${cleaned}${separator}${edit.append}\n`;
  }

  if (edit.objectEntry) {
    const { after, value, unless } = edit.objectEntry;
    if (source.includes(unless)) return source;

    const lines = source.split('\n');
    const opens = lines.findIndex((line) => line.includes(after));
    if (opens === -1) return null;

    // The last line of the literal, so entries keep the order they were added
    // in. Not found means the file is not the one we think it is.
    const closes = lines.findIndex(
      (line, index) => index > opens && line.trim().startsWith('})'),
    );
    if (closes === -1) return null;

    lines.splice(closes, 0, value);
    return lines.join('\n');
  }

  if (edit.arrayEntry) {
    const { field, value, importLine, unless } = edit.arrayEntry;
    const pattern = new RegExp(`(\\b${field}\\s*:\\s*\\[)([^\\]]*)(\\])`);
    const match = source.match(pattern);
    if (!match) return null;

    const current = match[2].trim();
    const already = unless
      ? current.includes(unless)
      : new RegExp(`\\b${value}\\b`).test(current);
    if (already) return source;

    // The trailing comma matters: prettier adds one when it wraps an array over
    // several lines, and appending after it produced `'a',, 'b'` — a file the
    // generator itself had written, broken by the next generator that touched
    // it.
    const body = match[2].replace(/\s*$/, '').replace(/,$/, '');
    const filled = current
      ? `${match[1]}${body}, ${value}${match[3]}`
      : `${match[1]}${value}${match[3]}`;
    const withEntry = source.replace(pattern, filled);

    return importLine ? withImport(withEntry, importLine) : withEntry;
  }

  return null;
}

/** Adds an import after the last one already there. */
function withImport(source: string, importLine: string): string {
  if (source.includes(importLine)) return source;
  const lines = source.split('\n');
  let last = -1;
  lines.forEach((line, index) => {
    if (line.startsWith('import ')) last = index;
  });
  if (last === -1) return `${importLine}\n${source}`;
  lines.splice(last + 1, 0, importLine);
  return lines.join('\n');
}

function describe(edit: FileEdit): string {
  if (edit.append) return `Add to ${edit.path}: ${edit.append}`;
  if (edit.objectEntry) {
    return `Add ${edit.objectEntry.value.trim()} to ${edit.path}.`;
  }
  if (edit.arrayEntry) {
    return `Add ${edit.arrayEntry.value} to "${edit.arrayEntry.field}" in ${edit.path}, and its import.`;
  }
  return `Check ${edit.path}.`;
}
