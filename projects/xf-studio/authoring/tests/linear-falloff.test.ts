// The game's linear falloff per fragment (linear-falloff.ts; render gap plans §2 step A): the patched Three attenuation against the
// decoded `linearFalloff` at ten distances, every other light unchanged, and what it changes on the creator rig (Rim_Top's crown).
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CREATOR_HEAD_SLOT, CREATOR_RIGS, inverseSquareFalloff, linearFalloff, spotLightSpec, DEFAULT_CREATOR_LIGHTING } from "../src/creator-lighting";
import { creatorSetup } from "../src/lighting-setups";
import { distanceAttenuation, installLinearFalloff, LINEAR_FALLOFF_DECAY } from "../src/linear-falloff";
import { parseSetupLight } from "../src/lighting-setups";

describe("per-fragment linear falloff", () => {
  test("the patched attenuation is 1 − saturate(d/r) for a marked light at ten distances, and Three's physical falloff otherwise", () => {
    const r = 1.65;
    for (let i = 0; i < 10; i++) {
      const d = 0.2 * i;
      expect(distanceAttenuation(d, r, LINEAR_FALLOFF_DECAY)).toBeCloseTo(linearFalloff(d, r), 12);
      // An inverse-square light (decay 2, distance r) keeps Three's physical falloff, which is the decoded inverse-square form.
      if (d > 0.01) expect(distanceAttenuation(d, 5, 2)).toBeCloseTo(inverseSquareFalloff(d, 5), 12);
      // Decay 0, distance 0: no falloff, as before.
      expect(distanceAttenuation(d, 0, 0)).toBe(1);
    }
    expect(distanceAttenuation(2, r, LINEAR_FALLOFF_DECAY)).toBe(0);
    expect(distanceAttenuation(2, 0, LINEAR_FALLOFF_DECAY)).toBe(1);
  });

  test("the install patches Three's shared attenuation once, before its physical form, and leaves an unknown build alone", () => {
    const chunks = { lights_pars_begin: THREE.ShaderChunk.lights_pars_begin };
    expect(installLinearFalloff(chunks)).toBe(true);
    expect(installLinearFalloff(chunks)).toBe(true);
    const text = chunks.lights_pars_begin;
    expect(text.match(/XFS linear falloff/g)).toHaveLength(1);
    const linear = text.indexOf("if ( decayExponent < 0.0 ) return cutoffDistance > 0.0 ? 1.0 - saturate( lightDistance / cutoffDistance ) : 1.0;");
    expect(linear).toBeGreaterThan(text.indexOf("float getDistanceAttenuation("));
    expect(linear).toBeLessThan(text.indexOf("float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );"));
    expect(installLinearFalloff({ lights_pars_begin: "void main() {}" })).toBe(false);
  });

  test("the creator rig's linear lights carry their radius to the renderer; Rim_Top now lights the crown by its own distance", () => {
    const head = CREATOR_HEAD_SLOT.female, crown: [number, number, number] = [head[0], head[1] + 0.11, head[2]];
    const rimTop = CREATOR_RIGS.female.find(l => l.name === "Rim_Top")!;
    const at = (p: readonly number[]) => Math.hypot(p[0]! - rimTop.position[0], p[1]! - rimTop.position[1], p[2]! - rimTop.position[2]);
    // The old fold measured at the head slot, against the per-fragment value at the crown: about twice as much light there now.
    const fold = linearFalloff(at(head), rimTop.radius), perFragment = linearFalloff(at(crown), rimTop.radius);
    expect(fold).toBeLessThan(0.08);
    expect(perFragment / fold).toBeGreaterThan(1.8);
    const setup = creatorSetup("female", DEFAULT_CREATOR_LIGHTING);
    for (const light of setup.lights) {
      const row = CREATOR_RIGS.female.find(l => l.name === light.id)!;
      expect(light.linearRadius).toBe(row.falloff === "linear" ? row.radius : undefined);
      // Stored and read back with its radius; a light stored before (no radius) reads as it was.
      expect(parseSetupLight(JSON.parse(JSON.stringify(light)))?.linearRadius).toBe(light.linearRadius);
    }
    const { linearRadius: _dropped, ...older } = setup.lights.find(l => l.linearRadius)!;
    expect(parseSetupLight(older)?.linearRadius).toBeUndefined();
    expect(spotLightSpec(rimTop, DEFAULT_CREATOR_LIGHTING, head).linearRadius).toBe(1.65);
  });
});
