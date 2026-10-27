/** Small, atomically replaced catalogue of prepared slices. No archives or game payloads. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Vec3 } from "./model.ts";
import type { WorldContent, selectSlice } from "./world-content.ts";
import { array, shape, string, stringList, finiteTuple, integer, optionalString, CONTENT_LIMITS, ContentBudget } from "./world-content-budget.ts";
export interface WorldIndex {
  schema:"xfh/world-index-1"; source:{game:string;archives:string;reader:string;fingerprint?:string};
  slices:{id:string;title:string;places:string[];bounds:{min:Vec3;max:Vec3};file:string;counts:{communities:number;spots:number;spawners:number;pois:number;records:number};bytes:number;built:string}[];
}
export function validateWorldIndex(value:unknown):asserts value is WorldIndex {
  shape(value,"world index");shape(value.source,"index source");if(value.schema!=="xfh/world-index-1")throw Error("Invalid world-index schema.");
  for(const f of ["game","archives","reader"])string(value.source[f],f);
  optionalString(value.source.fingerprint,"source fingerprint");
  array(value.slices,"index slices");if(value.slices.length>1000)throw Error("Too many slices.");
  const ids=new Set<string>(),budget=new ContentBudget();
  for(const row of value.slices){shape(row,"index slice");string(row.id,"slice id");string(row.title,"slice title");string(row.built,"slice built");
    if(!/^[a-z0-9_-]+$/.test(row.id)||ids.has(row.id)||row.file!==`${row.id}.content.json`)throw Error("Invalid slice file or id.");ids.add(row.id);
    stringList(row.places,"slice places",budget);shape(row.bounds,"slice bounds");finiteTuple(row.bounds.min,3,"min");finiteTuple(row.bounds.max,3,"max");
    const max=row.bounds.max;
    if(row.bounds.min.some((n,i)=>n>max[i]))throw Error("Invalid slice bounds.");shape(row.counts,"slice counts");
    for(const field of ["communities","spots","spawners","pois"])integer(row.counts[field],0,50_000,`slice ${field} count`);
    integer(row.counts.records,0,CONTENT_LIMITS.nested,"slice records count");
    integer(row.bytes,1,32*1024*1024,"slice file bytes");
  }
}
export function readWorldIndex(directory:string):WorldIndex|undefined {
  const file=join(directory,"index.json");
  try {if(statSync(file).size>1024*1024)throw Error("World index exceeds 1 MiB.");const value:unknown=JSON.parse(readFileSync(file,"utf8"));validateWorldIndex(value);return value;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
}
/** Read-only reconciliation: report disappeared files explicitly to CLI callers. */
export function listWorldIndex(directory:string) {
  const index=readWorldIndex(directory);if(!index)return;
  const missing:{id:string;file:string;reason:string}[]=[],slices=index.slices.filter(s=>{
    try{statSync(join(directory,s.file));return true;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;missing.push({id:s.id,file:s.file,reason:"content file missing"});return false;}
  });
  return {...index,slices,...(missing.length?{missing}:{})};
}
/** Build metadata under the publication owner's directory lease; this function never writes a file. */
export function worldIndexFor(directory:string,content:WorldContent,slice:Pick<ReturnType<typeof selectSlice>,"roots">,publication:{fingerprint:string;bytes:number}) {
  const {game,archives,reader}=content.source,source={game,archives,reader,fingerprint:publication.fingerprint},prior=listWorldIndex(directory);
  const same=prior&&prior.source.game===game&&prior.source.archives===archives&&prior.source.reader===reader&&prior.source.fingerprint===source.fingerprint;
  const slices=same?prior.slices.filter(s=>s.id!==content.slice.id):[];
  const bounds={min:[Infinity,Infinity,Infinity] as Vec3,max:[-Infinity,-Infinity,-Infinity] as Vec3};
  for(const root of slice.roots)for(const [x,y] of root.poly){bounds.min[0]=Math.min(bounds.min[0],x);bounds.min[1]=Math.min(bounds.min[1],y);bounds.max[0]=Math.max(bounds.max[0],x);bounds.max[1]=Math.max(bounds.max[1],y);bounds.min[2]=Math.min(bounds.min[2],root.zlo);bounds.max[2]=Math.max(bounds.max[2],root.zhi);}
  slices.push({...content.slice,bounds,file:`${content.slice.id}.content.json`,counts:{communities:content.communities.length,spots:content.spots.length,spawners:content.spawners.length,pois:content.pois.length,records:Object.keys(content.records).length},bytes:publication.bytes,built:content.source.built});slices.sort((a,b)=>a.id.localeCompare(b.id));
  const index:WorldIndex={schema:"xfh/world-index-1",source,slices};validateWorldIndex(index);return index;
}
/** A superseded caller must preserve the winner's bounds/source, rather than re-derive them from older inputs. */
export function indexMatchesContent(index:WorldIndex|undefined,content:WorldContent,bytes:number):boolean {
  const row=index?.slices.find(s=>s.id===content.slice.id);
  return !!row&&index!.source.game===content.source.game&&index!.source.archives===content.source.archives&&index!.source.reader===content.source.reader
    &&!!content.source.fingerprint&&index!.source.fingerprint===content.source.fingerprint
    &&row.bytes===bytes&&row.built===content.source.built&&row.title===content.slice.title&&JSON.stringify(row.places)===JSON.stringify(content.slice.places)
    &&row.counts.communities===content.communities.length&&row.counts.spots===content.spots.length&&row.counts.spawners===content.spawners.length&&row.counts.pois===content.pois.length&&row.counts.records===Object.keys(content.records).length;
}
