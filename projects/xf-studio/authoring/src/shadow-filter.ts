import * as THREE from "three";

/**
 * A deterministic soft-shadow filter for Three's PCF shadows. Three's own PCF rotates five taps per pixel by interleaved gradient
 * noise, which expects temporal antialiasing to average it; the Studio has none, so the V's penumbras (a grazing key's across a
 * cheek) showed as a pixel-by-pixel dither. This replaces those five taps with a fixed 4 × 4 grid of hardware-filtered taps over
 * the same radius: a smooth box-filtered penumbra, the same at every pixel and every frame (knowledge/creator-lighting.md §9).
 * Patches `THREE.ShaderChunk.shadowmap_pars_fragment` once; a Three build without the expected code keeps its own filter.
 */
const DITHERED = /\n(\t*)float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;[\s\S]*?\) \* 0\.2;\n/;
const GRID = (indent: string) => `
${indent}// XF Studio: a fixed 4 x 4 grid of hardware-filtered taps over the radius (shadow-filter.ts), no per-pixel noise.
${indent}float xfsShadowSum = 0.0;
${indent}for ( int xfsY = 0; xfsY < 4; xfsY ++ ) {
${indent}	for ( int xfsX = 0; xfsX < 4; xfsX ++ ) {
${indent}		vec2 xfsOffset = ( vec2( float( xfsX ), float( xfsY ) ) - 1.5 ) / 1.5 * radius;
${indent}		xfsShadowSum += texture( shadowMap, vec3( shadowCoord.xy + xfsOffset, shadowCoord.z ) );
${indent}	}
${indent}}
${indent}shadow = xfsShadowSum / 16.0;
`;
export const SHADOW_FILTER_MARK = "XF Studio: a fixed 4 x 4 grid";

/** Install the filter (idempotent). Returns whether this Three build's PCF code was recognised and replaced. */
export function installShadowFilter(chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>): boolean {
  const source = chunks.shadowmap_pars_fragment ?? "";
  if (source.includes(SHADOW_FILTER_MARK)) return true;
  const match = DITHERED.exec(source);
  if (!match) return false;
  chunks.shadowmap_pars_fragment = source.replace(DITHERED, GRID(match[1] ?? "\t"));
  return true;
}
