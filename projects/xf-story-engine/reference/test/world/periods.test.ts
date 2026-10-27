import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import packFixture from './fixtures/world-pack.json';
import contentFixture from './fixtures/period-content.json';
import { importW1, stableJson } from '../../src/world/import-w1.ts';
import { periodStart, periodSpans, spanOverlap } from '../../src/world/periods.ts';
import type { W1Content, W1Pack } from '../../src/world/types.ts';

const fixture = () => ({ pack: structuredClone(packFixture) as W1Pack, content: structuredClone(contentFixture) as unknown as W1Content });

test('period names use the declared named/clock table; other raw labels remain unknown', () => {
  for (const [name, start] of [['Morning',360],['Day',720],['Noon',720],['Evening',1080],['Night',1320],['Midnight',0]] as const)
    expect(periodStart(name)).toEqual({start,rule:'named'});
  expect(periodStart('_22_00')).toEqual({start:1320,rule:'clock'});
  expect(periodStart('_04_30')).toEqual({start:270,rule:'clock'});
  for (const [name,start] of [['4:00 AM',240],['6:00 PM',1080],['1:00 AM',60],['12:00 AM',0],['12:37 AM',37],['12:00 PM',720],['12:37 PM',757],['11:59 PM',1439]] as const)
    expect(periodStart(name)).toEqual({start,rule:'clock-12h'});
  for (const name of ['0:00 AM','13:00 PM','1:60 AM','1:00 am','1:0 PM','_24_00','_12_60','_4_00','day','__proto__',''])
    expect(periodStart(name)).toEqual({start:null,rule:'unknown'});
});

test('spans wrap midnight, duplicate starts share a span, unknowns never split known spans', () => {
  const spans = periodSpans(['Morning','Night','_22_00','unmapped'].map((name) => ({name,spots:[]})));
  expect(spans.map(({start,minutes})=>[start,minutes])).toEqual([[360,960],[1320,480],[1320,480],[0,1440]]);
  expect(periodSpans([{name:'Night',spots:[]}])[0].minutes).toBe(1440);
  expect(periodSpans(['Night','_22_00'].map((name)=>({name,spots:[]}))).map((p)=>p.minutes)).toEqual([1440,1440]);
  expect(periodSpans([])).toEqual([]);
  const clockSpans=periodSpans(['6:00 PM','1:00 AM'].map((name)=>({name,spots:[]})));
  expect(clockSpans.map(({start,minutes})=>[start,minutes])).toEqual([[1080,420],[60,1020]]);
  expect(clockSpans.map(spanOverlap)).toEqual([[0,0,1,1/6],[1,1,0,5/6]]);
  expect(periodSpans(['Noon','Day','12:00 PM'].map((name)=>({name,spots:[]}))).map((p)=>p.minutes)).toEqual([1440,1440,1440]);
});

test('overlap integrates six-hour S1 windows in 06/12/18/00 order', () => {
  expect(spanOverlap({start:1320,minutes:480})).toEqual([0,0,1/3,1]);
  expect(spanOverlap({start:360,minutes:960})).toEqual([1,1,2/3,0]);
  expect(spanOverlap({start:270,minutes:360})).toEqual([0.75,0,0,0.25]);
  for (const start of [0,360,720,1320]) expect(spanOverlap({start,minutes:1440})).toEqual([1,1,1,1]);
});

test('stated/default/zero weights, duration presence, registry and global mean normalisation', () => {
  const {pack,content}=fixture(), {index,report}=importW1(pack,content);
  const shared=report.cells.find((c)=>c.key==='grid:0,0')!;
  // Civilian weights [2,0,1,4] plus a single-period all-day TygerClaw weight 3.
  const scale=shared.pop[1]/3;
  for (const [i,raw] of [5,3,4,7].entries()) expect(shared.pop[i]).toBeCloseTo(raw*scale,10);
  expect(index.cells[shared.id].presence).toEqual({TygerClaws:12/19,civilian:7/19});
  expect(Object.values(index.cells).reduce((n,c)=>n+c.pop.reduce((a,b)=>a+b,0)/4,0)).toBeCloseTo(2964,9);
  expect(report.periods.quantities).toEqual({stated:4,absent:1,explicitZero:1});
  expect(report.periods.unknownNames).toEqual({});
  expect(report.periods.phases.map((p)=>p.mode)).toEqual(['multi-period','single-period']);
  expect(report.periods.names.find((p)=>p.name==='4:00 AM')).toEqual({name:'4:00 AM',count:1,start:240,rule:'clock-12h'});
  expect(report.periods.names.find((p)=>p.name==='Morning')).toEqual({name:'Morning',count:1,start:360,rule:'named'});
  for (const tuples of Object.values(index.worldImport.bindings)) for (const b of tuples)
    expect(b.registry).toEqual(content.communities.find((c)=>c.id===b.community)!.registry);
  // An explicit zero suppresses its span, even in a block with no positive links there.
  content.communities[1].entries=[];
  const zero=importW1(pack,content).report.cells.find((c)=>c.key==='grid:0,0')!;
  expect(zero.pop[1]).toBe(0);
  expect(zero.pop[0]/zero.pop[2]).toBe(2);
  expect(zero.pop[3]/zero.pop[2]).toBe(4);
  for (const period of content.communities[0].entries[0].phases[0].periods!) period.quantity=0;
  const allZero=importW1(pack,content).report.cells.find((c)=>c.key==='grid:0,0')!;
  expect(allZero.pop).toEqual([0,0,0,0]);
  expect(allZero.presenceFloor).toBe(false);
  // If every block has explicit-zero links, preserving zero leaves no positive
  // mass to normalise: refuse rather than inventing people or returning mean 0.
  pack.areas=[{...pack.areas[0],poly:[[0,0],[200,0],[200,200],[0,200]]}];
  expect(()=>importW1(pack,content)).toThrow('no positive population weight');
});

test('single-period, all-unknown and absent-period phases report all-day spans explicitly', () => {
  const {pack,content}=fixture(), e=content.communities[0].entries[0];
  e.phases=[{name:'single',spots:['shared'],periods:[{name:'Night',spots:['shared']}]},
    {name:'legacy',spots:['shared']},{name:'empty',spots:[],periods:[]}];
  content.communities[1].entries[0].phases[0].periods![0].name='unmapped';
  const {report}=importW1(pack,content);
  expect(report.periods.phases.map((p)=>[p.mode,p.allDay])).toEqual([
    ['single-period',true],['all-day',true],['all-day',true],['all-day',true]]);
  expect(report.periods.unknownNames).toEqual({unmapped:1});
});

test('period rows and registry metadata are validated and bounded', () => {
  for (const quantity of [-1,0.5,65536,NaN]) {
    const {pack,content}=fixture(); content.communities[0].entries[0].phases[0].periods![0].quantity=quantity;
    expect(()=>importW1(pack,content)).toThrow('invalid period');
  }
  const {pack,content}=fixture(); content.communities[0].registry!.id='';
  expect(()=>importW1(pack,content)).toThrow('invalid registry');
  const f=fixture(); f.content.communities[0].entries[0].phases[0].periods=Array.from({length:100001},()=>({name:'Day',spots:[]}));
  // Empty period spot arrays still consume the nested budget.
  f.content.communities[0].entries[0].phases[0].spots=[];
  expect(()=>importW1(f.pack,f.content)).toThrow('nested cap');
  const mismatch=fixture(); mismatch.content.communities[0].entries[0].phases[0].periods![0].spots=['not-in-phase'];
  expect(()=>importW1(mismatch.pack,mismatch.content)).toThrow('phase union');
});

test('period/registry import is byte deterministic against its golden', () => {
  const {pack,content}=fixture(), a=importW1(pack,content), before=stableJson(content);
  expect(stableJson(importW1(pack,content))).toBe(stableJson(a));
  expect(stableJson(content)).toBe(before);
  const bytes=Buffer.from(stableJson(a));
  expect(bytes.equals(readFileSync(`${import.meta.dir}/fixtures/period-import.golden.json`))).toBe(true);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(readFileSync(`${import.meta.dir}/fixtures/period-import.golden.sha256`,'utf8').trim());
  content.communities.reverse(); content.communities.forEach((c)=>c.entries.forEach((e)=>e.phases.forEach((p)=>p.periods?.reverse())));
  const reversed=importW1(pack,content);
  expect(reversed.index.cells).toEqual(a.index.cells);
  expect(reversed.index.worldImport.geometry).toEqual(a.index.worldImport.geometry);
});
