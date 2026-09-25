import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { refFromPath } from "../src/depot-path";
import { COMMAND_LINE_LIMIT, commandLineArgumentLength, MAX_PATTERN_CHARS, NOT_WRITTEN_RUNS, uncookPatterns, withoutArchiveFileName,
  WolvenKitFetcher } from "../src/resolver-host";
import { cr2w } from "./resolver-fixtures";

/**
 * The resolver's WolvenKit fetcher (prepare speed review, `88b5379`): a resource WolvenKit writes nothing for becomes lasting after
 * `NOT_WRITTEN_RUNS` clean batches (PIPE-54), both extraction routes store the same JSON (PIPE-60), and a launch's command line
 * stays within Windows' limit (PIPE-61).
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-fetch-")); roots.push(root); return root; };
const put = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
type Archive = Parameters<WolvenKitFetcher["fetch"]>[0];
function archiveAt(root: string, name = "mod.archive"): Archive {
  const physical = join(root, name);
  put(physical, "archive");
  return { id: physical, name, virtualPath: `archive/pc/mod/${name}`, group: "mod", provider: "game", providerName: "Installed game", rank: 0, shadowed: [] } as never;
}
/** A fetcher over a fake WolvenKit: `run(args)` decides what each launch writes and how it exits. */
function fetcher(cache: string, run: (args: string[]) => { exitCode?: number; output?: string }, cli = "WolvenKit.CLI.exe") {
  const made = new WolvenKitFetcher(cli, cache, () => true);
  const launches: string[][] = [];
  (made as unknown as { run: unknown }).run = async (args: string[]) => {
    launches.push(args);
    const result = run(args);
    return { exitCode: result.exitCode ?? 0, stdout: "", stderr: "", output: result.output ?? "" };
  };
  return { fetcher: made, launches };
}

describe("a resource WolvenKit writes nothing for (PIPE-54)", () => {
  test("is transient after one clean batch, lasting after the second, and never launched for again", async () => {
    const root = temporary(), archive = archiveAt(root), cache = join(root, "cache");
    const ghost = refFromPath("mod\\ghost.mesh");
    for (let i = 0; i < 4; i++) {
      // Each graph (a fresh fetcher, as after a graph is replaced) asks again.
      const { fetcher: made, launches } = fetcher(cache, () => ({}));
      expect(await made.fetch(archive, ghost, "mesh")).toBeNull();
      if (i < NOT_WRITTEN_RUNS) {
        expect(launches.map(args => args[0])).toEqual(["uncook", "unbundle"]);
        expect(made.transient(archive, ghost)).toBe(i + 1 < NOT_WRITTEN_RUNS);
        expect(made.stats.transient).toBe(i + 1 < NOT_WRITTEN_RUNS ? 1 : 0);
      } else {
        expect(launches).toEqual([]);
        expect(made.transient(archive, ghost)).toBe(false);
      }
    }
    const marker = JSON.parse(readFileSync(readdirSync(join(cache, "json")).map(name => join(cache, "json", name)).find(path => path.endsWith(".failed"))!, "utf8"));
    expect(marker).toMatchObject({ kind: "not-written", runs: NOT_WRITTEN_RUNS });
  });

  test("a launch that did not finish cleanly doesn't count; another WolvenKit tries again", async () => {
    const root = temporary(), archive = archiveAt(root), cache = join(root, "cache");
    const ghost = refFromPath("mod\\ghost.mesh");
    for (let i = 0; i < 3; i++) {
      const { fetcher: made } = fetcher(cache, args => args[0] === "unbundle" ? { exitCode: 1 } : {});
      expect(await made.fetch(archive, ghost, "mesh")).toBeNull();
      expect(made.transient(archive, ghost)).toBe(true);
    }
    for (let i = 0; i < NOT_WRITTEN_RUNS; i++) await fetcher(cache, () => ({})).fetcher.fetch(archive, ghost, "mesh");
    expect(await fetcher(cache, () => { throw Error("not launched"); }).fetcher.fetch(archive, ghost, "mesh")).toBeNull();
    // Another WolvenKit build: its own cache key, so it extracts again.
    const other = join(root, "other", "WolvenKit.CLI.exe");
    put(other, "another build");
    const { fetcher: newer, launches } = fetcher(cache, () => ({}), other);
    await newer.fetch(archive, ghost, "mesh");
    expect(launches.length).toBeGreaterThan(0);
  });

  test("once written after a miss, the resource is served and its marker removed", async () => {
    const root = temporary(), archive = archiveAt(root), cache = join(root, "cache");
    const late = refFromPath("mod\\late.mesh");
    await fetcher(cache, () => ({})).fetcher.fetch(archive, late, "mesh");
    const { fetcher: made } = fetcher(cache, args => {
      if (args[0] === "uncook") { const out = args[args.indexOf("-o") + 1]!; put(join(out, "mod", "late.mesh"), "x"); put(join(out, "mod", "late.mesh.json"), JSON.stringify(cr2w({ $type: "CMesh" }))); }
      return {};
    });
    expect(await made.fetch(archive, late, "mesh")).not.toBeNull();
    expect(made.transient(archive, late)).toBe(false);
    expect(readdirSync(join(cache, "json")).some(name => name.endsWith(".failed"))).toBe(false);
  });
});

describe("stored JSON (PIPE-60)", () => {
  test("the converter's ArchiveFileName (a private temporary path) is not stored or served; nothing else changes", async () => {
    const document = { Header: { WolvenKitVersion: "9.0.1", ArchiveFileName: "C:\\private\\tmp\\batch\\raw\\mod\\x.mi" }, Data: { RootChunk: { $type: "CMaterialInstance" } } };
    expect(withoutArchiveFileName(document)).toEqual({ Header: { WolvenKitVersion: "9.0.1" }, Data: { RootChunk: { $type: "CMaterialInstance" } } });
    expect(withoutArchiveFileName({ Data: {} })).toEqual({ Data: {} });
    const root = temporary(), archive = archiveAt(root), cache = join(root, "cache");
    // An unnamed reference goes through unbundle and convert, whose JSON carries the header field.
    const { fetcher: made } = fetcher(cache, args => {
      const out = args.includes("-o") ? args[args.indexOf("-o") + 1]! : args[2]!;
      if (args[0] === "unbundle") put(join(out, "123.bin"), "x");
      if (args[0] === "convert") for (const name of readdirSync(out)) if (!name.endsWith(".json")) writeFileSync(join(out, `${name}.json`), JSON.stringify(document));
      return {};
    });
    const fetched = await made.fetch(archive, { hash: "123", path: null }, "mi");
    expect((fetched!.document as { Header: object }).Header).toEqual({ WolvenKitVersion: "9.0.1" });
    const stored = readdirSync(join(cache, "json")).map(name => readFileSync(join(cache, "json", name), "utf8")).join("");
    expect(stored).not.toContain("ArchiveFileName");
    expect(fetched!.bytes).toBeGreaterThan(0);
  });
});

describe("command-line length (PIPE-61)", () => {
  test("argument lengths follow Windows' quoting", () => {
    expect(commandLineArgumentLength("plain")).toBe(6);
    expect(commandLineArgumentLength("with space")).toBe(13);
    expect(commandLineArgumentLength("C:\\a b\\")).toBe(1 + 2 + 7 + 1);
    expect(commandLineArgumentLength("say \"hi\"")).toBe(1 + 2 + 8 + 2);
  });

  test("patterns are split so every launch fits, counting escaping and every archive", () => {
    const cli = "C:\\Program Files\\XF Studio\\tools\\wolvenkit\\9.0.1\\WolvenKit.CLI.exe";
    const archives = Array.from({ length: 60 }, (_, i) => `F:\\Games\\MO2\\mods\\A mod with a long name ${i}\\archive\\pc\\mod\\some_archive_${i}.archive`);
    // Paths full of characters the regex escapes (each backslash and dot doubles).
    const paths = Array.from({ length: 900 }, (_, i) => `base\\characters\\head\\player_base_heads\\appearances\\head\\piercings\\i0_000__earring_${i}.(v2).app`);
    const output = "D:\\cache\\tmp\\batch-1234-abcdef\\serialized";
    const patterns = uncookPatterns(cli, archives, output, paths);
    expect(patterns.length).toBeGreaterThan(1);
    for (const pattern of patterns) {
      const line = [cli, "uncook", ...archives, "-o", output, "-r", pattern, "-u", "-s", "-v", "Minimal"].reduce((sum, arg) => sum + commandLineArgumentLength(arg), 0);
      expect(line).toBeLessThanOrEqual(COMMAND_LINE_LIMIT);
      expect(pattern.length).toBeLessThanOrEqual(MAX_PATTERN_CHARS);
    }
    // Every path is selected exactly once.
    const selected = patterns.flatMap(pattern => paths.filter(path => new RegExp(pattern.replace("(?i)", ""), "i").test(path)));
    expect(selected.sort()).toEqual([...paths].sort());
    // Few archives: one launch holds far more paths.
    expect(uncookPatterns(cli, archives.slice(0, 1), output, paths.slice(0, 50))).toHaveLength(1);
  });
});

test("an extraction whose output folder is missing counts as transient, not lasting", async () => {
  const root = temporary(), archive = archiveAt(root), cache = join(root, "cache");
  const { fetcher: made } = fetcher(cache, () => { throw Error("WolvenKit could not start"); });
  expect(await made.fetch(archive, refFromPath("mod\\x.mesh"), "mesh")).toBeNull();
  expect(made.transient(archive, refFromPath("mod\\x.mesh"))).toBe(true);
  expect(existsSync(join(cache, "json"))).toBe(false);
});
