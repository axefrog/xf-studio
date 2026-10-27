import { expect, test } from "bun:test";
import { agentCanvas } from "../src/features/holotable/view/agent-canvas";
import { camera, ORBITS } from "../src/features/holotable/view/projection";

function withCanvas(run: (renderer: ReturnType<typeof agentCanvas>, arcs: number[][], strokes: () => number, names: string[]) => void, options: { reduced?: boolean; now?: () => number } = {}) {
  const keys=["document","window","MutationObserver","matchMedia","getComputedStyle"];
  const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let strokes=0;const arcs:number[][]=[],names:string[]=[];
  const makeCanvas=()=>({width:0,height:0,style:{cssText:""},parentElement:{append(){}},after(){},remove(){},setAttribute(){},getContext:()=>({
    save(){},restore(){},rect(){},translate(){},scale(){},setTransform(){},clearRect(){},moveTo(){},lineTo(){},beginPath(){},closePath(){},stroke(){strokes++;},fill(){},setLineDash(){},arc(...values:number[]){arcs.push(values);},fillText(value:string){names.push(value);},strokeText(){},measureText:(text:string)=>({width:text.length*7}),
  })}) as unknown as HTMLCanvasElement;
  const install=(key:string,value:unknown)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  try {
    install("document",{documentElement:{},body:{},createElement:makeCanvas});install("window",{devicePixelRatio:1});
    install("MutationObserver",class {observe(){}disconnect(){}});install("matchMedia",()=>({matches:options.reduced,addEventListener(){},removeEventListener(){}}));
    install("getComputedStyle",()=>({getPropertyValue:()=>"monospace",backgroundColor:"black"}));
    const renderer=agentCanvas(makeCanvas(),()=>{},options.now);
    try { run(renderer,arcs,()=>strokes,names); } finally { renderer.dispose(); }
  } finally { for(const key of keys){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);} }
}

test("a path with an off-range first vertex still draws and can be picked where it crosses the view", () => withCanvas((renderer,arcs,strokes)=>{
    const progress=renderer.draw({specs:{schema:"xfh/projections-1",kinds:{path:{style:"tone",label:"{label}",draw:"polyline"}}},here:[],layers:[{id:"p/path",title:"Path",producer:"p",layer:"path",refused:0,reason:"",notPlaced:[],otherBranches:[],items:[{id:"crossing",key:"p/path/crossing",kind:"path",anchor:{path:[[-1000,0,0],[1000,0,0]]},place:[-1000,0,0]}]}]}, {},camera([0,0,0],ORBITS.top,800,500),null,1000);
    expect(progress?.drawn).toBe(1);expect(strokes()).toBeGreaterThan(0);expect(renderer.pick(400,250)).toBe("p/path/crossing");
    const markerAnswer=(count:number)=>({specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",label:"{label}",draw:"ring"}}},here:[],layers:[{id:"p/events",title:"Events",producer:"p",layer:"events",refused:0,reason:"",notPlaced:[],otherBranches:[],items:Array.from({length:count},(_,n)=>({id:String(n).padStart(2,"0"),key:`p/events/${String(n).padStart(2,"0")}`,kind:"point",anchor:{item:"places/cell"},place:[0,0,0] as const}))}]});
    renderer.draw(markerAnswer(12),{},camera([0,0,0],ORBITS.top,800,500),null,1000);
    expect(arcs[0].slice(0,2)).toEqual([412,250]);
    const reversed=markerAnswer(12);reversed.layers[0].items.reverse();renderer.draw(reversed,{},camera([0,0,0],ORBITS.top,800,500),null,1000);expect(arcs.at(-1)!.slice(0,2)).toEqual([412,250]);
    renderer.draw(markerAnswer(13),{},camera([0,0,0],ORBITS.top,800,500),null,1000);expect(renderer.pick(410,240)).toBe("cluster:[0,0,0]");
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
   {id:"zone",key:"p/a/zone",kind:"zone",glyph:"place",anchor:{box:{min:[-20,-20,0] as const,max:[20,20,10] as const}},place:[0,0,5] as const},
 ]}]};
 renderer.draw(answer,{},camera([0,0,0],ORBITS.top,800,500),"p/a/a",1000);
 const radii=arcs.map(a=>a[2]);expect(radii).toContain(11);expect(radii).toContain(3);expect(radii).toContain(9);expect(radii).toContain(6.8);expect(strokes()).toBeGreaterThan(7);
}));

test("animation replays a retired item's cached drawing, and reduced motion suppresses it",()=>{
 for(const reduced of [false,true]){
   let now=0;
   withCanvas((renderer,arcs,strokes)=>{
     const C=camera([0,0,0],ORBITS.top,800,500), base={specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",label:"{label}",draw:"ring"}}},here:[],layers:[{id:"p/a",producer:"p",layer:"a",title:"A",notPlaced:[],otherBranches:[],refused:0,reason:"",items:[{id:"a",key:"p/a/a",version:0,kind:"point",anchor:{at:[0,0,0] as const},place:[0,0,0] as const}]}]};
     renderer.draw(base,{},C,null,1000,null,[],350,{playing:true,epoch:"one"});
     renderer.draw({...base,layers:[{...base.layers[0],items:[]}]},{},C,null,1000,null,[],350,{playing:true,epoch:"one"});
     const before=strokes();now=150;const pending=renderer.animate();expect(strokes()>before).toBe(!reduced);expect(pending).toBe(!reduced);
     now=300;expect(renderer.animate()).toBe(false);
   },{reduced,now:()=>now});
 }
});


test("pause and navigation clear an in-flight ring before a new layer response",()=>{
 let now=0;withCanvas((renderer)=>{
   const C=camera([0,0,0],ORBITS.top,800,500), enabled={}, base={specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",label:"{label}",draw:"ring"}}},here:[],layers:[{id:"p/a",producer:"p",layer:"a",title:"A",notPlaced:[],otherBranches:[],refused:0,reason:"",items:[{id:"a",key:"p/a/a",version:0,kind:"point",anchor:{at:[0,0,0] as const},place:[0,0,0] as const}]}]};
   for(const mode of ["pause","seek"]){
     renderer.draw(base,enabled,C,null,1000,null,[],350,{playing:true,epoch:"one"});
     const changed={...base,layers:[{...base.layers[0],items:[{...base.layers[0].items[0],version:1}]}]};
     renderer.draw(changed,enabled,C,null,1000,null,[],350,{playing:true,epoch:"one"});expect(renderer.animate()).toBe(true);
     renderer.draw(changed,enabled,C,null,1000,null,[],350,{playing:mode!=="pause",epoch:mode==="seek"?"two":"one"});expect(renderer.animate()).toBe(false);
   }
 },{now:()=>now});
});


test("painted glyph plates block other labels while either selected item's name remains visible",()=>withCanvas((renderer,_arcs,_strokes,names)=>{
 const items=[{id:"a",key:"p/a",kind:"actor",glyph:"fixer",anchor:{at:[0,0,0] as const},place:[0,0,0] as const,value:{name:"Fixer"}},
  {id:"b",key:"p/b",kind:"actor",glyph:"clinic",anchor:{at:[35,0,0] as const},place:[35,0,0] as const,value:{name:"Clinic"}}];
 const answer={specs:{schema:"xfh/projections-1",kinds:{actor:{draw:"diamond",style:"tone",label:"{name}"}}},here:[],layers:[{id:"p/l",producer:"p",layer:"l",title:"L",refused:0,reason:"",notPlaced:[],otherBranches:[],items}]};
 const C=camera([0,0,0],ORBITS.top,300,300),enabled={};
 renderer.draw(answer,enabled,C,null,1000);expect(names).not.toContain("Fixer");
 names.length=0;renderer.draw(answer,enabled,C,"p/a",1000);expect(names).toContain("Fixer");expect(names).not.toContain("Clinic");
 names.length=0;renderer.draw(answer,enabled,C,"p/b",1000);expect(names).toContain("Clinic");expect(names).not.toContain("Fixer");
}));
