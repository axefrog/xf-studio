// The pose catalogue (pose-catalogue.ts) from synthetic game data: lists with TweakXL list operations, records with overlay inheritance,
// categories, clip lookup, badges, labels and diagnostics; plus the readers it rests on: TweakDB string arrays and Vector3 flats, ArchiveXL
// `animations:` entries, and the puppet entity's own sets. No game data.
import { describe, expect, test } from "bun:test";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { depotHash } from "../src/depot-path";
import { TextTable } from "../src/game-text";
import { buildPoseCatalogue, findClip, type PoseSet } from "../src/pose-catalogue";
import { entitySets } from "../src/pose-catalogue-host";
import { TweakDbBlob, tweakDbId, type TweakValue } from "../src/tweakdb-flats";
import { readTweakOverlay } from "../src/tweakxl-overlay";
import { type BlobFlat, tweakDbBlob } from "./fixtures/tweakdb-blob";

const vanilla: [string, BlobFlat][] = [
  ["photo_mode.character.femalePoses", { type: "array:String", value: ["PhotoModePoses.idle_stand_01", "PhotoModePoses.action_01", "PhotoModePoses.idle_stand_01"] }],
  ["photo_mode.character.malePoses", { type: "array:String", value: ["PhotoModePoses.idle_stand_01"] }],
  ["photo_mode.character.poseCategories", { type: "array:String", value: ["PhotoModePoseCategories.idleCategory", "PhotoModePoseCategories.actionCategory"] }],
  ["PhotoModePoseCategories.idleCategory.categoryName", { type: "CName", value: "PhotoModePoseCategories.idleCategory" }],
  ["PhotoModePoseCategories.idleCategory.displayName", { type: "CName", value: "UI-PhotoMode-OptionCategoryIdle" }],
  ["PhotoModePoseCategories.actionCategory.categoryName", { type: "CName", value: "PhotoModePoseCategories.actionCategory" }],
  ["PhotoModePoseCategories.actionCategory.displayName", { type: "CName", value: "UI-PhotoMode-OptionCategoryAction" }],
  ["PhotoModePoses.idle_stand_01.displayName", { type: "CName", value: "LocKey#27995" }],
  ["PhotoModePoses.idle_stand_01.animationName", { type: "CName", value: "idle_stand_01" }],
  ["PhotoModePoses.idle_stand_01.category", { type: "CName", value: "PhotoModePoseCategories.idleCategory" }],
  ["PhotoModePoses.idle_stand_01.animationTime", { type: "Float", value: 0 }],
  ["PhotoModePoses.idle_stand_01.acceptedWeaponConfig", { type: "CName", value: "POSE_HIDE_WEAPON" }],
  ["PhotoModePoses.idle_stand_01.poseStateConfig", { type: "CName", value: "POSE_STATE_GROUND" }],
  ["PhotoModePoses.idle_stand_01.filterOutForGarmentTags", { type: "array:CName", value: ["Coat"] }],
  ["PhotoModePoses.idle_stand_01.disableLookAtForGarmentTags", { type: "array:CName", value: ["None", 'CName("None")'] }],
  ["PhotoModePoses.idle_stand_01.positionOffset", { type: "Vector3", value: [0, 0, 0.35] }],
  ["PhotoModePoses.idle_stand_01.locked", { type: "Bool", value: false }],
  ["PhotoModePoses.action_01.displayName", { type: "CName", value: "LocKey#1" }],
  ["PhotoModePoses.action_01.animationName", { type: "CName", value: "action_01" }],
  ["PhotoModePoses.action_01.category", { type: "CName", value: "PhotoModePoseCategories.actionCategory" }],
  ["PhotoModePoses.action_01.acceptedWeaponConfig", { type: "CName", value: "POSE_WEAPON_HANDGUN" }],
  ["PhotoModePoses.action_01.poseStateConfig", { type: "CName", value: "POSE_STATE_CAR" }],
];
const blob = new TweakDbBlob(tweakDbBlob(vanilla));
const flats = (names: readonly string[]) => {
  const ids = new Map(names.map(name => [tweakDbId(name), name] as const));
  const out = new Map<string, TweakValue>();
  for (const [id, value] of blob.lookup(ids.keys())) out.set(ids.get(id)!, value);
  return out;
};
const clips = (entries: [string, number, number?][]) => new Map(entries.map(([name, frames, animatedKeys]) => [name,
  { frames, duration: frames / 30, decodable: true, animatedKeys: animatedKeys ?? 10 }] as const));
const set = (path: string, entries: [string, number, number?][], priority = 128, provider = "Installed game"): PoseSet => ({ path, hash: depotHash(path),
  archive: provider === "Installed game" ? "basegame_4_animation.archive" : `${provider}.archive`, provider, from: { kind: "entity", component: "root" }, priority,
  clips: clips(entries) });

const packYaml = [
  "PhotoModePoseCategories.pack:",
  "  $base: PhotoModePoseCategories.idleCategory",
  "  CategoryName: PhotoModePoseCategories.pack   # TweakXL ignores this key (case-sensitive)",
  "  displayName: my_pack",
  "photo_mode.character.poseCategories:",
  "  - !append-once PhotoModePoseCategories.pack",
  "PhotoModePoses.pack_01:",
  "  $base: PhotoModePoses.idle_stand_01",
  "  animationName: pack_clip",
  "  category: PhotoModePoseCategories.pack",
  "  displayName: 01",
  "  animationTime: 0.5",
  "  positionOffset: { x: 0, y: 1.35, z: 0 }",
  "PhotoModePoses.pack_02:",
  "  $base: PhotoModePoses.pack_01",
  "  animationName: moving_clip",
  "  displayName: 02",
  "PhotoModePoses.pack_locked:",
  "  $base: PhotoModePoses.idle_stand_01",
  "  locked: true",
  "photo_mode.character.femalePoses: &poses",
  "  - !append-once PhotoModePoses.pack_01",
  "  - !append-once PhotoModePoses.pack_02",
  "  - !append-once PhotoModePoses.pack_locked",
  "  - !append-once PhotoModePoses.nowhere",
  "  - !append-once PhotoModePoses.idle_stand_01",
  "  - !remove PhotoModePoses.action_01",
  "photo_mode.character.judyPoses: *poses",
].join("\n");

describe("the pose catalogue", () => {
  const overlay = readTweakOverlay([{ path: "r6/tweaks/pack/poses.yaml", provider: "A pose pack", text: packYaml }]);
  const sets = [set("base\\photomode__female__idle.anims", [["idle_stand_01", 2], ["action_01", 2]]),
    set("pack\\poses.anims", [["pack_clip", 7, 0], ["moving_clip", 60, 400], ["idle_stand_01", 2]], 128, "A pose pack")];
  const text = new TextTable("en-us").add([{ primaryKey: "27995", secondaryKey: "", female: "Tabula Rasa", male: "" },
    { primaryKey: "0", secondaryKey: "UI-PhotoMode-OptionCategoryIdle", female: "Idle", male: "" }], { id: "game", kind: "game", declaredBy: null });
  const catalogue = buildPoseCatalogue({ bodyGender: "female", flats, overlay, providers: new Map([["r6/tweaks/pack/poses.yaml", "A pose pack"]]), sets, text });

  test("lists come from the compiled TweakDB with the TweakXL edits applied, in menu order, each record once", () => {
    expect(catalogue.entries.map(e => e.id)).toEqual(["PhotoModePoses.idle_stand_01", "PhotoModePoses.pack_01", "PhotoModePoses.pack_02"]);
    expect(catalogue.categories.map(c => [c.id, c.label, c.count])).toEqual([["PhotoModePoseCategories.idleCategory", "Idle", 1],
      // Without a text, a key is made readable.
      ["PhotoModePoseCategories.actionCategory", "Option category action", 0], ["PhotoModePoseCategories.pack", "my_pack", 2]]);
    const codes = Object.fromEntries(catalogue.diagnostics.map(d => [d.code, d.count]));
    expect(codes).toMatchObject({ "pose-repeated": 1, "pose-locked": 1, "pose-missing": 1, "clip-ambiguous": 1 });
    expect(catalogue.counts).toMatchObject({ listed: 3, withClip: 3, categories: 3, sets: 2, setsUnread: 0 });
  });

  test("records inherit through overlay and compiled bases; labels keep literal text; placement and filters are read", () => {
    const [vanillaPose, first, second] = catalogue.entries;
    expect(vanillaPose!.label).toBe("Tabula Rasa");
    expect(vanillaPose!.placement.offset.map(n => Math.round(n * 100) / 100)).toEqual([0, 0, 0.35]);
    expect(vanillaPose!.hiddenForGarmentTags).toEqual(["Coat"]);
    // The schema's empty default compiles to `None`: no tag.
    expect(vanillaPose!.lookAtOffForGarmentTags).toEqual([]);
    expect(vanillaPose!.source).toEqual({ kind: "game", declaredBy: null, file: null });
    expect([first!.label, first!.time, first!.placement.offset, first!.hiddenForGarmentTags]).toEqual(["01", 0.5, [0, 1.35, 0], ["Coat"]]);
    // A pack category that inherits vanilla's categoryName still holds its own poses (matched by record name first).
    expect(first!.category).toBe("PhotoModePoseCategories.pack");
    expect(first!.source).toEqual({ kind: "mod", declaredBy: "A pose pack", file: "r6/tweaks/pack/poses.yaml" });
    expect([second!.label, second!.category, second!.time]).toEqual(["02", "PhotoModePoseCategories.pack", 0.5]);
  });

  test("clips resolve among the puppet's sets; badges say what the Studio can't show", () => {
    const [vanillaPose, first, second] = catalogue.entries;
    expect(vanillaPose!.clip).toMatchObject({ name: "idle_stand_01", set: "base\\photomode__female__idle.anims", alternatives: 1, animated: false });
    // A 7-frame clip whose channels are all constant holds; a 60-frame clip with changing keys moves.
    expect([first!.clip!.animated, first!.badges]).toEqual([false, []]);
    expect([second!.clip!.animated, second!.badges]).toEqual([true, ["moves"]]);
    const action = buildPoseCatalogue({ bodyGender: "female", flats, overlay: null, sets, text: null }).entries.find(e => e.id === "PhotoModePoses.action_01")!;
    expect([action.holds, action.state, action.badges]).toEqual(["POSE_WEAPON_HANDGUN", "POSE_STATE_CAR", ["holds", "vehicle"]]);
    // Without texts a key has no readable form; the animation name stands in.
    expect(action.label).toBe("Action 01");
  });

  test("a higher-priority set wins a shared clip name, then the earlier set; a missing clip is counted, the pose still listed", () => {
    const low = set("a.anims", [["x", 2]], 100), high = set("b.anims", [["x", 2]], 200), later = set("c.anims", [["x", 2]], 200);
    expect(findClip([low, high, later], "x")).toMatchObject({ set: "b.anims", alternatives: 2 });
    expect(findClip([low], "y")).toBeNull();
    const bare = buildPoseCatalogue({ bodyGender: "female", flats, overlay: null, sets: [], text: null });
    expect(bare.entries.every(entry => entry.clip === null)).toBe(true);
    expect(bare.diagnostics.find(d => d.code === "clip-missing")!.count).toBe(2);
  });

  test("the male list is its own; an unread set and an absent set are told apart", () => {
    const male = buildPoseCatalogue({ bodyGender: "male", flats, overlay, sets: [...sets, { ...set("gone.anims", []), clips: null },
      { ...set("unread.anims", []), clips: null, archive: "x.archive" }].map(s => s.path === "gone.anims" ? { ...s, archive: null } : s), text: null });
    expect(male.entries.map(e => e.id)).toEqual(["PhotoModePoses.idle_stand_01"]);
    expect(male.counts.setsUnread).toBe(1);
    expect(male.diagnostics.map(d => d.code).sort()).toEqual(["clip-ambiguous", "set-absent", "set-unread"]);
  });
});

describe("the readers under the catalogue", () => {
  test("TweakDB string arrays and Vector3 flats read as the game stores them", () => {
    const found = blob.lookup([tweakDbId("photo_mode.character.femalePoses"), tweakDbId("PhotoModePoses.idle_stand_01.positionOffset")]);
    expect(found.get(tweakDbId("photo_mode.character.femalePoses"))).toEqual({ type: "array:String",
      value: ["PhotoModePoses.idle_stand_01", "PhotoModePoses.action_01", "PhotoModePoses.idle_stand_01"] });
    const offset = found.get(tweakDbId("PhotoModePoses.idle_stand_01.positionOffset"))!;
    expect(offset.type).toBe("Vector3");
    expect((offset.value as number[]).map(n => Math.round(n * 100) / 100)).toEqual([0, 0, 0.35]);
  });

  test("ArchiveXL animations: entity paths, lists and scopes expanded; component root and priority 128 by default; malformed entries skipped", () => {
    const config = readArchiveXlConfig([
      { id: "red4ext/plugins/archivexl/bundle/PhotoModeScope.xl", document: { resource: { scope: { "photomode_wa.ent": ["base\\a\\player_wa_photomode.ent", "ep1\\a\\player_wa_photomode_ep1.ent"] } } } },
      { id: "archive/pc/mod/pack.xl", document: { animations: [
        { entity: "photomode_wa.ent", set: "pack\\poses.anims" },
        { entity: ["base\\npc.ent", "ep1\\a\\player_wa_photomode_ep1.ent"], set: "pack\\more.anims", priority: "200", component: "face", vars: ["v"] },
        { set: "pack\\no_entity.anims" }, "not an entry"] } },
    ]);
    expect(config.animations.map(a => [a.set, [...a.targets].sort(), a.component, a.priority, a.variables])).toEqual([
      ["pack\\poses.anims", [depotHash("base\\a\\player_wa_photomode.ent"), depotHash("ep1\\a\\player_wa_photomode_ep1.ent")].sort(), "root", 128, []],
      ["pack\\more.anims", [depotHash("base\\npc.ent"), depotHash("ep1\\a\\player_wa_photomode_ep1.ent")].sort(), "face", 200, ["v"]]]);
    expect(config.animations[0]!.setHash).toBe(depotHash("pack\\poses.anims"));
    expect(config.issues.filter(issue => issue.includes("animations entry")).length).toBe(2);
  });

  test("the puppet's own sets: the root animated component and the animation-setup extensions, not other animated components", () => {
    const entry = (path: string, priority = 128) => ({ $type: "animAnimSetupEntry", animSet: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: path } }, priority });
    const sets = entitySets({ components: [
      { $type: "entAnimatedComponent", name: { $type: "CName", $storage: "string", $value: "deformations" }, animations: { gameplay: [entry("deform.anims")] } },
      { HandleId: "1", Data: { $type: "entAnimatedComponent", name: { $value: "root" }, animations: { gameplay: [entry("root.anims", 200)] } } },
      { $type: "entAnimationSetupExtensionComponent", name: { $value: "TPP Player Animation Setup" }, animations: { gameplay: [entry("ext.anims"),
        { $type: "animAnimSetupEntry", animSet: { DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: "123" } } }] } },
    ] });
    expect(sets).toEqual([{ path: "root.anims", hash: depotHash("root.anims"), component: "root", priority: 200 },
      { path: "ext.anims", hash: depotHash("ext.anims"), component: "TPP Player Animation Setup", priority: 128 },
      { path: null, hash: "123", component: "TPP Player Animation Setup", priority: 128 }]);
  });
});
