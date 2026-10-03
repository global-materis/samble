import { Provider } from '../../../../lib';

/**
 * Sin `@Provides`: un archivo a medio escribir, no una
 * instalación rota. Se salta con un aviso.
 */
export class NakedProvider extends Provider {
  public whatever(): string {
    return 'nada';
  }
}
