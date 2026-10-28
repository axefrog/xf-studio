/** Captured on bb99992b before the slice-7 production changes. Do not update for this refactor. */
import { expect, test } from "bun:test";
import { trustedFixture } from "./studio-presentation-fixture";
import { StudioRuntime, type Port } from "../src/studio-ui/runtime";
import type { Feedback } from "../src/studio-ui/feedback";
import { contextItems, collectionSections, presetSections, viewportSections } from "../src/studio-ui/target-menus";
import { menuFromSections, type MenuItem } from "../src/studio-ui/menu";
import type { ViewportHit } from "../src/app/viewport-attachment";
import { cursorFor, viewportHints, targetTip, ALL_TARGETS, MODIFIER_KEYS, type ViewportInputContext } from "../src/app/input-bindings";
import { hintStripMarkup, targetTipMarkup } from "../src/studio-ui/input-hints";

const anchor = { x: 0, y: 0 };
const visible = (items: MenuItem[]): unknown => JSON.parse(JSON.stringify(items, (key, value) =>
  key === "run" ? undefined : key === "items" && typeof value === "function" ? visible(value()) : value));

test("makeup menu output has identical items, labels, order, sections, icons, checked and disabled states", () => {
  let current: ViewportHit | undefined;
  const { shell } = trustedFixture({ hitAt: () => current });
  const rt = new StudioRuntime(shell as unknown as Port, {} as Feedback);
  const eye = shell.feature("eye-makeup"), first = eye.view().layer()!;
  const result: unknown[] = [];
  for (const bezier of [false, true]) {
    if (bezier) expect(eye.dispatch({ kind: "path.edit", layerId: first.id, command: { kind: "enable-bezier" } }).ok).toBe(true);
    const layer = eye.view().layer()!;
    const hits: (ViewportHit | undefined)[] = [undefined,
      { hit: { kind: "uv-empty" }, affordance: "empty" }, { hit: { kind: "head" }, affordance: "empty" },
      { hit: { kind: "shape", layerId: layer.id }, affordance: "shape", mirror: true },
      { hit: { kind: "point", layerId: layer.id, index: 0 }, affordance: "point" },
      { hit: { kind: "point", layerId: layer.id, index: 999 }, affordance: "point" },
      { hit: { kind: "tangent", layerId: layer.id, index: 0, side: "incoming" }, affordance: "tangent" },
      { hit: { kind: "field", layerId: layer.id, id: layer.fields[0].id }, affordance: "warp-origin" },
      { hit: { kind: "field", layerId: layer.id, id: "missing" }, affordance: "warp-vector" }];
    for (const kind of ["head", "uv"] as const) {
      for (const hit of hits) {
        current = hit;
        result.push(visible(menuFromSections(viewportSections(rt, kind, anchor, { x: 1, y: 1 }))));
      }
      result.push(visible(menuFromSections(viewportSections(rt, kind, anchor))));
    }
    for (const item of eye.view().recipe().layers) result.push(visible(contextItems(rt, shell.authoring.contextQuery({ kind: "layer", id: item.id }), anchor)));
    result.push(visible(contextItems(rt, shell.authoring.contextQuery({ kind: "layer", id: "missing" }), anchor)));
  }
  result.push(visible(menuFromSections(collectionSections(rt, anchor))));
  for (const preset of shell.library.summary().draft?.presets ?? []) result.push(visible(menuFromSections(presetSections(rt, preset.id, anchor))));
  expect(result).toMatchSnapshot("bb99992b makeup menus");
});

test("makeup hints, tooltip text, cursor and rendered markup remain identical", () => {
  const cases: ViewportInputContext[] = [];
  for (const scope of ["head", "uv"] as const) {
    for (const target of [undefined, ...ALL_TARGETS]) for (const mods of MODIFIER_KEYS)
      cases.push({ scope, target, modifiers: { ctrl: mods.includes("ctrl"), alt: mods.includes("alt"), shift: mods.includes("shift") } });
    for (const gesture of ["handle", "translate", "rotate", "scale", "pan"] as const)
      cases.push({ scope, target: "point", gesture, modifiers: { ctrl: false, alt: false, shift: false } });
    for (const blocked of ["no-layer", "layer-hidden", "surface-off", "look-locked"] as const)
      cases.push({ scope, target: "point", blocked, modifiers: { ctrl: false, alt: false, shift: false } });
    cases.push({ scope, target: "shape", editing: false, modifiers: { ctrl: false, alt: false, shift: true } });
  }
  expect(cases.map(context => {
    const hints = viewportHints(context), tip = targetTip(context);
    return { context, hints, tip, cursor: cursorFor(context), strip: hintStripMarkup(hints), tooltip: tip ? targetTipMarkup(tip) : undefined };
  })).toMatchSnapshot("bb99992b makeup hints");
});
