import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sweepTempDirs, tempDir } from "./temp-dir";

describe("tempDir", () => {
  const concurrent: string[] = [];
  test.concurrent("can be called inside concurrent tests (no hook is allowed there)", async () => {
    const dir = tempDir("xfs-temp-dir-concurrent-");
    concurrent.push(dir);
    writeFileSync(join(dir, "file.txt"), "x");
    await Bun.sleep(5);
    expect(existsSync(dir)).toBe(true);
  });
  test.concurrent("a second concurrent call makes its own folder", async () => {
    const dir = tempDir("xfs-temp-dir-concurrent-");
    concurrent.push(dir);
    await Bun.sleep(5);
    expect(existsSync(dir)).toBe(true);
  });
  test("the end-of-run sweep removes folders that no hook owns", async () => {
    await Bun.sleep(20);
    expect(concurrent.length).toBe(2);
    expect(concurrent.every(existsSync)).toBe(true);
    await sweepTempDirs();
    expect(concurrent.some(existsSync)).toBe(false);
  });
});
