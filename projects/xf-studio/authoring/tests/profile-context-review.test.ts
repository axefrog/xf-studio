import { expect, test } from "bun:test";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import type { StudioPickedFile } from "../src/app/studio-file-operations";
import { DiagnosticsActions, type DiagnosticsDevice } from "../src/diagnostics/actions";
import { shapeOfLayer } from "../src/engines/layered-makeup/starter-shape";
import type { ViewRecord } from "../src/platform/api/view-graph";
import type { Layer } from "../src/engines/layered-makeup/recipe";
import type { GenericFeatureFacade } from "../src/app/studio-presentation";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { initialRecipe } from "./fixtures/eye-region";
import { CollectionServiceError } from "../src/library/collection-service";
import type { PackageBuildProgress } from "../src/platform/api";
import { eyeCheck } from "./fixtures/package-results";

async function until(ready: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!ready() && Date.now() < deadline) await Bun.sleep(1);
  expect(ready()).toBe(true);
}
const picked = (value: unknown): StudioPickedFile => {
  const text = JSON.stringify(value);
  return { name: "captured.json", size: text.length, text: async () => text, bytes: async () => new TextEncoder().encode(text) };
};

test("review High / rule A: a root collection picker holds A's writer through a drawn switch to B", async () => {
  let answer!: (file: StudioPickedFile) => void;
  const w = await profileContextStudio({ pick: () => new Promise(done => { answer = done; }) });
  try {
    const progress: string[] = [], off = w.port.subscribe(() => {
      const line = w.port.files.snapshot().progress; if (line) progress.push(`${line.phase}:${line.code}`);
    });
    const scenes = w.session.session().views.scenes, other = structuredClone(w.session.scene(scenes[1]!.id));
    const file = picked({ schema: "xfs/collection-2", id: crypto.randomUUID(), name: "Imported into A", presets: [
      { id: crypto.randomUUID(), name: "Captured", revision: 1, parts: w.services.collections.look(w.looks[0]!)!.parts }] });
    const pending = w.port.files.execute({ kind: "collection.import" });
    expect(w.port.files.activity()).toMatchObject([{ kind: "collection.import", cancellable: false }]);
    w.draw((w.session.session().views.views as readonly ViewRecord[])[1]!.id);
    expect(w.authoring.contexts.held().some(entry => entry.ref.look === w.looks[0]!.look && entry.wants > 0)).toBe(true);
    answer(file);
    expect(await pending).toMatchObject({ ok: true, code: "imported" });
    expect(progress).toContain("working:import"); expect(progress).toContain("success:imported"); off();
    expect(w.port.files.snapshot()).toMatchObject({ collectionBusy: false, activity: [], progress: { code: "imported", phase: "success" } });
    expect(w.session.scene(scenes[0]!.id).look!.collection).not.toBe(w.looks[0]!.collection);
    expect(w.services.collections.collection(w.session.scene(scenes[0]!.id).look!.collection)!.name).toBe("Imported into A");
    expect(w.session.scene(scenes[1]!.id)).toEqual(other);
    expect(w.authoring.drawn.ref()).toEqual(w.looks[1]); expect(w.targets.held()).toBe(0);
  } finally { await w.dispose(); }
});

for (const target of ["root", "pinned"] as const) for (const entry of ["files", "library", "authoring"] as const) {
  test(`rule A / PIPE-131: ${target} Build keeps observable progress and Stop on its captured service (${entry})`, async () => {
    const w = await profileContextStudio();
    let acknowledge: (() => void) | undefined, off = () => {};
    try {
      await w.settle();
      const port = target === "root" ? w.port : w.bind("presets--scene2").context.current();
      const ref = w.looks[target === "root" ? 0 : 2]!, before = JSON.stringify(w.services.collections.list());
      let signal: AbortSignal | undefined, input: unknown;
      let stage: PackageBuildProgress = { stage: "convert", step: 3, steps: 5, looks: 2 };
      w.collectionTransport.packageProgress = async () => stage;
      w.collectionTransport.package = (_action, value, abort) => new Promise((_resolve, reject) => {
        input = value; signal = abort;
        acknowledge = () => reject(new CollectionServiceError("package_build_cancelled", "Build stopped. Your mod files weren't changed."));
      });
      const lines: string[] = [];
      off = port.subscribe(() => { const line = port.files.snapshot().progress; if (line) lines.push(line.message); });
      const pending = entry === "files" ? port.files.execute({ kind: "package.build" }) : port[entry].execute({ kind: "package", action: "build" });
      await until(() => !!signal && port.files.snapshot().progress?.fraction === .5);
      expect(input).toMatchObject({ id: ref.collection, presets: expect.arrayContaining([expect.objectContaining({ id: ref.look })]) });
      expect(port.files.snapshot()).toMatchObject({ collectionBusy: true, progress: {
        phase: "working", message: "Step 3 of 5: Converting 2 looks…", fraction: .5 } });
      const activity = port.files.activity();
      expect(activity).toHaveLength(1); expect(activity[0]).toMatchObject({ kind: "package.build", cancellable: true, requestId: expect.any(Number) });
      const other = (w.session.session().views.views as readonly ViewRecord[])[1]!;
      w.history.focus.focusView(other.id); w.draw(other.id);
      stage = { stage: "verify", step: 5, steps: 5, looks: 2 };
      await until(() => port.files.snapshot().progress?.fraction === .9);
      expect(lines).toContain("Step 5 of 5: Checking the mod files…");
      expect(port.files.activity()[0]!.id).toBe(activity[0]!.id);
      expect(port.files.capability({ kind: "package.stop" }).available).toBe(true);
      expect(await port.files.execute({ kind: "package.stop" })).toMatchObject({ ok: true, code: "stopping" });
      expect(signal!.aborted).toBe(true);
      expect(port.files.snapshot()).toMatchObject({ collectionBusy: true, progress: { phase: "working", message: "Stopping…" },
        activity: [{ kind: "package.build", cancellable: false }] });
      expect(port.files.capability({ kind: "package.stop" }).available).toBe(false);
      expect(port.files.capability({ kind: "package.build" }).available).toBe(false);
      acknowledge!();
      expect(await pending).toMatchObject({ ok: false, code: "package_build_cancelled" });
      expect(port.files.snapshot()).toMatchObject({ collectionBusy: false, activity: [],
        last: { kind: "package.build", code: "package_build_cancelled" }, progress: { phase: "error", code: "package_build_cancelled" } });
      expect(port.files.snapshot().package).toBeUndefined();
      expect(w.targets.held()).toBe(0); expect(JSON.stringify(w.services.collections.list())).toBe(before);
      expect(w.authoring.drawn.ref()).toEqual(w.looks[1]);
    } finally { acknowledge?.(); off(); await w.dispose(); }
  });
}

for (const target of ["root", "pinned"] as const) for (const entry of ["files", "library"] as const) {
  test(`rule A: ${target} Check exposes its captured request without advertising cancellation (${entry})`, async () => {
    const w = await profileContextStudio(); let finish: (() => void) | undefined;
    try {
      await w.settle();
      const port = target === "root" ? w.port : w.bind("presets--scene2").context.current();
      w.collectionTransport.package = async (_action, input, signal) => {
        expect(signal).toBeUndefined(); await new Promise<void>(done => { finish = done; });
        return eyeCheck(input as { id: string }, { presets: [] });
      };
      const pending = entry === "files" ? port.files.execute({ kind: "package.check" }) : port.library.execute({ kind: "package", action: "check" });
      await until(() => !!finish);
      const other = (w.session.session().views.views as readonly ViewRecord[])[1]!;
      w.history.focus.focusView(other.id); w.draw(other.id);
      expect(port.files.snapshot()).toMatchObject({ collectionBusy: true, progress: { phase: "working", code: "package" },
        activity: [{ kind: "package.check", cancellable: false, requestId: expect.any(Number) }] });
      expect(port.files.cancel(port.files.activity()[0]!.id).accepted).toBe(false);
      expect(port.files.capability({ kind: "package.stop" }).available).toBe(false);
      finish!(); expect(await pending).toMatchObject({ ok: true });
      expect(port.files.snapshot()).toMatchObject({ collectionBusy: false, activity: [], progress: { phase: "success", code: "packageCheck" } });
      expect(w.targets.held()).toBe(0);
    } finally { finish?.(); await w.dispose(); }
  });
}

for (const entry of ["library", "authoring"] as const) test(`review Medium 3 / rule A: accepted follow-focus saveCopy retains its writer (${entry} entry)`, async () => {
  const w = await profileContextStudio();
  try {
    await w.settle();
    const panel = w.bind("presets--follow"), old = panel.context.current(), source = old.library.summary().draft!.id;
    const list = w.collectionTransport.list;
    let release: (() => void) | undefined;
    w.collectionTransport.list = async () => { await new Promise<void>(done => { release = done; }); return list(); };
    const pending = old[entry].execute({ kind: "saveCopy" }); await until(() => !!release);
    const view = (w.session.session().views.views as readonly ViewRecord[])[2]!, other = structuredClone(w.session.scene(view.scene));
    w.history.focus.focusView(view.id); w.draw(view.id);
    expect(w.targets.held()).toBe(1);
    w.collectionTransport.list = list; release!();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, result: { kind: "saved" } });
    const made = w.session.scene(w.scene).look!.collection;
    expect(made).not.toBe(source); expect(w.library.collections.get(made).collection.name).toBe("Collection 2");
    expect(w.library.collections.get(made).collection.presets.map(look => look.name)).toEqual(["Look 0-0", "Look 0-1"]);
    expect(w.session.scene(view.scene)).toEqual(other); expect(w.targets.held()).toBe(0);
  } finally { await w.dispose(); }
});

test("rule D audit: every registered action declaring a look runs through an unseen bound input and leaves other looks unchanged", async () => {
  type Action = { kind: string; [key: string]: unknown };
  const layer = "layer-1", field = "layer-1-field-1", put = (kind: string, payload: Record<string, unknown> = {}): Action => ({ kind, layerId: layer, ...payload });
  const glitter = [put("layer.setFinish", { finish: "glitter" })], face = [put("expression.setControl", { name: "jaw_mid_open", value: 0.4 })];
  const cases: Record<string, { action: Action; setup?: Action[] }> = {
    "layer.select": { action: put("layer.select", { layerId: "layer-2" }) },
    "point.select": { action: put("point.select", { index: 2 }) },
    "point.remove": { action: put("point.remove", { index: 2 }) },
    "path.edit": { action: put("path.edit", { command: { kind: "point-mode", index: 0, mode: "corner" } }) },
    "field.select": { action: put("field.select", { fieldId: field }) },
    "field.add": { action: put("field.add") },
    "field.remove": { action: put("field.remove", { fieldId: field }) },
    "field.clear": { setup: [put("field.setVector", { fieldId: field, du: 0.01, dv: 0 })], action: put("field.clear", { fieldId: field }) },
    "field.setReach": { action: put("field.setReach", { fieldId: field, radius: 0.1 }) },
    "pigment.edit": { action: put("pigment.edit", { command: { kind: "point-strength", index: 0, value: 0.5 } }) },
    "softness.edit": { action: put("softness.edit", { command: { kind: "uniform-softness", value: 0.02 } }) },
    "layer.setColor": { action: put("layer.setColor", { color: "#123456" }) },
    "layer.setOpacity": { action: put("layer.setOpacity", { opacity: 0.37 }) },
    "layer.setSymmetry": { action: put("layer.setSymmetry", { symmetry: false }) },
    "layer.setFinish": { action: put("layer.setFinish", { finish: "metallic" }) },
    "layer.useGameOptics": { action: put("layer.useGameOptics") },
    "layer.setShift": { setup: [put("layer.setFinish", { finish: "iridescent" })], action: put("layer.setShift", { key: "strength", value: 0.3 }) },
    "glitter.selectModel": { setup: glitter, action: put("glitter.selectModel", { model: "classic" }) },
    "glitter.setClassic": { setup: [...glitter, put("glitter.selectModel", { model: "classic" })], action: put("glitter.setClassic", { key: "density", value: 0.33 }) },
    "glitter.setIrregular": { setup: [...glitter, put("glitter.selectModel", { model: "irregular" })], action: put("glitter.setIrregular", { key: "spread", value: 0.33 }) },
    "glitter.setDirect": { setup: [...glitter, put("glitter.selectModel", { model: "direct" })], action: put("glitter.setDirect", { key: "strength", value: 0.33 }) },
    "point.move": { action: put("point.move", { index: 0, u: 0.31, v: 0.24 }) },
    "point.insert": { action: put("point.insert", { u: 0.31, v: 0.24 }) },
    "point.setTangent": { action: put("point.setTangent", { index: 0, side: "out", du: 0.005, dv: 0.002 }) },
    "shape.transform": { action: put("shape.transform", { command: { kind: "translate", du: 0.002, dv: 0.002 } }) },
    "field.setOrigin": { action: put("field.setOrigin", { fieldId: field, u: 0.35, v: 0.23 }) },
    "field.setVector": { action: put("field.setVector", { fieldId: field, du: 0.01, dv: 0.01 }) },
    "layer.edit": { action: put("layer.edit", { command: { kind: "rename", id: layer, name: "Unseen layer" } }) },
    "layer.setEnabled": { action: put("layer.setEnabled", { id: layer, enabled: false }) },
    "effect.mottle.enable": { action: put("effect.mottle.enable", { enabled: true }) },
    "effect.mottle.set": { setup: [put("effect.mottle.enable", { enabled: true })], action: put("effect.mottle.set", { key: "amount", value: 0.33 }) },
    "effect.mottle.shuffle": { setup: [put("effect.mottle.enable", { enabled: true })], action: put("effect.mottle.shuffle") },
    "effect.mottle.preset": { action: put("effect.mottle.preset", { preset: "mascara" }) },
    "scene.setLook": { action: put("scene.setLook") },
    "starters.save": { action: put("starters.save", { name: "Unseen audit" }) },
    "expression.setControl": { action: put("expression.setControl", { name: "jaw_mid_open", value: 0.3 }) },
    "expression.setAxis": { action: put("expression.setAxis", { negative: "eye_l_dir_out", positive: "eye_l_dir_in", value: -0.3 }) },
    "expression.linkPair": { action: put("expression.linkPair", { pair: "lips_corner_up", linked: false }) },
    "expression.setLinks": { action: put("expression.setLinks", { links: { lips_corner_up: false } }) },
    "expression.mirror": { setup: [put("expression.setLinks", { links: { lips_corner_up: false } }), put("expression.setControl", { name: "lips_l_corner_up", value: 0.3 })], action: put("expression.mirror", { from: "left" }) },
    "expression.reset": { setup: face, action: put("expression.reset", { scope: "all" }) },
    "expression.startFrom": { action: put("expression.startFrom", { origin: { kind: "rest" }, controls: { jaw_mid_open: 0.3 } }) },
    "expression.setLabel": { action: put("expression.setLabel", { label: "Unseen expression" }) },
    "expression.intensity": { setup: face, action: put("expression.intensity", { base: { jaw_mid_open: 0.4 }, amount: 0.3 }) },
  };
  const registered = Object.entries(STUDIO_REGISTRY.descriptors()).filter(([, spec]) => spec.payload.look).map(([kind]) => kind).sort();
  expect(Object.keys(cases).sort()).toEqual(registered);
  for (const kind of registered) {
    const w = await profileContextStudio({ starters: true, ...(kind === "layer.useGameOptics" ? { recipe: () => {
      const recipe = initialRecipe(); recipe.layers[0]!.finish = "glossy"; delete recipe.layers[0]!.optics; return recipe;
    } } : {}) });
    try {
      const port = w.bind("presets--scene2").context.current(), peer = w.bind("presets--scene1").context.current(), input = cases[kind]!;
      for (const setup of input.setup ?? []) expect([kind, "setup", port.authoring.dispatch(setup as never).ok]).toEqual([kind, "setup", true]);
      const before = JSON.stringify(port.authoring.snapshot().document), drawn = JSON.stringify(w.core.document.export()), other = JSON.stringify(peer.authoring.snapshot().document);
      const action = kind === "scene.setLook" ? { ...input.action, look: w.looks[1] } : input.action;
      expect([kind, port.authoring.capability(action as never).available]).toEqual([kind, true]);
      expect([kind, port.authoring.dispatch(action as never).ok]).toEqual([kind, true]);
      expect(JSON.stringify(w.core.document.export())).toBe(drawn); expect(JSON.stringify(peer.authoring.snapshot().document)).toBe(other);
      if (kind === "starters.save") expect(w.starters!.list().some(starter => starter.name === "Unseen audit")).toBe(true);
      else if (kind === "scene.setLook") expect(w.session.scene((w.session.session().views.views as readonly ViewRecord[])[2]!.scene).look).toEqual(w.looks[1]);
      else expect([kind, JSON.stringify(port.authoring.snapshot().document) !== before]).toEqual([kind, true]);
      expect(w.authoring.drawn.ref()).toEqual(w.looks[0]);
    } finally { await w.dispose(); }
  }
  console.log(`Unseen-context action audit: ${registered.length} registered look-declaring action IDs, all accepted.`);
}, 20000);

test("review Medium 2 / rule B: drawing another look and peer callbacks cannot end another requester's control or gesture", async () => {
  const w = await profileContextStudio();
  try {
    const pin = w.bind("presets--shared").context.current(), peer = w.bind("presets--scene0").context.current();
    const eye = pin.feature("eye-makeup");
    expect(eye.controlBegin("owned:opacity", "layer-1")).toBe(true);
    expect(eye.controlEdit("owned:opacity", { kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.37 }).ok).toBe(true);
    peer.feature("eye-makeup").controlCancel("owned:opacity");
    expect(peer.feature("eye-makeup").controlBegin("peer:opacity", "layer-1")).toBe(false);
    expect(peer.feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.6 })).toMatchObject({ ok: false, code: "busy" });
    w.draw((w.session.session().views.views as readonly ViewRecord[])[1]!.id);
    expect(pin.authoring.snapshot().control?.id).toBe("owned:opacity");
    eye.controlCancel("owned:opacity"); expect(eye.view().recipe().layers[0]!.opacity).toBe(0.85);
    expect(pin.authoring.history().depth).toBe(0);
    const before = JSON.stringify(pin.authoring.snapshot().document.recipe);
    expect(pin.authoring.beginGesture("uv", "layer-1")).toBe(true);
    expect(pin.authoring.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: 0.4 } })).toBe(true);
    peer.authoring.endGesture("uv", true);
    expect(JSON.stringify(pin.authoring.snapshot().document.recipe)).not.toBe(before);
    pin.authoring.endGesture("uv", true);
    expect(JSON.stringify(pin.authoring.snapshot().document.recipe)).toBe(before);
    const face = pin.feature("expressions") as GenericFeatureFacade, otherFace = peer.feature("expressions") as GenericFeatureFacade;
    const prior = JSON.stringify(face.view());
    expect(face.controlBegin("owned:face")).toBe(true);
    const action = { kind: "expression.setControl", name: "jaw_mid_open", value: 0.3 };
    expect(face.controlEdit("owned:face", action).ok).toBe(true);
    expect(otherFace.controlBegin("peer:face")).toBe(false); otherFace.controlCancel("owned:face");
    w.draw((w.session.session().views.views as readonly ViewRecord[])[0]!.id);
    expect(JSON.stringify(face.view())).not.toBe(prior);
    face.controlCancel("owned:face"); expect(JSON.stringify(face.view())).toBe(prior);
  } finally { await w.dispose(); }
});

test("review Medium 4 / rule C: direct-pin Select queries, menus, capabilities and dispatch use the same mapping", async () => {
  const w = await profileContextStudio();
  try {
    w.draw((w.session.session().views.views as readonly ViewRecord[])[2]!.id);
    const panel = w.bind("presets--shared").context.current(), target = { kind: "preset" as const, id: w.looks[1]!.look };
    const action = { kind: "scene.setLook" as const, look: w.looks[1]! }, query = panel.authoring.contextQuery(target);
    const select = query.options.find(option => option.id === "preset.select")!;
    expect(select.capability.available).toBe(true);
    expect(panel.authoring.contextOptionsFor(query.context).find(option => option.id === "preset.select")!.capability.available).toBe(true);
    expect(panel.authoring.actionsFor(target).find(info => info.action.kind === "panels.setBinding")!.capability.available).toBe(true);
    expect(panel.authoring.contextCapability(target, action).available).toBe(true);
    expect(panel.authoring.boundActionCapability(query.context, action).available).toBe(true);
    expect(panel.authoring.dispatchContext(query.context, action).ok).toBe(true);
    expect(w.session.panel("presets--shared")!.binding).toEqual({ policy: "pinned", target: { look: w.looks[1] } });
    expect(w.authoring.drawn.ref()).toEqual(w.looks[2]);
    expect(panel.authoring.dispatchContext(query.context, action)).toMatchObject({ ok: false, code: "missing_target" });
  } finally { await w.dispose(); }
});

test("review Medium 5 / rule D: starters.save resolves the bound unseen layer, with no drawn-look resolver", async () => {
  const w = await profileContextStudio({ starters: true });
  try {
    const pin = w.bind("presets--unseen").context.current(), before = JSON.stringify(w.core.document.export());
    expect(pin.authoring.dispatch({ kind: "point.move", layerId: "layer-1", index: 0, u: 0.4, v: 0.4 }).ok).toBe(true);
    expect(pin.authoring.dispatch({ kind: "starters.save", layerId: "layer-1", name: "Unseen shape" }).ok).toBe(true);
    expect(w.starters!.list().find(starter => starter.name === "Unseen shape")!.shape).toEqual(shapeOfLayer(structuredClone(pin.authoring.snapshot().document.recipe.layers[0]!) as Layer));
    expect(JSON.stringify(w.core.document.export())).toBe(before); expect(w.authoring.drawn.ref()).toEqual(w.looks[0]);
  } finally { await w.dispose(); }
});

test("review Low: diagnostics callbacks restore the surviving context when panels dispose out of order", async () => {
  const diagnostics = new DiagnosticsActions({ pageFacts: () => ({ browser: "fixture", gpu: null, webgl2: false }) } as DiagnosticsDevice);
  diagnostics.setViewState(() => ({ source: "before Studio" }));
  const register = diagnostics.setViewState.bind(diagnostics); let seq = 0;
  diagnostics.setViewState = read => { const id = ++seq; return register(() => ({ ...read(), source: String(id) })); };
  const w = await profileContextStudio({ diagnostics });
  try {
    const root = diagnostics.pageFacts().state.source;
    const a = w.bind("presets--shared"), b = w.bind("presets--unseen"), latest = diagnostics.pageFacts().state.source;
    expect(latest).not.toBe(root); a.life.abort(); expect(diagnostics.pageFacts().state.source).toBe(latest);
    b.life.abort(); expect(diagnostics.pageFacts().state.source).toBe(root);
    await w.dispose(); expect(diagnostics.pageFacts().state.source).toBe("before Studio");
  } finally { await w.dispose(); }
});
