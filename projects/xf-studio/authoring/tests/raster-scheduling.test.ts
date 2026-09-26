import { expect, test } from "bun:test";
import { createRasterJob, coverage, initialRecipe, raster } from "../src/engines/layered-makeup/recipe";
import { createRasterProcessor, type RasterRequest, type RasterResponse } from "../src/engines/layered-makeup/raster-processor";
import { createRasterClient, type RasterPort } from "../src/raster-client";

test("sliced raster preserves scalar pixels and is isolated from source mutation", () => {
  const layer = initialRecipe().layers[0];
  layer.points[0].weight = .2; layer.fields[0].du = .007;
  const original = structuredClone(layer), job = createRasterJob(layer, 96);
  job.advance(13);
  layer.opacity = 0; layer.fields[0].du = .1;
  while (!job.done) job.advance(17);
  const expected = raster(original, 96);
  expect(job.data).toEqual(expected);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++)
    expect(job.data[(y * 96 + x) * 4 + 3]).toBe(Math.round(255 * coverage((x + .5) / 96, (y + .5) / 96, original)));
  expect(() => createRasterJob(original, 0)).toThrow();
  expect(() => job.advance(0)).toThrow();
});

test("worker processor yields, cancels without partial masks, then produces a complete replacement", async () => {
  const responses: RasterResponse[] = [], resumes: (() => void)[] = [];
  let clock = 0;
  const worker = createRasterProcessor(r => responses.push(r), () => new Promise(resolve => resumes.push(resolve)), () => ++clock * 10);
  const layer = initialRecipe().layers[0];
  const pending = worker.start({ i: 0, version: 1, layer, size: 128 });
  expect(resumes.length).toBe(1); expect(responses).toEqual([]);
  worker.cancel(1); resumes.shift()!(); await pending;
  expect(responses).toEqual([{ i: 0, version: 1, cancelled: true }]);
  let done = false;
  const next = worker.start({ i: 0, version: 2, layer, size: 32 }).then(() => { done = true; });
  while (!done) { resumes.shift()?.(); await Promise.resolve(); }
  await next;
  const result = responses[1];
  expect(result.cancelled).not.toBe(true);
  if (!result.cancelled) expect(result.data).toEqual(raster(layer, 32));
});

class Port implements RasterPort {
  onmessage: RasterPort["onmessage"] = null;
  onerror: RasterPort["onerror"] = null;
  sent: (RasterRequest | {cancel:number})[] = [];
  terminated = false;
  postMessage(message: RasterRequest | {cancel:number}) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(data: RasterResponse) { this.onmessage?.({ data } as MessageEvent<RasterResponse>); }
}
const complete = (version: number, i = 0): RasterResponse => ({ i, version, size: 1, data: new Uint8ClampedArray(4), ms: 1 });

test("client coalesces edits and rejects late masks across cancellation and preset resets", () => {
  const port = new Port(), published: RasterResponse[] = [], layer = initialRecipe().layers[0];
  const client = createRasterClient(() => port, r => published.push(r), () => {}, 1);
  client.request(0, layer); client.request(0, layer); client.request(0, layer);
  expect(port.sent.map(r => "cancel" in r ? `cancel-${r.cancel}` : r.version)).toEqual([1, "cancel-1"]);
  // Completion raced the cancel request. Its stale bytes must not publish.
  port.reply(complete(1));
  expect(published).toEqual([]); expect((port.sent.at(-1) as RasterRequest).version).toBe(3);
  client.reset(); client.request(0, layer);
  port.reply({ i: 0, version: 3, cancelled: true });
  expect((port.sent.at(-1) as RasterRequest).version).toBe(4);
  port.reply(complete(3)); expect(client.diagnostics().running?.version).toBe(4);
  port.reply(complete(4)); expect(published.map(r => r.version)).toEqual([4]);
  expect(client.diagnostics().running).toBeNull();
});

test("active-layer priority preempts long work without losing the other layer", () => {
  const port = new Port(), published: RasterResponse[] = [], layer = initialRecipe().layers[0];
  const client = createRasterClient(() => port, r => published.push(r), () => {}, 1);
  client.request(0, layer, false); client.request(1, layer, true);
  expect(port.sent.at(-1)).toEqual({ cancel: 1 });
  port.reply({ i: 0, version: 1, cancelled: true });
  expect((port.sent.at(-1) as RasterRequest).i).toBe(1);
  port.reply(complete(2, 1)); expect((port.sent.at(-1) as RasterRequest).i).toBe(0);
  port.reply(complete(1)); expect(published.map(r => r.i)).toEqual([1, 0]);
  expect(client.diagnostics().queued).toBe(0);
});

test("worker failures recover queued edits and ignore the terminated worker", () => {
  const ports: Port[] = [], published: RasterResponse[] = []; let errors = 0;
  const client = createRasterClient(() => { const port = new Port(); ports.push(port); return port; },
    r => published.push(r), () => errors++, 1);
  const layer = initialRecipe().layers[0];
  client.request(0, layer); client.request(0, layer);
  ports[0].onerror!({} as ErrorEvent);
  expect(errors).toBe(1); expect(ports[0].terminated).toBe(true);
  expect((ports[1].sent[0] as RasterRequest).version).toBe(2);
  ports[0].reply(complete(1)); expect(published).toEqual([]);
  ports[1].reply(complete(2)); expect(published.map(r => r.version)).toEqual([2]);
  client.request(0, layer); expect((ports[1].sent.at(-1) as RasterRequest).version).toBe(3);
});

test("expected fine Glitter region errors stay visible without killing the worker", () => {
  const port=new Port(), errors:string[]=[], published:RasterResponse[]=[];
  const client=createRasterClient(()=>port,r=>published.push(r),reason=>errors.push(reason??"unknown"),1);
  const layer=initialRecipe().layers[0];
  client.request(0,layer);
  port.reply({i:0,version:1,cancelled:true,error:"Fine Glitter supports the eye UV area."});
  expect(errors).toEqual(["Fine Glitter supports the eye UV area."]);
  expect(port.terminated).toBe(false);
  expect(client.diagnostics().running).toBeNull();
  client.request(0,layer);
  port.reply(complete(2));
  expect(published.map(r=>r.version)).toEqual([2]);
});

test("a preempted failing snapshot is not retried from the queue", () => {
  const ports: Port[] = [], published: RasterResponse[] = [];
  const client = createRasterClient(() => { const port = new Port(); ports.push(port); return port; },
    r => published.push(r), () => {}, 1);
  const layer = initialRecipe().layers[0];
  client.request(0, layer, false); client.request(1, layer, true);
  ports[0].onerror!({} as ErrorEvent);
  expect((ports[1].sent[0] as RasterRequest).version).toBe(2);
  ports[1].reply(complete(2, 1));
  expect(ports[1].sent.length).toBe(1);
  expect(client.diagnostics().running).toBeNull();
  expect(client.diagnostics().queued).toBe(0);
  expect(published.map(r => r.version)).toEqual([2]);
});

test("worker startup failures stop when pending edits are exhausted", () => {
  const ports: Port[] = [];
  const client = createRasterClient(() => { const port = new Port(); ports.push(port); return port; }, () => {}, () => {}, 1);
  expect(ports.length).toBe(0);
  client.request(0, initialRecipe().layers[0]);
  ports[0].onerror!({} as ErrorEvent);
  expect(ports.length).toBe(1);
  expect(client.diagnostics().running).toBeNull();
  client.request(0, initialRecipe().layers[0]);
  expect(ports.length).toBe(2);
  ports[1].onerror!({} as ErrorEvent);
  expect(ports.length).toBe(2);
});

const sizedComplete = (version: number, size: number, optics = false): RasterResponse => ({
  i:0,version,size,data:new Uint8ClampedArray(size*size*4),ms:1,
  ...(optics?{optics:{size,normal:new Uint8Array(size*size*4),surface:new Uint8Array(size*size*4)}}:{}),
});

test("quality resets retain immutable resolution/optics requests and discard old bundles",()=>{
  const port=new Port(),published:RasterResponse[]=[];
  const client=createRasterClient(()=>port,r=>published.push(r),()=>{},32);
  const layer=initialRecipe().layers[0];layer.finish="glitter";
  client.request(0,layer,true,64,true);
  layer.opacity=.1;
  expect((port.sent[0]as RasterRequest).layer.opacity).toBe(.85);
  client.request(0,layer,true,128,true);
  client.reset();client.request(0,layer,true,256,true);
  port.reply(sizedComplete(1,64,true));
  expect(published).toEqual([]);
  const pending=port.sent.at(-1)as RasterRequest;
  expect(pending.version).toBe(3);expect(pending.size).toBe(256);expect(pending.bakeOptics).toBe(true);expect(pending.layer.opacity).toBe(.1);
  port.reply(sizedComplete(1,64,true));expect(client.diagnostics().running?.version).toBe(3);
  port.reply(sizedComplete(3,256,true));expect(published.map(r=>r.version)).toEqual([3]);expect(client.diagnostics().running).toBeNull();
});

test("wrong result dimensions or missing optical payloads fail cleanly and preserve newer edits",()=>{
  const corruptions:((result:any)=>void)[]=[
    r=>{r.size=64},r=>{delete r.size},r=>{r.data=new Uint8ClampedArray(4)},
    r=>{delete r.optics},r=>{r.optics.size=64},r=>{r.optics.normal=new Uint8Array(4)},
    r=>{r.optics.surface=new Uint8Array(4)},r=>{r.ms=NaN},
  ];
  for(const corrupt of corruptions){const ports:Port[]=[],published:RasterResponse[]=[];let failures=0;
    const client=createRasterClient(()=>{const p=new Port();ports.push(p);return p;},r=>published.push(r),()=>failures++,32);
    const layer=initialRecipe().layers[0];layer.finish="shimmer";
    client.request(0,layer,true,32,true);client.request(0,layer,true,64,true);
    const broken=sizedComplete(1,32,true);corrupt(broken);ports[0].reply(broken);
    expect(failures).toBe(1);expect(ports[0].terminated).toBe(true);expect(published).toEqual([]);
    expect((ports[1].sent[0]as RasterRequest).size).toBe(64);
    ports[1].reply(sizedComplete(2,64,true));expect(published.map(r=>r.version)).toEqual([2]);expect(client.diagnostics().running).toBeNull();
  }
});

test("invalid request settings do not enqueue and malformed final data cannot leave a busy queue",()=>{
  const ports:Port[]=[];let failures=0;
  const client=createRasterClient(()=>{const p=new Port();ports.push(p);return p;},()=>{},()=>failures++,32);
  const layer=initialRecipe().layers[0];layer.finish="glitter";
  for(const size of[0,4097,1.5,NaN])expect(()=>client.request(0,layer,true,size)).toThrow();
  expect(()=>client.request(0,layer,true,16,true)).toThrow();expect(ports).toEqual([]);
  client.request(0,layer,true,32,true);ports[0].reply(null as unknown as RasterResponse);
  expect(failures).toBe(1);expect(client.diagnostics().running).toBeNull();expect(client.diagnostics().queued).toBe(0);
  client.request(0,layer);expect(ports.length).toBe(2);expect((ports[1].sent[0]as RasterRequest).version).toBe(2);
  ports[1].reply(sizedComplete(2,32));expect(client.diagnostics().running).toBeNull();
});

test("synchronous worker construction failures clear state without retry loops",()=>{
  let attempts=0,errors=0;
  const client=createRasterClient(()=>{attempts++;throw Error("constructor failed");},()=>{},()=>errors++,32);
  expect(()=>client.request(0,initialRecipe().layers[0])).not.toThrow();
  expect(attempts).toBe(1);expect(errors).toBe(1);expect(client.diagnostics().running).toBeNull();expect(client.diagnostics().queued).toBe(0);
  client.reset();client.request(0,initialRecipe().layers[0]);
  expect(attempts).toBe(2);expect(errors).toBe(2);expect(client.diagnostics().running).toBeNull();
});

test("synchronous initial message failures terminate only the failed worker and permit the next edit",()=>{
  const ports:Port[]=[],published:RasterResponse[]=[];let errors=0;
  const client=createRasterClient(()=>{const p=new Port();ports.push(p);if(ports.length===1)p.postMessage=()=>{throw Error("send failed");};return p;},r=>published.push(r),()=>errors++,32);
  const layer=initialRecipe().layers[0];client.request(0,layer);
  expect(errors).toBe(1);expect(ports[0].terminated).toBe(true);expect(ports.length).toBe(1);expect(client.diagnostics().running).toBeNull();
  client.request(0,layer);expect(ports.length).toBe(2);
  ports[0].reply(sizedComplete(1,32));expect(published).toEqual([]);
  ports[1].reply(sizedComplete(2,32));expect(published.map(r=>r.version)).toEqual([2]);expect(client.diagnostics().running).toBeNull();
});

test("synchronous cancellation delivery failures recover the queued latest edit and allow resets",()=>{
  const ports:Port[]=[],published:RasterResponse[]=[];let errors=0;
  const client=createRasterClient(()=>{const p=new Port(),send=p.postMessage.bind(p);p.postMessage=message=>{if("cancel"in message)throw Error("cancel failed");send(message);};ports.push(p);return p;},r=>published.push(r),()=>errors++,32);
  const layer=initialRecipe().layers[0];client.request(0,layer);client.request(0,layer);
  expect(errors).toBe(1);expect(ports[0].terminated).toBe(true);expect((ports[1].sent[0]as RasterRequest).version).toBe(2);
  ports[0].reply(sizedComplete(1,32));expect(published).toEqual([]);
  ports[1].reply(sizedComplete(2,32));expect(published.map(r=>r.version)).toEqual([2]);
  client.request(0,layer);client.reset();expect(errors).toBe(2);expect(client.diagnostics().running).toBeNull();expect(client.diagnostics().queued).toBe(0);
  client.request(0,layer);expect((ports[2].sent[0]as RasterRequest).version).toBe(4);
  ports[2].reply(sizedComplete(4,32));expect(published.map(r=>r.version)).toEqual([2,4]);
});
