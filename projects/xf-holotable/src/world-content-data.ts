/** W1 transport: only verified fields cross the sector worker/cache boundary. No engine objects escape. */
import { RedHandle, RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import type { readStreamingSectorContent } from "../../xf-studio/authoring/src/native/streaming-sector";
import type { Vec3 } from "./model.ts";
import { ContentBudget, shape, array, optionalString, string, finiteTuple, integer, stringList, stringBytes } from "./world-content-budget.ts";

export const CONTENT_SECTOR_VERSION = 102;
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
  validateContentSector(s);
  return s;
}
export function validateContentSector(s: unknown): asserts s is ContentSector {
  shape(s,"content sector");
  if(s.version!==CONTENT_SECTOR_VERSION)throw new NativeMalformedError("Invalid content-sector version.");
  array(s.nodes,"content nodes");array(s.placements,"content placements");array(s.variantIndices,"variant ranges");
  const budget=new ContentBudget();
  const known=new Set<number>();
  for(const n of s.nodes) {
    shape(n,"content node");integer(n.nodeIndex,0,200_000,"node index");string(n.type,"node type");
    if(known.has(n.nodeIndex)||!['worldAISpotNode','worldPopulationSpawnerNode','worldCommunityRegistryNode','worldCompiledCommunityAreaNode','worldCompiledCommunityAreaNode_Streamable'].includes(n.type))throw new NativeMalformedError("Invalid cached content node.");
    for(const field of ["name","refusal","sourceId","workspot","record"]) {optionalString(n[field],`node ${field}`);budget.charge({bytes:stringBytes(n[field] as string|undefined)});}
    if(n.onStart!==undefined&&typeof n.onStart!=="boolean")throw new NativeMalformedError("Invalid spawn flag.");
    budget.charge({nested:1,bytes:128});
    known.add(n.nodeIndex);
    if(n.type==="worldCommunityRegistryNode"&&!n.refusal || n.registry!==undefined) {
      array(n.registry,"registry items");
      for(const r of n.registry) {
        shape(r,"registry item");optionalString(r.id,"registry id");array(r.entries,"registry entries");budget.charge({nested:1,bytes:64});
        for(const e of r.entries) {shape(e,"registry entry");optionalString(e.name,"entry name");optionalString(e.record,"entry record");budget.charge({nested:1,bytes:64+stringBytes(e.name as string|undefined)+stringBytes(e.record as string|undefined)});}
      }
    }
    if((n.type==="worldCompiledCommunityAreaNode"||n.type==="worldCompiledCommunityAreaNode_Streamable")&&!n.refusal || n.entries!==undefined) {
      array(n.entries,"community entries");
      for(const e of n.entries) {
        shape(e,"community entry");optionalString(e.name,"entry name");optionalString(e.record,"entry record");array(e.phases,"entry phases");budget.charge({nested:1,bytes:64+stringBytes(e.name as string|undefined)});
        for(const p of e.phases) {
          shape(p,"community phase");optionalString(p.name,"phase name");array(p.periods,"phase periods");budget.charge({nested:1,bytes:64+stringBytes(p.name as string|undefined)});
          for(const t of p.periods) {shape(t,"community period");optionalString(t.name,"period name");budget.charge({nested:1,bytes:64+stringBytes(t.name as string|undefined)});stringList(t.spots,"period spots",budget);}
        }
      }
    }
  }
  let previous=-1;
  for(const p of s.placements) {
    shape(p,"content placement");integer(p.index,0,200_000,"placement index");integer(p.nodeIndex,0,200_000,"placement node index");
    string(p.ref,"placement ref");finiteTuple(p.at,3,"placement position");finiteTuple(p.orientation,4,"placement orientation");
    if(p.index<=previous||!known.has(p.nodeIndex)||!/^\d{1,20}$/.test(p.ref)||Math.hypot(...p.orientation)<1e-8)throw new NativeMalformedError("Invalid cached content placement.");
    budget.charge({bytes:192+stringBytes(p.ref)});
    previous=p.index;
  }
  previous=-1;
  for(const v of s.variantIndices) {integer(v,0,200_000,"variant range");if(v<previous)throw new NativeMalformedError("Invalid cached variant ranges.");previous=v;}
  integer(s.persistentNodeIndex,-1,200_000,"persistent range");
}
