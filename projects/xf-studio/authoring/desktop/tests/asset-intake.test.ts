import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { importCoreAssets, inspectCoreAssets } from "../asset-intake";

test("prepared core intake diagnoses, verifies after copy and preserves a fresh destination", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "xfs-core-intake-"));
  try {
    const source = resolve(root, "prepared"), data = resolve(root, "data");
    mkdirSync(source);
    const bytes = Buffer.from("synthetic preview fixture");
    const spec = [{ name: "head.glb", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") }];
    expect((await inspectCoreAssets(source, spec)).files).toEqual([{ name: "head.glb", status: "missing" }]);
    writeFileSync(resolve(source, "head.glb"), "wrong");
    expect((await inspectCoreAssets(source, spec)).files[0]?.status).toBe("invalid");
    writeFileSync(resolve(source, "head.glb"), bytes);
    const check = await inspectCoreAssets(source, spec);
    expect(check).toMatchObject({ ready: true, provenance: "unverified" });
    const copied = await importCoreAssets(source, data, spec);
    expect(copied.ready).toBe(true);
    expect(readFileSync(resolve(data, "preview-assets", "head.glb"))).toEqual(bytes);
    await expect(importCoreAssets(source, data, spec)).rejects.toThrow("does not replace");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a linked source file cannot enter the private asset tree", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "xfs-core-link-"));
  try {
    const source = resolve(root, "prepared"), data = resolve(root, "data");
    mkdirSync(source);
    const file = resolve(root, "outside.glb");
    writeFileSync(file, "fixture");
    symlinkSync(file, resolve(source, "head.glb"));
    const spec = [{ name: "head.glb", bytes: 7,
      sha256: createHash("sha256").update("fixture").digest("hex") }];
    expect((await inspectCoreAssets(source, spec)).files[0]?.status).toBe("invalid");
    expect((await importCoreAssets(source, data, spec)).ready).toBe(false);
    expect(existsSync(resolve(data, "preview-assets"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
