/** Baseline captured from bb99992b code; the review correction also captures explicit regular paths and invoked popovers there. */
import { expect, test } from "bun:test";
import { trustedFixture } from "./studio-presentation-fixture";
import { StudioRuntime, type Port } from "../src/studio-ui/runtime";
import type { Feedback } from "../src/studio-ui/feedback";
import { contextItems, collectionSections, presetSections, viewportSections } from "../src/studio-ui/target-menus";
import { closePopovers, menuFromSections, type MenuItem } from "../src/studio-ui/menu";
import { initialRecipe } from "./fixtures/eye-region";
import { installLightDom, uninstallLightDom, LightElement, LightNode, lightEvent } from "./light-dom";
import type { ViewportHit } from "../src/app/viewport-attachment";
import { cursorFor, viewportHints, targetTip, ALL_TARGETS, MODIFIER_KEYS, type ViewportInputContext } from "../src/app/input-bindings";
import { hintStripMarkup, targetTipMarkup } from "../src/studio-ui/input-hints";

const anchor = { x: 0, y: 0 };
const visible = (items: MenuItem[]): unknown => JSON.parse(JSON.stringify(items, (key, value) =>
  key === "run" ? undefined : key === "items" && typeof value === "function" ? visible(value()) : value));
function regularRecipe() {
  const recipe = initialRecipe();
  for (const layer of recipe.layers) {
    layer.pathMode = "catmull-rom";
    for (const point of layer.points) delete point.handles;
  }
  return recipe;
}

test("makeup menu output has identical items, labels, order, sections, icons, checked and disabled states", () => {
  let current: ViewportHit | undefined;
  const { shell } = trustedFixture({ hitAt: () => current, recipe: regularRecipe() });
  const rt = new StudioRuntime(shell as unknown as Port, {} as Feedback);
  const eye = shell.feature("eye-makeup"), first = eye.view().layer()!;
  const result: unknown[] = [];
  for (const bezier of [false, true]) {
    if (bezier) expect(eye.dispatch({ kind: "path.edit", layerId: first.id, command: { kind: "enable-bezier" } }).ok).toBe(true);
    const layer = eye.view().layer()!;
    expect(layer.pathMode).toBe(bezier ? "bezier" : "catmull-rom");
    const shape = shell.authoring.contextQuery({ kind: "shape", layerId: layer.id });
    expect(shape.options.some(option => option.id === "shape.enableBezier")).toBe(!bezier);
    expect(contextItems(rt, shape, anchor).some(item => "label" in item && item.label === "Enable Bézier handles")).toBe(!bezier);
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

test("makeup alternate checked modes, boundary softness and invoked input popovers match the pre-slice-7 output", () => {
  installLightDom();
  const globals = globalThis as unknown as Record<string, unknown>, previousWindow = globals.window, previousRaf = globals.requestAnimationFrame;
  globals.window = { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  globals.requestAnimationFrame = () => 0;
  const output: unknown[] = [], warnings: unknown[] = [];
  const tree = (node: LightNode): unknown => node instanceof LightElement ? {
    tag: node.tagName,
    attributes: Object.fromEntries([...node.attributes].map(([key, value]) => [key, /^(id|for)$/.test(key) ? "generated-input" : value])),
    ...(node.tagName === "input" ? { value: node.value, disabled: node.disabled } : {}),
    ...(node.tagName === "button" ? { disabled: node.disabled } : {}),
    children: node.childNodes.length ? node.childNodes.map(tree) : node.textContent,
  } : node.textContent;
  try {
    const { shell } = trustedFixture({ recipe: regularRecipe() });
    const rt = new StudioRuntime(shell as unknown as Port, { toast: (...args: unknown[]) => warnings.push(args) } as unknown as Feedback);
    const eye = shell.feature("eye-makeup"), id = eye.view().layer()!.id;
    for (const mode of ["regular", "aligned", "symmetric", "corner"] as const) {
      if (mode !== "regular") {
        expect(eye.dispatch({ kind: "path.edit", layerId: id, command: { kind: "enable-bezier" } }).ok).toBe(true);
        expect(eye.dispatch({ kind: "path.edit", layerId: id, command: { kind: "point-mode", index: 0, mode } }).ok).toBe(true);
      }
      expect(eye.view().layer()!.pathMode).toBe(mode === "regular" ? "catmull-rom" : "bezier");
      for (const boundary of [false, true]) {
        expect(eye.dispatch({ kind: "softness.edit", layerId: id, command: { kind: "variable-softness", enabled: boundary } }).ok).toBe(true);
        const query = shell.authoring.contextQuery({ kind: "point", layerId: id, index: 0 });
        expect(query.options.find(option => option.id === "point.softness")!.capability.available).toBe(boundary);
        for (const checked of ["aligned", "symmetric", "corner"]) {
          const item = contextItems(rt, query, anchor)[query.options.findIndex(option => option.id === `point.mode.${checked}`)];
          expect(item?.kind === "action" ? item.checked : undefined).toBe(mode === "regular" ? undefined : mode === checked);
        }
        output.push({ mode, boundary, menu: visible(contextItems(rt, query, anchor)) });
        for (const option of query.options.filter(option => option.requiresInput)) {
          const items = contextItems(rt, query, anchor), item = items[query.options.indexOf(option)];
          if (item.kind !== "action") throw Error("Expected input action");
          item.run();
          const form = document.body.querySelector(".popover");
          output.push({ mode, boundary, input: option.id, initial: form ? tree(form as unknown as LightNode) : undefined, warnings: [...warnings] });
          warnings.length = 0;
          if (form) {
            const input = form.querySelector("input")!;
            input.value = "-999";
            (input as unknown as LightElement).dispatchEvent(lightEvent("input"));
            output.push({ input: option.id, invalid: tree(form as unknown as LightNode) });
          }
          closePopovers();
        }
      }
    }
    const layer = eye.view().layer()!;
    for (const enabled of [false, true]) {
      expect(eye.dispatch({ kind: "layer.setEnabled", id, enabled })).toMatchObject({ ok: true });
      output.push({ enabled, menu: visible(contextItems(rt, shell.authoring.contextQuery({ kind: "layer", id }), anchor)) });
    }
    for (const command of ["single", "both"] as const) {
      shell.viewport.uvCommand(command);
      output.push({ uv: command, menu: visible(menuFromSections(viewportSections(rt, "uv", anchor))) });
    }
    const hits = [{ kind: "layer", id }, { kind: "field", layerId: id, id: layer.fields[0].id },
      { kind: "preset", id: shell.library.summary().draft!.selected! }, { kind: "collection" }] as const;
    for (const hit of hits) {
      const query = shell.authoring.contextQuery(hit);
      for (const option of query.options.filter(option => option.requiresInput)) {
        const item = contextItems(rt, query, anchor)[query.options.indexOf(option)];
        if (item.kind !== "action") throw Error("Expected input action");
        item.run();
        const form = document.body.querySelector(".popover");
        expect(form).not.toBeNull();
        output.push({ input: option.id, initial: tree(form as unknown as LightNode) });
        const input = form!.querySelector("input")!;
        input.value = input.type === "text" ? "" : "-999";
        (input as unknown as LightElement).dispatchEvent(lightEvent("input"));
        output.push({ input: option.id, invalid: tree(form as unknown as LightNode) });
        closePopovers();
      }
    }
    expect(output).toMatchSnapshot("bb99992b alternate menus and invoked popovers");
  } finally {
    closePopovers(); globals.window = previousWindow; globals.requestAnimationFrame = previousRaf; uninstallLightDom();
  }
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
