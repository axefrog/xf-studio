import {expect,test} from 'bun:test';
import {quality3} from '../../src/m3/quality3.ts';
import type {Thread3} from '../../src/m3/measures3.ts';
const row=():Thread3=>({id:'entry',arm:'E',run:'run',world:'world',tempo:'steady',policy:'engage',start:1,patterns:['xf.composite:heist'],occurrences:[{id:'first',at:1,play:1,token:'hold(N1,I1)',surface:'',effects:[],channel:'trace',source:'found'},{id:'answer',at:2,play:2,token:'comply(P,N1)/help',surface:'',effects:[],channel:'message',source:'completion',protagonist:true,stance:'help',completion:true},{id:'rung',at:3,play:3,token:'transfer(I1,N1,N2)',surface:'',effects:[],channel:'trace',source:'offered',protagonist:true}],l1:[],l2:[],l3:[],edges:0,shownEdges:0,crossLayers:0,growth:3,outcome:'open',closingPattern:'none',closingPresented:false,known:true,escalation:{rung:1,allPull:null},deliveryIds:[]});
test('M3c quality distinguishes continuation seeds, missing F14 and unsupported pull evidence',()=>{
 const t=row(),q=quality3(t,[]);expect(q.growth).toBe(0);expect(q.continuationSeeds).toBe(3);expect(q.knownF14).toBeNull();expect(q.escalation.allPull).toBeNull();expect(q.occurrences[2]!.completion).toBe(true);expect(t.occurrences[2]!.completion).toBeUndefined();
});
test('M3c quality requires a perceived protagonist act between anchor and escalation',()=>{
 const decisions=[{rule:'consequence',chain:['first'],data:{instance:'i',juncture:'held'}},{rule:'adaptation',chain:['rung'],data:{instance:'i',juncture:'run'}},{rule:'sow',data:{rivals:[{entry:'entry',features:{F14:1}}]}}];
 expect(quality3(row(),decisions).escalation.allPull).toBe(true);expect(quality3(row(),decisions).knownF14).toBe(true);
 const t=row();t.occurrences=t.occurrences.filter(o=>o.id!=='answer');t.occurrences[1]!.stance=undefined;expect(quality3(t,decisions).escalation.allPull).toBe(false);
});
