import { Provider, Provides } from '../../../../lib';
import { built, Clock } from '../shared';

@Provides(Clock)
export class ClockProvider extends Provider implements Clock {
  constructor() {
    super();
    built.clock += 1;
  }

  public now(): string {
    return 'fijo';
  }
}
