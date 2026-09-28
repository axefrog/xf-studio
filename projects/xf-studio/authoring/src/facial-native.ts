/**
 * The face's game files read with XF Studio's own reader (host side; src/native/): the face skeleton and facial setup as documents (the
 * facial setup's baked tables and poses included, native/facial-setup.ts), a clip's float tracks, an animation set's clips by name, and the
 * morph targets' joint binds. Each answer is null where the reader can't answer, so the caller falls back to WolvenKit per resource.
 */
import type { MountedArchive } from "./archive-precedence";
import { clipTracksFromKeys } from "./engines/facial-rig/anim-tracks";
import type { MorphTargetBinds } from "./engines/facial-rig/bake";
import type { SetClip } from "./facial-catalogue";
import type { AnimClip } from "./native/anim-set";
import type { NativeDecoder } from "./native/native-decode";
import { asArray, cname, cr2wRoot, isObject } from "./red-json";

/** Most time one facial document may take in the decode worker (the setup decodes in about 60 ms). */
const DOCUMENT_TIMEOUT_MS = 60_000;

/** A resource's document (WolvenKit's JSON shape), or null with the reader's reason logged. */
export async function nativeDocument(decoder: NativeDecoder, archive: MountedArchive, hash: string, log?: (message: string) => void): Promise<unknown | null> {
  const outcome = await decoder.decode({ archivePath: archive.id, hash, needName: false, roots: ["animFacialSetup"], timeoutMs: DOCUMENT_TIMEOUT_MS });
  if (outcome.ok) return outcome.document;
  log?.(`The native reader didn't read ${hash} from ${archive.name}: ${outcome.kind}: ${outcome.message}`);
  return null;
}

/** A natively decoded clip as the facial catalogue's set clip (float tracks only; joint keys counted). */
export function setClipOf(clip: AnimClip): SetClip {
  return { name: clip.name, type: clip.animationType, duration: clip.duration, frames: clip.frames,
    tracks: clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys),
    jointKeys: clip.buffer === "compressed" ? clip.counts.compressed + clip.counts.raw : 0 };
}

/** One clip of a set, by name (null: not in the set, or not readable here). */
export async function nativeClip(decoder: NativeDecoder, archivePath: string, hash: string, name: string): Promise<SetClip | null> {
  if (!decoder.decodeAnim) return null;
  const outcome = await decoder.decodeAnim({ archivePath, hash, op: "clip", clip: name });
  return outcome.ok && outcome.clip ? setClipOf(outcome.clip) : null;
}

/**
 * The clips of a set the caller wants (by name; the first of a name, as the game looks clips up): null when the set can't be read natively
 * at all. A clip the reader refuses is left out.
 */
export async function nativeSetClips(decoder: NativeDecoder, archivePath: string, hash: string, wanted: ReadonlySet<string>): Promise<Map<string, SetClip> | null> {
  if (!decoder.decodeAnim) return null;
  const index = await decoder.decodeAnim({ archivePath, hash, op: "index" });
  if (!index.ok || !index.index) return null;
  const out = new Map<string, SetClip>();
  for (const info of index.index.clips) {
    if (!wanted.has(info.name) || out.has(info.name)) continue;
    if (info.buffer !== "compressed" && info.buffer !== "simd") continue;
    const clip = await nativeClip(decoder, archivePath, hash, info.name);
    if (clip) out.set(info.name, clip);
  }
  return out;
}

/** A morph target's per-target joint binds (`MorphTargetMesh.targets[].boneNames` and `boneRigMatrices`), from its document. */
export function morphBinds(document: unknown): MorphTargetBinds[] {
  const root = cr2wRoot(document).root;
  return asArray(root.targets).flatMap(target => {
    if (!isObject(target)) return [];
    const matrices = asArray(target.boneRigMatrices).map(matrix => isObject(matrix) ? ["X", "Y", "Z", "W"].flatMap(row => {
      const v = isObject(matrix[row]) ? matrix[row] as Record<string, unknown> : {};
      return [Number(v.X ?? 0), Number(v.Y ?? 0), Number(v.Z ?? 0), Number(v.W ?? 0)];
    }) : []);
    return [{ name: cname(target.name), region: cname(target.regionName), bones: asArray(target.boneNames).map(cname), matrices }];
  });
}
