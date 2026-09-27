import * as THREE from "three";

/**
 * A deterministic soft-shadow filter for Three's PCF shadows. Three's own PCF rotates five taps per pixel by interleaved gradient
 * noise, which expects temporal antialiasing to average it; the Studio has none, so the V's penumbras (a grazing key's across a
 * cheek) showed as a pixel-by-pixel dither. This replaces those taps with Ignacio Castaño's optimized PCF ("Shadow Mapping Summary",
 * 2013, as in Matt Pettineo's Shadows sample): a tent filter 3, 5 or 7 texels wide built from 4, 9 or 16 hardware-filtered comparison
 * taps whose positions and weights follow the receiver's position inside its texel, so every texel under the tent is weighed
 * smoothly and the penumbra has no steps (PREV-136: the earlier fixed 4 × 4 grid spread its taps 2.3–4.5 texels apart, wider than
 * one hardware tap reaches). The same at every pixel and every frame (knowledge/creator-lighting.md §9).
 *
 * The tent's size is the one nearest the light's PCF radius in texels (`shadowTentSize`): the preview's radius keeps a 3 mm penumbra
 * (`creatorShadowRadius`), which is 7 texels at 1K; above that the widest tent, 7 texels, caps it, so 2K maps draw a sharper edge.
 * Patches `THREE.ShaderChunk.shadowmap_pars_fragment` once; a Three build without the expected code keeps its own filter.
 */
const DITHERED = /\n(\t*)float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;[\s\S]*?\) \* 0\.2;\n/;
export const SHADOW_FILTER_MARK = "XF Studio: Castano's optimized PCF";
/** The widest tent, in texels; the PCF radius (half the width) this filter can honour is half of it. */
export const SHADOW_TENT_MAX = 7;
/** The tent width (3, 5 or 7 texels) the filter uses for a PCF radius in texels. */
export const shadowTentSize = (radius: number): 3 | 5 | 7 => radius < 2 ? 3 : radius < 3 ? 5 : 7;

/**
 * Tap offsets (texels from the base texel) and weights along one axis for a tent width and the receiver's position `s` in [0, 1)
 * within its texel. Mirrors the shader below exactly (the tests check the tent's response on the CPU).
 */
export function tentTaps(size: 3 | 5 | 7, s: number): { offsets: number[]; weights: number[]; total: number } {
  if (size === 3) {
    const w = [3 - 2 * s, 1 + 2 * s];
    return { offsets: [(2 - s) / w[0]! - 1, s / w[1]! + 1], weights: w, total: 4 };
  }
  if (size === 5) {
    const w = [4 - 3 * s, 7, 1 + 3 * s];
    return { offsets: [(3 - 2 * s) / w[0]! - 2, (3 + s) / w[1]!, s / w[2]! + 2], weights: w, total: 12 };
  }
  const w = [5 * s - 6, 11 * s - 28, -(11 * s + 17), -(5 * s + 1)];
  return { offsets: [(4 * s - 5) / w[0]! - 3, (4 * s - 16) / w[1]! - 1, -(7 * s + 5) / w[2]! + 1, -s / w[3]! + 3], weights: w, total: -52 };
}

const TENT = (indent: string) => {
  const axis = (c: string, v: string) => ({
    3: `float ${c}w0 = 3.0 - 2.0 * ${v}; float ${c}w1 = 1.0 + 2.0 * ${v};
${indent}		float ${c}0 = ( 2.0 - ${v} ) / ${c}w0 - 1.0; float ${c}1 = ${v} / ${c}w1 + 1.0;`,
    5: `float ${c}w0 = 4.0 - 3.0 * ${v}; float ${c}w1 = 7.0; float ${c}w2 = 1.0 + 3.0 * ${v};
${indent}		float ${c}0 = ( 3.0 - 2.0 * ${v} ) / ${c}w0 - 2.0; float ${c}1 = ( 3.0 + ${v} ) / ${c}w1; float ${c}2 = ${v} / ${c}w2 + 2.0;`,
    7: `float ${c}w0 = 5.0 * ${v} - 6.0; float ${c}w1 = 11.0 * ${v} - 28.0; float ${c}w2 = -( 11.0 * ${v} + 17.0 ); float ${c}w3 = -( 5.0 * ${v} + 1.0 );
${indent}		float ${c}0 = ( 4.0 * ${v} - 5.0 ) / ${c}w0 - 3.0; float ${c}1 = ( 4.0 * ${v} - 16.0 ) / ${c}w1 - 1.0;
${indent}		float ${c}2 = -( 7.0 * ${v} + 5.0 ) / ${c}w2 + 1.0; float ${c}3 = -${v} / ${c}w3 + 3.0;`,
  });
  const sum = (n: number, total: number) => {
    const taps: string[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) taps.push(`uw${i} * vw${j} * XFS_TAP( u${i}, v${j} )`);
    return `shadow = ( ${taps.join(`\n${indent}			+ `)} ) / ${total.toFixed(1)};`;
  };
  const branch = (n: 3 | 5 | 7, total: number) => `
${indent}		${axis("u", "xfsS")[n]}
${indent}		${axis("v", "xfsT")[n]}
${indent}		${sum(n === 3 ? 2 : n === 5 ? 3 : 4, total)}`;
  return `
${indent}// ${SHADOW_FILTER_MARK} (shadow-filter.ts): a tent of 3, 5 or 7 texels from hardware-filtered taps, no per-pixel noise.
${indent}vec2 xfsUv = shadowCoord.xy * shadowMapSize;
${indent}vec2 xfsBase = floor( xfsUv + 0.5 );
${indent}float xfsS = xfsUv.x + 0.5 - xfsBase.x;
${indent}float xfsT = xfsUv.y + 0.5 - xfsBase.y;
${indent}xfsBase = ( xfsBase - 0.5 ) * texelSize;
#define XFS_TAP( u, v ) texture( shadowMap, vec3( xfsBase + vec2( u, v ) * texelSize, shadowCoord.z ) )
${indent}if ( shadowRadius < 2.0 ) {${branch(3, 16)}
${indent}} else if ( shadowRadius < 3.0 ) {${branch(5, 144)}
${indent}} else {${branch(7, 2704)}
${indent}}
#undef XFS_TAP
`;
};

/** Install the filter (idempotent). Returns whether this Three build's PCF code was recognised and replaced. */
export function installShadowFilter(chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>): boolean {
  const source = chunks.shadowmap_pars_fragment ?? "";
  if (source.includes(SHADOW_FILTER_MARK)) return true;
  const match = DITHERED.exec(source);
  if (!match) return false;
  chunks.shadowmap_pars_fragment = source.replace(DITHERED, TENT(match[1] ?? "\t"));
  return true;
}
