import { Fills, Reaction, Strategy } from '../../../../../lib';
import { Beat, heard } from '../shared';

@Fills(Beat)
export default class HeardStrategy
  extends Strategy
  implements Reaction<{ n: number }>
{
  async on(): Promise<void> {
    heard.count += 1;
  }
}
