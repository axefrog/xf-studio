// Opt-in oracle: the body idle read natively (idle-host.ts) against the developer preparation's files (Python `prepare_idle.py` and
// `prepare_body_idles.py`, which export each clip through WolvenKit), on a real, read-only installation. Enable with XFS_RESOLVER_GAME_ROOT
// and XFS_IDLE_PREPARED_ASSETS (the folder holding `cc-idle-catalogue.json`, `cc-idle-binding.json` and the `cc-idle-body*.glb` files);
// optional XFS_RESOLVER_CACHE. CI has neither, so it is skipped there. The comparison itself is tools/native-idle-oracle.ts.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { installations } from "../src/installation-registry";
import { compareIdles } from "../tools/native-idle-oracle";
import { oracleDescribe } from "./optional-oracles";

const env = process.env;
const assets = env.XFS_IDLE_PREPARED_ASSETS ? resolve(env.XFS_IDLE_PREPARED_ASSETS) : null;
const available = !!env.XFS_RESOLVER_GAME_ROOT && existsSync(env.XFS_RESOLVER_GAME_ROOT) && process.platform === "win32" && !!assets
  && existsSync(resolve(assets, "cc-idle-catalogue.json"));

oracleDescribe(available, "the native idle oracle needs XFS_RESOLVER_GAME_ROOT (a Windows game install) and XFS_IDLE_PREPARED_ASSETS (a developer preparation's idle files).")(
  "the native body idle against the prepared one", () => {
    test("same catalogue and ancestry; every clip's keys, rest and joints' world poses within the stated tolerances", async () => {
      const cacheDir = resolve(env.XFS_RESOLVER_CACHE ?? resolve(import.meta.dir, "..", "data", "resolver-cache"));
      const installation = await installations.acquire({ gameRoot: resolve(env.XFS_RESOLVER_GAME_ROOT!), wolvenKitCli: null, launchRoute: "direct", mo2Root: null,
        mo2ProfileId: null, manualModRoot: null, cacheDir });
      const report = await compareIdles(installation, assets!);
      expect(report.catalogue.differences).toEqual([]);
      expect(report.catalogue.left.native).toEqual(report.catalogue.left.prepared);
      expect(report.ancestry.differences).toEqual([]);
      expect(report.clips.length).toBeGreaterThanOrEqual(1);
      for (const clip of report.clips) {
        // The rest: float32 rounding. Keys: the sample's 1e-6 rounding over float32 values. World: well under a hundredth of a millimetre.
        expect(Math.max(clip.restTranslation, clip.restRotation, clip.restScale)).toBeLessThan(1e-6);
        expect(clip.translation).toBeLessThan(1e-6);
        expect(clip.rotation).toBeLessThan(5e-6);
        expect(clip.scale).toBeLessThan(1e-6);
        expect(clip.worldMillimetres).toBeLessThan(0.01);
        expect(clip.worldDegrees).toBeLessThan(0.01);
      }
    }, 10 * 60_000);
  });
