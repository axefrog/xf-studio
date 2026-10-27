import {expect,test} from 'bun:test';
import {H,s} from '../../src/id.ts';
import {castRole} from '../../src/seeding/cast.ts';
import {MINI_ID,MINI_PACK,miniPack} from './mini.ts';
import {makeWorld,settle,type World} from './world.ts';

const cause=H(s('nominal-cast'));
function fixture(name:string,kind='core:actor'){
 const w=makeWorld(name),person=w.k.root('person','core:person'),group=w.k.root('group','core:group'),place=w.k.root('place','core:place');
 for(const node of [person,group,place])w.k.addEdge({type:'core:located-in',from:node,to:w.city,cause});
 const pack=miniPack({}, {roles:{npc:{kind,scope:'city',onUnfilled:['wait','withdraw']}},windows:[{id:'w',opens:'yes',onClose:'withdraw'}]});
 expect(w.l2.installPack(pack)).toEqual([]);const result=w.l2.sow(MINI_PACK,MINI_ID);expect(result.ok,JSON.stringify(result.findings)).toBe(true);settle(w);
 return {w,inst:w.l2.instance(result.instance!)!,person,group,place};
}
function query(w:World,kind:string,nodes:string[]){const out=w.k.query({find:kind,scope:{nodes},at:w.k.now,must:[],limit:'all'});expect(out.status).toBe('ok');return out.status==='ok'?out.items.map(i=>i.id).sort():[];}

test('an open nominal actor casts a person and a group, never a place or the protagonist',()=>{
 const {w,inst,person,group,place}=fixture('nominal-open');
 expect([person,group]).toContain(inst.st.roles.npc!.cast!);expect(inst.st.roles.npc!.candidates).toBe(2);
 // No identity binding: narrow only the structural query scope, and clear the saved draw.
 for(const node of [person,group]){inst.st.document.roles.npc!.scope={nodes:[node,place,w.v]};delete inst.st.draws['cast:npc'];expect(castRole(w.l2,inst,'npc')).toEqual({node,candidates:1});}
 expect(query(w,'core:actor',[person,group,place,w.v])).toEqual([]);
});

for(const [kind,member] of [['core:person','person'],['core:group','group']] as const)test(`${kind}-only casting and structural query membership remain unchanged`,()=>{
 const f=fixture('structural-'+member,kind),{w,inst,person,group,place}=f;
 expect(castRole(w.l2,inst,'npc')).toEqual({node:f[member],candidates:1});
 const nodes=[person,group,place];expect(query(w,kind,nodes)).toEqual([f[member]]);
 // Having no matching member in scope does not widen a structural search to other actors.
 inst.st.document.roles.npc!.scope={nodes:[member==='person'?group:person,place]};delete inst.st.draws['cast:npc'];expect(castRole(w.l2,inst,'npc').node).toBeUndefined();
});

test('the nominal casting pool and keyed draw are stable across scope order, save and reload',()=>{
 const {w,inst,person,group,place}=fixture('nominal-reload'),id=inst.id,first=inst.st.roles.npc!.cast!;
 const pools:string[][]=[];const original=w.l2.fitWeights.bind(w.l2);w.l2.fitWeights=input=>{if(input.choice==='cast:npc')pools.push(input.options.map(o=>o.id));return original(input);};
 for(const nodes of [[person,group,place],[place,group,person]]){inst.st.document.roles.npc!.scope={nodes};delete inst.st.draws['cast:npc'];expect(castRole(w.l2,inst,'npc').node).toBe(first);}
 w.k.persistence.save('nominal');w.k.persistence.load('nominal',w.gamePort);settle(w);
 const after=w.l2.instance(id)!;delete after.st.draws['cast:npc'];expect(castRole(w.l2,after,'npc')).toEqual({node:first,candidates:2});
 // core:group precedes core:person, regardless of their node IDs or scope order.
 expect(pools.length).toBeGreaterThanOrEqual(3);for(const pool of pools)expect(pool).toEqual([group,person]);
 expect(query(w,'core:actor',[person,group,place])).toEqual([]);
});
