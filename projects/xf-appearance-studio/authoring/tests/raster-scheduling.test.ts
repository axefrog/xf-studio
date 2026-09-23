import { expect, test } from "bun:test";
import { createRasterJob, coverage, initialRecipe, raster } from "../src/recipe";
import { createRasterProcessor, type RasterRequest, type RasterResponse } from "../src/raster-processor";
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
const complete = (version: number, i = 0): RasterResponse => ({ i, version, data: new Uint8ClampedArray(4), ms: 1 });

test("client coalesces edits and rejects late masks across cancellation and preset resets", () => {
  const port = new Port(), published: RasterResponse[] = [], layer = initialRecipe().layers[0];
  const client = createRasterClient(() => port, r => published.push(r), () => {});
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
  const client = createRasterClient(() => port, r => published.push(r), () => {});
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
    r => published.push(r), () => errors++);
  const layer = initialRecipe().layers[0];
  client.request(0, layer); client.request(0, layer);
  ports[0].onerror!({} as ErrorEvent);
  expect(errors).toBe(1); expect(ports[0].terminated).toBe(true);
  expect((ports[1].sent[0] as RasterRequest).version).toBe(2);
  ports[0].reply(complete(1)); expect(published).toEqual([]);
  ports[1].reply(complete(2)); expect(published.map(r => r.version)).toEqual([2]);
  client.request(0, layer); expect((ports[1].sent.at(-1) as RasterRequest).version).toBe(3);
});

test("a preempted failing snapshot is not retried from the queue", () => {
  const ports: Port[] = [], published: RasterResponse[] = [];
  const client = createRasterClient(() => { const port = new Port(); ports.push(port); return port; },
    r => published.push(r), () => {});
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
  const client = createRasterClient(() => { const port = new Port(); ports.push(port); return port; }, () => {}, () => {});
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
