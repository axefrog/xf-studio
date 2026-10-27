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
test("CET routes preserve schema arrays through a real JSON encoder, including empty panel lines", () => {
  const require=createRequire(import.meta.url), {lua,lauxlib,lualib,to_luastring}=require("fengari");
  const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  // Adapt Lua values to the real ECMAScript JSON encoder. Like CET, unmarked empty tables encode as objects.
  const valueAt=(index:number):unknown=>{
    const at=lua.lua_absindex(L,index);
    switch(lua.lua_type(L,at)) {
      case lua.LUA_TNIL:return null;
      case lua.LUA_TBOOLEAN:return lua.lua_toboolean(L,at);
      case lua.LUA_TNUMBER:return lua.lua_tonumber(L,at);
      case lua.LUA_TSTRING:return lua.lua_tojsstring(L,at);
      case lua.LUA_TTABLE:{
        const entries:[string|number,unknown][]=[];lua.lua_pushnil(L);
        while(lua.lua_next(L,at)){entries.push([valueAt(-2) as string|number,valueAt(-1)]);lua.lua_pop(L,1);}
        if(entries.length&&entries.every(([k])=>typeof k==="number"&&Number.isInteger(k)&&k>=1&&k<=entries.length)){
          const out:unknown[]=[];for(const [key,value] of entries)out[Number(key)-1]=value;return out;
        }
        return Object.fromEntries(entries);
      }
      default:throw new Error("Unsupported Lua JSON value");
    }
  };
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L,()=>{lua.lua_pushstring(L,to_luastring(JSON.stringify(valueAt(1))));return 1;});
  lua.lua_setfield(L,-2,to_luastring("encode"));lua.lua_setglobal(L,to_luastring("json"));
  const path=join(projectDir,"cet/xf_runtime_bridge/canvas.lua").replaceAll("\\","/");
  const code=`
    json.decode=function(raw) return {ok=true,result=raw} end
    Game={XFBridge_Canvas=function(module,action,payload) return json.encode({module=module,action=action,payload=payload}) end}
    local canvas=dofile(${JSON.stringify(path)})
    local holo=canvas.ForModule("holotable")
    local text='quoted "lines":{} and \\"views\\" / snowman ☃'
    local panel={id="panel",kind="panel",anchor={screen={0,0}},rect={0,0,1,1},title=text,lines={}}
    local batch={schema="canvas@1",views={"world"},items={panel},extra={}}
    local arrays={};for _,field in ipairs({"items","views","lines","points","world","screen","offset","offset_px","rect","dash","size","values"}) do arrays[field]={} end
    return json.encode({feed=holo.Feed(batch).result,arrays=holo.Feed(arrays).result,empty=holo.Feed({items={}}).result,
      clear=holo.Clear(false).result,view=holo.View({}).result,state=holo.State().result,default=canvas.State().result,
      invalid=pcall(canvas.ForModule,"bad.module"),text=text})
  `;
  try {
    expect(lauxlib.luaL_loadstring(L,to_luastring(code))).toBe(lua.LUA_OK);
    const status=lua.lua_pcall(L,0,1,0);expect(status,lua.lua_tojsstring(L,-1)).toBe(lua.LUA_OK);
    const result=JSON.parse(lua.lua_tojsstring(L,-1));
    const route=(name:string)=>JSON.parse(result[name]);const payload=(name:string)=>JSON.parse(route(name).payload);
    expect(route("feed").module).toBe("holotable");expect(route("feed").action).toBe("feed");
    expect(payload("feed").items[0].lines).toEqual([]);expect(payload("feed").items[0].title).toBe(result.text);
    expect(payload("feed").items[0].rect).toEqual([0,0,1,1]);expect(payload("feed").extra).toEqual({});
    for(const value of Object.values(payload("arrays")))expect(value).toEqual([]);
    expect(payload("empty").items).toEqual([]);expect(payload("clear").layer).toBe(false);
    expect(payload("view")).toEqual({});expect(route("state").module).toBe("holotable");
    expect(route("default").module).toBe("xf_runtime_bridge");expect(result.invalid).toBe(false);
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
