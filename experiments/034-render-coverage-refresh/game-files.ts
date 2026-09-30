/**
 * Experiment 034 helpers: read base-game resources straight from the installed archives with XF Studio's own readers (native archive
 * reader, resource reader), as experiment 031 does. Read-only towards the game; nothing is written.
 */
import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { depotHash } from "../../projects/xf-studio/authoring/src/depot-path";
import { NativeArchive } from "../../projects/xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { readResource } from "../../projects/xf-studio/authoring/src/native/resource-document";
import { configuredGameRoot } from "../../projects/xf-studio/authoring/tools/configured-game-root";

const BS = String.fromCharCode(92);
/** A depot path written with forward slashes, as the game stores it (backslashes). */
export const depot = (path: string) => path.split("/").join(BS);

export const PATHS = {
  skeleton: depot("base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead_skeleton.rig"),
  female: depot("base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead_rigsetup.facialsetup"),
  male: depot("base/characters/head/pma/h0_001_ma_c__player/h0_001_ma_c__player_rigsetup.facialsetup"),
  uiFace: depot("base/animations/ui/female/ui_female_face.anims"),
  teeth: depot("base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/ht_000_pwa_c__basehead.mesh"),
  head: depot("base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead.mesh"),
} as const;

export function openGame(gameArg?: string | null) {
  const game = gameArg ?? configuredGameRoot();
  const oodle = loadGameOodle(game);
  const dirs = [join(game, "archive", "pc", "content"), join(game, "archive", "pc", "ep1")];
  const files = dirs.flatMap(dir => { try { return readdirSync(dir).filter(n => n.endsWith(".archive")).map(n => join(dir, n)); } catch { return []; } });
  const opened = new Map<string, NativeArchive>();
  function raw(path: string): { bytes: Uint8Array; archive: string; sha256: string } {
    const hash = depotHash(path);
    for (const file of files) {
      let archive = opened.get(file);
      if (!archive) { archive = NativeArchive.open(file, oodle.decompress); opened.set(file, archive); }
      const bytes = archive.read(hash);
      if (bytes) return { bytes, archive: file.slice(game.length + 1), sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    throw Error(`${path} is not in the base archives`);
  }
  const doc = (path: string) => { const r = raw(path); return { ...r, document: readResource(r.bytes, oodle.decompress, { buffers: "trim" }).document as any }; };
  return { game, oodle, raw, doc };
}
