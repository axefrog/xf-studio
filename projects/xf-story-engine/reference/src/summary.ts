// Summaries and their refinement (spec 9.3). STUB until the summary module is written.
import type { Kernel } from './kernel.ts';
import type { OpCtx } from './resolve.ts';
import type { GameTime, Id, NodeHeader, QueryScope, SlotPath, Value } from './types.ts';

export class Summaries {
  constructor(private readonly k: Kernel) {}
  itemConstraint(_ctx: OpCtx, _header: NodeHeader, _path: SlotPath, _t: GameTime): Value | undefined {
    void this.k;
    return undefined;
  }
  canonOf(_summary: Id): number[] {
    return [];
  }
  itemCandidates(_ctx: OpCtx, _scope: QueryScope, _t: GameTime, _roots: Id[]): Id[] {
    return [];
  }
}
