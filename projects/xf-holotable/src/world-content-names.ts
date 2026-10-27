/** Private, stamp-keyed REDmod name index. Compiled flats reuse the Studio's TweakDB owner. */
import { readFileSync, statSync } from "node:fs";
import { metadataReader, type DiscoveryStats } from "./world-content-directory.ts";
import { join } from "node:path";
import { tweakDbSourceOf } from "../../xf-studio/authoring/src/character/host/clothing-host";
import { tweakDbId } from "../../xf-studio/authoring/src/game/tweakdb-flats";
import { NativeBudgetError } from "../../xf-studio/authoring/src/native/native-errors";
import type { SourceStamp } from "./sector-cache.ts";

/** Declarations only: references, field names, comments and quoted strings aren't record names. */
export function tweakRecordNames(source: string): string[] {
  const clean=source.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g," ");
  const pkg=/^\s*package\s+([\w.]+)/m.exec(clean)?.[1];if(!pkg)return [];
  const body=clean.replace(/^\s*(?:package|using)\b[^\n]*/gm,"");
  let depth=0,head:string[]=[];const names:string[]=[];
  for(const token of body.matchAll(/[A-Za-z_][\w.]*|[{}:=;]/g)) {
    const t=token[0];
    if(t==="{") {if(depth++===0){const h=head.join(" "),m=/^(?:abstract )?([\w.]+)(?: : [\w.]+)?$/.exec(h);if(m)names.push(m[1].includes(".")?m[1]:`${pkg}.${m[1]}`);head=[];}}
    else if(t==="}"){depth--;if(depth===0)head=[];}
    else if(depth===0){if(t===";")head=[];else head.push(t);}
  }
  return names;
}
export function reverseRecordNames(sources: Iterable<string>): ReadonlyMap<string,string|null> {
  const map=new Map<string,string|null>();
  for(const source of sources)for(const name of tweakRecordNames(source)) {
    const id=String(tweakDbId(name)),old=map.get(id);
    map.set(id,old===undefined||old===name?name:null);
    if(map.size>500_000)throw new NativeBudgetError("REDmod name index exceeds 500,000 records.");
  }
  return map;
}
let memo:{key:string;names:ReadonlyMap<string,string|null>}|undefined;
export const REDMOD_DISCOVERY_LIMITS:Readonly<{entries:number;directories:number;depth:number}>=Object.freeze({entries:20_000,directories:4_000,depth:32});
export function worldNameSources(root:string,ep1:boolean,limits:Readonly<typeof REDMOD_DISCOVERY_LIMITS>=REDMOD_DISCOVERY_LIMITS,options:{portable?:boolean;stats?:DiscoveryStats}={}) {
  const files:SourceStamp[]=[],directories:SourceStamp[]=[],missingDirectories=new Set<string>(),stats=options.stats??{entries:0,directories:0,fileStats:0,native:false},reader=metadataReader(stats,options.portable);
  const walk=(dir:string,depth=0,stamp?:SourceStamp)=>{
    if(depth>limits.depth||++stats.directories>limits.directories)throw new NativeBudgetError("REDmod discovery exceeds its directory/depth limit.");
    if(!stamp){try{const s=statSync(dir);stamp={path:dir,size:s.size,mtimeMs:s.mtimeMs};}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;missingDirectories.add(dir);stamp={path:dir,size:0,mtimeMs:0};}}
    directories.push(stamp);
    for(const e of reader.entries(dir)){
      if(++stats.entries>limits.entries)throw new NativeBudgetError("REDmod discovery exceeds its total entry limit.");
      const path=join(dir,e.name),s={path,size:e.size,mtimeMs:e.mtimeMs};
      if(e.directory)walk(path,depth+1,s);else if(e.file&&e.name.endsWith(".tweak"))files.push(s);
    }
  };
  try{walk(join(root,"tools","redmod","tweaks","base"));if(ep1)walk(join(root,"tools","redmod","tweaks","ep1"));}finally{reader.close();}
  files.sort((a,b)=>a.path.localeCompare(b.path));directories.sort((a,b)=>a.path.localeCompare(b.path));
  const db=tweakDbSourceOf(root,ep1),sources=[...files,...(db?[{path:db.path,size:db.size,mtimeMs:db.mtimeMs}]:[])];
  return {files,sources,directories,missingDirectories,stats};
}
/** Rebuild-only publication check: reuse the captured list instead of rediscovering the tree. */
export function checkWorldNameSources(snapshot:ReturnType<typeof worldNameSources>) {
  const directoryPaths=new Set(snapshot.directories.map(s=>s.path));
  for(const s of [...snapshot.directories,...snapshot.sources]) {
    try {const now=statSync(s.path),directory=directoryPaths.has(s.path);
      if(snapshot.missingDirectories.has(s.path))throw Error("TweakDB source directory appeared during the build; rerun.");
      if((!directory&&now.size!==s.size)||Math.abs(now.mtimeMs-s.mtimeMs)>0.01)throw Error("TweakDB sources changed during the build; rerun.");
    }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"&&snapshot.missingDirectories.has(s.path))continue;throw error;}
  }
}
export function worldRecordNames(files:readonly SourceStamp[]):ReadonlyMap<string,string|null> {
  const key=JSON.stringify(files);if(memo?.key===key)return memo.names;
  let total=0;
  function* sources(){for(const f of files){total+=f.size;if(f.size>32*1024*1024||total>256*1024*1024)throw new NativeBudgetError("REDmod sources exceed W1 byte bounds.");yield readFileSync(f.path,"utf8");}}
  const names=reverseRecordNames(sources());memo={key,names};return names;
}
