import type {Pack,Seed,Role} from '../seeding/types.ts';
import type {Sowable} from '../procedural/types.ts';
import type {RoleKind} from '../seeding/pattern-types.ts';
import {actingArgument} from '../seeding/pattern-lint.ts';
import {library,vocabulary} from './run3.ts';
/** Actor is nominal; mixed fact targets must come from a typed matcher binding, never free casting. */
export function role3(kind:RoleKind|RoleKind[]):Role {
 const ks=Array.isArray(kind)?kind:[kind];
 // Kabuki's synthetic people are structural xf:resident nodes, nominally core:person. Keep
 // person-only queries structural; do not broaden them to actor or change Kernel.query.
 if(ks.every(k=>['actor','person','group'].includes(k)))return {kind:ks.length===1&&ks[0]!=='actor'?(ks[0]==='person'?'xf:resident':'core:group'):'core:actor',onUnfilled:['wait']};
 const matchedOnly=ks.length>1||ks.includes('fact');
 return {kind:matchedOnly?'core:thing':ks[0]==='item'?'xf:item':'core:'+ks[0],...(matchedOnly?{scope:{nodes:[]} as const}:{}),onUnfilled:['wait']};
}
/** Atomic stand-ins: acceptance resolves one juncture; no hidden sequence or world-state fabrication. */
export function atomicPack():Pack {
 const p:Pack={id:'xf.m3c.atoms',version:1,seeds:[],fragments:[],texts:[],authors:[],source:'procedural'};
 const signatures=new Set<string>();
 for(const pattern of library)for(const [key,j] of Object.entries(pattern.junctures)){
  if(pattern.id==='xf.composite:uprising'||pattern.family==='shape'||j.fn==='story'||!(j.realise??[]).some(r=>'offer' in r))continue;
  const acting=actingArgument(j,vocabulary);if(!acting)continue;
  const optional=[...new Set(Object.values(j.args).filter(term=>pattern.roles[term]?.v==='may'))];
  for(let variant=0;variant<2**optional.length;variant++){
  const playerTerms=new Set(optional.filter((_,i)=>variant&(1<<i)));
  if(playerTerms.size+(Object.values(j.args).includes('v')?1:0)>1)continue;
  const args:Record<string,string>={},roles:Record<string,Role>={evidence:{kind:'core:event',optional:true,scope:{nodes:[]}}};
  let usable=true;
  for(const [arg,term] of Object.entries(j.args)){
   if(term==='v'||playerTerms.has(term)){args[arg]='v';continue;}
   const kind=pattern.roles[term]?.kind??(pattern.junctures[term]?'event':undefined);
   if(!kind){usable=false;break;}
   const ks=Array.isArray(kind)?kind:[kind],role='r_'+term.replace(/\W/g,'');
   roles[role]=role3(ks);
   args[arg]=role;
  }
  if(!usable)continue;
  const actorRole=(role:string)=>role!=='v'&&['xf:resident','core:group','core:actor'].includes(roles[role]?.kind);
  const asker=args[acting]==='v'?Object.values(args).find(actorRole):args[acting];
  if(!asker||!actorRole(asker))continue;
  const signature=JSON.stringify([j.fn,Object.entries(args).map(([arg,r])=>[arg,r==='v'?'v':roles[r]])]);if(signatures.has(signature))continue;signatures.add(signature);
  const sid=pattern.id.split(':')[1]+'-'+key+'-v'+variant,verb=pattern.id==='xf.composite:coveted'?'retrieve':j.fn;
  const sowable:Sowable={serves:['offer'],firstClass:2,fills:[{fn:j.fn,args,cause:'evidence'}]};
  // For protagonist acts the role named in the pattern is fixed by the candidate overlay, never invented by the driver.
  const seed:Seed={id:p.id+':'+sid,version:1,maturity:'ready',level:'encounter',stakeScale:'person',turns:[],purpose:{tags:['atomic'],sentence:'One proposed act in an existing situation.'},context:'yes',intent:{prohibitions:[],tone:['grounded']},roles,
   facts:{answer:{initial:0,route:{consumers:['done']}},exit:{initial:0,route:{consumers:['end']}}},windows:[{id:'w',opens:'yes',onClose:'withdraw'}],start:['ask'],
   beats:{ask:{kind:'decision',decision:{atStake:asker,stances:['help','bargain','refuse']},play:'pack:'+sid+'-ask'},done:{kind:'exit',links:[{because:'ask',on:{all:[{response:'ask',is:['action:act','action:bargain']},{seedFact:'answer',op:'gt',value:0}]}}],play:'pack:'+sid+'-done',leaves:[{fact:'exit',set:1},{event:{kind:'m3c.'+j.fn,participants:Object.entries(args).map(([a,role])=>({who:role,role:'m3c_'+a})),causes:['evidence']}}]},refused:{kind:'exit',links:[{because:'ask',on:{response:'ask',is:['decline']}}],play:'pack:'+sid+'-refused',leaves:[{fact:'exit',set:2}]}},end:'seedFact(exit) > 0',unattended:{after:{clock:'game',s:259200},outcome:[{fact:'exit',set:3}]},closing:'pack:t-'+sid+'-close',sow:'no',sowable,
   realises:[]};
  const doneEvent={kind:'m3c.'+j.fn,participants:Object.entries(args).map(([a,role])=>({who:role,role:'m3c_'+a}))};
  seed.beats.done.leaves=[{fact:'exit',set:1}];seed.beats.done.play={alternates:['pack:'+sid+'-done','pack:'+sid+'-done-context']};
  p.seeds.push(seed);
  const offer={asker,stakes:[{bearer:asker,what:'the proposed act'}],actions:[{id:'act',stance:'help' as const,foresight:'pack:t-'+sid+'-fore',writes:[{fact:'answer',set:1,persist:'lasting' as const}],costs:[{bearer:'v',what:'time spent following this thread',when:'now' as const,shown:'named' as const}]}],decline:[{id:'decline'}],nullPath:{id:'not-now',content:'pack:t-'+sid+'-wait'},lapse:{after:{clock:'play' as const,s:1800},then:'reoffer' as const},choice:'consequential' as const};
  offer.actions.push({...offer.actions[0]!,id:'bargain',stance:'bargain' as never,writes:[{fact:'answer',set:2,persist:'lasting'}],costs:[{bearer:'v',what:'a favour owed for assistance',when:'now',shown:'named'}]});
  for(const [suffix,text] of [['ask','A request concerning the recorded situation.'],['done','The proposed act was completed.'],['refused','You declined the request.'],['close','The request ended.'],['fore','Follow through on the proposed act.'],['wait','Leave this unresolved for now.']])p.texts.push({id:'t-'+sid+'-'+suffix,text,origin:'authored'});
  for(const suffix of ['ask','done','refused'])p.fragments.push({id:sid+'-'+suffix,level:'exchange',roles:Object.keys(roles),salience:'foreground',forms:{standard:'pack:t-'+sid+'-'+suffix},channels:['message'],features:{verb},...(suffix==='ask'?{offer}:suffix==='done'?{applies:{not:{cast:'evidence'}},leaves:[{event:doneEvent}]}:{})});
  p.fragments.push({id:sid+'-done-context',level:'exchange',roles:Object.keys(roles),salience:'foreground',forms:{standard:'pack:t-'+sid+'-done'},channels:['message'],applies:{cast:'evidence'},leaves:[{event:{...doneEvent,causes:['evidence']}}]});
  }
 }
 return p;
}


export function atomicKinds():import('../event-kinds.ts').EventKindEntry[]{
 return Object.entries(vocabulary.functions).filter(([fn])=>fn!=='story').map(([fn,spec])=>({name:'m3c.'+fn,tags:[],producers:['s2'],roles:Object.keys(spec.args).map(a=>'m3c_'+a),fills:[{fn,args:Object.fromEntries(Object.keys(spec.args).map(a=>[a,'m3c_'+a]))}]}));
}








