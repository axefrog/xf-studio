import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';import {resolve} from 'node:path';
import {supply3} from '../../src/m3/supply3.ts';import type {Snapshot3} from '../../src/m3/measures3.ts';
import {run3World} from '../../src/m3/run3.ts';import {Run,policies,type Policy} from '../../src/m3/driver.ts';import {stateById} from '../../src/m3/states.ts';import {ThreadArchive} from '../../src/m3/threads3.ts';import {controls} from '../../src/m3/controls3.ts';import type {Tempo} from '../../src/procedural/types.ts';import type {Thread3} from '../../src/m3/measures3.ts';
const [name,arm,tempo,policyId,out,windowArg='1008']=process.argv.slice(2) as [string,'E'|'A1',Tempo,string,string,string];if(!name||!arm||!tempo||!policyId||!out)throw Error('run3-week <world> <E|A1> <tempo> <policy> <out> [windows]');
const id=`${arm}-${name}-${tempo}-${policyId}`,dir=resolve(out);mkdirSync(dir,{recursive:true});
const engage:Policy={id:'engage',answer:o=>({kind:'action',id:o.actions[0]!})},policy=policyId==='engage'?engage:policies[policyId];if(!policy)throw Error('unknown policy');
const {opts}=run3World(name,arm,tempo),r=new Run(opts,stateById('S-mid-squeezed'),policy,{walk:true}),archive=new ThreadArchive(),controlThreads:Thread3[]=[];
const windows=Number(windowArg),start=performance.now(),deadline=Date.now()+3*3600000;
const observations:Snapshot3[]=[];
writeFileSync(resolve(dir,id+'.pid'),String(process.pid));
for(let w=0;w<windows;w++){
 if(Date.now()>deadline)throw Error('three-hour per-week deadline exceeded');r.step();archive.capture(r);
 if(arm==='E'&&w%144===0)controlThreads.push(...controls(r,id,Math.floor(w/144)));
 if([18000,36000,72000,100800].includes(r.play))observations.push({run:id,play:r.play,threads:archive.threads(r,arm,id)});
 if((w+1)%144===0)console.log(`${id}: day ${(w+1)/144}, ${r.deliveries.length} deliveries, ${Math.round((performance.now()-start)/1000)} s`);
}
const threads=archive.threads(r,arm,id);
const body={version:3,method:'reviewed-v5',id,world:name,arm,tempo,policy:policyId,windows,play:r.play,findings:r.w.findings,threads,observations,supply:supply3(r),controlThreads,deliveries:r.deliveries,decisions:archive.decisions,gates:[...archive.gates.values()],diagnostics:{entries:archive.entries.size,perceivedBelowThread:[...archive.entries.values()].filter(e=>!archive.seenAware.has(e.id)&&Object.values(e.graph!.junctures).some(j=>j.perceived)).length,seconds:Math.round((performance.now()-start)/1000)}};
writeFileSync(resolve(dir,id+'.json'),JSON.stringify(body,null,1));console.log(`${id}: DONE ${threads.length} threads, ${body.diagnostics.seconds} s`);


unlinkSync(resolve(dir,id+'.pid'));
