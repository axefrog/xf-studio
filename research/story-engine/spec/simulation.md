# S1. Simulation layer specification

**Status:** v0.3, 23 October 2026. v0.3 rules on six questions from the first build: the fit's tolerance, the first window V stands in a cell, SF1-E3's wording, the protected set as of a time, V and the tie cap, and which group a changed affiliation joins. This is the specification stage of [P3](../p3-simulation-layer.md) (work package [WP-11](../plan.md#82-work-packages)). It is exact enough to build the first implementation of layer 1 in the TypeScript reference model from this page and the kernel specification [S0](kernel.md) (v4.10) alone.
- **The core.** This version specifies the **core**: the processes, policies, data and reads that milestone M3 builds. That is one district (Kabuki) at coarse and medium detail, in its smallest useful form (§0.2). Everything else in P3 is a **later capability** (§0.3). The first implementation rejects it plainly rather than half-doing it.
- **Reviews.** Round 1, GPT-6 Astra, on v0.1: 20 findings and the whole over-engineering section, all adopted (§18). v0.2 shrinks the core, runs every process one window at a time, and fixes the findings.
- **What it reads and what reads it.** S1 fills the hooks of S0 (§9.4 processes, §11 beliefs, §10.8 the conflict table) and is read by the seeding layer [S2](seeding.md) (§2.16 and §2.17) and the procedural engine [S3](procedural.md) (v0.3, §1.2 and §6.1).

Where this page and P3 differ, this page wins. P3 explains why; this page says exactly what. §15 lists every departure, with the reason.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout. Every **[tunable]** value lives in pack data (`S1Data`, §1.4), never in code. A value given without a mark is fixed by this page.

**The first-party rule.** Groups, perspectives, context and relevance, and the dimensional model are the project's own concepts ([D-21](../decisions.md)). Nothing on this page credits them to outside work. Where a technique is borrowed (iterative proportional fitting, a beta form for evidence, a negative binomial for clusters), it is named as a technique, for the reader who wants to check it.

## 0. Scope

### 0.1 What S1 is

S1 is the **content and policy** that turn the kernel's mechanism into a city: who exists, what happens in the streets, how groups hold together, who believes what about whom, and how the city answers what the game does. It mirrors the game, so that none of that contradicts what the game owns. It does not own the mechanism (draws, pins, queries, frames, the record, retention: [S0](kernel.md)); seed language, casting and the arbiter ([S2](seeding.md)); sowing and sifting ([S3](procedural.md)); the game port and realisation (S5, P8); words (S7); pack formats and settings screens (S4, P6); persistence bytes (S6); where S1 runs (P7); or authored content. It supplies logs and reads to the evaluation tools (P9, P10).

**Seven rules run through everything below.**
1. **The game is ground truth.** S1 mirrors what the game owns and simulates only what the game does not. Where they disagree, the game wins and the record reconciles (§7.3, §8.8).
2. **Counts first, items on demand.** Every incident starts as a count in a summary. Detail is the lazy opening of its items (§7.9).
3. **A policy is a registered function or a data table.** Packs supply tables and parameters, never code.
4. **V is observed, never owned** ([D-09](../decisions.md)). No S1 process names V as the target of a harmful effect, and none models V's feelings. V's acts are history. V's position and attention change nothing coarse.
5. **Deterministic by construction.** Every draw is keyed by what it is about (§1.3). Nothing reads the session epoch, the load count, the play clock or the wall clock (S0 I-16).
6. **Nothing is modelled until something asks.** Residents are drawn, not simulated. Ties are implicit. Beliefs exist for the observed and the focal.
7. **Simple first.** One window, one tie function, one gate, one admission owner. Everything that can wait for measured need waits (§0.3).

### 0.2 The core: what the first implementation builds

The first implementation is the TypeScript reference model, beside the kernel and layers 2 and 3, sized for milestone M3 ([P3 §19.2](../p3-simulation-layer.md#192-the-first-implementation-sized-for-milestone-m3)): **Kabuki, phase 1**, in the smallest form that can show a believable causal district record.

| Area | In the core | Section |
|---|---|---|
| The district | A fixed Kabuki slice with two tier-1 stubs (a generated stand-in until W1 builds it), and a fixture slice `FX-3` | §3 |
| The population | One recipe, fitted once; households, residents, two spell tracks, one trait, eight archetypes, names, binding, the protected set | §4, §7.4 |
| Events | A small catalogue of ten city kinds as data; opportunity fields; counts, summaries, events; bounded aftershocks (a generation cap and a bounded mean); stable identities and retained causal records; heat and bands; exogenous regimes | §5, §7.1, §7.2 |
| Admission | **One owner,** `city.events`, for every size-2-and-above occurrence and size-4 regime, with persisted budgets in a declared order | §7.2 |
| The mirror | Mirror reconciliation against the **offline replay port**, from hand-authored story states ([D-18](../decisions.md)) | §3.4, §7.3, §8.8 |
| Groups | The Tyger Claws and The Mox: four pressures and two simple intentions each, which start, expire and are removed | §7.8 |
| Order | One public and private norm demonstration (the Friday fee; its twin, the norm against talking to the uniforms, feeds the report chance); the stocks | §7.5, §7.6 |
| Reputation | One carrier demonstration: V among Kabuki's stallholders, the Tyger Claws and the district | §7.7, §8.6 |
| Beliefs and ties | `witness`, `social` (telling), `fade`, `ties` (stable ties, recorded interactions), `v.frames`, `reconcile` | §8 |
| Reads, registries | The registered reads for S2, each with timestamped transitions; the registries for S3 | §9 |
| Fixtures | A Kabuki week, written out from a template; partition, reload and coarse-against-detail consistency | §14 |

R1 stays a **bounded authored fixture**: one mirrored canon character with authored frames and beliefs about V, two vendors and one fixer, at tier 4 for at most 100 persons. Runtime binding (§4.3) and realisation (§5.5) are specified but **outside M3's completion criteria**. The in-game rows of P3 §18 are batched into one prepared session. Until then every unmeasured time constant is in game time and **[tunable]**.

### 0.3 Later capabilities

The first implementation rejects these with a plain finding ("not supported yet"). Each returns only with a recorded contract that agrees with the reference model.

| Later capability | Why it waits |
|---|---|
| **The full drive catalogue** (39 individual drives, drive-states, importance, urgency models R, S, D, P, X, C, Y) | No individual wants are needed to show a causal district. Groups use four named pressures (§8.1) |
| **The O1 to O5 concern machinery** | Needs the catalogue |
| **General means scoring**: the means library, commitment, reconsideration, goal outcomes | Needs concerns. Groups use two fixed intentions |
| **Dilemma strategies**, the defect options of an order, `order` operations to members | Need goals. Member-order realisation belongs in `scene.acts` (E-09) |
| **Personality revision under pressure** (`change`: pressure accounts, thresholds, turnings, refusals, drift) | Needs goals and dilemmas |
| **Relationship investment and alternatives** (satisfaction, commitment) | Stable ties and recorded interactions are enough for M3 (§4.7) |
| **Pursuit budgets** (bids per rung) | Needs bids from seeds. The consent rules, boundaries and retract are kept |
| **Gift interpretation** | A gift is read through the NPC's concern, and M3 has none |
| **Reciprocity ladders** | Needs favours with due times, which need the drive models |
| **Reunion modelling** (warm and cool returns) | Absence has no cost in M3, so nothing needs modelling |
| **Population refitting** | The index is immutable inside a lineage, so the fit is computed once (§7.4) |
| **Structural pack migration** | The simulation data are pinned per lineage (§1.4); a structural change is a new lineage |
| **Multi-window speculative runs** (a period above 1) | A span cannot see later settings or protections (E-05). Longer spans need deterministic invalidation first |
| Routine acts (`serve`, `patrol`, collector visits), the debt ladder, lies | Need individual wants |
| District-remainder summaries | M3 districts are small: every incident takes a cell before its summary (§7.2) |
| `city.tension`; police pressure as a dial; `city.flow` (rumour fractions, reach by recurrence); `order.contracts`; `order.members`; the protection market; regimes beyond exogenous arrival | Phase 2. M3 keeps the matrix, the regime modifier, the report draw, and a reach frozen at formation (§8.6) |
| Unrest, infrastructure graphs, the slow district variable, far ties, covert effects, police styles | Phase 3 |
| Rivalry salience, mentor phases, bids, novelty, decay profiles, help rates, signal stages | Phase 2 of the tie record |
| Blacklists, overhear, civic memory channels, the memory machinery | Deferred with S0 V4-30. M3 uses the hold-time fade (§8.5) |
| Block-level norm state and tipping; residents who move; `age-at(t)` | Phase 2. M3 keeps district norm slots and tenure-only residence |
| Tier 5, positions, animation, realisation routes and the spawn budget | The game's; P8 |
| The `aesthetic` feature table | S4's. M3 answers `undefined` |
| Native hot loops; measured budgets | P7. S1 gives targets only (§10.3) |
| Mod-added places and communities mid-lineage; a live game | The world-index overlay (dimension 32); S5 and the first in-game session |

### 0.4 Conventions

- **Time.** `GameTime` is game seconds ([S0 §9.1](kernel.md#91-time)). `W` is the shared window, 600 s. A **boundary** is `t = k × W`. Every process runs **one window at a time**: the run for window `k` starts at boundary `k` and its outputs apply at boundary `k + 1`.
- **Windows.** "Window" always means a simulation window of `W`; S2's seed windows and S3's slots are other things. **A later window is not a full window of elapsed time.** A child due in window `w + 1` happens between 1 s and `2W − 1` s after a parent in window `w`.
- **Tier and phase.** A tier is a scheduling band of the kernel (0 city to 5 fine detail). A phase is when P3 says a part is built.
- **Ids.** `city`, `director` and `v` are the kernel's roots. `s1 = H("root", worldSeed, "s1")` is S1's own record (§2.2). `port = H("root", worldSeed, "port")` creates raw game events. A process's creator id is `proc(id) = H("process", id)`. Pack ids: `xf.core.world@1`, `xf.kabuki.index@1`, `xf.kabuki.groups@1`, `xf.kabuki.norms@1`; fixtures use `xf.fixture`.
- **Arithmetic** is S0's [§1.3](kernel.md#13-arithmetic) plus §1.2. Sums run in the order written, and sets in `Id` order.
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

The four periods are the game's named periods. The hours behind them are unmeasured ([P3 §18](../p3-simulation-layer.md#18-open-questions-for-s1) item 2), so the boundaries are **[tunable]** and the first in-game session settles them. A jump (a sleep, a fast travel) is a session input, never a draw key.

### 1.2 Arithmetic and the table functions

S0 §1.3 allows `+ − × ÷`, `sqrt`, comparisons, `floor` and fdlibm `ln`, and allows S1 to add exact table-based sampling, "specified bit for bit". This section is that specification.

**Two rules for every S1 computation.**
1. **No fused multiply-add.** `a × b + c` is two roundings, in that order.
2. **Fixed order.** Loops run in the order written. A sum over a set runs in `Id` order. A product runs left to right.

**The tables are frozen artifacts.** Each is a file of binary64 values, one per line, written as the 16 lower-case hex digits of the big-endian bit pattern, with LF line ends and a final LF. The reference tool `make-tables` computes each value with at least 80 decimal digits (the reference run used 120) and rounds to nearest-even. The file's SHA-256 is in the lineage record (§1.4). An implementation's tool MUST reproduce these hashes. A table version never changes in place: a different `σ` or grid is a new artifact and so a new lineage.

| Artifact | Entries | Value | SHA-256 |
|---|---|---|---|
| `exptab@1` | 321 | `T[j] = e^((j − 256) / 16)`, `j = 0 … 320` | `14b2d09c5c8e697452d1141f9a2a5da46bc33aebf6b4316235d43b10a61cdbb3` |
| `normtab@1` | 4096 | `Z[i] = Φ⁻¹((i + 0.5) / 4096)`, computed for `i < 2048` and mirrored, so `Z[i] = −Z[4095 − i]` exactly | `9a8bb800f0ceb60753772fca95394aef86230abdf96ee591d276fd75979032e6` |
| `lqtab@1` | 4096 | `LQ[i] = e^(σ·Z[i]) / mean_j e^(σ·Z[j])`, with **σ = 1.6 fixed in the artifact** (computed from the exact `Z`) | `cb0478b554d1fb9c396d6402bbcf0edaea2a68d9d47579af4cf285cbdaf33cdb` |

`LQ` has mean 1. The top 5 % of `LQ` entries hold 47.9 % of the mass and the top 1.25 % hold 25.6 %, against the 48 % and 26 % of the log-normal itself.

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

Ties go to the lower index. A table with all weights zero returns 0 and the caller MUST have excluded it.

**Counts: the exponential-spacing form of a Poisson draw.** It uses `ln` and addition only.

```ts
function spacingCount(mu: number, draw: (i: number) => number, cap = 64): number {   // draw(i): the keyed uniform of stream index i
  if (!(mu > 0)) return 0;
  let s = 0, n = 0;
  while (n < cap) {
    s = s + (-ln(draw(n)));
    if (s > mu) break;
    n = n + 1;
  }
  return n;                                              // n = cap means the cap bound; the caller logs `cap-hit`
}
function splitCount(mu: number, drawPart: (part: number) => (i: number) => number): number {   // a mean above 32 is split into equal parts
  const parts = Math.max(1, Math.ceil(mu / 32));
  const each = mu / parts;
  let total = 0;
  for (let p = 0; p < parts; p++) total = total + spacingCount(each, drawPart(p));
  return total;
}
```

**What the cap does.** `spacingCount` truncates at `cap` (64 unless the caller says otherwise). With `mu ≤ 32` the chance of reaching 64 is below one in a million (4 × 10⁻⁷ at `mu = 32`), so the cap is a hard bound and not a sampling rule. A part that reaches its cap is a defect `cap-hit`, counted and logged. `splitCount` therefore cannot return more than `64 × parts`. It drops nothing below that bound.

**Clusters: the negative binomial by recurrence.** With mean `n` and dispersion `k` the probability of no children is `exptab(−k·ln(1 + n/k))`. Each next probability follows by multiplication.

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

### 1.3 Keys

Every S1 draw is `rand(key…) = toUnit(H("rng", key…))` ([S0 §1.4](kernel.md#14-random-streams)). Arguments are typed as the reference model types them: strings `s`, `Id`s `id`, integers `i`. **`worldSeed` is always the second argument, as an `id`.** No key reads the session epoch, the load count, the play clock or the wall clock ([S0 I-16](kernel.md#15-invariants)). The only non-causal discriminator is the `attempt` counter of binding (§4.3).

There are two forms:
- **Process draws** are `procRand(w, …) = rand("proc", worldSeed, processId, w, …)`, where `w` is the window being computed. Each run computes one window, so `w` is also the run's `k`.
- **Identity draws** are keyed by what they are about and carry no window: the cast of an occurrence, the offspring of an event, the tie between two people, the belief a resident holds about an item. They are the same at every tier and after every reload.

The registry of every key is §1.5. A draw that is not in the registry MUST NOT exist.

### 1.4 Pack data, tunables and the pinned version

`S1Data` has the sections `time`, `shape` (hour and weekday shapes, pulses, the city rate table), `kinds`, `events` (offspring, delay bins, matrix, place kernel, heat weights, band thresholds, admission budgets), `people`, `ties`, `norms`, `stocks`, `ledger`, `groups`, `minds`, `feed` (windows kept per feed: 8), `gate` and `realisation`. **Every [tunable] on this page is a field of `S1Data`.** A pack MAY override a field. Fixtures use the defaults given here. A pack that omits a field takes the default.

**The simulation-data version is pinned per lineage.** The lineage root record holds `sim`: the versions and hashes of `S1Data`, of every pack of §0.4, of the three table artifacts, of the world-index slice, of the recipe fit (§7.4) and of every process. An M3 lineage never changes it. Nothing mid-lineage reinterprets an identity: a pending child, a retained summary, a group state and a ledger item are all read under the version that made them. When the pinned versions are not available at load, S0's compatibility rule applies ([S0 §14.4](kernel.md#144-compatibility)): the record loads read-only with a plain message. S1 adds a migration only when a concrete update needs one.

### 1.5 The key registry

Every draw S1 makes is in this table. After `"rng"` and the tag, `worldSeed` is always the next argument (an `id`), then the rest in the order shown. `w` is the window being computed, `pid` the process id, `occ` the `Id` of an occurrence (an event, or a summary item once indexed).

**Process draws**, `procRand(w, tag, …) = rand("proc", worldSeed, pid, w, tag, …)`:

| Process | Tag and arguments | Draws |
|---|---|---|
| `city.events` | `"regime"`, `d:id`, `r:s`, `i:i` | the arrival spacings of regime kind `r` in district `d` |
| | `"regime-size"`, `d`, `r` · `"regime-t"`, `d`, `r` · `"regime-exit"`, `regime:id` | size 3 or 4; the start time within the window; the exit draw |
| | `"cnt"`, `d`, `k:s`, `part:i`, `i:i` | the spacing stream of the incident count |
| | `"size"`, `d`, `k`, `i` · `"cell"`, `d`, `k`, `i` · `"t"`, `d`, `k`, `i` | size; the cell; the time within the window (events only) |
| `order.norms` | `"enf"`, `d`, `norm:s`, `i` · `"rung"`, `d`, `norm`, `i` · `"ecell"`, `d`, `norm`, `i` · `"et"`, `d`, `norm`, `i` | the enforcement count; the rung; the cell; the time within the window |
| `group.decide` | `"retal"`, `group:id`, `rival:i` | the retaliation check |

**Identity draws**, `rand(tag, worldSeed, …)`, with no window:

| Tag and arguments | Draws |
|---|---|
| `"cast-f"`, `occ` · `"cast-pair"`, `occ` | the aggressor affiliation class; the gang pair and its orientation (drawn once, at admission, §7.2) |
| `"cast-n"`, `occ`, `role:s` · `"cast-who"`, `occ`, `role`, `i:i` | how many persons fill a role; the `i`-th person chosen from the eligible list (§5.4) |
| `"child"`, `parent:id`, `index:i`, `aspect:s` | everything a child is: aspects `"n"` (with `index` 0, the child count), `"bin"`, `"win"`, `"kind"`, `"size"`, `"cell"`, `"t"` |
| `"thin"`, `parent`, `index` · `"report"`, `parent`, `index` | thinning at fire time; the report draw of a police-action child |
| `"wit"`, `occ`, `i:i` | the witness count of an occurrence |
| `"prop"`, `cell:id` | a cell's propensity quantile |
| `"spell"`, `person`, `track:s`, `k:i` · `"spellv"`, `person`, `track`, `0` · `"anchor"`, `person`, `track` | spell length, state of spell 0, start of spell 0 |
| `"absent"`, `person`, `day:i` · `"sched"`, `person`, `day`, `p:i` · `"work-place"`, `person` · `"out-place"`, `person`, `day`, `p` | an absence; the schedule class; the workplace cell; a leisure cell |
| `"present"`, `cell`, `person` | the priority of a person for a scene |
| `"focus"`, `type:s`, `person` · `"rank-anchor"`, `a:id`, `block:id` · `"tie"`, `lo:id`, `hi:id` | a focus cell; the anchor of a foreign block; the tie between two residents (`lo < hi` as hex strings) |
| `"knows"`, `resident`, `item` | whether a resident knows an item |
| `"ntype"`, `norm:s`, `resident` | a resident's threshold type for a norm |
| `"bind"`, `community:s`, `entry:s`, `spot:s`, `ordinal:i`, `attempt:i` | binding a resident to a body |
| `"accept"`, `tie`, `event` · `"tell"`, `teller`, `listener`, `item`, `window:i` · `"op"`, `teller`, `listener`, `item`, `hop:i` | a status change's acceptance; whether a telling happens; its operator |

The kernel's own draws (`"g"`, `"tie"` of the Gumbel tie-break, `"item-t"`, `"item-p"`) are S0's. The `"kslice"` keys of the fixture slice generator (§3.2) belong to the generator. A window argument is always a window index, never an epoch.

## 2. The process contract

### 2.1 The interface

A process has a tier and a `ProcessState`, and runs under the kernel's rules ([S0 §9.4](kernel.md#94-evolution)). **Every M3 process has period 1.** The run for window `k` starts at boundary `k` from the snapshot, computes window `k` only, and its outputs apply at boundary `k + 1`, with the process's state and digest, atomically. Nothing computed in a run needs a setting, a protection or a demand that arrives later (§3.3). This also removes any batching inside a run (E-05).

```ts
interface S1Process<S, D> {
  id: string; version: number;          // the process id and its version; both are in the lineage record
  tier: Tier;                           // the lowest tier it writes at; application order is by tier, then id
  coarseFine: CoarseFine;               // S0 V4-24
  lag: number;                          // publication lag, in windows (§9.4)
  reads: ReadSet;                       // the declared read set, for the audits of §12
  init(ctx: S1InitCtx): S;              // the state of a new lineage
  run(ctx: S1Ctx, k: number): S1Result<S, D>;
}
type CoarseFine = { kind: 'exact' } | { kind: 'count' } | { kind: 'distribution'; tolerance: string };

interface S1Ctx {
  readonly processId: string; readonly worldSeed: Id; readonly W: number;
  readonly data: S1Data; readonly index: WorldIndex;     // §1.4, §3
  readonly settings: SettingsView;               // the SettingsSet in force at the snapshot (§3.3)
  read(node: Id, path: SlotPath, t?: GameTime): ResolveResult;
  value(node: Id, path: SlotPath, t?: GameTime): Value | undefined;
  query(q: Query): QueryOutcome;                 // within the shared allowance
  procRand(w: number, ...key: HArg[]): number;   // §1.3
  own(): S;                                      // V4-35: this process's state as of the snapshot
  digest<X>(processId: string): X | undefined;   // V4-36: another process's digest as of the snapshot
  record(): Readonly<S1Record>;                  // the S1 record as of the snapshot (read-only)
  demanded(tier: Tier): DemandedNode[];          // V4-37: `scene.acts` only
  produce(o: Occurrence): GateResult;            // §6
  log(e: LogEntry): void;                        // §2.3
}
interface DemandedNode { node: Id; tier: Tier; claim: number }
interface S1Result<S, D> { ops: S1Op[]; state: S; digest: D }
```

**The operations.** S1 returns the kernel's process operations ([S0 §9.4](kernel.md#94-evolution)) in these shapes. Where the reference model's names differ, its names win and these fields are the content.

```ts
type S1Op =
  | ProcessOp                                    // pin, withdraw, contribute, end-contribution, edge, end-edge, mint-event, mint-summary
  | { op: 'publish-item'; item: Id }             // §7.9: the one semantic publication of a completed summary item as an event Change
  | { op: 'frame-open'; frame: FrameSpec }       // id, actor, level, parents, origin, payload, weight, own, focus, status, cause
  | { op: 'frame-status'; frame: Id; status: FrameStatus; cause: Id }
  | { op: 'observe'; observer: Id; node: Id; slot: SlotPath; at: GameTime; evidence?: Id }
  | { op: 'tell'; teller: Id; listener: Id; event: Id; operator: Operator | null }
  | { op: 'belief-set'; belief: BeliefSpec }
  | { op: 'belief-drop'; belief: Id };
type Operator = 'level' | 'sharpen' | 'assimilate';
```

**Ownership of what a process writes.** Each state slot, each minted node family and each edge type has exactly one writer. Two processes never write the same (node, slot). A static audit (§12) checks it. Budgets that limit production are state of exactly one process (§7.2).

### 2.2 State, digests, feeds, state pins and the S1 record

**Process state.** Each process keeps plain data in its `ProcessState.state`, versioned with the process. It is persisted, together with the process's **last digest**, and contains whatever the process cannot recompute: calendars, rings, stocks, norm slots, regime data, cursors. What regenerates from keys (residents, spells, ties) is not state (§11).

**A digest has two kinds of content, never mixed.**
- **State views** hold current values: bands, labels, norm slots, stocks, the live regimes, intentions. They say nothing about history.
- **Feeds** hold events. A feed is the process's last `data.feed.keep` (8) windows of typed facts, each entry stamped with its window:

```ts
interface DigestBase { v: number; through: number }                      // the last window the digest covers
interface Feed<T> { windows: Array<{ w: number; items: T[] }> }          // at most 8 windows, oldest first
interface Transition { key: string; t: GameTime; value: string; prev: string | null }    // §9.1: a read's value changes
```

**Every consumer of a feed keeps a cursor** in its own state: the last window it consumed from that producer. A run consumes the feed's windows after its cursor, in order, each once, and moves the cursor to the digest's `through`. If the first retained window is later than `cursor + 1`, events were lost to the bound: the consumer logs a defect `feed-gap` and carries on. A state view is never used as an event source. A digest that holds history for coverage (the mirror's `cover`, §7.3) is a state view with its own expiry, not a feed.

**Inputs from other processes.** A process reads other processes' digests as of the snapshot at the start of its run. Within one window there is no coupling between processes: the lag between any two is one window. Each digest a process publishes covers window `k`; the digest a run sees covers window `k − 1`.

**State pins.** Time-windowed output that only S1 writes is a `committed` pin (precedence 300) on a simulated temporal slot, named `slot@w<k>` ([S0 §6.3](kernel.md#63-time-varying-slots), SPEC-NOTES 34). A pin is written **only when the value changes**, and it **takes effect at the boundary that applies it**: a value computed in the run for window `k` is pinned `slot@w<k + 1>`, valid from `startOf(k + 1)`. A pin covers one window, so **the current value is read from the digest, never from the pin history**. The pin is the Change that wakes interests, and its time is the transition time that reads publish (§9.1). S1 pins only on slots no other layer writes, and uses `simulation` contributions (precedence 200) for anything a seed, an author or the game may override.

| State slot | On | Writer | Values |
|---|---|---|---|
| `band` | `xf:cell` | `city.events` | quiet, elevated, hot, flashpoint |
| `status` | `xf:service` | `city.events` | open, quiet, watched, closed |
| `gap-<norm>` | `xf:district` (one per norm) | `order.norms` | aligned, gap, wide |
| `label-<axis>` | `xf:standing`, the owned value `standing-v` of each carrier | `order.ledger` | unknown, low, mid, high |
| `group-gap` | `xf:group` | `group.decide` | low, mid, high |
| Regime existence | none: a regime is its `regime-start` event until its `regime-end` event | `city.events` | |
| Pressures, strength of a tie | none | none | **Derived, never pinned** (§8.1, §15 item 4) |

**The S1 record.** Policies have no schedule of their own. Event-driven state lives in one `SeedRecord` under `s1`, with `actor` unset ([S0 §14.1](kernel.md#141-what-is-persisted)):

```ts
interface S1Record {
  v: 1;
  absorbed: Record<string, Array<{ origin: Id; index: number }>>;   // by "carrier|subject|axis": the canonical evidence already counted and its ledger index (−1 once evicted); at most 64 (§8.6)
  dirty: Array<{ carrier: Id; subject: Id; axis: string; seq: number }>;   // standings to re-evaluate at the next ledger run
  divLog: Record<string, Array<{ t: GameTime; value: 'none' | 'small' | 'large' }>>;   // by "believer|subject": transitions of the `divergence` read, at most 8 (§9.1)
  softExcluded: Id[];                              // tie threads a retract has switched off (§4.7)
  log: LogEntry[];                                 // a ring of at most data.log.max (2048), oldest first
  seq: number;                                     // next log sequence number
}
```

A policy updates the record at relevance-dispatch time, inside the boundary being processed, in the kernel's dispatch order. The record is saved with the other states and restored on load.

### 2.3 The decision log and the defect list

The log serves P9 and P10 ([P3 §12](../p3-simulation-layer.md#12-what-s1-exposes)). It is part of the S1 record, so it is deterministic and survives a reload.

```ts
interface LogEntry {
  seq: number; w: number;                         // the window being processed
  proc: string;                                   // a process id or a policy name
  kind: 'gate' | 'admission' | 'correction' | 'decision' | 'defect';
  key?: string;                                   // the draw key, as text, for a keyed decision
  reason: string;                                 // a name from the lists below
  refs: Id[];
}
```

Reasons in use: gate refusals `excluded`, `floor-minor`, `floor-real`, `sex-tag`, `v-target`, `protected`; admission refusals `budget-m4`, `cap-window`, `no-cast`; corrections `game-dead`, `game-moved`, `game-covers`, `game-fact`; decisions `intent-start`, `intent-end`, `intent-idle`, `accept`, `tell`, `operator`; defects `calendar-overflow`, `ring-overflow`, `late-raw`, `read-violation`, `cap-hit`, `n-clamped`, `feed-gap`, `table-missing`, `walk-limit`, `bind-fallback`. The log is never shown to V.

## 3. Inputs

### 3.1 The world-index slice

S1 reads place data through a **world-index slice**, built offline once per installed game and mod set by W1 ([P3 §4.1](../p3-simulation-layer.md#41-the-world-index-slice)). It is static data, the same on every machine for the same install, it is not part of the save, and its version and hash are in the lineage record. A field marked *dim n* comes from place dimension n of [places §12](../../../knowledge/places.md#12-place-dimensions-for-the-world-index-w1).

```ts
type Aff = string;                                  // a Factions.* record name, e.g. "TygerClaws"; "civilian" and "ncpd" are fixed names
type AffClass = 'civilian' | 'gang' | 'corp' | 'ncpd';
type Per4 = [number, number, number, number];       // a value per period

interface WorldIndex {
  version: string; hash: string; clock?: { dow0: number; sod0: number };
  districts: Record<Id, DistrictIndex>;             // simulated and stub
  cells: Record<Id, CellIndex>;                     // cells of simulated districts only
  rest: { totalA: Record<KindName, Per4> };         // the opportunity of all districts not listed
}
interface DistrictIndex {
  id: Id; key: string; simulated: boolean;          // key: the place key, e.g. "wat_kab" (dim 5); false: a tier-1 stub with counts only
  neighbours: Id[];                                 // districts whose polygon touches this one (dim 4)
  entry: { total: number; byAff: Array<{ aff: Aff; cls: AffClass; q: number }> };   // dim 16: entry quantity, largest first
  rho: number;                                      // the headcount scale; [tunable 1.0]
  marginals: { age: number[8]; role: number[12]; income: number[4]; aff: number[6];    // the targets of the recipe fit, each summing to 1
               household: { type: number[5]; tenure: number[3]; wealth: number[4] } };
  affOrder: Aff[];                                  // the six affiliation-class names of the recipe, §4.2
  trust: { E0: number; Y0: number; L0: number };    // starting efficacy, cynicism, police legitimacy; defaults 0.5
  priceAnchor: 0 | 1 | 2 | 3;                       // dim 29
  staticTotalA: Record<KindName, Per4>;             // the sum of A over the district's cells; stubs use it directly
  cellIds: Id[];                                    // in grid order, then venues (§4.1)
}
interface CellIndex {
  id: Id; district: Id; kind: 'grid' | 'venue'; host?: Id;     // a venue's grid cell
  adj1: Id[]; adj2: Id[];                           // cells at graph distance 1 and 2, each sorted by Id
  public: 'public' | 'semi' | 'private';            // dim 7, 8
  pop: Per4; headShare: number;                     // dim 18: people present per period; the share of the district's residents (0 for venues)
  presence: Record<Aff, number>;                    // dim 16: shares of entry quantity in the cell
  A: Record<KindName, Per4>;                        // dims 10, 11, 16 to 18, 20, 21, 24, 26, 27: the opportunity
  F: Record<KindName, number>;                      // the propensity weighting, in [0.5, 2]
  pairs: Array<{ a: Aff; b: Aff; w: number }>;      // gang pairs with a weight (presence product × border × hostility)
  gameCoverage: Record<KindName, number>;           // dims 16, 21, 27: 0 to 1, static (§7.2)
  services: Array<{ id: Id; type: string; poi?: string }>; marketCell: boolean;     // dim 21, 24
}
```

S1 never edits the slice. A cell that appears or disappears is a new lineage (§1.4). **Aff names.** `civilian` covers `Factions.Civilian` and `Factions.Unaffiliated`. `ncpd` is `Factions.NCPD`. Every other record keeps its name and takes its class from its animation wrapper as the game does ([population §5.1](../../../knowledge/population-and-affiliations.md#51-affiliations)).

### 3.2 The Kabuki slice and the fixture slices

**The M3 slice** `xf.kabuki.index@1` is Kabuki (Watson) plus two stubs that touch its polygon. It must reproduce the figures P3 §19.2 states: leaf area 0.49 km², vertical band −20 to 200 m; entry quantity 2,964, of which 79 % civilian and 2 % NCPD; gangs Tyger Claws 205, The Mox 112, Scavengers 48, Militech 41, Animals 18; the standard NCPD preset. A 200 m cut gives 15 to 30 cells, grid and venue; residents number about 3,000 at `rho = 1`.

**Until W1 builds it, the reference model uses a generated stand-in,** `make-kabuki-slice`, deterministic from `H("fixture", "kabuki-slice")`, for fixtures only, with no claim about the game:
- **Cells:** 12 grid cells `g0 … g11` in a 4 × 3 grid, and 10 venue cells `v0 … v9`, each hosted by `g(i mod 12)` at distance 1. Grid cell `i` has headcount share `∝ 1 + 3·rand("kslice", "pop", i)` of 3,000 residents. People present: grid `headcount × [0.9, 1.0, 1.1, 0.7]`; venue `60 × [0.2, 0.4, 1.0, 0.8]`. Venues are `semi`; grid cells `public` except `g0`, `g5`, `g10` (`private`).
- **Presence:** the district shares (entry quantity ÷ 2,964) times `0.4 + 1.2·rand("kslice", "pres", cell, aff)`, rescaled so the headcount-weighted mean equals the district share; civilian takes the remainder to 1.
- **Opportunity:** `A = T·(b + O)·(1 − G)`, with `T = pop[p] · (1 + 0.5·services)`, `O = Σ presence · rw[kind][class]`, `G = min(0.9, 4·ncpd + 2·corp)`, `b` and `rw` from §5.2; gang-clash uses `O = Σ pairs.w`. `F = 0.5 + 1.5·rand("kslice", "F", cell, kind)`. A pair's `w = presence_a · presence_b · (1 + 2·border) ·` hostility (hostile 1, neutral 0.3, friendly 0); `border = 1` on the six edge cells.
- **Coverage and services:** `gameCoverage = 0.25` for `theft`, `assault`, `gang-clash` in `g3` and `g8`; each venue has one service, `v0 … v4` vendors with `marketCell`; `g6` has a ripperdoc, `g1` a fast-travel point.
- **Stubs:** `Northside` and `Little China`: entry totals from [places §9.3](../../../knowledge/places.md#93-gang-presence-by-area), `staticTotalA` so Kabuki's share of each kind is 4 %, and `rest.totalA` three times the sum of the listed districts.

**The fixture slice `FX-3`** is for unit fixtures. One district `D1`, `rho = 1`, 90 residents, three grid cells `c1`, `c2`, `c3` in a line (`adj1(c1) = {c2}`, `adj1(c2) = {c1, c3}`, `adj2(c1) = {c3}`), headcount shares 0.5, 0.3, 0.2, `pop` flat 100, `public` for `c1` and `c2`, `private` for `c3`. Gang affiliations `GA`, `GB`, plus `civilian` and `ncpd`, with entry shares 0.10, 0.06, 0.82, 0.02. All `F = 1`; all `gameCoverage = 0` except `gang-clash` at `c2` = 0.5. `A(c, k, p)` is 1.0, 2.0, 0.5 for `c1`, `c2`, `c3` for every kind and period. `staticTotalA` is 3.5 and `rest.totalA` 31.5, so the district's share of each kind is 0.1. One market cell (`c1`).

### 3.3 Settings in force

`SettingsView` is the `SettingsSet` in force at the snapshot ([S0 §14.2](kernel.md#142-records-and-branching)). S1 reads `cityScale` (multiplies every citywide rate and offspring mean, §7.2, and cannot lift a mean past its bound, §5.2); `classExclusions` and `content` ceilings (the gate and the zero rate of an excluded kind, §6; `content` is sensitive and never written to an S1 digest, log or export); `memoryScale` (recorded, inert until the memory machinery lands); not `tempo` (occurrence is not the director's).

**When a change takes effect.** A settings op, a new `observed` pin, a new `core:cast` edge or a new demand is stamped in some window `j`. The kernel applies it at boundary `j + 1` (S0 §9.4, step 2). It is in force for the run of window `j + 1` and every later one. **No window is ever computed under a setting or a protection that arrived after its run started, and no output is revised afterwards.** The settings in force at **production time** apply ([S0 §9.2](kernel.md#92-events)). Replayed history is never re-filtered.

### 3.4 The replay port

The offline replay port feeds the model what the game's feed would. It is the first client of the mirror, and the only one in M3 ([D-18](../decisions.md)). It mirrors the catalogue of the runtime bridge's command API and reads hand-authored story states.

**A replay script** is a list of timestamped lines. The port turns each into an external operation stamped with that time ([S0 §9.4](kernel.md#94-evolution)).

```ts
type ReplayLine =
  | { t: GameTime; op: 'reading'; node: string; slot: string; value: Value }       // a mirrored slot of a mirrored node
  | { t: GameTime; op: 'fact'; name: string; value: number }                       // a game fact; node H("game", "fact:" + name)
  | { t: GameTime; op: 'event'; kind: string; place: string; participants: Array<{ who: string; role: string }>; effects?: Array<{ on: string; effect: Effect }>; witnesses?: number }
  | { t: GameTime; op: 'person'; key: string; slots: Record<string, Value> };      // declares a mirrored person: H("game", key)
```

Node names in a script are game keys; the port resolves them to `H("game", key)`. An `event` line becomes an external `event` operation whose creator and cause are `port` and whose `name` is `raw/<t>/<n>` for the `n`-th raw event stamped at `t`. Its kind is a raw kind, or any registered kind whose producers include `port` (the enforcement kinds of §5.3, for the norm demonstration). The raw kinds, each carrying its meaning in its name and participants because an event has no free payload ([S0 §9.2](kernel.md#92-events)):

- `game.death` (feed kind `death`): `victim` (a mirrored person), optionally `actor` (the killer, which may be `v`); effect `kill` on the victim.
- `game.combat.start`, `game.combat.end` (`combat`): up to four `hostile` mirrored persons.
- `game.heat.0` … `game.heat.5` (`heat`): no participants; the previous stage is the mirrored slot `v.wanted` at the event's time.
- `game.district` (`district`): none; V's new district is the mirrored slot `v.district`.
- `game.journal.finished`, `game.journal.failed` (`journal`): one `entry` (a mirrored journal node with slots `family` and `district`).

The other feed kinds do not become raw events for S1: `session`, `time` and `fact` act through the kernel and the facts table, `vehicle` through V's mirrored slots, `dialogue` and `call` through S2.

**Mirrored slots S1 reads.** A mirrored person (`xf:person`, extending `core:person`) has `affiliation` (an `Aff`), `alive`, `crowd`, `age-class` (adult or minor), `position`, `quest-linked`. `v` has `position`, `district`, `wanted` (0 to 5) and `cell` (derived by the port from position and the slice's polygons, [places §3.2](../../../knowledge/places.md#32-how-the-game-knows-where-v-is)). A missing reading is `unavailable` and S1 treats it as unknown, never as a value.

## 4. The people

Nobody is simulated until something asks. A resident is a pure function of the world seed, the district's recipe and the resident's identity, so a person can be dropped and drawn again unchanged ([S0 I-3](kernel.md#15-invariants)). Only pins, observed facts and committed seeds persist.

### 4.1 Cells, blocks and headcounts

A **cell** is the finest place S1 counts incidents in. A **block** is a grid cell, the place where residents live. A venue cell has no residents and has people present by period (`pop`). A cell's `Id` is `H("gen", leaf, "cells", i)` in the index's grid order. The schema pack `xf.core.world@1` defines `xf:district` (extends `core:place`; slot `cells`, many node `xf:cell`) and `xf:cell` (slots `headcount`, `households`, `band`):
- `headcount`: int, derived `round(rho × entry.total × headShare)`; 0 for a venue;
- `households`: many node `xf:household`, count derived `ceil(headcount / meanHH)`, with `meanHH` fixed by the recipe fit (§7.4);
- `band`: enum quiet, elevated, hot, flashpoint; assigned; temporal `W`.

The realised number of residents of a block is the sum of its household sizes, a few per cent off `headcount`. **`headcount` is nominal.**

### 4.2 Residents, households, spells and the resolved schema

**The profile.** A resident has a **profile**: one cell of the district's joint table over four attributes.

| Attribute | Values |
|---|---|
| Age band (8) | 16 to 17; 18 to 24; 25 to 34; 35 to 44; 45 to 54; 55 to 64; 65 to 74; 75 and over. **These are S1's bands** (ages `[16,17] [18,24] [25,34] [35,44] [45,54] [55,64] [65,74] [75,90]`). S0's ten-year `age-band` is not used |
| Role (12) | `vendor`, `shopkeeper`, `service`, `nightlife`, `labourer`, `technician`, `corporate`, `gang`, `police`, `student`, `unemployed`, `retired` |
| Income band (4) | `destitute`, `low`, `middle`, `high` |
| Affiliation class (6) | `civilian`, `ncpd`, then the district's three largest listed affiliations (`A1`, `A2`, `A3`, by entry quantity, ties by record name, neither `civilian` nor `ncpd`), then `other`. For Kabuki: `civilian`, `ncpd`, `TygerClaws`, `TheMox`, `Scavengers`, `other` |

That is `8 × 12 × 4 × 6 = 2,304` cells. The profile is the enum `"0" … "2303"`, index `x = ((a·12 + r)·4 + i)·6 + f`, plus `"none"` for a household member who does not exist. So `a = ⌊x/288⌋`, `r = ⌊x/24⌋ mod 12`, `f = x mod 6`. The **recipe** is the table `t[0 … 2303]` fitted once by §7.4 and installed as `Table` contributions on the `p0 … p5` slots of the district's households.

**The resolved schema** (pack `xf.core.world@1`). Slots are in declaration order. Every read is of an earlier slot of the same node or of the owner chain ([S0 §2.3](kernel.md#23-dependencies-are-well-founded)). The schema loader checks this and refuses a schema that fails it, so the order below is part of the contract.

| Kind | Slot | Mode | Rule |
|---|---|---|---|
| `xf:household` | `hprofile` | sampled, enum of 60 (type 5 × tenure 3 × wealth 4) | `Table` (the household table). Types `single`, `couple`, `family`, `shared`, `crew` |
| | `extra` | sampled, int 0 to 3 | conditioned on the type of `hprofile` (`extraWeights`) |
| | `size` | derived, int | `min(6, base(type) + extra)`, `base` = 1, 2, 3, 2, 3 |
| | `p0 … p5` | sampled, enum (a profile or `none`), in this order | `Const none` when `j ≥ size`; else the district `Table` and the roster rules below, which may read `hprofile`, `size` and `p0` |
| | `m0 … m5` | owned nodes of kinds `xf:resident-0 … xf:resident-5` | the owned value `H("val", household, "m" + j)` |
| `xf:resident-j` | `profile` | derived, enum | identity of the owner's `p_j`, with identity preimage: a pin on the profile narrows the household's slot (S0 §6.4) |
| | `aband`, `role`, `affc` | derived, unary views of `profile` | `a`, `r`, `f` above, each with its preimage set |
| | `name`, `age`, `age-band`, `traits`, `position`, `place`, `age-class` | as `core:person` (S0 §2.6), without `drives` | `age` is **sampled** (int 16 to 90) with eight rules, one per band `b`: `when aband = b, then Range(lo_b, hi_b)`. `age-class` derives from `age` |
| | `archetype` | sampled, enum | `Table` rules by `role` (§4.3) |
| | `life` | sampled, enum of 16 equiprobable bins | the lifetime (below) |

A resident whose profile is `none` does not exist. There are six resident kinds, one per position, so no derive needs a member index. The age of a resident is uniform within the band of its profile, so the ages the production gate checks are the ages the profile says. When drive-states return (§0.3), each declares `noise` before `importance`: an owner never reads its owned values, and a node reads only its earlier slots.

**Roster rules.** Each household type has a roster `data.people.rosters[type][j]`: the S1 age bands allowed for member `j`, a relation to member 0 (`any`, `gapAtMost1`, `gapAtLeast2`: the difference of band indices) and `sameAff` (true for `crew`). The pack builder turns each row into a `constrain` contribution `Rule(when: type = T and size > j [and band(p0) = b], then: Set(profiles satisfying the row))`, layer `simulation`; at most 40 rules apply to any `p_j`.

| Type | Member 0 | Member 1 | Members 2 to 5 |
|---|---|---|---|
| `single` | 18+ | none | none |
| `couple` | 18+ | 18+, `gapAtMost1` | none |
| `family` | 25 to 54 | 18+, `gapAtMost1` | 16 to 24, `gapAtLeast2` |
| `shared` | 18 to 54 | 18 to 54 | 18 to 54 |
| `crew` | 18 to 44, a gang-class affiliation | `sameAff` | `sameAff` |

Dependants younger than 16 are not residents: they are a count, and a pack kind opens one when a story needs one. The **seed table of the fit** is the product of three pack factor tables, `ageRole` (8 × 12), `roleAff` (12 × 4 classes) and `roleIncome` (12 × 4), with a floor. M3 defaults: `ageRole` is 0 where the role cannot occur (`student` at 55 and over, `retired` below 55, `police` and `corporate` below 21 or above 64, `gang` above 54), 0.05 where it is rare, else 1; `roleAff` makes `police` possible only for `ncpd` and `ncpd` only for `police`, `gang` only for gang-class affiliations, `corporate` favour corporation-class affiliations, and gives every other cell 1. A "0" means the floor of §7.4.

**Spells.** M3 has two tracks, `work` (employed, between jobs) and `health` (well, ill), each alternating between two states. The length of spell `k` is drawn from a keyed table of 16 quantiles:

```ts
spellLen(person, track, k) = lenQ[track][stateOf(k)][ageBand(person)][floor(rand("spell", person, track, k) * 16)]   // seconds
spellState(person, track, k) = (k + s0) mod 2, with s0 = rand("spellv", person, track, 0) < pA[track][ageBand] ? 0 : 1
anchor(person, track) = -floor(rand("anchor", person, track) * lenQ[track][s0][ageBand][15])    // the start of spell 0, at or before game time 0
```

`stateAt(person, track, t)` walks from the anchor until the end of spell `k` passes `t`, and returns `{ k, state, start, end }`. The walk is at most 64 steps (more is a defect `walk-limit`, and the last state holds) and is cached by revision and `t` ([S0 §5.5](kernel.md#55-caching)). The M3 tables are `lenQ[track][s][band][q] = base[track][s] × m[band] × (0.2 + 1.8 × q / 15)` seconds, with `base` in days: work 700 and 90, health 120 and 4, and `m` = 0.6, 0.8, 1.0, 1.0, 1.0, 1.1, 1.2, 1.2 across the bands. `pA` is 0.8 for `work` and 0.95 for `health`.

**The lifetime** is the sampled slot `life`: `deathAge = max(age + 1, lifeQ[life])`, `lifeQ = [45, 55, 60, 65, 68, 71, 74, 77, 80, 82, 84, 86, 88, 90, 92, 95]` **[tunable]**. A resident dies of age at `t = (deathAge − age) × 31,557,600` s. Age does not advance with `t` (P3 §4.3), so in a playthrough of months this is moot. **`alive(r, t)`** is true unless `t` is at or after the age death, or a death pin (a story event, a mirrored `alive = no`) is valid at or before `t`: a pure function of the resident and recorded history.

**Traits.** One coarse trait, `sociability`, is a `core:trait` member of the resident, drawn by the kernel, with strength 0.2, 0.5 or 0.8 and prior (0.25, 0.5, 0.25) **[tunable]**. An author may fix it for a named person.

### 4.3 Archetypes, names and binding

**Archetype.** `archetype` is a sampled enum slot with eight archetypes and the default `resident`: `street-vendor`, `gang-member`, `gang-leader`, `fixer`, `police`, `service-worker`, `young-street`, `elder`. In M3 it sets only a person's schedule (§4.5). `Table` rules by role: `vendor` and `shopkeeper` give `street-vendor`; `service` and `nightlife` `service-worker`; `gang` `gang-member`; `police` `police`; `student` `young-street` 0.6 and `resident` 0.4; `retired` `elder` 0.7 and `resident` 0.3; every other role `resident`. `gang-leader` and `fixer` are never sampled: canon assigns them. Archetypes are by role, never demographic (§12, the source lint).

**Names.** The pack's name registry gives `origin` weights by district and affiliation class (pack `Rule` contributions on `core:name.origin`, reading `affc` through the owner chain), and `given` and `family` conditioned on the origin (`enum-by`). Origin feeds no policy.

**Binding to a body.** The game never creates a street person from nothing; S1's resident is a **model person** that a body may stand for. `bind(community, entry, spot, ordinal, castType)` makes up to 24 attempts: attempt `a` takes the resident at block position `floor(rand("bind", community, entry, spot, ordinal, a) × residentCount(block))` and accepts it if it is alive, fits the cast type (affiliation class and adulthood) and is not protected; otherwise it returns `fallback`, with a defect `bind-fallback` (the port's runtime entity id stands in). A casting type's `isChild` flag has no resident and always falls back. **A resident is pinned `observed` when V notices them.** The `look key` S1 hands to P8 is `H("look", resident)`. If the binding key proves unreadable or unstable (P3 open question 3), binding falls back to the session. This is the port's matter and outside M3's completion criteria.

### 4.4 The protected set, canon people and the spine

**The protected set** is what harm events and absences choose outside of. It is read from the kernel, never stored. `protectedAt(n, t)` is true if `n` has a `core:cast` edge from a live `core:seed` (S2) as of `t`; or has an `observed` pin (V has met them) as of `t`; or is a mirrored canon person (`quest-linked`, or a spawn set, fixer or vendor the game pins); or is the spine; or carries a pack `essential` flag. `protectedSet(n) = protectedAt(n, now)`. Casting uses `protectedAt` at an occurrence's own time (§5.4); the gate uses `protectedSet` at production time (§6).

**Canon people** are mirrored nodes `H("game", gameKey)`. S1 holds beliefs about them and ties with V, and nothing the game records about them. **`isSpine(n)`** answers whether a node is a canon character of the main story, from the characters whose fate the game's final boards read ([main-story state §4](../../../knowledge/main-story-state.md#4-characters-whose-state-the-game-tracks)), joined to mirrored nodes by game key.

### 4.5 Where people are

**Order.** Residents of a block are ordered by `(household index h, member j)`; the ordinal of `(h, j)` is `prefix(h) + j`, `prefix(h) = Σ_{h' < h} size(h')`, cached per block by revision. `residentCount(b)` is `prefix(households#count)`, and `residentAt(b, n)` finds the household by binary search.

**Routines.** `where(person, t)` is a pure function, never ticked, and applies only to people the game does not place. A mirrored or game-placed person keeps the game's position.

```ts
type Whereabouts = { cls: 'home' | 'work' | 'out' | 'away'; cell?: Id; cause: 'none' | 'ill' | 'closed' | 'between-jobs' | 'protected-present' };
function where(person: Id, t: GameTime): Whereabouts {
  const day = dayIndex(t), p = periodOf(t), arch = archetypeOf(person);
  let cls = schedule(arch)[p][invCum(schedule(arch)[p], rand("sched", person, day, p))];       // 'home' | 'work' | 'out'
  let cause = 'none';
  if (protectedAt(person, t)) return { cls, cell: placeOf(person, cls, day, p), cause: 'protected-present' };   // never removed
  if (stateAt(person, 'health', t).state === 1) { cls = 'away'; cause = 'ill'; }
  else if (cls === 'work' && stateAt(person, 'work', t).state === 1) { cls = 'home'; cause = 'between-jobs'; }
  else if (rand("absent", person, day) < absentP(arch)) { cls = 'away'; cause = closedCause(person, t) ?? 'none'; }
  return { cls, cell: placeOf(person, cls, day, p), cause };
}
```

`schedule(arch)[p]` is a weight triple (home, work, out) per period. `placeOf`: home is the resident's block; work is a workplace cell drawn once among the block, its `adj1` and (for market roles) the market cells among them, by `rand("work-place", person)`; out is a public cell among the block and `adj1` by `rand("out-place", person, day, p)`; away has none. `closedCause` returns `closed` when a regime closes the person's stall. `absentP` is 0.08 **[tunable]**. M3 defaults (home, work, out):

| Archetype | M | D | E | N |
|---|---|---|---|---|
| `street-vendor` | 0.1, 0.8, 0.1 | 0.1, 0.8, 0.1 | 0.3, 0.5, 0.2 | 0.9, 0, 0.1 |
| `service-worker` | 0.3, 0.5, 0.2 | 0.2, 0.5, 0.3 | 0.1, 0.6, 0.3 | 0.2, 0.6, 0.2 |
| `gang-member` | 0.3, 0.1, 0.6 | 0.2, 0.2, 0.6 | 0.2, 0.2, 0.6 | 0.3, 0.1, 0.6 |
| `police` | 0.1, 0.8, 0.1 | 0.1, 0.8, 0.1 | 0.2, 0.7, 0.1 | 0.4, 0.5, 0.1 |
| `young-street` | 0.4, 0.2, 0.4 | 0.2, 0.2, 0.6 | 0.1, 0.1, 0.8 | 0.4, 0, 0.6 |
| `elder` | 0.5, 0.1, 0.4 | 0.5, 0.1, 0.4 | 0.7, 0, 0.3 | 0.95, 0, 0.05 |
| `resident`, others | 0.4, 0.4, 0.2 | 0.3, 0.4, 0.3 | 0.5, 0.2, 0.3 | 0.9, 0, 0.1 |

**Who is present in a scene.** `presentAt(cell, t, cap)` lists the residents of the cell's block and its `adj1` blocks (for a venue, its host and the host's `adj1` blocks) with `alive(p, t)`, `where(p, t).cell = cell` and `cls ≠ away`, in block order (own block first, then `adj1` by `Id`), then ordinal, cut to `cap` (60 **[tunable]**) by `rand("present", cell, person)` ascending, ties by `Id`. Only the cut residents are resolved. A cell's headcount for the period is `pop[p]`.

### 4.6 The tie function

Most ties between ordinary people are never stored. A tie is a symmetric keyed draw on a pair of residents `(a, b)` of one district.

**Foci** are rosters the engine already has, each a keyed partition of a block's residents, so a roster costs nothing to store: `household` (the household; share 1), `crew` (gang-class residents in cells of about 12, `n = max(1, round(headcount × gangShare / 12))`, resident `r` in cell `floor(rand("focus", "crew", r) × n)`; share 0.3), `work` (residents with a work role, cells of about 10 by role group; k = 3) and `market` (vendors and shopkeepers in a block with a market cell on it or its `adj1`, rows of about 8; k = 3). A focus id is `H("focus", type, block, group, cell)`. A focus type has either a `share` (`p_f = share`) or a `k` (`p_f = min(1, k / (n_f − 1))`, `n_f` the expected size). The table is `data.ties.focus`.

```ts
function tie(a: Id, b: Id): { tied: boolean; kind: string; layer: 1 | 2 | 3 } {      // symmetric, a ≠ b
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const shared = sharedFoci(lo, hi);                                  // in focus-id order
  let q = 1;
  for (const f of shared) q = q * (1 - pFocus(f));
  const pg = 0.5 * (pGeo(lo, hi) + pGeo(hi, lo));                     // made symmetric
  const p = 1 - (1 - pg) * q;                                         // 1 - (1 - pg)(1 - pFoci)
  return { tied: rand("tie", lo, hi) < p, kind: kindOf(shared), layer: layerOf(shared) };
}
function pGeo(a: Id, b: Id): number { return data.ties.cGeo / (HN * rankOf(a, b)); }       // HN = Σ_{r=1..N} 1/r, in order; cGeo [tunable 8], and cGeo ≤ HN is checked at load
```

`rankOf(a, b)` is `1 +` the number of residents who come before `b` in `a`'s walking order: `a`'s block first (cyclic successor order, `(ordinal(b) − ordinal(a) − 1) mod n`), then the other blocks by `(graph distance, block Id)`, inside a block `B` by `(ordinal(b) − anchor) mod n_B`, `anchor = floor(rand("rank-anchor", a, B) × n_B)`. There are no far ties in M3. `kindOf` is the strongest shared focus (`household` → `kin`, `crew` → `crew`, `work` → `colleague`, `market` → `neighbour`; none → `neighbour`), and `layerOf` follows it (household 1; crew, work, market 2; geography alone 3). **Triadic closure needs no rule:** shared foci give it. The tie function never reads a reputation ledger.

**`neighbours(a, layer, cap)`** enumerates `a`'s ties up to a layer, inner first (focus id, then ordinal), then outward blocks by `(graph distance, block Id)`, skipping duplicates, with caps `{1: 5, 2: 15, 3: 50, 4: 150}`. Each `tie` test costs 50 allowance units, each roster member 1, the call 5,000 at most. The caps bound how many ties are *opened* for one person, not how many exist.

**Materialisation.** A tie becomes an edge `xf:tie`, `Id` `H("edge", "xf:tie", lo, hi)`, cause `sampled`, when V observes it, a belief about it is formed or told, or a seed casts through it. A person has at most 20 materialised ties **[tunable]**; a new one beyond that ends the weakest edge that neither V, a live frame nor a memorable belief depends on (ties by `Id`). If none can be ended, the new tie isn't made and the refusal is logged `tie-cap`. **V is outside the cap:** the record of whom V knows is never trimmed, and a tie to V never counts as the weakest. **Position:** `bridge(p) = 1 − Σ_f s_f²` over the shares `s_f` of a person's expected contacts in each focus (`p_f × (n_f − 1)` over the sum). A fixer has `bridge ≥ 0.6` across at least three foci of different class; for a canon person the shares are pack-declared.

### 4.7 The tie record

Stable ties and recorded interactions are the core of the relationship layer. All numbers are **[tunable]**.
- `tie(A, B)`: edge `xf:tie`, symmetric; attrs `kind` (`kin`, `crew`, `colleague`, `neighbour`, `friend`, `rival`), `status`, `strength` (q 1/64), `lastContact` (int, −1 if none); data `history`.
- `regard(A → B)`: edge `xf:regard`, directed; `warmth`, `respect` (−1 to 1), `trustA`, `trustB`, `trustI` (0 to 1), `evN`. `belief(A about B)` is the kernel's belief record.
- **For a tie with V, only the NPC's side exists.** There is no `regard(V → NPC)` and no field that models V's feelings ([D-09](../decisions.md)).
- A tie below tier 4 is `{ kind, status, strength, lastContact }`; opening it derives the rest from the history.
- `history` holds at most 32 entries `{ event, salience 0..3, reason, kind }`, newest last. Salience rises by 1 (to 3) for an act that touched the NPC's concerns and for an act V returned to. Entries at salience 0 older than 14 game days are dropped; when full, the lowest salience, then the oldest, goes first.
- `strength = q64(0.25 × (timeP + intensityP + intimacyP + servicesP))`, each part in 0..1 and read from the history and `t`, **never pinned** (§15 item 4): `timeP = min(1, sharedHours / 200)`, `intensityP` = the maximum over entries of `salience/3 × recency(age)` (1 up to 7 days, 0.7 up to 30, 0.4 up to 90, 0.15 beyond), `intimacyP = min(1, disclosures × 0.25)`, `servicesP = min(1, favours / 6)`.

**Typed interaction events** (`bid`, `reply`, `disclosure`, `favour`, `conflict`, `repair`, `joint-activity`, `crisis`) each cite their cause. The NPC's regard updates per event by `data.ties.deltas`:

| Event | warmth | respect | trustA | trustB | trustI | Other |
|---|---|---|---|---|---|---|
| `reply` accepting a bid | +0.08 | +0.02 | 0 | 0 | 0 | |
| `reply` declining | −0.01 | 0 | 0 | 0 | 0 | |
| `disclosure` by V | +0.05 | 0 | 0 | +0.02 | 0 | intimacy +1 |
| `favour` by V for the NPC | +0.10 | 0 | +0.02 | +0.08 | 0 | services +1 |
| `conflict` | −0.15 | −0.05 | 0 | −0.03 | −0.05 | |
| `joint-activity` | +0.03 | 0 | 0 | 0 | 0 | hours + the activity's duration |
| `crisis` | ±0.10 | ±0.05 | by attribution | by attribution | by attribution | |

A negative trust delta is multiplied by `m_att`: 1.5 when the belief about the cause is dispositional (`attr@1`, §8.3), 0.5 when situational, 1 when unknown. `evN` rises by 1 per row. A `repair` restores each trust component by `repairFraction × its last loss` (0.5 for an apology, 0.8 with restitution), never more than was lost.

**Status** is kept apart from the private variables: `acquainted`, `friendly`, `close`, `strained`, `estranged`, `ended`. A status change that involves V needs **an observed V act and the NPC's own acceptance**:

```ts
pAccept = clip01(accBase[rung] + 0.4 * warmth + 0.3 * (trustMean - 0.5) + 0.2 * (sociability - 0.5));   // accBase: friendly 0.5, close 0.3
accepted = !boundaryAt(npc, rung) && rand("accept", tie, event) < pAccept;        // the key names the tie and the act; a reload reproduces it
```

A boundary pin on the rung refuses without a draw. A fall is the NPC's own consequence: `strained` when `warmth < −0.4` and `trustMean < 0.3`, back to `acquainted` when both recover above −0.1 and 0.4. `ended` is by V's retract or the NPC's exit, never by absence.

**Replies.** V's reply to a bid is classified from acts within `replyWindow` (60 windows): `accept`, `decline`, `deflect` or `none`. A `none` is "no answer", never a rebuff, **unless V had a chance to answer** (V was in the NPC's district at a boundary inside the window): then it counts as a `decline` at half effect.

**Consent.** A boundary is a persistent `authored` or `observed` pin on the NPC's `boundary` slot (an enum set of rungs), with a reason. S1 never generates intimate scene content and refuses any occurrence carrying a `sex.*` tag (§6). A **retract** of V's soft-excludes the thread: the observed event `retract` with the tie id adds it to `softExcluded`, and no bid, event or frame is made for it, while the thread stays visible and editable. Absence alone has no cost, and nothing in S1 schedules offers to retain, builds a streak or applies guilt (§12). **No value of this section is shown to V:** they reach traces and the decision log only.

## 5. The event catalogue

### 5.1 The kind registry

Event kinds are pack data. An event's kind is the value of its `kind` slot (S0 §9.2), registered in the event-kind registry ([S0 §10.5](kernel.md#105-changes-and-matching)). Selectors and patterns match kinds through `where` predicates on that slot, never through schema `KindId`s. A registry entry `KindDef1` has: `name`; `family` (`city`, `order`, `social`, `mirror`, `raw`); `tags`; `effects` (pairs of a role name and an `Effect` of S0 §10.8); `producers` (process ids, policy names, `s2`, `port`); `sizes` (1 to 4 for city kinds, else `[1, 1]`); `classes` (the content listing: class, shown 1 to 3, reported 1 to 3; or `none: true`); `roles` (§5.4); `severity` and `pulse` (0 to 1: telling selection, §8.4, and salience, §8.3); `carrier` (channels and days: civic memory, the S2 `cosmetic` schema). City kinds add `hourShape`, `dayShape`, `pulses` (§7.1), `base` and `rw` (the flat term and the offender role weights, §5.4), `offspringFactor`, `delayBins` and `matrix` (§5.2).

**Lints, at load.** A pack is refused, with the kind named, if: a kind has no producer, no carrier or no content listing; a city kind's **base** offspring mean (`offspringFactor × max over its sizes of n_m`, regime 1, `cityScale` 1) is `nMax` (0.85) or above; a rate is non-zero for a size outside the kind's `sizes`; a driver names an absent place dimension or the crime multiplier (dimension 12); a matrix row names an unknown kind; a kind has a name starting `meta:` and a producer in S1; a ladder has no rung with an empty or lowest class.

### 5.2 The ten city kinds (M3 data)

They are rows of data. No kind has code of its own.

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

**The city rate table** (`data.shape.rate`, per game day for the whole city, at shape 1, before `cityScale`). The columns sum to the size ladder of [P3 §5.2](../p3-simulation-layer.md#52-incidents): 300, 45, 6 and 0.8.

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

Each step is about 6 to 8 times rarer, a log-linear law of slope 0.8 to 0.9 in base ten. Size is the reach of consequence, not severity: m1 reaches the cell and the ties of those present; m2 the district's talk within a game day; m3 the district, its neighbours and the feed; m4 several districts; m5 the city and is authored only.

**Drivers** (`base` and `rw`, used by the offender term, §5.4). `rw` for gang, corporation, ncpd classes: `theft` and `assault` 1.0, 0.1, 0 (`base` 0.02, 0.01); `gang-clash` the pair weight, 0, 0 (`base` 0; the opportunity is the sum of the cell's `pairs`); `shakedown` 1.0, 0, 0 (one group's presence); `police-action` 0, 0, 1.0 (the offender is the responder); `disorder` 0.3, 0, 0 (`base` 0.01); `psycho-break` 0 (`base` 0.01); `accident` 0 (`base` 0.03); `outage` 0 (`base` 0.01); `commerce` 0 (`base` 0.02).

**Offspring** (`data.events.offspring`). The base mean by parent size is `n = [0.20, 0.30, 0.45, 0.60]` for m1 to m4, times the kind's `offspringFactor` (1 for all but `police-action` 0.5, `commerce` 0.6, `psycho-break` 0.5, `outage` 0.8), times `cityScale`, times the kind's regime modifier at the child's birth (§7.2). **The effective mean is clamped: `nEff = min(nMax, that product)`, with `nMax = data.events.nMax` 0.85 [tunable].** No setting and no pile-up of regimes can lift it past `nMax`, and every clamp is counted and logged `n-clamped`. Every row of the branching process then has fewer than one expected child, so cascades are subcritical. **Generations are capped.** An immigrant is generation 0, a child its parent's generation plus 1, and an occurrence of generation `data.events.genMax` (4 **[tunable]**) draws no offspring. Every chain therefore reaches its origin within `genMax` links, and the calendar is never used as population control: its cap (§7.2) is a fault limit.

The dispersion is `k = 0.3`; at most 8 children. The delay bins, in windows, are `[1, 1], [2, 6], [7, 36], [37, 144], [145, 1008], [1009, 4320]`, with default weights `[0.15, 0.25, 0.30, 0.20, 0.08, 0.02]`; `police-action` has `[0.5, 0.35, 0.12, 0.03, 0, 0]` and `gang-clash` `[0.05, 0.15, 0.3, 0.3, 0.15, 0.05]`. The child's size is its parent's plus a step: −1 weight 0.60, −2 weight 0.25, 0 weight 0.12, clamped to the child kind's `sizes`. (A +1 step needs an arc budget, which is not built.)

**The interaction matrix** (the kind of a child by the parent's kind; weights are relative; a kind excluded by the player's lines is removed from every row, which is renormalised, §6): `theft`: `theft` 0.5, `police-action` 0.5. `assault`: `assault` 0.4, `police-action` 0.6. `gang-clash`: `gang-clash` 0.5, `police-action` 0.4, `disorder` 0.1. `shakedown`: `assault` 0.5, `police-action` 0.3, `shakedown` 0.2. `police-action`: `police-action` 0.75, `disorder` 0.25. `psycho-break`: `police-action` 1. `disorder`: `police-action` 0.6, `theft` 0.4. `accident`: `police-action` 0.8, `outage` 0.2. `outage`: `accident` 0.4, `theft` 0.4, `disorder` 0.2. `commerce`: `theft` 1.

**Content listing** (the starter classes, shown / reported; S4's registry owns the final names), then severity, pulse and carrier (channels, days): `theft` `property` 1/1; 0.4; 0.3; people, 7. `assault` `harm.residents` 2/1; 0.7; 0.6; people, 14. `gang-clash` `harm.residents` 3/2 and `harm.groups` 2/1; 0.9; 0.8; people and place, 30. `shakedown` `property` 2/1 and `harm.residents` 1/1; 0.5; 0.4; people, 14. `police-action` `harm.residents` 2/1; 0.5; 0.4; people, 7. `psycho-break` `harm.residents` 3/2 and `dread` 2/1; 1.0; 0.9; media, 60. `disorder` `harm.residents` 2/1; 0.6; 0.6; media and place, 30. `accident` `harm.residents` 2/1; 0.5; 0.5; place, 7. `outage` none; 0.3; 0.4; place, 3. `commerce` none; 0.1; 0.1; people, 2.

### 5.3 The other kinds

- **Order, `regime-start` and `regime-end`** (producer `city.events`): size 3 or the regime's. Lifecycle notices: `regime-end` is never refused and never counted by a budget (§7.2).
- **Order, `enf.<norm>.<rung>`** (producers `order.norms`, `port`): one kind per norm and rung of its ladder, **generated from the norm records at pack load**. Tags `enforcement` and `norm:<norm>`. The norm and rung are in the kind name because an event has no free payload (S0 §9.2). Effects by rung: `meet` (word), `take` (shun, fine), `expose` (public shaming), `harm` (beating). A pattern may match the tag.
- **Mirror** (producer `city.mirror`): `gig-outcome` (size 1, no effects, class none), and the ten city kinds derived from raw events (§7.3), whose creator is the mirror process.
- **Raw** (producer `port`): `game.death`, `game.combat.start`, `game.combat.end`, `game.heat.0 … 5`, `game.district`, `game.journal.finished`, `game.journal.failed`. Records of what the game did; never filtered or edited.
- **Ties:** `reply` (producer `ties`); `bid`, `disclosure`, `favour`, `conflict`, `repair`, `joint-activity`, `crisis`, `retract` (producers `s2`, `port`: acts that seeds or V make; S1 consumes them).
- **Social:** `tell` (producer `social`, §8.4) has **no effects**: its roles are `teller`, `listener` and `subject`, and the subject is an informational participant, not a target. `promise`, `threat`, `confess`, `betrayal`, `expose`, `conceal` come from `s2`; `expose` is the consequential disclosure and is governed by the targeting rules (§6).

A kind appears in the registry only when something can produce it. The kinds of the capabilities held back (§0.3) are registered when their process is built, and a pack that lists them earlier is refused by the lint. Every event S1 mints carries `causes`, `outcome` (`done` unless the occurrence failed or was prevented) and `served` where they exist ([S0 §9.2](kernel.md#92-events)). **A child is born in a later window than its parent** (§0.4). A derived mirror event takes the time of the raw event it re-describes (§7.3).

### 5.4 Roles and casting the people of an event

```ts
interface RoleSpec {
  role: string;                                     // aggressor, victim, target, hostile, responder, enforcer, giver, taker, participant
  source:
    | { from: 'offenders' }                         // the aggressor affiliation class of the descriptor's `sides.a`
    | { from: 'group'; side: 'A' | 'B' }            // a side of the occurrence's gang pair
    | { from: 'residents'; roles?: string[] }       // any adult resident present, optionally by profile role
    | { from: 'responders' }                        // an ncpd resident
    | { from: 'parent'; role: string };             // the participant of the parent occurrence
  count: [number, number];                          // at most 4 persons in all per occurrence; a minimum of 0 makes the role optional
  adult: boolean;                                   // true for aggressor, victim, target, hostile
  groupOk?: boolean;                                // an unfilled role may become group involvement (below)
}
```

M3 roles by kind: `theft`, `assault`, `accident`, `psycho-break`: aggressor `offenders` (none for `accident`), victim `residents`; `gang-clash`: aggressor `group A` and victim `group B`, both `groupOk`; `shakedown`: aggressor `group A` restricted to profile role `gang` (`groupOk`), victim `residents` of role `vendor` or `shopkeeper`; `police-action`: responder `responders` (count 0 to 2), victim `parent victim`, target `parent aggressor` (a patrol without a parent: no victim, target `residents` of a gang affiliation); `disorder`: participants `residents`, count 2 to 4; `outage`: no persons, the place; `commerce`: giver and taker `residents`.

**The offender term.** For a cell `c` and kind `k`, over the district's six classes in `affOrder`: `civilian` has weight `base_k`; every other class `f` has `presence_f(c) × rw_k[class(f)] × (1 + boost(f, k))`, with `class(other)` = gang and `boost` from the group digest (§7.8). A `gang-clash` pair is drawn from `pairs(c)` by `invCum` over their weights times any pair boost. A retaliation child swaps the sides of its parent. **`sides` is drawn once:** when an occurrence is admitted (events) or indexed (items), `invCum(offenderWeights, rand("cast-f", occ))` gives `sides.a`, and for a gang pair `rand("cast-pair", occ)` gives `(a, b)`, with the boosts in force then. That is why `sides` is stored on the descriptor (§7.2) and never re-derived.

**Casting is a pure function of a descriptor and of recorded history as of the occurrence's own time.** It is the same function for an event at admission, an item at opening and a parent re-cast for its child.

```ts
function castOccurrence(d: Descriptor): CastEntry[] | 'no-cast' {
  const present = presentAt(d.cell, d.time, 60);                      // §4.5: alive, not away, in the cell at d.time
  const out: CastEntry[] = [], taken = new Set<Id>();
  for (const spec of rolesOf(d.kind)) {
    if (spec.source.from === 'parent') { out.push(...inherit(d, spec)); continue; }    // castOccurrence(d.parentFacts), the same role; absent stays absent
    const eligible = present.filter(r =>
         !taken.has(r)
      && (!spec.adult || ageClassOf(r) === 'adult')
      && (!isHarmRole(spec) || !protectedAt(r, d.time))                // floor roles and roles with a harm effect
      && matchesSource(r, spec, d.sides));                             // affiliation class, profile role, ncpd
    const n = spec.count[0] === spec.count[1] ? spec.count[0]
            : spec.count[0] + Math.floor(rand("cast-n", d.id, spec.role) * (spec.count[1] - spec.count[0] + 1));
    for (let i = 0; i < n && eligible.length > 0; i++) {
      const j = Math.floor(rand("cast-who", d.id, spec.role, i) * eligible.length);
      const who = eligible.splice(j, 1)[0]; taken.add(who); out.push({ role: spec.role, who });
    }
    if (countOf(out, spec.role) < spec.count[0]) {                      // the role is unfilled
      const g = spec.groupOk ? groupOf(sideClass(d.sides, spec)) : undefined;
      if (g === undefined) return 'no-cast';                            // admission refuses; an item stays unopened
      out.push({ role: spec.role + '-group', group: g });               // group involvement: never an age-qualified person
    }
  }
  return out;
}
```

**Group involvement is distinct from a personal role.** A role filled by a group node is named `<role>-group`, cites the group as its participant, has no age requirement and is not a floor role. It never stands in for an aggressor, victim, target or hostile **person**. Only the groups of `A1 … A3` have nodes, so an unfilled role of any other class is `no-cast`. A `parent` role keeps the **parent's participant**, so a police response protects the original victim and names the original aggressor. **V is never drawn.** The gate checks the cast again at production time (§6).

### 5.5 Realisation candidates (data only)

S1 does not spawn anyone. For each event of size m2 and above, and for each opened m1 item, it publishes the **routes** by which the incident could arrive in view; P8 chooses and executes. This is specified for P8 and is **outside M3's completion criteria**. A `RealisationRow` is `{ kind, placeType, period, route, cost, safeRadius, viewTest, perHour }`, with route one of `scanner-hustle`, `combat-event`, `dynamic-event`, `city-scene`, `chase`, `bridge-spawn`, `none` (the default: offscreen, with a trace). M3 ships five rows: `gang-clash` public evening and night → `dynamic-event`; `assault` public evening and night → `scanner-hustle`; `psycho-break` public any → `scanner-hustle`; `police-action` public any, size 2 and above → `chase`; `theft` public any → `city-scene`; each with `safeRadius` 30 m, `viewTest` true, `perHour` 2. **A retaliation aimed at V is never realised from this layer:** no row has an aim, and the V-exclusion of §6 refuses any event with V as a victim. `gameOwnedNow(cell)` is a dynamic read that only realisation and `scene.acts` may call; a lint forbids any coarse process from reading it (§12). With no feed it answers `maybe`.

## 6. The production gate

Everything S1 *produces*, as new occurrences, passes one stateless choke point, `produce(occurrence)`, before it is published ([S0 §9.2](kernel.md#92-events), V4-23 and V4-28). Gates sit at choke points, not on each feature. **The gate holds no budget and no counter.** Budgets belong to the admission owner (§7.2), which calls the gate.

```ts
interface Occurrence {
  kind: string; origin: 'sim' | 'policy';          // a mirrored or replayed occurrence never reaches the gate
  size: number; window: number; cell?: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  creator: Id;
}
type GateReason = 'excluded' | 'floor-minor' | 'floor-real' | 'sex-tag' | 'v-target' | 'protected';
type GateResult = { ok: true } | { ok: false; reason: GateReason };
```

**The order of checks.** The first failure is the result and is logged (§2.3). A refusal is never silent.

1. **Class exclusion.** If any class listed by the occurrence's kind has ceiling 0 or is in `classExclusions` in the settings in force (§3.3), the occurrence is refused: `excluded`. The same applies to everything that depends on it: its summary count, its items, its children.
2. **The floors.** Roles `aggressor`, `victim`, `target` and `hostile` bind only persons whose `age-class` is `adult`. A missing or unavailable class counts as `minor`: `floor-minor`. A person marked real is never bound: `floor-real`. No occurrence carries a tag beginning `sex.`: `sex-tag`.
3. **V-exclusion.** An effect in `{harm, kill, take, expose}` whose `on` is `v`, or a `victim` or `target` role bound to `v`: `v-target`. V may be an `aggressor` or `actor` only in a mirrored occurrence, which the gate does not see. **Informational roles are not harm.** The `subject` of a `tell` may be V or a protected person: a telling has no effect, so nothing here refuses it.
4. **The protected set.** An effect in `{harm, kill, take, expose}` on a protected person (`protectedAt`, as of the occurrence's time), or a `victim` or `target` role bound to one: `protected`. An absence never removes a protected person (§4.5).

**Lines are exclusion at production, not thinning.** A class at ceiling 0 gets a **zero rate** for its kinds, and the offspring matrix is renormalised without them, so the world holds none of it. The gate is the backstop. The `cityScale` dial scales the citywide rates and the offspring means together and is recorded in the settings op.

**What the gate does not touch:** records of what the game itself did (raw `game.*` events) and the derived mirror events (§7.3); replayed history; veils (ceilings 1 to 3), which act at display and are S2's.

**Sanction ladders.** A ladder is pack data: rungs from the cheapest, each with `(class, shown, reported)` and an effect. A rung is produced only if its class ceiling is not 0. A ladder with no rung of an empty or lowest class is refused at load. The default ladder of the M3 norms is `word` (public talk, effect `meet`, no class), `shun` (effect `take`, class `harm.sanction` 1/1), `fine` (effect `take`, class `property` 2/1), `beating` (effect `harm`, class `harm.sanction` 3/2).

## 7. The processes

### 7.0 How each page is organised

Each process is described in the ODD order ([P3 §19.2](../p3-simulation-layer.md#192-the-first-implementation-sized-for-milestone-m3)): purpose and patterns; state; overview; design concepts; initialisation; input; submodels; agreement and validity (*conceptual*: are the mechanisms right; *verification*: does the code do what the page says; *operational*: is the output plausible). A pattern used to calibrate is never used to validate (§14.3).

**Nodes S1 owns.** The schema pack gives the district slots `grp-A1`, `grp-A2`, `grp-A3` (owned nodes of kind `xf:group`, extending `core:group`, with a `standing-v` owned node of kind `xf:standing` and the `group-gap` slot), `circle-stalls` (an owned `xf:circle`, which extends `core:group` so that it can be a membership target, with `standing-v`), and `gap-<norm>` (assigned, temporal). A group is `H("val", district, "grp-" + f)` for the class `f` in `A1 … A3`. The district also carries `standing-v`.

**Registered processes.** Every process has **period 1**. Application order at a boundary is by tier, then `id` ([S0 §9.4](kernel.md#94-evolution)). **Lag** is the publication lag (§9.4): an occurrence of window `w` is published by the boundary that ends window `w + lag`.

| Id | Tier | `coarseFine` | Lag | Digest |
|---|---|---|---|---|
| `city.events` | 0 | count | 0 | `EventsDigest` |
| `group.decide` | 0 | exact | 0 | `GroupDigest` |
| `order.stocks` | 0 | exact | 0 | `StocksDigest` |
| `city.mirror` | 1 | exact | 1 | `MirrorDigest` |
| `order.ledger` | 1 | distribution | 0 | `LedgerDigest` |
| `order.norms` | 1 | distribution | 0 | `NormsDigest` |
| `scene.acts` | 3 | count | 1 | `ActsDigest` |

There is no `city.shape` and no `people.shape` process. Regimes, the m4 budget, service status and price belong to `city.events`, so that **one process owns every budget** (E-06). The population fit is a one-off computation (§7.4).

### 7.1 The shapes, the regimes and the service state (owned by `city.events`)

**Patterns.** The spacing and budget of m4 (M14-18). Nothing here reads V.

*Shapes.* For a city kind `k` with hour shape `h_k[0..3]`, day shape `d_k[0..6]` and pulses `P_k`:

```ts
const hourOfDay = (t) => Math.floor(secondOfDay(t) / 3600);
const pulse = (k, wd, hr) => P_k.reduce((a, p) => (p.weekday === 'any' || p.weekday === wd) && hr >= p.fromHour && hr < p.toHour ? a * p.factor : a, 1);
const raw = (k, wd, hr) => h_k[periodOfHour(hr)] * d_k[wd] * pulse(k, wd, hr);       // periodOfHour(hr) is periodOf for the second hr × 3600
const M_k = (sum over wd = 0..6, hr = 0..23 of raw(k, wd, hr), in that order) / 168;      // computed once at load
const shape = (k, t) => raw(k, weekday(t), hourOfDay(t)) / M_k;                          // mean 1 over the week; evaluated at the start of the window
```

Every shape has mean 1 over a week, so the city rates of §5.2 are weekly means.

*Regimes* (`data.regimes`):

| Kind | Arrival (per district per day) | Planned length | Max dwell | Rate effects | Closes | Price shift |
|---|---|---|---|---|---|---|
| `crackdown` | 0.03 | 216 windows | 1,008 | `theft` 0.6, `assault` 0.6, `gang-clash` 0.5, `shakedown` 0.4, `police-action` 2.0, `disorder` 1.3 | none | 0 |
| `lockdown` | 0.01 | 144 | 432 | `theft` 0.8, `assault` 0.8, `gang-clash` 0.7, `commerce` 0.4, `police-action` 1.5 | `vendor`, `clinic` | +1 |
| `festival` | 0.02 | 72 | 288 | `disorder` 2.0, `theft` 1.3, `commerce` 2.0, `assault` 1.2, `accident` 1.2 | none | 0 |

*Exit.* A live regime of age `a = w − start` exits at window `w` if `a ≥ maxDwell`, or if `a ≥ plannedEnd` and `procRand(w, "regime-exit", id) < hExit(a)`, with `hExit = 0.05` for `a < 1.5 × plannedEnd` and `0.2` beyond. An exit is a **lifecycle notice**: `city.events` mints a `regime-end` event (size = the regime's, place = the district, cause the `regime-start` event) stamped `startOf(w)`. It is never refused, never consumes a budget and is applied before the window's arrivals. At equal times a `regime-end` applies before a `regime-start`.

*Arrival.* For each simulated district `d` (Id order) and each regime kind `r` (registry order) with no live regime of kind `r` in `d`: `N = spacingCount(rate_r × W / 86400, i => procRand(w, "regime", d, r, i), 1)`. If `N = 1`: the size is 4 with probability 0.1 (`procRand(w, "regime-size", d, r) < 0.1`) and 3 otherwise, and the start is `startOf(w) + floor(procRand(w, "regime-t", d, r) × W)`. This is a **candidate** for admission (§7.2). A regime is the `regime-start` event named `regime/<w>/<d>/<r>` (creator `proc(city.events)`, place `d`, no participants, no effects), and its `Id` is that event's. A regime modifies the incidents of windows **after** its start window and up to the window before its exit.

*Service status.* After the window's bands are updated (§7.2), each service in a simulated district's cells takes, from the cell's band `b`: `closed` (3) if a live regime of the district has the service type in `closes`, or `b = flashpoint`; `watched` (2) if `b = hot`; `quiet` (1) if `b = elevated`; else `open` (0). On change a pin `status@w<w + 1>` is written. A service of type `home`, `safehouse` or `apartment` is never changed. *Price level:* `price(d) = clamp(index.priceAnchor + Σ priceShift of the live regimes of d, 0, 3)`: low, fair, high, extreme.

**Validity.** *Conceptual:* time-of-day and weekday shapes are the lenses on who offends and who guards; regimes are slow, exogenous and always end. *Verification:* SF1-S-1 to SF1-S-6. *Operational:* M14-18, and the panel question of whether a crackdown or a festival is felt as one.

### 7.2 `city.events`

**1. Purpose and patterns.** It is the city's life: incidents, their causes and consequences. For every window, district and kind it decides how many incidents happen, how big, where, to whom. It keeps the aftershocks and the heat, publishes bands, and **owns production admission**. Patterns (calibrated on seeds 0 to 9, validated on 10 to 29): concentration (M14-01), the three bindings (M14-02), near-repeat excess (M14-03), offender location (M14-04), band flicker (M14-06), cluster statistics (M14-07), the delay law (M14-08), the largest follow-up (M14-09), thinning stability (M14-10), summary and item agreement (M14-16), the tail (M14-18), demand independence (M14-20), explanation chains (M14-24).

**2. State and scales.** Tier 0 (regimes) to 2 (cells).

```ts
interface EventsState {
  v: 1;
  regimes: RegimeRec[];                                     // live regimes, in Id order: { id, kind, scope, start, plannedEnd, maxDwell, size: 3|4, effects, closes, priceShift }
  services: Record<Id, { status: 0 | 1 | 2 | 3; since: number }>;
  admit: { m4Times: number[] };                             // the windows of the last two admitted size-4 occurrences (incidents or regimes)
  bands: Record<Id, { band: 0 | 1 | 2 | 3; since: number }>;     // by cell; since = the first window in which the band applies; absent = quiet
  calendar: Record<Id, PendingChild[]>;                     // by district, sorted by (due, parent, index); at most 256 each
  ring: RingEntry[];                                        // the last WEEK windows, oldest first
  next: number;                                             // next feed sequence number
  counters: { immigrants: number; children: number; thinned: number; refused: number; noCast: number; clamped: number };
}
interface Descriptor {                                      // the one authoritative record of an occurrence
  id: Id; kind: string; size: number; w: number; time: GameTime; cell: Id;
  sides?: { a?: number; b?: number };                       // affiliation-class indices, drawn once (§5.4)
  parent?: Id; gen: number; chain: Id[];                    // the cause, the generation, the ancestors nearest first (at most genMax)
  public: boolean; witnesses: number;
}
interface PendingChild {
  parent: Id; index: number; due: number;
  kind: string; size: number; cell: Id;                     // fixed at birth
  sides?: { a?: number; b?: number }; modBirth: number;
  parentFacts: Omit<Descriptor, 'public' | 'witnesses'>;    // the parent's descriptor, so firing never needs the ring (E-03)
}
interface RingEntry {                                       // enough to re-mint and to explain
  id: Id; w: number; kind: string; cell: Id;
  event?: Omit<Descriptor, 'witnesses'>;                    // an event: its descriptor
  count?: number;                                           // a summary: its count
  meta?: Record<number, { parent?: Id; gen: number; chain: Id[]; sides?: { a?: number; b?: number } }>;   // a summary: by item index
}
interface EventFact {                                       // the typed fact of one event, shared by the feeds of §7.2, §7.3, §7.5
  id: Id; kind: string; size: number; w: number; time: GameTime; cell: Id; district: Id;
  sides?: { a?: number; b?: number }; public: boolean; witnesses: number;
  parent?: Id; parentSize?: number; policeChild: boolean;   // `policeChild`: the occurrence drew a police-action child (known at birth)
  creator: 'sim' | 'mirror' | 'norms'; norm?: string; rung?: string; enforcer?: number;
}
interface EventsDigest extends DigestBase {
  bands: Record<Id, { band: number; since: number }>;       // state views: every cell with band > 0
  regimes: Array<{ id: Id; kind: string; scope: Id; start: number; size: number; effects: Record<string, number>; closes: string[]; priceShift: number }>;
  m4Open: number; services: Record<Id, 0 | 1 | 2 | 3>; price: Record<Id, 0 | 1 | 2 | 3>; calendarSize: Record<Id, number>;
  facts: Feed<EventFact>;                                   // events of size 2 and above, as admitted (never items)
  counts: Feed<{ district: Id; kind: string; size: number; n: number }>;      // every admitted incident, items included
  changes: Feed<Transition>;                                // band, status, regime and price transitions (§9.1)
}
```

The ring is capped at `data.events.ringMax` (20,000 entries **[tunable]**); the overflow drops the oldest windows and logs `ring-overflow`. It serves heat, `why` chains and re-minting a summary or event descriptor (S0 §9.3, G-6) for seven days. **Nothing a pending child needs lives only in the ring.**

**3. A window, in order.** Window `w`: (1) read the settings and the digests of the snapshot; (2) **exits:** regime exits (§7.1); (3) **candidates:** regime arrivals, immigrants for each district and kind, due children from the calendar after their checks; (4) **admission:** events and regime arrivals in `(time, Id)` order; (5) **indexing:** admitted size-1 incidents become summary items, in their cells' summaries, with final identities and `sides`; (6) **offspring** of every admitted occurrence of generation below `genMax`; (7) heat, bands, service status and price; the ring is trimmed; the feed and the digest are written.

**4. Design concepts.** *Counts first.* *One descriptor per occurrence:* identity, time and place are assigned once and never re-derived. *One admission owner,* with declared order and persisted budgets. *Hot state is read off generative state:* the future of a cell's excitement is the pending calendar. *Demand independence:* nothing here reads V's position or any demand. *Static coverage:* the game's content lowers a cell's rate by a static figure, never by whether its community is active now.

**5. Initialisation.** Empty calendar and ring, no regimes, `admit.m4Times = []`, every service `open`, every band quiet; the normalisers `M_k` are computed at load. **6. Input.** The index; `data.shape`, `data.events`, `data.kinds`; `ctx.settings`; digests: `city.mirror` (`cover`), `order.stocks` (`E`, `Y`, `fear`), `order.norms` (`noSnitch`), `group.decide` (`boost`, `pairBoost`).

**7. Submodels.**

*Propensity.* A cell's stable propensity for kind `k` is `ε(c, k) = F(c, k) × L(c)`, with `L(c) = LQ[floor(rand("prop", c) × 4096)]` (a log-normal quantile, mean 1, from `lqtab@1`): a function of the world seed, the cell's `Id` and the index only. With `data.events.flatPropensity = true`, `L(c) = 1` (unit fixtures).

*Opportunity.* For cell `c`, kind `k` and period `p`:

```ts
a(c, k, p)  = A[c][k][p] × (1 − gameCoverage[c][k]) × ε(c, k)
aD(d, k, p) = Σ_{c ∈ d, in cellIds order} a(c, k, p)
cityTotal(k, p) = Σ_{simulated d, in Id order} aD(d, k, p) + Σ_{stub d} staticTotalA[d][k][p] + rest.totalA[k][p]
share(d, k, p)  = aD(d, k, p) / cityTotal(k, p)
```

`gameCoverage` is **static**: the share of the kind the game already covers in that cell. A coarse process MUST NOT read whether the game's community there is active now (§5.5, §12).

*The mean for a window.* For district `d`, kind `k`, size `m`, window `w` (period `p`, `t = startOf(w)`):

```ts
μ(d, k, m, w) = rate[k][m] × cityScale × shape(k, t) × share(d, k, p) × regimeMod(d, k) × groupMod(d, k) × (W / 86400)
regimeMod(d, k) = Π over regimes live at the start of w in d (id order) of max(0.1, r.effects[k] ?? 1)
groupMod(d, k) = max(0.5, 1 + Σ_f offenderShare(d, k, f) × boost[d][f][k])     // `group.decide` digest, default 0; 0 for k = gang-clash
offenderShare(d, k, f) = (Σ_c presence_f(c) × rw_k[class(f)]) / (Σ_c (base_k + Σ_f' presence_f'(c) × rw_k[class(f')]))     // static; class(other) = gang
```

A kind not allowed by the gate's class rule (§6) has `μ = 0`.

*Counts, sizes and cells (immigrants).* Per window, district and allowed kind: `Λ = Σ_m μ(d, k, m, w)`; `N = splitCount(Λ, part => i => procRand(w, "cnt", d, k, part, i))`. For incident `i = 0 … N − 1`: size by `invCum([μ(d, k, 1, w), …, μ(d, k, 4, w)], procRand(w, "size", d, k, i))`; **cell** by `invCum` over `a(c, k, p)` for every cell of `d` in `cellIds` order with `procRand(w, "cell", d, k, i)`. **Every incident has a cell before anything else happens to it**, so no summary is scoped to a district and the kernel never chooses a place among descendants. A size-2-or-above immigrant is an event: `id = H("mint", proc, proc, "ev/" + w + "/" + d + "/" + k + "/" + i)`, `time = startOf(w) + floor(procRand(w, "t", d, k, i) × W)`, `gen = 0`, `chain = []`. A size-1 immigrant waits for indexing.

*Due children.* At window `w` the children with `due = w` leave the calendar in `(due, parent, index)` order and are checked: (1) **game cover:** if the `city.mirror` digest's `cover` holds the same kind at the child's cell or its `adj1` cells (entries live for `data.events.coverLull`, 144 windows), the child is thinned, `game-covers`, logged as a correction; (2) **excluded now:** the kind is no longer allowed, dropped `excluded`; (3) **thinning:** `ratio = min(1, regimeMod(d, kind) / modBirth)`; if `ratio < 1` and `rand("thin", parent, index) ≥ ratio`, thinned, reason `regime`. A surviving child is **classified by its own size.** Size 2 or above: an event, `id = H("mint", proc, parent, "child/" + index)`, `time = startOf(w) + floor(rand("child", parent, index, "t") × W)`. Size 1: a summary item (indexing). Either way `gen = parentFacts.gen + 1`, `chain = [parent, …parentFacts.chain]` cut to `genMax`, and `sides` as the parent's, swapped for a retaliation (`kind' = kind = gang-clash`), none for `police-action`.

*Admission.* One owner, one order. Events and regime arrivals are sorted by `(time, Id)` and admitted one at a time against **working** counters that start from the state and are committed with the run:

```ts
for (const c of sorted) {
  const cast = c.isRegime ? [] : castOccurrence(c.d);                        // §5.4
  if (cast === 'no-cast') { refuse(c, 'no-cast'); continue; }                 // logged and counted, not a budget
  if (!c.isRegime && !ctx.produce(occurrenceOf(c, cast)).ok) continue;        // the gate, §6; it logs its own reason
  if (c.size === 4 && w < m4Open(working)) {
    if (c.isRegime) c.size = 3;                                               // demoted: the regime starts as size 3 and uses no budget
    else { refuse(c, 'budget-m4'); continue; }
  }
  if (!c.isRegime && c.size >= 2 && districtCount[c.d.district] >= data.events.capPerWindow) { refuse(c, 'cap-window'); continue; }   // 8 [tunable]
  if (c.size === 4) working.m4Times = [...working.m4Times, w].slice(-2);       // m4Open is recomputed from it
  if (!c.isRegime && c.size >= 2) districtCount[c.d.district] = districtCount[c.d.district] + 1;
  admit(c);
}
```

`m4Open = 0` with no times, `last + m4Spacing` with one, and `max(last + m4Spacing, secondLast + WEEK)` with two or more, with `m4Spacing = 432` windows **[tunable]**: at most 2 m4 occurrences a week and at least 3 days apart (M14-18). **A refused candidate changes no counter and draws no offspring.** The district counter counts only size-2-and-above occurrences admitted in this window, so it needs no persistence. Regime ends, mirrored events (§7.3) and norm enforcement events (§7.5) never pass through admission. A size-1 incident always passes it, subject to the class-exclusion check at birth; its persons are cast and gated when it is opened (§7.9).

*Summaries and items.* The admitted size-1 incidents are grouped by `(cell, kind)`. Each group is one `core:summary` named `sum/<w>/<cell>/<kind>` with `from = startOf(w)`, `length = W`, `scope` the cell and `count` its size (an empty one is not minted). Items are indexed in the order **immigrants in `(district, kind, i)` order, then due children by `(parent Id, index)`**. Item `j` has the `Id` `H("mint", S, S, "item:" + j)` and the time `startOf(w) + floor(rand("item-t", S.id, j) × W)`; its place is the cell (V4-39, K-1). The item's `Descriptor` is built from these, and `sides` are drawn with `cast-f` and `cast-pair`. Every summary is scoped to one cell, so its count equals its items at its own scope.

*Offspring.* Every admitted occurrence of generation below `genMax` draws its offspring once, keyed by its final `Id` `me`:

```ts
n      = min(nMax, nOf(size) × offspringFactor[kind] × cityScale × regimeMod(d, kind))        // a clamp is logged `n-clamped`
count  = nbCount(n, 0.3, rand("child", me, 0, "n"))
for c in 0 .. count − 1:
  bin    = invCum(delayBins[kind], rand("child", me, c, "bin"))
  due    = w + lo[bin] + floor(rand("child", me, c, "win") × (hi[bin] − lo[bin] + 1))          // at least w + 1
  kind'  = invCum(matrixRow(kind, allowed kinds only), rand("child", me, c, "kind"))          // no row left: no child
  if kind' = 'police-action' and rand("report", me, c) ≥ reportChance(d, witnessBonus): no child
  size'  = size = 1 ? 1 : clamp(size + [−1, −2, 0][invCum([0.60, 0.25, 0.12], rand("child", me, c, "size"))], sizes(kind')[0], sizes(kind')[1])
  cell   = invCum over the parent cell (weight 1), its adj1 cells (0.4) and adj2 cells (0.15), by Id inside each, with rand("child", me, c, "cell")
           // a gang-clash child of a gang pair instead weights every cell of the district by the pair's `pairs` weight
  insert PendingChild{ parent: me, index: c, due, kind', size', cell, sides, modBirth: regimeMod(d, kind'), parentFacts } in the calendar
```

`policeChild` of the parent is true if any child has `kind' = police-action` after the report draw. The `witnesses` of an occurrence are `spacingCount(meanPop(cell, p) × data.events.witFraction, i => rand("wit", me, i))`, `witFraction` 0.05 **[tunable]**; `witnessBonus = min(10, witnesses)`. The calendar cap of 256 per district is a **fault limit**: past it the pending child with the lowest size, then the largest `Id`, is dropped and `calendar-overflow` is logged and counted. The week fixture asserts that it never happens (SF1-E1). It is not population control.

*Heat and bands.* After the window's births, for every cell `c` of every simulated district:

```ts
heat(c) = Σ over ring entries e with a cell c' within graph distance dist ≤ 2 of c and w − e.w < 1008:
              Ws[e.size] × Wd[dist] × Wa(w − e.w) × (e.count ?? 1)
        + Σ over pending children ch with a cell c' within dist ≤ 2 of c and 0 < ch.due − w ≤ 1008:
              0.5 × Ws[ch.size] × Wd[dist]
Ws = [1, 3, 9, 27] (by size 1 to 4);  Wd = [1.0, 0.4, 0.15];  Wa(age) = 1.0 (age ≤ 6), 0.7 (≤ 36), 0.4 (≤ 144), 0.15 (≤ 1008)
```

Terms are summed in `(entry w, Id)` order, then pending in `(due, parent, index)` order. Four **bands** (quiet 0, elevated 1, hot 2, flashpoint 3) have `enter = [–, 2.0, 5.0, 12.0]`, `leave = [–, 1.2, 3.2, 8.0]` **[tunable]**:

```ts
function nextBand(cur: number, heat: number, since: number, w: number): number {   // w: the window just computed
  if (w − since < 144) return cur;                                    // a one-game-day minimum dwell
  for (let j = 3; j > cur; j--) if (heat ≥ enter[j]) return j;        // rise to the highest band whose enter threshold is met
  let j = cur; while (j > 0 && heat < leave[j]) j--;                  // fall while the leave threshold is not met
  return j;
}
```

A band computed after window `w` applies from window `w + 1`: its `since` is `w + 1` and its pin `band@w<w + 1>` is written **only on change**. The heat numbers never leave the process; the band is the S2 predicate. There are no hot lists: Kabuki has 15 to 30 cells and every cell keeps its band.

*Reports.* `reportChance(d, witnessBonus) = r0 × (1 − Y) × (0.5 + 0.5·E) × (1 − fear) × (1 − noSnitch) × (1 + 0.1 × witnessBonus)`, with `E`, `Y`, `fear` from the `order.stocks` digest, `noSnitch` the `beh` of the norm `uniforms` from the `order.norms` digest, and `r0 = data.stocks.r0` (0.7 **[tunable]**), clamped to [0, 1]. The report is a separate draw. It feeds no dial in M3.

*The feed.* Each admitted event becomes one `EventFact` (with `policeChild` and `parentSize`); each admitted incident of any size adds to `counts`; each band, status, regime and price change adds a `Transition`. Items are never in `facts`.

**8. Agreement and validity.** `coarseFine`: **count**. A summary's count equals the number of its items; canon items are kept (M14-16, S0 F-7). *Conceptual:* opportunity is targets times offenders times (1 − guardians) times a stable propensity; incidents cluster in time by offspring; a heat band is the state of a cell's pending future. The model does not claim to reproduce real crime, only that the shapes transfer; the constants are tuned by feel and by the panel. *Verification:* SF1-I-1 to SF1-I-16, SF1-S-3 to SF1-S-5, S0 F-13, F-21, F-22 and F-7 on this process, SF1-E1, SF1-E2, SF1-E4. *Operational:* the pattern battery on 20 seeds; M14-17 as a panel on a week in Kabuki. Cost target: a window with nothing due in 0.2 ms native, 5 ms in the reference (§10.3).

### 7.3 `city.mirror`

**1. Purpose and patterns.** It maps the game's raw events to the city's vocabulary, so that the record of what the game did is in the language the sifter reads, and it sets nothing it cannot read from the game. Pattern: M14-22 (identical under any grouping of calls and reload).

**2. State.** Tier 1.

```ts
interface MirrorState {
  v: 1;
  seen: Id[];                                              // raw event Ids processed, newest last, at most 1024
  counters: Record<Id, { gig: number; hustle: number; failed: number }>;    // by district
  lastHeat: number;                                        // the last heat stage mirrored (0 to 5)
  next: number;                                            // next feed sequence number
}
interface MirrorDigest extends DigestBase {
  cover: Array<{ kind: string; cell?: Id; district: Id; since: number }>;   // a state view: what the game covers now; entries older than coverLull windows are removed
  facts: Feed<EventFact>;                                  // the derived events, as minted; creator 'mirror'
  counters: MirrorState['counters'];
}
```

**3. Design concepts.** Raw events are records of what the game did, kept as they are, never filtered or edited (S0 §9.2). A derived event re-describes one; it is not a new occurrence, so the production gate does not refuse it (§6) and **it bypasses admission and consumes no budget**. What V is shown of it is filtered at display (S2 §2.19). The mirror reads the game's feed through the replay port in M3 (§3.4); the same code runs against a live game. **Initialisation:** `seen` empty, `lastHeat = 0`, counters zero. **Input:** the kernel's raw events, the mirrored slots of the persons they cite, the index's affiliation classes and cells, `data.mirror`.

**4. Submodels.** *Finding the raw events.* The run for window `w` starts from the snapshot at `startOf(w)`; external operations stamped in window `w − 1` have just been applied (S0 §9.4, step 2). The mirror queries `core:event` under the city with `kind in RAW_KINDS` and `time` in `[startOf(w − 6), startOf(w) − 1]` (`limit: all`) and keeps those whose `Id` is not in `seen`, ordered by `(time, Id)`. A raw event older than window `w − 1` is a late operation (a defect `late-raw`) and is processed all the same. The same find-and-deduplicate rule serves any process that reads another's events by query (§7.5).

*The derivation table.* `class(x)` is the class of an affiliation (gang, corporation, ncpd, civilian) from the index. At most `data.mirror.cap` (12 **[tunable]**) derived events are minted per window; the rest stay raw events, logged `cap-hit`.

| Raw kind | Derived event | Size | Participants and effects |
|---|---|---|---|
| `game.death` | `gang-clash` if the victim's class is gang and the actor's class is gang and different; else `assault` | 2 if the victim's affiliation is a group of §7.8, or `witnesses ≥ 3`; else 1 | The victim as `victim`; the actor as `aggressor` (V included if the game says so). Effect `kill` on the victim. Witnesses copied |
| `game.heat.N`, `N > lastHeat` and `N ≥ 1` | `police-action` | 2 if `N ≥ 3`, else 1 | None. Place: V's district at the raw time |
| `game.heat.N`, `N ≤ lastHeat` | none (the stage fell) | | `lastHeat = N` is recorded either way |
| `game.combat.start` | `gang-clash` if any hostile's class is gang; `police-action` if any is ncpd; else `assault` | 2 if there are 3 or more hostiles, else 1 | The hostiles as `hostile`. No effects: the deaths come as their own events |
| `game.combat.end`, `game.district` | none: demand and context only | | |
| `game.journal.finished` or `.failed` | `gig-outcome` | 1 | The entry as `entry`. `outcome` `done` or `failed`. The district's counter for the entry's family rises by one |

The derived event has **creator** `proc(city.mirror)`; **cause** `[the raw event]`; **time** the raw event's time (K-7); **place** the raw event's cell if it has one, else its district; `outcome` `done` (`failed` for a failed journal entry); and the `Id` `H("mint", proc(city.mirror), raw, "mir")`. **A mirrored event is told from a simulated one by its creator** (S3's `EventView.creator`). Its `EventFact` carries `sides` (the affiliation-class indices of its sides, or of the victim and the actor of a death), `public` (a public place and at least `publicMinWitnesses` witnesses, §7.5) and `witnesses`.

*Coverage.* For each derived event with a cell and a kind in `{gang-clash, assault, theft, police-action}`, a `cover` entry is added; `city.events` thins the pending children of the same kind there (§7.2). The `cover` view is not an event source: the groups read the `facts` feed. The mirror writes nothing about V: V's cell, district and wanted level are mirrored slots that `v.frames` reads (§8.2).

**5. Validity.** `coarseFine`: **exact**. *Conceptual:* the game owns these facts; the mirror is a translation table, with nothing invented and nothing dropped except past the cap. *Verification:* SF1-M-1 to SF1-M-8, SF1-E3. *Operational:* the replay of a hand-authored story state, read by someone who knows the game: does the record say what happened?

### 7.4 The population fit (not a process)

**1. Purpose and patterns.** It fits each district's joint tables from the marginals the index supplies, **once**, and publishes them as `Table` contributions with provenance. Patterns: marginals of resident draws within sampling error (M15-01), households and the age hump (M15-02). **2. State.** None. The index is immutable inside a lineage (§1.4), so the fit is a function of it and of the pinned `S1Data`. It is computed at lineage creation and at every load, gives the same result, and its hash (`recipeHash`) is in the lineage record. Refitting is a later capability.

**3. Method.** Iterative proportional fitting over the person table (dimensions 8, 12, 4, 6; `x = ((a·12 + r)·4 + i)·6 + f`) and, separately, the household table (dimensions 5, 3, 4: type, tenure, wealth; `x = (ty·3 + te)·4 + we`):

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

`coord(x, d)` is `floor(x / stride_d) mod dims[d]`, with strides `(12·4·6, 4·6, 6, 1)` for the person table and `(12, 4, 1)` for the household table. Each target marginal is first divided by its sum. `FLOOR = data.people.cellFloor` (2⁻³⁰). The **seed** of the person table is the product of the three factor tables of §4.2, each "0" replaced by `FLOOR`; the seed of the household table is 1 for every cell except `crew`, which is 1 when the district's gang-class share is above 0.05 and 0.1 otherwise. A table that would exceed `N_enum` is refused at load.

**4. Contributions.** The weights are `w[x] = t[x] / max(t)`. The person table becomes one `Table` contribution per slot `p0 … p5` of `xf:household` under the district (mode `weight`, layer `simulation`, strength 1), and the household table one `Table` on `hprofile`; the fit's hash is in the cause. They are reloaded, not persisted. `meanHH = Σ_type hhType[type] × (base(type) + Σ_x x·extraWeights[type][x] / Σ_x extraWeights[type][x])`, summed in type order, fixes `households#count`.

**5. Validity.** *Conceptual:* a joint table over four attributes is a small, auditable recipe; roster rules make households coherent. *Verification:* SF1-P-0 to SF1-P-5: the marginals of a district's drawn residents match the fitted marginals within three standard deviations of sampling error plus a roster allowance of 0.06 absolute **[calibrate]**. *Operational:* M15-01, M15-02, M15-27, and the panel question of whether a block's people look like a block.

### 7.5 `order.norms`

**1. Purpose and patterns.** It keeps, per district and norm, what people privately support, what they do, and what they believe others do; it mints the enforcement that follows from non-compliance; and it separates public from private acts. M3 has two norms and **one demonstration**: the Friday fee, public against private. Patterns: the norm gap, and public against private (M15-11); sanction ladders (M15-13); report chance inputs (M15-14).

**2. State.** Tier 1, per district and norm.

```ts
interface NormsState {
  v: 1;
  slots: Record<string, NormSlots>;                       // key: district Id + "|" + norm id
  seen: Id[];                                             // external enforcement events already taken as signals, at most 256
  ring: Array<{ id: Id; w: number; time: GameTime; cell: Id; norm: string; rung: string; qe: number; qn: number }>;   // this process's events of the last week
  next: number;                                           // next feed sequence number
}
interface NormSlots {
  priv: number; beh: number; perc: number;               // 0 to 1
  qe: number; qn: number;                                 // the last relaxation's values
  signal?: { value: number; event: Id; from: number };    // a public event's implication, and the first window it acts
  pub: number[];                                          // windows of public enforcement of this norm in the last 144, oldest first
  gap: 0 | 1 | 2; gapSince: number;                       // aligned, gap, wide
}
interface NormsDigest extends DigestBase {
  norms: Record<Id, Record<string, { priv: number; beh: number; perc: number; vis: number; gap: number }>>;   // state view
  facts: Feed<EventFact>;                                 // enforcement events this process minted (creator 'norms', with norm, rung, enforcer)
  changes: Feed<Transition>;
}
```

**3. A window, in order,** per district and norm: (a) take the fresh external public events and set their signals; (b) enforce; (c) relax; (d) set the signals of this window's own public events; (e) band the gap.

**4. Design concepts.** *A norm is data:* a behaviour, a sector, enforcers, two threshold histograms (empirical: "I comply if enough others do"; normative: "if enough expect it"), a cost and a ladder. *`perc` is a perspective on the district, not world truth.* *Only a public act moves it.* A public act is one in a public place with enough witnesses who saw each other; a private act moves only its witnesses' beliefs (S0 F-25). `priv` is constant in M3 unless an author's effect moves it.

**5. Initialisation.** `priv`, `beh`, `perc` from the norm record; `qe = beh`, `qn = perc`. No signal. `pub` empty. `gap = aligned`. **6. Input.** `data.norms`; the index; the kernel, by query, for enforcement events of this norm whose creator is not this process (the find-and-deduplicate rule of §7.3, with `seen`).

**7. Submodels.** A norm record (`NormDef`) holds: `id`, `label`, `sector` (profile roles it applies to; none = every resident), `enforcer` (`A1`, `A2` or `A3` and roles), `share`, `taue` and `taun` (for the 8 resident types: their share and two thresholds), `priv0`, `beh0`, `perc0`, `visBase`, `nu`, `phiBase`, `phiPublic`, `eta`, `signalMemory`, `signalValue`, `enforcePerDay`, a weighted `ladder`, and `gapBands`. **Defaults:** `nu = 0.4` (the weight of visibility in the normative expectation `q_n`), `phiBase = 0.1`, `phiPublic = 0.6`, `eta = 0.058`, `signalMemory = 144` windows, `signalValue = 0.95`, `gapBands` gap `[0.10, 0.08]` and wide `[0.30, 0.25]` (enter, leave). M3 ships two norms, with `share` 1/8 each, `taue = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75]`, `taun = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]` for both:

| Norm | Sector | Enforcer | `priv0`, `beh0`, `perc0` | `visBase` | `enforcePerDay` | Ladder weights (default ladder of §6) |
|---|---|---|---|---|---|---|
| `fee` ("pay the Friday fee") | `vendor`, `shopkeeper` | `A1`, roles `gang` | 0.35, 0.875, 0.85 | 0.5 | 3 | `word` 0.6, `shun` 0.25, `fine` 0.1, `beating` 0.05 |
| `uniforms` ("do not talk to the uniforms") | every resident | `A1`, roles `gang` | 0.5, 0.75, 0.8 | 0.3 | 1 | `word` 0.7, `shun` 0.25, `beating` 0.05 |

*Resident type.* `type(r) = invCum(share, rand("ntype", norm, r))`. A resident **complies** if `qe ≥ taue[type]` and `qn ≥ taun[type]`, with the slots' last `qe` and `qn`. The non-compliers are the residents enforcement targets.

*The public tag.* An event is **public** if its place's `public` slot is `public` and its witness count is at least `data.norms.publicMinWitnesses` (5). An enforcement event's witnesses are `spacingCount(pop(cell)[p] × witFraction, i => rand("wit", id, i))`; an external event's are the length of its `witnesses` slot (or the replay line's count). A private act produces no input to the norm.

*Fresh signals (a).* An external public enforcement event of this norm, not in `seen`, in `(time, Id)` order, sets `signal = { value: signalValue, event, from: w }` and appends `w` to `pub`. Each event is taken once: its `Id` goes into `seen`.

*Enforcement (b).* `μ = enforcePerDay × (W / 86400) × (1 − beh) × min(1, enforcerShare / 0.05)`, with `beh` as the snapshot held it and `enforcerShare` the entry share of the enforcer's affiliation in the district. `N = spacingCount(μ, i => procRand(w, "enf", d, norm, i), 4)`. Each use `i`: the rung by `invCum` over the weights of the rungs the gate allows (§6), `procRand(w, "rung", d, norm, i)`; the cell among the district's public cells by `invCum` over `pop[p]`, `procRand(w, "ecell", d, norm, i)`; the time, `procRand(w, "et", d, norm, i)`. The event is of kind `enf.<norm>.<rung>`, named `enf/<w>/<d>/<norm>/<i>`, effects by the rung. Its enforcer is cast from the enforcer affiliation and roles, and its target from the norm's sector among adult `civilian` non-compliers, by the casting function of §5.4 with the `qe` and `qn` of its ring entry (so the cast is reproducible). It passes the gate, not admission: enforcement is order, bounded by its own ladder. If it is public it is queued as a signal for (d).

*The relaxation (c).* With `vis = min(1, visBase + |pub in the last 144 windows| / 4)`:

```ts
let b = beh, qe = beh;
for (let it = 0; it < 4; it++) {
  const phi = signal === undefined || w < signal.from ? 0
            : (w === signal.from ? phiPublic : (w - signal.from <= signalMemory ? phiBase : 0));
  const sig = signal === undefined ? 0 : signal.value;
  qe = (1 - phi) * b + phi * sig;
  const qn = clip01(perc * (1 - nu) + vis * nu);
  b = 0;
  for (let j = 0; j < 8; j++) b = b + share[j] * ((qe >= taue[j] && qn >= taun[j]) ? 1 : 0);
}
beh = b; qeLast = qe; qnLast = qn;
perc = perc + eta * (qe - perc);
```

The first three steps iterate four times so that `beh` settles for the current `perc` and signal, and `perc` then moves once. With no signal, `phi = 0` and a private act changes nothing. `eta` is per window: 0.058 gives about 0.3 per game hour. **(d)** A public event of this window sets `signal = { value: signalValue, event, from: w + 1 }`, replacing an older signal, and appends `w` to `pub`. A signal therefore acts first in the window after the one in which it was processed, and each event is processed once.

*The gap band (e).* `gap = |priv − perc|`. The band rises to `wide` (2) at `gap ≥ 0.30` and to `gap` (1) at `gap ≥ 0.10`; it falls from 2 when `gap < 0.25` (to 1, or to 0 if also `< 0.08`) and from 1 when `gap < 0.08`. A pin `gap-<norm>@w<w + 1>` is written on the district **only on change**: the S2 window predicate.

**8. Agreement and validity.** `coarseFine`: **distribution** (the district slots against the behaviour of resident types opened at a scene, within 10 %). *Conceptual:* a norm is held up by what people think others do; a public act shows it; enforcement makes non-compliance visible; the thresholds are judgement. *Verification:* SF1-N-1 to SF1-N-7. *Operational:* M15-11 to M15-14 and the panel question of whether a norm feels enforced (P15-01).

### 7.6 `order.stocks`

**1. Purpose and patterns.** It keeps, per district, how much people trust that something will be done (efficacy), how little they trust the police (cynicism), and the police's standing (legitimacy), and from them the chance that an incident is reported. Patterns: each input moves the report chance as configured, with no lock-in with police presence (M15-14, M14-12).

**2. State.** Tier 0, per district: `StocksState { v: 1; districts: Record<Id, { E, Y, L }>; cursors: { events, norms } }` and `StocksDigest` (a state view of `E`, `Y`, `L` and `fear` per district). **3. Overview.** Per window: retain; consume the `city.events` and `order.norms` feeds after the cursors (§2.2) and add the gains and losses of those events, each once. **4. Initialisation.** `E, Y, L = index.trust` (default 0.5 each).

**5. Submodels.**

```ts
E = clip01(rhoE * E + (1 - rhoE) * E0 + dE)      // rhoE = 0.9966 per window (about 0.98 per hour); E0 the district's starting value
Y = clip01(rhoY * Y + (1 - rhoY) * Y0 + dY)      // rhoY = 0.9983 (about 0.99 per hour)
L = clip01(rhoL * L + (1 - rhoL) * L0 + dL)      // rhoL = 0.9966
```

Retention returns a stock to its baseline, so a district with no events stays where it started. `dE, dY, dL` are the sums over the facts consumed in this window (each fact once, in the window the cursor passes it), in feed order, of the matching rows of `data.stocks.effects`, which use only fields of `EventFact`:

| Row | `dE` | `dY` | `dL` |
|---|---|---|---|
| A public enforcement fact (`creator = norms`, `public`): a visible remedy by a legitimate group | +0.01 | −0.01 | 0 |
| A `police-action` of size 2 or more whose `parentSize` is 2 or more (police answered) | +0.01 | −0.015 | +0.01 |
| A public `theft`, `assault` or `gang-clash` of size 2 or more with `policeChild = false` (a failure seen by many: no police response was drawn) | 0 | +0.02 | −0.02 |
| A `shakedown` of size 2 or more (rule by fear) | −0.01 | 0 | 0 |

`fear(d) = data.stocks.fearBase (0.5 [tunable]) × (the district's gang-class entry share)`, constant per district. The report chance is the formula of §7.2. **Validity.** `coarseFine`: **exact**. *Conceptual:* trust in the police is a slow stock moved by what residents see. *Verification:* SF1-O-1 to SF1-O-4. *Operational:* M15-14, M14-12 and bounded stocks over a soak.

### 7.7 `order.ledger`

**1. Purpose and patterns.** It writes the reputation labels that S2 reads. Evidence arrives through the `witness` policy and `absorb` as beliefs held by carriers (§8.6). This process re-evaluates the standings that changed and pins a label when its band changes. Patterns: audience-relative reputation (M15-15), evidence independence (M15-16), absence invariance and displacement (M15-17), aggregate against residents (M15-18).

**2. State.** Tiers 1 to 4: `LedgerState { v: 1; handledSeq: number; labels: Record<string, number> }` (key `carrier|subject|axis`, band 0 unknown, 1 low, 2 mid, 3 high) and `LedgerDigest` (a state view of the labels, with mass and item count, by carrier and axis for subject `v`, and a `changes` feed).

**3. Overview and submodels.** One run per window. It reads the S1 record's `dirty` entries with `seq > handledSeq` (through `ctx.record()`) and recomputes each listed `(carrier, subject, axis)` with `aggregate(carrier, subject, "rep-" + axis, startOf(k))`. The band is `unknown` if `mass < m0` (2), else `high` if `E ≥ 0.7`, `mid` if `E ≥ 0.4`, else `low`. For each changed band it writes a pin `label-<axis>@w<k + 1>` on the carrier's `standing-v` node and a `Transition`, updates `labels` and sets `handledSeq`. There is no second store: the ledger is the set of carriers' beliefs. A label changes by new evidence or supersession, never by time alone, and reaches V through behaviour, never through a number.

**4. Validity.** `coarseFine`: **distribution**: the aggregate's expected **masses** against the mean masses of residents' own beliefs formed by `knows` (§8.6), within sampling error and 0.1 absolute **[calibrate]** (M15-18). *Conceptual:* reputation is audience-relative and evidence-based; a chain of tellings adds nothing; standing survives absence. *Verification:* SF1-L-1 to SF1-L-8 and S0 F-24. *Operational:* the panel question of whether the street reacts to V as to someone it has met (P15-01).

### 7.8 `group.decide`

**1. Purpose and patterns.** It makes the Tyger Claws and The Mox of Kabuki actors in the smallest useful way: books that run out, grudges that build, four pressures each, and **two simple intentions that start, expire and are removed**. What a group wants reaches the city as a rate boost. Patterns: the divergence read, the hypocrisy seed material. Individual drives, concerns, goals and orders are later capabilities (§0.3).

**2. State.** Tier 0, per group.

```ts
interface GroupState { v: 1; groups: Record<Id, G>; cursors: { events: number; mirror: number } }
interface G {
  aff: 'A1' | 'A2'; district: Id;
  books: { cash: number; burn: number; income: number };                // eurodollars; burn and income per game day
  pulse: Record<string, { at: number; sev: number; latched: boolean; releasedAt?: number; rival?: number }>;   // the strongest pulse per drive
  intent: { state: 'none' } | { state: 'idle'; drive: string; since: number }
        | { state: 'active'; id: string; drive: string; since: number; expires: number; rival?: number }
        | { state: 'cooling'; until: number };
  W: Record<string, number>; D: number; gapBand: 0 | 1 | 2;
}
interface GroupDigest extends DigestBase {
  groups: Record<Id, { aff: string; U: Record<string, number>; W: Record<string, number>; D: number; intent: string; until?: number }>;   // state view
  boost: Record<Id, Record<number, Record<string, number>>>;               // district → affiliation class → kind → boost
  pairBoost: Record<Id, Array<{ a: number; b: number; mult: number; until: number }>>;
  changes: Feed<Transition>;
}
```

**3. Overview.** Per window, per group (in `Id` order): (1) consume the `city.events` and `city.mirror` feeds after the cursors; (2) books; (3) pulses; (4) pressures; (5) operative weights, divergence and gap band; (6) the intention lifecycle; (7) boosts and the digest. **No decision depends on demand:** the process calls no `demanded`, and member orders are a later capability whose realisation belongs in `scene.acts`.

**4. Design concepts.** *Groups are actors* (D-08). *What a group wants reaches the city by weight:* an active intention adds a boost to the offender term of the matching kind in its district. *A group's grudge against V is a belief* that may raise an offer through S2; no S1 process aims an act at V (§12).

**5. Initialisation.** Groups from `xf.kabuki.groups@1`. Pulses empty, intention `none`.

| Pack data | Tyger Claws (`A1`) | The Mox (`A2`) |
|---|---|---|
| Books (`cash`, `burn`, `income`) | 9,000; 300; 330 | 4,000; 150; 140 |
| Per shakedown income | 25 | 0 |
| Drives carried, with ethos | treasury 2, retribution 1, reputation 1.5, cohesion 1 | care_of_members 2, retribution 1, reputation 1, legitimacy 1.5 |
| Intentions | `collect-fee`, `retaliate` | `protect-members`, `retaliate` |

The ethos multipliers are **judgement** and need a review by someone who knows the lore. **6. Input.** The feeds of `city.events` and `city.mirror` (as `EventFact`) and the `city.events` `counts` feed; the index; `data.groups`.

**7. Submodels.**

*Books.* Every window: `cash = cash + (income − burn) × W / 86400`. For each consumed window of the `counts` feed, a lump sum is added: `perShakedown × offenderShare(d, "shakedown", f) × n`, with `n` that window's shakedown incidents of the district over all sizes. `runway = burn > 0 ? cash / burn : ∞`, in days.

*Pulses.* For each consumed fact, in feed order, with `sev = [0.3, 0.6, 0.9, 1.0][size − 1]` and `mine` the group's class index. A fact's victim side is known only for gang pairs and mirrored events (`sides.b`). A `gang-clash` or `assault` with `sides.b = mine` gives a `care_of_members` pulse (`u0` 0.7, `τ` 7 d), a `retribution` latched pulse with `rival = sides.a` if that is a gang class, and a `reputation` pulse (`u0` 0.7, `τ` 30 d) if public. A `gang-clash` with `sides.a = mine` and `sides.b` a gang class releases the latched `retribution` pulse toward that rival (`releasedAt` = the fact's time). A pulse for a drive the group does not carry is ignored. A new pulse replaces the stored one if its urgency now is larger. A latched pulse also ends by exhaustion after 90 days.

*Pressures.* `U` is a pure function of the facts above and `t`, **derived and never pinned**:

```ts
const pulseU = (p, u0, tau, hold = 0) => {                      // p: the stored pulse; tau in seconds; hold = 0.5 for a latched pulse
  if (p === undefined || t < p.at) return 0;
  const base = u0 * p.sev, e = t - p.at;
  if (!p.latched) return base * exptab(-e / tau);
  if (p.releasedAt === undefined || t < p.releasedAt) return Math.max(base * exptab(-e / tau), hold * base);
  return hold * base * exptab(-(t - p.releasedAt) / tau);
};
```

`treasury`: `clip01(1 − runway / 30)`. `retribution`: `pulseU(pulse, 0.8, 14 d, 0.5)`. `care_of_members`: `max(0.1, pulseU(pulse, 0.7, 7 d))`. `reputation`: `max(0.2, pulseU(pulse, 0.7, 30 d))`. `cohesion` and `legitimacy`: constants 0.1 and 0.2.

*Operative weights and divergence.* For the carried drives `d`:

```ts
ethosN(d) = ethos(d) / Σ_{d'} ethos(d')
Un(d)     = U(d) / Σ_{d'} U(d')                          // 0 if the sum is 0
W(d)      = 0.5 * ethosN(d) + 0.5 * Un(d)                // sums to 1
D         = 0.5 * Σ_d |ethosN(d) − W(d)|                 // divergence, exposed as a read
w(d)      = (W(d) / max_d' W(d')) * (φ(d) + (1 − φ(d)) * U(d))     // the intention weight; φ: treasury 0.10, retribution 0, others 0.3
```

A leaders' term returns with individual drives. **`W` feeds `w`, so the group's character reaches its decisions.** The gap band is `low` below 0.15, `mid` below 0.25, else `high`, with leave thresholds 0.13 and 0.23. A pin `group-gap@w<w + 1>` is written on the group node **only on change**. A divergence above `data.groups.divergenceMin` (0.25 **[tunable]**) is hypocrisy-seed material (S2 reads it through `groupGap`).

*The intention lifecycle.* A group holds at most one intention (`data.groups.intents`):

| Intention | Serves | Group | Duration | Cooling | Effect while active |
|---|---|---|---|---|---|
| `collect-fee` | treasury | Claws | 144 windows | 72 | `boost` of `shakedown` +1.0 |
| `protect-members` | care_of_members | Mox | 144 | 72 | `boost` of `assault` −0.2 |
| `retaliate` | retribution | both | 36 | 72 | a pair boost ×3 against `rival` for the duration |

1. **Start.** In state `none`, the drives with `w(d) ≥ θ_start` (0.35 **[tunable]**) are tried in descending `w` (ties by drive name). The first drive with a **feasible** intention starts it, active from the next window. An intention is feasible if the group lists it for that drive and, for `retaliate`, a latched unreleased pulse names a rival and the hazard draw passes: `procRand(w, "retal", group, rival) < hazard`, `hazard = h0 × (1 + 0.5 × [the harm was public])`, `h0 = 0.02`, drawn once per window while `retaliate` is the candidate.
2. **Idle.** If a drive is at or above `θ_start` and none of its intentions is feasible, the state becomes `idle` (logged `intent-idle`). It stays idle, without further logging, and returns to `none` once no drive is at or above `θ_stop` (0.20).
3. **Progress.** An active intention only counts windows and publishes its boost each window.
4. **End.** It ends at `expires` (outcome `done`), or earlier when its drive's `w(d)` falls below `θ_stop` (outcome `ended`). Its boost is removed from the next digest, `retaliate`'s pair boost with it. The state becomes `cooling` for the intention's cooling period, then `none`. Both outcomes are logged `intent-end`. There is no random success or failure in M3.

*Boosts for the city.* `boost[d][f][kind]` is the sum of the effects of the group's active intentions, clamped to `[−0.5, 3]`; `pairBoost` lists the active `retaliate` boosts. `city.events` reads both (§7.2).

**8. Agreement and validity.** `coarseFine`: **exact**. *Conceptual:* a group has books that run out, grievances that build and a character that can differ from what it does; an intention is a bounded answer to the pressure that started it. *Verification:* SF1-G-1 to SF1-G-6. *Operational:* the divergence read on the two groups; a transcript panel on whether the Claws' week reads as a group with money worries and a code.

### 7.9 `scene.acts`

**1. Purpose and patterns.** It is the fine tier. Where a root's focus has reached a cell, it opens the m1 items of the **completed windows** into events with people, and **publishes each completed item once as an event Change**, so the coarse count becomes something the sifter can hear and a person can witness. It runs only where demand reached ([G-7](../craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged)). Pattern: the items in focus equal the summary's count (M14-16).

**2. State.** Tiers 3 and 4.

```ts
interface ActsState {
  v: 1;
  prev: { w: number; cells: Id[] } | null;                 // the focus recorded in the previous run: demand at the occurrence time
  published: Array<{ item: Id; w: number; cell: Id }>;     // items already published as events: the last 512, and no older than the ring
  recent: Record<Id, number[]>;                            // by scene cell, the windows of opened items in the last hour
}
```

`ActsDigest` holds the number opened and the scenes. `published` is bookkeeping: **"already published" is not "currently materialised".** The contributions an opened item carries are not state. They are installed in the kernel, and they regenerate (below).

**3. Overview.** The run for window `k`: (1) read `ctx.demanded(3)` and the cells of the persons in `ctx.demanded(4)`; (2) open the items of window `k − 1` in the cells of `prev`; (3) re-install the contributions of published items in the cells now in focus; (4) record `prev = { w: k, cells }`.

**4. Design concepts.** It never catches up and never writes outside the focus. It adds information, never occurrences: opening an item changes no count and feeds no coarse process. It is the one process that reads `gameOwnedNow`. Window `k − 1` is complete and published at boundary `k`, because every process runs one window at a time. Opening uses the demand recorded for the window the item occurred in, and keys named by the item (its `Id`, which holds its original window), never by the opening window. **5. Initialisation.** `prev = null`; empty lists. **6. Input.** `demanded(3)`, `demanded(4)`; the summaries, the ring's `meta` and the items in scope; `presentAt`, `where`; `data.acts`.

**7. Submodels.**

*Opening an item.* For each cell `c` in `prev.cells`, the items of the summaries `sum/<k − 1>/<c>/<kind>`, in `(time, Id)` order, that are not in `published`, within the cap:

```ts
open(item):
  d     = descriptor(item)                         // kind, cell, kernel time, and meta from the ring: sides, parent, gen, chain
  cast  = castOccurrence(d)                        // §5.4: pure, keyed by the item's Id
  if (cast === 'no-cast') skip                     // the item stays unopened; logged
  occ   = { kind, origin: 'sim', size: 1, window: d.w, cell: c, participants, effects, creator: proc('scene.acts') }
  if (!ctx.produce(occ).ok) skip                   // the gate, now: a person who became protected since is refused
  ops:  contribute (layer 'simulation', mode 'constrain', Const) the item's participants#count, participants[i].who and .role, effects, witnesses, outcome 'done'
        publish-item { item }                      // the one semantic publication, an event Change; causes [d.parent] if any
  witnesses = presentAt(c, d.time, 60) minus participants, the first 12 by rand("present", c, person)
  published.push({ item, w: d.w, cell: c })
```

**Publication happens once.** `publish-item` is the explicit semantic publication of the completed item as an event Change, which S3's sifter hears; contribution Changes it ignores. An item in `published` is never published again. Until S0 names the operation, the reference model realises it as `mint-event` with the item's own creator, cause and name (§16.1, N-1).

*Regeneration is silent.* After a reload, or when an item has been forgotten and its summary re-minted from the ring, the kernel holds no contributions for it. For each cell in the focus of this run, `scene.acts` re-issues the same contributions of every published item of the cell that is still in the ring and whose contributions are not installed. The specs are pure functions of the descriptor, so their ids (`contributionId(spec)`) are unchanged and the operation restates a value: it publishes nothing and changes no count (N-2). Items beyond the ring stay bare. A cell that was not in focus is not opened for windows it missed.

*The cap.* At most `data.acts.perHour` (20) items are opened per scene cell in any 6 consecutive windows (`recent`). Items beyond the cap are opened in a later window only if still in the recorded focus of their own window, else not at all. Nothing is caught up. *Witnesses and beliefs.* The `witness` policy (§8.3) runs for each event these steps publish, for the witnesses that are focal or observed, and for the carriers a witness belongs to.

**8. Agreement and validity.** `coarseFine`: **count**: the items in a scene's focus, opened or not, equal the summary's count at that scope; opening adds nothing; the opened items are among the summary's items. *Conceptual:* the fine tier is generated from the coarse state, consistent with it. *Verification:* SF1-A-1 to SF1-A-5 and SF1-E1's twin runs with V in different cells. *Operational:* the template-written week in Kabuki, for panel P-C (§14.3).

## 8. The policies

A **policy** is event-driven. It runs behind a kernel hook or a relevance emission and keeps no schedule of its own. Its state is the S1 record (§2.2). Relevance emissions reach S1 in the kernel's order; S1 applies its own threshold on top of `θ_react` = 0.08: `data.minds.thetaS1` = 0.2 **[tunable]**.

**The watch frame.** S1 holds one frame on the root `city`, `H("mint", city, city, "frame:s1-watch")`: level `situation`, weight 1, no parents, status `active`, focus `{ nodes: [], tier: 0 }`. Its `reactsTo` selectors are: events with a participant `v` in a role of an actor (V's acts); readings of the mirrored slots `alive`, `affiliation` and `quest-linked` of `xf:person` (so `reconcile` hears the game's corrections). A kind-level match is `r = 1 × 0.6 × 0.5 = 0.3`, above `θ_react`.

### 8.1 Pressures

Individual drives, importance and urgency models are later capabilities (§0.3). In M3 the only wants are the four pressures of each group (§7.8). A pressure is **derived**: a pure function of timestamped facts and the query time `t`, never ticked and never pinned. A fact that moves it is a recorded pulse or a book value. The weight of a pressure in a decision is `w = I × (φ + (1 − φ) × U)`: a deficit pressure at rest weighs a tenth of its importance, a mixed one 0.3, a latent one only once triggered.

### 8.2 `v.frames`

`v.frames` opens only what the game states, from the mirror, and never V's drives:

1. **A situation frame** for V's cell at tier 3, and one for each of its `adj1` cells at tier 2, always open. Id `H("mint", v, v, "frame:situation:" + cell)`, actor `v`. When V's mirrored `cell` changes, the frames for the old cell are abandoned and the new ones opened.
2. **A goal frame for each objective the game tracks.** A tracked journal entry (a mirrored node) becomes a goal frame on `v` that `wants` the entry's target and place, `active` or `blocked` by the entry's journal state, with `source: game` and the journal record as `cause`. It says what the game asked, not what V feels.
3. **A step frame** for the person V is speaking to, from the dialogue feed (tier 4 on that person).
4. **Nothing else.** Inferred frames come from the director's beliefs (S0 §11.3). No process pins V's drives (S0 I-12).

When demand leaves a person, their step and situation frames close (`abandoned`, cause `demand-left`). The authored frames of R1's people and of any mirrored canon person stay `active` (S0 §7.3 makes them roots) and are not advanced.

### 8.3 `witness`: perception, salience and attribution

`onWitness(event, observer)` is called for each witness of an event, as the kernel's belief hook.

**Who witnesses.** At fine tiers, the persons present in the event's cell at its time (`presentAt`), open-air events reaching the cell and interior events only the venue's cell. At coarse tiers, witnesses are a count. Only individuated persons appear in an event's `witnesses` slot. A `secret` or `deniable` membership is never perceived. **S1 forms beliefs only for witnesses that are focal, that V has met (`observed`), or that belong to a carrier** (for the carrier's item, §8.6). Others are a count.

**The perception policy.** `knows` reads a mirrored slot only where its dimension is visible. The M3 policy marks visible: `alive` (of a seen body), `position` (for those present), appearance tags, whether someone is armed, and **affiliation where the look carries it** (gang-class affiliations). It does not mark drives, money or secret memberships.

**Salience** is rated at formation, 0 to 3, one point each, at most 3:
1. stakes: `matchStrength(observer, event) ≥ 0.5` (S0 V4-44): the strongest relevance of the event to the observer's authored frames;
2. the event class's emotional pulse: `kind.pulse ≥ 0.6`;
3. V's act touched a tie: a participant other than the observer has a tie with the observer at layer 2 or inner, or a materialised tie;
4. V showed it mattered: the rule S3 owns. It is 0 in M3.

**Memorable by rule:** salience 3, an event that violates a `protects` interest of an authored frame with pull at least 0.5, an open promise, or a betrayal. **No S1 decision reads a belief that is not memorable.** Telling selection and the `divergence` read use memorable beliefs only. Other beliefs are texture: they may fade (§8.5) and are not persisted, so a reload cannot change a decision (E-03).

**What forms.** For an observed act (an event with an actor `a`, an effect `x`, a target `y`): a belief `{ believer: observer, subject: a, path: "did." + x, at: event.time, value: y, confidence: 1, evidence: [origin(event)], source: { by: 'observed', event }, formed: now, refreshed: now, memorable, salience }`, with `Id` `H("belief", observer, a, path, at)`. `origin(event)` is the canonical originating evidence (§8.6). For an intentional act, also an attribution belief (below). Unintentional events (no actor role, or kind `accident`) form a causal belief `path: "cause"`. The kernel merges and refuses duplicates by (believer, subject, path, at) (I-9). S1 decides a contradicting newcomer replaces the existing belief only if its confidence exceeds the existing one's by more than 0.1.

**Attribution** has one policy, `attr@1`. An observed intentional act forms a belief about the actor's reasons, path `reason`, a region over reason classes. The weight on disposition against situation is

```ts
wD = clamp(0.65 - 0.2 * constraintVisible * (1 - load) + 0.1 * attitudeTilt, 0.2, 0.9)      // 0.65 [tunable]
// constraintVisible = 1 when the event has a cause in `causes` (a visible situation), else 0
// load = 0 in M3 (no stress load without individual drives)
// attitudeTilt = +1 when the observer's affiliation is hostile to the actor's, −1 when friendly, else 0
region = wD >= 0.5 ? dispositional(effect) : situational(effect)
confidence = q64(0.4 + 0.5 * |2 * wD - 1|)
source = { by: 'inferred', rule: attr@1, from: [event] }
```

The reason classes (pack data) are, by effect: `harm`, `kill`: dispositional {hostile, cruel}, situational {pressured, defending, accidental}; `take`: {greedy} / {desperate, ordered}; `help`, `protect`, `rescue`, `give`: {kind, loyal} / {duty, paid}; `expose`: {spiteful} / {ordered}; `conceal`: {secretive} / {afraid}; `move`, `meet`: {social} / {errand}. Every such belief has the event in `from`, so `trace` is complete. An NPC may voice its own belief about V's motive only as [D-22](../decisions.md) allows.

### 8.4 `social`: telling

`onSocial(event, teller, listener)` chooses what is told and what changes in the telling, for focal people.

**Selection.** For each memorable belief `b` of the teller about an event `e` they hold (`did.*`):

```ts
score(b) = protectiveRelevance(b, listener) * severity(kind(e)) * closeness(teller, listener)
p_tell   = base * max over b of score(b)           // base = 0.3 [tunable]; draw rand("tell", teller, listener, b.id, window) < p_tell
```

`protectiveRelevance` is the strongest `protects` or `threatenedBy` relevance of the belief's event to the listener's authored frames (`matchStrength` restricted to those types). `closeness` is the tie's `strength`, or 0.1 for strangers who share a cell.

**One operator at most per hop,** drawn by `invCum([0.15, 0.10, 0.10, 0.65], rand("op", teller, listener, b.id, hop))` over `level`, `sharpen`, `assimilate`, none (**[tunable]**), up to a hop limit of 4:
- `level` (loses detail): the told confidence is multiplied by 0.8 and the `reason` belief is not passed;
- `sharpen` (keeps and exaggerates): the path is raised one rung of `meet < take < harm < kill` where the effect is on that ladder;
- `assimilate` (bends to what the listener expects): the `reason` region is replaced by the listener's default reasons for the actor's group.

**The telling is a minted event** of kind `tell`, carrying its operator. **It has no effects.** Its participants are the `teller`, the `listener` and the `subject`, and the subject is an **informational participant**: a telling about V or about a protected person is ordinary communication and is not refused by the gate (§6). `expose` is reserved for an actual consequential disclosure, which seeds produce and the targeting rules govern. Events that policies mint (`tell`, `reply`) have creator `s1` and cause the source event, and the name `<kind>/<teller>/<other>/<short id>/<boundary index>`. The listener's belief has `source: { by: 'told', teller, event: tellingEvent }`, **`evidence` the teller's, unchanged**, and `confidence = min(b.confidence, 0.9) × 0.8`. A rumour therefore never corroborates itself (S0 F-9).

**Volume rule.** A telling is minted as an event only when (a) the teller or the listener is in a root's focus at tier 3 or finer, or (b) the belief is about V, a live seed's cast or a canon person. Otherwise spread is coarse and appears as reach (phase 2). Outside focus S1 keeps social Changes to about ten per game hour for the whole city **[tunable]**. Lies are a later capability (§0.3).

### 8.5 `fade`

`onTick(believer)` is called at every processed boundary for each believer that holds beliefs. It drops a belief when **all** of these hold: it is not memorable; `t − refreshed > hold`; and it is not a belief V returned to. `hold = data.minds.holdDays` (14 game days **[tunable]**) is the value the most generous memory setting would keep, so the sweep's floor property (S0 §11.2) holds from the start. `memoryScale` is recorded and inert until the machinery lands. A belief is **memorable** by rule (§8.3) or when S3's return rule sets it. The cap of 40 memorable beliefs per **person** **[tunable]** is kept by not promoting further low-salience beliefs.

**Carrier evidence has its own retention and is outside this section.** The items that carriers hold (§8.6) are memorable beliefs by rule, persisted by S0 like any memorable belief, exempt from the 14-day hold and from the person cap. They leave only by the ledger's own cap eviction or by supersession from the same canonical origin. Time alone never changes what a carrier holds, so time alone never changes a label (E-13).

**No policy reads a load, a quit, the wall clock or the load class.** `fade` reads only the boundary's game time (S1-I-4).

### 8.6 `aggregate`: reputation through carriers

**The ledger is the set of carriers' beliefs. There is no second store.** A **carrier** is a node whose beliefs stand for an audience. M3 has three, all pack data (`data.ledger.carriers`):

| Carrier | Node | Type | Size (expected) | Learns when |
|---|---|---|---|---|
| `stalls` | district slot `circle-stalls` | circle | residents with role `vendor` or `shopkeeper` | a witness belongs; or the event is public in a market cell |
| `claws` | group `grp-A1` | group | the group's members | a witness belongs; or the event's victim or target is a member |
| `kabuki` | the district | district | all residents | the event is public (m2 or above, or witnessed) |

**Canonical originating evidence.** One occurrence can reach S1 as two events: the raw `game.*` event and the derived mirror event that re-describes it (§7.3). `origin(e)` is the one `Id` that stands for the occurrence: for an event whose creator is `proc(city.mirror)` it is the raw event in `causes[0]`; for a telling it is the teller's evidence, unchanged; for anything else it is the event itself. `absorb` ignores raw `game.*` kinds, so it hears the derived event only, and **every ledger item cites `evidence: [origin(e)]`**.

One evidence item is one `Belief` held by the carrier about the subject (V, in M3), on the path `rep-<axis>[i]`, with `at` the event's time, `confidence` the channel's (witnessed 1.0, institutional 0.9), `salience` at formation, and `source` `observed`. The told channel returns with `city.flow`. The value is a `vec` `[v, reach]` on the 1/64 grid.

**Deduplicate before allocating an index.** S0's per-question merge cannot see that two indexed paths hold the same evidence, so S1 keeps the bookkeeping. `S1Record.absorbed["carrier|subject|axis"]` lists the canonical origins already counted, each with its ledger index. Before an item gets an index, `absorb` checks the list: an origin already there is skipped, whichever event brought it. A new origin takes the lowest free index in 0 to 31. At the cap of 32 the item with the lowest `(|v| × salienceWeight)`, then the oldest, then the lower `Id` is evicted, its index is reused and its entry keeps `index = −1`. The list keeps at most 64 entries, oldest first, so an evicted origin is still recognised for a while.

**The verdict of an act** is `v = judge(effect, view) × diag`:
- `judge` is `data.ledger.judge[effect][view]`, per axis;
- `view` is the carrier's view of the target, `good`, `neutral` or `bad`, from `data.ledger.view[carrier][target's affiliation class]`;
- `diag` is the diagnosticity of the kind: for a city kind, `clamp(−ln p_kind, 0.5, 3)` with `p_kind` the kind's share of the district's incident rate (from `data.shape.rate`), so a rare act weighs more; **for a kind with no city rate** (`promise`, `favour`, and the other acts of S2 and V) `data.ledger.diag[kind]`, default 1, with `promise` 1.5.

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

**Reach is frozen at formation** in M3: `reach = clamp(max(direct, base), 0.02, 1)`, with `direct = min(1, distinct witnesses who belong to the carrier ÷ carrier size)` and `base` from `data.ledger.reach[type][size]`: circle 0.10, 0.25, 0.50, 0.80; group 1.0 when the event's victim or target is a member, else 0.10, 0.25, 0.50, 0.80; district 0.03, 0.15, 0.40, 0.70, for sizes 1 to 4.

**The aggregate** for audience `A`, subject `s`, axis `a`, at `t`:

```ts
function aggregate(A: Id | Selector, s: Id, path: SlotPath, t: GameTime): { value?: number; mass: number; items: number } {
  const items = itemsOf(A, s, path, t).sort(by (at, Id));          // items of the carriers with at <= t; the same origin across carriers keeps the one with the larger reach
  let r = 0, q = 0;                                                  // q is the negative mass
  for (const e of items) {
    const scale = 1 - e.reach * (1 - lambda);                        // lambda = 0.9 [tunable]: the EXPECTED displacement of older items
    r = r * scale; q = q * scale;
    const w = salW[e.salience] * e.confidence * e.tellerDiscount * e.reach;      // salW = [0.25, 0.5, 0.75, 1]; the EXPECTED addition
    r = r + w * Math.max(0, e.v); q = q + w * Math.max(0, -e.v);
  }
  return { value: q64((r + 1) / (r + q + 2)), mass: r + q, items: items.length };
}
// label: unknown if mass < m0 (2 [tunable]); else high if value >= 0.7, mid if >= 0.4, else low
```

It is a pure read, deterministic, cacheable by revision and `t`, counted in the allowance (a cost bound of 2,000 units per call), and never writes. The unrounded `E` is used for the label.

**What a resident believes, and what the aggregate claims.** A resident knows an item with probability `reach`: `knows(resident, item) = rand("knows", resident, item) < reach`. The resident's own belief is the same sum over the items they know, **with the full conditional weight and a displacement only when the item is known**:

```ts
for (const e of items) if (knows(resident, e)) {
  r = r * lambda; q = q * lambda;                                    // displacement applies only to a known item
  const w = salW[e.salience] * e.confidence * e.tellerDiscount;      // no reach factor: reach is the chance of knowing
  r = r + w * Math.max(0, e.v); q = q + w * Math.max(0, -e.v);
}
```

Because the items are independent, the expected `r` and `q` of a resident equal the aggregate's `r` and `q` exactly. **The aggregate's `value` is a ratio of expected masses, an approximation of the mean of residents' own posteriors, and is not claimed to equal it.** The twin test compares **masses** (SF1-L-4, M15-18).

**The rules that matter.**
- **A chain adds nothing.** A rumour retold by three tellers weighs as its origin, because telling passes `evidence` unchanged and the ledger counts a canonical origin once. Only independent evidence adds (S0 F-24).
- **Standing does not decay by absence.** The aggregate reads no clock, and carrier evidence does not fade (§8.5). A label changes by new evidence or supersession, never by time alone, never by V's absence, never by game time V spent waiting (CTY-06).
- **It reaches V through behaviour:** prices, greetings, access, a witness's remark after three recorded acts. `aggregate` returns numbers only inside traces. S2's reads expose bands.
- **Asymmetry is per domain.** `reliable` and `decent` weigh evidence differently through `judge` and `diag`.
- **The firewall.** NPC beliefs about V reach the director only as aggregates, never as evidence about V's taste. S1's declared read sets exclude the director's beliefs about V (§12).

**Absorbing V's acts.** The watch frame hears an event with V as an actor. The policy `absorb(event)` runs once per canonical origin: it ignores raw kinds, computes `origin`, and for each carrier decides whether the carrier learns (the table above), computes `reach`, and for each axis with a non-zero `judge` and an origin not yet in `absorbed` sets the item by `belief-set` and appends `(carrier, subject, axis, seq)` to `S1Record.dirty`. The `order.ledger` process pins the label on change.

### 8.7 `ties`

The pure functions `tie`, `neighbours` and `bridge`, the materialisation rule and the tie record are §4.6 and §4.7. As a policy, `ties` also materialises a tie when a belief about it is formed or told or a seed casts through it; updates the NPC's regard from the typed events of the table of §4.7; classifies replies and mints the `reply` event; decides status changes by acceptance; and keeps the retract. Its only draw is `("accept", tie, event)`, and it reads no reputation ledger.

### 8.8 `reconcile`

The game is ground truth. `reconcile` runs when the watch frame hears a reading Change of a mirrored person's `alive`, `affiliation` or `quest-linked`. A load, a jump and a mirror correction are all just sources of such readings: after a load the kernel reads the game's state, which becomes `game` readings at the current time ([S0 §14.3](kernel.md#143-loading-is-replacement)), and where a reading differs it is a Change. **No policy reads the load class, a load count or the epoch.** `reconcile` does, in this order:

1. **Diff** each assumption S1 holds about the changed person against the reading: a frame of a mirrored actor, a membership edge, a materialised tie edge.
2. **Supersede what the game now contradicts.** If `alive` is no: `frame-status abandoned` (cause: the reading's change) on every active or blocked frame of the person; `end-edge` on their memberships and ties (the edge stays as history). If `affiliation` changed (a move, not a first reading or a reading restated after a load): end the old membership edge, and add the new one if a group stands for the new affiliation, cause `game`. The group is the one of the person's current district, from the mirrored position, if that district lists the affiliation; otherwise the first simulated district, in `Id` order, that does. A person the game reads as dead joins nothing.
3. **Leave beliefs alone.** A belief is not truth. People may still believe the dead person lives. That divergence is story material, not an error. It is logged as a `divLog` transition (§9.1).
4. **Log** every correction with reason `game-dead`, `game-moved` or `game-fact`. The log never reaches V.

A pending child in a cell the game now covers is thinned by `city.events` itself (§7.2). After a **jump** the coarse tiers replay every missed boundary in order and the fine tiers regenerate from the coarse state (§10.2).

## 9. What S1 exposes

### 9.1 Registered reads for S2

S2 reads the city and the people only through registered reads ([S2 §2.16 and §2.17](seeding.md#216-city-events-as-material), [§4.1](seeding.md#41-dependency-collection)). Each read is a pure function of S1 digests, the kernel and the S1 record at a time. It declares its dependencies and its invalidation, so that interests and wake-ups follow from them. **None exposes a raw number.** Each answers `maybe` until S1 has a reading for its scope. A read answers as of the last processed boundary: a read made inside a run sees the digests of the previous window.

**Historical evaluation.** S2 evaluates a window's closing condition at each Change's occurrence time ([S2 §4.2](seeding.md#42-change-order-and-latches)), so a value that changes and reverts inside one delivered batch must still be visible. Every read therefore publishes **timestamped value transitions**, with the initial value:

```ts
interface S1Read<A, R extends string> {
  name: string; version: number;
  deps: { digests: string[]; interests: Selector[]; time: boolean; roles: string[]; boundary?: boolean };   // `boundary`: re-evaluate at every boundary, because the value depends on beliefs, which emit no Changes
  eval(args: A, view: ReadView, t: GameTime): R | 'maybe';
  transitions(args: A, view: ReadView, from: GameTime, to: GameTime): Array<{ t: GameTime; value: R | 'maybe' }>;
}
interface ReadView { digest<D>(processId: string): D | undefined; value(n: Id, p: SlotPath, t?: GameTime): Value | undefined; record(): Readonly<S1Record>; tie(a: Id, b: Id): TieResult }
```

`transitions` returns the value at `from` (an entry with `t = from`), then every change in `(from, to]` in time order, with changes at equal times in the order they were made. A producer writes each change as a `Transition { key, t, value, prev }` in its digest's `changes` feed, so history for the last 8 windows is exact; for a longer range, or if `from` is older than the feed, the answer is `maybe`.

| Read (S2 atom) | Answers | Depends on | Invalidated by | Transitions from | M3 |
|---|---|---|---|---|---|
| `band(cell)` | `quiet`, `elevated`, `hot`, `flashpoint` | `EventsDigest.bands` | a `band@w` pin Change on the cell | `changes` `band\|cell` | built |
| `heatRank(district)` | `top`, `high`, `mid`, `low` | band pins of all simulated districts | band pins | | `maybe` until two districts are simulated |
| `tension(a, b)` | a pair's band | `city.tension` | | | `maybe` (phase 2) |
| `regime(scope)` | `none`, else the kind of the live regime of greatest size (ties: earliest start, then kind name). `regimeIs(scope, kind)` answers `yes` or `no` | `EventsDigest.regimes` | `regime-start` and `regime-end` events | `changes` `regime\|scope`, at the event times | built |
| `reach(district, item)`, `protected(node)`, `contract(id)` | | `city.flow`, payment edges, contract state | | | `maybe` (phase 2) |
| `presence(leaf, faction)` | `none`, `low` (under 2 % of entry quantity), `mid` (under 8 %), `high` | the index | none: static | one entry | built |
| `priceLevel(district)` | `low`, `fair`, `high`, `extreme` | `EventsDigest.price` | regime events | `changes` `price\|district` | built |
| `refuge(leaf)` | `yes` (a safehouse or lodging service open or quiet, and no cell of the leaf hot), `poor`, `no` | the leaf's services' status and the leaf's cells' bands | **`status@w` pins on the leaf's services and `band@w` pins on the leaf's cells** | `changes` `refuge\|leaf`, written whenever either changes | built; `maybe` if the index lists none |
| `label(audience, subject, axis)` | `unknown`, `low`, `mid`, `high` | `LedgerDigest.labels` | `label-<axis>` pins | `changes` `label\|carrier\|axis` | built for subject `v` and the three carriers |
| `bridge(who)` | `low` (under 0.3), `mid`, `high` (from 0.6) | foci shares (§4.6) | none for generated people | one entry | built |
| `normGap(norm, scope)` | `aligned`, `gap`, `wide` | `NormsDigest` | `gap-<norm>` pins | `changes` `gap\|norm\|district` | built |
| `tied(a, b, type)` | `yes` or `no` | the tie function; materialised edges | edges | the kernel's edge times | built for type `xf:tie` |
| `divergence(believer, subject)` | `none`, `small`, `large`: `large` if any **memorable** belief of the believer about the subject's `alive` or `affiliation` differs from the mirrored reading, `small` if another memorable belief differs, else `none` | memorable beliefs, readings | readings Changes of the subject's `alive` and `affiliation`, **and `boundary: true`: belief changes emit no kernel Changes** | `S1Record.divLog`: an entry whenever S1 sets or drops such a belief or hears such a reading change (at most 8 per pair) | built |
| `depth(node)` | `open` if the node's demand tier is 3 or finer, else `closed` | demand | frame Changes | the kernel's frame Changes | built |
| `groupGap(group)` | `low` (`D` under 0.15), `mid` (under 0.25), `high`: the divergence of §7.8, the hypocrisy seed's material | `GroupDigest` | **`group-gap` pins on the group** | `changes` `group-gap\|group` | built |

The names of the four heat bands are S1's registry strings. S2's text ("quiet, simmering, hot") is an example, and S2 treats band names as registered strings (§16, S2-1).

### 9.2 Registries for S3

- **`producers(kind)`** and `eventKind(name) → { tags, producers }`: the event-kind registry of §5, with each kind's producers (process ids, policy names, `s2`, `port`). A pattern naming a kind that nothing produces is refused by S3 at load.
- **`isSpine(node)`** (§4.4).
- **`aesthetic(node, feature)`**: `undefined` for every feature in M3. S3's `T_aes` is then 0.
- S1's policies ignore `meta:` kinds (S3-I-14).

### 9.3 Hooks for the kernel

`onWitness` (§8.3), `onSocial` (§8.4), `onTick` (`fade`, §8.5), `aggregate` with the S0 contract `{ value, mass, items }` (§8.6), the conflict table, the perception policy (§8.3), and the process registrations with `coarseFine` (§7.0). The conflict table is the kernel's first version, adopted as complete for M3 ([S0 §10.8](kernel.md#108-effects-and-cross-pressure)): `protects X` is violated by `harm`, `kill`, `take` or `expose` on X; `wants Y` by `conceal` or `take` on Y. `onRecall`, `Widen` and the sweep are not built.

### 9.4 Publication lag, and what S7, P8, P9 and P10 read

**Publication lag.** Every process declares its `lag` (§7.0): an occurrence of window `w` is published by the boundary that ends window `w + lag`. With one-window runs, `city.events`, `order.norms`, `order.stocks`, `order.ledger` and `group.decide` publish what they mint at the end of its own window (lag 0). The mirror derives from raw events applied at the start of its window, which were stamped in the window before (S0 §9.4 step 2), so its lag is one window. `scene.acts` opens the window before the one it runs in, so its lag is one window. **The longest declared lag is one window.** [S3 §6.1](procedural.md) holds emissions in a chronological buffer whose horizon is the current boundary less that lag, so a mirrored event with an earlier time is released before a simulated one with a later time that was published first. Late operations (`late-raw`) and events stamped earlier than the lag allows are defects, and are published when found.

- **S7: perspective reads.** Read-only views over the belief and event records: `commonGround(a, b)`; `witnessed(a)` and `told(a)` (the `Id`s of events behind `observed` and `told` beliefs of `a`), so that text is limited to what a speaker could know; `reportability(kind)` (`{ frequency: p_kind, welfare: severity }`). Every event keeps `causes`, `served`, `witnesses`, `place` and `outcome`.
- **P8: realisation candidates.** `candidates(kind, place, period)` returns the matching `RealisationRow` (§5.5) with a cause on each; the default is `none`.
- **P9 and P10: the evidence.** The decision log (§2.3); the pattern register (§14.3); per-process counters (`EventsState.counters`, calendar sizes, ring size, units used per run); and the **why chain** `why(event)`: the cause chain of a minted event, by `causes` and the descriptors' `chain`, to an immigrant or an authored cause in **at most `genMax` (4) links**. Ancestors older than the ring are returned as `Id`s only, marked `beyondRing`.

### 9.5 What S1 reads from S2 and S3

S2 owes S1 the live casts (`core:cast` edges from live seeds, which are the protected set) and V's accepted offers and responses as observed events. S3 owes S1 the stated rule that S3 never reads inside S1's private state, and later the `memorable` rule for returns. S1 reads nothing of the director's beliefs about V.

## 10. Tiers, demand and catch-up

### 10.1 Tiers and demand

Tiers 0 to 2 (city, district, cell or block) hold regimes, the m4 budget, group state, stocks, the recipe, bands, norm slots, labels, the mirror, residents as a count and a household table, summaries and the pending calendar. They run everywhere, always, and catch up. Tiers 3 and 4 (scene, individual) hold the persons present, the summary items in focus as events, and one person's spells, ties, beliefs and authored frames. They run only where demand reaches and never catch up. Tier 5 is the game's. A fact is refined between tiers by the kernel's ordinary open, with the coarse value constraining the fine: an incident is a rate, then a count in a cell's summary, then an item with time, place and size, then participants and beliefs.

The roots are V, the director and live seeds. A root's focus reaches a node at a tier. Fine-tier processes run only at boundaries that demand covered, judged from recorded history (§7.9). When V arrives, fine state is generated from the coarse state, consistent with the pins.

**Demand never changes a coarse process's output** (S1-I-5): no process of tier 0 to 2 reads demand, V's position or `gameOwnedNow`. The invariant is stated against **identical external observations and actions**. What V notices (an `observed` pin) and what V does are external operations, and they change the protected set and the beliefs, as they should. Merely opening more detail changes none of them: opening an item writes nothing a coarse process reads.

### 10.2 Catch-up and the city's reply to V

After an absence the coarse tiers replay every missed boundary in order, each within the hard limits, and read no demand. **When the work exceeds the budget, S1 lags and does not change a period.** The kernel stops between boundaries and resumes, and reads during catch-up answer as of the last processed boundary, flagged `catchingUp`. A jump reads the game's clock and is a session input, never a draw key. V's act at time `t` in window `k` is applied at boundary `k + 1`, processed in window `k + 1`, and its earliest child is due at `k + 2`: more than one and less than three windows after `t`.

**The window V arrives in is covered.** A reading of V's cell applied at boundary `k + 1` puts that cell in the recorded focus **of window `k + 1`**, not only of later windows: the fine-tier processes of a window judge demand after the boundary's external operations have applied and their relevance has been dispatched. So the first window V stands in a cell has its items opened.

### 10.3 Budgets

These are **targets for P7**, not measurements. The first implementation is the TypeScript reference model; hot loops may move to the native core through `bun:ffi` after measuring, with the TypeScript version as the oracle (D-05, D-06). Every figure is **[tunable]**. A window boundary for all S1 processes, whole city, steady state: 1 ms native, 20 ms in TypeScript; with nothing due: 0.2 ms and 5 ms. Catch-up of one game night (144 windows): 150 ms and 3 s; of 30 game days: 4 s and 60 s. Opening a scene (one cell, up to 60 persons): 5 ms and 50 ms. `aggregate`, cached: 20 µs and 200 µs. `tie(a, b)`: 50 allowance units; `neighbours`: a hard cap of 5,000 units; S1's share of one window run: 4,000 units. World index load: 300 ms and 1 s; replay from the nearest snapshot on load: 1 s and 10 s.

Memory and size: S1 resident set, native / TypeScript, 24 MB / 120 MB; the pending calendar a fault limit of 256 per district (about 10 in steady state); the ring seven game days and 5 MB; at most 300 open persons, each with at most 40 memorable beliefs; at most 32 ledger items per (subject, axis, carrier); about 10 Changes per game hour from `city.events` and about 10 more social ones outside focus; S1's part of a save at most 2 MB, growing at most 100 KB per game day of continuous play.

## 11. Persistence and reload

**What S1 persists, and what regenerates.**

| Persisted | Regenerates, identically |
|---|---|
| `ProcessState` of each process (§7), with its last digest and its outstanding batch | Residents, households, spells, traits, names, the recipe |
| The S1 record: absorbed origins, dirty list, divergence log, soft exclusions, the decision log | Implicit ties, routines, `where`, `presentAt`, the cast of any occurrence |
| State pins on temporal slots, and `committed` or `observed` pins | Pressures; strength of a tie |
| Materialised ties and memberships (edges); regard edges | Beliefs that are not memorable; the contributions of an opened item |
| Memorable beliefs, **including every carrier's retained items** | Events that are not canon (re-minted from the ring); items of a summary, from its descriptor |
| Frames of demand roots and live seeds, with ancestors (S0 §7.3) | Frames of everyone else |
| `SettingsSet` ops in force; the lineage record's `sim` version pin (§1.4) | |

**The retained dependency set.** Everything a pending or active thing needs in order to resume is enumerated here. Nothing depends on a record that §7.2's ring may drop.

| Holder | What it needs | Where it is kept | Until |
|---|---|---|---|
| A pending child | its parent's descriptor (kind, size, time, cell, `sides`, `gen`, `chain`), its own kind, size, cell, `modBirth` | the `PendingChild` itself (`parentFacts`) | it fires or is dropped |
| A summary or event re-mint, `why`, heat | descriptor fields and per-item `meta` | the ring entry | seven days |
| An opened item | its descriptor, from the ring entry; its cast, a pure function of the descriptor and recorded history (§5.4) | `ActsState.published` (`item`, `w`, `cell`) | 512 items, and while the ring holds it |
| A carrier's item | the belief, and the canonical origin | the carrier's memorable beliefs; `S1Record.absorbed` | ledger eviction |
| A group's intention | pressures, books, the intention state | `GroupState` (plain data; no frame) | its end |
| R1's and a mirrored canon person's frames | the frame, its ancestors, the nodes in its focus | the kernel's retention roots (S0 §7.3) | the frame closes |
| A norm's signal | the event, value and first window | `NormsState` | its memory ends |
| A decision that read a belief | **memorable beliefs only** (§8.3) | the kernel | |

**Published against materialised.** `published` records that an item's event has been announced; it persists. The contributions an opened item carries are **materialised** state: they are not persisted, and `scene.acts` re-installs them, silently, for the focus (§7.9). A reload can therefore neither republish an item nor leave a published item bare while its scene is in focus.

**Reload.** The outstanding batch is state: restored on load under a new epoch, then applied at its boundary **without re-running the process**. With one-window runs it is at most one window. A cascade saved mid-way and reloaded under another epoch, play clock and wall clock has the same future (S0 F-22, SF1-E2). Loading is replacement ([S0 §14.3](kernel.md#143-loading-is-replacement)); S1 has no rollback logic, and no function reads the load. After a load, `reconcile` runs from the readings the game's state produces (§8.8).

**Versions.** The simulation data are pinned for the lineage (§1.4). A pending child, a retained summary and a ledger item are read under the version that made them. A structural change is a new lineage. When the pinned version is unavailable the record loads read-only (S0 §14.4).

**Twin runs** compare coarse against fine for each process's `coarseFine`, over at least 20 world seeds and several vantage pairs (S23-P9-06).

## 12. The honesty audits

Static audits run at every build, over S1's registry, its declared read sets, its schema and its packs. They report to P9. Each has a fixture (SF1-Q-n). Zero findings is the pass.

| Audit | Checks |
|---|---|
| **V-exclusion** | No S1 function emits a harmful effect (`harm`, `kill`, `take`, `expose`) or a victim or target role naming V; the gate backs it at run time (§6). No S1 function writes a pin, contribution or belief on a drive of V, or any slot of `v` except through the mirror |
| **Firewall** | The declared read set of every S1 registry function excludes the director's beliefs about V and any orientation or bond evidence ([S12-P5-11](../craft/d12-player-model-trust.md)) |
| **No load reads** | No S1 function reads the load class, a load count, the epoch, the play clock or the wall clock |
| **Coarse independence** | No process of tier 0 to 2 reads `gameOwnedNow`, V's position, V's cell, or demand |
| **`meta:` is inert** | S1 policies ignore `meta:` kinds and events whose creator is the director |
| **Source lint** | Attributes that feed any decision come only from affiliation shares, ethos, circumstance and spells. Heritage, gender and name origin are never inputs ([DRV-11](../craft/d01-motivation-drives.md); [S15-S1-06](../craft/d15-people-networks-order.md)). The audit lists every slot a derive reads |
| **Schema order** | Every derive input, conditioned input, `enum-by` input, rule predicate and field base in `xf.core.world@1` reads only an earlier slot of its node or its owner chain (S0 §2.3). A failure refuses the schema |
| **Kind listings** | Every event kind has producers, a carrier, a duration and a content-class listing (§5.1) |
| **One writer, one admission owner** | No two processes write one (node, slot), mint one node family or write one edge type (§2.1). Only `city.events` changes `admit` state; the gate holds none |
| **Feeds** | Every read of a feed has a cursor in the reader's state; no state view is used as an event source (§2.2) |
| **Keys** | Every draw is in the key registry (§1.5); none names the epoch, a load count or a clock |
| **Arithmetic** | No `exp`, `pow`, `Math.log`, gamma or fused multiply-add in any decision. Only the functions of §1.2, with the table hashes of §1.2 |
| **Forbidden policy** | No S1 function schedules offers for retention, loses a tie by absence alone, or applies a guilt or streak effect; none produces intimate scene content; no decision reads a belief that is not memorable |
| **The representation audit** | Over sampled populations, tabulate who is cast as offender or victim, by every tag. It runs on the first S1 population, to set thresholds from data, and reports to dossier 18 (M15-27, M18-06 to M18-10) |

## 13. Invariants

These are S1's own, beside the kernel's I-1 to I-16. **The kernel requirements K-1 to K-8 are supplied by S0 v4.10 (V4-39 to V4-46)** (§16.1).

| # | Invariant |
|---|---|
| S1-I-1 | **Keyed.** Every S1 draw is in the key registry. No key reads the epoch, a load count, the play clock or the wall clock. The same inputs give identical results in every implementation |
| S1-I-2 | **Arithmetic.** Only the operations and table functions of §1.2, with the frozen tables of their hashes. No fused multiply-add. Loops and sums in the order written |
| S1-I-3 | **Partition independence.** Given the same timestamped external operations and the same recorded demand history, no S1 process's history, digest or state depends on how calls were grouped or where saves fell |
| S1-I-4 | **Session independence.** No S1 policy reads a load, a quit, the wall clock or the load class. `fade` reads only the boundary's game time |
| S1-I-5 | **Demand independence.** Given identical external observations and actions (readings, `observed` pins, V's acts, settings), the output of every process of tier 0 to 2 is the same whatever V's position, V's attention and the demand history. Opening more detail is not an observation and writes nothing a coarse process reads |
| S1-I-6 | **One window, no two see each other.** Every process computes one window. A process reads other processes only through digests as of the snapshot, and never its own output within the run. No window is computed under an input that arrived after the run started |
| S1-I-7 | **One writer.** Each state slot, node family and edge type has one writer. Production budgets are state of one process |
| S1-I-8 | **V is never aimed at, never modelled.** No S1 output names V as a harmed party; no S1 state holds a model of V's feelings, desire or drives. The gate backs it |
| S1-I-9 | **One door, one owner.** Every new occurrence the simulation produces passes `produce`, which is stateless. Every size-2-and-above occurrence and size-4 regime is admitted by `city.events`, in `(time, Id)` order, against persisted budgets. Mirrored and replayed events are exempt and never re-filtered; lifecycle notices consume no budget |
| S1-I-10 | **Counts agree.** A summary's count equals its items at its scope; opening an item adds nothing to any count. Every occurrence has one descriptor, and its identity, time and place are the ones the kernel reports |
| S1-I-11 | **Causes precede effects.** A child is born in a **later window** than its parent and later in time; it can be less than `W` later. A derived mirror event has the time of its raw cause. Generations are capped, so every cause chain reaches an immigrant or an authored cause in at most `genMax` (4) links |
| S1-I-12 | **Bounded state.** The effective offspring mean never exceeds `nMax`; the calendar's cap is a fault limit that a run never reaches; the ring holds seven days; a ledger item set 32 per (subject, axis, carrier); a person 20 materialised ties and 40 memorable beliefs; a scene 60 persons and 20 opened items an hour |
| S1-I-13 | **Evidence independence.** A chain of tellings from one origin weighs as the origin; one canonical origin is one item however many events described it; independent items add; an absence changes no label |
| S1-I-14 | **The tie function.** Symmetric; the same after any reload and any call grouping; reads no reputation ledger; no V regard record exists |
| S1-I-15 | **One belief per question,** and a telling's listener holds the teller's `evidence` unchanged. No decision reads a belief that is not memorable |
| S1-I-16 | **Fade keeps the floor.** A belief is dropped only after the hold, never if memorable, never if V returned to it. Carrier evidence is outside fade |
| S1-I-17 | **Game truth wins.** No S1 process writes a mirrored slot of a mirrored node; `reconcile` ends only what the game now contradicts; beliefs and history are left |
| S1-I-18 | **The floors.** No minor, unclassified or real person in the roles `aggressor`, `victim`, `target` or `hostile`; no sexual tag; no protected person chosen by a harm effect. Group involvement never stands in for a person in those roles |
| S1-I-19 | **Regeneration.** A forgotten resident, household, spell, item, scene or cast resolves identically while the pinned versions, the pins and the contributions are unchanged. Casting is a pure function of a descriptor and recorded history. Observed pins persist |
| S1-I-20 | **Derived is never pinned.** No process writes a pin on a derived slot; pressures and strength are functions of facts and time |
| S1-I-21 | **Reload.** A save at any boundary, loaded under any epoch, play clock and wall clock, has the same future (S0 F-22). The outstanding batch applies without re-running |
| S1-I-22 | **Static coverage.** `gameCoverage` is a static function of the index; `gameOwnedNow` is read only by realisation and `scene.acts` |
| S1-I-23 | **Policy state is plain data** in `ProcessState` and the S1 record, versioned with the process |
| S1-I-24 | **Mirrored events are told by their creator.** A derived event's creator is `proc(city.mirror)`, its cause its raw event |
| S1-I-25 | **One publication.** Every completed item and every occurrence is published once as an event Change. Regeneration, reload and forgetting are silent and never publish again |
| S1-I-26 | **Feeds are consumed once.** A consumer reads a feed's windows after its cursor, in order; a state view is never an event source |
| S1-I-27 | **Transitions.** A state pin takes effect at the boundary that applies it, and every registered read publishes timestamped value transitions with the initial value |
| S1-I-28 | **One version.** The simulation data, tables and index of a lineage are pinned and never change inside it |

## 14. Fixtures

Every fixture uses `worldSeed = H("fixture", <fixture id>)`, `W = 600`, the schema pack `xf.core.world@1` with the kernel's core schema plus S0 §20, S2's core and S3's `Layer3Data` where a layer above is needed, and `S1Data` at its defaults, **except** where a fixture says otherwise. Unit fixtures use the slice `FX-3` (§3.2) with `data.events.flatPropensity = true` unless they name a propensity override, `data.ties.cGeo = 4` (FX-3 has 90 residents and `H₉₀ = 5.0826`, so the default 8 would exceed it), and `cityScale = 1`. As in S0, outcomes that depend on hashes are checked as **properties**, not numbers. Numbers given here do not depend on a hash. "Advanced in one call" and "in n calls" mean the same windows run through the harness in different groupings.

### 14.1 Unit fixtures

**Arithmetic and tables (SF1-H).**

| # | Setup | Expected |
|---|---|---|
| SF1-H-1 | **`exptab`.** Evaluate the table and the function | `T[256] = 1`, `T[240] = 0.36787944117144233`, `T[0] = 1.1253517471925912e-7`, `T[320] = 54.598150033144236`. `exptab(0) = 1`, `exptab(−0.5) = 0.6065306597126334`, `exptab(−0.53) = 0.5888916989214128`, `exptab(−16/18) = 0.4112494879003506`. Inputs below −16 or above 4 clamp: `exptab(−17) = T[0]`, `exptab(5) = T[320]`. Bit-identical in two implementations |
| SF1-H-2 | **Error and `pow`.** Midpoints of all 320 cells; `powTab(2, 0.5)` | Maximum relative error 0.04883 %, under 0.05 %. `powTab(2, 0.5) = 1.4148972265482154`, 0.0483 % above √2 |
| SF1-H-3 | **`invCum`.** Weights `[1, 2, 3, 0]`; `u` = 0.1, 0.5, 0.999; weights all zero; a `u` whose product rounds to the total | 0, 2, 2 (`u = 0.5` gives target 3, and `3 < 3` is false); the all-zero table returns 0; the rounding case returns the last index with a positive weight (2) |
| SF1-H-4 | **`spacingCount`.** `draw = [0.5, 0.7, 0.9, 0.2, 0.9]`; `μ = 1` and `μ = 2.5`; `μ = 100` with every draw 0.99; `splitCount(100)` with every draw 0.99 | `−ln` of the draws: 0.6931, 0.3567, 0.1054, 1.6094. `μ = 1`: partial sums 0.6931, 1.0498 → count 1. `μ = 2.5`: 0.6931, 1.0498, 1.1552, 2.7646 → 3. `μ = 100` stops at the cap, 64, and logs `cap-hit`. `splitCount(100)` uses 4 parts of 25, **each reaches its cap of 64**: 256 in all and four `cap-hit`s |
| SF1-H-5 | **`nbCount`.** `n = 0.45`, `k = 0.3`; `u` = 0.5, 0.8, 0.9, 0.9995; and `n = 0.25` | `p₀ = 0.76001`, cumulative 0.76001, 0.89681, 0.95017, …, 0.99824 at 7. `u` gives 0, 1, 2, 8. For `n = 0.25`, `p₀ = 0.8339`: 83 % no children |
| SF1-H-6 | **The table artifacts.** Regenerate `exptab@1`, `normtab@1`, `lqtab@1` and hash them | The SHA-256 values of §1.2. `Z[i] = −Z[4095 − i]` exactly; `Z[0] = −3.668329285121323`; `LQ` has mean 1 to 1e-12; its top 5 % of entries hold 0.479 of the mass and the top 1.25 % hold 0.256. A pack naming another `σ` is refused |
| SF1-H-7 | **No fused multiply-add.** `0.1 × 10 + (−1)` evaluated by `a × b + c` | Exactly 0. A fused implementation gives 5.55e-17 and fails |
| SF1-H-8 | **`procRand` is window-keyed.** The draw for window 7 from the run of window 7, and through a harness that advanced from window 0 in one call | Equal |

**Shapes, regimes and admission (SF1-S).**

| # | Setup | Expected |
|---|---|---|
| SF1-S-1 | **Mean-one shapes.** Every city kind; theft (hour shape `0.8·1.0·1.2·0.9`, flat day); shakedown (`0.5·1.5·1.0·0.2`, Friday 10 to 16 ×3) | `Σ shape(k, t)` over the 168 hours of a week is 168 to 1e-12. Theft: `M = 0.975`, `shape` at period D 1.0256410. Shakedown: `M = 0.8833333`, `shape(Fri 12:00) = 5.0943396`, `shape(Mon 12:00) = 1.6981132` |
| SF1-S-2 | **Regimes.** 20 seeds, 30 game days, FX-3, rate 0.03 a day | Arrivals within three standard deviations of 0.9; no regime ends before `plannedEnd`; every regime is gone by `maxDwell`; one live regime of a kind per district |
| SF1-S-3 | **The m4 budget.** `admit.m4Times` = [100, 600] | `m4Open = max(600 + 432, 100 + 1008) = 1108`. A size-4 incident at window 1107 is refused (`budget-m4`); at 1108 it is admitted. With one time [100], `m4Open = 532`; with none, 0 |
| SF1-S-4 | **No coupling inside a window.** The same window with `city.events` as specified and with a version that mints nothing | The digests, states and pins of every other process in that window are identical: each read only the previous window's digests |
| SF1-S-5 | **One admission owner.** Window `w ≥ m4Open` with two size-4 incident candidates 30 s apart and a size-4 regime candidate; and a `regime-end` of a size-4 regime in the same window | The earlier incident by `(time, Id)` is admitted and the later refused `budget-m4`; the regime is demoted to size 3 and uses no budget; `admit.m4Times` gains one entry; the `regime-end` is minted and counted by no budget. The same result whatever the order candidates were produced in, in one call or many, and after a save before the window |
| SF1-S-6 | **A value closes and reopens in one batch.** FX-3; a live `festival` at its `maxDwell` in window `w`; a `crackdown` arrival forced in `w` (rate 5,760 a day, so the count is 1) | `regime(D1)` transitions from `startOf(w) − 1` to `startOf(w + 1)`: `[(startOf(w) − 1, festival), (startOf(w), none), (t_arrival, crackdown)]`, the end before the start if the times are equal. A closing condition `regime = none` evaluated at each entry latches; `eval` at `startOf(w + 1)` alone answers `crackdown` |

**Incidents (SF1-I).** `FX-3` with the propensity override `L = (c1: 3.0, c2: 1.0, c3: 0.5)` where a fixture needs it.

| # | Setup | Expected |
|---|---|---|
| SF1-I-1 | **The mean.** Theft, m1, Wednesday 12:00, `L = 1` | `share = 3.5 / 35 = 0.1`; `μ = 90 × 1.0256410 × 0.1 × (600 / 86400) = 0.0641026`. Gang-clash at the same time: coverage 0.5 at `c2` gives `aD = 1 + 1 + 0.5 = 2.5`, `cityTotal = 34`, `share = 0.0735294` |
| SF1-I-2 | **Cells.** Theft, with the override | Cell weights `a = 3.0, 2.0, 0.25` for `c1, c2, c3`: shares 0.5714, 0.3810, 0.0476. Every incident has a cell before its summary: no summary is scoped to the district |
| SF1-I-3 | **Ids are keyed.** An event of window `w`, district `d`, kind `k`, index `i`, in runs with different save points | The same `Id` `H("mint", proc, proc, "ev/<w>/<d>/<k>/<i>")` |
| SF1-I-4 | **Offspring.** An m2 `gang-clash` parent | `n = 0.30`; the count by `nbCount(0.30, 0.3, u)` in 0 to 8; every child is due at least one window after the parent; a child of size 2 or more has the `Id` `H("mint", proc, parent, "child/<index>")`; a child of size 1 is an item of its cell's summary of its due window |
| SF1-I-5 | **Causality.** 20 seeds, 30 game days | Every child is born in a later window and at a later time than its parent; no cause follows its effect. The elapsed time is **not** asserted to be `W`: a child of window `w + 1` may be a few seconds after a parent late in `w` |
| SF1-I-6 | **The calendar's fault limit.** Insert 300 children in one district by fault injection | Order `(due, parent, index)`; 256 remain; the lowest-size, largest-`Id` entries went first; `calendar-overflow` is logged once per overflow and counted. A run of the week fixture never logs it |
| SF1-I-7 | **Heat and bands.** One isolated m2 event in window `w` in a cell with no neighbours of consequence, offspring off | Heat 3.0 after `w`: elevated from window `w + 1` (pin `band@w<w + 1>`). 2.1 at age 36; `3 × 0.4 = 1.2000000000000002` from age 37 to 144 (not below the leave threshold 1.2, so it stays elevated); 0.45 at age 145. The `quiet` pin is `band@w<w + 146>`, computed at the end of `w + 145`, and no earlier |
| SF1-I-8 | **Dwell.** A second event, of size 4, at `w + 10` | Heat 30 at `w + 10` would justify flashpoint, but the band stays elevated and no pin is written until the end of `w + 145`. There heat is `0.15 × 3 + 0.4 × 27 = 11.25`: the band rises to hot (below flashpoint's 12), pin `band@w<w + 146>` |
| SF1-I-9 | **Summary and item agreement** (M14-16). 100 windows | For every summary: the count equals the items enumerated; each item's place is the summary's cell; canon items persist |
| SF1-I-10 | **The ring and `why`.** 10 game days | Descriptors older than 1,008 windows are gone; a summary or an event within 7 days re-mints under its `Id` with the same items; a `why` chain from any occurrence reaches an immigrant in at most 4 links; an occurrence of generation 4 has no children |
| SF1-I-11 | **The district cap.** Fault injection: 10 size-2-and-above candidates in one district and window | The ninth and tenth in `(time, Id)` order are refused `cap-window` and draw no offspring; the counter is not persisted into the next window |
| SF1-I-12 | **Demand independence** (M14-20). Two runs with V in different cells; one with `gameOwnedNow` toggled | Identical tier 0 to 2 states, digests, pins and events. Coverage lowers the rate in a covered cell for every run |
| SF1-I-13 | **Game cover.** A pending `gang-clash` child at `c2` due at window 160; a mirrored `gang-clash` at `c2` covered at window 156 | The child is thinned at 160 with reason `game-covers`, logged as a correction. A pending `theft` child at `c2` and a `gang-clash` child at `c3` (two steps away) fire as usual |
| SF1-I-14 | **Reports.** `E = Y = 0.5`, `fear = 0.2`, `noSnitch = 0.4`, `r0 = 0.7`, witness bonus 3 | `reportChance = 0.7 × 0.5 × 0.75 × 0.8 × 0.6 × 1.3 = 0.1638`. A `police-action` child exists only if `rand("report", parent, index) < 0.1638` |
| SF1-I-15 | **The mean is bounded.** `cityScale` 5, a live `festival` and `crackdown` in one district, an m4 `disorder` parent | The unclamped mean `0.6 × 5 × 2.6 = 7.8` is clamped to `nMax = 0.85` and logged `n-clamped`. Over 1,000 cascades from one m4 root no chain exceeds 4 links |
| SF1-I-16 | **One descriptor.** A size-3 parent with a child of size 1, and one of size 2; a size-1 parent with a child of size 1 | The size-1 children are items of the cell summary of their due window, with the kernel's `Id`, time (`item-t`) and place (the cell) and a `meta` parent link; the size-2 child is an event with `Id` `H("mint", proc, parent, "child/<index>")`, whatever the parent's size. For every one the descriptor's `id`, `time` and `cell` equal those the kernel reports on materialising it |

**The mirror (SF1-M).**

| # | Setup | Expected |
|---|---|---|
| SF1-M-1 | **The table.** One raw event of each row of §7.3 | The derived kind, size, participants and effects as the table says; `game.combat.end` and `game.district` give none; `game.heat.2` after `lastHeat = 3` gives none and sets `lastHeat = 2` |
| SF1-M-2 | **Creator, cause and time.** A raw death | The derived event's creator is `proc(city.mirror)`, `causes` is `[raw]`, `time` is the raw time, its `Id` is `H("mint", proc(city.mirror), raw, "mir")` |
| SF1-M-3 | **A raw death.** Save before and after | One derived event with the raw event as cause, exempt from the gate and admission, identical after a reload |
| SF1-M-4 | **A mirrored person dies.** Authored frames and a membership and a tie of person `mv`; the reading `alive` goes to `no` | The frames are `abandoned` (cause: the reading's change); the membership and tie edges are ended; the beliefs about `mv` stand; one correction `game-dead` is logged |
| SF1-M-5 | **An older save.** Load a save from before the death, with the game's state after it | The record before the death is intact. `reconcile` supersedes only what the game now contradicts; nothing else changes |
| SF1-M-6 | **The cap.** 20 raw deaths in one window | 12 derived events; 8 `cap-hit` logged; the raw events remain |
| SF1-M-7 | **Late raw.** A raw event stamped three windows before it was applied | Processed once; `late-raw` logged |
| SF1-M-8 | **Publication lag.** A raw death at `T` in window `w`; a simulated m2 event at `T + 100 s` in the same window | The simulated event is published at the boundary ending `w`, the derived mirror event at the boundary ending `w + 1`; no event is published later than the end of window `w + lag`. With S3's buffer at horizon boundary − 1 window, the mirrored event (earlier time) is released first |

**People and ties (SF1-P, SF1-T).**

| # | Setup | Expected |
|---|---|---|
| SF1-P-0 | **The schema.** Load `xf.core.world@1`; resolve 1,000 households | The schema audit finds no read of a later slot or of an owned value; no `cycle` and no defect on resolution; every resident's `age` lies in the band of its `profile`, and `age-class` agrees (band 0 is minor, the rest adult); a pin on a resident's `profile` narrows its household's slot |
| SF1-P-1 | **IPF by hand.** Seed `[[2,1],[1,2]]`, rows `[0.7, 0.3]`, columns `[0.4, 0.6]`, 20 iterations | `[[0.34213, 0.35787], [0.05787, 0.24213]]`; the column marginals are exact and the row marginals within 1e-9 |
| SF1-P-2 | **A district fit.** FX-3 marginals | After 20 iterations the dimension fitted last is within 1e-9 and every other marginal within 1e-6 (iterative proportional fitting converges at a finite rate; the iteration count, not the tolerance, is what makes the result deterministic); `w = t / max(t)` has maximum 1; the household table has 60 cells |
| SF1-P-3 | **The recipe is fixed.** Alter the index marginals inside a lineage | The pinned fit and its hash are read; nothing refits; the pinned-version check refuses the altered index (§1.4) |
| SF1-P-4 | **Rosters.** 10,000 sampled households | `none` for `j ≥ size`; no `family` child within one S1 band of member 0 or older; `crew` houses share an affiliation; `couple` members within one band |
| SF1-P-5 | **Residents are regenerated.** Resolve 50 residents, forget the block, resolve again, reload, resolve | Identical profiles, ages, traits, names |
| SF1-P-6 | **Spells.** Work track, age band 3 | `spellLen` for `q = 0` is 12,096,000 s (140 d) and for `q = 15` 120,960,000 s (1,400 d); a walk to day 20 and to day 2,000 takes at most 64 steps and is identical after a reload |
| SF1-P-7 | **`where`.** A protected resident; a resident in an `ill` health spell; a jump of 30 days and 4,320 single steps | The protected resident is never `away`; the ill one is `away` with cause `ill`; the answers are identical under the jump and the steps |
| SF1-T-1 | **Symmetry.** 10,000 pairs of FX-3 | `tie(a, b) = tie(b, a)`; the same after a reload and under any call grouping |
| SF1-T-2 | **The numbers.** `N = 90`, `cGeo = 4`, rank 10 | `pGeo(a→b) = 4 / (5.0825706 × 10) = 0.0787003`; two members of one household: `p = 1` and always tied; two crew-cell members with no other focus: `p = 1 − (1 − pg) × 0.7` |
| SF1-T-3 | **Acceptance.** Rung `friendly`, `warmth = 0.3`, `trustMean = 0.6`, `sociability = 0.5` | `pAccept = 0.5 + 0.12 + 0.03 + 0 = 0.65`. A boundary pin refuses without a draw. The draw `rand("accept", tie, event)` is the same after a reload |

**Norms, stocks and the ledger (SF1-N, SF1-O, SF1-L).** Norm slots use the two default norms, `nu = 0.4`; thresholds as §7.5.

| # | Setup | Expected |
|---|---|---|
| SF1-N-1 | **A window's update.** `beh = 0.5`, `perc = 0.8`, `priv = 0.7`, no recent enforcement (`vis = 0`), `η = 0.058`. (a) no signal; (b) a public signal of 0.9 acting in this window (`φ = 0.6`) | (a) `beh = 0.625`, `perc = 0.78985`. (b) `beh = 0.625`, `qe = 0.79`, `perc = 0.79942`. The relaxation settles in two passes |
| SF1-N-2 | **Gap bands.** `gap` = 0.31, 0.27, 0.24, 0.09, 0.07 in turn | `wide` (2), `wide`, `gap` (1), `gap`, `aligned` (0). A pin is written only at 0.31, 0.24 and 0.07 |
| SF1-N-3 | **Enforcement.** `fee`, `beh = 0.875`, enforcer share 0.10 | `μ = 3 × (600 / 86400) × 0.125 × 1 = 0.0026042`; each use is an event of kind `enf.fee.<rung>` through the gate; a rung whose class is at ceiling 0 is never drawn |
| SF1-N-4 | **Public against private** (S0 F-25). Run 12 windows with one public enforcement event, with one private (witnesses under 5), and with none | The private run equals the none run exactly; the public run differs; each is identical in 12 calls and in one |
| SF1-N-5 | **The endpoints.** `beh = perc = 0`, then `beh = perc = 1`, no signal | Zero compliance is absorbing: `beh` and `perc` stay 0. Full compliance stays 1. Verified before any tuning |
| SF1-N-6 | **Each signal once.** One external public event found in window `w`, and still in the query range at `w + 1`; one own public event minted in `w`; two public events in one window | The external event acts from `w` with `φ = 0.6`, then 0.1, and is taken once (`seen`); the own event's signal acts from `w + 1`; of two in one window the later by `(time, Id)` replaces the earlier |
| SF1-N-7 | **Types.** 10,000 residents; an enforcement event | Type shares within sampling error of 1/8; the target of an enforcement event is a non-complier by the `qe`, `qn` of its ring entry, and re-minting it from that entry gives the same cast |
| SF1-O-1 | **Each row once.** One public enforcement fact, one answered incident, one unanswered public incident, one m2 shakedown, produced in window `w` | The facts are consumed in the window the cursor passes them and applied once; later windows apply none; a save between production and consumption neither drops nor repeats them |
| SF1-O-2 | **Retention.** No events for 30 game days | `E`, `Y`, `L` stay at their baselines; after a +0.01 shock `E` decays back with factor 0.9966 a window |
| SF1-O-3 | **Bounds and partition.** A soak of 100 game days, in one call and in many | Stocks in 0 to 1; identical histories |
| SF1-O-4 | **A lost window.** A consumer not run for 10 windows with `keep = 8` | `feed-gap` is logged; the consumer resumes from the first retained window |
| SF1-L-1 | **The worked trace** (S0 F-24). Axis `reliable`, reach 1, `λ = 0.9`, items +0.5, +0.5, −1.2, −0.8, −0.8 (each with weight 1) | `(r, s, E, mass)`: `(0.5, 0, 0.6, 0.5)` unknown; `(0.95, 0, 0.661, 0.95)` unknown; `(0.855, 1.2, 0.4575, 2.055)` mid; (30 game days with no events: unchanged); `(0.7695, 1.88, 0.3806, 2.6495)` low; `(0.6925, 2.492, 0.3265, 3.1845)` low |
| SF1-L-2 | **A chain adds nothing.** A tells B tells C; then A tells C | C's belief has `evidence = {E}`; the carrier's mass is that of the origin; the second telling refreshes |
| SF1-L-3 | **Displacement.** From step 3 of SF1-L-1, one independent contrary item | The label moves from `mid` to `low` |
| SF1-L-4 | **Aggregate against residents** (M15-18). 200 sampled residents with `knows` over `reach`, the resident sum of §8.6 | The mean of their own `r` and of their own `q` is within sampling error and 0.1 of the aggregate's `r` and `q`. The posterior `value` is reported, not asserted equal |
| SF1-L-5 | **The cap.** 33 items for one (subject, axis, carrier) | The item with the lowest `(|v| × salienceWeight)`, then the oldest, then the lower `Id` is evicted; its index is reused; its `absorbed` entry keeps `−1`; paths stay unique (I-9) |
| SF1-L-6 | **Aliases.** V kills a vendor: the raw `game.death` and the derived `assault` both reach the watch frame; heard in either order | One item per carrier and axis, with `evidence = [raw Id]`; `absorbed` holds the origin once; a second occurrence adds a second item |
| SF1-L-7 | **Carrier retention.** A carrier holds items 14 and 60 days old; a person holds a non-memorable belief of the same age | The carrier's items are kept and persisted across a save and load, and its label is unchanged; the person's belief is dropped |
| SF1-L-8 | **Diagnosticity.** A V `promise` with outcome `done`; a kind with no `diag` entry | `diag = 1.5` for `promise`, so `v = 0.5 × 1.5 = 0.75` on `reliable`; 1 for the other |

**Groups (SF1-G).**

| # | Setup | Expected |
|---|---|---|
| SF1-G-1 | **Operative weights.** The Claws' four drives, ethos treasury 2, retribution 1, reputation 1.5, cohesion 1, `U = 0.2` for all | `ethosN(treasury) = 0.363636`; `W(treasury) = 0.5 × 0.363636 + 0.5 × 0.25 = 0.306818`; `Σ W = 1`; divergence `D = 0.0681818` |
| SF1-G-2 | **Books.** `cash 9,000`, `burn 300`, `income 330` | Runway 30 days, treasury `U = 0`. With `income 0`, after 15 days `cash = 4,500`, runway 15, `U = 0.5` |
| SF1-G-3 | **Retribution.** A victim fact of size 2 | Latched pulse `0.8 × 0.6 = 0.48`; held at `0.24` until released; released by a retaliating clash, not by time |
| SF1-G-4 | **The hazard.** `h0 = 0.02`; a public harm | `hazard = 0.02 × 1.5 = 0.03`; the check draws `procRand(w, "retal", group, rival)` |
| SF1-G-5 | **The intention lifecycle.** The Claws with `income 0`; then a Mox with a latched pulse of no rival; then a drive that falls | `collect-fee` starts in the first window whose `w(treasury) ≥ 0.35` (about day 8.3), is active from the next, publishes `shakedown +1.0` every window, expires 144 windows later (`done`), is absent from the next digest, then `cooling` for 72 windows, then `none`. The Mox's `retaliate` is not feasible: state `idle`, logged once, no boost. An intention whose drive falls below 0.20 ends `ended` and its boost is removed |
| SF1-G-6 | **Demand independence.** Two runs with different demand | Identical group state, digest and decisions; the process makes no call to `demanded` |

**Witness, social and fade (SF1-W).**

| # | Setup | Expected |
|---|---|---|
| SF1-W-1 | **Salience.** A harm event with pulse 0.8, to a person with a tie to the observer, matching an authored `protects` frame | Points: stakes 1, pulse 1, tie 1, V mattered 0: salience 3, memorable |
| SF1-W-2 | **Attribution.** Neutral observer, no load. (a) no cause in `causes`; (b) a visible cause | (a) `wD = 0.65`, dispositional region, `confidence = q64(0.55) = 0.546875`. (b) `wD = 0.45`, situational, `confidence = q64(0.45) = 0.453125` |
| SF1-W-3 | **Telling.** `protectiveRelevance 0.8`, severity 0.7, closeness 0.6 | `score = 0.336`, `p_tell = 0.3 × 0.336 = 0.1008` |
| SF1-W-4 | **Hearsay** (S0 F-9). Alice observes `E`, tells Carl, Carl tells Dana; then Alice tells Dana | Dana's belief has `evidence = {E}`, `source.by = told` (teller Carl, the telling event); the second telling only refreshes it |
| SF1-W-5 | **Fade.** A non-memorable belief refreshed at `t₀`; one memorable; the setting raised | Not dropped at `t₀ + 14 d` exactly; dropped at `+ 14 d + 1 s`; the memorable one kept; raising `memoryScale` changes nothing a stricter run dropped |
| SF1-W-6 | **A telling is not harm.** A `tell` whose subject is V, and one whose subject is a protected canon person | Both are minted: no effect, an informational `subject`; the gate passes them. A consequential `expose` with V as the target is refused `v-target` |
| SF1-W-7 | **Only memorable beliefs decide.** Forget every non-memorable belief of a focal person, and reload | No telling decision, `divergence` answer or S1 output changes |

**The gate, the reads and the audits (SF1-X, SF1-R, SF1-Q).**

| # | Setup | Expected |
|---|---|---|
| SF1-X-1 | **A line.** Class `harm.groups` at ceiling 0; 10,000 sampled events | Zero counts and zero children for every kind listing it; a person with no age class is never in a victim, target or hostile role |
| SF1-X-2 | **The floors.** Roles `aggressor`, `victim`, `target`, `hostile` | Only `adult` persons; a missing class is `minor`; a person marked real is refused; a sexual tag is refused; a `<role>-group` participant never fills a floor role |
| SF1-X-3 | **V.** 10,000 sampled events | V is never a victim or target; no effect `harm`, `kill`, `take` or `expose` names V |
| SF1-X-4 | **The protected set.** A person with a cast edge | Never chosen for a harm effect; never absent by `where`; casting uses `protectedAt` the occurrence's time and the gate the set now |
| SF1-X-5 | **Casting.** A `police-action` child of a theft; a `gang-clash` in a cell whose present residents contain no member of side B | The child's victim and target are the parent's, re-cast by the same pure function; the clash's side B is the group involvement `victim-group` (never a person); a cell with no member of `A1 … A3` for a required class gives `no-cast`; casting names nobody who is not present, alive, adult and unprotected |
| SF1-R-1 | **The reads.** Each read of §9.1 before the first processed boundary, then after | `maybe`, then the answer; the unbuilt reads stay `maybe`; no read exposes a number |
| SF1-R-2 | **Transitions.** `band(c)` over a window in which it rose; `normGap` over a window in which it fell | `[(from, quiet), (startOf(w + 1), elevated)]`, with the initial value first; the same shape for `normGap`; a `from` older than 8 windows answers `maybe` |
| SF1-R-3 | **Complete invalidation.** A leaf's cell goes hot with every service unchanged; a group's gap band changes; a believer's memorable belief about a subject's `affiliation` is set | `refuge` is re-evaluated by the `band@w` pin; `groupGap` by the `group-gap` pin; `divergence` at the next boundary (`boundary: true`) and its `divLog` gains an entry; each answer changes at the transition time |
| SF1-Q-1 | **The audits.** The registry, schema and packs as shipped | Zero findings |
| SF1-Q-2 | **The audits catch.** A function using `Math.exp`; a key naming the epoch; a tier-1 process reading `gameOwnedNow`; two writers of one slot; a second writer of an admission budget; a feed read with no cursor; a derive reading a later slot; a kind with V as a victim; a derive reading a heritage tag | Each is reported, and nothing else is |

**The fine tier (SF1-A).**

| # | Setup | Expected |
|---|---|---|
| SF1-A-1 | **Opening and publication.** A focused cell with 3 m1 items in window `k − 1`, recorded in `prev` | The run for `k` opens three events with cast people (adults), at most 12 witnesses, `outcome` `done`, **each published exactly once as an event Change** that the sifter hears; the summary's count is unchanged; the casting keys name the item `Id`, not `k` |
| SF1-A-2 | **Regeneration is silent.** Open, forget the scene, reload, bring the cell into focus | Identical participants and witnesses; the contributions are restated; **no second event Change**; the `published` list is unchanged |
| SF1-A-3 | **No catch-up, recorded demand.** Demand absent at window `j`, present from `j + 1`; and present at `k − 1`, absent at `k` | Window `j`'s items are never opened; window `k − 1`'s items are opened at `k`, because they were in the recorded focus of their own window |
| SF1-A-4 | **The gate.** A cast resolving to a minor in the role `victim`; a person who became protected between occurrence and opening | The item stays unopened; `floor-minor` or `protected` is logged |
| SF1-A-5 | **Coarse against detail.** The items in focus, opened or not, against the summary's count; twin runs with V in different cells | Equal counts; identical tier 0 to 2 outputs; only `scene.acts`' output differs |

### 14.2 End-to-end fixtures

**SF1-E1. A Kabuki week, in one call, in 1,008 calls and with reloads.** World seed `H("fixture", "SF1-E1")`; the slice `xf.kabuki.index@1` (the stand-in of §3.2 until W1 builds the real one); the packs of §0.2 at their defaults; V's mirrored cell `g1` from a replay script that holds only V's position and district readings; settings default. The script injects, at window 300, one public external enforcement event (`enf.fee.word`, place `g2`, 6 witnesses), and at window 400 one private one (3 witnesses). **Run A:** advance 1,008 windows in one call. **Run B:** 1,008 calls of one window. **Run C:** seven daily calls, with V's mirrored cell moved to `g9` in the replay script and the `demanded` set different. **Run D:** as A with a save and load at a random boundary on each of three days.

| Check | Expected |
|---|---|
| Records | The canonical encodings of every process state, digest, feed, pin, edge, belief, minted event and summary, the S1 record and the decision log are byte-identical in A, B and D. In C the tier 0 to 2 parts are identical to A; only `scene.acts`' output differs (S1-I-3, S1-I-5, S1-I-21) |
| Volume | For each kind, the number of immigrants is within four standard deviations (Poisson) of `Σ μ` over the 1,008 windows, **computed from the realised propensities `ε`** of the run. (A bound from a nominal 4 % share would be wrong: `ε` is log-normal, so a district's total varies by seed.) Children are counted apart. No m4 closer than 432 windows to another |
| Agreement | Every summary's count equals its items at its cell; canon items persist; every descriptor's `id`, `time` and `cell` equal the kernel's (S1-I-10) |
| Causes | Every child is born in a later window than its parent; every chain reaches an immigrant in at most 4 links (S1-I-11) |
| Bands | No two band pins on one cell within 144 windows |
| Bounds | The calendar never exceeds 256 per district and `calendar-overflow` is never logged; stocks and norm slots stay in 0 to 1; the ring is at most seven days |
| Norms | After window 300 the district's `perc` of `fee` differs from the run without the injected event; after window 400 the run with the private event equals the run without it |
| Publication | Every opened item is published exactly once and no event after its lag (S1-I-25) |
| Floors | No participant of a role `aggressor`, `victim`, `target` or `hostile` is a minor, an unclassified person or V; no protected person is the object of a harm effect |
| Replay of reads | `band`, `normGap`, `priceLevel`, `regime` and `presence` answer at every window after the first processed boundary; the unbuilt reads answer `maybe` |

**SF1-E2. A save and reload in the middle of an aftershock cascade.** World seed `H("fixture", "SF1-E2")`; `FX-3`; every entry of `data.shape.rate` multiplied by 10 (`cityScale` stays 1, so the offspring means do not rise; the calendar stays far below its fault limit); `gang-clash`'s `offspringFactor` 1.3 (an m4 mean of 0.78, under `nMax`); `flatPropensity`. **Run U:** advance 1,008 windows. The harness finds the first boundary `b* ≥ 200` at which the district's calendar holds at least three pending children, one due more than 100 windows later. **Run R:** run to `b*`, save, discard everything, load into a fresh process under a different epoch, play clock and wall clock, replay the external operations after `b*`, and run to 1,008. Then two further reloads at random boundaries.

| Check | Expected |
|---|---|
| Future | The records of R equal those of U: the same pending children fire with the same draws at the same cells and times; the same thinning; the same bands; the same decision log (S0 F-22, S1-I-21) |
| Batches | The outstanding batch is applied at its boundary without re-running the processes: the run counter does not rise after the load |
| Replay | Events minted before `b*` are not re-minted; those within seven days re-mint from the ring under the same `Id`s |
| Independence | Perturbing the epoch, the play clock, the wall clock and the load count changes no byte (S1-I-1, S1-I-4) |

**SF1-E3. The mirror overriding a simulated value with a game reading.** World seed `H("fixture", "SF1-E3")`; the Kabuki stand-in. A mirrored vendor `mv` (affiliation `civilian`, `quest-linked` no, `alive` yes) in the market cell `v2`, with **authored** state in place of generated policy state: a committed goal frame `pay-collector`, a `member-of` edge to the `circle-stalls`, and a materialised tie edge with V. The fixture sets the initial `EventsState` calendar to hold: **C**, a `gang-clash` child at `g3` due at window 160; **D**, a `theft` child at `g3` due at 160; **E**, a `gang-clash` child at `g11` (not within one step of `g3`) due at 160. The replay script has, at `t = 90,300` (window 150), a `game.combat.start` at `g3` with two hostiles (`TygerClaws`, `TheMox`), and at `t = 90,900` (window 151) a `game.death` of `mv` with the actor a `TygerClaws` person, 3 witnesses, and `mv`'s `alive` reading going to `no` at the same time. The harness also adds a `simulation`-layer `Const` contribution `mv.alive = yes`.

| Check | Expected |
|---|---|
| Derived events | One `gang-clash` of size 1 for the combat (2 hostiles) and one `assault` of size 2 for the death (3 witnesses): each with its raw event as cause, creator `proc(city.mirror)`, the raw time, minted once, and never refused by admission (SF1-M-1, SF1-M-2) |
| The game's reading wins | `resolve(mv, "alive")` is `no` and `mv.position` is the game's reading, whatever the `simulation` contribution says: the mirrored slot is never sampled (S0 §5.1 step 2). The game's reading is returned before any contribution is gathered, so the `simulation` statement stays in the store, inactive, and the slot's trace lists no constraint from it |
| Simulated values corrected | The `city.events` run for window 156 reads the mirror digest's `cover`. Child **C** (same kind, cell `g3`) is thinned at 160 with reason `game-covers`, logged as a correction. **D** (a different kind) and **E** (two steps away) fire by the usual rules. `mv`'s frames are `abandoned` (cause: the reading's change), its memberships and tie edges are ended, its goal `pay-collector` is `abandoned`; the beliefs held about `mv` stand; **one** `game-dead` correction for `mv` is logged and no more |
| Partition and reload | The same records in one call and in per-window calls, and after a save between the death and window 156 and a load under another epoch (S0 F-12, F-16, S1-I-17, S1-I-21) |

**SF1-E4. Reload after the parent has left the ring.** World seed `H("fixture", "SF1-E4")`; `FX-3`; every rate multiplied by 3; delay weights `[0, 0, 0, 0.3, 0.4, 0.3]` for every kind, so that children outlive the ring (the calendar stays near 110, under its limit); R1's goal frame as an authored, committed, active frame of a mirrored canon person. **Run U:** advance 2,600 windows. The harness finds a boundary `b*` at which a pending child's parent is older than 1,008 windows and R1's goal is active. **Run R:** run to `b*`, save, reload under a new epoch, play clock and wall clock, and run on.

| Check | Expected |
|---|---|
| The child fires | The child fires with the same kind, size, cell, time and cast as in U, including a `parent` role (a `police-action` still protects the original victim). Its `parentFacts` and the pure casting reconstruct it without the ring |
| The chain | Its `why` chain has at most 4 links; ancestors beyond the ring are `Id`s marked `beyondRing` |
| The active goal | R1's goal frame is still active after the load, retained through S0 §7.3; no S1 decision depends on a non-memorable belief |
| Published items | Items published before `b*` are not published again; those inside the ring are re-installed silently when their cell is in focus |

### 14.3 Property tests, patterns and panels

The reference model also checks, over generated scripts, logged named streams, and shrinking of failures ([dossier 23](../craft/d23-evaluation-testing.md) §12):
- **S1-I-1 to S1-I-28** as properties, including random saves at boundaries and loads between any two windows;
- **partition and reload:** random call groupings and random save and load points over generated external operation scripts, for every process;
- **regeneration under random forgetting** of residents, households, items, scenes and casts;
- **summary and item agreement** at each cell;
- **metamorphic relations:** moving a district's opportunity out of `rest` into a new simulated district with the same totals changes no other district's draws; **renaming a display name changes nothing, while renaming a hashed `Id` changes histories but not their distributions** (the pattern tests hold); scaling `cityScale` scales the means (up to the offspring clamp) and nothing else;
- **hard limits** under fault injection (a calendar over its cap, a ledger over its cap, a walk over its limit, a feed past its keep);
- **demand independence:** random demand histories change no tier 0 to 2 output given the same external observations.

**The pattern register** (S23-P9-05). A pattern used to calibrate is never used to validate. Calibration seeds are `H("cal", i)`, `i = 0 … 9`; validation seeds `H("val", i)`, `i = 0 … 19`. **Calibrated:** M14-01 (the `σ` of `lqtab`: a different `σ` is a new table artifact and a new lineage), M14-07 (the offspring means), M15-11 and M15-14 (the norm thresholds, the report inputs). **Validated only:** M14-03, -04, -05, -06, -08, -09, -10, -14, -16, -18, -20, -22, -24 and M15-01 to -05, -15 to -18, -27. The pass bands are those of [dossier 14 §7](../craft/d14-city-events.md#7-measures) and [dossier 15 §7](../craft/d15-people-networks-order.md#7-measures).

**Spec-only reimplementation** (VLD-08). One S1 process, `city.events`, is reimplemented from its written page by someone who has not seen the code; the disagreements are filed as specification gaps.

**The template-written week and the panel.** A week in Kabuki is written out from the SF1-E1 record by a fixed template (a line per published event, summary count, band change, norm gap and label change, in time order, with its cause chain). It is shown to readers who know the game, for panel P-C (M14-17, P15-01): does anyone seem to know anyone, do things seem caused, does a norm feel enforced, does the street react to V as to someone it has met. The panel decides whether phases 2 and 3 are needed at all.

**What M3 asks of the game:** nothing. The in-game rows are batched into one prepared session with a friction log, run by the maintainer when M4 starts.

## 15. Departures from P3

Where P3 was underspecified, inconsistent or could not be implemented as written against S0 v4.10, this page decided. The list is complete. Section numbers in the "P3 says" column are P3's.

| # | P3 says | S1 does | Reason |
|---|---|---|---|
| 1 | §5.2 and dossier 14: each kind has a share of m1 incidents | A table of rates by kind **and** size whose columns sum to the ladder (300, 45, 6, 0.8) (§5.2) | The shares and the "usual size" column disagree |
| 2 | §5.2: a persistent and a live hot list | No hot lists. Every incident takes a cell before its summary; every cell has a band (§7.2) | Kabuki has 15 to 30 cells; scopes added nothing and let the kernel place an item among descendants |
| 3 | §2.5: bands, labels, stocks and regime flags are pins; readers read the pins | Pins only for `band`, `status`, `gap-<norm>`, `label-<axis>`, `group-gap`, written on change and effective at the applying boundary; **current values are read from digests** (§2.2) | A pin on a temporal slot covers the one window it names (SPEC-NOTES 34) |
| 4 | §2.5, §6.1: urgency, quality and currency are pinned on a bucket change | Pressures and a tie's strength are **derived and never pinned** | S0 §5.1: a pin on a derived slot constrains its inputs or contradicts |
| 5 | §6.3: "four fixed iterations per period" | One pass of the four steps per window, steps 1 to 3 relaxed four times, `η` = 0.058 per window (§7.5) | The sentence is ambiguous |
| 6 | §7.3, §6.5: reach comes from `city.flow` | Reach is frozen at the item's formation in M3 (§8.6) | `city.flow` is phase 2; S0 F-24 needs 30 days of absence to change no label |
| 7 | §3.3: a derived event "carries the tag `mirrored`"; a child is a window after its parent | A mirrored event is told by its **creator** and keeps the raw event's time; offspring are born in a later window, which is not a full window of elapsed time (§7.3, §0.4) | `EventView` carries the creator, not tags |
| 8 | §2.1: `city.shape` keeps the flow matrix; processes run every sixth window | No `city.shape`: regimes, the m4 budget, service status and price belong to `city.events`. **Every process runs one window at a time** (§2.1, §7.0) | One process owns every production budget (E-06); a span cannot see later settings (E-05) |
| 9 | §5.2: an overfull calendar folds children into counts; the people of an event come from the cell's cast | A generation cap and a mean bound; the calendar cap is a fault limit. A pure casting function over `presentAt`, with group involvement distinct from personal roles (§5.2, §5.4) | Folding needs a second calendar; the first casting method could name absent, dead or protected people |
| 10 | §4.2, §4.3: residents `H("gen", block, "residents", i)`, households first | Households first, residents as six owned member slots with six kinds, S1's own age bands, a nominal block headcount (§4.2) | Coherent ages need the household's slots to constrain its members |
| 11 | Open questions 7 and 8: the belief path and audiences of a ledger item | `rep-<axis>[i]` with bookkeeping of canonical origins; `vec [v, reach]`; three carriers (§8.6) | Satisfies I-9 and the cap, and counts one occurrence once |
| 12 | §6.1: `regard(A → B)` as slots; §2.1: `order.stocks` without a baseline | An edge `xf:regard`; stocks with retention to a baseline `E ← ρE + (1 − ρ)E₀ + …` (§7.6) | An edge is visible to retention and the audit; without a baseline a quiet district's stocks decay to zero |
| 13 | §10: the kinds S1 mints | Adds `gig-outcome` and the generated `enf.<norm>.<rung>` kinds; every kind has a producer (§5.3) | An event has no free payload, so the norm and rung are in the kind name |
| 14 | §7.8: group drives, concerns, goals and member orders; §6.2 membership dynamics | Four pressures and two intentions per group with an explicit lifecycle; a fixed roster (§7.8) | The smallest useful M3 |

## 16. What S1 needs from the kernel and the other specifications

### 16.1 Kernel (S0)

**S0 v4.10 already supplies K-1 to K-8**, the eight clarifications found when S1 v0.1 was written. They are unchanged by v0.2: K-1 (V4-39, §9.3) items of a summary with no place under its scope take the scope as their place, now every summary is scoped to a cell; K-2 (V4-40, §5.1) an unavailable derive input reaches the derive as `undefined`; K-3 (V4-41, §9.4) a process draw is keyed by the window being computed; K-4 (V4-42, §9.4) digests are readable by registered reads and hooks as of the last applied boundary; K-5 (V4-43, §9.4) the operation shapes of §2.1 and `contributionId(spec)` as a pure function; K-6 (V4-44, §10.5) `matchStrength`; K-7 (V4-45, §9.2) an event may be minted with a `time` earlier than the boundary that applies it; K-8 (V4-46, §14.1) the S1 record retains only its own `nodes`.

**New asks from v0.2.** None changes a result the reference model produces today.
- **N-1** (S0 §9.2, §9.3). A process may publish a materialised summary item as an event Change exactly once (`publish-item`). The reference model realises it as `mint-event` with the item's own creator, cause and name; S0 should say that minting under an item's name yields the item's own `Id` and one Change. Why: opening contributes fields, which are silent, and S3 ignores contributions (E-01).
- **N-2** (S0 §6.6, §9.4). An operation that restates a contribution identical to one in force (same `contributionId`) is a silent no-op. Why: regeneration of an opened item's contributions after a reload (§7.9).
- **N-3** (S0 §9.4, §14.1). A process's last digest is persisted with its `ProcessState`. Why: feeds and cursors must survive a reload (§2.2).

**Reference-model alignment, not S0 changes.** The reference model's `aggregate` stub returns `{ value, confidence }`; S0 states `{ value, mass, items }`. `coarseFine` and the declared read set are optional fields of `ProcessDef`. `ctx.own()` and `ctx.digest()` are absent today, and `ProcessOp` lacks the frame, `observe`, `tell`, belief and `publish-item` operations. **Schema (a pack, not the kernel):** S1 ships `xf.core.world@1`: the kinds of §4.1, §4.2 and §7.0, the edge types `xf:tie` and `xf:regard`, and the dimensions they need.

### 16.2 S2, S3 and others

- **S2-1.** The reads of §9.1 give strings, not numbers. S2 treats band names as registered strings. `regime(scope)` answers the kind of the greatest live regime; `regimeIs(scope, kind)` answers `yes` or `no`. **S2-2.** S2 owes S1 the live casts (the protected set) and V's accepted offers and responses as observed events. **S2-3.** S2 §4.1's registered-read declaration is satisfied by the `deps` of §9.1; reads that answer `maybe` in M3 are unbuilt phases. **S2-4.** S2 evaluates a window's closing condition at each entry of a read's `transitions` (§9.1), from the initial value; a read with `boundary: true` is re-evaluated at every boundary, as a `believes` atom is.
- **S3-1.** S3 reads `eventKind(name).producers`. `aesthetic` answers `undefined`; S3's `T_aes` is then 0. Enforcement kinds carry the tag `enforcement`. **S3-2.** S3 owes S1 the stated rule that it never reads inside S1's private state, and later the `memorable` rule for returns. S1 owes S3 events with `causes`, effects and participants, bounded at about ten Changes an hour for the city, and policies that ignore `meta:` kinds. **S3-3.** S1 declares each process's publication lag (§7.0, §9.4); the longest in M3 is one window, the horizon S3 §6.1 uses.
- **S4:** the pack formats for kinds, norms and ladders, carriers, the judge table, rosters and group intentions; the content-class listing per kind; the `aesthetic` library. **S5 and P8:** the raw event kind names, the mirrored slots S1 reads, V's `cell`; a `community active` read per cell; the routes table's execution. **P7:** the measured budgets (§10.3). **S6:** the logical record of §11 as bytes.

## 17. Compromises and open items

### 17.1 Compromises

For the [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

| # | The model says | S1 does | Revisit when |
|---|---|---|---|
| C-S1-01 | Every person is a full bundle | Residents are drawn from a recipe and opened on demand | A story needs a resident's history before V met them |
| C-S1-02 | Rumour travels person to person; beliefs everywhere; every telling is an event | Reach frozen per item, `knows` by a keyed quantile; beliefs only at fine tiers and carriers; tellings minted only in focus, for V, live casts and canon people | M14-13 or M14-14 fail, or the sifter lacks divergence material |
| C-S1-05 | Ownership is checked against the game as it is now | A static coverage figure; a dynamic read only for realisation and `scene.acts` | A session shows simulated and game incidents colliding |
| C-S1-06 | Memory follows use and importance | A hold time with the generous floor | Transcripts read as forgetting or recalling unnaturally |
| C-S1-07 | `e^x` exactly | `exptab`, under 0.0489 % error | A distribution test shows the error |
| C-S1-08 | Attribution is a full inference | Two beliefs and one disposition weight | NPC speech reads as wrong-minded |
| C-S1-10 | Ethos and archetype from the setting | Judgement tables in pack data | A review by someone who knows the lore |
| C-S1-14 | Households and residents in one draw | Households first, six owned member slots, nominal headcount | A block's age marginals miss by more than the roster allowance |
| C-S1-15 | An event's people are drawn from the cell's cast | Pure casting over the people present; an unfillable essential role drops the occurrence (`no-cast`) | The `no-cast` count is more than a few per cent of size-2-and-above occurrences |
| C-S1-16 | Every changing value is a pin | Derived values and digests; pins on change only; transitions for reads | A tool needs history beyond eight windows |
| C-S1-18 | A full calendar folds children into counts | A fault limit; the generation cap and mean bound do the work | M14-23 shows the cap is reached |
| C-S1-19 | Norm state per block | District slots only | M15-12 needs embeddedness |
| C-S1-24 | Group books are simulated; groups want like people | Pack judgement: cash, burn, income and a lump per shakedown; four pressures and two intentions | M3's panel reads the Claws as flat |
| C-S1-25 | A process runs when its work is due | Every process runs every window | A measured session shows the cost and invalidation for longer spans is specified |
| C-S1-26 | A scene is generated as it happens | Items are opened one window after they occur, from recorded demand | P8 needs events before their time |
| C-S1-27 | Every belief can matter | No decision reads a belief that is not memorable | A story needs a forgotten belief to act |

### 17.2 Open items

1. **Cell size and grid:** about 200 m clipped to the leaf, venues as own cells; the index build gives the count. 2. **The game-time ratio and the hours behind the period names:** unmeasured; every time constant is **[tunable]**. 3. **Binding keys:** readable and stable across loads? (§4.3; outside M3's criteria.) 4. **Is the minted-telling volume enough for the sifter?** Measure on the M3 transcripts. 5. **The mirror's period and the feed's latency and ordering,** with S5 and the bridge. 6. **The roster allowance** of 0.06, the headcount scale `ρ`, and the ethos, archetype, judge and view tables (lore review). 7. **The `no-cast` rate** in a district with few people present, and whether more roles need a group fallback. 8. **The retained `meta` size** per item, and whether the ring needs a byte budget. 9. **The m4 spacing** (432 windows) and weekly budget (2) are guesses against M14-18. 10. **N-1 to N-3 of §16.1** wait on S0.

## 18. Review record

Reviews are recorded in the form the other specifications use: the round, the reviewer and effort, the number of findings and what was adopted, and a table of findings with the change each made.

| Round | Reviewer | Findings | Adopted | Notes |
|---|---|---|---|---|
| 1 | GPT-6 Astra | 20 (4 blockers, 14 important, 2 minor) and the over-engineering section | All 20 and the whole of the over-engineering section | Reviewed v0.1; answered by v0.2 |

### Round 1: GPT-6 Astra on v0.1

S0 v4.10 already supplied the eight kernel additions S1 asked for (K-1 to K-8); several findings were about how S1 used them. Two cross-spec decisions are made: E-07 (S3 v0.3 §6.1) and E-10 (reads publish transitions, S2-4).

| # | Finding | What changed in v0.2 |
|---|---|---|
| E-01 | Scene opening cannot see its input or notify the sifter | One-window runs; `scene.acts` opens the completed window `k − 1` from recorded demand, with keys on the item; one explicit `publish-item` event Change; regeneration silent (§7.9, S1-I-25, N-1) |
| E-02 | An m1 child has competing identities, times and places | One `Descriptor` per occurrence; every incident takes a cell before its summary; indices assigned before offspring; classify by the child's size; no district-remainder summaries (§7.2, SF1-I-16) |
| E-03 | Saved identifiers do not retain what resumption needs | The retained dependency set enumerated; `parentFacts` in each child; casting a pure function; published against materialised; decisions read memorable beliefs only; reload fixtures (§11, §8.3, SF1-E2, SF1-E4) |
| E-04 | The proposed schema is not executable | The resolved schema in declaration order; age constrained by S1's bands; noise order stated for later; schema audit and SF1-P-0 (§4.2, §12) |
| E-05 | Speculative spans cannot know later settings or protections | Every process runs one window; the boundary at which a change takes effect is stated; longer spans are a later capability (§2.1, §3.3, §0.3) |
| E-06 | Shared budgets have no owner | `city.events` owns regimes and all admission, with persisted `m4Times`, a declared `(time, Id)` order and an in-window district counter; the gate is stateless; lifecycle notices exempt (§7.1, §7.2, §6, SF1-S-5) |
| E-07 | Delivery order can reverse chronology | Per-process `lag` declared; the longest is one window; S3's buffer horizon uses it (§7.0, §9.4, SF1-M-8) |
| E-08 | Digest consumers need unavailable data and replay old inputs | State views apart from feeds of typed `EventFact`s; consumed-through cursors; `feed-gap`; coverage is a state view (§2.2, §7.2, §7.3, §7.6, SF1-O-1, SF1-O-4) |
| E-09 | Coarse demand independence is violated directly | `group.decide` makes no demand call; orders and their realisation are deferred to `scene.acts`; S1-I-5 restated against identical external observations (§7.8, §10.2, S1-I-5, SF1-G-6) |
| E-10 | Registered reads cannot honour historical closing conditions | `transitions` with the initial value for every read; `groupGap`, `divergence` and `refuge` invalidation completed; close-and-reopen fixture (§9.1, §2.2, SF1-S-6, SF1-R-2, SF1-R-3) |
| E-11 | The gate suppresses the intended reputation conversations | A `tell` has no effects; its subject is an informational participant; `expose` is reserved (§5.3, §6, §8.4, SF1-W-6) |
| E-12 | Reputation can count one act twice | `origin(e)` canonical evidence; raw kinds ignored; `absorbed` bookkeeping before an index is allocated; `diag` for non-city acts (§8.6, §2.2, SF1-L-6, SF1-L-8) |
| E-13 | Fading contradicts absence-invariant reputation | Carrier items are memorable by rule, outside fade and the person cap, and persisted (§8.5, §8.6, SF1-L-7) |
| E-14 | The cascade bounds do not match the guarantees | `nEff = min(nMax, …)` after all modifiers; a generation cap `genMax`; the calendar cap is a fault limit asserted never reached (§5.2, §7.2, SF1-I-6, SF1-I-15) |
| E-15 | Group goals have no complete lifecycle | Two intentions per group with start, progress, expiry, end, cooling, an idle result and boost removal; `W` now feeds the intention weight (§7.8, SF1-G-5) |
| E-16 | Casting does not establish the event it claims | `castOccurrence` with eligibility (present, alive, adult, unprotected), parent roles kept, and `<role>-group` involvement distinct from persons (§5.4, SF1-X-5) |
| E-17 | Norm dynamics need substantive guesses | `nu` 0.4; resident types from `ntype`; norm and rung in the generated kind name; signals with an explicit `from` window, taken once; endpoints verified (§7.5, §5.3, SF1-N-5 to SF1-N-7) |
| E-18 | Pack continuation is borrowed incorrectly | The complete simulation-data version is pinned per lineage; structural updates deferred; S0 §14.4 applies when unavailable (§1.4, §11, S1-I-28, SF1-P-3) |
| E-19 | The aggregate/resident equivalence is wrong | The resident adds the full conditional weight and displaces only when known; the aggregate is an approximation; masses are compared (§8.6, SF1-L-4) |
| E-20 | Numerical artifacts and acceptance claims need tightening | Frozen table artifacts with hashes and a fixed `σ`; capping described accurately; impossible assertions corrected (§1.2, SF1-H-4, SF1-H-6, SF1-I-5, SF1-E1, §14.3) |
| Cuts | Over-engineering | The core shrinks to the smallest useful M3 (§0.2); the drive catalogue, concern machinery, general means, dilemmas, personality revision, relationship extras, refitting, migration, speculative spans and the rest move to §0.3 |
