import { Reaction, token } from '../../../../lib';

/** Contadores observables: el test espera a que las cosas pasen de verdad. */
export const beats = { count: 0, sawDb: false, sawContainer: false };

/** Lo que oyó el listener. Es la prueba de que el bus llega a la rutina. */
export const heard = { count: 0 };

export const Beat = token<Reaction<{ n: number }>>('heartbeat.beat', 'slot');

/** La misma rutina, vista como algo que se puede parar. */
export const Heartbeat = token('heartbeat.beat-task', 'schedule');
