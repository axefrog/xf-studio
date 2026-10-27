/** Cosmetic effects compare only small, complete painted frames; snapshots contain no story data. */
import type { Vec3 } from "../types";
type XY = readonly [number, number];
export interface PaintedMarker {
  key: string; id: string; layer: string; version: number;
  screen: XY; point: Vec3; offset: XY; tone: string; marker: string; glyph?: string; fades: boolean;
}
export const EFFECT_MS = 300, EFFECT_WORK = 256, EFFECT_MARKERS = 512;
export function playbackEffects(now: () => number) {
  let context: unknown, playing = false, reduced = false;
  let previous: ReadonlyMap<string, PaintedMarker> | undefined;
  type Effect = { kind: "pulse" | "fade"; marker: PaintedMarker; start: number };
  const effects = new Map<string, Effect>();
  const clear = () => { previous = undefined; effects.clear(); };
  return {
    clear,
    configure(on: boolean, epoch: unknown, minimal: boolean) {
      if (context !== epoch || playing !== on || reduced !== minimal || !on || minimal) clear();
      context = epoch; playing = on; reduced = minimal;
    },
    keys: () => previous?.keys() ?? [],
    paint(markers: ReadonlyMap<string, PaintedMarker>, retracted: (marker: PaintedMarker) => boolean) {
      if (!playing || reduced || markers.size > EFFECT_MARKERS) { clear(); return; }
      const at = now();
      const add = (key: string, effect: Effect) => {
        effects.delete(key); effects.set(key, effect);
        if (effects.size > EFFECT_MARKERS) effects.delete(effects.keys().next().value!);
      };
      if (previous) {
        for (const [key, marker] of markers) {
          const old = previous.get(key), effect = effects.get(key);
          if (!old || old.version !== marker.version) add(key, { kind: "pulse", marker, start: at });
          else if (effect?.kind === "pulse") effect.marker = marker;
        }
        for (const [key, marker] of previous) if (!markers.has(key)) {
          effects.delete(key);
          if (marker.fades && retracted(marker)) add(key, { kind: "fade", marker, start: at });
        }
      }
      previous = markers;
    },
    /** Rotate through at most 256 of the at-most-512 retained effects per overlay frame. */
    frame() {
      const at = now(), result: (Effect & { progress: number })[] = [];
      const count = Math.min(effects.size, EFFECT_WORK); let visited = 0;
      for (const [key, effect] of effects) {
        if (visited++ >= count) break;
        effects.delete(key);
        if (at - effect.start >= EFFECT_MS) continue;
        effects.set(key, effect); result.push({ ...effect, progress: Math.max(0, (at-effect.start)/EFFECT_MS) });
      }
      return { effects: result, pending: effects.size > 0, visited: count };
    },
  };
}
