import * as THREE from "three";
import { createDoubleDiffuseDecalMaterial } from "./brow-material";

/**
 * Research fixture for the render-fidelity study page only: the historical private brow manifest bound
 * to one saved appearance. The Studio preview never reads it; its brows come from the resolved
 * character record (character-detail-loader.ts). Kept so the study stays reproducible.
 */
/** Local, save-specific research assets. No extracted image is part of the source tree. */
type ImageEntry = { url: string; sha256: string; width: number; height: number };
export type BrowManifest = {
  schema: "xfs/brow-preview-1";
  appearanceHash: "10685882159528859062";
  definition: "10_brown_ombre";
  primary: ImageEntry;
  secondary: ImageEntry;
  gradient: ImageEntry;
};

export function parseBrowManifest(input: unknown): BrowManifest {
  if (!input || typeof input !== "object") throw Error("Invalid brow manifest");
  const m = input as Record<string, unknown>;
  if (m.schema !== "xfs/brow-preview-1" || m.appearanceHash !== "10685882159528859062" ||
      m.definition !== "10_brown_ombre") throw Error("Brow manifest does not match the saved appearance");
  for (const key of ["primary", "secondary", "gradient"] as const) {
    const entry = m[key];
    if (!entry || typeof entry !== "object") throw Error(`Missing ${key} brow image`);
    const e = entry as Record<string, unknown>;
    if (typeof e.url !== "string" || !/^\/assets\/brows\/[a-z-]+\.png$/.test(e.url) ||
        typeof e.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.sha256) ||
        !Number.isInteger(e.width) || !Number.isInteger(e.height) ||
        (e.width as number) < 1 || (e.height as number) < 1 ||
        (e.width as number) > 4096 || (e.height as number) > 4096)
      throw Error(`Invalid ${key} brow image metadata`);
  }
  return input as BrowManifest;
}

export async function verifyBrowImage(bytes: ArrayBuffer, expected: string): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw Error("Local brow image digest mismatch");
}

export async function loadSavedBrowMaterial(loader: THREE.TextureLoader, anisotropy: number,
                                             options: { gbufferBlend?: boolean } = {}): Promise<THREE.MeshStandardMaterial | undefined> {
  const response = await fetch("/assets/brows/manifest.json", { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw Error(`Local brow manifest: HTTP ${response.status}`);
  const manifest = parseBrowManifest(await response.json());
  const loaded: THREE.Texture[] = [];
  try {
    for (const entry of [manifest.primary, manifest.secondary, manifest.gradient]) {
      const imageResponse = await fetch(entry.url, { signal: AbortSignal.timeout(10000) });
      if (!imageResponse.ok) throw Error(`Local brow image: HTTP ${imageResponse.status}`);
      const bytes = await imageResponse.arrayBuffer();
      await verifyBrowImage(bytes, entry.sha256);
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      try {
        const texture = await loader.loadAsync(objectUrl);
        if (texture.image.width !== entry.width || texture.image.height !== entry.height) {
          texture.dispose(); throw Error("Local brow image dimensions do not match its manifest");
        }
        texture.flipY = false;
        texture.colorSpace = loaded.length === 1 ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        if (loaded.length === 2) texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        loaded.push(texture);
      } finally { URL.revokeObjectURL(objectUrl); }
    }
    return createDoubleDiffuseDecalMaterial(loaded[0]!, loaded[1]!, loaded[2]!, options);
  } catch (error) {
    for (const t of loaded) t.dispose();
    throw error;
  }
}
