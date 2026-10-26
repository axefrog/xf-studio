// Read-only validation of producer output, shared by CLI tests and integration writers.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LAYER_BOUNDS, type LayerData, type LayerManifest, type LayerRecord } from "./layers.ts";
import { admitId, ITEM_LIMIT_REASON, layerLine } from "./layer-line.ts";
import { setConflict } from "./layer-timelines.ts";

export function validateFiles(path: string): { file: string; line: number; reason: string }[] {
  const errors: { file: string; line: number; reason: string }[] = [], layers: LayerData[] = [];
  const files = (p: string): string[] => statSync(p).isDirectory() ? readdirSync(p, { withFileTypes: true }).filter(d => !d.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name)).flatMap(d => d.isDirectory() || d.name.endsWith(".jsonl") ? files(join(p, d.name)) : []) : [p];
  if (!existsSync(path)) return [{ file: path, line: 1, reason: "File or folder does not exist." }];
  for (const file of files(path)) {
    if (statSync(file).size > LAYER_BOUNDS.bytes) { errors.push({ file, line: 1, reason: "Spool exceeds 16 MB." }); continue; }
    const text = readFileSync(file, "utf8"), lines = text.split("\n"); let manifest: LayerManifest | undefined; const records: LayerRecord[] = [], ids = new Set<string>();
    lines.forEach((line, i) => {
      const parsed = layerLine(line, manifest);
      if (parsed.reason) { errors.push({ file, line: i + 1, reason: parsed.reason }); return; }
      if (parsed.blank) return;
      const row = parsed.row!;
      if (!manifest) {
        manifest = row as LayerManifest;
        const conflict = setConflict(manifest, layers); if (conflict) errors.push({ file, line: i + 1, reason: conflict });
      } else {
        if (!admitId(row as LayerRecord, ids)) errors.push({ file, line: i + 1, reason: ITEM_LIMIT_REASON });
        else records.push(row as LayerRecord);
      }
    });
    if (!manifest) errors.push({ file, line: 1, reason: "File needs a manifest first." });
    else layers.push({ manifest, records, refused: 0, reason: "" });
    if (text && !text.endsWith("\n")) errors.push({ file, line: lines.length, reason: "Last line is unfinished; end each JSON line with a newline." });
  }
  return errors;
}
