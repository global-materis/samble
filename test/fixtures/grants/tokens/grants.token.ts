import { token } from '../../../../lib';

export interface Grants {
  forUser(userId: number): Promise<string[] | null>;
}

export const Grants = token<Grants>('grants.policy', 'contract');
