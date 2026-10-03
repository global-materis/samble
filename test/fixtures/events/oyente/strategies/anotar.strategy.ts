import { Fills, Reaction, Strategy } from '../../../../../lib';
import { Registrado, visto } from '../../shared';

@Fills(Registrado)
export class AnotarStrategy extends Strategy implements Reaction<Registrado> {
  on(payload: Registrado) {
    visto.ids.push(payload.id);
  }
}
