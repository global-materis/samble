import { Request, Response } from 'express';
import { Endpoint } from '../templates/endpoint';

export const USE = Symbol('__use__');

export type MiddlewareFn = (
  req: Request,
  res: Response,
  next: () => void,
) => void;

export interface UseMetadata {
  middleware: MiddlewareFn;
}

export function Use(middleware: MiddlewareFn) {
  return function (target: new () => Endpoint<any, any, any>) {
    Reflect.defineMetadata(USE, { middleware } as UseMetadata, target);
  };
}
