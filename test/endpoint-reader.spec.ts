import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { IsInt, IsString } from 'class-validator';
import EndpointReader from '../lib/core/endpoint-reader';
import {
  Endpoint,
  Body,
  Group,
  HttpGet,
  HttpPost,
  Params,
  Priority,
  Use,
} from '../lib';

class BodyDto {
  @IsString()
  name: string;
}

class ParamsDto {
  @IsInt()
  id: number;
}

@Group('users')
@HttpGet('list')
class ListUsersApi extends Endpoint {
  main() {
    return { ok: true };
  }
}

@Group('users')
@HttpPost(':id')
@Params(ParamsDto)
@Body(BodyDto)
@Priority(1)
@Use((_req, _res, next) => next())
class CreateUserApi extends Endpoint {
  main() {
    return { ok: true };
  }
}

/** No decorators: the reader must discard it. */
class NakedApi extends Endpoint {
  main() {
    return null;
  }
}

describe('EndpointReader', () => {
  it('lee grupo, verbo y ruta de los decoradores', () => {
    const reader = new EndpointReader(ListUsersApi);

    expect(reader.isInvalid()).toBe(false);
    expect(reader.group).toBe('users');
    expect(reader.method).toBe('get');
    expect(reader.pathname).toBe('list');
  });

  it('descarta una clase sin verbo HTTP', () => {
    expect(new EndpointReader(NakedApi).isInvalid()).toBe(true);
  });

  it('detecta esquemas, middleware y prioridad', () => {
    const reader = new EndpointReader(CreateUserApi);

    expect(reader.method).toBe('post');
    expect(reader.priority).toBe(1);
    expect(reader.hasSchema()).toBe(true);
    expect(reader.hasMiddleware()).toBe(true);
    expect(reader.BodySchema).toBe(BodyDto);
    expect(reader.ParamsSchema).toBe(ParamsDto);
    expect(reader.QuerySchema).toBeUndefined();
  });

  it('sin esquemas ni middleware no reporta ninguno', () => {
    const reader = new EndpointReader(ListUsersApi);

    expect(reader.hasSchema()).toBe(false);
    expect(reader.hasMiddleware()).toBe(false);
  });
});

describe('@Group es opcional: manda el id del módulo', () => {
  @HttpGet('resumen')
  class SinGrupo extends Endpoint {
    main() {
      return { ok: true };
    }
  }

  it('sin decorador, el prefijo es el id que le pasa el cargador', () => {
    // Antes esto se descartaba EN SILENCIO: arranque limpio, 404 para
    // siempre. Ahora siempre hay un prefijo del que colgar.
    const reader = new EndpointReader(SinGrupo, 'reports');

    expect(reader.isInvalid()).toBe(false);
    expect(reader.group).toBe('reports');
  });

  it('el decorador le gana al id: la URL no tiene por qué llevarlo', () => {
    // El caso de `identity`, que sirve `auth` y `users` desde un solo módulo.
    expect(new EndpointReader(ListUsersApi, 'identity').group).toBe('users');
  });

  it('fuera de un módulo y sin decorador, cuelga del basePath a secas', () => {
    expect(new EndpointReader(SinGrupo).group).toBe('');
  });
});

describe('@Group(name, { mount })', () => {
  @Group('pages', { mount: '/' })
  @HttpGet('home')
  class HomeEndpoint extends Endpoint {
    main() {
      return { ok: true };
    }
  }

  @Group('pages')
  @HttpGet('other')
  class OtherEndpoint extends Endpoint {
    main() {
      return { ok: true };
    }
  }

  it('recuerda dónde montar el grupo', () => {
    expect(new EndpointReader(HomeEndpoint).mountAt).toBe('/');
  });

  it('sin mount, manda el basePath de la aplicación', () => {
    // `null` y no `''`: son cosas distintas — `''` sería "montá en la raíz".
    expect(new EndpointReader(OtherEndpoint).mountAt).toBeNull();
  });
});
