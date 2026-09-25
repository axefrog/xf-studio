import { describe, expect, test } from "bun:test";
import { inScope, patchModifies, readArchiveXlConfig, settleDepotAdditions } from "../src/archivexl-config";
import { descriptorsFromUiState, mergeCustomizations, overrideKey, readCco } from "../src/cco-model";
import { depotHash } from "../src/depot-path";
import { cr2wRoot } from "../src/red-json";
import { appearanceOption, cco, morphOption, switcherOption } from "./resolver-fixtures";

const root = (document: object) => cr2wRoot(document).root;

describe("ArchiveXL declarations", () => {
  const config = readArchiveXlConfig([
    { id: "bundle/Scope.xl", document: { resource: { scope: {
      "player_customization.app": ["player_wa_eyes.app", "player_wa_hair.app"],
      "player_wa_eyes.app": ["archive_xl\\eyes.app"], "player_wa_hair.app": "mod\\hair.app",
      "player_wa_hair.mesh": ["mod\\hair.mesh"] } } } },
    { id: "bundle/Fix.xl", document: { resource: { fix: { "base\\cco.inkcharcustomization": { paths: { "base\\eyes.app": "archive_xl\\eyes.app" } },
      "mod\\hair.mesh": { names: { old: "old@x" }, context: { LongBaseMaterial: "a.mi" } } } } } },
    { id: "mod/a.xl", document: { customizations: { female: "mod\\a.inkcharcustomization", male: ["mod\\m1.inkcharcustomization", "mod\\m2.inkcharcustomization"] },
      resource: {
        patch: { "mod\\patch.mesh": { props: ["appearances"], targets: ["player_wa_hair.mesh"] }, "mod\\all.mesh": ["base\\x.mesh"] },
        copy: { "base\\v.morphtarget": ["mod_copy\\v.morphtarget", "base\\existing.morphtarget"] },
        link: { "base\\target.xbm": ["mod\\alias.xbm"], "mod\\scalar_key.xbm": "base\\scalar_value.xbm" },
      } } },
  ]);

  test("scopes flatten transitively and customizations keep declaration order", () => {
    expect(inScope(config, "player_customization.app", depotHash("archive_xl\\eyes.app"))).toBe(true);
    expect(inScope(config, "player_customization.app", depotHash("mod\\hair.app"))).toBe(true);
    expect(inScope(config, "player_customization.app", depotHash("player_wa_eyes.app"))).toBe(false);
    expect(config.customizations.female.map(c => c.path)).toEqual(["mod\\a.inkcharcustomization"]);
    expect(config.customizations.male.map(c => c.path)).toEqual(["mod\\m1.inkcharcustomization", "mod\\m2.inkcharcustomization"]);
  });

  test("fixes merge names, paths and context; patches expand scoped targets", () => {
    const fix = config.fixes.get(depotHash("base\\cco.inkcharcustomization"))!;
    expect(fix.paths.get(depotHash("base\\eyes.app"))).toBe(depotHash("archive_xl\\eyes.app"));
    expect(config.fixes.get(depotHash("mod\\hair.mesh"))!.context.get("LongBaseMaterial")).toBe("a.mi");
    const patch = config.patches.find(p => p.sourcePath === "mod\\patch.mesh")!;
    expect([...patch.targets]).toEqual([depotHash("mod\\hair.mesh")]);
    expect(patchModifies(patch, "appearances")).toBe(true);
    expect(patchModifies(patch, "renderResourceBlob", true)).toBe(false);
    const all = config.patches.find(p => p.sourcePath === "mod\\all.mesh")!;
    expect(patchModifies(all, "renderResourceBlob", false)).toBe(true);
    expect(patchModifies(all, "renderResourceBlob", true)).toBe(false);
  });

  test("copies and links are rejected when the path already exists; a copy makes a patch source valid", () => {
    const existing = new Set([depotHash("base\\existing.morphtarget"), depotHash("base\\x.mesh"), depotHash("mod\\all.mesh")]);
    const withPatch = readArchiveXlConfig([{ id: "b.xl", document: { resource: {
      copy: { "base\\v.morphtarget": "mod_copy\\v.morphtarget" },
      patch: { "mod_copy\\v.morphtarget": { props: ["blob"], targets: ["mod\\stub.morphtarget"] } } } } }]);
    const settled = settleDepotAdditions(withPatch, hash => existing.has(hash));
    expect(settled.copies.get(depotHash("mod_copy\\v.morphtarget"))).toBe(depotHash("base\\v.morphtarget"));
    expect(settled.patchesByTarget.get(depotHash("mod\\stub.morphtarget"))?.length).toBe(1);
    const additions = settleDepotAdditions(config, hash => existing.has(hash));
    expect(additions.rejected.some(r => r.hash === depotHash("base\\existing.morphtarget") && r.reason === "copy is an existing resource")).toBe(true);
    expect(additions.links.get(depotHash("mod\\alias.xbm"))).toBe(depotHash("base\\target.xbm"));
    // ResourceLink/Config.cpp files the scalar form under the key, so the key becomes the alias.
    expect(additions.links.get(depotHash("mod\\scalar_key.xbm"))).toBe(depotHash("base\\scalar_value.xbm"));
    expect(additions.rejected.some(r => r.reason === "patch resource does not exist")).toBe(true);
  });
});

describe("character-creator merge (ArchiveXL MergeCustomEntries)", () => {
  const base = readCco(root(cco([
    appearanceOption("eyes_color", "base\\eyes.app", ["gradient_brown", "gradient_green"], { uiSlot: "eyes_color" }),
    switcherOption("hairstyle", [["01", ["hair_color1"]], ["02", ["hair_color2"]]]),
    appearanceOption("hair_color1", "base\\hair1.app", ["blonde"], { uiSlot: "hair_color", enabled: 0, link: "hairstyle color", linkController: 1 }),
    appearanceOption("hair_color2", "base\\hair2.app", ["blonde"], { uiSlot: "hair_color", enabled: 0, link: "hairstyle color", linkController: 1 }),
    morphOption("eyes", ["h011", "h021"]),
  ], { TPP: ["eyes_color", "eyes"], hairs: ["hair_color1", "hair_color2"] })), "base game");
  const fix = readArchiveXlConfig([{ id: "fix.xl", document: { resource: { fix: { "base\\cco": { paths: { "base\\eyes.app": "archive_xl\\eyes.app" } } } } } }])
    .fixes.get(depotHash("base\\cco"));

  test("fix paths remap base options and register overrides for saved descriptors", () => {
    const merged = mergeCustomizations(base, fix, []);
    const eyes = merged.cco.parts.head.options.find(o => o.name === "eyes_color")!;
    expect(eyes.type === "appearance" && eyes.resource!.hash).toBe(depotHash("archive_xl\\eyes.app"));
    expect(merged.appOverrides.get(overrideKey(depotHash("base\\eyes.app"), "gradient_green"))!.app).toBe(depotHash("archive_xl\\eyes.app"));
  });

  test("anonymous uiSlot overlays append choices, named options merge by name, groups only extend existing groups", () => {
    const custom = readCco(root(cco([
      appearanceOption("", "mod\\eyes_mod.app", ["eye_16_diffuse", "gradient_brown"], { uiSlot: "eyes_color" }),
      appearanceOption("hair_color1", "mod\\hair_colors.app", ["38_ash_brown"], { uiSlot: "hair_color" }),
      appearanceOption("mod_new_option", "mod\\new.app", ["a"]),
    ], { TPP: ["mod_new_option"], brand_new_group: ["mod_new_option"] })), "mod.inkcharcustomization (Mod)");
    const merged = mergeCustomizations(base, fix, [custom]);
    const head = merged.cco.parts.head;
    const eyes = head.options.find(o => o.name === "eyes_color")!;
    if (eyes.type !== "appearance") throw Error("type");
    expect(eyes.definitions.map(d => [d.name, d.index, d.providedBy])).toEqual([
      ["gradient_brown", 0, "mod.inkcharcustomization (Mod)"], ["gradient_green", 1, "base game"], ["eye_16_diffuse", 2, "mod.inkcharcustomization (Mod)"]]);
    // A new choice from a different .app registers an override; a replaced existing choice does not.
    expect(merged.appOverrides.get(overrideKey(depotHash("archive_xl\\eyes.app"), "eye_16_diffuse"))!.app).toBe(depotHash("mod\\eyes_mod.app"));
    expect(merged.appOverrides.has(overrideKey(depotHash("archive_xl\\eyes.app"), "gradient_brown"))).toBe(false);
    const hair = head.options.find(o => o.name === "hair_color1")!;
    expect(hair.type === "appearance" && hair.definitions.map(d => d.name)).toEqual(["blonde", "38_ash_brown"]);
    expect(hair.enabled).toBe(false);
    expect(merged.hairColorTags).toEqual([]);
    expect(head.options.some(o => o.name === "mod_new_option")).toBe(true);
    expect(head.groups.find(g => g.name === "TPP")!.options).toContain("mod_new_option");
    expect(head.groups.some(g => g.name === "brand_new_group")).toBe(false);
  });

  test("UI state activates switcher targets, propagates link indices and lists group members", () => {
    const skin = readCco(root(cco([
      appearanceOption("skin_color", null, ["01_ca_pale", "02_ca_limestone", "03_ca_senna"], { link: "skin color", linkController: 1 }),
      switcherOption("skin_type", [["01", ["skin_type_01"]], ["02", ["skin_type_02"]]]),
      appearanceOption("skin_type_01", "base\\h0_d01.app", ["h__01_ca_pale", "h__02_ca_limestone", "h__03_ca_senna"], { link: "skin color", enabled: 0, hidden: 1 }),
      appearanceOption("skin_type_02", "base\\h0_d02.app", ["d2__01_ca_pale", "d2__02_ca_limestone", "d2__03_ca_senna"], { link: "skin color", enabled: 0, hidden: 1 }),
      appearanceOption("neck", "base\\neck.app", ["n__01", "n__02"], { link: "skin color", hidden: 1 }),
      morphOption("eyes", ["h011", "h021"]),
    ], { TPP: ["skin_type_01", "skin_type_02", "eyes"], FPP: ["neck"] })), "base game");
    const result = descriptorsFromUiState(skin, { skin_color: "03_ca_senna", skin_type: "02", eyes: "h021" });
    // The follower `neck` has fewer choices than the controller: default kept, ambiguity recorded (open question 1).
    expect(result.appearances.map(a => [a.group, a.option, a.definition])).toEqual([["TPP", "skin_type_02", "d2__03_ca_senna"], ["FPP", "neck", "n__01"]]);
    expect(result.morphs).toEqual([{ part: "head", group: "TPP", region: "eyes", target: "h021" }]);
    expect(result.ambiguities.map(a => a.code)).toEqual(["link-index-out-of-range"]);
  });
});
