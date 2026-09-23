import * as THREE from "three";
// Three's stock shader and raycaster use four influences. The source has eight
// bone influences plus two non-bone selection groups, which are not skin weights.
// Keep all exported sets for rendering, normals and surface picking.
export function restoreFirstWeights(
  buffer: ArrayBuffer,
): Map<string, Float32Array> {
  const view = new DataView(buffer),
    length = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, length)),
  );
  const start = 20 + length + 8,
    weights = new Map<string, Float32Array>();
  for (const mesh of json.meshes) {
    const index = mesh.primitives[0].attributes.WEIGHTS_0;
    if (index === undefined) continue;
    const a = json.accessors[index],
      b = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || a.type !== "VEC4")
      throw Error("Unexpected skin weight encoding");
    const out = new Float32Array(a.count * 4),
      offset = start + (b.byteOffset ?? 0) + (a.byteOffset ?? 0),
      stride = b.byteStride ?? 16;
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < 4; k++)
        out[i * 4 + k] = view.getFloat32(offset + i * stride + k * 4, true);
    weights.set(mesh.name, out);
  }
  return weights;
}
export function skinSets(g: THREE.BufferGeometry) {
  const sets = [{ j: "skinIndex", w: "skinWeight" }];
  for (let n = 1; g.hasAttribute(`joints_${n}`); n++)
    sets.push({ j: `joints_${n}`, w: `weights_${n}` });
  return sets;
}
export function extendSkin(
  mesh: THREE.SkinnedMesh,
  material: THREE.MeshStandardMaterial,
  offset = 0,
) {
  const sets = skinSets(mesh.geometry);
  let sum = "mat4 fullSkin = mat4(0.0);\n";
  for (const { j, w } of sets)
    for (const c of ["x", "y", "z", "w"])
      sum += `fullSkin += getBoneMatrix(${j}.${c}) * ${w}.${c};\n`;
  const declarations = sets
    .slice(1)
    .map((s) => `attribute vec4 ${s.j}; attribute vec4 ${s.w};`)
    .join("\n");
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${declarations}`)
      .replace(
        "#include <skinbase_vertex>",
        `#ifdef USE_SKINNING\n${sum}\n#endif`,
      )
      .replace(
        "#include <skinnormal_vertex>",
        `#ifdef USE_SKINNING\nmat4 fullNormal = bindMatrixInverse * fullSkin * bindMatrix;\nobjectNormal = (fullNormal * vec4(objectNormal,0.0)).xyz;\n#ifdef USE_TANGENT\nobjectTangent = (fullNormal * vec4(objectTangent,0.0)).xyz;\n#endif\n#endif`,
      )
      .replace(
        "#include <skinning_vertex>",
        `#ifdef USE_SKINNING\ntransformed = (bindMatrixInverse * fullSkin * bindMatrix * vec4(transformed,1.0)).xyz;\n#endif\ntransformed += normalize(objectNormal) * ${offset.toFixed(7)};`,
      );
  };
  material.customProgramCacheKey = () => `full-skin-${sets.length}-${offset}`;
  const base = new THREE.Vector4(),
    point = new THREE.Vector4(),
    result = new THREE.Vector4(),
    matrix = new THREE.Matrix4();
  function apply(index: number, target: THREE.Vector3): THREE.Vector3;
  function apply(index: number, target: THREE.Vector4): THREE.Vector4;
  function apply(
    index: number,
    target: THREE.Vector3 | THREE.Vector4,
  ): THREE.Vector3 | THREE.Vector4;
  function apply(index: number, target: THREE.Vector3 | THREE.Vector4) {
    base
      .set(
        target.x,
        target.y,
        target.z,
        target instanceof THREE.Vector4 ? target.w : 1,
      )
      .applyMatrix4(mesh.bindMatrix);
    result.set(0, 0, 0, 0);
    for (const s of sets) {
      const joint = mesh.geometry.getAttribute(s.j),
        weight = mesh.geometry.getAttribute(s.w);
      for (let k = 0; k < 4; k++) {
        const w = weight.getComponent(index, k);
        if (!w) continue;
        const j = joint.getComponent(index, k);
        matrix.multiplyMatrices(
          mesh.skeleton.bones[j].matrixWorld,
          mesh.skeleton.boneInverses[j],
        );
        result.addScaledVector(point.copy(base).applyMatrix4(matrix), w);
      }
    }
    result.applyMatrix4(mesh.bindMatrixInverse);
    if (target instanceof THREE.Vector4) return target.copy(result);
    return target.set(result.x, result.y, result.z);
  }
  mesh.applyBoneTransform = apply;
}
