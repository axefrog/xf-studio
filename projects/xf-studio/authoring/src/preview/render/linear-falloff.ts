import * as THREE from "three";

/**
 * The game's linear falloff, per fragment, in Three's shared light code (render gap plans §2 step A; knowledge/creator-lighting.md §7,
 * §12.4). The engine attenuates an `LA_Linear` light by `1 − saturate(d/r)` with no inverse-square term [source]; Three has no such mode,
 * so the creator rig used to fold it into one intensity measured at the head slot, which under-lit Rim_Top's reach of the crown about
 * twofold (its radius, 1.65 m, barely exceeds its 1.55 m to the head slot).
 *
 * A light marks the falloff with a negative `decay` (`LINEAR_FALLOFF_DECAY`) and its radius as its `distance`; the patched
 * `getDistanceAttenuation` returns `1 − saturate(d / distance)` for it and Three's physical falloff for every other light, unchanged. Every
 * material that takes Three's lights (skin, hair, decals, metals, the eyes) goes through that function, so they all agree.
 */
export const LINEAR_FALLOFF_DECAY = -1;
const MARK = "XFS linear falloff";
const SIGNATURE = "float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {";
const LINEAR_BRANCH = /* glsl */`
	// ${MARK}: a negative decay marks the game's linear falloff, 1 - saturate( d / r ) with r the light's distance (linear-falloff.ts).
	if ( decayExponent < 0.0 ) return cutoffDistance > 0.0 ? 1.0 - saturate( lightDistance / cutoffDistance ) : 1.0;
`;

/** Install the linear branch (idempotent). Returns whether this Three build's attenuation function was recognised. */
export function installLinearFalloff(chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>): boolean {
  const source = chunks.lights_pars_begin ?? "";
  if (source.includes(MARK)) return true;
  if (!source.includes(SIGNATURE)) return false;
  chunks.lights_pars_begin = source.replace(SIGNATURE, `${SIGNATURE}\n${LINEAR_BRANCH}`);
  return true;
}

/**
 * The patched attenuation on the CPU (the GLSL above and Three 0.186's physical falloff), for the tests: what a fragment `distance` metres
 * from a light with Three's `cutoff` distance and `decay` receives.
 */
export function distanceAttenuation(distance: number, cutoff: number, decay: number): number {
  const saturate = (x: number) => Math.min(1, Math.max(0, x));
  if (decay < 0) return cutoff > 0 ? 1 - saturate(distance / cutoff) : 1;
  let falloff = 1 / Math.max(distance ** decay, 0.01);
  if (cutoff > 0) falloff *= saturate(1 - (distance / cutoff) ** 4) ** 2;
  return falloff;
}
