import * as THREE from "three";
import { neutralGradingLut, type GradingLut } from "./grading-lut";

/**
 * The game's SDR display transform as a render pass (grading-lut.ts has the arithmetic and its grades):
 * the scene renders scene-linear into a half-float, multisampled target (Three applies no tone mapping or
 * output encoding to render targets), then one full-screen pass writes
 *
 *   sRGB_encode(clamp(LUT(LogC3(k · x))))
 *
 * to the canvas. `k` is the preset's single exposure scalar; the LUT is a half-float `Data3DTexture`
 * sampled at texel centres. The ordinary studio stage never uses this pass.
 */
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAGMENT = /* glsl */ `
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

export function createCreatorDisplay(renderer: THREE.WebGLRenderer) {
  let target: THREE.WebGLRenderTarget | null = null;
  let lut = lutTexture(neutralGradingLut(32));
  const material = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tLut: { value: lut }, uExposure: { value: 1 }, uLutSize: { value: 32 } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false,
  });
  material.name = "xfs-creator-display";
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene(), quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(quad);
  const size = new THREE.Vector2();
  function ensureTarget() {
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y));
    if (target && target.width === width && target.height === height) return target;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, samples: 4, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    target.texture.name = "xfs-creator-scene-linear";
    material.uniforms.tScene!.value = target.texture;
    return target;
  }
  return {
    /** Render the scene through the creator display transform to the canvas. */
    render(scene: THREE.Scene, camera: THREE.Camera) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(ensureTarget());
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      renderer.render(quadScene, quadCamera);
    },
    /** Use a decoded game LUT, or the neutral LUT (null). */
    setLut(next: GradingLut | null) {
      const replacement = lutTexture(next ?? neutralGradingLut(32));
      lut.dispose();
      lut = replacement;
      material.uniforms.tLut!.value = lut;
      material.uniforms.uLutSize!.value = lut.image.width;
    },
    setExposure(k: number) { material.uniforms.uExposure!.value = k; },
    get exposure(): number { return material.uniforms.uExposure!.value as number; },
    /** Release the scene-linear target while the preset is off; it is recreated on the next render. */
    release() { target?.dispose(); target = null; },
    dispose() { target?.dispose(); target = null; lut.dispose(); material.dispose(); quad.geometry.dispose(); },
  };
}
export type CreatorDisplay = ReturnType<typeof createCreatorDisplay>;
