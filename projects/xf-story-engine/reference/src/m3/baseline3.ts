import {TEMPLATES} from './arms.ts';
import {peopleIn} from '../sim/names.ts';
import type {Thread3} from './measures3.ts';
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Recover the declared A3 client slot, not an inferred motive or a wording classification. */
export function radiantProjection3(t:Thread3,seen:Set<string>):Thread3 {
 const template=TEMPLATES.find(p=>'template:'+p.id===t.l1[0]);if(!template)return t;
 let client=false;
 const pattern=template.text.split(/(\{[A-Za-z0-9]+\})/).map(part=>{
  if(part==='{client}'){if(client)return '\\k<client>';client=true;return '(?<client>.+?)';}
  return /^\{/.test(part)?'.+?':escape(part);
 }).join('');
 const text=t.occurrences[0]?.surface??'',name=new RegExp('^'+pattern+'$').exec(text)?.groups?.client;
 if(!name)throw Error('cannot recover declared A3 client for '+t.id);
 // Full names are the synthetic control's displayed identities; no hidden relationship is assumed.
 const known=seen.has(name),aboutKnown=peopleIn(text).some(n=>seen.has(n));
 const occurrences=t.occurrences.map(o=>({...o,token:o.token.replace(/\bN1\b/g,known?'K1':'N1')}));
 for(const n of peopleIn(text))seen.add(n);
 const end='end:'+t.outcome+'/'+t.closingPattern;
 return {...t,known:aboutKnown,occurrences,l2:[...occurrences.map(o=>o.token),end],l3:occurrences.map(o=>o.token+'||'+o.channel+'|'+(o.stance??''))};
}
