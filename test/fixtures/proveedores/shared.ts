import { token } from '../../../lib';

export interface Greeter {
  hello(): string;
}
export const Greeter = token<Greeter>('demo.greeter', 'contract');

export interface Clock {
  now(): string;
}
export const Clock = token<Clock>('demo.clock', 'contract');

export interface Badge {
  id: string;
}
export const Badges = token<Badge>('demo.badges', 'slot');

/** Cuántas veces se CONSTRUYÓ cada implementación. */
export const built = { greeter: 0, clock: 0 };
