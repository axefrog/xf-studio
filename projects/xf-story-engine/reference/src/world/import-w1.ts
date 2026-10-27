import { hrec } from '../canon.ts';
import { H, memberId, s } from '../id.ts';
import { makeKabukiSlice, districtIdOf } from '../sim/slices.ts';
import type { CellIndex } from '../sim/index-types.ts';
import { area, cellAt, centre, clip, footprint } from './geometry.ts';
import { COVERAGE_KINDS, OTHER_KINDS, PLACE_NAMES, SERVICE_KINDS } from './poi-kinds.ts';
import type { CellGeometry, ImportedWorldIndex, W1Content, W1Pack, Volume } from './types.ts';

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort(cmp).map((k) => [k, v[k]]));
  return v;
}, 2) + '\n';
const digest = (value: object): string => H(s('world-index'), hrec(value as Record<string, unknown>));
const count = (table: Record<string, number>, key: string) => {
  Object.defineProperty(table, key, { value: (Object.hasOwn(table, key) ? table[key] : 0) + 1, writable: true, enumerable: true, configurable: true });
};
const affiliation = (r: W1Content['records'][string]): string | undefined => {
  const name = r.affiliationName?.replace(/^Factions\./, '');
  return name === 'Civilian' || name === 'Unaffiliated' ? 'civilian' : name === 'NCPD' ? 'ncpd' : name;
};
export interface ImportReport {
  schema: 'xf.s1-world-import-report@1'; indexHash: string; lineage: string;
  cells: Array<{ id: string; key: string; name: string; area: number; residents: number; spots: number; personLinks: number;
    presenceFloor: boolean; presenceTop3: Array<[string, number]>; services: number; droppedServices: number; coverage: Record<string, number>; standInTemplate: string }>;
  population: { census: number; roundedHeadcount: number; roundingDelta: number };
  affiliations: { census: Array<{ aff: string; q: number }>; personEntries: Record<string, number>; personSpotLinks: Record<string, number> };
  counts: Record<string, number>; unknownPoiKinds: Record<string, number>; assumptions: Array<{ source: 'stand-in' | 'derived'; field: string; rule: string }>;
}

/** Reject malformed/unbounded input before any join. Fields from a future W1
 * revision are deliberately not interpreted until its quantities/periods land. */
export function validateInputs(pack: W1Pack, content: W1Content): void {
  const fail = (why: string): never => { throw Error(`W1 import refused: ${why}`); };
  if (pack?.schema !== 'xfh/world-pack-1' || !Array.isArray(pack.areas) || pack.areas.length > 10000) fail('world pack schema/areas');
  if (content?.schema !== 'xfh/world-content-1' || content.slice?.id !== 'kabuki' || !Array.isArray(content.slice.places) ||
    !content.slice.places.includes('Districts.Kabuki') || !content.records || typeof content.records !== 'object' || Array.isArray(content.records)) fail('Kabuki content schema/records');
  for (const a of pack.areas) if (!a || typeof a.id !== 'string' || typeof a.kind !== 'string' || !Array.isArray(a.poly) || a.poly.length < 3 || a.poly.length > 4096 ||
    a.poly.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) || !Number.isFinite(a.zlo) || !Number.isFinite(a.zhi) || a.zlo > a.zhi || area(a.poly) <= 0) fail('invalid area');
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
    const entries = new Set<string>();
    for (const e of c.entries) {
      if (!e || typeof e.name !== 'string' || entries.has(e.name) || e.record !== undefined && typeof e.record !== 'string' || !Array.isArray(e.phases)) fail('invalid/duplicate entry');
      entries.add(e.name); nested += e.phases.length;
      for (const p of e.phases) {
        if (!p || typeof p.name !== 'string' || !Array.isArray(p.spots) || p.spots.some((id) => typeof id !== 'string')) fail('invalid phase');
        links += p.spots.length;
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

export function importW1(pack: W1Pack, content: W1Content): { index: ImportedWorldIndex; report: ImportReport } {
  validateInputs(pack, content);
  const base = makeKabukiSlice(), district = base.districts[districtIdOf('wat_kab')];
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
  const gxlo = Math.floor(Math.min(...xs) / 200), gxhi = Math.ceil(Math.max(...xs) / 200);
  const gylo = Math.floor(Math.min(...ys) / 200), gyhi = Math.ceil(Math.max(...ys) / 200);
  if ((gxhi - gxlo) * (gyhi - gylo) > 10000) throw Error('Grid candidate cap exceeded');
  for (let gx = gxlo; gx < gxhi; gx++) for (let gy = gylo; gy < gyhi; gy++) {
    const poly = clip(outline.poly, gx * 200, gy * 200, (gx + 1) * 200, (gy + 1) * 200), a = area(poly);
    if (a <= 0) continue;
    const volumes = [{ poly, zlo: outline.zlo, zhi: outline.zhi }];
    shapes.push({ key: `grid:${gx},${gy}`, grid: [gx, gy], name: `Kabuki, block ${shapes.length + 1}`, volumes, area: a, centre: centre(volumes) });
  }
  if (shapes.length > 255) throw Error('S1 cell cap exceeded (255)');
  const cellIds = shapes.map((_, i) => memberId(district.id, 'cells', i));
  const geometry = Object.fromEntries(cellIds.map((id, i) => [id, shapes[i]]));
  const blocks = shapes.filter((g) => g.grid), meanFloor = 0.01;
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
      for (const spot of spots) {
        const membership = memberships.get(spot);
        if (!membership) { counts.missingSpotLinks++; continue; }
        membership.add(c.id);
        const cell = spotCells.get(spot);
        if (!cell) continue;
        bindings[cell].push({ community: c.id, entry: entry.name, spot }); counts.bindingTuples++;
        if (!person) { counts.nonPersonSpotLinks++; continue; }
        if (!aff) { counts.unknownPersonSpotLinks++; continue; }
        count(weights[cell], aff); count(personSpotLinks, aff);
      }
    }
  }
  for (const set of memberships.values()) { if (!set.size) counts.spotsInNoCommunity++; else if (set.size > 1) counts.spotsInMultipleCommunities++; }
  const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
  const raw = Object.fromEntries(cellIds.map((id) => [id, sum(weights[id])]));
  const floor = (blocks.reduce((n, g) => n + raw[cellIds[shapes.indexOf(g)]], 0) / blocks.length || 1) * meanFloor;
  const censusShares = Object.fromEntries(district.entry.byAff.map((a) => [a.aff, a.q / district.entry.total]));
  for (const id of cellIds) {
    if (raw[id] === 0 && geometry[id].grid) { raw[id] = floor; counts.floorBlocks++; }
  }
  const totalWeight = sum(raw);
  const coverage = Object.fromEntries(cellIds.map((id) => [id, {} as Record<string, number>]));
  const candidates = Object.fromEntries(cellIds.map((id) => [id, [] as Array<{ id: string; type: string; distance: number }> ]));
  const unknownPoiKinds: Record<string, number> = {};
  for (const poi of [...content.pois].sort((a, b) => cmp(a.id, b.id))) {
    if (poi.id.includes(':')) counts.fallbackPoiIds++;
    const cell = cellAt(geometry, poi.at);
    if (!cell) { counts.poisOutsideCells++; continue; }
    if (Object.hasOwn(SERVICE_KINDS, poi.kind)) {
      candidates[cell].push({ id: poi.id, type: SERVICE_KINDS[poi.kind], distance: Math.hypot(...poi.at.map((x, i) => x - geometry[cell].centre[i])) });
    } else if (COVERAGE_KINDS.has(poi.kind)) { count(coverage[cell], poi.kind); counts.coveragePois++; }
    else if (OTHER_KINDS.has(poi.kind)) counts.otherPois++;
    else { count(unknownPoiKinds, poi.kind); counts.unknownPois++; }
  }
  const gridTemplates = district.cellIds.map((id) => base.cells[id]).filter((c) => c.kind === 'grid');
  const venueTemplates = district.cellIds.map((id) => base.cells[id]).filter((c) => c.kind === 'venue');
  const cells: ImportedWorldIndex['cells'] = {}, rows: ImportReport['cells'] = [];
  let gridOrdinal = 0, venueOrdinal = 0;
  for (const id of cellIds) {
    const g = geometry[id], templates = g.grid ? gridTemplates : venueTemplates;
    const template = templates[(g.grid ? gridOrdinal++ : venueOrdinal++) % templates.length];
    const c: CellIndex = structuredClone(template);
    c.id = id; c.district = district.id; c.kind = g.grid ? 'grid' : 'venue'; delete c.host;
    c.headShare = g.grid ? g.area / districtArea : 0;
    const pop = totalWeight ? district.entry.total * raw[id] / totalWeight : 0;
    c.pop = [pop, pop, pop, pop];
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
        const grid = (g.grid ?? h.grid)!, venue = g.place ? g : h;
        if (venue.volumes.some((v) => area(clip(v.poly, grid[0] * 200, grid[1] * 200, (grid[0] + 1) * 200, (grid[1] + 1) * 200)) > 0)) c.adj1.push(other);
      }
    }
    c.adj1.sort(cmp); c.adj2.sort(cmp);
    if (g.place) {
      c.host = c.adj1.filter((other) => geometry[other].grid).sort((a, b) => {
        const distance = (key: string) => Math.hypot(...geometry[key].centre.map((x, i) => x - g.centre[i]));
        return distance(a) - distance(b) || cmp(a, b);
      })[0];
      if (!c.host) throw Error(`Venue ${g.place} overlaps no retained block`);
    }
    const services = candidates[id].sort((a, b) => a.distance - b.distance || cmp(a.id, b.id));
    c.services = services.slice(0, 15).map((p, i) => ({ id: memberId(id, 'services', i), type: p.type, poi: p.id }));
    const droppedServices = Math.max(0, services.length - 15);
    counts.servicesKept += c.services.length; counts.servicesDroppedCap += droppedServices;
    cells[id] = c;
    rows.push({ id, key: g.key, name: g.name, area: g.area, residents: Math.round(district.rho * district.entry.total * c.headShare),
      spots: spotCounts[id] ?? 0, personLinks: n, presenceFloor: !n && !!g.grid,
      presenceTop3: Object.entries(c.presence).sort(([a, x], [b, y]) => y - x || cmp(a, b)).slice(0, 3),
      services: c.services.length, droppedServices, coverage: coverage[id], standInTemplate: template.id });
  }
  district.cellIds = cellIds; district.polygon = structuredClone(outline.poly); district.zBand = [outline.zlo, outline.zhi];
  district.staticTotalA = Object.fromEntries(Object.keys(district.staticTotalA).map((kind) => [kind,
    [0, 1, 2, 3].map((p) => cellIds.reduce((n, id) => n + cells[id].A[kind][p], 0)) as [number, number, number, number]]));
  const index: ImportedWorldIndex = {
    ...base, version: 'xf.kabuki.w1.index@1', cells,
    names: { wat_kab: district.id, wat_nor: districtIdOf('wat_nor'), wat_lch: districtIdOf('wat_lch'), ...Object.fromEntries(cellIds.map((id) => [geometry[id].key, id])) },
    worldImport: { schema: 'xf.s1-world-import@1', gridMetres: 200, sources: { pack: digest(pack), content: digest(content) },
      districtPlaces: { [district.id]: 'Districts.Kabuki', [districtIdOf('wat_nor')]: 'Districts.Northside', [districtIdOf('wat_lch')]: 'Districts.LittleChina' },
      geometry, bindings, gameCoverageEvidence: coverage },
  };
  const { hash: _hash, ...hashed } = index; index.hash = digest(hashed);
  const roundedHeadcount = rows.reduce((n, r) => n + r.residents, 0);
  const report: ImportReport = {
    schema: 'xf.s1-world-import-report@1', indexHash: index.hash,
    lineage: 'Different input content or geometry creates a new lineage. Origin-anchored grid keys are stable; ordinal member ids can shift when earlier cells are inserted.',
    cells: rows, population: { census: district.entry.total, roundedHeadcount, roundingDelta: roundedHeadcount - district.entry.total },
    affiliations: { census: district.entry.byAff.map(({ aff, q }) => ({ aff, q })), personEntries, personSpotLinks }, counts, unknownPoiKinds,
    assumptions: [
      { source: 'derived', field: 'geometry', rule: 'Origin-anchored 200 m clipped blocks; venues first by place id, then (gx, gy); all venue volumes/Z bands retained. Venue precedence, then cell order on closed boundaries. Venue area is the XY footprint union; stacked volumes count once.' },
      { source: 'derived', field: 'neighbours', rule: 'Grid edge neighbours, diagonal second neighbours, venue/retained-grid-bin XY overlap. Geometry only; traversability unknown. Venue host is the nearest overlapping block centre.' },
      { source: 'derived', field: 'headShare', rule: 'Clipped block area / district area; no subtraction of venue footprints. Venues have zero residents. S1 rounds headcounts per cell and draws households unchanged; realised household membership can differ.' },
      { source: 'derived', field: 'presence/pop', rule: 'One vote per distinct person-entry/spot link across phases, retaining cross-community tuples. Affiliation from records, civilian/Unaffiliated merged, NCPD normalized. Exclude vehicle/other/unresolved affiliation. Flat periods (06:00, 12:00, 18:00, 00:00): schedule unknown. Pop distributes the census scale over all cells by votes; empty blocks get 1% of mean block votes (mean 1 if all empty). Empty cells use census affiliation shares. No simultaneous occupancy claim.' },
      { source: 'derived', field: 'services', rule: 'One plain-kind table; nearest 15 in 3D to footprint-weighted cell centre, ties by POI id. Unknown kinds counted, never guessed. Evidence pins never become services.' },
      { source: 'derived', field: 'binding', rule: 'All linked entry types retained; exact (community id, entry name, spot id), deduplicated only across phases of the same entry. Registry ids and ordinals unavailable; no runtime binding. Fallback ids counted by colon format.' },
      { source: 'derived', field: 'coverage evidence', rule: 'Static counts by original POI kind only, separate from S1 fractional coverage. Calibration remains open.' },
      { source: 'stand-in', field: 'census/recipe', rule: '2964, rho, age, role, income, affiliation, household, tenure and wealth marginals, trust and price anchor unchanged. W1 entry counts compare authored types, not quantities.' },
      { source: 'stand-in', field: 'opportunity/security', rule: 'Copy public, marketCell, A, F, pairs and calibrated gameCoverage unchanged from existing grid/venue templates cyclically in each kind’s cell order. Re-sum district staticTotalA; stub and rest totals unchanged. No claim of measured police/security, propensity, pair hostility or opportunity. S1Data defaults unchanged.' },
      { source: 'derived', field: 'future W1', rule: 'Quantities and period names await a versioned W1 revision. No census flag or schedule interpretation until that contract exists; records/spawners do not supply a census.' },
    ],
  };
  return { index, report };
}
