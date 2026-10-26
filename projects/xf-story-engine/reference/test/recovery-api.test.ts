import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'ts-parser';
import { fileURLToPath } from 'node:url';
import { coreKernel } from './helpers.ts';
import { newOpCtx } from '../src/resolve.ts';
import { H, s } from '../src/id.ts';

// Raw storage/replay and collector hooks intentionally see physical residency. They cannot
// recover: doing so would make sweeping itself keep history alive. These are not semantic reads.
const raw: Record<string, string> = {
 'HolotableObserver.sample': 'physical diagnostic observer; must never recover or materialise the observed execution (holotable read-only parity tests)',
 'writeKeys': 'physical audit classification; never repairs the audited store',
 'Kernel.create': 'factory, no live state',
 'Kernel.emit': 'notification snapshot, no lookup',
 'Kernel.submit': 'queues an operation; application uses gated writes', 'Evolution.submit': 'queues an operation; application uses gated writes',
 'Kernel.expandId': 'pure identity expansion', 'Kernel.isId': 'pure type guard',
 'Events.setMaterialisation': 'header-first replay hook', 'Events.forgetMaterialisation': 'collector hook',
 'Events.setCanonRecord': 'replay hook',
 'Persistence.savedHeader': 'saved identity lookup used by collector, no live lookup',
 'Persistence.discoveryIdsOfKind': 'candidate index only; consumer charges and recovers reached ids',
 'Persistence.discoveryChildren': 'candidate index only; consumer charges and recovers reached ids',
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

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const callable = (n: ts.Node): n is Callable => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** Each callable has its own boundary. A gate in its factory or sibling cannot protect a later call.
 * Resolve store aliases through their initializer, and require recovery of the lookup's input,
 * rather than accepting any recovery-looking text somewhere in the enclosing method.
 */
function auditOperation(api: string, fn: Callable, file: ts.SourceFile): void {
 const aliases = new Map<string, Array<{value:string; scope:ts.Node; at:number}>>();
 const collect = (n: ts.Node) => {
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
   let scope:ts.Node=n.parent;
   while(scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope=scope.parent;
   const declarations=aliases.get(n.name.text)??[];
   declarations.push({value:n.initializer.getText(file),scope,at:n.pos});aliases.set(n.name.text,declarations);
  }
  n.forEachChild(collect);
 };
 collect(file);
 const expand = (text: string, at:ts.Node): string => {
  const scopes:ts.Node[]=[];for(let n:ts.Node|undefined=at;n;n=n.parent) scopes.push(n);
  for(let i=0;i<aliases.size;i++) {
   const next=text.replace(/^\w+/,name=>{
    const visible=aliases.get(name)?.filter(a=>a.at<at.pos && scopes.includes(a.scope))
     .sort((a,b)=>scopes.indexOf(a.scope)-scopes.indexOf(b.scope) || b.at-a.at);
    const alias=visible?.[0];
    const parameter=scopes.findIndex(n=>callable(n) && n.parameters.some(p=>p.name.getText(file)===name));
    if(!alias || (parameter>=0 && parameter<scopes.indexOf(alias.scope))) return name;
    return /^(?:this|[A-Za-z_$]\w*)(?:\.[A-Za-z_$]\w*)*$/.test(alias.value)?alias.value:name;
   });
   if(next===text) break;text=next;
  }
  return text;
 };
 const gates: ts.CallExpression[] = [], lookups: ts.CallExpression[] = [];
 const walk = (n: ts.Node) => {
  if(n!==fn && callable(n)) return;
  if(ts.isCallExpression(n)) {
   const target=expand(n.expression.getText(file),n);
   if(/\.(recoverIfSaved|restoreReferencedHeader|restoreContribution|restoreEdge)$/.test(target)) gates.push(n);
   if(/\.store\.(?:(?:headers|nodes|edges|withdrawn)\.(?:get|has)|header|pin|contribution|isWithdrawn|edgesFrom|edgesTo|contributionsNaming|pinsOfNode|ownedOf|membersOfSlot|localState)$/.test(target)) lookups.push(n);
  }
  n.forEachChild(walk);
 };
 if(fn.body) walk(fn.body);
 const inputs = new Set(fn.parameters.map(p=>p.name.getText(file)));
 for(const lookup of lookups) {
  const arg=lookup.arguments[0] && expand(lookup.arguments[0].getText(file),lookup), root=arg?.match(/^\w+/)?.[0];
  const preceding=gates.filter(g=>g.end<=lookup.pos);
  const covered=preceding.some(g=>g.arguments.some(a=> {
   const recovered=expand(a.getText(file),g);return arg===recovered || arg?.startsWith(recovered+'.') || arg?.startsWith(recovered+'[');
  }));
  if(!preceding.length || (root && inputs.has(root) && !covered))
   throw new Error('public reference API bypasses recoverIfSaved: '+api);
 }
}

function facadeOperations(owner: string, fn: Callable, file: ts.SourceFile) {
 const rows: Array<{api:string;route:string}>=[];
 const walk=(n:ts.Node)=>{
  if(n!==fn && callable(n)) {
   const parent=n.parent;
   // Object members are the returned read/port facades. Local implementation closures are not APIs.
   if(ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(n) || ts.isReturnStatement(parent)) {
    const name=ts.isPropertyAssignment(parent)?parent.name.getText(file):ts.isMethodDeclaration(n)?n.name.getText(file):'returned';
    const api=owner+'.'+name;
    auditOperation(api,n,file);rows.push({api,route:layerRoute(n.body?.getText(file)??'')});
   }
   return;
  }
  n.forEachChild(walk);
 };
 walk(fn);return rows;
}

const sourceFiles = [...new Bun.Glob('**/*.ts').scanSync({cwd:fileURLToPath(new URL('../src/',import.meta.url))})].sort().map(name =>
 ts.createSourceFile(name,readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true));

export function recoveryApiInventory(extraSource?: string, override?: {file:string;source:string}) {
 const rows: Array<{ api: string; route: string }> = [];
 const files = sourceFiles.map(file=>override?.file===file.fileName?
   ts.createSourceFile(file.fileName,override.source,ts.ScriptTarget.Latest,true):file);
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
    auditOperation(api,fn,file);
    rows.push(...facadeOperations(api,fn,file));
    rows.push({api,route: recoveryBoundary.test(body) ? layerRoute(body) : 'pure data, supplied predicate environment or gated kernel delegation'});
  }
  for(const statement of file.statements) {
   if(!ts.isVariableStatement(statement) || !statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) continue;
   for(const declaration of statement.declarationList.declarations) {
    const fn=declaration.initializer;
    if(!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))) continue;
    const body=fn.body.getText(file);
    if(!fn.parameters.some(p=>carriesReference(p.type)) && !/\bKernel\b/.test(fn.getText(file)) && !liveLookup.test(body)) continue;
    const api=declaration.name.getText(file);
    auditOperation(api,fn,file);rows.push({api,route:layerRoute(body)},...facadeOperations(api,fn,file));
   }
  }
  for(const cls of file.statements.filter(ts.isClassDeclaration)) {
   if(!cls.name || (!['Kernel','Store','PersistedView'].includes(cls.name.text) && !liveLookup.test(cls.getText(file)) && !/this\.(k\b|sim\.k\b|w\.k\b)/.test(cls.getText(file)) && !cls.members.some(m=>ts.isConstructorDeclaration(m) && m.parameters.some(p=>p.type?.getText(file)==='Kernel')))) continue;
   for(const m of cls.members) {
    if(!ts.isMethodDeclaration(m) || !m.body || m.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)) continue;
    const api=cls.name.text+'.'+m.name.getText(file), signature=m.parameters.map(p=>p.type?.getText(file)??'').join(' ');
    if(!records.test(signature) && !m.parameters.some(p=>carriesReference(p.type)) && !liveLookup.test(m.body.getText(file)) && !recoveryBoundary.test(m.body.getText(file)) && !raw[api] && !['Kernel.root','Kernel.mirrored'].includes(api)) continue;
    const body=m.body.getText(file), gate=body.indexOf('.recoverIfSaved('), allowed=raw[api], delegate=delegates[api];
    if(!allowed && !['Store','PersistedView'].includes(cls.name.text)) {
      if(!delegate) auditOperation(api,m,file);
      rows.push(...facadeOperations(api,m,file));
    }
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

test('SE-231 inventory audits facade operations, store aliases, exported expressions and the recovered argument',()=>{
 for(const source of [
  'export const arrowLookup=(k:Kernel,id:Id)=>k.store.header(id);',
  'export const expressionLookup=function(k:Kernel,id:Id){const table=k.store;return table.header(id);};',
  'export function wrongAlias(k:Kernel,id:Id,other:Id){const actual=id;const table=k.store;k.persistence.recoverIfSaved(other);return table.header(actual);}',
  'export function wrongArgument(k:Kernel,id:Id,other:Id){k.persistence.recoverIfSaved(other);return k.store.header(id);}',
  'class Factory {constructor(private k:Kernel){} make(id:Id){this.k.persistence.recoverIfSaved(id);const store=this.k.store;return {kindOf:(n:Id)=>store.header(n)?.kind};}}',
  'export const factory=(k:Kernel,id:Id)=>{k.persistence.recoverIfSaved(id);return (n:Id)=>k.store.header(n);};',
 ]) expect(()=>recoveryApiInventory(source), 'SE-231 semantic: ungated callable rejected').toThrow('public reference API bypasses recoverIfSaved:');
 const source=readFileSync(new URL('../src/resolve.ts',import.meta.url),'utf8');
 for(const replacement of ['','this.k.persistence.recoverIfSaved(restrict);']) {
  const changed=source.replace('kindOf: (n) => { this.k.persistence.recoverIfSaved(n);','kindOf: (n) => { '+replacement);
  expect(changed).not.toBe(source);
  expect(()=>recoveryApiInventory(undefined,{file:'resolve.ts',source:changed}), 'SE-231 semantic: actual kindOf boundary required')
   .toThrow('public reference API bypasses recoverIfSaved: Resolver.makeEnv.kindOf');
 }
});

test('SE-231-facade: predicate facade reads recover their own argument after factory creation and sweep',()=>{
 const k=coreKernel('predicate-facade-recovery'), creator=k.root('O','core:person'), place=k.root('P','core:place');
 const event=k.events.mintEvent({creator,cause:creator,name:'E',time:0,kind:'arrival',place,participants:[{who:creator,role:'actor'}]});
 const seed=H(s('consumer'));k.retention.setSeed({id:seed,state:{},nodes:[event]});k.settle();k.persistence.save('A');k.retention.endSeed(seed);
 // Construct first: recovery in makeEnv cannot protect references acquired later by its facade.
 const member=k.address(event,'participants[0]');
 const env=k.resolver.makeEnv(newOpCtx(k.config.allowance),0);
 const sweep=()=>{k.retention.scheduleSweep();k.settle();expect(k.store.header(event)).toBeUndefined();};
 sweep();expect(env.kindOf(event), 'SE-231-facade semantic: kindOf recovers the called id').toBe('core:event');
 sweep();expect(env.edgesFrom(event).map(e=>e.to)).toEqual([place]);
 sweep();expect(env.ownerOf(member)).toBe(event);
 sweep();expect(env.read(event,'time').value).toBe(0);
});
