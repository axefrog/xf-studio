/**
 * The game's character-preview idles read from the player's own game files (knowledge/body-animation.md §2), pure and shared by the host
 * and the page: which body clips the preview puppet's body graph loops on which screen (`previewIdles`, the rule `tools/prepare_body_idles.py`
 * applied to WolvenKit's JSON, now applied to the native reader's), the catalogue the page reads (idle-catalogue.ts), and the rigs' rest
 * poses and joint ancestry the page builds the idle's skeleton from. No Three, no file system.
 *
 * The body motion itself is a `xfs/pose-sample-1` record (pose-sample.ts) with every frame of the clip (`motion`), decoded from the set's
 * clip (anim-set.ts, SIMD for the preview idles) on the rig the set names; the page turns it into a clip as it does a moving pose
 * (pose-clip.ts). The face's idle is solved on the host by XF Studio's own facial solver (idle-host.ts `face`); which face clip each idle
 * plays is `faceClipFor`.
 */
import { IDLE_CATALOGUE_SCHEMA, type IdleCatalogue, type IdleEntry, type IdleScreen } from "./idle-catalogue";

export const IDLE_STATE_SCHEMA = "xfs/idle-state-1";
/** A joint's rest, local to its parent, in game space (Z up): the rig's A pose where it has one, else its reference pose. */
export type RestJoint = { readonly bone: string; readonly parent: string | null; readonly translation: readonly number[]; readonly rotation: readonly number[];
  readonly scale: readonly number[] };
/**
 * What the page reads to play the idles (`GET /api/idles`):
 * - `source`: `game`, read from the player's game files by XF Studio itself (both hosts); `prepared`, the developer preparation's files
 *   under `/assets/` (localhost with `XFS_IDLE_SOURCE=prepared`, the Python oracle).
 * - `catalogue`: the idles (idle-catalogue.ts); an entry's `face` is set where XF Studio can solve its face from the game files (`faceReason`
 *   says why not, in plain words, when none can be). `facePending`: the face is still being read; the state answers without waiting for
 *   it and the page asks again until it is gone (PREV-174).
 * - `rig`: the body clips' rig and its rest (the skeleton the clips play on), `ancestry`: the face rig's parents (the head's joints follow
 *   their nearest driven ancestor), `face`: the face rig's rest (the eyes' gaze pivots when no face clip is loaded).
 */
export type IdleState =
  | { readonly schema: typeof IDLE_STATE_SCHEMA; readonly phase: "needs-setup" | "preparing" | "failed"; readonly message: string }
  | { readonly schema: typeof IDLE_STATE_SCHEMA; readonly phase: "ready"; readonly message: ""; readonly source: "game"; readonly catalogue: IdleCatalogue;
      readonly rig: { readonly path: string; readonly joints: readonly RestJoint[] }; readonly ancestry: Readonly<Record<string, string | null>>;
      readonly face: { readonly path: string; readonly joints: readonly RestJoint[] } | null; readonly faceReason?: string; readonly facePending?: true }
  | { readonly schema: typeof IDLE_STATE_SCHEMA; readonly phase: "ready"; readonly message: ""; readonly source: "prepared"; readonly catalogue: IdleCatalogue };

type Json = unknown;
type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
/** A CName or name-holding value's text, as WolvenKit's JSON (and the native reader's, the same shape) writes it. */
function text(value: Json): unknown {
  if (isObject(value)) {
    if ("$value" in value) return value.$value;
    if ("name" in value) return text(value.name);
  }
  return value;
}

/** Studio labels by entry id; an entry the graph adds later gets its clip name. */
export const IDLE_LABELS: Readonly<Record<string, string>> = { closeup: "Creator close-up", fullbody: "Creator full body", inventory: "Inventory",
  nails: "Creator nails", "gender-selection": "Gender selection" };
/** The Motion panel's order; others follow in graph order. */
export const IDLE_ORDER = ["closeup", "closeup-eyes", "fullbody", "inventory", "nails", "gender-selection"] as const;

export type GraphIdle = { id: string; clip: string; screen: IdleScreen; state: string; flags: string[]; evidence: string };

/**
 * The looping body clips of the preview screens in a body graph (`player_paperdoll.animgraph`), with the state, the `Paperdoll` flags its
 * transitions test and the screen each loops on, and the looping clips left out (weapon idles). Every looping clip of a state-machine state
 * is an idle of that state; a looping clip the screens' switch (and the switches directly above it) plays directly is a screen of its own.
 * Traversal orders follow the tool this replaces, so the same graph gives the same entries.
 */
export function previewIdles(root: JsonObject): { entries: GraphIdle[]; left: { clip: string; why: string }[] } {
  // Every handle's data by id (first seen), walking handle wrappers into their data only.
  const nodes = new Map<string, JsonObject>();
  const stack: Json[] = [root];
  while (stack.length) {
    const o = stack.pop();
    if (Array.isArray(o)) { stack.push(...o); continue; }
    if (!isObject(o)) continue;
    if ("HandleId" in o && "Data" in o) {
      const id = String(o.HandleId);
      if (!nodes.has(id) && isObject(o.Data)) { nodes.set(id, o.Data); stack.push(o.Data); }
      continue;
    }
    stack.push(...Object.values(o));
  }
  // Each node's direct handle references (wrappers or `HandleRefId`s), not descending into them.
  const refs = (data: JsonObject): string[] => {
    const out: string[] = [], todo: Json[] = [data];
    while (todo.length) {
      const o = todo.pop();
      if (Array.isArray(o)) { todo.push(...o); continue; }
      if (!isObject(o)) continue;
      if ("HandleId" in o && "Data" in o) { out.push(String(o.HandleId)); continue; }
      if ("HandleRefId" in o) { out.push(String(o.HandleRefId)); continue; }
      todo.push(...Object.values(o));
    }
    return out;
  };
  const children = new Map<string, string[]>([...nodes].map(([id, data]) => [id, refs(data).filter(child => nodes.has(child))]));
  const parents = new Map<string, Set<string>>();
  for (const [id, kids] of children) for (const kid of kids) { const set = parents.get(kid) ?? new Set(); set.add(id); parents.set(kid, set); }
  const type = (id: string) => String(nodes.get(id)?.$type ?? "");
  const ancestors = (id: string): string[] => {
    const seen: string[] = [], todo = [id];
    while (todo.length) for (const p of parents.get(todo.pop()!) ?? []) if (!seen.includes(p)) { seen.push(p); todo.push(p); }
    return seen;
  };
  const descendants = (id: string): string[] => {
    const out: string[] = [], seen = new Set<string>(), todo = [...children.get(id) ?? []];
    while (todo.length) {
      const x = todo.pop()!;
      if (seen.has(x)) continue;
      seen.add(x); out.push(x);
      if (type(x) !== "animAnimNode_StateMachine") todo.push(...children.get(x) ?? []);
    }
    return out;
  };
  const flagsOf = (machine: string) => {
    const found = new Set<string>();
    for (const id of [machine, ...descendants(machine)]) {
      const d = nodes.get(id)!;
      if (String(d.$type).startsWith("animAnimStateTransitionCondition_") && text(d.featureName) === "Paperdoll") found.add(String(text(d.featurePropertyName)));
    }
    return [...found].sort();
  };
  const looping = new Map<string, string>();
  for (const [id, d] of nodes) if (d.$type === "animAnimNode_SkAnim" && (d.isLooped ?? 1)) looping.set(id, String(text(d.animation)));
  const machines = [...nodes.keys()].filter(id => type(id) === "animAnimNode_StateMachine");
  const entries: GraphIdle[] = [], seen = new Set<string>();
  for (const machine of machines) {
    const flags = flagsOf(machine);
    for (const state of children.get(machine)!.filter(id => type(id) === "animAnimNode_State")) {
      for (const id of descendants(state)) {
        const clip = looping.get(id);
        if (clip === undefined || seen.has(clip)) continue;
        seen.add(clip);
        const screen: IdleScreen = flags.some(flag => flag.startsWith("inventoryScreen")) ? "inventory" : "creator";
        const name = String(text(nodes.get(state)!.name));
        entries.push({ id: screen === "inventory" ? "inventory" : flags.includes("characterCreation_Nails") ? "nails" : name.toLowerCase(), clip, screen, state: name, flags,
          evidence: `[resource] player_paperdoll.animgraph: looping SkAnim in state \`${name}\` of a state machine${flags.length ? ` testing ${flags.join(", ")}` : ""}` });
      }
    }
  }
  // The screens' switch: the nearest switch every state machine descends from, and the switches directly above it.
  let common: string[] | null = null;
  for (const machine of machines) {
    const chain = ancestors(machine).filter(id => type(id) === "animAnimNode_Switch");
    common = common === null ? chain : common.filter(id => chain.includes(id));
  }
  if (common?.length) {
    const nearest = common.find(c => common!.every(other => other === c || ancestors(c).includes(other)));
    const switches = nearest ? [nearest] : [];
    while (switches.length) {
      const above = [...parents.get(switches.at(-1)!) ?? []].filter(id => type(id) === "animAnimNode_Switch");
      if (above.length !== 1) break;
      switches.push(above[0]!);
    }
    for (const id of switches.flatMap(sw => children.get(sw) ?? [])) {
      const clip = looping.get(id);
      if (clip === undefined || seen.has(clip)) continue;
      seen.add(clip);
      entries.push({ id: clip.toLowerCase().replaceAll("ui_", "").replaceAll("_", "-"), clip, screen: clip.toLowerCase().includes("gender") ? "gender" : "creator",
        state: "switch input", flags: [], evidence: "[resource] player_paperdoll.animgraph: looping SkAnim played directly by the preview screens' switch" });
    }
  }
  const left = [...new Set(looping.values())].filter(clip => !seen.has(clip)).sort()
    .map(clip => ({ clip, why: "a held weapon's idle (the inventory's weapon view); the Studio draws no weapon" }));
  return { entries, left };
}

/**
 * The face clip an idle plays from the creator puppet's face set: the clip of the idle's own name (the face graph loops each screen's face
 * with its body), else, on the inventory screen, the close-up's (it loops the close-up face after a one-shot pickup); null when the set has
 * neither [resource: research/animation/cc-idle.md].
 */
export function faceClipFor(entry: { clip: string; screen: IdleScreen }, clips: ReadonlyMap<string, unknown>): string | null {
  const own = [...clips.keys()].find(name => name.toLowerCase() === entry.clip.toLowerCase());
  if (own) return own;
  return entry.screen === "inventory" && clips.has("ui_closeup_shot") ? "ui_closeup_shot" : null;
}

/** The asset name the developer preparation gives an idle's body clip (kept as the entry's key, so both sources name entries alike). */
export const bodyAssetName = (clip: string) => clip === "ui_closeup_shot" ? "cc-idle-body.glb" : `cc-idle-body-${clip.toLowerCase()}.glb`;
/** The eyes-section entry: the close-up body with the creator's eyes showcase on the face (only where the face can be solved). */
export const EYES_SECTION_ID = "closeup-eyes";

/**
 * The catalogue for the graph's idles: each entry's clip length from its set, its face where one can be solved (`faces`, by entry id; the
 * eyes-section entry only then), the creator's puppet for the creator's screens (lifted feet).
 */
export function idleCatalogue(input: { entries: readonly GraphIdle[]; left: { clip: string; why: string }[]; durations: ReadonlyMap<string, number>;
  source: IdleCatalogue["source"]; faces?: ReadonlyMap<string, IdleEntry> }): IdleCatalogue {
  const idles: IdleEntry[] = [];
  for (const entry of input.entries) {
    const duration = input.durations.get(entry.clip);
    if (!(duration && duration > 0)) continue;
    idles.push({ id: entry.id, label: IDLE_LABELS[entry.id] ?? entry.clip, clip: entry.clip, body: bodyAssetName(entry.clip), duration: Math.round(duration * 1000) / 1000,
      screen: entry.screen, state: entry.state, flags: entry.flags, face: input.faces?.get(entry.id)?.face ?? null,
      puppet: entry.screen === "inventory" ? null : "creator", evidence: entry.evidence });
  }
  const closeup = idles.find(entry => entry.id === "closeup"), eyes = input.faces?.get(EYES_SECTION_ID);
  if (closeup && eyes?.face) idles.push({ ...closeup, id: EYES_SECTION_ID, label: eyes.label, state: eyes.state, flags: eyes.flags, face: eyes.face, evidence: eyes.evidence });
  const rank = (id: string) => { const i = (IDLE_ORDER as readonly string[]).indexOf(id); return i < 0 ? IDLE_ORDER.length : i; };
  idles.sort((a, b) => rank(a.id) - rank(b.id));
  return { schema: IDLE_CATALOGUE_SCHEMA, source: input.source, idles, left: input.left };
}

/** A rig's joints at rest with their parents' names: its A pose where it has one per joint, else its reference pose. */
export function restJoints(rig: { bones: readonly string[]; parents: readonly number[]; reference: readonly { translation: readonly number[]; rotation: readonly number[];
  scale: readonly number[] }[]; aPose?: readonly { translation: readonly number[]; rotation: readonly number[]; scale: readonly number[] }[] }): RestJoint[] {
  const pose = rig.aPose && rig.aPose.length === rig.bones.length ? rig.aPose : rig.reference;
  return rig.bones.map((bone, i) => ({ bone, parent: rig.parents[i]! >= 0 ? rig.bones[rig.parents[i]!]! : null,
    translation: [...pose[i]!.translation], rotation: [...pose[i]!.rotation], scale: [...pose[i]!.scale] }));
}

/**
 * The face rig's ancestry for the idle's binding: each joint's parent, a root under the skeleton's `Armature` node (the name the body
 * clips' skeleton root has on the page, as in the developer preparation's binding).
 */
export function rigAncestry(joints: readonly RestJoint[]): Record<string, string | null> {
  const out: Record<string, string | null> = { Armature: null };
  for (const joint of joints) out[joint.bone] = joint.parent ?? "Armature";
  return out;
}
