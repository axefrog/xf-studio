// The agent's projection: the model at a moment as plain text, with its limits stated. Claims are bounded:
// absence of evidence is never reported as evidence of absence.
import { snapshotAt } from "./query.ts";
import type { ContentLevel, Session, WorldPack } from "./model.ts";
import { whatsHere, type LayerView } from "./layers.ts";

const f1 = (n: number) => n.toFixed(1);

/** The game's yaw is degrees anticlockwise from +Y (forward = (-sin yaw, cos yaw)); a compass heading runs clockwise from north. */
export const headingDeg = (yaw: number) => Math.round(((-yaw % 360) + 360) % 360);

export function report(s: Session, t: number, level: ContentLevel, world?: WorldPack, layers: readonly LayerView[] = [], position?: [number, number, number], hidden: readonly string[] = []): string {
  const snap = snapshotAt(s, t, level, world), m = s.meta, rel = t - m.from;
  const out = [`Holotable · session ${m.session} run ${m.run} · ${f1(rel)} s of ${f1(m.to - m.from)} s · story ${level === "full" ? "shown" : "hidden"}`];
  if (snap.v) {
    const v = snap.v;
    out.push(`V      ${v.position.map(f1).join(", ")}  heading ${headingDeg(v.yaw)}°  ${f1(v.speed)} m/s${v.inCombat ? "  in combat" : ""}${v.vehicle ? "  in a vehicle" : ""}  health ${v.health}/${v.healthMax}${v.stale ? `  (last sample ${f1(t - v.t)} s old)` : ""}`);
  } else out.push("V      no sample yet");
  if (snap.district) out.push(`Place  ${snap.district} (offline outline: an estimate)`);
  if (snap.inGap) out.push("Gap    no samples at this moment: nothing here proves what happened");
  for (const e of snap.recent) out.push(`${f1(e.t - m.from).padStart(6)} s  ${e.summary}${e.detail ? ` — ${e.detail}` : ""}  [${e.cite}]`);
  const near = position ?? snap.v?.position;
  const groups = near ? whatsHere(layers, near, hidden) : layers.filter(l => !hidden.includes(l.id)).map(l => ({ layer: l.id, title: l.title, items: l.items.filter(i => i.place && !l.notPlaced.includes(i.id)).map(item => ({ item, distance: 0, sample: undefined })) }));
  out.push(position ? `What's here  ${position.map(f1).join(", ")}` : "Agent layers (near V; at most 128 items)");
  let remaining = 128;
  for (const l of layers) if (!hidden.includes(l.id)) out.push(`Layer  ${l.title} (${l.id}) · ${l.items.length} ${l.items.length === 1 ? "item" : "items"} · ${l.refused} refused${l.reason ? `: ${l.reason}` : ""}${l.notPlaced.length ? ` · ${l.notPlaced.length} not placed` : ""}${l.otherBranches.length ? ` · ${l.otherBranches.length} on other branches` : ""}`);
  for (const g of groups) {
    if (!remaining) break;
    out.push(`  ${g.title} (${g.layer})`);
    for (const { item: i, distance, sample } of g.items.slice(0, remaining)) out.push(`    ${i.id} · ${i.kind}${i.value?.name ? ` · ${i.value.name}` : ""}${i.value?.type ? ` · ${i.value.type}` : ""}${i.label ? ` · ${i.label}` : ""} · ${f1(distance)} m${sample !== undefined ? ` · sample ${JSON.stringify(sample)}` : ""}${i.region ? ` · Placed by ${i.region.kind}: ${i.region.name}` : ""}${i.facets || i.value?.facets ? ` · ${JSON.stringify(i.facets ?? i.value?.facets)}` : ""}${i.detail ? ` · ${i.detail}` : ""}${i.cite ? ` [${i.cite}]` : ""}`);
    remaining -= Math.min(g.items.length, remaining);
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0); if (total > 128) out.push(`${total - 128} further items omitted from this bounded report.`);
  if (m.problems.length) out.push(`Damage ${m.problems.join("; ")}`);
  out.push(`Limits ${m.dropped} dropped, ${m.missedDeadlines} missed deadlines, largest gap ${f1(m.largestGapS)} s; ${m.coverage}`);
  return out.join("\n");
}
