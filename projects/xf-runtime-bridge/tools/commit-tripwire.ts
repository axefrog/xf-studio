// The commit tripwire (bridge 0.8.10). Session 16's rule "skip a heavy row if the game's private bytes climb" is replaced by the
// maintainer's: use the memory freely; near the limit, stop the heavy row automatically. This watches the machine's free commit
// (the commit limit less the committed bytes, which is what the game's allocations run into) while a heavy row runs, and when it
// drops below the floor (4 GB by default, the board's guard) it runs the row's own off switch once and exits 3.
//
//   bun tools/commit-tripwire.ts [--floor-gb 4] [--for-s 120] [--interval-s 5] [--on-trip "<command> <json input>"]
//
// Run it beside the row, for example the stim tap in session 17's S17 group:
//   bun tools/commit-tripwire.ts --for-s 90 --on-trip "test.events {\"stims\":false}"
// --on-trip is any catalogue command (as bridge-client.ts run takes it). Each reading is one line; exit 0 when the time ran out
// above the floor, 3 when it tripped, 2 when the machine's counters could not be read.
// 0.8.22 (Borg 4: a bare handed_over sent the coordinator looking for another client): when the off switch is session.handover,
// the tripwire gives it the reason as its note (unless the command names one), so every refusal the handover causes and its
// session event say "handed over by the commit tripwire (free commit 3.4 GB under 4 GB)".

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const GIB = 1024 ** 3;

export type CommitReading = { limit: number; committed: number };

/** Bytes of commit still free. */
export const freeCommitBytes = (reading: CommitReading) => reading.limit - reading.committed;

/** Whether the free commit is below the floor. */
export const tripped = (reading: CommitReading, floorGb: number) => freeCommitBytes(reading) < floorGb * GIB;

/** Parses the counters' line ("<commit limit> <committed bytes>"); null when it is not two positive numbers. */
export function parseReading(text: string): CommitReading | null {
  const [limit, committed] = text.trim().split(/\s+/).map(Number);
  return Number.isFinite(limit) && Number.isFinite(committed) && limit! > 0 && committed! >= 0 ? { limit: limit!, committed: committed! } : null;
}

/** Why the tripwire tripped, in the words the handover carries. */
export const tripReason = (freeGb: number, floorGb: number) =>
  `handed over by the commit tripwire (free commit ${freeGb.toFixed(1)} GB under ${floorGb} GB)`;

/**
 * The off switch's command and its JSON input, as bridge-client.ts run takes them. session.handover gets the trip's reason as
 * its note unless the input already has one; any other command is passed as written.
 */
export function offSwitch(onTrip: string, freeGb: number, floorGb: number): { command: string; input?: string } {
  const [command, ...rest] = onTrip.trim().split(" ");
  const text = rest.join(" ").trim();
  if (command !== "session.handover") return { command: command!, ...(text ? { input: text } : {}) };
  let input: Record<string, unknown> = {};
  if (text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("session.handover's input must be a JSON object");
    input = parsed;
  }
  if (typeof input.note !== "string" || !input.note) input = { ...input, note: tripReason(freeGb, floorGb) };
  return { command, input: JSON.stringify(input) };
}

/** The machine's commit now (Windows performance counters through PowerShell, hidden). */
export function readCommit(): CommitReading | null {
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", '$m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory; "$($m.CommitLimit) $($m.CommittedBytes)"'], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  return out.status === 0 ? parseReading(out.stdout ?? "") : null;
}

async function main(argv: string[]) {
  const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const floorGb = Number(option("--floor-gb") ?? 4);
  const forS = Number(option("--for-s") ?? 120);
  const intervalS = Number(option("--interval-s") ?? 5);
  const onTrip = option("--on-trip");
  if (!(floorGb > 0) || !(forS > 0) || !(intervalS >= 1)) {
    console.error("usage: bun tools/commit-tripwire.ts [--floor-gb 4] [--for-s 120] [--interval-s 5] [--on-trip \"<command> <json input>\"]");
    return 2;
  }
  const until = Date.now() + forS * 1000;
  let lowest = Infinity;
  while (Date.now() < until) {
    const reading = readCommit();
    if (!reading) {
      console.error("the machine's commit counters could not be read; the row runs without a tripwire");
      return 2;
    }
    const free = freeCommitBytes(reading) / GIB;
    lowest = Math.min(lowest, free);
    console.log(`${new Date().toISOString().slice(11, 19)} free commit ${free.toFixed(1)} GB (floor ${floorGb})`);
    if (tripped(reading, floorGb)) {
      console.log(`TRIPPED: free commit ${free.toFixed(1)} GB is under ${floorGb} GB`);
      if (onTrip) {
        const { command, input } = offSwitch(onTrip, free, floorGb);
        const run = spawnSync("bun", [join(import.meta.dir, "bridge-client.ts"), "run", command, ...(input ? [input] : [])], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
        console.log(`off switch ${command}${input ? " " + input : ""}: exit ${run.status}`);
      }
      return 3;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalS * 1000));
  }
  console.log(`done: free commit stayed above ${floorGb} GB (lowest ${lowest.toFixed(1)} GB)`);
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
