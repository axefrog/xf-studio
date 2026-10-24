import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'ts-parser';
import { fileURLToPath } from 'node:url';

// Raw storage/replay and collector hooks intentionally see physical residency. They cannot
// recover: doing so would make sweeping itself keep history alive. These are not semantic reads.
const raw: Record<string, string> = {
 'writeKeys': 'physical audit classification; never repairs the audited store',
 'Kernel.create': 'factory, no live state',
 'Kernel.emit': 'notification snapshot, no lookup',
 'Kernel.submit': 'queues an operation; application uses gated writes', 'Evolution.submit': 'queues an operation; application uses gated writes',
 'Kernel.expandId': 'pure identity expansion', 'Kernel.isId': 'pure type guard',
 'Events.setMaterialisation': 'header-first replay hook', 'Events.forgetMaterialisation': 'collector hook',
 'Events.setCanonRecord': 'replay hook',
 'Persistence.savedHeader': 'saved identity lookup used by collector, no live lookup',
 'Persistence.canSweepEdge': 'exact recoverability predicate', 'Persistence.canSweepContribution': 'exact recoverability predicate',
 'Protection.capture': 'save hook records physically held protection intervals without resurrecting history',
 'Retention.endSeed': 'seed table is not swept',
 'Retention.pinInEffectNow': 'collector predicate', 'Retention.isRootEdge': 'collector predicate',
 'Retention.rootIds': 'physical root discovery; marked traversal recovers their dependencies',
 'Retention.isOwnEventLocation': 'collector predicate', 'Retention.sweepNode': 'collector operation',
 'Frames.frame': 'frame table is not swept', 'Frames.framesOf': 'frame table is not swept',
 'Frames.childrenOf': 'frame table is not swept', 'Frames.version': 'frame table is not swept',
 'Frames.eligible': 'pure frame predicate', 'Frames.pull': 'frame table is not swept',
 'Frames.pullVia': 'frame table is not swept', 'Frames.deliveryTargets': 'frame table is not swept',
 'Frames.isAncestorOrSelf': 'frame table is not swept', 'Frames.ancestorsOrSelf': 'frame table is not swept',
 'Frames.insert': 'replay hook', 'Frames.remove': 'frame table is not swept',
 'Frames.setStatus': 'frame table is not swept', 'Frames.setWeight': 'frame table is not swept',
 'Frames.setInterests': 'frame table is not swept; selectors are evaluated through the resolver environment',
 'Frames.setParents': 'frame table is not swept', 'Frames.addParent': 'frame table is not swept',
 'Frames.checkDilemmas': 'frame table is not swept; node reads use resolver environment',
 'Groups.strengthOf': 'pure edge attribute predicate', 'Groups.onEdgeChange': 'notification hook',
 'Groups.onFrameChange': 'notification hook', 'Beliefs.restore': 'replay hook',
 'Summaries.setRecord': 'replay hook', 'Summaries.itemId': 'pure identity derivation',
 'Resolver.effectiveMode': 'pure schema/header predicate', 'Resolver.pinRegion': 'pure pin value conversion',
 'Evolution.restore': 'replacement replay hook', 'Settings.restore': 'replacement replay hook',
};
// Delegation is checked by the same audit recursively, including private identity helpers.
const delegates: Record<string, string[]> = {
 'Kernel.root':['recoverOrAddHeader'], 'Kernel.mirrored':['recoverOrAddHeader'],
 'Kernel.mint':['recoverOrAddHeader'], 'Kernel.mintSilent':['recoverOrAddHeader'],
 'Kernel.contribute':['restoreContribution'], 'Kernel.endContribution':['restoreContribution'],
 'Kernel.addEdge':['restoreReferencedHeader','restoreEdge'], 'Kernel.endEdge':['restoreEdge'],
 'Kernel.reopenEdge':['restoreEdge'], 'Kernel.updateEdge':['restoreEdge'],
 'Persistence.installPack':['contribute'],
 'Persistence.currentView':['marked','eventFacts'],
 'Persistence.save':['currentView'],
 'Retention.setSeed':['marked'], 'Retention.isRetained':['marked'], 'Retention.maxRetainedMember':['compute'],
};
const records = /\b(Id|NodeHeader|Contribution|Pin|Edge|Selector|Query|QueryScope|CandidateQuery|EventSpec|EventProvenance|EventCanonRecord|SummarySpec|SummaryRecord|PinSpec|ContributionSpec|EdgeSpec|SeedRecord|Belief|BeliefEntry|ContextFrame|FrameSpec|FrameParent|FrameInterests|Decision|Change|Envelope|ProcessState)\b/;
const liveLookup = /\.store\.(?:(?:headers|nodes|edges|withdrawn)\.(?:get|has)|header|pin|contribution|isWithdrawn|edgesFrom|edgesTo|contributionsNaming|pinsOfNode|ownedOf|membersOfSlot|localState)\(/;
const recoveryBoundary = /\.(recoverIfSaved|restoreReferencedHeader|restoreContribution|restoreEdge)\(/;
function checkLiveLookups(api: string, body: string): void {
  const live = body.search(liveLookup), boundary = body.search(recoveryBoundary);
  if (live >= 0 && (boundary < 0 || live < boundary))
    throw new Error('public reference API bypasses recoverIfSaved: '+api);
}
const layerRoute = (body: string): string => {
  const boundary = body.match(recoveryBoundary)?.[1];
  return boundary === 'recoverIfSaved' ? boundary : boundary ? 'via '+boundary : 'layer-owned data or gated kernel delegation';
};

export function recoveryApiInventory(extraSource?: string) {
 const rows: Array<{ api: string; route: string }> = [];
 const files = [...new Bun.Glob('**/*.ts').scanSync({cwd:fileURLToPath(new URL('../src/',import.meta.url))})].sort().map(name =>
   ts.createSourceFile(name,readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true));
 if(extraSource) files.push(ts.createSourceFile('future/entry.ts',extraSource,ts.ScriptTarget.Latest,true));
 const declarations = new Map<string, ts.Node>();
 for (const file of files) for (const node of file.statements)
   if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) declarations.set(node.name.text,node);
 const dependencies = (node: ts.Node | undefined): Set<string> => {
   const refs=new Set<string>();
   const walk=(n: ts.Node) => {
     if (ts.isFunctionTypeNode(n) || ts.isMethodSignature(n)) return;
     if (ts.isTypeReferenceNode(n)) refs.add(n.typeName.getText());
     n.forEachChild(walk);
   };
   if(node) walk(node); return refs;
 };
 const refsByName=new Map([...declarations].map(([name,node])=>[name,dependencies(node)]));
 const referenceTypes=new Set(['Id']);
 for(let changed=true;changed;){changed=false;for(const [name,refs] of refsByName)
   if(!referenceTypes.has(name) && [...refs].some(r=>referenceTypes.has(r))){referenceTypes.add(name);changed=true;}}
 const carriesReference=(node:ts.Node|undefined)=>[...dependencies(node)].some(r=>referenceTypes.has(r));
 for (const file of files) {
  for (const fn of file.statements.filter(ts.isFunctionDeclaration)) {
    if (!fn.name || !fn.body || !fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) continue;
    const body=fn.body.getText(file);
    if (!fn.parameters.some(p=>/\b(Kernel|Layer2|Sim|World|PredicateEnv)\b/.test(p.type?.getText(file)??'')) &&
      !liveLookup.test(body) && !recoveryBoundary.test(body)) continue;
    if (!fn.parameters.some(p=>carriesReference(p.type)) && !recoveryBoundary.test(body) && !liveLookup.test(body)) continue;
    const api=fn.name.text;
    if (api==='readEvent') continue;
    if(raw[api]) {rows.push({api,route:'raw: '+raw[api]});continue;}
    checkLiveLookups(api,body);
    rows.push({api,route: recoveryBoundary.test(body) ? layerRoute(body) : 'pure data, supplied predicate environment or gated kernel delegation'});
  }
  for(const cls of file.statements.filter(ts.isClassDeclaration)) {
   if(!cls.name || (!['Kernel','Store','PersistedView'].includes(cls.name.text) && !liveLookup.test(cls.getText(file)) && !/this\.(k\b|sim\.k\b|w\.k\b)/.test(cls.getText(file)) && !cls.members.some(m=>ts.isConstructorDeclaration(m) && m.parameters.some(p=>p.type?.getText(file)==='Kernel')))) continue;
   for(const m of cls.members) {
    if(!ts.isMethodDeclaration(m) || !m.body || m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)) continue;
    const api=cls.name.text+'.'+m.name.getText(file), signature=m.parameters.map(p=>p.type?.getText(file)??'').join(' ');
    if(!records.test(signature) && !m.parameters.some(p=>carriesReference(p.type)) && !liveLookup.test(m.body.getText(file)) && !['Kernel.root','Kernel.mirrored'].includes(api)) continue;
    const body=m.body.getText(file), gate=body.indexOf('.recoverIfSaved('), allowed=raw[api], delegate=delegates[api];
    if (['Store','PersistedView'].includes(cls.name.text)) rows.push({api, route:'raw: physical storage or saved data, never a semantic reference'});
    else if(allowed) rows.push({api,route:'raw: '+allowed});
    else if(gate>=0) {
     checkLiveLookups(api,body);
     // No live table access before the boundary (aliases and writable barriers are allowed).
     expect(body.slice(0,gate),api+' inspects live state before recovery').not.toMatch(/\.(store|frames|canonRecords|materialisations|byBeliever)\b/);
     rows.push({api,route:'recoverIfSaved'});
    } else if(delegate && delegate.every(n=>body.includes('.'+n+'('))) rows.push({api,route:'via '+delegate.join(', ')});
    else if (/[\\/]/.test(file.fileName)) { checkLiveLookups(api,body); rows.push({api,route:layerRoute(body)}); }
    else throw new Error('public reference API bypasses recoverIfSaved: '+api);
   }
  }
 }
 // The cross-layer read facade is an exported function rather than a Kernel-owned class.
 const views=readFileSync(new URL('../src/procedural/views.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');
 expect(views).toContain('export function readEvent(k: Kernel, id: string): EventView | undefined {\n  k.persistence.recoverIfSaved(id);');
 rows.push({api:'readEvent',route:'recoverIfSaved'});
 return rows.sort((a,b)=>a.api.localeCompare(b.api));
}
test('public reference API inventory: every new operation must declare its recovery boundary',()=>{
 const rows=recoveryApiInventory(); if(process.env.RECOVERY_INVENTORY) console.log('INVENTORY:'+JSON.stringify(rows)); expect(rows.length).toBeGreaterThan(90);
 const notes=readFileSync(new URL('../SPEC-NOTES.md',import.meta.url),'utf8');
 for(const {api} of rows) expect(notes.includes('`'+api+'`'),'SPEC-NOTES API inventory missing '+api).toBe(true);
});


test('API enumeration rejects a future id hidden inside a new record type',()=>{
  expect(()=>recoveryApiInventory(`type NewReference={target:Id};
    class FutureApi { constructor(private k:Kernel){} lookup(input:NewReference){return this.k.store.header(input.target);} }`))
    .toThrow('public reference API bypasses recoverIfSaved: FutureApi.lookup');
  expect(()=>recoveryApiInventory(`export function futureLookup(k:Kernel, id:Id){return k.store.edges.get(id);}`))
    .toThrow('public reference API bypasses recoverIfSaved: futureLookup');
  expect(()=>recoveryApiInventory(`export function lateRecovery(k:Kernel, id:Id){const p=k.store.pin(id);k.persistence.recoverIfSaved(id);return p;}`))
    .toThrow('public reference API bypasses recoverIfSaved: lateRecovery');
});
test('identity and typed recovery adapters reach the common gate',()=>{
 const kernel=readFileSync(new URL('../src/kernel.ts',import.meta.url),'utf8');
 expect(kernel).toMatch(/private recoverOrAddHeader[^]*?\{\s*if \(this\.persistence\.restoreReferencedHeader\(header\.id\)\)/);
 const persistence=readFileSync(new URL('../src/persistence.ts',import.meta.url),'utf8');
 for(const name of ['restoreReferencedHeader','restoreContribution','restoreEdge'])
   expect(persistence).toMatch(new RegExp(name+'\\(id: Id\\)[^{]*\\{\\s*this\\.recoverIfSaved\\(id\\)'));
});
