/** Resolved revision deltas queue structural markers only. Drawing never diffs items or prepares visuals. */
import type { AgentRevisionChange } from "../agent-types";
export const EFFECT_MS = 300;
export const EFFECT_WORK = 256;
export function playbackEffects(now: () => number) {
  let epoch: unknown, playing = false, reduced = false;
  type Effect = AgentRevisionChange & { start: number };
  const effects = new Map<string, Effect>();
  let queue: string[] = [], cursor = 0;
  let pending: { changes: readonly AgentRevisionChange[]; cursor: number; at: number }[] = [];
  const clear = () => { effects.clear(); queue = []; cursor = 0; pending = []; };
  return {
    observe(changes: readonly AgentRevisionChange[], on: boolean, context: unknown, minimal: boolean) {
      const continuous = epoch === context && playing === on && reduced === minimal;
      if (!continuous || !on || minimal) clear();
      else { const at=now(); pending=pending.filter(batch=>at-batch.at<EFFECT_MS); if(changes.length)pending.push({ changes, cursor: 0, at }); }
      epoch = context; playing = on; reduced = minimal;
    },
    /** At most 256 changed/queued markers visited. Batches keep all deltas, independent of the painting cursor. */
    frame() {
      const at = now(), result = new Map<string, Effect & { progress: number }>();
      pending=pending.filter(batch=>at-batch.at<EFFECT_MS);
      let visited = 0;
      while (pending.length && visited < EFFECT_WORK) {
        const batch = pending[0], change = batch.changes[batch.cursor++]; visited++;
        if (!effects.has(change.key)) queue.push(change.key);
        const effect = { ...change, start: batch.at }; effects.set(change.key, effect);
        if (at - effect.start < EFFECT_MS) { result.set(change.key,{ ...effect, progress: Math.max(0, (at-effect.start)/EFFECT_MS) }); }
        if (batch.cursor === batch.changes.length) pending.shift();
      }
      const count = queue.length;
      let scanned = 0;
      while (queue.length && visited < EFFECT_WORK && scanned++ < count) {
        if (cursor >= queue.length) cursor = 0;
        const key = queue[cursor], effect = effects.get(key); visited++;
        if (!effect || at - effect.start >= EFFECT_MS) { effects.delete(key); queue[cursor] = queue[queue.length-1]; queue.pop(); continue; }
        if (!result.has(key)) result.set(key,{ ...effect, progress: Math.max(0, (at-effect.start)/EFFECT_MS) }); cursor++;
      }
      return { effects: [...result.values()], pending: effects.size > 0 || pending.length > 0, visited };
    },
    clear,
  };
}
