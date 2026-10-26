/** Text layout is independent of marker drawing: hiding a label never removes its pick target. */
import type { AgentItem, AgentLayer } from "../agent-types";

export interface AgentLabel {
  key: string; text: string; x: number; y: number; priority: number;
  colour: string; alpha: number; caption?: boolean; overlay?: boolean; align?: "end";
}
export interface PlacedLabel extends AgentLabel { width: number }
export interface LabelBounds { x: number; y: number; width: number }

export function labelPriority(item: AgentItem, important: ReadonlySet<string>): number {
  return important.has(item.key) ? 0 : item.kind === "actor" ? 1 : ["target", "point"].includes(item.kind) ? 2 : item.kind === "relation" ? 3 : 4;
}
export function labelContext(items: readonly AgentItem[], selected: string | null, hovered: string | null): Set<string> {
  const keys = new Set([selected, hovered].filter((k): k is string => !!k));
  for (const item of items) if (item.links && (keys.has(item.key) || item.links.from === selected || item.links.to === selected || item.links.from === hovered || item.links.to === hovered)) {
    keys.add(item.links.from); keys.add(item.links.to);
  }
  return keys;
}
export function actorCaption(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 28 ? line.slice(0, 27).trimEnd() + "…" : line;
}
/** Greedy, deterministic label culling. Important labels displace ordinary text by being placed first. */
export function placeLabels(candidates: readonly AgentLabel[], measure: (text: string) => number, width: number, height: number, cap = 40, reserved: readonly LabelBounds[] = []): PlacedLabel[] {
  const placed: PlacedLabel[] = [], names = new Set<string>();
  if (width < 8 || height < 18) return placed;
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority || Number(!!a.caption) - Number(!!b.caption) || a.key.localeCompare(b.key));
  for (const candidate of ordered) {
    if (placed.length >= cap) break;
    if (candidate.caption && !names.has(candidate.key)) continue;
    let value = candidate.text, size = measure(value);
    if (size > width - 8) {
      const chars = Array.from(value); let low = 0, high = chars.length;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (measure(chars.slice(0, mid).join("") + "…") <= width - 8) low = mid; else high = mid - 1; }
      value = chars.slice(0, low).join("") + "…"; size = measure(value);
    }
    const x = Math.max(4, Math.min(width - size - 4, candidate.x - (candidate.align === "end" ? size : 0))), y = Math.max(14, Math.min(height - 4, candidate.y));
    const overlaps = (p: LabelBounds) => x < p.x + p.width + 4 && x + size + 4 > p.x && y - 12 < p.y + 3 && y + 3 > p.y - 12;
    if (size > width - 8 || reserved.some(overlaps) || placed.some(overlaps)) continue;
    placed.push({ ...candidate, text: value, x, y, width: size });
    if (!candidate.caption) names.add(candidate.key);
  }
  return placed;
}

export function itemTitle(item: AgentItem, items: readonly AgentItem[], owner?: string): string {
  if (item.kind !== "relation") return item.value?.name ?? item.label ?? item.kind;
  const incoming = owner !== undefined && item.links?.to === owner && item.links.from !== owner;
  const end = items.find(i => i.key === (incoming ? item.links?.from : item.links?.to));
  const name = end ? end.value?.name ?? end.label ?? end.kind : "unplaced item", type = item.value?.type ?? "Relation";
  return item.value?.mutual ? `${type} ↔ ${name}` : incoming ? `${name} → ${type}` : `${type} → ${name}`;
}
export function layerCounts(layer: AgentLayer): string {
  return [`${layer.items.length} ${layer.items.length === 1 ? "item" : "items"}`, layer.refused ? `${layer.refused} refused` : "", layer.notPlaced.length ? `${layer.notPlaced.length} not placed` : "", layer.otherBranches.length ? `${layer.otherBranches.length} on other branches` : ""].filter(Boolean).join(" · ");
}
export function gameSpan(seconds: number): string {
  const hours = Math.floor(Math.max(0, seconds) / 3600), days = Math.floor(hours / 24), remainder = hours % 24;
  return [days ? `${days} ${days === 1 ? "day" : "days"}` : "", remainder ? `${remainder} h` : ""].filter(Boolean).join(" ") || "<1 h";
}
