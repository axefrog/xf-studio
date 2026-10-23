// The initial layer-2 state: the global record, and a fresh instance state for a compiled document.

import type { GameTime, Id, Layer } from '../types.ts';
import type { CompiledResult } from './compile.ts';
import type { BeatRuntime, GlobalState, InstanceState, RoleState } from './types.ts';

export function emptyGlobal(): GlobalState {
  return {
    fragmentUses: {}, offerCount: 0, playTotal: 0, notices: [], sowing: {}, maintenance: [], sownBy: {}, nextSowSeq: 0,
    receipts: [], closures: [], history: [], marks: [],
  };
}

export function newInstanceState(
  res: CompiledResult,
  info: { pack: string; template: string; version: number; by: 'pack' | 'director' | 'plugin'; layer: Layer; decision?: Id; sowSeq: number; now: GameTime },
): InstanceState {
  const roles: Record<string, RoleState> = {};
  for (const key of Object.keys(res.seed.roles)) roles[key] = { committed: false, attempt: 0, ladder: { cursor: 0, relaxed: [] } };
  const beats: Record<string, BeatRuntime> = {};
  for (const bk of Object.keys(res.seed.beats)) beats[bk] = { state: 'locked', since: info.now, releases: 0, offers: 0, attempt: 0, availableCount: 0 };
  const promises: Record<string, 'open' | 'paid' | 'retired' | 'unopened'> = {};
  for (const p of res.seed.promises ?? []) promises[p.id] = 'unopened';
  const facts: Record<string, { pin?: Id; n: number }> = {};
  for (const fk of Object.keys(res.seed.facts ?? {})) facts[fk] = { n: 0 };
  return {
    template: { pack: info.pack, id: info.template, version: info.version },
    source: { by: info.by, layer: info.layer, ...(info.decision !== undefined ? { decision: info.decision } : {}) },
    sowSeq: info.sowSeq, document: res.seed, structureHash: res.structureHash, closure: res.closure,
    state: 'sown', since: info.now, entered: { sown: info.now }, latches: [], roles, facts, beats, draws: res.draws, consumed: [],
    deliveries: [], receipts: [], wakeups: [], record: [], nextEntry: 0, committed: false,
    world: (res.seed.world ?? []).map(() => ({ installed: false, ended: false })), frames: { roles: {}, goals: {} }, edges: {}, promises,
    intersections: {}, released: false,
  };
}
