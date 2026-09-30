/**
 * XF Finish Showroom's independent verifier. It imports nothing from the showroom's builder or resource definitions:
 * everything it expects is restated here from its sources (the player head's resources as knowledge/skin-on-spawned-objects.md
 * §2 records them, and the creator rig table, `creator-lighting.ts`, which is the game's data). It sources its own evidence:
 * a copy of the packed archive in an empty folder, hashed and unbundled there, and its own WolvenKit conversion of the members.
 *
 * What it can't establish: that the entity spawns, that the head, plate and lights draw in game, that the rig's spot axes
 * point where the Studio's do, or that ArchiveXL expands the plate's material paths at run time.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { ExportRefusal, type GeneratedFile, type VerifierTools } from "../platform/api";
import { CREATOR_HEAD_SLOT, CREATOR_RIG_FEMALE, type CreatorLight } from "../creator-lighting";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ExportRefusal("package_verification_failed", `Independent showroom verifier failed: ${message}`);
}

/** Restated from knowledge/skin-on-spawned-objects.md §2 and §4.1. */
const EXPECTED = Object.freeze({
  faceRig: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead_skeleton.rig",
  faceGraph: "base\\animations\\facial\\_facial_graphs\\player_woman_paperdoll_sermo.animgraph",
  facialSetup: "base\\characters\\head\\pma\\h0_001_ma_c__player\\h0_001_ma_c__player_rigsetup.facialsetup",
  head: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead.mesh",
  eyes: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\he_000_pwa_c__basehead.mesh",
  box: "base\\items\\quest\\q110__misc\\q110_black_box.mesh",
  /** Head joint in the rig's reference pose (entity frame), and the neck's cut. */
  headJoint: [0, -0.0403, 1.6397] as const,
  neckCut: 1.4617,
  /** How far the column rises past the neck's cut (session 5: the head drew a few centimetres high). */
  pedestalOverlap: 0.04,
  profiles: ["xfs_rig_creator", "xfs_rig_creator_face", "xfs_rig_key"] as const,
});
const FIXED = 1 / 131072;

export type ShowroomVerification = {
  readonly archiveSha256: string;
  readonly members: number;
  readonly pieces: number;
  readonly rigLights: Readonly<Record<string, number>>;
  readonly limits: readonly string[];
  readonly installed: false;
  readonly gameRenderingVerified: false;
};

export type ShowroomVerifyInput = {
  readonly archive: string;
  readonly archiveSha256: string;
  /** The builder's record of the staged tree. */
  readonly files: readonly GeneratedFile[];
  readonly tools: VerifierTools;
  /** An empty (or missing) private folder. */
  readonly work: string;
  readonly expected: {
    readonly depot: string;
    readonly pieces: readonly string[];
    readonly skin: string;
    readonly eyes: string;
    /** The verified eye-makeup archive, unbundled, and its members. */
    readonly eyeUnbundled: string;
    readonly eyeFiles: readonly GeneratedFile[];
  };
};

function list(root: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), info = lstatSync(path);
      ensure(!info.isSymbolicLink(), `a linked path in the unpacked archive: ${name}`);
      if (info.isDirectory()) walk(path);
      else files.push({ path: relative(root, path).split(sep).join("/"), bytes: info.size, sha256: sha256(readFileSync(path)) });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

const name = (value: Json) => typeof value?.$value === "string" ? value.$value : "";
const path = (value: Json) => typeof value?.DepotPath?.$value === "string" ? value.DepotPath.$value : "";
const bits = (value: Json) => Number(value?.Bits) * FIXED;
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

/** Handles in a serialized resource: `{HandleId, Data}` once, `{HandleRefId}` after. */
function handleTable(root: Json): Map<string, Json> {
  const table = new Map<string, Json>();
  const walk = (value: Json) => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== "object") return;
    if (typeof value.HandleId === "string" && value.Data) table.set(value.HandleId, value.Data);
    for (const item of Object.values(value)) walk(item);
  };
  walk(root);
  return table;
}
const deref = (table: Map<string, Json>, value: Json) => value?.Data ?? (value?.HandleRefId !== undefined ? table.get(String(value.HandleRefId)) : undefined);

/** Restated: Studio (x, y, z) → entity (x, −z, y), moved so the feminine creator head slot lands on the head joint. */
function entityPoint(p: readonly number[]): [number, number, number] {
  const slot = CREATOR_HEAD_SLOT.female;
  return [p[0]! + EXPECTED.headJoint[0] - slot[0], -p[2]! + EXPECTED.headJoint[1] + slot[2], p[1]! + EXPECTED.headJoint[2] - slot[1]];
}
function entityAxis(a: readonly number[]): [number, number, number] {
  const d: [number, number, number] = [a[0]!, -a[2]!, a[1]!], l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
}
/** Restated reach: the head joint inside the light's outer cone (full angles) and inside its radius. */
function reachesHead(l: CreatorLight): boolean {
  const p = entityPoint(l.position), a = entityAxis(l.axis);
  const d = [EXPECTED.headJoint[0] - p[0], EXPECTED.headJoint[1] - p[1], EXPECTED.headJoint[2] - p[2]], n = Math.hypot(...d);
  const cos = (d[0]! * a[0] + d[1]! * a[1] + d[2]! * a[2]) / n;
  return cos > Math.cos((l.outer / 2) * Math.PI / 180) && n < l.radius;
}
/** Rotate +Y by quaternion (i, j, k, r). */
function rotateY(q: Json): [number, number, number] {
  const x = Number(q.i), y = Number(q.j), z = Number(q.k), w = Number(q.r);
  return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
}

function checkRig(profile: string, app: Json, table: Map<string, Json>): number {
  const expected = profile === "xfs_rig_key" ? CREATOR_RIG_FEMALE.filter(l => l.name === "Main_Face")
    : profile === "xfs_rig_creator_face" ? CREATOR_RIG_FEMALE.filter(reachesHead) : CREATOR_RIG_FEMALE;
  const definition = app.appearances.map((a: Json) => deref(table, a)).find((a: Json) => name(a?.name) === profile);
  ensure(definition, `the rig has no ${profile} appearance`);
  const components = definition.components as Json[];
  ensure(Array.isArray(components) && components.length === expected.length, `${profile} has ${components?.length} lights, expected ${expected.length}`);
  for (const [i, l] of expected.entries()) {
    const c = components[i];
    const where = `${profile} light ${l.name}`;
    ensure(c.$type === "entLightComponent" && name(c.name) === `xfs_light_${l.name.toLowerCase()}`, `${where} is missing or out of order`);
    ensure(c.type === "LT_Spot" && c.unit === "LU_Lumen" && Number(c.EV) === 0 && Number(c.temperature) === -1, `${where} is not a lumen spot`);
    ensure(near(Number(c.intensity), l.lumen, 1e-4) && near(Number(c.radius), l.radius, 1e-5) && near(Number(c.softness), l.softness, 1e-6),
      `${where} has other lumens, radius or softness than the rig table`);
    ensure(near(Number(c.innerAngle), l.inner, 1e-4) && near(Number(c.outerAngle), l.outer, 1e-4), `${where} has other cone angles`);
    ensure(c.attenuation === (l.falloff === "linear" ? "LA_Linear" : "LA_InverseSquare"), `${where} has another falloff`);
    const colour = l.colour ?? [255, 255, 255];
    ensure(c.color?.Red === colour[0] && c.color?.Green === colour[1] && c.color?.Blue === colour[2], `${where} has another colour`);
    const shadows = profile !== "xfs_rig_creator_face";
    ensure(Boolean(Number(c.enableLocalShadows)) === (shadows && l.shadows), `${where} has other local shadows`);
    ensure(c.contactShadows === (shadows && l.contactShadows ? "CSR_CharacterOnly" : "CSR_None"), `${where} has other contact shadows`);
    const p = entityPoint(l.position), t = c.localTransform;
    for (const [axis, value] of [["x", p[0]], ["y", p[1]], ["z", p[2]]] as const)
      ensure(near(bits(t?.Position?.[axis]), value, 1.5 * FIXED), `${where} is not where the rig table puts it (${axis})`);
    const aimed = rotateY(t?.Orientation), a = entityAxis(l.axis);
    ensure(near(aimed[0], a[0], 1e-3) && near(aimed[1], a[1], 1e-3) && near(aimed[2], a[2], 1e-3), `${where} does not aim along the rig table's axis`);
  }
  return expected.length;
}

export async function verifyShowroomArchive(input: ShowroomVerifyInput): Promise<ShowroomVerification> {
  const { work, tools, expected } = input;
  ensure(!existsSync(work) || readdirSync(work).length === 0, "the work folder is not empty");
  const copies = join(work, "archive"), unpacked = join(work, "unpacked"), serialized = join(work, "json"), members = join(work, "members");
  for (const dir of [copies, unpacked, serialized, members]) mkdirSync(dir, { recursive: true });
  const archive = join(copies, basename(input.archive));
  copyFileSync(input.archive, archive);
  const archiveSha256 = sha256(readFileSync(archive));
  ensure(archiveSha256 === input.archiveSha256, "the archive differs from the build record");
  const unbundle = await tools.unbundle(archive, unpacked);
  ensure(unbundle.exitCode === 0 && !/\bError\s*\]|Unhandled exception/.test(unbundle.stdout + unbundle.stderr), "WolvenKit could not unpack the archive");
  const files = list(unpacked);
  const key = (f: readonly GeneratedFile[]) => JSON.stringify(f.map(x => [x.path, x.bytes, x.sha256]));
  ensure(key(files) === key([...input.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), "the archive holds other files than the build recorded");

  // Exactly the plate, the eye build's textures and the four showroom resources.
  const depot = expected.depot, plate = `${depot}/models/xfs_eye_plate.mesh`;
  const own = ["xfs_showroom.app", "xfs_showroom.ent", "xfs_showroom_rig.app", "xfs_showroom_rig.ent"].map(leaf => `${depot}/showroom/${leaf}`);
  const eyeKept = expected.eyeFiles.filter(f => f.path === plate || (f.path.startsWith(`${depot}/textures/`) && f.path.endsWith(".xbm")));
  ensure(eyeKept.some(f => f.path === plate), "the eye-makeup build has no plate mesh");
  ensure(JSON.stringify(files.map(f => f.path)) === JSON.stringify([...eyeKept.map(f => f.path), ...own].sort()),
    "the archive's members are not exactly the plate, the textures and the showroom's resources");
  for (const f of eyeKept) {
    const packed = files.find(x => x.path === f.path)!;
    ensure(packed.sha256 === sha256(readFileSync(join(expected.eyeUnbundled, ...f.path.split("/")))) && packed.sha256 === f.sha256,
      `${f.path} differs from the verified eye-makeup build`);
  }

  // Own conversion of the five resources it reads.
  for (const member of [plate, ...own]) copyFileSync(join(unpacked, ...member.split("/")), join(members, member.slice(member.lastIndexOf("/") + 1)));
  const run = await tools.serialize(members, serialized);
  ensure(run.exitCode === 0 && !/\bError\s*\]|Unhandled exception/.test(run.stdout + run.stderr), "WolvenKit could not read the showroom's resources");
  const read = (leaf: string) => {
    const file = join(serialized, `${leaf}.json`);
    ensure(existsSync(file), `no conversion of ${leaf}`);
    const text = readFileSync(file, "utf8");
    ensure(text.length > 0, `the conversion of ${leaf} is empty`);
    return JSON.parse(text).Data.RootChunk as Json;
  };
  const toDepot = (p: string) => p.replaceAll("/", "\\");

  // The plate names every piece.
  const plateMesh = read("xfs_eye_plate.mesh");
  const plateTable = handleTable(plateMesh);
  const plateAppearances = new Set((plateMesh.appearances as Json[]).map(a => name(deref(plateTable, a)?.name)));
  for (const piece of expected.pieces) ensure(plateAppearances.has(piece), `the plate has no appearance ${piece}`);

  // The showroom entity and its appearances.
  const checkEntity = (leaf: string, app: string, names: readonly string[]) => {
    const entity = read(leaf);
    ensure(entity.$type === "entEntityTemplate" && entity.entity?.Data?.$type === "gameObject", `${leaf} is not a gameObject template`);
    ensure(JSON.stringify(entity.appearances.map((a: Json) => [name(a.name), path(a.appearanceResource), name(a.appearanceName)]))
      === JSON.stringify(names.map(n => [n, toDepot(app), n])), `${leaf}'s appearances are not one per ${names === expected.pieces ? "preset" : "rig"}`);
    ensure(name(entity.defaultAppearance) === names[0], `${leaf}'s default appearance is not the first`);
  };
  checkEntity("xfs_showroom.ent", own[0]!, expected.pieces);
  checkEntity("xfs_showroom_rig.ent", own[2]!, EXPECTED.profiles);

  const app = read("xfs_showroom.app"), table = handleTable(app);
  const definitions = (app.appearances as Json[]).map(a => deref(table, a));
  ensure(JSON.stringify(definitions.map(d => name(d?.name))) === JSON.stringify(expected.pieces), "the showroom's .app is not one appearance per preset");
  for (const definition of definitions) {
    const piece = name(definition.name);
    const byName = new Map((definition.components as Json[]).map(c => [name(c.name), c]));
    ensure(definition.components.length === 5 && byName.size === 5, `${piece} has other components than the head, eyes, plate, rig and pedestal`);
    const rig = byName.get("face_rig");
    ensure(rig?.$type === "entAnimatedComponent" && path(rig.rig) === EXPECTED.faceRig && path(rig.graph) === EXPECTED.faceGraph
      && path(rig.facialSetup) === EXPECTED.facialSetup, `${piece}'s face rig is not the player head's`);
    for (const [component, mesh, appearance] of [["xfs_head", EXPECTED.head, expected.skin], ["xfs_eyes", EXPECTED.eyes, expected.eyes],
      ["xfs_plate", toDepot(plate), piece]] as const) {
      const c = byName.get(component);
      ensure(c?.$type === "entSkinnedMeshComponent" && path(c.mesh) === mesh && name(c.meshAppearance) === appearance, `${piece}'s ${component} is not ${mesh} (${appearance})`);
      const parent = deref(table, c.parentTransform), skin = deref(table, c.skinning);
      ensure(parent?.$type === "entHardTransformBinding" && name(parent.bindName) === "face_rig"
        && skin?.$type === "entSkinningBinding" && name(skin.bindName) === "face_rig", `${piece}'s ${component} is not skinned to the face rig`);
    }
    {
      const c = byName.get("xfs_pedestal");
      ensure(c?.$type === "entMeshComponent" && path(c.mesh) === EXPECTED.box && name(c.meshAppearance) === "default", `${piece}'s xfs_pedestal is not the creator box's panel`);
      const s = c.visualScale, p = c.localTransform?.Position;
      // The panel spans x and y from −1 to 0 and z from 0 to 1 before scaling: its footprint is [px − sx, px] × [py − sy, py],
      // its height pz…pz + sz.
      const centre = [bits(p?.x) - Number(s?.X) / 2, bits(p?.y) - Number(s?.Y) / 2];
      ensure(near(centre[0]!, 0, 2 * FIXED) && centre[1]! < EXPECTED.headJoint[1] + 0.05 && centre[1]! > EXPECTED.headJoint[1] - 0.1,
        `${piece}'s pedestal is not centred under the head`);
      const bottom = bits(p?.z), top = bottom + Number(s?.Z);
      // The neck sits down into the column (session 5 saw the head float over a top 8 mm above the cut), and the column
      // reaches below the origin so a raised head still stands on the floor.
      ensure(top >= EXPECTED.neckCut + EXPECTED.pedestalOverlap && top < EXPECTED.neckCut + 0.1 && bottom <= -1 && Number(s?.X) > 0.12,
        `${piece}'s pedestal doesn't seat the neck, reach below the origin, or is narrower than the neck`);
    }
  }

  // The rigs: every light restated from the creator rig table.
  const rigApp = read("xfs_showroom_rig.app"), rigTable = handleTable(rigApp);
  ensure(JSON.stringify((rigApp.appearances as Json[]).map(a => name(deref(rigTable, a)?.name))) === JSON.stringify(EXPECTED.profiles), "the rig's appearances are not the three profiles");
  const rigLights = Object.fromEntries(EXPECTED.profiles.map(profile => [profile, checkRig(profile, rigApp, rigTable)]));

  return { archiveSha256, members: files.length, pieces: expected.pieces.length, rigLights,
    limits: [
      "Offline structure only: whether the entity spawns and the head, eyes, plate and pedestal draw in game is untested.",
      "The rig's lights carry the creator's native values; whether a spot's axis is its +Y for a spawned entity, and how photo mode's exposure and the world's light change the result, are untested.",
      "ArchiveXL's expansion of the plate's material paths at run time is expected from its source, not observed.",
    ],
    installed: false, gameRenderingVerified: false };
}
