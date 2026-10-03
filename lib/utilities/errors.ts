import { HttpStatus } from '../interfaces/http-status';
import { ErrorIdentifier } from '../interfaces/type-error';

/**
 * Every error below extends `Error`, which sounds obvious and was not true
 * until now.
 *
 * They were plain classes because `ErrorControl` tested `instanceof Error`
 * FIRST, so anything that was an Error became a 500 and the specific classes
 * had to stay outside the hierarchy to reach their own branch. The order was
 * load-bearing, and the price was paid everywhere else: no `stack` to debug
 * with when one escaped somewhere unexpected, `error instanceof Error` false in
 * application code and in third-party middleware, and tooling that assumes
 * Error — jest's `toThrow` among it — quietly refusing to see them.
 *
 * `ErrorControl` now tests the specific kinds first and `Error` last, where a
 * fallback belongs.
 */

/** Input that did not validate. Maps to 422, with the offending fields. */
export class SchemaError<T = Record<string, string>> extends Error {
  identifier = ErrorIdentifier.SCHEMA;
  status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    message: string,
    public fieldsError: Partial<Record<keyof T, string>> = {},
  ) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** A request the domain refuses. Maps to 406. */
export class CustomerError<T = Record<string, string>> extends Error {
  identifier = ErrorIdentifier.CUSTOMER;
  status = HttpStatus.NOT_ACCEPTABLE;

  constructor(
    message: string,
    public fieldsError: Partial<Record<keyof T, string>> = {},
  ) {
    super(message);
    this.name = 'CustomerError';
  }
}

/** Nothing under that identifier. Maps to 404. */
export class NotFoundError extends Error {
  identifier = ErrorIdentifier.NOT_FOUND;
  status = HttpStatus.NOT_FOUND;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Nobody is signed in. Maps to 401. */
export class AuthError extends Error {
  identifier = ErrorIdentifier.UNAUTHORIZED;
  status = HttpStatus.UNAUTHORIZED;

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * The caller is known but not allowed. Maps to 403.
 *
 * Kept apart from {@link AuthError} because the two say opposite things to a
 * client: 401 means "authenticate and try again", 403 means "don't bother".
 */
export class ForbiddenError extends Error {
  identifier = ErrorIdentifier.FORBIDDEN;
  status = HttpStatus.FORBIDDEN;

  constructor(
    message: string,
    /**
     * Permission keys the actor was missing, when the check knows them.
     *
     * It reaches the client as the `missing` member of the problem body, so a
     * screen can react to WHICH permission is absent without parsing a
     * sentence out of `detail`.
     */
    public missing: string[] = [],
  ) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Any status the thrower picks, with an optional payload. */
export class CustomError extends Error {
  identifier = ErrorIdentifier.CUSTOM;

  constructor(
    public status: HttpStatus,
    message: string,
    public response: any = null,
  ) {
    super(message);
    this.name = 'CustomError';
  }
}
