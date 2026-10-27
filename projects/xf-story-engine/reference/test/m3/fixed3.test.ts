import {expect,test} from 'bun:test';
import {fixedPlan3,fixedSlot3,initialPool3,type CastPool3} from '../../src/m3/fixed3.ts';
import {library,run3World} from '../../src/m3/run3.ts';
import {Run} from '../../src/m3/driver.ts';
import {stateById} from '../../src/m3/states.ts';
import type {Pattern} from '../../src/seeding/pattern-types.ts';
const pool:CastPool3={protagonist:'player',nodes:[{id:'player',kinds:['person','actor'],name:'you'},...Array.from({length:12},(_,i)=>({id:'n'+i,kinds:['person','actor'] as const,name:'Resident '+i})).map(n=>({...n,kinds:[...n.kinds]})),{id:'g',kinds:['group','actor'],name:'Local crew'},{id:'l',kinds:['place'],name:'Local block'},{id:'f',kinds:['fact'],name:'Recorded fact'},{id:'i',kinds:['item'],name:'Recorded item'},{id:'e',kinds:['event'],name:'Recorded event'}]};
test('A5 initial pool uses the same compatible resident kinds as engine casting',()=>{
 const r=new Run(run3World('m3c-initial-cast','E','steady').opts,stateById('S-mid-squeezed'));
 const adults=r.w.sim.w.districts.flatMap(d=>d.cellIds.flatMap(c=>r.w.sim.people.residentsOfBlock(c))).filter(id=>r.w.sim.people.view(id)?.ageClass==='adult');
 const resident=adults[0]!;const kind=r.w.l3!.kv.kind(resident)!;expect(r.w.sim.k.schema.isKind(kind,'core:person')).toBe(false);expect(r.w.l3!.kv.isKind(kind,'core:person')).toBe(true);
 const snapshot=initialPool3(r);expect(snapshot.nodes.some(n=>n.id===resident&&n.kinds.includes('person'))).toBe(true);expect(snapshot.nodes.filter(n=>n.kinds.includes('person')).length).toBe(adults.length+1);
},60000);
test('A5 expands the authored feud path and retains the two sides in both grievance children',()=>{
 const p=library.find(p=>p.id==='xf.composite:feud')!,plan=fixedPlan3(p,pool,'test');expect(plan.refusal).toBeUndefined();expect(plan.steps.some(s=>s.fn==='story')).toBe(false);
 const opened=plan.steps.find(s=>s.id.endsWith('/opened'))!;
 const answered=plan.steps.filter(s=>s.id.includes('/answered/')),countered=plan.steps.filter(s=>s.id.includes('/countered/'));
 expect(answered.length).toBeGreaterThan(1);expect(countered.length).toBeGreaterThan(1);
 expect(answered.some(s=>s.args.by===opened.args.to&&s.args.to===opened.args.by)).toBe(true);
 expect(countered.some(s=>s.args.by===opened.args.by&&s.args.to===opened.args.to)).toBe(true);
 expect(plan).toEqual(fixedPlan3(p,pool,'test'));
});
test('A5 heist expands its declared betrayal child without a live story token',()=>{
 const p=library.find(p=>p.id==='xf.composite:heist')!,plan=fixedPlan3(p,pool,'test');expect(plan.refusal).toBeUndefined();expect(plan.patterns).toContain('xf.composite:betrayal');expect(plan.steps.some(s=>s.id.includes('/crossed/'))).toBe(true);expect(plan.steps.some(s=>s.fn==='story')).toBe(false);expect(plan.steps.some(s=>s.id.endsWith('/split'))).toBe(false);
});
test('A5 refuses the whole slot if a required role has no initial casting candidate',()=>{
 const p=structuredClone(library[0]!);p.roles['?required']={kind:'fact'};const plan=fixedPlan3(p,{...pool,nodes:pool.nodes.filter(n=>!n.kinds.includes('fact'))},'test');expect(plan.refusal).toContain('uncastable role');expect(plan.steps).toEqual([]);
});
test('A5 asks for synthetic-player acceptance before an authored protagonist act',()=>{
 const p:Pattern={id:'test:act',version:1,family:'turn',scale:'step',roles:{'?by':{kind:'person',v:'may'},'?to':{kind:'person'}},junctures:{act:{fn:'help',args:{by:'?by',to:'?to'}}},edges:[],entry:['act'],outcomes:{done:{reached:['act'],kind:'resolved'}},show:{junctures:['act'],edges:0}};
 const yes=fixedSlot3(pool,'test','steady','engage',0,[p]).thread!,no=fixedSlot3(pool,'test','steady','decline',0,[p]).thread!;
 expect(yes.occurrences.map(o=>o.token.split('(')[0])).toEqual(['ask','comply','help']);expect(no.occurrences.map(o=>o.token.split('(')[0])).toEqual(['ask','refuse']);expect(no.outcome).toBe('parked');expect(yes.shownEdges).toBe(0);
});
