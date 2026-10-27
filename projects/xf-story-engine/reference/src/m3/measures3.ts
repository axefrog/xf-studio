// M3 iteration 3 measurements. Offline analysis only; no engine policy is changed.
export type Arm3 = 'E'|'A1'|'A3'|'A5';
export interface Occurrence {
 id:string; at:number; play:number; token:string; surface:string; effects:string[]; channel:string;
 source:'found'|'offered'|'nudged'|'fixed'|'baseline'|'completion'; stance?:string; askVerb?:string;
 protagonist?:boolean; completion?:boolean;
 evidence?:string; respondsTo?:string; l1?:string[];
}
export interface Thread3 {
 id:string; arm:Arm3; run:string; world:string; tempo:string; policy:string; start:number;
 patterns:string[]; occurrences:Occurrence[]; l1:string[]; l2:string[]; l3:string[];
 edges:number; shownEdges:number; crossLayers:number; growth:number;
 outcome:string; closingPattern:string; closingPresented:boolean; known:boolean;
 escalation:{rung:number; allPull:boolean|null}; deliveryIds:string[];
 knownF14?:boolean|null;
 closingPlay?:number; endingEvidence?:string;
}
export interface Snapshot3 {run:string;play:number;threads:Thread3[];}
/** Truncate control traces at observation time; never carry a future ending into a prefix. */
export function observed3(t:Thread3,to:number,from=-Infinity):Thread3|null {
 const os=t.occurrences.filter(o=>o.play<=to&&o.play>=from);if(!os.length)return null;
 const ended=t.closingPresented&&(t.closingPlay??t.occurrences.at(-1)?.play??Infinity)<=to;
 const l1=[...new Set(os.flatMap(o=>o.l1??[]))];
 const outcome=ended?t.outcome:'open',closingPattern=ended?t.closingPattern:'none';
 return {...t,start:os[0]!.play,occurrences:os,l1:l1.length?l1:t.l1,l2:[...os.map(o=>o.token),`end:${outcome}/${closingPattern}`],l3:os.map(o=>`${o.token}|${o.effects.join(',')}|${o.channel}|${o.stance??''}`),outcome,closingPattern,closingPresented:ended};
}
export const DELTA=0.25, TAU=4, RECAST_MARGIN=0.1;
const functionLink=(t:string)=> t.startsWith('end:') ? 'end:'+t.split(':')[1]!.split('/')[0] : (t.match(/^([^()]+)\(/)?.[1]??t)+'|'+(t.match(/<([^/]+)/)?.[1]??'');
export function distance(a:readonly string[],b:readonly string[]):number {
 if(!a.length&&!b.length)return 0;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]!+1,prev[j]!+1,prev[j-1]!+(a[i-1]===b[j-1]?0:functionLink(a[i-1]!)===functionLink(b[j-1]!)?0.5:1));prev=next;}
 return prev[b.length]!/Math.max(a.length,b.length);
}
export function clusters(ts:Thread3[],delta=DELTA):number[][] {
 const parent=ts.map((_,i)=>i),root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]!));
 for(let i=0;i<ts.length;i++)for(let j=0;j<i;j++)if(distance(ts[i]!.l2,ts[j]!.l2)<=delta)parent[root(i)]=root(j);
 const out=new Map<number,number[]>();ts.forEach((_,i)=>{const r=root(i);out.set(r,[...(out.get(r)??[]),i]);});return [...out.values()];
}
export function packageSize(ts:Thread3[]):number {if(!ts.length)return 0;let n=0,k=0;for(const c of clusters(ts).sort((a,b)=>b.length-a.length)){n+=c.length;k++;if(n>=ts.length*0.8)break;}return k;}
const hill=(sizes:number[])=>{const n=sizes.reduce((a,b)=>a+b,0);return n?n*n/sizes.reduce((a,b)=>a+b*b,0):null;};
export function errand(t:Thread3) {
 const first=t.occurrences.find(o=>o.protagonist||o.askVerb);
 const began=!!first?.askVerb&&['fetch','carry','deliver','retrieve','escort','collect'].includes(first.askVerb);
 const after=first?t.occurrences.slice(t.occurrences.indexOf(first)+1).filter(o=>!o.completion):[];
 return {began,errand:began&&after.length<=1,grew:began&&after.length>1};
}
export function mine(ts:Thread3[],tau=TAU) {
 const occurrences=new Map<string,{tokens:string[];count:number;threads:Set<number>;seeds:Set<string>}>();
 ts.forEach((t,ti)=>{for(let n=3;n<=6;n++)for(let j=0;j+n<=t.l2.length;j++){const tokens=t.l2.slice(j,j+n),key=JSON.stringify(tokens);const r=occurrences.get(key)??{tokens,count:0,threads:new Set<number>(),seeds:new Set<string>()};r.count++;r.threads.add(ti);r.seeds.add(t.world);occurrences.set(key,r);}});
 return [...occurrences.values()].filter(r=>r.count>=tau).map(r=>({...r,threads:[...r.threads],seeds:[...r.seeds]}));
}
/** Add-one Markov likelihood; train on prior threads only and reset context at each thread. */
export function bits(train:string[][],test:string[][],order:number):number|null {
 const vocab=new Set(train.flat()),V=vocab.size+1,counts=new Map<string,Map<string,number>>();
 const keyOf=(row:string[],i:number)=>JSON.stringify(row.slice(Math.max(0,i-order),i));
 for(const row of train)row.forEach((tok,i)=>{const k=keyOf(row,i),m=counts.get(k)??new Map<string,number>();m.set(tok,(m.get(tok)??0)+1);counts.set(k,m);});
 let total=0,n=0;for(const row of test)row.forEach((tok,i)=>{const context=row.map(x=>vocab.has(x)?x:'@UNK'),m=counts.get(keyOf(context,i));const den=[...(m?.values()??[])].reduce((a,b)=>a+b,0)+V;total-=Math.log2(((m?.get(vocab.has(tok)?tok:'@UNK')??0)+1)/den);n++;});return n?total/n:null;
}
function shuffled(row:string[],seed:number){const a=row.slice();let x=seed;for(let i=a.length-1;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;const j=x%(i+1);[a[i],a[j]]=[a[j]!,a[i]!];}return a;}
/** Only observed occurrences and actually observed endings may train a prediction. */
function training3(t:Thread3,before:number):{tokens:string[];times:number[]} {
 const os=t.occurrences.filter(o=>o.play<before),tokens=os.map(o=>o.token),times=os.map(o=>o.play);
 const ending=t.closingPlay??t.occurrences.at(-1)?.play??Infinity;
 if(t.closingPresented&&ending<before){tokens.push(`end:${t.outcome}/${t.closingPattern}`);times.push(ending);}
 return {tokens,times};
}
export function measures(ts:Thread3[],snapshots:Snapshot3[]=[]) {
 const runs=[...new Set(ts.map(t=>t.run))];let near=0;for(const run of runs){const rows=ts.filter(t=>t.run===run).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));rows.forEach((t,i)=>{if(rows.slice(0,i).some(p=>distance(p.l2,t.l2)<=DELTA))near++;});}
 const templates=mine(ts),covered=new Set(templates.flatMap(t=>t.threads)),seeds=new Set(ts.map(t=>t.world));
 const errands=ts.map(errand),n=ts.length,occ=ts.flatMap(t=>t.occurrences);
 const at=(run:string,to:number)=>snapshots.find(s=>s.run===run&&s.play===to)?.threads??ts.filter(t=>t.run===run).flatMap(t=>{const p=observed3(t,to);return p?[p]:[];});
 const curve=runs.map(run=>({run,points:[5,10,20,28].map(h=>{const prefix=at(run,h*3600);return {hours:h,threads:prefix.length,clusters80:packageSize(prefix)};})}));
 const windows=runs.flatMap(run=>[0,10,20].map(from=>{const to=Math.min(28,from+10),cutoff=to*3600-(to===28?0:0.000001),rows=at(run,to*3600).flatMap(t=>{const p=observed3(t,cutoff,from*3600);return p?[p]:[];});const l1=new Map<string,number>();rows.forEach(t=>{const k=JSON.stringify(t.l1);l1.set(k,(l1.get(k)??0)+1);});return {run,from,to,n:rows.length,l1:hill([...l1.values()]),l2:hill(clusters(rows).map(c=>c.length))};}));
 const predictability=runs.flatMap(run=>{const rows=ts.filter(t=>t.run===run).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));return [5,10,20,50].map(exposure=>{
  // Freeze the prior-thread set at the exposure, but re-cut it at each evaluated thread's start.
  const tests=rows.slice(exposure,exposure+10).map((t,i)=>({t,index:exposure+i,train:rows.slice(0,exposure).map(p=>training3(p,t.start))}));
  const evaluations=tests.map(({t,train})=>({thread:t.id,before:t.start,trainingTokens:train.reduce((n,p)=>n+p.tokens.length,0),latestTrainingPlay:Math.max(-Infinity,...train.flatMap(p=>p.times))}));
  return {run,exposure,available:tests.length>0,testThreads:tests.length,evaluations:evaluations.map(e=>({...e,latestTrainingPlay:Number.isFinite(e.latestTrainingPlay)?e.latestTrainingPlay:null})),orders:[1,2,3].map(order=>{
   let total=0,control=0,n=0;for(const {t,index,train} of tests){const tokens=train.map(p=>p.tokens),a=bits(tokens,[t.l2],order),b=bits(tokens.map((p,i)=>shuffled(p,77+i)),[shuffled(t.l2,77+index)],order);if(a!==null&&b!==null){total+=a*t.l2.length;control+=b*t.l2.length;n+=t.l2.length;}}
   return {order,bits:n?total/n:null,shuffled:n?control/n:null};
  })};
 });});
 const deliveries=new Set(ts.flatMap(t=>t.deliveryIds)),longDeliveries=new Set(ts.filter(t=>t.occurrences.length>=3).flatMap(t=>t.deliveryIds));
 return {n,recastRate:n?near/n:null,delta:DELTA,packageSize:packageSize(ts),packageCurve:curve,hill:windows,templateRate:n?covered.size/n:null,tau:TAU,templates:templates.map(t=>({...t,seedShare:seeds.size?t.seeds.length/seeds.size:0})),predictability,errandShare:n?errands.filter(e=>e.errand).length/n:null,beganErrandShare:n?errands.filter(e=>e.began).length/n:null,grewShareOfBegan:errands.some(e=>e.began)?errands.filter(e=>e.grew).length/errands.filter(e=>e.began).length:null,threePlus:n?ts.filter(t=>t.occurrences.length>=3).length/n:null,deliveryShareThreePlus:deliveries.size?longDeliveries.size/deliveries.size:null,knownShare:n?ts.filter(t=>t.known).length/n:null,legibleEdgeRatio:ts.reduce((a,t)=>a+t.edges,0)?ts.reduce((a,t)=>a+t.shownEdges,0)/ts.reduce((a,t)=>a+t.edges,0):null,nudgeShare:occ.length?occ.filter(o=>o.source==='nudged').length/occ.length:null};
}
