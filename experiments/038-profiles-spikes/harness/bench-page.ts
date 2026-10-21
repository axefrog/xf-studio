/** S1 in a real browser: the outbox in localStorage, commands over fetch to the spike host (bundled by tools/s1-latency.ts). */
import type { TransactRequest, TransactResult } from "../prototype/host";
import type { Entry, OutboxStorage } from "../prototype/window";
import { runScript } from "./edit-script";

const KEY = "xfs.spike.outbox";
const storage: OutboxStorage = {
  save(entries: readonly Entry[]) { localStorage.setItem(KEY, JSON.stringify(entries)); },
  load() { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Entry[]; },
};
const port = {
  async transact(request: TransactRequest): Promise<TransactResult> {
    const response = await fetch("/transact", { method: "POST", body: JSON.stringify(request), headers: { "Content-Type": "application/json" } });
    return response.json() as Promise<TransactResult>;
  },
};
const status = document.getElementById("status")!;
localStorage.removeItem(KEY);
const look = await (await fetch("/look.json")).json() as Record<string, unknown>;
// localStorage.setItem alone, for the record.
const text = JSON.stringify([{ id: "x", writes: [{ value: look }] }]);
const setItem: number[] = [];
for (let i = 0; i < 50; i++) { const t = performance.now(); localStorage.setItem(`${KEY}.probe`, text + i); setItem.push(performance.now() - t); }
localStorage.removeItem(`${KEY}.probe`);
const results = [];
for (const [cadence, edits] of [["person", 120], ["stress", 300]] as const) {
  status.textContent = `Running ${cadence}…`;
  results.push(await runScript(port, storage, look, cadence, edits, `c-browser/${cadence}-${Date.now()}`));
}
await fetch("/results", { method: "POST", body: JSON.stringify({ agent: navigator.userAgent, units: text.length, setItem, results }) });
status.textContent = "Done.";
