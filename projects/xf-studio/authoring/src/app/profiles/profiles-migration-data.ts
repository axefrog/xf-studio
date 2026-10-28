/**
 * The `profiles-1` migration's data (profiles design §8): what the workspace sends the library, what the library answers, and the pure
 * steps on either side of the library transaction. Pure: the page builds the snapshot and the session here (`profiles-migration.ts`
 * runs the protocol), and the host's transaction (`host/profiles-migrate.ts`) compares content with the functions here.
 *
 * - **The snapshot** is the workspace normalised: the collection draft (or the loose look) first, then the recovery drafts, each look with
 *   its parts and memory in their stored form; the library's `current`; the V as its character document and decoded save; and each saved
 *   layout as an own default's fragment (§4.2).
 * - **The result** names the profile, the character, the draft's collection and the ID map from the draft's look IDs to the
 *   collection's, every own default made from a layout (in the snapshot's order), and what each step did.
 * - **The session** (§8 step 3): tab 1 is the live arrangement with every panel ID turned into a panel instance's; every view is in tab 1;
 *   every character scene shows the migrated V and, through the ID map, the draft's selected look.
 */
import { initialBodyGender } from "../../character/character-context-actions";
import { type CharacterDocument, decodedSaveId, documentOfForm } from "../../character/character-document";
import { canonicalJson, type PartEnvelope } from "../../platform/api";
import type { KeptView, StoredNode, ViewGraphData, ViewRecord } from "../../platform/api/view-graph";
import { MAIN_VIEW, SLOT_COLLECTIONS, VIEW_SLOTS, type ViewSlot } from "../../platform/api/view-graph";
import type { PartRegistry } from "../../platform/core/document";
import { sha256Hex } from "../../platform/core/sha256";
import { lookScope } from "../../platform/core/history-service";
import { LAYOUT_FRAGMENT_SCHEMA, type LayoutFragment } from "../../platform/api/layout-fragment";
import { workspaceViewGraph } from "../../preview/preview-view-graph";
import type { SavedV } from "../../saves/save-reader";
import type { DockLayout, JsonValue, UIPreferences } from "../ui-preferences";
import type { DocumentModel } from "../workspace/collection-workspace";
import { serializeWorkspace, type WorkspaceState as NeutralWorkspace } from "../workspace/workspace-state";
import { lookWorkspace, type WorkspaceState as MakeupWorkspace } from "../workspace/makeup-workspace";
type WorkspaceState = NeutralWorkspace | MakeupWorkspace;
import { type LayoutTab, type PanelInstance, PROFILE_SESSION_SCHEMA, type ProfileSessionData, PROFILES_MIGRATION, type SessionScene, type SessionView,
  WORKSPACE_PROFILES_SCHEMA, type WorkspaceProfiles } from "./profile-session";

export const MIGRATION_DOCUMENT = "migration";
export const migrationRecordId = (token: string) => `${PROFILES_MIGRATION}:${token}`;
export const MIGRATION_SNAPSHOT_SCHEMA = "xfs/profiles-migration-snapshot-1";
export const MIGRATION_RESULT_SCHEMA = "xfs/profiles-migration-1";
export const LAYOUT_DEFAULT_DOCUMENT = "layout-default";
export const LAYOUT_DEFAULT_SCHEMA = "xfs/layout-default-1";
export { LAYOUT_FRAGMENT_SCHEMA, type LayoutFragment };
/** The subject and look slots a migrated fragment has (one V, one look, as today's single-V Studio shows). */
export const FRAGMENT_SUBJECT = "v1", FRAGMENT_LOOK = "look1";

/** A look as the snapshot carries it: parts and memory in their stored form (the workspace's). */
export type MigrationLook = { readonly id: string; readonly name: string; readonly parts: Readonly<Record<string, PartEnvelope>>; readonly memory?: unknown };
/** A collection draft: its looks in order, and the looks removed from it (restorable). `revision`: the named version it came from. */
export type MigrationDraft = { readonly id: string; readonly name: string; readonly revision?: number; readonly packagePlan?: unknown;
  readonly looks: readonly MigrationLook[]; readonly removed: readonly MigrationLook[] };
/** The V: its character document as `character.create` writes it (without an ID), and the decoded save the workspace holds. */
export type MigrationCharacter = { readonly document: Omit<CharacterDocument, "id">; readonly saved?: { readonly id: string; readonly value: SavedV } };
/** A saved layout as an own default; `active`: the layout the live arrangement belongs to (tab 1's origin). */
export type MigrationLayout = { readonly name: string; readonly fragment: LayoutFragment; readonly active?: true };
export type MigrationSnapshot = {
  readonly schema: typeof MIGRATION_SNAPSHOT_SCHEMA;
  /** The workspace's identity (the lease's key): names the loose look's collection. */
  readonly workspace: string;
  /** The draft first (or the loose look, as a collection of one), then the recovery drafts, newest first. */
  readonly drafts: readonly MigrationDraft[];
  /** The draft's selected look. */
  readonly selected?: string;
  /** `library.current`: the named version the draft was opened from. */
  readonly current?: { readonly id: string; readonly revision: number };
  readonly character: MigrationCharacter;
  readonly layouts: readonly MigrationLayout[];
};
/** `digest`: the snapshot's `snapshotDigest`, kept in the result, so the page knows which snapshot a stored result was made from. */
export type MigrationRequest = { readonly token: string; readonly digest: string; readonly snapshot: MigrationSnapshot };
export type MigrationResult = {
  readonly schema: typeof MIGRATION_RESULT_SCHEMA;
  readonly token: string;
  /** The digest of the snapshot this result was made from (`snapshotDigest`). */
  readonly digest: string;
  readonly at: number;
  readonly profile: string;
  readonly character: string;
  /** The draft's collection in the library. */
  readonly collection: string;
  /** Collections this run added to the profile (the draft's first, then a named version brought back as a fork). */
  readonly members: readonly string[];
  /** Each recovery draft's collection, in the snapshot's order (kept in the library; not added to the profile). */
  readonly recovered: readonly string[];
  /** The own default made from (or matching) each layout, in the snapshot's order. */
  readonly defaults: readonly string[];
  /** The draft's collection and look IDs, to the library's. */
  readonly idMap: { readonly collections: Readonly<Record<string, string>>; readonly looks: Readonly<Record<string, string>> };
  /** What each step did (`collection-created`, `collection-forked`, `character-reused`, `profile-created`, …). */
  readonly made: readonly string[];
  /** The pre-migration copy's file name, when this run took it. */
  readonly backup?: string;
};
export type MigrationAnswer = { readonly ok: true; readonly result: MigrationResult } | { readonly ok: false; readonly reason: "superseded" | "refused"; readonly message?: string };

// ---------------------------------------------------------------------------------------------------------------------
// Content comparison (M2, M3): through the part registry, so a part in an older schema compares equal to the same content in the current
// one; names and parts in order; IDs ignored.

/** One look's content: its name and its parts read through the registry (a part this build can't read compares by its stored text). */
export function lookContent(parts: PartRegistry, look: { readonly name: string; readonly parts: Readonly<Record<string, unknown>> }): string {
  let canonical: string;
  try { canonical = parts.canonicalParts(look.parts as Record<string, PartEnvelope>); } catch { canonical = canonicalJson(look.parts); }
  return canonicalJson({ name: look.name, parts: canonical });
}
/** A collection's content key: its looks' contents in order. */
export const contentKey = (parts: PartRegistry, looks: readonly { readonly name: string; readonly parts: Readonly<Record<string, unknown>> }[]) =>
  sha256Hex(`[${looks.map(look => lookContent(parts, look)).join(",")}]`);
/** A snapshot's digest: equal for equal snapshots, whatever their key order. */
export const snapshotDigest = (snapshot: MigrationSnapshot) => sha256Hex(canonicalJson(snapshot));
/** Hash of a canonical JSON value (dock arrangements, character states). */
export const valueKey = (value: unknown) => sha256Hex(canonicalJson(value));

/** A UUID derived from `text` (the loose look's collection and look, so a re-upgrade compares against the same family). */
export function derivedUuid(text: string): string {
  const hex = sha256Hex(text);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex[16]!, 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The snapshot (page side)

type StoredDraft = { collection: { id: string; name: string; presets: { id: string; name: string; parts: Record<string, PartEnvelope> }[]; packagePlan?: unknown };
  revision?: number; selected?: string; memory: Record<string, unknown>; removed: { preset: { id: string; name: string; parts: Record<string, PartEnvelope> }; memory: unknown }[] };
const draftOf = (draft: StoredDraft): MigrationDraft => ({ id: draft.collection.id, name: draft.collection.name,
  ...(draft.revision !== undefined ? { revision: draft.revision } : {}), ...(draft.collection.packagePlan !== undefined ? { packagePlan: draft.collection.packagePlan } : {}),
  looks: draft.collection.presets.map(look => ({ id: look.id, name: look.name, parts: look.parts, ...(draft.memory[look.id] !== undefined ? { memory: draft.memory[look.id] } : {}) })),
  removed: draft.removed.map(entry => ({ id: entry.preset.id, name: entry.preset.name, parts: entry.preset.parts, ...(entry.memory !== undefined ? { memory: entry.memory } : {}) })) });

/** The name a loose look's collection gets. */
export const LOOSE_COLLECTION_NAME = "My looks";

/**
 * The workspace as the migration sends it (§8 step 2): its drafts in their stored form (exactly what the workspace stores, untrimmed),
 * the V, and its saved layouts as fragments. `workspace` is the workspace's identity.
 */
export function migrationSnapshot(state: WorkspaceState, model: DocumentModel, workspace: string): MigrationSnapshot {
  const stored = JSON.parse(JSON.stringify(serializeWorkspace(lookWorkspace(state, model), model))) as { collections?: StoredDraft & { previous?: StoredDraft; older?: StoredDraft[] };
    look?: { parts: Record<string, PartEnvelope>; memory: unknown } };
  const drafts: MigrationDraft[] = [];
  let selected: string | undefined;
  if (stored.collections) {
    const { previous, older, ...current } = stored.collections;
    drafts.push(draftOf(current));
    selected = current.selected;
    for (const draft of [previous, ...(older ?? [])]) if (draft) drafts.push(draftOf(draft));
  } else if (stored.look) {
    // The loose look (no collection yet): a collection of one, whose IDs follow from the workspace, so a second run finds it again.
    const id = derivedUuid(`xfs-loose-collection:${workspace}`), look = derivedUuid(`xfs-loose-look:${workspace}`);
    drafts.push({ id, name: LOOSE_COLLECTION_NAME, looks: [{ id: look, name: state.library.name.trim() || "Look 1", parts: stored.look.parts,
      ...(stored.look.memory !== undefined ? { memory: stored.look.memory } : {}) }], removed: [] });
    selected = look;
  }
  return structuredClone({ schema: MIGRATION_SNAPSHOT_SCHEMA, workspace, drafts, ...(selected ? { selected } : {}),
    ...(state.library.current ? { current: { ...state.library.current } } : {}), character: characterOf(state), layouts: layoutsOf(state) });
}

/** The V as `character.create` makes it: its source, body, choices, clothing and own-makeup setting, and the decoded save it comes from. */
export function characterOf(state: Pick<WorkspaceState, "preview" | "savedV">): MigrationCharacter {
  const stored = state.preview.character ?? null, save = state.savedV;
  const body = initialBodyGender(stored, save);
  const form = stored ?? { origin: save ? "save" as const : "default" as const, choices: [] };
  const decoded = save ? decodedSaveId(save) : null;
  const { id: _id, ...document } = documentOfForm("c-migrating", form, body, form.origin === "save" ? decoded : null);
  // The decoded save is kept even when the V no longer comes from it: it is the save the workspace had loaded.
  // This is transport data, including the decoded save: detach nested clothing/source/save values from the live workspace.
  return JSON.parse(JSON.stringify({ document, ...(save && decoded ? { saved: { id: decoded, value: save } } : {}) })) as MigrationCharacter;
}

// ---------------------------------------------------------------------------------------------------------------------
// Docks: panel IDs, view panels, fragments

/**
 * The panel IDs a dock arrangement names, in both size classes: groups and their active tabs, floating windows, closed panels, parked
 * panels and closed panels' last places (keys, groups and anchors).
 */
export function dockPanels(dock: DockLayout | undefined | null): string[] {
  const found = new Set<string>();
  rewriteDock(dock, id => { found.add(id); return id; });
  return [...found];
}
/**
 * A dock arrangement without the panels `drop` names, in both size classes: gone from their groups (a group left empty goes, a split
 * left with one child is that child, and a split or floating window left empty goes), the closed list, and the parked and last places (as a place's group member or anchor too).
 * A tab saved as a default leaves out the panels of views it no longer holds, which the dock keeps parked.
 */
export function withoutDockPanels(dock: DockLayout, drop: (id: string) => boolean): DockLayout {
  const keep = (value: unknown) => typeof value !== "string" || !drop(value);
  const node = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 16) return value;
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.panels)) {
      const panels = v.panels.filter(keep);
      if (!panels.length) return undefined;
      return { ...v, panels, ...("active" in v && !panels.includes(v.active) ? { active: panels[0] } : {}) };
    }
    if (!Array.isArray(v.children)) return v;
    const kept = v.children.map((child, index) => ({ child: node(child, depth + 1), index })).filter(item => item.child !== undefined);
    if (kept.length <= 1) return kept[0]?.child;
    const sizes = Array.isArray(v.sizes) ? kept.map(item => (v.sizes as unknown[])[item.index]) : v.sizes;
    return { ...v, children: kept.map(item => item.child), ...(sizes !== undefined ? { sizes } : {}) };
  };
  const place = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>, anchor = v.anchor as Record<string, unknown> | undefined;
    const out: Record<string, unknown> = { ...v, ...(Array.isArray(v.group) ? { group: v.group.filter(keep) } : {}) };
    if (anchor && typeof anchor === "object" && !keep(anchor.panel)) delete out.anchor;
    return out;
  };
  const tree = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>;
    const root = node(v.root, 0);
    return { ...v, ...("root" in v ? { root: root ?? null } : {}),
      ...(Array.isArray(v.floating) ? { floating: v.floating.flatMap(window => {
        if (!window || typeof window !== "object") return [window];
        const inner = node((window as Record<string, unknown>).node, 0);
        return inner === undefined ? [] : [{ ...window, node: inner }];
      }) } : {}),
      ...(Array.isArray(v.closed) ? { closed: v.closed.filter(keep) } : {}),
      ...Object.fromEntries((["parked", "lastPlace"] as const).flatMap(key => {
        const places = v[key];
        return places && typeof places === "object" && !Array.isArray(places)
          ? [[key, Object.fromEntries(Object.entries(places).filter(([panel]) => keep(panel)).map(([panel, item]) => [panel, place(item)]))]] : [];
      })) };
  };
  const state = dock.state as Record<string, unknown> | null;
  if (!state || typeof state !== "object" || Array.isArray(state)) return structuredClone(dock);
  return { ...dock, state: Object.fromEntries(Object.entries(state).map(([size, value]) => [size, tree(value)])) as unknown as JsonValue };
}
/** A dock arrangement with every panel ID passed through `rename`. */
export function rewriteDock(dock: DockLayout | undefined | null, rename: (id: string) => string): DockLayout | null {
  if (!dock || typeof dock !== "object") return null;
  const id = (value: unknown) => typeof value === "string" ? rename(value) : value;
  const node = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 16) return value;
    const v = value as Record<string, unknown>;
    return { ...v, ...(Array.isArray(v.panels) ? { panels: v.panels.map(id) } : {}), ...(v.kind === "group" && "active" in v ? { active: id(v.active) } : {}),
      ...(Array.isArray(v.children) ? { children: v.children.map(child => node(child, depth + 1)) } : {}) };
  };
  const place = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>, anchor = v.anchor as Record<string, unknown> | undefined;
    return { ...v, ...(Array.isArray(v.group) ? { group: v.group.map(id) } : {}),
      ...(anchor && typeof anchor === "object" ? { anchor: { ...anchor, panel: id(anchor.panel) } } : {}) };
  };
  const tree = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const v = value as Record<string, unknown>;
    return { ...v, root: node(v.root, 0),
      ...(Array.isArray(v.floating) ? { floating: v.floating.map(window => window && typeof window === "object" ? { ...window, node: node((window as Record<string, unknown>).node, 0) } : window) } : {}),
      ...(Array.isArray(v.closed) ? { closed: v.closed.map(id) } : {}),
      // Parked panels (a hidden module's) and closed panels' last places: keyed by panel, each place naming its group and anchor panels.
      ...Object.fromEntries((["parked", "lastPlace"] as const).flatMap(key => {
        const places = v[key];
        return places && typeof places === "object" && !Array.isArray(places)
          ? [[key, Object.fromEntries(Object.entries(places).map(([panel, item]) => [rename(panel), place(item)]))]] : [];
      })) };
  };
  const state = dock.state as Record<string, unknown> | null;
  if (!state || typeof state !== "object" || Array.isArray(state)) return structuredClone(dock);
  return { ...dock, state: Object.fromEntries(Object.entries(state).map(([size, value]) => [size, tree(value)])) as unknown as JsonValue };
}
/** The view a dock panel shows (`head` is the main view's panel, `view.<id>` another's), or null for any other panel. */
export const viewOfPanel = (panel: string): string | null => panel === "head" ? MAIN_VIEW : panel.startsWith("view.") ? panel.slice(5) : null;

const nodeState = (node: StoredNode) => { const { id: _id, kind: _kind, ...state } = node; return state; };
/**
 * A saved layout as a fragment (§4.2): its dock with view panels as `view:<view>`, every view it shows with the nodes those views use (the
 * graph's values, keys the node IDs), each character scene's subject and look as the fragment's slots, and its other panels by type.
 */
export function layoutFragment(name: string, dock: DockLayout, graph: ViewGraphData): LayoutFragment {
  const panels = dockPanels(dock), shown = new Set(panels.flatMap(panel => { const view = viewOfPanel(panel); return view ? [view] : []; }));
  const views = graph.views.filter((view): view is ViewRecord => shown.has(view.id) && VIEW_SLOTS.every(slot => typeof (view as Record<string, unknown>)[slot] === "string"));
  const nodes: LayoutFragment["nodes"][number][] = [], seen = new Set<string>();
  let character = false;
  for (const view of views) for (const slot of VIEW_SLOTS) {
    const id = view[slot], key = `${slot}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = (graph[SLOT_COLLECTIONS[slot]] as readonly StoredNode[]).find(item => item.id === id);
    if (!node) continue;
    const scene = slot === "scene" && node.kind === "character";
    character ||= scene;
    nodes.push({ key: id, slot, ...(node.kind !== undefined ? { kind: node.kind } : {}), state: structuredClone(nodeState(node)),
      ...(scene ? { subject: FRAGMENT_SUBJECT, look: FRAGMENT_LOOK } : {}) });
  }
  return structuredClone({ schema: LAYOUT_FRAGMENT_SCHEMA,
    tab: { name, dock: rewriteDock(dock, panel => { const view = viewOfPanel(panel); return view ? `view:${view}` : panel; })! },
    subjects: character ? [{ key: FRAGMENT_SUBJECT, kinds: ["character"] }] : [], looks: character ? [{ key: FRAGMENT_LOOK }] : [], nodes,
    views: views.map(view => ({ key: view.id, ...(view.title !== undefined ? { title: view.title } : {}),
      scene: view.scene, camera: view.camera, lights: view.lights, display: view.display, tools: view.tools })),
    panels: panels.filter(panel => !viewOfPanel(panel)).map(panel => ({ key: panel, type: panel })) });
}
/** The saved layouts as own defaults: each layout's saved arrangement (an inactive layout's working state is dropped, §8). */
function layoutsOf(state: WorkspaceState): MigrationLayout[] {
  const library = state.uiPreferences.layouts;
  if (!library) return [];
  const graph = workspaceViewGraph(state.preview, state.views);
  return library.layouts.map(layout => ({ name: layout.name, fragment: layoutFragment(layout.name, layout.dock, graph),
    ...(layout.id === library.active ? { active: true as const } : {}) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// The session (page side, §8 step 3)

const base36 = (random: () => number, length = 8) => Array.from({ length }, () => Math.floor(random() * 36).toString(36)).join("");
/** The name tab 1 gets when the person never saved a layout. */
export const FIRST_TAB_NAME = "Layout 1";
/** The contributed baseline and the dock adapter that restores legacy enabled modules during the one-time conversion. */
export type InitialProfileLayout = {
  readonly origin: string;
  readonly dock: DockLayout;
  legacyDock?(dock: DockLayout, preferences: UIPreferences): DockLayout;
};

/**
 * The session the workspace builds from the library's result (§8 step 3): tab 1 holds the live arrangement, its panels turned into
 * instances (a view's panel pinned to its view); every view is in tab 1; every character scene shows the V and, through the ID map, the
 * draft's selected look.
 */
export function buildProfileSession(state: WorkspaceState, snapshot: Pick<MigrationSnapshot, "selected" | "layouts">, result: MigrationResult,
  random: () => number = Math.random, initial?: InitialProfileLayout): ProfileSessionData {
  const active = snapshot.layouts.findIndex(layout => layout.active);
  const lookId = snapshot.selected ? result.idMap.looks[snapshot.selected] : undefined;
  return sessionOfWorkspace(state, { tab: active >= 0 ? snapshot.layouts[active]!.name : FIRST_TAB_NAME,
    ...(active >= 0 && result.defaults[active] ? { origin: result.defaults[active] } : {}), character: result.character,
    ...(lookId ? { look: { collection: result.collection, look: lookId } } : {}) }, random, initial);
}
/**
 * A session made from the workspace's live arrangement and view graph: tab 1 (named `tab`, made from the own default `origin`) holds the
 * arrangement with its panels as instances; every view is in tab 1; every character scene shows `character` and `look`. Its editing
 * context (§3.7) is the look's history, so Undo reaches it as it did before the session existed.
 */
export function sessionOfWorkspace(state: Pick<WorkspaceState, "preview" | "views" | "uiPreferences">, input: { tab: string; origin?: string; character?: string; look?: { collection: string; look: string } },
  random: () => number = Math.random, initial?: InitialProfileLayout): ProfileSessionData {
  const tab = `t-${base36(random)}`;
  const base = state.uiPreferences.layout ?? initial?.dock ?? null;
  const live = base && initial?.legacyDock ? initial.legacyDock(base, state.uiPreferences) : base;
  const instances = new Map<string, PanelInstance>();
  for (const panel of dockPanels(live)) {
    const view = viewOfPanel(panel);
    instances.set(panel, view ? { id: `view--${base36(random)}`, type: "view", binding: { policy: "pinned", target: { view } } }
      : { id: `${panel}--${base36(random)}`, type: panel });
  }
  const origin = input.origin ?? (!state.uiPreferences.layout ? initial?.origin : undefined);
  const tabValue: LayoutTab = { id: tab, name: input.tab, ...(origin ? { origin } : {}),
    dock: rewriteDock(live, panel => instances.get(panel)?.id ?? panel), panels: [...instances.values()] };
  const graph = workspaceViewGraph(state.preview, state.views), look = input.look;
  const scenes: SessionScene[] = graph.scenes.map(scene => scene.kind === "character"
    ? { ...scene, ...(input.character ? { subject: { kind: "character", id: input.character } } : {}), ...(look ? { look } : {}), gen: 0 } : { ...scene, gen: 0 });
  const views: SessionView[] = graph.views.map(view => ({ ...(view as ViewRecord | KeptView), tab }));
  return { schema: PROFILE_SESSION_SCHEMA, tabs: [tabValue], views: { ...graph, views, scenes },
    focus: { views: graph.focused !== undefined ? { [graph.focused]: 1 } : {}, ...(look ? { editing: lookScope(look) } : {}) }, closed: [],
    seq: graph.focused !== undefined ? 1 : 0 };
}
/** The workspace's `profiles` holding one session. */
export const workspaceProfiles = (profile: string, session: ProfileSessionData): WorkspaceProfiles =>
  ({ schema: WORKSPACE_PROFILES_SCHEMA, sessions: { [profile]: session } });
