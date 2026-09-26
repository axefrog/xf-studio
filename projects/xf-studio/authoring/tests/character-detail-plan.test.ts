import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState } from "../src/cco-model";
import type { CharacterChoice } from "../src/character-context";
import { characterRequestFor, characterRequestFromSave, DEFAULT_CHARACTER, inputFromCharacterRequest, parseCharacterRequest } from "../src/character-detail-request";
import { bodyOptionDraws, censorRole, choiceLabel, planCharacterDetails, previewInput, skinLabel, type TemplateIdentities } from "../src/character-detail-plan";
import { templateIdentity } from "../src/character-detail-service";
import { loadMergedCco, resolveCharacter, type ResolvedParam } from "../src/character-resolver";
import { depotHash, refFromPath, refLabel } from "../src/depot-path";
import { templateDefaults } from "../src/material-template";
import { renderTemplate } from "../src/render-templates";
import type { SavedV } from "../src/save-reader";
import { BODY, BODY_MASK, BODY_REQUEST, detailFixture, EYE_MASK, eyeRequest, FACE, P, REQUEST_A, REQUEST_B, TONES } from "./character-detail-fixtures";

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
      { slot: "eyes", state: "shown", label: "gradient blue" }, { slot: "piercings", state: "shown", label: "style 01, silver" },
      // V "A" as saved here lists no body part.
      { slot: "body", state: "none", label: "None" },
      // No clothing requested.
      { slot: "clothing", state: "none", label: "None" }]);
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

  test("a chunk draws when its render mask draws it in the scene, on any slot: shadow-only chunks stay out, an in-scene layered chunk draws (PIPE-41)", async () => {
    // The fixture's hair shadow proxy casts shadows only (as every vanilla hair shadow mesh): neither of its chunks is planned.
    const { plan: shadowOnly, resolved } = await plan(REQUEST_A);
    const proxy = resolved.appearances.flatMap(entry => entry.components).find(component => component.name === "hair_shadow")!;
    expect(proxy.geometry!.chunkInScene).toEqual([false, false]);
    expect(shadowOnly.components.filter(c => c.component === "hair_shadow")).toEqual([]);
    // The same proxy with chunks the scene draws (a CCXL hair's one-triangle proxy is like that): its layered chunk now draws on the
    // hair slot, and its glass chunk still has no adapter. The slot stays shown, with the hair itself first.
    const { plan: inScene } = await plan(REQUEST_A, detailFixture({ shadowsInScene: true }));
    const drawn = inScene.components.filter(c => c.slot === "hair");
    expect(drawn.map(c => [c.component, c.chunks])).toEqual([["hair", [0, 1]], ["hair_shadow", [1]]]);
    expect(drawn[1]!.materials[0]!.layered?.setup).toBeDefined();
    expect(drawn[1]!.skippedChunks).toBe(1);
    expect(inScene.slots.find(s => s.slot === "hair")).toMatchObject({ state: "shown" });
    // A chunk whose LOD mask is 0 is in no level of detail and is never drawn, whatever its render mask (the real CCXL proxy stores 0).
    const { plan: noLod, resolved: noLodResolved } = await plan(REQUEST_A, detailFixture({ shadowsInScene: true, shadowLod: 0 }));
    expect(noLodResolved.appearances.flatMap(entry => entry.components).find(c => c.name === "hair_shadow")!.geometry!.chunkLods).toEqual([0, 0]);
    expect(noLod.components.filter(c => c.component === "hair_shadow")).toEqual([]);
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
    // The body: the third-person skin, flat feet (no footwear), the default arms and nails, and the game's underwear cover; the censored
    // twin, the parts under the cover, the first-person body, lifted feet and the arm-cyberware arms stay out.
    expect(result.components.map(c => c.option)).toEqual(["skin_type_01", "eyebrows_color1", "eyelash_color", "hair_color1", "eyes_color",
      "body_color", "flat_feet", "h_default_arms_colors_tpp", "nails_color_tpp", "underpants"]);
    // The creator's first eye colour, as a new V starts with.
    expect(result.components.find(c => c.slot === "eyes")!.definition).toBe("gradient_blue");
    expect(result.components[0]!.definition).toBe(TONES.pale);
  });

  test("an appearance the installation lacks is unavailable with one plain line", async () => {
    const missing = { ...REQUEST_A, appearances: [{ part: "head" as const, group: "TPP", option: "eyebrows_color1", app: refFromPath("base\\fixture\\gone.app").hash, definition: "brown" }] };
    const { plan: result } = await plan(missing as typeof REQUEST_A);
    const brows = result.slots.find(s => s.slot === "brows")!;
    expect(brows.state).toBe("unavailable");
    expect(brows.message).toBe("Your V's eyebrows (brown) aren't in your installed game files, so they aren't shown.");
  });

  test("an appearance an archive provides but WolvenKit can't read names that archive instead of saying it isn't installed", async () => {
    const fixture = detailFixture();
    // A mod's .app WolvenKit refuses (a hair replacer written with an older property type): its index lists it, but it can't be read.
    fixture.archives.push({ virtualPath: "archive/pc/mod/old_brows.archive", files: { [P.browApp1]: null as unknown as object } });
    const { plan: result, resolved } = await plan("default", fixture);
    expect(resolved.appearances.find(entry => entry.option === "eyebrows_color1")!.appearance.status).toBe("unreadable");
    const brows = result.slots.find(s => s.slot === "brows")!;
    expect(brows.state).toBe("unavailable");
    expect(brows.message).toBe("XF Studio couldn't read your V's eyebrows (brown) from old_brows.archive, so they aren't shown.");
    // Without WolvenKit set up, the line says that setting it up may read the part.
    const cco = await loadMergedCco(fixture.installation().graph, "female");
    const without = planCharacterDetails(resolved, cco.merged.cco, undefined, undefined, undefined, null, "drawn", { wolvenKit: false });
    expect(without.slots.find(s => s.slot === "brows")!.message)
      .toBe("XF Studio couldn't read your V's eyebrows (brown) from old_brows.archive, so they aren't shown. Setting up WolvenKit from the 3D preview card may let XF Studio read it.");
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
    // A current request may ask for the masculine default V; an earlier one never could.
    expect(parseCharacterRequest({ ...DEFAULT_CHARACTER, bodyGender: "male" })).toMatchObject({ bodyGender: "male" });
    expect(() => parseCharacterRequest({ ...DEFAULT_CHARACTER, schema: "xfs/character-request-1", bodyGender: "male" })).toThrow();
    // Creator choices are the character context's identities, validated whole.
    const choices: CharacterChoice[] = [{ part: "head", option: "eyes_color", choice: "he__02_blue" }, { part: "head", option: "piercings", choice: "07", activates: ["xl_ring"], mod: "Rings" }];
    expect(parseCharacterRequest({ ...REQUEST_A, choices })).toEqual({ ...REQUEST_A, choices });
    expect(() => parseCharacterRequest({ ...REQUEST_A, choices: [{ part: "head", option: "a\b", choice: "x" }] })).toThrow("creator choice");
    expect(() => parseCharacterRequest({ ...REQUEST_A, choices: [{ part: "torso", option: "a", choice: "x" }] })).toThrow("creator choice");
    expect(() => parseCharacterRequest({ ...REQUEST_A, schema: "xfs/character-request-3", choices })).toThrow();
    // A v3 tried piercing is a page built apart from this host: refused.
    expect(() => parseCharacterRequest({ ...DEFAULT_CHARACTER, schema: "xfs/character-request-3", override: { slot: "piercings", choice: "01", definition: "gold" } })).toThrow();
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

describe("resolver selection for the body", () => {
  test("the third-person body: its consumer groups, the censorship policy, one part per repeated component, the skin first", async () => {
    const { plan: result } = await plan(BODY_REQUEST);
    const body = result.components.filter(c => c.slot === "body");
    expect(body.map(c => `${c.option}:${c.component}`)).toEqual(["body_color:t0_body", "flat_feet:l0_feet_flat", "h_default_arms_colors_tpp:a0_arms",
      "nails_color_tpp:a0_nails_l", "underpants:i0_cover"]);
    expect(result.slots.find(slot => slot.slot === "body")).toEqual({ slot: "body", state: "shown", label: "body, feet, arms, nails (beige), underwear" });
    // The head is planned exactly as without the body.
    expect(result.components.filter(c => c.slot !== "body").map(c => c.component)).toEqual((await plan(REQUEST_A)).plan.components.map(c => c.component));
    const skin = body[0]!;
    // The body's chunk mask hides the calves, which the feet draw; every chunk is the tone's skin.
    expect(skin.chunks).toEqual([0, 1]);
    expect(skin.materials.map(m => m.template)).toEqual([P.skinMt, P.skinMt]);
    expect(skin.definition).toBe(BODY.pale);
    // The body's own shapes: the breast size on the body, the left nail length on the nails; head parts carry none.
    expect(skin.morphs).toEqual(["breast_big_breast"]);
    expect(body.find(c => c.component === "a0_nails_l")!.morphs).toEqual(["nails_long_l_nails_l"]);
    expect(body.find(c => c.component === "l0_feet_flat")!.morphs).toEqual([]);
    expect(result.components.find(c => c.slot === "skin")!.morphs).toBeUndefined();
    // The arms: two skin chunks and the layered personal-link chunk, with its stack references.
    const arms = body.find(c => c.component === "a0_arms")!;
    expect(arms.materials.map(m => m.template)).toEqual([P.skinMt, P.skinMt, P.layeredMt]);
    expect(arms.materials[2]!.layered?.setup.ref.path).toBe(P.silverSetup);
    // The underwear cover is a decal, drawn with the decal family's inputs.
    expect(body.at(-1)!.materials.map(m => m.templateName)).toEqual([null]);
    expect(body.at(-1)!.materials[0]!.textures.DiffuseTexture!.ref.path).toBe(P.coverD);
    expect(BODY_MASK).toBe("18446744073709551611");
  });

  test("the censorship policy comes from the creator's own rules: the uncensored skin, the cover drawn, what it covers left out", async () => {
    const { graph } = detailFixture().installation();
    const cco = (await loadMergedCco(graph, "female")).merged.cco;
    const draws = (name: string) => bodyOptionDraws(cco.parts.body.options, name);
    expect(["body_color", "body_color_censored", "underpants", "nipples_01", "genitals_04", "flat_feet", "breast"].map(draws))
      .toEqual([true, false, true, false, false, true, true]);
    expect(cco.parts.body.options.find(option => option.name === "underpants")!.censor).toEqual({ flag: "Censor_Nudity", action: "activate" });
    expect(cco.parts.body.options.find(option => option.name === "flat_feet")!.censor).toBeUndefined();
  });

  // ---- PIPE-97: the underwear floor fails closed in the plan ----
  const bodyOf = (result: Awaited<ReturnType<typeof plan>>["plan"]) => result.components.filter(c => c.slot === "body");
  const bodySlot = (result: Awaited<ReturnType<typeof plan>>["plan"]) => result.slots.find(slot => slot.slot === "body")!;
  const withoutBody = (drop: (item: typeof BODY_REQUEST.appearances[number]) => boolean) => ({ ...BODY_REQUEST, appearances: BODY_REQUEST.appearances.filter(item => !drop(item)) });

  test("PIPE-97: the cover is marked a cover and ordered last; the uncensored skin is marked covered; the censored twin waits beside it", async () => {
    const { plan: result } = await plan(BODY_REQUEST);
    const body = bodyOf(result);
    expect(body.map(c => [c.option, c.censor ?? null])).toEqual([["body_color", "covered"], ["flat_feet", null], ["h_default_arms_colors_tpp", null],
      ["nails_color_tpp", null], ["underpants", "cover"]]);
    // The game's own censored skin is planned (for the host), never drawn while the cover is.
    expect(result.censoredBody.map(c => [c.option, c.component, c.censor ?? null])).toEqual([["body_color_censored", "t0_body", null]]);
    expect(result.censoredBody[0]!.materials.map(m => m.name)).toEqual(["skin_censored", "skin_censored"]);
  });

  test("PIPE-97: a request or save without the cover's descriptor draws the game's censored skin, never the uncensored one", async () => {
    const { plan: result } = await plan(withoutBody(item => item.option === "underpants"));
    const body = bodyOf(result);
    expect(body.some(c => c.censor === "covered" || c.option === "body_color")).toBe(false);
    expect(body.map(c => c.option)).toEqual(["body_color_censored", "flat_feet", "h_default_arms_colors_tpp", "nails_color_tpp"]);
    expect(result.censoredBody).toEqual([]);
    expect(bodySlot(result).message).toBe("The underwear the game draws on your V couldn't be read, so the body is shown in the game's censored look.");
  });

  test("PIPE-97: a cover the game files don't give (its appearance missing) draws the censored skin too", async () => {
    const gone = depotHash("base\\fixture\\body\\gone.app");
    const request = { ...BODY_REQUEST, appearances: BODY_REQUEST.appearances.map(item => item.option === "underpants" ? { ...item, app: gone } : item) };
    const { plan: result } = await plan(request);
    expect(bodyOf(result).map(c => c.option)).toEqual(["body_color_censored", "flat_feet", "h_default_arms_colors_tpp", "nails_color_tpp"]);
    expect(bodySlot(result).message).toContain("censored look");
    expect(bodySlot(result).message).toContain("underwear");
  });

  test("PIPE-97: with neither the cover nor the censored twin, no body is drawn at all, in plain words", async () => {
    const { plan: result } = await plan(withoutBody(item => item.option === "underpants" || item.option === "body_color_censored"));
    expect(bodyOf(result)).toEqual([]);
    expect(bodySlot(result)).toEqual({ slot: "body", state: "unavailable", label: "body",
      message: "XF Studio couldn't read the underwear the game draws on your V, so the body isn't shown." });
  });

  test("PIPE-98: a descriptor the creator resource doesn't define never draws; a twin shares the slot and link and is an appearance", async () => {
    const extra = { ...BODY_REQUEST, appearances: [...BODY_REQUEST.appearances, { part: "body" as const, group: "TPP_Body", option: "not_in_creator",
      app: depotHash(P.nippleApp), definition: "nipples__01_ca_pale" }] };
    expect(bodyOf((await plan(extra)).plan).some(c => c.option === "not_in_creator")).toBe(false);
    const rule = (action: "activate" | "deactivate") => ({ flag: "Censor_Nudity", action });
    const options = [{ name: "skin", uiSlot: "body_color", link: "skin color", censor: rule("deactivate") },
      { name: "skin_censored", uiSlot: "body_color", link: "other link", censor: rule("activate") },
      { name: "cover", uiSlot: "underpants", censor: rule("activate") },
      { name: "morph", uiSlot: "body_color", type: "morph", link: "skin color", censor: rule("activate") }];
    // Another link, or a morph, is no twin: the skin is left out as covered by the underwear, the other link's option is a cover.
    expect(options.map(option => censorRole(options, option.name))).toEqual(["hidden", "cover", "cover", "plain"]);
    expect(censorRole(options, "missing")).toBe("unknown");
    expect(bodyOptionDraws(options, "missing")).toBe(false);
    const twins = [{ ...options[0]!, type: "appearance" }, { ...options[1]!, link: "skin color", type: "appearance" }];
    expect(twins.map(option => censorRole(twins, option.name))).toEqual(["uncensored", "censored"]);
  });

  test("PIPE-98: a male V's body is refused in plain words; a body turned off is neither planned nor dressed", async () => {
    const { resolved, plan: female } = await plan(BODY_REQUEST);
    const { graph } = detailFixture().installation();
    const cco = (await loadMergedCco(graph, "female")).merged.cco;
    const male = planCharacterDetails({ ...resolved, bodyGender: "male" }, cco);
    expect(male.components.some(c => c.slot === "body")).toBe(false);
    expect(male.slots.find(slot => slot.slot === "body")).toEqual({ slot: "body", state: "unavailable", label: "body",
      message: "XF Studio doesn't draw a male V's body yet, so it isn't shown." });
    const hidden = planCharacterDetails(resolved, cco, new Map(), new Map(), undefined, null, "hidden");
    expect(hidden.components.some(c => c.slot === "body" || c.slot === "clothing")).toBe(false);
    expect(hidden.slots.filter(slot => slot.slot === "body" || slot.slot === "clothing").map(slot => slot.label)).toEqual(["Hidden", "Hidden"]);
    expect(bodyOf(female).length).toBeGreaterThan(0);
    // The request for a body turned off keeps only the head's descriptors.
    const input = inputFromCharacterRequest(BODY_REQUEST as Extract<typeof BODY_REQUEST, { source: "save" }>);
    expect(previewInput(input, undefined, false).appearances.every(a => a.part === "head")).toBe(true);
    expect(previewInput(input, undefined, false).morphs.every(m => m.part === "head")).toBe(true);
  });

  test("only what the preview draws is resolved: every head descriptor, and the body parts its third-person consumers read", () => {
    const input = inputFromCharacterRequest(BODY_REQUEST as Extract<typeof BODY_REQUEST, { source: "save" }>);
    const kept = previewInput(input);
    expect(kept.appearances.filter(a => a.part === "head")).toEqual(input.appearances.filter(a => a.part === "head"));
    expect([...new Set(kept.appearances.filter(a => a.part !== "head").map(a => a.group))].sort())
      .toEqual(["TPP_Body", "flat_feet", "genitals", "holstered_default_tpp"]);
    expect(kept.morphs).toEqual(input.morphs);
    // The lifted-feet state (footwear) reads the other feet group.
    expect(previewInput(input, { feet: "lifted" }).appearances.some(a => a.group === "lifted_feet")).toBe(true);
    // A V without body parts is unchanged.
    const head = inputFromCharacterRequest(REQUEST_A as Extract<typeof REQUEST_A, { source: "save" }>);
    expect(previewInput(head)).toBe(head);
  });

  test("the nail length links: the right hand follows the left's row (rule R5 for morphs)", async () => {
    const { graph } = detailFixture().installation();
    const cco = (await loadMergedCco(graph, "female")).merged.cco;
    const morphs = (state: Record<string, string>) => descriptorsFromUiState(cco, state).morphs.filter(m => m.part === "arms").map(m => `${m.region}:${m.target}`);
    expect([...new Set(morphs({ nails_l: "nails_long_l" }))]).toEqual(["nails_l:nails_long_l", "nails_r:nails_long_r"]);
    expect(morphs({})).toEqual([]);
    // A follower set on its own keeps its own choice.
    expect([...new Set(morphs({ nails_l: "nails_long_l", nails_r: "" }))]).toEqual(["nails_l:nails_long_l"]);
  });
});
