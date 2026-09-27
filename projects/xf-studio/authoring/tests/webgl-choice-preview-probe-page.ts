/**
 * Browser page for tests/webgl-choice-preview.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context): the choice
 * preview renderer (src/choice-preview-render.ts) on a synthetic subject and feature, read back as its channel image. Nothing here reads
 * game files.
 *
 * The subject is a flat "head" quad facing +Z (0.3 m tall) with small "eyes" in front of it (which way the face looks). The feature GLB
 * has three chunks: 0 covers the head's left half with full coverage, 1 its right half with half coverage (red 128 through a 0.0 cutoff,
 * no dither), and 2 sits below the head but is not in the source, so it must not draw.
 */
import { GlbWriter } from "../src/glb";
import { PREVIEW_STYLES, previewCamera, type ChoicePreviewSource } from "../src/choice-preview";
import { PreviewRenderer } from "../src/choice-preview-render";

export type PreviewProbe = { ok: boolean; failure?: string; size: number; webpBytes: number;
  /** Mean channels (0–255) inside each region: full-coverage half, half-coverage half, the unlisted chunk's place, and empty ground. */
  full: number[]; half: number[]; unlisted: number[]; ground: number[]; timings?: unknown };
(window as unknown as { probe?: PreviewProbe }).probe = undefined;

type Quad = { name: string; x: [number, number]; y: [number, number]; z: number };
function glbOf(quads: Quad[]): ArrayBuffer {
  const writer = new GlbWriter(), meshes: unknown[] = [], nodes: unknown[] = [];
  for (const quad of quads) {
    const [x0, x1] = quad.x, [y0, y1] = quad.y, z = quad.z;
    const position = writer.add(new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]), "VEC3", { bounds: true });
    const normal = writer.add(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), "VEC3");
    const uv = writer.add(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), "VEC2");
    const indices = writer.add(new Uint16Array([0, 1, 2, 0, 2, 3]), "SCALAR");
    meshes.push({ name: quad.name, primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices, mode: 4 }] });
    nodes.push({ name: quad.name, mesh: meshes.length - 1 });
  }
  const bytes = writer.toGlb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function pngOf(red: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(8, 8), context = canvas.getContext("2d")!;
  context.fillStyle = `rgb(${red}, 0, 0)`;
  context.fillRect(0, 0, 8, 8);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}
const hex = (n: number) => n.toString(16).padStart(64, "0");

async function run(): Promise<PreviewProbe> {
  const files = new Map<string, ArrayBuffer>([
    [`${hex(1)}.glb`, glbOf([{ name: "submesh_00_LOD_1", x: [-0.1, 0], y: [1.5, 1.8], z: 0.02 }, { name: "submesh_01_LOD_1", x: [0, 0.1], y: [1.5, 1.8], z: 0.02 },
      { name: "submesh_02_LOD_1", x: [-0.05, 0.05], y: [1.33, 1.43], z: 0.02 }])],
    [`${hex(2)}.png`, await pngOf(255)], [`${hex(3)}.png`, await pngOf(128)],
  ]);
  const subject = glbOf([{ name: "head", x: [-0.1, 0.1], y: [1.5, 1.8], z: 0 }, { name: "eyes", x: [-0.04, 0.04], y: [1.69, 1.71], z: 0.01 }]);
  const renderer = new PreviewRenderer(new OffscreenCanvas(1, 1), async url => files.get(url)!);
  renderer.setSubject({ glb: subject, head: "head", eyes: "eyes" });
  const coverage = (n: number) => ({ file: `${hex(n)}.png`, sha256: hex(n), depotPath: "synthetic.xbm", channel: 0 as const, cutoff: 0, dither: false });
  const source: ChoicePreviewSource = { schema: "xfs/choice-preview-1", kind: "hair", parts: [{ file: `${hex(1)}.glb`, sha256: hex(1), depotPath: "synthetic.mesh",
    depotHash: "1", archive: null, chunks: [{ chunk: 0, coverage: coverage(2) }, { chunk: 1, coverage: coverage(3) }] }] };
  const result = await renderer.render(source, { urlOf: file => file, keepPixels: true });
  const style = PREVIEW_STYLES.hair, size = result.width, pixels = result.pixels!;
  const camera = previewCamera({ min: [-0.1, 1.5, 0], max: [0.1, 1.8, 0] }, { min: [-0.04, 1.69, 0.01], max: [0.04, 1.71, 0.01] }, style);
  const project = (p: [number, number, number]) => {
    const v = camera.view, m = camera.projection;
    const e = [0, 1, 2, 3].map(r => v[r]! * p[0] + v[4 + r]! * p[1] + v[8 + r]! * p[2] + v[12 + r]!);
    const c = [0, 1, 2, 3].map(r => m[r]! * e[0]! + m[4 + r]! * e[1]! + m[8 + r]! * e[2]! + m[12 + r]! * e[3]!);
    return [((c[0]! / c[3]! + 1) / 2) * size, ((1 - c[1]! / c[3]!) / 2) * size];
  };
  /** Mean channels over a small square around a world point. */
  const mean = (p: [number, number, number]) => {
    const [cx, cy] = project(p), sum = [0, 0, 0, 0];
    let n = 0;
    for (let y = Math.round(cy!) - 3; y <= Math.round(cy!) + 3; y++) for (let x = Math.round(cx!) - 3; x <= Math.round(cx!) + 3; x++) {
      for (let k = 0; k < 4; k++) sum[k]! += pixels[(y * size + x) * 4 + k]!;
      n++;
    }
    return sum.map(value => value / n);
  };
  return { ok: true, size, webpBytes: result.webp.size, full: mean([-0.05, 1.65, 0.02]), half: mean([0.05, 1.65, 0.02]), unlisted: mean([0, 1.38, 0.02]),
    ground: mean([0.2, 1.4, 0]), timings: result.timings };
}
run().then(probe => { (window as unknown as { probe?: PreviewProbe }).probe = probe; },
  error => { (window as unknown as { probe?: PreviewProbe }).probe = { ok: false, failure: String((error as Error)?.stack ?? error), size: 0, webpBytes: 0, full: [], half: [], unlisted: [], ground: [] }; });
