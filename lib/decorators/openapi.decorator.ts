import { Endpoint } from '../templates/endpoint';

export const API_TAG = Symbol('__api_tag__');
export const API_SUMMARY = Symbol('__api_summary__');
export const API_DESCRIPTION = Symbol('__api_description__');
export const API_RESPONSES = Symbol('__api_responses__');
export const API_HIDDEN = Symbol('__api_hidden__');

export interface ApiTagMetadata {
  tags: string[];
}

export interface ApiSummaryMetadata {
  summary: string;
}

export interface ApiDescriptionMetadata {
  description: string;
}

export interface ApiResponseEntry {
  status: number;
  description?: string;
  Schema?: new () => Record<string, any>;
}

export interface ApiResponsesMetadata {
  responses: ApiResponseEntry[];
}

export interface ApiHiddenMetadata {
  hidden: boolean;
}

/**
 * Group an endpoint under one or more OpenAPI tags. If omitted, the basePath
 * from `@Module` is used as the default tag.
 */
export function ApiTag(...tags: string[]) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(API_TAG, { tags } as ApiTagMetadata, target);
  };
}

/**
 * Short summary for the endpoint (shows as the title in Swagger UI).
 */
export function ApiSummary(summary: string) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(
      API_SUMMARY,
      { summary } as ApiSummaryMetadata,
      target,
    );
  };
}

/**
 * Longer description for the endpoint (Markdown allowed in Swagger UI).
 */
export function ApiDescription(description: string) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(
      API_DESCRIPTION,
      { description } as ApiDescriptionMetadata,
      target,
    );
  };
}

/**
 * Document one possible response. Stack multiple decorators to document
 * different status codes (200, 400, 404, ...).
 */
export function ApiResponse(
  status: number,
  options: {
    description?: string;
    Schema?: new () => Record<string, any>;
  } = {},
) {
  return function (target: new () => Endpoint<any, any, any>) {
    const existing = (Reflect.getMetadata(API_RESPONSES, target) as
      ApiResponsesMetadata | undefined) ?? { responses: [] };
    existing.responses.push({ status, ...options });
    Reflect.defineMetadata(API_RESPONSES, existing, target);
  };
}

/**
 * Mounts the endpoint but keeps it out of the OpenAPI spec.
 *
 * For what the spec cannot describe honestly or should not advertise: a page
 * rendered with `view()`, a webhook meant for one provider, an internal route.
 * It changes documentation only — the route still answers, and it is still
 * subject to the same auth.
 */
export function ApiHidden() {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(
      API_HIDDEN,
      { hidden: true } as ApiHiddenMetadata,
      target,
    );
  };
}
