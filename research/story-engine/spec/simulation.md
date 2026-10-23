# S1. Simulation layer specification

**Status:** v0.1, 23 October 2026. This is the specification stage of [P3](../p3-simulation-layer.md) (work package [WP-11](../plan.md#82-work-packages)). It is exact enough to build the first implementation of layer 1 in the TypeScript reference model from this page and the kernel specification [S0](kernel.md) (v4.9) alone.
- **The core.** This version specifies the **core**: the processes, policies, data and reads that milestone M3 builds, which is one district (Kabuki) at coarse and medium detail (§0.2). Everything else in P3 is a **later capability** (§0.3). The first implementation rejects it plainly rather than half-doing it.
- **Reviews.** None yet (§18).
- **What it reads and what reads it.** S1 fills the hooks of S0 (§9.4 processes, §11 beliefs, §10.8 the conflict table) and is read by the seeding layer [S2](seeding.md) (v1.3, §2.16 and §2.17) and the procedural engine [S3](procedural.md) (v0.2, §1.2 and §6.1).

Where this page and P3 differ, this page wins. P3 explains why; this page says exactly what. §15 lists every departure, with the reason.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout. Every **[tunable]** value lives in pack data (`S1Data`, §1.4), never in code. A value given without a mark is fixed by this page.

**The first-party rule.** Groups, perspectives, context and relevance, and the dimensional model are the project's own concepts ([D-21](../decisions.md)). Nothing on this page credits them to outside work. Where a technique is borrowed (iterative proportional fitting, a beta form for evidence, a negative binomial for clusters), it is named as a technique, for the reader who wants to check it.

## 0. Scope

### 0.1 What S1 is

S1 is the **content and policy** that turn the kernel's mechanism into a city. It decides who exists, what they do, what happens in the streets, how groups hold together, who believes what about whom, what each actor wants, and how people change. It mirrors the game, so that none of that contradicts what the game owns.

| S1 owns | S1 does not own |
|---|---|
| The people: residents, households, spells, traits, archetypes, the protected set | The mechanism: draws, pins, queries, frames, the record, retention ([S0](kernel.md)) |
| The city's events: routines, incident kinds, hot spots, aftershocks, bands | Seed language, casting, the lifecycle, the arbiter, the exposure ledger ([S2](seeding.md)) |
| Groups and order: group decisions, norms, stocks, reputation | Sowing, sifting, fitting, the director ([S3](procedural.md)) |
| Beliefs: witnessing, attribution, telling, fading | The game port, the senses and verbs (S5); realising anything in game (P8) |
| Minds: urgency, importance, concerns, goals, dilemmas, NPC change | Words and rendering (S7); pack format and settings screens (S4, P6) |
| The mirror: what the game owns, read into the model, and how game truth overrides simulation | Persistence bytes and save keys (S6); where S1 runs (P7) |
| The reads, events and pins that S2 and S3 consume (§9) | Evaluation tools (P9, P10): S1 supplies their logs and reads |
| The production gate (§6) | Authored content (layer 4) |

**Seven rules run through everything below.**
1. **The game is ground truth.** S1 mirrors what the game owns and simulates only what the game does not. Where they disagree, the game wins and the record reconciles (§7.3, §8.12).
2. **Counts first, items on demand.** Every incident starts as a count in a summary. Detail is the lazy opening of its items (§7.9).
3. **A policy is a registered function or a data table.** Packs supply tables and parameters, never code.
4. **V is observed, never owned** ([D-09](../decisions.md)). No S1 process names V as the target of a harmful effect. No S1 function writes or reads a model of V's feelings. V's acts are history. V's position and attention change nothing coarse.
5. **Deterministic by construction.** Every draw is keyed by what it is about (§1.3). Nothing reads the session epoch, the load count, the play clock or the wall clock (S0 I-16).
6. **Nothing is modelled until something asks.** Residents are drawn, not simulated. Ties are implicit. Beliefs exist for the observed and the focal. A coarse tier holds counts, fractions and stocks.
7. **Simple first.** One shared window, one tie function, one gate. Everything that can wait for measured need waits (§0.3).

### 0.2 The core: what the first implementation builds

The first implementation is the TypeScript reference model, beside the kernel and layers 2 and 3. It is sized for milestone M3 ([P3 §19.2](../p3-simulation-layer.md#192-the-first-implementation-sized-for-milestone-m3)): **Kabuki, phase 1**.

| Area | In the core | Section |
|---|---|---|
| The district | Kabuki as a world-index slice with two tier-1 stubs for its neighbours, built from real game data by W1, plus a generated fixture slice (`FX-3`) for unit fixtures | §3 |
| Processes | `city.shape`, `city.events`, `city.mirror`, `people.shape`, `order.norms`, `order.stocks`, `order.ledger`, `group.decide` (Tyger Claws and The Mox only), `scene.acts` | §7 |
| Policies | `urgency` (models R, S, D, P, X, C, Y), `frames`, `v.frames`, `concerns` (O1 to O5), `goals` with a ten-means library, `dilemma`, `witness`, `social` for focal people, `fade`, `aggregate`, `change` for the focal set, `ties`, `reconcile` | §8 |
| People | The recipe, residents, households, spells, traits, about eight archetypes, names, binding by key, the protected set, canon people | §4 |
| Ties | The tie function with materialisation; the tie record in its reduced form | §4.6, §4.7 |
| Events | The ten-kind city catalogue, opportunity fields, propensity, counts, summaries, events, offspring, the calendar, heat and bands, exogenous regime arrivals | §5, §7.2 |
| Order | One norm pair (pay the Friday fee; do not talk to the uniforms) with the public tag; efficacy, cynicism and the report chance; reputation by carriers and `aggregate` for V among Kabuki's stallholders and the Tyger Claws | §7.5 to §7.7, §8.9 |
| The mirror | Against the **offline replay port**: the facts table's 93 facts and the twelve feed kinds, from hand-authored story states ([D-18](../decisions.md)) | §3.4, §7.3 |
| The gate | One choke point, `produce` | §6 |
| The focal set | The R1 character as a mirrored canon node with beliefs about V, two vendors, one fixer. Tier 4 for at most 100 persons | §10 |
| Reads and registries | The registered reads for S2 and the registries for S3 | §9 |

The in-game rows of P3 §18 (the game-time ratio, binding keys, the community-slot read) are batched into one prepared session. None blocks M3. Until then every unmeasured time constant is in game time and **[tunable]**.

### 0.3 Later capabilities

The first implementation rejects these with a plain finding ("not supported yet"). Each returns only with a recorded contract that agrees with the reference model.

| Later capability | Why it waits |
|---|---|
| `city.tension`: pair tension, strength stocks, grievance along ties, suppression | Phase 2. M3 has no modifier that needs them, and the sifter has to show that clashes read as caused without them |
| Police pressure as a dial; the interaction matrix's police, tension and strength modifiers | Phase 2. M3 keeps the matrix and the regime modifier. The report draw is in the core |
| `city.flow`: rumour fractions, reach by recurrence, the feed lag, standing rumours, outlets, the flow matrix | Phase 2. M3 gives every reputation item a reach frozen at formation (§8.9) |
| `order.contracts`: hazards, the fixer chain, informants, the signal stage | Phase 2. Needs fixer offers and the S2 stage type |
| `order.members`: joiners, drift, staged exit, cascades, succession, splits | Phase 2. M3 groups have a fixed roster |
| The protection market and regimes beyond exogenous arrival (flashpoint-held, cascade-born, unrest) | Phase 2. The market needs the strength stocks |
| Unrest, infrastructure graphs, the slow district variable, corporate procedure load | Phase 3. Outages stay exogenous events |
| Far ties, covert effects, group governance records, police styles, corporate zones, corruptibility | Phase 3 |
| Rivalry salience, mentor phases, bids, novelty tracking, decay and maintenance profiles, the expected-interval belief, loss propagation, help rates and signal stages | Phase 2 of the tie record. M3 keeps the coarse tie, the NPC's regard, trust, commitment, status, replies, gifts, reunion and the consent rules |
| Concern generators O6 (opportunity) and O7 (cue); the urgency model O | Phase 2. They need visible-satisfier reads from the port |
| Blacklists, overhear, civic memory channels, lies beyond the one `conceal` rule | Phase 2 |
| The memory machinery: accessibility, widening, recall, the sweep, coalescing, faster fade for hearsay, the error allowlist | Deferred with S0 V4-30. M3 uses the hold-time fade (§8.8) |
| Block-level norm state (`local(beh)` per block) and the tipping rule | Phase 2. M3 keeps district slots only |
| Residents who move between blocks (residence spells that change the roster); `age-at(t)` | Open question 11 of P3. M3 residence spells are tenure only (§4.2) |
| Drift rules for NPC importance | M3 ships the machinery and an empty rule table (§8.10) |
| Tier 5, positions and animation | The game's |
| The execution of realisation routes and the spawn budget | P8. S1 owns the table's data (§5.5) |
| The `aesthetic` feature table | S4's (P3 open question 14). M3 answers `undefined` for every feature |
| Native hot loops; budgets measured on a simulated session | P7. S1 gives targets only (§10.4) |
| Mod-added places and communities mid-lineage; a live game | The world-index overlay (dimension 32); S5 and the first in-game session |

### 0.4 Conventions

- **Time.** `GameTime` is game seconds ([S0 §9.1](kernel.md#91-time)). `W` is the shared window, 600 s. A **span** is the `n` windows one process run covers. A **boundary** is `t = k × W`.
- **Windows.** "Window" always means a simulation window of `W`. S2's seed windows and S3's slots are other things.
- **Tier and phase.** A tier is a scheduling band of the kernel (0 city to 5 fine detail). A phase is when P3 says a part is built (1, 2, 3).
- **Ids.** `city`, `director` and `v` are the kernel's roots. `s1 = H("root", worldSeed, "s1")` is S1's own record (§2.2). `port = H("root", worldSeed, "port")` is the creator of raw game events. A process's creator id is `proc(id) = H("process", id)`, as in the reference model.
- **Pack ids.** `xf.core.world@1` (schema, kinds, tables), `xf.core.drives@1` (the drive catalogue), `xf.core.means@1`, `xf.kabuki.index@1` (the world-index slice), `xf.kabuki.groups@1`, `xf.kabuki.norms@1`. Fixtures use `xf.fixture`.
- **Arithmetic** is S0's [§1.3](kernel.md#13-arithmetic) plus the table functions of §1.2. Sums run in the order written, and sets are summed in `Id` order.
- **Numbers.** Rates are per game day unless a window is named. A "week" is 1,008 windows, a "day" 144, an "hour" 6.
- **No names.** This page names no person in the repository's history. Characters of the game appear only as the game names them.

## 1. Foundations

### 1.1 Time, windows and the calendar

```ts
const W = 600;                                  // data.time.W  [tunable 600]; a lineage constant
const HOUR = 6, DAY = 144, WEEK = 1008;         // windows, for W = 600
const windowOf = (t: GameTime): number => Math.floor(t / W);
const startOf  = (w: number): GameTime => w * W;
```

**Calendar.** The lineage root record holds `clock: { dow0: 0..6; sod0: 0..86399 }`, the weekday (Monday = 0) and the second of the day at `GameTime` 0. S5 fixes them ([S0 §17](kernel.md#17-compromises-and-open-items) item 3). Until it does, the replay port sets `dow0 = 0`, `sod0 = 0`.

```ts
const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => a - b * Math.floor(a / b);
const secondOfDay = (t) => mod(t + clock.sod0, 86400);
const dayIndex    = (t) => floorDiv(t + clock.sod0, 86400);
const weekday     = (t) => mod(clock.dow0 + dayIndex(t), 7);
// periods: 0 M(orning) 06-12, 1 D(ay) 12-18, 2 E(vening) 18-24, 3 N(ight) 00-06   data.time.periodStartHour [6, 12, 18, 0]  [tunable]
const periodOf = (t) => mod(floorDiv(secondOfDay(t), 21600) + 3, 4);
```

The four periods are the game's named periods (Morning, Day, Evening, Night). The hours behind them are unmeasured ([P3 §18](../p3-simulation-layer.md#18-open-questions-for-s1) item 2), so the boundaries are **[tunable]** and the first in-game session settles them. Every time constant on this page is in game time. A jump (a sleep, a fast travel) is a session input, never a draw key.

### 1.2 Arithmetic and the table functions

S0 §1.3 allows `+ − × ÷`, `sqrt`, comparisons, `floor` and fdlibm `ln`, and allows S1 to add exact table-based sampling, "specified bit for bit". This section is that specification.

**Two rules for every S1 computation.**
1. **No fused multiply-add.** `a × b + c` is two roundings, in that order. An implementation that fuses them is wrong.
2. **Fixed order.** Loops run in the order written. A sum over a set runs in `Id` order. A product runs left to right.

**The tables.** Three tables are frozen data files, versioned in the lineage record ([S0 §14.4](kernel.md#144-compatibility)). Each is a list of binary64 values, written to the file as their 16-hex-digit bit patterns, and generated by the reference tool `make-tables` with 80-digit decimal arithmetic and rounded to nearest-even. The file's SHA-256 is part of the lineage record.

| Table | Entries | Value |
|---|---|---|
| `exptab@1` | 321 | `T[j] = e^((j − 256) / 16)`, for `j = 0 … 320` |
| `normtab@1` | 4096 | `Z[i] = Φ⁻¹((i + 0.5) / 4096)`, the standard normal quantile |
| `lqtab@1` | 4096 | `LQ[i] = e^(σ·Z[i]) / mean_j e^(σ·Z[j])`, with `σ = data.shape.sigmaL` **[tunable 1.6]** |

`Z` is odd: `Z[i] = −Z[4095 − i]`. `LQ` has mean 1. With `σ = 1.6`, the top 5 % of `LQ` entries hold 47.9 % of the mass and the top 1.25 % hold 25.6 %, against the 48 % and 26 % of the log-normal itself.

```ts
// exptab: e^x on a grid of step 1/16 from -16 to 4, linear interpolation. Relative error below 0.0489 %.
function exptab(x: number): number {
  const c = x < -16 ? -16 : (x > 4 ? 4 : x);
  const u = (c + 16) * 16;                      // exact
  let j = Math.floor(u);
  if (j > 319) j = 319;
  const f = u - j;                              // exact
  return T[j] + (T[j + 1] - T[j]) * f;          // two roundings, in this order
}
const powTab = (a: number, b: number): number => exptab(b * ln(a));        // a > 0

const q64 = (x: number): number => Math.floor(x * 64 + 0.5) / 64;           // the kernel's 1/64 grid; x*64 is exact
const clip01 = (x: number): number => x < 0 ? 0 : (x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number): number => x < lo ? lo : (x > hi ? hi : x);
```

**Choosing from a table (inverse cumulative sum).** The weights are non-negative binary64 values.

```ts
function invCum(w: number[], u: number): number {     // returns an index; u in (0, 1)
  let total = 0;
  const cum: number[] = [];
  for (let i = 0; i < w.length; i++) { total = total + w[i]; cum.push(total); }
  const target = u * total;
  for (let i = 0; i < w.length; i++) if (target < cum[i]) return i;
  for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;         // rounding at the very top of the range
  return 0;
}
```

Ties go to the lower index by construction. A table with all weights zero returns 0 and the caller MUST have excluded it.

**Counts: the exponential-spacing form of a Poisson draw.** It uses `ln` and addition only.

```ts
// draw(i) is the keyed uniform for stream index i = 0, 1, 2, ...
function spacingCount(mu: number, draw: (i: number) => number, cap = 64): number {
  if (!(mu > 0)) return 0;
  let s = 0, n = 0;
  while (n < cap) {
    s = s + (-ln(draw(n)));
    if (s > mu) break;
    n = n + 1;
  }
  return n;
}
// A mean above 32 is split into equal parts, each drawn on its own stream; nothing is dropped.
function splitCount(mu: number, drawPart: (part: number) => (i: number) => number): number {
  const parts = Math.max(1, Math.ceil(mu / 32));
  const each = mu / parts;
  let total = 0;
  for (let p = 0; p < parts; p++) total = total + spacingCount(each, drawPart(p));
  return total;
}
```

`splitCount` with `mu ≤ 32` is one `spacingCount` on part 0.

**Clusters: the negative binomial by recurrence.** With mean `n` and dispersion `k` the probability of no children is `(1 + n/k)^(−k)`, which is `exptab(−k·ln(1 + n/k))`. Each next probability follows by multiplication.

```ts
function nbCount(n: number, k: number, u: number, maxK = 8): number {
  if (!(n > 0)) return 0;
  let p = exptab(-(k * ln(1 + n / k)));
  let cum = p;
  for (let j = 0; j < maxK; j++) {
    if (u < cum) return j;
    p = p * ((j + k) / (j + 1)) * (n / (n + k));        // left to right: (p × a) × b
    cum = cum + p;
  }
  return maxK;                                          // the tail folds into the cap
}
```

**Normal and log-normal variates** are table lookups, with no interpolation: `normalOf(u) = Z[floor(u × 4096)]`, `logNormalOf(u) = LQ[floor(u × 4096)]`. The truncation is at `|z| ≤ 3.67`.

**Keyed Gumbel noise for S1's own choices.** Where S1 chooses among options outside the kernel's slot draw (goals, dilemmas), the noise for option `v` under a key is `gumbel(key, v) = −ln(−ln(rand(key…, v)))`. The kernel's own draws keep their formula ([S0 §5.4](kernel.md#54-the-draw-flat-gumbel-max)).

### 1.3 Keys

Every S1 draw is `rand(key…) = toUnit(H("rng", key…))` ([S0 §1.4](kernel.md#14-random-streams)). Arguments are typed as the reference model types them: strings `s`, `Id`s `id`, integers `i`. **`worldSeed` is always the second argument, as an `id`.** No key reads the session epoch, the load count, the play clock or the wall clock ([S0 I-16](kernel.md#15-invariants)). The only non-causal discriminator is an `attempt` counter in a rejection loop.

There are two forms:
- **Process draws** are `procRand(w, …) = rand("proc", worldSeed, processId, w, …)`, where `w` is **the window being computed**, not the window the run started at. This is the kernel's `("proc", worldSeed, processId, k, …)` with `k` evaluated window by window (§16, K-3). It is what makes a run's draws independent of where the run starts.
- **Identity draws** are keyed by what they are about and carry no window: the offspring of an event, the tie between two people, the belief a resident holds about an item. They are the same at every tier and after every reload.

The registry of every key is §1.5. A draw that is not in the registry MUST NOT exist.

### 1.4 Pack data and tunables

Pack data is read at load and never changes inside a lineage except through a pack update under S2's `continue` policy ([S2 §12.3](seeding.md)). The sections of `S1Data` are:

| Section | Holds | Where defined |
|---|---|---|
| `time` | `W`, period start hours | §1.1 |
| `shape` | hour and weekday shapes, pulses, `sigmaL`, the city rate table | §7.1 |
| `kinds` | the event-kind registry | §5 |
| `events` | ladder, offspring, delay bins, matrix, place kernels, heat weights, band thresholds | §7.2 |
| `people` | the age, role, income and affiliation lists, household lists, archetypes, spell tables, trait priors, schedule tables | §4 |
| `ties` | focus types, layer budgets, tie-record tables | §4.6, §4.7 |
| `norms` | norm records | §7.5 |
| `stocks` | retention constants, effect tables, `r0` | §7.6 |
| `ledger` | axes, the judge table, carriers, reach tables, bands | §7.7, §8.9 |
| `groups` | group drives, ethos, books, the means library | §7.8, §8.4 |
| `minds` | importance priors, urgency parameters, thresholds, change constants | §8 |
| `gate` | class listings, the m4 budget | §6 |
| `realisation` | the route table | §5.5 |

**Every [tunable] on this page is a field of `S1Data`.** The sections' field names are the names in code font beside each value. A pack MAY override a field. Fixtures use the defaults given here. A pack that omits a field takes the default.

### 1.5 The key registry

Every draw S1 makes is in this table. After `"rng"` and the tag, `worldSeed` is always the next argument (an `id`), then the rest in the order shown. `s` is a string, `id` an `Id`, `i` an integer. `w` is the window being computed, `pid` the process id. **A draw not in this table MUST NOT exist** (§12).

**Process draws**, `procRand(w, tag, …) = rand("proc", worldSeed, pid, w, tag, …)`:

| Process | Tag and arguments | Draws |
|---|---|---|
| `city.shape` | `"regime"`, `d:id`, `r:s`, `i:i` | the arrival spacings of regime kind `r` in district `d` |
| | `"regime-size"`, `d`, `r` | size 3 or 4 |
| | `"regime-t"`, `d`, `r` | the start time within the window |
| | `"regime-exit"`, `regime:id` | the exit draw |
| `city.events` | `"cnt"`, `d`, `k:s`, `part:i`, `i:i` | the spacing stream of the incident count |
| | `"size"`, `d`, `k`, `i` | size |
| | `"scope"`, `d`, `k`, `i` | scope |
| | `"cell"`, `d`, `k`, `i` | the cell of a remainder-scoped event |
| | `"t"`, `d`, `k`, `i` | the time within the window |
| | `"who-f"`, `d`, `k`, `i` | the aggressor affiliation class |
| | `"pair"`, `d`, `k`, `i` | the gang pair and its orientation |
| | `"who"` and `"who-b"`, `ev:id`, `role:s`, `attempt:i` | casting a person (and the adjacent block of the last attempts) |
| `order.norms` | `"enf"`, `d`, `norm:s`, `i` | the enforcement count |
| | `"rung"`, `d`, `norm`, `i` | the rung |
| | `"ecell"`, `d`, `norm`, `i` | the cell |
| | `"wit"`, `ev:id`, `i` | the witness count of an enforcement event |
| | `"who"`, `"who-b"` | as for `city.events` |
| `group.decide` | `"retal"`, `group:id`, `rival:i` | the retaliation check |
| `scene.acts` | `"act-who"` and `"act-who-b"`, `item:id`, `role`, `attempt` | casting the people of an opened item |
| | `"routine"`, `person:id`, `i` | a focal person's routine acts |

**Identity draws**, `rand(tag, worldSeed, …)`, with no window:

| Tag and arguments | Draws |
|---|---|
| `"child"`, `parent:id`, `index:i`, `aspect:s` | everything a child is: aspects `"n"` (with `index` 0, the child count of `parent`), `"bin"`, `"win"`, `"kind"`, `"size"`, `"cell"`, `"cell2"`, `"t"` |
| `"thin"`, `parent`, `index` | thinning at fire time |
| `"report"`, `parent`, `index` | the report draw of a police-action child |
| `"wit"`, `ev:id`, `i` | the witness count of an incident (`"wit"` of `order.norms` is a process draw: the first argument is `"proc"`) |
| `"prop"`, `cell:id` | a cell's propensity quantile |
| `"spell"`, `person`, `track:s`, `k:i` | the length of spell `k` |
| `"spellv"`, `person`, `track`, `0` | the state of spell 0 |
| `"anchor"`, `person`, `track` | the start of spell 0 |
| `"absent"`, `person`, `day:i` | an absence |
| `"sched"`, `person`, `day`, `p:i` | the schedule class |
| `"work-place"`, `person` | the workplace cell |
| `"out-place"`, `person`, `day`, `p` | a leisure cell |
| `"present"`, `cell`, `person` | the priority of a person for a scene |
| `"focus"`, `type:s`, `person` | a focus cell of a resident |
| `"rank-anchor"`, `a:id`, `block:id` | the anchor of a foreign block in a resident's walking order |
| `"tie"`, `lo:id`, `hi:id` | the tie between two residents (`lo < hi` as hex strings) |
| `"knows"`, `resident`, `item` | whether a resident knows an item |
| `"bind"`, `community:s`, `entry:s`, `spot:s`, `ordinal:i`, `attempt:i` | binding a resident to a body |
| `"goal"`, `actor`, `concern`, `decisionWindow:i`, `means:s` | the Gumbel noise of one means (the key names the concern and the decision) |
| `"goal-share"`, `actor`, `decisionWindow` | the one-in-eight time share |
| `"goal-out"`, `frame`, `step:i` | a goal's outcome |
| `"dil"`, `actor`, `frameA`, `frameB`, `decisionWindow` | a dilemma's strategy |
| `"defect"`, `member`, `window:i` | a member's option under an order |
| `"accept"`, `tie`, `event` | a status change's acceptance |
| `"tell"`, `teller`, `listener`, `item`, `window` | whether a telling happens |
| `"op"`, `teller`, `listener`, `item`, `hop:i` | the operator of a telling |
| `"lie"`, `teller`, `item`, `window` | the decoy of a lie |
| `"lag"`, `tie`, `event` | the lag of a reciprocity debt |

The kernel's own draws (`"g"`, `"tie"` of the Gumbel tie-break, `"item-t"`, `"item-p"`) are S0's. The `"kslice"` keys of the fixture slice generator (§3.2) belong to the generator, not to S1. `decisionWindow` is the index of the boundary being processed, **a window index, never an epoch**.

## 2. The process contract

### 2.1 The interface

A process is periodic, has a tier and a `ProcessState`, and runs under the kernel's rules ([S0 §9.4](kernel.md#94-evolution)): the shared window `W`, run every `n`-th window, outputs applied at the end of the span, no process sees another's outputs within a span. This section gives the v4.9 interface its S1 shapes.

```ts
interface S1Process<S, D> {
  id: string; version: number;          // the process id and its version; both are in the lineage record
  tier: Tier;                           // the lowest tier it writes at; application order is by tier, then id
  period: number;                       // n, in windows; a lineage constant
  coarseFine: CoarseFine;               // S0 V4-24
  reads: ReadSet;                       // the declared read set, for the audits of §12
  init(ctx: S1InitCtx): S;              // §2.2: the state of a new lineage
  run(ctx: S1Ctx, k: number): S1Result<S, D>;
}
type CoarseFine = { kind: 'exact' } | { kind: 'count' } | { kind: 'distribution'; tolerance: string };

interface S1Ctx {
  readonly processId: string; readonly worldSeed: Id; readonly W: number;
  readonly runStart: number;                     // k
  readonly data: S1Data; readonly index: WorldIndex;     // §1.4, §3
  settingsAt(w: number): SettingsView;           // the SettingsSet in force at window w (S0 §14.2)
  read(node: Id, path: SlotPath, t?: GameTime): ResolveResult;
  value(node: Id, path: SlotPath, t?: GameTime): Value | undefined;
  query(q: Query): QueryOutcome;                 // within the shared allowance
  procRand(w: number, ...key: HArg[]): number;   // §1.3
  own(): S;                                      // V4-35: this process's state as of the snapshot
  digest<X>(processId: string): X | undefined;   // V4-36: another process's digest as of the snapshot
  demanded(tier: Tier): DemandedNode[];          // V4-37: tiers 3 and finer only
  produce(o: Occurrence): GateResult;            // §6
  log(e: LogEntry): void;                        // §2.3
}
interface DemandedNode { node: Id; tier: Tier; claim: number }
interface S1Result<S, D> { ops: S1Op[]; state: S; digest: D }
```

`run(ctx, k)` computes windows `k … k + n − 1` **one at a time, in order**. It keeps a working copy of its state, updates it window by window, and reads nothing else that changes within the span. Its result is the operations of the whole span, the state after window `k + n − 1`, and the digest after it. The kernel applies all three atomically at the boundary ending the span (S0 §9.4).

**The operations.** S1 returns the kernel's process operations ([S0 §9.4](kernel.md#94-evolution)) in these shapes. Where the reference model's names differ, its names win and these fields are the content.

```ts
type S1Op =
  | ProcessOp                                    // pin, withdraw, contribute, end-contribution, edge, end-edge, mint-event, mint-summary
  | { op: 'frame-open'; frame: FrameSpec }                                 // id, actor, level, parents, origin, payload, weight, own, focus, status, cause
  | { op: 'frame-status'; frame: Id; status: FrameStatus; cause: Id }
  | { op: 'frame-weight'; frame: Id; weight: number }
  | { op: 'frame-interests'; frame: Id; own: Partial<FrameInterests> }     // replaces the named lists
  | { op: 'decide'; leader: Id; group: Id; decision: Decision }
  | { op: 'order'; group: Id; member: Id; goal: Goal; parentFrame: Id; pressure: number }
  | { op: 'observe'; observer: Id; node: Id; slot: SlotPath; at: GameTime; evidence?: Id }
  | { op: 'tell'; teller: Id; listener: Id; event: Id; operator: Operator | null }
  | { op: 'belief-set'; belief: BeliefSpec }
  | { op: 'belief-drop'; belief: Id };
type Decision =
  | { kind: 'open-concern'; drive: DriveId; bindings: Record<string, Id>; stakes: number }
  | { kind: 'set-status'; frame: Id; status: FrameStatus }
  | { kind: 'set-weight'; frame: Id; weight: number }
  | { kind: 'set-interests'; frame: Id; own: Partial<FrameInterests> };
type Operator = 'level' | 'sharpen' | 'assimilate';
```

**Ownership of what a process writes.** Each state slot, each minted node family and each edge type has exactly one writer. Two processes never write the same (node, slot). The table is §2.2. A static audit (§12) checks it.

### 2.2 State, digests, state pins and the S1 record

**Process state.** Each process keeps plain data in its `ProcessState.state`, versioned with the process. It is persisted, and it contains whatever the process cannot recompute: calendars, rings, stocks, norm slots, regime data, recipe tables. What regenerates from keys (residents, spells, ties) is not state (§11).

**Digests.** Each process publishes a digest with its batch. A digest is plain data, versioned with the process, and holds only what other processes and the registered reads need: counts, the ids of events of size m2 and above, band changes, stock values. Other S1 processes read digests, never raw nodes, and never another process's state.

```ts
interface DigestBase { v: number; through: number /* the last window the digest covers */ }
```

Each process page (§7) gives its digest. A digest is as of `through`. A reader inside a run sees the digest of the snapshot at the run's start, so a coupling between two processes has a one-span lag, and for `city.mirror` (period 1) a one-window lag.

**State pins.** Time-windowed output that only S1 writes is a `committed` pin (precedence 300) on a simulated temporal slot, named `slot@w<k>` ([S0 §6.3](kernel.md#63-time-varying-slots), SPEC-NOTES 34). A pin is written **only when the value changes**. It covers the window it names, and the kernel treats it as the Change that wakes interests. Because a pin covers one window, **the current value is read from the digest, never from the pin history**. The pin history is the record of when each value began, for tools and for `since` atoms. S1 pins only on slots no other layer writes, and uses `simulation` contributions (precedence 200) for anything a seed, an author or the game may override.

| State slot | On | Writer | Values |
|---|---|---|---|
| `band` | `xf:cell` | `city.events` | quiet, elevated, hot, flashpoint |
| `status` | `xf:service` | `city.shape` | open, quiet, watched, closed |
| `gap-<norm>` | `xf:district` (one slot per norm of the pack) | `order.norms` | aligned, gap, wide |
| `label-<axis>` | `xf:standing`, the owned value `standing-v` of each carrier | `order.ledger` | unknown, low, mid, high |
| Regime existence | none: a regime is its `regime-start` event until its `regime-end` event | `city.shape` | |
| Urgency | none | none | **Derived, never pinned** (§8.1, §15 item 4) |

**The S1 record.** Policies have no schedule of their own. Event-driven state lives in one `SeedRecord` under `s1`, with `actor` unset ([S0 §14.1](kernel.md#141-what-is-persisted)):

```ts
interface S1Record {
  v: number;
  goals: Record<Id, GoalState>;                    // by goal frame (§8.4)
  pressure: Record<Id, PressureAccount>;           // by held-view belief (§8.10)
  ties: { pursuit: Record<string, PursuitState>; softExcluded: Id[]; boundaries: Record<string, number[]> };    // §4.7
  absorbed: Record<Id, number>;                    // carrier items by carrier, for the cap (§8.9)
  dirty: Array<{ carrier: Id; subject: Id; axis: string }>;   // standings to re-evaluate at the next ledger run
  log: LogEntry[];                                 // a ring of at most data.log.max (2048), oldest first
  seq: number;                                     // next log sequence number
}
```

A policy updates the record at relevance-dispatch time, inside the boundary being processed, in the kernel's dispatch order. The record is saved with the other states and restored on load. `init` of every process and the empty record are the state of a new lineage.

### 2.3 The decision log and the defect list

The log serves P9 and P10 ([P3 §12](../p3-simulation-layer.md#12-what-s1-exposes)). It is part of the S1 record, so it is deterministic and survives a reload.

```ts
interface LogEntry {
  seq: number; w: number;                         // the window being processed
  proc: string;                                   // a process id or a policy name
  kind: 'gate' | 'correction' | 'decision' | 'defect';
  key?: string;                                   // the draw key, as text, for a keyed decision
  reason: string;                                 // a name from the lists below
  refs: Id[];
}
```

Reasons in use: gate refusals `excluded`, `floor-minor`, `floor-real`, `sex-tag`, `v-target`, `protected`, `budget-m4`, `cap-window`; corrections `game-dead`, `game-moved`, `game-covers`, `game-fact`; decisions `goal-pick`, `goal-share`, `dilemma-pick`, `defect-option`, `accept`, `tell`, `operator`; defects `calendar-overflow`, `ring-overflow`, `who-fallback`, `late-raw`, `read-violation`, `cap-hit`, `table-missing`, `walk-limit`, `bind-fallback`. The log is never shown to V.

## 3. Inputs

### 3.1 The world-index slice

S1 reads place data through a **world-index slice**, built offline once per installed game and mod set by W1 ([P3 §4.1](../p3-simulation-layer.md#41-the-world-index-slice)). It is static data: it is the same on every machine for the same install, it is not part of the save, and its version and hash are in the lineage record. The slice has the shape below. A field marked *dim n* comes from place dimension n of [places §12](../../../knowledge/places.md#12-place-dimensions-for-the-world-index-w1).

```ts
type Aff = string;                                  // a Factions.* record name, e.g. "TygerClaws"; "civilian" and "ncpd" are fixed names
type AffClass = 'civilian' | 'gang' | 'corp' | 'ncpd';

interface WorldIndex {
  version: string; hash: string;
  clock?: { dow0: number; sod0: number };
  districts: Record<Id, DistrictIndex>;             // simulated and stub
  cells: Record<Id, CellIndex>;                     // cells of simulated districts only
  rest: { totalA: Record<KindName, [number, number, number, number]> };   // the opportunity of all districts not listed, per period
}

interface DistrictIndex {
  id: Id; key: string;                              // the place key, e.g. "wat_kab" (dim 5)
  simulated: boolean;                               // false: a tier-1 stub with counts only
  parent?: Id;                                      // region
  neighbours: Id[];                                 // districts whose polygon touches this one (dim 4), by Id
  entry: { total: number; byAff: Array<{ aff: Aff; cls: AffClass; q: number }> };   // dim 16: entry quantity, largest first
  rho: number;                                      // the headcount scale; [tunable 1.0]
  marginals: {                                      // the targets of the recipe fit, each summing to 1
    age: number[8]; role: number[12]; income: number[4]; aff: number[6];
    household: { type: number[5]; tenure: number[3]; wealth: number[4] };
  };
  affOrder: Aff[];                                  // the six affiliation-class names of the recipe, §4.2
  prevention: string;                               // dim 10: e.g. "NCPDLowSec"
  trust: { E0: number; Y0: number; L0: number };    // starting efficacy, cynicism, police legitimacy; defaults 0.5
  priceAnchor: 0 | 1 | 2 | 3;                       // dim 29: a banded anchor
  staticTotalA: Record<KindName, [number, number, number, number]>;   // the sum of A over the district's cells; stubs use it directly
  cellIds: Id[];                                    // in grid order, then venues (§4.1)
}

interface CellIndex {
  id: Id; district: Id;
  kind: 'grid' | 'venue';
  host?: Id;                                        // a venue's grid cell
  band: [number, number];                           // vertical band in metres (dim 4)
  adj1: Id[]; adj2: Id[];                           // cells at graph distance 1 and 2, each sorted by Id
  public: 'public' | 'semi' | 'private';            // dim 7, 8
  pop: [number, number, number, number];            // dim 18: people present per period
  headShare: number;                                // the share of the district's residents (grid cells; 0 for venues)
  presence: Record<Aff, number>;                    // dim 16: shares of entry quantity in the cell
  A: Record<KindName, [number, number, number, number]>;      // dims 10, 11, 16 to 18, 20, 21, 24, 26, 27: the opportunity, per period
  F: Record<KindName, number>;                      // the propensity weighting, in [0.5, 2]
  pairs: Array<{ a: Aff; b: Aff; w: number }>;      // gang pairs with a weight (presence product × border × hostility)
  gameCoverage: Record<KindName, number>;           // dims 16, 21, 27: 0 to 1, static (§7.2)
  services: Array<{ id: Id; type: string; poi?: string }>;     // dim 21, 24
  marketCell: boolean;                              // a stall row or market (dim 21)
}
```

S1 never edits the slice. A mod's places and communities arrive through the same file (dimension 32). A cell that appears or disappears mid-lineage is a pack update (open question 12 of P3).

**Aff names.** `civilian` covers `Factions.Civilian` and `Factions.Unaffiliated`. `ncpd` is `Factions.NCPD`. Every other record keeps its name and takes its class from its animation wrapper (gang, corporation) as the game does ([population §5.1](../../../knowledge/population-and-affiliations.md#51-affiliations)). The Trauma Team and Afterlife Mercs are classed as corporations there.

### 3.2 The Kabuki slice and the fixture slices

**The M3 slice** `xf.kabuki.index@1` is Kabuki (Watson), plus two stubs that touch its polygon. The data it must reproduce are the ones P3 §19.2 states: the leaf area is 0.49 km² with a vertical band of −20 to 200 m; 153 fixed, 251 streamed and 272 background communities; 7,497 AI spots; 47 points of interest; 11 fast-travel points; entry quantity 2,964, of which 79 % civilian and 2 % NCPD; gangs Tyger Claws 205, The Mox 112, Scavengers 48, Militech 41, Animals 18; the standard NCPD preset. A 200 m cut gives about 12 grid cells and a few venue cells (15 to 30 in all). Residents number about 3,000 at `rho = 1`.

**Until W1 builds it, the reference model uses a generated stand-in** with the same shape, `make-kabuki-slice`, so that fixtures do not wait. It is deterministic from `H("fixture", "kabuki-slice")` and these rules. It is for fixtures only and carries no claim about the game.

| Part | Rule |
|---|---|
| Cells | 12 grid cells `g0 … g11` in a 4 × 3 grid, graph distance by shared edges; 10 venue cells `v0 … v9`, each hosted by `g(i mod 12)`, distance 1 to the host. `adj2` is breadth-first distance 2 |
| Headcount | Total 3,000 residents. Grid cell `i` has share `∝ 1 + 3·r_i`, `r_i = rand("kslice", "pop", i)`, normalised to sum 1. Venues have none |
| People present | Grid: `headcount × [0.9, 1.0, 1.1, 0.7]`. Venue: `60 × [0.2, 0.4, 1.0, 0.8]` |
| Public | Venues `semi`; grid cells `public`, except `g0`, `g5` and `g10`, which are `private` |
| Presence | The district shares (entry quantity ÷ 2,964) times `f = 0.4 + 1.2·rand("kslice", "pres", cell, aff)`, rescaled so the headcount-weighted mean equals the district share. Civilian takes the remainder to 1 |
| Opportunity `A` | `T·(b + O)·(1 − G)`, with `T = pop[p] · (1 + 0.5·(services in the cell))`, `O = Σ presence · rw[kind][class]`, `G = min(0.9, 4·ncpd + 2·corp)`, and `b`, `rw` from `data.shape` (§7.1). Gang-clash uses `O = Σ pairs.w` |
| `F` | `0.5 + 1.5·rand("kslice", "F", cell, kind)` |
| `pairs` | Every pair of gang-class affiliations present in the cell, `w = presence_a · presence_b · (1 + 2·border)`, `border = 1` for the six cells on the district's edge, else 0, times the hostility factor (hostile 1, neutral 0.3, friendly 0) |
| Coverage | `gameCoverage = 0.25` for `theft`, `assault` and `gang-clash` in the two cells hosting a fixed combat community (`g3`, `g8`); else 0 |
| Services | Each venue has one service; `v0 … v4` are vendors with `marketCell = true`; `g6` has a ripperdoc and `g1` a fast-travel point |
| Stubs | `Northside` and `Little China` as stubs: entry totals from [places §9.3](../../../knowledge/places.md#93-gang-presence-by-area), `staticTotalA` set so that Kabuki's share of each kind is 4 %, and `rest.totalA` three times the sum of the listed districts |

**The fixture slice `FX-3`** is for unit fixtures. One district `D1`, `rho = 1`, 90 residents, three grid cells `c1`, `c2`, `c3` in a line (`adj1(c1) = {c2}`, `adj1(c2) = {c1, c3}`, `adj2(c1) = {c3}`), headcount shares 0.5, 0.3, 0.2, `pop` flat 100 in all periods, `public` for `c1` and `c2`, `private` for `c3`. Two gang affiliations `GA` and `GB` plus `civilian` and `ncpd`, with district entry shares 0.10, 0.06, 0.82, 0.02. All `F = 1`. All `gameCoverage = 0` except `gang-clash` at `c2` = 0.5. `A(c, k, p)` is `1.0` for `c1`, `2.0` for `c2`, `0.5` for `c3` for every kind and period. `staticTotalA` is 3.5 per kind and period, and `rest.totalA` is 31.5, so the district's share of each kind is 0.1. One market cell (`c1`).

### 3.3 Settings in force

`SettingsView` is the `SettingsSet` in force at the window ([S0 §14.2](kernel.md#142-records-and-branching)). S1 reads:

| Field | Used for |
|---|---|
| `cityScale` | Multiplies every citywide rate and every offspring mean (§7.2) |
| `classExclusions`, `content` (ceilings per class) | The gate and the zero rate of an excluded kind (§6). `content` is sensitive: it is never written to an S1 digest, log or export |
| `memoryScale` | Recorded and inert until the memory machinery lands (§8.8) |
| `tempo` | Not read. Occurrence is not the director's |

The settings in force **at production time** apply ([S0 §9.2](kernel.md#92-events)). A setting changed mid-span applies from the first window whose `settingsAt(w)` shows it. Replayed history is never re-filtered.

### 3.4 The replay port

The offline replay port feeds the model what the game's feed would. It is the first client of the mirror, and the only one in M3 ([D-18](../decisions.md)). It mirrors the catalogue of the runtime bridge's command API and reads hand-authored story states.

**A replay script** is a list of timestamped lines. The port turns each into an external operation stamped with that time ([S0 §9.4](kernel.md#94-evolution)).

```ts
type ReplayLine =
  | { t: GameTime; op: 'reading'; node: string; slot: string; value: Value }       // a mirrored slot of a mirrored node
  | { t: GameTime; op: 'fact'; name: string; value: number }                       // a game fact; node H("game", "fact:" + name)
  | { t: GameTime; op: 'event'; kind: RawKind; place: string; participants: Array<{ who: string; role: string }>; effects?: Array<{ on: string; effect: Effect }> }
  | { t: GameTime; op: 'person'; key: string; slots: Record<string, Value> };      // declares a mirrored person: H("game", key)
```

Node names in a script are game keys; the port resolves them to `H("game", key)`. The script's `event` lines become raw events: external `event` operations whose creator is `port`, whose `cause` is `port`, and whose `name` is `raw/<t>/<n>` for the `n`-th raw event stamped at `t`.

**The raw event kinds** are entries of the event-kind registry with producer `port`. Each carries its meaning in its kind name and its participants, because an event has no free payload ([S0 §9.2](kernel.md#92-events)):

| Raw kind | Feed kind it stands for | Participants |
|---|---|---|
| `game.death` | `death` | `victim` (a mirrored person), optionally `actor` (the killer, which may be `v`); effect `kill` on the victim |
| `game.combat.start`, `game.combat.end` | `combat` | up to four `hostile` mirrored persons |
| `game.heat.0` … `game.heat.5` | `heat` | none. The stage reached is in the kind. The previous stage is the mirrored slot `v.wanted` at the event's time |
| `game.district` | `district` | none. V's new district is the mirrored slot `v.district` |
| `game.journal.finished`, `game.journal.failed` | `journal` | one `entry` (a mirrored journal node, `H("game", "journal:" + pathHash)`, with mirrored slots `family` and `district`) |

The other feed kinds do not become raw events for S1: `session`, `time` and `fact` act through the kernel and the facts table (readings of `core:game-fact` nodes), `vehicle` and `vehicle.acquired` through V's mirrored slots, and `dialogue` and `call` through S2.

**Mirrored slots S1 reads.** A mirrored person (`xf:person`, extending `core:person`) has these slots from the game: `affiliation` (an `Aff` name), `alive` (yes or no), `crowd` (yes or no), `age-class` (adult or minor; `core:person`), `position` (`core:person`), `quest-linked` (yes or no). `v` has `position`, `district`, `wanted` (0 to 5), `cell` (derived by the port from position and the slice's polygons, smallest area with a vertical test, [places §3.2](../../../knowledge/places.md#32-how-the-game-knows-where-v-is)). A missing reading is `unavailable` and S1 treats it as unknown, never as a value.

## 4. The people

Nobody is simulated until something asks. A resident is a pure function of the world seed, the district's recipe and the resident's identity, so a person can be dropped and drawn again unchanged ([S0 I-3](kernel.md#15-invariants)). Only pins, observed facts and committed seeds persist.

### 4.1 Cells, blocks and headcounts

A **cell** is the finest place S1 counts incidents in (§3.1). A **block** is a grid cell, the place where residents live. A venue cell has no residents and has people present by period (`pop`). A cell's `Id` is `H("gen", leaf, "cells", i)` in the index's grid order, so it never moves while the polygon and the constants hold.

The schema pack `xf.core.world@1` defines these kinds. They extend `core:place`:

| Kind | Slots (in declaration order) |
|---|---|
| `xf:district` | `cells` (many node `xf:cell`; count = the index's cell count) |
| `xf:cell` | `headcount` (int, derived: `round(rho × entry.total × headShare)`; 0 for a venue), `households` (many node `xf:household`; count derived: `ceil(headcount / meanHouseholdSize)`), `band` (enum quiet, elevated, hot, flashpoint; assigned; temporal `W`; tier 2) |

`meanHouseholdSize` is a district value that `people.shape` publishes with the household table (§7.4). The realised number of residents of a block is the sum of its household sizes, which differs from `headcount` by a few per cent. **`headcount` is nominal.**

### 4.2 Residents, households, spells and traits

**The profile.** A resident has a **profile**: one cell of the district's joint table over four attributes.

| Attribute | Values |
|---|---|
| Age band (8) | 16 to 17; 18 to 24; 25 to 34; 35 to 44; 45 to 54; 55 to 64; 65 to 74; 75 and over |
| Role (12) | `vendor`, `shopkeeper`, `service`, `nightlife`, `labourer`, `technician`, `corporate`, `gang`, `police`, `student`, `unemployed`, `retired` |
| Income band (4) | `destitute`, `low`, `middle`, `high` |
| Affiliation class (6) | `civilian`, `ncpd`, then the district's three largest listed affiliations (`A1`, `A2`, `A3`), then `other`. `A1 … A3` are chosen by entry quantity, ties by record name, from the affiliations that are neither `civilian` nor `ncpd`. `other` holds the rest. `DistrictIndex.affOrder` lists the six names. For Kabuki: `civilian`, `ncpd`, `TygerClaws`, `TheMox`, `Scavengers`, `other` (Militech, Animals and the rest) |

That is `8 × 12 × 4 × 6 = 2,304` cells, below `N_enum`. The profile is the enum value `"0" … "2303"`, with index `((a·12 + r)·4 + i)·6 + f`, and one more value `"none"` for a household member who does not exist (below).

**The recipe** is the table `t[0 … 2303]` fitted by `people.shape` (§7.4) and published as a `Table` contribution on the `p0 … p5` slots of the district's households.

**Households are drawn first.** A household is an `xf:household` node, member `h` of a block's `households` slot. Its slots, in declaration order:

| Slot | Meaning |
|---|---|
| `hprofile` | enum of 60 (type 5 × tenure 3 × wealth 4). Types: `single`, `couple`, `family`, `shared`, `crew`. Sampled with the district's household table (a `Table` contribution, §7.4) |
| `extra` | int 0 to 3, sampled; conditioned by the type's `extraWeights` |
| `size` | int, derived: `min(6, base(type) + extra)`, with `base` = 1, 2, 3, 2, 3 |
| `p0 … p5` | enum (a profile or `none`), sampled in this order. `p_j` is `none` when `j ≥ size`, by a `Const` rule. Otherwise the district's `Table` weights it and roster rules narrow it (below) |
| `m0 … m5` | owned nodes of kinds `xf:resident-0 … xf:resident-5` |

The member `m_j` is the owned value `H("val", household, "m" + j)`. Its kind `xf:resident-j` has the slots of `core:person` in the same order, preceded by `profile`, with the `drives` slot replaced by the owned drive-state slots and followed by `archetype`, `z1`, `z2`, `life`, `horizon` and `ethosMult` (§8.1). `profile` is **derived** from the owner's `p_j` by a unary identity view with an identity preimage. A pin on the resident's profile therefore narrows the household's slot (S0 §6.4). A resident whose profile is `none` does not exist. There are six kinds, one per position, so that a derive needs no member index.

**Roster rules.** Each household type has a roster, `data.people.rosters[type][j]`: the age bands allowed for member `j`, a relation to member 0 (`any`, `gapAtMost1`, `gapAtLeast2`: the difference of age bands), and `sameAff` (true for the `crew` type). The pack builder turns each roster row into a `constrain` contribution `Rule(when: type = T and size > j [and band(p0) = b], then: Set(profiles satisfying the row))`, at layer `simulation`. At most 40 rules apply to any `p_j`. M3 rosters:

| Type | Member 0 | Member 1 | Members 2 to 5 |
|---|---|---|---|
| `single` | 18+ | none | none |
| `couple` | 18+ | 18+, `gapAtMost1` | none |
| `family` | 25 to 54 | 18+, `gapAtMost1` | 16 to 24, `gapAtLeast2` |
| `shared` | 18 to 54 | 18 to 54 | 18 to 54 |
| `crew` | 18 to 44, an affiliation of class gang | `sameAff` | `sameAff` |

A household is therefore coherent by construction: no child older than a parent, no orphan below the roster, a crew house with one affiliation. Dependants younger than 16 are not residents. They are a count, and a pack kind opens one when a story needs one (P3 §4.3).

**The seed table of the fit** is the product of three pack factor tables, `ageRole` (8 × 12), `roleAff` (12 × 4 classes) and `roleIncome` (12 × 4), with a floor. It makes impossible cells rare. M3 defaults: `ageRole` is 0 where the role cannot occur (`student` at 55 and over, `retired` below 55, `police` below 21 or above 64, `corporate` below 21 or above 64, `gang` above 54), 0.05 where it is rare, else 1. `roleAff` makes `police` possible only for `ncpd` and `ncpd` only for `police`, `gang` possible only for gang-class affiliations, `corporate` favour corporation-class affiliations, and gives every other cell 1. A "0" means the floor of §7.4.

**Spells.** A life is a set of overlapping spell tracks. M3 has four: `residence` (tenure only), `work` (employed, between jobs), `health` (well, ill) and `partner` (single, partnered). Each alternates between two states `A` and `B`. The length of spell `k` is drawn from a keyed table of 16 quantiles:

```ts
spellLen(person, track, k) = lenQ[track][stateOf(k)][ageBand(person)][floor(rand("spell", person, track, k) * 16)]   // seconds
spellState(person, track, k) = (k + s0) mod 2, with s0 = rand("spellv", person, track, 0) < pA[track][ageBand] ? 0 : 1
anchor(person, track) = -floor(rand("anchor", person, track) * lenQ[track][s0][ageBand][15])    // the start of spell 0, at or before game time 0
```

`stateAt(person, track, t)` walks from the anchor, adding spell lengths, until the end of spell `k` passes `t`, and returns `{ k, state, start, end }`. The walk is at most 64 steps (more is a defect `walk-limit` and the last state holds). It is cached by revision and `t` ([S0 §5.5](kernel.md#55-caching)). A 20-day wait costs nothing. The M3 default tables are `lenQ[track][s][band][q] = base[track][s] × m[band] × (0.2 + 1.8 × q / 15)` in seconds, with `base` in days: residence 1,100 and 60, work 700 and 90, health 120 and 4, partner 400 and 300, and `m` = 0.6, 0.8, 1.0, 1.0, 1.0, 1.1, 1.2, 1.2 across the age bands. `pA` is 1 for `residence`, 0.8 for `work`, 0.95 for `health`, 0.5 for `partner`.

**The lifetime** is one kernel draw, the sampled slot `life` (an enum of 16 equiprobable bins, §8.1): `deathAge = max(age + 1, lifeQ[life])`, `lifeQ = [45, 55, 60, 65, 68, 71, 74, 77, 80, 82, 84, 86, 88, 90, 92, 95]` **[tunable]**. A resident dies of age at `t = (deathAge − age) × 31,557,600` s. Age does not advance with `t` (P3 §4.3), so in a playthrough of months this is moot. A story event, such as a killing, pins a death over it.

**Residence spells do not move people.** A block keeps its households for the lineage. Arrivals, departures and moves are phase 2 (§0.3).

**Traits.** Three coarse traits are `core:trait` members of the resident, drawn by the kernel on the persistent id, each with strength 0.2, 0.5 or 0.8 (low, mid, high): `stability` with prior (0.2, 0.3, 0.5), `memory` (0.25, 0.5, 0.25), `sociability` (0.25, 0.5, 0.25) **[tunable]**. An author may fix any of them for a named person. `ageClass` is `adult` at 18 and over, derived from `age` (S0 §2.6). Every resident is an adult or a 16 to 17-year-old minor.

**Importance draws.** The two latent axes `z1`, `z2` of a person and the per-drive noise of each drive-state are sampled slots (enums of 64 equiprobable normal quantile bins, §8.1), drawn by the kernel on the persistent id. The normal value of bin `q` is `Z[64·q + 32]`. S1 adds no key of its own for them.

### 4.3 Archetypes, names and binding

**Archetype.** `archetype` is a sampled enum slot of the resident. Pack `Table` contributions, one rule per role, weight it. M3 has eight archetypes and the default `resident`, whose multipliers are all 1: `street-vendor`, `gang-member`, `gang-leader`, `fixer`, `police`, `service-worker`, `young-street`, `elder`. The default weights by role are:

| Role | Archetype weights |
|---|---|
| `vendor`, `shopkeeper` | `street-vendor` 1 |
| `service`, `nightlife` | `service-worker` 1 |
| `gang` | `gang-member` 1 |
| `police` | `police` 1 |
| `student` | `young-street` 0.6, `resident` 0.4 |
| `retired` | `elder` 0.7, `resident` 0.3 |
| `labourer`, `technician`, `corporate`, `unemployed` | `resident` 1 |

`gang-leader` and `fixer` are never sampled. They are assigned: leaders by `group.decide` (§7.8), fixers by canon (§4.4). The multipliers `A(archetype, drive)` are pack data, from [dossier 1 §10.3](../craft/d01-motivation-drives.md#103-archetype-multipliers). They are by role, never demographic (§12, the source lint).

**Names.** The pack's name registry gives `origin` weights by district and affiliation class (pack `Rule` contributions on `core:name.origin`), and `given` and `family` conditioned on the origin (`enum-by`). Origin feeds no drive and no policy.

**Binding to a body.** The game never creates a street person from nothing. It switches on communities and re-rolls bodies on every sector load. S1's resident is a **model person** that a body may stand for.

```ts
function bind(community: string, entry: string, spot: string, ordinal: number, castType: CastType): Id | 'fallback' {
  const block = cellOfSpot(spot);                                   // from the index
  for (let attempt = 0; attempt < 24; attempt++) {
    const r = residentAt(block, Math.floor(rand("bind", community, entry, spot, ordinal, attempt) * residentCount(block)));
    if (r !== undefined && fits(r, castType) && !protectedSet(r)) return r;     // fits: affiliation class and adulthood, §4.2
  }
  return 'fallback';                                                // a defect `bind-fallback`; the port's runtime entity id stands in for the session
}
```

`residentAt(block, n)` is the `n`-th resident in block order (§4.5). A casting type's `isChild` flag has no resident and always falls back. **A resident is pinned `observed` when V notices them** (a scan, a conversation, a hit, a name heard). Until then no body is identified. The `look key` S1 hands to P8 is `H("look", resident)`. If the binding key proves unreadable or unstable in the game (P3 open question 3), the binding falls back to the session. This is the port's matter.

### 4.4 The protected set, canon people and the spine

**The protected set** is what harm events and absences choose outside of. It is read from the kernel, never stored:

```ts
protectedSet(n: Id): boolean =
     hasCastEdge(n)                 // a core:cast edge from a live core:seed (S2)
  || hasObservedPin(n)              // V has met them
  || isMirroredCanon(n)             // a mirrored person with quest-linked = yes, or a spawn set, fixer or vendor the game pins
  || isSpine(n)                     // a canon character of the main story
  || packEssential(n);              // a pack flag
```

**Canon people** are mirrored nodes `H("game", gameKey)`. S1 holds beliefs about them and ties with V, and nothing the game records about them. The change policy moves only what they believe about V and their ties with V, unless an author declares a turn (§8.10). **`isSpine(n)`** answers whether a node is a canon character of the main story. Its data are the characters whose fate the game's final boards read ([main-story state §4](../../../knowledge/main-story-state.md#4-characters-whose-state-the-game-tracks)), joined to the mirrored nodes by game key.

### 4.5 Where people are

**Order.** Residents of a block are ordered by `(household index h, member j)`. The ordinal of resident `(h, j)` is `prefix(h) + j`, with `prefix(h) = Σ_{h' < h} size(h')`, cached per block by revision. `residentCount(b)` is `prefix(households#count)`. `residentAt(b, n)` finds the household by binary search on `prefix`.

**Routines.** `where(person, t)` is a pure function. It is never ticked, and it applies only to people the game does not place. A mirrored or game-placed person keeps the game's position; S1 holds their beliefs, not their position.

```ts
type Whereabouts = { cls: 'home' | 'work' | 'out' | 'away'; cell?: Id; cause: 'none' | 'ill' | 'closed' | 'between-jobs' | 'protected-present' };
function where(person: Id, t: GameTime): Whereabouts {
  const day = dayIndex(t), p = periodOf(t);
  const arch = archetypeOf(person);
  let cls = schedule(arch)[p][invCum(schedule(arch)[p], rand("sched", person, day, p))];       // 'home' | 'work' | 'out'
  let cause = 'none';
  if (protectedSet(person)) return { cls, cell: placeOf(person, cls, day, p), cause: 'protected-present' };   // never removed
  if (stateAt(person, 'health', t).state === 1) { cls = 'away'; cause = 'ill'; }
  else if (cls === 'work' && stateAt(person, 'work', t).state === 1) { cls = 'home'; cause = 'between-jobs'; }
  else if (rand("absent", person, day) < absentP(arch)) { cls = 'away'; cause = closedCause(person, t) ?? 'none'; }
  return { cls, cell: placeOf(person, cls, day, p), cause };
}
```

`schedule(arch)[p]` is a weight triple for (home, work, out) in period `p`. `placeOf`: home is the resident's block; work is the person's workplace cell, drawn once as `workCell(person)` among the block, its `adj1` and (for the market roles) the marketCells among them, by `rand("work-place", person)`; out is a public cell among the block and `adj1` by `rand("out-place", person, day, p)`; away has none. `closedCause` returns `closed` when the person's stall is closed by a regime. The M3 schedule defaults (home, work, out):

| Archetype | M | D | E | N |
|---|---|---|---|---|
| `street-vendor` | 0.1, 0.8, 0.1 | 0.1, 0.8, 0.1 | 0.3, 0.5, 0.2 | 0.9, 0, 0.1 |
| `service-worker` | 0.3, 0.5, 0.2 | 0.2, 0.5, 0.3 | 0.1, 0.6, 0.3 | 0.2, 0.6, 0.2 |
| `gang-member` | 0.3, 0.1, 0.6 | 0.2, 0.2, 0.6 | 0.2, 0.2, 0.6 | 0.3, 0.1, 0.6 |
| `police` | 0.1, 0.8, 0.1 | 0.1, 0.8, 0.1 | 0.2, 0.7, 0.1 | 0.4, 0.5, 0.1 |
| `young-street` | 0.4, 0.2, 0.4 | 0.2, 0.2, 0.6 | 0.1, 0.1, 0.8 | 0.4, 0, 0.6 |
| `elder` | 0.5, 0.1, 0.4 | 0.5, 0.1, 0.4 | 0.7, 0, 0.3 | 0.95, 0, 0.05 |
| `resident`, others | 0.4, 0.4, 0.2 | 0.3, 0.4, 0.3 | 0.5, 0.2, 0.3 | 0.9, 0, 0.1 |

`absentP` is 0.08 for every archetype **[tunable]**. **Pulses** are rate shapes (§7.1), not people's routines. `reachable(from, t1, to, t2, mode)` works over cell centroids with mode speeds as data (`walk` 1.4 m/s, `car` 9 m/s, `metro` 18 m/s **[tunable]**) and the graph distance times the cell pitch (200 m **[tunable]**); it is exact only at that resolution and is used by casting and by alibi checks.

**Who is present in a scene.** `presentAt(cell, t, cap)` lists the people who are in the cell at `t`:
1. residents of the cell's block and of its `adj1` blocks with `where(p, t).cell = cell` and `cls ≠ away`, taken in block order (the cell's own block first, then `adj1` by `Id`), then ordinal;
2. for a venue cell, the same over its host and the host's `adj1` blocks;
3. cut to `cap` (60 **[tunable]**) by sorting on `rand("present", cell, person)` ascending, ties by `Id`.

Only the cut residents are resolved. Counting without resolving, a cell's headcount for the period is `pop[p]`.

### 4.6 The tie function

Most ties between ordinary people are never stored. A tie is a symmetric keyed draw on a pair of residents `(a, b)` of one district.

**Foci** are rosters the engine already has. Each is a keyed partition of a block's residents, so a roster costs nothing to store.

| Focus type | Members | Partition | `p_f` |
|---|---|---|---|
| `household` | the household's present members | the household | share 1 |
| `crew` | residents whose affiliation class is gang | cells of about `crewSize` (12) in the block, `n = max(1, round(headcount × gangShare / 12))`; resident `r` is in cell `floor(rand("focus", "crew", r) × n)` | share 0.3 |
| `work` | residents with a work role (`shopkeeper`, `service`, `nightlife`, `technician`, `labourer`, `corporate`, `police`) | cells of about 10, by role group | k = 3 |
| `market` | residents with role `vendor` or `shopkeeper` in a block with a market cell on it or on its `adj1` | rows of about 8 | k = 3 |

A focus id is `H("focus", type, block, group, cell)`. A focus type has either a `share` (then `p_f = share`) or a `k` (then `p_f = min(1, k / (n_f − 1))`, with `n_f` the focus's expected size). The table is `data.ties.focus`.

```ts
function tie(a: Id, b: Id): { tied: boolean; kind: string; layer: 1 | 2 | 3 } {      // symmetric, a ≠ b
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const shared = sharedFoci(lo, hi);                                  // in focus-id order
  let q = 1;
  for (const f of shared) q = q * (1 - pFocus(f));
  const pFoci = 1 - q;
  const pg = 0.5 * (pGeo(lo, hi) + pGeo(hi, lo));                     // made symmetric
  const p = 1 - (1 - pg) * (1 - pFoci);
  return { tied: rand("tie", lo, hi) < p, kind: kindOf(shared), layer: layerOf(shared) };
}
function pGeo(a: Id, b: Id): number { return data.ties.cGeo / (HN * rankOf(a, b)); }       // HN = Σ_{r=1..N} 1/r, summed in order; cGeo [tunable 8], and cGeo ≤ HN is checked at load
```

`rankOf(a, b)` is `1 +` the number of residents who come before `b` in `a`'s walking order. The order is: `a`'s block first, then the district's other blocks by `(graph distance from a's block, block Id)`. Inside `a`'s block it is `(ordinal(b) − ordinal(a) − 1) mod n` (a cyclic successor order). Inside another block `B` it is `(ordinal(b) − anchor) mod n_B`, with `anchor = floor(rand("rank-anchor", a, B) × n_B)`. The symmetrisation removes the asymmetry. There are no far ties in M3 (`p_far` = 0): city-wide foci supply the bridges in phase 3.

`kindOf` is the kind of the strongest shared focus (`household` → `kin`, `crew` → `crew`, `work` → `colleague`, `market` → `neighbour`; none → `neighbour`). `layerOf` follows the same: household is layer 1 (inner), crew and work and market are layer 2 (middle), geography alone is layer 3 (outer). **Triadic closure needs no rule:** shared foci give it. The tie function never reads a reputation ledger.

**`neighbours(a, layer, cap)`** enumerates `a`'s ties up to a layer:

```ts
function neighbours(a: Id, layer: 1 | 2 | 3 | 4, cap = data.ties.layerCap[layer]): Id[] {      // layerCap = {1: 5, 2: 15, 3: 50, 4: 150}
  const out: Id[] = [];                                               // each test costs 50 allowance units; each roster member 1; the call is capped at 5,000
  for (const f of fociOf(a)) if (layerOfFocus(f) <= layer) for (const r of roster(f, 64)) if (r !== a && tie(a, r).tied) add(out, r);   // inner first, then middle; by focus id, then ordinal
  if (layer >= 3) for (const B of blocksOutward(blockOf(a))) for (const r of residentsOf(B)) if (r !== a && tie(a, r).tied) add(out, r);   // by (graph distance, block Id), then ordinal
  return out.slice(0, cap);                                           // stops early at cap or at the unit limit
}
```

Duplicates are skipped. The layer budgets (5, 15, 50, 150) cap how many ties are *opened* for one person, not how many exist.

**Materialisation.** A tie becomes an edge when V observes it, a belief about it is formed or told, a goal frame uses it, or a seed casts through it. The edge is `xf:tie`, with `Id` `H("edge", "xf:tie", lo, hi)`, cause `sampled`. A person has at most 20 materialised ties **[tunable]**; a new one beyond that ends the weakest edge that neither V, a live frame nor a memorable belief depends on (ties by `Id`). Casting through ties, in S2, first opens a bounded candidate set with `neighbours` ([S2 §2.17](seeding.md#217-people-order-and-reputation-as-material)).

**Position.** For a person with contact shares `s_f` over foci, `bridge(p) = 1 − Σ_f s_f²`: near 0 inside one cluster, large across several. `s_f` is the share of the person's expected contacts that lie in focus `f` (its `p_f × (n_f − 1)` over the sum of the same). A fixer is a person with `bridge ≥ 0.6` across at least three foci of different class. For a canon person the shares are pack-declared.

### 4.7 The tie record

The record has three parts. All numbers are **[tunable]**.

| Record | Form | Holds |
|---|---|---|
| `tie(A, B)` | edge `xf:tie`, symmetric | attrs `kind` (an enum set; `kin`, `crew`, `colleague`, `neighbour`, `friend`, `rival`), `status`, `strength` (q 1/64), `lastContact` (int, −1 if none). data `history`, `via` |
| `regard(A → B)` | edge `xf:regard`, directed | A's `warmth`, `respect` (−1 to 1), `trustA`, `trustB`, `trustI` (0 to 1), `evN` (int), `satisfaction`, `investment` (0 to 1) |
| `belief(A about B)` | the kernel's belief record | what A thinks B did, and why |

**For a tie with V, only the NPC's side exists.** There is no `regard(V → NPC)`, no record of V's desire, no field that models V's feelings ([D-09](../decisions.md)). `tie(NPC, V)` holds the history as events V did and the status, and the depth reached by acts.

**Coarse tier.** A tie below tier 4 is `{ kind, status, strength, lastContact }`. Opening it (tier 4) derives the rest from the history. Closing it keeps the pins.

**History.** `history` is a list of at most 32 entries `{ event, salience 0..3, reason, kind }`, newest last. Salience rises by 1 (to 3) for an act that touched the NPC's concerns and for an act V returned to. Entries at salience 0 older than 14 game days are dropped. The entry with the lowest salience (then the oldest) goes first when the list is full.

**Derived values.**

```ts
strength   = q64(0.25 * (timeP + intensityP + intimacyP + servicesP))      // each part in 0..1, from the history
  timeP      = min(1, sharedHours / 200)                  // hours of joint activity
  intensityP = max over entries of (salience / 3) × recency(age)       // recency: 1 up to 7 days, 0.7 up to 30, 0.4 up to 90, 0.15 beyond
  intimacyP  = min(1, disclosures × 0.25)                  // disclosure events, a responsive reply each
  servicesP  = min(1, favours / 6)
satisfaction = clip01(0.5 + 0.35 * warmth + 0.15 * respect)
investment   = min(1, Σ salienceWeight(entry) / 12)       // salienceWeight = [0.25, 0.5, 0.75, 1]
alternatives = max strength over A's other materialised ties of the same kind class, else 0.2
commitment   = 0.5 * satisfaction + 0.3 * investment + 0.2 * (1 - alternatives)       // only the order of the weights is from evidence
currency     = 1 - min(1, (t - lastContact) / maxInterval[kind])      // maxInterval: kin 120 d, crew 60, colleague 45, neighbour 30, friend 40
quality      = strength × (1 - 0.5·[status ∈ {strained, estranged}])
```

`timeP` and the counts are read from the history, not stored. Quality and currency are derived on demand and are **never pinned** (§15 item 5). Because each is a function of timestamped facts and `t`, a jump and a tick agree.

**Typed interaction events** (kinds `bid`, `reply`, `disclosure`, `favour`, `conflict`, `repair`, `joint-activity`, `novel-activity`, `crisis`) each cite their cause. A state change cites the event that caused it. The update table for the NPC's regard, per event, is `data.ties.deltas`:

| Event | warmth | respect | trustA | trustB | trustI | Other |
|---|---|---|---|---|---|---|
| `reply` accepting a bid | +0.08 | +0.02 | 0 | 0 | 0 | |
| `reply` declining | −0.01 | 0 | 0 | 0 | 0 | |
| `disclosure` by V | +0.05 | 0 | 0 | +0.02 | 0 | intimacy +1 |
| `favour` by V for the NPC | +0.10 | 0 | +0.02 | +0.08 | 0 | services +1 |
| `conflict` | −0.15 | −0.05 | 0 | −0.03 | −0.05 | |
| `joint-activity` | +0.03 | 0 | 0 | 0 | 0 | hours + the activity's duration |
| `novel-activity` | +0.04 | 0 | 0 | 0 | 0 | `lastNovel` = now |
| `crisis` | ±0.10 | ±0.05 | by attribution | by attribution | by attribution | |

A negative trust delta is multiplied by `m_att`: 1.5 when the belief about the cause is dispositional (`attr@1`, §8.6), 0.5 when situational, 1 when unknown. `evN` rises by 1 per row. Trust components stay in 0 to 1, warmth and respect in −1 to 1. A `repair` event restores each trust component by `repairFraction × its last loss`, where `repairFraction` is 0.5 for an apology and 0.8 with restitution; it never restores more than was lost.

**Status is kept apart** from the private variables. `status` is one of `acquainted`, `friendly`, `close`, `strained`, `estranged`, `ended`. A status change that involves V needs **an observed V act and the NPC's own acceptance**:

```ts
// up: acquainted → friendly → close. `rung` names the step, `event` the observed V act.
pAccept = clip01(accBase[rung] + 0.4 * warmth + 0.3 * (trustMean - 0.5) + 0.2 * (sociability - 0.5));   // accBase: friendly 0.5, close 0.3
accepted = !boundaryAt(npc, rung) && rand("accept", tie, event) < pAccept;        // the key names the tie and the act; a reload reproduces it
```

A boundary pin on the rung refuses without a draw, and no attempt count enters the formula. A fall is the NPC's own consequence: `strained` when `warmth < −0.4` and `trustMean < 0.3`, back to `acquainted` when both recover above −0.1 and 0.4. `ended` is by V's retract or the NPC's exit, never by absence.

**Replies.** V's reply to a bid is classified from acts within `replyWindow` (60 windows): `accept` when V's act matches the bid, `decline` for an explicit refusal, `deflect` for another act in the same exchange, `none` when no act arrived. A `none` is "no answer", never a rebuff, **unless V had a chance to answer**: V was in the NPC's district at a boundary inside the window (from the mirrored `v.district`). Without a chance the reply is not recorded. With one it counts as a `decline` with half effect.

**Gifts** are acts read through the NPC's concern. The `give` effect of a gift is matched against the NPC's frames' `wants`; the gain is `warmth += 0.2 × r`, `r` the relevance of the match, and there is no flat bonus per item. In a `communal` tie (kin, crew), prompt repayment is `warmth −= 0.02`.

**Absence and reunion.** An absence has a cost only through an open commitment (a promise V made, an unpaid debt). A reunion after `elapsed > 2 × maxInterval[kind]` is `warm` by default: no change to warmth, `currency` resets on contact. It is `cool` only when an intervening event of V's harmed the NPC, or an open commitment is overdue; then the next reply is classified one step less favourable. Nothing in S1 penalises absence alone, schedules offers to retain, or builds a streak or guilt effect (§12).

**Consent and pursuit.** A boundary is a persistent `authored` or `observed` pin on `boundary` (an enum set of rungs) of the NPC, with a reason. A pursuit budget allows **one romantic bid per rung per 144 windows**, and none after a decline or a `none` that counted as a decline: `S1Record.ties.pursuit[tie + rung] = { lastBid, blocked }`. S1 never generates intimate scene content, and it refuses any occurrence carrying a `sex.*` tag (the gate, §6). A one-input **retract** of V's soft-excludes the thread: the observed event `retract` with the tie id adds it to `softExcluded`. No bid, event or frame is made for a soft-excluded tie, and the thread stays visible and editable.

**Interests from ties.** A tie whose `commitment ≥ 0.6` contributes a `protects` interest to the NPC's `family` or `friendship` frame: `{ scope: { nodes: [other] }, where: [@effect in {harm, kill, expose, take}] }`, added by `frame-interests`, so the dilemma check finds cross-pressure.

**Borrowed results.** The commitment weights, the bid and reply classification, and the warm reunion are borrowed from the literature on couples. Each is marked `borrowed: true` in the pack and has a calibration fixture (SF1-T-6): the share of cold reunions, bids per tie per week, the share of ties with a surfaced moment, the share of declines that continue as friendships.

**Numbers stay quiet.** No value of this section is shown to V. They reach traces and the decision log only.

## 5. The event catalogue

### 5.1 The kind registry

Event kinds are pack data. An event's kind is the value of its `kind` slot (S0 §9.2), registered in the event-kind registry ([S0 §10.5](kernel.md#105-changes-and-matching)). Selectors and patterns match kinds through `where` predicates on that slot, never through schema `KindId`s.

```ts
interface KindDef1 {
  name: string;                                     // the value of the `kind` slot
  family: 'city' | 'order' | 'minds' | 'social' | 'mirror' | 'routine' | 'raw';
  tags: string[];
  effects: Array<{ on: string; effect: Effect }>;  // `on` is a role name; `effect` from S0 §10.8
  producers: string[];                              // process ids, policy names, 's2', 'port'
  sizes: [number, number];                          // city kinds: 1 to 4. Others [1, 1]
  classes: Array<{ class: string; shown: 1 | 2 | 3; reported: 1 | 2 | 3 }>;   // the content listing; [] with `none: true` for a kind of no class
  none?: true;
  roles: RoleSpec[];                                // §5.4
  severity: number; pulse: number;                  // 0 to 1: used by telling selection (§8.7) and salience (§8.6)
  carrier: { channels: Array<'people' | 'media' | 'place'>; days: number };   // civic memory, the S2 `cosmetic` schema
  // city kinds only:
  hourShape?: [number, number, number, number]; dayShape?: number[]; pulses?: Pulse[];     // §7.1
  base?: number; rw?: Partial<Record<AffClass, number>>;                                    // the flat base term b_k and offender role weights
  offspringFactor?: number; delayBins?: number[]; matrix?: Array<{ kind: string; w: number }>;
}
```

**Lints, at load.** A pack is refused, with the kind named, if: a kind has no producer, no carrier or no content listing; a city kind's offspring mean (`factor × max over its sizes of n_m × cityScale`) is 0.9 or above; a driver names an absent place dimension or the crime multiplier (dimension 12); a matrix row names an unknown kind; a kind has a name starting `meta:` and a producer in S1; a ladder has no rung with an empty or lowest class.

### 5.2 The ten city kinds (M3 data)

| Kind | Tags | Effects (on role) | Sizes | Hour shape M·D·E·N | Day shape Mon … Sun |
|---|---|---|---|---|---|
| `theft` | property | `take` on victim | 1 to 2 | 0.8·1.0·1.2·0.9 | flat |
| `assault` | personal-violence | `harm` on victim | 1 to 2 | 0.4·0.7·1.3·1.6 | 0.8 0.8 0.9 1.0 1.3 1.4 1.0 |
| `gang-clash` | group-violence | `harm` on victim | 1 to 4 | 0.2·0.5·1.2·2.1 | 0.8 0.8 0.9 1.0 1.3 1.4 1.0 |
| `shakedown` | protection | `take` on victim | 1 to 2 | 0.5·1.5·1.0·0.2 | flat; pulse Fri 10 to 16 × 3 |
| `police-action` | response | `protect` on victim, `take` on target | 1 to 3 | flat | flat |
| `psycho-break` | cyberpsychosis | `harm` on victim | 2 to 4 | 0.9·0.9·1.0·1.2 | flat |
| `disorder` | assembly | `meet` on participant, `harm` on victim | 1 to 4 | 0.3·0.8·1.4·1.0 | 0.8 0.8 0.8 1.0 1.3 1.5 1.1 |
| `accident` | hazard | `harm` on victim | 1 to 3 | 1.3·0.9·1.3·0.6 | flat |
| `outage` | system | `move` on place | 3 to 4 | flat | flat |
| `commerce` | market | `give` on giver, `take` on taker | 1 to 2 | 1.6·1.2·0.6·0.1 | flat; pulse Mon and Thu 06 to 10 × 1.5 |

**The city rate table** (`data.shape.rate`, per game day for the whole city, at shape 1, before `cityScale`). The columns sum to the size ladder of [P3 §5.2](../p3-simulation-layer.md#52-incidents): 300, 45, 6 and 0.8 before the m4 gate.

| Kind | m1 | m2 | m3 | m4 |
|---|---|---|---|---|
| `theft` | 90 | 8 | 0 | 0 |
| `assault` | 66 | 8 | 0 | 0 |
| `gang-clash` | 24 | 6 | 2.4 | 0.3 |
| `shakedown` | 18 | 2 | 0 | 0 |
| `police-action` | 24 | 6 | 1.0 | 0 |
| `psycho-break` | 0 | 1.0 | 0.4 | 0.1 |
| `disorder` | 12 | 4 | 1.2 | 0.3 |
| `accident` | 45 | 7 | 0.8 | 0 |
| `outage` | 0 | 0 | 0.2 | 0.1 |
| `commerce` | 21 | 3 | 0 | 0 |
| **City** | **300** | **45** | **6.0** | **0.8** |

A cell of zero rate for a size outside the kind's `sizes` is a lint (it must be zero). Each step is about 6 to 8 times rarer, a log-linear law of slope 0.8 to 0.9 in base ten. Size is the reach of consequence, not severity: m1 reaches the cell and the ties of those present; m2 the district's talk within a game day; m3 the district, its neighbours and the feed; m4 several districts; m5 the city and is authored only.

**Drivers** (`base` and `rw`, used by the offender term, §5.4 and §7.2):

| Kind | `base` | `rw` gang | `rw` corp | `rw` ncpd | Notes |
|---|---|---|---|---|---|
| `theft` | 0.02 | 1.0 | 0.1 | 0 | |
| `assault` | 0.01 | 1.0 | 0.1 | 0 | |
| `gang-clash` | 0 | pair weight | 0 | 0 | the opportunity is the sum of the cell's `pairs` |
| `shakedown` | 0 | 1.0 | 0 | 0 | one group's presence |
| `police-action` | 0 | 0 | 0 | 1.0 | the offender is the responder |
| `psycho-break` | 0.01 | 0 | 0 | 0 | flat; a district modulator from the ripperdoc count |
| `disorder` | 0.01 | 0.3 | 0 | 0 | |
| `accident` | 0.03 | 0 | 0 | 0 | |
| `outage` | 0.01 | 0 | 0 | 0 | |
| `commerce` | 0.02 | 0 | 0 | 0 | |

**Offspring** (`data.events.offspring`). The base mean by parent size is `n = [0.20, 0.30, 0.45, 0.60, 0.70]` for m1 to m5, times the kind's `offspringFactor` (1 for all but `police-action` 0.5, `commerce` 0.6, `psycho-break` 0.5, `outage` 0.8), times `cityScale`, times the local modifier (§7.2). The dispersion is `k = 0.3`. At most 8 children. The delay bins, in windows, are `[1, 1], [2, 6], [7, 36], [37, 144], [145, 1008], [1009, 4320]`. Their default weights are `[0.15, 0.25, 0.30, 0.20, 0.08, 0.02]`; `police-action` has `[0.5, 0.35, 0.12, 0.03, 0, 0]` and `gang-clash` `[0.05, 0.15, 0.3, 0.3, 0.15, 0.05]`. The child's size is the parent's plus a step: −1 weight 0.60, −2 weight 0.25, 0 weight 0.12, +1 weight 0 in M3 (the +1 weight of 0.03 needs an arc budget, which is not built), clamped to the child kind's `sizes`.

**The interaction matrix** (`matrix`, the kind of a child by the parent's kind). Weights are relative.

| Parent | Children |
|---|---|
| `theft` | `theft` 0.5, `police-action` 0.5 |
| `assault` | `assault` 0.4, `police-action` 0.6 |
| `gang-clash` | `gang-clash` 0.5, `police-action` 0.4, `disorder` 0.1 |
| `shakedown` | `assault` 0.5, `police-action` 0.3, `shakedown` 0.2 |
| `police-action` | `police-action` 0.75, `disorder` 0.25 |
| `psycho-break` | `police-action` 1 |
| `disorder` | `police-action` 0.6, `theft` 0.4 |
| `accident` | `police-action` 0.8, `outage` 0.2 |
| `outage` | `accident` 0.4, `theft` 0.4, `disorder` 0.2 |
| `commerce` | `theft` 1 |

The `default` kind of P3 belongs to `order.contracts` and is not built (§0.3). A row entry for a kind excluded by the player's lines is removed and the row renormalised (§6).

**Content listing** (the starter classes, S4's registry owns the final names):

| Kind | Classes (shown / reported) | Severity | Pulse | Carrier |
|---|---|---|---|---|
| `theft` | `property` 1/1 | 0.4 | 0.3 | people, 7 days |
| `assault` | `harm.residents` 2/1 | 0.7 | 0.6 | people, 14 |
| `gang-clash` | `harm.residents` 3/2; `harm.groups` 2/1 | 0.9 | 0.8 | people and place, 30 |
| `shakedown` | `property` 2/1; `harm.residents` 1/1 | 0.5 | 0.4 | people, 14 |
| `police-action` | `harm.residents` 2/1 | 0.5 | 0.4 | people, 7 |
| `psycho-break` | `harm.residents` 3/2; `dread` 2/1 | 1.0 | 0.9 | media, 60 |
| `disorder` | `harm.residents` 2/1 | 0.6 | 0.6 | media and place, 30 |
| `accident` | `harm.residents` 2/1 | 0.5 | 0.5 | place, 7 |
| `outage` | none | 0.3 | 0.4 | place, 3 |
| `commerce` | none | 0.1 | 0.1 | people, 2 |

### 5.3 The other kinds

| Family | Kinds | Producers | Notes |
|---|---|---|---|
| Order | `regime-start`, `regime-end` | `city.shape` | Size 3 or the regime's size. Causes: the regime's arrival draw has none |
| Order | `enforcement` | `order.norms`, `scene.acts` | One per use of a rung of a norm's ladder (§7.5), or of the seven-day rung of a debt ladder (§8.1); effects by rung: `meet` (talk), `take` (shun, fine), `expose` (public shaming), `harm` (beating) |
| Order | `reminder`, `collector-visit` | `scene.acts` | The first two rungs of a debt ladder for a demanded debtor (§8.1), and a collector's routine visit to a stall in a focused scene (§7.9) |
| Routine | `serve`, `patrol` | `scene.acts` | A vendor serves a customer; an officer walks the beat. Texture: not counted in any summary |
| Mirror | `gig-outcome` | `city.mirror` | A mirrored gig or hustle result. Size 1. No effects. Class none |
| Mirror | the ten city kinds | `city.mirror` | Derived from raw events (§7.3). The creator is the mirror process |
| Raw | `game.death`, `game.combat.start`, `game.combat.end`, `game.heat.0 … 5`, `game.district`, `game.journal.finished`, `game.journal.failed` | `port` | Records of what the game did. Never filtered or edited |
| Minds | `goal-met`, `goal-abandoned`, `goal-blocked` | `goals` | Cause: the goal's frame. Only for actors in a root's focus |
| Minds | `turning`, `refusal` | `change` | §8.10 |
| Minds | `reply` | `ties` | Classifies V's answer to a bid (§4.7) |
| Minds | `bid`, `disclosure`, `favour`, `conflict`, `repair`, `joint-activity`, `novel-activity`, `crisis`, `retract` | `s2`, `port` | Acts that seeds or V make. S1 consumes them. They are in the registry so that a pattern may name them |
| Social | `tell`, `lie` | `social` | §8.7. `tell` has effect `expose` on its subject, `lie` has `conceal` |
| Social | `promise`, `threat`, `confess`, `betrayal`, `expose`, `conceal` | `s2` | Produced by seeds. S1 reads them |

A kind appears in the registry only when something can produce it. The kinds of the processes held back (`skim`, `deviation`, `default`, `recruit`, `exit`, `defection`, `split`, `overhear`, `rumour`, `blacklist`) are registered when their process is built, and a pack that lists them earlier is refused by the lint.

Every event S1 mints carries `causes`, `outcome` (`done` unless the occurrence failed or was prevented) and `served` where they exist ([S0 §9.2](kernel.md#92-events)). **A child's time is at least one window after its parent's.** A derived mirror event takes the time of the raw event it re-describes (§7.3).

### 5.4 Roles and casting the people of an event

```ts
interface RoleSpec {
  role: string;                                     // aggressor, victim, target, hostile, witness, responder, enforcer, giver, taker, participant
  source:
    | { from: 'offenders' }                         // an affiliation class from offenderWeights, then a resident of it
    | { from: 'group'; side: 'A' | 'B' }            // a side of the event's gang pair
    | { from: 'residents'; roles?: string[] }       // any adult resident present, optionally by profile role
    | { from: 'responders' }                        // an ncpd resident
    | { from: 'parent'; role: string };             // a participant of the parent event
  count: [number, number];                          // at most 4 persons in all per event
  adult: boolean;                                   // true for aggressor, victim, target, hostile
}
```

M3 roles by kind: `theft`, `assault`, `accident`, `psycho-break`: aggressor `offenders` (none for `accident`), victim `residents`; `gang-clash`: aggressor `group A`, victim `group B`; `shakedown`: aggressor `group A` restricted to profile role `gang`, victim `residents` of role `vendor` or `shopkeeper`; `police-action`: responder `responders`, victim `parent victim`, target `parent aggressor` (a patrol without a parent: target `residents` of a gang affiliation); `disorder`: participants `residents`, count 2 to 4; `outage`: no persons, the place; `commerce`: giver and taker `residents`.

**The offender term.** For a cell `c` and kind `k`:

```ts
offenderWeights(c, k): number[]   // over the district's six affiliation classes, in affOrder
  civilian: base_k
  every other class f: presence_f(c) × rw_k[class(f)] × (1 + boost(f, k))      // `class(other)` = gang; boost from the group digest (§7.8), 0 in M3 unless a goal is active
```

The pair of a `gang-clash` is drawn from `pairs(c)` by `invCum` over their weights (times any pair boost, §7.8): `(a, b)` is oriented by `rand`, side A the aggressor. A retaliation child swaps the sides of its parent.

**Casting a person.** For a spec and a cell, take the block (the cell itself, or a venue's host), then:

```ts
function castPerson(ctx, w, tag: 'who' | 'act-who', ev: Id, spec: RoleSpec, cell: Id, wantAff?: number /* class index */, taken: Id[]): Id | 'group' {
  for (let attempt = 0; attempt < 24; attempt++) {
    const block = attempt < 16 ? blockOf(cell) : pickAdjacent(cell, ctx.procRand(w, tag + "-b", ev, spec.role, attempt));    // the 8 last attempts use an adjacent block
    const n = residentCount(block);
    if (n === 0) continue;
    const r = residentAt(block, Math.floor(ctx.procRand(w, tag, ev, spec.role, attempt) * n));
    if (r === undefined || taken.includes(r) || protectedSet(r)) continue;
    const prof = profileOf(r);                       // resolves the resident's profile slot
    if (spec.adult && ageClassOf(r) !== 'adult') continue;
    if (wantAff !== undefined && affOf(prof) !== wantAff) continue;
    if (spec.roles && !spec.roles.includes(roleOf(prof))) continue;
    return r;
  }
  ctx.log({ proc: ctx.processId, kind: 'defect', reason: 'who-fallback', refs: [ev] });
  return 'group';                                    // the role is filled by the group node, flagged `groupOnly`
}
```

`attempt` is the one allowed non-causal discriminator. A role filled by the group node cites the group as its participant; it never invents a person. **V is never drawn**: V is a root, not a resident. A named or protected person is never drawn (the gate checks it again, §6).

### 5.5 Realisation candidates (data only)

S1 does not spawn anyone. For each event of size m2 and above, and for each m1 item in a root's focus, it publishes the **routes** by which the incident could arrive in view; P8 chooses and executes. The table is the stage-kit family table of dossier 20 (STG-01): one table, not two.

```ts
interface RealisationRow {
  kind: string; placeType: 'public' | 'semi' | 'private' | 'any'; period: 0 | 1 | 2 | 3 | 'any';
  route: 'scanner-hustle' | 'combat-event' | 'dynamic-event' | 'city-scene' | 'chase' | 'bridge-spawn' | 'none';
  cost: 'free' | 'low' | 'high'; safeRadius: number; viewTest: boolean; perHour: number;
}
```

The default route is `none`: offscreen, with a trace. M3 ships five rows: `gang-clash` public evening and night → `dynamic-event`; `assault` public evening and night → `scanner-hustle`; `psycho-break` public any → `scanner-hustle` (a cyberpsycho hunt); `police-action` public any, size 2 and above → `chase`; `theft` public any → `city-scene`. Each has `safeRadius` 30 m, `viewTest` true, `perHour` 2. Every realised event cites its cause. **A retaliation aimed at V is never realised from this layer:** no row has an aim, and the V-exclusion of §6 refuses any event with V as a victim.

`gameOwnedNow(cell)` is a dynamic read ("the game's community there is active") that only realisation (P8) and `scene.acts` may call. A lint forbids any coarse process from reading it (§12). With no feed it answers `maybe`.

## 6. The production gate

Everything S1 *produces*, as new occurrences, passes one choke point, `produce(occurrence)`, before it is published ([S0 §9.2](kernel.md#92-events), V4-23 and V4-28). Gates sit at choke points, not on each feature.

```ts
interface Occurrence {
  kind: string; origin: 'sim' | 'policy';          // a mirrored or replayed occurrence never reaches the gate
  size: number; window: number; cell?: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  creator: Id;
}
type GateReason = 'excluded' | 'floor-minor' | 'floor-real' | 'sex-tag' | 'v-target' | 'protected' | 'budget-m4' | 'cap-window';
type GateResult = { ok: true } | { ok: false; reason: GateReason };
```

**The order of checks.** The first failure is the result and is logged (§2.3). A refusal is never silent.

1. **Class exclusion.** If any class listed by the occurrence's kind has ceiling 0 or is in `classExclusions` in the settings **in force at production time** (`settingsAt(window)`), the occurrence is refused: `excluded`. The same applies to everything that depends on it: its summary count, its items, its children.
2. **The floors.** Roles `aggressor`, `victim`, `target` and `hostile` bind only persons whose `age-class` is `adult`. A missing or unavailable class counts as `minor`: `floor-minor`. A person marked real is never bound: `floor-real`. No occurrence carries a tag beginning `sex.`: `sex-tag`. (S1 has no kind with such a tag. A pack scene could supply one through an action V accepted, which is S2's, not S1's.)
3. **V-exclusion.** An effect in `{harm, kill, take, expose}` whose `on` is `v`, or a `victim` or `target` role bound to `v`: `v-target`. V may be an `aggressor` or `actor` only in a mirrored occurrence, which the gate does not see.
4. **The protected set.** An effect in `{harm, kill, take, expose}` on a protected person, or a `victim` or `target` role bound to one: `protected`. (An absence never removes a protected person: that is `where`, §4.5.)
5. **Budget gates.** A size-4 occurrence while the city's m4 gate is shut (`city.shape`'s digest, §7.1): `budget-m4`. More than `data.gate.capPerWindow` (8 **[tunable]**) occurrences of size 2 and above in one district and window: `cap-window`.

**Lines are exclusion at production, not thinning.** A class at ceiling 0 gets a **zero rate** for its kinds, and the offspring matrix is renormalised without them, so the world holds none of it. Thinning small events instead would distort the size law. The gate is the backstop. The `cityScale` dial scales the citywide rates and the mean offspring together and is recorded in the settings op.

**What the gate does not touch:**
- records of what the game itself did (raw `game.*` events) and the derived mirror events (§7.3), which re-describe something the game did;
- replayed history, which is never re-filtered;
- veils (ceilings 1 to 3), which act at display and are S2's.

**Sanction ladders.** A ladder is pack data: rungs from the cheapest, each with `(class, shown, reported)` and an effect. A rung is produced only if its class ceiling is not 0. A ladder with no rung of an empty or lowest class is refused at load. The default ladder of the M3 fee norm is `word` (public talk, effect `meet`, no class), `shun` (effect `take`, class `harm.sanction` 1/1), `fine` (effect `take`, class `property` 2/1), `beating` (effect `harm`, class `harm.sanction` 3/2).

## 7. The processes

### 7.0 How each page is organised

Each process is described in the ODD order, so that a reader with no memory of the discussions can reimplement it ([P3 §19.2](../p3-simulation-layer.md#192-the-first-implementation-sized-for-milestone-m3)):

1. **Purpose and patterns**: what it is for, and the patterns it must reproduce. A pattern used to calibrate is never used to validate (§14.3).
2. **Entities, state variables and scales**: its state and its digest, as types.
3. **Process overview and scheduling**: when it runs and what it does in one window.
4. **Design concepts**: the few ideas that shape it.
5. **Initialisation**: the state of a new lineage.
6. **Input**: pack data, digests and reads.
7. **Submodels**: the exact rules.
8. **Agreement and validity**: its `coarseFine` declaration and the **three validity tests**. *Conceptual validity*: are the mechanisms right for the purpose. *Verification*: does the code do what the page says. *Operational validity*: is the output plausible to the people it is for.

**Nodes S1 owns.** The schema pack gives the district slots `grp-A1`, `grp-A2`, `grp-A3` (owned nodes of kind `xf:group`, extending `core:group`, with a `leaders` many slot of kind `xf:leader`, a `standing-v` owned node of kind `xf:standing`), `circle-stalls` (an owned `xf:circle`, which extends `core:group` so that it can be a membership target, with `standing-v`), and `gap-<norm>` (assigned, temporal). A group is `H("val", district, "grp-" + f)` for the affiliation class `f` in `A1 … A3`. The district itself also carries `standing-v`. A leader is `H("gen", group, "leaders", i)`, of kind `xf:leader` (the slots of `core:person` without a household), with archetype fixed to `gang-leader`. A citywide parent group is not built in M3.

**Registered processes.** Application order at a boundary is by tier, then `id` ([S0 §9.4](kernel.md#94-evolution)).

| Id | Tier | n | `coarseFine` | Digest |
|---|---|---|---|---|
| `city.shape` | 0 | 6 | exact | `ShapeDigest` |
| `group.decide` | 0 | 6 | exact | `GroupDigest` |
| `order.stocks` | 0 | 6 | exact | `StocksDigest` |
| `people.shape` | 0 | 6 | distribution | `PeopleDigest` |
| `city.events` | 1 | 6 | count | `EventsDigest` |
| `city.mirror` | 1 | 1 | exact | `MirrorDigest` |
| `order.ledger` | 1 | 6 | distribution | `LedgerDigest` |
| `order.norms` | 1 | 6 | distribution | `NormsDigest` |
| `scene.acts` | 3 | 1 | count | `ActsDigest` |

**One convention for inputs from other processes.** A process reads other processes' digests as of the snapshot at the start of its run. Within a run, the inputs of that digest are applied **in the first window of the run**, and the following windows of the run apply none (retention and the process's own draws still run). This is the one-span lag. The period `n` is a lineage constant, so it is a batching choice inside a run and not a free parameter between runs.

### 7.1 `city.shape`

**1. Purpose and patterns.** It gives the city its time: the hour and weekday shapes and the pulses (pure functions of time), the exogenous regimes, the city budget gate for m4 events, the status of service points and the price level. Patterns: the spacing and budget of m4 (M14-18). It reads nothing about V.

**2. State and scales.** Tier 0, citywide.

```ts
interface ShapeState {
  v: 1;
  regimes: RegimeRec[];                                  // live regimes, in Id order
  m4: { open: number; times: number[] };                 // the first window an m4 occurrence may be produced; the windows of the last two size-4 regimes
  services: Record<Id, { status: 0 | 1 | 2 | 3; since: number }>;     // 0 open, 1 quiet, 2 watched, 3 closed
}
interface RegimeRec {
  id: Id;                                                // the Id of its regime-start event
  kind: string; scope: Id;                               // a district
  start: number; plannedEnd: number; maxDwell: number;   // windows (absolute); durations from the kind
  size: 3 | 4;
  effects: Record<string, number>;                       // rate multipliers by event kind; absent = 1
  closes: string[]; priceShift: number;
}
interface ShapeDigest extends DigestBase {
  regimes: Array<{ id: Id; kind: string; scope: Id; start: number; size: number; effects: Record<string, number>; closes: string[]; priceShift: number }>;
  m4Open: number;
  services: Record<Id, 0 | 1 | 2 | 3>;
  price: Record<Id, 0 | 1 | 2 | 3>;                      // by district
}
```

**3. Overview.** Each window `w` of a run, in this order: (a) regime exits; (b) regime arrivals; (c) the m4 gate; (d) service status; (e) the price level. The shapes are not steps: `city.events` and `scene.acts` call them.

**4. Design concepts.** Exogenous causes only. Every regime declares its exit. The gate is the one place a process reads a pacing policy (S14-S2-04): occurrence is not the director's, but large events are spaced.

**5. Initialisation.** No regimes. `m4.open = 0`. Every service `open`. The shape normalisers `M_k` are computed at load (below).

**6. Input.** `data.shape`, `data.regimes`; the index's services; the `city.events` digest (`m4Times`, `bands`).

**7. Submodels.**

*Shapes.* For a city kind `k` with hour shape `h_k[0..3]`, day shape `d_k[0..6]` and pulses `P_k`:

```ts
const hourOfDay = (t) => Math.floor(secondOfDay(t) / 3600);
const pulse = (k, wd, hr) => P_k.reduce((a, p) => (p.weekday === 'any' || p.weekday === wd) && hr >= p.fromHour && hr < p.toHour ? a * p.factor : a, 1);
const raw = (k, wd, hr) => h_k[periodOfHour(hr)] * d_k[wd] * pulse(k, wd, hr);
const M_k = (sum over wd = 0..6, hr = 0..23 of raw(k, wd, hr), in that order) / 168;      // computed once at load
const shape = (k, t) => raw(k, weekday(t), hourOfDay(t)) / M_k;                          // mean 1 over the week
```

`periodOfHour(hr)` is `periodOf` for the second `hr × 3600`. The shape of every kind has mean 1 over a week, so the city rates of §5.2 are weekly means. Evaluated at the **start** of the window.

*Regimes.* The default kinds are pack data (`data.regimes`):

| Kind | Arrival (per district per day) | Planned length | Max dwell | Rate effects | Closes | Price shift |
|---|---|---|---|---|---|---|
| `crackdown` | 0.03 | 216 windows | 1,008 | `theft` 0.6, `assault` 0.6, `gang-clash` 0.5, `shakedown` 0.4, `police-action` 2.0, `disorder` 1.3 | none | 0 |
| `lockdown` | 0.01 | 144 | 432 | `theft` 0.8, `assault` 0.8, `gang-clash` 0.7, `commerce` 0.4, `police-action` 1.5 | `vendor`, `clinic` | +1 |
| `festival` | 0.02 | 72 | 288 | `disorder` 2.0, `theft` 1.3, `commerce` 2.0, `assault` 1.2, `accident` 1.2 | none | 0 |

*Exit.* A live regime of age `a = w − start` exits at window `w` if `a ≥ maxDwell`, or if `a ≥ plannedEnd` and `procRand(w, "regime-exit", id) < hExit(a)`, with `hExit = 0.05` for `a < 1.5 × plannedEnd` and `0.2` beyond. Before `plannedEnd` there is no exit. On exit S1 mints a `regime-end` event (size = the regime's, place = the district, cause the `regime-start` event).

*Arrival.* For each simulated district `d` (Id order) and each regime kind `r` (registry order) with no live regime of kind `r` in `d`: `N = spacingCount(rate_r × W / 86400, i => procRand(w, "regime", d, r, i), 1)`. If `N = 1`: the size is 4 with probability `0.1` (`procRand(w, "regime-size", d, r) < 0.1`) and 3 otherwise; the regime starts at `startOf(w) + floor(procRand(w, "regime-t", d, r) × W)`. S1 mints a `regime-start` event named `regime/<w>/<d>/<r>` (creator `proc(city.shape)`, place `d`, no participants, no effects). A size-4 regime is subject to the gate's m4 budget: if `m4Open > w` (the digest's value at this run's start, or as raised earlier in this run) it is demoted to size 3 (logged `budget-m4`) and does not use the budget. The regime's `Id` is the event's.

*The m4 gate.* The state holds `m4.times`, the windows of the last two size-4 regimes it started. Each window it merges them with the `city.events` digest's `m4Times` (the last two size-4 incidents), takes the last two of the merged list, oldest first, `[secondLast, last]`, and sets `open = max(last + m4Spacing, secondLast + WEEK)` (0 if there are none, `secondLast + WEEK` omitted if there is one), with `m4Spacing = 432` windows **[tunable `data.shape.m4Spacing`]**. At most 2 m4 occurrences per week and at least 3 days apart is about 0.3 a day at most (M14-18). A size-4 regime that starts at `w` appends `w` to `m4.times`, and `open` is recomputed for the next window. Both `city.events` and the gate of §6 read `m4Open` from the digest.

*Service status.* For each service in a simulated district's cells, with the cell's band `b` (from the `city.events` digest, as of the snapshot): `closed` (3) if a live regime of the cell's district has the service type in `closes`, or `b = flashpoint`; `watched` (2) if `b = hot`; `quiet` (1) if `b = elevated`; else `open` (0). On change S1 writes a pin `status@w<w>` on the service node. A service of type `home`, `safehouse` or `apartment` is never changed.

*Price level.* `price(d) = clamp(index.priceAnchor + Σ priceShift of the live regimes of d, 0, 3)`: low, fair, high, extreme. It is in the digest.

**8. Agreement and validity.** `coarseFine`: **exact** (a pure function of time, keyed arrivals and the digest).
- *Conceptual:* time-of-day and weekday shapes are the lenses on who offends and who guards, and are mean-one by construction; regimes are slow, exogenous and always end; the m4 gate is the single admitted pacing input.
- *Verification:* SF1-S-1 to SF1-S-6: mean-one shapes, arrival counts within three standard deviations of the configured rates over 20 seeds, exit by `plannedEnd` and `maxDwell`, the m4 gate, and identical histories as one tick and as twelve.
- *Operational:* M14-18 (spacing and weekly budget of m4, the log-linear slope), and the panel question of whether a crackdown or a festival is felt as one.

### 7.2 `city.events`

**1. Purpose and patterns.** It is the city's life: incidents, their causes and consequences. It decides, for every window, district and kind, how many incidents happen, how big, where, to whom; it keeps the aftershocks that follow and the heat that builds, and it publishes bands. Patterns it must reproduce (calibrated on seeds 0 to 9, validated on seeds 10 to 29): concentration (M14-01), the three bindings (M14-02), near-repeat excess (M14-03), offender location (M14-04), hot-list turnover (M14-05), band flicker (M14-06), cluster statistics (M14-07), the delay law (M14-08), the largest follow-up (M14-09), thinning stability (M14-10), summary and item agreement (M14-16), the tail (M14-18), demand independence (M14-20), witnessable rate and cost (M14-23), explanation chains (M14-24).

**2. State and scales.** Tiers 1 and 2: districts and cells.

```ts
interface EventsState {
  v: 1;
  live: Record<Id, Id[]>;                                   // by district: live hot cells not in the persistent list, in Id order
  heat: Record<Id, number>;                                 // by cell: heat at the end of the last window (a cache; recomputable from ring and calendar)
  bands: Record<Id, { band: 0 | 1 | 2 | 3; since: number }>;     // by cell; absent = quiet since 0
  calendar: Record<Id, PendingChild[]>;                     // by district, sorted by (due, parent, index); at most 256 each
  ring: RingEntry[];                                        // the last WEEK windows, oldest first
  m4Times: number[];                                        // windows of the last two size-4 events
  counters: { immigrants: number; children: number; thinned: number; refused: number };
}
interface PendingChild {
  parent: Id; index: number; due: number;
  kind: string; size: number;
  scope: Id;                                                // a hot cell or the district
  cell?: Id;                                                // known for a cell scope, or for size ≥ 2
  plan: { a?: number; b?: number };                         // affiliation-class indices of the aggressor and victim sides
  modBirth: number;                                         // the regime modifier at birth
}
interface RingEntry {
  id: Id; kind: string; size: number; w: number; time: GameTime;
  scope: Id; cell?: Id;
  count?: number;                                           // a summary: its count
  parents?: Record<number, Id>;                             // a summary: item index → parent, for items that have one
  parent?: Id; children: Id[];                              // an event: parent link, scheduled children
  groups?: { a?: number; b?: number };                      // affiliation-class indices of the sides
  public?: boolean; witnesses?: number;
}
interface EventsDigest extends DigestBase {
  events: Array<{ id: Id; kind: string; size: number; w: number; place?: Id; cell?: Id; groups?: { a?: number; b?: number }; public: boolean; witnesses: number; parent?: Id }>;   // size ≥ 2, minted in the span
  counts: Record<string, number>;                           // "scope|kind|size" → count over the span, m1 included
  bands: Record<Id, { band: number; since: number }>;       // every cell with band > 0
  live: Record<Id, Id[]>;
  m4Times: number[];
  calendarSize: Record<Id, number>;
  thinned: Array<{ child: Id; reason: string; w: number }>;
}
```

The persistent hot list is not state. It is a function of the world seed and the index (below). The ring is capped at `data.events.ringMax` (20,000 entries **[tunable]**); the overflow drops the oldest windows and logs `ring-overflow`. The ring serves heat, cause chains of at most four links, and re-minting a summary or event descriptor (S0 §9.3, G-6).

**3. Overview and scheduling.** Per window `w`: (1) the settings and the digests of the snapshot are read; (2) immigrants are drawn for each simulated district and kind; (3) the calendar's due children are fired; (4) the day's incidents become summary items and events; (5) each incident draws its offspring; (6) heat and bands are updated; (7) the ring is trimmed. Immigrants come before due children so that summary item indices are "immigrants in draw order, then due children by (parent `Id`, index)".

**4. Design concepts.** *Counts first.* An m1 incident exists as a count in a summary, and as an item only when opened. *Fields set where, one rate sets how often.* *Identity keys:* everything a child is, is a function of its parent's `Id` and its index. *Hot state is read off generative state:* the future of a cell's excitement is the pending calendar. *Demand independence:* nothing here reads V's position or any demand (S1-I-5). *Static coverage:* the game's own content lowers a cell's rate by a static figure, never by whether the game's community is active now.

**5. Initialisation.** Empty calendar and ring. For each simulated district: the persistent hot list and the shares (below) are computed from the index and the world seed, and cached outside the state (they regenerate).

**6. Input.** The index; `data.shape`, `data.events`, `data.kinds`; `settingsAt(w)`; digests: `city.shape` (regimes, `m4Open`), `city.mirror` (`covered`), `order.stocks` (`E`, `Y`, `fear`), `order.norms` (`noSnitch`), `group.decide` (`boost`, `pairBoost`), `people.shape` (recipe versions; for the resident draws).

**7. Submodels.**

*Propensity.* A cell's stable propensity for kind `k` is `ε(c, k) = F(c, k) × L(c)`, with `L(c) = LQ[floor(rand("prop", c) × 4096)]` (a log-normal quantile of spread `σ = 1.6`, mean 1). It is a function of the world seed, the cell's `Id` and the index only, so it is the same after any reload. With `data.events.flatPropensity = true`, `L(c) = 1` (used by unit fixtures). The **persistent hot list** of a district is its `hotCount = min(64, max(1, ceil(0.25 × nCells)))` cells with the largest `L(c)`, ties by `Id` (`data.events.hotFraction` 0.25 **[tunable]**).

*Opportunity.* For cell `c`, kind `k` and period `p`:

```ts
a(c, k, p)  = A[c][k][p] × (1 − gameCoverage[c][k]) × ε(c, k)
aD(d, k, p) = Σ_{c ∈ d, in cellIds order} a(c, k, p)
cityTotal(k, p) = Σ_{simulated d, in Id order} aD(d, k, p) + Σ_{stub d} staticTotalA[d][k][p] + rest.totalA[k][p]
share(d, k, p)  = aD(d, k, p) / cityTotal(k, p)
```

`staticTotalA` has expected `ε` of 1 (the mean of `LQ`). `gameCoverage` is **static**: it is the share of the kind the game already covers in that cell (dynamic events, combat communities, hustle pins, guard areas: dimensions 16, 21, 27). A coarse process MUST NOT read whether the game's community there is active now (§5.5, §12).

*The mean for a window.* For district `d`, kind `k`, size `m`, window `w` (period `p`, time `t = startOf(w)`):

```ts
μ(d, k, m, w) = rate[k][m] × cityScale × shape(k, t) × share(d, k, p) × regimeMod(d, k, w) × groupMod(d, k) × (W / 86400)
regimeMod(d, k, w) = Π over live regimes r of d (id order) of max(0.1, r.effects[k] ?? 1)          // from the city.shape digest
groupMod(d, k) = max(0.5, 1 + Σ_f offenderShare(d, k, f) × boost[d][f][k])     // `group.decide` digest, default 0; 0 for k = gang-clash
offenderShare(d, k, f) = (Σ_c presence_f(c) × rw_k[class(f)]) / (Σ_c (base_k + Σ_f' presence_f'(c) × rw_k[class(f')]))     // static, over the district's cells in order; class(other) = gang
```

A kind not allowed by the gate's class rule (§6) has `μ = 0`.

*Counts, sizes and scopes.* Per window, district and allowed kind: `Λ = Σ_m μ(d, k, m, w)`; `N = splitCount(Λ, part => i => procRand(w, "cnt", d, k, part, i))`. For incident `i = 0 … N − 1`: size by `invCum([μ(d, k, 1, w), …, μ(d, k, 4, w)], procRand(w, "size", d, k, i))`; scope by `invCum` over the scope shares with `procRand(w, "scope", d, k, i)`. The **scope list** for `(d, k, p)` is the persistent hot cells (Id order), then the live hot cells not already listed (Id order), then the district's remainder. Weights: `a(c, k, p)` for a cell, and `aD(d, k, p) − Σ listed cells` for the remainder. A size-4 incident that the m4 gate refuses (`m4Open > w`, `procRand` already consumed) is dropped and logged `budget-m4`; its draws are not reused.

*Where, when and who for an event (size ≥ 2).* A hot-cell scope gives the cell. A remainder scope draws a cell among the district's non-hot cells by `invCum` over `a(c, k, p)` with `procRand(w, "cell", d, k, i)`. The time is `startOf(w) + floor(procRand(w, "t", d, k, i) × W)`. The people are cast by §5.4, with the aggressor affiliation class from `invCum(offenderWeights(c, k), procRand(w, "who-f", d, k, i))` (for a gang pair: `pairs(c)`, key `procRand(w, "pair", d, k, i)`). Names: the event is `H("mint", proc, proc, "ev/" + w + "/" + d + "/" + k + "/" + i)`.

*Summaries.* For each `(scope, kind)` with at least one m1 item in the window, one `core:summary` named `sum/<w>/<scope>/<kind>`: `from = startOf(w)`, `length = W`, `scope`, `count`. Item indices run in the order the items were born. Item `Id`s and times follow S0 §9.3; item places are drawn by the kernel (K-1, §16). An empty summary is not minted.

*Offspring.* Every incident that is born (an immigrant, or a fired child), including every m1 item, draws its offspring at once. Its `Id` is `me` (the event's, or the item's `H("mint", S, S, "item:" + j)`).

```ts
n      = nOf(size) × offspringFactor[kind] × cityScale × regimeMod(d, kind, w)
count  = nbCount(n, 0.3, rand("child", me, 0, "n"))
for c in 0 .. count − 1:
  bin    = invCum(delayBins[kind], rand("child", me, c, "bin"))
  due    = w + lo[bin] + floor(rand("child", me, c, "win") × (hi[bin] − lo[bin] + 1))          // at least w + 1
  kind'  = invCum(matrixRow(kind, allowed kinds only), rand("child", me, c, "kind"))          // no row left: no child
  if kind' = 'police-action' and rand("report", me, c) ≥ reportChance(d, witnessBonus): no child        // the report draw (§7.6)
  size'  = size = 1 ? 1 : clamp(size + [−1, −2, 0][invCum([0.60, 0.25, 0.12], rand("child", me, c, "size"))], sizes(kind')[0], sizes(kind')[1])
  where  = placeChild(...)                                    // below
  insert PendingChild{ parent: me, index: c, due, kind', size', scope, cell, plan, modBirth: regimeMod(d, kind', w) } in the calendar
```

`witnessBonus = min(10, witnesses)`; witnesses of an incident are `spacingCount(meanPop(c or d, p) × data.events.witFraction, i => rand("wit", me, i))`, with `witFraction` 0.05 **[tunable]**. `placeChild`: if the parent has a cell, the candidate cells are the parent cell, `adj1` and `adj2` (in that order, by Id inside each), with weights 1, 0.4 and 0.15 (`data.events.kernel`); for a `gang-clash` child of a gang pair, the weights are instead `pairs(c)` weights for the pair over all the district's cells. The cell is `invCum` with `rand("child", me, c, "cell")`. The child's scope is that cell if it is in the persistent or live hot list, else the district. If the parent's scope is the district remainder and the parent has no cell, the child has none and its scope is the district. A child of size ≥ 2 with no cell draws one among the non-hot cells by `a(c, k', p)` with `rand("child", me, c, "cell2")`. The plan: a retaliation (`kind' = kind = gang-clash`) swaps `a` and `b`; a `police-action` has none; anything else inherits.

*The calendar.* Per district, sorted by `(due, parent, index)` (Ids as hex strings). At window `w`, the children with `due = w` are removed and processed in that order, **after** the window's immigrants, with:

1. **Game cover.** If the `city.mirror` digest holds a `covered` entry of the same kind at the child's cell or its `adj1` cells within the last `data.events.coverLull` (144) windows, the child is thinned: reason `game-covers`, logged as a correction. Children with no cell are not affected.
2. **Excluded now.** If the kind is no longer allowed: dropped, `excluded`.
3. **Thinning.** `ratio = min(1, regimeMod(d, kind, w) / modBirth)`. If `ratio < 1` and `rand("thin", parent, index) ≥ ratio`, the child is thinned: reason `regime`.
4. A surviving child is born (an event if its parent has size ≥ 2, else an item). It takes its time `startOf(w) + floor(rand("child", parent, index, "t") × W)`, its Id `H("mint", proc, parent, "child/" + index)`, its causes `[parent]`, and its participants cast as for an event. It then draws its own offspring.

The cap of 256 per district is enforced at insert: when the calendar would exceed it, the pending child with the lowest size, then the largest `Id`, is dropped and `calendar-overflow` is logged.

*Heat and bands.* After the window's births, for every cell `c` that has a ring entry or a pending child within graph distance 2:

```ts
heat(c) = Σ over ring entries e with a cell c' within graph distance dist ≤ 2 of c and w − e.w < 1008:
              Ws[e.size] × Wd[dist] × Wa(w − e.w) × (e.count ?? 1)
        + Σ over pending children ch with a cell c' within dist ≤ 2 of c and 0 < ch.due − w ≤ 1008:
              0.5 × Ws[ch.size] × Wd[dist]
Ws = [1, 3, 9, 27];  Wd = [1.0, 0.4, 0.15];  Wa(age) = 1.0 (age ≤ 6), 0.7 (≤ 36), 0.4 (≤ 144), 0.15 (≤ 1008)
```

Terms are summed in `(entry w, Id)` order, then pending in `(due, parent, index)` order. A cell is **live hot** at the end of window `w` if `heat ≥ 1.0` (`liveEnter`), or if it was live and `heat ≥ 0.6` (`liveLeave`); the list excludes the persistent cells, is cut to 64 − |persistent| by `(heat descending, Id)`, and applies from window `w + 1`. Four **bands** (quiet 0, elevated 1, hot 2, flashpoint 3) have enter and leave thresholds `enter = [–, 2.0, 5.0, 12.0]`, `leave = [–, 1.2, 3.2, 8.0]` **[tunable]**:

```ts
function nextBand(cur: number, heat: number, sinceWindow: number, w: number): number {
  if (w − sinceWindow < 144) return cur;                                    // a one-game-day minimum dwell
  for (let j = 3; j > cur; j--) if (heat ≥ enter[j]) return j;              // rise to the highest band whose enter threshold is met
  let j = cur; while (j > 0 && heat < leave[j]) j--;                        // fall while the leave threshold is not met
  return j;
}
```

A band pin `band@w<w>` is written **only on change**, with the previous band's validity ended by the window. The heat numbers never leave the process. The band is the S2 predicate.

*Reports.* `reportChance(d, witnessBonus) = r0 × (1 − Y) × (0.5 + 0.5·E) × (1 − fear) × (1 − noSnitch) × (1 + 0.1 × witnessBonus)`, with `E`, `Y`, `fear` from the `order.stocks` digest, `noSnitch` the `beh` of the norm `uniforms` from the `order.norms` digest, and `r0` = `data.stocks.r0` (0.7 **[tunable]**). It is clamped to [0, 1]. A report is a separate draw from the occurrence. The record feeds no dial in M3: police pressure is phase 2.

*Gate and events.* Each event and each item passes `produce` (§6) before it is returned. A refusal removes it and its dependent offspring, logged with the reason.

**8. Agreement and validity.** `coarseFine`: **count**. A summary's count equals the number of its items at every scope; the items of a summary nest across scopes with the same `Id`s; canon items are kept (M14-16, S0 F-7).
- *Conceptual:* opportunity is targets times offenders times (1 − guardians) times a stable propensity; incidents cluster in time by offspring; a heat band is the state of a cell's pending future; the game's content covers part of the city by a static figure. The model does not claim to reproduce real crime. It claims the shapes (concentration, near-repeat, size law) transfer, and the constants are tuned by feel and by the panel.
- *Verification:* the unit fixtures SF1-I-1 to SF1-I-16 (counts, scopes, sizes, offspring, calendar order and cap, thinning, bands and dwell, ring, summary and item agreement, keys); S0 F-13 (partition), F-21, F-22 (mid-cascade reload) and F-7 on this process; SF1-E1 and SF1-E2.
- *Operational:* the pattern battery above on 20 seeds; M14-17 as a panel on a week in Kabuki (felt causality, "not nothing"). The cost target: a window with nothing due in 0.2 ms native, 5 ms in the reference (§10.4).

### 7.3 `city.mirror`

**1. Purpose and patterns.** It maps the game's raw events to the city's vocabulary, so that the record of what the game did is in the language the sifter reads, and it sets nothing it cannot read from the game. It runs every window so that a game event enters the record within ten minutes. Pattern: M14-22 (identical under any tick partition and reload).

**2. State and scales.** Tier 1.

```ts
interface MirrorState {
  v: 1;
  seen: Id[];                                              // raw event Ids processed, newest last, at most 1024
  counters: Record<Id, { gig: number; hustle: number; failed: number }>;    // by district: the gig and hustle outcomes mirrored
  lastHeat: number;                                        // the last heat stage mirrored (0 to 5)
}
interface MirrorDigest extends DigestBase {
  covered: Array<{ event: Id; kind: string; cell?: Id; district: Id; w: number; groups?: { a?: number; b?: number } }>;    // derived events of the last coverLull windows; `groups` are affiliation-class indices (the sides of a clash, or the victim and actor of a death)
  counters: MirrorState['counters'];
}
```

**3. Overview.** Per window `w`: query the raw events not yet seen; derive city events; mint them; record what they cover.

**4. Design concepts.** Raw events are records of what the game did. They are kept as they are, never filtered or edited (S0 §9.2). A derived event re-describes one; it is not a new occurrence, so the production gate does not refuse it (§6). What V is shown of it is filtered at display (S2 §2.19). The mirror reads the game's feed through the replay port in M3 (§3.4); the same code runs against a live game.

**5. Initialisation.** `seen` empty, `lastHeat = 0`, counters zero.

**6. Input.** The kernel's raw events (kinds in §3.4), the mirrored slots of the persons they cite, the index's affiliation classes and cells, `data.mirror`.

**7. Submodels.**

*Finding the raw events.* At the run for window `w` the snapshot is the state at `startOf(w)`. External operations stamped in window `w − 1` have just been applied (S0 §9.4, step 2). The mirror queries

```ts
ctx.query({ find: 'core:event', scope: { under: cityId }, at: startOf(w),
  must: [ { path: 'kind', op: 'in', arg: RAW_KINDS }, { path: 'time', op: 'range', arg: [startOf(w − 6), startOf(w) − 1] } ], limit: 'all' })
```

and keeps those whose `Id` is not in `seen`, ordered by `(time, Id)`. A raw event older than window `w − 1` is a late operation (a defect `late-raw`) and is processed all the same. `seen` is trimmed to the last 1,024.

*The derivation table.* `class(x)` is the class of an affiliation (gang, corporation, ncpd, civilian) from the index. `witnesses` is the raw event's witness count. At most `data.mirror.cap` (12 **[tunable]**) derived events are minted per window; the rest are left as raw events and logged `cap-hit`.

| Raw kind | Derived event | Size | Participants and effects |
|---|---|---|---|
| `game.death` | `gang-clash` if the victim's class is gang and the actor's class is gang and different; else `assault` | 2 if the victim's affiliation belongs to a simulated group, or `witnesses ≥ 3`; else 1 | The victim as `victim`; the actor as `aggressor` (V included if the game says so). Effect `kill` on the victim. Witnesses copied |
| `game.heat.N`, with `N > lastHeat` and `N ≥ 1` | `police-action` | 2 if `N ≥ 3`, else 1 | None. Place: V's district (`v.district`) at the raw time |
| `game.heat.N` with `N ≤ lastHeat` | none (the stage fell) | | `lastHeat = N` is recorded either way |
| `game.combat.start` | `gang-clash` if any hostile's class is gang; `police-action` if any is ncpd; else `assault` | 2 if there are 3 or more hostiles, else 1 | The hostiles as `hostile`. No effects: the deaths come as their own events |
| `game.combat.end` | none | | |
| `game.district` | none: demand and context only | | |
| `game.journal.finished` or `.failed` | `gig-outcome` | 1 | The entry as `entry`. `outcome` `done` or `failed`. The district's counter for the entry's family (`gig`, `hustle`, else `failed` counted separately) rises by one |

The derived event has: **creator** `proc(city.mirror)`; **cause** `[the raw event]` (in `causes`); **time** the raw event's time; **place** the raw event's cell if it has one, else its district; `outcome` `done` (`failed` for a failed journal entry); and the name `mir` under cause = the raw event's `Id` (so the `Id` is `H("mint", proc(city.mirror), raw, "mir")`). **A mirrored event is told from a simulated one by its creator** (S3's `EventView.creator`): the sifter reads both levels and can tell them apart.

*Coverage.* For each derived event with a cell and a kind in `{gang-clash, assault, theft, police-action}`, a `covered` entry is added to the digest, with the affiliation-class indices of its sides in `groups`. `city.events` thins the pending children of the same kind in that cell (§7.2). Entries older than `coverLull` windows are removed.

*The V reading.* The mirror writes nothing about V. V's cell, district and wanted level are mirrored slots; `v.frames` reads them (§8.2).

**8. Agreement and validity.** `coarseFine`: **exact**.
- *Conceptual:* the game owns these facts; the mirror is a translation table, with nothing invented and nothing dropped except past the cap.
- *Verification:* SF1-M-1 to SF1-M-8 (each row of the table; the creator, cause and time; a mirrored death; an older save; the cap; late operations); S1-F-5 and S1-F-6 of P3 as SF1-M-3 and SF1-M-4: one derived event per raw death, identical after a reload and under 12 ticks or one; SF1-E3.
- *Operational:* the replay of a hand-authored story state, read by someone who knows the game: does the record say what happened? Live: the first in-game session compares the replay port with the feed (open question 6 of P3).

### 7.4 `people.shape`

**1. Purpose and patterns.** It fits each district's joint tables from the marginals the index supplies and publishes them as `Table` contributions with provenance. Patterns: marginals of resident draws within sampling error (M15-01), households, the age hump and independents (M15-02), lifecycle by jump and tick (M15-03).

**2. State and scales.** Tier 0, per district.

```ts
interface PeopleState {
  v: 1;
  districts: Record<Id, { fitted: Marginals; fittedAt: number; version: number; person: Id; household: Id; meanHH: number }>;   // `person`, `household`: the contribution Ids in force
}
interface Marginals { age: number[]; role: number[]; income: number[]; aff: number[]; hhType: number[]; hhTenure: number[]; hhWealth: number[] }
interface PeopleDigest extends DigestBase { versions: Record<Id, number>; meanHH: Record<Id, number> }
```

**3. Overview.** Each window, for each simulated district: compare the index marginals with `fitted`. If the largest absolute difference is at least `data.people.refitThreshold` (0.02 **[tunable]**) and `w − fittedAt ≥ 144`, refit.

**4. Design concepts.** A fixed number of iterations. A floor on every cell. Plain arithmetic in a fixed order. A refit changes weights only. **It never changes the structure:** the number of households of a block (`households#count`) and `meanHouseholdSize` are fixed by the first fit for the lineage (a pack update that changes them is a continuation under S2's policy, and re-draws the district's residents). Residents already observed stay pinned.

**5. Initialisation.** The version-0 fit is computed in `init` and installed as pack contributions at load, so that the first window has residents. The contributions are reloaded, not persisted. `fittedAt = 0`, `version = 0`.

**6. Input.** The index's `marginals`; `data.people` (seed factor tables, floor, rosters, household size tables).

**7. Submodels.**

*The fit.* Iterative proportional fitting over the person table (dimensions 8, 12, 4, 6; `x = ((a·12 + r)·4 + i)·6 + f`) and, separately, the household table (dimensions 5, 3, 4: type, tenure, wealth; `x = (ty·3 + te)·4 + we`):

```ts
function ipf(seed: number[], dims: number[], targets: number[][], iters = 20): number[] {
  const t = seed.slice(), n = t.length;
  for (let it = 0; it < iters; it++)
    for (let d = 0; d < dims.length; d++) {
      const cur = new Array(dims[d]).fill(0);
      for (let x = 0; x < n; x++) { const c = coord(x, d); cur[c] = cur[c] + t[x]; }
      for (let x = 0; x < n; x++) { const c = coord(x, d); if (cur[c] > 0) t[x] = t[x] * (targets[d][c] / cur[c]); }
    }
  let sum = 0;
  for (let x = 0; x < n; x++) { if (t[x] < FLOOR) t[x] = FLOOR; sum = sum + t[x]; }
  for (let x = 0; x < n; x++) t[x] = t[x] / sum;
  return t;
}
```

`coord(x, d)` is `floor(x / stride_d) mod dims[d]`, with strides `(12·4·6, 4·6, 6, 1)` for the person table and `(12, 4, 1)` for the household table. Each target marginal is first divided by its sum, so it sums to 1. `FLOOR = data.people.cellFloor` (2⁻³⁰). The **seed** of the person table is the product of the three factor tables of §4.2, with each factor of "0" replaced by `FLOOR`. The seed of the household table is 1 for every cell except `crew`, which is 1 when the district's gang-class share is above 0.05 and 0.1 otherwise. The refit costs about `2,304 × 4 × 20 ≈ 184,000` operations per district, which the process budget counts. A person or household table that would exceed `N_enum` is refused at load.

*The contribution.* The weights are `w[x] = t[x] / max(t)`. The person table becomes one `Table` contribution per slot `p0 … p5` of `xf:household` under the district (`target: { kind: 'xf:household', slot: 'p<j>', scope: { under: district } }`, mode `weight`, layer `simulation`, strength 1), and the household table one `Table` on `hprofile`. `source.origin` is `proc(people.shape)`, with the version, the fit window and the hash of the marginals in the contribution's cause (the provenance). On a refit the process returns `end-contribution` for the old Ids and `contribute` for the new, valid from `startOf(w + 1)`. The state stores the Ids the kernel will assign (a pure function of the spec, `contributionId(spec)`).

*Household size.* `meanHH = Σ_type hhType[type] × (base(type) + Σ_x x·extraWeights[type][x] / Σ_x extraWeights[type][x])`, summed in type order. It is fixed at version 0.

*What it does not do.* It does not draw residents. They are drawn by the kernel (§4.2) from these contributions.

**8. Agreement and validity.** `coarseFine`: **distribution**. The marginals of the draws of a district's residents match the fitted marginals within three standard deviations of sampling error, plus a roster allowance of 0.06 absolute **[calibrate]**, because roster rules shape households after the fit.
- *Conceptual:* a joint table over four attributes is a small, auditable recipe; the roster rules make households coherent; the fit is only as good as the index's marginals, which are judgement where the game gives none.
- *Verification:* SF1-P-1 to SF1-P-6: a 2 × 2 fit by hand; convergence on a district fit (marginals within 1e-9 after 20 iterations); the floor; one refit per game day; residents identical across a reload; no household with a child older than a parent.
- *Operational:* M15-01 to M15-03, M15-27 (the representation audit over sampled populations, reported to dossier 18), and the panel question of whether a block's people look like a block.

### 7.5 `order.norms`

**1. Purpose and patterns.** It keeps, per district and norm, what people privately support, what they do, and what they believe others do; it mints the enforcement that follows from non-compliance; and it separates public from private acts. M3 has one norm pair. Patterns: the norm gap, and public against private (M15-11); cascade conditions (M15-12, a later check); sanction ladders (M15-13); report chance inputs (M15-14).

**2. State and scales.** Tier 1, per district and norm.

```ts
interface NormsState {
  v: 1;
  slots: Record<string, NormSlots>;                       // key: district Id + "|" + norm id
}
interface NormSlots {
  priv: number; beh: number; perc: number;               // 0 to 1
  signal?: { value: number | 'priv'; w: number };       // the last public event's implication and its window
  pub: number[];                                          // windows of public enforcement of this norm in the last 144, oldest first
  gap: 0 | 1 | 2; gapSince: number;                      // aligned, gap, wide
}
interface NormsDigest extends DigestBase {
  norms: Record<Id, Record<string, { priv: number; beh: number; perc: number; vis: number; gap: number }>>;
  events: Array<{ id: Id; norm: string; rung: string; public: boolean; w: number; enforcer: number }>;      // enforcement minted in the span
}
```

**3. Overview.** Per window and norm: (a) in the first window of a run, read the public events of the previous span; (b) enforce; (c) relax; (d) move `perc`; (e) band the gap.

**4. Design concepts.** *A norm is data.* It has a behaviour, a sector, enforcers, two threshold histograms (empirical: "I comply if enough others do"; normative: "if enough expect it"), a cost and a ladder. *`perc` is a perspective on the district, not world truth.* *Only a public act moves it.* A public act is one in a public place, with enough witnesses who saw each other. A private act moves only its witnesses' beliefs (S0 F-25).

**5. Initialisation.** `priv`, `beh`, `perc` from the norm record. No signal. `pub` empty. `gap = aligned`.

**6. Input.** `data.norms`; the index (presence, `pop`, `public`); digests: `city.events` (public events), the process's own events, `order.stocks` (none). Public events of other kinds named in `signals` are read from the kernel by `ctx.query` (kind, creator not self, time in the previous span).

**7. Submodels.** A norm record:

```ts
interface NormDef {
  id: string; label: string;
  sector: string[];                                       // profile roles it applies to; [] = every resident
  enforcer: { aff: 'A1' | 'A2' | 'A3'; roles: string[] };
  share: number[]; taue: number[]; taun: number[];        // 8 resident types: their share and two thresholds
  priv0: number; beh0: number; perc0: number;
  visBase: number; nu: number;                            // enforcement visibility when none is recent; its weight in q_n
  phiBase: number; phiPublic: number; eta: number; signalMemory: number;   // 0.1, 0.6, 0.058, 144
  enforcePerDay: number;
  ladder: Rung[];                                         // with weights
  signals: Array<{ kind: string; minRung?: string; value: number | 'priv' }>;
  privEffects: Array<{ kind: string; public: boolean; delta: number }>;
  gapBands: { gap: [number, number]; wide: [number, number] };     // [enter, leave]: [0.10, 0.08] and [0.30, 0.25]
}
```

M3 ships two norms. `share` is 1/8 each and `taue = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75]`, `taun = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]` for both.

| Norm | Sector | Enforcer | `priv0`, `beh0`, `perc0` | `visBase` | `enforcePerDay` | Ladder weights (default ladder of §6) | `signals` |
|---|---|---|---|---|---|---|---|
| `fee` ("pay the Friday fee") | `vendor`, `shopkeeper` | `A1`, roles `gang` | 0.35, 0.875, 0.85 | 0.5 | 3 | `word` 0.6, `shun` 0.25, `fine` 0.1, `beating` 0.05 | `enforcement` of this norm → 0.95 |
| `uniforms` ("do not talk to the uniforms") | every resident | `A1`, roles `gang` | 0.5, 0.75, 0.8 | 0.3 | 1 | `word` 0.7, `shun` 0.25, `beating` 0.05 | `enforcement` of this norm → 0.95 |

*The public tag.* An event is **public** if its place's `public` slot is `public` and its witness count is at least `data.norms.publicMinWitnesses` (5). An enforcement event's witness count is `spacingCount(pop(cell)[p] × witFraction, i => procRand(w, "wit", id, i))`. An external event's witnesses are the length of its `witnesses` slot. A private act produces no input to the norm.

*Enforcement.* The mean for a window is `μ = enforcePerDay × (W / 86400) × (1 − beh) × min(1, enforcerShare / 0.05)`, with `enforcerShare` the entry share of the enforcer's affiliation in the district. `N = spacingCount(μ, i => procRand(w, "enf", d, norm, i), 4)`. Each use `i`: the rung by `invCum` over the weights of the rungs the gate allows (§6) with `procRand(w, "rung", d, norm, i)`; the cell among the district's public cells by `invCum` over `pop[p]` with `procRand(w, "ecell", d, norm, i)`; the enforcer cast by §5.4 from the enforcer affiliation and roles, the target cast from the norm's sector among `civilian` adults, drawn from the non-compliers by the same rejection. The event is `enforcement`, named `enf/<w>/<d>/<norm>/<i>`, effects by the rung. It passes the gate. If it is public, it sets `signal` for the next window and appends `w` to `pub`.

*The relaxation.* In each window, with `vis = min(1, visBase + |pub in the last 144 windows| / 4)`:

```ts
let b = beh, qe = beh;
for (let it = 0; it < 4; it++) {
  const phi = signal === undefined ? 0 : (signal.w === w ? phiPublic : (w - signal.w <= signalMemory ? phiBase : 0));
  const sig = signal === undefined ? 0 : (signal.value === 'priv' ? priv : signal.value);
  qe = (1 - phi) * b + phi * sig;
  const qn = clip01(perc * (1 - nu) + vis * nu);
  b = 0;
  for (let j = 0; j < 8; j++) b = b + share[j] * ((qe >= taue[j] && qn >= taun[j]) ? 1 : 0);
}
beh = b;
perc = perc + eta * (qe - perc);
priv = clip01(priv + Σ privEffects matched in the window, in event order);
```

The four steps of P3 are one pass; the relaxation iterates the first three of them four times so that `beh` settles for the current `perc` and signal, and `perc` then moves once. With no signal, `phi = 0` and a private act changes nothing. `eta` is per window: `0.058` gives about 0.3 per game hour (`1 − 0.942⁶`).

*The gap band.* `gap = |priv − perc|`. The band rises to `wide` (2) at `gap ≥ 0.30` and to `gap` (1) at `gap ≥ 0.10`; it falls from 2 when `gap < 0.25` (to 1, or to 0 if also `< 0.08`) and from 1 when `gap < 0.08`. A pin `gap-<norm>@w<w>` is written on the district **only on change**. This band is the S2 window predicate.

*Left for later:* tipping on embeddedness and enforcer clustering, metanorm enforcement, block-level `local(beh)`, the enforcers drawing partly from compliers with low `priv` (§0.3).

**8. Agreement and validity.** `coarseFine`: **distribution** (the district slots against the behaviour of resident types opened at a scene, within 10 %).
- *Conceptual:* a norm is held up by what people think others do; a public act shows it; enforcement makes non-compliance visible. The thresholds are judgement.
- *Verification:* SF1-N-1 to SF1-N-4: the worked update with and without a public signal; the gap band's hysteresis; enforcement counts; S0 F-25 (public against private, 12 windows as one tick and as 12).
- *Operational:* M15-11 to M15-14 and the panel question of whether a norm feels enforced (P15-01).

### 7.6 `order.stocks`

**1. Purpose and patterns.** It keeps, per district, how much people trust that something will be done (efficacy), how little they trust the police (cynicism), and the police's standing (legitimacy), and from them the chance that an incident is reported. Patterns: each input moves the report chance as configured, and there is no lock-in with police presence (M15-14, M14-12).

**2. State and scales.** Tiers 0 and 1, per district.

```ts
interface StocksState { v: 1; districts: Record<Id, { E: number; Y: number; L: number }> }
interface StocksDigest extends DigestBase { districts: Record<Id, { E: number; Y: number; L: number; fear: number }> }
```

**3. Overview.** Per window: retain; and in the first window of a run, add the gains and losses of the previous span's events.

**4. Design concepts.** Stocks are updated by retention and events, with no clock decay of their own. They are arithmetic only, so the process is exact.

**5. Initialisation.** `E, Y, L = index.trust` (default 0.5 each).

**6. Input.** `data.stocks`; the `city.events` digest (`events`, `calendarSize`), the `order.norms` digest (`events`); the index (presence).

**7. Submodels.**

```ts
E = clip01(rhoE * E + (1 - rhoE) * E0 + dE)      // rhoE = 0.9966 per window (about 0.98 per hour); E0 the district's starting value
Y = clip01(rhoY * Y + (1 - rhoY) * Y0 + dY)      // rhoY = 0.9983 (about 0.99 per hour)
L = clip01(rhoL * L + (1 - rhoL) * L0 + dL)      // rhoL = 0.9966
```

Retention returns a stock to its baseline `E0`, `Y0`, `L0` (`index.trust`), so a district with no events stays where it started. `dE, dY, dL` are zero except in the first window of a run, where they are the sums over the previous span's events (each event counts once, in the span it was minted) of the matching rows of `data.stocks.effects`, in digest order:

| When | dE | dY | dL |
|---|---|---|---|
| A public `enforcement` event (a visible remedy by a legitimate group) | +0.01 | −0.01 | 0 |
| A `police-action` event of size 2 or more whose parent has size 2 or more (police answered) | +0.01 | −0.015 | +0.01 |
| A public incident of size 2 or more (`theft`, `assault`, `gang-clash`) with no `police-action` child in the ring (a failure seen by many) | 0 | +0.02 | −0.02 |
| A `shakedown` event of size 2 or more (rule by fear) | −0.01 | 0 | 0 |

`fear(d) = data.stocks.fearBase (0.5 [tunable]) × (the district's gang-class entry share)`, a constant per district. `rhoE`, `rhoY`, `rhoL`, the rows and `fearBase` are **[tunable]**. The report chance is the formula of §7.2; it is computed by its readers from this digest.

**8. Agreement and validity.** `coarseFine`: **exact**.
- *Conceptual:* trust in the police is a slow stock moved by what residents see; fear and the norm against talking to the uniforms lower reports.
- *Verification:* SF1-O-1 to SF1-O-3: each row moves the stocks as stated; retention; identical under partition.
- *Operational:* M15-14 (each input moves the report chance as configured), M14-12 (no lock-in), and bounded stocks over a soak.

### 7.7 `order.ledger`

**1. Purpose and patterns.** It writes the reputation labels that S2 reads. Evidence arrives through the `witness` and `social` policies as beliefs held by carriers (§8.9). This process re-evaluates the standings that changed, and pins a label when its band changes. Patterns: audience-relative reputation (M15-15), evidence independence (M15-16), absence invariance and displacement (M15-17), aggregate against residents (M15-18).

**2. State and scales.** Tiers 1 to 4: the carriers are tier 1; the items they hold are read as beliefs.

```ts
interface LedgerState { v: 1; handledSeq: number; labels: Record<string, number> }     // key: carrier|subject|axis → band (0 unknown, 1 low, 2 mid, 3 high)
interface LedgerDigest extends DigestBase { labels: Record<Id, Record<string, { band: number; mass: number; items: number }>> }    // by carrier, then axis, for subject v
```

**3. Overview.** One run per span. It reads `S1Record.dirty` (entries with `seq > handledSeq`), recomputes each listed `(carrier, subject, axis)` with `aggregate` at the run's first boundary, and for each changed band writes a pin `label-<axis>@w<k>` on the carrier's `standing-v` node. It then sets `handledSeq`.

**4. Design concepts.** There is no second store: the ledger is the set of carriers' beliefs (§8.9). A label changes by new evidence or supersession, never by time alone. It reaches V through behaviour, never through a number.

**5. Initialisation.** No labels: every standing reads `unknown`.

**6. Input.** The S1 record's dirty list (read-only through `ctx.record()`), `aggregate`, `data.ledger`.

**7. Submodels.** The carriers, axes, judge table, reach tables and bands are §8.9. For each dirty triple the process calls `aggregate(carrier, subject, "rep-" + axis, t)` with `t = startOf(k)`. The band is `unknown` if `mass < m0` (2), else `high` if `E ≥ 0.7`, `mid` if `E ≥ 0.4`, else `low`. If it differs from `labels[key]`, the pin is written and `labels[key]` updated. The digest lists the current labels of every carrier.

**8. Agreement and validity.** `coarseFine`: **distribution**: the aggregate's expected value against the mean of residents' own beliefs formed by `knows` (§8.9), within sampling error and 0.1 absolute **[calibrate]** (M15-18).
- *Conceptual:* reputation is audience-relative and evidence-based; a chain of tellings adds nothing; standing survives absence.
- *Verification:* SF1-L-1 to SF1-L-6 and S0 F-24 (the worked trace; the chain; the absence; the flip).
- *Operational:* the panel question of whether the street reacts to V as to someone it has met (P15-01), with prices, greetings and access as the cues.

### 7.8 `group.decide`

**1. Purpose and patterns.** It makes groups actors. For the Tyger Claws and The Mox of Kabuki it computes the urgency of their drives from their books and board, forms their operative weights, opens their concerns, makes their leaders decide, issues orders to members who are in focus, and passes what they want to the city as rate contributions. Patterns: the drive fixtures D-a to D-n (dossier 1 §13.7), the divergence read, the hypocrisy seed material.

**2. State and scales.** Tiers 0 to 2, per group.

```ts
interface GroupState { v: 1; groups: Record<Id, G> }
interface G {
  aff: 'A1' | 'A2' | 'A3'; district: Id; members: number;
  books: { cash: number; burn: number; income: number };                // eurodollars, per game day for burn and income
  pulse: Record<string, { at: number; sev: number; latched: boolean; releasedAt?: number }>;      // the strongest pulse per drive
  lastRelief: Record<string, number>;
  W: Record<string, number>; D: number;                                   // operative weights and divergence
  frames: Record<string, { drive: Id; concern?: Id; goal?: Id; means?: string; since: number }>;
  retal?: { rival: number; since: number };                               // affiliation class index of the rival
}
interface GroupDigest extends DigestBase {
  groups: Record<Id, { aff: string; U: Record<string, number>; W: Record<string, number>; D: number; goals: Array<{ frame: Id; means: string; drive: string }> }>;
  boost: Record<Id, Record<number, Record<string, number>>>;               // district → affiliation class → kind → boost
  pairBoost: Record<Id, Array<{ a: number; b: number; mult: number; until: number }>>;
}
```

**3. Overview.** Per window, per group (in `Id` order): (1) in the first window of a run, take the previous span's events; (2) update the books; (3) update pulses; (4) compute each drive's urgency; (5) operative weights and divergence; (6) open and close concerns; (7) choose means for new concerns; (8) issue orders to members in focus; (9) the retaliation check; (10) publish boosts.

**4. Design concepts.** *Groups are actors* (D-08). Their concerns change only through their leaders' decisions (`decide` operations). *What a group wants reaches the city by weight*, with no special mechanism: an active goal adds a boost to the offender term of the matching kind in its cells. *A group's grudge against V is a belief* that may raise an offer through S2; no S1 process aims an act at V (§12).

**5. Initialisation.** Groups from `xf.kabuki.groups@1`: `aff`, `members` (the fitted share of the district's residents who are of that class), books, leaders (two each, drawn `H("gen", group, "leaders", i)`), ethos. Pulses empty.

| Pack data | Tyger Claws (`A1`) | The Mox (`A2`) |
|---|---|---|
| Books (`cash`, `burn`, `income`) | 9,000; 300; 330 | 4,000; 150; 140 |
| Per shakedown income | 25 | 0 |
| Drives carried | continuity, treasury, turf, reputation, cohesion, legitimacy, retribution, growth, secrecy, succession, care_of_members, independence | continuity, treasury, turf, reputation, cohesion, legitimacy, retribution, secrecy, compliance, succession, care_of_members, independence |
| Ethos spikes (the rest are 1) | treasury 2, reputation 1.5, succession 1.5 | care_of_members 2, legitimacy 1.5, independence 1.5 |
| Means | `collect-payment`, `retaliate` | `protect-members`, `retaliate` |

The individual ethos multipliers of the factions (for example honour ×1.5 for the Claws) are pack data used by members' importance (§8.1). They are **judgement**, and need a review by someone who knows the lore.

**6. Input.** The `city.events`, `city.mirror` and `order.norms` digests; the index; `data.groups`.

**7. Submodels.**

*Books.* Every window: `cash = cash + (income − burn) × W / 86400`. In the first window of a run, a lump sum is added: `perShakedown × offenderShare(d, "shakedown", f) × n`, with `n` the previous span's shakedown incidents of the district over all sizes (the sum of the matching `counts` of the `city.events` digest). `runway = burn > 0 ? cash / burn : ∞`, in days.

*Pulses.* In the first window of a run, for each event of the previous span (the `city.events` digest `events`, the `city.mirror` digest `covered`, the `order.norms` digest `events`) in digest order, with `sev = [0.3, 0.6, 0.9, 1.0][size − 1]` and `mine` the group's class index:

| Event | Drive and pulse |
|---|---|
| a `gang-clash` or `assault` whose victim side is `mine` | `care_of_members` (u0 0.7, τ 7 d); `retribution` latched, severity `sev`, rival = the aggressor side if it is a gang class; `reputation` (u0 0.7, τ 30 d) if public; `continuity` (u0 0.6, τ 14 d) if `size ≥ 3` |
| a `gang-clash` whose aggressor side is `mine` and whose rival side is a gang class | `lastRelief[reputation] = event time`; and releases the latched `retribution` pulse toward that rival |
| a public `enforcement` of rung `beating` by the group's enforcers | `legitimacy` (u0 0.6, τ 60 d) |

A new pulse replaces the drive's stored one if its effective urgency now is larger. Latched retribution is released by retaliation (above), by an arbiter's settlement (none in M3), or by exhaustion after 90 days.

*Urgency.* The group drive models use the shared functions of §8.1. `U` is the group's value now.

| Drive | Model |
|---|---|
| `continuity` | max of `S`: `clip01(1 − runway / 14)` and the pulse (P) |
| `treasury` | `S`: `clip01(1 − runway / 30)` |
| `turf` | the pulse (P, u0 0.5, τ 7 d on a rival's `gang-clash` in a cell where the group's presence is above the district mean); no `S` share term in M3 |
| `reputation` | max of the pulse and `R(τ = 45 d)` since `lastRelief` (untested) |
| `cohesion` | `C = 0.1` |
| `legitimacy` | max of `C = 0.2` and the pulse |
| `retribution` | latched pulse, `u0 = 0.8 × sev`, hold fraction `f = 0.5` |
| `growth`, `secrecy`, `compliance`, `independence` | `C` = 0.2, 0.1, 0.1, 0.1 |
| `succession` | max of `C = 0.1` and a pulse (u0 0.6, τ 30 d) on harm to a leader |
| `care_of_members` | max of `C = 0.4` and the pulse |

*Operative weights.* For the carried drives `d` (the set `Dg`):

```ts
ethosN(d) = ethos(d) / Σ_{d' ∈ Dg} ethos(d')
Un(d)     = U(d) / Σ_{d'} U(d')            // 0 if the sum is 0
Ln(d)     = leaders(d) / Σ_{d'} leaders(d')
W(d)      = 0.4 * ethosN(d) + 0.4 * Un(d) + 0.2 * Ln(d)         // sums to 1
D         = 0.5 * Σ_d |ethosN(d) − W(d)|                         // divergence, exposed as a read
leaders(d) = mean over the group's leaders of I(leader, matching(d))     // importance of the matching individual drive
```

`matching`: treasury → `money`, continuity → `safety`, turf → `territory`, reputation → `streetcred`, cohesion → `belonging`, legitimacy → `status`, retribution → `vengeance`, growth → `ambition`, secrecy → `evasion`, compliance → `serenity`, succession → `legacy`, care_of_members → `family`, independence → `autonomy`. A divergence above `data.groups.divergenceMin` (0.25 **[tunable]**), where someone can witness the gap, is hypocrisy-seed material (S2 reads `D` through a registered read).

*Frames and concerns.* A group drive frame has weight `w = I × (φ + (1 − φ) × U)` with `I = ethosN(d) / max_d' ethosN(d')` and `φ` by drive (treasury, continuity, compliance 0.10; retribution 0; growth 0.5; the rest 0.3). Its id is `H("mint", group, group, "frame:drive:" + d)`, actor the group. It is opened when `w ≥ θ_frame` (0.10) and closed below 0.07. A concern opens by the O1 rule of §8.3 (`w ≥ 0.35`, closes `< 0.2`; room for four open concerns). The leader's decision is an operation `decide { leader: leaders[0], group, decision: { kind: 'open-concern', drive, bindings, stakes } }`. The means are chosen by the `goals` policy (§8.4) with the group's means library.

*Orders.* For each active group goal frame whose means declares `order` (true for `collect-payment` and `retaliate`), for each member `m` of the group who is a person in `demanded(3)` or `demanded(4)` with a `core:member-of` edge of strength at least 0.2, in `Id` order, at most 3 per group per window, if no order for this goal has been given to `m`:

```ts
pressure = clip01(0.3 * rankGap + 0.4 * strength + 0.3 * fear)       // rankGap = (3 − prestige(role(m))) / 3, prestige: leader 3, enforcer 2, member 1, runner 0; fear = the edge's exit-cost
op: { op: 'order', group, member: m, goal: means.goalFor(m), parentFrame: groupGoalFrame, pressure }
```

Orders are made **only for members whose frames are in demand.** Otherwise the order is a rate contribution (below) or a count.

*Retaliation.* A group with a latched `retribution` pulse toward a rival class `r` passes a situation check once per window: `hazard = h0 × (1 + a_audience + a_weak) × (1 − a_arbiter)`, `h0 = 0.02`, `a_audience = 0.5` if the harm was public else 0, `a_weak = 0` and `a_arbiter = 0` in M3 (no strength stocks, no arbiter). If `procRand(w, "retal", group, r) < hazard`, the group retaliates: it sets `pairBoost` for the pair `(mine, r)` to `mult = 3` for `data.groups.retalWindows` (36) windows, and records `retal`.

*Boosts for the city.* The digest's `boost[d][f][kind]` is the sum of the `rateEffects` of the group's active goal means (`collect-payment`: `shakedown` +1.0; `protect-members`: `assault` −0.2); it is clamped to `[−0.5, 3]`. `pairBoost` lists the active retaliations. `city.events` reads both (§7.2).

**8. Agreement and validity.** `coarseFine`: **exact**.
- *Conceptual:* a group has books that run out, grievances that build and a character that can differ from what it does; leaders bend it; members feel it as pressure only when someone is looking.
- *Verification:* the drive fixtures SF1-D-a to SF1-D-n (dossier 1 D-a to D-n) and SF1-G-1 to SF1-G-7 (the worked operative weights, the books, retribution, the hazard, the order pressure, the boosts), and identical histories as one tick and as twelve.
- *Operational:* the divergence read on the two groups; a transcript panel on whether the Claws' week reads as a group with money worries and a code.

### 7.9 `scene.acts`

**1. Purpose and patterns.** It is the fine tier. Where a root's focus reaches a scene, it opens the summary items inside the focus into events with people, and gives focal people their routine acts, so that the coarse count becomes something a person can witness. It runs only where demand reaches ([G-7](../craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged)). Pattern: the items in focus equal the summary's count (M14-16).

**2. State and scales.** Tiers 3 and 4.

```ts
interface ActsState { v: 1; recent: Record<Id, number[]>; opened: Id[] }      // recent: by scene cell, the windows of acts in the last hour; opened: item Ids, the last 512
interface ActsDigest extends DigestBase { opened: number; acts: number; scenes: Id[] }
```

**3. Overview.** Every window, over the nodes `ctx.demanded(3)` returns (cells, in `Id` order, strongest claim first for the budget) and the cells of the persons in `ctx.demanded(4)`: (1) open the items of the window; (2) mint the focal people's routine acts; (3) the O1 and frame upkeep for demanded persons (§8.2, §8.3).

**4. Design concepts.** It never catches up and never writes outside the focus. It adds information, never occurrences: opening an item changes no count. It reads `gameOwnedNow` and no other S1 process does.

**5. Initialisation.** Empty.

**6. Input.** `demanded(3)`, `demanded(4)`; the summaries and items in scope; `presentAt`, `where`; `data.acts`.

**7. Submodels.**

*Opening an item.* For each scene cell `c`, the items of summaries whose scope is `c` or `c`'s district, whose `time` is in window `w` and whose `place` is `c`, in `(time, Id)` order, that are not in `opened`:

```ts
open(item, kind):
  roles = castRoles(kind, c, item)            // §5.4; keys procRand(w, "act-who", item, role, attempt)
  occ   = { kind, origin: 'sim', size: 1, window: w, cell: c, participants, effects, creator: proc('scene.acts') }
  if (!ctx.produce(occ).ok) skip              // the item stays unopened; logged
  ops: contribute (layer 'simulation', mode 'constrain', Const) the item's participants#count, participants[i].who and .role, effects, witnesses, outcome 'done'
  witnesses = presentAt(c, time, 60) minus participants, the first 12 by rand("present", c, person)
```

The contributions are not persisted. They regenerate identically from the same keys when the scene is opened again (S0 I-3). **Cap:** at most `data.acts.perHour` (20) opened items and routine acts per scene in any 6 consecutive windows (`recent`). Items beyond the cap stay unopened and are opened in a later window if still in focus, else not at all. Nothing is caught up.

*Routine acts.* For each focal person `p` (tier 4) whose `where(p, t)` is a scene cell: by archetype, `street-vendor`: a `serve` event with mean 0.67 per window (4 an hour) while `cls = work`; `police`: a `patrol` event, mean 0.17; and a `gang-member` of a group with an active `collect-payment` goal during a pulse of `shakedown`: a `collector-visit` at a market row, mean 0.17. Count by `spacingCount(μ, i => procRand(w, "routine", p, i), 2)`. A `serve` has the vendor as `giver` and a customer cast among `presentAt` as `taker`, effects `give` and `take`, and passes the gate (no class). They are texture: not counted in any summary.

*Witnesses and beliefs.* The `witness` policy (§8.6) runs for each event these steps mint, for the witnesses that are focal or presented, and for the carriers that a witness belongs to.

**8. Agreement and validity.** `coarseFine`: **count**: the items in a scene's focus, opened or not, equal the summary's count at that scope; opening adds nothing; the opened items are among the summary's items.
- *Conceptual:* the fine tier is generated from the coarse state, consistent with it. A scene never contradicts what the city recorded.
- *Verification:* SF1-A-1 to SF1-A-6 (opening, the cap, regeneration after a reload, no catch-up, the gate on a minor); SF1-E1's twin runs with V in different cells.
- *Operational:* a template-written week in Kabuki, shown to readers who know the game, for panel P-C (M14-17, P15-01).

## 8. The policies

A **policy** is event-driven. It runs behind a kernel hook, a relevance emission or a worklist, and it keeps no schedule of its own. Its state is the S1 record (§2.2). Relevance emissions reach S1 in the kernel's order (actor, demand roots first, then frame `Id`); S1 applies its own thresholds on top of `θ_react` = 0.08: `data.minds.thetaS1` = 0.2 **[tunable]**.

**The watch frame.** S1 holds one frame on the root `city`, `H("mint", city, city, "frame:s1-watch")`: level `situation`, weight 1, no parents, status `active`, focus `{ nodes: [], tier: 0 }`. Its `reactsTo` selectors are: frame changes whose binding has `@role = focus` and kind `core:person` or `core:group` (so `frames` hears when a root's focus reaches an actor); events with a participant `v` in a role of an actor (V's acts); readings of the mirrored slots `alive`, `affiliation` and `quest-linked` of `xf:person` (so `reconcile` hears the game's corrections). A kind-level match is `r = 1 × 0.6 × 0.5 = 0.3`, above `θ_react`.

### 8.1 `urgency`, importance and frame weight

**The catalogue is pack data.** `xf.core.drives@1` holds the 39 individual drives in ten families and 14 group drives of [dossier 1 §8 and §11](../craft/d01-motivation-drives.md#8-catalogue-v1-individual-drives), as rows: `id`, `family`, `kind` (deficit D with floor `φ` 0.10, mixed M 0.30, growth G 0.50, latent L 0.00), `horizon`, `scope`, importance parameters `(I0, L1, L2, κ)`, urgency model and parameters, satisfiers and threats. M3 ships the values of that dossier's tables A to D unchanged, as **[tunable]** pack data. The family is a field of every drive, so that a group's concern of family `X` can parent a member's frame of family `X` ([S0 §12](kernel.md#12-groups-and-membership)).

**Drive-states.** The pack builder generates one kind per catalogue drive, `xf:ds-<id>`, extending `core:drive-state`, and gives every person kind an owned slot `d_<id>` of it. The node is `H("val", person, "d_" + id)`. Its slots:

| Slot | Mode | Meaning |
|---|---|---|
| `drive` | derived | the constant `id` |
| `importance` | derived (`importance@1`) | the formula below |
| `noise` | sampled | an enum of 64 equiprobable normal quantile bins: the per-drive noise `e`, with value `Z[64·q + 32]` |
| `lastRelief`, `pulseAt`, `releasedAt`, `due` | assigned (int) | times of the facts the urgency models read |
| `pulseSev`, `available`, `required`, `dist`, `belief` | assigned (real, q 1/64) | their magnitudes |
| `latched` | assigned (enum no, yes) | |
| `urgency` | derived (`urgency@1`), temporal `W` | the model below |

A person kind also has `z1` and `z2` (sampled enums of 64 normal quantile bins, the two latent axes), `life` (a sampled enum of 16 bins, the lifetime of §4.2), `horizon` (derived from `age`, `life` and `profile`) and `ethosMult` (an assigned `vec`, the membership term for explicit memberships). The kernel reads unavailable assigned inputs as unavailable; `importance@1` and `urgency@1` receive them as `undefined` and apply their defaults (K-2, §16).

**Importance** is the slow variable: a pure function of identity, archetype, circumstance and memberships. It is constant within a window, and changes only by a recorded contribution.

```ts
function importance(drive, archetype, z1, z2, noiseBin, horizonYears, affClass, ethosMult?): number {
  const e = Z[64 * noiseBin + 32], a = Z[64 * z1 + 32], b = Z[64 * z2 + 32];
  const profile = exptab(sigS * (L1 * a + L2 * b) + sigE * e) * normD;            // sigS 0.35, sigE 0.25 [tunable]
  const circ = powTab(horizonYears / 30, kappa);                                   // H0 = 30 years
  const M = ethosMult !== undefined ? ethosMult[drive] : impliedMember(affClass, drive);
  return clip01(I0 * A(archetype, drive) * profile * circ * M);                    // multiplied left to right
}
// M = clamp(1 + strength × (ethos_f(drive) − 1) × identification, 0.25, 3); implied: strength 0.6, identification 0.5 [tunable]
// normD = 1 / (Mz(sigS·L1) × Mz(sigS·L2) × Mz(sigE)); Mz(c) = (Σ_{i=0}^{4095} exptab(c · Z[i])) / 4096, summed in order, at load
```

`horizonYears = max(1, deathAge − age − hazard)`, with `hazard = 3 + 5 × [gang-class affiliation]` **[tunable]**. `normD` makes the population mean of the profile term 1. Heritage, gender and name origin are never inputs (§12). A canon person's importances are authored pins and override every layer.

**Urgency** is the fast variable: **derived and never ticked**, a pure function of timestamped facts and the query time `t`.

```ts
function urgency(m: Model, f: Facts, t: GameTime, defaults: Defaults): number {
  switch (m.code) {
    case 'R': {                                           // rising deficit
      const dt = f.lastRelief === undefined ? defaults.sinceRoutine(m.drive, t) : Math.max(0, t - f.lastRelief);
      return 1 - exptab(-dt / m.tau);
    }
    case 'S': return f.required === undefined || !(f.required > 0) ? defaults.stock(m.drive) : clip01(1 - f.available / f.required);
    case 'D': return f.due === undefined ? 0 : (t >= f.due ? 1 : 1 / (1 + m.kappa * (f.due - t) / m.tauD));
    case 'P': {                                           // pulse; m.f = 0.5 is the held fraction when latched
      if (f.pulseAt === undefined || t < f.pulseAt) return 0;
      const base = m.u0 * f.pulseSev, e = t - f.pulseAt;
      if (!f.latched) return base * exptab(-e / m.tau);
      if (f.releasedAt === undefined || t < f.releasedAt) return Math.max(base * exptab(-e / m.tau), m.f * base);
      return m.f * base * exptab(-(t - f.releasedAt) / m.tau);
    }
    case 'X': return f.dist === undefined || f.belief === undefined ? 0 : m.sev * f.belief * exptab(-f.dist / m.lambda);
    case 'C': return m.c;
    case 'Y': return clip01(inner(m.of, f, t, defaults) * m.gate[hourOfDay(t)]);
  }
}
```

Alternatives within a drive combine by `max`; independent sources by `1 − Π(1 − Uᵢ)` (`m.combine`). The gains of dossier 1 §9.1 are 1 in M3 (`data.minds.gThreat`, `gReward`). The model `O` (opportunity) is phase 2. A satisfier gives relief `s` that acts on the model's **input facts**, not on `U`: for `R`, `lastRelief := t_r − (1 − s)(t_r − lastRelief)`; for an unlatched `P`, `pulseSev := pulseSev × (1 − s)` at `t_r` (restarting the pulse); for `D`, `due` moves or clears; for `S`, the stocks change. Relief is capped when `U` is already below 0.1. Latched pulses release only on their release events. `reciprocity` is a deadline with a sampled lag: when a favour is done to the actor, `due = t_favour + median × exptab(0.6 × normalOf(rand("lag", tie, event)))`, with `median` 3 days for a small favour and 14 days for a large one and `τ_d` 2 days (so that no lag is zero and the lags are log-normal with σ = 0.6). Relief is written by the `goals` policy on `goal-met` and by pack `reliefRules` on named events; each writes the fact slots by `committed` pins.

**The debt ladder.** A drive row may carry a `ladder` (the `debt` row does): events after the due time `T` of a `D` model. For a debtor in a root's focus, `scene.acts` mints a `reminder` event at `T + 1 d`, a `collector-visit` at `T + 3 d` and an `enforcement` event at `T + 7 d` (informal and gang creditors; corporate creditors use legal action in the pack's ladder), each with the creditor group as the `aggressor` or `giver` and the debtor as `target` (through the gate), once each (the state is in `ActsState.opened`). For unobserved debtors the ladder is a rate, not events (a district's shakedown and default counts).

**The unpinned default.** Most people are never observed. For drives met by routine (`sustenance`, `rest`, `pleasure`, `friendship`, `curiosity`) the default `sinceRoutine(drive, t)` of an unpinned actor is a function of the time of day and the schedule type, and nothing is stored: the seconds since the latest anchor of the drive's cycle (`sustenance` at 07:30, 13:00, 19:00; `rest` at 07:00; `pleasure` at 20:00; `friendship` at 12:00 and 20:00; `curiosity` at 09:00), shifted by +8 hours for a night schedule (`nightlife`, `gang-member`). A pinned fact replaces it.

**Frame weight** is `w = I × (φ + (1 − φ) × U)`, so a deficit drive at rest weighs a tenth of its importance, a growth drive at least half, and a latent drive matters only once triggered. **Serenity** is the one drive whose urgency the `frames` policy computes and not a `Derive`: `U = clip01(Σ pull(c) over the actor's open, blocked or active concern frames with pull ≥ 0.4, divided by 3)`, because it reads frames.

### 8.2 `frames` and `v.frames`

**Demand tiers and what opens.** A node's demand tier is set by the kernel ([S0 §10.6](kernel.md#106-demand-and-tiers)).

| Demanded tier | Frames S1 opens for an actor |
|---|---|
| 0 to 2 | None for people. Drive frames for groups, from `group.decide` |
| 3 | Drive frames with weight at least `θ_frame` = 0.10 (closed below 0.07) |
| 4 | The full chain: drive, then concern (O1 to O5), goal, step and situation. A member's drive frames take the concern frames of the groups of strength at least 0.2 as extra parents, at edge weight `strength` |

The `frames` policy runs when the watch frame hears a `frame` Change that focuses an actor, and `scene.acts` re-evaluates the demanded persons every window: for each drive, the weight is recomputed, a change of `q64(w)` writes `frame-weight`, and crossing the thresholds opens or closes the drive frame. The frame ids are:

| Frame | `Id` (creator = cause = actor) |
|---|---|
| drive | `H("mint", actor, actor, "frame:drive:" + drive)` |
| concern | `H("mint", actor, actor, "frame:concern:" + drive + ":" + w)`, `w` the boundary index at which it opened |
| goal | `H("mint", actor, actor, "frame:goal:" + shortId(concern) + ":" + w)` |
| step | `H("mint", actor, actor, "frame:step:" + shortId(goal) + ":" + index)` |
| situation | `H("mint", actor, actor, "frame:situation:" + cell)` |

`shortId` is the first 8 hex digits. **When demand leaves**, step and situation frames close (`abandoned`, cause `demand-left`). The drive, concern and goal frames of a person V has met (an `observed` pin) stay `active` and are not advanced; those of anyone else close the same way. A goal whose deadline passed while its actor was out of demand lapses quietly on return (`abandoned`, cause `lapsed-offscreen`, no event). This is a recorded compromise (C-S1-12).

**`v.frames`** opens only what the game states, from the mirror, and never V's drives:

1. **A situation frame** for V's cell at tier 3, and one for each of its `adj1` cells at tier 2, always open. Id `…"frame:situation:" + cell` with actor `v`. When V's mirrored `cell` changes, the frames for the old cell are abandoned and the new ones opened.
2. **A goal frame for each objective the game tracks.** A tracked journal entry (a mirrored node) becomes a goal frame on `v` that `wants` the entry's target and place, `active` or `blocked` by the entry's journal state. It carries `source: game` and the journal record as `cause`. It says what the game asked, not what V feels.
3. **A step frame** for the person V is speaking to, from the dialogue feed (tier 4 on that person).
4. **Nothing else.** Inferred frames come from the director's beliefs (S0 §11.3). No process pins V's drives (S0 I-12).

### 8.3 `concerns` (O1 to O5)

A drive becomes a concern when a generator fires. Each concern frame (level `concern`) records `origin` (O1 … O5) and a cause, so "why is this person here?" always has an answer. Its parent is the actor's drive frame, at edge weight `stakes`. Its `own` interests are the instantiated satisfiers and threats of the drive (dossier 1 table D, with the bindings `$self`, `$grp`, `$stall`, `$kin`).

| Generator | Fires when (evaluated at) | Opens | Stakes |
|---|---|---|---|
| O1 Deficit | a drive frame's weight crosses `θ_open` = 0.35 rising, and no routine will meet it; closes below `θ_close` = 0.20 (each boundary, for demanded persons) | a concern on the drive | `clamp(U, 0.3, 1)` |
| O2 Blocked want | a `blockedBy` emission on a goal or concern frame, `r ≥ θ_S1` | sets that frame `blocked`; a concern on the same drive, wanting the blocker removed | `clamp(r, 0.3, 1)` |
| O3 Loss | a `protects` emission (a violating effect on a protected node) | a concern on the protecting frame's drive, to recover or answer | `clamp(r, 0.3, 1)` |
| O4 Aversive presence | a `threatenedBy` emission | a concern on `safety` (or `evasion`), valence avoid | `clamp(r, 0.3, 1)` |
| O5 Order or duty | an `order` operation lands on the member | none separately: **the order's goal frame is both concern and goal**. Its `origin` is the group's goal and its cause the order | the order's `pressure` |

**"No routine will meet it"** is true for a routine drive only when its facts are pinned and the elapsed time exceeds twice its `τ`: an unobserved person never opens a concern for sustenance or rest. A drive whose routine fails (a vendor with no money for lunch) does. **Capacity:** at most `data.minds.concernRoom` (3) open concerns beyond routine. A new concern whose pull is at least 1.5 times the lowest open concern's replaces it (`abandoned`, cause `superseded`); otherwise it is dropped and logged. **Hysteresis:** a drive weight that moves between 0.30 and 0.40 opens its concern once and closes it once (D-d).

### 8.4 `goals`

A concern needs a **means** from the means library (`xf.core.means@1`, about ten in M3). A means:

```ts
interface Means {
  id: string; serves: Array<{ drive: string; relief: number }>;     // drives it serves; the relief it gives on success
  requires: string[];                                               // capability predicates over the actor (money, contact, workplace, ally)
  legit: 0 | 1 | 2;                                                 // legal, tolerated, illegal
  cost: number; risk: number;                                       // 0 to 1
  duration: number;                                                 // windows
  tags: string[];                                                   // norm tags
  effects: Array<{ on: string; effect: Effect }>;                   // for the conflict table
  steps: Array<{ act: string; windows: number }>;
  rateEffects?: Array<{ kind: string; boost: number }>; order?: boolean; alternatives?: { resource?: string };
  scalable?: boolean;
}
```

| Means | Serves | Legit | Cost | Risk | Windows | Notes |
|---|---|---|---|---|---|---|
| `buy-food` | sustenance | 0 | 0.1 | 0 | 6 | requires money not exhausted |
| `work-extra-shift` | money, work | 0 | 0.4 | 0.05 | 72 | requires a workplace |
| `ask-for-loan` | money, debt | 0 | 0.3 | 0.1 | 36 | requires a tie with commitment at least 0.3 |
| `pay-collector` | debt, safety | 1 | 0.5 | 0 | 6 | tag `fee` (supports the fee norm) |
| `warn-neighbours` | safety, family, justice | 0 | 0.1 | 0.15 | 12 | effect `expose` on the threat |
| `report-to-police` | safety, justice | 0 | 0.2 | 0.4 | 24 | tag `uniforms` (the norm against it) |
| `hide-and-avoid` | safety, evasion | 0 | 0.2 | 0.1 | 36 | |
| `collect-payment` (group) | treasury | 2 | 0.2 | 0.2 | 144 | `order`; `rateEffects`: `shakedown` +1.0 |
| `retaliate` (group) | retribution | 2 | 0.5 | 0.4 | 36 | `order`; sets a pair boost |
| `protect-members` (group) | care_of_members, continuity | 1 | 0.3 | 0.2 | 144 | `rateEffects`: `assault` −0.2 |

**Choosing.** The candidates are the means that serve the concern's drive (relief on that drive) and that the actor can do (`requires`). **Legitimate means come first:** the candidate set is the legal (0) feasible means if there are any, else the legal and tolerated, else all.

```ts
score(m) = progress(m, concern) * pull(concern)
         + Σ over other open concerns c' of progress(m, c') * pull(c') * 0.5          // multifinality
         - Σ over protected interests i of the actor of violates(m, i) * pull(i)       // counterfinality: the conflict table (§8.5); the kernel reports a Dilemma
         - cost(m) - gThreat * risk(m) * stakes(concern)
         - normPenalty(actor, m)
         + (m.id === currentMeans ? 0.15 : 0)                                          // the persistence margin
progress(m, c) = serves drive of c ? 1 : (serves a drive of the same family ? 0.5 : 0)
normPenalty = [0, 0.05, 0.30][m.legit] * (1 + I(honour) + I(integrity)) / 3
            + Σ over tags: tagWeight[tag] * beh(norm of the tag)        // 'uniforms': +0.4 × beh; 'fee': −0.1 × beh (support)
pick = argmax over candidates of (gamma * score(m) + gumbel(("goal", actor, concern, decisionWindow), m.id))     // gamma = 3 [tunable]; ties to the lower m.id
```

`decisionWindow` is the index of the boundary being processed: **a window index, never an epoch**, so a reload reproduces the pick. One decision in about eight goes to the best lower-pull concern: if `rand("goal-share", actor, decisionWindow) < 0.125`, the concern considered is the open concern with the greatest pull other than the top. Scoring runs only for actors in an open frame. Others take the highest-scoring means coarsely (no draw).

**Commitment.** A goal frame (level `goal`) has a commitment `c = clip01(0.5 + 0.5 × identification)`, a deadline `now + duration × W`, the persistence margin 0.15, and a level of interest `LOI(t) = exptab(−(t − lastProgress) / (36 × W))`. The state is `GoalState { frame, means, committedAt, deadline, lastProgress, step, decisionWindow }` in the S1 record. It is **reconsidered** when: it has been blocked longer than the horizon limit (`T_b`: 2 h for a *now* drive, 2 d for *soon*, 14 d for *long*); a new concern's pull exceeds the goal's by 1.5 (a crisis override); another means scores better by more than `0.15 + 0.1`; `LOI < 0.2`; or it succeeds or becomes infeasible.

**Progress and outcome.** A step is done when its windows have elapsed and its preconditions hold. When the last step is done, the goal succeeds if `rand("goal-out", frame, 0) < successP`, with `successP = clamp(0.85 − 0.5 × risk, 0.2, 0.95)`, else it fails. Outcomes are events with causes (`goal-met`, `goal-abandoned`, `goal-blocked`), minted with the frame as cause and `served` the frame, through the gate. A success writes relief for the means' `serves` drives. A failure fires O2 or O3 on the remaining interests and attributes blame (§8.6): an agent blamed raises `vengeance` (a latched pulse); otherwise serenity's stress load rises.

### 8.5 `dilemma` and the conflict table

**The conflict table's contents** are the kernel's first version, adopted as complete for M3 ([S0 §10.8](kernel.md#108-effects-and-cross-pressure)): `protects X` is violated by `harm`, `kill`, `take` or `expose` on X; `wants Y` by `conceal` or `take` on Y. `help`, `protect`, `rescue`, `give` and `meet` violate nothing. The table is a registry function over pack data and can grow without code. Betrayal, deceit and refusal are event kinds, not effects.

**A `Dilemma`** reaches S1 with the actor, two frames of different origin, the target and the effect. It resolves by one of four strategies, drawn by `invCum` with `rand("dil", actor, frameA, frameB, decisionWindow)` over the weights of the strategies available:

| Strategy | Weight | Available when |
|---|---|---|
| alternative resource | 0.3 | the goal's means has `alternatives.resource` and it is feasible |
| alternative plan | 0.3 | another feasible means serves the goal's concern with no violation |
| modified goal | 0.2 | the means is `scalable` |
| abandon one | 0.2 | always: the frame with the lower pull is abandoned (ties: the larger `Id`) |

**From an order,** the member's options are drawn from a prior and modulated, with the key `("defect", member, window)`, `window` the boundary index:

| Option | Prior | Raised by | Lowered by |
|---|---|---|---|
| Delay | 0.30 | order ambiguity; absent monitoring | tight monitoring; a deadline |
| Avoid or be absent | 0.20 | distance from the cell | exit cost; being watched |
| Fake compliance | 0.20 | weak monitoring; `deniable` membership | detection chance |
| Warn the target | 0.12 | closeness of the tie at risk | fear of the cell |
| Comply | 0.10 | fear; identification | closeness of the tie at risk |
| Refuse openly | 0.04 | status; allies in view | fear |
| Betray the group | 0.02 | (phase 2: the contract hazard) | bond; exit cost; the remaining turn budget |
| Run or leave | 0.02 | `strength` below threshold | exit cost; kin tied to the group |

Each factor `x` is in 0 to 1. The weight of option `o` is `prior_o × Π_{raisers}(1 + x) / Π_{lowerers}(1 + x)`, with the pack's mapping from each factor to data: ambiguity, monitoring, deadline (the order's fields); distance (graph distance to the group's home cell ÷ 4, clamped); exit cost (the edge's `exit-cost`); watched (witnesses present ÷ 5, clamped); detection (monitoring × (1 − cover)); closeness (the tie's `strength`); fear (the edge's `exit-cost`); identification (0.5, or 0.2 if coerced); status and allies (0, 0 in M3); bond (the tie's `commitment`); turn budget (§8.10). The weights are normalised by `invCum`. A membership's `strength` is the `commitment` of §4.7, computed from the member's satisfaction, investment and alternatives for the group (DRV-38): more alternatives lower it and more investment raises it, so the weight of "run or leave" rises with alternatives and falls with investment (D-j). Delay, fake compliance and quiet exit are the usual outcomes by design. A betrayal is a declared seed (S2 §2.17): S1 only counts it against the turn budget, and no S1 process turns an ally against V.

### 8.6 `witness`: perception, salience and attribution

`onWitness(event, observer)` is called for each witness of an event, as the kernel's belief hook.

**Who witnesses.** At fine tiers, the persons present in the event's cell at its time (`presentAt`), open-air events reaching the cell and interior events only the venue's cell. At coarse tiers, witnesses are a count taken from the cell's population by period (§7.2). Only individuated persons appear in an event's `witnesses` slot. A `secret` or `deniable` membership is never perceived. **S1 forms beliefs only for witnesses that are focal (tier 4 demanded), that V has met (`observed`), or that belong to a carrier** (for the carrier's item, §8.9). Others are a count.

**The perception policy.** `knows` reads a mirrored slot only where its dimension is visible. The M3 policy marks visible: `alive` (of a seen body), `position` (for those present), appearance tags and whether someone is armed, and **affiliation where the look carries it** (gang-class affiliations: the game's gang looks are named for the gang). It does not mark drives, money or secret memberships.

**Salience** is rated at formation, 0 to 3, one point each, at most 3:
1. stakes: `matchStrength(observer, event) ≥ 0.5` (K-6, §16): the strongest relevance of the event to the observer's frames;
2. the event class's emotional pulse: `kind.pulse ≥ 0.6`;
3. V's act touched a tie: a participant other than the observer has a tie with the observer at layer 2 or inner, or a materialised tie;
4. V showed it mattered: the rule S3 owns. It is 0 in M3.

**Memorable by rule:** salience 3, or an event that violates a `protects` interest of a concern frame with pull at least 0.5 (harm to a core concern), an unpaid debt, an open promise, or a betrayal.

**What forms.** For an observed act (an event with an actor `a`, an effect `x`, a target `y`): a belief `{ believer: observer, subject: a, path: "did." + x, at: event.time, value: y, confidence: 1, evidence: [event], source: { by: 'observed', event }, formed: now, refreshed: now, memorable, salience }`. Its `Id` is `H("belief", observer, a, path, at)`. For an intentional act, also an attribution belief (below). Unintentional events (outcome `done` with no actor role, or kind `accident`) form a causal belief `path: "cause"`, value the event's cause or the place. The kernel merges and refuses duplicates by (believer, subject, path, at) (I-9). S1 decides a contradicting newcomer replaces the existing belief only if its confidence exceeds the existing one's by more than 0.1.

**Attribution** has one policy for self and other, `attr@1`. An observed intentional act forms a belief about the actor's reasons, path `reason`, `at` the event's time, a region over reason classes. The weight on disposition against situation is

```ts
wD = clamp(0.65 - 0.2 * constraintVisible * (1 - load) + 0.1 * attitudeTilt, 0.2, 0.9)      // 0.65 [tunable]
// constraintVisible = 1 when the event has a cause in `causes` (a visible situation), else 0
// load = the observer's stress load (§8.1), 0 if unknown
// attitudeTilt = +1 when the observer's affiliation is hostile to the actor's, −1 when friendly, else 0
region = wD >= 0.5 ? dispositional(effect) : situational(effect)
confidence = q64(0.4 + 0.5 * |2 * wD - 1|)
source = { by: 'inferred', rule: attr@1, from: [event] }
```

The reason classes (pack data) are, by effect: `harm`, `kill`: dispositional {hostile, cruel}, situational {pressured, defending, accidental}; `take`: {greedy} / {desperate, ordered}; `help`, `protect`, `rescue`, `give`: {kind, loyal} / {duty, paid}; `expose`: {spiteful} / {ordered}; `conceal`: {secretive} / {afraid}; `move`, `meet`: {social} / {errand}. Errors are recoverable by evidence. Every such belief has the event in `from`, so `trace` is complete. An NPC may voice its own belief about V's motive only as [D-22](../decisions.md) allows; S1 supplies the belief and nothing else.

### 8.7 `social`: telling and lying

`onSocial(event, teller, listener)` chooses what is told and what changes in the telling, for focal people.

**Selection.** For each belief `b` of the teller about an event `e` they hold (`did.*`) :

```ts
score(b) = protectiveRelevance(b, listener) * severity(kind(e)) * closeness(teller, listener)
p_tell   = base * max over b of score(b)           // base = 0.3 [tunable]; draw rand("tell", teller, listener, b.id, window) < p_tell
```

`protectiveRelevance` is the strongest `protects` or `threatenedBy` relevance (`matchStrength` restricted to those types) of the belief's event to the listener's frames. `closeness` is the tie's `strength`, or 0.1 for strangers who share a cell.

**One operator at most per hop,** drawn by `invCum([0.15, 0.10, 0.10, 0.65], rand("op", teller, listener, b.id, hop))` over `level`, `sharpen`, `assimilate`, none (**[tunable]**), up to a hop limit of 4:
- `level` (loses detail): the told confidence is multiplied by 0.8 and the `reason` belief is not passed;
- `sharpen` (keeps and exaggerates): the path is raised one rung of `meet < take < harm < kill` where the effect is on that ladder;
- `assimilate` (bends to what the listener expects): the `reason` region is replaced by the listener's default reasons for the actor's group (dispositional if the listener's affiliation is hostile to it, else situational).

**The telling is a minted event** (kind `tell`, effect `expose` on the subject) carrying its operator. Events that policies mint (`tell`, `lie`, `reply`, `goal-*`, `turning`, `refusal`) have creator `s1` and cause the source event or frame, and the name `<kind>/<teller or actor>/<other>/<short id>/<boundary index>`. The listener's belief has `source: { by: 'told', teller, event: tellingEvent }`, **`evidence` the teller's, unchanged**, and `confidence = min(b.confidence, 0.9) × 0.8`. A rumour therefore never corroborates itself: the kernel's merge raises confidence only for evidence the listener does not already hold (S0 F-9).

**Lies** (M3 has the one rule): a teller with an active goal frame whose effects include `conceal` on the telling's subject tells a false item instead: the value is replaced by a decoy drawn among the residents of the subject's group (`rand("lie", teller, b.id, window)`); the event is `lie` (effect `conceal`); the teller's evidence lineage is kept. The item is down-weighted when independent evidence contradicts it (the aggregate's weight, §8.9).

**Volume rule.** A telling is minted as an event only when (a) the teller or the listener is in a root's focus at tier 3 or finer, (b) the belief is about V, a live seed's cast or a canon person, or (c) it bears on a protected interest as a blacklist or a lie. Otherwise spread is coarse and appears as reach (phase 2). Outside focus S1 keeps social Changes to about ten per game hour for the whole city **[tunable]**.

### 8.8 `fade`

`onTick(believer)` is called at every processed boundary for each believer that holds beliefs. It drops a belief when **all** of these hold: it is not memorable; `t − refreshed > hold`; and it is not a belief V returned to. `hold = data.minds.holdDays` (14 game days **[tunable]**) is the value the most generous memory setting would keep, so the sweep's floor property (S0 §11.2) holds from the start and a later setting never needs what was already dropped. `memoryScale` is recorded in the settings op and inert until the machinery lands. A belief is **memorable** by rule (§8.6) or when S3's return rule sets it. The cap of 40 memorable beliefs per believer **[tunable]** is kept by not promoting further low-salience beliefs. Arrivals take their district's gist as told beliefs of lower confidence, minted lazily. Group beliefs are flagged institutional (`believer` of a group kind); the flag has no effect in M3.

**No policy reads a load, a quit, the wall clock or the load class.** `fade` reads only the boundary's game time (S1-I-4).

### 8.9 `aggregate`: reputation through carriers

**The ledger is the set of carriers' beliefs. There is no second store.** A **carrier** is a node whose beliefs stand for an audience. M3 has three, all pack data (`data.ledger.carriers`):

| Carrier | Node | Type | Size (expected) | Learns when |
|---|---|---|---|---|
| `stalls` | district slot `circle-stalls` | circle | residents with role `vendor` or `shopkeeper` | a witness belongs; or the event is public in a market cell |
| `claws` | group `grp-A1` | group | the group's members | a witness belongs; or the event's victim or target is a member (the group knows its losses) |
| `kabuki` | the district | district | all residents | the event is public (m2 or above, or witnessed) |

One evidence item is one `Belief` held by the carrier about the subject (V, in M3), on the path `rep-<axis>[i]`, with `at` the event's time, `evidence: [event]`, `confidence` the channel's (witnessed 1.0, institutional 0.9, told 0.7), `salience` at formation, and `source` `observed` (or `told` with the teller). The path index `i` is the lowest free index in 0 to 31 for (carrier, subject, axis); at the cap of 32 the item with the lowest `(memorable, |v| × salienceWeight)`, then the oldest, then the lower `Id` is evicted and its index reused. The value is a `vec` `[v, reach]` on the 1/64 grid.

**The verdict of an act** is `v = judge(effect, view) × diag`:
- `judge` is `data.ledger.judge[effect][view]`, per axis (the standing rule is the `view` parameter: harm to a bad-standing target reads differently from harm to a good one);
- `view` is the carrier's view of the target, `good`, `neutral` or `bad`, from `data.ledger.view[carrier][target's affiliation class]`;
- `diag = clamp(−ln p_kind, 0.5, 3)`, `p_kind` the kind's share of the district's incident rate (from `data.shape.rate`), so a rare act weighs more.

M3 has two axes, `reliable` and `decent`. The default `judge` rows (per axis; `good`, `neutral`, `bad`):

| Effect (V as the actor) | `reliable` | `decent` |
|---|---|---|
| `help`, `protect`, `rescue` | +0.3, +0.3, +0.2 | +1.0, +1.0, +0.3 |
| `give` | +0.2, +0.2, +0.1 | +0.6, +0.6, +0.2 |
| `harm` | 0, 0, 0 | −1.0, −0.7, −0.2 |
| `kill` | 0, 0, 0 | −1.5, −1.2, −0.6 |
| `take` | −0.2, −0.2, 0 | −0.8, −0.5, −0.1 |
| `expose` | −0.5, −0.5, −0.2 | −0.6, −0.4, 0 |
| `conceal` | −0.3, −0.3, −0.1 | 0, 0, 0 |
| a `promise` event of V's, outcome `done` / `failed` | +0.5 / −1.2 | 0 |

The views: `stalls`: `civilian` good, `A1` bad, `A3` bad, others neutral. `claws`: `A1` good, `A2` bad, `A3` bad, `ncpd` bad, others neutral. `kabuki`: all neutral except `A1` and `A3` bad. These are judgement (C-S1-10).

**Reach is frozen at formation** in M3 (`city.flow` is phase 2): `reach = clamp(max(direct, base), 0.02, 1)`, with `direct = min(1, distinct witnesses who belong to the carrier ÷ carrier size)` and `base` from `data.ledger.reach[type][size]`: circle 0.10, 0.25, 0.50, 0.80; group 1.0 when the event's victim or target is a member, else 0.10, 0.25, 0.50, 0.80; district 0.03, 0.15, 0.40, 0.70, for sizes 1 to 4. A new item for the same (subject, event) from a second path is an independent witness only if its evidence differs.

**The aggregate** for audience `A`, subject `s`, axis `a`, at `t`:

```ts
function aggregate(A: Id | Selector, s: Id, path: SlotPath, t: GameTime): { value?: number; mass: number; items: number } {
  const items = itemsOf(A, s, path, t).sort(by (at, Id));          // beliefs of the carriers with at <= t; evidence-duplicates across carriers keep the one with the larger reach
  let r = 0, q = 0;                                                  // q is the negative mass, called s in the dossiers
  for (const e of items) {
    const scale = 1 - e.reach * (1 - lambda);                        // lambda = 0.9 [tunable]: the expected displacement of older items
    r = r * scale; q = q * scale;
    const w = salW[e.salience] * e.confidence * e.tellerDiscount * e.reach;      // salW = [0.25, 0.5, 0.75, 1]; tellerDiscount 1 observed, 0.8 told
    r = r + w * Math.max(0, e.v); q = q + w * Math.max(0, -e.v);
  }
  return { value: q64((r + 1) / (r + q + 2)), mass: r + q, items: items.length };
}
// label: unknown if mass < m0 (2 [tunable]); else high if value >= 0.7, mid if >= 0.4, else low
```

It is a pure read over the carriers' beliefs, deterministic, cacheable by revision and `t`, counted in the allowance (a cost bound of 2,000 units per call), and never writes. `value` is on the 1/64 grid; the unrounded `E` is used for the label.

**The rules that matter.**
- **A chain adds nothing.** A rumour retold by three tellers weighs as its origin, because telling passes `evidence` unchanged, and the kernel merges beliefs by evidence. Only independent evidence adds (S0 F-24).
- **Standing does not decay by absence.** The aggregate reads no clock. The label changes by new evidence or supersession, never by time alone, never by V's absence, never by game time V spent waiting (CTY-06). Detail slots may widen under the memory machinery. The label stays.
- **It reaches V through behaviour:** prices, greetings, access, a witness's remark after three recorded acts. `aggregate` returns numbers only inside traces. S2's reads expose bands.
- **Asymmetry is per domain.** `reliable` and `decent` weigh evidence differently through `judge` and `diag`. A V who changes course is seen to have changed, by independent new evidence, and is not trapped by the old label.
- **A resident's own belief** is the same sum over the items they know, `knows(resident, item) = rand("knows", resident, item) < reach`. Its expectation equals the aggregate's (the twin test, M15-18).
- **The firewall.** NPC beliefs about V reach the director only as aggregates, never as evidence about V's taste. S1's declared read sets exclude the director's beliefs about V (§12).

**Absorbing V's acts.** The watch frame hears an event with V as an actor. The policy `absorb(event)` runs once: for each carrier, it decides whether the carrier learns (the table above), computes `reach`, and for each axis with a non-zero `judge` sets the item by `belief-set`. It appends `(carrier, subject, axis, seq)` to `S1Record.dirty`. The `order.ledger` process pins the label on change.

### 8.10 `change`: how NPCs change

People change by belief revision under pressure, and mostly they don't. This is the policy for the focal set (generated and open NPCs); a **canon** NPC changes only beliefs about V and ties with V unless an author declares a turn.

| Part | Rule |
|---|---|
| Held view | A `Belief` in the NPC. Its subject may be the NPC itself, a group, a place or V |
| Stability | The `stability` trait strength: 0.2, 0.5 or 0.8 |
| Pressure | The account on a view grows by `w = (1 + salience) / 4` for each event, independent of evidence already counted, that contradicts the view, and by `severity` for each `Dilemma` between frames of different origin. Pressure citing evidence already counted adds nothing. The account decays by `exptab(−Δ / (14 days))`, applied lazily at read |
| Threshold | `θ = 3 × (0.5 + stability) × (1 − gain)ⁿ`, floor `0.5 × 3 × (0.5 + stability)`, `n` the rationalisations accepted so far, `gain = 0.1` **[tunable]**. One or two independent events almost never turn a stable NPC; four or five usually do |
| Revision | When the account reaches `θ`, the view moves towards the evidence. If the move would violate a protected frame with pull at least 0.6, it moves to the nearest view that spares that frame (a **rationalisation**: `n` rises by one). No single step exceeds a third of the total change; a numeric view moves by at most that per turn, an enum view moves wholly |
| Turn | S1 mints a `turning` event: `{ who, kind: revision | refusal | exit | tie, from, to, causes, served }`. A membership change is an `exit` turn with its exit cost |
| Refusal | When a decision frame resolves for the held view while the account is at or above 0.7 `θ`, S1 mints a `refusal` event. It changes nothing in the NPC. It is a recorded choice under pressure that V can see |
| Reversal | A later contrary account builds from zero against the new view, with the same `θ`; the old account decays with absence |
| Drift | Moves an NPC towards its group and role, never towards V or the population mean. M3 ships the machinery and an empty rule table; a fixture supplies a test rule |
| Caps | At most `data.minds.turnCap` (20 **[tunable]**) NPCs with a pending turn inside a root's demand focus. This is the kernel's focus, not S3's attended set, which S1 cannot see |
| Turn budget | S1 enforces a budget of betrayal turns per cast and per campaign window (`data.minds.turnBudget`: 1 and 3 **[tunable]**), and the protected set blocks turns on live casts |

Arcs gather where one thread touches the same NPC several times. Across a city with a thin spread of pressure almost everyone stays as they are; that flat arc is the right default.

### 8.11 `ties`

The pure functions `tie`, `neighbours` and `bridge`, the materialisation rule and the tie record are §4.6 and §4.7. As a policy, `ties` also: materialises a tie when a belief about it is formed or told, a goal frame uses it, a seed casts through it, or V observes it; updates the NPC's regard from the typed events of the table of §4.7 (kinds `reply`, `disclosure`, `favour`, `conflict`, `repair`, `joint-activity`, `novel-activity`, `crisis`, which seeds and V's observed acts produce); classifies replies and mints the `reply` event; decides status changes by acceptance; keeps the pursuit budget and the retract. All its draws are `("accept", tie, event)` and the identity keys; it reads no reputation ledger.

### 8.12 `reconcile`

The game is ground truth. `reconcile` runs when the watch frame hears a reading Change of a mirrored person's `alive`, `affiliation` or `quest-linked`. A load, a jump and a mirror correction are all just sources of such readings: after a load the kernel reads the game's state, which becomes `game` readings at the current time ([S0 §14.3](kernel.md#143-loading-is-replacement)), and where a reading differs it is a Change. **No policy reads the load class, a load count or the epoch** (§12). `reconcile` does, in this order:

1. **Diff** each assumption S1 holds about the changed person against the reading. An assumption is a frame of a mirrored actor, a membership edge of a mirrored person, a materialised tie edge, or a routine pin on a mirrored node (none in M3).
2. **Supersede what the game now contradicts.** If `alive` is no: `frame-status abandoned` (cause: the reading's change) on every active or blocked frame of the person; `end-edge` on their memberships and ties (the edge stays as history). If `affiliation` changed: end the old membership edge, add the new one if the group exists, cause `game`.
3. **Leave beliefs alone.** A belief is not truth. People may still believe the dead person lives. That divergence is story material, not an error.
4. **Log** every correction in the decision log with reason `game-dead`, `game-moved` or `game-fact`. The log never reaches V.

A pending child in a cell the game now covers is thinned by `city.events` itself (§7.2), reading the `city.mirror` digest. After a **jump** (a sleep, a time skip, a fast travel, a long absence) the coarse tiers replay every missed boundary in order and the fine tiers regenerate from the coarse state (§10).

## 9. What S1 exposes

### 9.1 Registered reads for S2

S2 reads the city and the people only through registered reads ([S2 §2.16 and §2.17](seeding.md#216-city-events-as-material), [§4.1](seeding.md#41-dependency-collection)). Each read is a pure function of S1 digests, the kernel and the S1 record at a time. It declares its dependencies and its invalidation, so that interests and wake-ups follow from them. **None exposes a raw number.** Each answers `maybe` until S1 has a reading for its scope (`catchingUp` and unbuilt phases included). A read answers as of the last processed boundary: a read made inside a span sees the digests of the previous span (K-4, §16).

```ts
interface S1Read<A, R extends string> {
  name: string; version: number;
  deps: { digests: string[]; interests: Selector[]; time: boolean; roles: string[] };
  eval(args: A, view: ReadView, t: GameTime): R | 'maybe';
}
interface ReadView { digest<D>(processId: string): D | undefined; value(n: Id, p: SlotPath, t?: GameTime): Value | undefined; record(): Readonly<S1Record>; tie(a: Id, b: Id): TieResult }
```

| Read (S2 atom) | Answers | Depends on | Invalidated by | M3 |
|---|---|---|---|---|
| `band(cell)` | `quiet`, `elevated`, `hot`, `flashpoint` | `city.events` digest `bands` | a `band@w` pin Change on the cell | built |
| `heatRank(district)` | the district's rank among districts: `top`, `high`, `mid`, `low` | band pins of all simulated districts | band pins | `maybe` until two districts are simulated |
| `tension(a, b)` | a pair's band | `city.tension` | | `maybe` (phase 2) |
| `regime(scope)` | `none`, else the kind of the live regime of greatest size (ties: earliest start, then kind name). `regimeIs(scope, kind)` answers `yes` or `no` | `city.shape` digest `regimes` | `regime-start` and `regime-end` events | built |
| `reach(district, item)` | whether an item or service reaches a district | `city.flow`, price level | | `maybe` (phase 2) |
| `protected(node)` | whether a place or person is under a group's protection | payment edges | | `maybe` (phase 2). The protected set (§4.4) is not this read |
| `presence(leaf, faction)` | `none`, `low` (under 2 % of entry quantity), `mid` (under 8 %), `high` | the index | none: static | built |
| `priceLevel(district)` | `low`, `fair`, `high`, `extreme` | `city.shape` digest `price` | regime changes | built |
| `refuge(leaf)` | `yes` (a safehouse or lodging service open or quiet, and no cell of the leaf hot), `poor`, `no` | `city.shape` digest `services`, bands | status pins | built; `maybe` if the index lists none |
| `label(audience, subject, axis)` | `unknown`, `low`, `mid`, `high` | `order.ledger` digest | label pins | built for subject `v` and the three carriers |
| `bridge(who)` | `low` (under 0.3), `mid`, `high` (from 0.6) | foci shares (§4.6) | none for generated people | built |
| `normGap(norm, scope)` | `aligned`, `gap`, `wide` | `order.norms` digest | `gap-<norm>` pins | built |
| `contract(id)` | `due`, `at-risk`, `broken` | contract state | | `maybe` (phase 2) |
| `tied(a, b, type)` | `yes` or `no` | the tie function; materialised edges | edges | built for type `xf:tie` |
| `divergence(believer, subject)` | `none`, `small`, `large`: `large` if any belief of the believer about the subject's `alive` or `affiliation` differs from the mirrored reading, `small` if another belief differs, else `none` | beliefs, readings | belief and reading Changes | built |
| `depth(node)` | `open` if the node's demand tier is 3 or finer, else `closed` | demand | frame Changes | built |
| `groupGap(group)` | `low` (`D` under 0.15), `mid` (under 0.25), `high`: the divergence of §7.8, the hypocrisy seed's material | `group.decide` digest | | built |

The names of the four heat bands are S1's registry strings. S2's text ("quiet, simmering, hot") is an example, and S2 treats band names as registered strings (§16, S2-1).

### 9.2 Registries for S3

- **`producers(kind)`** and `eventKind(name) → { tags, producers }`: the event-kind registry of §5, with each kind's producers (process ids, policy names, `s2`, `port`). A pattern naming a kind that nothing produces is refused by S3 at load.
- **`isSpine(node)`** (§4.4).
- **`aesthetic(node, feature)`**: `undefined` for every feature in M3. The feature library is S4's. S3's `T_aes` is then 0.
- S1's policies ignore `meta:` kinds (S3-I-14).

### 9.3 Hooks for the kernel

`onWitness` (§8.6), `onSocial` (§8.7), `onTick` (`fade`, §8.8), `aggregate` with the S0 contract `{ value, mass, items }` (§8.9), the conflict table (§8.5), the perception policy (§8.6), and the process registrations with `coarseFine` (§7.0). `onRecall`, `Widen` and the sweep are not built.

### 9.4 For S7, P8, P9 and P10

- **S7: perspective reads.** Read-only views over the belief and event records: `commonGround(a, b)` (the beliefs both hold with equal values, the events both witnessed, the events both were told, as event `Id`s); `witnessed(a)` (the `Id`s of events behind `observed` beliefs of `a`) and `told(a)` (behind `told` beliefs), so that text is limited to what a speaker could know; `reportability(kind)` (`{ frequency: p_kind, welfare: severity }`); and `intent(person, t)` for **focal people only**: the top active goal frame by pull, its current step, and the goal it serves, read from frames and stored nowhere. Every event keeps `causes`, `served`, `witnesses`, `place` and `outcome`.
- **P8: realisation candidates.** `candidates(kind, place, period)` returns the matching `RealisationRow` (§5.5) with a cause on each; the default is `none`.
- **P9 and P10: the evidence.** The decision log (§2.3); the pattern register (each process's patterns with ID, source, scale, band, tolerance and whether it was used to calibrate, §14.3); per-process counters (`EventsState.counters`, calendar sizes, ring size, units used per run); and the **why chain** `why(event)`: the cause chain of a minted event, by `causes` and the ring's parent links, to an immigrant or an authored cause in **at most four links** (M14-24).

### 9.5 What S1 reads from S2 and S3

S2 owes S1 the live casts (`core:cast` edges from live seeds, which are the protected set) and V's accepted offers and responses as observed events. S3 owes S1 the stated rule that S3 never reads inside S1's private state, and later the `memorable` rule for returns. S1 reads nothing of the director's beliefs about V.

## 10. Tiers, demand and catch-up

### 10.1 What each tier holds

| Tier | Scope | What S1 holds there | Runs |
|---|---|---|---|
| 0 | City | Shapes, regimes, the m4 gate, group labels, citywide rates, tables | Everywhere, always, and catches up |
| 1 | District | The joint tables, rates, hot lists and bands, stocks, norm slots, labels, group drives | Everywhere, always, and catches up |
| 2 | Cell or block | Residents as a count, households as a table, foci rosters, summaries, the pending calendar | Everywhere, always, and catches up |
| 3 | Scene | The persons present, opened; the summary items in focus as events | Only where demand reaches. Never catches up |
| 4 | Individual | One person's spells, ties by layer, beliefs, frames | Only where demand reaches. Never catches up |
| 5 | Fine detail | The game's | The game |

A fact is refined between tiers by the kernel's ordinary open, with the coarse value constraining the fine:

| Thing | Tier 0 or 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| An incident | a rate per kind | a count in a cell's summary | an item with time, place, size | participants, their acts and beliefs |
| A resident | the joint table | a headcount and a household table | a drawn person consistent with the slot | spells, ties, drive frames, beliefs |
| A norm | district `priv`, `beh`, `perc` | | who would enforce, who is watching | a person's thresholds |
| Reputation | a label per audience and axis | the carriers a block has | who knows V's acts | a person's own items |
| A drive | group urgency from books and board | default urgency by schedule | urgency from observed facts | concerns, goals, steps |

### 10.2 Demand

The roots are V, the director and live seeds. V's frames come from `v.frames` (§8.2). A root's focus reaches a node at a tier, and a node's demand tier is the highest among the active or blocked frames focusing on it or its owner chain. Fine-tier processes run only at boundaries that demand covered, judged from recorded history. When V arrives, fine state is generated from the coarse state, consistent with the pins. **Demand never changes a coarse process's output** (S1-I-5): no process of tier 0 to 2 reads demand, V's position or `gameOwnedNow`.

### 10.3 Catch-up and the city's reply to V

After an absence the coarse tiers replay every missed boundary in order, each within the hard limits, and read no demand. **When the work exceeds the budget, S1 lags and does not change a period.** The kernel stops between boundaries and resumes, and reads during catch-up answer as of the last processed boundary, flagged `catchingUp`. A period fixed per lineage keeps history identical on every machine. A jump reads the game's clock and is a session input, never a draw key.

V's act at time `t` in window `k` is applied at the boundary ending `k`, first processed in window `k + 1`, and its earliest child is due at `k + 2`: 10 to 20 minutes at the default window, and the delay bins make most answers slower.

### 10.4 Budgets

These are **targets for P7**, not measurements. P7 measures a simulated session and sets the numbers. The first implementation is the TypeScript reference model; hot loops may move to the native core through `bun:ffi` after measuring, with the TypeScript version as the oracle (D-05, D-06). Every figure is **[tunable]**.

| Item | Native core | TypeScript reference |
|---|---|---|
| An hourly boundary, all S1 processes, whole city, steady state | 5 ms | 100 ms |
| A window boundary with nothing due | 0.2 ms | 5 ms |
| Catch-up of one game night (24 hourly runs) | 150 ms | 3 s |
| Catch-up of 30 game days (720 runs), in the companion | 4 s | 60 s |
| Opening a scene (tier 3, one cell, up to 60 persons) | 5 ms | 50 ms |
| Opening one person (tier 4) | 1 ms | 10 ms |
| `aggregate`, cached by revision and `t` | 20 µs | 200 µs |
| `tie(a, b)` | 50 units | 50 units |
| `neighbours` | hard cap 5,000 units per call | |
| A concern generator per relevance emission | 500 units | 500 units |
| S1's share of one hourly run | 40,000 allowance units | 40,000 |
| World index load | 300 ms | 1 s |
| Replay from the nearest snapshot on load | 1 s | 10 s |

| Memory and size | Target |
|---|---|
| S1 resident set, whole city, native / TypeScript | 24 MB / 120 MB |
| Pending calendar | At most 256 per district; about 500 citywide in steady state |
| Ring | Seven game days; 5 MB cap |
| Hot list | At most 64 live cells per district |
| Open persons | At most 300 at once (V's scene and the focal set), each with at most 40 memorable beliefs |
| Ledger | At most 32 items per (subject, axis, carrier); at most 100,000 in all |
| Change stream | About 10 per game hour from `city.events`; about 10 more social ones outside focus |
| S1's part of a save | A process snapshot of at most 2 MB; growth of at most 100 KB per game day of continuous play |

The expensive part of the city is the one-off world-index build, which is static data. The per-window work is the drawn counts, the due children and the hot-list refresh. Every process reports `units(run)`, the allowance units it consumed, in its counters.

## 11. Persistence and reload

**What S1 persists, and what regenerates.**

| Persisted | Regenerates, identically |
|---|---|
| `ProcessState` of each process (§7): calendar, ring, bands, stocks, norm slots, regime data, recipe versions, labels, group state, and each process's **outstanding batches** | Residents, households, spells, traits, names |
| The S1 record: goals, pressure accounts, tie bookkeeping, dirty list, the decision log | Implicit ties, routines, `where`, the persistent hot list (from `ε`) |
| State pins on temporal slots, and `committed` or `observed` pins | Urgency and importance (derives); quality and currency of ties |
| Materialised ties and memberships (edges); regard edges | Unobserved beliefs; the opened items of a scene |
| Memorable beliefs; carriers' retained items | Events that are not canon (re-minted from the ring); items of a summary, from its descriptor |
| Frames of demand roots and live seeds, with ancestors | Frames of everyone else |
| `SettingsSet` ops in force | |

**Reload.** Outstanding batches are state: restored on load under a new epoch, then applied at their boundary **without re-running the process**. A cascade saved mid-way and reloaded under another epoch, play clock and wall clock has the same future (S0 F-22, SF1-E2). Loading is replacement ([S0 §14.3](kernel.md#143-loading-is-replacement)); S1 has no rollback logic, and no function reads the load. After a load, `reconcile` runs from the readings the game's state produces (§8.12).

**Packs.** A pack update that changes a kind registry mid-lineage uses S2's policy `continue`: in-flight children keep their kinds and new draws use the new registry under its version. The people tables of a district that changes their structure are re-drawn (a continuation that re-draws the district's unobserved residents).

**Twin runs** compare coarse against fine for each process's `coarseFine`, over at least 20 world seeds and several vantage pairs (S23-P9-06).

## 12. The honesty audits

Static audits run at every build, over S1's registry, its declared read sets and its packs. They report to P9. Each has a fixture (SF1-Q-n). Zero findings is the pass.

| Audit | Checks |
|---|---|
| **V-exclusion** | No S1 function emits a harmful effect (`harm`, `kill`, `take`, `expose`) or a victim or target role naming V; the gate backs it at run time (§6). No S1 function writes a pin, contribution or belief on a drive of V, or any slot of `v` except through the mirror |
| **Firewall** | The declared read set of every S1 registry function excludes the director's beliefs about V and any orientation or bond evidence ([S12-P5-11](../craft/d12-player-model-trust.md)) |
| **No load reads** | No S1 function reads the load class, a load count, the epoch, the play clock or the wall clock |
| **Coarse independence** | No process of tier 0 to 2 reads `gameOwnedNow`, V's position, V's cell, or demand |
| **`meta:` is inert** | S1 policies ignore `meta:` kinds and events whose creator is the director |
| **Source lint** | Attributes that feed drive importance or urgency come only from affiliation shares, ethos, circumstance and spells. The age prior is a modifier on importance, never a gate. Heritage, gender and name origin are never inputs ([DRV-11](../craft/d01-motivation-drives.md); [S15-S1-06](../craft/d15-people-networks-order.md)). The audit lists every slot a derive reads |
| **Kind listings** | Every event kind has producers, a carrier, a duration and a content-class listing (§5.1) |
| **One writer** | No two processes write one (node, slot), mint one node family or write one edge type (§2.1) |
| **Keys** | Every draw is in the key registry (§1.5); none names the epoch, a load count or a clock |
| **Arithmetic** | No `exp`, `pow`, `Math.log`, gamma or fused multiply-add in any decision. Only the functions of §1.2 |
| **Forbidden policy** | No S1 function schedules offers for retention, loses a tie by absence alone, or applies a guilt or streak effect; no S1 function produces intimate scene content |
| **The representation audit** | Over sampled populations, tabulate who is cast as offender, informer or victim, and openness, bid rates and loyalty, by every tag, and count authored relationship rules per kind. It runs on the first S1 population, to set thresholds from data, and reports to dossier 18 (M15-27, M18-06 to M18-10) |

## 13. Invariants

These are S1's own, beside the kernel's I-1 to I-16 and the drive fixtures D-a to D-n.

| # | Invariant |
|---|---|
| S1-I-1 | **Keyed.** Every S1 draw is in the key registry. No key reads the epoch, a load count, the play clock or the wall clock. The same inputs give identical S1 results in every implementation |
| S1-I-2 | **Arithmetic.** Only the operations and table functions of §1.2. No fused multiply-add. Loops and sums in the order written |
| S1-I-3 | **Partition independence.** Given the same timestamped external operations and the same demand history, no S1 process's history, digest or state depends on how ticks fell. Windows are computed one at a time |
| S1-I-4 | **Session independence.** No S1 policy reads a load, a quit, the wall clock or the load class. `fade` reads only the boundary's game time |
| S1-I-5 | **Demand independence.** The output of every process of tier 0 to 2 is the same whatever V's position, V's attention and the demand history |
| S1-I-6 | **No two see each other.** A process reads other processes only through digests as of the snapshot, and never its own earlier output within a span |
| S1-I-7 | **One writer.** Each state slot, node family and edge type has one writer (§2.2) |
| S1-I-8 | **V is never aimed at, never modelled.** No S1 output names V as a harmed party; no S1 state holds a model of V's feelings, desire or drives. The gate backs it (§6) |
| S1-I-9 | **The gate is the only door.** Every new occurrence the simulation produces passes `produce`. Mirrored and replayed events are exempt and never re-filtered |
| S1-I-10 | **Counts agree.** A summary's count equals its items at every scope; items nest across scopes with the same `Id`s; opening an item adds nothing to any count |
| S1-I-11 | **Causes precede effects.** A child's time is at least one window after its parent's. A derived mirror event has the time of its raw cause. Every minted event's cause chain reaches an immigrant or an authored cause in at most four links |
| S1-I-12 | **Bounded state.** The calendar holds at most 256 per district, the ring seven days, a hot list 64 cells, a ledger item set 32 per (subject, axis, carrier), a person 20 materialised ties and 40 memorable beliefs, a scene 60 persons and 20 acts an hour |
| S1-I-13 | **Evidence independence.** A chain of tellings from one origin weighs as the origin; independent items add; an absence changes no label |
| S1-I-14 | **The tie function.** Symmetric; the same after any reload and any tick partition; reads no reputation ledger; no V regard record exists |
| S1-I-15 | **One belief per question,** and a telling's listener holds the teller's `evidence` unchanged |
| S1-I-16 | **Fade keeps the floor.** A belief is dropped only after the hold, never if memorable, never if V returned to it; a stricter run never drops what a more generous one keeps |
| S1-I-17 | **Game truth wins.** No S1 process writes a mirrored slot of a mirrored node; `reconcile` ends only what the game now contradicts; beliefs and history are left |
| S1-I-18 | **The floors.** No minor, unclassified or real person in the roles `aggressor`, `victim`, `target` or `hostile`; no sexual tag; no protected person chosen by a harm effect |
| S1-I-19 | **Regeneration.** A forgotten resident, household, spell, item or scene resolves identically while the recipe version, the pins and the contributions are unchanged. Observed pins persist |
| S1-I-20 | **Urgency is derived.** No process writes a pin on a derived slot; urgency, importance, quality and currency are functions of facts and time |
| S1-I-21 | **Reload.** A save at any boundary, loaded under any epoch, play clock and wall clock, has the same future (S0 F-22). Outstanding batches apply without re-running |
| S1-I-22 | **Static coverage.** `gameCoverage` is a static function of the index; `gameOwnedNow` is read only by realisation and `scene.acts` |
| S1-I-23 | **Policy state is plain data** in `ProcessState` and the S1 record, versioned with the process, and no policy keeps state anywhere else |
| S1-I-24 | **Mirrored events are told by their creator.** A derived event's creator is `proc(city.mirror)`, its cause its raw event; a simulated event's creator is a process or `s1` |

## 14. Fixtures

Every fixture uses `worldSeed = H("fixture", <fixture id>)`, `W = 600`, the schema pack `xf.core.world@1` with the kernel's core schema plus S0 §20, S2's core and S3's `Layer3Data` where a layer above is needed, and `S1Data` at its defaults, **except** where a fixture says otherwise. Unit fixtures use the slice `FX-3` (§3.2) with `data.events.flatPropensity = true` unless they name a propensity override, `data.ties.cGeo = 4` (FX-3 has 90 residents and `H₉₀ = 5.0826`, so the default 8 would exceed it), and `cityScale = 1`. As in S0, outcomes that depend on hashes are checked as **properties**, not numbers. Numbers given here do not depend on a hash.

P3's twelve fixtures S1-F-1 to S1-F-12 run as: SF1-M-5 (S1-F-1), SF1-I-14 (S1-F-2), SF1-M-6 (S1-F-3), SF1-X-1 to SF1-X-3 (S1-F-4), SF1-M-3 (S1-F-5), SF1-M-4 (S1-F-6), SF1-P-7 (S1-F-7), SF1-H-1 and SF1-H-2 (S1-F-8), SF1-W-5 (S1-F-9), SF1-W-7 (S1-F-10), SF1-Q-1 (S1-F-11) and SF1-S-6 (S1-F-12). Dossier 1's drive fixtures D-a to D-n run as SF1-D-a to SF1-D-n. The kernel's F-1 to F-25 hold for S1's processes where they apply (F-7, F-9, F-13, F-21, F-22, F-24, F-25 by name below).

### 14.1 Unit fixtures

**Arithmetic and tables (SF1-H).**

| # | Setup | Expected |
|---|---|---|
| SF1-H-1 | **`exptab`.** Evaluate the table and the function | `T[256] = 1`, `T[240] = 0.36787944117144233`, `T[0] = 1.1253517471925912e-7`, `T[320] = 54.598150033144236`. `exptab(0) = 1`, `exptab(−0.5) = 0.6065306597126334`, `exptab(−0.53) = 0.5888916989214128`, `exptab(−16/18) = 0.4112494879003506`. Inputs below −16 or above 4 clamp: `exptab(−17) = T[0]`, `exptab(5) = T[320]`. In two implementations, bit-identical (S1-F-8) |
| SF1-H-2 | **Error and `pow`.** Midpoints of all 320 cells; `powTab(2, 0.5)` | Maximum relative error 0.0488 %, under 0.05 %. `powTab(2, 0.5) = 1.4148972265482154`, 0.0483 % above √2 (S1-F-8) |
| SF1-H-3 | **`invCum`.** Weights `[1, 2, 3, 0]`; `u` = 0.1, 0.5, 0.999; weights all zero; a `u` whose product rounds to the total | 0, 2, 2 (`u = 0.5` gives target 3, and `3 < 3` is false); the all-zero table returns 0; the rounding case returns the last index with a positive weight (2) |
| SF1-H-4 | **`spacingCount`.** `draw = [0.5, 0.7, 0.9, 0.2, 0.9]`; `μ = 1` and `μ = 2.5`; `μ = 100` with every draw 0.99; `splitCount(100)` | `−ln` of the draws: 0.6931, 0.3567, 0.1054, 1.6094. `μ = 1`: partial sums 0.6931, 1.0498 → count 1. `μ = 2.5`: 0.6931, 1.0498, 1.1552, 2.7646 → 3. `μ = 100` stops at the cap, 64. `splitCount(100)` uses 4 parts of 25 |
| SF1-H-5 | **`nbCount`.** `n = 0.45`, `k = 0.3`; `u` = 0.5, 0.8, 0.9, 0.9995; and `n = 0.25` | `p₀ = 0.76001`, cumulative 0.76001, 0.89681, 0.95017, …, 0.99824 at 7. `u` gives 0, 1, 2, 8. For `n = 0.25`, `p₀ = 0.8339`: 83 % no children |
| SF1-H-6 | **The tables.** `normtab@1`, `lqtab@1` | `Z[i] = −Z[4095 − i]`; `Z[0] = −3.66832928512`; `LQ` has mean 1 to 1e-12; its top 5 % of entries hold 0.479 of the mass and the top 1.25 % hold 0.256 |
| SF1-H-7 | **`q64`.** 0.5, 0.5078125, 0.99 | 0.5, 0.515625 (a half rounds up), 0.984375 (`floor(63.86) / 64`) |
| SF1-H-8 | **No fused multiply-add.** `0.1 × 10 + (−1)` evaluated by `a × b + c` | Exactly 0. A fused implementation gives 5.55e-17 and fails |
| SF1-H-9 | **`procRand` is window-keyed.** Draw for window 7 from a run starting at `k = 0` and from one starting at `k = 6` (n = 6) | Equal |

**Shapes, regimes and the gate on size 4 (SF1-S).**

| # | Setup | Expected |
|---|---|---|
| SF1-S-1 | **Mean-one shapes.** Every city kind | `Σ shape(k, t)` over the 168 hours of a week is 168 to 1e-12 |
| SF1-S-2 | **Theft.** Hour shape `0.8·1.0·1.2·0.9`, flat day | `M = 0.975`; at period D, `shape = 1.0256410` |
| SF1-S-3 | **Shakedown's pulse.** Hour shape `0.5·1.5·1.0·0.2`; Friday 10 to 16 ×3 | `M = 0.8833333`; `shape(Fri 12:00) = 5.0943396`; `shape(Mon 12:00) = 1.6981132` |
| SF1-S-4 | **Regimes.** 20 seeds, 30 game days, FX-3, rate 0.03 a day | Arrivals within three standard deviations of 0.9; no regime ends before `plannedEnd`; every regime is gone by `maxDwell`; one live regime of a kind per district |
| SF1-S-5 | **The m4 gate.** `m4Times` = [100, 600] | `open = max(600 + 432, 100 + 1008) = 1108`. A size-4 occurrence at window 1107 is refused (`budget-m4`); at 1108 it passes. With one time [100], `open = 532` |
| SF1-S-6 | **Two processes in one span** (S1-F-12). `city.shape` and `city.events` in one span, and with `city.events` run in a version that mints nothing | `city.shape`'s digest, state and pins are identical: neither's output depends on the other's within the span. The one-span lag is the only coupling |

**Incidents (SF1-I).** `FX-3` with the propensity override `L = (c1: 3.0, c2: 1.0, c3: 0.5)` where a fixture needs it.

| # | Setup | Expected |
|---|---|---|
| SF1-I-1 | **The mean.** Theft, m1, Wednesday 12:00, `L = 1` | `share = 3.5 / 35 = 0.1`; `μ = 90 × 1.0256410 × 0.1 × (600 / 86400) = 0.0641026`. Gang-clash at the same time: coverage 0.5 at `c2` gives `aD = 1 + 1 + 0.5 = 2.5`, `cityTotal = 34`, `share = 0.0735294` |
| SF1-I-2 | **Scopes.** Theft, with the override | Persistent hot list `{c1}` (`hotCount = min(64, max(1, ceil(0.75))) = 1`). Scope list `[c1, remainder]` with weights 3.0 and `2.0 + 0.25 = 2.25` (`c2` and `c3`): shares 0.5714, 0.4286 |
| SF1-I-3 | **Ids are keyed.** An event of window `w`, district `d`, kind `k`, index `i`, in two runs with different ticks | The same `Id` `H("mint", proc, proc, "ev/<w>/<d>/<k>/<i>")` |
| SF1-I-4 | **Offspring.** An m2 `gang-clash` parent | `n = 0.30 × 1 × 1 × 1 = 0.30`; the count by `nbCount(0.30, 0.3, u)` in 0 to 8; every child is due at least one window after the parent; every child `Id` is `H("mint", proc, parent, "child/<index>")` |
| SF1-I-5 | **Causality.** 20 seeds, 30 game days | Every child's time is at least `W` after its parent's; no cause follows its effect |
| SF1-I-6 | **Matrix with a line.** `harm.groups` at ceiling 0 (only `gang-clash` lists it) | `gang-clash` has `μ = 0` and no offspring; every matrix row that had a `gang-clash` entry loses it and is renormalised (the `disorder` and `psycho-break` rows have none and are unchanged) |
| SF1-I-7 | **The calendar.** Insert 300 children in one district | Order `(due, parent, index)`; 256 remain; the lowest-size, largest-`Id` entries went first; `calendar-overflow` is logged once per overflow |
| SF1-I-8 | **Thinning.** A child with `modBirth = 1.0`, `regimeMod` now 0.5 | `ratio = 0.5`; it fires exactly when `rand("thin", parent, index) < 0.5`; the same on every replay |
| SF1-I-9 | **Heat and bands.** One isolated m2 event at window `w` in a cell with no neighbours of consequence, offspring off (`data.events.offspring.n = 0`) | Heat 3.0 at `w` (elevated, since 3.0 ≥ 2.0); 2.1 at age 36; `3 × 0.4 = 1.2000000000000002` from age 37 (not below the leave threshold 1.2, so it stays elevated); 0.45 at age 145. The band pin `quiet` is written at window `w + 145` (dwell satisfied at 144) and no earlier. Live-hot from `w` to `w + 144`, out at 145 |
| SF1-I-10 | **Dwell.** A second m2 at `w + 10` | The band stays elevated; no pin is written inside the dwell; at `w + 144` it may rise |
| SF1-I-11 | **Summary and item agreement** (M14-16). 100 windows | For every summary: the count equals the items enumerated; items nest across scopes with the same `Id`s (S0 F-7); canon items persist |
| SF1-I-12 | **The ring.** 10 game days | Descriptors older than 1,008 windows are gone; a summary or an event within 7 days re-mints under its `Id` with the same items; a `why` chain from a child reaches an immigrant in at most four links |
| SF1-I-13 | **The gate's budget.** More than 8 size-2-or-above occurrences in one district and window | The ninth is refused `cap-window` |
| SF1-I-14 | **Demand independence** (S1-F-2, M14-20). Two runs with V in different cells; one with `gameOwnedNow` toggled | Identical tier 0 to 2 states, digests, pins and events. Coverage lowers the rate in a covered cell for every run (`gang-clash` at `c2`) |
| SF1-I-15 | **Game cover.** A pending `gang-clash` child at `c2` due at window 160; a mirrored `gang-clash` at `c2` covered at window 156 | The child is thinned at 160 with reason `game-covers`, logged as a correction. A pending `theft` child at `c2` and a `gang-clash` child at `c3` (two steps away) fire as usual |
| SF1-I-16 | **Reports.** `E = Y = 0.5`, `fear = 0.2`, `noSnitch = 0.4`, `r0 = 0.7`, witness bonus 3 | `reportChance = 0.7 × 0.5 × 0.75 × 0.8 × 0.6 × 1.3 = 0.1638`. A `police-action` child exists only if `rand("report", parent, index) < 0.1638` |

**The mirror (SF1-M).**

| # | Setup | Expected |
|---|---|---|
| SF1-M-1 | **The table.** One raw event of each row of §7.3 | The derived kind, size, participants and effects as the table says; `game.combat.end` and `game.district` give none; `game.heat.2` after `lastHeat = 3` gives none and sets `lastHeat = 2` |
| SF1-M-2 | **Creator, cause and time.** A raw death | The derived event's creator is `proc(city.mirror)`, `causes` is `[raw]`, `time` is the raw time, its `Id` is `H("mint", proc(city.mirror), raw, "mir")`; a mirrored event is told from a simulated one by its creator |
| SF1-M-3 | **A raw death** (S1-F-5). Save before and after | One derived event with the raw event as cause, exempt from the gate (a minor victim is still mirrored), identical after a reload |
| SF1-M-4 | **Partition** (S1-F-6). 12 ticks and one | Identical derived events, digest and state |
| SF1-M-5 | **A mirrored person dies** (S1-F-1). Frames and a membership and a tie of person `mv`; the reading `alive` goes to `no` | The frames are `abandoned` (cause: the reading's change); the membership and tie edges are ended; the beliefs about `mv` stand; one correction `game-dead` is logged |
| SF1-M-6 | **An older save** (S1-F-3). Load a save from before the death, with the game's state after it | The record before the death is intact. `reconcile` runs from the readings the game's state produces and supersedes only what the game now contradicts (the frames and edges of `mv`); nothing else changes |
| SF1-M-7 | **The cap.** 20 raw deaths in one window | 12 derived events; 8 `cap-hit` logged; the raw events remain |
| SF1-M-8 | **Late raw.** A raw event stamped three windows before it was applied | Processed once; `late-raw` logged |

**People and ties (SF1-P, SF1-T).**

| # | Setup | Expected |
|---|---|---|
| SF1-P-1 | **IPF by hand.** Seed `[[2,1],[1,2]]`, rows `[0.7, 0.3]`, columns `[0.4, 0.6]`, 20 iterations | `[[0.34213, 0.35787], [0.05787, 0.24213]]`; the column marginals are exact and the row marginals within 1e-9 |
| SF1-P-2 | **The floor.** A cell the seed makes impossible | Its value is `2⁻³⁰` before normalising; the table sums to 1 |
| SF1-P-3 | **A district fit.** FX-3 marginals | After 20 iterations every marginal is within 1e-9; `w = t / max(t)` has maximum 1; the household table has 60 cells |
| SF1-P-4 | **Refit.** A change of 0.03 in the age marginal at window 100 | No refit before 144 (the initial fit is at 0); at 144, version 1; a second change at 200 waits until 288. The old contributions end; the new begin at the next window; observed residents stay pinned |
| SF1-P-5 | **Rosters.** 10,000 sampled households | `none` for `j ≥ size`; no `family` child within one age band of member 0 or older; `crew` houses share an affiliation; `couple` members within one age band |
| SF1-P-6 | **Residents are regenerated.** Resolve 50 residents, forget the block, resolve again, reload, resolve | Identical profiles, ages, traits, names, drive-states |
| SF1-P-7 | **Binding** (S1-F-7). One key across a reload | The same resident; an `observed` pin persists; a casting type with `isChild` gives `fallback` and a `bind-fallback` defect |
| SF1-P-8 | **Spells.** Work track, age band 3 | `spellLen` for `q = 0` is 12,096,000 s (140 d) and for `q = 15` 120,960,000 s (1,400 d); a walk to day 20 and to day 2,000 takes at most 64 steps and is identical after a reload |
| SF1-P-9 | **`where`.** A protected resident; a resident in an `ill` health spell; a jump of 30 days and 4,320 ticks | The protected resident is never `away`; the ill one is `away` with cause `ill`; the answers are identical under the jump and the ticks |
| SF1-T-1 | **Symmetry.** 10,000 pairs of FX-3 | `tie(a, b) = tie(b, a)`; the same after a reload and under any tick partition |
| SF1-T-2 | **The numbers.** `N = 90`, `cGeo = 4`, rank 10 | `pGeo(a→b) = 4 / (5.0825706 × 10) = 0.0787003`; two members of one household: `p = 1` and always tied; two crew-cell members with no other focus: `p = 1 − (1 − pg) × 0.7` |
| SF1-T-3 | **Neighbours.** Layer caps 5, 15, 50, 150 | Inner (household) first, then middle, then outer; at most the cap; deterministic; at most 5,000 units; the same after a reload |
| SF1-T-4 | **No ledger input.** Perturb every reputation item | No tie changes |
| SF1-T-5 | **Materialisation.** A person with 20 materialised ties, one more observed by V | The weakest edge that no V contact, live frame or memorable belief depends on is ended; the new edge's `Id` is `H("edge", "xf:tie", lo, hi)` |
| SF1-T-6 | **Borrowed results.** 1,000 sampled ties | Over 1,000 reunions after 3 × `maxInterval` with no intervening harm, 100 % are warm, and cool only with harm or an overdue commitment. The share with a surfaced moment, the share of declines that continue as friendships, and bids per tie per week (phase 2) are computed and reported, not asserted |
| SF1-T-7 | **Acceptance.** Rung `friendly`, `warmth = 0.3`, `trustMean = 0.6`, `sociability = 0.5` | `pAccept = 0.5 + 0.12 + 0.03 + 0 = 0.65`. A boundary pin refuses without a draw. The draw `rand("accept", tie, event)` is the same after a reload |
| SF1-T-8 | **Replies.** No answer, with and without a chance to answer | Without a chance: not recorded, no effect. With a chance: a `decline` at half effect, `warmth −0.005` |
| SF1-T-9 | **No V regard.** Audit | No `xf:regard` edge has V as the `from` end; no slot of S1 holds V's feelings or desire |

**Norms, stocks and the ledger (SF1-N, SF1-O, SF1-L).** Norm slots use the two default norms; thresholds as §7.5.

| # | Setup | Expected |
|---|---|---|
| SF1-N-1 | **A window's update.** `beh = 0.5`, `perc = 0.8`, `priv = 0.7`, no recent enforcement (`vis = 0`), `η = 0.058`. (a) no signal; (b) a public signal of 0.9 in this window (`φ = 0.6`) | (a) `beh = 0.625`, `perc = 0.78985`. (b) `beh = 0.625`, `qe = 0.79`, `perc = 0.79942`. The relaxation settles in two passes |
| SF1-N-2 | **Gap bands.** `gap` = 0.31, 0.27, 0.24, 0.09, 0.07 in turn | `wide` (2), `wide`, `gap` (1), `gap`, `aligned` (0). A pin is written only at 0.31, 0.24 and 0.07 |
| SF1-N-3 | **Enforcement.** `fee`, `beh = 0.875`, enforcer share 0.10 | `μ = 3 × (600 / 86400) × 0.125 × 1 = 0.0026042`; each use is an `enforcement` event through the gate; a rung whose class is at ceiling 0 is never drawn |
| SF1-N-4 | **Public against private** (S0 F-25). Run 12 windows with one public enforcement event, with one private (witnesses under 5), and with none, each as one tick and as 12 | The private run equals the none run exactly; the public run differs; each is identical as one tick and as 12 |
| SF1-O-1 | **Each row once.** One public `enforcement`, one answered incident, one unanswered public incident, one m2 shakedown in the previous span | The first window of the run applies the four rows' `dE`, `dY`, `dL` once; the next five windows apply none |
| SF1-O-2 | **Retention.** No events for 30 game days | `E`, `Y`, `L` stay at their baselines; after a +0.01 shock `E` decays back with factor 0.9966 a window |
| SF1-O-3 | **Bounds and partition.** A soak of 100 game days, one tick and many | Stocks in 0 to 1; identical histories |
| SF1-L-1 | **The worked trace** (S0 F-24). Axis `reliable`, reach 1, `λ = 0.9`, items +0.5, +0.5, −1.2, −0.8, −0.8 (each with weight 1) | `(r, s, E, mass)`: `(0.5, 0, 0.6, 0.5)` unknown; `(0.95, 0, 0.661, 0.95)` unknown; `(0.855, 1.2, 0.4575, 2.055)` mid; (30 game days with no events: unchanged); `(0.7695, 1.88, 0.3806, 2.6495)` low; `(0.6925, 2.492, 0.3265, 3.1845)` low |
| SF1-L-2 | **A chain adds nothing.** A tells B tells C; then A tells C | C's belief has `evidence = {E}`; the carrier's mass is that of the origin; the second telling refreshes |
| SF1-L-3 | **Absence.** A label, then 30 game days, then another 30 | No label changes; `aggregate` reads no clock |
| SF1-L-4 | **Displacement.** From step 3 of SF1-L-1, one independent contrary item | The label moves from `mid` to `low` |
| SF1-L-5 | **Aggregate against residents** (M15-18). 200 sampled residents with `knows` over `reach` | The mean of their own `r` and `s` is within sampling error and 0.1 of the aggregate's |
| SF1-L-6 | **The cap.** 33 items for one (subject, axis, carrier) | The item with the lowest `(memorable, |v| × salienceWeight)`, then the oldest, then the lower `Id` is evicted; its index is reused; paths stay unique (I-9) |

**Groups and the drive fixtures (SF1-G, SF1-D).**

| # | Setup | Expected |
|---|---|---|
| SF1-G-1 | **Operative weights.** The Claws' 12 drives, ethos treasury 2, reputation 1.5, succession 1.5, `U = 0.2` for all, leaders equal | `ethosN(treasury) = 0.142857`; `W(treasury) = 0.4 × 0.142857 + 0.05 = 0.107143`; `Σ W = 1`; divergence `D = 0.0642857` |
| SF1-G-2 | **Books.** `cash 9,000`, `burn 300`, `income 330` | Runway 30 days, treasury `U = 0`. With `income 0`, after 15 days `cash = 4,500`, runway 15, `U = 0.5` |
| SF1-G-3 | **Retribution.** A victim event of size 2 | Latched pulse `0.8 × 0.6 = 0.48`; held at `0.24` until released; released by retaliation, not by time |
| SF1-G-4 | **The hazard.** `h0 = 0.02`; a public harm | `hazard = 0.02 × 1.5 = 0.03`; the check draws `procRand(w, "retal", group, rival)` |
| SF1-G-5 | **Orders.** A runner (prestige 0), strength 0.5, exit cost 0.6 | `pressure = 0.3 + 0.2 + 0.18 = 0.68`; orders only to members in `demanded(3 or 4)`, at most 3 a window; none otherwise |
| SF1-G-6 | **Boosts.** `collect-payment` active | `boost[d][f]["shakedown"] = +1.0`; `groupMod = 1 + offenderShare × 1.0`; clamped to at least 0.5 |
| SF1-G-7 | **Partition.** 12 windows as one tick and 12 | Identical group state and digest |
| SF1-D-a | **Rest** (D-a). `R(τ = 18 h)`, no sleep | `U = 0.58875` at 16 h, 0.73629 at 24 h, 0.86466 at 36 h; 8 h sleep with `τ_s = 2 h` leaves `exptab(−4) = 0.01832`, under 0.02 |
| SF1-D-b | **Tick against jump** (D-b). 12 windows as one tick and 12 | Identical urgency histories. A slow drive does not stall at the 1/64 quantum |
| SF1-D-c | **The debt ladder** (D-c). A debt due at `T`, `D(κ = 4, τ_d = 3 d)` | `U(T − 3 d) = 0.2`, `U(T − 1 d) = 0.4286`, `U(T) = 1`; a `reminder` at `T + 1 d`, a `collector-visit` at `T + 3 d`, an `enforcement` at `T + 7 d`, each a matchable event (for a demanded debtor) |
| SF1-D-d | **Hysteresis** (D-d). A weight oscillating between 0.30 and 0.40 | One concern opens and one closes, not one per wobble |
| SF1-D-e | **Dithering** (D-e). Two equal goals | At most one switch per game hour (the persistence margin 0.15 and `LOI`) |
| SF1-D-f | **Multifinality** (D-f). 100 keyed decisions, all else equal | The means serving two active concerns is chosen in over 70 |
| SF1-D-g | **Cross-pressure** (D-g, S0 F-8). An order with a `kill` on a protected kinsman | One `Dilemma`; a `rescue` order gives none |
| SF1-D-h | **Threat pre-emption** (D-h). A threat at 20 m and a want of greater value at 80 m | The threat's frame outweighs it; reversed distances reverse it |
| SF1-D-i | **Reciprocity lag** (D-i). 200 favours of one size | Median lag 3 d within sampling error, log-normal spread, none zero |
| SF1-D-j | **Exit** (D-j). `strength` from `commitment`, satisfaction fixed | The weight of "run or leave" rises monotonically with alternatives and falls with investment |
| SF1-D-k | **Isolation** (D-k). `friendship`, `τ = 72 h`, 3 × `τ` without contact, relief pinned | `U = 0.9502`, frame weight `0.4826 ≥ 0.35`; the concern opens |
| SF1-D-l | **V not owned** (D-l). All the fixtures | No process writes a pin to V's drives; the director's belief changes with observed choices only |
| SF1-D-m | **Audit** (D-m). 5,000 sampled residents | No deviation of generated importance by any demographic tag beyond what role, circumstance and membership explain |
| SF1-D-n | **Protected facts** (D-n). `craving` at its highest weight | No goal of the actor kills an entity in the protected register |

**Witness, social and fade (SF1-W).**

| # | Setup | Expected |
|---|---|---|
| SF1-W-1 | **Salience.** A harm event with pulse 0.8, to a person with a tie to the observer, matching a `protects` frame | Points: stakes 1, pulse 1, tie 1, V mattered 0: salience 3, memorable |
| SF1-W-2 | **Attribution.** Neutral observer, no load. (a) no cause in `causes`; (b) a visible cause | (a) `wD = 0.65`, dispositional region, `confidence = q64(0.55) = 0.546875`. (b) `wD = 0.45`, situational, `confidence = q64(0.45) = 0.453125` |
| SF1-W-3 | **Telling.** `protectiveRelevance 0.8`, severity 0.7, closeness 0.6 | `score = 0.336`, `p_tell = 0.3 × 0.336 = 0.1008` |
| SF1-W-4 | **Operators.** 10,000 tellings | Shares of `level`, `sharpen`, `assimilate`, none within sampling error of 0.15, 0.10, 0.10, 0.65; none beyond hop 4 |
| SF1-W-5 | **Hearsay** (S1-F-9, S0 F-9). Alice observes `E`, tells Carl, Carl tells Dana; then Alice tells Dana | Dana's belief has `evidence = {E}`, `source.by = told` (teller Carl, the telling event); the second telling only refreshes it |
| SF1-W-6 | **The volume rule.** A telling between two unfocused people, about no one in a cast | No event is minted; the spread is coarse |
| SF1-W-7 | **Fade** (S1-F-10). A non-memorable belief refreshed at `t₀`; one memorable; the setting raised | Not dropped at `t₀ + 14 d` exactly; dropped at `+ 14 d + 1 s`; the memorable one kept; raising `memoryScale` changes nothing a stricter run dropped |
| SF1-W-8 | **No load reads** (S1-I-4). Perturb the epoch, the load count and the clocks | No S1 output changes |

**Concerns, goals and change (SF1-C).**

| # | Setup | Expected |
|---|---|---|
| SF1-C-1 | **Generators.** One change for each of O1 to O5 on a focal person | Each opens its concern with `origin` and `cause`; capacity 3; a fourth replaces the weakest only at 1.5 times its pull |
| SF1-C-2 | **The pick.** One concern, three means, decision window 500 | The same means after a reload and under any tick partition; changing only the epoch changes nothing; the keys name the decision window |
| SF1-C-3 | **Legitimate first.** A legal means that fails its capability gate and an illegal one that passes | The illegal one is a candidate only then |
| SF1-C-4 | **Dilemma.** Strategy weights 0.3, 0.3, 0.2, 0.2 with the first unavailable | `invCum` over `[0, 0.3, 0.2, 0.2]`; the draw is `rand("dil", …)`; "abandon one" drops the lower-pull frame |
| SF1-C-5 | **Change.** `stability` 0.8 (`θ = 3.9`); salience-3 events (`w = 1`) one by one; and `stability` 0.2 (`θ = 2.1`) | The stable NPC turns at the fourth, not before; the unstable at the third. Pressure citing evidence already counted adds nothing |
| SF1-C-6 | **Refusal.** A decision for the held view at 0.7 `θ` | A `refusal` event; the NPC unchanged |
| SF1-C-7 | **Rationalisation.** A move that would violate a protected frame of pull 0.6 | The view moves to the nearest that spares it; `n` rises; the next `θ` is `θ × 0.9`, floored |
| SF1-C-8 | **Canon.** A canon NPC under pressure | Only beliefs about V and ties with V change; no `turning` event unless an author declared a turn |

**The gate, the reads and the audits (SF1-X, SF1-R, SF1-Q).**

| # | Setup | Expected |
|---|---|---|
| SF1-X-1 | **A line** (S1-F-4). Class `harm.groups` at ceiling 0; 10,000 sampled events | Zero counts and zero children for every kind listing it; a person with no age class is never in a victim, target or hostile role |
| SF1-X-2 | **The floors.** Roles `aggressor`, `victim`, `target`, `hostile` | Only `adult` persons; a missing class is `minor`; a person marked real is refused; a sexual tag is refused |
| SF1-X-3 | **V.** 10,000 sampled events | V is never a victim or target; no effect `harm`, `kill`, `take` or `expose` names V |
| SF1-X-4 | **The protected set.** A person with a cast edge | Never chosen for a harm effect; never absent by `where` |
| SF1-X-5 | **Order of checks.** An occurrence failing three checks | The first in the order of §6 is the reason |
| SF1-R-1 | **The reads.** Each read of §9.1 before the first processed boundary, then after | `maybe`, then the answer; the unbuilt reads stay `maybe`; no read exposes a number |
| SF1-R-2 | **Bands.** Presence 0.0692 (the Claws), 0.0378, 0.0162 | `mid`, `mid`, `low` |
| SF1-Q-1 | **The audits** (S1-F-11). The registry and packs as shipped | Zero findings |
| SF1-Q-2 | **The audits catch.** A function using `Math.exp`; a key naming the epoch; a tier-1 process reading `gameOwnedNow`; two writers of one slot; a kind with V as a victim; a derive reading a heritage tag | Each is reported, and nothing else is |

**The fine tier (SF1-A).**

| # | Setup | Expected |
|---|---|---|
| SF1-A-1 | **Opening.** A focused cell with 3 m1 items in a window | Three events with cast people (adults), at most 12 witnesses, `outcome` `done`; the summary's count unchanged |
| SF1-A-2 | **The cap.** 30 items and routine acts in a scene in 6 windows | At most 20 opened; the rest stay unopened |
| SF1-A-3 | **Regeneration.** Open, forget, reload, open | Identical participants and witnesses |
| SF1-A-4 | **No catch-up.** Demand absent for 100 windows, then present | Nothing of the 100 windows is opened; coarse state is as if the scene had never been in focus |
| SF1-A-5 | **The gate.** A cast resolving to a minor in the role `victim` | The item stays unopened; `floor-minor` is logged |
| SF1-A-6 | **Routine acts.** A focal vendor at work | `serve` events with mean 4 an hour; none counted in any summary; the gate passes (no class) |

### 14.2 End-to-end fixtures

**SF1-E1. A Kabuki week, as one tick and as 7 × 144 ticks.** World seed `H("fixture", "SF1-E1")`; the slice `xf.kabuki.index@1` (the stand-in of §3.2 until W1 builds the real one); the packs of §0.2 at their defaults; V's mirrored cell `g1` from a replay script that holds only V's position and district readings; `settings` default. The script injects, at window 300, one public `enforcement` external event (place `g2`, 6 witnesses), and at window 400 one private one (3 witnesses). **Run A:** advance 1,008 windows in one call. **Run B:** 1,008 ticks of one window (7 × 144). **Run C:** seven daily ticks, with V's mirrored cell moved to `g9` in the replay script and the `demanded` set different. **Run D:** as A with a save and load at a random boundary on each of three days.

| Check | Expected |
|---|---|
| Records | The canonical encodings of every process state, digest, pin, edge, belief, minted event and summary, the S1 record and the decision log are byte-identical in A, B and D. In C the tier 0 to 2 parts are identical to A; only `scene.acts`' contributions differ (S1-I-3, S1-I-5, S1-I-21) |
| Volume | Total incidents in the week within three standard deviations of `351.8 × 0.04 × 7 ≈ 98.5`; those of size 2 and above within three of `51.8 × 0.04 × 7 ≈ 14.5`; no m4 closer than 432 windows to another |
| Agreement | Every summary's count equals its items; items nest; canon items persist (S1-I-10) |
| Causes | Every child is at least one window after its parent; every minted event reaches an immigrant in at most four links |
| Bands | No two band pins on one cell within 144 windows; the live hot list never exceeds `64 − |persistent|` |
| Bounds | The calendar never exceeds 256 per district; stocks and norm slots stay in 0 to 1; the ring is at most seven days |
| Norms | After window 300 the district's `perc` of `fee` differs from the run without the injected event; after window 400 the run with the private event equals the run without it |
| Floors | No participant of a role `aggressor`, `victim`, `target` or `hostile` is a minor, an unclassified person or V; no protected person is the object of a harm effect |
| Replay of reads | `band`, `normGap`, `priceLevel`, `regime` and `presence` answer at every window after the first processed boundary; the unbuilt reads answer `maybe` |

**SF1-E2. A save and reload in the middle of an aftershock cascade.** World seed `H("fixture", "SF1-E2")`; `FX-3`; every entry of `data.shape.rate` multiplied by 40 (`cityScale` stays 1, so the offspring means do not rise); `gang-clash`'s `offspringFactor` 1.3 (an m4 mean of 0.78, under the lint's 0.9); `flatPropensity`. **Run U:** advance 1,008 windows. The harness finds the first boundary `b* ≥ 200`, not a multiple of 6, at which the district's calendar holds at least three pending children, one of them due after the next span, with an outstanding batch of each process. **Run R:** run to `b*`, save, discard everything, load into a fresh process under a different epoch, play clock and wall clock, replay the external operations after `b*`, and run to 1,008. Then two further reloads at random boundaries.

| Check | Expected |
|---|---|
| Future | The records of R equal those of U: the same pending children fire with the same draws at the same cells and times; the same thinning; the same bands; the same decision log (S0 F-22, S1-I-21) |
| Batches | The outstanding batches are applied at their boundary without re-running the processes: the run counter of the span does not rise after the load |
| Replay | Events minted before `b*` are not re-minted; those within seven days re-mint from the ring under the same `Id`s |
| Independence | Perturbing the epoch, the play clock, the wall clock and the load count changes no byte (S1-I-1, S1-I-4) |

**SF1-E3. The mirror overriding a simulated value with a game reading.** World seed `H("fixture", "SF1-E3")`; the Kabuki stand-in. A mirrored vendor `mv` (affiliation `civilian`, `quest-linked` no, `alive` yes) in the market cell `v2`. At boundary 100, V speaks to `mv`: a step frame puts `mv` at tier 4, so S1 opens its drive frames, an O1 concern on `debt`, a committed goal `pay-collector`, a `member-of` edge to the `circle-stalls`, and a materialised tie edge with V. The fixture sets the initial `EventsState` calendar to hold: **C**, a `gang-clash` child at `g3` due at window 160; **D**, a `theft` child at `g3` due at 160; **E**, a `gang-clash` child at `g11` (not within one step of `g3`) due at 160. The replay script has, at `t = 90,300` (window 150), a `game.combat.start` at `g3` with two hostiles (`TygerClaws`, `TheMox`), and at `t = 90,900` (window 151) a `game.death` of `mv` with the actor a `TygerClaws` person, 3 witnesses, and `mv`'s `alive` reading going to `no` at the same time. The harness also adds a `simulation`-layer `Const` contribution `mv.alive = yes`.

| Check | Expected |
|---|---|
| Derived events | One `gang-clash` of size 1 for the combat (2 hostiles) and one `assault` of size 2 for the death (3 witnesses): each with its raw event as cause, creator `proc(city.mirror)`, the raw time, minted once (SF1-M-1, SF1-M-2) |
| The game's reading wins | `resolve(mv, "alive")` is `no` and `mv.position` is the game's reading, whatever the `simulation` contribution says: the mirrored slot is never sampled (S0 §5.1 step 2). The contribution is rejected by arbitration (precedence 200 against 500) |
| Simulated values corrected | The `city.events` run for the span starting at window 156 reads the mirror digest published at 156. Child **C** (same kind, cell `g3`) is thinned at 160 with reason `game-covers`, logged as a correction. **D** (a different kind) and **E** (two steps away) fire by the usual rules. `mv`'s frames are `abandoned` (cause: the reading's change), its memberships and tie edges are ended, its goal `pay-collector` is `abandoned`; the beliefs held about `mv` by the people in V's scene stand; **one** `game-dead` correction for `mv` is logged and no more |
| Partition and reload | The same records as one tick and as per-window ticks, and after a save between the death and window 156 and a load under another epoch (S0 F-12, F-16, S1-I-17, S1-I-21) |

### 14.3 Property tests, patterns and panels

The reference model also checks, over generated scripts, logged named streams, and shrinking of failures ([dossier 23](../craft/d23-evaluation-testing.md) §12):
- **S1-I-1 to S1-I-24** as properties, including random saves at boundaries and loads between any two ticks;
- **partition and reload:** random tick partitions and random save and load points over generated external operation scripts, for every process (the F-13, F-21, F-22 and F-25 generalised);
- **regeneration under random forgetting** of residents, households, items and scenes;
- **summary and item agreement** across scopes;
- **metamorphic relations:** adding an unrelated district changes no other district's draws; renaming ids changes nothing but the ids; scaling `cityScale` scales the means and nothing else;
- **hard limits** under fault injection (a calendar over its cap, a ledger over its cap, a walk over its limit);
- **demand independence:** random demand histories change no tier 0 to 2 output.

**The pattern register** (S23-P9-05). A pattern used to calibrate is never used to validate. Calibration seeds are `H("cal", i)`, `i = 0 … 9`; validation seeds `H("val", i)`, `i = 0 … 19`. **Calibrated:** M14-01 (`σ` of `lqtab`), M14-07 (the offspring means), M15-11 and M15-14 (the norm thresholds, the report inputs). **Validated only:** M14-03, -04, -05, -06, -08, -09, -10, -14, -16, -18, -20, -22, -23, -24 and M15-01 to -05, -15 to -18, -24, -27. The pass bands are those of [dossier 14 §7](../craft/d14-city-events.md#7-measures) and [dossier 15 §7](../craft/d15-people-networks-order.md#7-measures). The 100-game-year soak on 20 seeds under the memory guard (S23-S0-12) runs from phase 2, with the feedback-loop test of dossier 18's REP-06.

**Spec-only reimplementation** (VLD-08). One S1 process, `city.events`, is reimplemented from its written page by someone who has not seen the code; the disagreements are filed as specification gaps.

**Panels.** A template-written week in Kabuki, built from the SF1-E1 record, is shown to readers who know the game, for panel P-C (M14-17, P15-01): does anyone seem to know anyone, do things seem caused, does a norm feel enforced, does the street react to V as to someone it has met. The panel decides whether phases 2 and 3 are needed at all.

**What M3 asks of the game:** nothing. The in-game rows are batched into one prepared session with a friction log, run by the maintainer when M4 starts.

## 15. Departures from P3

Where P3 was underspecified, inconsistent or could not be implemented as written against S0 v4.9, this page decided. The list is complete: every difference between this page and P3 is here. Section numbers in the "P3 says" column are P3's.

| # | P3 says | S1 does | Reason |
|---|---|---|---|
| 1 | §5.2 and dossier 14: each kind has a share of m1 incidents, and the ladder gives rates by size | A table of rates by kind **and** size (§5.2) whose columns sum to the ladder (300, 45, 6, 0.8) | The shares and the "usual size" column disagree (`disorder` 4 % and `psycho-break` and `outage` "under 1 %" give more than 100 %; `disorder` is "m2 to m4" yet has a share of m1). The table resolves them |
| 2 | §5.2: the persistent hot list is the top cells, "at most 64 per district" | `min(64, max(1, ceil(0.25 × cells)))` | Kabuki has 15 to 30 cells, so "at most 64" alone would make every cell persistent and leave no remainder |
| 3 | §2.5: bands, labels, stocks and regime flags are pins; readers read the pins | Pins only for `band`, `status`, `gap-<norm>` and `label-<axis>`, written on change; stocks and regimes live in process state; **current values are read from digests** (§2.2) | A pin on a temporal slot covers the one window it names (SPEC-NOTES 34), so a held value cannot be read from pins. The pin is the Change that wakes interests and the record of when a value began |
| 4 | §2.5 and §8.3: urgency writes a pin when its 1/64 bucket changes | Urgency is **derived and never pinned**; processes and policies evaluate it | S0 §5.1: a pin on a derived slot constrains its inputs or contradicts. Urgency reads `t` and several inputs. O1 needs no pin: `scene.acts` and `group.decide` evaluate frame weights each window |
| 5 | §6.1 and dossier 2 item 12: quality and currency of a tie are pinned on a bucket change | Derived on demand, never pinned | Same reason as item 4 |
| 6 | §6.3: "four fixed iterations per period" over four steps | One pass of the four steps per window, with steps 1 to 3 relaxed four times so `beh` settles, then step 4 once; `η` = 0.058 per window (about 0.3 an hour) | The period is only a batching choice; the sentence is ambiguous |
| 7 | §7.3, §6.5: reach comes from `city.flow` | Reach is **frozen at the item's formation** in M3 (§8.9) | `city.flow` is phase 2. S0 F-24 needs 30 days of absence to change no label, which a reach growing with time would break |
| 8 | §3.3: a derived event "carries the tag `mirrored`" | A mirrored event is told by its **creator** (`proc(city.mirror)`), with the raw event as cause | `EventView` carries no per-event tags; it carries the creator, which S3 reads |
| 9 | §3.3 and §10: a cause never follows its effect; a child is at least a window after its parent | A **derived** mirror event keeps the raw event's time | It re-describes the same moment. Offspring keep the one-window rule |
| 10 | §3.3: "an outcome event with the district" | A kind `gig-outcome` (§5.3) | No core kind fits |
| 11 | §2.1: `city.shape` keeps the flow matrix | Not built | Its users are `city.flow`, home and work pairs and offender mixing, all later |
| 12 | §5.2: an overfull calendar "folds the lowest-size children into counts" | It drops the lowest-size, largest-`Id` child and logs `calendar-overflow` | Folding needs a second calendar; M3 never reaches 256 |
| 13 | §5.2: the people of an event come from the cell's cast | Rejection sampling over the block's residents, at most 24 attempts, with the group node as the fallback (§5.4) | A method that fits the allowance and the keys |
| 14 | §6.4: a report is a separate keyed draw | It is applied to **`police-action` children** (§7.2) | It gives the report chance a use in M3, before the police-pressure dial |
| 15 | §4.2, §4.3: residents are `H("gen", block, "residents", i)`; a household is drawn first | Households first, with residents as the six owned member slots `m0 … m5` of a household, six resident kinds, `Id` `H("val", household, "m" + j)`, and a nominal block headcount (§4.2) | Household-first generation with coherent ages needs the household's slots to constrain its members, and a derive has no member index. Six kinds need no kernel change |
| 16 | §4.3, §15: traits and importance noise are keyed `("trait", …)`, `("prof", …)` | Kernel-drawn sampled slots (`traits`, `z1`, `z2`, `noise`, `life`, §8.1) | The kernel already draws a slot on the persistent id; this removes S1 keys |
| 17 | §8.1: the first three frame levels "persist for persons V has met" | They stay `active` but are not advanced out of demand; a goal past its deadline lapses quietly on return (§8.2) | Fine tiers never catch up (S0 §9.4); inventing past outcomes would fabricate history (C-S1-12) |
| 18 | Open question 7: the belief path of a ledger item | `rep-<axis>[i]`, `i` the lowest free index in 0 to 31, with an eviction rule; the value is `vec [v, reach]` (§8.9) | Satisfies I-9 and the cap of 32 |
| 19 | Open question 8: how many audiences per subject | Three carriers in M3: the stallholders' circle, the Claws, the district (§8.9) | The M3 labels are "V among Kabuki's stallholders and the Tyger Claws" |
| 20 | §6.1 (dossier 2 §8): `regard(A → B)` as slots on A's side | An edge `xf:regard` from A to B | An edge needs nothing in the kernel and is visible to retention and the audit |
| 21 | §11: a ladder "never produces a rung whose class is at ceiling 0" and "a ladder cap follows" the dials | A rung is produced iff its class ceiling is not 0; ceilings 1 to 3 act at display (S2 §2.19) | The wording of S2 |
| 22 | §2.1 and dossier 15: `order.stocks` updates `E ← ρE + gains − losses` | `E ← ρE + (1 − ρ)E₀ + gains − losses`, the same for `Y` and `L` | Without a baseline an uneventful district's stocks decay to zero |
| 23 | §10: the kinds S1 mints | Adds `reminder`, `serve`, `patrol`, `gig-outcome`; registers `collector-visit` as a routine act; gives every kind a producer (§5.3) | The routine acts and the debt ladder need kinds; the lint refuses a kind with no producer |
| 24 | §2.4 and §16 K-1 to K-4: four process-interface clarifications | Adopted by S0 v4.9. This page adds eight new asks (§16.1) | |
| 25 | §3.5: binding "by key" to a resident of the block | A casting type with `isChild` has no resident and always falls back; dependants are a count (§4.3) | Residents are 16 and over |
| 26 | §6.2: group membership dynamics | None in M3: a fixed roster. The strength of a membership edge is the `commitment` of §4.7 | `order.members` is phase 2 |
| 27 | §5.4: `heatRank` is a read | `maybe` until two districts are simulated | Heat is not tracked for stubs |
| 28 | §8.3: `serenity` is the state ratio of stress load | Computed by the `frames` policy, not by a `Derive`, because it reads frames (§8.1) | A derive reads slots, not frames |
| 29 | §4.1: the index slice uses dimensions 3 to 27 | Adds the `affOrder` classes, `pairs`, `F`, `gameCoverage` and `marketCell` as index fields (§3.1) | The fields S1 reads must be named |

## 16. What S1 needs from the kernel and the other specifications

### 16.1 Kernel (S0)

No new mechanism. Seven clarifications and one small addition, found by reading the reference model and writing this page. None changes a result the reference model produces today.

| # | Where | Need | Why |
|---|---|---|---|
| K-1 | S0 §9.3 | If no place lies strictly under a summary's scope, its items' place is the scope itself | Summaries scoped to a cell have items. The kernel's candidates are places strictly under the scope, so today such an item has no place |
| K-2 | S0 §5.1 step 1 | An input of a `Derive` that resolves `unavailable` reaches the derive as `undefined`; other statuses propagate | Urgency and importance apply defaults for facts nobody has pinned |
| K-3 | S0 §9.4, the reference `ProcessCtx.rand` | A process draw takes the **window being computed**: `rand("proc", worldSeed, processId, w, …)`. Today `ctx.rand` is keyed by the run's start | A run computes `n` windows one at a time; keying by `w` makes a draw independent of where the run starts (§1.3, SF1-H-9) |
| K-4 | S0 §9.4 | The digests of processes are readable by registered reads and hooks as of the last applied boundary, not only by processes | S2's reads and S1's hooks read digests (§9.1) |
| K-5 | S0 §9.4 | The operation shapes of §2.1 (frames, `decide`, `order`, `observe`, `tell`, belief set), or the reference model's amendments; and `contributionId(spec)` as a pure function | S1 names the Ids a refit will end |
| K-6 | S0 §10.5 | `matchStrength(actor, change, types?)`: the greatest relevance the kernel's matching gives a change against an actor's eligible frames, optionally restricted to interest types, as a read | Salience and telling selection need it. It is the engine's own relevance concept |
| K-7 | S0 §9.2 | An event may be minted with a `time` earlier than the boundary at which it is applied | Derived mirror events take the raw event's time |
| K-8 | S0 §14.1 | `SeedRecord` under `s1` with `actor` unset is a retention root of nothing but its own `nodes` (none) | The S1 record holds plain data only |

**Reference-model alignment, not S0 changes.** The reference model's `aggregate` stub returns `{ value, confidence }`; S0 v4.3 states `{ value, mass, items }`. The stub follows S0 v3 and needs updating before the ledger runs on it. `coarseFine` and the declared read set are optional fields of `ProcessDef`. A process's `state` and `digest` are read by `ctx.own()` and `ctx.digest()`, which today are absent. The reference model's `ProcessOp` lacks the frame, `decide`, `order`, `observe`, `tell` and belief operations of K-5.

**Schema (a pack, not the kernel).** S1 ships `xf.core.world@1`: the kinds of §4.1, §4.2, §7.0 and §8.1, the edge types `xf:tie` and `xf:regard`, and the dimensions they need. The kernel's core schema is unchanged.

### 16.2 S2

- **S2-1.** The reads of §9.1 give strings, not numbers. S2 treats band names as registered strings, not the example "quiet, simmering, hot" of S2 §2.16. `regime(scope)` answers the kind of the greatest live regime, and `regimeIs(scope, kind)` answers `yes` or `no`.
- **S2-2.** S2 owes S1 the live casts (`core:cast` edges, which are the protected set) and V's accepted offers and responses as observed events with V as a participant.
- **S2-3.** S2 §4.1's registered-read declaration is satisfied by the `deps` of §9.1 (`digests`, `interests`, `time`, `roles`). Reads that answer `maybe` in M3 are unbuilt phases, and S2 treats `maybe` as its core does.

### 16.3 S3

- **S3-1.** S3 reads `eventKind(name).producers` as names of processes, policies, `s2` and `port`. `aesthetic` answers `undefined`; S3's `T_aes` is then 0.
- **S3-2.** S3 owes S1 the stated rule that S3 never reads inside S1's private state, and later the `memorable` rule for returns. S1 owes S3 events with `causes`, effects and participants, bounded at about ten Changes an hour for the city, and policies that ignore `meta:` kinds.

### 16.4 Others

- **S4:** the pack formats for kinds (§5.1), drives, means, norms and ladders, carriers, the judge table, rosters and the tables of §1.2; the content-class listing per kind (S18-S4-02); the `aesthetic` feature library.
- **S5 and P8:** the raw event kind names, the mirrored slots S1 reads and V's `cell` (§3.4); the community slot for a person V can see; a `community active` read per cell for `gameOwnedNow`; the routes table's execution and the spawn budget.
- **P7:** the measured budgets (§10.4); where S1 runs.
- **S6:** the logical record of §11 as bytes.

## 17. Compromises and open items

### 17.1 Compromises

For the [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger). The first ten are P3's, with what M3 does.

| # | The model says | S1 does | Revisit when |
|---|---|---|---|
| C-S1-01 | Every person is a full bundle | Residents are drawn from a recipe and opened on demand | A story needs a resident's history before V met them, beyond spells |
| C-S1-02 | Rumour travels person to person | M3: reach frozen per item, `knows` by a keyed quantile. Later: mean-field fractions per district | M14-13 or M14-14 fail, or a story needs who told whom for unfocused people |
| C-S1-03 | Beliefs everywhere | Beliefs only at fine tiers and carriers; aggregates above | The sifter lacks divergence material |
| C-S1-04 | Every telling is an event | Minted only in focus, for V, live casts and canon people | Same trigger |
| C-S1-05 | Ownership is checked against the game as it is now | A static coverage figure; a dynamic read only for realisation and `scene.acts` | A session shows simulated and game incidents colliding |
| C-S1-06 | Memory follows use and importance | A hold time with the generous floor, until the machinery lands | Transcripts read as forgetting or recalling unnaturally |
| C-S1-07 | `e^x` exactly | `exptab`, linear interpolation, under 0.0489 % error | A distribution test shows the error |
| C-S1-08 | Attribution is a full inference | Two beliefs and one disposition weight | NPC speech reads as wrong-minded |
| C-S1-09 | Ties are queryable without opening | Pure functions, with casting opening a bounded set | Casting through ties misses or costs too much |
| C-S1-10 | Ethos and archetype from the setting | Judgement tables in pack data | A review by someone who knows the lore, or calibration fixtures |
| C-S1-11 | Rates by kind follow the dossier's shares | A table by kind and size summing to the ladder | M14-01 or M14-18 calibration moves the shares |
| C-S1-12 | An NPC's goals go on out of sight | Fine-tier goals lapse quietly on return after their deadline | A story needs what an NPC did while V was away |
| C-S1-13 | A reputation item's reach grows as it spreads | Frozen at formation | `city.flow` lands (phase 2) |
| C-S1-14 | Households and residents in one draw | Households first, six owned member slots, nominal headcount | A block's age marginals miss by more than the roster allowance |
| C-S1-15 | An event's people are drawn from the cell's cast | Rejection sampling, 24 attempts, then the group | The fallback is common in a district (the `who-fallback` count) |
| C-S1-16 | Every changing value is a pin | Derived values and digests; pins on change only | A tool needs the history of a banded value at an earlier time |
| C-S1-17 | A mirrored event is a simulated event with a tag | The creator marks it; the raw event's time | A reader needs the tag on the node |
| C-S1-18 | A full calendar folds children into counts | It drops the lowest-size child | M14-23 shows the cap is reached |
| C-S1-19 | Norm state per block | District slots only; four relaxations and one move per window | M15-12 needs embeddedness |
| C-S1-20 | Stocks only gain and lose | Retention to a baseline | A soak shows stocks stuck at the baseline |
| C-S1-21 | People move house | Residence spells are tenure only | A lineage runs long enough for the roster to matter |
| C-S1-22 | Heat counts every incident | Heat counts incidents with a known cell; district-scoped remainder incidents have none | A hot district shows no heat because its incidents are dispersed |
| C-S1-23 | Reputation for every subject and audience | Subject V, three carriers | Seeds need the reputation of an NPC |
| C-S1-24 | Group books are simulated | Pack judgement: cash, burn, income, and a lump per shakedown | M3's panel reads the Claws as having no money worries |

### 17.2 Open items

1. **Cell size and grid.** About 200 m clipped to the leaf, venues as own cells. The index build gives the count. How cells relate to streaming cells is open.
2. **The game-time ratio and the hours behind the period names.** Unmeasured. Row 1 of the first in-game session. Until then `periodStartHour` and every time constant are **[tunable]**.
3. **Binding keys.** Is `(community instance, entry, spot, ordinal)` readable and stable across loads? The fallback is session-only binding (§4.3).
4. **Concern capacity and thresholds.** `θ_open` 0.35, `θ_close` 0.2, room 3: calibrate on the drive fixtures.
5. **Is the minted-telling volume enough for the sifter?** Measure on the M3 transcripts.
6. **The mirror's period and the feed's latency and ordering,** with S5 and the bridge.
7. **The roster allowance** of 0.06 and the fit's agreement with the households' marginals (M15-01, M15-02).
8. **The headcount scale `ρ`** from entry quantities, which count slots, not people.
9. **Ethos, archetype, judge and view tables** are judgement and need a lore review.
10. **Age advance:** whether a lineage needs `age-at(t)`.
11. **Mod-added places and communities mid-lineage:** how the overlay re-derives presence, and which pack-update policy applies.
12. **Native hot loops:** the refit, the opportunity fields and catch-up are the candidates. Measure first.
13. **The `aesthetic` feature library** (S4).
14. **How institutions decide.** The first cut gives them drives, ethos and orders.
15. **S5 reads:** a `community active` read per cell, and the community slot for a person V can see.
16. **Whether `scene.acts` needs positions.** If it does, P8 supplies them.
17. **`heatRank` and the unbuilt reads** wait on a second simulated district.
18. **The m4 spacing** (432 windows) and weekly budget (2) are guesses against M14-18.

## 18. Review record

No review yet. Reviews are recorded here in the form the other specifications use: the round, the reviewer and effort, the number of findings and what was adopted, and a table of findings with the change each made.

| Round | Reviewer | Findings | Adopted | Notes |
|---|---|---|---|---|
| (none) | | | | |

