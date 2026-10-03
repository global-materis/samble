import { describe, expect, it } from '@jest/globals';
import { UserProjection } from '../src/modules/identity/domain/user.projection';

/**
 * La capa de proyección: qué forma tiene un usuario visto desde afuera.
 *
 * Todo esto corre SIN base de datos, que es la mitad del argumento: la regla
 * "la contraseña no sale" dejó de ser un comentario repetido en tres endpoints
 * y pasó a ser algo que se puede probar solo.
 */
describe('la proyección de usuario', () => {
  /** Una fila como la que devuelve `select()` sobre la tabla. */
  const fila = {
    id: 7,
    username: 'owner',
    fullName: 'Ana Pérez',
    role: 'owner' as const,
    password: 'sal:hash',
  };

  it('no deja pasar la contraseña aunque la fila la traiga', () => {
    const visto = UserProjection.asPublic(fila);

    expect(visto).toEqual({
      id: 7,
      username: 'owner',
      fullName: 'Ana Pérez',
      role: 'owner',
    });
    expect(visto).not.toHaveProperty('password');
  });

  it('copia campo por campo, no con spread', () => {
    // La trampa que esto cierra: con `{ ...row }` una columna nueva y sensible
    // entra sola en la respuesta el día que alguien la agrega a la tabla.
    const conExtra = { ...fila, resetToken: 'no-debería-salir' };

    expect(UserProjection.asPublic(conExtra)).not.toHaveProperty('resetToken');
  });

  it('el juego público no nombra la contraseña', () => {
    expect(Object.keys(UserProjection.columns).sort()).toEqual([
      'fullName',
      'id',
      'role',
      'username',
    ]);
  });

  it('el juego de login la nombra, y es el único', () => {
    // Que la excepción tenga nombre propio es lo que la distingue de un
    // descuido: `grep loginColumns` es la auditoría completa.
    expect(Object.keys(UserProjection.loginColumns)).toContain('password');
  });
});
