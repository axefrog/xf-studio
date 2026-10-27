import {expect,test} from 'bun:test';
import {radiantProjection3} from '../../src/m3/baseline3.ts';
import {TEMPLATES} from '../../src/m3/arms.ts';
import type {Thread3} from '../../src/m3/measures3.ts';
function row(template:string,client:string,other:string):Thread3 {
 const vars:Record<string,string>={client,other,clientRole:'stallholder',otherRole:'gang member',place:'the market stalls',place2:'the clinic',item:'credstick',reward:'250'};
 return {id:template,arm:'A3',run:'a3',world:'w',tempo:'steady',policy:'ignore',start:0,patterns:[],occurrences:[{id:'ask',at:0,play:0,token:'ask(N1,P)',surface:TEMPLATES.find(t=>t.id===template)!.text.replace(/\{(\w+)\}/g,(_,key)=>vars[key]!),effects:[],channel:'message',source:'baseline'}],l1:['template:'+template],l2:['ask(N1,P)'],l3:[],edges:0,shownEdges:0,crossLayers:0,growth:0,outcome:'open',closingPattern:'none',closingPresented:false,known:false,escalation:{rung:0,allPull:null},deliveryIds:['ask']};
}
test('A3 masks its declared client and remembers people named before a later request',()=>{
 const seen=new Set<string>(),first=radiantProjection3(row('debt','Samira Rahman','Aiko Tanaka'),seen),second=radiantProjection3(row('escort','Aiko Tanaka','Samira Rahman'),seen);
 expect(first.l2).toEqual(['ask(N1,P)','end:open/none']);expect(first.known).toBe(false);expect(second.l2).toEqual(['ask(K1,P)','end:open/none']);expect(second.known).toBe(true);
});
test('A3 client recovery follows every authored template, including repeated client slots',()=>{
 for(const t of TEMPLATES){const projected=radiantProjection3(row(t.id,'Samira Rahman','Aiko Tanaka'),new Set(['Samira Rahman']));expect(projected.l2[0]).toBe('ask(K1,P)');}
});
