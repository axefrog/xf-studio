/**
 * The Studio's start on the profile services (profiles phase 1d-ii), end to end below the page: a workspace shaped like a real one (a V from
 * a save with creator choices and clothing, a collection of looks with Undo histories, recovery drafts, two views) is migrated at start
 * into an alpha.2 library, then opened as `studio-startup.ts` opens it: the services load, the session comes from the workspace, the drawn
 * scene names its V and its look. A restart (new services, the stored workspace) shows the same V and looks, and makes nothing new.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createProfileServices, drawnScene, openProfileSession, sceneCharacter, sceneHeadTargets } from "../src/app/profiles/profile-window";
import { createBrowserSceneHeads } from "../src/preview/browser/browser-scene-heads";
import { harness } from "./fixtures/fake-heads";
import { freshWorkspace } from "./fixtures/eye-region";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { decodedSaveId } from "../src/character/character-document";
import { lookContent } from "../src/library/makeup-look-editor";
import { livePart } from "../src/app/workspace/makeup-workspace";
import { createStudioSubjects } from "../src/compose/subjects";
import { immutableDocumentKind } from "../src/compose/document-kinds";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { createHistoryService } from "../src/platform/core/history-service";
import { createStudioViewGraph, sessionViewGraph } from "../src/preview/preview-view-graph";
import type { WorkspaceState } from "../src/app/workspace/makeup-workspace";
import { alpha2Library, COLLECTION, fixtureSave, MODEL, realWorkspace } from "./fixtures/profiles-migration-fixtures";
import { HarnessHost, HarnessWorkspace, migrateUntilDone } from "./fixtures/profiles-migration-harness";
import { openTestLibrary, type TestLibrary } from "./fixtures/library-file";
import { libraryPort, libraryVersions } from "./fixtures/profile-studio";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { tempDir } from "./temp-dir";

const scratch = tempDir("xfs-profiles-startup-");
afterAll(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* A file a failed test left open; the system cleans its temp folder. */ } });

/** The creator catalogue host never answers here: the V's choices are read from the library, not rendered. */
const creator = { panel: () => new Promise<never>(() => {}), page: () => new Promise<never>(() => {}), view: () => new Promise<never>(() => {}),
  preset: () => new Promise<never>(() => {}), wait: async () => {} };

/** One window's start, as `studio-startup.ts` makes it: services loaded, the session opened, the drawn scene's V and look. */
async function start(library: TestLibrary, workspace: WorkspaceState, keepHeads = false) {
  const port = libraryPort(library), outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5, immutable: immutableDocumentKind });
  outbox.open();
  const history = createHistoryService();
  const services = createProfileServices({ documents: port, outbox, subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(creator),
    history, versions: libraryVersions(library) });
  await services.load();
  const { state, stored } = openProfileSession(workspace, services, { history,
    graph: (data, owner) => createStudioViewGraph(workspace.preview, data, owner), stored: sessionViewGraph });
  const scene = drawnScene(state), device = harness();
  const viewport = { ...device.ports.viewport, buildHead: async (...args: Parameters<typeof device.ports.viewport.buildHead>) => {
    const head = await device.ports.viewport.buildHead(...args);
    head.applySavedV = () => ({ applied: [], appearanceReferences: 0 });
    return head;
  } };
  // The production startup adapter and loader, replacing only the scene-rendering devices.
  const heads = createBrowserSceneHeads({ head: { ...device.ports, viewport, workspace, graph: state.graph }, scenes: sceneHeadTargets(state, services),
    characters: services.characters, prepareCore: async () => {}, pending: () => {}, notice: () => {}, shown: () => {}, previews: null });
  let loaded: boolean;
  try { await heads.load(); loaded = !!heads.shown(); } finally { if (!keepHeads) heads.dispose(); }
  const character = state.scene(scene).subject?.id;
  await outbox.settle();
  return { services, state, stored, scene, character, loaded, builds: device.builds, look: state.scene(scene).look, heads,
    settle: () => outbox.settle(), stop: () => { heads.dispose(); outbox.stop(); } };
}

test("a real-shaped workspace with a V from a save migrates at start; its V and looks show, and the same again after a restart", async () => {
  const dir = join(scratch, "real"); mkdirSync(dir, { recursive: true });
  const path = join(dir, "library.sqlite");
  alpha2Library(path);
  const before = realWorkspace(), workspace = new HarnessWorkspace(before, "startup-fixture");
  const host = new HarnessHost(path);
  await migrateUntilDone(workspace, host);
  host.close();
  const library = openTestLibrary(path);
  try {
    const seen = async () => {
      const w = await start(library, workspace.state());
      // The session is the workspace's own (stored), and its drawn scene names the migrated V: none is made.
      expect(w.stored).toBe(true);
      expect(w.services.characters.list().length).toBe(1);
      const v = w.services.characters.document(w.character!)!;
      expect(v).toMatchObject({ body: "female", source: { kind: "save", decoded: decodedSaveId(fixtureSave()) },
        choices: [{ part: "head", option: "hairs", choice: "hh_033" }, { part: "head", option: "eyes", choice: "eyes_04" }],
        clothing: { state: "custom" } });
      // The look shown is the workspace's selected look, in the migrated collection, with its content and its Undo history.
      expect(w.look?.collection).toBe(COLLECTION);
      const shown = w.services.collections.look(w.look!)!;
      const selected = before.collections!.collection.presets.find(look => look.id === before.collections!.selected)!;
      expect(shown).toMatchObject({ state: "live", name: selected.name });
      const content = lookContent(shown, MODEL)!;
      expect(content.state.recipe).toEqual(livePart(selected, MODEL)!);
      expect(content.state.history?.entries.length).toBe(before.history!.entries.length);
      // Every look of the collection is there, the one added since saving included, in order.
      expect(w.services.collections.looksOf(COLLECTION).map(look => look.name)).toEqual(before.collections!.collection.presets.map(look => look.name));
      return { character: w.character, look: w.look };
    };
    const first = await seen();
    // A restart: new services over the same library, the workspace as stored.
    const again = await seen();
    expect(again).toEqual(first);
  } finally { library.close(); }
});

test("fresh startup loads its migrated V, while an explicitly V-less scene stays empty after restart", async () => {
  const dir = join(scratch, "fresh"); mkdirSync(dir, { recursive: true });
  const path = join(dir, "library.sqlite"), workspace = new HarnessWorkspace(freshWorkspace(), "fresh-startup");
  const host = new HarnessHost(path);
  await migrateUntilDone(workspace, host); host.close();
  const library = openTestLibrary(path);
  try {
    const first = await start(library, workspace.state());
    expect(first.stored).toBe(true);
    expect(first.character).toBeDefined();
    expect(first.services.characters.document(first.character!)!.source.kind).toBe("default");
    expect(first.services.characters.list()).toHaveLength(1);
    expect(first.loaded).toBe(true); expect(first.builds).toBe(1);
    const characters = first.services.characters.list().length;
    first.state.setSubject(first.scene, undefined);
    const empty: WorkspaceState = { ...workspace.state(), profiles: { ...workspace.state().profiles!,
      sessions: { ...workspace.state().profiles!.sessions, [first.state.profile]: first.state.session() } } };
    const reopened = await start(library, empty);
    expect(reopened.character).toBeUndefined();
    expect(reopened.loaded).toBe(false); expect(reopened.builds).toBe(0);
    expect(reopened.services.characters.list()).toHaveLength(characters);
    expect(reopened.state.scene(reopened.scene).subject).toBeUndefined();
  } finally { library.close(); }
});

test("P3-vi review: delete, real head-loader startup, restore reconnects the original V without substituting its scene", async () => {
  const dir = join(scratch, "retained-subject"); mkdirSync(dir, { recursive: true });
  const path = join(dir, "library.sqlite"), workspace = new HarnessWorkspace(freshWorkspace(), "retained-startup");
  const host = new HarnessHost(path); await migrateUntilDone(workspace, host); host.close();
  const library = openTestLibrary(path);
  let first: Awaited<ReturnType<typeof start>> | undefined, reopened: Awaited<ReturnType<typeof start>> | undefined;
  try {
    first = await start(library, workspace.state(), true);
    const id = first.character!, before = first.state.scene(first.scene);
    expect((await first.services.characters.delete(id, first.services.characters.targetStatus(id).revision!)).ok).toBe(true);
    await first.settle(); await Bun.sleep(0);
    expect(first.heads.shown()).toBeUndefined(); expect(first.state.scene(first.scene)).toEqual(before);
    const saved: WorkspaceState = { ...workspace.state(), profiles: { ...workspace.state().profiles!,
      sessions: { [first.state.profile]: first.state.session() } } };
    first.stop();
    reopened = await start(library, saved, true);
    expect(reopened.character).toBe(id); expect(reopened.loaded).toBe(false); expect(reopened.builds).toBe(0);
    expect(reopened.services.characters.targetStatus(id).state).toBe("removed");
    expect(await sceneCharacter(reopened.state, reopened.scene, reopened.services)).toBeNull();
    expect(reopened.state.scene(reopened.scene)).toEqual(before);
    expect(reopened.services.characters.list()).toHaveLength(0);
    expect(reopened.services.characters.restore(id, reopened.services.characters.targetStatus(id).revision!).ok).toBe(true);
    await reopened.settle();
    const deadline = Date.now() + 2000;
    while (!reopened.heads.shown() && Date.now() < deadline) await Bun.sleep(1);
    expect(reopened.heads.showing(id)).toBeDefined(); expect(reopened.state.scene(reopened.scene)).toEqual(before);
    expect(reopened.services.characters.list().map(v => v.id)).toEqual([id]);
    const oldContext = reopened.heads.showing(id)!.characterContext;
    expect((await reopened.services.characters.delete(id, reopened.services.characters.targetStatus(id).revision!)).ok).toBe(true);
    await reopened.settle(); await Bun.sleep(0); expect(reopened.heads.shown()).toBeUndefined();
    expect(reopened.services.characters.restore(id, reopened.services.characters.targetStatus(id).revision!).ok).toBe(true);
    await reopened.heads.load();
    expect(reopened.heads.showing(id)!.characterContext).not.toBe(oldContext);
    expect(reopened.state.scene(reopened.scene)).toEqual(before);
  } finally { first?.stop(); reopened?.stop(); library.close(); }
});
