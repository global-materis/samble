import { token } from '../../../../lib';

export interface ThingCount {
  total(): number;
}

export const ThingCount = token<ThingCount>('layout.things', 'contract');
