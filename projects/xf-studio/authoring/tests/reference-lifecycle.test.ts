import { expect, test } from "bun:test";
import { referenceTextures } from "../src/platform/scene/reference-textures";
import { createReferenceCharacterRoutes } from "../src/character/host/reference-character-server";
test("reference routes refuse preparation and assets before verification or experiment demand",async()=>{
  let settingsReads=0;
  const routes=createReferenceCharacterRoutes({cacheRoot:"build/reference-test-unused",enabled:()=>false,settings:()=>{settingsReads++;return{gameRoot:null,launchRoute:"direct",mo2Root:null,mo2ProfileId:null,manualModRoot:null,wolvenKitCli:null};}});
  expect((await routes.handle(new Request("http://localhost/api/reference-character",{method:"POST"}))).status).toBe(403);
  expect((await routes.handle(new Request("http://localhost/assets/reference-character/absent.png"))).status).toBe(403);
  expect(settingsReads).toBe(0);
});
test("reference polling removes each finished wait listener and remains cancellable",async()=>{
  const original=globalThis.fetch,life=new AbortController(),listeners=new Set<unknown>();let peak=0,calls=0;
  const add=life.signal.addEventListener.bind(life.signal),remove=life.signal.removeEventListener.bind(life.signal);
  life.signal.addEventListener=((type:any,fn:any,options:any)=>{if(type==='abort'){listeners.add(fn);peak=Math.max(peak,listeners.size);}add(type,fn,options);})as typeof add;
  life.signal.removeEventListener=((type:any,fn:any,options:any)=>{if(type==='abort')listeners.delete(fn);remove(type,fn,options);})as typeof remove;
  globalThis.fetch=Object.assign(async()=>{calls++;if(calls===3)life.abort();return Response.json({key:'test',phase:'preparing',record:null});},{preconnect:original.preconnect});
  try{await expect(referenceTextures('hair',life.signal,{})).rejects.toThrow();expect(calls).toBe(3);expect(peak).toBe(1);expect(listeners.size).toBe(0);}finally{globalThis.fetch=original;life.abort();}
});
