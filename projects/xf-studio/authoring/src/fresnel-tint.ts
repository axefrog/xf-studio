import * as THREE from "three";
import { FRESNEL_EXPONENT, FRESNEL_MAX_INTENSITY } from "./finish-export";

/**
 * Browser model of the game-matched Colour-shifting finish. It follows the compiled
 * `mesh_decal_gradientmap_recolor_blendable` post-G-buffer program: before lighting, the base
 * colour gains FresnelColor · intensity · saturate(|1 − N·V|^exponent), with N the shading normal
 * and V the direction to the camera. Metalness then splits that colour into diffuse and F0 as
 * usual. One additive colour only; it is not thin-film or multichrome.
 */
export function installFresnelTint(material: THREE.MeshPhysicalMaterial) {
  if (THREE.REVISION !== "186") throw Error("Fresnel tint requires Three r186");
  const priorCompile = material.onBeforeCompile, priorKey = material.customProgramCacheKey;
  const uniforms = {
    xfsShiftColor: { value: new THREE.Color("#3fd4c2") },
    xfsShiftIntensity: { value: 0 },
    xfsShiftExponent: { value: FRESNEL_EXPONENT },
  };
  let disposed = false;
  const replace = (source: string, token: string, replacement: string) => {
    if (source.split(token).length !== 2) throw Error(`Fresnel tint shader marker changed: ${token}`);
    return source.replace(token, replacement);
  };
  const compile: typeof material.onBeforeCompile = function(this: THREE.MeshPhysicalMaterial, shader, renderer) {
    priorCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = replace(shader.fragmentShader, "#include <common>", `
#include <common>
uniform vec3 xfsShiftColor;
uniform float xfsShiftIntensity;
uniform float xfsShiftExponent;
`);
    // After the shading normal is final and before the plate's square-root blend (plate-blend.ts), which runs just before the
    // lighting: the game adds the tint to the decal colour before its square root, so the blend must see the tinted colour.
    shader.fragmentShader = replace(shader.fragmentShader, "#include <emissivemap_fragment>", `
// Game route: added to the base colour before the G-buffer (and so before metalness splits it).
diffuseColor.rgb += xfsShiftColor * xfsShiftIntensity *
  clamp( pow( abs( 1.0 - dot( normal, normalize( vViewPosition ) ) ), xfsShiftExponent ), 0.0, 1.0 );
#include <emissivemap_fragment>
`);
  };
  const cacheKey = function(this: THREE.MeshPhysicalMaterial) { return `${priorKey.call(this)}|xfs-fresnel-tint-r186-2`; };
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  return {
    /** Shift colour (sRGB hex) and strength 0–1, mapped exactly as the export does. */
    set(color: string, strength: number) {
      if (disposed) throw Error("Fresnel tint disposed");
      if (!/^#[0-9a-f]{6}$/i.test(color) || !(strength >= 0 && strength <= 1)) throw Error("Invalid colour shift");
      uniforms.xfsShiftColor.value.set(color); // Three converts the sRGB hex to linear working colour.
      uniforms.xfsShiftIntensity.value = FRESNEL_MAX_INTENSITY * strength;
    },
    dispose() {
      if (disposed) return;
      if (material.onBeforeCompile === compile) material.onBeforeCompile = priorCompile;
      if (material.customProgramCacheKey === cacheKey) material.customProgramCacheKey = priorKey;
      material.needsUpdate = true;
      disposed = true;
    },
  };
}
