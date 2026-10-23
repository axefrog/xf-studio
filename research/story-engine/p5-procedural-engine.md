# P5. The procedural engine

**Status:** design v0.1, 23 October 2026. v0.1 aligns the draft with S2 v1.0: the player model ranks and defers formed offers only, fitting reads the world only, and the first implementation follows S2's core. This is second-level plan P5 of the [first-level plan](plan.md#5-second-level-plans), the design stage for layer 3. The normative specification, S3, follows from it. It builds on:
- the [foundation](foundation.md), especially [§5](foundation.md#5-context-and-relevance) and [§6](foundation.md#6-story-in-the-same-space);
- the kernel specification [S0 v4.5](spec/kernel.md);
- the seeding layer: [P4](p4-seeding-layer.md) and [S2 v1.0](spec/seeding.md), which calls S3 through named hooks;
- the procedural-engine requirement lists of dossiers [6](craft/d06-sifting-tellability.md#11-requirements-for-the-procedural-engine-p5), [7](craft/d07-direction-pacing.md#9-requirements-for-the-procedural-engine-p5), [8](craft/d08-scale-threads-time.md#10-requirements-for-the-procedural-engine-p5), [9](craft/d09-agency-consequence.md#111-procedural-engine-p5), [10](craft/d10-change-theme-payoff.md#112-the-procedural-engine-p5), [11](craft/d11-saves-memory-forgetting.md#113-p5-the-procedural-engine), [12](craft/d12-player-model-trust.md#122-p5s3-the-director), [13](craft/d13-perception-curiosity.md#122-p5s3-the-director-and-scheduler), [14](craft/d14-city-events.md#113-s2-p5-and-p9), [15](craft/d15-people-networks-order.md#113-s2-p5-and-p9) and [17](craft/d17-setting-tone.md#134-p5-and-p9-the-director-and-evaluation), plus the director rows of dossiers 1, 2, 3, 5 and 20. Each is traced in [§14](#14-requirements-trace).

It absorbs design seeds DS-01, DS-05, DS-09, DS-10, DS-11, DS-19, DS-24, DS-29, DS-36, DS-37, DS-41, DS-56, DS-61, DS-62 and the layer-3 half of DS-69.

**How to read it.** This page says what layer 3 is, why it is shaped this way and how it meets the other layers. S3 will say exactly how. Numbers are the dossiers' starting values, marked **[tunable]**. They live in pack settings data, never in code, and the evaluation work moves them. Where this page and a dossier differ, this page wins, and [§9](#9-where-the-dossiers-disagree) says why.

## 1. What layer 3 is

Layer 3 is the narrative intelligence. It has two roles ([D-02](decisions.md), [D-03](decisions.md)):
- **Sowing** is proactive. It sifts the record for story-shaped patterns, proposes new seeds, grows engaged threads into arcs and decides how the city shows them. How much it sows is a player setting, from off to high.
- **Fitting** is a service to authors. It fills the open parts of a seed: when, where, why now, through which channel, with what connecting material. It serves authored seeds and the engine's own seeds the same way, and it stays available with sowing switched off.

Around both sits **the director**: the pacing estimate, the thread budgets, the schedule, the player model and the hooks layer 2 calls.

| Layer 3 owns | Layer 3 doesn't own |
|---|---|
| The **sifter**: recognising story-shaped patterns in the simulated record | The world and its processes (layer 1: [S0](spec/kernel.md), S1) |
| The **sower**: proposing seeds, growing engaged ones, promoting subjects, projecting fronts onto the street | The seed language, compiling, casting, the lifecycle, intersections, the record, the exposure ledger, the lint (layer 2: [S2](spec/seeding.md)) |
| The **fitter**: filling the open parts of any seed within its latitude | The arbiter's gates, its release step and its clock (layer 2: [S2 §8](spec/seeding.md#8-deliveries-and-the-arbiter)) |
| The **director**: sensed intensity, phases, thread view and budgets, the opportunity schedule, the player model, and the hooks | Words and rendering (S7), channel mechanics and the game port (S5), pack format and settings screens (S4, P6) |
| A small persisted record of its own ([§7](#7-determinism-persistence-and-state)) | The evaluation harness (P9) and the inspection tools (P10). Layer 3 supplies their logs and read-only services ([§8](#8-logs-audits-and-evaluation-surface)) |
| | Authored content (layer 4). It is layer 3's vocabulary and its director's brief |

**Five principles run through everything below.**
1. **Two doors out.** Layer 3 changes the world only by sowing seeds, and by withdrawing seeds it sowed, through layer 2. It changes timing only through bounded hooks. The only nodes it mints itself are inert `meta:` events ([§6.5](#65-promotion-and-hand-over)). A constructed cause is a contribution that layer 2 checks and commits ([§4.7](#47-plants-constructed-causes-and-closure)).
2. **It selects; it never edits.** It chooses which recorded events to tell, when and in what form. It never removes an event that happened, never changes a unit's strength, stakes, hostility or reward, and never rewrites a fragment's words ([dossier 7](craft/d07-direction-pacing.md) PR-3; [dossier 21](craft/d21-words-dialogue.md)).
3. **V is observed, never owned** ([D-09](decisions.md)). The player model weights offers inside a clamp. It never enters content, never reaches an NPC and never speaks ([§3.9](#39-the-player-model)).
4. **Plain data, deterministic, explainable.** Patterns, kits, budgets and tables are pack data. Every decision is a function of the record, the packs, the settings and keyed draws. Each one logs why.
5. **Sowing is optional; fitting is not.** With sowing off, the sifter, sower, fronts and baton stop. The fitter, the hooks and the thread view keep serving authored seeds ([D-03](decisions.md)).

## 2. The parts and their interfaces

### 2.1 The four parts

| Part | Job | Runs | Reads | Produces |
|---|---|---|---|---|
| **Sifter** | Recognise patterns in the record and keep a bounded pool of partial matches | On relevance emissions for its pattern frames; at each simulation window boundary (expiry, promotion checks) | The Change stream, `Dilemma`s, the pack's patterns | Candidates; inert `meta:` events |
| **Sower** | Choose what to open, from which source, in which kit; grow and promote | At opportunity slots; when a promotion gate is met; when V pulls | Candidates, loose ends, rungs, fronts, the thread view, settings | Sowing requests to layer 2 |
| **Fitter** | Fill the open parts of a seed and verify the result | When layer 2 casts, prepares or refits a seed; when the sower instantiates a kit; when a fit report runs | The instance, a read-only kernel view, the record, the exposure ledger, latitude and settings | Fit proposals; hook outputs |
| **Director** | Estimate intensity, run phases, keep the thread view and budgets, fold the player model | Once per second of play; on canon events | The sense list ([§3.1](#31-what-it-senses)), the thread view, the model | Hook outputs; holds; triggers for the sower (rest, baton) |

### 2.2 The loop

1. Layer 1 advances the world. Changes reach the sifter through the director's pattern frames.
2. The sifter keeps a pool and offers **candidates**. Other sources add candidates: loose ends, promotions, fronts, the ambient schedule ([§4.1](#41-where-seeds-come-from)).
3. At an **opportunity slot**, the sower picks one candidate and a kit, asks the fitter to fill the kit's open parts, lints the result, and sows it through the door.
4. Layer 2 casts, schedules and offers the seed. At each step it calls the hooks ([§2.4](#24-the-hooks)).
5. What V is shown becomes exposure. What V answers becomes canon `offer` and `response` events. The model folds them. Closed seeds leave loose ends. Both feed step 2.

### 2.3 The doors

**In to layer 3:**

| From | What | Where defined |
|---|---|---|
| Kernel | Relevance emissions on the director's frames; `Dilemma`s; canon events (including `offer`, `response`, `seed-outcome`); beliefs | [S0 §10.5](spec/kernel.md#105-changes-and-matching), [§10.8](spec/kernel.md#108-effects-and-cross-pressure) |
| Layer 2 | Read-only views: seed records, closure entries and loose ends, the exposure ledger, delivery states and grades, `parent` and cast links, `playTotal` | [S2 §10](spec/seeding.md#10-the-record-and-the-exposure-ledger); the read API is in [§10](#10-what-the-kernel-and-s2-still-need) |
| Layer 2 | Hook calls | [§2.4](#24-the-hooks) |
| Game port (S5) | The sense list; game option settings | [§3.1](#31-what-it-senses) |
| Settings | Tempo, `noticing`, exclusions, model floor, fitting latitude, time budget, content ceilings | [S0 §14.2](spec/kernel.md#142-records-and-branching), S4 |
| Packs (S4) | Sift patterns, kits, tempo bundle, premises, facet cards, channel tier tables | Layer 4 |

**Out of layer 3:**

| To | What | Notes |
|---|---|---|
| Layer 2 | A **sowing request** through `story.seed@1`, creator `director`: kit, overlay, parent, `growsFrom` | [S2 §1.2](spec/seeding.md#12-instances) |
| Layer 2 | **Withdrawal** of a seed the engine sowed | Source withdrawal, [S2 T1](spec/seeding.md#62-transitions). A closing trace plays if V saw it |
| Layer 2 | **Hook outputs** | Bounded, [§2.4](#24-the-hooks) |
| Kernel | **Constructed causes**, as contributions at the procedural layer, through the cause hook | Checked and committed by layer 2 ([S2 §2.15](spec/seeding.md#215-traces-and-plants)) |
| Kernel | Inert `meta:` events | Creator `director`, causes the constituent events, no effects |
| Kernel | The model, as `director → v` beliefs | `BeliefSet`; never read by predicates or NPCs |
| Save | The layer-3 record | One `SeedRecord` under its own id ([S0 V4-7](spec/kernel.md#20-version-4-additions)) |
| Tools | The decision log | Local, per session, never part of the save |

### 2.4 The hooks

S2 names five hooks and uses a sixth to ask for constructed causes. S3 adds three small ones that S2's text needs but doesn't list ([§10](#10-what-the-kernel-and-s2-still-need)). Every hook is a pure function of its inputs. Every output has a bound, and layer 2 enforces the bound.

| Hook | Called in | Kind | Output | Bound |
|---|---|---|---|---|
| **Fit** | [S2 §3.4](spec/seeding.md#34-layer-2-draws), every layer-2 draw | weigh | `fitWeight(o)` per option, from the **world** only: fit to place, time, history and latitude | Clamped to ±`fitCap` (ln 1.5) by layer 2. Zero with the director off. **Never reads the player model** ([S2 §8.8](spec/seeding.md#88-the-player-models-boundary)) |
| **Form** | [S2 §2.13](spec/seeding.md#213-scale-turns-threads-and-forms), at first release | choose | One of the seed's declared forms | Declared forms only, from explicit settings (the time budget, tempo), never the model. Recorded |
| **Phase (hold)** | [S2 §8.3](spec/seeding.md#83-the-release-step) step 4 | remove | Deliveries to hold this step | Removal only. Expiry still runs. Authored deliveries aren't held past 70 per cent of `maxWait`. May defer a formed offer on the model's evidence; off with `noticing` off |
| **Score** | S2 §8.3 step 5 | weigh | A delta | Clamped to ±`scoreCap` (1). Zero with the director or `noticing` off |
| **Joint** | S2 §8.3, joints | report | Whether a joint is latched, and which kind | Reads game state only |
| **Cause** | [S2 §2.15](spec/seeding.md#215-traces-and-plants) | produce | Contributions for a `constructed` cause | Only where `latitude` allows `trace-cause`. Refused on any conflict with pins, confirmed exposure or V's acts. Committed on display |
| **Band** | [S2 §2.14](spec/seeding.md#214-clocks-counts-and-projections) | choose | `distal`, `proximal` or `imminent` for a projection | Declared bands only |
| **Channel** | S2 §3.4 ("not drawn") | remove | Ladder rungs to skip | Removal only. Never reorders. The ladder's last rung is never removed |
| **Fill** | New, [§5.3](#53-the-proposal-and-how-it-enters-layer-2) | produce | A fit proposal: options with weights, bridges, edits | Within latitude and cost. Tagged fitter-supplied. Verified before use |

The hooks form three families, and the family sets the audit:
- **Weigh** hooks return a number that layer 2 clamps. Of all the hooks, the model may feed only **Score** (ranking formed offers) and **Phase** (deferring them) ([S2 §8.8](spec/seeding.md#88-the-player-models-boundary)). Every structural choice (variants, alternates, casting, forms) is made without it.
- **Choose and remove** hooks pick among things the seed declared, or hold things back. They never add or reorder.
- **Produce** hooks return material. Layer 2 checks it, records it write-once, and commits it when V is shown it.

### 2.5 The director's root actor and frames

The kernel gives layer 3 one root actor, `director` ([S0 §11.3](spec/kernel.md#113-the-directors-beliefs-about-v)). Its frames are of two kinds:
- **Pattern frames.** There is one per sift pattern, with a `reactsTo` interest for every clause of that pattern. The frame's weight is set so that a kind-level match clears the relevance threshold. That is how the Change stream reaches the sifter ([§6.1](#61-what-the-sifter-reads)).
- **V's inferred frames.** S1 opens them from the model. They are marked `inferred`, and no predicate or NPC can read them. They focus attention and pin nothing ([S0 I-12](spec/kernel.md#15-invariants)).

The director's drives (tension, variety, relevance, care, continuity, from [dossier 1 §12](craft/d01-motivation-drives.md)) are **terms in its rules**, not frames. [§3.9](#39-the-player-model) lists them as the objective, and [§11](#11-compromises) records the departure.

## 3. The director

The director is the part of layer 3 that runs second by second. It decides nothing about content. It estimates the moment, keeps the books on threads and tempo, folds the player model, and answers the hooks.

### 3.1 What it senses

The director reads two closed lists. The first is what layer 2 passes to every hook ([S2 §8.8](spec/seeding.md#88-the-player-models-boundary), S2-I-14). The second is its own **sense list**, read straight from the event feed at the fast loop. Both are data, and a static audit checks them ([§8](#8-logs-audits-and-evaluation-surface)).

| Sense | Source | Used for |
|---|---|---|
| Combat state, and whether a hostile is aware of V | S5 | Intensity `A`, the `engaged` flag |
| V's health, polled | S5 | `A` |
| Deaths and defeats near V | S5 | `A`; strain |
| Heat stage, pursuit | S5 | `A`, `engaged` |
| Vehicle state, collisions | S5 | `A`; load class |
| The tracked objective: progress and position | S5 | The engagement flag; nudges; urgency |
| V's position | S5 | Stage distance, urgency, projection bands. Only the director reads it |
| Attention aspects and the session state | S2, passed to hooks | Holds; channel rungs |
| Game option settings: chatter, subtitles, HUD | S5 | Dropping a channel rung ([D-09](decisions.md): these are V's stated settings, not inferences) |
| Canon events: V's acts, `offer`, `response`, `seed-outcome` | Kernel | The model, counters, callbacks |

**Never read:** menu use, idle time, input silence, time of day, session length, saves, quits, load counts, return counts, the wall clock. The away marker is layer 2's overlay ([S2 §8.2](spec/seeding.md#82-the-play-clock-and-session-states)), so the director needs none of these ([dossier 12](craft/d12-player-model-trust.md) S12-S2-06, S12-P5-22; [dossier 11](craft/d11-saves-memory-forgetting.md) S11-P5-01).

### 3.2 Pacing state and phases

The pacing state is **session state**. It is not persisted, and it restarts in settling at a load.

| Quantity | What it is |
|---|---|
| `A` | Sensed situation intensity, 0 to 1. A sum of sensed inputs, decaying (half-life 30 s) unless `engaged`. Weights are data ([dossier 7 §5.2](craft/d07-direction-pacing.md#52-estimating-situation-intensity-from-the-senses)). It describes the game's moment, never V's feelings |
| `N` | The intensity effect that a running beat or offer declared (−1 to 1), decaying with a half-life of 120 s. It covers dialogue and scenes, which `A` can't see |
| `T` | `max(A, N)`, used for phases |
| `engaged` | A hostile is aware of V within 40 m, a pursuit is active, or V has recent progress on an objective or is near its tracked pin |
| Phase | `settling`, `build`, `peak`, `fade`, `rest` |
| Strain | Recent deaths, a long high-intensity phase, repeated failure. It only lengthens rest and holds. It never raises a rate (S12-P5-07) |

**Phases**, on the play clock, with hysteresis:
- `build` → `peak` when `T` reaches `θ_peak` (0.7). Nothing new that adds intensity is released.
- `peak` → `fade` once 5 s have passed and `T` has fallen below `θ_peak`.
- `fade` → `rest` at the natural break: `engaged` false and `T` below `θ_fade` (0.35).
- `rest` → `build` when the rest length `R` has passed, or V has moved to another district and the minimum rest has passed.
- `settling` follows a load, sleep, wait or fast travel, for 90 s of play. It acts as rest.

**Rest length** depends on what ended: a firefight or chase, `clamp(45 s, 1.5 × episode, 3 min)`; a thread climax, 5 minutes with no push except the thread's own closing messages and 20 minutes with no high-intensity push; an arc climax, 20 minutes with no new thread of the same kind. A push may add intensity only up to the headroom above the sensed intensity.

**In rest and settling** the hold hook removes everything above class 0 except the closing messages of live threads and pull deliveries. Rest never blocks pull. A floor of ambient class-0 content keeps the city from reading as dead ([§4.1](#41-where-seeds-come-from)). The reactive layer holds, delays or withdraws and never adds.

The loop runs once a second of play and writes only consequences to the record: offers made, rests taken, thread stages, clock segments ([dossier 7](craft/d07-direction-pacing.md) PR-14). A settling period follows every high-load state, so a call or approach is never the first thing after a fight.

### 3.3 Its verbs

The director has six verbs. Each maps onto a layer-2 mechanism, and each has a manipulativity class from 0 to 3. **Class 4, changing anything V has observed or could base a choice on, does not exist** ([DS-05](design-seeds.md)).

| Verb | How it is done | Class | Limits |
|---|---|---|---|
| `trace` | Sow a class-0 glance seed, or ask a seed for its next sign | 0 | The plant cap (about three live plants per attended thread, one foreground per scene); a salience budget per district |
| `offer` | Score and release an authored offer; sow a seed whose first delivery is an offer | 1 | The arbiter's gates; the push budget; V can ignore it |
| `nudge` | Sow a glance or encounter seed in which a cast NPC acts for its own reason, pointing at an area or a person | 2 | Needs an accepted goal and 30 to 60 s without progress. Never moves V |
| `hold` | The hold hook removes a delivery from this step | 3 | Only deliveries V hasn't been shown. Discretionary holds stop at 70 per cent of `maxWait` |
| `withdraw` | Withdraw a seed the engine sowed, with its closing trace | 3 | Never a seed V pulled: that one is simmered ([§3.6](#36-threads)) |
| `rest` | The phase state above | 3 | Begins at a natural break only |

**The director changes timing and rate only.** Stakes, hostility and rewards come from the seed and the world. Any action that changes a unit's strength is a logged defect. Every action carries a purpose from a closed vocabulary and an explanation chain to a recorded fact, or to a cause labelled `constructed`. Class 2 and 3 actions are capped per hour [tunable]. The log is in [§8](#8-logs-audits-and-evaluation-surface).

### 3.4 The hooks in practice

| Hook | Terms it computes (all weights are data) |
|---|---|
| **Fit** | The sum of: tone and aesthetic fit against `intent`; variety (repeat-counter demotion, stratification hints, bag and growing-chance weights read from the record counts); familiarity, where the seed asks for a history hook; a soft penalty for a candidate another live seed holds ([§5.6](#56-contests-and-the-engines-own-re-casting)); the stance quota ([§4.8](#48-theme-and-stance)). The player model is not a term here: it reaches only the Score and Phase hooks ([S2 §8.8](spec/seeding.md#88-the-player-models-boundary)). Layer 2 clamps the total |
| **Form** | `standard` unless: the player has declared a time budget and the remainder is shorter (then `short`, or `abstract` if even that won't fit and V didn't pull); or V is `engaged` and the tempo is calm (then `short`); `full` only for the lead thread, when V pulled it and it is the only thread attended. Never inferred from V |
| **Hold** | In this order: phase (rest and settling); the breakpoint rule (a below-threshold request waits for a coarse breakpoint inside its window); the **lead aim** from fitting ([§5.2](#52-what-is-fitted)); thread cadence for sown threads; release jitter of ±25 per cent, hashed from the delivery `Id`; warn and standby for a staged beat; a `hook` delivery waits until its anchor is at least `presented` (a class-0 anchor trace goes first), and one surprise beat is rationed per gig. Everything but the phase hold relaxes at 70 per cent of `maxWait`. The hard gates never relax |
| **Score** | Relevance (the kernel pull of V's active frames on the seed); a leverage proxy (decision beats are booked into the first receptive window after a rest); fit of the delivery's declared intensity to the headroom; the model's channel and class facets. Authored deliveries get the built-in +1 from S2 |
| **Joint** | Latched on: arriving somewhere and stopping; waking from rest or a wait; finishing a job (a witnessed `seed-outcome`, or a vanilla quest completion); asking (a pull) |
| **Channel** | Drops a rung when its carrier is switched off in the game options, or when its tier for V's current activity is low and a later rung exists ([dossier 13 §5.3](craft/d13-perception-curiosity.md)). The tier table is data, population-wide, and is never updated from V |
| **Band** | Travel time and social distance from the front's centre to V, and the district's salience budget: a projection beyond the budget drops to `distal` |
| **Cause** | See [§4.7](#47-plants-constructed-causes-and-closure) |

### 3.5 Tempo and the nested schedule

The proactivity dial is the **tempo** setting: `off`, `calm`, `steady`, `restless` ([D-02](decisions.md)). Layer 2 applies its cadence part: spacing, the cap, and what passes at `off` ([S2 §8.3](spec/seeding.md#83-the-release-step) step 3). Layer 3 applies the rest of the bundle, and only to **what the director sows**. Tempo never rescales what an author wrote. Hard gates never move.

| Parameter (director-sown content) | Off | Calm | Steady | Restless |
|---|---|---|---|---|
| Thread-opening rate (candidates an hour) | 0 | 0.25 | 0.5 | 0.8 |
| Soft sown-push rate (an hour) | 0 | at most 1.5 | 2 to 3 | up to 4 |
| Durations the sower chooses (clocks, unattended plans) | not sown | ×1.4 | ×1 | ×0.7 |
| Lead times and warning times | not sown | ×1.5 | ×1 | ×0.8 |
| Promotion thresholds | not sown | ×1.5 | ×1 | ×0.7 |

Authored seeds pass at every setting, including `off`.

**The opportunity schedule makes the columns nested.** For each stream (`open` for new threads, `ambient` for class-0 texture) slot `k` covers play-total seconds `[k·I, (k+1)·I)`, where `I` is the mean gap at the highest tempo. Its time inside the window and its **liveness draw** `u` are hashed: `rand("s3-slot", worldSeed, stream, k)` and `rand("s3-live", worldSeed, stream, k)`. A slot is live at tempo τ when `u < θ_τ`, where `θ` is the ratio of τ's rate to restless: 1, 0.625, 0.3125 and 0. Every slot live at calm is therefore live at steady, and every slot live at steady is live at restless.

Consequences:
- Moving the dial thins or fills the same schedule. It never re-rolls it.
- A change takes effect at the next slot boundary, never mid-beat.
- A reload shows the same schedule. The clock is `playTotal`, saved with the branch, never the session's play clock ([S2-I-11](spec/seeding.md#13-invariants)).
- The first hour of a branch is gentler: no sown push in its first ten play-minutes, and none above class 1 in its first hour **[tunable]**.

### 3.6 Threads

A thread is a **view over the record**, as [S2 §2.13](spec/seeding.md#213-scale-turns-threads-and-forms) says: seeds joined by `parent`, `growsFrom`, shared cast nodes, shared frames or promises. The director keeps the view incrementally.

| Status | Meaning |
|---|---|
| **Attended** | A beat or cue of the thread reached `presented` or better within the attended window (45 play-minutes **[tunable]**). It is measured with `playTotal`, so it survives a load |
| **Simmering** | V knows of it, it isn't attended, and it had a cue within 8 play-hours or 3 sessions |
| **Dormant** | Retired from view; its pins are kept |
| **Closed** | Its closing trace was shown. Status: resolved, abandoned or transformed |

**Budgets.** At most 4 attended, 2 live, 1 climactic and 8 simmering. Authored, fitted and V-pulled threads count. No per-tempo sub-caps until the measures show fast threads starving.

**Who the budgets bind.** Only the engine's own openings and beats. Authored seeds are never refused or withdrawn for a budget: the engine's threads yield to them. A V-pulled thread is simmered, never dropped.

**Rules.**
- **The lead thread** has the highest kernel pull from V's active frames, weighted by the recency of V's own acts. At most three threads advance in a play-hour and the lead takes at least half the beats.
- **Composition:** at most one climactic thread; at most one hostile thread at imminent or contact; a mix of tempo classes and tones in the attended set.
- **Tempo class** comes from a thread's clock length and beat count: fast up to 2 play-hours, medium 2 to 12, slow beyond. It sets the beat interval (about 12, 90 and 240 play-minutes **[tunable]**), applied as a hold on the next beat of a sown thread. Authored threads keep their own pace.
- **Overflow** goes in order: merge into a thread that shares a role, place or consequence; queue (owed pushes never exceed one); then withdraw the lowest-pull thread the engine sowed, with a closing trace.
- **Retirement** runs attended, simmering, dormant, closed. A simmering thread with no cue for 8 play-hours or 3 sessions retires. A thread V never saw closes silently.
- **Baton.** During rest, a class-0 request from the best-pulled simmering thread may point at it. It costs district salience and no push. The cue is the thread's `cue` fragment ([§10](#10-what-the-kernel-and-s2-still-need)).
- **Yielding.** When pushed threads exceed pulled ones over a play-hour, or more than 8 V-aware threads are unattended, sowing skips its next slot. It never forces a closure.
- **Coherence.** The fitter scores shared role, place or consequence between threads and flags a thread that touches no other. A coincidence not in the record is barred.

### 3.7 Sessions, jumps and returns

Layer 2 owns the session states and the return view's assembly ([S2 §8.2](spec/seeding.md#82-the-play-clock-and-session-states), [§8.7](spec/seeding.md#87-the-return-view)). Layer 3 supplies the choices inside them.

| Moment | What layer 3 supplies |
|---|---|
| A load | Pacing restarts in settling. The thread last attended, found from the record by `playTotal`, gives the re-situating cue (its `cue` fragment), else one class-0 hook. No class 3 or 4 push opens a session |
| A jump (sleep, wait, fast travel, load) | The list of coarse dimensions that changed across it: time of day, weather, V's district, its heat band, anything the last attended thread depends on. The first class-0 or class-1 delivery after the jump carries one cue per changed dimension. S7 renders them |
| A return after days | A ranking for S2's recap material: at most three acts, chosen by distinctiveness and by V's own agency (acts V chose before acts that befell V), each with a place or person cue. The "waiting on you" list is at most three open commitments. "Story so far" is pull and unlimited |
| First entry to a district after three or more game days | At most three class-0 changes, ranked from settled outcomes, news and street forms. Reunion beats come per NPC and call S1's recall function: at most one exact memory and one half-memory |
| After a climax | A closure beat comes first, then rest |
| At joints | `atJoint` news is released: the world's movement over V's absence is bound for V when V arrives, rests, finishes or asks. No consequence first appears mid-scene unless the scene caused it |
| A declared time budget | The player may state one. A thread whose shortest form exceeds the remainder isn't opened unless V pulls it. It never forces an end |

**The first-forgetting guard (conditional).** Per NPC, until V has met one correct specific recall from them, no half or gone result is surfaced for an exposed act of salience 2 or above, and a reunion carries one correct specific memory. It is built only if the panel test supports it. Otherwise the result is recorded as a null.

No director term reads session length, time since load, a quit, or a return. A static audit finds none ([§8](#8-logs-audits-and-evaluation-surface)). Callback staleness uses `playTotal`, with the wall gap at loads read only inside the return view ([§6.6](#66-other-sources-callbacks-and-the-telling-rules)).

### 3.8 Lead, urgency and dread

**Lead and urgency.** For a window V can close, a seed states a lead preference (`early`, `preferred`, `late`) and an urgency list ([S2 §2.7](spec/seeding.md#27-windows)). The director raises urgency from the time since the window opened and from V's distance to the place that triggers the close, never from a calendar. The effective urgency is the highest of the three. A lead aim then sets the hold: `early` aims at the first receptive moment; `preferred` at urgency 0.35 or the first receptive joint after five play-minutes; `late` at urgency 0.7 **[tunable]**. An authored request keeps its hard deadline and ranks above sown ones until it. At the deadline it plays in its lowest-intensity form or degrades by its named form.

**Staged beats.** A beat is warned at least 60 s of play ahead, which raises the focus tier of its seed's role frames so that S1 refines the venue and cast. It is held on standby for at least 10 s with its arbiter slot reserved, then released. A beat that starts without its detail is a logged defect. A call or approach is preceded by a warning lag of at least 8 s. Channels are negotiated and no push forces a scene.

**Traces.** A trace V hasn't met within a session is refreshed (a class-0 glance seed). A plan places its signs with a minimum gap of about 10 per cent of the expected lead, across sessions for arcs.

**Dread.** A hostile thread is an authored or kit-based seed. Its stages (distal, proximal, imminent, contact), its clock and its handle are seed data. The director adds the rules that must hold across seeds:
- **Disclosure first.** At gig and arc scale there are at least two traces of different kinds before first contact, each with V-visible options before and after.
- **Caps.** Imminent lasts at most 15 play-minutes; proximal at most 3 game days and 2 sessions. The caps are checked as kit data, and beyond them the thread goes to contact or a stand-down trace. Composition allows one hostile thread at imminent or contact.
- **Uncertainty.** While a thread builds, the score hook prefers the trace that keeps V-visible evidence in the middle band: the share of the kit's declared natures still consistent with what V has had `presented` stays between 0.25 and 0.75. A fear-type payoff needs a suspense state first, is at least as large as the declared build, and is followed by rest.
- **What the threat knows.** Threat actors read the world only through `knows`. The director alone reads V's position. It never writes a belief into a threat. If a thread needs the threat to find V, the seed declares a `tip` beat whose effect is an ordinary `expose` event with a witness and a recorded cause; the director only times it. The region it carries is coarser than V's tier.
- **A handle.** From proximal on, V can seek a handle, and seeking it advances the clock. A full clock changes the world, not V's progress. A decline is a consequence.
- **No punishing failure.** Threat behaviours unlock from observed progress counts, never from V's failures. A threat has an exposure cap per session. The director shows nothing but diegetic signs.

### 3.9 The player model

**What it is.** The engine's belief about V's taste in what it is offered. It is not a belief about V's character, feelings or motives ([D-09](decisions.md)). It is **a fold over canon events**: `offer` and `response` events after the floor, less excluded facets and less intervals in which `noticing` was off. The fold's arithmetic is S0 §1.3's only, so the reference model and a faster build agree. Stored beliefs are `director → v` beliefs with `source: inferred`, and a test asserts that they equal a fresh fold.

**The signal ladder.**

| Rung | What | Status |
|---|---|---|
| T0 | V's acts in the record | Used |
| T1 | V's responses to displayed offers: accepted, declined, lapsed after perceived, retracted, abandoned, countered | Used |
| T2 | Short-lived approach counters (dwell, gaze), opt-in as `noticing: full` | **Deferred.** The value is reserved; in the first implementation `full` behaves as `acts` |
| T3 | Raw input, menu and session telemetry | Never read, never stored |

**Facets**: a closed set, each with a card (label, purpose, evidence rule and weights, decay, minimum evidence, readers, forbidden uses, validity entry, excluded content classes, example renderings). A facet without a card doesn't load, and packs can't add facets.

| Facet | Keyed by | Purpose |
|---|---|---|
| Response rate by skeleton value | verb, stake, relationship, outcome, tone | Rank |
| Response rate by channel and class | channel, class, purpose | Time |
| Exclusions | a facet, an NPC or an offer kind V retracted or switched off | A hard filter on all hooks |

Content classes marked sensitive are untracked, and the fold drops events that carry them ([dossier 18](craft/d18-content-boundaries.md)).

**The estimator.** For a facet `f` over displayed offers, with age weights `w = H / (H + Δ)`, counts `a` and `b` scaled together if their sum exceeds a cap, `n = a + b`, `p = (1 + a) / (2 + n)` (a flat prior), `p0` the same estimate over all offers in the channel class, and `g(n) = clamp((n − 3) / 5, 0, 1)`:

```
m(o)        = 1 + ( c · Σ g(n_f)·(p_f − p0) + e · Σ_{n_f < 3} u(n_f) ) / |F(o)|
scoreDelta  = ln( clamp(m, 1/1.5, 1.5) )      // fed to the Score hook only; clamped again by layer 2
```

Confidence is `n / (n + 2)`. Below three observations a facet has no influence except a small optimism bonus. The model changes only how formed offers are ranked at release, never any draw: casting, variants and alternates are drawn by layer 2 without it. Constants (`H`, `c`, `e`, the cap) are data, in [dossier 12 §5.3](craft/d12-player-model-trust.md).

**Where the model may act.** Only through the hooks of [§2.4](#24-the-hooks), each clamped. It never changes events, content, order, costs, defaults or wording. It never writes an NPC belief. NPC beliefs about V reach the director only as reputation aggregates, never as evidence of taste. From `displayed` until `answered`, no model value reaches any hook concerning that delivery, and hook outputs are computed at release and stored, never recomputed at display. S2 enforces the boundary ([S2 §8.8](spec/seeding.md#88-the-player-models-boundary)).

**Exploration and breadth.** The optimism bonus for thin facets, and a breadth rule: at least one in four sown pushes comes from outside the top band, and a V who declines a lot gets a lower rate but the same variety. The ±ln 1.5 clamp makes the quarter rule nearly automatic. It stays as a measured check.

**Receptivity.** The engine's estimate that V will take a kind of offer is the channel and class facet, with the confidence states above, and nothing else. The decision among "nothing", "a class-0 version first" and "the push" follows two thresholds on that facet's confidence state. There is no separate receptivity belief.

**The director's objective**, listed so an audit can check it:

| Term (from dossier 1's director drives) | What it is made of |
|---|---|
| tension | Phase adherence: build, peak, fade, rest by `T` |
| variety | Repeat counters and level-of-interest per category; no run of one skeleton value or channel |
| relevance | The match between a candidate and V's **observed record** (kernel pull of V's frames, callbacks available). It never runs on facet rates |
| care | Pressure limits: unanswered offers lengthen holds, strain lengthens rest. It only subtracts |
| continuity | Closing or advancing open threads; paying promises |

No term relates to return rate, session length, streaks, quits or idle time. Wellbeing is not inferred: any break or time cue is a feature the player turns on, and the director reads nothing for it.

**Controls.** The `noticing` dial (`off`, `acts`, `full`; default `acts`), the exclusion list, and "start fresh" (the floor) are recorded ops ([S0 §14.2](spec/kernel.md#142-records-and-branching)). The `setting` atom can't read them. Per facet: "use less" halves its influence; "stop using" zeroes it; "forget" moves its floor. A stated setting overrides inference. Reset equals a fresh start, as a test.

**What the player sees** is for S4 and P6 to build, and layer 3 supplies the data: a **noticed page** (rows above the minimum evidence, each with its events, no numbers, pull only, generated from the model so that every control is real), a **one-time disclosure** in the first-run flow and again only when what is noticed changes, and a **"why this?"** line for any delivery whose hook output was non-zero. Reading the page mints no event. A delivery whose cause includes a belief is recorded as an **adaptation**, never as a consequence.

**The review gate.** Each director mechanic gets a dark-pattern review record (the six attributes, checks C1 to C8 of dossier 12), by a reviewer who isn't the author. A mechanic with an attribute present and no disclosure doesn't merge. The record lives beside the mechanic's specification.

**Privacy.** Local only. No model feature in any prompt or remote call. Exports and reports leave out the `director → v` beliefs by default. The model starts empty on a new branch and is never read across branches.

**Orientation and landing (deferred).** Dossier 12 also describes an orientation index (evidence of V's closeness to an NPC or group), used only to pick staging alternates and outlets, and a landing check. The interfaces are fixed here: staging reads it, nothing else may, and no consequence is aimed by attachment. The build waits until the model has run in the prototype ([§14](#14-requirements-trace)).

### 3.10 Staging choices and reflection

Layer 3 chooses among forms the seed declared. It never writes one.
- **Rungs.** The director picks the rung (performance, routine, residue, report, record) from V's distance and attention, keeps one foreground scene in view at a time, never moves an event earlier than the record says, and keeps a class-0 budget per staged scene ([S2 §2.21](spec/seeding.md#221-staging-in-the-world); [dossier 20](craft/d20-staging-legibility.md)). P8 realises the rung.
- **Turns.** A turn is staged at a joint, in its witnessed form if the earlier stance was exposed and its told form if not. A reunion glance carries one cue per changed dimension. Turns that happened off-screen settle lazily.
- **Reflection.** V's acts show in behaviour first (approach, prices, distance, access) and in words only as a witness's remark after at least three acts of one kind. There is no meter and no label. The director picks among authored alternates by the ordinary fit weights.
- **Escalation guard.** If consecutive offers from one thread rise in ask size, each rise needs a world-side cause in the asker's own frame. The director never orders them. Hits are logged.
- **Outlets.** For a media item, the director picks which of an outlet's beliefs becomes an item, within the channel's format budget. The wording is S7's. The divergence is the outlet's own belief against the record ([S2 §2.18](spec/seeding.md#218-setting-and-tone)).

## 4. Sowing

Sowing is the proactive role. It turns what the world already holds into seeds, at a rate the player sets and the push budget supports. Its rule is **selection over generation** ([DS-01](design-seeds.md)): the world is simulated, the record is sifted, and the sower chooses what to tell. It invents no content. Its vocabulary is the packs' kits, patterns and fragments ([DS-37](design-seeds.md)), and the engine ships a small starter pack so that a world with few packs still has recaps, rumours and sightings to tell.

### 4.1 Where seeds come from

| Source | What it supplies | What it can become |
|---|---|---|
| **Sifted matches** | Partial or complete matches of patterns; `Dilemma`s; belief-against-truth gaps; frame-status turns ([§6](#6-sifting)) | The pattern's declared tellings: recap, rumour, sighting, foreshadow, offer, aftermath |
| **Loose ends** | Closure entries of finished seeds: consequence facts nobody read, changed cast nodes, unpaid promises and plants, unread turns ([S2 §6.4](spec/seeding.md#64-closing-and-outcomes)) | Child seeds of the closed seed, naming the entry in `growsFrom`: a follow-up glance, an encounter, a gig, and an arc once two found ancestors exist |
| **Promotion** | A subject whose gate on the ladder is met ([§4.5](#45-growth-and-promotion)) | Promotion kits: a regular, a moment of their own, a seed of their own |
| **Fronts** | Season-level seeds, authored or grown from an engaged arc, and their projections onto the street ([§4.6](#46-fronts-and-the-street)) | Front kits; street forms |
| **Schedules** | The opportunity schedule ([§3.5](#35-tempo-and-the-nested-schedule)): the `open` stream gives the slots at which the sower picks a thread to open; the `ambient` stream gives class-0 texture from the city's hot state ([S2 §2.16](spec/seeding.md#216-city-events-as-material)); an author's `grow` invitation asks for children of one seed | Texture kits; the kits the author named |
| **Pulls** | V asks: calls a contact, follows a pin, asks a fixer for work | An on-demand slot above `off`; the seed V pulled counts against budgets and is never dropped |

A gig is "someone's blocked goal that V can unblock" ([DS-56](design-seeds.md)). It needs no separate source. A pack pattern with a `frame` clause (a client's goal turns `blocked`), an `unless`, and a telling that names a gig kit does it.

### 4.2 Candidates and gates

```ts
interface Candidate {
  key: string;                          // stable: H(source, pattern, bindings) or H(source, entry)
  source: 'match' | 'dilemma' | 'divergence' | 'looseEnd' | 'promotion' | 'front' | 'ambient' | 'pull';
  tellings: Telling[];                  // what it could become (below)
  features: Record<FeatureId, number>;  // F-1 … F-12 values, kept raw (§6.4)
  causes: Array<{ event: Id; source: 'found' | 'constructed' }>;
  level: SeedLevel; stakeScale: StakeScale;
  complete: boolean;                    // a recap or rumour (true), or a foreshadow or offer (false)
  expires: GameTime;
}
interface Telling { kit: TemplateId; form: 'recap' | 'rumour' | 'sighting' | 'foreshadow' | 'offer' | 'aftermath' | 'follow-up';
                    atStage: number; binds: Record<RoleKey, string> }   // kit role ← pattern variable
```

**Gates come before scores.** A candidate that fails a gate isn't ranked.

| # | Gate | Why |
|---|---|---|
| 1 | The kit is `ready`, lint-clean, inside the player's content ceilings and class exclusions | Content floors never bend ([S2 §2.19](spec/seeding.md#219-content-classes-ceilings-and-floors)) |
| 2 | A reportable change (F-1) and a showable cause path of at most four links (F-12), each cause `found`, or `constructed` inside latitude | Causality (quality bar 1) |
| 3 | A human at the centre (F-4) and a protagonist; the chain is short (F-8) | Tellability |
| 4 | A chain about people V has never met is held as world texture or a rumour, unless its stakes touch V's record | Relevance (quality bar 2) |
| 5 | The stake scale is at or below the cap: `block` by default for sown seeds; `district` needs two found ancestors; `city` is authored only | [S2 §2.18](spec/seeding.md#218-setting-and-tone); the proactivity dial caps it |
| 6 | The spine guard: no role on the canon story's characters where an effect would change a fact the game records; for them, only beliefs about V and ties with V | [S2](spec/seeding.md#25-facts-world-requirements-effects-and-dependencies) canon guard |
| 7 | Budgets and composition hold ([§3.6](#36-threads)); the district's salience and plant budgets have room | Pacing (quality bar 7) |
| 8 | No exclusion applies; no tombstone; no re-offer without a recorded cause that post-dates the decline or lapse | Agency |
| 9 | If the player declared a time budget, the shortest form fits the remainder, or V pulled it | [§3.7](#37-sessions-jumps-and-returns) |

A betrayal ("turn") seed counts against S1's betrayal budget. It never targets a cast another live seed holds without that seed's consent, and no process turns an ally against V ([S2 §2.17](spec/seeding.md#217-people-order-and-reputation-as-material)).

### 4.3 Selection

At a live slot the sower ranks the candidates that passed, then draws.
1. **Features to bands.** Each feature (deviation, stakes, familiarity and personal link, irreversibility and novelty, a live gap, closure, valence and arousal mix, timeliness and continuity) is ranked among the eligible candidates and cut into three bands. The raw values stay in the log. A feature's weight is data and defaults to 1. No fitted formula decides an offer ([dossier 6](craft/d06-sifting-tellability.md) TEL-14).
2. **Composition.** Diversity constraints on pattern, event kind, valence and place, with quotas as data, are separation as `constrain` and bags or growing chances as `weight`, reading counts from the record ([S2 §2.11](spec/seeding.md#211-variation-latitude-and-adaptation)). A pack's `strata` hints ask for coverage of combinations over a session. A distinctiveness budget limits strange encounters to about one in five per district hour. A session tone curve prefers an alternation of heavy and light tones and keeps a floor of light ones. It never overrides an author-fixed order and reads tones, never V.
3. **Collisions.** A telling that makes two live threads cross, or that stages a recorded `Dilemma`, gains weight, inside the tension budget ([DS-11](design-seeds.md)). Cross-pressure that layer 2 hands over ([S2 §9.2](spec/seeding.md#92-settling)) is material for this step.
4. **The draw.** The choice is a keyed draw with the kernel's arithmetic: `rand("s3-pick", worldSeed, stream, k, candidate.key)`, with the Gumbel form of [S2 §3.4](spec/seeding.md#34-layer-2-draws) over `ln w + λ · composite + diversity terms`. The band composite only tilts the draw, so the top candidate doesn't win every time. Ties go to the lower `H("tie", …)`.
5. **Authored first.** Where an authored seed and a sown one want the same moment or node, the authored one wins ([S2-I-10](spec/seeding.md#13-invariants)). The sower yields.

### 4.4 Instantiation

The sower turns the chosen candidate and telling into a seed in five steps.
1. **Choose the kit** among those that serve the telling, by fit weight and variety, with a keyed draw. Kits that favour class-0, systemic and text-driven forms get a small standing weight ([DS-19](design-seeds.md)), because those are what a procedural engine does well.
2. **Build the overlay.** A `Partial<Seed>` that fixes the roles the match already bound (they are events in the record, so they are fixed), sets `parent` and `growsFrom`, and carries the tempo-scaled durations, the persistence defaults and a `stakeScale`. Procedural effects default to `resettable`, except effects on ties and standing, scaled by the player's reset scale. Authored `remember: always` is never scaled away.
3. **Fill the open parts** with the fitter ([§5](#5-fitting)). A sown seed is fitted exactly as an authored one is.
4. **Lint** the filled document at its maturity. An error returns the candidate to the pool with a cooldown, and logs why.
5. **Sow** through the door, with the decision id `H("sow3", worldSeed, candidate.key)`. Sowing is idempotent: the same candidate finds the same instance.

**What a sown seed is.** A situation, not a plot: a client's blocked goal, the people and resources involved, and an `unattended` plan. Nothing contingent on a choice V hasn't made is precomputed. The sower refuses a kit that fails the layer-2 lint, so every sown offer has its offer anatomy: stakes and who bears them, supported actions with foresight, a null path, a lapse form, the decline forms, and a channel ladder. Decision beats declare at least three stances, one a refusal, and each consequential option writes a distinct record with a declared consumer. A time limit comes only from a window predicate with a source event, never from a relationship. Engine-sown investigations have at least three independent routes. A stalled-thread fallback exists only if V engaged with the thread, and arrives as a traced world event. Otherwise the thread lapses with a coda, and a ledger of leads shown is kept. A kit's belief-nesting depth stays within 4.

Shape templates and arc checklists are profiles (data). They recognise and shape; they do not originate ([S2 §2.10](spec/seeding.md#210-profiles)).

**Rates.** About 0.5 openings an hour at steady, and about six pushes a thread, which the soft push rate supports. Queue arrivals stay at about a third of the hard cap. At most one opening is owed.

### 4.5 Growth and promotion

**Growth from loose ends.** The sower proposes child seeds from the loose-end register, ranked by V's return counts. An arc needs at least two found ancestors in its `growsFrom` chain. Generated seeds never hold roles on the spine. Each `turning` kind registers its readers; a turn nobody read becomes a loose end and may seed a new seed. A thread V engages with gains detail and length. An ignored one fades ([DS-09](design-seeds.md)).

**The promotion ladder.** Opening a subject is the foundation's Open operation. Each rung opens more of its bundle and never changes its identity. Gates use observed events only.

| Rung | What is open | Gate | Cap per district | Steps down when |
|---|---|---|---|---|
| Seen | Only what V observed is pinned | V perceived it | None | It is forgotten. Pins stay |
| Recurring | A stable identity, a routine place, one repertoire bit | V meets it again at least an hour of play later, or twice in one place | 8 | No return for 10 play-hours |
| Featured | A frame (wants, concerns, ties) and a moment of its own | A notable outcome of V's act, then a return after it | 3 | No return and no live clock for 10 play-hours |
| Central | A seed of its own, with a promise ledger and a clock | V pulls it at least twice, or an author fixed it | 1 | The arc closes with a trace; the subject steps down one rung |

- **A promotion needs a gate met, a cause event, and depth ready.** Depth ready means the pack or S1 can supply a routine, a bit, or tie-specific moments. A refusal for no depth is logged.
- An author's `rung` is a floor. The spine stays authored.
- A promotion is done by sowing a promotion kit, so it passes every gate of [§4.2](#42-candidates-and-gates). Promoted figures' threads are sown from their own frames, and shape features separate across promotions.
- **Counters.** Return and outcome counters live in the layer-3 record, built from observed events only. They are local, readable in the opt-in record, resettable (they fold only events after the model floor) and never exported. A demotion keeps pins and shows a closing trace.
- **Memorable.** S3 supplies the rule S1's memory policy calls: set `memorable` when V returned to, protected or mentioned a thing, or when an act changed a tie or opened a thread. The player can see the rule.

### 4.6 Fronts and the street

A **front** is a season-level seed with a clock of 4, 6 or 8 segments, a landmark, a local cost, a sign set and projections ([S2 §2.14](spec/seeding.md#214-clocks-counts-and-projections)). Authors write them. The engine grows one only from an engaged arc, and refuses one without a landmark and a local cost. Every form needs a handle within two steps of an offer or a why-trace. At `off` none is sown.

**The projection engine** turns a front's clock segment into street forms for the districts and tiers V is near:
- strength follows travel time and social distance (the band hook);
- forms reuse the front's sign set and stay inside the district's salience budget;
- the street sees one facet of the front at each step;
- a V who never goes near still gets the distal forms.

**Outlets are actors with their own beliefs.** A media item is the outlet's belief. Its divergence from the record is a tunable per outlet. Each street form comes from its speaker's own beliefs (`knows`). A divergent claim is repeated independently at most three times before its counter is offered. Informants and outlets carry a **source track** built from confirmed ledger entries, and a correction picks its replacement cause from the record.

**Bounded dooms.** Severity follows the stake scale. Engine-sown fronts stop at `block`, and `district` needs found ancestors. A `city`-scale front is authored, with its portents and window counts declared in the pack's budget. The same cap that limits hostile threads at imminent or contact limits dooms. At most two district-or-larger fronts are live near V **[tunable]**.

**Occurrence isn't the director's.** City events are S1's. The director chooses which pending or occurred events to realise, may delay realising them, and builds offers around them. It never removes an event that has happened ([S2 §2.16](spec/seeding.md#216-city-events-as-material)). A group's grudge against V is a belief that may raise an offer through layer 2. No process aims an act at V. Game-owned incidents (gigs, hustles, the game's combat) are fixed material, never sown. Fitting reads bands to site authored seeds near them.

### 4.7 Plants, constructed causes and closure

**The plant planner.** For each thread it chooses traces from found causes, as class-0 forms.
- At gig level and above there are at least two independent kinds.
- At most about three live plants per attended thread, and one foreground plant per scene. Unplanted texture stays as a baseline.
- **Redundancy.** For each sign plan the planner computes the chance that at least one sign is `presented`, from the channel tier table. Signs of one kind count as correlated. It adds signs of other kinds until the chance reaches the target **[tunable 0.85]** or the plant cap is reached, and re-issues a sign at another placement until it is `presented`, up to twice. It never raises the push rate.
- **Spacing.** Signs sit at least about 10 per cent of the expected lead apart, across sessions for arcs. A cluster inside a minute counts once.
- **The plant ledger.** The payoff schedule reads the last exposure time and adds a refresh trace when it is stale. An unpaid plant gets a closing trace. The unpaid ratio is reported by type.

**Constructed causes (the cause hook).** Generate-then-justify is allowed only where the justification agrees with everything observed and committed.
- A constructed cause is a **contribution** at the procedural layer, so it goes through ordinary arbitration and can't contradict a pin.
- It is refused if it conflicts with a pin, with confirmed exposure, or with V's presence history. It is committed with `committed` pins on first display, and its source (`found`, `surfaced` or `constructed`) is recorded. The constructed share is metered.
- A trace cites a fact or a past event, never a pending one. A late cause never alters an observed fact.
- Every V-facing generated event has a why-trace path of at most two causes, reachable within two steps. An outcome shown before its cause is staged as a surprise only if no effect of the withheld cause is in the exposure ledger. Otherwise it takes the `ask` route.

**Glances.** A glance is generated from a record fact, or from a labelled `constructed` cause inside latitude, with exactly one `implies`. Its state is a function of the record at the time of sighting. A second sighting differs only as the record differs. A changed-state consequence is offered only where V confirmed the baseline, or paired with a pointer (an NPC look-at on an unreserved NPC, skipped where the game reserves the person; or an `ask` handle). P8 realises the pointer. Otherwise it is texture and earns no consequence credit.

**Completion and closure.**
- **The completion detector** diffs the record from a seed's start to its end against its `turns`. An empty diff is a logged non-event. Each completion carries `witnessed`, and writes the same outcome record either way.
- **Arc and season completion** run on ledgers: promises closed, a visible step per live session, a reconciliation ledger with no child running or simmering, and a closure entry.
- **The closure generator** reads the record at a closure point and ranks the people and places V materially changed by stakes and exposure. It composes a ledger of news, delivers each unshown consequence once, and every entry cites an event.
- **Two record types.** A `consequence` has a cause path from an act of V's. An `adaptation` has a director belief in its cause. Adaptations are never named to V and never alter what is true.

### 4.8 Theme and stance

- **The default is no premise.** The engine never mints one. With no premise in force, the audit and the quota are off. A player setting lowers or removes the city's thematic weighting, and the dial scales it.
- **Stance quota.** Among seeds that already fit, sowing and fitting prefer the stance most under-represented in scope, as a weak weight. It never overrides V's pull, author priorities or the dial.
- **Recurrence by structure.** Sowing holds a premise's structural features (stance classes, cost classes, bearers, timing) at the declared share, while the variety rules separate the surface slots.
- **The audit** is read-only and offline in the first implementation ([§8](#8-logs-audits-and-evaluation-surface)).

### 4.9 What the dial does

| Part | Off | Calm, steady, restless |
|---|---|---|
| Sifter | Stops | Runs. Cost counted in the tick budget |
| Sower: openings, growth, promotion, fronts, seasons, the stance quota | Stop | Run, at the rates of [§3.5](#35-tempo-and-the-nested-schedule) |
| Ambient class-0 texture sown by the director | Stops. The city's own events still happen and still show | Runs |
| An author's `grow` invitation | Not honoured | Honoured |
| Baton, nudges, refresh traces | Stop | Run |
| Fitter, hooks (fit, form, hold, score, joint, channel, band, cause) | Run, for authored seeds and anything already sown | Run |
| Thread view, budgets, pacing state | Run | Run |
| Model fold | Runs if `noticing` allows | Runs if `noticing` allows |

**The dial scales how much the engine sows. It never changes how a decline is handled.** For authored and already-sown seeds every rule in this page holds at every setting, `off` included. Lower settings never make up for it with pressure.

## 5. Fitting

### 5.1 The role

Fitting is a **service**. Given a seed, it decides what the seed left open: when, where, why now, through which channel, and what connecting material joins it to the world and to V's history. It works for authored seeds and for the engine's own kits, by the same code, and it works at every tempo, `off` included ([D-03](decisions.md), [DS-41](design-seeds.md)).

Its rules come from the author's priorities ([foundation §6](foundation.md#6-story-in-the-same-space)):
- **Fixed parts are immutable** to it. It reports a fixed part that layer 2 rejects as an unfillable seed.
- **Preferred parts** are honoured where possible; layer 2 already weights them by strength.
- **Open parts** are its to fill, inside the seed's `latitude`, the player's fitting setting and the cost threshold.
- **Everything it adds is tagged fitter-supplied.** It can be shown in the fit report, switched off by the latitude setting, and traced.
- **It generates, then checks, then offers.** The last stage is a verifier. "Cannot adapt" and "no fit, and why" are legal outcomes.

**A note on words.** S2's phrase "the director off" means *no layer 3 at all*: the first implementation, and the control arm of the tests. It isn't the tempo `off`. At tempo `off` the fitter and the hooks still run.

### 5.2 What is fitted

| Decision | Inputs | How it reaches layer 2 |
|---|---|---|
| **Who and where** | The candidates layer 2 finds; `intent.aesthetic` and tone; familiarity; claims held by live seeds | Fit weights on the casting draw ([S2 §5.2](spec/seeding.md#52-casting-one-role)) |
| **Which variant, mode and alternates** | The same inputs, plus variety counters | Fit weights on those draws |
| **When** | The windows, `lead` and `urgency` ([§3.8](#38-lead-urgency-and-dread)); the phase; the attended set; "no major beat nearby" | A lead aim that the hold hook enforces; the score hook |
| **Why now** | The acts in V's record that match `historyHook.kinds`, at the exposure grade the seed's callback declares; recency, distinctiveness and the cue rules of [§6.6](#66-other-sources-callbacks-and-the-telling-rules) | A fill: a `hook`, `callback` or `holocall-hook` bound to a recorded act. If none exists, the proposal says so |
| **Channel** | The fragment's ladder; the game options; the tier table | The channel hook drops rungs. It never reorders |
| **Connecting material** | The `needs` of the seed's first beats against the world | A fill, or a **bridge**: a small glance or encounter seed from a library, sown as a child, whose events make the parent's `needs` true. Search depth is two library steps |
| **Adaptation** | The seed's `adapt` points and their cost classes | Costed edits: a location swap, a delay, a stand-in, a new named character |
| **Trace causes** | Found and surfaced causes first | The cause hook, only if `latitude` allows `trace-cause` |
| **Form** | The player's time budget; V's engagement | The form hook |
| **Coherence** | Shared role, place or consequence between threads | A fit weight; a flag on a thread that touches no other |

### 5.3 The proposal and how it enters layer 2

```ts
interface FitProposal {
  seed: Id; basis: { instanceRevision: number; castHash: string };   // what it was computed from
  verdict: 'fits' | 'waits' | 'no-fit'; why: string[];              // plain reasons
  options: Array<{ choice: string;                                    // a layer-2 draw key, e.g. "fill:beat-3.play"
                   candidates: Array<{ value: string; weight: number; cost: CostClass; source: 'found' | 'surfaced' | 'constructed' }> }>;
  bridges: Array<{ kit: TemplateId; overlay: Partial<Seed>; leaves: Pred; cost: CostClass }>;
  edits: Array<{ part: PartPath; from: string; to: string; cost: CostClass }>;
  aim?: { release: 'early' | 'preferred' | 'late'; urgency: number };
  total: CostClass;                                                   // the largest class used
}
```

**The fitter proposes; layer 2 draws.** For each open part the proposal lists candidates with weights. Layer 2 makes the draw on its own keys ([S2 §3.4](spec/seeding.md#34-layer-2-draws)), records it in the instance's `draws`, and installs the result. So all choice stays on layer 2's keys, and a reload reuses what was drawn. The fitter has no random numbers of its own.

**When it runs:**
1. When a seed first reaches `cast` (T4), as a read-only dry run on the tentative cast. Nothing is in effect ([S2-I-3](spec/seeding.md#13-invariants)).
2. Again when its basis changes while the seed is unreleased: a cast is lost, a window changes, a relevant fact moves.
3. At prepare ([S2 §8.4](spec/seeding.md#84-prepare-then-confirm)), as the verifier.
4. At the first release, when layer 2 commits it. From then on the proposal is **write-once**, stored with the instance (`fits`, [§10](#10-what-the-kernel-and-s2-still-need)).
5. For each later beat, when that beat is prepared. Connecting material then uses the world as it is.
6. On `refit`, when a fixed part is rejected and the author allowed re-fitting that part.

The fit report calls the same function. The report under a director policy is therefore the real thing, not a copy.

### 5.4 Latitude and cost

An author's `latitude` says what kinds of material may be added, what may not, and which parts are authored-only. The player's fitting setting (`minimal`, `standard`, `generous`; default `standard`) sets how far the fitter may go inside it. The author's `forbid` always wins.

| Material | Cost class | `minimal` | `standard` | `generous` |
|---|---|---|---|---|
| `callback`, `hook` (a history hook from V's record) | cheap | yes | yes | yes |
| `location-swap`, `delay`, `holocall-hook` | cheap | no | yes | yes |
| `bridge-beat` | moderate | no | yes | yes |
| `trace-cause` (a constructed cause) | moderate | no | yes | yes |
| `stand-in` | moderate | no | no | yes |
| `new-named-character` | costly | no | no | yes |

A proposal whose total class passes the setting's threshold is "not offered". Moving a scene to the next district is cheap. Changing the giver's motive is costly. Changing the end state is refused.

### 5.5 Verify, fall back, report

**The verifier** checks the proposal against the author's intent: the end state is still reachable (S2's stuck check), no prohibition can become yes, every role and window holds, text guarantees aren't relaxed, content ceilings hold, and the filled document lints clean at its maturity. A proposal that fails is thrown out, not repaired.

**The fallback order**, with a named end for every path:
1. Wait, if a window is open or pending.
2. Relax by the role's ladder; use a stand-in if the latitude allows.
3. Play a shorter or degraded form.
4. Withdraw with a coda or a memory, or leave no residue if nothing has played. The seed's window close policy decides.

**The fit report** gains what S2 left empty: the connecting material, its cost and source, the release aim, the channel rungs kept and dropped, and "no fit, and why" in plain words. An author can pin any fitted choice back as fixed. The report runs over several settings vectors: tempo, `noticing`, fitting. Run with sowing on and off, it gives the same fit.

**Fixed parts that lose.** If layer 2 rejects a fixed part ([S2 §3.5](spec/seeding.md#35-watching-fixed-parts)) the fitter either re-fits it (`refit`, inside latitude), or the seed degrades or withdraws by its own policy. It is never silent.

### 5.6 Contests and the engine's own re-casting

[P4 §7](p4-seeding-layer.md#7-open-questions-for-s2) left one question for this page: what rule governs a procedural seed against the engine's own re-casting?

S2's claim priority stands: authored beats procedural, committed beats tentative, then the earlier commit, then the lower `Id` ([S2 §9.2](spec/seeding.md#92-settling)). Layer 3 adds **yield before contest**, so that the priority rarely has to be used:
1. The fitter prefers a candidate no live seed holds, with a soft weight.
2. If every candidate is held by a committed procedural seed that V has been shown, and the authored seed's window allows, the authored seed waits. It displaces only when waiting would close its window. The displaced seed then runs its own `onLost` ladder, and nothing already shown is rewritten.
3. The sower never sows a procedural seed whose anchor role has no uncontested candidate.
4. A procedural seed that lost a claim re-casts through its ladder once. It can't take a node from another committed procedural seed.

### 5.7 Reference scenario R1

The seed is [S2 Appendix A.3](spec/seeding.md#a3-reference-scenario-r1): the character, the ladder, the exits and the intimate scene are fixed; the place is preferred; the moment, channel, hook and connecting material are open; the latitude allows callbacks and a holocall hook and forbids new named characters.

| Decision | Inputs | Result |
|---|---|---|
| When | The window is open; `lead: preferred`; no climactic thread attended; phase `build` | Aim at the first receptive joint after five play-minutes; the hold hook enforces it; the window's hard deadline still stands |
| Why now | V's acts since the window opened that match the history hook, at `confirmed` | A hook naming one specific earlier act. If none exists, the report says "no history hook" and the seed uses its plain opening |
| Channel | The ladder: holocall, message, thread entry; the game options | A holocall if the contact and moment allow; the channel hook drops it if calls are off |
| Where | A quiet place, preferably in the preferred district, uncontested | Fit weights on the place draw; the cast is read-only until the first release |
| Connecting material | Latitude: callback and holocall hook | One lead-in line, tagged fitter-supplied. No bridge needed |
| Check | The intent triple; the roles; the window; the prohibitions | Offer, or "no fit, and why" |

| Story state | What happens |
|---|---|
| Before the earlier quest is done | The seed waits. It watches one fact |
| The character is dead | The window never opens. The report says "not applicable: dead". The seed withdraws and leaves no residue |
| Window open, V nearing the place that closes it | Urgency rises; the aim moves earlier. If the window closes, the coda plays |
| V already has a partner fact | The seed doesn't write or contradict it. It selects its friendship variant, a draw the fit weights may tilt but can't override |
| Past the point of no return at install | The window is closed. Nothing is offered |

## 6. Sifting

Sifting asks "what story is in the record?". It runs as a pipeline, not as a score: simulate, match patterns against events, keep the matches that survive, then choose ([dossier 6](craft/d06-sifting-tellability.md)). The sifter finds and keeps; the sower chooses.

### 6.1 What the sifter reads

The sifter's input is the **live Change stream** plus whatever it chose to keep. It is not a log to scan later: resolution, regeneration and replay are silent ([S0 I-13](spec/kernel.md#15-invariants)), and non-canon events can be forgotten ([S0 §7.3](spec/kernel.md#73-retention-and-forgetting)). Two domains follow:
- **The V chronicle** is what V did and what it touched. It is sparse and certain, and it is the base for callbacks.
- **The world chronicle** is what simulated people and groups did. It is as rich as S1 makes it.

How the Changes arrive:
- Each pattern owns one frame of the `director` ([§2.5](#25-the-directors-root-actor-and-frames)). The frame carries a `reactsTo` interest for **every clause** of its pattern. The kernel emits at most one relevance event per change, frame and interest type, so one frame per pattern keeps patterns from masking each other. Within a pattern the sifter tests the Change against the first clause (start a match) and against the next clause of each partial match in the pool (advance it) ([dossier 6](craft/d06-sifting-tellability.md) G-5).
- `Dilemma`s arrive as the kernel's emissions ([S0 §10.8](spec/kernel.md#108-effects-and-cross-pressure)). Each starts a match, is dropped by a stated rule, or is logged unused.
- The gaps dossier 6 found are settled in S0 v4: `outcome` and `served` on events, a `frame` Change, the Dilemma's recipients, and records under a layer's own id. The others have routes that leave the kernel alone: S1 mints events for telling, lying, goals met or dropped, and fine-tier acts, and betrayal and deceit are pack event kinds with tags.
- **Volume.** S1's Change stream to the sifter is bounded at about ten Changes per game hour for the whole city **[tunable]** (events of size m2 and above, band changes, chains). The sifter's cost per Change is counted in the tick budget: one unit per pattern first clause tested and one per partial match advanced.
- The sifter never matches its own sowing (the `contribution` Changes of its seeds) or its own `meta:` events, except in patterns that read `meta:` kinds on purpose.

### 6.2 The pattern form

A pattern is pack data, versioned, read by a generic loader ([DS-38](design-seeds.md)). It carries **structure and tags only**. Tellability weights live in engine code over matches, never in a pack.

```ts
interface SiftPattern {
  id: string; version: number;
  roles: Record<string, { kind: KindId; where?: Predicate[] }>;      // ?host, ?guest …
  stages: Clause[];                                                   // ordered; one Change each
  unless?: Array<{ between: [number, number]; clause: Clause }>;      // negation between two bound stages
  within?: number;                                                    // game seconds from the first stage: expiry
  once?: string[];                                                    // role names: a tombstone per binding
  tags: string[];                                                     // for quotas and diversity
  keep?: number;                                                      // the stage at which the match is promoted to a seed (§6.5)
  tellings: Telling[];                                                // what it can become (§4.2)
}
type Clause =
  | { c: 'event'; kind?: KindId | { tag: string }; who?: Array<{ role: string; as: string }>;
      effects?: Array<{ on: string; effect: Effect }>; where?: Predicate[] }
  | { c: 'edge'; type: EdgeTypeId; from?: string; to?: string; ended?: boolean }
  | { c: 'dilemma'; actor: string; target?: string; effect?: Effect; minSeverity?: number }
  | { c: 'belief'; believer: string; subject: string; path: SlotPath; differsFromPin?: boolean }
  | { c: 'frame'; actor: string; status: 'satisfied' | 'abandoned' | 'blocked' };
```

**An invented example, as a sketch and not the schema:** a gang member is ordered to kill their own brother.

```yaml
pattern: xf.example:order-against-kin
roles: { ?m: person, ?g: group, ?x: person }
stages:
  - dilemma: { actor: ?m, target: ?x, effect: kill, minSeverity: 0.3 }
  - event:   { by: ?m, effects: [ { on: ?x, effect: [harm, kill, protect, rescue, expose] } ] }
unless: [ { between: [0, 1], event: { by: ?g, withdraws: the order } } ]
within: 6 game days
once: [ ?m, ?x ]
tags: [kin, loyalty, order]
keep: 0                      # promote at stage 0 if V's record touches ?m, ?x or ?g
tellings:
  - { atStage: 0, form: rumour,     kit: xf.starter:rumour,   binds: { subject: ?m, other: ?x } }
  - { atStage: 0, form: foreshadow, kit: xf.starter:sighting, binds: { subject: ?m } }
  - { atStage: 1, form: recap,      kit: xf.starter:recap,    binds: { subject: ?m, other: ?x } }
```

**Load rules.**
- Every clause names the event kinds, slots and edges it reads and the layer that produces them. A pattern with no producer is rejected at load.
- A pattern's `tellings` must name kits that exist and serve the form.
- Patterns are tried in `id` order, partial matches in creation order. Ties go to the lower `Id`. Any random choice uses a keyed stream. Nothing reads a wall clock.

### 6.3 The pool

The pool holds partial matches as **copied descriptors**: ids, kinds, times, roles and tags. It holds no live node references, because a non-canon event can be forgotten.

| Bound | Starting value |
|---|---|
| Entries per pattern | 32 **[tunable]** |
| Entries overall | 256 **[tunable]** |
| Expiry | The pattern's `within`, checked at each simulation window boundary |
| Duplicates | Suppressed by `(pattern, bindings)` |
| Tombstones | One per `once` binding, kept until the pattern's expiry has passed twice |

A partial match advances when a Change satisfies its next clause. An `unless` clause that matches between the bound stages kills it. A completed match is minted as a `meta:story-end` event ([§6.5](#65-promotion-and-hand-over)). The pool is the sifter's join memory: a kernel interest tests one Change against one frame, and doesn't remember that `?host` bound to a particular node two Changes ago.

**The pool is persisted**, bounded as above, in the layer-3 record ([§7](#7-determinism-persistence-and-state)). It is a cache: a save without it loads with an empty pool, as a save without the model does. [§9](#9-where-the-dossiers-disagree) says why this differs from dossier 6.

### 6.4 Gates and features

The sifter computes the features of [dossier 6 §5.5](craft/d06-sifting-tellability.md#55-features-a-procedure-could-score) for each candidate, from named record fields. A feature with no field is dropped.

| # | Feature | Role | Reads |
|---|---|---|---|
| F-1 | Reportable change | Gate | An event with effects, canon or committed |
| F-4 | A human at the centre | Gate and score | Named persons or groups as participants; recurrence |
| F-8 | Causal coherence and focus | Gate and score | `causes`, participants; chain length (at most four links) |
| F-12 | A showable cause | Gate | At least one cited cause path; provenance |
| F-2 | Deviation from expectation | Score | The match against its own pattern's other matches; an actor acting against its own frame's interests |
| F-3 | Stakes | Score | Effect kinds on targets; the relevance `r` of the interests touched; `Dilemma.severity` |
| F-5 | Familiarity and personal link | Score | V-observed pins and events V witnessed or took part in; recency |
| F-6 | Irreversibility and novelty | Score | Effect kinds in an irreversible set; ended memberships with high exit cost; distance from earlier offers |
| F-7 | A live gap | Score | A belief that differs from the pinned truth; a concealed membership; a partial match awaiting its outcome |
| F-9 | Closure | Score | Frame status; the pattern's stage |
| F-10 | Valence and arousal mix | Score across offers | Effect kinds and tags |
| F-11 | Timeliness and continuity | Score | Time since the last event; the seed lifecycle record |

- **Gates before scores.** Scores are ranks or bands that keep their feature values. Thresholds are data.
- **The audience is V's observed record.** The scorers take what V did and saw as input. They never assign or assume V's drives. Deviation scores must hold across the Vs the engine can't yet tell apart.
- **The model doesn't choose what is sown.** Sowing is a structural choice, so the sower's draw never reads the player model (S2 §8.8). The model's only influence is later, when formed offers are ranked or deferred at release. It never enters a gate, a pattern match or a feature ([dossier 12](craft/d12-player-model-trust.md) S12-P5-05, narrowed by S2 v1.0).
- **Whether the features help is unproven.** The one reader test of generic tellability heuristics was a null result. They are hypotheses with logging, and [§8](#8-logs-audits-and-evaluation-surface) lists the controls that test them before they steer a live session.

### 6.5 Promotion and hand-over

**Promotion** turns a partial match into a live seed. It happens at the pattern's `keep` stage, or when the sower selects a candidate whose telling asks for a seed. Before it, the match is a descriptor in the pool. At promotion:
1. The sifter mints one inert `meta:story` event: creator `director`, participants the bound roles, causes the constituent events, no effects, no witnesses.
2. The match record moves to the layer-3 record with its events as **retention roots**, so they survive until the seed ends.
3. The sower sows the telling's kit with the story event as a role. Fragments read the story through ordinary role predicates, and `trace` walks from the seed to every constituent event.

**A completed match** is minted as a `meta:story-end` event, with the opening event and the final event as its causes. It reaches the sifter's own patterns, so that stories can compose, and the tools. S1's behavioural policies ignore `meta:` kinds.

**What the hand-over carries:**

| Item | Rule |
|---|---|
| Bound roles | Fixed. They are events already in the record |
| Cited cause paths | Become `because` links and the why-trace |
| A stake line and a lead line | Inputs for S7. The lead and the point belong to staging, not to selection |
| Feature values and the stage reached | Logged with the decision |
| Complete or partial | A completed story is told as a recap, a rumour or a callback. A partial one as a foreshadow or an offer. The kit's form follows |

Promoted matches persist as seed state. If a pool match's events are gone before it is promoted, the match ends and the loss is logged.

### 6.6 Other sources, callbacks and the telling rules

**Other candidate sources inside sifting:**
- `Dilemma` emissions (prospective: no event has happened);
- belief against truth, through the events S1 mints for telling and lying, checked by query when a match is already running;
- frame-status turns, such as a goal blocked and then met;
- completed `meta:story-end` events, for composition;
- **turns:** a witnessed "before", then a `turning` event, is a tellable chain, ranked by exposure and reader count. An unwitnessed turn goes to news or a sighting.

**Planning and search.** Planning is a depth-bounded validator and bridge-builder for short chains, over NPC and group goals only. It never plans V's acts and isn't the generator. Casting uses the kernel's queries and contributions, with no external solver. Ordering and pacing policies are precomputed or bounded by the work allowance, with no online search over stories.

**The callback finder** sifts the chronicle for acts V confirmed. A callback cites an exposed event and names an **act**, never a reason.
- **Cue strength** rises with the play seconds since the exposure (`playTotal`), with the wall gap at the loads in between, and with the number of similar events since. The wall-gap weight is **[tunable]** and is read only here and in the return view.
- **Echoes.** The echo finder retrieves candidate pairs by carrier (object, place, phrase), filters on matching stance structure and a recorded change, and applies the same cue rules.
- **Far callbacks** are used at a low tunable rate.
- **Hedging.** A `presented` entry gets the hedged form. A channel is named only for `confirmed` entries.

**The telling rules** the finder obeys:
- **Attribution check before naming.** Name a cause only if it has priority, consistency (a controllable path of at most k events **[tunable]**) and exclusivity. If a more proximate rival cause is on record, name it or stay silent.
- **Telling budget.** At most one named-act reference per scene unless it is a closure scene, scaled by the act's stakes. Show first. A quiet setting lowers it.
- **Pattern lines** appear only from at least three acts of one kind, as a witness's observation, with no identity claim.
- **Record integrity.** No response contradicts an event its speaker witnessed. Forgetting follows a stated rule.
- **Delay cues.** A planned delayed consequence puts an `expect` cue on the act's event. Without one, the callback carries a stronger anchor.
- **Rumour and news.** S1's telling operators (leveling, sharpening, assimilation, one per hop) change a belief as it travels. S3 chooses which items to surface, from freshness, with an archive, and the afterglow of a closed seed comes from its carriers.

**The focal set.** The director keeps a derived `focal` view: people V talked to, scanned, followed or was addressed by. S1's materialisation pays for identity continuity and detail for them; others may swap. The most recent focal people are retention roots in the layer-3 record, up to a cap.

**Authoring.** `preview(pattern, log)` runs a pattern over a recorded or simulated log and lists what would match. P6 and P10 put it in the authoring loop. Time to a working pattern is a measure.

## 7. Determinism, persistence and state

### 7.1 What is state, and where it lives

| State | Kind | Persisted? | Rebuilt by |
|---|---|---|---|
| Pacing state: `A`, `N`, `T`, `engaged`, phase, timers, strain | Session | No | Restarts in settling at a load |
| The opportunity schedule's position | Derived | No | `playTotal` and the hashed slot draws |
| Thread view and attended set | Derived | No | The layer-2 records, stamped with `playTotal` |
| The player model | Beliefs `director → v` | Yes, as memorable beliefs | A fresh fold of canon events, after the floor |
| Settings (tempo, `noticing`, exclusions, floor, fitting, time budget) | Recorded ops | Yes | Replay |
| The sift pool | Layer-3 record | Yes, bounded | A cache: absent means empty |
| Promoted matches, with their retained events | Layer-3 record | Yes | Kept until the seed ends |
| Tombstones (`once` bindings) | Layer-3 record | Yes | Pruned at expiry |
| Rungs, return and outcome counters | Layer-3 record | Yes | A cache: a fold of observed events after the floor |
| The focal set | Derived; retention roots listed in the record | Yes | From observed events |
| Fit proposals | Layer-2 instance state | Yes, write-once after commit | A fresh proposal before commit |
| Why a seed was sown | Layer-2 instance `source` | Yes | |
| Constructed causes | Kernel contributions and `committed` pins | Yes | |
| Repeat counters and run lengths | Derived | No | The exposure ledger |
| The decision log and the rivals ring | Session ledger | No: local, never part of the save | |

**The layer-3 record** is one `SeedRecord` under the id `H("root", worldSeed, "layer3")`, as S2 keeps its global record ([S0 §14.1](spec/kernel.md#141-what-is-persisted)). Its `nodes` are the retention roots: the promoted matches' events, subjects at recurring or above, and the capped focal set.

```ts
interface Layer3State {
  schema: number;
  pool: PoolEntry[];                                  // descriptors, in creation order; capped
  matches: Record<MatchId, PromotedMatch>;            // the opening event, the bound roles, the seed, the stage
  tombstones: Array<{ pattern: string; key: Id; until: GameTime }>;
  rungs: Record<Id, { rung: Rung; since: GameTime; returns: number; outcomes: number; lastReturn: number; floor: number }>;
  focal: Id[];                                        // capped
}
```

The save-size cost is bounded: 256 descriptors of a few hundred bytes each is tens of kilobytes at the cap. P7 measures it before any cap is fixed. A save without this record loads normally, and layer 3 starts empty.

### 7.2 Determinism

1. **Same inputs, same outputs.** The inputs are the documents, the packs, the world seed, the kernel operations, V's responses, the timestamped session inputs and the settings in force ([S2-I-1](spec/seeding.md#13-invariants)).
2. **Keyed randomness only.** Every random choice in layer 3 uses `rand("s3-…", worldSeed, …)`, keyed on stable ids and `playTotal`-based indexes. Nothing reads the session epoch, a load count, the play clock or the wall clock ([S0 I-16](spec/kernel.md#15-invariants)). Layer 3's own keys carry an empty `salt`, recorded as an op if ever set. That gives the "fresh draws" test arm.
3. **Order.** Patterns run in `id` order, partial matches in creation order, candidates in key order. Ties go to the lower `Id`.
4. **Arithmetic** is S0 §1.3's only, so the TypeScript oracle and the native core agree.
5. **Hook outputs are computed at release and stored.** Nothing is recomputed at display.
6. **Sowing depends on the record and a keyed draw per candidate**, not on pool order or pacing state. The decision id is `H("sow3", worldSeed, candidate.key)`.

### 7.3 After a load

| Same as before the save | May differ |
|---|---|
| The schedule, the pool and its candidates, the sowing decisions, the instances and their offer `Id`s, the model, the rungs | When the next push is released, because pacing restarts in settling and the arbiter's timers restart |

One divergence remains: a match that was still forming from events that **only** the lost session had seen. The pool is saved at each save, so the window is the time since the last save. A test measures reload divergence over repeated loads of one save. It is recorded in [§11](#11-compromises).

Layer 3 is **branch-local**. The model, the pool and the counters start empty on a new branch and are never read across branches or playthroughs.

## 8. Logs, audits and evaluation surface

Layer 3 doesn't run the evaluation. It makes every decision explicable and gives the harness what it needs without running the engine.

### 8.1 The decision log

Every director action and every sowing, hold, fit, form, score and withdrawal writes one entry to the session ledger:

| Field | Content |
|---|---|
| id, kind, purpose, manipulativity class | From a closed vocabulary |
| Planned and actual time | Play seconds and `playTotal` |
| Inputs | Only the closed lists of [§3.1](#31-what-it-senses) |
| Rule applied | Which gate, hold, band or budget fired |
| Explanation chain | To a recorded fact, or to a cause marked `constructed` |
| For a sowing | The pattern id and version, bindings, raw feature values, rank, the rivals and why this one won |
| For a hook with a non-zero output | The belief ids and the delta (also kept in the delivery's `provenance.why`) |

An agent-facing `explain` lists the facets, events and caps that applied. A closed rendering table turns reasons into one plain sentence in the settings voice, citing only exposed events. The rivals are kept in a ring and not saved.

### 8.2 Static audits (every build)

| Audit | Fails when |
|---|---|
| **Hook inputs** | A hook reads anything outside the closed list. A fixture perturbs the forbidden inputs and expects identical outputs |
| **The objective** | The listed objective ([§3.9](#39-the-player-model)) holds a return, length, streak, quit or idle term |
| **Read sets** | A registry function reads the `director → v` beliefs, or a hook reads a seed field it isn't allowed to. The firewall table of dossier 12 §5.1 runs as a test |
| **Exposure grades** | A director rule reads presented or confirmed rates as a retention signal |
| **Manipulation classes** | A class-4 action exists, or any action changes a unit's strength |
| **Forbidden mechanisms** | S4's list: streaks, countdown guilt, quit-timed content, and the others |
| **Decline audit** | A decline-triggered effect falls outside the offer's stake set, carries blame text, cites V's absence instead of other actors' frames, or has no exposed portent |
| **Escalation guard** | Consecutive offers from one thread rise in ask size with no world-side cause |
| **Review records** | A director mechanic has no dark-pattern review record |

### 8.3 Switches, services and the session ledger

**Arms** for the harness: the director on, a fixed schedule, and a random release that obeys only the hard gates; `noticing` off and `acts`; baton, promotion and street projections each on and off; each feature's weight zeroed in turn; stable draws against fresh ones (the layer-3 salt); the three fitting settings.

**Read-only services.** They are offline in the first implementation, and the harness and P10 call them:

| Service | What it does |
|---|---|
| Argument profile | Computes the profile of a premise over a scope from seeds, offers, responses, canon events and the exposure ledger. Reports match, dominance and reward mismatches. Reports `insufficient` below about 10 to 40 offers in scope, never judging by three |
| Reward-policy audit | Reads reward tables and route facts against each premise. A mismatch needs the premise's `intended` note |
| Arc recogniser | Labels runs of turning events (revision, refusal, corruption, revelation, none). For measures only, never a generation target |
| Branch-diff harness | For a save and a pair of acts (A, A one second later, B), runs the engine and reports the record diff, its size, its containment in the causal cone, and option distinctness. It also serves the tree view |
| Completion detector and scale label | Compare a seed's recorded changes against its declared level |
| Texture share, pull share, reload divergence, forgetting lints | Computed from the logs |

**The session ledger** is local and per session, never part of the save. The harness computes the measures of dossiers 7, 8, 10, 11, 12 and 13 from it without running the engine. Texture beats are counted, and no more than two in a row occur inside a gig.

## 9. Where the dossiers disagree

| Question | The positions | Choice and why |
|---|---|---|
| Is the sift pool saved? | Dossier 6 R-28: no, it starts empty after a load, with a ledger entry. Dossier 11 S11-P5-03: sowing must not depend on lost state, and reload divergence must be measured | **Saved, bounded, as a cache.** A few tens of kilobytes at the cap buys a schedule and a set of candidates that a reload doesn't change, which is the simpler thing to reason about and to test. The dossier-6 escape stays: a save without it loads with an empty pool |
| What counts as an attended thread? | Dossier 7 PR-32: threads that reached V's awareness. Dossier 13 S13-P5-09: threads with a cue that reached `presented` | **The `presented` cue.** Awareness is the claim, and exposure grades are how the engine tells. It also counts the working-memory limit honestly |
| Is there a separate receptivity belief? | Dossier 7 PR-21: yes, with a probe step. Dossier 12 S12-P5-07: it is a facet rate and nothing else | **A facet rate.** One estimator, one set of confidence states. The "class-0 version first" step survives as a decision rule on thin facets |
| What does the `relevance` drive run on? | Dossier 1 §12: the share of offers matching the belief about V, which can run on facet rates. Dossier 12: no | **V's observed record.** Keeps the model out of relevance |
| Names of the `noticing` values | Dossier 12: `off`, `acts`, `approach`. S2 (later): `off`, `acts`, `full` | **S2's.** T2 counters are deferred anyway |
| Leverage and next-belief spread | Dossier 7 PR-33: compute them from outcome weights | **A proxy.** The language declares no outcome weights, and a decision beat is already tagged. Decision beats are booked into the first receptive window after a rest |
| Per-tempo thread sub-caps | Dossier 7: flat caps. Dossier 8's toy model tried `classed` caps | **Flat.** The toy shows little gain. Revisit only if M8-02 shows fast threads starving |
| Who owns stage dwell caps | Dossier 7 PR-36: the director | **The kit data, checked by lint,** with the director enforcing only composition. A cap in data can be read, linted and tested |
| The away marker | Dossier 7 PR-20: a director state | **Layer 2's overlay.** S2 already runs it, and it keeps input silence out of the director |

## 10. What the kernel and S2 still need

**Kernel (S0).** Almost nothing.

| # | Need | Why |
|---|---|---|
| K-1 | `SettingsSet` gains `fitting` (`minimal`, `standard`, `generous`) and `timeBudget` (optional) | Both change what is offered, so they are recorded ops, like `noticing` |
| K-2 | A clarification in [§10.5](spec/kernel.md#105-changes-and-matching): a frame may carry many interests for one pattern, the emission carries the Change payload, and pattern frames come and go with packs | The sifter's design depends on it |

Promoted matches, rungs and counters use the existing per-layer record (V4-7). `meta:` kinds are pack schema (S4), and S1's policies ignore them.

**S2 (for a v1.1).** S2 v1.0's core governs the first implementation. **Needed for the core:** N-1, N-2, N-6 and N-7. **They follow S2's later capabilities:** N-3 to N-5 and N-8 to N-11. Of N-5, the cause and band hooks go with constructed causes and projections; the channel hook goes with channel ladders.

| # | Need | Why |
|---|---|---|
| N-1 | **Fits.** `InstanceState.fits`: computed at `cast`, verified at prepare, committed at first release, write-once. A fill step in [§8.4](spec/seeding.md#84-prepare-then-confirm). Invalidation when the basis changes | [§5.3](#53-the-proposal-and-how-it-enters-layer-2) |
| N-2 | **A sowing request with an overlay.** `story.seed@1` takes `{ template, overlay, parent, growsFrom, localName, decision }`. The overlay is a `Partial<Seed>` limited to role identities and extra `must` terms, durations, `timing`, `stakeScale` and persistence flags. It is linted with the template and stored in the expanded document | [§4.4](#44-instantiation) |
| N-3 | **A `grow` invitation** on `Seed`: `{ kits: Form[]; max: number }`, honoured at tempo above `off` | [DS-37](design-seeds.md) |
| N-4 | **A `cue`** on a seed: a class-0 or class-1 fragment that re-finds the thread | Baton, resume line, re-situating, refresh |
| N-5 | **Three hooks named:** cause (already used in fixture SF-26), band, channel. The phase hook is also the hold hook, and may hold for any reason | [§2.4](#24-the-hooks) |
| N-6 | **A read-only view API** for layer 3: parent and cast links, attended-set inputs, loose ends, closure entries, exposure queries, deliveries with grades, record entries by `playTotal` | [§2.3](#23-the-doors) |
| N-7 | **Withdrawal with a closing trace** for engine-sown seeds that V saw | [§3.6](#36-threads) |
| N-8 | **`warm(seed, beat)`**: raise the focus tier of a beat's role frames ahead of a scheduled release | [§3.8](#38-lead-urgency-and-dread) |
| N-9 | **Jump cues.** The first delivery after a jump carries the list of changed dimensions in its provenance, for S7 | [§3.7](#37-sessions-jumps-and-returns) |
| N-10 | **Dread kit durations** are linted against the stage caps, if the dread lint doesn't already do it | [§3.8](#38-lead-urgency-and-dread) |
| N-11 | `noticing` values `off`, `acts`, `full` confirmed, with T2 deferred | [§3.9](#39-the-player-model) |

**Other specifications owe layer 3:**

| Spec | What |
|---|---|
| S1 | Events for the sifter (telling, lying, goals met or dropped, betrayal and deceit as tagged kinds, fine-tier acts); policies that ignore `meta:` kinds; outlets with a divergence profile; the recall function; a memory policy that calls S3's `memorable` rule; the NPC change, rationalisation and reputation policies (S10-P5-07, -08, -13) |
| S4 | The kit manifest (`serves`, `from`, `binds`, sowable by the director); the sift patterns and their `tellings`; the tempo bundle; channel tier tables; facet cards; premises; the closed vocabularies; the spine flag; the forbidden-mechanisms list |
| S5 | The sense list; the game option settings; display reports; the away marker |
| S7 | Rendering the changed dimensions and the cues; enforcing the channel word budgets where text is composed |
| P6 | The settings surface (the dial, `noticing`, fitting, the time budget), the noticed page and the disclosure |
| P7 | Where the sower and the sifter run; the pool's cost and the save's size |
| P9, P10 | The arms, the measures and the inspectors that read the decision log |

## 11. Compromises

Departures from the model, for the [ledger](foundation.md#9-the-reference-model-and-the-compromise-ledger):

| # | The model says | This design does | Revisit when |
|---|---|---|---|
| C-S3-1 | The director is an actor whose drives are frames | Its five drives are terms in its rules. Only pattern frames and V's inferred frames are kernel frames | A rule needs relevance matching through the director's drives |
| C-S3-2 | A partial story is a seed, an actor with its own interests | Partial matches are descriptors in a bounded, saved pool, joined by the sifter. One frame per pattern carries the interests | Pool measurements show seeds are cheap enough |
| C-S3-3 | Opening a subject is the Open operation | A subject is opened by sowing a promotion kit, so every opening passes the gates | A promotion needs something a kit can't express |
| C-S3-4 | Fitting is query, sample and contribution | Fitting is bounded search over a small library, then a check. It isn't planning | Authors need bridges deeper than two steps |
| C-S3-5 | Every choice is explainable by kernel `trace` | Layer-3 choices aren't kernel pins. The decision log holds them | A tool needs `explain` on a sowing decision |
| C-S3-6 | Reload leaves the world's future unchanged | Pacing restarts in settling, so release times differ. A match that formed only in the lost session is lost | Players report reload-fishing, or measured divergence is above 10 per cent **[tunable]** |

## 12. Open questions for S3

1. **Pool cost and save size.** What does a pool of 256 cost per Change at the cap, in the native core? Does persisting it hold up? (P7.)
2. **How many patterns and kits does a city need** before the sower stops starving? A first library of a few dozen, with a measure of how much of the record they cover, would tell us.
3. **Who writes the tellings.** Patterns name their tellings. Is that too much for authors, and should a default be derived from the pattern's shape?
4. **The fitting setting.** Is a three-value player setting worth it, or should latitude come from the author alone? (P6, and a call for the maintainer.)
5. **Calibration.** The lead aims (0.35 and 0.7), the 45-minute attended window, the beat intervals, the thread budgets and the band composite's weights are starting values. P9 moves them.
6. **T2 counters and the orientation index.** Build only if panels show an acts-only model is too thin.
7. **The stance quota.** Default off even with a premise in force, or on?
8. **The tip-off.** Does an ordinary `expose` event with a witness let a hostile thread find V, or does S1 need a policy?
9. **The salt.** Layer 3 salts its own draws. Does the "fresh draws" panel need layer 2's draws freshened too, which S2 deferred?
10. **Where the sower runs.** On the slow loop of the companion, or on the simulation window cadence? (P7.)
11. **The starter pack.** Which kits ship with the engine, so a world with few packs still has something to tell?
12. **Starvation by holds.** Do the 70 per cent relaxation and the holds starve low-importance sown content? (M8-02.)

## 13. Simplicity check

**What there is:** four parts; two doors out; nine hooks in three families, each with a bound; six verbs; one pattern form; one schedule, thinned by a threshold; one saved record; one estimator for the model, over two facet families. Kits, patterns, budgets and tables are data. Every mechanism traces to at least one dossier requirement ([§14](#14-requirements-trace)).

**What there isn't, on purpose:**
- no planner and no external solver;
- no separate receptivity belief;
- no per-tempo thread sub-caps;
- no director drives as frames;
- no thread type in the language;
- no fitted formula for tellability;
- no content of its own: it selects kits and fragments from packs;
- no text: S7 renders;
- no hidden channel to V, to an NPC, or from the model into content.

**The first implementation.** It is the offline prototype ([plan M3](plan.md#4-milestones)). It should carry the least that tests the idea:

| In | Deferred, and what stands in |
|---|---|
| Sifter with a few dozen patterns, the bounded pool, promotion | Pattern authoring tools: patterns are written by hand |
| Sower: the `open` stream, loose-end growth, the promotion ladder | Fronts, the projection engine and outlets: authored fronts only, without projections |
| Fitter: world fit weights, timing, channel, history hook, the verifier, the fit report | Bridges, stand-ins and constructed causes (later capabilities in S2): the fitter reports "no fit, and why" |
| Director: phases, holds, budgets, baton, joint | Forms, which S2's core defers; the dread rules beyond composition and caps |
| The model is computed and logged on T0 and T1, but not yet fed to any hook | The Score and Phase hooks' use of the model, which S2's core defers (S2 §0.3); T2, the orientation index, the landing check; the stance quota and the premise audits |
| The decision log and the static audits | The evaluation services beyond the branch-diff harness and the completion detector |

## 14. Requirements trace

Every procedural-engine requirement in the dossiers, and where this page covers it. **Status:**
- **Covered:** layer 3 does it, here.
- **S2:** layer 2 already specifies it ([S2 v0.16](spec/seeding.md)). The row names layer 3's part, if any.
- **Other:** another specification owns it. The row names the interface.
- **Deferred:** the design is fixed, the build waits ([§13](#13-simplicity-check)).
- **Changed:** done differently, with the reason in [§9](#9-where-the-dossiers-disagree).
- **Declined:** not done, with the reason in the table that follows.

### 14.1 Dossier 6: sifting and tellability (R-1 to R-30)

| ID | Requirement | Status | Where |
|---|---|---|---|
| R-1 | Patterns declare the kinds they read and their producers | Covered | §6.2 |
| R-2 | The pattern form: stages, roles, `where`, `unless`, expiry, tombstone | Covered | §6.2 |
| R-3 | Structure and tags only; weights in engine code | Covered | §6.2, §6.4 |
| R-4 | First-clause matching by interests on the director's frames | Changed: one frame per pattern holding every clause | §6.1 |
| R-5 | A bounded, costed pool | Covered | §6.3 |
| R-6 | Promotion of a partial match to a seed | Covered | §6.5 |
| R-7 | Candidate sources | Covered | §4.1, §6.6 |
| R-8 | A completed match minted as a `meta:` event | Covered | §6.5 |
| R-9 | A target share and hourly cap tied to the dial | Covered | §3.5, §4.4, §4.9 |
| R-10 | Selection under diversity constraints | Covered | §4.3 |
| R-11 | Gates before scores | Covered | §4.2, §6.4 |
| R-12 | Scorers use V's observed record and never assume drives | Covered | §6.4 |
| R-13 | Ranks and bands; thresholds are data | Covered | §4.3, §6.4 |
| R-14 | Chains about unmet people are texture or rumour | Covered | §4.2 |
| R-15 | Callback cues grow with time and similar events | Covered | §6.6 |
| R-16 | Prefer castings that make dilemmas, inside the tension budget | Covered | §4.3 |
| R-17 | Hand-over of roles, causes, stake and lead lines | Covered | §6.5 |
| R-18 | Complete or partial marker | Covered | §4.2, §6.5 |
| R-19 | Generate-then-justify only if consistent with pins | Covered | §4.7 |
| R-20 | Planning as a bounded validator and bridge-builder | Covered | §5.2, §6.6 |
| R-21 | Casting by kernel queries; no solver | Covered | §6.6; S2 §5 |
| R-22 | Shape templates and arc checklists are data | Covered | §4.4; S2 §2.10 |
| R-23 | No online search over stories | Covered | §6.6 |
| R-24 | Each offer records pattern, bindings, features, rank, rivals, causes | Covered | §8.1 |
| R-25 | Blind ratings, fixed presentation and ablation before live use | Other: P9; the switches are in | §8.3 |
| R-26 | Log accepts, ignores and mentions per offer and feature | Covered | §3.9, §8.1 |
| R-27 | A pattern authoring preview | Covered; tools are P6 and P10 | §6.6 |
| R-28 | The unpromoted pool isn't persisted | Changed: saved, bounded, as a cache | §6.3, §7, §9 |
| R-29 | Iteration order, keyed streams, no wall clock | Covered | §6.2, §7.2 |
| R-30 | The eight gaps routed to S0 and S1 | Covered: settled in S0 v4 | §6.1 |

### 14.2 Dossier 7: direction and pacing (PR-1 to PR-47)

| ID | Requirement | Status | Where |
|---|---|---|---|
| PR-1 | Director in layer 3, arbiter in layer 2 | Covered | §1, §2 |
| PR-2 | Six verbs with classes; no class 4 | Covered | §3.3 |
| PR-3 | Timing and rate only | Covered | §3.3 |
| PR-4 | Threats read through `knows`; the director alone reads V's position | Covered | §3.8 |
| PR-5 | An explanation chain on every action | Covered | §3.3, §8.1 |
| PR-6 | No retention term; the objective is audited | Covered | §3.9, §8.2 |
| PR-7 | An authored deadline outranks sown requests | Covered | §3.4, §3.8 |
| PR-8 | The tempo setting scales cadence; off means pull plus authored fitting | Covered; S2 §8.3 | §3.5 |
| PR-9 | A play clock beside game time | S2 §8.2 | |
| PR-10 | Rest, caps and spacing on the play clock; threat clocks on game time | S2 §8.3 | §3.2 |
| PR-11 | Pacing state is session state | Covered | §3.2, §7.1 |
| PR-12 | The base schedule is hashed draws | Covered | §3.5 |
| PR-13 | An offer is pinned when made; its id derives from state | S2 §6.2 | |
| PR-14 | The fast loop reads the feed and writes only consequences | Covered | §3.2 |
| PR-15 | The game port's senses | Other: S5; the list is in | §3.1 |
| PR-16 | `A`, `N`, load and `P` kept apart; `T = max(A, N)` | Covered | §3.2 |
| PR-17 | `A` as a sum of sensed inputs, weights in data | Covered | §3.2 |
| PR-18 | Aspects and load class from the feed | S2 §8.3 gates 1 and 2 | §3.1 |
| PR-19 | An engagement flag | Covered | §3.2 |
| PR-20 | An away marker | S2 §8.2 (overlay) | §9 |
| PR-21 | A receptivity belief and the probe decision | Declined as a separate belief; kept as a rule on the facet | §3.9, §9 |
| PR-22 | The request fields | S2 §2.12 | |
| PR-23 | The release step, spacing, cap and jitter | S2 §8.3; jitter in | §3.4 |
| PR-24 | The breakpoint rule relaxes at 70 per cent | Covered | §3.4 |
| PR-25 | Settle time, warning lag, negotiated channels | Covered | §3.2, §3.8 |
| PR-26 | Maximum wait, expiry forms, arrival limit, owed at most one | S2 §2.12, §8.3; the rest in | §3.6, §4.4 |
| PR-27 | Nudge rules | Covered | §3.3 |
| PR-28 | Interruptiveness classes and the ladder | S2 §8.1; channel hook | §3.4 |
| PR-29 | The phase machine with hysteresis | Covered | §3.2 |
| PR-30 | Rest lengths and the intensity headroom | Covered | §3.2 |
| PR-31 | Rest never blocks pull; an ambient floor | Covered | §3.2, §4.1 |
| PR-32 | Thread budgets of 4, 2, 1 and 8 | Covered; counts presented cues | §3.6, §9 |
| PR-33 | Leverage and next-belief spread | Declined as specified; a decision-beat proxy | §3.4, §9 |
| PR-34 | Every thread has a no-take path | S2 §2.9 | §3.6 |
| PR-35 | A disclosure step and two kinds of trace | Covered | §3.8 |
| PR-36 | Stages and dwell caps | Covered, as kit data | §3.8 |
| PR-37 | A clock with a perceivable source | S2 §2.14 | §3.8 |
| PR-38 | A handle from the proximal stage | Covered | §3.8 |
| PR-39 | Evidence in the middle band; suspense; payoff and rest | Covered | §3.8 |
| PR-40 | Unlock from progress; an exposure cap; diegetic signs only | Covered | §3.8 |
| PR-41 | Warn, standby, release | Covered; N-8 | §3.8 |
| PR-42 | Lead preference and urgency | Covered | §3.8 |
| PR-43 | Lead classes; refreshing traces | Covered | §3.8 |
| PR-44 | A closed purpose vocabulary; every push logged | Covered | §3.3, §8.1 |
| PR-45 | Three tiers of resolution | Covered by S0 §9.3 and the hook bounds | §2.4 |
| PR-46 | Logs for M-1 to M-16 and an arm switch | Covered | §8.3 |
| PR-47 | A "why" trace for each push and hold | Covered | §8.1 |

### 14.3 Dossier 8: scale, threads and time (S8-P5-01 to S8-P5-35)

| ID | Requirement | Status | Where |
|---|---|---|---|
| S8-P5-01 | Threads are views; the attended window | Covered | §3.6 |
| S8-P5-02 | Budgets count the attended set; no sub-caps | Covered | §3.6, §9 |
| S8-P5-03 | Opening rate and the arrival limit | Covered | §3.5, §4.4 |
| S8-P5-04 | The lead thread; at most three advancing | Covered | §3.6 |
| S8-P5-05 | Composition rules | Covered | §3.6 |
| S8-P5-06 | Tempo class and beat interval | Covered | §3.6 |
| S8-P5-07 | Scheduler item per thread; retirement; yielding | Covered | §3.6 |
| S8-P5-08 | The baton | Covered | §3.6 |
| S8-P5-09 | Coherence between threads | Covered | §3.6, §5.2 |
| S8-P5-10 | Overflow order | Covered | §3.6 |
| S8-P5-11 | Retirement and closing | Covered | §3.6 |
| S8-P5-12 | The completion detector | Covered | §4.7, §8.3 |
| S8-P5-13 | Texture tagging and share | Covered | §4.2, §8.3 |
| S8-P5-14 | Glances from the record, one `implies` | Covered | §4.7 |
| S8-P5-15 | Arc and season completion ledgers | Covered | §4.7 |
| S8-P5-16 | A computed scale label | Covered | §8.3 |
| S8-P5-17 | Return and outcome counters | Covered | §4.5, §7.1 |
| S8-P5-18 | The promotion gates and caps | Covered | §4.5 |
| S8-P5-19 | Demotion | Covered | §4.5 |
| S8-P5-20 | Child seeds from loose ends | Covered | §4.5 |
| S8-P5-21 | Pull share; yielding | Covered | §3.6 |
| S8-P5-22 | Promoted figures' threads | Covered | §4.5 |
| S8-P5-23 | The projection engine | Deferred in the first build | §4.6 |
| S8-P5-24 | Outlets with their own beliefs | Deferred in the first build | §4.6 |
| S8-P5-25 | Fronts above arc scale need a landmark and a local cost | Covered | §4.6 |
| S8-P5-26 | Stamps; no effect before its cause in a telling | S2 §2.15, §10.1; Covered | §4.7 |
| S8-P5-27 | Iterative summaries for repeats | Other: S1 summaries; S3 chooses | §6.6 |
| S8-P5-28 | One cue per changed dimension after a jump | Covered; N-9 | §3.7 |
| S8-P5-29 | Clocks are derived views; warn on short deadlines | S2 §2.14 | §3.8 |
| S8-P5-30 | Session opening; no director term reads session length | Covered | §3.7, §8.2 |
| S8-P5-31 | An optional time budget | Covered | §3.4, §3.7 |
| S8-P5-32 | The tempo bundle as nested draws | Covered | §3.5 |
| S8-P5-33 | Pause and photo mode stop both clocks | S2 §8.2 | §3.7 |
| S8-P5-34 | A session ledger for M8-01 to M8-16 | Covered | §8.3 |
| S8-P5-35 | Switches for the harness arms | Covered | §8.3 |

### 14.4 Dossier 9: agency and consequence (R5-01 to R5-29)

| ID | Requirement | Status | Where |
|---|---|---|---|
| R5-01 | Sow situations, not plots | Covered | §4.4 |
| R5-02 | An offer record on every offer | S2 §2.9; the sower refuses a kit that fails | §4.4 |
| R5-03 | One offer per change of world; re-offers need a cause | S2 §7.4; Covered | §4.2 |
| R5-04 | Delivery status and the exposure ledger | S2 §8.5, §10.2 | |
| R5-05 | Decline handling for each form | S2 §7.4, §2.9 | §4.9 |
| R5-06 | The decline audit as a gate | S2 lint; Covered | §8.2 |
| R5-07 | A portent before a hard step | S2 §7.3; Covered | §3.8 |
| R5-08 | Clocks are derived views | S2 §2.14 | |
| R5-09 | Lazy settlement at joints | Covered | §3.7 |
| R5-10 | Time limits only from world facts | S2 §2.7; Covered | §4.4 |
| R5-11 | Bounded dooms | Covered | §4.6 |
| R5-12 | Walking away | S2 §2.21 | |
| R5-13 | Off-plan acts | S2 §2.9, §2.21 | |
| R5-14 | Honest refusal | S2 §2.9 | |
| R5-15 | An attribution check before naming | Covered | §6.6 |
| R5-16 | Delay cues | S2 L-23; Covered | §6.6 |
| R5-17 | Callback content from act records | Covered; wording is S7's | §6.6 |
| R5-18 | A telling budget | Covered | §6.6 |
| R5-19 | A debt ledger | S2 §2.8 | |
| R5-20 | Record integrity | Covered | §6.6 |
| R5-21 | Far callbacks | Covered | §6.6 |
| R5-22 | The closure generator | Covered | §4.7 |
| R5-23 | Two record types | Covered; S2 §8.8 | §4.7, §3.9 |
| R5-24 | Pattern lines | Covered | §6.6 |
| R5-25 | Steering only through world state | Covered | §1, §3.3 |
| R5-26 | Engine-sown investigations | Covered | §4.4 |
| R5-27 | The dial scales sowing, not decline handling | Covered | §4.9 |
| R5-28 | Choice structure for sown decision beats | Covered; S2 §2.9 | §4.4 |
| R5-29 | Evaluation hooks | Covered | §8 |

### 14.5 Dossier 10: change, theme and payoff (S10-P5-01 to S10-P5-23)

| ID | Requirement | Status | Where |
|---|---|---|---|
| S10-P5-01 | The argument-profile service | Covered; offline | §8.3 |
| S10-P5-02 | The sample rule | Covered | §8.3 |
| S10-P5-03 | The stance quota as a weak weight | Covered; deferred in the first build | §4.8 |
| S10-P5-04 | The reward-policy audit | Covered; offline | §8.3 |
| S10-P5-05 | Recurrence by structure | Covered | §4.8 |
| S10-P5-06 | The echo finder | Covered | §6.6 |
| S10-P5-07 | The NPC change policy | Other: S1; canon guard in §4.2 | §4.2 |
| S10-P5-08 | Rationalisation and reversal policy | Other: S1 | §10 |
| S10-P5-09 | The arc recogniser | Covered; offline | §8.3 |
| S10-P5-10 | Sifting of turns | Covered | §6.6 |
| S10-P5-11 | Staging of turns | Covered | §3.10 |
| S10-P5-12 | The reader registry | Covered | §4.5 |
| S10-P5-13 | Reputation aggregation | Other: S1 | §10 |
| S10-P5-14 | Reflection channels | Covered | §3.10 |
| S10-P5-15 | The escalation guard | Covered | §3.10, §8.2 |
| S10-P5-16 | The plant planner | Covered | §4.7 |
| S10-P5-17 | The constructed-cause service | Covered | §4.7 |
| S10-P5-18 | The postdict route | Covered | §4.7 |
| S10-P5-19 | The plant ledger, interval and closing | Covered | §4.7 |
| S10-P5-20 | Reload stability | Covered | §7.2 |
| S10-P5-21 | Theme default off | Covered | §4.8 |
| S10-P5-22 | Evaluation hooks | Covered | §8 |
| S10-P5-23 | Canon NPCs | Covered | §4.2, §4.5 |

### 14.6 Dossier 11: saves, memory and forgetting (S11-P5-01 to S11-P5-16)

| ID | Requirement | Status | Where |
|---|---|---|---|
| S11-P5-01 | The refined load audit | Covered | §3.1, §8.2 |
| S11-P5-02 | The branch-diff harness | Covered | §8.3 |
| S11-P5-03 | Sowing determinism; measure reload divergence | Changed: the pool is saved; the divergence is still measured | §7.2, §7.3, §9 |
| S11-P5-04 | Persistence defaults and scales | Covered | §4.4 |
| S11-P5-05 | Promotion to memorable | Covered | §4.5 |
| S11-P5-06 | Assemble the return view | S2 §8.7; the choices in | §3.7 |
| S11-P5-07 | Callback staleness from the wall gap | Covered | §6.6 |
| S11-P5-08 | The re-entry glance | Covered | §3.7 |
| S11-P5-09 | The first-forgetting guard | Covered, conditional | §3.7 |
| S11-P5-10 | Forgetting lints in the harness | Covered | §8.3 |
| S11-P5-11 | Rumour and news policy | Covered; the operators are S1's | §6.6 |
| S11-P5-12 | The settings surface | Other: P6 | §10 |
| S11-P5-13 | One-time notices | S2 §12.2 | |
| S11-P5-14 | Reunion recall | Covered | §3.7 |
| S11-P5-15 | Growth budget | Covered by the bounded record; coalescing is S1's | §7.1 |
| S11-P5-16 | Evaluation arms | Covered | §8.3 |

### 14.7 Dossier 12: the player model, trust and manipulation (S12-P5-01 to S12-P5-22)

| ID | Requirement | Status | Where |
|---|---|---|---|
| S12-P5-01 | A closed facet vocabulary with cards | Covered | §3.9 |
| S12-P5-02 | The denylist and untracked classes | Covered | §3.9 |
| S12-P5-03 | The signal ladder | Covered; T2 deferred | §3.9 |
| S12-P5-04 | The inference policy is a fold | Covered | §3.9 |
| S12-P5-05 | The influence function | Covered | §3.9, §6.4 |
| S12-P5-06 | Exploration and breadth | Covered | §3.9 |
| S12-P5-07 | Strain subtracts; no retention term | Covered | §3.2, §3.9 |
| S12-P5-08 | Option invariance and decision-time blindness | Covered | §3.9 |
| S12-P5-09 | The orientation index | Deferred | §3.9 |
| S12-P5-10 | Staging and outlets by orientation | Deferred; outlet selection is covered | §3.9, §3.10 |
| S12-P5-11 | No targeting by attachment | Covered, as a rule and an audit | §3.9, §8.2 |
| S12-P5-12 | The landing check and the validity gate | Deferred | §3.9 |
| S12-P5-13 | Why-records and explanation | Covered | §8.1 |
| S12-P5-14 | The noticed page | Covered; the page is P6's | §3.9 |
| S12-P5-15 | Controls | Covered | §3.9 |
| S12-P5-16 | Disclosure | Covered; the text is P6's | §3.9 |
| S12-P5-17 | Flows and the firewall | Covered | §3.9, §8.2 |
| S12-P5-18 | Branch-locality and cold start | Covered | §3.9, §7.3 |
| S12-P5-19 | Privacy | Covered | §3.9 |
| S12-P5-20 | The dark-pattern review gate | Covered | §3.9, §8.2 |
| S12-P5-21 | The evaluation harness | Covered | §8.3 |
| S12-P5-22 | Wellbeing is not inferred | Covered | §3.1, §3.9 |

### 14.8 Dossier 13: perception, memory and curiosity (S13-P5-01 to S13-P5-19)

| ID | Requirement | Status | Where |
|---|---|---|---|
| S13-P5-01 | A priors table as data | Covered | §3.4 |
| S13-P5-02 | The ladder chooser reads tiers and settings | Covered | §3.4 |
| S13-P5-03 | A redundancy planner | Covered | §4.7 |
| S13-P5-04 | A re-cue planner | Covered | §6.6 |
| S13-P5-05 | A spacing rule for plants | Covered | §3.8, §4.7 |
| S13-P5-06 | Repeat counters, demotion, the twist rule | Covered | §3.4, §4.3 |
| S13-P5-07 | Endings are perceived | S2 §8.6; Covered | §3.7 |
| S13-P5-08 | Game settings as stated aspects | Covered | §3.1 |
| S13-P5-09 | Count retrievable threads | Covered | §3.6, §9 |
| S13-P5-10 | Activity demand vectors | Other: S5; Covered | §3.4 |
| S13-P5-11 | The focal set | Covered | §6.6 |
| S13-P5-12 | Consequences need a transient or a baseline | Covered | §4.7 |
| S13-P5-13 | A distinctiveness budget | Covered | §4.3 |
| S13-P5-14 | Anchors, a surprise ration and the label | Covered | §3.4 |
| S13-P5-15 | Source tracks and corrections | Covered | §4.6 |
| S13-P5-16 | A return view chosen for recall | Covered | §3.7 |
| S13-P5-17 | `pointAt` | Covered; realised by P8 | §4.7 |
| S13-P5-18 | Prohibitions and audits | Covered | §8.2 |
| S13-P5-19 | Expression budgets at render | Other: S7 | §10 |

### 14.9 Dossiers 14, 15 and 17

| ID | Requirement | Status | Where |
|---|---|---|---|
| S14-S2-01 | Predicate atoms for hot state | S2 §2.16 | |
| S14-S2-02 | Windows from hot state; the fit report cites the band | S2 §2.16; Covered | §5.5 |
| S14-S2-03 | Sifter inputs bounded; the pool copies descriptors | Covered | §6.1, §6.3 |
| S14-S2-04 | Occurrence is not the director's | Covered | §4.6 |
| S14-S2-05 | Grudges against V are offers | Covered | §4.6 |
| S14-S2-06 | One carrier schema | S2 §2.16 | |
| S14-S2-07 | The return digest | Covered | §3.7 |
| S14-S2-08 | Game-owned incidents are fixed material | Covered | §4.6 |
| S14-S2-09 | Evaluation | Other: P9; the log is in | §8 |
| S14-S2-10 | Author tooling | Other: P10; the log is in | §8 |
| S15-S2-01 | Social predicate atoms | S2 §2.17 | |
| S15-S2-02 | Fixer offers are functions of position | Covered | §5.5 |
| S15-S2-03 | Casting through ties and foci | S2 §2.17; the report lists the foci | §5.5 |
| S15-S2-04 | Signal stages | S2 §2.17 | |
| S15-S2-05 | Betrayal as a declared seed | Covered | §4.2 |
| S15-S2-06 | Norm and public-act seeds | S2 §2.17 | |
| S15-S2-07 | Cross-checks on beats | Covered | §4.4 |
| S15-S2-08 | Reflection by behaviour | Covered | §3.10 |
| S15-S2-09 | Evaluation | Other: P9 | §8 |
| S15-S2-10 | Author tooling | Other: P10 | §8 |
| S15-S2-11 | Content dials | S2 §2.17 | §3.1 |
| S17-P5-01 | A tone curve | Covered | §4.3 |
| S17-P5-02 | Stake-scale caps | Covered | §4.2, §4.6 |
| S17-P5-03 | Dread placement | Covered | §3.8 |
| S17-P5-04 | Headline selection by outlet | Covered; wording is S7's; deferred in the first build | §3.10, §4.6 |

### 14.10 Director rows in other dossiers, and P4's open question

| Source | Requirement | Status | Where |
|---|---|---|---|
| Dossier 1 §12 | The director's drives: tension, variety, relevance, care, continuity | Covered, as terms of the objective | §3.9 |
| Dossier 2 | When a relationship offer appears, backoff after silence or a decline, reunion beats | S2 Appendix A; layer 3 fits and holds | §3.7 |
| Dossier 3 FIT-38 to FIT-51 | Costed adaptation; adaptation points; verify; bounded bridges; history hooks; the spine stays authored; windows; fallback; channel ladder; timing as arbitration; offers not impositions; own state only; say early what can't be expressed | Covered | §5 |
| Dossier 5 SL-14, SL-15, SL-18 and EV-9 | Scheduling contributions; stratification; variety provenance; the blind authored-or-generated panel | Covered; the panel is P9's | §4.3, §8 |
| Dossier 18 TLS-06 | The engine never checks in and never infers wellbeing | Covered | §3.9 |
| Dossier 20 §12.4, the director row | Rung from distance and attention; one foreground scene; never earlier; a class-0 budget | Covered | §3.10 |
| Dossier 21 | The director picks which fragment, never edits its words | Covered | §1 |
| Dossier 22 | The hooks read no model state and the model reads no hook output | Covered | §8.2 |
| Dossier 23 | Control arms and a per-feature off switch | Covered | §8.3 |
| P4 §7, question 4 | Precedence between a procedural seed and the engine's own re-casting | Answered: yield before contest | §5.6 |

### 14.11 Deliberate departures

| Requirement | Decision | Reason |
|---|---|---|
| **R-28**, **S11-P5-03** | **Changed.** The pool is saved, bounded, as a cache | Reload stability is cheap to buy and simple to test. The dossier's escape (an empty pool) stays |
| **PR-21** | **Declined** as a separate receptivity belief and probe | Dossier 12 shows it duplicates the facet rate. The one useful part, a class-0 version first for a thin facet, stays as a rule |
| **PR-33** | **Declined** as specified (leverage and next-belief spread from outcome weights) | The seed language declares no outcome weights, and adding them is ceremony. A decision-beat proxy does the booking |
| **R-4** | **Changed.** One frame per pattern holding every clause | It lets the sifter see later stages without a raw Change stream or per-match interests |
| **PR-32**, **S13-P5-09** | **Changed.** Attended means a `presented` cue | Exposure grades are how the engine tells awareness |
| **S12-P5-03** (T2), **S12-P5-09**, **S12-P5-10** (orientation part), **S12-P5-12** | **Deferred** | They need the model to have run first. The interfaces are fixed so they can be added without changing the firewall |
| **S8-P5-23**, **S8-P5-24**, **S17-P5-04**, **S10-P5-03** | **Deferred** in the first build | Fronts' street projection, outlets and the stance quota matter once there is a city to project onto and a premise to argue |
| **S11-P5-09** | **Conditional** | Built only if the panel test supports it; otherwise a null result |
