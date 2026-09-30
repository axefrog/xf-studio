/**
 * Render-coverage walk (research/character-customization/render-coverage.md): every creator option of a cached catalogue projected through
 * the Studio's own coverage rules (`catalogueCoverage`, src/cc-render-coverage.ts), tallied by part, creator slot and status. Reads a
 * catalogue the host cached (private: it lists the installation's mods); prints counts and the slots that aren't fully drawn.
 *
 *   bun ../../../experiments/034-render-coverage-refresh/coverage_walk.ts <cc-catalogue-*.json>
 */
import { readFileSync } from "node:fs";
import { catalogueCoverage } from "../../projects/xf-studio/authoring/src/cc-render-coverage";

const file = process.argv[2];
if (!file) throw Error("Usage: coverage_walk.ts <catalogue json>");
const parsed = JSON.parse(readFileSync(file, "utf8"));
const catalogue = parsed.catalogue ?? parsed;
// A catalogue cached before the current schema lacks the derived fields: derive them as cc-catalogue.ts does (switcher targets from the
// choices' activations; "adds nothing" when every activation reaches no resource).
const byName = new Map<string, any>(catalogue.options.map((o: any) => [`${o.part}/${o.name}`, o]));
const nothing = (part: string, names: readonly string[], depth = 0): boolean => names.every(name => {
  const target = byName.get(`${part}/${name}`);
  if (!target) return true;
  if (target.type === "switcher") return depth < 8 && (target.choices ?? []).every((c: any) => nothing(part, c.activates ?? [], depth + 1));
  return target.type === "appearance" ? !target.app : false;
});
for (const o of catalogue.options) {
  o.targets ??= o.type === "switcher" ? [...new Set((o.choices ?? []).flatMap((c: any) => c.activates ?? []))] : [];
  o.uiSlots ??= [];
  o.emitsNothing ??= o.type === "switcher" ? (o.choices ?? []).every((c: any) => nothing(o.part, c.activates ?? [])) : nothing(o.part, [o.name]);
}
const coverage = catalogueCoverage(catalogue);
type Row = { part: string; slot: string; status: string; visible: boolean };
const rows: Row[] = catalogue.options.map((o: any) => ({ part: o.part, slot: o.uiSlot || (o.groups?.[0] ? `(${o.groups[0]})` : "(none)"),
  status: coverage.get(o.id)!.status, visible: !o.hidden }));
const tally = new Map<string, Record<string, number>>();
for (const r of rows) {
  const key = `${r.part} | ${r.slot} | ${r.visible ? "row" : "hidden"}`;
  const t = tally.get(key) ?? {}; t[r.status] = (t[r.status] ?? 0) + 1; tally.set(key, t);
}
const totals: Record<string, Record<string, number>> = {};
for (const r of rows) { const k = `${r.part} ${r.visible ? "row" : "hidden"}`; (totals[k] ??= {})[r.status] = ((totals[k]![r.status]) ?? 0) + 1; }
console.log("options", rows.length, JSON.stringify(totals));
for (const [key, t] of [...tally].sort()) if (Object.keys(t).some(s => s !== "rendered")) console.log(key, JSON.stringify(t));
