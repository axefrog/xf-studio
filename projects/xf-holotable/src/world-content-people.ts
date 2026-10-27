/** Compiled record types and Character → Affiliation flats; no inference from record spelling. */
import { childId, type TweakDbBlob, type TweakValue } from "../../xf-studio/authoring/src/game/tweakdb-flats";
import type { TextTable } from "../../xf-studio/authoring/src/game/game-text";
import { journalHash } from "./world-content-resources.ts";
import { count, type Community, type Coverage } from "./world-content.ts";

// TweakDB type names use the same Murmur3 x86-32 seed as journal paths (WolvenKit TweakDBReader).
const CHARACTER=journalHash("Character"),VEHICLE=journalHash("Vehicle");
export function resolveCommunityPeople(communities:Community[],db:Pick<TweakDbBlob,"lookup"|"recordTypes">|null,names:ReadonlyMap<string,string|null>,texts:TextTable,counts:Coverage) {
  const ids=new Set<number>();for(const c of communities)for(const e of c.entries)if(e.record)ids.add(Number(BigInt(e.record)&0xffffffffffn));
  const types=db?.recordTypes(ids),fields=new Set<number>();
  for(const id of ids)if(types?.get(id)===CHARACTER)for(const field of ["affiliation","fullDisplayName","displayName"])fields.add(childId(id,`.${field}`));
  const flats=db?.lookup(fields),affiliations=new Set<number>();
  for(const id of ids){const v=flats?.get(childId(id,".affiliation"));if(v?.type==="TweakDBID"&&v.value)affiliations.add(v.value);}
  const affFlats=db?.lookup([...affiliations].map(id=>childId(id,".localizedName")));
  const localized=(v:TweakValue|undefined)=>v&&typeof v.value==="string"&&["String","CName","gamedataLocKeyWrapper"].includes(v.type)?texts.resolve(v.value)?.text:undefined;
  for(const c of communities) {
    delete c.affiliation;
    for(const e of c.entries) {
      delete e.affiliation;delete e.displayName;
      const id=e.record?Number(BigInt(e.record)&0xffffffffffn):undefined,type=id===undefined?undefined:types?.get(id);
      e.kind=type===CHARACTER?"person":type===VEHICLE?"vehicle":undefined;
      count(counts,"community.entryKind",e.kind?undefined:"record type unavailable or unsupported");
      if(e.kind!=="person"||id===undefined)continue;
      e.displayName=localized(flats?.get(childId(id,".fullDisplayName")))??localized(flats?.get(childId(id,".displayName")));
      const aff=flats?.get(childId(id,".affiliation"));
      if(aff?.type==="TweakDBID"&&aff.value) {
        const record=String(aff.value),recordName=names.get(record)??undefined,title=localized(affFlats?.get(childId(aff.value,".localizedName")));
        e.affiliation={record,recordName,title};
      }
      count(counts,"community.personAffiliation",e.affiliation?undefined:"affiliation not stored");
      count(counts,"community.affiliationTitle",e.affiliation?.title?undefined:"affiliation display key unavailable");
    }
    const people=c.entries.filter(e=>e.kind==="person"),first=people[0]?.affiliation;
    if(first?.title&&c.entries.every(e=>e.kind)&&people.every(e=>e.affiliation?.record===first.record))c.affiliation=first;
    count(counts,"community.affiliation",c.affiliation?undefined:"mixed, unknown or unlabelled affiliation");
  }
}
