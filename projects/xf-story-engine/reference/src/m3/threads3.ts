import type {Run} from './driver.ts';
import type {PoolEntry,EventView} from '../procedural/types.ts';
import type {MatchedFiller} from '../procedural/graph-types.ts';
import type {Arm3,Occurrence,Thread3} from './measures3.ts';
import {vocabulary} from './run3.ts';
import {evidence3,tiedOrder3} from './evidence3.ts';
import {fillerId} from '../procedural/graph-world.ts';
const LINKS=['because','but','motive','reveals','enables','answers'];
export class ThreadArchive {
 entries=new Map<string,PoolEntry>(); groups:string[][]=[]; seenAware=new Set<string>();
 decisions:unknown[]=[]; gates=new Map<string,{rule:string;entry:string;condition?:string;count:number}>();
 snapshots=0;
 events=new Map<string,EventView>(); canonical=new Map<string,MatchedFiller>();
 private stateCanonical(r:Run,f:MatchedFiller):MatchedFiller {
  const old=this.canonical.get(f.id);if(old)return old;
  const port=r.w.l2.reg.patternWorld;
  for(const fn of vocabulary.tokenPrecedence)for(const rule of port?.stateRules(fn)??[])for(const arg of vocabulary.functions[fn]?.searchFrom??[])for(const node of Object.values(f.args)){
   const found=rule.search(arg,node,f.at,32).fills.find(row=>fillerId(row.filler)===f.id);
   if(found){const result={...f,fn,args:{...found.args}};this.canonical.set(f.id,result);return result;}
  }
  this.canonical.set(f.id,f);return f;
 }
 capture(r:Run){const l=r.w.l3!;l.refresh();this.snapshots++;
  for(const e of l.state.pool)if(e.graph){this.entries.set(e.id,structuredClone(e));for(const j of Object.values(e.graph.junctures))if(j.filler&&'event' in j.filler.ref){const ev=l.kv.event(j.filler.id);if(ev){this.events.set(ev.id,structuredClone(ev));const fs=l.sifter.graph.world.eventFills(ev).filter(f=>f.fn!=='learn').sort((a,b)=>vocabulary.tokenPrecedence.indexOf(a.fn)-vocabulary.tokenPrecedence.indexOf(b.fn));if(fs[0])this.canonical.set(ev.id,structuredClone(fs[0]));}}}
  for(const t of l.threadView){const members=[...(t.patterns??[]),...t.instances];if(members.length)this.groups.push(members);if(t.aware)members.forEach(id=>this.seenAware.add(id));}
  for(const i of l.l2.all())for(const id of [...i.st.deliveries.flatMap(d=>d.offerEvent?[d.offerEvent]:[]),...i.st.record.flatMap(x=>x.kind==='response'&&typeof x.data.event==='string'?[x.data.event]:[])]){const ev=l.kv.event(id);if(ev){this.events.set(id,structuredClone(ev));const fs=l.sifter.graph.world.eventFills(ev).filter(f=>f.fn!=='learn').sort((a,b)=>vocabulary.tokenPrecedence.indexOf(a.fn)-vocabulary.tokenPrecedence.indexOf(b.fn));if(fs[0])this.canonical.set(id,structuredClone(fs[0]));}}
  for(const log of l.log){if(log.rule.startsWith('gate-')){const d=log.data as {entry:string;condition?:string};const key=JSON.stringify([log.rule,d.entry,d.condition]);const g=this.gates.get(key)??{rule:log.rule,entry:d.entry,condition:d.condition,count:0};g.count++;this.gates.set(key,g);}else if(['sow','sow-refused','adaptation','consequence','match-complete','near-miss','unborne','query-truncated'].includes(log.rule))this.decisions.push(structuredClone(log));}
  // This diagnostic sink has no engine reader. Bound memory without changing its state or policy.
  l.log.length=0;
 }
 threads(r:Run,arm:Arm3,run:string):Thread3[]{
  const l=r.w.l3!,parent=new Map<string,string>();const root=(id:string):string=>{if(!parent.has(id))parent.set(id,id);const p=parent.get(id)!;if(p===id)return id;const rt=root(p);parent.set(id,rt);return rt;};const union=(a:string,b:string)=>{a=root(a);b=root(b);if(a!==b)parent.set(b,a);};
  for(const g of this.groups)g.forEach(id=>union(g[0]!,id));
  const grouped=new Map<string,PoolEntry[]>();for(const e of this.entries.values()){const rt=root(e.id);grouped.set(rt,[...(grouped.get(rt)??[]),e]);}
  const rows:Thread3[]=[];
  for(const [id,entries] of grouped){
   const members=r.w.l2.all().filter(i=>root(i.id)===root(id)||entries.some(e=>e.graph!.seeds.some(s=>s.seed===i.id)));
   const occurrences=new Map<string,{f:MatchedFiller;at:number;play:number;fns:string[]}>();
   for(const e of entries)for(const j of Object.values(e.graph!.junctures))if(j.filler&&j.perceived&&j.filler.fn!=='story'){
    const old=occurrences.get(j.filler.id);const f=j.filler;
    const canonical=this.canonical.get(f.id)??this.stateCanonical(r,f);
    if(!old)occurrences.set(f.id,{f:canonical,at:j.perceived.at,play:j.perceived.play,fns:[f.fn]});else {old.fns.push(f.fn);if(vocabulary.tokenPrecedence.indexOf(canonical.fn)<vocabulary.tokenPrecedence.indexOf(old.f.fn))old.f=canonical;}
   }
   for(const inst of members){for(const d of inst.st.deliveries){const rc=inst.st.receipts.find(rc=>rc.delivery===d.id&&rc.grade!=='ambient');const f=d.offerEvent&&this.canonical.get(d.offerEvent);if(rc&&f&&!occurrences.has(f.id))occurrences.set(f.id,{f,at:rc.presentedAt??rc.at,play:rc.playTotal,fns:[f.fn]});}for(const rec of inst.st.record.filter(x=>x.kind==='response')){const f=this.canonical.get(String(rec.data.event));if(f&&!occurrences.has(f.id))occurrences.set(f.id,{f,at:rec.at,play:rec.playTotal,fns:[f.fn]});}}
   if(!occurrences.size)continue;
   // Perceived fragments below awareness remain visible in diagnostics, not the evaluated thread population.
   if(!entries.some(e=>this.seenAware.has(e.id)))continue;
   const before=new Map<string,string[]>();for(const inst of members){let response:typeof inst.st.record[number]|undefined;for(const rec of inst.st.record){if(rec.kind==='response'&&typeof rec.data.event==='string'){response=rec;if(typeof rec.data.offer==='string')before.set(rec.data.event,[rec.data.offer]);}else if(rec.kind==='minted'&&typeof rec.data.event==='string'&&response&&rec.at===response.at&&rec.playTotal===response.playTotal)before.set(rec.data.event,[String(response.data.event)]);}}
   const ordered=tiedOrder3([...occurrences.values()],before);
   const start=ordered[0]!.play,firstAt=ordered[0]!.at,masks=new Map<string,string>(),counts=new Map<string,number>();
   const mask=(node:string)=>{if(node===l.k.vId)return 'P';if(masks.has(node))return masks.get(node)!;const k=l.kv.kind(node)??'',known=l.l2.exposedNodeAt(node,'presented');const prefix=l.kv.isKind(k,'core:person')?known!==undefined&&known<firstAt?'K':'N':l.kv.isKind(k,'core:group')?'G':l.kv.isKind(k,'core:place')?'L':'I';const n=(counts.get(prefix)??0)+1;counts.set(prefix,n);masks.set(node,prefix+n);return prefix+n;};
   const os:Occurrence[]=ordered.map((row,index)=>{
    const f=row.f,ev='event' in f.ref?this.events.get(f.id)??l.kv.event(f.id):undefined;
    const incoming=entries.flatMap(e=>{const p=l.sifter.patterns.get(e.pattern)?.graph;return p?.edges.filter(edge=>e.graph!.junctures[edge.to].filler?.id===f.id&&ordered.slice(0,index).some(o=>o.f.id===e.graph!.junctures[edge.from].filler?.id)).map(edge=>edge.link)??[];});
    const link=LINKS.find(x=>incoming.includes(x as never));
    const args=Object.entries(vocabulary.functions[f.fn]?.args??{}).filter(([,kind])=>!['event','fact','pattern id','outcome name'].includes(String(kind))).map(([a])=>f.args[a]?mask(f.args[a]):'?');
    const response=ev&&r.w.l2.responseOf(ev.id),stance=response?.kind.startsWith('decline:')?'refuse':response?.stance;
    const token=`${f.fn}(${args.join(',')})${link?'<'+link:''}${stance?'/'+stance:''}`;
    const receipt=[...r.w.l2.global.receipts,...r.w.l2.all().flatMap(i=>i.st.receipts)].find(rc=>rc.grade!=='ambient'&&rc.cites.includes(f.id));
    const source=f.source==='nudged'?'nudged':f.source==='offered'?'offered':'found';
    const askSeed=ev?.kind==='offer'?members.find(i=>i.st.deliveries.some(d=>d.offerEvent===ev.id)):undefined;
    const askVerb=askSeed?askSeed.st.closure.fragments.find(f=>f.offer)?.features?.verb:undefined;
    const basicName=(n:string)=>n===l.k.vId?'you':r.nameOf(n)||kindWord(l.kv.kind(n));
    const name=(n:string):string=>{if(n===l.k.vId)return 'you';const named=r.nameOf(n);if(named)return named;const kind=l.kv.kind(n);if(kind&&l.kv.isKind(kind,'core:game-fact')){const value=r.w.sim.k.value(n,'value',row.at);return value===undefined?'a recorded fact (content unavailable)':`a recorded fact with value ${JSON.stringify(value)}`;}const referenced=this.events.get(n)??l.kv.event(n);return referenced?`the recorded ${referenced.kind} occurrence (${referenced.participants.map(p=>p.role+': '+basicName(p.who)).join('; ')}${referenced.outcome?'; outcome: '+referenced.outcome:''})`:kindWord(kind);};
    const base=describe(f.fn,f.args,basicName),detail:string[]=[];
    if(!ev)detail.push(`Recorded state evidence: ${JSON.stringify(f.ref,(_,v)=>typeof v==='string'&&/^[0-9a-f]{32}$/.test(v)?name(v):v)}.`);
    if(askSeed){const fill=(askSeed.st.document.sowable as import('../procedural/types.ts').Sowable|undefined)?.fills?.[0];if(fill){const proposed=Object.fromEntries(Object.entries(fill.args).flatMap(([a,role])=>{const id=role==='v'?l.k.vId:askSeed.st.roles[role]?.cast;return id?[[a,id]]:[];}));detail.push(`Proposed act: ${describe(fill.fn,proposed,name)}`);}const offer=askSeed.st.closure.fragments.find(f=>f.offer)?.offer;if(offer){detail.push(`Available actions: ${offer.actions.map(a=>a.id+' ('+a.stance+')').join(', ')}; decline; leave unanswered.`);for(const action of offer.actions)for(const cost of action.costs??[])detail.push(`${action.id} cost: ${cost.what} (${cost.when}).`);}}
    if(response)detail.push(`Recorded response: ${response.kind}${response.stance?' ('+response.stance+')':''}.`);
    const observedKinds=entries.filter(e=>Object.values(e.graph!.junctures).some(j=>j.perceived&&j.filler?.id===f.id)).map(e=>{const p=l.sifter.patterns.get(e.pattern)!.graph!;return p.family+':'+p.id.split(':').pop();});
    return {id:f.id,at:row.at,play:row.play,token,surface:base,evidence:evidence3(base,f.fn,f.args,name,ev?{...ev,causes:ev.causes.filter(id=>ordered.slice(0,index).some(o=>o.f.id===id)||receipt?.cites.includes(id))}:undefined,detail),respondsTo:before.get(f.id)?.[0],l1:observedKinds,effects:ev?.effects.map(e=>e.effect)??[],channel:receipt?.channels[0]??'sight',source,stance,askVerb,protagonist:!!ev&&l.sifter.graph.world.acts(ev,l.k.vId),completion:!!response};
   });
   const closingTimes=(e:PoolEntry)=>e.graph!.seeds.filter(s=>s.for==='closing').flatMap(s=>members.filter(i=>i.id===s.seed).flatMap(i=>i.st.receipts.filter(rc=>rc.grade!=='ambient').map(rc=>rc.playTotal)));
   const times=entries.flatMap(closingTimes),closingPresented=times.length>0,endingEvidence=entries.flatMap(e=>closingTimes(e).length&&e.graph!.outcome?[`${e.pattern.split(':')[1]}: ${e.graph!.outcome!.name} (${e.graph!.outcome!.kind})`]:[]);
   const ep=entries.filter(e=>e.graph!.outcome).sort((a,b)=>b.graph!.outcome!.at-a.graph!.outcome!.at)[0];
   const ongoing=entries.some(e=>!e.graph!.retired&&['forming','live','aftermath'].includes(e.graph!.state));
   const outcome=ongoing||!closingPresented?'open':ep?.graph!.outcome?.kind??'open';
   const closure=entries.filter(e=>e.graph!.outcome&&l.sifter.patterns.get(e.pattern)?.graph?.family==='closure').sort((a,b)=>b.graph!.outcome!.at-a.graph!.outcome!.at)[0];
   const closingPattern=closingPresented?closure?.pattern.split(':').pop()??'none':'none';
   const perceivedEntries=entries.filter(e=>Object.values(e.graph!.junctures).some(j=>j.perceived)).sort((a,b)=>Math.min(...Object.values(a.graph!.junctures).flatMap(j=>j.perceived?[j.perceived.play]:[]))-Math.min(...Object.values(b.graph!.junctures).flatMap(j=>j.perceived?[j.perceived.play]:[]))||a.seq-b.seq);
   const l1=perceivedEntries.map(e=>{const p=l.sifter.patterns.get(e.pattern)!.graph!;return p.family+':'+p.id.split(':').pop();});
   let edges=0,shownEdges=0;for(const e of entries){const p=l.sifter.patterns.get(e.pattern)!.graph!;p.edges.forEach((edge,i)=>{if(edge.link!=='forecloses'&&e.graph!.junctures[edge.from].perceived&&e.graph!.junctures[edge.to].perceived){edges++;if(l.ledger.shown(e,i))shownEdges++;}});}
   const deliveryIds=members.flatMap(i=>i.st.receipts.filter(rc=>rc.grade!=='ambient').map(rc=>rc.delivery));
   const l2=os.map(o=>o.token);l2.push(`end:${outcome}/${closingPattern}`);
   rows.push({id,arm,run,world:r.opts.name,tempo:r.opts.tempo??'steady',policy:r.policy.id,start,patterns:perceivedEntries.map(e=>e.pattern),occurrences:os,l1,l2,l3:os.map(o=>`${o.token}|${o.effects.join(',')}|${o.channel}|${o.stance??''}`),edges,shownEdges,crossLayers:entries.reduce((n,e)=>n+e.graph!.layers.filter(x=>x.cross).length,0)/2,growth:members.filter(i=>i.st.document.growsFrom).length,outcome,closingPattern,closingPlay:closingPresented?Math.min(...times):undefined,closingPresented,endingEvidence:endingEvidence.length?'Recorded closing outcomes: '+endingEvidence.join('; ')+'.':'No outcome explanation is supplied by a closing account at this cutoff.',known:os.some(o=>/K\d/.test(o.token)),escalation:{rung:entries.reduce((n,e)=>n+(l.sifter.patterns.get(e.pattern)!.graph!.escalation??[]).filter(key=>e.graph!.junctures[key].perceived).length,0),allPull:null},deliveryIds:[...new Set(deliveryIds)]});
  }
  return rows.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
 }
}
function kindWord(k:string|undefined){return k?.includes('group')?'a local group':k?.includes('place')?'a place in Kabuki':k?.includes('person')?'a resident':'the recorded subject';}
export function describe(fn:string,args:Record<string,string>,name:(id:string)=>string):string {
 const n=(key:string)=>args[key]?name(args[key]!):'the recorded subject';
 const phrases:Record<string,()=>string>={wrong:()=>`${n('by')} acted against ${n('to')}.`,help:()=>`${n('by')} helped ${n('to')}.`,demand:()=>`${n('by')} made a demand of ${n('of')}.`,threaten:()=>`${n('by')} threatened ${n('to')}.`,obligate:()=>`${n('debtor')} owed a duty to ${n('creditor')}.`,repay:()=>`${n('debtor')} repaid ${n('creditor')}.`,protect:()=>`${n('guard')} protected ${n('ward')}.`,want:()=>`${n('who')} wanted something concerning ${n('what')}.`,blame:()=>`${n('who')} held ${n('of')} responsible.`,ask:()=>`${n('by')} asked ${n('of')} for help.`,comply:()=>`${n('who')} agreed to ${n('to')}'s request.`,refuse:()=>`${n('who')} refused ${n('to')}.`,choose:()=>`${n('who')} made a choice.`,befall:()=>`Misfortune struck ${n('who')}.`,hold:()=>`${n('who')} held ${n('what')}.`,transfer:()=>`${n('what')} passed from ${n('from')} to ${n('to')}.`,bind:()=>`${n('a')} and ${n('b')} made an agreement.`,sever:()=>`${n('a')} broke with ${n('b')}.`,learn:()=>`${n('who')} learned about ${n('what')}.`,pursue:()=>`${n('who')} was pursuing ${n('target')}.`,expose:()=>`${n('by')} revealed something to ${n('to')}.`};
 return phrases[fn]?.()??`${fn}: ${Object.entries(args).filter(([a])=>!['pattern','outcome'].includes(a)).map(([a,id])=>`${a}: ${name(id)}`).join('; ')}.`;
}
