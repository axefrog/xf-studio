import type { SavedV } from "./save-reader";
import { resolveHairMaterial, type HairMaterialParameters } from "./hair-colour-model";

/** Local resolved source; a future MO2, Vortex or manual adapter can emit this contract. */
export type HairAsset = {
  resourceHash: string;
  definition: string;
  label: string;
  parts: { url: string; sha256: string }[];
  alpha: { url: string; sha256: string };
  /** Present for locally resolved CCXL strand/cap material chains. */
  profile?: {
    sourceSha256: string;
    /** CHairProfile.sampleCount; absent in legacy v2 manifests. */
    sampleCount?: number;
    id: HairStop[];
    rootToTip: HairStop[];
  };
  /** hair.mt parameters after the material-instance chain (v3). Absent: template defaults. */
  material?: HairMaterialParameters;
  strandId?: { url: string; sha256: string };
  strandGradient?: { url: string; sha256: string };
  capMask?: { url: string; sha256: string };
  capGradient?: { url: string; sha256: string };
};
export type HairStop = { value: number; color: [number, number, number] };
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 18446744073709551615n;
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const png = (value: unknown): value is { url: string; sha256: string } => {
  const file = value as { url?: unknown; sha256?: unknown } | null;
  return !!file && typeof file.url === "string" && /^\/assets\/hair\/[a-z0-9_-]+\.png$/.test(file.url) && digest(file.sha256);
};
const stops = (value: unknown): value is HairStop[] => Array.isArray(value) && value.length >= 2 && value.length <= 32 &&
  value.every((stop, i) => stop && typeof stop.value === "number" && Number.isFinite(stop.value) &&
    stop.value >= 0 && stop.value <= 1 && (i === 0 || stop.value >= value[i - 1].value) &&
    Array.isArray(stop.color) && stop.color.length === 3 && stop.color.every((c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 255));

export function parseHairManifest(value: unknown): HairAsset[] {
  const manifest = value as { schema?: unknown; entries?: unknown } | null;
  if (!manifest || !["xfs/local-hair-assets-1", "xfs/local-hair-assets-2", "xfs/local-hair-assets-3"].includes(manifest.schema as string) || !Array.isArray(manifest.entries) || manifest.entries.length > 16)
    throw Error("Unsupported local hair asset manifest");
  const keys = new Set<string>();
  return manifest.entries.map((entry: unknown) => {
    const e = entry as HairAsset;
    if (!e || !hash(e.resourceHash) || typeof e.definition !== "string" || !e.definition || e.definition.length > 128 ||
      typeof e.label !== "string" || !e.label || e.label.length > 128 ||
      !Array.isArray(e.parts) || e.parts.length < 1 || e.parts.length > 8 ||
      e.parts.some(p => !p || !/^\/assets\/hair\/[a-z0-9_-]+\.glb$/.test(p.url) || !digest(p.sha256)) ||
      !png(e.alpha))
      throw Error("Invalid local hair asset entry");
    const hasProfile = manifest.schema !== "xfs/local-hair-assets-1";
    const v3 = manifest.schema === "xfs/local-hair-assets-3";
    if (hasProfile && (!e.profile || !digest(e.profile.sourceSha256) || !stops(e.profile.id) ||
      !stops(e.profile.rootToTip) || !png(e.strandId) || !png(e.strandGradient) ||
      !png(e.capMask) || !png(e.capGradient)))
      throw Error("Invalid local hair profile/material chain");
    if (v3 && (!Number.isInteger(e.profile!.sampleCount) || e.profile!.sampleCount! < 2 || e.profile!.sampleCount! > 1024))
      throw Error("Invalid local hair profile sample count");
    let material: HairMaterialParameters | undefined;
    if (v3) {
      if (!e.material || typeof e.material !== "object") throw Error("Invalid local hair material: missing parameters");
      try { material = resolveHairMaterial(e.material); } catch (error) {
        throw Error(`Invalid local hair material: ${(error as Error).message}`);
      }
    }
    const key = JSON.stringify([e.resourceHash, e.definition]);
    if (keys.has(key)) throw Error("Duplicate local hair appearance identity");
    keys.add(key);
    return { resourceHash: e.resourceHash, definition: e.definition, label: e.label,
      parts: e.parts.map(p => ({ url: p.url, sha256: p.sha256 })), alpha: { ...e.alpha },
      ...(hasProfile ? { profile: { sourceSha256: e.profile!.sourceSha256,
        ...(v3 ? { sampleCount: e.profile!.sampleCount } : {}), id: e.profile!.id, rootToTip: e.profile!.rootToTip },
        strandId: e.strandId, strandGradient: e.strandGradient,
        capMask: e.capMask, capGradient: e.capGradient } : {}),
      ...(material ? { material } : {}) };
  });
}

export function selectSavedHair(entries: HairAsset[], save?: SavedV): HairAsset | undefined {
  if (!save) return undefined;
  const references = save.groups.head.filter(g => g.name === "hairs" || g.name === "character_customization")
    .flatMap(g => g.appearances);
  const matches = entries.filter(e => references.some(a => a.resourceHash === e.resourceHash && a.definition === e.definition));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function verifyHairBytes(bytes: Uint8Array, expected: string) {
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw Error("Local hair asset does not match its recorded SHA-256");
}
