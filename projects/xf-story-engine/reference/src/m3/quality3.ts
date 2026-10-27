import type {Thread3} from './measures3.ts';
import {library} from './run3.ts';
/** Final projection from the immutable per-week observations and decision sink. */
export function quality3(t:Thread3,decisions:Array<{rule:string;chain?:string[];data:Record<string,unknown>}>):Thread3&{continuationSeeds:number}{
 if(t.arm==='A3'||t.arm==='A5')return {...t,continuationSeeds:0,knownF14:null};
 const ids=new Map(t.occurrences.map(o=>[o.id,o])),patterns=library.filter(p=>t.patterns.includes(p.id));
 const fills=decisions.filter(d=>(d.rule==='consequence'||d.rule==='adaptation')&&d.chain?.some(id=>ids.has(id)));
 const rungs=fills.filter(d=>patterns.some(p=>p.escalation?.includes(String(d.data.juncture))));
 const unique=new Map(rungs.map(d=>[String(d.data.instance)+':'+String(d.data.juncture),d]));
 const candidates=decisions.flatMap(d=>Array.isArray(d.data.rivals)?d.data.rivals:[]).filter(c=>c.thread===t.id||c.entry===t.id);
 const f14=candidates.flatMap(c=>typeof c.features?.F14==='number'?[c.features.F14]:[]);
 const checks=[...unique.values()].map(d=>{const o=d.chain!.map(id=>ids.get(id)).find(Boolean)!;const previous=fills.filter(f=>f.data.instance===d.data.instance&&f.chain?.some(id=>ids.has(id)&&ids.get(id)!.at<o.at)).flatMap(f=>f.chain!.flatMap(id=>ids.has(id)?[ids.get(id)!.at]:[]));const anchor=previous.length?Math.max(...previous):Math.min(...t.occurrences.map(o=>o.at));return t.occurrences.some(act=>act.protagonist&&!!act.stance&&act.at>anchor&&act.at<=o.at);});
 // These graph-only worlds contain only atomic/trace kits. GraphSower's instance/juncture link
 // denotes a continuation, never a looseEnd record. Do not count every offered step as growth.
 return {...t,occurrences:t.occurrences.map(o=>({...o,completion:o.completion||(o.source==='offered'&&o.protagonist)})),continuationSeeds:t.growth,growth:0,knownF14:f14.length?f14.some(n=>n>0):null,escalation:{rung:t.escalation.rung,allPull:checks.length>0&&checks.length===t.escalation.rung?checks.every(Boolean):null}};
}

