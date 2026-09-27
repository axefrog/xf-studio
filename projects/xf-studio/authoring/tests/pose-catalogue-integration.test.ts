// Opt-in oracle: the pose catalogue on a real, read-only installation (pose-library-design.md P1). The game and mod manager are only read;
// the set index goes to the resolver cache. Enable with XFS_RESOLVER_GAME_ROOT; optional XFS_RESOLVER_MO2_ROOT + XFS_RESOLVER_MO2_PROFILE,
// XFS_RESOLVER_CACHE. The native reader must be available (Windows, the game's own Oodle library).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { installations } from "../src/installation-registry";
import { loadPoseCatalogue, PoseCatalogueHost } from "../src/pose-catalogue-host";
import { oracleDescribe } from "./optional-oracles";

const env = process.env;
const available = !!env.XFS_RESOLVER_GAME_ROOT && existsSync(env.XFS_RESOLVER_GAME_ROOT) && process.platform === "win32";
const LONG = 10 * 60_000;

oracleDescribe(available, "the pose catalogue oracle needs XFS_RESOLVER_GAME_ROOT (a Windows game install) to read a real installation (read-only).")("pose catalogue on a real installation", () => {
  const cacheDir = resolve(env.XFS_RESOLVER_CACHE ?? resolve(import.meta.dir, "..", "data", "resolver-cache"));
  const gameRoot = resolve(env.XFS_RESOLVER_GAME_ROOT ?? ".");
  const route = { gameRoot, wolvenKitCli: null, launchRoute: env.XFS_RESOLVER_MO2_ROOT ? "mo2" as const : "direct" as const,
    mo2Root: env.XFS_RESOLVER_MO2_ROOT ? resolve(env.XFS_RESOLVER_MO2_ROOT) : null, mo2ProfileId: env.XFS_RESOLVER_MO2_PROFILE ?? null };

  test("every game pose in the female list resolves to a decodable clip in the puppet's sets, and one samples on the rig", async () => {
    const installation = await installations.acquire({ ...route, cacheDir });
    const { catalogue, evidence } = await loadPoseCatalogue(installation, { gameRoot, cacheDir, bodyGender: "female", language: "en-us" });
    expect(evidence.tweakDb).not.toBeNull();
    // Named by path when a declaration names it (an ArchiveXL scope), else by hash.
    expect(evidence.puppet).not.toBeNull();
    const game = catalogue.entries.filter(entry => entry.source.kind === "game");
    // 142 entries in 2.31, one of them listed twice.
    expect(game.length).toBeGreaterThanOrEqual(140);
    expect(game.every(entry => entry.clip?.decodable)).toBe(true);
    expect(catalogue.categories.slice(0, 3).map(category => category.id)).toEqual(["PhotoModePoseCategories.idleCategory",
      "PhotoModePoseCategories.actionCategory", "PhotoModePoseCategories.naturalCategory"]);
    const host = new PoseCatalogueHost({ route: () => route, fingerprint: () => "oracle", resolverCache: cacheDir, language: () => "en-us" });
    const sample = await host.sample("female", "PhotoModePoses.idle_stand_01");
    expect(sample?.joints.length).toBe(71);
    expect(sample?.joints.find(joint => joint.bone === "Hips")!.translation[2]).toBeGreaterThan(0.9);
  }, LONG);
});
