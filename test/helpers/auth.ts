import { defineAuth } from '../../lib';

/**
 * El resolutor de las pruebas que no van sobre autenticación.
 *
 * `auth` es obligatorio en `Samble.create()` a propósito: "todos pueden" es una
 * respuesta que alguien eligió, y tiene que leerse como tal. Acá se elige una
 * vez y las suites que prueban otra cosa la importan, en vez de repetir el
 * literal en cada arranque.
 *
 * Una prueba que SÍ va sobre autenticación escribe su propio resolutor: el
 * punto de esa prueba suele ser justamente que este devuelva `null`.
 */
export const cualquiera = defineAuth(async () => ({
  actor: {} as SambleAuth.Actor,
  permissions: ['*'],
}));
