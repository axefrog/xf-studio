/** Verified cooked-journal join and compact workspot mapping, independent of archive I/O. */
import { RedHandle, RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import { object, list, text, vector } from "./world-content-data.ts";
import { count, type ContentAssembler, type Coverage } from "./world-content.ts";

/** Murmur3 x86-32; the game's journal-path seed (places research, WolvenKit/ArchiveXL). */
export function journalHash(path: string): number {
  const bytes = new TextEncoder().encode(path), view = new DataView(bytes.buffer); let h = 0x5eedba5e, i = 0;
  const rotate = (v:number,n:number) => v<<n|v>>>(32-n);
  const mix = (k:number) => Math.imul(rotate(Math.imul(k,0xcc9e2d51),15),0x1b873593);
  for(;i+4<=bytes.length;i+=4) { h ^= mix(view.getUint32(i,true)); h = (Math.imul(rotate(h,13),5)+0xe6546b64)|0; }
  let tail=0;for(let j=0;i+j<bytes.length;j++)tail|=bytes[i+j]<<(j*8);
  if(i<bytes.length)h^=mix(tail);
  h^=bytes.length;h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;
  return h>>>0;
}
export interface JournalPin { path: string; variant?: string; record?: string; titleKey?: string; questPath?: string; displayRecord?: string; titleField?: string; titlePrefix?: string; brand?: boolean }
export type JournalIndex = Map<number,JournalPin | null>;
export function indexJournal(root: RedObject, index:JournalIndex=new Map()): JournalIndex {
  let visited=0;const active=new Set<RedObject>();
  const walk=(value:unknown,parent:string,depth:number,questTitle?:string) => {
    const node=value instanceof RedHandle?value.target:value;
    if(!(node instanceof RedObject))return;
    if(++visited>200_000||depth>256)throw new NativeBudgetError("Journal tree exceeds W1 traversal bounds.");
    if(active.has(node))throw new NativeBudgetError("Cyclic journal tree.");active.add(node);
    const f=node.fields,id=text(f.id),path=id?(parent?parent+"/":"")+id:parent;
    if(node.type==="gameJournalQuest")questTitle=typeof f.title==="object"&&f.title?text((f.title as {value?:unknown}).value):undefined;
    if(path) {
      const data=object(f.mappinData), variant=text(object(data.typedVariant).variant)??text(data.variant)
        ??(node.type==="gameJournalQuestMapPin"?"DefaultQuestVariant":undefined);
      // recommendedLevelID is a content-assignment record, not an NPC or vendor record.
      const row:JournalPin={path,variant,record:text(f.recommendedLevelID)};
      if(node.type==="gameJournalQuestMapPin"&&questTitle)row.titleKey=questTitle;
      if(node.type==="gameJournalQuest"&&questTitle)row.titleKey=questTitle;
      if(node.type==="gameJournalPointOfInterestMappin") {
        row.questPath=text(object(f.questPath).realPath);
        if(variant==="ServicePointRipperdocVariant"||variant==="Zzz18_RacingVariant") {
          row.displayRecord=`Mappins.${id}`;row.titleField=variant==="ServicePointRipperdocVariant"?"localizedName":"title";
          if(variant==="ServicePointRipperdocVariant")row.titlePrefix="UI-MappinTypes-RipperdocServicePoint";
        }
        const slot=text(f.slotName);
        if(slot&&(variant==="Zzz01_CarForPurchaseVariant"||variant==="Zzz02_MotorcycleForPurchaseVariant"||variant==="Zzz05_ApartmentToPurchaseVariant")) {
          row.displayRecord=`${variant==="Zzz05_ApartmentToPurchaseVariant"?"Apartment":"Vehicle"}.${slot}_offer`;row.titleField="name";row.brand=variant!=="Zzz05_ApartmentToPurchaseVariant";
        }
      }
      const hash=journalHash(path),old=index.get(hash);
      if(old===undefined)index.set(hash,row);
      else if(old===null||JSON.stringify(old)!==JSON.stringify(row))index.set(hash,null);
    }
    for(const child of list(f.entries))walk(child,path,depth+1,questTitle);
    active.delete(node);
  };
  walk(root.fields.entry,"",0);return index;
}
export function mapMappins(root:RedObject,resourceHash:string,journal:JournalIndex,out:ContentAssembler) {
  for(const field of ["cookedData","cookedMultiData","cookedGpsData"]) {
    for(const [i,value] of list(root.fields[field]).entries()) {
      const f=object(value),hash=Number(f.journalPathHash??0),pin=journal.get(hash);
      const positions=field==="cookedData"?[f.position]:list(f.positions);
      if(!positions.length)count(out.counts,"pois","no positions");
      for(const [j,value] of positions.entries()) {
        const at=vector(value);
        if(!at) {count(out.counts,"pois","invalid position");continue;}
        if(pin===null) {count(out.counts,"pois","ambiguous journal hash");continue;}
        out.addPoi({id:`${resourceHash}:${field}:${i}:${j}`,at,variant:pin?.variant,journal:pin?.path,record:pin?.record});
      }
    }
  }
}
export function mapWorkspot(root:RedObject,path:string,counts:Coverage) {
  if(!(root.fields.workspotTree instanceof RedHandle)||root.fields.workspotTree.target?.type!=="workWorkspotTree")throw new NativeMalformedError("Missing workspot tree.");
  const tree=object(root.fields.workspotTree),entry=object(tree.rootEntry);
  const idle=text(entry.idleAnim), activity=idle&&!idle.startsWith("<")?idle:undefined;
  count(counts,"workspot.activity",activity?undefined:"root idleAnim not stored");
  const tags=list(object(tree.tags).tags).map(text).filter((s):s is string=>!!s);
  // workWorkspotTree constructor's empty redTagList is the verified omitted default.
  count(counts,"workspot.tags");return {path,activity,tags};
}
