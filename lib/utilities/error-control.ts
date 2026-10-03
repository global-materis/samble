import {
  SchemaError,
  CustomerError,
  NotFoundError,
  AuthError,
  ForbiddenError,
  CustomError,
} from './errors';
import {
  ErrorIdentifier,
  ErrorType,
  ProblemBody,
  PROBLEM_TITLES,
} from '../interfaces/type-error';
import { currentRequestId } from '../core/request-id';
import type { Response } from 'express';
import { HttpStatus } from '../interfaces/http-status';
import { Logger } from './logger';

export default class ErrorControl {
  private status = HttpStatus.INTERNAL_SERVER_ERROR;
  private response: Record<string, any> | null = null;
  private message = 'Internal server error.';
  private errorFields: Record<string, any> = {};
  private identifier = ErrorIdentifier.INTERNAL;
  private missing: string[] = [];

  /**
   * Picks the status and the shape from what was thrown.
   *
   * ORDER MATTERS, and it is the specific kinds first with `Error` as the
   * fallback. It used to be the other way around, which is why none of samble's
   * error classes could extend `Error`: the generic branch would have swallowed
   * every one of them and answered 500. `Error` also has to stay AHEAD of the
   * plain-object branch below, because an Error is an object too.
   */
  private identify = () => {
    if (
      this.error instanceof SchemaError ||
      this.error instanceof CustomerError
    ) {
      this.status = this.error.status;
      this.message = this.error.message;
      this.errorFields = this.error.fieldsError;
      this.identifier = this.error.identifier;
    } else if (this.error instanceof NotFoundError) {
      this.status = this.error.status;
      this.message = this.error.message;
      this.identifier = this.error.identifier;
    } else if (this.error instanceof AuthError) {
      Logger.warn(this.error);
      this.status = this.error.status;
      this.message = this.error.message;
      this.identifier = this.error.identifier;
    } else if (this.error instanceof ForbiddenError) {
      Logger.warn(this.error);
      this.status = this.error.status;
      this.message = this.error.message;
      this.identifier = this.error.identifier;
      this.missing = this.error.missing;
    } else if (this.error instanceof CustomError) {
      this.status = this.error.status;
      this.message = this.error.message;
      this.identifier = this.error.identifier;
      this.response = this.error.response;
    } else if (this.error instanceof Error) {
      // Unexpected: whatever it is, it is a bug, so it keeps the 500 default
      // and goes to the error log with its stack.
      //
      // And its message does NOT go to the client. Nobody wrote it for a
      // reader: a driver puts the failing statement and its BOUND PARAMETERS
      // in there, which is how a 500 came to print a password hash into a
      // browser. The message is already in the log with its stack, and the
      // body carries `requestId`, so the two are still one grep apart — the
      // only thing not sending it costs is convenience for whoever should not
      // have been reading it.
      Logger.error(this.error);
    } else if (typeof this.error === 'object' && this.error !== null) {
      // A thrown plain object. It used to be answered verbatim, which meant
      // one endpoint could reply in a shape no client had a parser for. It
      // keeps its status and its payload, in the one shape everything else
      // uses.
      this.status = HttpStatus.FORBIDDEN;
      this.identifier = ErrorIdentifier.CUSTOM;
      this.message = this.error?.message ?? this.message;
      this.response = this.error;
    }
  };

  constructor(private error: ErrorType | Record<string, any>) {
    this.identify();
  }

  public getStatus = () => this.status;

  /**
   * Writes the problem to the response, with its own media type.
   *
   * `application/problem+json` is what RFC 9457 asks for, and it is how a
   * client tells a failure from a payload that happens to have a `status`
   * field. Every failure goes out through here, so there is one shape and one
   * place to change it.
   */
  public send = (response: Response): void => {
    response
      .status(this.status)
      .type('application/problem+json')
      .json(this.toJson());
  };

  /**
   * The body, shaped after RFC 9457.
   *
   * One shape for every failure: a client that can parse one failed response
   * can parse all of them. `errors` carries which FIELD is at fault, which is
   * what a form needs to put the message where it belongs.
   */
  public toJson = (): ProblemBody => {
    const code = this.identifier;
    const body: ProblemBody = {
      type: `/problems/${String(code).replace(/_/g, '-')}`,
      title: PROBLEM_TITLES[code] ?? 'Request failed',
      status: this.status,
      detail: this.message,
      code,
      errors: this.errorFields,
    };

    const requestId = currentRequestId();
    if (requestId) body.requestId = requestId;
    if (this.missing.length > 0) body.missing = this.missing;
    if (this.response) body.response = this.response;

    return body;
  };
}
