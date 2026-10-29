import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { inLane } from "../src/host/host-jobs";
import { nativeDecodeLanes } from "../src/game/host/native-decode-lanes";
import { ResolverFetcher, WolvenKitFetcher } from "../src/game/host/resolver-host";
import { nativeSetClips } from "../src/animation/host/facial-native";
import { WorkerDecoder, type DecodeWorker, type NativeDecoder, type NativeDecodeOutcome, type WorkerReply } from "../src/native/native-decode";
import { tempDir } from "./temp-dir";

type Message = Parameters<DecodeWorker["postMessage"]>[0];
type Request = Extract<Message, { id: number }>;
class FakeWorker implements DecodeWorker {
  readonly requests: { message: Request; sentAt: number }[] = [];
  elapsed = 0;
  private readonly listeners = new Map<string, ((event: { data: WorkerReply }) => void)[]>();
  postMessage(message: Message) { if ("id" in message) this.requests.push({ message, sentAt: this.elapsed }); }
  addEventListener(type: string, listener: (event: { data: WorkerReply }) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  terminate() {}
  emit(data: WorkerReply) { for (const listener of this.listeners.get("message") ?? []) listener({ data }); }
  reply(outcome: NativeDecodeOutcome = { ok: false, kind: "not-indexed", message: "fixture" }) {
    this.elapsed += 25; // Each fake request costs 25 ms; no wall-clock timing gate.
    this.emit({ type: "outcome", id: this.requests.at(-1)!.message.id, outcome });
  }
}

function setup() {
  const root = tempDir("xfs-native-lanes-"), worker = new FakeWorker();
  const decoder = new WorkerDecoder({ decompressor: { test: "fake" }, roots: new Set(), identity: "test", maxStartFailures: 1, createWorker: () => worker });
  const fetcher = new ResolverFetcher(new WolvenKitFetcher(null, root, () => true), { decoder }, root);
  return { worker, decoder, port: fetcher.nativeDecoder!, close() { decoder.close(); rmSync(root, { recursive: true, force: true }); } };
}
const request = (hash: string) => ({ archivePath: "a.archive", hash, needName: false });

test.each(["decode", "anim", "texture", "mask", "geometry"] as const)("queued ahead %s work delays shown work by at most the one request already running", async kind => {
  const { worker, port, close } = setup();
  const ask = (hash: string): Promise<unknown> => kind === "decode" ? port.decode(request(hash))
    : kind === "anim" ? port.decodeAnim!({ ...request(hash), op: "index" })
    : kind === "texture" ? port.decodeTexture!({ ...request(hash), maxSide: 8 })
    : kind === "mask" ? port.decodeMask!(request(hash)) : port.decodeGeometry!(request(hash));
  const ahead = inLane("ahead", () => Promise.all(Array.from({ length: 100 }, (_, i) => ask(`creator-${i}`))));
  try {
    worker.emit({ type: "ready" });
    expect(worker.requests[0]!.message.request.priority).toBe("background");
    const shown = inLane("shown", () => ask("face"));
    expect(worker.requests).toHaveLength(1);
    worker.reply();
    expect(worker.requests[1]!.message.request.hash).toBe("face");
    expect(worker.requests[1]!.sentAt).toBe(25); // Not 2,500 ms behind the 100-request ahead backlog.
    worker.reply(); await shown;
  } finally { close(); await ahead; }
});

test("person native work precedes shown, each lane stays FIFO, and close settles every lane", async () => {
  const { worker, port, close } = setup();
  const ahead = inLane("ahead", () => Promise.all([port.decode(request("ahead-1")), port.decode(request("ahead-2"))]));
  worker.emit({ type: "ready" });
  const shown = inLane("shown", () => Promise.all([port.decode(request("shown-1")), port.decode(request("shown-2"))]));
  const person = inLane("person", () => Promise.all([port.decode(request("person-1")), port.decode(request("person-2"))]));
  try {
    for (let i = 0; i < 5; i++) worker.reply();
    await shown; await person;
    expect(worker.requests.slice(0, 5).map(r => r.message.request.hash)).toEqual(["ahead-1", "person-1", "person-2", "shown-1", "shown-2"]);
    const stopped = inLane("person", () => port.decode(request("stop-person")));
    const stoppedShown = inLane("shown", () => port.decode(request("stop-shown")));
    close();
    expect((await stopped).ok).toBe(false); expect((await stoppedShown).ok).toBe(false);
    await ahead;
  } finally { close(); await Promise.all([ahead, shown, person]); }
});

test.each(["ahead", "person"] as const)("an expression prefetch raised from %s keeps the new demand's priority", async lane => {
  const { worker, port, close } = setup();
  let priority: "background" | undefined = "background";
  const clips = inLane(lane, () => nativeSetClips(port, "a.archive", "set", new Set(["blink"]), () => priority));
  try {
    worker.emit({ type: "ready" });
    expect(worker.requests[0]!.message.request.priority).toBe("background");
    priority = undefined; // The Expressions view now wants the same in-flight prefetch.
    worker.emit({ type: "outcome", id: worker.requests[0]!.message.id,
      outcome: { ok: true, extractedSha256: "x", index: { rig: null, clips: [{ name: "blink", buffer: "compressed", duration: 1, frames: 2,
        joints: 0, tracks: 0, animationType: "Additive", motionExtraction: false, animatedKeys: 0 }] } } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(worker.requests[1]!.message.request.priority).toBe(lane === "person" ? "person" : "shown");
    worker.reply(); await clips;
  } finally { close(); await clips; }
});

test("worker startup failure settles queued person, shown and ahead requests", async () => {
  const { worker, port, close } = setup();
  const ahead = inLane("ahead", () => Promise.all([port.decode(request("ahead-1")), port.decode(request("ahead-2"))]));
  const shown = inLane("shown", () => port.decode(request("shown")));
  const person = inLane("person", () => port.decode(request("person")));
  try {
    worker.emit({ type: "init-failed", message: "fixture failed" });
    const answers = [...await ahead, await shown, await person];
    expect(answers.every(answer => !answer.ok && answer.kind === "unavailable" && answer.lasting)).toBe(true);
    expect(worker.requests).toHaveLength(0);
  } finally { close(); await Promise.all([ahead, shown, person]); }
});

test("the lane adapter preserves optional capabilities, explicit priority, identity and owner release", async () => {
  const seen: unknown[] = []; let closed = false;
  const decoder: NativeDecoder = { identity: "same", decode: async request => { seen.push(request.priority); return { ok: false, kind: "unavailable", message: "fixture" }; },
    canAnswer: () => !closed, close: () => { closed = true; } };
  const port = nativeDecodeLanes(decoder);
  expect(nativeDecodeLanes(port)).toBe(port); expect(nativeDecodeLanes(decoder)).toBe(port);
  expect(port.decodeAnim).toBeUndefined(); expect(port.identity).toBe("same");
  await port.decode(request("outside"));
  await inLane("person", () => port.decode({ ...request("intentional-prefetch"), priority: "background" }));
  expect(seen).toEqual([undefined, "background"]);
  port.close(); expect(closed).toBe(true); expect(port.canAnswer!()).toBe(false);
});
