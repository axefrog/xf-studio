/** Animation preparation and playback are separately bounded; snapshots without deltas are diffed in resumable slices. */
export const EFFECT_MS = 300;
export const EFFECT_WORK = 256;
export interface EffectItem<T> { key: string; version: string | number; visual: T }
export function playbackEffects<T>(now: () => number) {
  type Input = { items: Iterable<EffectItem<T>>; playing: boolean; reduced: boolean; at: number };
  let previous = new Map<string, EffectItem<T>>(), epoch: unknown, playing = false, reduced = false, initialized = false;
  let work: { input: Input; iterator: Iterator<EffectItem<T>>; next: Map<string, EffectItem<T>>; removed?: Iterator<EffectItem<T>>; animate: boolean } | undefined;
  let latest: Input | undefined;
  const effects = new Map<string, { kind: "pulse" | "fade"; start: number; item: EffectItem<T> }>();
  let queue: string[] = [], cursor = 0;
  const clearEffects = () => { effects.clear(); queue = []; cursor = 0; };
  const add = (kind: "pulse" | "fade", item: EffectItem<T>, at: number) => {
    if (!effects.has(item.key)) queue.push(item.key);
    effects.set(item.key, { kind, start: at, item });
  };
  return {
    /** O(1): keep the in-progress snapshot and coalesce newer ones, so frequent answers cannot starve preparation. */
    observe(items: Iterable<EffectItem<T>>, on: boolean, context: unknown, minimal: boolean) {
      if (epoch !== context || playing !== on || reduced !== minimal) {
        clearEffects(); previous = new Map(); initialized = false; work = undefined;
      }
      epoch = context; playing = on; reduced = minimal;
      latest = { items, playing: on, reduced: minimal, at: now() };
    },
    /** Visits at most EFFECT_WORK revisions/removal candidates, inside the caller's existing frame deadline. */
    prepare(available: () => boolean = () => true) {
      let visited = 0;
      while (visited < EFFECT_WORK && available()) {
        if (!work) {
          if (!latest) break;
          const input = latest; latest = undefined;
          work = { input, iterator: input.items[Symbol.iterator](), next: new Map(), animate: initialized && input.playing && !input.reduced };
        }
        if (!work.removed) {
          const row = work.iterator.next();
          if (!row.done) {
            visited++;
            const item = row.value, old = previous.get(item.key);
            previous.delete(item.key);
            work.next.set(item.key, item);
            if (work.animate && (!old || old.version !== item.version)) add("pulse", item, work.input.at);
            else if (effects.get(item.key)?.kind === "pulse") effects.get(item.key)!.item = item;
            continue;
          }
          work.removed = previous.values();
        }
        const old = work.removed.next();
        if (!old.done) {
          visited++;
          if (work.animate && !work.next.has(old.value.key)) add("fade", old.value, work.input.at);
          continue;
        }
        previous = work.next; initialized = true; work = undefined;
      }
      return { visited, pending: !!work || !!latest };
    },
    /** At most EFFECT_WORK queued effects visited; preparation never escapes into the overlay's drawing slice. */
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
      return { effects: result, pending: effects.size > 0 || !!work || !!latest, visited };
    },
    clear() { previous = new Map(); clearEffects(); work = undefined; latest = undefined; initialized = false; },
  };
}
