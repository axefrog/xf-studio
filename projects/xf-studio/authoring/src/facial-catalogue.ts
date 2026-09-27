/**
 * Reading the game's facial files for the expression editor (research/animation/expression-editor-design.md §3.2, §3.3): the face
 * skeleton and facial setup (the control vocabulary and the rest pose), animation sets (clips' float tracks), the photo-mode
 * expression table and the photo-mode face rig's animation sets. Pure: callers pass WolvenKit JSON documents (`convert serialize`,
 * untrimmed where a clip's data buffers are needed) and get plain data back. No mod is named: whatever the resolver says wins is read.
 */
import { asArray, cname, cr2wRoot, depotRef, HandleScope, isObject, packageChunks, type JsonObject } from "./red-json";
import type { DepotRef } from "./depot-path";
import { buildVocabulary, type FacialVocabulary } from "./engines/facial-rig/vocabulary";
import { rigRestFromRed, type RigRest } from "./engines/facial-rig/pose";
import { clipControlVector, decodeClipTracks, type ClipTracks } from "./engines/facial-rig/anim-tracks";
import type { FacialStartPoint } from "./platform/api/facial";

/** The player face the Studio's head is: the female basehead skeleton and its own facial setup (design D1; the blink and idle use it). */
export const FACE_SKELETON = "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead_skeleton.rig";
export const FACE_SETUP = "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead_rigsetup.facialsetup";
/** The game's generic facial additives: its normal blink composes with a held expression. */
export const FACIAL_ADDITIVES = "base\\animations\\facial\\generic\\interactive_scene\\generic_facial_additives.anims";
export const BLINK_CLIP = "additive__blink_normal__01";
export const BLINK_TRACKS = ["eye_l_blink", "eye_r_blink"] as const;
/** Photo mode's expression table and V's photo-mode face rig (knowledge/facial-expressions.md §3). */
export const EXPRESSION_TABLE = "base\\animations\\anim_motion_database\\photomode_facial_poses.csv";
export const PHOTO_MODE_FACE_RIG = "base\\characters\\head\\player_base_heads\\appearances\\head\\face_rig\\h0_000__basehead_face_rig_photomode.app";

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** The vocabulary and rest pose from the serialized skeleton and facial setup. Throws a plain error when they don't fit. */
export function readFaceRig(skeleton: unknown, setup: unknown): { vocabulary: FacialVocabulary; rest: RigRest } {
  const rig = cr2wRoot(skeleton).root, facial = cr2wRoot(setup).root;
  const mapping = isObject(facial.info) && isObject(facial.info.tracksMapping) ? facial.info.tracksMapping : null;
  if (!mapping) throw Error("The facial setup has no track mapping.");
  const vocabulary = buildVocabulary({ rig: fileName(FACE_SKELETON), setup: fileName(FACE_SETUP),
    trackNames: asArray(rig.trackNames).map(cname), referenceTracks: asArray(rig.referenceTracks).map(Number),
    mapping: { numEnvelopes: Number(mapping.numEnvelopes), numMainPoses: Number(mapping.numMainPoses),
      numLipsyncOverrides: Number(mapping.numLipsyncOverrides), numWrinkles: Number(mapping.numWrinkles) } });
  return { vocabulary, rest: rigRestFromRed(rig) };
}

/**
 * The tracks the facial setup's wrinkle outputs read (`bakedData.Data.<part>.Wrinkles`: absolute track indices, one per wrinkle output,
 * shared by the face, eye and tongue parts). The skin shader turns those outputs into wrinkle normals, so a control that feeds one has a
 * visible effect in the game even where it moves no joint.
 */
export function wrinkleSourceTracks(setup: unknown): number[] {
  const root = cr2wRoot(setup).root, baked = isObject(root.bakedData) ? root.bakedData.Data : null;
  if (!isObject(baked)) return [];
  const found = new Set<number>();
  for (const part of ["Face", "Eyes", "Tongue"]) {
    const block = baked[part];
    if (isObject(block)) for (const track of asArray(block.Wrinkles)) if (Number.isInteger(track)) found.add(track as number);
  }
  return [...found].sort((a, b) => a - b);
}

/** The main-pose tracks of the facial setup's Eyes part (`bakedData.Data.Eyes.AllMainPoses[].Track`): gaze and pupils. */
export function eyeTracks(setup: unknown): number[] {
  const root = cr2wRoot(setup).root, baked = isObject(root.bakedData) ? root.bakedData.Data : null;
  const eyes = isObject(baked) && isObject(baked.Eyes) ? baked.Eyes : null;
  return eyes ? asArray(eyes.AllMainPoses).flatMap(pose => isObject(pose) && Number.isInteger(pose.Track) ? [pose.Track as number] : []) : [];
}

/** One clip of an animation set, with its float tracks decoded (joint keys are not read). */
export type SetClip = { name: string; type: string; duration: number; frames: number; tracks: ClipTracks; jointKeys: number };

const base64 = (value: unknown): Uint8Array | null => {
  const text = isObject(value) && typeof value.Bytes === "string" ? value.Bytes : null;
  return text === null ? null : Uint8Array.from(atob(text), char => char.charCodeAt(0));
};

/**
 * The clips of a serialized animation set (`animAnimSet`), with float tracks decoded from each clip's data: its address in the set's
 * data chunks (`dataAddress`), else the buffer WolvenKit placed beside it. A clip whose data can't be read is skipped and named in
 * `unreadable` (an in-place Oodle buffer, a damaged address).
 */
export function readAnimSet(document: unknown): { clips: Map<string, SetClip>; unreadable: string[] } {
  const root = cr2wRoot(document).root, scope = new HandleScope(root);
  const chunks = asArray(root.animationDataChunks).map(chunk => isObject(chunk) ? base64(chunk.buffer) : null);
  const clips = new Map<string, SetClip>(), unreadable: string[] = [];
  for (const entry of asArray(root.animations)) {
    const setEntry = scope.data(entry), animation = setEntry && scope.data(setEntry.animation), buffer = animation && scope.data(animation.animBuffer);
    const name = animation ? cname(animation.name) : "";
    if (!animation || !buffer || !name) continue;
    if (clips.has(name)) continue; // First of a name wins, as the game looks clips up by name.
    const counts = { animKeys: Number(buffer.numAnimKeys ?? 0), animKeysRaw: Number(buffer.numAnimKeysRaw ?? 0),
      constAnimKeys: Number(buffer.numConstAnimKeys ?? 0), trackKeys: Number(buffer.numTrackKeys ?? 0), constTrackKeys: Number(buffer.numConstTrackKeys ?? 0) };
    let bytes: Uint8Array | null = null;
    const address = isObject(buffer.dataAddress) ? buffer.dataAddress : null;
    const chunk = address ? chunks[Number(address.unkIndex)] : null;
    if (address && chunk) {
      const start = Number(address.fsetInBytes), size = Number(address.zeInBytes);
      if (Number.isInteger(start) && Number.isInteger(size) && start >= 0 && start + size <= chunk.byteLength) bytes = chunk.subarray(start, start + size);
    }
    bytes ??= base64(isObject(buffer.defferedBuffer) ? buffer.defferedBuffer : null) ?? base64(isObject(buffer.tempBuffer) ? buffer.tempBuffer : null);
    try {
      if (!bytes) throw Error("no data");
      const duration = Number(buffer.duration ?? animation.duration ?? 0);
      clips.set(name, { name, type: typeof animation.animationType === "string" ? animation.animationType : "Normal", duration,
        frames: Number(buffer.numFrames ?? 0), tracks: decodeClipTracks(bytes, counts, duration), jointKeys: counts.animKeys + counts.animKeysRaw });
    } catch { unreadable.push(name); }
  }
  return { clips, unreadable };
}

/** The rows of a serialized 2D array (`C2dArray`): each row as `{header: value}`. */
export function readTable(document: unknown): Record<string, string>[] {
  const root = cr2wRoot(document).root;
  const headers = asArray(root.compiledHeaders).map(value => String(value));
  return asArray(root.compiledData).map(row => Object.fromEntries(asArray(row).map((value, index) => [headers[index] ?? String(index), String(value)])));
}

/** One animation set on the face rig, as an appearance lists it (a reference may carry only its hash, as the game stores it). */
export type FaceRigSet = { ref: DepotRef; priority: number };
/**
 * The animation sets V's photo-mode face rig holds: every `animSet` entry of the appearance's animated and animation-setup components,
 * higher priority first, then in listed order [hypothesis: the order the game searches; the wiki says the first match of a name wins].
 * `appearances` are the definitions of the rig's `.app` and of each ArchiveXL patch of it, in patch order; only definitions for the
 * female head are read (`pwa` in the name) when there are any.
 */
export function readFaceRigSets(apps: readonly unknown[]): FaceRigSet[] {
  const found: (FaceRigSet & { order: number })[] = [];
  let order = 0;
  for (const app of apps) {
    const root = cr2wRoot(app).root, scope = new HandleScope(root);
    const definitions = asArray(root.appearances).map(item => scope.data(item)).filter((item): item is JsonObject => !!item);
    const female = definitions.filter(definition => /pwa|_wa_|female/i.test(cname(definition.name)));
    for (const definition of female.length ? female : definitions) {
      const components = [...packageChunks(definition.compiledData), ...asArray(definition.components).map(item => scope.data(item)).filter((c): c is JsonObject => !!c)];
      for (const component of components) {
        if (!/AnimatedComponent|AnimationSetupExtensionComponent/.test(String(component.$type))) continue;
        const walk = (value: unknown) => {
          if (Array.isArray(value)) { value.forEach(walk); return; }
          if (!isObject(value)) return;
          if ("animSet" in value) {
            const ref = depotRef(value.animSet);
            if (ref) found.push({ ref, priority: Number(value.priority ?? 0), order: order++ });
            return;
          }
          for (const item of Object.values(value)) walk(item);
        };
        walk(component.animations);
      }
    }
  }
  const seen = new Set<string>();
  return found.sort((a, b) => b.priority - a.priority || a.order - b.order)
    .filter(set => { if (seen.has(set.ref.hash)) return false; seen.add(set.ref.hash); return true; })
    .map(({ ref, priority }) => ({ ref, priority }));
}

/** "facial_happy" → "Happy"; "facial_static_sleeping_01" → "Static sleeping 01". */
export function expressionLabel(clip: string): string {
  const words = clip.replace(/^facial_+/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_\s]+/).filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : clip;
}

/**
 * The start points: each table row whose clip a set holds, decoded to a control vector. Rows are found by `AnimationName` (the game
 * looks clips up by name among the rig's sets); the first set holding the name wins.
 */
export function startPoints(rows: readonly Record<string, string>[], sets: readonly { path: string; provider: string; clips: ReadonlyMap<string, SetClip> }[],
  vocabulary: FacialVocabulary): { items: FacialStartPoint[]; missing: string[] } {
  const items: FacialStartPoint[] = [], missing: string[] = [];
  for (const row of rows) {
    const clip = row.AnimationName ?? "", index = Number(row.Index);
    if (!clip || !Number.isInteger(index)) continue;
    const holder = sets.find(set => set.clips.has(clip));
    if (!holder) { missing.push(clip); continue; }
    const found = holder.clips.get(clip)!;
    const notes: string[] = [];
    if (found.jointKeys > 0) notes.push("Its bone keys (neck and head) are left out: an expression is face controls only.");
    if (found.frames > 2) notes.push("An animated expression: its first frame is used.");
    if (found.type === "AdditiveWithoutFirstFrame") notes.push("Read as additive from rest (its clip type isn't confirmed for still faces).");
    items.push({ id: `${index}:${clip}`, row: index, clip, label: expressionLabel(clip), set: holder.path, provider: holder.provider,
      controls: clipControlVector(found.tracks, found.type, vocabulary.tracks, vocabulary.reference, vocabulary.main), ...(notes.length ? { notes } : {}) });
  }
  return { items, missing };
}

/**
 * The game's normal blink as additive track values: the clip's float tracks, its duration and the time its closing half ends (where
 * both blink controls peak), which is where a closure of 1 samples it.
 */
export function readBlink(clips: ReadonlyMap<string, SetClip>, vocabulary: FacialVocabulary): { clip: ClipTracks; closedTime: number } | null {
  const clip = clips.get(BLINK_CLIP);
  if (!clip || clip.type !== "AdditiveFromRefPose") return null;
  const peaks = BLINK_TRACKS.map(name => {
    const keys = clip.tracks.tracks.get(vocabulary.tracks.indexOf(name));
    if (!keys?.values.length) return null;
    let best = 0;
    keys.values.forEach((value, index) => { if (value > keys.values[best]!) best = index; });
    return keys.times[best]!;
  });
  if (peaks.some(peak => peak === null)) return null;
  return { clip: clip.tracks, closedTime: Math.max(...(peaks as number[])) };
}
