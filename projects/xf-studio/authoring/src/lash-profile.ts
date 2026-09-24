import * as THREE from "three";
import {
  bakeHairProfile, bakedSample, EYELASH_DEFAULT_MI_OVERRIDES, hairFragmentColor, linearToSrgb8, profileIndex,
  resolveHairMaterial, type HairMaterialParameters, type ProfileEncoding, type Rgb,
} from "./hair-colour-model";
import { resolveDepotCandidate, type DepotResolution, type DepotScope } from "./depot-resolution";

type Stop = { value: number; color: [number, number, number] };
type Rgb8 = [number, number, number];

/** One installed archive that provides the strand material's `HairProfile` depot path. */
export type HairProfileCandidate = {
  archive: string;            // archive file name only, never a local path
  scope: DepotScope;
  containerSha256?: string;
  profileResourceSha256: string;
  sampleCount: number;
  id: Stop[];
  rootToTip: Stop[];
};

/**
 * Generic hair.mt strand detail whose Strand_ID/Strand_Gradient inputs are
 * constant images (eyelash-style materials). Nothing here is specific to a
 * particular mod: the saved identity, material chain values and every
 * installed provider of the profile path come from the local intake.
 */
export type StrandProfileManifest = {
  schema: "xfs/lash-profile-preview-2";
  appearanceHash: string;
  definition: string;
  /** Constant samples of the material's Strand_ID / Strand_Gradient images. */
  strandId: Rgb8;
  strandGradient: Rgb8;
  /** Creator UI swatch; a reference value, not a shader input. */
  selectorSwatch?: Rgb8;
  /** hair.mt parameter overrides after the material-instance chain. */
  material: Partial<HairMaterialParameters>;
  profile: { depotPath: string; candidates: HairProfileCandidate[]; override?: string };
};

const validRgb = (v: unknown): v is Rgb8 =>
  Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const u64 = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= 18446744073709551615n;
const archiveName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\\/]/.test(v);
const LEGACY_BASE_PROFILE = "57b9999e9918137ada13e536ccc130caca48f6aca08290525063b54b9e2cdcec";

function validStops(stops: unknown, name: string): Stop[] {
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > 32 ||
      stops.some(s => !s || typeof s !== "object" || !Number.isFinite(s.value) ||
        s.value < 0 || s.value > 1 || !validRgb(s.color))) throw Error(`Invalid strand profile ${name} gradient`);
  return stops as Stop[];
}

/** Accepts v2 and the legacy v1 single-profile lash manifest (vanilla eyelash .mi values assumed, and reported). */
export function parseLashProfile(input: unknown): StrandProfileManifest {
  if (!input || typeof input !== "object") throw Error("Invalid lash profile manifest");
  const m = input as Record<string, unknown>;
  if (!u64(m.appearanceHash) || typeof m.definition !== "string" || !m.definition || m.definition.length > 128 ||
      !validRgb(m.strandId) || !validRgb(m.strandGradient) || (m.selectorSwatch !== undefined && !validRgb(m.selectorSwatch)))
    throw Error("Invalid strand profile identity or placeholder samples");
  const base = { schema: "xfs/lash-profile-preview-2" as const, appearanceHash: m.appearanceHash, definition: m.definition,
    strandId: m.strandId, strandGradient: m.strandGradient, ...(m.selectorSwatch ? { selectorSwatch: m.selectorSwatch as Rgb8 } : {}) };
  if (m.schema === "xfs/lash-profile-preview-1") {
    if (!digest(m.profileResourceSha256)) throw Error("Invalid legacy lash profile digest");
    return { ...base, material: { ...EYELASH_DEFAULT_MI_OVERRIDES }, profile: { depotPath: "(legacy manifest)", candidates: [{
      archive: m.profileResourceSha256 === LEGACY_BASE_PROFILE ? "basegame_4_appearance.archive" : "(legacy manifest)",
      scope: "base", profileResourceSha256: m.profileResourceSha256, sampleCount: 127,
      id: validStops(m.id, "id"), rootToTip: validStops(m.rootToTip, "rootToTip") }] } };
  }
  if (m.schema !== "xfs/lash-profile-preview-2") throw Error("Unsupported lash profile manifest");
  const profile = m.profile as Record<string, unknown> | undefined;
  if (!profile || typeof profile.depotPath !== "string" || !profile.depotPath || profile.depotPath.length > 400 ||
      !Array.isArray(profile.candidates) || profile.candidates.length < 1 || profile.candidates.length > 16 ||
      (profile.override !== undefined && !archiveName(profile.override)))
    throw Error("Invalid strand profile provider list");
  const seen = new Set<string>();
  const candidates = profile.candidates.map((raw: unknown): HairProfileCandidate => {
    const c = raw as Record<string, unknown>;
    if (!c || !archiveName(c.archive) || seen.has(c.archive) || (c.scope !== "mod" && c.scope !== "base") ||
        !digest(c.profileResourceSha256) || (c.containerSha256 !== undefined && !digest(c.containerSha256)) ||
        !Number.isInteger(c.sampleCount) || (c.sampleCount as number) < 2 || (c.sampleCount as number) > 1024)
      throw Error("Invalid strand profile candidate");
    seen.add(c.archive);
    return { archive: c.archive, scope: c.scope, ...(c.containerSha256 ? { containerSha256: c.containerSha256 as string } : {}),
      profileResourceSha256: c.profileResourceSha256, sampleCount: c.sampleCount as number,
      id: validStops(c.id, "id"), rootToTip: validStops(c.rootToTip, "rootToTip") };
  });
  resolveHairMaterial(m.material);
  return { ...base, material: m.material as Partial<HairMaterialParameters>,
    profile: { depotPath: profile.depotPath, candidates, ...(profile.override ? { override: profile.override as string } : {}) } };
}

/**
 * Linear albedo the compiled hair.mt base-colour pass writes for a strand
 * detail with constant Strand_ID / Strand_Gradient samples. Lighting (the
 * deferred hair BRDF) is not part of this value.
 */
export function strandAlbedo(manifest: StrandProfileManifest, candidate: HairProfileCandidate,
                             encoding: ProfileEncoding = "srgb-decoded", vertexRed = 0): Rgb {
  const material = resolveHairMaterial(manifest.material);
  const n = candidate.sampleCount;
  const id = bakedSample(bakeHairProfile(candidate.id, n, encoding), profileIndex(manifest.strandId[0] / 255, n));
  const root = bakedSample(bakeHairProfile(candidate.rootToTip, n, encoding), profileIndex(manifest.strandGradient[0] / 255, n));
  return hairFragmentColor(root, id, vertexRed, material);
}

export type SavedLashAppearance = {
  appearanceHash: string;
  definition: string;
  color: THREE.Color;
  roughness: number;
  alphaCutoff: number;
  encoding: ProfileEncoding;
  profile: { depotPath: string; winner: string; basis: DepotResolution<HairProfileCandidate>["basis"]; note: string;
    profileResourceSha256: string };
  candidates: { archive: string; scope: DepotScope; albedoSrgb: Rgb8 }[];
};

export function savedLashAppearance(manifest: StrandProfileManifest,
                                    encoding: ProfileEncoding = "srgb-decoded"): SavedLashAppearance {
  const material = resolveHairMaterial(manifest.material);
  const resolution = resolveDepotCandidate(manifest.profile.candidates, manifest.profile.override);
  if (!resolution.winner) throw Error(`Strand profile provider unresolved: ${resolution.note}`);
  const albedo = strandAlbedo(manifest, resolution.winner, encoding);
  return {
    appearanceHash: manifest.appearanceHash, definition: manifest.definition,
    color: new THREE.Color().setRGB(Math.min(1, albedo[0]), Math.min(1, albedo[1]), Math.min(1, albedo[2]), THREE.LinearSRGBColorSpace),
    // G-buffer roughness = saturate(RoughnessScale * ID + RoughnessBias); ShadowStrength only moves it for painted vertices.
    roughness: Math.min(1, Math.max(0, material.roughnessScale * manifest.strandId[0] / 255 + material.roughnessBias)),
    alphaCutoff: material.alphaCutoff,
    encoding,
    profile: { depotPath: manifest.profile.depotPath, winner: resolution.winner.archive, basis: resolution.basis,
      note: resolution.note, profileResourceSha256: resolution.winner.profileResourceSha256 },
    candidates: manifest.profile.candidates.map(c => ({ archive: c.archive, scope: c.scope,
      albedoSrgb: strandAlbedo(manifest, c, encoding).map(v => Math.round(linearToSrgb8(v))) as Rgb8 })),
  };
}

export async function loadSavedLashAppearance(): Promise<SavedLashAppearance | undefined> {
  const response = await fetch("/assets/lashes/profile.json", { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw Error(`Local lash profile: HTTP ${response.status}`);
  return savedLashAppearance(parseLashProfile(await response.json()));
}
