import type { Kernel } from '../kernel.ts';
import type { Instance, Layer2 } from '../seeding/layer2.ts';
import { verdictOnNode } from '../seeding/cast.ts';
import type { EventView, InstanceView, KernelView, Layer2View } from './types.ts';

export function instanceView(inst: Instance): InstanceView {
  const st = inst.st;
  const displays = new Map<string, InstanceView['displays'][number]>();
  const rank = { ambient: 0, presented: 1, confirmed: 2 };
  for (const e of st.record)
    if (
      e.kind === 'display' &&
      typeof e.data.delivery === 'string' &&
      typeof e.data.grade === 'string' &&
      e.data.grade in rank
    ) {
      const grade = e.data.grade as keyof typeof rank,
        prior = displays.get(e.data.delivery);
      if (!prior || rank[grade] > rank[prior.grade])
        displays.set(e.data.delivery, { delivery: e.data.delivery, grade, playTotal: e.playTotal });
    }
  for (const r of st.receipts) {
    const prior = displays.get(r.delivery);
    if (!prior || rank[r.grade] > rank[prior.grade])
      displays.set(r.delivery, { delivery: r.delivery, grade: r.grade, playTotal: r.playTotal });
  }
  return structuredClone({
    id: inst.id,
    template: st.template,
    level: st.document.level,
    source: st.source,
    sowSeq: st.sowSeq,
    state: st.state,
    ...(st.document.growsFrom ? { growsFrom: st.document.growsFrom as InstanceView['growsFrom'] } : {}),
    roles: Object.fromEntries(
      Object.entries(st.roles).map(([k, r]) => [
        k,
        { cast: r.cast, committed: r.committed, anchor: !!st.document.roles[k]?.anchor },
      ]),
    ),
    beats: Object.entries(st.beats).map(([key, b]) => ({ key, kind: st.document.beats[key]?.kind, state: b.state })),
    displays: [...displays.values()],
    responses: st.record
      .filter((r) => r.kind === 'response' && /^(action:|decline:|null$)/.test(String(r.data.kind)))
      .map((r) => ({
        kind: String(r.data.kind),
        delivery: st.deliveries.find((d) => d.offerEvent === r.data.offer)?.id,
        playTotal: r.playTotal,
        game: r.at,
      })),
    draws: st.draws,
    closingPending: st.deliveries.some(
      (d) => ['closing', 'coda'].includes(d.what) && ['queued', 'released'].includes(d.state),
    ),
  });
}
export function layer2View(l2: Layer2): Layer2View {
  return {
    playTotal: () => l2.playTotal(),
    instances: () => l2.all().map(instanceView),
    instance: (id) => {
      const inst = l2.instance(id);
      return inst ? instanceView(inst) : undefined;
    },
    sownBy: (d) => l2.sownBy(d),
    global: () => structuredClone({ offerCount: l2.global.offerCount, fragmentUses: l2.global.fragmentUses }),
    exposedNode: (n, g) => l2.exposedNode(n, g),
    claimConflict: (n, span, share) => l2.claimConflict(n, span, share),
  };
}
export interface WorldRegistry {
  eventKind(name: string): { tags: string[]; producers: string[] } | undefined;
  names(): string[];
  isSpine?(node: string): boolean;
  aesthetic?(node: string, feature: string): number | undefined;
}
export function kernelView(k: Kernel, l2: Layer2, registry: WorldRegistry): KernelView {
  return {
    kind: (n) => k.store.header(n)?.kind,
    isKind: (a, b) => k.schema.hasKind(a) && k.schema.hasKind(b) && k.schema.isCompatibleKind(a, b),
    isSpine: (n) => registry.isSpine?.(n) ?? l2.opts.spine?.has(n) ?? false,
    aesthetic: (n, f) => registry.aesthetic?.(n, f),
    eventKind: (n) => {
      const r = registry.eventKind(n);
      return r ? structuredClone(r) : undefined;
    },
    eventKinds: () => registry.names().slice(),
    holds: (p, n, at = k.now) => verdictOnNode(l2, n, p, at) === 'yes',
    event: (id) => readEvent(k, id),
  };
}
export function readEvent(k: Kernel, id: string): EventView | undefined {
  const h = k.store.header(id);
  if (!h || h.origin.by !== 'minted') return undefined;
  const time = k.value(id, 'time'),
    kind = k.value(id, 'kind');
  if (typeof time !== 'number' || typeof kind !== 'string') return undefined;
  const e: EventView = {
    id,
    creator: h.origin.creator,
    cause: h.origin.cause,
    name: h.origin.name,
    time,
    kind,
    participants: [],
    effects: [],
    causes: [],
    witnesses: [],
  };
  for (const field of ['participants', 'effects', 'causes', 'witnesses'] as const) {
    const count = k.value(id, field + '#count');
    if (typeof count !== 'number') return undefined;
    for (let i = 0; i < count; i++) {
      if (field === 'participants') {
        const m = k.address(id, `participants[${i}]`);
        const who = k.value(m, 'who'),
          role = k.value(m, 'role');
        if (typeof who !== 'string' || typeof role !== 'string') return undefined;
        e.participants.push({ who, role });
      } else if (field === 'effects') {
        const m = k.address(id, `effects[${i}]`);
        const on = k.value(m, 'on'),
          effect = k.value(m, 'effect');
        if (typeof on !== 'string' || typeof effect !== 'string') return undefined;
        e.effects.push({ on, effect: effect as import('../types.ts').Effect });
      } else {
        const value = k.value(id, `${field}[${i}]`);
        if (typeof value !== 'string') return undefined;
        e[field].push(value);
      }
    }
  }
  const place = k.value(id, 'place');
  if (typeof place === 'string') e.place = place;
  const outcome = k.value(id, 'outcome');
  if (outcome === 'done' || outcome === 'failed' || outcome === 'prevented') e.outcome = outcome;
  const served = k.value(id, 'served');
  if (typeof served === 'string') e.served = served;
  if (h.origin.creator === h.origin.cause && /^item:\d+$/.test(h.origin.name)) {
    const source = k.store
      .contributionsNaming(id)
      .find((c) => c.source.layer === 'simulation' && c.target.slot === 'participants#count' && c.form.f === 'const')
      ?.source.origin;
    if (source && source !== id) e.provenance = { descriptor: h.origin.creator, materialisation: source };
  }
  return e;
}
