import type { SavedV } from "./save-reader";

export type PiercingPart = { mesh: string; mask: string };
export type PiercingChoice = {
  definition: string; index: number; label: string; swatch: string; previewColor: string; parts: PiercingPart[];
};
export type PiercingStyle = {
  id: string; index: number; label: string; resourceHash: string; choices: PiercingChoice[];
};
export type PiercingAsset = { id: string; url: string; sha256: string };
export type PiercingManifest = {
  schema: "xfs/local-vanilla-piercings-2" | "xfs/local-prc-piercings-1"; source: string;
  assets: PiercingAsset[]; styles: PiercingStyle[];
};
const hash = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 20 && /^[1-9][0-9]*$/.test(v) && BigInt(v) <= 18446744073709551615n;
const uint64 = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 20 && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= 18446744073709551615n;
const text = (v: unknown, length = 128): v is string => typeof v === "string" && v.length > 0 && v.length <= length;

export function parsePiercingManifest(value: unknown): PiercingManifest {
  const m = value as PiercingManifest;
  if (!m || !["xfs/local-vanilla-piercings-2", "xfs/local-prc-piercings-1"].includes(m.schema) || !text(m.source, 200) ||
    !Array.isArray(m.assets) || m.assets.length < 1 || m.assets.length > 8 ||
    !Array.isArray(m.styles) || m.styles.length < 1 || m.styles.length > 32)
    throw Error("Unsupported local piercing manifest");
  const assets = new Set<string>();
  for (const a of m.assets) {
    if (!a || !text(a.id) || !/^[a-z0-9_]+$/.test(a.id) || assets.has(a.id) ||
      !new RegExp(`^/assets/${m.schema === "xfs/local-prc-piercings-1" ? "prc" : "piercings"}/[a-z0-9_-]+\\.glb$`).test(a.url) ||
      !/^[0-9a-f]{64}$/.test(a.sha256))
      throw Error("Invalid local piercing mesh entry");
    assets.add(a.id);
  }
  const styles = new Set<string>();
  for (const s of m.styles) {
    if (!s || !text(s.id) || styles.has(s.id) || !Number.isSafeInteger(s.index) || s.index < 1 ||
      !text(s.label) || !hash(s.resourceHash) || !Array.isArray(s.choices) ||
      s.choices.length < 1 || s.choices.length > 32) throw Error("Invalid local piercing style");
    styles.add(s.id);
    const definitions = new Set<string>();
    for (const c of s.choices) {
      if (!c || !text(c.definition) || definitions.has(c.definition) || !Number.isSafeInteger(c.index) ||
        c.index < 1 || !text(c.label) || !/^#[0-9a-f]{6}$/i.test(c.swatch) ||
        !/^#[0-9a-f]{6}$/i.test(c.previewColor) ||
        !Array.isArray(c.parts) || c.parts.length < 1 || c.parts.length > 8 ||
        c.parts.some(p => !p || !assets.has(p.mesh) || !uint64(p.mask)))
        throw Error("Invalid local piercing appearance");
      definitions.add(c.definition);
    }
  }
  return m;
}

export function savedPiercing(manifest: PiercingManifest, save?: SavedV):
  { style: PiercingStyle; choice: PiercingChoice } | undefined {
  if (!save || save.isMale) return undefined;
  const appearances = save.groups.head.flatMap(g => g.appearances);
  const matches = manifest.styles.flatMap(style => style.choices
    .filter(choice => appearances.some(a => a.resourceHash === style.resourceHash && a.definition === choice.definition))
    .map(choice => ({ style, choice })));
  return matches.length === 1 ? matches[0] : undefined;
}

/** REDengine's decimal 64-bit mask is a set of visible zero-based mesh chunks. */
export function chunkEnabled(mask: string, chunk: number): boolean {
  if (!uint64(mask) || !Number.isSafeInteger(chunk) || chunk < 0 || chunk >= 64) return false;
  return (BigInt(mask) & (1n << BigInt(chunk))) !== 0n;
}

export async function verifyPiercingBytes(bytes: Uint8Array, expected: string) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    b => b.toString(16).padStart(2, "0")).join("");
  if (digest !== expected) throw Error("Local piercing asset does not match its recorded SHA-256");
}
