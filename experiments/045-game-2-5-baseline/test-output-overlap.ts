import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, rmdirSync, linkSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDiagnosticDirectory, refuseInputOverlap, requireFreshDiagnosticPath, writeDiagnosticFile } from "../../projects/xf-studio/authoring/tools/native-writer-paths";

test("diagnostics refuse inputs, ancestors, descendants, junctions, and sibling oracles before writing", () => {
  const scratch = resolve(import.meta.dir, "generated/scratch");
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(join(scratch, "overlap-"));
  const oracle = join(work, "oracle"), one = join(oracle, "one"), two = join(oracle, "two");
  const link = join(work, "alias");
  try {
    mkdirSync(one, { recursive: true }); mkdirSync(two);
    writeFileSync(join(one, "input.json"), "sentinel");
    for (const output of [oracle, one, join(one, "new"), work])
      expect(() => refuseInputOverlap(output, [oracle])).toThrow("overlaps");
    expect(() => refuseInputOverlap(join(work, "oracle-neighbour"), [oracle])).not.toThrow();
    symlinkSync(oracle, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => refuseInputOverlap(join(link, "one", "new"), [oracle])).toThrow("overlaps");
    const tool = resolve(import.meta.dir, "../../projects/xf-studio/authoring/tools/native-writer-oracle.ts");
    for (const output of [one, two, join(link, "one", "new")]) {
      const run = Bun.spawnSync([process.execPath, tool, "compare", "one"], {
        env: { ...process.env, XFS_NATIVE_WRITER_ORACLE: oracle, XFS_NATIVE_WRITER_OUTPUT: output },
        stdout: "pipe", stderr: "pipe",
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain(output === one || output === two ? "must not exist" : "Output overlaps an oracle input");
    }
    expect(readFileSync(join(one, "input.json"), "utf8")).toBe("sentinel");
  } finally {
    rmdirSync(link); // Remove the junction itself before recursive scratch cleanup.
    if (!work.startsWith(scratch + (process.platform === "win32" ? "\\" : "/"))) throw Error("Unexpected scratch path");
    rmSync(work, { recursive: true });
  }
});

test("fresh diagnostics and wx writes refuse existing entries, hard links and dangling links", () => {
  const scratch = resolve(import.meta.dir, "generated/scratch");
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(join(scratch, "exclusive-"));
  const source = join(work, "input"), out = join(work, "diagnostics");
  const dangling = join(work, "dangling"), danglingFile = join(out, "dangling-file");
  const tool = resolve(import.meta.dir, "../../projects/xf-studio/authoring/tools/native-writer-oracle.ts");
  const links: string[] = [];
  try {
    writeFileSync(source, "sentinel");
    createDiagnosticDirectory(out, [source]);
    expect(() => createDiagnosticDirectory(out, [source])).toThrow("must not exist");
    writeDiagnosticFile(join(out, "new"), "first");
    expect(() => writeDiagnosticFile(join(out, "new"), "second")).toThrow();
    expect(readFileSync(join(out, "new"), "utf8")).toBe("first");
    const hardlink = join(work, "hardlink"), fileAlias = join(out, "hardlink-file");
    linkSync(source, hardlink); linkSync(source, fileAlias);
    expect(() => createDiagnosticDirectory(hardlink, [source])).toThrow("must not exist");
    expect(() => writeDiagnosticFile(fileAlias, "overwrite")).toThrow();
    for (const link of [dangling, danglingFile]) {
      symlinkSync(join(work, "missing-target"), link, process.platform === "win32" ? "junction" : "dir");
      links.push(link);
      expect(() => requireFreshDiagnosticPath(link)).toThrow("must not exist");
      expect(() => createDiagnosticDirectory(link, [source])).toThrow("must not exist");
      expect(() => writeDiagnosticFile(link, "overwrite")).toThrow();
    }
    for (const output of [out, hardlink, dangling]) {
      const run = Bun.spawnSync([process.execPath, tool, "compare", "one"], {
        env: { ...process.env, XFS_NATIVE_WRITER_ORACLE: join(work, "oracle"), XFS_NATIVE_WRITER_OUTPUT: output },
        stdout: "pipe", stderr: "pipe",
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain("must not exist");
    }
    expect(readFileSync(source, "utf8")).toBe("sentinel");
  } finally {
    for (const link of links) {
      if (process.platform === "win32") rmdirSync(link); else rmSync(link);
    }
    if (!work.startsWith(scratch + (process.platform === "win32" ? "\\" : "/"))) throw Error("Unexpected scratch path");
    rmSync(work, { recursive: true });
    rmdirSync(scratch);
  }
});
