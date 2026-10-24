import { expect } from 'bun:test';
import { H, s } from '../src/id.ts';
import { Kernel, type ContributionSpec } from '../src/kernel.ts';
import type { EventSpec } from '../src/events.ts';
import { coreKernel } from './helpers.ts';

/** Stratified lifecycle grammar: draw identity/order/time within each lifecycle, then follow with
 * arbitrary operations. Coverage does not depend on an unlikely random conjunction of save,
 * release, mutation, sweep and re-reference. Every assertion is the same three-way oracle.
 */
export function runCoverageEpisode(seed: number, snapshot: boolean, observe: (k: Kernel, place: string) => unknown) {
 const name=`coverage-${seed}`, mode=(seed-1)%8, config={snapshotEvery:snapshot?1:10000};
 let runs=[0,1,2].map(()=>coreKernel(name,undefined,config)), serial=0, operations=0, saves=0, loads=0;
 const creator=runs[0].root('producer','core:person'),place=runs[0].root('place','core:place'),root=H(s('consumer'));
 for(const k of runs.slice(1)){k.root('producer','core:person');k.root('place','core:place');}
 const compare=(label:string)=>{
  const expected=observe(runs[0],place);
  expect(observe(runs[1],place),`property semantic: episode ${mode}/${seed}/${snapshot} ${label}, swept`).toEqual(expected);
  expect(observe(runs[2],place),`property semantic: episode ${mode}/${seed}/${snapshot} ${label}, replay`).toEqual(expected);
 };
 const step=(label:string,op:(k:Kernel,run:number)=>unknown)=>{
  const values=runs.map((k,i)=>structuredClone(op(k,i))); operations++;
  expect(values[1],`property semantic: ${label} swept return`).toEqual(values[0]);
  expect(values[2],`property semantic: ${label} replay return`).toEqual(values[0]); compare(label);
 };
 const sweep=()=>step('sweep',(k,i)=>{if(i)k.retention.scheduleSweep();k.settle();});
 const save=(reload=true)=>{
  for(const k of runs)k.settle();
  const key=`save-${serial++}`,records=runs.map(k=>k.persistence.save(key));saves++;
  expect(records[1],'property semantic: swept save').toEqual(records[0]);expect(records[2],'property semantic: replay save').toEqual(records[0]);
  if(reload){const fresh=coreKernel(name,undefined,config);for(const [id,r] of runs[2].persistence.chain)fresh.persistence.chain.set(id,structuredClone(r));fresh.persistence.load(key);runs[2]=fresh;loads++;}
  compare(key);
 };
 const spec:EventSpec={creator,cause:creator,name:'event',kind:'arrival',time:0,place,
  participants:[{who:creator,role:'actor'}],effects:[{on:creator,effect:'harm'}]};
 let eid='',edge='',own='',authored='';
 const create=()=>{
  step('create',k=>{eid=k.events.mintEvent(spec);edge=k.store.edgesFrom(eid)[0].id;
   own=k.store.contributionsNaming(eid).find(c=>c.target.slot==='time')!.id;return eid;});
 };
 const retain=()=>step('retain',k=>k.retention.setSeed({id:root,state:{},nodes:[eid]}));
 const release=()=>step('release',k=>k.retention.endSeed(root));
 if(mode===2 || mode===3){
  let descriptor='',item='',time=0,person='';
  step('descriptor',k=>{person=k.mint(creator,creator,'person','core:person');
   descriptor=k.summaries.mintSummary({creator,cause:creator,name:'summary',kind:'arrival',from:0,length:10,scope:place,count:1});
   item=k.summaries.materialise(descriptor,0);time=k.value(item,'time') as number;
   k.retention.setSeed({id:root,state:{},nodes:[item]});});save();
  if(mode===2){
   step('ephemeral overlay',k=>{k.contribute({source:{layer:'simulation',origin:'temporary-overlay'},target:{slot:'participants#count',scope:{nodes:[item]}},
    form:{f:'const',value:1},mode:'constrain',valid:{from:0,to:1},silent:true});k.now=2;});
  }
  step('open item',k=>{k.mintSilent(creator,creator,'person','core:person');return k.events.restoreEvent({creator:descriptor,cause:descriptor,name:'item:0',time,kind:'arrival',
   participants:[{who:person,role:'actor'}],effects:[{on:person,effect:'harm'}]}, {descriptor,materialisation:'scene.acts'});});save();
  if(mode===3){
   step('withdraw descriptor',k=>{for(const p of k.store.pinsOfNode(descriptor).sort((a,b)=>a.id.localeCompare(b.id)))k.withdrawPin(p.id,creator);k.retention.endSeed(root);});
   sweep();save();
   step('partial header',k=>{k.store.addHeader({id:item,kind:'core:event',origin:{by:'minted',creator:descriptor,cause:descriptor,name:'item:0'}});return item;});
   step('re-reference item',k=>k.retention.setSeed({id:root,state:{},nodes:(seed>>>3)%2?[item,descriptor]:[descriptor,item]}));save();
  }
 }else if(mode===4){
  let target='',cid='';const origin=H(s('external-author'));
  step('never-saved header',k=>{target=k.mint(creator,creator,'target','core:event');
   cid=k.contribute({source:{layer:'authored',origin},target:{slot:'time',scope:{nodes:[target]}},form:{f:'const',value:42},mode:'constrain'}).id;});
  save();step('end orphan',k=>{k.now=10;k.endContribution(cid,30);});sweep();save();
  step('known live header',k=>{k.root('producer','core:person');return k.mintSilent(creator,creator,'target','core:event');});
  step('partial fact eviction',k=>{k.store.removeContribution(cid);k.bump();});
  step('recover known live header',k=>{k.persistence.restoreReferencedHeader(target);});
  step('retain orphan',k=>k.retention.setSeed({id:root,state:{},nodes:[target]}));save();
 }else if(mode===5){
  create();let rule='';
  step('general rule',k=>{rule=k.contribute({source:{layer:'authored',origin:eid},target:{kind:'core:event',slot:'outcome'},form:{f:'const',value:'done'},mode:'constrain'}).id;});
  save();sweep();step('general end',k=>k.endContribution(rule,20));save();
 }else{
  create();
  if(mode===7){
   // First exercise a wholly regenerable, never-saved event. A surviving constant must not
   // suppress restoration of its swept owned headers. Later edits still precede its first save.
   save();sweep();
   step('evict regenerable pieces',(k,run)=>{
    if(!run)return;
    const role=k.store.allContributions().find(c=>c.source.origin===eid && c.target.slot==='role');
    if(role)k.store.removeContribution(role.id);k.store.removeEdge(edge);k.bump();
   });
   step('never-saved header first',k=>{k.root('producer','core:person');k.root('place','core:place');return k.mintSilent(creator,creator,spec.name,'core:event');});
   step('never-saved complete payload',k=>k.events.restoreEvent(spec));retain();release();
  }
  const original:ContributionSpec={source:{layer:'authored',origin:eid},target:{slot:'time',scope:{nodes:[eid]}},form:{f:'const',value:42},mode:'constrain'};
  if(mode!==7){step('authored fact',k=>{authored=k.contribute(original).id;});retain();}
  if(mode===1){step('first end',k=>k.endEdge(edge,0));save();step('equal-start reopen',k=>k.reopenEdge(edge,0));}
  else if(mode!==7)save();
  if(mode===0 || mode===6){
   step('end own and authored',k=>{k.endContribution(mode===6?own:authored,10);});
   if(mode===6)save();
  }
  if(mode===7){
   step('unsaved changes',k=>{k.endEdge(edge,10);k.updateEdge(edge,{data:{proof:seed}});k.endContribution(own,10);});
   sweep();save();
   // Unsaved regeneration also encounters a surviving header with only part of its payload.
   step('header first',k=>k.mintSilent(creator,creator,'event','core:event'));
  }else{release();sweep();}
  if(mode===0 || mode===1){step('edge end',k=>k.endEdge(edge,30));save();}
  if(mode===0)step('direct original submission',k=>k.contribute(original));
  if(mode===6){step('unretained saved own end',k=>k.endContribution(own,8));save();step('regenerate ended own facts',k=>k.events.mintEvent(spec));}
  if(mode===7){
   // Model partial cache eviction independently of save recovery; all three runs lose the same field.
   step('partial unsaved field',k=>{k.events.restoreEvent(spec);const m=k.address(eid,'participants[0]');
    const c=k.store.contributionsNaming(m).find(c=>c.target.slot==='role');if(c)k.store.removeContribution(c.id);k.store.removeEdge(edge);k.bump();});
   step('complete payload',k=>k.events.restoreEvent(spec));
  }
  retain();save();
  // Direct saved-reference operations must work after release without an author supplying a recipe.
  release();sweep();step('observation reference',k=>k.observeAs(creator,eid,'kind',0));save();
 }
 save();return {operations,saves,loads};
}


