/** Verified world-map title routes. No id prettification or guessed vendor/quest joins. */
import { TextTable, type TextEntry } from "../../xf-studio/authoring/src/game/game-text";
import { tweakDbId, type TweakDbBlob } from "../../xf-studio/authoring/src/game/tweakdb-flats";
import type { RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { object, list, text } from "./world-content-data.ts";
import { journalHash, type JournalIndex, type JournalPin } from "./world-content-resources.ts";
import { count, type Coverage, type Poi } from "./world-content.ts";

/** Native JsonResource adapter; TextTable retains the shared primary/secondary-key semantics. */
export function addWorldTexts(table:TextTable,root:RedObject,path:string) {
  const entries:TextEntry[]=list(object(root.fields.root).entries).map(value=>{
    const f=object(value);return {primaryKey:String(f.primaryKey??"0"),secondaryKey:text(f.secondaryKey)??"",female:text(f.femaleVariant)??"",male:text(f.maleVariant)??""};
  });
  table.add(entries,{id:path,kind:"game",declaredBy:null});
}
export function resolvePoiTitles(pois:Poi[],journal:JournalIndex,db:Pick<TweakDbBlob,"lookup">|null,texts:TextTable,counts:Coverage) {
  const pins=pois.map(p=>p.journal?journal.get(journalHash(p.journal)):undefined);
  const ids=new Set<number>();
  for(const pin of pins)if(pin?.displayRecord&&pin.titleField) {
    ids.add(tweakDbId(`${pin.displayRecord}.${pin.titleField}`));if(pin.brand)ids.add(tweakDbId(`${pin.displayRecord}.brandName`));
  }
  const flats=db?.lookup(ids);
  const flat=(pin:JournalPin,field:string)=>{
    const v=flats?.get(tweakDbId(`${pin.displayRecord}.${field}`));
    return v&&["String","CName","gamedataLocKeyWrapper"].includes(v.type)&&typeof v.value==="string"?v.value:undefined;
  };
  for(let i=0;i<pois.length;i++) {
    const pin=pins[i];let key=pin?.titleKey;
    if(pin?.questPath){const quest=journal.get(journalHash(pin.questPath));if(quest?.path===pin.questPath)key=quest.titleKey;}
    if(pin?.displayRecord&&pin.titleField)key=flat(pin,pin.titleField);
    let title=key?texts.resolve(key)?.text:undefined;
    if(title&&pin?.titlePrefix){const prefix=texts.resolve(pin.titlePrefix)?.text;title=prefix?`${prefix} - ${title}`:undefined;}
    if(title&&pin?.brand){const brand=flat(pin,"brandName");if(brand)title=`${brand} ${title}`;}
    if(title)pois[i].title=title;
    count(counts,"poi.title",title?undefined:key?"display key not in English texts":"verified display key unavailable");
  }
}
