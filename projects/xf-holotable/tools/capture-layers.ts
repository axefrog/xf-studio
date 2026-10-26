// Local visual verification: no bridge connection and no writes outside the owned worktree.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session as BrowserSession } from "../../xf-studio/authoring/tools/cdp.ts";
import { createService } from "../src/service.ts";
import { defaultOptions } from "../src/service.ts";
import { readRun } from "../src/recording.ts";
import { loadWorldPack } from "../src/world.ts";
import { emptySolids } from "../src/solid-source.ts";
import { FakeBridge } from "../tests/live-fake.ts";
import { KINDS, type LayerItem, type LayerManifest } from "../src/layers.ts";
import type { SolidRegion, Vec3 } from "../src/model.ts";

const [runDir,worldFile,regionFolder,onlyCase]=process.argv.slice(2);
if(!runDir||!worldFile||!regionFolder)throw Error("Usage: capture-layers.ts <run-4 folder> <world-pack.json> <cached regions folder> [actor|here|cluster|standalone]");
if(onlyCase && !["actor","here","cluster","standalone"].includes(onlyCase))throw Error("Unknown capture case.");
const output=resolve(import.meta.dir,"../../../local/holotable/evidence/agent-layers"),scratch=resolve(import.meta.dir,"../../../local/holotable/scratch/capture-layers");mkdirSync(output,{recursive:true});mkdirSync(scratch,{recursive:true});
const recording=readRun(resolve(runDir)),moment=recording.meta.from+30,v=recording.v.find(v=>v.t>=moment)!,p=v.position;
const world=loadWorldPack(resolve(worldFile))!;
world.areas.push({id:"synthetic-district",name:"Synthetic district",kind:"district",poly:[[p[0]-35,p[1]-35],[p[0]+35,p[1]-35],[p[0]+35,p[1]+35],[p[0]-35,p[1]+35]],zlo:p[2]-2,zhi:p[2]+20,labelPoint:[p[0]+5,p[1]+5,p[2]]});
const pack=join(scratch,"world.json");writeFileSync(pack,JSON.stringify(world));
let solids=emptySolids(),score=Infinity;
for(const f of readdirSync(regionFolder)){if(!f.endsWith(".json"))continue;const region=JSON.parse(readFileSync(join(regionFolder,f),"utf8")) as SolidRegion;
 const near=region.solids.filter(s=>Math.hypot(...s.center.map((x,i)=>x-p[i]))<350);const best=Math.min(...near.map(s=>Math.hypot(...s.center.map((x,i)=>x-p[i]))));if(best<score){score=best;solids={...region,solids:near};}}
const bridge=new FakeBridge(),service=createService({...defaultOptions(),recordingsRoot:resolve(runDir,"../.."),worldPackPath:pack,layersRoot:join(scratch,"layers"),liveBridge:bridge,solidSource:{status:async()=>({cold:false}),around:async()=>solids}});
const listRuns = service.handlers["runs.list"];
service.handlers["runs.list"] = async (params, signal) => (await listRuns(params, signal) as any[]).filter(r => r.standalone || r.dir === resolve(runDir));
const offset=(x:number,y:number,z=0):Vec3=>[p[0]+x,p[1]+y,p[2]+z];
const actor=(id:string,name:string,x:number,y:number):LayerItem=>({id,kind:"actor",anchor:{at:offset(x,y)},value:{name,role:"generated fixer",facets:{doing:"waiting for a courier",thinking:"The route is watched",planning:"Meet at the district boundary"}},cite:`agent:verification:${id}`});
async function publish(layer:string,items:LayerItem[],extra:Partial<LayerManifest>={}){
 const manifest:LayerManifest={schema:"xfh/layer-1",producer:"verification",layer,title:layer.charAt(0).toUpperCase()+layer.slice(1),content:"full",clock:"recording",kinds:[...new Set(items.map(i=>i.kind))],...extra};const result=await service.layers.publish(`verification/${layer}`,[manifest,...items]);if(result.refused)throw Error(result.reasons.join("; "));
}
const cite="agent:verification:synthetic";
await publish("point",[{id:"control",kind:"point",anchor:{at:offset(-35,25)},label:"Control point",cite}]);
await publish("path",[{id:"route",kind:"path",anchor:{path:[offset(-45,-10),offset(-15,20),offset(25,35)]},label:"Proposed route",weight:0.8,cite}]);
await publish("zone",[{id:"territory",kind:"zone",anchor:{box:{min:offset(-30,-25),max:offset(25,25,14)}},label:"Context zone",tone:"warning",cite}]);
await publish("field",[{id:"pressure",kind:"field",anchor:{grid:{origin:offset(-45,-35),cell:10,cols:4,rows:3}},value:{scalars:[0,0.1,0.3,0.5,0.1,0.3,0.6,0.8,0.3,0.5,0.8,1]},tone:"warning",cite}]);
await publish("influence",[{id:"flow",kind:"influence",anchor:{at:offset(-35,-25)},value:{to:{at:offset(30,30)}},tone:"accent",label:"Influence",cite}]);
await publish("target",[{id:"goal",kind:"target",anchor:{at:offset(40,-15)},value:{from:{at:offset(20,0)}},label:"Steering target",cite}]);
await publish("label",[{id:"note",kind:"label",anchor:{at:offset(-50,15)},label:"Synthetic meeting place"}]);
await publish("actor",[actor("mira","Synthetic Mira",-60,0),actor("sol","Synthetic Sol",20,60),actor("kai","Synthetic Kai",65,-45)]);
await publish("relation",[{id:"a-b",kind:"relation",anchor:{item:"actor/mira"},value:{to:{item:"actor/sol"},type:"owes",strength:0.8},cite},{id:"b-c",kind:"relation",anchor:{item:"actor/sol"},value:{to:{item:"actor/kai"},type:"hunting",strength:0.5},cite},{id:"c-a",kind:"relation",anchor:{item:"actor/kai"},value:{to:{item:"actor/mira"},type:"loyal to",mutual:true},cite}]);
await service.layers.publish("verification/point",[{id:"invalid",kind:"point",anchor:{at:["bad",0,0]},cite}]);
await publish("region",Array.from({length:13},(_,i)=>({id:`regional-${i}`,kind:"point",anchor:{region:"synthetic-district"},label:`Regional point ${i}`,cite})));
await publish("week",[...(["save-a","save-b"] as const).flatMap((branch,n)=>[{...actor("mira","Synthetic Mira",n?35:-20,n?25:0),branch,t:0},{...actor("kai","Synthetic Kai",n?-25:25,n?-20:20),branch,t:0},{id:"tie",kind:"relation" as const,anchor:{item:"mira"},value:{to:{item:"kai"},type:n?"rivals":"allies",strength:0.8},branch,t:0,cite}])],{clock:"game",standalone:{set:"week",title:"Synthetic week",from:0,to:604800,clock:"game"}});
const built=await Bun.build({entrypoints:[join(import.meta.dir,"layers-preview-client.ts")],target:"browser",format:"esm"});if(!built.success)throw Error(built.logs.join("\n"));const script=await built.outputs[0].text();
const authoring=resolve(import.meta.dir,"../../xf-studio/authoring");
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){const url=new URL(request.url);
 if(url.pathname==="/studio.css")return new Response(Bun.file(join(authoring,"public/studio.css")),{headers:{"content-type":"text/css"}});
 if(url.pathname==="/client.js")return new Response(script,{headers:{"content-type":"text/javascript"}});
 if(url.pathname==="/fixture"&&request.method==="POST"){try{const{method,params}=await request.json() as any;return Response.json({ok:true,result:await service.handlers[method](params,request.signal)});}catch(e:any){return Response.json({ok:false,error:{code:e.code??"failed",message:e.message}},{status:502});}}
 if(url.searchParams.get("verify")!=="1")return new Response("Verification workspace required",{status:400});
 return new Response('<!doctype html><html><meta charset="utf-8"><title>Holotable agent verification</title><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>',{headers:{"content-type":"text/html"}});
}});
let page:BrowserSession|undefined;const measurements:unknown[]=[];const deadline=setTimeout(()=>{console.error("Capture exceeded 180 seconds");process.exit(1);},180000);
try{
 page=await launch(`http://127.0.0.1:${server.port}/?verify=1`,{width:1500,height:1170,motion:"reduce",args:["--disable-gpu","--no-sandbox"]});
 const cases=[...["full","structure"].map(level=>({name:"actor",level,branch:""})),{name:"here",level:"full",branch:""},{name:"cluster",level:"full",branch:""},...(["save-a","save-b"] as const).map(branch=>({name:"standalone",level:"full",branch}))].filter(c=>!onlyCase||c.name===onlyCase);
 for(const c of cases)for(const theme of ["light","dark"])for(const width of ["narrow","wide"]){
  await page.viewport(width==="narrow"?1452:1812,1170);await page.send("Page.navigate",{url:`http://127.0.0.1:${server.port}/?verify=1&case=${c.name}&theme=${theme}&width=${width}&level=${c.level}&branch=${c.branch}`});await page.waitFor('document.body.dataset.ready === "true" && !globalThis.holoVerification.frames.at(-1)?.pending');
  const result=await page.evaluate(`(()=>{const s=globalThis.holoVerification.service.snapshot(),details=document.querySelector('.holotable-details');return{case:${JSON.stringify(c)},theme:${JSON.stringify(theme)},width:${JSON.stringify(width)},layers:s.agents.layers.length,refused:s.agents.layers.reduce((n,l)=>n+l.refused,0),full:s.level==='full',facets:details.textContent.includes('The route is watched'),here:details.textContent.includes("What's here"),branch:s.branch,overflow:details.scrollWidth>details.clientWidth,frames:globalThis.holoVerification.frames}})()`);
  if(result.overflow||result.layers<1||c.name==="actor"&&(c.level==="full")!==result.facets||c.name==="here"&&!result.here)throw Error(JSON.stringify(result));
  measurements.push(result);await page.screenshot(join(output,`${c.name}-${c.branch||c.level}-${theme}-${width}.png`));console.log(`${c.name} ${c.branch||c.level} ${theme} ${width}: ${result.layers} layers`);
 }
 if(page.console.some(e=>e.type==="exception"||e.type==="error"))throw Error(JSON.stringify(page.console));
 writeFileSync(join(output,onlyCase?`measurements-${onlyCase}.json`:"measurements.json"),JSON.stringify(measurements,null,2));
 writeFileSync(join(output,"README.txt"),"Recorded run 4, synthetic diagnostic content; cached offline collision primitives and world-pack areas. No game or bridge tool was run. Four theme/width variants for actor full/structure, What's here, region cluster/refusal, and each of two standalone branches. Measurements and exact source identity are private.\n");
}finally{clearTimeout(deadline);await page?.close();service.close();server.stop(true);rmSync(scratch,{recursive:true,force:true});}
