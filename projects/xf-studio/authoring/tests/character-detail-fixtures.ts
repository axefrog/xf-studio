// Asset-free synthetic installation shaped like the reference resolver outputs for the head skin, brows,
// lashes and hair: a vanilla-style creator resource with a skin-type switcher, the head morph component whose
// mesh holds one local material per (tone, type) over a tone `.mi` chain ending at `skin.mt`, a brow decal,
// the eye component's lash chunk, a hair mesh with a cap, a lower LOD and a shadow mesh, plus a "mod" archive
// that adds a second brow style, replaces a hair profile, and (like a complexion mod) replaces a skin-type
// albedo and the template-default skin profile at their vanilla paths. An optional texture-framework archive
// patches the head mesh's appearances through ArchiveXL with a donor mesh that adds a secondary albedo.
// No private save, game file or real mod name is used.
import { handle, cn, rp, cr2w, cco, app, instance, mesh, meshComponent, mi, morphComponent, morphtarget, tex, appearanceOption,
  switcherOption, fixtureInstallation, type FixtureArchive } from "./resolver-fixtures";
import type { XlDocument } from "../src/archivexl-config";
import { ccoPath } from "../src/character-resolver";
import { CHARACTER_REQUEST_SCHEMA, type CharacterRequest } from "../src/character-detail-request";
import { depotHash } from "../src/depot-path";
import type { Installation } from "../src/resolver-host";

export const P = {
  cco: ccoPath("female", false),
  browApp1: "base\\fixture\\brows_01.app", browApp2: "base\\fixture\\brows_02.app",
  browMorph: "base\\fixture\\heb_morphs.morphtarget", browMesh: "base\\fixture\\heb.mesh",
  browD: "base\\fixture\\tex\\heb_d01.xbm", browDs: "base\\fixture\\tex\\heb_ds01.xbm", browD2: "fixture_mod\\tex\\heb_d02.xbm",
  grad: "base\\fixture\\tex\\cap_grad_brown.xbm",
  lashApp: "base\\fixture\\lashes.app", eyeMorph: "base\\fixture\\he_morphs.morphtarget", eyeMesh: "base\\fixture\\he.mesh",
  lashAlpha: "base\\fixture\\tex\\lash_a.xbm", white: "base\\fixture\\tex\\white.xbm", grey: "base\\fixture\\tex\\grey.xbm",
  hairApp: "base\\fixture\\hair_01.app", hairFppApp: "base\\fixture\\hair_01_fpp.app", hairMesh: "base\\fixture\\hair_01.mesh",
  shadowMesh: "base\\fixture\\hair_01_shadow.mesh", strandA: "base\\fixture\\tex\\strand_a.xbm", strandId: "base\\fixture\\tex\\strand_id.xbm",
  strandG: "base\\fixture\\tex\\strand_g.xbm", capMask: "base\\fixture\\tex\\cap_mask.xbm",
  hp: "base\\fixture\\profiles\\brown.hp",
  hairMt: "base\\materials\\hair.mt", decalMt: "base\\materials\\mesh_decal_double_diffuse.mt", capMt: "base\\materials\\mesh_decal_gradientmap_recolor.mt",
  glassMt: "base\\materials\\glass.mt", eyeMt: "base\\materials\\eye.mt",
  skinApp1: "base\\fixture\\basehead.app", skinApp3: "base\\fixture\\basehead_d03.app",
  headMorph: "base\\fixture\\h0_morphs.morphtarget", headMesh: "base\\fixture\\h0_basehead.mesh",
  skinD1: "base\\fixture\\tex\\h0_basehead_d01.xbm", skinD3: "base\\fixture\\tex\\h0_basehead_d03.xbm",
  skinN: "base\\fixture\\tex\\h0_basehead_n01.xbm", skinRm: "base\\fixture\\tex\\h0_basehead_rm01.xbm",
  skinDetailN: "base\\fixture\\tex\\h0_base_nd.xbm", tintMask: "base\\fixture\\tex\\h0_tintcolormask.xbm",
  paleMi: "base\\fixture\\skin\\01_ca_pale.mi", sennaMi: "base\\fixture\\skin\\03_ca_senna.mi", ivoryMi: "base\\fixture\\skin\\01_ca_pale_00_warm_ivory.mi",
  skinMt: "base\\materials\\skin.mt", defaultSp: "engine\\materials\\defaults\\default.sp",
  micro: "base\\fixture\\tex\\microdetail_n.xbm", flat: "base\\fixture\\tex\\flat_n.xbm", black: "base\\fixture\\tex\\black.xbm",
  donorMesh: "framework\\donor_head.mesh", overlay: "framework\\tex\\head_overlay_d01.xbm",
} as const;
/** Skin tone definitions, as the vanilla creator names them. */
export const TONES = { pale: "h0_000_pwa__basehead__01_ca_pale", ivory: "h0_000_pwa__basehead__01_ca_pale_00_warm_ivory",
  senna: "h0_000_pwa__basehead__03_ca_senna" } as const;

const colour = (name: string, r: number, g: number, b: number) => ({ $type: "Color", [name]: { $type: "Color", Red: r, Green: g, Blue: b, Alpha: 255 } });
const scalar = (name: string, value: number) => ({ $type: "Float", [name]: value });
const hp = (name: string, value: string) => ({ $type: "rRef:CHairProfile", [name]: rp(value) });
const xbm = (gamma: boolean) => cr2w({ $type: "CBitmapTexture", width: 4, height: 4, setup: { $type: "STextureGroupSetup", isGamma: gamma ? 1 : 0 } });
const stop = (value: number, r: number, g: number, b: number) => ({ $type: "rendGradientEntry", value, color: { $type: "Color", Red: r, Green: g, Blue: b, Alpha: 255 } });
const profile = (tip: number) => cr2w({ $type: "CHairProfile", sampleCount: 127,
  gradientEntriesID: [stop(0.2, 120, 120, 120), stop(0.8, 140, 140, 140)], gradientEntriesRootToTip: [stop(0, 20, 12, 8), stop(1, tip, 60, 40)] });
const template = (params: object[]) => cr2w({ $type: "CMaterialTemplate", parameters: { Elements: [[], params.map(data => handle(data))] } });
const tParam = (name: string, path: string) => ({ $type: "CMaterialParameterTexture", parameterName: cn(name), texture: rp(path) });
const sParam = (name: string, value: number) => ({ $type: "CMaterialParameterScalar", parameterName: cn(name), scalar: value });
const hParam = (name: string, path: string) => ({ $type: "CMaterialParameterHairParameters", parameterName: cn(name), hairProfile: rp(path) });
const spParam = (name: string, path: string) => ({ $type: "CMaterialParameterSkinParameters", parameterName: cn(name), skinProfile: rp(path) });
const cParam = (name: string, r: number, g: number, b: number) =>
  ({ $type: "CMaterialParameterColor", parameterName: cn(name), color: { $type: "Color", Red: r, Green: g, Blue: b, Alpha: 255 } });
const skinProfile = (values: { roughness0: number; roughness1: number; lobeMix: number; blurSize: number; falloff: [number, number, number] }) =>
  cr2w({ $type: "CSkinProfile", roughness0: values.roughness0, roughness1: values.roughness1, lobeMix: values.lobeMix, blurSize: values.blurSize,
    diffuse: { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 },
    falloff: { $type: "Color", Red: values.falloff[0], Green: values.falloff[1], Blue: values.falloff[2], Alpha: 255 } });
/** One local head material per (tone, type): only the type's albedo and the shared normal, over the tone's chain. */
const headMaterial = (tone: string, albedo: string) => instance(tone, [tex("Albedo", albedo), tex("Normal", P.skinN)]);
const toneAppearances = (suffix: string) => [TONES.pale, TONES.ivory, TONES.senna].map(tone =>
  ({ name: tone, components: [morphComponent("head", P.headMorph, `${tone.split("__").pop()!}${suffix}`)] }));
/** A mesh whose render chunks carry LOD masks. */
const lodMesh = (spec: Parameters<typeof mesh>[0], lods: number[]) => {
  const doc = mesh({ ...spec, chunks: null }) as { Data: { RootChunk: Record<string, unknown> } };
  doc.Data.RootChunk.renderResourceBlob = handle({ $type: "rendRenderMeshBlob", header: { $type: "rendRenderMeshBlobHeader",
    renderChunkInfos: lods.map(lodMask => ({ $type: "rendChunk", lodMask })) } });
  return doc;
};

const option = (name: string, resource: string | null, definitions: string[], uiSlot: string, enabled = 1, hidden = 0) =>
  appearanceOption(name, resource, definitions, { uiSlot, enabled, hidden });

export function detailFixture(options: { skinPatch?: boolean } = {}): { archives: FixtureArchive[]; installation: () => Installation } {
  const base: FixtureArchive = { virtualPath: "archive/pc/content/basegame_fixture.archive", files: {
    [P.cco]: cco([
      switcherOption("skin_type", [["01", ["skin_type_01"]], ["03", ["skin_type_03"]]]),
      option("skin_type_01", P.skinApp1, [TONES.pale, TONES.ivory, TONES.senna], "skin_type"),
      option("skin_type_03", P.skinApp3, [TONES.pale, TONES.ivory, TONES.senna], "skin_type"),
      option("eyebrows_color1", P.browApp1, ["brown"], "eyebrows_color"),
      option("eyebrows_color2", P.browApp2, ["dark"], "eyebrows_color", 0),
      option("eyelash_color", P.lashApp, ["brown"], "eyelash_color"),
      option("hair_color1", P.hairApp, ["brown"], "hair_color"),
      option("hair_color_fpp_01", P.hairFppApp, ["default"], "hair_color_fpp", 1, 1),
    ], { TPP: ["skin_type_01", "skin_type_03", "eyebrows_color1", "eyebrows_color2", "eyelash_color"], hairs: ["hair_color1"],
      FPP_hairs: ["hair_color_fpp_01"], character_customization: ["skin_type_01", "skin_type_03", "eyebrows_color1", "eyebrows_color2",
        "eyelash_color", "hair_color1", "hair_color_fpp_01"] }),
    // Skin: the type's .app names the tone's mesh appearance on the one head morph component (plus a part the preview doesn't draw).
    [P.skinApp1]: app(toneAppearances("").map(entry => ({ ...entry, components: [...entry.components, meshComponent("seam_fix", P.shadowMesh)] }))),
    [P.skinApp3]: app(toneAppearances("_d03")),
    [P.headMorph]: morphtarget(P.headMesh, 1, [["h011", "eyes"], ["h012", "nose"]]),
    [P.headMesh]: mesh({ appearances: [
        { name: "01_ca_pale", chunkMaterials: ["pale"] }, { name: "01_ca_pale_00_warm_ivory", chunkMaterials: ["ivory"] },
        { name: "03_ca_senna", chunkMaterials: ["senna"] }, { name: "01_ca_pale_d03", chunkMaterials: ["pale_d03"] },
        { name: "01_ca_pale_00_warm_ivory_d03", chunkMaterials: ["ivory_d03"] }, { name: "03_ca_senna_d03", chunkMaterials: ["senna_d03"] }],
      entries: ["pale", "ivory", "senna", "pale_d03", "ivory_d03", "senna_d03"].map((name, index) => ({ name, local: true, index })),
      local: [headMaterial(P.paleMi, P.skinD1), headMaterial(P.ivoryMi, P.skinD1), headMaterial(P.sennaMi, P.skinD1),
        headMaterial(P.paleMi, P.skinD3), headMaterial(P.ivoryMi, P.skinD3), headMaterial(P.sennaMi, P.skinD3)] }),
    [P.paleMi]: mi(P.skinMt, [colour("TintColor", 171, 155, 150), scalar("TintScale", 0), tex("TintColorMask", P.tintMask),
      tex("Roughness", P.skinRm), tex("DetailNormal", P.skinDetailN), scalar("DetailNormalInfluence", 0.8),
      scalar("MicroDetailUVScale01", 20), scalar("MicroDetailUVScale02", 8)]),
    [P.ivoryMi]: mi(P.skinMt, [colour("TintColor", 255, 245, 181), scalar("TintScale", -0.15), tex("Roughness", P.skinRm), tex("DetailNormal", P.skinDetailN)]),
    [P.sennaMi]: mi(P.skinMt, [colour("TintColor", 202, 177, 153), scalar("TintScale", 0.7), tex("TintColorMask", P.tintMask),
      tex("Roughness", P.skinRm), tex("DetailNormal", P.skinDetailN), scalar("DetailNormalInfluence", 0.8)]),
    [P.skinMt]: template([tParam("Albedo", P.white), tParam("SecondaryAlbedo", P.white), sParam("SecondaryAlbedoInfluence", 0),
      tParam("Normal", P.flat), tParam("DetailNormal", P.flat), tParam("Roughness", P.white), sParam("DetailRoughnessBiasMin", 1),
      sParam("DetailRoughnessBiasMax", 0.68), tParam("MicroDetail", P.micro), sParam("MicroDetailInfluence", 1), tParam("TintColorMask", P.black),
      cParam("TintColor", 0, 0, 0), sParam("TintScale", 0), tParam("EmissiveMask", P.black), sParam("EmissiveEV", 0),
      sParam("CavityIntensity", 0.25), tParam("Detailmap_Stretch", P.flat), spParam("SkinProfile", P.defaultSp)]),
    [P.defaultSp]: skinProfile({ roughness0: 0.966366, roughness1: 1.59684, lobeMix: 1, blurSize: 1.4, falloff: [255, 178, 165] }),
    [P.skinD1]: xbm(true), [P.skinD3]: xbm(true), [P.skinN]: xbm(false), [P.skinRm]: xbm(false), [P.skinDetailN]: xbm(false),
    [P.tintMask]: xbm(false), [P.micro]: xbm(false), [P.flat]: xbm(false), [P.black]: xbm(false),
    [P.browApp1]: app([{ name: "brown", components: [morphComponent("brow", P.browMorph, "brown")] }]),
    [P.browMorph]: morphtarget(P.browMesh, 1, [["h011", "eyes"], ["h012", "nose"]]),
    [P.browMesh]: mesh({ appearances: [{ name: "brown", chunkMaterials: ["brows"] }, { name: "dark", chunkMaterials: ["brows_dark"] }],
      entries: [{ name: "brows", local: true, index: 0 }, { name: "brows_dark", local: true, index: 1 }], local: [
        instance(P.decalMt, [tex("DiffuseTexture", P.browD), tex("SecondaryDiffuseAlpha", P.browDs), tex("GradientMap", P.grad),
          scalar("UseGradientMap", 1), scalar("GradientMapIntensity", 0.5), colour("SecondaryDiffuseColor", 62, 49, 42)]),
        instance(P.decalMt, [tex("DiffuseTexture", P.browD2), tex("SecondaryDiffuseAlpha", P.browDs), tex("GradientMap", P.grad)])] }),
    [P.lashApp]: app([{ name: "brown", components: [morphComponent("eyes", P.eyeMorph, "brown", "1")] }]),
    [P.eyeMorph]: morphtarget(P.eyeMesh, 2, [["h011", "eyes"]]),
    [P.eyeMesh]: mesh({ appearances: [{ name: "brown", chunkMaterials: ["lashes", "eye"] }],
      entries: [{ name: "lashes", local: true, index: 0 }, { name: "eye", local: true, index: 1 }], local: [
        instance(P.hairMt, [tex("Strand_Alpha", P.lashAlpha), tex("Strand_Gradient", P.white), hp("HairProfile", P.hp),
          scalar("AlphaCutoff", 0), scalar("RoughnessScale", 0), scalar("RoughnessBias", 1)]),
        instance(P.eyeMt)] }),
    [P.hairApp]: app([{ name: "brown", components: [meshComponent("hair", P.hairMesh, "brown"), meshComponent("hair_shadow", P.shadowMesh)] }]),
    [P.hairFppApp]: app([{ name: "default", components: [meshComponent("hair_fpp", P.shadowMesh)] }]),
    [P.hairMesh]: lodMesh({ appearances: [{ name: "brown", chunkMaterials: ["long", "cap", "long"] }],
      entries: [{ name: "long", local: true, index: 0 }, { name: "cap", local: true, index: 1 }], local: [
        instance(P.hairMt, [tex("Strand_Alpha", P.strandA), tex("Strand_ID", P.strandId), tex("Strand_Gradient", P.strandG),
          hp("HairProfile", P.hp), scalar("ShadowStrength", 0.9), scalar("ShadowMin", -0.4)]),
        instance(P.capMt, [tex("MaskTexture", P.capMask), tex("GradientMap", P.grad), scalar("DiffuseAlpha", 1)])] }, [1, 1, 2]),
    [P.shadowMesh]: mesh({ appearances: [{ name: "default", chunkMaterials: ["glass"] }], entries: [{ name: "glass", local: true, index: 0 }],
      local: [instance(P.glassMt)], chunks: 1 }),
    [P.hairMt]: template([tParam("Strand_ID", P.grey), tParam("Strand_Gradient", P.grey), tParam("Strand_Alpha", P.grey),
      sParam("AlphaCutoff", 0.33), sParam("RoughnessScale", 1), hParam("HairProfile", P.hp)]),
    [P.decalMt]: template([tParam("DiffuseTexture", P.white), sParam("UseGradientMap", 0), sParam("GradientMapIntensity", 1),
      sParam("SecondaryDiffuseAlphaIntensity", 0.7), sParam("GradientMapUV", 1)]),
    [P.capMt]: template([tParam("MaskTexture", P.white), sParam("DepthThreshold", 0.5)]),
    [P.browD]: xbm(true), [P.browDs]: xbm(true), [P.grad]: xbm(true), [P.lashAlpha]: xbm(false), [P.white]: xbm(false), [P.grey]: xbm(false),
    [P.strandA]: xbm(false), [P.strandId]: xbm(false), [P.strandG]: xbm(false), [P.capMask]: xbm(false), [P.hp]: profile(60),
  } };
  // A mod archive: a second brow style's texture and a replacement hair profile (it wins over the base game).
  // Like a complexion mod, it also replaces skin type 3's albedo and the template-default skin profile at their vanilla paths.
  const mod: FixtureArchive = { virtualPath: "archive/pc/mod/fixture_mod.archive", provider: "mo2-mod", providerName: "Fixture mod", priority: 1, files: {
    [P.browApp2]: app([{ name: "dark", components: [morphComponent("brow", P.browMorph, "dark")] }]),
    [P.browD2]: xbm(true), [P.hp]: profile(200), [P.skinD3]: xbm(true),
    [P.defaultSp]: skinProfile({ roughness0: 1, roughness1: 1.6, lobeMix: 0.6, blurSize: 2.5, falloff: [255, 155, 119] }),
  } };
  // A texture framework: its donor mesh's appearance replaces the head's, adding a secondary albedo overlay.
  const framework: FixtureArchive = { virtualPath: "archive/pc/mod/fixture_framework.archive", provider: "mo2-mod", providerName: "Fixture framework",
    priority: 2, files: {
      [P.donorMesh]: mesh({ appearances: [{ name: "03_ca_senna_d03", chunkMaterials: ["skin2_d03"] }],
        entries: [{ name: "skin2_d03", local: true, index: 0 }], local: [instance(P.sennaMi, [tex("Albedo", P.skinD3), tex("Normal", P.skinN),
          tex("SecondaryAlbedo", P.overlay), scalar("SecondaryAlbedoInfluence", 1), scalar("SecondaryAlbedoTintColorInfluence", 1)])] }),
      [P.overlay]: xbm(true),
    } };
  const archives = options.skinPatch ? [base, mod, framework] : [base, mod];
  const xl: XlDocument[] = options.skinPatch ? [{ id: "archive/pc/mod/fixture_framework.xl",
    document: { resource: { patch: { [P.donorMesh]: { props: ["appearances"], targets: [P.headMesh] } } } } }] : [];
  return { archives, installation: () => {
    const { plan, depot, graph } = fixtureInstallation(archives, xl);
    return { plan, depot, graph, xl: graph.xl, fetcher: {} as Installation["fetcher"], summary: { route: "mo2", scanComplete: true, scanIssues: [],
      scanGaps: [], mountedArchives: plan.archives.length, unmountedArchives: 0, indexErrors: [], unreadIndexes: [], xlFiles: 0, xlIssues: [],
      ep1Installed: false, modOrder: plan.modOrder } };
  } };
}

/** Save-shaped requests (option, `.app` hash and definition per consumer group), like the save reader produces. */
const saved = (items: [string, string, string, string][]): CharacterRequest => ({ schema: CHARACTER_REQUEST_SCHEMA, source: "save", bodyGender: "female",
  appearances: items.map(([group, option, path, definition]) => ({ group, option, app: depotHash(path), definition })),
  morphs: [{ group: "TPP", region: "nose", target: "h012" }] });
/** V "A": skin type 1 in pale, brow style 1, lashes, hair 1 (with its FPP twin in its own group). */
export const REQUEST_A = saved([["TPP", "skin_type_01", P.skinApp1, TONES.pale], ["TPP", "eyebrows_color1", P.browApp1, "brown"],
  ["TPP", "eyelash_color", P.lashApp, "brown"],
  ["hairs", "hair_color1", P.hairApp, "brown"], ["FPP_hairs", "hair_color_fpp_01", P.hairFppApp, "default"],
  ["character_customization", "eyebrows_color1", P.browApp1, "brown"]]);
/** V "B": skin type 3 in senna, the mod's brow style, lashes, and no hair at all. */
export const REQUEST_B = saved([["TPP", "skin_type_03", P.skinApp3, TONES.senna], ["TPP", "eyebrows_color2", P.browApp2, "dark"],
  ["TPP", "eyelash_color", P.lashApp, "brown"]]);
