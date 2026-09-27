// The creator swatches (cc-swatch.ts): which choices need one and which option's chain answers each, which resolved chunk carries the
// colour, and the colour itself, derived the way the preview draws it. Asset-free: the fixture creator and synthetic inputs.
import { describe, expect, test } from "bun:test";
import { encodeSwatch, gradientAt, irisColour, pickSwatchChunk, readSwatch, swatchColours, swatchNeeds, swatchPlan, type SwatchReads } from "../src/cc-swatch";
import { gradientColourAt, irisBaseColour } from "../src/eye-material";
import { bakeHairProfileBytes } from "../src/hair-colour-model";
import type { Provenance } from "../src/resource-graph";
import { fixtureSource } from "./cc-fixtures";

const ref = (path: string) => ({ ref: { hash: path, path } }) as unknown as Provenance;
const none: SwatchReads = { profile: () => null, gradient: () => null, texture: () => null };
const chunk = (extra: Partial<{ scalars: Record<string, number>; colours: Record<string, [number, number, number, number]>; textures: Record<string, Provenance>;
  profiles: Record<string, Provenance>; gradients: Record<string, Provenance> }>) => ({ scalars: {}, colours: {}, textures: {}, profiles: {}, gradients: {}, ...extra });

describe("the swatch text", () => {
  test("round-trips one colour, a gradient and the replaced mark; anything else reads as null", () => {
    for (const swatch of [{ colors: ["#102030"], replaced: false }, { colors: ["#000000", "#ffffff", "#808080"], replaced: true }])
      expect(readSwatch(encodeSwatch(swatch))).toEqual(swatch);
    for (const bad of ["", "#12345", "red", "!", "#aabbcc>", 3, null, `#${"a".repeat(6)}>`.repeat(9)]) expect(readSwatch(bad)).toBeNull();
  });
});

describe("the swatch plan", () => {
  test("colour rows only; a colour-only controller is answered by position through a drawn follower; each option's own keys otherwise", async () => {
    const { catalogue } = await fixtureSource(true);
    const plan = swatchPlan(catalogue);
    // The skin tone (no `.app` of its own) and the eye colour are the fixture's colour rows.
    expect([...plan.options.keys()].sort()).toEqual(["head/eyes_color", "head/skin_color"]);
    const skin = plan.options.get("head/skin_color")!;
    expect(skin).toEqual(["skin color\u0000#0", "skin color\u0000#1", "skin color\u0000#2"]);
    // The follower in a drawn group (the head's skin type, TPP) answers first, with its own choice at the same position.
    const first = plan.targets.get(skin[1]!)![0]!;
    expect([first.option, first.definition, first.vanilla]).toEqual(["skin_type_01", "h0__tone_b", true]);
    // A mod's choice on a vanilla option names its mod (so its own icon stays unless another mod replaced its colour).
    const eyes = plan.options.get("head/eyes_color")!, catalogueEyes = catalogue.options.find(option => option.id === "head/eyes_color")!;
    const violet = catalogueEyes.choices.findIndex(choice => choice.key === "he__03_violet");
    expect(plan.targets.get(eyes[violet]!)![0]!.mod).toBe("Pretty Eyes and Rings");
    expect(plan.families.get("head/eyes_color")!.length).toBe(catalogueEyes.choices.length);
  });
});

describe("the swatch chunk and colour", () => {
  test("hair strands come first, then the eye, the skin, the brow decal and a plain decal", () => {
    const chunks = [{ adapter: "mesh-decal" as const, id: 1 }, { adapter: "skin" as const, id: 2 }, { adapter: null, id: 3 }];
    expect(pickSwatchChunk(chunks)?.id).toBe(2);
    expect(pickSwatchChunk([...chunks, { adapter: "hair-strand" as const, id: 4 }])?.id).toBe(4);
    expect(pickSwatchChunk([{ adapter: "layered" as const, id: 5 }])).toBeNull();
  });

  test("a hair profile is its baked root-to-tip row, five samples as the game stores them", () => {
    const rootToTip = [{ value: 0.2, color: [10, 20, 30] as const }, { value: 0.9, color: [210, 180, 150] as const }];
    const reads: SwatchReads = { ...none, profile: () => ({ sampleCount: 9, rootToTip }) };
    const colours = swatchColours("hair-strand", chunk({ profiles: { HairProfile: ref("a.hp") } }), reads)!;
    const bytes = bakeHairProfileBytes(rootToTip, 9);
    expect(colours).toHaveLength(5);
    // The rescaled first stop sits at the root; the last sample is (N−1)/N along the row.
    expect(colours[0]).toBe("#0a141e");
    expect(colours[4]).toBe(`#${[...bytes.slice(24, 27)].map(b => b.toString(16).padStart(2, "0")).join("")}`);
    expect(swatchNeeds("hair-strand", chunk({ profiles: { HairProfile: ref("a.hp") } })).profiles).toHaveLength(1);
    expect(swatchColours("hair-strand", chunk({}), none)).toBeNull();
  });

  test("a decal is its colour times the texture's coverage-weighted colour; the brow's gradient replaces the colour", () => {
    // A 2×1 texture: one covered white texel and one uncovered black one.
    const texture = { width: 2, height: 1, data: [255, 255, 255, 255, 0, 0, 0, 0], isGamma: true };
    const reads: SwatchReads = { ...none, texture: () => texture };
    expect(swatchColours("mesh-decal", chunk({ colours: { DiffuseColor: [200, 100, 50, 255] }, textures: { DiffuseTexture: ref("d.xbm") } }), reads)).toEqual(["#c86432"]);
    const gradient = { width: 4, height: 1, data: [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 90, 60, 30, 255], isGamma: true };
    const brow = chunk({ scalars: { UseGradientMap: 1, GradientMapUV: 1 }, colours: { DiffuseColor: [255, 0, 0, 255] },
      textures: { DiffuseTexture: ref("d.xbm"), GradientMap: ref("g.xbm") } });
    expect(swatchColours("double-diffuse-decal", brow, { ...none, texture: r => (r.ref.path === "g.xbm" ? gradient : texture) })).toEqual(["#5a3c1e"]);
    // Without the textures, the colour parameter alone.
    expect(swatchColours("mesh-decal", chunk({ colours: { DiffuseColor: [1, 2, 3, 255] } }), none)).toEqual(["#010203"]);
  });

  test("a gradient eye without its textures reads the gradient at the iris's median mask value; the twins match the renderer's", () => {
    const stops = [{ value: 0, color: [0, 0, 0, 255] as [number, number, number, number] }, { value: 0.7, color: [140, 70, 35, 255] as [number, number, number, number] }];
    expect(swatchColours("eye", chunk({ gradients: { IrisColorGradient: ref("e.gradient") } }), { ...none, gradient: () => stops })).toEqual(["#462312"]);
    for (const t of [0, 0.2, 0.35, 0.7, 0.9]) expect(gradientAt(stops, t)).toEqual(gradientColourAt(stops, t).slice(0, 3) as [number, number, number]);
    for (const [r, a] of [[0.3, 1], [0.5, 0.4], [0, 0]]) {
      const ours = irisColour([0.2, 0.3, 0.4], r, a, stops), theirs = irisBaseColour([0.2, 0.3, 0.4], r, a, stops);
      for (let k = 0; k < 3; k++) expect(ours[k]!).toBeCloseTo(theirs[k]!, 9);
    }
  });

  test("the skin is its albedo toned by the tint through the mask", () => {
    const albedo = { width: 1, height: 1, data: [128, 128, 128, 255], isGamma: false };
    const toned = swatchColours("skin", chunk({ scalars: { TintScale: 1 }, colours: { TintColor: [255, 128, 0, 255] }, textures: { Albedo: ref("a.xbm") } }),
      { ...none, texture: () => albedo })!;
    const [r, g, b] = [1, 3, 5].map(at => parseInt(toned[0]!.slice(at, at + 2), 16));
    expect(r! > g! && g! > b! && b === 0).toBe(true);
    expect(swatchColours("skin", chunk({ textures: { Albedo: ref("a.xbm") } }), none)).toBeNull();
  });
});
