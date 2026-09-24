import * as THREE from "three";

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

/** This is the 2.31 double-diffuse post-G-buffer coverage at default contrast,
 * with the style-18 secondary intensity and the template's zero mask influence. */
export function browCoverage(primaryAlpha: number, secondaryAlpha: number): number {
  const p = THREE.MathUtils.clamp(primaryAlpha, 0, 1);
  const s = THREE.MathUtils.clamp(secondaryAlpha, 0, 1);
  const combined = p + (1 - p) * s * 0.7;
  return combined * combined;
}

export function createSavedBrowMaterial(primary: THREE.Texture, secondary: THREE.Texture,
                                        gradient: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: primary,
    alphaMap: secondary,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.01,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.browGradient = { value: gradient };
    shader.uniforms.browSecondaryColor = { value: new THREE.Color(0x3e312a) };
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_pars_fragment>",
      "#include <map_pars_fragment>\nuniform sampler2D browGradient;\nuniform vec3 browSecondaryColor;",
    );
    // Both alphas must be sampled through their actual filtered UVs BEFORE the
    // nonlinear square. Baking per-texel coverage then filtering changes fine hairs.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `vec4 browPrimary = texture2D(map, vMapUv);
       vec4 browSecondary = texture2D(alphaMap, vAlphaMapUv);
       float browP = clamp(browPrimary.a, 0.0, 1.0);
       float browS = clamp(browSecondary.a, 0.0, 1.0);
       vec3 browGradientColor = clamp(texture2D(browGradient, vec2(1.0, 0.5)).rgb * 0.5, 0.0, 1.0);
       vec3 browColor = browGradientColor * browPrimary.rgb +
         browSecondaryColor * (browS * (1.0 - browPrimary.a) * 0.7);
       diffuseColor.rgb *= browColor;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphamap_fragment>",
      `float browCombined = browP + (1.0 - browP) * browS * 0.7;
       diffuseColor.a *= browCombined * browCombined;`,
    );
  };
  material.customProgramCacheKey = () => "xfs-saved-brow-double-diffuse-v1";
  return material;
}

export async function loadSavedBrowMaterial(loader: THREE.TextureLoader,
                                             anisotropy: number): Promise<THREE.MeshStandardMaterial | undefined> {
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
    return createSavedBrowMaterial(loaded[0]!, loaded[1]!, loaded[2]!);
  } catch (error) {
    for (const t of loaded) t.dispose();
    throw error;
  }
}
