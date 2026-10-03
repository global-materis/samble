import { Fills, Strategy } from '../../../../../lib';
import { PaymentMethod, PaymentMethods } from '../../shared';

@Fills(PaymentMethods)
export class CashMethod extends Strategy implements PaymentMethod {
  public readonly id = 'cash';
  public readonly label = 'Efectivo';
}
