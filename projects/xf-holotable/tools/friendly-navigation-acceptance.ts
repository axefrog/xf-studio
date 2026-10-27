import type { Session } from "../../xf-studio/authoring/tools/cdp";

/** Real pointer capture and keyboard input against the isolated synthetic panel; no screenshots. */
export async function checkFriendlyNavigation(page:Session) {
  const check=(ok:unknown,why:string)=>{if(!ok)throw Error(`Friendly navigation: ${why}`);};
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const read=()=>page.evaluate(`(()=>{const v=globalThis.holoVerification,f=v.frames.at(-1),s=v.service.snapshot(),svg=document.querySelector('.holotable-panel svg');return {orbit:f.orbit,target:f.target,depth:f.viewpoints,selected:s.selected,position:s.position,actions:v.actions.length,captured:svg.hasPointerCapture(v.pointerId??-1)};})()`);
  const actionsSince=(n:number)=>page.evaluate(`globalThis.holoVerification.actions.slice(${n})`);
  const initial=await read();
  await page.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  const seed=async()=>{
    const point=await page.evaluate(`globalThis.holoVerification.initialPoint([-40,30,0])`),n=(await read()).actions;
    await page.mouse("mousePressed",point.x,point.y,{button:"left",buttons:1});
    await page.mouse("mouseReleased",point.x,point.y,{button:"left",buttons:0});
    check((await actionsSince(n)).some((a:any)=>a.kind==="holo.select"&&a.id==="synthetic/glyphs/Fixer"),"earlier click must actually pick Fixer");
  };
  const bounds=await page.evaluate(`(()=>{const r=document.querySelector('.holotable-panel svg').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  const empty={x:bounds.x+bounds.width-24,y:bounds.y+60};
  await seed();
  let before=await read();
  // Deliver dblclick directly after the earlier pick, too: a cached pick must never stand in for the hit at these coordinates.
  await page.evaluate(`document.querySelector('.holotable-panel svg').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:${empty.x},clientY:${empty.y}}))`);
  let after=await read();
  check(same(after.orbit,before.orbit)&&same(after.target,before.target)&&after.depth===before.depth,"empty-ground dblclick reused an earlier pick");
  check(!(await actionsSince(before.actions)).some((a:any)=>a.kind==="holo.view.focus"),"empty-ground dblclick dispatched Focus");
  await seed();before=await read();
  // Also cover Chromium's full two-click sequence. Ordinary ground picking may happen, but Focus must not.
  for(const clickCount of [1,2]){
    await page.mouse("mousePressed",empty.x,empty.y,{button:"left",buttons:1,clickCount});
    await page.mouse("mouseReleased",empty.x,empty.y,{button:"left",buttons:0,clickCount});
  }
  after=await read();
  check(same(after.orbit,before.orbit)&&same(after.target,before.target)&&after.depth===before.depth,"real empty-ground double-click changed the viewpoint or stack");
  check(!(await actionsSince(before.actions)).some((a:any)=>a.kind==="holo.view.focus"),"real empty-ground double-click dispatched Focus");

  await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.view.focus',view:'holotable.view',id:'synthetic/glyphs/Fixer'})`);
  check((await read()).depth===initial.depth+1,"focus must push one viewpoint before cancellation checks");
  const from={x:bounds.x+bounds.width*.6,y:bounds.y+bounds.height*.65};
  // Start with a nonzero pan, so a reset to [0,0] cannot pass as a restoration.
  await page.drag([from.x,from.y],[from.x+12,from.y+8],{button:"right",steps:2});
  check(Math.hypot(...(await read()).orbit.pan)>0,"pan setup did not change the offset");
  const cancellations=[];
  for(const mode of ["orbit","pan"] as const){
    before=await read();
    await page.evaluate(`document.querySelector('.holotable-panel svg').addEventListener('pointerdown',e=>{globalThis.holoVerification.pointerId=e.pointerId},{once:true,capture:true})`);
    const button=mode==="orbit"?"left":"right",buttons=mode==="orbit"?1:2,to={x:from.x+36,y:from.y+24};
    await page.mouse("mouseMoved",from.x,from.y,{button:"none",buttons:0});
    await page.mouse("mousePressed",from.x,from.y,{button,buttons});
    check((await read()).captured,`${mode} press did not capture the pointer`);
    await page.mouse("mouseMoved",to.x,to.y,{button,buttons});
    const moved=await read();
    check(mode==="orbit"?moved.orbit.yaw!==before.orbit.yaw&&moved.orbit.pitch!==before.orbit.pitch:!same(moved.orbit.pan,before.orbit.pan),`${mode} did not move before Escape`);
    await page.key("Escape");after=await read();
    check(!after.captured,`${mode} Escape kept pointer capture`);
    check(same(after.orbit,before.orbit)&&same(after.target,before.target),`${mode} Escape did not restore the press viewpoint`);
    check(after.depth===before.depth,`${mode} Escape popped the viewpoint stack`);
    // The real release after cancellation must not turn into a click or another navigation operation.
    await page.mouse("mouseReleased",to.x,to.y,{button,buttons:0});after=await read();
    check(same(after.orbit,before.orbit)&&same(after.target,before.target)&&after.depth===before.depth,`${mode} release changed the restored viewpoint`);
    check(same(after.selected,before.selected)&&same(after.position,before.position),`${mode} cancellation picked something`);
    check((await actionsSince(before.actions)).length===0,`${mode} cancellation dispatched a pick or navigation action`);
    cancellations.push({mode,before,moved,after});
  }
  await page.key("Escape");after=await read();
  check(after.depth===initial.depth&&same(after.target,initial.target)&&same(after.orbit,initial.orbit),"Escape without a drag did not return to the pre-focus viewpoint");
  check(await page.evaluate(`document.querySelector('.holotable-panel button[aria-label="Back"]').hidden`),"Back remained available after returning");
  await page.evaluate(`globalThis.holoVerification.service.dispatch({kind:'holo.select',id:'synthetic/glyphs/Fixer'})`);
  await page.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  return {emptyGround:{direct:true,realDoubleClick:true},cancellations,escapeWithoutDrag:true};
}
