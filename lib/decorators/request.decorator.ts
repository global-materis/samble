import { Endpoint } from '../templates/endpoint';

export const PARAMS = Symbol('__params__');
export const BODY = Symbol('__body__');
export const QUERY = Symbol('__query__');

export interface RequestMetadata {
  Schema: new () => Record<string, any>;
}

export function Params(Schema: new () => Record<string, any>) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(PARAMS, { Schema } as RequestMetadata, target);
  };
}

export function Body(Schema: new () => Record<string, any>) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(BODY, { Schema } as RequestMetadata, target);
  };
}

export function Query(Schema: new () => Record<string, any>) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(QUERY, { Schema } as RequestMetadata, target);
  };
}
