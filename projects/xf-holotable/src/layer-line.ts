/** One line/field validation path for publishing, ingestion and the read-only validator. */
import { LAYER_BOUNDS, normalizeDetail, validateManifest, validateRecord, type LayerManifest, type LayerRecord } from "./layers.ts";
export const ITEM_LIMIT_REASON = "This layer already has 5,000 items; split it (for example by district).";
export function layerLine(input: unknown, manifest?: LayerManifest, identity?: string): { row?: LayerManifest | LayerRecord; text?: string; reason?: string; blank?: boolean } {
  let text: string;
  try { text = typeof input === "string" ? input : JSON.stringify(input); } catch { return { reason: "Line is not valid JSON." }; }
  if (typeof text !== "string") return { reason: "Line is not valid JSON." };
  if (Buffer.byteLength(text) > 1024 * 1024) return { reason: "Item line exceeds 1 MB." };
  if (!text.trim()) return { blank: true };
  let row: unknown;
  try { row = JSON.parse(text); } catch { return { reason: "Line is not valid JSON." }; }
  if (manifest && row && typeof row === "object" && "detail" in row && typeof row.detail === "string") row.detail = normalizeDetail(row.detail);
  const reason = manifest ? validateRecord(row, manifest) : validateManifest(row, identity);
  return reason ? { reason } : { row: row as LayerManifest | LayerRecord, text: JSON.stringify(row) };
}
export function admitId(record: LayerRecord, ids: Set<string>): boolean {
  const id = "retract" in record ? record.retract : record.id;
  if (!ids.has(id) && ids.size >= LAYER_BOUNDS.items) return false;
  ids.add(id); return true;
}
