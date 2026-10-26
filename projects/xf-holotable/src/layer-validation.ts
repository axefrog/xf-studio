// Read-only validation of producer output, shared by CLI tests and integration writers.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LAYER_BOUNDS, validateManifest, validateRecord, type LayerData, type LayerManifest, type LayerRecord } from "./layers.ts";
import { withinItemBudget } from "./layer-spool.ts";
import { setConflict } from "./layer-timelines.ts";

export function validateFiles(path: string): { file: string; line: number; reason: string }[] {
  const errors: { file: string; line: number; reason: string }[] = [], layers: LayerData[] = [];
  const files = (p: string): string[] => statSync(p).isDirectory() ? readdirSync(p, { withFileTypes: true }).filter(d => !d.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name)).flatMap(d => d.isDirectory() || d.name.endsWith(".jsonl") ? files(join(p, d.name)) : []) : [p];
  if (!existsSync(path)) return [{ file: path, line: 1, reason: "File or folder does not exist." }];
  for (const file of files(path)) {
    if (statSync(file).size > LAYER_BOUNDS.bytes) { errors.push({ file, line: 1, reason: "Spool exceeds 16 MB." }); continue; }
    const text = readFileSync(file, "utf8"), lines = text.split("\n"); let manifest: LayerManifest | undefined; const records: LayerRecord[] = [];
    lines.forEach((line, i) => {
      if (Buffer.byteLength(line) > 1024 * 1024) { errors.push({ file, line: i + 1, reason: "Item line exceeds 1 MB." }); return; }
      if (!line.trim()) return;
      let row: unknown; try { row = JSON.parse(line); } catch { errors.push({ file, line: i + 1, reason: "Line is not valid JSON." }); return; }
      const reason = manifest ? validateRecord(row, manifest) : validateManifest(row);
      if (reason) { errors.push({ file, line: i + 1, reason }); return; }
      if (!manifest) {
        manifest = row as LayerManifest;
        const conflict = setConflict(manifest, layers); if (conflict) errors.push({ file, line: i + 1, reason: conflict });
      } else {
        records.push(row as LayerRecord);
        if (!withinItemBudget(records, manifest)) { errors.push({ file, line: i + 1, reason: "Layer exceeds 5,000 live items." }); records.pop(); }
      }
    });
    if (!manifest) errors.push({ file, line: 1, reason: "File needs a manifest first." });
    else layers.push({ manifest, records, refused: 0, reason: "" });
    if (text && !text.endsWith("\n")) errors.push({ file, line: lines.length, reason: "Last line is unfinished; end each JSON line with a newline." });
  }
  return errors;
}
