/**
 * What a generator produces, before anything touches the disk.
 *
 * Generators are pure: they answer "what should exist" and nothing else. The
 * writer is the only part that can fail on permissions, overwrite something or
 * print. That split is what makes the templates testable — a test asserts on
 * the text, and the same text is what gets written.
 */
export interface GeneratedFile {
  /** Path relative to the project root. */
  path: string;
  content: string;
  /**
   * A file whose whole purpose is to be rewritten, so finding it already there
   * is not a collision.
   *
   * Almost nothing is this. A migration is HISTORY — overwriting one silently
   * changes what already ran somewhere — and that is why the writer refuses by
   * default. A schema snapshot is the opposite: it records where the last
   * migration left the schema, so every generate after the first one has to
   * replace it, and refusing would mean a module could only ever have one
   * migration without `--force`.
   */
  replaces?: boolean;
}

/**
 * A change to a file the generator did not write.
 *
 * Only the edits that can be made without parsing TypeScript: appending a line,
 * adding an entry to an object or an array literal. Anything less certain than
 * that is a hint instead — a scaffolder that silently mangles a file people
 * already wrote is worse than one that tells them what to add.
 */
export interface FileEdit {
  path: string;
  /** Adds the text at the end, unless {@link appendUnless} says it is there. */
  append?: string;
  /**
   * Plain substring that means "already appended". Without it the check is the
   * whole of `append`, verbatim.
   *
   * Verbatim is not enough for anything a formatter will touch: prettier in the
   * consumer's project rewraps lines and may use different quotes, and then the
   * same generator run twice appends a second copy of a block that is already
   * there. A marker that survives reformatting — a path, an identifier — is
   * what makes the edit idempotent in a real project.
   */
  appendUnless?: string;
  /**
   * Adds a line to an object literal, right after the line that opens it.
   *
   * A line insert and not a parse: the anchor is a line the generator itself
   * wrote, so either it is there verbatim or the file is not the one we think.
   */
  objectEntry?: {
    /** Line that opens the literal, e.g. `declarePermissions('tasks', {`. */
    after: string;
    /** The line to insert, already indented. */
    value: string;
    /** Plain substring that means "already there". */
    unless: string;
  };
  /** Adds a value to an array literal field, plus the import it needs. */
  arrayEntry?: {
    /** The field holding the array, e.g. `entities`. */
    field: string;
    /** What to add, e.g. `Product` or a whole object literal. */
    value: string;
    /** The import that makes it resolve, when it needs one. */
    importLine?: string;
    /**
     * Plain substring that means "already there". Without it the check is
     * `value` as a whole word, which only holds for an identifier — an object
     * literal would be read as a regular expression.
     */
    unless?: string;
  };
}

export interface Plan {
  files: GeneratedFile[];
  edits: FileEdit[];
  /** What the author still has to do by hand, in plain words. */
  hints: string[];
}

export const plan = (
  files: GeneratedFile[],
  edits: FileEdit[] = [],
  hints: string[] = [],
): Plan => ({ files, edits, hints });
