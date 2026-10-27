/** A bounded animation queue; time is real milliseconds, independent of replay speed. No scene or browser dependency. */
export const EFFECT_MS = 300;
export const EFFECT_WORK = 256;
export interface EffectItem<T> { key: string; version: string | number; visual: T }
export function playbackEffects<T>(now: () => number) {
  let previous = new Map<string, EffectItem<T>>(), epoch: unknown, initialized = false;
  const effects = new Map<string, { kind: "pulse" | "fade"; start: number; item: EffectItem<T> }>();
  let queue: string[] = [], cursor = 0;
  const add = (kind: "pulse" | "fade", item: EffectItem<T>) => {
    if (!effects.has(item.key)) queue.push(item.key);
    effects.set(item.key, { kind, start: now(), item });
  };
  return {
    observe(items: readonly EffectItem<T>[], playing: boolean, context: unknown, reduced: boolean) {
      const next = new Map(items.map(i => [i.key, i]));
      if (!playing || reduced || !initialized || epoch !== context) { effects.clear(); queue = []; cursor = 0; }
      else {
        for (const item of items) if (!previous.has(item.key) || previous.get(item.key)!.version !== item.version) add("pulse", item);
        for (const item of previous.values()) if (!next.has(item.key)) add("fade", item);
      }
      previous = next; epoch = context; initialized = true;
    },
    /** At most EFFECT_WORK entries visited. Repeated frames share one rotating queue; expired work cannot grow forever. */
    frame() {
      const at = now(), result: { kind: "pulse" | "fade"; progress: number; item: EffectItem<T> }[] = [];
      let visited = 0;
      while (queue.length && visited < EFFECT_WORK) {
        if (cursor >= queue.length) cursor = 0;
        const key = queue[cursor], effect = effects.get(key); visited++;
        if (!effect || at - effect.start >= EFFECT_MS) { effects.delete(key); queue[cursor] = queue[queue.length-1]; queue.pop(); continue; }
        result.push({ ...effect, progress: Math.max(0, (at-effect.start)/EFFECT_MS) }); cursor++;
        if (visited >= queue.length) break;
      }
      return { effects: result, pending: effects.size > 0, visited };
    },
    clear() { previous.clear(); effects.clear(); queue = []; cursor = 0; initialized = false; },
  };
}
