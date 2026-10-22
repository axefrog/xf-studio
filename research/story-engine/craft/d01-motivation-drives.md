# Dossier 1: motivation, drives and goals

**Status:** v1 draft, 22 October 2026. Phase C of the [research method](../p1-research-method.md). Fields: core SET-03, SYS-08, SYS-25, SYS-21; supporting SYS-22; plus the person-level motivation and attribution gaps named in the [map](map.md#3-gaps-and-tensions). It replaces the draft drive catalogue in [foundation §5.1](../foundation.md#51-drives-what-governs-relevance) with **catalogue v1** (section 8), and supplies the policies the kernel leaves to S1 ([kernel §0.1](../spec/kernel.md#01-what-the-kernel-is), [§10.1](../spec/kernel.md#101-drives)).

## Reader's guide

| You want | Go to |
|---|---|
| The table that could become data | [8. Catalogue v1](#8-catalogue-v1-individual-drives) (tables 8.3 to 8.6) and [9. Urgency models](#9-urgency-models) |
| How importance differs between people, archetypes and groups | [10. Importance](#10-importance-people-archetypes-and-circumstances), [11. Groups](#11-drives-of-groups) |
| Director and seed drives | [12. The director and seeds](#12-the-director-and-seeds) |
| Drive to concern to goal | [13. From drive to concern to goal](#13-from-drive-to-concern-to-goal) |
| Night City's own pressures | [14. Night City's pressures](#14-night-citys-pressures) |
| What is solid and what is judgement | the **Support** columns in section 8, and the grade on each principle in section 3 |

## What changed from the draft, in short

- **No ladder.** The draft's ten families stay, but needs do not unlock upwards. Weight is importance times a function of urgency, with a floor that depends on whether the drive is a deficit or a growth drive ([DRV-01](#a-what-drives-exist-and-how-they-relate), [DRV-12](#c-urgency)).
- **Importance and urgency are different kinds of thing.** Importance is slow, structured and mostly about the person (values, role, circumstance). Urgency is fast and mostly about the world (time since satisfied, a due date, a ratio, a threat's nearness). The draft blurred them.
- **Urgency is derived, not ticked.** It is a pure function of timestamped facts. A ticked counter would stall under the kernel's 1/64 quantum ([DRV-12](#c-urgency)).
- **39 drives in 10 families,** each with an urgency model, magnitudes, satisfier and threat kinds, a horizon, a scope and an importance prior. Four have no counterpart in the draft (`comfort`, `mastery`, `serenity`, `roots`), several split or rename draft items, and two draft items are not drives: fear (the signal of a threat) and facing mortality (a horizon change) ([8.2](#82-what-moved-from-the-draft)).
- **Mortality is a horizon, not a drive.** The mortality-salience literature does not hold up. What does hold is that a shorter perceived future reweights goals ([DRV-09, DRV-10](#b-importance)).
- **Concerns come from seven generators,** not only from rising urgency, and goals are chosen with commitment and inertia, because drive-only action selection dithers ([DRV-22 to DRV-34](#d-concerns-and-goals)).
- **Groups' drives are computed from what they spend and hold, not from what they say they are for** ([DRV-35](#e-groups)).

## How to read the grades

Principles carry the grades of [P1 §4](../p1-research-method.md#4-evidence-grades-for-craft-knowledge): **[empirical]**, **[practice]**, **[shipped]**, **[corpus]**, **[analysis]**, **[hypothesis]**. A principle that is contested between sources says so.

The catalogue uses a three-letter **Support** code, one letter each for *existence* of the drive, the *form* of its urgency model, and its *numbers*:

| Letter | Meaning |
|---|---|
| **S** | Well supported: at least two independent sources, or one strong empirical source |
| **P** | Partly supported: one source, a source with known critiques, or support for the shape but not the size |
| **J** | Judgement: our inference, chosen to be plausible and testable. Every number marked J is a starting value for the calibration fixtures, not a finding |

No magnitude in this dossier is better than **P**, and almost all are **J**. That is deliberate: the sources support shapes (saturating curves, ramps to a deadline, latching), not Night City constants.

How each source was read is in section 2. A claim resting on a search summary or an abstract only is marked in the source table, and where it matters in the text.

---

## 1. Scope and why it matters here

Everything the engine does about people starts from what they want. This dossier covers four things: **what makes anything matter to an actor** (the drives), **how much** it matters (importance and urgency), **how wants turn into particular concerns and goals**, and **how groups and the engine's own actors want things** (the groups, director and seeds that the foundation says have drives too). It also covers how one actor *reads* another's wants (attribution), because every belief about a motive is a belief about a drive.

It informs these parts of the [plan](../plan.md#2-the-system-at-first-level):

| Layer or concern | What this dossier gives it |
|---|---|
| **1. Simulation** (S1, [P3](../plan.md#5-second-level-plans)) | The drive catalogue as data; the urgency policies the kernel hands to S1 (`core:drive-state` windows, [kernel §10.1](../spec/kernel.md#101-drives)); attribution and group-decision policies; the horizon and importance generators |
| **2. Seeding** ([P4](../plan.md#5-second-level-plans)) | Seeds as actors: their drives and urgency; the vocabulary in which a seed states what it needs |
| **3. Procedural engine** ([P5](../plan.md#5-second-level-plans)) | Hooks from blocked contexts (a gig is someone's blocked concern that V can unblock, [DS-56](../design-seeds.md)); the director's own drives; how fitting reads concerns |
| **4. Authored content** (P6) | A shared vocabulary for authors to state a character's wants, with the Lifepath fields as an authoring schema |
| Expression | Making a motive legible in a line or a gesture (cross-link to PER-10) |
| Evaluation | Checks that every encounter has a traceable "because", and that archetype priors carry no demographic bias |
| Tooling | Every concern and goal records its origin, so "why is this person here?" can be answered |

**What it does not cover.** Group decision procedures in full (that is S1), reputation and trust inference (dossier 15), relationship variables (REL-02, left to its own dossier), and the player's own motivation (MOT-01). They are cross-referenced where they touch.

**Ground rules from the foundation that bind this dossier.** V is observed, never owned ([D-09](../decisions.md)): the catalogue is a *vocabulary* the engine may hold beliefs in, and it never pins V's drives. Everyone has their own model ([D-10](../decisions.md)): a drive belongs to the actor who has it, and other actors hold only beliefs about it. Groups are actors ([D-08](../decisions.md)). The engine's concepts here (context, relevance, frames, groups, perspectives) are the project's own; outside work appears only as comparison or as evidence about people ([D-21](../decisions.md)).

---

## 2. Sources

"Read" says how far I got: **full** (read the relevant text of the primary source), **part** (read parts of the primary source), **abstract** (abstract or publisher page), **summary** (a search summary only, so any claim about its findings is second-hand) and **memory** (not re-read this session; treat as a pointer). Where a lens flagged a claim `[sec]` or `[mem]`, I either checked it (noted at the end of this section) or kept the flag.

### 2.1 Motivation, needs and values

| Source | What it is | Used for | Read | Credit |
|---|---|---|---|---|
| Maslow 1943, "A Theory of Human Motivation", *Psychological Review* 50 | The original hierarchy paper | The thing being critiqued. The original is less rigid than the textbook pyramid | memory | candidate |
| Wahba & Bridwell 1976, "Maslow reconsidered", *Organizational Behavior and Human Performance* | Review of the empirical record on the hierarchy | Little consistent support for the ordering or the gratification-activation claim | summary | candidate |
| Kenrick, Griskevicius, Neuberg & Schaller 2010, "Renovating the pyramid of needs", *Perspectives on Psychological Science* 5(3) | Evolutionary revision of the pyramid | Motives overlap rather than replace; affiliation split; self-actualization dropped; the three levels of analysis Maslow conflated | part (about half the text) | candidate |
| Tay & Diener 2011, "Needs and subjective well-being around the world", *JPSP* 101 | 123-country survey | Need fulfilment relates to wellbeing largely independently, not in Maslow's order | summary | candidate |
| Reiss 2004, "Multifaceted nature of intrinsic motivation: the theory of 16 basic desires", *Review of General Psychology* 8; Ohio State release on the underlying studies | Psychometric theory | Sixteen largely unrelated desires, including vengeance and honour; people differ by profile. 2,500 people, then 3,500 more, in factor analyses, per the release | abstract | candidate |
| Ryan & Deci 2000, *American Psychologist* 55; Vansteenkiste & Ryan 2013 | Self-determination theory | Autonomy, competence, relatedness; satisfaction versus active frustration | abstract, summary | candidate |
| Sheldon, Elliot, Kim & Kasser 2001, "What is satisfying about satisfying events?", *JPSP* 80 | Three studies, US and South Korean students | Autonomy, competence, relatedness and self-esteem rank top; popularity and money-luxury rank bottom | summary | candidate |
| Schwartz 2012, "An overview of the Schwartz theory of basic values", *Online Readings in Psychology and Culture* 2(1); Schwartz et al. 2012, *JPSP* (19 refined values) | Values theory, 82 countries | Ten values in a circle, two bipolar dimensions; the refinement tested in 15 samples from 10 countries | abstract, summary | candidate |
| Fiske 2004, *Social Beings* | Core social motives text | Belonging, understanding, controlling, enhancing self, trusting | summary | candidate |
| Fiske 1992, relational models theory (via the Internet Encyclopedia of Philosophy page) | Four elementary forms of sociality | What obligations a tie carries | summary | candidate |
| Baumeister & Leary 1995, "The need to belong", *Psychological Bulletin* 117 | Review | Belonging as a pervasive motive; lack linked to poor health and adjustment | abstract | candidate |
| Anderson, Hildreth & Howland 2015, "Is the desire for status a fundamental human motive?", *Psychological Bulletin* 141 | Review | Status as fundamental; respect and voluntary deference | summary | candidate |
| Parks-Leduc, Feldman & Bardi 2015, *Personality and Social Psychology Review* 19 | Meta-analysis, 60 studies | Traits and values are linked but distinct | summary | candidate |
| Bardi & Goodwin 2011, *Journal of Cross-Cultural Psychology* 42 | Model of value change | Values change by two routes, automatic and effortful | abstract | candidate |
| DeYoung 2015, "Cybernetic Big Five Theory", *Journal of Research in Personality* 56 | Personality theory | Traits as parameters of goal-directed control; goals and strategies as characteristic adaptations | abstract | candidate |
| Carstensen, Isaacowitz & Charles 1999, *American Psychologist* 54; Carstensen 2006, *Science* | Socioemotional selectivity theory | A shorter sense of future time shifts weight to emotionally meaningful goals; contested | summary | candidate |
| Griskevicius, Delton, Robertson & Tybur 2011, *JPSP* 100; Pepper & Nettle 2017, *Behavioral and Brain Sciences* 40 | Life-history work | Mortality cues push reproductive timing earlier for those raised poor and later for those raised well off; deprivation and present-orientation; critics exist | abstract, summary | candidate |
| Klein et al. 2022, Many Labs 4, *Collabra* | Preregistered multi-lab replication | Mortality salience did not replicate (21 labs, 2,220 participants); a reanalysis from the original side disputes the reading | summary | candidate |
| Gal & Rucker 2018, "The loss of loss aversion", *Journal of Consumer Psychology* 28 | Critical review | Evidence does not show losses outweigh gains in general | abstract | candidate |

### 2.2 Urgency, drives and action selection

| Source | What it is | Used for | Read | Credit |
|---|---|---|---|---|
| Daan, Beersma & Borbély 1984, *American Journal of Physiology* 246 | The two-process model of sleep | Saturating build-up, faster decline, circadian gating. Time constants from Rusterholz, Dürr & Achermann 2010 as relayed by a search summary: build-up 14.1 to 26.4 h, decline 1.2 to 2.9 h | summary | candidate |
| Tomova et al. 2020, *Nature Neuroscience* 23 | fMRI, 40 adults | 10 hours of isolation produced social craving responses like those after fasting | abstract | candidate |
| Kivetz, Urminsky & Zheng 2006, *Journal of Marketing Research* 43 | Field and lab study | People accelerate towards a reward (goal-gradient), including on illusory progress | abstract | candidate |
| Miller 1944, "Experimental studies of conflict" (and Boyd, Robinson & Fetterman 2011, "Miller (1944) revisited") | Classic animal conflict work and a human replication | Avoidance gradient steeper than approach | summary | candidate |
| Robinson & Berridge 1993 (as reviewed in 2024, "30 years on"); Solomon & Corbit 1974 | Addiction theories | Wanting separates from liking; cues trigger wanting; opponent-process alternative | summary (review), memory | candidate (Berridge); memory only for Solomon & Corbit |
| McCullough, Kurzban & Tabak 2013, "Cognitive systems for revenge and forgiveness", *Behavioral and Brain Sciences* 36 | Target article | Revenge as a deterrence system; forgiveness depends on the relationship's expected value | abstract | candidate |
| Nisbett & Cohen 1996, *Culture of Honor* | Experimental and historical work | Insult response and hormone rises differ by honour culture; the authors' reading is contested | summary | candidate |
| Richardson, Elliott & Roberts 2013, *Clinical Psychology Review* 33 | Meta-analysis, 65 papers | Debt strongly associated with mental disorder (OR 3.24), depression (2.77), drug dependence (8.57), suicide completion (7.9); causation unestablished | abstract | candidate |
| Blumberg 1996, *Old Tricks, New Dogs: Ethology and Interactive Creatures* (MIT PhD) | Thesis on action selection for synthetic creatures | Persistence, mutual inhibition, level of interest, time-sharing | part | candidate |
| Tyrrell 1993, *Computational Mechanisms for Action Selection* (Edinburgh PhD) | Thesis | Compared the drive model, Lorenz's hydraulic model and Maes's network in a simulated environment and found shortcomings | abstract | candidate |
| Forbus & Wright 2001, "Some notes on programming objects in The Sims" | Maxis tool notes | The nine needs, objects that advertise to needs, personality-scaled effects | part | already credited (Maxis) |
| RimWorld wiki, "Needs" | Community documentation | Needs list, mood thresholds | full | already credited (Sylvester, Ludeon) |
| Dwarf Fortress wiki, "Need" (via search summaries) | Community documentation | Needs derived from beliefs and personality; focus lost when needs go unmet | summary | already credited (Adams) |
| Booth 2009, "The AI Systems of Left 4 Dead" (Valve slides) | Developer talk | Intensity estimate, build up, sustain peak, peak fade, relax | part | already credited (Valve, Booth) |
| GamesBeat 2010, "Dimming the Radiant AI in Oblivion" (via L2) | Developer account | Autonomy ate authored content | via L2 | already credited (Bethesda) |

### 2.3 Concerns, goals and action

| Source | What it is | Used for | Read | Credit |
|---|---|---|---|---|
| Locke & Latham 2002, "Building a practically useful theory of goal setting and task motivation", *American Psychologist* 57 | 35-year synthesis | Specific difficult goals direct effort; commitment, feedback and complexity moderate; goal conflict and the subconscious are named limits | part | candidate |
| Ordóñez, Schweitzer, Galinsky & Bazerman 2009, "Goals gone wild", *Academy of Management Perspectives* 23 | Critical review | Narrow focus, distorted risk, unethical conduct, reduced intrinsic motivation | abstract | candidate |
| Kruglanski et al. 2002, "A theory of goal systems", *Advances in Experimental Social Psychology* 34; OUP 2023 volume *Goal Systems Theory* | Theory | Equifinality, multifinality, counterfinality | summary | candidate |
| Gollwitzer & Sheeran 2006, meta-analysis of implementation intentions; Heckhausen & Gollwitzer 1987 (Rubicon model) | Meta-analysis (94 tests, d about 0.65) and model | If-then plans raise goal attainment; deliberation versus implementation mindsets | summary | candidate |
| Sheldon & Elliot 1999, "Goal striving, need satisfaction, and longitudinal well-being: the self-concordance model", *JPSP* 76 | Longitudinal studies | Self-endorsed goals are pursued and satisfy more | summary | candidate |
| Emmons & King 1988, *JPSP* 54; Emmons 1986 | Personal strivings | Conflict among strivings and wellbeing; strivings are concrete | summary (titles only) | candidate |
| Elliot 2006, "The hierarchical model of approach-avoidance motivation", *Motivation and Emotion* 30; Higgins 1997, "Beyond pleasure and pain", *American Psychologist* 52 | Theory | Approach and avoidance as different motive kinds; promotion and prevention focus | abstract | candidate |
| Schank & Abelson 1977, *Scripts, Plans, Goals and Understanding* (via a Yale course page) | Story-understanding theory | Goal types: satisfaction, enjoyment, achievement, preservation, crisis, instrumental; wishes, worries, opportunities, duties; Wilensky's goal relations | summary | candidate |
| Harland, Morley, Thangarajah & Yorke-Smith 2014, "An operational semantics for the goal life-cycle in BDI agents", *Autonomous Agents and Multi-Agent Systems* 28 | Agent semantics | Goal states and the operations drop, abort, suspend, resume | abstract | candidate |
| Agnew 1992, "Foundation for a general strain theory", *Criminology* 30; Merton 1938, "Social structure and anomie", *ASR* 3 | Criminology | Three kinds of strain; goal-means gap and the adaptations to it | abstract | candidate |
| Frijda 1986, *The Emotions*; Ortony, Clore & Collins 1988 | Appraisal theory | Comparison only: events matter through an agent's concerns | abstract | comparison, not credited as a source |
| Doran & Parberry 2011, "A prototype quest generator based on a structural analysis of quests from four MMORPGs", PCG Workshop | Analysis of 753 quests | Nine NPC motivations and their frequency | full | candidate |

### 2.4 Groups, communities and the setting

| Source | What it is | Used for | Read | Credit |
|---|---|---|---|---|
| Perrow 1961, "The analysis of goals in complex organizations", *ASR* 26 | Organisation theory | Official versus operative goals | summary | candidate |
| Cyert & March 1963, *A Behavioral Theory of the Firm*; Greve 2003 | Organisation theory | Aspiration levels, problemistic search, slack | summary | candidate |
| Levitt & Venkatesh 2000, "An economic analysis of a drug-selling gang's finances", *QJE* 115 (NBER w6592) | One gang's four-year books | Skewed pay, low foot-soldier wages, rival-turf violence cost; checked against the abstract | abstract | candidate |
| Venkatesh 2006, *Off the Books*; Simone 2004, "People as infrastructure", *Public Culture* 16 | Ethnography | Informal work interlinked with formal; brokers; cooperation among the marginal | summary, abstract | candidate |
| Meyer & Allen 1991, *Human Resource Management Review* 1; Le & Agnew 2003, *Personal Relationships* 10 (52 studies, about 11,000 people); Hirschman 1970, *Exit, Voice, and Loyalty* | Commitment | Affective, continuance and normative commitment; satisfaction, investment and alternatives; exit, voice and loyalty | summary | candidate |
| Pyrooz & Decker 2011, *Journal of Criminal Justice* 39 (84 arrestees); Pyrooz, Decker & Webb, *Crime & Delinquency* 60; Decker & Lauritsen 2002 | Gang desistance | Push and pull motives; non-hostile exits are common; ties linger | abstract, summary | candidate |
| Lipsky 1980, *Street-Level Bureaucracy* | Public administration | Rationing, creaming, routines as de facto policy | summary | candidate |
| Gómez-Mejía et al. 2007, *Administrative Science Quarterly* 52 | Family-firm study | Socioemotional wealth: identity, family influence, dynasty | summary | candidate |
| Burnstein, Crandall & Kitayama 1994, *JPSP* 67 | Kin-helping experiments | Helping tracks relatedness, most strongly when the stakes are high | abstract | candidate |
| de Haas 2021, "A theory of migration: the aspirations-capabilities framework", *Comparative Migration Studies* 9 | Migration theory | Migration needs both aspiration and capability; staying is agency | abstract | candidate |
| Black 1983, *ASR* 48; Gould 2003, *Collision of Wills*; Collins 2008, *Violence*; Jervis 1978, *World Politics* 30; Boehm 1984, *Blood Revenge* | Feud and violence theory (SYS-21) | Self-help where law fails; rank ambiguity; violence is rare and clumsy; legibility of defence; elders' settlement. **Checked against abstracts, publisher text and reviews; none read in full** | summary | candidate |
| Mauss 1925; Gouldner 1960, *ASR* 25; Sahlins 1972; Graeber 2011 and critics; Van Gennep 1909; Turner 1969 | Obligation and ritual (SYS-25) | Reciprocity as a norm; delay; kinship distance; staged status change. Graeber is contested | summary | candidate |
| Sen 1981; Thompson 1971, *Past & Present* 50; Collins, Morduch, Rutherford & Ruthven 2009; Shah, Mullainathan & Shafir 2012 | Scarcity and moral economy (SYS-22) | Via L7; the scarcity-tunnelling results did not all replicate (L7 `[sec]`, not re-checked here) | via L7 | candidate |
| R. Talsorian, "Cyberpunk Red Alert: Lifepath", 16 Oct 2020; a Roll20 compendium page of the tabletop Lifepath tables | Tabletop setting | Lifepath steps; values and life-goal vocabulary; enemies as who, cause, capability, revenge | summary (both pages, through a fetch tool) | candidate |
| EIP.gg gangs guide (Grish) | Community guide | One-line gang ethos for the group table | summary | already credited |
| [Population and affiliations](../../../knowledge/population-and-affiliations.md); [open-world activities](../../../knowledge/open-world-activities.md) | Our knowledge pages, from the game's data | The 43 affiliations and their classes; 55 character records tagged `Cyberpsycho`; 17 cyberpsycho hunts; street-cred tiers; district crime multipliers and heat presets; content tokens | full | first party |
| Lens files L2, L6, L7, L11; [kernel](../spec/kernel.md) | First party | Failure cases, setting material, systems fields; the interface this dossier must fit | full (relevant parts) | first party |

**Checks on lens claims.** Checked and consistent with an abstract or publisher text: Levitt & Venkatesh's wage and skew figures; Gould's rank-symmetry claim; Collins on rarity and clumsiness; Jervis on distinguishability; Boehm's elders; Gouldner's two demands; Simone's abstract; Black's self-help thesis. **Not confirmed:** the "four to eight times" equal-status homicide figure (L7, secondary), the Shah replication result, and Bourdieu's remark about the interval in gift exchange (L11, secondary). Those three are used with the lens's flag or not at all.

---

## 3. Principles

Each principle is an atomic claim. "Operationalise" says whether a procedure could **produce** the property, **check** it, or **neither**. Layer numbers are the [plan's](../plan.md#2-the-system-at-first-level) four layers; "S1" is the simulation policy specification the kernel defers to. Instances are invented for this dossier and are not content.

### A. What drives exist and how they relate

**DRV-01. Needs overlap and trade by urgency. They are not a ladder.** `[empirical]` The ordering is **contested**: the 1976 review found little consistent support for it, and the 2010 revision keeps the lower motives alive underneath the higher ones. Deficit drives (hunger, safety) captured attention only while acute; growth drives matter even when nothing is lacking.
- *Source:* Wahba & Bridwell 1976 (summary); Kenrick et al. 2010 (part: later motives add to earlier ones, physiological needs never disappear, cognitive priority differs from developmental order); Tay & Diener 2011 (summary: links between needs and wellbeing largely independent). Maslow's own paper is less rigid than the textbook pyramid (memory; a reader's commentary says the same).
- *Instance:* A stall-holder who is two days from missing her rent still phones her mother, and still notices a good knife.
- *Scales:* encounter, gig, arc. *Layers:* 1 (S1), 3.
- *Operationalise:* **produce.** Frame weight = importance × (floor + (1 − floor) × urgency), with a floor of about 0.1 for deficit drives and about 0.5 for growth drives (section 9.1). No rule says "family unlocks only after safety". **Check:** raising one drive's urgency to 1 reduces the others' share of the actor's attention budget but never sets their weight to zero.

**DRV-02. Independent lists of motives agree on a core; our families are built from the overlap.** `[empirical]` / `[analysis]`
- *Source:* Maslow; Kenrick et al. 2010; Reiss 2004 (16 desires from factor analyses of thousands of people); Fiske (five core social motives); Schwartz (ten values in 82 countries); Sheldon et al. 2001; and, from games, The Sims (nine needs), RimWorld, Dwarf Fortress and Doran & Parberry's nine quest-giver motivations. See the convergence matrix in [8.1](#81-the-ten-families-and-where-they-come-from).
- *Instance:* "Belonging" appears in Maslow (love and belonging), Kenrick (affiliation), Reiss (acceptance, social contact), Fiske (belonging), SDT (relatedness) and The Sims (social).
- *Scales:* all. *Layers:* 1, 4.
- *Operationalise:* **check.** Every catalogue drive cites at least two lists or is marked setting-specific or judgement in the Support column. Game lists count as one voice each, because games inherit each other.

**DRV-03. "Bonds" is several drives. Kin care, romantic partnership, friendship and group belonging differ in function, in development and in what they obligate.** `[analysis]`, with `[empirical]` support for the split.
- *Source:* Kenrick et al. 2010 (part: affiliation split into romantic love, friendship and family care); Fiske 1992 (summary: communal sharing, authority ranking, equality matching, market pricing); Baumeister & Leary 1995 (abstract).
- *Instance:* A gang is mostly authority ranking over communal sharing. A fixer and a client are market pricing. A ripperdoc who says "pay me when you can" moves a market tie towards communal sharing, and the debt is no longer only money.
- *Scales:* encounter to arc. *Layers:* 1, 4.
- *Operationalise:* **produce.** Bond edges (`core:kin`, `core:member-of` terms, friendship edges) carry a relational-model tag. The tag selects which obligations apply and which reciprocity rule (DRV-19) the tie uses. **Check:** an untagged tie is a defect.

**DRV-04. Active thwarting is a different signal from lack. Being controlled, humiliated or excluded hits harder than merely not getting something.** `[empirical]` Universality across cultures is **contested**.
- *Source:* Ryan & Deci 2000 (abstract: competence, autonomy and relatedness; frustration diminishes motivation and health); Vansteenkiste & Ryan 2013 (summary: dissatisfaction versus frustration as distinct); Sheldon et al. 2001 (summary: autonomy, competence, relatedness and self-esteem lead in event ratings in US and South Korean samples).
- *Instance:* A crew member who is simply short of work is unhappy. One who is ordered to hand over the work they were promised is a different problem.
- *Scales:* encounter, arc. *Layers:* 1.
- *Operationalise:* **produce.** Separate the two interest types in the kernel: `wants` (lack) and `threatenedBy` (thwart). A thwarting event pulses the drive's urgency at 1.5 times the rise a plain lack would give **[tunable, J]**. **Check:** traces count frustration events apart from absence.

**DRV-05. Respect and standing are fundamental; money and popularity as ends are weak. In a poor, indebted city money is mostly a means.** `[empirical]`, mixed.
- *Source:* Anderson, Hildreth & Howland 2015 (summary: status is a fundamental motive, defined as respect and voluntary deference); Sheldon et al. 2001 (summary: popularity-influence and money-luxury ranked lowest in satisfying events).
- *Instance:* A courier chases cred for the way it changes how people deal with him, and chases money only because the clinic does not take cred.
- *Scales:* all. *Layers:* 1, 4.
- *Operationalise:* **produce.** `money` has two parts. Its **urgency** is a shortfall ratio derived from rent, debt and need (section 9). Its **importance** reflects acquisitiveness, which is a trait. Most concerns that bind to `money` should carry a different origin drive (`shelter`, `debt`, `sustenance`). **Check:** in a sampled population, most money concerns have an instrumental parent drive; intrinsic money-seeking is a minority.

### B. Importance

**DRV-06. Importance is a slow, structured variable, separate from urgency.** `[empirical]`
- *Source:* Schwartz 2012 (abstract, summary: ten values in a circle of compatibility and conflict, held across 82 countries; a 19-value refinement tested in 15 samples from 10 countries); Bardi & Goodwin 2011 (abstract: values do change, by an automatic and an effortful route); Parks-Leduc et al. 2015 (summary: traits and values link modestly, so they are distinct constructs).
- *Instance:* Two vendors with the same rent shortfall (same urgency) differ in what they give up first: one her pride, one her sleep.
- *Scales:* arc. *Layers:* 1.
- *Operationalise:* **produce.** Importance is generated once per actor from a seeded profile (section 10) and afterwards changes only through contributions made after major events. **Check:** no importance changes inside a simulation window except through a recorded event.

**DRV-07. People differ as profiles, not as independent dials. Values correlate in a circle, and people also differ idiosyncratically.** `[empirical]` The two main sources **disagree** on structure: Reiss reports 16 largely unrelated desires, Schwartz a circular structure.
- *Source:* Reiss 2004 (abstract); Schwartz 2012 (abstract).
- *Instance:* A person high on thrill and autonomy is likely low on tradition-flavoured drives such as roots and honour, but a few contradict the pattern.
- *Scales:* all. *Layers:* 1.
- *Operationalise:* **produce.** A compromise: two latent axes (openness against conservation; self-enhancement against self-transcendence) draw the main variation, and a per-drive noise term draws the rest (section 10.2). **Hypothesis**, chosen for determinism and cheapness. **Check:** the generated population shows the circle's sign pattern in its correlations.

**DRV-08. Traits tune gains. Values and role decide content.** `[analysis]`
- *Source:* DeYoung 2015 (abstract: traits are variation in the parameters of evolved goal-directed control; goals, interpretations and strategies are characteristic adaptations tied to a life's circumstances); Parks-Leduc et al. 2015 (summary).
- *Instance:* Two guards share a value profile. One flinches at every shadow, the other does not. Same drives, different threat sensitivity.
- *Scales:* encounter, arc. *Layers:* 1.
- *Operationalise:* **produce.** Per-actor gains `g_threat`, `g_reward` and `g_persist`, default 1.0, range about 0.6 to 1.6 **[J]**, applied to urgency and goal inertia. **Check:** gains never add or remove a drive.

**DRV-09. A shorter sense of future time reweights goals. Harsh, unpredictable conditions favour present-oriented behaviour.** `[empirical]` **Contested** on both halves.
- *Source:* Carstensen et al. 1999 and 2006 (summary: constrained horizons raise emotionally meaningful goals; also seen after relocation, illness and war; one study reported in a commentary found the opposite pattern); Griskevicius et al. 2011 (abstract: mortality cues made people raised poor want children sooner and people raised well off want them later); Pepper & Nettle 2017 (summary: a behavioural constellation of deprivation, with commentators arguing the evidence is more varied).
- *Instance:* A runner given a diagnosis turns from ambition towards family and a settled score. A teenager in a high-hazard district discounts next month.
- *Scales:* arc. *Layers:* 1.
- *Operationalise:* **produce.** Each actor carries a perceived horizon `H` in years, from age, health and local hazard (the game's district `crimeMultiplier` and prevention preset are data for the last). Importance is multiplied by `(H / H0)^κ`, with `κ` per drive in table 8.5 and `H0 = 30` **[J]**. The response to a mortality cue depends on resources, as in the 2011 result: poor actors move earlier, comfortable ones later. **Check:** moving someone to a safer district for a game year raises `H` slowly and shifts weights slowly.

**DRV-10. Do not build a terror-management reflex.** `[empirical]`, **contested.**
- *Source:* Klein et al. 2022 (summary: 21 labs, 2,220 participants, no mortality-salience effect under any condition); a reanalysis by the original side (summary) argues a restricted analysis recovers it.
- *Instance:* A character who sees a death does not suddenly defend their worldview harder. They may reassess what they spend their days on (DRV-09).
- *Scales:* arc. *Layers:* 1.
- *Operationalise:* **check.** Mortality cues are concern triggers (diagnosis, near death, bereavement) and horizon changes. No process raises worldview defence or out-group hostility in response to mortality salience. The draft's "facing mortality" drive is removed.

**DRV-11. Importance varies with role, circumstance and membership, never with ethnicity or gender.** `[hypothesis]`, with an ethical basis (map fields ETH-01, ETH-02).
- *Source:* No empirical source; a design rule. The lens notes the genre's record of stereotype (L6) and the group lore in section 11 comes from the game's own factions.
- *Instance:* A gang's code enters its members through the membership edge. A member's heritage does not decide their honour weight.
- *Scales:* all. *Layers:* 1, 4, evaluation.
- *Operationalise:* **check.** Audit generated importance by demographic tags; any deviation beyond what role, circumstance and membership explain is a defect. No archetype multiplier is keyed to a demographic tag.

### C. Urgency

**DRV-12. Derive urgency from timestamped facts. Do not tick a counter.** `[hypothesis]`, aligned with the kernel's determinism, forgetting and quantisation rules.
- *Source:* Our own inference from [kernel §5, §6, §9.4](../spec/kernel.md). Worked check: a rest drive with a build-up time constant of 18 h rises by about 0.0093 per 600 s window at the start. The kernel stores urgency to 1/64 = 0.0156. A counter updated and quantised each window would never move.
- *Instance:* Hunger is a function of the time of the last meal. Debt urgency is a function of the due date and today. Safety urgency is a function of a threat's distance and the actor's belief in it.
- *Scales:* all. *Layers:* 1 (S1), kernel hooks.
- *Operationalise:* **produce.** `urgency(drive, t) = f(facts at t)`. S1 writes an urgency pin only when the 1/64 bucket changes. For drives satisfied by routine and not pinned, the default is a deterministic function of the time of day and the actor's schedule, so nothing is stored for the billions of unobserved people. **Check:** replaying from the seed and the pins gives the same urgency at any time; ticking or jumping gives the same history.

**DRV-13. Deficits rise on a saturating curve and discharge faster than they build.** `[empirical]` for sleep; `[hypothesis]` for the rest.
- *Source:* Daan, Beersma & Borbély 1984 (two-process model: a homeostatic process rising as a saturating exponential when awake and falling when asleep, gated by a circadian process); Rusterholz et al. 2010 (summary: build-up time constants 14.1 to 26.4 h, decline 1.2 to 2.9 h).
- *Instance:* After 16 h awake with a time constant of 18 h, rest urgency is 1 − e^(−16/18) = 0.59; after 24 h, 0.74; after 36 h, 0.86. Eight hours of sleep with a 2 h decline constant leaves under 0.02.
- *Scales:* encounter. *Layers:* 1.
- *Operationalise:* **produce.** Rising-deficit model `R(τ)` (section 9), with a circadian factor for rest and pleasure. Satisfiers discharge faster than the build-up.

**DRV-14. Social need builds with isolation and can be felt like hunger.** `[empirical]`, small sample.
- *Source:* Tomova et al. 2020 (abstract: 40 adults; midbrain responses to social cues after 10 h of isolation tracked self-reported craving, as responses to food cues did after fasting); Baumeister & Leary 1995 (abstract).
- *Instance:* A night-shift guard with no one to talk to for three days is easier to befriend than the same guard on a good week.
- *Scales:* encounter, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** `friendship` uses `R(τ)` with `τ` about 72 h, scaled by a sociality trait **[J]**. The lab isolation was short and the sample small and mostly women, so no number carries over. **Check:** isolated actors seek contact more often than connected ones.

**DRV-15. Effort and attention rise as a due point nears. Overdue needs an escalation ladder, not a flag.** `[empirical]` for the ramp; `[hypothesis]` for the ladder.
- *Source:* Kivetz, Urminsky & Zheng 2006 (abstract: customers bought more often as a free coffee neared; a card with pre-filled progress led to faster completion); lens L6/L11 on obligations returning as queued hooks.
- *Instance:* Protection money due on Friday: tense by Wednesday, desperate on Friday evening, and on Saturday a collector with a name arrives. This is the foundation's worked vendor ([§5.1](../foundation.md#51-drives-what-governs-relevance)).
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** Deadline model `D(τ_d, κ)`: `U = 1 / (1 + κ × (due − now) / τ_d)`, and at the due time `U = 1` and the first rung of a ladder fires. Each rung is a real world event that other actors' frames can match (a message, a visit, a seizure), with delays that depend on the creditor's type. **Check:** every due date that passes unmet produces an event within its rung delay.

**DRV-16. Avoidance rises more steeply with nearness than approach does. Do not hard-code that losses weigh double.** `[empirical]` for the gradient; the blanket claim is **contested**.
- *Source:* Miller 1944 and Boyd et al. 2011 (summary: avoidance gradient steeper than approach; movement slowed under avoidance conflict); Gal & Rucker 2018 (abstract: evidence does not support losses generally outweighing gains).
- *Instance:* A hungry courier will walk past a stall with a gunman beside it, even though the food is worth the walk from further off.
- *Scales:* encounter. *Layers:* 1.
- *Operationalise:* **produce.** Proximity model `X`: threat urgency falls off with distance on a scale `λ_threat` set to about 0.6 of the satisfier's `λ_approach` **[J]**. Keep the kernel's interest weights symmetric ([kernel §10.5](../spec/kernel.md#105-changes-and-matching): `wants`, `threatenedBy`, `protects` all 1.0). **Check:** a nearer threat pre-empts a more valuable but farther want in fixtures.

**DRV-17. Craving has two parts: a drive that builds between doses, and cue-triggered wanting that need not match liking. Tolerance ratchets both.** `[empirical]`; theories **compete**.
- *Source:* Robinson & Berridge 1993 and the 2024 review (summary: dopamine "wanting" separates from "liking"; sensitisation amplifies wanting); Solomon & Corbit 1974 (memory: opponent-process account, withdrawal and tolerance).
- *Instance:* A stim user who is fine in the flat spikes at the sight of a dealer's corner.
- *Scales:* encounter, arc. *Layers:* 1.
- *Operationalise:* **produce.** `R(τ_w)` plus a cue pulse `P` triggered by matching selectors (a dealer, a place, an object), and a tolerance ratchet that shortens `τ_w` per dose to a floor **[J]**. Treat dependence as an illness with causes, not as default villainy (ETH fields, L10).

**DRV-18. Grievance latches, decays with the relationship's value, and is sharpened in honour cultures. Violence is the rare outcome of a feud.** `[empirical]` for revenge as a system; the reading of honour cultures is **contested**; `[analysis]` for feud dynamics.
- *Source:* McCullough, Kurzban & Tabak 2013 (abstract: a deterrence system for revenge and a companion system for forgiveness that depends on expected relationship value and risk of exploitation); Nisbett & Cohen 1996 (summary: insulted southerners showed larger cortisol and testosterone rises; the authors' reading is disputed); Black 1983 (self-help where legal protection fails); Gould 2003 (disputes concentrate among near-equals); Collins 2008 (violence is the exception, clumsy, and needs situational support).
- *Instance:* A slight to a Valentino in front of his crew sticks for weeks. The same slight from his cousin fades in days.
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** Latched pulse `P`: urgency jumps to `u0 × severity`, holds until retaliation, reconciliation or the target's removal, then decays with a time constant of about 2 weeks if the relationship value is high and about 3 months if not **[J]**. The honour trait lengthens the hold and raises the pulse. The conversion from intent to violent act is rare per window and needs an audience or a visibly weak target (section 13.6; SYS-21 detail belongs with the feud dossier).

**DRV-19. Favours come back after a plausible delay that grows with their size and with social distance. Immediate repayment reads as refusing the relationship.** `[analysis]`; Bourdieu's remark is a lens claim (`[sec]`), not re-checked.
- *Source:* Gouldner 1960 (summary: the norm asks us to help those who have helped us and not to harm them); Sahlins 1972 (summary: generalised reciprocity has no fixed return; balanced and negative forms sit at greater distance); Mauss 1925 (memory); lens L11.
- *Instance:* A ripperdoc patches V on credit. Three days on, a stranger mentions it. Within an hour is a transaction. Never is a snub.
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** When a favour is done, S1 samples a lag from a log-normal with a median of about 3 days for a small favour and about 14 for a large one (σ about 0.6) **[J]**. After the lag, `reciprocity` urgency ramps. Ties tagged communal sharing (DRV-03) have no due date, only a standing weight. **Check:** callbacks sampled from play show a spread of lags, not a constant.

**DRV-20. Debt is a relationship with a ladder, and it correlates with worse mental health.** `[empirical]` for the association; the causal direction is **unestablished**; `[hypothesis]` for the mechanics.
- *Source:* Richardson, Elliott & Roberts 2013 (abstract: 65 papers; odds ratios of 3.24 for mental disorder, 2.77 for depression, 7.9 for suicide completion; the authors call for longitudinal work); lens L7 field 23 (debts convert into obligations to the creditor; the conversion is an extension); Graeber 2011 (`[sec]`, **contested** by several critics).
- *Instance:* A lender who is not repaid asks for a small favour, then a bigger one.
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** A debt record has creditor, amount, due, collateral and a ladder. Unpaid debts convert to obligations in labour, favours or information, by creditor type (gang, corporation, individual). Debt urgency adds to the stress load that drives `serenity` (section 9). **Check:** debt is never reduced to "owe money, do mission" (L6 failure mode).

**DRV-21. Behaviour needs inertia and boredom. Drives alone make creatures dither.** `[shipped]` / `[analysis]`
- *Source:* Blumberg 1996 (part: ethologists find animals work on one goal at a time without dithering; mutual inhibition gives inertia; its gains set persistence; a level of interest that falls while a behaviour runs frees lower-priority ones; low-priority behaviours get time-sharing); Tyrrell 1993 (abstract: drive model, hydraulic model and Maes's network each tested in a simulated environment, with shortcomings found).
- *Instance:* A guard who leaves his post every time a hunger tick passes is a bug. One who never leaves is a statue.
- *Scales:* encounter, gig. *Layers:* 1.
- *Operationalise:* **produce.** Goal commitment adds a persistence margin to the current goal's score, and a level of interest decays while the goal makes no progress (section 13.4). **Check:** a dithering metric (goal switches per game hour) in the calibration fixtures.

### D. Concerns and goals

**DRV-22. A concern is a drive bound to particular things. Motives that are concrete produce action, and abstract ones produce mood.** `[analysis]`, with `[shipped]` support.
- *Source:* Emmons 1986 and Emmons & King 1988 (summary: personal strivings are the concrete things people are typically trying to do); Doran & Parberry 2011 (full: an NPC's motivation is "the most important concern the NPC has", and the quest addresses it); Frijda 1986 and Ortony et al. 1988 as comparison (abstract: events matter to an agent through its concerns).
- *Instance:* "Money" is a drive. "The Claws' collector comes on Friday for 400" is a concern: it names the people, the amount and the date.
- *Scales:* encounter, gig. *Layers:* 1, 3, kernel §10.2 (`level: 'concern'`).
- *Operationalise:* **produce.** A concern frame carries its drive, its origin (DRV-23), its bindings (who, where, what), its stakes, an optional due time and a valence (DRV-29). **Check:** every concern has a non-empty "because" chain to a drive and a cause event (L2: every generated offer needs one).

**DRV-23. Concerns have seven generators, not one.** `[analysis]` / `[empirical]`
- *Source:* Agnew 1992 (abstract: strain comes from failure to reach valued goals, loss of valued things, and presentation of noxious stimuli; strain breeds negative emotion); Merton 1938 (abstract: the gap between prized goals and approved means); Schank & Abelson 1977 (summary: opportunities, duties, worries, wishes alongside need-driven goals); Robinson & Berridge (cue-triggered wanting); Lifepath (family crisis, enemies, tragic love as generators of complications).
- *Instance:* A vendor's concern can arise from a rising rent (deficit), a blocked licence (blocked want), a robbery (loss), a collector at the stall (aversive presence), a gang's order (duty), a free stall in a better street (opportunity) or the smell of a dealer's corner (cue).
- *Scales:* encounter, gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** Generators O1 to O7 in [13.2](#132-the-seven-concern-generators), each tied to a kernel change type, so the world can find who needs a concern opened when something happens. This also fills the gap L7 noted in routine-activity theory, which takes the motivated offender as given (SYS-03).

**DRV-24. Specific, time-bound goals direct effort. Vague wants produce drift.** `[empirical]`
- *Source:* Locke & Latham 2002 (part: thirty-five years of studies; specific difficult goals lead to higher performance than "do your best"; commitment, feedback and task complexity moderate it).
- *Instance:* "Get rich" produces a person who loiters. "Raise 400 by Friday" produces a person who calls in favours.
- *Scales:* encounter, gig. *Layers:* 1, 3.
- *Operationalise:* **produce.** A goal record has target effects (the kernel's `Goal.effects`), a deadline, a difficulty estimate and a commitment. Effort allocation scales with commitment; difficulty above the actor's capability lowers commitment (a goal that cannot be reached is a wish, DRV-33). **Check:** actors with a live concern but no goal do not wander forever; they either form a goal or the concern lapses.

**DRV-25. Goals conflict, and conflict is resolved by importance, by alternatives, by modifying a goal, or by dropping one.** `[analysis]`; the wellbeing cost is `[empirical]`, known here only from titles and summaries.
- *Source:* Wilensky via a Yale course page (summary: conflict over limited resources; four resolutions; resolve by importance); Emmons & King 1988 (title: conflict among personal strivings and wellbeing); Locke & Latham 2002 (part: goal conflict undermines performance when incompatible actions are motivated).
- *Instance:* A gang order to take a job on the same night as a sibling's performance.
- *Scales:* gig, arc. *Layers:* 1, 3, kernel §10.8 (`Dilemma`).
- *Operationalise:* **produce.** The kernel already emits `Dilemma { frameA, frameB, severity }`. S1 resolves it by one of four strategies (alternative resource, alternative plan, modify a goal, abandon one), weighted by pull. Unresolved dilemmas add to stress load (`serenity`). Every resolution is an event, so it can seed the next thread ([DS-61](../design-seeds.md)).

**DRV-26. Means serve several goals, and a means that harms another goal is penalised.** `[empirical]`, from summaries.
- *Source:* Kruglanski et al. 2002 (summary: equifinality, multifinality, counterfinality; a means that serves more goals weakens the tie of any one goal to it; a means that harms an important alternative goal is seen as less useful).
- *Instance:* A job that pays the rent and also earns cred beats one that only pays; a job that pays but burns a friend loses to either.
- *Scales:* gig. *Layers:* 1, 3.
- *Operationalise:* **produce.** Goal scoring (13.3) adds a multifinality bonus for each other active concern a means advances, and subtracts a counterfinality cost from each it threatens. **Check:** with two otherwise equal means, the one serving more active concerns is chosen more often.

**DRV-27. Deliberate, then commit. Plan the trigger, not just the act.** `[empirical]`
- *Source:* Heckhausen & Gollwitzer 1987 (summary of the Rubicon model: deliberation about wanting, then implementation); Gollwitzer & Sheeran 2006 (summary: if-then plans raise goal attainment, d about 0.65 over 94 tests).
- *Instance:* "If the collector's car pulls up, I leave through the back" is a plan that works because it names a cue.
- *Scales:* encounter, gig. *Layers:* 1, kernel §10.5.
- *Operationalise:* **produce.** Goal formation has two steps: score candidates without commitment, then commit with a bias towards the chosen goal. The chosen plan's cues become `reactsTo` interests on its step frame, so the world notifies the actor when the cue happens. That is what an implementation intention is, in the kernel's terms. **Check:** a committed goal gets a persistence margin; an uncommitted candidate does not.

**DRV-28. Goals have a lifecycle with explicit exits.** `[analysis]`
- *Source:* Harland et al. 2014 (abstract: goal states and the operations drop, abort, suspend and resume, with a formal semantics).
- *Instance:* A heist crew suspends the job when the target moves, resumes it later, and drops it when a member is caught.
- *Scales:* gig, arc. *Layers:* 1, kernel §10.2 (`status`).
- *Operationalise:* **produce.** Map to the kernel's statuses: pending and active are `active`; suspended is `blocked`; achieved is `satisfied`; dropped and aborted are `abandoned`. Keep the **reason** in the frame's `cause` (failed, dropped, superseded) because a failure feeds new concerns (DRV-23, O3) and a drop does not.

**DRV-29. Approach and avoidance concerns are different kinds. Avoidance has no end state.** `[empirical]`
- *Source:* Elliot 2006 (abstract: approach is energised or directed by positive stimuli, avoidance by negative ones); Higgins 1997 (abstract: promotion focus on accomplishments and aspirations, prevention focus on safety and responsibilities).
- *Instance:* "Keep the Claws away from my stall" never finishes. "Make rent" does.
- *Scales:* all. *Layers:* 1, kernel §10.2.
- *Operationalise:* **produce.** A valence flag on every concern. Avoidance concerns are never `satisfied`; they `lapse` after the threatening selector has not matched for a period `T_lapse` **[J]**. A prevention-focused actor has a higher `g_threat` (DRV-08).

**DRV-30. Goals that are the actor's own persist. Imposed goals erode unless identification or fear holds them.** `[empirical]`, from a summary.
- *Source:* Sheldon & Elliot 1999 (summary: self-concordant goals are pursued and satisfy more); Meyer & Allen 1991 (summary: affective, continuance and normative commitment).
- *Instance:* A gang grunt who believes in the crew works the order harder than one who is only afraid to leave.
- *Scales:* gig. *Layers:* 1, kernel §12.
- *Operationalise:* **produce.** Commitment = base + β × endorsement, where endorsement for a group order comes from membership strength and its affective component (DRV-38). Orders carried by fear alone start with lower commitment and decay faster **[J]**.

**DRV-31. Hard targets narrow attention and invite corner-cutting. "Tunnelling" under scarcity is not established, so keep it off by default.** `[empirical]` for goals gone wild, **contested**; scarcity results `[empirical]` but **partly failed to replicate** (L7, not re-checked).
- *Source:* Ordóñez et al. 2009 (abstract: narrow focus, distorted risk preferences, unethical behaviour, reduced learning, corroded culture); lens L7 field 23 on the scarcity studies.
- *Instance:* A corporate manager with a quarterly number falsifies a report. A fixer behind on commission starts shorting a client.
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce, optionally.** A "pressure" mode: when difficulty × deadline pressure passes a threshold, the actor's risk acceptance rises and the weight of non-goal frames falls (`m` for `reactsTo` scaled by 0.5 **[hypothesis]**). Off by default. Turned on for named antagonists and group leaders under quota, where it is a feature of the story. The director caps it (DRV-46).

**DRV-32. People carry a limited number of live concerns.** `[hypothesis]`
- *Source:* Weak. Studies of personal strivings and projects find people can list on the order of a dozen or more (a Hungarian sample of 48 produced 534 strivings, about 11 each, by my arithmetic; the figure of 15 projects is a popular account, unverified). These are lists people can produce, not what is live at one moment.
- *Instance:* A bar owner juggles rent, a suspicious regular, a daughter's school and a vendetta, and not much else at once.
- *Scales:* all. *Layers:* 1, kernel §10.4, §10.7.
- *Operationalise:* **produce.** A cap on live concern frames: 3 for ordinary NPCs, 5 for named ones, 7 for leaders and V-adjacent characters **[J]**. Beyond that, the lowest-pull concerns go dormant: they remain as drive weight and return when pull rises. This is also the budget lever.

**DRV-33. Wishes are real. A concern with no feasible means stays alive, and it shapes talk and hooks.** `[analysis]`
- *Source:* Schank & Abelson 1977 (summary: wishes and hopes, desires with no plan or resources to fulfil them); de Haas 2021 (abstract: the choice to stay is agency, and aspiration without capability is a distinct state).
- *Instance:* A cook who wants out of the district and has no money for the fare says so over the counter, and a V who can fund it has a gig.
- *Scales:* encounter, gig. *Layers:* 1, 3.
- *Operationalise:* **produce.** A `blocked` concern with `feasible = false` keeps its interests listening for what would unblock it. These are the "blocked contexts" fitting queries for hooks ([DS-56](../design-seeds.md)). **Check:** the share of live concerns that are wishes is neither zero nor most.

**DRV-34. Means come from what is open. When prized goals meet closed legitimate routes, people adapt.** `[analysis]`; migration `[empirical]` in the abstract only.
- *Source:* Merton 1938 (abstract: modes of adaptation including innovation, ritualism and retreatism; opportunities to reach goals by approved means are unequally distributed); de Haas 2021 (abstract: migration as a function of aspirations and capabilities within perceived opportunity structures).
- *Instance:* A courier with debts and no legal work takes an illegal run. A cook who wants out and cannot afford the fare stays and wants.
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** The means library tags each means with its **legitimacy** and its **requirements** (money, papers, contacts, skills). When all legitimate means to a high-importance goal fail their requirements, illegitimate means enter the candidate set with a norm penalty scaled by `honour` and `integrity`. Escape is gated by capability: the drive's urgency is the push; the goal's feasibility is the capability (section 14). **Check:** the share of crime-adjacent goals rises with blocked legitimate means.

### E. Groups

**DRV-35. A group's drives are what it spends on and holds, not what it says. Official purpose and operative goals are separate slots.** `[analysis]`
- *Source:* Perrow 1961 (summary: official goals appear in charters and executives' statements; operative goals are revealed by the allocation of money, time and personnel; studies that take official goals at face value mislead).
- *Instance:* A corporation's public line is safety; its budget line is growth. A gang's code is honour; its ledger is vice income.
- *Scales:* arc. *Layers:* 1, 3, 4.
- *Operationalise:* **produce.** A group has an **ethos** (authored, slow, used for speech and recruitment) and **operative drive weights** computed from allocation and constraint (section 11). The gap is measurable and is a story seed: hypocrisy exposed, a leak, a betrayal. **Check:** the engine can state, for any group, its ethos and its operative top three, and they differ more often than not.

**DRV-36. Group urgency is performance against an adaptive aspiration. Falling short triggers search and risk. Doing well breeds slack.** `[empirical]`, from summaries.
- *Source:* Cyert & March 1963 and Greve 2003 (summary: decision makers compare performance with aspirations; shortfall triggers problemistic search; slack absorbs; high performers cut change quickly and low performers raise it slowly).
- *Instance:* A gang that has lost a block searches for a new income and takes bigger risks than one that is flush.
- *Scales:* arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** `U_g = clip((A − P) / A)` for treasury and turf, where `A` adapts: `A ← (1 − α)A + α × (own past P or a peer's P)` with `α` about 0.2 per game quarter **[J]**. Shortfall raises risk acceptance and opens new means; surplus builds slack that buffers shocks.

**DRV-37. A gang is a firm with a budget and a skewed wage bill. Violence costs money.** `[empirical]`, one gang only.
- *Source:* Levitt & Venkatesh 2000 (abstract: four years of a street gang's records; average wage rose from about $6 to about $11 an hour; extremely skewed; foot soldiers earned below the minimum wage for most of the sample; violence on rival turf shifted demand; the gang cut prices below cost in response). Venkatesh 2006 (summary: formal and informal work are interlinked in the same households).
- *Instance:* A Maelstrom or Valentinos grunt whose pay barely beats a legal job, and whose crew's treasury shrinks in a war.
- *Scales:* arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** Faction income split heavily skewed by rank; war spending drains `treasury`; recruitment responds to the outside option (**extension, not in the paper**). The numbers do not transfer from 1990s Chicago.

**DRV-38. Members' strength of commitment depends on satisfaction, investment and alternatives. Their response to decline is voice, exit or loyalty.** `[empirical]`
- *Source:* Le & Agnew 2003 (summary: 52 studies, about 11,000 participants; satisfaction, quality of alternatives and investment each relate to commitment); Meyer & Allen 1991 (summary: affective, continuance, normative); Hirschman 1970 (summary: loyalty retards exit and gives voice room to work).
- *Instance:* A junior member, underpaid, with a cousin offering a job elsewhere, grumbles first and leaves later.
- *Scales:* arc. *Layers:* 1 (kernel §12, `core:member-of strength`).
- *Operationalise:* **produce.** `strength` moves towards a target set by satisfaction and investment, minus alternatives: `ds/dt = a(sat − s) + b × invest − c × alt`, clipped **[hypothesis, shape only]**. Voice (propose, complain, shirk) comes first; exit when alternatives beat strength by a margin; loyalty delays exit by raising that margin.

**DRV-39. Leaving is a process, with push and pull motives, mostly non-hostile exits, and ties that linger.** `[empirical]`
- *Source:* Pyrooz & Decker 2011 (abstract: 84 arrestees who had left a gang; push motives and non-hostile methods modal; ties often persisted, with serious consequences; desistance gradual); Decker & Lauritsen 2002 (summary: family ties and victimisation cited most).
- *Instance:* A member who walks away stays in a cousin's group chat and is still found by an old rival.
- *Scales:* arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** Exit is a staged state: withdraw, exit, residual ties. The ended `core:member-of` edge leaves `knows` and kin edges in place. Retaliation risk follows the edge's `terms` and `visibility`. **Check:** most generated exits are non-hostile.

**DRV-40. Frontline members of overloaded services ration, cream and fall back on routine.** `[analysis]`
- *Source:* Lipsky 1980 (summary: rationing, creaming, mass-processing and routines; coping choices function as policy). Map field SYS-20 covers it too.
- *Instance:* A precinct short of officers answers the loudest calls and files the rest. A clinic triages on who can pay.
- *Scales:* encounter, arc. *Layers:* 1.
- *Operationalise:* **produce.** Group drive `workload` (caseload against capacity). Member behaviours follow: skip, delay, refer on, take the easy case. **Check:** response rates fall as the ratio worsens.

**DRV-41. Family drives are not only money. Families protect identity, influence and continuity, and kin help scales with relatedness most when the stakes are high.** `[empirical]`, limited.
- *Source:* Gómez-Mejía et al. 2007 (summary: socioemotional wealth, covering identity, family influence and the perpetuation of the dynasty, shapes family firms' risk choices); Burnstein, Crandall & Kitayama 1994 (abstract: helping tracks relatedness and reproductive potential, especially in biologically significant decisions).
- *Instance:* A cousin is lent a car on a closeness basis. In a life-or-death moment, the nearest kin gets the call.
- *Scales:* gig, arc. *Layers:* 1.
- *Operationalise:* **produce.** Family weights scale with relatedness (1, 0.5, 0.25, 0.125 for self, first-degree, second-degree, third-degree) in high-stakes concerns and with closeness in everyday ones **[J]**. Household groups carry `legacy` and `care_of_members` (section 11).

**DRV-42. A group's intent to retaliate is not an act. Conversion is rare per window and needs a situation.** `[analysis]`; figures are `[sec]` (L7).
- *Source:* Collins 2008 (summary: most confrontations do not become violent; violence is tense, clumsy and often hits the wrong person; sudden visible weakness can trigger overkill); Gould 2003 (summary: disputes are likelier among near-equals); Jervis 1978 (summary: spirals ease when defence has the edge and defensive postures are distinguishable); Boehm 1984 (summary: elders adjudicate feuds to protect solidarity).
- *Instance:* Two gangs with a standing vendetta spend months in posture and a few hours in violence.
- *Scales:* arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** `retribution` is an intent with a low conversion hazard per window, raised by an audience, a visibly weak target and an ambiguous rank gap, and lowered by a trusted arbiter. The detail (hazard shapes, Lanchester resolution) belongs with the feud material in SYS-21; this dossier fixes the drive side only.

**DRV-43. Status changes become real when they are witnessed. Stage them.** `[analysis]`
- *Source:* Van Gennep 1909 and Turner 1969 (summary: separation, a liminal period, incorporation; rites are public and patterned); lens L11 on status as a declared fact with a declarer and acceptors.
- *Instance:* A membership does not flip on a flag. It is announced at the bar, with someone to see it.
- *Scales:* gig, arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** Transitions of `belonging`, `status` and `streetcred` (initiation, promotion, blacklisting, being "made") are events with witnesses; the new state pins only when enough acceptors have seen it. A failed staging is content (an interrupted initiation).

### F. The director and seeds

**DRV-44. The director's tension drive estimates the player's intensity from events, holds it while they are engaged, lets it fall when they are not, and cycles through build, peak, fade and relax. Variety comes from a falling level of interest.** `[shipped]`
- *Source:* Booth 2009 (part): intensity rises with damage, incapacitation and nearby kills, decays over time but not while threats engage; phases build up, sustain peak (3 to 5 s), peak fade, relax (30 to 45 s). Blumberg 1996 (level of interest).
- *Instance:* After a long chase scene, the director offers a quiet beat before a new hook.
- *Scales:* encounter, gig. *Layers:* 3 (P5).
- *Operationalise:* **produce.** `tension` drive: urgency = how far the estimated recent intensity sits below or above a target curve. `variety` drive: urgency rises for categories not recently offered (level of interest per category). The sustain-to-relax ratio of about 1 to 10 is the only number worth keeping from the shooter; the seconds scale up to minutes and hours **[J]**. Details belong with the director dossier (PAC-04).

**DRV-45. Seeds are actors with deadline-driven needs, and the game itself shows an exclusivity need.** `[corpus]` for the game's content tokens; `[hypothesis]` for the rest.
- *Source:* [open-world activities](../../../knowledge/open-world-activities.md): each gig sets a content-token block node so other gigs wait for the matching unblock (the game's way of keeping major content from overlapping, per our hypothesis there); foundation §5 on seeds as actors.
- *Instance:* A seed that can only fire while a character is alive and free has a window; as it closes, the seed's need to happen grows.
- *Scales:* gig. *Layers:* 2, 3.
- *Operationalise:* **produce.** Seed drives: `occur` (deadline model on its window), `fit` (ratio of pinned roles satisfied), `fresh` (a pulse that decays after sowing, so stale seeds wither) and `exclusive` (a pulse that holds other content back while it runs).

**DRV-46. The director also cares for the player: limits on pressure, fatigue and consent.** `[hypothesis]`, resting on `[empirical]` work on reactance and on the ethics of player modelling.
- *Source:* MOT-01 (perceived pressure provokes resistance; tangible rewards can cut interest); ETH-20 (inferring vulnerability from play). Both are other dossiers' fields; cited here because the drive belongs in the catalogue.
- *Instance:* After three offers in a row ignored, the director offers none.
- *Scales:* all. *Layers:* 3.
- *Operationalise:* **produce.** A `care` drive whose urgency rises with unanswered offers, rejected invitations and stated limits, and which reduces offer rate and pressure. **Check:** offer rate falls after ignored offers.

### G. Attribution and reading others' wants

**DRV-47. People explain intentional action by reasons (what the person wanted and believed) and unintentional events by causes. The old actor-observer asymmetry does not hold up.** `[empirical]`
- *Source:* Malle 1999 (abstract: reason versus cause explanation, built on the folk concept of intentionality); Malle 2006 (summary: a meta-analysis found no asymmetry of the kind originally proposed, with effects moderated by familiarity, valence and behaviour type).
- *Instance:* "He left because he wanted out" (a reason). "He left because the line was cut" (a cause).
- *Scales:* encounter. *Layers:* 1 (S1 attribution policy).
- *Operationalise:* **produce.** One attribution policy for self and other. An observed intentional act produces a belief record about the actor's wants and beliefs (kernel §11); an unintentional event produces a causal belief. **Check:** no separate rule set for self and other.

**DRV-48. Observers lean towards dispositional explanations and correct for the situation incompletely. Group membership tilts the lean.** `[empirical]`
- *Source:* Gilbert & Malone 1995 (abstract: the correspondence bias has four mechanisms, including incomplete correction); the foundation's own example of Alice and Bob ([§5.4](../foundation.md#54-perspectives-everyone-has-their-own-model)); the ultimate attribution error (memory, not re-checked).
- *Instance:* Alice judges Bob a jerk from one spilled coffee. She would be kinder to a colleague.
- *Scales:* encounter. *Layers:* 1.
- *Operationalise:* **produce.** Default weight on disposition about 0.65 **[J]**, reduced when a constraint is visible and the observer is not under load, and tilted by the observer's attitude to the target's group. Errors must be recoverable by evidence. They show on the surface in speech and avoidance (the Tale-Spin effect warns that unseen depth is wasted).

**DRV-49. The engine's model of V's wants is a belief over profiles, built from what V does, and it shares the catalogue's vocabulary without ever pinning it.** `[hypothesis]`, under [D-09](../decisions.md).
- *Source:* The foundation §5.3 and kernel §11.3; Malle's reasons (DRV-47) for the form of inference; ETH-20 on the ethics.
- *Instance:* V repeatedly takes the jobs that help neighbours and never the best-paid ones. The belief shifts toward `justice`, `roots` and away from `money`, with a stated confidence.
- *Scales:* arc. *Layers:* 3 (director's beliefs).
- *Operationalise:* **produce.** Treat catalogue drives as hypotheses: each choice V makes among offers with known drive loadings updates a distribution over a handful of coarse profiles (softmax choice likelihood). Offers are picked to hold up across the profiles still plausible. Nothing writes V's drives; the model resets on contradiction.

### H. Night City

**DRV-50. Lifepath is a compact schema for caused relationships.** `[practice]`
- *Source:* R. Talsorian 2020 (summary of the fetched page): steps of origins, personality, family background, environment, family crisis (the example is a debt), friends, enemies (who, what caused it, what the enemy can do, what revenge they plan), a tragic love affair, and life goals. L6's caution: pure rolling makes incoherent people.
- *Instance:* A noodle-stall cook whose enemy is a former partner, cause a sold-out job, capability fixer contacts, revenge a tip to the Claws.
- *Scales:* encounter, gig. *Layers:* 1, 4.
- *Operationalise:* **produce.** The enemy record maps to a grievance structure `{ who, cause, capability, planned_response }` that seeds a `vengeance` pulse and a `threatenedBy` interest on the other party. Named NPCs get one or more of these at generation; ordinary NPCs get them at a lower rate. Rolls are filtered for coherence. **Check:** every named NPC has at least one open obligation pointing at a person or group (L6).

**DRV-51. The tabletop's value and life-goal vocabulary is a setting-true way to state wants, and it maps onto the catalogue.** `[practice]`
- *Source:* A Roll20 compendium page for the Lifepath tables (summary through a fetch tool): a short list of things a character values most (material gain, honour, one's word, honesty, knowledge, vengeance, love, power, kin and friends), a list of attitudes to people (from liking most people to using or distrusting them), and a list of life goals (mending a reputation, gaining power, escaping the street, making enemies pay, leaving the past, tracing those responsible for one's hardships, reclaiming what is owed, fame, being feared and respected). Paraphrased and grouped; the tables themselves are the publisher's.
- *Instance:* A goal of escaping the street is `escape` bound to a place. Reclaiming what is owed is `justice` or `money` bound to a debtor.
- *Scales:* encounter, arc. *Layers:* 4.
- *Operationalise:* **produce.** The mapping in [8.7](#87-lifepath-vocabulary-mapped-to-the-catalogue) lets authors use the tabletop's words and the engine read them as drives and concerns.

**DRV-52. Body stories are about ownership, maintenance and access more than madness. Integrity is a drive with a rare failure state.** `[analysis]`
- *Source:* Lens L6 field 18 (Haraway, Scheper-Hughes & Wacquant, the disability critique); the tabletop's Humanity rules (summary only: implants reduce Humanity; thresholds as relayed by a third-party module and a forum, so the numbers are unconfirmed); our [population knowledge page](../../../knowledge/population-and-affiliations.md) (55 character records tagged `Cyberpsycho`, 17 cyberpsycho hunts as authored content); EIP.gg (Maelstrom: cyberware-obsessed, members often cyberpsychotic).
- *Instance:* A repossession gig for a leased optic. A clinic that will not service a model it no longer stocks.
- *Scales:* encounter, gig. *Layers:* 1, 3.
- *Operationalise:* **produce.** `chrome` and `integrity` as drives; the `integrity` urgency follows a latent strain that rises with implant load, substance use and trauma. Cyberpsychosis is an authored state plus a rare emergent transition, never a default for augmented people. **Check (L6):** the distribution of dispositions by augmentation level shows no strong correlation; the causes of body stories are mostly ownership, maintenance and access.

**DRV-53. Street cred is a drive with an audience, and V's street cred is the city's beliefs about V.** `[shipped]` for the game's meter; `[hypothesis]` for the NPC side.
- *Source:* [Population knowledge page](../../../knowledge/population-and-affiliations.md) §5.3 (`StreetCredTier` records give per-district requirements: Watson tiers 1, 4, 8, 15, Santo Domingo 1, 20, 35, 50, and so on); [open-world activities](../../../knowledge/open-world-activities.md) §5 (every gig reward record carries street-cred experience); Gambetta 2009 and Anderson 1999 via lens L6/L7 (costly signals; respect as currency).
- *Instance:* A fixer offers a harder gig tier once V's cred reaches the district's threshold.
- *Scales:* gig, arc. *Layers:* 1.
- *Operationalise:* **produce.** For V, mirror the game's counter as an observed reading. For NPCs, `streetcred` is a drive whose satisfiers are demonstrations witnessed by the right audience (DRV-43), and whose urgency rises as past demonstrations fade.

**DRV-54. Leaving the city needs both the wish and the means. Staying is also a choice.** `[empirical]`, abstract only.
- *Source:* de Haas 2021 (abstract); Hirschman 1970 (summary); Pyrooz & Decker 2011 (abstract).
- *Instance:* A courier saves for the fare for a year. A grandmother has the fare and will not use it.
- *Scales:* arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** `escape` (urgency from push: debt, danger, enemies, hopelessness) opposes `roots` (urgency from threats to home). Feasibility of an exit goal comes from capability (money, papers, contacts). **Check:** a high-push, low-capability actor keeps `escape` as a wish (DRV-33), and the hook search sees it.

**DRV-55. Collective anger follows breaches of a customary standard of fairness, and starts small and deniable.** `[analysis]`; Thompson's reading was inconsistent and its fit to a corporate city is an extension (L7).
- *Source:* Thompson 1971 (via L7 and L6, summary); Pondsmith's fairness framing (via L6, fetched there).
- *Instance:* A block answers a rent algorithm with scrawls, cut lights and jammed drones, then a march after a repeat.
- *Scales:* arc. *Layers:* 1, 3.
- *Operationalise:* **produce.** `justice` is a pulse driver keyed to norm breaches witnessed by the actor's community. Each district holds a fairness norm; intensity tracks the breach count, not a random draw (L6). **Check:** reaction intensity rises with repetition and with the absence of visible remedy.

**DRV-56. Most street activity is service, brokering and favour, not violence.** `[practice]` / `[empirical]`, from summaries.
- *Source:* Venkatesh 2006 (summary: a web of unreported work; storefront clergy as mediators between residents and gangs); Simone 2004 (abstract: people as infrastructure).
- *Instance:* A mediator stands between a crew and a vendor. A cook, a lookout and a mechanic depend on one another.
- *Scales:* encounter. *Layers:* 1, 3.
- *Operationalise:* **check.** In a sampled street population, most concerns are about `work`, `money`, `shelter`, `family` and `reciprocity`; violent concerns are a minority. Removing a broker in a perturbation run changes nearby prices or availability.

---

## 4. Failure modes and critiques

Failures first, as the method asks. Each row is a way this discipline's advice, or a shipped system built on it, goes wrong, and the guard this dossier adopts.

| # | Failure | Where seen | Cause | Guard here |
|---|---|---|---|---|
| F1 | **The pyramid applied as a gate.** Higher drives switch on only after lower ones are met | Textbook Maslow; many needs-based game AIs | The ordering has weak support (DRV-01) | Importance times a floored urgency; no gating |
| F2 | **Chore automata.** Everyone's day is eating, sleeping and washing | Needs lists in The Sims (nine needs) and RimWorld (food, rest, recreation, comfort and more) make maintenance the main loop. The harm to variety is my reading of those lists, not a measured result `[hypothesis]` | Needs that fall steadily and are met by objects give routine, not stories | Routine satisfaction is summarised by schedule and never simulated finely (DRV-12); a deficit becomes a concern only when routine fails; stories come from blocked and threatened concerns |
| F3 | **Autonomy eats authored content.** NPC goals kill or empty things that quests need | Oblivion's Radiant AI: a merchant a quest needed was killed by addicts who wanted his drugs (L2 A1) | Agents optimise local goals with no representation of what the story depends on | A protected-fact register that goal selection reads; seeds' `exclusive` and `occur` drives (DRV-45); the director caps pressure mode (DRV-31) |
| F4 | **Quest-motive lists describe what a quest can ask, not what people want.** | Doran & Parberry's nine motivations from 753 quests: conquest 20.2 %, equipment 18.5 %, knowledge 18.3 %, protection 18.2 %, serenity 13.7 %, reputation 6.5 %, wealth 2.0 %, comfort 1.6 %, ability 1.1 % (full text). Wealth is probably low because the player, not the NPC, is paid `[hypothesis]` | The sample is shaped by fetch, kill and escort verbs | Drives come from psychology and the setting; **means** (the verbs) are a separate library (13.3) |
| F5 | **Dithering.** The actor flips between goals as weights wobble | Drive-only action selection (Blumberg; Tyrrell) | No inertia; no cost of switching | Persistence margin, level of interest, hysteresis on concern opening (13.3, 13.4) |
| F6 | **Goals gone wild.** One target narrows attention and tempts cheating | Ordóñez et al. 2009 | Single-metric goals | Optional pressure mode; capped by the director (DRV-31) |
| F7 | **False precision.** Judgement numbers read as findings | Any table of constants | Tables look authoritative | The Support code; every J number is a calibration start; calibration fixtures (section 13.7) |
| F8 | **Contested psychology built in as fact.** Terror management, scarcity tunnelling, blanket loss aversion, self-actualization as a top drive | Popular accounts | Replication failures and critiques (DRV-10, DRV-16, DRV-31; Kenrick removes self-actualization) | Not built, or built as optional and off by default |
| F9 | **Stereotype amplification.** Importance priors keyed to demographics, or gang lore applied to individuals by heritage | Genre history (L6, L10) | Archetype tables written from clichés | Priors keyed to role, circumstance and membership only (DRV-11); audit |
| F10 | **Pathologising.** Augmented people as madmen, addicts as villains, the poor as criminals | The cyberpsychosis framing is read by some as equating disability with danger (L6, informal critique) | Using illness as characterisation | `integrity` failure is rare and authored; dependence has causes (DRV-17, DRV-52); distribution checks |
| F11 | **Cardboard organisations.** Gangs from blurbs: shakedown as the only plot | Mafia-film clichés (L6) | Official purpose taken at face value | Operative drives from budgets and allocation (DRV-35, DRV-37); protection as a service |
| F12 | **Debt as "owe money, do mission."** | L6 failure mode | Reducing a relationship to a number | Ladder, conversion to obligations, health cost (DRV-20) |
| F13 | **Recruit-anyone characters with no depth.** | L2 | No history or wants of their own | Lifepath-style grievance and obligation records (DRV-50) |
| F14 | **Feud spirals that read as scripted.** Violence everywhere | Common in fiction | Intent equated with act | Rare, situational conversion (DRV-42) |
| F15 | **Hidden depth.** The system models a motive and nothing shows it | The Tale-Spin effect (L2 A14) | Surface does not reflect internals | Every concern has a legible cue in speech, route or posture; attribution errors appear on the surface (DRV-48) |
| F16 | **Mindless agents because the rules are trivial.** | SimCity's agents (L2) | Rules too simple to see | Concerns with bindings and history, not a lone meter |
| F17 | **Self-reported importance misleads.** | People under-report status motives (Anderson; Sheldon) | Stated and revealed importance differ | Use revealed importance for the model of V (DRV-49) and for archetype priors (DRV-05) |

**Critiques of the sources themselves.**
- *Maslow:* weak evidence for the ordering; the original is not the pyramid; self-actualization lacks a functional basis in the evolutionary revision (Kenrick et al.).
- *Reiss:* the "largely unrelated desires" claim sits uneasily with the circular structure found for values; his early critique of intrinsic motivation is a position, not a settled result. I found no formal peer critique; this is a gap in my search.
- *SDT:* universality across cultures is contested; measures of satisfaction and frustration overlap.
- *Schwartz:* the survey is long and responses crowd at the top; value boundaries are artificial (a published overview notes it).
- *Socioemotional selectivity:* a study reported in a commentary found expansive horizons predicted larger networks and wellbeing, the reverse of the usual prediction.
- *Life history:* the "constellation of deprivation" is argued against by commentators who find the record more divergent.
- *Goal-setting:* the field's own critics list the side effects of overuse (Ordóñez et al.).
- *Commitment models:* continuance commitment has an unstable factor structure in some analyses; the investment model's evidence is correlational.
- *Gang studies:* Levitt & Venkatesh describe one gang in one neighbourhood from the leader's records; Venkatesh's methods have drawn criticism (L6, memory).
- *Graeber:* his debt history is challenged on barter, on later history and on the search for origins by several reviewers (summaries).

---

## 5. Tensions with other disciplines

| With | The tension | How this dossier resolves it, or leaves it |
|---|---|---|
| **Perspectives and "V is observed, never owned"** (D-09, D-10) | A shared drive catalogue could look like a model of V | The catalogue is a vocabulary. Beliefs about V are distributions over profiles, never pins (DRV-49). The catalogue contains no V-specific entries |
| **Authored content** (layer 4) | Authors want fixed characters; generated drives vary | Authored drives are pins with reasons; unpinned drives generate. Authors can write a character in tabletop words (8.7). Open: how much to let a fixed character's drives drift |
| **The director's pacing** | NPC autonomy against designed pacing (Radiant AI) | Pressure and protected-fact controls (F3); the director holds a drive of its own (section 12) |
| **Cost and level of detail** | Rich concerns for everyone are unaffordable | Derived urgency, dormant concerns, a live-concern cap (DRV-12, DRV-32); coarse tiers use family-level aggregates (open question 2) |
| **Ethics and representation** | Archetype priors and group lore risk stereotype; addiction and cyberpsychosis risk pathologising | DRV-11, DRV-17, DRV-52; the audit in evaluation |
| **Relationships dossier** (REL-02) | Both model commitment | Here the drive and the group side; relationship variables there. Shared form: satisfaction, investment, alternatives |
| **Feud dossier fields** (SYS-21 hazard shapes) | Same material seen from drive and from event | Drive side here (DRV-18, DRV-42); event rates and Lanchester resolution stay with the feud material |
| **Player motivation** (MOT-01) | NPC drives and player drives use the same psychology | Kept apart: nothing here models the player's motivation beyond DRV-49 |
| **Determinism** (kernel) | Rich psychological state wants memory | Everything derived or pinned; unpinned state regenerates (DRV-12) |

---

## 6. Lateral links

- **Derived urgency is the foundation's own lazy resolution.** Urgency is a locality sampled from timestamps, regenerated when nothing is pinned ([foundation §4, rule 4](../foundation.md#4-rules)).
- **A concern is the "blocked context" of [DS-56](../design-seeds.md).** Hooks come from concerns that are blocked and that V might unblock. The seven generators say how a concern comes to exist.
- **Kenrick's overlapping triangles are the additive frames** of [foundation §5](../foundation.md#5-context-and-relevance): earlier motives never switch off, they sit under later ones.
- **Implementation intentions are `reactsTo` indexes.** An if-then plan is a cue the world watches for, which is how the kernel matches changes to interests ([kernel §10.5](../spec/kernel.md#105-changes-and-matching)). Same idea as storylet preconditions (SEL-04) and as the rule matching in dynamic dialogue (EXP-03).
- **Level of interest is habituation** in pacing work (PAC dossiers) and the "drama" fatigue in Booth's director.
- **The goal-gradient is the deadline clock** of tabletop fronts and clocks (CRA-01): visible progress towards a due point drives action.
- **Strain is the missing "motivated offender"** of routine-activity theory (SYS-03), which the lens noted takes motivation as given.
- **Group aspiration levels are the director's target curve** applied to an organisation: performance against an adaptive target drives search.
- **Exit, voice and loyalty** are the engine's membership terms (strength, exit cost, visibility; kernel §12) seen from the economics side.
- **Operative versus official goals** is the same split as belief versus truth in [foundation §5.4](../foundation.md#54-perspectives-everyone-has-their-own-model): what a group says is a belief held about it, including by itself.
- **Lifepath enemies** (who, cause, capability, revenge) are the grievance records that feed `vengeance` and `threatenedBy`.

---

## 7. Open questions

1. **Calibration.** Every J number needs fixtures: time constants, floors, thresholds, caps, lags. Which behaviours should the fixtures measure first? (Suggested: goal switches per game hour; share of live concerns that are wishes; callback lag spread; exit rate by alternatives.)
2. **Coarse levels.** What does a district's population look like in drives at a coarse tier: a distribution per family, a per-archetype mean, or a sample? The foundation leaves frame budgets and pruning open (open question 4).
3. **Does importance learn?** Repeated frustration or success could shift importance. The value-change literature says change is slow and tied to life events (Bardi & Goodwin); the engine currently changes importance only through event contributions. Should failure of a long goal count as such an event?
4. **Is `money` two drives?** This dossier keeps one drive and splits its importance (acquisitive) from its urgency (shortfall). A split into `money` and `wealth` may read more cleanly in authored content.
5. **Group decisions.** Who decides inside a group, and how far leaders' private drives bend it? The formula in section 11.2 is a placeholder for S1's decision operations.
6. **Legibility.** How much of a concern should a passer-by show? Too little and the depth is wasted (F15); too much and the world reads as a quest board.
7. **Attribution error by default?** Should NPCs make attribution errors by default, or only where a story wants them? They are realistic and they generate misunderstanding, but they also cost evidence handling.
8. **Evidence gap.** All the psychology is from real populations in ordinary conditions. Night City's extremes (chrome, mass surveillance, corporate dependency) have no empirical base. How do we test these models other than by play?
9. **Archetype data.** The game's character records give faction, kind and permanence but not occupation or personality (population page, section 7). Where does an NPC's archetype come from at generation? (Candidate: community entry names and `visualTags` as hints, authored overrides, and weighted sampling.)
10. **Cross-check with the corpus.** Once P2's decomposed quests exist, do the quest-giver motives in vanilla gigs fall into the catalogue's concerns without leftovers? That is the corpus test (P1 §2.6) for this dossier.

---

## 8. Catalogue v1 (individual drives)

The catalogue is data. A content pack may add or override drives ([foundation §5.1](../foundation.md#51-drives-what-governs-relevance)). It has **10 families** (the draft's, with the same names) and **39 drives**. The kernel's `core:drive-state` takes a drive id, an importance and an urgency ([kernel §2.6](../spec/kernel.md#26-the-core-schema)), and its group-inheritance rule matches a member's frame to a group's concern *of the same drive family* ([kernel §12](../spec/kernel.md#12-groups-and-membership)). So the family is a field on every drive, and group drives (section 11) use the same family ids.

Family ids: `body`, `survival`, `resources`, `bonds`, `standing`, `power`, `self`, `pleasure`, `justice`, `legacy`. The kin drive keeps the id `family`, as in the kernel's fixture F-8; the cluster is always called a "family" in capitals or by its id to avoid confusion.

### 8.1 The ten families and where they come from

A cell names the equivalent in each source. A dash means that source has no such cluster. The aim is to show that every family has at least two independent supports, and where only the setting or judgement supports a drive.

| Family | Maslow 1943 | Kenrick et al. 2010 | Reiss 2004 | SDT, Sheldon et al. | Schwartz | Fiske | Game lists | Tabletop Lifepath |
|---|---|---|---|---|---|---|---|---|
| **body** | physiological | immediate physiological needs | eating, physical exercise | physical thriving (low) | – | – | Sims: hunger, energy, bladder, hygiene, comfort; RimWorld: food, rest, comfort | – |
| **survival** | safety | self-protection | – | – (security in unsatisfying events) | security | trusting | Doran & Parberry: protection; Schank & Abelson: preservation, crisis | enemies |
| **resources** | safety (resources) | – | saving | money-luxury (low) | security, power | – | D&P: wealth, equipment | money; family crisis (debt) |
| **bonds** | love and belonging | affiliation: romantic, friends, family; mate retention; parenting | family, romance, social contact, acceptance | relatedness | benevolence | belonging | Sims: social; Dwarf Fortress: be with family | family, friends, love, tragic love |
| **standing** | esteem | status and esteem | status, acceptance | self-esteem; popularity (low) | power, achievement | enhancing self | D&P: reputation | repair reputation, fame, feared and respected |
| **power** | – | – | power | – | power | controlling | D&P: conquest | power and control |
| **self** | self-actualization | (dropped) | independence, idealism | autonomy, competence, meaning | self-direction | controlling | DF: be creative | the "style" and "attitude" tenets |
| **pleasure** | – | – | curiosity | – | stimulation, hedonism | understanding | Sims: fun; RimWorld: recreation; D&P: knowledge | knowledge |
| **justice** | – | – | vengeance, honour, idealism, tranquility | – | conformity, tradition, universalism | – | D&P: serenity | honour, word, vengeance |
| **legacy** | – | parenting | family, honour | – | tradition | – | – | escape the street, leave the past |

Reading it:
- Every family has at least three non-empty cells. `legacy` is the thinnest in substance: its cells are Kenrick's parenting, Reiss's family and honour, the setting's own escape goals, and the life-span work on horizons (which supports the idea of legacy but not as a basic desire). Its existence is rated **P** for that reason.
- Self-actualization is not a family. The evolutionary revision removes it as a separate need, and what it stood for splits into `mastery`, `expression` and `meaning`.
- No source lists **evasion** (not being caught), **debt** or **reciprocity** as basic desires. They are in the catalogue because the setting makes them engines of story (L6, L7). Their existence is rated **P**, not **S**.

### 8.2 What moved from the draft

Every item in the draft table has a home. Four drives have no counterpart in the draft: `comfort`, `mastery`, `serenity` and `roots`. Two draft items are not drives.

| Draft item | In v1 | Why |
|---|---|---|
| Hunger | `sustenance` | Renamed; includes thirst |
| Rest | `rest` | Kept |
| Health, pain | `health` | One drive; pain is the signal of a health concern |
| Addiction (stims, braindances) | `craving` | Renamed; an acquired drive with its own urgency model |
| Staying alive, avoiding harm, escaping danger | `safety` | One drive; fear is its signal (below) |
| Avoiding the police | `evasion` | Widened to anyone who pursues |
| Money | `money` | Kept; urgency is a shortfall, importance is acquisitiveness (DRV-05) |
| Debt, protection payments | `debt` | Protection money is a debt with a collector |
| Housing | `shelter` | Renamed |
| Work | `work` | Kept |
| Family | `family` | Kept; includes parenting |
| Partner and romance | `partner` | Kept |
| Friends | `friendship` | Kept |
| Crew or gang, belonging | `belonging` | Merged; the group is named by the membership edge |
| Obligation | `reciprocity` (and `honour`) | Split by whether the obligation is a favour or a code |
| Status, respect | `status` | Respect and status are one drive with an audience (DRV-05) |
| Street cred, reputation | `streetcred` | Reputation is the audience's belief; street cred is the street's |
| Face | `honour` | Face is the public side of honour |
| Fame | `fame` | Kept |
| Advancement, corporate ladder | `ambition` | Merged |
| Control | `power` | Kept |
| Territory | `territory` | Kept |
| Wealth | `money` (acquisitive importance) and `ambition` | Not separate |
| Freedom | `autonomy` | Renamed |
| Body and chrome | `chrome` | Kept |
| Humanity | `integrity` | Renamed; wider than implants |
| Self-expression, art | `expression` | Merged |
| Faith, ideals | `meaning`, with `justice` for the fairness half | Split |
| Interests and hobbies | `mastery`, `curiosity` | Split by whether the aim is skill or finding out |
| Thrills | `thrill` | Kept |
| Novelty | `curiosity` | Merged |
| Fun | `pleasure` | Kept |
| Revenge | `vengeance` | Renamed |
| Honour | `honour` | Kept |
| Guilt | `atonement` | Renamed |
| **Fear** | *removed* | Fear is the signal of a threat concern (`safety`), not a want |
| Leaving Night City | `escape` | Widened to any exit |
| Providing for the next generation, a mark on the world | `legacy` | Merged |
| **Facing mortality** | *removed as a drive* | A horizon change and a concern trigger (DRV-09, DRV-10) |

### 8.3 Table A: identity

**Kind** sets the floor `φ` used in the weight (section 9.1): **D** deficit (0.10), **M** mixed (0.30), **G** growth (0.50), **L** latent, mattering only once triggered (0.00). **Horizon:** *now* is minutes to hours, *soon* is days up to a fortnight, *long* is longer. **Scope:** whose welfare it concerns: self, kin (household and close relatives), group, or place (a district or the city). **Support:** existence · form of urgency model · numbers (S, P, J as defined above).

| # | Id | Family | Meaning | Kind | Horizon | Scope | Support |
|---|---|---|---|---|---|---|---|
| 1 | `sustenance` | body | Food and drink | D | now | self | S·P·J |
| 2 | `rest` | body | Sleep and recovery | D | now | self | S·S·P |
| 3 | `health` | body | Injury, illness, pain and treatment | D | soon | self | S·P·J |
| 4 | `craving` | body | Dependence on a substance, stim or braindance | D | now | self | P·P·J |
| 5 | `comfort` | body | Warm, dry, clean, pleasant surroundings | D | now | self | S·J·J |
| 6 | `safety` | survival | Avoiding bodily harm, for self and those close | D | now | self | S·P·J |
| 7 | `evasion` | survival | Not being caught, found or identified | L | now | self | P·J·J |
| 8 | `money` | resources | Funds enough for what is due | D | soon | self | S·P·J |
| 9 | `debt` | resources | What is owed, to whom, and what follows if unpaid | D | soon | kin | S·P·J |
| 10 | `shelter` | resources | A safe place to live | D | soon | kin | S·P·J |
| 11 | `work` | resources | A livelihood: job, gigs, clients | M | long | self | P·J·J |
| 12 | `family` | bonds | Kin care and ties, including parenting | G | long | kin | S·P·J |
| 13 | `partner` | bonds | Romantic and sexual partnership: finding it and keeping it | M | long | kin | S·P·J |
| 14 | `friendship` | bonds | Trusted company; someone to count on | M | soon | self | S·P·J |
| 15 | `belonging` | bonds | Standing membership of a crew, gang, firm, scene or congregation | M | long | group | S·P·J |
| 16 | `status` | standing | Respect and rank in a group or society | M | long | group | S·P·J |
| 17 | `streetcred` | standing | A reputation for capability, nerve and reliability among the street | M | long | group | P·J·J |
| 18 | `fame` | standing | Attention from a wide, anonymous audience | G | long | place | J·J·J |
| 19 | `power` | power | Control over people, resources and outcomes | G | long | group | S·J·J |
| 20 | `ambition` | power | Advancement along a path: ladder, rank, patronage | G | long | group | P·J·J |
| 21 | `territory` | power | Control of a place: turf, pitch, patch | M | long | group | P·J·J |
| 22 | `autonomy` | self | Freedom from control and coercion | M | long | self | S·P·J |
| 23 | `mastery` | self | Competence and craft | G | long | self | S·J·J |
| 24 | `expression` | self | Style, creativity, self-presentation | G | soon | self | P·J·J |
| 25 | `chrome` | self | Wanting to augment or modify the body | G | long | self | J·J·J |
| 26 | `integrity` | self | Keeping a sense of self intact against chrome, drugs, trauma and coercion | M | long | self | P·J·J |
| 27 | `meaning` | self | Faith, cause, purpose | G | long | group | P·J·J |
| 28 | `curiosity` | pleasure | Finding out; exploring; novelty | G | soon | self | S·P·J |
| 29 | `thrill` | pleasure | Risk, speed, intensity | G | soon | self | P·J·J |
| 30 | `pleasure` | pleasure | Enjoyment, fun, appetites | M | now | self | S·P·J |
| 31 | `vengeance` | justice | Retaliating against a specific wrongdoer | L | soon | kin | S·P·J |
| 32 | `honour` | justice | Keeping one's code, word and face | M | now | group | P·P·J |
| 33 | `justice` | justice | Seeing wrongs righted; fairness | L | soon | place | P·P·J |
| 34 | `reciprocity` | justice | Repaying and being repaid favours | L | soon | self | P·P·J |
| 35 | `atonement` | justice | Making amends for one's own wrong | L | long | self | J·J·J |
| 36 | `serenity` | justice | Peace of mind: relief from fear, grief, guilt and rumination | D | soon | self | P·J·J |
| 37 | `escape` | legacy | Leaving a place, group or past | M | long | kin | P·P·J |
| 38 | `roots` | legacy | Attachment to a home place; the pull to stay | M | long | place | P·J·J |
| 39 | `legacy` | legacy | Leaving something lasting; providing for the next generation | G | long | kin | P·J·J |

Counts by family: body 5, survival 2, resources 4, bonds 4, standing 3, power 3, self 6, pleasure 3, justice 6, legacy 3.

### 8.4 Table B: urgency models and magnitudes

Model letters are defined in [section 9](#9-urgency-models). Times are game time. Every number is a calibration start (**J**) unless the Support column above gives a **P** or **S** in the third place.

| Id | Model | Parameters | Relief and notes |
|---|---|---|---|
| `sustenance` | R | τ = 5 h | A meal sets relief 0.9. Prolonged U above 0.9 for over 24 h pulses `health` |
| `rest` | R × Y | τ = 18 h awake (14 to 26 across people); circadian gate peaks 03:00 to 05:00; sleep discharge τ_s = 2 h (1.2 to 2.9) | Sleep in a safe bed (`shelter`, `safety` low) discharges fully in 8 h. Fear or noise slows discharge |
| `health` | P, plus C for chronic | Pulse u0 = severity (minor 0.3, serious 0.6, critical 0.9); healing τ = 2 d (minor) to 10 d (serious); chronic C = 0.3 to 0.6 | Treatment gives relief 0.7 |
| `craving` | R + P (cue) | Stim τ_w = 8 h, milder substances 24 h, braindance 12 h; tolerance shortens τ_w by 5 % per dose to a floor of 40 %; cue pulse u0 = 0.4, τ = 30 min | A dose gives relief 0.9 and restarts the clock. Detox is a long goal, not a satisfier |
| `comfort` | S | Gap between the place's comfort score and the actor's preference | Low floor. Rain, cold and noise raise it a little (kernel fixture C-a) |
| `safety` | X + P | X: severity × exp(−d / λ), λ = 2 min of expected time to contact (20 m on foot); trauma pulse u0 = 0.5, τ = 10 d after an assault | Cover, a protector, exits known, the threat leaving |
| `evasion` | X | U = (heat / 5)^0.8, heat 0 to 5 as the game's prevention presets use it; decays as heat cools | A safe house, bribed witnesses, a changed face |
| `money` | S | Lookahead H = 72 h; need = obligations due within H + 20 % of a month's spend as a buffer; U = clip(1 − cash / need) | Derived from facts; no timestamp |
| `debt` | D per debt, combined 1 − Π(1 − Uᵢ) | κ = 4, τ_d = 3 d. Ladder after the due time: +1 d reminder, +3 d collector, +7 d violence or seizure for informal and gang creditors; legal action or repossession for corporate ones | Payment, forgiveness, a swap into a favour |
| `shelter` | D + P | Rent cycle 30 d, τ_d = 5 d; eviction notice pulse u0 = 0.9 | Lease paid; a safe bed |
| `work` | S + P | Income over 30 d against need; layoff pulse u0 = 0.8, τ = 14 d, ending at new income | A job, a gig paid, a trusted client |
| `family` | C + P + R | C = 0.4; kin harm pulse u0 = 0.9, τ = 3 d; kin illness 0.6; contact R with τ = 7 d, floored at 0.2 | Kin safe and present; helping them |
| `partner` | R (seeking) or C + P (partnered) | Seeking: τ = 14 d, capped 0.6, scaled by a sociality trait. Partnered: C = 0.3; rival or danger pulse u0 = 0.7 | Meeting a partner; time together |
| `friendship` | R | τ = 72 h × sociality | A meaningful contact resets 0.8 |
| `belonging` | C + P + R | C = 0.3; exclusion or demotion pulse u0 = 0.7, τ = 10 d; contact decay R τ = 14 d | Acceptance staged in public (DRV-43) |
| `status` | C + P | C = 0.3; humiliation pulse u0 = 0.6, τ = 5 d; wins give relief | Public recognition, promotion |
| `streetcred` | O + R | Demonstrations fade with τ = 60 d, so U rises without new ones; gated by audience affordance | A witnessed demonstration |
| `fame` | O | Base 0.1, rising with an audience affordance | Attention |
| `power` | C + O | C from importance; O when a lever is available | Gaining control |
| `ambition` | O + D | b = 0.2 plus an annual review window with κ = 2, τ_d = 20 d | A rung opens; patron favour |
| `territory` | X + S | Incursion nearness × severity; share of turf against aspiration | Holding the turf |
| `autonomy` | S + P | Perceived constraint from orders, surveillance and binding debts; coercion pulse u0 = 0.6, τ = 3 d | Free choice; slipping a leash |
| `mastery` | O + R | Practice-hunger τ = 3 d; opportunity b = 0.2 | Progress; a hard problem solved |
| `expression` | C + O | C = 0.3; opportunity | Making something seen |
| `chrome` | O + S | Gap between desired and held augmentation, gated by affordability | An affordable, compatible implant |
| `integrity` | X on strain | Latent strain σ (implant load share, trauma, substance); U = logistic((σ − 0.7) / 0.1) | Rest, therapy, grounding company, removing implants |
| `meaning` | C + P + R | C = 0.2; crisis pulse u0 = 0.5, τ = 20 d; ritual R τ = 7 d | Ritual; serving the cause |
| `curiosity` | R + P | τ = 24 h; cue pulse u0 = 0.4, τ = 1 h | Finding out |
| `thrill` | R + O | τ = 72 h | A risk taken |
| `pleasure` | R × Y | τ = 24 h × an evening factor | A meal, drink, music, company |
| `vengeance` | P (latched) | u0 = severity × salience; hold at 0.5 × u0 until resolved; decay τ = 14 d if relationship value is high, 90 d if low | Retaliation, the target humbled, or reconciliation |
| `honour` | C + P | C = 0.3; witnessed insult pulse u0 = 0.8, τ = 2 d (honour culture: u0 × 1.5, τ × 2) | Answering the insult; keeping the word |
| `justice` | P | Witnessed breach u0 = 0.5 × nearness; τ = 10 d; repeated breaches accumulate | Remedy, price restored |
| `reciprocity` | D with sampled lag | Lag log-normal, median 3 d (small) to 14 d (large), σ 0.6; τ_d = 2 d | The favour returned |
| `atonement` | P (latched) | u0 = 0.5 × gravity; τ = 60 d | Amends; forgiveness |
| `serenity` | S | Stress load L = Σ weights of blocked or active high-pull concerns, divided by a reference; U = clip(L) | Rest, safe company, resolved concerns |
| `escape` | S (push) | Push = f(debt, danger, enemies, hopelessness); feasibility from capability (money, papers, contacts) | A route out |
| `roots` | C + P | C = 0.3; threat to home pulse u0 = 0.8, τ = 30 d | Home intact |
| `legacy` | C | C = 0.1 + 0.5 × logistic((age − 45) / 8); mortality-cue pulse u0 = 0.6, τ = 60 d | An heir provided for; a work finished |

### 8.5 Table C: importance priors

`I0` is the baseline importance (0 to 1) for a typical resident. `L1` is the loading on the axis *openness to change (+) against conservation (−)*, and `L2` on *self-enhancement (+) against self-transcendence (−)*. They follow the placement of values in Schwartz's circle and are **judgement**. `κ` is the horizon exponent (DRV-09): positive means the drive matters more with a longer perceived future. `φ` is the floor from table A.

| Id | I0 | L1 | L2 | κ | φ |
|---|---|---|---|---|---|
| `sustenance` | 0.9 | 0 | 0 | 0 | 0.10 |
| `rest` | 0.8 | 0 | 0 | 0 | 0.10 |
| `health` | 0.8 | 0 | 0 | 0 | 0.10 |
| `craving` | 0.1 | +0.5 | +0.5 | 0 | 0.10 |
| `comfort` | 0.35 | +0.5 | +0.5 | 0 | 0.10 |
| `safety` | 0.85 | −0.8 | +0.2 | 0 | 0.10 |
| `evasion` | 0.3 | +0.3 | +0.3 | 0 | 0.00 |
| `money` | 0.6 | 0 | +0.6 | +0.1 | 0.10 |
| `debt` | 0.5 | −0.5 | 0 | 0 | 0.10 |
| `shelter` | 0.7 | −0.8 | 0 | 0 | 0.10 |
| `work` | 0.6 | −0.2 | +0.5 | +0.2 | 0.30 |
| `family` | 0.65 | −0.5 | −0.6 | −0.3 | 0.50 |
| `partner` | 0.5 | 0 | −0.4 | 0 | 0.30 |
| `friendship` | 0.5 | +0.2 | −0.6 | −0.3 | 0.30 |
| `belonging` | 0.55 | −0.6 | −0.3 | −0.2 | 0.30 |
| `status` | 0.4 | 0 | +0.8 | 0 | 0.30 |
| `streetcred` | 0.2 | +0.3 | +0.8 | 0 | 0.30 |
| `fame` | 0.15 | +0.4 | +0.9 | 0 | 0.50 |
| `power` | 0.25 | +0.2 | +1.0 | 0 | 0.50 |
| `ambition` | 0.35 | +0.3 | +0.9 | +0.4 | 0.50 |
| `territory` | 0.15 | −0.2 | +0.8 | 0 | 0.30 |
| `autonomy` | 0.5 | +1.0 | +0.2 | 0 | 0.30 |
| `mastery` | 0.45 | +0.5 | +0.7 | +0.3 | 0.50 |
| `expression` | 0.4 | +0.9 | 0 | 0 | 0.50 |
| `chrome` | 0.35 | +0.6 | +0.5 | 0 | 0.50 |
| `integrity` | 0.4 | 0 | −0.2 | 0 | 0.30 |
| `meaning` | 0.3 | −0.5 | −0.7 | −0.3 | 0.50 |
| `curiosity` | 0.4 | +1.0 | −0.2 | +0.2 | 0.50 |
| `thrill` | 0.3 | +1.0 | +0.3 | 0 | 0.50 |
| `pleasure` | 0.5 | +0.6 | +0.5 | −0.2 | 0.30 |
| `vengeance` | 0.3 | +0.2 | +0.6 | 0 | 0.00 |
| `honour` | 0.4 | −0.5 | +0.3 | 0 | 0.30 |
| `justice` | 0.35 | +0.2 | −0.9 | 0 | 0.00 |
| `reciprocity` | 0.5 | −0.4 | −0.4 | 0 | 0.00 |
| `atonement` | 0.2 | −0.2 | −0.7 | 0 | 0.00 |
| `serenity` | 0.5 | −0.7 | −0.3 | −0.3 | 0.10 |
| `escape` | 0.35 | +0.6 | 0 | 0 | 0.30 |
| `roots` | 0.45 | −0.8 | −0.3 | 0 | 0.30 |
| `legacy` | 0.3 | −0.3 | +0.1 | +0.5 | 0.50 |

### 8.6 Table D: satisfiers and threats

Written as kinds of world fact, using the kernel's effect vocabulary (`harm`, `kill`, `help`, `protect`, `rescue`, `take`, `give`, `expose`, `conceal`, `move`, `meet`; [kernel §10.8](../spec/kernel.md#108-effects-and-cross-pressure)) and kinds of place, person and group. When a drive opens a concern (section 13), these are instantiated into the frame's `wants`, `blockedBy`, `threatenedBy` and `protects` selectors with the concern's bindings.

| Id | Satisfiers | Threats |
|---|---|---|
| `sustenance` | `give` food or drink to self; a stall or kitchen open; money to buy | Food scarce or priced out; a stall shut; no money; being locked out |
| `rest` | A safe bed for hours; a break in shifts | Night work; pain; fear of a place; stims; noise |
| `health` | `help` from a medic or ripperdoc; medicine; time | `harm` events; infection; implant rejection; withdrawal; care unaffordable |
| `craving` | `give` of the substance or a session; a clinic (long) | Dealer arrested or killed; supply cut; price rise; enforcement |
| `comfort` | A warm, dry, clean place | Rain or cold exposure; filth; noise; crowding |
| `safety` | A `protect`or present; cover and exits; being armed; the threat leaving | `harm` nearby; a hostile group in view; a drawn weapon; a prior assault |
| `evasion` | Pursuers losing the trail (`conceal`); a safe house; a bribe; a new identity | Witnesses; cameras; a rising heat level; an informer; a warrant known to others |
| `money` | `give` of eddies to self; pay received; a sale; a windfall | `take` of eddies; theft; fines; price rises; a lost job; bills falling due |
| `debt` | Payment to the creditor; forgiveness or transfer; the creditor removed; accepted service in lieu | A due date passing; a collector's visit; interest; collateral (even a body part or implant) at risk; a hostile creditor group |
| `shelter` | Rent paid; a safe bed; a landlord appeased | Eviction notice; rent rise; demolition; a gang taking the building; no vacancy |
| `work` | A job offered; a gig paid; a client's trust; a stable shift | Layoff; blacklisting; a competitor; a fixer who stops calling; injury |
| `family` | Kin safe and present (`meet`); `help` or `protect` or `rescue` for kin; providing | `harm`, `kill` or `expose` on kin; kin in debt; estrangement; kin recruited by a gang |
| `partner` | `meet` a desirable partner; affection; time together | A rival; infidelity (`expose`); the partner in danger; separation; rejection |
| `friendship` | `meet` trusted friends; shared activity; help exchanged | Betrayal (`expose`, `take`); a friend's death; distance; being dropped |
| `belonging` | Acceptance rites; regular company; tasks assigned; colours and uniform | Exclusion; demotion; "not one of us"; the group disbanding; a failed loyalty test |
| `status` | Public recognition; promotion; deference | Public humiliation; demotion; a rival promoted; a failure exposed |
| `streetcred` | A capability demonstrated before the right audience; reliable delivery; vouching | Cowardice seen; failure; informing; a public beating; being outbid |
| `fame` | Media coverage; recognition by strangers; a release or a clip going wide | Scandal; being ignored; a rival's fame |
| `power` | Control gained over people or resources; subordinates; keys and access | Control lost; being overruled; a rivals' coalition; sanctions |
| `ambition` | A rung opening; a patron; a milestone; a rival removed | A blocked promotion; a patron's fall; scandal; a rival ahead |
| `territory` | Holding the turf; tolls collected; rivals absent | An incursion (`move`) by a rival; a police sweep; demolition; a corporate takeover |
| `autonomy` | Free choice; freelancing; slipping surveillance | Orders and coercion; binding contracts; monitoring; debt bondage |
| `mastery` | Practice and progress; a hard problem solved; tools; a teacher | No chance to practise; obsolete skills; injury; public correction; tools taken |
| `expression` | Work seen; style; customisation; a stage | Censorship; poverty restricting means; ridicule; a forced uniform |
| `chrome` | An affordable, compatible implant; clinic access; a status upgrade | Cost; rejection; repossession; capacity full; the ripperdoc gone |
| `integrity` | Rest; therapy; grounding company; removing implants; time offline | Heavy implant load; trauma; drug exposure; coercion; lost memory or identity; cyberpsychotic episodes nearby |
| `meaning` | Ritual; a community of faith; serving a cause; a mentor | Faith crisis; desecration; the cause defeated; hypocrisy exposed |
| `curiosity` | Finding out (`give` of information); a new place; a puzzle solved | Information withheld (`conceal`); boredom; censorship; dead ends |
| `thrill` | A high-intensity event; a risk taken; speed; a fight | Safety enforced; routine; injury; prohibition |
| `pleasure` | A meal, drink, music, sex, a game or braindance, company | No money or time; a crackdown; bad company |
| `vengeance` | `harm` to the wrongdoer by self or by a witnessed proxy; the wrongdoer humbled | Wrongdoer unreachable or protected; a stronger group; the wrongdoer's death (blocks the act); an authority forbidding it |
| `honour` | Keeping one's word; answering an insult; being seen to keep the code | A witnessed insult; a forced broken promise; shame; being made to betray the code |
| `justice` | The wrongdoer punished by authority or community; a norm or price restored | A witnessed breach; impunity; corporate abuse |
| `reciprocity` | `give` or `help` to the benefactor; thanks accepted | A favour called too early or too late; the benefactor dead; repayment impossible; a favour used as leverage |
| `atonement` | Amends made; forgiveness; confession | The victim dead; discovery (`expose`); retaliation |
| `serenity` | Quiet, safe time; resolved concerns; trusted company; sleep | Many blocked high-pull concerns; trauma cues; loud or unsafe places; grief events |
| `escape` | A route out (transport, papers, funds, contacts); a new life elsewhere; leaving the group | A blocked exit (debts, a group's exit cost, a border, no money); kin ties; being found |
| `roots` | The home place intact; neighbours and routines | Eviction; demolition; takeover; violence; neighbours leaving |
| `legacy` | An heir provided for; a work finished or recognised; the name carried | An heir lost; the work destroyed or erased; dying with nothing left |

**Two worked selector templates** in the kernel's notation (compare calibration fixture C-b in [kernel §16.2](../spec/kernel.md#162-calibration-fixtures)). `$self` is the actor and `$grp` the creditor group bound when the concern opens.

```
money / debt concern "protection payment":
  threatenedBy: { kind: core:person,
                  where: [@role = collector, has-edge member-of -> $grp] }
  threatenedBy: { kind: core:place, scope: { nodes: [$stall] }, where: [@role = place] }
  wants:        { kind: core:event, where: [@effect = give, @role = target is $self] }   // pay-in

family concern "kin in danger":
  protects:     { scope: { nodes: [$kin] }, where: [@effect in {harm, kill, expose, take}] }
  reactsTo:     { kind: core:person, where: [has-edge member-of -> $hostile_group] }
```

### 8.7 Lifepath vocabulary mapped to the catalogue

For authors who write in the tabletop's words (DRV-51). Items are paraphrased and grouped.

| Tabletop item (paraphrased) | Drive or concern |
|---|---|
| Values: material gain | `money` (acquisitive importance), `ambition` |
| Values: honour, one's word, honesty | `honour`; honesty adds `justice` weight and lowers the norm penalty for deceit (DRV-34) |
| Values: knowledge | `curiosity` |
| Values: vengeance | `vengeance` |
| Values: love | `partner`, `family` |
| Values: power | `power` |
| Values: family, friends | `family`, `friendship` |
| Attitude to people (liking most, using, distrusting) | Importance of `friendship` and `belonging`; default trust in attribution (DRV-48) |
| Life goal: mend a reputation | `streetcred`, `status`, `honour` |
| Life goal: gain power and control | `power`, `ambition` |
| Life goal: escape the street; leave the past | `escape`, with `atonement` or `serenity` when the past is a wrong |
| Life goal: make enemies pay; trace those responsible | `vengeance`, `justice` |
| Life goal: reclaim what is owed | `justice` or `money` bound to a debtor |
| Life goal: save people from one's background | `family`, `justice`, `atonement` |
| Life goal: fame; be feared and respected | `fame`; `streetcred`, `status` |
| Family crisis (a debt) | `debt` record at generation |
| Friends | `friendship` and kin edges |
| Enemies (who, cause, capability, planned revenge) | A grievance record: a `vengeance` pulse and a `threatenedBy` interest (DRV-50) |
| Tragic love | A `partner` loss pulse and `serenity` stress load |

### 8.8 The catalogue as data

A drive definition could look like this. It is illustrative of the fields, not a schema decision (S4 owns the content-pack format).

```json
{
  "id": "debt", "family": "resources", "kind": "D", "floor": 0.10,
  "horizon": "soon", "scope": "kin",
  "importance": { "i0": 0.5, "l1": -0.5, "l2": 0.0, "kappa": 0.0 },
  "urgency": { "model": "D", "kappa": 4, "tau_d": "3d",
               "ladder": [ { "after": "1d", "event": "reminder" },
                           { "after": "3d", "event": "collector_visit" },
                           { "after": "7d", "event": "enforcement" } ] },
  "satisfiers": [ { "effect": "give", "what": "eddies", "to": "$creditor" } ],
  "threats":    [ { "kind": "core:person", "where": ["@role = collector"] } ],
  "support": "S.P.J"
}
```

---

## 9. Urgency models

Urgency is the fast variable. It answers "how pressing is this drive for this actor right now?" and is a number from 0 to 1, stored by the kernel to 1/64.

### 9.1 From importance and urgency to frame weight

For each actor and drive, S1 gives the drive frame (kernel `level: 'drive'`) the weight

```
w = I × (φ + (1 − φ) × U)          I = importance (section 10), U = urgency, φ = floor (table A)
```

- A deficit drive (φ = 0.10) with U = 0 weighs a tenth of its importance. It rises to the full importance as the deficit becomes acute.
- A growth drive (φ = 0.50) always weighs at least half its importance. A mastery-minded person is pulled by craft even when nothing is pressing.
- A latent drive (φ = 0) matters only once triggered. A person with no grievance has no `vengeance` weight however vengeful their temperament.

The gains of DRV-08 act on the urgency before this step: `U ← clip(U × g)`, with `g_threat` for drives whose urgency model is `X` or a threat-driven `P`, and `g_reward` for `O` and `R` on growth drives **[J]**.

### 9.2 The model families

Time `t` and durations are in game time. All models take only timestamped facts as input (DRV-12).

| Code | Name | Form | Input facts |
|---|---|---|---|
| **R(τ)** | Rising deficit | `U = 1 − exp(−Δ / τ)`, where `Δ` is time since the last relief, scaled by relief (below) | Last-satisfied time |
| **S(H)** | State ratio | `U = clip(1 − available / required)` over a lookahead `H` | Current stocks and what is due |
| **D(τ_d, κ)** | Deadline | `U = 1 / (1 + κ × max(T − t, 0) / τ_d)`; at `t ≥ T`, `U = 1` and the overdue ladder starts | Due time `T` |
| **P(u0, τ, L)** | Pulse | At an event of severity `s`: `U = u0 × s`, then `U(t) = u0 × s × exp(−(t − t_e) / τ)`; if latched (`L = 1`), `U` holds at `f × u0 × s` until a release event | Event time and severity; release event |
| **X(sev, λ)** | Proximity | `U = sev × p × exp(−d / λ)`, `p` the actor's belief that the threat is real (kernel §11), `d` distance in time to contact or in metres | Threat position, belief |
| **C(c)** | Constant | `U = c`, lifted by context (a cue or a trigger raises it) | Trait and context |
| **O(b)** | Opportunity-gated | `U = b + (1 − b) × A`, `A` the best visible affordance in 0..1 (0 when none) | Nearby satisfier affordances |
| **Y(f)** | Cycle | A multiplier `f(phase)` on another model, such as a circadian factor | Time of day |

Combining models inside one drive: sums that are really alternatives use the **maximum** (a pulse and a rising deficit); independent sources of the same kind use `1 − Π(1 − Uᵢ)` (several debts).

Why these shapes:
- `R` is the sleep model's saturating build-up (DRV-13).
- `D` is the goal-gradient: effort rises as the due point nears (DRV-15).
- `P` latched is the revenge system's hold and the grievance's decay (DRV-18).
- `X` carries the steeper avoidance gradient (DRV-16): the threat's `λ` is about 0.6 of a satisfier's.
- `S` handles drives that are really about a balance of resources: money, comfort, serenity.
- `O` is the case where nothing is lacking but something good has appeared.

### 9.3 Relief

A satisfier event gives relief `s` in 0..1 (table B). It acts on the model's input facts, not on `U` directly:
- `R`: the elapsed time is cut to `Δ × (1 − s)`.
- `P` unlatched: the pulse is cut to `(1 − s)` of its present value. Latched pulses release only on their release events (retaliation, reconciliation, the target's removal).
- `D`: paying the debt moves or clears `T`.
- `S`: the stocks change, so the ratio changes by itself.
- Partial relief is normal. A snack gives relief 0.3, a meal 0.9.

**Satiation and ratchets.** Relief is capped when `U` is already low (no benefit from a third meal). `craving` carries the tolerance ratchet of table B.

### 9.4 The unpinned default

Most people are never observed. For drives satisfied by routine (`sustenance`, `rest`, `pleasure`, `friendship`, `curiosity`), S1 defines the default urgency of an unpinned actor as a function of time of day and the actor's schedule type: for example, `sustenance` peaks before the schedule's meal times and falls after. Nothing is stored. When an observation or an event pins a last-satisfied time, the pinned fact replaces the default and the model above takes over. A drive whose routine fails (a vendor with no money for lunch) becomes a concern (section 13).

### 9.5 Evaluation, pins and cost

- S1 evaluates `U` on demand, for actors in an open frame, and at window boundaries for tiers 0 to 2. It writes an urgency pin only when the 1/64 bucket changes ([kernel §9.4](../spec/kernel.md#94-evolution), §10.1).
- A model's parameters live on the drive definition. Per-actor gains apply on top. Nothing else is stored per actor and drive except the facts the model reads (last-satisfied times, due dates, grievances).
- Tick-versus-jump independence (kernel I-15) follows because `U` is a function of facts. **Check:** run 12 windows as one tick and as twelve; urgency histories match.

---

## 10. Importance: people, archetypes and circumstances

Importance is the slow variable: how much a drive matters to this actor, whatever the moment. It is built in layers, each with its own source.

```
I(a, d) = clamp( I0_d × A(arch(a), d) × exp(σ_s × (L1_d × z1_a + L2_d × z2_a) + σ_e × e_(a,d))
                  × (H_a / H0)^κ_d × M(a, d),  0, 1 )
```

| Layer | Term | Source | Varies by |
|---|---|---|---|
| Population baseline | `I0_d` (table C) | Judgement, guided by how widely each drive appears in the lists (8.1) | Drive |
| Role | `A(arch, d)` (10.3) | Judgement; role and occupation, never demographics (DRV-11) | Archetype |
| Personal profile | `exp(σ_s (L1 z1 + L2 z2) + σ_e e)` | Schwartz's circle (axes) and Reiss's idiosyncrasy (noise); `σ_s = 0.35`, `σ_e = 0.25` **[J]** | Person |
| Circumstance | `(H / H0)^κ` | Socioemotional selectivity and life-history work (DRV-09) | Age, health, hazard |
| Membership | `M(a, d)` (10.4) | Group ethos weighted by membership strength | Groups joined |

### 10.1 Why layers

- **Between people:** the profile and the noise. Two vendors in one stall differ because of `z1`, `z2` and `e`.
- **Between archetypes:** `A`. A corporate climber and a nomad differ systematically in `ambition`, `roots`, `autonomy`.
- **Between groups:** `M`. A Valentino and a Maelstrom differ by their crews' ethos.
- **Over a life:** `H` falls with age and hazard; value changes after major events enter as recorded contributions (DRV-06).
- **Deterministic:** `z1_a`, `z2_a` and `e_(a,d)` come from keyed hashing of the actor's identity and the drive id, so the same actor always has the same profile ([kernel §1.4](../spec/kernel.md#14-random-streams)). Authored characters override any layer with a pin.

### 10.2 The personal profile

Two latent axes, each drawn from a standard normal:
- `z1`: openness to change (+) against conservation (−).
- `z2`: self-enhancement (+) against self-transcendence (−).

Drives load on them through `L1` and `L2` in table C, so correlations between drives follow the circle without a full covariance matrix. `e_(a,d)` is an independent standard normal per drive, which keeps a person from being a pure point on the circle (Reiss's point). Two cheap sanity checks: opposite poles have negatively correlated importances; the population mean of `I` stays near `I0` (the exponent's mean is not zero, so the generator rescales by the sample mean per drive **[implementation note]**).

### 10.3 Archetype multipliers

`A` is 1 for drives not listed. Values multiply `I0` before the clamp. All are **judgement**; they say which direction and roughly how far, to be calibrated on fixtures. Archetypes are roles in the world model. The game's character records give faction, kind and look tags but not occupation; `visualTags` such as `StreetVendor`, `Corporat`, `Youngster`, `Gangster`, `Biker` and `Netrunner` are hints for a mapping, not specifications (the population page's own caution), and the mapping is a hypothesis.

| Archetype | Raised | Lowered |
|---|---|---|
| Street vendor or small trader | `territory` ×3 (the pitch), `debt` ×1.3, `money` ×1.3, `family` ×1.2 | `thrill` ×0.7, `evasion` ×0.8 |
| Gang member | `belonging` ×1.5, `streetcred` ×3, `thrill` ×1.5, `honour` ×1.3, `vengeance` ×1.3, `money` ×1.2 | `safety` ×0.8, `integrity` ×0.8 |
| Gang leader | `power` ×2.5, `territory` ×3, `status` ×1.8, `streetcred` ×2.5, `ambition` ×1.5, `belonging` ×1.2 | `safety` ×0.9 |
| Corporate employee | `ambition` ×2, `status` ×1.6, `work` ×1.5, `serenity` ×1.3, `money` ×1.2 | `autonomy` ×0.7, `evasion` ×0.5 |
| Corporate executive | `power` ×2.5, `ambition` ×2, `status` ×2, `legacy` ×1.5 | `thrill` ×0.7 |
| Fixer | `money` ×1.6, `streetcred` ×2, `reciprocity` ×2, `curiosity` ×1.5 (information), `safety` ×1.2 | `expression` ×0.7 |
| Ripperdoc | `mastery` ×2, `chrome` ×2, `money` ×1.4, `reciprocity` ×1.3, `integrity` ×1.3 | `fame` ×0.5 |
| Netrunner | `curiosity` ×2, `mastery` ×1.7, `autonomy` ×1.6, `evasion` ×1.5 | `belonging` ×0.8 |
| Nomad | `family` ×1.8, `belonging` ×1.5, `autonomy` ×1.6 | `roots` ×0.3 |
| Young street resident | `thrill` ×1.8, `streetcred` ×1.8, `fame` ×1.8, `status` ×1.5, `curiosity` ×1.4, `escape` ×1.4 | `legacy` ×0.3 |
| Elder | `family` ×1.5, `legacy` ×2, `roots` ×1.5, `meaning` ×1.4, `serenity` ×1.5 | `thrill` ×0.3, `ambition` ×0.4 |
| Police officer | `work` ×1.2, `safety` ×1.3, `justice` ×1.4, `power` ×1.2, `belonging` ×1.3, `honour` ×1.2, `serenity` ×1.3 | `evasion` ×0 |
| Mercenary or solo | `money` ×1.5, `mastery` ×1.6, `streetcred` ×2, `thrill` ×1.4, `integrity` ×1.2, `autonomy` ×1.3, `honour` ×1.3 | `safety` ×0.8 |
| Dependent user | `craving` raised to about 0.8, `pleasure` ×1.5, `money` ×1.4, `serenity` ×1.5 | `health` ×0.8, `friendship` ×0.8, `integrity` ×0.7 |
| Destitute resident | `shelter` ×1.5, `safety` ×1.3, `money` ×1.2, `serenity` ×1.5 | `ambition` ×0.4, `status` ×0.5 |
| Media or performer | `fame` ×4, `status` ×1.6, `expression` ×1.6, `chrome` ×1.5, `pleasure` ×1.3 | `roots` ×0.8 |
| Night-life or service worker | `safety` ×1.4, `autonomy` ×1.4, `belonging` ×1.3 (a collective), `money` ×1.2 | none |

An archetype is chosen by weighted sampling from the actor's affiliation class, district and community entry (the game's own data supplies faction, kind and look tags), with authored overrides.

### 10.4 Membership and ethos

A group has an ethos vector over drives (section 11.3). A member's importance is multiplied by

```
M(a, d) = 1 + Σ over memberships m of  strength_m × (ethos_m,d − 1) × identification_m
```

clamped to [0.25, 3]. `strength` is the membership's `strength` ([kernel §2.6](../spec/kernel.md#26-the-core-schema)); `identification` is the affective share of commitment (DRV-30), so a coerced member takes on less of the group's ethos than a believer. This is how "a Valentino" differs from "a Maelstrom member" without any faction-specific code (the project's rule on data-driven interpretation). The group's *concerns* reach the member by the kernel's inheritance rule, separately from importance (section 11.4).

### 10.5 Circumstance

`H`, the perceived horizon, is `H = max(1, life_expectancy(age, health) − age − hazard_discount)` in years **[J]**. `hazard_discount` comes from local hazard: the district's `crimeMultiplier` and prevention preset, recent violence the actor has seen, and membership in a high-risk group. `H0 = 30`. Deprivation (poverty, debt, lack of control) enters twice: through `H`, and through the urgency of `money`, `debt`, `shelter` and `serenity`. The model deliberately does not add a separate "scarcity tunnelling" effect (DRV-31).

### 10.6 Change over time

Importance changes only by recorded contributions:
- a **major event** (bereavement, betrayal, a near-death, a windfall, an initiation) writes a contribution that shifts named drives by a stated amount, decaying slowly or not at all;
- **horizon drift** applies through `H` as the actor ages or the district changes;
- **long failure or success** at a goal may shift importance (open question 3).

Within a window, importance is constant. This keeps the slow variable slow and makes "why did she change?" answerable by tracing one contribution.

---

## 11. Drives of groups

Groups are actors ([D-08](../decisions.md)): they have drives, concerns and goals, and their leadership decides. This section gives the group catalogue, how a group's operative weights are formed, ethos vectors for the game's own factions, and how a group's concerns reach its members.

### 11.1 Group drives

Each group drive is tagged with the individual **family** it belongs to, so the kernel's inheritance rule can match a member's frame to the group's concern of the same family ([kernel §12](../spec/kernel.md#12-groups-and-membership)). Support codes as before.

| Id | Family | Meaning | Urgency model | Satisfiers and threats (kinds of fact) | Support |
|---|---|---|---|---|---|
| `continuity` | survival | The group survives as a group | X + P, with S on runway | Satisfier: threats repelled, runway restored. Threat: a leader killed, mass arrest, insolvency, a decapitating strike | P·J·J |
| `treasury` | resources | Cash and revenue enough to run | S: runway = cash ÷ burn (days); `U = clip(1 − runway / 30)`; plus the aspiration gap (DRV-36) | Income arrives, costs fall. Threat: a lost revenue stream, a war's cost, seizure, a patron's cut | S·P·J |
| `turf` | power | Control of a place or market | X on incursions, plus S for share against aspiration | Holding it, tolls collected. Threat: a rival's `move`, a police sweep, a corporate takeover | P·J·J |
| `reputation` | standing | Credible capacity and reliability, the thing others fear or trust | P on affronts (u0 = 0.7, τ = 30 d) plus R untested (τ = 45 d) | A demonstration witnessed. Threat: an affront, a failure exposed, a defection | P·J·J |
| `cohesion` | bonds | Members stay, obey and recruit | S: share of members with `strength` below 0.3 plus the 30-day attrition rate | New members, rites, pay. Threat: defection, a split, a rival's offer | P·P·J |
| `legitimacy` | standing | Acceptance by the community and the authorities; a licence to operate | C = 0.2 plus P on scandal (u0 = 0.6, τ = 60 d) | Services the community values; a visible remedy for grievance. Threat: scandal, exposure, a replacement offering the same service | P·J·J |
| `retribution` | justice | Settling a vendetta | Latched P per harm done to a member, severity-weighted; released by retaliation, an arbiter's settlement (elders, a fixer) or exhaustion | A rival harmed; a settlement. Threat: the rival untouchable; a stronger group | S·P·J |
| `growth` | power | More market, territory or capability | S: performance against aspiration, plus O for opportunities | An acquisition; a contract won. Threat: a competitor; a stalled market | P·P·J |
| `secrecy` | survival | Operations and assets stay hidden or deniable | X on leak risk (insiders aware × time) | Compartments kept. Threat: an informer, a leak, an audit | P·J·J |
| `compliance` | survival | Avoid legal and regulatory penalty | D on audits, hearings and inspections (κ = 3, τ_d = 10 d) | Papers in order; a bribe. Threat: an inspection, a whistleblower | P·J·J |
| `workload` | resources | Caseload within capacity (service bodies) | S: caseload ÷ capacity | Staff added; demand falls. Threat: a surge; cuts | P·P·J |
| `succession` | legacy | A leader's replacement without a split | D on the expected incapacity of the leader plus P on harm to the leader | A named heir accepted. Threat: leader's age or illness, rival claimants | P·J·J |
| `care_of_members` | bonds | Members and dependants are looked after | C = 0.4 plus P on a member harmed (u0 = 0.7, τ = 7 d) | Help given to members. Threat: a member harmed, a dependant left | P·J·J |
| `independence` | self | Freedom from a patron or parent body | S: patron control minus autonomy, plus P on a patron's demand | A patron weakened; contracts ended. Threat: a patron's tightening, debts to the patron | P·J·J |

Which group types carry which drives (● core, ○ sometimes, – rarely):

| Group type | continuity | treasury | turf | reputation | cohesion | legitimacy | retribution | growth | secrecy | compliance | workload | succession | care | independence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Gang | ● | ● | ● | ● | ● | ○ | ● | ○ | ○ | – | – | ● | ○ | ○ |
| Street collective | ● | ● | ○ | ○ | ● | ● | ○ | – | ○ | ○ | – | ○ | ● | ● |
| Nomad clan | ● | ● | ○ | ● | ● | ○ | ○ | – | – | ○ | – | ● | ● | ● |
| Corporation | ● | ● | ● | ● | ○ | ● | ○ | ● | ● | ● | ○ | ● | – | ○ |
| Police or agency | ○ | ● | ○ | ○ | ● | ● | ○ | – | ○ | ● | ● | ○ | ○ | – |
| Household | ● | ● | – | ○ | ● | – | ○ | – | – | – | – | ● | ● | – |
| Crew (temporary) | ○ | ● | – | ● | ● | – | ○ | – | ● | – | – | – | ○ | ○ |
| Service network (clinic, fixer roster) | ○ | ● | ○ | ● | ○ | ● | – | ○ | ○ | ● | ● | ○ | – | ○ |

The game's own data supplies the class: each of the 43 affiliations is marked gang, corporation or civilian by its animation wrapper ([population page §5.1](../../../knowledge/population-and-affiliations.md)); the NCPD, the Trauma Team and the Afterlife Mercs are classed as corporations there. A faction's default drive set comes from its class, and a content pack adds spikes (11.3). No faction-specific code is needed.

### 11.2 Operative weights

For group `g` and group drive `d`:

```
W_g(d) = normalise( 0.4 × ethos_g(d) + 0.4 × U_g(d) + 0.2 × leaders_g(d) )     [J]
```

- `ethos_g(d)` is the group's declared character as an importance vector (11.3). It changes slowly, and it is what the group says about itself.
- `U_g(d)` is the group drive's urgency from its model: what its books and board say is pressing. This is the **operative** part, computed from allocation and constraint (DRV-35).
- `leaders_g(d)` is the leaders' own weight on the matching drive, weighted by each leader's influence. Leaders bend the group towards their personal ends (principal and agent), and only through S1's decision operations ([kernel §10.3](../spec/kernel.md#103-inheritance-and-pull)).

**Divergence.** `D_g = ½ × Σ |normalised ethos − W|`. When it exceeds a threshold and someone can witness the gap (a leaked ledger, a visible allocation), the engine has a hypocrisy seed. A group whose ethos is honour but whose operative top drives are `treasury` and `turf` is a Tyger Claws story; a corporation whose ethos is safety but whose top drive is `growth` is another.

### 11.3 Ethos vectors for the game's own factions

An ethos is a set of multipliers on the importance of individual and group drives, as in the membership term of section 10.4. The entries are **judgement**: each is a one-line reading of the faction's public character, and I did not extract any of it from the game's records, which hold class and attitude but not ethos. The first group of rows rests on a community guide (the same EIP.gg guide the population page compares against); the corporations and others rest on general knowledge of the setting and are marked.

| Faction (record) | Class | Ethos spikes | Group emphasis | Basis |
|---|---|---|---|---|
| Maelstrom (`Factions.Maelstrom`) | gang | `chrome` ×2, `thrill` ×1.5, `belonging` ×1.3, `integrity` ×0.6 | `cohesion` by shared look; `retribution`; little `compliance` | community guide: cyberware-obsessed, members often cyberpsychotic |
| Tyger Claws (`TygerClaws`) | gang | `honour` ×1.5, `status` ×1.3, `ambition` ×1.2 | `treasury` from bars, casinos and vice; `reputation`; rank-based `succession` | community guide: honour-bound, yakuza-style; vice income |
| Valentinos (`Valentinos`) | gang | `family` ×1.5, `belonging` ×1.5, `honour` ×1.3, `meaning` ×1.3 | `care_of_members`; `legitimacy` in the community; defence of `turf` | community guide: loyal and tight-knit, protects barrios |
| 6th Street (`SixthStreet`) | gang | `justice` ×1.4 (as self-image), `honour` ×1.2, `territory` ×1.3 | `turf`; `legitimacy` eroding as service turns to self-interest | community guide: veteran-founded protectors who abuse their idea of justice |
| Voodoo Boys (`VoodooBoys`) | gang | `curiosity` ×1.5, `mastery` ×1.5, `autonomy` ×1.4 | `secrecy` ×2; `independence`; protection of their neighbourhood | community guide: elite netrunners tied to their community |
| Animals (`Animals`) | gang | `mastery` ×1.4 (the body), `status` ×1.2, `chrome` ×1.3 | `treasury` from security work and trafficking | community guide: martial bouncers |
| The Mox (`TheMox`) | collective | `justice` ×1.4, `autonomy` ×1.4, `belonging` ×1.3 | `care_of_members` ×2; `legitimacy`; `independence` | community guide: a collective formed to protect its workers |
| Aldecaldos (`Aldecaldos`) | nomad clan | `family` ×1.8, `autonomy` ×1.6, `roots` ×0.3 | `care_of_members`; `reputation` for reliable escorts | community guide: caravan escorts |
| Wraiths (`Wraiths`) | gang | `thrill` ×1.5, `autonomy` ×1.3 | `treasury` from raids; weak `cohesion` norms | community guide: lawless raiders |
| Scavengers (`Scavengers`) | gang | `money` ×1.4 | `treasury` from salvage and illegal implants; weak `cohesion` | community guide: loyal to no one |
| Barghest (`Barghest`) | gang | `honour` ×1.2 (the contract), `power` ×1.2 | `turf` over a district under its own prevention preset | game data (class, district preset) plus memory |
| Arasaka (`Arasaka`) | corporation | `power` ×1.5, `honour` ×1.3 (a loyalty code) | `growth`, `secrecy`, `succession`, `legitimacy` | general knowledge of the setting |
| Militech (`Militech`) | corporation | `power` ×1.3 | `growth` through contracts; `secrecy` | general knowledge |
| NCPD (`NCPD`) | corporation (as classed in the data) | `justice` ×1.2 (varies), `belonging` ×1.3 | `workload`, `legitimacy`, `compliance`, `cohesion` | game data class; Lipsky (DRV-40) |
| Trauma Team (`TraumaTeam`) | corporation | `safety` ×1.2 for clients | `treasury` from subscriptions; `workload`; `compliance` | general knowledge |
| Afterlife Mercs (`AfterlifeMercs`) | corporation | `streetcred` ×1.5 | `reputation` for neutrality; `treasury` from commissions | general knowledge |

Ethos belongs to a **content pack**, not to code. A pack may add a faction's ethos; a faction without one takes its class default (all multipliers 1). Nothing here says that people of a heritage share a character (DRV-11). The gang lore is the group's code, entered through the membership edge.

### 11.4 How a group's wants reach its members

The kernel already defines the mechanism: a member's frame of family `X` may take as parent each active concern frame of family `X` of each group with `strength ≥ 0.2`, at edge weight `strength`; orders create goal frames with a `pressure` that S1 computes (kernel §12). This dossier supplies two policies:

- **Which group concerns exist.** A group opens a concern when one of its drives crosses its opening threshold or an event matches its interests, exactly as for an individual (section 13), with the **leadership's** decision as the step that turns it into a goal for members.
- **Pressure.** `pressure = clip(0.3 × rank_gap + 0.4 × strength + 0.3 × fear)`, where `fear` is the member's belief that defiance will be enforced, times the membership's exit cost **[J]**. A member's commitment to the resulting goal also depends on identification (DRV-30), so the same order lands differently on a believer and a conscript.

Cross-pressure follows: when an order's effects violate a protected interest in another frame of the member (their `family` frame protecting a kinsman), the kernel emits a `Dilemma` ([kernel §10.8](../spec/kernel.md#108-effects-and-cross-pressure)), and the member's options resolve by section 13.3.

### 11.5 Households and families

A household is a group of type "household". Its drives are `treasury` (pooled rent and food), `continuity`, `cohesion`, `care_of_members`, `succession` and, where there is an honour culture, `reputation`. Members' `family` and `shelter` drives take the household's concerns as parents. Family weights scale with relatedness (DRV-41). A family business also carries `legacy` (the name and the enterprise), which is the socioemotional-wealth effect: a family will accept an unprofitable choice that protects its name.

---

## 12. The director and seeds

The foundation says the director and every seed are actors with drives ([§5](../foundation.md#5-context-and-relevance)). They use the same machinery: importance, urgency and frames. The director's content (pacing, thresholds) belongs to the director dossier (PAC-04); here are the drives.

| Actor | Drive | Meaning | Urgency model | Basis |
|---|---|---|---|---|
| Director | `tension` | Keep V's experienced intensity near a target curve | `U = clip((target(t) − I_est) / target(t))` in the build phase, and the reverse in fade and relax. `I_est` rises on events that involve V and fall as time passes unless threats engage, with decay τ_I about 30 min of game time **[J]** | Booth 2009 (shipped): estimate, hold while engaged, build up, sustain peak, peak fade, relax |
| Director | `variety` | Do not repeat categories of offer | Per category `c`, a level of interest `LOI_c` falls 0.3 when offered and recovers with τ = 2 d; `U = 1 − LOI_c` | Blumberg 1996 (level of interest) |
| Director | `relevance` | Offers are near V's inferred concerns | S: `U = 1 − (share of live offers matching the belief about V)` | Foundation §5.3 |
| Director | `care` | Limit pressure and fatigue; respect stated limits | `R` with τ = 1 d on unanswered offers; resets on engagement; hard cap on offers per hour from player settings | DRV-46 |
| Director | `continuity` | Close or advance open threads | D on thread windows; P on a promise made | P1/P5 threads |
| Seed | `occur` | The seed needs to happen | D on its window: `U` rises as the window closes (kernel: a seed's context is what it needs in order to happen) | Foundation §6 |
| Seed | `fit` | Pinned roles are satisfied | S: share of required roles bound | Foundation §6 |
| Seed | `fresh` | Do not go stale | P after sowing, decaying; at zero the seed withers | Plan: seed lifecycle |
| Seed | `exclusive` | Hold other content back while running | Constant while active; released at completion | Game's content tokens (`corpus`) |

Two notes on scale. First, Booth's director works in seconds because its game does. The Story Engine's cycle runs in minutes to hours of game time; the ratio of sustained peak to relax (about 1 to 10 there) is what carries over, not the seconds. Second, the director's drives have no `importance` per person: they are weights set by the player's settings (proactivity, content mix, tone) and the author's priorities.

---

## 13. From drive to concern to goal

This is the short, implementable account of the step from a drive to a concern to a goal. It is S1 policy with hooks into the kernel's frames ([kernel §10](../spec/kernel.md#10-context-frames-and-relevance)) and into fitting (layer 3). Its support is mostly **analysis** and **hypothesis**; DRV-22 to DRV-34 give the sources.

### 13.1 The chain

```
drive frame     weight w = I × (φ + (1 − φ) U)            (kernel level 'drive')
   │  opens when a generator fires (13.2) and the actor has room (DRV-32)
   ▼
concern frame   drive + bindings + origin + valence + stakes (+ due)   (level 'concern')
   │  becomes a goal when a means is chosen and committed (13.3, 13.4)
   ▼
goal frame      target effects + deadline + difficulty + commitment    (level 'goal')
   │  decomposed into steps as needed, at the actor's pace
   ▼
step, situation frames                                                   (levels 'step', 'situation')
```

The first three levels persist and are cheap. Steps and situations are short-lived and exist only while someone is near (V, a seed, a query).

### 13.2 The seven concern generators

| # | Generator | Fires when | Kernel change that triggers it | Valence | Typical drives | Support |
|---|---|---|---|---|---|---|
| O1 | **Deficit** | Drive frame weight crosses `θ_open` = 0.35 rising, and no routine will meet it. Closes below `θ_close` = 0.2 | Urgency pin (`pin` change on `urgency`) | approach | body, resources, bonds | P |
| O2 | **Blocked want** | An approach concern's `blockedBy` interest matches a change | `edge`, `pin` or `event` matching `blockedBy` | approach | work, ambition, mastery, escape | P |
| O3 | **Loss** | A `protects` interest is violated: `take`, `harm`, `kill`, `expose` on something valued | `event` with an `effect` on the protected node | avoid, then approach (recover) | family, money, status, territory | S (Agnew) |
| O4 | **Aversive presence** | A `threatenedBy` interest matches: a hostile person, group or place enters the frame | `event` or `edge` matching `threatenedBy` | avoid | safety, evasion, integrity | S (Agnew) |
| O5 | **Order or duty** | A group's goal frame is assigned to the member, or a role obligation falls due | `edge` (`core:member-of`) obligations; goal frame creation | either | belonging, reciprocity, honour | P |
| O6 | **Opportunity** | A high-importance, low-urgency drive meets a visible satisfier | `minted` node or `reading` that matches `wants` | approach | ambition, mastery, chrome, thrill, curiosity | P |
| O7 | **Cue** | A learned cue matches a sensitised drive | `event` matching a cue pulse | approach | craving, vengeance, curiosity | P |

Each concern carries `origin = O1..O7` and a cause, so "why is this person here?" always has an answer. A concern's weight relative to its parent drive is its **stakes** (0 to 1); the kernel's pull is parent pull × that weight (compare the fixture where a protection-payment concern of weight 0.9 under a `money` frame of 0.8 pulls 0.72).

**Strain as the unifying idea.** O2 to O4 are the three strains of general strain theory (failure to reach valued goals; loss of valued things; noxious stimuli). Strain breeds negative emotion; here the emotion is a rise in urgency of `vengeance` (if the cause is attributed to an agent, DRV-47) or of `serenity`'s stress load (if not).

### 13.3 Choosing a goal

A concern needs a **means** to become a goal. The engine keeps a **means library**: authored or pack-contributed templates, each with `serves` (drive and effect pattern), `requires` (money, papers, skill, contacts, an ally), `legitimacy` (legal, tolerated, illegal), `cost`, `risk`, `duration`, `norm tags` and a step template. Drives are psychology; means are verbs (F4).

```ts
function chooseGoal(actor, concern, now): Goal | undefined {
  const cands = means.filter(m => serves(m, concern) && feasible(actor, m));   // capability gate (DRV-34)
  if (cands.length === 0) { markWish(concern); return undefined; }             // DRV-33
  const scored = cands.map(m => ({
    m,
    score:
        progress(m, concern) * pull(concern)                                    // serves this concern
      + sum(otherActive(actor, concern), c => progress(m, c) * pull(c) * 0.5)   // multifinality (DRV-26)
      - sum(protectedInterests(actor), i => harm(m, i) * pull(i))               // counterfinality, kernel Dilemma
      - cost(m) - actor.g_threat * risk(m) * stakes(concern)
      - normPenalty(actor, m)                                                   // honour, integrity, group norms
      + (m.id === actor.currentMeans(concern) ? persistence(actor) : 0)         // inertia (DRV-21)
  }));
  const pick = gumbelMax(scored, key("goal", actor.id, concern.id, decisionEpoch(now))); // deterministic (kernel §5.4)
  return commit(actor, concern, pick.m);
}
```

Notes:
- **Legitimate means first.** `normPenalty` is small for legal means and large for illegal ones, scaled by `honour`, `integrity` and the group's norms. When every legitimate means fails `feasible`, the illegal ones are the only candidates (DRV-34).
- **Softmax choice.** The Gumbel-max pick is a softmax with temperature set by a `decisiveness` gain; a decisive actor takes the top score nearly every time.
- **Conflict.** If a candidate violates an interest in another active frame, the kernel emits a `Dilemma`; resolution follows DRV-25 and may pick a different means, a modified goal or an abandonment.
- **Costs of detail.** Scoring runs only for actors in an open frame. Others take the highest-scoring means with a coarse approximation.

### 13.4 Commitment, persistence and reconsideration

A committed goal gets:
- a **commitment** `c = base + β × endorsement` (DRV-30), 0 to 1;
- a **deadline** (from the concern's due time, or a duration from the means);
- a **persistence margin** `δ_p = 0.15 × g_persist` added to its score in later comparisons (DRV-21);
- a **level of interest** `LOI`, starting at 1 and decaying with τ_i = 6 h of game time while no progress is made **[J]**.

The goal is reconsidered when any of these happens:
1. it is **blocked** for longer than `T_b` (2 h for *now* horizons, 2 d for *soon*, 14 d for *long*);
2. a new concern's pull exceeds the current goal's by a factor of 1.5 (a **crisis override**: preservation and crisis goals pre-empt other goals, as in Schank and Abelson);
3. an alternative scores better by more than `δ_p + δ_o` (with `δ_o` about 0.1);
4. `LOI` falls below 0.2;
5. it succeeds or becomes infeasible.

Low-priority concerns get time-share: one in about eight decisions goes to the best lower-pull concern rather than the top one, which keeps routine upkeep alive without constant dithering (Blumberg).

### 13.5 Lifecycle and outcomes

Goal statuses map to the kernel's ([DRV-28](#d-concerns-and-goals)): active, blocked (suspended), satisfied, abandoned. Outcomes:

| Outcome | Effects on drives and concerns |
|---|---|
| **Satisfied** | A relief event pins the last-satisfied fact for the drive (resetting `R`, clearing `D`, changing `S`). The concern closes. Avoidance concerns do not close; they lapse (DRV-29) |
| **Failed** | An O2 or O3 generator fires on the actor's remaining interests; blame is attributed (DRV-47). With an agent blamed, `vengeance` opens or rises; otherwise `serenity` stress load rises. Long failures may write a contribution on importance (open question 3) |
| **Dropped** | The concern may remain as a wish. No strain |
| **Superseded** | A better goal replaced it. No strain; the old means may return |

Every outcome is an event with `causes`, so later content can find it (callbacks, [DS-10](../design-seeds.md)).

### 13.6 From intent to act

Intent is not action. Group and personal retaliation, in particular, pass a **situation check** before an act (DRV-18, DRV-42): `hazard = h0 × (1 + a_audience + a_weak) × (1 − a_arbiter)` per window, with `h0` of order 0.02 **[J]**, `a_audience` for witnesses who would support, `a_weak` for a visibly weak target, `a_arbiter` for a trusted mediator. The Lanchester-style resolution of unobserved fights between groups and the feud trajectories live with the feud material (SYS-21); this fixes only the drive side and the gate.

### 13.7 Calibration fixtures

These extend the kernel's fixtures ([kernel §16](../spec/kernel.md#16-fixtures)). They set the J numbers.

| # | Fixture | Expected |
|---|---|---|
| D-a | Rest, τ = 18 h, no sleep | U = 0.59 at 16 h, 0.74 at 24 h, 0.86 at 36 h; 8 h sleep with τ_s = 2 h leaves under 0.02 |
| D-b | Tick versus jump | 12 windows as one tick or twelve give identical urgency histories (kernel I-15); a slow-rising drive does not stall at the 1/64 quantum |
| D-c | Debt ladder | A debt due at T with the default ladder produces a reminder at T + 1 d, a collector at T + 3 d, enforcement at T + 7 d, each as a matchable event |
| D-d | Hysteresis | A drive weight oscillating between 0.30 and 0.40 opens its concern once and closes it once, not every wobble |
| D-e | Dithering | Two equally scored goals: at most one switch per game hour |
| D-f | Multifinality | With all other terms equal, the means serving two active concerns is chosen in over 70 % of 100 keyed decisions |
| D-g | Cross-pressure | Kernel fixture F-8: an order whose effect is `kill` on a protected kinsman gives one `Dilemma`; a `rescue` order gives none |
| D-h | Threat pre-emption | A threat at 20 m beats a want of greater value at 80 m; reversed distances reverse the result |
| D-i | Reciprocity lag | 200 sampled favours of one size give a spread of lags with the stated median and σ; none is zero |
| D-j | Exit | Exit probability rises monotonically with alternatives and falls with investment, holding satisfaction fixed |
| D-k | Isolation | After 3 × τ without contact, `friendship` urgency is above 0.9 and the actor seeks contact |
| D-l | V not owned | No process writes a pin to V's drives (kernel I-12); the director's belief changes with observed choices |
| D-m | Audit | Generated importance has no deviation by demographic tag beyond what role, circumstance and membership explain |
| D-n | Protected facts | An actor under `craving` never kills an entity listed in the protected register, however high its weight |

---

## 14. Night City's pressures

How the setting's own pressures enter the catalogue. None needs a special mechanism; each is a pattern of drives, generators and hooks. Evidence is the tabletop's Lifepath (practice), the game's own data (population, open-world and quest pages), and the systems fields (informal economies, obligation, feuds, scarcity).

| Pressure | Drives | Urgency pattern | Concern generators | Typical hooks | Evidence |
|---|---|---|---|---|---|
| **Debt** (rent, protection fees, ripperdoc credit, a family crisis) | `debt`, `shelter`, `money`, `serenity` | `D` with a ladder; combined across debts | O1, O3 (seizure), O4 (collector), O5 (creditor group's demand) | Collector at a stall; a favour asked for in lieu; a debtor needs a courier | Lifepath family crisis; Richardson 2013; protection as a product (Tilly, Gambetta via L6); informal finance (Collins et al.) |
| **Chrome and cyberpsychosis** | `chrome`, `integrity`, `money`, `status`, `health` | `O` for wanting; `X` on strain; `D` for maintenance and lease payments | O6 (an affordable implant), O3 (repossession, rejection), O4 (a cyberpsychotic nearby) | A repossession gig; a ripperdoc's supplier gone; a "cyberpsycho hunt" (17 authored in the game) | The game's 55 `Cyberpsycho`-tagged records; tabletop Humanity rules (unconfirmed numbers); L6 body field and its disability critique |
| **Street cred** | `streetcred`, `status`, `honour`, `belonging` | `O` with fading demonstrations; `P` on public failure | O6, O3 (a public humiliation), O5 (a test set by a crew) | A newcomer's credential test; a rival's challenge; a fixer's tier gate | `StreetCredTier` records (per-district thresholds); every gig reward carries street-cred experience; costly signals (Gambetta via L6/L7) |
| **Corporate loyalty** | `ambition`, `status`, `work`, `belonging`, `autonomy`, `serenity`, `honour` | `O` and `D` (review windows); `S` on constraint | O2 (a blocked promotion), O5 (orders), O6 | A rival's sabotage; a leak offered; a loyalty test | Meyer & Allen 1991; Hirschman 1970; principal-agent divergence (foundation §5.2) |
| **Gang membership** | `belonging`, `streetcred`, `safety`, `money`, `honour`, `escape` | `C` plus `P`; membership `strength` from satisfaction, investment and alternatives | O5 (orders), O3 (a member lost), O4 (rival), O6 (promotion) | An order against kin (cross-pressure); a skimmer; a defector's exit | Levitt & Venkatesh 2000; Pyrooz & Decker 2011; Le & Agnew 2003; Venkatesh 2006 |
| **Leaving the city** | `escape`, `roots`, `debt`, `family`, `money` | `S` on push; feasibility from capability | O1 (push builds), O2 (the fare blocked) | A courier saving for a fare; a forger of papers; a family that will not leave | de Haas 2021; Hirschman; Lifepath life goals (escape the street, leave the past) |
| **Mortality** (short lives, risky work, illness) | `legacy`, `family`, `meaning`, `serenity`, `pleasure` | Horizon `H` reweights; cue pulses | O3 (bereavement), O1, O6 | A will to deliver; a last favour; an heir to find | Carstensen; Griskevicius 2011; Many Labs 4 (no terror-management reflex) |
| **Policing and heat** | `evasion`, `safety`, `autonomy` | `X` on heat (the game's 1 to 5 levels) and witnesses | O4 | A fixer's price for a clean-up; an informer | Population page §5.3: seven prevention presets with `heat1` to `heat5`, district `crimeMultiplier` 0.7 to 1.2 |
| **Housing and rent** | `shelter`, `roots`, `justice` | `D` rent cycle; `P` eviction | O1, O3 | A block's quiet protest; a landlord's enforcer | Moral economy (Thompson via L6, L7); scarcity as entitlement (Sen via L7) |
| **Media and fame** | `fame`, `expression`, `status`, `chrome` | `O` | O6, O3 (scandal) | A rumour planted; a clip that makes or breaks | L6 rumour and media field; Reiss status; Sheldon on popularity (low) |
| **Fixers and brokers** | `reciprocity`, `streetcred`, `money`, `curiosity` | `D` with lag; `O` | O5, O6 | A favour traded for information; a broker removed | Simone 2004; Venkatesh 2006; L6 informal-economy field |

Two reminders from the lenses. Street life is mostly service and favour, not violence (DRV-56). And body stories centre ownership, maintenance and access, not madness (DRV-52).

---

## Map-miss log

Fields I met that are not on the [map](map.md). The map's gap table names "person-level motivation and drives" and "social cognition between people" as open, but lists no field for most of what fills them. Tiers are my suggestions.

| Field | Why it matters here | Source (checked as in section 2) | Suggested tier |
|---|---|---|---|
| **Theories of needs and values** (Maslow, Kenrick et al., Reiss, Fiske, Schwartz, Sheldon et al.) | The base of the catalogue. MOT-01 covers only the player's side of SDT | Kenrick et al. 2010; Schwartz 2012 | core |
| **Goal science and self-regulation** (goal setting, goal systems, implementation intentions, the Rubicon model, approach and avoidance, self-concordance) | The step from concern to goal | Locke & Latham 2002; Kruglanski et al. 2002; Gollwitzer & Sheeran 2006; Elliot 2006 | core |
| **Attribution and folk explanation of behaviour** | The gap table lists attribution for this dossier; no field exists | Malle 1999, 2006; Gilbert & Malone 1995 | core |
| **Organisational goals and the behavioural theory of the firm** | Group drives are computed from allocation and aspiration, which SYS-20 and SYS-15 do not cover | Perrow 1961; Cyert & March 1963; Greve 2003 | core |
| **Action selection for synthetic creatures** (ethology-based persistence, inhibition, level of interest) | Why a drive-only model dithers, and what fixes it | Blumberg 1996; Tyrrell 1993 | supporting |
| **Strain theory and anomie** | A concern generator; fills the "motivated offender" gap that routine-activity theory (SYS-03) leaves | Merton 1938; Agnew 1992 | supporting |
| **Life-span and life-history motivation** (horizons, mortality cues, deprivation) | Importance varies by age and hazard; replaces a mortality drive | Carstensen 1999; Griskevicius et al. 2011; Pepper & Nettle 2017 | supporting |
| **Personality as control parameters** | Gains versus content | DeYoung 2015; Parks-Leduc et al. 2015 | supporting |
| **Migration and immobility** | The "leaving the city" pressure | de Haas 2021 | supporting |
| **Gang disengagement and desistance** | How exits work, beyond SYS-20's Decker & Van Winkle | Pyrooz & Decker 2011; Pyrooz, Decker & Webb | supporting |
| **Organisational commitment** | Membership strength and its components (REL-02 covers relationships, not organisations) | Meyer & Allen 1991 | supporting |
| **Revenge and forgiveness systems; honour cultures** | The psychological side of SYS-21 | McCullough et al. 2013; Nisbett & Cohen 1996 | supporting |
| **Kin altruism and the family firm** | Family drives and relatedness weighting | Burnstein et al. 1994; Gómez-Mejía et al. 2007 | supporting |
| **Relational models and the reciprocity spectrum** | What obligations a tie carries (extends SYS-25) | Fiske 1992; Sahlins 1972 | supporting |
| **Needs systems in games** (The Sims, RimWorld, Dwarf Fortress, Crusader Kings) | Shipped needs models and their routine-loop failure mode | Forbus & Wright 2001; RimWorld wiki; others by summary | supporting |
| **Appraisal theory of emotion** | Comparison for how events matter through concerns, and for outcome emotions | Frijda 1986; Ortony, Clore & Collins 1988 | peripheral |
| **Stress and coping** | `serenity` is modelled as a stress load; the coping literature (not read) would refine it | Not read; named from general knowledge | supporting (unverified) |
| **Sleep and circadian regulation** | Gives the one empirically anchored urgency curve | Daan, Beersma & Borbély 1984 | peripheral |
| **Contested-findings register** | A standing list of results not to build in (terror management, loss aversion, scarcity tunnelling, self-actualization as a top drive), updated as replications arrive | Klein et al. 2022; Gal & Rucker 2018 | peripheral, but a cheap and useful page |

**Lens follow-up.** I recommend no new lens. The goal-science, needs and organisation fields above are each served by this dossier's own search. The "stress and coping" row is the one place I would ask the next dossier's agent to check.

---

## Credit candidates

Third-party work that taught us something used in the principles above. Creators are as evidenced in the sources I read. Links are those seen in this session; where only a secondary or catalogue page was found, the row says so. Entries already in the [community credits](../../../docs/community-credits.md) need no new row: Maxis (The Sims), Valve and Michael Booth (Left 4 Dead director talk), Tynan Sylvester and Ludeon (RimWorld), Tarn and Zach Adams (Dwarf Fortress), Bethesda (Radiant AI), and the EIP.gg gangs guide.

### Motivation, needs and values

| Creator | Work | Link | What we learned |
|---|---|---|---|
| Abraham H. Maslow | "A Theory of Human Motivation" (1943) | [hosted copy](https://worrydream.com/refs/Maslow_1943_-_A_Theory_of_Human_Motivation.pdf) (not checked against the journal printing) | The original is less rigid than the pyramid taught from it |
| Wahba and Bridwell | "Maslow reconsidered" (1976) | [record](https://colab.ws/articles/10.1016%2F0030-5073%2876%2990038-6) | The record offers little consistent support for the ordering |
| Kenrick, Griskevicius, Neuberg and Schaller | "Renovating the pyramid of needs" (2010) | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3161123/) | Motives overlap, affiliation splits, and the revision drops self-actualization as a basic need |
| Tay and Diener | "Needs and subjective well-being around the world" (2011) | [record](https://worlddatabaseofhappiness.eur.nl/publications/needs-and-subjective-well-being-around-the-world-11023) | Need fulfilment relates to wellbeing largely independently across 123 countries |
| Steven Reiss (with Susan Havercamp) | Theory of 16 basic desires (2004); Ohio State release | [release](https://news.osu.edu/new-theory-of-motivation-lists-16-basic-desires-that-guide-us/) | Vengeance, honour and acceptance sit among basic desires, and people differ by profile |
| Richard M. Ryan and Edward L. Deci | "Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being" (2000) | [PubMed](https://pubmed.ncbi.nlm.nih.gov/11392867/) | Autonomy, competence and relatedness behave as needs |
| Sheldon, Elliot, Kim and Kasser | "What is satisfying about satisfying events?" (2001) | [record](https://scholarship.miami.edu/esploro/outputs/journalArticle/What-Is-Satisfying-About-Satisfying-Events/991031600454702976) | Autonomy, competence, relatedness and self-esteem lead; popularity and money-luxury trail |
| Shalom H. Schwartz | "An overview of the Schwartz theory of basic values" (2012) | [ORPC](https://scholarworks.gvsu.edu/orpc/vol2/iss1/11/) | Ten values in a circle of compatibility and conflict, across 82 countries |
| Susan T. Fiske | *Social Beings* (2004) | [publisher](https://www.wiley-vch.de/en/areas-interest/humanities-social-sciences/social-beings-978-1-119-49273-3) | Belonging, understanding, controlling, enhancing self and trusting as core social motives |
| Alan P. Fiske | Relational models theory (1992) | [encyclopedia entry](https://iep.utm.edu/r-models/) | Four forms of sociality decide what a tie obliges |
| Baumeister and Leary | "The need to belong" (1995) | [PDF](https://www.hendrix.edu/uploadedFiles/Academics/Faculty_Resources/2016_FFC/Baumeister%20and%20Leary%20(1995).pdf) | Belonging is a pervasive motive whose lack harms health and adjustment |
| Anderson, Hildreth and Howland | "Is the desire for status a fundamental human motive?" (2015) | [record](https://worlddatabaseofhappiness.eur.nl/publications/is-the-desire-for-status-a-fundamental-human-motive-a-review-of-the-empirical-literature-15923) | Respect and voluntary deference are a fundamental motive |
| Parks-Leduc, Feldman and Bardi | "Personality traits and personal values: a meta-analysis" (2015) | [record](https://pure.royalholloway.ac.uk/en/publications/personality-traits-and-personal-values-a-meta-analysis/) | Traits and values link modestly and are distinct |
| Bardi and Goodwin | "The dual route to value change" (2011) | [record](https://pure.royalholloway.ac.uk/en/publications/the-dual-route-to-value-change-individual-processes-and-cultural-/) | Values can change, by an automatic and an effortful route |
| Colin G. DeYoung | "Cybernetic Big Five Theory" (2015) | [record](https://experts.umn.edu/en/publications/cybernetic-big-five-theory/) | Traits are parameters of goal-directed control; goals are characteristic adaptations |
| Carstensen, Isaacowitz and Charles | "Taking time seriously" (1999) | [record](https://profiles.wustl.edu/en/publications/taking-time-seriously-a-theory-of-socioemotional-selectivity/) | A shorter sense of future time reweights goals |
| Griskevicius, Delton, Robertson and Tybur | "Environmental contingency in life history strategies" (2011) | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/3556268) | Mortality cues move reproductive timing earlier for people raised poor and later for those raised well off |
| Pepper and Nettle | "The behavioural constellation of deprivation" (2017) | [record](https://eprints.ncl.ac.uk/245843) | Deprivation goes with present-oriented behaviour, and commentators dispute how general it is |
| Klein and colleagues (Many Labs 4) | "Many Labs 4" (2022) | [project note](https://www.cos.io/blog/many-labs-4-failure-replicate-mortality-salience-effect-and-without-original-author-involvement) | Mortality salience did not replicate in 21 labs |
| Gal and Rucker | "The loss of loss aversion" (2018) | [SSRN](https://papers.ssrn.com/abstract=3049660) | Evidence does not show that losses generally outweigh gains |

### Urgency, drives and action selection

| Creator | Work | Link | What we learned |
|---|---|---|---|
| Daan, Beersma and Borbély | "Timing of human sleep: recovery process gated by a circadian pacemaker" (1984) | [review that describes it](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9540767/) (the paper itself not located) | Rest pressure builds on a saturating curve, discharges faster and is gated by the clock |
| Tomova and colleagues | "Acute social isolation evokes midbrain craving responses similar to hunger" (2020) | [MIT repository](https://hdl.handle.net/1721.1/138313) | Ten hours of isolation produce a craving for social contact like hunger |
| Kivetz, Urminsky and Zheng | "The goal-gradient hypothesis resurrected" (2006) | [Columbia](https://business.columbia.edu/faculty/research/goal-gradient-hypothesis-resurrected-purchase-acceleration-illusionary-goal) | People accelerate towards a reward as it nears |
| Neal E. Miller; Boyd, Robinson and Fetterman | "Experimental studies of conflict" (1944); "Miller (1944) revisited" (2011) | [replication record](https://www.research.lancs.ac.uk/portal/en/publications/miller-1944-revisited(559e87e2-8a89-40d4-b733-d52946ef15b7).html) | Avoidance gradients are steeper than approach gradients |
| Berridge and Robinson | "The Incentive-Sensitization Theory of Addiction 30 Years On" | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11773642) | Wanting separates from liking, and cues drive wanting |
| McCullough, Kurzban and Tabak | "Cognitive systems for revenge and forgiveness" (2013) | [Cambridge](https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/cognitive-systems-for-revenge-and-forgiveness/3EE59DAB2918E5E72105B14FB589150E) | Revenge is a deterrence system, and forgiveness depends on the relationship's expected value |
| Nisbett and Cohen | *Culture of Honor* (1996) | [review](https://southerncultures.org/article/culture-honor-psychology-violence-south-richard-e-nisbett-dov-cohen-review) (a review; the book not read) | Insult responses differ by honour culture, though the authors' reading is disputed |
| Richardson, Elliott and Roberts | "The relationship between personal unsecured debt and mental and physical health" (2013) | [PubMed](https://pubmed.ncbi.nlm.nih.gov/24121465/) | Debt is strongly associated with poor mental health, with causation unestablished |
| Bruce Blumberg | *Old Tricks, New Dogs: Ethology and Interactive Creatures* (1996) | [thesis](https://characters.media.mit.edu/Theses/blumberg_phd.pdf) | Persistence needs inertia, mutual inhibition and a falling level of interest |
| T. Tyrrell | *Computational Mechanisms for Action Selection* (1993) | [record](https://era.ed.ac.uk/items/f882b365-c98c-417f-b934-ecff1f710e29/full) | Drive models and spreading-activation networks were tested in simulation and found wanting |
| Kenneth D. Forbus and Will Wright | "Some notes on programming objects in The Sims" (2001) | [PDF](https://qrg.northwestern.edu/papers/Files/Programming_Objects_in_The_Sims.pdf) (the Maxis credit covers the game; this adds the paper) | Objects advertise to needs, and personality scales the effect |

### Concerns, goals and action

| Creator | Work | Link | What we learned |
|---|---|---|---|
| Edwin A. Locke and Gary P. Latham | "Building a practically useful theory of goal setting and task motivation" (2002) | [PDF](https://goal-lab.psych.umn.edu/orgpsych/2020/readings/5.%20Motivation/Locke%20%26%20Latham%20(2002).pdf) | Specific, difficult goals direct effort, moderated by commitment and conflict |
| Ordóñez, Schweitzer, Galinsky and Bazerman | "Goals gone wild" (2009) | [Penn repository](https://repository.upenn.edu/mgmt_papers/325) | Hard targets narrow focus and invite corner-cutting |
| Arie Kruglanski and colleagues | Goal systems theory (2002; 2023 volume) | [OUP volume](https://academic.oup.com/book/45852) | Means serving several goals are preferred, and means harming other goals are penalised |
| Gollwitzer and Sheeran; Heckhausen and Gollwitzer | Implementation intentions meta-analysis (2006); the Rubicon model (1987) | [meta-analysis record](https://stafforini.com/works/gollwitzer-2006-implementation-intentions-and/), [Rubicon text](https://www.socmot.uni-konstanz.de/sites/default/files/90_Gollwitzer_Action_Phases_MindSets.pdf) | If-then plans raise goal attainment, and deliberation differs from implementation |
| Sheldon and Elliot | "Goal striving, need satisfaction, and longitudinal well-being: the self-concordance model" (1999) | [record](https://worlddatabaseofhappiness.eur.nl/publications/goal-striving-need-satisfaction-and-longitudinal-well-being-the-self-concordance-model-4369) | Self-endorsed goals are pursued and satisfy more |
| Andrew J. Elliot; E. Tory Higgins | "The hierarchical model of approach-avoidance motivation" (2006); "Beyond pleasure and pain" (1997) | [Elliot record](https://www.proquest.com/docview/757933272), [Higgins](https://business.columbia.edu/faculty/research/beyond-pleasure-and-pain) | Approach and avoidance, and promotion and prevention, are different kinds of motive |
| Roger Schank and Robert Abelson | *Scripts, Plans, Goals and Understanding* (1977) | [course page that taught us](https://zoo.cs.yale.edu/classes/cs458/lectures/GBDMGoals.html), [book](https://www.routledge.com/Scripts-Plans-Goals-and-Understanding-An-Inquiry-Into-Human-Knowledge-Structures/Schank-Abelson/p/book/9780898591385) | Goal types, wishes, opportunities and duties, and the relations among goals |
| Harland, Morley, Thangarajah and Yorke-Smith | "An operational semantics for the goal life-cycle in BDI agents" (2014) | [SRI record](https://www.sri.com/publication/artificial-intelligence-pubs/an-operational-semantics-for-the-goal-life-cycle-in-bdi-agents/) | Goals have explicit drop, abort, suspend and resume states |
| Robert Agnew; Robert K. Merton | "Foundation for a general strain theory" (1992); "Social structure and anomie" (1938) | [Agnew abstract](https://ojp.gov/ncjrs/virtual-library/abstracts/foundation-general-strain-theory-crime-and-delinquency), [Merton text](https://faculty.washington.edu/matsueda/courses/517/Readings/Merton%201938.pdf) | Blocked goals, loss and noxious stimuli breed pressure; goal-means gaps drive adaptation |
| Jonathon Doran and Ian Parberry | "A prototype quest generator based on a structural analysis of quests from four MMORPGs" (2011) | [PDF](https://ianparberry.com/pubs/pcg2011.pdf) | NPC motivations in 753 quests fall into nine kinds with a skewed spread |

### Groups, communities and the setting

| Creator | Work | Link | What we learned |
|---|---|---|---|
| Charles Perrow | "The analysis of goals in complex organizations" (1961) | [a 1974 article quoting it](https://erudit.org/en/revue/ri/1974/v29/n4/028552ar.pdf) (the 1961 paper itself not located) | Official goals differ from the operative goals revealed by resource allocation |
| Richard Cyert and James March; Henrich Greve | *A Behavioral Theory of the Firm* (1963); *Organizational Learning from Performance Feedback* (2003) | [overview](https://en.wikipedia.org/wiki/A_Behavioral_Theory_of_the_Firm), [Greve](https://www.cambridge.org/core/product/660EE3B71FEAC74729EEA787967AF503) | Performance against an adaptive aspiration drives search and risk |
| Steven Levitt and Sudhir Venkatesh | "An economic analysis of a drug-selling gang's finances" (2000) | [NBER](https://nber.org/papers/w6592) | A gang is a firm with a skewed wage bill, and rival-turf violence has a price |
| Sudhir Venkatesh; AbdouMaliq Simone | *Off the Books* (2006); "People as infrastructure" (2004) | [Simone](https://research.gold.ac.uk/id/eprint/1946), [Venkatesh (catalogue)](https://www.librarything.com/work/1151841) | Informal and formal work interlink, and relationships act as infrastructure |
| John Meyer and Natalie Allen | "A three-component conceptualization of organizational commitment" (1991) | [record](https://www.scinapse.io/papers/2083174051) | Commitment is affective, continuance and normative |
| Benjamin Le and Christopher Agnew | "Commitment and its theorized determinants" (2003) | [Haverford](https://scholarship.haverford.edu/psychology_facpubs/108) | Satisfaction, alternatives and investment predict commitment |
| Albert O. Hirschman | *Exit, Voice, and Loyalty* (1970) | [CASBS](https://casbs.stanford.edu/exit-voice-and-loyalty-responses-decline-firms-organizations-and-states) | Loyalty slows exit and gives voice room to work |
| David Pyrooz and Scott Decker | "Motives and methods for leaving the gang" (2011); Pyrooz, Decker and Webb, "The ties that bind" | [Pyrooz and Decker](https://vivo.colorado.edu/display/pubid_130496), [ties](https://vivo.colorado.edu/display/pubid_130481) | Exits are mostly non-hostile and ties linger |
| Michael Lipsky | *Street-Level Bureaucracy* (1980) | [Project MUSE](https://muse.jhu.edu/book/15024) | Frontline workers ration and cream, and their coping becomes policy |
| Gómez-Mejía and colleagues | "Socioemotional wealth and business risks in family-controlled firms" (2007) | [record](https://investigacion.ujaen.es/documentos/5f1ce0a429995265e44d9ee2) | Families protect identity, influence and dynasty, not only money |
| Burnstein, Crandall and Kitayama | "Some neo-Darwinian decision rules for altruism" (1994) | [bibliography](https://talkorigins.org/origins/biblio/inclusive_fitness.html) (a listing; the paper not located) | Helping tracks relatedness most strongly when the stakes are high |
| Hein de Haas | "A theory of migration: the aspirations-capabilities framework" (2021) | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7902564) | Moving needs both the wish and the means, and staying is also a choice |
| Donald Black; Roger Gould; Randall Collins; Robert Jervis; Christopher Boehm | "Crime as social control" (1983); *Collision of Wills* (2003); *Violence* (2008); "Cooperation under the security dilemma" (1978); *Blood Revenge* (1984) | [Black (author page)](https://en.wikipedia.org/wiki/Donald_Black_(sociologist)), [Gould](https://chicagoreference.com/ucp/books/book/chicago/C/bo3616160.html), [Collins](https://muse.jhu.edu/book/36669), [Jervis](https://stafforini.com/works/jervis-1978-cooperation-security-dilemma/), [Boehm (catalogue)](https://ci.nii.ac.jp/ncid/BA00372483?l=en) | Self-help where law fails, rank ambiguity, rarity and clumsiness of violence, legible defence, and elders' settlement |
| Alvin Gouldner; Marshall Sahlins | "The norm of reciprocity" (1960); *Stone Age Economics* (1972) | [Gouldner](https://www.scinapse.io/papers/2008073538), [reciprocity overview](https://en.wikipedia.org/wiki/Reciprocity_(cultural_anthropology)) | Reciprocity is a norm, and return depends on distance |
| Arnold van Gennep; Victor Turner | *Les rites de passage* (1909); *The Ritual Process* (1969) | [Turner chapters](https://womrel.sitehost.iu.edu/Rel433%20Readings/SearchableTextFiles/Turner_RitualProcess_chaps3&5.pdf) | Status changes are staged in public |
| Bertram Malle | "How people explain behavior" (1999); "The actor-observer asymmetry in attribution: a (surprising) meta-analysis" (2006) | [1999](https://journals.sagepub.com/doi/full/10.1207/s15327957pspr0301_2), [2006](https://supp.apa.org/psycarticles/supplemental/0033-2909.132.6.895/0033-2909.132.6.895_supp.html) | Reasons and causes are different explanations, and the old actor-observer asymmetry does not hold |
| Daniel Gilbert and Patrick Malone | "The correspondence bias" (1995) | [PDF](https://scholar.harvard.edu/files/danielgilbert/files/gilbert__malone_correspondence_bias.pdf) | Observers infer dispositions from behaviour and correct for the situation incompletely |
| R. Talsorian Games | "Cyberpunk Red Alert: Lifepath" (2020); the tabletop Lifepath tables (via a Roll20 compendium page) | [blog](https://rtalsoriangames.com/2020/10/16/cyberpunk-red-alert-lifepath/), [compendium](https://roll20.net/compendium/cpunk/Lifepath) | A compact schema for caused relationships, enemies and life goals |
