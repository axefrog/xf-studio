import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeChoiceManifest } from "../src/choice-manifest";

test("an unchanged choice manifest is not rewritten, so what was derived from its stamp stays valid", () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-manifest-"));
  try {
    const manifest = { schema: "probe" } as unknown as Parameters<typeof writeChoiceManifest>[2];
    writeChoiceManifest(dir, "k", manifest);
    const path = join(dir, "k.json"), past = new Date(2020, 0, 1);
    utimesSync(path, past, past);
    writeChoiceManifest(dir, "k", manifest);
    expect(statSync(path).mtimeMs).toBe(past.getTime());
    writeChoiceManifest(dir, "k", { schema: "changed" } as unknown as Parameters<typeof writeChoiceManifest>[2]);
    expect(statSync(path).mtimeMs).not.toBe(past.getTime());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
