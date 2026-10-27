/** Owns a headless browser and ephemeral server; never connects to the game or the active Studio. */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../xf-studio/authoring/tools/cdp";
import { loadWorldPack, region, boxOf } from "../src/world";
import { worldContentFiles } from "../src/world-content-files";
import { createSolidWorkerPort } from "../src/solid-worker-port";
import type { Vec3 } from "../src/model";
const affiliationReview=Bun.argv.includes("--affiliations"),names=Bun.argv.includes("--names")||affiliationReview;
const root=resolve(import.meta.dir,"../../.."),output=join(root,`local/holotable/evidence/${names?"w1-names":"w1-layers"}`),authoring=join(root,"projects/xf-studio/authoring");mkdirSync(output,{recursive:true});
const pack=loadWorldPack(join(root,"local/holotable/world-pack.json"));if(!pack)throw Error("Prepared world pack required");
const content=await Bun.file(join(root,"local/holotable/world/kabuki.content.json")).json();
const center:Vec3=(content.pois.find((p:any)=>p.kind==="Ripperdoc")??content.spots[0]).at,owner=worldContentFiles(join(root,"local/holotable/world"));
const scratch=join(output,"solid-cache"),solids=createSolidWorkerPort(scratch),prepareCtl=new AbortController(),prepareTimer=setTimeout(()=>prepareCtl.abort(Error("Geometry preparation deadline")),45000);
let geometry;
try{geometry=await solids.around([center],350,prepareCtl.signal);if(!geometry.solids.length)throw Error("No real W0 geometry was prepared");console.log(`Prepared ${geometry.solids.length} real solids`);}
finally{clearTimeout(prepareTimer);solids.close();rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
const built=await Bun.build({entrypoints:[join(import.meta.dir,"w1-layers-preview-client.ts")],target:"browser",format:"esm"});if(!built.success)throw Error(built.logs.join("\n"));const script=await built.outputs[0].text();
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
 const url=new URL(request.url);if(url.pathname==="/studio.css")return new Response(Bun.file(join(authoring,"public/studio.css")),{headers:{"content-type":"text/css"}});
 if(url.pathname==="/client.js")return new Response(script,{headers:{"content-type":"text/javascript"}});
 if(url.pathname==="/center")return Response.json(center);
 if(url.pathname==="/world"){const p=await request.json(),path:Vec3[]=[p.center??center],base=region(pack,boxOf(path),350);return Response.json({...base,...geometry,content:p.missing?{available:false,slices:["kabuki"],pois:[],spots:[],communities:[]}:owner.around(pack,path,350,p.content===true,request.signal)});}
 if(url.searchParams.get("verify")!=="1")return new Response("Verification workspace required",{status:400});
 return new Response('<!doctype html><html><meta charset="utf-8"><title>W1 verification</title><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>',{headers:{"content-type":"text/html"}});
}});
const baseline=Bun.argv.includes("--baseline"),designFixes=Bun.argv.includes("--design-fixes"),selectionCounts=Bun.argv.includes("--selection-counts");
let page:Session|undefined;const results:unknown[]=[];
try{
 page=await launch(`http://127.0.0.1:${server.port}/?verify=1`,{width:2050,height:850,motion:"reduce",args:["--disable-gpu","--no-sandbox"]});
 for(const theme of (selectionCounts?["light"]:["light","dark"]))for(const width of (selectionCounts?[850]:[300,850])){
  await page.viewport(width*2+340,850);await page.send("Page.navigate",{url:`http://127.0.0.1:${server.port}/?verify=1&theme=${theme}&width=${width}${names?"&names=1":""}`});
  await page.waitFor('document.body.dataset.ready==="true"&&globalThis.w1.service.snapshot().open?.world.content?.spots.length>0',15000);
  await page.waitFor('globalThis.w1.frames.length>0&&!globalThis.w1.frames.at(-1).pending&&globalThis.w1.frames.at(-1).solids>0',15000);
  const prefix=`${theme}-${width}`;
  if(affiliationReview&&theme==="light"&&width===850){await page.screenshot(join(output,"affiliation-overview.png"));}
  if(names){
   for(const type of (affiliationReview?["communities"]:["communities","pois"])){
    await page.evaluate(`globalThis.w1.focus('${type}')`);await page.waitFor('!globalThis.w1.frames.at(-1).pending',10000);
    const card=await page.evaluate('(()=>{const c=document.querySelector("[data-holo-card]"),d=document.querySelector(".holotable-details");return {text:c?.textContent,overflow:d.scrollWidth>d.clientWidth+1};})()');
    if(card.overflow||!card.text||card.text.includes("unnamed character"))throw Error(JSON.stringify(card));
    await page.screenshot(join(output,`${prefix}-${type}-card.png`));results.push({theme,width,type,...card});
   }
   continue;
  }
  if(baseline){await page.evaluate('(async()=>{for(const id of ["pois","spots","communities"])await globalThis.w1.service.dispatch({kind:"holo.layer",id,on:false})})()');await page.waitFor('!globalThis.w1.frames.at(-1).pending',15000);}
  else if(!selectionCounts)await page.screenshot(join(output,`${prefix}-overview.png`));
  if(selectionCounts){
   const read=`()=>Object.fromEntries([["pois","Places of interest"],["spots","Gathering spots"],["communities","Communities"]].map(([id,title])=>{const row=[...document.querySelectorAll(".holotable-details .toggle-row")].find(el=>el.textContent.includes(title));return [id,Number(row?.textContent.match(/(\\d+) on the map now/)?.[1]??NaN)];}))`;
   const transition=await page.evaluate(`(async()=>{const read=${read},before=read();await globalThis.w1.focus("communities");return {before,selected:read(),model:globalThis.w1.service.visibleBaseCounts("holotable.view")};})()`);
   await page.waitFor('!globalThis.w1.frames.at(-1).pending',10000);
   const settled=await page.evaluate(`(${read})()`);
   if(!Object.values(transition.before).every(n=>typeof n==="number"&&n>0)||JSON.stringify(transition.before)!==JSON.stringify(transition.selected)||JSON.stringify(transition.before)!==JSON.stringify(settled))throw Error(JSON.stringify({transition,settled}));
   await page.screenshot(join(output,`${prefix}-communities-card.png`));
   results.push({theme,width,...transition,settled});continue;
  }
  if(designFixes){
   await page.evaluate("globalThis.w1.focus('communities')");await page.waitFor('!globalThis.w1.frames.at(-1).pending',10000);await page.screenshot(join(output,`${prefix}-communities-card.png`));
   const card=await page.evaluate('(()=>{const c=document.querySelector("[data-holo-card]");return {when:c.textContent.match(/\\d+ time phases?/)?.[0],spots:[...c.querySelectorAll("button")].map(b=>b.textContent).filter(s=>s.startsWith("Spot · ")),overflow:document.querySelector(".holotable-details").scrollWidth>document.querySelector(".holotable-details").clientWidth+1}})()');
   await page.evaluate("globalThis.w1.focus('pois')");await page.waitFor('!globalThis.w1.frames.at(-1).pending',10000);await page.screenshot(join(output,`${prefix}-close.png`));
   const close=await page.evaluate('(()=>{const s=globalThis.w1.service.snapshot(),view=document.querySelector(".holotable-panel");return {counts:globalThis.w1.service.visibleBaseCounts("holotable.view"),communitiesOn:s.layers.communities,overflow:view.scrollWidth>view.clientWidth+1}})()');
   if(card.overflow||close.overflow||!card.when||!card.spots.length||close.counts.communities===0)throw Error(JSON.stringify({card,close}));
   results.push({theme,width,card,close});continue;
  }
  const bounds=await page.evaluate('(()=>{const r=document.querySelector(".holotable-panel svg").getBoundingClientRect();globalThis.w1.frames.length=0;return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  await page.mouse("mousePressed",bounds.x+bounds.width/2,bounds.y+bounds.height/2,{button:"left",buttons:1});
  for(let i=0;i<120;i++){await page.mouse("mouseMoved",bounds.x+bounds.width/2+Math.sin(i/20)*60,bounds.y+bounds.height/2+Math.cos(i/20)*20,{buttons:1});await page.evaluate('new Promise(r=>requestAnimationFrame(r))');}
  await page.mouse("mouseReleased",bounds.x+bounds.width/2,bounds.y+bounds.height/2,{button:"left",buttons:0});
  const frames=await page.evaluate('globalThis.w1.frames'),times=frames.map((f:any)=>f.ms).sort((a:number,b:number)=>a-b),timing={median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1),frames:times.length,maxSolids:Math.max(...frames.map((f:any)=>f.solids)),pending:frames.filter((f:any)=>f.pending).length};
  if(baseline){results.push({theme,width,timing});continue;}
  for(const type of ["pois","spots","communities"]){
   if(type==="communities")await page.evaluate('globalThis.w1.service.dispatch({kind:"holo.view.back",view:"holotable.view"})');
   await page.evaluate(`globalThis.w1.focus('${type}')`);await page.waitFor('!globalThis.w1.frames.at(-1).pending',10000);await page.screenshot(join(output,`${prefix}-${type}-card.png`));}
  // A close view keeps both POI plates and unlabelled spot dots on the same map.
  await page.evaluate("globalThis.w1.focus('pois')");await page.screenshot(join(output,`${prefix}-close.png`));
  await page.evaluate('globalThis.w1.service.dispatch({kind:"holo.select",id:null})');await page.evaluate('document.querySelector(".holotable-details").scrollTop=10000');await page.screenshot(join(output,`${prefix}-show.png`));
  await page.evaluate('globalThis.w1.missing()');await page.waitFor('globalThis.w1.service.snapshot().open.world.content?.available===false',5000);
  const acceptance=await page.evaluate('(()=>{const el=document.querySelector(".holotable-details");return {missing:(el.textContent.match(/Not built yet/g)||[]).length,hint:el.textContent.includes("World content for this district hasn\'t been prepared"),overflow:[...document.querySelectorAll(".holotable-panel,.holotable-details")].some(el=>el.scrollWidth>el.clientWidth+1)}})()');
  if(acceptance.missing!==3||!acceptance.hint||acceptance.overflow)throw Error(JSON.stringify(acceptance));await page.screenshot(join(output,`${prefix}-not-built.png`));results.push({theme,width,timing,acceptance});
 }
 if(page.console.some(e=>e.type==="exception"||e.type==="error"))throw Error(JSON.stringify(page.console));
 writeFileSync(join(output,selectionCounts?"selection-counts.json":designFixes?"design-review.json":baseline?"baseline-measurements.json":"measurements.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await page?.close();server.stop(true);owner.close();}
