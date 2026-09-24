import * as THREE from "three";

type Stop = { value: number; color: [number, number, number] };
export type LashProfileManifest = {
  schema: "xfs/lash-profile-preview-1";
  appearanceHash: "6047185506343464350";
  definition: "05_brown_liquorice";
  profileResourceSha256: string;
  strandId: [number, number, number];
  strandGradient: [number, number, number];
  selectorSwatch: [number, number, number];
  id: Stop[];
  rootToTip: Stop[];
};

const validRgb = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 255);

export function parseLashProfile(input: unknown): LashProfileManifest {
  if (!input || typeof input !== "object") throw Error("Invalid lash profile manifest");
  const m = input as Record<string, unknown>;
  if (m.schema !== "xfs/lash-profile-preview-1" || m.appearanceHash !== "6047185506343464350" ||
      m.definition !== "05_brown_liquorice" || typeof m.profileResourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(m.profileResourceSha256) || !validRgb(m.strandId) ||
      !validRgb(m.strandGradient) || !validRgb(m.selectorSwatch)) throw Error("Lash profile does not match the saved appearance");
  for (const key of ["id", "rootToTip"] as const) {
    const stops = m[key];
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 32 ||
        stops.some(s => !s || typeof s !== "object" || !Number.isFinite(s.value) ||
          s.value < 0 || s.value > 1 || !validRgb(s.color)) ||
        new Set(stops.map(s => s.value)).size !== stops.length) throw Error(`Invalid lash ${key} gradient`);
  }
  return input as LashProfileManifest;
}

export function sampleStops(stops: Stop[], t: number): [number, number, number] {
  const sorted = [...stops].sort((a, b) => a.value - b.value);
  if (t <= sorted[0]!.value) return [...sorted[0]!.color];
  if (t >= sorted.at(-1)!.value) return [...sorted.at(-1)!.color];
  const next = sorted.findIndex(s => s.value >= t), a = sorted[next - 1]!, b = sorted[next]!;
  const f = (t - a.value) / (b.value - a.value);
  return a.color.map((v, i) => v + (b.color[i]! - v) * f) as [number, number, number];
}

/** Preview approximation, not a port of REDengine's anisotropic hair shader.
 * The installed lash material samples constant grey Strand_ID and white
 * Strand_Gradient placeholders, so this particular mesh has no image-driven
 * per-strand or root/tip colour variation. The saved selector swatch anchors
 * one scalar exposure, while the profile preserves its channel balance. */
export function approximateLashColor(profile: LashProfileManifest): THREE.Color {
  const id = sampleStops(profile.id, profile.strandId[0] / 255);
  const tip = sampleStops(profile.rootToTip, profile.strandGradient[0] / 255);
  const product = id.map((v, i) => v * tip[i]! / 255);
  const swatch = profile.selectorSwatch;
  const denominator = product.reduce((n, v) => n + v * v, 0);
  const exposure = denominator ? product.reduce((n, v, i) => n + v * swatch[i]!, 0) / denominator : 1;
  const rgb = product.map(v => Math.max(0, Math.min(255, Math.round(v * exposure))));
  return new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
}

export async function loadSavedLashColor(): Promise<THREE.Color | undefined> {
  const response = await fetch("/assets/lashes/profile.json", { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw Error(`Local lash profile: HTTP ${response.status}`);
  return approximateLashColor(parseLashProfile(await response.json()));
}
