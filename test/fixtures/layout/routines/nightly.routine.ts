import { Cron, Routine } from '../../../../lib';
import { Nightly } from '../tokens/nightly.token';

@Cron(Nightly, '0 3 * * *')
export default class NightlyRoutine extends Routine {
  public start(): void {
    // nada: la prueba sólo mira que lo encuentre
  }
}
