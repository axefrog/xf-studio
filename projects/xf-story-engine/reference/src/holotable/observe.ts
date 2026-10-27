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
import type { PlaceLayout } from './layout.ts';
import { boundText } from './facets.ts';
import { KIND_GLYPHS, personGlyph, eventGlyph, placeGlyph, storyGlyph, decisionGlyph } from './glyphs.ts';
import * as wording from '../wording/index.ts';
import { ROLES, profileR, profileF } from '../sim/profile.ts';

export const LAYERS: Record<string, Kind[]> = {
  places: ['zone'], detail: ['zone'], people: ['actor', 'point'], groups: ['actor'], items: ['point'], ties: ['relation'],
  events: ['point', 'relation'], beliefs: ['relation'], stories: ['point', 'relation'], 'possible-stories': ['point'],
  director: ['target'], intentions: ['relation'], placement: ['target'],
};
export interface ObserveOptions {
  /** GameTime is lineage-relative. Default: synthetic Day 1, preserving the fixture's time of day. */
  gameEpochSeconds?: number;
  /** Origin for the day/time prose, independently of the spool clock. */
  runStartSeconds?: number;
  /** Optional explicit game entity bindings, supplied by the host rather than guessed. */
  entities?: ReadonlyMap<string, string>;
  layout?: PlaceLayout;
  /** Copied complete history when the host drains L3's diagnostic sink. */
  directorLog?: readonly LogEntry[];
}
export interface Observation { t: number; branch?: string; layers: Map<string, Item[]>; truncations?: Map<string, Map<string, number>>; retractions?: Map<string, Retraction[]> }
const active = (v: { from?: number; to?: number }, t: number) => (v.from === undefined || v.from <= t) && (v.to === undefined || t < v.to);

/** No resolution, addressing, recovery, retention traversal, draws, or engine hooks.
 * Only existing records are inspected. Returned items own all their nested data.
 * Call after each completed window (and after any final writes in that window).
 */
export class HolotableObserver {
  private splitPeople = false;
  private peopleLayers = new Set<string>();
  private stops = new Map<string, { key: string; item: Item }>();
  private displayNames = new Map<string, string>();
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
    const put = (layer: string, id: string, kind: Kind, anchor: Anchor, cite: string, rest: Partial<Item> = {}) => {
      const glyph = layer === 'groups' ? 'group' : layer === 'items' ? 'item' : layer === 'placement' ? 'scene' : KIND_GLYPHS[kind];
      const item: Item = { schema: 'xfh/item-1', id, kind, t, anchor, cite, glyph, ...rest };
      if (layer === 'places' && this.options.layout?.cells.has(id))
        item.facets = { ...item.facets, about: wording.phrase('schematic-block-about') };
      item.label = wording.displayText(item.label);
      item.detail = wording.displayText(item.detail, true);
      if (item.facets) item.facets = Object.fromEntries(Object.entries(item.facets).filter(([key, value]) => wording.displayText(key) && wording.displayText(value)));
      if (item.value) for (const key of ['name', 'role', 'type'] as const) if (key in item.value) item.value[key] = wording.displayText(item.value[key]);
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
    const recordedNameOld = (id?: string): string | undefined => {
      if (id === sim.w.v) return 'V';
      const value = isId(id) ? cached(ownedId(id, 'name'), 'display') : undefined;
      return wording.displayText(value);
    };
    const placeName = (id?: string): string | undefined => {
      if (!id) return undefined;
      const c = sim.w.index.cells[id], d = sim.w.index.districts[c?.district ?? id];
      if (!d) return undefined;
      const name = ({ wat_kab: 'Kabuki', wat_nor: 'Northside', wat_lch: 'Little China' } as Record<string, string>)[d.key];
      return name && c ? `${name}, block ${[...d.cellIds].sort().indexOf(id) + 1}` : name;
    };
    const actors = [...headers.values()].filter((h) => /^xf:resident(?:-[0-5])?$/.test(h.kind) || h.kind === 'xf:person' || h.id === sim.w.v);
    const actorLayers = new Map(actors.map((h) => [h.id, 'people']));
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
    // Pure display names for all existing people; the pool assignment opens no
    // slot and draws nothing in the simulation. Already recorded names win.
    const nameRecords = new Map<string, string>();
    for (const h of actors) {
      const known = recordedNameOld(h.id);
      nameRecords.set(h.id, this.displayNames.get(h.id) ?? known ?? (h.origin.by === 'mirrored' && h.id !== sim.w.v ? wording.phrase('game-person') : wording.poolName(h.id, sim.data.people.names)));
    }
    const groupAff = (id: string) => {
      const known = gd?.groups[id]?.aff;
      if (known) return known;
      const h = headers.get(id), d = sim.w.index.districts[districtOf(id) ?? ''];
      if (h?.origin.by !== 'value') return undefined;
      const slot = h.origin.slot, index = ['grp-a1', 'grp-a2', 'grp-a3'].indexOf(slot);
      return index >= 0 ? d?.affOrder[index + 2] : slot === 'circle-stalls' ? 'stallholders' : slot;
    };
    for (const h of groups) {
      const name = wording.groupName(groupAff(h.id));
      if (name) nameRecords.set(h.id, name === 'NCPD' ? 'the NCPD' : `the ${name}`);
    }
    for (const id of Object.keys(sim.w.index.cells)) { const name = placeName(id); if (name) nameRecords.set(id, name); }
    for (const id of heldItems) { nameRecords.set(id, wording.itemName(cached(id, 'label'), headers.get(id)?.kind.split(':').at(-1))); }
    for (const ev of events.values()) nameRecords.set(ev.id, wording.eventNoun(ev.kind));
    const names = wording.names(nameRecords, sim.w.v);
    const resolve: wording.Names = (id, prose = true) => {
      const value = names(id, prose);
      if (id && actorLayers.has(id) && id !== sim.w.v && value && !this.displayNames.has(id)) this.displayNames.set(id, names(id, false)!);
      return value;
    };
    const name = (id?: string) => resolve(id, false);
    const eventSentence = (ev: EventView) => wording.event(ev, resolve);
    const why = (id?: string | readonly string[]) => id ? wording.why(id, 5, events, resolve, this.options.runStartSeconds ?? 0) : [];
    const proseDetail = (summary: string, cause?: string | readonly string[], current?: string) => [summary, ...(current ? [current] : []), ...(cause && why(cause).length ? ['', ...why(cause)] : [])].join('\n');
    const profile = (id: string) => {
      const h = headers.get(id);
      const value = cached(id, 'profile') ?? (h?.origin.by === 'value' && /^m[0-5]$/.test(h.origin.slot) ? cached(h.origin.owner, `p${h.origin.slot.slice(1)}`) : undefined);
      return typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined;
    };
    const roleOf = (id: string) => { const p = profile(id), r = cached(id, 'role'); return typeof r === 'string' ? r : p !== undefined ? ROLES[profileR(p)] : undefined; };
    const affOf = (id: string) => {
      const a = cached(id, 'affiliation'), p = profile(id), f = cached(id, 'affc') ?? (p !== undefined ? profileF(p) : undefined);
      return typeof a === 'string' ? a : typeof f === 'number' ? sim.w.index.districts[districtOf(id) ?? '']?.affOrder[f] : undefined;
    };
    const opened = new Set<string>([sim.w.v]);
    for (const h of actors) {
      const named = headers.has(ownedId(h.id, 'name')) || k.persistence.savedHeader(ownedId(h.id, 'name')) !== undefined;
      if (h.kind === 'xf:person' || h.origin.by === 'mirrored' || named) opened.add(h.id);
    }
    for (const ev of events.values()) for (const p of ev.participants) if (actorLayers.has(p.who)) opened.add(p.who);
    for (const e of l3?.state.pool ?? []) for (const id of Object.values(e.bindings)) if (actorLayers.has(id)) opened.add(id);
    for (const f of frames) if (actorLayers.has(f.actor)) opened.add(f.actor);
    const crowdCounts = new Map(sim.people.populationSnapshot());
    for (const h of actors) if (opened.has(h.id) && /^xf:resident(?:-[0-5])?$/.test(h.kind)) {
      const cell = ownerRegion(h.id);
      if (cell && crowdCounts.has(cell)) crowdCounts.set(cell, Math.max(0, crowdCounts.get(cell)! - 1));
    }
    const publishedCount = actors.filter((h) => opened.has(h.id)).length + [...crowdCounts.values()].filter((n) => n > 0).length;
    if (publishedCount > BOUNDS.people) this.splitPeople = true;
    for (const h of actors) actorLayers.set(h.id, this.splitPeople ? `people-${districtSlug(districtOf(h.id) ?? '')}` : 'people');
    for (const h of actors) if (opened.has(h.id)) this.peopleLayers.add(actorLayers.get(h.id)!);
    for (const layer of this.peopleLayers) layers.set(layer, []);
    const crowdId = (cell: string) => `crowd-${cell}`;
    const crowdLayer = (cell: string) => this.splitPeople ? `people-${districtSlug(sim.w.index.cells[cell]?.district ?? '')}` : 'people';
    const endpoint = (id: string, seen = new Set<string>()): string => {
      if (seen.has(id)) return `story-engine/people/${id}`;
      seen.add(id);
      if (actorLayers.has(id)) {
        const cell = ownerRegion(id);
        return !opened.has(id) && cell && sim.w.index.cells[cell] ? `story-engine/${crowdLayer(cell)}/${crowdId(cell)}` : `story-engine/${actorLayers.get(id)}/${id}`;
      }
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

    const mood = (band: number, regimes: string[]) => [['quiet', 'tense', 'hot', 'flashpoint'][band], ...regimes.map((r) => r === 'curfew' ? 'under curfew' : r === 'crackdown' ? 'under a crackdown' : r === 'festival' ? 'celebrating a festival' : wording.words(r))].filter(Boolean).join(', ');
    for (const d of Object.values(sim.w.index.districts)) {
      const band = Math.max(0, ...d.cellIds.map((id) => ed?.bands[id]?.band ?? 0));
      const regimes = ed?.regimes.filter((r) => r.scope === d.id || d.cellIds.includes(r.scope)).map((r) => r.kind) ?? [];
      const shares = wording.share(Object.fromEntries(d.entry.byAff.map((a) => [a.aff, a.q])));
      const refuge = d.cellIds.some((id) => ed?.refuge[id] === 'yes');
      put('places', d.id, 'zone', regionAnchor(d.id), `se:node:${d.id}`, { label: placeName(d.id), glyph: placeGlyph(regimes, refuge), facets: {
        ...(ed ? { mood: mood(band, regimes) } : {}), ...(shares ? { "who's here": shares } : {}), ...(refuge ? { refuge: 'a refuge: people hide here' } : {}),
      } });
    }
    for (const c of Object.values(sim.w.index.cells)) {
      const regimes = ed?.regimes.filter((r) => r.scope === c.id || r.scope === c.district).map((r) => r.kind) ?? [];
      const shares = wording.share(c.presence), refuge = ed?.refuge[c.id] === 'yes';
      put('places', c.id, 'zone', regionAnchor(c.id), `se:node:${c.id}`, { label: placeName(c.id), glyph: placeGlyph(regimes, refuge), facets: {
        ...(ed ? { mood: mood(ed.bands[c.id]?.band ?? 0, regimes) } : {}), ...(shares ? { "who's here": shares } : {}), ...(refuge ? { refuge: 'a refuge: people hide here' } : {}),
      } });
    }
    const detail = new Map<string, { tier: number; frame: string }>();
    for (const f of frames.filter((f) => f.status === 'active' || f.status === 'blocked')) for (const node of f.focus.nodes) {
      const r = ownerRegion(node); if (r && f.focus.tier >= 2 && f.focus.tier > (detail.get(r)?.tier ?? 0)) detail.set(r, { tier: f.focus.tier, frame: f.id });
    }
    for (const [r, d] of detail) put('detail', r, 'zone', regionAnchor(r), `se:frame:${d.frame}`, { label: d.tier >= 3 ? 'Simulated in full detail' : 'Simulated in outline' });
    const frameWants = (actor: string): string[] => frames.filter((f) => f.actor === actor && f.level === 'goal' && f.status === 'active').flatMap((f) => {
      const payload = f.payload as { goal?: { effects?: Array<{ on: unknown; effect: string }> } };
      return (payload.goal?.effects ?? []).flatMap((effect) => {
        const target = typeof effect.on === 'string' ? resolve(effect.on) : undefined;
        const key = ({ give: 'wants-give', help: 'wants-help', protect: 'wants-protect', harm: 'wants-harm', take: 'wants-take' } as const)[effect.effect as 'give'];
        return key && target ? [wording.phrase(key, { target })] : [];
      });
    });
    const claim = (b: typeof beliefs[number]) => wording.belief(b, resolve, events, this.options.runStartSeconds ?? 0, frames.find((f) => f.id === b.subject)?.actor);
    for (const h of actors.filter((h) => opened.has(h.id))) {
      const mine = goals.filter((g) => g.owner === h.id && g.state === 'active');
      const role = roleOf(h.id), affiliation = wording.groupName(affOf(h.id));
      const wants = [...frameWants(h.id), ...mine.flatMap((g) => {
        const target = resolve(g.target ?? g.ward ?? g.item);
        if (g.kind === 'collect' && target) return [wording.phrase('goal-collect', { target })];
        if (g.kind === 'redress' && target) return [wording.phrase('goal-redress', { target })];
        if (g.duty === 'guard' && target) return [wording.phrase('goal-guard', { target })];
        if (g.duty === 'search' && target) return [wording.phrase('goal-search', { target })];
        if (g.duty === 'strike' && target) return [wording.phrase('goal-strike', { target })];
        if (g.duty === 'collect') return [wording.phrase('goal-collect-fee')];
        return target ? [wording.phrase('goal-target', { target })] : [];
      })];
      const planning = mine.flatMap((g) => { const intent = g.intent && (wording.wording.intentions as Record<string, string>)[g.intent.name]; return intent ? [wording.phrase('planning', { intent })] : []; });
      const text = wording.person({ name: name(h.id)!, role, doing: cached(h.id, 'act') ?? cached(h.id, 'routine'), wants: [...new Set(wants)].sort(), planning: [...new Set(planning)].sort(), believes: beliefs.filter((b) => b.believer === h.id).flatMap((b) => claim(b) ?? []).sort(), affiliation });
      const entity = this.options.entities?.get(h.id) ?? (h.origin.by === 'mirrored' ? h.origin.gameKey : undefined);
      put(actorLayers.get(h.id)!, h.id, 'actor', entity ? { entity } : cellFallback(ownerRegion(h.id)), `se:node:${h.id}`, {
        glyph: personGlyph(role), label: text.label, value: { name: name(h.id)!, ...(wording.roleWord(role) ? { role: wording.roleWord(role) } : {}) }, facets: text.facets,
      });
    }
    for (const [cell, background] of crowdCounts) {
      if (!background) continue;
      const who = wording.share(sim.w.index.cells[cell].presence);
      const layer = crowdLayer(cell); this.peopleLayers.add(layer);
      put(layer, crowdId(cell), 'point', cellFallback(cell), `se:node:${cell}`, { glyph: 'crowd', label: wording.phrase('crowd', { count: String(background) }), facets: {
        ...(who ? { who } : {}), about: wording.phrase('crowd-about'),
      } });
    }
    for (const id of heldItems) {
      const holder = edges.find((e) => e.type === 'xf:held-by' && e.from === id)?.to, holderName = resolve(holder);
      const label = cached(id, 'label');
      const entity = holder && this.options.entities?.get(holder);
      put('items', id, 'point', entity ? { entity } : placeAnchor(ownerRegion(holder ?? id)), `se:node:${id}`, { label: wording.sentence(wording.itemName(label, headers.get(id)?.kind.split(':').at(-1))), facets: { ...(holderName ? { holder: holderName } : {}) } });
    }
    for (const h of groups) {
      const g = gd?.groups[h.id], state = gs?.groups[h.id], d = districtOf(h.id);
      const intention = g?.active?.name ?? (state?.intent.state === 'active' ? state.intent.name : undefined);
      const intent = intention && (wording.wording.intentions as Record<string, string>)[intention];
      const leaders = (g?.seats ?? state?.seats ?? []).flatMap((s) => s.holder && name(s.holder) ? [name(s.holder)!] : []);
      const district = d && sim.w.index.districts[d];
      const compliance = district ? sim.data.norms.norms.filter((n) => district.affOrder[Number(n.enforcer.aff.slice(1)) + 1] === groupAff(h.id)).flatMap((n) => norms?.norms[d!]?.[n.id]?.beh ?? []) : [];
      const label = wording.groupName(groupAff(h.id)), wants = [...new Set(frameWants(h.id))].sort();
      if (!label) continue;
      put('groups', h.id, 'actor', regionAnchor(d), `se:node:${h.id}`, { glyph: ['NCPD', 'stallholders', 'A group'].includes(label) ? 'group' : ['Arasaka', 'Militech'].includes(label) ? 'corp' : 'gang', label, value: { name: label, role: 'group' }, facets: {
        ...(leaders.length ? { leaders: leaders.join(', ') } : {}), ...(intent ? { intends: wording.phrase('intends', { intent }) } : {}),
        ...(compliance.length ? { 'keeping to its rules': wording.percent(compliance.reduce((s, n) => s + n, 0) / compliance.length) } : {}),
        ...(wants.length ? { wants: wants.join(' ') } : {}),
      } });
    }
    for (const e of edges) {
      const type = e.type === 'xf:tie' ? wording.tieType(String(e.attrs.kind ?? 'neighbour')) : e.type === 'core:member-of' ? 'member of' : e.type === 'xf:leads' ? 'leads' : e.type === 'xf:held-by' ? 'holds' : undefined;
      if (!type) continue;
      const holds = e.type === 'xf:held-by';
      const strength = e.type === 'xf:tie' ? recordedTieStrength(sim.record.tieHistory[e.id], sim.data.ties.strength, now) : typeof e.attrs.strength === 'number' ? e.attrs.strength : 1;
      relation('ties', e.id, endpoint(holds ? e.to : e.from), endpoint(holds ? e.from : e.to), type, `se:edge:${e.id}`, { strength: wording.strength(strength) }, strength);
    }
    for (const debt of debts) relation('ties', `debt-${debt.event}`, endpoint(debt.debtor), endpoint(debt.creditor), 'owes', `se:event:${debt.event}`, { strength: 'strong' }, 1);
    for (const ev of events.values()) {
      const text = eventSentence(ev), who = ev.participants.flatMap((p) => { const n = name(p.who), role = wording.roleWord(p.role); return n ? [`${n}${role ? ` (${role})` : ''}`] : []; }).join(', ');
      const district = ev.place ? undefined : ev.participants.map((p) => districtOf(p.who)).find(Boolean) ?? Object.values(sim.w.index.districts).find((d) => d.simulated)?.id;
      put('events', ev.id, 'point', placeAnchor(ev.place ?? district), `se:event:${ev.id}`, { glyph: eventGlyph(ev.kind), t: ev.time + this.epoch, label: text, detail: proseDetail(text, ev.id), facets: { 'what happened': text, ...(who ? { who } : {}), ...(district && placeName(district) ? { placement: wording.phrase('placed-district', { place: placeName(district) }) } : {}) } });
      // The complete cause chain is in detail. An event appears exactly once;
      // it does not also publish a second clickable item for each cause link.
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
      const text = claim(b);
      if (!text) continue;
      relation('beliefs', b.id, endpoint(b.believer), endpoint(b.subject), wrong ? 'is wrong about' : 'believes', `se:belief:${b.id}`, { belief: text });
    }
    const entryPlace = (e: PoolEntry): string | undefined => {
      const latest = [...e.stages, ...Object.values(e.graph?.junctures ?? {}).flatMap((j) => j.filler ? (j.filler.ref && 'event' in j.filler.ref ? [j.filler.id] : j.filler.causes ?? []).map((event) => ({ event, time: j.filler!.at })) : [])].sort((a, b) => b.time - a.time);
      for (const f of latest) { const p = events.get(f.event)?.place; if (p) return p; }
      return Object.values(e.bindings).find((id) => sim.w.index.cells[id] || sim.w.index.districts[id]);
    };
    const storyPattern = (e: PoolEntry) => l3?.sifter?.patterns.get(e.pattern)?.graph;
    const storyTitle = (e: PoolEntry) => wording.title(e, resolve);
    const storyStep = (e: PoolEntry, key: string, mood: wording.Mood) => {
      const pattern = storyPattern(e), j = pattern?.junctures?.[key];
      const filler = e.graph?.junctures[key]?.filler;
      const bindings = { ...e.bindings };
      if (j && mood === 'past') for (const [arg, variable] of Object.entries(j.args)) if (variable.startsWith('?') && filler?.args[arg]) bindings[variable] = filler.args[arg];
      return j ? wording.step(j, mood, { ...e, bindings }, pattern, resolve) : undefined;
    };
    const storyView = (e: PoolEntry) => {
      const pattern = storyPattern(e), order = Object.keys(pattern?.junctures ?? {}), entries = Object.entries(e.graph?.junctures ?? {}).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || a[0].localeCompare(b[0]));
      const matched = entries.filter(([, j]) => j.state === 'matched' || j.state === 'refined').sort((a, b) => (a[1].filler?.at ?? 0) - (b[1].filler?.at ?? 0) || order.indexOf(a[0]) - order.indexOf(b[0]));
      const ready = entries.filter(([, j]) => ['ready', 'pending'].includes(j.state));
      const open = ready.length ? ready : entries.filter(([, j]) => j.state === 'open');
      const past = matched.flatMap(([key]) => storyStep(e, key, 'past') ?? []);
      const next = open.flatMap(([key]) => storyStep(e, key, 'waiting') ?? []);
      const outcome = e.graph?.outcome;
      const reached = outcome && pattern?.outcomes?.[outcome.name]?.reached;
      const ending = reached?.flatMap((key) => storyStep(e, key, 'past') ?? []).join(' → ');
      const now = outcome || e.complete ? `Settled${ending ? `: ${ending}` : ''}` : next[0];
      return { matched, open, past, next, now, outcome };
    };
    const presentedSeeds = new Set([
      ...(l2?.global.receipts ?? []), ...(l2?.all().flatMap(i => i.st.receipts) ?? []),
    ].filter(receipt => receipt.grade !== 'ambient').map(receipt => receipt.seed));
    const possible = new Map<string, PoolEntry[]>();
    for (const e of l3?.state.pool ?? []) {
      if (e.graph?.retired) continue;
      const pattern = storyPattern(e), info = wording.patternInfo(e.pattern), view = storyView(e);
      const presented = e.seed && presentedSeeds.has(e.seed) || e.graph?.seeds?.some(seed => presentedSeeds.has(seed.seed));
      const matchedSteps = e.graph ? view.matched.length : e.stages.length;
      const hasOutcome = e.graph ? !!view.outcome : e.complete;
      if (matchedSteps < 2 && !presented && !hasOutcome) {
        // Entry-only stories have only their entry's location. State entries fall
        // back to a bound actor's recorded region, then the simulated district.
        const entryFillers = (pattern?.entry ?? view.matched.map(([key]) => key)).flatMap(key => e.graph?.junctures[key]?.filler ?? []).sort((a, b) => a.at - b.at);
        const entryEvents = entryFillers.flatMap(f => f.ref && 'event' in f.ref ? [f.id] : f.causes ?? []);
        const place = [...entryEvents, ...e.stages.slice(0, 1).map(stage => stage.event)].map(id => events.get(id)?.place).find(Boolean)
          ?? Object.values(e.bindings).map(id => ownerRegion(id)).find(Boolean)
          ?? sim.w.districts.find(d => d.simulated)?.id;
        if (place) possible.set(place, [...(possible.get(place) ?? []), e]);
        continue;
      }
      const family = pattern?.family ?? info?.family;
      const kinds: Record<string, string> = { tension: 'a tension', turn: 'a turn', closure: 'a closure', shape: 'a larger shape' };
      const thread = l3?.threadView.find((th) => th.patterns?.includes(e.id) || th.instances.includes(e.id));
      const threadEntries = thread && [...new Set([...(thread.patterns ?? []), ...thread.instances])].flatMap((id) => l3?.state.pool.find((e) => e.id === id) ?? []).sort((a, b) => a.firstTime - b.firstTime || a.seq - b.seq);
      const filler = view.matched.at(-1)?.[1].filler;
      const latest = filler && (filler.ref && 'event' in filler.ref ? filler.id : filler.causes ?? []);
      const title = storyTitle(e), summary = pattern?.summary ?? info?.summary ?? title;
      put('stories', e.id, 'point', placeAnchor(entryPlace(e)), `se:inst:${e.id}`, {
        glyph: storyGlyph(family), ...(view.outcome || e.complete ? { badge: 'done' } : view.open.length ? { badge: 'ready' } : view.matched.length ? { badge: 'matched' } : {}),
        label: title, detail: proseDetail(summary, latest, view.now), facets: {
          ...(view.now ? { now: view.now } : {}), ...(view.past.length ? { 'so far': view.past.join(' → ') } : {}),
          ...(view.next.length > 1 ? { 'could go': view.next.slice(1).join(' · ') } : {}), ...(family ? { kind: kinds[family] } : {}),
          ...(threadEntries && threadEntries.length > 1 ? { thread: storyTitle(threadEntries[0]) } : {}),
        },
      });
      for (const [role, id] of Object.entries(e.bindings)) if (actorLayers.has(id) || groupIds.has(id)) {
        const note = (info?.roles as Record<string, { note?: string }> | undefined)?.[role]?.note;
        // Use the library's plain role note, excluding its explanatory clause.
        const type = note?.split(/[:;,]/)[0];
        if (type && !/[?`]/.test(type)) relation('stories', `role-${e.id}-${encodeURIComponent(role)}`, `story-engine/stories/${e.id}`, endpoint(id), type, `se:inst:${e.id}`);
      }
    }
    for (const [place, entries] of possible) {
      const counts = new Map<string, number>();
      for (const e of entries) {
        const prefix = storyTitle(e).split(':')[0];
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
      const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const others = ranked.slice(3).reduce((sum, [, n]) => sum + n, 0);
      const kinds = [...ranked.slice(0, 3).map(([title, n]) => `${title} ${n}`), ...(others ? [`others ${others}`] : [])].join(' · ');
      const label = entries.length === 1 ? "1 possible story here" : `${entries.length} possible stories here`;
      const titles = [...entries].sort((a, b) => b.firstTime - a.firstTime || b.seq - a.seq || a.id.localeCompare(b.id)).slice(0, 20).map(storyTitle);
      const detail = [label];
      for (const title of titles) { if (detail.join('\n').length + title.length + 1 > 4000) break; detail.push(title); }
      put('possible-stories', place, 'point', placeAnchor(place), `se:node:${place}`, {
        glyph: storyGlyph('tension'), label, detail: detail.join('\n'), facets: {
          kinds, about: 'Stories that have only just begun. They show on the map once they develop.',
        },
      });
    }
    const directorLog = this.options.directorLog ?? l3?.log ?? [];
    // A drained sink restarts seq each window. Keep its recorded clock and local
    // sequence together; never mutate/resequence the engine's diagnostic entries.
    const logId = (log: LogEntry) => this.options.directorLog ? `${log.at.game}-${log.at.playTotal}-${log.seq}` : String(log.seq);
    for (const log of directorLog) {
      if (log.kind !== 'sow') continue;
      const data = log.data, scores = (Array.isArray(data.scores) ? data.scores : []) as Array<Candidate & { score?: number }>;
      const request = data.request as { localName?: string } | undefined;
      const c = scores.find((c) => request?.localName && c.key.startsWith(request.localName)) ?? scores.find((c) => c.entry === data.entry);
      const e = l3?.state.pool.find((e) => e.id === (c?.entry ?? data.entry)) ?? l3?.state.pool.find((e) => e.pattern === data.pattern);
      const title = e ? storyTitle(e) : undefined;
      const current = e && c?.juncture ? storyStep(e, c.juncture, 'past') : undefined;
      const held = log.rule !== 'sow';
      const decision = held ? wording.phrase('director-held', { reason: wording.reason(log.rule) }) : c?.kind === 'surface' ? wording.phrase('director-surface', { story: title ?? 'a story' }) : c?.kind === 'realise' ? wording.phrase('director-realise', { step: current ?? title ?? 'a story step' }) : c?.kind === 'explain' ? wording.phrase('director-explain', { story: title ?? 'a story' }) : wording.phrase('director-told', { story: title ?? 'a story' });
      const values = scores.flatMap((c) => typeof c.score === 'number' ? [c.score] : []), lo = Math.min(...values), hi = Math.max(...values);
      const score = typeof c?.score === 'number' ? hi === lo ? 'medium' : c.score < lo + (hi - lo) / 3 ? 'low' : c.score < lo + (hi - lo) * 2 / 3 ? 'medium' : 'high' : undefined;
      put('director', logId(log), 'target', placeAnchor(c?.place ?? (e ? entryPlace(e) : events.get(log.chain[0])?.place)), `se:sow:${logId(log)}`, {
        glyph: decisionGlyph(c?.kind, held), t: log.at.game + this.epoch, label: decision, detail: proseDetail(decision, log.chain.at(-1)), facets: {
          decision, ...(title ? { story: title } : {}), ...(!held ? { checks: 'passed' } : {}), ...(score ? { score } : {}),
        },
      });
    }
    const holds = new Map<string, { log: LogEntry; until?: number }>(), activeHolds = new Map<string, string>(), cleared: Retraction[] = [];
    for (const log of directorLog) if (log.kind === 'hold' && typeof log.data.delivery === 'string') {
      const delivery = log.data.delivery;
      if (log.rule === 'hold-cleared') {
        const seq = activeHolds.get(delivery), held = seq !== undefined ? holds.get(seq) : undefined;
        if (held) {
          held.until = log.at.game + this.epoch;
          cleared.push({ retract: `hold-${logId(held.log)}`, t: held.until });
        }
        activeHolds.delete(delivery);
      } else { holds.set(logId(log), { log }); activeHolds.set(delivery, logId(log)); }
    }
    for (const { log, until } of holds.values()) {
      // A previously shown hold ends through its explicit retraction. Only an
      // unseen, already-closed hold needs a historical bounded appearance.
      if (until !== undefined && (this.stops.has(`${branch ?? ''}/director/hold-${logId(log)}`) || this.stops.has(`/director/hold-${logId(log)}`))) continue;
      const delivery = log.data.delivery as string;
      const inst = l2?.all().find((i) => i.st.deliveries.some((d) => d.id === delivery));
      const entry = inst && l3?.state.pool.find((e) => e.seed === inst.id);
      const place = entry ? entryPlace(entry) : inst && [...inst.st.receipts].reverse().find((r) => r.cue.place)?.cue.place;
      const decision = wording.phrase('director-held', { reason: wording.reason(String(log.data.reason ?? log.rule)) });
      put('director', `hold-${logId(log)}`, 'target', placeAnchor(place), `se:sow:${logId(log)}`, { glyph: 'held', t: log.at.game + this.epoch, ...(until !== undefined ? { until } : {}), label: decision, detail: proseDetail(decision, log.chain.at(-1)), facets: { decision, ...(entry ? { story: storyTitle(entry) } : {}) } });
    }
    for (const [group, against] of Object.entries(gd?.against ?? {})) if (against) {
      const type = against.rung === 'hunt' ? 'hunting' : against.rung === 'price' ? 'warned' : 'watching';
      const cause = events.get(against.cause);
      relation('intentions', against.id, endpoint(group), endpoint(against.target), type, `se:node:${against.id}`, { stage: type, warned: against.warned ? 'yes' : 'no', ...(cause ? { why: eventSentence(cause) + '.' } : {}) });
    }
    for (const inst of l2?.all() ?? []) {
      if (['resolved', 'withdrawn', 'withered'].includes(inst.st.state)) continue;
      const deliveries = inst.st.deliveries.filter((d) => ['queued', 'released', 'displayed'].includes(d.state));
      const placeRole = Object.keys(inst.st.document.roles).find((r) => { const id = inst.st.roles[r]?.cast; return id && (sim.w.index.cells[id] || sim.w.index.districts[id]); });
      const place = [...inst.st.receipts].reverse().find((r) => r.cue.place)?.cue.place ?? (placeRole ? inst.st.roles[placeRole]?.cast : undefined);
      const e = l3?.state.pool.find((e) => e.seed === inst.id || e.graph?.seeds?.some((s) => s.seed === inst.id) || inst.st.document.realises?.some((r) => r.pattern === e.pattern && Object.entries(r.binds).every(([variable, role]) => e.bindings[variable] === (role === 'v' ? sim.w.v : inst.st.roles[role]?.cast))));
      const title = e ? storyTitle(e) : 'a story';
      put('placement', inst.id, 'target', placeAnchor(place), `se:seed:${inst.id}`, { label: wording.phrase('placement', { story: title }), facets: { stage: wording.words(deliveries.at(-1)?.what ?? inst.st.state)!, staging: inst.st.document.purpose.sentence } });
    }
    const truncations = new Map<string, Map<string, number>>();
    const possibleIds = new Set(layers.get('possible-stories')!.map(item => `${branch ?? ''}/possible-stories/${item.id}`));
    for (const id of this.stops.keys()) if (id.startsWith(`${branch ?? ''}/possible-stories/`) && !possibleIds.has(id)) this.stops.delete(id);
    for (const [layer, items] of layers) for (const item of items) {
      // Layer stepping follows story beats, not changing internal scores,
      // readiness timestamps or the arrival of a better name for an old event.
      if (layer === 'stories' && item.kind === 'point' || layer === 'possible-stories' || layer === 'events' || layer === 'director') {
        const e = layer === 'stories' ? l3?.state.pool.find((e) => e.id === item.id) : undefined;
        const key = layer === 'possible-stories' ? JSON.stringify([item.label, item.facets?.kinds]) : e ? JSON.stringify({ matches: Object.entries(e.graph?.junctures ?? {}).filter(([, j]) => ['matched', 'refined'].includes(j.state)).map(([k, j]) => [k, j.filler?.id]).sort(), outcome: e.graph?.outcome?.name, complete: e.complete, next: storyView(e).open.map(([key]) => key).sort() }) : item.id;
        const id = `${branch ?? ''}/${layer}/${item.id}`, prior = this.stops.get(id);
        if (prior?.key === key) {
          for (const field of Object.keys(item) as Array<keyof Item>) delete (item as Partial<Item>)[field];
          Object.assign(item, structuredClone(prior.item));
        }
        else this.stops.set(id, { key, item: structuredClone(item) });
      }
      const n = boundText(item);
      if (n) { if (!truncations.has(layer)) truncations.set(layer, new Map()); truncations.get(layer)!.set(item.id, n); }
    }
    return structuredClone({ t, ...(branch ? { branch } : {}), layers, truncations, ...(cleared.length ? { retractions: new Map([['director', cleared]]) } : {}) });
  }
}
