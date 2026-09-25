import { accessorFloats, GlbWriter, parseGlb, readAccessor, type AccessorArray, type Glb, type GltfJson } from "./glb";
import { idListSha256, selectedFaceIds, type EyePlateRecipe } from "./eye-plate-recipe";
import { parseMorphTargetName } from "./face-morphs";

/**
 * Pure assembly of the preview's `head.glb` from WolvenKit's exports of the installed game:
 * - `head`: the bone-bound female head with all facial morph targets (WolvenKit's morph
 *   target export resolves the linked head mesh and its rig);
 * - `makeup_plate`: the expanded eye plate, cut from the same head rows with the eye plate
 *   recipe's audited triangle selection, so preview and Build share one selection;
 * - `eyes`: the eyeball surface of the matching eye mesh as static bind-pose geometry, which
 *   the renderer attaches rigidly to the gaze joints like the historical preview eye, with the
 *   facial morph targets of the eye component's own morph resource. The game pairs those with
 *   the head's by `(target, region)`, so choosing an eye shape moves the eyeballs too.
 * Every vertex value is copied from WolvenKit's decoded game data; nothing is re-derived.
 * Tangents are omitted because the preview material derives them per pixel.
 */
export const PREVIEW_GLB_GENERATOR = "XF Studio preview core deriver";
const HEAD_ATTRIBUTES = ["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1", "COLOR_0", "JOINTS_0", "WEIGHTS_0", "JOINTS_1", "WEIGHTS_1"] as const;
const REQUIRED_HEAD = ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"];
const EYE_ATTRIBUTES = ["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1"] as const;
const TARGET_ATTRIBUTES = ["POSITION", "NORMAL"] as const;

type Attribute = { data: AccessorArray; type: string; normalized: boolean; componentType: number };
type Attributes = Map<string, Attribute>;
const floats = (value: Attribute) => accessorFloats({ array: value.data, width: 0, count: 0, componentType: value.componentType, normalized: value.normalized });
type Primitive = { attributes: Attributes; indices: Uint32Array; targets: Map<string, Float32Array>[] };

export type PreviewGlbReport = {
  head: { vertices: number; triangles: number; joints: number; morphTargets: number; influenceSets: number };
  plate: { vertices: number; triangles: number; morphTargets: number };
  eyes: { vertices: number; triangles: number; uv0Min: [number, number]; uv0Max: [number, number];
    /** Eye morph targets, each paired by `(target, region)` with a head target. */
    morphTargets: number };
};

function only<T>(values: T[] | undefined, what: string): T {
  if (!values || values.length !== 1) throw Error(`Expected exactly one ${what}, found ${values?.length ?? 0}.`);
  return values[0]!;
}

function readPrimitive(glb: Glb, primitive: GltfJson, names: readonly string[], targets = true): Primitive {
  if ((primitive.mode ?? 4) !== 4 || primitive.indices === undefined) throw Error("Expected an indexed triangle list.");
  const attributes: Attributes = new Map();
  for (const name of names) {
    const index = primitive.attributes?.[name];
    if (index === undefined) continue;
    const accessor = readAccessor(glb, index);
    attributes.set(name, { data: accessor.array, type: glb.json.accessors[index].type, normalized: accessor.normalized, componentType: accessor.componentType });
  }
  const indices = Uint32Array.from(readAccessor(glb, primitive.indices).array);
  const outTargets = targets ? (primitive.targets ?? []).map((target: GltfJson) => {
    const map = new Map<string, Float32Array>();
    for (const name of TARGET_ATTRIBUTES) if (target[name] !== undefined) map.set(name, accessorFloats(readAccessor(glb, target[name])));
    return map;
  }) : [];
  return { attributes, indices, targets: outTargets };
}

type Mat4 = Float64Array;
const identity = (): Mat4 => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!;
    out[column * 4 + row] = sum;
  }
  return out;
}
function localMatrix(node: GltfJson): Mat4 {
  if (Array.isArray(node.matrix)) return Float64Array.from(node.matrix);
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1]);
}
function worldMatrices(json: GltfJson): Mat4[] {
  const parent = new Map<number, number>();
  (json.nodes ?? []).forEach((node: GltfJson, index: number) => (node.children ?? []).forEach((child: number) => parent.set(child, index)));
  const cache = new Map<number, Mat4>();
  const world = (index: number, depth = 0): Mat4 => {
    if (depth > 512) throw Error("The node hierarchy is cyclic.");
    const known = cache.get(index);
    if (known) return known;
    const up = parent.get(index);
    const value = multiply(up === undefined ? identity() : world(up, depth + 1), localMatrix(json.nodes[index]));
    cache.set(index, value);
    return value;
  };
  return (json.nodes ?? []).map((_: GltfJson, index: number) => world(index));
}

/** The largest deviation from identity of joint-world × inverse-bind over a skin (0 = bind pose equals rest pose). */
export function bindPoseDeviation(glb: Glb, skinIndex: number): number {
  const skin = glb.json.skins[skinIndex];
  const worlds = worldMatrices(glb.json);
  const inverse = skin.inverseBindMatrices === undefined ? null : readAccessor(glb, skin.inverseBindMatrices).array as Float32Array;
  let worst = 0;
  skin.joints.forEach((joint: number, index: number) => {
    const bind = inverse ? Float64Array.from(inverse.subarray(index * 16, index * 16 + 16)) : identity();
    const product = multiply(worlds[joint]!, bind), unit = identity();
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(product[k]! - unit[k]!));
  });
  return worst;
}

/** Plate rows and faces from the head's index buffer, checked against the recipe's audited vertex list. */
export function plateSelection(headIndices: Uint32Array, recipe: EyePlateRecipe): { vertexIds: number[]; faces: Uint32Array } {
  const faceIds = selectedFaceIds(recipe);
  if (headIndices.length % 3 || faceIds[faceIds.length - 1]! >= headIndices.length / 3)
    throw Error("The eye plate selection addresses triangles beyond the head.");
  const corners = faceIds.flatMap(face => [headIndices[face * 3]!, headIndices[face * 3 + 1]!, headIndices[face * 3 + 2]!]);
  const vertexIds = [...new Set(corners)].sort((a, b) => a - b);
  if (vertexIds.length !== recipe.selection.vertexCount || idListSha256(vertexIds) !== recipe.selection.vertexIdsSha256)
    throw Error("The exported head's triangles differ from the audited eye plate selection.");
  const compact = new Map(vertexIds.map((id, index) => [id, index]));
  return { vertexIds, faces: Uint32Array.from(corners, id => compact.get(id)!) };
}

function subsetRows<T extends AccessorArray>(data: T, width: number, rows: readonly number[]): T {
  const out = new (data.constructor as new (length: number) => T)(rows.length * width);
  rows.forEach((row, index) => { for (let k = 0; k < width; k++) out[index * width + k] = data[row * width + k]!; });
  return out;
}
const widthOf = (type: string) => ({ VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[type] ?? 1;

function subsetPrimitive(source: Primitive, vertexIds: readonly number[], faces: Uint32Array): Primitive {
  const attributes: Attributes = new Map();
  for (const [name, value] of source.attributes)
    attributes.set(name, { ...value, data: subsetRows(value.data, widthOf(value.type), vertexIds) });
  const targets = source.targets.map(target => new Map([...target].map(([name, data]) => [name, subsetRows(data, 3, vertexIds)] as const)));
  return { attributes, indices: faces, targets };
}

function writePrimitive(writer: GlbWriter, primitive: Primitive, material: number): GltfJson {
  const attributes: Record<string, number> = {};
  for (const [name, value] of primitive.attributes)
    attributes[name] = writer.add(value.data, value.type as "VEC3", { normalized: value.normalized, target: 34962, bounds: name === "POSITION" });
  const vertexCount = primitive.attributes.get("POSITION")!.data.length / 3;
  const indices = writer.add(vertexCount <= 65535 ? Uint16Array.from(primitive.indices) : primitive.indices, "SCALAR", { target: 34963 });
  const out: GltfJson = { attributes, indices, material, mode: 4 };
  if (primitive.targets.length) out.targets = primitive.targets.map(target =>
    Object.fromEntries([...target].map(([name, data]) => [name, writer.addSparse(data, "VEC3")])));
  return out;
}

export type PreviewAssembly = { glb: Uint8Array; report: PreviewGlbReport };

/**
 * The eye component's morph targets for its surface chunk, from WolvenKit's export of the eye
 * `.morphtarget`. Its base vertices must be exactly the eye mesh's (the morph resource's
 * `baseMesh` is that mesh), and every target must pair with a head target by `(target, region)`.
 */
export function eyeMorphTargets(eyeMorphBytes: Uint8Array, eyeSurfaceMesh: string, eyes: Primitive, headTargetNames: readonly string[]) {
  const morph = parseGlb(eyeMorphBytes);
  const node = morph.json.nodes.find((entry: GltfJson) => entry.name === eyeSurfaceMesh && entry.mesh !== undefined);
  if (!node) throw Error(`The exported eye morph target has no ${eyeSurfaceMesh} surface.`);
  const mesh = morph.json.meshes[node.mesh];
  const source = readPrimitive(morph, only(mesh.primitives, "eye morph primitive"), ["POSITION"]);
  const names: string[] = mesh.extras?.targetNames ?? [];
  if (!source.targets.length || names.length !== source.targets.length || new Set(names).size !== names.length)
    throw Error("The exported eye morph target has no uniquely named morph targets.");
  const base = eyes.attributes.get("POSITION")!.data, morphBase = source.attributes.get("POSITION")?.data;
  if (!morphBase || morphBase.length !== base.length || morphBase.some((value, index) => value !== base[index]) ||
      source.indices.length !== eyes.indices.length || source.indices.some((value, index) => value !== eyes.indices[index]))
    throw Error("The eye morph target's base geometry is not the eye mesh.");
  const head = new Set(headTargetNames);
  for (const name of names) {
    if (!parseMorphTargetName(name)) throw Error(`The eye morph target ${name} has no region.`);
    if (!head.has(name)) throw Error(`The eye morph target ${name} has no matching head target.`);
  }
  for (const target of source.targets) if (!target.has("POSITION")) throw Error("An eye morph target has no position deltas.");
  return { targets: source.targets, names };
}

export function assemblePreviewGlb(headBytes: Uint8Array, eyeBytes: Uint8Array, plateRecipe: EyePlateRecipe, eyeSurfaceMesh: string,
  eyeMorphBytes: Uint8Array): PreviewAssembly {
  const head = parseGlb(headBytes), eye = parseGlb(eyeBytes);
  const headNodeIndex = head.json.nodes.findIndex((node: GltfJson) => node.mesh !== undefined);
  const headNode = head.json.nodes[headNodeIndex];
  if (headNodeIndex < 0 || head.json.nodes.filter((node: GltfJson) => node.mesh !== undefined).length !== 1 || headNode.skin === undefined)
    throw Error("The exported head must contain exactly one skinned mesh.");
  const skin = head.json.skins[headNode.skin];
  const headSource = readPrimitive(head, only(head.json.meshes[headNode.mesh].primitives, "head primitive"), HEAD_ATTRIBUTES);
  for (const name of REQUIRED_HEAD) if (!headSource.attributes.has(name)) throw Error(`The exported head has no ${name}.`);
  const targetNames: string[] = head.json.meshes[headNode.mesh].extras?.targetNames ?? [];
  if (!headSource.targets.length || targetNames.length !== headSource.targets.length || new Set(targetNames).size !== targetNames.length)
    throw Error("The exported head has no uniquely named facial morph targets.");
  if (headSource.targets.length !== plateRecipe.selection.morphTargetCount)
    throw Error("The exported head's morph target count differs from the audited eye plate recipe.");
  const selection = plateSelection(headSource.indices, plateRecipe);
  const plate = subsetPrimitive(headSource, selection.vertexIds, selection.faces);

  const eyeNode = eye.json.nodes.find((node: GltfJson) => node.name === eyeSurfaceMesh && node.mesh !== undefined);
  if (!eyeNode) throw Error(`The exported eye mesh has no ${eyeSurfaceMesh} surface.`);
  if (eyeNode.skin !== undefined && bindPoseDeviation(eye, eyeNode.skin) > 1e-4)
    throw Error("The exported eye's rest pose differs from its bind pose, so it cannot be placed statically.");
  const eyes = readPrimitive(eye, only(eye.json.meshes[eyeNode.mesh].primitives, "eye primitive"), EYE_ATTRIBUTES, false);
  for (const name of ["POSITION", "NORMAL", "TEXCOORD_0"]) if (!eyes.attributes.has(name)) throw Error(`The exported eye has no ${name}.`);
  const eyeMorphs = eyeMorphTargets(eyeMorphBytes, eyeSurfaceMesh, eyes, targetNames);
  eyes.targets = eyeMorphs.targets;

  // Keep every node that does not carry a mesh (the armature and its joints), in source order.
  const keep = head.json.nodes.map((node: GltfJson, index: number) => node.mesh === undefined ? index : -1).filter((index: number) => index >= 0);
  const remap = new Map<number, number>(keep.map((source: number, index: number) => [source, index]));
  const nodes: GltfJson[] = keep.map((source: number) => {
    const { mesh, skin: _skin, children, ...rest } = head.json.nodes[source];
    const kept = (children ?? []).filter((child: number) => remap.has(child)).map((child: number) => remap.get(child));
    return { ...rest, ...(kept.length ? { children: kept } : {}) };
  });
  const roots = (head.json.scenes?.[head.json.scene ?? 0]?.nodes ?? []).filter((index: number) => remap.has(index)).map((index: number) => remap.get(index)!);
  const writer = new GlbWriter();
  const inverseBind = skin.inverseBindMatrices === undefined ? undefined :
    writer.add(readAccessor(head, skin.inverseBindMatrices).array as Float32Array, "MAT4");
  const joints = skin.joints.map((joint: number) => {
    if (!remap.has(joint)) throw Error("A head joint is also a mesh node.");
    return remap.get(joint)!;
  });
  const headNodeOut = nodes.push({ name: "head", mesh: 0, skin: 0 }) - 1;
  const plateNodeOut = nodes.push({ name: "makeup_plate", mesh: 1, skin: 0 }) - 1;
  const eyesNodeOut = nodes.push({ name: "eyes", mesh: 2 }) - 1;
  const weights = Array(targetNames.length).fill(0);
  const json: GltfJson = {
    asset: { version: "2.0", generator: PREVIEW_GLB_GENERATOR },
    scene: 0,
    scenes: [{ name: "Scene", nodes: [...roots, headNodeOut, plateNodeOut, eyesNodeOut] }],
    nodes,
    skins: [{ name: "Armature", joints, ...(inverseBind === undefined ? {} : { inverseBindMatrices: inverseBind }) }],
    materials: ["head_preview", "makeup_plate_preview", "eyes_preview"].map(name => ({ name, pbrMetallicRoughness: { metallicFactor: 0 } })),
    meshes: [
      { name: "head", primitives: [writePrimitive(writer, headSource, 0)], weights, extras: { targetNames } },
      { name: "makeup_plate", primitives: [writePrimitive(writer, plate, 1)], weights, extras: { targetNames } },
      { name: "eyes", primitives: [writePrimitive(writer, eyes, 2)], weights: Array(eyeMorphs.names.length).fill(0),
        extras: { targetNames: eyeMorphs.names } },
    ],
  };
  const glb = writer.toGlb(json);
  return { glb, report: verifyPreviewGlb(glb, plateRecipe) };
}

const finite = (data: ArrayLike<number>) => { for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i]!)) return false; return true; };

/**
 * Independent structural check of an assembled preview GLB. It re-reads the bytes and
 * re-derives the plate rows from the output head, so it also guards the writer.
 */
export function verifyPreviewGlb(bytes: Uint8Array, plateRecipe: EyePlateRecipe): PreviewGlbReport {
  const glb = parseGlb(bytes);
  const node = (name: string) => {
    const found = glb.json.nodes.filter((entry: GltfJson) => entry.name === name && entry.mesh !== undefined);
    if (found.length !== 1) throw Error(`Preview GLB needs exactly one ${name} mesh node.`);
    return found[0];
  };
  const headNode = node("head"), plateNode = node("makeup_plate"), eyesNode = node("eyes");
  if (headNode.skin !== 0 || plateNode.skin !== 0 || eyesNode.skin !== undefined || glb.json.skins?.length !== 1)
    throw Error("Preview GLB skinning layout is wrong.");
  const jointCount = glb.json.skins[0].joints.length;
  const read = (meshNode: GltfJson, names: readonly string[], targets: boolean) =>
    readPrimitive(glb, only(glb.json.meshes[meshNode.mesh].primitives, "primitive"), names, targets);
  const headMesh = read(headNode, HEAD_ATTRIBUTES, true), plateMesh = read(plateNode, HEAD_ATTRIBUTES, true), eyeMesh = read(eyesNode, EYE_ATTRIBUTES, true);
  const names = glb.json.meshes[headNode.mesh].extras?.targetNames;
  if (!Array.isArray(names) || names.length !== headMesh.targets.length || names.length !== plateRecipe.selection.morphTargetCount ||
      JSON.stringify(glb.json.meshes[plateNode.mesh].extras?.targetNames) !== JSON.stringify(names) || plateMesh.targets.length !== names.length)
    throw Error("Preview GLB morph targets are incomplete.");
  // The eyes follow the head's eye-shape choice: each eye target must name a head target.
  const eyeNames = glb.json.meshes[eyesNode.mesh].extras?.targetNames;
  if (!Array.isArray(eyeNames) || !eyeNames.length || eyeNames.length !== eyeMesh.targets.length || new Set(eyeNames).size !== eyeNames.length ||
      eyeNames.some((name: string) => !parseMorphTargetName(name) || !names.includes(name)))
    throw Error("Preview GLB eye morph targets do not pair with the head.");
  const check = (label: string, primitive: Primitive, skinned: boolean) => {
    const position = primitive.attributes.get("POSITION")!.data, vertices = position.length / 3;
    if (!finite(position) || !finite(primitive.attributes.get("NORMAL")!.data) || !finite(primitive.attributes.get("TEXCOORD_0")!.data))
      throw Error(`${label} has non-finite vertex data.`);
    if (!primitive.indices.length || primitive.indices.length % 3 || primitive.indices.some(index => index >= vertices))
      throw Error(`${label} has invalid triangles.`);
    for (const target of primitive.targets) for (const data of target.values()) if (data.length !== vertices * 3 || !finite(data))
      throw Error(`${label} has an invalid morph target.`);
    if (!skinned) return { vertices, sets: 0 };
    const sets = primitive.attributes.has("JOINTS_1") && primitive.attributes.has("WEIGHTS_1") ? 2 : 1;
    const joints = [primitive.attributes.get("JOINTS_0")!.data, sets > 1 ? primitive.attributes.get("JOINTS_1")!.data : null];
    const weights = [floats(primitive.attributes.get("WEIGHTS_0")!), sets > 1 ? floats(primitive.attributes.get("WEIGHTS_1")!) : null];
    for (let vertex = 0; vertex < vertices; vertex++) {
      let sum = 0;
      for (let set = 0; set < sets; set++) for (let k = 0; k < 4; k++) {
        const weight = weights[set]![vertex * 4 + k]!;
        if (weight < 0 || !Number.isFinite(weight) || (weight > 0 && joints[set]![vertex * 4 + k]! >= jointCount))
          throw Error(`${label} has an invalid skin influence.`);
        sum += weight;
      }
      if (Math.abs(sum - 1) > 1e-3) throw Error(`${label} has unnormalized skin weights.`);
    }
    return { vertices, sets };
  };
  const headInfo = check("Head", headMesh, true), plateInfo = check("Eye plate", plateMesh, true), eyeInfo = check("Eyes", eyeMesh, false);
  const selection = plateSelection(headMesh.indices, plateRecipe);
  if (plateInfo.vertices !== selection.vertexIds.length || plateMesh.indices.length !== selection.faces.length ||
      plateMesh.indices.some((index, position) => index !== selection.faces[position]))
    throw Error("Eye plate triangles differ from the head selection.");
  const headPosition = headMesh.attributes.get("POSITION")!.data, platePosition = plateMesh.attributes.get("POSITION")!.data;
  selection.vertexIds.forEach((row, index) => {
    for (let k = 0; k < 3; k++) if (platePosition[index * 3 + k] !== headPosition[row * 3 + k]) throw Error("Eye plate rows are not the head's rows.");
  });
  // The eyeballs must sit inside the head's bounds (a gross placement check, not a clearance test).
  const bounds = (data: AccessorArray) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i++) { min[i % 3] = Math.min(min[i % 3]!, data[i]!); max[i % 3] = Math.max(max[i % 3]!, data[i]!); }
    return { min, max };
  };
  const headBounds = bounds(headPosition), eyeBounds = bounds(eyeMesh.attributes.get("POSITION")!.data);
  if ([0, 1, 2].some(k => eyeBounds.min[k]! < headBounds.min[k]! || eyeBounds.max[k]! > headBounds.max[k]!))
    throw Error("The eyes are not inside the head.");
  const uv = eyeMesh.attributes.get("TEXCOORD_0")!.data;
  const uvMin: [number, number] = [Infinity, Infinity], uvMax: [number, number] = [-Infinity, -Infinity];
  for (let i = 0; i < uv.length; i++) { uvMin[i % 2] = Math.min(uvMin[i % 2]!, uv[i]!); uvMax[i % 2] = Math.max(uvMax[i % 2]!, uv[i]!); }
  return {
    head: { vertices: headInfo.vertices, triangles: headMesh.indices.length / 3, joints: jointCount, morphTargets: headMesh.targets.length, influenceSets: headInfo.sets },
    plate: { vertices: plateInfo.vertices, triangles: plateMesh.indices.length / 3, morphTargets: plateMesh.targets.length },
    eyes: { vertices: eyeInfo.vertices, triangles: eyeMesh.indices.length / 3, uv0Min: uvMin, uv0Max: uvMax, morphTargets: eyeMesh.targets.length },
  };
}
