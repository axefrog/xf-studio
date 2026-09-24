import { expect, test } from "bun:test";
import { parseLashProfile, savedLashAppearance, strandAlbedo } from "../src/lash-profile";
import { resolveDepotCandidate } from "../src/depot-resolution";
import { bakeHairProfile, bakedSample, EYELASH_DEFAULT_MI_OVERRIDES, linearToSrgb8, overlayHairColor } from "../src/hair-colour-model";

const rgb = (r: number, g: number, b: number) => [r, g, b] as [number, number, number];
const candidate = (archive: string, scope: "mod" | "base", tip: [number, number, number]) => ({
  archive, scope, profileResourceSha256: (scope === "mod" ? "b" : "a").repeat(64), sampleCount: 127,
  id: [{ value: 0.8, color: rgb(160, 140, 120) }, { value: 0.2, color: rgb(80, 90, 100) }],
  rootToTip: [{ value: 0, color: rgb(100, 100, 100) }, { value: 1, color: tip }],
});
const manifest = {
  schema: "xfs/lash-profile-preview-2", appearanceHash: "6047185506343464350", definition: "05_brown_liquorice",
  strandId: [107, 105, 107], strandGradient: [255, 255, 255], selectorSwatch: [50, 44, 40],
  material: { ...EYELASH_DEFAULT_MI_OVERRIDES },
  profile: { depotPath: "base\\characters\\common\\hair\\textures\\hair_profiles\\example.hp",
    candidates: [candidate("basegame_example.archive", "base", rgb(214, 197, 174)), candidate("some_mod.archive", "mod", rgb(102, 51, 0))] },
} as const;

test("a strand profile manifest is generic: any saved identity, validated providers and material values", () => {
  const parsed = parseLashProfile(manifest);
  expect(parsed.profile.candidates).toHaveLength(2);
  expect(parseLashProfile({ ...manifest, appearanceHash: "1", definition: "anything" }).definition).toBe("anything");
  expect(() => parseLashProfile({ ...manifest, appearanceHash: "0x12" })).toThrow();
  expect(() => parseLashProfile({ ...manifest, material: { tint: 1 } })).toThrow();
  expect(() => parseLashProfile({ ...manifest, profile: { ...manifest.profile,
    candidates: [{ ...manifest.profile.candidates[0], archive: "C:\\\\private\\\\x.archive" }] } })).toThrow();
  expect(() => parseLashProfile({ ...manifest, profile: { ...manifest.profile,
    candidates: [manifest.profile.candidates[0], manifest.profile.candidates[0]] } })).toThrow();
});

test("provider choice follows the generic depot rule and reports its basis", () => {
  const base = { archive: "base.archive", scope: "base" as const }, modA = { archive: "a.archive", scope: "mod" as const };
  expect(resolveDepotCandidate([base, modA]).winner).toBe(modA);
  expect(resolveDepotCandidate([base, modA]).basis).toBe("mod-over-base-expectation");
  expect(resolveDepotCandidate([base, modA], "base.archive")).toMatchObject({ winner: base, basis: "explicit-override" });
  expect(resolveDepotCandidate([base]).basis).toBe("single-candidate");
  expect(resolveDepotCandidate([base, modA, { archive: "b.archive", scope: "mod" }]).winner).toBeUndefined();
  expect(resolveDepotCandidate([base, modA], "missing.archive").winner).toBeUndefined();
  const appearance = savedLashAppearance(parseLashProfile(manifest));
  expect(appearance.profile.winner).toBe("some_mod.archive");
  expect(appearance.candidates.map(c => c.archive)).toEqual(["basegame_example.archive", "some_mod.archive"]);
  const pinned = savedLashAppearance(parseLashProfile({ ...manifest, profile: { ...manifest.profile, override: "basegame_example.archive" } }));
  expect(pinned.profile).toMatchObject({ winner: "basegame_example.archive", basis: "explicit-override" });
  expect(() => savedLashAppearance(parseLashProfile({ ...manifest, profile: { ...manifest.profile,
    candidates: [...manifest.profile.candidates, candidate("other_mod.archive", "mod", rgb(1, 2, 3))] } }))).toThrow();
});

test("constant placeholders read one truncated sample per row through the hair.mt overlay", () => {
  const parsed = parseLashProfile(manifest), c = parsed.profile.candidates[1]!;
  const id = bakedSample(bakeHairProfile(c.id, 127), 52), root = bakedSample(bakeHairProfile(c.rootToTip, 127), 126);
  expect(strandAlbedo(parsed, c)).toEqual(overlayHairColor(root, id).map(Math.abs) as never);
  const appearance = savedLashAppearance(parsed);
  // Dark mod tip -> dark lash; the light base tip gives a light lash under the same model.
  expect(Math.max(...appearance.candidates[1]!.albedoSrgb)).toBeLessThan(90);
  expect(Math.max(...appearance.candidates[0]!.albedoSrgb)).toBeGreaterThan(150);
  expect(appearance.roughness).toBe(1);
  expect(appearance.alphaCutoff).toBe(0);
  expect(Math.round(linearToSrgb8(appearance.color.r))).toBe(appearance.candidates[1]!.albedoSrgb[0]);
});

test("legacy v1 manifests stay readable as a single base-game candidate with eyelash .mi values", () => {
  const legacy = parseLashProfile({ schema: "xfs/lash-profile-preview-1", appearanceHash: "6047185506343464350",
    definition: "05_brown_liquorice", profileResourceSha256: "57b9999e9918137ada13e536ccc130caca48f6aca08290525063b54b9e2cdcec",
    strandId: [107, 105, 107], strandGradient: [255, 255, 255], selectorSwatch: [50, 44, 40],
    id: manifest.profile.candidates[0].id, rootToTip: manifest.profile.candidates[0].rootToTip });
  expect(legacy.profile.candidates).toHaveLength(1);
  expect(legacy.profile.candidates[0]!.scope).toBe("base");
  expect(savedLashAppearance(legacy).profile.basis).toBe("single-candidate");
});
