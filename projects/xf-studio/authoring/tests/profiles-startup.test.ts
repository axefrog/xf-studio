/**
 * The Studio's start on the profile services (profiles phase 1d-ii), end to end below the page: a workspace shaped like a real one (a V from
 * a save with creator choices and clothing, a collection of looks with Undo histories, recovery drafts, two views) is migrated at start
 * into an alpha.2 library, then opened as `studio-startup.ts` opens it: the services load, the session comes from the workspace, the drawn
 * scene names its V and its look. A restart (new services, the stored workspace) shows the same V and looks, and makes nothing new.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileServices, drawnScene, openProfileSession, sceneCharacter } from "../src/app/profiles/profile-window";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { decodedSaveId } from "../src/character/character-document";
import { lookContent } from "../src/library/look-editor";
import { livePart } from "../src/app/workspace/collection-workspace";
import { createStudioSubjects } from "../src/compose/subjects";
import { immutableDocumentKind } from "../src/compose/document-kinds";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { createHistoryService } from "../src/platform/core/history-service";
import type { WorkspaceState } from "../src/app/workspace/workspace-state";
import { alpha2Library, COLLECTION, fixtureSave, MODEL, realWorkspace } from "./fixtures/profiles-migration-fixtures";
import { HarnessHost, HarnessWorkspace, migrateUntilDone } from "./fixtures/profiles-migration-harness";
import { openTestLibrary, type TestLibrary } from "./fixtures/library-file";
import { libraryPort, libraryVersions } from "./fixtures/profile-studio";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";

const scratch = mkdtempSync(join(tmpdir(), "xfs-profiles-startup-"));
afterAll(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* A file a failed test left open; the system cleans its temp folder. */ } });

/** The creator catalogue host never answers here: the V's choices are read from the library, not rendered. */
const creator = { panel: () => new Promise<never>(() => {}), page: () => new Promise<never>(() => {}), view: () => new Promise<never>(() => {}),
  preset: () => new Promise<never>(() => {}), wait: async () => {} };

/** One window's start, as `studio-startup.ts` makes it: services loaded, the session opened, the drawn scene's V and look. */
async function start(library: TestLibrary, workspace: WorkspaceState) {
  const port = libraryPort(library), outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5, immutable: immutableDocumentKind });
  outbox.open();
  const history = createHistoryService();
  const services = createProfileServices({ documents: port, outbox, subjects: createStudioSubjects(), catalogue: new CreatorCatalogue(creator),
    history, versions: libraryVersions(library) });
  await services.load();
  const { state, stored } = openProfileSession(workspace, services, history.focus);
  const scene = drawnScene(state), character = await sceneCharacter(state, scene, services);
  await outbox.settle();
  return { services, state, stored, scene, character, look: state.scene(scene).look };
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
