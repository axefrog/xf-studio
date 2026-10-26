import type { WorldIndex } from '../sim/index-types.ts';
import type { Box, Vec3 } from './schema.ts';

export interface PlaceLayout { districts: ReadonlyMap<string, string>; cells: ReadonlyMap<string, Box> }
export interface Area { id: string; poly: [number, number][]; zlo: number; zhi: number }
const kabukiDistricts: Record<string, string> = { wat_kab: 'Districts.Kabuki', wat_nor: 'Districts.Northside', wat_lch: 'Districts.LittleChina' };

/** Pure fixture adapter, not engine geography. Only ids and deterministic bounds
 * calculations are retained; the producer never copies a world pack into source.
 */
export function schematicLayout(index: WorldIndex, areas: readonly Area[]): PlaceLayout {
  const districts = new Map<string, string>(), cells = new Map<string, Box>();
  for (const d of Object.values(index.districts)) {
    const id = kabukiDistricts[d.key];
    if (!id) throw Error(`No declared world-pack district mapping for fixture ${d.key}`);
    const area = areas.find((a) => a.id === id);
    if (!area || area.poly.length < 3 || !Number.isFinite(area.zlo) || !Number.isFinite(area.zhi) || area.zhi < area.zlo ||
      area.poly.some((p) => p.length !== 2 || !p.every(Number.isFinite))) throw Error(`World pack has no valid bounds for ${id}`);
    districts.set(d.id, id);
    const lo: Vec3 = [Math.min(...area.poly.map((p) => p[0])), Math.min(...area.poly.map((p) => p[1])), area.zlo];
    const hi: Vec3 = [Math.max(...area.poly.map((p) => p[0])), Math.max(...area.poly.map((p) => p[1])), area.zhi];
    if (lo[0] >= hi[0] || lo[1] >= hi[1]) throw Error(`World pack has empty bounds for ${id}`);
    const ids = [...d.cellIds].sort(), cols = Math.ceil(Math.sqrt(ids.length)), rows = Math.ceil(ids.length / cols);
    const dx = (hi[0] - lo[0]) / cols, dy = (hi[1] - lo[1]) / rows;
    ids.forEach((cell, i) => {
      const x = i % cols, y = Math.floor(i / cols);
      // A shallow schematic slab, wholly within the real vertical bounds. It
      // represents no measured floor/roof or navigable surface.
      const z = lo[2] + (hi[2] - lo[2]) * 0.1;
      cells.set(cell, { box: { min: [lo[0] + x * dx, lo[1] + y * dy, z], max: [lo[0] + (x + 1) * dx, lo[1] + (y + 1) * dy, Math.min(hi[2], z + 1)] } });
    });
  }
  return { districts, cells };
}
export const boxCentre = (a: Box): Vec3 => a.box.min.map((n, i) => (n + a.box.max[i]) / 2) as Vec3;
