import { expect, test } from "bun:test";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { lookRef } from "../src/library/collection-documents";
import { lookScope } from "../src/platform/core/history-service";
import { recipeFile } from "../src/legacy/eye-makeup/recipe-schema";
import type { StudioPickedFile } from "../src/app/studio-file-operations";
import { eyeCheck, eyeBuild } from "./fixtures/package-results";
import type { GenericFeatureFacade } from "../src/app/studio-presentation";
import { characterRef } from "../src/platform/api/characters";

test("G1: three scoped real application facades across two collections isolate edits, selection, history and preset commands", async () => {
  const w = await profileContextStudio();
  try {
    const panels = [0, 1, 2].map(i => w.bind(`presets--scene${i}`).context);
    expect(new Set(w.looks.map(ref => ref.collection)).size).toBe(2);
    for (let i = 0; i < 3; i++) {
      const before = panels.map(panel => JSON.stringify(panel.current().authoring.snapshot().document));
      w.history.focus.focusView(w.session.session().views.views[(i + 1) % 3]!.id);
      const port = panels[i]!.current(), eye = port.feature("eye-makeup"), layer = eye.view().recipe().layers[0]!.id;
      expect(eye.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: 0.2 + i * 0.2 }).ok).toBe(true);
      expect(eye.dispatch({ kind: "point.select", layerId: layer, index: i + 1 }).ok).toBe(true);
      expect(port.library.dispatch({ kind: "preset.edit", command: { kind: "rename", id: w.looks[i]!.look, name: `Renamed ${i}` } }).ok).toBe(true);
      expect(port.authoring.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
      const added = panels[i]!.current().library.summary().draft!.selected!;
      expect(added).not.toBe(w.looks[i]!.look);
      expect(panels[i]!.current().library.dispatch({ kind: "preset.edit", command: { kind: "remove", id: added } }).ok).toBe(true);
      expect(panels[i]!.current().library.dispatch({ kind: "preset.edit", command: { kind: "restore" } }).ok).toBe(true);
      // Choose the original through the actual scene action, then Undo only its named look history.
      expect(panels[i]!.current().authoring.dispatch({ kind: "scene.setLook", look: w.looks[i]! }).ok).toBe(true);
      expect(panels[i]!.current().authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
      for (let j = 0; j < 3; j++) if (j !== i) expect(JSON.stringify(panels[j]!.current().authoring.snapshot().document)).toBe(before[j]);
    }
    expect(w.failures).toEqual([]); expect(await w.settle()).toBe(true);
  } finally { await w.dispose(); }
});

test("G1b: equal-look panels share selection/history and one write; an unseen direct pin never changes the drawn context", async () => {
  const w = await profileContextStudio();
  try {
    const a = w.bind("presets--scene0"), b = w.bind("presets--shared"), unseen = w.bind("presets--unseen");
    let writes = 0; const key = lookRef(w.looks[0]!);
    const off = w.outbox.subscribe(event => { if (event.kind === "recorded" && event.refs.some(ref => ref.kind === key.kind && ref.id === key.id)) writes++; });
    const eye = a.context.current().feature("eye-makeup"), layer = eye.view().recipe().layers[0]!.id;
    expect(eye.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: 0.31 }).ok).toBe(true);
    expect(writes).toBe(1);
    expect(b.context.current().feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.31);
    eye.dispatch({ kind: "point.select", layerId: layer, index: 2 });
    expect(b.context.current().feature("eye-makeup").view().selected()).toBe(2);
    expect(a.context.current().authoring.historyTimeline()).toEqual(b.context.current().authoring.historyTimeline());
    const drawn = JSON.stringify(w.core.document.export()), counters = w.counters(), graph = JSON.stringify(w.session.session().views);
    const other = unseen.context.current().feature("eye-makeup");
    expect(other.dispatch({ kind: "layer.setOpacity", layerId: other.view().recipe().layers[0]!.id, opacity: 0.61 }).ok).toBe(true);
    expect(JSON.stringify(w.core.document.export())).toBe(drawn); expect(w.counters()).toEqual(counters); expect(JSON.stringify(w.session.session().views)).toBe(graph);
    expect(unseen.context.current().library.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
    expect(w.session.panel("presets--unseen")!.binding).toEqual({ policy: "pinned", target: { look: { collection: w.looks[2]!.collection,
      look: unseen.context.current().library.summary().draft!.selected! } } });
    const viewHistory = w.history.scope(`view:${w.session.profile}`)!, depth = viewHistory.state().depth;
    expect(unseen.context.current().authoring.dispatch({ kind: "scene.setLook", look: w.looks[2]! }).ok).toBe(true);
    expect(viewHistory.state().depth).toBe(depth + 1);
    expect(unseen.context.current().library.summary().draft!.selected).toBe(w.looks[2]!.look);
    off(); a.life.abort(); expect(b.context.current().feature("eye-makeup").view().selected()).toBe(2);
  } finally { await w.dispose(); }
});

test("G1b: three character application facades edit three Vs of both bodies independently", async () => {
  const w = await profileContextStudio();
  try {
    const panels = [0, 1, 2].map(i => w.bind(`character--target${i}`).context);
    const deadline = Date.now() + 2000;
    while (panels.some(panel => panel.current().authoring.snapshot().character?.phase !== "ready") && Date.now() < deadline) await Bun.sleep(5);
    for (let i = 0; i < 3; i++) {
      const before = w.vs.map(id => JSON.stringify(w.services.characters.document(id)));
      expect(panels[i]!.current().authoring.dispatch({ kind: "character.setOwnMakeup", shown: false }).ok).toBe(true);
      expect(w.history.scope(`character:${w.vs[i]}`)!.state().depth).toBe(1);
      for (let j = 0; j < 3; j++) if (i !== j) expect(JSON.stringify(w.services.characters.document(w.vs[j]!))).toBe(before[j]);
    }
    expect(w.services.characters.list().map(v => v.body).sort()).toEqual(["female", "female", "male"]);
  } finally { await w.dispose(); }
});

test("dirty release/reacquire, persisted restart and separate histories retain exact authored content", async () => {
  const w = await profileContextStudio(); let next: Awaited<ReturnType<typeof profileContextStudio>> | undefined;
  try {
    const panel = w.bind("presets--unseen"), eye = panel.context.current().feature("eye-makeup"), layer = eye.view().recipe().layers[0]!.id;
    eye.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: 0.44 }); panel.life.abort();
    expect(w.bind("presets--unseen").context.current().feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.44);
    await w.settle(); const seed = w.stored(); await w.dispose(); next = await profileContextStudio({ restart: seed });
    const resumed = next.bind("presets--unseen").context.current();
    expect(resumed.feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.44);
    expect(resumed.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
    expect(next.history.scope(lookScope(next.looks[0]!))!.state().depth).toBe(0);
  } finally { if (next) await next.dispose(); else await w.dispose(); }
});

test("character preset files go to each pinned V after focus moves and refuse after rebinding", async () => {
  let answer!: (file: StudioPickedFile | undefined) => void;
  const w = await profileContextStudio({ pick: () => new Promise(done => { answer = done; }) });
  try {
    const panels = [0, 1, 2].map(i => w.bind(`character--target${i}`).context);
    const deadline = Date.now() + 2000;
    while (panels.some(panel => panel.current().authoring.snapshot().character?.phase !== "ready") && Date.now() < deadline) await Bun.sleep(5);
    const file = (i: number): StudioPickedFile => {
      const bytes = new TextEncoder().encode(JSON.stringify({ schema: "xfs/cc-preset-1", bodyGender: i === 1 ? "female" : "male", name: `Pinned ${i}`, values: [] }));
      return { name: "pinned.xfs-character.json", size: bytes.length, text: async () => new TextDecoder().decode(bytes), bytes: async () => bytes };
    };
    for (let i = 0; i < 3; i++) {
      const before = w.vs.map(id => JSON.stringify(w.services.characters.document(id)));
      const pending = panels[i]!.current().files.execute({ kind: "characterPreset.import" });
      w.history.focus.focusView(w.session.session().views.views[(i + 1) % 3]!.id); answer(file(i));
      expect(await pending).toMatchObject({ ok: true, code: "loaded" });
      expect(w.services.characters.document(w.vs[i]!)!.source).toMatchObject({ kind: "preset", name: `Pinned ${i}` });
      for (let j = 0; j < 3; j++) if (j !== i) expect(JSON.stringify(w.services.characters.document(w.vs[j]!))).toBe(before[j]);
    }
    // Wait for the body-changing imports to finish refreshing their catalogue before asking for another file.
    const refreshed = Date.now() + 2000;
    while (panels[0]!.current().authoring.snapshot().character?.phase !== "ready" && Date.now() < refreshed) await Bun.sleep(5);
    const pending = panels[0]!.current().files.execute({ kind: "characterPreset.import" }), before = w.vs.map(id => JSON.stringify(w.services.characters.document(id)));
    expect(w.port.authoring.dispatch({ kind: "panels.setBinding", destination: w.session.panelTarget("character--target0"),
      binding: { policy: "pinned", target: { subject: characterRef(w.vs[1]!) } } }).ok).toBe(true);
    answer(file(0)); expect(await pending).toMatchObject({ ok: false, code: "missing_target" });
    expect(w.vs.map(id => JSON.stringify(w.services.characters.document(id)))).toEqual(before); expect(w.targets.held()).toBe(0);
  } finally { await w.dispose(); }
});

test("stale file returns refuse after binding changes and abort; focus movement preserves the captured destination", async () => {
  let answer!: (file: StudioPickedFile | undefined) => void;
  const w = await profileContextStudio({ pick: () => new Promise(done => { answer = done; }) });
  const file = { name: "shape.json", size: 100, text: async () => JSON.stringify(recipeFile(w.core.document.recipe)), bytes: async () => new Uint8Array() };
  try {
    const panel = w.bind("presets--unseen"), port = panel.context.current(), before = JSON.stringify(w.services.collections.list());
    const pending = port.files.execute({ kind: "recipe.import" });
    w.port.authoring.dispatch({ kind: "panels.setBinding", destination: w.session.panelTarget("presets--unseen"), binding: { policy: "pinned", target: { look: w.looks[0]! } } });
    answer(file); expect(await pending).toMatchObject({ ok: false, code: "missing_target" });
    expect(JSON.stringify(w.services.collections.list())).toBe(before);
    const aborted = panel.context.current().files.execute({ kind: "recipe.import" }); panel.life.abort(); answer(file);
    expect(await aborted).toMatchObject({ ok: false, code: "missing_target" });
    const follow = w.bind("presets--follow"), old = follow.context.current(), into = old.library.summary().draft!.id;
    const kept = old.files.execute({ kind: "recipe.import" });
    w.history.focus.focusView(w.session.session().views.views[2]!.id); answer(file);
    expect(await kept).toMatchObject({ ok: true });
    expect(w.services.collections.looksOf(into).some(look => look.name === "shape")).toBe(true);
    expect(w.targets.held()).toBe(0);
  } finally { await w.dispose(); }
});

test("external updates reset only their look history; a scoped conflict resolution keeps the exact destination", async () => {
  const w = await profileContextStudio(); await w.settle();
  const other = await profileContextStudio({ restart: w.stored() });
  try {
    const panel = w.bind("presets--unseen"), otherPanel = other.bind("presets--unseen");
    const original = JSON.stringify(w.core.document.export());
    otherPanel.context.current().feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.21 });
    await other.settle(); await w.outbox.check();
    expect(panel.context.current().feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.21);
    expect(panel.context.current().authoring.history().depth).toBe(0);
    expect(JSON.stringify(w.core.document.export())).toBe(original);
    const send = w.transport.transact;
    w.transport.transact = async () => { throw Error("offline test"); };
    panel.context.current().feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.42 });
    expect(await w.settle()).toBe(false);
    otherPanel.context.current().feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.63 });
    await other.settle(); w.transport.transact = send; w.outbox.retry(); await w.outbox.flush();
    const conflicts = panel.context.current().library.summary().draft!.conflicts;
    expect(conflicts).toHaveLength(1);
    expect(await panel.context.current().library.execute({ kind: "resolveConflict", conflict: conflicts[0]!.id, keep: "theirs" })).toMatchObject({ ok: true });
    expect(panel.context.current().feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.63);
    expect(w.session.panel("presets--unseen")!.binding).toEqual({ policy: "pinned", target: { look: w.looks[2]! } });
    expect(JSON.stringify(w.core.document.export())).toBe(original);
  } finally { await other.dispose(); await w.dispose(); }
});

test("a write failure retains the sole dirty context through release/reacquire; aborted acquisition creates nothing", async () => {
  const w = await profileContextStudio();
  const update = w.services.collections.updateLook;
  try {
    const panel = w.bind("presets--unseen"), eye = panel.context.current().feature("eye-makeup");
    // Fail the writer itself: a stopped outbox now refuses the application edit before it can dirty the context.
    w.services.collections.updateLook = () => ({ ok: false, code: "unavailable", reason: "Injected write failure" });
    expect(eye.dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.48 }).ok).toBe(true);
    panel.life.abort();
    expect(w.authoring.contexts.held().find(held => held.ref.look === w.looks[2]!.look)).toMatchObject({ wants: 0, dirty: true });
    expect(w.bind("presets--unseen").context.current().feature("eye-makeup").view().recipe().layers[0]!.opacity).toBe(0.48);
    const before = w.authoring.contexts.held(), cancelled = new AbortController(); cancelled.abort();
    expect(w.authoring.contexts.acquire(w.looks[1]!, cancelled.signal)).toBeUndefined();
    expect(w.authoring.contexts.held()).toEqual(before);
  } finally { w.services.collections.updateLook = update; await w.dispose(); }
});

test("missing data stays empty and creates no replacement; stale facade actions refuse after release", async () => {
  const w = await profileContextStudio();
  try {
    const target = w.looks[2]!, panel = w.bind("presets--unseen"), stale = panel.context.current();
    const look = w.services.collections.look(target)!;
    const deleted = w.services.collections.dispatch({ kind: "collection.removeLook", collection: target.collection,
      base: w.services.collections.collection(target.collection)!.revision, look: look.id });
    expect(deleted.ok).toBe(true);
    expect(await w.settle()).toBe(true);
    const before = JSON.stringify(w.services.collections.list());
    const missing = panel.context.current();
    expect(missing.library.summary().draft?.id).toBe(target.collection);
    expect(missing.feature("eye-makeup").editable().available).toBe(false);
    await missing.library.execute({ kind: "initialize" });
    expect(JSON.stringify(w.services.collections.list())).toBe(before);
    panel.life.abort();
    expect(stale.authoring.dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.71 })).toMatchObject({ ok: false, code: "missing_target" });
    expect(await stale.files.execute({ kind: "recipe.import" })).toMatchObject({ ok: false, code: "missing_target" });
  } finally { await w.dispose(); }
});

test("file captures reject external replacement and close without retaining resolver captures", async () => {
  let answer!: (file: StudioPickedFile | undefined) => void;
  const w = await profileContextStudio({ pick: () => new Promise(done => { answer = done; }) }); await w.settle();
  const other = await profileContextStudio({ restart: w.stored() });
  try {
    const pending = w.bind("presets--unseen").context.current().files.execute({ kind: "recipe.import" });
    other.bind("presets--unseen").context.current().feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.79 });
    await other.settle(); await w.outbox.check();
    const before = JSON.stringify(w.services.collections.list());
    answer({ name: "late.json", size: 1, text: async () => JSON.stringify(recipeFile(w.core.document.recipe)), bytes: async () => new Uint8Array() });
    expect(await pending).toMatchObject({ ok: false, code: "missing_target" });
    expect(JSON.stringify(w.services.collections.list())).toBe(before); expect(w.targets.held()).toBe(0);
  } finally { await other.dispose(); await w.dispose(); }
});

test("same-look control ownership survives a peer release and ends when its own requester releases", async () => {
  const w = await profileContextStudio();
  try {
    const a = w.bind("presets--shared"), b = w.bind("presets--scene0"), eye = b.context.current().feature("eye-makeup");
    expect(eye.controlBegin("panel-b:opacity", "layer-1")).toBe(true);
    eye.controlEdit("panel-b:opacity", { kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.37 });
    a.life.abort();
    expect(b.context.current().authoring.snapshot().control).toMatchObject({ id: "panel-b:opacity" });
    expect(w.authoring.contexts.commit()).toBe(true);
    expect(b.context.current().authoring.snapshot().control).toMatchObject({ id: "panel-b:opacity" });
    b.life.abort();
    expect(w.core.app.history(lookScope(w.looks[0]!)).depth).toBe(1);
    expect(w.core.app.controlBegin("another:opacity", "layer-1", w.looks[0])).toBe(true);
    w.core.app.controlCancel("another:opacity");
  } finally { await w.dispose(); }
});

test("drawn attachment forwards subscriptions once and old context menus cannot revive after A/B/A", async () => {
  const w = await profileContextStudio();
  try {
    let changes = 0; const off = w.core.document.subscribe(() => changes++);
    const menu = w.core.app.contextFor({ kind: "layer", id: "layer-1" }, w.targets.namedView(w.drawn));
    const count = changes;
    expect(w.authoring.drawn.show(w.looks[1])).toBe(true); expect(changes).toBe(count + 1);
    expect(w.authoring.drawn.show(w.looks[0])).toBe(true); expect(changes).toBe(count + 2);
    expect(w.core.app.dispatchContext(menu, { kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.13 })).toMatchObject({ ok: false, code: "missing_target" });
    expect(w.core.document.recipe.layers[0]!.opacity).toBe(0.85); off();
  } finally { await w.dispose(); }
});

test("bounded acquisition/edit/release probe returns data ownership to its drawn baseline", async () => {
  const w = await profileContextStudio();
  try {
    const baseline = w.authoring.contexts.held(), acquire: number[] = [], edit: number[] = [];
    for (let n = 0; n < 40; n++) {
      const began = performance.now(), panels = [0, 1, 2].map(i => w.bind(`presets--scene${i}`)); acquire.push(performance.now() - began);
      const port = panels[2]!.context.current(), start = performance.now();
      expect(port.feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: (n + 1) / 100 }).ok).toBe(true);
      edit.push(performance.now() - start);
      for (const panel of panels) panel.life.abort();
      expect(w.authoring.contexts.held()).toEqual(baseline);
    }
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!.toFixed(3);
    console.log(`P3-ii synthetic service probe (40 samples): three-context acquire p95 ${p95(acquire)} ms; unseen edit p95 ${p95(edit)} ms; no renderer/assets/paint measured.`);
  } finally { await w.dispose(); }
});

test("Save version and Check/Build use the bound collection and identical coherent inputs after focus moves", async () => {
  const sent: unknown[] = [];
  const w = await profileContextStudio({ package: async (action, input) => {
    sent.push(structuredClone(input));
    const collection = input as { id: string; presets: { id: string }[] }, check = eyeCheck(collection,
      { presets: collection.presets.map(look => ({ id: look.id, revision: 1, appearance: "xfs_context" })) });
    return action === "check" ? check : eyeBuild(check);
  } });
  try {
    const panel = w.bind("presets--unseen").context, port = panel.current();
    expect(port.feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.28 }).ok).toBe(true);
    w.history.focus.focusView(w.session.session().views.views[0]!.id);
    expect(await port.library.execute({ kind: "save" })).toMatchObject({ ok: true, result: { kind: "saved", collection: { collection: { id: w.looks[2]!.collection } } } });
    expect(await port.files.execute({ kind: "package.check" })).toMatchObject({ ok: true, result: { result: { collectionId: w.looks[2]!.collection } } });
    w.history.focus.focusView(w.session.session().views.views[1]!.id);
    expect(await port.files.execute({ kind: "package.build" })).toMatchObject({ ok: true, result: { result: { collectionId: w.looks[2]!.collection } } });
    expect(sent).toHaveLength(2); expect(sent[0]).toEqual(sent[1]);
    expect(w.library.collections.list().map(collection => collection.id)).toEqual([w.looks[2]!.collection]);
    expect(w.authoring.drawn.ref()).toEqual(w.looks[0]);
  } finally { await w.dispose(); }
});

test("root compatibility input edits the explicitly drawn context after another view gains focus", async () => {
  const w = await profileContextStudio();
  try {
    const other = w.bind("presets--scene2").context, before = JSON.stringify(other.current().authoring.snapshot().document);
    w.history.focus.focusView(w.session.session().views.views[2]!.id);
    expect(w.port.feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.29 }).ok).toBe(true);
    expect(w.core.document.recipe.layers[0]!.opacity).toBe(0.29);
    expect(JSON.stringify(other.current().authoring.snapshot().document)).toBe(before);
    expect(w.targets.namedView(w.drawn).look).toEqual(w.looks[0]);
  } finally { await w.dispose(); }
});

test("generic feature facades share one look's controls/history and isolate the other two contexts", async () => {
  const w = await profileContextStudio();
  try {
    const a = w.bind("presets--scene0"), b = w.bind("presets--shared"), other = w.bind("presets--scene1");
    const before = JSON.stringify(other.context.current().authoring.snapshot().document);
    const face = a.context.current().feature("expressions") as GenericFeatureFacade;
    expect(face.controlBegin("face:jaw")).toBe(true);
    const action = { kind: "expression.setControl", name: "jaw_mid_open", value: 0.2 };
    expect(face.controlEdit("face:jaw", action).ok).toBe(true);
    face.controlCommit("face:jaw");
    const shared = b.context.current().feature("expressions") as GenericFeatureFacade;
    expect((shared.view()!.part as { controls: Record<string, number> }).controls.jaw_mid_open).toBeCloseTo(0.2);
    expect(b.context.current().authoring.history().depth).toBe(1);
    expect(JSON.stringify(other.context.current().authoring.snapshot().document)).toBe(before);
    expect(b.context.current().authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
  } finally { await w.dispose(); }
});

test("a root control continuation cannot edit a reacquired A after A/B/A", async () => {
  const w = await profileContextStudio();
  try {
    const eye = w.port.feature("eye-makeup");
    expect(eye.controlBegin("root:opacity", "layer-1")).toBe(true);
    expect(eye.controlEdit("root:opacity", { kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.22 }).ok).toBe(true);
    w.authoring.drawn.show(w.looks[1]); w.authoring.drawn.show(w.looks[0]);
    const before = JSON.stringify(w.core.document.export());
    expect(eye.controlEdit("root:opacity", { kind: "layer.setOpacity", layerId: "layer-1", opacity: 0.77 })).toMatchObject({ ok: false, code: "missing_target" });
    expect(JSON.stringify(w.core.document.export())).toBe(before); eye.controlCommit("root:opacity");
  } finally { await w.dispose(); }
});
