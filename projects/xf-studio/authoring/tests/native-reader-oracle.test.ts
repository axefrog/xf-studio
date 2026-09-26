// Opt-in oracle for the native archive and CR2W reader against WolvenKit CLI on a real, read-only game install. WolvenKit writes only
// into a temporary folder. Enable with XFS_RESOLVER_GAME_ROOT and XFS_WOLVENKIT_CLI (the first CLI of a `;` list is used), as the
// other resolver oracles; under XFS_REQUIRE_ORACLES=1 a missing prerequisite fails instead of skipping.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { depotHash } from "../src/depot-path";
import { depotPathRegex } from "../src/eye-plate-wolvenkit";
import { NativeArchive } from "../src/native/archive-reader";
import { compareDocuments, isNameOnly } from "../src/native/document-diff";
import { loadGameOodle } from "../src/native/oodle";
import { readResourceJson } from "../src/native/resource-document";
import { trimBuffers } from "../src/resolver-host";
import { runWolvenKit } from "../src/wolvenkit-cli";
import { oracleDescribe } from "./optional-oracles";

const env = process.env;
const game = env.XFS_RESOLVER_GAME_ROOT ? resolve(env.XFS_RESOLVER_GAME_ROOT) : "";
const cli = (env.XFS_WOLVENKIT_CLI ?? "").split(";").map(path => path.trim()).find(path => path && existsSync(path)) ?? "";
const available = process.platform === "win32" && !!game && existsSync(join(game, "bin", "x64", "oo2ext_7_win64.dll")) && !!cli;
const content = join(game, "archive", "pc", "content");

/** One resource of each type the resolver reads natively, from the installed game. */
const RESOURCES = [
  "base\\characters\\common\\eyes\\blue_eye_gradient_light.mi",
  "base\\characters\\common\\hair\\shadow_meshes\\hh_090_wa__alt_shadow_npc.mesh",
  "base\\characters\\head\\player_base_heads\\player_man_average\\h0_000_pma_c__basehead\\i1_000_pma_c__basehead_earring_01.mesh",
  "base\\characters\\head\\player_base_heads\\appearances\\hairs\\fpp\\hh_004_pwa__hairs_090_fpp.app",
  "base\\characters\\head\\player_base_heads\\appearances\\entity\\head\\ht_000_pma__basehead.ent",
  "base\\characters\\head\\player_base_heads\\player_female_average\\i1_000_pwa__morphs_earring_04.morphtarget",
  "base\\characters\\common\\eyes\\textures\\he_000_base_splash.mlsetup",
  "base\\surfaces\\materials\\terrain\\grass\\grass_dry\\grass_dry_01.mltemplate",
  "base\\characters\\common\\hair\\textures\\hair_profiles\\black_salt_n_pepper.hp",
  "base\\vehicles\\common\\materials\\vehicle_modding_destruction.mt",
  "base\\gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization",
  "engine\\textures\\small_flat_normal.xbm",
];

const walk = (root: string, folder = root, out = new Map<string, string>()) => {
  for (const name of readdirSync(folder)) {
    const full = join(folder, name);
    if (lstatSync(full).isDirectory()) { walk(root, full, out); continue; }
    const rel = relative(root, full).split(sep).join("\\");
    const numeric = /^(\d+)\.[^.\\]+$/.exec(rel);
    out.set(numeric ? BigInt(numeric[1]!).toString() : rel.endsWith(".json") ? `json:${depotHash(rel.slice(0, -5))}` : depotHash(rel), full);
  }
  return out;
};

oracleDescribe(available, "the native reader oracle needs XFS_RESOLVER_GAME_ROOT (with the game's Oodle library) and XFS_WOLVENKIT_CLI (read-only).")("native reader against WolvenKit", () => {
  test("the extracted bytes of 60 spread entries per archive equal WolvenKit's unbundle output", async () => {
    const oodle = loadGameOodle(game);
    const work = mkdtempSync(join(tmpdir(), "xfs-native-oracle-"));
    try {
      for (const name of ["basegame_4_appearance.archive", "basegame_1_engine.archive"]) {
        const archive = NativeArchive.open(join(content, name), oodle.decompress);
        try {
          const stride = Math.floor(archive.index.fileCount / 60);
          const picked = Array.from(archive.index.hashes, hash => hash.toString()).filter((_, i) => i % stride === 0).slice(0, 60);
          writeFileSync(join(work, "hashes.txt"), picked.join("\n") + "\n");
          const out = join(work, name);
          await runWolvenKit(cli, ["unbundle", archive.path, "-o", out, "--hash", join(work, "hashes.txt")], { timeoutMs: 600_000, keep: 16_000 });
          const written = walk(out);
          for (const hash of picked) {
            const file = written.get(hash);
            expect(file, `${name} ${hash}`).toBeDefined();
            const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
            expect(sha(archive.read(hash)!), `${name} ${hash}`).toBe(sha(readFileSync(file!)));
          }
        } finally { archive.close(); }
      }
    } finally { oodle.close(); rmSync(work, { recursive: true, force: true }); }
  }, 600_000);

  test("the JSON of one resource per type equals WolvenKit's `uncook -s` output (hash-only names aside)", async () => {
    const oodle = loadGameOodle(game);
    const work = mkdtempSync(join(tmpdir(), "xfs-native-oracle-json-"));
    const archives = readdirSync(content).filter(name => /^basegame_.*\.archive$/.test(name)).map(name => join(content, name));
    try {
      await runWolvenKit(cli, ["uncook", ...archives, "-o", work, "-r", `(?i)${depotPathRegex(RESOURCES)}`, "-u", "-s", "-v", "Minimal"], { timeoutMs: 600_000, keep: 16_000 });
      const written = walk(work);
      const opened = archives.map(path => NativeArchive.open(path, oodle.decompress));
      try {
        for (const path of RESOURCES) {
          const hash = depotHash(path), json = written.get(`json:${hash}`);
          expect(json, path).toBeDefined();
          const bytes = opened.map(archive => archive.read(hash)).find(found => found);
          expect(bytes, path).toBeTruthy();
          const reference = trimBuffers(JSON.parse(readFileSync(json!, "utf8"))) as { Data: unknown };
          const mismatches = compareDocuments(readResourceJson(bytes!, oodle.decompress).Data, reference.Data).filter(item => !isNameOnly(item));
          expect(mismatches.slice(0, 5), path).toEqual([]);
        }
      } finally { for (const archive of opened) archive.close(); }
    } finally { oodle.close(); rmSync(work, { recursive: true, force: true }); }
  }, 600_000);
});
