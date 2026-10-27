import { expect, test } from "bun:test";
import { agentCanvas } from "../src/features/holotable/view/agent-canvas";
import type { AgentAnswer, AgentItem } from "../src/features/holotable/agent-types";
import { camera, ORBITS } from "../src/features/holotable/view/projection";

function withCanvas(run: (renderer: ReturnType<typeof agentCanvas>, arcs: number[][], strokes: () => number, names: string[], alphas: number[]) => void, options: { reduced?: boolean; now?: () => number } = {}) {
  const keys=["document","window","MutationObserver","matchMedia","getComputedStyle"];
  const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let strokes=0;const arcs:number[][]=[],names:string[]=[],alphas:number[]=[];
  const makeCanvas=()=>({width:0,height:0,style:{cssText:""},parentElement:{append(){}},after(){},remove(){},setAttribute(){},getContext:()=>({
    globalAlpha:1,save(){},restore(){},rect(){},translate(){},scale(){},setTransform(){},clearRect(){},moveTo(){},lineTo(){},beginPath(){},closePath(){},stroke(){strokes++;alphas.push(this.globalAlpha);},fill(){},setLineDash(){},arc(...values:number[]){arcs.push(values);},fillText(value:string){names.push(value);},strokeText(){},measureText:(text:string)=>({width:text.length*7}),
  })}) as unknown as HTMLCanvasElement;
  const install=(key:string,value:unknown)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  try {
    install("document",{documentElement:{},body:{},createElement:makeCanvas});install("window",{devicePixelRatio:1});
    install("MutationObserver",class {observe(){}disconnect(){}});install("matchMedia",()=>({matches:options.reduced,addEventListener(){},removeEventListener(){}}));
    install("getComputedStyle",()=>({getPropertyValue:()=>"monospace",backgroundColor:"black"}));
    const renderer=agentCanvas(makeCanvas(),()=>{},options.now);
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
