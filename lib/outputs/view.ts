import { Response } from 'express';
import { Output } from './output';

export class ViewOutput extends Output {
  constructor(
    private readonly template: string,
    private readonly data: object = {},
  ) {
    super();
  }

  public send(response: Response): Promise<void> {
    // The callback form on purpose: `res.render(path, data)` hands a broken
    // template to Express's own error handler, which answers a stack trace in
    // HTML and bypasses samble's error contract entirely. This way the failure
    // comes back here and is mapped like any other.
    return new Promise((resolve, reject) => {
      response.render(this.template, this.data, (error, html) => {
        if (error) {
          reject(error);
          return;
        }
        response.send(html);
        resolve();
      });
    });
  }
}

/**
 * Answers with a rendered template instead of JSON.
 *
 * The engine and the views directories are the application's business
 * (`app.setTemplates('pug', ...)`); the endpoint only names a template and
 * hands it the data.
 *
 * @example
 * public async main(): Promise<DataJson> {
 *   return view('products', { products: await this.products.find() });
 * }
 */
export function view(
  // `object`, for the same reason as `csv()`: an entity is a class and has no
  // index signature, and `view('invoice', invoice)` is a normal thing to write.
  template: string,
  data: object = {},
): Output {
  return new ViewOutput(template, data);
}
