import type { Sim } from '../sim/sim.ts';
import type { Layer2 } from '../seeding/layer2.ts';
import type { Layer3 } from '../procedural/layer3.ts';
import type { EventsDigest } from '../sim/proc-events.ts';
import type { MirrorDigest } from '../sim/proc-mirror.ts';
import type { GroupDigest, GroupState } from '../sim/proc-groups.ts';
import type { GoalsDigest, GoalsState } from '../sim/proc-goals.ts';
import type { NormsDigest } from '../sim/proc-norms.ts';
import type { EventView, PoolEntry, Candidate, LogEntry } from '../procedural/types.ts';
import { PIN_PRECEDENCE, type Value } from '../types.ts';
import { canonicalEqual } from '../canon.ts';
import { recordedTieStrength } from '../sim/tie-policy.ts';
import { memberId, ownedId, isId } from '../id.ts';
import { contains } from '../region.ts';
import { BOUNDS, type Anchor, type Item, type Kind, type Retraction } from './schema.ts';
import { boxCentre, type PlaceLayout } from './layout.ts';
import { boundText } from './facets.ts';
import { KIND_GLYPHS, personGlyph, eventGlyph, placeGlyph, storyBadge } from './glyphs.ts';
import { plainWords, unopenedDoing, storyCaption } from './captions.ts';

export const LAYERS: Record<string, Kind[]> = {
  places: ['zone'], detail: ['zone'], people: ['actor'], groups: ['actor'], items: ['point'], ties: ['relation'],
  events: ['point', 'relation'], beliefs: ['relation'], stories: ['point', 'relation'],
  director: ['target'], intentions: ['relation'], placement: ['target'],
};
export const COARSE = 'not opened (coarse)';
export interface ObserveOptions {
  /** GameTime is lineage-relative. Default: synthetic Day 1, preserving the fixture's time of day. */
  gameEpochSeconds?: number;
  /** Optional explicit game entity bindings, supplied by the host rather than guessed. */
  entities?: ReadonlyMap<string, string>;
  layout?: PlaceLayout;
}
export interface Observation { t: number; branch?: string; layers: Map<string, Item[]>; truncations?: Map<string, Map<string, number>>; retractions?: Map<string, Retraction[]> }
const str = (v: unknown, fallback = COARSE): string => v === undefined ? fallback : typeof v === 'string' ? v : JSON.stringify(v);
const active = (v: { from?: number; to?: number }, t: number) => (v.from === undefined || v.from <= t) && (v.to === undefined || t < v.to);

/** No resolution, addressing, recovery, retention traversal, draws, or engine hooks.
 * Only existing records are inspected. Returned items own all their nested data.
 * Call after each completed window (and after any final writes in that window).
 */
export class HolotableObserver {
  private splitPeople = false;
  private peopleLayers = new Set<string>();
  constructor(readonly sim: Sim, readonly l2?: Layer2, readonly l3?: Layer3, readonly options: ObserveOptions = {}) {}
  get epoch(): number { return this.options.gameEpochSeconds ?? this.sim.w.index.clock?.sod0 ?? 0; }

  sample(): Observation {
    const { sim, l2, l3 } = this, k = sim.k, now = k.now, t = now + this.epoch;
    const layers = new Map(Object.keys(LAYERS).map((l) => [l, [] as Item[]]));
    const headers = k.store.headers;
    const frames = k.frames.all(); // existing records only
    const allEdges = k.store.allEdges(), edges = allEdges.filter((e) => active(e.valid, now));
    const heldItems = new Set(allEdges.filter((e) => e.type === 'xf:held-by').map((e) => e.from));
    const beliefs = k.beliefs.memorable().filter((e) => e.active).map((e) => e.belief);
    const ed = k.evolution.digestPeek<EventsDigest>('city.events');
    const gd = k.evolution.digestPeek<GroupDigest>('group.decide');
    const gs = sim.stateOf<GroupState>('group.decide');
    const goals = k.evolution.digestPeek<GoalsDigest>('people.goals')?.goals ?? [];
    const debts = sim.stateOf<GoalsState>('people.goals')?.debts ?? [];
    const norms = k.evolution.digestPeek<NormsDigest>('order.norms');
    const branch = k.persistence.parentKey ?? undefined;
    const schematicAnchors = new Set([...(this.options.layout?.cells.values() ?? [])].flatMap((a) => [JSON.stringify(a), JSON.stringify({ at: boxCentre(a) })]));
    for (const id of this.options.layout?.cells.keys() ?? []) schematicAnchors.add(JSON.stringify({ item: `story-engine/places/${id}` }));
    const put = (layer: string, id: string, kind: Kind, anchor: Anchor, cite: string, rest: Partial<Item> = {}) => {
      const glyph = layer === 'groups' ? 'group' : layer === 'items' ? 'item' : layer === 'placement' ? 'scene' : KIND_GLYPHS[kind];
      const item: Item = { schema: 'xfh/item-1', id, kind, t, anchor, cite, glyph, ...rest };
      if (schematicAnchors.has(JSON.stringify(anchor)))
        item.facets = { ...item.facets, layout: 'schematic layout' };
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer)!.push(item);
    };
    // Cached scalar slots are last-opened observations, never a request to open one.
    const cached = (id: string, slot: string): Value | undefined => {
      const s = k.store.nodes.get(id)?.slots.get(slot);
      return s?.s === 'resolved' && ['ok', 'contradiction'].includes(s.status) ? s.value : undefined;
    };
    const ownerRegion = (id: string, seen = new Set<string>()): string | undefined => {
      if (seen.has(id)) return undefined;
      seen.add(id);
      if (sim.w.index.cells[id] || sim.w.index.districts[id]) return id;
      const loc = edges.find((e) => e.from === id && e.type === 'core:located-in');
      if (loc) return ownerRegion(loc.to, seen);
      const h = headers.get(id);
      if (h?.origin.by === 'member' || h?.origin.by === 'value') return ownerRegion(h.origin.owner, seen);
      return undefined;
    };
    const regionAnchor = (id?: string): Anchor => this.options.layout?.cells.get(id ?? '') ?? { region: this.options.layout?.districts.get(id ?? '') ?? id ?? 'unplaced' };
    const cellFallback = (id?: string): Anchor => id && sim.w.index.cells[id] ? { item: `story-engine/places/${id}` } : regionAnchor(id);
    const placeAnchor = (id?: string): Anchor => {
      if (!id) return regionAnchor();
      const p = cached(id, 'position');
      if (Array.isArray(p) && p.length === 3) return { at: [...p] as [number, number, number] };
      return cellFallback(ownerRegion(id) ?? id);
    };
    const districtOf = (id: string): string | undefined => {
      const r = ownerRegion(id);
      return r && (sim.w.index.cells[r]?.district ?? (sim.w.index.districts[r] ? r : undefined));
    };
    const districtSlug = (id: string) => (sim.w.index.districts[id]?.key ?? 'unplaced').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const recordedName = (id?: string): string => {
      if (id === sim.w.v) return 'V';
      const value = isId(id) ? cached(ownedId(id, 'name'), 'display') : undefined;
      return typeof value === 'string' ? value : 'not recorded';
    };
    const placeName = (id?: string): string => {
      if (!id) return 'not recorded';
      const display = cached(id, 'display') ?? (isId(id) ? cached(ownedId(id, 'name'), 'display') : undefined);
      if (typeof display === 'string') return display;
      const cell = sim.w.index.cells[id], district = cell?.district ?? (sim.w.index.districts[id] ? id : undefined);
      const region = district && this.options.layout?.districts.get(district);
      return region ? `${cell ? 'cell in ' : ''}${plainWords(region.replace(/^Districts\./, ''))}` : 'not recorded';
    };
    const eventCaption = (ev: EventView) => `${plainWords(ev.kind)} (${plainWords(ev.outcome)}) at ${placeName(ev.place)}`;
    const actors = [...headers.values()].filter((h) => /^xf:resident(?:-[0-5])?$/.test(h.kind) || h.kind === 'xf:person' || h.id === sim.w.v);
    if (actors.length > BOUNDS.people) this.splitPeople = true;
    const actorLayers = new Map(actors.map((h) => [h.id, this.splitPeople ? `people-${districtSlug(districtOf(h.id) ?? '')}` : 'people']));
    for (const layer of actorLayers.values()) this.peopleLayers.add(layer);
    for (const layer of this.peopleLayers) layers.set(layer, []);
    const groups = [...headers.values()].filter((h) => k.schema.isKind(h.kind, 'core:group'));
    const groupIds = new Set(groups.map((h) => h.id));
    const events = new Map<string, EventView>();
    for (const ev of [...Object.entries(sim.record.evidence).map(([id, ev]) => ({ id, ...ev })), ...(l3?.state.evidence ?? []), ...(l3?.state.buffer.filter((e) => !e.change).map((e) => e.event) ?? [])]) {
      if (ev.kind !== '@state') events.set(ev.id, ev);
    }
    for (const feed of [ed?.facts, norms?.facts, k.evolution.digestPeek<MirrorDigest>('city.mirror')?.facts]) for (const win of feed?.windows ?? []) for (const f of win.items) {
      events.set(f.id, { id: f.id, creator: f.id, cause: f.parent ?? f.id, name: f.kind, time: f.time, kind: f.kind, place: f.cell, outcome: f.outcome,
        participants: f.parties.map(({ who, role }) => ({ who, role })), effects: [], causes: f.parent ? [f.parent] : [], witnesses: [] });
    }
    // Opened summary descriptors live in slot caches; their remaining constants
    // belong to the recorded materialisation owner (for example scene.acts).
    // Unlike mintedSpec this never recovers a header or addresses a participant.
    const materialisations = new Map(k.events.materialisationRecords().map((r) => [r.event, r.provenance]));
    for (const h of headers.values()) {
      if (h.origin.by !== 'minted' || !k.schema.isKind(h.kind, 'core:event')) continue;
      const owner = materialisations.get(h.id)?.materialisation ?? h.id;
      const own = (id: string, slot: string) => k.store.contributionsNaming(id).find((c) => c.source.layer === 'simulation' && c.source.origin === owner && c.target.slot === slot && c.form.f === 'const' && active(c.valid, now));
      const val = (id: string, slot: string): Value | undefined => { const c = own(id, slot); return cached(id, slot) ?? (c?.form.f === 'const' ? c.form.value : undefined); };
      const time = val(h.id, 'time'), kind = val(h.id, 'kind');
      if (typeof time !== 'number' || typeof kind !== 'string') continue;
      const ev: EventView = { id: h.id, ...h.origin, creator: h.origin.creator, cause: h.origin.cause, name: h.origin.name, time, kind, participants: [], effects: [], causes: [], witnesses: [] };
      const place = val(h.id, 'place'), outcome = val(h.id, 'outcome');
      if (typeof place === 'string') ev.place = place;
      if (outcome === 'done' || outcome === 'failed' || outcome === 'prevented') ev.outcome = outcome;
      for (let i = 0, n = Number(val(h.id, 'participants#count') ?? 0); i < n; i++) {
        const m = memberId(h.id, 'participants', i), who = val(m, 'who'), role = val(m, 'role');
        if (typeof who === 'string' && typeof role === 'string') ev.participants.push({ who, role });
      }
      for (let i = 0, n = Number(val(h.id, 'causes#count') ?? 0); i < n; i++) {
        const cause = val(h.id, `causes[${i}]`); if (typeof cause === 'string') ev.causes.push(cause);
      }
      events.set(h.id, ev);
    }
    const endpoint = (id: string, seen = new Set<string>()): string => {
      if (seen.has(id)) return `story-engine/people/${id}`;
      seen.add(id);
      if (actorLayers.has(id)) return `story-engine/${actorLayers.get(id)}/${id}`;
      if (groupIds.has(id)) return `story-engine/groups/${id}`;
      if (heldItems.has(id)) return `story-engine/items/${id}`;
      if (events.has(id)) return `story-engine/events/${id}`;
      const frame = frames.find((f) => f.id === id);
      if (frame) return endpoint(frame.actor, seen);
      if (sim.w.index.cells[id] || sim.w.index.districts[id]) return `story-engine/places/${id}`;
      const holder = edges.find((e) => e.from === id && e.type === 'xf:held-by');
      if (holder) return endpoint(holder.to, seen);
      const region = ownerRegion(id);
      return region ? `story-engine/places/${region}` : `story-engine/people/${id}`;
    };
    const relation = (layer: string, id: string, from: string, to: string, type: string, cite: string, facets?: Record<string, string>, strength?: number) =>
      put(layer, id, 'relation', { item: from }, cite, { value: { to: { item: to }, type, ...(strength !== undefined ? { strength } : {}) }, ...(facets ? { facets } : {}) });

    for (const d of Object.values(sim.w.index.districts)) {
      const cells = d.cellIds.map((id) => sim.w.index.cells[id]).filter(Boolean);
      const band = Math.max(0, ...d.cellIds.map((id) => ed?.bands[id]?.band ?? 0));
      const facets = { 'heat band': ed ? ['quiet', 'elevated', 'hot', 'flashpoint'][band] : COARSE, regime: str(ed?.regimes.filter((r) => r.scope === d.id || d.cellIds.includes(r.scope)).map((r) => r.kind), COARSE), 'faction presence shares': str(d.entry.byAff.map((a) => `${a.aff}:${a.q / (d.entry.total || 1)}`)), refuge: str(ed ? Object.fromEntries(cells.map((c) => [c.id, ed.refuge[c.id] ?? 'maybe'])) : undefined) };
      const regimes = ed?.regimes.filter((r) => r.scope === d.id || d.cellIds.includes(r.scope)).map((r) => r.kind) ?? [];
      const heat = ed ? [['quiet', 'elevated', 'hot', 'flashpoint'][band], ...regimes.map((r) => plainWords(r))].join(', ') : 'not recorded';
      put('places', d.id, 'zone', regionAnchor(d.id), `se:node:${d.id}`, { glyph: placeGlyph(regimes, cells.some((c) => ed?.refuge[c.id] === 'yes')), ...(ed ? { tone: ['muted', 'signal', 'warning', 'danger'][band] as Item['tone'] } : {}), facets: { heat, ...facets } });
    }
    for (const c of Object.values(sim.w.index.cells)) {
      const band = ed?.bands[c.id]?.band ?? 0;
      const regimes = ed?.regimes.filter((r) => r.scope === c.id || r.scope === c.district).map((r) => r.kind) ?? [];
      const heat = ed ? [['quiet', 'elevated', 'hot', 'flashpoint'][band], ...regimes.map((r) => plainWords(r))].join(', ') : 'not recorded';
      put('places', c.id, 'zone', regionAnchor(c.id), `se:node:${c.id}`, { glyph: placeGlyph(regimes, ed?.refuge[c.id] === 'yes'), ...(ed ? { tone: ['muted', 'signal', 'warning', 'danger'][band] as Item['tone'] } : {}), facets: { heat, 'heat band': ed ? ['quiet', 'elevated', 'hot', 'flashpoint'][band] : COARSE, regime: str(ed ? regimes : undefined), 'faction presence shares': str(c.presence), refuge: str(ed?.refuge[c.id]) } });
    }
    const detail = new Map<string, { tier: number; frame: string }>();
    for (const f of frames.filter((f) => f.status === 'active' || f.status === 'blocked')) for (const node of f.focus.nodes) {
      const r = ownerRegion(node); if (r && f.focus.tier >= 2 && f.focus.tier > (detail.get(r)?.tier ?? 0)) detail.set(r, { tier: f.focus.tier, frame: f.id });
    }
    for (const [r, d] of detail) put('detail', r, 'zone', regionAnchor(r), `se:frame:${d.frame}`, { facets: { detail: `tier ${d.tier}` } });
    for (const h of actors) {
      const mine = goals.filter((g) => g.owner === h.id && g.state === 'active');
      const fs = frames.filter((f) => f.actor === h.id && f.status === 'active');
      const openedTiers = [...(k.store.nodes.get(h.id)?.slots ?? [])].flatMap(([slot, value]) => value.s === 'resolved' ? [k.schema.slotInfo(h.kind, slot)?.def.tier ?? 0] : []);
      const level = Math.max(detail.get(ownerRegion(h.id) ?? '')?.tier ?? 0, ...openedTiers);
      const entity = this.options.entities?.get(h.id) ?? (h.origin.by === 'mirrored' ? h.origin.gameKey : undefined);
      const name = h.id === sim.w.v ? 'V' : str(cached(ownedId(h.id, 'name'), 'display'));
      const role = h.id === sim.w.v ? 'protagonist' : str(cached(h.id, 'role'));
      const affiliation = cached(h.id, 'affiliation') ?? (() => { const f = cached(h.id, 'affc'), d = sim.w.index.districts[districtOf(h.id) ?? '']; return typeof f === 'number' ? d?.affOrder[f] : undefined; })();
      put(actorLayers.get(h.id)!, h.id, 'actor', entity ? { entity } : cellFallback(ownerRegion(h.id)), `se:node:${h.id}`, {
        glyph: personGlyph(role), value: { name, role }, facets: {
          doing: str(cached(h.id, 'act') ?? cached(h.id, 'routine'), unopenedDoing(role === COARSE ? undefined : role)),
          goal: str([...mine.map((g) => `${g.kind}:${g.target ?? g.ward ?? g.item ?? 'none'}`), ...fs.filter((f) => f.level === 'goal' && !mine.some((g) => g.id === f.id)).map((f) => str(f.payload.goal))], 'none'),
          planning: str(mine.filter((g) => g.duty || g.intent).map((g) => ({ duty: g.duty, intention: g.intent?.name })), 'none'),
          thinking: str(beliefs.filter((b) => b.believer === h.id).map((b) => `${b.subject} ${b.path}=${str(b.value ?? b.region)}`), 'none'),
          affiliation: str(affiliation), detail: level ? `tier ${level}` : 'coarse',
        },
      });
    }
    for (const id of heldItems) {
      const holder = edges.find((e) => e.type === 'xf:held-by' && e.from === id)?.to;
      const entity = holder && (this.options.entities?.get(holder) ?? (() => { const h = headers.get(holder); return h?.origin.by === 'mirrored' ? h.origin.gameKey : undefined; })());
      const changes = allEdges.filter((e) => e.type === 'xf:held-by' && e.from === id && e.valid.from <= now).sort((a, b) => b.valid.from - a.valid.from || a.id.localeCompare(b.id)).slice(0, 2);
      put('items', id, 'point', entity ? { entity } : placeAnchor(ownerRegion(holder ?? id)), `se:node:${id}`, { facets: {
        'item kind': str(headers.get(id)?.kind), 'current holder': holder ?? 'none', 'holder history': str(changes.map((e) => ({ holder: e.to, from: e.valid.from, to: e.valid.to }))),
      } });
    }
    for (const h of groups) {
      const g = gd?.groups[h.id], state = gs?.groups[h.id], d = districtOf(h.id);
      const intent = g ? g.active ? plainWords(g.active.name) : g.intent.startsWith('active:') ? plainWords(g.intent.slice(7)) : 'no active intention'
        : state ? state.intent.state === 'active' ? plainWords(state.intent.name) : 'no active intention' : 'not recorded';
      put('groups', h.id, 'actor', regionAnchor(d), `se:node:${h.id}`, { value: { name: str(g?.aff ?? (h.origin.by === 'value' ? h.origin.slot : undefined)), role: 'group' }, facets: {
        intent, 'leader seats': str(g?.seats), drives: str(g?.W), 'active intention': str(g?.active ?? g?.intent), 'norm compliance': str(d ? norms?.norms[d] : undefined), books: str(state?.books),
      } });
    }
    for (const e of edges) {
      const type = e.type === 'xf:tie' ? str(e.attrs.kind) : e.type === 'core:member-of' ? 'member' : e.type === 'xf:leads' ? 'leads' : e.type === 'xf:held-by' ? 'holds' : undefined;
      if (!type) continue;
      const holds = e.type === 'xf:held-by';
      const strength = e.type === 'xf:tie' ? recordedTieStrength(sim.record.tieHistory[e.id], sim.data.ties.strength, now) : typeof e.attrs.strength === 'number' ? e.attrs.strength : 1;
      relation('ties', e.id, endpoint(holds ? e.to : e.from), endpoint(holds ? e.from : e.to), type, `se:edge:${e.id}`, undefined, strength);
    }
    for (const debt of debts) relation('ties', `debt-${debt.event}`, endpoint(debt.debtor), endpoint(debt.creditor), 'owes', `se:event:${debt.event}`, { due: str(debt.due) }, 1);
    for (const ev of events.values()) {
      put('events', ev.id, 'point', placeAnchor(ev.place), `se:event:${ev.id}`, { glyph: eventGlyph(ev.kind), t: ev.time + this.epoch, facets: { what: eventCaption(ev), kind: ev.kind, outcome: str(ev.outcome, 'not recorded'), participants: str(ev.participants.map((p) => `${p.role}:${p.who}`), 'none') } });
      for (const parent of ev.causes) relation('events', `cause-${ev.id}-${parent}`, `story-engine/events/${ev.id}`, `story-engine/events/${parent}`, 'caused', `se:event:${ev.id}`, { what: eventCaption(ev) });
    }
    // Truth checks use only already-recorded readings valid at the question's
    // time, or an exact-time/current-revision resolved cache. Never resolve an
    // unknown subject merely to decide whether someone is mistaken.
    const recordedValue = (id: string, path: string, at: number): Value | undefined => {
      const h = headers.get(id), info = h && k.schema.slotInfo(h.kind, path);
      const window = info?.def.temporal?.window;
      const slot = window === undefined ? path : `${path}@w${Math.floor(at / window)}`;
      const pins = k.store.pinsOn(id, slot).filter((p) => active(p.valid, at) && p.at <= at && (k.store.withdrawn.get(p.id)?.at ?? Infinity) > at && p.value !== undefined);
      const game = pins.filter((p) => p.reason === 'game').sort((a, b) => a.id.localeCompare(b.id));
      if (game.length) return game.at(-1)!.value;
      const state = k.store.nodes.get(id)?.slots.get(path);
      if (state?.s === 'resolved' && state.status === 'ok' && state.at === at && state.revision === k.revision) return state.value;
      const best = Math.max(...pins.map((p) => PIN_PRECEDENCE[p.reason]));
      const values = pins.filter((p) => PIN_PRECEDENCE[p.reason] === best).map((p) => p.value!);
      return values.length && values.every((v) => canonicalEqual(v, values[0])) ? values[0] : undefined;
    };
    for (const b of beliefs) {
      const ev = events.get(b.subject), frame = frames.find((f) => f.id === b.subject);
      const at = b.at ?? now;
      const truth = recordedValue(b.subject, b.path, at) ?? (ev && ev.time <= at && b.path in ev ? (ev as unknown as Record<string, unknown>)[b.path] : frame && at === now && b.path === 'status' ? frame.status : undefined);
      const wrong = truth !== undefined && (b.region ? !contains(b.region, truth as Value) : !canonicalEqual(truth, b.value));
      relation('beliefs', b.id, endpoint(b.believer), endpoint(b.subject), wrong ? 'believes-wrongly' : 'believes', `se:belief:${b.id}`, { claim: `${b.path}=${str(b.value ?? b.region)}`, about: b.subject });
    }
    const entryPlace = (e: PoolEntry): string | undefined => {
      const latest = [...e.stages, ...Object.values(e.graph?.junctures ?? {}).flatMap((j) => j.filler ? [{ event: j.filler.id, time: j.filler.at }] : [])].sort((a, b) => b.time - a.time);
      for (const f of latest) { const p = events.get(f.event)?.place; if (p) return p; }
      return Object.values(e.bindings).find((id) => sim.w.index.cells[id] || sim.w.index.districts[id]);
    };
    for (const e of l3?.state.pool ?? []) {
      if (e.graph?.retired) continue;
      const junctures = e.graph ? Object.fromEntries(Object.entries(e.graph.junctures).map(([key, j]) => [key, j.state])) : Object.fromEntries(e.stages.map((_, i) => [String(i), 'matched']));
      const pattern = l3?.sifter?.patterns.get(e.pattern)?.graph;
      const family = pattern?.family ?? 'not recorded';
      const badge = storyBadge(Object.values(junctures));
      const caption = storyCaption(e, pattern, recordedName);
      put('stories', e.id, 'point', placeAnchor(entryPlace(e)), `se:inst:${e.id}`, { glyph: 'story', ...(badge ? { badge } : {}), label: `${e.pattern} (${family})`, facets: { now: caption, pattern: `${e.pattern}@${e.version}`, 'pattern family': family, junctures: str(junctures), thread: str(l3?.threadView.find((th) => th.patterns?.includes(e.id) || th.instances.includes(e.id))?.id, 'none'), outcome: str(e.graph?.outcome?.name, e.complete ? 'done' : 'not done') } });
      for (const [role, id] of Object.entries(e.bindings)) if (actorLayers.has(id) || groupIds.has(id)) relation('stories', `role-${e.id}-${encodeURIComponent(role)}`, `story-engine/stories/${e.id}`, endpoint(id), `role:${role}`, `se:inst:${e.id}`, { now: caption });
    }
    for (const log of l3?.log ?? []) {
      if (log.kind !== 'sow') continue;
      const data = log.data, scores = (Array.isArray(data.scores) ? data.scores : []) as Array<Candidate & { score?: number }>;
      const e = l3?.state.pool.find((e) => e.id === data.entry || e.pattern === data.pattern);
      const request = data.request as { localName?: string } | undefined;
      const c = scores.find((c) => request?.localName && c.key.startsWith(request.localName)) ?? scores.find((c) => c.entry === data.entry);
      const id = String(log.seq);
      const kind = c?.kind === 'told' ? 'tell' : str(c?.kind, 'not recorded'), pattern = str(data.pattern ?? e?.pattern, 'not recorded');
      const decision = log.rule === 'sow' ? `sowed ${plainWords(pattern)} to ${plainWords(kind)}` : `refused at ${plainWords(log.rule)}`;
      put('director', id, 'target', placeAnchor(c?.place ?? (e ? entryPlace(e) : events.get(log.chain[0])?.place)), `se:sow:${id}`, { glyph: log.rule === 'sow' ? 'sown' : 'refused', t: log.at.game + this.epoch, facets: { decision, 'candidate kind': kind, pattern, gates: log.rule === 'sow' ? 'passed' : log.rule, score: str(c?.score, 'not recorded') } });
    }
    const holds = new Map<number, { log: LogEntry; until?: number }>(), activeHolds = new Map<string, number>(), cleared: Retraction[] = [];
    for (const log of l3?.log ?? []) if (log.kind === 'hold' && typeof log.data.delivery === 'string') {
      const delivery = log.data.delivery;
      if (log.rule === 'hold-cleared') {
        const seq = activeHolds.get(delivery), held = seq !== undefined ? holds.get(seq) : undefined;
        if (held) {
          held.until = log.at.game + this.epoch;
          cleared.push({ retract: `hold-${held.log.seq}`, t: held.until });
        }
        activeHolds.delete(delivery);
      } else { holds.set(log.seq, { log }); activeHolds.set(delivery, log.seq); }
    }
    for (const { log, until } of holds.values()) {
      const delivery = log.data.delivery as string;
      const inst = l2?.all().find((i) => i.st.deliveries.some((d) => d.id === delivery));
      const entry = inst && l3?.state.pool.find((e) => e.seed === inst.id);
      const place = entry ? entryPlace(entry) : inst && [...inst.st.receipts].reverse().find((r) => r.cue.place)?.cue.place;
      put('director', `hold-${log.seq}`, 'target', placeAnchor(place), `se:sow:${log.seq}`, { glyph: 'held', t: log.at.game + this.epoch, ...(until !== undefined ? { until } : {}), facets: { decision: `held: ${plainWords(str(log.data.reason, log.rule))}`, 'reason held': str(log.data.reason, log.rule), gate: log.rule, delivery } });
    }
    for (const [group, against] of Object.entries(gd?.against ?? {})) if (against) {
      const presented = l2?.all().some((i) => i.st.receipts.some((r) => r.cites.includes(against.warning ?? '') && ['presented', 'confirmed'].includes(r.grade))) ?? false;
      relation('intentions', against.id, endpoint(group), endpoint(against.target), 'intention', `se:node:${against.id}`, { rung: against.rung, warned: str(against.warned), presented: str(presented) });
    }
    for (const inst of l2?.all() ?? []) {
      if (['resolved', 'withdrawn', 'withered'].includes(inst.st.state)) continue;
      const deliveries = inst.st.deliveries.filter((d) => ['queued', 'released', 'displayed'].includes(d.state));
      const placeRole = Object.keys(inst.st.document.roles).find((r) => { const id = inst.st.roles[r]?.cast; return id && (sim.w.index.cells[id] || sim.w.index.districts[id]); });
      const place = [...inst.st.receipts].reverse().find((r) => r.cue.place)?.cue.place ?? (placeRole ? inst.st.roles[placeRole]?.cast : undefined);
      const phase = deliveries.at(-1)?.what ?? inst.st.state;
      const rungPin = inst.st.facts.rung?.pin;
      const rung = rungPin ? k.store.pin(rungPin)?.value : undefined;
      put('placement', inst.id, 'target', placeAnchor(place), `se:seed:${inst.id}`, { facets: { seed: inst.st.template.id, phase, rung: str(rung, 'not staged'), 'kit (logical)': str(deliveries.at(-1)?.fragment ?? inst.st.template.id) } });
    }
    const truncations = new Map<string, Map<string, number>>();
    for (const [layer, items] of layers) for (const item of items) {
      const n = boundText(item);
      if (n) { if (!truncations.has(layer)) truncations.set(layer, new Map()); truncations.get(layer)!.set(item.id, n); }
    }
    return structuredClone({ t, ...(branch ? { branch } : {}), layers, truncations, ...(cleared.length ? { retractions: new Map([['director', cleared]]) } : {}) });
  }
}
