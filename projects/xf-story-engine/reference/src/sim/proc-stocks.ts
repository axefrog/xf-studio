import type { DigestBase } from './occ.ts';
import type { Id } from '../types.ts';
export interface StocksDigest extends DigestBase {
  districts: Record<Id, { E: number; Y: number; L: number; fear: number }>;
}
