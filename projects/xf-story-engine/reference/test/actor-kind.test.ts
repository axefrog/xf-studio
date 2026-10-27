import {test,expect} from 'bun:test';
import {coreDefs,mergeDefs} from '../src/core-schema.ts';import {Kernel} from '../src/kernel.ts';import {H,s} from '../src/id.ts';

test('nominal actor data preserves structural person queries and compatible inherited classifications',()=>{
 const current=coreDefs(),old=structuredClone(current);old.kinds=old.kinds.filter(k=>k.id!=='core:actor');for(const k of old.kinds)k.classifiesAs=k.classifiesAs?.filter(id=>id!=='core:actor');
 const extra={dims:[],edgeTypes:[],kinds:[{id:'test:resident',extends:['core:thing'],classifiesAs:['core:person'],slots:[]},{id:'test:person',extends:['core:person'],slots:[]},{id:'test:item',extends:['core:thing'],slots:[]}]};
 const sets=[old,current].map(defs=>{const k=Kernel.create({worldSeed:H(s('actor-data-regression')),defs:mergeDefs(defs,extra)}),person=k.root('person','core:person'),child=k.root('child','test:person'),resident=k.root('resident','test:resident'),group=k.root('group','core:group'),item=k.root('item','test:item'),place=k.root('place','core:place');const nodes=[person,child,resident,group,item,place],q=k.query({find:'core:person',scope:{nodes},at:0,must:[],limit:'all'});expect(q.status).toBe('ok');if(q.status!=='ok')throw Error('query failed');expect(q.items.map(i=>i.id).sort()).toEqual([person,child].sort());return {k,ids:q.items.map(i=>i.id).sort()};});
 expect(sets[0]!.ids).toEqual(sets[1]!.ids);const k=sets[1]!.k;for(const kind of ['core:person','core:group','test:resident','test:person'])expect(k.schema.isCompatibleKind(kind,'core:actor')).toBe(true);for(const kind of ['core:event','test:item','core:place'])expect(k.schema.isCompatibleKind(kind,'core:actor')).toBe(false);
 const q=k.query({find:'core:actor',scope:{nodes:[...k.store.headers.keys()]},at:0,must:[],limit:'all'});expect(q.status).toBe('ok');if(q.status==='ok')expect(q.items).toEqual([]);
});
