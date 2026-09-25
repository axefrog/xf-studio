import * as THREE from "three";
import { neutralGradingLut, type GradingLut } from "./grading-lut";
import type { LightingPreset } from "./creator-lighting";

/**
 * The viewport's display path, shared by both lighting presets (PREV-50). The scene renders scene-linear into one
 * half-float, multisampled target (Three applies no tone mapping or output encoding to render targets), so every
 * blended pass (the face decals' square-root blend solve, the eye's wetness shell, the makeup plates) blends in linear
 * light, as the game's passes do. One full-screen pass then writes the canvas:
 *
 * - **studio**: Three's own tone mapping and output encoding (the renderer's `toneMapping` and `toneMappingExposure`,
 *   ACES filmic at the stage's exposure, then sRGB), exactly the functions a material drawn straight to the canvas
 *   applies. The stage backdrop is not part of the target: Three draws it on the canvas as before (untoned), and the
 *   scene is laid over it by the target's coverage, so opaque surfaces keep the pixels they had within rounding.
 * - **creator**: the game's SDR display transform, `sRGB_encode(clamp(LUT(LogC3(k · x))))` (grading-lut.ts has the
 *   arithmetic and its grades). `k` is the preset's single exposure scalar; the LUT is a half-float `Data3DTexture`
 *   sampled at texel centres. The creator's black surround renders into the target and goes through the grade.
 *
 * Coverage: the studio target clears to transparent black, and after the scene one pass sets alpha to one in every
 * sample a depth-writing surface covers (alpha-to-coverage hair and the eye's shell leave other values there). The
 * resolved alpha is then the pixel's coverage, and the composite `encode(tone(rgb / a)) · a + backdrop · (1 − a)` is
 * what the canvas's own multisample resolve gave before at silhouette edges.
 *
 * Without a renderable half-float colour buffer (`EXT_color_buffer_float`), the studio preset draws straight to the
 * canvas as before and the blends are approximate there (`path: "direct"`); the creator preset needs the target.
 * Nothing here runs unless a frame is drawn, so an idle viewport costs no GPU work.
 */
const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const CREATOR_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform highp sampler3D tLut;
uniform float uExposure;
uniform float uLutSize;
varying vec2 vUv;
float logC3(float x) {
  return x > 0.010591 ? 0.24719 * log(5.555556 * x + 0.052272) * 0.4342944819 + 0.385537 : 5.367655 * x + 0.092809;
}
vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec3 x = max(texture2D(tScene, vUv).rgb, vec3(0.0)) * uExposure;
  vec3 t = clamp(vec3(logC3(x.r), logC3(x.g), logC3(x.b)), 0.0, 1.0);
  vec3 graded = texture(tLut, t * (uLutSize - 1.0) / uLutSize + 0.5 / uLutSize).rgb;
  gl_FragColor = vec4(srgbEncode(graded), 1.0);
}`;
/** Three prefixes a tone-mapped `ShaderMaterial` with the renderer's `toneMapping()` and `linearToOutputTexel()`. */
const STUDIO_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tScene, vUv);
  float coverage = clamp(texel.a, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  gl_FragColor = vec4(max(texel.rgb / coverage, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * coverage, coverage);
}`;
/** At the far plane with a GREATER test: passes in exactly the samples some surface wrote depth to. */
const COVERAGE_VERTEX = /* glsl */ `void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const COVERAGE_FRAGMENT = /* glsl */ `void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }`;

export const DISPLAY_SAMPLES = 4;
export type DisplayPath = "linear" | "direct";

function lutTexture(lut: GradingLut): THREE.Data3DTexture {
  const half = new Uint16Array(lut.data.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(lut.data[i]!);
  const texture = new THREE.Data3DTexture(half, lut.size, lut.size, lut.size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = "xfs-creator-grading-lut";
  texture.needsUpdate = true;
  return texture;
}

/** Whether a WebGL 2 context can render into a half-float colour buffer (the linear display's target). */
export const linearTargetSupported = (context: Pick<WebGL2RenderingContext, "getExtension">) => !!context.getExtension("EXT_color_buffer_float");

function fullScreen(material: THREE.Material) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { scene, quad };
}

export function createLinearDisplay(renderer: THREE.WebGLRenderer) {
  const linear = !!renderer.extensions?.has?.("EXT_color_buffer_float");
  const samples = Math.max(0, Math.min(DISPLAY_SAMPLES, renderer.capabilities?.maxSamples ?? DISPLAY_SAMPLES));
  let target: THREE.WebGLRenderTarget | null = null;
  let lut = lutTexture(neutralGradingLut(32));
  const creator = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tLut: { value: lut }, uExposure: { value: 1 }, uLutSize: { value: 32 } },
    vertexShader: QUAD_VERTEX, fragmentShader: CREATOR_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false,
  });
  creator.name = "xfs-creator-display";
  const studio = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null } }, vertexShader: QUAD_VERTEX, fragmentShader: STUDIO_FRAGMENT, depthTest: false, depthWrite: false,
    toneMapped: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  studio.name = "xfs-studio-display";
  const coverage = new THREE.ShaderMaterial({
    vertexShader: COVERAGE_VERTEX, fragmentShader: COVERAGE_FRAGMENT, depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
    toneMapped: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
  });
  coverage.name = "xfs-display-coverage";
  const creatorPass = fullScreen(creator), studioPass = fullScreen(studio), coveragePass = fullScreen(coverage);
  const backdrop = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2(), clearColour = new THREE.Color();
  function ensureTarget() {
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y));
    if (target && target.width === width && target.height === height) return target;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, samples, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    target.texture.name = "xfs-scene-linear";
    creator.uniforms.tScene!.value = studio.uniforms.tScene!.value = target.texture;
    return target;
  }
  /** Draw `pass` without clearing what is already there. */
  function overlay(pass: THREE.Scene) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(pass, quadCamera); } finally { renderer.autoClear = autoClear; }
  }
  function renderCreator(scene: THREE.Scene, camera: THREE.Camera) {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(ensureTarget());
    try { renderer.render(scene, camera); } finally { renderer.setRenderTarget(previous); }
    renderer.render(creatorPass.scene, quadCamera);
  }
  function renderStudio(scene: THREE.Scene, camera: THREE.Camera) {
    if (!linear) { renderer.render(scene, camera); return; }
    const previous = renderer.getRenderTarget(), background = scene.background;
    renderer.getClearColor(clearColour);
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(ensureTarget());
    try {
      renderer.render(scene, camera);
      overlay(coveragePass.scene);
    } finally {
      scene.background = background;
      renderer.setClearColor(clearColour, clearAlpha);
      renderer.setRenderTarget(previous);
    }
    // The backdrop exactly as Three draws a scene background, then the toned scene over it.
    backdrop.background = background;
    backdrop.backgroundIntensity = scene.backgroundIntensity;
    backdrop.backgroundBlurriness = scene.backgroundBlurriness;
    backdrop.backgroundRotation.copy(scene.backgroundRotation);
    try { renderer.render(backdrop, quadCamera); } finally { backdrop.background = null; }
    overlay(studioPass.scene);
  }
  return {
    /** How the studio preset reaches the canvas: through the linear target, or straight (no half-float colour buffer). */
    path: (linear ? "linear" : "direct") as DisplayPath,
    samples,
    /** Draw one frame of `scene` through the preset's display transform to the canvas. */
    render(scene: THREE.Scene, camera: THREE.Camera, preset: LightingPreset) {
      if (preset === "creator") renderCreator(scene, camera); else renderStudio(scene, camera);
    },
    /** Use a decoded game LUT, or the neutral LUT (null). */
    setLut(next: GradingLut | null) {
      const replacement = lutTexture(next ?? neutralGradingLut(32));
      lut.dispose();
      lut = replacement;
      creator.uniforms.tLut!.value = lut;
      creator.uniforms.uLutSize!.value = lut.image.width;
    },
    /** The creator preset's exposure `k` (the studio stage's exposure is the renderer's `toneMappingExposure`). */
    setExposure(k: number) { creator.uniforms.uExposure!.value = k; },
    get exposure(): number { return creator.uniforms.uExposure!.value as number; },
    /** Developer evidence: the display path and the target's current size. */
    info: () => ({ path: linear ? "linear" as const : "direct" as const, samples, width: target?.width ?? 0, height: target?.height ?? 0 }),
    dispose() {
      target?.dispose(); target = null; lut.dispose();
      for (const pass of [creatorPass, studioPass, coveragePass]) { (pass.quad.material as THREE.Material).dispose(); pass.quad.geometry.dispose(); }
    },
  };
}
export type LinearDisplay = ReturnType<typeof createLinearDisplay>;
