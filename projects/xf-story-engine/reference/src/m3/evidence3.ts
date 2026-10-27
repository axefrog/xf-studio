import type {EventView} from '../procedural/types.ts';
/** Render only the supplied observation, never query a motive or invent a missing object. */
export function evidence3(base:string,fn:string,args:Record<string,string>,name:(id:string)=>string,event?:EventView,extra:string[]=[]):string {
 const details=Object.entries(args).map(([key,id])=>`${key}: ${name(id)}`);
 if(details.length)extra=[`Recorded ${fn} arguments: ${details.join('; ')}.`,...extra];
 if(event){
  extra.push(`Occurrence kind: ${event.kind}.`);
  if(event.participants.length)extra.push(`Recorded participants: ${event.participants.map(p=>`${p.role}: ${name(p.who)}`).join('; ')}.`);
  if(event.causes.length)extra.push(`Recorded causes among supplied observations: ${event.causes.map(name).join('; ')}.`);
  if(event.effects.length)extra.push(`Recorded effects: ${event.effects.map(e=>`${e.effect} on ${name(e.on)}`).join('; ')}.`);
  if(event.outcome)extra.push(`Recorded act outcome: ${event.outcome}.`);
  if(event.data&&Object.keys(event.data).length)extra.push(`Recorded data: ${JSON.stringify(event.data,(_,v)=>typeof v==='string'&&/^[0-9a-f]{32}$/.test(v)?name(v):v)}.`);
 }
 if(fn==='demand'&&!args.what)extra.push('The record does not specify what was demanded.');
 if(fn==='expose'&&!args.what)extra.push('The record does not specify what was revealed.');
 return [base,...extra].join(' ');
}
export function tiedOrder3<T extends {f:{id:string};play:number;at:number}>(rows:T[],before:Map<string,string[]>):T[]{
 const sorted=rows.slice().sort((a,b)=>a.play-b.play||a.at-b.at||a.f.id.localeCompare(b.f.id)),out:T[]=[];
 for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j]!.play===sorted[i]!.play&&sorted[j]!.at===sorted[i]!.at)j++;
  const pending=sorted.slice(i,j);while(pending.length){const ids=new Set(pending.map(r=>r.f.id));const k=pending.findIndex(r=>!(before.get(r.f.id)??[]).some(id=>ids.has(id)));if(k<0)throw Error('cyclic recorded perception relationship');out.push(pending.splice(k,1)[0]!);}i=j;
 }
 return out;
}
