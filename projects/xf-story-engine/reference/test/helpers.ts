// Test helpers: a small fixture schema builder and kernel factory.

import type { Config } from '../src/config.ts';
import { type CoreDefsOptions, coreDefs, mergeDefs } from '../src/core-schema.ts';
import { H, s } from '../src/id.ts';
import { Kernel } from '../src/kernel.ts';
import type { DimensionDef, KindDef, SchemaDefs, SlotDef } from '../src/schema-types.ts';
import type { FnRef, Id } from '../src/types.ts';

export const UNIFORM: FnRef = { name: 'uniform', version: 1 };

export const fxSeed = (name: string): Id => H(s('fixture'), s(name));

export const dim = (id: string, value: DimensionDef['value'], extra: Partial<DimensionDef> = {}): DimensionDef => ({
  id, value, structure: 'none', prior: UNIFORM, ...extra,
});

export const slot = (key: string, dimId: string, extra: Partial<SlotDef> = {}): SlotDef => ({
  key, dim: dimId, card: 'one', mode: 'sampled', tier: 0, ...extra,
});

export const kind = (id: string, slots: SlotDef[], extra: Partial<KindDef> = {}): KindDef => ({ id, slots, ...extra });

export const defsOf = (dims: DimensionDef[], kinds: KindDef[], edgeTypes: SchemaDefs['edgeTypes'] = []): SchemaDefs => ({ dims, kinds, edgeTypes });

/** A kernel over the fixture schema alone. */
export function fxKernel(name: string, defs: SchemaDefs, config?: Partial<Config>, opts: { validate?: boolean; now?: number } = {}): Kernel {
  const o: { defs: SchemaDefs; worldSeed: Id; config?: Partial<Config>; now?: number; validate?: boolean } = { defs, worldSeed: fxSeed(name) };
  if (config) o.config = config;
  if (opts.now !== undefined) o.now = opts.now;
  if (opts.validate === false) o.validate = false;
  return Kernel.create(o);
}

/** A kernel over the core schema plus fixture definitions. */
export function coreKernel(name: string, extra?: SchemaDefs, config?: Partial<Config>, core: CoreDefsOptions = {}): Kernel {
  const cfg = config ?? {};
  const defs = extra ? mergeDefs(coreDefs(cfg.wSim ?? 600, core), extra) : coreDefs(cfg.wSim ?? 600, core);
  const o: { defs: SchemaDefs; worldSeed: Id; config?: Partial<Config> } = { defs, worldSeed: fxSeed(name) };
  if (config) o.config = config;
  return Kernel.create(o);
}
