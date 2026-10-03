import { Endpoint } from '../templates/endpoint';

export const DEPRECATED = Symbol('__deprecated__');

/**
 * What `@Deprecated` takes. Every field is optional: the bare decorator already
 * says the one thing that matters.
 */
export interface DeprecatedOptions {
  /**
   * The day this route stops answering, as `YYYY-MM-DD`.
   *
   * Samble does NOT switch it off when the day comes — deleting the class stays
   * your decision. The date is a PROMISE you publish, and publishing it is what
   * turns "we will remove this eventually" into something a client can plan
   * around. It goes out as the `Sunset` header and into the spec.
   */
  sunset?: string;

  /**
   * The path of the route that replaces this one: `/api/v2/products/:id`.
   *
   * Without it a client learns it is on borrowed time but not where to move,
   * which is the half of the message that costs you the support thread.
   */
  use?: string;

  /** One line for whoever reads `/docs`: what changed, or why. */
  note?: string;
}

export interface DeprecatedMetadata {
  sunset: string | null;
  /**
   * `sunset` as an HTTP-date, because that is the only format the header takes.
   * Computed once, when the file is imported, rather than per request.
   */
  sunsetHeader: string | null;
  use: string | null;
  note: string | null;
}

/**
 * Marks a route as going away, without taking it down.
 *
 * Two versions of the same resource can already answer side by side — give one
 * of them a `@Group` that carries the version, and nothing else is needed. What
 * this adds is the part that makes it a MIGRATION instead of two routes nobody
 * dares delete:
 *
 * - **The spec says so.** `deprecated: true` on the operation, which Swagger UI
 *   renders struck through, plus the sunset date and the successor folded into
 *   the description.
 * - **The client is told, on every response.** `Deprecation: true`, `Sunset`
 *   when a date is given, and `Link: <...>; rel="successor-version"` when a
 *   successor is. A caller that never reads the docs still gets the signal in
 *   the one place it cannot miss. (`Sunset` is RFC 8594 and the link relation is
 *   RFC 8288; the `Deprecation` header is still an IETF draft, and this is its
 *   boolean form.)
 * - **You find out who is still calling.** The first hit per route logs a
 *   warning, which answers the question that actually blocks deleting a route.
 *   Once per process, not per request: the point is to learn that the caller
 *   exists, and a line per request would bury the boot log of a busy route.
 *   Volume is the access log's job, and the path is right there in it.
 *
 * The headers go out whatever the route answers — 200, 404 or 500 — because a
 * route being on its way out does not depend on how one call went.
 *
 * It is NOT `@ApiHidden`. Hiding the old version removes the one place a client
 * could have read which version to move to; this marks it and keeps it visible.
 *
 * @example
 * // The whole message: it is going, when, and where to.
 * \@Deprecated({ sunset: '2027-01-31', use: '/api/v2/products/:id' })
 * \@Group('v1/products')
 * \@HttpGet(':id')
 * export default class ProductV1 extends Endpoint { ... }
 *
 * @example
 * // No date decided yet. Still worth saying.
 * \@Deprecated({ note: 'Returns the flat shape. v2 nests the customer.' })
 */
export function Deprecated(options: DeprecatedOptions = {}) {
  let sunsetHeader: string | null = null;

  if (options.sunset !== undefined) {
    // Checked when the file is imported, like `@Cron`'s expression: a date that
    // does not parse would otherwise become a header nobody can read, on a
    // route that looks correctly deprecated.
    const parsed = new Date(options.sunset);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        `@Deprecated(): ${JSON.stringify(
          options.sunset,
        )} is not a date. Write it as "YYYY-MM-DD", which is the day the route stops answering.`,
      );
    }
    sunsetHeader = parsed.toUTCString();
  }

  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(
      DEPRECATED,
      {
        sunset: options.sunset ?? null,
        sunsetHeader,
        use: options.use ?? null,
        note: options.note ?? null,
      } as DeprecatedMetadata,
      target,
    );
  };
}
