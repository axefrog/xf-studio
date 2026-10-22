// The Story Engine kernel reference model: the TypeScript oracle for specification S0 v3
// (research/story-engine/spec/kernel.md). Behavioural policies (S1) are stubs, clearly marked.

export { DEFAULT_CONFIG, makeConfig, type Config } from './config.ts';
export { H, rand, toUnit, rootId, ownedId, memberId, mintedId, mirroredId, s as hs, i as hi, id as hid, f as hf, b as hb, val as hval } from './id.ts';
export { ln } from './fdlibm-log.ts';
export { Kernel, splitWindowPath, type ContributionSpec, type EdgeSpec, type KernelOptions, type PinSpec, type TickReport } from './kernel.ts';
export { Schema, SchemaError } from './schema.ts';
export { coreRegistry, Registry, CONFLICT_TABLE, UNIFORM_PRIOR, INTEREST_TYPES, type InterestType } from './registry.ts';
export { coreDefs, mergeDefs, CORE_DRIVES } from './core-schema.ts';
export type { DimensionDef, KindDef, SlotDef, EdgeTypeDef, SchemaDefs, ValueType, CandidateQuery } from './schema-types.ts';
export type * from './types.ts';
export { Resolver, type Trace, type Constraint, type TraceFactor, type TraceScore } from './resolve.ts';
export { Provenance, type Explanation, type ExplainEntry } from './provenance.ts';
export { Events, type EventSpec } from './events.ts';
export { Summaries, type SummarySpec } from './summary.ts';
export { Evolution, processCause, type ProcessDef, type ProcessCtx, type ProcessOp, type ProcessState, type ExternalOp, type Envelope } from './evolution.ts';
export { Frames, type ContextFrame, type FrameSpec, type Dilemma } from './frames.ts';
export { Groups, type Decision } from './groups.ts';
export { Dispatcher, type Relevance } from './relevance.ts';
export { Beliefs, STUB_POLICY, type Belief, type BeliefPolicy, type Known } from './beliefs.ts';
export { Retention, type SeedRecord } from './retention.ts';
export { Persistence, PersistedView, type SaveRecord, type PersistOp, type GamePort, type LoadReport } from './persistence.ts';
export { Store } from './store.ts';
export { Budget, Worklist, Allowance, LimitExceeded, DefectLog } from './work.ts';
