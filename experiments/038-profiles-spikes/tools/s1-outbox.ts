/**
 * The S1 kill harness on the production outbox (phase 1 chunk 1c), on both hosts: the renderer killed at 20 points, the host killed at
 * 20 points, two windows with kills of both, and a forced outbox-write failure. A real library file each; prints one JSON summary and
 * exits 1 when a gate fails.
 *   bun tools/s1-outbox.ts <scratch-dir> [payload.json|""] [localhost,desktop] [renderer,host,two,failure]
 *
 * What stands in for what: the renderer is a Bun process running the page's real outbox, transport, storage adapter and (desktop) lease
 * adapter; the browser's or WebView's storage is a file it writes synchronously (it outlives the renderer, as the browser process's does).
 * A desktop host kill ends the app: the desktop page is killed with it and starts again as a new launch, reading its outbox from the
 * host's files. The localhost host is the real document store and routes; the desktop host is the real desktop server.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openLibraryDatabase } from "../../../projects/xf-studio/authoring/src/library/host/library-files";
import { integrity, readDocs, spawn, terminate, type Child } from "./kit";
import { readOutboxes } from "../harness/file-storage";

const [scratch, payload, hostsArg, onlyArg] = process.argv.slice(2);
if (!scratch) throw Error("Usage: bun tools/s1-outbox.ts <scratch-dir> [payload.json] [localhost,desktop] [renderer,host,two,failure]");
const hosts = (hostsArg || "localhost,desktop").split(",") as ("localhost" | "desktop")[];
const run = (name: string) => !onlyArg || onlyArg.split(",").includes(name);

type Log = { key: string; seq: number; window: string };
type Win = { name: string; mode: string; storage: string; launch?: string };
const parse = (lines: string[], window: string) => {
  const logs: Log[] = []; let conflicts = 0, unprotected = 0, warnings: string[] = []; const replayed: Record<string, number> = {};
  for (const line of lines) {
    const [tag, key, seq, a, b] = line.split(" ");
    if (tag === "rec") { logs.push({ key: key!, seq: Number(seq), window }); if (a === "0") unprotected++; }
    if (tag === "ack" && b !== "-") replayed[b!] = (replayed[b!] ?? 0) + 1;
    if (tag === "conflict") conflicts++;
    if (tag === "warning") warnings.push(key!);
  }
  return { logs, conflicts, replayed, unprotected, warnings };
};
const maxSeq = (logs: Log[]) => Math.max(0, ...logs.map(log => log.seq));

type Setup = { dir: string; library: string; port: string; commits: string; outboxFolder?: string };
function fresh(mode: "localhost" | "desktop", name: string): Setup {
  const dir = join(scratch, mode, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  if (mode === "localhost") { openLibraryDatabase(join(dir, "library.sqlite")).close(); return { dir, library: join(dir, "library.sqlite"), port: join(dir, "port"), commits: join(dir, "commits.jsonl") }; }
  return { dir, library: join(dir, "data", "library.sqlite"), port: join(dir, "port"), commits: join(dir, "commits.jsonl"), outboxFolder: join(dir, "data", "outbox") };
}
async function startHost(mode: "localhost" | "desktop", setup: Setup, kill?: string): Promise<Child> {
  const host = spawn("harness/s1-host.ts", [mode, mode === "localhost" ? setup.library : setup.dir, setup.commits], kill);
  const line = await host.wait(text => text.startsWith("port "), 30_000);
  if (!line) throw Error("The host didn't start.");
  await Bun.write(setup.port, line.slice(5));
  return host;
}
function startWindow(setup: Setup, win: Win, seq: number, edits: number, env: { kill?: string } = {}): Child {
  const child = spawn("harness/s1-window.ts", [win.name, win.mode, win.storage, setup.port, String(seq), String(edits), ...(payload ? [payload] : [])], env.kill);
  // The window names its launch (desktop): only that launch's storage is read back by the page.
  void child.wait(line => line.startsWith("launch "), 30_000).then(line => { if (line) win.launch = line.slice(7); });
  return child;
}
/** Every logged mutation is in the library (its document or a fork of it) or in its window's outbox, as the page would read it back. */
function missing(setup: Setup, logs: Log[], windows: Win[]): Log[] {
  const docs = new Map<string, { revision: number; value: any }>();
  for (const kind of ["look-working", "collection-working"]) for (const [id, doc] of readDocs(setup.library, kind)) docs.set(`${kind}/${id}`, doc);
  const outboxes = new Map(windows.map(win => [win.name, readOutboxes(win.storage,
    win.mode === "desktop" ? `xfs.outbox.desktop~${win.launch ?? "?"}.` : `xfs.outbox.browser-${win.name}.`, win.mode === "desktop" ? setup.outboxFolder : undefined)]));
  return logs.filter(log => {
    const holders = [...docs].filter(([key]) => key === log.key || key.startsWith(`${log.key}~`));
    if (holders.some(([, doc]) => (doc.value?.seqs?.[log.window] ?? -1) >= log.seq)) return false;
    return !(outboxes.get(log.window) ?? []).some(write => `${write.kind}/${write.id}` === log.key && (write.seqs?.[log.window] ?? -1) >= log.seq);
  });
}
function overwrites(commits: string) {
  const byKey = new Map<string, { revision: number; seqs: Record<string, number> }[]>();
  if (existsSync(commits)) for (const line of readFileSync(commits, "utf8").split("\n").filter(Boolean))
    for (const write of (JSON.parse(line) as { writes: { key: string; revision: number; seqs: Record<string, number> }[] }).writes)
      byKey.set(write.key, [...byKey.get(write.key) ?? [], write]);
  const found: unknown[] = [];
  for (const [key, writes] of byKey) {
    writes.sort((a, b) => a.revision - b.revision);
    for (let i = 1; i < writes.length; i++) for (const [name, seq] of Object.entries(writes[i - 1]!.seqs ?? {}))
      if ((writes[i]!.seqs?.[name] ?? -1) < seq) found.push({ key, revision: writes[i]!.revision, window: name, from: seq, to: writes[i]!.seqs?.[name] });
  }
  return { found, checked: [...byKey.values()].reduce((n, list) => n + list.length, 0) };
}

const results: Record<string, unknown> = {};
let failed = false;
const started = performance.now();
for (const mode of hosts) {
  const main = (setup: Setup, name: string): Win => ({ name, mode: mode === "desktop" ? "desktop" : "localhost", storage: join(setup.dir, `storage-${name}.json`) });

  // --- Renderer killed at 20 points ---------------------------------------------------------------------------------------
  if (run("renderer")) {
    const setup = fresh(mode, "renderer"), host = await startHost(mode, setup), win = main(setup, "W");
    const points = ["after-record", "in-flight", "ack-received", "after-ack"].flatMap(point => [3, 8, 15, 23].map(n => `${point}:${n}`));
    const timed = [150, 300, 450, 600];
    const all: Log[] = []; let conflicts = 0, notReached = 0; const replayed: Record<string, number> = {}; const gaps: unknown[] = [];
    for (const spec of [...points, ...timed.map(ms => `timed:${ms}`)]) {
      const child = startWindow(setup, win, maxSeq(all) + 1, 80, { kill: spec.startsWith("timed") ? undefined : spec });
      if (spec.startsWith("timed")) { await child.wait(line => line.startsWith("rec "), 30_000); await Bun.sleep(Number(spec.split(":")[1])); await terminate(child); }
      await child.exited;
      if (child.lines.includes("done")) notReached++;
      const parsed = parse(child.lines, "W");
      all.push(...parsed.logs); conflicts += parsed.conflicts;
      for (const [k, v] of Object.entries(parsed.replayed)) replayed[k] = (replayed[k] ?? 0) + v;
      const lost = missing(setup, all, [win]);
      if (lost.length) gaps.push({ after: spec, lost: lost.slice(0, 5) });
    }
    const last = startWindow(setup, win, maxSeq(all) + 1, 20);
    await last.wait(line => line === "done", 60_000);
    const parsed = parse(last.lines, "W");
    all.push(...parsed.logs); conflicts += parsed.conflicts;
    for (const [k, v] of Object.entries(parsed.replayed)) replayed[k] = (replayed[k] ?? 0) + v;
    await terminate(host);
    const end = missing(setup, all, []);
    const ok = gaps.length === 0 && end.length === 0 && conflicts === 0 && integrity(setup.library) === "ok" && last.lines.includes("done");
    failed ||= !ok;
    results[`${mode}.renderer`] = { ok, kills: points.length + timed.length, notReached, mutationsLogged: all.length, gaps, missingAtEnd: end.length,
      falseConflicts: conflicts, replayedAcks: replayed, integrity: integrity(setup.library) };
  }

  // --- Host killed at 20 points ----------------------------------------------------------------------------------------------
  if (run("host")) {
    const setup = fresh(mode, "host"), win = main(setup, "W");
    // Localhost: inside the transaction and after the commit. Desktop: after the commit, and at timed moments (the desktop server takes
    // no in-transaction hook); a desktop host kill ends the app, so the page dies with it and starts again as a new launch.
    const specs = mode === "localhost"
      ? ["before-commit", "after-commit"].flatMap(point => [2, 3, 5, 7, 11, 4, 6, 9, 13, 8].map(n => `${point}:${n}`))
      : [...[2, 3, 5, 7, 11, 4, 6, 9, 13, 8].map(n => `after-commit:${n}`), ...[90, 140, 60, 200, 110, 170, 80, 130, 150, 100].map(ms => `timed:${ms}`)];
    const logs: Log[] = []; let conflicts = 0; const replayed: Record<string, number> = {}; let kills = 0;
    const harvest = (child: Child) => { const parsed = parse(child.lines, "W"); logs.push(...parsed.logs); conflicts += parsed.conflicts;
      for (const [k, v] of Object.entries(parsed.replayed)) replayed[k] = (replayed[k] ?? 0) + v; };
    let host = await startHost(mode, setup, specs[0]!.startsWith("timed") ? undefined : specs[0]);
    let w = startWindow(setup, win, 1, 600);
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      if (spec.startsWith("timed")) { await Bun.sleep(Number(spec.split(":")[1])); await terminate(host); }
      else await Promise.race([host.exited, Bun.sleep(20_000)]);
      if (host.proc.exitCode === null) await terminate(host);
      kills++;
      if (mode === "desktop") { await terminate(w); harvest(w); }
      const next = specs[i + 1];
      host = await startHost(mode, setup, next && !next.startsWith("timed") ? next : undefined);
      if (mode === "desktop") w = startWindow(setup, win, maxSeq(logs) + 1, Math.max(40, 600 - logs.length));
    }
    const done = await w.wait(line => line === "done", 90_000);
    harvest(w);
    await terminate(host);
    const end = missing(setup, logs, []);
    const ok = !!done && end.length === 0 && conflicts === 0 && integrity(setup.library) === "ok";
    failed ||= !ok;
    results[`${mode}.host`] = { ok, kills, mutationsLogged: logs.length, missingAtEnd: end.length, missing: end.slice(0, 5), falseConflicts: conflicts,
      replayedAcks: replayed, integrity: integrity(setup.library) };
  }

  // --- Two windows on one look, both renderers and the host killed -------------------------------------------------------------
  if (run("two")) {
    const setup = fresh(mode, "two-windows");
    let host = await startHost(mode, setup);
    const wins: Record<string, Win> = { A: main(setup, "A"), B: { ...main(setup, "B"), mode: mode === "desktop" ? "desktop-other" : "localhost" } };
    const logs: Log[] = []; let conflicts = 0, kills = 0;
    const children: Record<string, Child> = {};
    const seqs: Record<string, number> = { A: 1, B: 100_000 };
    const launch = (name: string) => { children[name] = startWindow(setup, wins[name]!, seqs[name]!, 120); };
    const harvest = (name: string) => {
      const parsed = parse(children[name]!.lines, name);
      logs.push(...parsed.logs); conflicts += parsed.conflicts;
      seqs[name] = Math.max(seqs[name]!, maxSeq(parsed.logs)) + 1;
    };
    launch("A"); launch("B");
    const plan = ["A", "host", "B", "A", "host", "B", "host", "A", "B", "host", "A", "B", "host", "B", "A"];
    for (const target of plan) {
      await Bun.sleep(120 + (kills * 53) % 200);
      kills++;
      if (target === "host") {
        await terminate(host);
        // A desktop host kill ends the app: its page goes with it.
        if (mode === "desktop") { await terminate(children.A!); harvest("A"); }
        host = await startHost(mode, setup);
        if (mode === "desktop") launch("A");
      } else { await terminate(children[target]!); harvest(target); launch(target); }
    }
    const settled = await Promise.all(["A", "B"].map(name => children[name]!.wait(line => line === "done", 90_000)));
    harvest("A"); harvest("B");
    await terminate(host);
    const silent = overwrites(setup.commits);
    const end = missing(setup, logs, []);
    const forks = [...readDocs(setup.library, "look-working").keys()].filter(id => id.includes("~")).length;
    const ok = settled.every(Boolean) && silent.found.length === 0 && end.length === 0 && integrity(setup.library) === "ok";
    failed ||= !ok;
    results[`${mode}.twoWindows`] = { ok, kills, mutationsLogged: logs.length, realConflicts: conflicts, forks, silentOverwrites: silent.found.slice(0, 5),
      missingAtEnd: end.slice(0, 5), commitsChecked: silent.checked, integrity: integrity(setup.library) };
  }

  // --- Forced outbox-write failure ------------------------------------------------------------------------------------------
  if (run("failure")) {
    const setup = fresh(mode, "failure"), host = await startHost(mode, setup), win = main(setup, "W");
    // Storage refuses every write from edit 5 to edit 25: the warning shows, edits still apply and are sent, and it clears afterwards.
    const child = spawn("harness/s1-window.ts", [win.name, win.mode, win.storage, setup.port, "1", "40", ...(payload ? [payload] : [])], undefined,
      { XFS_FAIL_OUTBOX: "5:25" });
    const done = await child.wait(line => line === "done", 60_000);
    await terminate(host);
    const parsed = parse(child.lines, "W");
    const end = missing(setup, parsed.logs, []);
    const ok = !!done && parsed.unprotected > 0 && parsed.warnings[0] === "1" && parsed.warnings.at(-1) === "0" && end.length === 0 && parsed.conflicts === 0;
    failed ||= !ok;
    results[`${mode}.failure`] = { ok, unprotectedRecords: parsed.unprotected, warnings: parsed.warnings, mutationsLogged: parsed.logs.length,
      missingAtEnd: end.length, conflicts: parsed.conflicts };
  }
}
results.seconds = Math.round((performance.now() - started) / 100) / 10;
console.log(JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
