/** Private, stamp-keyed REDmod name index. Compiled flats reuse the Studio's TweakDB owner. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tweakDbOf } from "../../xf-studio/authoring/src/character/host/clothing-host";
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
export function worldNameSources(root:string,ep1:boolean) {
  const files:SourceStamp[]=[];
  const walk=(dir:string,depth=0)=>{
    if(depth>32||files.length>20_000)throw new NativeBudgetError("REDmod source tree exceeds W1 bounds.");
    if(!existsSync(dir))return;
    for(const e of readdirSync(dir,{withFileTypes:true})) {const path=join(dir,e.name);if(e.isDirectory())walk(path,depth+1);else if(e.isFile()&&e.name.endsWith(".tweak")){if(files.length>=20_000)throw new NativeBudgetError("REDmod source tree exceeds W1 bounds.");const s=statSync(path);files.push({path,size:s.size,mtimeMs:s.mtimeMs});}}
  };
  walk(join(root,"tools","redmod","tweaks","base"));if(ep1)walk(join(root,"tools","redmod","tweaks","ep1"));
  files.sort((a,b)=>a.path.localeCompare(b.path));
  // One locator/reader owns compiled TweakDB selection and caching for the Studio and W1.
  const db=tweakDbOf(root,ep1),dbPath=db?join(root,...db.source.split("\\")):undefined,st=dbPath?statSync(dbPath):undefined;
  return {files,db,sources:[...files,...(dbPath&&st?[{path:dbPath,size:st.size,mtimeMs:st.mtimeMs}]:[])]};
}
export function worldRecordNames(files:readonly SourceStamp[]):ReadonlyMap<string,string|null> {
  const key=JSON.stringify(files);if(memo?.key===key)return memo.names;
  let total=0;
  function* sources(){for(const f of files){total+=f.size;if(f.size>32*1024*1024||total>256*1024*1024)throw new NativeBudgetError("REDmod sources exceed W1 byte bounds.");yield readFileSync(f.path,"utf8");}}
  const names=reverseRecordNames(sources());memo={key,names};return names;
}
