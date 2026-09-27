/**
 * The game's own character-preview idles (knowledge/body-animation.md §2): the looping body clips the character creator and the
 * inventory play on V, as `tools/prepare_body_idles.py` finds them in the preview puppet's body graph (`player_paperdoll.animgraph`)
 * and decodes them from its animation set (`ui_female.anims`) on this computer. Pure: the catalogue's shape, its reader, and the
 * built-in entry an older local preparation (the close-up idle alone) stands for.
 *
 * Each entry names its body clip, the face clip the face graph loops with it (baked offline like the close-up's), the screen and graph
 * state it comes from, and the puppet whose feet it is authored for: the creator's idles for the creator puppet's lifted feet
 * (`character_creation`), the inventory's for the feet the footwear gives (flat when barefoot).
 */
export const IDLE_CATALOGUE_SCHEMA = "xfs/idle-catalogue-1";
/** The catalogue beside the other local idle assets. */
export const IDLE_CATALOGUE_ASSET = "/assets/cc-idle-catalogue.json";
/** The idle the Studio plays by default: the creator's close-up (the eye-makeup workflow is judged in it). */
export const DEFAULT_IDLE = "closeup";

export type IdleScreen = "creator" | "inventory" | "gender";
export type IdleEntry = {
  /** Stable key (workspace, actions): lower case, digits, `-`. */
  id: string;
  label: string;
  /** Body clip name in the set, and its asset file under `/assets/`. */
  clip: string; body: string;
  duration: number;
  screen: IdleScreen;
  /** The body graph state (and the `AnimFeature_Paperdoll` flags its transitions test) it loops in. */
  state: string; flags: string[];
  /** The face clip looped with it and its baked asset, or null when none was baked (the face then keeps the close-up's). */
  face: { clip: string; file: string } | null;
  /** The puppet whose bare feet the clip is authored for: `creator` (lifted), or null (the footwear decides). */
  puppet: "creator" | null;
  /** Evidence grades and a short basis for the entry (knowledge/README.md grades). */
  evidence: string;
};
export type IdleCatalogue = { schema: typeof IDLE_CATALOGUE_SCHEMA; source: { graph: string; set: string; rig: string }; idles: IdleEntry[];
  /** Looping clips of the graph the catalogue leaves out, and why (weapon idles, clips the graph never loops). */
  left: { clip: string; why: string }[] };

/** What an older preparation (prepare_idle.py alone) holds: the close-up idle and its face. */
export const BUILT_IN_CATALOGUE: IdleCatalogue = Object.freeze({
  schema: IDLE_CATALOGUE_SCHEMA,
  source: { graph: "base\\gameplay\\anim_graphs\\player_paperdoll.animgraph", set: "base\\animations\\ui\\female\\ui_female.anims",
    rig: "base\\characters\\base_entities\\woman_base\\woman_base.rig" },
  idles: [{ id: DEFAULT_IDLE, label: "Creator close-up", clip: "ui_closeup_shot", body: "cc-idle-body.glb", duration: 12.33, screen: "creator",
    state: "closeup", flags: ["characterCreation_Head"], face: { clip: "ui_closeup_shot", file: "cc-idle-face.glb" }, puppet: "creator",
    evidence: "[resource] player_paperdoll.animgraph state machine `closeup`" }],
  left: [],
}) as IdleCatalogue;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/, FILE = /^[A-Za-z0-9_.-]{1,80}\.glb$/, CLIP = /^[A-Za-z0-9_]{1,80}$/;
/** The catalogue as the page reads it: every entry well formed, ids unique, at most 32; anything else throws. */
export function parseIdleCatalogue(value: unknown): IdleCatalogue {
  const fail = (why: string): never => { throw Error(`The idle catalogue is invalid: ${why}.`); };
  const doc = value as IdleCatalogue;
  if (!doc || doc.schema !== IDLE_CATALOGUE_SCHEMA || !Array.isArray(doc.idles) || !doc.idles.length || doc.idles.length > 32) fail("not a catalogue");
  const text = (s: unknown, max = 200) => typeof s === "string" && s.length > 0 && s.length <= max ? s : fail("a text");
  const idles = doc.idles.map((entry): IdleEntry => ({
    id: ID.test(entry?.id) ? entry.id : fail("an id"), label: text(entry.label, 60), clip: CLIP.test(entry.clip) ? entry.clip : fail("a clip"),
    body: FILE.test(entry.body) ? entry.body : fail("a body file"),
    duration: typeof entry.duration === "number" && entry.duration > 0 && entry.duration < 600 ? entry.duration : fail("a duration"),
    screen: (["creator", "inventory", "gender"] as const).includes(entry.screen) ? entry.screen : fail("a screen"),
    state: text(entry.state, 60), flags: Array.isArray(entry.flags) && entry.flags.length <= 16 ? entry.flags.map(flag => text(flag, 60)) : fail("flags"),
    face: entry.face === null ? null : { clip: CLIP.test(entry.face?.clip) ? entry.face.clip : fail("a face clip"),
      file: FILE.test(entry.face?.file) ? entry.face.file : fail("a face file") },
    puppet: entry.puppet === "creator" || entry.puppet === null ? entry.puppet : fail("a puppet"),
    evidence: text(entry.evidence, 400) }));
  if (new Set(idles.map(entry => entry.id)).size !== idles.length) fail("a repeated id");
  const left = Array.isArray(doc.left) ? doc.left.slice(0, 64).map(item => ({ clip: text(item?.clip, 80), why: text(item?.why, 200) })) : [];
  const source = { graph: text(doc.source?.graph, 260), set: text(doc.source?.set, 260), rig: text(doc.source?.rig, 260) };
  return { schema: IDLE_CATALOGUE_SCHEMA, source, idles, left };
}
