import * as THREE from "three";

/**
 * Isolated Three r186 experiment, NOT the production glitter material.
 *
 * Compare a spatial mixture of two lit BRDFs with the existing material-parameter
 * blend. surface.R is area coverage, not alpha; the original map/opacity/alpha
 * pipeline is unchanged. Pigment uses the unperturbed mesh normal. Flakes use
 * the current candidate normalMap, including normalScale, WITHOUT trying to
 * undo its baked coverage averaging. This cannot recover individual subpixel
 * facets, and is not a physical glint or game-shader implementation.
 *
 * Primary source: installed three@0.186.0 meshphysical.glsl.js and its lighting
 * chunks. We reuse their actual light/environment/shadow/AO evaluation, rather
 * than replacing it with a guessed light or an unlit sparkle colour.
 * Install AFTER extendSkin. Texture lifetime remains with the caller.
 */
export interface GlitterMixtureStudyOptions {
  baseColor: string;
  flakeColor: string;
  baseRoughness?: number;
  flakeRoughness?: number;
  baseMetalness?: number;
  flakeMetalness?: number;
}

const installed = new WeakSet<THREE.MeshPhysicalMaterial>();
const VERSION = "xfs-glitter-two-brdf-study-r186-1";

function scalar(value: number | undefined, fallback: number) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1)
    throw Error("Study roughness/metalness must be finite and between zero and one");
  return result;
}

function replaceOnce(source: string, token: string, replacement: string) {
  if (source.split(token).length !== 2)
    throw Error(`Glitter study expects exactly one shader marker: ${token}`);
  return source.replace(token, replacement);
}

export function installGlitterMixtureStudy(
  material: THREE.MeshPhysicalMaterial,
  options: GlitterMixtureStudyOptions,
) {
  if (THREE.REVISION !== "186") throw Error("Glitter study requires Three r186");
  if (installed.has(material)) throw Error("Glitter study already installed");
  const uniforms = {
    xfsStudyEnabled: { value: false },
    xfsStudySurface: { value: null as THREE.Texture | null },
    xfsStudySurfaceTransform: { value: new THREE.Matrix3() },
    xfsStudyBaseColor: { value: new THREE.Color(options.baseColor) },
    xfsStudyFlakeColor: { value: new THREE.Color(options.flakeColor) },
    xfsStudyBaseRoughness: { value: scalar(options.baseRoughness, .7) },
    xfsStudyFlakeRoughness: { value: scalar(options.flakeRoughness, .2) },
    xfsStudyBaseMetalness: { value: scalar(options.baseMetalness, 0) },
    xfsStudyFlakeMetalness: { value: scalar(options.flakeMetalness, .95) },
  };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  let disposed = false;
  function checkLive() {
    if (disposed) throw Error("Glitter study adapter is disposed");
  }
  const compile: typeof material.onBeforeCompile = function (this: THREE.MeshPhysicalMaterial, shader, renderer) {
    previousCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceOnce(shader.vertexShader, "#include <common>", `
#include <common>
uniform mat3 xfsStudySurfaceTransform;
varying vec2 xfsStudyUv;
`);
    shader.vertexShader = replaceOnce(shader.vertexShader, "#include <uv_vertex>", `
#include <uv_vertex>
xfsStudyUv = ( xfsStudySurfaceTransform * vec3( uv, 1.0 ) ).xy;
`);
    shader.fragmentShader = replaceOnce(shader.fragmentShader, "#include <common>", `
#include <common>
// These lobes carry additional shared accumulators or transmission semantics.
// Fail visibly rather than silently comparing a different material model.
#if defined(USE_CLEARCOAT) || defined(USE_SHEEN) || defined(USE_TRANSMISSION) || defined(USE_IRIDESCENCE) || defined(USE_ANISOTROPY) || defined(USE_RETROREFLECTION)
#error Unsupported_lobe_in_glitter_mixture_study
#endif
uniform bool xfsStudyEnabled;
uniform sampler2D xfsStudySurface;
varying vec2 xfsStudyUv;
uniform vec3 xfsStudyBaseColor;
uniform vec3 xfsStudyFlakeColor;
uniform float xfsStudyBaseRoughness;
uniform float xfsStudyFlakeRoughness;
uniform float xfsStudyBaseMetalness;
uniform float xfsStudyFlakeMetalness;
`);
    const startToken = "#include <lights_physical_fragment>";
    const endToken = "#include <opaque_fragment>";
    const source = shader.fragmentShader;
    const start = source.indexOf(startToken), end = source.indexOf(endToken);
    if (start < 0 || end <= start || source.split(startToken).length !== 2 || source.split(endToken).length !== 2)
      throw Error("Glitter study physical lighting markers changed");
    const original = source.slice(start, end);
    const evaluate = replaceOnce(original, "vec3 outgoingLight =", "outgoingLight =");
    const pass = (kind: "Base" | "Flake", normal: string) => `
{
  // Scope each physical-material and lighting temporary independently.
  vec4 diffuseColor = vec4( xfsStudy${kind}Color, xfsStudyAlpha );
  float roughnessFactor = xfsStudy${kind}Roughness;
  float metalnessFactor = xfsStudy${kind}Metalness;
  vec3 normal = ${normal};
  ReflectedLight reflectedLight = ReflectedLight( vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0) );
  vec3 outgoingLight;
  ${evaluate}
  xfsStudy${kind}Light = outgoingLight;
}
`;
    shader.fragmentShader = source.slice(0, start) + `
vec3 outgoingLight;
if ( xfsStudyEnabled ) {
  float xfsStudyAlpha = diffuseColor.a;
  vec3 xfsStudyCandidateNormal = normal;
  vec3 xfsStudyBaseLight;
  vec3 xfsStudyFlakeLight;
  ${pass("Base", "nonPerturbedNormal")}
  ${pass("Flake", "xfsStudyCandidateNormal")}
  float xfsStudyCoverage = clamp( texture2D( xfsStudySurface, xfsStudyUv ).r, 0.0, 1.0 );
  outgoingLight = mix( xfsStudyBaseLight, xfsStudyFlakeLight, xfsStudyCoverage );
} else {
  ${evaluate}
}
` + source.slice(end);
  };
  const cacheKey = function (this: THREE.MeshPhysicalMaterial) {
    return `${previousKey.call(this)}|${VERSION}`;
  };
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  installed.add(material);
  return {
    setEnabled(enabled: boolean) {
      checkLive();
      if (enabled && !uniforms.xfsStudySurface.value)
        throw Error("Set the glitter study coverage surface before enabling");
      uniforms.xfsStudyEnabled.value = enabled;
    },
    setSurface(surface: THREE.Texture) {
      checkLive();
      if (surface.channel !== 0 || surface.colorSpace !== THREE.NoColorSpace)
        throw Error("Study coverage requires a linear-data texture on UV channel zero");
      if (surface.matrixAutoUpdate) surface.updateMatrix();
      uniforms.xfsStudySurface.value = surface;
      uniforms.xfsStudySurfaceTransform.value.copy(surface.matrix);
    },
    setColors(baseColor: string, flakeColor: string) {
      checkLive();
      uniforms.xfsStudyBaseColor.value.set(baseColor);
      uniforms.xfsStudyFlakeColor.value.set(flakeColor);
    },
    /** Independent of the stock material's zero-metalness diagnostic. */
    setFlakeMetalness(value: number) {
      checkLive();
      uniforms.xfsStudyFlakeMetalness.value = scalar(value, .95);
    },
    setFlakeRoughness(value: number) {
      checkLive();
      uniforms.xfsStudyFlakeRoughness.value = scalar(value, .2);
    },
    dispose() {
      if (disposed) return;
      uniforms.xfsStudyEnabled.value = false;
      // Do not overwrite a later owner's hook if another adapter was installed.
      if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
      if (material.customProgramCacheKey === cacheKey) material.customProgramCacheKey = previousKey;
      material.needsUpdate = true;
      installed.delete(material);
      disposed = true;
    },
  };
}
