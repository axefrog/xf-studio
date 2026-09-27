// Derive an eye plate triangle selection for another player head from the built-in (feminine) plate, by the rule of the
// male V plan (research/character-customization/male-v-plan.md §4.1): the target head's render-chunk triangles whose three
// corner UVs all belong to the reference plate's vertex UVs. It prints the recipe's `selection` block (face ranges, counts,
// ID hashes and topology) as JSON; it reads WolvenKit's GLB exports of the two heads' morph targets and writes nothing.
//
//   bun tools/derive-plate-selection.ts --reference PATH_TO_pwa_morphs.glb --target PATH_TO_pma_morphs.glb
//
// The output is asset-free (triangle indices and counts only). A selection derived here is not an audited Build recipe:
// the eye plate's gates (eye-plate-verify.ts, against the head's native bytes) decide that.
//
// It also finds the target head's native seams inside the selection: vertices stored twice at one position whose normal,
// skin and every morph target delta are equal, so the copies never part. The head's own triangles leave a zero-width slit
// between them, which the raw topology counts as extra boundary loops or a pinched vertex; the `seams` block is the
// topology with those welded (male V plan §4.1, phase 5). The plate verifier re-derives both from the native bytes.
import { readFileSync } from "node:fs";
import { parseGlb, readAccessor, type Glb, type GltfJson } from "../src/glb";
import { EYE_PLATE_RECIPE, idListSha256, selectedFaceIds } from "../src/eye-plate-recipe";
import { plateTopology, weldedSeams } from "../src/eye-plate-verify";

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
  const read = (accessor: number) => readAccessor(glb, accessor);
  const row = (accessor: ReturnType<typeof read>, vertex: number) => Array.from(accessor.array.slice(vertex * accessor.width, (vertex + 1) * accessor.width)).join(",");
  const position = read(primitive.attributes.POSITION);
  const deforming = [primitive.attributes.NORMAL, primitive.attributes.JOINTS_0, primitive.attributes.WEIGHTS_0, primitive.attributes.JOINTS_1,
    primitive.attributes.WEIGHTS_1, ...(primitive.targets ?? []).flatMap((target: GltfJson) => [target.POSITION, target.NORMAL])]
    .filter((accessor: number | undefined) => accessor !== undefined).map(read);
  return { indices: Uint32Array.from(read(primitive.indices).array),
    uv: read(primitive.attributes.TEXCOORD_0).array as Float32Array, targets: (primitive.targets ?? []).length as number,
    position: (vertex: number) => row(position, vertex), deforms: (vertex: number) => deforming.map(accessor => row(accessor, vertex)).join("|") };
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
const topology = plateTopology(triangles, vertexIds.length, { pinches: "count" });
let pinchedBoundaryVertices = 0;
{
  const edges = new Map<string, number>();
  for (const face of triangles) for (let corner = 0; corner < 3; corner++) {
    const [a, b] = [face[corner]!, face[(corner + 1) % 3]!].sort((x, y) => x - y);
    edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
  }
  const degree = new Map<number, number>();
  for (const [key, uses] of edges) if (uses === 1) for (const vertex of key.split(",").map(Number)) degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
  pinchedBoundaryVertices = [...degree.values()].filter(count => count > 2).length;
}
const seams = weldedSeams(triangles, vertexIds.map(targetHead.deforms), vertexIds.map(targetHead.position));
let area = 0;
for (const face of faces) {
  const [a, b, c] = [0, 1, 2].map(corner => targetHead.indices[face * 3 + corner]!);
  const [ax, ay, bx, by, cx, cy] = [a, a, b, b, c, c].map((vertex, index) => targetHead.uv[vertex * 2 + (index % 2)]!);
  area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}
console.log(JSON.stringify({
  measured: { referencePlateUvs: plateUvs.size, uvArea: +area.toFixed(6), targetMorphTargets: targetHead.targets,
    pinchedBoundaryVertices },
  selection: {
    renderChunk: 0, faceCount: faces.length, vertexCount: vertexIds.length, morphTargetCount: targetHead.targets,
    faceIdsSha256: idListSha256(faces), vertexIdsSha256: idListSha256(vertexIds),
    topology, faceRangesInclusive: ranges, ...(seams.weldedVertices ? { seams } : {}),
  },
}, null, 1));
