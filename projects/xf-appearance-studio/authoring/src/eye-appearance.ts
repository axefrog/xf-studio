import type { Appearance } from "./save-reader";

/** A local resolution result, not a general game/MO2 load-order resolver. */
export type EyeAsset = {
  resourceHash: string;
  definition: string;
  label: string;
  url: string;
  sha256: string;
  width: number;
  height: number;
  providers: { name: string; author: string; version: string; url: string }[];
};
export type EyeAppearanceStatus = {
  kind: "reference" | "matched";
  reason: "no-save" | "unresolved" | "unavailable" | "ambiguous" | "matched";
  message: string;
  asset?: EyeAsset;
  error?: string;
};
type Reference = Pick<Appearance, "resourceHash" | "definition">;

export function parseEyeManifest(value: unknown): EyeAsset[] {
  const manifest = value as { schema?: unknown; entries?: unknown } | null;
  if (!manifest || manifest.schema !== "xfs/local-eye-assets-1" || !Array.isArray(manifest.entries) || manifest.entries.length > 32)
    throw Error("Unsupported local eye asset manifest");
  const keys = new Set<string>();
  return manifest.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw Error("Invalid eye asset entry");
    const e = entry as EyeAsset;
    const string = (s: unknown, max: number) => typeof s === "string" && s.length > 0 && s.length <= max;
    if (!string(e.resourceHash, 20) || !/^[1-9][0-9]*$/.test(e.resourceHash) || BigInt(e.resourceHash) > 18446744073709551615n ||
        !string(e.definition, 256) || !string(e.label, 256) ||
        typeof e.url !== "string" || !/^\/assets\/eyes\/[a-z0-9_-]+\.png$/.test(e.url) ||
        typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256) ||
        !Number.isInteger(e.width) || e.width < 1 || e.width > 4096 ||
        !Number.isInteger(e.height) || e.height < 1 || e.height > 4096 ||
        !Array.isArray(e.providers) || e.providers.length < 1 || e.providers.length > 8 ||
        e.providers.some(p => !p || !string(p.name, 256) || !string(p.author, 256) || !string(p.version, 64) ||
          !string(p.url, 1024) || !/^https:\/\//.test(p.url))) throw Error("Invalid eye asset entry");
    const key = JSON.stringify([e.resourceHash, e.definition]);
    if (keys.has(key)) throw Error("Duplicate local eye appearance identity");
    keys.add(key);
    return { resourceHash: e.resourceHash, definition: e.definition, label: e.label, url: e.url,
      sha256: e.sha256, width: e.width, height: e.height, providers: e.providers.map(p => ({ ...p })) };
  });
}

export function resolveEyeAsset(entries: EyeAsset[], appearances: readonly Reference[]) {
  return entries.filter(e => appearances.some(a => a.resourceHash === e.resourceHash && a.definition === e.definition));
}

export async function verifyEyeBytes(bytes: Uint8Array, expected: string) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const actual = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw Error("Local eye image does not match its recorded SHA-256");
}

const request = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error(`Local eye asset unavailable (${response.status})`);
  return response;
};

/** Preload before the scene is exposed. Every later selection is synchronous,
 * so an old save's delayed request can never replace a newer save's eye map. */
export async function prepareEyeAppearances<T>(decode: (bytes: Uint8Array, entry: EyeAsset) => Promise<T>, io = {
  manifest: async (): Promise<unknown> => (await request("/assets/eyes/manifest.json")).json(),
  bytes: async (url: string) => new Uint8Array(await (await request(url)).arrayBuffer()),
}) {
  let entries: EyeAsset[] = [], manifestError: string | undefined;
  const loaded = new Map<EyeAsset, T>(), errors = new Map<EyeAsset, string>();
  try { entries = parseEyeManifest(await io.manifest()); }
  catch (error) { manifestError = (error as Error).message; }
  await Promise.all(entries.map(async entry => {
    try {
      const bytes = await io.bytes(entry.url);
      await verifyEyeBytes(bytes, entry.sha256);
      loaded.set(entry, await decode(bytes, entry));
    } catch (error) { errors.set(entry, (error as Error).message); }
  }));
  return {
    select(appearances?: readonly Reference[]): { texture?: T; status: EyeAppearanceStatus } {
      const fallback = (reason: EyeAppearanceStatus["reason"], message: string, error?: string, asset?: EyeAsset) =>
        ({ status: { kind: "reference" as const, reason, message, ...(error ? { error } : {}), ...(asset ? { asset } : {}) } });
      if (!appearances) return fallback("no-save", "Eye colour uses the reference texture until a saved V is loaded.");
      if (manifestError) return fallback("unavailable", "Local eye assets are unavailable; using the reference eye texture.", manifestError);
      const matches = resolveEyeAsset(entries, appearances);
      if (matches.length > 1) return fallback("ambiguous", "Multiple local eye choices match this save; using the reference eye texture.");
      const asset = matches[0];
      if (!asset) return fallback("unresolved", "Saved eye colour is unresolved; using the reference eye texture.");
      if (!loaded.has(asset)) return fallback("unavailable", "The saved eye image is unavailable; using the reference eye texture.", errors.get(asset), asset);
      return { texture: loaded.get(asset)!, status: { kind: "matched", reason: "matched", asset,
        message: `Eye colour: ${asset.label}. Saved references match the local diffuse; eye shading remains approximate.` } };
    },
  };
}
