import { clamp, dot, magnitude, sub, type Vec3 } from "./types";
import { contactDistance, type DistanceGrid } from "./contact";
import type { Volumes, VolumeFrame, volumeMesh } from "./volumes";
import type { CardMesh } from "./cards";

/** A deterministic groom-depth approximation; the index and scratch buffers never cross the worker boundary. */
export function groomOcclusion(source: Volumes, grid?: DistanceGrid): (point: Vec3) => number {
  const cell = .03, bins = new Map<string, { frame: VolumeFrame; clump: number; radii: Vec3 }[]>(), depth = new Float32Array(source.volumes.length);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  source.volumes.forEach((volume, clump) => volume.frames.forEach((frame, ring) => {
    const a = volume.frames[Math.max(0, ring - 1)].centre, b = volume.frames[Math.min(volume.frames.length - 1, ring + 1)].centre;
    const radii: Vec3 = [Math.max(.003, frame.radii[0]), Math.max(.003, frame.radii[1]), Math.max(.004, magnitude(sub(b, a)) * .6)];
    const extent = frame.centre.map((_, k) => Math.abs(frame.width[k]) * radii[0] + Math.abs(frame.normal[k]) * radii[1] + Math.abs(frame.tangent[k]) * radii[2]);
    const lo = frame.centre.map((v, k) => Math.floor((v - extent[k]) / cell)), hi = frame.centre.map((v, k) => Math.floor((v + extent[k]) / cell));
    const entry = { frame, clump, radii };
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) { const id = key(x, y, z), row = bins.get(id); if (row) row.push(entry); else bins.set(id, [entry]); }
  }));
  return point => {
    depth.fill(0);
    for (const { frame, clump, radii } of bins.get(key(Math.floor(point[0] / cell), Math.floor(point[1] / cell), Math.floor(point[2] / cell))) ?? []) {
      const delta = sub(point, frame.centre), x = dot(delta, frame.width) / radii[0], y = dot(delta, frame.normal) / radii[1], z = dot(delta, frame.tangent) / radii[2], squared = x * x + y * y + z * z;
      if (squared < 1) depth[clump] = Math.max(depth[clump], 1 - Math.sqrt(squared));
    }
    let buried = 0; for (const value of depth) buried += value;
    const skin = grid ? clamp((.007 - contactDistance(grid, point)) / .007) * .25 : 0;
    return clamp(1 - Math.exp(-1.2 * buried - skin));
  };
}
export function bakeOcclusion(source: Volumes, mesh: ReturnType<typeof volumeMesh>, cards: CardMesh, grid?: DistanceGrid) {
  const field = groomOcclusion(source, grid), colours = [...mesh.colours], occlusion: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const shade = 1 - .7 * field(mesh.positions.slice(i, i + 3) as Vec3);
    for (let k = 0; k < 3; k++) colours[i + k] *= shade;
  }
  let sum = 0, maximum = 0;
  for (let i = 0; i < cards.positions.length; i += 3) { const value = field(cards.positions.slice(i, i + 3) as Vec3); occlusion.push(value); sum += value; maximum = Math.max(maximum, value); }
  return { volumeGeometry: { ...mesh, colours }, cards: { ...cards, occlusion }, statistics: { mean: sum / (occlusion.length || 1), maximum, vertices: occlusion.length, shadowStrength: .65 } };
}
