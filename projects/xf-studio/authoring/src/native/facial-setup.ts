/**
 * The three data buffers of a facial setup (`.facialsetup`, `animFacialSetup`): `bakedData` (the solver's tables) and the main and
 * corrective pose buffers. Pure. Read from the bytes themselves; the layout below was fitted value for value against WolvenKit's JSON of the
 * female and male player setups of game 2.31 (knowledge/archive-format.md §13), and WolvenKit (GPL-3.0) served only as that parity oracle.
 *
 * Every table is packed back to back, little-endian, with no alignment or padding, in the order written below, and its length comes from
 * the setup's own `info` (`animFacialSetup_BufferInfo`) and `posesInfo` counts; a buffer whose length disagrees with them is refused.
 *
 * `bakedData`: `LipsyncOverridesIndexMapping` (u16 × numLipsyncOverridesIndexMapping), `JointRegions` (u8 × numJointRegions), then for each
 * part in the order Face, Tongue, Eyes:
 *
 * | Table | Bytes | Fields |
 * |---|---:|---|
 * | EnvelopesPerTrackMapping | 4 | u16 Track, u8 LevelOfDetail, u8 Envelope |
 * | GlobalLimits | 16 | f32 Max, f32 Mid, f32 Min, u16 Track, u8 Envelope, u8 IsCachable |
 * | InfluencedPoses | 4 | u16 Track, u8 NumInfluences, u8 Type |
 * | InfluenceIndices | 2 | u16 |
 * | UpperLowerFace | 4 | u16 Track, u8 Part, u8 Unknown |
 * | LipsyncPosesSides | 4 | u16 Track, u8 Side, u8 Unknown |
 * | GlobalCorrectiveEntries | 4 | u16 Index, u16 packed: Track in bits 4–15, Unknown in bits 0–3 |
 * | InbetweenCorrectiveEntries | 4 | as GlobalCorrectiveEntries |
 * | CorrectiveInfluencedPoses | 4 | u16 Index, u8 NumInfluences, u8 Type |
 * | CorrectiveInfluenceIndices | 2 | u16 |
 * | AllMainPoses | 4 | u16 Track, u8 NumInbetweens, u8 Unknown |
 * | AllMainPosesInbetweens | 4 | f32 |
 * | AllMainPosesInbetweenScopeMultipliers | 4 | f32 |
 * | Wrinkles | 2 | u16 |
 *
 * Pose buffers (`mainPosesData`, `correctivePosesData`): for each part in the order Face, Tongue, Eyes, its poses, then its transforms, then
 * its scales:
 *
 * | List | Bytes | Fields |
 * |---|---:|---|
 * | Poses | 16 | u32 TransformIdx, u32 ScaleIdx, u16 packed: NumTransforms in bits 0–14, IsScale in bit 15; u16 Flag1; u8 Flag2; u8 Flag3; u16 (0) |
 * | Transforms | 32 | f32 × 4 Rotation (i, j, k, r), f32 × 3 Translation (X, Y, Z), u16 Bone, u8 JointRegion, u8 Unknown |
 * | Scales | 16 | f32 × 4 (i, j, k, r) |
 *
 * Flag1 and Flag3 are zero in every vanilla pose, so their widths are a reading, not a finding [hypothesis]; the solver reads neither.
 */
import { float32Value } from "./json-numbers";
import type { DecodeSession } from "./limits";
import { NativeMalformedError } from "./native-errors";

/** The buffer properties of `animFacialSetup` and the type names WolvenKit's JSON gives their parsed form. */
export const FACIAL_SETUP_BUFFERS = {
  bakedData: "WolvenKit.RED4.Archive.Buffer.AnimFacialSetupBakedDataBuffer",
  mainPosesData: "WolvenKit.RED4.Archive.Buffer.AnimFacialSetupMainPosesDataBuffer",
  correctivePosesData: "WolvenKit.RED4.Archive.Buffer.AnimFacialSetupCorrectivePosesDataBuffer",
} as const;
export type FacialSetupBuffer = keyof typeof FACIAL_SETUP_BUFFERS;
export const FACIAL_PARTS = ["Face", "Tongue", "Eyes"] as const;
const INFO_PARTS = { Face: "face", Tongue: "tongue", Eyes: "eyes" } as const;

/** One part's table counts (`animFacialSetup_OneSermoBufferInfo`). */
export interface FacialPartCounts {
  readonly numEnvelopesPerTrackMapping: number; readonly numGlobalLimits: number; readonly numInfluencedPoses: number; readonly numInfluenceIndices: number;
  readonly numUpperLowerFace: number; readonly numLipsyncPosesSides: number; readonly numGlobalCorrectiveEntries: number;
  readonly numInbetweenCorrectiveEntries: number; readonly numCorrectiveInfluencedPoses: number; readonly numCorrectiveInfluenceIndices: number;
  readonly numAllMainPoses: number; readonly numAllMainPosesInbetweens: number; readonly numAllMainPosesInbetweenScopeMultipliers: number;
  readonly numWrinkles: number;
}
/** One part's pose buffer counts (`animFacialSetup_OneSermoPoseBufferInfo`). */
export interface FacialPoseCounts {
  readonly numMainPoses: number; readonly numMainTransforms: number; readonly numMainScales: number;
  readonly numCorrectivePoses: number; readonly numCorrectiveTransforms: number; readonly numCorrectiveScales: number;
}
export interface FacialSetupCounts {
  readonly numLipsyncOverridesIndexMapping: number; readonly numJointRegions: number;
  readonly parts: Readonly<Record<(typeof FACIAL_PARTS)[number], FacialPartCounts>>;
  readonly poses: Readonly<Record<(typeof FACIAL_PARTS)[number], FacialPoseCounts>>;
}

type Fields = Readonly<Record<string, unknown>>;
const fieldsOf = (value: unknown): Fields => {
  if (value && typeof value === "object") {
    const fields = (value as { fields?: unknown }).fields;
    return (fields && typeof fields === "object" ? fields : value) as Fields;
  }
  return {};
};
/** A count property: absent reads as 0 (a file leaves a zero count out); anything but a non-negative integer is refused. */
const count = (fields: Fields, key: string): number => {
  const value = fields[key] ?? 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new NativeMalformedError(`animFacialSetup: ${key} is not a count.`);
  return value;
};
const PART_KEYS: readonly (keyof FacialPartCounts)[] = ["numEnvelopesPerTrackMapping", "numGlobalLimits", "numInfluencedPoses", "numInfluenceIndices",
  "numUpperLowerFace", "numLipsyncPosesSides", "numGlobalCorrectiveEntries", "numInbetweenCorrectiveEntries", "numCorrectiveInfluencedPoses",
  "numCorrectiveInfluenceIndices", "numAllMainPoses", "numAllMainPosesInbetweens", "numAllMainPosesInbetweenScopeMultipliers", "numWrinkles"];
const POSE_KEYS: readonly (keyof FacialPoseCounts)[] = ["numMainPoses", "numMainTransforms", "numMainScales", "numCorrectivePoses",
  "numCorrectiveTransforms", "numCorrectiveScales"];

/** The counts from `info` and `posesInfo` (red-model objects or plain JSON objects). */
export function facialSetupCounts(info: unknown, posesInfo: unknown): FacialSetupCounts {
  const i = fieldsOf(info), p = fieldsOf(posesInfo);
  const parts = {} as Record<(typeof FACIAL_PARTS)[number], FacialPartCounts>, poses = {} as Record<(typeof FACIAL_PARTS)[number], FacialPoseCounts>;
  for (const part of FACIAL_PARTS) {
    const pi = fieldsOf(i[INFO_PARTS[part]]), pp = fieldsOf(p[INFO_PARTS[part]]);
    parts[part] = Object.fromEntries(PART_KEYS.map(key => [key, count(pi, key)])) as unknown as FacialPartCounts;
    poses[part] = Object.fromEntries(POSE_KEYS.map(key => [key, count(pp, key)])) as unknown as FacialPoseCounts;
  }
  return { numLipsyncOverridesIndexMapping: count(i, "numLipsyncOverridesIndexMapping"), numJointRegions: count(i, "numJointRegions"), parts, poses };
}

/** Bytes each table takes, for the length check before anything is read. */
function bakedLength(c: FacialSetupCounts): number {
  let total = c.numLipsyncOverridesIndexMapping * 2 + c.numJointRegions;
  for (const part of FACIAL_PARTS) {
    const p = c.parts[part];
    total += p.numEnvelopesPerTrackMapping * 4 + p.numGlobalLimits * 16 + p.numInfluencedPoses * 4 + p.numInfluenceIndices * 2 + p.numUpperLowerFace * 4
      + p.numLipsyncPosesSides * 4 + p.numGlobalCorrectiveEntries * 4 + p.numInbetweenCorrectiveEntries * 4 + p.numCorrectiveInfluencedPoses * 4
      + p.numCorrectiveInfluenceIndices * 2 + p.numAllMainPoses * 4 + p.numAllMainPosesInbetweens * 4 + p.numAllMainPosesInbetweenScopeMultipliers * 4
      + p.numWrinkles * 2;
  }
  return total;
}
const poseCounts = (c: FacialSetupCounts, part: (typeof FACIAL_PARTS)[number], which: "main" | "corrective") => {
  const p = c.poses[part];
  return which === "main" ? { poses: p.numMainPoses, transforms: p.numMainTransforms, scales: p.numMainScales }
    : { poses: p.numCorrectivePoses, transforms: p.numCorrectiveTransforms, scales: p.numCorrectiveScales };
};
function posesLength(c: FacialSetupCounts, which: "main" | "corrective"): number {
  let total = 0;
  for (const part of FACIAL_PARTS) { const n = poseCounts(c, part, which); total += n.poses * 16 + n.transforms * 32 + n.scales * 16; }
  return total;
}

class Reader {
  at = 0;
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8() { return this.view.getUint8(this.at++); }
  u16() { const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
  u32() { const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  f32() { const v = this.view.getFloat32(this.at, true); this.at += 4; return float32Value(v); }
  list<T>(n: number, read: () => T): T[] { const out = new Array<T>(n); for (let i = 0; i < n; i++) out[i] = read(); return out; }
}

const checkLength = (bytes: Uint8Array, need: number, what: string) => {
  if (bytes.byteLength !== need) throw new NativeMalformedError(`animFacialSetup.${what} holds ${bytes.byteLength} bytes; its counts need ${need}.`);
};

/** `bakedData` as WolvenKit's JSON shows it (`Data`). */
export function readFacialBakedData(bytes: Uint8Array, c: FacialSetupCounts, session?: DecodeSession): Record<string, unknown> {
  const need = bakedLength(c);
  checkLength(bytes, need, "bakedData");
  session?.nodes(need / 2);
  const r = new Reader(bytes);
  const entry = (a: string, b: string) => () => ({ Index: r.u16(), ...packed(r.u16(), a, b) });
  const packed = (v: number, a: string, b: string) => ({ [a]: v >> 4, [b]: v & 15 });
  const out: Record<string, unknown> = {
    LipsyncOverridesIndexMapping: r.list(c.numLipsyncOverridesIndexMapping, () => r.u16()),
    JointRegions: r.list(c.numJointRegions, () => r.u8()),
  };
  for (const part of FACIAL_PARTS) {
    const p = c.parts[part];
    out[part] = {
      EnvelopesPerTrackMapping: r.list(p.numEnvelopesPerTrackMapping, () => { const Track = r.u16(), LevelOfDetail = r.u8(), Envelope = r.u8(); return { Track, LevelOfDetail, Envelope }; }),
      GlobalLimits: r.list(p.numGlobalLimits, () => { const Max = r.f32(), Mid = r.f32(), Min = r.f32(), Track = r.u16(), Envelope = r.u8(), IsCachable = r.u8();
        return { Max, Mid, Min, Track, Envelope, IsCachable }; }),
      InfluencedPoses: r.list(p.numInfluencedPoses, () => { const Track = r.u16(), NumInfluences = r.u8(), Type = r.u8(); return { Track, NumInfluences, Type }; }),
      InfluenceIndices: r.list(p.numInfluenceIndices, () => r.u16()),
      UpperLowerFace: r.list(p.numUpperLowerFace, () => { const Track = r.u16(), Part = r.u8(), Unknown = r.u8(); return { Track, Part, Unknown }; }),
      LipsyncPosesSides: r.list(p.numLipsyncPosesSides, () => { const Track = r.u16(), Side = r.u8(), Unknown = r.u8(); return { Track, Side, Unknown }; }),
      GlobalCorrectiveEntries: r.list(p.numGlobalCorrectiveEntries, entry("Track", "Unknown")),
      InbetweenCorrectiveEntries: r.list(p.numInbetweenCorrectiveEntries, entry("Track", "Unknown")),
      CorrectiveInfluencedPoses: r.list(p.numCorrectiveInfluencedPoses, () => { const Index = r.u16(), NumInfluences = r.u8(), Type = r.u8(); return { Index, NumInfluences, Type }; }),
      CorrectiveInfluenceIndices: r.list(p.numCorrectiveInfluenceIndices, () => r.u16()),
      AllMainPoses: r.list(p.numAllMainPoses, () => { const Track = r.u16(), NumInbetweens = r.u8(), Unknown = r.u8(); return { Track, NumInbetweens, Unknown }; }),
      AllMainPosesInbetweens: r.list(p.numAllMainPosesInbetweens, () => r.f32()),
      AllMainPosesInbetweenScopeMultipliers: r.list(p.numAllMainPosesInbetweenScopeMultipliers, () => r.f32()),
      Wrinkles: r.list(p.numWrinkles, () => r.u16()),
    };
  }
  return out;
}

/** A pose buffer as WolvenKit's JSON shows it (`Data`). */
export function readFacialPosesData(bytes: Uint8Array, c: FacialSetupCounts, which: "main" | "corrective", session?: DecodeSession): Record<string, unknown> {
  const need = posesLength(c, which);
  checkLength(bytes, need, which === "main" ? "mainPosesData" : "correctivePosesData");
  session?.nodes(need / 4);
  const r = new Reader(bytes), out: Record<string, unknown> = {};
  for (const part of FACIAL_PARTS) {
    const n = poseCounts(c, part, which);
    const Poses = r.list(n.poses, () => {
      const TransformIdx = r.u32(), ScaleIdx = r.u32(), bits = r.u16(), Flag1 = r.u16(), Flag2 = r.u8(), Flag3 = r.u8();
      r.at += 2;
      return { TransformIdx, ScaleIdx, NumTransforms: bits & 0x7fff, IsScale: bits >> 15, Flag1, Flag2, Flag3 };
    });
    const Transforms = r.list(n.transforms, () => {
      const i = r.f32(), j = r.f32(), k = r.f32(), rr = r.f32(), X = r.f32(), Y = r.f32(), Z = r.f32(), Bone = r.u16(), JointRegion = r.u8(), Unknown = r.u8();
      return { Rotation: { $type: "Quaternion", i, j, k, r: rr }, Translation: { $type: "Vector3", X, Y, Z }, Bone, JointRegion, Unknown };
    });
    const Scales = r.list(n.scales, () => { const i = r.f32(), j = r.f32(), k = r.f32(), rr = r.f32(); return { $type: "Quaternion", i, j, k, r: rr }; });
    out[part] = { Poses, Transforms, Scales };
  }
  return out;
}

/** Parse one of the three buffers by its property name. */
export function readFacialSetupBuffer(property: FacialSetupBuffer, bytes: Uint8Array, counts: FacialSetupCounts, session?: DecodeSession): Record<string, unknown> {
  if (property === "bakedData") return readFacialBakedData(bytes, counts, session);
  return readFacialPosesData(bytes, counts, property === "mainPosesData" ? "main" : "corrective", session);
}
