// Derive an eye plate triangle selection for another player head from the built-in (feminine) plate, by the rule of the
// male V plan (research/character-customization/male-v-plan.md §4.1): the target head's render-chunk triangles whose three
// corner UVs all belong to the reference plate's vertex UVs. It prints the recipe's `selection` block (face ranges, counts,
// ID hashes and topology) as JSON; it reads WolvenKit's GLB exports of the two heads' morph targets and writes nothing.
//
//   bun tools/derive-plate-selection.ts --reference PATH_TO_pwa_morphs.glb --target PATH_TO_pma_morphs.glb
//
// The output is asset-free (triangle indices and counts only). A selection derived here is not an audited Build recipe:
// the skin-byte, lift and clearance gates of the eye plate still apply before Build may use it (plan phase 5).
import { readFileSync } from "node:fs";
import { parseGlb, readAccessor, type Glb, type GltfJson } from "../src/glb";
import { EYE_PLATE_RECIPE, idListSha256, selectedFaceIds } from "../src/eye-plate-recipe";

/**
 * The recipe's topology summary, tolerant of pinched boundaries (a vertex on more than two boundary edges), which the audited
 * plate gate (`plateTopology` in eye-plate-verify.ts) refuses; they are counted instead, because a derived selection is a
 * candidate for that gate, not a result of it.
 */
function selectionTopology(triangles: number[][], vertexCount: number) {
  const edges = new Map<string, number>();
  const neighbours = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const face of triangles) for (let corner = 0; corner < 3; corner++) {
    const a = face[corner]!, b = face[(corner + 1) % 3]!;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
    neighbours[a]!.add(b); neighbours[b]!.add(a);
  }
  const walk = (graph: Set<number>[], seeds: Iterable<number>) => {
    const seen = new Set<number>(), sizes: number[] = [];
    for (const seed of seeds) {
      if (seen.has(seed)) continue;
      const stack = [seed]; seen.add(seed); let size = 0;
      while (stack.length) { size++; for (const next of graph[stack.pop()!]!) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
      sizes.push(size);
    }
    return sizes;
  };
  const boundary = [...edges].filter(([, uses]) => uses === 1).map(([key]) => key.split(",").map(Number) as [number, number]);
  const boundaryGraph = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const [a, b] of boundary) { boundaryGraph[a]!.add(b); boundaryGraph[b]!.add(a); }
  return {
    topology: { componentVertexCounts: walk(neighbours, neighbours.keys()).sort((a, b) => a - b), boundaryEdges: boundary.length,
      boundaryLoops: walk(boundaryGraph, boundary.flat()).length, nonManifoldEdges: [...edges.values()].filter(uses => uses > 2).length },
    pinchedBoundaryVertices: boundaryGraph.filter(set => set.size > 2).length,
  };
}

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!, process.argv[index + 1]!);
const reference = args.get("--reference"), target = args.get("--target");
if (!reference || !target) throw Error("Usage: bun tools/derive-plate-selection.ts --reference PATH_TO_pwa_morphs.glb --target PATH_TO_pma_morphs.glb");

function headOf(glb: Glb) {
  const nodes = glb.json.nodes.filter((node: GltfJson) => node.mesh !== undefined);
  if (nodes.length !== 1) throw Error("Expected exactly one mesh node in the head export.");
  const mesh = glb.json.meshes[nodes[0].mesh];
  if (mesh.primitives.length !== 1) throw Error("Expected exactly one head primitive.");
  const primitive = mesh.primitives[0];
  return { indices: Uint32Array.from(readAccessor(glb, primitive.indices).array),
    uv: readAccessor(glb, primitive.attributes.TEXCOORD_0).array as Float32Array, targets: (primitive.targets ?? []).length as number };
}
// Exact UVs are shared between the two heads; the quantisation only absorbs float formatting.
const uvKey = (uv: Float32Array, vertex: number) => `${Math.round(uv[vertex * 2]! * 1e5)},${Math.round(uv[vertex * 2 + 1]! * 1e5)}`;

const referenceHead = headOf(parseGlb(readFileSync(reference))), targetHead = headOf(parseGlb(readFileSync(target)));
const plateUvs = new Set<string>();
for (const face of selectedFaceIds(EYE_PLATE_RECIPE))
  for (let corner = 0; corner < 3; corner++) plateUvs.add(uvKey(referenceHead.uv, referenceHead.indices[face * 3 + corner]!));

const faces: number[] = [];
for (let face = 0; face < targetHead.indices.length / 3; face++)
  if ([0, 1, 2].every(corner => plateUvs.has(uvKey(targetHead.uv, targetHead.indices[face * 3 + corner]!)))) faces.push(face);
const corners = faces.flatMap(face => [0, 1, 2].map(corner => targetHead.indices[face * 3 + corner]!));
const vertexIds = [...new Set(corners)].sort((a, b) => a - b);
const compact = new Map(vertexIds.map((id, index) => [id, index]));
const triangles = faces.map(face => [0, 1, 2].map(corner => compact.get(targetHead.indices[face * 3 + corner]!)!));
const ranges: [number, number][] = [];
for (const face of faces) {
  const last = ranges[ranges.length - 1];
  if (last && last[1] === face - 1) last[1] = face; else ranges.push([face, face]);
}
const shape = selectionTopology(triangles, vertexIds.length);
let area = 0;
for (const face of faces) {
  const [a, b, c] = [0, 1, 2].map(corner => targetHead.indices[face * 3 + corner]!);
  const [ax, ay, bx, by, cx, cy] = [a, a, b, b, c, c].map((vertex, index) => targetHead.uv[vertex * 2 + (index % 2)]!);
  area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}
console.log(JSON.stringify({
  measured: { referencePlateUvs: plateUvs.size, uvArea: +area.toFixed(6), targetMorphTargets: targetHead.targets,
    pinchedBoundaryVertices: shape.pinchedBoundaryVertices },
  selection: {
    renderChunk: 0, faceCount: faces.length, vertexCount: vertexIds.length, morphTargetCount: targetHead.targets,
    faceIdsSha256: idListSha256(faces), vertexIdsSha256: idListSha256(vertexIds),
    topology: shape.topology, faceRangesInclusive: ranges,
  },
}, null, 1));
