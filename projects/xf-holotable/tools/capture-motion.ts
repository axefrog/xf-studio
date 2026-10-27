/** Private Kabuki motion benchmark. Owns and closes its browser/server; caches are read-only. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, type Session } from "../../xf-studio/authoring/tools/cdp";
import { loadWorldPack, region, boxOf } from "../src/world";
import { worldContentFiles } from "../src/world-content-files";
import type { SolidRegion, Vec3 } from "../src/model";

const root = resolve(import.meta.dir, "../../.."), output = join(root, "local/holotable/evidence/motion");
const arg = (name: string) => { const i = Bun.argv.indexOf(name); return i < 0 ? undefined : Bun.argv[i + 1]; };
const stage = arg("--stage") ?? "after", regions = arg("--regions"), width=Number(arg("--width")??850), baselineRef=arg("--baseline-ref")??"HEAD";
const dense=Bun.argv.includes("--dense");
if(!["before","after"].includes(stage)||!Number.isInteger(width)||width<200||width>1600)throw Error("Use --stage before|after and a panel width from 200 to 1600");
if (!regions) throw Error("Pass --regions <prepared W0 cache/regions folder> (read-only)");
const pack = loadWorldPack(arg("--pack") ?? join(root, "local/holotable/world-pack.json"));
if (!pack) throw Error("Prepared world pack required");
const content = await Bun.file(join(root, "local/holotable/world/kabuki.content.json")).json();
const center: Vec3 = (content.pois.find((p: any) => p.kind === "Ripperdoc") ?? content.spots[0]).at;
// Choose the cached region with the most real primitives covering this exact fixture centre.
let geometry: SolidRegion | undefined, source = "", coverage = -1;
for (const name of readdirSync(regions).filter(n => n.endsWith(".json"))) {
  const candidate = JSON.parse(readFileSync(join(regions, name), "utf8")) as SolidRegion;
  const count = candidate.solids.filter(s => Math.hypot(...s.center.map((n, i) => n - center[i])) < 350).length;
  if (count > coverage) { geometry = candidate; source = name; coverage = count; }
}
if (!geometry || coverage < 900) throw Error("Cache does not cover the Kabuki fixture with W0 solids");
const owner = worldContentFiles(join(root, "local/holotable/world"));
mkdirSync(output, { recursive: true });
const built = await Bun.build({ entrypoints: [join(import.meta.dir, "w1-layers-preview-client.ts")], target: "browser", format: "esm",
  plugins:stage==="before"?[{name:"baseline-view",setup(build){build.onLoad({filter:/[\\/]features[\\/]holotable[\\/]view[\\/].*\.ts$/},args=>{
    const relative=args.path.slice(root.length+1).replaceAll("\\","/");
    const result=Bun.spawnSync(["git","show",`${baselineRef}:${relative}`],{cwd:root});
    if(result.exitCode!==0)throw Error(`Cannot read baseline ${relative}`);
    return {contents:result.stdout.toString(),loader:"ts"};
  });}}]:[] });
if (!built.success) throw Error(built.logs.join("\n"));
const script = await built.outputs[0].text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/studio.css") return new Response(Bun.file(join(root, "projects/xf-studio/authoring/public/studio.css")));
  if (url.pathname === "/client.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
  if (url.pathname === "/center") return Response.json(center);
  if (url.pathname === "/world") {
    const p = await request.json(), path: Vec3[] = [p.center ?? center];
    return Response.json({ ...region(pack, boxOf(path), 350), ...geometry, content: owner.around(pack, path, 350, p.content === true, request.signal) });
  }
  if (url.searchParams.get("verify") !== "1") return new Response("Verification workspace required", { status: 400 });
  return new Response('<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/studio.css"><body><script type="module" src="/client.js"></script></body></html>', { headers: { "content-type": "text/html" } });
} });
let page: Session | undefined;
const results: unknown[] = [];
const readCounts='(()=>{const row=[...document.querySelectorAll(".holotable-details .toggle-row")].find(e=>e.textContent.includes("Gathering spots"));return {show:Number(row?.textContent.match(/(\\d+) on the map now/)?.[1]),legend:globalThis.w1.frames.at(-1).legendSpots};})()';
try {
  page = await launch(`http://127.0.0.1:${server.port}/?verify=1`, { width: 2050, height: 850, motion: "no-preference", args: ["--disable-gpu", "--no-sandbox"] });
  for (const theme of ["light", "dark"]) {
    await page.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?verify=1&theme=${theme}&width=${width}&motion=1${dense?"&dense=1":""}` });
    await page.waitFor('document.body.dataset.ready==="true"&&globalThis.w1.frames.length>0&&!globalThis.w1.frames.at(-1).pending&&globalThis.w1.frames.at(-1).solids>0', 20000);
    await page.waitFor('globalThis.w1.service.snapshot().agents.layers[0]?.items.length===12',5000);
    if(dense)await page.waitFor('globalThis.w1.service.snapshot().agents.layers[1]?.items.length===4',5000);
    const restCounts=await page.evaluate(readCounts);
    const bounds = await page.evaluate('(()=>{const r=document.querySelector(".holotable-panel svg").getBoundingClientRect();globalThis.w1.frames.length=0;return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await page.mouse("mousePressed", bounds.x, bounds.y, { button: "left", buttons: 1 });
    // Drive in the page: CDP round trips leave idle frames between inputs and distort completion.
    await page.evaluate(`(()=>{const svg=document.querySelector(".holotable-panel svg");globalThis.orbitSamples=[];globalThis.orbitStep=0;function tick(){const i=++globalThis.orbitStep;svg.dispatchEvent(new PointerEvent("pointermove",{pointerId:1,clientX:${bounds.x}+i*1.2,clientY:${bounds.y}+Math.sin(i/20)*20,buttons:1,bubbles:true}));globalThis.orbitSamples.push(globalThis.w1.frames.at(-1));if(i<180)requestAnimationFrame(tick);}requestAnimationFrame(tick);})()`);
    if (stage === "after") { await page.waitFor('globalThis.orbitStep>=80', 10000); await page.screenshot(join(output, `${theme}-${width}-orbit.png`)); }
    await page.waitFor('globalThis.orbitStep===180', dense&&stage==="before"?120000:15000);
    const frames = await page.evaluate('globalThis.orbitSamples');
    const motionCounts=await page.evaluate(readCounts);
    if(stage==="after"&&(restCounts.show!==2000||restCounts.legend!==2000||motionCounts.show!==2000||motionCounts.legend!==2000||frames.some((f:any)=>f.spots!==2000||f.legendSpots!==2000)))throw Error(`Map counts changed with level of detail: ${JSON.stringify({restCounts,motionCounts,first:frames[0],last:frames.at(-1),incomplete:frames.filter((f:any)=>f.pending).length})}`);
    await page.mouse("mouseReleased", bounds.x + 180 * 1.2, bounds.y + Math.sin(180 / 20) * 20, { button: "left", buttons: 0 });
    await page.waitFor('globalThis.w1.frames.some(f=>f.at>globalThis.orbitSamples.at(-1).at&&!f.pending&&!f.moving&&!f.fading)', 20000);
    const fullDetailMs = await page.evaluate('globalThis.w1.frames.find(f=>f.at>globalThis.orbitSamples.at(-1).at&&!f.pending&&!f.moving&&!f.fading).at-globalThis.orbitSamples.at(-1).at');
    if(dense&&stage==="after"&&await page.evaluate('globalThis.w1.frames.at(-1).agents?.fieldCells')!==4*128*128)throw Error("Resting fields did not restore full resolution");
    const refinement=await page.evaluate('globalThis.w1.frames.filter(f=>f.at>globalThis.orbitSamples.at(-1).at&&!f.moving).map(f=>({at:f.at-globalThis.orbitSamples.at(-1).at,pending:f.pending,fading:f.fading,ms:f.ms,agentMs:f.agentMs,agents:f.agents}))');
    await page.wait(250);
    const stable=await page.evaluate('(()=>{const fs=globalThis.w1.frames,start=fs.findIndex(f=>f.at>globalThis.orbitSamples.at(-1).at&&!f.pending&&!f.moving&&!f.fading);return fs.slice(start).every(f=>!f.pending&&!f.moving&&!f.fading)})()');
    if(!stable)throw Error("Completed resting detail restarted partial work");
    if (stage === "after") await page.screenshot(join(output, `${theme}-${width}-rest.png`));
    const times = frames.map((f: any) => f.ms).sort((a: number, b: number) => a - b);
    const result = { theme, width, restCounts,motionCounts, frames: frames.length, complete: frames.filter((f: any) => !f.pending).length,
      completePercent: frames.filter((f: any) => !f.pending).length / frames.length * 100,
      median: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)], fullDetailMs,
      solidsMin: Math.min(...frames.map((f: any) => f.solids)), solidsMax: Math.max(...frames.map((f: any) => f.solids)),
      agents:dense?{eligibleMin:Math.min(...frames.map((f:any)=>f.agents?.eligible??0)),drawnMin:Math.min(...frames.map((f:any)=>f.agents?.drawn??0)),fieldCellsMin:Math.min(...frames.map((f:any)=>f.agents?.fieldCells??0)),fieldCellsMax:Math.max(...frames.map((f:any)=>f.agents?.fieldCells??0)),incomplete:frames.filter((f:any)=>f.pending).map((f:any)=>({agentMs:f.agentMs,agents:f.agents,ms:f.ms}))}:undefined,
      parts: Object.fromEntries(["agentMs","solidSelectionMs","solidDrawMs"].map(key=>{const values=frames.map((f:any)=>f[key]??0).sort((a:number,b:number)=>a-b);return [key,{median:values[90],p95:values[171]}];})) };
    results.push({...result,refinement}); console.log(JSON.stringify(result));
  }
  if (page.console.some(e => e.type === "exception" || e.type === "error")) throw Error(JSON.stringify(page.console));
  writeFileSync(join(output, `${dense?"dense-":""}${stage}${width===850?"":`-${width}`}.json`), JSON.stringify({ baselineRef:stage==="before"?baselineRef:undefined,source, coverage, center, realSolids: geometry.solids.length, denseFields:dense?{count:4,rows:128,cols:128}:undefined, results }, null, 2));
} finally { await page?.close(); server.stop(true); owner.close(); }
