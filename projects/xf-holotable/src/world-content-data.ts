/** W1 transport: only verified fields cross the sector worker/cache boundary. No engine objects escape. */
import { RedHandle, RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import type { readStreamingSectorContent } from "../../xf-studio/authoring/src/native/streaming-sector";
import type { Vec3 } from "./model.ts";

export const CONTENT_SECTOR_VERSION = 101;
export const CONTENT_BYTES_LIMIT = 32 * 1024 * 1024;
export const object = (v: unknown): Record<string, unknown> => v instanceof RedHandle ? object(v.target) : v instanceof RedObject ? v.fields : {};
export const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export const text = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v : v && typeof v === "object" && "$value" in v ? String(v.$value) : undefined;
  return s && s !== "None" && s !== "0" ? s : undefined;
};
export const hash = (v: unknown) => text(object(v).hash);
export const reference = (v: unknown) => v && typeof v === "object" && "DepotPath" in v ? text(v.DepotPath) : undefined;
export const vector = (v: unknown): Vec3 | undefined => {
  const f = object(v), p: Vec3 = [Number(f.X ?? 0), Number(f.Y ?? 0), Number(f.Z ?? 0)];
  return v instanceof RedObject && p.every(Number.isFinite) ? p : undefined;
};
export interface SourcePhase { name?: string; periods: { name?: string; spots: string[] }[] }
export interface SourceEntry { name?: string; record?: string; phases: SourcePhase[] }
export interface RegistryItem { id?: string; entries: { name?: string; record?: string }[] }
export interface ContentNode {
  nodeIndex: number; type: string; refusal?: string; name?: string; sourceId?: string;
  entries?: SourceEntry[]; registry?: RegistryItem[]; workspot?: string; record?: string; onStart?: boolean;
}
export interface ContentPlacement { index: number; nodeIndex: number; at: Vec3; orientation: [number, number, number, number]; ref: string }
export interface ContentSector { version: number; nodes: ContentNode[]; placements: ContentPlacement[]; variantIndices: number[]; persistentNodeIndex: number }

export function mapContentNode(nodeIndex: number, type: string, obj?: RedObject, refusal?: string): ContentNode {
  const f = object(obj), row: ContentNode = { nodeIndex, type, refusal, name: text(f.debugName) };
  if (type === "worldAISpotNode") row.workspot = reference(object(f.spot).resource);
  else if (type === "worldPopulationSpawnerNode") {
    row.record = text(f.objectRecordId);
    if (f.spawnOnStart !== undefined) row.onStart = Boolean(f.spawnOnStart);
  } else if (type === "worldCommunityRegistryNode") {
    row.registry = list(f.communitiesData).map(item => {
      const f = object(item);
      return { id: hash(object(f.communityId).entityId), entries: list(object(f.template).entries).map(e => {
        const f = object(e); return { name: text(f.entryName), record: text(f.characterRecordId) };
      }) };
    });
  } else {
    if (!(f.area instanceof RedHandle) || f.area.target?.type !== "communityArea") {row.refusal = refusal ?? "missing communityArea";return row;}
    row.sourceId = hash(f.sourceObjectId);
    row.entries = list(object(f.area).entriesData).map(e => {
      const f = object(e);
      return { name: text(f.entryName), phases: list(f.phasesData).map(p => {
        const f = object(p);
        return { name: text(f.entryPhaseName), periods: list(f.timePeriodsData).map(t => {
          const f = object(t); return { name: text(f.periodName), spots: list(f.spotNodeIds).map(hash).filter((s): s is string => !!s) };
        }) };
      }) };
    });
  }
  return row;
}
export function compactContentSector(s: ReturnType<typeof readStreamingSectorContent>): ContentSector {
  const wanted = new Set(s.nodes.map(n => n.nodeIndex));
  return { version: CONTENT_SECTOR_VERSION, nodes: s.nodes.map(n => mapContentNode(n.nodeIndex, n.type, n.object, n.refusal)),
    placements: s.placements.flatMap((p, index) => wanted.has(p.nodeIndex) ? [{ index, nodeIndex: p.nodeIndex, at: p.position, orientation: p.orientation, ref: p.questPrefabRefHash }] : []),
    variantIndices: s.variantIndices, persistentNodeIndex: s.persistentNodeIndex };
}
export function encodeContentSector(sector: ContentSector): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(sector));
  if (bytes.length > CONTENT_BYTES_LIMIT) throw new NativeBudgetError("Content sector exceeds 32 MiB.");
  return bytes;
}
export function decodeContentSector(bytes: Uint8Array): ContentSector {
  if (bytes.length > CONTENT_BYTES_LIMIT) throw new NativeBudgetError("Content sector exceeds 32 MiB.");
  let s: ContentSector;
  try {s=JSON.parse(new TextDecoder().decode(bytes)) as ContentSector;}catch{throw new NativeMalformedError("Invalid content-sector JSON.");}
  if (s?.version !== CONTENT_SECTOR_VERSION || !Array.isArray(s.nodes) || !Array.isArray(s.placements) || !Array.isArray(s.variantIndices)
    || s.nodes.length > 200_000 || s.placements.length > 200_000) throw new NativeMalformedError("Invalid content-sector cache.");
  const known=new Set<number>();
  for(const n of s.nodes) {
    if(!Number.isInteger(n.nodeIndex)||n.nodeIndex<0||known.has(n.nodeIndex)||!['worldAISpotNode','worldPopulationSpawnerNode','worldCommunityRegistryNode','worldCompiledCommunityAreaNode','worldCompiledCommunityAreaNode_Streamable'].includes(n.type))throw new NativeMalformedError("Invalid cached content node.");
    known.add(n.nodeIndex);
  }
  let previous=-1;
  for(const p of s.placements) {
    if(!Number.isInteger(p.index)||p.index<=previous||!known.has(p.nodeIndex)||typeof p.ref!=="string"||!/^\d+$/.test(p.ref)
      ||!Array.isArray(p.at)||p.at.length!==3||!p.at.every(Number.isFinite)||!Array.isArray(p.orientation)||p.orientation.length!==4||!p.orientation.every(Number.isFinite))throw new NativeMalformedError("Invalid cached content placement.");
    previous=p.index;
  }
  previous=-1;
  for(const v of s.variantIndices) {if(!Number.isInteger(v)||v<previous||v<0)throw new NativeMalformedError("Invalid cached variant ranges.");previous=v;}
  if(!Number.isInteger(s.persistentNodeIndex)||s.persistentNodeIndex < -1)throw new NativeMalformedError("Invalid cached persistent range.");
  return s;
}
