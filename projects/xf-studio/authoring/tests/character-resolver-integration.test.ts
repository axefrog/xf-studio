// Opt-in integration test against a real, read-only installation. It never writes to the game or MO2;
// WolvenKit output goes to the ignored resolver cache. Enable with:
//   XFS_RESOLVER_GAME_ROOT, XFS_WOLVENKIT_CLI, XFS_RESOLVER_SAVE (sav.dat or decoded appearance.json)
//   optional XFS_RESOLVER_MO2_ROOT + XFS_RESOLVER_MO2_PROFILE, XFS_RESOLVER_CACHE
// XFS_RESOLVER_REFERENCE=1 additionally checks the hand-traced results recorded for the maintainer's
// reference installation (research/character-customization/resolver-validation.md).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { descriptorsFromUiState } from "../src/cco-model";
import { inputFromSave, loadMergedCco, resolveCharacter, type ResolvedAppearance, type ResolvedCharacter } from "../src/character-resolver";
import { openInstallation } from "../src/resolver-host";
import { readSavedV } from "../src/save-reader";

const env = process.env;
const missing = ["XFS_RESOLVER_GAME_ROOT", "XFS_WOLVENKIT_CLI", "XFS_RESOLVER_SAVE"].filter(name => !env[name] || !existsSync(env[name]!));
const reference = env.XFS_RESOLVER_REFERENCE === "1";
if (missing.length) console.info(`[resolver integration] skipped: set ${missing.join(", ")} to resolve a real installation (read-only).`);

const open = () => openInstallation({ gameRoot: resolve(env.XFS_RESOLVER_GAME_ROOT!), wolvenKitCli: resolve(env.XFS_WOLVENKIT_CLI!),
  launchRoute: env.XFS_RESOLVER_MO2_ROOT ? "mo2" : "direct", mo2Root: env.XFS_RESOLVER_MO2_ROOT ? resolve(env.XFS_RESOLVER_MO2_ROOT) : null,
  mo2ProfileId: env.XFS_RESOLVER_MO2_PROFILE ?? null, cacheDir: resolve(env.XFS_RESOLVER_CACHE ?? resolve(import.meta.dir, "..", "data", "resolver-cache")) });
const find = (character: ResolvedCharacter, option: string) => character.appearances.find(a => a.option === option)!;
const components = (entry: ResolvedAppearance) => entry.components.filter(c => c.geometry && !c.geometry.drawsNothing);
const params = (entry: ResolvedAppearance) => components(entry).flatMap(c => c.materials.flatMap(m => m.params));

describe.skipIf(missing.length > 0)("resolver on a real installation", () => {
  test("resolves every saved appearance descriptor from game data", async () => {
    const installation = open();
    expect(installation.summary.indexErrors).toEqual([]);
    const path = env.XFS_RESOLVER_SAVE!;
    const saved = path.toLowerCase().endsWith(".json") ? JSON.parse(readFileSync(path, "utf8")) : readSavedV(readFileSync(path));
    const input = inputFromSave(saved);
    const result = await resolveCharacter(installation.graph, input);
    const saved_pairs = new Set(input.appearances.map(a => `${a.option}|${a.definition}`));
    expect(new Set(result.appearances.map(a => `${a.option}|${a.definition}`))).toEqual(saved_pairs);
    expect(result.appearances.filter(a => a.app?.status === "archive").length).toBeGreaterThan(0);

    if (!reference) return;
    // Eyes: saved ArchiveXL app, dynamic `eye_16_diffuse`, Unique Eyes choice, Kala textures (modded-eye-resolution.md).
    const eyes = find(result, "eyes_color");
    expect(eyes.app!.archive).toBe("ArchiveXL.archive");
    expect(eyes.choice!.providedBy).toContain("nutboy\\ccxl_unique_eyes\\eyes_ccxl.inkcharcustomization");
    const eyeParams = params(eyes);
    for (const [name, hash] of [["Albedo", "7140168419554698265"], ["Normal", "15957548315662394704"], ["Roughness", "15197097397900794989"]] as const) {
      const param = eyeParams.find(p => p.name === name && p.resource?.ref.hash === hash)!;
      expect(param.resource!.archive).toBe("basegame_Kala Standalone Eyes V2.archive");
    }
    // Hair: MELUMINARY style + island_dancer colour, dynamic ash_brown (saved-hair-profile-resolution.md).
    const hair = find(result, "lm097_hair");
    expect(hair.app!.extractedSha256).toBe("e80ab06ea470d60aa87996ab2d8e122d32d72f49cbfb1b23508bc5996d4fe250");
    expect(hair.appearance.status).toBe("dynamic");
    const meshes = components(hair).map(c => c.geometry!.mesh!.extractedSha256);
    expect(meshes).toContain("7f411ca7b01bcd1de1cd89d964a268c62b3c1c88f0612957e1ef5ba1e587afd2");
    expect(meshes).toContain("dc1cbb35990c1ea5b4175d8536bbb9d8f0853f34439b4761ea3d7d0165e78d59");
    const hairParams = params(hair);
    expect(hairParams.find(p => p.name === "HairProfile")!.resource!.ref.hash).toBe("10513927005646989368");
    expect(hairParams.find(p => p.name === "GradientMap")!.resource!.ref.hash).toBe("5639241876279721650");
    // Brows: Arkhe style-18 stub filled by the resource.copy + patch chain (head-details.md).
    const brows = find(result, "ark_eyebrows_02_ccxl_18");
    expect(brows.app!.ref.hash).toBe("10685882159528859062");
    const brow = components(brows)[0]!;
    expect(brow.geometry!.morphTarget!.ref.hash).toBe("5838896660247859963");
    expect(brow.geometry!.patchedFrom.some(p => p.startsWith("arkhe_copy\\"))).toBe(true);
    expect(Object.values(brow.morphRegions).reduce((a, b) => a + b, 0)).toBe(105);
    // Lashes: the brown_liquorice profile collision stays visible (brown-liquorice-profile-overlap.md).
    const lashes = find(result, "icxrus_softnaturaleyelashes");
    const profile = params(lashes).find(p => p.name === "HairProfile")!.resource!;
    expect(profile.ref.hash).toBe("13919918321801903732");
    expect(profile.alternatives.some(a => a.startsWith("basegame_4_appearance.archive"))).toBe(true);
    expect(result.ambiguities.some(a => a.code === "mod-over-base-native-unread" && a.subject.endsWith("brown_liquorice.hp"))).toBe(true);
    // Skin: saved-skin-resource-chain.md digests.
    const skin = find(result, "skin_type_05");
    expect(skin.app!.extractedSha256).toBe("520eb3d70ca8eeadd983e42b48af45ec2be31a56b4b29c7b104966049576bb21");
    expect(components(skin)[0]!.geometry!.mesh!.extractedSha256).toBe("e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6");

    // PRC: vanilla piercing option 12 resolves to the framework bank (prc-preview-slice.md).
    const cco = await loadMergedCco(installation.graph, "female");
    const derived = descriptorsFromUiState(cco.merged.cco, { piercings: "12", piercings_12: "i0_000_pwa__earring__01_silver" });
    const prc = await resolveCharacter(installation.graph, { bodyGender: "female", origin: "ui-state", morphs: [],
      appearances: derived.appearances.filter(a => a.option === "piercings_12") }, cco);
    const piercing = prc.appearances[0]!;
    expect(piercing.app!.archive).toBe("PRC_z_999_Framework_128.archive");
    const drawn = new Map(components(piercing).map(c => [c.name, c]));
    expect(drawn.get("fpm72")!.geometry!.morphTarget!.extractedSha256).toBe("d7b5238fd9cd4990fb9b3f4a53fa8148b0ae7b9fc60c9fe8f16b4b576008fc32");
    expect(drawn.get("fpm50")!.geometry!.morphTarget!.extractedSha256).toBe("42b4c7e82f7e4fbf3500d2f79e7c1f6ac89eeda773d4bfbc2137c08ce707374f");
    expect(drawn.has("fpm74")).toBe(true);
    expect(piercing.components.filter(c => c.geometry?.drawsNothing).length).toBe(125);
    const stud = drawn.get("fpm50")!.materials.find(m => m.name === "default__02")!;
    expect(stud.chain.map(l => l.label)).toContain("base\\eagul\\mat_1.mi");
  }, 30 * 60 * 1000);
});
