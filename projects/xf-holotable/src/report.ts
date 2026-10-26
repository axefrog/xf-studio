// The agent's projection: the model at a moment as plain text, with its limits stated. Claims are bounded:
// absence of evidence is never reported as evidence of absence.
import { snapshotAt } from "./query.ts";
import type { ContentLevel, Session, WorldPack } from "./model.ts";

const f1 = (n: number) => n.toFixed(1);

/** The game's yaw is degrees anticlockwise from +Y (forward = (-sin yaw, cos yaw)); a compass heading runs clockwise from north. */
export const headingDeg = (yaw: number) => Math.round(((-yaw % 360) + 360) % 360);

export function report(s: Session, t: number, level: ContentLevel, world?: WorldPack): string {
  const snap = snapshotAt(s, t, level, world), m = s.meta, rel = t - m.start;
  const out = [`Holotable · session ${m.session} run ${m.run} · ${f1(rel)} s of ${f1(m.end - m.start)} s · story ${level === "full" ? "shown" : "hidden"}`];
  if (snap.v) {
    const v = snap.v;
    out.push(`V      ${v.position.map(f1).join(", ")}  heading ${headingDeg(v.yaw)}°  ${f1(v.speed)} m/s${v.inCombat ? "  in combat" : ""}${v.vehicle ? "  in a vehicle" : ""}  health ${v.health}/${v.healthMax}${v.stale ? `  (last sample ${f1(t - v.t)} s old)` : ""}`);
  } else out.push("V      no sample yet");
  if (snap.district) out.push(`Place  ${snap.district} (offline outline: an estimate)`);
  if (snap.inGap) out.push("Gap    no samples at this moment: nothing here proves what happened");
  for (const e of snap.recent) out.push(`${f1(e.t - m.start).padStart(6)} s  ${e.summary}${e.detail ? ` — ${e.detail}` : ""}  [${e.cite}]`);
  out.push(`Limits ${m.dropped} dropped, ${m.missedDeadlines} missed deadlines, largest gap ${f1(m.largestGapS)} s; ${m.coverage}`);
  return out.join("\n");
}
