/**
 * The re-runnable byte-identity gate (PIPE-95, `tools/compare-package-candidates.ts`): two candidates whose archive
 * members and declarations are identical pass, whatever their archive containers' own hashes; a changed member, a
 * changed declaration, a changed manifest field or a changed intermediate file fails, named.
 */
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareCandidates, treeDifferences, treeFiles } from "../tools/compare-package-candidates";
import type { VerifierTools } from "../src/platform/api";

const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-candidate-compare-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ARCHIVE = "xfs_c0ec3546e3fac43e78c19a65d20383d41";
const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** A promoted candidate: its manifest (version 2), its two files, and the member tree its archive "holds". */
function candidate(name: string, options: { members?: Record<string, string>; xl?: string; modName?: string; container?: string } = {}) {
  const dir = join(root, name), members = join(root, `${name}-members`);
  const xl = options.xl ?? "customizations:\r\n  female: a\\b.inkcharcustomization\r\n";
  const container = options.container ?? `container ${name}`;
  mkdirSync(join(dir, "archive", "pc", "mod"), { recursive: true });
  writeFileSync(join(dir, "archive", "pc", "mod", `${ARCHIVE}.archive`), container);
  writeFileSync(join(dir, "archive", "pc", "mod", `${ARCHIVE}.archive.xl`), xl);
  for (const [path, text] of Object.entries(options.members ?? { "a/b.app": "app", "a/b.mesh": "mesh" })) {
    mkdirSync(join(members, path, ".."), { recursive: true });
    writeFileSync(join(members, path), text);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schema: "xfs/local-package-2", productId: "0ec3546e-3fac-43e7-8c19-a65d20383d41",
    modName: options.modName ?? "XF Eye Artistry", nameSource: "derived", archive: ARCHIVE, features: [{ feature: "eye-makeup", namespace: ARCHIVE,
      verification: { presetCount: 2 } }],
    files: [{ path: `archive/pc/mod/${ARCHIVE}.archive`, sha256: sha(container), bytes: container.length },
      { path: `archive/pc/mod/${ARCHIVE}.archive.xl`, sha256: sha(xl), bytes: xl.length }],
    verifiedUnpackedFiles: 2, installed: false, gameRenderingVerified: false }));
  return { dir, members };
}
/** WolvenKit's stand-in: unbundling a candidate's archive copies the member tree written beside it. */
const unbundle = (trees: Record<string, string>): VerifierTools["unbundle"] => (archive, output) => {
  const tree = Object.entries(trees).find(([dir]) => archive.startsWith(dir))?.[1];
  if (!tree) return { exitCode: 1, stdout: "", stderr: "unknown archive" };
  cpSync(tree, output, { recursive: true });
  return { exitCode: 0, stdout: "ok", stderr: "" };
};
const compare = (a: ReturnType<typeof candidate>, b: ReturnType<typeof candidate>) =>
  compareCandidates(a.dir, b.dir, unbundle({ [a.dir]: a.members, [b.dir]: b.members }), join(root, `work-${crypto.randomUUID()}`));

test("identical members and declaration pass, although the archive containers differ", () => {
  const report = compare(candidate("main"), candidate("branch"));
  expect(report).toEqual({ identical: true, differences: [], members: 2 });
});

test("a changed member, declaration or manifest field fails, and says which", () => {
  expect(compare(candidate("m1"), candidate("b1", { members: { "a/b.app": "app", "a/b.mesh": "other" } })).differences)
    .toEqual(["archive members: differs: a/b.mesh"]);
  expect(compare(candidate("m2"), candidate("b2", { members: { "a/b.app": "app" } })).differences).toEqual(["archive members: only in A: a/b.mesh"]);
  expect(compare(candidate("m3"), candidate("b3", { xl: "customizations: {}\r\n" })).differences).toContain("the .archive.xl files differ");
  const renamed = compare(candidate("m4"), candidate("b4", { modName: "XF Night Looks" }));
  expect(renamed.identical).toBe(false);
  expect(renamed.differences.some(line => line.startsWith("manifest mod name"))).toBe(true);
});

test("intermediate trees compare file for file, JSON without WolvenKit's export-time header", () => {
  const tree = (name: string, header: string, body: string) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plate.mesh.json"), JSON.stringify({ Header: { ExportedDateTime: header }, Data: { body } }));
    writeFileSync(join(dir, "map.raw"), "pixels");
    return dir;
  };
  const a = tree("tree-a", "10:00", "same"), b = tree("tree-b", "11:00", "same"), c = tree("tree-c", "12:00", "changed");
  expect(treeDifferences("tree", treeFiles(a, true), treeFiles(b, true))).toEqual([]);
  expect(treeDifferences("tree", treeFiles(a), treeFiles(b))).toEqual(["tree: differs: plate.mesh.json"]);
  expect(treeDifferences("tree", treeFiles(a, true), treeFiles(c, true))).toEqual(["tree: differs: plate.mesh.json"]);
  expect(readFileSync(join(a, "map.raw"), "utf8")).toBe("pixels");
});
