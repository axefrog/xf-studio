/**
 * View contributions (feature-module platform §4, step 5): the shell derives its panel catalogue, factory
 * layouts, closed-panel homes, lazily repainted panels and activity sources from the shell's and each
 * feature's view contribution. Eye makeup's panels keep their grandfathered IDs, so saved dock layouts
 * restore; a synthetic second feature's view slots in without touching the shell.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { group, locate, parseTree, split, type DockTree } from "../src/studio-ui/dock/layout";
import { restoreDockPreference, serializeDockState } from "../src/studio-ui/dock/persist";
import { defaultCompact, defaultWide } from "../src/studio-ui/layout-defaults";
import { PANEL_IDS, PANEL_META, STUDIO_CATALOGUE, STUDIO_VIEWS } from "../src/compose/views";
import { activitySource as sourceIn, viewCatalogue, type ViewContribution } from "../src/studio-ui/views/contribution";
const activitySource = (kind: string) => sourceIn(kind, STUDIO_CATALOGUE);
import { EYE_MAKEUP_GRANDFATHERED_PANELS, EYE_MAKEUP_VIEW } from "../src/features/eye-makeup/view/contribution";
import { PANEL_FACTORIES } from "../src/compose/view-panels";
import { SHELL_VIEW } from "../src/studio-ui/views/shell";

/** The factory layouts exactly as the hand-kept `layout-defaults.ts` built them before step 5 (481c3ad). */
const BEFORE = {
  wide: (): DockTree => ({ floating: [], root: split("row", [
    split("column", [group(["presets", "library", "package"], "presets", "g-collection"),
      group(["layers", "history"], "layers", "g-layers")], [.4, .6], "s-left"),
    group(["head"], "head", "g-head"),
    split("column", [group(["uv"], "uv", "g-uv"),
      group(["finish", "shape", "edge", "warp", "character", "lighting", "motion", "quality"], "finish", "g-inspect")], [.42, .58], "s-right"),
  ], [.21, .37, .42], "s-root"), closed: ["activity", "help"] }),
  compact: (): DockTree => ({ floating: [], root: split("column", [
    split("row", [group(["head"], "head", "g-head"), group(["uv"], "uv", "g-uv")], [.38, .62], "s-stage"),
    split("row", [group(["layers", "history", "presets", "library", "package"], "layers", "g-stack"),
      group(["finish", "shape", "edge", "warp", "character", "lighting", "motion", "quality"], "finish", "g-inspect")],
    [.42, .58], "s-lower"),
  ], [.56, .44], "s-root"), closed: ["activity", "help"] }),
};
const GRANDFATHERED = ["presets", "layers", "history", "library", "package", "head", "uv", "finish", "shape",
  "edge", "warp", "character", "lighting", "motion", "quality", "activity", "help"];
const area = { x: 0, y: 0, w: 1600, h: 900 };

test("the contributions reproduce the pre-step-5 panel IDs, meta, factory layouts and homes exactly", () => {
  expect([...PANEL_IDS] as string[]).toEqual(GRANDFATHERED);
  expect(defaultWide(STUDIO_CATALOGUE)).toEqual(BEFORE.wide());
  expect(defaultCompact(STUDIO_CATALOGUE)).toEqual(BEFORE.compact());
  expect(STUDIO_CATALOGUE.homes).toEqual({ help: ["finish", "layers"] });
  expect(STUDIO_CATALOGUE.heavy).toEqual(["library", "package"]);
  expect(PANEL_META.warp).toEqual({ title: "Warp", icon: "warp", description: "Smooth displacement fields that bend the selected layer's mask." });
  expect(PANEL_META["package"].title).toBe("Mod package");
  // Eye makeup's view contributes its six panels; the shell the rest.
  expect(EYE_MAKEUP_GRANDFATHERED_PANELS).toEqual(["layers", "uv", "finish", "shape", "edge", "warp"]);
  expect(STUDIO_VIEWS.map(view => view.owner)).toEqual(["shell", "eye-makeup"]);
});

test("a dock layout saved before step 5 restores unchanged", () => {
  // A customised arrangement: History floated, Warp closed, the UV map beside the head.
  let wide = BEFORE.wide();
  const warp = locate(wide, "warp")!.group; warp.panels = warp.panels.filter(id => id !== "warp"); wide.closed.push("warp");
  const layers = locate(wide, "layers")!.group; layers.panels = ["layers"];
  wide = { ...wide, floating: [{ id: "w-history", x: 900, y: 120, w: 320, h: 400, node: group(["history"], "history", "g-history") }] };
  const saved = JSON.parse(JSON.stringify(serializeDockState({ wide, compact: BEFORE.compact() })));
  const restored = restoreDockPreference(saved, area, STUDIO_CATALOGUE);
  expect(restored.recovered).toBe(true);
  expect(restored.state).toEqual(saved.state);
});

test("every contributed panel has a factory, and every action kind an activity source from a contribution", () => {
  expect(Object.keys(PANEL_FACTORIES).sort()).toEqual([...PANEL_IDS].sort());
  expect(Object.keys(ACTION_DESCRIPTORS).filter(kind => activitySource(kind) === "Studio")).toEqual([]);
  expect([activitySource("history.undo"), activitySource("history.jumpTo"), activitySource("layer.setEnabled"),
    activitySource("layer.setOpacity"), activitySource("point.move"), activitySource("camera.front")])
    .toEqual(["Undo", "History", "Layers", "Colour & finish", "Shape", "Camera"]);
});

test("new features use <feature>.<panel> IDs; only the shell's and eye makeup's grandfathered IDs are bare", () => {
  for (const view of STUDIO_VIEWS as readonly ViewContribution[])
    for (const panel of view.panels)
      if (view.owner !== "shell" && !EYE_MAKEUP_GRANDFATHERED_PANELS.includes(panel.id)) expect(panel.id.startsWith(`${view.owner}.`)).toBe(true);
  expect(() => viewCatalogue([SHELL_VIEW, EYE_MAKEUP_VIEW, { owner: "hair", panels: [{ ...SHELL_VIEW.panels[0] }], activity: [] }]))
    .toThrow("contributed twice");
});

test("a second feature's view slots into the shell's layouts, and a saved layout gains its panel", () => {
  const HAIR_VIEW: ViewContribution = { owner: "hair", activity: [{ pattern: /^hair\./, label: "Hair" }],
    panels: [{ id: "hair.strands", title: "Strands", icon: "shape", description: "Hair strands.", order: 115, slot: "inspect" }] };
  const catalogue = viewCatalogue([...STUDIO_VIEWS, HAIR_VIEW]);
  expect(catalogue.ids.slice(10, 13)).toEqual(["warp", "hair.strands", "character"]);
  expect(locate(defaultWide(catalogue), "hair.strands")!.group.panels).toEqual(
    ["finish", "shape", "edge", "warp", "hair.strands", "character", "lighting", "motion", "quality"]);
  expect(sourceIn("hair.setColour", catalogue)).toBe("Hair");
  // A layout saved before the feature existed keeps its arrangement; the new panel joins its default group.
  const saved = BEFORE.wide();
  const restored = parseTree(JSON.parse(JSON.stringify(saved)), catalogue.ids, defaultWide(catalogue))!;
  expect(locate(restored, "hair.strands")!.group.id).toBe("g-inspect");
  expect(locate(restored, "layers")!.group.panels).toEqual(["layers", "history"]);
  // Without eye makeup's view the shell's layout drops the slots nobody fills.
  const shellOnly = defaultWide(viewCatalogue([SHELL_VIEW]));
  expect(locate(shellOnly, "uv")).toBeUndefined();
  expect(locate(shellOnly, "presets")!.group.panels).toEqual(["presets", "library", "package"]);
});

test("the shell names no feature's panels: panel modules are bound only by the view factories", () => {
  const source = (name: string) => readFileSync(new URL(`../src/studio-ui/${name}`, import.meta.url), "utf8");
  for (const name of ["app.ts", "layout-defaults.ts", "panel-meta.ts", "runtime.ts"]) {
    const code = source(name);
    expect(code, name).not.toMatch(/from "\.\/panels\/(inspector|layers|viewports|preview|history)"/);
    // The files that held the hand-kept panel lists name none of eye makeup's panels now (app.ts uses the same words as icons).
    if (name !== "app.ts") for (const id of EYE_MAKEUP_GRANDFATHERED_PANELS) expect(code, `${name} names ${id}`).not.toMatch(new RegExp(`["']${id}["']`));
  }
});
