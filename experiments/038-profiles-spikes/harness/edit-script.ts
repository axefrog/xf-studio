/**
 * S1's timing script, shared by the Bun window and the browser page: committed edits of one look through `SpikeWindow`, each
 * timed on the main thread (the value's new fields, the outbox write, the coalescing) and from commit to acknowledgement.
 * Cadences: `person` (a committed edit every 150–400 ms, with a burst of five 30 ms apart now and then: gesture ends, clicks,
 * Undo) and `stress` (bursts at 2 ms and gaps of 12–37 ms: Undo held down).
 */
import type { HostPort, OutboxStorage } from "../prototype/window";
import { SpikeWindow, type Entry } from "../prototype/window";

export type Timing = { cadence: string; edits: number; mainMs: number[]; ackMs: number[]; commands: number };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runScript(port: HostPort, storage: OutboxStorage, look: Record<string, unknown>, cadence: "person" | "stress",
  edits: number, docId: string): Promise<Timing> {
  const pending = new Map<Entry, number[]>();
  const ackMs: number[] = [], mainMs: number[] = [];
  let commands = 0;
  const window = new SpikeWindow(port, storage, {
    sent() { commands++; },
    acknowledged(entry) { const now = performance.now(); for (const t of pending.get(entry) ?? []) ackMs.push(now - t); pending.delete(entry); },
  });
  window.open();
  const ref = { kind: "look-working", id: docId };
  for (let i = 0; i < edits; i++) {
    const start = performance.now();
    const entry = window.commit("look.edit", [{ ...ref, value: { ...look, seqs: { me: i }, edit: i } }]);
    const end = performance.now();
    mainMs.push(end - start);
    pending.set(entry, [...pending.get(entry) ?? [], end]);
    if (cadence === "person") await sleep(i % 15 >= 10 ? 30 : 150 + (i * 97) % 250);
    else await sleep(i % 20 < 4 ? 2 : 12 + (i * 7) % 25);
  }
  while (window.entries.length) await sleep(10);
  return { cadence, edits, mainMs, ackMs, commands };
}
