// Asset-free provenance and exact plate-to-head mapping, using the native reader.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { NativeArchive } from "../../projects/xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { readResourceJson } from "../../projects/xf-studio/authoring/src/native/resource-document";
import { depotHash } from "../../projects/xf-studio/authoring/src/game/depot-path";
import { selectPlate } from "../../projects/xf-studio/authoring/src/legacy/eye-makeup/plate/eye-plate-cut";
import { EYE_PLATE_RECIPE } from "../../projects/xf-studio/authoring/src/legacy/eye-makeup/plate/eye-plate-recipe";

const [game, output] = process.argv.slice(2);
if (!game || !output) throw Error("Usage: bun snapshot.ts PATH_TO_GAME RUN_OUTPUT");
const oodle = loadGameOodle(game);
const content = join(game, "archive/pc/content");
const archives = readdirSync(content).filter(p => p.endsWith(".archive")).sort().map(p => NativeArchive.open(join(content, p), oodle.decompress));
try {
  const walk = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]);
  const wanted = new Set<string>([EYE_PLATE_RECIPE.source.meshDepotPath, EYE_PLATE_RECIPE.source.morphDepotPath]);
  const files = walk(output);
  const entries = files.filter(p => p.endsWith("entry.json")).map(path => ({ path, entry: JSON.parse(readFileSync(path, "utf8")) }));
  for (const { entry } of entries) if (entry.depotPath) wanted.add(entry.depotPath);
  const source = [...wanted].sort().map(path => {
    const matches = archives.filter(a => a.index.hashes.includes(BigInt(depotHash(path))));
    return { depotPath: path, archives: matches.map(a => relative(game, a.path).replaceAll("\\", "/")),
      resourceSha256: matches.map(a => createHash("sha256").update(a.read(depotHash(path))!).digest("hex")) };
  });
  const headArchive = archives.find(a => a.index.hashes.includes(BigInt(depotHash(EYE_PLATE_RECIPE.source.meshDepotPath))))!;
  const head = readResourceJson(headArchive.read(depotHash(EYE_PLATE_RECIPE.source.meshDepotPath))!, oodle.decompress, { buffers: "base64" });
  let mapping: unknown = null, mappingError: string | null = null;
  try {
    const selection = selectPlate((head.Data.RootChunk as any).renderResourceBlob.Data, EYE_PLATE_RECIPE);
    mapping = { plateVertexToHeadVertex: selection.vertexIds, headFaceIds: selection.faceIds,
      plateTriangles: Array.from(selection.faces), recipeVertexIdsSha256: EYE_PLATE_RECIPE.selection.vertexIdsSha256 };
  } catch (error) { mappingError = String(error); }
  const prepared = entries.map(({ path, entry }) => ({ key: relative(join(output, "preview/exports"), path).replaceAll("\\", "/").replace(/\/entry.json$/, ""),
    depotPath: entry.depotPath, sourceKey: entry.source, files: entry.files,
    archives: source.find(s => s.depotPath === entry.depotPath)?.archives ?? [] }));
  writeFileSync(join(output, "provenance.json"), JSON.stringify({ source, prepared, mapping, mappingError }, null, 2) + "\n");
} finally { for (const archive of archives) archive.close(); oodle.close(); }
