/**
 * The Poses module (pose-library-design.md §6–7, P3): the tree (search across label, category, pack, record and clip; the game's outfit
 * filter with its count; greyed poses with plain reasons), the per-user preferences (lenient parsing, bounded lists) and their host store
 * (revision guard, verification copy seeded from the person's), and the service (one-click apply through the motion port, favourites and
 * recent written behind, a stored pose restored or dropped, Still and the idle, framing).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPoseTree, defaultPosePreferences, FAVOURITES_GROUP, NOT_INSTALLED, parsePosePreferences, PoseLibraryActions, RECENT_GROUP,
  type PoseLibraryDevice, type PoseMotionPort, type PoseStage } from "../src/features/poses";
import type { PoseListing } from "../src/features/poses/types";
import { CATALOGUE } from "./fixtures/pose-listing";
import { withFavourite, withRecent, RECENT_LIMIT } from "../src/features/poses/preferences";
import { createPosePreferencesHandler, PosePreferencesStore } from "../src/features/poses/host/preferences-store";


test("the tree: favourites and recent first, categories in the game's order, search across label, category, pack, record and clip", () => {
  let prefs = withFavourite(defaultPosePreferences(), { id: "PhotoModePoses.sera_01", label: "01" }, true);
  prefs = withFavourite(prefs, { id: "PhotoModePoses.gone", label: "Gone pose" }, true);
  prefs = withRecent(prefs, { id: "PhotoModePoses.idle_lean", label: "Léaning" });
  const tree = buildPoseTree(CATALOGUE, prefs, { query: "", wornTags: [], showFiltered: false });
  expect(tree.groups.map(group => [group.id, group.rows.map(row => row.id)])).toEqual([
    [FAVOURITES_GROUP, ["PhotoModePoses.gone", "PhotoModePoses.sera_01"]], [RECENT_GROUP, ["PhotoModePoses.idle_lean"]],
    ["idleCategory", ["PhotoModePoses.idle_stand_01", "PhotoModePoses.idle_lean"]], ["PhotoModePoseCategories.sera", ["PhotoModePoses.sera_01", "PhotoModePoses.sera_02"]]]);
  // A favourite whose pack is gone stays, greyed; a pose without its clip is listed but greyed with a plain reason.
  expect(tree.groups[0]!.rows[0]).toMatchObject({ label: "Gone pose", unavailable: NOT_INSTALLED });
  expect(tree.groups[3]!.rows[1]!.unavailable).toContain("isn't installed");
  expect(tree.groups[3]!.pack).toBe("Serene Poses");
  const search = (query: string) => buildPoseTree(CATALOGUE, defaultPosePreferences(), { query, wornTags: [], showFiltered: false }).groups.flatMap(group => group.rows.map(row => row.id));
  expect(search("leaning")).toEqual(["PhotoModePoses.idle_lean"]); // accents fold
  expect(search("serene 02")).toEqual(["PhotoModePoses.sera_02"]); // pack plus label, any order
  expect(search("idle stand")).toEqual(["PhotoModePoses.idle_stand_01"]); // category plus record
  expect(search("sera_01_clip")).toEqual(["PhotoModePoses.sera_01"]); // clip name
  expect(search("nothing like it")).toEqual([]);
});

test("the outfit filter hides what the game hides, everywhere, and counts it; Show them lists them again", () => {
  const prefs = withRecent(defaultPosePreferences(), { id: "PhotoModePoses.idle_stand_01", label: "Standing" });
  const hidden = buildPoseTree(CATALOGUE, prefs, { query: "", wornTags: ["Coat", "Tight"], showFiltered: false });
  expect(hidden.groups.flatMap(group => group.rows.map(row => row.id))).not.toContain("PhotoModePoses.idle_stand_01");
  expect(hidden).toMatchObject({ hiddenByOutfit: 1, hidingTags: ["Coat"] });
  const shown = buildPoseTree(CATALOGUE, prefs, { query: "", wornTags: ["Coat"], showFiltered: true });
  expect(shown.groups.flatMap(group => group.rows.map(row => row.id)).filter(id => id === "PhotoModePoses.idle_stand_01")).toHaveLength(2);
  expect(shown.hiddenByOutfit).toBe(1);
});

test("preferences parse leniently and stay bounded", () => {
  expect(parsePosePreferences(null)).toEqual(defaultPosePreferences());
  const parsed = parsePosePreferences({ schema: "xfs/pose-preferences-1", favourites: [{ id: "PhotoModePoses.a", label: "A" }, { id: "bad id!", label: "x" },
    { id: "PhotoModePoses.a", label: "again" }, { id: "PhotoModePoses.b", label: 7 }], recent: "no", open: ["idleCategory", 3] });
  expect(parsed).toEqual({ schema: "xfs/pose-preferences-1", favourites: [{ id: "PhotoModePoses.a", label: "A" }, { id: "PhotoModePoses.b", label: "PhotoModePoses.b" }],
    recent: [], open: ["idleCategory"] });
  let prefs = defaultPosePreferences();
  for (let i = 0; i < 20; i++) prefs = withRecent(prefs, { id: `PhotoModePoses.p${i}`, label: `${i}` });
  expect(prefs.recent).toHaveLength(RECENT_LIMIT);
  expect(prefs.recent[0]!.id).toBe("PhotoModePoses.p19");
});

test("the host store keeps one document per user behind a revision guard; the verification copy starts from it and keeps its changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-pose-prefs-"));
  try {
    const store = new PosePreferencesStore(join(dir, "user"));
    const handler = createPosePreferencesHandler(store);
    const base = "http://127.0.0.1:4999/api/pose-preferences";
    const state = await (await handler(new Request(base))).json() as { revision: number; preferences: unknown };
    expect(state.revision).toBe(0);
    const prefs = withFavourite(defaultPosePreferences(), { id: "PhotoModePoses.a", label: "A" }, true);
    const post = (revision: number, body = prefs) => handler(new Request(base, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:4999" },
      body: JSON.stringify({ revision, preferences: body }) }));
    const saved = await post(0);
    expect(saved.status).toBe(200);
    expect((await saved.json() as { revision: number }).revision).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "user", "pose-preferences.json"), "utf8")).favourites).toEqual([{ id: "PhotoModePoses.a", label: "A" }]);
    // A stale window is refused with the current document.
    const stale = await post(0, defaultPosePreferences());
    expect(stale.status).toBe(409);
    expect((await stale.json() as { preferences: { favourites: unknown[] } }).preferences.favourites).toHaveLength(1);
    // A foreign origin is refused.
    expect((await handler(new Request(base, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.test" }, body: "{}" }))).status).toBe(403);
    // The verification copy starts from the person's and never writes it.
    const verification = new PosePreferencesStore(join(dir, "verify"), { seed: () => store.load().preferences });
    expect(verification.load().preferences.favourites).toHaveLength(1);
    verification.save(0, defaultPosePreferences());
    expect(store.load().preferences.favourites).toHaveLength(1);
    // A damaged file reads as the defaults.
    writeFileSync(join(dir, "user", "pose-preferences.json"), "{nope");
    expect(new PosePreferencesStore(join(dir, "user")).load().preferences).toEqual(defaultPosePreferences());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

type Held = { id: string; label: string; moves: boolean };
function fakeMotion(options: { pending?: { id: string; label: string } } = {}) {
  const calls: string[] = [];
  let pose: Held | null = null, loading = false, pending = options.pending ?? null, idle = true;
  const listeners = new Set<() => void>();
  const port: PoseMotionPort = {
    snapshot: () => ({ idle, pose: pose ?? (pending ? { ...pending, moves: false } : null), poseLoading: loading || !!pending }),
    poseCapability: () => ({ available: true }),
    holdPose: async (next, sample, placement) => {
      pose = next; pending = null; loading = true;
      try { const value = await sample; calls.push(`hold ${value.id} ${JSON.stringify(placement?.offset)}`); return true; }
      catch (error) { pose = null; throw error; } finally { loading = false; }
    },
    pendingPose: () => pending, dropPendingPose: () => { pending = null; calls.push("drop"); },
    bodyCapability: () => ({ available: true }),
    setBody: on => { idle = on; pose = null; calls.push(on ? "idle" : "still"); },
  };
  return { port, calls, listeners };
}
function harness(options: { pending?: { id: string; label: string }; catalogue?: PoseListing; phases?: string[] } = {}) {
  const motion = fakeMotion(options);
  const listeners = new Set<() => void>();
  const stage: PoseStage = { bodyGender: () => "female", wornTags: () => [], motion: () => motion.port, frame: () => { motion.calls.push("frame"); return { available: true }; },
    frameCapability: () => ({ available: true }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  const phases = [...(options.phases ?? [])];
  const saved: unknown[] = [];
  const device: PoseLibraryDevice = {
    catalogue: async request => {
      if (request.method === "POST") return { ok: true, status: 200, data: {} };
      if (request.query.pose) {
        if (request.query.pose === "PhotoModePoses.idle_lean") return { ok: false, status: 404, data: { code: "missing_target", error: "That pose's animation isn't installed or can't be read." } };
        return { ok: true, status: 200, data: { schema: "xfs/pose-sample-1", id: request.query.pose } };
      }
      const phase = phases.shift() ?? "ready";
      return { ok: true, status: 200, data: phase === "ready" ? { schema: "xfs/pose-catalogue-state-1", phase, message: "", catalogue: options.catalogue ?? CATALOGUE }
        : { schema: "xfs/pose-catalogue-state-1", phase, message: phase === "preparing" ? "Reading your game's photo-mode poses…" : "Choose your game folder." } };
    },
    preferences: {
      load: async () => ({ schema: "xfs/pose-preferences-state-1", revision: 3, preferences: defaultPosePreferences() }),
      save: async (revision, preferences) => { saved.push({ revision, preferences }); return { ok: true, status: 200, data: { revision: revision + 1, preferences } }; },
    },
    wait: () => Promise.resolve(),
  };
  const service = new PoseLibraryActions(device, stage);
  return { service, motion, saved, notifyStage: () => { for (const listener of listeners) listener(); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test("the service reads the catalogue for V's body, applies a pose in one click with its placement, and records it in Recent", async () => {
  const { service, motion, saved } = harness({ phases: ["preparing"] });
  await settle();
  expect(service.snapshot().catalogue).toMatchObject({ phase: "ready", bodyGender: "female", listed: 4, categories: 2 });
  expect(service.capability({ kind: "pose.select", id: "PhotoModePoses.sera_02" })).toMatchObject({ available: false, reason: expect.stringContaining("isn't installed") });
  expect(service.capability({ kind: "pose.select", id: "PhotoModePoses.nowhere" }).available).toBe(false);
  expect(await service.dispatch({ kind: "pose.select", id: "PhotoModePoses.sera_01" })).toEqual({ ok: true });
  expect(motion.calls).toEqual(["hold PhotoModePoses.sera_01 [0,0,0]"]);
  expect(service.snapshot()).toMatchObject({ current: { id: "PhotoModePoses.sera_01", label: "01", loading: false }, body: "pose" });
  expect(service.snapshot().preferences.recent).toEqual([{ id: "PhotoModePoses.sera_01", label: "01" }]);
  await settle();
  expect(saved.at(-1)).toMatchObject({ revision: 3 });
  // A clip the host can't read says so and leaves the body source as it was.
  const failed = await service.dispatch({ kind: "pose.select", id: "PhotoModePoses.idle_lean" });
  expect(failed).toMatchObject({ ok: false, message: expect.stringContaining("isn't installed") });
});

test("favourites, open groups and the outfit override change at once; Still, the idle and Frame V go through the stage", async () => {
  const { service, motion, saved } = harness();
  await settle();
  await service.dispatch({ kind: "pose.favourite", id: "PhotoModePoses.idle_lean", on: true });
  expect(service.snapshot().preferences.favourites).toEqual([{ id: "PhotoModePoses.idle_lean", label: "Léaning" }]);
  expect(service.tree().groups[0]!.id).toBe(FAVOURITES_GROUP);
  await service.dispatch({ kind: "pose.openGroup", group: "idleCategory", open: true });
  expect(service.snapshot().preferences.open).toContain("idleCategory");
  await settle();
  expect(saved.length).toBeGreaterThan(0);
  expect(service.capability({ kind: "pose.favourite", id: "PhotoModePoses.nowhere", on: true }).available).toBe(false);
  await service.dispatch({ kind: "pose.showFiltered", shown: true });
  expect(service.snapshot().showFiltered).toBe(true);
  await service.dispatch({ kind: "pose.clear", to: "still" });
  await service.dispatch({ kind: "pose.frame" });
  expect(motion.calls).toEqual(["still", "frame"]);
  expect(service.capability({ kind: "pose.retry" }).available).toBe(false);
});

test("a stored pose plays again once the catalogue is ready, without joining Recent; one no longer installed is dropped", async () => {
  const kept = harness({ pending: { id: "PhotoModePoses.sera_01", label: "01" } });
  await settle();
  expect(kept.motion.calls).toEqual(["hold PhotoModePoses.sera_01 [0,0,0]"]);
  expect(kept.service.snapshot().preferences.recent).toEqual([]);
  const gone = harness({ pending: { id: "PhotoModePoses.gone", label: "Gone" } });
  await settle();
  expect(gone.motion.calls).toEqual(["drop"]);
  // Without a game folder the stored pose is dropped too, and the state says what to do.
  const setup = harness({ pending: { id: "PhotoModePoses.sera_01", label: "01" }, phases: ["needs-setup"] });
  await settle();
  expect(setup.service.snapshot().catalogue).toMatchObject({ phase: "needs-setup", message: "Choose your game folder." });
  expect(setup.motion.calls).toEqual(["drop"]);
});

describe("pose preferences survive an early change and a host restart (CORE-112, CORE-114)", () => {
  const stage: PoseStage = { bodyGender: () => null, wornTags: () => [], motion: () => null, frame: () => ({ available: true }), frameCapability: () => ({ available: true }),
    subscribe: () => () => {} } as unknown as PoseStage;
  const stored = withFavourite(defaultPosePreferences(), { id: "PhotoModePoses.kept", label: "Kept" }, true);

  test("a change made before the document loads goes on top of the stored favourites, never over them", async () => {
    let release!: () => void;
    const loaded = new Promise<void>(resolve => { release = resolve; });
    const saved: { revision: number; favourites: string[]; open: readonly string[] }[] = [];
    const device: PoseLibraryDevice = { preferences: {
      load: async () => { await loaded; return { schema: "xfs/pose-preferences-state-1", revision: 7, preferences: stored }; },
      save: async (revision, preferences) => { saved.push({ revision, favourites: preferences.favourites.map(item => item.id), open: preferences.open }); return { ok: true, status: 200, data: { revision: revision + 1, preferences } }; },
    } } as PoseLibraryDevice;
    const service = new PoseLibraryActions(device, stage);
    expect(await service.dispatch({ kind: "pose.openGroup", group: "idleCategory", open: true })).toEqual({ ok: true });
    expect(saved).toEqual([]);
    release();
    await settle();
    expect(saved).toEqual([{ revision: 7, favourites: ["PhotoModePoses.kept"], open: [FAVOURITES_GROUP, RECENT_GROUP, "idleCategory"] }]);
    expect(service.snapshot().preferences.favourites.map(item => item.id)).toEqual(["PhotoModePoses.kept"]);
  });

  test("a 409 re-applies the change on the host's document and writes it once more", async () => {
    const saved: number[] = [];
    let hostRevision = 0;
    const device: PoseLibraryDevice = { preferences: {
      load: async () => ({ schema: "xfs/pose-preferences-state-1", revision: 5, preferences: defaultPosePreferences() }),
      save: async (revision, preferences) => {
        saved.push(revision);
        if (revision !== hostRevision) return { ok: false, status: 409, data: { revision: hostRevision, preferences: stored } };
        return { ok: true, status: 200, data: { revision: ++hostRevision, preferences } };
      },
    } } as PoseLibraryDevice;
    const service = new PoseLibraryActions(device, stage);
    await settle();
    expect(await service.dispatch({ kind: "pose.openGroup", group: "idleCategory", open: true })).toEqual({ ok: true });
    await settle();
    expect(saved).toEqual([5, 0]);
    expect(service.snapshot().preferences).toMatchObject({ favourites: [{ id: "PhotoModePoses.kept" }], open: [FAVOURITES_GROUP, RECENT_GROUP, "idleCategory"] });
  });

  test("the host store keeps its revision across a restart, refuses a document that isn't one, and reads a body within its limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xfs-pose-prefs-"));
    try {
      const first = new PosePreferencesStore(dir);
      expect(first.save(0, stored)).toMatchObject({ ok: true, state: { revision: 1 } });
      expect(first.save(1, stored)).toMatchObject({ ok: true, state: { revision: 2 } });
      // A new host process goes on from the file's revision: the page's next change (revision 2) is accepted.
      const restarted = new PosePreferencesStore(dir);
      expect(restarted.load().revision).toBe(2);
      expect(restarted.save(2, defaultPosePreferences()).ok).toBe(true);
      const handler = createPosePreferencesHandler(restarted);
      const base = "http://127.0.0.1:4999/api/pose-preferences";
      const post = (body: string) => handler(new Request(base, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:4999" }, body }));
      for (const preferences of [null, [], "x", { schema: "something-else", favourites: [] }]) {
        const refused = await post(JSON.stringify({ revision: 3, preferences }));
        expect(refused.status).toBe(400);
      }
      expect(restarted.load()).toMatchObject({ revision: 3, preferences: defaultPosePreferences() });
      expect((await post(JSON.stringify({ revision: 3, preferences: stored, padding: "x".repeat(600 * 1024) }))).status).toBe(413);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
