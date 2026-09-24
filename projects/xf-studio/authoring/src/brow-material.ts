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

/**
 * The 2.31 brow is a post-G-buffer decal: it writes sqrt(colour) with SrcAlpha
 * blending into a G-buffer whose albedo target also holds sqrt(albedo). With
 * `gbufferBlend`, a per-vertex `xfsUnderlay` (linear skin albedo under the
 * brow) lets an ordinary Three "over" blend reproduce that squared result; see
 * linearEquivalentDecal in hair-colour-model.ts. Without it, the older linear
 * blend is kept and reported as such.
 */
export function createSavedBrowMaterial(primary: THREE.Texture, secondary: THREE.Texture,
                                        gradient: THREE.Texture,
                                        options: { gbufferBlend?: boolean } = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: primary,
    alphaMap: secondary,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.01,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  if (options.gbufferBlend) material.defines = { ...material.defines, XFS_GBUFFER_DECAL: "" };
  material.onBeforeCompile = shader => {
    shader.uniforms.browGradient = { value: gradient };
    shader.uniforms.browSecondaryColor = { value: new THREE.Color(0x3e312a) };
    if (options.gbufferBlend && shader.vertexShader) {
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
        attribute vec3 xfsUnderlay;
        varying vec3 vXfsUnderlay;`).replace("#include <begin_vertex>", `#include <begin_vertex>
        vXfsUnderlay = xfsUnderlay;`);
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_pars_fragment>",
      `#include <map_pars_fragment>
uniform sampler2D browGradient;
uniform vec3 browSecondaryColor;
#ifdef XFS_GBUFFER_DECAL
varying vec3 vXfsUnderlay;
#endif`,
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
       float browCombined = browP + (1.0 - browP) * browS * 0.7;
       float browAlpha = browCombined * browCombined;
#ifdef XFS_GBUFFER_DECAL
       {
         vec3 underlay = max(vXfsUnderlay, vec3(0.0));
         vec3 target = a_pow2(browAlpha * sqrt(max(browColor, vec3(0.0))) + (1.0 - browAlpha) * sqrt(underlay));
         // Smallest "over" alpha that keeps every solved channel non-negative (linearEquivalentDecal).
         vec3 gap = underlay - browColor;
         vec3 needed = mix(vec3(0.0), (underlay - target) / max(gap, vec3(1e-6)), step(vec3(1e-6), gap));
         float solved = clamp(max(browAlpha, max(needed.r, max(needed.g, needed.b))), 0.0, 1.0);
         if (solved > 0.0) browColor = max(vec3(0.0), (target - (1.0 - solved) * underlay) / solved);
         browAlpha = solved;
       }
#endif
       diffuseColor.rgb *= browColor;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphamap_fragment>",
      `diffuseColor.a *= browAlpha;`,
    ).replace("#include <common>", `#include <common>
vec3 a_pow2(vec3 v) { return v * v; }`);
  };
  material.customProgramCacheKey = () => `xfs-saved-brow-double-diffuse-v2${options.gbufferBlend ? "-gbuffer" : ""}`;
  return material;
}

/**
 * Per-vertex linear albedo of the surface under each target vertex: nearest
 * source vertex (same bind space), its UV, bilinear sample of an sRGB8 RGBA
 * image. Pure over typed arrays so it is testable without a GPU.
 */
export function sampleUnderlayAlbedo(targetPositions: ArrayLike<number>, sourcePositions: ArrayLike<number>,
                                     sourceUvs: ArrayLike<number>,
                                     image: { width: number; height: number; data: ArrayLike<number> },
                                     maxDistance = 0.02): { underlay: Float32Array; maxMatchedDistance: number; unmatched: number } {
  const targets = targetPositions.length / 3, sources = sourcePositions.length / 3;
  const underlay = new Float32Array(targets * 3);
  const decode = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const texel = (x: number, y: number, c: number) => {
    const px = Math.min(image.width - 1, Math.max(0, x)), py = Math.min(image.height - 1, Math.max(0, y));
    return decode(image.data[(py * image.width + px) * 4 + c]!);
  };
  let maxMatchedDistance = 0, unmatched = 0;
  for (let t = 0; t < targets; t++) {
    const tx = targetPositions[t * 3]!, ty = targetPositions[t * 3 + 1]!, tz = targetPositions[t * 3 + 2]!;
    let best = -1, bestD = Infinity;
    for (let s = 0; s < sources; s++) {
      const dx = sourcePositions[s * 3]! - tx, dy = sourcePositions[s * 3 + 1]! - ty, dz = sourcePositions[s * 3 + 2]! - tz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = s; }
    }
    const distance = Math.sqrt(bestD);
    if (best < 0 || distance > maxDistance) { unmatched++; continue; }
    maxMatchedDistance = Math.max(maxMatchedDistance, distance);
    const u = (sourceUvs[best * 2]! % 1 + 1) % 1, v = (sourceUvs[best * 2 + 1]! % 1 + 1) % 1;
    const fx = u * image.width - 0.5, fy = v * image.height - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0;
    for (let c = 0; c < 3; c++)
      underlay[t * 3 + c] = (texel(x0, y0, c) * (1 - wx) + texel(x0 + 1, y0, c) * wx) * (1 - wy) +
        (texel(x0, y0 + 1, c) * (1 - wx) + texel(x0 + 1, y0 + 1, c) * wx) * wy;
  }
  return { underlay, maxMatchedDistance, unmatched };
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
    return createSavedBrowMaterial(loaded[0]!, loaded[1]!, loaded[2]!, options);
  } catch (error) {
    for (const t of loaded) t.dispose();
    throw error;
  }
}
