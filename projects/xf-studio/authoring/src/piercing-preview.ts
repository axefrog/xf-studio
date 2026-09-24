import type { SavedV } from "./save-reader";

export type PiercingPart = {
  mesh: string; mask: string;
  /** Source-specific, approximate colour for a mesh chunk that does not follow the selected appearance. */
  chunkColors?: { index: number; color: string }[];
};
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

/** One framework appearance chooses one colour for all resolved PRC slots. */
export function aggregatePrcStyle(diagnostics: PiercingStyle[]): PiercingStyle {
  if (diagnostics.length < 2 || diagnostics.length > 8) throw Error("Invalid PRC aggregate size");
  const first = diagnostics[0]!;
  if (!first.choices.length || first.choices.length > 32 || new Set(diagnostics.map(s => s.id)).size !== diagnostics.length)
    throw Error("Invalid PRC diagnostic styles");
  const choices = first.choices.map(choice => {
    const parts = diagnostics.map(style => {
      const match = style.choices.find(c => c.definition === choice.definition);
      if (style.resourceHash !== first.resourceHash || style.choices.length !== first.choices.length || !match ||
        match.index !== choice.index || match.previewColor !== choice.previewColor ||
        match.parts.length !== 1)
        throw Error("PRC slots do not share one verified appearance and colour");
      return match.parts[0]!;
    });
    if (new Set(parts.map(p => p.mesh)).size !== parts.length) throw Error("Duplicate PRC aggregate mesh");
    return { ...choice, parts };
  });
  return { id: "prc_active_bank", index: 12,
    label: `PRC · combined ${diagnostics.map(s => s.index).join("+")} (approx.)`,
    resourceHash: first.resourceHash, choices };
}
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
        c.parts.some(p => !p || !assets.has(p.mesh) || !uint64(p.mask) ||
          (p.chunkColors !== undefined && (!Array.isArray(p.chunkColors) || p.chunkColors.length > 8 ||
            new Set(p.chunkColors.map(x => x?.index)).size !== p.chunkColors.length ||
            p.chunkColors.some(x => !x || !Number.isSafeInteger(x.index) || x.index < 0 || x.index >= 64 ||
              !chunkEnabled(p.mask, x.index) || !/^#[0-9a-f]{6}$/i.test(x.color))))))
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

export function piercingPartColor(part: PiercingPart, chunk: number, selectedColor: string): string {
  return part.chunkColors?.find(x => x.index === chunk)?.color ?? selectedColor;
}

export async function verifyPiercingBytes(bytes: Uint8Array, expected: string) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    b => b.toString(16).padStart(2, "0")).join("");
  if (digest !== expected) throw Error("Local piercing asset does not match its recorded SHA-256");
}
