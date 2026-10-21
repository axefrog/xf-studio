/**
 * The S1 kill harness's renderer: one window with a file-backed outbox, editing a shared look (and a look and collection of
 * its own) through the host. Every edit's value carries `seqs[<window>] = <seq>`, so presence is checkable.
 *   bun harness/window-proc.ts <name> <outbox.json> <port-file> <first-seq> <edits> [payload.json]
 * Prints `rec <key> <seq> <0|1>` after each synchronous outbox write, `ack <key> <seq> <revision> <replayed>`, `conflict <key>`,
 * `fork <key>`, and `done` once its edits are all acknowledged. `XFS_KILL=<point>:<n>` terminates it at after-record, in-flight,
 * ack-received or after-ack on the n-th occurrence.
 */
import { readFileSync } from "node:fs";
import { refKey, type Ref, type TransactRequest, type TransactResult } from "../prototype/host";
import { FileOutbox } from "../prototype/storage";
import { SpikeWindow, type Entry } from "../prototype/window";

const [name, outboxPath, portFile, firstSeq, editCount, payloadPath] = process.argv.slice(2);
const [killPoint, killAt] = (process.env.XFS_KILL ?? ":").split(":");
const counts: Record<string, number> = {};
const point = (at: string) => { counts[at] = (counts[at] ?? 0) + 1; if (at === killPoint && counts[at] === Number(killAt)) process.kill(process.pid, "SIGKILL"); };
const payload = payloadPath ? JSON.parse(readFileSync(payloadPath, "utf8")) : { text: "x".repeat(40_000) };
const SHARED: Ref = { kind: "look-working", id: "c-1/shared" };
const OWN: Ref = { kind: "look-working", id: `c-1/${name}` };
const OWN_COLLECTION: Ref = { kind: "collection-working", id: `c-${name}` };
const refs = [SHARED, OWN, OWN_COLLECTION];

const base = () => `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;
const post = async (path: string, body: unknown) => {
  const response = await fetch(base() + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
};
const port = {
  async transact(request: TransactRequest): Promise<TransactResult> {
    const sent = post("/transact", request);
    point("in-flight");
    const result = await sent as TransactResult;
    point("ack-received");
    return result;
  },
};
const out = (line: string) => process.stdout.write(line + "\n");
const seqOf = (entry: Entry, ref: Ref) => ((entry.writes.find(write => refKey(write) === refKey(ref))?.value as { seqs?: Record<string, number> })?.seqs ?? {})[name];
let forks = 0;
const window = new SpikeWindow(port, new FileOutbox(outboxPath), {
  recorded(entry, ok) { for (const write of entry.writes) out(`rec ${refKey(write)} ${seqOf(entry, write)} ${ok ? 1 : 0}`); point("after-record"); },
  acknowledged(entry, revisions, replayed) {
    for (const write of entry.writes) out(`ack ${refKey(write)} ${seqOf(entry, write)} ${revisions[refKey(write)]} ${replayed ?? "-"}`);
    point("after-ack");
  },
  conflict(entry) {
    for (const write of entry.writes) out(`conflict ${refKey(write)}`);
    // The script's person picks Keep both a moment later: mine becomes a fork, never written over theirs.
    setTimeout(() => {
      if (!window.entries.includes(entry)) return;
      const fork = window.keepBoth(entry, ref => `${ref.id}~${name}-${process.pid}-${++forks}`);
      for (const write of fork.writes) out(`fork ${refKey(write)} ${seqOf(fork, write)}`);
    }, 10);
  },
}, { retryMs: 40 });

// Baselines: what the library holds now (retried while the host is down).
const baselines: [Ref, { revision: number; value: unknown } | null][] = [];
for (const ref of refs) for (;;) {
  try { baselines.push([ref, await (await fetch(`${base()}/doc?kind=${ref.kind}&id=${encodeURIComponent(ref.id)}`)).json() as never]); break; }
  catch { await Bun.sleep(40); }
}
window.open(baselines);

// The revision check (§2.2), every 40 ms here instead of 10 s.
const check = setInterval(async () => {
  try {
    const revisions = await post("/revisions", refs) as Record<string, number>;
    for (const ref of refs) if (revisions[refKey(ref)] > (window.held.get(refKey(ref))?.revision ?? 0)) {
      const stored = await (await fetch(`${base()}/doc?kind=${ref.kind}&id=${encodeURIComponent(ref.id)}`)).json() as { revision: number; value: unknown } | null;
      if (stored) window.refresh(ref, stored);
    }
  } catch { /* host down */ }
}, 40);

const valueFor = (ref: Ref, seq: number) => {
  const held = window.value(ref) as { seqs?: Record<string, number> } | undefined;
  return { ...payload, seqs: { ...(held?.seqs ?? {}), [name]: seq } };
};
let seq = Number(firstSeq);
const total = Number(editCount);
for (let i = 0; i < total; i++, seq++) {
  if (i % 10 === 9) window.commit("collection.addLook", [{ ...OWN_COLLECTION, value: valueFor(OWN_COLLECTION, seq) }, { ...OWN, value: valueFor(OWN, seq) }]);
  else {
    const ref = i % 3 === 2 ? OWN : SHARED;
    if (window.entries.some(entry => entry.state === "conflict" && entry.writes.some(write => refKey(write) === refKey(ref)))) { await Bun.sleep(15); continue; }
    window.commit("look.edit", [{ ...ref, value: valueFor(ref, seq) }]);
  }
  // A person's pace: mostly separate edits, sometimes a quick burst (Undo spam).
  await Bun.sleep(i % 20 < 4 ? 2 : 12 + (i * 7) % 25);
}
for (;;) {
  await Bun.sleep(30);
  if (window.entries.length === 0) break;
}
clearInterval(check);
out("done");
process.exit(0);
