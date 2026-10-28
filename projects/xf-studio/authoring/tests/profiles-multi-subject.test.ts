/**
 * Profiles phase 1's multi-subject service test (profiles design §9): the full scale on the real services together, with one drawn view.
 * Three Vs of both bodies and three looks in one profile, in a real library; a session of 5 views in 2 tabs, read as the workspace stores
 * it, with three Character panels pinned to the three Vs and a Presets panel following focus; the window's resolver
 * (`createTargetResolver`) over the core's view graph, the history service and the owners; the drawn view's look shown by the look
 * editor, as `compose/studio-startup.ts` wires them.
 *
 * It checks that edits stay independent (each V's choices and each look's content reach only their own document), that each Undo acts on
 * its own scope, that resolution never leaves the shown tab, that captures and named actions are refused with what changed once their
 * target moves, is changed elsewhere or is gone, and that the session stores and reads back with its tabs, pins and focus. Phase 2 (P2-i):
 * the tab operations over these two tabs keep every pin and look, and the session with five closed tabs stays a small share of the
 * workspace's storage budget.
 */
import { describe, expect, test } from "bun:test";
import { CHARACTER_DOCUMENT, type CharacterDocument } from "../src/character/character-document";
import { characterScope } from "../src/character/character-history";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { createProfileServices, createTargetResolver, sceneCommands } from "../src/app/profiles/profile-window";
import { profileSessionOf, type ProfileSessionData, type SessionScene, type SessionView } from "../src/app/profiles/profile-session";
import { openSession } from "./fixtures/profile-sessions";
import { sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import type { StudioAction } from "../src/app/studio-application";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { immutableDocumentKind } from "../src/compose/document-kinds";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { createStudioSubjects } from "../src/compose/subjects";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { lookRef, type LookRef } from "../src/library/collection-documents";
import { LookEditor, lookContent } from "../src/library/makeup-look-editor";
import { characterRef } from "../src/platform/api/characters";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { FocusService } from "../src/platform/core/focus";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { panelCommands } from "../src/compose/panel-commands";
import { WORKSPACE_STORAGE_BUDGET } from "../src/app/workspace/workspace-budget";
import { createStudioViewGraph, sessionViewGraph } from "../src/preview/preview-view-graph";
import { fixtureHost } from "./fixtures/creator-host";
import { freshWorkspace, initialRecipe } from "./fixtures/eye-region";
import { openTestLibrary } from "./fixtures/library-file";
import { named } from "./fixtures/named-targets";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { libraryPort, libraryVersions, storedLook } from "./fixtures/profile-studio";

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const seeded = () => { let n = 0; return () => ((n++ * 7919) % 36) / 36; };
const opacity = (value: unknown) => ((value as { parts: Record<string, { body: { layers: { opacity: number }[] } }> }).parts["eye-makeup"]!.body.layers[0]!.opacity);

/** The world: a library with a profile of three Vs and a collection of three looks, the window's services, session, core and resolver. */
async function world() {
  const library = openTestLibrary(), port = libraryPort(library);
  const outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5, immutable: immutableDocumentKind });
  outbox.open();
  const host = await fixtureHost(), focus = new FocusService(), history = createHistoryService({ focus });
  const services = createProfileServices({ documents: port, outbox, subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(host.port), history,
    versions: libraryVersions(library) });
  await services.load();
  const profile = await services.profiles.dispatch({ kind: "profile.create", name: "Crew" });
  if (!profile.ok) throw Error(profile.reason);
  const vs: string[] = [];
  for (const [index, body] of (["female", "female", "male"] as const).entries()) {
    const made = await services.characters.create({ source: { kind: "default", bodyGender: body }, name: `V${index + 1}`,
      profile: { id: profile.profile, base: services.profiles.profile(profile.profile)!.revision } });
    if (!made.ok) throw Error(made.reason);
    vs.push(made.character);
  }
  const collection = crypto.randomUUID(), looks = ["Look 1", "Look 2", "Look 3"].map(name => storedLook({ name, recipe: initialRecipe() }));
  const created = services.collections.dispatch({ kind: "collection.create", id: collection, name: "Crew looks", looks });
  if (!created.ok) throw Error(created.reason);
  await outbox.settle();
  const L = looks.map(look => ({ collection, look: look.id }) satisfies LookRef);

  // The session as the workspace stores it: 5 views (three in tab 1, two in tab 2), each with its own scene showing a V and a look.
  const base = sessionOfWorkspace(freshWorkspace(), { tab: "Layout 1", character: vs[0], look: L[0] }, seeded());
  const shaping = createStudioViewGraph(freshWorkspace().preview, base.views);
  for (const title of ["Side", "Close-up", "Second tab", "Second tab, close-up"]) shaping.addView(MAIN_VIEW, {}, { title });
  const graph = sessionViewGraph(shaping), ids = graph.views.map(view => view.id);
  const sceneOf = (view: string) => (graph.views.find(item => item.id === view) as { scene: string }).scene;
  const shows: Record<string, { v: number; look: number }> = { [ids[0]!]: { v: 0, look: 0 }, [ids[1]!]: { v: 1, look: 1 }, [ids[2]!]: { v: 2, look: 2 },
    [ids[3]!]: { v: 0, look: 1 }, [ids[4]!]: { v: 1, look: 2 } };
  const t1 = base.tabs[0]!.id, t2 = "t-second";
  const viewPanel = (view: string, n: number) => ({ id: `view--v${n}aaa`, type: "view", binding: { policy: "pinned" as const, target: { view } } });
  const data: ProfileSessionData = { ...base,
    tabs: [{ ...base.tabs[0]!, dock: null, panels: [
      ...ids.slice(0, 3).map(viewPanel),
      ...vs.map((id, n) => ({ id: `character--v${n + 1}aaa`, type: "character", binding: { policy: "pinned" as const, target: { subject: characterRef(id) } } })),
      { id: "presets--follow", type: "presets" }, { id: "history--main", type: "history" }] },
    { id: t2, name: "Layout 2", dock: null, panels: [...ids.slice(3).map((view, n) => viewPanel(view, n + 3)), { id: "presets--second", type: "presets" }] }],
    views: { ...graph, views: graph.views.map((view, n): SessionView => ({ ...view, tab: n < 3 ? t1 : t2 })),
      scenes: graph.scenes.map((scene): SessionScene => {
        const view = ids.find(id => sceneOf(id) === scene.id), shown = view ? shows[view] : undefined;
        return shown ? { ...scene, subject: characterRef(vs[shown.v]!), look: L[shown.look]!, gen: 0 } : { ...scene, gen: 0 };
      }) },
    focus: { views: { [ids[0]!]: 1 } }, seq: 1 };
  // Read as a window reads a stored session (validated), then opened with the window's focus.
  const read = profileSessionOf(structuredClone(data));
  if (!read) throw Error("The session didn't read.");
  const state = openSession(read, { profile: profile.profile, history });

  // The core with the drawn view's look in its editor, the scenes' commands and the window's resolver, as the startup wires them.
  // The drawn view: the main view while it is open (one drawn view, phase 1), else the first view of the shown tab (P2-iii draws the
  // shown tab's most recently focused view).
  const drawn = () => { const views = core.views, view = views.has(MAIN_VIEW) ? MAIN_VIEW : views.viewIds().find(id => views.tabOf(id) === state.tabId());
    return view === undefined ? "" : views.node(view, "scene").id; };
  const firstView = services.collections.look(L[0]!);
  if (firstView?.state !== "live") throw Error("The first look isn't live.");
  const first = lookContent(firstView, STUDIO_DOCUMENTS);
  const core = createTrustedAuthoringCore({ ...freshWorkspace(), ...first.state }, { history, scope: lookScope(L[0]!),
    views: state.graph, resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const editor = new LookEditor({ model: STUDIO_DOCUMENTS, sessions: services.looks, document: core.document, store: () => outbox.store() });
  editor.show(state.scene(drawn()).look);
  state.subscribe(() => editor.show(state.scene(drawn()).look));
  core.app.attach({ scenes: sceneCommands(state, services) });
  const targets = createTargetResolver({ state, history, services, contexts: type => STUDIO_CATALOGUE.context(type) });
  core.app.attach({ targetCheck: targets, panels: panelCommands(state, targets) });
  const app = named(core.app, targets);

  // Each V's character context, as a scene showing it holds one, its catalogue ready.
  const contexts = vs.map(id => services.characters.context(id, { showSave: () => {} }));
  for (const context of contexts) context.start();
  await settle();
  await services.characters.flush();
  const libraryValue = <T>(kind: string, id: string) => library.documents.get<T>(kind, id);
  return { library, outbox, services, state, core, app, targets, history, focus, editor, contexts, vs, L, ids, t1, t2, sceneOf, drawn, libraryValue,
    profile: profile.profile };
}

describe("three Vs of both bodies, three looks, five views in two tabs, three pinned Character panels", () => {
  test("P3-i registered panel actions retain repeated identity and independent pins across park, history, close/reopen and restart", async () => {
    const w = await world(), { state: s } = w, tab = w.t1;
    for (let index = 0; index < 3; index++) {
      expect(w.app.dispatch({ kind: "panels.add", destination: s.panelTabTarget(tab), type: "presets",
        binding: { policy: "pinned", target: { scene: w.sceneOf(w.ids[index]!) } } })).toMatchObject({ ok: true });
    }
    const inspectors = s.instances("presets", tab).filter(panel => panel.binding?.policy === "pinned");
    expect(inspectors).toHaveLength(3);
    expect(inspectors.map(panel => w.targets.named(panel.id).look)).toEqual(w.L);
    const id = inspectors[1]!.id, capture = s.panelTarget(id);
    expect(w.app.dispatch({ kind: "panels.remove", destination: capture })).toMatchObject({ ok: true });
    expect(s.panel(id)?.binding).toEqual(inspectors[1]!.binding);
    expect(w.app.dispatch({ kind: "history.undo", scope: `view:${s.profile}` })).toMatchObject({ ok: true });
    expect(w.app.dispatch({ kind: "panels.remove", destination: capture })).toMatchObject({ ok: false, code: "missing_target" });
    const exact = s.tab(tab); s.close(tab); s.reopen(); expect(s.tab(tab)).toEqual(exact);
    const restart = openSession(profileSessionOf(s.session())!, { profile: s.profile });
    expect(restart.instances("presets", tab)).toEqual(s.instances("presets", tab)); expect(restart.dock(tab)).toEqual(s.dock(tab));
    const source = w.ids[0]!, scene = w.sceneOf(source), count = s.graph.viewIds().length, depth = s.graph.history().depth;
    expect(w.app.dispatch({ kind: "panels.add", destination: s.panelTabTarget(tab), type: "view",
      source: { view: source, scene, sceneGen: s.scene(scene).gen, shareScene: true } })).toMatchObject({ ok: true });
    expect(s.graph.history().depth).toBe(depth + 1); expect(s.graph.viewIds()).toHaveLength(count + 1);
    const view = s.graph.viewIds().at(-1)!, pane = s.instances("view", tab).find(panel => panel.binding?.policy === "pinned" && "view" in panel.binding.target && panel.binding.target.view === view)!;
    expect(s.graph.node(view, "scene").id).toBe(scene); expect(s.graph.node(view, "camera").id).not.toBe(s.graph.node(source, "camera").id);
    expect(w.app.dispatch({ kind: "history.undo", scope: `view:${s.profile}` })).toMatchObject({ ok: true }); expect(s.panel(pane.id)).toBeUndefined();
    expect(w.app.dispatch({ kind: "history.redo", scope: `view:${s.profile}` })).toMatchObject({ ok: true }); expect(s.panel(pane.id)?.id).toBe(pane.id);
    await w.outbox.settle();
  });
  test("resolution: each pin names its own V; follow-focus and key bindings follow the shown tab's views only", async () => {
    const w = await world();
    expect(w.services.characters.list().map(v => v.body)).toEqual(["female", "female", "male"]);
    expect(w.state.tabId()).toBe(w.t1);
    expect(w.ids.map(view => w.state.viewTab(view))).toEqual([w.t1, w.t1, w.t1, w.t2, w.t2]);
    expect(["character--v1aaa", "character--v2aaa", "character--v3aaa"].map(panel => w.targets.named(panel).character)).toEqual(w.vs);
    // The Presets panel follows the most recently focused view of its tab: a view in tab 2, focused later, is never it.
    w.focus.focusView(w.ids[1]!);
    w.focus.focusView(w.ids[4]!);
    expect(w.targets.named("presets--follow")).toMatchObject({ view: w.ids[1], look: w.L[1], character: w.vs[1], tab: w.t1 });
    expect(w.targets.named()).toMatchObject({ view: w.ids[1], look: w.L[1] });
    w.focus.focusView(w.ids[2]!);
    expect(w.targets.named("presets--follow")).toMatchObject({ view: w.ids[2], look: w.L[2], character: w.vs[2] });
    // Each view's own panel shows what its scene shows.
    expect(w.targets.named("view--v0aaa")).toMatchObject({ view: w.ids[0], look: w.L[0], character: w.vs[0] });
  });

  test("edits are independent: each V's choices and each look's content reach only their own document, each Undo its own scope", async () => {
    const w = await world();
    const choice = { kind: "character.setOption" as const, part: "head" as const, option: "eyes_color", choice: "he__02_blue" };
    expect(w.contexts.map(context => context.snapshot().phase)).toEqual(["ready", "ready", "ready"]);
    // V1 and V3 (one of each body) change a creator choice; V2 changes nothing.
    w.contexts[0]!.dispatch(choice);
    w.contexts[2]!.dispatch(choice);
    // The drawn view's look (Look 1) is edited through the application, named by the resolver.
    w.focus.focusView(w.ids[0]!);
    const layer = w.core.document.recipe.layers[0]!.id;
    expect(w.app.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: 0.25 })).toMatchObject({ ok: true });
    // Look 3 is changed by its own session (another view's look: data, not drawn).
    const third = w.services.looks.open(w.L[2]!), held = third.look()!;
    expect(third.update({ parts: { ...held.parts, "eye-makeup": { ...(held.parts["eye-makeup"] as object),
      body: { ...(held.parts["eye-makeup"] as { body: object }).body, layers: (held.parts["eye-makeup"] as { body: { layers: object[] } }).body.layers.map(item => ({ ...item, opacity: 0.75 })) } } } }))
      .toMatchObject({ ok: true });
    w.editor.commit();
    await w.services.characters.flush();
    await w.outbox.settle();
    const choices = () => w.vs.map(id => w.libraryValue<CharacterDocument>(CHARACTER_DOCUMENT, id)!.value.choices.length);
    const opacities = () => w.L.map(look => opacity(w.libraryValue("look-working", lookRef(look).id)!.value));
    expect(choices()).toEqual([1, 0, 1]);
    const lookTwo = opacities()[1];
    expect([opacities()[0], opacities()[2]]).toEqual([0.25, 0.75]);
    expect(lookTwo).not.toBe(0.75);
    const lookTwoBefore = w.libraryValue("look-working", lookRef(w.L[1]!).id)!.revision;

    // Ctrl+Z in a Character panel steps its own V, whatever was edited last; in the drawn view, the look its scene shows; V2 has nothing.
    expect(["character--v1aaa", "character--v2aaa", "character--v3aaa", "view--v0aaa"].map(panel => w.targets.undoScope(panel)))
      .toEqual([...w.vs.map(characterScope), lookScope(w.L[0]!)]);
    expect(w.app.capability({ kind: "history.undo", scope: w.targets.undoScope("character--v2aaa")! })).toMatchObject({ available: false });
    expect(w.app.dispatch({ kind: "history.undo", scope: characterScope(w.vs[2]!) })).toMatchObject({ ok: true });
    expect(w.contexts.map(context => context.snapshot().set)).toEqual([1, 0, 0]);
    expect(w.core.document.recipe.layers[0]!.opacity).toBe(0.25);
    // That Undo was an editing interaction in V3's scope, so it is the editing context now: the header's Undo has nothing there, its
    // Redo puts V3's choice back, and neither reaches V1 or the look.
    expect(w.targets.editing()).toBe(characterScope(w.vs[2]!));
    expect(w.app.capability({ kind: "history.undo" })).toMatchObject({ available: false });
    expect(w.app.dispatch({ kind: "history.redo" })).toMatchObject({ ok: true });
    expect(w.contexts.map(context => context.snapshot().set)).toEqual([1, 0, 1]);
    // A look edit makes the drawn look the editing context again; the header's Undo steps it, never a V.
    expect(w.app.dispatch({ kind: "layer.setOpacity", layerId: layer, opacity: 0.4 })).toMatchObject({ ok: true });
    expect(w.targets.editing()).toBe(lookScope(w.L[0]!));
    expect(w.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
    expect(w.core.document.recipe.layers[0]!.opacity).toBe(0.25);
    expect(w.contexts.map(context => context.snapshot().set)).toEqual([1, 0, 1]);
    w.editor.commit();
    await w.services.characters.flush();
    await w.outbox.settle();
    expect(choices()).toEqual([1, 0, 1]);
    expect([opacities()[0], opacities()[2]]).toEqual([0.25, 0.75]);
    // Look 2 was never touched.
    expect(w.libraryValue("look-working", lookRef(w.L[1]!).id)!.revision).toBe(lookTwoBefore);
  });

  test("captures and named actions are refused with what changed: another look, a V changed elsewhere, a deleted V, a removed look", async () => {
    const w = await world();
    w.focus.focusView(w.ids[1]!);
    // A menu on the Presets panel captures view 2 (V2, Look 2); the scene is then given Look 3 through its command.
    const menu = new AbortController(), presets = w.targets.capture("presets--follow", menu.signal);
    expect(presets.named).toMatchObject({ view: w.ids[1], look: w.L[1] });
    const scene = w.sceneOf(w.ids[1]!);
    // A view action named for view 2 now, before the scene changes.
    const stale = w.targets.complete({ kind: "scene.setLook" as const, look: w.L[0]! }, w.core.app.descriptor("scene.setLook"), { instance: "view--v1aaa" }) as StudioAction;
    expect(stale).toMatchObject({ scene, sceneGen: 0 });
    expect(w.core.app.dispatch({ kind: "scene.setLook", scene, sceneGen: 0, look: w.L[2]! })).toMatchObject({ ok: true });
    expect(w.state.scene(scene)).toMatchObject({ look: w.L[2], gen: 1 });
    expect(w.targets.current(presets)).toEqual({ available: false, code: "missing_target", reason: "This view now shows another look." });
    expect(w.core.app.dispatch(stale)).toMatchObject({ ok: false, code: "missing_target" });
    // The drawn view's look didn't move.
    expect(w.state.scene(w.drawn()).look).toEqual(w.L[0]);
    menu.abort();

    // A capture on V2's pinned panel, then another window changes V2: refused once this window learns of it.
    const v2 = w.targets.capture("character--v2aaa", new AbortController().signal);
    expect(w.targets.current(v2)).toEqual({ available: true });
    const doc = w.libraryValue<CharacterDocument>(CHARACTER_DOCUMENT, w.vs[1]!)!;
    w.library.documents.transact({ id: "other-window", command: "character.rename", writes: [{ kind: CHARACTER_DOCUMENT, id: w.vs[1]!, base: doc.revision,
      value: { ...doc.value, name: "Renamed elsewhere" } }] });
    await w.outbox.check();
    await settle();
    expect(w.targets.current(v2)).toEqual({ available: false, code: "missing_target", reason: "This changed in another window. Try again." });

    // V3 is deleted: its pinned panel dangles (no Undo scope at all), and a capture on it is refused.
    const v3 = w.targets.capture("character--v3aaa", new AbortController().signal);
    const removed = await w.services.characters.delete(w.vs[2]!, w.services.characters.character(w.vs[2]!)!.revision);
    expect(removed.ok).toBe(true);
    expect(w.targets.resolve("character--v3aaa")).toMatchObject({ state: "dangling", missing: "subject" });
    expect(w.targets.undoScope("character--v3aaa")).toBeUndefined();
    expect(w.targets.current(v3)).toEqual({ available: false, code: "missing_target", reason: "That V was deleted." });
    // The other pins are untouched.
    expect(w.targets.named("character--v1aaa").character).toBe(w.vs[0]);

    // Look 3 is removed: a capture on view 2 (V2, now showing Look 3) is refused, and views showing it resolve without a look.
    const view2 = w.targets.capture("view--v1aaa", new AbortController().signal);
    expect(view2.named).toMatchObject({ character: w.vs[1], look: w.L[2] });
    const collection = w.services.collections.collection(w.L[2]!.collection)!;
    expect(w.services.collections.dispatch({ kind: "collection.removeLook", collection: collection.id, base: collection.revision, look: w.L[2]!.look }))
      .toMatchObject({ ok: true });
    expect(w.targets.current(view2)).toEqual({ available: false, code: "missing_target", reason: "That look was removed." });
    expect(w.targets.named("view--v1aaa")).toMatchObject({ character: w.vs[1] });
    expect(w.targets.named("view--v1aaa").look).toBeUndefined();
    await w.outbox.settle();
    expect(w.outbox.conflicts()).toEqual([]);
  });

  test("the session stores and reads back with its two tabs, its pins, what each scene shows and focus", async () => {
    const w = await world();
    w.focus.focusView(w.ids[2]!);
    expect(w.core.app.dispatch({ kind: "scene.setLook", scene: w.sceneOf(w.ids[1]!), sceneGen: 0, look: w.L[0]! })).toMatchObject({ ok: true });
    const stored = w.state.stored();
    const session = profileSessionOf(structuredClone(stored.sessions[w.profile]))!;
    expect(session.tabs.map(tab => tab.id)).toEqual([w.t1, w.t2]);
    expect(session.views.views.map(view => view.tab)).toEqual([w.t1, w.t1, w.t1, w.t2, w.t2]);
    expect(session.tabs[0]!.panels.filter(panel => panel.type === "character").map(panel => panel.binding))
      .toEqual(w.vs.map(id => ({ policy: "pinned", target: { subject: characterRef(id) } })));
    expect(session.views.scenes.find(scene => scene.id === w.sceneOf(w.ids[1]!))).toMatchObject({ look: w.L[0], gen: 1 });
    // Opened again, the session resolves as before.
    const again = openSession(session, { profile: w.profile });
    expect(again.focus.topView(w.ids)).toBe(w.ids[2]);
    const resolver = createTargetResolver({ state: again, history: w.history,
      services: w.services, contexts: type => STUDIO_CATALOGUE.context(type) });
    expect(["character--v1aaa", "character--v2aaa", "character--v3aaa"].map(panel => resolver.named(panel).character)).toEqual(w.vs);
    expect(resolver.named("presets--follow")).toMatchObject({ view: w.ids[2], look: w.L[2] });
  });

  test("tab operations over the two tabs (P2-i): a closed tab's pins, scenes and looks come back with Undo and Reopen; switching keeps each tab's own resolution", async () => {
    const w = await world(), before = JSON.stringify(w.state.session());
    // Tab 2 shown: its Presets panel follows its own views, never tab 1's.
    w.focus.focusView(w.ids[3]!);
    w.state.show(w.t2);
    expect(w.targets.named("presets--second")).toMatchObject({ view: w.ids[3], look: w.L[1], character: w.vs[0], tab: w.t2 });
    // A retained instance resolves in its own tab even while another tab is shown (P3-ii's scoped input).
    expect(w.targets.named("presets--follow")).toMatchObject({ view: w.ids[0], tab: w.t1 });
    // Close tab 1 (three views, three pinned Character panels): its views and scenes go; Undo brings all of it back.
    w.state.close(w.t1);
    expect(w.state.tabList().map(tab => tab.id)).toEqual([w.t2]);
    expect(w.core.views.viewIds()).toEqual(w.ids.slice(3));
    expect(w.core.app.dispatch({ kind: "view.undo" })).toMatchObject({ ok: true });
    expect(w.state.tabList().map(tab => tab.id)).toEqual([w.t1, w.t2]);
    expect(["character--v1aaa", "character--v2aaa", "character--v3aaa"].map(panel => w.targets.named(panel).character)).toEqual(w.vs);
    // Close it again and reopen: the same.
    w.state.close(w.t1);
    w.state.reopen(w.t1);
    expect(w.targets.named("view--v1aaa")).toMatchObject({ view: w.ids[1], look: w.L[1], character: w.vs[1] });
    w.state.show(w.t1);
    const after = JSON.parse(JSON.stringify(w.state.session())), expected = JSON.parse(before);
    expect({ ...after, focus: { ...after.focus, views: {} }, seq: 0 }).toEqual({ ...expected, focus: { ...expected.focus, views: {} }, seq: 0 });
  });

  test("size: the session with both tabs and five closed tabs (value copies of every node) is a small share of the workspace's budget", async () => {
    const w = await world();
    for (let n = 0; n < 5; n++) w.state.close(w.state.duplicate(w.t1));
    const size = JSON.stringify(w.state.stored()).length;
    expect(w.state.closedTabs()).toHaveLength(5);
    // About 4 KB a closed tab of three views: well inside the budget (2,000,000 UTF-16 units) beside a look's 160K.
    expect(size).toBeLessThan(WORKSPACE_STORAGE_BUDGET / 20);
  });
});
