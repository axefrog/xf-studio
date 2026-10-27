import { readPatternFamilies, readVocabulary, type Pattern, type VocabularyDocument } from '../procedural/library.ts';
import vocab from '../../../../../research/story-engine/composite/vocabulary.json';
import tensions from '../../../../../research/story-engine/composite/patterns/tensions.json';
import turns from '../../../../../research/story-engine/composite/patterns/turns.json';
import closures from '../../../../../research/story-engine/composite/patterns/closures.json';
import shapes from '../../../../../research/story-engine/composite/patterns/shapes.json';
import { hookPack } from './hooks.ts';
import type { Pack } from '../seeding/types.ts';
import type { Sowable, Tempo } from '../procedural/types.ts';
import { run2World } from './run2.ts';
import { randomWithinGates } from './arms.ts';
import { defaultData } from '../procedural/data.ts';
import { atomicPack, atomicKinds } from './atoms3.ts';
export const vocabulary = readVocabulary(vocab as unknown as VocabularyDocument);
export const library = readPatternFamilies([tensions, turns, closures, shapes] as unknown as Array<{patterns: Pattern[]}>);
/** A factual trace adapter, not a story writer: the host renders the cited events. */
export function graphTracePack(): Pack {
 const p = hookPack(); const seed = structuredClone(p.seeds[0]!);
 seed.id = 'xf.m3c:trace'; seed.roles = { evidence: {kind:'core:event',scope:{nodes:[]}}, source:{kind:'core:event',optional:true,scope:{nodes:[]}} };
 seed.beats = {tell:{kind:'texture',play:'pack:trace'}};
 seed.sowable = {serves:['rumour','sighting','recap'],firstClass:0,tells:'evidence',explains:'source'} satisfies Sowable;
 const closing=structuredClone(seed);closing.id='xf.m3c:closing';closing.roles.evidence.must=[{path:'kind',op:'eq',arg:'meta:story'}];closing.sowable={serves:['recap'],firstClass:0} satisfies Sowable;
 return {id:'xf.m3c',version:1,seeds:[seed,closing],fragments:[{id:'trace',level:'phrase',roles:['evidence','source'],salience:'background',forms:{standard:'pack:trace-text'},channels:['trace']}],texts:[{id:'trace-text',text:'An account of the cited occurrence.',origin:'authored'}],authors:[],source:'procedural'};
}
export function run3World(name:string, arm:'E'|'A1', tempo:Tempo) {
 const {opts,notes}=run2World(name,arm,tempo);
 // Graph-only operation: the old stage/graph meta:story incompatibility is reported separately.
 opts.eventKinds=atomicKinds(); opts.packs = [graphTracePack(),atomicPack()]; opts.patterns = library; opts.vocabulary = vocabulary;
 opts.l3Data = defaultData();
 if(arm==='A1') { opts.l3Data = randomWithinGates(opts.l3Data!); opts.l3Data.sower.skeleton=0; }
 return {opts,notes};
}


