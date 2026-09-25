import * as THREE from "three";
import type { HairStop } from "./hair-preview";
import { bakeHairProfile, HAIR_DITHER, HAIR_LIGHTING_VANILLA, sampleStopsEncoded, type HairLighting, type HairMaterialParameters,
  type ProfileEncoding } from "./hair-colour-model";

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

/**
 * Coverage only (for flat-coloured strands such as lashes): Strand_Alpha.r remapped by AlphaCutoff,
 * then stretched over the game's dither range (hairResolvedCoverage). Pair it with an opaque
 * alpha-to-coverage material (STRAND_COVERAGE_MATERIAL or its over-makeup variant), not alpha blending.
 */
export function attachStrandCoverage(material: THREE.MeshStandardMaterial, alphaCutoff: number) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.uniforms.xfsAlphaCutoff = { value: alphaCutoff };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        uniform float xfsAlphaCutoff;`).replace("#include <alphamap_fragment>", STRAND_COVERAGE_GLSL);
  };
  const priorKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${priorKey()}-xfs-strand-coverage-2`;
}

const glslFloat = (value: number) => value.toPrecision(9);
/**
 * Strand_Alpha.r remapped by AlphaCutoff, then the game's TAA-resolved dither coverage
 * (hairResolvedCoverage): every layer in a pixel meets the same threshold, uniform on
 * [offset, offset + 5·step). MSAA alpha-to-coverage keeps that nesting: its sample masks
 * grow with alpha, so overlapping layers cover about as much as the most opaque one.
 */
const STRAND_COVERAGE_GLSL = `
        float strandAlpha = texture2D(alphaMap, vAlphaMapUv).r;
        float strandRemapped = xfsAlphaCutoff >= 1.0 ? 0.0 :
          clamp(max(strandAlpha - xfsAlphaCutoff, 0.0) / (1.0 - xfsAlphaCutoff), 0.0, 1.0);
        diffuseColor.a *= clamp((strandRemapped - ${glslFloat(HAIR_DITHER.offset)}) / ${glslFloat(5 * HAIR_DITHER.step)}, 0.0, 1.0);`;

/**
 * Material flags for hair.mt strands: opaque, depth-writing, alpha-to-coverage with no alpha
 * test, like the game's dithered G-buffer write. Alpha blending would instead combine layers
 * independently (denser than the game where layers overlap) and depend on draw order.
 */
export const STRAND_COVERAGE_MATERIAL = Object.freeze({
  transparent: false, depthWrite: true, alphaToCoverage: true, alphaTest: 0,
} satisfies Partial<THREE.MeshStandardMaterialParameters>);

/**
 * The same coverage for strands that must draw after the transparent makeup layers (the lashes,
 * kept above the editable stack by renderOrder): in Three's transparent queue, but unblended.
 */
export const STRAND_COVERAGE_OVER_MAKEUP_MATERIAL = Object.freeze({
  ...STRAND_COVERAGE_MATERIAL, transparent: true, blending: THREE.NoBlending,
} satisfies Partial<THREE.MeshStandardMaterialParameters>);

/**
 * Material flags for the hair cap. In game it is `mesh_decal_gradientmap_recolor.mt`, a
 * post-G-buffer decal alpha-blended by its mask over the scalp with no depth write [resource].
 * An opaque alpha-tested cap instead left a hard, jagged edge along the parting and wrote its
 * partial mask into the canvas alpha. The engine blends in sqrt(albedo) space; this linear
 * "over" blend is lighter at partial coverage (knowledge/hair-shading.md, preview mapping).
 */
export const HAIR_CAP_DECAL_MATERIAL = Object.freeze({
  transparent: true, depthWrite: false, alphaTest: 0,
} satisfies Partial<THREE.MeshStandardMaterialParameters>);

/**
 * Direct light for strands, mirroring hairDirectLight (hair-colour-model.ts): the
 * 2.31 deferred hair light is a Marschner-style model (white shifted R lobe,
 * albedo-tinted TRT lobe, wrapped Kajiya multiple-scatter diffuse) evaluated on
 * the strand direction. The card's own dielectric specular is disabled
 * (specularIntensity 0) and Three's direct terms are replaced. Strand direction
 * is the skinned bitangent, as the game's G-buffer pass uses it for these cards.
 * Option-driven constants default to HAIR_LIGHTING_VANILLA ([community] values, register
 * pairing [hypothesis]). The environment-probe hair path is not decoded; the ambient
 * diffuse Three computes is scaled by the EnvProbe MultiScatter option instead.
 */
const HAIR_LIGHT_GLSL = `
        #if NUM_DIR_LIGHTS > 0 && defined( USE_TANGENT )
        {
          vec3 hairT = normalize(tbn[1]);
          vec3 hairC = clamp(material.diffuseColor * xfsHairScatter.w, vec3(1e-5), vec3(1.0));
          float hairR = clamp(xfsFibreRoughness, 0.04, 1.0);
          // Per-strand highlight shift hashed from Strand_ID, as the light reads it from the G-buffer.
          float hairRandom = mix(xfsHairRandom.x, xfsHairRandom.y,
            fract(fract(xfsHairLightId * 0.06711056 + xfsHairLightId * 0.00583715) * 52.982918));
          reflectedLight.directDiffuse = vec3(0.0);
          reflectedLight.directSpecular = vec3(0.0);
          DirectionalLight hairLight;
          #pragma unroll_loop_start
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) {{
            hairLight = directionalLights[i];
            vec3 specular, diffuse;
            xfsHairDirect(hairLight.direction, geometryViewDir, hairT, normal, hairC, hairR, hairRandom, specular, diffuse);
            reflectedLight.directSpecular += hairLight.color * specular;
            reflectedLight.directDiffuse += hairLight.color * diffuse;
          }}
          #pragma unroll_loop_end
        }
        #endif
        reflectedLight.indirectDiffuse *= xfsHairRandom.z;`;

const HAIR_BSDF_GLSL = `
        float xfsGaussian(float b, float x) { return exp(-0.5 * x * x / (b * b)) / (2.5066283 * b); }
        float xfsSchlick(float c) { return 0.0466 + 0.9535 * pow(1.0 - c, 5.0); }
        float xfsWrapped(float nDotL, float w) { return clamp((nDotL + w) / ((1.0 + w) * (1.0 + w)), 0.0, 1.0); }
        void xfsHairDirect(vec3 L, vec3 V, vec3 T, vec3 N, vec3 C, float r, float rnd, out vec3 specular, out vec3 diffuse) {
          float sinL = dot(T, L), sinV = dot(T, V), nDotL = dot(N, L);
          float cosThetaD = cos(abs(asin(clamp(sinV, -1.0, 1.0)) - asin(clamp(sinL, -1.0, 1.0))) * 0.5);
          vec3 lp = L - sinL * T, vp = V - sinV * T;
          float cosPhi = dot(lp, vp) * inversesqrt(dot(lp, lp) * dot(vp, vp) + 1e-4);
          float cosHalfPhi = sqrt(clamp(0.5 + 0.5 * cosPhi, 0.0, 1.0));
          float sR = xfsHairLobes.x + rnd, rr = r / xfsHairGates.w;
          float shift = 2.0 * sin(sR) * (cos(sR) * cosHalfPhi * sqrt(max(0.0, 1.0 - sinV * sinV)) + sin(sR) * sinV);
          float specularGate = clamp(xfsWrapped(nDotL, xfsHairGates.y) + 1.0 - xfsHairGates.z, 0.0, 1.0);
          float specR = specularGate * xfsGaussian(rr * rr * 1.4142136 * cosHalfPhi, sinL + sinV - shift) * 0.25 * cosHalfPhi *
            xfsSchlick(sqrt(clamp(0.5 + 0.5 * dot(L, V), 0.0, 1.0))) * xfsHairLobes.z;
          float f = xfsSchlick(0.5 * cosThetaD);
          float trt = xfsGaussian(2.0 * r * r, sinL + sinV - rnd - xfsHairLobes.y) * (1.0 - f) * (1.0 - f) * f *
            exp(xfsHairTrt.x * cosPhi - xfsHairTrt.y) * xfsHairLobes.w;
          specular = vec3(specR) + trt * pow(C, vec3(0.8 / max(cosThetaD, 1e-3)));
          float wrapped = xfsWrapped(nDotL, xfsHairScatter.x);
          float scatterGate = clamp(wrapped + 1.0 - xfsHairGates.x, 0.0, 1.0);
          diffuse = C * mix(wrapped, 1.0 - abs(sinL), xfsHairScatter.y) * 0.31830989 * scatterGate * xfsHairScatter.z;
        }`;

/** Uniforms shared by the strand and lash hair lights (see HairLighting for the register mapping). */
function hairLightUniforms(l: HairLighting) {
  return {
    xfsHairLobes: { value: new THREE.Vector4(l.shiftR, l.shiftTRT, l.intensityR, l.intensityTRT) },
    xfsHairTrt: { value: new THREE.Vector2(l.trtNpScale, l.trtNpBias) },
    xfsHairScatter: { value: new THREE.Vector4(l.wrap, l.kajiyaMix, l.scatter, l.albedoMultiplier) },
    xfsHairGates: { value: new THREE.Vector4(l.scatterMask, l.specularWrap, l.specularMask, l.roughnessFactor) },
    xfsHairRandom: { value: new THREE.Vector3(l.specularRandomMin, l.specularRandomMax, l.envMultiScatter) },
  };
}
const HAIR_LIGHT_UNIFORMS_GLSL = `uniform vec4 xfsHairLobes, xfsHairScatter, xfsHairGates;
        uniform vec3 xfsHairRandom;
        uniform vec2 xfsHairTrt;`;

/**
 * Hair-class lighting for a flat-coloured strand material (e.g. lashes, whose
 * Strand_ID/Strand_Gradient are constant images): constant G-buffer roughness,
 * same deferred hair light as the textured strands. Needs a MeshPhysicalMaterial
 * with specularIntensity 0 and anisotropy > 0 (for the skinned tangent frame).
 */
export function attachHairLighting(material: THREE.MeshStandardMaterial, roughness: number, strandId: number,
                                   lighting: HairLighting = HAIR_LIGHTING_VANILLA) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    Object.assign(shader.uniforms, {
      xfsLashRoughness: { value: roughness }, xfsLashStrandId: { value: strandId }, ...hairLightUniforms(lighting),
    });
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        uniform float xfsLashRoughness, xfsLashStrandId;
        ${HAIR_LIGHT_UNIFORMS_GLSL}
        ${HAIR_BSDF_GLSL}`)
      .replace("#include <lights_fragment_begin>", `float xfsFibreRoughness = xfsLashRoughness;
        float xfsHairLightId = xfsLashStrandId;
        #include <lights_fragment_begin>`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
        ${HAIR_LIGHT_GLSL}`);
  };
  const priorKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${priorKey()}-xfs-hair-lighting-2`;
}

type StrandSource = {
  kind: "strand"; id: THREE.Texture; gradient: THREE.Texture; profile: THREE.Texture;
  sampleCount: number; material: HairMaterialParameters; lighting?: HairLighting;
};
type CapSource = { kind: "cap"; mask: THREE.Texture; gradient: THREE.Texture };

/** Strand GLSL mirrors hairFragmentColor/hairCoverage; cap keeps the gradient-recolor decal approximation. */
export function attachHairColor(material: THREE.MeshStandardMaterial, source: StrandSource | CapSource) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    if (source.kind === "strand") {
      const m = source.material, l = source.lighting ?? HAIR_LIGHTING_VANILLA;
      Object.assign(shader.uniforms, {
        xfsStrandId: { value: source.id }, xfsStrandGradient: { value: source.gradient },
        xfsProfile: { value: source.profile }, xfsProfileSamples: { value: source.sampleCount },
        xfsShadow: { value: new THREE.Vector3(m.shadowMin, m.shadowMax, m.shadowStrength) },
        xfsAlphaCutoff: { value: m.alphaCutoff },
        xfsRoughness: { value: new THREE.Vector4(m.roughnessScale, m.roughnessBias, m.shadowRoughness, m.shadowStrength) },
        ...hairLightUniforms(l),
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
        uniform vec4 xfsRoughness;
        ${HAIR_LIGHT_UNIFORMS_GLSL}
        varying float vXfsVertexRed;
        ${HAIR_BSDF_GLSL}
        int xfsProfileIndex(float v) {
          // HLSL uint((N-1)*v): truncation into a baked row, never filtering.
          return clamp(int(float(xfsProfileSamples - 1) * max(v, 0.0)), 0, xfsProfileSamples - 1);
        }`)
        .replace("#include <map_fragment>", `#include <map_fragment>
        // Linear (isGamma=0) red channels, sampled with the material's own filtering.
        float strandId = texture2D(xfsStrandId, vAlphaMapUv).r;
        float rootTip = texture2D(xfsStrandGradient, vAlphaMapUv).r;
        float xfsHairLightId = strandId;
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
        diffuseColor.rgb *= abs(hairColor);
        // G-buffer roughness: saturate(RoughnessScale * ID + RoughnessBias), pulled toward ShadowRoughness.
        float xfsFibreRoughness = clamp(xfsRoughness.x * strandId + xfsRoughness.y, 0.0, 1.0);
        xfsFibreRoughness += (xfsRoughness.z - xfsFibreRoughness) * (1.0 - shadow) * xfsRoughness.w;`)
        .replace("#include <alphamap_fragment>", STRAND_COVERAGE_GLSL)
        .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
        ${HAIR_LIGHT_GLSL}`);
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
  material.customProgramCacheKey = () => `${priorKey()}-xfs-hair-${source.kind}-6`;
}
