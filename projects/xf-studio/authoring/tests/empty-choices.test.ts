import { describe, expect, test } from "bun:test";
import { emptyChoicesPort } from "../src/app/profiles/empty-choices";
import { createProfileServices, createTargetResolver, sceneCommands } from "../src/app/profiles/profile-window";
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

async function fixture(count: number) {
  const documents = storeDocuments(), outbox = new DocumentOutbox(documents, memoryOutboxStorage()); outbox.open();
  const host = await fixtureHost(), history = createHistoryService(), workspace = freshWorkspace();
  const services = createProfileServices({ documents, outbox, subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(host.port), history,
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
  const resolver = createTargetResolver({ state: session, history, services, contexts: type => STUDIO_CATALOGUE.context(type) });
  const scenes = sceneCommands(session, services), dispatched: string[] = [];
  let writable = true, createAllowed: import("../src/platform/api/capability").Capability = { available: true };
  const port = emptyChoicesPort({ session, resolver, services, baseline: () => defaultViewGraph(workspace.preview),
    starter: () => starterParts(STUDIO_DOCUMENTS),
    createLookCapability: () => createAllowed,
    access: () => writable ? { available: true } : { available: false, code: "unavailable", reason: "This workspace is read-only." },
    dispatch: action => { dispatched.push(action.kind); const allowed = resolver.check(action);
      if (!allowed.available) return { ok: false, code: allowed.code!, message: allowed.reason! };
      scenes.dispatch(action); return { ok: true }; } });
  const scene = session.graph.node("main", "scene").id;
  return { port, session, services, outbox, subjects, scene, dispatched, blockCreate: (reason: string) => { createAllowed = { available: false, code: "stale", reason }; }, readonly: () => { writable = false; } };
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
    spec: { id, title: id, icon: "head", description: "", element: h("div", {}, h("p", {}, "Editor content")) }, update() {},
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
      pointer.querySelector("button")!.click();
    }
    expect(revealed).toEqual(Array(7).fill("presets"));
    f.readonly(); paint();
    const pointer = (panels[1]!.spec.element as unknown as LightElement).querySelector(".empty-target-pointer")!.querySelector("button")!;
    pointer.click(); expect(revealed).toEqual(Array(8).fill("presets"));
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
    spec: { id, title: id, icon: "head", description: "", element: h("div") }, update() {},
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
