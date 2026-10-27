import type {Run} from './driver.ts';
import type {Pattern,RoleKind,CausalEdge} from '../seeding/pattern-types.ts';
import type {Thread3} from './measures3.ts';
import {library,vocabulary} from './run3.ts';
import {shuffle} from './blind.ts';
import {describe} from './threads3.ts';
import {actingArgument} from '../seeding/pattern-lint.ts';
import {evidence3} from './evidence3.ts';

export interface CastPool3 {protagonist:string; nodes:Array<{id:string;kinds:RoleKind[];name:string}>;}
/** Snapshot once, before the first simulation window. No event matching or later population lookup. */
export function initialPool3(r:Run):CastPool3 {
 const k=r.w.sim.k;
 // Resolve the deterministic resident population and use the same compatible-kind test as S3 casting.
 const residents=r.w.sim.w.districts.flatMap(d=>d.cellIds.flatMap(cell=>r.w.sim.people.residentsOfBlock(cell))).filter(id=>r.w.sim.people.view(id)?.ageClass==='adult');
 const kinds:RoleKind[]=['person','group','place','item','fact','event'];
 const nodes=[...k.store.headers.values()].map(h=>({id:h.id,kinds:kinds.filter(kind=>r.w.l3!.kv.isKind(h.kind,kind==='fact'?'core:game-fact':kind==='item'?'xf:item':'core:'+kind)),name:r.nameOf(h.id)})).filter(n=>n.kinds.length&&(!n.kinds.includes('person')||n.id===r.w.sim.w.v||residents.includes(n.id)));
 for(const id of residents)if(!nodes.some(n=>n.id===id))nodes.push({id,kinds:['person'],name:r.nameOf(id)});
 for(const n of nodes)if(n.kinds.includes('person')||n.kinds.includes('group'))n.kinds.push('actor');
 return {protagonist:r.w.sim.w.v,nodes:nodes.sort((a,b)=>a.id.localeCompare(b.id))};
}
interface Step3 {id:string;fn:string;args:Record<string,string>;links:CausalEdge[];acting?:string;l1:string[];}
export interface FixedPlan3 {patterns:string[];steps:Step3[];outcome:string;closing:string;refusal?:string;}
/** Compile a whole authored path before playback. Named children are expanded statically, not composed live. */
export function fixedPlan3(pattern:Pattern,pool:CastPool3,seed:string,patterns:Pattern[]=library):FixedPlan3 {
 const plan:FixedPlan3={patterns:[],steps:[],outcome:Object.values(pattern.outcomes)[0]!.kind,closing:pattern.id.split(':')[1]!};
 const fail=(why:string)=>{throw Error(why);};
 const node=new Map(pool.nodes.map(n=>[n.id,n]));
 function expand(p:Pattern,prefix:string,inherited:Record<string,string>,outcomeName?:string,ancestors:string[]=[]):string[]{
  if(ancestors.includes(p.id))fail('recursive child '+p.id);
  const outcome=(outcomeName&&outcomeName!=='any'?p.outcomes[outcomeName]:Object.values(p.outcomes)[0])??fail('unknown outcome '+p.id+'/'+outcomeName);
  const bindings={...inherited},used=new Set(Object.values(bindings));let playerBound=used.has(pool.protagonist);
  for(const [variable,role] of Object.entries(p.roles)){
   const kinds=Array.isArray(role.kind)?role.kind:[role.kind],accepts=(id:string)=>!!node.get(id)?.kinds.some(k=>kinds.includes(k))&&(id!==pool.protagonist||role.v==='may');
   if(bindings[variable]){if(!accepts(bindings[variable]!))fail('incompatible inherited role '+p.id+'/'+variable);continue;}
   const candidates=shuffle(pool.nodes.filter(n=>accepts(n.id)&&!used.has(n.id)),seed,prefix+variable);
   const chosen=role.v==='may'&&!playerBound&&accepts(pool.protagonist)?pool.protagonist:candidates[0]?.id;
   if(!chosen)fail('uncastable role '+p.id+'/'+variable+' ('+kinds.join('|')+')');
   bindings[variable]=chosen;used.add(chosen);playerBound ||= chosen===pool.protagonist;
  }
  const order=Object.keys(p.junctures),needed=new Set<string>(),visiting=new Set<string>();
  function require(key:string){
   if(needed.has(key))return;if(visiting.has(key))fail('cyclic path '+p.id);visiting.add(key);
   const j=p.junctures[key]??fail('missing juncture '+p.id+'/'+key),incoming=p.edges.filter(e=>e.to===key&&e.link!=='forecloses').sort((a,b)=>order.indexOf(a.from)-order.indexOf(b.from));
   let from=incoming.map(e=>e.from);
   if(j.join==='any')from=from.slice(0,1);
   else if(typeof j.join==='object')from=[...j.join.all,...j.join.any.slice(0,1)];
   for(const source of from)require(source);visiting.delete(key);needed.add(key);
  }
  for(const key of outcome.reached)require(key);
  if(outcome.foreclosed?.some(key=>needed.has(key))||p.edges.some(e=>e.link==='forecloses'&&needed.has(e.from)&&needed.has(e.to)))fail('contradictory authored path '+p.id);
  plan.patterns.push(p.id);const emitted=new Map<string,string[]>(),all:string[]=[];
  for(const key of order.filter(key=>needed.has(key))){
   const j=p.junctures[key]!,id=prefix+'/'+key;
   const links=p.edges.filter(e=>e.to===key&&e.link!=='forecloses').flatMap(e=>(emitted.get(e.from)??[]).slice(-1).map(from=>({...e,from,to:id})));
   if(j.fn==='story'){
    const child=patterns.find(c=>c.id===j.args.pattern)??fail('unknown child '+j.args.pattern);
    const binds=Object.fromEntries(Object.entries(j.binds??{}).map(([v,parent])=>[v,bindings[parent]??fail('unbound inherited role '+parent)]));
    const before=plan.steps.length,ids=expand(child,id,binds,j.args.outcome,[...ancestors,p.id]);
    if(plan.steps[before])plan.steps[before]!.links.push(...links.map(e=>({...e,to:plan.steps[before]!.id})));
    emitted.set(key,ids);all.push(...ids);
   }else{
    const args=Object.fromEntries(Object.entries(j.args).map(([a,v])=>[a,v==='v'?pool.protagonist:v.startsWith('?')?bindings[v]??fail('unbound argument '+p.id+'/'+v):v]));
    plan.steps.push({id,fn:j.fn,args,links,acting:actingArgument(j,vocabulary),l1:[...ancestors,p.id].map(id=>{const q=patterns.find(p=>p.id===id)!;return q.family+':'+id.split(':')[1];})});emitted.set(key,[id]);all.push(id);
   }
  }
  return all;
 }
 try{expand(pattern,pattern.id,{});}catch(error){plan.refusal=String((error as Error).message);plan.steps=[];}
 return plan;
}
export function fixedSlot3(pool:CastPool3,world:string,tempo:string,policy:string,n:number,patterns:Pattern[]=library,known=new Set<string>(),weights?:Record<string,number>):{thread?:Thread3;pattern:string;refusal?:string}{
 const distribution=patterns.flatMap(p=>Array.from({length:weights?weights[p.id]??0:1},()=>p));if(!distribution.length)throw Error('empty fixed root distribution');
 const pattern=shuffle(distribution,world+':'+tempo+':'+policy,'fixed-with-replacement-v2-'+n)[0]!,plan=fixedPlan3(pattern,pool,world+':'+n,patterns);
 if(plan.refusal)return {pattern:pattern.id,refusal:plan.refusal};
 const run=`${world}-${tempo}-${policy}-A5`,id=run+'-'+n,start=n*14400+100,at=n*86400+600;
 const t:Thread3={id,arm:'A5',run,world,tempo,policy,start,patterns:plan.patterns,occurrences:[],l1:plan.patterns.map(id=>{const p=patterns.find(p=>p.id===id)!;return p.family+':'+id.split(':')[1];}),l2:[],l3:[],edges:0,shownEdges:0,crossLayers:0,growth:0,outcome:plan.outcome,closingPattern:plan.closing,closingPresented:true,known:false,escalation:{rung:0,allPull:null},deliveryIds:[]};
 const names=new Map(pool.nodes.map(n=>[n.id,n.name])),name=(id:string)=>id===pool.protagonist?'you':names.get(id)||'the recorded subject';
 const masks=new Map<string,string>(),counts:Record<string,number>={};
 const mask=(id:string)=>{if(id===pool.protagonist)return 'P';if(masks.has(id))return masks.get(id)!;const ks=pool.nodes.find(n=>n.id===id)?.kinds??[],prefix=ks.includes('person')?known.has(id)?'K':'N':ks.includes('group')?'G':ks.includes('place')?'L':'I';const m=prefix+(counts[prefix]=(counts[prefix]??0)+1);masks.set(id,m);return m;};
 function push(key:string,fn:string,args:Record<string,string>,source:'fixed'|'completion',link?:string,stance?:string,l1:string[]=[]){const i=t.occurrences.length,token=fn+'('+Object.entries(vocabulary.functions[fn]?.args??{}).filter(([,kind])=>!['event','fact','pattern id','outcome name'].includes(String(kind))).map(([a])=>args[a]?mask(args[a]!):'?').join(',')+')'+(link?'<'+link:'')+(stance?'/'+stance:'');const surface=describe(fn,args,name);t.occurrences.push({id:id+key,at:at+i*600,play:start+i*100,token,surface,evidence:evidence3(surface,fn,args,name),l1,effects:[],channel:source==='completion'?'message':'trace',source,protagonist:!!stance,completion:source==='completion',stance});}
 for(const step of plan.steps){
  if(step.acting&&step.args[step.acting]===pool.protagonist&&step.fn!=='learn'){
   const other=Object.values(step.args).find(id=>id!==pool.protagonist&&pool.nodes.find(n=>n.id===id)?.kinds.includes('actor'))??pool.nodes.find(n=>n.id!==pool.protagonist&&n.kinds.includes('person'))?.id;
   if(!other)return {pattern:pattern.id,refusal:'uncastable offer speaker'};
   push(step.id+'/offer','ask',{by:other,of:pool.protagonist},'fixed',undefined,undefined,step.l1);t.occurrences.at(-1)!.askVerb=pattern.id==='xf.composite:coveted'?'retrieve':step.fn;t.occurrences.at(-1)!.evidence+=` Proposed act: ${describe(step.fn,step.args,name)} Available responses: accept; decline; leave unanswered.`;
   if(policy==='ignore'||policy==='decline'){if(policy==='decline')push(step.id+'/refuse','refuse',{who:pool.protagonist,to:other},'completion',undefined,'refuse');t.outcome='parked';t.closingPresented=false;break;}
   push(step.id+'/accept','comply',{who:pool.protagonist,to:other},'completion',undefined,'help');
  }
  const link=['because','but','motive','reveals','enables','answers'].find(x=>step.links.some(e=>e.link===x));
  push(step.id,step.fn,step.args,'fixed',link,undefined,step.l1);if(step.acting&&step.args[step.acting]===pool.protagonist)t.occurrences.at(-1)!.completion=true;t.edges+=step.links.length;
  // A declared edge alone is not an explanation in a factual account.
 }
 t.known=[...masks.values()].some(m=>m.startsWith('K'));for(const id of masks.keys())if(pool.nodes.find(n=>n.id===id)?.kinds.includes('person'))known.add(id);
 t.closingPlay=t.closingPresented?t.occurrences.at(-1)?.play:undefined;t.endingEvidence=t.closingPresented?`Recorded outcome: ${t.outcome}; closing pattern: ${t.closingPattern}.`:'The path stops at the unanswered or declined request.';
 t.l2=[...t.occurrences.map(o=>o.token),'end:'+t.outcome+'/'+t.closingPattern];t.l3=t.occurrences.map(o=>o.token+'|'+o.channel+'|'+(o.stance??''));t.deliveryIds=t.occurrences.map(o=>o.id);
 return {thread:t,pattern:pattern.id};
}
