/**
 * Browser page for tests/webgl-eye.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context): eye plan ranks
 * 4–5 on the GPU (knowledge/eye-rendering.md §6.5).
 * 1. Parity: the eye's GLSL functions (`EYE_GLSL_FUNCTIONS`: the refracted iris-plane coordinate, the cornea normal and the Eye
 *    BRDF) against their TypeScript twins, which tests/eye-shading.test.ts checks against the eye reference line by line.
 * 2. Before and after on a synthetic eyeball (a 13.7 mm sphere with the game's UV layout, a painted iris with radial fibres, a
 *    relief normal map and the vanilla roughness levels): the previous preview's eye (the standard light, flat roughness 0.18,
 *    colour at the folded, V-flipped UV) against the eye material, drawn scene-linear without tone mapping. Measures the
 *    catch light's peak and size, the iris's relief contrast under a side light, the pupil's parallax at a 30° view, and where an
 *    asymmetric iris marker lands (the iris keeps the mesh's orientation: eye-material.ts `IRIS_PLANE_ORIENTATION`).
 * Results land in `window.probe` as plain data. Nothing here reads game files.
 */
import * as THREE from "three";
import { corneaNormal, createEyeMaterial, EYE_FLAT_ROUGHNESS, EYE_GLSL_FUNCTIONS, eyeDirectLight, eyeParameters, irisPlaneCoordinate,
  prepareEyeballGeometry, unpackNormalRG, type Vec3 } from "../src/eye-material";

export type EyeFrame = { peak: number; highlightPixels: number; irisContrast: number; pupil: [number, number] | null; marker: [number, number] | null;
  /** The frame's summed luminance: with a black albedo, the specular energy the light leaves on the eye. */
  total: number;
  /** The same within 30 pixels of the frame's centre: peak, summed luminance and pixels above a quarter of that peak. */
  core: { peak: number; total: number; pixels: number } };
export type EyeProbe = {
  ok: boolean; renderer: string; errors: string[]; failure?: string;
  parity: { cases: number; iris: number; cornea: number; diffuse: number; specular: number };
  before: Record<string, EyeFrame>; after: Record<string, EyeFrame>;
  /** Specular only (black albedo), zoomed on the catch light: the previous eye at 0.18, the eye light at the flat 0.18 and at its own roughness. */
  specular: { before: EyeFrame; afterFlat: EyeFrame; after: EyeFrame };
  /** Pixels per millimetre on the eye at the frames' scale. */
  scale: number;
};
const probe: EyeProbe = { ok: false, renderer: "", errors: [], parity: { cases: 0, iris: 0, cornea: 0, diffuse: 0, specular: 0 }, before: {}, after: {},
  specular: undefined as unknown as EyeProbe["specular"], scale: 0 };
(window as unknown as { probe?: EyeProbe }).probe = undefined;

const SIZE = 160, RADIUS = 0.0137, UV_PER_SINE = 0.4;

/** A front hemisphere (to 80°) like one vanilla eyeball: radial normals, pupil at raw U 1.5, V down the eye (the game's layout). */
function eyeball(): THREE.BufferGeometry {
  const rings = 40, segments = 64, positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * 80 * Math.PI / 180;
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * 2 * Math.PI;
      const n = [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
      normals.push(...n);
      positions.push(n[0]! * RADIUS, n[1]! * RADIUS, n[2]! * RADIUS);
      uvs.push(1.5 + n[0]! * UV_PER_SINE, 0.5 - n[1]! * UV_PER_SINE);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * (segments + 1) + j, b = a + segments + 1;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** A texture over the folded, V-flipped coordinate (x = fold(u), y = 1 − v) from a per-texel function. */
function painted(size: number, texel: (x: number, y: number) => number[], colour: boolean): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const value = texel((column + 0.5) / size, (row + 0.5) / size);
    for (let k = 0; k < 4; k++) data[(row * size + column) * 4 + k] = Math.round(Math.min(255, Math.max(0, value[k] ?? 255)));
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
const polar = (x: number, y: number) => ({ r: Math.hypot(x - 0.5, y - 0.5), phi: Math.atan2(y - 0.5, x - 0.5) });
// The iris: a green-grey ring of radial fibres, a blue pupil (found by its colour under any light), a white sclera, and one red
// marker at texture (0.56, 0.40), which the V-flipped mesh coordinate draws below the pupil.
const albedo = painted(256, (x, y) => {
  const { r, phi } = polar(x, y);
  if (Math.hypot(x - 0.56, y - 0.40) < 0.022) return [230, 20, 20, 255];
  if (r < 0.055) return [20, 40, 230, 255];
  if (r < 0.15) { const f = 0.75 + 0.25 * Math.sin(40 * phi); return [90 * f, 120 * f, 95 * f, 255]; }
  return [228, 224, 218, 255];
}, true);
// The relief: fibres tilting the normal across the ring (±40°), flat elsewhere (RG packed, B unused).
const relief = painted(256, (x, y) => {
  const { r, phi } = polar(x, y);
  if (r < 0.055 || r > 0.15) return [128, 128, 0, 255];
  const tilt = 0.64 * Math.sin(40 * phi);
  return [128 + 127 * tilt * -Math.sin(phi), 128 + 127 * tilt * Math.cos(phi), 0, 255];
}, false);
// The vanilla roughness levels (R ≈ 80/255 over the iris, 26/255 on the sclera), read at the raw UV, which repeats onto this tile.
const roughness = painted(64, (x, y) => [polar(x, 1 - y).r < 0.18 ? 80 : 26, 0, 0, 255], false);

/** The previous preview's eye: Three's standard light, flat roughness 0.18, colour at the folded, V-flipped UV. */
function legacyEye(map = albedo): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map, roughness: EYE_FLAT_ROUGHNESS, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
vec2 legacyUv = vec2( vMapUv.x + ( vMapUv.x > 0.0 ? -1.0 : 1.0 ), 1.0 - vMapUv.y );
diffuseColor.rgb *= textureGrad( map, legacyUv, dFdx( vMapUv ), dFdy( vMapUv ) ).rgb;`);
  };
  material.customProgramCacheKey = () => "legacy-eye";
  return material;
}

try {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true })!;
  const info = context.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    probe.errors.push(`${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const target = (size: number) => new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, depthBuffer: true });

  // 1. Parity of the GLSL functions with their TypeScript twins, one pixel per case.
  const optics = eyeParameters({ scalars: {} }).optics;
  const uniforms = {
    uMode: { value: 0 }, uView: { value: new THREE.Vector3() }, uNormal: { value: new THREE.Vector3() }, uTangent: { value: new THREE.Vector3() },
    uBitangent: { value: new THREE.Vector3() }, uAlongB: { value: 0 },
    uAxis: { value: new THREE.Vector3() }, uOptics: { value: new THREE.Vector4(optics.RefractionIndex, optics.RefractionAmount, optics.IrisSize, optics.EyeRadius) },
    uPlane: { value: optics.EyeParallaxPlane }, uD: { value: new THREE.Vector2() }, uR: { value: 0 },
    uEgg: { value: new THREE.Vector4(optics.EggFullRadius, optics.EggMarginExponent, optics.EggMarginFactor, optics.EggSubFactor) },
    uBubble: { value: new THREE.Vector3() }, uIris: { value: 0 }, uN1: { value: new THREE.Vector3() }, uN2: { value: new THREE.Vector3() },
    uL: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() }, uRough: { value: 0 }, uAlbedo: { value: new THREE.Vector3() }, uMetal: { value: 0 },
  };
  const parity = new THREE.ShaderMaterial({ uniforms, vertexShader: "void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }",
    fragmentShader: `#include <common>
uniform int uMode; uniform vec3 uView, uNormal, uTangent, uBitangent, uAxis; uniform vec4 uOptics; uniform float uPlane, uAlongB;
uniform vec2 uD; uniform float uR; uniform vec4 uEgg; uniform vec3 uBubble; uniform float uIris;
uniform vec3 uN1, uN2, uL, uV, uAlbedo; uniform float uRough, uMetal;
${EYE_GLSL_FUNCTIONS}
void main() {
	if ( uMode == 0 ) gl_FragColor = vec4( xfsEyeIrisPlane( uView, uNormal, uTangent, uBitangent, uAxis, uOptics, uPlane, uAlongB ), 0.0, 1.0 );
	else if ( uMode == 1 ) gl_FragColor = vec4( xfsEyeCornea( uD, uR, uEgg, uBubble, uIris ), 1.0 );
	else { vec3 d, s; xfsEyeBRDF( uN1, uN2, uL, uV, uRough, uAlbedo, uMetal, d, s ); gl_FragColor = vec4( d.x, s.x, 0.0, 1.0 ); }
}` });
  const quad = new THREE.Scene();
  quad.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), parity));
  const one = target(1), still = new THREE.Camera();
  const read = () => {
    renderer.setRenderTarget(one);
    renderer.render(quad, still);
    const pixel = new Float32Array(4);
    renderer.readRenderTargetPixels(one, 0, 0, 1, 1, pixel);
    renderer.setRenderTarget(null);
    return pixel;
  };
  let seed = 5;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const unit = (v: number[]): Vec3 => { const l = Math.hypot(...v); return [v[0]! / l, v[1]! / l, v[2]! / l]; };
  const set = (u: { value: THREE.Vector3 }, v: readonly number[]) => u.value.set(v[0]!, v[1]!, v[2]!);
  for (let n = 0; n < 48; n++) {
    probe.parity.cases++;
    const normal = unit([(next() - 0.5) * 0.9, (next() - 0.5) * 0.9, 1]), tangent = unit([1, (next() - 0.5) * 0.2, -normal[0]]);
    const axis = unit([(next() - 0.5) * 0.2, (next() - 0.5) * 0.2, 1]), view = unit([(next() - 0.5) * 1.2, (next() - 0.5) * 1.2, -1]);
    // Both orientations: literal (S = T2 × A) and as-mesh (S along the bitangent, which here points either way).
    const flip = n % 2 ? 1 : -1, bitangent = unit([normal[1] * tangent[2] - normal[2] * tangent[1], normal[2] * tangent[0] - normal[0] * tangent[2],
      normal[0] * tangent[1] - normal[1] * tangent[0]].map(c => c * flip));
    const alongB = n % 3 !== 0;
    uniforms.uMode.value = 0; set(uniforms.uView, view); set(uniforms.uNormal, normal); set(uniforms.uTangent, tangent); set(uniforms.uAxis, axis);
    set(uniforms.uBitangent, bitangent); uniforms.uAlongB.value = alongB ? 1 : 0;
    const iris = read(), twin = irisPlaneCoordinate(view, normal, tangent, axis, optics, alongB ? bitangent : undefined).uv;
    probe.parity.iris = Math.max(probe.parity.iris, Math.abs(iris[0]! - twin[0]), Math.abs(iris[1]! - twin[1]));
    const d: [number, number] = [(next() - 0.5) * 0.5, (next() - 0.5) * 0.5], bubble = unpackNormalRG(0.5 + (next() - 0.5) * 0.05, 0.5 + (next() - 0.5) * 0.05);
    const weight = Math.min(1, Math.max(0, 1 - (Math.hypot(...d) - 0.1448) / 0.0404));
    uniforms.uMode.value = 1; uniforms.uD.value.set(d[0], d[1]); uniforms.uR.value = Math.hypot(...d); set(uniforms.uBubble, bubble); uniforms.uIris.value = weight;
    const cornea = read(), corneaTwin = corneaNormal(d, bubble, weight, optics);
    probe.parity.cornea = Math.max(probe.parity.cornea, ...corneaTwin.map((c, k) => Math.abs(c - cornea[k]!)));
    const n1 = unit([next() - 0.5, next() - 0.5, 1]), n2 = unit([(next() - 0.5) * 2, (next() - 0.5) * 2, 1]), l = unit([next() - 0.5, next() - 0.5, 0.2 + next()]);
    const v = unit([next() - 0.5, next() - 0.5, 0.5 + next()]), rough = 0.03 + next() * 0.4, colour = next();
    uniforms.uMode.value = 2; set(uniforms.uN1, n1); set(uniforms.uN2, n2); set(uniforms.uL, l); set(uniforms.uV, v);
    uniforms.uRough.value = rough; uniforms.uAlbedo.value.set(colour, colour, colour); uniforms.uMetal.value = 0;
    const lit = read(), litTwin = eyeDirectLight({ n1, n2, light: l, view: v, roughness: rough, albedo: [colour, colour, colour], metalness: 0 });
    probe.parity.diffuse = Math.max(probe.parity.diffuse, Math.abs(lit[0]! - litTwin.diffuse[0]));
    probe.parity.specular = Math.max(probe.parity.specular, Math.abs(lit[1]! - litTwin.specular[0]) / Math.max(1, litTwin.specular[0]));
  }

  // 2. Before and after on the synthetic eyeball.
  const geometry = eyeball();
  prepareEyeballGeometry([geometry]);
  const after = createEyeMaterial({ albedo, roughness, normal: relief }, eyeParameters({ scalars: {} })).material;
  const before = legacyEye();
  const frame = target(SIZE);
  const camera = new THREE.PerspectiveCamera(20, 1, 0.001, 1);
  const distance = 0.1;
  probe.scale = SIZE / (2 * distance * Math.tan(10 * Math.PI / 180)) / 1000;
  const shoot = (material: THREE.Material, light: THREE.Vector3, viewDegrees: number, zoom?: THREE.Vector3): EyeFrame => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.copy(light);
    scene.add(key);
    const angle = viewDegrees * Math.PI / 180;
    if (zoom) { camera.position.set(zoom.x, zoom.y, zoom.z + 0.02); camera.lookAt(zoom); }
    else { camera.position.set(Math.sin(angle) * distance, 0, Math.cos(angle) * distance); camera.lookAt(0, 0, 0); }
    camera.updateMatrixWorld();
    renderer.setRenderTarget(frame);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Float32Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(frame, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(null);
    const luminance = (i: number) => 0.2126 * pixels[i * 4]! + 0.7152 * pixels[i * 4 + 1]! + 0.0722 * pixels[i * 4 + 2]!;
    let peak = 0, total = 0;
    for (let i = 0; i < SIZE * SIZE; i++) { peak = Math.max(peak, luminance(i)); total += luminance(i); }
    let highlightPixels = 0;
    for (let i = 0; i < SIZE * SIZE; i++) if (luminance(i) > peak * 0.25) highlightPixels++;
    // The iris ring on screen (straight views only): pixels within the ring's projected radii around the centre.
    const ring: number[] = [];
    const centre = SIZE / 2, pixelsPerMm = probe.scale;
    const inner = 0.3 * RADIUS * 1000 * pixelsPerMm, outer = 0.33 * RADIUS * 1000 * pixelsPerMm * 1.1;
    const pupil = [0, 0, 0], marker = [0, 0, 0];
    for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
      const i = row * SIZE + column, r = Math.hypot(column + 0.5 - centre, row + 0.5 - centre);
      const [red, green, blue] = [pixels[i * 4]!, pixels[i * 4 + 1]!, pixels[i * 4 + 2]!];
      if (r > inner && r < outer && luminance(i) < peak * 0.25) ring.push(luminance(i));
      // The pupil and the marker by their colours, whatever the light (the highlight is white and fails both).
      if (blue > 1e-4 && blue > 3 * red && blue > 1.5 * green) { pupil[0]! += column; pupil[1]! += row; pupil[2]!++; }
      if (red > 1e-4 && red > 4 * green && red > 4 * blue) { marker[0]! += column; marker[1]! += row; marker[2]!++; }
    }
    const mean = ring.reduce((a, b) => a + b, 0) / Math.max(1, ring.length);
    const spread = Math.sqrt(ring.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ring.length));
    // The frame's centre (within 30 pixels): the zoomed specular frames aim it at the expected catch light.
    const core = { peak: 0, total: 0, pixels: 0 };
    for (let i = 0; i < SIZE * SIZE; i++) if (Math.hypot(i % SIZE + 0.5 - SIZE / 2, Math.floor(i / SIZE) + 0.5 - SIZE / 2) < 30) {
      core.peak = Math.max(core.peak, luminance(i)); core.total += luminance(i);
    }
    for (let i = 0; i < SIZE * SIZE; i++) if (Math.hypot(i % SIZE + 0.5 - SIZE / 2, Math.floor(i / SIZE) + 0.5 - SIZE / 2) < 30 && luminance(i) > core.peak / 4) core.pixels++;
    return { peak, highlightPixels, total, core, irisContrast: mean > 0 ? spread / mean : 0,
      // Image rows count up from the bottom (readPixels); centroids are relative to the image centre, +y up.
      pupil: pupil[2]! > 3 ? [pupil[0]! / pupil[2]! + 0.5 - centre, pupil[1]! / pupil[2]! + 0.5 - centre] : null,
      marker: marker[2]! > 3 ? [marker[0]! / marker[2]! + 0.5 - centre, marker[1]! / marker[2]! + 0.5 - centre] : null };
  };
  const nearCamera = new THREE.Vector3(0.2, 0.25, 1), side = new THREE.Vector3(1, 0.1, 0.35);
  for (const [name, material] of [["before", before], ["after", after]] as const) {
    const out = name === "before" ? probe.before : probe.after;
    out.catchLight = shoot(material, nearCamera, 0);
    out.sideLight = shoot(material, side, 0);
    out.view30 = shoot(material, nearCamera, 30);
  }
  // Specular alone (black albedo, no iris relief), zoomed to about 18 pixels per millimetre on a catch light on the sclera (normal
  // along L + V, 37° off the axis: mesh UV radius 0.24, outside the iris, where both normals are the sphere's); `core` measures it.
  // The eye light adds a second catch light where the cornea bulge over the iris faces the half vector (the frame's edge here), and
  // over the iris its highlight grows where the relief turns from the light.
  const black = painted(4, () => [0, 0, 0, 255], true);
  const scleraLight = new THREE.Vector3(1.6, 0.8, 0.5);
  const point = scleraLight.clone().normalize().add(new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(RADIUS);
  const flatEye = createEyeMaterial({ albedo: black, roughness }, eyeParameters({ scalars: {} }));
  flatEye.handle.setSourceRoughness(false);
  probe.specular = { before: shoot(legacyEye(black), scleraLight, 0, point), afterFlat: shoot(flatEye.material, scleraLight, 0, point),
    after: shoot(createEyeMaterial({ albedo: black, roughness }, eyeParameters({ scalars: {} })).material, scleraLight, 0, point) };
  const gl = renderer.getContext();
  const glError = gl.getError();
  if (glError !== gl.NO_ERROR) probe.errors.push(`WebGL error ${glError}`);
  for (const program of renderer.info.programs ?? []) {
    const diagnostics = (program as unknown as { diagnostics?: { runnable: boolean; programLog: string } }).diagnostics;
    if (diagnostics && !diagnostics.runnable) probe.errors.push(`${program.name}: ${diagnostics.programLog}`);
  }
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
(window as unknown as { probe?: EyeProbe }).probe = probe;
