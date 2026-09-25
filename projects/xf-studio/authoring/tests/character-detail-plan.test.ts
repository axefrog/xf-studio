import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState } from "../src/cco-model";
import { characterRequestFor, characterRequestFromSave, DEFAULT_CHARACTER, inputFromCharacterRequest, parseCharacterRequest } from "../src/character-detail-request";
import { choiceLabel, planCharacterDetails, skinLabel, type TemplateIdentities } from "../src/character-detail-plan";
import { templateIdentity } from "../src/character-detail-service";
import { loadMergedCco, resolveCharacter, type ResolvedParam } from "../src/character-resolver";
import { refFromPath, refLabel } from "../src/depot-path";
import { templateDefaults } from "../src/material-template";
import { renderTemplate } from "../src/render-templates";
import type { SavedV } from "../src/save-reader";
import { detailFixture, EYE_MASK, eyeRequest, FACE, P, REQUEST_A, REQUEST_B, TONES } from "./character-detail-fixtures";

async function plan(request: typeof REQUEST_A | "default", fixture = detailFixture(), state: Record<string, string> = {}) {
  const { graph } = fixture.installation();
  const cco = await loadMergedCco(graph, "female");
  const input = request === "default"
    ? (() => { const d = descriptorsFromUiState(cco.merged.cco, state); return { bodyGender: "female" as const, origin: "ui-state" as const, appearances: d.appearances, morphs: d.morphs }; })()
    : inputFromCharacterRequest(request as Extract<typeof REQUEST_A, { source: "save" }>);
  const resolved = await resolveCharacter(graph, input, cco);
  const defaults = new Map<string, ResolvedParam[]>();
  const identities = new Map<string, { name: string | null; priority: string | null }>() as Map<string, { name: string | null; priority: string | null }>;
  for (const path of [P.hairMt, P.decalMt, P.capMt, P.skinMt, P.eyeMt, P.eyeGradMt, P.eyeShadowMt, P.layeredMt, P.meshDecalMt, P.emissiveMt, P.packFrontMt]) {
    const loaded = await graph.load(refFromPath(path), "mt");
    identities.set(path.toLowerCase(), templateIdentity(loaded!.root));
    defaults.set(path.toLowerCase(), templateDefaults(loaded!.root).map(([name, value]) => ({ name, kind: value.kind, setBy: "template",
      value: value.kind === "scalar" ? JSON.stringify(value.value) : value.kind === "resource" ? value.text ?? "" : value.value,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })));
  }
  return { resolved, plan: planCharacterDetails(resolved, cco.merged.cco, defaults, identities satisfies TemplateIdentities) };
}

describe("resolver selection for brows, lashes and hair", () => {
  test("slots come from the creator's uiSlot and the third-person groups; FPP twins and shadow meshes stay out", async () => {
    const { plan: result } = await plan(REQUEST_A);
    expect(result.slots).toEqual([{ slot: "skin", state: "shown", label: "pale, skin type 1" },
      { slot: "face", state: "shown", label: "lipstick (red), cheeks (red)" }, { slot: "brows", state: "shown", label: "brown" },
      { slot: "lashes", state: "shown", label: "brown" }, { slot: "hair", state: "shown", label: "brown" },
      { slot: "eyes", state: "shown", label: "gradient blue" }, { slot: "piercings", state: "shown", label: "style 01, silver" }]);
    expect(result.components.map(c => `${c.slot}:${c.option}:${c.component}`)).toEqual(
      ["skin:skin_type_01:head", "face:makeupLips_05:hx_lips", "face:makeupCheeks_05:hx_freckles", "brows:eyebrows_color1:brow",
        "lashes:eyelash_color:eyes", "hair:hair_color1:hair", "eyes:eyes_color:eyes", "piercings:piercings_01:earring_01"]);
    const hair = result.components.find(c => c.slot === "hair")!;
    // Chunk 2 is a lower level of detail; the shadow mesh draws only glass.mt, which the preview does not draw.
    expect(hair.chunks).toEqual([0, 1]);
    expect(hair.materials.map(m => m.template)).toEqual([P.hairMt, P.capMt]);
    expect(hair.morphTargets).toBe(false);
    // Lashes: only chunk 0 of the shared eye mesh is visible (chunk mask), and its template is hair.mt.
    const lashes = result.components.find(c => c.slot === "lashes")!;
    expect(lashes.chunks).toEqual([0]);
    expect(lashes.drawnFrom.ref.path).toBe(P.eyeMorph);
    expect(lashes.morphTargets).toBe(true);
  });

  test("chunk inputs are the instance chain first, then the template's defaults, limited to what the adapter reads", async () => {
    const { plan: result } = await plan(REQUEST_A);
    const lash = result.components.find(c => c.slot === "lashes")!.materials[0]!;
    // Strand_ID is not set by the instance: the template's grey placeholder applies, as in the vanilla lashes.
    expect(Object.fromEntries(Object.entries(lash.textures).map(([name, p]) => [name, refLabel(p.ref)])))
      .toEqual({ Strand_Alpha: P.lashAlpha, Strand_Gradient: P.white, Strand_ID: P.grey });
    expect(lash.scalars).toMatchObject({ AlphaCutoff: 0, RoughnessScale: 0, RoughnessBias: 1 });
    expect(refLabel(lash.profiles.HairProfile!.ref)).toBe(P.hp);
    const brow = result.components.find(c => c.slot === "brows")!.materials[0]!;
    expect(brow.colours.SecondaryDiffuseColor).toEqual([62, 49, 42, 255]);
    expect(brow.scalars).toMatchObject({ UseGradientMap: 1, GradientMapIntensity: 0.5, SecondaryDiffuseAlphaIntensity: 0.7, GradientMapUV: 1 });
    expect(Object.keys(brow.textures).sort()).toEqual(["DiffuseTexture", "GradientMap", "SecondaryDiffuseAlpha"]);
    // Only the adapter's inputs are exported: the template's other textures are not.
    expect(renderTemplate(P.decalMt)!.textures).toEqual(["DiffuseTexture", "SecondaryDiffuseAlpha", "GradientMap"]);
  });

  test("a V without hair has none, and a mod's brow style resolves through the same rules", async () => {
    const { plan: result } = await plan(REQUEST_B);
    expect(result.slots.find(s => s.slot === "hair")).toEqual({ slot: "hair", state: "none", label: "None" });
    const brow = result.components.find(c => c.slot === "brows")!;
    expect(brow.option).toBe("eyebrows_color2");
    expect(refLabel(brow.materials[0]!.textures.DiffuseTexture!.ref)).toBe(P.browD2);
    expect(brow.materials[0]!.textures.DiffuseTexture!.archive).toBe("fixture_mod.archive");
  });

  test("the default V comes from the effective creator resource's UI state", async () => {
    const { plan: result } = await plan("default");
    expect(result.components.map(c => c.option)).toEqual(["skin_type_01", "eyebrows_color1", "eyelash_color", "hair_color1", "eyes_color"]);
    // The creator's first eye colour, as a new V starts with.
    expect(result.components.find(c => c.slot === "eyes")!.definition).toBe("gradient_blue");
    expect(result.components[0]!.definition).toBe(TONES.pale);
  });

  test("an appearance the installation lacks is unavailable with one plain line", async () => {
    const missing = { ...REQUEST_A, appearances: [{ group: "TPP", option: "eyebrows_color1", app: refFromPath("base\\fixture\\gone.app").hash, definition: "brown" }] };
    const { plan: result } = await plan(missing as typeof REQUEST_A);
    const brows = result.slots.find(s => s.slot === "brows")!;
    expect(brows.state).toBe("unavailable");
    expect(brows.message).toBe("Your V's eyebrows (brown) aren't in your installed game files, so they aren't shown.");
  });

  test("plain skin labels: tone name and skin type, without index numbers or group codes", () => {
    expect(skinLabel("skin_type_05", TONES.ivory)).toBe("pale warm ivory, skin type 5");
    expect(skinLabel("skin_type_03", TONES.senna)).toBe("senna, skin type 3");
    expect(skinLabel("skin_type_01", "h0_000_pma__basehead__06_bl_dark")).toBe("dark, skin type 1");
    expect(skinLabel("skin_type", "")).toBe("skin type");
  });

  test("plain choice labels", () => {
    expect(choiceLabel("female__05_brown_liquorice")).toBe("brown liquorice");
    expect(choiceLabel("38_ash_brown")).toBe("ash brown");
    expect(choiceLabel("01_blonde_platinum")).toBe("blonde platinum");
  });
});

describe("character requests", () => {
  test("a save's head descriptors cross the boundary; anything else is refused", () => {
    expect(parseCharacterRequest(REQUEST_A)).toEqual(REQUEST_A);
    expect(parseCharacterRequest(DEFAULT_CHARACTER)).toEqual(DEFAULT_CHARACTER);
    expect(() => parseCharacterRequest({ ...REQUEST_A, path: "C:\\games" })).toThrow();
    expect(() => parseCharacterRequest({ ...DEFAULT_CHARACTER, bodyGender: "male" })).toThrow();
    expect(() => parseCharacterRequest({ ...REQUEST_A, appearances: [{ group: "TPP", option: "x", app: "0x12", definition: "y" }] })).toThrow();
    expect(() => parseCharacterRequest({ ...REQUEST_A, appearances: [{ group: "TPP", option: "a\\b", app: "12", definition: "y" }] })).toThrow();
  });

  test("the shown V is the loaded save, else the default female V (a reload restores the last save)", () => {
    const v = { schema: "eye-artistry/saved-v-1", saveVersion: 1, gameVersion: 2310, presetVersion: 12, isMale: false, brainIsMale: false,
      groups: { head: [{ name: "TPP", appearances: [{ resourceHash: "123", definition: "brown", name: "eyebrows_color1", censorFlag: 0, censorAction: 0 }],
        morphs: [{ region: "eyes", target: "h091", censorFlag: 0, censorAction: 0 }] }], arms: [], body: [] },
      perspectives: [], tags: [], evidence: {} } as unknown as SavedV;
    expect(characterRequestFor(undefined)).toEqual(DEFAULT_CHARACTER);
    expect(characterRequestFor(v)).toEqual(characterRequestFromSave(v));
    expect(characterRequestFromSave(v)).toMatchObject({ source: "save", appearances: [{ group: "TPP", option: "eyebrows_color1", app: "123", definition: "brown" }],
      morphs: [{ group: "TPP", region: "eyes", target: "h091" }] });
    expect(characterRequestFor({ ...v, isMale: true })).toEqual(DEFAULT_CHARACTER);
  });
});

describe("resolver selection for the head skin", () => {
  test("the skin type's head component and its skin.mt chunk: instance chain, then template defaults", async () => {
    const { plan: result } = await plan(REQUEST_A);
    const skin = result.components.find(c => c.slot === "skin")!;
    // The head draws from its morph target (facial shapes follow); the seam-fix part has no drawable template.
    expect(skin.drawnFrom.ref.path).toBe(P.headMorph);
    expect(skin.morphTargets).toBe(true);
    expect(skin.chunks).toEqual([0]);
    const chunk = skin.materials[0]!;
    expect(chunk.template).toBe(P.skinMt);
    expect(chunk.name).toBe("pale");
    // Tone values come from the tone chain; the type's albedo from the mesh's local material.
    expect(chunk.colours.TintColor).toEqual([171, 155, 150, 255]);
    expect(chunk.scalars).toMatchObject({ TintScale: 0, DetailNormalInfluence: 0.8, MicroDetailUVScale01: 20, MicroDetailUVScale02: 8,
      MicroDetailInfluence: 1, CavityIntensity: 0.25, DetailRoughnessBiasMax: 0.68 });
    expect(Object.fromEntries(Object.entries(chunk.textures).map(([name, p]) => [name, refLabel(p.ref)]))).toEqual({
      Albedo: P.skinD1, Normal: P.skinN, Roughness: P.skinRm, DetailNormal: P.skinDetailN, MicroDetail: P.micro, TintColorMask: P.tintMask,
      SecondaryAlbedo: P.white, EmissiveMask: P.black });
    // The wrinkle map is an input the adapter doesn't read, so it is never exported.
    expect(chunk.textures.Detailmap_Stretch).toBeUndefined();
    // The template's default skin profile, from the archive that wins its path (a mod replaces it, R1).
    expect(refLabel(chunk.skinProfiles.SkinProfile!.ref)).toBe(P.defaultSp);
    expect(chunk.skinProfiles.SkinProfile!.archive).toBe("fixture_mod.archive");
  });

  test("another skin type and tone: the replaced albedo wins over the base game, the tone's multiply tint applies", async () => {
    const { plan: result } = await plan(REQUEST_B);
    expect(result.slots[0]).toEqual({ slot: "skin", state: "shown", label: "senna, skin type 3" });
    const chunk = result.components.find(c => c.slot === "skin")!.materials[0]!;
    expect(chunk.name).toBe("senna_d03");
    expect(chunk.colours.TintColor).toEqual([202, 177, 153, 255]);
    expect(chunk.scalars.TintScale).toBeCloseTo(0.7, 6);
    expect(refLabel(chunk.textures.Albedo!.ref)).toBe(P.skinD3);
    expect(chunk.textures.Albedo!.archive).toBe("fixture_mod.archive");
    expect(chunk.textures.Normal!.archive).toBe("basegame_fixture.archive");
  });

  test("an ArchiveXL appearance patch supplies the donor's material: its secondary albedo over the vanilla tone chain", async () => {
    const { plan: result } = await plan(REQUEST_B, detailFixture({ skinPatch: true }));
    const chunk = result.components.find(c => c.slot === "skin")!.materials[0]!;
    expect(chunk.name).toBe("skin2_d03");
    expect(refLabel(chunk.textures.SecondaryAlbedo!.ref)).toBe(P.overlay);
    expect(chunk.textures.SecondaryAlbedo!.archive).toBe("fixture_framework.archive");
    expect(chunk.scalars).toMatchObject({ SecondaryAlbedoInfluence: 1, SecondaryAlbedoTintColorInfluence: 1 });
    // The tone still comes from the vanilla chain the donor material bases on.
    expect(chunk.colours.TintColor).toEqual([202, 177, 153, 255]);
  });
});

describe("resolver selection for the eyes", () => {
  const eyes = async (definition: string) => (await plan(eyeRequest(definition))).plan;
  const texturesOf = (chunk: { textures: Record<string, { ref: { path?: string | null } }> }) =>
    Object.fromEntries(Object.entries(chunk.textures).map(([name, p]) => [name, refLabel(p.ref as never)]));

  test("a vanilla gradient eye: the eyeball and its wetness shell, roles from their templates, the gradient in the record", async () => {
    const result = await eyes("gradient_blue");
    expect(result.slots.find(s => s.slot === "eyes")).toEqual({ slot: "eyes", state: "shown", label: "gradient blue" });
    const component = result.components.find(c => c.slot === "eyes")!;
    // The eye colour's mask hides the lashes (chunk 0); the eyeball and the shell draw.
    expect(component.chunks).toEqual([1, 2]);
    expect(component.materials.map(m => m.template)).toEqual([P.eyeGradMt, P.eyeShadowMt]);
    expect(component.materials.map(m => renderTemplate(m.template)!.adapter)).toEqual(["eye", "eye-shell"]);
    const [eyeball, shell] = component.materials;
    expect(refLabel(eyeball!.gradients.IrisColorGradient!.ref)).toBe(P.blueGradient);
    // Instance first (albedo, gradient), then the template's defaults (mask, roughness, bubble normal).
    expect(texturesOf(eyeball!)).toEqual({ Albedo: P.eyeD, Normal: P.editorNormal, Roughness: P.eyeRm, NormalBubble: P.bubble, IrisMask: P.irisMask });
    expect(eyeball!.scalars).toMatchObject({ RoughnessScale: 0.493420988 });
    expect(texturesOf(shell!)).toEqual({ Mask: P.shellMask });
    expect(shell!.colours.ShadowColor).toEqual([125, 58, 58, 255]);
    expect(shell!.scalars).toMatchObject({ Intensity: 0.7, Exponent: 0.8, WetnessRoughness: 1, WetnessStrength: 4 });
    // The vanilla morph's rule: its flat normal replaces the eye's own `Normal` (the shell reads no `Normal`).
    expect(component.morphTexture).toMatchObject({ parameter: "Normal" });
    expect(refLabel(component.morphTexture!.texture!.ref)).toBe(P.editorNormal);
  });

  test("a texture-only eye: no gradient, its own albedo, the morph's normal rule applied", async () => {
    const component = (await eyes("texture_blue")).components.find(c => c.slot === "eyes")!;
    const eyeball = component.materials[0]!;
    expect(eyeball.template).toBe(P.eyeMt);
    expect(eyeball.gradients).toEqual({});
    expect(texturesOf(eyeball)).toEqual({ Albedo: P.textureEyeD, Normal: P.editorNormal, Roughness: P.eyeRm, NormalBubble: P.bubble });
  });

  test("a CCXL-style pack's colour: built from the app's fix appearance, its @eyes template expanded, no morph normal override", async () => {
    const result = await eyes("pack_eye_01");
    const component = result.components.find(c => c.slot === "eyes")!;
    expect(component.definition).toBe("pack_eye_01");
    // The fix copy of the morph target draws (its geometry is the vanilla morph's) and its base texture is cleared.
    expect(component.drawnFrom.ref.path).toBe(P.fixMorph);
    expect(component.morphTexture).toMatchObject({ texture: null, parameter: "" });
    const [eyeball, shell] = component.materials;
    expect(eyeball!.template).toBe(P.eyeMt);
    expect(eyeball!.name).toBe("pack_eye_01@eyes");
    expect(texturesOf(eyeball!)).toMatchObject({ Albedo: P.packD, Normal: P.packN });
    expect(eyeball!.textures.Albedo!.archive).toBe("fixture_pack.archive");
    // The vanilla shell stays untouched.
    expect(shell!.template).toBe(P.eyeShadowMt);
    expect(result.slots.find(s => s.slot === "eyes")).toEqual({ slot: "eyes", state: "shown", label: "pack eye 01" });
  });

  test("a layered eye design draws through the layered adapter beside its shell", async () => {
    const component = (await eyes("layered_design")).components.find(c => c.slot === "eyes")!;
    expect(component.materials.map(m => [m.template, m.placeholder])).toEqual([[P.layeredMt, false], [P.eyeShadowMt, false]]);
    // This fixture's layered eye names no `.mlsetup`: the chunk is kept without a stack (the adapter then leaves it out with a code).
    expect(component.materials[0]!.layered).toBeNull();
    expect(renderTemplate(P.layeredMt)).toMatchObject({ adapter: "layered", layered: { setup: "MultilayerSetup", mask: "MultilayerMask" } });
    expect(renderTemplate(P.layeredMt)!.placeholder).toBeUndefined();
  });

  test("the chunk role comes from the template, never the index (the male eye mesh swaps them)", async () => {
    const component = (await eyes("swapped_blue")).components.find(c => c.slot === "eyes")!;
    expect(component.chunks).toEqual([1, 2]);
    expect(component.materials.map(m => [m.chunk, renderTemplate(m.template)!.adapter])).toEqual([[1, "eye-shell"], [2, "eye"]]);
    expect(EYE_MASK).toBe("18446744073709551614");
  });
});
