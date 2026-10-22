# S2. Seed language and seeding layer specification

**Status:** v0.3, 23 October 2026.
- **The review.** v0.2 went through one review, by GPT-6 Astra; [§16](#16-review-record) records what changed.
- **Dossiers folded in.**
  - v0.1 folded in [dossier 8](../craft/d08-scale-threads-time.md#9-requirements-for-the-seed-language-p4) (scale, threads and time).
  - v0.11.1 clarifies author-fill seams: the engine composes and places authored-source content like any data, procedural seeds included; only its source material comes from people.
  - v0.11 folds in [dossier 18](../craft/d18-content-boundaries.md) (representation and content boundaries): content classes with one ceiling ladder each, author-fill seams ([D-23](../decisions.md)), the legal floors, and representation checks (§2.19).
  - v0.10 folds in [dossier 17](../craft/d17-setting-tone.md) (setting and tone): the tone vocabulary and tone lint, stake scale, dread guards, withheld patron motives, outlets for media, setting reads (§2.18).
  - v0.9 folds in [dossier 16](../craft/d16-authoring-tools.md) (authoring formats and tools): maturity and placeholders, a text syntax for predicates, source maps, the finding contract, structure versions, and missing content at run time. R1 is now lint-clean.
  - v0.8 folds in [dossier 15](../craft/d15-people-networks-order.md) (people, networks, norms and order): social reads, casting through ties, betrayal and norm seeds, reputation through behaviour (§2.17).
  - v0.7 folds in [dossier 14](../craft/d14-city-events.md) (where and when things happen in the city): city reads, hot-state windows, and the limits on the director over city events (§2.16).
  - v0.6 folds in [dossier 13](../craft/d13-perception-curiosity.md) (perception, memory and curiosity): three exposure grades and the display contract, re-cued callbacks, `mustReach`, hooks and twists, counter-cues, channel modality.
  - v0.5 folds in [dossier 12](../craft/d12-player-model-trust.md) (the player model, trust and manipulation): the model's boundary (§8.8), bounded hooks, offers frozen at display, a "why this?" record, and the `believes` firewall.
  - v0.4 folds in [dossier 11](../craft/d11-saves-memory-forgetting.md) (saves, memory and forgetting): session and wall-clock independence, the return view and recaps, durable cosmetic marks, recall in responses.
  - v0.3 folds in [dossier 10](../craft/d10-change-theme-payoff.md) (character change, theme and payoff): premises and costs, NPC turns, typed plants and traces, and NPC attribution lines ([D-22](../decisions.md)).

This is the specification stage of [P4](../p4-seeding-layer.md) (work package [WP-10](../plan.md#82-work-packages)). It is exact enough to implement layer 2 in the reference model from this page plus the kernel specification [S0](kernel.md) and the reference model's [notes](../../../projects/xf-story-engine/reference/SPEC-NOTES.md).

Where this page and P4 differ, this page wins. P4 explains why; this page says exactly what.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout.

## 0. Scope

### 0.1 What layer 2 does

Layer 2 is the only way content enters the simulation ([D-02](../decisions.md)). It:
- compiles **seed documents** into kernel material (§3);
- **casts** roles (§5);
- runs each seed's **lifecycle** and its beats (§6, §7);
- makes **offers**, and runs the **arbiter**, through which everything that V perceives passes (§8);
- detects and settles **intersections** between seeds (§9);
- keeps the seed **record** and the **exposure ledger** (§10);
- provides the **lint** and the **fit report** (§11).

Authored packs (layer 4), the procedural engine (layer 3) and other plugins (`story.seed@1`) all submit seeds the same way.

**Specified elsewhere:**

| Topic | Specification |
|---|---|
| Choosing what to sow, fitting open parts, the director, pacing, attention, promotion | S3 |
| Pack format, player settings, the lint's text lexicon, closed vocabularies | S4 |
| Attention aspects, vanilla UI states, the play clock's source, capability reads, channels, display confirmations | S5 |
| Rendering text and choosing channel content | S7 |

### 0.2 What changed from P4

1. **Few kernel records.** Run-time bindings are few kernel records:
   - casts are `core:cast` edges;
   - seed facts are `core:seed-fact` nodes;
   - commitments are `committed` pins;
   - displayed offers and V's responses are canon events.

   Beats, fragments, content choices and deliveries are layer-2 state, persisted in the seed's record (§12). They are not kernel nodes.
2. **Fixed parts don't all compile the same way.** A fixed role constraint becomes a casting `must` (§5). A fixed requirement on world state becomes a `constrain` contribution (§3.2).
3. **Content choices** (alternates, variants, modes) are drawn by layer 2 with the kernel's draw arithmetic (§3.4), not as kernel slots.

### 0.3 The first implementation

The first implementation is in the TypeScript reference model, beside the kernel. It implements everything here except:

| Deferred | The first implementation instead |
|---|---|
| Profiles other than the relationship ladder (§2.10) | The ladder only ([Appendix A](#appendix-a-the-relationship-ladder-profile)) |
| The text-honesty lexicon (§11.1, L-20, L-21) | A small provisional lexicon in a fixture pack; the checks are warnings |
| Capability predicates over V's state (`cap`, §2.6) | A registry stub answering `maybe` unless a fixture sets it |
| Rendering scale forms differently | The form is chosen and recorded; rendering is S7's |
| The fit report under director policies (§11.2) | The director off |
| The director's form, phase, scoring and joint hooks (§2.13, §8.3) | The built-in fallbacks |
| Migration with a beat map (§12.3) | `continue` and `withdraw` only |
| Stand-ins beyond the constructible subset (§5.4) | The subset only; anything else fails the lint |
| Extension slots: other packs adding alternates to a beat (§2.8) | None; deferred past the first public pack |

### 0.4 What S2 needs from the kernel (S0 v4)

S0 v4 makes these additions ([S0 §20](kernel.md#20-version-4-additions)). None changes anything the reference model already implements:
1. **Fact kinds.**
   - `core:game-fact`: one mirrored `int` slot, `value`. Each game fact is the mirrored node `H("game", "fact:" + name)`.
   - `core:seed-fact`: one `assigned` `int` slot, `value`.
2. **`core:seed`**, with the `actor` facet and no slots the kernel reads.
3. **`core:cast`**, an edge type from `core:seed` to any kind, with `data: ['role']`, not perceivable.
4. **Event kinds** `offer`, `response` and `seed-outcome` in the core event vocabulary.
5. **Relevance reaches layer 2.** Relevance emissions on frames whose actor is a `core:seed` are delivered to layer 2, as they are to S1 and S3 (S0 §10.5), in the same order.

Kernel rules that already cover the rest:
- seeds are demand roots (§10.4);
- `SeedRecord`s with their `nodes` and `actor` are retention roots (§7.3);
- `SeedState` ops persist them (§14.2, the reference model's `SeedRecord`).

## 1. Packs, templates and instances

### 1.1 Templates

A **seed template** is a seed document (§2) in a pack, identified by `(pack, id, version)`. Pack ids and template ids are `<namespace>:<name>`.

### 1.2 Instances

A **seed instance** is a minted `core:seed` node. Its `Id` follows S0 §1.1:

| Sown by | `creator` | `cause` | `name` |
|---|---|---|---|
| An authored pack, once | The pack root `H("root", worldSeed, "pack:" + packId)` | `H("sow", packId, templateId)` | `"seed:" + templateId` |
| An authored pack, repeatable | The pack root | `H("sow", packId, templateId, n)`, with `n` the count of earlier instances of this template in the lineage | `"seed:" + templateId + ":" + n` |
| The procedural engine | `director` | The id of S3's sowing decision | `"seed:" + templateId + ":" + localName` |
| Another plugin | Its root, `H("root", worldSeed, "plugin:" + pluginId)` | The id of its `story.seed@1` request | As the plugin names it |

An instance keeps its **expanded document**: the template after profile expansion and the variant merge (§3.1). It keeps this in its state (§12.1). It runs on that document until it ends, whatever later pack versions say (§12.3). Content references (`ContentRef`) still resolve against the active pack, so wording can be corrected under a live instance; structure can't.

### 1.3 Sowing authored templates

Each active pack has one **sowing watcher**: a frame on the pack root, with one `reactsTo` interest per fact its templates' `sow` predicates read (§4.1). When a relevance event reaches it, layer 2 evaluates each affected template's `sow`.

A template is sown when its `sow` predicate is `yes`. The default `sow` is `yes`: the template is sown when the pack activates. A repeatable template is sown again when its `sow` is `yes` and all of the following hold:
- its previous instance is terminal;
- `repeat.gap` has passed since that instance ended;
- fewer than `repeat.max` instances exist.

Sowing is idempotent. The instance `Id` is fixed by §1.2, so sowing twice finds the existing instance.

**Maturity.** Every template declares a `maturity`:
- `sketch`: an idea with placeholders;
- `playable`: it runs, rough edges and all;
- `ready`: it is finished.

A template below `ready` is **never sown into a player's game**, whatever its `sow` says. Only the lab and authoring tools may sow it. This lets an author save and test work in progress, while players only ever meet finished seeds ([dossier 16](../craft/d16-authoring-tools.md)).

## 2. The seed document

### 2.1 The top level

```ts
interface Seed {
  id: TemplateId; version: number;
  level: SeedLevel;                    // checked against `turns` (§2.13); it never switches a rule
  turns: Turn[];                       // §2.13; required above glance level
  parent?: { seed: TemplateId; purpose: string };
  growsFrom?: GrowsFrom;               // §2.13; procedural seeds
  effect?: ToneTag;                    // the one dominant effect; required for vignettes (L-31)
  stakeScale?: 'person' | 'crew' | 'block' | 'district' | 'city';   // default block (§2.18)
  content?: { envelope: Record<ClassId, 1 | 2 | 3>; requires?: Array<{ class: ClassId; min: 1 | 2 | 3 }> };   // §2.19
  purpose: { tags: PurposeTag[]; sentence: string };
  context: Pred;                       // required: where and when this seed makes sense (§2.6)
  intent: Intent;                      // §2.3
  sow?: Pred;                          // authored templates: when to sow (default yes)
  repeat?: { max: number | 'unbounded'; gap: Duration };   // repeatable templates only
  maturity: 'sketch' | 'playable' | 'ready';     // §1.3; only `ready` reaches a player's game
  roles: Record<RoleKey, Role>;        // §2.4
  facts?: Record<FactKey, SeedFactDecl>;           // §2.5
  world?: WorldRequirement[];          // §2.5
  depends?: Dependency[];              // §2.5
  windows: Window[];                   // §2.7; at least one
  beats: Record<BeatKey, Beat>;        // §2.8
  start: BeatKey[];                    // the beats available first
  end: Pred;                           // the end state (§6)
  unattended: UnattendedPlan;          // §2.9; required for any seed with an offer
  promises?: Promise[];                // §2.8
  clocks?: Record<ClockKey, Clock>;    // §2.14
  projections?: Projection[];          // §2.14
  forms?: SeedForms;                   // §2.13
  closing?: ContentRef;                // the closing trace (§6.4); required at gig level and above (L-35)
  profile?: { id: ProfileId; params: Record<string, unknown> };   // §2.10
  variation?: Variation;               // §2.11
  latitude?: Latitude;                 // §2.11
  adapt?: AdaptationPoint[];           // §2.11
  timing?: TimingRequest;              // §2.12: defaults for this seed's requests
  migrate?: Migration[];               // §12.3
}

type Duration = { clock: 'game' | 'play'; s: number };
type SeedLevel = 'glance' | 'encounter' | 'vignette' | 'gig' | 'arc' | 'season';
```

The old label `job` is `gig`. The job and heist shape is a profile (§2.10), not a level.

### 2.2 Binding status

Any field typed `Part<T>` takes one of three forms:

```ts
type Part<T> =
  | T                                              // a bare value is fixed
  | { fixed: T; note?: string; ifRejected?: 'withdraw' | 'degrade' | 'refit' }
  | { prefer: T; strength: 1 | 2 | 3; note?: string }
  | { open: true; note?: string };
```

- **A missing optional `Part` is open.**
- **`ifRejected`** applies when a fixed part is rejected (§3.5). The default is `withdraw` for anchor roles and world requirements, and `degrade` elsewhere. `refit` is allowed only if `latitude` permits re-fitting the part.
- **`note`** is the intent note shown in the fit report.

### 2.3 Intent

```ts
interface Intent {
  prohibitions: Pred[];                // fitting must never make one yes; the lint checks static cases
  tone: ToneTag[];
  dreadIntensity?: 1 | 2 | 3;          // for the `dread` tone (§2.18)
  argues?: Array<{ premise: PremiseId; stance: 'supports' | 'opposes' | 'complicates'; carriers: BeatKey[] }>;
  aesthetic?: Record<AestheticFeature, number>;    // −1..1: a few coarse weights for fitting
}
```

The end state is `Seed.end`; it isn't repeated here. `PurposeTag`, `ToneTag` and `AestheticFeature` are closed vocabularies in S4. Until the composite seeds them, S4 ships a small starter set marked provisional.

**Theme is separate from tone.** `tone` is the feel. **`argues`** is the seed's position on a **premise**, a question a pack asks of the city. The `carriers` are the beats whose offers, costs or consequences make the argument; an `argues` entry with no carrier is a label only (L-47).

```ts
interface Premise {                    // pack data (S4)
  id: PremiseId;
  sentence: string;                    // for authors and tools; never rendered to V in the system's voice (L-53)
  signature: Pred;                     // over record features only, so a record can show or violate it
  scope: 'district' | 'region' | 'season';
  quota: { supports: [number, number]; opposes: [number, number]; complicates: [number, number] };  // share bounds
  intended?: string[];                 // dissonance made on purpose
}
```

- **The default is no premise.** Packs declare premises; sowing never invents one.
- **Audits, not per-seed checks.** Whether a premise shows is an audit S3 runs over a scope's record. It takes about 10 to 40 offers in scope to show a pattern ([dossier 10](../craft/d10-change-theme-payoff.md)). One seed can't, so the lint checks only that carriers exist.

### 2.4 Roles

```ts
interface Role {
  kind: KindId;                        // e.g. core:person, core:place, core:group
  identity?: Part<Id | GameKey>;       // a specific node: fixed, or preferred
  must?: Predicate[];                  // required: S0 §8.1 predicates on the candidate
  prefer?: Array<{ p: Predicate; strength: 1 | 2 | 3 }>;
  scope?: RoleScope;                   // where to look; default: the seed's place role's district, else the city
  anchor?: boolean;                    // preferred first in casting order (§5.1)
  order?: number;                      // cast-order hint
  optional?: boolean;                  // may be shrunk away (§5.4)
  onUnfilled?: LadderStep[];           // §5.4; default ['wait', 'withdraw']
  onLost?: 'withdraw' | 'standIn' | 'shrink';    // §5.5; default withdraw for anchors, else onUnfilled's last step
  claim?: Claim;                       // §9.2; default { span: 'seed', share: 'none' }
  goal?: Goal;                         // effects this role pursues; opens a goal frame on the cast node (§5.3)
  memberships?: Array<{ group: Id | RoleKey; role?: string }>;    // feeds cross-pressure
  tie?: { to: RoleKey | 'v'; kind: 'companion' | 'rival' | 'mentor' | 'kin' | 'partner' };
  authored?: Array<BeliefDecl | EdgeDecl>;       // grievances, beliefs, debts per direction, each with a reason
  repertoire?: FragmentRef[];          // casting prefers candidates S1 lists as able to play these (§5.2)
  textAttrs?: string[];                // attributes text may name; each guaranteed by `must` or identity (L-17)
  rung?: 'recurring' | 'featured' | 'central';    // an authored promotion floor, passed to S3 (§3.2)
  stance?: { premise: PremiseId; toward: 'holds' | 'resists' | 'profits' | 'doubts' };   // usable in `prefer`
  stability?: 1 | 2 | 3;               // how hard this NPC's views are to move; default from S1
  client?: { blocked: Pred; standsToLose: string };   // job-like seeds: the client's blocked goal
}

type RoleScope = { under: Id | RoleKey } | { nodes: Array<Id | RoleKey> } | { region: SpatialRegion } | 'city';
type LadderStep = { wait: Duration | 'window' } | { relax: number } | 'standIn' | 'shrink' | 'withdraw';
interface Claim { span: 'seed' | 'beats'; share: 'none' | 'background' | 'any' }
```

- **Predicates on other roles.** A role's `must` and `prefer` are kernel predicates (S0 §8.1). A predicate argument MAY name another role as `{ role: RoleKey }`. It resolves to that role's cast `Id`, so that role must be cast first (§5.1).
- **Ladder steps.**
  - `'wait'` is short for `{ wait: 'window' }`: wait until the seed closes.
  - `{ relax: i }` demotes `must[i]` to a preference of strength 1.
- **Place roles.** A `place` role uses the place dimensions of [knowledge/places.md](../../../knowledge/places.md) §12. Several of them (wealth, danger, gang presence, public) are derived, so a predicate on them is a registry derive, not a single game field.
- **Ties.** A relationship's exits are beats in the seed (Appendix A).

### 2.5 Facts, world requirements, effects and dependencies

```ts
interface SeedFactDecl {
  route?: { consumers: Array<BeatKey | RewardKey> };   // a route variable: at least one consumer (L-05)
  initial?: number;                    // default 0
  authoredOnly?: boolean;              // only authored content may write it (boundaries; Appendix A)
}

interface WorldRequirement {
  target: { role: RoleKey; slot: SlotPath } | { selector: Selector };   // selectors may name roles
  form: Part<Form>;                    // S0 §4.3 forms; fixed → constrain, prefer → weight
  from?: 'sown' | 'commit' | BeatKey;  // when it starts; default commit (sown if it names no role)
  to?: 'end' | BeatKey;                // when it ends; default end
}

type EffectDecl = (
  | { fact: FactKey; set?: number; add?: number }                      // this seed's own facts
  | { game: { fact: string; set?: number; add?: number }; capability: 'story.write-vanilla' }
  | { reward: { table: RewardTableRef; tier: string; byRoute?: FactKey } }
  | { kernel: { on: RoleKey; effect: Effect } }                        // S0 §10.8 effects, as events
) & {
  persist?: 'lasting' | 'resettable' | 'cosmetic';
  carrier?: { kind: 'place' | 'media' | 'person'; at: RoleKey | Id; durability: Duration | 'permanent' };  // required for cosmetic
  remember?: 'natural' | 'always';     // for effects that create beliefs; `always` keeps a memorable belief at gist
};

interface Dependency { on: RoleKey | { fact: string }; hold: 'keep' | 'substitute' | 'notice' }
```

**Seed facts** are `core:seed-fact` nodes minted `H("mint", seedId, seedId, "fact:" + key)`. Layer 2 is their only writer.

**Writing a seed fact.** The fact's value is whatever its single current pin says. Because `committed` pins on one enduring slot compete by `Id`, not by age (S0 §5.2, note 5), layer 2 keeps at most one current pin per fact:
1. Compute the new value: the `set` value, or the current value plus `add`.
2. If the fact has a current pin, withdraw it (`PinWithdrawn`). The withdrawn pin stays as history.
3. Add a new `committed` value pin, with the seed as cause, and record it as the fact's current pin in the seed's state.

**Reading a seed fact.** With no current pin, a seed fact reads its `initial` value.

**Game facts** are written only through the `story.write-vanilla` capability, under the bridge's write class for persisted vanilla state ([requirements H3](../runtime-requirements.md)). A seed without that capability that declares a game write fails the lint (L-12).

**Rewards** reference a policy table. A literal amount is not allowed.

**Persistence classes.** History is additive. The class says how long an effect lasts, not whether it happened:

| Class | Meaning | How |
|---|---|---|
| `lasting` | Relationships, reputation, standing, anything a later seed may cite | The pin stays until a later write replaces it |
| `resettable` | The incidental: a stall closed for the day, a guard moved | The write also schedules a game-time **wake-up** at `at + reset` **[tunable 7 game days]**. At that wake-up, if the pin is still current, layer 2 withdraws it, and the fact reads its `initial` again |
| `cosmetic` | A mark on a wall, a changed sign | The canon event, and a **carrier**: the place, media feed or person that shows it, and how long it lasts. No pin |

The default is `lasting` for game-fact writes, rewards, and effects on ties or standing. Everything else defaults to `resettable`. These must be `lasting`, and marking one `resettable` is an error (L-12):
- game-fact writes;
- writes made by a `turning` event: beliefs, importance, membership.

**Canon characters.** A role whose identity is fixed to a game character keeps the facts the game records about it. A turn or effect on such a role that would change one of those facts must be `authoredOnly` (L-50). Turns the engine adds on such a role are confined to beliefs about V and ties with V.

**Cosmetic marks survive loads.** A `cosmetic` effect without a carrier is an error (L-55). While its durability lasts, the mark is **re-derived** from its canon event, and shown again whenever the carrier's district or feed is active. A reload therefore never wipes a mark V saw.

**Memory and the player's settings.**
- **`remember: 'always'`** forces a memorable belief, which can blur to gist but is never dropped. It conflicts with `resettable` (L-55).
- **The reset scale.** The player's `resetScale` (S0 `SettingsSet`) multiplies the `reset` of `resettable` effects.
- **Promises and debts** ignore the memory scale.
- **Repair routes.** An effect that can drop a `lasting` tie below an authored floor needs a route back: a retraction, a reconciliation, or an apology the ladder accepts. Otherwise the lint warns (L-54).

### 2.6 Predicates

Predicates are three-valued: `yes`, `no` or `maybe`. Every condition in a seed is a `Pred`:

```ts
type Pred =
  | { all: Pred[] } | { any: Pred[] } | { not: Pred }
  | { fact: string; op: Cmp; value: number }                // a game fact, by name
  | { seedFact: FactKey; op: Cmp; value: number }            // this seed's fact
  | { decided: string }                                      // a game fact's guard (below)
  | { role: RoleKey; p: Predicate }                          // an S0 §8.1 predicate on the cast node
  | { cast: RoleKey }                                        // the role is cast, tentatively or committed
  | { seed: TemplateId | Id; state: SeedStateName[] }        // another seed's lifecycle state
  | { beat: BeatKey; state: BeatState[] }                    // a beat of this seed
  | { response: BeatKey; is: ResponseKind[] }                // how V answered an offer beat (§7.4)
  | { hour: [number, number] }                               // game clock hour, half-open, wrapping
  | { since: { state: SeedStateName } | { beat: BeatKey }; atLeast: Duration }
  | { count: EventPattern; since?: { beat: BeatKey } | { state: SeedStateName }; op: Cmp; value: number }
  | { clock: ClockKey; op: Cmp; value: number }              // filled segments of this seed's clock (§2.14)
  | { exposed: ExposurePattern }                             // §10.2
  | { cap: CapabilityRef }                                   // a capability read over V's state (S5)
  | { setting: SettingKey; is: string[] }                    // a player setting (S4)
  | { believes: { who: RoleKey; of: RoleKey | Id | 'v'; path: SlotPath; is?: Region; atLeast?: number } }   // an NPC's own belief
  | { city: CityRead; is: string[] }                         // the simulation's coarse state (§2.16)
  | { social: SocialRead; is: string[] }                     // people, ties, reputation and order (§2.17)
  | { fn: FnRef; args: unknown[]; reads: FactRead[] }        // a registry predicate; `reads` lists its dependencies
  | 'yes' | 'no';

type Cmp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
type EventPattern = { kind?: string; participant?: RoleKey | Id | 'v'; role?: string; place?: RoleKey | Id; effect?: Effect; witnessedByV?: boolean; witnessedBy?: RoleKey };
```

**The text form.** Authors write predicates as expressions. The text form prints to and parses from `Pred` one to one, and its meaning is exactly §2.6's. The grammar, informally:

```
pred   := pred 'or' pred | pred 'and' pred | 'not' pred | '(' pred ')' | atom | 'yes' | 'no'
atom   := fact cmp int                      // q112_done == 1
        | 'seedFact(' key ')' cmp int
        | 'decided(' fact ')'
        | role '.' path cmp value | 'cast(' role ')'
        | 'seed(' id ')' 'in' '{' states '}' | 'beat(' key ')' 'in' '{' states '}'
        | 'response(' key ')' 'is' kinds
        | 'hour' 'in' '[' int ',' int ')'
        | 'since(' ref ')' '>=' duration
        | 'count(' pattern [',' ref] ')' cmp int | 'clock(' key ')' cmp int
        | 'exposed(' pattern [',' grade] ')' | 'cap(' ref ')' | 'setting(' key ')' 'in' '{' values '}'
        | 'believes(' role ',' subject ',' path [',' region] ')'
        | 'city(' read ')' 'in' '{' bands '}' | 'social(' read ')' 'in' '{' bands '}'
        | fn '(' args ')'
cmp    := '==' | '!=' | '<' | '<=' | '>' | '>='
```

`and` binds tighter than `or`. `yes` and `no` are three-valued keywords, never booleans. Fixtures SF-1 and SF-7 also run through the text form (SF-46).

**Explaining a predicate.** Layer 2 exposes a read-only explanation: for every node of a `Pred`, at a given kernel revision and game time, its value and, for a `maybe`, the missing reading or undecided guard behind it. It emits nothing (S0 I-13). Authoring tools use it to answer "why won't this window open?".

**Evaluation** uses Kleene's strong three-valued logic:
- `all` is `no` if any member is `no`, `yes` if every member is `yes`, otherwise `maybe`. An empty `all` is `yes`.
- `any` is `yes` if any member is `yes`, `no` if every member is `no`, otherwise `maybe`. An empty `any` is `no`.
- `not` swaps `yes` and `no` and keeps `maybe`.

**Atoms:**
- **`fact`** is `maybe` if the fact has no game reading in effect, or if its guard is not `yes`. Otherwise it compares the reading.
- **Guards.** The facts table ([main-story-facts.json](../main-story-facts.json)) MAY give a fact a `decidedBy` predicate, typically the completion fact of the quest that sets it. Until `decidedBy` is `yes`, every read of that fact is `maybe`. `{ decided: f }` is `f`'s `decidedBy`, or `yes` if it has none. This makes "not dead" mean "decided, and not dead".
- **`role`** is `maybe` if the role isn't cast, or if the kernel's resolution returns anything but `ok`.
- **`seed`** with a template id is `yes` if **any** instance of that template is in one of the states. With an instance `Id`, it reads that instance.
- **`since`** is `no` if the state or beat was never entered.
- **`count`** counts the events matching the pattern that layer 2 has **consumed** (§2.14) at or after the `since` point, or since sowing.
- **`hour`, `since`, `seed`, `beat`, `response`, `seedFact`, `count`, `clock` and `setting`** are never `maybe`.
- **`exposed`** is `yes` or `no` (§10.2).
- **`believes`** reads the NPC's view through `knows` (S0 §11.4), never world truth:
  - `maybe` if `knows` answers `unknown`;
  - `yes` if the belief's value lies in `is` and its confidence is at least `atLeast` (default 0);
  - `no` otherwise.

  Beliefs held about V are allowed, but only an in-world NPC's. **`who` MUST be a role cast to an in-world actor**: never the root actors `director`, `city` or `v` (L-56). The director's model of V is unreachable from seeds (§8.8).
- **No atom reads a state of V.** A "state of V" means V's inner state, V's preferences, or the director's model of V. `fact` and `cap` read only what the game records: skills, gear, money, level, quest state.
- **`cap` and `fn`** return what the registry function returns.

Evaluation reads the kernel at a given revision and game time (§4). It is read-only and emits nothing (S0 I-13).

**Effects fire on `yes` only.** Every transition that changes the world or reaches V requires `yes` (S2-I-8). A **cancellation** may act on `maybe`: withdrawing a pending request, or returning to `waiting`. Cancelling sends nothing to V and changes nothing in the world.

### 2.7 Windows

```ts
interface Window {
  id: string;
  opens: Pred;
  closes?: Pred;                       // default 'no'
  lead?: 'early' | 'preferred' | 'late';          // where in the open span to aim; S3 reads it
  urgency?: Array<{ when: Pred; level: number }>; // 0..1: the highest level whose `when` is yes
  holdsWhileRunning?: boolean;         // default false: closing also ends a running seed
  onClose: 'withdraw' | 'degrade' | 'coda' | 'memory';
  closeContent?: ContentRef;           // required for coda and memory (L-09)
}
```

**A window's state:**

| `closes` | `opens` | Window state |
|---|---|---|
| `yes` | any | `closed` |
| `no` | `yes` | `open` |
| `maybe` | `yes` | `pending` |
| `no` or `maybe` | `no` or `maybe` | `pending` |

**Closing is latched.** Once a window is `closed`, it stays closed for that instance, whatever the facts do later. The latch is part of the instance's state. §4.2 makes sure a transient closing value is seen.

**Urgency** comes from V's position in the story, expressed in the `when` predicates. It never comes from a calendar. With no `urgency` list, it is 0.

**The seed as a whole:**
- **open:** at least one window is `open`;
- **closed:** every window is `closed`;
- **pending:** otherwise.

**The release window.** When a seed's first release is prepared (§8.4), layer 2 records the lowest-index window that is `open` as its **release window**. From then on, only the release window's close affects the running seed (T3), and its `onClose` decides what happens. Before any release, the seed withers only when every window is closed (T2). Its close policy is then the one of the lowest-index window.

**Close policies:**

| Policy | Before release (T2) | After release (T3) |
|---|---|---|
| `withdraw` | Withered, silently | Withered, with the closing trace only |
| `degrade` | As `withdraw` | The seed moves to `unattended`: the world settles it without V |
| `coda` | Withered; `closeContent` is delivered | Withered; `closeContent` is delivered |
| `memory` | As `coda`, delivered as a recollection (S7 chooses the channel) | As `coda` |

### 2.8 Fragments, beats and links

**A fragment** is reusable content, in a pack, at any level:

```ts
interface Fragment {
  id: FragmentId; level: 'phrase' | 'exchange' | SeedLevel;    // an exchange is an action and its reaction
  needs?: Pred;                        // facts it presupposes; it may play only when yes
  leaves?: EffectDecl[];               // facts it establishes when it completes
  implies?: Pred;                      // glance fragments: exactly one implied situation (L-32)
  ask?: FragmentRef;                   // the handle: what V can ask or approach to learn more (§2.14)
  roles: RoleKey[];                    // role slots it uses; the beat maps them (Beat.bind)
  applies?: Pred;                      // among alternates, the most specific applicable one wins (§7.2)
  tone?: ToneTag;
  repeat?: 'never' | { times: number } | 'free';   // default free; counted per save branch (§7.2)
  minGap?: { game?: number; offers?: number };
  salience: 'foreground' | 'background' | 'oddity';
  forms: { standard: ContentRef; short?: ContentRef; full?: ContentRef };   // rendering length only
  channels: ChannelId[];               // best first; the last is the lowest acceptable
  render?: { phrasings: ContentRef[]; reuse: 'once' | 'cycle' | 'free' };
  offer?: OfferSpec;                   // a player-facing offer (§2.9)
  content?: Array<{ class: ClassId; intensity: 1 | 2 | 3 }>;   // content tags (§2.19)
  implied?: FragmentRef;               // the non-explicit form, played above the player's ceiling (§2.19)
  authored?: 'human';                  // required for authored-only classes (§2.19)
  responses?: ResponseTemplate[];      // NPC responses to V's acts (§2.9)
}
```

A fragment reads only facts and its bound roles. It never reads another fragment's state.

**A beat** places a fragment in a seed's graph:

```ts
interface Beat {
  play: Part<FragmentRef | { alternates: FragmentRef[] }>;
  bind?: Record<RoleKey, RoleKey>;     // fragment role → seed role; default same names
  kind?: 'texture' | 'decision' | 'obstacle' | 'conclusion' | 'aftermath' | 'exit';
  links?: Link[];                      // incoming links: what makes this beat available
  join?: 'all' | 'any';                // default all
  objective?: Objective;
  decision?: { atStake: RoleKey; stances: Stance[] };           // kind decision
  obstacle?: { affordances: Affordance[] };                     // kind obstacle; at least two
  conclusion?: { clues: ClueRoute[] };                          // kind conclusion; at least three
  aftermath?: { delay: Duration; signposts: FragmentRef[]; cancelIf?: Pred };   // kind aftermath; at least one (L-23)
  failure?: Array<{ when: Pred; warnFirst?: Pred; leadsTo: BeatKey }>;       // checked in order
  leaves?: EffectDecl[];               // added to the fragment's own
  role?: 'texture' | 'legwork' | 'second-approach';   // what a short form may drop (§2.13)
  unresolved?: 'instability' | 'tension';             // gigs and arcs: what this beat leaves open (L-70)
  breaks?: PatternRef;                 // a twist names the expectation it breaks (§2.8)
  hook?: { anchor: ExposurePattern[]; question: string; payoff: BeatKey };   // introduce beats of mystery-shaped seeds
  mustReach?: boolean;                 // V needs this to take an option (L-63)
  droppable?: boolean;                 // may be dropped above the player's ceiling (§2.19)
  reoffer?: { when: Pred; max: number };              // offer beats: may be offered again (§7.4)
}

type Link =
  | { because: BeatKey; on?: Pred }    // after that beat ends and `on` is yes (default yes)
  | { obstructedBy: BeatKey }          // not while that beat is available or running
  | { then: BeatKey };                 // plain order; allowed only into texture beats (L-03)

interface Objective { kind: 'task' | 'condition'; succeeds: Pred; fails?: Pred; warns?: Pred }
interface Affordance { needs: Pred; cost: CostClass; exposure: ExposureClass; combat: boolean }
interface ClueRoute { beats: BeatKey[] }
type Stance = 'help' | 'bargain' | 'refuse' | 'oppose' | 'ignore';
interface Promise {
  id: string; opens: BeatKey; paidBy: Pred; mayStayOpen?: boolean;
  kind?: 'tone' | 'story' | 'character' | 'structure';
  size?: 'small' | 'medium' | 'large';
  weight?: 'portent' | 'plant';        // a plant is a promise whose `opens` beat is a trace
  carrier?: 'object' | 'person' | 'place' | 'phrase';
  retire?: ContentRef;                 // the closing trace if it is retired unpaid
}
```

- **One sense of "beat".** A beat is a node in a seed's graph. Every beat that isn't `texture` leaves at least one fact, from its fragment or its own `leaves` (L-30): that recorded change is what makes it a beat. An action and its reaction, sometimes called a beat elsewhere, is a fragment of level `exchange`.
- **Reconvergence** is explicit: a beat with several incoming links joins them by `join`. A variant is a condition (`on` or `needs`) on one graph, never a copy of it.
- **Live paths are bounded.** At most `maxLive` beats of one seed are `available` or `running` at once **[tunable 4]**. The lint checks the static bound (L-04).
- **What must reach V.** A beat, sign or fragment marked `mustReach` carries information V needs in order to take an option, or the first sign of a clock. It needs at least one route through a persistent channel that can reach `confirmed`, or at least two sign kinds on different channels. A route made only of transient or overheard channels is an error (L-63). The cheapest channels are also the least noticed, so this is where it matters ([dossier 13](../craft/d13-perception-curiosity.md)).
- **Hooks and twists.** An `introduce` beat of a mystery-shaped seed carries a `hook`:
  - an **anchor** in what V has been shown;
  - a **question** that can be written in exposed terms;
  - its **payoff** beat.

  A twist beat names the expectation it `breaks`. The lint warns about a hook with no anchor, or a question that can't be written over exposed terms (L-67), and about more than one surprise beat per gig **[tunable]** (L-68).
- **What is unresolved.** Each beat in a gig or arc declares whether it leaves an `instability` or a `tension` open (L-70, a warning).
- **Failure forms.** A `failure` caused by distance, time or neglect MUST have `warnFirst` (L-07), and every failure leads to a beat (`leadsTo`).
- **Promises.** A promise is **open** when its `opens` beat is done and `paidBy` is not `yes`. A seed can't succeed (T12) while a promise without `mayStayOpen` is open. Forced closures retire open promises (§6.4). The lint flags promises no beat can pay (L-08).

### 2.9 Offers, choices, responses and the unattended plan

```ts
interface OfferSpec {
  stakes: Array<{ bearer: RoleKey | 'client' | 'v'; what: StakeTag }>;
  withheld?: { what: string; discoverableBy: BeatKey };   // what the patron conceals, and one route to find out (L-86)
  actions: Array<{ id: string; stance: Stance; foresight: ContentRef; writes?: EffectDecl[]; costs?: Cost[] }>;
  nullPath: { id: string; content?: ContentRef; writes?: EffectDecl[] };   // the authored option of doing nothing
  lapse: { after: Duration; then: 'unattended' | 'reoffer' | 'withdraw'; content?: ContentRef };
  decline: Array<{ id: string; response: ContentRef; writes?: EffectDecl[] }>;
  choice: 'flavour' | 'consequential' | 'unchoice';
  retractQuietly?: ContentRef;         // shown when V retracts with one input; default nothing
}

interface ResponseTemplate {
  to: ActPattern; because: ConcernRef; content: ContentRef; needs?: Pred; attribution?: boolean; reply?: ContentRef;
  recalls?: { believer: RoleKey; pattern: EventPattern; variants: { exact?: ContentRef; half?: ContentRef; gone?: ContentRef } };
}

interface UnattendedPlan {
  after: Duration;                     // how long the world takes to settle it without V
  outcome: EffectDecl[];
  events?: EventSpec[];                // off-screen events, minted when it settles
}
```

- **A stake on `v`** (V's money, items, standing) is allowed only as a consequence of an action V accepts (L-15).
- **A consequential choice:** each action's `writes` MUST include a distinct value of one seed fact, and that fact MUST have a consumer (L-06).
- **A decision beat's stances** need at least three, including `refuse` (L-14).
```ts
interface Cost {
  bearer: RoleKey | 'client' | 'v' | 'third';
  what: StakeTag;
  when: 'now' | 'later';
  shown: 'trace' | 'named' | 'quiet';
}
```

- **Recall in responses.** A template with `recalls` asks the NPC's memory, through S0's `onRecall` at this encounter:
  - `exact` selects the `exact` variant;
  - `region` and `gist` select `half`;
  - `gone` selects the `gone` variant, which may be silence.

  The `believes` atom stays yes, no or maybe; recall is a separate result, and the same encounter gives the same answer after a reload.
- **Costs.** Each action MAY declare what it costs and whom. The offer's `stakes` stay as the overview. Theme lives in what options cost (§2.3). A consequential offer whose actions all cost the same, or nothing, gets a warning (L-45). A cost paid `later` and shown by `trace` needs an aftermath beat that reads the action's write (L-46). No cost class feeds a visible number.
- **Honesty.** The language has no construct in which the narrator or the system states V's feelings, motives or reasons. Callbacks name V's acts (`ActPattern`), never reasons. Response templates without `because` don't compile (L-19).
- **Attribution lines ([D-22](../decisions.md)).** An NPC may voice its own belief about V's motive, in a response template marked `attribution: true`. The template must:
  - have a `believes` atom in its `needs` for that NPC's belief about V, and the atom must be yes;
  - have a `because` naming an observed act of V's;
  - be phrased as the NPC's view;
  - offer V a reply that can correct it.

  An attribution line that fails any of these is an error (L-52). L-20 and L-21 don't apply to valid attribution lines.

### 2.10 Profiles

A **profile** is a pack-provided partial seed with parameters. It is data:

```ts
interface Profile { id: ProfileId; version: number; params: ParamSchema; expand: ExpansionRules; lint?: LintId[] }
```

**Expansion** runs before compiling:
1. Generate the seed parts from the parameters by the profile's expansion rules.
2. Merge the seed's own fields over them, field by field. The seed's values win, except where the profile marks a part `fixed`: then the seed may not change it (L-02).
3. Add the profile's own lint checks to the seed's.

The **relationship ladder** is specified in full in [Appendix A](#appendix-a-the-relationship-ladder-profile). It is the first implementation's only profile.

Further profiles come from [P4 §3.8](../p4-seeding-layer.md#38-profiles-shapes-as-data) and [dossier 8](../craft/d08-scale-threads-time.md) (S8-P4-21). Each gets an appendix like A before it is implemented:
- gig;
- job and heist;
- con;
- four-beat;
- front;
- **testing arc** (a flat arc, from dossier 10, S10-S2-19). It has:
  - a baseline beat that exposes the NPC's creed;
  - at least two pressure beats from independent causes;
  - a test beat, which is a decision on the NPC's stance;
  - an aftermath that reads other NPCs' turns;
- **slide** (a negative change, S10-S2-19). It is a run of asks:
  - each ask may grow by at most a third of the total change;
  - each is a full offer with a decline path;
  - each rise is tied to the asker's own frame.

### 2.11 Variation, latitude and adaptation

```ts
interface Variation {
  modes?: Array<{ id: string; weight: number }>;               // drawn first
  variants?: Array<{ id: string; weight: number; rare?: Pred; parts: Partial<Seed> }>;
  strata?: string[];                   // hints for S3's stratified sampling
}

interface Latitude {
  allow: MaterialKind[]; forbid: MaterialKind[];
  authoredOnly: PartPath[];            // parts fitting must never fill or change
  historyHook?: { kinds: ActPattern[] };
}

interface AdaptationPoint { part: PartPath; cost: 'cheap' | 'moderate' | 'costly' }
```

- **A rare variant** is eligible only while its `rare` predicate is `yes` at sowing.
- **`MaterialKind`** is a closed vocabulary in S4. Its starter set:
  - `callback`;
  - `hook`;
  - `holocall-hook`;
  - `bridge-beat`;
  - `stand-in`;
  - `new-named-character`;
  - `location-swap`;
  - `delay`;
  - `trace-cause`: constructing a cause for a trace (§2.15). A constructed cause outside `latitude` fails L-32.
- **Skeleton features.** The compiler computes `verb`, `stake`, `relationship`, `outcome`, `tone` and `channel` through a registry function. They are read-only, for the arbiter, S3 and the tests.
- **Variety provenance.** Every delivery records which mode, variant and alternates produced it (§10.1).

### 2.12 Timing requests

```ts
interface TimingRequest {
  kind: 'trace' | 'pin' | 'bark' | 'message' | 'call' | 'approach';
  class: 0 | 1 | 2 | 3 | 4;            // how intrusive the channel is (dossier 7 §5.3)
  importance: 'low' | 'normal' | 'high';
  purpose: 'introduce' | 'escalate' | 'rest-cue' | 'callback' | 'close' | 'baton' | 'news' | 'recap' | 'notice';
  tolerates: Partial<Record<AttentionAspect, 'allow' | 'forbid'>>;   // default forbid for combat, driving, dialogue
  maxWait: Duration;
  category?: string;
  intensity?: number;                  // −1..1
  onExpire?: 'retry' | 'unattended' | 'withdraw';   // if it waits maxWait unreleased (§8.3)
}
```

- **`baton`** is a class-0 hint at the next thread during rest.
- **`news`** is a settled outcome (§6.4). News requests are released only at a joint (§8.3).
- **`recap`** is the return view (§8.7).
- **`notice`** is a one-time plain notice: a foreign save or a compatibility change (§12.2).
- **`AttentionAspect`** is S5's vocabulary. It includes `speaking`, `reading`, `driving` and `aiming`.
- **Modality.** Each channel in S4's registry declares its modality:
  - visual-spatial (a world trace, a pin);
  - visual-verbal (a toast, a message);
  - auditory-verbal (a bark, a call);
  - auditory non-verbal (a sound cue).

  The default `tolerates` for a request comes from dossier 13's table of noticing by activity and modality: a voiced line competes with a conversation, a world trace with driving. An author may override it.
- **Text budgets.** Each channel has a maximum word count **[tunable: banner 12, toast preview 15]**. A pulled thread's first line carries the premise (L-69, a warning).

A beat's request takes the seed's `timing`; its class and channel come from the fragment's channel ladder (§8.1).

**Defaults** for a seed without `timing`:
- `kind: 'message'`, `class: 2`;
- `importance: 'normal'`;
- `purpose: 'introduce'`;
- `maxWait: { clock: 'play', s: 1800 }`;
- `onExpire: 'retry'` for authored seeds, and `'unattended'` for procedural ones.

**Play-clock durations across a load.** The play clock restarts at a load (§8.2). A play-clock duration that was running (`maxWait`, a lapse, a category timer) restarts from the load. Game-clock durations don't.

### 2.13 Scale, turns, threads and forms

**Scale is what a unit turns.** A seed's scale is the level of the context chain ([foundation §5](../foundation.md#5-context-and-relevance)) that its completion changes:

| Turn level | What changes | Seed level |
|---|---|---|
| `situation` | What a place or moment shows | glance |
| `step` | A step frame's status | encounter, vignette |
| `goal` | A goal frame's status | gig |
| `concern` | A concern frame's status, or a tie's rung | arc |
| `drive` or `standing` | A drive's weight, or a group's standing | season |

```ts
interface Turn {
  level: 'situation' | 'step' | 'goal' | 'concern' | 'drive' | 'standing';
  what: Pred;
  who?: RoleKey;                       // an NPC whose turn this is
  kind?: 'revision' | 'refusal' | 'exit' | 'tie' | 'standing';
}
type GrowsFrom = { looseEnd: { seed: Id; entry: number } } | { promotion: Id } | { parent: Id };
```

- **`turns`** lists the recorded changes that complete the seed. Each `what` reads a recorded value:
  - a frame status;
  - a pin;
  - a tie rung;
  - a standing;
  - an NPC's belief, including a belief about V;
  - V's recorded acts.

  It never reads V's inner state.
- **NPC turns.** An NPC's change is belief revision under pressure, recorded as a **`turning`** event. `turning` is a core pack event kind (S4), minted by S1, with:
  - `who`, `kind`, `from`, `to`;
  - `causes`;
  - `served`.

  Each turning kind declares the content that reads it (L-51). Most NPCs stay flat and change others. **V has no arc in the engine:** V's change is only what V's acts leave in the record, and how the city's beliefs about V move (D-09).
- **Staging a turn.** A beat that stages an NPC's turn, by reading a `turning` count, has two forms:
  - a **witnessed** form, which applies when the earlier stance was exposed;
  - a **told** form, which applies when it wasn't (L-48).
- **The lint checks the scale:**
  - a seed above glance level with no `turns` is an error (L-33);
  - a parent whose highest turn sits below a child's highest turn is an error (L-33);
  - a `level` that disagrees with the highest turn is a warning.
- **A thread is a view, not a type.** The language has no thread construct. Tools and S3 compute threads from `parent`, shared cast nodes or frames, and promises. A season is a seed whose children are arcs.
- **Attention** (attended, simmering, dormant) is derived by S3. It is not a lifecycle state.
- **`growsFrom`** records what a procedural seed grew out of:
  - a loose end of an earlier seed (§6.4), by the record entry's stable number;
  - a promotion;
  - or a parent.

  A procedural arc needs at least two found ancestors in its `growsFrom` chain (L-37). An authored arc needs none.

**Scale forms.** A seed MAY offer shorter and fuller versions of itself:

```ts
interface SeedForms {
  short?: { drops: Array<'texture' | 'legwork' | 'second-approach'>; minDuration: Duration };
  standard: { minDuration: Duration };
  full?: { adds: BeatKey[]; minDuration: Duration };
  abstract?: { notice: ContentRef };   // settles the seed in broad strokes, with notice
}
```

- **A short form** marks as `skipped` the beats whose `role` is in `drops` (§7.1). A beat whose `kind` is `decision`, `aftermath`, `conclusion` or `exit` MUST NOT have a `role` (L-41), so a short form can't drop one.
- **A full form** adds its `adds` beats. In other forms they are `skipped`.
- **The abstract form** delivers `notice`, then moves the seed to `unattended`. It is for a time budget that can't fit even the short form.
- **The form is chosen when the first release is prepared** (§8.4), and recorded. S3's form hook reads:
  - V's engagement flag;
  - the player's declared time budget (optional, set by the player, never inferred);
  - the tempo.

  Without the hook, the form is `standard`.

### 2.14 Clocks, counts and projections

**Consumed events.** Clocks and `count` atoms read only events layer 2 has **consumed**. When a relevance event reports a canon event that matches a clock's tick pattern or a `count` pattern, layer 2:
1. commits every field the pattern used (participants, place, effect), with `committed` pins, so the match can never change on a reload (S0 §9.2);
2. adds the event's `Id` and time to the seed's consumed set, once. An event that matches twice is still one entry.

A role in a pattern means that role's committed cast **at the event's time**. Before the role commits, nothing matches it.

**A clock** is a deadline the world keeps, whether or not V attends:

```ts
interface Clock {
  segments: 4 | 6 | 8;                 // 4 a complex obstacle, 6 a more complicated one, 8 a daunting one
  ticks: Array<{ event: EventPattern; fills?: 1 | 2 | 3 }>;   // the first matching tick counts
  signs: FragmentRef[];                // what V can perceive as it fills: one per segment, or a set drawn from
  onFull: BeatKey;
}
```

- **A clock's value** is the sum of `fills` over the consumed events matching its ticks, capped at `segments`. It is derived: nothing ticks it, and a reload recomputes it.
- **Signs.** When the value first reaches segment `i`, the sign for `i` becomes a delivery with the stable id `H("sign", seedId, clockKey, i)`, released through the arbiter (§8). Its delivery state is persisted (§12.1).
  - **The id is minted once.** But a sign that reaches only `ambient` MAY be re-issued at another placement until it is `presented`, up to `reissue` times **[tunable 2]**. Re-issues count within the plant cap (§2.15).
  - **Variety.** A clock's signs include at least two kinds, such as a world trace and a media item.
- **Full.** When the clock is full, `onFull` becomes available, once.
- **Windows MAY read a clock** through the `clock` atom. That is how a window is "relative to a segment".
- **A clock needs a perceivable source:** at least one sign, and at least one tick event kind that can be exposed (L-36).

**Projections** are how a large seed shows at street scale:

```ts
interface Projection {
  at: { clock: ClockKey; from: number };          // active from this many filled segments
  band: 'distal' | 'proximal' | 'imminent';       // its strength by distance from the front's centre
  form: { world: WorldRequirement } | { glance: FragmentRef } | { media: FragmentRef };
  channels?: ChannelId[];
}
```

- **World projections** compile like world requirements (§3.2). They start when the clock reaches `from`.
- **Glance and media projections** are deliveries through the arbiter, with stable ids `H("proj", seedId, index)`.
- **Strength by distance.** The band sets strength by travel time and social distance from the front's centre. S3 supplies the distance; without it, every projection uses `distal`.
- **Street forms are ordinary glance fragments.** A glance fragment with an `ask` handle MUST reach an offer or a why-trace within two steps (L-38).

### 2.15 Traces and plants

A **trace** is a glance delivery that shows a cause in the world: a scorch mark, a closed stall, a changed sign. A **plant** is a promise (§2.8) whose `opens` beat is a trace, so that a later event reads as caused.

- **A trace cites a fact or a past event, never a pending one** (L-49). If the event it might foreshadow never fires, the plant is still honest; its `retire` content may close it.
- **Where the cause comes from,** in order of preference. The source is recorded on the `display` entry (§10.1):
  1. **`found`**: a recorded fact or consumed event;
  2. **`surfaced`**: an event that exists in the record but wasn't yet shown;
  3. **`constructed`**: a cause S3 contributes, only when nothing is found and `latitude` allows `trace-cause`.
- **A constructed cause is a contribution.** It goes through ordinary arbitration, so it can't contradict pinned history. Before it commits, it is also checked against `confirmed` exposure and V's recorded acts. It is refused if it would contradict anything V has seen or done. The `display` entry records `shownBeforeEffect`: whether the trace was shown before the event it explains.
- **Counter-cues.** A media or rumour fragment that distorts what happened (`divergence` above 0) declares a `counter`: a fragment about the same event in another channel, or an `ask` handle (L-65). A divergent claim may be repeated independently at most `maxRepeatsBeforeCounter` times **[tunable 3]** before its counter is offered. A correction fragment carries `because`: the replacement cause (L-66).
- **Displaying it fixes the past.** When a trace with a `constructed` cause is displayed, layer 2 commits every field of the cause with `committed` pins, as for consumed events (§2.14). After V has seen it, it can't change on a reload or a re-resolution.
- **Traces are borne by the world, not stated.** A plant is a situation V can find. A line that explains the cause adds no surprise and costs coherence ([dossier 10](../craft/d10-change-theme-payoff.md)).
- **Plants are class 0.** They cost no push, but S3 caps them: about three live plants per attended thread, and one foreground plant per scene.

### 2.16 City events as material

The simulation layer (S1) generates the city's own events: routines, incidents, hot spots and their aftershocks ([dossier 14](../craft/d14-city-events.md)). Seeds read that state coarsely, and never as raw numbers.

```ts
type CityRead =
  | { band: { cell: RoleKey | Id } }                 // a cell's heat band: e.g. quiet, simmering, hot
  | { heatRank: { district: RoleKey | Id } }         // a district's rank among districts
  | { tension: { a: RoleKey | Id; b: RoleKey | Id } } // a pair of groups' tension band
  | { regime: { scope: RoleKey | Id } }              // the live regimes in a scope (a crackdown, a turf war)
  | { reach: { district: RoleKey | Id; item: string } }   // whether an item or service reaches a district
  | { protected: { node: RoleKey | Id } }            // whether a place or person is under protection
  | { presence: { leaf: RoleKey | Id; faction: Id } }   // a faction's presence in a leaf area (§2.18)
  | { priceLevel: { district: RoleKey | Id } }
  | { refuge: { leaf: RoleKey | Id } };              // whether V could lie low there
```

S1 exposes these as pins and process state. **No atom exposes a heat number.** A `city` atom is `maybe` until S1 has a reading for its scope.

**Hot state opens windows.** A window may open on a band and close on its fall, latched like any other window (§2.7). A world requirement may name a band or a regime. When a fitted seed is sited at a hot cell, the fit report cites the band that justified it. "Why now" is answered by a cause chain of at most four links, through the parents S1 records on each event.

**What the city produces is not the director's to edit:**
- **Occurrence.** The director (S3) chooses which events, pending or past, to realise, may delay realising them, and builds offers around them. It never removes an event that has happened.
- **Grudges.** A group's belief about V may raise an offer through layer 2. No S1 process aims an act at V. Offers that put V at risk follow the choice rules of §2.9.
- **The game's own incidents** (gigs, hustles, its combat events) are `game` facts for seeding, never sown. Fitting reads bands to site authored seeds near them.

**One carrier schema.** City events that leave marks declare carriers and durations in the same schema as `cosmetic` effects (§2.5). A city trace and a seed trace are re-realised by the same rule after a load.

**The return view for districts.** On first entering a district V knows after a long absence, the return view (§8.7) offers at most three changes there. They are drawn from the district's event ring and the beliefs held in it, and name events and acts, never feelings.

### 2.17 People, order and reputation as material

S1's people, ties, norms and order ([dossier 15](../craft/d15-people-networks-order.md)) reach seeds through coarse reads, never raw numbers:

```ts
type SocialRead =
  | { label: { audience: RoleKey | Id; subject: RoleKey | Id | 'v'; axis: string } }   // a reputation band, from S0's aggregate
  | { bridge: { who: RoleKey | Id } }               // how much a person brokers between groups
  | { normGap: { norm: Id; scope: RoleKey | Id } }   // the gap between private and perceived support
  | { contract: { id: Id } }                        // due, at-risk or broken
  | { tied: { a: RoleKey | Id; b: RoleKey | Id; type: EdgeTypeId } }
  | { divergence: { believer: RoleKey; subject: RoleKey | Id } };   // how far a belief is from the truth, banded
```

A `social` atom is `maybe` until S1 has a reading for it.

**Casting through ties.** A role MAY require a relation to another role, through `must` predicates with `has-edge`:
- an acquaintance of another role;
- membership of the same focus (a crew, a workplace, a bar's regulars);
- or brokerage between two named groups.

With S0's implicit edge types, the query tests unopened ties exactly. Until they are implemented, casting first opens a bounded candidate set among the people sharing the named focus. The fit report lists the foci used, and for a fixer, the position that explains the fixer's offer ("why this fixer").

**Stage types.** These are stage kinds in job-shaped profiles:
- an offer between strangers includes a **signal** stage;
- **collateral** and **mutual-secret** stages bind trust.

Street cred stays a mirrored game fact.

**Betrayal is a declared seed.** A seed that turns someone against an ally or employer declares its required causes:
- a dilemma;
- an offer or a threat;
- a visible failure.

It counts against S1's betrayal budget. It never targets a cast another live seed holds without that seed's consent (§9). No S1 process turns an ally against V; a group's grudge against V is a belief that may raise an offer (§2.16). Delay, fake compliance and quiet exit are the usual outcomes, so they are the defaults a turn seed's variants should cover.

**Norms and public acts.** Windows may open on a norm's gap band, or on a change of regime. "Make it public" is a stage type: the same act done publicly can end a norm in one step, while done privately it changes nothing. Seeds may cast informer and witness roles. Every such offer has a decline path (§2.9) and honours the content floors (dossier 18).

**Keep belief nesting readable.** The lint computes the depth of nested beliefs a seed's beats rely on ("the broker thinks the buyer thinks V is loyal") and warns above 4 (L-71). A beat that claims to turn on a divergence names it.

**Reputation shows through behaviour.** A label reaches V through:
- prices;
- greetings;
- access;
- a witness's remark after several recorded acts.

It never appears as a meter or a label on screen (L-59 applies).

**Content dials.** Violence against residents, informing and sanction severity are player settings (S0 `SettingsSet.content`), read as lenses. A ladder caps its top rung from them. Dossier 18 sets the limits no setting can override.

### 2.18 Setting and tone

Content should read as Cyberpunk 2077's Night City, not generic cyberpunk ([dossier 17](../craft/d17-setting-tone.md)).

**Setting data.** The game's records hold factions' classes and their attitudes to each other. They don't hold territory, trade, wealth, danger, influence or ownership. So S4's setting registries are mostly authored and keyed to **leaf areas**, and S1 derives what it can from the game's own traces. Every field carries its source: `authored`, `derived` (with its rule recorded) or `mirrored`. Seeds read the setting only as bands:
- `presence`, `priceLevel` and `refuge` reads (§2.16);
- prices checked against their band (L-88);
- brands and products checked against the registry, unless marked `invented` (L-90).

**Tone.** `ToneTag`'s provisional starter set is:
- `grounded`, `fatalist`, `wry`, `tender`;
- `kinetic`, `procedural`, `dread`, `absurd`.

Each tag has a weight (heavy or light) and lexicon markers in S4.

**Stake scale.** A seed declares its `stakeScale`, from a person up to the city. A procedural seed above `block` needs two found ancestors, or an authored flag. Naming entities above the declared scale is a warning (L-77).

**Patrons withhold.** A fixer or client offer at gig level or above declares what the patron conceals (`withheld`), and one route by which V can find out (L-86).

**Institutions have costs.** A faction or institution named in a front, gig or street form references its cost to the residents (L-85), extending L-34 beyond fronts.

**Media name an outlet.** A media or rumour fragment names its `outlet`, whose kind must permit the channel (L-87). Its `divergence` comes from the outlet's profile.

**Urgency needs a clock.** Text or an offer that claims a deadline needs a `clock` or a window behind it (L-89).

**Dread** is anticipation under uncertainty:
- **The threat's nature stays open.** A threat has a `nature` slot that stays unresolved until **contact**, and a `reveals` set of tokens. Text before contact that contains a `reveals` token is an error (L-84). Every trace in a dread kit must be consistent with every nature the kit lists; the fit report checks this.
- **Intensity follows the setting.** A dread beat above the profile's `dreadMax`, or above the player's setting, plays its `implied` form instead (L-84).
- **Wrongness** is a routine V has seen, broken. A `wrongness` trace may be released only after a confirmed baseline: at least two displays of the routine. It cites a past cause (L-91, extending L-49).
- **Dread comes from systems and acts:** debt, ownership, being sorted. Authors write dread fragments; the engine only places and times them.

**Contrast.** A `contrast` glance form pairs something strange with residents treating it as ordinary. One without a resident witness is warned (L-92).

**The tone lint** checks vocabulary and structure, never whether anything lands:
- tone polarity derived from a beat's effects against its declared tone (L-78);
- slang outside its speaker class, era or register (L-79);
- forbidden register items, such as real-world trademarks or meta words in a diegetic channel (L-80);
- one specific detail per scene, up to a density cap (L-81);
- text that names its own tone (L-82);
- a `success` with no cost fact (L-83).

Every tone finding lists what it did **not** check: wit, freshness, stereotype by meaning, whether dread works. The fit report carries a "not checked" line per seed. The lexicon is calibrated against the game's own text, to at most 5 % false positives **[tunable]**.

### 2.19 Content classes, ceilings and floors

The players are adults, and the genre is adult. Content is the player's choice, with defaults matching the base game, and only legal or platform floors are fixed ([dossier 18](../craft/d18-content-boundaries.md)).

**Classes and tags.** S4 registers content classes:
- violence by kind;
- harm to bystanders;
- dread;
- drugs;
- sex work, exploitation;
- explicit sexual content;
- and the rest.

A fragment carries `content: Array<{ class; intensity: 1 | 2 | 3 }>`. A seed carries an `envelope` (the most intense tag per class), declared by the author and checked against the compiled tags (L-93). Untagged fragments carry nothing.

**One ladder per class: ceilings, lines and veils.** The player's settings (`SettingsSet.content`) give each class a **ceiling**, from 0 to 3:
- **0 is a line.** S1 never produces events of that class, and the kernel refuses them (S0 §20, V4-23).
- **1 to 3 are veils of different depth.** Above the ceiling, a fragment plays its `implied` form, a droppable beat is dropped, or a seed that `requires` the class isn't sown. A fragment tagged at intensity 2 or 3 must have one of the three (L-94).
- **Defaults.** The `as-the-game` preset is the default. A pack may lower a ceiling for its own seeds, never raise the player's.
- **One gate, four checks.** The ceiling is checked at sowing, at fragment choice (§7.2), at release (§8.3) and at display (§8.5). The release step uses the settings in force at release. Each gating is recorded in `provenance.gated`, with no model input (§8.8).
- **Reading the ceiling.** The `setting` atom reads `content.<class>` as an integer, never `maybe`.
- **Skip.** The player's one-input **retract** (§8.3) plays the running beat's `implied` form or ends it, withdraws the offer quietly, and writes a neutral `retracted` entry: no reoffer of that seed, no effect, no input to the model. It adds the class and level to `softExclusions`. Leaving, skipping past or letting it lapse is a plain decline.
- **Notices before, not during.** A warning shows only for classes the player flagged, and before the scene. Each delivery's descriptors are always available under "Details", in the settings voice. Warnings don't protect a player; the player's own controls do.

**Author-fill seams** ([D-23](../decisions.md)). Explicit sexual content is part of the genre, and the engine handles it like any other content class. It sows, fits, casts, composes, places and times it, procedural seeds included, within the player's ceilings.

**What humans supply is data.** The model-driven tools that write the project's own text and assets (the authoring assistant, and any language model in S7) don't produce it. So for such a class, the **source material** (text units, scenes, assets) comes from packs people write:
- **Authored-source classes.** S4 marks a class `authoredSource`. A text unit or asset in it needs `authored: 'human'` and a named author in the pack manifest (L-97). No model-generated text or asset fills it. How the engine uses that material (selection, recombination, casting, timing) is unrestricted.
- **Every such fragment has a non-explicit partner,** its `implied` form or `fade`, that leaves the same facts (L-100). A seed therefore runs identically whether or not a pack supplies the material, and model-written content always has a form it can produce.
- **Unfilled slots are marked.** A seed may reference an author-fill slot with a `todo` content reference of kind `author-fill` (§11.1). Below `ready` it shows as a placeholder; at `ready`, the implied form plays until a pack fills it.

**The explicit scene:**
- its source material is `authored: 'human'`;
- it has a `fade` at the same level, which leaves the same facts;
- it binds only adults;
- it is reached only through an action V accepted (L-99).

On a relationship ladder, it also holds no choice inside it, and it is reached from the top rung (Appendix A, L-11).

No `mustReach` item, window, item, economy or relationship-status predicate may read an intimacy fact (L-101). An effect on V with a `sex.*` tag must come from an action V accepted (L-98). The engine never presumes V's participation (D-09).

**Adult themes in the genre** (sex work, braindances, bodies as commodities, exploitation) get the same design depth as violence: placement, consequence, representation and the terms of the people involved. A seed tagged `sex.work`, `sex.exploit`, `exploit.body` or `exploit.labour` binds each person's **terms** (free, constrained or coerced) from their membership or contract record. A `coerced` person needs a `coercer` role and the means of coercion, and the seed needs a route for V to act or decline (L-113). Erotic framing in an exploitation seed is warned.

**The floors.** No setting, pack or author can override these:
- **Minors.** Every person has an `ageClass`; a missing one counts as `minor` (S0 V4-22). A role that could bind a minor is barred from sexual tags and from victim, target or hostile positions (L-95). Casting removes non-adults from barred roles. A pack person needs an `ageClass` (L-111).
- **Real people.** Pack persons are marked `fictional` (L-109).
- **Hate content in the system's own voice.** Slurs and hateful framing are barred from the narrator, news, system and template voices (L-103, error). In authored dialogue they go to a review queue as a warning. NPCs may hold and voice bigoted views in the fiction: it is part of the genre.

Each floor is enforced by structure (casting, roles, voices), not by text filters alone.

**Representation.** Casting must not code menace or crime to protected attributes:
- A role's `must`, `prefer` or score may not read a protected attribute unless the pack declares the correlation, with a reviewer and reason (L-102).
- Culture-coded menace descriptors are warned (L-104).
- Violence templates with a mental-illness precondition are refused (L-105).
- Age words beside sexual tags are warned (L-107).
- Class-signal words in untagged fragments are warned (L-108).

These report to review; none edits text. P9 runs dossier 18's representation audit over many world seeds:
- shares by role class;
- associations;
- swap tests;
- proxies;
- feedback loops;
- support.

**Sanction ladders** cap their top rung at the ceiling. Rungs above stay as reported facts at ceiling 1, and aren't produced at 0. A ladder needs a rung at intensity 1 or below (L-106).

**Offers asked of V.** Successive `harm.asked` offers from one patron that rise in intensity need a stated frame (L-110). Every `harm.asked` and `betray.inform` offer has a decline that costs no more than accepting.

**Echoes.** A death attributed to V's act produces an echo within 3 game days **[tunable]**, in the third person.

**Accessibility.** An engine effect whose declared flash parameters exceed the general threshold is refused (L-112).

## 3. Compiling

### 3.1 The steps

An instance is compiled once, at sowing:
1. **Expand** the profile (§2.10).
2. **Draw the mode, then the variant** (§3.4). Merge the variant's `parts`.
3. **Lint** (§11.1), at the template's maturity. An error refuses the seed. The refusal is recorded in the pack's sowing record, and the instance is never sown.
4. **Mint** the seed node.
5. **Store** the expanded document in the instance's state (§12.1).
6. **Open the seed's frames** (§3.3), with interests from the dependency collection (§4.1).
7. **Install** the world requirements whose `from` is `sown`.

### 3.2 What compiles to what

| Seed construct | Kernel material | Layer or reason | Starts | Ends |
|---|---|---|---|---|
| A fixed world requirement | `constrain` contribution, `Set` or `Const` form | The seed's layer (below) | Its `from` | Its `to`, or the seed's end |
| A preferred world requirement, strength `k` | `weight` contribution, `strength = k` | The seed's layer | As above | As above |
| A world projection | As a world requirement | The seed's layer | The clock reaching `from` | The seed's end |
| A role's identity, `must` and `prefer` | Casting query terms (§5) | — | — | — |
| A committed cast | `core:cast` edge, seed → node, `data.role` | Cause: the release | Commit | The seed's end (`EdgeEnded`) |
| A role's `goal` | A goal frame on the cast node; its parent is the seed's role frame | — | Commit | The seed's end: `abandoned`, or `satisfied` if the seed resolved |
| A role's `authored` beliefs and edges | Beliefs (source `inferred`, rule `seed`) and edges | Cause: the seed | Commit | Kept: they are history |
| A role's `rung` floor | Layer-2 record entry that S3 reads; no kernel slot | — | Commit | Kept |
| A seed-fact write | `committed` pin; the previous one withdrawn (§2.5) | 300 | The write | The next write, or the reset wake-up |
| A game-fact write | A `story.write-vanilla` request to the game port (S5) | — | The write | — |
| A `kernel` effect | A `core:event` with that effect, committed | — | The write | — |
| A displayed offer, and V's response | `core:event` of kind `offer`, then `response`, with V as witness (observed) | Canon | The display confirmation (§8.5); V's answer | — |
| Closing | `core:event` of kind `seed-outcome`, committed | Canon | Closing (§6.4) | — |

**The seed's layer** comes from who sowed it:

| Sown by | Contribution layer | Precedence |
|---|---|---|
| An authored pack | `authored` | 400 |
| A plugin through `story.seed@1` | `authored` if the plugin declares itself an authoring source, else `procedural` | 400 or 100 |
| The procedural engine | `procedural` | 100 |

Commitments are `committed` pins (300), whoever sowed the seed. A procedural seed's wishes therefore yield to the simulation (200) until committed, and its commitments then hold against it.

**Ending material.** Ending a contribution writes `ContributionEnded`. Ending an edge writes `EdgeEnded`. Closing a frame sets its status. After a load, only material that hasn't ended is in effect, because the kernel's replay already says so.

### 3.3 The seed's frames

Each instance has two kinds of frame on its own node, opened at sowing:
- **The watch frame,** `level: 'goal'`, weight 1. It carries the instance's dependency interests (§4.1).
- **One role frame per role,** `level: 'goal'`, weight 1, child of the watch frame. It focuses on the cast node once the role is cast.

The frames are active while the seed is live. They are closed when it ends (§6.1): `satisfied` if it resolved, `abandoned` otherwise.

### 3.4 Layer-2 draws

Layer 2 makes these choices with the kernel's draw arithmetic (S0 §1.3 and §5.4), on its own keys:
- modes;
- variants;
- alternates;
- casting among candidates (§5.2).

For a choice `c` among options `F`, with `s = seedId`:

```
score(o)  = ln w(o) + Σ_parts strength · ln K · [o is the preferred value]  + Σ_fit fitWeight(o)
g(o)      = −ln(−ln(rand("seed-draw", worldSeed, s, c, attempt, o)))
choice    = argmax over o ∈ F of (score(o) + g(o)); exact ties to the lower H("tie", worldSeed, s, c, o)
```

- **`w(o)`** is the option's declared weight, or 1.
- **`K`** is **[tunable 8]**.
- **`fitWeight`** comes from S3's fitting hook. It is **clamped** to ±`fitCap` **[tunable ln 1.5]** before it enters the score, and the draw record keeps the raw and the clamped value. It is 0 with the director off, or with the player's `noticing` setting off (§8.8).
- **A fixed part** makes `F` its single value.
- **`attempt`** starts at 0. It increments only when the same choice is legitimately made again: a re-offer, or a re-cast after a ladder step.

Each draw is recorded in the instance's state. A reload re-uses it rather than drawing again.

**Not drawn:**
- **The channel** is the first channel in the fragment's ladder that the game port reports available (S5). If none is available, the delivery waits.
- **The scale form** comes from S3's form hook, or is `standard` (§2.13).

### 3.5 Watching fixed parts

A fixed world requirement can lose to a higher layer without the kernel reporting a contradiction, because only rejected constraints at precedence 600 or above set `contradiction` ([DS-67](../design-seeds.md)). So layer 2 watches its own. The check depends on the target:
- **Targets that arbitrate** (sampled, assigned, or derived through a preimage): call `trace` (S0 §13) on the target, and see whether the requirement's constraint is marked rejected.
- **Mirrored slots of mirrored nodes,** which resolve straight from game readings (S0 §5.1): resolve the slot, and test the value against the requirement's form directly.

**Selector targets** are expanded to the nodes they match, by a kernel query bounded by `watchMax` nodes **[tunable 64]**. A selector that matches more is a lint error (L-42). The expanded nodes get interests on the watch frame.

A requirement whose check fails is **rejected**. Its `ifRejected` applies:
- `withdraw`: the seed goes to `withdrawn` (T1);
- `degrade`: the requirement is ended, and the seed continues without it;
- `refit`: S3 is asked to re-fit the part within `latitude`. With the director off, `refit` acts as `degrade`.

Every rejection writes a `fixed-rejected` record entry, whatever the policy.

**When the check runs:**
- right after the requirement is installed;
- while preparing a release (§8.4);
- on every relevance event for its target.

A fixed role identity is watched through `onLost` instead (§5.5).

## 4. Re-evaluation and wake-ups

### 4.1 Dependency collection

At sowing, layer 2 collects every kernel value the instance's predicates can read, and registers an interest for each on the watch frame. The predicates searched:
- `context`;
- windows;
- `end`;
- beats' `needs` and `on`;
- objectives;
- failures;
- promises;
- fixed world requirements;
- clocks;
- `count` patterns.

| Atom | Interest |
|---|---|
| `fact f` | `{ kind: core:game-fact, scope: { nodes: [H("game", "fact:" + f)] }, slot: 'value' }`, plus the same for every fact in `f`'s `decidedBy` |
| `decided f` | The facts in `f`'s `decidedBy` |
| `seedFact` | None: layer 2 writes those itself and re-evaluates after each write |
| `role r, p` | The cast node of `r`, slot `'*'`, added when `r` is cast |
| Clock ticks and `count` patterns | `{ kind: core:event, where: [the pattern's kind] }`, with the pattern's place or participant scope where it names one |
| `fn` | Each fact or node in its `reads` |
| `believes` | None: beliefs produce no kernel changes. A live instance with a `believes` atom re-evaluates at every simulation window boundary (§4.3) |
| `seed` | None: layer 2 re-evaluates readers when any seed changes state, through a reverse index from template and instance ids to the instances whose predicates name them |

Casting candidates are not watched individually. A `waiting` seed re-casts on its wake-up deadline (§4.3), and on any relevance event to its frames.

### 4.2 Change order and latches

Relevance arrives in the kernel's delivery order (S0 §10.5). Layer 2 processes each instance's relevance events in that order. Window `closes` predicates are evaluated **at the time of each delivered change**: the changed pin's `valid.from`, or the reading's time. Fact atoms resolve at that time (S0 §6.3).

So a closing value latches even if a later change has already reverted it by the time the work item runs. The other predicates are evaluated once, at the current time, after the batch.

### 4.3 Wake-ups

Each live instance keeps a list of **wake-ups**: `(clock, time)` pairs, each for a reason. Game-time wake-ups are checked at every simulation window boundary (S0 §9.4). Play-time wake-ups are checked by the arbiter's step (§8.3).

| Reason | Clock and time |
|---|---|
| An `hour` atom in a live predicate | The next hour boundary it names |
| A `since` atom | When it would become `yes` |
| A timed `wait` ladder step | Its deadline |
| An unattended plan | `unattended` entry + `after` |
| An offer's lapse | Display time + `lapse.after` |
| An aftermath's delay | When it becomes available + `delay` |
| A resettable pin | Its reset time (§2.5) |
| A repeatable template's `gap` | When the gap runs out |
| A `waiting` seed | The next boundary, at most every `recastEvery` game seconds **[tunable 600]** |
| A `believes` atom in a live predicate | The next simulation window boundary |

Wake-ups are part of the instance's state (§12.1). After a load, game-time wake-ups already past fire at once, in time order. Play-time wake-ups restart from the load (§2.12).

### 4.4 The re-evaluation step

A live instance **re-evaluates** when:
- a relevance event reaches its frames;
- a wake-up fires;
- the arbiter reports on one of its deliveries;
- V responds to one of its offers;
- a seed it reads changes state;
- S7 reports content completed.

Re-evaluation is a worklist item (S0 §10.7), processed in instance `Id` order. Its work counts against the shared tick budget. One step:
1. updates the window states and latches (§2.7, §4.2);
2. watches fixed parts (§3.5);
3. updates beats (§7);
4. applies lifecycle transitions (§6.2), up to `maxTransitions` per step **[tunable 8]**. If more would apply, the instance is queued again behind the others.

## 5. Casting

### 5.1 Order

Roles are cast in **topological order** of their role references. A cycle is a lint error (L-13). Among roles whose references are all cast, the next is chosen by these rules, in order:
1. anchors first;
2. then fail-first: fewest candidates in the previous attempt;
3. then `order`;
4. then key.

### 5.2 Casting one role

1. **The effective requirements.** A role's effective `must` is its `must` minus the terms its ladder has relaxed (§5.4). Relaxed terms count as preferences of strength 1.
2. **A role with a fixed identity** has one candidate: that node. It is cast if every effective `must` is `yes`; otherwise it is unfilled.
3. **Otherwise,** run the kernel query (S0 §8) with:
   - `find`: the role's kind;
   - `scope`: the role's scope, with role references resolved;
   - `must`: the effective `must`;
   - `limit: 'all'`.

   A preferred identity is added to the candidates if it satisfies the effective `must`.
4. **Claims.** Apply claim priority (§9.2) to candidates another live seed holds. A candidate stays if this seed would win the claim. It is removed if this seed would lose.
5. **Choose** by the layer-2 draw (§3.4), with `w(o) = 1`. These add to a candidate's score:
   - `strength · ln K` for a preferred identity;
   - `strength · ln K` for each preference that holds;
   - `ln K` for each `repertoire` fragment S1 lists for it.
6. **Results:**
   - an empty set means the role is **unfilled**;
   - a query that returns `failed` means **unfilled**, with reason `too-broad`;
   - otherwise the choice is the role's **tentative cast**.

**Casting is read-only.** Tentative casts live only in layer-2 state. They add nothing to the kernel, so the kernel's revision doesn't change.

### 5.3 Committing

A seed commits its roles when its first release is prepared (§8.4). A role that no beat uses before then commits when the first beat that uses it is prepared.

Committing a role:
1. adds the `core:cast` edge;
2. installs the world requirements that name the role and start at commit;
3. opens the role's `goal` frame on the cast node, if it has one, with the seed's role frame as parent at edge weight 1. Opening it runs the kernel's cross-pressure check (S0 §10.8);
4. adds the role's `authored` beliefs and edges.

The cast edge makes the cast node a retention root (S0 §7.3), so a cast person is never forgotten while the seed is live.

### 5.4 When a role can't be filled

The role's ladder `onUnfilled` runs from its saved **cursor**. The cursor starts at 0 and is persisted.

| Step | Effect | Advance when |
|---|---|---|
| `{ wait: d }` or `'wait'` | Stay `waiting`. Re-cast on every re-evaluation | Its deadline passes (a wake-up), or, for `'window'`, never: the seed withers when it closes |
| `{ relax: i }` | Demote `must[i]` to a preference and re-cast at once | The re-cast fails |
| `standIn` | Prepare a **pending stand-in** (below) | The stand-in recipe is refused at commit |
| `shrink` | Allowed only for `optional` roles. The role is dropped, and beats that bind it are `skipped` (§7.1) | — |
| `withdraw` | The seed goes to `withdrawn` (T1) | — |

**Persisted with the cursor:**
- the set of relaxed terms;
- the wait deadline.

A ladder that runs off its end acts as `withdraw`.

**Relaxing text guarantees.** A `relax` step MUST NOT demote a term that guarantees a `textAttrs` attribute (L-17 makes the guarantee; L-43 forbids relaxing it).

**Stand-ins** are constructed only from the **constructible subset**: `must` terms with `op` `eq`, `in` or `range` on the stand-in's own non-ref, non-temporal slots. A stand-in role with any other `must` term fails the lint (L-18). Until commit, a pending stand-in is a description in layer-2 state: `{ role, kind, constraints }`. It counts as cast for availability. At commit, layer 2:
1. mints the node `H("mint", seedId, seedId, "role:" + key)`;
2. installs its constraints as fixed world requirements, at the seed's layer;
3. casts it.

### 5.5 Re-checking at play time

When a beat that binds a committed role is prepared (§8.4), or starts without a release, the role is re-checked against its effective `must`. A term that is `no` means the role is **lost**, and `onLost` applies:
- `withdraw`;
- `standIn`, from this beat onwards;
- `shrink`, if the role is optional.

A `maybe` is not a loss; the beat waits. Re-checking runs one query and no ladder steps.

## 6. The lifecycle

### 6.1 States

| State | Meaning |
|---|---|
| `sown` | Compiled and live, not yet evaluated |
| `waiting` | The seed is pending, or a non-optional role is unfilled |
| `cast` | The seed is open, every non-optional role is tentatively cast, and its first request is with the arbiter |
| `offered` | Its first offer is released and awaiting V's response |
| `running` | Its beats are unfolding |
| `unattended` | V declined, retracted or let the first offer lapse, or the release window degraded; the unattended plan is settling |
| `resolved` | Terminal: it reached its end state, or the world settled it |
| `withered` | Terminal: its windows closed |
| `withdrawn` | Terminal: withdrawn by its source, a ladder, or a rejected fixed part |

**Terminal states are final.** On entering one:
- the instance's frames close (§3.3);
- its cast edges, contributions and NPC goal frames end (§3.2);
- its pending requests are withdrawn;
- §6.4 runs.

### 6.2 Transitions

Each transition is recorded (§10.1). At each re-evaluation step, the first applicable row fires, in table order. Then the table is checked again, up to the step's limit (§4.4).

| # | From | Condition | To | Effects |
|---|---|---|---|---|
| T1 | any live | Source withdrawal; a rejection with `withdraw`; a ladder that reached `withdraw`; a role lost with `withdraw`; a lapse with `then: 'withdraw'`; an expiry with `onExpire: 'withdraw'`; a pack removed or migration refused (§12.3) | `withdrawn` | §6.1 |
| T2 | `sown`, `waiting`, `cast` | The seed is closed (§2.7) | `withered` | The lowest-index window's close policy (§2.7) |
| T3 | `offered`, `running` | The release window is closed, and it doesn't hold while running | `withered`, or `unattended` for `degrade` | The release window's close policy |
| T4 | `sown`, `waiting` | The seed is open, `context` is yes, and every non-optional role is cast, tentatively or pending stand-in | `cast` | Submit the first request (§8.1) |
| T5 | `sown` | None of the above | `waiting` | — |
| T6 | `cast` | The seed is no longer open, `context` is not yes, or a tentative cast was lost | `waiting` | Withdraw the pending request (a cancellation) |
| T7 | `cast` | The first release was prepared and confirmed, for an offer | `offered` | Commit (§5.3) |
| T8 | `cast` | The first release was prepared and confirmed, for a beat that isn't an offer | `running` | Commit; start the beat |
| T9 | `offered` | V's response to the first offer is an action (§7.4) | `running` | Apply the action's writes; the offer beat is `done` |
| T10 | `offered` | V's response to the first offer is a decline, a retract, the null path, or an exposed lapse with `then: 'unattended'` | `unattended` | Its content and writes (§7.4) |
| T11 | `offered` | The first offer lapsed with `then: 'reoffer'`, or lapsed without ever being displayed | `cast` | `attempt` + 1 for the offer's draws |
| T12 | `running` | `end` is yes, and no promise without `mayStayOpen` is open | `resolved` | Close as a success (§6.4) |
| T13 | `unattended` | The plan's `after` has passed since entry | `resolved` | Apply `outcome`; mint its events; close as settled (§6.4) |
| T14 | `cast` | The first request expired unreleased with `onExpire: 'unattended'` | `unattended` | — |
| T15 | `running` | The seed is **stuck** (§7.5) | `withered` | Close as `abandoned`; record a `stuck` defect |

**Offer ids.** An offer's event `Id` is `H("mint", seedId, seedId, "offer:" + beat + ":" + n)`, where `n` counts earlier releases of that beat in this instance. A reload therefore shows the same offer (dossier 7's PR-13).

**The world goes on.** A declined or ignored seed doesn't vanish: its client's blocked goal and the unattended plan settle without V ([dossier 9](../craft/d09-agency-consequence.md)).

### 6.3 Releases

A **release** is the arbiter letting one delivery through after it has been prepared (§8.4). The first release commits the seed. Before it, nothing about the seed has reached V, and nothing has changed in the world beyond its sowing material.

### 6.4 Closing and outcomes

A seed **closes** on every move to `resolved` or `withered`, and on a move to `withdrawn` if it was ever released. Closing it:

1. **Mints one `seed-outcome` event,** committed. Its kernel fields are only the seed and the time. The details go in a `closure` record entry keyed by the event's `Id`:
   - **`status`:**
     - `resolved`, after T12, or after T13 with `end` yes;
     - `transformed`, if a child seed `growsFrom` it;
     - `abandoned`, otherwise;
   - **`witnessed`:** true if V was exposed (§10.2) to the beat or plan that ended it;
   - **`looseEnds`:**
     - consequence facts no declared consumer has read;
     - cast nodes whose frames the seed changed;
     - promises retired unpaid, with each entry's stable number, and plants among them marked `unpaidPlant`;
     - `unreadTurn`: turning events the seed caused that no consumer read;
     - `changes`: every turning event the seed caused, each with a `witnessed` flag.

   Witnessed and settled completions write the same record. Only the flag differs.
2. **Retires open promises** on forced closures (withered, withdrawn, or T13 with `end` not yes). They go into `looseEnds`; this is not a defect.
3. **Queues closing deliveries.** These outlive the seed (§8.6):
   - the closing trace, if the seed has `closing` and was released: class 0, purpose `close`. A seed at gig level or above needs one (L-35);
   - the release window's `closeContent`, for coda and memory;
   - a **news** delivery, if the seed was released at any point and `witnessed` is false.

Loose ends are a record, not new seeds. S3 MAY grow new seeds from them, naming the entry in `growsFrom`.

## 7. Beats at run time

### 7.1 Beat states

| State | Meaning | Final |
|---|---|---|
| `locked` | Its links aren't satisfied | no |
| `available` | Its links are satisfied; it waits for preparation and release | no |
| `running` | Started | no |
| `deferred` | An offer beat answered "not now" or left to lapse, waiting to be offered again (§7.4) | no |
| `done` | Completed | yes |
| `failed` | Its objective failed | yes |
| `skipped` | A shrunk role, a short form, an unchosen branch, or a cancelled aftermath | yes |

| From | To | When |
|---|---|---|
| `locked` | `available` | Its links are satisfied (below), its fragment's `needs` is yes, and fewer than `maxLive` beats are live |
| `locked` | `skipped` | It binds a shrunk role; the form drops it; or no link can ever be satisfied (§7.5) |
| `available` | `running` | Prepared and released (§8.4), or started directly (§7.3) |
| `available` | `skipped` | An aftermath whose `cancelIf` is yes |
| `running` | `done` | Its objective succeeded, or, without one, its content completed |
| `running` | `failed` | A `failure` fired (§7.3) |
| `running` | `deferred` | An offer answered with the null path, or lapsed with `then: 'reoffer'` (§7.4) |
| `deferred` | `available` | Its `reoffer.when` is yes and it was offered fewer than `reoffer.max` times |
| `deferred` | `done` | It was offered `reoffer.max` times; the last response stands |

A final state never changes. A beat leaves `locked` at most once.

**Links.** A link is satisfied when:
- `because b, on p`: `b` is in a final state and `p` is yes. A `skipped` source passes through: the link is satisfied once `b` is skipped, whatever `p` says;
- `obstructedBy b`: `b` is not `available` and not `running`;
- `then b`: `b` is in a final state.

`join: 'all'` needs every incoming link; `'any'` needs one. Beats in `start` need no links. Ties among beats becoming available at once are broken by key.

### 7.2 Choosing the fragment

Every fragment passes the same **eligibility** check, whether named directly or among alternates:
- its `applies` is yes, if it has one;
- its `repeat` allows another use;
- its `minGap` has passed.

**Uses** are counted per save branch, in the layer-2 global record (§12.1):
- the count of earlier uses;
- the game time and offer count at the last use.

For `{ alternates: [...] }`:
1. Keep the eligible alternates.
2. Keep the most specific: those with the most atoms in `applies`.
3. Choose among them by the layer-2 draw (§3.4), with the key `"alt:" + beat + ":" + n`.

A directly named fragment that isn't eligible makes the beat wait.

### 7.3 Running a beat

**Perceivable beats go through the arbiter.** A beat whose fragment presents anything to V (an offer, a message, a call, a sign, a bark) is prepared and released through the arbiter (§8). A beat with no channel, which only writes facts, mints off-screen events or changes the world, starts at once.

**While a beat is running,** at each re-evaluation, in this order:
1. **`failure` entries,** in order.
   - An entry with `warnFirst` fires only after its warning was `confirmed`, or `presented` twice on different channels (§10.2). Its warning is delivered when `warnFirst` is first yes, and re-delivered on another channel only as §8.5 allows.
   - The first entry whose `when` is yes fails the beat. Its `leadsTo` beat's links are then checked normally.
2. **`objective.fails`:** if yes, the beat `failed`. A `failed` beat with no `failure` entry leads nowhere.
3. **`objective.warns`:** if yes for the first time, its warning is delivered once.
4. **`objective.succeeds`:** if yes, the beat is `done`.

Failure wins over success when both hold in the same step. A beat without an objective is `done` when S7 reports its content completed. Without content, it is done at once.

**On `done`,** the beat's `leaves` are written (§2.5).

**Aftermath beats.** On becoming available, an aftermath waits `delay` (a wake-up). Then, unless `cancelIf` is yes, its `signposts` are delivered and the beat runs.

### 7.4 Offers

Every offer beat, first or later, follows the same **response lifecycle**:

| Response | Recorded as | Writes | The beat |
|---|---|---|---|
| An action | `response` event, `kind = action:<id>` | The action's `writes`, once | `done` |
| A decline | `response` event, `kind = decline:<id>` | The decline's `writes`, and its response content is delivered | `done` |
| The null path ("not now") | `response` event, `kind = null` | The null path's `writes` | `deferred`, if it has `reoffer` and offers remain; else `done` |
| A retract (one input) | `response` event, `kind = retract` | None; `retractQuietly` is delivered | `done` |
| A lapse, after the offer was exposed | No event; a `lapse` record entry | The lapse content is delivered | By `lapse.then`: `deferred` for `reoffer`, else `done` |
| A lapse, never exposed | A `missed` record entry | None | Back to `available`, with `attempt` + 1 |

A response is recorded once. A second answer to the same offer `Id` is ignored. The `response` atom (§2.6) reads these kinds.

**The first offer** also moves the seed (T9 to T11). For later offers, the graph decides what follows: links read the responses through `response` atoms. This is how ladders branch to their exits (Appendix A).

### 7.5 Stuck seeds

A `running` seed is **stuck** when all of the following hold:
- no beat is `available`, `running` or `deferred`;
- `end` is not yes;
- no `locked` beat has a link that could still be satisfied. A `because` link can still be satisfied only if its source isn't final, or its `on` reads something that can change: a fact, a role, a time, or a count;
- no clock can still fill, and no wake-up is pending.

The check is conservative: anything that could still change counts as "could". A stuck seed withers (T15). The lint warns, from the graph alone, about beats that no path reaches (L-44).

## 8. Deliveries and the arbiter

### 8.1 Deliveries

A **delivery** is anything layer 2 would present to V:
- an offer;
- a beat's content;
- a warning;
- a sign;
- a projection;
- a closing trace;
- coda content;
- news.

```ts
interface Delivery {
  id: Id;                              // stable: an offer Id, H("beat", seed, beat, n), or a sign or projection id
  seed: Id; beat?: BeatKey;
  timing: TimingRequest;               // resolved: class, channel and form filled in
  windowClose?: true;                  // it expires when the release window closes
  authored: boolean;                   // the seed's layer is authored
  pull: boolean;                       // V asked for it (e.g. V called the contact)
  atJoint: boolean;                    // news
  bindings: Record<RoleKey, Id>;       // the casts it was prepared with
  state: 'queued' | 'released' | 'displayed' | 'answered' | 'expired' | 'withdrawn';
  submitted: number;                   // play seconds
  provenance: { mode?: string; variant?: string; alternates: Record<BeatKey, FragmentId>; channel: ChannelId; form: string;
                why: Array<{ kind: 'schedule' | 'fit' | 'score' | 'phase'; beliefs: Id[]; delta: number }> };   // §8.8
}
```

A delivery's class is its channel's class: `0` is ambient (a trace, a sign, a background bark); `1` a map pin or journal line; `2` a message; `3` a call; `4` an approach. These follow dossier 7 §5.3. S5 maps channels to classes.

### 8.2 The play clock and session states

The arbiter runs on the **play clock:**
- seconds of unpaused play in the current session;
- it stops in menus, pause, photo mode and loading;
- it doesn't advance over sleep, waits or fast travel.

Its source is the game port (S5). It is session state and is not persisted. After a load it restarts at 0.

**Session states:**

| State | Entered | What passes | Left |
|---|---|---|---|
| `settling` | At a load | `pull` deliveries only | After `settle` play seconds **[tunable 90]** |
| `returning` | After settling, only when the save's age is 30 minutes or more (§8.7) | The return view's deliveries, class 1 or lower; class 0 deliveries | When the view's deliveries are released, or after 120 play seconds |
| `resituating` | After settling or returning | One cue of class 2 or lower: from the seed V was last attending, or, with none, one class-0 hook. Class 0 deliveries also pass | When that cue is released, or after 120 play seconds **[tunable]** |
| `normal` | After resituating | As §8.3 | — |

**Away** is an overlay, set and cleared by S5's away marker. While it is set, only classes 0 and 1 pass, whatever the state.

A session opens by orienting, not by hooking. It never opens with a class 3 or 4 push. The rest after a climax is S3's phase (§8.3, step 4).

**The session ledger.** The arbiter's release log and the seed records give a plain, local, per-session ledger:
- what was shown;
- what advanced;
- what closed;
- which rungs moved;
- the phase at quit.

P10's tools write it out. It is not part of the save.

### 8.3 The release step

The arbiter runs once a second of play:

1. **Expire.** A queued delivery that was never released expires when it has waited `maxWait`, or when it has `windowClose` and the release window closed. V saw nothing. Its seed applies `onExpire`:
   - `retry` re-submits it with `attempt` + 1;
   - `unattended` lets the world settle it (T14);
   - `withdraw` withdraws the seed (T1).
2. **Gates.** A delivery passes only if:

   | # | Gate | Class 0 | Pull | Others |
   |---|---|---|---|---|
   | 1 | No vanilla UI state is busy: dialogue, scene, menu, photo mode, loading, a vanilla call or banner (S5) | applies | applies | applies |
   | 2 | None of its forbidden attention aspects is active | applies | applies | applies |
   | 3 | The session state and the away overlay allow it (§8.2) | applies | applies | applies |
   | 4 | `spacing` play seconds since the last release **[tunable 60]** | — | — | applies |
   | 5 | Fewer than `cap` releases in the last `capWindow` **[tunable 2 per 600 s]** | — | — | applies |
   | 6 | Its category timer has run out **[tunable per category; default 300 s]** | — | — | applies |
   | 7 | For an `atJoint` delivery: a joint is **latched** (below) | applies | — | applies |

   Class-0 deliveries don't count towards spacing or the cap. At most one class-0 delivery is released per `class0Gap` **[tunable 20 s]**.

   **Joints.** A joint is latched when S3's phase hook reports one: arriving somewhere, resting, finishing a job, or asking. Without the hook, a joint is latched when V's combat and vehicle states are both clear. The latch stays set until an `atJoint` delivery is released, or V enters combat, a vehicle or dialogue.
3. **Tempo.** The player's tempo setting (S4) scales spacing and the cap:

   | Tempo | Effect |
   |---|---|
   | `calm` | `spacing` × 2 and `cap` × ½ |
   | `steady` | As set |
   | `restless` | `spacing` × ½ and `cap` × 2 |
   | `off` | Only `pull` deliveries, deliveries from authored seeds, and closing deliveries pass |

   Tempo changes cadence only. It never changes a unit's strength, stakes or content. S3 applies the rest of the tempo bundle (thread-opening rate, clock speed, lead times, promotion thresholds) with nested thresholds, so moving the dial never re-rolls the schedule ([dossier 8](../craft/d08-scale-threads-time.md) SES-07, S8-P4-19).
4. **Phase.** S3's phase hook MAY remove deliveries, for example keeping only rest cues during a rest phase. It can only remove; it never adds or reorders. With no director, nothing is removed.
5. **Score.** The built-in score is:
   - importance: high 3, normal 2, low 1;
   - plus the fraction of `maxWait` already waited;
   - plus 1 for authored deliveries.

   S3's scoring hook MAY add a delta, clamped to ±`scoreCap` **[tunable 1]**. The release log records both. With the director off or `noticing` off, the delta is 0. Ties go to the lower `H("arb", worldSeed, delivery.id)`.
6. **Prepare and release** the best delivery (§8.4). If preparation fails, try the next, up to `prepareTries` per step **[tunable 3]**. Release at most one delivery per step, plus at most one class-0 delivery.

**What the arbiter never does.** It holds, delays, expires and releases. It never creates or changes content.

**Retracting.** Every released push of class 2 or above can be **retracted by one input** (S5) for `retractWindow` seconds **[tunable 10]**. A retraction is a `retract` response (§7.4).

### 8.4 Prepare, then confirm

Releasing a delivery is two steps, so nothing invalid reaches V.

**Prepare.** The seed:
1. re-evaluates its windows. A delivery with `windowClose` needs the release window, or for a first release some window, to be `open`;
2. re-checks the casts the delivery binds: tentative casts against their effective `must`, committed ones by §5.5;
3. re-checks claims (§9.2);
4. for a first release: records the release window and the form, then commits (§5.3);
5. runs the fixed-part watch (§3.5) on everything installed in step 4.

**Confirm.** If every step passed, the delivery is `released` and handed to the game port.

**On failure,** the seed undoes step 4: it ends the edges and contributions it just added, and closes the frames it opened. All of these are history in the op log, but they were never in effect for V. The seed then applies the failure's policy:
- a closed window: T2 or T3;
- a lost cast: the role's ladder;
- a rejected fixed part: its `ifRejected`.

The delivery goes back to the seed, not to V.

### 8.5 Display and exposure

Release is not exposure.

**Exposure has three grades** ([dossier 13](../craft/d13-perception-curiosity.md#52-what-counts-as-displayed-channel-by-channel)):

| Grade | Meaning |
|---|---|
| `ambient` | It was there, but nothing shows V could have taken it in |
| `presented` | It was shown properly: uncovered, long enough to read or hear, with V able to look |
| `confirmed` | V engaged with it: opened, answered, replied, turned to it, tracked it, or acted on it |

**The display contract.** For each released delivery, S5 reports `DisplayReport { delivery, channel, grade, atPlay }`. It uses dossier 13's tests for each channel, held as a **data table** so P9 can recalibrate them without a code change. A channel S5 can't test reports `ambient` unless some input proves more. A delivery's grade is the highest it has reached. Raw values (distance, angle, speed, dwell) stay in the port and are never persisted.

**`displayed`** (§8.1) means:
- `confirmed`, for an offer;
- `presented` or better, for a sign, projection, warning or closing delivery.

- **The offer event.** Only once an offer is displayed is its `offer` event minted, with V as witness. This makes it canon and exposed (§10.2). It carries:
  - the delivery's skeleton `features` (verb, stake, relationship, outcome, tone, channel);
  - `class`, `purpose`, `pull`, `authored` and `deliveryId`.

  The `response` event carries its kind and the play seconds since display. The director's model is folded from these canon events alone (§8.8), so it doesn't depend on the capped seed record.
- **Never displayed.** How long a delivery has depends on its channel:
  - **Transient channels** (a toast, a bark, a trace in passing) are decided within the item's own life. One that earns only `ambient` is released again **once**, on a different channel, with `attempt` + 1. After that it counts as missed (§7.4).
  - **Persistent channels** (a message thread, a journal line, a shard, a pin) wait `displayTimeoutPersistent` play seconds **[tunable 600]**.

  An offer that lapses having been only `presented` counts as missed, not declined.
- **The cue.** The display record keeps `cue { place, speaker, object }`: the ids present when the delivery was shown. Callbacks use it to re-cue memory (§10.2).

Delivery state (`released`, `displayed`, `answered`) is persisted in the seed's state (§12.1). After a load:
- **Displayed, unanswered offers** stay answerable with the same `Id`. The game port re-presents them where the channel keeps them, such as a message thread. It never re-presents them as new.
- **Released, undisplayed deliveries** go back to `queued`.

### 8.6 Closing deliveries

The closing deliveries of §6.4 belong to a terminal seed, but they must still arrive. They are kept in the instance's state with stable ids:
- `H("close", seedId, kind)`, for the closing trace and coda content;
- `H("news", seedId)`, for news.

The terminal instance stays in the seed table until they are displayed, or until `closeExpiry` game seconds have passed **[tunable 3 game days]**. While it waits, it is not a demand root and holds no retention roots (§12.1). After a load, its closing deliveries are queued again.

### 8.7 The return view

**The save's age** is the wall-clock gap between the save's own timestamp and the load, read once from the save's metadata by the game port (S5). It is a session input. It is never stored in the record, and no predicate or wake-up reads it (S2-I-12). Nothing in the world advances while the game is closed.

**What the view shows,** by the save's age:

| Save age | Resume line | Waiting on you | Story so far |
|---|---|---|---|
| Under 30 minutes | — | — | Pull only |
| 30 minutes to 2 days | One line, to the seed V was last attending | — | Pull only |
| 2 to 14 days | Yes | Up to 3 open commitments, class 1, once | Pull only |
| Over 14 days | Yes | Yes | One dismissible offer, then pull |

The bucket bounds are **[tunable]**.

**How the deliveries are made.** They are `recap` deliveries, and pass in the `returning` state (§8.2). They are assembled from:
- the exposure ledger;
- `closure` entries;
- loose ends;
- V's recorded acts.

Each item cites a record entry, names an act, never a feeling, and gives the detail that tells it apart from similar ones. **Only exposed material appears:** the view never tells V something V wasn't shown, apart from the settled news §6.4 already queues. What it shows is recorded as displayed. It is offered once per load.

**Open offers.** Displayed, unanswered offers appear under "waiting on you" with their own `Id`. They stay answerable (S2-I-6) and are not pushed again. Their play-clock lapse restarts at the load; it never runs during a real-world absence.

**"Story so far"** is a pull entry that is always available, whatever the save's age.

**Staleness** uses `playTotal`: cumulative play seconds in this branch, stamped on record entries (§10.1). The session-relative play clock can't measure play across sessions.

### 8.8 The player model's boundary

The director (S3) keeps a model of V: beliefs held by the root actor `director` about `v` (S0 §11.3). It is folded from canon `offer` and `response` events (§8.5). Layer 2 fences it in. The model may **weight offers**; it never changes events, content or what anyone in the world knows ([dossier 12](../craft/d12-player-model-trust.md)).

**The model has no entrance into seeds.**
- No predicate, effect, cost, offer field, response template, variant selector or registry function reads or writes it (S2-I-13).
- Registry functions declare their read-set, and one that reads a `director → v` belief is rejected (L-57).
- `believes` can't name the director (L-56).

**Its only exits are these, each bounded:**

| Exit | Bound |
|---|---|
| The fitting hook | `fitWeight` clamped to ±`fitCap` (§3.4) |
| The scoring hook | A delta clamped to ±`scoreCap` (§8.3) |
| The phase hook | Removes only (§8.3) |
| The form hook | Chooses among a seed's declared forms (§2.13) |
| The joint hook | Reads game state only |
| V's inferred frames (S0 §10.4) | They focus attention; they pin nothing (S0 I-12) |

**Offers are frozen at display.** These are fixed by the document and the recorded draws at the first release:
- an offer's options and their order;
- costs, stakes and the null path;
- decline responses, defaults and wording.

`OfferSpec` has no field for adaptive order or emphasis. From `displayed` until `answered` or `expired`, no model-derived value reaches any hook concerning that delivery. Re-presenting it after a load uses the recorded release.

**Hook inputs are a closed list** (S2-I-14). A hook receives only:
- the delivery record: features, class, purpose, authored, pull;
- attention aspects;
- the session state;
- tempo;
- `playTotal`;
- the settings.

Nothing about quitting, menus, saving, idle time, session length, time of day or how often the player returns ever reaches a hook.

**The honest voice.**
- The narrator and the system never say what the game has noticed, tracked or concluded about V. Only NPCs, within D-22, and the settings voice may.
- A line that states a count ("third time this week") must read a `count` with `witnessedBy` set to the speaker (L-58).
- No rate, percentage, score or badge derived from the model appears on an offer or in the fiction (L-59).

**Why this?** Whenever a hook's output was non-zero, the delivery's `provenance.why` records it (§8.1). A pull entry renders it in the settings voice, from a closed table, citing only exposed events. A delivery whose cause includes a model belief is recorded as an **adaptation**, never as a consequence.

**Player settings for the model.** The settings are recorded as S0 `SettingsSet` ops, because they change what is offered:
- **`noticing`**: `off`, `acts` (the default) or `full`;
- an **exclusion list**;
- a **reset floor**: "start fresh" moves the floor, so the model folds only events after it.

The `setting` atom can't read these (L-61), so a seed's meaning never depends on them.

**Privacy.**
- Layer 2 stores no gaze, camera, menu, idle or input data.
- Exports and reports leave out `director → v` beliefs, and the belief lists inside why-records, by default.
- A save without the model loads normally; the model starts empty.

**Attribution lines must be correctable in fact** (extending D-22 and L-52).
- The NPC's belief must come from `observed` or `told` evidence.
- The template is chosen by the `believes` result alone, never by a hook.
- V's correcting reply must carry an effect that writes an observed telling, so the NPC's belief really revises (L-60).

**Timing purposes stay closed.** No purpose, category or `onExpire` may be keyed to return, retention, streaks or quitting. The lint checks pack-added purposes (L-59).

## 9. Intersections

### 9.1 Detection

Two live seeds A and B **intersect** when any of the following holds. Detection runs on casting and on re-evaluation:

| Kind | Condition |
|---|---|
| `claim` | A and B cast the same node, tentatively or committed, with overlapping claims that don't share |
| `effect` | An effect A declares writes a fact, or targets a node, that B reads in `needs`, a window, `context` or `depends` |
| `pressure` | The kernel emits a `Dilemma` whose two frames include a role goal frame of A and a frame from another origin |

**Claims.**
- **Spans.** A claim with span `seed` runs from the tentative cast until the seed ends. A claim with span `beats` runs only while a beat binding the role is `available` or `running`.
- **Sharing.** Claims overlap when their spans overlap. They don't conflict if both share `any`, or both share `background` and neither seed has a `foreground` beat binding the role live at the same time.

### 9.2 Settling

| Kind | Rule |
|---|---|
| `claim` | Claim priority, in order: (1) an authored seed beats a procedural one; (2) a committed cast beats a tentative one; (3) between equals, the earlier commit, then the lower seed `Id`. The loser treats the node as unavailable: a tentative loser re-casts; a committed loser treats the role as **lost** (§5.5). Nothing already shown is rewritten |
| `effect` | Nothing is blocked. B's `depends` decides: `keep` asks S3 to hold the dependency; `substitute` re-casts B's role; `notice` only records it |
| `pressure` | Never settled away. It is recorded and handed to S3 as story material ([DS-11](../design-seeds.md)) |

**Recording.** Each intersection writes a record entry on both seeds the first time it is found. An unchanged intersection is not recorded again; a change of outcome is.

## 10. The record and the exposure ledger

### 10.1 The seed record

Each instance keeps an append-only record. An entry is `{ n, at: GameTime, playTotal: number, kind, data, cause }`, where `playTotal` is cumulative play seconds in this branch (§8.7). `n` is the entry's stable number, unique within the instance and never reused.

The kinds:
- `transition`;
- `cast`;
- `commit`;
- `prepare-failed`;
- `release`;
- `display`: for traces, it also records the cause's source (`found`, `surfaced` or `constructed`) and the cause it cites (§2.15);
- `response`;
- `lapse`;
- `missed`;
- `beat`;
- `fixed-rejected`;
- `unfilled`;
- `lost`;
- `intersection`;
- `draw`;
- `expired`;
- `closure`;
- `stuck`;
- `rung`.

The record is capped at `recordMax` entries **[tunable 512]**. Past the cap, the oldest `draw`, `expired`, `missed` and `prepare-failed` entries are dropped first. The other kinds are kept. Dropping never renumbers: references by `n` (`growsFrom`, `looseEnds`) stay valid, and a reference to a dropped entry reads as "dropped".

### 10.2 The exposure ledger

The exposure ledger answers "was V shown this, and how surely?". It is derived, not stored. Each entry has a grade (§8.5):

| Source | Grade |
|---|---|
| V's own acts, and events V took part in | `confirmed` |
| Events V observed under the kernel's witness rule | `presented`, unless S5 reports higher |
| Deliveries | Their highest reported grade |

```ts
type ExposureGrade = 'ambient' | 'presented' | 'confirmed';
type ExposurePattern = { event?: EventPattern; fragment?: FragmentId; seed?: TemplateId | Id; delivery?: Id; since?: Duration;
                         atLeast?: ExposureGrade };   // default confirmed
```

`exposed(pattern)` is yes if any entry matches at `atLeast` or above, and no otherwise. After a load, the ledger is rebuilt from the kernel's canon events and the instances' delivery states.

**Uses:**
- a lapse counts as declined only if the offer was `confirmed` (§7.4);
- a hard step MAY require its portent to be exposed first, through `needs: { exposed: … }`;
- a warned failure fires only after its warning is `confirmed`, or after two `presented` warnings on different channels (§7.3);
- a callback may cite only exposed events (L-24).

**Callbacks:**

```ts
interface Callback { cites: ExposurePattern; atLeast: ExposureGrade; recue?: ContentRef }
```

- **`confirmed`** (the default) lets a line state the event as shared knowledge.
- **`presented`** allows only a **hedged** form from the S4 lexicon ("you may have seen…").
- **`ambient`** grounds nothing. A callback or irony beat that cites a lower grade than it declares, or a soft form without its hedge, is an error (L-62).
- **Re-cueing.** Memory is cue-driven, so a callback whose cited event is older than `recueAfter` play seconds **[tunable 600]**, or from an earlier session, fills its `recue` slot from the event's display cue: the place, speaker or object that was present. A callback without one is warned (L-64).
- **Channels.** A line may name the channel ("the message I sent you") only for `confirmed` entries.

## 11. Lint and the fit report

### 11.1 Lint

**Findings are for authors.** Each lint check declares:
- **`speed`:** `static`, checked from the document alone, or `sampled`, checked by running sample states;
- **`blocksReady`:** whether it stops a template from being marked `ready`;
- **its message:** a plain-English template from S4's lexicon;
- **a `fix`:** a machine-readable fix, where one exists.

Below `ready`, only checks that would break the engine refuse a seed in the lab. The rest are reported, and block only the step to `ready`. Profile checks (L-02, L-10, L-11, L-16) are worded against the profile's parameters, not its expansion.

**Source maps.** Profile expansion (§2.10) and the variant merge (§3.1) record, for each generated part, the parameter or field it came from. Every finding points at what the author wrote. The map is built at tool time; the stored `document` is unchanged.

**Placeholders.** A `ContentRef` of kind `todo` stands in for unwritten text. It is shown as a generated line from the fragment id and the cast, printed distinctly in every report and preview. It is allowed below `ready`, and is an error at `ready` (L-72).

The lint runs at compile time (§3.1), and on demand from authoring tools (S4, P10). An **error** refuses the seed. A **warning** is reported only.

| # | Check | Level |
|---|---|---|
| L-01 | A fact or role a predicate names isn't declared, or a game fact isn't in the facts table | error |
| L-02 | A seed changes a part its profile fixed | error |
| L-03 | A `then` link into a beat that isn't `texture`; or a seed with more than two beats whose links are all `then` | error |
| L-04 | The static count of beats that can be live at once exceeds `maxLive` | warning |
| L-05 | A route variable with no consumer | error |
| L-06 | A consequential choice whose actions don't write distinct values of one consumed fact | error |
| L-07 | A failure caused by distance, time or neglect without `warnFirst` | error |
| L-08 | A promise no beat's `leaves` can pay | warning |
| L-09 | A window with `coda` or `memory` and no `closeContent` | error |
| L-10 | A relationship ladder with fewer than three exits, or an exit with no content (Appendix A) | error |
| L-11 | An `intimate` scene filled by anything other than a human-authored pack scene, or without a fade alternative | error |
| L-12 | A game-fact write without the `story.write-vanilla` capability, or marked `resettable` | error |
| L-13 | A cycle among role references | error |
| L-14 | A decision beat with fewer than three stances, or none that is `refuse` | warning |
| L-15 | A stake on `v` not tied to an action V accepts | error |
| L-16 | A gate on a partner fact (a relationship rung that tests V's romance state elsewhere) | error |
| L-17 | Text naming a role attribute not guaranteed by the role's `must` or identity | error |
| L-18 | `standIn` on a role with a fixed identity, or with a `must` term outside the constructible subset (§5.4) | error |
| L-19 | A response template without `because` | error |
| L-20 | Text that states V's feelings, motives or reasons (lexicon, S4) | warning |
| L-21 | Second-person reproach or evaluation of V (lexicon, S4) | warning |
| L-22 | Guilt, streak or countdown mechanics: a `fn` atom or effect in S4's forbidden list | error |
| L-23 | A delayed consequence with no early cue: an aftermath with no `signposts` (error); at gig level or above, signposts of only one kind (warning) | error, warning |
| L-24 | A callback citing an event kind that can't be exposed | warning |
| L-26 | A conclusion with fewer than three clue routes | error |
| L-27 | An obstacle with fewer than two affordances, or none with `combat: false` | error |
| L-28 | A construct the game port's capability report says is unavailable: a channel, a capability, a write class | warning, in plain English |
| L-29 | A role that can't be cast in any of the sample states (run by the fit report) | warning |
| L-30 | A beat that isn't `texture` and leaves no fact | error |
| L-31 | A vignette with no `effect`, or a callback placed before the beat that carries the effect | warning |
| L-32 | A glance fragment with no `implies` or more than one; or whose `needs` is neither a recorded fact nor a cause labelled `constructed` within `latitude` | error |
| L-33 | A seed above glance level with no `turns`; a parent whose highest turn sits below a child's | error |
| L-34 | A front with no landmark, no local cost, no sign set, or street forms in fewer than two channel kinds | error |
| L-35 | A seed at gig level or above with no `closing` | error |
| L-36 | A clock with no sign, or no tick event kind that can be exposed | error |
| L-37 | A procedural arc with fewer than two found ancestors in its `growsFrom` chain | error |
| L-38 | A glance fragment with an `ask` that reaches no offer or why-trace within two steps | warning |
| L-39 | An offer's brief that needs earlier events: an `exposed` atom in its `needs`, unless the callback is marked `across` | warning |
| L-41 | A `decision`, `aftermath`, `conclusion` or `exit` beat with a `role` | error |
| L-42 | A fixed world requirement whose selector can match more than `watchMax` nodes | error |
| L-43 | A `relax` step on a term that guarantees a `textAttrs` attribute | error |
| L-44 | A beat no path from `start` reaches | warning |
| L-45 | A consequential offer whose actions declare identical costs, or none | warning |
| L-46 | A cost with `when: 'later'` and `shown: 'trace'` whose action's write no aftermath beat reads | error |
| L-47 | An `argues` entry with no carrier | warning |
| L-48 | A beat staging a turn (its `needs` reads a `turning` count) without both a witnessed and a told form | warning |
| L-49 | A trace whose cause is a pending event | error |
| L-50 | On a role with a fixed game identity: a turn or effect that changes a fact the game records, unless `authoredOnly` | error |
| L-51 | A `turning` kind in a pack with no declared consumer | error |
| L-52 | An attribution line without a `believes` need on that NPC, a `because` naming an observed act of V's, or a reply for V (§2.9) | error |
| L-53 | A premise sentence rendered more than once in a seed, or in a system voice (lexicon, S4) | warning |
| L-54 | An effect that can drop a `lasting` tie below an authored floor with no route back | warning |
| L-55 | A `cosmetic` effect without a carrier; or `remember: 'always'` with `resettable` | error |
| L-56 | A `believes` atom whose `who` can resolve to a root actor (`director`, `city`, `v`) | error |
| L-57 | A registry function whose read-set includes a `director → v` belief | error |
| L-58 | A line stating a count without a `count` atom `witnessedBy` the speaker | error |
| L-59 | A model-derived rate, percentage, score or badge on an offer or in fiction; or a timing purpose, category or `onExpire` keyed to return, retention, streaks or quitting | error |
| L-60 | An attribution line whose belief isn't `observed` or `told`, or whose correcting reply writes no observed telling | error |
| L-61 | A `setting` atom reading a model setting (`noticing`, exclusions, reset floor) | error |
| L-62 | A callback or irony beat citing a lower exposure grade than it declares, or a `presented` callback without its hedge | error |
| L-63 | A `mustReach` element whose routes are all transient or overheard | error |
| L-64 | A callback with no `recue` slot whose cited event is older than `recueAfter` | warning |
| L-65 | A divergent media or rumour fragment with no `counter` | error |
| L-66 | A correction fragment with no `because` | error |
| L-67 | A hook with no anchor, or a question that can't be written over exposed terms | warning |
| L-68 | More than one surprise beat per gig | warning |
| L-69 | Text over its channel's word budget, or a pulled thread whose first line doesn't carry the premise | warning |
| L-70 | A beat in a gig or arc that declares neither `instability` nor `tension` | warning |
| L-71 | Beats relying on beliefs nested more than 4 deep | warning |
| L-72 | A `todo` placeholder in a template marked `ready` | error |
| L-73 | A duplicate id inside a pack | error |
| L-74 | A `ContentRef`, role or fragment that doesn't resolve, or that was retired without a tombstone | error |
| L-75 | Two alternates of equal specificity that can both be eligible in a sample state | warning |
| L-76 | A text unit whose placeholder names a role or attribute the role doesn't guarantee (L-17, extended to parsed text) | error |
| L-77 | A procedural seed above `block` scale with fewer than two found ancestors and no authored flag (error); entities named above the declared stake scale (warning) | error, warning |
| L-78 | A beat whose effects' polarity disagrees with its declared tone | warning |
| L-79 | A lexicon term outside its speaker class, era or register | warning |
| L-80 | A forbidden register item: a real-world trademark, or a meta word in a diegetic channel | error |
| L-81 | A scene with no specific detail, or above the density cap | warning |
| L-82 | Text naming its own tone | warning |
| L-83 | A `success` outcome with no cost fact | warning |
| L-84 | Text before contact containing a `reveals` token; or a dread beat above `dreadMax` | error |
| L-85 | A faction or institution named in a front, gig or street form with no cost to residents | warning |
| L-86 | A fixer or client offer at gig level or above with no `withheld` and route | warning |
| L-87 | A media or rumour fragment with no outlet, or an outlet whose kind doesn't permit the channel | error |
| L-88 | A price outside its band | warning |
| L-89 | A deadline claimed in text or an offer with no clock or window | error |
| L-90 | An unregistered brand or product in text, unless marked `invented` | warning |
| L-91 | A wrongness trace without a confirmed baseline, or citing a pending cause | error |
| L-92 | A contrast glance with no resident witness treating it as ordinary | warning |
| L-93 | A content tag naming an unregistered class; or, at `ready`, a declared envelope that doesn't cover the compiled tags | error |
| L-94 | A fragment tagged at intensity 2 or 3 with no `implied` form, no `droppable` beat, and no `requires` on its seed | error |
| L-95 | A role that can bind a minor (or a person with no `ageClass`) in a victim, target or hostile position, or in a beat with a `sex.*` tag | error |
| L-96 | Retired in v0.11.1: procedural seeds may use any class within the player's ceilings | — |
| L-97 | A text unit or asset in an authored-source class without `authored: 'human'` and a named author | error |
| L-98 | An effect on V with a `sex.*` tag that isn't the effect of an accepted action | error |
| L-99 | An explicit scene whose source material isn't human-authored, that lacks a fade at its level, binds a non-adult, or is reached other than by an action V accepted | error |
| L-100 | An authored-only fragment and its `implied` or `fade` form leaving different facts | error |
| L-101 | A `mustReach`, window, item, economy or relationship-status predicate reading an intimacy fact | error |
| L-102 | A role's `must`, `prefer` or score reading a protected attribute without a declared, reviewed correlation | error |
| L-103 | A slur-lexicon hit in the system, narrator, news or template voice (error); in authored dialogue (warning, to review) | error, warning |
| L-104 | Menace descriptors on culture-coded asset tags | warning |
| L-105 | A violence template with a mental-illness precondition | error |
| L-106 | A sanction ladder with no rung at intensity 1 or below, or one that picks its top rung without reading the ceiling | error |
| L-107 | Age words beside sexual tags | warning |
| L-108 | Class-signal words in an untagged fragment | warning |
| L-109 | A pack person not marked `fictional` | error |
| L-110 | Successive `harm.asked` offers from one patron rising in intensity with no stated frame | warning |
| L-111 | A pack person with no `ageClass` | error |
| L-112 | An engine effect whose declared flash parameters exceed the general threshold | error |
| L-113 | A `coerced` person with no `coercer` role or means, or such a seed with no route for V to act or decline (error); erotic framing in an exploitation seed (warning) | error, warning |
| L-33 (extended) | A `turns[].what` reading anything of V's but beliefs held about V and V's recorded acts | error |

L-25 and L-40 were removed in v0.2 (§16). Their numbers are not reused.

### 11.2 The fit report

The fit report runs a seed against sample states without changing them, with fixed world seeds.

**Inputs:**
- the seed;
- a list of sample states (a saved kernel record, or a fixture);
- a world seed per sample;
- the director policy (`off` in the first implementation).

**Output, per sample:**

```ts
interface FitReport {
  verdict: 'fits' | 'waits' | 'no-fit';
  why?: string[];                      // plain reasons for waits and no-fit
  windows: Record<string, 'open' | 'pending' | 'closed'>;
  cast: Record<RoleKey, { node?: Id; standIn?: boolean; candidates: number; reasons: string[]; unfilled?: string }>;
  draws: Record<string, string>;       // mode, variant, alternates
  fixedRejected: string[];
  timing: { firstDelivery: TimingRequest; channel: ChannelId };
  exits: Array<{ beat: BeatKey; reachable: boolean; leadsTo: string }>;
  declinePreview: { response?: ContentRef; unattendedOutcome: EffectDecl[] };
  connectingMaterial: string[];        // what fitting would add (empty with the director off)
  argues: Array<{ premise: PremiseId; stance: string; carriers: BeatKey[] }>;   // the seed's rows of the argument profile
  plants: Array<{ promise: string; cause: 'found' | 'would-construct' | 'none'; earliestExposure?: BeatKey }>;
  turns: Array<{ who: RoleKey; kind: string; pressure: string }>;    // who could turn, and how much pressure it takes
}
```

**For the author's loop,** the report also gives:
- **`nearMiss`:** for each unfilled or thin role, how many candidates there would be if each `must` term were dropped, within the query budget;
- **`diffFrom`:** what changed against a previous report with the same inputs;
- **`pins`:** for each draw or cast, the author's source span and the `Part` to write to fix it;
- **`cost`:** text units written, missing and placeholder, and alternates;
- **`settings`:** the settings the sample ran under.

**A settings matrix.** The report's input MAY take several settings vectors from S4's registry, and returns a row per sample and vector. The first implementation runs the director off, with content tags on and off.

**Many worlds.** Because layer 2 is deterministic, a survey over many world seeds gives hit counts ("this seed fits in 41 of 200 worlds"). Every finding replays from one small file.

An author can pin any drawn or fitted choice back into the seed as fixed ([DS-43](../design-seeds.md)). The report shows the `Part` to paste.

## 12. Persistence

### 12.1 The seed table

Layer 2 persists through the kernel's `SeedRecord` (S0 §14.1; the reference model's `retention.ts`). At save time, the kernel writes a `SeedState` op for every record that changed since the parent save, carrying the whole record. A removed record is written as `null`.

There is one record per instance, and one **layer-2 global** record with the id `H("root", worldSeed, "layer2")`.

```ts
// SeedRecord.state for an instance
interface InstanceState {
  template: { pack?: string; id: TemplateId; version: number };
  source: { by: 'pack' | 'director' | 'plugin'; layer: Layer };
  document: Seed;                      // the expanded document (§1.2)
  state: SeedStateName; since: GameTime;
  releaseWindow?: string; form?: string;
  latches: string[];                   // closed windows
  roles: Record<RoleKey, {
    cast?: Id; standIn?: { kind: KindId; constraints: Predicate[] };
    committed: boolean; attempt: number;
    ladder: { cursor: number; relaxed: number[]; waitUntil?: GameTime };
  }>;
  facts: Record<FactKey, { pin?: Id }>;           // each seed fact's current pin (§2.5)
  beats: Record<BeatKey, { state: BeatState; since: GameTime; releases: number; offers: number }>;
  draws: Record<string, { value: string; attempt: number }>;
  consumed: Array<{ event: Id; at: GameTime }>;    // §2.14
  deliveries: Delivery[];              // not yet final, including closing deliveries
  wakeups: Array<{ clock: 'game'; at: GameTime; reason: string }>;
  record: RecordEntry[];               // §10.1
  nextEntry: number;
}

// SeedRecord.state for the layer-2 global record
interface GlobalState {
  fragmentUses: Record<FragmentId, { count: number; lastAt: GameTime; lastOffer: number }>;
  offerCount: number;                  // offers displayed in this branch, for minGap.offers
  playTotal: number;                   // cumulative play seconds in this branch, updated at each save
  notices: Id[];                       // one-time notices already shown in this branch (§12.2)
  sowing: Record<string, { instances: number; lastEnded?: GameTime; refused?: string }>;   // per pack and template
}
```

**`SeedRecord.nodes` and `actor`:**

| Instance | `nodes` | `actor` |
|---|---|---|
| Live | The seed node, its fact nodes, its cast nodes and its pending stand-in nodes | The seed node |
| Terminal, waiting for closing deliveries | `[]` | Omitted |
| Terminal, nothing pending | The record is kept for history with `nodes: []`; it may be compacted by S6 | Omitted |

So a terminal seed's history stays queryable, and it is neither a demand root nor a retention root.

**Kernel material.** What a seed writes to the kernel uses the kernel's own records:
- edges;
- pins;
- canon events;
- contributions it adds at run time;
- frames.

Contributions compiled at sowing from a pack template are rebuilt from the stored document on load, so they are not persisted separately.

### 12.2 Loading

After the kernel replays a save (S0 §14.3), layer 2:
1. rebuilds each instance from its record, re-installing the sowing contributions of live instances from their stored documents;
2. rebuilds the reverse index (§4.1) and the exposure ledger (§10.2);
3. resets delivery states as §8.5 says;
4. fires game-time wake-ups already past, in time order;
5. re-evaluates every live instance in `Id` order;
6. rebuilds the arbiter's queue from every queued delivery, in instance `Id` order, then delivery `Id` order;
7. builds the return view (§8.7) from the save's age.

**The load class.** The game port classifies each load by its save key: known, behind, foreign, unkeyed or damaged ([save identity](../../../knowledge/save-identity.md)). It passes the class, with the save's age, as a timestamped session input. Layer 2 uses the class for two things:
- **Notices.** A foreign or damaged save, or a pack compatibility change (§12.3), gets one plain `notice` delivery. Its id is `H("notice", kind, branch)`, recorded in the global record so each shows once per branch.
- **The return view.**

No predicate or policy reads the class.

Re-evaluation after a load is silent for the kernel. Its layer-2 transitions are real, and are written in the new epoch.

### 12.3 Pack updates

```ts
interface Migration { from: number[]; policy: 'continue' | 'withdraw' | 'migrate'; beatMap?: Record<BeatKey, BeatKey> }
```

A live instance runs on its stored document, so a newer template version changes nothing for it by default: `continue` means **continue the saved version's structure**.

The new template's `migrate` entry covering the instance's version can say otherwise:
- **`withdraw`** withdraws the instance (T1);
- **`migrate`** moves it to the new structure by `beatMap`. It is deferred in the first implementation (§0.3).

**Structure versions.** `structureHash` is the hash of the expanded document, excluding the contents of text units. `Seed.version` MUST rise exactly when the structure hash changes; the authoring tool enforces it. `Migration.from` names those versions. A text-only edit keeps the version, and reaches live instances as corrected wording.

**Ids are permanent.** A retired id leaves a **tombstone**, optionally naming its replacement (L-74).

**Content that vanishes under a live instance.** When a live instance's `ContentRef` no longer resolves:
- with a tombstone that names a replacement, the replacement is used;
- otherwise the fragment is unavailable. Its delivery is skipped with a `missing-content` record entry, and the stuck rule (§7.5) applies.

A pack compatibility `notice` (§12.2) is sent once per branch.

**A broken pack file** never takes down other packs. Its templates are refused, with plain findings; the rest load.

A **removed pack** withdraws its live instances (T1), because their content references can no longer resolve. Their committed pins and canon events stay: history is never undone (S0 §6.6).

## 13. Invariants

| # | Invariant |
|---|---|
| S2-I-1 | **Determinism.** The same inputs give identical casts, draws, transitions, delivery ids and records. The inputs are: the documents, the world seed, the kernel operations, V's responses, and the timestamped session inputs (play clock, attention aspects, UI states, display confirmations, settings) |
| S2-I-2 | **One door.** Every change a seed makes to the world is a kernel contribution, pin, edge, frame, belief or event whose cause chain leads to the seed, or a game-port write under a declared capability |
| S2-I-3 | **Nothing in effect until commit.** Sowing installs only the seed node, its fact nodes, its frames and its `sown` world requirements. Before the first confirmed release, nothing else the seed adds is ever in effect; anything a failed preparation added is ended at once (§8.4) |
| S2-I-4 | **Everything V perceives from a seed is released by the arbiter** |
| S2-I-5 | **Nothing is lost silently.** Every refusal, failed preparation, rejected fixed part, unfilled or lost role, expiry, miss, withering, withdrawal and stuck seed has a record entry |
| S2-I-6 | **Reload stability.** After loading a save, every instance is in the state it was saved in. A displayed offer has the same `Id` and is never shown as new. A pending closing delivery still arrives |
| S2-I-7 | **V is not owned.** No seed construct pins V's drives, states V's inner life, or spends V's resources without an accepted action |
| S2-I-8 | **Effects need yes.** No transition that changes the world or reaches V fires on `maybe`. Only cancellations may |
| S2-I-9 | **Final states are final:** terminal seeds, final beats, latched windows, recorded responses |
| S2-I-10 | **Authored before procedural** in every claim conflict |
| S2-I-11 | **Session independence.** No layer-2 draw, `Id`, wake-up order or tie-break reads the session epoch, a load count or the wall clock (S0 I-16). The only discriminator besides causes is `attempt` |
| S2-I-12 | **No wall clock.** Wake-ups run on game or play time only, and no predicate reads the wall clock. Real-world absence advances nothing; the save's age is read only by the return view |
| S2-I-13 | **The model has no entrance.** No seed construct reads or writes the director's model of V; it reaches layer 2 only through the bounded hooks of §8.8 |
| S2-I-14 | **Closed hook inputs.** Hooks receive only the inputs listed in §8.8 |

## 14. Fixtures

Every fixture uses `worldSeed = H("fixture", <id>)`, a fixture pack `xf.fixture`, the kernel's core schema plus §0.4, and the director off.

| # | Setup | Expected |
|---|---|---|
| SF-1 | **Kleene.** Evaluate `all`, `any` and `not` over every pair of `yes`, `no` and `maybe`. Then a `fact` atom with no reading, and a fact with `decidedBy` false and a reading of 0 | The strong Kleene tables. Both atoms read `maybe`. `not(fact = 1)` with the guard false is `maybe` |
| SF-2 | **Latch.** A window `closes: fact x = 1`. Readings `x = 1` at time 10 and `x = 0` at time 11 arrive in one batch, before the seed's work item runs | The window is `closed` and stays closed. The seed withers (T2) once |
| SF-3 | **Casting determinism.** A role over 50 candidate people, with two `prefer` terms. Cast twice from the same state, then once after an unrelated pin elsewhere | All three casts are the same node. The kernel revision is unchanged by casting |
| SF-4 | **Coupling.** As SF-3; raise a `prefer` term's strength from 1 to 3 | The cast changes only if the new score makes a different candidate win, checked from the recorded draw |
| SF-5 | **Claim, either order.** An authored seed A and a procedural seed P both want the same fixer, exclusive. Run once casting A first, and once casting P first and committing it | A casts the fixer both times. In the second run, P's role is lost and P re-casts or follows its ladder. Both records have one `claim` entry each |
| SF-6 | **Fixed part rejected on a mirrored slot.** An authored world requirement fixes a cast person's mirrored `place` to a bar. The game then reads the person elsewhere | At the next re-evaluation, the direct check fails. The seed is `withdrawn`, with a `fixed-rejected` entry. No kernel contradiction |
| SF-7 | **Scenario R1** ([Appendix A.3](#a3-reference-scenario-r1)). Facts: q112 not done; then q112 done, Takemura alive and allied | `waiting` (window `maybe`); then `cast`; release prepared and confirmed; display confirmed, so the offer event is minted with a deterministic `Id`; V declines at the first rung; the decline exit's content plays; `unattended`; then `resolved`, with closure status `abandoned` |
| SF-8 | **R1, closed by the point of no return.** As SF-7, but the point-of-no-return fact is set while `waiting` | `withered`. Its coda is a closing delivery that survives a save and load and is delivered once |
| SF-9 | **Reload with a displayed offer.** SF-7 up to the displayed offer. Save; load | The same state and offer `Id`. The offer is not presented as new. Its play-clock lapse restarts from the load. The arbiter settles for 90 s, then re-situates with one cue |
| SF-10 | **Arbiter gates.** Five class-2 pushes submitted at play time 0 in `normal`, spacing 60, cap 2 per 600 | Releases at 0 and 60; the third waits until 600 |
| SF-11 | **Tempo off.** A procedural push and an authored push, tempo `off` | Only the authored push is released |
| SF-12 | **Lint.** Three seeds: all-`then` links over four beats; a route variable without a consumer; a ladder with two exits | L-03, L-05 and L-10 errors; none is sown |
| SF-13 | **Pressure.** A Tyger Claw's family frame `protects` X. A seed casts the Claw in a role whose goal has `{ kill, X }` | One `pressure` intersection recorded on the seed, at commit. The seed is not blocked |
| SF-14 | **Stand-in.** A role with `onUnfilled: ['standIn']`, `must: [age range 30..40]`, and no candidates | No kernel change before release. At commit, a minted node `H("mint", seed, seed, "role:<key>")`, identical across two runs, with age in 30..40 |
| SF-15 | **Missed, not declined.** An offer released but never confirmed displayed, past `displayTimeout` | No `offer` event. By T11 the seed returns to `cast`, and the offer beat to `available`, with `attempt` + 1 |
| SF-16 | **Promise.** A seed whose `end` is yes while a promise is open | It stays `running` until `paidBy` is yes, then `resolved` with status `resolved` |
| SF-17 | **Scale lint.** An `arc` parent whose only turn is a `step`, with a child gig turning a `goal` | L-33 error; not sown |
| SF-18 | **Clock.** A 4-segment clock ticked by `kind: collector-visit` events, `fills: 1`. Mint three such canon events; save; load; mint one more | Value 3 before the save and after the load, then 4. Each matched field is pinned `committed`. Signs 1–3 are delivered once each, across the load. `onFull` becomes available once |
| SF-19 | **Resettable fact.** A `resettable` seed-fact write at game time t, `reset` 7 days | At t + 7 days the wake-up withdraws the pin, and the fact reads its `initial` |
| SF-20 | **Seed-fact rewrite.** Write `stage = 1`, then `stage = 2` | Reads 2. Exactly one current pin; the first is withdrawn and kept as history |
| SF-21 | **Settled news across a load.** A released gig is declined; its unattended plan resolves while V is in combat; save; load | One `seed-outcome` with `witnessed: false`. The news delivery survives the load and is released once, at the first latched joint |
| SF-22 | **Short form.** A gig with `texture` and `legwork` beats, a decision and an aftermath, run in form `short` | The texture and legwork beats are `skipped`, and the links through them pass. The decision and aftermath play |
| SF-23 | **Prepare fails.** A seed in `cast` whose tentative cast is killed while its delivery is queued | Preparation fails; nothing reaches V; no cast edge is in effect; the role's ladder runs |
| SF-24 | **Stuck.** A running seed whose only remaining beat links `because` a failed beat, on a seed fact nothing writes | `stuck` → `withered`, with a `stuck` record entry |
| SF-25 | **Attribution.** Three response templates marked `attribution`: one valid; one without a `believes` need; one without a reply for V | The first compiles. The other two fail L-52. At run time, the valid one plays only while the NPC's belief about V is yes |
| SF-27 | **Session perturbation.** Run SF-7 twice, with different epochs, play-clock offsets and wall clocks | Byte-identical records |
| SF-28 | **Recap from exposure only.** A save 20 days old, with one exposed closure and one closure V never saw | The view cites the exposed closure only (plus any settled news already queued) |
| SF-29 | **Cosmetic mark survives.** A `cosmetic` effect with a place carrier and durability of 5 game days is displayed; save; load | The mark is re-derived and shown when the place's district is active, until it expires |
| SF-30 | **Settings are lenses.** Change `memoryScale` after several exposures | Every exposure, pin and closure is unchanged |
| SF-31 | **Returning or not.** Load a save 3 days old, then quick-reload it | The first load enters `returning`; the quick reload doesn't |
| SF-32 | **`believes` firewall.** A seed whose `believes` atom names the director | L-56 error; not sown |
| SF-33 | **Frozen at display.** Change the model between an offer's display and V's answer | Nothing about the offer changes, and no hook concerning it sees the change |
| SF-34 | **Option invariance.** Release the same offer under two different model states | Identical options, order, costs and wording; only timing may differ |
| SF-35 | **Forbidden hook inputs.** Perturb session length, idle time, quit and save counts | Byte-identical hook outputs and records |
| SF-36 | **Correction.** An attribution line plays; V uses the correcting reply | The NPC's belief about V revises through an observed telling; the line no longer applies |
| SF-37 | **Model off.** `noticing: off` | `fitWeight` 0 and built-in scores: records byte-identical to a run with the director off, from the same state |
| SF-38 | **Grade progression.** A message offer is released, opened, then answered | Its grade goes from `presented` to `confirmed`; the `offer` event is minted only at `confirmed` |
| SF-39 | **Ambient callback.** A callback citing an event V saw only at `ambient` | L-62 error |
| SF-40 | **Soft callback.** A callback with `atLeast: presented` | It uses the hedged form |
| SF-41 | **Transient retry.** A toast that earns only `ambient` | Released once more, on another channel, with `attempt` + 1; then missed |
| SF-42 | **`mustReach`.** A `mustReach` beat whose only route is an overheard bark | L-63 error |
| SF-43 | **Re-cue.** A callback citing an event from an earlier session | Its `recue` slot is filled from the event's display cue |
| SF-44 | **Late cause refused.** A constructed cause that would contradict a `confirmed` event | Refused; the trace waits or is skipped |
| SF-45 | **Sign re-issue.** A sign that stays `ambient` | Re-issued at most `reissue` times, within the plant cap |
| SF-46 | **R1 in text form.** Parse the R1 seed's text form, print it, parse it again | Identical `Pred` trees. The seed is lint-clean at `ready`, and fits on the SF-7 and SF-8 states |
| SF-47 | **Maturity.** A `sketch` template with `sow: yes` in a player's game | Never sown. The lab sows it, and its placeholders appear in the fit report |
| SF-48 | **Tone lint block** ([dossier 17](../craft/d17-setting-tone.md) §12, renumbered). These seeds: (a) a procedural city-scale seed with one ancestor; (b) a `light` beat that kills a named NPC; (c) a faction's slang in another speaker's line; (d) a meta word in a banner; (e) a scene with no specific detail; (f) the word "ominously" | (a) L-77 error; (b) L-78; (c) L-79; (d) L-80 error; (e) L-81; (f) L-82. Each finding lists what it didn't check |
| SF-49 | **Dread guards.** A `reveals` token in a trace before contact; a dread beat above the player's setting | L-84 error; the beat plays its `implied` form |
| SF-50 | **Setting checks.** A corporation in a gig with no cost to residents; a deadline with no clock; a contrast glance with no resident witness; a wrongness trace after only one display of its routine | L-85, L-89 error, L-92, L-91 error |
| SF-51 | **Ceiling gate** (dossier 18, renumbered). A seed with a violence fragment at intensity 2 and an `implied` form; the player's ceiling 1; then the setting changed to 3 between prepare and release | At ceiling 1 the implied form plays; `provenance.gated` records it. After the change, release uses the new setting |
| SF-52 | **Lines.** Ceiling 0 for a class, over a hundred simulated game-years | No event of that class is ever minted; the kernel refuses any that is offered |
| SF-53 | **Floors.** A role that could bind a minor in a target position; a pack person with no `ageClass`; a pack person not marked fictional | L-95, L-111 and L-109 errors. At casting, a minor is never bound to a barred role |
| SF-54 | **Author-fill seam.** An authored-only explicit scene with its fade, in a pack; the same seed without the pack | With the pack and a permitting ceiling, the scene plays; otherwise the fade. Both leave the same facts, and the seed's later beats run identically |
| SF-55 | **Retract.** V retracts during a tagged beat | The implied form plays or the beat ends; a neutral `retracted` entry; no reoffer; no model event; the class added to `softExclusions` |
| SF-26 | **Constructed trace.** A trace with no found cause, `latitude` allowing `trace-cause`. S3's stub contributes a cause: an event at a stall. The trace is displayed; save; load | The `display` entry records `constructed`. The cause's fields are pinned `committed` at display, and resolve identically after the load |

## 15. Compromises and open items

| # | The design says | This specification does | Revisit when |
|---|---|---|---|
| C-S2-1 | Every choice uses the same mechanism as the kernel | Content choices use the kernel's draw arithmetic on layer-2 keys, not kernel slots, so `trace` doesn't cover them; the seed record does | A tool needs kernel `explain` on a content choice |
| C-S2-2 | Casting considers the whole city | Casting queries one scope with `limit: 'all'`; a query over the hard limits leaves the role unfilled (`too-broad`) | Large-scope roles become common |
| C-S2-3 | An ending is unreachable when nothing could lead to it | A conservative stuck check (§7.5): anything that could still change counts as able to | A seed is kept alive long after it has no way forward |
| C-S2-4 | Stand-ins satisfy any role | Only the constructible subset (§5.4) | Authors need stand-ins for richer roles |

**Open items:**
1. **Dossier 8.** v0.1 adopted 20 of its 22 P4 requirements. Tempo's nested schedule thresholds and attention as a derived view are S3's, as are thread budgets and push rates.
2. **Dossier 6's kernel gaps.** Settled in S0 v4 ([§20](kernel.md#20-version-4-additions)): two kernel additions, two clarifications, and four routes outside the kernel.
3. **The facts table's guards.** The table gains `decidedBy` for decision facts. That is data work under WP-12.
4. **Vocabularies.** S4 fixes the closed vocabularies, the honesty lexicon and the forbidden-mechanics list.
5. **Hooks.** S3 defines the fitting, form, phase, scoring and joint hooks used in §2.13, §3.4 and §8.3.
6. **The arbiter's split.** P7 decides how much of the gate logic runs in the game-side plugin, from the event feed's latency.
7. **Display confirmations.** Settled: three grades, and dossier 13's per-channel tests as a calibratable table (§8.5). S5 implements the tests; P9 calibrates them.
8. **Profiles.** Appendices for gig, job and heist, con, four-beat, front, testing arc and slide.
9. **Dossier 10.** v0.3 adopts all 23 of its S2 requirements. Its P5 list goes to S3: the change engine, premise audits, the plant planner, and canon-character limits (S10-P5-23).
10. **Dossier 11.** v0.4 adopts its S2 requirements except a reserved draw-key salt, which nothing needs yet. Its kernel requirements are in S0 v4.1 (§20 there). Its P5 list goes to S3. Its testing agenda (T11-01 to T11-21) feeds P9 and the first in-game session card.
11. **Dossier 12.** v0.5 adopts all 14 of its S2 requirements (§8.8). Its P5 list (22 requirements: the model as a fold over canon offers, the eight replay checks, the noticed page) goes to S3.
12. **Dossier 13.** v0.6 adopts all 15 of its S2 requirements. Its P5 list goes to S3; its P9 list (19 metrics) goes to P9. Its persistence rule stands: layer 2 keeps grades, channels, classes, cue ids, `playTotal` and `shownBeforeEffect`, and never raw test values, gaze, camera, speed, dwell or idle data.
13. **Dossier 14.** v0.7 adopts its S2 requirements (§2.16). Its 27 S1 requirements define much of the simulation layer and wait for P3. Its sifter-input volume goes to S3, its metrics M14-01 to M14-24 to P9, and its district inspector to P10. Its in-game session card starts by measuring the game-time ratio, which every S1 time constant depends on.
14. **Dossier 15.** v0.8 adopts its S2 requirements (§2.17). Its kernel requirements are S0 v4.3 (implicit edge types, deferred; the `aggregate` contract). Its S1 policies wait for P3; its metrics go to P9 and its inspectors to P10.
15. **Dossier 16.** v0.9 adopts its S2 requirements; extension slots wait past the first public pack (§0.3). Its pack-format requirements go to S4 and its tool requirements, including a minimal first tool XF Studio could host, to P10.
16. **Dossier 17.** v0.10 adopts its S2 requirements (§2.18); its fixtures are renumbered SF-48 to SF-50. Its typed setting registries go to S4, its world-data requirements (leaf-keyed dimensions, derived indices, faction presence, price level, a slow district variable, standing rumours) to S1, and its P5 and P9 lists to S3 and P9. Calibrating the tone lexicon needs a read-only extraction of the game's own text, a research-queue request for when usage allows.
17. **Dossier 18.** v0.11 adopts its S2 requirements (§2.19), with lints renumbered L-93 to L-113 and fixtures SF-51 to SF-55. One isn't adopted: "offers lapse by game time only" would undo the play-clock rule (§2.12), which keeps real-world absence from expiring offers. Its settings and pack declarations go to S4; its kernel requirements are S0 v4.4. Defaults decided by the coordinator: `harm.minor` defaults to 0, as in the base game; the four classes whose base-game default is unchecked start permissive, each with a check on the next in-game session card; and the hate floor covers only the system's own voices.

## 16. Review record

v0.3's additions from dossier 10 have not been reviewed. They will be reviewed with the layer-2 implementation's code review, by the fixtures.

### Round 1: GPT-6 Astra, extra-high effort, on v0.1

The review found 25 issues: 8 blockers and 17 important. All were adopted, in substance. Its simplifications were adopted too:
- only the ladder profile, in full;
- a conservative stuck check in place of the reachability search;
- promotion rungs left to S3, with no kernel slot;
- closure details in layer-2 records;
- one end predicate.

| Finding | Change |
|---|---|
| B-01 Seed facts weren't mutable under S0's pin rules; enduring pins ignore `valid.to` | One current pin per fact, withdrawn on rewrite; resettable via a wake-up (§2.5) |
| B-02 Persistence didn't match the kernel's `SeedRecord` | One whole-record state with document, deliveries and wake-ups; terminal records kept with no roots (§12.1) |
| B-03 Many conditions and deadlines couldn't wake a seed | Dependency collection for every predicate, guards included; a sowing watcher; wake-ups (§1.3, §4) |
| B-04 Offers after the first had no path | One response lifecycle for every offer beat (§7.4) |
| B-05 Release was treated as exposure | Release, display and exposure separated; offer events minted on display (§8.5) |
| B-06 The fixed-part watch assumed traces S0 doesn't give for mirrored slots | A direct check for mirrored targets; bounded selector expansion (§3.5) |
| B-07 Stand-ins broke read-only casting | Pending stand-ins until commit; a constructible subset (§5.4) |
| B-08 R1 needed invented profile semantics | Appendix A, the ladder profile in full, with R1 |
| B-09 Candidate filtering reversed claim priority | Claim priority applied while filtering; spans and sharing defined (§5.2, §9) |
| B-10 Validation came too late | Prepare, then confirm, with rollback (§8.4) |
| B-11 Ladders lacked durable progression | A persisted cursor, relaxed set and wait deadline; topological order; text guarantees protected (§5.1, §5.4) |
| B-12 Several windows disagreed with T3; `degrade` was undefined | The release window; a close-policy table (§2.7) |
| B-13 Beat transitions were incomplete | A beat transition table; failure order; one-time warnings (§7.1, §7.3) |
| B-14 Skips broke links; protected beats weren't protected; reachability was unsound | Skipped sources pass through; L-41; a stuck check (§7.1, §7.5) |
| B-15 Unattended resolution bypassed completion | Closure status from `end`; forced closures retire promises; L-40 removed (§6.4) |
| B-16 Closing deliveries were lost on reload | Persisted closing deliveries that outlive the seed (§8.6) |
| B-17 Background content bypassed the arbiter | Everything perceivable goes through it; a light path for class 0 (§7.3, §8.3) |
| B-18 Gates could stall or contradict session policy | A gate matrix; pulls skip timers; resituating capped at class 2; latched joints; away as an overlay (§8.2, §8.3) |
| B-19 Selection ignored some author constraints | Preferred identities scored; channels by ladder order; shared eligibility, counted per branch (§3.4, §5.2, §7.2) |
| B-20 Clocks read unpinned fields | Consumed events, with matched fields committed; once-only signs (§2.14) |
| B-21 Kernel material had no full lifecycle | Start and end for every item; NPC goal frames closed (§3.2) |
| B-22 `continue` could change a story's meaning | Instances run on their stored document (§1.2, §12.3) |
| B-23 Batched changes could skip a latch | `closes` evaluated at each change's time, in delivery order (§4.2) |
| B-24 Predicate gaps | L-25 and the `maybe` bypass removed; `since` and template reads defined; cancellations distinguished (§2.6) |
| B-25 Unbounded work and records | Work on the shared budget, with requeueing; stable entry numbers; intersections recorded once (§4.4, §9.2, §10.1) |

## Appendix A. The relationship ladder profile

### A.1 Parameters

```ts
interface LadderParams {
  with: RoleKey;                       // the other person; the role must have a fixed or preferred identity
  rungs: string[];                     // at least 2: e.g. acquainted, confided, close, partner
  offers: Record<string, { offer: FragmentRef; notNow: ContentRef }>;   // one per rung above the first
  exits: { decline: ContentRef; stay: ContentRef; lapse: ContentRef };  // three distinct exits, each with content (L-10)
  pacing: { acts: EventPattern[]; perRung: number };   // V's qualifying acts with the person before the next offer
  lapseAfter: Duration;                // game time with no qualifying act before the lapse exit
  absence?: { after: Duration; reunion: FragmentRef }; // on long absence: a reunion, not a reset
  intimate?: { scene: FragmentRef; fade: FragmentRef; contentTag: string };   // top rung only
  boundaries?: Array<{ fact: FactKey; set: number; by: BeatKey }>;   // persistent, authored-only
  reoffers?: number;                   // how many times a rung may be offered again after "not now"; default 2
}
```

### A.2 Expansion

For `n = rungs.length`, and rung index `i` from 0:

1. **Facts.**
   - `rung`: a route variable, initial 0, `lasting`. Its consumers are the offer beats and the end.
   - Each boundary fact: `authoredOnly`, `lasting`.
2. **Offer beats** `offer-i`, for `i = 1 … n−1`:
   - **Fragment.** `play: offers[rungs[i]].offer`, fixed. The fragment's `OfferSpec`:
     - has an `accept` action writing `rung = i`;
     - has a `stay` action writing `exit = 2` (stay as now);
     - has a decline, `decline`, writing `exit = 1`, with `exits.decline` as its response;
     - has a null path writing nothing, with `notNow` as its content;
     - lapses with `then: 'reoffer'`.
   - **Repeat offers:** `reoffer: { when: count(pacing.acts with the person, since offer-i) ≥ pacing.perRung, max: reoffers + 1 }`.
   - **Links.**
     - `offer-1` is in `start`.
     - `offer-i`, for `i > 1`, has `because offer-(i−1), on: (rung = i−1) and count(pacing.acts with the person, since offer-(i−1)) ≥ pacing.perRung`.
   - **Pacing** therefore counts V's acts with the person, never the clock.
3. **Exit beats,** all of kind `exit`, each leaving `exit` set:
   - `exit-decline`: `because` any offer beat, `on: response is decline:*`, `join: any`. Content `exits.decline`.
   - `exit-stay`: `because` any offer beat, `on: response is action:stay`, `join: any`. Content `exits.stay`.
   - `exit-lapse`: available when `since` the last `done` offer beat (or sowing) ≥ `lapseAfter`, and the count of qualifying acts in that span is 0. Content `exits.lapse`.

   The three are mutually `obstructedBy`, so at most one plays.
4. **Absence.** If `absence` is set: a texture beat `reunion`, available when V has had no qualifying act with the person for `absence.after`. It has `reoffer: { when: (same condition), max: unbounded }`, so it can recur. A reunion never lowers `rung`.
5. **Intimacy.** If `intimate` is set: a beat `intimate`, `because offer-(n−1), on: rung = n−1`. It plays `{ alternates: [scene, fade] }`:
   - `scene` applies when the player's content setting allows `contentTag`;
   - `fade` applies otherwise.

   Both are fixed. The scene's source material is human-authored (an `authoredSource` class), and it holds no choices (L-11).
6. **Boundaries.** Each boundary sets its fact from its authored beat `by`. Only authored beats may write it (`authoredOnly`). The engine never lowers or clears it.
7. **The end:** `rung = n−1` and every top-rung beat is final, or any exit beat is `done`.
8. **Turns:** `{ level: 'concern', what: rung changed }`.
9. **The unattended plan:** after `lapseAfter`, set `exit = 3`. The world doesn't invent a resolution for a relationship.
10. **Lint added:**
    - L-10: at least three exits, each with content;
    - L-11: intimacy;
    - L-16: no gate on a partner fact. No predicate in the expansion may read another relationship's facts.

### A.3 Reference scenario R1

The parameters for the [P4 §5](../p4-seeding-layer.md#5-reference-scenario-r1-in-this-language) seed:
- **`with`:** `takemura`, a role whose identity is fixed to the game's Takemura, with `anchor: true` and `onLost: withdraw`;
- **`rungs`:** acquainted, confided, close, partner;
- **`pacing`:** one shared activity per rung;
- **`lapseAfter`:** 14 game days;
- **`absence`:** after 7 game days, a reunion;
- **`intimate`:** set, with tag `romance-intimate`.

**The window:**
- `opens: { all: [ { decided: q112_takemura_dead }, { fact: q112_takemura_dead, op: eq, value: 0 }, { fact: q112_done, op: eq, value: 1 }, { role: takemura, p: <allied with V> } ] }`;
- `closes: fact q115_point_of_no_return eq 1`;
- `onClose: coda`.

**The place:** a `place` role, preferred (strength 2) quiet and in Japantown.

**Closing:** `pack:quiet-hour-closing`.

**Context:** `{ all: [ { fact: q115_point_of_no_return, op: eq, value: 0 }, { role: takemura, p: <in Night City> } ] }`: the seed makes sense only while the story hasn't passed the point of no return and Takemura is in the city.

**The window's coda:** `closeContent: pack:quiet-hour-coda`, a short message from Takemura that names what passed between them, by V's acts.

**Maturity:** `ready`. With these, R1 is lint-clean at `ready` (SF-46).

Expanding with §A.2 gives these beats:
- `offer-1` to `offer-3`;
- `exit-decline`, `exit-stay` and `exit-lapse`;
- `reunion`;
- `intimate`.

SF-7 and SF-8 run on this expansion.
