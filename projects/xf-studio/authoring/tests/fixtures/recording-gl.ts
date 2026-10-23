/**
 * A real Three r186 `WebGLRenderer` over a recording WebGL 2 context, without a GPU: it builds every program exactly as it would for the
 * driver (parameters, `onBeforeCompile` hooks, includes, prefixes, the program cache) and binds every render target as it would, and the
 * context records what it is given (the shader text it would compile, by stage; each framebuffer attachment; each draw-buffer list). It
 * answers every query plausibly; nothing is drawn.
 */
import * as THREE from "three";

/** The real values of the constants the records are read by (the rest are made up, consistently, as they are asked for). */
const GL = { VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, LINK_STATUS: 0x8b82, COMPILE_STATUS: 0x8b81, FRAMEBUFFER: 0x8d40,
  FRAMEBUFFER_COMPLETE: 0x8cd5, COLOR_ATTACHMENT0: 0x8ce0, DEPTH_ATTACHMENT: 0x8d00, STENCIL_ATTACHMENT: 0x8d20,
  DEPTH_STENCIL_ATTACHMENT: 0x821a, NONE: 0, NO_ERROR: 0, BACK: 0x0405, MAX_DRAW_BUFFERS: 0x8824, MAX_COLOR_ATTACHMENTS: 0x8cdf } as const;
export const RECORDED_GL = GL;
const EXTENSIONS = ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "OES_texture_float_linear"];

import type { RecordedAttachment, RecordedShader } from "./single-output";

export function recordingRenderer() {
  const sources: string[] = [], shaders: RecordedShader[] = [], attachments: RecordedAttachment[] = [], drawBuffers: number[][] = [];
  const constants: Record<string, number> = { ...GL };
  let next = 1;
  const base: Record<string, unknown> = {
    canvas: null, drawingBufferWidth: 64, drawingBufferHeight: 64,
    getParameter: (p: number) => p === constants.VERSION ? "WebGL 2.0" : p === constants.SHADING_LANGUAGE_VERSION ? "WebGL GLSL ES 3.00"
      : p === constants.VIEWPORT || p === constants.SCISSOR_BOX ? new Int32Array([0, 0, 64, 64]) : p === GL.MAX_DRAW_BUFFERS || p === GL.MAX_COLOR_ATTACHMENTS ? 8 : 16,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    // Half-float targets render, as on every GPU the Studio runs on (the layered bake and the scene-linear display ask).
    getExtension: (name: string) => EXTENSIONS.includes(name) ? {} : null, getSupportedExtensions: () => [...EXTENSIONS],
    getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true }),
    createShader: (type: number) => ({ id: next++, type }),
    shaderSource: (shader: { type: number }, source: string) => {
      sources.push(source);
      shaders.push({ stage: shader.type === GL.FRAGMENT_SHADER ? "fragment" : "vertex", source });
    },
    createProgram: () => ({ id: next++ }), getProgramParameter: (_program: object, p: number) => p === GL.LINK_STATUS ? true : 0,
    getShaderParameter: () => true, getProgramInfoLog: () => "", getShaderInfoLog: () => "", isContextLost: () => false,
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE, getError: () => 0,
    createTexture: () => ({}), createBuffer: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}), createVertexArray: () => ({}),
    framebufferTexture2D: (_target: number, attachment: number) => { attachments.push({ call: "framebufferTexture2D", attachment }); },
    framebufferTextureLayer: (_target: number, attachment: number) => { attachments.push({ call: "framebufferTextureLayer", attachment }); },
    framebufferRenderbuffer: (_target: number, attachment: number) => { attachments.push({ call: "framebufferRenderbuffer", attachment }); },
    drawBuffers: (buffers: readonly number[]) => { drawBuffers.push([...buffers]); },
  };
  const gl = new Proxy(base, { get(target, key) {
    if (typeof key === "string" && key in target) return target[key];
    if (typeof key === "string" && /^[A-Z0-9_]+$/.test(key)) return constants[key] ??= 0x1000 + Object.keys(constants).length;
    return () => null;
  } });
  const canvas = { addEventListener() {}, removeEventListener() {}, width: 64, height: 64, style: {}, getContext: () => gl } as unknown as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext });
  renderer.shadowMap.enabled = true;
  // The lights the V is drawn with: shadow-casting key and fill (the creator rig's kind), and the room's ambient.
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(15, 1, 0.01, 10);
  const key = new THREE.SpotLight(0xffffff, 10), fill = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = fill.castShadow = true;
  scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.2));
  /** Build `mesh`'s programs as drawn with `material` (the mesh's own when omitted); the programs new to the renderer, as text. */
  function compile(mesh: THREE.Mesh, material: THREE.Material = mesh.material as THREE.Material) {
    const own = mesh.material, from = sources.length;
    mesh.material = material; mesh.receiveShadow = true;
    try { renderer.compile(mesh, camera, scene); } finally { mesh.material = own; }
    const added = sources.slice(from), programs: { vertex: string; fragment: string }[] = [];
    for (let i = 0; i + 1 < added.length; i += 2) programs.push({ vertex: added[i]!, fragment: added[i + 1]! });
    return programs;
  }
  const programKey = (material: THREE.Material) => (renderer.properties.get(material) as { currentProgram?: { cacheKey: string } }).currentProgram?.cacheKey;
  return { renderer, compile, programKey, shaders, attachments, drawBuffers, scene, camera };
}

/** A skinned surface with the head's second influence set (joints_1/weights_1) and a facial target, as the head and its plate have. */
export function headSurface() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0.25, 0.5, 0.75, 0.5, 0.25, 0.625], 2));
  geometry.setAttribute("tangent", new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
  for (const [j, w] of [["skinIndex", "skinWeight"], ["joints_1", "weights_1"]] as const) {
    geometry.setAttribute(j, new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
    geometry.setAttribute(w, new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  }
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(9), 3)];
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.morphTargetDictionary = { h091_eyes: 0 }; mesh.morphTargetInfluences = [0];
  const bones = [new THREE.Bone(), new THREE.Bone()];
  mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())));
  new THREE.Group().add(mesh, ...bones);
  return mesh;
}
