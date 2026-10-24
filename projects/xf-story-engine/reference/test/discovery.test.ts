import { expect, test } from 'bun:test';
import { H, s, mintedId } from '../src/id.ts';
import { newOpCtx } from '../src/resolve.ts';
import { LimitExceeded } from '../src/work.ts';
import { coreKernel } from './helpers.ts';

for (const snapshot of [false, true]) for (const read of ['place', 'time', 'witness'] as const)
test(`SE-229-${read}: ${snapshot ? "snapshot" : "incremental"} public discovery reaches released saved events without a preparatory reference`, () => {
  const make = () => {
    const k = coreKernel('saved-discovery', undefined, { snapshotEvery: snapshot ? 1 : 10000 });
    const observer = k.root('O', 'core:person'), subject = k.root('S', 'core:person'), place = k.root('P', 'core:place');
    const event = k.events.mintEvent({creator:observer,cause:observer,name:'E',kind:'arrival',time:0,place,
      participants:[{who:subject,role:'actor'}],witnesses:[observer]});
    const seed = H(s('consumer'));
    k.retention.setSeed({id:seed,state:{},nodes:[event]});k.settle();k.persistence.save('A');k.retention.endSeed(seed);
    return {k,observer,subject,place,event};
  };
  const {k:control,observer,subject,place,event} = make(), swept = make().k, fresh = coreKernel('saved-discovery',undefined,control.config);
  for(const [id,r] of control.persistence.chain) fresh.persistence.chain.set(id,structuredClone(r));
  fresh.persistence.load('A');fresh.retention.endSeed(H(s('consumer')));
  swept.retention.scheduleSweep();swept.settle();
  expect(swept.store.header(event)).toBeUndefined();
  for(const k of [control,swept,fresh]) {
    if(read==='place') expect(k.query({find:'core:event',scope:{under:place},at:0,must:[],limit:'all'}), 'SE-229-place semantic: spatial discovery').toEqual({status:'ok',items:[{id:event,score:0}]});
    if(read==='time') expect(k.events.eventsAtTime(0), 'SE-229-time semantic: temporal discovery').toEqual([event]);
    if(read==='witness') expect(k.beliefs.witnessed(observer,subject,0), 'SE-229-witness semantic: witness discovery').toBe(true);
    expect(k.retention.isRetained(event), 'discovery never roots history').toBe(false);
    k.retention.scheduleSweep();k.settle();expect(k.store.header(event)).toBeUndefined();
  }
});

test('SE-229 discovery shares operation budgets and respects authoritative live edge ends',()=>{
  const k=coreKernel('discovery-limits'), creator=k.root('O','core:person'), place=k.root('P','core:place');
  const event=k.events.mintEvent({creator,cause:creator,name:'E',kind:'arrival',time:0,place});
  k.retention.setSeed({id:H(s('seed')),state:{},nodes:[event]});k.settle();k.persistence.save('A');
  const edge=k.store.edgesFrom(event)[0];k.endEdge(edge.id,0);
  expect(k.query({find:'core:event',scope:{under:place},at:0,must:[],limit:'all'})).toEqual({status:'ok',items:[]});
  expect(()=>k.events.eventsAtTime(0,newOpCtx(1))).toThrow(LimitExceeded);
  const q=k.queries.run({find:'core:event',scope:{under:place},at:0,must:[],limit:'all'},newOpCtx(0));
  expect(q.status).toBe('failed');
});

test('saved candidate enumeration is stable when recovering one event also restores another candidate',()=>{
  const k=coreKernel('discovery-dependencies'), creator=k.root('O','core:person');
  const parent=k.events.mintEvent({creator,cause:creator,name:'parent',time:0,kind:'arrival'});
  const name=Array.from({length:32},(_,n)=>`child-${n}`).find(name=>mintedId(parent,parent,name)<parent)!;
  expect(name).toBeDefined();
  const child=k.events.mintEvent({creator:parent,cause:parent,name,time:0,kind:'arrival'});
  const seed=H(s('consumer'));k.retention.setSeed({id:seed,state:{},nodes:[child]});k.settle();k.persistence.save('A');k.retention.endSeed(seed);
  k.retention.scheduleSweep();k.settle();
  expect([k.store.header(parent),k.store.header(child)]).toEqual([undefined,undefined]);
  expect(k.events.eventsAtTime(0)).toEqual([parent,child].sort());
});

test('spatial discovery recovers only reached saved candidates, including region candidates',()=>{
  const k=coreKernel('discovery-scope'), creator=k.root('O','core:person'), place=k.root('P','core:place'), remote=k.root('Q','core:place');
  const event=k.events.mintEvent({creator,cause:creator,name:'E',kind:'arrival',time:0,place});
  const unrelated=k.events.mintEvent({creator,cause:creator,name:'unrelated',kind:'arrival',time:0,place:remote});
  const point=k.mint(creator,creator,'point','core:place');
  k.contribute({source:{layer:'authored',origin:creator},target:{slot:'position',scope:{nodes:[point]}},mode:'constrain',form:{f:'const',value:[1,2,3]}});
  const seed=H(s('consumer'));k.retention.setSeed({id:seed,state:{},nodes:[event,unrelated,point]});k.settle();k.persistence.save('A');k.retention.endSeed(seed);
  k.retention.scheduleSweep();k.settle();
  expect(k.query({find:'core:event',scope:{under:place},at:0,must:[],limit:'all'})).toEqual({status:'ok',items:[{id:event,score:0}]});
  expect(k.store.header(unrelated)).toBeUndefined();
  expect(k.query({find:'core:place',scope:{region:{min:[0,1,2],max:[2,3,4]}},at:0,must:[],limit:'all'})).toEqual({status:'ok',items:[{id:point,score:0}]});
  expect(k.retention.isRetained(point)).toBe(false);
});
