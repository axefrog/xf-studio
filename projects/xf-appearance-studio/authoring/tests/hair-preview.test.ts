import { expect, test } from "bun:test";
import { parseHairManifest, selectSavedHair, verifyHairBytes } from "../src/hair-preview";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import type { SavedV } from "../src/save-reader";

const digest = "a".repeat(64);
const manifest = { schema: "xfs/local-hair-assets-1", entries: [{
  resourceHash: "14407260537193084196", definition: "38_ash_brown", label: "Resolved style",
  parts: [{ url: "/assets/hair/part1.glb", sha256: digest }, { url: "/assets/hair/part2.glb", sha256: digest }],
  alpha: { url: "/assets/hair/strands.png", sha256: digest },
}] };
const save = (hash: string, definition: string) => ({ groups: { head: [
  { name: "hairs", appearances: [{ resourceHash: hash, definition }] },
] } }) as SavedV;

test("saved hair matches exact 64-bit app hash and definition in hairs group", () => {
  const entries = parseHairManifest(manifest);
  expect(selectSavedHair(entries, save("14407260537193084196", "38_ash_brown"))?.label).toBe("Resolved style");
  expect(selectSavedHair(entries, save("14407260537193084196", "01_blonde_platinum"))).toBeUndefined();
  expect(selectSavedHair(entries, save("14407260537193084195", "38_ash_brown"))).toBeUndefined();
  expect(selectSavedHair(entries)).toBeUndefined();
});

test("local manifest rejects duplicate identities, unsafe asset URLs and bad digests", async () => {
  expect(() => parseHairManifest({ ...manifest, entries: [manifest.entries[0], manifest.entries[0]] })).toThrow();
  expect(() => parseHairManifest({ ...manifest, entries: [{ ...manifest.entries[0], alpha: { url: "https://remote.invalid/a.png", sha256: digest } }] })).toThrow();
  expect(() => parseHairManifest({ ...manifest, entries: [{ ...manifest.entries[0], parts: [{ url: "/assets/hair/part1.glb", sha256: "bad" }] }] })).toThrow();
  const bytes = new TextEncoder().encode("local asset");
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  await expect(verifyHairBytes(bytes, actual)).resolves.toBeUndefined();
  await expect(verifyHairBytes(bytes, digest)).rejects.toThrow();
});

test("optional hair visibility survives workspace restore and older drafts default on", () => {
  const state = freshWorkspace(); state.preview.hair = false;
  expect(parseWorkspace(JSON.parse(JSON.stringify(state))).preview.hair).toBe(false);
  const old = JSON.parse(JSON.stringify(state)); delete old.preview.hair;
  expect(parseWorkspace(old).preview.hair).toBe(true);
});
