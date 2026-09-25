// Opt-in oracle: the creator catalogue and character context on a real, read-only installation. WolvenKit output goes to
// the ignored resolver cache; the game and mod manager are only read. Enable with:
//   XFS_RESOLVER_GAME_ROOT, XFS_WOLVENKIT_CLI; optional XFS_RESOLVER_MO2_ROOT + XFS_RESOLVER_MO2_PROFILE, XFS_RESOLVER_CACHE,
//   XFS_RESOLVER_SAVE (sav.dat or decoded appearance.json) for the save round trip.
// The first run extracts every text resource the installation's ArchiveXL declarations name, which takes minutes.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { descriptorsFromUiState } from "../src/cco-model";
import { CatalogueIndex, userFacing } from "../src/cc-catalogue";
import { loadCreatorCatalogue } from "../src/cc-catalogue-host";
import { type CharacterChoice, choicesOfPreset, deriveCharacter, presetOfChoices, recoverSave, savedDescriptorsOf } from "../src/character-context";
import { readCcPreset, writeCcPreset } from "../src/cc-preset";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { panelProjection } from "../src/cc-panel";
import { openInstallation } from "../src/resolver-host";
import { readSavedV } from "../src/save-reader";
import { oracleDescribe } from "./optional-oracles";

const env = process.env;
const missing = ["XFS_RESOLVER_GAME_ROOT", "XFS_WOLVENKIT_CLI"].filter(name => !env[name] || !existsSync(env[name]!));
const LONG = 45 * 60_000;

oracleDescribe(missing.length === 0, `the creator catalogue oracle needs ${missing.join(", ")} to read a real installation (read-only).`)("creator catalogue on a real installation", () => {
  const cacheDir = resolve(env.XFS_RESOLVER_CACHE ?? resolve(import.meta.dir, "..", "data", "resolver-cache"));
  const gameRoot = resolve(env.XFS_RESOLVER_GAME_ROOT ?? ".");
  const cli = resolve(env.XFS_WOLVENKIT_CLI ?? ".");
  const installation = missing.length ? null : openInstallation({ gameRoot, wolvenKitCli: cli, cacheDir,
    launchRoute: env.XFS_RESOLVER_MO2_ROOT ? "mo2" : "direct", mo2Root: env.XFS_RESOLVER_MO2_ROOT ? resolve(env.XFS_RESOLVER_MO2_ROOT) : null,
    mo2ProfileId: env.XFS_RESOLVER_MO2_PROFILE ?? null });
  const load = (gender: "female" | "male") => loadCreatorCatalogue({ installation: installation!, gameRoot, wolvenKitCli: cli, cacheDir, language: "en-us" }, gender);

  test("both catalogues come from the data: sections from TweakDB, labels from the game's texts, provenance on every choice", async () => {
    for (const gender of ["female", "male"] as const) {
      const { catalogue, evidence } = await load(gender);
      expect(evidence.tweakDb).not.toBeNull();
      expect(evidence.texts.filter(t => t.kind === "game").every(t => t.entries > 1000)).toBe(true);
      expect(catalogue.sections.length).toBeGreaterThanOrEqual(8);
      expect(catalogue.sections.filter(s => s.source === "tweakdb").map(s => s.id).slice(0, 3)).toEqual(["Skin", "Hair", "Eyes"]);
      const facing = catalogue.options.filter(o => userFacing(o));
      const vanilla = facing.filter(o => o.provenance.kind === "vanilla");
      // Every vanilla option whose label is a key resolves through the game's texts.
      const keyed = vanilla.filter(o => o.label.key && o.label.source !== "verbatim");
      expect(keyed.filter(o => o.label.source !== "game").map(o => `${o.id} ${o.label.key}`)).toEqual([]);
      // Types, Off choices and swatches are all present.
      expect(new Set(facing.map(o => o.type))).toEqual(new Set(["appearance", "morph", "switcher"]));
      expect(facing.some(o => o.choices.some(c => c.off))).toBe(true);
      expect(facing.some(o => o.choices.some(c => c.swatch?.icon?.part))).toBe(true);
      expect(catalogue.options.every(o => o.choices.every(c => c.provenance.kind === "vanilla" || c.provenance.mod !== null))).toBe(true);
      // The preview has a feminine head only; a masculine V's options say so (the preview's own projection, CORE-60).
      const coverage = catalogueCoverage(catalogue), rendered = facing.filter(o => coverage.get(o.id)!.status === "rendered").length;
      if (gender === "female") expect(rendered).toBeGreaterThan(0);
      else expect(rendered).toBe(0);
      // The panel's first paint stays well under 1 MB (UI-59).
      expect(JSON.stringify(panelProjection(catalogue, coverage, "oracle").panel).length).toBeLessThan(1_000_000);
    }
  }, LONG);

  test("the default V's request equals the host's default derivation; a preset round trip is exact", async () => {
    const { source } = await load("female");
    expect(deriveCharacter(source, { kind: "default" }, []).request.appearances).toEqual(descriptorsFromUiState(source.cco, {}).appearances);
    // Change one choice on every user-facing head row the preview draws, then round-trip through a preset.
    const coverage = catalogueCoverage(source.catalogue), choices: CharacterChoice[] = [];
    for (const option of source.catalogue.options) {
      if (!userFacing(option) || option.part !== "head" || coverage.get(option.id)!.status !== "rendered" || option.choices.length < 2) continue;
      choices.push({ part: option.part, option: option.name, choice: option.choices[option.choices.length - 1]!.key });
    }
    const derived = deriveCharacter(source, { kind: "default" }, choices);
    const { preset } = presetOfChoices(source, choices, { name: "oracle" });
    const again = deriveCharacter(source, { kind: "default" }, choicesOfPreset(readCcPreset(writeCcPreset(preset))));
    expect(again.request).toEqual(derived.request);
    expect(again.view.missing.entries).toEqual([]);
    // Only the choices set are stored (CORE-51).
    expect(preset.values.length).toBeLessThanOrEqual(choices.length);
    expect(new CatalogueIndex(source.catalogue).catalogue.options.length).toBeGreaterThan(0);
  }, LONG);

  const savePath = env.XFS_RESOLVER_SAVE;
  (savePath && existsSync(savePath) ? test : test.skip)("a saved V round-trips through the context", async () => {
    const saved = savePath!.toLowerCase().endsWith(".json") ? JSON.parse(readFileSync(savePath!, "utf8")) : readSavedV(readFileSync(savePath!));
    const { source } = await load(saved.isMale ? "male" : "female");
    const { saveCheck: check, missing } = recoverSave(source, savedDescriptorsOf(saved));
    console.log(`save check: ${check.matched}/${check.saved} saved choices reproduced; save only: ${check.savedOnly.join(", ")}; derived only: ${check.derivedOnly.join(", ")}`);
    console.log(`missing: ${missing.map(entry => `${entry.option} = ${entry.choice}`).join(", ")}`);
    expect(check.matched / check.saved).toBeGreaterThan(0.9);
  }, LONG);
});
