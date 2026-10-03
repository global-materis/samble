import type { Readable } from 'stream';
import { file, FileOptions } from './file';
import { Output } from './output';

export type PdfOptions = Omit<FileOptions, 'type'>;

/**
 * Answers with a PDF.
 *
 * samble does not build the document — that is a library's job (pdfkit, a
 * headless browser, a reporting service) and baking one in would force every
 * application to carry it. What samble owns is the transport: the content type,
 * the filename, and whether the browser shows it or saves it.
 *
 * Unlike {@link csv}, it defaults to showing the document in the browser: a
 * receipt is meant to be looked at, and printing from the viewer is how people
 * actually use it. Pass `download: true` to force saving it.
 *
 * @example
 * const bytes = await renderReceipt(receipt);
 * return pdf(bytes, { filename: `Recibo ${receipt.number}.pdf` });
 */
export function pdf(
  content: Buffer | Uint8Array | Readable,
  options: PdfOptions = {},
): Output {
  return file(content, {
    ...options,
    type: 'application/pdf',
    download: options.download ?? false,
  });
}
