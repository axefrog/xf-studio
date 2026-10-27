/** Read-only projections of the prepared records table. */
import type { HoloCommunity, HoloContent, HoloAffiliation } from "../types";
export function communityAffiliation(entries:HoloCommunity["entries"],records:HoloContent["records"]):HoloAffiliation|undefined {
  const rows=entries.map(e=>e.record?records?.[e.record]:undefined),people=rows.filter(r=>r?.kind==="person"),first=people[0];
  if(first?.affiliation&&first.affiliationTitle&&rows.every(r=>r&&r.kind!=="other")&&people.every(r=>r!.affiliation===first.affiliation))
    return {record:first.affiliation,recordName:first.affiliationName,title:first.affiliationTitle};
}
