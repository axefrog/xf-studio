import * as THREE from "three";
import type { HairStop } from "./hair-preview";
import { bakeHairProfile, sampleStopsEncoded, type HairMaterialParameters, type ProfileEncoding } from "./hair-colour-model";

/** Renderer adapter for the hair.mt colour model in hair-colour-model.ts.
 * Three keeps its own lighting; only base colour, coverage and roughness inputs
 * follow the compiled 2.31 programs. The deferred hair BRDF is not reproduced. */

/** Encoded-space sample of the source stops (kept for callers that display raw profile colours). */
export function sampleHairGradient(stops: HairStop[], value: number): [number, number, number] {
  return sampleStopsEncoded(stops, value).map(Math.round) as [number, number, number];
}

/** The profile as the shader reads it: row 0 = ID samples, row 1 = root-to-tip samples, linear floats. */
export function hairProfileTexture(profile: { id: HairStop[]; rootToTip: HairStop[] }, sampleCount: number,
                                   encoding: ProfileEncoding): THREE.DataTexture {
  const id = bakeHairProfile(profile.id, sampleCount, encoding);
  const root = bakeHairProfile(profile.rootToTip, sampleCount, encoding);
  const data = new Float32Array(sampleCount * 2 * 4);
  for (let k = 0; k < sampleCount; k++) {
    data.set([id[k * 3]!, id[k * 3 + 1]!, id[k * 3 + 2]!, 1], k * 4);
    data.set([root[k * 3]!, root[k * 3 + 1]!, root[k * 3 + 2]!, 1], (sampleCount + k) * 4);
  }
  const texture = new THREE.DataTexture(data, sampleCount, 2, THREE.RGBAFormat, THREE.FloatType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Copy COLOR_0.r into a dedicated attribute so Three's vertexColors multiply is never enabled. */
export function attachHairVertexRed(geometry: THREE.BufferGeometry): boolean {
  const color = geometry.getAttribute("color");
  const count = geometry.getAttribute("position").count;
  const red = new Float32Array(count);
  if (color) for (let i = 0; i < count; i++) red[i] = color.getX(i);
  geometry.setAttribute("xfsVertexRed", new THREE.BufferAttribute(red, 1));
  return !!color;
}

/** Coverage only (for flat-coloured strands such as lashes): Strand_Alpha.r remapped by AlphaCutoff. */
export function attachStrandCoverage(material: THREE.MeshStandardMaterial, alphaCutoff: number) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.uniforms.xfsAlphaCutoff = { value: alphaCutoff };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        uniform float xfsAlphaCutoff;`).replace("#include <alphamap_fragment>", STRAND_COVERAGE_GLSL);
  };
  const priorKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${priorKey()}-xfs-strand-coverage-1`;
}

const STRAND_COVERAGE_GLSL = `
        // Strand_Alpha.r remapped by AlphaCutoff (the game dithers with this probability).
        float strandAlpha = texture2D(alphaMap, vAlphaMapUv).r;
        diffuseColor.a *= xfsAlphaCutoff >= 1.0 ? 0.0 :
          clamp(max(strandAlpha - xfsAlphaCutoff, 0.0) / (1.0 - xfsAlphaCutoff), 0.0, 1.0);`;

type StrandSource = {
  kind: "strand"; id: THREE.Texture; gradient: THREE.Texture; profile: THREE.Texture;
  sampleCount: number; material: HairMaterialParameters;
};
type CapSource = { kind: "cap"; mask: THREE.Texture; gradient: THREE.Texture };

/** Strand GLSL mirrors hairFragmentColor/hairCoverage; cap keeps the gradient-recolor decal approximation. */
export function attachHairColor(material: THREE.MeshStandardMaterial, source: StrandSource | CapSource) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    if (source.kind === "strand") {
      const m = source.material;
      Object.assign(shader.uniforms, {
        xfsStrandId: { value: source.id }, xfsStrandGradient: { value: source.gradient },
        xfsProfile: { value: source.profile }, xfsProfileSamples: { value: source.sampleCount },
        xfsShadow: { value: new THREE.Vector3(m.shadowMin, m.shadowMax, m.shadowStrength) },
        xfsAlphaCutoff: { value: m.alphaCutoff },
      });
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
        attribute float xfsVertexRed;
        varying float vXfsVertexRed;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
        vXfsVertexRed = xfsVertexRed;`);
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        uniform sampler2D xfsStrandId, xfsStrandGradient, xfsProfile;
        uniform int xfsProfileSamples;
        uniform vec3 xfsShadow;
        uniform float xfsAlphaCutoff;
        varying float vXfsVertexRed;
        int xfsProfileIndex(float v) {
          // HLSL uint((N-1)*v): truncation into a baked row, never filtering.
          return clamp(int(float(xfsProfileSamples - 1) * max(v, 0.0)), 0, xfsProfileSamples - 1);
        }`)
        .replace("#include <map_fragment>", `#include <map_fragment>
        // Linear (isGamma=0) red channels, sampled with the material's own filtering.
        float strandId = texture2D(xfsStrandId, vAlphaMapUv).r;
        float rootTip = texture2D(xfsStrandGradient, vAlphaMapUv).r;
        vec3 idColor = texelFetch(xfsProfile, ivec2(xfsProfileIndex(strandId), 0), 0).rgb;
        vec3 rootColor = texelFetch(xfsProfile, ivec2(xfsProfileIndex(rootTip), 1), 0).rgb;
        // Overlay with root-to-tip as base; the branch uses its Rec.601 luminance.
        vec3 hairColor = dot(rootColor, vec3(0.3, 0.59, 0.11)) < 0.5
          ? 2.0 * idColor * rootColor
          : 1.0 - 2.0 * (1.0 - idColor) * (1.0 - rootColor);
        float shadowWidth = xfsShadow.y - xfsShadow.x;
        float shadowNumerator = 1.0 - vXfsVertexRed - xfsShadow.x;
        float shadowT = shadowWidth == 0.0 ? (shadowNumerator > 0.0 ? 1.0 : 0.0)
          : clamp(shadowNumerator / shadowWidth, 0.0, 1.0);
        float shadow = shadowT * shadowT * (3.0 - 2.0 * shadowT);
        hairColor += (clamp(hairColor * shadow, 0.0, 1.0) - hairColor) * xfsShadow.z;
        diffuseColor.rgb *= abs(hairColor);`)
        .replace("#include <alphamap_fragment>", STRAND_COVERAGE_GLSL);
    } else {
      Object.assign(shader.uniforms, {
        xfsCapMask: { value: source.mask }, xfsCapGradient: { value: source.gradient },
      });
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        uniform sampler2D xfsCapMask, xfsCapGradient;`)
        .replace("#include <map_fragment>", `#include <map_fragment>
        float capMask = texture2D(xfsCapMask, vAlphaMapUv).r;
        diffuseColor.rgb *= texture2D(xfsCapGradient, vec2(capMask, 0.5)).rgb;`);
    }
  };
  const priorKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${priorKey()}-xfs-hair-${source.kind}-2`;
}
