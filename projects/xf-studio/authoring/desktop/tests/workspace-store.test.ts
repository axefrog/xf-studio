import { afterAll, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DesktopWorkspaceStore } from "../workspace-store";
import { fitWorkspace } from "../../src/workspace-budget";
import { loadWorkspace, parseWorkspace, serializeWorkspace, storesLookLevelHistory } from "../../src/workspace-state";
import { historyRecipes } from "../../tests/fixtures/looks";
import { largeWorkspaceV1, smallWorkspaceV1 } from "../../tests/fixtures/workspace-v1-fixtures";
import { STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";

const root = mkdtempSync(resolve(tmpdir(), "xfs-workspace-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("the first version-2 save keeps the version-1 workspace beside it, once, byte for byte (downgrade protection)", () => {
  for (const verification of [false, true]) {
    const dir = resolve(root, verification ? "verify" : "normal"), store = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS);
    const file = resolve(dir, store.fileName(verification)), backup = resolve(dir, store.backupName(verification));
    const v1 = JSON.stringify(smallWorkspaceV1());
    store.save(verification, v1);   // No file yet: nothing to keep.
    expect(existsSync(backup)).toBe(false);
    writeFileSync(file, v1);        // A workspace written by 0.1.0-alpha.1.
    const restored = parseWorkspace(JSON.parse(store.load(verification)!), STUDIO_DOCUMENTS);
    restored.preview.eyeShape = 7;
    store.save(verification, JSON.stringify(serializeWorkspace(restored, STUDIO_DOCUMENTS)));
    expect(readFileSync(backup, "utf8")).toBe(v1);
    expect(JSON.parse(readFileSync(file, "utf8")).schema).toBe("xfs/workspace-2");
    // Later saves never replace the kept copy.
    restored.preview.eyeShape = 8;
    store.save(verification, JSON.stringify(serializeWorkspace(restored, STUDIO_DOCUMENTS)));
    expect(readFileSync(backup, "utf8")).toBe(v1);
    expect(parseWorkspace(JSON.parse(store.load(verification)!), STUDIO_DOCUMENTS).preview.eyeShape).toBe(8);
  }
});

test("a workspace from a newer build is never replaced; an older page's version-1 post is stored as version 2", () => {
  const dir = resolve(root, "newer"), store = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS), file = resolve(dir, store.fileName(false));
  store.save(false, JSON.stringify(smallWorkspaceV1()));
  expect(JSON.parse(readFileSync(file, "utf8")).schema).toBe("xfs/workspace-2");
  const newer = JSON.stringify({ schema: "xfs/workspace-3", look: {} });
  writeFileSync(file, newer);
  expect(() => store.load(false)).toThrow();
  expect(() => store.save(false, JSON.stringify(smallWorkspaceV1()))).toThrow();
  expect(readFileSync(file, "utf8")).toBe(newer);
  expect(existsSync(resolve(dir, store.backupName(false)))).toBe(false);
});

test("the .bak is refreshed whenever an older build wrote a newer version-1 file (CORE-30)", () => {
  const dir = resolve(root, "refresh"), store = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS);
  const file = resolve(dir, store.fileName(false)), backup = resolve(dir, store.backupName(false));
  const first = smallWorkspaceV1(), second = { ...smallWorkspaceV1(), library: { selected: "", name: "Written by the alpha again" } };
  store.save(false, JSON.stringify(first));
  writeFileSync(file, JSON.stringify(first));
  const upgrade = () => store.save(false, JSON.stringify(serializeWorkspace(parseWorkspace(JSON.parse(store.load(false)!),
    STUDIO_DOCUMENTS), STUDIO_DOCUMENTS)));
  upgrade();
  expect(readFileSync(backup, "utf8")).toBe(JSON.stringify(first));
  // The person ran 0.1.0-alpha.1 again, started fresh there and it wrote a new version-1 file.
  writeFileSync(file, JSON.stringify(second));
  upgrade();
  expect(readFileSync(backup, "utf8")).toBe(JSON.stringify(second));
  expect(JSON.parse(readFileSync(file, "utf8")).schema).toBe("xfs/workspace-2");
});

test("a look-level workspace is written back in that form, and each text is parsed at most once per save (CORE-39, CORE-41)", () => {
  const dir = resolve(root, "look-level"), store = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS), file = resolve(dir, store.fileName(false));
  const text = JSON.stringify(largeWorkspaceV1(16, 80));
  const state = loadWorkspace({ getItem: key => key === "xfas.workspace.v1" ? text : null }, false, STUDIO_DOCUMENTS).state;
  const whole = fitWorkspace(state, STUDIO_DOCUMENTS, Infinity);
  // The renderer's budget chose the look-level form: the host keeps it instead of rewriting whole parts.
  const fitted = fitWorkspace(state, STUDIO_DOCUMENTS, whole.size - 1);
  expect(fitted.plan.lookLevel).toBe(true);
  store.save(false, whole.encoded);
  expect(readFileSync(file, "utf8")).toBe(whole.encoded);
  const parse = spyOn(JSON, "parse");
  try {
    store.save(false, fitted.encoded);
    // The previous file is the text this store wrote, so only the new text is parsed.
    expect(parse.mock.calls.filter(([value]) => value === whole.encoded)).toHaveLength(0);
    expect(parse.mock.calls.filter(([value]) => value === fitted.encoded)).toHaveLength(1);
  } finally { parse.mockRestore(); }
  const stored = readFileSync(file, "utf8");
  expect(storesLookLevelHistory(JSON.parse(stored))).toBe(true);
  expect(stored.length).toBeLessThan(whole.size / 2);
  const histories = (encoded: string) => { const collections = parseWorkspace(JSON.parse(encoded), STUDIO_DOCUMENTS).collections!;
    return collections.collection.presets.map(preset => historyRecipes(STUDIO_DOCUMENTS.parts.lookHistory(collections.memory[preset.id]))); };
  expect(histories(stored)).toEqual(histories(whole.encoded));
  // A file this store has not seen is parsed once before it is replaced.
  const other = new DesktopWorkspaceStore(dir, STUDIO_DOCUMENTS), again = spyOn(JSON, "parse");
  try {
    other.save(false, whole.encoded);
    expect(again.mock.calls.filter(([value]) => value === stored)).toHaveLength(1);
    expect(again.mock.calls.filter(([value]) => value === whole.encoded)).toHaveLength(1);
  } finally { again.mockRestore(); }
  expect(readFileSync(file, "utf8")).toBe(whole.encoded);
});
