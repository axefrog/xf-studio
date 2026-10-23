// The static world of the simulation layer: the kernel over the S1 schema, the roots, the districts, their cells and services as
// nodes the game owns, the pack installed, and lookups by Id. No process, no policy: those compose over this (`sim.ts`).

import type { Config } from '../config.ts';
import { makeConfig } from '../config.ts';
import { H, memberId, ownedId, s as hs } from '../id.ts';
import { Kernel } from '../kernel.ts';
import type { Id } from '../types.ts';
import type { CityKindDef, S1Data } from './data.ts';
import { defaultData } from './data.ts';
import { type Fit, fitIndex, worldPack } from './fit.ts';
import type { CellIndex, DistrictIndex, WorldIndex } from './index-types.ts';
import { simulatedDistricts } from './index-types.ts';
import { KindRegistry, lintKinds } from './kinds.ts';
import { simDefs, worldRegistry } from './world-schema.ts';
import { hrec } from '../canon.ts';
import type { Pack } from '../persistence.ts';

export class PackRefused extends Error {
  constructor(readonly problems: string[]) {
    super(`the pack is refused: ${problems.join('; ')}`);
  }
}

export interface WorldOptions {
  worldSeed: Id;
  index: WorldIndex;
  data?: S1Data;
  config?: Partial<Config>;
  /** Start the kernel at this game time. */
  now?: number;
}

export class World {
  readonly k: Kernel;
  readonly data: S1Data;
  readonly index: WorldIndex;
  readonly kinds: KindRegistry;
  readonly fits: Map<Id, Fit>;
  readonly pack: Pack;
  readonly city: Id;
  readonly v: Id;
  /** The mirrored node that carries V's mirrored slots: its position, district, cell and wanted level (the port writes them). */
  readonly vState: Id;
  /** `port` creates raw game events; `s1` is S1's own record (S1 0.4). */
  readonly port: Id;
  readonly s1: Id;
  readonly cityKindByName = new Map<string, CityKindDef>();

  private constructor(opts: WorldOptions) {
    const data = opts.data ?? defaultData();
    const problems = lintKinds(data);
    if (problems.length > 0) throw new PackRefused(problems);
    this.data = data;
    this.index = opts.index;
    this.kinds = new KindRegistry(data);
    // A resident is several nested draws and every rule re-reads its inputs, so one resolution replays a lot of cached cost (SPEC-NOTES 37, 103).
    const cfg = makeConfig({ wSim: data.time.W, allowance: 5_000_000, ...(opts.config ?? {}) });
    this.k = Kernel.create({ defs: simDefs(data, this.kinds.names(), cfg.wSim), worldSeed: opts.worldSeed, registry: worldRegistry(), config: cfg, ...(opts.now !== undefined ? { now: opts.now } : {}) });
    for (const kd of data.kinds) this.cityKindByName.set(kd.name, kd);
    const k = this.k;
    this.city = k.root('city', 'xf:city');
    this.v = k.root('v', 'core:person');
    this.vState = k.mirrored('v', 'xf:v-state');
    this.port = k.root('port', 'core:thing');
    this.s1 = k.root('s1', 'core:thing');
    this.fits = fitIndex(opts.index, data);
    this.pack = worldPack(opts.index, data, this.fits);
    this.buildNodes();
    k.persistence.installPack(this.pack);
  }

  static create(opts: WorldOptions): World {
    return new World(opts);
  }

  /** The districts and everything the index names, as nodes the game owns. Idempotent: it addresses, never mints. */
  buildNodes(): void {
    const k = this.k;
    const stream: Id[] = [this.city, this.v, this.vState, this.port, this.s1];
    for (const d of Object.keys(this.index.districts).sort().map((id) => this.index.districts[id]!)) {
      const node = k.mirrored(`place:${d.key}`, 'xf:district');
      if (node !== d.id) throw new Error(`the index names ${d.key} as ${d.id}, not ${node}`);
      stream.push(node);
      if (!d.simulated) continue;
      k.addEdge({ type: 'core:located-in', from: node, to: this.city, cause: this.city, valid: { from: 0 } });
      d.cellIds.forEach((cid, i) => {
        const cell = k.address(node, `cells[${i}]`);
        if (cell !== cid || cell !== memberId(node, 'cells', i)) throw new Error(`the index names cell ${i} of ${d.key} as ${cid}, not ${cell}`);
        stream.push(cell);
        const c = this.index.cells[cid]!;
        c.services.forEach((_s, j) => stream.push(k.address(cell, `services[${j}]`)));
      });
      for (const slot of ['grp-a1', 'grp-a2', 'grp-a3', 'circle-stalls', 'standing-v']) stream.push(k.address(node, slot));
      for (const slot of ['grp-a1', 'grp-a2', 'grp-a3', 'circle-stalls']) stream.push(k.address(ownedId(node, slot), 'standing-v'));
    }
    k.retention.streamIn(stream);
  }

  // ---- lookups ----

  district(id: Id): DistrictIndex {
    const d = this.index.districts[id];
    if (!d) throw new Error(`unknown district ${id}`);
    return d;
  }
  cell(id: Id): CellIndex {
    const c = this.index.cells[id];
    if (!c) throw new Error(`unknown cell ${id}`);
    return c;
  }
  get districts(): DistrictIndex[] {
    return simulatedDistricts(this.index);
  }
  /** The group node of an affiliation slot `A1`, `A2` or `A3` of a district (S1 7.0). */
  group(district: Id, slot: 'A1' | 'A2' | 'A3'): Id {
    return ownedId(district, `grp-${slot.toLowerCase()}`);
  }
  circle(district: Id): Id {
    return ownedId(district, 'circle-stalls');
  }
  standingOfCarrier(node: Id): Id {
    return ownedId(node, 'standing-v');
  }
  /** The hash of the S1 data, for the lineage record. */
  get dataHash(): Id {
    return H(hs('s1data'), hrec(this.data as unknown as Record<string, unknown>));
  }
}
