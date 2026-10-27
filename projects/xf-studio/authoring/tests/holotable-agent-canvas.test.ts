import { expect, test } from "bun:test";
import { agentCanvas } from "../src/features/holotable/view/agent-canvas";
import type { AgentAnswer, AgentItem } from "../src/features/holotable/agent-types";
import { camera, ORBITS } from "../src/features/holotable/view/projection";
import { detailFade, motionSpot } from "../src/features/holotable/view/motion-detail";
import { MOTION_FIELD_EDGE, fieldDetails } from "../src/features/holotable/view/field-detail";
import { MOTION_AGENT_LIMIT } from "../src/features/holotable/view/agent-canvas";

function withCanvas(run: (renderer: ReturnType<typeof agentCanvas>, arcs: number[][], strokes: () => number, names: string[], alphas: number[]) => void, options: { reduced?: boolean; now?: () => number; workNow?:()=>number } = {}) {
  const keys=["document","window","MutationObserver","matchMedia","getComputedStyle"];
  const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let strokes=0;const arcs:number[][]=[],names:string[]=[],alphas:number[]=[];
  const makeCanvas=()=>({width:0,height:0,style:{cssText:""},parentElement:{append(){}},after(){},remove(){},setAttribute(){},getContext:()=>({
    globalAlpha:1,drawImage(){},save(){},restore(){},rect(){},translate(){},scale(){},setTransform(){},clearRect(){},moveTo(){},lineTo(){},beginPath(){},closePath(){},stroke(){strokes++;alphas.push(this.globalAlpha);},fill(){alphas.push(this.globalAlpha);},setLineDash(){},arc(...values:number[]){arcs.push(values);},fillText(value:string){names.push(value);},strokeText(){},measureText:(text:string)=>({width:text.length*7}),
  })}) as unknown as HTMLCanvasElement;
  const install=(key:string,value:unknown)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  try {
    install("document",{documentElement:{},body:{},createElement:makeCanvas});install("window",{devicePixelRatio:1});
    install("MutationObserver",class {observe(){}disconnect(){}});install("matchMedia",()=>({matches:options.reduced,addEventListener(){},removeEventListener(){}}));
    install("getComputedStyle",()=>({getPropertyValue:()=>"monospace",backgroundColor:"black"}));
    const renderer=agentCanvas(makeCanvas(),()=>{},options.now,options.workNow);
    try { run(renderer,arcs,()=>strokes,names,alphas); } finally { renderer.dispose(); }
  } finally { for(const key of keys){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);} }
}

test("a path with an off-range first vertex still draws and can be picked where it crosses the view", () => withCanvas((renderer,arcs,strokes)=>{
    const progress=renderer.draw({specs:{schema:"xfh/projections-1",kinds:{path:{style:"tone",label:"{label}",draw:"polyline"}}},here:[],layers:[{id:"p/path",title:"Path",producer:"p",layer:"path",refused:0,reason:"",notPlaced:[],otherBranches:[],items:[{id:"crossing",key:"p/path/crossing",kind:"path",anchor:{path:[[-1000,0,0],[1000,0,0]]},place:[-1000,0,0]}]}]}, {},camera([0,0,0],ORBITS.top,800,500),null,1000);
    expect(progress?.drawn).toBe(1);expect(strokes()).toBeGreaterThan(0);expect(renderer.pick(400,250)).toBe("p/path/crossing");
    const markerAnswer=(count:number)=>({specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",label:"{label}",draw:"ring"}}},here:[],layers:[{id:"p/events",title:"Events",producer:"p",layer:"events",refused:0,reason:"",notPlaced:[],otherBranches:[],items:Array.from({length:count},(_,n)=>({id:String(n).padStart(2,"0"),key:`p/events/${String(n).padStart(2,"0")}`,kind:"point",anchor:{item:"places/cell"},place:[0,0,0] as const}))}]});
    renderer.draw(markerAnswer(12),{},camera([0,0,0],{...ORBITS.top,distance:40},800,500),null,1000);
    expect(arcs[0].slice(0,2)).toEqual([412,250]);
    const reversed=markerAnswer(12);reversed.layers[0].items.reverse();renderer.draw(reversed,{},camera([0,0,0],{...ORBITS.top,distance:40},800,500),null,1000);expect(arcs.at(-1)!.slice(0,2)).toEqual([412,250]);
    renderer.draw(markerAnswer(13),{},camera([0,0,0],ORBITS.top,800,500),null,1000);expect(renderer.pick(400,250)).toBe("plates:p/events/00");
}));

test("a target from-line stays drawn and pickable when its crosshair is offscreen or behind the camera",()=>withCanvas((renderer,_arcs,strokes)=>{
 const C=camera([0,0,0],ORBITS.top,800,500);
 for(const [n,place] of ([[-1000,0,0],C.position.map(n=>n*2)] as const).entries()){
   const from=n?[0,0,0] as const:[1000,0,0] as const, before=strokes();
   const progress=renderer.draw({specs:{schema:"xfh/projections-1",kinds:{target:{style:"tone",label:"{label}",draw:"crosshair"}}},here:[],layers:[{id:"p/targets",title:"Targets",producer:"p",layer:"targets",refused:0,reason:"",notPlaced:[],otherBranches:[],items:[{id:"crossing",key:"p/targets/crossing",kind:"target",anchor:{at:place as [number,number,number]},place:place as [number,number,number],value:{from:{at:from}},to:from}]}]}, {},C,null,1000);
   expect(strokes()).toBeGreaterThan(before);expect(progress?.drawn).toBe(1);
   const midpoint=C.line([place as [number,number,number],from])[0].points;const a=midpoint[0],b=midpoint.at(-1)!;
   expect(renderer.pick((a[0]+b[0])/2,(a[1]+b[1])/2)).toBe("p/targets/crossing");
 }
}));


test("known plates retain kind geometry, selection is 22px and badges 6px; unknown glyphs retain the ordinary marker",()=>withCanvas((renderer,arcs,strokes)=>{
 const answer={specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",label:"{label}",draw:"ring"},zone:{style:"tone",label:"{label}",draw:"volume"}}},here:[],layers:[{id:"p/a",producer:"p",layer:"a",title:"A",notPlaced:[],otherBranches:[],refused:0,reason:"",items:[
   {id:"a",key:"p/a/a",kind:"point",glyph:"fixer",badge:"ready",anchor:{at:[0,0,0] as const},place:[0,0,0] as const},
   {id:"b",key:"p/a/b",kind:"point",glyph:"future",anchor:{at:[20,0,0] as const},place:[20,0,0] as const},
   {id:"zone",key:"p/a/zone",kind:"zone",glyph:"place",anchor:{box:{min:[-20,-20,0] as const,max:[20,20,10] as const}},place:[100,0,5] as const},
 ]}]};
 renderer.draw(answer,{},camera([0,0,0],ORBITS.top,800,500),"p/a/a",1000);
 const radii=arcs.map(a=>a[2]);expect(radii).toContain(11);expect(radii).toContain(3);expect(radii).toContain(9);expect(radii).toContain(6.8);expect(strokes()).toBeGreaterThan(7);
}));

const point=(id="a",version=0):AgentItem=>({id,key:`p/a/${id}`,version,kind:"point",anchor:{at:[10,0,0]},place:[10,0,0]});
const answer=(items:readonly AgentItem[]):AgentAnswer=>({specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",label:"{label}",draw:"ring"},actor:{style:"tone",label:"{name}",draw:"diamond"},path:{style:"tone",label:"{label}",draw:"polyline"},zone:{style:"tone",label:"{label}",draw:"volume"},field:{style:"tone",label:"",draw:"grid"}}},here:[],layers:[{id:"p/a",title:"A",producer:"p",layer:"a",notPlaced:[],otherBranches:[],refused:0,reason:"",items}]});

test("cached spot paint reaches opacity one across the fade deadline and a reduced-motion switch",()=>{
 for(const switchReduced of [false,true])withCanvas((renderer,_arcs,_strokes,_names,alphas)=>{
  let time=0;const fade=detailFade(()=>time),data=answer([]),enabled={},C=camera([0,0,0],ORBITS.top,850,500);
  const id=Array.from({length:20},(_,n)=>String(n)).find(id=>!motionSpot(id))!;
  const base={content:{available:true,slices:[],pois:[],communities:[],spots:[{id,place:"test",at:[0,0,0] as const,yaw:0,communities:[]}]},on:{pois:false,spots:true,communities:false}};
  const draw=(moving:boolean,reduced=false)=>{
    const revision=fade.begin(moving,reduced);
    const result=renderer.draw(data,enabled,C,null,4,null,[],350,{playing:false,epoch:"fade"},base,{moving,revision,opacity:key=>fade.opacity(key)});
    fade.end();if(!moving&&!result?.pending&&!fade.pending())fade.reset();
    return result;
  };
  expect(draw(true)?.pending).toBe(false);alphas.length=0;
  expect(draw(false)?.pending).toBe(false);expect(alphas.at(-1)).toBe(0);
  time=75;draw(false);expect(alphas.at(-1)).toBe(.5);
  time=switchReduced?80:160;const before=alphas.length;
  expect(draw(false,switchReduced)?.pending).toBe(false);
  expect(alphas.length).toBeGreaterThan(before);expect(alphas.at(-1)).toBe(1);
  expect(renderer.pick(...C.point([0,0,0])!)).toBe(`base:spots:${id}`);
 },{workNow:()=>0});
});

const denseFields=():AgentItem[]=>Array.from({length:4},(_,i)=>({...point(`field-${i}`),kind:"field",place:[0,0,0],anchor:{grid:{origin:[-128,-128,0],cols:128,rows:128,cell:2}},value:{scalars:Array.from({length:128*128},(_,n)=>n%17)}}));

test("four 128-square fields keep finite preparation and motion paint bounds, then restore all cells",()=>{
 let clock=0;
 withCanvas(renderer=>{
  const data=answer(denseFields()),enabled={};let C=camera([0,0,0],{...ORBITS.top,distance:200},850,500);
  const draw=(moving:boolean,budget=4)=>renderer.draw(data,enabled,C,null,budget,null,[],350,{playing:false,epoch:"fields"},undefined,{moving,revision:0,opacity:()=>1});
  expect(draw(true,-1)?.pending).toBe(true);expect(renderer.accounting().fieldCells).toBe(0);
  const unboundedStart=clock;expect(draw(true,Infinity)?.pending).toBe(true);
  expect(clock-unboundedStart).toBeLessThan(8.1); // A bad caller cannot disable the guard.
  // Injected work clock charges each preparation/16-cell yield, independent of CPU speed.
  let slices=0,result:ReturnType<typeof draw>;
  do{const before=clock;result=draw(true);expect(clock-before).toBeLessThan(4.1);slices++;}while(result?.pending&&slices<1000);
  expect(slices).toBeGreaterThan(0);expect(slices).toBeLessThan(1000);
  expect(renderer.items()).toHaveLength(4);expect(renderer.accounting().fieldCells).toBe(4*MOTION_FIELD_EDGE**2);
  expect(renderer.accounting().omitted).toBe(0);
  for(const yaw of [.1,.2,.3]){
   C=camera([0,0,0],{...ORBITS.top,distance:200,yaw},850,500);
   const before=clock;expect(draw(true)?.pending).toBe(false);expect(clock-before).toBeLessThan(4);
   expect(renderer.accounting()).toMatchObject({drawn:4,omitted:0,fieldCells:4*MOTION_FIELD_EDGE**2});
  }
  const source=data.layers[0].items;
  const aggregate=fieldDetails(),steps=aggregate(source[0]);let step=steps.next();while(!step.done)step=steps.next();
  const block=128/MOTION_FIELD_EDGE;
  expect(step.value?.scalars?.[0]).toBeCloseTo(Array.from({length:block},(_,y)=>Array.from({length:block},(_,x)=>(y*128+x)%17)).flat().reduce((a,b)=>a+b)/block**2);
  slices=0;while(draw(false)?.pending&&++slices<1000){}
  expect(slices).toBeLessThan(1000);expect(renderer.accounting().fieldCells).toBe(4*128**2);
 },{workNow:()=>clock+=.01});
});

test("extreme motion item counts prefer selection then nearest and disclose omitted items",()=>withCanvas(renderer=>{
 const data=answer(Array.from({length:600},(_,n)=>({...point(String(n)),place:[n/10,0,0] as const})));
 const selected="p/a/599",C=camera([0,0,0],ORBITS.top,850,500);
 renderer.draw(data,{},C,selected,4,null,[],350,{playing:false,epoch:"crowded"},undefined,{moving:true,revision:0,opacity:()=>1});
 expect(renderer.items()).toHaveLength(MOTION_AGENT_LIMIT);
 expect(renderer.items().slice(0,3).map(i=>i.key)).toEqual([selected,"p/a/0","p/a/1"]);
 expect(renderer.accounting()).toMatchObject({eligible:600,drawn:MOTION_AGENT_LIMIT,omitted:600-MOTION_AGENT_LIMIT,priority:"selected, then nearest to target"});
},{workNow:()=>0}));

test("finite full-resolution field paint resumes across fade revisions and cached repaints reread no cells",()=>{
 let clock=0,reads=0;
 const fields=denseFields().map(item=>({...item,value:{scalars:new Proxy(item.value!.scalars!,{get(target,key,receiver){if(typeof key==="string"&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}})}}));
 withCanvas(renderer=>{
  const data=answer(fields),enabled={},C=camera([0,0,0],{...ORBITS.top,distance:200},850,500);
  let revision=0;
  const draw=(moving:boolean)=>renderer.draw(data,enabled,C,null,4,null,[],350,{playing:false,epoch:"fade-fields"},undefined,{moving,revision:moving?0:++revision,opacity:()=>1});
  let slices=0;while(draw(true)?.pending&&++slices<100){}
  expect(slices).toBeLessThan(100);
  slices=0;while(draw(false)?.pending&&++slices<100){}
  expect(slices).toBeGreaterThan(1);expect(slices).toBeLessThan(100);
  expect(renderer.accounting().fieldCells).toBe(4*128**2);
  expect(reads).toBe(2*4*128**2);const before=reads;
  expect(draw(false)?.pending).toBe(false);expect(reads).toBe(before);
 },{workNow:()=>clock+=.01});
});

test("motion keeps the complete point, path, zone, label and relation item geometry",()=>withCanvas((renderer,_arcs,_strokes,names)=>{
 const items:AgentItem[]=[point(),{...point("path"),kind:"path",anchor:{path:[[-120,50,0],[0,70,0],[120,50,0]]}},{...point("zone"),kind:"zone",anchor:{box:{min:[-20,-20,0],max:[20,20,10]}}},{...point("label"),kind:"label",label:"Authored label",place:[-80,0,0]},{...point("relation"),kind:"relation",place:[40,0,0],to:[120,0,0],value:{type:"knows"}}];
 const base=answer(items),data={...base,specs:{...base.specs,kinds:{...base.specs.kinds,label:{draw:"text",label:"{label}",style:"tone"},relation:{draw:"curve",label:"{type}",style:"tone"}}}};
 expect(renderer.draw(data,{},camera([0,0,0],ORBITS.top,850,500),null,4,null,[],350,{playing:false,epoch:"geometry"},undefined,{moving:true,revision:0,opacity:()=>1})?.pending).toBe(false);
 expect(renderer.items().map(i=>i.key).sort()).toEqual(items.map(i=>i.key).sort());
 expect(renderer.items().find(i=>i.kind==="path")?.anchor).toBe(items[1].anchor);expect(names).toContain("Authored label");
 expect(renderer.accounting().omitted).toBe(0);
},{workNow:()=>0}));

test("motion completes every enabled agent layer; context detail never dims agents or changes effect age",()=>{
 let now=0;
 withCanvas((renderer,arcs,_strokes,_names,alphas)=>{
  const items=Array.from({length:80},(_,n)=>({...point(String(n)),place:[(n%10-5)*15,(Math.floor(n/10)-4)*15,0] as const}));
  const enabled={},C=camera([0,0,0],{...ORBITS.top,distance:200},850,500),playback={playing:true,epoch:"continuous"};
  const fade=detailFade(()=>now);fade.begin(true,false);
  const detail={moving:true,revision:0,opacity:(key:string)=>fade.opacity(key)};
  const first=renderer.draw(answer(items),enabled,C,null,1000,null,[],350,playback,undefined,detail);
  expect(first?.pending).toBe(false);expect(renderer.items()).toHaveLength(80);
  const changed=items.map((item,n)=>n===0?{...item,version:1}:item);
  const second=renderer.draw(answer(changed),enabled,C,null,1000,null,[],350,playback,undefined,detail);
  expect(second?.pending).toBe(false);expect(second?.total).toBe(80);expect(renderer.animate()).toBe(true);
  fade.end();fade.begin(false,false);now=150;arcs.length=0;alphas.length=0;
  renderer.draw(answer(changed),enabled,camera([0,0,0],{...ORBITS.top,distance:200,yaw:.05},850,500),null,1000,null,[],350,playback,undefined,{...detail,moving:false,revision:150});
  expect(renderer.animate()).toBe(true);expect(alphas).toContain(.5);
  now=300;expect(renderer.animate()).toBe(false);
 },{now:()=>now});
});


test("only marker snapshots fade for 300 ms, with an opacity ramp and reduced-motion refusal",async()=>{
 const [base,removed]=[answer([point()]),answer([])];
 for(const reduced of [false,true]){
  let now=0;
  withCanvas((renderer,_arcs,strokes,_names,alphas)=>{
   const C=camera([0,0,0],ORBITS.top,800,500),enabled={},playback={playing:true,epoch:"one"};
   renderer.draw(base,enabled,C,null,1000,null,[],350,playback);renderer.draw(removed,enabled,C,null,1000,null,[],350,playback);
   const before=strokes();alphas.length=0;now=150;expect(renderer.animate()).toBe(!reduced);expect(strokes()>before).toBe(!reduced);
   if(!reduced)expect(alphas).toContain(.5);
   now=300;expect(renderer.animate()).toBe(false);
  },{reduced,now:()=>now});
 }
});

test("pause and navigation clear an in-flight ring before a new layer response",async()=>{
 const [base,changed]=[answer([point()]),answer([point("a",1)])];
 withCanvas(renderer=>{
  const C=camera([0,0,0],ORBITS.top,800,500),enabled={};
  for(const mode of ["pause","seek"]){
   renderer.draw(base,enabled,C,null,1000,null,[],350,{playing:true,epoch:"one"});
   renderer.draw(changed,enabled,C,null,1000,null,[],350,{playing:true,epoch:"one"});expect(renderer.animate()).toBe(true);
   renderer.draw(changed,enabled,C,null,1000,null,[],350,{playing:mode!=="pause",epoch:mode==="seek"?"two":"one"});expect(renderer.animate()).toBe(false);
  }
 });
});

test("painted glyph plates block ordinary labels while either selected item's name remains visible",()=>withCanvas((renderer,_arcs,_strokes,names)=>{
 const items=[{id:"a",key:"p/a",kind:"actor",glyph:"fixer",anchor:{at:[0,0,0] as const},place:[0,0,0] as const,value:{name:"Fixer"}},
  {id:"b",key:"p/b",kind:"actor",glyph:"clinic",anchor:{at:[35,0,0] as const},place:[35,0,0] as const,value:{name:"Clinic"}}];
 const answer={specs:{schema:"xfh/projections-1",kinds:{actor:{draw:"diamond",style:"tone",label:"{name}"}}},here:[],layers:[{id:"p/l",producer:"p",layer:"l",title:"L",refused:0,reason:"",notPlaced:[],otherBranches:[],items}]};
 const C=camera([0,0,0],ORBITS.top,300,300),enabled={};
 renderer.draw(answer,enabled,C,null,1000);expect(names).not.toContain("Fixer");
 names.length=0;renderer.draw(answer,enabled,C,"p/a",1000);expect(names).toContain("Fixer");
 names.length=0;renderer.draw(answer,enabled,C,"p/b",1000);expect(names).toContain("Clinic");
}));


test("following a moving camera preserves pulse and fade age and reprojects both at each frame",async()=>{
 const [base,changed,removed]=[answer([point()]),answer([point("a",1)]),answer([])];
 let now=0;withCanvas((renderer,arcs)=>{
  const enabled={},playback={playing:true,epoch:"continuous"},start=camera([0,0,0],ORBITS.top,800,500);
  renderer.draw(base,enabled,start,null,1000,null,[],350,playback);renderer.draw(changed,enabled,start,null,1000,null,[],350,playback);
  now=100;const moving=camera([1,0,0],ORBITS.top,800,500);renderer.draw(changed,enabled,moving,null,1000,null,[],350,playback);
  arcs.length=0;expect(renderer.animate()).toBe(true);expect(arcs.at(-1)!.slice(0,2)).toEqual(moving.point([10,0,0])!);expect(arcs.at(-1)![2]).toBeCloseTo(6.8+3+100/300*10);
  renderer.draw(removed,enabled,moving,null,1000,null,[],350,playback);
  now=200;const followed=camera([2,3,0],ORBITS.top,800,500);renderer.draw(removed,enabled,followed,null,1000,null,[],350,playback);
  arcs.length=0;expect(renderer.animate()).toBe(true);expect(arcs.at(-1)!.slice(0,2)).toEqual(followed.point([10,0,0])!);expect(arcs.at(-1)![2]).toBeCloseTo(6.8);
  now=400;expect(renderer.animate()).toBe(false);
 },{now:()=>now});
});

test("full to structure to retraction cannot redraw a stale name, label or story text",async()=>{
 const full={...point(),kind:"actor",glyph:"fixer",label:"secret label",detail:"secret detail",value:{name:"secret name",facets:{doing:"secret thought"}}};
 const [base,structure,removed]=[answer([full]),answer([{...point(),kind:"actor",glyph:"fixer",value:{name:"actor"}}]),answer([])];
 let now=0;withCanvas((renderer,_arcs,strokes,names)=>{
  const C=camera([0,0,0],ORBITS.top,800,500),enabled={},playback={playing:true,epoch:"same"};
  renderer.draw(base,enabled,C,null,1000,null,[],350,playback);expect(names).toContain("secret name");
  renderer.draw(structure,enabled,C,null,1000,null,[],350,playback);names.length=0;renderer.draw(removed,enabled,C,null,1000,null,[],350,playback);
  const before=strokes();now=150;expect(renderer.animate()).toBe(true);expect(strokes()).toBeGreaterThan(before);expect(names).toEqual([]);
 },{now:()=>now});
});

test("two answers before a paint preserve the last painted marker's retraction",()=>withCanvas((renderer,arcs)=>{
 const C=camera([0,0,0],ORBITS.top,800,500),enabled={},playback={playing:true,epoch:"one"};
 renderer.draw(answer([point()]),enabled,C,null,1000,null,[],350,playback);
 let latest=answer([point("a",1),point("unseen")]);latest=answer([]); // Answers arrive without an intervening paint.
 renderer.draw(latest,enabled,C,null,1000,null,[],350,playback);
 arcs.length=0;expect(renderer.animate()).toBe(true);expect(arcs).toHaveLength(1);expect(arcs[0].slice(0,2)).toEqual(C.point(point().place!)!);expect(arcs[0][2]).toBe(6.8);
}));

test("not-placed, culled, offscreen and hidden items never pulse or fade",()=>withCanvas(renderer=>{
 const C=camera([0,0,0],ORBITS.top,800,500),playback={playing:true,epoch:"one"};
 const draw=(a:AgentAnswer,enabled={})=>renderer.draw(a,enabled,C,null,1000,null,[],350,playback);
 const unplaced={...answer([point()]),layers:[{...answer([point()]).layers[0],notPlaced:["a"]}]};
 draw(answer([]));draw(unplaced);expect(renderer.animate()).toBe(false);draw(answer([]));expect(renderer.animate()).toBe(false);
 draw(answer([point()]));draw(unplaced);expect(renderer.animate()).toBe(false);
 draw(answer([point()]));draw(answer([{...point(),place:[10000,0,0]}]));expect(renderer.animate()).toBe(false);
 draw(answer([point()]));
 renderer.draw(answer([point()]),{}, {...C,point:()=>[1000,0] as const},null,1000,null,[],350,playback);expect(renderer.animate()).toBe(false);
 draw(answer([point()]));draw(answer([]),{"p/a":false});expect(renderer.animate()).toBe(false);
 draw(answer([point()]));draw({...answer([]),layers:[]});expect(renderer.animate()).toBe(false);
}));

test("pulses use the 12 px fan-out and a retraction keeps that offset while following",()=>withCanvas((renderer,arcs)=>{
 const items=[{...point("a"),glyph:"fixer"},{...point("b"),glyph:"fixer"}],enabled={},playback={playing:true,epoch:"one"},C=camera([0,0,0],ORBITS.top,800,500);
 renderer.draw(answer(items),enabled,C,null,1000,null,[],350,playback);
 renderer.draw(answer(items.map(i=>({...i,version:1}))),enabled,C,null,1000,null,[],350,playback);
 arcs.length=0;renderer.animate();const center=C.point(items[0].place!)!;
 expect(arcs.map(a=>a.slice(0,2))).toEqual([[center[0]+12,center[1]],[center[0]-12,center[1]+Math.sin(Math.PI)*12]]);
 const followed=camera([1,2,0],ORBITS.top,800,500);
 renderer.draw(answer([{...items[0],version:1}]),enabled,followed,null,1000,null,[],350,playback);
 arcs.length=0;renderer.animate();const fade=arcs.find(a=>a[2]===9)!,projected=followed.point(items[1].place!)!;
 expect(fade[0]).toBeCloseTo(projected[0]-12);expect(fade[1]).toBeCloseTo(projected[1]);
}));

test("a budget-hit frame and its resumed slices reset the baseline without effects",()=>withCanvas(renderer=>{
 const C=camera([0,0,0],ORBITS.top,800,500),enabled={},playback={playing:true,epoch:"one"};
 const draw=(a:AgentAnswer,budget=1000)=>renderer.draw(a,enabled,C,null,budget,null,[],350,playback);
 draw(answer([point()]));const partial=answer([point("a",1)]);
 expect(draw(partial,-1)!.pending).toBe(true);expect(renderer.animate()).toBe(false);
 expect(draw(partial)!.pending).toBe(false);expect(renderer.animate()).toBe(false);
 draw(answer([point("a",2)]));expect(renderer.animate()).toBe(false);
 draw(answer([point("a",3)]));expect(renderer.animate()).toBe(true);
}));

test("more than 512 painted markers give no effects and reset the baseline",()=>withCanvas(renderer=>{
 const items=Array.from({length:513},(_,i)=>({...point(String(i)),place:[-50+(i%30)*3,-30+Math.floor(i/30)*3,0] as const}));
 const C={...camera([0,0,0],ORBITS.top,2000,2000),point:(p:readonly number[])=>[700+p[0]*8,700+p[1]*8] as [number,number]},enabled={},playback={playing:true,epoch:"one"};
 const draw=(a:AgentAnswer)=>renderer.draw(a,enabled,C,null,1000,null,[],350,playback);
 draw(answer(items.slice(0,512)));draw(answer(items.map(i=>({...i,version:1}))));expect(renderer.animate()).toBe(false);
 draw(answer([point()]));expect(renderer.animate()).toBe(false);
 draw(answer([point("a",1)]));expect(renderer.animate()).toBe(true);
}));

test("paths and zones vanish; a retired field fades only its plate without reading old geometry",()=>withCanvas((renderer,arcs,strokes,names)=>{
 let retired=false;
 const field:AgentItem={...point("field"),kind:"field",glyph:"goal",get anchor(){if(retired)throw Error("Fade read geometry");return {grid:{origin:[10,0,0] as const,rows:1,cols:1,cell:10}};},get value(){if(retired)throw Error("Fade read field values");return {scalars:[1]};}};
 const base=answer([{...point("path"),kind:"path",glyph:"waypoint",place:[80,0,0],anchor:{path:[[0,0,0],[10,0,0]]}},{...point("zone"),kind:"zone",glyph:"place",place:[120,0,0],anchor:{box:{min:[0,0,0],max:[10,10,10]}}},field]);
 const C=camera([0,0,0],ORBITS.top,800,500),enabled={},playback={playing:true,epoch:"one"};
 renderer.draw(base,enabled,C,null,1000,null,[],350,playback);retired=true;
 renderer.draw(answer([]),enabled,C,null,1000,null,[],350,playback);
 const before=strokes();arcs.length=0;names.length=0;expect(renderer.animate()).toBe(true);expect(strokes()-before).toBeLessThanOrEqual(2);expect(arcs.filter(a=>a[2]===9)).toHaveLength(1);expect(names).toEqual([]);
}));

test("a deadline before painting reads none of 5,000 versions",()=>{
 let reads=0;const items=Array.from({length:5000},(_,i)=>({...point(String(i)),get version(){reads++;return 1;}}));
 withCanvas(renderer=>{const result=renderer.draw(answer(items),{},camera([0,0,0],ORBITS.top,800,500),null,-1,null,[],350,{playing:true,epoch:"one"});expect(result!.pending).toBe(true);expect(reads).toBe(0);expect(renderer.animate()).toBe(false);});
});


test("legend counts only visible placed items, including clustered members; clustered markers have no effects",()=>withCanvas((renderer,_arcs,_strokes,names)=>{
 const items=[{...point("a"),place:[0,0,0] as const,glyph:"fixer"},{...point("b"),place:[1,0,0] as const,glyph:"courier"},{...point("far"),place:[10000,0,0] as const,glyph:"clinic"}],C=camera([0,0,0],ORBITS.top,800,500),enabled={},playback={playing:true,epoch:"one"};
 const base=answer(items);renderer.draw(base,enabled,C,null,1000,null,[],350,playback);
 expect(renderer.clusters()).toHaveLength(1);expect(renderer.pick(renderer.clusters()[0].x,renderer.clusters()[0].y)).toBe(renderer.clusters()[0].key);
 expect(renderer.legend().map(e=>[e.family,e.count])).toEqual([["person",2]]);
 renderer.draw(answer(items.map(i=>({...i,version:1}))),enabled,C,null,1000,null,[],350,playback);expect(renderer.animate()).toBe(false);expect(names).not.toContain("a");
 renderer.draw(base,{"p/a":false},C,null,1000);expect(renderer.legend()).toEqual([]);expect(renderer.clusters()).toEqual([]);
 renderer.draw({...base,layers:[{...base.layers[0],notPlaced:["b"]}]},enabled,C,null,1000);expect(renderer.legend().map(e=>[e.family,e.count])).toEqual([["person",1]]);
}));


test("a selected plate and overlapping count plate each own their centre hit",()=>withCanvas(renderer=>{
 const items=[{...point("selected"),place:[0,0,0] as const,glyph:"fixer"},{...point("b"),place:[.1,0,0] as const,glyph:"courier"},{...point("c"),place:[.2,0,0] as const,glyph:"courier"}],C=camera([0,0,0],ORBITS.top,800,500);
 renderer.draw(answer(items),{},C,"p/a/selected",1000);const cluster=renderer.clusters()[0],xy=C.point([0,0,0])!;
 expect(renderer.pick(...xy)).toBe("p/a/selected");expect(renderer.pick(cluster.x,cluster.y)).toBe(cluster.key);
 expect(Math.hypot(cluster.x-xy[0],cluster.y-xy[1])).toBeGreaterThanOrEqual(28);
}));


test("clustering a relation's plate preserves the curve's world endpoints",()=>withCanvas(renderer=>{
 const a={...point("a"),place:[0,0,0] as const,glyph:"fixer"},b={...point("b"),place:[.1,0,0] as const,glyph:"courier"};
 const relation:AgentItem={...point("r"),kind:"relation",glyph:"story",place:[.2,0,0],to:[100,0,0],links:{from:a.key,to:"remote"},value:{type:"knows"}};
 const base=answer([a,b,relation]),data={...base,specs:{...base.specs,kinds:{...base.specs.kinds,relation:{draw:"curve",style:"tone",label:"{type}"}}}},C=camera([50,0,0],ORBITS.top,800,500);
 renderer.draw(data,{},C,null,1000);expect(renderer.clusters()).toHaveLength(1);
 const from=C.point([0,0,0])!,to=C.point([100,0,0])!,dx=to[0]-from[0],dy=to[1]-from[1],len=Math.hypot(dx,dy),bend=Math.min(24,len*.16),mid=[(from[0]+to[0])/2-dy/len*bend,(from[1]+to[1])/2+dx/len*bend],k=.25;
 expect(renderer.pick((1-k)**2*from[0]+2*(1-k)*k*mid[0]+k*k*to[0],(1-k)**2*from[1]+2*(1-k)*k*mid[1]+k*k*to[1])).toBe(relation.key);
}));


test("clustered target keeps its from-line and picking without labels or effects",()=>withCanvas((renderer,_arcs,strokes,names)=>{
 const target:AgentItem={...point("target"),kind:"target",glyph:"goal",place:[0,0,0],anchor:{at:[0,0,0]},to:[100,0,0],label:"Hidden target"};
 const neighbour:AgentItem={...point("neighbour"),place:[0.001,0,0],glyph:"goal"};
 const base=answer([target,neighbour]),data={...base,specs:{...base.specs,kinds:{...base.specs.kinds,target:{style:"tone",label:"{label}",draw:"crosshair"}}}};
 const C=camera([50,0,0],ORBITS.top,800,500),mid=C.point([50,0,0])!;
 renderer.draw(data,{},C,null,1000,null,[],350,{playing:true,epoch:"cluster"});
 expect(renderer.clusters()).toHaveLength(1);expect(strokes()).toBeGreaterThan(0);expect(renderer.pick(...mid)).toBe(target.key);expect(names).not.toContain("Hidden target");
 renderer.draw(answer([]),{},C,null,1000,null,[],350,{playing:true,epoch:"cluster"});expect(renderer.animate()).toBe(false);
}));

test("clustered actor keeps its volume outline and picking",()=>withCanvas((renderer)=>{
 const actor:AgentItem={...point("actor"),kind:"actor",glyph:"person",place:[0,0,0],anchor:{box:{min:[-30,-30,0],max:[30,30,10]}}};
 const C=camera([0,0,0],ORBITS.top,800,500);
 renderer.draw(answer([actor,{...point("near"),place:[0.001,0,0],glyph:"goal"}]),{},C,null,1000);
 expect(renderer.clusters()).toHaveLength(1);expect(renderer.pick(...C.point([30,0,0])!)).toBe(actor.key);
}));

test("legend retains its family tone through selection and hover",()=>withCanvas(renderer=>{
 const data=answer([{...point(),kind:"actor",glyph:"fixer",tone:"accent"}]),C=camera([0,0,0],ORBITS.top,300,500);
 for(const [selected,hovered] of [[null,null],["p/a/a",null],[null,"p/a/a"]] as const){renderer.draw(data,{},C,selected,1000,hovered);expect(renderer.legend()[0].tone).toBe("signal");}
}));


test("static world markers use Places counts and unlabelled 3px dots, without pulse or retraction effects",()=>withCanvas((renderer,arcs,_strokes,names)=>{
 const C=camera([0,0,0],{...ORBITS.top,distance:300},850,500),playback={playing:true,epoch:"static"},enabled={},on={pois:true,spots:true,communities:true};
 const content={available:true,slices:["test"],pois:[{id:"p",place:"test",kind:"Ripperdoc",at:[-50,0,0] as const}],spots:[{id:"s",place:"test",at:[50,0,0] as const,yaw:0,communities:[]}],communities:[]};
 renderer.draw(answer([]),enabled,C,null,1000,null,[],350,playback,{content,on});
 expect(arcs.map(a=>a[2])).toContain(1.5);expect(names).not.toContain("Spot");expect(renderer.legend().find(e=>e.family==="place")?.count).toBe(1);expect(renderer.baseCounts()).toEqual({pois:1,spots:1,communities:0});
 expect(renderer.animate()).toBe(false);
 renderer.draw(answer([]),enabled,C,null,1000,null,[],350,playback,{content:{...content,pois:[],spots:[]},on});
 expect(renderer.animate()).toBe(false);
}));


test("overlapping gathering dots never cluster or fan out; plated markers still cluster and Spots follows Places",()=>withCanvas((renderer,arcs,_strokes,names)=>{
 const C=camera([0,0,0],{...ORBITS.top,distance:300},850,500),on={pois:true,spots:true,communities:true};
 const content={available:true,slices:["test"],pois:[{id:"p",place:"test",kind:"Ripperdoc",at:[-50,0,0] as const},{id:"q",place:"test",kind:"Medicine",at:[-50,0,0] as const}],spots:[{id:"s",place:"test",at:[0,0,0] as const,yaw:0,communities:["c"]},{id:"t",place:"test",at:[0,0,0] as const,yaw:0,communities:["c"]}],communities:[{id:"c",place:"test",entries:[]}]};
 renderer.draw(answer([]),{},C,null,1000,null,[],350,{playing:false,epoch:"dots"},{content,on});
 expect(renderer.clusters()).toHaveLength(1);expect(renderer.clusters()[0].items.every(i=>i.base==="pois")).toBe(true);
 expect(arcs.filter(a=>a[2]===1.5).map(a=>a.slice(0,2))).toEqual([C.point([0,0,0])!,C.point([0,0,0])!]);
 expect(renderer.legend().map(e=>[e.family,e.count])).toEqual([["place",2],["spots",2]]);
 expect(names.filter(s=>s.startsWith("Community"))).toEqual(["Community · 2 spots"]);
 arcs.length=0;names.length=0;
 renderer.draw(answer([]),{},camera([0,0,0],{...ORBITS.top,distance:90},850,500),null,1000,null,[],350,{playing:false,epoch:"dots"},{content,on});
 expect(renderer.baseCounts().communities).toBe(1);expect(names.filter(s=>s.startsWith("Community"))).toEqual([]);
}));


test("selecting an item retains complete view counts through a budgeted redraw and identical completion",()=>withCanvas(renderer=>{
 const C=camera([0,0,0],{...ORBITS.top,distance:300},850,500),enabled={},data=answer([]),on={pois:true,spots:true,communities:true};
 const content={available:true,slices:["test"],pois:[{id:"p",place:"test",kind:"Ripperdoc",at:[-50,0,0] as const}],spots:[{id:"s",place:"test",at:[0,0,0] as const,yaw:0,communities:["c"]}],communities:[{id:"c",place:"test",entries:[]}]};
 const draw=(selected:string|null,budget:number)=>renderer.draw(data,enabled,C,selected,budget,null,[],350,{playing:false,epoch:"selection"},{content,on});
 expect(draw(null,1000)?.pending).toBe(false);const before=renderer.baseCounts();expect(before).toEqual({pois:1,spots:1,communities:1});
 for(const selected of ["base:communities:c","base:pois:p",null]){
   expect(draw(selected,-1)?.pending).toBe(true);expect(renderer.baseCounts()).toEqual(before);
   expect(draw(selected,1000)?.pending).toBe(false);expect(renderer.baseCounts()).toEqual(before);
 }
 renderer.clear(850,500);expect(renderer.baseCounts()).toEqual({pois:0,spots:0,communities:0});
}));

test("Show and legend count full map membership equally at rest and in motion",()=>withCanvas(renderer=>{
 const enabled={},data=answer([]),on={pois:true,spots:true,communities:true};
 const content={available:true,slices:["test"],pois:[{id:"p",place:"test",kind:"Ripperdoc",at:[-20,0,0] as const}],communities:[{id:"c",place:"test",entries:[]}],spots:Array.from({length:2500},(_,n)=>({id:`spot-${n}`,place:"test",at:[n/50,0,0] as const,yaw:0,communities:["c"]}))};
 for(const width of [300,850]){
  const C=camera([0,0,0],{...ORBITS.top,distance:300},width,500);
  for(const moving of [false,true,false,true]){
   const result=renderer.draw(data,enabled,C,null,1000,null,[],350,{playing:false,epoch:"counts"},{content,on},{moving,revision:0,opacity:()=>1});
   expect(result?.pending).toBe(false);
   expect(renderer.baseCounts()).toEqual({pois:1,spots:2000,communities:1});
   expect(renderer.legend().map(e=>[e.family,e.count])).toEqual([["place",1],["spots",2000]]);
   const drawn=renderer.items().filter(i=>i.base==="spots").length;
   if(moving){expect(drawn).toBeGreaterThan(400);expect(drawn).toBeLessThan(600);}else expect(drawn).toBe(2000);
  }
 }
 // Even a full set whose single dot is omitted by the stable hash keeps its legend row.
 const id=Array.from({length:20},(_,n)=>String(n)).find(id=>!motionSpot(id))!;
 renderer.draw(data,enabled,camera([0,0,0],ORBITS.top,850,500),null,1000,null,[],350,{playing:false,epoch:"one"},{content:{...content,pois:[],communities:[],spots:[{...content.spots[0],id}]},on},{moving:true,revision:0,opacity:()=>1});
 expect(renderer.items()).toHaveLength(0);expect(renderer.baseCounts().spots).toBe(1);expect(renderer.legend().find(e=>e.family==="spots")?.count).toBe(1);
}));
