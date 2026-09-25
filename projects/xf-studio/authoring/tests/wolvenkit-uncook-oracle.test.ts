// Opt-in oracle against a real, read-only game install (PIPE-60): for each accepted WolvenKit version, the resolver's one-launch route
// (`uncook -u -s`) must store the same JSON as extract-then-convert (`unbundle` then `convert s`) once the converter's temporary
// `Header.ArchiveFileName` is removed. WolvenKit writes only into a temporary folder. Enable with:
//   XFS_RESOLVER_GAME_ROOT and XFS_WOLVENKIT_CLI (several CLIs separated by `;`, one per accepted version).
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildMountPlan, DepotIndex, type ArchiveFile } from "../src/archive-precedence";
import { depotHash } from "../src/depot-path";
import { depotPathRegex } from "../src/eye-plate-wolvenkit";
import { readArchiveIndex, trimBuffers, withoutArchiveFileName } from "../src/resolver-host";
import { runWolvenKit, SUPPORTED_WOLVENKIT_VERSIONS, wolvenKitIdentity } from "../src/wolvenkit-cli";
import { oracleDescribe } from "./optional-oracles";

const env = process.env;
const game = env.XFS_RESOLVER_GAME_ROOT ? resolve(env.XFS_RESOLVER_GAME_ROOT) : "";
const clis = (env.XFS_WOLVENKIT_CLI ?? "").split(";").map(path => path.trim()).filter(path => path && existsSync(path));
const available = !!game && existsSync(join(game, "archive", "pc", "content")) && clis.length > 0;

/** One small vanilla resource of each kind the character details read. */
const RESOURCES = [
  "base\\characters\\common\\eyes\\blue_eye_gradient_light.mi",
  "base\\characters\\common\\hair\\shadow_meshes\\hh_090_wa__alt_shadow_npc.mesh",
  "base\\characters\\head\\player_base_heads\\appearances\\hairs\\fpp\\hh_004_pwa__hairs_090_fpp.app",
  "base\\characters\\head\\player_base_heads\\appearances\\entity\\head\\ht_000_pma__basehead.ent",
  "base\\characters\\common\\player_base_bodies\\player_female_average\\arms_hq\\nails\\a0_000_pwa_base__nails_l.morphtarget",
  "base\\characters\\common\\character_customisation_items\\earrings\\textures\\i1_000_pma_c__basehead_earring_01_plastic_black.mlsetup",
  "engine\\textures\\small_flat_normal.xbm",
];

oracleDescribe(available, "the uncook oracle needs XFS_RESOLVER_GAME_ROOT and XFS_WOLVENKIT_CLI (a real game install, read-only).")("uncook -u -s against extract and convert (PIPE-60)", () => {
  const content = join(game, "archive", "pc", "content");
  for (const cli of clis) {
    const version = wolvenKitIdentity(cli)?.version ?? "unknown";
    const accepted = (SUPPORTED_WOLVENKIT_VERSIONS as readonly string[]).includes(version);
    // A WolvenKit XF Studio doesn't accept is not compared (the resolver refuses it anyway).
    (accepted ? test : test.skip)(`WolvenKit ${version}: the same JSON by either route`, async () => {
      const work = mkdtempSync(join(tmpdir(), "xfs-uncook-oracle-"));
      try {
        const files: ArchiveFile[] = readdirSync(content).filter(name => name.endsWith(".archive")).map(name => ({ id: join(content, name),
          virtualPath: `archive/pc/content/${name}`, provider: "game", providerName: "Installed game", active: true, priority: null }));
        const plan = buildMountPlan(files, null);
        const depot = new DepotIndex(plan, new Map(plan.archives.map(archive => [archive.id, readArchiveIndex(archive.id, join(work, "index"))])));
        for (const path of RESOURCES) {
          const archive = depot.lookup(depotHash(path)).winner;
          expect(archive, path).not.toBeNull();
          const pattern = `(?i)${depotPathRegex([path])}`;
          const uncooked = join(work, "uncook"), raw = join(work, "raw");
          await runWolvenKit(cli, ["uncook", archive!.id, "-o", uncooked, "-r", pattern, "-u", "-s", "-v", "Minimal"], { timeoutMs: 300_000, keep: 16_000 });
          await runWolvenKit(cli, ["unbundle", archive!.id, "-o", raw, "-r", pattern], { timeoutMs: 300_000, keep: 16_000 });
          await runWolvenKit(cli, ["convert", "s", raw], { timeoutMs: 300_000, keep: 16_000 });
          const json = (root: string) => {
            const file = join(root, ...path.split("\\")) + ".json";
            expect(existsSync(file) && statSync(file).isFile(), `${path} under ${root}`).toBe(true);
            const document = withoutArchiveFileName(trimBuffers(JSON.parse(readFileSync(file, "utf8")))) as { Header?: Record<string, unknown> };
            // When each route ran is the only other difference.
            delete document.Header?.ExportedDateTime;
            return document;
          };
          expect(json(uncooked), path).toEqual(json(raw));
          rmSync(uncooked, { recursive: true, force: true }); rmSync(raw, { recursive: true, force: true });
        }
      } finally { rmSync(work, { recursive: true, force: true }); }
    }, 600_000);
  }
});
