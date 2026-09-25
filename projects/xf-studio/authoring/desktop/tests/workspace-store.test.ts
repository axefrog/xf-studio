import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DesktopWorkspaceStore } from "../workspace-store";
import { parseWorkspace, serializeWorkspace } from "../../src/workspace-state";
import { smallWorkspaceV1 } from "../../tests/fixtures/workspace-v1-fixtures";

const root = mkdtempSync(resolve(tmpdir(), "xfs-workspace-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("the first version-2 save keeps the version-1 workspace beside it, once, byte for byte (downgrade protection)", () => {
  for (const verification of [false, true]) {
    const dir = resolve(root, verification ? "verify" : "normal"), store = new DesktopWorkspaceStore(dir);
    const file = resolve(dir, store.fileName(verification)), backup = resolve(dir, store.backupName(verification));
    const v1 = JSON.stringify(smallWorkspaceV1());
    store.save(verification, v1);   // No file yet: nothing to keep.
    expect(existsSync(backup)).toBe(false);
    writeFileSync(file, v1);        // A workspace written by 0.1.0-alpha.1.
    const restored = parseWorkspace(JSON.parse(store.load(verification)!));
    restored.preview.eyeShape = 7;
    store.save(verification, JSON.stringify(serializeWorkspace(restored)));
    expect(readFileSync(backup, "utf8")).toBe(v1);
    expect(JSON.parse(readFileSync(file, "utf8")).schema).toBe("xfs/workspace-2");
    // Later saves never replace the kept copy.
    restored.preview.eyeShape = 8;
    store.save(verification, JSON.stringify(serializeWorkspace(restored)));
    expect(readFileSync(backup, "utf8")).toBe(v1);
    expect(parseWorkspace(JSON.parse(store.load(verification)!)).preview.eyeShape).toBe(8);
  }
});

test("a workspace from a newer build is never replaced; an older page's version-1 post is stored as version 2", () => {
  const dir = resolve(root, "newer"), store = new DesktopWorkspaceStore(dir), file = resolve(dir, store.fileName(false));
  store.save(false, JSON.stringify(smallWorkspaceV1()));
  expect(JSON.parse(readFileSync(file, "utf8")).schema).toBe("xfs/workspace-2");
  const newer = JSON.stringify({ schema: "xfs/workspace-3", look: {} });
  writeFileSync(file, newer);
  expect(() => store.load(false)).toThrow();
  expect(() => store.save(false, JSON.stringify(smallWorkspaceV1()))).toThrow();
  expect(readFileSync(file, "utf8")).toBe(newer);
  expect(existsSync(resolve(dir, store.backupName(false)))).toBe(false);
});
