/**
 * S1 kill harness: renderer killed at 20 points, host killed at 20 points, and two-window scripts with kills of both, on a
 * real library file. Prints one JSON summary; exits 1 when a gate fails.
 *   bun tools/s1-kill.ts <scratch-dir> [payload.json|""] [renderer,host,two]
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { integrity, readDocs, spawn, startHost, terminate, type Child } from "./kit";

const [scratch, payload, only] = process.argv.slice(2);
const run = (name: string) => !only || only.split(",").includes(name);
if (!scratch) throw Error("Usage: bun tools/s1-kill.ts <scratch-dir> [payload.json]");

type Log = { key: string; seq: number; window: string; kind: "rec" | "ack" };
const parse = (window: string, lines: string[]) => {
  const logs: Log[] = []; let conflicts = 0; const replayed: Record<string, number> = {}; let unprotected = 0;
  for (const line of lines) {
    const [tag, key, seq, a, b] = line.split(" ");
    if (tag === "rec") { logs.push({ key, seq: Number(seq), window, kind: "rec" }); if (a === "0") unprotected++; }
    if (tag === "ack") { logs.push({ key, seq: Number(seq), window, kind: "ack" }); if (b !== "-") replayed[b] = (replayed[b] ?? 0) + 1; }
    if (tag === "conflict") conflicts++;
  }
  return { logs, conflicts, replayed, unprotected };
};
const outboxSeq = (path: string, window: string, key: string) => {
  if (!existsSync(path)) return -1;
  let best = -1;
  for (const entry of JSON.parse(readFileSync(path, "utf8")) as { writes: { kind: string; id: string; value?: { seqs?: Record<string, number> } }[] }[])
    for (const write of entry.writes) if (`${write.kind}/${write.id}` === key) best = Math.max(best, write.value?.seqs?.[window] ?? -1);
  return best;
};
/** Every logged mutation is in the library (its document or a fork of it) or in its window's outbox. */
function missing(library: string, logs: Log[], outboxes: Record<string, string>): Log[] {
  const docs = new Map<string, { revision: number; value: any }>([...readDocs(library, "look-working")].map(([id, doc]) => [`look-working/${id}`, doc]));
  for (const [id, doc] of readDocs(library, "collection-working")) docs.set(`collection-working/${id}`, doc);
  return logs.filter(log => {
    const holders = [...docs].filter(([key]) => key === log.key || key.startsWith(`${log.key}~`));
    if (holders.some(([, doc]) => (doc.value.seqs?.[log.window] ?? -1) >= log.seq)) return false;
    return outboxSeq(outboxes[log.window], log.window, log.key) < log.seq;
  });
}
const maxSeq = (logs: Log[]) => Math.max(0, ...logs.map(log => log.seq));

const results: Record<string, unknown> = {};
let failed = false;
const fresh = (name: string) => {
  const dir = join(scratch, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  openLibraryDatabase(join(dir, "library.sqlite")).close(); // A library with every step, as the hosts open it.
  return { dir, library: join(dir, "library.sqlite"), port: join(dir, "port"), commits: join(dir, "commits.jsonl") };
};
const window = (name: string, dir: string, port: string, seq: number, edits: number, kill?: string) =>
  spawn("harness/window-proc.ts", [name, join(dir, `outbox-${name}.json`), port, String(seq), String(edits), ...(payload ? [payload] : [])], kill);

// --- Renderer killed at 20 points ---------------------------------------------------------------------------------------
if (run("renderer")) {
  const { dir, library, port } = fresh("renderer");
  const host = await startHost(library, port);
  const points = ["after-record", "in-flight", "ack-received", "after-ack"].flatMap(point => [3, 8, 15, 23].map(n => `${point}:${n}`));
  const timed = [150, 300, 450, 600];
  const all: Log[] = []; let conflicts = 0, notReached = 0; const replayed: Record<string, number> = {}; const gaps: unknown[] = [];
  const outboxes = { W: join(dir, "outbox-W.json") };
  for (const spec of [...points, ...timed.map(ms => `timed:${ms}`)]) {
    const child = window("W", dir, port, maxSeq(all) + 1, 80, spec.startsWith("timed") ? undefined : spec);
    if (spec.startsWith("timed")) { await Bun.sleep(Number(spec.split(":")[1])); await terminate(child); }
    await child.exited;
    if (child.lines.includes("done")) notReached++;
    const parsed = parse("W", child.lines);
    all.push(...parsed.logs); conflicts += parsed.conflicts;
    for (const [k, v] of Object.entries(parsed.replayed)) replayed[k] = (replayed[k] ?? 0) + v;
    const lost = missing(library, all, outboxes);
    if (lost.length) gaps.push({ after: spec, lost: lost.slice(0, 5) });
  }
  const last = window("W", dir, port, maxSeq(all) + 1, 20);
  await last.wait(line => line === "done", 30_000);
  const parsed = parse("W", last.lines);
  all.push(...parsed.logs); conflicts += parsed.conflicts;
  for (const [k, v] of Object.entries(parsed.replayed)) replayed[k] = (replayed[k] ?? 0) + v;
  await terminate(host);
  const end = missing(library, all, { W: "" });
  const ok = gaps.length === 0 && end.length === 0 && conflicts === 0 && integrity(library) === "ok" && last.lines.includes("done");
  failed ||= !ok;
  results.renderer = { ok, kills: points.length + timed.length, notReached, mutationsLogged: all.length, gaps, missingAtEnd: end.length,
    falseConflicts: conflicts, replayedAcks: replayed, integrity: integrity(library) };
}

// --- Host killed at 20 points --------------------------------------------------------------------------------------------
if (run("host")) {
  const { dir, library, port } = fresh("host");
  const specs = ["before-commit", "after-commit"].flatMap(point => [2, 3, 5, 7, 11, 4, 6, 9, 13, 8].map(n => `${point}:${n}`));
  let host = await startHost(library, port, specs[0]);
  const w = window("W", dir, port, 1, 600);
  let kills = 0;
  for (let i = 0; i < specs.length; i++) {
    await host.exited;
    kills++;
    host = await startHost(library, port, specs[i + 1]);
  }
  const done = await w.wait(line => line === "done", 60_000);
  await terminate(host);
  const parsed = parse("W", w.lines);
  const end = missing(library, parsed.logs, { W: "" });
  const ok = !!done && end.length === 0 && parsed.conflicts === 0 && integrity(library) === "ok";
  failed ||= !ok;
  results.host = { ok, kills, mutationsLogged: parsed.logs.length, missingAtEnd: end.length, falseConflicts: parsed.conflicts,
    replayedAcks: parsed.replayed, integrity: integrity(library) };
}

// --- Two windows on one look, both renderers and the host killed -----------------------------------------------------------
if (run("two")) {
  const { dir, library, port, commits } = fresh("two-windows");
  let host = await startHost(library, port, undefined, commits);
  const logs: Log[] = []; let conflicts = 0, kills = 0;
  const windows: Record<string, Child> = {};
  const seqs: Record<string, number> = { A: 1, B: 100_000 };
  const launch = (name: string) => { windows[name] = window(name, dir, port, seqs[name], 120); };
  const harvest = (name: string) => {
    const parsed = parse(name, windows[name].lines);
    logs.push(...parsed.logs); conflicts += parsed.conflicts;
    seqs[name] = Math.max(seqs[name], maxSeq(parsed.logs)) + 1;
  };
  launch("A"); launch("B");
  const plan = ["A", "host", "B", "A", "host", "B", "host", "A", "B", "host", "A", "B", "host", "B", "A"];
  for (const target of plan) {
    await Bun.sleep(120 + (kills * 53) % 200);
    kills++;
    if (target === "host") { await terminate(host); host = await startHost(library, port, undefined, commits); }
    else { await terminate(windows[target]); harvest(target); launch(target); }
  }
  const settled = await Promise.all(["A", "B"].map(name => windows[name].wait(line => line === "done", 60_000)));
  harvest("A"); harvest("B");
  await terminate(host);
  // Silent overwrite: a committed revision of a document lowering any window's sequence number below an earlier revision's.
  const byKey = new Map<string, { revision: number; seqs: Record<string, number> }[]>();
  for (const line of readFileSync(commits, "utf8").split("\n").filter(Boolean)) {
    for (const write of (JSON.parse(line) as { writes: { key: string; revision: number; seqs: Record<string, number> }[] }).writes)
      byKey.set(write.key, [...byKey.get(write.key) ?? [], write]);
  }
  const overwrites: unknown[] = [];
  for (const [key, writes] of byKey) {
    writes.sort((a, b) => a.revision - b.revision);
    for (let i = 1; i < writes.length; i++) for (const [name, seq] of Object.entries(writes[i - 1].seqs ?? {}))
      if ((writes[i].seqs?.[name] ?? -1) < seq) overwrites.push({ key, revision: writes[i].revision, window: name, from: seq, to: writes[i].seqs?.[name] });
  }
  const end = missing(library, logs, { A: "", B: "" });
  const forks = [...readDocs(library, "look-working").keys()].filter(id => id.includes("~")).length;
  const ok = settled.every(Boolean) && overwrites.length === 0 && end.length === 0 && integrity(library) === "ok";
  failed ||= !ok;
  results.twoWindows = { ok, kills, mutationsLogged: logs.length, realConflicts: conflicts, forks, silentOverwrites: overwrites.slice(0, 5),
    missingAtEnd: end.slice(0, 5), commitsChecked: [...byKey.values()].reduce((n, list) => n + list.length, 0), integrity: integrity(library) };
}

console.log(JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
