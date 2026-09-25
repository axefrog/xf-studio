import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState } from "../src/cco-model";
import { ccoPath, expandDynamicPath, loadMergedCco, resolveCharacter, visibleChunks, type CharacterInput } from "../src/character-resolver";
import { depotHash, refFromPath } from "../src/depot-path";
import { snakeCase } from "../src/resource-graph";
import { app, appearanceOption, cco, cr2w, ent, fixtureInstallation, instance, mesh, meshComponent, mi, morphComponent,
  morphtarget, nameParam, switcherOption, tex, type FixtureArchive } from "./resolver-fixtures";

const FEMALE_CCO = ccoPath("female", false);
const EARRING_APP = "base\\characters\\head\\player_base_heads\\appearances\\head\\piercings\\i0_000__earring_14.app";
const PART_ENT = "base\\characters\\head\\player_base_heads\\appearances\\entity\\items\\i1_000_pwa_earring__basehead_04.ent";
const PART_MORPH = "base\\characters\\head\\player_base_heads\\player_female_average\\i1_000_pwa__morphs_earring_04.morphtarget";
const EARRING_MESH = "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\i1_000_pwa_c__basehead_earring_04.mesh";
const SILVER = "i0_000_pwa__earring__01_silver";
const slot = (n: number) => `eagul\\piercingmorphs\\female\\fpm${n}.morphtarget`;

/** A vanilla piercing option plus, optionally, a PRC-style framework and one filled slot: no PRC-specific code involved. */
function piercingInstallation(withFramework: boolean) {
  const vanillaAppearance = { name: SILVER, parts: [PART_ENT], overrides: [{ componentName: "i1_000_pwa__morphs_earring_04", meshAppearance: "silver", chunkMask: "18446744073709551612" }] };
  const archives: FixtureArchive[] = [{ virtualPath: "archive/pc/content/basegame_4_appearance.archive", files: {
    [FEMALE_CCO]: cco([
      switcherOption("piercings", [["Common-Off", ["piercings_00"]], ["12", ["piercings_12"]]]),
      appearanceOption("piercings_12", EARRING_APP, [SILVER, "i0_000_pwa__earring__02_gold"], { enabled: 0, hidden: 0, link: "piercings color", linkController: 1 }),
    ], { face: ["piercings_12"] }),
    [EARRING_APP]: app([vanillaAppearance]),
    [PART_ENT]: ent([morphComponent("i1_000_pwa__morphs_earring_04", PART_MORPH)]),
    [PART_MORPH]: morphtarget(EARRING_MESH, 3, [["h015", "ear"]]),
    [EARRING_MESH]: mesh({ appearances: [{ name: "silver", chunkMaterials: ["silver__01", "silver__02", "silver__03"] }],
      entries: [0, 1, 2].map(i => ({ name: `silver__0${i + 1}`, local: true, index: i })),
      local: [0, 1, 2].map(() => instance("base\\characters\\common\\earrings\\i1_000_base__silver.mi")) }),
    "base\\characters\\common\\earrings\\i1_000_base__silver.mi": mi("engine\\materials\\multilayered.mt", [tex("MultilayerSetup", "base\\earrings\\silver.mlsetup")]),
    "base\\earrings\\silver.mlsetup": {},
  } }];
  if (withFramework) {
    archives.push({ virtualPath: "archive/pc/mod/PRC_z_999_Framework_128.archive", provider: "mo2-mod", providerName: "Framework", priority: 1, files: {
      [EARRING_APP]: app([{ ...vanillaAppearance, overrides: [{ ...vanillaAppearance.overrides[0]!, chunkMask: "18446744073709551610" }],
        components: [1, 2, 3].map(n => morphComponent(`fpm${n}`, slot(n), "silver")) }]),
      ...Object.fromEntries([1, 2, 3].map(n => [slot(n), morphtarget(EARRING_MESH, 0, [["h015", "ear"]])])),
    } });
    archives.push({ virtualPath: "archive/pc/mod/PRC_f_2_nose_ring.archive", provider: "mo2-mod", providerName: "Nose ring", priority: 2, files: {
      [slot(2)]: morphtarget("eagul\\piercingmorphs\\female\\fpm2_linked.mesh", 1, [["h012", "nose"], ["h022", "nose"]]),
      "eagul\\piercingmorphs\\female\\fpm2_linked.mesh": mesh({ appearances: [{ name: "silver", chunkMaterials: ["default__02"] }],
        entries: [{ name: "default__02", local: false, index: 0 }], external: ["base\\eagul\\mat_1.mi"] }),
    } });
    archives.push({ virtualPath: "archive/pc/mod/nim_recolor_silver.archive", provider: "mo2-mod", providerName: "Recolour", priority: 3, files: {
      "base\\eagul\\mat_1.mi": mi("engine\\materials\\multilayered.mt", [tex("MultilayerSetup", "base\\earrings\\silver.mlsetup")]),
    } });
  }
  return fixtureInstallation(archives);
}

async function resolvePiercing12(withFramework: boolean) {
  const { graph } = piercingInstallation(withFramework);
  const cco = await loadMergedCco(graph, "female");
  const derived = descriptorsFromUiState(cco.merged.cco, { piercings: "12", piercings_12: SILVER });
  const input: CharacterInput = { bodyGender: "female", origin: "ui-state", appearances: derived.appearances,
    morphs: [{ part: "head", group: "TPP", region: "nose", target: "h022" }] };
  return resolveCharacter(graph, input, cco);
}

describe("generic resolution of a piercing choice", () => {
  test("vanilla option 12 resolves to the vanilla part and its chunk mask", async () => {
    const result = await resolvePiercing12(false);
    const [entry] = result.appearances;
    expect(entry!.groups).toEqual(["face"]);
    expect(entry!.app!.archive).toBe("basegame_4_appearance.archive");
    expect(entry!.components.map(c => [c.name, c.origin.kind, c.geometry?.visibleChunks])).toEqual([["i1_000_pwa__morphs_earring_04", "part", [2]]]);
    expect(entry!.components[0]!.materials[0]!.template!.ref.path).toBe("engine\\materials\\multilayered.mt");
  });

  test("with a slot framework installed, the same vanilla choice resolves to its bank from data alone", async () => {
    const result = await resolvePiercing12(true);
    const [entry] = result.appearances;
    expect(entry!.app!.archive).toBe("PRC_z_999_Framework_128.archive");
    expect(entry!.app!.rule.rule).toBe("mod-over-content");
    const byName = new Map(entry!.components.map(c => [c.name, c]));
    // Placeholders have zero render chunks and draw nothing; the filled slot wins by alphabetical archive order.
    expect(byName.get("fpm1")!.geometry!.drawsNothing).toBe(true);
    expect(byName.get("fpm3")!.geometry!.drawsNothing).toBe(true);
    const ring = byName.get("fpm2")!;
    expect(ring.geometry!.morphTarget!.archive).toBe("PRC_f_2_nose_ring.archive");
    expect(ring.geometry!.morphTarget!.alternatives[0]).toContain("PRC_z_999_Framework_128.archive");
    expect(ring.geometry!.mesh!.ref.path).toBe("eagul\\piercingmorphs\\female\\fpm2_linked.mesh");
    expect(ring.appliedMorphs).toEqual([{ region: "nose", target: "h022" }]);
    expect(ring.morphRegions).toEqual({ nose: 2 });
    const [material] = ring.materials;
    expect(material!.route).toBe("entry");
    expect(material!.chain.map(link => link.label)).toEqual(["base\\eagul\\mat_1.mi"]);
    expect(material!.chain[0]!.provenance!.archive).toBe("nim_recolor_silver.archive");
    expect(material!.template!.ref.path).toBe("engine\\materials\\multilayered.mt");
    // The kept vanilla part now shows chunk 1 (mask …610) instead of chunk 2 (…612).
    expect(byName.get("i1_000_pwa__morphs_earring_04")!.geometry!.visibleChunks).toEqual([1]);
    expect(result.ambiguities.some(a => a.code === "mod-over-base-native-unread")).toBe(true);
  });
});

describe("CCXL-style dynamic hair colour", () => {
  const MEL_APP = "mel\\hair.app", MEL_MESH = "mel\\hair.mesh";
  const archives: FixtureArchive[] = [
    { virtualPath: "archive/pc/content/basegame.archive", files: {
      [FEMALE_CCO]: cco([], { hairs: [] }), "base\\materials\\hair.mt": {} } },
    { virtualPath: "archive/pc/mod/mel.archive", provider: "mo2-mod", providerName: "Hairstyle", priority: 5, files: {
      "mel\\hair.inkcharcustomization": cco([appearanceOption("mel_hair", MEL_APP, ["01_blonde_platinum"], { uiSlot: "hair_color" })], { hairs: ["mel_hair"] }),
      [MEL_APP]: app([{ name: "default" }, { name: "hair_blonde_platinum", components: [meshComponent("hair", MEL_MESH, "blonde_platinum")],
        overrides: [{ componentName: "hair", meshAppearance: "blonde_platinum" }] }]),
      [MEL_MESH]: mesh({ chunks: 2, appearances: [{ name: "blonde_platinum", chunkMaterials: ["blonde_platinum@long", "blonde_platinum@long"] }],
        entries: [{ name: "@context", local: true, index: 0 }, { name: "@long", local: true, index: 1 }],
        local: [instance("", [nameParam("LongBaseMaterial", "mel\\long_base.mi")]), instance("mel\\long_base.mi")] }),
      "mel\\long_base.mi": mi("base\\materials\\hair.mt", [tex("Strand_Alpha", "mel\\alpha.xbm")]),
      "mel\\alpha.xbm": {},
    } },
    { virtualPath: "archive/pc/mod/profiles.archive", provider: "mo2-mod", providerName: "Colour pack", priority: 4, files: {
      "id\\colors.inkcharcustomization": cco([appearanceOption("", null, ["38_ash_brown"], { uiSlot: "hair_color" })], {}),
      "id\\patch.mesh": mesh({ appearances: [{ name: "ash_brown", chunkMaterials: [] }], entries: [{ name: "@long", local: false, index: 0 }], external: ["id\\template__long.mi"] }),
      "id\\template__long.mi": mi("*{long_base_material}", [tex("HairProfile", "*id\\profiles\\{material}.hp")]),
      "id\\profiles\\ash_brown.hp": {},
    } },
  ];
  const xl = [
    { id: "archive/pc/mod/mel.xl", document: { customizations: { female: "mel\\hair.inkcharcustomization" }, resource: { scope: {
      "player_customization.app": ["player_wa_hair.app"], "player_wa_hair.app": [MEL_APP], "player_wa_hair.mesh": [MEL_MESH] } } } },
    { id: "archive/pc/mod/profiles.xl", document: { customizations: { female: "id\\colors.inkcharcustomization" },
      resource: { patch: { "id\\patch.mesh": { props: ["appearances"], targets: ["player_wa_hair.mesh"] } } } } },
  ];

  test("a colour added by another pack is built dynamically and its template paths expand", async () => {
    const { graph } = fixtureInstallation(archives, xl);
    const input: CharacterInput = { bodyGender: "female", origin: "save", morphs: [],
      appearances: [{ part: "head", group: "hairs", option: "mel_hair", app: refFromPath(MEL_APP), definition: "38_ash_brown" }] };
    const result = await resolveCharacter(graph, input);
    const [entry] = result.appearances;
    expect(entry!.choice!.providedBy).toContain("id\\colors.inkcharcustomization");
    expect(entry!.appearance).toEqual({ status: "dynamic", source: "hair_blonde_platinum", patchedBy: [] });
    const hair = entry!.components.find(c => c.name === "hair")!;
    expect(hair.meshAppearance).toBe("ash_brown");
    expect(hair.meshAppearanceResolved).toEqual({ requested: "ash_brown", used: "ash_brown", expandedFrom: "blonde_platinum", patchedFrom: "id\\patch.mesh" });
    expect(hair.materials).toHaveLength(2);
    const material = hair.materials[0]!;
    expect(material.route).toBe("template");
    expect(material.dynamic).toEqual({ template: "@long", material: "ash_brown", context: { long_base_material: "mel\\long_base.mi" } });
    const profile = material.params.find(p => p.name === "HairProfile")!;
    expect(profile.value).toBe("id\\profiles\\ash_brown.hp");
    expect(profile.resource!.archive).toBe("profiles.archive");
    expect(material.chain.map(link => link.label)).toEqual(["id\\template__long.mi", "mel\\long_base.mi"]);
    expect(material.params.find(p => p.name === "Strand_Alpha")!.setBy).toBe("mel\\long_base.mi");
    expect(material.template!.ref.path).toBe("base\\materials\\hair.mt");
    expect(result.cco.customResources.map(c => c.path)).toEqual(["mel\\hair.inkcharcustomization", "id\\colors.inkcharcustomization"]);
  });
});

describe("installation-dependent choices", () => {
  const EYE_APP = "base\\eyes.app", XL_EYE_APP = "archive_xl\\eyes.app", EYE_MORPH = "base\\eyes.morphtarget", EYE_MESH = "base\\eyes.mesh";
  const eyeApp = (name: string) => app([{ name, components: [morphComponent("eyes", EYE_MORPH, "gradient_green", "18446744073709551614")] }]);
  const archives: FixtureArchive[] = [
    { virtualPath: "archive/pc/content/basegame.archive", files: {
      [FEMALE_CCO]: cco([appearanceOption("eyes_color", EYE_APP, ["gradient_brown"])], { TPP: ["eyes_color"] }),
      [EYE_APP]: eyeApp("gradient_brown"), [EYE_MORPH]: morphtarget(EYE_MESH, 3, [["h011", "eyes"]]),
      [EYE_MESH]: mesh({ appearances: [{ name: "gradient_green", chunkMaterials: ["lash", "eye", "eye"] }],
        entries: [{ name: "lash", local: true, index: 0 }, { name: "eye", local: true, index: 1 }],
        local: [instance("base\\materials\\hair.mt"), instance("base\\materials\\eye.mt")] }),
    } },
    { virtualPath: "archive/pc/ep1/ep1_2_gamedata.archive", files: {
      [ccoPath("female", true)]: cco([appearanceOption("eyes_color", EYE_APP, ["gradient_brown", "gradient_green"])], { TPP: ["eyes_color"] }) } },
    { virtualPath: "red4ext/plugins/ArchiveXL/Bundle/ArchiveXL.archive", files: { [XL_EYE_APP]: eyeApp("gradient_green") } },
  ];
  const xl = [{ id: "red4ext/plugins/ArchiveXL/Bundle/EyesFix.xl", document: { resource: { fix: {
    [ccoPath("female", true)]: { paths: { [EYE_APP]: XL_EYE_APP } } } } } }];

  test("Phantom Liberty selects the _ep1 CCO; fix paths turn saved original-app descriptors into the remapped app", async () => {
    const { graph, plan } = fixtureInstallation(archives, xl);
    expect(plan.ep1Installed).toBe(true);
    const input: CharacterInput = { bodyGender: "female", origin: "save", morphs: [], appearances: [
      { part: "head", group: "TPP", option: "eyes_color", app: refFromPath(EYE_APP), definition: "gradient_green" }] };
    const result = await resolveCharacter(graph, input);
    expect(result.cco.base.ref.path).toBe(ccoPath("female", true));
    const [entry] = result.appearances;
    expect(entry!.appOverride!.to.hash).toBe(depotHash(XL_EYE_APP));
    expect(entry!.app!.archive).toBe("ArchiveXL.archive");
    const eyes = entry!.components[0]!;
    // Mask …614 hides chunk 0 (the lashes in the shared eye mesh).
    expect(eyes.geometry!.visibleChunks).toEqual([1, 2]);
    expect(eyes.materials.map(m => m.template!.ref.path)).toEqual(["base\\materials\\eye.mt", "base\\materials\\eye.mt"]);
  });

  test("a resource.copy source patched into a stub morph target supplies its geometry", async () => {
    const stub = "ark\\brow_18.morphtarget", copy = "ark_copy\\heb.morphtarget", vanilla = "base\\heb.morphtarget";
    const fixture = fixtureInstallation([
      { virtualPath: "archive/pc/content/basegame.archive", files: {
        [FEMALE_CCO]: cco([], {}), [vanilla]: morphtarget("base\\heb.mesh", 1, [["h011", "eyes"], ["h012", "nose"]]),
        "base\\heb.mesh": mesh({ appearances: [{ name: "brown", chunkMaterials: ["brow"] }], entries: [{ name: "brow", local: true, index: 0 }], local: [instance("base\\materials\\mesh_decal.mt")] }) } },
      { virtualPath: "archive/pc/mod/ark.archive", provider: "mo2-mod", providerName: "Brows", priority: 1, files: {
        "ark\\brow.app": app([{ name: "brown", components: [morphComponent("brow", stub, "brown")] }]), [stub]: morphtarget("base\\heb.mesh", null) } },
    ], [{ id: "archive/pc/mod/ark.xl", document: { resource: { copy: { [vanilla]: copy }, patch: { [copy]: { props: ["blob", "targets"], targets: [stub] } } } } }]);
    const result = await resolveCharacter(fixture.graph, { bodyGender: "female", origin: "save", morphs: [{ part: "head", group: "TPP", region: "nose", target: "h012" }],
      appearances: [{ part: "head", group: "TPP", option: "brows", app: refFromPath("ark\\brow.app"), definition: "brown" }] });
    const brow = result.appearances[0]!.components[0]!;
    expect(brow.geometry!.renderChunks).toBe(1);
    expect(brow.geometry!.patchedFrom).toEqual([copy]);
    expect(brow.morphRegions).toEqual({ eyes: 1, nose: 1 });
    expect(brow.appliedMorphs).toEqual([{ region: "nose", target: "h012" }]);
    expect(result.appearances[0]!.appearance.status).toBe("defined");
    expect(result.ambiguities.map(a => a.code)).toContain("choice-not-in-cco");
  });
});

describe("helpers", () => {
  test("ArchiveXL dynamic paths, snake_case context names and chunk masks", () => {
    const context = new Map([["long_base_material", "mel\\long.mi"]]), material = new Map([["material", "ash_brown"], ["material.1", "ash_brown"]]);
    expect(expandDynamicPath("*{long_base_material}", context, material)).toEqual({ dynamic: true, value: "mel\\long.mi", optional: false });
    expect(expandDynamicPath("*a\\{material}.hp", context, material).value).toBe("a\\ash_brown.hp");
    expect(expandDynamicPath("*a\\{missing}.hp?", context, material)).toEqual({ dynamic: true, value: null, optional: true });
    expect(expandDynamicPath("plain\\path.mi", context, material)).toEqual({ dynamic: false, value: "plain\\path.mi", optional: false });
    expect(snakeCase("LongBaseMaterial")).toBe("long_base_material");
    expect(snakeCase("appearance_expansion_source")).toBe("appearance_expansion_source");
    expect(visibleChunks("18446744073709551614", 3)).toEqual([1, 2]);
    expect(visibleChunks("18446744073709551610", 4)).toEqual([1, 3]);
    expect(visibleChunks("not a number", 2)).toEqual([0, 1]);
    expect(cr2w({}).Data.RootChunk).toEqual({});
  });
});
