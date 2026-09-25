// Asset-free synthetic installation shaped like the reference resolver outputs for the head skin, brows,
// lashes, hair and eyes: a vanilla-style creator resource with a skin-type switcher, the head morph component whose
// mesh holds one local material per (tone, type) over a tone `.mi` chain ending at `skin.mt`, a brow decal,
// the eye component's lash chunk, a hair mesh with a cap, a lower LOD and a shadow mesh, plus a "mod" archive
// that adds a second brow style, replaces a hair profile, and (like a complexion mod) replaces a skin-type
// albedo and the template-default skin profile at their vanilla paths. An optional texture-framework archive
// patches the head mesh's appearances through ArchiveXL with a donor mesh that adds a secondary albedo.
// Eyes: one three-chunk eye mesh (lashes, eyeball, wetness shell) whose eye-colour choices are a gradient eye, a
// texture-only eye, a layered design and a chunk-swapped (male-order) gradient eye; its morph target binds a flat
// normal to `Normal`, and an ArchiveXL-style fix copy clears that for the app's "mod" appearance, which a
// CCXL-style pack's colour is built from (a CCO on the eye slot, a patch mesh with an `@eyes` template and soft paths).
// Face details: a lipstick behind an Off/style switcher, blush and freckles on one two-chunk mesh, a tattoo whose colour
// follows the skin tone, face cyberware whose second chunk is an emissive decal the preview doesn't draw yet, the skin type's
// personal-link decal (skin type 3), and a CCXL-style makeup option on a slot of its own whose material derives from a copy of
// `mesh_decal.mt` at the pack's own path (named `mesh_decal`, priority `EMP_Front`), added to the `face` group.
// Piercings: an Off/style switcher on the piercing slot with two vanilla-style options on `multilayered.mt` (an `.mlsetup` of three layers,
// one hidden, over two layer templates, and an `.mlmask`), each drawing chunks 0 and 2 of a three-chunk earring through its chunk mask;
// and a jewellery "framework" archive that replaces style 12's `.app` at its vanilla path with inline slot components (two zero-chunk
// placeholders and one slot an item archive fills with its own morph target over a linked mesh), keeping the vanilla part.
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
  eyeApp: "base\\fixture\\he_basehead.app", eyeGradMt: "base\\materials\\eye_gradient.mt", eyeShadowMt: "base\\materials\\eye_shadow.mt",
  layeredMt: "engine\\materials\\multilayered.mt", blueMi: "base\\fixture\\eyes\\blue_eye_gradient.mi", shadowMi: "base\\fixture\\eyes\\eyeshadow_base.mi",
  eyeD: "base\\fixture\\eyes\\eye_d02.xbm", eyeN: "base\\fixture\\eyes\\eye_n01.xbm", eyeRm: "base\\fixture\\eyes\\eye_rm01.xbm",
  irisMask: "base\\fixture\\eyes\\eye_mask.xbm", bubble: "base\\fixture\\eyes\\normal_bubble.xbm", shellMask: "base\\fixture\\eyes\\eye_shadow_mask.xbm",
  textureEyeD: "base\\fixture\\eyes\\texture_eye_d01.xbm", textureEyeN: "base\\fixture\\eyes\\texture_eye_n01.xbm",
  blueGradient: "base\\fixture\\eyes\\eye_blue.gradient", defaultGradient: "engine\\materials\\defaults\\default.gradient",
  editorNormal: "engine\\textures\\editor\\normal.xbm", fixMorph: "archive_xl\\fixture\\he_morphs_normal_fix.morphtarget",
  nullMorph: "archive_xl\\common\\null.morphtarget", packCco: "fixture_pack\\eyes.inkcharcustomization",
  packPatch: "fixture_pack\\eyes_patch.mesh", packD: "fixture_pack\\tex\\pack_eye_01_d.xbm", packN: "fixture_pack\\tex\\pack_eye_01_n.xbm",
  meshDecalMt: "base\\materials\\mesh_decal.mt", emissiveMt: "base\\materials\\mesh_decal_emissive.mt",
  lipsApp: "base\\fixture\\makeup_lips_05.app", lipsMorph: "base\\fixture\\hx_lips_morphs.morphtarget", lipsMesh: "base\\fixture\\hx_lips.mesh",
  lipsD: "base\\fixture\\tex\\hx_lips_d05.xbm", lipsRedMi: "base\\fixture\\makeup\\lips_color__red.mi",
  cheeksApp: "base\\fixture\\makeup_cheeks_05.app", frecklesApp: "base\\fixture\\makeup_freckles_01.app",
  freckMorph: "base\\fixture\\hx_freckles_morphs.morphtarget", freckMesh: "base\\fixture\\hx_freckles.mesh",
  cheeksD: "base\\fixture\\tex\\hx_cheeks_d05.xbm", frecklesD: "base\\fixture\\tex\\hx_freckles_d01.xbm",
  tattooApp: "base\\fixture\\tattoo_02.app", tattooMorph: "base\\fixture\\hx_tattoo_02_morphs.morphtarget", tattooMesh: "base\\fixture\\hx_tattoo_02.mesh",
  tattooD: "base\\fixture\\tex\\hx_tattoo_02_d.xbm",
  cyberApp: "base\\fixture\\cyberware.app", cyberMorph: "base\\fixture\\hx_cyberware_01_morphs.morphtarget", cyberMesh: "base\\fixture\\hx_cyberware_01.mesh",
  cyberD: "base\\fixture\\tex\\hx_cyberware_01_d.xbm", cyberN: "base\\fixture\\tex\\hx_cyberware_01_n.xbm",
  linkMorph: "base\\fixture\\hx_personal_link_morphs.morphtarget", linkMesh: "base\\fixture\\hx_personal_link.mesh",
  packLinerApp: "fixture_pack\\liner.app", packLinerMorph: "fixture_pack\\liner.morphtarget", packLinerMesh: "fixture_pack\\liner.mesh",
  packLinerD: "fixture_pack\\tex\\liner_d.xbm", packFrontMt: "fixture_pack\\materials\\mesh_decal_front.mt",
  earringApp1: "base\\fixture\\piercings\\earring_01.app", earringApp12: "base\\fixture\\piercings\\earring_12.app",
  earringMorph: "base\\fixture\\i1_earring_morphs.morphtarget", earringMesh: "base\\fixture\\i1_earring.mesh",
  silverMi: "base\\fixture\\earrings\\earring_silver.mi", blackMi: "base\\fixture\\earrings\\earring_black.mi",
  silverSetup: "base\\fixture\\earrings\\earring_silver.mlsetup", blackSetup: "base\\fixture\\earrings\\earring_black.mlsetup",
  earringMask: "base\\fixture\\earrings\\earring_01.mlmask", metalTpl: "base\\surfaces\\fixture_metal.mltemplate",
  paintTpl: "base\\surfaces\\fixture_paint.mltemplate", metalD: "base\\surfaces\\tex\\metal_d.xbm", metalN: "base\\surfaces\\tex\\metal_n.xbm",
  metalR: "base\\surfaces\\tex\\metal_r.xbm", paintD: "base\\surfaces\\tex\\paint_d.xbm", microblend: "base\\surfaces\\microblends\\default.xbm",
  slotMorph: (n: number) => `fixture_jewellery\\slots\\slot${n}.morphtarget`, slotMesh: "fixture_jewellery\\slots\\slot2_linked.mesh",
} as const;
/** Piercing definitions, as the vanilla creator names them. */
export const PIERCING = { silver: "i0_000_pwa__earring__01_silver", black: "i0_000_pwa__earring__03_black" } as const;
/** The earring's chunk mask: chunks 0 and 2 of three. */
export const EARRING_MASK = "18446744073709551613";
/** Face-detail definitions, as the vanilla creator names them. */
export const FACE = { lipsRed: "hx_000_pwa__basehead__makeup_lips_05__06_red", cheeksRed: "hx_000_pwa__morphs_makeup_freckles_01__03_red",
  frecklesBrown: "hx_000_pwa__morphs_makeup_freckles_01__03_light_brown", tattooSenna: "hx_000_pwa__tattoo_02__03_ca_senna",
  cyberSenna: "hx_000_pwa__cyberware_01__03_ca_senna", packLiner: "pack_liner_black" } as const;
/** The eye colour's chunk mask: every chunk but the lashes (chunk 0). */
export const EYE_MASK = "18446744073709551614";
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
/** A template with its own name and priority (what a copied `.mt` keeps). */
const namedTemplate = (name: string, priority: string, params: object[]) =>
  cr2w({ $type: "CMaterialTemplate", name: cn(name), materialPriority: priority, parameters: { Elements: [[], params.map(data => handle(data))] } });
const tParam = (name: string, path: string) => ({ $type: "CMaterialParameterTexture", parameterName: cn(name), texture: rp(path) });
const sParam = (name: string, value: number) => ({ $type: "CMaterialParameterScalar", parameterName: cn(name), scalar: value });
const hParam = (name: string, path: string) => ({ $type: "CMaterialParameterHairParameters", parameterName: cn(name), hairProfile: rp(path) });
const spParam = (name: string, path: string) => ({ $type: "CMaterialParameterSkinParameters", parameterName: cn(name), skinProfile: rp(path) });
const cParam = (name: string, r: number, g: number, b: number) =>
  ({ $type: "CMaterialParameterColor", parameterName: cn(name), color: { $type: "Color", Red: r, Green: g, Blue: b, Alpha: 255 } });
const gParam = (name: string, path: string) => ({ $type: "CMaterialParameterGradient", parameterName: cn(name), gradient: rp(path) });
const gradientRef = (name: string, path: string) => ({ $type: "rRef:CGradient", [name]: rp(path) });
const gradientStop = (value: number, r: number, g: number, b: number) => ({ $type: "rendGradientEntry", value, color: { $type: "Color", Red: r, Green: g, Blue: b, Alpha: 255 } });
/** A morph target with its `baseTexture` rule. */
const morphWithTexture = (baseMesh: string, chunks: number, texture: string | null, parameter: string) => {
  const doc = morphtarget(baseMesh, chunks, [["h011", "eyes"]]) as { Data: { RootChunk: Record<string, unknown> } };
  doc.Data.RootChunk.baseTexture = rp(texture);
  doc.Data.RootChunk.baseTextureParamName = cn(parameter);
  return doc;
};
const skinProfile = (values: { roughness0: number; roughness1: number; lobeMix: number; blurSize: number; falloff: [number, number, number] }) =>
  cr2w({ $type: "CSkinProfile", roughness0: values.roughness0, roughness1: values.roughness1, lobeMix: values.lobeMix, blurSize: values.blurSize,
    diffuse: { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 },
    falloff: { $type: "Color", Red: values.falloff[0], Green: values.falloff[1], Blue: values.falloff[2], Alpha: 255 } });
/** One local head material per (tone, type): only the type's albedo and the shared normal, over the tone's chain. */
const headMaterial = (tone: string, albedo: string) => instance(tone, [tex("Albedo", albedo), tex("Normal", P.skinN)]);
const toneAppearances = (suffix: string) => [TONES.pale, TONES.ivory, TONES.senna].map(tone =>
  ({ name: tone, components: [morphComponent("head", P.headMorph, `${tone.split("__").pop()!}${suffix}`)] }));
/**
 * A mesh whose render chunks all carry one `renderMask`: `MCF_RenderInShadows` alone is a shadow-only proxy (every vanilla hair
 * `*_shadow` mesh), which the scene never draws.
 */
const maskedMesh = (spec: Parameters<typeof mesh>[0], count: number, renderMask: string) => {
  const doc = mesh({ ...spec, chunks: null }) as { Data: { RootChunk: Record<string, unknown> } };
  doc.Data.RootChunk.renderResourceBlob = handle({ $type: "rendRenderMeshBlob", header: { $type: "rendRenderMeshBlobHeader",
    renderChunkInfos: Array.from({ length: count }, () => ({ $type: "rendChunk", lodMask: 1, renderMask })) } });
  return doc;
};
/** A mesh whose render chunks carry LOD masks. */
const lodMesh = (spec: Parameters<typeof mesh>[0], lods: number[]) => {
  const doc = mesh({ ...spec, chunks: null }) as { Data: { RootChunk: Record<string, unknown> } };
  doc.Data.RootChunk.renderResourceBlob = handle({ $type: "rendRenderMeshBlob", header: { $type: "rendRenderMeshBlobHeader",
    renderChunkInfos: lods.map(lodMask => ({ $type: "rendChunk", lodMask })) } });
  return doc;
};

const option = (name: string, resource: string | null, definitions: string[], uiSlot: string, enabled = 1, hidden = 0, link = "None") =>
  appearanceOption(name, resource, definitions, { uiSlot, enabled, hidden, link });
/** A switcher whose choices pick between the options of a creator slot (the piercing style switcher). */
const slotSwitcher = (name: string, uiSlot: string, choices: [string, string[]][]) => {
  const option = switcherOption(name, choices) as { Data: Record<string, unknown> };
  option.Data.uiSlots = [cn(uiSlot)];
  return option;
};
const setupRef = (path: string) => ({ $type: "rRef:Multilayer_Setup", MultilayerSetup: rp(path) });
const maskRef = (path: string) => ({ $type: "rRef:Multilayer_Mask", MultilayerMask: rp(path) });
/** One `Multilayer_Layer` as WolvenKit serializes it. */
const mlLayer = (template: string, opacity: number, names: { colour: string; roughOut?: string }, extra: Record<string, number> = {}) => ({
  $type: "Multilayer_Layer", material: rp(template), colorScale: cn(names.colour), normalStrength: cn("null"), roughLevelsIn: cn("null"),
  roughLevelsOut: cn(names.roughOut ?? "null"), metalLevelsIn: cn("null"), metalLevelsOut: cn("null"), overrides: cn("None"),
  microblend: rp(P.microblend), matTile: extra.matTile ?? 1, mbTile: extra.mbTile ?? 1, microblendContrast: extra.microblendContrast ?? 1,
  microblendNormalStrength: 0, microblendOffsetU: 0, microblendOffsetV: 0, offsetU: 0, offsetV: 0, opacity });
const mlTemplate = (maps: { color: string; normal?: string; roughness?: string }, colours: [string, number[]][], tiling = 1) => cr2w({
  $type: "Multilayer_LayerTemplate", colorTexture: rp(maps.color), normalTexture: rp(maps.normal ?? null), roughnessTexture: rp(maps.roughness ?? null),
  metalnessTexture: rp(P.white), tilingMultiplier: tiling, colorMaskLevelsIn: { Elements: [1, 0] }, colorMaskLevelsOut: { Elements: [0, 0] },
  defaultOverrides: { $type: "Multilayer_LayerOverrideSelection", colorScale: cn(colours[0]![0]), normalStrength: cn("null"), roughLevelsIn: cn("null"),
    roughLevelsOut: cn("null"), metalLevelsIn: cn("null"), metalLevelsOut: cn("null") },
  overrides: { $type: "Multilayer_LayerTemplateOverrides",
    colorScale: colours.map(([n, v]) => ({ $type: "Multilayer_LayerTemplateOverridesColor", n: cn(n), v: { Elements: v } })),
    normalStrength: [{ $type: "Multilayer_LayerTemplateOverridesNormalStrength", n: cn("null"), v: 0.15 }],
    roughLevelsIn: [{ $type: "Multilayer_LayerTemplateOverridesLevels", n: cn("null"), v: { Elements: [1, 0] } }],
    roughLevelsOut: [{ $type: "Multilayer_LayerTemplateOverridesLevels", n: cn("null"), v: { Elements: [1, 0] } },
      { $type: "Multilayer_LayerTemplateOverridesLevels", n: cn("shiny"), v: { Elements: [0.3, 0.2] } }],
    metalLevelsIn: [{ $type: "Multilayer_LayerTemplateOverridesLevels", n: cn("null"), v: { Elements: [1, 0] } }],
    metalLevelsOut: [{ $type: "Multilayer_LayerTemplateOverridesLevels", n: cn("null"), v: { Elements: [1, 0] } }] } });
const FACE_TARGETS: [string, string][] = [["h011", "eyes"], ["h012", "nose"]];
/** The 2.31 `mesh_decal.mt` defaults the family reads (all three target alphas 0). */
const MESH_DECAL_PARAMS = () => [tParam("DiffuseTexture", P.grey), cParam("DiffuseColor", 255, 255, 255), sParam("DiffuseAlpha", 0),
  tParam("SecondaryMask", P.white), sParam("SecondaryMaskInfluence", 0), tParam("NormalTexture", P.editorNormal), sParam("NormalAlpha", 0),
  tParam("NormalAlphaTex", P.white), sParam("UseNormalAlphaTex", 0), sParam("NormalsBlendingMode", 0), tParam("RoughnessTexture", P.white),
  tParam("MetalnessTexture", P.black), sParam("RoughnessMetalnessAlpha", 0)];

export function detailFixture(options: { skinPatch?: boolean; jewellery?: boolean; shadowsInScene?: boolean } = {}): { archives: FixtureArchive[]; installation: () => Installation } {
  const base: FixtureArchive = { virtualPath: "archive/pc/content/basegame_fixture.archive", files: {
    [P.cco]: cco([
      switcherOption("skin_type", [["01", ["skin_type_01"]], ["03", ["skin_type_03"]]]),
      option("skin_type_01", P.skinApp1, [TONES.pale, TONES.ivory, TONES.senna], "skin_type", 1, 0, "skin color"),
      option("skin_type_03", P.skinApp3, [TONES.pale, TONES.ivory, TONES.senna], "skin_type", 1, 0, "skin color"),
      option("eyebrows_color1", P.browApp1, ["brown"], "eyebrows_color"),
      option("eyebrows_color2", P.browApp2, ["dark"], "eyebrows_color", 0),
      option("eyelash_color", P.lashApp, ["brown"], "eyelash_color"),
      option("hair_color1", P.hairApp, ["brown"], "hair_color"),
      option("hair_color_fpp_01", P.hairFppApp, ["default"], "hair_color_fpp", 1, 1),
      option("eyes_color", P.eyeApp, ["gradient_blue", "texture_blue", "layered_design", "swapped_blue"], "eyes_color"),
      switcherOption("makeupLips", [["Off", ["makeupLips_none_00"]], ["05", ["makeupLips_05"]]]),
      option("makeupLips_none_00", null, ["None"], "makeupLips_color", 0),
      option("makeupLips_05", P.lipsApp, [FACE.lipsRed], "makeupLips_color", 0),
      option("makeupCheeks_05", P.cheeksApp, [FACE.cheeksRed], "makeupCheeks_color", 0),
      option("makeupCheeks_01", P.frecklesApp, [FACE.frecklesBrown], "makeupCheeks_color", 0),
      option("facial_tattoo_02", P.tattooApp, ["hx_000_pwa__tattoo_02__01_ca_pale", FACE.tattooSenna], "facial_tattoo", 0, 1, "skin color"),
      option("cyberware_01", P.cyberApp, ["hx_000_pwa__cyberware_01__01_ca_pale", FACE.cyberSenna], "cyberware", 0, 1, "skin color"),
      slotSwitcher("piercings", "piercings_color", [["Common-Off", ["piercings_00"]], ["01", ["piercings_01"]], ["12", ["piercings_12"]]]),
      option("piercings_00", null, ["None"], "piercings_color", 0),
      option("piercings_12", P.earringApp12, [PIERCING.silver, PIERCING.black], "piercings_color", 0, 0, "piercings color"),
      option("piercings_01", P.earringApp1, [PIERCING.silver, PIERCING.black], "piercings_color", 0, 0, "piercings color"),
    ], { TPP: ["skin_type_01", "skin_type_03", "eyebrows_color1", "eyebrows_color2", "eyelash_color", "eyes_color", "facial_tattoo_02"],
      face: ["makeupLips_none_00", "makeupLips_05", "makeupCheeks_05", "makeupCheeks_01", "cyberware_01", "piercings_00", "piercings_01", "piercings_12"], hairs: ["hair_color1"],
      FPP_hairs: ["hair_color_fpp_01"], character_customization: ["skin_type_01", "skin_type_03", "eyebrows_color1", "eyebrows_color2",
        "eyelash_color", "hair_color1", "hair_color_fpp_01", "eyes_color"] }),
    // Skin: the type's .app names the tone's mesh appearance on the one head morph component (plus a part the preview doesn't draw).
    [P.skinApp1]: app(toneAppearances("").map(entry => ({ ...entry, components: [...entry.components, meshComponent("seam_fix", P.shadowMesh)] }))),
    // Skin type 3 also brings the personal-link decal, as every vanilla skin type does.
    [P.skinApp3]: app(toneAppearances("_d03").map(entry => ({ ...entry, components: [...entry.components, morphComponent("personal_link", P.linkMorph, "personal_link")] }))),
    [P.linkMorph]: morphtarget(P.linkMesh, 1, FACE_TARGETS),
    [P.linkMesh]: mesh({ appearances: [{ name: "personal_link", chunkMaterials: ["personal_slot"] }], entries: [{ name: "personal_slot", local: true, index: 0 }],
      local: [instance(P.meshDecalMt, [tex("DiffuseTexture", P.cyberD), scalar("DiffuseAlpha", 1), tex("MetalnessTexture", P.white), scalar("RoughnessMetalnessAlpha", 0.5)])] }),
    // Face details.
    [P.meshDecalMt]: template(MESH_DECAL_PARAMS()), [P.emissiveMt]: template([]),
    [P.lipsApp]: app([{ name: FACE.lipsRed, components: [morphComponent("hx_lips", P.lipsMorph, "red_05")] }]),
    [P.lipsMorph]: morphtarget(P.lipsMesh, 1, FACE_TARGETS),
    [P.lipsMesh]: mesh({ appearances: [{ name: "red_05", chunkMaterials: ["red_05"] }], entries: [{ name: "red_05", local: false, index: 0 }], external: [P.lipsRedMi] }),
    [P.lipsRedMi]: mi(P.meshDecalMt, [tex("DiffuseTexture", P.lipsD), colour("DiffuseColor", 106, 40, 40), scalar("DiffuseAlpha", 0.4), scalar("NormalsBlendingMode", 1)]),
    [P.cheeksApp]: app([{ name: FACE.cheeksRed, components: [morphComponent("hx_freckles", P.freckMorph, "cheeks_red_05")] }]),
    [P.frecklesApp]: app([{ name: FACE.frecklesBrown, components: [morphComponent("hx_freckles", P.freckMorph, "freckles_brown_01")] }]),
    [P.freckMorph]: morphtarget(P.freckMesh, 2, FACE_TARGETS),
    [P.freckMesh]: mesh({ appearances: [{ name: "cheeks_red_05", chunkMaterials: ["cheeks", "cheeks_nose"] }, { name: "freckles_brown_01", chunkMaterials: ["freckles", "freckles_nose"] }],
      entries: [{ name: "cheeks", local: true, index: 0 }, { name: "cheeks_nose", local: true, index: 0 }, { name: "freckles", local: true, index: 1 }, { name: "freckles_nose", local: true, index: 1 }],
      local: [instance(P.meshDecalMt, [tex("DiffuseTexture", P.cheeksD), colour("DiffuseColor", 186, 20, 40), scalar("DiffuseAlpha", 2)]),
        instance(P.meshDecalMt, [tex("DiffuseTexture", P.frecklesD), colour("DiffuseColor", 97, 63, 48), scalar("DiffuseAlpha", 0.3)])] }),
    [P.tattooApp]: app(["hx_000_pwa__tattoo_02__01_ca_pale", FACE.tattooSenna].map(name => ({ name, components: [morphComponent("hx_tattoo", P.tattooMorph, name.split("__").pop()!)] }))),
    [P.tattooMorph]: morphtarget(P.tattooMesh, 1, FACE_TARGETS),
    [P.tattooMesh]: mesh({ appearances: [{ name: "01_ca_pale", chunkMaterials: ["ink_pale"] }, { name: "03_ca_senna", chunkMaterials: ["ink_senna"] }],
      entries: [{ name: "ink_pale", local: true, index: 0 }, { name: "ink_senna", local: true, index: 1 }],
      local: [instance(P.meshDecalMt, [tex("DiffuseTexture", P.tattooD), colour("DiffuseColor", 216, 204, 191), scalar("DiffuseAlpha", 0.7)]),
        instance(P.meshDecalMt, [tex("DiffuseTexture", P.tattooD), colour("DiffuseColor", 119, 115, 110), scalar("DiffuseAlpha", 0.6)])] }),
    [P.cyberApp]: app(["hx_000_pwa__cyberware_01__01_ca_pale", FACE.cyberSenna].map(name => ({ name, components: [morphComponent("hx_cyberware", P.cyberMorph, "cyberware_01")] }))),
    [P.cyberMorph]: morphtarget(P.cyberMesh, 2, FACE_TARGETS),
    [P.cyberMesh]: mesh({ appearances: [{ name: "cyberware_01", chunkMaterials: ["plate", "glow"] }],
      entries: [{ name: "plate", local: true, index: 0 }, { name: "glow", local: true, index: 1 }],
      local: [instance(P.meshDecalMt, [tex("DiffuseTexture", P.cyberD), scalar("DiffuseAlpha", 1), tex("NormalTexture", P.cyberN), scalar("NormalAlpha", 0.425),
        scalar("NormalsBlendingMode", 1), scalar("RoughnessMetalnessAlpha", 1)]), instance(P.emissiveMt, [tex("DiffuseTexture", P.cyberD)])] }),
    [P.lipsD]: xbm(true), [P.cheeksD]: xbm(true), [P.frecklesD]: xbm(true), [P.tattooD]: xbm(true), [P.cyberD]: xbm(true), [P.cyberN]: xbm(false),
    // Piercings: each style's colours are mesh appearances whose chunks derive from a multilayered instance (setup + mask).
    [P.earringApp1]: app([PIERCING.silver, PIERCING.black].map(name => ({ name, components: [morphComponent("earring_01", P.earringMorph,
      name === PIERCING.silver ? "silver" : "black", EARRING_MASK)] }))),
    [P.earringApp12]: app([PIERCING.silver, PIERCING.black].map(name => ({ name, components: [morphComponent("earring_04", P.earringMorph,
      name === PIERCING.silver ? "silver" : "black", "18446744073709551614")] }))),
    [P.earringMorph]: morphtarget(P.earringMesh, 3, [["h015", "ear"]]),
    [P.earringMesh]: mesh({ appearances: [{ name: "silver", chunkMaterials: ["silver__01", "silver__02", "silver__03"] },
        { name: "black", chunkMaterials: ["black__01", "black__02", "black__03"] }],
      entries: [...["silver__01", "silver__02", "silver__03"].map(name => ({ name, local: false, index: 0 })),
        ...["black__01", "black__02", "black__03"].map(name => ({ name, local: false, index: 1 }))], external: [P.silverMi, P.blackMi] }),
    [P.silverMi]: mi(P.layeredMt, [setupRef(P.silverSetup), maskRef(P.earringMask)]),
    [P.blackMi]: mi(P.layeredMt, [setupRef(P.blackSetup), maskRef(P.earringMask)]),
    // Silver: a metal base layer, a hidden layer (opacity 0) and a faint paint layer; black: the paint alone, tinted black, with a roughness override.
    [P.silverSetup]: cr2w({ $type: "Multilayer_Setup", ratio: 1, useNormal: 1, layers: [mlLayer(P.metalTpl, 1, { colour: "silver" }, { matTile: 0.5 }),
      mlLayer(P.metalTpl, 0, { colour: "silver" }), mlLayer(P.paintTpl, 0.07, { colour: "white" })] }),
    [P.blackSetup]: cr2w({ $type: "Multilayer_Setup", ratio: 1, useNormal: 1, layers: [mlLayer(P.paintTpl, 1, { colour: "black", roughOut: "shiny" }),
      mlLayer(P.paintTpl, 1, { colour: "no_such_colour" })] }),
    [P.metalTpl]: mlTemplate({ color: P.metalD, normal: P.metalN, roughness: P.metalR }, [["silver", [0.97, 0.96, 0.92]], ["null", [0.5, 0.5, 0.5]]], 2),
    [P.paintTpl]: mlTemplate({ color: P.paintD }, [["white", [1, 1, 1]], ["black", [0.02, 0.02, 0.02]]]),
    [P.earringMask]: cr2w({ $type: "Multilayer_Mask" }),
    [P.metalD]: xbm(true), [P.metalN]: xbm(false), [P.metalR]: xbm(false), [P.paintD]: xbm(true), [P.microblend]: xbm(false),
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
    // The vanilla eye morph binds a flat editor normal to the eye's `Normal`.
    [P.eyeMorph]: morphWithTexture(P.eyeMesh, 3, P.editorNormal, "Normal"),
    // Index 1 is the dynamic-appearance source for names without "__" (ArchiveXL); it binds the fix copy.
    [P.eyeApp]: app([["gradient_blue", P.eyeMorph], ["mod", P.fixMorph], ["texture_blue", P.eyeMorph], ["layered_design", P.eyeMorph],
      ["swapped_blue", P.eyeMorph]].map(([name, morph]) => ({ name: name!, components: [morphComponent("eyes", morph!, name === "mod" ? "gradient_blue" : name!, EYE_MASK)] }))),
    [P.eyeMesh]: mesh({ appearances: [{ name: "brown", chunkMaterials: ["lashes", "eye", "wetness"] },
        { name: "blood_gradient_black", chunkMaterials: ["lashes", "blood_gradient_black@eyes", "wetness"] },
        { name: "gradient_blue", chunkMaterials: ["lashes", "gradient_blue@eyes", "wetness"] },
        { name: "texture_blue", chunkMaterials: ["lashes", "texture_blue@eyes", "wetness"] },
        { name: "layered_design", chunkMaterials: ["lashes", "layered_design@eyes", "wetness"] },
        // The male mesh's order: wetness in chunk 1, the eye in chunk 2.
        { name: "swapped_blue", chunkMaterials: ["lashes", "wetness", "gradient_blue@eyes"] }],
      entries: [{ name: "lashes", local: true, index: 0 }, { name: "eye", local: true, index: 1 }, { name: "blood_gradient_black@eyes", local: false, index: 0 },
        { name: "gradient_blue@eyes", local: false, index: 0 }, { name: "texture_blue@eyes", local: true, index: 2 },
        { name: "layered_design@eyes", local: true, index: 3 }, { name: "wetness", local: false, index: 1 }],
      external: [P.blueMi, P.shadowMi], local: [
        instance(P.hairMt, [tex("Strand_Alpha", P.lashAlpha), tex("Strand_Gradient", P.white), hp("HairProfile", P.hp),
          scalar("AlphaCutoff", 0), scalar("RoughnessScale", 0), scalar("RoughnessBias", 1)]),
        instance(P.eyeMt), instance(P.eyeMt, [tex("Albedo", P.textureEyeD), tex("Normal", P.textureEyeN)]), instance(P.layeredMt)] }),
    [P.blueMi]: mi(P.eyeGradMt, [tex("Albedo", P.eyeD), gradientRef("IrisColorGradient", P.blueGradient), scalar("BlickScale", 0.1)]),
    [P.shadowMi]: mi(P.eyeShadowMt, [tex("Mask", P.shellMask), colour("ShadowColor", 125, 58, 58), scalar("Intensity", 0.7), scalar("Exponent", 0.8)]),
    // Stored out of order, as the game's gradients are.
    [P.blueGradient]: cr2w({ $type: "CGradient", gradientEntries: [gradientStop(0.785713971, 130, 192, 229), gradientStop(1, 255, 255, 255), gradientStop(0, 22, 22, 22)] }),
    [P.eyeMt]: template([tParam("Albedo", P.white), tParam("Normal", P.eyeN), tParam("Roughness", P.eyeRm), tParam("NormalBubble", P.bubble),
      sParam("RoughnessScale", 0.493420988), sParam("IrisSize", 0.737374008)]),
    [P.eyeGradMt]: template([tParam("Albedo", P.white), tParam("Normal", P.eyeN), tParam("Roughness", P.eyeRm), tParam("NormalBubble", P.bubble),
      tParam("IrisMask", P.irisMask), gParam("IrisColorGradient", P.defaultGradient), sParam("RoughnessScale", 0.493420988)]),
    [P.eyeShadowMt]: template([cParam("ShadowColor", 255, 0, 0), sParam("Exponent", 2.2), sParam("Intensity", 1), tParam("Mask", P.black),
      sParam("WetnessRoughness", 1), sParam("WetnessStrength", 4)]),
    [P.layeredMt]: template([]),
    [P.eyeD]: xbm(true), [P.eyeN]: xbm(false), [P.eyeRm]: xbm(false), [P.irisMask]: xbm(true), [P.bubble]: xbm(false), [P.shellMask]: xbm(false),
    [P.textureEyeD]: xbm(true), [P.textureEyeN]: xbm(true), [P.editorNormal]: xbm(false),
    [P.hairApp]: app([{ name: "brown", components: [meshComponent("hair", P.hairMesh, "brown"), meshComponent("hair_shadow", P.shadowMesh)] }]),
    [P.hairFppApp]: app([{ name: "default", components: [meshComponent("hair_fpp", P.shadowMesh)] }]),
    [P.hairMesh]: lodMesh({ appearances: [{ name: "brown", chunkMaterials: ["long", "cap", "long"] }],
      entries: [{ name: "long", local: true, index: 0 }, { name: "cap", local: true, index: 1 }], local: [
        instance(P.hairMt, [tex("Strand_Alpha", P.strandA), tex("Strand_ID", P.strandId), tex("Strand_Gradient", P.strandG),
          hp("HairProfile", P.hp), scalar("ShadowStrength", 0.9), scalar("ShadowMin", -0.4)]),
        instance(P.capMt, [tex("MaskTexture", P.capMask), tex("GradientMap", P.grad), scalar("DiffuseAlpha", 1)])] }, [1, 1, 2]),
    // A shadow proxy: a glass chunk and a layered chunk that only cast shadows, like every vanilla hair shadow mesh, so neither is drawn.
    // With `shadowsInScene` its chunks draw in the scene (as a CCXL hair's one-triangle proxy does): the layered one is then drawn.
    [P.shadowMesh]: maskedMesh({ appearances: [{ name: "default", chunkMaterials: ["glass", "shadow_layer"] }],
      entries: [{ name: "glass", local: true, index: 0 }, { name: "shadow_layer", local: true, index: 1 }],
      local: [instance(P.glassMt), instance(P.layeredMt, [setupRef(P.silverSetup), maskRef(P.earringMask)])] }, 2,
      options.shadowsInScene ? "MCF_RenderInScene" : "MCF_RenderInShadows"),
    [P.hairMt]: template([tParam("Strand_ID", P.grey), tParam("Strand_Gradient", P.grey), tParam("Strand_Alpha", P.grey),
      sParam("AlphaCutoff", 0.33), sParam("RoughnessScale", 1), hParam("HairProfile", P.hp)]),
    [P.decalMt]: template([tParam("DiffuseTexture", P.white), sParam("UseGradientMap", 0), sParam("GradientMapIntensity", 1),
      sParam("SecondaryDiffuseAlphaIntensity", 0.7), sParam("GradientMapUV", 1)]),
    [P.capMt]: template([tParam("MaskTexture", P.white), sParam("DepthThreshold", 0.5)]),
    [P.browD]: xbm(true), [P.browDs]: xbm(true), [P.grad]: xbm(true), [P.lashAlpha]: xbm(false), [P.white]: xbm(false), [P.grey]: xbm(false),
    [P.strandA]: xbm(false), [P.strandId]: xbm(false), [P.strandG]: xbm(false), [P.capMask]: xbm(false), [P.hp]: profile(60),
  } };
  // An ArchiveXL-style bundle: the null morph whose empty `baseTexture` its patch copies onto the fix copy.
  const bundle: FixtureArchive = { virtualPath: "red4ext/plugins/ArchiveXL/Bundle/ArchiveXL.archive", files: {
    [P.nullMorph]: cr2w({ $type: "MorphTargetMesh", baseMesh: rp(null), baseTexture: rp(null), baseTextureParamName: cn("None"), targets: [] }) } };
  // A CCXL-style eye pack: one colour on the eye slot, built from the app's "mod" appearance, its patch mesh's
  // `@eyes` template naming soft texture paths from the colour's name.
  const pack: FixtureArchive = { virtualPath: "archive/pc/mod/fixture_pack.archive", provider: "mo2-mod", providerName: "Fixture eye pack", priority: 3, files: {
    [P.packCco]: cco([appearanceOption("", null, ["pack_eye_01"], { uiSlot: "eyes_color" }),
      appearanceOption("pack_liner", P.packLinerApp, [FACE.packLiner], { uiSlot: "pack_liner", enabled: 0 })], { face: ["pack_liner"] }),
    [P.packLinerApp]: app([{ name: FACE.packLiner, components: [morphComponent("pack_liner", P.packLinerMorph, "black")] }]),
    [P.packLinerMorph]: morphtarget(P.packLinerMesh, 1, FACE_TARGETS),
    [P.packLinerMesh]: mesh({ appearances: [{ name: "black", chunkMaterials: ["liner"] }], entries: [{ name: "liner", local: true, index: 0 }],
      local: [instance(P.packFrontMt, [tex("DiffuseTexture", P.packLinerD), colour("DiffuseColor", 20, 20, 20), scalar("DiffuseAlpha", 1),
        scalar("RoughnessMetalnessAlpha", 1)])] }),
    // A copy of the vanilla decal template at the pack's own path: same name (so the same programs), front priority.
    [P.packFrontMt]: namedTemplate("mesh_decal", "EMP_Front", MESH_DECAL_PARAMS()),
    [P.packLinerD]: xbm(true),
    [P.packPatch]: mesh({ appearances: [{ name: "pack_eye_01", chunkMaterials: [], tags: ["blood_gradient_black"] }],
      entries: [{ name: "@eyes", local: true, index: 0 }],
      local: [instance(P.eyeMt, [tex("Albedo", "*fixture_pack\\tex\\{material}_d.xbm"), tex("Normal", "*fixture_pack\\tex\\{material}_n.xbm")])] }),
    [P.packD]: xbm(true), [P.packN]: xbm(false),
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
  // A jewellery framework: it replaces style 12's `.app` at its vanilla path (no ArchiveXL, no creator resource), keeping the vanilla part
  // and adding three inline slot components whose placeholder morph targets have zero render chunks.
  const jewellery: FixtureArchive = { virtualPath: "archive/pc/mod/fixture_jewellery_framework.archive", provider: "mo2-mod", providerName: "Fixture jewellery",
    priority: 4, files: {
      [P.earringApp12]: app([PIERCING.silver, PIERCING.black].map(name => { const look = name === PIERCING.silver ? "silver" : "black";
        return { name, components: [morphComponent("earring_04", P.earringMorph, look, "18446744073709551613"),
          ...[1, 2, 3].map(n => morphComponent(`slot${n}`, P.slotMorph(n), look))] }; })),
      ...Object.fromEntries([1, 2, 3].map(n => [P.slotMorph(n), morphtarget(P.earringMesh, 0, [["h015", "ear"]])])),
    } };
  // An item archive that fills slot 2 at the framework's own path; it wins that path by sorting first (the default archive order), over a linked mesh with the same colour names.
  const item: FixtureArchive = { virtualPath: "archive/pc/mod/fixture_jewellery_a_item.archive", provider: "mo2-mod", providerName: "Fixture item",
    priority: 5, files: {
      [P.slotMorph(2)]: morphtarget(P.slotMesh, 1, [["h012", "nose"]]),
      [P.slotMesh]: mesh({ appearances: [{ name: "silver", chunkMaterials: ["silver__01"] }, { name: "black", chunkMaterials: ["black__01"] }],
        entries: [{ name: "silver__01", local: false, index: 0 }, { name: "black__01", local: false, index: 1 }], external: [P.silverMi, P.blackMi] }),
    } };
  const archives = [...(options.skinPatch ? [base, bundle, mod, pack, framework] : [base, bundle, mod, pack]), ...(options.jewellery ? [jewellery, item] : [])];
  const xl: XlDocument[] = [
    // The eye app gets ArchiveXL's dynamic customization appearances; the fix copy of the eye morph drops its base texture.
    { id: "red4ext/plugins/ArchiveXL/Bundle/EyesFix.xl", document: { resource: { scope: { "player_customization.app": [P.eyeApp] },
      copy: { [P.eyeMorph]: P.fixMorph }, patch: { [P.nullMorph]: { props: ["baseTexture", "baseTextureParamName"], targets: [P.fixMorph] } } } } },
    { id: "archive/pc/mod/fixture_pack.xl", document: { customizations: { female: P.packCco },
      resource: { patch: { [P.packPatch]: { props: ["appearances"], targets: [P.eyeMesh] } } } } },
    ...(options.skinPatch ? [{ id: "archive/pc/mod/fixture_framework.xl",
      document: { resource: { patch: { [P.donorMesh]: { props: ["appearances"], targets: [P.headMesh] } } } } }] : []),
  ];
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
/**
 * V "A": skin type 1 in pale, brow style 1, lashes, hair 1 (with its FPP twin in its own group), the gradient blue eye, red lipstick
 * and red blush (listed in the creator group too, as saves repeat them).
 */
export const REQUEST_A = saved([["TPP", "skin_type_01", P.skinApp1, TONES.pale], ["TPP", "eyebrows_color1", P.browApp1, "brown"],
  ["TPP", "eyelash_color", P.lashApp, "brown"], ["TPP", "eyes_color", P.eyeApp, "gradient_blue"],
  ["hairs", "hair_color1", P.hairApp, "brown"], ["FPP_hairs", "hair_color_fpp_01", P.hairFppApp, "default"],
  ["character_customization", "eyebrows_color1", P.browApp1, "brown"], ["character_customization", "makeupLips_05", P.lipsApp, FACE.lipsRed],
  ["character_customization", "piercings_01", P.earringApp1, PIERCING.silver],
  ["face", "makeupLips_05", P.lipsApp, FACE.lipsRed], ["face", "makeupCheeks_05", P.cheeksApp, FACE.cheeksRed], ["face", "piercings_01", P.earringApp1, PIERCING.silver]]);
/**
 * V "B": skin type 3 in senna (with its personal-link decal), the mod's brow style, lashes, no hair at all, the eye pack's colour,
 * freckles, a tattoo and face cyberware in the senna tone, and the pack's own makeup option.
 */
export const REQUEST_B = saved([["TPP", "skin_type_03", P.skinApp3, TONES.senna], ["TPP", "eyebrows_color2", P.browApp2, "dark"],
  ["TPP", "eyelash_color", P.lashApp, "brown"], ["TPP", "eyes_color", P.eyeApp, "pack_eye_01"],
  ["face", "makeupCheeks_01", P.frecklesApp, FACE.frecklesBrown], ["TPP", "facial_tattoo_02", P.tattooApp, FACE.tattooSenna],
  ["face", "cyberware_01", P.cyberApp, FACE.cyberSenna], ["face", "pack_liner", P.packLinerApp, FACE.packLiner]]);
/** A save-shaped request for one eye colour alone (the other slots none). */
export const eyeRequest = (definition: string) => saved([["TPP", "eyes_color", P.eyeApp, definition]]);
/** A save-shaped request for one piercing choice alone (the other slots none). */
export const piercingRequest = (option: "piercings_01" | "piercings_12", definition: string) =>
  saved([["face", option, option === "piercings_01" ? P.earringApp1 : P.earringApp12, definition]]);
