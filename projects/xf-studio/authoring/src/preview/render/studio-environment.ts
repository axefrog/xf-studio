import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { halfFloatRenderable } from "./linear-display";

/**
 * The studio stage's image-based light (Three adapter): Three's `RoomEnvironment`, prefiltered by `PMREMGenerator` into a
 * half-float target, as before.
 *
 * - **After a lost context** (PREV-58): the prefiltered target comes back empty, which dims every surface the environment lights.
 *   `restore` prefilters again and copies the result into the same texture, so everything holding it (the scene, and the creator
 *   preset's saved studio state) sees the environment again.
 * - **Without a renderable half-float buffer** (neither `EXT_color_buffer_float` nor `EXT_color_buffer_half_float`, PREV-59), the
 *   prefilter cannot render at all and the stage went dark. The room's diffuse light then comes from a light probe with the room's
 *   own spherical harmonics (`ROOM_ENVIRONMENT_SH`), and its sharper reflections are missing: approximate, but not dark.
 */

/**
 * Radiance spherical harmonics (order 2, Three's `SphericalHarmonics3` order) of `RoomEnvironment`, from Three.js 0.186's
 * `LightProbeGenerator.fromCubeRenderTarget` on a 256-pixel half-float cube of the room at the origin. The room is grey, so every
 * channel is equal. tests/webgl-display.test.ts recomputes them on the GPU and compares.
 */
export const ROOM_ENVIRONMENT_SH: readonly number[] = Object.freeze([
  3.707990797909154, 1.723109305885236, 1.5892844258374108, 0.2549147074716946, 0.19247149786474269,
  1.0368815023884033, 1.19994337619518, -0.3404437122566892, -0.6085594024162693,
]);

const COPY_VERTEX = /* glsl */`void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
const COPY_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D tSource;
layout( location = 0 ) out highp vec4 oColour;
void main() { oColour = texelFetch( tSource, ivec2( gl_FragCoord.xy ), 0 ); }`;

export type StudioEnvironmentMode = "pmrem" | "probe";

export function createStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const mode: StudioEnvironmentMode = halfFloatRenderable(renderer.extensions) ? "pmrem" : "probe";
  const prefilter = () => {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    try { return pmrem.fromScene(room, 0.04); } finally { pmrem.dispose(); room.dispose(); }
  };
  let target: THREE.WebGLRenderTarget | null = null, probe: THREE.LightProbe | null = null;
  if (mode === "pmrem") {
    target = prefilter();
    scene.environment = target.texture;
  } else {
    probe = new THREE.LightProbe();
    probe.name = "xfs-studio-environment-probe";
    probe.sh.coefficients.forEach((coefficient, i) => coefficient.setScalar(ROOM_ENVIRONMENT_SH[i]!));
    scene.add(probe);
  }
  return {
    mode,
    /** The lights that stand in for the environment (the creator preset hides them with the stage's own lights). */
    lights: probe ? [probe] as THREE.Object3D[] : [],
    /** After `webglcontextrestored`: prefilter again into the same texture (nothing to do for the light probe). */
    restore() {
      if (!target) return;
      const fresh = prefilter();
      const copy = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: COPY_VERTEX, fragmentShader: COPY_FRAGMENT,
        uniforms: { tSource: { value: fresh.texture } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copy), pass = new THREE.Scene();
      quad.frustumCulled = false;
      pass.add(quad);
      const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      try {
        renderer.autoClear = false;
        renderer.setRenderTarget(target);
        renderer.render(pass, new THREE.Camera());
      } finally {
        renderer.setRenderTarget(previous);
        renderer.autoClear = autoClear;
        fresh.dispose(); copy.dispose(); quad.geometry.dispose();
      }
    },
    dispose() { target?.dispose(); target = null; probe?.removeFromParent(); probe?.dispose(); probe = null; },
  };
}
export type StudioEnvironment = ReturnType<typeof createStudioEnvironment>;
