import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MountedArchive } from "../src/archive-precedence";
import { WolvenKitFetcher } from "../src/resolver-host";
import { WolvenKitRunError } from "../src/wolvenkit-cli";

/**
 * PREV-29: the grading-LUT host and the character-detail host each open the installation, so two
 * `WolvenKitFetcher`s share one resolver cache folder in one process. Before the fix both named their
 * first batch folder `tmp/batch-<pid>-1`: one overwrote the other's hash list, deleted its output, and
 * could leave a lasting `.failed` marker for a resource that converts fine.
 *
 * A fake WolvenKit stands in for the process (the fetcher's `run` step), with the same delays a real
 * extraction has between reading its hash list, writing outputs and converting them.
 */
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-fetcher-")); roots.push(root); return root; };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type FakeOptions = { noJson?: Set<string>; convertExit?: number; fail?: (args: string[]) => WolvenKitRunError | null; cli?: string };
function fakeWolvenKit(calls: string[][], options: FakeOptions = {}) {
  return async (args: string[]) => {
    calls.push(args);
    const failure = options.fail?.(args);
    if (failure) { await sleep(10); throw failure; }
    await sleep(30);
    try {
      if (args[0] === "unbundle") {
        const out = args[args.indexOf("-o") + 1]!, list = args[args.indexOf("--hash") + 1]!;
        const hashes = readFileSync(list, "utf8").split(/\r?\n/).filter(Boolean);
        await sleep(30);
        mkdirSync(out, { recursive: true });
        for (const hash of hashes) writeFileSync(join(out, `${hash}.app`), `resource ${hash}`);
      } else if (args[0] === "convert") {
        const folder = args[2]!, files = readdirSync(folder).filter(name => !name.endsWith(".json"));
        await sleep(30);
        for (const name of files) if (!options.noJson?.has(name.replace(/\..*$/, "")))
          writeFileSync(join(folder, `${name}.json`), JSON.stringify({ Data: { RootChunk: { name } } }));
      }
    } catch { /* a real tool reports a vanished folder in its log; it does not throw into the host */ }
    const exitCode = args[0] === "convert" ? options.convertExit ?? 0 : 0;
    return { exitCode, stdout: "", stderr: "", output: "" };
  };
}

function archive(root: string, name: string): MountedArchive {
  const id = join(root, name);
  writeFileSync(id, `archive ${name}`);
  return { id, name, virtualPath: `archive/pc/content/${name}`, group: "content", provider: "game", providerName: "Installed game", rank: 0, shadowed: [] } as MountedArchive;
}
const ref = (hash: string) => ({ hash, path: null });

function setup(options: FakeOptions = {}, root = temporary()) {
  const cache = join(root, "cache");
  const a = archive(root, "a.archive"), b = archive(root, "b.archive");
  const owned: Record<string, string[]> = { [a.id]: ["1001", "1002"], [b.id]: ["2001", "2002"] };
  const contains = (id: string, hash: string) => owned[id]?.includes(hash) ?? false;
  const calls: string[][] = [];
  const fetcher = () => {
    const created = new WolvenKitFetcher(options.cli ?? "WolvenKit.CLI.exe", cache, contains);
    (created as unknown as { run: unknown }).run = fakeWolvenKit(calls, options);
    return created;
  };
  const markers = () => existsSync(join(cache, "json")) ? readdirSync(join(cache, "json")).filter(name => name.endsWith(".failed")) : [];
  return { cache, a, b, calls, fetcher, markers };
}

test("two fetchers on one cache folder never share a batch folder or poison each other's resources (PREV-29)", async () => {
  const { cache, a, b, fetcher, markers } = setup();
  const lut = fetcher(), details = fetcher();
  const results = await Promise.all([lut.fetch(a, ref("1001"), "app"), lut.fetch(a, ref("1002"), "app"),
    details.fetch(b, ref("2001"), "app"), details.fetch(b, ref("2002"), "app")]);
  expect(results.map(result => (result?.document as { Data: { RootChunk: { name: string } } } | undefined)?.Data.RootChunk.name))
    .toEqual(["1001.app", "1002.app", "2001.app", "2002.app"]);
  expect(markers()).toEqual([]);
  expect([...lut.stats.failures, ...details.stats.failures]).toEqual([]);
  expect(readdirSync(join(cache, "tmp"))).toEqual([]);
});

test("a resource two fetchers ask for at once is extracted once (single-flight per cache folder)", async () => {
  const { a, calls, fetcher } = setup();
  const [one, two] = await Promise.all([fetcher().fetch(a, ref("1001"), "app"), fetcher().fetch(a, ref("1001"), "app")]);
  expect(one).not.toBeNull();
  expect(two).toEqual(one);
  expect(calls.filter(args => args[0] === "unbundle")).toHaveLength(1);
});

test("a .failed marker is written only when WolvenKit finished cleanly and produced no JSON", async () => {
  const clean = setup({ noJson: new Set(["1002"]) });
  const fetcher = clean.fetcher();
  expect(await fetcher.fetch(clean.a, ref("1002"), "app")).toBeNull();
  expect(clean.markers()).toHaveLength(1);
  // The marker holds until the archive changes: no second WolvenKit run.
  const runs = clean.calls.length;
  expect(await clean.fetcher().fetch(clean.a, ref("1002"), "app")).toBeNull();
  expect(clean.calls.length).toBe(runs);

  // A converter that exits non-zero, times out or is missing leaves no marker, and the next request retries.
  const crashed = setup({ noJson: new Set(["1002"]), convertExit: 1 });
  expect(await crashed.fetcher().fetch(crashed.a, ref("1002"), "app")).toBeNull();
  expect(crashed.markers()).toEqual([]);
  const timedOut = setup({ fail: args => args[0] === "convert" ? new WolvenKitRunError("tool_timeout", "WolvenKit.CLI.exe convert s exceeded its time limit.") : null });
  const first = timedOut.fetcher();
  expect(await first.fetch(timedOut.a, ref("1001"), "app")).toBeNull();
  expect(timedOut.markers()).toEqual([]);
  expect(first.stats.failures.join("\n")).toContain("time limit");
  const before = timedOut.calls.length;
  await timedOut.fetcher().fetch(timedOut.a, ref("1001"), "app");
  expect(timedOut.calls.length).toBeGreaterThan(before);
  expect(readdirSync(join(timedOut.cache, "tmp"))).toEqual([]);
});

test("a .failed marker from before the marker rule (PREV-29) is ignored, removed and the resource retried", async () => {
  const { cache, a, fetcher, markers, calls } = setup();
  const probe = fetcher();
  // Find the cache file name for 1001 by extracting 1002 (same archive) and reading its name pattern.
  await probe.fetch(a, ref("1002"), "app");
  const cached = readdirSync(join(cache, "json")).find(name => name.startsWith("1002-"))!;
  const marker = join(cache, "json", `${cached.replace(/^1002-/, "1001-")}.failed`);
  writeFileSync(marker, JSON.stringify({ hash: "1001", path: null, archive: "a.archive", reason: "WolvenKit extracted the resource but produced no readable JSON.", at: "2026-09-25T08:25:34.755Z" }));
  const runs = calls.length;
  const result = await fetcher().fetch(a, ref("1001"), "app");
  expect(result).not.toBeNull();
  expect(calls.length).toBeGreaterThan(runs);
  expect(markers()).toEqual([]);
});

test("a .failed marker counts only for the WolvenKit that wrote it; the JSON cache is keyed by WolvenKit too (PREV-46, PIPE-04)", async () => {
  const root = temporary(), cli = join(root, "WolvenKit.CLI.exe");
  writeFileSync(cli, "WolvenKit 9.0.1");
  const options: FakeOptions = { noJson: new Set(["1002"]), cli };
  const first = setup(options, root);
  expect(await first.fetcher().fetch(first.a, ref("1002"), "app")).toBeNull();
  expect(await first.fetcher().fetch(first.a, ref("1001"), "app")).not.toBeNull();
  expect(first.markers()).toHaveLength(1);
  const marker = JSON.parse(readFileSync(join(first.cache, "json", first.markers()[0]!), "utf8"));
  expect(marker).toMatchObject({ markerVersion: 3, wolvenKit: first.fetcher().tool });
  // Same WolvenKit: the marker and the cached JSON hold, so nothing runs.
  const runs = first.calls.length;
  expect(await first.fetcher().fetch(first.a, ref("1002"), "app")).toBeNull();
  expect(await first.fetcher().fetch(first.a, ref("1001"), "app")).not.toBeNull();
  expect(first.calls.length).toBe(runs);
  // An upgraded WolvenKit that converts the resource: both are extracted again, and the resource is found.
  writeFileSync(cli, "WolvenKit 9.1.0");
  options.noJson!.clear();
  const upgraded = first.fetcher();
  expect(upgraded.tool).not.toBe(marker.wolvenKit);
  expect(await upgraded.fetch(first.a, ref("1002"), "app")).not.toBeNull();
  expect(await upgraded.fetch(first.a, ref("1001"), "app")).not.toBeNull();
  expect(first.calls.filter(args => args[0] === "unbundle").length).toBe(4);
});

test("a marker written by another WolvenKit identity at the current key is ignored and removed (PREV-46)", async () => {
  const { cache, a, fetcher, markers } = setup();
  const probe = fetcher();
  await probe.fetch(a, ref("1002"), "app");
  const cached = readdirSync(join(cache, "json")).find(name => name.startsWith("1002-"))!;
  writeFileSync(join(cache, "json", `${cached.replace(/^1002-/, "1001-")}.failed`), JSON.stringify({ markerVersion: 3, wolvenKit: "wolvenkit:8.17.4:0123456789abcdef",
    hash: "1001", path: null, archive: "a.archive", reason: "WolvenKit extracted the resource but produced no readable JSON.", at: "2026-09-25T08:25:34.755Z" }));
  expect(await fetcher().fetch(a, ref("1001"), "app")).not.toBeNull();
  expect(markers()).toEqual([]);
});

test("an extracted resource still answers when its cache file cannot be written (PREV-49)", async () => {
  const { cache, a, b, fetcher } = setup();
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "json"), "a file where the cache folder should be");
  const created = fetcher();
  const results = await Promise.all([created.fetch(a, ref("1001"), "app"), created.fetch(b, ref("2001"), "app")]);
  expect(results.every(result => result !== null)).toBe(true);
  expect(created.stats.failures.join(" | ")).toContain("not cached");
});
