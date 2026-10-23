# Dossier 8: scale, threads and time, from a glance to a season

**Status:** v1, 22 October 2026. Dossier 8 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: NAR-05 (serial drama and thread management), NAR-16 (scene and unit analysis), NAR-17 (narrative time: order, duration, frequency and deadlines), NAR-18 (promotion ladders: breakout characters and Nemesis-style escalation). Supporting fields: NAR-24 (the short story and unity of effect), EXP-10 (implication and closure), CRA-19 (live-service seasonal storytelling). It also takes the map's gap rows on **session shape and tempo**. Feeds P4 (the seed language, layer 2) and P5 (the procedural engine, layer 3). It serves quality bars 3, 5, 7 and 8 ([plan §1](../plan.md#1-what-doesnt-suck-means)) and builds on [dossier 4](d04-quest-structure.md) (the gig and its failure record) and [dossier 7](d07-direction-pacing.md) (the arbiter, the play clock, the cadence and the budgets, which this dossier does not repeat). It leans on [dossier 5](d05-units-variety.md) (scale forms, SL-13), [dossier 9](d09-agency-consequence.md) (the unattended plan, lazy settlement, closure) and [dossier 2](d02-relationships.md) (BND-11, the ladder in reverse). "What a returning player sees after weeks away" belongs to dossier 11. It is noted here at the joins and not developed.

**In brief**
- **The failure record is thin and mostly about calendars and caps.** The cases with real evidence are a seasonal story that was overwritten and could not be replayed (Guild Wars 2, Season 1), a deadline that cut off exploration (Fallout's water chip), and unbounded same-kind offers (dossier 4). Promotion failures (overpromotion, thin depth, same-shaped rivalries) are anticipated by the lenses and I found no study of them. The serial-television sources are craft guides, essays and fan boards, and I say so wherever I rely on them (§2).
- **One structure gives a completion test at every scale.** The foundation's context chain runs drives, concern, goal, step, situation. I propose that the scale of a unit is the level of that chain it *turns*: a glance reveals a changed situation, an encounter turns a step, a gig a goal, an arc a concern, a season a drive or a group's standing. That one idea gives each scale a mechanical completion test (UNT-02, UNT-03), a promotion rung (GRW-02) and a way for a large thing to show from the street (STR-01). It is a hypothesis. The outside ladders (McKee's beat, scene, sequence and act) are a cross-check, not its source (§5.1).
- **The push budget, not the thread cap, sets the load.** In a toy model with assumed inputs (§5.2), dossier 7's soft target of about 3 pushes an hour gives a mean of 0.9 attended engine threads, and the cap of four is exceeded 0.2 per cent of the time even with no cap at all. 41 per cent of play time has no engine thread in view. Counting *attended* threads instead of *alive* ones lets the same ceiling of four admit 92 per cent of fast candidates instead of 69 per cent at one candidate an hour. Per-tempo sub-caps add ceremony and little else (THR-03, THR-04).
- **Promote on V's returns and outcomes, refuse what has no depth, keep anchors few.** The one shipped escalation system promotes on a notable outcome (a regular orc kills the player) and generates detail at a few peak moments. Our version counts only returns V makes in play, keeps the count local and legible, gates each rung on a cause event and on depth being ready, and caps the rungs near V (GRW-01 to GRW-06).
- **A large thing shows from the street only as projections of its state.** A front declares, per clock segment, the street forms it throws down (district fields, glance fragments, media items), a landmark, a local cost and a small set of signs. The media version of an event differs from the record by a tunable amount. Each street sees one facet (STR-01 to STR-08). I found no documented failure case for illegible large events. The principles rest on theory and tabletop and theme-park practice.
- **Time:** keep play time, game time and record order apart. Telling out of order is fine when the cause can be found. A deadline needs a perceivable source and lands on the world. Never write V's past (TIM-01 to TIM-06).
- **The end of a session cannot be scheduled, and should not be engineered.** Players leave at any moment. The engine keeps every moment a safe stop, makes the rest after a climax end-worthy (peak-end), and never times a push to land before a likely quit. In a small reading experiment a cliffhanger ending raised the wish for a next instalment and left enjoyment unchanged, which is exactly why it must not be a director tool (SES-02 to SES-04).
- **An optional, player-declared time budget picks scale forms.** Time-boxed tabletop craft (prune towards the conclusion, frame scenes late, fall back to broad-strokes resolution) maps onto the short, standard and full forms (SES-05, SES-06).
- **Tempo is a bundle of parameters, and changing it must not re-roll anything.** If schedule slots are hashed draws kept at the highest tempo and thinned by a threshold, calm, steady and restless are nested subsets, so a dial change adds or removes slots and a reload shows the same schedule (SES-07, SES-08).
- **Magnitudes are mostly judgement.** §5.2 sorts every number into evidence, simulation and judgement. §5.6 lists what the harness must measure to replace the guesses.

## 1. Scope and why it matters here

A seed is a partly resolved quest ([foundation §6](../foundation.md#6-story-in-the-same-space)), and P4 says one fragment type serves every level ([P4 §3.6](../p4-seeding-layer.md#36-fragments-and-beats)). That raises four questions the earlier dossiers left open:

1. **What completes a unit at each scale?** A glance, an encounter, a gig, an arc and a season cannot all be "done" in the same way, and a procedure needs a test for each.
2. **How does a small thing grow into a large one?** The plan's sowing role "grows engaged threads into arcs" ([plan §2](../plan.md#2-the-system-at-first-level)). Growth needs a trigger, gates and safeguards.
3. **How does a large thing show from the street?** The player meets the city a few metres at a time. A front that only exists at district or city level is invisible unless something projects it down.
4. **How many threads can run at once?** Dossier 7 gave limits (DIR-32) and left the composition of threads to this dossier.

Two cross-cutting matters complete it: **narrative time** (order, duration, frequency, deadlines), and **session shape and tempo** (how a stretch of play opens and closes, and how fast things move as a player setting).

| Layer or concern | What this dossier gives it |
|---|---|
| 2. Seeding (seed language, lifecycle, arbiter) | Scale labels computed from the level a unit turns; the `turns` declaration; the front profile with clocks and street projections; the loose-end register; rung slots; scale forms with durations and what they may drop; session states of the arbiter (§9) |
| 3. Procedural engine (sowing, fitting, director) | Thread counting, composition and overflow; rotation, baton pass and retirement; promotion and demotion; growth from loose ends; the projection engine; the time budget, tempo bundle and nested thinning (§10) |
| 4. Authored content | What an author states for completion at each scale, what a front must carry, and which parts a short form may drop |
| 1. Simulation | Three times on every event; summaries as iterative telling; rung and return counters held on subjects; the street as derived fields |
| Evaluation (E) | Measures M8-01 to M8-16 (§5.6) and the corpus test for the scale mapping (§8) |
| Expression (X) | The street forms, the media version, re-situating cues after a jump |
| Configuration (C) | Tempo, the time budget, and the persistence class of effects |

**Evidence used from the repository, read-only:** the [seven gig decompositions](../gig-decompositions.md) and [corpus statistics](../quest-corpus-statistics.md) through dossier 4; [open-world activities](../../../knowledge/open-world-activities.md) (how the game re-arms ambient fights, releases hustles in ticks and paces fixer offers by district counters); the [kernel spec](../spec/kernel.md) (§6 pins and time, §9.3 summaries, §9.4 evolution windows, §10 frames and demand, §14 persistence); the [foundation](../foundation.md); and dossiers 2, 4, 5, 7 and 9. The lens L5 output ([lenses/L5-scale.md](lenses/L5-scale.md)) is the first source of most of the fields here.

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **contested** marks a claim two sources dispute. **[sim]** marks a number from the toy model in §5.2, whose inputs I assumed. **[J]** marks my judgement, with the reason given. Source status: *read* (fetched and read this session), *summary* (a search summary, an abstract or a secondary account only), *memory* (recalled, not rechecked).

**Wording.**
- **Scales:** glance (seconds), encounter (about a minute), vignette (a few minutes), gig (about an hour), arc (several sessions), season (weeks of play). These are L5's, and "gig" is the game's name for a fixer's job, the dossier-4 unit.
- **Play time and game time** are as in dossier 7. A **session** runs from a load (or new game) to the next load or quit.
- **Thread:** a view over seeds, defined in THR-01. **Attended:** a thread V has met in the last 45 play-minutes (THR-03).
- **Turn:** the recorded change that completes a unit (UNT-02).
- **Beat:** one sense only. A P4 `beat` is a fragment that leaves at least one fact in the record, which is the industry's "moment". McKee's beat, an action and its reaction, is a P4 `exchange` (S8-P4-04).

## 2. The failure record

Failures first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the advice itself fails. I re-checked what I could and say where a lens claim did not hold. The record here is weaker than in dossiers 4 and 7: for several of the fields the "cases" are serial-television practice reported by essays and fan boards, and I mark that.

### 2.1 Cases

| # | Case | What was tried | What went wrong, or what is not known | Evidence |
|---|---|---|---|---|
| F-01 | **Guild Wars 2 Living World, Season 1** | Story in episodes over weeks, delivered into a persistent world | The team's later description is "fire and forget": each team's changes overwrote the last, so the season cannot be switched back on and new players cannot play it. Critics add a new beat every couple of weeks that was then gone, newcomers missing the characters introduced there, and many overlapping storylines that were hard to follow (secondary). The fix in Season 2 was a replay journal and additions that stay | *read*: PCGamesN, interview with the game director, 14 Sep 2019 [practice]. *Summary*: Massively OP and Ten Ton Hammer columns, a developer remark on the journal [sec; opinion] |
| F-02 | **Fallout (1997): the water chip timer** | A 150-day limit on the first main task, so the player would focus on the story | The limit stayed in the first patch. A second, overall deadline was removed. The designer's stated reason was to force attention onto the story in a large open world. Secondary accounts say players felt rushed and skipped side content. I did not reach the original interview or the patch notes | *Summary*: walkthroughs, a wiki, forum threads and a report in another language citing an interview [sec; community] |
| F-03 | **Unbounded same-kind offers** (Fallout 4's settlements, Skyrim's jobs) | Endless generated jobs | No memory and no cap. Covered in [dossier 4](d04-quest-structure.md) F-02, F-03 and [dossier 7](d07-direction-pacing.md) F-06, so not repeated | *read* there [shipped] |
| F-04 | **Quest-log overload** (World of Warcraft, Skyrim) | A journal of every open task | A 25-quest cap exists, by the studio's stated reason, to stop the player being overwhelmed, and players ask for it to go as tasks last weeks. A designer is reported as saying that quest-heavy zones should keep the log at about six or seven. A modder argues that Skyrim keeps every started quest until it is finished or failed. No study | *Summary*: forum threads, a Shacknews report, a Nexus article [sec; community] |
| F-05 | **Serial drift** (soaps, long comic runs, sitcom resets) | Many threads over years; or a reset at the end of each episode | Fans of one soap report that five or six front-burner stories at once was too many. A new head writer abandoning the inherited cast is a common complaint. A reset format lets viewers join anywhere at the price of characters that never carry damage. Comic reviews say long runs seed subplots that are never paid off. All of it is fan-level or essay-level. I found no head-writer account of how many stories a soap carries | *Summary*: fan boards and essays, as L5 recorded [sec; weak] |
| F-06 | **Promotion systems** (Shadow of Mordor and Shadow of War) | Orcs that kill or escape the player are promoted into named captains who remember it | The system generates detail at a few peak moments and leaves the rest to the player. Reviews praise the variety of the orcs. I found one player's complaint that most captains yield to the same tactics, and nothing systematic. The anticipated failures (trivial promotions, same-shaped rivalries) are the lenses' and are not documented here | *read*: Bazan III, Game Developer, 7 May 2020 (appreciative); GamesBeat on de Plater, 9 Feb 2015 [shipped]. *Summary*: review pages and a Steam thread [sec; weak] |
| F-07 | **Cliffhangers as a retention tool** | End on an open loop to bring people back | In two reading experiments (202 and 273 people) a cliffhanger ending raised the wish for a next instalment against a resolved ending and left enjoyment and suspense unchanged. So it works as retention and costs the story nothing, which is the ethical problem. The popular claim that unfinished things are remembered better failed in a meta-analysis, which found only a tendency to resume interrupted tasks | *read*: Schibler, Hahn and Green 2024 (record); Ghibellini and Meier 2025 (abstract) [empirical; text, not games] |
| F-08 | **Calendar-paced stories** (Majestic, Season 1 again) | Story released on the producer's clock | Covered in dossier 7 F-09. The common cause with F-01 is that the pace belongs to the producer and not to the player | *read* there |

**Cases and claims I did not rely on.** L5's account of Claremont leaving three quarters of his subplots unresolved comes from a fan wiki and I did not check it. L5's figure d = 0.15 for the Zeigarnik effect is a secondary post I could not verify. The abstract of the meta-analysis confirms only the direction. A report that Majora's Mask was cut from seven days to three because schedules could not be tracked rests on one source I could not open, so it is not used.

### 2.2 What the failures have in common

| # | Pattern | Cases | What is missing | A test that catches it | Where this dossier answers it |
|---|---|---|---|---|---|
| P-1 | **Story paced by the producer's calendar, or overwritten** | F-01, F-08 | State-driven pacing; a record that persists; a way to catch up | Whether a new V can reach the start of any live thread from the record | UNT-12, SES-01, SES-10 |
| P-2 | **A deadline that cuts off exploration** | F-02 | A deadline from world facts, sized to the obstacle, that lands on the world | Share of players who skip other content in a clocked thread (a session probe) | TIM-05 |
| P-3 | **Unbounded threads of one kind** | F-03, F-04 | A count of what V is aware of, with composition and an overflow order | Attended count by kind; refusals | THR-03 to THR-05, THR-11 |
| P-4 | **Drift: dangling threads, abandoned cast, resets that erase** | F-05 | Rotation, a closing trace and a persistence class per effect | Thread age distribution; threads that vanished with no trace | THR-07, THR-12, S8-P4-16 |
| P-5 | **Promotion without depth, or in one shape** | F-06 | Gates on a cause event and on depth; shape separation | Promotions with no cause event; shape diversity across promotions | GRW-03, GRW-04, GRW-10 |
| P-6 | **Engineered open loops** | F-07 | A rule that the director never reads session length or a quit proxy | Static audit of the director's objective | SES-04 |
| P-7 | **A unit test applied as a template** | The map's "scene wants or low-want texture" tension | A texture class, and the want test only from encounter up | Share of units flagged texture; rejection of atmosphere | UNT-01 |
| P-8 | **Large events with no street presence** | None documented | Projections, media residue, signs | Reconstruct-from-residue test | STR-01 to STR-08 |

### 2.3 Where the advice itself fails

| Advice | How it fails |
|---|---|
| A, B and C plots, and "three threads an hour" (NAR-05) | They come from broadcast television, with a writers' room, fixed length and linear viewing. The guides I read give weights and say counts vary by genre and format. They give no cap. In an open world V picks the threads. The numbers here are judgement (THR-02) |
| Soap rotation, front and back burners (NAR-05) | Attested by fans and not by head writers. The practice may be real and I cannot cite its documented form |
| Mamet's three questions and McKee's value change (NAR-16) | Made for scenes in film and theatre, written for a seated audience. Applied strictly they reject atmosphere, rest and glances, which carry much of Night City (map tension). McKee is known to me only through a summary and memory |
| Poe's unity of effect (NAR-24) | An old and partial doctrine that ignores the serial. The secondary sources I read quote the single-sitting argument and I did not read the review's own text |
| Genette's order, duration and frequency (NAR-17) | The categories describe fixed texts. Here the order of telling is V's order of discovery, so they are a vocabulary and not a procedure. I know them from secondary accounts |
| Iceberg and gutter closure (EXP-10) | Closure assumes panels are read in order, which a walkable world does not guarantee. The "baby shoes" attribution to Hemingway is unverified, so I do not use it |
| Nemesis-style promotion (NAR-18) | One shipped example, about enemies, whose trigger is the player's defeat. Whether people V helped or ignored can be promoted by a trigger as vivid is untested. Breakout characters in television are chosen after the fact by audience response, which a procedure cannot see in the same way |
| Seasonal storytelling (CRA-19) | A live-service release calendar. The useful half, a catch-up journal and assumed continuity, bears on return and belongs to dossier 11 |
| Cowan's limit of about four (THR-03) | A lab limit on items held in the focus of attention during a task. Threads over hours and weeks sit in long-term memory with cues, so the transfer is a stretch. The paper's own debate (three to five, or nearer seven) stays open |
| Peak-end (SES-03) | Lab results on episodes with clear starts and ends. The evidence for hour-long play sessions is absent |
| Tabletop "end on a hook" (SES-04) | A table has a calendar end the game master can see. A computer game has none, and the engine cannot see a quit coming |

## 3. Sources

Source status as in §1. "Credit" says whether [the community credits](../../../docs/community-credits.md) are to be extended (this dossier does not edit them; §12 lists candidates).

### 3.1 Read

| Work | Used for | Credit |
|---|---|---|
| Mamet's 2005 memo to the writers of *The Unit*, as reproduced by SlashFilm, 23 Mar 2010 | UNT-01 | to add |
| Roll20 compendium, *Dungeon World*, Fronts | THR-05, UNT-10 | to add (the game's authors) |
| Roll20 compendium, *Blades in the Dark*, Progress clocks | TIM-05 | exists |
| Philippa Burne, The Conversation, 23 May 2019 | THR-02, THR-10, GRW-07 | to add |
| Brandon Sanderson, 2025 plot lecture write-up | UNT-09, GRW-07 | exists in d04's list |
| Michael de Plater, interview, GamesBeat, 9 Feb 2015 | GRW-03, GRW-05 | to add |
| Basilio Bazan III, "Core System Analysis of Middle-Earth: Shadow of War", Game Developer, 7 May 2020 | GRW-02, GRW-03 | to add |
| Don Carson, "Environmental Storytelling", Game Developer, 2000 | STR-01, STR-05 | to add |
| Ben Robbins, "West Marches: Grand Experiment", Ars Ludi, 17 Oct 2007 (first 100,000 characters) | UNT-10, SES-02 | to add |
| Justin Alexander, "Open Table Manifesto, Part 3", 22 Aug 2016; "Random GM Tip: GMing on a Time Limit", 21 Feb 2026 | SES-02, SES-05, SES-06 | to add |
| Sly Flourish, "Starting Strong" | SES-01 | to add |
| Schibler, Hahn and Green 2024, *Media Psychology* 27(1) (record page) | SES-04 | to add |
| Ghibellini and Meier 2025 (abstract page) | THR-07, SES-01 | to add |
| PCGamesN, Dustin Bailey on Mike Zadorojny, 14 Sep 2019 | F-01 | to add |
| Game Accessibility Guidelines, "Include an option to adjust the game speed" | SES-09 | exists (ETH-19) |
| Wikipedia, "Invisible theater"; Shortform's summary of McKee | UNT-02, UNT-04 | encyclopaedia and a study guide; not credited |
| Dossiers 2, 4, 5, 7 and 9; kernel S0; foundation | throughout | first-party |

### 3.2 Summary only, or memory

| Work | What I have | Treatment |
|---|---|---|
| McKee 1997, *Story*; Stanislavski 1936; Boal; Kermode; Ricoeur | Memory, a summary of McKee, an encyclopaedia entry on Boal | Named only where the map or a lens did. No claim rests on one of them alone |
| Poe 1842, review of *Twice-Told Tales* | Secondary excerpts (a Cambridge chapter, Victorian Web) on the single-sitting argument | UNT-07 hedged |
| Genette 1980; Zwaan, Langston and Graesser 1995; McCloud 1993; Hemingway 1932; Lynch 1960 | Secondary accounts and quotations in search results | Used for vocabulary and direction, never for numbers |
| Cowan 2001; Fredrickson and Kahneman 1993 | Search summaries and the paper locations | THR-03 and SES-03 hedged |
| Mittell 2015, *Complex TV* | The chapter abstracts on the open edition (serial melodrama; comprehension). Not the text | Used only as a pointer |
| Creative Screenwriting on A, B and C stories; Hagedorn in Allen (ed.) | A search summary; L5's listing | Burne is the opened source |
| Smith and Worch, GDC 2010 | A listing and secondary recaps | One line in UNT-06 |
| Majora's Mask schedule reports; Civilization speed multipliers; Stellaris crisis settings; quest-log threads | Fan pages, forums and search summaries | Not relied on. Civilization's speeds appear only as a pattern in SES-07 |

### 3.3 Lens claims checked

| Lens claim | Result |
|---|---|
| L5 §5: "an hour of play holds at most three active threads at three distinct weights; a fourth is read as noise" | **Not confirmed as a cap.** Burne and a search summary of Creative Screenwriting give three weights and say the number of threads varies by format. The "three" is a convention. THR-02 uses it as a starting value [J] |
| L5 §13 and the map: "clocks of 4, 6 or 8 segments" under Dungeon World | **Corrected.** The sizes (4 for a complex obstacle, 6 for a more complicated one, 8 for a daunting one) are *Blades in the Dark*'s. *Dungeon World* gives 1 to 3 grim portents for an adventure front, 3 to 5 for the campaign front, 2 to 3 dangers per front and advises about three fronts at most |
| L5 §8: front and back burner practice | **Attested weakly.** The only soap material is a fan's account of five or six front-burner stories being too many, and one fan's description of an older formula of one main story with two or three building behind it |
| L5 §20 and the map: promotion "through gated rungs" | **Partly.** Shadow of War has ranks (captain, veteran, warchief, overlord) and promotion by killing the player or by random encounters. "Seen, recurring, featured, central" is the lens's proposal, not a shipped scheme |
| L5 §25: unfinished tasks | **Confirmed in direction only.** No memory advantage, a tendency to resume. No effect size was visible to me |
| L5 §23: Season 1 events "overwritten when the next shipped" | **Confirmed in part.** Later teams' changes overwrote earlier ones, and the season cannot now be played (PCGamesN) |
| Map NAR-16: Mamet's third question is "paraphrased in secondary sources" | **Confirmed in a narrower form.** The memo as reproduced states the three questions (who wants what; what happens if they don't get it; why now). Versions differ in small typos and in which network is named |
| L6 §5 and §24: media residue, headlines that differ from ground truth | **Taken from the lens as [practice].** The lens fetched the tabletop sources. I did not recheck them |
| L1 §24: three tempos sustain engagement across gaps in play | **Untested.** It is the lens's hypothesis. Used as [hypothesis] |

## 4. Principles

Columns: grade; source and a concrete instance; scale (gl glance, en encounter, vg vignette, gg gig, ar arc, se season) and layers (the plan's four, with X expression, C configuration, E evaluation, T tooling); how to operationalise (**produce**, **check**, or **neither**). Kernel references are to [S0](../spec/kernel.md). Numbers marked [J] are my judgement and [sim] come from §5.2. "S8-P4-nn" and "S8-P5-nn" point at the requirement lists in §9 and §10.

### 4.1 What completes a unit at each scale (NAR-16, NAR-24, EXP-10)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| UNT-01 | Test every unit from encounter upward by three questions: who wants what, what happens if they do not get it, and why now. A unit with weak answers is texture, not a scene. Texture is allowed, flagged, and bounded | [practice] | Mamet's memo to *The Unit*'s writers (read): the answers are "litmus paper", and two characters discussing a third is a warning sign. Instance: a fixer's brief names a client's blocked goal (want), what the client loses (stake) and the window that closes (why now). The map's tension (atmosphere has no want) is settled by the texture flag | en, vg, gg · 2, 3, 4 | **Check:** the offer record cites a frame, a named stake and a window or clock cause (dossier 4 QST-05, R-3). A unit missing one is tagged texture and may not be offered as a scene. A beat whose only job is telling V about a third party is flagged unless it has its own want. No more than two texture beats in a row inside a gig [J]. **Produce:** want from a blocked-frame query (kernel §10.2); stake from the seed's `stake`; why-now from its window predicate |
| UNT-02 | A unit is complete when a recorded value it named at the start has changed. A value is something the engine can read: a frame's status, a pin, a tie rung, a standing. It is never V's inner state | [analysis] for the test (McKee through a summary, memory for the book); [hypothesis] for the mapping to records | Shortform's summary of McKee (read): a scene ends with something in the protagonist's life changed, and a level that changes nothing can be removed. L5's instance: a street encounter V walks past with no change is a beat and not a scene. Instance for us: a client's frame moves from blocked to satisfied; a tie rung moves after a decision | en, vg, gg, ar · 2, 3 | **Check:** each seed declares `turns` (S8-P4-02). At completion the diff of the record (pins, edges, frame statuses) from start to end is non-empty. An empty diff is a logged non-event. **Produce:** sowing proposes a seed only where a declared turn is reachable. D-09: no turn names V's feelings |
| UNT-03 | The scale of a unit is the level of the context chain it turns. Situation: glance. Step: encounter and vignette. Goal: gig. Concern: arc. Drive, or a group's standing: season. A parent's turn sits above its children's, or reaches more actors at the same level | [hypothesis]. The outside ladder (a sequence's climax is bigger than any scene's; an act's bigger than any sequence's) is McKee's, from a summary [analysis]. The chain is the foundation's | [foundation §5](../foundation.md#5-context-and-relevance) lists drives, active concern, goal, step, situation. Instance: a vendor's protection payment is a *concern*, so settling it is an arc-level turn. Today's takings are a *step*. The Claws' hold on the market is a group's *standing*, a season-level turn | all · 2, 3 | **Check:** lint rejects an "arc" whose turn is a step, and a child whose turn sits above its parent's. The harness labels each played unit by the highest chain level it changed and compares it with its declared scale (§8, question 5). **Produce:** promotion (GRW-02) is a rise up the chain and a street form (STR-01) is a projection down it |
| UNT-04 | A unit that passers-by may meet is whole if nobody joins. Joining only adds, and leaving dissolves it into an aftermath trace, never a frozen tableau | [practice]; weak sources | Boal's restaurant piece (an encyclopaedia summary, read): the scene runs whether or not diners join. L5 reads it as the system's own condition. Instance: two figures argue at a stall. With no audience it ends settled (one pays, one leaves) and leaves a trace | gl, en · 2, 3, 4 | **Produce:** every encounter has an unattended form and a `dissolve` form (the named forms of FIT-46; D7 PR-34; D9 R5-12). **Check:** simulate V leaving at each step. No seed holds actors in a pose after V's tier drops (kernel §7.2 keeps their pins) |
| UNT-05 | An encounter carries its premise at once and has a second layer for those who stay | [hypothesis] | Invisible-theatre practice as L5 reads it, and radio's rule that a listener joining mid-line still gets the situation. No study. Instance: a raised voice and a held-out device say "a debt". A bystander who lingers ten seconds hears the sum | gl, en · 2, 4, X | **Produce:** each encounter fragment declares a `premise` cue and a `stay` layer unlocked by dwell (an approach sign, DIR-39). First cue within 5 seconds of V entering sight or earshot [J]. **Check:** half-heard test: players who catch only the middle state the premise |
| UNT-06 | A glance implies one change, and the change is real: its cause is in the record. A second sighting after a gap shows more change, by an amount the record fixes | [analysis]; [practice] | Hemingway's iceberg passage (quotations in search results; the 1932 book not checked); McCloud on the gutter (secondary summaries); Smith and Worch (a listing). Instance: a shuttered stall with fresh flowers implies one thing (the vendor is gone) and cites an event. After three game days the flowers are dry. After a month a new vendor trades there. Unbacked glances are the "hollow places" of the same passage | gl · 1, 2, X | **Produce:** a glance is a glance-level fragment whose `needs` is a recorded fact (`found`), or a `constructed` cause only inside what the record leaves open (D6 R-19). Its state is a function of the record at the time of sighting, never re-rolled (foundation rule 1). **Check:** exactly one `implies`; a cause path of at least one event; the same record gives the same sighting |
| UNT-07 | A vignette fixes one dominant effect at authoring time, and every beat serves it. A callback arrives after the effect has landed | [analysis]; **contested** (partial doctrine) | Poe's 1842 review, through secondary excerpts that quote the single-sitting argument. L5's instance: a twenty-minute courier job built to leave one feeling, unease at the contents. The serial form ignores this doctrine | vg · 2, 4 | **Check:** an `effect` tag from the closed tone vocabulary is required at vignette scale; callbacks sit after the effect beat in the graph; completion falls inside the declared duration. **Produce:** none |
| UNT-08 | A gig is complete when its decision beat has been taken or has lapsed, its outcome facts are written, and its aftermath has been read from the exposure ledger. It leaves a register of loose ends | [corpus]; [hypothesis] for the register | Restates dossier 4 (QST-09, QST-21, QST-37). The new part is the register: unconsumed consequence edges and people whose frames the gig changed. Instance: a retaliation edge that was cancelled and a client whose standing moved | gg · 2, 3 | **Check:** completion needs all three (§5.1). **Produce:** the register feeds growth (GRW-07) |
| UNT-09 | An arc is complete when every promise it opened is paid or retired, each session in which it was live showed one visible step, and a closure entry has been written | [practice] | Sanderson (read): progress, the sense of movement, sustains attention, and readers quit when signposts are too sparse. Instance: a vendor thread over three sessions: a notice, a shuttered stall, a collector's visit, a market that pays or closes | ar · 2, 3 | **Check:** the promise ledger closes (QST-03); at least one progress event per live session [J]; a closure ledger entry (D9 R5-22). **Produce:** a retire form for each unpaid promise |
| UNT-10 | A season is optional. It is complete when its front's end state holds in the city and every thread under it is reconciled (resolved, withered with a closing trace, or transformed). Nothing forces a season on a sandbox | [practice]; [hypothesis] for the reconciliation | *Dungeon World* (read): a campaign front of slower, larger threats links shorter adventure fronts, with 3 to 5 grim portents. Robbins (read): a sandbox has an overarching environment and no overarching plot. GW2 (read): Season 2's additions stay in the world. Instance: a protection drive over a district, ending in a changed pin on who holds the market | se · 2, 3, 4 | **Produce:** a `front` profile (S8-P4-21). Completion is an end-state predicate over city facts plus a reconciliation ledger with no child in running or simmering. Seasons are authored or grown from engaged arcs (D-02). At the "off" setting none are sown. **Check:** the ledger; no season is required for anything else to run |
| UNT-11 | Every unit has two completion modes, witnessed and settled, and both write the same outcome record | [practice]; [hypothesis] | Dossier 9's unattended plan and lazy settlement (R5-01, R5-09); Robbins's sandbox, where the world goes on between sessions. Instance: V never sees the stall dispute. It is settled in the record and V learns it as news at the next joint | all · 2, 3 | **Produce:** the outcome record has a `witnessed` flag. A settled completion reaches V at a joint (arriving, resting, finishing a job, asking). **Check:** every seed's end state is reachable without V (`unattended`); each outcome has a declared consumer (QST-11) |
| UNT-12 | A gig, and each part of an arc, is enterable alone. A V with none of the earlier history can understand it. History is additive | [practice] | Episodic television's self-contained episodes and the sitcom reset (essays, weak); GW2's journal and assumed continuity (read for the journal, summary for the rest). Instance: the brief states client, stake and ask. A callback to an earlier act adds a line and removes none | gg, ar · 2, 4 | **Check:** a cold-start test: run the offer against a V with an empty record and require client, stake and ask in the brief. Callbacks are flagged `across` (QST-02). **Produce:** briefs derive from the frame and the stake, not from earlier events |

### 4.2 Threads: how many, which, and how they leave (NAR-05)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| THR-01 | A thread is a view, not a type: the seeds linked by parent, shared role or frame, or a promise entry | [hypothesis] | The one-fragment-type rule ([P4 §3.6](../p4-seeding-layer.md#36-fragments-and-beats)) and QST-07 (nothing selects behaviour by type). Instance: the vendor's protection thread is the vendor's arc seed, the gig that came out of it and the collector's glance fragments | gg, ar, se · 2, 3 | **Produce:** threads are computed by query over the record (kernel §8). There is no `thread` field, and weight classes are computed by the director. **Check:** a lint finds no rule keyed on a thread label |
| THR-02 | One thread leads. In a play-hour at most three threads visibly advance, at unequal weights: a lead, a second, a runner | [practice]; the three is a broadcast habit | Burne (read): the A story has the most beats, the B story fewer and more emotional, the C story fewest and often lighter. A search summary of Creative Screenwriting says the number of threads varies by genre and format. Instance: a fixer gig (lead), a contact's worry (second), a rumour that keeps returning (runner) | gg · 3 | **Produce:** the director gives each window's beats unequally by pull (THR-10). **Check:** advancing threads per play-hour at most 3 [J]; the lead takes at least half of the hour's beats [J] |
| THR-03 | Count the threads V is aware of and has recently met, not the threads that exist. A thread is attended for 45 play-minutes after its last beat or cue | [empirical] for a small central limit (Cowan: about four chunks, contested at three to five and at seven); [sim] for the counting rule | Instance, toy model (§5.2): with a ceiling of four on *alive* threads, 31 per cent of fast candidates are refused at one candidate an hour. The same ceiling on *attended* threads refuses 8 per cent. The 45 minutes is [J] and moves the occupancy a lot (§5.2) | all · 2, 3 | **Produce:** the attended set from last-beat and last-cue times in play time (extends DIR-32 and DIR-33). **Check:** M8-01 occupancy and M8-02 refusals by tempo class |
| THR-04 | The push budget, not the thread cap, sets the usual load. At dossier 7's soft target of about 3 pushes an hour the cap of four is a backstop | [sim] | Toy model: 3.0 pushes an hour gave a mean of 0.9 attended threads, more than four for 0.2 per cent of the time with no cap at all, and none in view for 41 per cent. The cap binds for threads V pulls, for authored seeds that the fitter places, and at tempo settings above steady | all · 3 | **Check:** measure attended occupancy under real sowing before any cap is tuned (M8-01). **Produce:** authored, fitted and V-pulled threads count against the same attended cap and the same push budget. Do not add per-tempo sub-caps unless M8-02 shows starvation (§5.2) |
| THR-05 | The attended set has a composition as well as a size: at most one climactic thread, at most one hostile thread at imminent or contact stage, and a mix of tempos and tones | [practice] for unequal, differently toned threads (Burne: B emotional, C light); *Dungeon World* (read): no more than about three fronts, and three or four adventure fronts at once overwhelm; [hypothesis] for the numbers | Answers dossier 7's open question 9 with a first guess. Instance: one hostile clock, one relationship thread, one light runner | gg, ar · 3 | **Produce:** admission and overflow rules on composition. **Check:** composition histogram per play-hour; no hour with two imminent hostile threads |
| THR-06 | Threads have a tempo class, and a beat interval to match: fast (a gig, up to about 2 play-hours), medium (an arc, 2 to 12 play-hours across sessions), slow (a front, longer) | [hypothesis] | *Dungeon World*'s adventure and campaign fronts differ in span (read). L1's claim that three tempos sustain engagement across gaps is the lens's and untested. The toy model uses beat intervals of 12, 90 and 240 play-minutes [J] | gg, ar, se · 3 | **Produce:** the class is computed from the seed's clock length and beat count, and sets the request's cadence (D7 §5.5 `max_wait`). **Check:** M8-04 beat intervals by class |
| THR-07 | Every attended or simmering thread gets a beat or a re-findable cue within a bounded interval, or it is retired. A dangling thread is an asset while enough others are alive, and a debt once V-aware ones pile up | [practice], weak; [empirical] that resumption needs a cue | Fan accounts of soap rotation and comic reviews of dropped subplots (F-05). Ghibellini and Meier (abstract): no memory advantage for unfinished tasks, only a tendency to resume. Instance: the vendor thread resurfaces as a rumour after three sessions | gg, ar, se · 3 | **Produce:** a scheduler item per thread with `last-beat` and `last-cue` in play time. A simmering thread with no cue for 8 play-hours or 3 sessions is retired [J]. When V-aware, unattended threads exceed 8, sowing yields. It never forces a closure. **Check:** M8-05 age distribution; M8-06 opened minus closed per 10 play-hours |
| THR-08 | Start the next thread before the last one ends, with a class-0 trace during the rest period (a baton pass) | [hypothesis]; soap overlap is fan-attested | L5's overlap principle. Dossier 7 allows class-0 traces in rest (§5.4). Instance: while a market gig's aftermath plays, a notice appears about trouble in a second district | gg, ar · 3 | **Produce:** a `baton` request (S8-P4-15), class 0, from the best-pulled simmering thread. It costs district salience and no push (DIR-30). **Check:** M8-07 live-thread histogram, with and without baton, at equal push counts. The toy model says the ceiling is low: 41 per cent empty at 3 pushes an hour |
| THR-09 | Prefer intersections the record already holds. Threads that share a role, a place or a consequence are booked together, and a thread that touches no other is flagged | [practice]; [hypothesis] | Burne: the writers plan where storylines intersect. L5's failure mode: a B plot that never touches the A. Cross-pressure ([foundation §5.2](../foundation.md#52-groups-and-membership); kernel §10.8 `Dilemma`) is the engine's own source. Instance: the vendor thread and a fixer's gig share one collector | gg, ar · 3 | **Produce:** fitting scores shared role or venue, which costs one cast and one place. **Check:** share of attended threads that share at least one role, place or consequence with another. A coincidence not in the record is barred (QST-01) |
| THR-10 | The lead is chosen by V's own pull: relevance to V's active frames and the recency of V's own acts. Never by what the engine thinks V should care about | [analysis] | D-09; kernel §10.3 (pull). Instance: V returns to the market twice, so the market thread leads | all · 3 | **Produce:** lead = highest relevance (kernel §10.3) times recency of V's acts on that thread. **Check:** an audit finds no term reading V's inferred drives; the lead changes within one window of V's acts |
| THR-11 | On overflow, merge first, then queue, then withdraw the lowest-pull thread with a closing trace. V's choice is never made for V | [practice] for the cap and the closing trace (DIR-32; F-04); [hypothesis] for the order | WoW's cap makes the player drop quests (F-04). Instance: two threads whose clients share a gang membership become one thread with two faces | all · 3 | **Produce:** the overflow order. The engine withdraws only what it sowed. A thread V pulled is simmered, never dropped. **Check:** no silent drop; each withdrawal has a trace |
| THR-12 | Retire in steps: attended, simmering, dormant (pins kept, nothing shown), closed with a closing trace. Closure is a stated status (resolved, abandoned or transformed), not necessarily a resolution | [practice] (map tension; DIR-47; D9 R5-22) | Instance: a rumour that "the Claws have left Kabuki" closes the vendor thread. A mentor's release is the same ladder (d02) | gg, ar, se · 2, 3 | **Produce:** attention class is derived from last-beat and last-cue times, so P4's lifecycle gains no state. Closure writes a closing trace and a loose-end register (S8-P4-08, S8-P4-09). **Check:** every V-aware thread that leaves attended shows V one sign. A thread V never saw closes silently at no cost |

### 4.3 Growth: from a small thing to a large one (NAR-18)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| GRW-01 | Promote on V's observed returns and outcomes, not on authoring order or the engine's guess | [practice], weak; [shipped] for outcome | The breakout character, chosen by audience response after the fact (one report: a one-episode guest who became a lead, in sources of mixed quality). Shadow of Mordor tracks what happens with the player (read). Instance: V buys from the same vendor three times | gl, en, gg, ar · 3 | **Produce:** return and outcome counters on the subject, built from observed events only (D-09). **Check:** a promotion log. Every promotion has the counts that earned it, unless an author fixed it (GRW-11) |
| GRW-02 | Use a ladder of four rungs, each opening more of the subject's bundle: seen, recurring, featured, central | [hypothesis]; the lens's proposal | The foundation's Open operation. Shadow of War's ranks (read) are a comparison: captain, veteran captain, warchief, overlord. Instance: §5.3 | gl to ar · 2, 3 | **Produce:** `promote(subject, rung)` is Open plus a contributed frame. The subject's identity never changes (foundation: identity is not re-rolled). **Check:** rung prerequisites (§5.3) |
| GRW-03 | Gate a rung by a notable outcome, not by time spent: an act of V's that changed something between V and the subject | [shipped] for combat; [hypothesis] for the rest | Bazan (read): a regular orc that kills the player becomes a captain, and random encounters level orcs. Instance: the vendor V paid, spared, warned or owed | en, gg · 3 | **Produce:** outcome kinds come from the closed act vocabulary (D9). **Check:** each promotion cites a cause event. M8-09 counts trivial promotions |
| GRW-04 | Refuse a rung the engine cannot furnish. Promotion needs depth ready | [shipped] (a developer's reading of a natural experiment); [practice] | d02 BND-11: about a quarter of players saved one character and three quarters another, and the developers read it as the number of chances to build a bond. Instance: a figure with no authored moments and no repertoire stays recurring | en to ar · 2, 3, 4 | **Produce:** `depth_available` from authored fragments, repertoire bits and the generated bundle. Featured needs a minimum of tie-specific moments (BND-11). Central needs a seed. **Check:** refusals logged as "no depth" |
| GRW-05 | Keep few anchors. The rungs near V and in each district are capped, and a few well-surfaced persistent figures beat many thin ones | [practice] | De Plater (read): generate detail at a few peak moments and let the player fill the gaps. The map records the studio's own lesson on feature creep (L12; not rechecked). Caps are [J] | gl to ar · 3 | **Produce:** per district, central at most 1, featured at most 3, recurring at most 8 [J]. **Check:** counts per hour; the share of agents above seen stays small (M8-10) |
| GRW-06 | A promoted thread must not displace V's own focus | [practice], trope-level; [hypothesis] | "Jump the shark" overpromotion (L5). Instance: V keeps going to the market, and the engine's new thread keeps pulling V to the docks | ar, se · 3 | **Produce:** pull share = V's play time in threads V pulled over time in threads pushed. When pushed exceeds pulled over a play-hour, sowing yields [J]. **Check:** M8-11 |
| GRW-07 | A small thing grows by its loose ends. A finished gig leaves a register of unconsumed consequences and changed people, and the next scale is built from them | [practice]; [hypothesis] for the register | Burne: the C story is the long-term one, and writers deliberately set its payoff later. Sanderson (read): a chapter's small problems add up to the book's central one. Instance: a gig's cancelled retaliation edge becomes a fixer's later call | gg, ar · 2, 3 | **Produce:** a `loose_ends` register on resolved seeds. Sowing proposes child seeds ranked by V's return counts. An arc is assembled from at least two found ancestors, or authored. **Check:** the ancestry is in the record |
| GRW-08 | Growth reverses. A thread V stops returning to steps down, with a closing trace, and its pins stay | [analysis] | The foundation's Close; d02: a mentor's separation is the ladder in reverse. Instance: the collector stops being featured | gg, ar · 2, 3 | **Produce:** demotion after N play-hours with no return and no live clock [J: 10]. **Check:** no demoted subject loses an observed pin |
| GRW-09 | Counting returns is local, legible and resettable, and never a retention measure | [analysis] | The map's tension (NAR-18 against MOT-05 and ETH-20); DIR-07. Instance: V can open the record and see "returned to this vendor 3 times" and clear it | all · 3, C | **Produce:** plain counts on subjects in the save; readable in the opt-in record; never exported. **Check:** an audit finds no consumer outside promotion and demotion |
| GRW-10 | Promotions differ in shape. The thread a promoted figure carries comes from its own drives, not from one template | [hypothesis]; the failure is anticipated | L5 and L12: same-shaped rivalries everywhere (no study). Instance: one promoted figure brings a debt, another a grudge, a third a secret | gg, ar · 3 | **Produce:** the promoted thread is sown from the figure's frame. Shape features (verb, stake, relationship) separate across promotions as in dossier 5. **Check:** shape diversity per 10 promotions |
| GRW-11 | An author's rung is a floor the engine never lowers. The engine may add moments above it | [analysis] | D-03: authors mark parts fixed. Instance: an authored romance option is central from the start | all · 2, 4 | **Produce:** the rung slot is pinned `authored` and the engine contributes above it. **Check:** no demotion of an authored floor |
| GRW-12 | Generated threads stay off the spine. The ceiling for a generated figure is an arc, never the main story's climactic beats | [hypothesis]; dossier 4 P-8 | QST-09: wiring may be produced, but craft goes to the decision and the ending. Instance: a generated figure may lead a district arc and cannot be the one who decides the main story's ending | ar, se · 3, 4 | **Produce:** roles on the spine are authored-only. **Check:** share of generated beats among those players rank as peak or ending |

### 4.4 How a large thing shows from the street (EXP-10, with EXP-01 and the map's setting fields)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| STR-01 | A large thing shows at street scale only as projections of its state onto what a street holds: district fields, places, people and media | [hypothesis]; [practice] | The foundation's maps (projection, aggregation, derivation). Carson (read): the environment carries story as cause-and-effect clues, such as broken doors and scorch marks, that visitors read. Instance: a protection drive projects a rent rise, shuttered stalls, collectors and tags | gl, en, se · 1, 2, 3, X | **Produce:** a front declares `projections` per clock segment: street forms per channel as contributions on the districts' fields and as glance fragments (S8-P4-13). The fitter chooses forms by V's place and tier. **Check:** each segment has a form in at least two channel kinds (DIR-46) |
| STR-02 | Every event above street scale leaves media residue before and after, and the media version differs from the record by a tunable amount | [practice] from L6, not rechecked | Screamsheets in the tabletop line: news items as hooks, where the headline names a suspect and a beneficiary. Instance: a collector's visit is reported as "gang trouble" and blamed on the wrong crew | gl, en, gg · 1, 2, X | **Produce:** outlets are actors with their own beliefs and biases (D-10), so the headline is the outlet's belief, not the record. Divergence rate is a tunable. **Check:** reconstruct-from-residue test: a player can say what happened from residue alone. Divergence correlates with investigation offers taken |
| STR-03 | Each street sees one facet. People know their own corner, partly and sometimes wrongly. No street form states the whole front | [analysis] | Foundation §5.4 and D-10: beliefs are pins in the believer. Instance: a vendor knows the rent rose and not why | gl, en · 1, 2 | **Produce:** street forms come from the speaker's own beliefs (`knows`, kernel §11.4). **Check:** no form asserts what its speaker could not know. Taken together the forms reconstruct the front |
| STR-04 | Strength follows distance. A big thing is faint far away, plain nearby and unmistakable at its centre | [hypothesis] | Dossier 7's ladder (distal, proximal, imminent) applies to any front and not only to dread. Lynch's landmark (secondary summaries) is the part V can see from afar | gl, en · 3, X | **Produce:** form strength is a function of travel-time and social distance from the front's centre. **Check:** stage transitions are logged with their causes (DIR-45) |
| STR-05 | Give every large thing a landmark and a local cost. The landmark is a place V can see or hear it from. The local cost is something ordinary people feel | [analysis]; [hypothesis] | Lynch's legibility (secondary); L6: a felt local cost behind every corporate act. Instance: a corner stall that stays shut, and market rents that climb | ar, se · 1, 2, 4 | **Check:** a front without both is linted. **Produce:** the local cost is a derived field change (rents, prices, patrol density), not a line of text |
| STR-06 | A front has its own set of signs, so two fronts do not look alike and V can learn to read them | [hypothesis] | Carson: consistent rules stop an audience feeling cheated (summary of the article's point). Instance: Claw tags and collectors mean the protection drive. Dead streetlights mean a blackout | ar, se · 2, 4, X | **Produce:** a `sign_set` of a few motifs per front, reused across its forms. **Check:** a confusability test: players attribute traces to the right front |
| STR-07 | Keep a baseline. A floor of ordinary texture stays on whatever fronts run, and fronts read as deviations from it | [analysis] | Dossier 7 T-1 and DIR-37 (a quiet city must not be dead); L3's congruence and distinctiveness tension. Instance: ordinary stalls and chatter, against which three shut stalls stand out | gl, en · 3, X | **Produce:** a baseline density; a front's forms are contributions above it, within a per-district salience budget (DIR-30). **Check:** a distinctiveness test against the baseline |
| STR-08 | A street form has a handle: V can pull on it and reach an explanation or an offer in a few steps | [practice]; [hypothesis] | DIR-51 (a handle V can seek) and QST-05 (an offer is a blocked goal). Instance: asking the neighbouring vendor why the stall is shut leads to the collector, and then to a gig | gl to gg · 2, 3, X | **Produce:** each form lists an `ask` affordance that opens the next fragment. **Check:** from any form there is a path of at most two steps to a relevant offer or a why-trace |

### 4.5 Time (NAR-17)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TIM-01 | Keep three times apart: play time (when V sees it), game time (when it happened) and record order (causes before effects). Telling may reorder what V sees. The record may not be reordered | [analysis] | Genette's order, duration and frequency (secondary accounts). Dossier 7 PR-9 already separates play and game time. Instance: V reaches the shuttered stall before learning why. The record holds the event first | all · 1, 2 | **Produce:** events carry both stamps (D7 PR-9) and the telling carries a `shown_at` play-time stamp. **Check:** no telling places an effect before its cause in the record |
| TIM-02 | Aftermath first is legitimate when the cause can be found | [analysis]; map NAR-17 | Instance: a glance (UNT-06) is nearly always aftermath. The record holds its cause, and V can pull on it (STR-08) | gl, en, gg · 2, 3 | **Check:** any trace shown before its cause has a cause path V can reach within k steps. No retro-justified gap beyond what the record leaves open (D6 R-19) |
| TIM-03 | Narrate at the speed V's presence earns: scene near V, summary elsewhere, ellipsis for the unshown, a pause for rest. Tell a repeated event once, as a pattern | [analysis] | Genette's summary, scene, ellipsis, pause and iterative telling (secondary). The engine's own resolution tiers and summaries (kernel §9.3) give the same four. Dossier 9 R5-09 and R5-24 (a pattern line needs at least three acts). Instance: "the Claws shake the market down every night" replaces three identical collector scenes | all · 1, 2 | **Produce:** scene only for what V is present for. The rest settles at joints (D9 R5-09). A third repeat becomes a pattern line. **Check:** no more than one singulative telling of an event kind per N similar events [J: 3] |
| TIM-04 | After a jump in time, place or company (sleep, a wait, fast travel, a load), give one cue for each dimension that changed | [empirical] on reading; [analysis] for the transfer | Zwaan, Langston and Graesser 1995 (secondary): readers track time, space, protagonist, causation and intention, and a shift in one prompts updating and slows reading. Instance: after a night's sleep, light, a different crowd, and a line that says who called | all · 2, X | **Produce:** the first class-0 or class-1 content after a jump carries one cue per changed dimension, in the settling period (DIR-59). **Check:** a probe asks when, where and why. M8-14 |
| TIM-05 | A deadline needs a perceivable source and fires whether or not V attends. It lands on the world. Size a clock to the obstacle and tick it by events | [practice]; [sec] for Fallout | *Blades in the Dark* (read): 4 segments for a complex obstacle, 6 for a more complicated one, 8 for a daunting one, and a danger clock takes 1 to 3 segments per complication. Fallout kept a 150-day limit and dropped a second, overall one (F-02). Instance: a front's clock ticks on a collector's visit, a closed stall and a new notice | gg, ar, se · 2, 3 | **Produce:** clocks are derived views of events (D9 R5-08); segments scale with the obstacle [J mapping]; ticks cite events. **Check:** each clock has a perceivable source (DIR-48). A deadline shorter than a play-hour carries a warning (QST-14) |
| TIM-06 | Telling out of order never writes V's past | [analysis] | D-09 and QST-33: the engine may settle a crew's earlier preparation and never V's. Instance: a flashback in a heist is the crew's, and V is offered one | gg, ar · 2, 3 | **Check:** no flashback or recap asserts V's earlier act without an observed pin. A flashback for V is offered and V accepts or declines |

### 4.6 Session shape and tempo

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| SES-01 | Open by orienting, not by hooking. After a load, settle, then give one cue to the thread V was last in, at the lowest class. Resumption needs a cue and not suspense | [practice]; [empirical] for resumption | Sly Flourish (read): a strong start brings players into the fiction, because a table must cross from real life into the game. V is already in the world, so the job is to re-situate. Ghibellini and Meier (abstract): unfinished tasks are not remembered better and tend to be resumed | all · 2, 3 | **Produce:** the arbiter's opening: settle 90 seconds (DIR-59); one cue to the last attended thread or, with none, one class-0 hook; then normal play. **Check:** M8-12 first-push latency and class; no session opens with a class 3 or 4 push |
| SES-02 | The close cannot be scheduled, so keep every moment a safe stop. No state is lost, and nothing is punished by leaving | [analysis] | Alexandrian (read): an open table works when characters end the session at home base. That is a calendar tool and cannot be a rule for a game with no visible end. Its effect, that stopping is never costly, is what to keep | all · 2, 3 | **Check:** the only state held by a live process alone is pacing state (D7 PR-11). Consequences key on game-time facts, not on a quit. A static audit finds no rule that reads a quit or a load as an input |
| SES-03 | Make the rest after a climax end-worthy. Evaluations of an episode tilt to its peak and its end, so the likeliest place to stop should close, not hang | [empirical] (lab); [hypothesis] for where players stop | Fredrickson and Kahneman 1993 (summaries): judgement follows peak and end, and duration barely counts. Instance: after the market gig, the aftermath plays a closing beat and the city goes quiet | gg, ar · 3, 4 | **Produce:** the aftermath stage places a closure beat at the start of rest (QST-37; D9 R5-22). **Check:** M8-13 quit points against phase. If quits do not cluster after climaxes, drop the rule |
| SES-04 | No cliffhanger engineering. The director never times a push to land before a likely quit and never withholds a payoff to hold an open loop. A thread's own open end is story and is allowed | [empirical] (reading experiments); [analysis] | Schibler, Hahn and Green 2024 (read): a cliffhanger raised wanting the next instalment in both studies and left enjoyment and suspense unchanged. Ghibellini and Meier (abstract): no memory advantage. DIR-07 and D2's temporal dark patterns. Instance: the engine does not hold a payoff back to sit after the player's likely last gig | all · 3 | **Check:** a static audit of the director's objective finds no term reading session length, time since load, or a quit proxy. Input silence is read only for the away marker (DIR-60). **Produce:** none |
| SES-05 | A player-declared time budget chooses scale forms. It is optional, set by the player and never inferred | [practice]; [hypothesis] for the setting | Alexandrian (read, 21 Feb 2026): when time is short, prune towards the conclusion, frame scenes late and skip transitions, and if the end is out of reach, resolve the rest in broad strokes, with notice. Instance: "I have about 45 minutes" prefers short forms and abstract settlement and avoids starting a long gig | all · 2, 3, C | **Produce:** the budget feeds the arbiter's form choice (S8-P4-07). No thread whose shortest form exceeds what is left is offered, unless V pulls it. **Check:** with a 45-minute budget, offered units with a minimum above the remainder are zero. The budget never forces an end |
| SES-06 | Short forms drop texture and legwork. They never drop the decision beat or the aftermath | [hypothesis] | Dossier 4 (QST-21, QST-37): the craft goes to the decision and the ending. Alexandrian: a gig pruned to its conclusion keeps the path to the end. Instance: a short courier gig drops the second approach and keeps the choice and the consequence | gg · 2, 4 | **Produce:** a form declares `drops`. The lint refuses a form that drops a decision beat or the aftermath (S8-P4-06). **Check:** the form's durations |
| SES-07 | Tempo is a bundle of parameters, not one number: push rate, thread-opening rate, front clock speed, lead times and promotion thresholds. One dial sets them all inside bounds, and an expert panel exposes each | [shipped] for the separation; [sec] for the pattern | RimWorld keeps cadence apart from difficulty (dossier 7 F-02). The Game Accessibility Guidelines (read) list an option to slow the whole game down. Civilization's speed settings scale costs and turn counts (fan sources, not relied on). Instance: §5.5 | all · 3, C | **Produce:** the parameter table of §5.5 as data. "Off" means pull only, plus fitting of authored seeds (D-02, D-03). **Check:** each dial position's measured push rate (D7 PR-8) |
| SES-08 | Tempo changes are nested thinning. Keep schedule slots as hashed draws at the highest tempo and activate a slot when its draw falls under a threshold, so calm is inside steady, which is inside restless | [analysis]; [hypothesis] for use | Standard thinning of a random schedule (memory). Dossier 7 DIR-09 and kernel §1.4: hashed draws on a named stream. Instance: moving from steady to restless adds slots and re-rolls none. A reload shows the same schedule at the same setting | all · 2, 3 | **Produce:** each slot has `u = hash(seed, epoch, slot)` and is active if `u < p(tempo)`, with `p` rising with tempo. A change takes effect at the next window boundary and never mid-beat. **Check:** set inclusion (calm within steady within restless) and the reload test (M8-15) |
| SES-09 | Slow is an access feature and a pace the player owns. A slower setting lengthens clocks and lead times, so a player with little time a week is not punished | [practice] | Game Accessibility Guidelines (read): speed options help motor and cognitive access. Dossier 9 R6-18: a gentle option holds non-urgent fronts until V engages. Instance: a calm setting stretches a front's clock by half | all · 3, C | **Produce:** clock and lead multipliers in the tempo table. Fronts tick on game time, and V controls how much game time passes (sleep, waits). **Check:** the ticks per play-hour at each setting |
| SES-10 | Every session writes a plain, local ledger: what was shown, what advanced, what closed, which rungs moved, and the phase at quit | [analysis] | Exercise control's log (D7 DIR-57). Instance: a ledger line per push with purpose, planned and actual time | all · 2, T, E | **Produce:** the ledger is built from the record and the arbiter's log. It feeds the harness and dossier 11's return view. **Check:** M8-01 to M8-16 compute from it without running the engine |

## 5. Models the engine could run

These are small, meant to be replaced piece by piece as the harness measures. Read the grades before the numbers.

### 5.1 The scale ladder: what completes a unit

Each row states what the unit turns (UNT-03), how it completes (UNT-01 to UNT-11), how it completes without V (UNT-11), and how it fails.

| Scale | Span | Turns (chain level) | Completes when | Without V | Fails when | Principles |
|---|---|---|---|---|---|---|
| Glance | seconds | A changed situation, shown | It is perceived (an observed pin) or it expires unseen at no cost | It never needed V | It implies two things, or its cause is not in the record | UNT-06, STR-01 |
| Encounter | about a minute | A step in someone's goal | Want, obstacle and urgency are visible, and the step turns or the unit dissolves | Settles or dissolves, leaving a trace | It needs V to join, or hangs in a frozen pose | UNT-01, UNT-04, UNT-05 |
| Vignette | a few minutes | A step, with one effect | The declared effect has landed, inside its duration | As an encounter | A second effect is added; a callback lands before the effect | UNT-07 |
| Gig | about an hour | A goal | Decision beat taken or lapsed; outcome facts written; aftermath read from the exposure ledger; loose ends registered | Settled in the record, delivered as news | No decision beat; a terminal with nothing leaving it | UNT-08, UNT-11, UNT-12 |
| Arc | several sessions | A concern | Every promise paid or retired; one visible step per live session; a closure entry | Settled by the world's own urgency | Progress invisible between sessions; a promise left unmarked | UNT-09, THR-07 |
| Season | weeks of play | A drive, or a group's standing | The front's end state holds in the city; every child thread is reconciled | The front resolves in the record | Children left running; a season forced on a sandbox | UNT-10, STR-01 |

The McKee ladder (beat, scene, sequence, act, story) lines up loosely: a P4 `exchange` for his beat, an encounter or vignette for a scene, a gig for a sequence, an arc for an act. It is a cross-check on the idea that each level's turn is bigger than the one below, and it does not generate any of the rows.

### 5.2 Thread budgets: every number sorted, and a toy model

**Every number.**

| Quantity | Starting value | Basis | Kind |
|---|---|---|---|
| Attended window after a beat or cue | 45 play-minutes | None for games. Occupancy moves by a factor of two across 20 to 90 minutes (below) | **Judgement** |
| Attended, live, climactic, simmering threads | 4, 2, 1, 8 (dossier 7) | Cowan's four, contested at three to five; *Dungeon World*'s advice of about three fronts; the rest D7's | **Borrowed** and judgement |
| Threads advancing in a play-hour | at most 3, one leading | A, B and C plots in broadcast guides | **Judgement** (convention) |
| Hostile threads at imminent or contact | 1 | *Dungeon World*: 3 to 4 adventure fronts overwhelm; D7 open question 9 | **Judgement** |
| Thread tempo classes | fast up to 2 play-hours; medium 2 to 12; slow beyond | The span of adventure and campaign fronts | **Judgement** |
| Beat intervals used in the toy | 12, 90, 240 play-minutes | None | **Judgement** |
| Simmering refresh | a cue within 8 play-hours or 3 sessions, else retire | None | **Judgement** |
| Promoted rungs per district | central 1, featured 3, recurring 8 | De Plater's "few anchors" gives the idea, not the numbers | **Judgement** |
| Demotion after no return | 10 play-hours | None | **Judgement** |
| Clock segments | 4, 6 or 8 by obstacle | *Blades in the Dark* | **Borrowed** [practice] |
| Campaign front portents | 3 to 5 | *Dungeon World* | **Borrowed** [practice] |
| Premise cue time | 5 seconds | None | **Judgement** |
| Re-situating | one cue per changed dimension | Zwaan et al. name the dimensions | **Borrowed** direction, judgement on form |

**The toy model.** It runs sowing over 2,500 play-hours, with a 100-hour warm-up, in one-minute steps. All inputs are assumed. Candidates arrive at random at 0.5, 1 or 2 an hour, 70 per cent fast, 25 per cent medium and 5 per cent slow. Mean lives are 60, 480 and 1,800 play-minutes (gamma, shape 3). A thread beats at random intervals of 12, 90 and 240 minutes on average, and each beat is a push, as is the opening. It counts as attended for 45 minutes after its last beat. Class-0 traces and V-pulled threads are not modelled. Four policies: no cap; a cap of four on alive threads (`alive4`); a cap of four on attended threads, with held beats (`att4`); and `att4` with sub-caps by class (`classed`: fast 3, medium 2, slow 1). The model is about 100 lines of standard-library Python with a fixed seed. It is not kept in the repository, and these inputs specify it.

*Load at the three arrival rates.*

| Candidates an hour | Policy | Pushes an hour | Mean attended | Time with none in view | Time with more than 4 | Refused: fast, medium, slow |
|---|---|---|---|---|---|---|
| 0.5 | no cap | 3.0 | 0.90 | 41% | 0.2% | 0, 0, 0 per cent |
| 0.5 | `alive4` | 2.8 | 0.84 | 42% | 0% | 9, 7, 4 |
| 0.5 | `att4` | 3.0 | 0.89 | 41% | 0% | 1, 1, 0 |
| 0.5 | `classed` | 2.9 | 0.87 | 41% | 0% | 1, 6, 6 |
| 1 | no cap | 5.9 | 1.81 | 16% | 3.3% | 0, 0, 0 |
| 1 | `alive4` | 4.1 | 1.26 | 24% | 0% | 31, 28, 32 |
| 1 | `att4` | 5.5 | 1.69 | 17% | 0% | 8, 6, 6 |
| 1 | `classed` | 5.4 | 1.56 | 19% | 0% | 5, 15, 19 |
| 2 | no cap | 11.8 | 3.61 | 3% | 29.6% | 0, 0, 0 |
| 2 | `alive4` | 5.2 | 1.60 | 14% | 0% | 56, 58, 57 |
| 2 | `att4` | 8.7 | 2.64 | 4% | 0% | 27, 26, 25 |
| 2 | `classed` | 8.7 | 2.45 | 5% | 0% | 21, 38, 36 |

*Sensitivity to the 45-minute window, no cap.*

| Window | Candidates an hour | Mean attended | Time with none in view | Time with more than 4 |
|---|---|---|---|---|
| 20 min | 0.5 | 0.59 | 56% | 0.0% |
| 45 min | 0.5 | 0.90 | 41% | 0.2% |
| 90 min | 0.5 | 1.23 | 29% | 0.6% |
| 20 min | 1 | 1.17 | 31% | 0.6% |
| 45 min | 1 | 1.81 | 16% | 3.3% |
| 90 min | 1 | 2.51 | 8% | 9.8% |

**Reading it.** Everything below is a consequence of the assumptions.
1. **The push budget binds first.** About 6 pushes per thread, so dossier 7's soft target of 2 to 4 an hour supports roughly 0.5 new threads an hour. At that rate the cap of four is almost never reached, even with no cap. The cap matters for what V pulls, for authored seeds the fitter places, and at settings above steady (THR-04).
2. **Count attended, not alive.** At one candidate an hour `alive4` refuses 31 per cent of fast candidates and holds a mean of 1.26 in view. `att4` refuses 8 per cent and holds 1.69. The ceiling on what V sees is the same.
3. **Sub-caps by tempo class buy little.** `classed` moves refusals between classes (more medium and slow refused, fewer fast) and changes the mean attended by about 0.1. By the simplicity rule of the architecture contract, do not add them until M8-02 shows fast threads starving.
4. **A slow thread is attended only a fraction of its life.** With these intervals a slow thread is in view about 19 per cent of its life (45 of every 240 minutes), a medium one about half, a fast one all of it. Counting lifetimes would let a front crowd out gigs.
5. **The rhythm of a season falls out.** At 0.5 candidates an hour a slow front opens about every 45 play-hours, a medium arc about every 8 and a fast gig about every 2.8. That is a plausible shape (a season's worth of arcs under a front), and it is entirely a product of the mix I assumed.
6. **The engine's threads are a minority of play time.** With none in view for about two fifths of the time at the soft target, the base game and V's own pulls fill the rest. This fits D-02. It also caps what a baton pass can do (THR-08): clustering openings can shrink the empty share, but it cannot raise the mean without raising pushes.

### 5.3 The promotion ladder

Opening is the foundation's Open operation. Each rung opens more of the subject's bundle, never changes its identity, and needs the gate below. Caps are per district [J].

| Rung | What is open | Gate (all observed, D-09) | Needs ready | Cap | Steps down when |
|---|---|---|---|---|---|
| Seen | Only what V observed is pinned (a face, a stall). The rest is open | V perceived it | Nothing | None | It is forgotten (foundation Forget). Pins stay |
| Recurring | A stable identity, a routine place, one repertoire bit | V meets it again at least an hour of play later, or twice in one place | A routine and a bit | 8 | No return for 10 play-hours |
| Featured | A frame opened (wants, concerns, ties) and a moment of its own, such as a rumour about them | A notable outcome: an act of V's that changed something between V and them, then a return after it | A minimum of tie-specific moments (BND-11) | 3 | No return and no live clock for 10 play-hours |
| Central | A seed of its own with a promise ledger and a clock | V pulls it (asks, follows, accepts) at least twice, or an author fixed it | A seed, or fitting can supply one; authored-only on the spine | 1 | The arc closes with a trace, and the subject steps down one rung |

A subject whose gate is met and whose depth is not ready stays where it is, and the refusal is logged (GRW-04). An author's rung is a floor (GRW-11).

### 5.4 A large thing from the street: one front, worked

An invented front, **the market squeeze**: a gang tightens a protection drive over one market. It is a season-level seed whose end state is a changed pin on who holds the market. Its clock has six segments. It declares a landmark (the corner stall), a local cost (stall rents), a sign set (gang tags, collectors in matching jackets, a notice board) and one handle per form.

| Clock segment | Distal (other districts, V far off) | Proximal (the district, V near) | Imminent (the market, V in it) | Media version | Handle |
|---|---|---|---|---|---|
| 1. Notice | A line in a district news item about "rent reviews" | A notice on the market board | A vendor mutters about the rent | "Rent review" | Ask the vendor |
| 2. First closures | A trader mentions a friend leaving | Two stalls shuttered | The corner stall shut, flowers on its counter (landmark) | "Traders leave" | Ask the neighbouring vendor |
| 3. Collectors | A rumour of "the Claws are leaning on Kabuki" | Tags on walls, collectors seen | A collector at a stall, a raised voice | Blamed on another crew | Follow the collector |
| 4. Standoff | A scanner entry: a vendor dispute | Patrol density changes | A stall owner refuses; a fixer's offer is posted | "Gang trouble" | Accept the offer |
| 5. Break | A headline, a quiet follow-up | The market closes for a day | Shutters down, an aftermath trace | "Market closed" | Ask who gains |
| 6. Settled | A rumour of who holds the market | New signs, new prices | The same market under other management | "Under new management" | Ask the new owner |

Every form is a glance-level fragment with a `needs` fact (the clock's segment) and one `implies`. The media column is the outlet's belief, which is wrong in segment 3 and incomplete in 4. The street sees one facet at each step (STR-03). A V who never goes near still gets the distal column. The front completes (UNT-10) when the market's pin changes and every child thread under it (the vendor's arc, the gigs, the collector's thread) is resolved, closed with a trace or transformed.

### 5.5 Session shape and tempo

**A session as the arbiter sees it.**

| Phase | What happens | Rule | Principle |
|---|---|---|---|
| Load | Pacing state is lost. Pending offers come from the saved record | Pending offers pinned when made (D7 PR-13) | SES-02 |
| Settling | 90 play-seconds with no push | D7 DIR-59 | SES-01 |
| Re-situating | One cue per changed dimension, then one cue to the last attended thread (a pin, a journal line), else one class-0 hook | Lowest class; no class 3 or 4 | SES-01, TIM-04 |
| Play | The release step of D7 §5.5, at the chosen tempo | Hard gates never relax | SES-07 |
| Climax | A thread's decision beat or contact | No new pushes that add intensity | D7 DIR-27 |
| Rest and aftermath | A closure beat first, then rest. Baton traces allowed | End-worthy; class 0 only | SES-03, THR-08 |
| Away | 60 seconds with no input | Class 0 and 1 only | D7 DIR-60 |
| Quit | At any moment | Nothing lost, nothing punished | SES-02 |
| Return | After a day or after weeks | **Dossier 11.** This dossier hands it the settling period, the re-situating cues, the session ledger, the loose-end register and the closure ledger | |

**The tempo bundle.** One dial, parameters set inside bounds. The values are [J]. They are consistent with dossier 7's rules that arrivals stay near or under a third of the hard cap (about 4 an hour) and that the hard gates never relax.

| Parameter | Off | Calm | Steady (default) | Restless |
|---|---|---|---|---|
| Soft push rate, sown (an hour) | 0 | at most 1.5 | 2 to 3 | up to 4 |
| Thread-opening rate (candidates an hour) | 0 | 0.25 | 0.5 | 0.8 |
| Front clock speed (game time) | authored only | ×0.7 | ×1 | ×1.4 |
| Lead times | authored only | ×1.5 | ×1 | ×0.8 |
| Promotion thresholds | authored only | ×1.5 | ×1 | ×0.7 |
| Hard gates (spacing 60 seconds; 2 in 10 minutes) | unchanged | unchanged | unchanged | unchanged |

"Off" means pull only, plus fitting of authored seeds on their own windows (D-02, D-03). The hard gates never move. The opening of a first session is gentler: no sown push in the first ten play-minutes and none above class 1 in the first hour [J, no evidence]. SES-08 makes the columns nested subsets of one schedule.

### 5.6 Calibration plan and measures

| # | Measure | How to compute | Principle |
|---|---|---|---|
| M8-01 | **Occupancy** | Attended threads over play time; the share with none, and with more than 4 | THR-03, THR-04 |
| M8-02 | **Refusals** | Candidates refused, by tempo class and by rule | THR-03, THR-11 |
| M8-03 | **Advance and lead share** | Threads advancing per play-hour; the lead's share of beats | THR-02 |
| M8-04 | **Beat intervals** | Intervals by tempo class against the class's target | THR-06 |
| M8-05 | **Thread age** | Time since the last beat or cue for every attended or simmering thread | THR-07 |
| M8-06 | **Debt** | Threads opened minus closed among V-aware threads per 10 play-hours; complaints about dangling threads in sessions | THR-07 |
| M8-07 | **Live-thread histogram** | Live threads per play-hour, with and without baton, at equal push counts | THR-08 |
| M8-08 | **Composition** | Climactic and hostile-imminent counts per hour; tone and tempo mix | THR-05, THR-09 |
| M8-09 | **Promotion audit** | Share of promotions with a cause event; trivial promotions; refusals for no depth | GRW-01 to GRW-04 |
| M8-10 | **Rung counts** | Counts per district; share of agents above seen | GRW-05 |
| M8-11 | **Pull share** | V's play time in pulled against pushed threads | GRW-06, THR-10 |
| M8-12 | **Opening** | First-push latency and class after each load | SES-01 |
| M8-13 | **Quit phase** | The phase and the time since the last climax at each quit | SES-03 |
| M8-14 | **Re-situating** | A probe after jumps: can V say when, where and why | TIM-04 |
| M8-15 | **Nesting and reload** | Calm within steady within restless as sets; identical schedule after a reload at one setting | SES-08 |
| M8-16 | **Street** | Reconstruct-from-residue rate; front attribution accuracy (confusability); steps from a street form to an offer or a why-trace | STR-01 to STR-08 |

Where a measure needs a human, it uses consented sessions with local data (D-09, dossier 12). The corpus test for UNT-03 is in §8.

## 6. Tensions

| # | Tension | One side | The other side | How to settle it |
|---|---|---|---|---|
| T-1 | **Enterable alone or cumulative** (map) | Each gig and arc part stands alone (UNT-12) | A world that resets everything reads as hollow | History is additive. Each effect carries a persistence class: lasting for relationships and reputation, resettable for the incidental, cosmetic traces allowed (S8-P4-16) |
| T-2 | **Closure or open threads** (map) | Every thread needs a stated end (THR-12) | A dystopian tone leaves things open, and dangling threads are an asset while enough live | Closure is a status (resolved, abandoned, transformed), not a resolution. Retire in steps with a closing trace |
| T-3 | **Promote on engagement or limit what is modelled** (map) | Promote what V returns to (GRW-01) | Watching engagement is player modelling and a retention engine | Count only returns made in play; local, legible, resettable; each gate visible in the record (GRW-09). No retention term (SES-04) |
| T-4 | **Scene wants or low-want texture** (map) | Want, obstacle and urgency (UNT-01) | Atmosphere and glances carry the city | The test starts at encounter. A glance needs one implied change with a recorded cause (UNT-06). Texture is flagged and bounded |
| T-5 | **A season or a sandbox** | A front gives weeks of play a shape (UNT-10) | A sandbox has an environment and no plot, and pace is V's | Seasons are optional, authored or grown from engaged arcs. Nothing else depends on one, and "off" sows none |
| T-6 | **Overlap or rest** | A new thread should start before the old one ends (THR-08) | Rest withholds our pushes (D7) | Baton traces are class 0 and cost salience, not pushes. The toy model says the effect is small |
| T-7 | **Honest clocks or an absent player** | A clock fires whether or not V attends (TIM-05) | A deadline that punishes someone who was elsewhere breeds resentment | The full clock changes the world and not V's progress. Tempo can slow clocks (SES-09). Fallout's second, overall deadline was dropped (F-02) |
| T-8 | **A good stopping point or a retention hook** | An end-worthy rest helps remembered quality (SES-03) | An engineered hook raises return and costs nothing visible (F-07) | Close the rest, never time a push to a quit, audit the objective (SES-04) |
| T-9 | **A visible large thing or perspectives** | V should be able to reconstruct the front (STR-02) | Each street knows only its own corner (STR-03) | Singly partial, jointly reconstructable. The media version is the outlet's belief and diverges by a tunable amount |
| T-10 | **A few anchors or a rich city** | Few promoted figures, done well (GRW-05) | A city of thin figures reads as dead | Seen and recurring are cheap and plentiful. Featured and central are few. Depth gates the rest |
| T-11 | **Tempo as a setting or a schedule that survives a reload** | The player sets the pace (SES-07) | A reload must show the same schedule (D7 DIR-09) | Nested thinning: the dial adds or removes slots and re-rolls none (SES-08) |
| T-12 | **A declared time budget or "V observed, never owned"** | A budget picks forms well (SES-05) | The engine must not infer V's circumstances | The budget is the player's own declared setting. It is never inferred, and it never forces an end |
| T-13 | **Count by life or by attention** | A cap on alive threads is simple | It refuses fast candidates for slow threads that are mostly out of view | Count attended (THR-03) |

## 7. Lateral links

- **Attended against alive** is a working set against a resident set in memory management: count what is in use, not what is allocated.
- **A promotion** is the foundation's Open operation, and a demotion is Close with the pins kept. The rungs are depths of opening.
- **The turn level** is the context chain read as a ladder: the level a unit turns is the vantage it is told from.
- **A street form** is a derived field (a map in the foundation's sense) sampled at a place and shown at the glance tier.
- **A front's clock** is a derived view of events (D9 R5-08) and a time-varying slot ([§6.3](../spec/kernel.md#63-time-varying-slots)), as dread clocks are in dossier 7.
- **The media version** is the belief of an outlet-actor. It is a pin in the believer and need not match the record (D-10).
- **Nested thinning** is the hashed draws of kernel §1.4 with a threshold. It is the same device as the Cassandra schedule in dossier 7 (DIR-09).
- **A short form's "abstract settlement"** is a summary that settles a thread in broad strokes (kernel §9.3). The time-limited game master's tip to move the conclusion to the party is a director move of class 3 when the venue is unobserved and class 4, forbidden, when V has already seen it (DIR-02).
- **The loose-end register** is the exposure ledger's other half: what V was shown against what the world still holds.
- **Settled completion** is dossier 9's lazy settlement. **Witnessed completion** is a summary opened at the fine tier near V.
- **A baton trace** is dossier 7's class-0 floor put to work during rest.

## 8. Open questions

1. **Does the 45-minute attended window match what V holds in mind?** A recall probe at 20, 45 and 90 minutes after a beat would give it. Occupancy moves by a factor of two across that range (§5.2).
2. **How many pushes does a real thread cost?** The toy model gives about 6. Real seeds will say, and the sustainable opening rate follows from it.
3. **How many engine threads do real players hold when they pull?** The toy model has no pulls. Telemetry from consented sessions answers it.
4. **Where do players quit, relative to climaxes and rest?** SES-03 depends on it (M8-13). The rule is dropped if quits do not cluster after climaxes.
5. **Is the scale-to-chain mapping stable on real quests?** Label the turn level of the seven decomposed gigs, of the main-story arcs the corpus holds and of a sample of hustles and street stories. Compare with the declared and with the McKee-style labels. This is the corpus test for UNT-03, using the existing decompositions and no new extraction.
6. **What counts as a return for a person in a street?** A scan, a repeated talk, a revisit of the stall? The feed offers different events at different costs (D7 PR-15).
7. **Can non-combat people be promoted by a trigger as vivid as defeat?** Shadow of War's trigger is vivid because it is a loss. Playtests must show whether "V paid, spared, warned or owed" does the same.
8. **Does a player want a season?** It is optional by design (UNT-10). Ask authors and testers whether a front's shape adds anything over arcs alone.
9. **What is the right media divergence base rate?** Too low and the media is wallpaper. Too high and it reads as lying. The investigation offers taken, by rate, would show it.
10. **Does a declared time budget get used, and does it help?** Offer it in a prototype and watch.
11. **Do cues beat no cues for resuming a thread?** L5 proposes it. Ghibellini and Meier's abstract says only that resumption is the reliable effect. A probe could test cued against uncued threads.
12. **How should slow fronts behave while V sleeps through game days?** D9's gentle option holds non-urgent fronts until V engages. Which fronts count as non-urgent is open.
13. **Where does a session end for the ledger across alt-tabs and reloads?** A load starts a session and a quit ends one. A very long pause is not a session boundary. Confirm against the play clock's pause rules (D7 open question 12, answered here as: both clocks stop, and rest timers do not elapse in a pause).
14. **What does dossier 11 need from this dossier?** The settling period, the re-situating cues, the session ledger, the loose-end register and the closure ledger. Dossier 11 owns what a returning player sees after weeks away.

## 9. Requirements for the seed language (P4)

What a seed, a front and the arbiter must be able to say. "Must" is a requirement and "should" a default the harness may change with evidence. Each requirement names the [P4](../p4-seeding-layer.md) section it **extends** or **challenges**, and the principles it traces to. Comparisons with outside systems are never sources of the engine's concepts (D-21).

| # | Requirement | P4 section | Traces to |
|---|---|---|---|
| S8-P4-01 | **Level labels cover the whole range.** `level` takes glance, encounter, vignette, gig, arc, season, with `phrase`, `exchange` and `beat` as fragment sub-levels. P4 §3.1 lists phrase, exchange, beat, encounter, job, arc, which has no glance and no season, and dossier 5's SL-1 lists a different set. The label is *checked* against the declared turn level and span, and never switches a rule (QST-07) | **Challenges** §3.1 | UNT-03, §5.1 |
| S8-P4-02 | **A `turns` declaration.** Each seed above glance level declares the recorded changes that complete it (a frame status, a pin, a tie rung, a standing), each with its context-chain level (situation, step, goal, concern, drive or standing). The lint rejects a parent whose turn sits below a child's and an empty `turns` | **Extends** §3.1 intent (end state) | UNT-02, UNT-03 |
| S8-P4-03 | **A thread is a view.** The language has no `thread` type or field. Threads are computed from parent, shared role or frame, and promise entries. The one-fragment-type rule holds at season level (a season is a seed whose children are arcs) | **Supports** §3.6 | THR-01 |
| S8-P4-04 | **One sense of "beat".** The glossary of S2 states that a P4 `beat` is a fragment with at least one `leaves` fact, and that McKee's beat, an action and its reaction, is an `exchange`. A `beat` with no `leaves` is a lint error | **Extends** §3.1, §3.6 | UNT-02, map NAR-16 |
| S8-P4-05 | **`effect` and `implies`.** Vignette-size seeds carry one `effect` tag from the closed tone vocabulary, and callbacks must sit after it in the graph. Glance fragments carry exactly one `implies`, and their `needs` is a recorded fact or a labelled `constructed` cause inside latitude | **Extends** §3.6 | UNT-06, UNT-07 |
| S8-P4-06 | **Scale forms with durations and drops.** Short, standard and full forms each declare `min_duration`, and a short form declares `drops` (texture, legwork, a second approach). A form that drops the decision beat or the aftermath is refused. An `abstract` form settles a thread in broad strokes, with notice, for a time budget that cannot fit it | **Extends** §3.6 (scale forms, SL-13) | SES-05, SES-06 |
| S8-P4-07 | **The timing request names its form inputs.** The arbiter chooses a form from V's engagement flag, V's declared time budget (optional, player-set, never inferred) and the tempo setting. The request carries the beat interval derived from the seed's clock and beat count, not an authored tempo switch | **Extends** §3.10 | SES-05, THR-06 |
| S8-P4-08 | **No new lifecycle state.** Attention (attended, simmering, dormant) is derived from last-beat and last-cue times. Leaving the attended set needs no transition. Reaching `resolved` or `withered` must write a **closing trace** and a closure status (resolved, abandoned or transformed). P4's `withered` says only that a close form played | **Extends** §4.4 | THR-12 |
| S8-P4-09 | **A loose-end register.** On `resolved` or `withered` a seed writes `loose_ends`: consequence edges not yet consumed, people whose frames it changed, and promises retired. It is a record, not a new seed | **Extends** §3.6 (promise ledger, aftermath) and §4.6 | GRW-07, UNT-08 |
| S8-P4-10 | **A `grows-from` link.** A child seed records the loose end, promotion event or parent that produced it. An arc has at least two found ancestors, or is authored. Provenance reads through the link | **Extends** §3.1 (parent, children) | GRW-07 |
| S8-P4-11 | **The rung is a slot on the subject.** `rung` (seen, recurring, featured, central) is a pinned slot with a reason and a source. An author's rung is a floor the engine never lowers. Changes are contributions, an Open plus a frame, and the subject's identity never changes | **Extends** §2 (pins and contributions) | GRW-02, GRW-11 |
| S8-P4-12 | **A clock construct.** Segments (4, 6 or 8 by obstacle), tick sources as events, a visible sign per segment, and a form for each way it can end. A window may be relative to a clock segment or to a parent's phase. The clock is a derived view of events and nothing ticks | **Extends** §3.5 (windows) | TIM-05 |
| S8-P4-13 | **`projections` on a front.** Per clock segment, the street forms the front throws down, as contributions on the districts' fields, as glance fragments and as media items, with a channel ladder and a distance band (distal, proximal, imminent) for each | **Challenges** §3.3 and §3.6: nothing says how a high-level seed appears below | STR-01, STR-04 |
| S8-P4-14 | **Street forms are ordinary glance fragments** with an `ask` affordance (the handle) that opens the next fragment. A form has no special type. The lint requires a path of at most two steps from a form to an offer or a why-trace | **Supports** §3.6 | STR-08 |
| S8-P4-15 | **A `baton` purpose.** The closed purpose vocabulary (introduce, escalate, rest cue, callback, close) gains `baton`: a class-0 disclosure of the next thread during rest | **Extends** §3.10 | THR-08 |
| S8-P4-16 | **A persistence class on every effect.** Lasting (relationship, reputation, standing), resettable (the incidental) or cosmetic (a mark on a wall). The default is lasting for effects on ties and standing | **Extends** §3.4 (declared effects) | T-1, UNT-12 |
| S8-P4-17 | **Witnessed and settled completion write one record.** The outcome has a `witnessed` flag. A settled outcome reaches V as news at a joint, through the exposure ledger | **Extends** §4.6 | UNT-11 |
| S8-P4-18 | **A brief that stands alone.** The lint requires client, stake and ask in a brief without reference to earlier events. Callbacks are additive and flagged `across` | **Extends** §3.1 (unity) and §3.7 | UNT-12 |
| S8-P4-19 | **Tempo as contributions.** Tempo multipliers (clock speed, lead times, promotion thresholds, opening rate) scale a seed's parameters as contributions. Schedule slots are hashed draws at the highest tempo, active when the draw falls under the dial's threshold, so the dial positions are nested. Tempo never changes a unit's strength | **Extends** §4.7 (tempo scales the arbiter's cadence) | SES-07, SES-08 |
| S8-P4-20 | **Arbiter session states and ledger.** Settling, re-situating (one cue per changed dimension, then one cue to the last attended thread), away and rest-with-closure are arbiter states. Every session writes a plain, local ledger | **Extends** §4.7 | SES-01, SES-03, SES-10 |
| S8-P4-21 | **A `front` profile** for sustained, multi-session pressure: clocks, 3 to 5 portents for a campaign-scale front, an impending outcome that is not world-ending, stakes questions, a landmark, a local cost, a sign set, `projections`, and an end-state predicate over city facts. It is data, as the gig and ladder profiles are | **Extends** §3.8 (profiles) | UNT-10, STR-01 to STR-06 |
| S8-P4-22 | **Lint for this dossier:** a turn below a child's; an empty `turns`; a front with no landmark, no local cost, no sign set or no street form in two channel kinds; a glance with two implications or no backing; a clock with no perceivable source; closure with no closing trace; a short form that drops the decision beat; an unmarked open promise at close; a brief that needs earlier events; an arc with fewer than two found ancestors and no author | **Extends** §4.8 | all of the above |

## 10. Requirements for the procedural engine (P5)

What sowing, fitting and the director must do, and what they need from the kernel and the seed language. The roles and limits of dossier 7 (PR-1 to PR-47) stand, and these add to them.

**Threads**

| # | Requirement | Traces to |
|---|---|---|
| S8-P5-01 | Threads are views over the record. The attended set is computed from last-beat and last-cue times in play time, with a window of 45 play-minutes at first. The window is data | THR-01, THR-03 |
| S8-P5-02 | The budgets of dossier 7 PR-32 (4 attended, 2 live, 1 climactic, 8 simmering) count the attended set. Authored, fitted and V-pulled threads count against them. No per-tempo sub-caps are added until M8-02 shows fast threads starving | THR-03, THR-04 |
| S8-P5-03 | Sowing submits thread openings at a rate the push budget supports. The toy model puts it near 0.5 openings an hour at about 6 pushes a thread. The queue-arrival limit of dossier 7 PR-26 applies | THR-04 |
| S8-P5-04 | The lead thread is the one with the highest relevance to V's active frames, weighted by the recency of V's own acts. At most three threads advance in a play-hour and the lead takes at least half the beats. No term reads V's inferred drives | THR-02, THR-10 |
| S8-P5-05 | Composition rules: at most one climactic thread, at most one hostile thread at imminent or contact, and a mix of tempos and tones in the attended set | THR-05 |
| S8-P5-06 | Each thread's tempo class and beat interval come from its clock length and beat count, and set the request's cadence | THR-06 |
| S8-P5-07 | A scheduler item per thread keeps last-beat and last-cue. A simmering thread with no cue for 8 play-hours or 3 sessions is retired. When V-aware, unattended threads exceed 8, sowing yields. It never forces a closure | THR-07 |
| S8-P5-08 | A baton request (class 0, from the best-pulled simmering thread) may be placed during rest. It costs district salience and no push | THR-08 |
| S8-P5-09 | Fitting scores shared role, place or consequence between threads and flags a thread that touches no other. A coincidence not in the record is barred | THR-09 |
| S8-P5-10 | Overflow order: merge, queue, then withdraw the lowest-pull thread the engine sowed, with a closing trace. A thread V pulled is simmered and never dropped | THR-11 |
| S8-P5-11 | Retirement runs attended, simmering, dormant (pins kept), closed, with a closing trace and a status of resolved, abandoned or transformed. A thread V never saw closes silently | THR-12 |

**Units, glances and completion**

| # | Requirement | Traces to |
|---|---|---|
| S8-P5-12 | A completion detector diffs the record from a seed's start to its end against its `turns`. An empty diff is a logged non-event. Each completion carries `witnessed` and writes the same outcome record either way | UNT-02, UNT-08, UNT-11 |
| S8-P5-13 | Units that lack a frame, a stake or a window cause are tagged texture. The texture share is tracked. No more than two texture beats in a row inside a gig | UNT-01 |
| S8-P5-14 | A glance is generated from a record fact, or from a labelled `constructed` cause inside latitude, with one `implies`. Its state is a function of the record at the time of sighting. A second sighting differs only as the record differs | UNT-06 |
| S8-P5-15 | Arc and season completion run on ledgers: promises closed, a visible step per live session, a reconciliation ledger with no child in running or simmering, and a closure entry. Seasons are sown only from engaged arcs or authored. At "off" none are sown | UNT-09, UNT-10 |
| S8-P5-16 | A scale label is computed for every played unit from the highest context-chain level it changed. The harness compares it with the declared level | UNT-03, §8 |

**Growth**

| # | Requirement | Traces to |
|---|---|---|
| S8-P5-17 | Return and outcome counters live on subjects, built from observed events only. They are local, readable in the opt-in record, resettable, and never exported | GRW-01, GRW-09 |
| S8-P5-18 | A promotion needs a gate met, a cause event, and depth ready. A refusal for no depth is logged. Rung caps per district: central 1, featured 3, recurring 8. An author's rung is a floor | GRW-02 to GRW-05, GRW-11 |
| S8-P5-19 | Demotion after 10 play-hours with no return and no live clock. Pins are kept and a closing trace is shown | GRW-08 |
| S8-P5-20 | Sowing proposes child seeds from loose-end registers, ranked by V's return counts. An arc has at least two found ancestors. Generated seeds never hold roles on the spine | GRW-07, GRW-12 |
| S8-P5-21 | Pull share is measured. When pushed threads exceed pulled over a play-hour, sowing yields | GRW-06 |
| S8-P5-22 | Promoted figures' threads are sown from their own frames. Shape features separate across promotions | GRW-10 |

**The street**

| # | Requirement | Traces to |
|---|---|---|
| S8-P5-23 | A projection engine turns a front's clock segment into street forms for the districts and tiers V is near. Strength follows travel-time and social distance. Forms reuse the front's sign set and stay inside a per-district salience budget | STR-01, STR-04, STR-06, STR-07 |
| S8-P5-24 | Outlets are actors with their own beliefs. A media item is the outlet's belief. The divergence rate from the record is a tunable. Each street form is produced from its speaker's own beliefs (`knows`) | STR-02, STR-03 |
| S8-P5-25 | Fronts above arc scale are refused without a landmark and a local cost, and every form has a handle within two steps of an offer or a why-trace | STR-05, STR-08 |

**Time and session**

| # | Requirement | Traces to |
|---|---|---|
| S8-P5-26 | Events carry play-time and game-time stamps, and a telling carries `shown_at`. No telling puts an effect before its cause in the record. Aftermath-first needs a cause path V can reach. No flashback or recap asserts V's act without an observed pin | TIM-01, TIM-02, TIM-06 |
| S8-P5-27 | Repeated events settle as iterative summaries. A third repeat becomes a pattern line. Scene telling is reserved for what V is present for | TIM-03 |
| S8-P5-28 | After a jump (sleep, wait, fast travel, load) the first class-0 or class-1 content carries one cue per changed dimension | TIM-04 |
| S8-P5-29 | Clocks are derived views of events, sized by obstacle, with a perceivable source. A deadline shorter than a play-hour carries a warning | TIM-05 |
| S8-P5-30 | Session opening: settle, one re-situating cue, one cue to the last attended thread or one class-0 hook, with no class 3 or 4 push. The rest after a climax starts with a closure beat. A static audit finds no director term that reads session length, time since load or a quit proxy | SES-01 to SES-04 |
| S8-P5-31 | An optional, player-declared time budget feeds form choice. No thread whose shortest form exceeds the remainder is offered unless V pulls it. The budget never forces an end | SES-05, SES-06 |
| S8-P5-32 | The tempo bundle of §5.5 is data. Slots are hashed draws at the highest tempo and thinned by a threshold, so positions are nested. A change takes effect at the next window boundary and never mid-beat. The hard gates never move. "Off" means pull only, plus fitting of authored seeds. The first hour is gentler | SES-07 to SES-09 |
| S8-P5-33 | Pause and photo mode stop the play clock and game time together. Rest timers do not elapse in a pause. A load starts a new session and a quit ends one | D7 PR-9, open question 13 |

**Tests and logs**

| # | Requirement | Traces to |
|---|---|---|
| S8-P5-34 | Every session writes a local ledger from which the harness computes M8-01 to M8-16 without running the engine | SES-10, §5.6 |
| S8-P5-35 | Switches select arms for the harness: with and without baton; with and without promotion; with and without street projections; the three arms of dossier 7 (PR-46). Ratings are blind. Null results are reported as results | THR-08, GRW-01, STR-01 |

**Interfaces other plans owe**

- **P4 (seed language).** The items of §9, chiefly the level labels, `turns`, the front profile with clocks and projections, the loose-end register, the rung slot, scale forms with durations and drops, persistence classes and the session states.
- **P3 and S0 (simulation and kernel).** A rung slot and return counters held on subjects; summaries usable as iterative telling; a `shown_at` stamp beside the two clocks; derived fields at district level for projections.
- **P8 and the game port.** The channels for street forms and media items, the events that count as a return (§8, question 6), and plain reporting of unavailable channels.
- **P9 (evaluation).** M8-01 to M8-16, the corpus test for the scale mapping, the blind arms, and consented probes for recall, quit points and re-situating.
- **Dossier 11.** The settling period, the re-situating cues, the session ledger, the loose-end register and the closure ledger.

## Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give. Event cognition (PER-02), sandbox play (CRA-18), queueing (PAC-06), peak-end (PER-04) and open loops (PAC-09) are on the map and are not repeated here.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Time-boxed play and player-declared time budgets.** Pruning towards a conclusion, framing scenes late, and resolving the rest in broad strokes when time is short | Alexandrian, "GMing on a Time Limit", 21 Feb 2026 (read) | Supporting. It shapes scale forms and a player setting |
| MM-2 | **Stable schedules under a changing setting** (nested thinning of a hashed schedule) | Standard probability, from memory. No game source found | Supporting, under PAC-04 and SAV-02 |
| MM-3 | **Session boundaries and stopping points in digital games.** Natural stopping points, and whether a design should make them | Alexandrian, "Open Table Manifesto, Part 3" (read). A magazine interview with Adam Alter and a forum thread appear in search results and I did not read them. I found no experiment | Supporting. Core for the session rule in P5. Evidence is thin |
| MM-4 | **How many threads and characters an audience can follow over hours and weeks** | Cowan 2001 for a lab limit only. Mittell's comprehension chapter (abstract only). No study of long-form tracking found | Supporting. A source is needed |
| MM-5 | **Pace and game-speed settings as a design pattern** (slowing the whole game, scaling durations) | Game Accessibility Guidelines (read). Civilization's speeds from fan pages | Supporting, adjacent to ETH-19 |
| MM-6 | **Computational use of Genette's categories in interactive fiction** | A PDF on the author's own site applying order, speed and frequency to interactive fiction appeared in a search and could not be read here | Supporting, under NAR-17. Unread |
| MM-7 | **Admission control by attended count** (occupancy of a human attention budget, as against queue length) | The toy model of §5.2, with the standard queueing result from memory | Peripheral, an extension of PAC-06 |

## Credit candidates

Each third-party work that taught us something used in the principles above. "opened" means I opened the page this session. "indexed" means I saw it only in search results or through a secondary account. Creator names are as the page shows them.

| Creator as evidenced | Work | Link | What we learned | Link status |
|---|---|---|---|---|
| David Mamet (as reproduced by David Chen, SlashFilm, 23 Mar 2010) | Memo to the writers of *The Unit*, dated 19 Oct 2005 | https://www.slashfilm.com/a-letter-from-david-mamet-to-the-writers-of-the-unit/ | Test every scene by who wants what, what happens if they do not get it, and why now | opened |
| Justin Alexander | "Open Table Manifesto, Part 3: Organizing Your Open Table", 22 Aug 2016 | https://thealexandrian.net/wordpress/38669/roleplaying-games/open-table-manifesto-part-3-organizing-your-open-table | In an open table, sessions end with characters back at base, which is a calendar tool and not a rule for a game with no visible end | opened |
| Justin Alexander | "Random GM Tip: GMing on a Time Limit", 21 Feb 2026 | https://thealexandrian.net/wordpress/53333/roleplaying-games/random-gm-tip-gming-on-a-time-limit | Prune towards the conclusion, frame scenes late, and resolve in broad strokes if the end is out of reach | opened |
| Ben Robbins | "West Marches: Grand Experiment", Ars Ludi, 17 Oct 2007 | https://arsludi.lamemage.com/index.php/78/west-marches-grand-experiment/ | A campaign can have an environment and no overarching plot, with continuity in a shared record | opened (first part) |
| Sly Flourish | "Starting Strong" | https://slyflourish.com/starting_strong.html | A strong start brings players from real life into the fiction | opened |
| Koebel and LaTorra (*Dungeon World*), via the Roll20 compendium | Fronts | https://roll20.net/compendium/dw/Fronts | Campaign and adventure fronts differ in span, a front has 3 to 5 grim portents at campaign scale, and a few fronts at once is enough | opened |
| John Harper (*Blades in the Dark*), via the Roll20 compendium | Progress clocks | https://roll20.net/compendium/BITD/Progress%20clocks | Clock size follows the obstacle, danger clocks tick by complication, and clocks can race or tug | opened (entry exists) |
| Philippa Burne, The Conversation | "Inside the story: the ABC of screenwriting as demonstrated by ABC's The Heights", 23 May 2019 | https://theconversation.com/inside-the-story-the-abc-of-screenwriting-as-demonstrated-by-abcs-the-heights-115854 | A, B and C stories differ in weight and tone, and writers plan where they intersect | opened |
| Brandon Sanderson | 2025 plot lecture write-up | https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2 | Progress sustains attention, small problems add up to the large one, and sparse signposts lose readers | opened (entry listed in dossier 4) |
| Michael de Plater (interview, GamesBeat, 9 Feb 2015) | "Shadow of Mordor's Nemesis system draws from Burnout, football, and an architecture book" | https://gamesbeat.com/shadow-of-mordors-nemesis-system-draws-from-burnout-football-and-an-architecture-book/ | Generate detail at a few peak moments, let the player fill the gaps | opened |
| Basilio Bazan III | "Core System Analysis of Middle-Earth: Shadow of War", Game Developer, 7 May 2020 | https://www.gamedeveloper.com/design/core-system-analysis-of-middle-earth-shadow-of-war | Promotion by a notable outcome through ranks, with detail given to each captain | opened |
| Don Carson | "Environmental Storytelling: Creating Immersive 3D Worlds Using Lessons Learned from the Theme Park Industry", Game Developer, 2000 | https://www.gamedeveloper.com/design/environmental-storytelling-creating-immersive-3d-worlds-using-lessons-learned-from-the-theme-park-industry | Story told through cause-and-effect traces that visitors read, with rules kept consistent | opened |
| Katherine Schibler, Lindsay Hahn and Melanie C. Green | "Investigating Responses to Narrative Cliffhangers Using Affective Disposition Theory", *Media Psychology* 27(1), 2024 | https://researchconnect.buffalo.edu/en/publications/investigating-responses-to-narrative-cliffhangers-using-affective/ | A cliffhanger raised wanting a next instalment and left enjoyment unchanged, so it is a retention tool and not a story one | opened (record) |
| Ghibellini and Meier | Review of the Zeigarnik and Ovsiankina effects, *Humanities and Social Sciences Communications* 12, 2025 | https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05000-w.html | No memory advantage for unfinished tasks, and a tendency to resume them | opened (abstract) |
| Dustin Bailey (PCGamesN), reporting Mike Zadorojny | "Guild Wars 2 Season 1 'is always on our mind,' but it was built to 'fire and forget'", 14 Sep 2019 | https://www.pcgamesn.com/guild-wars-2/season-1 | A seasonal story overwritten by later teams cannot be reactivated, and newcomers cannot play it | opened |
| Game Accessibility Guidelines contributors | "Include an option to adjust the game speed" | https://gameaccessibilityguidelines.com/include-an-option-to-adjust-the-game-speed/ | A speed option helps motor and cognitive access | opened (entry exists) |
| Zwaan, Langston and Graesser | "The construction of situation models in narrative comprehension: an event-indexing model", *Psychological Science* 6(5), 1995 | https://narrativestudies.lib.unb.ca/bibcite/reference/18821 | Readers track time, space, protagonist, causation and intention, and shifts prompt updating | indexed |
| Fredrickson and Kahneman | "Duration neglect in retrospective evaluations of affective episodes", *Journal of Personality and Social Psychology* 65, 1993 | https://bear.warrington.ufl.edu/brenner/mar7588/Papers/fredr-kahneman-jpsp1993.pdf | Judgement of an episode follows its peak and its end, and length counts for little | indexed |
| Nelson Cowan | "The magical number 4 in short-term memory", *Behavioral and Brain Sciences* 24, 2001 | https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/magical-number-4-in-shortterm-memory-a-reconsideration-of-mental-storage-capacity/44023F1147D4A1D44BDC0AD226838496 | A limit of about four chunks in the focus of attention, contested | indexed |
| Harvey Smith and Matthias Worch | "What Happened Here? Environmental Narrative", GDC 2010 | https://gdcvault.com/play/1012647/What-Happened-Here-Environmental | Staging space so that players assemble what happened | indexed |
| Edgar Allan Poe; Scott McCloud; Ernest Hemingway; Gérard Genette; Kevin Lynch; Jason Mittell; Robert McKee | The works named in the map's rows | listed in [map.md](map.md) | The unity-of-effect, closure, iceberg, order and duration, legibility, serial and ladder ideas used as vocabulary | **Not credit-ready**: read only through summaries, excerpts or abstracts |
