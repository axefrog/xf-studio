// Layer 2's documents and state (S2 sections 2 and 12.1), as plain data.
//
// The seed language is typed here in full, so that a document that uses a later capability (S2 section 0.3)
// can be read and refused plainly at compile time rather than failing to parse. Everything the first
// implementation does not build is listed in `compile.ts`.

import type { Predicate } from '../types.ts';
import type { Effect, FnRef, GameTime, Id, KindId, Layer, SlotPath, Selector, Region } from '../types.ts';

// ---- names ----

export type TemplateId = string;
export type RoleKey = string;
export type BeatKey = string;
export type FactKey = string;
/** A reference to a fragment or a text unit in a pack: `pack:<id>`. */
export type FragmentRef = string;
export type ContentRef = string | { todo: true; note?: string };
export type ChannelId = string;
export type ClassId = string;
export type AttentionAspect = string;

export type Duration = { clock: 'game' | 'play'; s: number };

export type Cmp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
export type SeedStateName = 'sown' | 'waiting' | 'cast' | 'offered' | 'running' | 'unattended' | 'resolved' | 'withered' | 'withdrawn';
export type BeatState = 'locked' | 'available' | 'running' | 'deferred' | 'done' | 'failed' | 'skipped';
export type ExposureGrade = 'ambient' | 'presented' | 'confirmed';

/** A pattern over canon events (S2 section 2.6). A role names that role's committed cast at the event's time. */
export interface EventPattern {
  kind?: string;
  participant?: RoleKey | Id | 'v';
  /** The participant's role in the event. */
  role?: string;
  place?: RoleKey | Id;
  effect?: Effect;
  witnessedByV?: boolean;
  witnessedBy?: RoleKey;
}

export interface ExposurePattern {
  event?: EventPattern;
  fragment?: string;
  seed?: TemplateId | Id;
  delivery?: Id;
  since?: Duration;
  atLeast?: ExposureGrade;
}

export interface FactRead {
  fact?: string;
  node?: Id;
  role?: RoleKey;
}

// ---- predicates ----

/** A kernel predicate whose argument may name another role as `{ role }` (S2 section 2.4). */
export type RolePredicate = Omit<Predicate, 'arg'> & { arg: Predicate['arg'] | { role: RoleKey } };

export type Pred =
  | { all: Pred[] }
  | { any: Pred[] }
  | { not: Pred }
  | { fact: string; op: Cmp; value: number }
  | { seedFact: FactKey; op: Cmp; value: number }
  | { decided: string }
  | { role: RoleKey; p: RolePredicate }
  | { cast: RoleKey }
  | { seed: TemplateId | Id; state: SeedStateName[] }
  | { beat: BeatKey; state: BeatState[] }
  | { response: BeatKey; is: string[] }
  | { hour: [number, number] }
  | { since: { state: SeedStateName } | { beat: BeatKey }; atLeast: Duration }
  | { count: EventPattern; since?: { beat: BeatKey } | { state: SeedStateName }; op: Cmp; value: number }
  | { clock: string; op: Cmp; value: number }
  | { exposed: ExposurePattern }
  | { cap: string }
  | { setting: string; is: string[] }
  | { believes: { who: RoleKey; of: RoleKey | Id | 'v'; path: SlotPath; is?: Region; atLeast?: number } }
  | { city: unknown; is: string[] }
  | { social: unknown; is: string[] }
  | { fn: FnRef; args: unknown[]; reads: FactRead[] }
  | 'yes'
  | 'no';

/** A predicate as an author writes it: the tree, or its text form (parsed when the document loads, S2 section 2.6). */
export type PredInput = Pred | string;

export type Verdict = 'yes' | 'no' | 'maybe';

// ---- the seed document ----

export type Part<T> =
  | T
  | { fixed: T; note?: string; ifRejected?: 'withdraw' | 'degrade' | 'refit' }
  | { prefer: T; strength: 1 | 2 | 3; note?: string }
  | { open: true; note?: string };

export type SeedLevel = 'glance' | 'encounter' | 'vignette' | 'gig' | 'arc' | 'season';

export interface Turn {
  level: 'situation' | 'step' | 'goal' | 'concern' | 'drive' | 'standing';
  what: PredInput;
  who?: RoleKey;
  kind?: 'revision' | 'refusal' | 'exit' | 'tie' | 'standing';
}

export type LadderStep = { wait: Duration | 'window' } | { relax: number } | 'wait' | 'standIn' | 'shrink' | 'withdraw';
export interface Claim { span: 'seed' | 'beats'; share: 'none' | 'background' | 'any' }
export type RoleScope = { under: Id | RoleKey } | { nodes: Array<Id | RoleKey> } | { region: { center: number[]; radius: number } | { min: number[]; max: number[] } } | 'city';

export interface BeliefDecl {
  belief: { about: RoleKey | 'v'; path: SlotPath; value?: string | number; region?: Region; confidence?: number; reason: string };
}
export interface EdgeDecl {
  edge: { type: string; to: RoleKey; attrs?: Record<string, string | number>; reason: string };
}

export interface Role {
  kind: KindId;
  identity?: Part<Id | string>;
  must?: RolePredicate[];
  prefer?: Array<{ p: RolePredicate; strength: 1 | 2 | 3 }>;
  scope?: RoleScope;
  anchor?: boolean;
  order?: number;
  optional?: boolean;
  onUnfilled?: LadderStep[];
  onLost?: 'withdraw' | 'standIn' | 'shrink';
  claim?: Claim;
  goal?: { effects: Array<{ on: RoleKey | Id; effect: Effect }> };
  authored?: Array<BeliefDecl | EdgeDecl>;
  textAttrs?: string[];
  rung?: 'recurring' | 'featured' | 'central';
  // Later capabilities, typed so a document that uses them is refused plainly.
  memberships?: unknown;
  tie?: unknown;
  repertoire?: unknown;
  stance?: unknown;
  stability?: unknown;
  client?: unknown;
}

export interface SeedFactDecl {
  route?: { consumers: Array<BeatKey | string> };
  initial?: number;
  /** Only authored content may write it (boundaries, Appendix A). Such a fact only rises: the engine never lowers or clears it. */
  authoredOnly?: boolean;
  /** The persistence class of a write to this fact, unless the effect names its own (S2 section 2.5); a route variable defaults to `lasting`. */
  persist?: PersistClass;
}

export interface WorldRequirement {
  target: { role: RoleKey; slot: SlotPath } | { selector: Selector };
  form: Part<import('../types.ts').Form>;
  from?: 'sown' | 'commit' | BeatKey;
  to?: 'end' | BeatKey;
}

export type PersistClass = 'lasting' | 'resettable' | 'cosmetic';

export type EffectDecl = (
  | { fact: FactKey; set?: number; add?: number }
  | { game: { fact: string; set?: number; add?: number }; capability: 'story.write-vanilla' }
  | { reward: { table: string; tier: string; byRoute?: FactKey } }
  | { kernel: { on: RoleKey; effect: Effect } }
) & {
  persist?: PersistClass;
  carrier?: { kind: 'place' | 'media' | 'person'; at: RoleKey | Id; durability: Duration | 'permanent' };
  remember?: 'natural' | 'always';
  /** The effect counts as a content tag of the beat (S2 section 2.19): `sex.*` effects on V come only from an accepted action (L-98). */
  tag?: string;
};

export interface Dependency { on: RoleKey | { fact: string }; hold: 'keep' | 'substitute' | 'notice' }

export interface Window {
  id: string;
  opens: PredInput;
  closes?: PredInput;
  lead?: 'early' | 'preferred' | 'late';
  urgency?: Array<{ when: PredInput; level: number }>;
  holdsWhileRunning?: boolean;
  onClose: 'withdraw' | 'degrade' | 'coda' | 'memory';
  closeContent?: ContentRef;
}

export type Link =
  | { because: BeatKey; on?: PredInput }
  | { obstructedBy: BeatKey }
  | { then: BeatKey };

export interface Objective { kind: 'task' | 'condition'; succeeds: PredInput; fails?: PredInput; warns?: PredInput }
export interface Affordance { needs: PredInput; cost: string; exposure: string; combat: boolean }
export type Stance = 'help' | 'bargain' | 'refuse' | 'oppose' | 'ignore';

export interface PromiseDecl {
  id: string;
  opens: BeatKey;
  paidBy: PredInput;
  mayStayOpen?: boolean;
  kind?: string;
  size?: string;
  weight?: 'portent' | 'plant';
  carrier?: string;
  retire?: ContentRef;
}

export interface Beat {
  play: Part<FragmentRef | { alternates: FragmentRef[] }>;
  bind?: Record<RoleKey, RoleKey>;
  kind?: 'texture' | 'decision' | 'obstacle' | 'conclusion' | 'aftermath' | 'exit';
  links?: Link[];
  join?: 'all' | 'any';
  objective?: Objective;
  decision?: { atStake: RoleKey; stances: Stance[] };
  obstacle?: { affordances: Affordance[] };
  conclusion?: { clues: Array<{ beats: BeatKey[] }> };
  aftermath?: { delay: Duration; signposts: FragmentRef[]; cancelIf?: PredInput };
  failure?: Array<{ when: PredInput; warnFirst?: PredInput; leadsTo: BeatKey }>;
  leaves?: EffectDecl[];
  role?: 'texture' | 'legwork' | 'second-approach';
  mustReach?: boolean;
  droppable?: boolean;
  reoffer?: { when: PredInput; max: number };
  inScene?: boolean;
  // Later capabilities.
  unresolved?: unknown;
  breaks?: unknown;
  hook?: unknown;
}

export interface Cost { bearer: RoleKey | 'client' | 'v' | 'third'; what: string; when: 'now' | 'later'; shown: 'trace' | 'named' | 'quiet' }

export interface OfferSpec {
  stakes: Array<{ bearer: RoleKey | 'client' | 'v'; what: string }>;
  withheld?: { what: string; discoverableBy: BeatKey };
  actions: Array<{ id: string; stance: Stance; foresight: ContentRef; writes?: EffectDecl[]; costs?: Cost[] }>;
  nullPath: { id: string; content?: ContentRef; writes?: EffectDecl[] };
  lapse: { after: Duration; then: 'unattended' | 'reoffer' | 'withdraw'; content?: ContentRef };
  /** `response` is omitted when an exit beat plays it (S2 section 2.9). */
  decline: Array<{ id: string; response?: ContentRef; writes?: EffectDecl[] }>;
  choice: 'flavour' | 'consequential' | 'unchoice';
  retractQuietly?: ContentRef;
}

export type ActPattern = EventPattern;
export interface ResponseTemplate {
  /**
   * What the template answers (S2 section 2.9): an act of V's, or V's answer to an offer, matched by response kind:
   * `decline:<id>`, `action:<id>`, `action:*`, `decline:*` or `any`.
   */
  to: ActPattern | string;
  because: string;
  content: ContentRef;
  needs?: PredInput;
  attribution?: boolean;
  reply?: ContentRef;
  /** The reply's own effects: a correcting reply carries one that writes an observed telling (L-60). */
  replyWrites?: Array<{ tells: { listener: RoleKey; about: RoleKey | 'v'; path: SlotPath; value: string | number } }>;
  recalls?: unknown;
}

export interface Fragment {
  id: string;
  level: 'phrase' | 'exchange' | SeedLevel;
  needs?: PredInput;
  leaves?: EffectDecl[];
  roles: RoleKey[];
  applies?: PredInput;
  /** A scene label: beats whose fragments share it may chain `inScene` offers (S2 section 8.3, L-131a). */
  scene?: string;
  tone?: string;
  repeat?: 'never' | { times: number } | 'free';
  minGap?: { game?: number; offers?: number };
  salience: 'foreground' | 'background' | 'oddity';
  forms: { standard: ContentRef; short?: ContentRef; full?: ContentRef };
  channels: ChannelId[];
  offer?: OfferSpec;
  content?: Array<{ class: ClassId; intensity: 1 | 2 | 3 }>;
  implied?: FragmentRef;
  authored?: 'human';
  responses?: ResponseTemplate[];
  /** A callback this fragment makes to an earlier event (S2 section 10.2). */
  callback?: { cites: ExposurePattern; atLeast: ExposureGrade; recue?: ContentRef; hedged?: boolean };
  /** The fragment's text mentions a count of V's acts: it reads a `count` witnessed by this role (L-58). */
  statesCount?: { witnessedBy: RoleKey };
  /** Tags `mustReach`: information V needs for an option. Its routes are channels (L-63). */
  mustReach?: boolean;
  // Later capabilities.
  implies?: unknown;
  ask?: unknown;
  render?: unknown;
  modelOk?: unknown;
  says?: unknown;
  means?: unknown;
  humour?: unknown;
  told?: unknown;
}

export interface TextUnit {
  id: string;
  text: string;
  origin?: 'authored' | 'assisted' | 'generated';
  authored?: 'human';
  author?: string;
  speaker?: string;
  /** Channels it may be delivered on, best first (for closing and coda content). */
  channels?: ChannelId[];
  /** Game text or audio held inline is refused (L-114); a `GameRef` is the way. */
  inline?: { gameText?: boolean };
  voice?: { clone?: boolean; consent?: boolean } | { gameRef: string } | { splice: unknown[] } | { asset: string };
  class?: ClassId;
  /** The voice in which the text speaks, for the lexicon checks (L-20, L-21, L-103). */
  voiceClass?: 'narrator' | 'system' | 'news' | 'npc' | 'template';
  /** Marks an NPC attribution line, which may state a belief about V's motive (D-22). */
  states?: 'motive' | 'feeling';
}

/** A text unit without its words: what an instance freezes (the words resolve against the active pack, S2 section 1.2). */
export type TextMeta = Omit<TextUnit, 'text'>;

export interface UnattendedPlan { after: Duration; outcome: EffectDecl[]; events?: Array<{ kind: string; place?: RoleKey; participants?: Array<{ who: RoleKey; role: string }> }> }

export interface Variation {
  modes?: Array<{ id: string; weight: number }>;
  variants?: Array<{ id: string; weight: number; rare?: PredInput; parts: Partial<Seed>; mode?: string }>;
  strata?: string[];
}

export interface TimingRequest {
  kind: 'trace' | 'pin' | 'bark' | 'message' | 'call' | 'approach';
  class: 0 | 1 | 2 | 3 | 4;
  importance: 'low' | 'normal' | 'high';
  purpose: 'introduce' | 'escalate' | 'rest-cue' | 'callback' | 'close' | 'baton' | 'news' | 'recap' | 'notice';
  tolerates: Partial<Record<AttentionAspect, 'allow' | 'forbid'>>;
  maxWait: Duration;
  category?: string;
  intensity?: number;
  onExpire?: 'retry' | 'unattended' | 'withdraw';
}

export interface Migration { from: number[]; policy: 'continue' | 'withdraw' | 'migrate'; beatMap?: Record<BeatKey, BeatKey> }

export interface Seed {
  id: TemplateId;
  version: number;
  level: SeedLevel;
  turns: Turn[];
  effect?: string;
  stakeScale?: 'person' | 'crew' | 'block' | 'district' | 'city';
  content?: { envelope: Record<ClassId, 1 | 2 | 3>; requires?: Array<{ class: ClassId; min: 1 | 2 | 3 }> };
  purpose: { tags: string[]; sentence: string };
  context: PredInput;
  intent: { prohibitions: PredInput[]; tone: string[]; dreadIntensity?: 1 | 2 | 3; argues?: unknown; aesthetic?: Record<string, number> };
  sow?: PredInput;
  repeat?: { max: number | 'unbounded'; gap: Duration };
  maturity: 'sketch' | 'playable' | 'ready';
  roles: Record<RoleKey, Role>;
  facts?: Record<FactKey, SeedFactDecl>;
  world?: WorldRequirement[];
  depends?: Dependency[];
  windows: Window[];
  beats: Record<BeatKey, Beat>;
  start: BeatKey[];
  end: PredInput;
  unattended: UnattendedPlan;
  promises?: PromiseDecl[];
  closing?: ContentRef;
  profile?: { id: string; params: Record<string, unknown> };
  variation?: Variation;
  timing?: Partial<TimingRequest>;
  migrate?: Migration[];
  // Layer 3's, opaque here.
  latitude?: unknown;
  adapt?: unknown;
  sowable?: unknown;
  // Later capabilities.
  parent?: unknown;
  growsFrom?: unknown;
  clocks?: unknown;
  projections?: unknown;
  forms?: unknown;
}

/** What an author supplies: a profile may generate the beats, the start, the end, the unattended plan and the turns. */
export type SeedInput = Omit<Seed, 'beats' | 'start' | 'end' | 'unattended' | 'turns'> &
  Partial<Pick<Seed, 'beats' | 'start' | 'end' | 'unattended' | 'turns'>>;

/** The expanded document the instance keeps: every predicate is a tree. */
export type CompiledSeed = Omit<Seed, 'context' | 'sow' | 'end' | 'windows' | 'beats' | 'turns' | 'intent' | 'promises'> & {
  context: Pred;
  sow?: Pred;
  end: Pred;
  turns: Array<Omit<Turn, 'what'> & { what: Pred }>;
  intent: Omit<Seed['intent'], 'prohibitions'> & { prohibitions: Pred[] };
  windows: Array<Omit<Window, 'opens' | 'closes' | 'urgency'> & { opens: Pred; closes?: Pred; urgency?: Array<{ when: Pred; level: number }> }>;
  beats: Record<BeatKey, Omit<Beat, 'objective' | 'failure' | 'links' | 'aftermath' | 'reoffer'> & {
    objective?: { kind: 'task' | 'condition'; succeeds: Pred; fails?: Pred; warns?: Pred };
    failure?: Array<{ when: Pred; warnFirst?: Pred; leadsTo: BeatKey }>;
    links?: Array<{ because: BeatKey; on?: Pred } | { obstructedBy: BeatKey } | { then: BeatKey }>;
    aftermath?: { delay: Duration; signposts: FragmentRef[]; cancelIf?: Pred };
    reoffer?: { when: Pred; max: number };
  }>;
  promises?: Array<Omit<PromiseDecl, 'paidBy'> & { paidBy: Pred }>;
};

// ---- packs ----

export interface PackPerson {
  id: string;
  kind: KindId;
  fictional: boolean;
  ageClass?: 'adult' | 'minor';
  name?: string;
}

export interface Pack {
  id: string;
  version: number;
  seeds: Seed[];
  fragments: Fragment[];
  texts: TextUnit[];
  people?: PackPerson[];
  /** Retired ids: a tombstone, optionally naming its replacement (S2 section 12.3). */
  tombstones?: Record<string, string | null>;
  /** The authors a pack names (L-97). */
  authors?: string[];
  /** The kind of source the pack is, for the layer its seeds' contributions take (S2 section 3.2). */
  source?: 'authored' | 'procedural';
}

/** A game fact in the facts table, with the optional guard (S2 section 2.6). */
export interface FactDef { decidedBy?: PredInput }
export type FactsTable = Record<string, FactDef>;

// ---- findings ----

export interface Finding {
  code: string;
  level: 'error' | 'warning';
  /** Plain English, for authors. */
  message: string;
  /** Where in the document: a path such as `beats.offer-1.links[0]`. */
  at?: string;
  /** What the check did not look at. */
  notChecked?: string;
  fix?: string;
  /** The check would break the engine, so it refuses a seed even below `ready` (S2 section 11.1). */
  engine?: boolean;
}

// ---- run-time state (S2 section 12.1) ----

export type ResponseKind = string;

export interface RecordEntry {
  n: number;
  at: GameTime;
  playTotal: number;
  kind: string;
  data: Record<string, unknown>;
  cause?: Id;
}

export interface DeliveryProvenance {
  mode?: string;
  variant?: string;
  alternates: Record<BeatKey, string>;
  channel: ChannelId;
  form: string;
  /** Each gating of content by a ceiling or a missing implied form (S2 section 2.19). */
  gated?: Array<{ class: ClassId; intensity: number; ceiling: number; became: string }>;
  why: Array<{ kind: 'schedule' | 'fit' | 'score' | 'phase'; beliefs: Id[]; delta: number }>;
}

export type DeliveryState = 'queued' | 'released' | 'displayed' | 'answered' | 'expired' | 'withdrawn';

export interface Delivery {
  id: Id;
  seed: Id;
  beat?: BeatKey;
  /** `offer`, `beat`, `warning`, `closing`, `coda`, `news`, `reply`, `notice` */
  what: string;
  timing: TimingRequest;
  windowClose?: true;
  authored: boolean;
  pull: boolean;
  atJoint: boolean;
  bindings: Record<RoleKey, Id>;
  state: DeliveryState;
  /** The content to show: a ContentRef (or the fragment's standard form). */
  content?: ContentRef;
  fragment?: string;
  /** Play seconds, session-relative: they restart at a load (S2 section 2.12). */
  submitted: number;
  /** The game time of submission, for a maxWait counted on the game clock. */
  submittedGame: GameTime;
  releasedAt?: number;
  /** Play seconds, session-relative: a retract is allowed until then (S2 section 8.3). */
  retractUntil?: number;
  displayedAt?: number;
  /** Pushes made so far, across channels and reloads (the total attempt bound, S2 section 8.5). */
  attempts: number;
  /** The bound ran out: the delivery is no longer pushed, and waits for pull (S2 section 8.5). */
  stopped?: boolean;
  /** An offer made inside a scene that is already running: released straight into it, past every gate (S2 section 8.3). */
  inScene?: boolean;
  /** Play seconds, session-relative: the offer lapses at this play time. */
  lapseAt?: number;
  /** Channels already tried for this logical delivery. */
  tried: ChannelId[];
  grade?: ExposureGrade;
  provenance: DeliveryProvenance;
  /** For offers: the offer's event Id, minted on display. */
  offerEvent?: Id;
  /** The number of releases of this beat when the delivery was made (the `n` in the offer Id). */
  n: number;
  /** The text of the line: write-once at release (S2-I-16). */
  words?: string;
  /** The selected response templates that play with this delivery (S2 section 2.9). */
  responses?: string[];
}

export interface Receipt {
  delivery: Id;
  beat?: string;
  what?: string;
  seed: Id;
  template: string;
  fragment?: string;
  grade: ExposureGrade;
  channels: ChannelId[];
  cites: Id[];
  cue: { place?: Id; speaker?: Id; object?: Id };
  at: GameTime;
  playTotal: number;
}

export interface RoleState {
  cast?: Id;
  standIn?: { kind: KindId; constraints: Predicate[] };
  committed: boolean;
  attempt: number;
  ladder: { cursor: number; relaxed: number[]; waitUntil?: GameTime; waitUntilPlay?: number };
  /** Why the role is unfilled, when it is (S2-I-5). */
  unfilled?: string;
  /** A shrunk (dropped) optional role. */
  shrunk?: boolean;
  /** How many candidates the last casting attempt found (the fail-first order, S2 section 5.1). */
  candidates?: number;
  /** The recipe a committed stand-in was minted from, kept so a load can reinstall its constraints. */
  minted?: { kind: KindId; constraints: Predicate[] };
  /** The game time the role was committed. */
  committedAt?: GameTime;
}

export interface BeatRuntime {
  state: BeatState;
  since: GameTime;
  /** The game time of the last move into a final or deferred state (the `since` point of count atoms). */
  finalAt?: GameTime;
  /** The cumulative play time (`playTotal`) of the same move: the `since` point of a play-clock duration. */
  finalAtPlay?: number;
  /** Which `failure` entry failed the beat (its index), for a `leadsTo` beat (S2 section 7.1). */
  failedBy?: number;
  releases: number;
  offers: number;
  attempt: number;
  /** Whether a skip was omitted (transparent) or rejected (S2 section 7.1). */
  skip?: 'omitted' | 'rejected';
  /** How V answered, for offer beats: the last response kind. */
  response?: ResponseKind;
  /** The offer delivery that recorded the response (a second answer to it is ignored). */
  responseDelivery?: Id;
  warned?: boolean;
  warnedChannels?: ChannelId[];
  /** The fragment chosen for the current run. */
  fragment?: string;
  /** When an aftermath became available. */
  availableAt?: GameTime;
  /** The cumulative play time of the same moment (an aftermath delayed on the play clock). */
  availableAtPlay?: number;
  /** The number of times the beat became available (the `n` of its draws and ids). */
  availableCount: number;
  /** An aftermath's delay has passed and its signposts and content were submitted. */
  delayed?: boolean;
  /** The objective's one-time warning was delivered. */
  objWarned?: boolean;
}

/** A wake-up: a game time, or a cumulative play time (`playTotal`) checked by the arbiter's step (S2 section 4.3). */
export interface Wakeup { clock: 'game' | 'play'; at: number; reason: string; key?: string }

export interface ConsumedEvent { sub: string; event: Id; at: GameTime; cast: Record<RoleKey, Id> }

export interface InstanceState {
  template: { pack?: string; id: TemplateId; version: number };
  source: { by: 'pack' | 'director' | 'plugin'; layer: Layer; decision?: Id };
  sowSeq: number;
  document: CompiledSeed;
  /** The structure hash: the document and everything it references, without text (S2 section 12.3). */
  structureHash: string;
  /** The closure of fragments and text units the instance runs on, frozen at sowing (S2 section 1.2). */
  closure: { fragments: Fragment[]; texts: TextMeta[] };
  state: SeedStateName;
  since: GameTime;
  /** When each state was last entered (the `since` point of the `since` atom). */
  entered: Partial<Record<SeedStateName, GameTime>>;
  /** The cumulative play time at the same moments (the `since` point of a play-clock duration). */
  enteredPlay: Partial<Record<SeedStateName, number>>;
  releaseWindow?: string;
  form?: string;
  latches: string[];
  roles: Record<RoleKey, RoleState>;
  facts: Record<FactKey, { pin?: Id; n: number }>;
  /** The cast node a stand-in role was minted as, kept so the mint is idempotent. */
  beats: Record<BeatKey, BeatRuntime>;
  draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }>;
  consumed: ConsumedEvent[];
  deliveries: Delivery[];
  receipts: Receipt[];
  wakeups: Wakeup[];
  record: RecordEntry[];
  nextEntry: number;
  /** The play seconds at which the instance last had an exposure (for the resume cue). */
  attendedAt?: number;
  /** Whether the first release has been prepared and confirmed (the seed is committed). */
  committed: boolean;
  /** The game time of the last re-cast attempt of a waiting seed (S2 section 4.3). */
  lastRecast?: GameTime;
  /** Fixed world requirements and their contributions, by index. */
  world: Array<{ contribution?: Id; installed: boolean; ended: boolean; rejected?: boolean; from?: GameTime; to?: GameTime }>;
  /** The instance's goal frames and the frames it opened. */
  frames: { watch?: Id; roles: Record<RoleKey, Id>; goals: Record<RoleKey, Id> };
  /** Cast edges, by role. */
  edges: Record<RoleKey, Id>;
  /** Promises opened and retired. */
  promises: Record<string, 'open' | 'paid' | 'retired' | 'unopened'>;
  /** The intersections already recorded, with their outcomes. */
  intersections: Record<string, string>;
  /** The closure record, once closed. */
  closed?: { event: Id; status: 'resolved' | 'transformed' | 'abandoned'; witnessed: boolean };
  /** Resettable writes waiting, the reset times, by pin. */
  retired?: boolean;
  /** Settled news: a seed that ended before it could be reported. */
  released: boolean;
  /** The delivery id of the offer whose release committed the seed (T7): T9 to T11 answer to it alone, not to a follow-up. */
  firstOffer?: Id;
  /** The fragment uses already counted into the global record at release (kept for compaction). */
  stuck?: boolean;
}

export interface GlobalState {
  fragmentUses: Record<string, { count: number; lastAt: GameTime; lastOffer: number }>;
  offerCount: number;
  playTotal: number;
  notices: Id[];
  sowing: Record<string, { instances: number; lastEnded?: GameTime; refused?: string }>;
  /** The maintenance queue (S2 section 8.6): work that outlives a seed. */
  maintenance: MaintenanceJob[];
  /** The decisions that sowed instances: kept after compaction (S2 section 10.1a). */
  sownBy: Record<Id, Id[]>;
  /** The next sow sequence number. */
  nextSowSeq: number;
  /** Receipts moved here when an instance is compacted. */
  receipts: Receipt[];
  /** Closing records of compacted instances. */
  closures: Array<{ seed: Id; template: string; event: Id; status: string; witnessed: boolean; at: GameTime; playTotal: number }>;
  /** Retired instances: terminal, nothing pending, kept as plain history. */
  history: Array<{ seed: Id; template: string; state: SeedStateName; at: GameTime; playTotal: number }>;
  /** Cosmetic marks: the event, the carrier and how long it lasts (S2 section 2.5). */
  marks: CosmeticMark[];
}

export type MaintenanceJob =
  | { kind: 'reset'; at: GameTime; seed: Id; fact: FactKey; pin: Id; node: Id }
  | { kind: 'mark-expiry'; at: GameTime; seed: Id; mark: Id }
  | { kind: 'closing'; seed: Id; delivery: Id; until: GameTime };

export interface CosmeticMark { id: Id; seed: Id; event: Id; carrier: { kind: string; at: Id }; shownAt: GameTime; until?: GameTime }
