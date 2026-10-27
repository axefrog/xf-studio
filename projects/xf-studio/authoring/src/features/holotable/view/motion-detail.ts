/** View-local rendering policy. Time is injected; no service, gestures or effects live here. */
import { SOLID_DRAW_CAP } from "./solid-projection";

// Leave roughly one display frame for preparation within the 300 ms stop-to-full-detail budget.
export const MOTION_SETTLE_MS = 125, DETAIL_FADE_MS = 150, MOTION_DRAW_MS = 5.5;
export function cameraMotion(now: () => number) {
  let previous = "", until = -Infinity;
  return {
    frame(key: string, active = false) {
      if (active || previous !== "" && key !== previous) until = now() + MOTION_SETTLE_MS;
      previous = key;
      return now() < until;
    },
    reset() { previous = ""; until = -Infinity; },
  };
}

/** Cost includes projection/preparation/agent layers before allocating the remaining solid draw. */
export function adaptiveSolids() {
  type Cost = {perShape:number;fixed:number;count:number};
  const contexts=new Map<string,Cost>();
  const costFor=(key:string) => {
    let cost=contexts.get(key);
    if(!cost){
      if(contexts.size===4)contexts.delete(contexts.keys().next().value!);
      // A new theme/canvas starts conservatively until its actual raster cost is known.
      cost={perShape:.006,fixed:1,count:32};contexts.set(key,cost);
    }
    return cost;
  };
  return {
    limit(context="default") { return costFor(context).count; },
    observe(totalMs: number, solidMs: number, drawn: number, context="default") {
      if (!Number.isFinite(totalMs) || !Number.isFinite(solidMs) || totalMs < 0 || solidMs < 0) return;
      const model=costFor(context);
      // React quickly to a cost increase, and ease back to more detail without oscillating.
      // solidMs includes canvas clear, fills and strokes in this theme, size and DPR.
      const cost = drawn ? solidMs / drawn : model.perShape;
      model.perShape = Math.max(.0001, cost > model.perShape ? cost : model.perShape * .8 + cost * .2);
      const other = Math.max(0, totalMs - solidMs);
      model.fixed = other > model.fixed ? other : model.fixed * .8 + other * .2;
      const target = Math.max(32, Math.min(SOLID_DRAW_CAP, Math.floor((MOTION_DRAW_MS - model.fixed) / model.perShape)));
      model.count = target < model.count ? target : Math.min(target, model.count + Math.max(1, Math.ceil(model.count * .1)));
    },
  };
}

/** Stable membership, independent of traversal order, camera and frame number. */
export function motionSpot(id: string): boolean {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) % 4 === 0;
}

/** Only context detail fades. Agent pulse/retraction state is owned by playbackEffects. */
export function detailFade(now: () => number) {
  let moving = false, reduced = false, refining = false, partialPaint = false, revision = 0;
  let retained = new Set<string>(), painted = new Set<string>();
  let restStart: number | undefined;
  const births = new Map<string, number>();
  return {
    begin(inMotion: boolean, reduce: boolean) {
      // The previous paint, rather than today's deadline, owns the final invalidation.
      // This also repaints a cached partial frame when reduced motion is switched on.
      if (partialPaint) revision++;
      partialPaint = false;
      if (inMotion) { refining = true; births.clear(); restStart=undefined; }
      else if(moving)restStart=now();
      moving = inMotion; reduced = reduce; painted = new Set();
      return revision;
    },
    opacity(key: string) {
      if (moving) { if(painted.size<4096)painted.add(key); return 1; }
      if (!refining || reduced || retained.has(key)) return 1;
      let birth = births.get(key);
      if (birth === undefined) { if(births.size>=4096)return 1; birth = restStart??now(); births.set(key, birth); }
      const opacity = Math.min(1, Math.max(0, (now() - birth) / DETAIL_FADE_MS));
      partialPaint ||= opacity < 1;
      return opacity;
    },
    end() { if (moving) retained = painted; },
    pending() { return !moving && !reduced && [...births.values()].some(birth => now() - birth < DETAIL_FADE_MS); },
    reset() { moving = refining = partialPaint = false; restStart=undefined; retained.clear(); painted.clear(); births.clear(); },
  };
}
