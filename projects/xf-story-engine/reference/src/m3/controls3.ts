import type {Run} from './driver.ts';
import type {Thread3,Occurrence} from './measures3.ts';
import {radiantJob} from './arms.ts';
import {library,vocabulary} from './run3.ts';
import {describe} from './threads3.ts';
import {shuffle} from './blind.ts';
import {actingArgument} from '../seeding/pattern-lint.ts';
/** Controls read casting slots, never the event record. No control occurrence is fed back to S1. */
export function controls(r:Run,run:string,n:number):Thread3[]{
 const at=r.w.sim.k.now,play=r.play,world=r.opts.name;
 const base=(arm:'A3'|'A5',suffix:string):Thread3=>({id:run+'-'+arm+'-'+n+'-'+suffix,arm,run:run.replace(/^E-/,'')+'-'+arm,world,tempo:r.opts.tempo??'steady',policy:r.policy.id,start:play,patterns:[],occurrences:[],l1:[],l2:[],l3:[],edges:0,shownEdges:0,crossLayers:0,growth:0,outcome:'open',closingPattern:'none',closingPresented:false,known:false,escalation:{rung:0,allPull:null},deliveryIds:[]});
 const out:Thread3[]=[],job=radiantJob(r.w,id=>r.nameOf(id),world,n,r.opts.index ? r.walkCells[0] : undefined,'declared');
 if(job){const t=base('A3',job.template),verb=({delivery:'deliver',recovery:'retrieve',escort:'escort',debt:'collect'} as Record<string,string>)[job.template]??job.template;
 const ask:Occurrence={id:t.id+'-ask',at,play,token:`ask(N1,P)`,surface:job.text,effects:[],channel:'message',source:'baseline',askVerb:verb};t.occurrences.push(ask);t.l1=['template:'+job.template];
 if(r.policy.id!=='ignore'){const accepted=r.policy.id!=='decline';t.occurrences.push({id:t.id+'-answer',at:at+600,play:play+100,token:accepted?'comply(P,N1)/help':'refuse(P,N1)/refuse',surface:accepted?'You accepted and completed the request.':'You declined the request.',effects:[],channel:'message',source:'completion',protagonist:true,completion:true,stance:accepted?'help':'refuse'});t.outcome=accepted?'resolved':'parked';t.closingPattern='job';t.closingPresented=true;}
 t.l2=t.occurrences.map(o=>o.token);if(t.outcome!=='open')t.l2.push('end:'+t.outcome+'/job');t.l3=t.occurrences.map(o=>o.token+'|message');t.deliveryIds=t.occurrences.map(o=>o.id);out.push(t);}
 return out;
}

