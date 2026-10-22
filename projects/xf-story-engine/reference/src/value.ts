// Values and domains: the canonical encoding (spec 2.1), the grid, and enumeration of a region.
//
// A real or cyclic value is held as the grid point itself (min + i * quantum, or i * quantum), and
// hashed as the grid index. A vec is an array of grid points. This keeps predicates natural
// ("influence >= 0.6") while the hash sees exactly what the specification names.

import { i64Bytes, idToBytes, isId } from './id.ts';
import { boxRegion, contains, intersect, ivlRegion, setRegion } from './region.ts';
import type { ValueType } from './schema-types.ts';
import type { Region, Value } from './types.ts';

const textEncoder = new TextEncoder();
const GRID_EPS = 1e-9;

export function isStringType(vt: ValueType): boolean {
  return vt.t === 'enum' || vt.t === 'enum-by' || vt.t === 'text' || vt.t === 'ref' || vt.t === 'node';
}

/** The grid origin of a numeric value type (the value at index 0). */
function gridOrigin(vt: ValueType): number {
  return vt.t === 'real' ? vt.min : 0;
}

/** The grid step of a numeric value type (1 for int). */
export function gridStep(vt: ValueType): number {
  switch (vt.t) {
    case 'int':
      return 1;
    case 'real':
    case 'cyclic':
    case 'vec':
      return vt.quantum;
    default:
      throw new Error(`value type ${vt.t} has no grid`);
  }
}

function roundIdx(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) < GRID_EPS ? r : x;
}

/** The grid index of a grid point. */
export function toGridIndex(vt: ValueType, x: number): number {
  if (vt.t === 'int') return x;
  return Math.round((x - gridOrigin(vt)) / gridStep(vt));
}

/** The grid point of a grid index. */
export function fromGridIndex(vt: ValueType, i: number): number {
  if (vt.t === 'int') return i;
  return gridOrigin(vt) + i * gridStep(vt);
}

function onGrid(vt: ValueType, x: number): boolean {
  if (typeof x !== 'number' || !Number.isFinite(x)) return false;
  if (vt.t === 'int') return Number.isInteger(x);
  const idx = (x - gridOrigin(vt)) / gridStep(vt);
  return Math.abs(idx - Math.round(idx)) < GRID_EPS;
}

/** The largest grid index of a bounded numeric type, and the smallest (0 except for int). */
function indexBounds(vt: ValueType): [number, number] {
  switch (vt.t) {
    case 'int':
      return [vt.min, vt.max];
    case 'real':
      return [0, Math.floor((vt.max - vt.min) / vt.quantum + GRID_EPS)];
    case 'cyclic':
      return [0, Math.round(vt.period / vt.quantum) - 1];
    default:
      throw new Error(`value type ${vt.t} is not a bounded numeric type`);
  }
}

/** Whether a value belongs to the type: the right shape, on the grid, inside the range. Null if so. */
export function checkValue(vt: ValueType, v: Value): string | null {
  switch (vt.t) {
    case 'enum':
      return typeof v === 'string' && vt.values.includes(v) ? null : `not one of the enum values: ${String(v)}`;
    case 'enum-by':
    case 'text':
      return typeof v === 'string' ? null : 'not a string';
    case 'ref':
    case 'node':
      return isId(v) ? null : 'not an Id';
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= vt.min && v <= vt.max ? null : `not an int in ${vt.min}..${vt.max}`;
    case 'real':
    case 'cyclic': {
      if (typeof v !== 'number' || !onGrid(vt, v)) return 'not on the grid';
      const [lo, hi] = indexBounds(vt);
      const idx = toGridIndex(vt, v);
      return idx >= lo && idx <= hi ? null : 'outside the range';
    }
    case 'vec':
      return Array.isArray(v) && v.length === vt.n && v.every((x) => onGrid(vt, x)) ? null : `not a ${vt.n}-vector on the grid`;
  }
}

/** The canonical encoding of a value (spec 2.1), without the trailing 0x00 that H adds. */
export function encodeValue(vt: ValueType, v: Value): Uint8Array {
  switch (vt.t) {
    case 'enum':
    case 'enum-by':
    case 'text':
      if (typeof v !== 'string') throw new Error(`expected a string for ${vt.t}`);
      return textEncoder.encode(v);
    case 'ref':
    case 'node':
      if (typeof v !== 'string') throw new Error(`expected an Id for ${vt.t}`);
      return idToBytes(v);
    case 'int':
      if (typeof v !== 'number') throw new Error('expected a number for int');
      return i64Bytes(v);
    case 'real':
    case 'cyclic':
      if (typeof v !== 'number') throw new Error(`expected a number for ${vt.t}`);
      return i64Bytes(toGridIndex(vt, v));
    case 'vec': {
      if (!Array.isArray(v)) throw new Error('expected an array for vec');
      const out = new Uint8Array(8 * v.length);
      v.forEach((x, d) => out.set(i64Bytes(toGridIndex(vt, x)), 8 * d));
      return out;
    }
  }
}

/** A stable string key for a value, for tables and maps. */
export function valueKey(v: Value): string {
  return Array.isArray(v) ? v.join(',') : String(v);
}

export function valuesEqual(a: Value, b: Value): boolean {
  return valueKey(a) === valueKey(b);
}

/** The region of every value a type allows. `list` is the chosen list of an enum-by domain. */
export function domainRegion(vt: ValueType, list?: string[]): Region {
  switch (vt.t) {
    case 'enum':
      return setRegion(vt.values);
    case 'enum-by':
      return setRegion(list ?? []);
    case 'int':
      return ivlRegion([[vt.min, vt.max]]);
    case 'real':
    case 'cyclic': {
      const [lo, hi] = indexBounds(vt);
      return ivlRegion([[fromGridIndex(vt, lo), fromGridIndex(vt, hi)]]);
    }
    case 'vec':
    case 'text':
    case 'ref':
    case 'node':
      return { r: 'all' };
  }
}

/** A region holding exactly one value. */
export function pointRegion(vt: ValueType, v: Value): Region {
  if (isStringType(vt)) return setRegion([v as string]);
  if (vt.t === 'vec') return boxRegion([(v as number[]).map((x): [number, number] => [x, x])]);
  return ivlRegion([[v as number, v as number]]);
}

/**
 * Snap a region onto the grid of a value type: interval ends move inward to grid points, and a cyclic
 * interval that wraps (lo > hi) becomes two intervals.
 */
export function normalizeRegion(vt: ValueType, r: Region): Region {
  if (r.r === 'all' || r.r === 'set') return r;
  if (r.r === 'ivl') {
    const step = gridStep(vt);
    const [minIdx, maxIdx] = indexBounds(vt);
    const maxV = fromGridIndex(vt, maxIdx);
    const minV = fromGridIndex(vt, minIdx);
    const snapped: Array<[number, number]> = [];
    const push = (lo: number, hi: number) => {
      const a = Math.ceil(roundIdx((lo - gridOrigin(vt)) / step));
      const b = Math.floor(roundIdx((hi - gridOrigin(vt)) / step));
      if (a <= b) snapped.push([fromGridIndex(vt, a), fromGridIndex(vt, b)]);
    };
    for (const [lo, hi] of r.ivls) {
      if (vt.t === 'cyclic' && lo > hi) {
        push(lo, maxV);
        push(minV, hi);
      } else push(lo, hi);
    }
    return ivlRegion(snapped);
  }
  const step = gridStep(vt);
  return boxRegion(
    r.boxes.map((bx) =>
      bx.map(([lo, hi]): [number, number] => [Math.ceil(roundIdx(lo / step)) * step, Math.floor(roundIdx(hi / step)) * step]),
    ),
  );
}

function ivlCount(vt: ValueType, [lo, hi]: [number, number]): number {
  return toGridIndex(vt, hi) - toGridIndex(vt, lo) + 1;
}

/** How many values a region holds (Infinity when unbounded). */
export function regionSize(vt: ValueType, r: Region): number {
  switch (r.r) {
    case 'all':
      return Infinity;
    case 'set':
      return r.values.length;
    case 'ivl':
      return r.ivls.reduce((n, iv) => n + ivlCount(vt, iv), 0);
    case 'box': {
      let total = 0;
      for (const bx of r.boxes) {
        let n = 1;
        for (const iv of bx) n *= ivlCount(vt, iv);
        total += n;
      }
      return total;
    }
  }
}

/** Enumerate the values of a bounded region in a canonical order (sorted). The caller checks the size first. */
export function enumerateRegion(vt: ValueType, r: Region): Value[] {
  switch (r.r) {
    case 'all':
      throw new Error('cannot enumerate an unbounded region');
    case 'set':
      return [...r.values];
    case 'ivl': {
      const out: number[] = [];
      for (const iv of r.ivls) {
        const a = toGridIndex(vt, iv[0]);
        const b = toGridIndex(vt, iv[1]);
        for (let idx = a; idx <= b; idx++) out.push(fromGridIndex(vt, idx));
      }
      return out;
    }
    case 'box': {
      const out: number[][] = [];
      for (const bx of r.boxes) {
        let cells: number[][] = [[]];
        for (const iv of bx) {
          const a = toGridIndex(vt, iv[0]);
          const b = toGridIndex(vt, iv[1]);
          const next: number[][] = [];
          for (const prefix of cells) for (let idx = a; idx <= b; idx++) next.push([...prefix, fromGridIndex(vt, idx)]);
          cells = next;
        }
        out.push(...cells);
      }
      return out;
    }
  }
}

/** Intersect, for callers that hold a type and want a snapped result. */
export function intersectIn(vt: ValueType, a: Region, b: Region): Region {
  return normalizeRegion(vt, intersect(a, b));
}

export function regionHas(r: Region, v: Value): boolean {
  return contains(r, v);
}
