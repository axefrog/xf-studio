// The live-pose carrier's pure parts (tools/live-pose/carrier.ts): the key plan, byte layout, rotation
// encoding, the hash shared with the plugin, the WolvenKit JSON it builds and the verifier's decoder,
// with a small synthetic rig (no game data).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARRIER,
  carrierProblems,
  carrierSetJson,
  carrierTweak,
  carrierXl,
  decodeRotation,
  decodeSet,
  encodeRotation,
  keysHash,
  planCarrier,
  readRig,
  type RigData,
} from "../live-pose/carrier.ts";

const rigJson = (names: string[]) => ({
  Data: {
    RootChunk: {
      $type: "animRig",
      boneNames: names.map((n) => ({ $type: "CName", $storage: "string", $value: n })),
      boneTransforms: names.map((_, i) => ({
        Rotation: { i: 0, j: 0, k: Math.sin(i * 0.1), r: Math.cos(i * 0.1) },
        Translation: { X: 0, Y: 0.1 * i, Z: i === 2 ? 1 : 0, W: 0 },
      })),
      referenceTracks: [1, 1, 0],
    },
  },
});

describe("carrier", () => {
  const rig: RigData = readRig(rigJson(["Root", "Trajectory", "Hips", "Spine"]));
  const plan = planCarrier(rig);

  test("every joint gets one constant rotation and one translation key; the rig's reference tracks follow", () => {
    expect(plan.keys.length).toBe(8);
    expect(plan.keys.filter((k) => k.channel === 1).map((k) => k.joint)).toEqual([0, 1, 2, 3]);
    expect(plan.tracks).toEqual([
      { track: 0, value: 1 },
      { track: 1, value: 1 },
      { track: 2, value: 0 },
    ]);
  });

  test("the rotation encoding round-trips, keeping w's sign", () => {
    for (const q of [
      [0, 0, 0, 1],
      [0.2, -0.3, 0.1, -0.927],
      [0.5, 0.5, 0.5, 0.5],
    ] as [number, number, number, number][]) {
      const e = encodeRotation(q);
      const back = decodeRotation(e.x, e.y, e.z, e.wSign);
      const length = Math.hypot(...q);
      back.forEach((c, i) => expect(c).toBeCloseTo(q[i] / length, 5));
    }
  });

  test("the keys hash equals the plugin's for the same keys (native/src/selftest/UnitTests.cpp)", () => {
    const keys = [0, 1, 2].flatMap((joint) => {
      const r = encodeRotation([0, 0, 0, 1]);
      return [
        { joint, channel: 1, wSign: r.wSign, x: r.x, y: r.y, z: r.z },
        { joint, channel: 0, wSign: false, x: 0, y: Math.fround(0.1), z: 0 },
      ];
    });
    expect(keysHash(keys)).toBe("b1a8348859a0a5c3");
  });

  test("the set JSON holds one clip of constant keys, no fallback frames, and decodes back to the plan", () => {
    const json = carrierSetJson(rig, plan);
    const root = json.Data.RootChunk;
    expect(root.animations.length).toBe(1);
    expect(root.fallbackAnimFrameDescs).toEqual([]);
    expect(root.rig.DepotPath.$value).toBe(CARRIER.rig);
    const buffer = root.animations[0].Data.animation.Data.animBuffer.Data;
    expect(buffer.dataAddress.zeInBytes).toBe(8 * 16 + 3 * 8);
    const [clip] = decodeSet(json);
    expect(clip.name).toBe(CARRIER.clip);
    expect(clip.keys).toEqual(plan.keys);
    expect(clip.tracks).toEqual(plan.tracks);
    expect(carrierProblems(clip)).toEqual([]);
    expect(keysHash(clip.keys)).toBe(keysHash(plan.keys));
  });

  test("the verifier notices a missing rotation, a duplicate key or animated keys", () => {
    const [clip] = decodeSet(carrierSetJson(rig, plan));
    expect(carrierProblems({ ...clip, keys: clip.keys.filter((k) => !(k.joint === 1 && k.channel === 1)) })[0]).toContain("joints without");
    expect(carrierProblems({ ...clip, keys: [...clip.keys, clip.keys[0]] }).join()).toContain("twice");
    expect(carrierProblems({ ...clip, counts: { ...clip.counts, raw: 4 } }).join()).toContain("raw");
  });

  test("the records and the ArchiveXL file name the carrier the plugin looks for", () => {
    const tweak = carrierTweak();
    expect(tweak).toContain(`${CARRIER.record}:`);
    expect(tweak).toContain(`animationName: ${CARRIER.clip}`);
    expect(tweak).toContain(`displayName: ${CARRIER.poseLabel}`);
    expect(tweak).toContain("- !append-once PhotoModePoses.xfs_live_carrier");
    expect(carrierXl()).toContain("entity: photomode_wa.ent");
    expect(carrierXl()).toContain(`set: ${CARRIER.set}`);
    // The plugin's constants (core/LivePose.hpp) are the same names.
    const header = readFileSync(join(import.meta.dir, "..", "..", "native", "src", "core", "LivePose.hpp"), "utf8");
    expect(header).toContain(`kCarrierSet = "${CARRIER.set.replaceAll("\\", "\\\\")}"`);
    expect(header).toContain(`kCarrierClip = "${CARRIER.clip}"`);
    expect(header).toContain(`kCarrierPoseLabel = "${CARRIER.poseLabel}"`);
  });

  test("a rig JSON that isn't one is refused", () => {
    expect(() => readRig({ Data: { RootChunk: { $type: "animAnimSet" } } })).toThrow();
  });
});
