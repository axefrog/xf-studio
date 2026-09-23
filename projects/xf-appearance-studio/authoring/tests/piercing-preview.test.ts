import { expect, test } from "bun:test";
import { aggregatePrcStyle, chunkEnabled, parsePiercingManifest, piercingPartColor, savedPiercing, verifyPiercingBytes,
  type PiercingStyle } from "../src/piercing-preview";
import { piercingPaletteColor } from "../src/piercing-palette";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import type { SavedV } from "../src/save-reader";

const source = { schema: "xfs/local-vanilla-piercings-2", source: "current game resources",
  assets: [{ id: "i1_000_pwa__morphs_earring_01", url: "/assets/piercings/part.glb", sha256: "a".repeat(64) }],
  styles: [{ id: "piercings_01", index: 1, label: "Piercing 01", resourceHash: "13134131550013307257",
    choices: [{ definition: "i0_000_pwa__earring__01_silver", index: 1, label: "Silver", swatch: "#ffffff", previewColor: "#ffffff",
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
  expect(() => parsePiercingManifest({ ...source, schema: "xfs/local-vanilla-piercings-1" })).toThrow();
  expect(() => parsePiercingManifest({ ...source, styles: [{ ...source.styles[0], choices: [{ ...source.styles[0]!.choices[0], previewColor: "invalid" }] }] })).toThrow();
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

test("PRC aggregate shares one colour across all resolved slots and preserves diagnostic choices", () => {
  const colours = [
    { definition: "i0_000_pwa__earring__01_silver", index: 1, label: "Silver (approx.)",
      swatch: "#d6d5d3", previewColor: "#d6d5d3" },
    { definition: "i0_000_pwa__earring__02_gold", index: 2, label: "Gold (approx.)",
      swatch: "#b87123", previewColor: "#b87123" },
  ];
  const diagnostics: PiercingStyle[] = [50, 72, 74].map(slot => ({
    id: `prc_fpm${slot}`, index: slot, label: `Inspect ${slot}`,
    resourceHash: "13134131550013307257", choices: colours.map(colour => ({ ...colour,
      parts: [{ mesh: `prc_fpm${slot}`, mask: "9223372036854775807" }] })),
  }));
  const aggregate = aggregatePrcStyle(diagnostics);
  expect(aggregate.id).toBe("prc_active_bank");
  expect(aggregate.choices.map(c => c.definition)).toEqual(colours.map(c => c.definition));
  expect(aggregate.choices[1]!.parts.map(p => p.mesh)).toEqual(["prc_fpm50", "prc_fpm72", "prc_fpm74"]);
  expect(aggregate.choices[1]!.previewColor).toBe("#b87123");
  expect(diagnostics[0]!.choices[1]!.parts).toHaveLength(1);
  const manifest = parsePiercingManifest({ schema: "xfs/local-prc-piercings-1", source: "private fixture",
    assets: diagnostics.map(s => ({ id: s.id, url: `/assets/prc/${s.id}.glb`, sha256: "a".repeat(64) })),
    styles: [aggregate, ...diagnostics] });
  expect(manifest.styles).toHaveLength(4);
  const state = freshWorkspace();
  state.preview.piercingStyle = aggregate.id;
  state.preview.piercingDefinition = aggregate.choices[1]!.definition;
  expect(parseWorkspace(JSON.parse(JSON.stringify(state))).preview.piercingStyle).toBe("prc_active_bank");
  expect(parseWorkspace(JSON.parse(JSON.stringify(state))).preview.piercingDefinition).toBe(colours[1]!.definition);
  const divergent = structuredClone(diagnostics);
  divergent[1]!.choices[1]!.previewColor = "#000000";
  expect(() => aggregatePrcStyle(divergent)).toThrow("one verified appearance and colour");
  divergent[1]!.choices[1]!.previewColor = colours[1]!.previewColor;
  divergent[2]!.choices[0]!.parts[0]!.mesh = "prc_fpm50";
  expect(() => aggregatePrcStyle(divergent)).toThrow("Duplicate PRC aggregate mesh");
});

test("a source-fixed PRC stud chunk stays silver under every shared framework colour", () => {
  const part = { mesh: "prc_fpm50", mask: "9223372036854775807",
    chunkColors: [{ index: 1, color: "#efeae7" }] };
  const fixture = { schema: "xfs/local-prc-piercings-1", source: "private fixture",
    assets: [{ id: part.mesh, url: "/assets/prc/prc_fpm50.glb", sha256: "a".repeat(64) }],
    styles: [{ id: part.mesh, index: 50, label: "Stud", resourceHash: "13134131550013307257",
      choices: [{ definition: "silver", index: 1, label: "Silver", swatch: "#efeae7",
        previewColor: "#efeae7", parts: [part] },
        { definition: "gold", index: 2, label: "Gold", swatch: "#b87123",
          previewColor: "#b87123", parts: [part] }] }] };
  const parsed = parsePiercingManifest(fixture);
  const gold = parsed.styles[0]!.choices[1]!;
  expect(piercingPartColor(gold.parts[0]!, 0, gold.previewColor)).toBe("#b87123");
  expect(piercingPartColor(gold.parts[0]!, 1, gold.previewColor)).toBe("#efeae7");
  expect(piercingPartColor(parsed.styles[0]!.choices[0]!.parts[0]!, 1, "#efeae7")).toBe("#efeae7");
  expect(() => parsePiercingManifest({ ...fixture, styles: [{ ...fixture.styles[0],
    choices: [{ ...fixture.styles[0]!.choices[0], parts: [{ ...part,
      chunkColors: [{ index: 64, color: "#efeae7" }] }] }] }] })).toThrow();
  expect(() => parsePiercingManifest({ ...fixture, styles: [{ ...fixture.styles[0],
    choices: [{ ...fixture.styles[0]!.choices[0], parts: [{ ...part,
      chunkColors: [{ index: 1, color: "black" }] }] }] }] })).toThrow();
});

test("visible source palette layers produce a nonblack linear-to-display preview tint", () => {
  expect(piercingPaletteColor([{ rgb: [1, 0, 0], opacity: 1 }])).toBe("#ff0000");
  expect(piercingPaletteColor([{ rgb: [0, .5, 1], opacity: 1 }, { rgb: [0, 1, .5], opacity: 1 }]))
    .toBe("#00e1e1");
  expect(() => piercingPaletteColor([{ rgb: [0, 0, 0], opacity: 0 }])).toThrow();
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
