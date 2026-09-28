// The facial setup's data buffers read natively (src/native/facial-setup.ts): synthetic bytes for the packed layout and its refusals, and,
// opt-in, the game's female and male player setups and rigs against WolvenKit's JSON (tools/native-facial-oracle.ts).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { facialSetupCounts, readFacialBakedData, readFacialPosesData, readFacialSetupBuffer } from "../src/native/facial-setup";
import { NativeMalformedError } from "../src/native/native-errors";
import { compareFacialResource } from "../tools/native-facial-oracle";
import { intakePaths, primaryCheckout } from "../tools/facial-solver-oracle";
import { oracleDescribe } from "./optional-oracles";

const part = (overrides: Record<string, number> = {}) => ({ numEnvelopesPerTrackMapping: 0, numGlobalLimits: 0, numInfluencedPoses: 0, numInfluenceIndices: 0,
  numUpperLowerFace: 0, numLipsyncPosesSides: 0, numGlobalCorrectiveEntries: 0, numInbetweenCorrectiveEntries: 0, numCorrectiveInfluencedPoses: 0,
  numCorrectiveInfluenceIndices: 0, numAllMainPoses: 0, numAllMainPosesInbetweens: 0, numAllMainPosesInbetweenScopeMultipliers: 0, numWrinkles: 0, ...overrides });
const info = { numLipsyncOverridesIndexMapping: 1, numJointRegions: 2, face: part({ numEnvelopesPerTrackMapping: 1, numGlobalLimits: 1, numGlobalCorrectiveEntries: 1,
  numAllMainPoses: 1, numAllMainPosesInbetweens: 2, numAllMainPosesInbetweenScopeMultipliers: 1, numWrinkles: 1 }), eyes: part(), tongue: part({ numInfluenceIndices: 1 }) };
const posesInfo = { face: { numMainPoses: 1, numMainTransforms: 1, numMainScales: 1, numCorrectivePoses: 0, numCorrectiveTransforms: 0, numCorrectiveScales: 0 },
  eyes: {}, tongue: {} };

class Bytes {
  private readonly parts: number[] = [];
  private readonly view = new DataView(new ArrayBuffer(8));
  u8(v: number) { this.parts.push(v); return this; }
  u16(v: number) { this.view.setUint16(0, v, true); this.parts.push(this.view.getUint8(0), this.view.getUint8(1)); return this; }
  u32(v: number) { this.view.setUint32(0, v, true); for (let i = 0; i < 4; i++) this.parts.push(this.view.getUint8(i)); return this; }
  f32(v: number) { this.view.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.parts.push(this.view.getUint8(i)); return this; }
  done() { return Uint8Array.from(this.parts); }
}

describe("facial setup buffers", () => {
  const counts = facialSetupCounts(info, posesInfo);
  test("bakedData: packed tables in order Face, Tongue, Eyes; corrective entries hold the track above a 4-bit flag", () => {
    const bytes = new Bytes().u16(37).u8(255).u8(0)
      .u16(21).u8(1).u8(2) // envelope
      .f32(0.5).f32(0.4).f32(0.35).u16(39).u8(1).u8(0) // limit
      .u16(3).u16((114 << 4) | 1) // corrective entry
      .u16(21).u8(2).u8(0) // main pose
      .f32(0.5).f32(1).f32(2) // in-betweens, multiplier
      .u16(21) // wrinkle
      .u16(83) // tongue influence index
      .done();
    const data = readFacialBakedData(bytes, counts) as Record<string, Record<string, unknown[]>> & { LipsyncOverridesIndexMapping: number[]; JointRegions: number[] };
    expect(data.LipsyncOverridesIndexMapping).toEqual([37]);
    expect(data.JointRegions).toEqual([255, 0]);
    expect(data.Face!.EnvelopesPerTrackMapping).toEqual([{ Track: 21, LevelOfDetail: 1, Envelope: 2 }]);
    expect(data.Face!.GlobalLimits).toEqual([{ Max: 0.5, Mid: 0.400000006, Min: 0.349999994, Track: 39, Envelope: 1, IsCachable: 0 }]);
    expect(data.Face!.GlobalCorrectiveEntries).toEqual([{ Index: 3, Track: 114, Unknown: 1 }]);
    expect(data.Face!.AllMainPosesInbetweens).toEqual([0.5, 1]);
    expect(data.Tongue!.InfluenceIndices).toEqual([83]);
    expect(data.Eyes!.Wrinkles).toEqual([]);
  });
  test("pose buffers: 16-byte poses (IsScale in the count's top bit), 32-byte transforms, 16-byte scales", () => {
    const bytes = new Bytes().u32(0).u32(0).u16(0x8001).u16(0).u8(3).u8(0).u16(0)
      .f32(0).f32(0).f32(0).f32(1).f32(0.00115).f32(0).f32(0).u16(207).u8(0).u8(0)
      .f32(0.6).f32(0.6).f32(0.6).f32(1).done();
    const data = readFacialPosesData(bytes, counts, "main") as Record<string, { Poses: unknown[]; Transforms: { Bone: number; Translation: { X: number } }[]; Scales: unknown[] }>;
    expect(data.Face!.Poses).toEqual([{ TransformIdx: 0, ScaleIdx: 0, NumTransforms: 1, IsScale: 1, Flag1: 0, Flag2: 3, Flag3: 0 }]);
    expect(data.Face!.Transforms[0]!.Bone).toBe(207);
    expect(data.Face!.Transforms[0]!.Translation.X).toBe(0.00115000003);
    expect(data.Face!.Scales).toEqual([{ $type: "Quaternion", i: 0.600000024, j: 0.600000024, k: 0.600000024, r: 1 }]);
    expect(readFacialPosesData(new Uint8Array(0), counts, "corrective")).toEqual({ Face: { Poses: [], Transforms: [], Scales: [] },
      Tongue: { Poses: [], Transforms: [], Scales: [] }, Eyes: { Poses: [], Transforms: [], Scales: [] } });
  });
  test("a buffer whose length disagrees with its counts, or a count that isn't one, is refused", () => {
    expect(() => readFacialSetupBuffer("bakedData", new Uint8Array(3), counts)).toThrow(NativeMalformedError);
    expect(() => readFacialSetupBuffer("mainPosesData", new Uint8Array(65), counts)).toThrow("its counts need 64");
    expect(() => facialSetupCounts({ ...info, numJointRegions: -1 }, posesInfo)).toThrow("not a count");
    expect(() => facialSetupCounts({ ...info, numJointRegions: 1.5 }, posesInfo)).toThrow("not a count");
    // Absent counts read as zero (a file leaves zero counts out).
    expect(facialSetupCounts({}, {}).parts.Face.numWrinkles).toBe(0);
  });
  test("mutated bytes are refused or read within their length, never past it", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(rnd() * 80), bytes = Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
      for (const property of ["bakedData", "mainPosesData", "correctivePosesData"] as const) {
        try { readFacialSetupBuffer(property, bytes, counts); } catch (error) { expect(error).toBeInstanceOf(NativeMalformedError); }
      }
    }
  });
});

const game = process.env.XFS_RESOLVER_GAME_ROOT, intake = resolve(process.env.XFS_FACIAL_INTAKE ?? join(primaryCheckout(), "research", "consumers"));
const paths = intakePaths(intake);
const available = !!game && existsSync(game) && process.platform === "win32" && [paths.setup, paths.setupJson, paths.rig, paths.rigJson].every(existsSync);
oracleDescribe(available, "the native facial setup oracle needs XFS_RESOLVER_GAME_ROOT (a Windows game install, for its Oodle library) and the local facial intake (research/consumers/cc-idle and game-blink).")(
  "the game's facial setups and face rig read natively against WolvenKit's JSON", () => {
    test("female and male player setups and the rigs: no difference", async () => {
      const { loadGameOodle } = await import("../src/native/oodle");
      const oodle = loadGameOodle(game!);
      const pairs: [string, string][] = [[paths.setup, paths.setupJson], [paths.rig, paths.rigJson]];
      if (existsSync(paths.maleSetup) && existsSync(paths.maleSetupJson)) pairs.push([paths.maleSetup, paths.maleSetupJson]);
      for (const [resource, reference] of pairs) expect(compareFacialResource(resource, reference, oodle.decompress).sample).toEqual([]);
    }, 60_000);
  });
