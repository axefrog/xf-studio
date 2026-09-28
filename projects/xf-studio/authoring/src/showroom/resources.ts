/**
 * XF Finish Showroom's resource definitions: the WolvenKit JSON of the showroom entity (one appearance per
 * preset: a mannequin head on a pedestal wearing that preset's eye plate) and of the creator-style light
 * rigs, plus the arithmetic that places them. Pure: no file or process access. The builder (`build.ts`)
 * writes these beside the eye-makeup exporter's verified plate and textures; the independent verifier
 * (`verify.ts`) restates what it checks and imports nothing from here.
 *
 * Why this shape (knowledge/skin-on-spawned-objects.md §2, §4): the game's own shop mannequins bind an NPC
 * head's meshes to an `entAnimatedComponent` carrying that head's skeleton rig; the player head, her eyes and
 * the XF eye plate skin only to bones of the player head's own rig, so the same pattern with the player's
 * face-rig resources (h0_000__basehead_face_rig.app) stands the head at a person's height above the entity's
 * origin, facing +Y. Vanilla meshes are referenced by path, never copied.
 */
import { createHash } from "node:crypto";
import { CREATOR_HEAD_SLOT, CREATOR_RIG_FEMALE, coneFactor, falloff, type CreatorLight, type Vec3 } from "../creator-lighting";
import { FINISH_SHOWROOM_MOD } from "../mod-branding";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SHOWROOM_SCHEMA = "xfs/showroom-package-1";
export const SHOWROOM_MOD_NAME = FINISH_SHOWROOM_MOD.modName;
/** Bumped whenever the same inputs would build different bytes. */
export const SHOWROOM_BUILDER_VERSION = "1";

/** The player head's parts and face rig (feminine V, game 2.31), by path. [resource] */
export const SHOWROOM_VANILLA = Object.freeze({
  faceRig: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead_skeleton.rig",
  faceGraph: "base\\animations\\facial\\_facial_graphs\\player_woman_paperdoll_sermo.animgraph",
  // The player head's own face rig uses the male player's facial setup for both bodies (h0_000__basehead_face_rig.app).
  facialSetup: "base\\characters\\head\\pma\\h0_001_ma_c__player\\h0_001_ma_c__player_rigsetup.facialsetup",
  head: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead.mesh",
  eyes: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\he_000_pwa_c__basehead.mesh",
  /** The creator box's own black panel: a 1 m cube with one corner at its origin (x −1…0, y −1…0, z 0…1). */
  box: "base\\items\\quest\\q110__misc\\q110_black_box.mesh",
});
/** `01_ca_pale` has TintScale 0: the skin albedo untinted (knowledge/head-cc-rendering.md §2). */
export const DEFAULT_SKIN = "01_ca_pale";
export const DEFAULT_EYES = "gradient_brown";
/** The head mesh's tone/type appearances and the eye mesh's gradient colours a build may choose. */
export const SKIN_PATTERN = /^0[1-6]_(?:ca|bl)_[a-z]+(?:_0[0-2]_[a-z]+_?)?(?:_?_d0[2-5])?$/;
export const EYES_PATTERN = /^gradient_[a-z_]+$/;

/** Where the player head's rig puts its joints in the reference pose (entity frame: X right, Y forward, Z up; metres). [resource] */
export const HEAD_JOINT: Vec3 = [0, -0.0403, 1.6397];
/** The head mesh's lowest vertex: the neck's cut. [resource] */
export const NECK_CUT_Z = 1.4617;

/**
 * The pedestal: one square column the neck sits down into. In game (session 5, 29 September 2026) every head floated a
 * few centimetres above a column that topped out 8 mm above the neck's cut, so the head draws a little higher than the
 * rig's reference pose puts it [runtime; the cause, the face rig's pose without animation, is a hypothesis]. The
 * panel's own bounds are exactly x −1…0, y −1…0, z 0…1 [resource: `q110_black_box.mesh` serialized with WolvenKit 9.0.1],
 * so the gap isn't the box. The column now rises 6 cm above the cut (the neck's lowest part sits inside it) and reaches
 * 1.5 m below the entity's origin, so a head the bridge raises to the camera's eye line (showroom.spawn height_m) still
 * stands on the floor; unraised, that part is under the floor. The base slab is gone: raised, it would float.
 */
export const PEDESTAL = Object.freeze({
  column: { width: 0.24, top: 1.52, bottom: -1.5, centreY: -0.07 },
});

/** Stable component ID from its name: 63 bits of SHA-256 (WolvenKit reads a component ID as a signed 64-bit number), never 0. */
export function showroomComponentId(name: string): string {
  const value = createHash("sha256").update("xfs:showroom:component:" + name, "utf8").digest().readBigUInt64LE(0) & 0x7fffffffffffffffn;
  return String(value || 1n);
}

/**
 * The showroom's own collection identity, derived from the source collection's: a UUID-shaped SHA-256 prefix,
 * so the eye-makeup exporter builds the plate and textures under a depot and names the collection's own eye-makeup mod never
 * uses, and the showroom and that mod can be installed together.
 */
export function showroomCollectionId(collectionId: string): string {
  const hex = createHash("sha256").update("xfs:showroom:" + collectionId.toLowerCase(), "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type ShowroomPaths = { readonly depot: string; readonly entity: string; readonly app: string; readonly rigEntity: string;
  readonly rigApp: string; readonly archive: string };
/** Resource paths of a showroom for the eye-makeup plan's depot (`axefrog/appearance_studio/collections/<key>`). */
export function showroomPaths(depot: string): ShowroomPaths {
  const key = depot.slice(depot.lastIndexOf("/") + 1);
  if (!/^[0-9a-f]{32}$/.test(key)) throw Error("The showroom's depot must end in its collection key.");
  const root = `${depot}/showroom`;
  return { depot, entity: `${root}/xfs_showroom.ent`, app: `${root}/xfs_showroom.app`, rigEntity: `${root}/xfs_showroom_rig.ent`,
    rigApp: `${root}/xfs_showroom_rig.app`, archive: `xfs_showroom_${key}` };
}

const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const ref = (path: string, soft = false) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: path.replaceAll("/", "\\") },
  Flags: soft ? "Soft" : "Default" });
const document = (root: Json) => ({
  Header: { WolvenKitVersion: "9.0.1", WKitJsonVersion: "0.0.9", GameVersion: 2310, DataType: "CR2W" },
  Data: { Version: 195, BuildVersion: 0, RootChunk: root, EmbeddedFiles: [] },
});
/** FixedPoint: 17 fractional bits. */
const fixed = (metres: number) => ({ $type: "FixedPoint", Bits: Math.round(metres * 131072) });
const worldTransform = (position: Vec3, orientation: readonly [number, number, number, number] = [0, 0, 0, 1]) => ({
  $type: "WorldTransform", Orientation: { $type: "Quaternion", i: orientation[0], j: orientation[1], k: orientation[2], r: orientation[3] },
  Position: { $type: "WorldPosition", x: fixed(position[0]), y: fixed(position[1]), z: fixed(position[2]) } });
const FULL_CHUNK_MASK = "9223372036854775807";

class Handles {
  private next = 1;
  handle(data: Json) { return { HandleId: String(this.next++), Data: data }; }
}

// --- the showroom entity ---------------------------------------------------------------------------------

export type ShowroomPiece = { readonly appearance: string };
export type ShowroomLook = { readonly skin: string; readonly eyes: string };

function skinnedMesh(handles: Handles, name: string, mesh: string, appearance: string) {
  return { $type: "entSkinnedMeshComponent", name: cname(name), id: showroomComponentId(name), isEnabled: 1, isReplicable: 0,
    mesh: ref(mesh), meshAppearance: cname(appearance), chunkMask: FULL_CHUNK_MASK, forceLODLevel: -1,
    parentTransform: handles.handle({ $type: "entHardTransformBinding", bindName: cname("face_rig"), enabled: 1 }),
    skinning: handles.handle({ $type: "entSkinningBinding", bindName: cname("face_rig"), enabled: 1 }) };
}
function staticBox(name: string, position: Vec3, scale: Vec3) {
  return { $type: "entMeshComponent", name: cname(name), id: showroomComponentId(name), isEnabled: 1, isReplicable: 0,
    mesh: ref(SHOWROOM_VANILLA.box), meshAppearance: cname("default"), chunkMask: FULL_CHUNK_MASK, forceLODLevel: -1,
    localTransform: worldTransform(position), visualScale: { $type: "Vector3", X: scale[0], Y: scale[1], Z: scale[2] } };
}
/**
 * The box's corner is at its origin, so a box scaled by (w, w, h) is centred on (x, y) by an offset of +w/2 on each axis,
 * and placed at z = bottom it spans bottom…bottom + h.
 */
export function pedestalBoxes(): { name: string; position: Vec3; scale: Vec3 }[] {
  const c = PEDESTAL.column;
  return [{ name: "xfs_pedestal", position: [c.width / 2, c.centreY + c.width / 2, c.bottom], scale: [c.width, c.width, c.top - c.bottom] }];
}

/** The showroom's `.app`: one appearance per preset, each the same head, eyes and pedestal with that preset's plate appearance. */
export function showroomAppearanceResource(pieces: readonly ShowroomPiece[], plateMesh: string, look: ShowroomLook): Json {
  if (!pieces.length) throw Error("A showroom needs at least one preset.");
  const handles = new Handles();
  const appearances = pieces.map(piece => {
    const components: Json[] = [
      { $type: "entAnimatedComponent", name: cname("face_rig"), id: showroomComponentId("face_rig"), isReplicable: 0,
        rig: ref(SHOWROOM_VANILLA.faceRig), graph: ref(SHOWROOM_VANILLA.faceGraph), facialSetup: ref(SHOWROOM_VANILLA.facialSetup) },
      skinnedMesh(handles, "xfs_head", SHOWROOM_VANILLA.head, look.skin),
      skinnedMesh(handles, "xfs_eyes", SHOWROOM_VANILLA.eyes, look.eyes),
      skinnedMesh(handles, "xfs_plate", plateMesh, piece.appearance),
      ...pedestalBoxes().map(box => staticBox(box.name, box.position, box.scale)),
    ];
    return handles.handle({ $type: "appearanceAppearanceDefinition", name: cname(piece.appearance), components,
      partsOverrides: [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: [] }],
      resolvedDependencies: [ref(plateMesh, true)] });
  });
  return document({ $type: "appearanceAppearanceResource", cookingPlatform: "PLATFORM_PC", appearances });
}

/** An entity template whose appearances name the `.app`'s one by one. `gameObject`, so the bridge can turn it with the teleportation facility. */
export function entityTemplate(app: string, appearances: readonly string[]): Json {
  if (!appearances.length) throw Error("An entity needs at least one appearance.");
  return document({ $type: "entEntityTemplate", cookingPlatform: "PLATFORM_PC",
    appearances: appearances.map(name => ({ $type: "entTemplateAppearance", name: cname(name), appearanceResource: ref(app, true),
      appearanceName: cname(name) })),
    defaultAppearance: cname(appearances[0]!), components: [],
    entity: { HandleId: "1", Data: { $type: "gameObject" } } });
}

// --- the light rigs ---------------------------------------------------------------------------------------

export type RigProfile = "creator" | "creator_face" | "key";
export const RIG_PROFILES: readonly RigProfile[] = Object.freeze(["creator", "creator_face", "key"]);
export const rigAppearance = (profile: RigProfile) => `xfs_rig_${profile}`;

/** One rig light in the showroom entity's frame: what the template carries and what a plan needs to estimate spill. */
export type RigLight = {
  readonly name: string;
  readonly position: Vec3;
  readonly axis: Vec3;
  readonly orientation: readonly [number, number, number, number];
  readonly lumen: number;
  readonly colour: readonly [number, number, number];
  readonly falloff: "linear" | "inverse-square";
  readonly radius: number;
  readonly outer: number;
  readonly inner: number;
  readonly softness: number;
  readonly sourceRadius: number;
  readonly localShadows: boolean;
  readonly contactShadows: boolean;
  readonly roughnessBias: number;
};

/**
 * Studio frame (Y up, V faces −Z, V's right +X, metres from the feet) to the entity frame (X right, Y forward, Z up):
 * (x, y, z) → (x, −z, y), then moved so the creator's head slot lands on the showroom head's `Head` joint.
 */
export function studioToEntity(point: Vec3, headSlot: Vec3 = CREATOR_HEAD_SLOT.female): Vec3 {
  const local: Vec3 = [point[0], -point[2], point[1]], slot: Vec3 = [headSlot[0], -headSlot[2], headSlot[1]];
  return [local[0] + HEAD_JOINT[0] - slot[0], local[1] + HEAD_JOINT[1] - slot[1], local[2] + HEAD_JOINT[2] - slot[2]];
}
const direction = (axis: Vec3): Vec3 => { const d: Vec3 = [axis[0], -axis[2], axis[1]], l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l]; };

/** The shortest rotation taking +Y onto `axis` (a spot's axis is its local +Y [hypothesis], as the lighting mirror assumes). */
export function aimQuaternion(axis: Vec3): [number, number, number, number] {
  const [x, y, z] = axis, dot = y; // (0, 1, 0) · axis
  if (dot < -0.999999) return [0, 0, 1, 0]; // 180° about Z
  // q = [ (0,1,0) × axis, 1 + dot ], normalised
  const q: [number, number, number, number] = [z, 0, -x, 1 + dot];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** The head point a light is judged at: the Head joint. */
const HEAD_POINT = HEAD_JOINT;
/** The creator rig light reaches the head through its own cone (full-angle reading) and falloff. */
function reachesHead(l: CreatorLight): boolean {
  const cos = (() => {
    const p = studioToEntity(l.position), a = direction(l.axis), d: Vec3 = [HEAD_POINT[0] - p[0], HEAD_POINT[1] - p[1], HEAD_POINT[2] - p[2]];
    const n = Math.hypot(...d) || 1;
    return (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / n;
  })();
  const p = studioToEntity(l.position), distance = Math.hypot(HEAD_POINT[0] - p[0], HEAD_POINT[1] - p[1], HEAD_POINT[2] - p[2]);
  return coneFactor(l, "full", cos) > 0 && falloff(l, distance) > 0;
}

/**
 * The lights of one rig profile. `creator`: the feminine creator rig's 15 lights with the resource's shadow flags. `creator_face`:
 * the lights whose cone and falloff reach the head, shadows off, so one rig per head stays within a lineup's shadow budget.
 * `key`: Main_Face alone, as the resource has it.
 */
export function rigLights(profile: RigProfile): RigLight[] {
  const source = profile === "key" ? CREATOR_RIG_FEMALE.filter(l => l.name === "Main_Face")
    : profile === "creator_face" ? CREATOR_RIG_FEMALE.filter(reachesHead) : [...CREATOR_RIG_FEMALE];
  return source.map(l => {
    const axis = direction(l.axis);
    const shadows = profile !== "creator_face";
    return { name: l.name, position: studioToEntity(l.position), axis, orientation: aimQuaternion(axis), lumen: l.lumen,
      colour: l.colour ?? [255, 255, 255], falloff: l.falloff, radius: l.radius, outer: l.outer, inner: l.inner, softness: l.softness,
      // Source radius 0.1 m, 0.05 m on the magenta rims (knowledge/creator-lighting.md §2).
      sourceRadius: l.colour && l.colour[1] === 25 ? 0.05 : 0.1,
      localShadows: shadows && l.shadows, contactShadows: shadows && l.contactShadows, roughnessBias: l.roughnessBias };
  });
}

function lightComponent(light: RigLight) {
  const name = `xfs_light_${light.name.toLowerCase()}`;
  return { $type: "entLightComponent", name: cname(name), id: showroomComponentId(name), isEnabled: 1, isReplicable: 0,
    type: "LT_Spot", unit: "LU_Lumen", intensity: light.lumen, EV: 0, temperature: -1,
    color: { $type: "Color", Red: light.colour[0], Green: light.colour[1], Blue: light.colour[2], Alpha: 255 },
    attenuation: light.falloff === "linear" ? "LA_Linear" : "LA_InverseSquare", radius: light.radius,
    innerAngle: light.inner, outerAngle: light.outer, softness: light.softness, sourceRadius: light.sourceRadius,
    enableLocalShadows: light.localShadows ? 1 : 0, contactShadows: light.contactShadows ? "CSR_CharacterOnly" : "CSR_None",
    roughnessBias: light.roughnessBias, autoHideDistance: 40, sceneDiffuse: 1, sceneSpecularScale: 100, useInTransparents: 1,
    localTransform: worldTransform(light.position, light.orientation) };
}

/** The rig `.app`: one appearance per profile, each the profile's lights about the showroom head. */
export function rigAppearanceResource(): Json {
  const handles = new Handles();
  const appearances = RIG_PROFILES.map(profile => handles.handle({ $type: "appearanceAppearanceDefinition", name: cname(rigAppearance(profile)),
    components: rigLights(profile).map(lightComponent), partsOverrides: [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: [] }] }));
  return document({ $type: "appearanceAppearanceResource", cookingPlatform: "PLATFORM_PC", appearances });
}

/** Compact JSON with a trailing newline, as the package builder writes its WolvenKit inputs. */
export const resourceText = (value: unknown) => JSON.stringify(value) + "\n";
