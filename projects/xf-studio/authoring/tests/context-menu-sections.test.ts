import { expect, test } from "bun:test";
import type { StudioContextHit } from "../src/studio-context-targets";
import type { ViewportHit, ViewportHostKind } from "../src/viewport-attachment";
import type { Feedback } from "../src/studio-ui/feedback";
import { menuFromSections, menuSections, type MenuItem } from "../src/studio-ui/menu";
import { StudioRuntime, type Port } from "../src/studio-ui/runtime";
import { collectionSections, layerSections, presetSections, viewportSections } from "../src/studio-ui/target-menus";
import { trustedFixture } from "./studio-presentation-fixture";

/**
 * Context menus are actionable, not informational (AGENTS.md UX policy): every section of every
 * context menu holds at least one action or submenu (disabled entries count; they state why).
 */
const actionable = (items: MenuItem[]) => items.some(item => item.kind === "action" || item.kind === "submenu");
const anchor = { x: 0, y: 0 };

function fixture() {
  let current: ViewportHit | undefined;
  const { shell } = trustedFixture({ hitAt: () => current });
  const rt = new StudioRuntime(shell as unknown as Port, {} as Feedback);
  const recipe = () => rt.port.editor.recipe(), selected = () => recipe().layers[rt.port.editor.active()];
  // A Bézier selected layer (tangents exist) and another visible layer for non-selected makeup hits.
  expect(rt.port.authoring.dispatch({ kind: "path.edit", layerId: selected().id, command: { kind: "enable-bezier" } }).ok).toBe(true);
  const layer = selected(), other = recipe().layers.find(item => item.id !== layer.id)!;
  expect(layer.fields.length).toBeGreaterThan(0);
  // One entry per hit kind: the Record makes a new kind fail to compile until it is covered here.
  const hits: Record<StudioContextHit["kind"], ViewportHit[]> = {
    "uv-empty": [{ hit: { kind: "uv-empty" }, affordance: "empty" }],
    head: [{ hit: { kind: "head" }, affordance: "empty" }],
    shape: [{ hit: { kind: "shape", layerId: layer.id }, affordance: "shape" },
      { hit: { kind: "shape", layerId: other.id }, mirror: true, affordance: "shape" }],
    point: [{ hit: { kind: "point", layerId: layer.id, index: 0 }, affordance: "point" }],
    tangent: [{ hit: { kind: "tangent", layerId: layer.id, index: 0, side: "outgoing" }, affordance: "tangent" }],
    field: [{ hit: { kind: "field", layerId: layer.id, id: layer.fields[0].id }, affordance: "warp-origin" },
      { hit: { kind: "field", layerId: layer.id, id: layer.fields[0].id }, affordance: "warp-vector" }],
    // Row targets are not viewport hits; their menus are checked below.
    layer: [], preset: [], collection: [],
  };
  const menu = (kind: ViewportHostKind, hit: ViewportHit | undefined, pointer = true) => {
    current = hit;
    return menuSections(menuFromSections(viewportSections(rt, kind, anchor, pointer ? { x: 1, y: 1 } : undefined)));
  };
  return { rt, hits, menu, layer };
}

test("every context-menu section for every target kind holds an action; no informational-only sections", () => {
  const { rt, hits, menu } = fixture();
  const view = { head: "Head view", uv: "UV view" } as const;
  for (const kind of ["head", "uv"] as const) {
    const cases = [...Object.values(hits).flat(), undefined];
    for (const hit of cases) {
      const sections = menu(kind, hit);
      for (const section of sections) expect({ hit, kind, section: section.label, actionable: actionable(section.items) })
        .toEqual({ hit, kind, section: section.label, actionable: true });
      // Target actions first, view actions last.
      expect(sections.at(-1)?.label).toBe(view[kind]);
      const labels = sections.flatMap(section => [section.label, ...section.items.map(item => "label" in item ? item.label : "")]);
      expect(labels.join("|")).not.toMatch(/Background|No editable|not edits|Outside the editor|No shape here|Target changed/);
    }
    // Bare skin, empty UV space and background offer only the view.
    for (const hit of [...hits.head, ...hits["uv-empty"], undefined]) expect(menu(kind, hit).map(section => section.label)).toEqual([view[kind]]);
    // A makeup target leads, labelled by what is under the cursor and whose makeup it is.
    const [first] = menu(kind, hits.shape[1]);
    expect(first.label).toBe("Shape");
    expect(first.items.some(item => item.kind === "action" && item.label === "Select this layer")).toBe(true);
    expect(menu(kind, hits.point[0])[0].label).toBe("Contour point");
    // Keyboard invocation targets the selected point, then the view.
    expect(menu(kind, undefined, false).map(section => section.label)).toEqual(["Selected point 1", view[kind]]);
  }
  const port = rt.port;
  for (const layer of port.editor.recipe().layers)
    for (const section of menuSections(menuFromSections(layerSections(rt, layer.id, anchor)))) expect(actionable(section.items)).toBe(true);
  for (const preset of port.library.summary().draft?.presets ?? [])
    for (const section of menuSections(menuFromSections(presetSections(rt, preset.id, anchor)))) expect(actionable(section.items)).toBe(true);
  for (const section of menuSections(menuFromSections(collectionSections(rt, anchor)))) expect(actionable(section.items)).toBe(true);
});

test("menu sections without an action are dropped and separated only between kept sections", () => {
  const act = (label: string): MenuItem => ({ kind: "action", label, run: () => {} });
  const items = menuFromSections([{ label: "Info only", items: [] }, { label: "A", items: [act("a")] },
    { label: "Heading only", items: [{ kind: "heading", label: "note" }] }, { items: [act("b")] }]);
  expect(items.map(item => item.kind === "separator" ? "---" : item.label)).toEqual(["A", "a", "---", "b"]);
  expect(menuSections([{ kind: "heading", label: "Empty" }, { kind: "heading", label: "Full" }, act("x")]).map(section => section.items.length)).toEqual([0, 1]);
});
