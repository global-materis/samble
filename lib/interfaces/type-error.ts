import {
  AuthError,
  CustomerError,
  CustomError,
  ForbiddenError,
  NotFoundError,
  SchemaError,
} from '../utilities/errors';

export type ErrorType =
  | Error
  | SchemaError
  | CustomerError
  | NotFoundError
  | AuthError
  | ForbiddenError
  | CustomError
  | Record<string, any>;

/**
 * The body of a failed response, shaped after RFC 9457 (`problem+json`).
 *
 * The RFC's split is the useful part: `title` is stable and tied to the kind
 * of problem, `detail` is about THIS occurrence. A client branches on `code`
 * and shows `detail`.
 *
 * `errors` is the member that is not in the RFC and is the reason this shape
 * exists at all — which FIELD failed, so a form can put the message where it
 * belongs instead of in a banner. The RFC allows extension members exactly for
 * this.
 */
export interface ProblemBody {
  /** A relative URI naming the kind of problem, e.g. `/problems/not-found`. */
  type: string;
  /** Stable summary of the kind. Does not change between occurrences. */
  title: string;
  /** The HTTP status, repeated here so a stored body is self-contained. */
  status: number;
  /** What went wrong THIS time. */
  detail: string;
  /** Machine-readable kind. Branch on this, not on `title` or `type`. */
  code: ErrorIdentifier;
  /** One message per offending field. Empty when the problem is not a field. */
  errors: Record<string, string>;
  /** The id of the request, the same one in the `x-request-id` header. */
  requestId?: string;
  /**
   * Permission keys the caller was missing. Present only on a 403 raised by
   * `this.auth.assert(...)`.
   *
   * The same keys are inside `detail` as prose; this is them structured, so a
   * screen can offer "request access to X" without parsing a sentence. It
   * exposes nothing new: `detail` already said which key was missing.
   */
  missing?: string[];
  /** Anything the thrower attached with `CustomError`. */
  response?: Record<string, any> | null;
}

/** The stable half of a problem: what its kind is called. */
export const PROBLEM_TITLES: Record<ErrorIdentifier, string> = {
  schema: 'Validation failed',
  customer: 'Request not acceptable',
  not_found: 'Not found',
  internal: 'Internal server error',
  unauthorized: 'Not authenticated',
  forbidden: 'Not allowed',
  custom: 'Request failed',
} as unknown as Record<ErrorIdentifier, string>;

export enum ErrorIdentifier {
  SCHEMA = 'schema',
  CUSTOMER = 'customer',
  NOT_FOUND = 'not_found',
  INTERNAL = 'internal',
  UNAUTHORIZED = 'unauthorized',
  FORBIDDEN = 'forbidden',
  CUSTOM = 'custom',
}
