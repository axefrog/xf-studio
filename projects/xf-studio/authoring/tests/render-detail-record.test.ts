import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { CHARACTER_DETAIL_SCHEMA, DETAIL_SLOTS, parseCharacterDetail, parseCoreDetail, parseRenderDetail, RENDER_DETAIL_SCHEMA, type CharacterDetail } from "../src/render-detail";

const sha = (c: string) => c.repeat(64);
const resource = (file: string, c = "a") => ({ file, sha256: sha(c), sources: [{ depotPath: "base\\x.mesh", archive: "basegame.archive", provider: "Installed game" }] });
const texture = () => ({ ...resource(`${sha("b")}.png`, "b"), depotPath: "base\\t.xbm", width: 4, height: 2, isGamma: true });
const character = (): CharacterDetail => ({
  schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: sha("c"), origin: "game-files",
  character: { source: "save", bodyGender: "female" }, provenance: { label: "Your game's installed files", notes: [], tool: "WolvenKit CLI 9.0.1" },
  components: [{ id: "skin:head:2", slot: "skin", option: "skin_type_03", definition: "h0_000_pwa__basehead__03_ca_senna", component: "head",
    geometry: { ...resource(`${sha("e")}.glb`, "e"), depotPath: "base\\head.morphtarget", depotHash: "2", morphTargets: true },
    renderChunks: 1, chunks: [0], materials: [
      { chunk: 0, name: "senna_d03", template: "base\\materials\\skin.mt", templateName: "skin", materialPriority: "EMP_Normal", scalars: { TintScale: 0.7 }, colours: { TintColor: [202, 177, 153, 255] },
        textures: { Albedo: texture() }, profiles: {}, skinProfiles: { SkinProfile: { depotPath: "engine\\materials\\defaults\\default.sp",
          archive: "basegame_1_engine.archive", sha256: null, roughness0: 0.966, roughness1: 1.597, lobeMix: 1, blurSize: 1.4,
          diffuse: [255, 255, 255], falloff: [255, 178, 165] } }, gradients: {} }] },
    { id: "face:hx_lips:4", slot: "face", option: "makeupLips_05", definition: "hx_000_pwa__basehead__makeup_lips_05__06_red", component: "hx_lips",
    geometry: { ...resource(`${sha("a")}.glb`, "a"), depotPath: "base\\lips.morphtarget", depotHash: "4", morphTargets: true },
    renderChunks: 2, chunks: [0, 1], materials: [
      { chunk: 0, name: "red_05", template: "base\\materials\\mesh_decal.mt", templateName: "mesh_decal", materialPriority: "EMP_Normal",
        scalars: { DiffuseAlpha: 0.4, NormalsBlendingMode: 1 }, colours: { DiffuseColor: [106, 40, 40, 255] },
        textures: { DiffuseTexture: texture() }, profiles: {}, skinProfiles: {}, gradients: {} },
      // A decal template the preview doesn't draw yet: recorded (so the renderer can say so), with no inputs.
      { chunk: 1, name: "glow", template: "base\\materials\\mesh_decal_emissive.mt", templateName: null, materialPriority: null,
        scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {} }] },
    { id: "hair:hair:1", slot: "hair", option: "hair_color1", definition: "brown", component: "hair",
    geometry: { ...resource(`${sha("d")}.glb`, "d"), depotPath: "base\\hair.mesh", depotHash: "1", morphTargets: false },
    renderChunks: 3, chunks: [0, 1], materials: [
      { chunk: 0, name: "long", template: "base\\materials\\hair.mt", templateName: "hair", materialPriority: null, scalars: { AlphaCutoff: 0 }, colours: {},
        textures: { Strand_Alpha: texture() }, profiles: { HairProfile: { depotPath: "base\\p.hp", archive: "mod.archive", sha256: null, sampleCount: 127,
          id: [{ value: 0.5, color: [1, 2, 3] }], rootToTip: [{ value: 0, color: [4, 5, 6] }] } }, skinProfiles: {}, gradients: {} },
      { chunk: 1, name: "cap", template: "base\\materials\\mesh_decal_gradientmap_recolor.mt", templateName: null, materialPriority: null, scalars: {}, colours: { DiffuseColor: [255, 255, 255, 255] },
        textures: {}, profiles: {}, skinProfiles: {}, gradients: {} }] },
    { id: "eyes:eyes:3", slot: "eyes", option: "eyes_color", definition: "gradient_blue", component: "eyes",
    geometry: { ...resource(`${sha("f")}.glb`, "f"), depotPath: "base\\eye.morphtarget", depotHash: "3", morphTargets: true },
    morphTexture: { morph: "base\\eye.morphtarget", texture: "engine\\textures\\editor\\normal.xbm", parameter: "Normal" },
    renderChunks: 3, chunks: [1, 2], materials: [
      { chunk: 1, name: "gradient_blue@eyes", template: "base\\materials\\eye_gradient.mt", templateName: "eye_gradient", materialPriority: "EMP_Normal", scalars: { RoughnessScale: 0.49 }, colours: {},
        textures: { Albedo: texture(), IrisMask: texture() }, profiles: {}, skinProfiles: {}, gradients: { IrisColorGradient: { depotPath: "base\\eye_blue.gradient",
          archive: "basegame.archive", sha256: null, stops: [{ value: 0, color: [22, 22, 22, 255] }, { value: 0.79, color: [130, 192, 229, 255] }] } } },
      { chunk: 2, name: "wetness", template: "base\\materials\\eye_shadow.mt", templateName: "eye_shadow", materialPriority: "EMP_Front", scalars: { Intensity: 0.7 }, colours: { ShadowColor: [125, 58, 58, 255] },
        textures: { Mask: texture() }, profiles: {}, skinProfiles: {}, gradients: {} }] }],
  slots: [{ slot: "skin", state: "shown", label: "senna, skin type 3" }, { slot: "face", state: "shown", label: "lipstick (red)" }, { slot: "brows", state: "none", label: "None" }, { slot: "lashes", state: "unavailable", label: "brown", message: "Your V's eyelashes aren't shown." },
    { slot: "hair", state: "shown", label: "brown" }, { slot: "eyes", state: "shown", label: "gradient blue" }],
});
const core = () => ({ schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: "k", origin: "game-files", provenance: { label: "l", notes: [] },
  geometry: { ...resource("head.glb"), nodes: { head: "head", plate: "makeup_plate", eyes: "eyes" }, morphs: [] },
  textures: Object.fromEntries(["head.albedo", "head.normal", "head.roughness", "eyes.albedo"].map(slot => [slot, resource("head-color.png")])) });

describe("render record versions", () => {
  test("v4 carries the character record with its face details and each chunk's template identity; parsing is strict and lossless", () => {
    const record = character();
    expect(CHARACTER_DETAIL_SCHEMA).toBe("xfs/render-detail-4");
    expect(DETAIL_SLOTS).toEqual(["skin", "face", "brows", "lashes", "hair", "eyes"]);
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(parseRenderDetail(record)).toEqual(record);
  });

  test("v1 stays the core head, and a v4 reader accepts it under every version; v2 and v3 characters are refused plainly", () => {
    expect(parseRenderDetail(core())).toMatchObject({ detail: "core-head" });
    expect(parseCoreDetail({ ...core(), schema: CHARACTER_DETAIL_SCHEMA })).toMatchObject({ detail: "core-head" });
    expect(parseCoreDetail({ ...core(), schema: "xfs/render-detail-2" })).toMatchObject({ detail: "core-head" });
    expect(parseCoreDetail({ ...core(), schema: "xfs/render-detail-3" })).toMatchObject({ detail: "core-head" });
    expect(() => parseRenderDetail({ ...core(), schema: "xfs/render-detail-5" })).toThrow("unsupported record version");
    // A v3 character record (no face details, no template identities) is prepared again, never read.
    expect(() => parseRenderDetail({ ...character(), schema: "xfs/render-detail-3" })).toThrow("retired");
    // A v2 character record (no eyes, no gradients) is prepared again, never read.
    expect(() => parseRenderDetail({ ...character(), schema: "xfs/render-detail-2" })).toThrow("retired");
    // A character record is never read as v1.
    expect(() => parseCharacterDetail({ ...character(), schema: RENDER_DETAIL_SCHEMA })).toThrow();
  });

  test("shapes the loader must never see are refused", () => {
    const bad = (mutate: (record: CharacterDetail) => void) => { const record = character(); mutate(record); return () => parseCharacterDetail(record); };
    const hair = (r: CharacterDetail) => r.components[2]!;
    expect(bad(r => { hair(r).materials[0]!.chunk = 2; })).toThrow("hidden chunk");
    expect(bad(r => { hair(r).chunks = [0, 0]; })).toThrow("twice");
    expect(bad(r => { hair(r).chunks = [5]; })).toThrow();
    expect(bad(r => { hair(r).geometry.file = "../x.glb"; })).toThrow("plain asset file name");
    expect(bad(r => { (hair(r).materials[0]!.textures.Strand_Alpha as { isGamma?: boolean }).isGamma = undefined; })).toThrow("colour flag");
    expect(bad(r => { hair(r).materials[1]!.colours.DiffuseColor = [256, 0, 0, 0]; })).toThrow();
    expect(bad(r => { hair(r).materials[0]!.profiles.HairProfile!.sampleCount = 1; })).toThrow();
    expect(bad(r => { r.slots = r.slots.slice(1); })).toThrow("slot outcomes");
    expect(bad(r => { r.slots[2] = { slot: "brows", state: "shown", label: "x" }; })).toThrow("shown without components");
    // Skin profiles: every chunk carries the map (possibly empty); values stay in range and colours are RGB bytes.
    expect(bad(r => { delete (hair(r).materials[0] as { skinProfiles?: unknown }).skinProfiles; })).toThrow("skin profiles is missing");
    expect(bad(r => { r.components[0]!.materials[0]!.skinProfiles.SkinProfile!.lobeMix = -1; })).toThrow("lobe mix");
    expect(bad(r => { (r.components[0]!.materials[0]!.skinProfiles.SkinProfile as { falloff: number[] }).falloff = [255, 0]; })).toThrow("RGB");
    // A v2 record written before the skin slot joined has no skin outcome and is refused (it is prepared again).
    expect(bad(r => { r.slots = r.slots.filter(slot => slot.slot !== "skin"); })).toThrow("slot outcomes");
    expect(bad(r => { (r.character as { source: string }).source = "ui"; })).toThrow();
    // Gradients: sorted RGBA stops in range; every chunk carries the map; the morph texture rule is well formed.
    const eyes = (r: CharacterDetail) => r.components[3]!;
    expect(bad(r => { eyes(r).materials[0]!.gradients.IrisColorGradient!.stops.reverse(); })).toThrow("not sorted");
    expect(bad(r => { (eyes(r).materials[0]!.gradients.IrisColorGradient!.stops[0] as { color: number[] }).color = [1, 2, 3]; })).toThrow();
    expect(bad(r => { eyes(r).materials[0]!.gradients.IrisColorGradient!.stops[0]!.value = 2; })).toThrow();
    expect(bad(r => { delete (eyes(r).materials[1] as { gradients?: unknown }).gradients; })).toThrow("gradients is missing");
    expect(bad(r => { (eyes(r) as { morphTexture: unknown }).morphTexture = "normal"; })).toThrow("morph texture rule");
    expect(bad(r => { r.slots = r.slots.filter(slot => slot.slot !== "eyes"); })).toThrow("slot outcomes");
    // Face details: every chunk names its template's own name and priority (null when unread), in the engine's enum form.
    const face = (r: CharacterDetail) => r.components[1]!;
    expect(bad(r => { r.slots = r.slots.filter(slot => slot.slot !== "face"); })).toThrow("slot outcomes");
    expect(bad(r => { (face(r).materials[0] as { materialPriority: string }).materialPriority = "front"; })).toThrow("priority");
    expect(bad(r => { delete (face(r).materials[0] as { templateName?: unknown }).templateName; })).toThrow("template name");
    expect(bad(r => { (face(r).materials[0] as { templateName: string }).templateName = "mesh_decal/x"; })).toThrow("template name");
  });
});

// The skin, brows, lashes and hair rendering path must follow resolved data only: no mod names, no saved
// appearance hashes or definitions, no per-mod manifests or developer-prepared asset paths. Piercings
// still use their manifests (a documented follow-on), so their lines are the only exception in scene.ts and its evidence.
// Complexion mods and texture frameworks work through archive precedence and ArchiveXL patches, so none of
// their names, archives or donor paths may appear either, nor any particular skin type or tone.
describe("rendering boundary", () => {
  const RENDERING_PATH = ["scene", "render-detail", "render-templates", "character-detail-plan", "character-detail-request",
    "character-detail-service", "character-detail-host", "character-detail-server", "character-detail-loader", "character-detail-actions",
    "character-material-adapters", "browser-character-detail-device", "brow-material", "hair-shading", "hair-colour-model",
    "browser-head-attachment", "browser-scene-preview-ports", "material-template", "skin-material", "head-surface", "eye-material",
    "scene-evidence", "detail-limits", "resource-graph", "character-resolver", "face-decal-material", "decal-underlay", "head-skin-placement",
    "plate-blend"];
  const PER_MOD = new RegExp(String.raw`arkhe|icxrus|softnatural|mel_ccxl|meluminary|island_dancer|alliekat|preemhair|eagul|\bprc\b|kala|brown_ombre|ash_brown|10_brown|38_ash|05_brown|\/assets\/(?:brows|lashes|hair)\b|brows\.glb|lashes\.glb|local-hair-assets|lash-profile-preview|brow-preview-1|\b\d{17,20}\b|universalskintone|complexion|ks_uv|ks_donor|uv_framework|uv4\.xl|facialcustomizationfix|xbaebsae|warmsmooth|wa_head_overlay|wa_head_glow|4k\\\\common|_ca_pale|_ca_senna|_bl_espresso|_bl_dark|skin_type_0\d|basehead_d0\d|nutboy|brocreate|photoreal|unique_eyes|unique eyes|pit_eyes|forbidden_eyes|forbidden eyes|beautiful_iris|beautiful iris|beautiful_exotic|heterochrom|ccxl_eye|eye_\d\d_|\/assets\/eyes\b|local-eye-assets|eye-appearance|eye-optics|he_000_base|eye_mask\.xbm|eye_shadow_mask|gradient_(?:light_)?blue|gradient_brown|rebecca|cybereye|eye_blue|eye_red|eye_brown|` +
    // Face details: no option, definition, mesh, material or archive of a particular makeup, scar, tattoo, cyberware or
    // CCXL pack (the legacy XF selectors included). Creator slot names (`makeupLips_color`) are the game's slot rules.
    String.raw`makeup(?:Eyes|Lips|Cheeks|Pimples)_(?:\d|none|glossy|matte)|facial_tattoo_\d|cyberware_\d|beard_color\d|hx_000|` +
    String.raw`makeup_(?:lips|eyes|freckles|cheeks)_\d|pimples_\d|personal_slot|scars_\d|tattoo_\d|\bxfea|axefrog|eye.artistry.ccxl|_emp_front|` +
    String.raw`red_08|cheeks_red|frecles|freckles_brown|lips_color__|makeup_color__`, "i");
  test("the face-detail identifiers the boundary looks for: particular choices and packs, never the game's slots or templates", () => {
    for (const offending of ["xfea_layer1_e04", "base\\axefrog\\xf-eye-artistry-ccxl\\xfea.mesh", "makeupLips_glossy_08", "makeupCheeks_09",
      "hx_000_pwa__basehead_makeup_lips_01", "mesh_decal__emp_front.mt", "cyberware_03", "facial_tattoo_02", "lips_color__06_red_02.mi"])
      expect(PER_MOD.test(offending)).toBe(true);
    for (const allowed of ["makeupLips_color", "makeupEyes_color", "cyberware", "facial_tattoo", "mesh_decal", "mesh_decal_double_diffuse", "EMP_Front", "face", "TPP"])
      expect(PER_MOD.test(allowed)).toBe(false);
  });

  test("no per-mod or per-choice identifiers remain in the skin, face details, eyes, brows, lashes and hair rendering path", () => {
    for (const name of RENDERING_PATH) {
      const lines = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8").split("\n");
      // The all-chunks mask (every bit set) is a format constant, not a saved identity.
      const offending = lines.map((line, index) => ({ line, index })).filter(({ line }) => PER_MOD.test(line.replaceAll("18446744073709551615", "")) &&
        !((name === "scene" || name === "scene-evidence") && /piercing|prc/i.test(line)) && !/^\s*(?:\/\/|\/?\*)/.test(line));
      expect(offending.map(({ line, index }) => `${name}.ts:${index + 1}: ${line.trim()}`)).toEqual([]);
    }
  });

  test("the removed per-mod manifest modules stay removed and nothing imports the study fixture", () => {
    const files = readdirSync(new URL("../src/", import.meta.url));
    // The hand-made single-eye manifest and its roughness helper went with rank 1 of the eye plan.
    for (const gone of ["hair-preview.ts", "lash-profile.ts", "depot-resolution.ts", "eye-appearance.ts", "eye-optics.ts"]) expect(files).not.toContain(gone);
    for (const name of RENDERING_PATH)
      for (const study of ["brow-study-fixture", "eye-study-fixture"]) expect(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), "utf8")).not.toContain(study);
  });
});
