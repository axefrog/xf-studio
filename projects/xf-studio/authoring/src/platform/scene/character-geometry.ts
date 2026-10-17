import { encodeScalarBytes } from "../api/scalar-image";
/** On-demand geometry source. No animation pose is baked into the static attachment/contact data. */
import * as THREE from "three";
import type { CharacterGeometry, ResolvedSurface } from "../api/scene";

export function characterGeometry(head: THREE.SkinnedMesh, hair: readonly ResolvedSurface[], body: readonly ResolvedSurface[]): CharacterGeometry {
  const position = head.geometry.getAttribute("position"), indices = head.geometry.index;
  if (!position || !indices) throw Error("The head has no indexed surface.");
  const point = new THREE.Vector3(), positions: number[] = [], uv: number[] = [], tex = head.geometry.getAttribute("uv");
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < position.count; i++) {
    THREE.Mesh.prototype.getVertexPosition.call(head, i, point); // Morph shape, never current joint motion.
    positions.push(point.x, point.y, point.z); min.min(point); max.max(point);
    uv.push(tex?.getX(i) ?? 0, tex?.getY(i) ?? 0);
  }
  let hash = 2166136261;
  for (let i = 0; i < indices.count; i++) hash = Math.imul(hash ^ indices.getX(i), 16777619);
  const topology = `${position.count}:${indices.count}:${hash >>> 0}`;
  const shape = (head.morphTargetInfluences ?? []).map(v => Math.round(v * 1e5)).join(",");
  const capSurface = hair.find(item => /mesh_decal_gradientmap_recolor\.mt$/i.test(item.template));
  let cap: CharacterGeometry["cap"];
  if (capSurface) {
    const mesh = capSurface.mesh, attr = mesh.geometry.getAttribute("position"), capUv = mesh.geometry.getAttribute("uv"), transform = head.bindMatrix.clone().invert().multiply(mesh.bindMatrix);
    cap = { source: capSurface.resource, points: [], indices: mesh.geometry.index ? Array.from(mesh.geometry.index.array) : [], uv: [] };
    for (let i = 0; i < attr.count; i++) { THREE.Mesh.prototype.getVertexPosition.call(mesh, i, point); point.applyMatrix4(transform); cap.points.push(point.x, point.y, point.z); cap.uv!.push(capUv?.getX(i) ?? 0, capUv?.getY(i) ?? 0); }
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (material instanceof THREE.MeshStandardMaterial && material.alphaMap?.image) {
      const image = material.alphaMap.image as HTMLImageElement, canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) { context.drawImage(image, 0, 0); const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const values = new Uint8Array(canvas.width * canvas.height); for (let i = 0; i < values.length; i++) values[i] = rgba[i * 4];
        cap.mask = { width: canvas.width, height: canvas.height, values: encodeScalarBytes(values) }; }
    }
  }
  const capsules: CharacterGeometry["capsules"] = [];
  const bodySurface = { positions: [] as number[], indices: [] as number[] };
  if (body.length) {
    const size = max.clone().sub(min), centre = max.clone().add(min).multiplyScalar(.5), shoulderY = min.y - size.y * .20;
    const slices = Array.from({ length: 6 }, (_, i) => ({ y: shoulderY + .035 - i * .08, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, count: 0 }));
    // Conservative fit to the actual body's bind-pose shoulder band, not clothing.
    let left = centre.x, right = centre.x, sumZ = 0, count = 0;
    for (const { mesh, template } of body) {
      const attr = mesh.geometry.getAttribute("position"), transform = head.bindMatrix.clone().invert().multiply(mesh.bindMatrix);
      const offset = bodySurface.positions.length / 3, collisionSkin = /(?:^|[\\/])skin\.mt$/i.test(template);
      for (let i = 0; i < attr.count; i++) {
        THREE.Mesh.prototype.getVertexPosition.call(mesh, i, point); point.applyMatrix4(transform);
        if (collisionSkin) bodySurface.positions.push(point.x, point.y, point.z);
        if (Math.abs(point.x - centre.x) < size.x * 1.05) for (const slice of slices) if (Math.abs(point.y - slice.y) < .035) {
          slice.minX = Math.min(slice.minX, point.x); slice.maxX = Math.max(slice.maxX, point.x);
          if (Math.abs(point.x - centre.x) < size.x * .50) { slice.minZ = Math.min(slice.minZ, point.z); slice.maxZ = Math.max(slice.maxZ, point.z); slice.count++; }
        }
        if (Math.abs(point.y - shoulderY) < size.y * .16 && Math.abs(point.x - centre.x) < size.x * 1.5) { left = Math.min(left, point.x); right = Math.max(right, point.x); sumZ += point.z; count++; }
      }
      if (collisionSkin && mesh.geometry.index) {
        const tris = mesh.geometry.index;
        for (let t = 0; t < tris.count; t += 3) {
          const ids = [tris.getX(t), tris.getX(t + 1), tris.getX(t + 2)].map(i => i + offset);
          const y = ids.reduce((sum, i) => sum + bodySurface.positions[i * 3 + 1], 0) / 3;
          const x = ids.reduce((sum, i) => sum + bodySurface.positions[i * 3], 0) / 3;
          if (y > min.y - .85 && y < max.y && Math.abs(x - centre.x) < .35) bodySurface.indices.push(...ids);
        }
      }
    }
    if (count) capsules.push({ a: [left + .035, shoulderY - .025, sumZ / count], b: [right - .035, shoulderY - .025, sumZ / count], radius: .045 });
    // Elliptical spine capsules fit each actual trunk band. They cover the chest and upper back,
    // which a horizontal shoulder capsule cannot see. No clothing is treated as body contact.
    for (let i = 0; i < slices.length - 1; i++) {
      const a = slices[i], b = slices[i + 1]; if (a.count < 8 || b.count < 8) continue;
      const rx = Math.max((a.maxX - a.minX) / 2, (b.maxX - b.minX) / 2), rz = Math.max((a.maxZ - a.minZ) / 2, (b.maxZ - b.minZ) / 2);
      capsules.push({ a: [(a.minX + a.maxX) / 2, a.y, (a.minZ + a.maxZ) / 2], b: [(b.minX + b.maxX) / 2, b.y, (b.minZ + b.maxZ) / 2], radius: 1,
        radii: [Math.min(.23, Math.max(.08, rx)) + .003, .025, Math.min(.20, Math.max(.05, rz)) + .003] });
    }
  }
  let bodyHash = 2166136261;
  for (const value of bodySurface.positions) bodyHash = Math.imul(bodyHash ^ Math.round(value * 1e6), 16777619);
  for (const value of bodySurface.indices) bodyHash = Math.imul(bodyHash ^ value, 16777619);
  return { resource: `core-head:${head.name || "head"}:${topology}`, topology, revision: `${topology}:${shape}:body-${bodyHash >>> 0}:${capsules.map(c => [...c.a, ...c.b, c.radius, ...(c.radii ?? [])].join(",")).join(";")}`, positions,
    indices: Array.from(indices.array), uv, down: [0, -1, 0], front: [0, 0, -1], capsules, ...(cap ? { cap } : {}), ...(bodySurface.indices.length ? { body: bodySurface } : {}) };
}
