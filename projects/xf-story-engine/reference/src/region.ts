// Regions (spec 3.2): intersection, emptiness and membership. Pure functions over plain data.
// Intervals and boxes are closed and already snapped to the grid by the caller (value.ts does the
// snapping), so intersecting two regions never leaves a gap that holds no grid point.

import { canonicalEqual } from './canon.ts';
import type { Region, Value } from './types.ts';

export const ALL: Region = { r: 'all' };

export function setRegion(values: Iterable<string>): Region {
  return { r: 'set', values: [...new Set(values)].sort(cmpStr) };
}

export function ivlRegion(ivls: Array<[number, number]>): Region {
  const sorted = ivls.filter(([lo, hi]) => lo <= hi).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return { r: 'ivl', ivls: merged };
}

export function boxRegion(boxes: Array<Array<[number, number]>>): Region {
  return { r: 'box', boxes: boxes.filter((bx) => bx.every(([lo, hi]) => lo <= hi)) };
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isEmpty(r: Region): boolean {
  switch (r.r) {
    case 'all':
      return false;
    case 'set':
      return r.values.length === 0;
    case 'ivl':
      return r.ivls.length === 0;
    case 'box':
      return r.boxes.length === 0;
  }
}

export function contains(r: Region, v: Value): boolean {
  switch (r.r) {
    case 'all':
      return true;
    case 'set':
      return typeof v === 'string' && r.values.includes(v);
    case 'ivl':
      return typeof v === 'number' && r.ivls.some(([lo, hi]) => v >= lo && v <= hi);
    case 'box':
      return (
        Array.isArray(v) &&
        r.boxes.some((bx) => bx.length === v.length && bx.every(([lo, hi], d) => v[d]! >= lo && v[d]! <= hi))
      );
  }
}

export function intersect(a: Region, b: Region): Region {
  if (a.r === 'all') return b;
  if (b.r === 'all') return a;
  if (a.r === 'set' && b.r === 'set') {
    const inB = new Set(b.values);
    return { r: 'set', values: a.values.filter((v) => inB.has(v)) };
  }
  if (a.r === 'ivl' && b.r === 'ivl') {
    const out: Array<[number, number]> = [];
    for (const [alo, ahi] of a.ivls) {
      for (const [blo, bhi] of b.ivls) {
        const lo = Math.max(alo, blo);
        const hi = Math.min(ahi, bhi);
        if (lo <= hi) out.push([lo, hi]);
      }
    }
    return ivlRegion(out);
  }
  if (a.r === 'box' && b.r === 'box') {
    const out: Array<Array<[number, number]>> = [];
    for (const ba of a.boxes) {
      for (const bb of b.boxes) {
        if (ba.length !== bb.length) continue;
        const cell: Array<[number, number]> = [];
        let ok = true;
        for (let d = 0; d < ba.length; d++) {
          const lo = Math.max(ba[d]![0], bb[d]![0]);
          const hi = Math.min(ba[d]![1], bb[d]![1]);
          if (lo > hi) {
            ok = false;
            break;
          }
          cell.push([lo, hi]);
        }
        if (ok) out.push(cell);
      }
    }
    return { r: 'box', boxes: out };
  }
  throw new Error(`cannot intersect a ${a.r} region with a ${b.r} region`);
}

/** a minus b, for sets and grid intervals. `step` is the grid step of an interval region. */
export function subtract(a: Region, b: Region, step: number): Region {
  if (b.r === 'all') return a.r === 'set' ? { r: 'set', values: [] } : a.r === 'ivl' ? { r: 'ivl', ivls: [] } : { r: 'box', boxes: [] };
  if (a.r === 'all') throw new Error('cannot subtract from an unbounded region');
  if (a.r === 'set' && b.r === 'set') {
    const inB = new Set(b.values);
    return { r: 'set', values: a.values.filter((v) => !inB.has(v)) };
  }
  if (a.r === 'ivl' && b.r === 'ivl') {
    let cur: Array<[number, number]> = a.ivls.map(([lo, hi]) => [lo, hi]);
    for (const [blo, bhi] of b.ivls) {
      const next: Array<[number, number]> = [];
      for (const [lo, hi] of cur) {
        if (bhi < lo || blo > hi) {
          next.push([lo, hi]);
          continue;
        }
        if (blo - step >= lo) next.push([lo, blo - step]);
        if (bhi + step <= hi) next.push([bhi + step, hi]);
      }
      cur = next;
    }
    return ivlRegion(cur);
  }
  throw new Error(`cannot subtract a ${b.r} region from a ${a.r} region`);
}

export function regionsEqual(a: Region, b: Region): boolean {
  return canonicalEqual(a, b);
}
