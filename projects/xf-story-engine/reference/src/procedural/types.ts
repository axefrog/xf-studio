// S3 v0.3 core. These are copied, versioned data; none holds a live kernel object.
import type { Effect, GameTime, Id, Predicate } from '../types.ts';
import type { EventSpec } from '../events.ts';
import type { CompiledSeed, ExposureGrade, SeedLevel, TimingRequest } from '../seeding/types.ts';

export type Tempo = 'off' | 'calm' | 'steady' | 'restless';
export type Form = 'rumour' | 'recap' | 'sighting' | 'foreshadow' | 'offer' | 'aftermath';
export interface EventView extends EventSpec {
  id: Id;
  provenance?: import('../events.ts').EventProvenance;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  causes: Id[];
  witnesses: Id[];
}
export interface EventClause {
  kind: string | { tag: string };
  who?: Array<{ role: string; as: string }>;
  effects?: Array<{ on: string; effect: Effect | Effect[] }>;
  where?: Predicate[];
}
export interface SiftPattern {
  graph?: import('../seeding/pattern-types.ts').Pattern;
  id: string;
  version: number;
  roles: Record<string, { kind: string; where?: Predicate[] }>;
  stages: EventClause[];
  unless?: Array<{ between: [number, number]; clause: EventClause }>;
  within?: number;
  once?: string[];
  tags: string[];
  telling: { form: Form; kit?: string; binds: Record<string, string> };
}
export interface Sowable {
  serves: Array<Form | 'nudge'>;
  fills?: Array<{ fn: string; args: Record<string, string>; cause?: string }>;
  tells?: string; explains?: string;
  firstClass: 0 | 1 | 2 | 3 | 4;
  weight?: number;
  climactic?: boolean;
  tags?: string[];
}
export interface PoolEntry {
  graph?: import('./graph-types.ts').GraphState;
  id: Id;
  bindingKey: Id;
  seq: number;
  pattern: string;
  version: number;
  bindings: Record<string, Id>;
  stages: Array<{ event: Id; time: GameTime }>;
  firstTime: GameTime;
  lastTime: GameTime;
  complete: boolean;
  story?: Id;
  seed?: Id;
  refusals: number;
  cooldownUntil: number;
}
export interface Layer3State {
  schema: 1 | 2;
  /** Effective story schema: adopted when graphs install, restored solely from this marker on load. */
  storyData?: true;
  slots: { open: { next: number } };
  nextSeq: number;
  openLockUntil: number;
  /** Closures already consumed by a director tick; later closures remain pending across loads. */
  consumedOutcomes: Id[];
  pool: PoolEntry[];
  tombstones: Array<{ pattern: string; key: Id; until: GameTime }>;
  pending: Array<{ instance: Id; sownAt: number }>;
  nudges: Array<{ instance: Id; sownAt: number }>;
  skeletons: { seq: number; ring: Array<{ thread: Id; tokens: Id[]; play: number; seq: number }> };
  recent: Array<{ pattern: string; kit: string; place?: Id; at: number }>;
  // v0.3 specifies the buffer but omits its physical fields from §9.2 (SPEC-NOTES 175).
  buffer: Array<{ pattern: string; version: number; event: EventView; change?: import('../types.ts').Change; dilemma?: import('../frames.ts').Dilemma }>;
  // Retention keeps addresses, not simulation contributions. Restore these silently after replay.
  evidence: EventView[];
}
export interface InstanceView {
  id: Id;
  template: { pack?: string; id: string; version: number };
  level: SeedLevel;
  source: { by: 'pack' | 'director' | 'plugin'; layer: string; decision?: Id };
  sowSeq: number;
  state: string;
  growsFrom?: { parent?: Id; looseEnd?: { seed: Id }; instance?: Id; juncture?: string };
  roles: Record<string, { cast?: Id; committed: boolean; anchor: boolean }>;
  beats: Array<{ key: string; kind?: string; state: string }>;
  displays: Array<{ delivery: Id; grade: ExposureGrade; playTotal: number }>;
  responses: Array<{ kind: string; delivery?: Id; playTotal: number; game: number }>;
  draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }>;
  closingPending: boolean;
}
export interface Layer2View {
  playTotal(): number;
  instances(): InstanceView[];
  instance(id: Id): InstanceView | undefined;
  sownBy(decision: Id): Id[];
  global(): { offerCount: number; fragmentUses: Record<string, { count: number; lastAt: number; lastOffer: number }> };
  exposedNode(node: Id, grade: ExposureGrade): boolean;
  claimConflict(node: Id, span: 'seed' | 'beats', share: 'none' | 'background' | 'any'): boolean;
}
export interface KernelView {
  event(id: Id): EventView | undefined;
  holds(p: Predicate, node: Id, at?: number): boolean;
  kind(node: Id): string | undefined;
  isKind(kind: string, parent: string): boolean;
  isSpine(node: Id): boolean;
  aesthetic(node: Id, feature: string): number | undefined;
  eventKind(name: string): { tags: string[]; producers: string[] } | undefined;
  eventKinds(): string[];
}
export interface SenseFrame {
  at: number;
  health: number;
  downed: boolean;
  hostileAware: boolean;
  hostileAwareNear: boolean;
  hostileDeaths: number[];
  civilianDeaths: number[];
  heatStage: number;
  pursuit: boolean;
  collision: boolean;
  stims: number;
  specialEncounter: boolean;
  district: Id | null;
  moving: boolean;
  metresMoved: number;
  jump?: 'load' | 'sleep' | 'wait' | 'travel';
  questCompleted?: boolean;
}
export interface SenseWeights {
  healthLost: number;
  lowHealth: number;
  downed: number;
  combatEntered: number;
  hostileDeath: number;
  civilianDeath: number;
  heatRise: number;
  collision: number;
  stim: number;
  special: number;
}
export interface Layer3Data {
  pacing: {
    decayA: number;
    decayN: number;
    thetaPeak: number;
    thetaFade: number;
    peakHold: number;
    settle: number;
    restFactor: number;
    restMin: number;
    restMax: number;
    highIntensity: number;
    climaxNoPush: number;
    climaxNoHigh: number;
    arcNoNewThread: number;
    engagedMetres: number;
    senseWeights: SenseWeights;
  };
  threads: {
    attendedWindow: number;
    simmerWindow: number;
    maxAttended: number;
    maxLive: number;
    maxClimactic: number;
    maxSimmering: number;
    pendingLifetime: number;
  };
  aim: { preferredUrgency: number; preferredWait: number; lateUrgency: number; relaxAt: number };
  joint: { arrivedMetres: number; stationarySeconds: number };
  schedule: { slotGap: number; theta: Record<Tempo, number>; gentleFirst: number; gentleHour: number };
  sifter: {
    poolPerPattern: number;
    poolTotal: number;
    maxStages: number;
    defaultWithin: number;
    maxWithin: number;
    candidateTtl: number;
    tombstoneSpans: number;
    maxJunctures: number; maxEdges: number; maxFills: number; stateCandidates: number;
    causeHops: number; causeWalkMax: number; lineageDepth: number; aftermathDays: number;
    maxLiveShapes: number; maxLayers: number; maxSurface: number; relevanceGate: boolean;
  };
  sower: {
    lambda: number;
    diversity: number;
    recentSown: number;
    recentKits: number;
    kitDiversity: number;
    maxCandidateTries: number;
    maxKitTries: number;
    cooldown: number;
    maxRefusals: number;
    kitJunctures: number; skeleton: number; skeletonCap: number; skeletonRing: number; skeletonTokens: number;
    nudgeAfter: number; maxNudges: number; nudgeLifetime: number; portentLead: number;
    featureWeights: Record<'F3' | 'F5' | 'F6' | 'F11', number> & Partial<Record<Feature, number>>;
    timelyH: number;
    irreversible: Effect[];
    harmful: Effect[];
    maxLevel: SeedLevel;
  };
  fit: { aesthetic: number; variety: number; yield: number; varietyOffers: number };
}
export type Feature = 'F3' | 'F5' | 'F6' | 'F11' | 'F13' | 'F14' | 'F15' | 'F16';
export interface Candidate {
  key: Id;
  entry: Id;
  pattern: string;
  stage: number;
  kind?: 'told' | 'surface' | 'explain' | 'realise';
  juncture?: string; edge?: number; realisation?: 'offer' | 'nudge'; form?: Form | 'nudge';
  thread?: Id; opens?: boolean; skeletonMatches?: number;
  features: Record<'F3' | 'F5' | 'F6' | 'F11', number> & Partial<Record<Feature, number>>;
  place?: Id;
}
export interface Thread {
  patterns?: Id[];
  pullAt?: number;
  tokens?: string[];
  id: Id;
  instances: Id[];
  aware: boolean;
  lastPresented: number;
  engineSown: boolean;
  active: boolean;
  live: boolean;
  climactic: boolean;
  status: 'attended' | 'simmering' | 'dormant' | 'unseen';
}
export interface Counts {
  A: number;
  L: number;
  C: number;
  S: number;
}
export type HoldReason =
  'phase-settling' | 'phase-rest' | 'phase-peak' | 'phase-fade' | 'headroom' | 'climax-rest' | 'lead-aim';
export interface DeliveryView {
  id: Id;
  seed: Id;
  authored: boolean;
  pull: boolean;
  timing: TimingRequest;
  maxWaitPlay: number;
  submitted: number;
  window?: { lead?: 'early' | 'preferred' | 'late'; urgency: number };
}
export interface HookCtx {
  playClock: number;
  playTotal: number;
  jointLatched: boolean;
  attention: string[];
}
export type { FitTerm, FitReportFit } from '../seeding/fit-types.ts';
export interface FitRequest {
  seed: InstanceView & { document: CompiledSeed };
  choice: { key: string; kind: 'cast' | 'mode' | 'variant' | 'alternate'; role?: string };
  options: Array<{ id: string; node?: Id; fragment?: string }>;
  kernel: KernelView;
  layer2: Layer2View;
  at: number;
  fitCap: number;
}
export interface LogEntry {
  seq: number;
  kind: 'slot' | 'sow' | 'withdraw' | 'hold' | 'phase' | 'fit' | 'match' | 'budget' | 'evidence';
  at: { game: number; playTotal: number; playClock: number };
  purpose: 'schedule' | 'rest' | 'protect-peak' | 'lead-aim' | 'headroom' | 'pending' | 'match' | 'fit' | 'evidence';
  class: 0 | 1 | 3;
  rule: string;
  inputs: Record<string, unknown>;
  chain: Id[];
  data: Record<string, unknown>;
}
export type Log = (
  kind: LogEntry['kind'],
  rule: string,
  data: Record<string, unknown>,
  chain?: Id[],
  cls?: 0 | 1 | 3,
  inputs?: Record<string, unknown>,
) => void;
