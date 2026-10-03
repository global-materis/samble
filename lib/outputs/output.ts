import { Response } from 'express';

/**
 * A response that is not JSON.
 *
 * An endpoint returns data and samble serializes it. That covers an API and
 * nothing else: a rendered page, a PDF, a spreadsheet all need a content type,
 * sometimes a filename, sometimes a stream. Rather than a decorator per format
 * — which would have to be read at boot, before anyone knows what the request
 * produced — the endpoint returns the thing itself and it writes itself out.
 *
 * The consequence that matters: the SAME endpoint can answer JSON or a file
 * depending on the request, because the decision is made in `main()`, at run
 * time, where the data is.
 *
 * @example
 * public async main(): Promise<DataJson> {
 *   const rows = await this.repo.find();
 *   if (this.query.format === 'csv') return csv(rows, { filename: 'clients.csv' });
 *   return { rows };
 * }
 */
export abstract class Output {
  /**
   * Writes this result to the response.
   *
   * Throwing (or rejecting) from here is handled like any error thrown inside
   * `main()`: it is mapped and answered as an error, provided nothing has been
   * sent yet.
   */
  public abstract send(response: Response): void | Promise<void>;
}
