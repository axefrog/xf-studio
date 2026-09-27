/**
 * The independent verifier of `expressions/photo-mode-static-v1` (research/animation/expression-editor-design.md §6.5; feature-module
 * platform §7 rule 3). It imports nothing from the exporter or the facial-rig engine: it reads what the product holds (the unpacked archive,
 * the table overlay and the TweakXL file), serialises the resources with WolvenKit itself, decodes each clip with its own reader, and checks
 * them against the package-only snapshot (the saved expressions' weights) and the game inputs the plan read.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExportRefusal, type FeatureVerification, type FeatureVerifier, type FeatureVerifyInput } from "../../../platform/api";

const EXPORTER_ID = "expressions/photo-mode-static-v1";
const FACE_RIG = "base\\characters\\head\\player_base_heads\\appearances\\head\\face_rig\\h0_000__basehead_face_rig_photomode.app";
const TABLE = "base/animations/anim_motion_database/photomode_facial_poses.csv";
const APPEARANCES = { female: "h0_000_pwa__basehead__face_rig_photomode", male: "h0_000_pma__basehead__face_rig_photomode" } as const;
type Gender = keyof typeof APPEARANCES;
type Json = Record<string, unknown>;
type Rig = { tracks: string[]; main: { start: number; count: number }; joints: number; constAnimKeys: number; jointBlockSha256: string };
type Table = { rows: string[][]; sha256: string };
type Game = { table: Table; base: Table; rigs: Record<Gender, Rig> };
type Snapshot = { table: "installed" | "sharing"; expressions: { id: string; name: string; label: string; controls: Record<string, number> }[] };

function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ExportRefusal("package_verification_failed", `Expressions verifier: ${message}`);
}
const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const f32 = (value: number) => Math.fround(value);
const text = (value: unknown) => isRecord(value) ? String(value.$value ?? "") : String(value ?? "");
const handle = (value: unknown): Json | undefined => isRecord(value) && isRecord(value.Data) ? value.Data : undefined;

/** Serialise one resource with WolvenKit into `dir` and read its JSON root document. */
function serialize(input: FeatureVerifyInput, file: string, dir: string): Json {
  mkdirSync(dir, { recursive: true });
  const run = input.tools.serialize(file, dir);
  ensure(run.exitCode === 0, `WolvenKit couldn't read ${file.split(/[\\/]/).at(-1)}`);
  const name = readdirSync(dir).find(item => item.toLowerCase() === `${file.split(/[\\/]/).at(-1)!.toLowerCase()}.json`);
  ensure(name, `WolvenKit wrote no JSON for ${file}`);
  const document = JSON.parse(readFileSync(join(dir, name), "utf8").replace(/^﻿/, "")) as Json;
  const data = isRecord(document.Data) ? document.Data : undefined;
  ensure(data && isRecord(data.RootChunk), `${file} has no root`);
  return data.RootChunk;
}

/** A clip's constant track keys, read from its bytes (u16 track, u16 time, f32 value after every joint and animated key). */
function constantTracks(bytes: Uint8Array, buffer: Json): Map<number, number> {
  const count = (key: string) => Number(buffer[key] ?? 0);
  let at = count("numAnimKeys") * 10 + count("numAnimKeysRaw") * 16 + count("numConstAnimKeys") * 16 + count("numTrackKeys") * 8;
  ensure(bytes.byteLength === at + count("numConstTrackKeys") * 8, "a clip's size doesn't match its key counts");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<number, number>();
  for (let i = 0; i < count("numConstTrackKeys"); i++, at += 8) {
    const track = view.getUint16(at, true);
    ensure(!out.has(track), "a clip keys a track twice");
    out.set(track, view.getFloat32(at + 4, true));
  }
  return out;
}

/** Parse the TweakXL file this exporter writes: the appended list and each record's base, name and face index. */
function readTweaks(source: string) {
  const appended: string[] = [], records = new Map<string, { base?: string; label?: string; faceId?: number }>();
  let current: string | undefined, list = false;
  for (const line of source.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    let match: RegExpExecArray | null;
    if ((match = /^([A-Za-z0-9_.]+):$/.exec(line))) {
      list = match[1] === "photo_mode.character.faceAnimations"; current = list ? undefined : match[1];
      if (current) { ensure(current.startsWith("PhotoModeFaces.") && !records.has(current), `unexpected TweakXL record ${current}`); records.set(current, {}); }
    } else if (list && (match = /^ {2}- !append-once PhotoModeFaces\.([A-Za-z0-9_]+)$/.exec(line))) appended.push(match[1]!);
    else if (current && (match = /^ {2}\$base: (\S+)$/.exec(line))) records.get(current)!.base = match[1];
    else if (current && (match = /^ {2}displayName: (".*")$/.exec(line))) records.get(current)!.label = JSON.parse(match[1]!.replace(/\\x([0-9a-f]{2})/g, "\\u00$1"));
    else if (current && (match = /^ {2}faceId: (\d+)$/.exec(line))) records.get(current)!.faceId = Number(match[1]);
    else ensure(false, `unexpected TweakXL line ${JSON.stringify(line)}`);
  }
  return { appended, records };
}

function readGame(value: unknown): Game {
  ensure(isRecord(value) && isRecord(value.rigs) && isRecord(value.table) && isRecord(value.base), "the game inputs are missing");
  return value as unknown as Game;
}

export const EXPRESSIONS_VERIFIER: FeatureVerifier = Object.freeze({
  exporterId: EXPORTER_ID,
  verify(input: FeatureVerifyInput): FeatureVerification {
    const snapshot = input.packaged as Snapshot;
    ensure(isRecord(snapshot) && Array.isArray(snapshot.expressions) && snapshot.expressions.length, "the package snapshot is empty");
    const game = readGame(input.prerequisites["expressions/game"]);
    const root = input.unpacked.root, files = input.unpacked.files.map(file => file.path);
    // The .xl patches exactly V's photo-mode face rig with the product's one patch file.
    const patchMatch = /(?:^|\r\n)resource:\r\n {2}patch:\r\n {4}(\S+\.app):\r\n {6}- (\S+)\r\n/.exec(input.unpacked.xl);
    ensure(patchMatch && patchMatch[2] === FACE_RIG, "the .xl doesn't patch V's photo-mode face rig");
    const patchPath = patchMatch![1]!.replaceAll("\\", "/");
    ensure(files.includes(patchPath), "the face rig patch isn't in the archive");
    const setPaths = files.filter(path => /\/xfs_expressions_(female|male)\.anims$/.test(path));
    ensure(setPaths.length === 2, "the archive doesn't hold one expression set per gender");
    const verifyDir = input.verifyDir;
    // The patch: each gender's appearance adds exactly one XF component, bound to face_rig, attaching that gender's set.
    const patch = serialize(input, join(root, ...patchPath.split("/")), join(verifyDir, "patch"));
    const appearances = (Array.isArray(patch.appearances) ? patch.appearances : []).map(handle).filter((item): item is Json => !!item);
    ensure(appearances.length === 2, "the patch doesn't hold V's two photo-mode face appearances");
    const attached = {} as Record<Gender, string>;
    for (const gender of Object.keys(APPEARANCES) as Gender[]) {
      const appearance = appearances.find(item => text(item.name) === APPEARANCES[gender]);
      ensure(appearance, `the patch lacks the ${gender} appearance`);
      const chunks = handle(appearance.compiledData) ?? (isRecord(appearance.compiledData) && isRecord(appearance.compiledData.Data) ? appearance.compiledData.Data : undefined);
      const chunk = (Array.isArray(chunks?.Chunks) ? chunks!.Chunks as Json[] : []);
      ensure(chunk.length === 1 && chunk[0]!.$type === "entAnimationSetupExtensionComponent" && text(chunk[0]!.name).startsWith("xfs_expressions_"),
        `the ${gender} appearance doesn't add exactly one XF animation component`);
      const binding = handle(chunk[0]!.controlBinding);
      ensure(binding && text(binding.bindName) === "face_rig", `the ${gender} component isn't bound to face_rig`);
      const gameplay = isRecord(chunk[0]!.animations) && Array.isArray(chunk[0]!.animations.gameplay) ? chunk[0]!.animations.gameplay as Json[] : [];
      ensure(gameplay.length === 1, `the ${gender} component doesn't attach one set`);
      const set = isRecord(gameplay[0]!.animSet) ? text((gameplay[0]!.animSet as Json).DepotPath).replaceAll("\\", "/") : "";
      ensure(setPaths.includes(set) && set.endsWith(`_${gender}.anims`), `the ${gender} component attaches another set`);
      attached[gender] = set;
    }
    // The records: one per saved expression, appended once, based on the neutral face, labelled as saved.
    const tweakFile = input.extras?.tweaks.find(file => file.path.endsWith(".yaml"));
    ensure(input.extras && tweakFile && input.extras.tweaks.length === 1, "the TweakXL file is missing");
    const tweaks = readTweaks(readFileSync(join(input.extras!.root, ...tweakFile!.path.split("/")), "utf8"));
    ensure(tweaks.records.size === snapshot.expressions.length && tweaks.appended.length === tweaks.records.size &&
      new Set(tweaks.appended).size === tweaks.appended.length, "the TweakXL records don't match the saved expressions");
    // The table: from the overlay; carried rows unchanged and in order, then fillers, then each record's row once; Index is the position.
    const overlays = Object.values(input.extras!.overlays);
    ensure(overlays.length === 1 && overlays[0]!.files.length === 1 && overlays[0]!.files[0]!.path === TABLE, "the table overlay holds other files");
    const table = serialize(input, join(overlays[0]!.root, ...TABLE.split("/")), join(verifyDir, "table"));
    const rows = (Array.isArray(table.compiledData) ? table.compiledData : []).map(row => (row as unknown[]).map(String));
    ensure(JSON.stringify(table.compiledData) === JSON.stringify(table.data), "the table's two row copies differ");
    const carried = snapshot.table === "sharing" ? game.base : game.table;
    ensure(sha256(JSON.stringify(carried.rows)) === carried.sha256, "the game table the plan read is damaged");
    ensure(JSON.stringify(rows.slice(0, carried.rows.length)) === JSON.stringify(carried.rows), "the carried rows changed");
    rows.forEach((row, position) => ensure(row[0] === String(position), `row ${position} is numbered ${row[0]}`));
    const byClip = new Map(rows.map((row, position) => [row[1]!, position]));
    for (const row of rows.slice(carried.rows.length)) ensure(row[2] === "photomode" && row[3] === "facial_neutral" &&
      (row[1] === "facial_neutral" || tweaks.records.has(`PhotoModeFaces.${row[1]}`)), `unexpected row ${JSON.stringify(row)}`);
    // Each gender's clips: vanilla shape, the template's joint keys, main poses equal to the saved weights, every other track 0.
    const clips: Record<Gender, Map<string, Map<number, number>>> = { female: new Map(), male: new Map() };
    let verifiedFiles = 3;
    for (const gender of Object.keys(APPEARANCES) as Gender[]) {
      const rig = game.rigs[gender];
      const set = serialize(input, join(root, ...attached[gender].split("/")), join(verifyDir, gender));
      const chunks = (Array.isArray(set.animationDataChunks) ? set.animationDataChunks as Json[] : [])
        .map(chunk => new Uint8Array(Buffer.from(String((chunk.buffer as Json)?.Bytes ?? ""), "base64")));
      for (const item of Array.isArray(set.animations) ? set.animations : []) {
        const animation = handle(handle(item)?.animation), buffer = handle(animation?.animBuffer);
        ensure(animation && buffer && isRecord(buffer.dataAddress), `a ${gender} clip can't be read`);
        const name = text(animation.name), address = buffer.dataAddress as Json;
        ensure(animation.animationType === "AdditiveFromRefPose" && buffer.numFrames === 2 && buffer.numJoints === rig.joints &&
          buffer.numConstAnimKeys === rig.constAnimKeys && buffer.numAnimKeys === 0 && buffer.numAnimKeysRaw === 0 && buffer.numTrackKeys === 0 &&
          buffer.numConstTrackKeys === rig.tracks.length && buffer.numTracks === rig.tracks.length, `${gender} clip ${name} isn't a vanilla-shaped static face`);
        const data = chunks[Number(address.unkIndex)]?.slice(Number(address.fsetInBytes), Number(address.fsetInBytes) + Number(address.zeInBytes));
        ensure(data && data.byteLength === Number(address.zeInBytes), `${gender} clip ${name} has no data`);
        ensure(sha256(data.slice(0, rig.constAnimKeys * 16)) === rig.jointBlockSha256, `${gender} clip ${name} moves a joint`);
        ensure(!clips[gender].has(name), `${gender} clip ${name} appears twice`);
        clips[gender].set(name, constantTracks(data, buffer));
      }
      verifiedFiles++;
    }
    const expressions = snapshot.expressions.map(expression => {
      const suffix = `_${expression.id.replaceAll("-", "")}`;
      const record = [...tweaks.records].find(([key]) => suffix.startsWith(`_${key.split("_").at(-1)}`) && key.split("_").at(-1)!.length >= 12);
      ensure(record, `“${expression.name}” has no photo-mode record`);
      const [key, value] = record!, clip = key.slice("PhotoModeFaces.".length);
      ensure(value.base === "PhotoModeFaces.facial_neutral" && value.label === expression.label && tweaks.appended.includes(clip), `“${expression.name}”'s record is wrong`);
      ensure(value.faceId !== undefined && byClip.get(clip) === value.faceId, `“${expression.name}”'s face index doesn't lead to its row`);
      for (const gender of Object.keys(APPEARANCES) as Gender[]) {
        const tracks = clips[gender].get(clip), rig = game.rigs[gender];
        ensure(tracks && tracks.size === rig.tracks.length, `“${expression.name}” has no ${gender} clip`);
        rig.tracks.forEach((name, track) => {
          const main = track >= rig.main.start && track < rig.main.start + rig.main.count;
          const expected = main ? f32(expression.controls[name] ?? 0) : 0;
          ensure(tracks!.get(track) === expected, `“${expression.name}” ${gender} track ${name} is ${tracks!.get(track)}, not ${expected}`);
        });
        ensure(Object.keys(expression.controls).every(name => rig.tracks.indexOf(name) >= rig.main.start && rig.tracks.indexOf(name) < rig.main.start + rig.main.count),
          `“${expression.name}” uses a control the ${gender} rig lacks`);
      }
      return { id: expression.id, clip, index: value.faceId! };
    });
    ensure(clips.female.size === expressions.length && clips.male.size === expressions.length, "the sets hold clips no saved expression names");
    return { presetCount: expressions.length, verifiedFiles: verifiedFiles + 2,
      limits: ["Not checked in game: whether photo mode lists these expressions and shows them as the Studio's preview does (runtime checks R4 and R5)."],
      report: { exporter: EXPORTER_ID, expressions, table: { rows: rows.length, carried: carried.rows.length, mode: snapshot.table } } };
  },
});
