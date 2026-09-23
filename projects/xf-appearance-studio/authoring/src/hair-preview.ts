import type { SavedV } from "./save-reader";

/** Local resolved source; a future MO2, Vortex or manual adapter can emit this contract. */
export type HairAsset = {
  resourceHash: string;
  definition: string;
  label: string;
  parts: { url: string; sha256: string }[];
  alpha: { url: string; sha256: string };
};
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 18446744073709551615n;
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export function parseHairManifest(value: unknown): HairAsset[] {
  const manifest = value as { schema?: unknown; entries?: unknown } | null;
  if (!manifest || manifest.schema !== "xfs/local-hair-assets-1" || !Array.isArray(manifest.entries) || manifest.entries.length > 16)
    throw Error("Unsupported local hair asset manifest");
  const keys = new Set<string>();
  return manifest.entries.map((entry: unknown) => {
    const e = entry as HairAsset;
    if (!e || !hash(e.resourceHash) || typeof e.definition !== "string" || !e.definition || e.definition.length > 128 ||
      typeof e.label !== "string" || !e.label || e.label.length > 128 ||
      !Array.isArray(e.parts) || e.parts.length < 1 || e.parts.length > 8 ||
      e.parts.some(p => !p || !/^\/assets\/hair\/[a-z0-9_-]+\.glb$/.test(p.url) || !digest(p.sha256)) ||
      !e.alpha || !/^\/assets\/hair\/[a-z0-9_-]+\.png$/.test(e.alpha.url) || !digest(e.alpha.sha256))
      throw Error("Invalid local hair asset entry");
    const key = JSON.stringify([e.resourceHash, e.definition]);
    if (keys.has(key)) throw Error("Duplicate local hair appearance identity");
    keys.add(key);
    return { resourceHash: e.resourceHash, definition: e.definition, label: e.label,
      parts: e.parts.map(p => ({ url: p.url, sha256: p.sha256 })), alpha: { ...e.alpha } };
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
