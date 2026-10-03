import { Reaction, token } from '../../../lib';

export interface Registrado {
  id: number;
}

/** Lo único que comparten quien anuncia y quien reacciona. Ninguno importa al otro. */
export const Registrado = token<Reaction<Registrado>>(
  'demo.registrado',
  'slot',
);

/** Espía: la reacción escribe acá y la prueba lee. */
export const visto: { ids: number[] } = { ids: [] };
