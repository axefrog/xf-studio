import {expect,test} from 'bun:test';
import {distance,clusters,packageSize,mine,errand,bits,measures,type Thread3} from '../../src/m3/measures3.ts';
function t(id:string,l2:string[],extra:Partial<Thread3>={}):Thread3{return {id,arm:'E',run:'r',world:'w',tempo:'steady',policy:'engage',start:Number(id)||0,patterns:[],occurrences:[],l1:[],l2,l3:[],edges:0,shownEdges:0,crossLayers:0,growth:0,outcome:'open',closingPattern:'none',closingPresented:false,known:false,escalation:{rung:0,allPull:null},deliveryIds:[],...extra};}
test('M3c weighted edit handles role recasts and outcome endings',()=>{expect(distance(['wrong(N1,N2)<because'],['wrong(N2,N1)<because'])).toBe(0.5);expect(distance(['end:failed/loss'],['end:failed/debt'])).toBe(0.5);expect(distance([],[])).toBe(0);expect(distance([],['a'])).toBe(1);expect(distance(['wrong(N1,N2)'],['help(N1,N2)'])).toBe(1);});
test('M3c single linkage and 80 percent coverage',()=>{const rows=[t('0',['a','b','c','d']),t('1',['a','b','c','e']),t('2',['a','b','f','e']),t('3',['z'])];expect(clusters(rows).map(c=>c.length).sort()).toEqual([1,3]);expect(packageSize(rows)).toBe(2);expect(packageSize(rows.slice(0,3))).toBe(1);});
test('M3c recast is chronological within run',()=>{expect(measures([t('0',['a']),t('1',['a']),t('2',['a'],{run:'other',world:'other'})]).recastRate).toBeCloseTo(1/3);});
test('M3c templates never bridge thread boundaries',()=>{expect(mine([t('0',['a','b']),t('1',['c','a','b','c'])],2)).toHaveLength(0);const rows=Array.from({length:4},(_,i)=>t(String(i),['a','b','c']));expect(mine(rows)[0]!.seeds).toEqual(['w']);expect(measures(rows).templateRate).toBe(1);});
test('M3c errands ignore own completion and count independent development',()=>{const row=t('0',[],{occurrences:[{id:'ask',at:0,play:0,token:'ask',surface:'',effects:[],channel:'message',source:'offered',askVerb:'retrieve',protagonist:true},{id:'done',at:1,play:1,token:'done',surface:'',effects:[],channel:'message',source:'completion',completion:true}]});expect(errand(row)).toEqual({began:true,errand:true,grew:false});row.occurrences.push(...[2,3].map(i=>({id:String(i),at:i,play:i,token:'wrong',surface:'',effects:[],channel:'trace',source:'found' as const})));expect(errand(row)).toEqual({began:true,errand:false,grew:true});});
test('M3c prequential model and empty samples',()=>{expect(bits([['a','b'],['a','b']],[['a','b']],1)).toBeLessThan(bits([['a','b'],['a','b']],[['b','a']],1)!);expect(bits([],[],1)).toBeNull();expect(measures([]).recastRate).toBeNull();expect(measures([t('0',['a'])]).predictability.every(p=>p.orders.every(o=>o.bits===null))).toBe(true);});

test('R5 cuts each prior thread at evaluation time, excluding simultaneous/future occurrences and endings',()=>{
 const occurrence=(id:string,play:number,token:string)=>({id,play,at:play*6,token,surface:'',effects:[],channel:'trace',source:'found' as const});
 const prior=Array.from({length:5},(_,i)=>t(String(i),['a','future','end:resolved/help'],{occurrences:[occurrence('early'+i,i,'a'),occurrence('late'+i,1000,'future')],closingPresented:true,closingPlay:1000,outcome:'resolved',closingPattern:'help'}));
 // Evaluate at 10, 1000 (strict boundary) and 1001 (late observations now available).
 const tests=[10,1000,1001].map((start,i)=>t('test'+i,['a','end:open/none'],{start,occurrences:[occurrence('test'+i,start,'a')]})),rows=[...prior,...tests];
 const before=measures(rows).predictability.find(p=>p.exposure===5)!;
 expect(before.evaluations.map(e=>e.trainingTokens)).toEqual([5,5,15]);
 expect(before.evaluations.map(e=>e.latestTrainingPlay)).toEqual([4,4,1000]);
 for(const order of [1,2,3]){const expected=(2*bits(prior.map(()=>['a']),tests.slice(0,2).map(x=>x.l2),order)!+bits(prior.map(x=>x.l2),[tests[2]!.l2],order)!)/3;expect(before.orders[order-1]!.bits).toBeCloseTo(expected,12);}
 // With only the first two evaluation points, changing future tokens/ending cannot affect either model.
 const early=()=>measures(rows.slice(0,7)).predictability.find(p=>p.exposure===5)!;
 const initial=early();for(const p of prior){p.occurrences[1]!.token='unseen';p.l2[1]='unseen';p.outcome='failed';p.closingPattern='loss';p.l2[2]='end:failed/loss';}
 expect(early()).toEqual(initial);
});
