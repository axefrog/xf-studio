import { expect, spyOn, test } from "bun:test";
import { Aborter, MemoryStore } from "strata";
import { Scheduler, seededRandom, simClock, settle } from "strata/testing";
import { createExperiments, startExperiments } from "../src/platform/core/experiments";
const sources = () => ({clock:simClock(new Scheduler()),random:seededRandom(29)});
const definition = {id:"sample",label:"Sample",description:"Test",load:async()=>{throw Error("must stay off");}};
test("experimental store failure never blocks synchronous all-off startup", async()=>{
  const life=new Aborter(),memory=new MemoryStore(),store=new Proxy(memory,{get(target,key){if(key==='load')return async()=>{throw Error('store unavailable');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const port=startExperiments({definitions:[definition],overrides:{},sources:sources(),store,signal:life.signal});
  expect(port.snapshot()[0].enabled).toBe(false);expect(port.registrations()).toEqual([]);
  expect(await port.ready).toBe(false);expect(port.snapshot()[0].phase).toBe('failed');expect((await port.set('sample',true)).ok).toBe(false);life.abort();
});
test("the desktop startup bundle contains no Hair Lab feature or worker import",async()=>{
  const result=await Bun.build({entrypoints:[new URL('../src/studio-startup.ts',import.meta.url).pathname.replace(/^\//,'')],target:'browser'});
  expect(result.success).toBe(true);const text=await result.outputs[0].text();expect(text).not.toContain('hair-lab-experiment');expect(text).not.toContain('/build/hair-worker.js');
});
test("read-only startup creates no preference node; repeated sets retain one identity",async()=>{
  const life=new Aborter(),store=new MemoryStore();
  const port=await createExperiments({definitions:[definition],overrides:{},sources:sources(),store,signal:life.signal});
  expect(port.context.graph.list()).toEqual([]);await port.set('sample',false);await port.set('sample',false);await settle();
  expect(port.context.graph.list().filter(r=>r.type==='experimental-features')).toHaveLength(1);life.abort();
});
test("a lost save acknowledgement never rolls accepted preferences back behind the store",async()=>{
  const life=new Aborter(),memory=new MemoryStore();
  const port=await createExperiments({definitions:[definition],overrides:{},sources:sources(),store:memory,signal:life.signal});
  const flush=port.context.graph.flush.bind(port.context.graph);
  // Lose the acknowledgement after persistence completed, without simulating an endless retry clock.
  const acknowledgement=spyOn(port.context.graph,'flush').mockImplementation(async()=>{await flush();throw Error('acknowledgement lost');});
  expect((await port.set('sample',true)).ok).toBe(false);expect(port.snapshot()[0].enabled).toBe(true);expect(port.snapshot()[0].message).toContain('confirm');
  const ref=port.context.graph.list().find(r=>r.type==='experimental-features')!;expect(port.context.graph.resolve(ref,['flags','sample'])).toBe(true);
  acknowledgement.mockRestore();await port.set('sample',true);expect(port.snapshot()[0].enabled).toBe(true);life.abort();
  const nextLife=new Aborter(),next=await createExperiments({definitions:[definition],overrides:{},sources:sources(),store:memory,signal:nextLife.signal});expect(next.snapshot()[0].enabled).toBe(true);nextLife.abort();
});
