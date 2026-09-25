import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState } from "../src/cco-model";
import { characterRequestFor, characterRequestFromSave, DEFAULT_CHARACTER, inputFromCharacterRequest, parseCharacterRequest } from "../src/character-detail-request";
import { choiceLabel, planCharacterDetails } from "../src/character-detail-plan";
import { loadMergedCco, resolveCharacter, type ResolvedParam } from "../src/character-resolver";
import { refFromPath, refLabel } from "../src/depot-path";
import { templateDefaults } from "../src/material-template";
import { renderTemplate } from "../src/render-templates";
import type { SavedV } from "../src/save-reader";
import { detailFixture, P, REQUEST_A, REQUEST_B } from "./character-detail-fixtures";

async function plan(request: typeof REQUEST_A | "default") {
  const { graph } = detailFixture().installation();
  const cco = await loadMergedCco(graph, "female");
  const input = request === "default"
    ? (() => { const d = descriptorsFromUiState(cco.merged.cco, {}); return { bodyGender: "female" as const, origin: "ui-state" as const, appearances: d.appearances, morphs: d.morphs }; })()
    : inputFromCharacterRequest(request as Extract<typeof REQUEST_A, { source: "save" }>);
  const resolved = await resolveCharacter(graph, input, cco);
  const defaults = new Map<string, ResolvedParam[]>();
  for (const path of [P.hairMt, P.decalMt, P.capMt]) {
    const loaded = await graph.load(refFromPath(path), "mt");
    defaults.set(path.toLowerCase(), templateDefaults(loaded!.root).map(([name, value]) => ({ name, kind: value.kind, setBy: "template",
      value: value.kind === "scalar" ? JSON.stringify(value.value) : value.kind === "resource" ? value.text ?? "" : value.value,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })));
  }
  return { resolved, plan: planCharacterDetails(resolved, cco.merged.cco, defaults) };
}

describe("resolver selection for brows, lashes and hair", () => {
  test("slots come from the creator's uiSlot and the third-person groups; FPP twins and shadow meshes stay out", async () => {
    const { plan: result } = await plan(REQUEST_A);
    expect(result.slots).toEqual([{ slot: "brows", state: "shown", label: "brown" }, { slot: "lashes", state: "shown", label: "brown" },
      { slot: "hair", state: "shown", label: "brown" }]);
    expect(result.components.map(c => `${c.slot}:${c.option}:${c.component}`)).toEqual(
      ["brows:eyebrows_color1:brow", "lashes:eyelash_color:eyes", "hair:hair_color1:hair"]);
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
    expect(result.components.map(c => c.option)).toEqual(["eyebrows_color1", "eyelash_color", "hair_color1"]);
  });

  test("an appearance the installation lacks is unavailable with one plain line", async () => {
    const missing = { ...REQUEST_A, appearances: [{ group: "TPP", option: "eyebrows_color1", app: refFromPath("base\\fixture\\gone.app").hash, definition: "brown" }] };
    const { plan: result } = await plan(missing as typeof REQUEST_A);
    const brows = result.slots.find(s => s.slot === "brows")!;
    expect(brows.state).toBe("unavailable");
    expect(brows.message).toBe("Your V's eyebrows (brown) aren't in your installed game files, so they aren't shown.");
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
