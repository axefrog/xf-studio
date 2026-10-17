/** Artist decisions as pure data: layered coverage, atlas density and stable transported ribbon frames. */
import { add, clamp, cross, dot, lerp, magnitude, mul, normalise, randomAt, smooth, sub, type Vec3 } from "./types";
import { memberPoint, type Volumes } from "./volumes";
import { contactAt, contactDistance, segmentContact, type DistanceGrid } from "./contact";
export type AtlasRegion = { u0: number; u1: number; v0: number; v1: number; density: number; rootAtV1?: boolean };
export type CardMesh = { positions: number[]; uv: number[]; indices: number[]; rootTip: number[]; ids: number[]; occlusion: number[];
  cards: { id: string; volume: string; layer: "inner" | "middle" | "outer" | "flyaway"; root: string; start: number; count: number; columns: number }[] };
export function atlasRegions(alpha: Uint8Array, width: number, height: number, gradient?: { width: number; height: number; values: Uint8Array }): AtlasRegion[] {
  const regions: AtlasRegion[] = [];
  const rows = Array.from({ length: height }, (_, y) => { let occupied = 0; for (let x = 2; x < width - 2; x++) if (alpha[y * width + x] > 32) occupied++; return occupied > Math.max(2, width * .004); });
  // Separate horizontal banks first. Crossing the gap would put a second tuft at a long card's tip.
  const bands: [number, number][] = []; let beginning = -1, gap = 0;
  for (let y = 0; y <= height; y++) {
    if (y < height && rows[y]) { if (beginning < 0) beginning = y; gap = 0; }
    else if (beginning >= 0 && (++gap >= 4 || y === height)) { const end = y - gap + 1; if (end - beginning >= height * .08) bands.push([Math.max(0, beginning - 1), Math.min(height, end + 1)]); beginning = -1; gap = 0; }
  }
  for (const [y0, y1] of bands) {
    const columns = new Float64Array(width);
    for (let x = 0; x < width; x++) for (let y = y0; y < y1; y++) columns[x] += alpha[y * width + x] / 255 / (y1 - y0);
    let start = -1;
    for (let x = 0; x <= width; x++) {
      if (x < width && columns[x] > .025) { if (start < 0) start = x; }
      else if (start >= 0) {
      if (x - start >= 2) {
        let total = 0; for (let k = start; k < x; k++) total += columns[k];
        const region: AtlasRegion = { u0: Math.max(0, (start - .5) / width), u1: Math.min(1, (x + .5) / width), v0: y0 / height, v1: y1 / height, density: total / (x - start) };
        if (gradient) { const mean = (v: number) => { let sum = 0; for (let k = start; k < x; k++) sum += gradient.values[Math.min(gradient.height - 1, Math.floor(v * gradient.height)) * gradient.width + Math.min(gradient.width - 1, Math.floor(k / width * gradient.width))]; return sum / (x - start); }; region.rootAtV1 = mean(region.v1 - .05 * (region.v1 - region.v0)) < mean(region.v0 + .05 * (region.v1 - region.v0)); }
        regions.push(region);
      }
      start = -1;
      }
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
export function generateCards(volumes: Volumes, regions: readonly AtlasRegion[] = [{ u0: 0, u1: 1, v0: 0, v1: 1, density: 1 }], grid?: DistanceGrid, edgePasses = 8): CardMesh {
  if (!regions.length) throw Error("The strand atlas has no usable regions.");
  const out: CardMesh = { positions: [], uv: [], indices: [], rootTip: [], ids: [], occlusion: [], cards: [] };
  for (const volume of volumes.volumes) for (const member of volume.members) {
    const originals = volume.frames.map((_, ring) => memberPoint(volume, member, ring));
    const gathered = (weight: number) => volume.frames.map((frame, ring) => lerp(originals[ring], frame.centre, weight * clamp(member.clumpRatio) * smooth(.08, .45, ring / (volume.frames.length - 1))));
    const clearGather = (weight: number) => !grid || gathered(weight).every((p, j) => segmentContact(grid, originals[j], p).distance >= .0005);
    let gather = 1;
    if (!clearGather(gather)) { let lo = 0, hi = 1; for (let pass = 0; pass < 7; pass++) { const mid = (lo + hi) / 2; if (clearGather(mid)) lo = mid; else hi = mid; } gather = lo; }
    const path = { root: member.root, points: gathered(gather) };
    for (const layer of LAYERS) {
    if (path.root.index % layer.every) continue;
    const variation = randomAt(17, path.root.index), regionIndex = clamp(Math.floor(layer.density * (regions.length - 1) + variation * 2), 0, regions.length - 1), region = regions[regionIndex];
    const start = out.positions.length / 3, points = path.points, columns = 3;
    let widthFrame: Vec3 = normalise(cross(sub(points[1], points[0]), path.root.normal));
    if (magnitude(widthFrame) < .1) widthFrame = [1, 0, 0];
    const total = points.slice(1).reduce((sum, p, i) => sum + magnitude(sub(p, points[i])), 0);
    let distance = 0;
    for (let j = 0; j < points.length; j++) {
      if (j) distance += magnitude(sub(points[j], points[j - 1]));
      const t = distance / (total || 1), rootTip = (member.startMetres + t * (member.endMetres - member.startMetres)) / member.intrinsicMetres, tangent = normalise(sub(points[Math.min(points.length - 1, j + 1)], points[Math.max(0, j - 1)]));
      let projected = sub(widthFrame, mul(tangent, dot(widthFrame, tangent)));
      if (magnitude(projected) < .01) projected = cross(tangent, [0, 0, 1]);
      projected = normalise(projected); if (dot(projected, widthFrame) < 0) projected = mul(projected, -1); widthFrame = projected;
      const normal = normalise(cross(widthFrame, tangent)), angle = (variation - .5) * layer.twist + Math.sin(t * 2 + path.root.uv[0] * 9) * .1;
      const widthDirection = add(mul(widthFrame, Math.cos(angle)), mul(normal, Math.sin(angle)));
      const headSupport = grid ? 1 - smooth(.015, .04, contactDistance(grid, points[j])) : 0;
      const crownLayer = member.layerThicknessMetres * ({ inner: .1, middle: .45, outer: .85, flyaway: 1 }[layer.name]) * headSupport * smooth(-.05, .35, path.root.normal[1]);
      const offset = (layer.offset + crownLayer) * smooth(0, .03, member.startMetres + t * (member.endMetres - member.startMetres)), centre = add(points[j], mul(normal, offset));
      const rootWidth = .12 + .88 * smooth(0, .025, member.startMetres + t * (member.endMetres - member.startMetres));
      const tipWidth = 1 - (member.cut ? .45 : .98) * smooth(member.cut ? .96 : .82, 1, t);
      const width = layer.width * (.8 + variation * .4) * rootWidth * tipWidth, cardNormal = normalise(cross(widthDirection, tangent));
      for (let side = 0; side < columns; side++) {
        const across = side / (columns - 1) - .5;
        let vertex = add(add(centre, mul(widthDirection, width * across)), mul(cardNormal, width * .18 * (1 - 4 * across * across)));
        if (grid) for (let pass = 0; pass < 4; pass++) { const distance = contactDistance(grid, vertex); if (distance >= .0015) break; const hit = contactAt(grid, vertex); vertex = add(vertex, mul(hit.normal, .0015 - distance)); }
        out.positions.push(...vertex); out.uv.push(region.u0 + side / (columns - 1) * (region.u1 - region.u0), region.v0 + rootTip * (region.v1 - region.v0));
        out.rootTip.push(rootTip); out.ids.push(variation);
      }
      if (j) for (let side = 0; side < columns - 1; side++) { const a = start + (j - 1) * columns + side; out.indices.push(a, a + 1, a + columns, a + 1, a + columns + 1, a + columns); }
    }
    out.cards.push({ id: `${volume.id}:${path.root.id}:${layer.name}`, volume: volume.id, root: path.root.id, layer: layer.name, start, count: points.length * columns, columns });
    }
  }
  let dirty: Set<number> | undefined;
  if (grid) for (let pass = 0; pass < edgePasses; pass++) {
    const changed = new Set<number>();
    cardEdges(out, (a, b) => {
    if (dirty && !dirty.has(a) && !dirty.has(b)) return;
    const pa = out.positions.slice(a * 3, a * 3 + 3) as Vec3, pb = out.positions.slice(b * 3, b * 3 + 3) as Vec3, hit = segmentContact(grid, pa, pb);
    if (hit.distance < .0008) { const delta = mul(hit.normal, .0009 - hit.distance); for (const at of [a, b]) { changed.add(at); for (let k = 0; k < 3; k++) out.positions[at * 3 + k] += delta[k]; } }
    });
    if (!changed.size) break; dirty = changed;
  }
  out.occlusion = Array(out.positions.length / 3).fill(0);
  return out;
}
/** Atlas choice is derived from native pixels; it never changes canonical card geometry. */
export function cardAtlasUV(mesh: CardMesh, regions: readonly AtlasRegion[], rootAtV1 = false): number[] {
  if (!regions.length) throw Error("The strand atlas has no usable regions.");
  const uv = [...mesh.uv];
  for (const card of mesh.cards) {
    const layer = LAYERS.find(l => l.name === card.layer)!, variation = mesh.ids[card.start], longest = Math.max(...regions.map(r => r.v1 - r.v0)), candidates = regions.filter(r => r.v1 - r.v0 >= longest * .8), region = candidates[clamp(Math.floor(layer.density * (candidates.length - 1) + variation * 2), 0, candidates.length - 1)];
    for (let j = card.start; j < card.start + card.count; j++) { uv[j * 2] = region.u0 + (j - card.start) % card.columns / (card.columns - 1) * (region.u1 - region.u0); uv[j * 2 + 1] = region.v0 + ((region.rootAtV1 ?? rootAtV1) ? 1 - mesh.rootTip[j] : mesh.rootTip[j]) * (region.v1 - region.v0); }
  }
  return uv;
}
export function cardContact(mesh: CardMesh, grid: DistanceGrid) {
  let minimum = Infinity;
  cardEdges(mesh, (a, b) => { minimum = Math.min(minimum, segmentContact(grid, mesh.positions.slice(a * 3, a * 3 + 3) as Vec3, mesh.positions.slice(b * 3, b * 3 + 3) as Vec3).distance); });
  return { minimumClearanceMetres: minimum, penetrationMetres: Math.max(0, .0005 - minimum) };
}
function cardEdges(mesh: CardMesh, visit: (a: number, b: number) => void) {
  for (const card of mesh.cards) for (let row = card.start; row < card.start + card.count; row += card.columns) for (let side = 0; side < card.columns; side++) {
    const at = row + side;
    if (side) visit(at - 1, at);
    if (row > card.start) { visit(at - card.columns, at); if (side) visit(at - 1, at - card.columns); }
  }
}
