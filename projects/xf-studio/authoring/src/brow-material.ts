import * as THREE from "three";
import { decodeSrgbByte, nearestVertices, sampleAtVertices } from "./decal-underlay";
import { imageTexels, type SkinImage, type SkinTexels } from "./skin-material";

/**
 * Adapter for `mesh_decal_double_diffuse.mt` (the brows' post-G-buffer decal), driven by the material's
 * resolved parameters. Formula and grades: research/eye-artistry/brow-lash-fidelity.md [source].
 */
export type DoubleDiffuseParameters = {
  /** `UseGradientMap`: the primary tint comes from the gradient instead of `DiffuseColor`. */
  useGradient: boolean;
  /** `GradientMapUV` (U of the constant gradient sample) and `GradientMapIntensity`. */
  gradientUV: number; gradientIntensity: number;
  /** `DiffuseColor` and `SecondaryDiffuseColor`, 8-bit sRGB as stored. */
  diffuseColor: readonly [number, number, number]; secondaryColor: readonly [number, number, number];
  /** `SecondaryDiffuseAlphaIntensity`. */
  secondaryIntensity: number;
};
/** The vanilla default brow instance (`eyebrows_grad__default.mi` chain) values [resource]. */
export const DOUBLE_DIFFUSE_BROW_DEFAULTS: Readonly<DoubleDiffuseParameters> = Object.freeze<DoubleDiffuseParameters>({
  useGradient: true, gradientUV: 1, gradientIntensity: 0.5, diffuseColor: [103, 81, 71], secondaryColor: [62, 49, 42], secondaryIntensity: 0.7 });

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Effective scalars and colours of a resolved chunk → the adapter's parameters (template defaults already applied). */
export function doubleDiffuseParameters(scalars: Readonly<Record<string, number>>,
  colours: Readonly<Record<string, readonly number[]>>): DoubleDiffuseParameters {
  const rgb = (name: string, fallback: readonly [number, number, number]) => {
    const value = colours[name];
    return value && value.length >= 3 ? [value[0]!, value[1]!, value[2]!] as const : fallback;
  };
  const scalar = (name: string, fallback: number) => Number.isFinite(scalars[name]) ? scalars[name]! : fallback;
  return { useGradient: scalar("UseGradientMap", 0) >= 0.5, gradientUV: clamp01(scalar("GradientMapUV", 1)),
    gradientIntensity: Math.max(0, scalar("GradientMapIntensity", 1)), diffuseColor: rgb("DiffuseColor", [255, 255, 255]),
    secondaryColor: rgb("SecondaryDiffuseColor", [255, 255, 255]), secondaryIntensity: clamp01(scalar("SecondaryDiffuseAlphaIntensity", 0)) };
}

/** The 2.31 double-diffuse post-G-buffer coverage at default contrast and the template's zero mask
 * influence; `secondaryIntensity` is `SecondaryDiffuseAlphaIntensity` (0.7 in the vanilla brows). */
export function browCoverage(primaryAlpha: number, secondaryAlpha: number, secondaryIntensity = 0.7): number {
  const p = THREE.MathUtils.clamp(primaryAlpha, 0, 1);
  const s = THREE.MathUtils.clamp(secondaryAlpha, 0, 1);
  const combined = p + (1 - p) * s * secondaryIntensity;
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
export function createDoubleDiffuseDecalMaterial(primary: THREE.Texture, secondary: THREE.Texture,
                                        gradient: THREE.Texture,
                                        options: { gbufferBlend?: boolean; parameters?: DoubleDiffuseParameters } = {}): THREE.MeshStandardMaterial {
  const parameters = options.parameters ?? DOUBLE_DIFFUSE_BROW_DEFAULTS;
  const srgb = (rgb: readonly [number, number, number]) => new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
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
    shader.uniforms.browSecondaryColor = { value: srgb(parameters.secondaryColor) };
    shader.uniforms.browDiffuseColor = { value: srgb(parameters.diffuseColor) };
    shader.uniforms.browGradientParams = { value: new THREE.Vector4(parameters.useGradient ? 1 : 0, parameters.gradientUV,
      parameters.gradientIntensity, parameters.secondaryIntensity) };
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
uniform vec3 browSecondaryColor, browDiffuseColor;
uniform vec4 browGradientParams;
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
       // UseGradientMap: the gradient at (GradientMapUV, 0.5) × GradientMapIntensity replaces DiffuseColor.
       vec3 browGradientColor = browGradientParams.x > 0.5
         ? clamp(texture2D(browGradient, vec2(browGradientParams.y, 0.5)).rgb * browGradientParams.z, 0.0, 1.0)
         : browDiffuseColor;
       vec3 browColor = browGradientColor * browPrimary.rgb +
         browSecondaryColor * (browS * (1.0 - browPrimary.a) * browGradientParams.w);
       float browCombined = browP + (1.0 - browP) * browS * browGradientParams.w;
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
  material.customProgramCacheKey = () => `xfs-double-diffuse-decal-v3${options.gbufferBlend ? "-gbuffer" : ""}`;
  return material;
}

/**
 * Per-vertex linear albedo of the surface under each target vertex: nearest
 * source vertex (same bind space), its UV, bilinear sample of an sRGB8 RGBA
 * image (or a lazily toned one, read only at these texels). Pure over typed arrays so it is testable without a GPU.
 */
export function sampleUnderlayAlbedo(targetPositions: ArrayLike<number>, sourcePositions: ArrayLike<number>,
                                     sourceUvs: ArrayLike<number>,
                                     source: SkinImage | SkinTexels,
                                     maxDistance = 0.02): { underlay: Float32Array; maxMatchedDistance: number; unmatched: number } {
  const nearest = nearestVertices(targetPositions, sourcePositions, maxDistance);
  const image = "texel" in source ? source : imageTexels(source);
  const underlay = sampleAtVertices(nearest, sourceUvs, image, 3, decodeSrgbByte);
  return { underlay, maxMatchedDistance: nearest.maxMatchedDistance, unmatched: nearest.unmatched };
}
