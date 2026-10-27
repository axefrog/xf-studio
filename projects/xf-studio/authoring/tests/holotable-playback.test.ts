import { playbackBarStage } from "../src/features/holotable/view/playback-bar";
import { trustedFixture } from "./studio-presentation-fixture";
import type { ExperimentPort } from "../src/platform/api/experiments";
import { expect, test } from "bun:test";
import { createHolotable } from "../src/features/holotable/service";
import { SPEEDS, changeMoment } from "../src/features/holotable/playback";
import { playbackEffects, EFFECT_WORK } from "../src/features/holotable/view/playback-effects";
import { GLYPHS, glyphIcon, unknownGlyphs, BADGE_TONES } from "../src/features/holotable/view/glyphs";
import { HOLOTABLE_MODULE, HOLOTABLE_ACTIONS } from "../src/features/holotable/module";
import { holotableFacade } from "../src/features/holotable/facade";
import { liveModuleActions } from "../src/platform/core/module-actions";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { keyBinding } from "../src/app/input-bindings";
import { renderCatalogue } from "../tools/action-catalogue";
import type { AgentAnswer } from "../src/features/holotable/agent-types";
import type { HoloSession, HoloTransport } from "../src/features/holotable/types";
import { readFileSync } from "node:fs";

const session = (game = false): HoloSession => ({ meta: { session:"synthetic",run:1,start:0,end:10000,from:0,to:10000,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"synthetic",problems:[],
  ...(game ? {standalone:{set:"p/set",title:"Game set",clock:"game" as const,branches:[]}} : {}) }, v:[],camera:[],events:[],gaps:[] });
let layers: AgentAnswer = {here:[],specs:{schema:"xfh/projections-1",kinds:{}}, layers:[
  {id:"p/a",producer:"p",layer:"a",title:"A",items:[],refused:0,reason:"",notPlaced:[],otherBranches:[],changes:[0,2,5,10000]},
  {id:"p/b",producer:"p",layer:"b",title:"B",items:[],refused:0,reason:"",notPlaced:[],otherBranches:[],changes:[1,3,4]},
]};
const settle = async () => { for(let n=0;n<10;n++) await Promise.resolve(); };
async function fixture(playback?: {recording:number;game:number}) {
  let tick=()=>{}, memory=playback;
  const ctl=new AbortController();
  const transport: HoloTransport = async(method,p) => ({ok:true,status:200,data:{ok:true,result:
    method==="runs.list" ? ["recording","game"].map(dir=>({dir,session:dir,run:1,start:0,end:10000,bytes:1,complete:true})) :
    method==="session.open" ? session(p.dir==="game") : method==="layers.watch" ? {watch:"synthetic"} : method==="layers.poll" ? layers : {}}});
  const service=createHolotable({transport,playback,rememberPlayback:value=>{memory=value;},every:(_ms,fn)=>{tick=fn;return()=>{tick=()=>{};};},later:()=>()=>{}},ctl.signal);
  service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"recording"});
  return {service,ctl,tick:()=>tick(),memory:()=>memory};
}

test("one shared clock remembers speed per family and restores it after open and reload",async()=>{
  const f=await fixture();try{
    expect(f.service.snapshot().speed).toBe(4);
    await f.service.dispatch({kind:"holo.speed",speed:16});await f.service.dispatch({kind:"holo.play",on:true});f.tick();expect(f.service.snapshot().t).toBe(.8);
    await f.service.dispatch({kind:"holo.open",dir:"game"});expect(f.service.snapshot().speed).toBe(600);
    await f.service.dispatch({kind:"holo.speed",speed:3600});await f.service.dispatch({kind:"holo.play",on:true});f.tick();expect(f.service.snapshot().t).toBe(180);
    await f.service.dispatch({kind:"holo.open",dir:"recording"});expect(f.service.snapshot().speed).toBe(16);
    const reload=await fixture(f.memory());try{expect(reload.service.snapshot().speed).toBe(16);await reload.service.dispatch({kind:"holo.open",dir:"game"});expect(reload.service.snapshot().speed).toBe(3600);}finally{reload.ctl.abort();}
    expect((await f.service.dispatch({kind:"holo.speed",speed:4.5})).ok).toBe(false);
  }finally{f.ctl.abort();}
});

test("stepping uses only visible layers, includes both ends, pauses and refuses without moving at the ends",async()=>{
  const f=await fixture();try{
    await f.service.dispatch({kind:"holo.agentLayer",id:"p/b",on:false});
    expect(f.service.capability({kind:"holo.change.previous"}).available).toBe(false);
    await f.service.dispatch({kind:"holo.play",on:true});
    await f.service.dispatch({kind:"holo.change.next"});expect(f.service.snapshot()).toMatchObject({t:2,playing:false});
    await f.service.dispatch({kind:"holo.change.previous"});expect(f.service.snapshot().t).toBe(0);
    await f.service.dispatch({kind:"holo.seek",t:9999});await f.service.dispatch({kind:"holo.change.next"});expect(f.service.snapshot().t).toBe(10000);
    expect((await f.service.dispatch({kind:"holo.change.next"})).ok).toBe(false);expect(f.service.snapshot().t).toBe(10000);
    await f.service.dispatch({kind:"holo.producer",producer:"p",on:false});expect(f.service.capability({kind:"holo.change.previous"}).available).toBe(false);
    await f.service.dispatch({kind:"holo.producer",producer:"p",on:true});await f.service.dispatch({kind:"holo.seek",t:2});await f.service.dispatch({kind:"holo.change.next"});expect(f.service.snapshot().t).toBe(3);
  }finally{f.ctl.abort();}
});

test("stepping binary-searches long histories",()=>{
  let reads=0;const times=new Proxy(Array.from({length:100000},(_,n)=>n),{get(target,key,receiver){if(typeof key==="string"&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}});
  expect(changeMoment({t:50000,agentEnabled:{},agents:{...layers,layers:[{...layers.layers[0],changes:times}]}},1)).toBe(50001);expect(reads).toBeLessThan(22);
});

test("pulses and retraction fades use 300 real ms; seek, step, pause and reduced motion clear continuity",()=>{
  let now=0;const effects=playbackEffects<string>(()=>now), item=(version:number)=>({key:"a",version,visual:"geometry"});
  effects.observe([item(0)],true,0,false);effects.prepare();expect(effects.frame().effects).toEqual([]);
  effects.observe([item(1)],true,0,false);effects.prepare();now=150;expect(effects.frame().effects[0]).toMatchObject({kind:"pulse",progress:.5});
  effects.observe([],true,0,false);effects.prepare();now=300;expect(effects.frame().effects[0]).toMatchObject({kind:"fade",progress:.5,item:{visual:"geometry"}});
  now=450;expect(effects.frame().pending).toBe(false);
  for(const [playing,epoch,reduced] of [[true,1,false],[false,1,false],[true,1,true]] as const){effects.observe([item(2)],playing,epoch,reduced);effects.prepare();expect(effects.frame().effects).toEqual([]);}
});

test("many-marker pulse work is bounded per frame and expires without another observation",()=>{
  let now=0;const effects=playbackEffects<number>(()=>now), items=Array.from({length:5000},(_,n)=>({key:String(n),version:0,visual:n}));
  effects.observe([],true,0,false);effects.prepare();effects.observe(items,true,0,false);
  for(let n=0;n<30;n++){expect(effects.prepare().visited).toBeLessThanOrEqual(EFFECT_WORK);expect(effects.frame().visited).toBeLessThanOrEqual(EFFECT_WORK);}
  now=300;for(let n=0;n<30;n++){expect(effects.prepare().visited).toBeLessThanOrEqual(EFFECT_WORK);expect(effects.frame().visited).toBeLessThanOrEqual(EFFECT_WORK);}expect(effects.frame().pending).toBe(false);
});

test("glyph resolution: exact icon, family, known kind fallback, then unknown without a plate",()=>{
  expect(glyphIcon("fixer",name=>name==="fixer")).toEqual({known:true,icon:"fixer"});
  expect(glyphIcon("fixer",name=>name==="person")).toEqual({known:true,icon:"person"});
  expect(glyphIcon("fixer",()=>false)).toEqual({known:true,icon:undefined});
  expect(glyphIcon("future-glyph",()=>true)).toEqual({known:false});
  expect(glyphIcon("constructor",()=>true)).toEqual({known:false});
  expect(unknownGlyphs([{glyph:"fixer"},{glyph:"future-glyph"},{glyph:"future-glyph"},{glyph:"unrecognised"},{}])).toEqual({count:3,names:["future-glyph","unrecognised"]});
  expect(Object.keys(GLYPHS)).toHaveLength(55);
  expect(BADGE_TONES).toEqual({ready:"good",done:"good",pending:"muted",matched:"accent",blocked:"warning",new:"accent"});
});

test("all holo actions are registered while on, withdrawn while off, and captured dispatches cannot outlive a registration",async()=>{
  const f=await fixture();try{
    const service=holotableFacade(f.service), registration={module:HOLOTABLE_MODULE,service,renderer:{feature:"holotable" as never,create:()=>({dispose(){}})}};
    let on=true,generation=0;const listeners=new Set<()=>void>();
    const live=liveModuleActions(STUDIO_REGISTRY,{registrationGeneration:()=>generation,registrations:()=>on?[registration]:[],onRegistrationsChanged:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};}});
    for(const kind of Object.keys(HOLOTABLE_ACTIONS))expect(live.registry.routeAsync(kind).ok).toBe(true);
    expect(live.registry.route("camera.front").ok).toBe(true);
    const captured=live.bind(service);expect(captured.capability({kind:"holo.refresh"}).available).toBe(true);
    generation++;for(const listener of listeners)listener();expect(captured.capability({kind:"holo.refresh"}).available).toBe(true);
    on=false;generation++;for(const listener of listeners)listener();
    expect(live.registry.routeAsync("holo.refresh").ok).toBe(false);
    expect(captured.capability({kind:"holo.refresh"})).toMatchObject({available:false,reason:expect.stringContaining("switched off")});
    expect((await captured.dispatch({kind:"holo.refresh"})).ok).toBe(false);
    on=true;generation++;for(const listener of listeners)listener();expect(live.registry.routeAsync("holo.refresh").ok).toBe(true);
    expect(STUDIO_REGISTRY.routeAsync("holo.refresh").ok).toBe(false);
    expect(captured.capability({kind:"holo.refresh"}).available).toBe(false);
    expect((await captured.dispatch({kind:"holo.refresh"})).ok).toBe(false);
    expect((await live.bind(service).dispatch({kind:"holo.refresh"})).ok).toBe(true);
    const capturedAgain=live.bind(service);
    // No intervening capability or registry reads: both transitions must retire the original lifetime.
    on=false;generation++;for(const listener of listeners)listener();
    on=true;generation++;for(const listener of listeners)listener();
    expect((await capturedAgain.dispatch({kind:"holo.refresh"})).ok).toBe(false);
    expect(live.bind(service).capability({kind:"holo.refresh"}).available).toBe(true);
    const docs=renderCatalogue();for(const kind of Object.keys(HOLOTABLE_ACTIONS))expect(docs).toContain(kind);expect(docs).toContain("experiment holotable");
    const golden=JSON.parse(readFileSync(new URL("./golden/spec-fields.json",import.meta.url),"utf8"));
    expect(golden.experimentActions.holotable).toEqual({speed:{values:HOLOTABLE_ACTIONS["holo.speed"].payload.speed.values},scope:HOLOTABLE_ACTIONS["holo.speed"].scope,undo:HOLOTABLE_ACTIONS["holo.speed"].undo,changeScope:{layer:HOLOTABLE_ACTIONS["holo.change.scope"].payload.layer}});
  }finally{f.ctl.abort();}
});

test("brackets are scoped to the Holotable view and do not fire while typing",()=>{
  expect(keyBinding("holotable",{key:"["})?.id).toBe("holo.change.previous");expect(keyBinding("holotable",{key:"]"})?.id).toBe("holo.change.next");
  expect(keyBinding("head",{key:"["})).toBeUndefined();expect(keyBinding("holotable",{key:"["},{textInput:true})).toBeUndefined();
  expect(SPEEDS.game.map(s=>s.value)).toEqual([1,60,600,3600]);
});


test("the presentation uses the live registry snapshot and captured module facade refuses after off and replacement",async()=>{
 const f=await fixture();try{
   let on=true,generation=0;let registered=holotableFacade(f.service);
   const experiments: ExperimentPort={snapshot:()=>[],set:async(_id,enabled)=>{on=enabled;generation++;return{ok:true};},registrationGeneration:()=>generation,
     registrations:()=>on?[{module:HOLOTABLE_MODULE,service:registered,renderer:{feature:"holotable" as never,create:()=>({dispose(){}})}}]:[],subscribe:()=>()=>{},onRegistrationsChanged:()=>()=>{}};
   const {shell}=trustedFixture({presentation:{experiments}});
   const captured=shell.module("holotable")!;
   expect(shell.authoring.registry().filter(row=>row.id.startsWith("holo.")).length).toBe(Object.keys(HOLOTABLE_ACTIONS).length);
   await experiments.set("holotable",false);
   expect(shell.module("holotable")).toBeUndefined();expect(shell.authoring.registry().some(row=>row.id==="holo.play")).toBe(false);
   expect(captured.capability({kind:"holo.refresh"}).available).toBe(false);expect((await captured.dispatch({kind:"holo.refresh"})).ok).toBe(false);
   registered=holotableFacade(f.service);await experiments.set("holotable",true);
   expect(shell.module("holotable")!.capability({kind:"holo.refresh"}).available).toBe(true);expect(captured.capability({kind:"holo.refresh"}).available).toBe(false);
 }finally{f.ctl.abort();}
});


test("playback bar collapses views before speed, with expansion hysteresis",()=>{
  expect(playbackBarStage(0,700,600,500)).toBe(0);
  expect(playbackBarStage(0,599,600,500)).toBe(1);
  expect(playbackBarStage(1,605,600,500)).toBe(1);
  expect(playbackBarStage(1,616,600,500)).toBe(0);
  expect(playbackBarStage(1,499,600,500)).toBe(2);
  expect(playbackBarStage(2,510,600,500)).toBe(2);
  expect(playbackBarStage(2,516,600,500)).toBe(1);
  expect(playbackBarStage(0,300,600,500)).toBe(2);
  expect(playbackBarStage(2,700,600,500)).toBe(0);
});


test("a temporary shared stepping scope skips other layers and clears on hide, removal and new set",async()=>{
 const original=layers,f=await fixture();try{
  await f.service.dispatch({kind:"holo.change.scope",layer:"p/a"});
  await f.service.dispatch({kind:"holo.seek",t:2});await f.service.dispatch({kind:"holo.change.next"});expect(f.service.snapshot().t).toBe(5);
  await f.service.dispatch({kind:"holo.change.previous"});expect(f.service.snapshot().t).toBe(2);
  await f.service.dispatch({kind:"holo.agentLayer",id:"p/a",on:false});expect(f.service.snapshot().changeScope).toBeNull();
  expect(f.service.capability({kind:"holo.change.scope",layer:"p/a"}).available).toBe(false);
  await f.service.dispatch({kind:"holo.agentLayer",id:"p/a",on:true});await f.service.dispatch({kind:"holo.change.scope",layer:"p/a"});
  layers={...layers,layers:layers.layers.filter(l=>l.id!=="p/a")};await f.service.dispatch({kind:"holo.seek",t:1});expect(f.service.snapshot().changeScope).toBeNull();
  layers=original;await f.service.dispatch({kind:"holo.seek",t:2});await f.service.dispatch({kind:"holo.change.scope",layer:"p/a"});
  await f.service.dispatch({kind:"holo.open",dir:"game"});expect(f.service.snapshot().changeScope).toBeNull();
  await f.service.dispatch({kind:"holo.change.scope",layer:"p/b"});await f.service.dispatch({kind:"holo.producer",producer:"p",on:false});expect(f.service.snapshot().changeScope).toBeNull();
 }finally{layers=original;f.ctl.abort();}
});


test("animation preparation is lazy, deadline-bound and resumable for 5,000 revisions and removals",()=>{
 let now=0,reads=0;
 const effects=playbackEffects<number>(()=>now);
 function* snapshot(version:number){for(let i=0;i<5000;i++){reads++;yield{key:String(i),version,visual:i};}}
 effects.observe(snapshot(0),true,"same",false);expect(reads).toBe(0);
 expect(effects.prepare(()=>false)).toEqual({visited:0,pending:true});expect(reads).toBe(0);
 let budget=5;expect(effects.prepare(()=>budget-->0)).toEqual({visited:5,pending:true});expect(reads).toBe(5);
 for(const version of [0,1]){
  if(version)effects.observe(snapshot(version),true,"same",false);
  let pending=true,frames=0;
  while(pending&&frames++<50){const before=reads,step=effects.prepare();expect(step.visited).toBeLessThanOrEqual(EFFECT_WORK);expect(reads-before).toBeLessThanOrEqual(EFFECT_WORK);pending=step.pending;}
  expect(pending).toBe(false);expect(frames).toBeGreaterThan(10);
 }
 effects.observe([],true,"same",false);
 let frames=0,pending=true;
 while(pending&&frames++<50){const step=effects.prepare();expect(step.visited).toBeLessThanOrEqual(EFFECT_WORK);pending=step.pending;}
 expect(pending).toBe(false);expect(frames).toBeGreaterThan(10);
 now=300;for(let i=0;i<25;i++)effects.frame();expect(effects.frame().pending).toBe(false);
});

test("preparation finishes its slice sequence while coalescing newer answers instead of restarting",()=>{
 const effects=playbackEffects<number>(()=>0),rows=Array.from({length:5000},(_,i)=>({key:String(i),version:0,visual:i}));
 effects.observe(rows,true,"one",false);
 for(let i=0;i<19;i++){effects.prepare();effects.observe(rows,true,"one",false);}
 // The first baseline completes after 5,000 visits despite repeated answers. The queued changed answer then pulses.
 const changed=rows.map(row=>({...row,version:1}));effects.observe(changed,true,"one",false);
 for(let i=0;i<25;i++)effects.prepare();expect(effects.frame().effects.some(effect=>effect.kind==="pulse")).toBe(true);
});
