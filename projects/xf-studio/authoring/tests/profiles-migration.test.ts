/**
 * The `profiles-1` migration (profiles design §8): every item §8 keeps survives, the pre-migration copy, the workspace's mark and sessions,
 * the route and its fence, and the M4/M5 rules for Vs and profiles. The crash harness is `profiles-migration-harness.test.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { PROFILES_MIGRATION_ENABLED, profilesMigrationTransport, startProfilesMigration } from "../src/app/browser/profiles-migration-device";
import { checkMigrationRequest, createProfilesMigrationHandler } from "../src/app/profiles/host/profiles-migrate";
import { buildProfileSession, dockPanels, LAYOUT_DEFAULT_DOCUMENT, migrationSnapshot, type MigrationResult, snapshotDigest } from "../src/app/profiles/profiles-migration-data";
import { PANEL_INSTANCE_ID, profileSessionOf } from "../src/app/profiles/profile-session";
import { ProfilesMigration } from "../src/app/profiles/profiles-migration";
import { decodedSaveId } from "../src/character/character-document";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { type ModPackagePlan, PACKAGE_PLAN_1 } from "../src/platform/api/export";
import { serializeWorkspace } from "../src/app/workspace/workspace-state";
import { formatFence, WORKSPACE_FENCE_HEADER } from "../src/platform/api/document-store";
import { LibraryBackups } from "../src/platform/persistence/backups";
import { DocumentStoreError } from "../src/platform/persistence/document-store";
import { alpha2Library, alpha2SaveNamed, COLLECTION, documentRows, fixtureSave, LIVE_DOCK, MODEL, OWN_SETUPS, realWorkspace, releasedHash, storedText } from "./fixtures/profiles-migration-fixtures";
import { HarnessHost, HarnessWorkspace, migrateUntilDone } from "./fixtures/profiles-migration-harness";
import { restore } from "./fixtures/workspace-observable";
import { looseWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { STUDIO_INITIAL_LAYOUT } from "../src/compose/layout-defaults";
import { openSession } from "./fixtures/profile-sessions";
import { freshWorkspace } from "./fixtures/eye-region";
import { tempDir } from "./temp-dir";

const scratch = tempDir("xfs-profiles-migration-");
afterAll(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* A file a failed test left open; the system cleans its temp folder. */ } });
let n = 0;
function library(backups = false) {
  const dir = join(scratch, `lib-${++n}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "library.sqlite");
  const copies = backups ? new LibraryBackups(path, () => Date.parse("2026-10-22T10:00:00Z")) : null;
  alpha2Library(path, copies);
  return { path, backups: copies };
}
const rows = (path: string, kind: string) => documentRows(path).filter(doc => doc.kind === kind && !doc.value?.tombstone);

describe("everything §8 keeps survives the migration", async () => {
  const { path, backups } = library(true);
  const before = realWorkspace();
  const workspace = new HarnessWorkspace(before, "browser-fixture");
  // The workspace as stored and read back: what the migration reads.
  const stored = JSON.parse(storedText(workspace.state()));
  const host = new HarnessHost(path, backups);
  const released = releasedHash(path);
  await migrateUntilDone(workspace, host);
  host.close();
  const after = workspace.state();
  const record = rows(path, "migration")[0]!.value as MigrationResult;
  const session = Object.values(after.profiles!.sessions)[0]!;

  test("the V's whole state: body, source, choices, clothing, and its decoded save", () => {
    const [character] = rows(path, "character");
    expect(character!.id).toBe(record.character);
    expect(character!.value).toMatchObject({ schema: "xfs/character-1", body: "female", source: { kind: "save", decoded: decodedSaveId(fixtureSave()) },
      choices: [{ part: "head", option: "hairs", choice: "hh_033" }, { part: "head", option: "eyes", choice: "eyes_04" }],
      clothing: { state: "custom", custom: ["Outfit", "Legs", "Feet", "Head", "Face"] } });
    expect(rows(path, "saved-v").map(doc => [doc.id, doc.value])).toEqual([[decodedSaveId(fixtureSave()), fixtureSave()]]);
  });

  test("looks, their order, parts and Undo histories, and removed looks still restorable", () => {
    const working = rows(path, "collection-working").find(doc => doc.id === COLLECTION)!.value;
    const draft = stored.collections;
    expect(working).toMatchObject({ schema: "xfs/collection-working-1", name: draft.collection.name, saved: { revision: 1 } });
    expect(working.looks).toEqual(draft.collection.presets.map((look: { id: string }) => look.id));
    for (const look of draft.collection.presets) {
      const doc = rows(path, "look-working").find(item => item.id === `${COLLECTION}/${look.id}`)!.value;
      expect([doc.name, doc.state]).toEqual([look.name, "live"]);
      expect(STUDIO_PARTS.canonicalParts(doc.parts)).toBe(STUDIO_PARTS.canonicalParts(look.parts));
      expect(doc.memory).toEqual(draft.memory[look.id]);
    }
    expect(draft.removed.length).toBeGreaterThan(0);
    for (const entry of draft.removed) {
      expect(working.removed.map((item: { look: string }) => item.look)).toContain(entry.preset.id);
      const doc = rows(path, "look-working").find(item => item.id === `${COLLECTION}/${entry.preset.id}`)!.value;
      expect([doc.name, doc.state, doc.memory]).toEqual([entry.preset.name, "removed", entry.memory]);
    }
    expect(record.idMap.looks[draft.selected]).toBe(draft.selected);
  });

  test("recovery drafts: each is a collection in the library with its content", () => {
    const drafts = [stored.collections.previous, ...stored.collections.older];
    expect(record.recovered).toHaveLength(drafts.length);
    drafts.forEach((draft: { collection: { name: string; presets: { name: string; parts: never }[] } }, i: number) => {
      const working = rows(path, "collection-working").find(doc => doc.id === record.recovered[i])!.value;
      const looks = working.looks.map((id: string) => rows(path, "look-working").find(doc => doc.id === `${record.recovered[i]}/${id}`)!.value);
      expect(looks.map((look: { name: string }) => look.name)).toEqual(draft.collection.presets.map(look => look.name));
      expect(looks.map((look: { parts: never }) => STUDIO_PARTS.canonicalParts(look.parts))).toEqual(draft.collection.presets.map(look => STUDIO_PARTS.canonicalParts(look.parts)));
    });
    // The earlier draft of the same collection is a fork of it; it isn't added to the profile.
    expect(rows(path, "collection-working").find(doc => doc.id === record.recovered[1])!.value).toMatchObject({ origin: COLLECTION, name: expect.stringContaining("(earlier draft)") });
    expect(rows(path, "profile")[0]!.value.collections).toEqual([COLLECTION]);
  });

  test("the view graph, lighting setups and cameras in the session; every view in tab 1; scenes on the V and the selected look", () => {
    expect(profileSessionOf(session)).not.toBeNull();
    const views = session.views;
    expect(views.views.map(view => [view.id, view.tab])).toEqual([["main", session.tabs[0]!.id], ["v2", session.tabs[0]!.id]]);
    expect(views.cameras.find(node => node.id === "c2")).toMatchObject({ pose: { fov: 25 } });
    expect(views.lights.find(node => node.id === "l1")).toMatchObject({ setup: OWN_SETUPS.setup, setups: [{ id: "u1", name: "Warm key" }] });
    expect(views.lights.find(node => node.id === "l2")).toMatchObject({ setup: "creator" });
    expect(views.scenes).toEqual([expect.objectContaining({ id: "s1", subject: { kind: "character", id: record.character },
      look: { collection: COLLECTION, look: stored.collections.selected }, gen: 0 })]);
    expect(session.focus).toMatchObject({ views: { v2: 1 } });
    expect(session.focus.editing).toMatch(/^look:/);
  });

  test("the live arrangement as tab 1: panel IDs become instances (views pinned), parked places and closed panels kept", () => {
    const tab = session.tabs[0]!;
    expect(tab.name).toBe("Editing");
    const instances = new Map(tab.panels.map(panel => [panel.id, panel]));
    const panels = dockPanels(tab.dock);
    expect(panels.every(id => PANEL_INSTANCE_ID.test(id) && instances.has(id))).toBe(true);
    expect(new Set(tab.panels.map(panel => panel.type))).toEqual(new Set(["presets", "layers", "view", "character", "poses"]));
    expect(tab.panels.filter(panel => panel.type === "view").map(panel => panel.binding)).toEqual([
      { policy: "pinned", target: { view: "main" } }, { policy: "pinned", target: { view: "v2" } }]);
    const wide = (tab.dock!.state as { wide: { parked: Record<string, { group: string[] }>; lastPlace: Record<string, { group: string[] }>; closed: string[] } }).wide;
    const of = (type: string, view?: string) => tab.panels.find(panel => panel.type === type &&
      (!view || (panel.binding as { target: { view: string } }).target.view === view))!.id;
    // Made by the real dock engine: the parked Poses panel's place and the closed Character panel's last place name instances only.
    expect(wide.parked).toEqual({ [of("poses")]: expect.objectContaining({ group: [of("presets"), of("poses"), of("layers")] }) });
    expect(wide.closed).toEqual([of("character")]);
    expect(wide.lastPlace).toEqual({ [of("character")]: expect.objectContaining({ group: [of("view", "main"), of("character"), of("view", "v2")] }) });
    expect(JSON.stringify(tab.dock)).not.toMatch(/"(presets|layers|poses|character|head|view\.v2)"/);
    // The same arrangement, panel for panel.
    expect(dockPanels(LIVE_DOCK).length).toBe(panels.length);
  });

  test("saved layouts as own defaults (tab 1's origin is the active one); inactive working states, size classes and module visibility dropped", () => {
    const stored = rows(path, LAYOUT_DEFAULT_DOCUMENT);
    expect(stored).toHaveLength(2);
    const defaults = record.defaults.map(id => stored.find(doc => doc.id === id)!);
    expect(defaults.map(doc => doc.value.name)).toEqual(["Editing", "Preview"]);
    expect(session.tabs[0]!.origin).toBe(defaults[0]!.id);
    const preview = defaults[1]!.value.fragment;
    expect(preview.views.map((view: { key: string }) => view.key)).toEqual(["main", "v2"]);
    expect(dockPanels(preview.tab.dock).sort()).toEqual(["layers", "presets", "view:main", "view:v2"]);
    expect(preview.nodes.find((node: { slot: string }) => node.slot === "scene")).toMatchObject({ subject: "v1", look: "look1" });
    const text = JSON.stringify(defaults.map(doc => doc.value));
    for (const dropped of ["autoSize", "working", "modules", "seen"]) expect(text).not.toContain(`"${dropped}"`);
  });

  test("the workspace keeps everything else exactly (UI preferences, motion, pose, the legacy fields today's Studio reads)", () => {
    const { migration, profiles, ...rest } = serializeWorkspace(after, MODEL) as Record<string, unknown>;
    expect(migration).toMatchObject({ id: "profiles-1", state: "done" });
    expect(profiles).toBeDefined();
    expect(rest).toEqual(stored);
    expect(after.preview).toMatchObject({ idle: true, idleClip: "relaxed", pose: { id: "pose_fixture" }, lightingSetups: OWN_SETUPS });
  });

  test("only documents were written; the copy before the first run", () => {
    expect(releasedHash(path)).toBe(released);
    expect(backups!.list().filter(copy => copy.kind === "pre-migration").map(copy => basename(copy.file))).toEqual([record.backup!]);
  });
});

describe("the pre-migration copy", () => {
  test("taken once, before the library's first run; a run that fails and rolls back leaves no copy", async () => {
    const { path, backups } = library(true);
    const host = new HarnessHost(path, backups);
    host.kill = "m-defaults";
    const a = new HarnessWorkspace(realWorkspace(), "browser-a");
    await expect(a.run(host)).resolves.toBe("killed");
    expect(backups!.list().filter(copy => copy.kind === "pre-migration")).toEqual([]);
    expect(rows(path, "character")).toEqual([]);
    await migrateUntilDone(a, host);
    await migrateUntilDone(new HarnessWorkspace(realWorkspace({ divergent: true }), "browser-b"), host);
    const copies = backups!.list().filter(copy => copy.kind === "pre-migration");
    expect(copies).toHaveLength(1);
    // The copy is the library as it was: no documents of the migration in it.
    expect(documentRows(copies[0]!.file).filter(doc => doc.kind !== "xfs-workspace-lease")).toEqual([]);
    host.close();
  });
});

describe("the workspace's mark and sessions", () => {
  test("read back as stored; a damaged session is dropped, so the next run builds it again", async () => {
    const { path } = library();
    const workspace = new HarnessWorkspace(realWorkspace(), "browser-a"), host = new HarnessHost(path);
    await migrateUntilDone(workspace, host);
    const state = workspace.state();
    expect(state.migration?.state).toBe("done");
    expect(Object.keys(state.profiles!.sessions)).toEqual([rows(path, "profile")[0]!.id]);
    const text = JSON.parse(workspace.text);
    text.profiles.sessions[Object.keys(state.profiles!.sessions)[0]!].views.views[0].tab = "t-missing";
    workspace.text = JSON.stringify(text);
    expect(workspace.state().profiles!.sessions).toEqual({});
    const count = documentRows(path).length;
    expect(await workspace.run(host)).toBe("done");
    expect(Object.keys(workspace.state().profiles!.sessions)).toHaveLength(1);
    // A new run (the old mark was done): one more record, nothing else.
    expect(documentRows(path).length - count).toBe(1);
    host.close();
  });

  test("the loose look (no collection yet) becomes a collection of one, found again by a later run", async () => {
    const { path } = library();
    const host = new HarnessHost(path);
    const workspace = new HarnessWorkspace(restore(looseWorkspaceV1()).state, "browser-loose");
    await migrateUntilDone(workspace, host);
    const [working] = rows(path, "collection-working");
    expect(working!.value).toMatchObject({ name: "My looks", looks: [expect.any(String)] });
    expect(rows(path, "look-working")[0]!.value.name).toBe("Untitled look");
    const scene = Object.values(workspace.state().profiles!.sessions)[0]!.views.scenes[0]!;
    expect(scene.look).toEqual({ collection: working!.id, look: working!.value.looks[0] });
    workspace.edit(state => { delete state.migration; delete state.profiles; });
    await migrateUntilDone(workspace, host);
    expect(rows(path, "collection-working")).toHaveLength(1);
    host.close();
  });
});

describe("Vs and profiles (M4, M5)", () => {
  test("an equal V is reused; a different one is a second V in the same profile; several profiles make one 'From this browser', once", async () => {
    const { path } = library();
    const host = new HarnessHost(path);
    await migrateUntilDone(new HarnessWorkspace(realWorkspace(), "browser-a"), host);
    const other = realWorkspace();
    other.preview.character = { ...other.preview.character!, choices: [] };
    await migrateUntilDone(new HarnessWorkspace(other, "browser-b"), host);
    expect(rows(path, "character")).toHaveLength(2);
    expect(rows(path, "profile").map(doc => [doc.value.name, doc.value.subjects.length])).toEqual([["My profile", 2]]);
    // A second profile made since: a third browser's V joins neither; it gets "From this browser", and its re-upgrade reuses that one.
    const db = host.documents;
    expect(db.transact({ id: "p-1", command: "profile.create", writes: [{ kind: "profile", id: "p-second1", base: 0,
      value: { schema: "xfs/profile-1", id: "p-second1", name: "Second", subjects: [], collections: [], createdAt: 1 } }] }).ok).toBe(true);
    const third = realWorkspace();
    third.preview.character = { ...third.preview.character!, choices: [{ part: "head", option: "eyes", choice: "eyes_09" }] };
    const workspace = new HarnessWorkspace(third, "browser-c");
    await migrateUntilDone(workspace, host);
    workspace.edit(state => { delete state.migration; delete state.profiles; });
    await migrateUntilDone(workspace, host);
    expect(rows(path, "profile").map(doc => doc.value.name).sort()).toEqual(["From this browser", "My profile", "Second"]);
    host.close();
  });
});

describe("the route", () => {
  test("local same-origin JSON only; a malformed snapshot refused; an older lease superseded; a page command can't write a record", async () => {
    const { path } = library();
    const host = new HarnessHost(path);
    const handle = createProfilesMigrationHandler({ database: host.database, documents: host.documents }, "/api/profiles/migrate", { parts: STUDIO_PARTS });
    const state = realWorkspace();
    const snapshot = migrationSnapshot(state, MODEL, "browser-a");
    const body = JSON.stringify({ token: "00000000-0000-4000-8000-0000000000f1", digest: snapshotDigest(snapshot), snapshot });
    const post = (text: string, headers: Record<string, string> = {}) => handle(new Request("http://127.0.0.1/api/profiles/migrate", { method: "POST", body: text,
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1", ...headers } }));
    expect((await handle(new Request("http://127.0.0.1/api/profiles/migrate", { method: "POST", body, headers: { "Content-Type": "application/json", Origin: "http://evil.test" } }))).status).toBe(403);
    expect((await post(JSON.stringify({ token: "x", snapshot: {} }))).status).toBe(400);
    const damaged = JSON.parse(body);
    damaged.snapshot.character.saved.id = "sv-00000000000000000000000000000000";
    expect(await (await post(JSON.stringify(damaged))).json()).toEqual({ error: "The V's save in the workspace is damaged." });
    host.documents.nextLease("browser-a"); host.documents.nextLease("browser-a");
    const stale = await post(body, { [WORKSPACE_FENCE_HEADER]: formatFence({ workspace: "browser-a", generation: 1 }) });
    expect([stale.status, (await stale.json()).code]).toEqual([409, "superseded"]);
    expect(rows(path, "character")).toEqual([]);
    const ok = await post(body, { [WORKSPACE_FENCE_HEADER]: formatFence({ workspace: "browser-a", generation: 2 }) });
    expect((await ok.json() as MigrationResult).profile).toMatch(/^p-/);
    expect(() => host.documents.transact({ id: "forge", command: "x.y", writes: [{ kind: "migration", id: "profiles-1:forged", base: 0, value: {} }] })).toThrow(DocumentStoreError);
    // The page's transport reads each answer.
    const send = profilesMigrationTransport("/api/profiles/migrate", (url, init) => handle(new Request(`http://127.0.0.1${url}`, { ...init, headers: { ...init!.headers as object, Origin: "http://127.0.0.1" } })),
      () => ({ workspace: "browser-a", generation: 1 }));
    expect(await send(JSON.parse(body), new AbortController().signal)).toEqual({ ok: false, reason: "superseded" });
    host.close();
  });

  test("the session builds from a result alone, and checkMigrationRequest keeps what it validated", () => {
    const state = realWorkspace();
    const snapshot = migrationSnapshot(state, MODEL, "browser-a");
    const checked = checkMigrationRequest(JSON.parse(JSON.stringify({ token: "00000000-0000-4000-8000-0000000000f2", digest: snapshotDigest(snapshot), snapshot })));
    expect(checked.snapshot.drafts.map(draft => draft.looks.length)).toEqual(snapshot.drafts.map(draft => draft.looks.length));
    const result = { schema: "xfs/profiles-migration-1", token: checked.token, digest: checked.digest, at: 1, profile: "p-abcd", character: "c-abcd", collection: COLLECTION, members: [COLLECTION],
      recovered: [], defaults: ["d-1", "d-2"], idMap: { collections: {}, looks: {} }, made: [] } as MigrationResult;
    const session = buildProfileSession(state, snapshot, result, () => 0.5);
    expect(session.views.scenes[0]!.look).toBeUndefined();
    expect(session.tabs[0]!.origin).toBe("d-1");
  });
});

describe("in the Studio", () => {
  test("on since the switch-over (phase 1d-ii); turned off, the Studio's start migrates nothing, captures nothing and sends nothing", async () => {
    expect(PROFILES_MIGRATION_ENABLED).toBe(true);
    let touched = 0;
    const outcome = await startProfilesMigration({ endpoint: "/api/profiles/migrate", workspace: "browser-a", fence: () => null, model: MODEL, marks: {}, delayMs: 0,
      enabled: false, state: () => { touched++; return realWorkspace(); }, flush: () => { touched++; return true; }, signal: new AbortController().signal,
      send: async () => { touched++; return new Response("{}"); } });
    expect([outcome, touched]).toEqual(["disabled", 0]);
  });

  test("a migrated workspace starts nothing (not even a capture); otherwise the run records its mark and sessions through the workspace's write", async () => {
    const { path } = library();
    const host = new HarnessHost(path);
    const state = realWorkspace();
    const marks: Parameters<typeof startProfilesMigration>[0]["marks"] = {};
    let flushes = 0, captures = 0;
    const options = { endpoint: "/api/profiles/migrate", workspace: "browser-a", fence: () => null, model: MODEL, marks, delayMs: 0, enabled: true,
      state: () => { captures++; return { ...state, ...marks }; }, flush: () => { flushes++; return true; }, signal: new AbortController().signal,
      send: async (_url: string, init?: RequestInit) => Response.json((await host.send(JSON.parse(init!.body as string)) as { result: MigrationResult }).result) };
    expect(await startProfilesMigration(options)).toBe("done");
    expect([flushes, marks.migration?.state, Object.keys(marks.profiles!.sessions)]).toEqual([2, "done", [rows(path, "profile")[0]!.id]]);
    captures = 0;
    expect(await startProfilesMigration(options)).toBe("already");
    expect(captures).toBe(0);
    host.close();
  });
});

describe("review of chunk 1d-i", () => {
  const dropMarks = (workspace: HarnessWorkspace) => workspace.edit(state => { delete state.migration; delete state.profiles; });
  const collectionsOf = (path: string) => rows(path, "collection-working");
  const looksIn = (path: string, collection: string) => rows(path, "look-working").filter(doc => doc.id.startsWith(`${collection}/`)).map(doc => doc.value);
  const results = (path: string) => rows(path, "migration").map(doc => doc.value as MigrationResult);
  const recordInto = (workspace: HarnessWorkspace) => (marks: Parameters<ConstructorParameters<typeof ProfilesMigration>[0]["record"]>[0]) => {
    workspace.edit(state => { state.migration = marks.migration; if (marks.profiles) state.profiles = marks.profiles; else delete state.profiles; });
    return true;
  };

  test("a deleted collection is never brought back over: an old draft's re-upgrade recovers it under fresh IDs, every existing row untouched", async () => {
    const { path } = library();
    const host = new HarnessHost(path), workspace = new HarnessWorkspace(realWorkspace(), "browser-a");
    await migrateUntilDone(workspace, host);
    // One of its looks edited, then the collection deleted (a tombstone over the working copy).
    const working = host.documents.get<Record<string, unknown>>("collection-working", COLLECTION)!;
    const lookId = (working.value.looks as string[])[0]!;
    const look = host.documents.get<Record<string, unknown>>("look-working", `${COLLECTION}/${lookId}`)!;
    expect(host.documents.transact({ id: "edit", command: "look.update", writes: [{ kind: "look-working", id: `${COLLECTION}/${lookId}`, base: look.revision,
      value: { ...look.value, name: "Newer content" } }] }).ok).toBe(true);
    expect(host.documents.transact({ id: "delete", command: "collection.delete", writes: [{ kind: "collection-working", id: COLLECTION, base: working.revision,
      value: { tombstone: true, at: 1, value: working.value } }] }).ok).toBe(true);
    const before = documentRows(path).filter(doc => doc.kind === "collection-working" || doc.kind === "look-working");
    dropMarks(workspace);
    await migrateUntilDone(workspace, host);
    const after = documentRows(path);
    for (const doc of before) expect(after.find(other => other.kind === doc.kind && other.id === doc.id)).toEqual(doc);
    const result = results(path).find(item => item.collection !== COLLECTION)!;
    expect(collectionsOf(path).find(doc => doc.id === result.collection)!.value).toMatchObject({ origin: COLLECTION, name: expect.stringContaining("(from this browser)") });
    expect(looksIn(path, result.collection).filter(item => item.state === "live").map(item => item.name).sort())
      .toEqual(workspace.state().collections!.collection.presets.map(preset => preset.name).sort());
    host.close();
  });

  test("identical live looks but different removed looks: the second draft forks, and both removed looks stay restorable", async () => {
    const { path } = library();
    const host = new HarnessHost(path);
    await migrateUntilDone(new HarnessWorkspace(realWorkspace(), "browser-a"), host);
    const other = realWorkspace();
    const [removed] = other.collections!.removed;
    other.collections!.removed.push({ preset: { ...structuredClone(removed!.preset), id: "00000000-0000-4000-8000-0000000000b1", name: "Removed in the other browser" },
      index: 0, memory: structuredClone(removed!.memory) });
    await migrateUntilDone(new HarnessWorkspace(other, "browser-b"), host);
    const result = results(path).find(item => item.collection !== COLLECTION)!;
    expect(collectionsOf(path).find(doc => doc.id === result.collection)!.value.origin).toBe(COLLECTION);
    expect(looksIn(path, result.collection).filter(item => item.state === "removed").map(item => item.name).sort())
      .toEqual([removed!.preset.name, "Removed in the other browser"].sort());
    expect(looksIn(path, COLLECTION).filter(item => item.state === "removed").map(item => item.name)).toEqual([removed!.preset.name]);
    // A draft holding fewer removed looks than the working copy loses nothing: reused.
    const fewer = realWorkspace();
    fewer.collections!.removed = [];
    await migrateUntilDone(new HarnessWorkspace(fewer, "browser-c"), host);
    expect(results(path).filter(item => item.collection === COLLECTION)).toHaveLength(2);
    host.close();
  });

  test("identical live looks but different Undo histories: the second draft forks, and both histories are kept", async () => {
    const { path } = library();
    const host = new HarnessHost(path);
    await migrateUntilDone(new HarnessWorkspace(realWorkspace(), "browser-a"), host);
    const other = realWorkspace(), first = other.collections!.collection.presets[0]!.id;
    delete other.collections!.memory[first];
    await migrateUntilDone(new HarnessWorkspace(other, "browser-b"), host);
    const result = results(path).find(item => item.collection !== COLLECTION)!;
    const theirs = JSON.parse(storedText(realWorkspace())).collections.memory[first];
    const mine = JSON.parse(storedText(new HarnessWorkspace(other, "x").state())).collections.memory[first];
    expect(mine).not.toEqual(theirs);
    expect(rows(path, "look-working").find(doc => doc.id === `${COLLECTION}/${first}`)!.value.memory).toEqual(theirs);
    expect(rows(path, "look-working").find(doc => doc.id === `${result.collection}/${result.idMap.looks[first]}`)!.value.memory).toEqual(mine);
    host.close();
  });

  test("a lost answer, then an edit before the resend: the edit is migrated under a new token before the workspace is done", async () => {
    const { path } = library();
    const host = new HarnessHost(path), workspace = new HarnessWorkspace(realWorkspace(), "browser-a");
    let lost = false;
    const added = "00000000-0000-4000-8000-0000000000c1";
    const migration = new ProfilesMigration({ workspace: "browser-a", model: MODEL, state: () => workspace.state(), wait: async () => {}, record: recordInto(workspace),
      send: async request => {
        const answer = await host.send(request);
        if (lost) return answer;
        lost = true;
        // The answer never arrives; meanwhile a look is added and shown.
        workspace.edit(state => {
          const looks = state.collections!.collection.presets;
          looks.push({ ...structuredClone(looks[0]!), id: added, name: "Added while the answer was lost" });
          state.collections!.selected = added;
        });
        throw Error("The library couldn't be reached.");
      } });
    expect(await migration.run(new AbortController().signal)).toBe("done");
    const scene = Object.values(workspace.state().profiles!.sessions)[0]!.views.scenes[0]!;
    expect(rows(path, "look-working").find(doc => doc.id === `${scene.look!.collection}/${scene.look!.look}`)!.value.name).toBe("Added while the answer was lost");
    expect(rows(path, "migration")).toHaveLength(2);
    host.close();
  });

  test("an edit made while the answer was on its way is migrated too", async () => {
    const { path } = library();
    const host = new HarnessHost(path), workspace = new HarnessWorkspace(realWorkspace(), "browser-a");
    let edited = false;
    const migration = new ProfilesMigration({ workspace: "browser-a", model: MODEL, state: () => workspace.state(), record: recordInto(workspace),
      send: async request => {
        const answer = await host.send(request);
        if (!edited) {
          edited = true;
          workspace.edit(state => { state.collections!.collection.presets.find(look => look.id === state.collections!.selected)!.name = "Renamed meanwhile"; });
        }
        return answer;
      } });
    expect(await migration.run(new AbortController().signal)).toBe("done");
    const scene = Object.values(workspace.state().profiles!.sessions)[0]!.views.scenes[0]!;
    expect(rows(path, "look-working").find(doc => doc.id === `${scene.look!.collection}/${scene.look!.look}`)!.value.name).toBe("Renamed meanwhile");
    host.close();
  });

  test("a named version brought back by an earlier run joins the profile a later run migrates into", async () => {
    const { path } = library();
    const host = new HarnessHost(path), a = new HarnessWorkspace(realWorkspace(), "browser-a");
    await migrateUntilDone(a, host);
    host.close();
    alpha2SaveNamed(path, 2, "Renamed in the older build");
    host.restart();
    dropMarks(a);
    await migrateUntilDone(a, host);
    const fork = collectionsOf(path).find(doc => /older version/.test(doc.value.name))!.id;
    expect(host.documents.transact({ id: "p-2", command: "profile.create", writes: [{ kind: "profile", id: "p-second1", base: 0,
      value: { schema: "xfs/profile-1", id: "p-second1", name: "Second", subjects: [], collections: [], createdAt: 1 } }] }).ok).toBe(true);
    const other = realWorkspace();
    other.preview.character = { ...other.preview.character!, choices: [] };
    await migrateUntilDone(new HarnessWorkspace(other, "browser-c"), host);
    expect(rows(path, "profile").find(doc => doc.value.name === "From this browser")!.value.collections).toEqual([COLLECTION, fork]);
    host.close();
  });
});

describe("second review of chunk 1d-i", () => {
  const results = (path: string) => rows(path, "migration").map(doc => doc.value as MigrationResult);
  /** Migrates the fixture, then `other`: answers the collection `other`'s draft went to. */
  async function second(other: ReturnType<typeof realWorkspace>, between?: (host: HarnessHost) => void): Promise<{ path: string; collection: string }> {
    const { path } = library();
    const host = new HarnessHost(path);
    await migrateUntilDone(new HarnessWorkspace(realWorkspace(), "browser-a"), host);
    between?.(host);
    await migrateUntilDone(new HarnessWorkspace(other, "browser-b"), host);
    host.close();
    return { path, collection: results(path).at(-1)!.collection };
  }
  const removedNames = (path: string, collection: string) =>
    rows(path, "look-working").filter(doc => doc.id.startsWith(`${collection}/`) && doc.value.state === "removed").map(doc => doc.value.name).sort();

  test("a removed look the working copy holds past 30 days isn't restorable there: the draft keeping it forks", async () => {
    const { path, collection } = await second(realWorkspace(), host => {
      const working = host.documents.get<{ removed: { look: string; at: number }[] }>("collection-working", COLLECTION)!;
      const old = Date.now() - 31 * 24 * 3600_000;
      expect(host.documents.transact({ id: "age", command: "collection.rename", writes: [{ kind: "collection-working", id: COLLECTION, base: working.revision,
        value: { ...working.value, removed: working.value.removed.map(item => ({ ...item, at: old })) } }] }).ok).toBe(true);
    });
    expect(collection).not.toBe(COLLECTION);
    const [removed] = realWorkspace().collections!.removed;
    expect(removedNames(path, collection)).toEqual([removed!.preset.name]);
  });

  test("two equal removed looks need two restorable ones: one in the working copy isn't enough", async () => {
    const other = realWorkspace();
    const [removed] = other.collections!.removed;
    other.collections!.removed.push({ preset: { ...structuredClone(removed!.preset), id: "00000000-0000-4000-8000-0000000000d1" }, index: 0, memory: structuredClone(removed!.memory) });
    const { path, collection } = await second(other);
    expect(collection).not.toBe(COLLECTION);
    expect(removedNames(path, collection)).toEqual([removed!.preset.name, removed!.preset.name]);
  });

  test("another name or another package plan forks, keeping it; a migration's own copy still reuses under the name it was given", async () => {
    const renamed = realWorkspace();
    renamed.collections!.collection.name = "Fixture looks, renamed elsewhere";
    const byName = await second(renamed);
    expect(byName.collection).not.toBe(COLLECTION);
    expect(rows(byName.path, "collection-working").find(doc => doc.id === byName.collection)!.value.name).toBe("Fixture looks, renamed elsewhere (from this browser)");
    const planned = realWorkspace();
    const plan: ModPackagePlan = { schema: PACKAGE_PLAN_1, products: [{ id: COLLECTION, name: "XF Night Eyes", features: [] }] };
    planned.collections!.collection.packagePlan = plan;
    const byPlan = await second(planned);
    expect(byPlan.collection).not.toBe(COLLECTION);
    const stored = rows(byPlan.path, "collection-working").find(doc => doc.id === byPlan.collection)!.value;
    expect(stored.packagePlan).toEqual(JSON.parse(storedText(planned)).collections.collection.packagePlan);
    expect(stored.packagePlan).toBeDefined();
    // The re-upgrade of a workspace whose draft became "(from this browser)" finds that copy again.
    const host = new HarnessHost(byPlan.path), workspace = new HarnessWorkspace(planned, "browser-b");
    await migrateUntilDone(workspace, host);
    host.close();
    expect(results(byPlan.path).at(-1)!.collection).toBe(byPlan.collection);
  });
});


test("Review A design 1: a fresh workspace migrates the default arrangement in both sizes, preserving legacy bytes", async () => {
  const { path } = library(), host = new HarnessHost(path), state = freshWorkspace();
  const legacy = structuredClone(state.uiPreferences);
  const outcome = await startProfilesMigration({ endpoint: "http://localhost/api/profiles/migrate", workspace: "fresh-default", fence: () => null,
    model: MODEL, state: () => state, marks: state, flush: () => true, signal: new AbortController().signal, initial: STUDIO_INITIAL_LAYOUT,
    send: async (_url, init) => { const answer = await host.send(JSON.parse(init!.body as string)); if (!answer.ok) throw Error(answer.reason); return Response.json(answer.result); } });
  expect(outcome).toBe("done");
  const data = Object.values(state.profiles!.sessions)[0]!, session = openSession(data);
  expect(data.tabs[0]!.origin).toBe("eye-makeup/default");
  expect(session.dock()).toEqual(STUDIO_INITIAL_LAYOUT.dock);
  expect(dockPanels(session.dock())).toContain("head");
  expect(state.uiPreferences).toEqual(legacy);
  const empty = structuredClone(state);
  empty.uiPreferences.layout = { format: "xfs/dock", version: 1, state: { wide: { root: null, floating: [], closed: [] }, compact: { root: null, floating: [], closed: [] } } };
  const snap = migrationSnapshot(empty, MODEL, "fresh-default"), answer = await host.send({ token: crypto.randomUUID(), digest: snapshotDigest(snap), snapshot: snap });
  if (!answer.ok) throw Error(answer.reason);
  const deliberatelyEmpty = openSession(buildProfileSession(empty, snap, answer.result, Math.random, STUDIO_INITIAL_LAYOUT));
  expect(deliberatelyEmpty.dock()).toEqual(empty.uiPreferences.layout);
  host.close();
});
