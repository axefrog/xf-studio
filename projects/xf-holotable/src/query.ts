// Evaluating the model at a moment, and filtering it to a content level. Content levels are enforced here, at
// the boundary, so no client ever receives words its level does not allow (fail closed).
import { lastAtOrBefore } from "./recording.ts";
import { districtAt } from "./world.ts";
import type { ContentLevel, Session, Snapshot, TimelineEvent, Vec3, WorldPack } from "./model.ts";

/** A sample older than this at the asked time is reported as stale rather than current. */
export const STALE_S = 0.5;
export const RECENT_S = 5;

export function snapshotAt(s: Session, t: number, level: ContentLevel, world?: WorldPack): Snapshot {
  const v = lastAtOrBefore(s.v, t), cam = lastAtOrBefore(s.camera, t);
  const inGap = s.gaps.some(g => !g.channel && g.from < t && t < g.to);
  return {
    t, level,
    v: v && { ...v, stale: t - v.t > STALE_S },
    camera: cam && { ...cam, stale: t - cam.t > STALE_S },
    trail: trailUntil(s, t),
    placed: s.events.filter(e => e.at && e.t <= t).map(e => atLevel(e, level)),
    recent: s.events.filter(e => e.t <= t && t - e.t <= RECENT_S).map(e => atLevel(e, level)),
    inGap,
    district: v && world ? districtAt(world.areas, v.position)?.name : undefined,
  };
}

/** V's path up to t, broken at every gap: no projection may draw through missing samples. */
export function trailUntil(s: Session, t: number): Vec3[][] {
  // Gaps are anchored on the V samples either side of them (recording.ts), so a break falls between two samples.
  const breaks = new Set(s.gaps.filter(g => !g.channel).map(g => g.to));
  const runs: Vec3[][] = []; let run: Vec3[] = [];
  for (const x of s.v) {
    if (x.t > t) break;
    if (breaks.has(x.t) && run.length) { runs.push(run); run = []; }
    run.push(x.position);
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Strips what a level does not allow. `structure` keeps kinds, counts and places; never words or names. */
export function atLevel(e: TimelineEvent, level: ContentLevel): TimelineEvent {
  if (level === "full" || e.level === "structure") return e;
  const { detail: _hidden, incident: _incident, ...rest } = e;
  return rest;
}

/** The session as a client receives it: tracks, gaps and events at the client's level. */
export function sessionAtLevel(s: Session, level: ContentLevel): Session {
  return { ...s, events: s.events.map(e => atLevel(e, level)) };
}
