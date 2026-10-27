import {expect,test} from 'bun:test';
import {packet3,score3,criteria3,type Answer3,type Packet3} from '../../src/m3/blind3.ts';
import type {Arm3,Thread3} from '../../src/m3/measures3.ts';
import {threadText} from '../../src/m3/blind3.ts';
function trace(arm:Arm3,policy:string,i:number,sequence:string):Thread3{return {id:arm+'-'+policy+'-'+i,arm,run:arm+'-'+policy,world:'world',tempo:'steady',policy,start:i*100,patterns:[],occurrences:[{id:sequence,at:i*600,play:i*100,token:'help(N1,N2)',surface:sequence,evidence:sequence,effects:[],channel:'trace',source:'found'}],l1:[],l2:['help(N1,N2)','end:open/none'],l3:[],edges:0,shownEdges:0,crossLayers:0,growth:0,outcome:'open',closingPattern:'none',closingPresented:false,known:false,escalation:{rung:0,allPull:null},deliveryIds:[]};}
function fixture(){const rows:Thread3[]=[];for(const policy of ['p1','p2','p3'])for(const arm of ['E','A1','A3','A5'] as Arm3[])for(let i=0;i<4;i++){let seq=arm+'-'+policy+'-'+i;if((arm==='E'||arm==='A1')&&i===0)seq='shared-'+policy;if(arm==='E'&&policy==='p1'&&i===1)seq='shared-p1';if(arm==='A1'&&policy==='p2'&&i===1)seq='shared-p1';const t=trace(arm,policy,i,seq);if(seq.startsWith('shared-'))t.occurrences[0]!.at=0;rows.push(t);}return rows;}
function answer(p:Packet3,sheet=1):Answer3{return {rater:'fixture',sheet,cards:Object.fromEntries(p.cards.map(c=>[c.id,{...Object.fromEntries(criteria3.map(cr=>[cr,p.key[c.id]!.sequence?.[0]==='shared-p1'?7:1])),seen:'new',cue:'fixture'}])) as Answer3['cards'],pairs:Object.fromEntries(p.pairs[sheet-1]!.map(pair=>[pair.id,{follow:pair.left===pair.e?'left':'right',caused:pair.left===pair.e?'left':'right'}])),sort:[p.sort]};}

test('canonical accounts retain same-arm and cross-configuration multiplicities without a second reading',()=>{
 const rows=fixture(),p=packet3(rows,12),shared=p.cards.find(c=>p.key[c.id]!.sequence?.[0]==='shared-p1')!,k=p.key[shared.id]!;
 expect(p.sampleSize).toBe(48);expect(p.cards.length).toBeLessThan(48);expect(k.multiplicity).toEqual({E:2,A1:2});expect(new Set(k.memberships!.map(m=>m.configuration)).size).toBe(2);
 for(const m of k.memberships!){const source=rows.find(t=>t.id===m.thread&&t.run===m.run&&t.arm===m.arm)!;expect(m.start).toBe(source.start);expect(m.times).toEqual(source.occurrences.map(o=>({id:o.id,at:o.at,play:o.play})));}
 const alias=new Map(Object.entries(p.key).flatMap(([id,k])=>k.memberships!.map(m=>[m.sample,id] as const)));
 for(let sheet=0;sheet<4;sheet++){expect(new Set(p.orders[sheet]).size).toBe(p.cards.length);expect(p.orders[sheet]).toEqual([...new Set(p.sourceOrders![sheet]!.map(id=>alias.get(id)!))]);}
});

test('one canonical answer preserves every weighted arm/configuration mean and reports unweighted means',()=>{
 const p=packet3(fixture(),12),a=answer(p),s=score3(p,a),e=s.arms.find(r=>r.arm==='E')!;
 expect(e.n).toBe(12);expect(e.mean.lives).toBe(2);expect(e.unweighted.n).toBe(11);expect(e.unweighted.mean.lives).toBeCloseTo(17/11);
 for(const row of s.configurations){const memberships=p.cards.flatMap(c=>p.key[c.id]!.memberships!.filter(m=>m.arm===row.arm&&m.configuration===row.configuration).map(()=>c.id));expect(row.weighted.n).toBe(4);expect(row.weighted.mean.lives).toBe(memberships.reduce((n,id)=>n+a.cards[id]!.lives,0)/4);}
 for(const sheet of [0,1]){for(const pair of p.pairs[sheet]!){expect(pair.left).not.toBe(pair.right);expect(p.cards.find(c=>c.id===pair.left)!.texts[sheet]).not.toBe(p.cards.find(c=>c.id===pair.right)!.texts[sheet]);expect(pair.renderer).toBe(p.key[pair.e!]!.variants[sheet]!.renderer);}const totals=score3(p,answer(p,sheet+1)).choices.find(c=>c.against==='A1'&&c.renderer==='all')!;expect(totals.total).toBe(12);expect(totals.ties).toBeGreaterThan(0);expect(totals.follow).toBe(totals.n);expect(totals.followLosses).toBe(0);}
});

test('different sequence IDs with identical shown text are omitted and counted as ties',()=>{
 const rows=(['E','A1','A3','A5'] as Arm3[]).flatMap(arm=>[0,1].map(i=>{const t=trace(arm,'same',i,arm+i);if(arm==='E'||arm==='A1'){t.occurrences[0]!.surface='The same account.';t.occurrences[0]!.evidence='The same account.';t.occurrences[0]!.at=0;}return t;})),p=packet3(rows,2);
 expect(p.omitted![0]!.filter(x=>x.against==='A1'&&x.reason==='identical')).toHaveLength(2);const score=score3(p,answer(p)).choices.find(c=>c.against==='A1'&&c.renderer==='all')!;expect(score.n).toBe(0);expect(score.ties).toBe(2);expect(score.total).toBe(2);
});

for(const field of ['surface','evidence','stance','token','l2','respondsTo'] as const)test(`matching occurrence IDs do not merge accounts with different ${field}`,()=>{
 const rows=fixture(),original=rows.find(t=>t.arm==='E'&&t.policy==='p1'&&t.start===0)!,changed=rows.find(t=>t.arm==='A1'&&t.policy==='p1'&&t.start===0)!;
 for(const renderer of ['current','evidence'] as const)expect(threadText(original,renderer)).toBe(threadText(changed,renderer));expect(original.l2).toEqual(changed.l2);
 if(field==='l2')changed.l2=['bargain(P,N1)/bargain','end:open/none'];else changed.occurrences[0]![field]='different';
 const p=packet3(rows,12),group=(t:Thread3)=>p.cards.find(c=>p.key[c.id]!.memberships!.some(m=>m.thread===t.id&&m.run===t.run))!.id;
 expect(group(original)).not.toBe(group(changed));
});
