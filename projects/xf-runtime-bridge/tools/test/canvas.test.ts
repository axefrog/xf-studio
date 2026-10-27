import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BridgeClient } from "../bridge-lib";
import { canonical, digest } from "../overlay/canvas-fixtures";
import { flatten, glyphPaths, glyphTable, vocabulary } from "../overlay/canvas-glyphs";
import { modelFromFov, project } from "../scene/camera";
import { startSelftestHost, projectDir, sleep, type Host } from "./helpers";

const fixtures = JSON.parse(readFileSync(join(projectDir, "fixtures/canvas/conformance.json"), "utf8"));
test("shared JCS and digest vectors agree with ECMAScript, including RFC number boundaries and UTF-16 sort", () => {
  for (const vector of fixtures.digests) { expect(canonical(vector.value)).toBe(vector.canonical); expect(digest(vector.value)).toBe(vector.sha256); }
});
test("shared fixed camera projects the same points through the TypeScript scene model", () => {
  const c = fixtures.camera, model = modelFromFov({ ...c, aspect: c.width/c.height });
  const sample = fixtures.cases[0];
  for (let n=0;n<sample.batch.items.length;n++) {
    const point = project(model,sample.batch.items[n].anchor.world), expected = sample.projected[n];
    expect(point.in_frame).toBe(expected!==null);
    if(expected) { expect(c.width/2+point.x*c.height).toBeCloseTo(expected[0],5);expect(c.height/2+point.y*c.height).toBeCloseTo(expected[1],5); }
  }
});
test("generated glyph geometry comes from Studio; missing vocabulary falls back without invented paths", () => {
  expect(glyphPaths("warning")?.reduce((n, path) => n + path.points.length, 0)).toBe(7);
  expect(glyphPaths("person")).toBeNull(); expect(vocabulary()).toContain("gang-member");
  expect(readFileSync(join(projectDir,"native/src/core/overlay/CanvasGlyphs.inc"),"utf8")).toBe(glyphTable());
});
test("SVG flattening handles relative/absolute line, cubic, smooth, quadratic and elliptical arc commands", () => {
  for (const d of ["M0 0h2v2H0V0z", "M0 0C0 2 2 2 2 0s2 -2 2 0", "M0 0Q1 2 2 0t2 0", "M0 0A2 2 0 0 1 4 0a2 2 0 0 1 -4 0"]) {
    const paths = flatten(d); expect(paths.length).toBe(1); expect(paths[0]!.points.length).toBeGreaterThan(2);
    expect(paths[0]!.points.flat().every(Number.isFinite)).toBe(true);
  }
});
test("CET ForModule binds each route and preserves empty item arrays", () => {
  const require=createRequire(import.meta.url), {lua,lauxlib,lualib,to_luastring}=require("fengari");
  const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  const path=join(projectDir,"cet/xf_runtime_bridge/canvas.lua").replaceAll("\\","/");
  const code=`
    json={encode=function(v)
      if type(v.items)=="table" then return '{"items":{}}' end
      if v.layer~=nil then return '{"layer":'..tostring(v.layer)..'}' end
      return '{}'
    end, decode=function(raw) return {ok=true,result=raw} end}
    Game={XFBridge_Canvas=function(module,action,payload) return module.."|"..action.."|"..payload end}
    local canvas=dofile(${JSON.stringify(path)})
    local holo=canvas.ForModule("holotable")
    local invalid=pcall(canvas.ForModule,"bad.module")
    return table.concat({holo.Feed({items={}}).result,holo.Clear(false).result,holo.View({}).result,
      holo.State().result,canvas.State().result,tostring(invalid)},";")
  `;
  try {
    expect(lauxlib.luaL_loadstring(L,to_luastring(code))).toBe(lua.LUA_OK);
    expect(lua.lua_pcall(L,0,1,0)).toBe(lua.LUA_OK);
    expect(lua.lua_tojsstring(L,-1)).toBe('holotable|feed|{"items":[]};holotable|clear|{"layer":false};holotable|view|{};holotable|state|{};xf_runtime_bridge|state|{};false');
  } finally { lua.lua_close(L); }
});
describe("canvas over a persistent read-only observer and MCP", () => {
  let host: Host, writer: BridgeClient, other: BridgeClient, mcp: Client, transport: StdioClientTransport;
  const tool = async (name: string, args: Record<string,unknown> = {}) => {
    const reply = await mcp.callTool({ name, arguments: args });
    const text = reply.content as { type: string; text: string }[];
    const body = text.filter(c=>c.type==="text").map(c=>c.text).join("\n");
    return { error: reply.isError === true, value: reply.isError ? { message: body } : JSON.parse(body) };
  };
  beforeAll(async () => {
    host = await startSelftestHost([], 120); writer = new BridgeClient(host.session, 5000); await writer.connect();
    expect((await writer.call("selftest.canvas",{visible:true})).ok).toBe(true);
    transport = new StdioClientTransport({command:process.execPath,args:[join(projectDir,"tools/mcp-server.ts"),"--read-only","--runtime-dir",host.dir],cwd:projectDir,stderr:"pipe",env:{...process.env as Record<string,string>,XFB_NO_INPUT:"1"}});
    mcp = new Client({name:"canvas-observer-fixture",version:"1"}); await mcp.connect(transport);
    other = new BridgeClient(host.session,5000); await other.connect({readOnly:true});
  },60000);
  afterAll(async()=>{await mcp?.close();other?.close();writer?.close();await host?.stop();});
  test("display tools exposed; an observer feeds and clears while a writer holds its own connection",async()=>{
    const tools=(await mcp.listTools()).tools.map(t=>t.name);for(const name of ["canvas_feed","canvas_clear","canvas_view","canvas_state"])expect(tools).toContain(name);
    expect(tools).not.toContain("ui_message");
    expect((await other.call("ui.message",{text:"observer notify must stay refused"})).error?.code).toBe("read_only_connection");
    const status=await writer.call("game.status");const world=(status.result as any).world_generation;
    const batch={...fixtures.cases[0].batch,world,producer:"observer",layer:"actors"};
    const fed=await tool("canvas_feed",batch);expect(fed.error).toBe(false);expect(fed.value.result.accepted).toBe(true);expect(fed.value.result.digest).toBe(digest(batch));
    const collision=await other.call("canvas.feed",batch);expect(collision.error?.code).toBe("producer_in_use");
    const stale=await tool("canvas_feed",batch);expect(stale.error).toBe(true);
    const state=await tool("canvas_state");expect(state.value.result.producers[0].layers[0].seq).toBe(1);
    expect((await tool("canvas_view",{radar:{orientation:"north_up",range_m:75}})).error).toBe(false);
    const cleared=await tool("canvas_clear",{producer:"observer",layer:"actors"});expect(cleared.value.result.cleared).toBe(1);
    expect((await tool("canvas_feed",batch)).value.result.accepted).toBe(true);
    const events=await writer.call("session.events",{kinds:["canvas.fed"]});expect((events.result as any).events.some((e:any)=>e.data.digest===digest(batch))).toBe(true);
  },15000);
  test("raw unknown fields, TTL, world invalidation, hide/resend and disconnect withdrawal",async()=>{
    const state=await other.call("canvas.state");const world=(state.result as any).world;
    let batch={...fixtures.cases[0].batch,world,producer:"direct",layer:"ttl",ttl_s:.5};
    expect((await other.call("canvas.feed",batch)).ok).toBe(true);
    expect((await other.call("canvas.feed",{...batch,extra:true})).error?.code).toBe("bad_batch");
    await sleep(600);let result=await other.call("canvas.state");expect((result.result as any).producers.find((p:any)=>p.producer==="direct").layers[0].items).toBe(0);
    expect((await other.call("canvas.feed",batch)).error?.code).toBe("stale_seq");
    await writer.call("selftest.canvas",{visible:false});expect((await other.call("canvas.feed",{...batch,seq:2})).result).toEqual({accepted:false,dropped:"hidden"});
    await writer.call("selftest.canvas",{visible:true});batch={...batch,seq:2};expect((await other.call("canvas.feed",batch)).ok).toBe(true);
    await writer.call("selftest.script_layer",{event:"detach"});await sleep(60);result=await other.call("canvas.state");expect((result.result as any).producers).toHaveLength(0);
    expect((await other.call("canvas.feed",{...batch,seq:3})).error?.code).toBe("stale_world");
    await writer.call("selftest.script_layer",{event:"attach"});await writer.call("selftest.script_layer",{event:"player_attach"});
    result=await other.call("canvas.state");batch={...batch,world:(result.result as any).world};expect((await other.call("canvas.feed",batch)).ok).toBe(true);
    other.close();await sleep(100);const clean=await tool("canvas_state");expect(clean.value.result.producers.some((p:any)=>p.producer==="direct")).toBe(false);
  },15000);
});
