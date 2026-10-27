/**
 * Layout fragments (profiles design §4.2; experiment 044 chunk P2-ii): a default layout as plain data, read, made from a tab, and made
 * into a tab again. Pure: `LayoutDefaults` holds them, `TabDefaults` runs the actions that use them.
 *
 * - **Validation on read.** `fragmentIssues` checks a fragment's structure (a fragment from another build, or a damaged document): every
 *   key well formed and unique, every reference resolving inside the fragment (views to nodes, scenes to slots, pins to views, scenes and
 *   slots, the dock's panels to panels and views), view titles within the graph's limit, and no node state holding an identity or what
 *   a scene shows. `buildIssues` checks it against what this build has: its panel types, its view tools, and every node's state and kind
 *   as the graph's codecs read them, with each view's scene, camera and lights kinds fitting together. Last, a tab made from it is read
 *   back through the session's own readers (`profileSessionOf`, `parseViewGraph`), so nothing accepted here can be refused on a restart.
 * - **From a tab** (`fragmentOfTab`, Save as default): the tab's views and every node they name, copied as values (links to other tabs'
 *   views included); actual subjects and looks become slots; pins name the fragment's keys (a pin to something outside the tab is
 *   dropped); panel state is kept for types that keep it. Keys are canonical (views `view1`, nodes `<slot>1`, subject slots `v1`, look
 *   slots `look1`, panels by type), so a fragment made from a tab made from a fragment is the same bytes.
 * - **Into a tab** (`instantiateFragment`): fresh IDs for every view, node and panel instance, scenes included; each scene's subject and
 *   look come from the fill (never from its state), and a scene the fill shares is an existing scene instead of a new one, lit by that
 *   scene's lights (M2: one runtime keeps one setup, and a lighting change in either tab shows in both).
 * - **Substitution as data** (`substitutionOf`): per subject slot the profile's subjects of its kinds, per look slot the profile's looks,
 *   per scene the existing scenes showing the chosen V, with their lights (decision M2 of experiment 044: sharing is the default, New
 *   scene beside it).
 *   Each defaults to its only candidate, else Leave empty; a scene to the first scene to share, else New scene. P2-iv's substitution
 *   step presents exactly this.
 */
import { LAYOUT_FRAGMENT_SCHEMA, type DefaultLayoutContribution, type FragmentBinding, type FragmentDock, type FragmentNode, type FragmentPanel, type FragmentView,
  type LayoutFragment } from "../../platform/api/layout-fragment";
import { sameSubject, type SubjectRef } from "../../platform/api/subjects";
import { SLOT_COLLECTIONS, VIEW_GRAPH_1, VIEW_SLOTS, viewTitles, type StoredNode, type ViewGraphRules, type ViewRecord, type ViewSlot } from "../../platform/api/view-graph";
import { parseViewGraph, VIEW_TITLE_LIMIT } from "../../platform/core/view-graph";
import type { LookRef } from "../../library/collection-documents";
import type { DockLayout } from "../ui-preferences";
import { dockPanels, rewriteDock, withoutDockPanels } from "./profiles-migration-data";
import { PROFILE_SESSION_SCHEMA, profileSessionOf, type PanelBinding, type PanelInstance, type ProfileSessionData, type SessionScene,
  type TabId } from "./profile-session";
import { nameIssue, type TabContent } from "./profile-sessions";

export { LAYOUT_FRAGMENT_SCHEMA, type LayoutFragment };
/** A view's panel in a fragment's dock. */
export const VIEW_PANEL = "view:";
/** A fragment's local key: letters and digits, then dots, dashes and underscores. */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
/** The dock a tab with no arrangement of its own saves as. */
const EMPTY_DOCK: FragmentDock = { format: "xfs/dock", version: 1, state: {} };
/** Panel types a fragment never lists: a view's panel is `view:<key>` in its dock. */
const VIEW_TYPES = (type: string) => type === "view" || type === "head" || type.startsWith("view.");
/**
 * Fields a node's state never holds: its identity and what a scene shows are made with the tab (fresh IDs, the substitution), so state can
 * never override them or keep a subject a slot left empty.
 */
const RESERVED_STATE = ["id", "kind", "subject", "look", "gen", "tab"] as const;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);

// ---------------------------------------------------------------------------------------------------------------------
// Validation

/** What a fragment's structure gets wrong (empty: it reads). Developer-facing; a person sees that the default can't be used. */
export function fragmentIssues(value: unknown): string[] {
  if (!object(value)) return ["a fragment is an object"];
  const issues: string[] = [];
  if (value.schema !== LAYOUT_FRAGMENT_SCHEMA) issues.push(`its schema isn't ${LAYOUT_FRAGMENT_SCHEMA}`);
  const tab = value.tab;
  if (!object(tab) || typeof tab.name !== "string" || nameIssue(tab.name.trim())) issues.push("its tab has no usable name");
  if (!object(tab) || !object(tab.dock) || typeof tab.dock.format !== "string" || typeof tab.dock.version !== "number" || !object(tab.dock.state))
    issues.push("its dock isn't an arrangement");
  const list = (name: string) => Array.isArray(value[name]) ? value[name] as unknown[] : (issues.push(`${name} isn't a list`), []);
  const keys = (name: string, items: unknown[]) => {
    const seen = new Set<string>();
    for (const item of items) {
      const key = object(item) ? item.key : undefined;
      if (typeof key !== "string" || !KEY.test(key)) issues.push(`${name} has an item without a usable key`);
      else if (seen.has(key)) issues.push(`${name} has key ${key} twice`);
      else seen.add(key);
    }
    return seen;
  };
  const subjectItems = list("subjects"), lookItems = list("looks"), nodeItems = list("nodes"), viewItems = list("views"), panelItems = list("panels");
  const subjects = keys("subjects", subjectItems), looks = keys("looks", lookItems), views = keys("views", viewItems), panels = keys("panels", panelItems);
  for (const item of subjectItems) if (object(item) && (!Array.isArray(item.kinds) || !item.kinds.length || item.kinds.some(kind => typeof kind !== "string" || !kind)))
    issues.push(`subject slot ${String(item.key)} names no kinds`);
  // Nodes: keys unique per slot (views name a node of each slot).
  const nodes = new Map<ViewSlot, Set<string>>(VIEW_SLOTS.map(slot => [slot, new Set<string>()]));
  for (const item of nodeItems) {
    if (!object(item) || typeof item.key !== "string" || !KEY.test(item.key) || !(VIEW_SLOTS as readonly unknown[]).includes(item.slot)) { issues.push("a node has no usable key or slot"); continue; }
    const slot = item.slot as ViewSlot, key = item.key;
    if (nodes.get(slot)!.has(key)) issues.push(`${slot} node ${key} is there twice`);
    nodes.get(slot)!.add(key);
    if (item.kind !== undefined && (typeof item.kind !== "string" || !item.kind)) issues.push(`${slot} node ${key} has an unusable kind`);
    if (!object(item.state)) issues.push(`${slot} node ${key} has no state`);
    else for (const field of RESERVED_STATE) if (field in item.state) issues.push(`${slot} node ${key}'s state holds ${field}, which only the tab it makes may give`);
    if (item.subject !== undefined && (slot !== "scene" || typeof item.subject !== "string" || !subjects.has(item.subject))) issues.push(`${slot} node ${key} names a subject slot it can't`);
    if (item.look !== undefined && (slot !== "scene" || typeof item.look !== "string" || !looks.has(item.look))) issues.push(`${slot} node ${key} names a look slot it can't`);
  }
  for (const item of viewItems) {
    if (!object(item)) continue;
    if (item.title !== undefined && (typeof item.title !== "string" || item.title.length > VIEW_TITLE_LIMIT)) issues.push(`view ${String(item.key)} has an unusable title`);
    for (const slot of VIEW_SLOTS) if (typeof item[slot] !== "string" || !nodes.get(slot)!.has(item[slot] as string)) issues.push(`view ${String(item.key)} names no ${slot} node of the fragment`);
  }
  for (const item of panelItems) {
    if (!object(item)) continue;
    if (typeof item.type !== "string" || !item.type || VIEW_TYPES(item.type)) issues.push(`panel ${String(item.key)} has an unusable type`);
    if (item.binding !== undefined && !bindingReads(item.binding, { view: views, scene: nodes.get("scene")!, subject: subjects, look: looks }))
      issues.push(`panel ${String(item.key)} has a binding that names nothing in the fragment`);
  }
  if (object(tab) && object(tab.dock)) for (const id of dockPanels(tab.dock as DockLayout)) {
    if (id.startsWith(VIEW_PANEL) ? !views.has(id.slice(VIEW_PANEL.length)) : !panels.has(id)) issues.push(`the dock shows ${id}, which the fragment doesn't have`);
  }
  return issues;
}
function bindingReads(value: unknown, keys: Record<"view" | "scene" | "subject" | "look", Set<string>>): boolean {
  if (!object(value)) return false;
  if (value.policy === "follow-focus") return Object.keys(value).length === 1;
  if (value.policy !== "pinned") return false;
  const named = (["view", "scene", "subject", "look"] as const).filter(name => name in value);
  return named.length === 1 && Object.keys(value).length === 2 && typeof value[named[0]!] === "string" && keys[named[0]!].has(value[named[0]!] as string);
}

/** What this build lacks to make a tab from a fragment that reads: panel types, view tools, node states and kinds, scene kind rules. */
export type FragmentKnowledge = {
  /** A panel type this build has. */
  panel(type: string): boolean;
  /** A view tool this build has. */
  tool(id: string): boolean;
  readonly rules: ViewGraphRules;
};
/** What a fragment (one that reads) needs that this build doesn't have (empty: a tab can be made from it here). Developer-facing. */
export function buildIssues(fragment: LayoutFragment, known: FragmentKnowledge): string[] {
  const issues: string[] = [];
  for (const panel of fragment.panels) if (!known.panel(panel.type)) issues.push(`panel type ${panel.type} isn't in this build`);
  const kinds = new Map<string, string | undefined>();
  for (const node of fragment.nodes) {
    const codec = known.rules.codecs[node.slot];
    kinds.set(`${node.slot}:${node.key}`, node.kind);
    if (codec.kinds ? node.kind === undefined || !codec.kinds.includes(node.kind) : node.kind !== undefined) issues.push(`${node.slot} node ${node.key} has kind ${node.kind ?? "(none)"}, which this build can't show`);
    else if (!codec.parse(node.state, node.kind)) issues.push(`${node.slot} node ${node.key} has state this build can't read`);
    if (node.slot === "tools" && object(node.state.on)) for (const tool of Object.keys(node.state.on)) if (!known.tool(tool)) issues.push(`tools node ${node.key} names view tool ${tool}, which isn't in this build`);
  }
  for (const view of fragment.views) {
    const rule = known.rules.scenes.find(item => item.kind === kinds.get(`scene:${view.scene}`));
    if (!rule) issues.push(`view ${view.key} shows a scene kind this build doesn't have`);
    else if (!rule.cameras.includes(kinds.get(`camera:${view.camera}`) ?? "") || !rule.rigs.includes(kinds.get(`lights:${view.lights}`) ?? ""))
      issues.push(`view ${view.key}'s camera or lights don't fit its scene`);
  }
  return issues.length ? issues : readBackIssues(fragment, known.rules);
}
/**
 * Whether a tab made from the fragment reads back as a restart reads it: through the readers the session itself uses on a stored session
 * (`profileSessionOf`) and on its graph (`parseViewGraph`), so the two can't drift. Without it, a fragment the checks above accept (a view
 * title over the graph's limit, a panel type no stored instance ID can name) could make a tab whose graph a restart refuses and replaces.
 */
function readBackIssues(fragment: LayoutFragment, rules: ViewGraphRules): string[] {
  let made = 0;
  const probe = (prefix: string) => `${prefix}${(++made).toString(36).padStart(4, "0")}`;
  const content = instantiateFragment(fragment, {}, { freshId: kind => probe(`${kind === "view" ? "v" : kind[0]}-probe`),
    freshInstance: type => probe(`${type}--p`) }, { name: fragment.tab.name });
  const tab = "t-probe", lists: Record<string, StoredNode[]> = Object.fromEntries(VIEW_SLOTS.map(slot => [SLOT_COLLECTIONS[slot], []]));
  for (const { slot, node } of content.nodes) lists[SLOT_COLLECTIONS[slot]]!.push(node as StoredNode);
  const session = profileSessionOf(clone({ schema: PROFILE_SESSION_SCHEMA, tabs: [{ id: tab, name: content.name, dock: content.dock, panels: content.panels }],
    views: { schema: VIEW_GRAPH_1, views: content.views.map(view => ({ ...view, tab })), ...lists }, focus: { views: {} }, closed: [], seq: 0 }));
  if (!session) return ["a tab made from it wouldn't read back after a restart"];
  if (session.tabs[0]!.panels.length !== content.panels.length) return ["a panel of a tab made from it wouldn't read back after a restart"];
  // The graph as the session hands it to the view graph: its scenes without what they show.
  const graph = parseViewGraph({ ...session.views, scenes: session.views.scenes.map(({ subject: _s, look: _l, gen: _g, ...scene }) => scene) }, rules);
  return graph && graph.views.length === content.views.length ? [] : ["the views of a tab made from it wouldn't read back after a restart"];
}

// ---------------------------------------------------------------------------------------------------------------------
// From a tab (Save as default)

/**
 * A tab of a stored session as a fragment (§4.2): its views (those this build shows) with value copies of every node they name, its
 * scenes' subjects and looks as slots, its panels by type with their bindings (pins as the fragment's keys) and, for types that keep it,
 * their state. `name`: the fragment's tab name (default: the tab's). Keys are canonical, in order of appearance.
 */
export function fragmentOfTab(session: ProfileSessionData, tab: TabId, options: { name?: string; keepsState?: (type: string) => boolean } = {}): LayoutFragment | undefined {
  const source = session.tabs.find(item => item.id === tab);
  if (!source) return undefined;
  const graph = session.views, views = (graph.views as readonly (ViewRecord & { tab?: string })[])
    .filter(view => view.tab === tab && view.kind === "3d" && VIEW_SLOTS.every(slot => typeof view[slot] === "string"));
  const subjects: { key: string; kinds: string[]; ref: SubjectRef }[] = [], looks: { key: string; ref: LookRef }[] = [];
  const subjectSlot = (ref: SubjectRef) => {
    const found = subjects.find(item => sameSubject(item.ref, ref));
    if (found) return found.key;
    const key = `v${subjects.length + 1}`;
    subjects.push({ key, kinds: [ref.kind], ref });
    return key;
  };
  const lookSlot = (ref: LookRef) => {
    const found = looks.find(item => item.ref.collection === ref.collection && item.ref.look === ref.look);
    if (found) return found.key;
    const key = `look${looks.length + 1}`;
    looks.push({ key, ref });
    return key;
  };
  const viewKeys = new Map(views.map((view, index) => [view.id, `view${index + 1}`]));
  const nodeKeys = new Map<string, string>(), nodes: FragmentNode[] = [], counts = new Map<ViewSlot, number>();
  for (const view of views) for (const slot of VIEW_SLOTS) {
    const id = view[slot];
    if (nodeKeys.has(`${slot}:${id}`)) continue;
    const node = (graph[SLOT_COLLECTIONS[slot]] as readonly (StoredNode | SessionScene)[]).find(item => item.id === id);
    if (!node) return undefined;
    const key = `${slot}${(counts.get(slot) ?? 0) + 1}`;
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
    nodeKeys.set(`${slot}:${id}`, key);
    const { id: _id, kind, subject, look, gen: _gen, ...state } = node as SessionScene;
    nodes.push({ key, slot, ...(kind !== undefined ? { kind } : {}), state: clone(state),
      ...(slot === "scene" && subject ? { subject: subjectSlot(subject) } : {}), ...(slot === "scene" && look ? { look: lookSlot(look) } : {}) });
  }
  const panelKeys = new Map<string, string>(), panels: FragmentPanel[] = [], typeCounts = new Map<string, number>();
  for (const panel of source.panels) {
    if (panel.type === "view") continue;
    const count = (typeCounts.get(panel.type) ?? 0) + 1;
    typeCounts.set(panel.type, count);
    const key = count === 1 ? panel.type : `${panel.type}_${count}`;
    panelKeys.set(panel.id, key);
    const binding = fragmentBinding(panel.binding, { view: id => viewKeys.get(id), scene: id => nodeKeys.get(`scene:${id}`), subject: subjectSlot, look: lookSlot });
    panels.push({ key, type: panel.type, ...(binding ? { binding } : {}),
      ...(panel.state !== undefined && options.keepsState?.(panel.type) ? { state: clone(panel.state) } : {}) });
  }
  const instances = new Map(source.panels.map(panel => [panel.id, panel]));
  const dockKey = (id: string) => {
    const panel = instances.get(id), target = panel?.binding?.policy === "pinned" ? panel.binding.target : undefined;
    if (panel?.type === "view") { const key = target && "view" in target ? viewKeys.get(target.view) : undefined; return key && VIEW_PANEL + key; }
    return panelKeys.get(id);
  };
  // The dock keeps the panels of views the tab no longer holds (parked); a default leaves them out.
  const stale = dockPanels(source.dock).filter(id => !dockKey(id));
  const dock = source.dock ? rewriteDock(stale.length ? withoutDockPanels(source.dock, id => stale.includes(id)) : source.dock, id => dockKey(id) ?? id)!
    : clone(EMPTY_DOCK);
  return { schema: LAYOUT_FRAGMENT_SCHEMA, tab: { name: options.name ?? source.name, dock: dock as FragmentDock },
    subjects: subjects.map(({ key, kinds }) => ({ key, kinds })), looks: looks.map(({ key }) => ({ key })), nodes,
    views: views.map(view => ({ key: viewKeys.get(view.id)!, ...(view.title !== undefined ? { title: view.title } : {}),
      ...Object.fromEntries(VIEW_SLOTS.map(slot => [slot, nodeKeys.get(`${slot}:${view[slot]}`)!])) }) as FragmentView), panels };
}
/** A panel's binding in a fragment: a pin names the fragment's key; a pin to something the tab doesn't hold is dropped. */
function fragmentBinding(binding: PanelBinding | undefined, keys: { view(id: string): string | undefined; scene(id: string): string | undefined;
  subject(ref: SubjectRef): string; look(ref: LookRef): string }): FragmentBinding | undefined {
  if (!binding) return undefined;
  if (binding.policy === "follow-focus") return { policy: "follow-focus" };
  const target = binding.target;
  if ("view" in target) { const key = keys.view(target.view); return key ? { policy: "pinned", view: key } : undefined; }
  if ("scene" in target) { const key = keys.scene(target.scene); return key ? { policy: "pinned", scene: key } : undefined; }
  if ("subject" in target) return { policy: "pinned", subject: keys.subject(target.subject) };
  return { policy: "pinned", look: keys.look(target.look) };
}

/** U8 seam: only the saved default changes policy. The live tab and its external pins are untouched. */
export function defaultBindingChanges(session: ProfileSessionData, tab: TabId) {
  const source = session.tabs.find(item => item.id === tab), views = session.views.views.filter(view => view.tab === tab && view.kind === "3d" && VIEW_SLOTS.every(slot => typeof view[slot] === "string"));
  return (source?.panels ?? []).flatMap(panel => {
    const binding = panel.binding;
    // View panes are represented by the fragment's retained views, not its panel bindings; omitted panes change no saved policy.
    if (panel.type === "view" || binding?.policy !== "pinned") return [];
    const pin = binding.target;
    const reason = "view" in pin && !views.some(view => view.id === pin.view) ? "external-view" as const
      : "scene" in pin && !views.some(view => view.scene === pin.scene) ? "external-scene" as const : undefined;
    return reason ? [{ instance: panel.id, type: panel.type, from: clone(binding), to: { policy: "follow-focus" as const }, reason }] : [];
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Into a tab

/** What fills a fragment's slots: a subject and a look per slot (absent or null: Leave empty), and the existing scene each shared scene is. */
export type FragmentFill = {
  readonly subjects?: Readonly<Record<string, SubjectRef | null>>;
  readonly looks?: Readonly<Record<string, LookRef | null>>;
  /**
   * Scene key → the existing scene it shares (Share the scene of), and the lights node it is lit by there: decision M2 of experiment 044,
   * a shared scene shares its lighting too, so one runtime keeps one setup and a lighting change in either tab shows in both.
   */
  readonly share?: Readonly<Record<string, { readonly scene: string; readonly lights?: string }>>;
};
/** Where a new tab's IDs come from (`ProfileSessions.freshId`, `freshInstance`). */
export type FreshIds = { freshId(kind: "view" | ViewSlot): string; freshInstance(type: string): string };

/**
 * A fragment as a new tab's content (§4.2): fresh IDs for every view, node and panel instance; each new scene starts from the fragment's
 * state and shows the subject and look the fill gives its slots (`gen` 0); a shared scene is the existing scene instead. The dock's
 * panels become the instances (a view's panel an instance of type `view` pinned to its view), and pins follow.
 */
export function instantiateFragment(fragment: LayoutFragment, fill: FragmentFill, ids: FreshIds, header: { name: string; origin?: string }): TabContent {
  const nodeIds = new Map<string, string>(), nodes: TabContent["nodes"][number][] = [];
  const shared = (scene: string) => fill.share?.[scene];
  // A lights node only views of shared scenes use isn't made: those views are lit by the shared scene's lights.
  const lit = new Set(fragment.views.filter(view => !shared(view.scene)?.lights).map(view => view.lights));
  for (const node of fragment.nodes) {
    const share = node.slot === "scene" ? shared(node.key) : undefined;
    if (share) { nodeIds.set(`scene:${node.key}`, share.scene); continue; }
    if (node.slot === "lights" && !lit.has(node.key)) continue;
    const id = ids.freshId(node.slot);
    nodeIds.set(`${node.slot}:${node.key}`, id);
    const subject = node.subject ? fill.subjects?.[node.subject] : undefined, look = node.look ? fill.looks?.[node.look] : undefined;
    // Identity and what a scene shows come only from the fresh ID and the fill, never from the state.
    const state: Record<string, unknown> = clone(node.state);
    for (const field of RESERVED_STATE) delete state[field];
    nodes.push({ slot: node.slot, node: { ...state, id, ...(node.kind !== undefined ? { kind: node.kind } : {}),
      ...(node.slot === "scene" ? { ...(subject ? { subject: { kind: subject.kind, id: subject.id } } : {}),
        ...(look ? { look: { collection: look.collection, look: look.look } } : {}), gen: 0 } : {}) } as StoredNode });
  }
  const viewIds = new Map<string, string>(), views: ViewRecord[] = [];
  for (const view of fragment.views) {
    const id = ids.freshId("view"), lights = shared(view.scene)?.lights;
    viewIds.set(view.key, id);
    views.push({ id, kind: "3d", ...(view.title !== undefined ? { title: view.title } : {}),
      ...Object.fromEntries(VIEW_SLOTS.map(slot => [slot, slot === "lights" && lights ? lights : nodeIds.get(`${slot}:${view[slot]}`)!])) } as ViewRecord);
  }
  const instances = new Map<string, string>(), panels: PanelInstance[] = [];
  for (const panel of fragment.panels) {
    const id = ids.freshInstance(panel.type);
    instances.set(panel.key, id);
    const binding = panelBinding(panel.binding, { view: key => viewIds.get(key), scene: key => nodeIds.get(`scene:${key}`),
      subject: key => fill.subjects?.[key] ?? undefined, look: key => fill.looks?.[key] ?? undefined });
    panels.push({ id, type: panel.type, ...(binding ? { binding } : {}), ...(panel.state !== undefined ? { state: clone(panel.state) } : {}) });
  }
  for (const id of dockPanels(fragment.tab.dock as DockLayout)) {
    if (!id.startsWith(VIEW_PANEL) || instances.has(id)) continue;
    const view = viewIds.get(id.slice(VIEW_PANEL.length));
    if (!view) continue;
    const instance = ids.freshInstance("view");
    instances.set(id, instance);
    panels.push({ id: instance, type: "view", binding: { policy: "pinned", target: { view } } });
  }
  return { name: header.name, ...(header.origin ? { origin: header.origin } : {}),
    dock: rewriteDock(fragment.tab.dock as DockLayout, id => instances.get(id) ?? id), panels, views, nodes };
}
function panelBinding(binding: FragmentBinding | undefined, targets: { view(key: string): string | undefined; scene(key: string): string | undefined;
  subject(key: string): SubjectRef | undefined; look(key: string): LookRef | undefined }): PanelBinding | undefined {
  if (!binding) return undefined;
  if (binding.policy === "follow-focus") return { policy: "follow-focus" };
  if (binding.view !== undefined) { const view = targets.view(binding.view); return view ? { policy: "pinned", target: { view } } : undefined; }
  if (binding.scene !== undefined) { const scene = targets.scene(binding.scene); return scene ? { policy: "pinned", target: { scene } } : undefined; }
  if (binding.subject !== undefined) { const subject = targets.subject(binding.subject); return subject ? { policy: "pinned", target: { subject: { kind: subject.kind, id: subject.id } } } : undefined; }
  const look = binding.look !== undefined ? targets.look(binding.look) : undefined;
  return look ? { policy: "pinned", target: { look: { collection: look.collection, look: look.look } } } : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Substitution (as data)

/**
 * An existing scene a new tab may share: its kind, the tab and the lights of its most recently focused view (a shared scene shares that
 * lighting, M2), and what it shows.
 */
export type SceneCandidate = { readonly scene: string; readonly kind: string; readonly tab: TabId; readonly lights?: string; readonly subject?: SubjectRef;
  readonly look?: LookRef };
/** What a profile offers a new tab: its subjects, its live looks (collection order), and the session's scenes (most recently focused first). */
export type SubstitutionContext = { readonly subjects: readonly SubjectRef[]; readonly looks: readonly LookRef[]; readonly scenes: readonly SceneCandidate[] };
/**
 * The person's choices, by slot key: a subject or look (null: Leave empty), and per scene the existing scene to share (null: New scene).
 * A slot not named takes its default.
 */
export type SubstitutionChoice = {
  readonly subjects?: Readonly<Record<string, SubjectRef | null>>;
  readonly looks?: Readonly<Record<string, LookRef | null>>;
  readonly scenes?: Readonly<Record<string, string | null>>;
};
/**
 * Each slot with its candidates and what is chosen (absent: Leave empty, or New scene), as P2-iv's substitution step shows it.
 * `needed`: a look slot some new scene (or a pin) shows; a look slot only shared scenes use takes the shared scene's look instead.
 * `oneClick`: every subject slot, every needed look slot and every scene has at most one candidate, so New tab can name them in its
 * entry and make the tab in one click.
 */
export type Substitution = {
  readonly subjects: readonly { readonly key: string; readonly kinds: readonly string[]; readonly candidates: readonly SubjectRef[]; readonly chosen?: SubjectRef }[];
  readonly looks: readonly { readonly key: string; readonly candidates: readonly LookRef[]; readonly chosen?: LookRef; readonly needed: boolean }[];
  readonly scenes: readonly { readonly key: string; readonly viewTitles: readonly string[]; readonly subject?: string; readonly look?: string; readonly shares: readonly SceneCandidate[];
    readonly chosen?: string }[];
  readonly oneClick: boolean;
  /** U8 seam: direct pins whose chosen substitution is Leave empty become follow-focus in the new tab. */
  readonly bindingChanges: readonly { readonly panel: string; readonly type: string; readonly from: FragmentBinding;
    readonly to: { readonly policy: "follow-focus" }; readonly reason: "empty-subject" | "empty-look"; readonly slot: string }[];
};
const sameLook = (a: LookRef, b: LookRef) => a.collection === b.collection && a.look === b.look;

/** A fragment's substitution in a profile, with `choice` applied; a choice that names nothing on offer is refused with the reason. */
export function substitutionOf(fragment: LayoutFragment, context: SubstitutionContext, choice: SubstitutionChoice = {}): Substitution | { readonly issue: string } {
  const unknown = (named: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]) => Object.keys(named ?? {}).some(key => !keys.includes(key));
  const scenes = fragment.nodes.filter(node => node.slot === "scene");
  if (unknown(choice.subjects, fragment.subjects.map(slot => slot.key)) || unknown(choice.looks, fragment.looks.map(slot => slot.key))
    || unknown(choice.scenes, scenes.map(node => node.key))) return { issue: "That choice names something this default doesn't have." };
  const subjects: Substitution["subjects"][number][] = [];
  for (const slot of fragment.subjects) {
    const candidates = context.subjects.filter(subject => slot.kinds.includes(subject.kind)), named = choice.subjects?.[slot.key];
    if (named && !candidates.some(item => sameSubject(item, named))) return { issue: "That V isn't in this profile any more." };
    const chosen = named !== undefined ? named ?? undefined : candidates.length === 1 ? candidates[0] : undefined;
    subjects.push({ key: slot.key, kinds: [...slot.kinds], candidates: candidates.map(item => ({ ...item })), ...(chosen ? { chosen: { ...chosen } } : {}) });
  }
  const sceneChoices: Substitution["scenes"][number][] = [];
  // A default makes one tab; these are the same local names its panes will show after instantiation.
  const titles = viewTitles(fragment.views.map(view => ({ id: view.key, title: view.title })));
  for (const node of scenes) {
    const subject = node.subject ? subjects.find(slot => slot.key === node.subject)?.chosen : undefined;
    const shares = subject ? context.scenes.filter(item => item.kind === node.kind && item.subject && sameSubject(item.subject, subject)) : [];
    const named = choice.scenes?.[node.key];
    if (named && !shares.some(item => item.scene === named)) return { issue: "That scene doesn't show this V any more." };
    const chosen = named !== undefined ? named ?? undefined : shares[0]?.scene;
    sceneChoices.push({ key: node.key, viewTitles: fragment.views.flatMap((view, index) => view.scene === node.key ? [titles[index]!] : []),
      ...(node.subject ? { subject: node.subject } : {}), ...(node.look ? { look: node.look } : {}),
      shares: shares.map(item => clone(item)), ...(chosen ? { chosen } : {}) });
  }
  const pinned = new Set(fragment.panels.flatMap(panel => panel.binding?.policy === "pinned" && panel.binding.look !== undefined ? [panel.binding.look] : []));
  const looks: Substitution["looks"][number][] = [];
  for (const slot of fragment.looks) {
    const named = choice.looks?.[slot.key];
    if (named && !context.looks.some(item => sameLook(item, named))) return { issue: "That look isn't available any more." };
    const chosen = named !== undefined ? named ?? undefined : context.looks.length === 1 ? context.looks[0] : undefined;
    const needed = pinned.has(slot.key) || sceneChoices.some(scene => scene.look === slot.key && !scene.chosen);
    looks.push({ key: slot.key, candidates: context.looks.map(item => ({ ...item })), ...(chosen ? { chosen: { ...chosen } } : {}), needed });
  }
  const oneClick = subjects.every(slot => slot.candidates.length <= 1) && looks.every(slot => !slot.needed || slot.candidates.length <= 1)
    && sceneChoices.every(scene => scene.shares.length <= 1);
  const bindingChanges: Substitution["bindingChanges"][number][] = fragment.panels.flatMap(panel => {
    const binding = panel.binding;
    if (binding?.policy !== "pinned") return [];
    const subject = binding.subject, look = binding.look;
    const reason = subject && !subjects.find(slot => slot.key === subject)?.chosen ? "empty-subject" as const
      : look && !looks.find(slot => slot.key === look)?.chosen ? "empty-look" as const : undefined;
    return reason ? [{ panel: panel.key, type: panel.type, from: clone(binding), to: { policy: "follow-focus" as const }, reason, slot: (subject ?? look)! }] : [];
  });
  return { subjects, looks, scenes: sceneChoices, oneClick, bindingChanges };
}
/** The fill a substitution gives `instantiateFragment`. */
export function fillOf(substitution: Substitution): FragmentFill {
  return {
    subjects: Object.fromEntries(substitution.subjects.map(slot => [slot.key, slot.chosen ?? null])),
    looks: Object.fromEntries(substitution.looks.map(slot => [slot.key, slot.chosen ?? null])),
    share: Object.fromEntries(substitution.scenes.flatMap(scene => {
      const lights = scene.shares.find(item => item.scene === scene.chosen)?.lights;
      return scene.chosen ? [[scene.key, { scene: scene.chosen, ...(lights ? { lights } : {}) }]] : [];
    })),
  };
}

/**
 * A module's default as source text to paste into its defaults (the verification-only command's output, decision M1 of experiment 044):
 * JSON, which is a TypeScript literal, with each value on one line when it fits in `width` columns.
 */
export function printDefault(contribution: DefaultLayoutContribution, width = 140): string {
  const print = (value: unknown, indent: string, used: number): string => {
    const flat = JSON.stringify(value);
    if (!value || typeof value !== "object" || used + flat.length <= width) return flat;
    const inner = `${indent}  `;
    if (Array.isArray(value)) return `[\n${value.map(item => inner + print(item, inner, inner.length)).join(",\n")}\n${indent}]`;
    return `{\n${Object.entries(value).map(([key, item]) => { const head = `${inner}${JSON.stringify(key)}: `; return head + print(item, inner, head.length); })
      .join(",\n")}\n${indent}}`;
  };
  return print(contribution, "", 0);
}
