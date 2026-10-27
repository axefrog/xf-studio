// Asset-free browser QA; owns its server, browser and bounded verification lifetime.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../xf-studio/authoring/tools/cdp";
const output=resolve(import.meta.dir,"../../../local/holotable/evidence/playback");mkdirSync(output,{recursive:true});
const built=await Bun.build({entrypoints:[join(import.meta.dir,"playback-preview-client.ts")],target:"browser",format:"esm"});if(!built.success)throw Error(built.logs.join("\n"));
const script=await built.outputs[0].text(),authoring=resolve(import.meta.dir,"../../xf-studio/authoring");
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){const url=new URL(request.url);if(url.pathname==="/studio.css")return new Response(Bun.file(join(authoring,"public/studio.css")),{headers:{"content-type":"text/css"}});if(url.pathname==="/client.js")return new Response(script,{headers:{"content-type":"text/javascript"}});if(url.searchParams.get("verify")!=="1")return new Response("Verification workspace required",{status:400});return new Response('<!doctype html><html><meta charset="utf-8"><title>Playback verification</title><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>',{headers:{"content-type":"text/html"}});}});
let page:Session|undefined;const measurements:unknown[]=[];
try{
 page=await launch(`http://127.0.0.1:${server.port}/?verify=1`,{width:1550,height:760,motion:"no-preference",args:["--disable-gpu","--no-sandbox"]});
 for(const theme of ["light","dark"])for(const width of [300,460,850])for(const clock of ["recording","game"]){
  await page.viewport(width+670,760);
  await page.send("Page.navigate",{url:`http://127.0.0.1:${server.port}/?verify=1&theme=${theme}&width=${width}&clock=${clock}`});
  await page.waitFor('document.body.dataset.ready==="true"',15000);
  await page.evaluate(`document.querySelector('[data-step-scope] button').click()`);
  if(await page.evaluate('globalThis.holoVerification.service.snapshot().changeScope')!==null)throw Error('Clear did not restore all visible layers');
  const producer=await page.evaluate(`document.querySelector('.holotable-details').textContent`);
  if(!producer.includes('Story Engine')||producer.includes('Doing'))throw Error('Producer title missing or facet title drawn');
  await page.evaluate(`globalThis.holoVerification.producerTitle(undefined)`);
  const fallback=await page.evaluate(`(()=>{const input=[...document.querySelectorAll('.holotable-details input')].find(i=>i.parentElement.textContent==='synthetic');input.focus();return !!input;})()`);
  if(!fallback)throw Error('Producer id fallback missing');
  await page.evaluate(`globalThis.holoVerification.producerTitle('Story Engine')`);
  const renamed=await page.evaluate(`document.activeElement.parentElement.textContent`);
  if(renamed!=='Story Engine')throw Error('Producer title update lost label or focus');
  // Drive the Details row through the same target-menu helper used by module view contexts.
  await page.evaluate(`document.querySelector('[data-holotable-layer]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:600,clientY:450}))`);
  await page.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.includes('Step through this layer')).click()`);
  const scope=await page.evaluate(`(()=>{const chip=document.querySelector('[data-step-scope]'),line=document.querySelector('.holotable-panel .control-line');return {title:chip.textContent,clear:chip.querySelector('button').getAttribute('aria-label'),tip:line.querySelector('button[aria-label="Next change in Stories"]').title};})()`);
  if(scope.title!=='Stories'||scope.clear!=='Stop stepping through Stories only'||scope.tip!=='Next change in Stories (])')throw Error(JSON.stringify(scope));
  for(const [id,term] of [['synthetic/glyphs/Fixer','Detail'],['synthetic-event','Said']]){
   await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.select',id:${JSON.stringify(id)}})`);
   const detail=await page.evaluate(`(()=>{const term=[...document.querySelectorAll('.holotable-details dt')].find(d=>d.textContent===${JSON.stringify(term)}),value=term.nextElementSibling;return {text:value.textContent,whiteSpace:getComputedStyle(value.firstElementChild).whiteSpace};})()`);
   if(!detail.text.includes('\n')||detail.whiteSpace!=='pre-line')throw Error(JSON.stringify(detail));
  }
  await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.select',id:'synthetic/glyphs/Fixer'})`);
  const chipLayout=await page.evaluate(`(()=>{const c=document.querySelector('[data-step-scope]'),t=c.querySelector('.note'),b=c.querySelector('button'),style=getComputedStyle(t),measure=document.createElement('canvas').getContext('2d');measure.font=style.font;return {transform:style.textTransform,width:t.clientWidth,full:t.scrollWidth,minimum:measure.measureText(t.textContent.slice(0,6)+'…').width,closeWidth:b.getBoundingClientRect().width,stepWidth:document.querySelector('.holotable-panel button[aria-label="Next change in Stories"]').getBoundingClientRect().width};})()`);
  if(chipLayout.transform!=='none'||(chipLayout.full>chipLayout.width&&chipLayout.width+.5<chipLayout.minimum)||chipLayout.closeWidth!==chipLayout.stepWidth)throw Error(JSON.stringify(chipLayout));
  const measured=await page.evaluate(`(()=>{const panel=document.querySelector('.holotable-panel'),line=panel.querySelector('.control-line'),buttons=[...line.querySelectorAll('button')].filter(b=>b.getClientRects().length),rects=buttons.map(b=>b.getBoundingClientRect());return {theme:${JSON.stringify(theme)},width:${JSON.stringify(width)},clock:${JSON.stringify(clock)},overflow:panel.scrollWidth>panel.clientWidth,singleLine:rects.every(r=>Math.abs(r.top-rects[0].top)<3),unknown:document.querySelector('.holotable-details').textContent.includes('1 unknown glyph')&&!document.querySelector('.holotable-details').textContent.includes('1 unknown glyphs'),chip:!!line.querySelector('[data-step-scope]'),choices:buttons.map(b=>b.textContent||b.getAttribute('aria-label')),collapse:line.dataset.collapse,barWidth:line.clientWidth,frames:globalThis.holoVerification.frames};})()`);
  measurements.push(measured);if(measured.overflow||!measured.singleLine||!measured.unknown||!measured.chip)throw Error(JSON.stringify(measured));
  await page.screenshot(join(output,`${clock}-${theme}-${width===300?"narrow":width===460?"460":"wide"}.png`));
  if(width===300){
   const speedButton='.holotable-panel button[aria-label^="Playback speed:"]';
   const currentLabel=await page.evaluate('globalThis.holoVerification.service.speedOptions().find(o=>o.value===globalThis.holoVerification.service.snapshot().speed).label');
   const a11y=await page.evaluate(`(()=>{const b=document.querySelector('${speedButton}');return {label:b.getAttribute('aria-label'),popup:b.getAttribute('aria-haspopup'),visible:!!b.getClientRects().length};})()`);
   if(!a11y.visible||a11y.popup!=='menu'||!a11y.label.startsWith('Playback speed: '))throw Error(JSON.stringify(a11y));
   await page.evaluate(`document.querySelector('${speedButton}').click()`);
   const options=await page.evaluate(`(()=>{const m=document.querySelector('[role="menu"][aria-label="Playback speed"]'),choices=[...m.querySelectorAll('[aria-checked]')];return {count:choices.length,checked:choices.filter(c=>c.getAttribute('aria-checked')==='true').map(c=>c.textContent),headings:m.querySelectorAll('.menu-heading').length,overflow:m.scrollHeight>m.clientHeight,allVisible:choices.every(c=>c.getClientRects().length)};})()`);
   if(options.count!==(clock==='game'?4:3)||options.checked.length!==1||options.checked[0]!==currentLabel||options.headings||options.overflow||!options.allVisible)throw Error(JSON.stringify(options));
   await page.screenshot(join(output,`speed-options-${clock}-${theme}-300.png`));
   await page.evaluate(`document.querySelector('[role="menu"][aria-label="Playback speed"] [aria-checked]').click()`);
   await page.waitFor(`globalThis.holoVerification.service.snapshot().speed===1&&!document.querySelector('[role="menu"][aria-label="Playback speed"]')`,5000);
   await page.evaluate(`document.querySelector('${speedButton}').click()`);
   if(await page.evaluate(`document.querySelector('[role="menu"][aria-label="Playback speed"] [aria-checked="true"]').textContent`)!=='1×')throw Error('Current speed was not checked after immediate selection');
   await page.waitFor(`document.activeElement?.closest('[role="menu"]')`,5000);
   await page.key('Escape');
   await page.waitFor(`!document.querySelector('[role="menu"][aria-label="Playback speed"]')`,5000);
   await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.select',id:'synthetic/glyphs/Clinic'})`);
   await page.screenshot(join(output,`selected-clinic-${theme}-300.png`));
   await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.select',id:'synthetic/glyphs/Fixer'})`);
  }
  if(clock==='game'){
   const p=await page.evaluate(`(()=>{const r=document.querySelector('.holotable-panel svg').getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*.65};})()`);
   await page.drag([p.x,p.y],[p.x+55,p.y+24],{button:'right',steps:4});
   await page.screenshot(join(output,`pan-${theme}-${width===300?'narrow':width===460?'460':'wide'}.png`));
   await page.evaluate(`document.querySelector('.holotable-panel [aria-label="View"] button[aria-pressed="true"]').click()`);
  }

 }
 // Actual right/middle pointer handlers, all modifier combinations, inert right click, and preset reset.
 const target=()=>page!.evaluate<number[]>('globalThis.holoVerification.frames.at(-1).target');
 const initialTarget=await target();
 const bounds=await page!.evaluate(`(()=>{const r=document.querySelector('.holotable-panel svg').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*.65};})()`);
 const pointer=async(type:string,button:string,buttons:number,x:number,y:number,modifiers=0)=>page!.send('Input.dispatchMouseEvent',{type,button,buttons,x,y,modifiers,clickCount:type==='mouseMoved'?0:1});
 await pointer('mousePressed','right',2,bounds.x,bounds.y);await pointer('mouseReleased','right',0,bounds.x,bounds.y);
 if(JSON.stringify(await target())!==JSON.stringify(initialTarget))throw Error('An inert right press moved the view');
 for(const button of ['right','middle'])for(let modifiers=0;modifiers<16;modifiers++){
  const before=await target(),buttons=button==='right'?2:4;
  await pointer('mousePressed',button,buttons,bounds.x,bounds.y,modifiers);
  await pointer('mouseMoved',button,buttons,bounds.x+8,bounds.y+4,modifiers);
  if(await page!.evaluate('document.querySelector(".holotable-panel svg").style.cursor')!=='grabbing')throw Error('Pan cursor was lost');
  await pointer('mouseReleased',button,0,bounds.x+8,bounds.y+4,modifiers);
  const after=await target();if(Math.hypot(after[0]-before[0],after[1]-before[1])<.01)throw Error(`No ${button} pan with modifiers ${modifiers}`);
  await page!.evaluate(`document.querySelector('.holotable-panel [aria-label="View"] button[aria-pressed="true"]').click()`);
  if(JSON.stringify(await target())!==JSON.stringify(initialTarget))throw Error('Preset did not reset pan');
 }
 const prevented=await page!.evaluate(`!document.querySelector('.holotable-panel svg').dispatchEvent(new MouseEvent('contextmenu',{cancelable:true,bubbles:true}))`);
 if(!prevented)throw Error('Holotable context menu was not suppressed');
 await pointer('mousePressed','right',2,bounds.x,bounds.y);await pointer('mouseMoved','right',2,bounds.x+85,bounds.y+35);await pointer('mouseReleased','right',0,bounds.x+85,bounds.y+35);
 const pannedTarget=await target();
 await page!.waitFor(`globalThis.holoVerification.contexts.some(c=>JSON.stringify(c.center)===${JSON.stringify(JSON.stringify(pannedTarget))})`,5000);
 await page!.screenshot(join(output,'pan-dark-wide.png'));
 measurements.push({pan:{initialTarget,pannedTarget,modifiers:16,buttons:['right','middle'],refetched:true}});
 await page!.evaluate(`document.querySelector('.holotable-panel [aria-label="View"] button[aria-pressed="true"]').click()`);
 await page!.evaluate('globalThis.holoVerification.service.dispatch({kind:"holo.open",dir:"synthetic"})');
 const openedCenter=await page!.evaluate('(()=>{const e=globalThis.holoVerification.service.snapshot().open.session.meta.standalone.extent;return e.min.map((n,i)=>(n+e.max[i])/2);})()');
 if(JSON.stringify(await target())!==JSON.stringify(openedCenter))throw Error('Reopening the same recording did not reset pan');
 await page!.evaluate('globalThis.holoVerification.service.dispatch({kind:"holo.select",id:"synthetic/glyphs/Fixer"})');
 // Exercise the actual focused view handler, both directions, and unavailable end states.
 await page!.evaluate('document.querySelector(".holotable-panel svg").focus()');
 await page!.key("]");await page!.waitFor('globalThis.holoVerification.service.snapshot().t===600',5000);
 await page!.key("]");await page!.waitFor('globalThis.holoVerification.service.snapshot().t===1200',5000);
 await page!.key("[");await page!.waitFor('globalThis.holoVerification.service.snapshot().t===600 && !globalThis.holoVerification.service.snapshot().playing',5000);
 await page!.evaluate('globalThis.holoVerification.pulse()');await page!.send("Animation.setPlaybackRate",{playbackRate:0});
 await page!.screenshot(join(output,"pulse-mid-ring-dark-wide.png"));
 await page!.evaluate('globalThis.holoVerification.fade()');
 await page!.screenshot(join(output,"retraction-mid-fade-dark-wide.png"));
 if(page.console.some(e=>e.type==="exception"||e.type==="error"))throw Error(JSON.stringify(page.console));
 writeFileSync(join(output,"measurements.json"),JSON.stringify(measurements,null,2));console.log(`Saved ${26} captures to ${output}`);
}finally{await page?.close();server.stop(true);}
