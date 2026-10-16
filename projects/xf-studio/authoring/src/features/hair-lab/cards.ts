/** Artist decisions as pure data: layered coverage, atlas density and stable transported ribbon frames. */
import { add, clamp, cross, dot, lerp, magnitude, mul, normalise, randomAt, smooth, sub, type Paths, type Vec3 } from "./types";
export type AtlasRegion = { u0: number; u1: number; v0: number; v1: number; density: number };
export type CardMesh = { positions: number[]; uv: number[]; indices: number[]; rootTip: number[]; ids: number[];
  cards: { id: string; layer: "inner" | "middle" | "outer" | "flyaway"; root: string; start: number; count: number }[] };
export function atlasRegions(alpha: Uint8Array, width: number, height: number): AtlasRegion[] {
  const columns = new Float64Array(width);
  for (let x = 0; x < width; x++) for (let y = Math.floor(height * .15); y < height * .8; y++) columns[x] += alpha[y * width + x] / 255 / (height * .65);
  const regions: AtlasRegion[] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    if (x < width && columns[x] > .025) { if (start < 0) start = x; }
    else if (start >= 0) {
      if (x - start >= 2) {
        let total = 0; for (let k = start; k < x; k++) total += columns[k];
        regions.push({ u0: Math.max(0, (start - .5) / width), u1: Math.min(1, (x + .5) / width), v0: 0, v1: 1, density: total / (x - start) });
      }
      start = -1;
    }
  }
  // Some atlases have connected soft alpha across strips. Fixed-width candidates are then ranked by measured density.
  if (regions.length < 3) {
    regions.length = 0;
    for (let i = 0; i < 8; i++) {
      let sum = 0; for (let x = Math.floor(i * width / 8); x < (i + 1) * width / 8; x++) sum += columns[x];
      regions.push({ u0: i / 8, u1: (i + 1) / 8, v0: 0, v1: 1, density: sum / (width / 8) });
    }
  }
  return regions.sort((a, b) => b.density - a.density || a.u0 - b.u0);
}
const LAYERS = [
  { name: "inner", width: .026, offset: .0007, every: 1, twist: .2, density: 0 },
  { name: "middle", width: .019, offset: .003, every: 2, twist: .6, density: .35 },
  { name: "outer", width: .012, offset: .006, every: 3, twist: 1, density: .7 },
  { name: "flyaway", width: .003, offset: .009, every: 12, twist: 1.3, density: .9 },
] as const;
export function generateCards(paths: Paths, regions: readonly AtlasRegion[]): CardMesh {
  if (!regions.length) throw Error("The strand atlas has no usable regions.");
  const out: CardMesh = { positions: [], uv: [], indices: [], rootTip: [], ids: [], cards: [] };
  for (const layer of LAYERS) for (const path of paths.paths) {
    if (path.root.index % layer.every) continue;
    const variation = randomAt(17, path.root.index), regionIndex = clamp(Math.floor(layer.density * (regions.length - 1) + variation * 2), 0, regions.length - 1), region = regions[regionIndex];
    const start = out.positions.length / 3, points: Vec3[] = [];
    // Subdivide bends for sheet continuity; the solver's samples remain the authority.
    for (let j = 0; j < path.points.length - 1; j++) {
      points.push(path.points[j]);
      points.push(lerp(path.points[j], path.points[j + 1], .5));
    }
    points.push(path.points.at(-1)!);
    let widthFrame: Vec3 = normalise(cross(sub(points[1], points[0]), path.root.normal));
    if (magnitude(widthFrame) < .1) widthFrame = [1, 0, 0];
    const total = points.slice(1).reduce((sum, p, i) => sum + magnitude(sub(p, points[i])), 0);
    let distance = 0;
    for (let j = 0; j < points.length; j++) {
      if (j) distance += magnitude(sub(points[j], points[j - 1]));
      const t = distance / (total || 1), tangent = normalise(sub(points[Math.min(points.length - 1, j + 1)], points[Math.max(0, j - 1)]));
      let projected = sub(widthFrame, mul(tangent, dot(widthFrame, tangent)));
      if (magnitude(projected) < .01) projected = cross(tangent, [0, 0, 1]);
      projected = normalise(projected); if (dot(projected, widthFrame) < 0) projected = mul(projected, -1); widthFrame = projected;
      const normal = normalise(cross(widthFrame, tangent)), angle = (variation - .5) * layer.twist + Math.sin(t * 2 + path.root.uv[0] * 9) * .1;
      const widthDirection = add(mul(widthFrame, Math.cos(angle)), mul(normal, Math.sin(angle)));
      const offset = layer.offset * smooth(0, .15, t), centre = add(points[j], mul(normal, offset));
      const width = layer.width * (.8 + variation * .4) * (1 - .65 * smooth(.65, 1, t));
      for (let side = 0; side < 2; side++) {
        const vertex = add(centre, mul(widthDirection, width * (side - .5)));
        out.positions.push(...vertex); out.uv.push(side ? region.u1 : region.u0, region.v0 + t * (region.v1 - region.v0));
        out.rootTip.push(t); out.ids.push(variation);
      }
      if (j) { const a = start + (j - 1) * 2; out.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    out.cards.push({ id: `${path.root.id}:${layer.name}`, root: path.root.id, layer: layer.name, start, count: points.length * 2 });
  }
  return out;
}
