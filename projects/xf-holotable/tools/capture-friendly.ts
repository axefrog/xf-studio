/** Synthetic friendly-map acceptance. Owns its headless browser and ephemeral loopback server. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkFriendlyNavigation } from "./friendly-navigation-acceptance";
import { launch, type Session } from "../../xf-studio/authoring/tools/cdp";
const output=resolve(import.meta.dir,"../../../local/holotable/evidence/friendly");mkdirSync(output,{recursive:true});
const built=await Bun.build({entrypoints:[join(import.meta.dir,"friendly-preview-client.ts")],target:"browser",format:"esm"});if(!built.success)throw Error(built.logs.join("\n"));
const script=await built.outputs[0].text(),authoring=resolve(import.meta.dir,"../../xf-studio/authoring");
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){const url=new URL(request.url);if(url.pathname==="/studio.css")return new Response(Bun.file(join(authoring,"public/studio.css")),{headers:{"content-type":"text/css"}});if(url.pathname==="/client.js")return new Response(script,{headers:{"content-type":"text/javascript"}});if(url.searchParams.get("verify")!=="1")return new Response("Verification workspace required",{status:400});return new Response('<!doctype html><html><meta charset="utf-8"><title>Friendly map verification</title><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>',{headers:{"content-type":"text/html"}});}});
const reviewOnly=Bun.argv.includes("--review-only"),selectedOnly=Bun.argv.includes("--selected-only"),layoutOnly=Bun.argv.includes("--layout-only"),inputOnly=Bun.argv.includes("--input-only");
let page:Session|undefined;const results:unknown[]=[];
try{
 page=await launch(`http://127.0.0.1:${server.port}/?verify=1`,{width:1520,height:840,motion:"no-preference",args:["--disable-gpu","--no-sandbox"]});
 for(const theme of (selectedOnly?["dark"]:["light","dark"]))for(const width of (selectedOnly?[300]:[300,850])){
  await page.viewport(width+670,840);
  await page.send("Page.navigate",{url:`http://127.0.0.1:${server.port}/?verify=1&theme=${theme}&width=${width}&clock=game`});
  await page.waitFor('document.body.dataset.ready==="true"',15000);
  await page.waitFor('globalThis.holoVerification.frames.length>0',5000);
  await page.waitFor("globalThis.holoVerification.service.snapshot().open.world.areas.length>0",5000);
  const navigation=inputOnly||!reviewOnly&&!selectedOnly&&!layoutOnly?await checkFriendlyNavigation(page):undefined;
  if(inputOnly){results.push({theme,width,navigation});continue;}
  const prefix=`${theme}-${width}`;
  const initial=await page.evaluate('globalThis.holoVerification.frames.at(-1).target');
  const inspect=await page.evaluate(`(()=>{const d=document.querySelector('.holotable-details'),c=d.querySelector('[data-holo-card]'),t=[...c.querySelectorAll('button')].find(b=>b.textContent==='Technical');return {summary:c.textContent.includes('Waiting for the courier.'),technical:t.getAttribute('aria-expanded'),facet:c.textContent.includes('Affiliation'),count:d.textContent.includes('of 31 in this set'),district:[...document.querySelectorAll('.holotable-panel svg text')].some(t=>t.textContent==='Synthetic district'),overflow:document.querySelector('.holotable-panel').scrollWidth>document.querySelector('.holotable-panel').clientWidth};})()`);
  if(!selectedOnly&&!layoutOnly)await page.screenshot(join(output,`${prefix}-overview-card-closed.png`));
  if(!inspect.summary||inspect.technical!=="false"||!inspect.facet||!inspect.count||!inspect.district||inspect.overflow)throw Error(JSON.stringify({inspect,debug:await page.evaluate(`(()=>{const panel=document.querySelector(".holotable-panel");return {model:globalThis.holoVerification.debug(),texts:[...panel.querySelectorAll("svg text")].map(t=>t.textContent),sizes:[...panel.querySelectorAll("*")].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({tag:e.tagName,cls:e.className,w:e.clientWidth,sw:e.scrollWidth,text:e.textContent.slice(0,120)})),frames:globalThis.holoVerification.frames.slice(-2)}})()`)}));
  if(reviewOnly||selectedOnly||layoutOnly){
    const layout=await page.evaluate(`(()=>{const bar=document.querySelector('.holotable-panel .control-line'),b=[...bar.querySelectorAll('button')].find(b=>b.textContent.startsWith('Quiet until')),r=b.getBoundingClientRect(),line=bar.getBoundingClientRect(),style=getComputedStyle(b),text=b.querySelector('span');return {width:r.width,textWidth:text.getBoundingClientRect().width,padding:[style.paddingLeft,style.paddingRight,style.borderLeftWidth,style.borderRightWidth].reduce((n,s)=>n+parseFloat(s),0),rightGap:line.right-r.right,grow:style.flexGrow};})()`);
    if(layout.grow!=="0"||Math.abs(layout.rightGap)>1||width===850&&layout.width>layout.textWidth+layout.padding+1)throw Error(JSON.stringify(layout));
    await page.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.view.focus',view:'holotable.view',id:'synthetic/glyphs/Fixer'})`);
    if(!layoutOnly)await page.screenshot(join(output,`${prefix}-selected-label-focus.png`));
    await page.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
    results.push({theme,width,inspect,quietLayout:layout,frames:await page.evaluate('globalThis.holoVerification.frames')});continue;
  }
  await page.evaluate(`[...document.querySelectorAll('.holotable-panel button')].find(b=>b.textContent==='Key').click()`);
  await page.screenshot(join(output,`${prefix}-key-folded.png`));
  await page.evaluate(`[...document.querySelectorAll('.holotable-panel button')].find(b=>b.textContent==='Key').click()`);
  await page.evaluate(`[...document.querySelectorAll('[data-holo-card] button')].find(b=>b.textContent==='Technical').click()`);
  await page.screenshot(join(output,`${prefix}-card-technical-open.png`));
  // A producer-note expander is a library GroupSection, with the same disclosure pattern as Technical.
  await page.evaluate(`[...document.querySelectorAll('.holotable-details button')].find(b=>b.textContent==='Producer notes').click()`);
  await page.evaluate(`document.querySelector('[data-holotable-layer]').scrollIntoView({block:'center'})`);
  await page.screenshot(join(output,`${prefix}-producer-notes.png`));
  await page.evaluate(`document.querySelector('[data-holo-card]').scrollIntoView({block:'start'})`);
  await page.evaluate(`[...document.querySelectorAll('[data-holo-card] button')].find(b=>b.textContent==='Technical').click()`);
  // Focus the selected plate through real double-click input; the fixture computes its initial projected point.
  const point=await page.evaluate(`(()=>{const r=document.querySelector('.holotable-panel svg').getBoundingClientRect(),c=globalThis.holoVerification.frames.at(-1).clusters[0];return {x:r.left+c.x,y:r.top+c.y};})()`);
  for(const clickCount of [1,2]){await page.mouse("mousePressed",point.x,point.y,{button:"left",buttons:1,clickCount});await page.mouse("mouseReleased",point.x,point.y,{button:"left",buttons:0,clickCount});}
  await page.waitFor(`(()=>{const b=document.querySelector('.holotable-panel button[aria-label="Back"]');return b&&!b.hidden&&Math.abs(globalThis.holoVerification.frames.at(-1).target[0])>1})()`,5000);
  await page.screenshot(join(output,`${prefix}-double-click-focus.png`));
  await page.key("Escape");
  await page.waitFor(`document.querySelector('.holotable-panel button[aria-label="Back"]').hidden&&Math.abs(globalThis.holoVerification.frames.at(-1).target[0]-${initial[0]})<.01`,5000);
  // A single cluster click focuses once; the library Back button restores the same viewpoint.
  const clusterPoint=await page.evaluate(`(()=>{const r=document.querySelector('.holotable-panel svg').getBoundingClientRect(),c=globalThis.holoVerification.frames.at(-1).clusters[0];return {x:r.left+c.x,y:r.top+c.y};})()`);
  await page.mouse("mousePressed",clusterPoint.x,clusterPoint.y,{button:"left",buttons:1,clickCount:1});await page.mouse("mouseReleased",clusterPoint.x,clusterPoint.y,{button:"left",buttons:0,clickCount:1});
  await page.waitFor(`!document.querySelector('.holotable-panel button[aria-label="Back"]').hidden`,5000);
  await page.evaluate(`document.querySelector('.holotable-panel button[aria-label="Back"]').click()`);
  await page.waitFor(`document.querySelector('.holotable-panel button[aria-label="Back"]').hidden&&Math.abs(globalThis.holoVerification.frames.at(-1).target[0]-${initial[0]})<.01`,5000);
  await page.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.view.focus',view:'holotable.view',id:'synthetic/glyphs/Fixer'})`);
  const reduced=await page.evaluate(`Math.abs(globalThis.holoVerification.frames.at(-1).target[0]+40)<.01`);if(!reduced)throw Error('Reduced-motion focus was not instant');
  if(!layoutOnly)await page.screenshot(join(output,`${prefix}-selected-label-focus.png`));
  await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.view.back',view:'holotable.view'})`);
  await page.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  const quiet=await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.holotable-panel button')].find(b=>b.textContent.startsWith('Quiet until'));return b?.textContent})()`);
  if(!quiet?.includes("02:00"))throw Error(`Missing quiet stretch: ${quiet}`);
  await page.screenshot(join(output,`${prefix}-quiet-until.png`));
  await page.evaluate(`[...document.querySelectorAll('.holotable-panel button')].find(b=>b.textContent.startsWith('Quiet until')).click()`);
  await page.waitFor('globalThis.holoVerification.service.snapshot().t===7200&&!globalThis.holoVerification.service.snapshot().playing',5000);
  // Row menu routes Focus to the bound view and frames its placed items.
  await page.evaluate(`document.querySelector('[data-holotable-layer]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:600,clientY:450}))`);
  await page.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.includes('Focus on this layer')).click()`);
  await page.waitFor(`!document.querySelector('.holotable-panel button[aria-label="Back"]').hidden`,5000);
  results.push({theme,width,navigation,inspect,quiet,focus:true,back:true,singleClusterClick:true,reducedMotion:true,jump:true,layerFocus:true,frames:await page.evaluate('globalThis.holoVerification.frames')});
 }
 if(page.console.some(e=>e.type==="exception"||e.type==="error"))throw Error(JSON.stringify(page.console));
 writeFileSync(join(output,inputOnly?"navigation-acceptance.json":layoutOnly?"architecture-layout-measurements.json":selectedOnly?"code-review-measurements.json":reviewOnly?"design-fixes-measurements.json":"measurements.json"),JSON.stringify(results,null,2));console.log(`Saved ${inputOnly||layoutOnly?0:selectedOnly?1:reviewOnly?8:28} captures and acceptance results to ${output}`);
}finally{await page?.close();server.stop(true);}
