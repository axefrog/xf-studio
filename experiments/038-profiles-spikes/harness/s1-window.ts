/**
 * The outbox harness's renderer, on the production code (phase 1 chunk 1c): one window's `DocumentOutbox` over its host's routes,
 * editing a shared look (and a look and collection of its own) as a person would. Every edit's value carries `seqs[<window>] = <seq>`, so
 * presence is checkable.
 *   bun harness/s1-window.ts <name> <localhost|desktop|desktop-other> <storage.json> <port-file> <first-seq> <edits> [payload.json]
 *
 * - `localhost`: the browser's storage (`localOutboxStorage`, workspace `browser-<name>`), no lease: each window is its own workspace.
 * - `desktop`: the desktop page's storage (`desktopOutboxStorage`: this launch's WebView storage and the host's outbox files), holding
 *   the workspace lease through the real adapter, every command and outbox write fenced by it, as the bootstrap wires it.
 * - `desktop-other`: a second writer on the desktop host's library that isn't the desktop page (a localhost window on the same library).
 *
 * Prints `rec <key> <seq> <0|1>` after each command is recorded (1: protected), `ack <key> <seq> <revision> <replayed>`,
 * `conflict <key>`, `fork <key> <seq>`, `warning <0|1>` when the unprotected warning changes, and `done` once its edits are all in the
 * library. `XFS_KILL=<point>:<n>` terminates it at after-record, in-flight, ack-received or after-ack on the n-th occurrence;
 * `XFS_FAIL_OUTBOX=<from>:<to>` makes the outbox's storage refuse every write between those edits (a full quota).
 */
import { readFileSync } from "node:fs";
import { DocumentOutbox } from "../../../projects/xf-studio/authoring/src/platform/core/document-outbox";
import { browserDocuments } from "../../../projects/xf-studio/authoring/src/app/browser/browser-documents-device";
import { desktopOutboxStorage, localOutboxStorage } from "../../../projects/xf-studio/authoring/src/app/browser/outbox-storage";
import { browserLeaseClock, desktopWorkspaceLease } from "../../../projects/xf-studio/authoring/src/app/browser/workspace-lease-device";
import { WorkspaceLease } from "../../../projects/xf-studio/authoring/src/app/workspace/workspace-lease";
import { leasedDocuments } from "../../../projects/xf-studio/authoring/src/app/workspace/leased-documents";
import { formatFence, WORKSPACE_FENCE_HEADER } from "../../../projects/xf-studio/authoring/src/platform/api/document-store";
import { documentKey, type DocumentRef } from "../../../projects/xf-studio/authoring/src/platform/api/document-commands";
import type { OutboxEntry } from "../../../projects/xf-studio/authoring/src/platform/core/document-outbox";
import { fileStorage } from "./file-storage";

const [name, mode, storagePath, portFile, firstSeq, editCount, payloadPath] = process.argv.slice(2);
const [killPoint, killAt] = (process.env.XFS_KILL ?? ":").split(":");
const [failFrom, failTo] = (process.env.XFS_FAIL_OUTBOX ?? "-1:-1").split(":").map(Number);
const counts: Record<string, number> = {};
const point = (at: string) => { counts[at] = (counts[at] ?? 0) + 1; if (at === killPoint && counts[at] === Number(killAt)) process.kill(process.pid, "SIGKILL"); };
const payload = payloadPath ? JSON.parse(readFileSync(payloadPath, "utf8")) : { text: "x".repeat(40_000) };
const SHARED: DocumentRef = { kind: "look-working", id: "c-1/shared" };
const OWN: DocumentRef = { kind: "look-working", id: `c-1/${name}` };
const OWN_COLLECTION: DocumentRef = { kind: "collection-working", id: `c-${name}` };
const refs = [SHARED, OWN, OWN_COLLECTION];
const out = (line: string) => process.stdout.write(line + "\n");

/** The host's addresses: commands go to its front; on desktop everything else goes to the desktop server, with its session cookie. */
const host = () => { const [front, inner, cookie] = readFileSync(portFile!, "utf8").trim().split(" "); return { front: `http://127.0.0.1:${front}`,
  inner: `http://127.0.0.1:${inner ?? front}`, cookie }; };
const send = (url: string, init: RequestInit = {}) => {
  const { front, inner, cookie } = host(), base = url.startsWith("/api/documents/transact") ? front : inner;
  return fetch(base + url, { ...init, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as Record<string, string> | undefined) } });
};
let editing = 0;
const browser = fileStorage(storagePath!, { fail: () => editing >= failFrom && editing < failTo });

// The workspace lease (desktop): the page's generation fences its commands and outbox writes, as the bootstrap's do.
let lease: WorkspaceLease | null = null;
if (mode === "desktop") {
  lease = new WorkspaceLease(desktopWorkspaceLease({ endpoint: "/api/desktop/workspace/lease", send, settle: async () => {} }), { clock: browserLeaseClock });
  const started = await lease.start();
  // A page killed a moment ago may still hold it: Use it here waits until the host sees that page end.
  if (!started.writable && !(await lease.takeOver()).ok) throw Error(`The desktop page didn't get the workspace (${started.phase}).`);
}
const fence = () => { const generation = lease?.generation() ?? null; return generation === null ? null : { workspace: "desktop", generation }; };
const http = browserDocuments("/api/documents", send, fence);
// The kill points around a command in flight, on the real transport.
const transport = { ...http,
  async transact(request: Parameters<typeof http.transact>[0]) {
    const sent = http.transact(request);
    point("in-flight");
    const answer = await sent;
    point("ack-received");
    return answer;
  } };
let storage;
if (mode === "desktop") {
  const { launch, keys } = await (await send("/api/desktop/workspace/outbox")).json() as { launch: string; keys: Record<string, string> };
  out(`launch ${launch}`);
  storage = desktopOutboxStorage(browser, "desktop", launch, keys, async (key, text) => {
    const lease = fence();
    if (!lease) throw Error("This window no longer holds the workspace.");
    const response = await send("/api/desktop/workspace/outbox", { method: "POST", headers: { "Content-Type": "application/json", [WORKSPACE_FENCE_HEADER]: formatFence(lease) },
      body: JSON.stringify({ key, text }) });
    if (!response.ok) throw Error("The outbox key wasn't stored.");
  });
} else storage = localOutboxStorage(browser, `browser-${name}`);
const documents = lease ? leasedDocuments(transport, lease) : transport;
const outbox = new DocumentOutbox(documents, storage, { retryMs: 40,
  ...(lease ? { writable: () => lease!.writable(), sendable: () => lease!.draining() } : {}) });

const seqOf = (entry: OutboxEntry, ref: DocumentRef) => ((entry.writes.find(write => documentKey(write) === documentKey(ref))?.value as { seqs?: Record<string, number> })?.seqs ?? {})[name!];
let forks = 0, warned = false;
outbox.subscribe(event => {
  if (event.kind === "acknowledged") {
    for (const write of event.entry.writes) out(`ack ${documentKey(write)} ${seqOf(event.entry, write)} ${event.revisions[documentKey(write)]} ${event.replayed ?? "-"}`);
    point("after-ack");
  } else if (event.kind === "conflict") {
    const entry = event.entry;
    for (const write of entry.writes) out(`conflict ${documentKey(write)}`);
    // The script's person picks Keep both a moment later: mine becomes a fork, never written over theirs.
    setTimeout(() => {
      if (!outbox.conflicts().some(item => item.id === entry.id)) return;
      const copy = outbox.keepBoth(entry.id, mine => mine.map(edit => ({ ...edit, id: `${edit.id}~${name}-${process.pid}-${++forks}` })));
      for (const write of copy.writes) out(`fork ${documentKey(write)} ${seqOf(copy, write)}`);
    }, 10);
  } else if (event.kind === "status") {
    const now = outbox.status().unprotected.length > 0;
    if (now !== warned) { warned = now; out(`warning ${now ? 1 : 0}`); }
  }
});

// Baselines: what the library holds now (retried while the host is down), as an owner reads its documents at start.
for (const kind of ["look-working", "collection-working"]) for (;;) {
  try { for (const doc of await documents.list(kind)) outbox.hold({ kind, id: doc.id }, { revision: doc.revision, value: doc.value }); break; }
  catch { await Bun.sleep(40); }
}
for (const ref of refs) if (!outbox.document(ref)) outbox.hold(ref, null);
outbox.open();

// The revision check (§2.2), every 40 ms here instead of 10 s.
const check = setInterval(() => { void outbox.check().catch(() => {}); }, 40);

const valueFor = (ref: DocumentRef, seq: number) => {
  const held = outbox.document(ref)?.value as { seqs?: Record<string, number> } | undefined;
  return { ...payload, seqs: { ...(held?.seqs ?? {}), [name!]: seq } };
};
const record = (command: string, edits: { kind: string; id: string; value: unknown }[]) => {
  let entry: OutboxEntry;
  // A page that lost its host (desktop: the app is ending) records nothing more; the harness ends it.
  try { entry = outbox.commit(command, edits); } catch { return; }
  const protectedNow = !edits.some(edit => outbox.status().unprotected.some(ref => documentKey(ref) === documentKey(edit)));
  for (const edit of edits) out(`rec ${documentKey(edit)} ${seqOf(entry, edit)} ${protectedNow ? 1 : 0}`);
  point("after-record");
};
let seq = Number(firstSeq);
const total = Number(editCount);
for (let i = 0; i < total; i++, seq++) {
  editing = i;
  if (i % 10 === 9) record("collection.addLook", [{ ...OWN_COLLECTION, value: valueFor(OWN_COLLECTION, seq) }, { ...OWN, value: valueFor(OWN, seq) }]);
  else {
    const ref = i % 3 === 2 ? OWN : SHARED;
    if (outbox.conflicts().some(entry => entry.writes.some(write => documentKey(write) === documentKey(ref)))) { await Bun.sleep(15); continue; }
    record("look.edit", [{ ...ref, value: valueFor(ref, seq) }]);
  }
  // A person's pace: mostly separate edits, sometimes a quick burst (Undo spam).
  await Bun.sleep(i % 20 < 4 ? 2 : 12 + (i * 7) % 25);
}
editing = total;
// Once storage works again, the warning clears with the next record that lands (Try again does the same).
if (outbox.status().unprotected.length) outbox.protect();
for (;;) {
  await Bun.sleep(30);
  if (outbox.pendingEntries().length === 0) break;
}
if (mode === "desktop" && "settle" in storage) await (storage as { settle(): Promise<boolean> }).settle();
clearInterval(check);
out("done");
process.exit(0);
