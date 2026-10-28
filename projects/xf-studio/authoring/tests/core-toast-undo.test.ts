import { expect, test } from "bun:test";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { StudioRuntime, type Port } from "../src/studio-ui/runtime";
import type { Feedback } from "../src/studio-ui/feedback";

test("toast Undo survives a real A to B scene switch while another panel keeps A live", async () => {
  const w = await profileContextStudio();
  try {
    const origin = w.bind("presets--scene0").context, keeper = w.bind("presets--shared").context;
    const a = keeper.current().feature("eye-makeup"), before = structuredClone(a.view().recipe());
    const b = w.bind("presets--scene1").context.current().feature("eye-makeup");
    const bBefore = structuredClone(b.view().recipe());
    const warnings: unknown[] = [];
    const rt = new StudioRuntime(origin.current() as unknown as Port,
      { toast: (...args: unknown[]) => warnings.push(args), record() {} } as unknown as Feedback);
    expect(rt.port.feature("eye-makeup").dispatch({ kind: "layer.edit", command: { kind: "remove", id: before.layers[0]!.id } }).ok).toBe(true);
    const undo = rt.undoAction();
    expect(a.view().recipe().layers).toHaveLength(before.layers.length - 1);
    expect(origin.current().authoring.dispatch({ kind: "scene.setLook", look: w.looks[1]! }).ok).toBe(true);
    expect(origin.current().feature("eye-makeup").view().recipe()).toEqual(bBefore);
    undo.run();
    expect(warnings).toEqual([]);
    expect(a.view().recipe()).toEqual(before);
    expect(b.view().recipe()).toEqual(bBefore);
  } finally { await w.dispose(); }
});

for (const change of ["access", "locked", "edit", "replacement", "release"] as const)
  test(`captured look Undo after A to B still refuses ${change} without changing either look`, async () => {
    const w = await profileContextStudio(), life = new AbortController();
    let blocked = false;
    w.core.app.attach({ access: { refusal: () => blocked ? { available: false, code: "unavailable", reason: "Read-only workspace." } : undefined } });
    try {
      const origin = w.bind("presets--scene0").context;
      const owner = w.authoring.contexts.acquire(w.looks[0]!, life.signal)!.context;
      const eye = origin.current().feature("eye-makeup"), id = eye.view().recipe().layers[0]!.id;
      expect(eye.dispatch({ kind: "layer.edit", command: { kind: "remove", id } }).ok).toBe(true);
      const undo = origin.current().authoring.captureUndo();
      expect(origin.current().authoring.dispatch({ kind: "scene.setLook", look: w.looks[1]! }).ok).toBe(true);
      if (change === "access") blocked = true;
      if (change === "locked") owner.lookDocument.setBlocked("Look locked.");
      if (change === "edit") {
        const next = owner.document.recipe.layers[0]!.id;
        expect(owner.app.dispatch({ kind: "layer.setOpacity", layerId: next, opacity: 0.31, look: w.looks[0]! }).ok).toBe(true);
      }
      if (change === "replacement") owner.lookDocument.restore(owner.lookDocument.export());
      if (change === "release") await w.dispose();
      const before = change === "release" ? undefined : owner.lookDocument.export();
      const b = change === "release" ? undefined : origin.current().authoring.snapshot();
      expect(undo()).toMatchObject({ ok: false, code: change === "access" ? "unavailable" : change === "locked" ? "not_ready" : "missing_target" });
      if (change !== "release") {
        expect(owner.lookDocument.export()).toEqual(before!);
        expect(origin.current().authoring.snapshot()).toEqual(b!);
      }
    } finally { life.abort(); await w.dispose(); }
  });
