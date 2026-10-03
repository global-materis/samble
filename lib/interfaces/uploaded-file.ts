import type { Readable } from 'stream';

/**
 * One file that came in on a multipart request, as `this.file` / `this.files`.
 *
 * It is samble's OWN type, matching what multer hands over field for field, and
 * that is deliberate. This used to be `Express.Multer.File` — a namespace
 * `@types/multer` adds to the global scope — which made the framework's public
 * surface depend on a third-party global augmentation being loaded in the
 * APPLICATION's compiler. TypeScript 6 stopped pulling a module-shaped @types
 * package in just because it is installed, and `this.file` became an
 * unresolvable type in projects that had changed nothing.
 *
 * Structurally identical, so multer's own `File` and this one are assignable
 * both ways: code that already annotated a variable with either keeps
 * compiling.
 */
export interface UploadedFile {
  /** Name of the form field this file came in on. */
  fieldname: string;
  /** Name of the file on the uploader's machine. Untrusted. */
  originalname: string;
  /**
   * Value of the `Content-Transfer-Encoding` header.
   *
   * @deprecated Removed from the spec in 2015; multer still reports it.
   */
  encoding: string;
  /** Value of the `Content-Type` header. Also untrusted: it is what the client claimed. */
  mimetype: string;
  /** Size in bytes. */
  size: number;
  /** Readable stream of the file. Only a custom storage engine sees this. */
  stream: Readable;
  /** Disk storage only: the directory it was written to. */
  destination: string;
  /** Disk storage only: its name inside that directory. */
  filename: string;
  /** Disk storage only: the full path. */
  path: string;
  /** Memory storage only: the whole file. */
  buffer: Buffer;
}
