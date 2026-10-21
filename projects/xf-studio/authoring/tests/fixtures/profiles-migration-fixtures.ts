/**
 * Fixtures for the `profiles-1` migration (profiles design §8): a library as 0.1.0-alpha.2 wrote it, opened by this build, and a workspace
 * shaped like a real one: one V from a save (with creator choices and a clothing setting), one collection with several looks, Undo
 * histories and removed looks, recovery drafts (an earlier draft of the same collection, and other collections), a view graph with two
 * views and the person's own lighting setup, a live dock arrangement with a parked panel, and two saved layouts.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../../src/compose/studio-registry";
import { openLibraryDatabase } from "../../src/library/host/library-files";
import type { LibraryBackups } from "../../src/platform/persistence/backups";
import { DEFAULT_CREATOR_LIGHTING } from "../../src/preview/creator-lighting";
import { builtInSetup, rigKindOf, type SetupLibrary } from "../../src/preview/lighting-setups";
import { defaultViewGraph, lightsNodeState } from "../../src/preview/preview-view-graph";
import type { SavedV } from "../../src/saves/save-reader";
import { serializeWorkspace, type WorkspaceState } from "../../src/app/workspace/workspace-state";
import type { DockLayout } from "../../src/app/ui-preferences";
import { alpha2Open, alpha2Writes } from "./alpha-0.1.0-alpha.2/library-ddl";
import { initialRecipe } from "./eye-region";
import { restore } from "./workspace-observable";
import { fixedId, smallWorkspaceV1 } from "./workspace-v1-fixtures";

export const NOW = "2026-09-27T10:00:00.000Z";
export const MODEL = STUDIO_DOCUMENTS;
/** The collection the workspace's draft edits (saved once, at revision 1, by the released build). */
export const COLLECTION = fixedId(10);
export const RELEASED_TABLES = ["looks", "look_revisions", "collections", "collection_revisions", "collection_preset_versions", "part_presets", "part_preset_sets"];

/** A decoded save of a feminine V (one hairstyle, one morph). */
export function fixtureSave(): SavedV {
  return { schema: "eye-artistry/saved-v-1", saveVersion: 269, gameVersion: 2310, presetVersion: 12, isMale: false, brainIsMale: false,
    groups: { head: [{ name: "hairs", appearances: [{ resourceHash: "1234", definition: "hh_007__basehead", name: "hairs", censorFlag: 0, censorAction: 0 }],
      morphs: [{ region: "nose", target: "nose_type_03", censorFlag: 0, censorAction: 0 }] }], arms: [], body: [] },
    perspectives: [], tags: ["Player"], evidence: { nodeName: "CharacetrCustomization_Appearances", nodeBytes: 100, bytesRead: 100, trailingBytes: 0, chunks: 1,
      decompressedBytes: 1000 } } as SavedV;
}

const dockTree = (groups: { id: string; panels: string[]; active: string }[], closed: string[], parked: Record<string, unknown> = {}) => ({
  root: { kind: "split", id: "s-root", axis: "row", sizes: groups.map(() => 1 / groups.length),
    children: groups.map(group => ({ kind: "group", ...group })) }, floating: [], closed, parked });
/** The live arrangement: the editing panels left, the main view and a second view right, the Poses panel parked with its place. */
export const LIVE_DOCK: DockLayout = { format: "xfs/dock", version: 1, state: {
  wide: dockTree([{ id: "g-1", panels: ["presets", "layers"], active: "layers" }, { id: "g-2", panels: ["head", "view.v2"], active: "head" }], ["character"],
    { poses: { group: ["presets", "poses"], index: 1, active: false } }),
  compact: dockTree([{ id: "g-3", panels: ["head", "presets", "layers", "view.v2"], active: "head" }], ["character"]) } as never };
const EDITING_DOCK: DockLayout = { format: "xfs/dock", version: 1, state: {
  wide: dockTree([{ id: "g-1", panels: ["presets", "layers"], active: "presets" }, { id: "g-2", panels: ["head"], active: "head" }], []),
  compact: dockTree([{ id: "g-3", panels: ["head", "presets", "layers"], active: "head" }], []) } as never };
const PREVIEW_DOCK: DockLayout = { format: "xfs/dock", version: 1, state: {
  wide: dockTree([{ id: "g-1", panels: ["head", "view.v2"], active: "view.v2" }], ["presets", "layers"]),
  compact: dockTree([{ id: "g-2", panels: ["head"], active: "head" }], ["presets", "layers", "view.v2"]) } as never };

/** The person's own lighting setup ("Warm key", from Soft studio), shown. */
export const OWN_SETUPS: SetupLibrary = { setup: "u1", setups: [{ id: "u1", name: "Warm key", base: "soft",
  setup: { ...builtInSetup("soft", "female", DEFAULT_CREATOR_LIGHTING), exposure: 1.3 } }] };

/**
 * A workspace like a real one (see the header). `divergent` renames a look in the draft (another browser's edit); `draftLooks` limits the
 * draft to its first looks.
 */
export function realWorkspace(options: { divergent?: boolean } = {}): WorkspaceState {
  const state = restore(smallWorkspaceV1()).state;
  const collections = state.collections!;
  // The draft was opened from the named version at revision 1 and edited since: a look added (a copy of the first, renamed).
  collections.revision = 1;
  state.library = { selected: collections.collection.presets[0]!.id, name: "Optics", current: { id: COLLECTION, revision: 1 } };
  const first = collections.collection.presets[0]!;
  collections.collection.presets.push({ ...structuredClone(first), id: fixedId(77), name: "New since saving", revision: 1 });
  // The other browser renamed a look and shows it, so its scene must resolve to its own renamed look, in its fork.
  if (options.divergent) {
    collections.collection.presets[1] = { ...collections.collection.presets[1]!, name: "Glitters (edited in the other browser)" };
    collections.selected = collections.collection.presets[1]!.id;
  }
  // A recovery draft of the same collection, as it was before the look was added.
  const earlier = structuredClone({ collection: { ...collections.collection, presets: collections.collection.presets.slice(0, 2) }, revision: 1,
    selected: first.id, memory: {}, removed: [] });
  collections.older = [earlier, ...(collections.older ?? [])];
  // The V, from a save, with creator choices and a clothing setting.
  state.savedV = fixtureSave();
  state.preview.character = { origin: "save", choices: [{ part: "head", option: "hairs", choice: "hh_033" }, { part: "head", option: "eyes", choice: "eyes_04" }],
    clothing: { state: "custom", custom: ["Head", "Face", "Outfit", "Legs", "Feet"] } } as never;
  // Lighting: the person's own setup shown; motion and a held pose.
  state.preview.lightingSetups = OWN_SETUPS;
  state.preview.lightingPreset = rigKindOf(OWN_SETUPS);
  state.preview.idle = true; state.preview.idleClip = "relaxed"; state.preview.pose = { id: "pose_fixture", label: "Fixture pose" };
  // A second view: its own camera and its own lights (the creator rig), sharing the main view's scene.
  const graph = defaultViewGraph(state.preview);
  const creator: SetupLibrary = { setup: "creator", setups: [] };
  state.views = { ...graph, views: [...graph.views, { id: "v2", kind: "3d", title: "Side", scene: "s1", camera: "c2", lights: "l2", display: "d1", tools: "t1" }],
    cameras: [...graph.cameras, { id: "c2", kind: "orbit", pose: { position: [0.4, 1.7, 0.3], target: [0, 1.68, 0], fov: 25 } }],
    lights: [...graph.lights, { id: "l2", kind: rigKindOf(creator), ...lightsNodeState(creator, DEFAULT_CREATOR_LIGHTING) }], focused: "v2" };
  // The live arrangement and two saved layouts (the inactive one with an automatic size class and a working state).
  state.uiPreferences = { ...state.uiPreferences, layout: LIVE_DOCK, modules: { poses: false }, layouts: { schema: "xfs/layout-library-1", active: "l1", seen: "wide",
    layouts: [{ id: "l1", name: "Editing", dock: EDITING_DOCK }, { id: "l2", name: "Preview", dock: PREVIEW_DOCK, autoSize: "compact",
      working: { dock: LIVE_DOCK, modules: { poses: true } } }] } };
  return state;
}

/** The workspace's stored text, as the Studio writes it. */
export const storedText = (state: WorkspaceState) => JSON.stringify(serializeWorkspace(state, MODEL));
/** A stored workspace read back. */
export const readStored = (text: string) => restore(text).state;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/**
 * A library as 0.1.0-alpha.2 wrote it: a look, a part preset and a set, and the workspace's collection at revision 1 (its first two
 * looks, as they were saved), then opened by this build (which adds the `documents` table and nothing else).
 */
export function alpha2Library(path: string, backups?: LibraryBackups | null): void {
  const db = alpha2Open(path);
  try {
    alpha2Writes(db, uuid, JSON.stringify(initialRecipe()), NOW);
    const draft = realWorkspace().collections!.collection;
    const saved = STUDIO_PARTS.writeMinimal({ ...draft, presets: draft.presets.slice(0, 2) });
    db.query("INSERT INTO collections VALUES (?, ?)").run(saved.id, NOW);
    db.query("INSERT INTO collection_revisions VALUES (?, 1, ?, ?)").run(saved.id, JSON.stringify(saved), NOW);
    for (const preset of saved.presets) db.query("INSERT INTO collection_preset_versions VALUES (?, ?, ?, ?)").run(saved.id, preset.id, (preset as { revision?: number }).revision ?? 1, JSON.stringify(preset));
  } finally { db.close(); }
  openLibraryDatabase(path, { backups: backups ?? null }).close();
}

/** A named version saved by the older build (0.1.0-alpha.2's own statements), with one look renamed. */
export function alpha2SaveNamed(path: string, revision: number, rename: string): void {
  const draft = realWorkspace().collections!.collection;
  const named = { ...draft, presets: draft.presets.slice(0, 3).map((look, i) => i === 1 ? { ...look, name: rename } : look) };
  const db = alpha2Open(path);
  try {
    const stored = STUDIO_PARTS.writeMinimal(named);
    db.query("INSERT INTO collection_revisions VALUES (?, ?, ?, ?)").run(stored.id, revision, JSON.stringify(stored), NOW);
  } finally { db.close(); }
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
/** The released tables, DDL and every row: equal before and after means the migration never wrote them. */
export function releasedHash(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return sha(RELEASED_TABLES.map(table => {
      const ddl = (db.query("SELECT sql FROM sqlite_master WHERE name = ?").get(table) as { sql: string }).sql;
      return ddl + JSON.stringify(db.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    }).join("\n"));
  } finally { db.close(); }
}
export type DocRow = { kind: string; id: string; revision: number; value: any };
export function documentRows(path: string): DocRow[] {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("SELECT kind, id, revision, value FROM documents ORDER BY kind, id").all() as { kind: string; id: string; revision: number; value: string }[])
      .map(row => ({ ...row, value: JSON.parse(row.value) }));
  } finally { db.close(); }
}
export const documentsHash = (path: string) => sha(JSON.stringify(documentRows(path)));
export function integrity(path: string): string {
  const db = new Database(path, { readonly: true });
  try { return (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check; } finally { db.close(); }
}
