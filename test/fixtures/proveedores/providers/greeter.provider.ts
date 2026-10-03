import { Provider, Provides } from '../../../../lib';
import { built, Clock, Greeter } from '../shared';

/** Lo que el archivo exporta además del proveedor. */
export const UNRELATED = 'no soy un proveedor';

@Provides(Greeter)
export class GreeterProvider extends Provider implements Greeter {
  /** Que esto funcione significa que `db` llegó ANTES de construir. */
  public readonly sawDb = !!this.db;

  constructor() {
    super();
    built.greeter += 1;
  }

  public hello(): string {
    // Un contrato pidiendo otro: lo resuelve el contenedor, no el autor.
    return `hola ${this.get(Clock).now()}`;
  }
}
