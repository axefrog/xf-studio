import { expect, test } from 'bun:test';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import packFixture from './fixtures/world-pack.json';
import contentFixture from './fixtures/content.json';
import { importW1, stableJson } from '../../src/world/import-w1.ts';
import { area, cellAt, clip, contains, footprint, overlapsXY, squaredDistance } from '../../src/world/geometry.ts';
import type { W1Pack, W1Content } from '../../src/world/types.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';
import { memberId } from '../../src/id.ts';
import { SERVICE_KINDS, COVERAGE_KINDS, VENDOR_SERVICE_TYPES } from '../../src/world/poi-kinds.ts';
import { importedLayout } from '../../src/holotable/layout.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { Sim } from '../../src/sim/sim.ts';
import { seedOf } from '../sim/helpers.ts';
import { runImportCli } from '../../tools/world/import-w1.ts';

const fixture = () => ({ pack: structuredClone(packFixture) as W1Pack, content: structuredClone(contentFixture) as unknown as W1Content });
const build = () => { const { pack, content } = fixture(); return importW1(pack, content); };
const clippedArea = (...args: Parameters<typeof clip>) => clip(...args).reduce((n,p)=>n+area(p),0);

test('synthetic import bytes and SHA-256 match the cross-platform golden', () => {
  const bytes = Buffer.from(stableJson(build()));
  const golden = readFileSync(resolve(import.meta.dir,'fixtures/import.golden.json'));
  const sha = readFileSync(resolve(import.meta.dir,'fixtures/import.golden.sha256'),'utf8').trim();
  expect(bytes.equals(golden)).toBe(true);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
  expect(createHash('sha256').update(golden).digest('hex')).toBe(sha);
});

test('deterministic bytes, hashes, ordering, input immutability and JSON round trip', () => {
  const { pack, content } = fixture(), before = stableJson({ pack, content }), baseline = stableJson(makeKabukiSlice());
  const a = importW1(pack, content), b = importW1(pack, content);
  expect(stableJson(a)).toBe(stableJson(b));
  expect(stableJson({ pack, content })).toBe(before);
  expect(stableJson(makeKabukiSlice())).toBe(baseline);
  pack.areas.reverse(); content.spots.reverse(); content.communities.reverse(); content.pois.reverse();
  const reordered = importW1(pack, content);
  expect(reordered.index.worldImport.geometry).toEqual(a.index.worldImport.geometry);
  expect(reordered.index.cells).toEqual(a.index.cells);
  const loaded = JSON.parse(stableJson(a.index));
  expect(cellAt(loaded.worldImport.geometry, [200,50,12])).toBe(cellAt(a.index.worldImport.geometry, [200,50,12]));
  expect(runImportCli).toBeFunction(); // include the CLI in the project typecheck
});

test('the file tool writes byte-identical index and report on repeated imports', () => {
  const dir = resolve(import.meta.dir,'../../../../../.scratch-w1',`cli-${randomUUID()}`);
  mkdirSync(dir,{recursive:true});
  const args = [resolve(import.meta.dir,'fixtures/world-pack.json'),resolve(import.meta.dir,'fixtures/content.json'),join(dir,'index.json')];
  try {
    runImportCli(args);
    const index = readFileSync(args[2]), report = readFileSync(join(dir,'kabuki.import.json'));
    runImportCli(args);
    expect(readFileSync(args[2]).equals(index)).toBe(true);
    expect(readFileSync(join(dir,'kabuki.import.json')).equals(report)).toBe(true);
    expect(()=>runImportCli([...args,'--report',args[0]])).toThrow('distinct paths');
    if (process.platform === 'win32') expect(()=>runImportCli([...args,'--report',args[0].toUpperCase()])).toThrow('distinct paths');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('origin anchoring, canonical venue-first order and ordinal member identities', () => {
  const a = build(), { pack, content } = fixture();
  const d = Object.values(a.index.districts).find((d) => d.simulated)!;
  expect(d.cellIds.map((id) => a.index.worldImport.geometry[id].key)).toEqual(['venue:Districts.JudysApartment','grid:0,0','grid:0,1','grid:1,0','grid:1,1']);
  expect(d.cellIds).toEqual(d.cellIds.map((_, i) => memberId(d.id, 'cells', i)));
  pack.areas[0].poly = [[0,0],[600,0],[600,400],[0,400]];
  const b = importW1(pack, content);
  for (const id of d.cellIds) expect(b.index.worldImport.geometry[id]).toEqual(a.index.worldImport.geometry[id]);
  // Negative coordinates are floor-divided from origin, independent of bounds.
  expect(clippedArea([[-210,-210],[10,-210],[10,10],[-210,10]], -200,-200,0,0)).toBe(40000);
});

test('venue beats block with closed Z endpoints; every volume survives layout', () => {
  const { index } = build(), geometry = index.worldImport.geometry;
  const venue = Object.keys(geometry).find((id) => geometry[id].place)!;
  expect(geometry[venue].area).toBe(2400); // stacked footprints count once
  expect(cellAt(geometry, [200,50,10])).toBe(venue);
  expect(cellAt(geometry, [200,50,20])).toBe(venue);
  expect(cellAt(geometry, [200,50,32])).toBe(venue);
  expect(cellAt(geometry, [200,50,25])).not.toBe(venue);
  expect(cellAt(geometry, [200,50,201])).toBeUndefined();
  const layout = importedLayout(index)!;
  expect(layout.cells.get(venue)).toEqual({ zone: geometry[venue].volumes[0] });
  expect(layout.extraVolumes!.get(venue)).toEqual([{ zone: geometry[venue].volumes[1] }]);
  const sim = Sim.create({ worldSeed: seedOf('import-layout'), index, only: [] });
  const items = new HolotableObserver(sim).sample().layers.get('places')!;
  expect(items.filter((i) => i.label === "Judy's Apartment")).toHaveLength(2);
  expect(items.find((i) => i.label === 'Kabuki, block 2')?.facets?.about).toBe('Blocks are a 200 m grid over the real district; street-level blocks come later.');
  expect(items.find((i) => i.id === venue)?.facets?.about).toBeUndefined();
});

test('venue footprint unions overlapping and crossing polygons without double counting', () => {
  const v = (poly: [number,number][]) => ({poly,zlo:0,zhi:10});
  expect(footprint([v([[0,0],[2,0],[2,2],[0,2]]),v([[1,1],[3,1],[3,3],[1,3]])])).toBeCloseTo(7,12);
  expect(footprint([v([[0,0],[4,0],[0,4]]),v([[0,0],[4,4],[4,0]])])).toBeCloseTo(12,12);
});

test('clipping conserves a concave outline and retains a tiny positive bin', () => {
  const p: [number,number][] = [[0,0],[400,0],[400,50],[50,50],[50,400],[0,400]];
  let sum = 0;
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) sum += clippedArea(p, x*200,y*200,(x+1)*200,(y+1)*200);
  expect(sum).toBe(area(p));
  const clipped = clip(p,0,0,200,200);
  expect(clipped.some((poly)=>contains({poly,zlo:0,zhi:10},[150,150,5]))).toBe(false);
  const { pack, content } = fixture(); pack.areas[0].poly = [[0,0],[400.001,0],[400.001,400],[0,400]];
  expect(importW1(pack, content).report.cells.filter((c) => c.key.startsWith('grid:2,')).length).toBe(2);
});

test('disconnected clipped components never bridge exterior gaps on any cut direction', () => {
  const shape: [number,number][] = [[0,0],[200,0],[200,200],[150,200],[150,50],[50,50],[50,200],[0,200]];
  for (let rotation=0;rotation<4;rotation++) for (const reverse of [false,true]) {
    const rotate = (p:[number,number]):[number,number] => {
      let [x,y]=p;
      for(let r=0;r<rotation;r++) [x,y]=[y,200-x];
      return [x,y];
    };
    const corners=([[0,100],[200,100],[200,200],[0,200]] as [number,number][]).map(rotate);
    const polygon=shape.map(rotate); if(reverse) polygon.reverse();
    const pieces=clip(polygon,Math.min(...corners.map((p)=>p[0])),Math.min(...corners.map((p)=>p[1])),Math.max(...corners.map((p)=>p[0])),Math.max(...corners.map((p)=>p[1])));
    expect(pieces).toHaveLength(2);
    expect(pieces.reduce((n,p)=>n+area(p),0)).toBe(10000);
    for(const x of [51,75,100,125,149]) for(const y of [100,125,199]) {
      const [px,py]=rotate([x,y]);
      expect(pieces.some((poly)=>contains({poly,zlo:0,zhi:10},[px,py,5]))).toBe(false);
    }
    for(const x of [0,25,50,150,175,200]) {
      const [px,py]=rotate([x,100]);
      expect(pieces.some((poly)=>contains({poly,zlo:0,zhi:10},[px,py,5]))).toBe(true);
    }
  }
  const {pack,content}=fixture();
  pack.areas[0].poly=[[0,-100],[200,-100],[200,200],[150,200],[150,-50],[50,-50],[50,200],[0,200]];
  const {index}=importW1(pack,content), geometry=index.worldImport.geometry;
  const id=Object.keys(geometry).find((id)=>geometry[id].key==='grid:0,0')!;
  expect(geometry[id].volumes).toHaveLength(2);
  expect(importedLayout(index)!.extraVolumes!.get(id)).toHaveLength(1);
  for (const x of [51,100,149]) expect(cellAt(geometry,[x,0,0])).toBeUndefined();
});

test('L-shaped district venues intersect clipped geometry; phantom overlap cannot select a host', () => {
  const {pack,content}=fixture();
  pack.areas[0].poly=[[0,0],[400,0],[400,50],[50,50],[50,400],[0,400]];
  for(const venue of pack.areas.slice(1)) venue.poly=[[40,100],[390,100],[390,110],[40,110]];
  const {index}=importW1(pack,content), geometry=index.worldImport.geometry;
  const ids=Object.fromEntries(Object.entries(geometry).map(([id,g])=>[g.key,id]));
  const venue=index.cells[ids['venue:Districts.JudysApartment']];
  expect(venue.adj1).toEqual([ids['grid:0,0']]);
  expect(venue.host).toBe(ids['grid:0,0']);
  expect(index.cells[ids['grid:1,0']].adj1).not.toContain(venue.id);
  expect(overlapsXY(geometry[venue.id].volumes[0],geometry[ids['grid:1,0']].volumes[0])).toBe(false);
});

test('one declared template per kind, POI vendor markets and zero uncalibrated coverage', () => {
  const {index,report}=build(), base=makeKabukiSlice();
  expect(report.templates.block.name).toBe('g4'); expect(report.templates.venue.name).toBe('v5');
  const ordinary=Object.values(base.cells).filter((c)=>c.kind==='grid' && c.public==='public' && !c.services.length && !c.marketCell && Object.values(c.gameCoverage).every((v)=>v===0)).sort((a,b)=>a.headShare-b.headShare);
  expect(ordinary[Math.floor(ordinary.length/2)].id).toBe(report.templates.block.id);
  expect(base.cells[report.templates.venue.id].marketCell).toBe(false);
  for(const c of Object.values(index.cells)) {
    const t=base.cells[c.kind==='grid'?report.templates.block.id:report.templates.venue.id];
    expect({public:c.public,A:c.A,F:c.F,pairs:c.pairs}).toEqual({public:t.public,A:t.A,F:t.F,pairs:t.pairs});
    expect(Object.values(c.gameCoverage).every((v)=>v===0)).toBe(true);
    expect(c.marketCell).toBe(c.services.some((s)=>VENDOR_SERVICE_TYPES.has(s.type)));
  }
  expect(Object.values(index.cells).filter((c)=>c.marketCell)).toHaveLength(1);
  expect(squaredDistance([1,2,3],[4,6,15])).toBe(169);
});

test('squared-distance selection breaks equal service and host distances by id', () => {
  const {pack,content}=fixture();
  content.pois=[{id:'z',kind:'Food vendor',at:[100,100,0]},{id:'a',kind:'Food vendor',at:[100,100,0]}];
  const {index}=importW1(pack,content), geometry=index.worldImport.geometry;
  const block=cellAt(geometry,[100,100,0])!;
  expect(index.cells[block].services.map((s)=>s.poi)).toEqual(['a','z']);
  const venue=Object.values(index.cells).find((c)=>c.kind==='venue')!;
  const distances=venue.adj1.map((id)=>squaredDistance(geometry[id].centre,geometry[venue.id].centre));
  expect(distances[0]).toBe(distances[1]);
  expect(venue.host).toBe([...venue.adj1].sort()[0]);
});

test('population census, zero venue residents, affiliation normalization, floor and vehicle exclusion', () => {
  const { index, report } = build();
  expect(report.population.roundedHeadcount).toBe(2964);
  for (const [id, c] of Object.entries(index.cells)) {
    expect(Object.values(c.presence).reduce((a,b) => a+b,0)).toBeCloseTo(1, 12);
    expect(c.pop.every((p) => p === c.pop[0])).toBe(true);
    if (c.kind === 'venue') expect(c.headShare).toBe(0);
    expect(c.services.length).toBeLessThanOrEqual(15);
    if (index.worldImport.geometry[id].key === 'grid:0,0') expect(c.presence).toEqual({ TygerClaws:0.5,civilian:0.5 });
  }
  expect(report.counts.floorBlocks).toBe(3);
  expect(report.counts.nonPersonSpotLinks).toBe(1);
  expect(Object.values(report.affiliations.personSpotLinks).reduce((a,b)=>a+b,0)).toBe(3);
  expect(Object.values(index.cells).reduce((s,c)=>s+c.pop[0],0)).toBeCloseTo(2964, 9);
  const { pack, content } = fixture(); content.records['2'].affiliationName = 'Factions.NCPD';
  expect(importW1(pack,content).report.affiliations.personEntries.ncpd).toBe(1);
});

test('services use one table; coverage is evidence; nearest 15 with deterministic ties and drop counts', () => {
  const { pack, content } = fixture();
  for (let i = 0; i < 20; i++) content.pois.push({id:`extra-${String(i).padStart(2,'0')}`,at:[50+i,50,0],kind:'Ripperdoc'});
  const { index, report } = importW1(pack,content), cell = cellAt(index.worldImport.geometry,[50,50,0])!;
  expect(SERVICE_KINDS['Food vendor']).toBe('vendor'); expect(COVERAGE_KINDS.has('Quest')).toBe(true);
  expect(SERVICE_KINDS.Quest).toBeUndefined();
  expect(index.cells[cell].services).toHaveLength(15);
  expect(index.cells[cell].services[0].poi).toBe('extra-19'); // nearest to centre [100,100,90]
  expect(report.counts.servicesDroppedCap).toBe(6);
  expect(index.worldImport.gameCoverageEvidence[cell]).toEqual({Quest:1});
  expect(report.unknownPoiKinds.FutureVariant).toBe(1);
  const template = makeKabukiSlice().cells[report.cells.find((r)=>r.id===cell)!.standInTemplate];
  expect(index.cells[cell].gameCoverage).toEqual(template.gameCoverage);
});

test('binding keeps shared spots twice, deduplicates phases and counts omissions and fallback ids', () => {
  const { index, report } = build(), cell = cellAt(index.worldImport.geometry,[50,50,0])!;
  expect(index.worldImport.bindings[cell]).toEqual([{community:'c1',entry:'civilian',spot:'shared'},{community:'sector:2',entry:'gang',spot:'shared'}]);
  expect(report.counts).toMatchObject({bindingTuples:4,spotsInMultipleCommunities:1,spotsInNoCommunity:2,entriesWithNoSpots:1,missingSpotLinks:1,
    fallbackCommunityIds:1,fallbackSpotIds:1,unknownEntries:1,vehicleEntries:1});
});

test('geometry neighbours are symmetric, diagonal second; cap and malformed inputs refuse', () => {
  const { index } = build(), geom = index.worldImport.geometry;
  const byKey = Object.fromEntries(Object.entries(geom).map(([id,g])=>[g.key,id]));
  expect(index.cells[byKey['grid:0,0']].adj1).toContain(byKey['grid:1,0']);
  expect(index.cells[byKey['grid:0,0']].adj2).toContain(byKey['grid:1,1']);
  const v = byKey['venue:Districts.JudysApartment'];
  expect(index.cells[v].adj1).toHaveLength(2);
  for (const c of Object.values(index.cells)) for (const id of c.adj1) expect(index.cells[id].adj1).toContain(c.id);
  const { pack, content } = fixture(); pack.areas[0].poly=[[0,0],[4000,0],[4000,4000],[0,4000]];
  expect(()=>importW1(pack,content)).toThrow('255');
  const f = fixture(); f.content.spots[0].at[0] = NaN;
  expect(()=>importW1(f.pack,f.content)).toThrow('spot');
});
