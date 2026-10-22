// The prepared files' one owner (prepared-files.ts): one budget across partitions, what it never evicts, one check at a time, and Clear
// running alone once committed work finished (CORE-108). Synthetic files only.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filesSource, keptSource, markUsed, PreparedFiles } from "../src/host/prepared-files";
import { hostClock } from "../src/platform/core/clock";
import { createJobScheduler } from "../src/platform/core/jobs";
import { tempDir } from "./temp-dir";

const root = tempDir("xfs-prepared-files-");
afterAll(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const folder = () => { const path = join(root, `f${++serial}`); mkdirSync(path, { recursive: true }); return path; };
const file = (dir: string, name: string, bytes: number, ageMs: number) => {
  const path = join(dir, name);
  writeFileSync(path, "x".repeat(bytes));
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
  return path;
};
const jobs = () => createJobScheduler({ clock: hostClock(), quietMs: 0 });

test("one budget across partitions: the least recently used go first, whichever partition holds them; never one this process used", async () => {
  const a = folder(), b = folder();
  file(a, "old.json", 400, 400_000); file(b, "older.json", 400, 500_000); file(a, "new.json", 400, 1_000);
  const pinned = file(b, "oldest.json", 400, 900_000);
  markUsed(pinned);
  utimesSync(pinned, new Date(Date.now() - 900_000), new Date(Date.now() - 900_000));
  const files = new PreparedFiles({ budget: 900, scheduler: jobs() });
  files.partition({ name: "a", evictable: [filesSource(a, ".json")] });
  files.partition({ name: "b", evictable: [filesSource(b, ".json")] });
  expect(await files.evict()).toEqual({ removed: 2, freed: 800, bytes: 800 });
  expect(readdirSync(a)).toEqual(["new.json"]);
  expect(readdirSync(b)).toEqual(["oldest.json"]);
  expect((await files.size()).partitions).toEqual({ a: 400, b: 400 });
});

test("the budget is checked as work ahead, one check at a time, at most once a minute", async () => {
  const a = folder();
  file(a, "x.json", 10, 0);
  let counted = 0;
  const source = { ...filesSource(a, ".json"), bytes: async () => { counted++; await new Promise(resolve => setTimeout(resolve, 20)); return 10; } };
  const files = new PreparedFiles({ budget: 100, scheduler: jobs() });
  files.partition({ name: "a", evictable: [source] });
  await Promise.all([files.keepWithinBudget(), files.keepWithinBudget(), files.keepWithinBudget()]);
  await files.keepWithinBudget();
  expect(counted).toBe(1);
});

test("Clear stops every partition's work, waits for committed work, removes everything, then forgets; an owner that clears its own files does", async () => {
  const a = folder(), kept = folder();
  file(a, "x.json", 100, 0); file(a, "y.json.failed", 5, 0); file(kept, "record.json", 50, 0);
  const scheduler = jobs(), log: string[] = [];
  const files = new PreparedFiles({ scheduler });
  files.partition({ name: "a", evictable: [filesSource(a, ".json", name => name.endsWith(".failed"))], kept: [keptSource(kept)],
    stop: () => log.push("stop"), forget: () => log.push("forget") });
  files.partition({ name: "own", own: { bytes: async () => 7, clear: async () => { log.push("own clear"); return { freed: 7 }; } } });
  let finish!: () => void;
  scheduler.want("preview-source:k", { key: "derive", lane: "shown", run: async context => {
    context.commit();
    log.push("derive");
    await new Promise<void>(resolve => { finish = resolve; });
    log.push("derive end");
  } });
  for (let i = 0; i < 50 && !log.includes("derive"); i++) await new Promise(resolve => setTimeout(resolve, 2));
  const clearing = files.clear();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(log).toEqual(["derive", "stop"]);
  finish();
  expect(await clearing).toEqual({ freed: 157 });
  expect(log).toEqual(["derive", "stop", "derive end", "own clear", "forget"]);
  // Lasting failure markers are tiny and kept.
  expect(readdirSync(a)).toEqual(["y.json.failed"]);
  expect(existsSync(join(kept, "record.json"))).toBe(false);
});

test("a budget check stopped by a person's change after its scan began still counts as this minute's check (review 6)", async () => {
  const a = folder();
  file(a, "x.json", 10, 0);
  let scans = 0, finishScan!: () => void;
  const scanning = new Promise<void>(resolve => { finishScan = resolve; });
  const source = { ...filesSource(a, ".json"), bytes: async () => { scans++; await scanning; return 10; } };
  const scheduler = jobs();
  const files = new PreparedFiles({ budget: 100, scheduler });
  files.partition({ name: "a", evictable: [source] });
  const first = files.keepWithinBudget();
  for (let i = 0; i < 50 && !scans; i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(scans).toBe(1);
  // A person's change stops the job; the scan goes on as its tail.
  scheduler.want("page/character", { key: "v", lane: "person", run: async () => {} });
  await first;
  await files.keepWithinBudget();
  finishScan();
  await scheduler.idle();
  expect(scans).toBe(1);
});
