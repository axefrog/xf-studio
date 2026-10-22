/**
 * S1's timing gates on the production code (phase 1f): commit to acknowledgement and main-thread cost per committed edit of a look at its
 * largest, over the real localhost host (`harness/s1-host.ts`: the library owner, the document store and its routes, WAL with the raised
 * autocheckpoint, and the durability flush at its production timing) on a library in `<library-dir>`, so the data drive can be measured.
 *   bun tools/s1-latency.ts <library-dir> <outbox-dir> <look.json> [edits-scale=1]
 *
 * Each cadence (`person`: an edit every 150–400 ms with a burst of five 30 ms apart now and then; `stress`: bursts 2 ms apart and gaps of
 * 12–37 ms, Undo held down) runs twice: with the outbox stored at once (`now`, S1's gate) and as the look editor records (`soon`: stored
 * within 250 ms). Each run reports the main-thread cost of `commit`, commit to acknowledgement, the host's round trip per command (what the
 * drive changes), and the bytes the host process wrote per command (Windows' process I/O counters: the WAL, its checkpoints into the
 * library file and the flush).
 *
 * The window is this process: the production `DocumentOutbox` over the page's HTTP transport and its localStorage adapter on a file written
 * synchronously (the stand-in the kill harnesses use; a browser's `localStorage.setItem` is cheaper).
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DocumentOutbox } from "../../../projects/xf-studio/authoring/src/platform/core/document-outbox";
import { browserDocuments } from "../../../projects/xf-studio/authoring/src/app/browser/browser-documents-device";
import { localOutboxStorage } from "../../../projects/xf-studio/authoring/src/app/browser/outbox-storage";
import { fileStorage } from "../harness/file-storage";
import { percentile, spawn, terminate } from "./kit";

const [libraryDir, outboxDir, lookPath, scaleArg] = process.argv.slice(2);
if (!libraryDir || !outboxDir || !lookPath) throw Error("Usage: bun tools/s1-latency.ts <library-dir> <outbox-dir> <look.json> [edits-scale]");
const scale = Number(scaleArg ?? 1) || 1;
for (const dir of [libraryDir, outboxDir]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
const look = JSON.parse(readFileSync(lookPath, "utf8")) as Record<string, unknown>;

/** Bytes a process has written so far (Win32_Process.WriteTransferCount), or null where that can't be read. */
function bytesWritten(pid: number): number | null {
  const run = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command",
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").WriteTransferCount`], { stdout: "pipe", stderr: "ignore", windowsHide: true });
  const value = Number(run.stdout.toString().trim());
  return run.exitCode === 0 && Number.isFinite(value) && value > 0 ? value : null;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const stats = (values: number[], digits = 1) => ({ p50: +percentile(values, 50)!.toFixed(digits), p95: +percentile(values, 95)!.toFixed(digits),
  max: +Math.max(...values).toFixed(digits) });

const host = spawn("harness/s1-host.ts", ["localhost", join(libraryDir, "library.sqlite")], undefined, { XFS_FLUSH: "production" });
const line = await host.wait(text => text.startsWith("port "));
if (!line) throw Error("The host didn't start.");
const base = `http://127.0.0.1:${line.slice(5).trim()}`;
const roundTrips: number[] = [];
const http = browserDocuments("/api/documents", (url, init) => fetch(base + url, { ...init, headers: { Origin: base, ...(init?.headers as Record<string, string> | undefined) } }));
const transport = { ...http, async transact(request: Parameters<typeof http.transact>[0]) {
  const start = performance.now();
  try { return await http.transact(request); } finally { roundTrips.push(performance.now() - start); }
} };
const outbox = new DocumentOutbox(transport, localOutboxStorage(fileStorage(join(outboxDir, "local-storage.json")), "latency"), { retryMs: 40 });
const pending = new Map<string, number[]>(), ackMs: number[] = [];
outbox.subscribe(event => {
  if (event.kind !== "acknowledged") return;
  const now = performance.now();
  for (const at of pending.get(event.entry.id) ?? []) ackMs.push(now - at);
  pending.delete(event.entry.id);
});
const runs: Record<string, unknown>[] = [];
const refs = (["now", "soon"] as const).flatMap(store => (["person", "stress"] as const).map(cadence => ({ store, cadence, ref: { kind: "look-working", id: `c-latency/${store}-${cadence}` } })));
for (const { ref } of refs) outbox.hold(ref, null);
outbox.open();
for (const { store, cadence, ref } of refs) {
  const edits = Math.round((cadence === "person" ? 120 : 300) * scale);
  ackMs.length = 0; roundTrips.length = 0;
  const mainMs: number[] = [], before = bytesWritten(host.proc.pid);
  for (let i = 0; i < edits; i++) {
    const start = performance.now();
    // A real edit changes the look near its start and adds an Undo step, so everything after it moves and SQLite rewrites the whole
    // row; a field that alternates in length at the start does the same (an edit of equal size would rewrite only the changed pages).
    const entry = outbox.commit("look.update", [{ ...ref, value: { edit: "e".repeat(1 + i % 2), ...look } }], { store });
    const end = performance.now();
    mainMs.push(end - start);
    pending.set(entry.id, [...pending.get(entry.id) ?? [], end]);
    if (cadence === "person") await sleep(i % 15 >= 10 ? 30 : 150 + (i * 97) % 250);
    else await sleep(i % 20 < 4 ? 2 : 12 + (i * 7) % 25);
  }
  while (outbox.pendingEntries().length) await sleep(10);
  const commands = roundTrips.length, after = bytesWritten(host.proc.pid);
  runs.push({ store, cadence, edits, commands, mainMs: stats(mainMs, 3), ackMs: stats(ackMs), roundTripMs: stats(roundTrips),
    hostBytesPerCommand: before !== null && after !== null && commands ? Math.round((after - before) / commands) : null });
}
await sleep(6_000); // the production flush (within 5 s) has run; its writes are counted below
const total = bytesWritten(host.proc.pid);
await terminate(host);
const units = JSON.stringify(look).length, memory = JSON.stringify(look.memory ?? null).length;
console.log(JSON.stringify({ library: libraryDir, units, historyShare: +(memory / units).toFixed(3), hostBytesTotal: total, runs }, null, 1));
process.exit(0);
