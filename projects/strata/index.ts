/**
 * Strata: a layered, event-sourced node graph with deterministic simulation testing.
 *
 * This file is the public API. Everything a project needs is exported here; the simulation harness, the reference
 * model and the store conformance suite are in `strata/testing`. Nothing else is public, and `tests/api-surface.test.ts`
 * snapshots this surface so any change to it is deliberate (see CHANGELOG.md).
 */

// Registration
export { defineType, defineRule, constantId } from "./src/define";
export type { TypeSpec, TypeDef, RuleSpec, RuleDef, RuleContext, ConflictDraft, DeriveContext, Upcaster } from "./src/define";
export { defineSource, defineSink, JobQueue } from "./src/sources";
export type {
  Clock, Random, RandomStream, Sources, SourceDef, SinkDef, Sink, InputEvent, InputSource, FileSource, JobPriority, JobSource,
  RequestSource,
} from "./src/sources";

// The graph
export { createGraph } from "./src/graph";
export type { Graph, GraphOptions, GraphView, CommitOptions, PendingCommit, RejectedCommit } from "./src/graph";
export type { NodeSnapshot, DeriveResult, Reference, Referrer } from "./src/model";

// Data types
export type {
  NodeId, NodeType, NodeRef, Path, EventRef, FieldKind, FieldSpec, Issue, Layer, OwnValues, NodeState, PrimitiveOp, Op,
  Provenance, CommitMeta, Entry, Snapshot, TimePoint, NodeChange, ChangeSet, Origin, Severity, GraphPatch, FixRoute, Conflict,
  Target, Edit, RefusalCode, Refusal, CommitResult,
} from "./src/types";
export type { Json } from "./src/json";
export { canonical, equal } from "./src/json";
export { pathKey, keyPath, TOMBSTONE } from "./src/paths";
export { fold } from "./src/fold";

// Storage
export { MemoryStore } from "./src/store";
export type { GraphStore, NodeIndexRow, StoredNode, AppendRequest, AppendResult } from "./src/store";

// Compaction primitives
export { keepSet, rollupValueStream, rollupDeltaStream, collapseInline, entryReferences } from "./src/compaction";
export type { Stream, KeepOptions } from "./src/compaction";

// Actors and trust (primitives)
export { trustSelf, trustTable, resolveClaims } from "./src/trust";
export type { Claim, TrustPolicy, Disagreement } from "./src/trust";

// The inspector's data model
export { parseQuery, INSPECTOR_PAGE } from "./src/inspect";
export type { InspectorRow, InspectorEdge, InspectorPage, InspectorDetail, InspectorQuery } from "./src/inspect";
