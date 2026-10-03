import { token, Fills, Reaction, Strategy } from '../../../../lib';

export const Noted = token<Reaction<{ id: number }>>('layout.noted', 'slot');

@Fills(Noted)
export default class NotedStrategy
  extends Strategy
  implements Reaction<{ id: number }>
{
  public async on(): Promise<void> {
    // nada
  }
}
