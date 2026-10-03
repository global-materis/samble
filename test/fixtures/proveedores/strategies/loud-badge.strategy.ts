import { Fills, Strategy } from '../../../../lib';
import { Badge, Badges } from '../shared';

@Fills(Badges)
export class LoudBadge extends Strategy implements Badge {
  public readonly id = 'loud';
}
