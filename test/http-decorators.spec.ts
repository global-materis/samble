import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import EndpointReader from '../lib/core/endpoint-reader';
import {
  Endpoint,
  HttpDelete,
  HttpGet,
  HttpPatch,
  HttpPost,
  HttpPut,
  HttpQuery,
  Group,
} from '../lib';

const build = (decorate: (target: any) => void) => {
  @Group('demo')
  class Demo extends Endpoint {
    main() {
      return null;
    }
  }
  decorate(Demo);
  return new EndpointReader(Demo as unknown as new () => Endpoint);
};

describe('decoradores HTTP', () => {
  it.each([
    ['get', HttpGet],
    ['post', HttpPost],
    ['put', HttpPut],
    ['delete', HttpDelete],
    ['patch', HttpPatch],
    ['query', HttpQuery],
  ])('Http* registra el verbo %s', (esperado, decorator) => {
    const reader = build((target) => decorator('ruta')(target));

    expect(reader.method).toBe(esperado);
    expect(reader.pathname).toBe('ruta');
    expect(reader.isInvalid()).toBe(false);
  });

  it('el path por defecto es vacío', () => {
    expect(build((t) => HttpQuery()(t)).pathname).toBe('');
  });
});
