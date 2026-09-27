/**
 * Expression export (research/animation/expression-editor-design.md §6, §9 "Export"): the static-face clip round trip through the Studio's
 * own decoder, the plan's records and table (installed and sharing), refusals of controls the game's rig lacks, and the independent verifier
 * catching injected faults. Synthetic fixtures only: a small rig and table built here, no game data.
 */
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { encodeStaticFace, staticFaceTracks, unknownControls } from "../src/engines/facial-rig/clip";
import { clipControlVector, decodeClipTracks } from "../src/engines/facial-rig/anim-tracks";
import { archiveXlText, ExportRefusal, type FeatureVerifyInput, type GeneratedFile } from "../src/platform/api";
import { EXPRESSIONS_EXPORTER, GAME_UNREAD_NOTE, NO_CONTROLS_REASON, plannedRows, SHARING_FIRST_INDEX, type ExpressionPlan } from "../src/features/expressions/export";
import { animationSet, expressionTable, faceRigPatch, tweakRecords } from "../src/features/expressions/export/files";
import { EXPRESSIONS_GAME_1, EXPRESSIONS_GAME_PREREQUISITE, type GameInputs } from "../src/features/expressions/export/game";
import { EXPRESSIONS_VERIFIER, yamlQuoted } from "../src/features/expressions/verify";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const TRACKS = ["env_a", "env_b", "env_c", "eye_l_brows_raise_in", "eye_r_brows_raise_in", "jaw_mid_open", "lips_l_corner_up", "lips_r_corner_up", "wr_a", "wr_b"];
const MAIN = { start: 3, count: 5 };
const JOINTS = new Uint8Array(Array.from({ length: 6 * 16 }, (_, i) => (i * 37 + 11) & 0xff));
const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const HEADER = { WolvenKitVersion: "9.0.1", WKitJsonVersion: "0.0.9", GameVersion: 2310, DataType: "CR2W", ArchiveFileName: "C:\\private\\temp.anims" };

/** A vanilla-shaped set holding only `facial_neutral` (the joint keys every static face shares). */
function templateSet(): unknown {
  const neutral = encodeStaticFace(JOINTS, new Float32Array(TRACKS.length));
  return { Header: HEADER, Data: { Version: 195, BuildVersion: 0, EmbeddedFiles: [], RootChunk: { $type: "animAnimSet",
    rig: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: "base\\test\\face.rig" }, Flags: "Default" },
    animations: [{ HandleId: "0", Data: { $type: "animAnimSetEntry", events: null, animation: { HandleId: "1", Data: { $type: "animAnimation",
      name: cname("facial_neutral"), animationType: "AdditiveFromRefPose", duration: 0.0333333351, animBuffer: { HandleId: "2", Data: {
        $type: "animAnimationBufferCompressed", numAnimKeys: 0, numAnimKeysRaw: 0, numConstAnimKeys: 6, numConstTrackKeys: TRACKS.length, numTrackKeys: 0,
        numTracks: TRACKS.length, numJoints: 2, numFrames: 2, duration: 0.0333333351, tempBuffer: { BufferId: "1", Flags: 0, Bytes: "AAAA" },
        dataAddress: { $type: "animAnimDataAddress", fsetInBytes: 0, unkIndex: 0, zeInBytes: neutral.byteLength } } } } } } }],
    animationDataChunks: [{ $type: "animAnimDataChunk", buffer: { BufferId: "0", Flags: 0, Bytes: Buffer.from(neutral).toString("base64") } }] } } };
}
const FACE_RIG = { Header: HEADER, Data: { Version: 195, BuildVersion: 0, RootChunk: { appearances: [{ HandleId: "0", Data: { compiledData: { BufferId: "0", Flags: 0,
  Type: "WolvenKit.RED4.Archive.Buffer.RedPackage, WolvenKit.RED4", Data: { Version: 4, Sections: 7, CruidIndex: -1, CruidDict: {}, Chunks: [] } } } }] } } };
const TABLE_DOC = { Header: HEADER, Data: { Version: 195, BuildVersion: 0, RootChunk: {} } };
const rows = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => [String(i), `${prefix}_${i}`, "photomode", `${prefix}_${i}`]);
const table = (list: string[][], archive: string, provider: string) => ({ rows: list, archive, provider, sha256: sha(JSON.stringify(list)) });
const rig = { rig: "base\\test\\face.rig", tracks: TRACKS, main: MAIN, joints: 2, constAnimKeys: 6, jointBlockSha256: sha(JOINTS) };
function game(overrides: Partial<GameInputs> = {}): GameInputs {
  return { schema: EXPRESSIONS_GAME_1, table: table(rows(217, "pack"), "xBaebsae_PM_FacialExpressions.archive", "An expression pack"),
    base: table(rows(15, "facial"), "basegame_4_animation.archive", "Base game"),
    providers: [{ name: "xBaebsae_PM_FacialExpressions", group: "mod", provider: "An expression pack" }, { name: "basegame_4_animation", group: "content", provider: "Base game" }],
    modOrder: "alphabetical", rigs: { female: rig, male: rig }, ...overrides };
}
const ID = (n: number) => `${String(n).padStart(8, "0")}-e5f6-4a00-8000-abcdefabcdef`;
const SET_ID = "5e7a1111-2222-4333-8444-555566667777";
const look = (n: number, name: string, body: unknown) => ({ id: ID(n), name, revision: 1, parts: { expressions: { schema: "xfs/expression-part-1", body } } });
const expression = (controls: Record<string, number>, label?: string) => ({ ...(label ? { label } : {}), controls, links: {} });
function collection(looks: unknown[], tableChoice: "installed" | "sharing" = "installed") {
  return { schema: "xfs/collection-2", id: SET_ID, name: "Moody", presets: looks, presetSet: { table: tableChoice } };
}
const PRODUCT = { archive: "xfs_c5e7a1111222243338444555566667777", modName: "XF Expressions - Moody" };
const plan = (value: unknown, inputs: GameInputs | null = game()) =>
  EXPRESSIONS_EXPORTER.plan({ collection: value, prerequisites: inputs ? { [EXPRESSIONS_GAME_PREREQUISITE]: inputs } : {}, diagnostics: false, product: PRODUCT });

test("a static face clip round-trips through the Studio's own decoder exactly, and refuses what the rig lacks", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let run = 0; run < 50; run++) {
    const vector = Object.fromEntries(TRACKS.slice(MAIN.start, MAIN.start + MAIN.count).filter(() => random() > 0.4).map(name => [name, Math.fround(random())]));
    const bytes = encodeStaticFace(JOINTS, staticFaceTracks(vector, TRACKS, MAIN));
    expect(bytes.byteLength).toBe(JOINTS.byteLength + TRACKS.length * 8);
    expect(bytes.slice(0, JOINTS.byteLength)).toEqual(JOINTS);
    const clip = decodeClipTracks(bytes, { animKeys: 0, animKeysRaw: 0, constAnimKeys: 6, trackKeys: 0, constTrackKeys: TRACKS.length }, 0.0333333351);
    const expected = Object.fromEntries(Object.entries(vector).filter(([, weight]) => weight > 1e-6).sort(([a], [b]) => a < b ? -1 : 1));
    expect(clipControlVector(clip, "AdditiveFromRefPose", TRACKS, new Array(TRACKS.length).fill(0), MAIN)).toEqual(expected);
    // Every track outside the main poses is 0: the clip holds deltas.
    for (const track of [0, 1, 2, 8, 9]) expect(clip.tracks.get(track)?.values[0]).toBe(0);
  }
  expect(unknownControls({ jaw_mid_open: 0.5, tongue_x: 0.2, env_a: 1 }, TRACKS, MAIN)).toEqual(["env_a", "tongue_x"]);
  expect(() => staticFaceTracks({ tongue_x: 0.2 }, TRACKS, MAIN)).toThrow("no control named tongue_x");
  expect(() => staticFaceTracks({ jaw_mid_open: 1.5 }, TRACKS, MAIN)).toThrow("between 0 and 1");
});

test("export plans a set's records and table on the installed list, leaving out what can't be packaged with its reason", () => {
  const value = collection([look(1, "Smirk", expression({ lips_l_corner_up: 0.4 }, "Smirk \"left\"")), look(2, "Tongue out", expression({ tongue_x: 0.5, jaw_mid_open: 0.3 })),
    look(3, "Blank", expression({})), { id: ID(4), name: "Broken", revision: 1, parts: { expressions: { schema: "xfs/expression-part-1", body: { controls: { jaw_mid_open: 2 } } } } },
    look(5, "Open", expression({ jaw_mid_open: 0.25, eye_l_brows_raise_in: 0.1 }))]);
  expect(EXPRESSIONS_EXPORTER.present(value)).toBe(true);
  const outcome = plan(value), planned = outcome.plan as ExpressionPlan;
  expect(planned.expressions.map(item => [item.name, item.label, item.index])).toEqual([["Smirk", "Smirk \"left\"", 217], ["Open", "Open", 218]]);
  expect(planned.expressions[0]!.clip).toBe(`xfs_x5e7a11112222_${ID(1).replaceAll("-", "").slice(0, 12)}`);
  expect(outcome.check.omissions.map(item => [(item as { presetName: string }).presetName, item.reason])).toEqual([
    ["Tongue out", "“Tongue out” uses a face movement your game doesn't have: Tongue x."], ["Blank", `“Blank” ${NO_CONTROLS_REASON}`],
    ["Broken", "“Broken” is damaged, so XF Studio can't read it."]]);
  // One note, one thing to know; the rest is guidance for Details.
  expect(outcome.check.notes).toEqual(["Keeps the 217 expressions from An expression pack working. Build again if you add or remove expression mods."]);
  expect(outcome.xl).toEqual({ patch: { [planned.paths.patch]: ["base/characters/head/player_base_heads/appearances/head/face_rig/h0_000__basehead_face_rig_photomode.app"] } });
  expect(outcome.extras).toEqual({ tweaks: [`${PRODUCT.archive}.yaml`], overlays: [{ archive: `0${PRODUCT.archive}_table`, inventory: ["base/animations/anim_motion_database/photomode_facial_poses.csv"] }] });
  expect(outcome.inventory).toEqual([planned.paths.patch, planned.paths.sets.female, planned.paths.sets.male].sort());
  // The superset: every carried row unchanged and in order, then one row per expression, Index = position.
  const written = plannedRows(planned, game());
  expect(written.slice(0, 217)).toEqual(rows(217, "pack"));
  expect(written.slice(217)).toEqual([["217", planned.expressions[0]!.clip, "photomode", "facial_neutral"], ["218", planned.expressions[1]!.clip, "photomode", "facial_neutral"]]);
  // Deterministic: the host's result gate repeats the plan.
  expect(JSON.stringify(plan(value))).toBe(JSON.stringify(outcome));
  // A look collection (no presetSet mark) is never this exporter's.
  const { presetSet: _mark, ...plain } = value;
  expect(EXPRESSIONS_EXPORTER.present(plain)).toBe(false);
  // Every expression unknown to the rig: nothing to package, with the reason.
  // Nothing left: the refusal carries each expression and why, so the set's result can show them with their next step.
  try { plan(collection([look(2, "Tongue out", expression({ tongue_x: 0.5 }))])); throw Error("planned"); }
  catch (error) {
    expect(error).toBeInstanceOf(ExportRefusal);
    expect((error as ExportRefusal).message).toBe("Nothing in this set can become mod files yet.");
    expect((error as ExportRefusal).omissions?.map(item => item.reason)).toEqual(["“Tongue out” uses a face movement your game doesn't have: Tongue x."]);
  }
  try { plan(collection([look(3, "Blank", expression({}))])); } catch (error) { expect((error as ExportRefusal).code).toBe("no_exportable_content"); }
});

test("for sharing, the table carries only the game's rows, fills to 1000 with the neutral face, and Check says what it can't know yet", () => {
  const value = collection([look(1, "Smirk", expression({ lips_l_corner_up: 0.4 }))], "sharing");
  const planned = plan(value).plan as ExpressionPlan;
  expect(planned.expressions[0]!.index).toBe(SHARING_FIRST_INDEX);
  expect(planned.filler).toEqual({ from: 15, to: 1000 });
  const written = plannedRows(planned, game());
  expect(written.length).toBe(1001);
  expect(written.slice(0, 15)).toEqual(rows(15, "facial"));
  written.forEach((row, position) => expect(row[0]).toBe(String(position)));
  expect(written.slice(15, 1000).every(row => row[1] === "facial_neutral")).toBe(true);
  // Before any Build read the game files: no indices, and a note saying when they are read.
  const unread = plan(value, null);
  expect(unread.check.notes).toEqual([GAME_UNREAD_NOTE]);
  expect((unread.plan as ExpressionPlan).expressions[0]!.index).toBeNull();
  // Load order: a visible modlist.txt, another XF expressions mod, an archive that sorts first.
  const notes = (inputs: Partial<GameInputs>) => plan(collection([look(1, "Smirk", expression({ lips_l_corner_up: 0.4 }))]), game(inputs)).check.notes.join(" ");
  expect(notes({ modOrder: "modlist" })).toContain("modlist.txt");
  expect(notes({ providers: [{ name: "0xfs_c00000000000040008000000000000099_table", group: "mod", provider: "XF Expressions - Other" }] }))
    .toContain("Another XF expressions mod (XF Expressions - Other)");
  expect(notes({ providers: [{ name: "!!first", group: "mod", provider: "Early mod" }] })).toContain("Early mod loads its expression list before this mod's");
});

test("the TweakXL records are one per expression, appended once, with the label quoted safely", () => {
  expect(tweakRecords([{ clip: "xfs_x1_a", label: "Say \"hi\" \\ now", index: 217 }], "XF Expressions - Moody")).toBe([
    "# XF Expressions - Moody: photo-mode expressions made with XF Studio.", "photo_mode.character.faceAnimations:", "  - !append-once PhotoModeFaces.xfs_x1_a", "",
    "PhotoModeFaces.xfs_x1_a:", "  $base: PhotoModeFaces.facial_neutral", "  displayName: \"Say \\\"hi\\\" \\\\ now\"", "  faceId: 217", ""].join("\n"));
});

/** A product built with the exporter's writers into a folder, and a verifier input whose "WolvenKit" reads the JSON resources as they are. */
function product(value: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "xfs-expr-verify-")), outcome = plan(value), planned = outcome.plan as ExpressionPlan;
  const unpacked = join(dir, "unpacked"), extras = join(dir, "extras"), overlay = join(dir, "overlay");
  const write = (rootDir: string, path: string, content: string) => { const file = join(rootDir, ...path.split("/")); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); };
  const clips = planned.expressions.map(item => ({ clip: item.clip, controls: item.controls }));
  const documents: Record<string, unknown> = {
    [planned.paths.sets.female]: animationSet(templateSet(), rig, clips).document, [planned.paths.sets.male]: animationSet(templateSet(), rig, clips).document,
    [planned.paths.patch]: faceRigPatch(FACE_RIG, planned.component, planned.paths.sets) };
  for (const [path, document] of Object.entries(documents)) write(unpacked, path, JSON.stringify(document));
  write(overlay, planned.paths.table, JSON.stringify(expressionTable(TABLE_DOC, plannedRows(planned, game()))));
  const tweak = `r6/tweaks/${planned.archive}/${planned.tweak}`;
  write(extras, tweak, tweakRecords(planned.expressions.map(item => ({ clip: item.clip, label: item.label, index: item.index! })), planned.modName));
  const file = (rootDir: string, path: string): GeneratedFile => { const data = readFileSync(join(rootDir, ...path.split("/"))); return { path, bytes: data.byteLength, sha256: sha(data) }; };
  const input = (): FeatureVerifyInput => ({
    unpacked: { root: unpacked, files: Object.keys(documents).sort().map(path => file(unpacked, path)), archiveSha256: "x", archiveBytes: 1,
      xl: archiveXlText(outcome.xl), xlSha256: "x", features: 1 },
    work: join(dir, "work"), staging: join(dir, "staging"), verifyDir: join(dir, `verify-${Math.random().toString(36).slice(2)}`),
    tools: { unbundle: () => ({ exitCode: 0, stdout: "", stderr: "" }), exportTextures: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      serialize: (source, into) => { mkdirSync(into, { recursive: true }); copyFileSync(source, join(into, `${basename(source)}.json`)); return { exitCode: 0, stdout: "", stderr: "" }; } },
    packaged: JSON.parse(outcome.packaged), prerequisites: { [EXPRESSIONS_GAME_PREREQUISITE]: game() },
    extras: { root: extras, tweaks: [file(extras, tweak)], overlays: { [planned.overlay]: { root: overlay, files: [file(overlay, planned.paths.table)] } } } });
  const edit = (rootDir: string, path: string, change: (text: string) => string) => {
    const target = join(rootDir, ...path.split("/")); writeFileSync(target, change(readFileSync(target, "utf8")));
  };
  return { dir, planned, input, edit, unpacked, overlay, extras, tweak, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the independent verifier passes a faithful build and catches injected faults", () => {
  const value = collection([look(1, "Smirk", expression({ lips_l_corner_up: 0.4, eye_r_brows_raise_in: 0.125 }, "Smirk")), look(5, "Open", expression({ jaw_mid_open: 0.25 }))]);
  const faults: [string, (p: ReturnType<typeof product>) => void, RegExp][] = [
    ["a changed weight", p => p.edit(p.unpacked, p.planned.paths.sets.male, text => {
      const doc = JSON.parse(text), chunk = doc.Data.RootChunk.animationDataChunks[0].buffer, bytes = Buffer.from(chunk.Bytes, "base64");
      bytes.writeFloatLE(0.5, 96 + 6 * 8 + 4); chunk.Bytes = bytes.toString("base64"); return JSON.stringify(doc);
    }), /track lips_l_corner_up is 0.5/],
    ["a moved joint", p => p.edit(p.unpacked, p.planned.paths.sets.female, text => {
      const doc = JSON.parse(text), chunk = doc.Data.RootChunk.animationDataChunks[0].buffer, bytes = Buffer.from(chunk.Bytes, "base64");
      bytes[0] = bytes[0]! ^ 1; chunk.Bytes = bytes.toString("base64"); return JSON.stringify(doc);
    }), /moves a joint/],
    ["an altered carried row", p => p.edit(p.overlay, p.planned.paths.table, text => text.replace("pack_3", "pack_X")), /carried rows changed|two row copies/],
    ["a duplicate index", p => p.edit(p.overlay, p.planned.paths.table, text => {
      const doc = JSON.parse(text), root = doc.Data.RootChunk; root.compiledData[218][0] = "217"; root.data = root.compiledData; return JSON.stringify(doc);
    }), /row 218 is numbered 217/],
    ["a relabelled record", p => p.edit(p.extras, p.tweak, text => text.replace("displayName: \"Open\"", "displayName: \"Opened\"")), /record is wrong/],
    ["an extra track", p => p.edit(p.unpacked, p.planned.paths.sets.female, text => text.replaceAll("\"numTracks\":10", "\"numTracks\":11")), /isn't a vanilla-shaped static face/],
    ["a replaced component name", p => p.edit(p.unpacked, p.planned.paths.patch, text => text.replaceAll("xfs_expressions_", "PhotomodeAnimations_")), /doesn't add exactly one XF animation component/],
  ];
  const good = product(value);
  try {
    const verified = EXPRESSIONS_VERIFIER.verify(good.input());
    expect(verified.presetCount).toBe(2);
    expect(verified.report.expressions).toEqual(good.planned.expressions.map(item => ({ id: item.id, clip: item.clip, index: item.index })));
    // The exporter accepts exactly its verifier's report.
    expect(() => EXPRESSIONS_EXPORTER.accept!(plan(value), verified, {} as never)).not.toThrow();
  } finally { good.cleanup(); }
  for (const [name, inject, message] of faults) {
    const built = product(value);
    try {
      inject(built);
      expect(() => EXPRESSIONS_VERIFIER.verify(built.input()), name).toThrow(message);
    } finally { built.cleanup(); }
  }
});

test("the verifier reads a label with a literal backslash and x41, and control characters, as written (PIPE-121)", () => {
  // A literal backslash then "x41" (the exporter writes it as \\x41), a backslash, quotes, a tab and a control character.
  const label = String.raw`Back\x41 slash \ ` + "\"q\" \t tab \u0001";
  const value = collection([look(1, "Tricky", expression({ jaw_mid_open: 0.25 }, label))]);
  const built = product(value);
  try {
    expect(() => EXPRESSIONS_VERIFIER.verify(built.input())).not.toThrow();
  } finally { built.cleanup(); }
  // The decoder: every escape the exporter writes, and refusals of what YAML wouldn't read.
  expect(yamlQuoted(String.raw`"a\\x41\x41\u00e9\t\""`)).toBe(String.raw`a\x41` + "A\u00e9\t\"");
  for (const bad of [String.raw`"a\q"`, String.raw`"a\x4"`, String.raw`"a"b"`, "a", String.raw`"a\"`]) expect(() => yamlQuoted(bad), bad).toThrow();
});

test("the verifier is independent: it imports nothing from the exporter or the clip writer", () => {
  const source = readFileSync(join(import.meta.dir, "..", "src", "features", "expressions", "verify", "index.ts"), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map(match => match[1]);
  expect(imports.filter(path => /export|engines\//.test(path!) && !path!.endsWith("platform/api"))).toEqual([]);
});
