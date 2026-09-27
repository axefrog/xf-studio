/**
 * Renderer device for choice previews (choice-previews-design.md §6): draws one preview source over the subject head into a theme-free
 * channel image (choice-preview.ts) with its own small WebGL 2 context on an OffscreenCanvas. It runs in the preview worker
 * (choice-preview-worker.ts), off the main thread and outside the viewport's frame budget; a probe page can run it too.
 *
 * - **Exact coverage.** Every chunk is alpha-tested against a 2 × 2 ordered threshold at twice the output size with 4× MSAA, then
 *   resolved and averaged down 2:1, so each output pixel holds 16 geometric samples and its 4 coverage thresholds exactly once: the
 *   resolved RGBA is the premultiplied channel image (A = covered fraction, B = feature fraction of it), unpremultiplied on readback.
 *   Hair strands use `Strand_Alpha` remapped by the template's cutoff and the game's dither range (render-templates.ts `coverage`).
 * - **One soft light**, both faces lit alike, no specular or shadow.
 * - **One source at a time.** The subject head is loaded once; a source's geometry and textures are uploaded, drawn and disposed within
 *   its job. A lost context fails the job (the caller recreates the renderer once).
 */
import { type Glb, parseGlb, readAccessor, type AccessorArray } from "./glb";
import { type Bounds, type ChoicePreviewSource, PREVIEW_STYLES, type PreviewCoverage, type PreviewStyle, previewCamera } from "./choice-preview";
import { HAIR_DITHER } from "./hair-colour-model";

export type PreviewTimings = { fetchMs: number; parseMs: number; decodeMs: number; drawMs: number; readMs: number; encodeMs: number; bytesIn: number; triangles: number };
export type RenderedPreview = { webp: Blob; width: number; height: number; timings: PreviewTimings;
  /** The unpremultiplied channel pixels (rows top-down), for probes. */
  pixels?: Uint8ClampedArray };
export type PreviewFetch = (url: string) => Promise<ArrayBuffer>;
/** The subject: the core head GLB and the names of its head and eye nodes (render-detail.ts `CoreDetail.geometry.nodes`). */
export type PreviewSubject = { glb: ArrayBuffer; head: string; eyes: string | null };

type Mesh = { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number; indexType: number; model: Float32Array; normal: Float32Array; chunk: number | null };

const VERTEX = `#version 300 es
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 viewProjection, model; uniform mat3 normalMatrix;
out vec3 vNormal; out vec2 vUv;
void main() { vNormal = normalMatrix * normal; vUv = uv; gl_Position = viewProjection * model * vec4(position, 1.0); }`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal; in vec2 vUv;
uniform sampler2D coverage; uniform int textured, channel, dither; uniform float cutoff, feature;
uniform vec3 light; uniform vec2 range;
out vec4 colour;
float threshold() { ivec2 q = ivec2(gl_FragCoord.xy) & 1; int i = q.x == 0 ? (q.y == 0 ? 0 : 3) : (q.y == 0 ? 2 : 1); return (float(i) + 0.5) / 4.0; }
void main() {
  float c = 1.0;
  if (textured == 1) {
    vec4 t = texture(coverage, vUv);
    c = channel == 0 ? t.r : channel == 1 ? t.g : channel == 2 ? t.b : t.a;
    if (cutoff >= 0.0) c = cutoff >= 1.0 ? 0.0 : clamp((c - cutoff) / (1.0 - cutoff), 0.0, 1.0);
    if (dither == 1) c = clamp((c - ${HAIR_DITHER.offset.toPrecision(9)}) / ${(5 * HAIR_DITHER.step).toPrecision(9)}, 0.0, 1.0);
  }
  if (c <= threshold()) discard;
  vec3 n = normalize(vNormal); if (!gl_FrontFacing) n = -n;
  float l = mix(range.x, range.y, smoothstep(0.0, 1.0, dot(n, light) * 0.5 + 0.5));
  colour = feature > 0.5 ? vec4(l, 0.0, 1.0, 1.0) : vec4(0.0, l, 0.0, 1.0);
}`;

const now = () => performance.now();
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array } as const;
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
/** An accessor's elements: a view on the binary chunk when tightly packed and aligned, else a copy (glb.ts `readAccessor`). */
function accessor(glb: Glb, index: number): { array: AccessorArray; width: number; componentType: number; normalized: boolean } {
  const a = glb.json.accessors?.[index];
  const Type = ARRAYS[a?.componentType as 5126], width = WIDTH[a?.type];
  const view = a?.bufferView !== undefined ? glb.json.bufferViews?.[a.bufferView] : undefined;
  if (Type && width && view && !a.sparse) {
    const size = Type.BYTES_PER_ELEMENT, offset = glb.bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if ((view.byteStride === undefined || view.byteStride === width * size) && offset % size === 0 && (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * width * size <= glb.bin.byteLength)
      return { array: new Type(glb.bin.buffer, offset, a.count * width), width, componentType: a.componentType, normalized: !!a.normalized };
  }
  const read = readAccessor(glb, index);
  return { array: read.array, width: read.width, componentType: read.componentType, normalized: read.normalized };
}

type Mat = Float32Array;
const identity = (): Mat => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a: Mat, b: Mat): Mat {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}
/** A glTF node's local matrix (matrix, or translation/rotation/scale). */
function localMatrix(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat {
  if (node.matrix?.length === 16) return new Float32Array(node.matrix);
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return new Float32Array([
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1]);
}
/** The normal matrix (inverse transpose of the upper 3 × 3) of `m`. */
function normalMatrix(m: Mat): Float32Array {
  const [a, b, c, d, e, f, g, h, i] = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1;
  return new Float32Array([A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det]);
}
/** WolvenKit names each render chunk's mesh `submesh_<chunk>_LOD_<lod>` (render-detail.ts `chunkOfMesh`). */
const chunkLod = (name: string | undefined) => { const m = /^submesh_(\d+)_LOD_(\d+)/.exec(name ?? ""); return m ? { chunk: Number(m[1]), lod: Number(m[2]) } : null; };

/** Every mesh node of a GLB with its world matrix and name (its own or its mesh's), optionally only below the named nodes. */
function meshNodes(glb: Glb, only?: readonly string[]): { node: number; mesh: number; world: Mat; name: string }[] {
  const nodes = glb.json.nodes ?? [], out: { node: number; mesh: number; world: Mat; name: string }[] = [];
  const children = new Set<number>(nodes.flatMap((node: { children?: number[] }) => node.children ?? []));
  const roots: number[] = glb.json.scenes?.[glb.json.scene ?? 0]?.nodes ?? nodes.map((_: unknown, index: number) => index).filter((index: number) => !children.has(index));
  const walk = (index: number, parent: Mat, inside: boolean, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) return;
    const world = multiply(parent, localMatrix(node));
    const here = inside || !only || only.includes(node.name) || (node.mesh !== undefined && only.includes(glb.json.meshes?.[node.mesh]?.name));
    if (node.mesh !== undefined && here) out.push({ node: index, mesh: node.mesh, world, name: node.name ?? glb.json.meshes?.[node.mesh]?.name ?? "" });
    for (const child of node.children ?? []) walk(child, world, here && !!only, depth + 1);
  };
  for (const root of roots) walk(root, identity(), false, 0);
  return out;
}

export class PreviewRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly attributes: { position: number; normal: number; uv: number };
  private subject: Mesh[] = [];
  private headBounds: Bounds | null = null;
  private eyeBounds: Bounds | null = null;
  private lost = false;
  private targets: { size: number; ms: WebGLFramebuffer; msColour: WebGLRenderbuffer; msDepth: WebGLRenderbuffer; big: WebGLFramebuffer; bigTexture: WebGLTexture;
    small: WebGLFramebuffer; smallTexture: WebGLTexture } | null = null;

  constructor(private readonly canvas: OffscreenCanvas, private readonly fetchFile: PreviewFetch) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, depth: false, premultipliedAlpha: true, preserveDrawingBuffer: false,
      powerPreference: "low-power" }) as WebGL2RenderingContext | null;
    if (!gl) throw Error("WebGL 2 isn't available for previews.");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); this.lost = true; });
    const shader = (type: number, text: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(`Preview shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(`Preview program: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    for (const name of ["viewProjection", "model", "normalMatrix", "coverage", "textured", "channel", "dither", "cutoff", "feature", "light", "range"])
      this.uniforms[name] = gl.getUniformLocation(program, name);
    this.attributes = { position: gl.getAttribLocation(program, "position"), normal: gl.getAttribLocation(program, "normal"), uv: gl.getAttribLocation(program, "uv") };
  }
  get contextLost() { return this.lost || this.gl.isContextLost(); }

  /** Load the subject head once (its head and eye nodes); its bounds frame every preview. */
  setSubject(subject: PreviewSubject): void {
    for (const mesh of this.subject) this.disposeMesh(mesh);
    const glb = parseGlb(new Uint8Array(subject.glb));
    const head = meshNodes(glb, [subject.head]), eyes = subject.eyes ? meshNodes(glb, [subject.eyes]) : [];
    const heads = head.flatMap(node => this.upload(glb, node, null)), eyeMeshes = eyes.flatMap(node => this.upload(glb, node, null));
    this.headBounds = boundsOf(glb, head); this.eyeBounds = eyes.length ? boundsOf(glb, eyes) : null;
    this.subject = [...heads, ...eyeMeshes];
    if (!this.headBounds) throw Error("The preview subject has no head geometry.");
  }

  /** Draw one source into its channel image and encode it (WebP). */
  async render(source: ChoicePreviewSource, options: { keepPixels?: boolean; urlOf: (file: string) => string }): Promise<RenderedPreview> {
    if (!this.headBounds) throw Error("The preview subject isn't loaded.");
    const gl = this.gl, style = PREVIEW_STYLES[source.kind];
    const timings: PreviewTimings = { fetchMs: 0, parseMs: 0, decodeMs: 0, drawMs: 0, readMs: 0, encodeMs: 0, bytesIn: 0, triangles: 0 };
    const meshes: Mesh[] = [], textures = new Map<string, WebGLTexture>();
    try {
      // Fetch every file first (geometry and coverage), one source at a time.
      let at = now();
      const files = new Map<string, ArrayBuffer>();
      for (const file of new Set(source.parts.flatMap(part => [part.file, ...part.chunks.flatMap(chunk => chunk.coverage ? [chunk.coverage.file] : [])]))) {
        const bytes = await this.fetchFile(options.urlOf(file));
        files.set(file, bytes);
        timings.bytesIn += bytes.byteLength;
      }
      timings.fetchMs = now() - at;
      at = now();
      const drawn: { mesh: Mesh; coverage: PreviewCoverage | null }[] = [];
      for (const part of source.parts) {
        const glb = parseGlb(new Uint8Array(files.get(part.file)!));
        const wanted = new Map(part.chunks.map(chunk => [chunk.chunk, chunk.coverage]));
        // The lowest LOD of each wanted chunk.
        const nodes = meshNodes(glb).map(node => ({ node, id: chunkLod(node.name) ?? chunkLod(glb.json.meshes?.[node.mesh]?.name) }))
          .filter(entry => entry.id && wanted.has(entry.id.chunk));
        const lod = new Map<number, number>();
        for (const { id } of nodes) lod.set(id!.chunk, Math.min(lod.get(id!.chunk) ?? Infinity, id!.lod));
        for (const { node, id } of nodes) {
          if (id!.lod !== lod.get(id!.chunk)) continue;
          for (const mesh of this.upload(glb, node, id!.chunk)) { meshes.push(mesh); drawn.push({ mesh, coverage: wanted.get(id!.chunk) ?? null }); timings.triangles += mesh.count / 3; }
        }
      }
      timings.parseMs = now() - at;
      at = now();
      for (const coverage of new Set(drawn.flatMap(entry => entry.coverage ? [entry.coverage.file] : []))) {
        const bitmap = await decodeCoverage(files.get(coverage)!, style.size * style.supersample);
        textures.set(coverage, this.uploadTexture(bitmap));
        bitmap.close();
      }
      timings.decodeMs = now() - at;
      files.clear();
      at = now();
      const pixels = this.draw(style, drawn, textures);
      timings.drawMs = now() - at;
      if (this.contextLost) throw Error("The preview context was lost.");
      at = now();
      const image = new ImageData(pixels, style.size, style.size);
      timings.readMs = now() - at;
      at = now();
      const canvas = new OffscreenCanvas(style.size, style.size);
      canvas.getContext("2d")!.putImageData(image, 0, 0);
      const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
      timings.encodeMs = now() - at;
      return { webp, width: style.size, height: style.size, timings, ...(options.keepPixels ? { pixels } : {}) };
    } finally {
      for (const mesh of meshes) this.disposeMesh(mesh);
      for (const texture of textures.values()) gl.deleteTexture(texture);
    }
  }

  private draw(style: PreviewStyle, drawn: { mesh: Mesh; coverage: PreviewCoverage | null }[], textures: Map<string, WebGLTexture>): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl, big = style.size * style.supersample, t = this.targetsFor(style);
    const camera = previewCamera(this.headBounds!, this.eyeBounds, style);
    const viewProjection = multiplyColumn(camera.projection, camera.view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.ms);
    gl.viewport(0, 0, big, big);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    const u = this.uniforms;
    gl.uniformMatrix4fv(u.viewProjection!, false, viewProjection);
    // The light is fixed in view space: turn it into world space through the view's rotation (its transpose).
    const v = camera.view, [lx, ly, lz] = normalise(style.light);
    gl.uniform3f(u.light!, v[0]! * lx + v[1]! * ly + v[2]! * lz, v[4]! * lx + v[5]! * ly + v[6]! * lz, v[8]! * lx + v[9]! * ly + v[10]! * lz);
    gl.uniform2f(u.range!, style.range[0], style.range[1]);
    gl.uniform1i(u.coverage!, 0);
    const drawMesh = (mesh: Mesh, feature: boolean, coverage: PreviewCoverage | null) => {
      const texture = coverage ? textures.get(coverage.file) : undefined;
      gl.uniformMatrix4fv(u.model!, false, mesh.model);
      gl.uniformMatrix3fv(u.normalMatrix!, false, mesh.normal);
      gl.uniform1f(u.feature!, feature ? 1 : 0);
      gl.uniform1i(u.textured!, texture ? 1 : 0);
      gl.uniform1i(u.channel!, coverage?.channel ?? 0);
      gl.uniform1i(u.dither!, coverage?.dither ? 1 : 0);
      gl.uniform1f(u.cutoff!, coverage?.cutoff ?? -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture ?? null);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    };
    gl.disable(gl.POLYGON_OFFSET_FILL);
    for (const mesh of this.subject) drawMesh(mesh, false, null);
    // The feature wins where it lies on the subject (a cap over the scalp).
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -4);
    for (const { mesh, coverage } of drawn) drawMesh(mesh, true, coverage);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    // Resolve the samples, then average 2:1 (a linear blit samples between four texels).
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.big);
    gl.blitFramebuffer(0, 0, big, big, 0, 0, big, big, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.big); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.small);
    gl.blitFramebuffer(0, 0, big, big, 0, 0, style.size, style.size, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.small);
    const size = style.size, raw = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Rows bottom-up and premultiplied by coverage: flip and unpremultiply.
    const out = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4, to = (y * size + x) * 4, a = raw[from + 3]!;
      if (!a) continue;
      out[to] = (raw[from]! * 255) / a; out[to + 1] = (raw[from + 1]! * 255) / a; out[to + 2] = (raw[from + 2]! * 255) / a; out[to + 3] = a;
    }
    return out;
  }

  private targetsFor(style: PreviewStyle) {
    const gl = this.gl, size = style.size * style.supersample;
    if (this.targets?.size === size) return this.targets;
    this.disposeTargets();
    const ms = gl.createFramebuffer()!, msColour = gl.createRenderbuffer()!, msDepth = gl.createRenderbuffer()!;
    const samples = Math.min(style.msaa, gl.getParameter(gl.MAX_SAMPLES) as number);
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColour); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, size, size);
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, size, size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColour);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    const colourTarget = (side: number) => {
      const texture = gl.createTexture()!, framebuffer = gl.createFramebuffer()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, side, side);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return { texture, framebuffer };
    };
    const bigTarget = colourTarget(size), smallTarget = colourTarget(style.size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = { size, ms, msColour, msDepth, big: bigTarget.framebuffer, bigTexture: bigTarget.texture, small: smallTarget.framebuffer, smallTexture: smallTarget.texture };
    return this.targets;
  }

  private upload(glb: Glb, node: { mesh: number; world: Mat }, chunk: number | null): Mesh[] {
    const gl = this.gl, out: Mesh[] = [];
    for (const primitive of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4 || primitive.attributes?.POSITION === undefined) continue;
      const vao = gl.createVertexArray()!, buffers: WebGLBuffer[] = [];
      gl.bindVertexArray(vao);
      const attribute = (location: number, index: number | undefined, fallback: number[]) => {
        if (location < 0) return;
        if (index === undefined) { gl.disableVertexAttribArray(location); gl.vertexAttrib4f(location, fallback[0]!, fallback[1]!, fallback[2]!, 1); return; }
        const a = accessor(glb, index), buffer = gl.createBuffer()!;
        buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, a.array, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, a.width, a.componentType, a.normalized, 0, 0);
      };
      attribute(this.attributes.position, primitive.attributes.POSITION, [0, 0, 0]);
      attribute(this.attributes.normal, primitive.attributes.NORMAL, [0, 0, 1]);
      attribute(this.attributes.uv, primitive.attributes.TEXCOORD_0, [0, 0, 0]);
      let count: number, indexType: number;
      const indices = gl.createBuffer()!;
      buffers.push(indices);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      if (primitive.indices !== undefined) {
        const a = accessor(glb, primitive.indices);
        const array = a.array instanceof Uint32Array || a.array instanceof Uint16Array || a.array instanceof Uint8Array ? a.array : new Uint32Array(a.array);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, array, gl.STATIC_DRAW);
        count = array.length;
        indexType = array instanceof Uint32Array ? gl.UNSIGNED_INT : array instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;
      } else {
        const vertices = glb.json.accessors[primitive.attributes.POSITION].count as number;
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint32Array.from({ length: vertices }, (_, i) => i), gl.STATIC_DRAW);
        count = vertices; indexType = gl.UNSIGNED_INT;
      }
      gl.bindVertexArray(null);
      out.push({ vao, buffers, count, indexType, model: node.world, normal: normalMatrix(node.world), chunk });
    }
    return out;
  }
  private uploadTexture(bitmap: ImageBitmap): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return texture;
  }
  private disposeMesh(mesh: Mesh) { this.gl.deleteVertexArray(mesh.vao); for (const buffer of mesh.buffers) this.gl.deleteBuffer(buffer); }
  private disposeTargets() {
    const t = this.targets, gl = this.gl;
    if (!t) return;
    gl.deleteFramebuffer(t.ms); gl.deleteRenderbuffer(t.msColour); gl.deleteRenderbuffer(t.msDepth);
    gl.deleteFramebuffer(t.big); gl.deleteTexture(t.bigTexture); gl.deleteFramebuffer(t.small); gl.deleteTexture(t.smallTexture);
    this.targets = null;
  }
  dispose(): void {
    for (const mesh of this.subject) this.disposeMesh(mesh);
    this.subject = [];
    this.disposeTargets();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

const normalise = (v: readonly number[]) => { const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / l, v[1]! / l, v[2]! / l] as const; };
const multiplyColumn = (a: Float32Array, b: Float32Array) => multiply(a, b);
/** World-space bounds of mesh nodes' positions. */
function boundsOf(glb: Glb, nodes: { mesh: number; world: Mat }[]): Bounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) for (const primitive of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
    if (primitive.attributes?.POSITION === undefined) continue;
    const p = accessor(glb, primitive.attributes.POSITION).array, m = node.world;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
      const w = [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
      for (let k = 0; k < 3; k++) { if (w[k]! < min[k]!) min[k] = w[k]!; if (w[k]! > max[k]!) max[k] = w[k]!; }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}
/** A coverage texture decoded at no more than `side` pixels, channels untouched (no premultiplying, no colour conversion). */
async function decodeCoverage(bytes: ArrayBuffer, side: number): Promise<ImageBitmap> {
  const blob = new Blob([bytes], { type: "image/png" }), header = new DataView(bytes);
  // The PNG header names the size, so a large texture is decoded once, straight to its smaller size.
  const png = bytes.byteLength > 24 && header.getUint32(12) === 0x49484452;
  const width = png ? header.getUint32(16) : side, height = png ? header.getUint32(20) : side;
  const scale = Math.min(1, side / Math.max(width, height, 1));
  const base = { premultiplyAlpha: "none", colorSpaceConversion: "none" } as const;
  return scale >= 1 ? createImageBitmap(blob, base)
    : createImageBitmap(blob, { ...base, resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: "medium" });
}
