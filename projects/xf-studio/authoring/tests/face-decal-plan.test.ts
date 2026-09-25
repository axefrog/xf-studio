import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState } from "../src/cco-model";
import { inputFromCharacterRequest } from "../src/character-detail-request";
import { FACE_GROUPS, planCharacterDetails, type TemplateIdentities } from "../src/character-detail-plan";
import { templateIdentity } from "../src/character-detail-service";
import { loadMergedCco, resolveCharacter, type ResolvedParam } from "../src/character-resolver";
import { refFromPath, refLabel } from "../src/depot-path";
import { templateDefaults } from "../src/material-template";
import { priorityRank, renderTemplate } from "../src/render-templates";
import { detailFixture, FACE, P, REQUEST_A, REQUEST_B } from "./character-detail-fixtures";

// Face details (rank 2 of the head render plan) chosen from the synthetic installation: by the game's structure (groups,
// the slots other details claim, decal templates by their own name), never by option names.

const TEMPLATES = [P.hairMt, P.decalMt, P.capMt, P.skinMt, P.eyeMt, P.eyeGradMt, P.eyeShadowMt, P.layeredMt, P.meshDecalMt, P.emissiveMt, P.packFrontMt];
async function plan(request: typeof REQUEST_A | { state: Record<string, string> }, fixture = detailFixture()) {
  const { graph } = fixture.installation();
  const cco = await loadMergedCco(graph, "female");
  const input = "state" in request
    ? (() => { const d = descriptorsFromUiState(cco.merged.cco, request.state); return { bodyGender: "female" as const, origin: "ui-state" as const, appearances: d.appearances, morphs: d.morphs }; })()
    : inputFromCharacterRequest(request as Extract<typeof REQUEST_A, { source: "save" }>);
  const resolved = await resolveCharacter(graph, input, cco);
  const defaults = new Map<string, ResolvedParam[]>(), identities = new Map<string, { name: string | null; priority: string | null }>();
  for (const path of TEMPLATES) {
    const loaded = await graph.load(refFromPath(path), "mt");
    identities.set(path.toLowerCase(), templateIdentity(loaded!.root));
    defaults.set(path.toLowerCase(), templateDefaults(loaded!.root).map(([name, value]) => ({ name, kind: value.kind, setBy: "template",
      value: value.kind === "scalar" ? JSON.stringify(value.value) : value.kind === "resource" ? value.text ?? "" : value.value,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })));
  }
  return planCharacterDetails(resolved, cco.merged.cco, defaults, identities satisfies TemplateIdentities);
}
const face = (result: Awaited<ReturnType<typeof plan>>) => result.components.filter(c => c.slot === "face");
const textures = (chunk: { textures: Record<string, { ref: unknown }> }) =>
  Object.fromEntries(Object.entries(chunk.textures).map(([name, p]) => [name, refLabel(p.ref as never)]));

describe("face details from the resolver", () => {
  test("vanilla lipstick with its colour, and blush on both chunks of the shared freckle mesh", async () => {
    const result = await plan(REQUEST_A);
    expect(result.slots.find(s => s.slot === "face")).toEqual({ slot: "face", state: "shown", label: "lipstick (red), cheeks (red)" });
    const [lips, cheeks] = face(result);
    // The save repeats the lipstick in the creator group; it draws once.
    expect(face(result).map(c => c.option)).toEqual(["makeupLips_05", "makeupCheeks_05"]);
    expect(lips!.drawnFrom.ref.path).toBe(P.lipsMorph);
    expect(lips!.morphTargets).toBe(true);
    const chunk = lips!.materials[0]!;
    expect(chunk.template).toBe(P.meshDecalMt);
    expect(chunk.materialPriority).toBe("EMP_Normal");
    // The colour choice arrives through the mesh appearance's material instance; template defaults fill the rest.
    expect(chunk.colours.DiffuseColor).toEqual([106, 40, 40, 255]);
    expect(chunk.scalars).toMatchObject({ DiffuseAlpha: 0.4, NormalsBlendingMode: 1, RoughnessMetalnessAlpha: 0, NormalAlpha: 0, SecondaryMaskInfluence: 0 });
    // Only what the decal family reads is exported: the colour map, mask, normal, normal alpha, roughness and metalness.
    expect(textures(chunk)).toEqual({ DiffuseTexture: P.lipsD, SecondaryMask: P.white, NormalTexture: P.editorNormal, NormalAlphaTex: P.white,
      RoughnessTexture: P.white, MetalnessTexture: P.black });
    expect(cheeks!.chunks).toEqual([0, 1]);
    expect(cheeks!.materials.map(m => [m.colours.DiffuseColor, m.scalars.DiffuseAlpha])).toEqual([[[186, 20, 40, 255], 2], [[186, 20, 40, 255], 2]]);
  });

  test("freckles, a tone-linked tattoo, face cyberware, the personal link and a CCXL makeup option, in creator order", async () => {
    const result = await plan(REQUEST_B);
    expect(result.slots.find(s => s.slot === "face")).toEqual({ slot: "face", state: "shown",
      label: "personal link, cheeks (light brown), tattoo, face cyberware, face detail (pack liner black)" });
    expect(face(result).map(c => `${c.option}:${c.component}`)).toEqual(["skin_type_03:personal_link", "makeupCheeks_01:hx_freckles",
      "facial_tattoo_02:hx_tattoo", "cyberware_01:hx_cyberware", "pack_liner:pack_liner"]);
    // The skin type's decal part is a face detail; the skin slot keeps only the head.
    expect(result.components.filter(c => c.slot === "skin").map(c => c.component)).toEqual(["head"]);
    const [link, freckles, tattoo, cyber, liner] = face(result);
    expect(link!.materials[0]!.scalars).toMatchObject({ DiffuseAlpha: 1, RoughnessMetalnessAlpha: 0.5 });
    expect(freckles!.materials.map(m => m.scalars.DiffuseAlpha)).toEqual([0.3, 0.3]);
    // The tattoo's ink follows the tone the save chose (senna).
    expect(tattoo!.materials[0]!.colours.DiffuseColor).toEqual([119, 115, 110, 255]);
    // Cyberware: its normal-writing decal draws; its emissive chunk is recorded as not drawn yet.
    expect(cyber!.materials.map(m => [m.chunk, m.placeholder, m.template])).toEqual([[0, false, P.meshDecalMt], [1, true, P.emissiveMt]]);
    expect(cyber!.materials[0]!.scalars).toMatchObject({ NormalAlpha: 0.425, NormalsBlendingMode: 1, RoughnessMetalnessAlpha: 1 });
    expect(textures(cyber!.materials[0]!).NormalTexture).toBe(P.cyberN);
    expect(renderTemplate(cyber!.materials[1]!.template)).toMatchObject({ adapter: "decal-placeholder", placeholder: true });
    // The pack's material derives from a copy of the decal template at its own path: it keeps the name, so the same
    // adapter draws it, and its front priority.
    const chunk = liner!.materials[0]!;
    expect(chunk.template).toBe(P.packFrontMt);
    expect(chunk).toMatchObject({ templateName: "mesh_decal", materialPriority: "EMP_Front" });
    expect(renderTemplate(chunk.template)).toBeUndefined();
    expect(renderTemplate(chunk.template, chunk.templateName)?.adapter).toBe("mesh-decal");
    expect(textures(chunk).DiffuseTexture).toBe(P.packLinerD);
    expect(chunk.textures.DiffuseTexture!.archive).toBe("fixture_pack.archive");
    expect(priorityRank(chunk.materialPriority)).toBeGreaterThan(priorityRank(freckles!.materials[0]!.materialPriority));
  });

  test("Off draws nothing: the creator's default is no lipstick; choosing a style through the switcher shows it", async () => {
    expect((await plan({ state: {} })).slots.find(s => s.slot === "face")).toEqual({ slot: "face", state: "none", label: "None" });
    expect((await plan({ state: { makeupLips: "Off" } })).slots.find(s => s.slot === "face")).toMatchObject({ state: "none" });
    const chosen = await plan({ state: { makeupLips: "05" } });
    expect(face(chosen).map(c => c.definition)).toEqual([FACE.lipsRed]);
    expect(chosen.slots.find(s => s.slot === "face")).toEqual({ slot: "face", state: "shown", label: "lipstick (red)" });
  });

  test("a face choice whose resources are missing from the installation draws nothing and never blocks the others", async () => {
    const fixture = detailFixture();
    delete fixture.archives[0]!.files[P.lipsMorph];
    const result = await plan(REQUEST_A, fixture);
    expect(face(result).map(c => c.option)).toEqual(["makeupCheeks_05"]);
    expect(result.slots.find(s => s.slot === "face")).toMatchObject({ slot: "face", state: "shown", label: "cheeks (red)" });
  });

  test("the face consumers are the third-person head's groups; brows, lashes, hair, eyes and skin keep their own slots", async () => {
    expect(FACE_GROUPS).toEqual(["TPP", "face", "beards"]);
    const result = await plan(REQUEST_A);
    // The brows are a double-diffuse decal too, but their creator slot is the brows'.
    expect(face(result).some(c => c.option.startsWith("eyebrows"))).toBe(false);
    expect(result.components.find(c => c.slot === "brows")!.materials[0]!.textures).not.toHaveProperty("NormalTexture");
  });
});
