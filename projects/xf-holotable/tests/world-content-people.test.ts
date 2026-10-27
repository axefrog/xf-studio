import { expect, test } from "bun:test";
import { TweakDbBlob, TWEAKDB_MAGIC, childId, type TweakValue } from "../../xf-studio/authoring/src/game/tweakdb-flats";
import { TextTable } from "../../xf-studio/authoring/src/game/game-text";
import { resolveCommunityPeople } from "../src/world-content-people";
import { journalHash } from "../src/world-content-resources";
import { coverage, type Community } from "../src/world-content";

test("compiled record table reads actual types without names and bounds truncated tables",()=>{
 const bytes=new Uint8Array(64),v=new DataView(bytes.buffer);
 for(const [offset,value] of [[0,TWEAKDB_MAGIC],[4,8],[8,4],[16,32],[20,36],[36,2]])v.setUint32(offset,value,true);
 v.setBigUint64(40,123n,true);v.setUint32(48,journalHash("Character"),true);
 v.setBigUint64(52,456n,true);v.setUint32(60,journalHash("Vehicle"),true);
 const db=new TweakDbBlob(bytes);expect([...db.recordTypes([123,456,789])]).toEqual([[123,journalHash("Character")],[456,journalHash("Vehicle")]]);
 v.setUint32(36,3,true);expect(()=>db.recordTypes([123])).toThrow("truncated");
});
test("affiliation and localized names come from compiled flats; vehicles and unresolved records don't become people",()=>{
 const types=new Map([[1,journalHash("Character")],[2,journalHash("Character")],[3,journalHash("Vehicle")],[4,journalHash("Character")],[5,journalHash("Character")]]);
 const flats=new Map<number,TweakValue>([
  [childId(1,".affiliation"),{type:"TweakDBID",value:10}],[childId(2,".affiliation"),{type:"TweakDBID",value:10}],
  [childId(4,".affiliation"),{type:"TweakDBID",value:11}],
  [childId(10,".localizedName"),{type:"gamedataLocKeyWrapper",value:"LocKey#100"}],
  [childId(11,".localizedName"),{type:"gamedataLocKeyWrapper",value:"LocKey#101"}],
  [childId(1,".fullDisplayName"),{type:"gamedataLocKeyWrapper",value:"LocKey#102"}],
 ]);
 const db={recordTypes:()=>types,lookup:(ids:Iterable<number>)=>new Map([...ids].flatMap(id=>flats.has(id)?[[id,flats.get(id)!] as const]:[]))};
 const texts=new TextTable("en-us");texts.add(["Unit A","Unit B","Officer"].map((female,i)=>({primaryKey:String(100+i),secondaryKey:"",female,male:""})),{id:"fixture",kind:"game",declaredBy:null});
 const group=(id:string,records:number[]):Community=>({id,place:"test",entries:records.map(record=>({name:String(record),record:String(record),recordName:record===3?"Character.misleading":"Vehicle.misleading",phases:[]}))});
 const communities=[group("same",[1,2,3]),group("mixed",[1,4]),group("unknown",[1,9]),group("vehicles",[3]),group("missingAffiliation",[5])],counts=coverage();
 resolveCommunityPeople(communities,db,new Map([["10","Factions.UnitA"]]),texts,counts);
 expect(communities[0].affiliation).toEqual({record:"10",recordName:"Factions.UnitA",title:"Unit A"});
 expect(communities[0].entries.map(e=>e.kind)).toEqual(["person","person","vehicle"]);
 expect(communities[0].entries[0].displayName).toBe("Officer");
 expect(communities.slice(1).every(c=>c.affiliation===undefined)).toBe(true);
 expect(counts.kept["community.personAffiliation"]).toBe(5);
 expect(counts.dropped["community.personAffiliation"]).toBe(1);
 resolveCommunityPeople(communities,db,new Map(),new TextTable("en-us"),coverage());expect(communities.every(c=>!c.affiliation)).toBe(true);
 resolveCommunityPeople(communities,null,new Map(),texts,coverage());expect(communities.every(c=>!c.affiliation&&c.entries.every(e=>!e.kind&&!e.affiliation&&!e.displayName))).toBe(true);
});
