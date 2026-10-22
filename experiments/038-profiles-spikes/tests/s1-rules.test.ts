/** S1: the outbox's acknowledgement and rebasing rules (A1–A7) against the real library owner, in memory. */
import { expect, test } from "bun:test";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { SpikeHost, type TransactRequest, type TransactResult } from "../prototype/host";
import { MemoryOutbox } from "../prototype/storage";
import { SpikeWindow } from "../prototype/window";

const LOOK = { kind: "look-working", id: "c-1/l-1" };
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** A port to the host whose answers a test can delay or lose after the commit. */
function rig() {
  const host = new SpikeHost(openLibraryDatabase(":memory:"));
  const calls: TransactRequest[] = [];
  let loseNext = 0, hold: Promise<void> | null = null;
  const port = {
    async transact(request: TransactRequest): Promise<TransactResult> {
      calls.push(structuredClone(request));
      if (hold) await hold;
      const result = host.transact(request);
      if (loseNext > 0) { loseNext--; throw Error("connection lost"); }
      return result;
    },
  };
  return { host, port, calls, loseAcks(n: number) { loseNext = n; },
    gate() { let open!: () => void; hold = new Promise(resolve => { open = resolve; }); return () => { hold = null; open(); }; } };
}
const settle = async (window: SpikeWindow) => { for (let i = 0; i < 40 && window.entries.some(e => e.state === "queued"); i++) await tick(10); };

test("a committed command whose acknowledgement was lost replays as the window's own write (receipt)", async () => {
  const { host, port, calls, loseAcks } = rig();
  const outbox = new MemoryOutbox();
  const conflicts: unknown[] = [];
  const window = new SpikeWindow(port, outbox, { conflict: entry => conflicts.push(entry) }, { retryMs: 5 });
  window.open();
  loseAcks(1);
  window.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
  await settle(window);
  expect(conflicts).toEqual([]);
  expect(window.entries).toEqual([]);
  expect(calls.length).toBe(2);
  expect(calls[1].id).toBe(calls[0].id);
  expect(host.get(LOOK)).toEqual({ revision: 1, value: { n: 1 } });
  expect(window.held.get("look-working/c-1/l-1")!.revision).toBe(1);
});

test("the same after a renderer restart, and with a successor coalesced behind the lost command", async () => {
  const { host, port, loseAcks, gate } = rig();
  const outbox = new MemoryOutbox();
  const first = new SpikeWindow(port, outbox, {}, { retryMs: 5 });
  first.open();
  const open = gate();
  loseAcks(1);
  first.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
  await tick();
  first.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
  first.commit("look.edit", [{ ...LOOK, value: { n: 3 } }]);
  // One frozen entry in flight and one successor holding the newest value, based after it.
  expect(first.entries.length).toBe(2);
  expect(first.entries[1].writes[0]).toMatchObject({ base: { after: first.entries[0].id }, value: { n: 3 } });
  open();
  await tick(1);
  first.stop(); // The renderer dies with the acknowledgement lost.
  expect(host.get(LOOK)!.revision).toBe(1);
  const conflicts: unknown[] = [], acks: (string | undefined)[] = [];
  const second = new SpikeWindow(port, outbox, { conflict: entry => conflicts.push(entry), acknowledged: (_e, _r, replayed) => acks.push(replayed) }, { retryMs: 5 });
  second.open([[LOOK, host.get(LOOK)]]);
  await settle(second);
  expect(conflicts).toEqual([]);
  expect(acks).toEqual(["receipt", undefined]);
  expect(host.get(LOOK)).toEqual({ revision: 2, value: { n: 3 } });
  expect(outbox.load()).toEqual([]);
});

test("a replay whose receipt was purged is acknowledged when the stored value is exactly the replayed one", async () => {
  const { host, port, loseAcks } = rig();
  const outbox = new MemoryOutbox();
  const first = new SpikeWindow(port, outbox, {}, { retryMs: 1000 });
  first.open();
  loseAcks(1);
  first.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
  await tick(5);
  first.stop();
  expect(host.purgeReceipts(-1)).toBe(1);
  const acks: (string | undefined)[] = [];
  const second = new SpikeWindow(port, outbox, { acknowledged: (_e, _r, replayed) => acks.push(replayed) });
  second.open([[LOOK, host.get(LOOK)]]);
  await settle(second);
  expect(acks).toEqual(["equal"]);
  expect(second.conflicts()).toEqual([]);
});

test("edits during an in-flight command coalesce into one successor, rebased onto the acknowledged revision", async () => {
  const { host, port, calls, gate } = rig();
  const window = new SpikeWindow(port, new MemoryOutbox());
  window.open();
  const open = gate();
  window.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
  await tick();
  for (let n = 2; n <= 10; n++) window.commit("look.edit", [{ ...LOOK, value: { n } }]);
  expect(window.entries.map(entry => entry.writes[0].value)).toEqual([{ n: 1 }, { n: 10 }]);
  open();
  await settle(window);
  expect(calls.map(call => call.writes[0].base)).toEqual([0, 1]);
  expect(host.get(LOOK)).toEqual({ revision: 2, value: { n: 10 } });
  // The second command tells the host to forget the first command's receipt.
  expect(calls[1].forget).toEqual([calls[0].id]);
});

test("another writer's revision makes a conflict that keeps mine, folds the successor and never retries", async () => {
  const { host, port, calls, gate } = rig();
  host.transact({ id: "other-1", command: "look.edit", writes: [{ ...LOOK, base: 0, value: { theirs: 1 } }] });
  const window = new SpikeWindow(port, new MemoryOutbox());
  window.open([[LOOK, { revision: 0, value: undefined }]]); // Read before the other writer.
  const open = gate();
  window.commit("look.edit", [{ ...LOOK, value: { mine: 1 } }]);
  await tick();
  window.commit("look.edit", [{ ...LOOK, value: { mine: 2 } }]);
  open();
  await settle(window); await tick(20);
  expect(calls.length).toBe(1);
  expect(window.conflicts().length).toBe(1);
  expect(window.conflicts()[0].writes[0].value).toEqual({ mine: 2 });
  expect(window.entries.length).toBe(1);
  expect(host.get(LOOK)).toEqual({ revision: 1, value: { theirs: 1 } });
  // Keep both: mine becomes a fork, the original takes theirs; nothing overwrites theirs.
  window.keepBoth(window.conflicts()[0], ref => `${ref.id}~fork`);
  await settle(window);
  expect(host.get(LOOK)).toEqual({ revision: 1, value: { theirs: 1 } });
  expect(host.get({ ...LOOK, id: "c-1/l-1~fork" })).toEqual({ revision: 1, value: { mine: 2 } });
  expect(window.value(LOOK)).toEqual({ theirs: 1 });
});

test("Keep mine is an explicit command over the newer revision", async () => {
  const { host, port } = rig();
  host.transact({ id: "other-1", command: "look.edit", writes: [{ ...LOOK, base: 0, value: { theirs: 1 } }] });
  const window = new SpikeWindow(port, new MemoryOutbox());
  window.open([[LOOK, { revision: 0, value: undefined }]]);
  window.commit("look.edit", [{ ...LOOK, value: { mine: 1 } }]);
  await settle(window); await tick(10);
  window.keepMine(window.conflicts()[0]);
  await settle(window);
  expect(host.get(LOOK)).toEqual({ revision: 2, value: { mine: 1 } });
});

test("a failed outbox write shows the warning, never blocks the edit, and clears on the next successful write", async () => {
  const { host, port } = rig();
  const outbox = new MemoryOutbox();
  const recorded: boolean[] = [];
  const window = new SpikeWindow(port, outbox, { recorded: (_e, ok) => recorded.push(ok) });
  window.open();
  outbox.fail = true;
  window.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
  expect(window.protectedWrites).toBe(false);
  expect([...window.unprotected]).toEqual(["look-working/c-1/l-1"]);
  expect(window.value(LOOK)).toEqual({ n: 1 });
  await settle(window);
  expect(host.get(LOOK)).toEqual({ revision: 1, value: { n: 1 } }); // Still sent.
  expect(window.protectedWrites).toBe(false); // The acknowledgement's outbox write failed too.
  outbox.fail = false;
  window.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
  expect(window.protectedWrites).toBe(true);
  expect(recorded).toEqual([false, true]);
});

test("a multi-document command waits behind each document's in-flight command and is never coalesced", async () => {
  const { host, port, calls, gate } = rig();
  const COLLECTION = { kind: "collection-working", id: "c-1" };
  const window = new SpikeWindow(port, new MemoryOutbox());
  window.open();
  const open = gate();
  window.commit("look.edit", [{ ...LOOK, value: { n: 1 } }]);
  await tick();
  window.commit("collection.removeLook", [{ ...COLLECTION, value: { removed: ["l-1"] } }, { ...LOOK, value: { n: 1, state: "removed" } }]);
  window.commit("look.edit", [{ ...LOOK, value: { n: 2 } }]);
  expect(window.entries.length).toBe(3);
  open();
  await settle(window);
  expect(calls.map(call => call.command)).toEqual(["look.edit", "collection.removeLook", "look.edit"]);
  expect(host.get(LOOK)).toEqual({ revision: 3, value: { n: 2 } });
  expect(host.get(COLLECTION)!.revision).toBe(1);
});
