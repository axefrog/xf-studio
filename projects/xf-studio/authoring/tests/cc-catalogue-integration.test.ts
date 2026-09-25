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
import { CharacterContext, previewRequestFor } from "../src/character-context";
import { readCcPreset, writeCcPreset } from "../src/cc-preset";
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
      // The preview has a feminine head only; a masculine V's options say so.
      if (gender === "female") expect(catalogue.counts.render.rendered).toBeGreaterThan(0);
      else expect(catalogue.counts.render.rendered).toBe(0);
    }
  }, LONG);

  test("the default V's request equals the host's default derivation; a preset round trip is exact", async () => {
    const { source } = await load("female");
    const context = new CharacterContext();
    context.setSource(source);
    const request = context.request();
    expect(request.appearances).toEqual(descriptorsFromUiState(source.cco, {}).appearances);
    // Change one choice on every user-facing head row the preview draws, then round-trip through a preset.
    const index = new CatalogueIndex(source.catalogue);
    for (const option of source.catalogue.options) {
      if (!userFacing(option) || option.part !== "head" || option.render.status !== "rendered" || option.choices.length < 2) continue;
      const choice = option.choices[option.choices.length - 1]!.key;
      if (context.capability({ kind: "character.setOption", part: option.part, option: option.name, choice }).available)
        context.dispatch({ kind: "character.setOption", part: option.part, option: option.name, choice });
    }
    expect(index.catalogue.options.length).toBeGreaterThan(0);
    const again = new CharacterContext();
    again.setSource(source);
    again.dispatch({ kind: "character.loadPreset", value: JSON.parse(writeCcPreset(context.toPreset("oracle"))) });
    expect(again.request()).toEqual(context.request());
    expect(again.snapshot().missing.entries).toEqual([]);
    expect(readCcPreset(writeCcPreset(again.toPreset())).values.length).toBe(context.toPreset().values.length);
    expect(previewRequestFor(context.request())).not.toBeNull();
  }, LONG);

  const savePath = env.XFS_RESOLVER_SAVE;
  (savePath && existsSync(savePath) ? test : test.skip)("a saved V round-trips through the context", async () => {
    const saved = savePath!.toLowerCase().endsWith(".json") ? JSON.parse(readFileSync(savePath!, "utf8")) : readSavedV(readFileSync(savePath!));
    const { source } = await load(saved.isMale ? "male" : "female");
    const context = new CharacterContext();
    context.setSource(source);
    context.dispatch({ kind: "character.loadSave", value: saved });
    const check = context.snapshot().saveCheck!;
    console.log(`save check: ${check.matched}/${check.saved} saved choices reproduced; save only: ${check.savedOnly.join(", ")}; derived only: ${check.derivedOnly.join(", ")}`);
    console.log(`missing: ${context.snapshot().missing.summary.map(s => s.message).join(" ")}`);
    expect(check.matched / check.saved).toBeGreaterThan(0.9);
  }, LONG);
});
