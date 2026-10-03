import { token } from '../../../lib';

export interface PaymentMethod {
  id: string;
  label: string;
}

export const PaymentMethods = token<PaymentMethod>(
  'billing.payment-methods',
  'slot',
);
