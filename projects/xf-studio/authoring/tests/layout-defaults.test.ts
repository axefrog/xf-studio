/**
 * Profiles phase 2, chunk P2-ii (experiment 044 §4): layout fragments, substitution, the modules' defaults and Save as default.
 *
 * - **The fragment round trip.** Every contributed default, made into a tab with every slot filled and saved again, is the same bytes; a
 *   migrated own default (keys from its old graph) comes back equal up to its keys, and from then on the same bytes.
 * - **Substitution as data** with 0, 1 and 2 candidates per slot, and decision M2: a V another tab shows shares that scene by default,
 *   with New scene beside it; a look only shared scenes use isn't asked for; a choice naming nothing on offer is refused.
 * - **Contributed defaults are immutable**; the composition refuses a default naming a panel type, view tool or node state the build lacks.
 * - **Own defaults** are saved, updated, renamed, deleted (a tombstone) and restored through the outbox, survive a restart before and after
 *   the library has them, and a write two windows make to one default is a conflict, resolved either way.
 * - **Validation on read**: a newer build's or a damaged own default is listed as unavailable with the reason, and no tab is made from it.
 * - **Reset** fills a tab from its default again, the tab holding the drawn view included (P2-iii).
 */
import { describe, expect, test } from "bun:test";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { isTombstone } from "../src/platform/api/document-commands";
import type { LayoutFragment } from "../src/platform/api/layout-fragment";
import { VIEW_SLOTS } from "../src/platform/api/view-graph";
import { buildIssues, fillOf, fragmentIssues, fragmentOfTab, instantiateFragment, printDefault, substitutionOf, type Substitution,
  type SubstitutionChoice, type SubstitutionContext } from "../src/app/profiles/layout-fragment";
import { contributedDefaultIssues, contributedDefaults, LAYOUT_DEFAULT_DOCUMENT, LAYOUT_DEFAULT_SCHEMA, LayoutDefaults } from "../src/app/profiles/layout-defaults";
import { TabDefaults } from "../src/app/profiles/tab-defaults";
import { drawnView, substitutionContext } from "../src/app/profiles/profile-window";
import { profileSessionOf } from "../src/app/profiles/profile-session";
import type { ProfileSessions } from "../src/app/profiles/profile-sessions";
import { layoutFragment, sessionOfWorkspace } from "../src/app/profiles/profiles-migration-data";
import { keepsStateInDefaults, STUDIO_FRAGMENT_KNOWLEDGE, STUDIO_LAYOUT_DEFAULTS } from "../src/compose/layout-defaults";
import { STUDIO_MODULES } from "../src/compose/modules";
import { defaultViewGraph, STUDIO_VIEW_GRAPH_RULES } from "../src/preview/preview-view-graph";
import { defaultDockState } from "../src/studio-ui/layout-defaults";
import { viewCatalogue } from "../src/studio-ui/views/contribution";
import { SHELL_VIEW } from "../src/studio-ui/views/shell";
import { EYE_MAKEUP_VIEW } from "../src/features/eye-makeup/view/contribution";
import type { DockLayout } from "../src/app/ui-preferences";
import { freshWorkspace } from "./fixtures/eye-region";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { openSession, seededRandom } from "./fixtures/profile-sessions";

const COLLECTION = "11111111-1111-4111-8111-111111111111";
const LOOK = { collection: COLLECTION, look: "22222222-2222-4222-8222-222222222222" };
const OTHER_LOOK = { collection: COLLECTION, look: "33333333-3333-4333-8333-333333333333" };
const V1 = { kind: "character", id: "c-1" }, V2 = { kind: "character", id: "c-2" };
const EYE = "eye-makeup/default";
const json = (value: unknown) => JSON.stringify(value);
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
async function quiet(outbox: DocumentOutbox) { for (let i = 0; i < 200 && (outbox.status().pending || outbox.status().failing); i++) await tick(); }

/** A profile: its subjects and its collection's looks (all live), changed by the tests. */
type Profile = { subjects: { kind: string; id: string }[]; looks: string[] };
let windows = 0;
/** A window: its outbox over the library, its defaults, its session (tab 1 shows V1 wearing LOOK) and the tabs' actions. */
function windowOn(documents = storeDocuments(), storage = memoryOutboxStorage(), options: { profile?: Profile } = {}) {
  const outbox = new DocumentOutbox(documents, storage, { retryMs: 5 });
  outbox.open();
  // Each window its own source of randomness, as each page has: two windows saving in the same millisecond never make the same ID.
  const defaults = new LayoutDefaults({ documents, outbox, contributed: STUDIO_LAYOUT_DEFAULTS, known: STUDIO_FRAGMENT_KNOWLEDGE, random: seededRandom(11 + ++windows) });
  const s = openSession(sessionOfWorkspace(freshWorkspace(), { tab: "Layout 1", character: V1.id, look: LOOK }, seededRandom(1)),
    { random: seededRandom(7) });
  const profile: Profile = options.profile ?? { subjects: [V1], looks: [LOOK.look, OTHER_LOOK.look] };
  /** Vs deleted since (still members of the profile, design §1.4). */
  const deleted = new Set<string>();
  const services = { profiles: { profile: () => ({ subjects: profile.subjects, collections: [COLLECTION] }) },
    collections: { collection: () => ({ looks: profile.looks }), look: () => ({ state: "live" }) },
    characters: { document: (id: string) => deleted.has(id) ? null : { id } } };
  const tabs = new TabDefaults({ sessions: s, defaults, candidates: () => substitutionContext(s, services as never), keepsState: keepsStateInDefaults,
    known: STUDIO_FRAGMENT_KNOWLEDGE });
  return { documents, storage, outbox, defaults, s, tabs, profile, deleted };
}
type Window = ReturnType<typeof windowOn>;
/** Dispatch after checking the capability, as the application does; returns the refusal's reason when refused. */
function act(w: Window, action: Parameters<TabDefaults["dispatch"]>[0]): string | undefined {
  const allowed = w.tabs.capability(action);
  if (!allowed.available) return allowed.reason;
  w.tabs.dispatch(action);
  return undefined;
}
/** Every slot of a fragment filled (subjects V1, looks LOOK) and every scene new: the choice that makes a tab the fragment can come back from. */
const filled = (fragment: LayoutFragment): SubstitutionChoice => ({ subjects: Object.fromEntries(fragment.subjects.map(slot => [slot.key, V1])),
  looks: Object.fromEntries(fragment.looks.map(slot => [slot.key, LOOK])),
  scenes: Object.fromEntries(fragment.nodes.filter(node => node.slot === "scene").map(node => [node.key, null])) });
const dockOf = (panels: readonly string[]): DockLayout => ({ format: "xfs/dock", version: 1, state: {
  wide: { floating: [], root: { kind: "group", id: "g1", panels: [...panels], active: panels[0] }, closed: ["help"] },
  compact: { floating: [], root: { kind: "group", id: "g1", panels: [...panels], active: panels[0] }, closed: ["help"] } } });
/**
 * A fragment with its keys replaced by their places (subjects, looks, nodes per slot, views, panels) and each node's state as the graph's
 * codec reads it (a calibration in its stored form reads as the same calibration): equal for fragments equal up to keys.
 */
function shape(fragment: LayoutFragment): string {
  const names = new Map<string, string>();
  fragment.subjects.forEach((slot, i) => names.set(`subject:${slot.key}`, `S${i}`));
  fragment.looks.forEach((slot, i) => names.set(`look:${slot.key}`, `L${i}`));
  for (const slot of VIEW_SLOTS) fragment.nodes.filter(node => node.slot === slot).forEach((node, i) => names.set(`${slot}:${node.key}`, `${slot}#${i}`));
  fragment.views.forEach((view, i) => names.set(`view:${view.key}`, `V${i}`));
  fragment.panels.forEach((panel, i) => names.set(`panel:${panel.key}`, `P${i}`));
  const dockId = (id: string) => id.startsWith("view:") ? names.get(id)! : names.get(`panel:${id}`) ?? id;
  const dock = json(fragment.tab.dock.state).replace(/"([^"]+)"/g, (whole, id: string) => names.has(`panel:${id}`) || names.has(id) ? `"${dockId(id)}"` : whole);
  return json({ dock, subjects: fragment.subjects.map(slot => slot.kinds), looks: fragment.looks.length,
    nodes: fragment.nodes.map(node => ({ ...node, key: names.get(`${node.slot}:${node.key}`), state: STUDIO_VIEW_GRAPH_RULES.codecs[node.slot].parse(node.state, node.kind),
      ...(node.subject ? { subject: names.get(`subject:${node.subject}`) } : {}),
      ...(node.look ? { look: names.get(`look:${node.look}`) } : {}) })),
    views: fragment.views.map(view => ({ ...view, key: names.get(`view:${view.key}`), ...Object.fromEntries(VIEW_SLOTS.map(slot => [slot, names.get(`${slot}:${view[slot]}`)])) })),
    panels: fragment.panels.map(panel => ({ ...panel, key: names.get(`panel:${panel.key}`) })) });
}

describe("the fragment round trip", () => {
  test("every contributed default, made into a tab with every slot filled and saved again, is the same bytes", () => {
    for (const item of STUDIO_LAYOUT_DEFAULTS) {
      const w = windowOn();
      expect(act(w, { kind: "tabs.new", default: item.id, choice: filled(item.fragment) })).toBeUndefined();
      const tab = w.s.tab(w.s.tabId())!;
      expect([tab.name, tab.origin]).toEqual([item.name, item.id]);
      expect(json(fragmentOfTab(w.s.session(), tab.id, { name: item.name }))).toBe(json(item.fragment));
      // Saved as an own default and made into a tab again: the same bytes once more.
      expect(act(w, { kind: "tabs.saveAsDefault", tab: tab.id, name: `${item.name} (mine)` })).toBeUndefined();
      const own = w.defaults.get(w.s.tab(tab.id)!.origin!)!;
      expect(act(w, { kind: "tabs.new", default: own.id, choice: filled(own.fragment) })).toBeUndefined();
      expect(json(fragmentOfTab(w.s.session(), w.s.tabId(), { name: item.name }))).toBe(json(item.fragment));
    }
  });

  test("a migrated own default (its keys and node states from the old graph) comes back equal up to its keys, and from then on the same bytes", () => {
    const graph = defaultViewGraph(freshWorkspace().preview), migrated = layoutFragment("Saved layout", dockOf(["presets", "head", "layers", "lighting"]), graph);
    expect(fragmentIssues(migrated)).toEqual([]);
    expect(buildIssues(migrated, STUDIO_FRAGMENT_KNOWLEDGE)).toEqual([]);
    const w = windowOn();
    w.documents.store.transact({ id: "m1", command: "migration", writes: [{ kind: LAYOUT_DEFAULT_DOCUMENT, id: "d-migrated1", base: 0,
      value: { schema: LAYOUT_DEFAULT_SCHEMA, id: "d-migrated1", name: "Saved layout", owner: "user", fragment: migrated, createdAt: 1 } }] });
    return w.defaults.load().then(() => {
      expect(act(w, { kind: "tabs.new", default: "d-migrated1", choice: filled(migrated) })).toBeUndefined();
      const once = fragmentOfTab(w.s.session(), w.s.tabId())!;
      expect(json(once)).not.toBe(json(migrated));
      expect(shape(once)).toBe(shape(migrated));
      expect(act(w, { kind: "tabs.saveAsDefault", tab: w.s.tabId(), name: "Canonical" })).toBeUndefined();
      expect(act(w, { kind: "tabs.new", default: w.s.tab(w.s.tabId())!.origin!, choice: filled(once) })).toBeUndefined();
      expect(json(fragmentOfTab(w.s.session(), w.s.tabId(), { name: once.tab.name }))).toBe(json(once));
    });
  });

  test("instantiation gives fresh IDs everywhere, scenes included; pins follow; a pin to something outside the tab is dropped when saved", () => {
    const w = windowOn(), main = w.s.graph.viewIds()[0]!;
    const before = new Set(JSON.stringify(w.s.session()).match(/"[a-z]+-[0-9a-z]{8,}"/g) ?? []);
    w.s.arrange(w.s.tabId(), dockOf(["head", "presets", "character"]));
    // Pins: presets to the main view's scene, character to V1; a lighting panel pinned to a view in another tab.
    const tab = w.s.tabId(), data = w.s.session(), scene = w.s.graph.node(main, "scene").id;
    const pinned = data.tabs[0]!.panels.map(panel => panel.type === "presets" ? { ...panel, binding: { policy: "pinned" as const, target: { scene } } }
      : panel.type === "character" ? { ...panel, binding: { policy: "pinned" as const, target: { subject: V2 } } } : panel);
    const fragment = fragmentOfTab({ ...data, tabs: [{ ...data.tabs[0]!, panels: [...pinned, { id: "lighting--abcd", type: "lighting",
      binding: { policy: "pinned", target: { view: "elsewhere" } } }] }] }, tab)!;
    expect(fragment.panels.map(panel => [panel.key, panel.binding ?? null])).toEqual([["presets", { policy: "pinned", scene: "scene1" }],
      ["character", { policy: "pinned", subject: "v2" }], ["help", null], ["lighting", null]]);
    expect(fragment.subjects).toEqual([{ key: "v1", kinds: ["character"] }, { key: "v2", kinds: ["character"] }]);
    const content = instantiateFragment(fragment, { subjects: { v1: V1, v2: V2 }, looks: { look1: LOOK } }, w.s, { name: "Copy" });
    for (const id of [...content.views.map(view => view.id), ...content.nodes.map(item => item.node.id), ...content.panels.map(panel => panel.id)])
      expect(before.has(`"${id}"`)).toBe(false);
    const presets = content.panels.find(panel => panel.type === "presets")!, newScene = content.nodes.find(item => item.slot === "scene")!.node.id;
    expect(presets.binding).toEqual({ policy: "pinned", target: { scene: newScene } });
    expect(content.panels.find(panel => panel.type === "character")!.binding).toEqual({ policy: "pinned", target: { subject: V2 } });
    // Leave empty: a pin to an empty slot is no pin.
    expect(instantiateFragment(fragment, {}, w.s, { name: "Empty" }).panels.find(panel => panel.type === "character")!.binding).toBeUndefined();
  });
});

test("a view closed since the tab was arranged: its panel, in a group or parked by the dock, is left out of the default", () => {
  const w = windowOn(), main = w.s.graph.viewIds()[0]!, side = w.s.addView(main, {}), other = w.s.addView(main, {}), tab = w.s.tabId();
  const tree = { floating: [], closed: ["help", `view.${other}`], root: { kind: "split", id: "s1", axis: "row", sizes: [.3, .7], children: [
    { kind: "group", id: "g1", panels: [`view.${side}`], active: `view.${side}` }, { kind: "group", id: "g2", panels: ["head", "presets"], active: "head" }] },
    parked: { [`view.${other}`]: { group: ["presets", `view.${other}`], index: 1, active: false } },
    lastPlace: { help: { group: ["presets"], index: 0, active: false, anchor: { panel: `view.${side}`, side: "left", share: .5 } } } };
  w.s.arrange(tab, { format: "xfs/dock", version: 1, state: { wide: tree, compact: tree } });
  w.s.closeView(side);
  w.s.closeView(other);
  expect(act(w, { kind: "tabs.saveAsDefault", tab, name: "Without" })).toBeUndefined();
  const fragment = w.defaults.get(w.s.tab(tab)!.origin!)!.fragment;
  expect(fragmentIssues(fragment)).toEqual([]);
  expect((fragment.tab.dock.state as { wide: unknown }).wide).toEqual({ floating: [], closed: ["help"],
    root: { kind: "group", id: "g2", panels: ["view:view1", "presets"], active: "view:view1" },
    parked: {}, lastPlace: { help: { group: ["presets"], index: 0, active: false } } });
});

describe("substitution as data (0, 1 and 2 candidates; M2's share or new)", () => {
  const eye = STUDIO_LAYOUT_DEFAULTS.find(item => item.id === EYE)!.fragment;
  const context = (over: Partial<SubstitutionContext>): SubstitutionContext => ({ subjects: [], looks: [], scenes: [], ...over });
  const ok = (value: Substitution | { issue: string }) => { if ("issue" in value) throw Error(value.issue); return value; };

  test("no candidate: every slot is left empty and the tab is one click; its scene shows nothing", () => {
    const made = ok(substitutionOf(eye, context({})));
    expect(made).toMatchObject({ subjects: [{ key: "v1", candidates: [] }], looks: [{ key: "look1", candidates: [], needed: true }],
      scenes: [{ key: "scene1", shares: [] }], oneClick: true });
    expect(made.subjects[0]!.chosen).toBeUndefined();
    expect(fillOf(made)).toEqual({ subjects: { v1: null }, looks: { look1: null }, share: {} });
  });

  test("one candidate each: it is chosen, named, and the tab is one click", () => {
    const made = ok(substitutionOf(eye, context({ subjects: [V1, { kind: "npc", id: "n-1" }], looks: [LOOK] })));
    expect(made.subjects[0]).toMatchObject({ candidates: [V1], chosen: V1 });
    expect(made.looks[0]).toMatchObject({ chosen: LOOK, needed: true });
    expect(made.oneClick).toBe(true);
  });

  test("two candidates: Leave empty until chosen, and the substitution step is needed; a choice fills the slot", () => {
    const two = context({ subjects: [V1, V2], looks: [LOOK, OTHER_LOOK] }), made = ok(substitutionOf(eye, two));
    expect([made.subjects[0]!.chosen, made.looks[0]!.chosen, made.oneClick]).toEqual([undefined, undefined, false]);
    const chosen = ok(substitutionOf(eye, two, { subjects: { v1: V2 }, looks: { look1: OTHER_LOOK } }));
    expect([chosen.subjects[0]!.chosen, chosen.looks[0]!.chosen]).toEqual([V2, OTHER_LOOK]);
    expect(ok(substitutionOf(eye, two, { subjects: { v1: null } })).subjects[0]!.chosen).toBeUndefined();
  });

  test("M2: a V another tab shows shares that scene by default, New scene beside it; a look only the shared scene uses isn't asked for", () => {
    const shown = { scene: "s-a", kind: "character", tab: "t-a", subject: V1, look: LOOK };
    const two = context({ subjects: [V1], looks: [LOOK, OTHER_LOOK], scenes: [shown, { scene: "s-b", kind: "character", tab: "t-b", subject: V2 }] });
    const shared = ok(substitutionOf(eye, two));
    expect(shared.scenes[0]).toMatchObject({ shares: [shown], chosen: "s-a" });
    expect(shared.looks[0]!.needed).toBe(false);
    expect(shared.oneClick).toBe(true);
    expect(fillOf(shared).share).toEqual({ scene1: { scene: "s-a" } });
    // New scene: the look slot matters again, and with two looks the step is needed.
    const fresh = ok(substitutionOf(eye, two, { scenes: { scene1: null } }));
    expect([fresh.scenes[0]!.chosen, fresh.looks[0]!.needed, fresh.oneClick]).toEqual([undefined, true, false]);
    // Two scenes show the V: the first (the most recently focused) is the default, and the person chooses between them.
    const twice = ok(substitutionOf(eye, context({ subjects: [V1], scenes: [shown, { ...shown, scene: "s-c", tab: "t-c" }] })));
    expect([twice.scenes[0]!.chosen, twice.oneClick]).toEqual(["s-a", false]);
  });

  test("a choice naming something not on offer is refused with the reason", () => {
    const one = context({ subjects: [V1], looks: [LOOK], scenes: [{ scene: "s-a", kind: "character", tab: "t-a", subject: V1 }] });
    expect(substitutionOf(eye, one, { subjects: { v1: V2 } })).toEqual({ issue: "That V isn't in this profile any more." });
    expect(substitutionOf(eye, one, { looks: { look1: OTHER_LOOK } })).toEqual({ issue: "That look isn't available any more." });
    expect(substitutionOf(eye, one, { scenes: { scene1: "s-gone" } })).toEqual({ issue: "That scene doesn't show this V any more." });
    expect(substitutionOf(eye, one, { subjects: { v9: V1 } })).toEqual({ issue: "That choice names something this default doesn't have." });
  });

  test("in a session: New tab shares the scene the most recently focused view of the V shows; New scene makes one showing the chosen look", () => {
    const w = windowOn(), main = w.s.graph.viewIds()[0]!, mainScene = w.s.graph.node(main, "scene").id;
    const side = w.s.addView(main, {}, { title: "Side" }), sideScene = w.s.graph.node(side, "scene").id;
    w.s.focus.focusView(side);
    expect(w.tabs.substitution(EYE)).toMatchObject({ scenes: [{ chosen: sideScene, shares: [{ scene: sideScene }, { scene: mainScene }] }], oneClick: false });
    w.s.focus.focusView(main);
    expect(act(w, { kind: "tabs.new", default: EYE })).toBeUndefined();
    const shared = w.s.graph.viewIds().find(view => w.s.graph.tabOf(view) === w.s.tabId())!;
    expect(w.s.graph.node(shared, "scene").id).toBe(mainScene);
    expect(act(w, { kind: "tabs.new", default: EYE, choice: { scenes: { scene1: null }, looks: { look1: OTHER_LOOK } } })).toBeUndefined();
    const own = w.s.graph.viewIds().find(view => w.s.graph.tabOf(view) === w.s.tabId())!, scene = w.s.graph.node(own, "scene").id;
    expect(scene).not.toBe(mainScene);
    expect(w.s.scene(scene)).toEqual({ subject: V1, look: OTHER_LOOK, gen: 0 });
    // A choice not on offer is refused before anything changes.
    const stored = json(w.s.session());
    expect(act(w, { kind: "tabs.new", default: EYE, choice: { subjects: { v1: V2 } } })).toBe("That V isn't in this profile any more.");
    expect(json(w.s.session())).toBe(stored);
  });
});

describe("contributed defaults", () => {
  test("Eye makeup is today's factory arrangement in both size classes, with one V slot and one look slot; the minimal ones are early access", () => {
    const eye = STUDIO_LAYOUT_DEFAULTS.find(item => item.id === EYE)!;
    const factory = defaultDockState(viewCatalogue([SHELL_VIEW, EYE_MAKEUP_VIEW]));
    expect(JSON.parse(json(eye.fragment.tab.dock.state).replaceAll('"view:view1"', '"head"'))).toEqual(JSON.parse(json(factory)));
    expect(eye.fragment.subjects).toEqual([{ key: "v1", kinds: ["character"] }]);
    expect([eye.fragment.looks, eye.fragment.views.length]).toEqual([[{ key: "look1" }], 1]);
    expect(STUDIO_LAYOUT_DEFAULTS.map(item => [item.id, item.label, item.earlyAccess])).toEqual([[EYE, "Eye makeup", false],
      ["save-explorer/default", "Save Explorer", true], ["expressions/default", "Expressions", true], ["poses/default", "Poses", true]]);
    expect(STUDIO_LAYOUT_DEFAULTS.find(item => item.id === "save-explorer/default")!.fragment.views).toEqual([]);
  });

  test("they are immutable: frozen, refused by every command, and detached when listed; tabs made from them change nothing", () => {
    const deep = (value: unknown): boolean => !value || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(deep));
    expect(deep(STUDIO_LAYOUT_DEFAULTS)).toBe(true);
    const w = windowOn(), before = json(STUDIO_LAYOUT_DEFAULTS);
    for (const command of [{ kind: "rename", id: EYE, name: "Mine" }, { kind: "delete", id: EYE }, { kind: "restore", id: EYE },
      { kind: "update", id: EYE, fragment: STUDIO_LAYOUT_DEFAULTS[1]!.fragment }] as const)
      expect(w.defaults.dispatch(command)).toMatchObject({ ok: false, reason: "A feature's default can't be changed. Make a tab from it and save your own." });
    expect(act(w, { kind: "defaults.delete", default: EYE })).toBe("A feature's default can't be changed. Make a tab from it and save your own.");
    const listed = w.defaults.list() as unknown as { name: string }[];
    listed[0]!.name = "Changed";
    expect(w.defaults.list()[0]!.name).toBe("Eye makeup");
    act(w, { kind: "tabs.new", default: EYE });
    w.s.arrange(w.s.tabId(), dockOf(["presets"]));
    w.s.rename(w.s.tabId(), "Arranged");
    expect(act(w, { kind: "tabs.updateDefault", tab: w.s.tabId() })).toBe("This tab wasn't made from a default of yours. Save it as a new default instead.");
    expect(json(STUDIO_LAYOUT_DEFAULTS)).toBe(before);
  });

  test("the composition refuses a default naming a panel type, view tool, node kind or state the build lacks, or one contributed twice", () => {
    expect(contributedDefaultIssues(STUDIO_MODULES, STUDIO_FRAGMENT_KNOWLEDGE)).toEqual([]);
    const base = STUDIO_MODULES[0]!.defaults![0]!, fragment = base.fragment;
    const broken = (change: Partial<LayoutFragment>, id = "broken") => ({ ...base, id, fragment: { ...fragment, ...change } });
    const issues = contributedDefaultIssues([{ id: "probe", defaults: [
      broken({ panels: [...fragment.panels, { key: "nope", type: "nope.panel" }], tab: { ...fragment.tab, dock: dockOf(["view:view1", "nope"]) } }, "panel"),
      broken({ nodes: fragment.nodes.map(node => node.slot === "tools" ? { ...node, state: { on: { "nope.tool": true } } } : node) }, "tool"),
      broken({ nodes: fragment.nodes.map(node => node.slot === "lights" ? { ...node, kind: "sun" } : node) }, "kind"),
      broken({ nodes: fragment.nodes.map(node => node.slot === "scene" ? { ...node, state: { eyeShape: 99, normals: true } } : node) }, "state"),
      broken({}, "state"),
      broken({ views: [{ ...fragment.views[0]!, scene: "missing" }] }, "structure"),
    ] }], STUDIO_FRAGMENT_KNOWLEDGE);
    expect(issues).toEqual([
      "default probe/panel: panel type nope.panel isn't in this build",
      "default probe/tool: tools node tools1 names view tool nope.tool, which isn't in this build",
      "default probe/kind: lights node lights1 has kind sun, which this build can't show",
      "default probe/kind: view view1's camera or lights don't fit its scene",
      "default probe/state: scene node scene1 has state this build can't read",
      "default probe/state is contributed twice",
      "default probe/structure: view view1 names no scene node of the fragment",
    ]);
    expect(Object.isFrozen(contributedDefaults([{ id: "probe", label: "Probe", stage: "stable", defaults: [base] }])[0]!.fragment.nodes)).toBe(true);
  });

  test("the verification-only command prints a tab as a module's default, which reads back as the same data", () => {
    const w = windowOn();
    act(w, { kind: "tabs.new", default: "poses/default", choice: filled(STUDIO_LAYOUT_DEFAULTS.find(item => item.id === "poses/default")!.fragment) });
    const printed = printDefault(w.tabs.contributionOf(w.s.tabId(), { id: "default", name: "Poses", description: "Your V in 3D beside the pose library and Motion." }));
    expect(JSON.parse(printed)).toEqual(JSON.parse(json(STUDIO_MODULES.find(module => module.id === "poses")!.defaults![0])));
    expect(printed.split("\n").every(line => line.length <= 140)).toBe(true);
  });
});

describe("own defaults: Save as default, update, rename, delete and restore, through the outbox", () => {
  test("each command is one outbox write that reaches the library; names are checked; Update saves over only the tab's own default", async () => {
    const w = windowOn(), tab = w.s.tabId();
    w.s.arrange(tab, dockOf(["head", "presets"]));
    expect(act(w, { kind: "tabs.saveAsDefault", tab, name: "  " })).toBe("Name the default.");
    expect(act(w, { kind: "tabs.saveAsDefault", tab, name: "Eye makeup" })).toBeUndefined();
    const id = w.s.tab(tab)!.origin!;
    expect(id).toMatch(/^d-[0-9a-z]+$/);
    expect(w.defaults.get(id)).toMatchObject({ name: "Eye makeup", owner: { kind: "user" } });
    // Undo of Save as default puts the tab's origin back; the default stays (deleting it is its own command).
    expect(w.s.graph.undo()).toBe(true);
    expect(w.s.tab(tab)!.origin).toBeUndefined();
    expect(w.s.graph.redo()).toBe(true);
    // Names need not be unique (the coordinator's decision): the list tells same-named defaults apart by when each was saved.
    expect(act(w, { kind: "tabs.saveAsDefault", tab, name: "eye MAKEUP" })).toBeUndefined();
    const twin = w.s.tab(tab)!.origin!;
    expect(twin).not.toBe(id);
    expect(w.defaults.get(twin)!.owner).toMatchObject({ kind: "user", savedAt: expect.any(Number), createdAt: expect.any(Number) });
    expect(act(w, { kind: "defaults.delete", default: twin })).toBeUndefined();
    w.s.setOrigin(tab, id);
    await quiet(w.outbox);
    expect(w.documents.store.get<{ name: string }>(LAYOUT_DEFAULT_DOCUMENT, id)!.value.name).toBe("Eye makeup");
    // Update: the tab as it is now replaces the default's fragment; its name stays.
    w.s.arrange(tab, dockOf(["head", "presets", "layers"]));
    expect(act(w, { kind: "tabs.updateDefault", tab })).toBeUndefined();
    expect(json(w.defaults.get(id)!.fragment)).toBe(json(fragmentOfTab(w.s.session(), tab, { name: "Eye makeup" })));
    expect(act(w, { kind: "defaults.rename", default: id, name: "Mine" })).toBeUndefined();
    await quiet(w.outbox);
    const stored = w.documents.store.get<{ name: string; fragment: LayoutFragment }>(LAYOUT_DEFAULT_DOCUMENT, id)!.value;
    expect([stored.name, stored.fragment.panels.map(panel => panel.key)]).toEqual(["Mine", ["presets", "help", "layers"]]);
    // Delete: a tombstone; the tab made from it keeps working; restore brings it back.
    expect(act(w, { kind: "defaults.delete", default: id })).toBeUndefined();
    expect(w.defaults.get(id)).toBeUndefined();
    expect(act(w, { kind: "tabs.updateDefault", tab })).toBe("This tab wasn't made from a default of yours. Save it as a new default instead.");
    expect(act(w, { kind: "tabs.reset", tab })).toBe("That default was deleted.");
    await quiet(w.outbox);
    expect(isTombstone(w.documents.store.get(LAYOUT_DEFAULT_DOCUMENT, id)!.value)).toBe(true);
    expect(act(w, { kind: "defaults.restore", default: id })).toBeUndefined();
    expect(w.defaults.get(id)!.name).toBe("Mine");
    expect(act(w, { kind: "defaults.restore", default: id })).toBe("That default isn't deleted.");
    await quiet(w.outbox);
    expect(w.documents.store.get<{ name: string }>(LAYOUT_DEFAULT_DOCUMENT, id)!.value.name).toBe("Mine");
  });

  test("own defaults survive a restart: before the library has them (the outbox replays them) and after", async () => {
    const documents = storeDocuments(), storage = memoryOutboxStorage(), a = windowOn(documents, storage);
    expect(act(a, { kind: "tabs.saveAsDefault", tab: a.s.tabId(), name: "Before" })).toBeUndefined();
    // What a command names as its base starts again at the library's revision when a window opens: the rest is the same bytes.
    const listed = (w: Window) => { const { owner: _owner, ...rest } = w.defaults.get(id)!; return json(rest); };
    const id = a.s.tab(a.s.tabId())!.origin!, saved = listed(a);
    // The window closes before the library has it: the command waits in the outbox's storage, written synchronously.
    a.outbox.stop();
    expect(documents.store.get(LAYOUT_DEFAULT_DOCUMENT, id)).toBeNull();
    // Reopened while the library is still unreachable: the default is there, from the outbox alone.
    const unreachable = { ...documents, transact: () => new Promise<never>(() => {}) };
    const b = windowOn(unreachable, storage);
    await b.defaults.load();
    expect(listed(b)).toBe(saved);
    expect(act(b, { kind: "tabs.new", default: id })).toBeUndefined();
    b.outbox.stop();
    // Reopened with the library reachable: the outbox replays it there.
    const reached = windowOn(documents, storage);
    await reached.defaults.load();
    await quiet(reached.outbox);
    expect(documents.store.get<{ name: string }>(LAYOUT_DEFAULT_DOCUMENT, id)!.value.name).toBe("Before");
    // After: a window with a fresh outbox reads it from the library.
    const c = windowOn(documents);
    await c.defaults.load();
    expect(listed(c)).toBe(saved);
    expect(act(c, { kind: "tabs.new", default: id })).toBeUndefined();
  });

  test("two windows renaming one default: the second to reach the library is a conflict, resolved either way, never written over", async () => {
    const documents = storeDocuments(), a = windowOn(documents);
    expect(act(a, { kind: "tabs.saveAsDefault", tab: a.s.tabId(), name: "Shared" })).toBeUndefined();
    const id = a.s.tab(a.s.tabId())!.origin!;
    await quiet(a.outbox);
    const b = windowOn(documents);
    await b.defaults.load();
    expect(act(b, { kind: "defaults.rename", default: id, name: "B's name" })).toBeUndefined();
    await quiet(b.outbox);
    expect(act(a, { kind: "defaults.rename", default: id, name: "A's name" })).toBeUndefined();
    await quiet(a.outbox);
    expect(a.defaults.conflicts().length).toBe(1);
    expect(documents.store.get<{ name: string }>(LAYOUT_DEFAULT_DOCUMENT, id)!.value.name).toBe("B's name");
    expect(a.defaults.resolve(a.defaults.conflicts()[0]!.id, "theirs")).toEqual({ available: true });
    expect(a.defaults.get(id)!.name).toBe("B's name");
    // Again, keeping mine this time: an explicit command over theirs.
    await b.outbox.check();
    expect(act(b, { kind: "defaults.rename", default: id, name: "B again" })).toBeUndefined();
    await quiet(b.outbox);
    expect(act(a, { kind: "defaults.rename", default: id, name: "A again" })).toBeUndefined();
    await quiet(a.outbox);
    expect(a.defaults.resolve(a.defaults.conflicts()[0]!.id, "mine")).toEqual({ available: true });
    await quiet(a.outbox);
    expect(a.defaults.conflicts()).toEqual([]);
    expect(documents.store.get<{ name: string }>(LAYOUT_DEFAULT_DOCUMENT, id)!.value.name).toBe("A again");
  });

  test("validation on read: a newer build's or a damaged default is listed with the reason, can be renamed or deleted, and makes no tab", async () => {
    const w = windowOn(), eye = STUDIO_LAYOUT_DEFAULTS[0]!.fragment;
    const put = (id: string, fragment: unknown, name = id) => w.documents.store.transact({ id: `put-${id}`, command: "x", writes: [{ kind: LAYOUT_DEFAULT_DOCUMENT, id, base: 0,
      value: { schema: LAYOUT_DEFAULT_SCHEMA, id, name, owner: "user", fragment, createdAt: 5, future: { kept: true } } }] });
    put("d-newer1", { ...eye, panels: [...eye.panels, { key: "x", type: "future.panel" }] }, "Newer");
    put("d-broken1", { ...eye, views: [{ ...eye.views[0]!, scene: "gone" }] }, "Broken");
    w.documents.store.transact({ id: "put-junk", command: "x", writes: [{ kind: LAYOUT_DEFAULT_DOCUMENT, id: "d-junk1", base: 0, value: { schema: "other" } }] });
    await w.defaults.load();
    expect(w.defaults.list().filter(item => item.owner.kind === "user").map(item => [item.name, item.unavailable])).toEqual([
      ["Newer", "This default was saved by a newer version of XF Studio, so a tab can't be made from it here."],
      ["Broken", "This default can't be read, so a tab can't be made from it."]]);
    expect(act(w, { kind: "tabs.new", default: "d-newer1" })).toBe("This default was saved by a newer version of XF Studio, so a tab can't be made from it here.");
    expect(act(w, { kind: "defaults.rename", default: "d-newer1", name: "Kept" })).toBeUndefined();
    await quiet(w.outbox);
    // Written again with the fields this build doesn't know kept.
    expect(w.documents.store.get<Record<string, unknown>>(LAYOUT_DEFAULT_DOCUMENT, "d-newer1")!.value).toMatchObject({ name: "Kept", future: { kept: true } });
    expect(act(w, { kind: "defaults.delete", default: "d-broken1" })).toBeUndefined();
  });
});

describe("reset to default", () => {
  test("a tab resets to the default it was made from (or one named); what it held is a closed fragment; the drawn view's tab resets too", () => {
    const w = windowOn();
    expect(act(w, { kind: "tabs.reset", tab: w.s.tabId() })).toBe("This tab wasn't made from a default. Choose one to reset it to.");
    // The tab holding the view the window draws (its only view) resets; the window then draws the view the default made (P2-iii).
    const first = w.s.tabId(), drawnBefore = drawnView(w.s);
    expect(act(w, { kind: "tabs.reset", tab: first, default: EYE })).toBeUndefined();
    expect(w.s.graph.has(drawnBefore!)).toBe(false);
    expect(w.s.graph.tabOf(drawnView(w.s)!)).toBe(first);
    expect(w.s.graph.undo()).toBe(true);
    expect(drawnView(w.s)).toBe(drawnBefore);
    expect(act(w, { kind: "tabs.new", default: "poses/default", choice: { scenes: { scene1: null } } })).toBeUndefined();
    const tab = w.s.tabId(), before = json(w.s.session());
    w.s.arrange(tab, dockOf(["presets"]));
    w.s.rename(tab, "Mine");
    expect(act(w, { kind: "tabs.reset", tab })).toBeUndefined();
    expect(w.s.tab(tab)).toMatchObject({ name: "Mine", origin: "poses/default" });
    expect(w.s.closedTabs().at(-1)).toMatchObject({ reset: true, tab: { id: tab, name: "Mine" } });
    // Reset to another default; Undo twice and Redo twice are byte-identical moves.
    const reset = json(w.s.session());
    expect(act(w, { kind: "tabs.reset", tab, default: "expressions/default" })).toBeUndefined();
    expect(w.s.tab(tab)!.origin).toBe("expressions/default");
    const again = json(w.s.session());
    expect(w.s.graph.undo()).toBe(true);
    expect(json(w.s.session())).toBe(reset);
    expect(w.s.graph.redo()).toBe(true);
    expect(json(w.s.session())).toBe(again);
    expect(json(w.s.session())).not.toBe(before);
  });
});

describe("review P2-2's findings", () => {
  const eye = STUDIO_LAYOUT_DEFAULTS.find(item => item.id === EYE)!.fragment;
  const titled = (title: string): LayoutFragment => ({ ...eye, views: [{ ...eye.views[0]!, title }] });
  const putDefault = (w: Window, id: string, fragment: unknown) => w.documents.store.transact({ id: `put-${id}`, command: "x", writes: [{ kind: LAYOUT_DEFAULT_DOCUMENT,
    id, base: 0, value: { schema: LAYOUT_DEFAULT_SCHEMA, id, name: id, owner: "user", fragment, createdAt: 5 } }] });
  /** The session as a restart reads it: stored, read back, and opened over the Studio's graph. */
  const restarted = (s: ProfileSessions) => openSession(profileSessionOf(JSON.parse(JSON.stringify(s.session())))!, { random: seededRandom(3) });

  test("finding 1: a fragment is checked against what a restart reads back; a 60-character view title survives one, a 61-character one is refused", async () => {
    expect(buildIssues(titled("x".repeat(60)), STUDIO_FRAGMENT_KNOWLEDGE)).toEqual([]);
    expect(fragmentIssues(titled("x".repeat(61)))).toEqual(["view view1 has an unusable title"]);
    const w = windowOn();
    putDefault(w, "d-title60", titled("x".repeat(60)));
    putDefault(w, "d-title61", titled("x".repeat(61)));
    await w.defaults.load();
    expect(w.defaults.get("d-title61")!.unavailable).toBe("This default can't be read, so a tab can't be made from it.");
    expect(act(w, { kind: "tabs.new", default: "d-title61" })).toBe("This default can't be read, so a tab can't be made from it.");
    expect(act(w, { kind: "tabs.new", default: "d-title60", choice: { scenes: { scene1: null } } })).toBeUndefined();
    const views = w.s.graph.data().views, after = restarted(w.s);
    expect(after.graph.data().views).toEqual(views);
    expect(after.graph.data().views.some(view => (view as { title?: string }).title === "x".repeat(60))).toBe(true);
    // The graph refuses to hold what it couldn't read back: a 61-character title made into content anyway changes nothing.
    const stored = json(w.s.session());
    expect(() => w.s.newTab(instantiateFragment(titled("x".repeat(61)), {}, w.s, { name: "Long" }))).toThrow("That view can't be added.");
    expect(json(w.s.session())).toBe(stored);
    // What only the session's own reader refuses is caught by reading back too: a panel type no stored instance ID can name.
    const lenient = { ...STUDIO_FRAGMENT_KNOWLEDGE, panel: () => true };
    expect(buildIssues({ ...eye, panels: [...eye.panels, { key: "odd", type: "Odd_Type" }],
      tab: { ...eye.tab, dock: dockOf(["view:view1", "odd"]) } }, lenient)).toEqual(["a panel of a tab made from it wouldn't read back after a restart"]);
  });

  test("finding 2: a shared scene shares its lighting (M2): a lighting change in one tab is seen in the other, and stays shared after a restart", () => {
    const w = windowOn(), main = w.s.graph.viewIds()[0]!;
    expect(act(w, { kind: "tabs.new", default: EYE })).toBeUndefined();
    const other = w.s.graph.viewIds().find(view => w.s.graph.tabOf(view) === w.s.tabId())!;
    expect(w.s.graph.node(other, "scene").id).toBe(w.s.graph.node(main, "scene").id);
    expect(w.s.graph.node(other, "lights").id).toBe(w.s.graph.node(main, "lights").id);
    const lights = w.s.graph.state<{ creatorLighting: Record<string, unknown> }>(main, "lights");
    w.s.graph.edit(other, "lights", { state: { creatorLighting: { ...lights.creatorLighting, exposure: 2 } } });
    expect(w.s.graph.state<{ creatorLighting: { exposure: number } }>(main, "lights").creatorLighting.exposure).toBe(2);
    // After a restart the two views still share one lights node (the main view's state then comes from the workspace's preview fields).
    const after = restarted(w.s);
    expect(after.graph.node(other, "lights").id).toBe(after.graph.node(main, "lights").id);
    // New scene: its own lights, as before.
    expect(act(w, { kind: "tabs.new", default: EYE, choice: { scenes: { scene1: null }, looks: { look1: LOOK } } })).toBeUndefined();
    const own = w.s.graph.viewIds().find(view => w.s.graph.tabOf(view) === w.s.tabId())!;
    expect(w.s.graph.node(own, "lights").id).not.toBe(w.s.graph.node(main, "lights").id);
  });

  test("finding 3: node state can't hold an identity or what a scene shows; a tab's are made only from fresh IDs and the substitution", () => {
    const sneaky = { ...eye, nodes: eye.nodes.map(node => node.slot === "scene" ? { ...node, state: { ...node.state, id: "s-forced", subject: V2, gen: 7 } } : node) };
    expect(fragmentIssues(sneaky)).toEqual(["scene node scene1's state holds id, which only the tab it makes may give",
      "scene node scene1's state holds subject, which only the tab it makes may give", "scene node scene1's state holds gen, which only the tab it makes may give"]);
    const w = windowOn(), content = instantiateFragment(sneaky, { subjects: { v1: null }, looks: { look1: null } }, w.s, { name: "Sneaky" });
    const scene = content.nodes.find(item => item.slot === "scene")!.node as Record<string, unknown>;
    expect(scene.id).not.toBe("s-forced");
    expect([scene.subject, scene.look, scene.gen]).toEqual([undefined, undefined, 0]);
  });

  test("finding 4: a deleted V is never a candidate, and a choice of one made before it was deleted is refused when dispatched", () => {
    const w = windowOn(undefined, undefined, { profile: { subjects: [V1, V2], looks: [LOOK.look] } });
    w.deleted.add(V1.id);
    // V1 is deleted though its scene is still shown: V2 alone is offered, named, and the tab is one click with a new scene.
    expect(w.tabs.substitution(EYE)).toMatchObject({ subjects: [{ candidates: [V2], chosen: V2 }], scenes: [{ shares: [] }], oneClick: true });
    w.deleted.add(V2.id);
    expect(w.tabs.substitution(EYE)).toMatchObject({ subjects: [{ candidates: [] }], oneClick: true });
    w.deleted.delete(V2.id);
    const action = { kind: "tabs.new" as const, default: EYE, choice: { subjects: { v1: V2 } } };
    expect(w.tabs.capability(action)).toEqual({ available: true });
    w.deleted.add(V2.id);
    const stored = json(w.s.session());
    expect(() => w.tabs.dispatch(action)).toThrow("That V isn't in this profile any more.");
    expect(json(w.s.session())).toBe(stored);
  });

  test("finding 5: names need not be unique, in one window or two; both defaults are kept and told apart by when they were saved", async () => {
    const documents = storeDocuments(), a = windowOn(documents), b = windowOn(documents);
    expect(act(a, { kind: "tabs.saveAsDefault", tab: a.s.tabId(), name: "Same" })).toBeUndefined();
    expect(act(b, { kind: "tabs.saveAsDefault", tab: b.s.tabId(), name: "Same" })).toBeUndefined();
    expect(act(a, { kind: "tabs.saveAsDefault", tab: a.s.tabId(), name: "Same" })).toBeUndefined();
    await quiet(a.outbox); await quiet(b.outbox);
    await a.outbox.check();
    const same = a.defaults.list().filter(item => item.name === "Same");
    expect(same.length).toBe(3);
    expect(same.every(item => item.owner.kind === "user" && item.owner.savedAt > 0)).toBe(true);
    expect(a.defaults.conflicts()).toEqual([]);
  });

  test("finding 6: an open window finds a default another window saved at its next revision check, keeping its own pending writes", async () => {
    const documents = storeDocuments(), a = windowOn(documents);
    expect(act(a, { kind: "tabs.saveAsDefault", tab: a.s.tabId(), name: "First" })).toBeUndefined();
    const first = a.s.tab(a.s.tabId())!.origin!;
    await quiet(a.outbox);
    // B is open and loaded; its library writes don't get through, so its rename of First stays pending.
    const b = windowOn({ ...documents, transact: () => new Promise<never>(() => {}) });
    await b.defaults.load();
    expect(act(b, { kind: "defaults.rename", default: first, name: "B's pending name" })).toBeUndefined();
    expect(act(a, { kind: "tabs.saveAsDefault", tab: a.s.tabId(), name: "Second" })).toBeUndefined();
    const second = a.s.tab(a.s.tabId())!.origin!;
    await quiet(a.outbox);
    expect(b.defaults.get(second)).toBeUndefined();
    await b.outbox.check();
    expect(b.defaults.get(second)!.name).toBe("Second");
    expect(b.defaults.get(first)!.name).toBe("B's pending name");
  });
});
