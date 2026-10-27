import { hrec } from '../canon.ts';
import { H, memberId, s } from '../id.ts';
import { makeKabukiSlice, districtIdOf } from '../sim/slices.ts';
import type { CellIndex } from '../sim/index-types.ts';
import type { Per4 } from '../sim/data.ts';
import { periodStart, periodSpans, spanOverlap, type PeriodRule } from './periods.ts';
import { areaMm2 as area, cellAtMm as cellAt, centreMm as centre, clipMm as clip, footprintMm2 as footprint,
  overlapsXYMm as overlapsXY, squaredDistanceMm as squaredDistance, GRID_MM, quantiseVolume, quantiseXYZ, metresXYZ, metresVolume } from './geometry.ts';
import { COVERAGE_KINDS, OTHER_KINDS, PLACE_NAMES, SERVICE_KINDS, VENDOR_SERVICE_TYPES } from './poi-kinds.ts';
import type { CellGeometry, ImportedWorldIndex, W1Content, W1Pack, Volume } from './types.ts';

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const cmpDistance = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort(cmp).map((k) => [k, v[k]]));
  return v;
}, 2) + '\n';
const digest = (value: object): string => H(s('world-index'), hrec(value as Record<string, unknown>));
const count = (table: Record<string, number>, key: string, amount = 1) => {
  Object.defineProperty(table, key, { value: (Object.hasOwn(table, key) ? table[key] : 0) + amount, writable: true, enumerable: true, configurable: true });
};
const affiliation = (r: W1Content['records'][string]): string | undefined => {
  const name = r.affiliationName?.replace(/^Factions\./, '');
  return name === 'Civilian' || name === 'Unaffiliated' ? 'civilian' : name === 'NCPD' ? 'ncpd' : name;
};
export interface ImportReport {
  schema: 'xf.s1-world-import-report@1'; indexHash: string; lineage: string;
  cells: Array<{ id: string; key: string; name: string; area: number; residents: number; spots: number; personLinks: number;
    presenceFloor: boolean; presenceTop3: Array<[string, number]>; pop: Per4; services: number; market: boolean; host?: string; components: number;
    droppedServices: number; coverage: Record<string, number>; standInTemplate: string }>;
  templates: { block: { name: string; id: string; rule: string }; venue: { name: string; id: string; rule: string } };
  geometry: { districtAreaM2: number; retainedBlockAreaM2: number; areaDeltaM2: number };
  population: { census: number; roundedHeadcount: number; roundingDelta: number;
    standInPopTotals: Per4; popTarget: number; popMean: number };
  affiliations: { census: Array<{ aff: string; q: number }>; personEntries: Record<string, number>; personSpotLinks: Record<string, number> };
  periods: { reader: string | null; names: Array<{ name: string; count: number; start: number | null; rule: PeriodRule }>;
    unknownNames: Record<string, number>; quantities: { stated: number; absent: number; explicitZero: number };
    phases: Array<{ community: string; entry: string; phase: string; ordinal: number; mode: 'all-day' | 'single-period' | 'multi-period'; allDay: boolean }> };
  counts: Record<string, number>; unknownPoiKinds: Record<string, number>; assumptions: Array<{ source: 'stand-in' | 'derived'; field: string; rule: string }>;
}

/** Reject malformed/unbounded input before any join, including period metadata. */
export function validateInputs(pack: W1Pack, content: W1Content): void {
  const fail = (why: string): never => { throw Error(`W1 import refused: ${why}`); };
  if (pack?.schema !== 'xfh/world-pack-1' || !Array.isArray(pack.areas) || pack.areas.length > 10000) fail('world pack schema/areas');
  if (content?.schema !== 'xfh/world-content-1' || content.slice?.id !== 'kabuki' || !Array.isArray(content.slice.places) ||
    !content.slice.places.includes('Districts.Kabuki') || !content.records || typeof content.records !== 'object' || Array.isArray(content.records)) fail('Kabuki content schema/records');
  for (const a of pack.areas) if (!a || typeof a.id !== 'string' || typeof a.kind !== 'string' || !Array.isArray(a.poly) || a.poly.length < 3 || a.poly.length > 4096 ||
    a.poly.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) || !Number.isFinite(a.zlo) || !Number.isFinite(a.zhi) || a.zlo > a.zhi) fail('invalid area');
  for (const collection of [content.communities, content.spots, content.pois, content.spawners]) if (!Array.isArray(collection)) fail('missing collection');
  if (content.communities.length + content.spots.length + content.pois.length + content.spawners.length > 50000 || Object.keys(content.records).length > 50000) fail('collection cap');
  for (const r of Object.values(content.records)) if (!r || !['person', 'vehicle', 'other'].includes(r.kind) || r.affiliationName !== undefined && typeof r.affiliationName !== 'string') fail('invalid record');
  let nested = 0, links = 0;
  const ids = new Set<string>();
  for (const spot of content.spots) {
    if (!spot || typeof spot.id !== 'string' || ids.has(spot.id) || !Array.isArray(spot.at) || spot.at.length !== 3 || !spot.at.every(Number.isFinite) || !Array.isArray(spot.communities) || spot.communities.some((id) => typeof id !== 'string')) fail('invalid/duplicate spot');
    ids.add(spot.id); links += spot.communities.length;
  }
  ids.clear();
  for (const c of content.communities) {
    if (!c || typeof c.id !== 'string' || ids.has(c.id) || !Array.isArray(c.entries)) fail('invalid/duplicate community');
    ids.add(c.id); nested += c.entries.length;
    if (c.registry !== undefined && (!c.registry || typeof c.registry.id !== 'string' || !c.registry.id ||
      typeof c.registry.sourceObjectId !== 'string' || !c.registry.sourceObjectId)) fail('invalid registry');
    const entries = new Set<string>();
    for (const e of c.entries) {
      if (!e || typeof e.name !== 'string' || entries.has(e.name) || e.record !== undefined && typeof e.record !== 'string' || !Array.isArray(e.phases)) fail('invalid/duplicate entry');
      entries.add(e.name); nested += e.phases.length;
      for (const p of e.phases) {
        if (!p || typeof p.name !== 'string' || !Array.isArray(p.spots) || p.spots.some((id) => typeof id !== 'string')) fail('invalid phase');
        links += p.spots.length;
        if (p.periods !== undefined) {
          if (!Array.isArray(p.periods)) fail('invalid periods');
          nested += p.periods.length;
          if (nested > 100000) fail('nested cap');
          for (const period of p.periods) {
            if (!period || typeof period.name !== 'string' || !Array.isArray(period.spots) || period.spots.some((id) => typeof id !== 'string') ||
              period.quantity !== undefined && (!Number.isInteger(period.quantity) || period.quantity < 0 || period.quantity > 65535)) fail('invalid period');
            links += period.spots.length;
            if (links > 200000) fail('link cap');
          }
          if (p.periods.length) {
            const union = new Set(p.periods.flatMap((period) => period.spots)), phaseSpots = new Set(p.spots);
            if (union.size !== phaseSpots.size || [...union].some((spot) => !phaseSpots.has(spot))) fail('period spots differ from phase union');
          }
        }
        if (links > 200000) fail('link cap');
      }
      if (nested > 100000) fail('nested cap');
    }
  }
  if (links > 200000) fail('link cap');
  ids.clear();
  for (const p of content.pois) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id) || typeof p.kind !== 'string' || !Array.isArray(p.at) || p.at.length !== 3 || !p.at.every(Number.isFinite)) fail('invalid/duplicate POI');
    ids.add(p.id);
  }
}

export function importW1(sourcePack: W1Pack, sourceContent: W1Content): { index: ImportedWorldIndex; report: ImportReport } {
  validateInputs(sourcePack, sourceContent);
  // Quantise once before any geometric operation. Work geometry, poses, grid
  // lines, intersections and centres remain integer mm until the output projection.
  const pack: W1Pack = {...sourcePack, areas: sourcePack.areas.map((a)=>({...a,...quantiseVolume(a)}))};
  const content: W1Content = {...sourceContent, spots: sourceContent.spots.map((p)=>({...p,at:quantiseXYZ(p.at)})),
    pois: sourceContent.pois.map((p)=>({...p,at:quantiseXYZ(p.at)}))};
  for(const a of pack.areas) if(a.poly.length<3||area(a.poly)<=0) throw Error('W1 import refused: invalid area after mm quantisation');
  const base = makeKabukiSlice(), district = base.districts[districtIdOf('wat_kab')];
  // Capture the stand-in's presence scale before replacing its district cells.
  // Population present is independent of the residential census/headcount.
  const standInPopTotals = [0,1,2,3].map((p) => district.cellIds.reduce((n,id) => n + base.cells[id].pop[p], 0)) as Per4;
  const popTarget = standInPopTotals.reduce((n,total) => n + total, 0) / 4;
  const outlines = pack.areas.filter((a) => a.id === 'Districts.Kabuki');
  if (outlines.length !== 1) throw Error('W1 import requires one Kabuki district outline');
  const outline = outlines[0], districtArea = area(outline.poly);
  const shapes: CellGeometry[] = [];
  const venues = new Map<string, Volume[]>();
  for (const a of pack.areas.filter((a) => a.kind === 'venue' && content.slice.places.includes(a.id))) {
    const v = { poly: structuredClone(a.poly), zlo: a.zlo, zhi: a.zhi };
    const list = venues.get(a.id) ?? []; list.push(v); venues.set(a.id, list);
  }
  for (const [place, volumes] of [...venues].sort(([a], [b]) => cmp(a, b))) {
    volumes.sort((a, b) => cmp(stableJson(a), stableJson(b)));
    const name = PLACE_NAMES[place] ?? pack.areas.find((a) => a.id === place)?.name;
    if (!name || /^LocKey#/.test(name)) throw Error(`Venue ${place} needs a readable name`);
    shapes.push({ key: `venue:${place}`, place, name, volumes, area: footprint(volumes), centre: centre(volumes) });
  }
  const xs = outline.poly.map((p) => p[0]), ys = outline.poly.map((p) => p[1]);
  const gxlo = Math.floor(Math.min(...xs) / GRID_MM), gxhi = Math.ceil(Math.max(...xs) / GRID_MM);
  const gylo = Math.floor(Math.min(...ys) / GRID_MM), gyhi = Math.ceil(Math.max(...ys) / GRID_MM);
  if ((gxhi - gxlo) * (gyhi - gylo) > 10000) throw Error('Grid candidate cap exceeded');
  for (let gx = gxlo; gx < gxhi; gx++) for (let gy = gylo; gy < gyhi; gy++) {
    const polygons = clip(outline.poly, gx * GRID_MM, gy * GRID_MM, (gx + 1) * GRID_MM, (gy + 1) * GRID_MM), a = polygons.reduce((n,p)=>n+area(p),0);
    if (a <= 0) continue;
    const volumes = polygons.map((poly)=>({ poly, zlo: outline.zlo, zhi: outline.zhi }));
    shapes.push({ key: `grid:${gx},${gy}`, grid: [gx, gy], name: `Kabuki, block ${shapes.length + 1}`, volumes, area: a, centre: centre(volumes) });
  }
  if (shapes.length > 255) throw Error('S1 cell cap exceeded (255)');
  const cellIds = shapes.map((_, i) => memberId(district.id, 'cells', i));
  const geometry = Object.fromEntries(cellIds.map((id, i) => [id, shapes[i]]));
  const blocks = shapes.filter((g) => g.grid), meanFloor = 0.01;
  const retainedBlockArea = blocks.reduce((n, g) => n + g.area, 0);
  if (retainedBlockArea <= 0) throw Error('W1 import requires positive retained block area');
  const counts: Record<string, number> = {
    records: Object.keys(content.records).length,
    personRecords: Object.values(content.records).filter((r) => r.kind === 'person').length,
    vehicleRecords: Object.values(content.records).filter((r) => r.kind === 'vehicle').length,
    unknownRecords: Object.values(content.records).filter((r) => r.kind === 'other').length,
    communities: content.communities.length, entries: 0, spots: content.spots.length, spawnersUnused: content.spawners.length, pois: content.pois.length,
    phases: 0, phaseSpotLinks: 0, duplicatePhaseSpotLinks: 0,
    bindingTuples: 0, spotsInMultipleCommunities: 0, spotsInNoCommunity: 0, entriesWithNoSpots: 0, missingSpotLinks: 0,
    unknownEntries: 0, personEntries: 0, vehicleEntries: 0, personEntriesWithoutAffiliation: 0,
    nonPersonSpotLinks: 0, unknownPersonSpotLinks: 0, spotsOutsideCells: 0, poisOutsideCells: 0,
    servicesKept: 0, servicesDroppedCap: 0, coveragePois: 0, otherPois: 0, unknownPois: 0,
    fallbackCommunityIds: 0, fallbackSpotIds: 0, fallbackPoiIds: 0, floorBlocks: 0,
  };
  const weights = Object.fromEntries(cellIds.map((id) => [id, {} as Record<string, number>]));
  const popWeights = Object.fromEntries(cellIds.map((id) => [id, [0,0,0,0] as Per4]));
  const personLinkCounts: Record<string, number> = {};
  const periodNames: Record<string, number> = {};
  const periods: ImportReport['periods'] = { reader: sourceContent.source?.reader ?? null, names: [], unknownNames: {},
    quantities: { stated: 0, absent: 0, explicitZero: 0 }, phases: [] };
  const bindings = Object.fromEntries(cellIds.map((id) => [id, [] as ImportedWorldIndex['worldImport']['bindings'][string]]));
  const spotCells = new Map<string, string>(), memberships = new Map<string, Set<string>>();
  const spotCounts: Record<string, number> = {};
  for (const spot of [...content.spots].sort((a, b) => cmp(a.id, b.id))) {
    if (spot.id.includes(':')) counts.fallbackSpotIds++;
    const cell = cellAt(geometry, spot.at);
    memberships.set(spot.id, new Set());
    if (cell) { spotCells.set(spot.id, cell); count(spotCounts, cell); } else counts.spotsOutsideCells++;
  }
  const personEntries: Record<string, number> = {}, personSpotLinks: Record<string, number> = {};
  for (const c of [...content.communities].sort((a, b) => cmp(a.id, b.id))) {
    if (c.id.includes(':')) counts.fallbackCommunityIds++;
    for (const entry of [...c.entries].sort((a, b) => cmp(a.name, b.name))) {
      counts.entries++;
      const record = entry.record ? content.records[entry.record] : undefined;
      const person = record?.kind === 'person', aff = person ? affiliation(record) : undefined;
      if (person) { counts.personEntries++; count(personEntries, aff ?? 'unknown'); if (!aff) counts.personEntriesWithoutAffiliation++; }
      else if (record?.kind === 'vehicle') counts.vehicleEntries++; else counts.unknownEntries++;
      const spots = [...new Set(entry.phases.flatMap((p) => p.spots))].sort(cmp);
      counts.phases += entry.phases.length;
      const phaseLinks = entry.phases.reduce((n, p) => n + p.spots.length, 0);
      counts.phaseSpotLinks += phaseLinks; counts.duplicatePhaseSpotLinks += phaseLinks - spots.length;
      if (!spots.length) counts.entriesWithNoSpots++;
      // Preserve v0's distinct-link fallback for legacy phases without periods.
      // Explicit period rows (including zero quantity) never enter that fallback.
      const legacySpots = new Set<string>();
      for (const [ordinal, phase] of entry.phases.entries()) {
        const spans = periodSpans(phase.periods ?? []);
        periods.phases.push({ community: c.id, entry: entry.name, phase: phase.name, ordinal,
          mode: !spans.length || spans.every((p) => periodStart(p.period.name).rule === 'unknown') ? 'all-day' : spans.length === 1 ? 'single-period' : 'multi-period',
          allDay: !spans.length || spans.every((p) => p.minutes === 1440) });
        if (!spans.length) phase.spots.forEach((spot) => legacySpots.add(spot));
        for (const span of spans) {
          const p = span.period;
          count(periodNames, p.name);
          if (periodStart(p.name).rule === 'unknown') count(periods.unknownNames, p.name);
          if (p.quantity === undefined) periods.quantities.absent++;
          else { periods.quantities.stated++; if (p.quantity === 0) periods.quantities.explicitZero++; }
          if (!person || !aff) continue;
          const overlap = spanOverlap(span), weight = p.quantity ?? 1;
          for (const spot of [...new Set(p.spots)].sort(cmp)) {
            const cell = spotCells.get(spot);
            if (!cell) continue;
            for (let i = 0; i < 4; i++) popWeights[cell][i] += weight * overlap[i];
            // Presence is one duration/quantity-weighted share over all spans.
            count(weights[cell], aff, weight * span.minutes / 1440);
          }
        }
      }
      for (const spot of [...legacySpots].sort(cmp)) {
        const cell = spotCells.get(spot);
        if (!cell || !person || !aff) continue;
        for (let i = 0; i < 4; i++) popWeights[cell][i]++;
        count(weights[cell], aff);
      }
      for (const spot of spots) {
        const membership = memberships.get(spot);
        if (!membership) { counts.missingSpotLinks++; continue; }
        membership.add(c.id);
        const cell = spotCells.get(spot);
        if (!cell) continue;
        bindings[cell].push({ community: c.id, ...(c.registry ? { registry: { ...c.registry } } : {}), entry: entry.name, spot }); counts.bindingTuples++;
        if (!person) { counts.nonPersonSpotLinks++; continue; }
        if (!aff) { counts.unknownPersonSpotLinks++; continue; }
        count(personLinkCounts, cell); count(personSpotLinks, aff);
      }
    }
  }
  periods.names = Object.keys(periodNames).sort(cmp).map((name) => ({ name, count: periodNames[name], ...periodStart(name) }));
  for (const set of memberships.values()) { if (!set.size) counts.spotsInNoCommunity++; else if (set.size > 1) counts.spotsInMultipleCommunities++; }
  const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
  const raw = Object.fromEntries(cellIds.map((id) => [id, popWeights[id].reduce((n,w) => n+w,0) / 4]));
  const floor = (blocks.reduce((n, g) => n + raw[cellIds[shapes.indexOf(g)]], 0) / blocks.length || 1) * meanFloor;
  const censusShares = Object.fromEntries(district.entry.byAff.map((a) => [a.aff, a.q / district.entry.total]));
  for (const id of cellIds) {
    if (!personLinkCounts[id] && geometry[id].grid) { raw[id] = floor; popWeights[id] = [floor,floor,floor,floor]; counts.floorBlocks++; }
  }
  const totalWeight = sum(raw);
  if (!(totalWeight > 0)) throw Error('W1 import refused: no positive population weight to normalise');
  const coverage = Object.fromEntries(cellIds.map((id) => [id, {} as Record<string, number>]));
  const candidates = Object.fromEntries(cellIds.map((id) => [id, [] as Array<{ id: string; type: string; distance: bigint }> ]));
  const unknownPoiKinds: Record<string, number> = {};
  for (const poi of [...content.pois].sort((a, b) => cmp(a.id, b.id))) {
    if (poi.id.includes(':')) counts.fallbackPoiIds++;
    const cell = cellAt(geometry, poi.at);
    if (!cell) { counts.poisOutsideCells++; continue; }
    if (Object.hasOwn(SERVICE_KINDS, poi.kind)) {
      candidates[cell].push({ id: poi.id, type: SERVICE_KINDS[poi.kind], distance: squaredDistance(poi.at,geometry[cell].centre) });
    } else if (COVERAGE_KINDS.has(poi.kind)) { count(coverage[cell], poi.kind); counts.coveragePois++; }
    else if (OTHER_KINDS.has(poi.kind)) counts.otherPois++;
    else { count(unknownPoiKinds, poi.kind); counts.unknownPois++; }
  }
  // Declared shared priors, not a projection of the stand-in's arbitrary map.
  const templates: ImportReport['templates'] = {
    block: { name: 'g4', id: base.names!.g4, rule: 'Median headShare among public, service-free, non-market residential cells without coverage reductions.' },
    venue: { name: 'v5', id: base.names!.v5, rule: 'First non-market stand-in venue in fixture order.' },
  };
  const cells: ImportedWorldIndex['cells'] = {}, rows: ImportReport['cells'] = [];
  let allocatedHeadShare = 0;
  for (const id of cellIds) {
    const g = geometry[id], template = base.cells[g.grid ? templates.block.id : templates.venue.id];
    const c: CellIndex = structuredClone(template);
    c.id = id; c.district = district.id; c.kind = g.grid ? 'grid' : 'venue'; delete c.host;
    c.headShare = 0;
    if (g.grid) {
      // Rounded clip intersections can change the total area. Normalise by
      // retained blocks; the final block absorbs only floating-point residue.
      c.headShare = g === blocks[blocks.length - 1] ? 1 - allocatedHeadShare : g.area / retainedBlockArea;
      allocatedHeadShare += c.headShare;
    }
    c.pop = popWeights[id].map((weight) => popTarget * weight / totalWeight) as Per4;
    const n = sum(weights[id]);
    c.presence = n ? Object.fromEntries(Object.keys(weights[id]).sort(cmp).map((aff) => [aff, weights[id][aff] / n])) : { ...censusShares };
    c.adj1 = []; c.adj2 = [];
    for (const other of cellIds) {
      if (id === other) continue;
      const h = geometry[other];
      if (g.grid && h.grid) {
        const dx = Math.abs(g.grid[0] - h.grid[0]), dy = Math.abs(g.grid[1] - h.grid[1]);
        if (dx + dy === 1) c.adj1.push(other);
        else if (dx === 1 && dy === 1) c.adj2.push(other);
      } else if (!!g.grid !== !!h.grid) {
        const block = g.grid ? g : h, venue = g.place ? g : h;
        if (overlapsXY(venue.volumes, block.volumes)) c.adj1.push(other);
      }
    }
    c.adj1.sort(cmp); c.adj2.sort(cmp);
    if (g.place) {
      c.host = c.adj1.filter((other) => geometry[other].grid).sort((a, b) => {
        const distance = (key: string) => squaredDistance(geometry[key].centre,g.centre);
        return cmpDistance(distance(a), distance(b)) || cmp(a, b);
      })[0];
      if (!c.host) throw Error(`Venue ${g.place} overlaps no retained block`);
    }
    const services = candidates[id].sort((a, b) => cmpDistance(a.distance, b.distance) || cmp(a.id, b.id));
    c.services = services.slice(0, 15).map((p, i) => ({ id: memberId(id, 'services', i), type: p.type, poi: p.id }));
    c.marketCell = c.services.some((service)=>VENDOR_SERVICE_TYPES.has(service.type));
    c.gameCoverage = Object.fromEntries(Object.keys(c.gameCoverage).map((kind)=>[kind,0]));
    const droppedServices = Math.max(0, services.length - 15);
    counts.servicesKept += c.services.length; counts.servicesDroppedCap += droppedServices;
    cells[id] = c;
    rows.push({ id, key: g.key, name: g.name, area: g.area / 1_000_000, residents: Math.round(district.rho * district.entry.total * c.headShare),
      spots: spotCounts[id] ?? 0, personLinks: personLinkCounts[id] ?? 0, presenceFloor: !personLinkCounts[id] && !!g.grid, pop: [...c.pop],
      presenceTop3: Object.entries(c.presence).sort(([a, x], [b, y]) => y - x || cmp(a, b)).slice(0, 3),
      services: c.services.length, market: c.marketCell, ...(c.host ? {host:geometry[c.host].key}:{}), components:g.volumes.length,
      droppedServices, coverage: coverage[id], standInTemplate: template.id });
  }
  // Serialisation projection: world-index consumers keep their metre contract.
  const outputGeometry = Object.fromEntries(Object.entries(geometry).map(([id,g])=>[id,{
    ...g,volumes:g.volumes.map(metresVolume),centre:metresXYZ(g.centre),area:g.area/1_000_000,
  }]));
  district.cellIds = cellIds; district.polygon = outline.poly.map(([x,y])=>[x/1000,y/1000]); district.zBand = [outline.zlo/1000, outline.zhi/1000];
  district.staticTotalA = Object.fromEntries(Object.keys(district.staticTotalA).map((kind) => [kind,
    [0, 1, 2, 3].map((p) => cellIds.reduce((n, id) => n + cells[id].A[kind][p], 0)) as [number, number, number, number]]));
  const index: ImportedWorldIndex = {
    ...base, version: 'xf.kabuki.w1.index@1', cells,
    names: { wat_kab: district.id, wat_nor: districtIdOf('wat_nor'), wat_lch: districtIdOf('wat_lch'), ...Object.fromEntries(cellIds.map((id) => [geometry[id].key, id])) },
    worldImport: { schema: 'xf.s1-world-import@1', gridMetres: 200, coordinateQuantisationMm: 1, sources: { pack: digest(sourcePack), content: digest(sourceContent) },
      districtPlaces: { [district.id]: 'Districts.Kabuki', [districtIdOf('wat_nor')]: 'Districts.Northside', [districtIdOf('wat_lch')]: 'Districts.LittleChina' },
      geometry: outputGeometry, bindings, gameCoverageEvidence: coverage },
  };
  const { hash: _hash, ...hashed } = index; index.hash = digest(hashed);
  const roundedHeadcount = rows.reduce((n, r) => n + r.residents, 0);
  const report: ImportReport = {
    schema: 'xf.s1-world-import-report@1', indexHash: index.hash,
    lineage: 'Different input content or geometry creates a new lineage. Origin-anchored grid keys are stable; ordinal member ids can shift when earlier cells are inserted.',
    cells: rows, templates, periods,
    geometry: { districtAreaM2: districtArea / 1_000_000, retainedBlockAreaM2: retainedBlockArea / 1_000_000,
      areaDeltaM2: (retainedBlockArea - districtArea) / 1_000_000 },
    population: { census: district.entry.total, roundedHeadcount, roundingDelta: roundedHeadcount - district.entry.total,
      standInPopTotals, popTarget, popMean: [0,1,2,3].reduce((n,p) => n + cellIds.reduce((total,id) => total + cells[id].pop[p], 0), 0) / 4 },
    affiliations: { census: district.entry.byAff.map(({ aff, q }) => ({ aff, q })), personEntries, personSpotLinks }, counts, unknownPoiKinds,
    assumptions: [
      { source: 'derived', field: 'geometry', rule: 'Input coordinates quantised once by Math.round(metres * 1000); integer-mm geometry, exact 200000 mm grid, rounded integer-mm clip intersections and reused on-line endpoints. Disconnected simple components stay separate. Areas/orientations use BigInt; venue overlap requires exact intersection area >=1 mm2. Centres round once to mm; squared-distance comparisons use BigInt and id ties. Only the final index/report projection converts back to metres/m2. Venues first by place id, then (gx, gy); all venue volumes/Z bands retained. Venue precedence, then cell order on closed boundaries. Venue area is the XY footprint union; stacked volumes count once.' },
      { source: 'derived', field: 'neighbours', rule: 'Grid edge neighbours, diagonal second neighbours; venues intersect actual clipped block polygons in XY. Geometry only; traversability unknown. Venue host is the nearest genuinely overlapping block centre by fixed-order squared distance, then cell id.' },
      { source: 'derived', field: 'headShare', rule: 'Clipped block area / sum of retained block areas; final block absorbs floating-point share residue so shares sum to exactly 1 in cell order. Report retained-minus-district area separately from per-cell headcount rounding; no subtraction of venue footprints. Venues have zero residents. S1 rounds headcounts per cell and draws households unchanged; realised household membership can differ.' },
      { source: 'derived', field: 'presence/pop', rule: 'Each person-entry period/spot link contributes quantity times span overlap / six hours to S1 windows starting 06:00, 12:00, 18:00, 00:00. Absent quantity means an unexported class default, treated as one unit, not a verified game default; explicit zero contributes nothing. Normalise once to the mean of the four stand-in district pop totals, derived from its original cell pop arrays independently of residential census/headcount (see population.standInPopTotals/popTarget/popMean). Presence has no per-period slot: one quantity/duration-weighted affiliation share over all spans. Exclude vehicle/other/unresolved affiliations; civilian/Unaffiliated merged, NCPD normalized. Alternative phases are summed as potential content, not asserted active. Legacy phases lacking periods use distinct all-day entry/spot links. Blocks without eligible person links get an all-day floor of 1% of mean block weight (mean 1 if all empty); explicit-zero links do not trigger a floor. Empty-weight presence uses census affiliation shares. No simultaneous occupancy claim.' },
      { source: 'derived', field: 'period starts/spans', rule: 'periods.json is an assumption pending an in-game check: Morning 06:00, Day/Noon 12:00, Evening 18:00, Night 22:00, Midnight 00:00; valid _HH_MM labels use that clock time; H:MM AM/PM labels use a 12-hour clock (12:xx AM = 00:xx, 12:xx PM = 12:xx); all other labels run all day. Within each phase, known starts run to the next distinct start, wrapping midnight; duplicate starts share the span; a single start runs all day. Unknowns do not split known spans. Phase modes: absent/empty or all-unknown periods are all-day; otherwise single-period or multi-period by row count. allDay separately records whether every span is 24 hours.' },
      { source: 'derived', field: 'services', rule: 'One plain-kind table; nearest 15 by fixed-order squared 3D distance to footprint-weighted cell centre, ties by POI id. Market only when a retained POI service has a declared retail vendor type. Unknown kinds counted, never guessed. Evidence pins never become services.' },
      { source: 'derived', field: 'binding', rule: 'All linked entry types retained; exact (community placement id, entry name, spot id), deduplicated only across phases of the same entry. Copy registry id and sourceObjectId alongside the placement id when supplied; absent legacy registry metadata is omitted, never invented. Ordinals unavailable; no runtime binding. Fallback ids counted by colon format.' },
      { source: 'derived', field: 'coverage evidence', rule: 'Static counts by original POI kind only, separate from S1 fractional coverage. Calibration remains open.' },
      { source: 'stand-in', field: 'census/recipe', rule: '2964, rho, age, role, income, affiliation, household, tenure and wealth marginals, trust and price anchor unchanged. W1 entry counts compare authored types, not quantities.' },
      { source: 'stand-in', field: 'opportunity/security', rule: 'One named template per kind: block g4, venue v5 (see templates selection rules). Public, A, F and pairs are identical within each kind. Coverage reductions are zero until calibrated; markets come only from POI vendor services. Re-sum district staticTotalA; stub and rest totals unchanged. No claim of measured police/security, propensity, pair hostility or opportunity. S1Data defaults unchanged.' },
      { source: 'derived', field: 'W1 limits', rule: 'Period names/quantities and registry ids are optional for legacy input. W1 w1.7.1 supports them; no census flag, activation/conditions, entry cap or runtime binding is inferred. Records/spawners do not supply a census.' },
    ],
  };
  return { index, report };
}
