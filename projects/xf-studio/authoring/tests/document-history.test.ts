import { expect, test } from "bun:test";
import { Aborter, MemoryStore } from "strata";
import { Scheduler, seededRandom, simClock } from "strata/testing";
import { createExperiments } from "../src/platform/core/experiments";
import { routeDocumentHistory } from "../src/platform/core/document-history-routing";
test("global history routes independent documents, preserves step identity through Undo and drops only their redo branch", async () => {
  const life = new Aborter(), platform = await createExperiments({ sources: { clock: simClock(new Scheduler()), random: seededRandom(1) }, store: new MemoryStore(), signal: life.signal, definitions: [], overrides: {} }), book = platform.history!;
  book.record("a", "Hair", { id: "one", label: "Hair length", actionKind: "hairLab.set" });
  book.record("b", "Other groom", { id: "two", label: "Hair waves", actionKind: "hairLab.set" });
  book.move("b", -1); expect(book.snapshot("b").steps[0].id).toBe("two"); expect(book.snapshot("a").current).toBe(0);
  const participant = { id: "b", dispatch() { book.move("b", 0); return true; } }, experiments = { ...platform, registrations: () => [{ histories: () => [participant] } as any] };
  const empty = { startId: "base", steps: [], current: -1, redoCount: 0, trimmed: false }, route = routeDocumentHistory({ state: () => ({ depth: 0, redoDepth: 0 }), timeline: () => empty }, experiments);
  expect(route.capability({ kind: "history.redo" })?.available).toBe(true); expect(route.execute({ kind: "history.redo" })?.ok).toBe(true);
  expect(route.timeline().documentLabel).toBe("Other groom");
  book.move("b", -1); book.record("b", "Other groom", { id: "three", label: "Hair volume", actionKind: "hairLab.set" });
  expect(book.snapshot("b").steps.map(s => s.id)).toEqual(["three"]); expect(book.snapshot("a").steps.map(s => s.id)).toEqual(["one"]);
  book.focus(null); expect(route.timeline()).toEqual(empty); life.abort();
});
test("flag-off work builds no history timeline and a selected document respects base busy state", async()=>{
  let reads=0,calls=0;
  const empty={startId:"base",steps:[],current:-1,redoCount:0,trimmed:false};
  const route=routeDocumentHistory({state:()=>({depth:0,redoDepth:0}),timeline:()=>{reads++;return empty;}});
  expect(route.baseChange(()=>++calls)).toBe(1);expect(reads).toBe(0);
  expect(await route.baseRequest(async()=>++calls)).toBe(2);expect(reads).toBe(0);
  const life=new Aborter(),platform=await createExperiments({sources:{clock:simClock(new Scheduler()),random:seededRandom(2)},store:new MemoryStore(),signal:life.signal,definitions:[],overrides:{}});
  platform.history!.record("a","Hair Lab",{id:"step",label:"Hair waves",actionKind:"hairLab.set"});
  const busy=routeDocumentHistory({state:()=>({depth:0,redoDepth:0}),timeline:()=>empty,capability:()=>({available:false,code:"busy",reason:"Finish adjustment."})},{...platform,registrations:()=>[{histories:()=>[{id:"a",dispatch(){calls++;return true;}}]}as any]});
  expect(busy.capability({kind:"history.undo"})?.code).toBe("busy");expect(busy.execute({kind:"history.undo"})?.ok).toBe(false);expect(calls).toBe(2);life.abort();
});
