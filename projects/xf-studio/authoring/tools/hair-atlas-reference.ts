/**
 * Offline, read-only base-game reference for the strand-atlas probe. No browser or game launch.
 * bun tools/hair-atlas-reference.ts PATH_TO_SETTINGS_JSON [PATH_TO_IGNORED_OUTPUT]
 * Native reader only, no WolvenKit fallback. All outputs are private and ignored.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { openNativeReader, inProcessDecoder } from "../src/native/native-fetch-port";
import { openInstallation } from "../src/resolver-host";
import { loadMergedCco, resolveCharacter } from "../src/character-resolver";
import { descriptorsFromUiState } from "../src/cco-model";
import { refFromPath } from "../src/depot-path";
import { readCr2w } from "../src/native/cr2w-reader";
import { DecodeSession } from "../src/native/limits";
import { TEXTURE_READ_LIMITS } from "../src/native/texture-decode";
import { textureLayout } from "../src/native/xbm-texture";

const [settingsFile, output = "build/hair-lab-wip"] = process.argv.slice(2);
if (!settingsFile) throw Error("Usage: hair-atlas-reference.ts PATH_TO_SETTINGS_JSON [PATH_TO_IGNORED_OUTPUT]");
const out = resolve(output);
// Never accidentally put decoded game content into a tracked folder.
if (!out.replaceAll("\\", "/").includes("/build/")) throw Error("Reference output must be in an ignored build folder.");
const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as { gameRoot: string };
const opened = openNativeReader(settings.gameRoot); if (!opened.reader) throw Error(opened.reason);
const decoder = inProcessDecoder(opened.reader);
try {
  if (!decoder.decodeTexture) throw Error("Native texture decoding is unavailable.");
  mkdirSync(out, { recursive: true });
  const installation = openInstallation({ gameRoot: settings.gameRoot, launchRoute: "direct", baseOnly: true,
    wolvenKitCli: null, cacheDir: join(out, "atlas-reference-cache"), native: { decoder, strict: true } });
  const cco = await loadMergedCco(installation.graph, "female");
  const input = descriptorsFromUiState(cco.merged.cco, { hair: "01" });
  const result = await resolveCharacter(installation.graph, { bodyGender: "female", origin: "ui-state",
    appearances: input.appearances.filter(a => /hair/.test(a.option)), morphs: [] }, cco);
  const material = result.appearances.flatMap(a => a.components).flatMap(c => c.materials)
    .find(m => m.params.some(p => p.name === "Strand_Alpha"));
  if (!material) throw Error("Base-game hairstyle 01 has no resolved strand material.");
  const provenance: object[] = [];
  for (const param of material.params.filter(p => ["Strand_Alpha", "Strand_ID", "Strand_Gradient", "Flow", "HairProfile"].includes(p.name))) {
    if (!param.resource) throw Error(`Unresolved reference input ${param.name}.`);
    if (param.name === "HairProfile") {
      const profile = await installation.graph.load(refFromPath(param.value), "hp");
      if (!profile) throw Error("Reference hair profile could not be read.");
      writeFileSync(join(out, "atlas-vanilla-profile.json"), JSON.stringify(profile.root, null, 2));
      continue;
    }
    const winner = installation.depot.lookup(param.resource.ref.hash).winner;
    if (!winner) throw Error(`Reference input ${param.name} has no archive winner.`);
    const decoded = await decoder.decodeTexture({ archivePath: winner.id, hash: param.resource.ref.hash, maxSide: 2048 });
    if (!decoded.ok) throw Error(decoded.message);
    const { png, ...metadata } = decoded.texture;
    const resource = opened.reader.pool.read(winner.id, param.resource.ref.hash);
    if (!resource) throw Error("Reference texture disappeared.");
    const layout = textureLayout(readCr2w(resource, opened.reader.decompress, new DecodeSession(TEXTURE_READ_LIMITS)));
    writeFileSync(join(out, `atlas-vanilla-${param.name}.png`), png);
    provenance.push({ name: param.name, path: param.value, archive: winner.name, hash: param.resource.ref.hash, ...metadata,
      compression: layout.compression, mipCount: layout.mips.length, lastMip: layout.mips.at(-1), mipTable: layout.mipTable });
  }
  const evidence = { route: "base-only", option: "01", material: material.name,
    alphaCutoff: Number(material.params.find(p => p.name === "AlphaCutoff")?.value ?? .33),
    nativeIdentity: opened.reader.identity, textures: provenance };
  writeFileSync(join(out, "atlas-vanilla-provenance.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { decoder.close(); }
