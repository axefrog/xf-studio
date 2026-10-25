# The pattern language

**Status:** design v0, 25 October 2026, for work package [WP16](../plan.md#82-work-packages). It settles the form of the composite's story patterns ([D-27](../decisions.md), [D-28](../decisions.md), [DS-70](../design-seeds.md)) and proposes the changes the specifications need (§13). It changes no specification: S0 to S3 stay as they are until a spec pass adopts what it wants from §13. The library written in this form is in [`patterns/`](patterns/), indexed on the [composite's page](README.md); the worked examples are on [their own page](worked-examples.md).

Where this page says "the protagonist", the specifications say `v` ([D-25](../decisions.md)).

**Read first:** [decisions](../decisions.md) D-03, D-07 to D-10 and D-25 to D-28; the [foundation](../foundation.md) §5 and §6; [DS-70](../design-seeds.md); [S2](../spec/seeding.md) §2 and §9; [S3](../spec/procedural.md) §6 and §7; the M3 [run 2 results](../../../projects/xf-story-engine/m3/run2/results.md).

## Contents

1. [Why a pattern language](#1-why-a-pattern-language)
2. [The idea in brief](#2-the-idea-in-brief)
3. [What a pattern is](#3-what-a-pattern-is)
4. [The abstraction range](#4-the-abstraction-range)
5. [Instances: one pattern read at two points](#5-instances-one-pattern-read-at-two-points)
6. [Matching](#6-matching)
7. [Composition](#7-composition)
8. [Fitting a juncture](#8-fitting-a-juncture)
9. [Legibility](#9-legibility)
10. [Cost and bounds](#10-cost-and-bounds)
11. [The mapping onto today's layers](#11-the-mapping-onto-todays-layers)
12. [Alternatives considered](#12-alternatives-considered)
13. [Proposed specification changes](#13-proposed-specification-changes)
14. [Measures for M3 iteration 3](#14-measures-for-m3-iteration-3)
15. [Break it yourself](#15-break-it-yourself)
16. [Open questions](#16-open-questions)
17. [Comparisons and credits](#17-comparisons-and-credits)

## 1. Why a pattern language

M3 showed what happens without one. Its hand-written kits each told one thing: an incident, then a request. In run 2 the engine's hooks beat the template baseline on every rater's forced choices, but they still read as single requests, the authored seed's offer read the same on every card, and the critics named "repeated menus" and "interchangeable names" as the giveaway ([run 2](../../../projects/xf-story-engine/m3/run2/results.md)). Each hook was a whole plot in miniature with people dropped into its slots. Nothing joined one hook to the next, so a week of play was a pile of errands, not a story.

The maintainer's direction asks for the opposite: stories that emerge from layered abstract plotlines whose every ingredient is cast from the live simulation (D-27), built from composable patterns rather than a catalogue of plots (D-28). The core intuition to develop is that **a story is a cascade of causes**, and that modelling a story means fitting each juncture of that cascade to something in the world that satisfies all the relationships the juncture requires.

## 2. The idea in brief

- **A pattern is a partial causal graph.** It names **junctures** (things that happen, or conditions that hold) and the **relationships** each must satisfy: who wronged whom, who owes, who knows, what caused what. It never fixes a sequence of scenes or a cast. Each juncture is a **function** applied to shared roles, such as `wrong(by: ?b, to: ?a)`, and anything in the world that satisfies the function fills it: a theft, a beating, a broken promise or an unpaid debt.
- **Template and formula are one structure.** Every part of a pattern can be fixed, preferred or open, as every part of a seed already can ([D-03](../decisions.md), [DS-42](../design-seeds.md)). A fully open pattern is an abstract tension; a pattern whose roles are fixed to named people and whose junctures are realised by written scenes is an authored story. The more that is open, the more the engine fills from the simulation, and the more freely the pattern composes.
- **One pattern, read at two points.** A live **instance** of a pattern has some junctures matched (the past, which the sifter finds in the record) and some open (the future, which the director can wait for, offer or nudge towards). Sifting and sowing become one operation over one pool.
- **Composition falls out of shared structure.** Patterns **chain** where one's outcome is another's cause, **layer** where two instances share a juncture, **grow** where small instances fill the junctures of a larger shape, and **refine** where a juncture is filled by a smaller pattern, opened only when it matters to the protagonist. That last rule is the world's level-of-detail rule ([D-07](../decisions.md): no atoms, every locality can be opened) applied to story.
- **Patterns generate seeds.** A seed (S2) stays the unit of delivery: a bounded piece of play that reaches the protagonist, with offers, beats, the arbiter and the exposure ledger. A juncture that must reach the protagonist is realised by sowing a seed; a juncture the world fills needs none. Every seed also has an implicit pattern, read from its beat graph, so an authored story can share junctures with procedural ones (§11).
- **An invisible cascade is no story.** Every pattern declares which junctures and causal edges the protagonist must be able to perceive, and the director never stacks a new cause on one the protagonist has not seen (§9).

## 3. What a pattern is

### 3.1 Roles

A pattern's **roles** are variables (`?a`, `?debtor`) that its junctures share. A role has a kind and, optionally, requirements on what may fill it.

| Kind | What fills it |
|---|---|
| `person` | A `core:person` node, residents included, by S0's nominal compatibility (S3 v0.4) |
| `group` | A `core:group` node: a gang, a crew, a family, a company ([D-08](../decisions.md)) |
| `actor` | A person or a group |
| `place` | A `core:place` node: a district, a cell, a venue, a stall |
| `item` | An `xf:item` node (proposed, §13 S1-4); a seed's stand-in until S1 models items |
| `fact` | A slot path on a node: what a belief can be about |
| `event` | A `core:event` node, `meta:story` events included |

Roles are where intersection happens. Two instances that bind the same person to roles are touching; two that bind the same event to junctures are layered (§7.2).

**The protagonist in a role.** The protagonist (`v`) may fill a role only where the role says `v: may`, and only through what the protagonist actually did or was offered ([D-09](../decisions.md)). No pattern assigns the protagonist a want, a belief or a feeling. A role whose junctures would harm the protagonist, or take from them, may bind the protagonist only through an offer the protagonist accepted, with the stake named in it ([S2 §2.9](../spec/seeding.md#29-offers-choices-responses-and-the-unattended-plan), L-15).

### 3.2 Junctures and functions

A **juncture** is one step of the cascade. It applies a **function** from the vocabulary to the pattern's roles:

```
paid:  repay(debtor: ?d, creditor: ?c)
```

A function has a **form**:
- an **event** happens at a time: a theft, a demand, a telling;
- a **state** holds over an interval: a debt, a secret, a protection arrangement, a grievance.

A juncture also says what it **requires** beyond its function (relationships among its roles, or with other junctures), what it **changes** in the world (§3.5), which **fillers** are acceptable (by default, anything the vocabulary says fills the function), and, while it is open, how it may come about (its **realisations**, §8).

### 3.3 The vocabulary: functions, links and relations

The functions are a small closed vocabulary, pack data like S4's other vocabularies. The full set, with what fills each one, is [`vocabulary.json`](vocabulary.json). There are 27:

| Group | Functions |
|---|---|
| Having and wanting | `hold`, `want`, `transfer` |
| Harm and help | `wrong`, `befall`, `help`, `sacrifice` |
| Obligation | `obligate`, `repay`, `ask`, `demand`, `comply`, `refuse` |
| Knowing | `learn`, `conceal`, `expose`, `blame` |
| Force and intent | `protect`, `threaten`, `pursue`, `decide` |
| Ties | `bind`, `sever`, `compete` |
| Change and choice | `turn`, `choose` |
| Composition | `story` (an instance of a named pattern reaching an outcome) |

**What fills a function is declared by the world's own vocabulary, not by the patterns.** Each event kind in the registry declares the functions it fills, with a mapping from its participant roles to the function's arguments (proposed, §13 S1-1):

```
theft:      wrong(by: aggressor, to: victim); transfer(from: victim, to: aggressor)
shakedown:  demand(by: aggressor, of: victim); comply(who: victim, to: aggressor); transfer(from: victim, to: aggressor); wrong(by: aggressor, to: victim)
tell:       learn(who: listener, what: subject)
```

States are filled by edges (a tie, a membership, a contract, a holder edge), by beliefs (`conceal`, `blame`), by context frames (`want` is a live goal or concern frame; `protect` is a frame with a `protects` interest), and by S1's group intentions (`pursue`, `decide`). So a new event kind in a pack fills the patterns it should the moment it declares what it fills, and no pattern has to name it. This is the same rule the project follows for game files: interpret the data the way the system does, with no adapter per source.

A function is about interests, not morals. `wrong(by, to)` means that `by` acted against an interest of `to`: a patrol arresting a thief fills `wrong(by: responder, to: target)`, which is exactly what the thief's crew will hold a grievance about.

**Links** are the causal edges' types (§3.4). **Relations** are the requirements a juncture or role may add, each a read over what the kernel or S1 already records: `tied`, `member`, `leads`, `hostile`, `knows`, `unaware`, `witnessed`, `public`, `trusts`, `standing`, `values`, `at`, `alive`, `distinct`, `known-to-protagonist`, `concerns` (a fact or event touches someone's frames), `graver` (one juncture's harm or stake scale is above another's), `irreversible`, `outcome-kind` (of a story event), `norm-gap` (S1's banded read), and `violates` (an effect that breaks an interest under the kernel's conflict table, [S0 §10.8](../spec/kernel.md#108-effects-and-cross-pressure)).

### 3.4 Causal edges

Edges carry the cascade. Each joins two junctures with a **link** that the world must bear out before the later juncture counts as matched:

| Link | Meaning | Test in the record |
|---|---|---|
| `because` | The later happened because of the earlier | The later filler's `causes` reach the earlier filler within 3 hops, or it `served` a frame whose `cause` chain reaches it |
| `motive` | The earlier gave the later's actor a reason | The later's actor holds (or held at the time) a frame or belief whose cause or evidence is the earlier filler |
| `enables` | The earlier made the later possible | The earlier is a state whose interval contains the later's time, or an event that created a relationship the later requires |
| `but` | The later obstructs what the earlier was for | The later's effect violates an interest of the frame the earlier served, under the conflict table |
| `reveals` | The later's actor learned of the earlier | The actor holds a belief whose evidence includes the earlier filler |
| `answers` | The later responds to the earlier | The later is a response, refusal or compliance whose cause is the earlier |
| `forecloses` | If the earlier happens, the later can no longer | Checked when the earlier matches: the later becomes foreclosed (§5.1) |

**The protagonist's acts.** Where the later juncture is filled by the protagonist's act, every link into it is tested as `answers`: the act responds to an offer or a delivery that cites the earlier filler. The engine never reads the protagonist's reasons ([D-09](../decisions.md)).

`because` and `but` are the "therefore" and "but" of [QST-01](../craft/d04-quest-structure.md): every beat after the first links to its predecessor by a recorded cause or a recorded obstacle. A link the record cannot bear out keeps the later juncture open. Only the director can supply a missing link, by constructing an unobserved cause within the pattern's latitude (§8.1); it never asserts one.

An edge may say `shown: must`: the protagonist must perceive both ends and a sign of the link before the instance counts as a thread, and before the director may push past it (§9).

### 3.5 What a juncture changes

Filling a juncture changes the world, and those changes are what later junctures, other instances and the people of the city react to:

| Change | Example |
|---|---|
| A function begins or ends | `obligate(?d, ?c)` ends when the debt is paid; `hold(?thief, ?pkg)` begins when the package is taken |
| A frame opens, is blocked, satisfied or abandoned | The wronged person's goal of redress opens; the courier's delivery goal is blocked |
| A tie moves up, down or ends | Trust between creditor and debtor rises with repayment |
| A standing moves | The stallholders' view of a vendor who refused the fee rises |
| A membership joins, strains or exits | A crew member who warned the target is cast out |
| A belief forms or is revised | The boss comes to believe the courier sold the package |

A juncture filled by the world already has these changes in the record (they are what made it match). A juncture realised by a seed must produce them through the seed's `leaves` and effects, and the lint checks that it does (§13 S2-1). The changes are also what keeps an instance honest: an outcome is only reached when its changes are recorded.

### 3.6 Outcomes, loose ends and negation

- **Outcomes** are a pattern's named end states, each a set of junctures reached (and, for some, others foreclosed). An outcome is `resolved`, `failed` or `parked`, and lists the patterns it typically hands over to: those are hints for authors and tests, not requirements, because the matcher finds the next pattern by function (§7.1). An outcome with `after` applies only once its junctures have held for that long with no other outcome reached: that is how a pattern says "and nothing came of it", such as a refusal no sanction answered.
- **Joins.** A juncture with several incoming edges needs all their sources matched before it is ready, unless it says `join: any`, as S2's beats do. Alternatives such as "a third party's act or plain bad luck" are two optional junctures joined with `any`.
- **Loose ends.** A juncture marked `park` that is still open when the instance closes becomes a loose end in the closure record ([S2 §6.4](../spec/seeding.md#64-closing-and-outcomes)), from which a later instance may grow ([GRW-07](../craft/d08-scale-threads-time.md)).
- **Negation.** `unless` names a juncture that, if it matches between two given junctures, kills the instance, as S3's patterns already do ([S3 §6.3](../spec/procedural.md#63-handling-an-emission)).
- **Time.** `within` bounds how long an instance may live between its first and last match, in game time.

### 3.7 The document

Patterns are pack data, read by a generic loader. Type notation as in the specifications:

```ts
type Var = `?${string}`;
type JunctureKey = string;
type PatternId = string;               // `<namespace>:<name>`, e.g. 'xf.composite:debt'
type RoleKind = 'person' | 'group' | 'actor' | 'place' | 'item' | 'fact' | 'event';
type FnId = string;                    // a function of the vocabulary
type RelId = string;                   // a relation of the vocabulary

interface Pattern {
  id: PatternId; version: number; type: 'pattern';
  family: 'tension' | 'turn' | 'closure' | 'shape';
  scale: 'situation' | 'step' | 'goal' | 'concern' | 'drive' | 'standing';   // the context level its outcomes turn (S2 §2.13)
  summary: string;                     // one sentence for authors and tools; never rendered to the player
  roles: Record<Var, PatternRole>;
  junctures: Record<JunctureKey, Juncture>;
  edges: CausalEdge[];
  entry: JunctureKey[];                // where an instance may start; each binds a person or a group
  outcomes: Record<string, Outcome>;
  unless?: Array<{ between: [JunctureKey, JunctureKey]; juncture: Juncture }>;
  within?: { clock: 'game'; days: number };
  once?: Var[];                        // a tombstone per binding set, as S3 §6.4
  show: { junctures: JunctureKey[]; edges: number };   // the least the protagonist must perceive (§9)
  escalation?: JunctureKey[];          // junctures that raise the stake scale; each passes the gate (§8.5)
  latitude?: { nudge: boolean; construct: boolean };   // default: both true for procedural use; authors narrow it
  links: { chains?: PatternId[]; layers?: PatternId[]; refines?: Record<JunctureKey, PatternId[]> };
  traces: string[];                    // principles, as '<dossier>.<id>', e.g. 'd04.QST-01'
  risks: Array<{ failure: string; note: string }>;   // failure-mode nodes of the composite, made specific
}

interface PatternRole {
  kind: RoleKind | RoleKind[];
  identity?: Part<Id | GameKey>;       // S2 §2.2: fixed, preferred or open; default open
  must?: RelReq[];
  prefer?: Array<{ r: RelReq; strength: 1 | 2 | 3 }>;
  v?: 'never' | 'may';                 // default 'never'
  note?: string;
}

interface Juncture {
  fn: FnId;
  args: Record<string, Var | JunctureKey>;
  form?: 'event' | 'state';            // default: the function's form
  requires?: RelReq[];
  changes?: Change[];
  fill?: Part<Filler[]>;               // default open: anything that fills `fn`
  realise?: Realisation[];             // how an open juncture may come about, in preference order (§8)
  v?: 'never' | 'offer';               // may the protagonist's act fill it? Only through an offer
  optional?: boolean;                  // may be skipped without failing the pattern
  park?: boolean;                      // still open at closing: becomes a loose end
  join?: 'all' | 'any';                // incoming edges: default all
  binds?: Record<Var | 'anyParticipant', Var>;   // a `story` juncture: the child pattern's roles that are this pattern's roles
}

type Filler =
  | { kinds: string[] } | { tags: string[] }               // event kinds, or kind tags
  | { seed: TemplateRef; by: BeatKey | 'end' }             // a beat of a seed (authored or kit)
  | { pattern: PatternId; outcome?: string };              // a child instance reaching an outcome (§7.4)

type Realisation =
  | { wait: true }                                         // the world may fill it (§8.2)
  | { offer: { kit?: TemplateRef } }                       // a seed that reaches the protagonist
  | { nudge: { kit?: TemplateRef } }                       // a world-only seed, on unobserved state only
  | { construct: true }                                    // a past juncture: generate, then justify
  | { refine: { pattern: PatternId; binds?: Record<Var, Var> } };   // a child instance; by default it shares roles of the same name

interface CausalEdge { from: JunctureKey; to: JunctureKey; link: LinkId; shown?: 'must' | 'should' }
type LinkId = 'because' | 'motive' | 'enables' | 'but' | 'reveals' | 'answers' | 'forecloses';
type RelReq = { rel: RelId; args: Array<Var | JunctureKey | string> } | { not: RelReq };
interface Outcome { reached: JunctureKey[]; foreclosed?: JunctureKey[]; after?: { clock: 'game'; days: number }; kind: 'resolved' | 'failed' | 'parked'; next?: PatternId[] }
```

`Change` takes the forms of §3.5. `Part` is S2's ([§2.2](../spec/seeding.md#22-binding-status)). The bounds: at most 8 junctures and 12 edges per pattern; an acyclic edge graph, not counting `forecloses` edges (two alternatives foreclose each other); and at least one entry juncture that binds a person or a group (a human at the centre, [TEL-06](../craft/d06-sifting-tellability.md)).

**Story junctures bind roles.** A juncture whose function is `story` is filled by a `meta:story` event of the named pattern, and its `binds` says which of the child's roles are which of this pattern's: in the [feud](patterns/shapes.json), `answered` binds the grievance's wronged party to `?g1` and its wrongdoer to `?g2`, and `countered` binds them the other way round. `anyParticipant` binds the first person among the story event's participants, for closures that accept a story of any pattern. Without a binding, a child instance would be a story about other people.

## 4. The abstraction range

### 4.1 Fixed, preferred and open, on every part

The same three binding states S2 uses for seeds apply to every part of a pattern:

| Part | Fixed | Preferred | Open (the default) |
|---|---|---|---|
| A role's identity | A named person, group or place (an author's character) | A weighted candidate | Cast from the simulation by the junctures' requirements |
| A role's requirements | `must` terms | `prefer` terms with a strength | None beyond the kind |
| A juncture's filler | A named beat of a named seed, or a named event kind | Kinds or seeds with a strength | Anything the vocabulary says fills the function |
| A juncture's realisations | Only the author's own seed | An ordered list | The default ladder of §8.1 |
| An edge's link | As written | — | — |
| Timing | A window predicate on the junctures (S2 §2.7) | A lead preference | Fitted |
| Latitude | No nudges, no constructed causes | — | Both allowed, within S2's latitude rules |

Edges are always as written: they are the pattern's meaning. A pattern that needs "something caused this, I don't mind what" writes `because` and leaves the filler open.

### 4.2 Three points on the range

**A fully abstract tension.** The [debt](patterns/tensions.json) pattern binds nothing. Any `obligate` state in the record (a loan, a favour returned late, a gang member's dues, a promise) can start an instance, and anything that fills `repay`, `wrong` or `demand` can advance it.

**A kit-level pattern.** The same debt with one role preferred and one juncture's realisation narrowed: "the creditor is preferably someone the protagonist has met; the demand, if the world doesn't make one, may be nudged through the creditor's call". This is what most procedural content looks like.

**An authored story.** R2, "The Friday Fee" ([r2.ts](../../../projects/xf-story-engine/reference/src/m3/r2.ts)), read as a pattern. It realises the [squeeze](patterns/tensions.json) tension with most parts fixed:

```
squeeze  (fixed realisations)
  ?pw   = the Tyger Claws of Kabuki          fixed
  ?col  = a collector, cast: member of ?pw   open (cast by R2's role query)
  ?wk   = a stallholder, cast: vendor role   open
  burden:  obligate(debtor: ?wk, creditor: ?pw)   filled by the world: the Friday fee norm
  rule:    demand(by: ?col, of: ?wk)              filled by the world: S1's shakedown or enf.fee.word
  strain:  want(who: ?wk, what: burden)           filled by the world: the norm's gap, which R2 reads
  asked:   ask(by: ?wk, of: protagonist)          fixed: R2's beat `ask`
  paid / refused / sanctioned                     fixed: R2's exits, each realising one juncture
```

Because R2's beats declare which junctures they realise (§13 S2-1), the collector's demand that R2 waits for is the same juncture a procedural [protection](patterns/tensions.json) instance can share (worked example 2). The authored story keeps every promise its author fixed; it simply becomes visible to the rest of the composite.

### 4.3 What keeps a pattern from becoming a template in disguise

A pattern that fixes too much is a whole plot again ([D-28](../decisions.md)). The pattern lint (§13 S4-1) reports an **abstraction index** for each pattern: the share of its roles, fillers and realisations left open. Procedural library patterns must keep every role open and at least half their fillers open. Authored patterns may fix anything, and the index is shown to the author as information, never enforced: a specific story is allowed to be specific. What the language protects is that even a fully fixed story still declares its junctures, so it can be matched, layered and grown from.

## 5. Instances: one pattern read at two points

### 5.1 Juncture states

An **instance** is one reading of a pattern against the world. Each of its junctures is in one state:

| State | Meaning |
|---|---|
| `open` | Not yet filled, and its predecessors are not all matched |
| `ready` | Not yet filled; every edge into it has its source matched, so it may be filled next |
| `pending` | A seed the director sowed, or a child instance, is working towards it |
| `matched` | Filled by a recorded event or a recorded state, and its incoming links are borne out |
| `refined` | Filled by a child instance that reached an outcome (§7.4) |
| `foreclosed` | Can no longer be filled: a `forecloses` edge fired, a bound person died, or an `unless` struck |
| `skipped` | Optional, and the instance closed without it |

The matched junctures are the instance's **past**: what the sifter found. The ready and pending ones are its **future**: what the director can wait for, offer or nudge towards. The same pool holds both, and the sower's candidates are instances with ready junctures, not only completed matches.

### 5.2 The lifecycle of an instance

| State | Meaning | Becomes |
|---|---|---|
| `forming` | Only entry junctures matched; not tellable yet | `live` when a second juncture matches with its link borne out, or when the instance touches someone the protagonist has met |
| `live` | Has a past and a future: a candidate for the director | `resolved`, `parked` or `lapsed` |
| `resolved` | An outcome was reached | Terminal; mints its `meta:story` event (§7.1) |
| `parked` | Closed with `park` junctures still open, by a parked outcome or by `within` running out after the instance was perceived | Terminal; its loose ends are registered |
| `lapsed` | Expired or foreclosed before the protagonist perceived anything of it | Terminal; leaves nothing but a tombstone if `once` |

An instance that the protagonist never perceived ends silently. One the protagonist did perceive always ends with a closing trace, even when it lapses, as S2 already requires of seeds ([S2 §6.4](../spec/seeding.md#64-closing-and-outcomes), [THR-12](../craft/d08-scale-threads-time.md)).

### 5.3 Identity, determinism and persistence

These follow S3's pool exactly ([§6.2](../spec/procedural.md#62-the-pool), [§9](../spec/procedural.md#9-persistence)), with the stage list replaced by a juncture map:

- **Identity.** An instance's `Id` is `H("inst", worldSeed, patternId, version, entryFiller)`, with `entryFiller` the `Id` of the event or state record that filled its first entry juncture. One occurrence starts at most one instance of a pattern.
- **Descriptors, not references.** An instance holds bindings, juncture states, filler ids, times and its legibility ledger (§9.1). Its filler events are retention roots of the layer-3 record, so the past it rests on cannot be forgotten while it is live.
- **Determinism.** Every choice the matcher makes is a pure function of the Change stream, the patterns and keyed draws; every choice the director makes is logged as S3's are ([§10](../spec/procedural.md#10-the-decision-log)).
- **Persistence.** The pool, its tombstones and each instance's ledger persist in the layer-3 record, inside S3's bounds (§10).

## 6. Matching

The matcher is S3's sifter ([§6](../spec/procedural.md#6-the-sifter)), generalised in three ways: junctures form a graph rather than a list of stages, a juncture may be a state as well as an event, and an instance is a candidate before it completes. Everything else (frames per pattern, the chronological buffer, the bounded pool, tombstones, the sweep, determinism) is kept as S3 specifies it.

### 6.1 Inputs and frames

- **Input.** The live Change stream, after S3's chronological buffer ([§6.1](../spec/procedural.md#61-frames-and-input)): events (S1's published and mirrored events, S2's offers, responses and seed outcomes, tie and social acts), edge Changes (ties, memberships, holder edges), frame Changes ([S0 v4](../spec/kernel.md#20-version-4-additions)), `Dilemma` emissions, and `meta:story` events. Beliefs reach the matcher through the events that form them (S1's `tell` and the `witness` policy), until beliefs are Changes themselves (S3 already notes this gap).
- **Frames.** One frame per pattern on the `director`, as S3 has. Its `reactsTo` carries one selector per distinct filler of every juncture, not only the first: the event kinds that fill the juncture's function (from the kinds' `fills` declarations), the edge types, frame Changes and Dilemmas. One frame per pattern keeps patterns from masking each other, for the reason S3 gives.
- **What the matcher ignores.** Contribution Changes; events whose creator is the `director`, except `meta:story` events, which patterns may match on purpose (§7.1).

### 6.2 Handling a Change

For the pattern that owns the frame, with `now` the Change's game time:

1. **Live instances first**, in creation order, from a snapshot taken before this Change:
   1. **Deadline.** If `now` is past `firstTime + within`, the instance ends (§6.4).
   2. **Duplicate.** If this occurrence already fills one of the instance's junctures, skip the instance.
   3. **Unless.** If an `unless` juncture between two matched junctures matches, the instance dies (§6.4).
   4. **Advance.** For each `ready` juncture, in key order: if the **fill test** succeeds and every incoming link tests yes (§6.3), the juncture is `matched`, its new bindings join the instance's, `forecloses` edges fire, the ready set is recomputed, and the outcomes are checked. **A Change fills at most one juncture of an instance**, with one bounded exception: an occurrence whose kind fills several functions may also fill the junctures its own match makes ready, each through a different function of its `fills` list (a paid shakedown is both the demand and the compliance). Links between junctures filled by the same occurrence hold by construction. A Change may also fill junctures of several instances: that is layering, and it is recorded (§7.2).
2. **Start.** For each entry juncture, try the fill test with no bindings. On success: apply the **relevance gate** (§10.2), compute the instance identity (§5.3), check tombstones and the pool bounds, and create the instance with that juncture matched. Then run the **state probe**: every state juncture whose arguments are now all bound is tested once by a bounded kernel read. A debt that existed before its demand is a legitimate past, and the probe finds it.
3. **States later.** A state juncture also matches when a later Change makes it true: an edge added, a frame opened, a belief-forming event.

**The fill test** for juncture `j`, a Change `c` and the instance's bindings:
1. `c`'s record fills `j.fn`: an event whose kind declares it, with its participant roles mapped to the function's arguments; or an edge, frame, belief-forming event or group intention that the function's state rules accept ([vocabulary](vocabulary.json)).
2. Every argument already bound equals the mapped participant. Every unbound argument binds if the participant's kind fits the role and the role's `must` terms are yes.
3. Every `requires` term is yes. A `maybe` counts as no, as in S3.
4. If `j.fill` is fixed, the filler is one it names. A preferred `fill` doesn't restrict matching: the world may fill a juncture in a way nobody preferred. Preferences steer only what the director realises.

### 6.3 Link tests

The links of §3.4 are tested when the later juncture is tried, against the recorded fillers of the matched earlier junctures. Cause walks follow recorded `causes` and frame `cause` chains, at most 3 hops each **[tunable]**.

When the fill test succeeds but a link fails, the juncture stays `ready` and the instance keeps the candidate as a **near miss** (at most two per instance, newest kept). A near miss is where generate-then-justify applies: if the missing link's intermediate step is unobserved and the pattern's latitude allows it, the director may construct that step (§8.1, `construct`), after which the link holds and the juncture matches. The director never asserts a link without a recorded step that bears it out.

### 6.4 Outcomes, foreclosure and ending

- **Outcomes** are checked after every match, in declaration order. The first whose `reached` junctures are all matched or refined, and whose `foreclosed` junctures are all foreclosed, ends the instance as `resolved`, or as `parked` if the outcome's kind is `parked`. An outcome with `after` is instead armed, and applies at the sweep once `after` has passed with no other outcome reached.
- **Foreclosure.** A matched juncture's `forecloses` edges foreclose their targets. A juncture whose acting role is bound to someone who has died is foreclosed. When no outcome is still reachable, the instance ends.
- **Ending without an outcome** (deadline, `unless`, nothing reachable): `parked` if the protagonist perceived any of it, with its `park` junctures registered as loose ends and a closing trace queued; otherwise `lapsed`, silently.
- **The sweep** runs at each simulation window boundary, as S3's does, and only reclaims storage.

## 7. Composition

Every composition is found by the matcher alone. There is no catalogue of which pattern joins which: the `links` a pattern lists are hints for authors, for the lint and for evaluation, and the matcher never reads them.

### 7.1 Chaining: one's outcome is another's cause

Two ways, both already in the record:
- **A shared outcome filler.** The juncture that ends one instance is the entry juncture of another. When a debt instance ends `broken`, its `defaulted` juncture was filled by a recorded `wrong`; that same record is what starts a [grievance](patterns/tensions.json) instance, whose entry is `wrong(by, to)`. No new mechanism is needed: it is the shared filler.
- **A story event.** When an instance resolves or parks, it mints a `meta:story` event, as S3's sifter does at completion ([§6.6](../spec/procedural.md#66-completion-and-hand-over)): participants are the bound roles, `causes` are the fillers of its matched junctures, and it carries its pattern and outcome (§13 S0-1). It fills the function `story(pattern, outcome)`. Closures and larger shapes match on these. This is the "composed patterns" capability S3 deferred, and the same idea as re-inserting a completed sifting pattern as a new event ([Lyu, Millard and Gibbins](../../../docs/community-credits.md#lyu-millard-and-gibbins-2025)).

**Bounds.** An instance never matches a story event of itself or of any instance in its own lineage, so chains are acyclic, and a lineage is at most 4 story events deep **[tunable]**. Chained instances belong to one thread (§11).

### 7.2 Layering: two instances share a juncture

When one filler fills junctures of two or more live instances, the instances are **layered** on it. Each records a `layer` entry naming the other and the juncture, and if seeds realise either instance, S2 records a `juncture` intersection on them (§13 S2-5).

A layer is only interesting when it is **cross-causal**: a later juncture of one instance is filled by something the other produced. The theft that is both "the package was taken" in an errand and "a crew shows its strength" in a rivalry is co-occurrence; the moment the rival crew's later retaliation is aimed at the person who lost the package, the layer has changed what happens. The director's collision feature counts only cross-causal layers (F-13, §8.4), and layers form only through relationships the record holds (ties, memberships, shared places), never through coincidences the director invents.

### 7.3 Growth: small instances fill a larger shape

A **shape** is a pattern whose junctures include `story` junctures (filled by an instance of a named pattern reaching an outcome) beside ordinary ones. When small instances resolve, their story events fill the shape's junctures, and a shape instance forms and advances like any other. A loose end (a parked juncture) can also be a shape's entry.

Growth follows the protagonist's attention, not the engine's ambition ([GRW-01](../craft/d08-scale-threads-time.md) to GRW-04, [DS-09](../design-seeds.md)):
- a shape instance becomes `live` only when at least two of its filled junctures were perceived by the protagonist, and the protagonist pulled at least one of them;
- an engine-grown arc needs at least two found ancestors in its lineage (S2's L-37);
- engine-grown shapes stay within the stake-scale cap of the dial.

So the four larger shapes in the library are never sown as units. They are recognised as the junctures fill, and only then does the director work on their open junctures.

### 7.4 Refinement: a juncture filled by a smaller pattern

A juncture whose realisations include `refine` may be filled by a child instance instead of a single event. The child shares the parent's bound roles through its argument map, and its outcome must produce the parent juncture's function and changes: the finer reading agrees with the coarser one, as the [foundation](../foundation.md#4-rules) requires of every refinement (rule 2).

**Refinement follows relevance.** When the juncture's people or place are at a fine tier for the protagonist (the protagonist is there, or its people are focal), the director may open a child; otherwise the juncture is filled coarsely, by the world or by a nudge, and told as news if at all. The package taken from a courier the protagonist has never met is one theft event in a rumour. The package taken from the protagonist is a child instance: a follower noticed, a confrontation staged as an obstacle with several ways out, and whatever the protagonist does there. Depth is at most 3 **[tunable]**, and children close with their parent.

### 7.5 Intersections

S2 §9 detects intersections between seeds: `claim` (two seeds hold one node), `effect` (one seed's effect is another's dependency) and `pressure` (a `Dilemma`). Under the pattern language they stay, with two changes:
- **`pressure` is an entry.** A `Dilemma` fills the entry juncture of [divided loyalty](patterns/tensions.json). S2 still never settles it away; the pattern is how it becomes material.
- **A new kind, `juncture`.** Two instances, or the seeds realising them, share a filler (§7.2).

Claim priority (authored first, then committed, then earlier, S2 §9.2) settles contests over a node between seeds that realise junctures of different instances. Between instances, the world settles contests: whichever filler the record holds first is the past, and the instances it contradicts have junctures foreclosed, with the record saying why. The [closing choice](patterns/turns.json) pattern names the case where one actor's choice forecloses junctures of other instances.

## 8. Fitting a juncture

Fitting a juncture means finding or making something in the world that satisfies all its relationships. It extends S3's fitting service ([§4](../spec/procedural.md#4-the-fitting-service)), which today only weighs layer 2's draws: the pattern language adds the realisations below, each through S3's two doors (sowing a seed, withdrawing an unseen one) and S2's existing latitude.

### 8.1 Where a filler comes from, in order of preference

| # | Source | What the director does | When |
|---|---|---|---|
| 1 | **Found** | Nothing: the matcher filled it from the record | Always first |
| 2 | **Wait** | Leaves the juncture `ready`; the matcher fills it when the world does | The default for every ready juncture |
| 3 | **Offer** | Sows a seed that reaches the protagonist; the protagonist's response, or the seed's unattended plan, fills the juncture | The juncture's actor asks the protagonist, or `v: offer`; the instance is linked to the protagonist (S3 gate 5) |
| 4 | **Nudge** | Sows a world-only seed that gives an actor a reason or an opportunity, or mints the act an actor's frame already wants | Unobserved state only (§8.2) |
| 5 | **Construct** | For a past step such as "how did the thief know?", contributes a constructed cause through S2's trace-cause latitude ([§2.15](../spec/seeding.md#215-traces-and-plants)) | Unobserved; checked against exposure and the protagonist's acts; pinned once shown ([GEN-06](../craft/d06-sifting-tellability.md), PAY-04, PAY-05) |
| 6 | **Refine** | Opens a child instance (§7.4) | The juncture is at a fine tier for the protagonist |

Found, waited and offered fills are **consequences**; nudged and constructed fills are **adaptations**, logged as such and never presented as consequences ([R5-23](../craft/d09-agency-consequence.md), AGY-42). The director takes at most one realisation per opportunity slot (S3 §5.9), across all instances.

### 8.2 What the director may nudge, and what it must wait for

[DS-05](../design-seeds.md): the director steers only through the unobserved, and pins whatever the protagonist could base a choice on.

- **It may nudge only unobserved state.** Every address a nudge pins or contributes to has no `observed` pin, contradicts no delivery that reached `presented`, and touches no fact an open offer's foresight rests on.
- **No puppets.** A nudge may give an actor a reason (a belief, through a telling that is itself caused; a goal frame opened by a recorded cause or by the actor's group) or an opportunity (a time, a place, an item within reach). It may mint the act itself only when the actor already holds a frame that wants it: a goal whose effects include the juncture's function on the bound target, or a group intention that serves it. Otherwise the act is the simulation's to produce, and the director waits.
- **It must wait for** anything the protagonist decides (§8.3); any act by an actor whose frames give no reason for it; and anything a group decides. Under [D-08](../decisions.md) a group's leadership decides through S1's `group.decide`, so the director can at most put information before the leadership, by a caused telling, and the group's own drive weights and hazard draw decide whether it acts.
- **It never** changes a matched juncture, removes a recorded event, overrides a filler the record already holds, or fills a juncture with the protagonist's feelings, motives or reasons.

A nudge is an S2 seed of a new form, with roles, goal frames, authored beliefs and edges, world requirements and minted events, and no delivery to the protagonist (§13 S2-4). Its lint checks the unobserved rule statically where it can, and layer 2 checks it again at commit.

### 8.3 The protagonist's junctures

- **Only the protagonist's own act fills them**: a response to an offer, an act the game reports, or a decline, a null path or a lapse, which fill the refusing side or the world's settling. Nothing is filled by assumption ([D-09](../decisions.md)).
- **So no pattern is a single path for the protagonist.** A pattern that offers the protagonist a juncture says, through its edges and outcomes, what becomes ready or foreclosed on each stance. The package thread (worked example 1) has a continuation for every stance at every offer, and in most of them nobody puts a price on anyone's head.
- **Harm or loss to the protagonist** happens only as an obstacle the protagonist faces with at least two affordances ([S2 §2.8](../spec/seeding.md#28-fragments-beats-and-links)), on a stake the protagonist accepted when it was named in an offer (L-15). The protagonist's response decides whether the juncture fills.
- **An NPC's belief about the protagonist** may fill a juncture (`blame(who: boss, of: protagonist)`), as [D-22](../decisions.md) allows: it is the NPC's own belief, formed from an observed act or a told account, and the protagonist has a way to correct it.

### 8.4 Choosing what to act on

At a live slot ([S3 §7.2](../spec/procedural.md#72-the-slot-procedure)) the candidates are completed matches, as today, and **live instances with a ready juncture that has a realisation other than wait**. S3's gates 1 to 10 apply, with gate 5 (the link to the protagonist) read per instance. Three gates are added:

| # | Gate | Why |
|---|---|---|
| 11 | **Legibility debt.** The instance holds at most one unshown edge out of a perceived juncture (§9.2) | Never stack an unseen cause on another |
| 12 | **Escalation.** An escalation juncture passes §8.5 | Escalation is earned |
| 13 | **Nudge legality.** A nudge passes §8.2 for every address it touches | DS-05 |

S3's features F-3, F-5, F-6 and F-11 stay. Four are added, kept raw in the decision log and banded as S3 bands the rest:

| # | Feature | Value |
|---|---|---|
| F-13 | Cross-causal layering | Cross-causal layers with instances the protagonist is aware of (§7.2) |
| F-14 | Known people at stake | Bound people the protagonist has met who are the target of an effect in the instance ([D-27](../decisions.md): what matters to the people the protagonist knows) |
| F-15 | Open leverage | Outcomes still reachable from the ready juncture: a juncture that can still go several ways is a live gap ([TEL-09](../craft/d06-sifting-tellability.md)) |
| F-16 | Legibility | Share of the instance's `show` edges already shown |

**Diversity** extends S3's `dup` term: besides recent patterns and places, it counts recent **thread skeletons** (§14.1). A candidate whose thread would continue a skeleton prefix the protagonist has recently seen is penalised. The band composite and the keyed draw are S3's.

The winning juncture is realised by the first legal entry of its `realise` list after `wait`, subject to the dial (at tempo `off` the sower offers and nudges nothing, while authored seeds' own realisations still play, [D-03](../decisions.md)), the stake-scale cap and claim priority.

### 8.5 The escalation gate

A pattern's `escalation` list names the junctures that raise the stake scale (person, crew, block, district) or the class of harm. The director may realise one by offer or nudge only when all five hold:

1. **Pull.** Since the previous rung, the protagonist pulled the thread: answered an offer in it, approached, scanned or spoke to one of its people, returned to its place, or asked about it ([GRW-01](../craft/d08-scale-threads-time.md), GRW-03, [DIR-39](../craft/d07-direction-pacing.md)). Pushes alone never climb a rung.
2. **Legibility.** The edge into the rung's cause is shown.
3. **A wanting actor.** The rung's actor has a frame or a group drive that wants it; for a group, S1's operative weight for the serving drive is at or above `θ_start`. Otherwise the director waits, and the world may never climb.
4. **A portent.** If the rung lands on something the protagonist cares about (someone they have met, a stake they hold), a portent reached `presented` first and the protagonist had time to answer ([AGY-23](../craft/d09-agency-consequence.md), DIR-41).
5. **Bounds.** The new scale is within the dial's cap (S3's `maxLevel`; engine-sown stakes at most `block`; bounded dooms, AGY-30) and the climax budget.

If any fails, the instance stays where it is and ends by one of its outcomes, or parks at `within` with a closing trace. **This is where the director decides how far a thread escalates:** rung by rung, on the protagonist's pull and the world's own wanting actors, never towards a target length. Most threads stop low. That is intended: most errands should stay errands, and the ones that grow are the ones the player leaned into.

## 9. Legibility

An invisible cascade is no story ([dossier 13](../craft/d13-perception-curiosity.md), [dossier 20](../craft/d20-staging-legibility.md)). The record may hold a perfect chain of causes, but if the protagonist saw one juncture of it, the player met an incident, not a story.

### 9.1 The legibility ledger

Each instance keeps a small ledger in the layer-3 record:
- for each matched juncture, the highest exposure grade the protagonist reached of its filler: from S2's exposure ledger (deliveries citing the filler), from `observed` pins on the event, or from the protagonist's own acts;
- for each edge, **shown** when both ends are at least `presented` and a **link sign** reached the protagonist: a delivery that cites both fillers (a telling that names the cause; a trace whose display records the cause it cites, [S2 §2.15](../spec/seeding.md#215-traces-and-plants)), the protagonist's own act being the cause ([PAY-12](../craft/d10-change-theme-payoff.md)), or a "why" answer the protagonist pulled that walked the edge.

### 9.2 Rules

- **A thread only when it shows.** An instance counts as a thread for the protagonist only when its `show` junctures reached `presented` and at least `show.edges` of its edges are shown. Until then it is world texture, which may still be told as a rumour.
- **Legibility debt of one.** The director never realises a juncture while the instance holds more than one unshown edge out of a juncture the protagonist perceived. It surfaces the cause first (a telling, a trace) or waits. The causes really exist; the director chooses only what to reveal and when ([DS-24](../design-seeds.md)).
- **Two signs.** A `shown: must` edge needs at least two independent signs of different kinds before it counts as shown ([STG-03](../craft/d20-staging-legibility.md), [NTC-11](../craft/d13-perception-curiosity.md), [DIR-46](../craft/d07-direction-pacing.md)).
- **What a choice needs must reach.** A juncture the protagonist needs in order to choose (an offer's stake, the identity of the person a package is for, when it changes the choice) needs a persistent route that can reach `confirmed` (S2's L-63, [DSP-11](../craft/d13-perception-curiosity.md)).
- **Name the act, once.** Where the cause is the protagonist's own act, the consequence names the act once, never a reason or a feeling ([AGY-33](../craft/d09-agency-consequence.md), AGY-35, AGY-37).
- **Three routes.** A conclusion the protagonist needs ("who took it", "who was it for") has at least three independent routes ([QST-19](../craft/d04-quest-structure.md), [FIT-23](../craft/d03-fitting-casting.md)).
- **Anchored hooks.** An open juncture used as a hook can be asked about in terms the protagonist has already met ([CUR-01](../craft/d13-perception-curiosity.md), CUR-02, S2's L-67).
- **Why answers** walk the instance's edges, cite only exposed events, give one or two causes, and never explain a live mystery away ([XPL-03](../craft/d20-staging-legibility.md), XPL-09, XPL-13).

## 10. Cost and bounds

### 10.1 Where the search could blow up

| Risk | Bound |
|---|---|
| Too many Changes to test | Each pattern sees only what its frame's interests select (S3 §6.1). S1 bounds the coarse stream at about ten Changes per game hour city-wide (P5 §6.1), and fine-tier items exist only in focus cells (S1 `scene.acts`) |
| Work per Change | One test per entry juncture, plus one per ready juncture of each live instance of that pattern: at most 8 × 32 per pattern, usually one or two per instance. Counted in the kernel's tick budget, as S3 counts its own |
| Generic entry functions (`wrong` fills every theft) | The relevance gate at start (§10.2); S3's per-pattern and total pool caps with eviction of the oldest `forming` instance; `once` tombstones. The lint warns when an entry juncture tests nothing but its function |
| Forking | None. A juncture takes the first filler that passes, and a Change fills at most one juncture of an instance. Alternatives a forking matcher would keep are lost, as in S3 |
| Finding layers | An index from bound node to live instances, read once per matched filler |
| State probes | One bounded read per state juncture, once its arguments are bound |
| Link tests | Cause walks of at most 3 hops over recorded `causes` and frame causes |
| Refinement | Depth at most 3; children count in the pool; opened only at a fine tier |
| Chaining | Story-event lineages at most 4 deep; no instance matches its own lineage |
| Shapes | At most 8 live shape instances **[tunable]**; live only on the protagonist's pull |
| The director | One realisation per slot; nudge legality and constructed causes computed only for the candidates actually tried (at most S3's `maxCandidateTries`) |
| Persistence | At most 256 instances of at most 8 junctures; retained fillers at most 256 × 8 event ids, inside S3's retention budget |

### 10.2 The relevance gate

An instance starts only if its entry filler:
1. involves the protagonist, or someone or somewhere the protagonist has perceived (exposure `presented` or better); or
2. lies in a cell at a fine tier for some root's focus (S1's `demanded(3)`); or
3. is group-level (the pattern's scale is `concern` or above and its entry roles are groups), so the city's feuds and squeezes can accumulate at the coarse tier from group events and intentions; or
4. is a story event or loose end of an instance the protagonist perceived (growth).

Everything else is world texture the matcher ignores. Off-screen stories therefore cost only what group-level events cost, and their junctures refine to people and places only when the protagonist comes near ([D-07](../decisions.md)).

## 11. The mapping onto today's layers

### 11.1 Seeds and patterns: patterns generate seeds

Three ways to join patterns to the seed language were weighed:

| Option | What it means | Verdict |
|---|---|---|
| **A. A seed is a composition of patterns** | The seed document contains patterns, and the seed's lifecycle owns them | **Rejected.** Most junctures of a cascade happen between other people, off-screen, and need no offer, arbiter or lifecycle; wrapping them in seeds would sow a seed for every possibility and lose the sifter's cheapness. A pattern instance also outlives any one seed (a grievance runs for weeks across several encounters). And the seed is the contract with the player (offers, exposure, closure), which world causality should not overload |
| **B. Patterns generate seeds** | A pattern instance is the story; a seed is one scene of it the protagonist plays or sees. Junctures realised by an offer or a nudge are seeds; junctures the world fills are not | **Chosen** |
| **C. A seed is a pattern instance** | One document: the beat graph is the pattern | **Partly adopted.** Every seed gets an implicit pattern read from its beat graph (§13 S2-2), so authored seeds share junctures. The documents stay distinct because a seed's graph is about the protagonist (offers, stances, exits) and a pattern's is about the world's causes, and S2's lint, exposure and closure rules depend on that. Revisit if authors find themselves writing both documents for one story |

Under option B an author has two ways in, and both are the same language at different points of the range: write a pattern whose roles are fixed and whose junctures are realised by the author's own seeds, or write a seed with `realises` naming library patterns (as R2 does in §4.2). A fully specific story, like reference scenario R1, is a seed whose implicit pattern is entirely fixed; the composite still sees its junctures.

### 11.2 Threads

A thread stays a view, never a type (S2 §2.13). Under the pattern language it is a connected component of instances and seeds, linked by:
- a seed realising a juncture of an instance;
- a chain: a shared outcome filler, or a story event (§7.1);
- a cross-causal layer (§7.2);
- a shared anchor cast, as S3 §5.7 already has.

The thread is the unit the director budgets (S3 §5.8) and the unit evaluation judges (§14).

### 11.3 What stays, what changes, what is new

| Layer | Stays | Changes | New |
|---|---|---|---|
| S0 kernel | All of it: events with `causes`, `served` and `outcome`; frames; `Dilemma`; beliefs; queries; retention | A `meta:story` event carries its pattern and outcome (S0-1); a `fills` contract for kinds (S0-2) | Nothing else: relations are registered reads |
| S1 simulation | Processes, events, groups, norms, ties | Kinds declare `fills` (S1-1); group pulses read functions (S1-2); seed-opened goals act through the simulation (S1-3); items (S1-4); tellings can carry plans (S1-5); leaders (S1-6); visible acts for intentions (S1-7); refusals as norm signals (S1-8); failed outcomes (S1-9) | |
| S2 seeding | The seed as the unit of delivery: casting, offers, beats, the arbiter, the exposure ledger, the lifecycle, the record, the lint, the fit report; the relationship ladder | `realises` (S2-1); implicit patterns (S2-2); `growsFrom` an instance (S2-3); the nudge form (S2-4); `juncture` intersections (S2-5); accepted offers mint promises (S2-6); loose ends name junctures (S2-7); job, heist, front and feud profiles become shapes (S2-8); kits declare `fills` (S2-9) | |
| S3 procedural | The director, pacing, budgets, the schedule, the fitter's weights, the slot procedure, the pool's mechanics, the decision log | Patterns as graphs (S3-1); instances as candidates (S3-2); composition (S3-3); realisations (S3-4); new features and skeleton diversity (S3-5); the thread view (S3-7) | The director's per-juncture decision, the escalation gate and the legibility ledger (S3-4, S3-6) |
| S4 packs | The pack format | Patterns, the vocabulary and kits' `fills` are pack data, with the pattern lint (S4-1) | |
| The composite (P1 §5) | Its node and edge types | | The `pattern` node type and three edge types (P1-1) |

## 12. Alternatives considered

The pattern form was tested against the main alternatives in the dossiers and in the field. Each gets something right, and most survive in a narrower role.

| Alternative | What it gets right | Why it is not the form | What is kept |
|---|---|---|---|
| **Whole-plot templates** (M3's kits; S2 seeds used as plots) | Reliable, legible, cheap to author; the authored seed rated best in both M3 runs | A long run reads as the same package recast with new people ([D-28](../decisions.md)); nothing composes; most become errands ([D-27](../decisions.md)) | The seed as the realisation of a juncture; specific authored stories |
| **Story grammars and function sequences** (folktale morphologies, arc catalogues) | A compact vocabulary of story functions | As generators they give formulaic sequences and know nothing of the world's causes ([QST-39](../craft/d04-quest-structure.md), [GEN-03](../craft/d06-sifting-tellability.md); lens L4 on Propp) | As recognisers, and as the idea behind the masked skeleton (§14) |
| **Online narrative planning** towards author goals | Finds new causal chains | Search over stories at run time is ruled out ([GEN-02](../craft/d06-sifting-tellability.md)); plans assume what the protagonist will do ([D-09](../decisions.md)) | Short bridging inside one juncture, depth at most 2, used by `construct` ([GEN-05](../craft/d06-sifting-tellability.md), [FIT-41](../craft/d03-fitting-casting.md)) |
| **Storylets alone** (content with preconditions and effects, chosen by salience) | Locally valid, composable through state; close to S2's fragments | Nothing above them makes a cascade: salience needs an arc check above it ([FIT-06](../craft/d03-fitting-casting.md)) | Patterns are that arc check; fragments and seeds stay the grain of realisation |
| **Completed-event sifting only** (S3's core) | Honest and cheap; tells only what happened | Past only: no lead time, no sowing, no growth ([SFT-04](../craft/d06-sifting-tellability.md), SFT-05) | The same matcher, with open junctures |
| **Simulation alone** (drama from drives, nothing selected) | The most emergence | The record is mostly banal ([SFT-02](../craft/d06-sifting-tellability.md)), and an unselected, unstaged cascade is invisible (Tale-Spin's lesson; [SFT-14](../craft/d06-sifting-tellability.md)) | The simulation is the source of fillers; patterns select and stage |
| **Affect-state graphs** (plot units) | Small units that overlap into complex plots: the same idea as layering | They model characters' feelings; the engine holds frames, goals and beliefs, and may model no feeling of the protagonist ([D-09](../decisions.md)) | Overlap as structure; junctures use frame status (satisfied, blocked, abandoned) where plot units use positive and negative states |
| **A drama manager that steers every partial match to completion** | Completes more stories | Loses the unauthored quality, and steering what the protagonist could see is the quantum ogre ([DS-05](../design-seeds.md)) | Nudges on unobserved state only, gated and logged as adaptations (§8.2) |

Choices inside the form, with the same test:

| Choice | Taken | Rejected, and why |
|---|---|---|
| Graph or ordered stages | A graph of junctures | Ordered stages can't say that a debt and a squeeze both enable a refusal, or that two causes run in parallel. A chain is the special case |
| What a juncture names | A function over a relation vocabulary | Event kinds per pattern: "B wronged A" must accept a theft, a beating and a broken promise, and lists per pattern grow into a catalogue that misses every new kind |
| Forking or first filler | First filler, as S3 | Forking (Winnow keeps the parent at each advance) finds more readings, at a pool cost that grows with every early event. Revisit if the harness shows missed stories (§16) |
| Pairwise chain declarations or matching | Matching by function and story event | A table of which pattern follows which is a second catalogue, and it rots |

## 13. Proposed specification changes

None of these is applied. Each names the specification it belongs to and why.

### S0 (kernel)

| # | Change | Reason |
|---|---|---|
| S0-1 | A `meta:story` event carries its pattern id, instance id and outcome, in a registered data slot allowed only on `meta:` kinds (events have no free payload today; S1 puts the norm and rung in kind names for that reason) | Chaining and growth by story event (§7.1, §7.3) |
| S0-2 | The event-kind registry contract gains `fills: Array<{ fn; args: Record<string, role> }>`, and state fillers are registered reads with declared dependencies | Fillers are declared by the world's vocabulary, and the matcher's interests stay incremental (§3.3, §6.1) |
| S0-3 | Forming or revising a belief emits a Change (or S1 always mints the forming event, which is the route S3 noted) | `learn`, `conceal` and `blame` junctures match without polling; S3 deferred belief clauses for this gap |

### S1 (simulation)

| # | Change | Reason |
|---|---|---|
| S1-1 | Every event kind declares the functions it fills; [`vocabulary.json`](vocabulary.json) has the mapping for M3's kinds | Fillers come from data, so new kinds fill patterns without any pattern naming them |
| S1-2 | Group pulses read functions, not named kinds: a `wrong` on a member pulses `care_of_members` and `retribution`, whatever kind filled it | Worked example 2: a shakedown or an enforcement beating of a member pulses nothing today, because pulses read only `assault` and `gang-clash` |
| S1-3 | A goal frame a seed opens on a cast person raises the matching kind's rate for that person through the offender term, so the act, if it comes, comes from the simulation | §8.2's "no puppets"; worked example 1 found that `wait` has little to wait for while individual goals are a later capability |
| S1-4 | A minimal `xf:item` kind with a time-varying `held-by` edge | `hold` and `transfer` need possession as a state (worked example 1) |
| S1-5 | A `tell` may have a recorded `promise` event as its subject, so knowledge of a plan spreads like any other news | Worked example 1: "how did they know about the delivery?" must be a world fact |
| S1-6 | Each group has a keyed leadership: one or more members drawn from its residents with membership role `leader`, persistent once observed | Worked example 1: "it was for a crime boss" needs a real person who leads; today `gang-leader` is assigned only by canon, and `group.decide` has no leaders' term |
| S1-7 | Every group intention produces at least one visible act kind (for `protect-members`, a presence at a member's place that fills `protect` and `help`) | Worked example 2: an active protection changes only an assault rate, so nothing the protagonist could see answers a threat to a member |
| S1-8 | A public refusal of a norm's demand that goes unsanctioned within a window is a norm signal of the opposite sign to enforcement | Worked example 2: today only enforcement signals, so a squeeze can never break and the uprising shape can't form ([NRM-04](../craft/d15-people-networks-order.md)) |
| S1-9 | Occurrences draw an `outcome` of `failed` or `prevented` (S0 events already carry it) from the victim's protection and the norm's state, and each kind declares what a failed outcome fills: a failed shakedown fills `refuse` | Worked example 2: a shakedown is always paid today, so `refuse` has no producer in the city |

### S2 (seeding)

| # | Change | Reason |
|---|---|---|
| S2-1 | `realises` on seeds: `Array<{ pattern; juncture; by: BeatKey \| 'end' \| 'unattended'; binds: Record<Var, RoleKey> }>`; the lint checks that the beat's leaves produce the juncture's function and changes | Authored stories join the composite (§4.2, D-28) |
| S2-2 | The compiler derives every seed's implicit pattern from its beat graph: beats become junctures with the functions their leaves fill, `because` links become edges, exits become outcomes | Seeds without `realises` still share junctures, and the skeleton measures cover authored content (§14) |
| S2-3 | `growsFrom` gains `{ instance: Id; juncture: JunctureKey }`, and the thread view includes instances | §11.2 |
| S2-4 | The **nudge** form: a seed with no delivery to the protagonist; roles with goal frames, authored beliefs and edges, world requirements and minted events. Lint: every write targets unobserved state and no role is on the spine; it counts against S1's betrayal budget when it turns someone; it closes silently | §8.2: today a seed can do nothing beyond casting without reaching the protagonist |
| S2-5 | §9 gains a `juncture` intersection kind; `pressure` intersections become pattern entries and are still never settled away | §7.2, §7.5 |
| S2-6 | Accepting an offer mints a `promise` event between the asker and the protagonist, with the plan's roles as participants (`promise` is already a kind S2 produces) | A plan becomes a world fact others can learn of (worked example 1) |
| S2-7 | Loose ends in the closure record name the instance and juncture they belong to | Growth from loose ends (§7.3) |
| S2-8 | The job and heist, front and feud profiles that §2.10 plans are written as shape patterns; the relationship ladder stays a profile | D-28: larger shapes are compositions, not units |
| S2-9 | A kit's `sowable` declaration gains `fills: FnId[]`, the functions it can realise | Kits are chosen per juncture function (§8) |

### S3 (procedural engine)

| # | Change | Reason |
|---|---|---|
| S3-1 | `SiftPattern` becomes the pattern form of §3.7: a graph of junctures, state junctures, and `Dilemma` and `meta:story` fillers. This lifts S3-L-7's refusal of dilemma, edge, belief and frame clauses. A first build can stop at events, edge and frame states, and 6 junctures | §3, §6 |
| S3-2 | Live instances with ready junctures are candidates; the single `telling` becomes per-juncture realisations | Telling before completion; lifts C-S3-12 (§5, §8) |
| S3-3 | Composed patterns: a `meta:story` event at resolution and at parking, matched by other patterns, acyclic and depth-bounded | Lifts C-S3-15 (§7.1) |
| S3-4 | The director's juncture realisation (offer, nudge, construct, refine) with gates 11 to 13 and the escalation gate | Lifts part of C-S3-3: fills by nudge and construction (§8) |
| S3-5 | Features F-13 to F-16, and skeleton diversity in the sower | §8.4; D-27's ranking by what matters to people the protagonist knows |
| S3-6 | The legibility ledger in the layer-3 record, read by gate 11, the escalation gate and the thread status | §9 |
| S3-7 | The thread view links instances, the seeds realising them, chains and cross-causal layers | Lifts C-S3-11 in part; threads are the unit of evaluation (§11.2, §14) |
| S3-8 | The decision log records each thread's skeleton tokens as they are perceived | §14 |

### S4 (packs) and P1 (the composite)

| # | Change | Reason |
|---|---|---|
| S4-1 | Patterns and the function vocabulary are pack data, with a pattern lint: an acyclic graph; at most 8 junctures and 12 edges; an entry binding a person or group; known functions and relations; every variable bound by some juncture; every juncture the protagonist can fill has a continuation for each stance; the abstraction index reported; procedural patterns keep their roles open | §3.7, §4.3, §8.3 |
| P1-1 | The composite gains a `pattern` node type and the edges `chains-to`, `layers-with` and `risks` (pattern to failure mode). Applied in this checkpoint, since P1 is a plan, not a specification | §17 and the [composite page](README.md) |

## 14. Measures for M3 iteration 3

D-28's test is the player's: a long run must not read as the same package of stories recast with new people. These measures detect that at thread level. Iteration 3 implements them.

### 14.1 The thread skeleton

A thread's **skeleton** is computed from what the protagonist perceived (exposure `presented` or better), in the order it was perceived. Each perceived juncture gives one **token**:

```
token = fn(mask, mask, …) [<link] [/stance]
```

- `fn` is the juncture's function;
- each argument is **masked**: `P` the protagonist; `K1`, `K2` people the protagonist had perceived before the thread began; `N1`, `N2` people first perceived in it; `G1` groups; `I1` items; `L1` places; numbered by first appearance in the thread. Every name, faction, place, item, price and wording is masked, so a feud with one gang and the same feud with another is one skeleton;
- `<link` is the type of the edge joining it to the earlier perceived juncture it follows from;
- `/stance` is the protagonist's stance class, where the protagonist's act filled the juncture (help, bargain, oppose, refuse, ignore).

The skeleton ends with `end:<outcome kind>/<closure pattern>`.

**Three levels**, after dossier 5's abstraction ladder ([M-13](../craft/d05-units-variety.md)):

| Level | What it keeps | Example |
|---|---|---|
| L1, shape | The patterns of the thread's instances, in order of first perception | `tension:debt › turn:escalation › closure:loss` |
| L2, cascade | The juncture tokens, masked, with link types | `obligate(N1,K1) · demand(K1,N1)<motive · ask(N1,P) · refuse(P)/refuse · wrong(K1,N1)<answers · end:failed/loss` |
| L3, surface | L2 plus effect classes, channels and the protagonist's stance at each offer | |

### 14.2 Repetition over a long run

Run at least 50 simulated play hours, or several simulated weeks, on several world seeds.

| # | Measure | How |
|---|---|---|
| R1 | **Recast rate** | Share of threads whose L2 skeleton lies within normalised edit distance δ of an earlier thread's in the same run. A substitution between tokens with the same function and link costs 0.5, any other 1, so that a recast with the roles shuffled still counts as near. δ **[calibrate]** (start 0.25). The headline measure |
| R2 | **Package size** | The smallest number of L2 clusters (single linkage at δ) covering 80 % of threads, and how it grows with play hours. D-28's failure is a curve that flattens near a small package |
| R3 | **Effective number of kinds** | The Hill number of order 2 over L1 and over L2 classes, per 10 play hours (dossier 5 [M-4](../craft/d05-units-variety.md)) |
| R4 | **Template rate** | Dossier 5's M-14 on the concatenated L2 token stream: the share of threads containing a mined template of length 3 to 6 repeated at least τ times |
| R5 | **Next-juncture predictability** | Dossier 5's M-16: an order-1 to order-3 model over L2 tokens within threads, trained on the run so far; bits per token at 5, 10, 20 and 50 threads, against a shuffled copy. Falling bits mean the grammar is being learned ([HAB-07](../craft/d13-perception-curiosity.md), [VAR-09](../craft/d05-units-variety.md)) |
| R6 | **Pooled templates** | Dossier 5's M-19: the share of world seeds whose runs contain each mined template ([VAR-30](../craft/d05-units-variety.md)) |
| R7 | **Errand share** | The share of threads whose L1 is a single [coveted](patterns/tensions.json) tension resolved by one offer ([D-27](../decisions.md): errands are a minority) |

**Baselines.** The same measures on run 2's hooks (each a one-juncture thread) and on decomposed authored side quests (dossier 5 §5.5). The engine is held to a margin from the authored baseline, not to an absolute number.

### 14.3 "Have you seen this story before?"

Raters read one run's thread summaries in play order, each a short account of what the protagonist perceived, with names varied as they were in play. For each they answer: new; it reminds me of number n; or it is the same story as number n with different people. Raters are fresh ([DS-25](../design-seeds.md)): the model panel first, then the maintainer's blind pass.

It complements the skeleton measures three ways:
1. **Calibration.** δ is set so that R1's near twins agree with the "same story" answers. A metric is a tripwire calibrated on people, not a target ([VAR-29](../craft/d05-units-variety.md)).
2. **Repetition the masks miss:** a recast at L3 or in wording ([VAR-28](../craft/d05-units-variety.md)).
3. **The opposite error:** skeletons that differ but read the same to people, which means the mask is too fine.

A free sorting task on 30 thread summaries (dossier 5 [M-1](../craft/d05-units-variety.md)) gives the second view.

### 14.4 Judging threads over a simulated week

**The unit is the thread** (§11.2), not the hook. For each thread the harness writes a timeline of what the protagonist perceived (deliveries, channels, play times), the off-screen outcomes told as news, and the decision log's split between consequences and adaptations.

| Per thread | Measure |
|---|---|
| Perceived junctures | How many reached `presented` |
| Legible-edge ratio | Shown edges over edges between perceived junctures: the engine's side of dossier 20's Tale-Spin gap ([M20-14](../craft/d20-staging-legibility.md)) |
| Cross-causal layers | §7.2 |
| The protagonist's acts | Offers answered, and the stances taken |
| Closure | The outcome kind and closure pattern; whether a closing trace reached `presented` ([RMB-02](../craft/d13-perception-curiosity.md)) |
| Growth | Loose ends that grew into a later instance |
| Nudge share | Adaptations over all fills among perceived junctures |
| Escalation | The rung reached, and whether every rung had pull |

Raters judge each thread, on 1 to 7: could you say why each thing happened (caused); at each point, could you tell what you could do (legible); do the people in it act for their own reasons; did it build to the right size and stop there; did it end or rest in a way that felt fair; and the question of §14.3. They also make a forced choice between paired threads from different arms.

**Week-level measures:** threads with at least three perceived junctures; the share of deliveries that belong to them; the share of threads about people the protagonist knows (F-14 above 0); the errand share (R7); R1 within the week, across seeds.

**Arms:**
- **E3**, the pattern engine;
- **E2**, run 2's kits;
- **A1**, random instance and juncture within the same gates;
- **A5**, the **whole-plot control**: the same library instantiated as fixed sequences, every juncture realised in order by nudge or offer, with no waiting, layering or growth. This is the form D-28 rules out, built from the same material;
- **A4**, the authored seed.

The decisive comparison for D-28 is E3 against A5: the same material, composed against replayed. A proposed done-when for iteration 3: E3 beats A5 and E2 on "caused" and on pull for threads, in every rater alone; E3's R1 is below A5's by a margin fixed before the run; the legible-edge ratio is at least 0.7 on threads with three or more perceived junctures; and the errand share is below one half.

## 15. Break it yourself

Ways this design could still produce repetitive or flat stories, after [P1 §2.6](../p1-research-method.md#26-try-to-break-the-result) and [DS-22](../design-seeds.md), with what catches each. The adversarial pass proper (P1 phase E) is still to run; this is the author's own attempt.

| # | Attack | How it gets through | What catches it |
|---|---|---|---|
| 1 | **A small working vocabulary.** Most threads reduce to `wrong → blame → wrong` | The library is broad, but the simulation fills a few functions far more often than others | R3 and R2 on L2; the sower's skeleton diversity term. Not prevented if S1's event mix stays narrow: then the fix is in S1's catalogue, not here |
| 2 | **One entry dominates.** Thefts are the commonest event, so every thread starts with a theft ([SFT-13](../craft/d06-sifting-tellability.md)) | Generic entries pass the relevance gate whenever the protagonist is near | The distribution of entry functions per run (R3 at the first token); pool caps and diversity on entry functions |
| 3 | **Decorative layering.** Two instances share a juncture and never affect each other, so the player reads two parallel stories | Co-occurrence is cheap | F-13 counts only cross-causal layers; the per-thread layer measure counts them separately |
| 4 | **Escalation always climbs** to the same top: every lost package ends in a bounty | A player who pulls every thread passes the pull test at every rung | The wanting-actor condition (a group's own drive weights and hazard draw decide); the distribution of rungs reached and of closure kinds; R5 on the "next turn" token |
| 5 | **Invisible cascades.** The record holds the chain; the player saw one link | Nudged junctures fill quickly, and tellings are missed | The legibility ledger and gate 11; the legible-edge ratio; raters' "caused" |
| 6 | **Puppet NPCs.** An interception appears because the director needed one | Until S1 has individual goals, nudges carry most open junctures | The nudge share; the no-puppet rule (§8.2); S1-3, S1-7 and S1-9. **Weak today**: worked examples 1 and 2 show how much rests on nudges until those land |
| 7 | **The quantum ogre.** The follower always turns up, whatever the protagonist did | Nudges on unobserved state can still steer every outcome the player can't see | The ogre audit ([AGY-05](../craft/d09-agency-consequence.md)): replay with alternative protagonist acts and compare which junctures still fill; the nudge share per thread |
| 8 | **Coincidence overload.** The thief is the vendor's cousin, who is the collector's brother | Layers through ties are legal, and dense foci make ties common | Layers only through recorded ties, never constructed ones; a rater question on contrivance; the count of shared roles per thread against the base rate of ties |
| 9 | **The same people in every thread.** The vendor everyone knows is in all of them | F-14 favours people the protagonist knows | Claims and the fitter's yield term; the promotion caps ([GRW-05](../craft/d08-scale-threads-time.md)); a cast concentration measure (Gini over people per thread) |
| 10 | **Starvation.** Abstract patterns rarely fill, so the engine falls back to errands | Requirements too strict for the record S1 produces ([FIT-07](../craft/d03-fitting-casting.md)) | Pool fill rates per pattern; R7, the errand share |
| 11 | **Templates in disguise.** Patterns written with everything fixed | An author, or a later library pass, over-specifies | The abstraction index in the lint (§4.3); R1 against A5 |
| 12 | **A learnable grammar.** After a few threads the player predicts "a stranger asks you to carry something, so it will be stolen" ([HAB-07](../craft/d13-perception-curiosity.md), [VAR-09](../craft/d05-units-variety.md)) | Each function has few realisations, and the same turns follow the same tensions | R5; a prediction task with raters (dossier 13 [M13-09](../craft/d13-perception-curiosity.md)); several outcomes per juncture, refinement at varying depth, closures that compete |
| 13 | **Words bring the template back.** Varied structure, one wording per function ([VAR-28](../craft/d05-units-variety.md)) | Kits per function are few at first | Dossier 5's M-18 text homogeneity; several phrasings per beat function (S2's rendering contract) |
| 14 | **Compliant and flat.** Every rule is met, every edge is shown, and nobody cares: the stakes belong to strangers | Legibility and variety are not stakes | F-3 and F-14 in ranking; the raters' pull question; [QST-21](../craft/d04-quest-structure.md)'s person-at-stake tag. **Only partly caught**: no measure here says a thread mattered |

What the attempt found: attacks 6 and 14 are the weakest. The first depends on S1 giving people goals of their own; the second has no measure that a thread mattered to the player beyond raters' answers, which is the case for P1's adversarial pass to press.

## 16. Open questions

1. **Is the vocabulary the right size?** 27 functions. A test: two people tag a sample of decomposed quests' beats (the P2 corpus) with functions, and agreement is measured, as dossier 4 proposes for purposes ([QST-04](../craft/d04-quest-structure.md)).
2. **What does the first-filler rule lose?** Run a forking matcher offline on a harness week and count the stories it finds that the bounded one misses.
3. **What nudge share reads as authored?** Too many nudges is the ogre; too few starves the world. Set it from the ogre audit and the raters' "caused".
4. **How much of iteration 3 depends on S1's changes?** Without individual goals, visible group acts and failed outcomes (S1-3, S1-7, S1-9), waits are thin and most open junctures are nudges. Iteration 3 could ship with S1-3's rate boost and S1-9 alone and measure the nudge share.
5. **Should shapes be patterns at all,** or only recognisers ([QST-39](../craft/d04-quest-structure.md))? They are patterns here so that their open junctures can be worked on, and they are never sown as units. If they start to behave like templates (R1 against A5), demote them to recognisers.
6. **Kits per function.** How many realisations each function needs before the text layer stops repeating (attack 13), and who writes them.
7. **Premises.** Patterns could carry a stance on a pack's premise (S2 §2.3); a squeeze argues something about protection as a market. Left for when premises are used.
8. **Belief Changes** (S0-3): kernel Change or S1 event. Either works for the matcher.

## 17. Comparisons and credits

The pattern language is the project's own design: it develops DS-70 and the foundation's model of context, relevance, groups and perspectives, which are first-party ([D-21](../decisions.md)). Outside work appears here as comparison, credited in the [community credits](../../../docs/community-credits.md) for what it taught:
- the form of a pattern language, patterns at many scales each pointing to those above and below it: [Christopher Alexander and colleagues](../../../docs/community-credits.md#christopher-alexander-and-colleagues);
- staged incremental matching with partial matches and negation between bound events: [Kreminski et al.](../../../docs/community-credits.md#kreminski-et-al-2019-2021) (Winnow);
- composing sifting patterns by re-inserting a completed match as an event: [Lyu, Millard and Gibbins](../../../docs/community-credits.md#lyu-millard-and-gibbins-2025);
- overlapping units as the structure of a plot: [Lehnert](../../../docs/community-credits.md#lehnert-1981);
- story functions defined apart from the characters who perform them, the idea behind masking a thread's skeleton: [Propp](../../../docs/community-credits.md#vladimir-propp);
- a job as a script whose stages need actors, props and places, with swappable scenes: [Cornish](../../../docs/community-credits.md#cornish-1994).
