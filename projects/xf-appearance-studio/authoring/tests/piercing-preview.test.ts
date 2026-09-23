import { expect, test } from "bun:test";
import { chunkEnabled, parsePiercingManifest, savedPiercing, verifyPiercingBytes } from "../src/piercing-preview";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import type { SavedV } from "../src/save-reader";

const source = { schema: "xfs/local-vanilla-piercings-1", source: "current game resources",
  assets: [{ id: "i1_000_pwa__morphs_earring_01", url: "/assets/piercings/part.glb", sha256: "a".repeat(64) }],
  styles: [{ id: "piercings_01", index: 1, label: "Piercing 01", resourceHash: "13134131550013307257",
    choices: [{ definition: "i0_000_pwa__earring__01_silver", index: 1, label: "Silver", swatch: "#ffffff",
      parts: [{ mesh: "i1_000_pwa__morphs_earring_01", mask: "18446744073709549572" }] }] }] };

test("vanilla piercing manifest preserves 64-bit masks and exact appearance identity", () => {
  const manifest = parsePiercingManifest(source);
  const save = (hash: string, definition: string) => ({ isMale: false, groups: { head: [
    { name: "character_customization", appearances: [{ resourceHash: hash, definition }] },
  ] } }) as SavedV;
  const selected = savedPiercing(manifest, save("13134131550013307257", "i0_000_pwa__earring__01_silver"));
  expect(selected?.style.id).toBe("piercings_01");
  expect(chunkEnabled(selected!.choice.parts[0]!.mask, 2)).toBe(true);
  expect(chunkEnabled(selected!.choice.parts[0]!.mask, 0)).toBe(false);
  expect(savedPiercing(manifest, save("13134131550013307256", selected!.choice.definition))).toBeUndefined();
  expect(savedPiercing(manifest, save(manifest.styles[0]!.resourceHash, "another_colour"))).toBeUndefined();
  expect(savedPiercing(manifest, { ...save(manifest.styles[0]!.resourceHash, selected!.choice.definition), isMale: true })).toBeUndefined();
});

test("local piercing input rejects unsafe assets, invalid masks and duplicate definitions", async () => {
  expect(() => parsePiercingManifest({ ...source, assets: [{ ...source.assets[0], url: "https://remote.invalid/part.glb" }] })).toThrow();
  expect(() => parsePiercingManifest({ ...source, styles: [source.styles[0], source.styles[0]] })).toThrow();
  expect(() => parsePiercingManifest({ ...source, styles: [{ ...source.styles[0], choices: [
    { ...source.styles[0]!.choices[0], parts: [{ mesh: "i1_000_pwa__morphs_earring_01", mask: "-1" }] },
  ] }] })).toThrow();
  const bytes = new TextEncoder().encode("vanilla preview fixture");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  await expect(verifyPiercingBytes(bytes, digest)).resolves.toBeUndefined();
  await expect(verifyPiercingBytes(bytes, "a".repeat(64))).rejects.toThrow();
});

test("private PRC slot uses its own bounded local asset namespace", () => {
  const prc = { ...source, schema: "xfs/local-prc-piercings-1", assets: [{ ...source.assets[0],
    id: "prc_fpm72", url: "/assets/prc/prc_fpm72.glb" }],
    styles: [{ ...source.styles[0], id: "prc_fpm72", choices: [{ ...source.styles[0]!.choices[0],
      parts: [{ mesh: "prc_fpm72", mask: "9223372036854775807" }] }] }] };
  const parsed = parsePiercingManifest(prc);
  expect(parsed.schema).toBe("xfs/local-prc-piercings-1");
  expect(chunkEnabled(parsed.styles[0]!.choices[0]!.parts[0]!.mask, 0)).toBe(true);
  expect(() => parsePiercingManifest({ ...prc, assets: source.assets })).toThrow();
  expect(() => parsePiercingManifest({ ...source, assets: prc.assets })).toThrow();
  expect(() => parsePiercingManifest({ ...prc, assets: [{ ...prc.assets[0], url: "https://example.invalid/slot.glb" }] })).toThrow();
});

test("viewport-only piercing selection and visibility persist without changing saved V", () => {
  const state = freshWorkspace();
  state.preview.piercings = false;
  state.preview.piercingStyle = "piercings_01";
  state.preview.piercingDefinition = "i0_000_pwa__earring__01_silver";
  const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
  expect(restored.preview.piercings).toBe(false);
  expect(restored.preview.piercingStyle).toBe("piercings_01");
  expect(restored.preview.piercingDefinition).toBe("i0_000_pwa__earring__01_silver");
  const old = JSON.parse(JSON.stringify(state));
  delete old.preview.piercings; delete old.preview.piercingStyle; delete old.preview.piercingDefinition;
  expect(parseWorkspace(old).preview.piercingStyle).toBe("");
  expect(parseWorkspace(old).preview.piercings).toBe(true);
});
