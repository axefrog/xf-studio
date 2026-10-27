/** One owner for prepared slice files and their catalogue publication. Builds do not hold the directory lease. */
import {createHash,randomUUID} from "node:crypto";
import {closeSync,fstatSync,mkdirSync,openSync,readFileSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join,basename} from "node:path";
import {CONTENT_FILE_CAP,type WorldContent,type selectSlice} from "./world-content.ts";
import {validateContent} from "./world-content-validation.ts";
import {acquireSetPublishLock} from "./set-publish-lock.ts";
import {worldIndexFor,readWorldIndex,indexMatchesContent} from "./world-content-index.ts";
import {NativeBudgetError} from "../../xf-studio/authoring/src/native/native-errors";
interface Snapshot {fingerprint:string|null;bytes:number;json?:string}
export interface PreparedWorldContent {baseFingerprint:string|null;content:WorldContent;cached:boolean;bytes:number;json?:string}
export interface CataloguePublication {slice:Pick<ReturnType<typeof selectSlice>,"roots">;fingerprint:string;check?():void}
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
/** Read one opened file identity; atomic path replacement cannot pair old bytes with a new file's metadata. */
function snapshot(file:string):Snapshot {
  let fd:number;try{fd=openSync(file,"r");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {fingerprint:null,bytes:0};throw error;}
  try {
    const before=fstatSync(fd,{bigint:true}),bytes=Number(before.size);
    if(bytes>CONTENT_FILE_CAP)return {bytes,fingerprint:`oversized:${before.ino}:${before.size}:${before.mtimeNs}:${before.ctimeNs}`};
    const data=readFileSync(fd),after=fstatSync(fd,{bigint:true});
    if(data.length!==bytes||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs)throw Error("Prepared content changed during its read; retry.");
    return {bytes,fingerprint:digest(data),json:data.toString("utf8")};
  }finally{closeSync(fd);}
}
function contentOf(s:Snapshot,key?:string):WorldContent|undefined {
  if(!s.json)return;
  try{const value=JSON.parse(s.json);validateContent(value,key??value?.source?.key);return value;}catch{return;}
}
export async function prepareWorldContent(file:string,key:string,build:()=>Promise<WorldContent>,signal:AbortSignal,fingerprint?:string):Promise<PreparedWorldContent> {
  signal.throwIfAborted();const before=snapshot(file),cached=contentOf(before,key);
  if(cached)return {baseFingerprint:before.fingerprint,content:cached,cached:true,bytes:before.bytes};
  const built=await build();signal.throwIfAborted();
  const content=fingerprint?{...built,source:{...built.source,fingerprint}}:built;validateContent(content,key);
  const json=JSON.stringify(content),bytes=Buffer.byteLength(json);
  if(bytes>CONTENT_FILE_CAP)throw new NativeBudgetError("Slice exceeds 32 MiB; use a smaller slice.");
  return {baseFingerprint:before.fingerprint,content,cached:false,bytes,json};
}
export async function publishWorldContent(file:string,prepared:PreparedWorldContent,signal:AbortSignal,catalogue?:CataloguePublication) {
  signal.throwIfAborted();const directory=dirname(file);mkdirSync(directory,{recursive:true});
  const release=await acquireSetPublishLock(join(directory,".world-index.publish.lock"),signal);
  try {
    signal.throwIfAborted();const current=snapshot(file);let selected=prepared;
    const superseded=current.fingerprint!==prepared.baseFingerprint;
    if(superseded){
      const content=contentOf(current);
      if(content){
        if(content.slice.id!==prepared.content.slice.id)throw Error("Newer prepared file belongs to a different slice; retry.");
        selected={baseFingerprint:current.fingerprint,content,cached:true,bytes:current.bytes};
      }else if(prepared.cached)throw Error("Cached slice disappeared or became invalid before publication; retry.");
    }
    let indexJson:string|undefined;
    if(catalogue){
      if(basename(file)!==`${selected.content.slice.id}.content.json`)throw Error("Slice filename disagrees with its id.");
      const prior=readWorldIndex(directory);
      // A newer complete publication owns its bounds and shared source fingerprint. Do not overwrite either with this caller's inputs.
      if(superseded&&selected.cached&&indexMatchesContent(prior,selected.content,selected.bytes))return {content:selected.content,cached:true,bytes:selected.bytes,superseded:true};
      const fingerprint=selected.content.source.fingerprint??(selected.content.source.key===prepared.content.source.key?catalogue.fingerprint:undefined);
      if(fingerprint!==catalogue.fingerprint)throw Error("Newer slice uses different source inputs and needs catalogue reconciliation; retry with current inputs.");
      if(!selected.cached)catalogue.check?.();
      const index=worldIndexFor(directory,selected.content,catalogue.slice,{fingerprint,bytes:selected.bytes});indexJson=JSON.stringify(index);
      if(Buffer.byteLength(indexJson)>1024*1024)throw Error("World index exceeds 1 MiB.");
    }
    const contentTmp=join(directory,`.${randomUUID()}.tmp`),indexTmp=join(directory,`.${randomUUID()}.tmp`);
    try {
      // Stage and validate both outputs before replacing either; the same lease covers both replacements.
      if(!selected.cached)writeFileSync(contentTmp,selected.json!,{flag:"wx"});
      if(indexJson!==undefined)writeFileSync(indexTmp,indexJson,{flag:"wx"});
      signal.throwIfAborted();
      if(!selected.cached)renameSync(contentTmp,file);
      if(indexJson!==undefined)renameSync(indexTmp,join(directory,"index.json"));
    }finally{rmSync(contentTmp,{force:true});rmSync(indexTmp,{force:true});}
    return {content:selected.content,cached:selected.cached,bytes:selected.bytes,superseded};
  }finally{release();}
}
/** Cache probing and preparation may race; publication revalidates the file hash inside the shared lease. */
export async function cachedWorldContent(file:string,key:string,build:()=>Promise<WorldContent>,signal:AbortSignal,catalogue?:CataloguePublication) {
  const prepared=await prepareWorldContent(file,key,build,signal,catalogue?.fingerprint);
  return publishWorldContent(file,prepared,signal,catalogue);
}
