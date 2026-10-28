import { createLayeredEditorAdapters } from "../src/preview/browser/layered-editor-adapters";
/** Frozen on 64101571 before slice 9: the bound UV wiring's visible state and editing outcomes. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, LightElement } from "./light-dom";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { createPanelUV } from "../src/preview/browser/panel-uv";
import type { createUVEditor } from "../src/legacy/eye-makeup/browser/uv-editor";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
const previous = globalThis.window;
beforeAll(() => { installLightDom(); Object.assign(globalThis, { window: new LightElement("window") }); });
afterAll(() => { uninstallLightDom(); Object.assign(globalThis, { window: previous }); });

test("bound UV state, navigation, selection, gesture commit/Escape and release match 64101571", async () => {
  type Hooks = Parameters<typeof createUVEditor>[2];
  const bound: { hooks: Hooks; attachment: ReturnType<typeof createPanelUV>; events: string[] }[] = [];
  const s = await profileContextStudio({ panelViewport: input => {
    const events: string[] = []; let hooks: Hooks;
    const factory = ((_canvas: Parameters<typeof createUVEditor>[0], controls: Parameters<typeof createUVEditor>[1], given: Hooks, initial: Parameters<typeof createUVEditor>[3]) => {
      hooks = given; let view = initial;
      expect(controls).toBeUndefined();
      return { snapshot: () => view, selection: () => ({ point: { visible: true } }), draw: () => events.push("draw"), resize: () => events.push("resize"),
        inputCapture: () => false, viewCommand(command: string) { events.push(command); view = { ...view, mode: command === "single" ? "single" : "both" }; given.persist(); return true; },
        navigate() { events.push("navigate"); given.persist(); return true; }, cancelInput: () => { events.push("cancel"); given.cancel(); },
        dispose: () => events.push("dispose"), hitAt: () => undefined };
    }) as unknown as typeof createUVEditor;
    const attachment = createPanelUV(input, { adapters: createLayeredEditorAdapters(STUDIO_COMPOSITION.region, { flat: factory }), canvases: () => [], albedo: () => undefined });
    bound.push({ hooks: hooks!, attachment, events }); return attachment;
  } });
  try {
    const ids = [0, 1].map(i => s.session.addPanel(s.session.tabId(), "uv", { binding: { policy: "pinned", target: { look: s.looks[i]! } } }));
    const handles = ids.map(id => s.bind(id));
    const [a, b] = bound;
    const read = () => bound.map(({ hooks, attachment }) => ({ uv: attachment.snapshot().uv, input: attachment.input().uv,
      selected: hooks.selected(), selectedField: hooks.selectedField(), point: hooks.layer()!.points[0], layerCount: hooks.recipe().layers.length }));
    const states: unknown[] = [read()];
    a!.attachment.uvCommand("single"); a!.hooks.select(1); states.push(read());
    a!.hooks.select(0); a!.hooks.begin();
    const point = a!.hooks.layer()!.points[0]!;
    expect(a!.hooks.apply({ kind: "point.replace", index: 0, next: { ...point, u: point.u + .001 } })).toBe(true);
    a!.hooks.finish!(); states.push(read());
    b!.hooks.begin(); const other = b!.hooks.layer()!.points[0]!;
    expect(b!.hooks.apply({ kind: "point.replace", index: 0, next: { ...other, v: other.v + .001 } })).toBe(true);
    b!.hooks.cancel(); states.push(read());
    a!.hooks.input!({ target: "tangent", gesture: "rotate", editable: true }); states.push(read());
    for (const handle of handles) handle.life.abort();
    expect({ states, events: bound.map(item => item.events) }).toMatchSnapshot();
  } finally { await s.dispose(); s.library.close(); }
});
