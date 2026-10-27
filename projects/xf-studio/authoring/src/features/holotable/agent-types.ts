/** Structural subsets of the headless agent-layer protocol; no dependency on another feature or host. */
import type { Vec3 } from "./types";
export type AgentAnchor = { at: Vec3 } | { entity: string } | { item: string } | { region: string } | { path: readonly Vec3[] } | { zone: { poly: readonly (readonly [number, number])[]; zlo: number; zhi: number } } | { box: { min: Vec3; max: Vec3 } } | { sphere: { at: Vec3; r: number } } | { grid: { origin: Vec3; cell: number; cols: number; rows: number } };
export interface AgentItem {
  id: string; key: string; version?: number; kind: string; t?: number; until?: number; anchor: AgentAnchor; resolvedAnchor?: AgentAnchor; place?: Vec3; to?: Vec3;
  value?: { name?: string; role?: string; facets?: Record<string, string>; type?: string; strength?: number; mutual?: boolean; scalars?: readonly number[]; vectors?: readonly (readonly [number, number])[]; from?: AgentAnchor; to?: AgentAnchor };
  glyph?: string; badge?: string; label?: string; detail?: string; facets?: Record<string, string>; tone?: string; weight?: number; cite?: string; relations?: string[]; region?: { id: string; name: string; kind: string };
  toRegion?: { id: string; name: string; kind: string }; toResolvedAnchor?: AgentAnchor; links?: { from: string; to: string };
}
export interface AgentLayer { id: string; title: string; producer: string; producer_title?: string; facet_titles?: Readonly<Record<string, string>>; layer: string; items: readonly AgentItem[]; total?: number; changes?: readonly number[]; refused: number; reason: string; notPlaced: readonly string[]; otherBranches: readonly string[] }
export interface HereGroup { layer: string; title: string; items: readonly { item: AgentItem; distance: number; sample?: number | readonly [number, number] }[] }
export interface AgentAnswer { layers: readonly AgentLayer[]; here: readonly HereGroup[]; specs: { schema: string; tones?: Readonly<Record<string, string>>; kinds: Readonly<Record<string, { style: string; label: string; draw: string }>> } }
