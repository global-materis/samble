import { Response } from 'express';
import type { Readable } from 'stream';
import { Output } from './output';

/** What a file response can carry. A stream is piped, never buffered. */
export type FileContent = Buffer | Uint8Array | string | Readable;

export interface FileOptions {
  /** MIME type, e.g. `application/pdf`. Omitted, the client has to guess. */
  type?: string;
  /**
   * Name the browser saves it under. Non-ASCII names (accents, ñ) are sent
   * both ways, so old clients get a readable fallback.
   */
  filename?: string;
  /**
   * `true` (default) offers a download; `false` asks the browser to show it in
   * place, which only works for what it can display.
   */
  download?: boolean;
}

/**
 * Builds the `Content-Disposition` header.
 *
 * A quoted filename is only safe as ASCII, and the audience here writes
 * "Reporte de cobranza.csv". So the plain form is sanitized for old clients
 * and the real name goes in `filename*` (RFC 5987), which every current
 * browser prefers.
 */
export function contentDisposition(
  filename: string | undefined,
  download: boolean,
): string {
  const type = download ? 'attachment' : 'inline';
  if (!filename) return type;
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}

/** A stream, as opposed to something already in memory. */
function isStream(content: FileContent): content is Readable {
  return (
    typeof content === 'object' &&
    content !== null &&
    typeof (content as Readable).pipe === 'function'
  );
}

export class FileOutput extends Output {
  constructor(
    private readonly content: FileContent,
    private readonly options: FileOptions = {},
  ) {
    super();
  }

  public send(response: Response): void | Promise<void> {
    const { type, filename, download = true } = this.options;
    if (type) response.type(type);
    if (filename || download) {
      response.setHeader(
        'Content-Disposition',
        contentDisposition(filename, download),
      );
    }

    if (!isStream(this.content)) {
      response.send(
        typeof this.content === 'string'
          ? this.content
          : // Already narrowed to bytes by `isStream` and the `typeof` above.
            // `Buffer.from` overloads a Buffer as string-coercible, and TS 6
            // resolves that one first without the hint.
            Buffer.from(this.content as Uint8Array),
      );
      return;
    }

    // A stream that fails halfway is the one case samble cannot turn into a
    // clean error: bytes are already on the wire. Reject so it is logged, and
    // destroy the response so the client sees a broken transfer instead of a
    // truncated file it believes is complete.
    const stream = this.content;
    return new Promise<void>((resolve, reject) => {
      stream.on('error', (error) => {
        response.destroy();
        reject(error);
      });
      response.on('finish', () => resolve());
      stream.pipe(response);
    });
  }
}

/**
 * Answers with a file instead of JSON.
 *
 * This is the general case; {@link pdf} and {@link csv} are it with the type
 * and the sensible defaults already filled in. Anything samble does not know
 * about — a zip, a spreadsheet, an image built on the fly — goes through here
 * without the framework needing to learn the format.
 *
 * @example
 * return file(await zipInvoices(ids), {
 *   type: 'application/zip',
 *   filename: 'facturas.zip',
 * });
 */
export function file(content: FileContent, options: FileOptions = {}): Output {
  return new FileOutput(content, options);
}
