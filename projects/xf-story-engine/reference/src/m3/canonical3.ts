// Detached packet data only. Canonical accounts retain every sampled arm/configuration membership.
import type {Answer3,Criterion3,Member3,Packet3,Pair3,Renderer3} from './blind3.ts';
import type {Arm3,Thread3} from './measures3.ts';
const sequence=(t:Thread3)=>JSON.stringify(t.occurrences.map(o=>o.id));
/** Identity alone is insufficient: responses and the evidence visible to a rater can differ. */
const accountSignature3=(t:Thread3,render:(t:Thread3,renderer?:Renderer3)=>string)=>JSON.stringify({
 sequence:sequence(t),current:render(t,'current'),evidence:render(t,'evidence'),l2:t.l2,
 responses:t.occurrences.map(o=>[o.token,o.stance??null,o.askVerb??null,o.protagonist??false,o.completion??false,o.respondsTo??null]),
});
type Constraint={coeff:number[];lo:number;hi:number};
/** Bounded deterministic binary feasibility, used only to balance the frozen packet assignments. */
function balanced(n:number,constraints:Constraint[],preferred:number[]):number[]{
 const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>constraints.filter(c=>c.coeff[b]).length-constraints.filter(c=>c.coeff[a]).length||a-b);
 const low=Array.from({length:n+1},()=>constraints.map(()=>0)),high=low.map(r=>r.slice());
 for(let i=n-1;i>=0;i--)for(let c=0;c<constraints.length;c++){const v=constraints[c]!.coeff[order[i]!]??0;low[i]![c]=low[i+1]![c]!+Math.min(0,v);high[i]![c]=high[i+1]![c]!+Math.max(0,v);}
 const sums=constraints.map(()=>0),answer=Array(n).fill(0) as number[],memo=new Set<string>();let visits=0;
 function search(i:number):boolean{if(++visits>2000000)throw Error('packet balancing search bound exceeded');for(let c=0;c<constraints.length;c++)if(sums[c]!+low[i]![c]!>constraints[c]!.hi||sums[c]!+high[i]![c]!<constraints[c]!.lo)return false;if(i===n)return true;const key=i+'|'+sums.join(',');if(memo.has(key))return false;const variable=order[i]!;for(const bit of [preferred[variable]??0,1-(preferred[variable]??0)]){answer[variable]=bit;for(let c=0;c<constraints.length;c++)sums[c]!+=bit*(constraints[c]!.coeff[variable]??0);if(search(i+1))return true;for(let c=0;c<constraints.length;c++)sums[c]!-=bit*(constraints[c]!.coeff[variable]??0);}memo.add(key);return false;}
 if(!search(0))throw Error('canonical packet balancing constraints are infeasible');return answer;
}
export function canonical3(base:Packet3,threads:Thread3[],seed:string,shuffle:<T>(xs:T[],seed:string,key:string)=>T[],render:(t:Thread3,renderer?:Renderer3,limit?:number)=>string):Packet3{
 const sources=new Map(base.cards.map(c=>{const k=base.key[c.id]!,t=threads.find(t=>t.arm===k.arm&&t.run===k.run&&t.id===k.thread);if(!t)throw Error('missing canonical source');return [c.id,t];}));
 const groupBy=new Map<string,string>(),alias=new Map<string,string>(),groups=new Map<string,Member3[]>();
 for(const c of base.cards){const t=sources.get(c.id)!,sig=accountSignature3(t,render),id=groupBy.get(sig)??c.id;groupBy.set(sig,id);alias.set(c.id,id);const members=groups.get(id)??[];members.push({sample:c.id,arm:t.arm,thread:t.id,run:t.run,configuration:base.key[c.id]!.configuration,start:t.start,times:t.occurrences.map(o=>({id:o.id,at:o.at,play:o.play}))});groups.set(id,members);}
 const vars=[...groups.keys()].filter(id=>groups.get(id)!.some(m=>m.arm==='E'||m.arm==='A1'));
 const weight=(id:string,arm:Arm3,configuration?:string)=>groups.get(id)!.filter(m=>m.arm===arm&&(configuration===undefined||m.configuration===configuration)).length;
 const constraints:Constraint[]=[];for(const q of base.quotas){for(const arm of ['E','A1'] as const)constraints.push({coeff:vars.map(id=>weight(id,arm,q.configuration)),lo:Math.floor(q.n/2),hi:Math.ceil(q.n/2)});constraints.push({coeff:vars.map(id=>weight(id,'E',q.configuration)-weight(id,'A1',q.configuration)),lo:0,hi:0});}
 for(const arm of ['E','A1'] as const){const n=base.cards.filter(c=>base.key[c.id]!.arm===arm).length;constraints.push({coeff:vars.map(id=>weight(id,arm)),lo:Math.floor(n/2),hi:Math.floor(n/2)});}
 const bits=balanced(vars.length,constraints,vars.map(id=>shuffle([0,1],seed,'canonical-renderer-'+id)[0]!)),colors=new Map(vars.map((id,i)=>[id,bits[i]!]));
 // Keep the original E/A5 target pairing; align its renderer to the corresponding E account.
 const originalPairs=base.pairs[0]!,a5=base.cards.filter(c=>base.key[c.id]!.arm==='A5');
 for(const c of a5){const pair=originalPairs.find(p=>(p.left===c.id||p.right===c.id)&&[p.left,p.right].some(id=>base.key[id]!.arm==='E'))!;const e=[pair.left,pair.right].find(id=>base.key[id]!.arm==='E')!;colors.set(alias.get(c.id)!,colors.get(alias.get(e)!)!);}
 const lengthConstraints:Constraint[]=base.quotas.map(q=>({coeff:a5.map(c=>base.key[c.id]!.configuration===q.configuration?1:0),lo:Math.floor(q.n/2),hi:Math.ceil(q.n/2)}));
 for(const color of [0,1]){const count=a5.filter(c=>colors.get(alias.get(c.id)!)===color).length;lengthConstraints.push({coeff:a5.map(c=>colors.get(alias.get(c.id)!)===color?1:0),lo:Math.floor(count/2),hi:Math.ceil(count/2)});}lengthConstraints.push({coeff:a5.map(()=>1),lo:Math.floor(a5.length/2),hi:Math.floor(a5.length/2)});
 const lengths=balanced(a5.length,lengthConstraints,a5.map(c=>shuffle([0,1],seed,'canonical-length-'+c.id)[0]!)),lengthBy=new Map(a5.map((c,i)=>[c.id,lengths[i]!]));
 const key:Packet3['key']={},cards:Packet3['cards']=[];
 for(const [id,memberships] of groups){const old=base.key[id]!,t=sources.get(id)!,color=colors.get(id)??0;const a5Member=memberships.find(m=>m.arm==='A5');if(a5Member&&memberships.length!==1)throw Error('an A5 canonical sequence has incompatible playback memberships');
  const target=a5Member?base.key[a5Member.sample]!.variants.find(v=>v.target!==undefined)!.target:undefined;
  const variants=[0,1,2,3].map(sheet=>{const renderer:Renderer3=old.arm==='A3'?'current':(color^(sheet%2))?'evidence':'current',matched=!!a5Member&&!!(lengthBy.get(a5Member.sample)!^(sheet%2));return {renderer,length:matched?'matched' as const:'full' as const,...(matched?{limit:Math.min(target!,t.occurrences.length),target,exact:target!<=t.occurrences.length}:{})};});
  const multiplicity:Partial<Record<Arm3,number>>={};for(const m of memberships)multiplicity[m.arm]=(multiplicity[m.arm]??0)+1;
  key[id]={...old,variants,memberships,multiplicity,sequence:t.occurrences.map(o=>o.id)};cards.push({...base.cards.find(c=>c.id===id)!,texts:variants.map(v=>render(t,v.renderer,v.limit))});
 }
 const pairsBase:Pair3[]=[];const add=(eSample:string,otherSample:string)=>{const e=alias.get(eSample)!,other=alias.get(otherSample)!,k=base.key[otherSample]!;pairsBase.push({id:'P-'+String(pairsBase.length+1).padStart(3,'0'),left:e,right:other,e,other,eSample,otherSample,against:k.arm,configuration:k.configuration});};
 for(const q of base.quotas)for(const color of [0,1]){const es=base.cards.filter(c=>base.key[c.id]!.arm==='E'&&base.key[c.id]!.configuration===q.configuration&&colors.get(alias.get(c.id)!)===color),as=shuffle(base.cards.filter(c=>base.key[c.id]!.arm==='A1'&&base.key[c.id]!.configuration===q.configuration&&colors.get(alias.get(c.id)!)===color),seed,'canonical-pair-'+q.configuration+'-'+color);if(es.length!==as.length)throw Error('canonical renderer quotas differ');es.forEach((e,i)=>add(e.id,as[i]!.id));}
 for(const pair of originalPairs){const ids=[pair.left,pair.right],other=ids.find(id=>base.key[id]!.arm==='A5');if(other)add(ids.find(id=>base.key[id]!.arm==='E')!,other);}
 const decorated=[0,1,2,3].map(sheet=>pairsBase.map(p=>{const v=key[p.other!]!.variants[sheet]!,reason=p.e===p.other?'self' as const:cards.find(c=>c.id===p.e)!.texts[sheet]===cards.find(c=>c.id===p.other)!.texts[sheet]?'identical' as const:undefined;return {...p,renderer:v.renderer,length:v.length,...(reason?{reason}:{})};}));
 const sidesConstraints:Constraint[]=[];for(const sheet of [0,1]){const active=decorated[sheet]!.filter(p=>!p.reason),cells=new Set(active.map(p=>[p.against,p.renderer,p.length].join('|')));for(const cell of cells){const ids=new Set(active.filter(p=>[p.against,p.renderer,p.length].join('|')===cell).map(p=>p.id));sidesConstraints.push({coeff:pairsBase.map(p=>ids.has(p.id)?1:0),lo:Math.floor(ids.size/2),hi:Math.ceil(ids.size/2)});}}
 const sides=balanced(pairsBase.length,sidesConstraints,pairsBase.map((_,i)=>i%2)),pairs:Pair3[][]=[],omitted:Pair3[][]=[];
 for(let sheet=0;sheet<4;sheet++){const rows=shuffle(decorated[sheet]!,seed,'pairs-'+sheet).map(p=>{const i=pairsBase.findIndex(x=>x.id===p.id),eLeft=!!(sides[i]!^(sheet%2));return {...p,left:eLeft?p.e!:p.other!,right:eLeft?p.other!:p.e!};});pairs.push(rows.filter(p=>!p.reason));omitted.push(rows.filter(p=>p.reason));}
 const orders=base.orders.map(order=>{const seen=new Set<string>();return order.map(id=>alias.get(id)!).filter(id=>{if(seen.has(id))return false;seen.add(id);return true;});});
 const overlap=base.quotas.map(q=>{const population=(arm:Arm3)=>threads.filter(t=>t.arm===arm&&[t.world,t.tempo,t.policy].join('|')===q.configuration),sample=(arm:Arm3)=>base.cards.filter(c=>base.key[c.id]!.arm===arm&&base.key[c.id]!.configuration===q.configuration).map(c=>sources.get(c.id)!);const e=population('E'),eSample=sample('E'),a1=population('A1'),a5=population('A5'),match=(xs:Thread3[],ys:Thread3[])=>{const set=new Set(ys.map(sequence));return xs.filter(t=>set.has(sequence(t))).length;};return {configuration:q.configuration,populationE:e.length,populationA1:a1.length,populationA5:a5.length,populationMatchA1:match(e,a1),populationMatchA5:match(e,a5),sampleE:eSample.length,sampleMatchA1:match(eSample,sample('A1')),sampleMatchA5:match(eSample,sample('A5'))};});
 const shared=[...groups].filter(([,ms])=>ms.length>1).map(([id,ms])=>({id,members:ms.length,configurations:[...new Set(ms.map(m=>m.configuration))],arms:[...new Set(ms.map(m=>m.arm))]}));
 return {...base,schema:3,sampleSize:base.cards.length,cards,key,pairs,omitted,orders,sourceOrders:base.orders,overlap,shared,sort:shuffle(cards.map(c=>c.id),seed,'sorting').slice(0,30)};
}

/** Expand memberships for arithmetic only; no duplicate is shown to the rater or revalidated. */
export function expanded3(p:Packet3,a:Answer3):{p:Packet3;a:Answer3}{
 if(!p.schema)return {p,a};const key:Packet3['key']={},cards:Packet3['cards']=[],answers:Answer3['cards']={};for(const c of p.cards)for(const m of p.key[c.id]!.memberships!){key[m.sample]={...p.key[c.id]!,...m};cards.push({...c,id:m.sample,run:m.run,start:m.start});answers[m.sample]=a.cards[c.id]!;}
 const pairs=p.pairs.map(ps=>ps.map(pair=>({...pair,left:pair.left===pair.e?pair.eSample!:pair.otherSample!,right:pair.right===pair.e?pair.eSample!:pair.otherSample!})));
 const orders=p.orders.map(ids=>ids.flatMap(id=>p.key[id]!.memberships!.map(m=>m.sample)));return {p:{...p,key,cards,pairs,orders},a:{...a,cards:answers}};
}
type Summary={n:number;mean:Record<string,number|null>;seen:Record<string,number>};
interface CoreScore {arms:Array<Summary&{arm:Arm3}>;cells:Array<Summary&{arm:string;renderer:string;length:string}>;contrasts:Array<{arm:Arm3;factor:string;plus:string|undefined;minus:string|undefined;plusN:number;minusN:number;strata:number;adjustedPlusN:number;adjustedMinusN:number;adjustedDifference:Record<string,number|null>;difference:Record<string,number|null>;plusSeen:Record<string,number>;minusSeen:Record<string,number>}>;choices:Array<{against:string;renderer:string;n:number;follow:number;caused:number}>;}
/** Weighted scores retain the original sample; unweighted scores count each canonical account once. */
export function scoredCanonical3<T extends CoreScore>(p:Packet3,a:Answer3,score:T,criteria:readonly Criterion3[]){
 const ids=p.orders[a.sheet-1]!,members=(id:string)=>p.key[id]!.memberships??[{arm:p.key[id]!.arm,configuration:p.key[id]!.configuration}],has=(id:string,arm:string)=>members(id).some(m=>m.arm===arm);
 const summarize=(xs:string[]):Summary=>({n:xs.length,mean:Object.fromEntries(criteria.map(cr=>[cr,xs.length?xs.reduce((n,id)=>n+a.cards[id]![cr],0)/xs.length:null])),seen:Object.fromEntries(['new','reminds','same'].map(k=>[k,xs.filter(id=>a.cards[id]!.seen===k).length]))});
 const difference=(x:Summary,y:Summary)=>Object.fromEntries(criteria.map(cr=>[cr,x.mean[cr]===null||y.mean[cr]===null?null:x.mean[cr]!-y.mean[cr]!]));
 const arms=score.arms.map(row=>({...row,unweighted:summarize(ids.filter(id=>has(id,row.arm)))}));
 const cells=score.cells.map(row=>({...row,unweighted:summarize(ids.filter(id=>{const v=p.key[id]!.variants[a.sheet-1]!;return has(id,row.arm)&&v.renderer===row.renderer&&v.length===row.length;}))}));
 const contrasts=score.contrasts.map(row=>{const here=ids.filter(id=>has(id,row.arm)),variant=(id:string)=>p.key[id]!.variants[a.sheet-1]!,group=(value:string|undefined)=>here.filter(id=>variant(id)[row.factor as 'renderer'|'length']===value),plus=summarize(group(row.plus)),minus=summarize(group(row.minus));const keys=[...new Set(here.flatMap(id=>members(id).filter(m=>m.arm===row.arm).map(m=>m.configuration+(row.arm==='A5'?'|'+variant(id)[row.factor==='renderer'?'length':'renderer']:''))))];const strata=keys.flatMap(key=>{const rows=(value:string|undefined)=>here.filter(id=>variant(id)[row.factor as 'renderer'|'length']===value&&members(id).some(m=>m.arm===row.arm&&m.configuration+(row.arm==='A5'?'|'+variant(id)[row.factor==='renderer'?'length':'renderer']:'')===key)),x=summarize(rows(row.plus)),y=summarize(rows(row.minus));return x.n&&y.n?[difference(x,y)]:[];});return {...row,unweightedPlus:plus,unweightedMinus:minus,unweightedDifference:difference(plus,minus),unweightedStrata:strata.length,unweightedAdjustedDifference:Object.fromEntries(criteria.map(cr=>[cr,strata.length?strata.reduce((n,s)=>n+s[cr]!,0)/strata.length:null]))};});
 const choices=score.choices.map(row=>{const ties=(p.omitted?.[a.sheet-1]??[]).filter(pair=>(pair.against==='A5'?'A5-'+pair.length:pair.against)===row.against&&(row.renderer==='all'||pair.renderer===row.renderer)).length;return {...row,ties,total:row.n+ties,followLosses:row.n-row.follow,causedLosses:row.n-row.caused};});
 const configurations=p.quotas.flatMap(q=>(['E','A1','A3','A5'] as Arm3[]).map(arm=>{const weighted=ids.flatMap(id=>members(id).filter(m=>m.arm===arm&&m.configuration===q.configuration).map(()=>id));return {arm,configuration:q.configuration,weighted:summarize(weighted),unweighted:summarize([...new Set(weighted)])};}));
 const result={arms,cells,contrasts,choices,configurations};return {...score,...result} as Omit<T,keyof typeof result>&typeof result;
}
