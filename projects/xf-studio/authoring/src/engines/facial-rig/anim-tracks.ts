/**
 * Float tracks of a game animation clip, and the control vector a static face clip holds
 * (research/animation/expression-editor-design.md §3.3). Pure.
 *
 * The clip's `animAnimationBufferCompressed` data is five key runs back to back [source: WolvenKit
 * `animAnimationBufferCompressed.ReadBuffer`, commit 1172077, read and reimplemented here, not copied]:
 *
 * | Run | Size per key | Layout |
 * |---|---:|---|
 * | joint keys | 10 | u16 time, u16 joint and channel bits, 3 × u16 quantised value |
 * | raw joint keys | 16 | u16 time, u16 bits, 3 × f32 |
 * | constant joint keys | 16 | u16 bits, u16 time, 3 × f32 |
 * | track keys | 8 | u16 time (normalised to the clip), u16 track, f32 value |
 * | constant track keys | 8 | u16 track, u16 time, f32 value |
 *
 * Only the float tracks are read: an expression is a vector of named controls, never bone keys (the singing faces' neck keys are
 * dropped, as the design says). Checked against the evidence note's decoded vanilla expressions (`facial_happy`: upper lips apart
 * 0.86, right sharp corner up 0.82) [offline].
 */
import { f32, type ControlVector } from "./vector";

/** The key counts a clip's buffer declares (its `numAnimKeys`, `numAnimKeysRaw`, `numConstAnimKeys`, `numTrackKeys`, `numConstTrackKeys`). */
export type AnimBufferCounts = { readonly animKeys: number; readonly animKeysRaw: number; readonly constAnimKeys: number;
  readonly trackKeys: number; readonly constTrackKeys: number };
/** One float track's keys: times in seconds, ascending, and values. */
export type TrackKeys = { readonly times: readonly number[]; readonly values: readonly number[] };
export type ClipTracks = { readonly duration: number; readonly tracks: ReadonlyMap<number, TrackKeys> };

/** The buffer's byte length its counts need (a check that the address and counts agree). */
export function animBufferLength(counts: AnimBufferCounts): number {
  return counts.animKeys * 10 + counts.animKeysRaw * 16 + counts.constAnimKeys * 16 + (counts.trackKeys + counts.constTrackKeys) * 8;
}

/** Decode a clip's float tracks. Constant tracks become one key at time 0. Throws a plain error when the buffer is too short. */
export function decodeClipTracks(bytes: Uint8Array, counts: AnimBufferCounts, duration: number): ClipTracks {
  const need = animBufferLength(counts);
  if (!Object.values(counts).every(count => Number.isInteger(count) && count >= 0)) throw Error("The clip's key counts are damaged.");
  if (bytes.byteLength < need) throw Error(`The clip's data is shorter than its keys need (${bytes.byteLength} of ${need} bytes).`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const keyed = new Map<number, [number, number][]>();
  let at = counts.animKeys * 10 + counts.animKeysRaw * 16 + counts.constAnimKeys * 16;
  for (let i = 0; i < counts.trackKeys; i++, at += 8) {
    const time = view.getUint16(at, true) / 65535 * safeDuration, track = view.getUint16(at + 2, true), value = view.getFloat32(at + 4, true);
    if (!Number.isFinite(value)) throw Error("The clip holds an invalid number.");
    const list = keyed.get(track) ?? []; list.push([time, value]); keyed.set(track, list);
  }
  const tracks = new Map<number, TrackKeys>();
  for (const [track, list] of keyed) {
    list.sort((a, b) => a[0] - b[0]);
    tracks.set(track, { times: list.map(key => key[0]), values: list.map(key => key[1]) });
  }
  for (let i = 0; i < counts.constTrackKeys; i++, at += 8) {
    const track = view.getUint16(at, true), value = view.getFloat32(at + 4, true);
    if (!Number.isFinite(value)) throw Error("The clip holds an invalid number.");
    // A track with keys of its own keeps them; a constant one is one key.
    if (!tracks.has(track)) tracks.set(track, { times: [0], values: [value] });
  }
  return { duration: safeDuration, tracks };
}

/** A track's value at `time` (linear between keys, held beyond them). */
export function sampleTrack(keys: TrackKeys, time: number): number {
  const { times, values } = keys;
  if (!times.length) return 0;
  if (time <= times[0]!) return values[0]!;
  for (let i = 1; i < times.length; i++) if (time <= times[i]!) {
    const t0 = times[i - 1]!, t1 = times[i]!, span = t1 - t0;
    return span > 0 ? values[i - 1]! + (values[i]! - values[i - 1]!) * (time - t0) / span : values[i]!;
  }
  return values.at(-1)!;
}

/** The clip's additive values at `time`, by track: what the game adds to the reference tracks (`AdditiveFromRefPose`). */
export function clipValuesAt(clip: ClipTracks, time: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [track, keys] of clip.tracks) out.set(track, sampleTrack(keys, time));
  return out;
}

/**
 * The control vector a static face clip holds: its main-pose weights at its first frame [design choice for animated clips: "start
 * from frame…" comes later]. `AdditiveFromRefPose` stores deltas, which are the weights (main poses rest at 0); `Additive` stores
 * absolute values, so the reference is subtracted; `AdditiveWithoutFirstFrame` is read like `AdditiveFromRefPose` [hypothesis].
 * Weights are clamped to 0–1 as the solver clamps them and stored as float32; zeros are dropped.
 */
export function clipControlVector(clip: ClipTracks, animationType: string, trackNames: readonly string[], reference: readonly number[],
  main: { start: number; count: number }): ControlVector {
  const absolute = animationType === "Additive" || animationType === "Normal";
  const out: Record<string, number> = {};
  for (let track = main.start; track < main.start + main.count; track++) {
    const keys = clip.tracks.get(track);
    if (!keys || !keys.values.length) continue;
    const raw = keys.values[0]! - (absolute ? reference[track] ?? 0 : 0);
    const weight = f32(Math.min(1, Math.max(0, raw)));
    if (weight > 1e-6 && trackNames[track]) out[trackNames[track]!] = weight;
  }
  return Object.fromEntries(Object.keys(out).sort().map(name => [name, out[name]!]));
}

/** One float-track key as the native clip reader gives it (src/native/anim-set.ts `TrackKey`). */
export type FloatTrackKey = { readonly track: number; readonly time: number; readonly value: number };
/**
 * A clip's float tracks from its decoded keys (the native reader's `trackKeys` and `constTrackKeys`), by the same rules as
 * `decodeClipTracks`: animated keys sorted by time (file order kept for equal times), and a constant key only for a track without animated
 * keys. Throws a plain error for an invalid number.
 */
export function clipTracksFromKeys(duration: number, trackKeys: readonly FloatTrackKey[], constTrackKeys: readonly FloatTrackKey[]): ClipTracks {
  const keyed = new Map<number, [number, number][]>();
  for (const key of trackKeys) {
    if (!Number.isFinite(key.value) || !Number.isFinite(key.time)) throw Error("The clip holds an invalid number.");
    const list = keyed.get(key.track) ?? []; list.push([key.time, key.value]); keyed.set(key.track, list);
  }
  const tracks = new Map<number, TrackKeys>();
  for (const [track, list] of keyed) {
    list.sort((a, b) => a[0] - b[0]);
    tracks.set(track, { times: list.map(key => key[0]), values: list.map(key => key[1]) });
  }
  for (const key of constTrackKeys) {
    if (!Number.isFinite(key.value)) throw Error("The clip holds an invalid number.");
    if (!tracks.has(key.track)) tracks.set(key.track, { times: [0], values: [key.value] });
  }
  return { duration: Number.isFinite(duration) && duration > 0 ? duration : 0, tracks };
}
