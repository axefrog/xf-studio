import { expect, test } from "bun:test";
import { agentRevisions } from "../src/features/holotable/agent-revisions";
import type { AgentAnswer, AgentItem } from "../src/features/holotable/agent-types";
const signal=()=>new AbortController().signal;
const item=(id:string,version=0):AgentItem=>({id,key:`p/a/${id}`,version,kind:"point",place:[1,2,3],anchor:{at:[1,2,3]}});
const answer=(items:readonly AgentItem[]):AgentAnswer=>({here:[],specs:{schema:"xfh/projections-1",kinds:{point:{style:"tone",draw:"ring",label:"{label}"},path:{style:"tone",draw:"polyline",label:"{label}"},zone:{style:"tone",draw:"volume",label:"{label}"}}},layers:[{id:"p/a",producer:"p",layer:"a",title:"A",items,notPlaced:[],otherBranches:[],refused:0,reason:""}]});

test("resolved versions produce only changed markers; baseline, unchanged and unseen transitions do not animate",async()=>{
 const revisions=agentRevisions(),base=answer([item("a"),item("b")]);
 expect((await revisions.answer(base,signal())).changes).toEqual([]);
 expect((await revisions.answer(answer([item("a"),item("b")]),signal())).changes).toEqual([]);
 const changed=await revisions.answer(answer([item("a",1),item("c")]),signal());
 expect(changed.changes.map(({key,kind})=>({key,kind}))).toEqual([{key:"p/a/a",kind:"pulse"},{key:"p/a/c",kind:"pulse"},{key:"p/a/b",kind:"fade"}]);
 const next=await revisions.answer(answer([item("a",1),item("c")]),signal());expect(next.changes).toEqual([]);
 revisions.reset();expect((await revisions.answer(answer([]),signal())).changes).toEqual([]);
});

test("all 5,000 answered revisions are indexed independently of painting; the last retraction is retained",async()=>{
 const revisions=agentRevisions(),items=Array.from({length:5000},(_,i)=>item(String(i)));
 await revisions.answer(answer(items),signal());
 const removed=await revisions.answer(answer(items.slice(0,-1)),signal());expect(removed.changes).toHaveLength(1);expect(removed.changes[0]).toMatchObject({kind:"fade",key:"p/a/4999"});
});

test("history changes wholly between answered snapshots produce no pulse or fade",async()=>{
 const revisions=agentRevisions(),before=answer([item("a")]);
 await revisions.answer(before,signal());
 const next=answer([item("a")]),after={...next,layers:[{...next.layers[0],changes:[0,1,2]}]};
 expect((await revisions.answer(after,signal())).changes).toEqual([]);
 expect(after.layers[0].changes).toEqual([0,1,2]);
});

test("marker snapshots contain no item or story data and paths/zones have no retraction fade",async()=>{
 const revisions=agentRevisions(),position:[number,number,number]=[1,2,3],point={...item("a"),place:position};
 const full={...point,glyph:"fixer",tone:"accent",label:"secret label",detail:"secret detail",facets:{doing:"secret thought"},value:{name:"secret name"}};
 const baseline=await revisions.answer(answer([full,{...item("path"),kind:"path"},{...item("zone"),kind:"zone"}]),signal());
 expect(JSON.stringify(baseline)).not.toContain("secret");position[0]=900;
 const removed=await revisions.answer(answer([]),signal());expect(removed.changes).toHaveLength(1);
 expect(removed.changes[0].marker).toEqual({point:[1,2,3],tone:"accent",marker:"ring",glyph:"fixer"});
 expect(Object.keys(removed.changes[0].marker).sort()).toEqual(["glyph","marker","point","tone"]);
});

test("a newer answer cancels an unfinished diff without committing its partial revision index",async()=>{
 let release!:()=>void,block=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 const revisions=agentRevisions(()=>block?gate:Promise.resolve());
 await revisions.answer(answer([item("a")]),signal());block=true;
 const old=new AbortController(),pending=revisions.answer(answer(Array.from({length:300},(_,i)=>item(String(i)))),old.signal);
 block=false;const latest=await revisions.answer(answer([item("a",2)]),signal());expect(latest.changes.map(c=>c.key)).toEqual(["p/a/a"]);
 release();await expect(pending).rejects.toThrow("Superseded revision answer");
 const removed=await revisions.answer(answer([]),signal());expect(removed.changes.map(c=>c.key)).toEqual(["p/a/a"]);
});
