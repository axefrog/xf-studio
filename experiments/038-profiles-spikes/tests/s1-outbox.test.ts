import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../projects/xf-studio/authoring/tests/temp-dir";

// The S1 kill harness on the production outbox (profiles design §2.2, chunk 1c): renderer and host killed at 20 points each, two windows
// with kills of both, and a forced outbox-write failure, on the localhost routes and the real desktop server. About 2.5 minutes; CI sets
// XFS_HARNESS_QUICK=1, which kills half as often (about half the time).
test("the outbox kill harness passes on both hosts", async () => {
  const scratch = tempDir("xfs-s1-outbox-");
  try {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "..", "tools", "s1-outbox.ts"), scratch], { stdout: "pipe", stderr: "ignore" });
    const [code, text] = await Promise.all([run.exited, new Response(run.stdout).text()]);
    const results = JSON.parse(text.slice(text.indexOf("{"))) as Record<string, { ok?: boolean }>;
    expect(Object.entries(results).filter(([, result]) => typeof result === "object" && !result.ok).map(([name]) => name)).toEqual([]);
    expect(code).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 400_000);
