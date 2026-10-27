import { expect, test } from "bun:test";
import { adaptiveSolids, cameraMotion, detailFade, DETAIL_FADE_MS, MOTION_SETTLE_MS, MOTION_DRAW_MS, motionSpot } from "../src/features/holotable/view/motion-detail";
import { camera, ORBITS } from "../src/features/holotable/view/projection";
import { createSolidSelection } from "../src/features/holotable/view/solid-selection";
import { solidCanvas } from "../src/features/holotable/view/solid-canvas";
import { baseLayerSteps, baseLayerItems, createSpotOrder } from "../src/features/holotable/view/base-layers";
import type { HoloContent, HoloSolid } from "../src/features/holotable/types";

test("motion follows orbit, pan, zoom, focus and following targets, then settles without input", () => {
  let time = 0;
  const state = cameraMotion(() => time);
  const view = { yaw: 0, pitch: .6, distance: 300, pan: [0, 0], center: [0, 0, 0] };
  expect(state.frame(JSON.stringify(view))).toBe(false);
  for (const next of [{ ...view, yaw: .1 }, { ...view, pan: [10, 0] }, { ...view, distance: 200 }, { ...view, center: [20, 0, 0] }]) {
    const key = JSON.stringify(next);
    expect(state.frame(key)).toBe(true);
    time += MOTION_SETTLE_MS - 1; expect(state.frame(key)).toBe(true);
    time++; expect(state.frame(key)).toBe(false);
  }
  expect(state.frame("focus", true)).toBe(true);
  time += MOTION_SETTLE_MS; expect(state.frame("focus", true)).toBe(true);
  time += MOTION_SETTLE_MS; expect(state.frame("focus")).toBe(false);
  state.reset(); expect(state.frame("another view")).toBe(false);
});

test("allocation-free point visibility agrees with projecting and clipping the point",()=>{
  for(const orbit of Object.values(ORBITS))for(const width of [300,850]){
    const C=camera([12,-8,4],orbit,width,500);
    for(let i=0;i<500;i++){
      const p=[Math.sin(i)*1000,Math.cos(i*3)*1000,Math.sin(i*2)*500] as const,q=C.point(p);
      expect(C.inView(p)).toBe(!!q&&q[0]>=0&&q[0]<=width&&q[1]>=0&&q[1]<=500);
    }
  }
});

test("adaptive solid count converges, holds and responds to a more expensive cost model", () => {
  const budget = adaptiveSolids();
  const converge = (fixed: number, unit: number) => {
    const history: number[] = [];
    for (let i = 0; i < 100; i++) {
      const count = budget.limit();
      expect(count).toBeGreaterThanOrEqual(32); expect(count).toBeLessThanOrEqual(900);
      history.push(count); budget.observe(fixed + count * unit, count * unit, count);
    }
    expect(new Set(history.slice(-10)).size).toBe(1);
    expect(fixed + budget.limit() * unit).toBeLessThanOrEqual(MOTION_DRAW_MS+.01);
    return budget.limit();
  };
  const first = converge(2, .01), second = converge(3, .02);
  expect(second).toBeLessThan(first);
  expect(converge(1, .005)).toBeGreaterThan(second);
  budget.observe(NaN, 1, 3); expect(Number.isFinite(budget.limit())).toBe(true);
});

test("adaptive costs are independent for each theme/canvas and include full raster overhead",()=>{
  const budget=adaptiveSolids();
  for(let i=0;i<100;i++)for(const [context,unit,overhead] of [["dark:850@1",.004,.5],["light:850@1",.012,1],["light:300@2",.02,.8]] as const){
    const n=budget.limit(context),raster=overhead+n*unit;
    budget.observe(2+raster,raster,n,context);
  }
  expect(budget.limit("dark:850@1")).toBeGreaterThan(budget.limit("light:850@1"));
  expect(budget.limit("light:850@1")).toBeGreaterThan(budget.limit("light:300@2"));
  const calibrated=budget.limit("dark:850@1");
  budget.observe(20,18,100,"light:850@1");
  expect(budget.limit("dark:850@1")).toBe(calibrated);
  expect(budget.limit("new-theme:850@2")).toBe(32);
});

test("canvas cost keys follow theme, size and DPR without hiding a required theme repaint",()=>{
  const keys=["document","window","getComputedStyle","matchMedia","MutationObserver"],saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let colour="dark",strokes=0,invalidate=()=>{};
  const install=(key:string,value:unknown)=>Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  try{
    install("document",{documentElement:{},body:{}});install("window",{devicePixelRatio:1});
    install("getComputedStyle",()=>({color:colour,borderTopColor:colour}));
    install("matchMedia",()=>({addEventListener(){},removeEventListener(){}}));
    install("MutationObserver",class{constructor(callback:()=>void){invalidate=callback;}observe(){}disconnect(){}});
    const canvas={style:{},width:0,height:0,getContext:()=>({setTransform(){},clearRect(){},setLineDash(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){strokes++;}})} as unknown as HTMLCanvasElement;
    const renderer=solidCanvas(canvas,()=>{}),C=camera([0,0,0],ORBITS.tilt,850,500);
    const solid:HoloSolid={id:"box",kind:"box",center:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],size:[2,2,2]};
    const instances=createSolidSelection().step([solid],[0,0,0],C,Infinity).instances;
    try{
      const dark=renderer.costKey(850,500);renderer.draw(instances,C);const first=strokes;
      renderer.costKey(850,500);renderer.draw(instances,C);expect(strokes).toBe(first);
      colour="light";invalidate();expect(renderer.costKey(850,500)).not.toBe(dark);
      renderer.draw(instances,C);expect(strokes).toBeGreaterThan(first);
      const light=renderer.costKey(850,500);expect(renderer.costKey(300,500)).not.toBe(light);
      (globalThis as any).window.devicePixelRatio=2;expect(renderer.costKey(850,500)).not.toBe(light);
    }finally{renderer.dispose();}
  }finally{for(const key of keys){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

test("complete motion selection visits bounded source work and keeps the largest projected N", () => {
  const solids: HoloSolid[] = Array.from({ length: 12000 }, (_, i) => ({ id: String(i), kind: "box", center: [(i % 100 - 50) * 2, (Math.floor(i / 100) - 60) * 2, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], size: [1, 1, 1] }));
  const C = camera([0, 0, 0], ORBITS.tilt, 850, 500);
  let checks = 0;
  const selection = createSolidSelection(() => { checks++; return 0; });
  for (const cap of [32, 100, 900, 0]) {
    const result = selection.step(solids, [0, 0, 0], C, Infinity, cap);
    expect(result.pending).toBe(false); expect(result.instances.length).toBe(cap);
    const ranked = createSolidSelection().step(solids, [0, 0, 0], C, Infinity).instances.sort((a, b) => b.extentPx - a.extentPx || a.id.localeCompare(b.id)).slice(0, cap);
    // Stable lexical id tie-break is the same as the production heap.
    expect(result.instances.map(s => s.extentPx).sort((a, b) => b - a)).toEqual(ranked.map(s => s.extentPx));
  }
  expect(checks).toBe(0); // Complete bounded passes don't ask the wall clock for every primitive.
});

test("motion spots are a stable hash subset of the ordinary nearest-dot set", () => {
  const content: HoloContent = { available: true, slices: [], pois: [], communities: [], spots: Array.from({ length: 5000 }, (_, n) => ({ id: `spot-${n}`, place: "test", at: [n / 100, 0, 0], yaw: 0, communities: [] })) };
  const on = { pois: false, spots: true, communities: false }, C = camera([0, 0, 0], ORBITS.top, 850, 500);
  const run = (source: HoloContent) => {
    const steps = baseLayerSteps(source, on, C, true); let step = steps.next(), work = 0;
    while (!step.done) { work++; step = steps.next(); }
    expect(work).toBeLessThan(300);
    return step.value.map(s => s.id).sort();
  };
  const full = baseLayerItems(content, on, C).map(s => s.id).filter(motionSpot).sort();
  expect(run(content)).toEqual(full); expect(full.length).toBeGreaterThan(400); expect(full.length).toBeLessThan(600);
  expect(run({ ...content, spots: [...content.spots].reverse() })).toEqual(full);
});

test("new resting detail fades for 150 ms; retained detail and reduced motion stay opaque", () => {
  let time = 0;
  const fade = detailFade(() => time);
  fade.begin(false, false); expect(fade.opacity("cold")).toBe(1);
  fade.begin(true, false); expect(fade.opacity("retained")).toBe(1); fade.end();
  fade.begin(false, false); expect(fade.opacity("retained")).toBe(1); expect(fade.opacity("new")).toBe(0); expect(fade.pending()).toBe(true);
  time = DETAIL_FADE_MS / 2; expect(fade.opacity("new")).toBe(.5);
  time = DETAIL_FADE_MS; expect(fade.opacity("new")).toBe(1); expect(fade.pending()).toBe(false);
  fade.begin(false, true); expect(fade.opacity("reduced")).toBe(1); expect(fade.pending()).toBe(false);
  fade.begin(true, false); fade.opacity("different"); fade.end();
  fade.begin(false, false); expect(fade.opacity("retained")).toBe(0);
  fade.reset(); expect(fade.opacity("cold")).toBe(1);
});

test("per-view spot ranking reuses a stationary target and preserves exact viewport membership",()=>{
  const content:HoloContent={available:true,slices:[],pois:[],communities:[],spots:Array.from({length:4000},(_,n)=>({id:String(n),place:"test",at:[Math.sin(n)*240,Math.cos(n)*240,n%3],yaw:0,communities:[]}))};
  const order=createSpotOrder(),center=[0,0,0] as const,on={pois:false,spots:true,communities:false};
  const drain=<T>(steps:Generator<void,T>)=>{let step=steps.next(),work=0;while(!step.done){work++;step=steps.next();}return {value:step.value,work};};
  expect(drain(order(content,center)).value).toBeUndefined();
  const ranked=drain(order(content,center));expect(ranked.value).toHaveLength(4000);expect(ranked.work).toBeGreaterThan(100);expect(ranked.work).toBeLessThan(1000);
  expect(drain(order(content,center))).toEqual({value:ranked.value,work:0});
  for(const yaw of [0,.8,2])for(const moving of [false,true]){
    const C=camera(center,{...ORBITS.tilt,yaw},850,500);
    const cached=drain(baseLayerSteps(content,on,C,moving,ranked.value)).value;
    const heap=drain(baseLayerSteps(content,on,C,moving)).value;
    expect(cached.map(i=>i.id).sort()).toEqual(heap.map(i=>i.id).sort());
  }
  expect(drain(order(content,[10,0,0])).value).toBeUndefined();
  expect(drain(order({...content},center)).value).toBeUndefined();
});
