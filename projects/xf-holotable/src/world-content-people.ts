/** Compiled record types and Character flats; no inference from record spelling or appearance. */
import { childId, type TweakDbBlob, type TweakValue } from "../../xf-studio/authoring/src/game/tweakdb-flats";
import type { TextTable } from "../../xf-studio/authoring/src/game/game-text";
import { journalHash } from "./world-content-resources.ts";
import { ContentBudget, stringBytes } from "./world-content-budget.ts";
import { count, type Community, type Spawner, type ContentRecord, type Coverage } from "./world-content.ts";
const CHARACTER=journalHash("Character"),VEHICLE=journalHash("Vehicle");
/** Each distinct referenced id gets an entry, even when the compiled record is missing. */
export function resolveContentRecords(communities:Community[],spawners:readonly Spawner[],db:Pick<TweakDbBlob,"lookup"|"recordTypes">|null,names:ReadonlyMap<string,string|null>,texts:TextTable,counts:Coverage,budget=new ContentBudget()):Record<string,ContentRecord> {
  const ids=new Map<string,number>();
  for(const c of communities)for(const e of c.entries)if(e.record)ids.set(e.record,Number(BigInt(e.record)&0xffffffffffn));
  for(const s of spawners)ids.set(s.record,Number(BigInt(s.record)&0xffffffffffn));
  const types=db?.recordTypes(ids.values()),fields=new Set<number>();
  for(const id of ids.values())if(types?.get(id)===CHARACTER)for(const field of ["affiliation","fullDisplayName","displayName","archetypeName","isCrowd","genders"])fields.add(childId(id,`.${field}`));
  const flats=db?.lookup(fields),affiliations=new Set<number>();
  for(const id of ids.values()){const v=flats?.get(childId(id,".affiliation"));if(v?.type==="TweakDBID"&&v.value)affiliations.add(v.value);}
  const affFlats=db?.lookup([...affiliations].map(id=>childId(id,".localizedName")));
  const localized=(v:TweakValue|undefined)=>v&&typeof v.value==="string"&&["String","CName","gamedataLocKeyWrapper"].includes(v.type)?texts.resolve(v.value)?.text:undefined;
  const records:Record<string,ContentRecord>=Object.create(null);
  for(const [raw,id] of ids) {
    budget.charge({nested:1,bytes:128+stringBytes(raw)});
    const type=types?.get(id),row:ContentRecord={kind:type===CHARACTER?"person":type===VEHICLE?"vehicle":"other"};
    const name=names.get(String(id));if(name)row.name=name;
    count(counts,"records");count(counts,"record.name",row.name?undefined:"record name absent from REDmod sources");
    count(counts,"record.kind",type===CHARACTER||type===VEHICLE?undefined:"record type unavailable or unsupported (other)");
    if(row.kind==="person") {
      const display=localized(flats?.get(childId(id,".fullDisplayName")))??localized(flats?.get(childId(id,".displayName")));if(display)row.displayName=display;
      const aff=flats?.get(childId(id,".affiliation"));
      if(aff?.type==="TweakDBID"&&aff.value) {
        row.affiliation=String(aff.value);
        const name=names.get(row.affiliation),title=localized(affFlats?.get(childId(aff.value,".localizedName")));
        if(name)row.affiliationName=name;if(title)row.affiliationTitle=title;
      }
      const role=flats?.get(childId(id,".archetypeName"));if(role?.type==="CName"&&typeof role.value==="string"&&role.value&&role.value!=="None")row.role=role.value;
      const crowd=flats?.get(childId(id,".isCrowd"));if(crowd?.type==="Bool"&&(crowd.value===0||crowd.value===1))row.crowd=crowd.value===1;
    }
    for(const value of Object.values(row))if(typeof value==="string")budget.charge({bytes:stringBytes(value)});
    records[raw]=row;
    for(const field of ["displayName","affiliation","affiliationTitle","affiliationName","role","crowd","gender"] as const) {
      const reason=row.kind!=="person"?"not a verified Character record":field==="gender"?"no single stored gender; genders lists entity alternatives":`${field} flat or resolved value unavailable`;
      count(counts,`record.${field}`,row[field]!==undefined?undefined:reason);
    }
  }
  for(const c of communities) {
    delete c.affiliation;
    const rows=c.entries.map(e=>e.record?records[e.record]:undefined),people=rows.filter(r=>r?.kind==="person"),first=people[0];
    if(first?.affiliation&&first.affiliationTitle&&rows.every(r=>r&&r.kind!=="other")&&people.every(r=>r!.affiliation===first.affiliation))
      c.affiliation={record:first.affiliation,...(first.affiliationName?{recordName:first.affiliationName}:{}),title:first.affiliationTitle};
    count(counts,"community.affiliation",c.affiliation?undefined:"mixed, unknown or unlabelled affiliation");
  }
  return records;
}
