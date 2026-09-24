import * as THREE from "three";
import type { HairStop } from "./hair-preview";

/** Sample the source CHairProfile stops; duplicate positions use the last entry. */
export function sampleHairGradient(stops: HairStop[], value: number): [number, number, number] {
  if (value <= stops[0]!.value) return [...stops[0]!.color];
  if (value >= stops.at(-1)!.value) return [...stops.at(-1)!.color];
  for (let i = 1; i < stops.length; i++) {
    const next = stops[i]!, previous = stops[i - 1]!;
    if (value > next.value) continue;
    const t = next.value === previous.value ? 1 : (value - previous.value) / (next.value - previous.value);
    return previous.color.map((c, channel) => Math.round(c + (next.color[channel]! - c) * t)) as [number, number, number];
  }
  return [...stops.at(-1)!.color];
}

export function hairGradientTexture(stops: HairStop[]): THREE.DataTexture {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const color = sampleHairGradient(stops, i / 255);
    data.set([...color, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Retain Three's lighting/8-weight skinning and replace only the base pigment input. */
export function attachHairColor(
  material: THREE.MeshStandardMaterial,
  source: { kind: "strand"; id: THREE.Texture; gradient: THREE.Texture;
    idPalette: THREE.Texture; rootPalette: THREE.Texture } |
    { kind: "cap"; mask: THREE.Texture; gradient: THREE.Texture },
) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    if (source.kind === "strand") {
      Object.assign(shader.uniforms, {
        xfsStrandId: { value: source.id }, xfsStrandGradient: { value: source.gradient },
        xfsIdPalette: { value: source.idPalette }, xfsRootPalette: { value: source.rootPalette },
      });
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
        uniform sampler2D xfsStrandId, xfsStrandGradient, xfsIdPalette, xfsRootPalette;`)
        .replace("#include <map_fragment>", `#include <map_fragment>
        float strandId = texture2D(xfsStrandId, vAlphaMapUv).r;
        float rootTip = texture2D(xfsStrandGradient, vAlphaMapUv).r;
        vec3 idColor = texture2D(xfsIdPalette, vec2(strandId, 0.5)).rgb;
        vec3 rootColor = texture2D(xfsRootPalette, vec2(rootTip, 0.5)).rgb;
        // Both source gradients contribute. The game shader's exact blend is unknown.
        diffuseColor.rgb *= min(vec3(1.0), idColor * rootColor * 1.3);`);
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
  material.customProgramCacheKey = () => `${priorKey()}-xfs-hair-${source.kind}-1`;
}
