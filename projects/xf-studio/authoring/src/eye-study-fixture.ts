/**
 * Research fixture for `/render-fidelity-study.html` only: the historical, hash-pinned saved-eye image pair a
 * study page compares browser materials with (`tools/stage-private-eye-study.ts` stages it into ignored assets).
 * The product preview never reads it: the shown V's eyes come from the resolved character record
 * (character-detail-*.ts, eye-material.ts), and a boundary test keeps every rendering module from importing this.
 */
/** One staged saved-eye image pair for the study (historical, one pinned choice; never a resolver result). */
export type EyeAsset = {
  resourceHash: string;
  definition: string;
  label: string;
  url: string;
  sha256: string;
  width: number;
  height: number;
  /** Exact local source map for the opt-in, browser-only eye material study. */
  roughness?: { url: string; sha256: string; width: number; height: number; scale: number };
  providers: { name: string; author: string; version: string; url: string }[];
};

export function parseEyeManifest(value: unknown): EyeAsset[] {
  const manifest = value as { schema?: unknown; entries?: unknown } | null;
  if (!manifest || !["xfs/local-eye-assets-1", "xfs/local-eye-assets-2"].includes(String(manifest.schema)) ||
      !Array.isArray(manifest.entries) || manifest.entries.length > 32)
    throw Error("Unsupported local eye asset manifest");
  const keys = new Set<string>();
  return manifest.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw Error("Invalid eye asset entry");
    const e = entry as EyeAsset;
    const string = (s: unknown, max: number) => typeof s === "string" && s.length > 0 && s.length <= max;
    const image = (url: unknown, sha256: unknown, width: unknown, height: unknown) =>
      typeof url === "string" && /^\/assets\/eyes\/[a-z0-9_-]+\.png$/.test(url) &&
      typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256) &&
      Number.isInteger(width) && (width as number) >= 1 && (width as number) <= 4096 &&
      Number.isInteger(height) && (height as number) >= 1 && (height as number) <= 4096;
    if (!string(e.resourceHash, 20) || !/^[1-9][0-9]*$/.test(e.resourceHash) || BigInt(e.resourceHash) > 18446744073709551615n ||
        !string(e.definition, 256) || !string(e.label, 256) ||
        !image(e.url, e.sha256, e.width, e.height) ||
        (e.roughness !== undefined && (manifest.schema !== "xfs/local-eye-assets-2" ||
          !e.roughness || !image(e.roughness.url, e.roughness.sha256, e.roughness.width, e.roughness.height) ||
          typeof e.roughness.scale !== "number" || !Number.isFinite(e.roughness.scale) ||
          e.roughness.scale <= 0 || e.roughness.scale > 5)) ||
        !Array.isArray(e.providers) || e.providers.length < 1 || e.providers.length > 8 ||
        e.providers.some(p => !p || !string(p.name, 256) || !string(p.author, 256) || !string(p.version, 64) ||
          !string(p.url, 1024) || !/^https:\/\//.test(p.url))) throw Error("Invalid eye asset entry");
    const key = JSON.stringify([e.resourceHash, e.definition]);
    if (keys.has(key)) throw Error("Duplicate local eye appearance identity");
    keys.add(key);
    return { resourceHash: e.resourceHash, definition: e.definition, label: e.label, url: e.url,
      sha256: e.sha256, width: e.width, height: e.height,
      ...(e.roughness ? { roughness: { ...e.roughness } } : {}), providers: e.providers.map(p => ({ ...p })) };
  });
}

export async function verifyEyeBytes(bytes: Uint8Array, expected: string) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const actual = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw Error("Local eye image does not match its recorded SHA-256");
}

/** The inspected game eye shader reads roughness R; Three MeshStandardMaterial
 * reads roughnessMap G. Copy the source red bytes into green without gamma. */
export function roughnessRedToGreen(source: Uint8ClampedArray | Uint8Array) {
  if (!source.length || source.length % 4) throw Error("Expected RGBA eye roughness pixels");
  const pixels = new Uint8Array(source);
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 1] = pixels[i];
  return pixels;
}

