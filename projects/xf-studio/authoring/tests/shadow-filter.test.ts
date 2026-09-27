import { expect, test } from "bun:test";
import * as THREE from "three";
import { installShadowFilter, SHADOW_FILTER_MARK } from "../src/shadow-filter";
import { shadowState } from "../src/lighting-setup-stage";

test("the shadow filter replaces Three's per-pixel noise rotation with a fixed grid, once", () => {
  // Three's bundled PCF body, in the form this build ships it (comments stripped).
  const pcf = "\n\t\t\t\tfloat radius = shadowRadius * texelSize.x;\n\t\t\t\tfloat phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;\n" +
    "\t\t\t\tshadow = (\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) )\n\t\t\t\t) * 0.2;\n\t\t\t}\n";
  const chunks = { shadowmap_pars_fragment: pcf };
  expect(installShadowFilter(chunks)).toBe(true);
  expect(chunks.shadowmap_pars_fragment).toContain(SHADOW_FILTER_MARK);
  expect(chunks.shadowmap_pars_fragment).not.toContain("interleavedGradientNoise");
  expect(chunks.shadowmap_pars_fragment).toContain("\t\t\t\tshadow = xfsShadowSum / 16.0;");
  const once = chunks.shadowmap_pars_fragment;
  expect(installShadowFilter(chunks)).toBe(true);
  expect(chunks.shadowmap_pars_fragment).toBe(once);
  expect(installShadowFilter({ shadowmap_pars_fragment: "unrelated" })).toBe(false);
  // This Three.js build's own chunk is recognised.
  expect(installShadowFilter()).toBe(true);
  expect((THREE.ShaderChunk as unknown as Record<string, string>).shadowmap_pars_fragment).toContain(SHADOW_FILTER_MARK);
});

test("the shadow fingerprint ignores the camera and changes with a caster's pose, a light's placement or its map size", () => {
  const scene = new THREE.Scene(), light = new THREE.DirectionalLight();
  light.castShadow = true; scene.add(light, light.target);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.castShadow = true; scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const first = shadowState(scene);
  camera.position.set(3, 2, 1);
  expect(shadowState(scene)).toBe(first);
  mesh.position.x = 0.1;
  const moved = shadowState(scene);
  expect(moved).not.toBe(first);
  light.position.set(1, 2, 3);
  expect(shadowState(scene)).not.toBe(moved);
  const placed = shadowState(scene);
  light.shadow.mapSize.set(2048, 2048);
  expect(shadowState(scene)).not.toBe(placed);
  mesh.castShadow = false;
  expect(shadowState(scene)).not.toBe(placed);
});
