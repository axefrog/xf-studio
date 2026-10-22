// Retention and forgetting (spec 7.3). STUB until the retention module is written.
import type { Kernel } from './kernel.ts';
import type { Id } from './types.ts';

export class Retention {
  constructor(private readonly k: Kernel) {}
  maxRetainedMember(_owner: Id, _slotKey: string): number | undefined {
    void this.k;
    return undefined;
  }
}
