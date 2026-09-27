/**
 * The view graph's data (research/authoring/view-graph-design.md §3): what each 3D view shows, and how views share it. A view
 * references one node of each slot type (scene, camera, lights, display, tools); linking points two views at one node, unlinking
 * copies it. The graph service (`platform/core/view-graph.ts`) owns this data; types and small pure helpers only.
 *
 * Node state is plain data the composition describes (its codecs): the platform knows the structure (identities, references,
 * sharing, validity, history), never what a camera pose or a light rig means.
 */

/** A view's identity. `main` is the first 3D view, shown in the dock panel `head`; other views use `view.<id>` panels. */
export type ViewId = string;
/** The one view every graph has; it cannot be closed. */
export const MAIN_VIEW: ViewId = "main";
/** The node types a view references, one of each. */
export const VIEW_SLOTS = ["scene", "camera", "lights", "display", "tools"] as const;
export type ViewSlot = typeof VIEW_SLOTS[number];
/** What a scene draws: a V (`character`) or a module-registered kind (World's `location`, later). */
export type SceneKind = "character" | (string & {});
/** How a camera moves: `orbit` now; `fly` and a runtime-bridge `game` camera later. */
export type CameraKind = "orbit" | (string & {});
/** A light rig: the Studio stage (`studio`) or the game's creator lights (`creator`); modules may add kinds (`sun`). */
export type RigKind = "studio" | "creator" | (string & {});

/** One node: its identity, its kind within its slot (a scene's, camera's or rig's; display and tools have none) and its state. */
export type GraphNode = { readonly id: string; readonly kind?: string; readonly state: Readonly<Record<string, unknown>> };
/** One view: one node reference per slot. `title` is the name a person gave it (absent: derived from its scene). */
export type ViewRecord = { readonly id: ViewId; readonly kind: "3d"; readonly title?: string } & { readonly [S in ViewSlot]: string };
/**
 * A view this build can't show, kept as stored: a newer build's view kind (a `map2d`), or a 3D view whose scene, camera or rig kind
 * this build doesn't know (a World `location`). The graph writes it back unchanged and keeps the nodes it references alive; it is
 * never drawn, listed or edited here, so opening a workspace in an older build never erases a newer build's views.
 */
export type KeptView = { readonly id: ViewId; readonly kind: string } & Readonly<Record<string, unknown>>;

export const VIEW_GRAPH_1 = "xfs/view-graph-1";
/** Where each slot's nodes are stored in `xfs/view-graph-1`. */
export const SLOT_COLLECTIONS = { scene: "scenes", camera: "cameras", lights: "lights", display: "display", tools: "tools" } as const;
/**
 * The stored graph: views and their nodes, each node as `{ id, kind?, ...state }`, and which view has focus. Written into the
 * workspace (`views`) only when it differs from the default one-view graph, so a workspace that never adds a view keeps its bytes.
 */
export type ViewGraphData = {
  readonly schema: typeof VIEW_GRAPH_1;
  /** The views, in their stored order: those this build shows, and any it keeps unchanged (`KeptView`). */
  readonly views: readonly (ViewRecord | KeptView)[];
  readonly scenes: readonly StoredNode[]; readonly cameras: readonly StoredNode[]; readonly lights: readonly StoredNode[];
  readonly display: readonly StoredNode[]; readonly tools: readonly StoredNode[];
  readonly focused: ViewId;
};
export type StoredNode = { readonly id: string; readonly kind?: string } & Readonly<Record<string, unknown>>;

/**
 * What a composition tells the graph about node state: each slot's codec (validates and normalises a node's state on read and on
 * every edit; undefined refuses it), the kinds a slot allows, and each scene kind's camera and rig kinds, which a link must respect.
 */
export type NodeCodec = {
  /** The kinds this slot's nodes may have; absent means the slot has no kinds (display, tools). */
  readonly kinds?: readonly string[];
  parse(state: Readonly<Record<string, unknown>>, kind: string | undefined): Record<string, unknown> | undefined;
};
export type SceneKindRule = { readonly kind: SceneKind; readonly cameras: readonly CameraKind[]; readonly rigs: readonly RigKind[] };
export type ViewGraphRules = { readonly codecs: { readonly [S in ViewSlot]: NodeCodec }; readonly scenes: readonly SceneKindRule[] };

/** A detached read of the graph for presentations: each view with its nodes, and which of them other views share. */
export type ViewGraphSnapshot = {
  readonly focused: ViewId;
  readonly views: readonly (ViewRecord & { readonly shared: readonly ViewSlot[]; readonly sceneKind: SceneKind; /** The dock panel that shows it. */ readonly panel: string })[];
};

/** What changed in one graph commit, for the devices that draw it and the views that repaint. */
export type ViewGraphChange = {
  /** Nodes whose kind or state changed, created or removed. */
  readonly nodes: readonly string[];
  /** Views that reference a changed node, or were added, removed or relinked. */
  readonly views: readonly ViewId[];
  /** Views were added, removed or relinked, or the focus moved. */
  readonly structure: boolean;
  /**
   * `edit`: an action changed it; `history`: Undo, Redo or a camera Back/Forward; `seed`: state that records nothing and marks no
   * edit (restore-time state, or tools the presentation withdrew).
   */
  readonly origin: "edit" | "history" | "seed";
  /** Whatever made the change already applied it to the device (a camera jump the device computed): readers must not apply it again. */
  readonly applied: boolean;
};

/** The View and lighting history's state (design §3.6): what Undo and Redo would change next. Session-only. */
export type ViewHistoryState = { readonly undo?: string; readonly redo?: string; readonly depth: number; readonly redoDepth: number };

/**
 * IDs no view may take (CORE-98): `uv` and `surface` are gesture sources (the flat UV editor, and the on-head editor's earlier name
 * for the main view, `authoring-gestures.ts`), and `head` is the main view's panel and the viewport port's alias for it.
 */
export const RESERVED_VIEW_IDS: readonly string[] = Object.freeze(["uv", "surface", "head"]);
/** A view ID a person or a file may give: short, lowercase letters, digits and dashes, and not reserved. */
export const validViewId = (id: unknown): id is ViewId => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(id) &&
  !RESERVED_VIEW_IDS.includes(id);
/** The dock panel that shows a view: `head` for the main view (kept so saved layouts restore), `view.<id>` for the others. */
export const viewPanelId = (view: ViewId) => view === MAIN_VIEW ? "head" : `view.${view}`;
/** A view's name when it has none of its own. */
export const DEFAULT_VIEW_TITLE = "3D view";
/**
 * Each view's title, in graph order: its own name, else "3D view", numbered ("3D view 1", "3D view 2") when there are several.
 * Derived, never stored, so the panel's ID and the saved layouts never depend on it. Pure.
 */
export function viewTitles(views: readonly Pick<ViewRecord, "id" | "title">[]): string[] {
  return views.map((view, index) => view.title || (views.length > 1 ? `${DEFAULT_VIEW_TITLE} ${index + 1}` : DEFAULT_VIEW_TITLE));
}
