import { TOMBSTONE_RETENTION_MS } from "../src/platform/api/target-status";
import { characterRef } from "../src/platform/api/characters";
import { profileSessionOf } from "../src/app/profiles/profile-session";
import { describe, expect, test } from "bun:test";
import { emptyChoicesPort } from "../src/app/profiles/empty-choices";
import { createProfileServices, createTargetResolver, sceneCharacter, sceneCommands } from "../src/app/profiles/profile-window";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { createStudioSubjects } from "../src/compose/subjects";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { createHistoryService } from "../src/platform/core/history-service";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { defaultViewGraph } from "../src/preview/preview-view-graph";
import { fixtureHost } from "./fixtures/creator-host";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { openSession } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";
import { starterParts } from "../src/app/workspace/collection-workspace";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { profileStudio } from "./fixtures/profile-studio";
import { lookContent } from "../src/library/look-editor";
import { tabDefaults } from "../src/app/profiles/profile-window";
import { STUDIO_FRAGMENT_KNOWLEDGE, STUDIO_LAYOUT_DEFAULTS } from "../src/compose/layout-defaults";
import { withEmptyChoices } from "../src/studio-ui/panels/empty-choices";
import type { Frame, StudioRuntime } from "../src/studio-ui/runtime";
import { h } from "../src/studio-ui/dom";
import { installLightDom, uninstallLightDom, type LightElement } from "./light-dom";
import { panelCommands } from "../src/compose/panel-commands";

async function fixture(count: number, rules?: readonly import("../src/app/profiles/bindings").ConstraintRule[]) {
  const documents = storeDocuments(), storage = memoryOutboxStorage(), outbox = new DocumentOutbox(documents, storage); outbox.open();
  let now = Date.now(), available = true, registration = 0;
  const host = await fixtureHost(), history = createHistoryService(), workspace = freshWorkspace();
  const services = createProfileServices({ documents, outbox, now: () => now, subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(host.port), history,
    layouts: { contributed: STUDIO_LAYOUT_DEFAULTS, known: STUDIO_FRAGMENT_KNOWLEDGE } });
  await services.load();
  const p = await services.profiles.dispatch({ kind: "profile.create", name: "U6" });
  if (!p.ok) throw Error(p.reason);
  const subjects: string[] = [];
  for (let i = 0; i < count; i++) {
    const made = await services.characters.create({ name: `ManualSave-${i + 1}`, profile: { id: p.profile, base: services.profiles.profile(p.profile)!.revision } });
    if (!made.ok) throw Error(made.reason); subjects.push(made.character);
  }
  if (count) {
    const made = services.collections.dispatch({ kind: "collection.create", name: "Looks", looks: Array.from({ length: count }, (_, i) => ({ name: `Look ${i + 1}` })) },
      { also: id => { const edit = services.profiles.collectionMembership(p.profile, id); return edit ? [edit] : []; } });
    if (!made.ok) throw Error(made.reason);
  }
  const session = openSession(sessionOfWorkspace(workspace, { tab: "U6" }), { profile: p.profile, history });
  // The phase-2 mount adapter creates controllers' instances before painting; snapshots themselves never allocate them.
  for (const panel of ["head", "presets", "layers", "uv", "finish", "shape", "edge", "warp", "library"]) session.inputInstance(panel);
  const resolver = createTargetResolver({ state: session, history, services, rules, available: () => available, generation: () => registration, contexts: type => STUDIO_CATALOGUE.context(type) });
  const scenes = sceneCommands(session, services), dispatched: string[] = [];
  let writable = true, createAllowed: import("../src/platform/api/capability").Capability = { available: true };
  const port = emptyChoicesPort({ session, resolver, services, panels: panelCommands(session, resolver),
    registration: () => registration,
    ownerType: (instance, route) => route === "look" ? "presets" : route === "subject" ? "view" : STUDIO_CATALOGUE.primary(session.panel(instance)?.type ?? "")?.id,
    baseline: () => defaultViewGraph(workspace.preview),
    starter: () => starterParts(STUDIO_DOCUMENTS),
    createLookCapability: () => createAllowed,
    access: () => writable ? { available: true } : { available: false, code: "unavailable", reason: "This workspace is read-only." },
    dispatch: action => { dispatched.push(action.kind); const allowed = resolver.check(action);
      if (!allowed.available) return { ok: false, code: allowed.code!, message: allowed.reason! };
      scenes.dispatch(action); return { ok: true }; } });
  const scene = session.graph.node("main", "scene").id;
  return { port, session, services, resolver, documents, storage, history, host, outbox, subjects, scene, dispatched,
    advance: (ms: number) => { now += ms; }, flag: (on: boolean) => { available = on; registration++; },
    blockCreate: (reason: string) => { createAllowed = { available: false, code: "stale", reason }; }, readonly: () => { writable = false; } };
}

describe.each([0, 1, 8])("U6 with %i profile candidates", count => {
  test("a V-less scene lists profile Vs and both game defaults; choosing fills that scene", async () => {
    const f = await fixture(count), state = f.port.snapshot("head")!;
    expect(state.title).toBe("Show which V?"); expect(state.choices).toHaveLength(count + 2);
    expect(state.choices[0]!.label).toBe(count ? "ManualSave-1" : "Default V (feminine)");
    expect(state.choices.every(choice => !choice.label.startsWith("V ·"))).toBe(true);
    const pending = f.port.execute(state.choices[0]!.action);
    if (count) expect(f.session.scene(f.scene).subject?.id).toBe(f.subjects[0]);
    expect(f.session.scene(f.scene).subject).toBeDefined(); expect(f.port.snapshot("head")).toBeNull();
    expect(await pending).toEqual({ ok: true });
    expect(f.session.scene(f.scene).subject).toBeDefined(); expect(f.port.snapshot("head")).toBeNull();
    expect(f.dispatched).toEqual(["scene.setSubject"]); await f.outbox.settle();
  });
  test("a look-less scene lists looks, or creates the first one, then fills immediately", async () => {
    const f = await fixture(count), state = f.port.snapshot("layers")!;
    expect(state.title).toBe("Show which look?"); expect(state.choices).toHaveLength(count || 1);
    if (!count) expect(state.choices[0]!.label).toBe("Create a look");
    const pending = f.port.execute(state.choices[0]!.action);
    expect(f.session.scene(f.scene).look).toBeDefined(); expect(f.port.snapshot("layers")).toBeNull();
    expect(await pending).toEqual({ ok: true }); expect(f.dispatched).toEqual(["scene.setLook"]);
    const look = f.session.scene(f.scene).look!;
    expect(f.services.profiles.profile(f.session.profile)!.collections).toContain(look.collection); await f.outbox.settle();
  });
  test("a tab without a view offers Vs and opens its own independent view in one Undo step", async () => {
    const f = await fixture(count); f.session.closeView("main");
    const state = f.port.snapshot("layers")!, depth = f.session.graph.history().depth;
    expect(state.title).toBe("Open a 3D view"); expect(state.choices).toHaveLength(count ? count + 2 : 1);
    expect(await f.port.execute(state.choices[0]!.action)).toEqual({ ok: true });
    const view = f.session.graph.viewIds()[0]!;
    expect(f.session.viewTab(view)).toBe(f.session.tabId());
    expect(f.session.focus.topView([view])).toBe(view);
    expect(f.session.focus.focusedPanel()).toBe(f.session.instance(`view.${view}`));
    expect(f.session.scene(f.session.graph.node(view, "scene").id).subject).toBeDefined();
    expect(f.session.graph.history().depth).toBe(depth + 1);
    expect(f.session.graph.undo()).toBe(true); expect(f.session.graph.viewIds()).toHaveLength(0);
    expect(f.session.graph.redo()).toBe(true); expect(f.session.graph.viewIds()).toEqual([view]); await f.outbox.settle();
  });
});

for (const count of [0, 1, 8]) test(`after choosing a V, only Presets offers look choices (${count} candidates)`, async () => {
  const f = await fixture(count), revealed: string[] = [];
  installLightDom();
  const rt = { port: { emptyChoices: f.port }, dock: { reveal: (panel: string) => revealed.push(panel) }, changed() {}, report() {} } as unknown as StudioRuntime;
  const panels = ["presets", "layers", "uv", "finish", "shape", "edge", "warp", "library"].map(id => withEmptyChoices(rt, {
    spec: { id, title: id, icon: "head", description: "", element: h("div", {}, h("p", {}, "Editor content")) }, update() {}, dispose() {},
  }));
  const visible = (node: LightElement) => { for (let at: LightElement | null = node; at; at = at.parentNode) if (at.hidden) return false; return true; };
  try {
    expect(await f.port.execute(f.port.snapshot("head")!.choices[0]!.action)).toEqual({ ok: true });
    expect(f.session.scene(f.scene).look).toBeUndefined();
    const paint = () => panels.forEach(panel => panel.update({} as Frame));
    paint();
    const owners = panels.filter(panel => {
      const root = panel.spec.element as unknown as LightElement;
      return root.querySelector(".empty-actions")!.querySelectorAll("button").some(visible);
    });
    expect(owners.map(panel => panel.spec.id)).toEqual(["presets"]);
    for (const panel of panels.slice(1)) {
      const pointer = (panel.spec.element as unknown as LightElement).querySelector(".empty-target-pointer")!;
      expect(visible(pointer)).toBe(true); expect(pointer.textContent).toBe("No look in this scene. Choose one in Presets.");
      pointer.querySelector("button")!.click(); await Promise.resolve(); paint();
    }
    await Promise.resolve();
    expect(revealed).toEqual(Array(7).fill(f.session.instance("presets")));
    f.readonly(); paint();
    const pointer = (panels[1]!.spec.element as unknown as LightElement).querySelector(".empty-target-pointer")!.querySelector("button")!;
    pointer.click(); await Promise.resolve(); expect(revealed).toEqual(Array(8).fill(f.session.instance("presets")));
    expect(pointer.getAttribute("aria-disabled")).toBeNull();
  } finally { panels.forEach(panel => panel.dispose?.()); uninstallLightDom(); await f.outbox.settle(); }
});

test("a real default's tab resolves its V and look without any explicit focus", async () => {
  const f = await fixture(1), look = f.services.collections.looksOf(f.services.profiles.profile(f.session.profile)!.collections[0]!)[0]!;
  f.session.setSubject(f.scene, { kind: "character", id: f.subjects[0]! });
  f.session.setLook(f.scene, { collection: look.collection, look: look.id });
  const tabs = tabDefaults(f.session, f.services);
  tabs.dispatch({ kind: "tabs.new", default: "eye-makeup/default" });
  const view = f.session.graph.viewIds().find(view => f.session.viewTab(view) === f.session.tabId())!;
  expect(f.session.focus.topView([view])).toBe(view);
  expect(f.port.snapshot("layers")).toBeNull();
  expect(f.port.snapshot("presets")).toBeNull();
  // Sessions from before focus was initialised still have a candidate, rather than a missing view.
  f.session.focus.forgetView(view);
  expect(f.port.snapshot("layers")).toBeNull();
  expect(f.session.graph.viewIds()).toHaveLength(2);
  await f.outbox.settle();
});

test("empty.choose has a registered request owner and the application routes its capability and execution", async () => {
  const f = await fixture(1), request = f.port.snapshot("layers")!.choices[0]!.action;
  expect(STUDIO_REGISTRY.routeAsync("empty.choose")).toMatchObject({ ok: true, owner: { id: "empty", async: true } });
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  core.app.attach({ emptyChoices: f.port });
  expect(core.app.registry().find(entry => entry.id === "empty.choose")).toBeDefined();
  expect(core.app.emptyChoiceCapability(request)).toEqual({ available: true });
  expect(await core.app.executeEmptyChoice(request)).toEqual({ ok: true });
  expect(f.session.scene(f.scene).look).toBeDefined();
  expect(await core.app.executeEmptyChoice(request)).toMatchObject({ ok: false, code: "missing_target" });
  await f.outbox.settle();
});

for (const existing of [false, true]) test(`Create a look uses Add preset's contributed starter (existing collection: ${existing})`, async () => {
  const f = await fixture(0);
  if (existing) {
    const made = f.services.collections.dispatch({ kind: "collection.create", name: "Empty collection" },
      { also: id => { const edit = f.services.profiles.collectionMembership(f.session.profile, id); return edit ? [edit] : []; } });
    expect(made.ok).toBe(true);
  }
  const added = await profileStudio();
  try {
    expect(added.app.dispatch({ kind: "preset.edit", command: { kind: "add" } }).ok).toBe(true);
    const expected = added.owner.look(added.scene.look()!)!;
    expect(await f.port.execute(f.port.snapshot("layers")!.choices[0]!.action)).toEqual({ ok: true });
    const look = f.services.collections.look(f.session.scene(f.scene).look!)!;
    expect(lookContent(look, STUDIO_DOCUMENTS)!.state.recipe).toEqual(lookContent(expected, STUDIO_DOCUMENTS)!.state.recipe);
    expect(lookContent(look, STUDIO_DOCUMENTS)!.state.recipe.layers).toHaveLength(1);
    expect(Object.keys(look.parts)).toContain(STUDIO_DOCUMENTS.live);
  } finally { await f.outbox.settle(); await added.settle(); added.collection.dispose(); added.library.close(); }
});

test("a choice keeps the scene it was shown for across a focus move", async () => {
  const f = await fixture(1), state = f.port.snapshot("layers")!;
  const other = f.session.addView("main", {}), otherScene = f.session.graph.node(other, "scene").id;
  f.session.scene(otherScene);
  f.session.focus.focusView(other);
  expect(await f.port.execute(state.choices[0]!.action)).toEqual({ ok: true });
  expect(f.session.scene(f.scene).look).toBeDefined(); expect(f.session.scene(otherScene).look).toBeUndefined(); await f.outbox.settle();
});
test("a changed scene or linked replacement refuses the captured choice with missing_target", async () => {
  const f = await fixture(1), state = f.port.snapshot("layers")!;
  f.session.setSubject(f.scene, { kind: "character", id: f.subjects[0]! });
  expect(await f.port.execute(state.choices[0]!.action)).toMatchObject({ ok: false, code: "missing_target", message: expect.stringContaining("changed") });
  expect(f.session.scene(f.scene).look).toBeUndefined();
  const next = f.port.snapshot("layers")!, other = f.session.addView("main", {});
  f.session.graph.link("main", "scene", other);
  expect(await f.port.execute(next.choices[0]!.action)).toMatchObject({ ok: false, code: "missing_target" });
  expect(f.dispatched).toEqual([]); await f.outbox.settle();
});
test("a closed tab, removed candidate and read-only lease each refuse before changing the target", async () => {
  const f = await fixture(1), state = f.port.snapshot("head")!, p = f.services.profiles.profile(f.session.profile)!;
  await f.services.profiles.dispatch({ kind: "profile.removeSubject", profile: p.id, base: p.revision, subject: { kind: "character", id: f.subjects[0]! } });
  expect(await f.port.execute(state.choices[0]!.action)).toMatchObject({ ok: false, code: "missing_target" });
  f.readonly(); expect(f.port.snapshot("head")!.capability).toMatchObject({ available: false, reason: "This workspace is read-only." });
  expect(await f.port.execute(state.choices.at(-1)!.action)).toMatchObject({ ok: false, code: "unavailable" });
  f.session.close(f.session.tabId());
  expect(f.port.snapshot("head")).toBeNull(); await f.outbox.settle();
});
test("a newly opened view invalidates a captured Open a 3D view choice", async () => {
  const f = await fixture(1); f.session.closeView("main"); const state = f.port.snapshot("layers")!;
  expect(await f.port.execute(state.choices[0]!.action)).toEqual({ ok: true });
  expect(await f.port.execute(state.choices[0]!.action)).toMatchObject({ ok: false, code: "missing_target" });
  expect(f.session.graph.viewIds()).toHaveLength(1); await f.outbox.settle();
});
test("the masculine default is a new profile V, selected through scene.setSubject", async () => {
  const f = await fixture(0), state = f.port.snapshot("head")!;
  expect(await f.port.execute(state.choices.at(-1)!.action)).toEqual({ ok: true });
  const subject = f.session.scene(f.scene).subject!;
  expect(f.services.characters.document(subject.id)!.body).toBe("male");
  expect(f.services.profiles.profile(f.session.profile)!.subjects).toContainEqual(subject); await f.outbox.settle();
});
test("a default fills synchronously, and a captured choice refuses after its tab closes", async () => {
  const f = await fixture(1), state = f.port.snapshot("head")!;
  const pending = f.port.execute(state.choices.at(-1)!.action);
  expect(f.session.scene(f.scene).subject).toBeDefined();
  f.session.setSubject(f.scene, { kind: "character", id: f.subjects[0]! });
  expect(await pending).toEqual({ ok: true });
  expect(f.session.scene(f.scene).subject!.id).toBe(f.subjects[0]);
  const lookState = f.port.snapshot("layers")!; f.session.close(f.session.tabId());
  expect(await f.port.execute(lookState.choices[0]!.action)).toMatchObject({ ok: false, code: "missing_target" }); await f.outbox.settle();
});


test("Create a look uses the collection Add preset capability, including the conflict reason", async () => {
  const f = await fixture(1), collection = f.services.profiles.profile(f.session.profile)!.collections[0]!;
  const document = f.services.collections.collection(collection)!;
  f.services.collections.dispatch({ kind: "collection.removeLook", collection, base: document.revision, look: document.looks[0]! });
  const reason = "This collection changed in another window too. Choose which version to keep first.";
  f.blockCreate(reason);
  const state = f.port.snapshot("presets")!;
  expect(state.choices.map(choice => choice.label)).toEqual(["Create a look"]);
  expect(state.capability).toMatchObject({ available: false, reason });
  expect(await f.port.execute(state.choices[0]!.action)).toMatchObject({ ok: false, message: reason });
  expect(f.services.collections.collection(collection)!.looks).toEqual([]);
  await f.outbox.settle();
});

for (const count of [0, 1, 8]) test(`a view-less tab gives the declared primary panel one chooser (${count} Vs)`, async () => {
  const f = await fixture(count); f.session.closeView("main"); installLightDom();
  const rt = { port: { emptyChoices: f.port }, views: STUDIO_CATALOGUE } as unknown as StudioRuntime;
  const panels = ["layers", "uv", "finish", "presets", "library"].map(id => withEmptyChoices(rt, {
    spec: { id, title: id, icon: "head", description: "", element: h("div") }, update() {}, dispose() {},
  }));
  try {
    for (const panel of panels) {
      panel.update({} as Frame);
      const root = panel.spec.element as unknown as LightElement;
      expect(root.querySelector(".empty-choices")!.hidden).toBe(panel.spec.id !== "layers");
      expect(root.querySelector(".empty-target-pointer")!.hidden).toBe(panel.spec.id === "layers");
      if (panel.spec.id !== "layers") expect(root.querySelector(".empty-target-pointer")!.textContent).toBe("No 3D view in this tab. Open one in Layers.");
    }
  } finally { panels.forEach(panel => panel.dispose?.()); uninstallLightDom(); await f.outbox.settle(); }
});


test("P3-vi: membership detach preserves scenes/pins; delete keeps a restorable reference and never offers Create", async () => {
  const f = await fixture(1), subject = characterRef(f.subjects[0]!), id = f.session.addPanel(f.session.tabId(), "character", { binding: { policy: "pinned", target: { subject } } });
  f.session.setSubject(f.scene, subject);
  const p = f.services.profiles.profile(f.session.profile)!;
  expect((await f.services.profiles.dispatch({ kind: "profile.removeSubject", profile: p.id, base: p.revision, subject })).ok).toBe(true);
  expect(f.resolver.resolve(id).state).toBe("resolved"); expect(f.port.snapshot("head")).toBeNull();
  expect(f.services.characters.targetStatus(subject.id).state).toBe("present");
  const before = f.session.scene(f.scene), depth = f.session.graph.history().depth;
  expect((await f.services.characters.delete(subject.id, f.services.characters.character(subject.id)!.revision)).ok).toBe(true);
  expect(f.session.scene(f.scene)).toEqual(before);
  const state = f.port.snapshot(id)!;
  expect(state.status).toMatchObject({ state: "removed", instance: id, owner: { kind: "character", id: subject.id } });
  expect(state.recovery).toBe(true); expect(state.choices.some(c => "createLook" in c.action.choice)).toBe(false);
  const restore = state.choices.find(c => "restore" in c.action.choice)!.action;
  expect(await f.port.execute(restore)).toEqual({ ok: true });
  expect(f.resolver.resolve(id).state).toBe("resolved"); expect(f.session.scene(f.scene)).toEqual(before);
  expect(f.services.profiles.profile(f.session.profile)!.subjects).not.toContainEqual(subject);
  expect(f.session.graph.history().depth).toBe(depth); expect(await f.port.execute(restore)).toMatchObject({ ok: false });
  await f.outbox.settle();
});

test("P3-vi: last removed look stays named across restart; restore resumes the exact scene and pin", async () => {
  const f = await fixture(1), collection = f.services.collections.list()[0]!, ref = { collection: collection.id, look: collection.looks[0]! };
  f.session.setLook(f.scene, ref);
  const pin = f.session.addPanel(f.session.tabId(), "presets", { binding: { policy: "pinned", target: { look: ref } } });
  expect(f.services.collections.dispatch({ kind: "collection.removeLook", collection: collection.id, base: collection.revision, look: ref.look }).ok).toBe(true);
  const before = f.session.scene(f.scene), state = f.port.snapshot("layers")!;
  expect(state.status?.state).toBe("removed"); expect(state.choices.some(c => "createLook" in c.action.choice)).toBe(false);
  expect(f.port.snapshot(pin)?.status?.state).toBe("removed"); await f.outbox.settle();
  const session = openSession(profileSessionOf(JSON.parse(JSON.stringify(f.session.session())))!, { profile: f.session.profile });
  const outbox = new DocumentOutbox(f.documents, memoryOutboxStorage()); outbox.open();
  const history = createHistoryService(), services = createProfileServices({ documents: f.documents, outbox, history,
    subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(f.host.port) }); await services.load();
  const resolver = createTargetResolver({ state: session, history, services, contexts: type => STUDIO_CATALOGUE.context(type) });
  expect(session.panel(pin)?.binding).toEqual({ policy: "pinned", target: { look: ref } });
  expect(resolver.describe(pin).statuses.look).toMatchObject({ state: "removed", instance: pin });
  expect(resolver.resolve(pin).state).toBe("dangling");
  expect(await f.port.execute(state.choices.find(c => "restore" in c.action.choice)!.action)).toEqual({ ok: true });
  await f.outbox.settle(); await outbox.check();
  expect(resolver.resolve(pin)).toMatchObject({ state: "resolved", target: { look: ref } });
  expect(session.scene(f.scene)).toEqual(before); outbox.stop();
});

test("P3-vi: retained subject restores after restart; expiry/host purge cannot recreate it under its old ID", async () => {
  const f = await fixture(1), id = f.subjects[0]!, subject = characterRef(id), panel = f.session.addPanel(f.session.tabId(), "character", { binding: { policy: "pinned", target: { subject } } });
  expect((await f.services.characters.delete(id, f.services.characters.character(id)!.revision)).ok).toBe(true);
  await f.outbox.settle();
  const outbox = new DocumentOutbox(f.documents, memoryOutboxStorage()); outbox.open();
  const services = createProfileServices({ documents: f.documents, outbox, history: createHistoryService(), subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(f.host.port) });
  await services.load();
  expect(services.characters.targetStatus(id).state).toBe("removed");
  expect(services.characters.restore(id, services.characters.targetStatus(id).revision!).ok).toBe(true); await outbox.settle(); await f.outbox.check();
  expect(f.resolver.resolve(panel).state).toBe("resolved");
  await f.services.characters.delete(id, f.services.characters.character(id)!.revision); await f.outbox.settle();
  const old = f.port.snapshot(panel)!.choices.find(c => "restore" in c.action.choice)!.action;
  f.advance(TOMBSTONE_RETENTION_MS + 1);
  expect(f.services.characters.targetStatus(id).state).toBe("purged");
  expect(await f.port.execute(old)).toMatchObject({ ok: false });
  expect(f.port.snapshot(panel)!.choices.some(c => "restore" in c.action.choice)).toBe(false);
  expect(f.documents.store.cleanup({ tombstoneMs: 0 }).tombstones).toBe(1);
  outbox.stop(); f.outbox.stop();
  const freshBox = new DocumentOutbox(f.documents, memoryOutboxStorage()); freshBox.open();
  const fresh = createProfileServices({ documents: f.documents, outbox: freshBox, history: createHistoryService(), subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(f.host.port) });
  await fresh.load(); expect(fresh.characters.targetStatus(id).state).toBe("purged");
  expect(fresh.characters.restore(id, 0).ok).toBe(false); expect(f.documents.store.get("character", id)).toBeNull(); freshBox.stop();
});

test("P3-vi: scene replacement is explicit and captured; direct Choose re-pins without editing any scene", async () => {
  const f = await fixture(2), c = f.services.collections.list()[0]!, ref = { collection: c.id, look: c.looks[0]! }, other = { collection: c.id, look: c.looks[1]! };
  f.session.setLook(f.scene, ref); f.services.collections.dispatch({ kind: "collection.removeLook", collection: c.id, base: c.revision, look: ref.look });
  const id = f.session.addPanel(f.session.tabId(), "presets", { binding: { policy: "pinned", target: { look: ref } } }), before = f.session.scene(f.scene);
  const choice = f.port.snapshot(id)!.choices.find(c => "look" in c.action.choice)!.action, depth = f.session.graph.history().depth;
  expect(await f.port.execute(choice)).toEqual({ ok: true });
  expect(f.session.panel(id)?.binding).toEqual({ policy: "pinned", target: { look: other } }); expect(f.session.scene(f.scene)).toEqual(before);
  expect(f.session.graph.history().depth).toBe(depth + 1);
  const stale = f.port.snapshot("layers")!.choices.find(c => "look" in c.action.choice)!.action;
  f.session.setSubject(f.scene, characterRef(f.subjects[1]!));
  expect(await f.port.execute(stale)).toMatchObject({ ok: false, code: "missing_target" });
  const replace = f.port.snapshot("layers")!.choices.find(c => "look" in c.action.choice)!.action;
  expect(await f.port.execute(replace)).toEqual({ ok: true }); expect(f.session.scene(f.scene).look).toEqual(other);
  expect(f.services.collections.targetStatus(ref).state).toBe("removed"); await f.outbox.settle();
});

test("P3-vi: dangling view and scene pins survive restart and repair through registered binding commands", async () => {
  const f = await fixture(1);
  for (const target of [{ view: "gone" }, { scene: "gone" }]) {
    const id = f.session.addPanel(f.session.tabId(), "presets", { binding: { policy: "pinned", target } });
    const stored = profileSessionOf(JSON.parse(JSON.stringify(f.session.session())))!;
    expect(stored.tabs[0]!.panels.find(p => p.id === id)?.binding).toEqual({ policy: "pinned", target });
    const state = f.port.snapshot(id)!; expect(state.status?.state).toBe("purged");
    expect(state.choices.some(c => "restore" in c.action.choice)).toBe(false);
    const next = state.choices.find(c => "pin" in c.action.choice)!.action;
    expect(await f.port.execute(next)).toEqual({ ok: true }); expect(f.session.panel(id)?.binding).not.toEqual({ policy: "pinned", target });
  }
  await f.outbox.settle();
});

test("P3-vi: exact matching open owner wins over parked peers; absent/parked owners use one recorded operation", async () => {
  const f = await fixture(1), tab = f.session.tabId(), first = f.session.instance("presets");
  f.session.setPanelBinding(tab, first, { policy: "pinned", target: { scene: f.scene } });
  const secondView = f.session.addView("main", {}), scene = f.session.graph.node(secondView, "scene").id;
  const layer = f.session.instance("layers"); f.session.setPanelBinding(tab, layer, { policy: "pinned", target: { scene } });
  const noOwner = f.port.snapshot(layer)!;
  expect(noOwner.owner?.panel).toBeUndefined(); expect(noOwner.owner?.action).toBeDefined();
  const before = f.session.session(), depth = f.session.graph.history().depth;
  for (let n = 0; n < 3; n++) f.port.snapshot(layer);
  expect(f.session.session()).toEqual(before);
  expect(await f.port.execute(noOwner.owner!.action!)).toEqual({ ok: true });
  const made = f.port.snapshot(layer)!.owner!.panel!;
  expect(made).not.toBe(first); expect(f.session.focus.focusedPanel()).toBe(made); expect(f.session.panel(made)?.binding).toEqual({ policy: "pinned", target: { scene } });
  expect(f.session.graph.history().depth).toBe(depth + 1);
  expect(await f.port.execute(noOwner.owner!.action!)).toEqual({ ok: true }); expect(f.session.instances("presets")).toHaveLength(2);
  f.session.setPanelsOpen(tab, [made], false);
  const parked = f.port.snapshot(layer)!; expect(parked.owner?.panel).toBe(made);
  expect(await f.port.execute(parked.owner!.action!)).toEqual({ ok: true });
  const peer = f.session.addPanel(tab, "presets", { binding: { policy: "pinned", target: { scene } } });
  expect(f.port.snapshot(peer)!.owner?.panel).toBe(made); expect(f.port.snapshot(made)!.owner).toBeUndefined();
  const openOwner = f.port.snapshot(layer)!; f.readonly();
  expect(await f.port.execute(openOwner.owner!.action!)).toEqual({ ok: true }); await f.outbox.settle();
});

test("P3-vi: unregistered subject and withdrawn experiment preserve references and refuse stale callbacks", async () => {
  const f = await fixture(1), id = f.session.instance("layers"), choice = f.port.snapshot(id)!.choices[0]!.action;
  const before = f.session.session(); f.flag(false);
  expect(f.resolver.describe(id).statuses.look).toMatchObject({ state: "unavailable", instance: id });
  expect(f.port.snapshot(id)?.capability.available).toBe(false); expect(await f.port.execute(choice)).toMatchObject({ ok: false });
  f.flag(true); expect(await f.port.execute(choice)).toMatchObject({ ok: false }); expect(f.session.session()).toEqual(before);
  const character = f.session.addPanel(f.session.tabId(), "character", { binding: { policy: "pinned", target: { subject: { kind: "location", id: "place-1" } } } });
  expect(f.resolver.describe(character).statuses.subject).toMatchObject({ state: "unavailable", owner: { kind: "location", id: "place-1" } });
  expect(f.port.snapshot(character)?.choices.some(c => "restore" in c.action.choice)).toBe(false); await f.outbox.settle();
});

test("P3-vi: read-only and collection revisions gate restore without changing references, data or history", async () => {
  const f = await fixture(1), c = f.services.collections.list()[0]!, ref = { collection: c.id, look: c.looks[0]! };
  f.session.setLook(f.scene, ref); f.services.collections.dispatch({ kind: "collection.removeLook", collection: c.id, base: c.revision, look: ref.look });
  const restore = f.port.snapshot("layers")!.choices.find(c => "restore" in c.action.choice)!.action;
  const current = f.services.collections.collection(c.id)!;
  f.services.collections.dispatch({ kind: "collection.rename", collection: c.id, base: current.revision, name: "New name" });
  expect(await f.port.execute(restore)).toMatchObject({ ok: false, code: "stale" });
  const next = f.port.snapshot("layers")!.choices.find(c => "restore" in c.action.choice)!.action;
  const before = f.session.session(); f.readonly(); expect(await f.port.execute(next)).toMatchObject({ ok: false, code: "unavailable" });
  expect(f.services.collections.targetStatus(ref).state).toBe("removed"); expect(f.session.session()).toEqual(before); await f.outbox.settle();
});


test("P3-vi: a conflicted tombstone refuses Restore and retains the owner's conflict", async () => {
  const f = await fixture(1), id = f.subjects[0]!;
  await f.outbox.settle();
  const live = f.documents.store.get("character", id)!;
  f.documents.store.transact({ id: "other-window", command: "character.rename", writes: [{ kind: "character", id, base: live.revision, value: { ...(live.value as object), name: "Elsewhere" } }] });
  await f.services.characters.delete(id, f.services.characters.character(id)!.revision); await f.outbox.settle();
  const status = f.services.characters.targetStatus(id);
  expect(status).toMatchObject({ state: "removed", conflict: true, restore: { available: false, code: "stale" } });
  const before = f.storage.load(); expect(f.services.characters.restore(id, status.revision!).ok).toBe(false);
  expect(f.storage.load()).toEqual(before); expect(f.outbox.conflicts()).toHaveLength(1); f.outbox.stop();
});

test("P3-vi: recovered deletion stays pending until the outbox answers; Restore cannot unlock it", async () => {
  const f = await fixture(1), id = f.subjects[0]!; await f.outbox.settle();
  const deleting = f.services.characters.delete(id, f.services.characters.character(id)!.revision);
  f.outbox.store(); f.outbox.stop(); await deleting;
  let release!: () => void;
  const transport = { ...f.documents, transact: (request: import("../src/platform/api/document-commands").TransactRequest, signal?: AbortSignal) =>
    new Promise<import("../src/platform/api/document-commands").TransactAnswer>((resolve, reject) => {
      release = () => { void f.documents.transact(request).then(resolve, reject); };
      signal?.addEventListener("abort", () => reject(new Error("Stopped owned recovery attempt")), { once: true });
    }) };
  const outbox = new DocumentOutbox(transport, f.storage); outbox.open();
  const services = createProfileServices({ documents: transport, outbox, history: createHistoryService(), subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(f.host.port) });
  try {
    await services.load();
    expect(services.characters.targetStatus(id)).toMatchObject({ state: "pending", content: "removed" });
    expect(services.characters.restore(id, services.characters.targetStatus(id).revision!).ok).toBe(false);
    release(); expect(await outbox.settle()).toBe(true);
    expect(services.characters.targetStatus(id).state).toBe("removed");
    expect(services.characters.restore(id, services.characters.targetStatus(id).revision!).ok).toBe(true);
    // The second command is ours too; release its host attempt after it starts.
    const deadline = Date.now() + 2000;
    while (outbox.status().pending && Date.now() < deadline) { release(); await Bun.sleep(1); }
    expect(outbox.status().pending).toBe(0);
  } finally { outbox.stop(); }
});


test("P3-vi: a retained scene reference cannot be presented to dispatch as an unassigned Create slot", async () => {
  const f = await fixture(1), c = f.services.collections.list()[0]!, ref = { collection: c.id, look: c.looks[0]! };
  f.session.setLook(f.scene, ref); f.services.collections.dispatch({ kind: "collection.removeLook", collection: c.id, base: c.revision, look: ref.look });
  const state = f.port.snapshot("layers")!, restore = state.choices.find(c => "restore" in c.action.choice)!.action;
  const before = f.session.session(), documents = f.services.collections.list();
  const forged = { ...restore, destination: { ...restore.destination, target: { scene: f.scene, sceneGen: f.session.scene(f.scene).gen },
    status: { ...restore.destination.status, state: "empty" as const } }, choice: { createLook: true as const } };
  expect(await f.port.execute(forged)).toMatchObject({ ok: false, code: "missing_target" });
  expect(f.session.session()).toEqual(before); expect(f.services.collections.list()).toEqual(documents); await f.outbox.settle();
});

test("P3-vi responsiveness: detached recovery snapshots never allocate a panel, alter data or add history", async () => {
  const f = await fixture(1), c = f.services.collections.list()[0]!, ref = { collection: c.id, look: c.looks[0]! };
  f.session.setLook(f.scene, ref); f.services.collections.dispatch({ kind: "collection.removeLook", collection: c.id, base: c.revision, look: ref.look });
  const before = f.session.session(), timeline = f.session.graph.history(), samples: number[] = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    for (const type of ["presets", "layers", "uv", "finish", "shape", "library"]) f.port.snapshot(f.session.instance(type));
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`P3-vi six recovery snapshots: 120 samples, p95 ${samples[113]!.toFixed(3)} ms, max ${samples.at(-1)!.toFixed(3)} ms (Bun service only; no paint/GPU)`);
  expect(f.session.session()).toEqual(before); expect(f.session.graph.history()).toEqual(timeline); await f.outbox.settle();
});


test("P3-vi: Undo restores actual view/scene targets and their retained pins resolve without fabricated Restore", async () => {
  const f = await fixture(1), c = f.services.collections.list()[0]!, ref = { collection: c.id, look: c.looks[0]! };
  f.session.setLook(f.scene, ref); f.session.setSubject(f.scene, characterRef(f.subjects[0]!));
  const ids = [{ view: "main" }, { scene: f.scene }].map(target => f.session.addPanel(f.session.tabId(), "presets", { binding: { policy: "pinned", target } }));
  const bindings = ids.map(id => f.session.panel(id)!.binding); f.session.closeView("main");
  for (const id of ids) { expect(f.resolver.resolve(id).state).toBe("dangling"); expect(f.port.snapshot(id)!.choices.some(c => "restore" in c.action.choice)).toBe(false); }
  expect(f.session.graph.undo()).toBe(true);
  ids.forEach((id, i) => { expect(f.session.panel(id)!.binding).toEqual(bindings[i]); expect(f.resolver.resolve(id)).toMatchObject({ state: "resolved", target: { look: ref } }); });
  await f.outbox.settle();
});

test("P3-vi: a missing decoded save stays present and keeps its own recovery surface", async () => {
  const f = await fixture(1), id = f.subjects[0]!; f.session.setSubject(f.scene, characterRef(id)); await f.outbox.settle();
  const held = f.documents.store.get("character", id)!;
  f.documents.store.transact({ id: "save-missing", command: "character.update", writes: [{ kind: "character", id, base: held.revision,
    value: { ...(held.value as object), source: { kind: "save", decoded: `sv-${"0".repeat(32)}` } } }] });
  await f.outbox.check();
  expect(f.services.characters.targetStatus(id)).toMatchObject({ state: "present", reason: expect.stringContaining("save isn't") });
  expect(f.port.snapshot("head")).toBeNull(); expect(f.resolver.resolve(f.session.instance("head")).state).toBe("resolved");
  f.outbox.stop();
});


test("P3-vi: a subject chooser absent from its scene is added as an inspector without creating another graph view", async () => {
  const f = await fixture(1), view = f.session.addView("main", {}), scene = f.session.graph.node(view, "scene").id;
  const quality = f.session.addPanel(f.session.tabId(), "quality", { binding: { policy: "pinned", target: { view } } });
  const missing = f.port.snapshot(quality)!, count = f.session.graph.viewIds().length;
  expect(missing.owner?.panel).toBeUndefined(); expect(missing.owner?.action?.destination.ownerType).toBe("character");
  expect(await f.port.execute(missing.owner!.action!)).toEqual({ ok: true }); expect(f.session.graph.viewIds()).toHaveLength(count);
  const exact = f.port.snapshot(quality)!.owner!.panel!;
  expect(f.session.focus.focusedPanel()).toBe(exact);
  expect(f.session.panel(exact)).toMatchObject({ type: "character", binding: { policy: "pinned", target: { scene } } });
  await f.outbox.settle();
});

for (const route of ["look", "subject"] as const) test(`P3-vi review: an absent ${route} recovery chooser is added on its retained scene and restores the original`, async () => {
  const f = await fixture(1), tab = f.session.tabId();
  f.session.setPanelBinding(tab, f.session.instance("presets"), { policy: "pinned", target: { scene: f.scene } });
  const view = f.session.addView("main", {}), scene = f.session.graph.node(view, "scene").id;
  if (route === "look") {
    const collection = f.services.collections.list()[0]!, ref = { collection: collection.id, look: collection.looks[0]! };
    f.session.setLook(scene, ref);
    expect(f.services.collections.dispatch({ kind: "collection.removeLook", collection: collection.id, base: collection.revision, look: ref.look }).ok).toBe(true);
  } else {
    f.session.setSubject(scene, characterRef(f.subjects[0]!));
    expect((await f.services.characters.delete(f.subjects[0]!, f.services.characters.targetStatus(f.subjects[0]!).revision!)).ok).toBe(true);
  }
  const inspector = f.session.addPanel(tab, route === "look" ? "layers" : "quality", { binding: { policy: "pinned", target: route === "look" ? { scene } : { view } } });
  const missing = f.port.snapshot(inspector)!, request = missing.owner!.action!, type = route === "look" ? "presets" : "character";
  const before = f.session.scene(scene), views = f.session.graph.viewIds(), count = f.session.instances(type).length, depth = f.session.graph.history().depth;
  expect(missing.status?.state).toBe("removed"); expect(missing.owner?.panel).toBeUndefined();
  expect(f.port.capability(request)).toEqual({ available: true });
  expect(await f.port.execute(request)).toEqual({ ok: true });
  const exact = f.port.snapshot(inspector)!.owner!.panel!;
  expect(f.session.panel(exact)).toMatchObject({ type, binding: { policy: "pinned", target: { scene } } });
  expect(f.session.focus.focusedPanel()).toBe(exact); expect(f.session.graph.history().depth).toBe(depth + 1);
  expect(await f.port.execute(request)).toEqual({ ok: true }); expect(f.session.instances(type)).toHaveLength(count + 1);
  expect(f.session.graph.history().depth).toBe(depth + 1); expect(f.session.graph.viewIds()).toEqual(views);
  const restore = f.port.snapshot(exact)!.choices.find(choice => "restore" in choice.action.choice)!.action;
  expect(await f.port.execute(restore)).toEqual({ ok: true }); expect(f.resolver.resolve(exact).state).toBe("resolved");
  expect(f.session.scene(scene)).toEqual(before); await f.outbox.settle(); f.outbox.stop();
});

for (const state of ["removed", "purged", "unavailable"] as const) test(`P3-vi review: ensureSubject preserves an assigned ${state} target`, async () => {
  const f = await fixture(1), original = characterRef(f.subjects[0]!);
  if (state === "unavailable") f.session.setSubject(f.scene, { kind: "location", id: "place" });
  else {
    f.session.setSubject(f.scene, original);
    expect((await f.services.characters.delete(original.id, f.services.characters.targetStatus(original.id).revision!)).ok).toBe(true);
    if (state === "purged") f.advance(TOMBSTONE_RETENTION_MS + 1);
  }
  const before = f.session.session(), characters = f.services.characters.list();
  expect(await sceneCharacter(f.session, f.scene, f.services)).toBeNull();
  expect(await sceneCharacter(f.session, "missing-scene", f.services)).toBeNull();
  expect(f.session.session()).toEqual(before); expect(f.services.characters.list()).toEqual(characters);
  await f.outbox.settle(); f.outbox.stop();
});


test("P3-vi: wrong-kind saved pins repair through a compatible direct Choose without changing the old scene", async () => {
  const f = await fixture(1), c = f.services.collections.list()[0]!, look = { collection: c.id, look: c.looks[0]! };
  const id = f.session.addPanel(f.session.tabId(), "character", { binding: { policy: "pinned", target: { look } } });
  const state = f.port.snapshot(id)!; expect(state.status?.state).toBe("unavailable");
  const before = f.session.scene(f.scene), choose = state.choices.find(c => "subject" in c.action.choice)!.action;
  expect(f.port.capability(choose).available).toBe(true); expect(await f.port.execute(choose)).toEqual({ ok: true });
  expect(f.session.panel(id)?.binding).toEqual({ policy: "pinned", target: { subject: characterRef(f.subjects[0]!) } });
  expect(f.session.scene(f.scene)).toEqual(before); await f.outbox.settle();
});

test("P3-vi: candidate constraints are reported while listing and checked again when Choose dispatches", async () => {
  let blocked: string | undefined;
  const f = await fixture(2, [{ id: "blocked-look", applies: c => c.kind === "look", check: target => target.look?.look === blocked && blocked
    ? { available: false, code: "incompatible_mode", reason: "This look is not compatible with this inspector." } : { available: true } }]);
  const state = f.port.snapshot("layers")!, choice = state.choices[0]!.action;
  blocked = "look" in choice.choice ? choice.choice.look.look : undefined;
  expect(f.port.capability(choice)).toMatchObject({ available: false, code: "incompatible_mode" });
  expect(f.port.snapshot("layers")!.choices[0]!.capability).toMatchObject({ available: false, code: "incompatible_mode" });
  const before = f.session.session(); expect(await f.port.execute(choice)).toMatchObject({ ok: false, code: "incompatible_mode" });
  expect(f.session.session()).toEqual(before); await f.outbox.settle();
});
