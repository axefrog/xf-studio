import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { plannedModules } from "../src/platform/api";
import { PLANNED_MODULES, STUDIO_MODULE_REGISTRATION, STUDIO_MODULES } from "../src/compose/modules";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { COMING_SOON, comingSoon, isLive, plannedShown, type ComingSoonEntry } from "../src/studio-ui/coming-soon";

/**
 * Coming soon placeholders (ui-copy-and-layout-review.md §6) never outlive their feature: a placeholder and the live feature it waits
 * for can't both exist. The feature that lands deletes its placeholder (or planned module) in the same change.
 */
const src = resolve(import.meta.dir, "..", "src");
const CATALOGUE = resolve(src, "studio-ui", "coming-soon.ts");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.ts$/.test(name) && path !== CATALOGUE ? [path] : [];
  });
}
const code = sources(src).map(path => readFileSync(path, "utf8")).join("\n");
const entries = Object.entries(COMING_SOON) as [string, ComingSoonEntry][];

test("no Coming soon placeholder waits for a feature that is already live", () => {
  const modules = new Set<string>(STUDIO_MODULES.map(module => module.id));
  const exporters = new Set(STUDIO_EXPORTERS.map(entry => entry.exporter.feature));
  const live = entries.filter(([, entry]) => {
    const id = entry.key.slice(entry.key.indexOf(":") + 1);
    if (entry.key.startsWith("module:")) return modules.has(id);
    if (entry.key.startsWith("exporter:")) return exporters.has(id);
    // An action kind or a view tool ID named anywhere in the source means the feature (or a start on it) exists.
    return code.includes(`"${id}"`);
  }).map(([id, entry]) => `${id} (${entry.key})`);
  expect(live).toEqual([]);
});

test("no planned module is also a live module", () => {
  const modules = new Set<string>(STUDIO_MODULES.map(module => module.id));
  expect(PLANNED_MODULES.filter(module => modules.has(module.id)).map(module => module.id)).toEqual([]);
  expect(plannedModules(STUDIO_MODULE_REGISTRATION).map(module => module.id)).toEqual(PLANNED_MODULES.map(module => module.id));
});

test("a planned module drops out as soon as its live module registers", () => {
  const registration = { modules: [{ id: "nails" }] as never, planned: PLANNED_MODULES };
  expect(plannedModules(registration).map(module => module.id)).not.toContain("nails");
});

test("placeholders say Coming soon plainly and name their design", () => {
  for (const [id, entry] of entries) {
    expect({ id, reason: entry.reason.startsWith("Coming soon: ") }).toEqual({ id, reason: true });
    expect({ id, short: entry.reason.length <= 90 }).toEqual({ id, short: true });
    expect({ id, design: entry.design.startsWith("research/") }).toEqual({ id, design: true });
  }
  for (const module of PLANNED_MODULES) {
    expect({ id: module.id, short: `Coming soon: ${module.comingSoon}`.length <= 80 }).toEqual({ id: module.id, short: true });
    expect(module.design.startsWith("research/")).toBe(true);
  }
});

test("the presentation hides a placeholder whose feature it can see", () => {
  const live = { actions: () => ["saves.setValue"], modules: () => ["poses"], tools: () => ["expressions.handles"] };
  const none = { actions: () => [], modules: () => [], tools: () => [] };
  expect(comingSoon("savesEdit", live, true)).toBeUndefined();
  expect(comingSoon("expressionHandles", live, true)).toBeUndefined();
  expect(comingSoon("savesEdit", none, true)?.label).toBe("Edit values");
  expect(isLive("exporter:expressions", live)).toBe(false);
});

test("the product shows only what exists: placeholders and planned modules only with research tools on", () => {
  const none = { actions: () => [], modules: () => [], tools: () => [] };
  for (const id of Object.keys(COMING_SOON) as (keyof typeof COMING_SOON)[]) expect({ id, shown: comingSoon(id, none, false) }).toEqual({ id, shown: undefined });
  expect(plannedShown(PLANNED_MODULES, false)).toEqual([]);
  expect(plannedShown(PLANNED_MODULES, true)).toEqual(PLANNED_MODULES);
});

test("module views show no Coming soon placeholders", () => {
  const views = sources(resolve(src, "features")).filter(path => /[\\/]view[\\/]/.test(path));
  expect(views.length).toBeGreaterThan(0);
  expect(views.filter(path => /coming-soon|tag: "Soon"/.test(readFileSync(path, "utf8")))).toEqual([]);
});
