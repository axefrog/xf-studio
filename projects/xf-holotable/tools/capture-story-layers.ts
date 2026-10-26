// Private real-spool verification, isolated from the active draft and the game bridge.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session as BrowserSession } from "../../xf-studio/authoring/tools/cdp.ts";
import { createService, defaultOptions } from "../src/service.ts";
import { FakeBridge } from "../tests/live-fake.ts";

const [layersRoot, worldPack] = process.argv.slice(2);
if (!layersRoot || !worldPack) throw Error("Usage: capture-story-layers.ts <layers folder> <world-pack.json>");
const output = resolve(import.meta.dir,"../../../local/holotable/evidence/story-layers");
mkdirSync(output,{recursive:true});
const service = createService({...defaultOptions(), layersRoot:resolve(layersRoot), worldPackPath:resolve(worldPack), liveBridge:new FakeBridge(), solidCacheDir:resolve(import.meta.dir,"../../../local/holotable/cache")});
const contexts: { params: Record<string,unknown>; error?: string; solids?: number }[] = [];
let pending = 0;
const around = service.handlers["world.around"];
service.handlers["world.around"] = async (params, signal) => {
  const record = {params} as (typeof contexts)[number]; contexts.push(record);pending++;
  try { const result = await around(params,signal) as any; record.solids=result.solids?.length; return result; }
  catch (error) { record.error=String((error as Error).message);throw error; }
  finally { pending--; }
};
const list = service.handlers["runs.list"];
service.handlers["runs.list"] = async (params, signal) => (await list(params,signal) as any[]).filter(r=>r.standalone ? r.dir.startsWith("layers:story-engine/") : r.run===4);
const built=await Bun.build({entrypoints:[join(import.meta.dir,"layers-preview-client.ts")],target:"browser",format:"esm"});
if(!built.success)throw Error(built.logs.join("\n"));
const script=await built.outputs[0].text(), authoring=resolve(import.meta.dir,"../../xf-studio/authoring");
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==="/studio.css")return new Response(Bun.file(join(authoring,"public/studio.css")),{headers:{"content-type":"text/css"}});
  if(url.pathname==="/client.js")return new Response(script,{headers:{"content-type":"text/javascript"}});
  if(url.pathname==="/context")return Response.json({pending,last:contexts.at(-1)});
  if(url.pathname==="/fixture"&&request.method==="POST"){
    try { const {method,params}=await request.json() as any;return Response.json({ok:true,result:await service.handlers[method](params,request.signal)}); }
    catch(error:any){return Response.json({ok:false,error:{code:error.code??"failed",message:error.message}},{status:502});}
  }
  if(url.searchParams.get("verify")!=="1")return new Response("Verification workspace required",{status:400});
  return new Response('<!doctype html><html><meta charset="utf-8"><title>Story Engine verification</title><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>',{headers:{"content-type":"text/html"}});
}});
let page:BrowserSession|undefined;
const results:unknown[]=[], deadline=setTimeout(()=>{console.error("Story capture exceeded 240 seconds");process.exit(1);},240000);
try {
  page=await launch(`http://127.0.0.1:${server.port}/?verify=1`,{width:1812,height:1170,motion:"reduce",args:["--disable-gpu","--no-sandbox"]});
  for(const day of [1,4])for(const theme of ["light","dark"]){
    await page.send("Page.navigate",{url:`http://127.0.0.1:${server.port}/?verify=1&story=1&case=standalone&day=${day}&theme=${theme}&width=wide`});
    await page.waitFor('document.body.dataset.ready === "true" && !globalThis.holoVerification.frames.at(-1)?.pending',60000);
    // Optional collider work may fail; its result must never change the successful open.
    await page.waitFor('fetch("/context").then(r=>r.json()).then(s=>s.pending===0 && s.last && (s.last.error || (globalThis.holoVerification.service.snapshot().open?.world.solids?.length??0)===s.last.solids))',60000);
    await page.waitFor('!globalThis.holoVerification.frames.at(-1)?.pending',60000);
    const state=await page.evaluate(`(()=>{const s=globalThis.holoVerification.service.snapshot();return{day:${day},theme:${JSON.stringify(theme)},phase:s.phase,title:s.open?.session.meta.standalone?.title,layers:s.agents.layers.length,refused:s.agents.layers.reduce((n,l)=>n+l.refused,0),items:s.agents.layers.reduce((n,l)=>n+l.items.length,0),t:s.t,v:s.open?.session.v.length,error:s.openError,solids:s.open?.world.solids?.length??0}})()`);
    if(state.phase!=="ready"||state.layers!==12||state.refused||state.v!==0||state.error)throw Error(JSON.stringify(state));
    results.push(state);await page.screenshot(join(output,`day-${day}-${theme}-wide.png`));console.log(JSON.stringify(state));
  }
  writeFileSync(join(output,"verification.json"),JSON.stringify({results,contexts},null,2));
  writeFileSync(join(output,"README.txt"),"Private Story Engine Kabuki week spool; schematic generated placements against the offline world. Actual service and solid worker; isolated ?verify=1 panels. No game or runtime bridge tools. Days 1 and 4, wide, light and dark. Optional collider failures are recorded in verification.json.\n");
} finally { clearTimeout(deadline);await page?.close();service.close();server.stop(true); }
