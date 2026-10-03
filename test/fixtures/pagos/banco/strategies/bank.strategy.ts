import { Fills, Strategy } from '../../../../../lib';
import { PaymentMethod, PaymentMethods } from '../../shared';

@Fills(PaymentMethods)
export class BankMethod extends Strategy implements PaymentMethod {
  public readonly id = 'bank';
  public readonly label = 'Transferencia';
}
