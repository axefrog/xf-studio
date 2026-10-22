# P1. Research method

**Status:** draft for review (22 October 2026). This is second-level plan P1 of the [first-level plan](plan.md#5-second-level-plans), covering workstream 1, craft research. It absorbs design seeds [DS-21](design-seeds.md) (the game's quest graphs as a corpus) and [DS-22](design-seeds.md) (the adversarial pass).

## 1. What it is for

Build the design knowledge the Story Engine stands on. Every discipline that bears on good interactive storytelling, at every scale, is gathered and merged into one graph that procedural systems can be built from and checked against.

The main risk is not missing facts but **missing whole fields**. A task-focused agent asked about "quest design" finds quest design and stops. The method's job is to find the fields nobody would think to ask about, and to prove the result is complete enough by trying to break it.

**Outputs:**

| Output | Location |
|---|---|
| The discipline map: every field considered, why it's in or out, and its tier | `craft/map.md` |
| One dossier per discipline or tight cluster | `craft/<discipline>.md` |
| The composite: principles, mechanisms, failures and measures, as one typed graph | `composite/` |
| The adversarial record: compliant-but-bad quests, and what each one exposed | `composite/adversarial.md` |
| Credits for everything that taught us something | [community credits](../../docs/community-credits.md) |

## 2. Countering task-focused bias

Six mechanisms, each aimed at a different way of missing things.

### 2.1 Many lenses, run independently

Disciplines are discovered through separate framings. Each runs in its own agent context, with no sight of the others, so they can't converge on the obvious answer. Each lens returns candidate fields with a sentence on why, and the problem each field would solve for us.

| Lens | The question it asks | Examples of what it should surface |
|---|---|---|
| L1 **Isomorphs** | Who else makes experiences for someone in real time, around their choices? | Tabletop game masters; improv; immersive theatre (Punchdrunk); larp; escape rooms; theme-park and museum design; alternate-reality games; magicians (the "magician's force" is the quantum ogre's craft); con artists and social engineers; sports commentators, who turn emergent play into story live |
| L2 **Failures** | What has gone wrong, and what was missing when it did? | Radiant quests; Tale-Spin; Oblivion's pre-release Radiant AI; repetitive procedural points of interest; recruit-anyone characters without depth; Daggerfall's generated quests |
| L3 **The player** | What happens in the player's head? | Attention and perception; memory (the peak-end rule); curiosity and information gaps; motivation (self-determination theory); apophenia; narrative transportation; how meaning is made |
| L4 **Components** | What is a story made of? | Character, place, conflict, stakes, information, time, tone, theme, structure; each points at fields |
| L5 **Scale** | What is specific to each size, from a glance to a campaign? | Street theatre and flash encounters; the short story; the episode; the serial; the novel; the long campaign |
| L6 **Setting** | What does cyberpunk, and Night City in particular, demand? | The genre's literature and themes; the source tabletop game's GM advice, random tables and news-hook "screamsheets"; the run structure of Shadowrun (job, legwork, run, double-cross), which is the gig's archetype |
| L7 **Systems** | What models of the world give causes their shape? | Social simulation; agent-based modelling; criminology (routine activity theory: crime happens where a motivated offender, a suitable target and no capable guardian meet); rumour and information spread; social networks; urban sociology; informal economies; field representations and applied category theory for knowledge (ologs, sheaves); agent architectures (belief–desire–intention, goal-oriented planning); attention and spreading activation |
| L8 **Computational narrative** | What has research built? | Narrative planning; story sifting; drama management; storylets and quality-based narrative; story grammars; plot units; computational models of suspense; structural analyses of game quests (Doran and Parberry's study of NPC motivations in MMORPG quests) |
| L9 **Production** | How do studios actually make quests? | Quest design talks and post-mortems (CD PROJEKT RED, Bethesda, Obsidian, Larian); writer–designer pipelines; quest pattern catalogues; QA of branching content |
| L10 **Ethics and representation** | What could do harm or alienate? | Stereotypes, violence, sexual content, consent, real-world sensitivities, the rating, cruelty that emerges procedurally |
| L11 **Distant fields** | What would an unrelated field say about our problem? | Forced analogies, kept only if they yield a principle that transfers: music (theme and variation, tension and release); architecture (Christopher Alexander's pattern language, which is also a model for the composite's form); ecology; gardening; law (evidence and burden of proof, for mysteries); cooking |

### 2.2 Different models for different lenses

Different model families have different blind spots. Some lens runs go to a second model family (GPT-6.1 Sol through the Codex CLI, as the project already uses for reviews) and the overlap is compared. A field found by only one model is examined, not discarded.

### 2.3 Run until saturation

New lenses keep running until two in a row add no field that survives the merge. This mirrors theoretical saturation in qualitative research. The map records each lens's yield, so the stopping point is visible.

### 2.4 Failures first

Every dossier must list how its discipline's advice fails, its critiques, and cases where following it produced bad results. Principles without known failure modes are treated as untested.

### 2.5 Ground everything

Every principle needs at least one concrete instance: a quest, a game, a session report, a film scene, a published adventure. This keeps out platitudes ("stories need conflict") that no procedure can use.

### 2.6 Try to break the result

Two tests run after composite v0, and again whenever it changes:
- **The adversarial pass** ([DS-22](design-seeds.md)). Independent agents, who haven't seen the generator, try to write a quest that satisfies every principle in the composite and still sucks. Each success is diagnosed: a missing principle, a missing discipline, or a principle stated too loosely. The loop ends when several rounds fail to produce a compliant-but-bad quest, or when every remaining failure is a matter of prose quality (expression), not design.
- **The corpus test** ([DS-21](design-seeds.md)). The composite must explain what separates strong vanilla quests and gigs from forgettable ones in the decomposed sample from [P2](plan.md#5-second-level-plans). If it can't say why one is better, something is missing.

## 3. The dossier

One per discipline or tight cluster, with the same headings:

1. **Scope and why it matters here.** One paragraph, naming the layers and cross-cutting concerns it informs ([plan §2](plan.md#2-the-system-at-first-level)).
2. **Sources:** canonical works, critiques and empirical studies, each with its credit status.
3. **Principles,** each as an atomic claim with:
   - an ID (`<discipline>-NN`);
   - the statement;
   - its evidence grade (§4);
   - the source;
   - a concrete instance;
   - the scales it applies to (encounter, gig, arc);
   - the layers it informs;
   - **how to operationalise it:** could a procedure produce it, check it, or neither?
4. **Failure modes and critiques.**
5. **Tensions** with other disciplines.
6. **Lateral links:** "this is the same idea as X in Y."
7. **Open questions.**

Dossiers paraphrase. Quotations stay short and attributed, in line with copyright.

## 4. Evidence grades for craft knowledge

Craft knowledge isn't engine knowledge, so it needs its own grades alongside the knowledge base's:

| Grade | Meaning |
|---|---|
| **[empirical]** | Measured in studies: player research, psychology, human-computer interaction |
| **[practice]** | A practitioners' method with a track record: GM handbooks, design talks, post-mortems |
| **[shipped]** | Visible in a shipped game's design and checkable by playing it or decomposing it |
| **[corpus]** | Measured in our own decomposition of the game's quests ([P2](plan.md#5-second-level-plans)) |
| **[analysis]** | Theory or criticism: narratology, film and literary criticism |
| **[hypothesis]** | Our own inference |

A claim that is contested between sources is marked **contested**, with both sides cited.

## 5. The composite

**Form.** One typed graph, stored as plain data in `composite/` with stable IDs, plus a readable page that explains it. Ologs ([DS-51](design-seeds.md)) are a candidate formalism for it. A small script renders views once it grows past what a page can hold.

**Node types:**
- **Principles** from the dossiers;
- **Concepts** (role, stakes, clue, thread, beat);
- **Mechanisms**: how a layer realises a principle;
- **Failure modes**;
- **Measures**: how evaluation detects a principle being met or a failure happening.

**Edge types:**
- `requires`, `supports` and `conflicts-with` between principles;
- `refines`, which links a larger-scale pattern to the smaller patterns that complete it, as in Alexander's pattern language, so the graph is itself multi-scale;
- `instance-of`;
- `realised-by`, from principle to mechanism;
- `detects`, from measure to failure;
- `prevents`, from mechanism to failure.

**What the composite must pass:**
1. Every principle traces back to dossiers.
2. Every mechanism in the layer designs (P3–P8) traces to principles.
3. Every failure mode has a measure or a preventing mechanism.
4. The corpus test (§2.6).
5. The adversarial pass (§2.6).

## 6. How it runs

| Phase | Work | Who | Output |
|---|---|---|---|
| A. Lenses | §2.1–2.3: about 11 lens runs, three or four at a time, on small budgets; some on a second model family | Read-only research agents with web access | Candidate fields per lens |
| B. Map | Merge and deduplicate. Tier each field: **core** (shapes a layer), **supporting** (shapes details), **peripheral** (noted, not researched) | This chat | `craft/map.md` |
| **Checkpoint** | The maintainer reviews the map. Cheap to do and high leverage, since a missing field is the risk this method exists to prevent | Maintainer | Fields added or removed |
| C. Dossiers | Core fields first, one agent per field or cluster; then supporting fields | Research agents | `craft/*.md`, credits |
| D. Composite v0 | Synthesis into the graph; tensions resolved or recorded | This chat, with one synthesis agent | `composite/` |
| E. Break it | The adversarial pass, and the corpus test once P2's sample exists | Fresh agents; P2 | `composite/adversarial.md`, fixes |
| **Checkpoint** | The maintainer reviews composite v0 | Maintainer | Go for P3 and P4 |

**Budget.** Phase A is about 11 small runs. Phase C is about 12–20 dossiers, depending on the map. Agents run a few at a time and inside this chat's memory share. The pace is set against the shared quota; nothing here is urgent.

**Rules for agents:**
- read-only in the repository;
- sources cited;
- no long quotations;
- no subagents of their own;
- any generated example stories are invented for the dossier and never kept as content.

## 7. Done when

- The map has reached saturation and the maintainer has reviewed it.
- Every core field has a dossier.
- Composite v0 passes its five checks (§5), with the corpus test run on P2's first sample.
