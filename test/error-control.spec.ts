import { describe, expect, it } from '@jest/globals';
import ErrorControl from '../lib/utilities/error-control';
import {
  AuthError,
  CustomError,
  CustomerError,
  ForbiddenError,
  NotFoundError,
  SchemaError,
} from '../lib/utilities/errors';
import { HttpStatus } from '../lib/interfaces/http-status';
import { ErrorIdentifier } from '../lib/interfaces/type-error';

describe('ErrorControl', () => {
  it('mapea NotFoundError a 404', () => {
    const control = new ErrorControl(new NotFoundError('no existe'));

    expect(control.getStatus()).toBe(HttpStatus.NOT_FOUND);
    // La forma es la de RFC 9457: `title` es estable y describe la CLASE de
    // problema, `detail` es lo que pasó esta vez, y `code` es contra lo que un
    // cliente ramifica.
    expect(control.toJson()).toEqual({
      type: '/problems/not-found',
      title: 'Not found',
      status: HttpStatus.NOT_FOUND,
      detail: 'no existe',
      code: ErrorIdentifier.NOT_FOUND,
      errors: {},
    });
  });

  it('un fallo de validación dice DE QUÉ CAMPO, que es para lo que existe', () => {
    // Sin esto un formulario sólo puede poner el mensaje en un cartel: no sabe
    // debajo de qué input va.
    const control = new ErrorControl(
      new SchemaError('datos inválidos', {
        email: 'no es un correo',
        edad: 'debe ser un número',
      }),
    );

    expect(control.toJson().errors).toEqual({
      email: 'no es un correo',
      edad: 'debe ser un número',
    });
  });

  it('mapea AuthError a 401', () => {
    const control = new ErrorControl(new AuthError('sin permiso'));

    expect(control.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(control.toJson()).toMatchObject({
      code: ErrorIdentifier.UNAUTHORIZED,
    });
  });

  it('mapea SchemaError a 422 conservando los campos con error', () => {
    const control = new ErrorControl(
      new SchemaError('datos inválidos', { name: 'requerido' }),
    );

    expect(control.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(control.toJson()).toMatchObject({
      detail: 'datos inválidos',
      code: ErrorIdentifier.SCHEMA,
      errors: { name: 'requerido' },
    });
  });

  it('mapea CustomerError a 406', () => {
    const control = new ErrorControl(new CustomerError('saldo insuficiente'));

    expect(control.getStatus()).toBe(HttpStatus.NOT_ACCEPTABLE);
    expect(control.toJson()).toMatchObject({
      code: ErrorIdentifier.CUSTOMER,
    });
  });

  it('respeta el status y la respuesta de CustomError', () => {
    const control = new ErrorControl(
      new CustomError(HttpStatus.CONFLICT, 'duplicado', { id: 7 }),
    );

    expect(control.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(control.toJson()).toMatchObject({
      detail: 'duplicado',
      code: ErrorIdentifier.CUSTOM,
      response: { id: 7 },
    });
  });

  it('un Error nativo cae en 500 y su mensaje NO sale al cliente', () => {
    const control = new ErrorControl(new Error('algo explotó'));

    expect(control.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(control.toJson()).toMatchObject({
      detail: 'Internal server error.',
      code: ErrorIdentifier.INTERNAL,
    });
  });

  it('el mensaje del driver no se filtra: ni la consulta ni los parámetros', () => {
    // Medido, no supuesto: esto es literalmente lo que un 500 imprimió en un
    // navegador. El mensaje de un driver trae la sentencia Y sus parámetros
    // ligados, y nadie lo escribió para que lo lea un cliente.
    const control = new ErrorControl(
      new Error(
        'Failed query: select "id", "password" from "demo_users" ' +
          'where "username" = $1\nparams: owner',
      ),
    );

    const body = JSON.stringify(control.toJson());

    expect(body).not.toContain('select');
    expect(body).not.toContain('demo_users');
    expect(body).not.toContain('params');
  });

  it('un error desconocido usa el mensaje por defecto, coherente con el 500', () => {
    // Throwing a primitive matches no known branch.
    const control = new ErrorControl('boom' as unknown as Error);

    expect(control.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(control.toJson()).toMatchObject({
      detail: 'Internal server error.',
    });
  });
});

/**
 * El orden de las ramas de `identify()` es lo único que sostiene esto: la rama
 * genérica de `Error` estaba PRIMERA, y por eso ninguna clase de error de samble
 * podía extender `Error`. Ahora las extienden todas, así que si alguien vuelve
 * a poner esa rama arriba, cada 401, 403, 404, 406 y 422 se convierte en un 500
 * en silencio. Estas pruebas son el candado.
 */
describe('las clases de error son Errors de verdad', () => {
  const casos = [
    ['SchemaError', new SchemaError('x'), HttpStatus.UNPROCESSABLE_ENTITY],
    ['CustomerError', new CustomerError('x'), HttpStatus.NOT_ACCEPTABLE],
    ['NotFoundError', new NotFoundError('x'), HttpStatus.NOT_FOUND],
    ['AuthError', new AuthError('x'), HttpStatus.UNAUTHORIZED],
    ['ForbiddenError', new ForbiddenError('x'), HttpStatus.FORBIDDEN],
    [
      'CustomError',
      new CustomError(HttpStatus.CONFLICT, 'x'),
      HttpStatus.CONFLICT,
    ],
  ] as const;

  casos.forEach(([nombre, error, status]) => {
    it(`${nombre} es un Error, con nombre, mensaje y stack`, () => {
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(nombre);
      expect(error.message).toBe('x');
      // Lo que se perdía antes: sin stack, un error que se escapa a un lugar
      // inesperado no deja con qué depurar.
      expect(typeof error.stack).toBe('string');
      expect(error.stack).toContain(nombre);
    });

    it(`${nombre} sigue mapeando a ${status} y no a 500`, () => {
      expect(new ErrorControl(error).getStatus()).toBe(status);
    });
  });

  it('un Error inesperado sigue siendo 500, no la rama de objeto suelto', () => {
    // `Error` tiene que quedar DELANTE de la rama de objeto suelto, porque un
    // Error también es un objeto.
    const control = new ErrorControl(new Error('se rompió algo'));

    expect(control.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    // El `code` es lo que separa esta rama de la del objeto suelto, que
    // contesta 403 con CUSTOM. El mensaje ya no sirve para distinguirlas
    // porque un Error inesperado no manda el suyo.
    expect(control.toJson().code).toBe(ErrorIdentifier.INTERNAL);
    expect(control.toJson().detail).toBe('Internal server error.');
  });

  it('un objeto suelto lanzado sigue cayendo en su propia rama', () => {
    const control = new ErrorControl({ message: 'a mano' });

    expect(control.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(control.toJson().code).toBe(ErrorIdentifier.CUSTOM);
  });
});

describe('el 403 dice QUÉ permiso faltaba', () => {
  it('lleva las claves estructuradas, no sólo dentro del texto', () => {
    // Sin esto, una pantalla que quiera ofrecer "pedir acceso a X" tiene que
    // parsear una oración del `detail`.
    const control = new ErrorControl(
      new ForbiddenError('Missing permission: billing.void.', ['billing.void']),
    );

    expect(control.toJson().missing).toEqual(['billing.void']);
  });

  it('el campo no aparece cuando no hay claves que nombrar', () => {
    expect(
      new ErrorControl(new ForbiddenError('no')).toJson().missing,
    ).toBeUndefined();
    expect(
      new ErrorControl(new AuthError('no')).toJson().missing,
    ).toBeUndefined();
  });
});
