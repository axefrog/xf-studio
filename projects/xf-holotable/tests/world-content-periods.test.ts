import { expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { RedHandle, RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir";
import { ContentAssembler, WORLD_CONTENT_READER, checkCounts, selectSlice, type WorldContent } from "../src/world-content";
import { CONTENT_SECTOR_VERSION, mapContentNode, mapRegistryQuantities, encodeContentSector, decodeContentSector, type ContentNode, type ContentPlacement, type ContentSector } from "../src/world-content-data";
import { ContentBudget, CONTENT_LIMITS } from "../src/world-content-budget";
import { validateContent } from "../src/world-content-validation";
import { cachedWorldContent } from "../src/world-content-publication";
import { worldContentCacheKey } from "../src/world-content-source";
import type { WorldPack } from "../src/model";

const obj=(type:string,fields:Record<string,unknown>={})=>new RedObject(type,fields);
const handle=(type:string,fields:Record<string,unknown>={})=>new RedHandle(obj(type,fields));
const name=(value:string)=>({$value:value});
const pack:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"test",source:"test",built:"test"},cells:[],areas:[{id:"Districts.Test",name:"Test",kind:"district",poly:[[0,0],[10,0],[10,10],[0,10]],zlo:0,zhi:10}]};
const place=(index:number,nodeIndex:number,ref="0"):ContentPlacement=>({index,nodeIndex,ref,at:[1,1,1],orientation:[0,0,0,1]});
const sector=(nodes:ContentNode[],placements:ContentPlacement[]):ContentSector=>({version:CONTENT_SECTOR_VERSION,nodes,placements,variantIndices:[0],persistentNodeIndex:-1});
const node:ContentNode={nodeIndex:0,type:"worldCompiledCommunityAreaNode",sourceId:"9007199254740993",entries:[{name:"resident",phases:[{name:"normal",periods:[
 {name:"Morning",spots:["42","42","404"]},{name:"Day",spots:["43","42"]},{name:"_22_00",spots:["43"]},{name:"Alarm",spots:[]},{spots:["43"]},
]}]}]};
const registry:ContentNode={nodeIndex:2,type:"worldCommunityRegistryNode",registry:[{id:node.sourceId,entries:[{name:"resident",record:"1",quantities:[{phase:"normal",name:"Morning",quantity:0},{phase:"normal",name:"Day",quantity:3},{phase:"normal",name:"22:00",quantity:2},{phase:"normal",name:"Alarm",quantity:4},{phase:"normal",name:"Alarm",quantity:5}]}]}]};
function assembled(budget=new ContentBudget(),shared=false,withRegistry=true) {
 const out=new ContentAssembler(pack,selectSlice(pack,"test"),budget);
 out.addSector("synthetic",sector([node,{nodeIndex:1,type:"worldAISpotNode"},...(withRegistry?[registry]:[])],[place(0,0,"11"),place(1,1,"42"),place(2,1,"43"),...(withRegistry?[place(3,2,"18446744073709551615")]:[]),...(shared?[place(4,0,"12")]:[])]),[0]);
 out.finishCommunities();return out;
}
function content():WorldContent {
 const out=assembled();return {schema:"xfh/world-content-1",slice:{id:"test",title:"Test",places:["Districts.Test"]},source:{game:"test",archives:"test",reader:WORLD_CONTENT_READER,key:"key",built:"test"},records:{"1":{kind:"person"}},communities:out.communities,spots:out.spots,spawners:[],pois:[],counts:out.counts};
}

test("periods retain raw names, explicit zero quantities, deduplicated slice links and the phase union",()=>{
 const out=assembled(),c=out.communities[0],phase=c.entries[0].phases[0];
 expect(c.registry).toEqual({id:"18446744073709551615",sourceObjectId:"9007199254740993"});
 expect(phase.spots).toEqual(["42","43"]);
 expect(phase.periods).toEqual([{name:"Morning",quantity:0,spots:["42"]},{name:"Day",quantity:3,spots:["43","42"]},{name:"_22_00",spots:["43"]},{name:"Alarm",spots:[]}]);
 expect(out.spots.map(s=>s.communities)).toEqual([["11"],["11"]]);
 expect(out.counts.read["community.periods"]).toBe(5);expect(out.counts.kept["community.period.quantity"]).toBe(2);
 expect(out.counts.reasons["community.period.quantity"]).toEqual({"explicit registry period quantity unavailable":1,"ambiguous registry period quantity":1});
 expect(out.counts.dropped["community.period.condition"]).toBe(4);expect(out.counts.dropped["community.entry.quantity"]).toBe(1);checkCounts(out.counts);
 validateContent(content(),"key");
});

test("missing and partial registry identities remain absent; the registry placement id has its own fallback",()=>{
 const out=assembled(new ContentBudget(),false,false);expect(out.communities[0].registry).toBeUndefined();expect(out.counts.reasons["community.registry"]).toEqual({"registry instance unavailable":1});
 const partial=new ContentAssembler(pack,selectSlice(pack,"test"));
 partial.addSector("sector",sector([{...node,sourceId:undefined},registry],[place(0,0),place(1,2)]),[0]);partial.finishCommunities();expect(partial.counts.reasons["community.registry"]).toEqual({"sourceObjectId not stored":1});
 const fallback=new ContentAssembler(pack,selectSlice(pack,"test"));fallback.addSector("sector",sector([node,registry],[place(0,0),place(1,2)]),[0]);fallback.finishCommunities();expect(fallback.communities[0].registry?.id).toBe("sector:1");checkCounts(partial.counts);
});

test("native registry enrichment selects before expansion and keeps only explicit UInt16 quantities",()=>{
 const period=(fields:Record<string,unknown>)=>obj("communityPhaseTimePeriod",fields);
 const entry=handle("communitySpawnEntry",{entryName:name("resident"),quantity:99,phases:[handle("communitySpawnPhase",{phaseName:name("normal"),timePeriods:[period({hour:"Morning",quantity:0}),period({quantity:3}),period({hour:"22:00",quantity:2}),period({hour:"Night"})]})]});
 let expansions=0;const template=handle("communityCommunityTemplateData",{});
 Object.defineProperty(template.target!.fields,"entries",{get(){expansions++;return [entry];}});
 const item=(id:string,template:RedHandle)=>obj("worldCommunityRegistryItem",{communityId:obj("gameCommunityID",{entityId:obj("entEntityID",{hash:id})}),template});
 const unrelated=handle("communityCommunityTemplateData",{});Object.defineProperty(unrelated.target!.fields,"entries",{get(){throw Error("Unselected template expanded");}});
 const root=obj("worldCommunityRegistryNode",{communitiesData:[item("other",unrelated),item("1",template),item("2",template)]});
 const selected=mapRegistryQuantities(root,new Set(["1","2"]));expect(expansions).toBe(1);expect(selected[0].entries).toBe(selected[1].entries);
 expect(selected[0].entries[0]).toEqual({name:"resident",quantities:[{phase:"normal",name:"Morning",quantity:0},{phase:"normal",name:"Day",quantity:3},{phase:"normal",name:"22:00",quantity:2},{phase:"normal",name:"Night"}]});
 const out=new ContentAssembler(pack,selectSlice(pack,"test"));out.addSector("sector",sector([node,registry],[place(0,0),place(1,2)]),[0]);
 expect([...out.registrySourceIds()]).toEqual([node.sourceId!]);
 out.addRegistryQuantities([{id:node.sourceId,entries:selected[0].entries}],"sector:1");out.finishCommunities();expect(out.communities[0].entries[0].phases[0].periods[0].quantity).toBe(0);
 for(const quantity of [-1,1.5,65536,"2",null]) {const bad=obj("worldCommunityRegistryNode",{communitiesData:[item("1",handle("template",{entries:[handle("entry",{phases:[handle("phase",{timePeriods:[period({quantity})]})]})]}))]});expect(()=>mapRegistryQuantities(bad,new Set(["1"]))).toThrow(NativeMalformedError);}
});

test("compiled periods never invent conditions, quantities or entry caps from guessed fields or phase names",()=>{
 const mapped=mapContentNode(0,"worldCompiledCommunityAreaNode",obj("worldCompiledCommunityAreaNode",{area:handle("communityArea",{entriesData:[obj("entry",{entryName:name("resident"),quantity:20,phasesData:[obj("phase",{entryPhaseName:name("quest_fact_alarm"),timePeriodsData:[obj("period",{periodName:name("Night"),quantity:3,condition:name("quest_fact"),spotNodeIds:[]})]})]})]})}));
 expect(mapped.entries).toEqual([{name:"resident",phases:[{name:"quest_fact_alarm",periods:[{name:"Night",spots:[]}]}]}]);
 const out=new ContentAssembler(pack,selectSlice(pack,"test"));out.addSector("sector",sector([mapped],[place(0,0)]),[0]);out.finishCommunities();expect(out.communities[0].entries[0]).not.toHaveProperty("quantity");expect(out.communities[0].entries[0].phases[0].periods[0]).not.toHaveProperty("condition");
});

test("period expansion is shared once and every serialized placement still pays nested and link budgets",()=>{
 const out=assembled(new ContentBudget(),true);expect(out.communities[0].entries).toBe(out.communities[1].entries);expect(out.spots[0].communities).toEqual(["11","12"]);
 expect(out.counts.kept["community.periods"]).toBe(8);
 const base=assembled().budget.snapshot(),limits={...CONTENT_LIMITS,nested:base.nested};
 expect(()=>assembled(new ContentBudget(limits),true)).toThrow(NativeBudgetError);
 expect(()=>assembled(new ContentBudget({...CONTENT_LIMITS,links:5}))).toThrow(NativeBudgetError);
 const bounded=new ContentAssembler(pack,selectSlice(pack,"test"),new ContentBudget({...CONTENT_LIMITS,nested:2}));bounded.addSector("sector",sector([{nodeIndex:0,type:"worldCommunityRegistryNode",registry:[{id:"1",entries:[]}]}],[place(0,0)]),[0]);expect(()=>bounded.addRegistryQuantities([{id:"1",entries:[{name:"entry",quantities:[{name:"Day",quantity:2}]}]}],"sector:0")).toThrow(NativeBudgetError);
});

test("quantities reject other registry placements and ambiguous identities including an unstored quantity",()=>{
 const build=(entries:NonNullable<ContentNode["registry"]>[number]["entries"],registryId="reg")=>{
  const out=new ContentAssembler(pack,selectSlice(pack,"test"));
  const r={nodeIndex:2,type:"worldCommunityRegistryNode",registry:[{id:node.sourceId,entries:[{name:"resident",record:"1"}]}]};
  out.addSector("sector",sector([node,r],[place(0,0),place(1,2,"reg")]),[0]);
  out.addRegistryQuantities([{id:node.sourceId,entries}],registryId);out.finishCommunities();return out;
 };
 const entry={name:"resident",quantities:[{phase:"normal",name:"Day",quantity:2}]};
 const wrong=build([entry],"inactive-registry");expect(wrong.communities[0].entries[0].phases[0].periods[1].quantity).toBeUndefined();
 const duplicateEntry=build([entry,entry]);expect(duplicateEntry.counts.reasons["community.period.quantity"]["ambiguous registry entry"]).toBe(4);
 const duplicatePeriod=build([{...entry,quantities:[...entry.quantities,{phase:"normal",name:"Day"}]}]);
 expect(duplicatePeriod.communities[0].entries[0].phases[0].periods[1].quantity).toBeUndefined();expect(duplicatePeriod.counts.reasons["community.period.quantity"]["ambiguous registry period quantity"]).toBe(1);
});

test("w1.7 invalidates old files and rejects partial/corrupt period, quantity, condition and registry fields",async()=>{
 const file=join(tempDir("w1-periods-"),"test.content.json"),good=content(),signal=new AbortController().signal;
 expect(worldContentCacheKey([],pack,"test","w1.6")).not.toBe(worldContentCacheKey([],pack,"test"));
 for(const damage of [(v:WorldContent)=>{v.source.reader="w1.6";},(v:WorldContent)=>{delete (v.communities[0].entries[0].phases[0] as any).periods;},...[
  {name:"Day",spots:[],quantity:-1},{name:"Day",spots:[],quantity:"1"},{name:"Day",spots:[],quantity:65536},{name:"Day",spots:[],condition:0},{name:"Day",spots:[null]},null,
 ].map(period=>(v:WorldContent)=>{v.communities[0].entries[0].phases[0].periods=[period as never];}),...[
  {id:"registry"},{id:1,sourceObjectId:"1"},{id:"registry",sourceObjectId:"0"},null,
 ].map(registry=>(v:WorldContent)=>{v.communities[0].registry=registry as never;})]) {
  const bad=structuredClone(good);damage(bad);expect(()=>validateContent(bad,"key")).toThrow(NativeMalformedError);writeFileSync(file,JSON.stringify(bad));expect((await cachedWorldContent(file,"key",async()=>good,signal)).cached).toBe(false);
 }
 const s=sector([registry],[]);expect(decodeContentSector(encodeContentSector(s))).toEqual(s);
 expect(()=>decodeContentSector(encodeContentSector({...s,version:102}))).toThrow(NativeMalformedError);
 for(const quantity of [-1,null,"1",65536]) {const bad=structuredClone(s);bad.nodes[0].registry![0].entries[0].quantities![0].quantity=quantity as never;expect(()=>decodeContentSector(encodeContentSector(bad))).toThrow(NativeMalformedError);}
});
