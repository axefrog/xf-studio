import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir";
import { tweakDbId, type TweakValue } from "../../xf-studio/authoring/src/game/tweakdb-flats";
import { TextTable } from "../../xf-studio/authoring/src/game/game-text";
import { RedHandle, RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { reverseRecordNames, tweakRecordNames, worldRecordNames, worldNameSources, REDMOD_DISCOVERY_LIMITS } from "../src/world-content-names";
import { NativeBudgetError } from "../../xf-studio/authoring/src/native/native-errors";
import { addWorldTexts, resolvePoiTitles } from "../src/world-content-titles";
import { indexJournal } from "../src/world-content-resources";
import { journalHash } from "../src/world-content-resources";
import { buildWorldContent, worldContentCacheKey } from "../src/world-content-source";
import { coverage, WORLD_CONTENT_READER, type Poi, type WorldContent } from "../src/world-content";
import type { WorldPack } from "../src/model";
const obj=(type:string,fields:Record<string,unknown>={})=>new RedObject(type,fields),h=(type:string,fields:Record<string,unknown>)=>new RedHandle(obj(type,fields));

test("REDmod discovery bounds all streamed entries and directories, including non-tweak files",()=>{
 const root=tempDir("world-discovery-"),base=join(root,"tools","redmod","tweaks","base");mkdirSync(base,{recursive:true});
 for(let i=0;i<9;i++)writeFileSync(join(base,`${i}.txt`),"ignored");writeFileSync(join(base,"one.tweak"),"package Example\none {}");
 expect(()=>worldNameSources(root,false,{...REDMOD_DISCOVERY_LIMITS,entries:8})).toThrow("total entry limit");
 for(let i=0;i<3;i++)mkdirSync(join(base,`folder${i}`));
 expect(()=>worldNameSources(root,false,{...REDMOD_DISCOVERY_LIMITS,directories:2})).toThrow(NativeBudgetError);
 const found=worldNameSources(root,false);expect(found.files).toHaveLength(1);
 expect(found.files[0].path).toEndWith("one.tweak");
 // Successful removal also proves the directory handles closed after each refusal.
 rmSync(base,{recursive:true});
});

test("assembled cache hits inspect only stamps; only a miss loads the TweakDB blob",async()=>{
 const root=tempDir("world-stamp-hit-"),cache=join(root,"r6","cache"),directory=join(root,"world");mkdirSync(cache,{recursive:true});mkdirSync(directory);
 writeFileSync(join(cache,"tweakdb.bin"),"not a compiled blob");
 const pack:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"fixture",source:"fixture",built:"fixture"},areas:[{id:"Districts.Test",kind:"district",name:"Test",poly:[[0,0],[10,0],[10,10],[0,10]],zlo:0,zhi:10}],cells:[]};
 const names=worldNameSources(root,false),key=worldContentCacheKey([],pack,"test",WORLD_CONTENT_READER,names.sources),counts=coverage();
 for(const k of ["communities","spots","spawners","pois"]){counts.read[k]=counts.kept[k]=counts.dropped[k]=0;counts.reasons[k]={};}
 const content:WorldContent={schema:"xfh/world-content-1",slice:{id:"test",title:"Test",places:["Districts.Test"]},source:{game:"fixture",archives:"fixture",reader:WORLD_CONTENT_READER,built:"fixture",key},records:{},communities:[],spots:[],spawners:[],pois:[],counts};
 const file=join(directory,"test.content.json");writeFileSync(file,JSON.stringify(content));
 const options={root,pack,directory,slice:"test",signal:new AbortController().signal};
 expect((await buildWorldContent(options)).cached).toBe(true);
 rmSync(file);await expect(buildWorldContent(options)).rejects.toThrow("not a TweakDB blob");
});

test("REDmod declarations hash with the shared TweakDB algorithm, ignoring fields, strings and comments",()=>{
  const source=`package Character\nusing RTDB, BaseStats\n// fake : Parent {}\nkab_gang_member_ma : Quest_NPC_Base\n{ name = "fake { declaration }"; nested = { field = 1; }; }\n/* ignored {} */\nkab_vendor_ma\n{ }`;
  expect(tweakRecordNames(source)).toEqual(["Character.kab_gang_member_ma","Character.kab_vendor_ma"]);
  const names=reverseRecordNames([source,source]);expect(names.size).toBe(2);
  expect(names.get(String(tweakDbId("Character.kab_gang_member_ma")))).toBe("Character.kab_gang_member_ma");
  expect(names.get("987654321")).toBeUndefined();
});
test("private name cache reuses stamps and invalidates on changes and removals; assembled identity covers names",()=>{
  const t=tempDir("world-names");{
    const path=join(t,"fixture.tweak");writeFileSync(path,"package Character\none {}\n");
    const stamp=()=>{const s=statSync(path);return {path,size:s.size,mtimeMs:s.mtimeMs};};
    const first=stamp(),a=worldRecordNames([first]);expect(worldRecordNames([first])).toBe(a);
    writeFileSync(path,"package Character\ntwo {}\n");utimesSync(path,new Date(),new Date(first.mtimeMs+2000));
    const changed=stamp(),b=worldRecordNames([changed]);expect(b).not.toBe(a);expect(b.get(String(tweakDbId("Character.two")))).toBe("Character.two");
    expect(worldRecordNames([]).size).toBe(0);
    const pack={schema:"xfh/world-pack-1",provenance:{game:"fixture",source:"fixture",built:"fixture"},areas:[],cells:[]} as WorldPack;
    const key=worldContentCacheKey([],pack,"fixture","reader",[first]);
    expect(worldContentCacheKey([],pack,"fixture","reader",[changed])).not.toBe(key);
    expect(worldContentCacheKey([],pack,"fixture","reader",[])).not.toBe(key);
    expect(worldContentCacheKey([],pack,"fixture","next-reader",[first])).not.toBe(key);
  }
});
test("journal quest links and native onscreens resolve titles; unrelated content records and missing keys stay absent",()=>{
  const root=obj("gameJournalResource",{entry:h("gameJournalRoot",{entries:[
    h("gameJournalQuest",{id:"quest",title:{value:"LocKey#100"},entries:[h("gameJournalQuestMapPin",{id:"pin"})]}),
    h("gameJournalPointOfInterestMappin",{id:"gig",questPath:h("gameJournalPath",{realPath:"quest"})}),
    h("gameJournalPointOfInterestMappin",{id:"clinic",mappinData:obj("data",{typedVariant:h("variant",{variant:"ServicePointRipperdocVariant"})})}),
    h("gameJournalPointOfInterestMappin",{id:"unknown",recommendedLevelID:{$value:"123"}}),
  ]})});
  const journal=indexJournal(root),texts=new TextTable("en-us");
  addWorldTexts(texts,obj("JsonResource",{root:h("localizationPersistenceOnScreenEntries",{entries:[
    obj("entry",{primaryKey:"100",femaleVariant:"A local quest"}),obj("entry",{primaryKey:"101",femaleVariant:"A doctor"}),
    obj("entry",{primaryKey:"102",secondaryKey:"UI-MappinTypes-RipperdocServicePoint",femaleVariant:"Ripperdoc"})]})}),"fixture");
  const pois:Poi[]=["quest/pin","gig","clinic","unknown","absent"].map((journal,i)=>({id:String(i),place:"fixture",at:[0,0,0],kind:"Kind",journal}));
  const flat=new Map<number,TweakValue>([[tweakDbId("Mappins.clinic.localizedName"),{type:"gamedataLocKeyWrapper",value:"LocKey#101"}]]);
  const counts=coverage();resolvePoiTitles(pois,journal,{lookup:()=>flat},texts,counts);
  expect(pois.map(p=>p.title)).toEqual(["A local quest","A local quest","Ripperdoc - A doctor",undefined,undefined]);
  expect(counts.kept["poi.title"]).toBe(3);expect(counts.dropped["poi.title"]).toBe(2);
  const missing=pois.map(p=>({...p,title:undefined}));resolvePoiTitles(missing,journal,null,new TextTable("en-us"),coverage());expect(missing.every(p=>p.title===undefined)).toBe(true);
});
test("offer and race records resolve the game's fields; ambiguous and missing localisation never invent titles",()=>{
 const texts=new TextTable("en-us");texts.add([
  {primaryKey:"1",secondaryKey:"",female:"Circuit",male:""},{primaryKey:"2",secondaryKey:"",female:"City car",male:""},
  {primaryKey:"3",secondaryKey:"",female:"City apartment",male:""}],{id:"fixture",kind:"game",declaredBy:null});
 const root=obj("resource",{entry:h("root",{entries:[
  h("gameJournalPointOfInterestMappin",{id:"race",mappinData:obj("data",{typedVariant:h("variant",{variant:"Zzz18_RacingVariant"})})}),
  ...["Zzz01_CarForPurchaseVariant","Zzz05_ApartmentToPurchaseVariant"].map((variant,i)=>h("gameJournalPointOfInterestMappin",{id:`offer${i}`,slotName:{$value:"city"},mappinData:obj("data",{typedVariant:h("variant",{variant})})}))]})});
 const journal=indexJournal(root);journal.set(journalHash("ambiguous"),null);
 const values=new Map<number,TweakValue>([
  [tweakDbId("Mappins.race.title"),{type:"String",value:"LocKey#1"}],
  [tweakDbId("Vehicle.city_offer.name"),{type:"gamedataLocKeyWrapper",value:"LocKey#2"}],
  [tweakDbId("Vehicle.city_offer.brandName"),{type:"CName",value:"Brand"}],
  [tweakDbId("Apartment.city_offer.name"),{type:"String",value:"LocKey#3"}]]);
 const pois:Poi[]=["race","offer0","offer1","ambiguous"].map(journal=>({id:journal,place:"fixture",at:[0,0,0],kind:"Kind",journal}));
 resolvePoiTitles(pois,journal,{lookup:()=>values},texts,coverage());
 expect(pois.map(p=>p.title)).toEqual(["Circuit","Brand City car","City apartment",undefined]);
});
