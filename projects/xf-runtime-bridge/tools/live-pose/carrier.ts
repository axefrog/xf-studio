// The live-posing experiment's carrier clip (research/animation/pose-editor-design.md §7.4, phase L0):
// one XF test pose whose every joint is stored as a constant key, so the bridge's pose.live.apply can
// overwrite those keys in memory. This module is pure: it plans the keys from a rig (WolvenKit's JSON of
// woman_base.rig, read from the player's own game files), writes them in the compressed buffer's byte
// layout, builds the animation set as WolvenKit JSON, and decodes such a set back for the verifier. The
// byte layout and the rotation encoding are the same as the plugin's (native/src/core/LivePose.hpp), and
// keysHash is the same hash as its KeysHash, so the Studio's offline decode and pose.live.read compare.
//
// Layout of a constant key (16 bytes): header u16 (joint 13 bits, channel 2 bits, rotation w sign),
// time u16 (0), x y z float32. A constant track key (8 bytes): track u16, time u16 (0), value float32.
// Source for both: WolvenKit animAnimationBufferCompressed.ReadBuffer / WriteBuffer.

export const CARRIER = {
  set: "xf\\live_pose\\xfs_live_carrier_female.anims",
  clip: "xfs_live_carrier",
  record: "PhotoModePoses.xfs_live_carrier",
  category: "PhotoModePoseCategories.xfs_live",
  poseLabel: "XF Live Carrier",
  categoryLabel: "XF Live",
  archive: "xf_live_pose_test",
  rig: "base\\characters\\base_entities\\woman_base\\woman_base.rig",
} as const;

export const TRANSLATION = 0;
export const ROTATION = 1;

export type ConstKey = { joint: number; channel: number; wSign: boolean; x: number; y: number; z: number };
export type TrackKey = { track: number; value: number };

export type RigData = {
  names: string[];
  rotations: [number, number, number, number][]; // x, y, z, w (local)
  translations: [number, number, number][];
  referenceTracks: number[];
};

const f32 = (v: number) => Math.fround(v);

/** header u16: joint (13 bits), channel (2 bits), w sign (1 bit). */
export const header = (joint: number, channel: number, wSign: boolean) => (joint & 0x1fff) | ((channel & 3) << 13) | (wSign ? 0x8000 : 0);

/** A unit quaternion to the stored form: (x, y, z) / sqrt(1 + |w|) and the sign of w. */
export function encodeRotation(q: [number, number, number, number]): { x: number; y: number; z: number; wSign: boolean } {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  const [x, y, z, w] = q.map((c) => c / length);
  const divisor = Math.sqrt(1 + Math.abs(w));
  return { x: f32(x / divisor), y: f32(y / divisor), z: f32(z / divisor), wSign: w < 0 };
}

/** The stored form back to (x, y, z, w), as WolvenKit and the plugin decode it. */
export function decodeRotation(x: number, y: number, z: number, wSign: boolean): [number, number, number, number] {
  const d = x * x + y * y + z * z;
  const scale = Math.sqrt(Math.max(0, 2 - d));
  const w = 1 - d;
  return [x * scale, y * scale, z * scale, wSign ? -w : w];
}

/** Reads a WolvenKit JSON of an animRig: joint names, reference local rotations and translations, reference tracks. */
export function readRig(json: unknown): RigData {
  const root = (json as { Data?: { RootChunk?: Record<string, unknown> } }).Data?.RootChunk;
  if (!root || root.$type !== "animRig") throw new Error("not a WolvenKit JSON of an animRig");
  const names = (root.boneNames as { $value: string }[]).map((n) => n.$value);
  const transforms = root.boneTransforms as { Rotation: Record<string, number>; Translation: Record<string, number> }[];
  if (!Array.isArray(transforms) || transforms.length !== names.length) throw new Error("the rig's transforms don't match its joints");
  return {
    names,
    rotations: transforms.map((t) => [t.Rotation.i, t.Rotation.j, t.Rotation.k, t.Rotation.r]),
    translations: transforms.map((t) => [t.Translation.X, t.Translation.Y, t.Translation.Z]),
    referenceTracks: (root.referenceTracks as number[]) ?? [],
  };
}

/** The carrier's keys: every joint's reference rotation and translation as constant keys, the rig's reference tracks. */
export function planCarrier(rig: RigData): { keys: ConstKey[]; tracks: TrackKey[] } {
  const keys: ConstKey[] = [];
  rig.names.forEach((_, joint) => {
    const r = encodeRotation(rig.rotations[joint]);
    keys.push({ joint, channel: ROTATION, wSign: r.wSign, x: r.x, y: r.y, z: r.z });
    const t = rig.translations[joint];
    keys.push({ joint, channel: TRANSLATION, wSign: false, x: f32(t[0]), y: f32(t[1]), z: f32(t[2]) });
  });
  const tracks = rig.referenceTracks.map((value, track) => ({ track, value: f32(value) }));
  return { keys, tracks };
}

/** The key block: constant keys, then constant track keys (no animated keys). */
export function keyBytes(keys: ConstKey[], tracks: TrackKey[]): Uint8Array {
  const bytes = new Uint8Array(keys.length * 16 + tracks.length * 8);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const key of keys) {
    view.setUint16(at, header(key.joint, key.channel, key.wSign), true);
    view.setUint16(at + 2, 0, true);
    view.setFloat32(at + 4, key.x, true);
    view.setFloat32(at + 8, key.y, true);
    view.setFloat32(at + 12, key.z, true);
    at += 16;
  }
  for (const track of tracks) {
    view.setUint16(at, track.track, true);
    view.setUint16(at + 2, 0, true);
    view.setFloat32(at + 4, track.value, true);
    at += 8;
  }
  return bytes;
}

/** FNV-1a 64 over each constant key's header and x, y, z bytes (native/src/core/LivePose.cpp KeysHash). */
export function keysHash(keys: ConstKey[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const scratch = new DataView(new ArrayBuffer(14));
  for (const key of keys) {
    scratch.setUint16(0, header(key.joint, key.channel, key.wSign), true);
    scratch.setFloat32(2, key.x, true);
    scratch.setFloat32(6, key.y, true);
    scratch.setFloat32(10, key.z, true);
    for (let i = 0; i < 14; i++) {
      hash ^= BigInt(scratch.getUint8(i));
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });

/**
 * The carrier set as WolvenKit JSON (WKitJsonVersion 0.0.9, the shape WolvenKit 9.0.1 writes for
 * animAnimSet): one entry, one compressed buffer holding only constant keys, one data chunk, no fallback
 * frames and nothing from any game set.
 */
export function carrierSetJson(rig: RigData, plan: { keys: ConstKey[]; tracks: TrackKey[] }, exportedAt = "2026-09-27T00:00:00Z") {
  const bytes = keyBytes(plan.keys, plan.tracks);
  const base64 = Buffer.from(bytes).toString("base64");
  const duration = 0.0333333351;
  return {
    Header: {
      WolvenKitVersion: "9.0.1",
      WKitJsonVersion: "0.0.9",
      GameVersion: 2310,
      ExportedDateTime: exportedAt,
      DataType: "CR2W",
      ArchiveFileName: "",
    },
    Data: {
      Version: 195,
      BuildVersion: 0,
      RootChunk: {
        $type: "animAnimSet",
        animationDataChunks: [{ $type: "animAnimDataChunk", buffer: { BufferId: "0", Flags: 0, Bytes: base64 } }],
        animations: [
          {
            HandleId: "0",
            Data: {
              $type: "animAnimSetEntry",
              animation: {
                HandleId: "1",
                Data: {
                  $type: "animAnimation",
                  additionalTracks: { $type: "animAdditionalFloatTrackContainer", entries: [], overwriteExistingValues: 1 },
                  additionalTransforms: { $type: "animAdditionalTransformContainer", entries: [] },
                  animationType: "Normal",
                  animBuffer: {
                    HandleId: "2",
                    Data: {
                      $type: "animAnimationBufferCompressed",
                      animKeys: null,
                      animKeysRaw: null,
                      constAnimKeys: null,
                      constTrackKeys: null,
                      dataAddress: { $type: "animAnimDataAddress", fsetInBytes: 0, unkIndex: 0, zeInBytes: bytes.length },
                      defferedBuffer: null,
                      duration,
                      extraDataNames: [],
                      fallbackFrameIndices: [],
                      hasRawRotations: 0,
                      inplaceCompressedBuffer: null,
                      isScaleConstant: 1,
                      numAnimKeys: 0,
                      numAnimKeysRaw: 0,
                      numConstAnimKeys: plan.keys.length,
                      numConstTrackKeys: plan.tracks.length,
                      numExtraJoints: 0,
                      numExtraTracks: 0,
                      numFrames: 2,
                      numJoints: rig.names.length,
                      numTrackKeys: 0,
                      numTracks: plan.tracks.length,
                      tempBuffer: { BufferId: "1", Flags: 0, Bytes: base64 },
                      trackKeys: null,
                    },
                  },
                  duration,
                  frameClamping: 0,
                  frameClampingEndFrame: -1,
                  frameClampingStartFrame: -1,
                  motionExtraction: null,
                  name: cname(CARRIER.clip),
                  tags: { $type: "redTagList", tags: [] },
                },
              },
              events: null,
            },
          },
        ],
        cookingPlatform: "PLATFORM_PC",
        fallbackAnimDataBuffer: null,
        fallbackAnimDescIndexes: [],
        fallbackAnimFrameDescs: [],
        fallbackDataAddresses: [],
        fallbackDataAddressIndexes: [],
        fallbackNumFloatTrackData: 0,
        fallbackNumPositionData: 0,
        fallbackNumRotationData: 0,
        rig: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: CARRIER.rig }, Flags: "Default" },
        tags: { $type: "redTagList", tags: [] },
        version: 0,
      },
      EmbeddedFiles: [],
    },
  };
}

export type DecodedClip = {
  name: string;
  numJoints: number;
  numTracks: number;
  counts: { anim: number; raw: number; constKeys: number; tracks: number; constTracks: number };
  keys: ConstKey[];
  tracks: TrackKey[];
};

/**
 * Decodes every compressed clip of a WolvenKit JSON of an animAnimSet from its data chunks (the bytes the
 * game loads), for the verifier. Only clips whose key block is constant keys and tracks are decoded in
 * full; others report their counts.
 */
export function decodeSet(json: unknown): DecodedClip[] {
  const root = (json as { Data?: { RootChunk?: Record<string, any> } }).Data?.RootChunk;
  if (!root || root.$type !== "animAnimSet") throw new Error("not a WolvenKit JSON of an animAnimSet");
  const chunks: Buffer[] = (root.animationDataChunks ?? []).map((c: any) => Buffer.from(c.buffer?.Bytes ?? "", "base64"));
  return (root.animations ?? []).map((entry: any) => {
    const animation = entry.Data.animation.Data;
    const buffer = animation.animBuffer.Data;
    const counts = {
      anim: buffer.numAnimKeys,
      raw: buffer.numAnimKeysRaw,
      constKeys: buffer.numConstAnimKeys,
      tracks: buffer.numTrackKeys,
      constTracks: buffer.numConstTrackKeys,
    };
    const clip: DecodedClip = { name: animation.name.$value, numJoints: buffer.numJoints, numTracks: buffer.numTracks, counts, keys: [], tracks: [] };
    if (buffer.$type !== "animAnimationBufferCompressed") return clip;
    const address = buffer.dataAddress;
    const chunk = chunks[address.unkIndex];
    if (!chunk) throw new Error(`clip ${clip.name}: data chunk ${address.unkIndex} is missing`);
    const block = chunk.subarray(address.fsetInBytes, address.fsetInBytes + address.zeInBytes);
    const expected = counts.anim * 10 + counts.raw * 16 + counts.constKeys * 16 + counts.tracks * 8 + counts.constTracks * 8;
    if (block.length !== expected) throw new Error(`clip ${clip.name}: ${block.length} bytes of keys, the counts need ${expected}`);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    let at = counts.anim * 10 + counts.raw * 16;
    for (let i = 0; i < counts.constKeys; i++, at += 16) {
      const bits = view.getUint16(at, true);
      clip.keys.push({
        joint: bits & 0x1fff,
        channel: (bits >> 13) & 3,
        wSign: (bits & 0x8000) !== 0,
        x: view.getFloat32(at + 4, true),
        y: view.getFloat32(at + 8, true),
        z: view.getFloat32(at + 12, true),
      });
    }
    at += counts.tracks * 8;
    for (let i = 0; i < counts.constTracks; i++, at += 8) clip.tracks.push({ track: view.getUint16(at, true), value: view.getFloat32(at + 4, true) });
    return clip;
  });
}

/** The carrier contract, as the plugin checks it: only constant joint keys, one constant rotation key per joint. */
export function carrierProblems(clip: DecodedClip): string[] {
  const problems: string[] = [];
  if (clip.counts.anim !== 0 || clip.counts.raw !== 0) problems.push(`${clip.counts.anim} compressed and ${clip.counts.raw} raw keys (want none)`);
  const rotations = new Array(clip.numJoints).fill(0);
  const seen = new Set<string>();
  for (const key of clip.keys) {
    if (key.joint >= clip.numJoints) problems.push(`a key names joint ${key.joint} of ${clip.numJoints}`);
    if (key.channel === ROTATION) rotations[key.joint]++;
    const id = `${key.joint}/${key.channel}`;
    if (seen.has(id)) problems.push(`joint ${key.joint} channel ${key.channel} appears twice`);
    seen.add(id);
  }
  const missing = rotations.flatMap((count, joint) => (count === 1 ? [] : [joint]));
  if (missing.length) problems.push(`${missing.length} joints without exactly one constant rotation key (${missing.slice(0, 8).join(", ")})`);
  return problems;
}

/** The test package's TweakXL records: an XF category and the carrier pose, appended once (the pose packs' shape). */
export function carrierTweak(): string {
  return `# XF Live Pose (test): the live-posing experiment's carrier pose. Test profile only; never distributed.
# Generated by projects/xf-runtime-bridge/tools/live-pose/build-carrier.ts.

${CARRIER.category}:
  $base: PhotoModePoseCategories.idleCategory
  categoryName: ${CARRIER.category}
  displayName: ${CARRIER.categoryLabel}

photo_mode.character.poseCategories:
  - !append-once ${CARRIER.category}

${CARRIER.record}:
  $base: PhotoModePoses.idle_stand_01
  acceptedWeaponConfig: POSE_HIDE_WEAPON
  animationName: ${CARRIER.clip}
  animationTime: 0
  category: ${CARRIER.category}
  displayName: ${CARRIER.poseLabel}
  filterOutForGarmentTags: []

photo_mode.character.femalePoses:
  - !append-once ${CARRIER.record}
`;
}

/** The test package's ArchiveXL file: the carrier set on V's photo-mode puppets (ArchiveXL's photomode_wa.ent scope). */
export function carrierXl(): string {
  return `animations:
  - entity: photomode_wa.ent
    set: ${CARRIER.set}
`;
}
