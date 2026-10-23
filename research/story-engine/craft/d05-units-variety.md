# Dossier 5: reusable units, variety and template detection

**Status:** v1, 22 October 2026. Dossier 5 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: NAR-10, PER-07, PER-08, PER-09. Supporting fields: NAR-14, AUT-07. Feeds P4 (the seed language), P5 (the procedural engine and scheduler) and P9 (evaluation). It serves quality bar 5, "perceptible variety" ([plan §1](../plan.md#1-what-doesnt-suck-means)), and design seeds [DS-16](../design-seeds.md) and [DS-28](../design-seeds.md).

**In brief**
- **No shipped system that avoids the feel of repetition uses one grain.** Façade is the best-documented case, and I read its paper. A beat holds 10 to 100 exchanges, an exchange is 1 to 5 lines, and most exchanges come in 3 to 5 tonal alternates, each with 2 to 4 same-function wordings. One run meets at most a quarter of the roughly 2,500 exchanges. The game's own scenes run from one line to about 85, by role. Oral singers varied one song's length by a factor of about 2.75 without changing its story. Units are small where freshness is needed and large where story is needed. Nobody has tested directly whether small grain looks less repetitive than large grain (§4.1).
- **A large count of combinations is not variety.** Façade's authors say thousands of beat orders are possible and few are meaningfully different, because most beats do not depend on each other. Players tell the difference by a few nameable features, not by the number of parameters. Finer categories make people tire more slowly. Few, large, correlated, discrete choices read as more different than many small independent ones (§4.2).
- **Players learn the skeleton before they can say what it is, and then say so loudly.** People learn transitions in two minutes of exposure (syllables) and keep noise samples for weeks. Fallout 4 shipped on 10 November 2015, a forum thread asked whether the settlement requests ever stop on 17 November, and a mocking article ran on 7 January 2016. The detector for this is cheap: a learner that predicts the next unit from the last few (§4.2, §4.4, §5).
- **Scheduling rules are old and have known magnitudes.** Radio uses time and count separation with a defined order of relaxation. Spotify picks the best of several random orderings. Tetris's bag caps any gap at 12 pieces. Dota's accumulating chance cuts the spread of gaps nearly in half. All of them can be written as constraints and weights over the record, which is what the kernel already does. Separation by `constrain` at a low precedence relaxes itself when it would empty the choice (§4.3).
- **Anti-repeat rules cost predictability.** With 8 equally likely kinds, forbidding repeats of the last 3 removes 0.68 bit of 3.0 from each choice. Separating only what players sort by, and keeping a floor on conditional entropy, is the rule (§4.3, §5.3).
- **A template can be defined, mined and scored.** Take an abstraction of each unit, find sub-sequences that repeat at least a set number of times, and report the share of items that contain one, compressibility, and templates per unit. A first run on the game's own quest graphs (§5.5) separates its gigs (shared wiring) from its side quests by a factor of about four on pairwise similarity at matched size. That shows the detector can see a template. It does not show what players see.
- **Language-model rendering can undo the structure layer's variety.** Generated text is more templated than human text, and writers who use a model produce stories more like each other. If D-17's text renderer is a model, the text layer needs its own template check (§4.4).
- **There is no study of how players perceive repetition in generated narrative.** Every magnitude here is a starting value for the harness to tune, and the evaluation list (§10) is built to find them.

## 1. Scope and why it matters here

A seed is a partly resolved quest ([foundation §6](../foundation.md#6-story-in-the-same-space)), and the engine will produce many of them. This dossier asks three questions about volume. How big should the reusable pieces be? When does a player see through the reuse? How should the scheduler order what it offers so that reuse is not seen, and how can a test harness tell when it has failed?

| Layer or concern | What this dossier gives it |
|---|---|
| 4. Authored content | The grain at which authors write fragments, and what a fragment must declare so that it recombines (§4.1) |
| 3. Procedural engine (sowing, fitting) | Which differences to vary (verb, stake, relationship, outcome) and which to hold; how to generate variants players can name (§4.2) |
| 2. Seeding (seed language, scheduling) | Separation, rotation and reweighting rules with magnitudes; the fields a seed must expose so that the scheduler and the tests can see its skeleton (§4.3, §9) |
| 1. Simulation | Periods for recurring world rhythms (§4.3) |
| Evaluation (E) | Measures, a template miner, a learner-bot test and human protocols (§4.4, §5, §10) |
| Expression (X) | A template check for the text layer (§4.4) |

**Evidence in the repository, used read-only:** the [quest corpus](../quest-corpus-statistics.md) database (new read-only queries, §5.5), [open-world activities](../../../knowledge/open-world-activities.md), the [kernel spec](../spec/kernel.md), and [dossier 4](d04-quest-structure.md), which found that the game's gigs share one fixed wiring.

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **contested** marks a claim two sources dispute. Source status: *read* (fetched and read this session), *summary* (only a search summary or a lens's account was seen), *memory* (recalled, not rechecked). **Where a source is a vendor's blog, a fan wiki or a secondary write-up of a talk, the grade is [sec] and the number is a starting value, not a standard.**

## 2. The failure record

Failures first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the advice itself fails.

### 2.1 Cases

| # | Case | What was tried | What went wrong | Evidence |
|---|---|---|---|---|
| F-01 | **No Man's Sky at launch** (2016) | A vast set of generated planets and creatures | A review argued that planets feel alike because a small set of variables makes them, and that players notice rules such as a limited number of legs. Kate Compton's talk, as reported, asked whether a million objects that players cannot tell apart are worth having, and proposed a fan-fiction test: would anyone write about this object? Repeating trees is often fine | *read*: Game Developer's report of Compton's talk [practice]. The review itself (Vice) was not opened; *summary* via L2 A5 |
| F-02 | **Fallout 4's settlement requests** (2015) | Endless generated "a settlement needs help" jobs from one giver | Players named the pattern in a week. The page records a Steam thread asking if the missions stop (17 Nov 2015, a week after release), a GameFAQs complaint (20 Nov), a mod to switch them off (28 Nov), a catchphrase video (5 Dec) and a Kotaku piece on the mockery (7 Jan 2016). What was mocked was the repeating request, not any settlement | *read*: Know Your Meme [community; dates as the page gives them]. [Dossier 4](d04-quest-structure.md) F-03 holds the design critique |
| F-03 | **Starfield's sites and errands** (2023) | Handmade sites placed procedurally | One forum observer's distinction, as relayed: the placement is procedural and the contents inside each site never vary | *summary*: L2 A4; [dossier 4](d04-quest-structure.md) F-05 [community, weak] |
| F-04 | **Façade's combination count** (2005) | 27 beats, thousands of possible orders | The authors say few of the possible sequences are meaningfully different, because most beats are causally independent. They chose depth of local variation over global variety, and say the authoring time per exchange (about 3 person-years for the whole) is what held the beat count down | *read*: Mateas and Stern, AIIDE 2005 [practice; primary] |
| F-05 | **Spotify's shuffle** | A statistically random shuffle | Listeners felt it repeated. The engineers describe a gap between statistical and perceived randomness, using the example that five heads in a row is valid but does not feel random. The 2025 fix generates several random orderings, scores each for how recently its tracks were played, and keeps the best. No metrics are published | *read*: Spotify Engineering, 13 Nov 2025 [shipped; no data]. The 2014 change (spreading each artist's songs across the list) is *summary* only |
| F-06 | **Cyberpunk 2077's scanner hustles** | One-step events that vanish when done | About 112 to 113 assaults in progress share one template, against 17 organised-crime outposts and 17 cyberpsycho sightings that are richer. The reward gap is a community complaint | *read*: the repository's [open-world activities](../../../knowledge/open-world-activities.md) page [corpus]; the complaint is [sec] via L6 |
| F-07 | **Language-model text** | Writers given model-generated ideas; model output across tasks | Stories written with model ideas were rated better but were more similar to each other than human-only stories. Model output carries syntactic templates at a higher rate than human text, and 76 % of the templates found in one family's output also occur in its pre-training data (35 % for human text) | *summary*: abstracts and press accounts of Doshi and Hauser 2024 and Shaib et al. 2024 (the second paper's method read in full) [empirical] |
| F-08 | **Expressive-range metrics** | Plot a generator's output over chosen metrics | The method found a bias in the original generator (levels skewed to linear). The metrics were chosen by hand for platformers. I found no study that tests them against what people perceive | *read*: Smith and Whitehead 2010, 10,000 levels per plot [analysis]. The validity gap is my search result, not a finding |
| F-09 | **Skyrim's Radiant Story and Legion's recruits** | Generated reactions and persona lines | Reactions had to be limited and written per voice type; new recruits commented on everything until cooldowns were added | [Dossier 4](d04-quest-structure.md) F-02, F-07 [practice] |

Cases from the lenses that I did not recheck and do not rely on: the Rockstar test of generated companion missions (L5, GameStar), the Hades line-priority rule (L5; see §3.3), and Lessard and Paré-Chouinard's claim that recurring emergent patterns lower interest (L8; I could not find the paper).

### 2.2 What the failures have in common

| # | Pattern | Cases | What is missing | A test that catches it | Where this dossier answers it |
|---|---|---|---|---|---|
| P-1 | **Variety counted in parameters, not in what players tell apart** | F-01, F-03, F-04 | A unit of variation taken from player behaviour | Free sorting of N outputs; groups divided by N | VAR-08, VAR-13, VAR-14 |
| P-2 | **Many small independent choices** | F-01 | A few large, correlated, nameable differences | Pairwise distinguishability; naming tasks | VAR-11, VAR-12 |
| P-3 | **The skeleton is learned before it is named** | F-02 | A skeleton that varies in order, initiator, stake and ending | A learner bot's bits per unit against exposure | VAR-09, VAR-10, VAR-26 |
| P-4 | **Streaks and clumps in what is offered** | F-02, F-05 | Separation and reweighting with a defined relaxation | Run-length and gap statistics against a bag baseline | VAR-18 to VAR-20 |
| P-5 | **Order rules that make the skeleton predictable** | F-05 (inferred) | A floor on conditional entropy | The same learner bot | VAR-21 |
| P-6 | **A template at one level hidden by variety at another** | F-03, F-06, F-07 | Template mining at several abstraction levels | Template rate at each level | VAR-24, VAR-25, VAR-28 |
| P-7 | **Metrics that are not tied to perception** | F-08 | Calibration against human sorting | Rank correlation between metric and sorting | VAR-29 |

### 2.3 Where the advice itself fails

| Advice | How it fails |
|---|---|
| The oral-formulaic thesis (NAR-10) | It was developed on Balkan epic and extended to Homer, Old English and more, and the extensions are debated. Finnegan's survey argues that performers do not all compose in one way (memorising, improvising or mixing), so no single method applies to all oral poetry. Foley moved the weight from composition to performance and to the meaning a formula carries for its audience. The strict reading of Parry and Lord does not hold; the weak reading, reusable parts chosen in the moment, does |
| Commedia dell'arte as free improvisation | The surviving scenarios are plot outlines, and the same account says lazzi were rehearsed, key plot points and entrances were fixed, and the picture of spontaneous street play may be romanticised. The troupe's skill took a lifetime. A system has no lifetime of training; its stand-in is a persona with a repertoire (VAR-05) |
| "Curate, don't sample" (Compton) | It does not scale, and the talk says so in its own terms: just do what works. The scalable version is a curated catalogue of kinds plus a distance test on generated units (VAR-14) |
| Boris the Brave's heuristics | They are practitioners' rules for visual generators, unvalidated. The 10 per cent ceiling on rare flags is an example in his article, not a measured threshold |
| "Fewer repeats than chance feels more random" | Direction confirmed by Falk and Konold's abstract (people make more alternations than chance and rate over-alternating sequences as most random). The size (about 0.6 modal alternation, against 0.5) is the lens's figure and I did not recheck it. Miller and Sanjurjo's streak-selection result means human streak judgement is not simply wrong (L3, [sec]) |
| An inverted-U between complexity and liking (Berlyne) | The usual citation for "not too predictable, not too chaotic". A 2016 study cited in a search result found mixed support once familiarity is controlled. **Contested**; I use it only as a prompt for a measurement, not as a curve to hit |
| Satiation research (Redden 2008) | Jelly beans in a lab, 22 per participant (abstract and press coverage only). It suggests a mechanism; it does not show size or transfer to narrative |
| Statistical-learning results (Saffran 1996; Agus 2010) | Infants and syllables; listeners and noise samples. They show how fast transitions are learned, not that adults learn quest skeletons. L3 says so too |
| Spotify and Dota as models | Neither publishes outcome data for its fix (Spotify) or measures of felt fairness (Dota). They are existence proofs of mechanisms, not of effect sizes |

## 3. Sources

Source status as defined in §1. "Credit" says whether [the community credits](../../../docs/community-credits.md) already hold an entry (checked by name).

### 3.1 Read

| Work | Used for | Credit |
|---|---|---|
| Mateas and Stern, "Structuring Content in the Façade Interactive Drama Architecture", AIIDE 2005 (full text, 6 pages) | VAR-01, VAR-02, VAR-07; F-04 | Façade entry exists; this paper to check |
| Smith and Whitehead, "Analyzing the Expressive Range of a Level Generator", PCG workshop 2010 (full text) | VAR-29; F-08 | to add |
| Shaib, Elazar, Li and Wallace, "Detection and Measurement of Syntactic Templates in Generated Text", EMNLP 2024 (method and metrics sections) | VAR-24, VAR-25, VAR-28 | to add |
| Borgne and Sahiner, "Shuffle: Making Random Feel More Human", Spotify Engineering, 13 Nov 2025 | VAR-18; F-05 | to add |
| Emily Short, "Bowls of Oatmeal and Text Generation" (2016); "Beyond Branching" (2016); post on Ruskin's GDC talk (2012) | VAR-03, VAR-13 | Short exists |
| Boris the Brave, "Oatmeal Spice", 5 July 2026 | VAR-11, VAR-12 | to add |
| Game Developer, report of Kate Compton's GDC talk, 2017 | VAR-14, VAR-15; F-01 | Compton exists |
| GameAnim's account of Tomsiński's GDC 2016 talk on The Witcher 3's dialogue system | §4.1 grain table | to add |
| Know Your Meme, "Another Settlement Needs Our Help" | F-02, VAR-09, VAR-30 | to add |
| Digital Music News, "Spotify random shuffle feature", 18 March 2020 | VAR-18 | to add |
| Falk and Konold 1997, abstract page | VAR-18, VAR-26 | to add |
| Diplograph, "The Dota 2 Pseudo-Random Distribution Creates Semi-Consistent Effects"; Tetris Wiki, "Random Generator" | VAR-20 | wiki and note; not credited |
| EBSCO research starter on Lord's *The Singer of Tales*; Wikipedia pages on oral-formulaic composition and commedia dell'arte | VAR-02, VAR-05, VAR-17; §2.3 | encyclopedic; not credited |
| The repository's quest corpus database (read-only) and its [statistics](../quest-corpus-statistics.md) | §4.1 table, §5.5 | first-party |

### 3.2 Summary only, or memory

| Work | What I have | Treatment |
|---|---|---|
| Ruskin, "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012 | Short's account and the GDC listing. The slides' host was unreachable and the Valve Developer Community wiki returned a refusal | Specificity-first matching is firm (two independent accounts). Repeat-control keywords (`permitrepeats`, `sequential`, `norepeat`, `matchonce`) are from a search summary of the wiki: [sec] |
| Spotify, "How to shuffle songs?" (2014) | The Digital Music News account and a search summary of the post. The post itself returned not-found | The idea (spread each artist's tracks evenly, with a random offset) is [sec] |
| MusicMaster blog and help pages | Search summaries: 1:10 "general artist separation", a 90-minute example, guest keys at 10 minutes and secondary keys at 20, title separation counted in records (six in the example) | Vendor material, so [sec]; no independent industry norm found |
| Redden 2008, *Journal of Consumer Research* 34(5): 624-634 | Abstract and press coverage | VAR-11 marked as an abstract-level result |
| Saffran, Aslin and Newport 1996, *Science* 274: 1926-1928; Agus, Thorpe and Pressnitzer 2010, *Neuron* 66(4): 610-618 | PubMed abstract and search summaries (2 minutes of exposure; noise samples recalled after about two weeks) | VAR-09 |
| Doshi and Hauser 2024, *Science Advances* 10(28) | Open-access text indexed; press and summary read | F-07 |
| Shaib et al. 2024, "Standardizing the Measurement of Text Diversity" (arXiv 2403.00553) | Search summary: compression ratio, self-repetition of long n-grams and Self-BLEU as a sufficient reporting set | VAR-24 |
| Zhu et al. 2018 (Texygen; Self-BLEU); Li et al. 2016 (distinct-n) | Search summaries | VAR-24, as comparisons |
| Cilibrasi and Vitányi 2005, *IEEE Trans. Information Theory* 51(4): 1523-1545 | Search summary of the normalized compression distance | VAR-25 |
| Hout, Papesh and Goldinger 2013, *WIREs Cognitive Science* 4: 93-103 | Citation only | VAR-27: multidimensional scaling is named as a method; claims about it are [mem] |
| Finnegan 1977, *Oral Poetry*; Foley 1988 and 1991 | Search summaries of reviews | §2.3 |
| Eno 1996; Reich 1968; Queneau 1961; Perec 1978 | The lens's accounts (L11:7, L11:18) | VAR-22, VAR-23. The arithmetic in VAR-23 is my own |
| Berlyne 1970 | Search summary; later work cited as 1971 | §2.3 only |
| Wald and Wolfowitz 1940 (the runs test) | Memory | Named in §5.2 as a standard test, not relied on for a number |

### 3.3 Lens claims checked

| Lens claim | Result |
|---|---|
| L1:25 principle 1: phrase- or gesture-grain units give less perceived repetition than scene-grain units | **Not tested anywhere I looked.** Indirect support only (Façade's alternates; the oral-formulaic record). Kept as [hypothesis] (VAR-02) |
| L1:25: Avdo Medjedović dictated a song of more than 12,000 lines | Not rechecked. A different figure I did read: after hearing a song once he sang it back at 6,313 lines against 2,294 (EBSCO) |
| L1:13: rotation and separation of "an hour or two" | Partly confirmed: 1:10 is called the general artist separation in a vendor's blog; a 90-minute example appears; guest and secondary keys use 10 and 20 minutes. Vendor-only |
| L1:13: Spotify generates several random orderings and scores each | Confirmed (the article does not say how many) |
| L3:13: statistical learning of transitions | Confirmed at abstract level (2 minutes) |
| L3:14, L8:22: Compton's fan-fiction test; Short's "decorative variation" | Confirmed |
| L8:22 principle 2 (Boris the Brave): fewer, bigger, correlated decisions | Confirmed; the article also gives discrete lists, rare flags and the "establish the rule before breaking it" rule |
| L3:25 and the map row: modal alternation 0.6 against 0.5 | Direction confirmed from the abstract; size not rechecked |
| L11:7: Eno's loops, least common multiple | The lens's account; the arithmetic is standard. The lens's own caveat stands: three loops give minutes |
| L11:18: 10^14 poems from 140 lines | Arithmetic checked: ten alternatives at each of fourteen positions |
| L5: Hades line priority favours unseen over seen | **Not confirmed.** Neither the Game Developer interview nor the GDC listing says how lines are chosen. The only figure I have is a line count of more than 22,000 (GDC listing, via search summary) |
| L9:13: Rockstar tested and rejected generated companion missions | Not rechecked |

## 4. Principles

Columns: grade; source and a concrete instance; scale and layers; how to operationalise (**produce**, **check**, or **neither**). "Layers" are the plan's four layers; X, C, E, T are the cross-cutting concerns. Kernel references are to [S0](../spec/kernel.md). Scales are encounter, gig, arc.

### 4.1 The grain of reuse (NAR-10, NAR-14; links to SEL-04, EXP-03, AUT-03)

First, what the shipped and traditional systems actually used.

| System | Smallest unit | Middle | Largest | How units are chosen | Repetition control | Numbers | Status |
|---|---|---|---|---|---|---|---|
| **Façade** | Joint dialogue behaviour: 1 to 5 lines between two characters, a few seconds | Beat: 10 to 100 of them, one narrative goal | The whole 20-minute drama: 27 beats, about 15 met in one run | A beat sequencer with preconditions, weights, priorities and tension effects; handlers inside a beat | 3 to 5 tonal alternates per exchange; for any tone, 2 to 4 same-function wordings "for freshness" | About 2,500 exchanges, about 66 % of them in beats; one run performs at most 25 % of the content; about 3 person-years of authoring | *read* [practice; primary] |
| **Valve response system** (Left 4 Dead 2 and others) | A response line | A rule: criteria on world facts mapped to a response group | The whole talker script | The most specific matching rule; less specific rules as fallback | Per-line delays; a response group is visited fully before any repeat by default | "Hundreds of facts" against "thousands of lines" (talk listing) | *summary* [shipped, sec] |
| **Storylets** (Fallen London) | A storylet: a paragraph or two with choices | An arc from one storylet to about a hundred branches | None above; no arc without a layer above | Qualities unlock storylets | Not addressed in the sources I read | – | *read* (Short) [practice] |
| **The Witcher 3's dialogue** | Additive gesture, idle, camera cut | A generated dialogue scene built from the voice-over | 1,463 systemic dialogues against 2.5 hours of handmade cutscenes | Generator rules (for example the 180-degree rule); re-running gives a different result; designers edit afterwards | Gestures converted to additive so they work over any idle; blend weights vary them | About 2,400 dialogue animations; 35 idle variants per skeleton type | *summary* (GameAnim) [shipped, sec]. Animation grain, not narrative grain |
| **Cyberpunk 2077's scenes** | City scene: about 1 line (214 scenes) | Ambient conversation, 2.5 lines (335); ambient chat, 6.7 (616); voice set, 30 (661) | Gig scene, 22 (283); side-quest scene, 67 (373); main-quest scene, 85 (477) | Scheduled by the quest and community systems | – | Mean screenplay lines per live scene by role | *read* [corpus] (my query, §5.5) |
| **Oral-formulaic singers** | Formula: one or two words to several lines; about a fifth of the *Iliad*'s and *Odyssey*'s verses recur word for word | Theme, or type-scene (the arming, the council) | Story pattern | The singer composes live, from the stock | Variation in length: 2,294 lines heard, 6,313 sung back | See cells | *summary* (EBSCO; Wikipedia) [analysis] |
| **Commedia dell'arte** | Lazzo or speech, known to the performer, partly rehearsed | A scene in a scenario | The scenario: a plot outline, 50 in Scala's collection | A stock character played by one performer | Fixed plot points; improvised gags | A troupe of about ten | *summary* (Wikipedia) [analysis] |

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VAR-01 | Use several grains, and write them in one representation. A phrase, an exchange, a beat, a job and an arc are the same kind of thing at different sizes, so a bigger unit is built from smaller ones | [shipped]; [corpus] | The table above. Façade nests three levels; the game's scenes span 1 to 85 lines by role. This is [DS-28](../design-seeds.md) | All · 2, 3, 4 | **Produce:** the seed language has one fragment type that can contain fragments, with a declared `level`. **Check:** each level has its own reuse budget and its own variety measure (§5) |
| VAR-02 | Put freshness at the small grain and story at the large grain. Keep several same-function wordings for each exchange, and let a theme stretch or shrink to V's attention without changing its shape | [practice] (Façade); [analysis] (oral song length). That small grain looks *less* repetitive than large grain is a [hypothesis]; no test found | Façade: 3 to 5 tonal alternates, 2 to 4 wordings per tone. Lord's singers: one story at 2,294 and at 6,313 lines. L1:25 | Encounter, gig · 3, 4, X | **Produce:** an *alternates* set with a declared equivalence (same function, same facts established); a *scale* field with short, standard and full forms. **Check:** equivalent alternates establish identical facts; the P9 sorting test compares phrase-level and scene-level reuse (§10) |
| VAR-03 | Choose by context, most specific first, with a general fallback. Authors add special cases without touching the general rule | [shipped]; [practice] | Ruskin (Valve) and Short's salience-based narrative: a line matching more conditions is more salient, ties are broken randomly. Known weaknesses: poor pacing when a specific rule fires in an odd place, and numeric weights tuned by trial and error | Encounter, gig · 3, 4, T | **Produce:** kernel selectors and `weight` contributions ([§4](../spec/kernel.md#4-constraints-and-contributions), [§5.3](../spec/kernel.md#53-weights)); specificity as a count of matched criteria feeding the weight. **Check:** a *dead unit* report (never selected) and a *hot unit* report (selected above a set share); `trace` shows the runner-up ([§13](../spec/kernel.md#13-provenance-and-explanation)) |
| VAR-04 | Every unit states what it needs and what it leaves behind, so any unit that fits the slot is interchangeable. Validity is mechanical; coherence is a separate check | [analysis]; [practice] | Queneau's ten sonnets cut into strips: every line at a position shares rhyme and grammar, so 140 lines give 10^14 poems. Storylets state prerequisites. Counter-instance: the no-enjambment rule bans callbacks, which stories need | All · 2, 4 | **Check:** sample 1,000 random combinations through a validator; the lens's target is under 1 % invalid [hypothesis: a target, not a finding]; a smaller sample goes to raters for coherence. Links to dossier 3 (fitting) |
| VAR-05 | A persistent performer carries recognisable business across contexts. Reusable bits belong to a character's repertoire, not to a place in the plot | [analysis]; [practice] | Commedia: one performer played one type for decades, with set lazzi. Legion added authored anchor characters for continuity ([dossier 4](d04-quest-structure.md) F-07). The claim that this reduces "same NPC, new coat" complaints is the lens's [hypothesis] | Encounter, arc · 3, 4 | **Produce:** casting prefers people whose recorded repertoire holds the bit; a bit's use is logged against the person. **Check:** the same person's bits recur across at least two contexts before they repeat in one |
| VAR-06 | Repeatability is a declared property of every unit, with a minimum gap. Alternates of one function are used up before any is reused | [shipped]; [practice] | Valve's response groups visit every response before repeating (default, per a search summary of the wiki). Dialogue tools expose shuffle-without-repeat as a standard mode. The lens makes repeatability an explicit per-unit audit | Encounter · 2, 3, 4 | **Produce:** `repeat: never / limited(n) / free`, `minGap` in time and count, and an `exhaust-first` flag on alternates. **Check:** audit that every unit declares it |
| VAR-07 | Count what one player can meet, not what exists. A run reaches a fraction of the content, and many combinations are one story | [practice]; primary source | Façade: any run performs at most 25 % of the exchanges; about 15 of 27 beats; thousands of orders, few meaningfully different | Arc · 3, E | **Check:** the *reach* of a synthetic player (share of authored units met in N hours) and the number of *distinct classes* of run after masking (§5.2) |

### 4.2 When players notice (PER-07, PER-08; links to PER-03, PER-06, EVA-03)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VAR-08 | Perceived variety is counted along the few dimensions players actually sort by, not along generator parameters. Which dimensions those are is an open measurement | [practice]; the dimension list is a [hypothesis] | Compton, Short and the lens's F4. My candidate list for quests: what V does (verb), who asks and why (stake), the relationship, the outcome, the tone and the length. [Dossier 4](d04-quest-structure.md) P-1 and QST-06 hold the same idea | All · 3, E | **Check:** free sorting of N outputs; groups divided by N; multidimensional scaling to find the axes, then regress generator features on them (§10). **Produce:** vary the axes players sort by, with at least one situation axis changed per repeat |
| VAR-09 | Players learn what follows what long before they can say why. Expect the skeleton to be learned first; the label arrives later and spreads through the community | [empirical] on simple stimuli; [shipped] timeline. Transfer to narrative skeletons is a [hypothesis] | Saffran et al.: infants segmented a syllable stream after about 2 minutes. Agus et al.: listeners learned repeated noise samples quickly and recalled them about two weeks later. Fallout 4 (F-02): first thread after 7 days. L3:13 | All · 3, E | **Check:** a learner bot (VAR-26). **Produce:** assume the skeleton is seen by the 5th to 10th repeat and plan variation of structure from the start |
| VAR-10 | Hide a skeleton by varying the structure (who initiates, what is at stake, the order of reveals, how it ends), not only the skin (names, places, faces) | [hypothesis], supported by [practice] | L3:13 and L3:25. Short: decorative variation is quickly ignored. Façade: thousands of orders, few that differ, because the beats do not depend on each other. Compare QST-06 | Gig · 2, 3 | **Produce:** templates take structural parameters (initiator, position of the reveal, ending class), not only slots. **Check:** compare a learner bot's bits per unit under skin-only and structural variation |
| VAR-11 | Make the differences nameable. People tire more slowly of a repeated thing when they sort it into finer categories, so each variant should be something a player could name in a few words; prefer a short list of named variants to a continuous range | [empirical] (abstract level); [practice] | Redden 2008: jelly beans labelled by flavour were enjoyed for longer than "jelly beans". Boris the Brave: a list of three named colours reads as three things, a continuous range as "a random colour" | All · 3, 4, E | **Produce:** discrete, named variants chosen from a list; each carries a one-phrase label. **Check:** raters name each variant in under 10 words and agree on the label; a variant nobody can name counts as merged with its neighbour |
| VAR-12 | Choose a few large, correlated decisions per instance. Tie properties together, pick a global setting for the instance first, and give rare variants a probability only after the rule is established | [practice]; unvalidated | Boris the Brave: global settings for a run; rare feature flags mostly at 10 % or less each; the sum of flag probabilities gives the chance of at least one (50 % gives about 40 %, 100 % about 65 %, 200 % about 85 %); "establish a rule before you break it" | Encounter, gig · 3, 4 | **Produce:** at seeding, draw an instance's *mode* (a handful of large choices), then draw the details within it. **Check:** distinguishability of instance pairs; rare variants occur no earlier than the Nth instance of the rule |
| VAR-13 | Variation registers when it is tied to something the player can do or that persists. Decorative variation is ignored | [practice] | Short: generation matters where it connects to mechanics and layered consequences; her examples are a robot's speech changing with what it was taught, and callbacks to inventory. L8:22 principle 1 | All · 3, 4, E | **Check:** surface-only variants are confused with each other more often than consequence-bearing ones in a sorting test. Same idea as QST-06 |
| VAR-14 | Curate: a few clearly different kinds beat many subtly different ones, and curated seeds beat random ones. Scale it with a distance test, not by hand alone | [practice]; the scaling is a [hypothesis] | Compton: kept only the Spore seeds that looked good; "just do what works"; narrow the design space first. L3:14 principles 2 and 3 | Gig, arc · 3, 4, C | **Produce:** an authored catalogue of *kinds*; the generator draws a kind, then varies within it. **Check:** reject a generated unit closer than a set distance to any existing unit of the same kind (distance from §5.4) |
| VAR-15 | Repetition tolerance is tiered by salience. Foreground content (offers, quests, scenes the player attends to) must differ along the sorted axes; background content (crowd lines, texture) may repeat if it is short, separated, and setting-true | [practice]; [hypothesis] | Compton: repeating trees is fine. The map's tension on congruence: setting-true texture is forgettable by design (PER-03), and isolated oddities are what stick. L2 F4: repetition is acceptable for background | Encounter · 3, 4, X | **Produce:** each unit carries a `salience` tier; the budget for repeats is stricter at the top. **Check:** the sorting test runs on foreground units; background units are checked only for separation and for the longest-run statistic |
| VAR-16 | A class of repeating activity must earn its repeats. Adjacent activities should differ in verb, reward and tone, and finite, non-respawning encounters keep their meaning | [practice]; weak (critics and forums, little developer data) | CD PROJEKT RED's stated rule: no quest types, even a fetch involves other things (Weber, via L9:13). F-06: about 113 scanner assaults share one template. Far Cry 3's outposts staying captured is reported, not verified | Encounter, gig · 2, 3, E | **Check:** consecutive-activity statistics in session logs (§5.3) and fatigue measures in human sessions. **Produce:** wrap an objective in a small situation (a stake, a person), as dossier 4's QST-05 asks |
| VAR-17 | Separate a template defect from a convention that gives pleasure. Audiences like a recognisable *process* (Reich's audible process; the formula that carries meaning for its audience) as long as the *instance* is not predictable. The defect is a repeated *situation with stakes*, not a repeated frame | [analysis]; [hypothesis] | Reich: wanted the process to be audible. Foley (via reviews): formulas carry meaning beyond their metrical use. The Fallout 4 pattern was a repeated request with no new stake | All · 3, E | **Check:** run the template miner separately on frame units (greeting, brief, debrief) and on situation units (stake, relationship, outcome); report a template only for the second as a defect, and log the first as a convention |

### 4.3 Scheduling rules (PER-09; links to NAR-14, SEL-03)

Computed values in the notes below are mine, from the arithmetic or simulations described; they are marked [analysis].

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VAR-18 | A random choice does not look random. Draw several random candidates and keep the one that scores best for freshness | [shipped]; [empirical] on direction | Spotify (F-05): several random orderings, scored by how recently each track was played, best kept; the count is unpublished. Falk and Konold: people make more alternations than chance and rate over-alternating sequences as most random. The 2014 version spread each artist's tracks evenly with a random offset ([sec]) | Encounter, gig · 2 | **Produce:** best-of-N over named streams `rand("order", worldSeed, i)` ([§1.4](../spec/kernel.md#14-random-streams)); score by recency of kind. **Check:** run-length and gap statistics against a plain draw (§5.3) |
| VAR-19 | Separate by attribute, in both time and count, and say in what order the rules relax when the pool cannot satisfy them | [practice] (vendor); [analysis] on feasibility | Radio: artist separation of about 1:10 as a general value in a vendor's blog, a 90-minute example, guest keys 10 minutes, secondary keys 20; title separation counted in records (six in the example); rules relax when no candidate fits. Feasibility: with `k` equally allowed kinds and a separation of `w` items, `k` must exceed `w`; the entropy of each choice falls from log2(k) to log2(k − w) bits (k = 8, w = 3: 3.00 to 2.32; k = 6, w = 3: 2.58 to 1.58) | Encounter, gig · 2 | **Produce:** separation as `constrain` contributions on the offer slot, at the scheduler's precedence (300, [§4.1](../spec/kernel.md#41-the-contribution-record)). Arbitration already rejects a constraint that would empty the feasible set ([§5.2](../spec/kernel.md#52-constraint-arbitration)), so relaxation falls out in precedence order; `trace` records which rules were rejected. **Check:** share of offers made with a relaxed rule; alert when the pool of kinds is at most `w` |
| VAR-20 | A bag, or a chance that grows with each miss and resets on a hit, bounds both gaps and streaks without a hard rule | [shipped] | Tetris's seven-bag: at most 12 other pieces between two of a kind; two of a kind in a row at most twice; my simulation gives an adjacent repeat in 2.1 % of draws against 14.3 % for seven independent draws. Dota 2's accumulating chance: for a nominal 25 % the chance is 8.5 % on the first trial, 17 % on the second, 25.5 % on the third, and a hit is certain by the 12th; my simulation of the same rule gives the same mean gap (4.0) with a standard deviation of 1.9 against 3.5 for independent trials, and a longest gap of 12 against 44 in 200,000 trials. Constants: p = 0.10 gives C = 0.0148 (hit by the 68th trial), 0.20 gives 0.0557 (18th), 0.30 gives 0.1190 (9th), 0.50 gives 0.3021 (4th) | Encounter · 2 | **Produce:** a weight factor `min(1, C·n)` where `n` is the count of offers since the kind last appeared, read from the record, so no hidden state is stored ([§9.2](../spec/kernel.md#92-events) events carry `kind`); `C` solved from the nominal rate. **Check:** gap distribution and longest gap against the independent baseline |
| VAR-21 | Rules about order buy perceived randomness at the price of a predictable skeleton. Separate only what players sort by, and keep a floor on the conditional entropy of what comes next | [hypothesis]; arithmetic [analysis] | L3 fields 13 and 25 and the map tension. Computed: a seven-bag has an entropy of about 1.76 bits per piece against 2.81 for independent draws, so a player who counts can predict the last piece of a bag. Variety in order alone is not enough (VAR-10) | Encounter, gig · 2, E | **Check:** the learner bot (VAR-26) must not beat a set margin over the unconstrained baseline. **Produce:** pair separation with structural variation; add jitter to any rotation (Spotify 2014's random offset serves this purpose) |
| VAR-22 | Give recurring world rhythms periods with no small common factor, so the combined pattern repeats only after the least common multiple | [analysis] | Eno's tape loops of uneven lengths (L11:7). Caveat from the lens: three loops give minutes of variety, not astronomical numbers. Cage's chance music is a warning that random is not perceptibly varied | Encounter · 1 | **Produce:** patrol, shift and market periods drawn coprime. **Check:** simulate until the same joint phase returns on a route; report the time |
| VAR-23 | Cover combinations evenly over a session instead of drawing each independently. With k kinds and independent draws, a player needs about k × (1 + 1/2 + … + 1/k) offers to meet all of them (14.7 for 6, 21.7 for 8, 37.2 for 12), and meets a run of 3 or more in 10 offers 18 % of the time with 6 kinds | [analysis] | Perec's bi-squares spread 42 lists of ten elements over 99 chapters so that pairings occur evenly (L11:18). My computations: independent draws over 6 kinds give an adjacent repeat in 16.7 % of steps; the chance of a run of 3 or more in 10 offers is 18 % (6 kinds), 11 % (8), 35 % (4) | Encounter, gig · 2, E | **Produce:** a stratified draw per session over declared attribute factors (tone, setting, device). **Check:** pair-coverage count over 30 offers against independent draws |

### 4.4 Template detection (PER-07, PER-08, PER-09; links to EVA-01, EVA-03)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VAR-24 | A template is a sub-sequence of an abstraction that repeats at least a set number of times. Mine it, then report the share of items containing one, the compressibility of the abstracted stream, and templates per unit | [empirical] in text; transfer to quests is a [hypothesis] | Shaib et al. 2024: abstraction by part-of-speech tags; sub-sequences of length 4 to 8; the 100 most frequent kept, the rarest appearing at least 4 times in 500 texts; metrics are the compression ratio of the abstracted stream, the *template rate* (share of texts holding at least one) and *templates per token*, which corrects for length. Longer templates are rarer but more telling | All · E | **Produce:** an abstraction function `f` per level (§5.4); mine over each player's stream and over the pooled streams. **Check:** report all three metrics per level and per unit kind |
| VAR-25 | Redundancy between units can be measured without choosing features, by how well they compress together; nearest-neighbour similarity then says how many units have a near-twin | [analysis]; [corpus] demonstration | Cilibrasi and Vitányi's normalized compression distance (summary). Falk and Konold: perceived randomness tracked how hard a sequence is to encode, so compressibility is also a proxy for when "feels generated" arrives. First run on the game's graphs: §5.5 | Gig, arc · E | **Check:** pairwise distance and nearest-neighbour similarity on units' abstractions; compare to the same numbers for the game's authored quests as the baseline |
| VAR-26 | Use a learner as a stand-in for the player's implicit learning. Train an n-gram model on the abstracted stream so far, predict the next unit, and track bits per unit against exposure; a fall that tracks the stream, but not a shuffled copy, is a learnable skeleton | [hypothesis]; grounded in [empirical] learning rates | Saffran et al. (transitions learned from brief exposure); Falk and Konold (encodability). Reference points computed: independent draws over 8 kinds give 3.00 bits; separation by 3 gives 2.32; a seven-bag about 1.76 against 2.81 | All · E | **Check:** report bits per unit at 5, 10, 20 and 50 units of exposure, for orders 1 to 3, against the shuffled baseline. A pass is a margin set from the authored baseline, not a fixed figure |
| VAR-27 | Use people as detectors, with tasks that match how players actually react: free sorting, naming, predicting what happens next, retelling, and time-to-name in a long session | [practice]; [empirical] for the methods, none for generated narrative | L3:24 and EVA-01: almost no study measures generated narrative as such. F-02: the community named the pattern in a week. Compton's fan-fiction test | All · E | **Check:** the protocols in §10. A "prediction after N encounters better than chance" result is a template finding even if raters cannot say why (L3:13) |
| VAR-28 | The text layer can bring back the templates the structure layer removed. Test rendered text for repeated syntactic templates and for homogeneity across units, especially if a language model writes it | [empirical] | Shaib et al. 2024 (model output is more templated than human text; 76 % of templates found also occur in pre-training data against 35 % for human text; fine-tuning did not remove them). Doshi and Hauser 2024 (stories written with model ideas were rated better and were more similar to one another). The D-17 text library or live renderer is exactly this risk | Encounter, gig · 3, X | **Check:** compression ratio, self-repetition of long n-grams and template rate on rendered text, per unit kind, against hand-written text of the same kind. **Produce:** several phrasings per beat function, authored or generated and curated; no single phrasing per function |
| VAR-29 | Measure the generator's expressive range on features that people judge, and treat every metric as a tripwire, not a target. Calibrate each metric against sorting data before trusting it | [analysis]; [practice] | Smith and Whitehead: 10,000 levels per histogram; two hand-chosen metrics; the plots exposed a bias in the generator. F-08: no validation against perception found. L8:22 principle 3 (Kybartas et al.'s tension space analysis is a related method, abstract only) | All · E | **Check:** 2D histograms over the axes that VAR-08's scaling finds; rank correlation of each metric with sorting distance; a metric that does not correlate is dropped. Adversarial agents (P9) target the metrics |
| VAR-30 | Uniqueness per player is not enough. A template is visible across players once they compare notes, so evaluate the pooled population of streams, not only one player's | [shipped] | F-02 and L3's EVA-03: the community works as a template detector, and uniqueness per player is lost once players compare. Fallout 4's mockery was about a request every player received | All · E | **Check:** run many synthetic players with different seeds and mine templates in the pool; report templates shared by more than a set share of players |

## 5. Measures a test harness could compute

A *stream* is the ordered list of offers, encounters and beats one player (or one synthetic player) meets, each with features. Everything here is computed offline from the record (kernel §9.2, §13) and from the seeds' declared fields (§9).

### 5.1 Magnitudes the sources give

| Quantity | Value | Where from | Status |
|---|---|---|---|
| Subjective alternation, modal | about 0.6 against 0.5 true | Falk and Konold via the lens | [sec], direction confirmed |
| Exposure for learning transitions (infants, syllables) | about 2 minutes | Saffran et al. | abstract |
| Recall of repeated noise samples | about 2 weeks | Agus et al. | search summary |
| Time to name a template in a shipped game | 7 days to the first forum thread; about 8 weeks to a mocking article | Know Your Meme (Fallout 4) | [community] |
| Radio artist separation | 1:10 general; 90 min example; guest 10 min; secondary 20 min; title separation 6 records | MusicMaster blog | [sec], vendor |
| Tetris seven-bag | at most 12 other pieces between two of a kind; adjacent repeat 2.1 % against 14.3 % | Tetris Wiki; my simulation | [shipped] |
| Dota accumulating chance, nominal 25 % | C = 0.0847; hit certain by trial 12; gap standard deviation 1.9 against 3.5 | Diplograph; my simulation | [shipped] |
| Façade | 10 to 100 exchanges per beat; 1 to 5 lines per exchange; 3 to 5 tonal alternates; 2 to 4 wordings per tone; at most 25 % reached per run | Mateas and Stern | *read* |
| Rare feature flags | mostly 10 % or less each | Boris the Brave | unvalidated |
| Expressive range plots | 10,000 generated items per plot | Smith and Whitehead | *read* |
| Template mining | length 4 to 8; top 100; rarest at least 4 in 500 texts | Shaib et al. | *read* |
| Interface validity | under 1 % invalid in 1,000 random combinations | L11:18 principle 1 | [hypothesis] target |

### 5.2 Distinctness along the axes players sort by

| # | Measure | How to compute | Notes |
|---|---|---|---|
| M-1 | **Sorting ratio** | Humans sort N outputs freely into piles; ratio = piles ÷ N. Compare with the same ratio for N authored items | The L3 and L2 F4 test. No magnitude from the sources; the gate is relative to the authored baseline |
| M-2 | **Perceived axes** | Pairwise dissimilarity from the sorting data, then multidimensional scaling; regress generator features on the recovered axes | Names the axes for VAR-08 and tells the scheduler what to separate on |
| M-3 | **Skeleton diversity after masking** | Mask the slot values (names, places, items) in each unit; count distinct classes of what remains; ratio = classes ÷ N | Catches variation in the slot and not the situation (dossier 4, P-1). Pure computation, no humans |
| M-4 | **Effective number of kinds** | Inverse Simpson (Hill number of order 2) over the kind distribution in a window: uniform over 8 kinds gives 8; shares of 0.5, 0.2 and six of 0.05 give 3.3 | One number that falls when a few kinds dominate |
| M-5 | **Reach and distinct runs** | Share of authored units met in N hours; number of distinct classes of run after masking | Façade: at most 25 % per run; few meaningfully different orders (VAR-07) |

### 5.3 Repetition windows and clumping

| # | Measure | How to compute | Reference values |
|---|---|---|---|
| M-6 | **Adjacent-repeat rate** | Share of steps whose kind equals the previous kind, per attribute | Independent draws: 1/k (16.7 % for 6 kinds, 12.5 % for 8). Bag of 7: 2.1 % |
| M-7 | **Run-length distribution** | Probability of a run of at least r within n offers | Independent, from my simulation: 4 kinds, n = 10: run of 2 or more 93 %, of 3 or more 35 %; 6 kinds, n = 10: 81 % and 18 %; n = 20: 97 % and 36 %; 8 kinds, n = 10: 70 % and 11 %; n = 20: 92 % and 23 %. Longest run on average at n = 20: 2.9 (4 kinds), 2.4 (6), 2.2 (8) |
| M-8 | **Gap distribution** | For each kind, the gaps between appearances: minimum, share below the separation window, maximum | Dota-style rule at p = 0.25: longest gap 12; independent: 44 in 200,000 trials |
| M-9 | **Clumping test** | A runs test on binary features; variance-to-mean of counts in sliding windows | Standard tests (memory); the pass level is a tunable |
| M-10 | **Alternation rate** | For binary features, the share of steps that switch | True random 0.5; people produce and prefer about 0.6 (VAR-18). Tune towards 0.55 to 0.6 and confirm by rating |
| M-11 | **Separation compliance and relaxation** | Share of offers made while a separation rule was relaxed; kinds in the pool against the window | Alert when the pool is at most the window (VAR-19) |
| M-12 | **Pair coverage** | Count of attribute pairs seen in the first 30 offers | Stratified draws should cover more pairs than independent ones (VAR-23) |

### 5.4 Template and predictability measures

| # | Measure | How to compute |
|---|---|---|
| M-13 | **Abstraction ladder** | Three functions `f` per unit, from coarse to fine: (a) *kind* only; (b) kind plus verb, stake type and relationship; (c) full beat sequence with edge types (dossier 4 R-4). Slot values are always masked |
| M-14 | **Template rate, compression ratio, templates per unit** | Apply Shaib et al. to each level: a template is a sub-sequence of `f(stream)` that repeats at least τ times; start with length 3 to 6 and τ set from the sample size (top 100, rarest at least 4 in 500 units); report the share of units containing one, the gzip compression ratio of the concatenated abstraction (higher means more redundancy) and the count per unit |
| M-15 | **Cross-unit distance and nearest neighbour** | Normalized compression distance between pairs of units' abstractions, or Jaccard distance on sets of short paths; for each unit the similarity to its closest other unit. Report the median and the 10th and 90th percentiles |
| M-16 | **Learner bits** | Train orders 1 to 3 on the stream seen so far; mean bits per unit on the next 10 units at exposures 5, 10, 20 and 50; the same on a shuffled copy; report the gap |
| M-17 | **Dead and hot units** | Selection counts per unit; share never selected; Gini coefficient; hottest unit's share |
| M-18 | **Text homogeneity** | On rendered text per unit kind: compression ratio, self-repetition of long n-grams, template rate over part-of-speech tags; the same on authored text of the same kind (VAR-28) |
| M-19 | **Pooled template share** | Over many seeds, the share of players whose streams contain each mined template (VAR-30) |

### 5.5 A first run on the game's own quest graphs

This checks that the detector can see a template in data we have, and gives a baseline. It does not measure what players see: quest graph wiring is invisible to them.

**Method.** From the corpus database (read-only; live resources only), take each quest folder with at least 15 nodes. Label each node by its type plus subtype. Take every directed path of three nodes along the graph's edges as one *trigram*; a folder's trigram set stands for its skeleton. Compare folders within a group by Jaccard similarity of their sets. A trigram type is *common* if it occurs in at least half of a group's folders; the *mass share* of a folder is the share of its trigram occurrences that fall in common types. To remove the effect of size, I also ran gigs and side quests within the same band of 150 to 600 nodes. The run read the database in place under a 3 GB memory guard (peak 0.2 GB); the script was not kept.

| Group (150 to 600 nodes) | Folders | Median pairwise Jaccard | Median nearest-neighbour Jaccard | Common trigram types | Median mass share in common trigrams | Median mass share in common bigrams |
|---|---:|---:|---:|---:|---:|---:|
| Gigs | 68 | 0.067 | 0.140 | 32 | 14.2 % | 40.0 % |
| Side quests | 30 | 0.017 | 0.045 | 1 | 0.1 % | 20.7 % |

Over all sizes: gigs 94 folders (median 302 nodes), side quests 69 (416), main quests 27 (1,253). Median pairwise Jaccard: 0.051, 0.014, 0.022. Median normalized compression distance on label bags (600 random pairs): 0.52, 0.69, 0.93 (lower means more alike; not size-matched). Gig trigram types found in at least half of the gigs are mostly the wiring dossier 4 describes: input to phase nodes, trigger conditions around content-token manager nodes, journal-entry updates, a phone-muted condition before a scene, and a fact set. The two category counts differ from dossier 4's 73 and 85 because I counted every folder with enough nodes.

**Reading.**
- At matched size, gigs are about four times as similar to each other as side quests are, and their nearest neighbour is three times as close. This agrees with dossier 4's finding that gigs share one wiring, and the same measure leaves side quests near zero. So the detector separates a known-templated population from an authored one.
- Only about a seventh of a gig's trigram occurrences sit in types common to half the gigs. The wiring is shared, but it is not most of the graph. Content that makes a gig worth remembering is mostly elsewhere, as dossier 4 found.
- **Limits.** Folder boundaries are the corpus's (a gig may spread over several), size is only controlled by one band, node types are the engine's, and Phantom Liberty's folders are excluded because the category mixes many small near-identical system phases. The numbers show the tool works; they are not a finding about gigs.
- **For P9:** use these same measures on the engine's output at the same abstraction, and hold the engine to a margin set from the authored baseline.

## 6. Tensions

| Tension | One side | The other side | How to settle it |
|---|---|---|---|
| Grain of the reusable unit (map) | Phrase- or gesture-grain units look less repetitive (VAR-02) | Storylets work at scene grain; rule databases at line grain (VAR-03) | Use several grains in one representation (VAR-01) and compare them with the sorting test (M-1) |
| Anti-streak rules or a predictable skeleton (map) | Separation makes a sequence feel random (VAR-18, VAR-19) | It makes the skeleton predictable (VAR-21) | Separate only what players sort by; keep an entropy floor; add jitter; vary structure (VAR-10) |
| Congruence or distinctiveness (map) | Setting-true texture is forgettable by design | Players count only perceptible difference | Tier by salience (VAR-15); a few isolated oddities, the rest congruent |
| Separation keys or "no typology" (dossier 4, QST-07) | The scheduler needs features to separate on | A seed must have no field whose value selects a rule | Separation keys are computed structural features used by the scheduler only, never fields that switch how a seed plays. Record them in the seed language as derived (SL-6) |
| Curation or scale | Curated kinds beat random draws (VAR-14) | A catalogue does not grow itself | A curated catalogue of kinds with generated variation inside each, and a distance test |
| Few big choices or authoring cost | Few, bigger, correlated decisions read as different (VAR-12) | Façade's authors could afford only 27 beats | Make the big decisions parameters of one template, so one authored template yields a handful of named modes |
| Hiding the process or showing it | Hide the skeleton (VAR-10) | An audible process is a pleasure (VAR-17) | Hide the situation; show the frame |
| Per-player uniqueness or community comparison | Each player's stream is unique | Players compare notes (VAR-30) | Test the pooled population |
| Process quality or equal quality (map: peak-end) | Spend the craft on the peak | Equal quality across types, no checklist | Not settled here; see the evaluation dossier |

## 7. Lateral links

- A **bag** is a set of pins without replacement: each draw pins a kind for the rest of the bag, and the bag ends when none is left (kernel §6). A **chance that grows with misses** is a `weight` contribution that is a function of the count since the kind last appeared, read from the record (§5.3, §9.2).
- **Separation with fallback** is constraint arbitration: the scheduler's rules are `constrain` contributions, and one that would empty the feasible set is rejected (kernel §5.2). Radio software's "relax when nothing fits" is the same behaviour, here ordered by precedence.
- **Best-of-N shuffle** (Spotify) is `argmax` over candidate orderings drawn from named, hashed streams, so it stays deterministic (kernel §1.4).
- Façade's **tonal alternates** are a dimension of variants with a `requires` query on the affinity and tension values; Lord's **scale to attention** is the same unit opened to a deeper or shallower level (kernel §7).
- A **learner bot** over the unit stream is the same idea as the player's implicit statistical learning, and also the same idea as a language model's perplexity on a corpus, used here as a detector.
- **Queneau's strips** are slot contracts; **Perec's bi-squares** are stratified draws; **Eno's loops** are incommensurate periods; **Compton's fan-fiction test** is a "would anyone retell this?" check.
- **Template mining on abstractions** is the same procedure that dossier 4 used by hand to find the gig wiring (QST-09).
- A **dead-unit report** is the same check as dossier 3's "does anything ever fit this fragment?".

## 8. Open questions

1. **Does phrase grain look less repetitive than scene grain?** No test found. A sorting-and-fatigue study with the same story told from small units and from large ones would settle VAR-02.
2. **Which axes do players sort Night City content by?** The candidate list in VAR-08 is mine. A card-sorting study of gigs and hustles would give the real list and the scheduler's separation keys.
3. **How many repeats before a skeleton is seen in a quest?** The infant and noise results give a time scale for simple stimuli. The Fallout 4 timeline gives a week of play. Neither gives a count of encounters.
4. **Does the learner bot predict human template reports?** VAR-26 is built on the assumption that it does. Test it against sorting and naming data from the same streams.
5. **What alternation rate feels right for quest kinds?** The 0.6 figure is for random binary sequences. A rating study on offer sequences would give the value.
6. **What separation windows suit gig offers?** Radio's are in minutes and count; for offers the natural unit is game time and V's activity (dossier 4, QST-10). Start with a window of about a third of the number of kinds and tune.
7. **How much does model-written text homogenise a quest's wording?** VAR-28 expects an effect from the two studies. Measure it on our own renderer before D-17's baseline is fixed.
8. **How were Hades's lines chosen?** The claim that unseen lines take priority came from a lens and I could not confirm it. A look at the shipped scripts or the GDC talk would settle it.
9. **Can the template miner be run on beat graphs with typed edges?** §5.5 used node types only. The seed language's typed links (dossier 4, R-4) give a richer abstraction.
10. **Do the abstraction-level numbers change with the sample?** The first run is one band of sizes and one definition of a folder. A bootstrap over folders would give intervals.

## 9. Requirements for the seed language (P4)

What a seed and its fragments must be able to say so that the units recombine, the scheduler can order them, and the tests can see their skeleton. Each traces to a principle. "Comparison" lines are outside systems cited to cross-check, never as sources of the engine's concepts (D-21).

| # | Requirement | Traces to |
|---|---|---|
| SL-1 | **One fragment type at every level.** A fragment declares a `level` (phrase, exchange, beat, job, arc) and may contain fragments of smaller levels. Encounters, gigs and arcs are composed from the same fragments ([DS-28](../design-seeds.md)) | VAR-01 |
| SL-2 | **Needs and leaves.** Every fragment lists the facts it presupposes and the facts it establishes, and the slot roles it can fill, so any fragment that fits a slot can replace another. A validator can run random combinations | VAR-03, VAR-04 |
| SL-3 | **Specificity and fallback.** A fragment's applicability is a set of criteria over the record; the engine prefers the fragment with the most matched criteria and falls back to a more general one. Authors can add a special case without editing the general fragment | VAR-03 |
| SL-4 | **Alternates with a declared equivalence.** A fragment can carry alternates that are equal in function (same facts established, same obligations), grouped by tone, with an `exhaust-first` flag | VAR-02, VAR-06 |
| SL-5 | **Repeatability fields.** Each fragment declares `repeat` (never, limited to n, free) and a minimum gap in game time and in count of offers; a seed can override for its own instances | VAR-06, VAR-19 |
| SL-6 | **Computed skeleton features.** Every seed exposes, as read-only fields computed from its structure, a small set of features the scheduler and the tests may separate on and mine: verb class, stake type, relationship, outcome class, tone, channel, reward class, length. These are never settable by authors and never select a rule (dossier 4, R-2) | VAR-08, VAR-19, VAR-21; QST-07 |
| SL-7 | **Declared variation axes.** A template names which axes it varies: situation axes (verb, stake, relationship, outcome) and structure axes (initiator, position of the reveal, ending class) apart from slot axes (names, places, items). A template that varies only slot axes is flagged | VAR-08, VAR-10, VAR-13 |
| SL-8 | **Named, discrete variants.** A template lists its variants as a short discrete list, each with a one-phrase label, in place of a continuous range. Properties of a variant are correlated by being fixed together | VAR-11, VAR-12 |
| SL-9 | **Modes drawn first.** A template can declare an instance-level *mode*: a handful of large choices drawn at seeding, from which the details are then drawn | VAR-12 |
| SL-10 | **Rare variants with a precondition.** A variant may declare a probability and a *rule it breaks*; it cannot appear before that rule has occurred a set number of times in V's record | VAR-12 |
| SL-11 | **Salience tier.** Every fragment is marked foreground, background or oddity. Foreground units must differ on the sorted axes; background units are checked for separation only; an oddity is limited in how often it may appear | VAR-15 |
| SL-12 | **Repertoires.** A person can carry a repertoire of fragments (bits of business, set lines, a manner). Casting prefers a person whose repertoire holds a fragment the seed wants, and the use of each bit is logged against the person | VAR-05 |
| SL-13 | **Scale forms.** A fragment can declare short, standard and full forms that differ in length and detail but not in shape, for the scheduler to choose from by V's attention | VAR-02 |
| SL-14 | **Scheduler hooks as contributions.** Separation, bag and growing-chance behaviour are declared as `constrain` and `weight` contributions on the offer slot, with parameters (window in time, window in count, `C`), not as code. The seed language provides the parameters and a way to name an attribute set for separation | VAR-18, VAR-19, VAR-20 |
| SL-15 | **Stratification hints.** A seed or a pack can declare factors (tone, setting, device) over which a session should cover combinations evenly | VAR-23 |
| SL-16 | **World rhythms with periods.** A recurring rhythm declares its period, and a pack may not declare two periods with a small common factor without a flag | VAR-22 |
| SL-17 | **Rendering contract.** Each beat function lists several authored or curated phrasings, and says which phrases may be reused and how often. A renderer may not collapse the set to a single phrasing | VAR-28 |
| SL-18 | **Variety provenance.** Each offer records which axes differed from the previous k offers and the stream key it was drawn from, so the harness can recompute any measure from the record without running the engine | VAR-26, VAR-30; kernel §13 |
| SL-19 | **Frames and situations kept apart.** A template marks which of its fragments are frame (greeting, brief, debrief) and which are situation (stake, relationship, outcome), so the template miner can report them separately | VAR-17 |

Comparison: Valve's response rules, Façade's beats with alternates, storylet systems and Daggerfall's quest language are the closest outside designs for SL-1 to SL-5. Each lacks a field for skeleton features (SL-6) and for a declared equivalence of alternates (SL-4).

## 10. Requirements for evaluation (P9)

What the evaluation workstream must provide so that quality bar 5 can be tested. Each traces to a principle. Magnitudes are starting values; the harness sets the gates from the authored baseline (EV-6), not from this dossier.

| # | Requirement | Traces to |
|---|---|---|
| EV-1 | **A free-sorting protocol.** After N exposures (for example 10 and 30), raters sort N outputs into piles; report piles ÷ N, run the scaling, and compare with the same N authored items. Raters see names and places masked in one condition and unmasked in another | VAR-08, VAR-13; M-1, M-2 |
| EV-2 | **A masked-skeleton test.** Mask slots in all units and count the distinct classes of what remains; fail a template that varies only slot values | VAR-07, VAR-10; M-3, M-5 |
| EV-3 | **Stream statistics.** Adjacent-repeat rate, run-length distribution, gap distribution, runs test, alternation rate and effective number of kinds, per attribute and per window, against the independent and bag baselines in §5.3 | VAR-18 to VAR-21; M-4, M-6 to M-10 |
| EV-4 | **A learner-bot test.** Orders 1 to 3, bits per unit at exposures 5, 10, 20 and 50, against a shuffled copy of the same stream and against the authored baseline. Run it at each level of the abstraction ladder | VAR-09, VAR-21, VAR-26; M-13, M-16 |
| EV-5 | **A template miner.** Apply M-14 at each level; report the template rate, compression ratio and templates per unit, for situation units and frame units separately | VAR-24, VAR-17; M-14 |
| EV-6 | **An authored baseline.** Compute the same measures on the game's authored gigs, side quests and scenes, at matched size, and use them as the reference. §5.5 is a first set for gigs and side quests | VAR-25; §5.5 |
| EV-7 | **A text-layer check.** Compression ratio, self-repetition of long n-grams and template rate on rendered text per unit kind, against authored text of the same kind; repeated at each model or renderer change | VAR-28; M-18 |
| EV-8 | **Human tasks that match how players react.** Predict-the-next-beat after N encounters, a name-it prompt for any recurring pattern, a retelling task, and time-to-name in a long session. Record the first offer at which any tester names a pattern | VAR-09, VAR-27 |
| EV-9 | **A blind authored-or-generated panel.** Raters guess which units were generated and say what gave it away; the cues feed back to P4 and P5 | VAR-27 |
| EV-10 | **An expressive-range report.** 2D histograms of 10,000 generated seeds over the axes from EV-1, with the bias named; each metric is checked against sorting data and dropped if it does not track it | VAR-29 |
| EV-11 | **A dead and hot unit report, and reach.** Selection counts, share never selected, Gini, hottest unit's share, share of authored units a run reaches | VAR-03, VAR-07; M-5, M-17 |
| EV-12 | **An interface-validity sample.** 1,000 random combinations through the validator (target under 1 % invalid, tunable), then a small rated sample for coherence | VAR-04 |
| EV-13 | **A scheduler compliance log.** Share of offers made with a relaxed rule, by rule; alerts when the kind pool is at most the separation window | VAR-19; M-11 |
| EV-14 | **Session-length curves.** Run synthetic players for 10, 50 and 200 hours and plot template rate, learner bits and effective number of kinds against hours; report where the curve flattens | VAR-09, VAR-11 |
| EV-15 | **A pooled-population run.** Many seeds; report templates shared by more than a set share of players | VAR-30; M-19 |
| EV-16 | **A rule against gaming the metrics.** Adversarial agents (P1 §2.6) try to pass EV-2 to EV-5 while writing a plainly repetitive sequence; each success is a metric to fix or drop | VAR-29 |
| EV-17 | **Repeat the sorting test when the player-facing axes change.** The axes are measured, not assumed; a new content pack or a new channel re-opens the question | VAR-08 |

## 11. Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Syntactic template detection and text-diversity measurement** (template rate, compression ratio, self-repetition) | Shaib et al., EMNLP 2024 (read); arXiv 2403.00553 (summary) | Core for the text layer and for evaluation; the map's EVA fields hold human instruments only |
| MM-2 | **Compression distance and clustering by compression** | Cilibrasi and Vitányi 2005 (summary) | Supporting, for evaluation |
| MM-3 | **Randomisers in games (bag and pseudo-random distribution)** | Tetris Wiki; Dota 2 write-ups (read) | Supporting; sits under PER-09 but the map names only music shuffle |
| MM-4 | **Satiation and categorisation level** | Redden 2008 (abstract and press) | Supporting; under PER-08, with a consumer-research method |
| MM-5 | **Homogenisation by generative models** | Doshi and Hauser 2024; Shaib et al. 2024 | Supporting, tied to DS-17 and the text layer |
| MM-6 | **Auditory memory for repeated noise** | Agus et al. 2010 (summary) | Peripheral; gives a time scale for PER-07 |
| MM-7 | **Game dialogue systems as a shipped-grain record** (Façade, Valve, the Witcher 3 generator, Hades) | Mateas and Stern (read); Ruskin (summary); GameAnim (read) | Supporting; the map holds EXP-03 and SEL-04 but no field for the cross-system comparison of grain |
| MM-8 | **Statistical tests for clumping** (runs test and relatives) | Memory | Peripheral |
| MM-9 | **Traditional referentiality** (Foley): a formula's meaning for its audience | Search summaries of reviews | Supporting for NAR-10 and VAR-17; sources not read |

## 12. Credit candidates

Each third-party work that taught us something used in the principles above. Link status: "opened" means I opened the page this session; "indexed" means I saw it in search results and a summary only.

| Creator | Title | Link | What we learned | Link status |
|---|---|---|---|---|
| Michael Mateas and Andrew Stern | "Structuring Content in the Façade Interactive Drama Architecture", AIIDE 2005 | https://www.cs.uky.edu/~sgware/reading/papers/mateas2005structuring.pdf | A real interactive drama built on three nested grains, with counts for each, and an honest account of why few of its combinations differ | opened |
| Gillian Smith and Jim Whitehead | "Analyzing the Expressive Range of a Level Generator", PCG workshop 2010 | https://www.pcgworkshop.com/archive/smith2010analyzing.pdf | How to plot what a generator can produce, and that doing so exposes biases | opened |
| Chantal Shaib, Yanai Elazar, Junyi Jessy Li and Byron C. Wallace | "Detection and Measurement of Syntactic Templates in Generated Text", EMNLP 2024 | https://arxiv.org/abs/2407.00211 | A working definition of a template over an abstraction, with three metrics we adapt to quest skeletons | opened |
| Ludvig Borgne and Chidem Sahiner (Spotify Engineering) | "Shuffle: Making Random Feel More Human", 13 November 2025 | https://engineering.atspotify.com/2025/11/shuffle-making-random-feel-more-human | A random draw can be statistically fair and still feel repetitive; choosing the freshest of several random candidates is a practical fix | opened |
| Emily Short | "Bowls of Oatmeal and Text Generation", 21 September 2016 | https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/ | Generated variety matters only where it connects to state and consequence | opened |
| Emily Short | Post on Elan Ruskin's GDC 2012 talk on dynamic dialogue | https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/ | The most specific applicable rule wins, with general rules as fallback, in a shipped rule database | opened |
| Boris the Brave | "Oatmeal Spice", 5 July 2026 | https://www.boristhebrave.com/2026/07/05/oatmeal-spice/ | Fewer, bigger, correlated and discrete decisions make variation noticeable | opened |
| Kate Compton (reported by Game Developer) | Report of her GDC talk on practical procedural generation | https://www.gamedeveloper.com/design/practical-procedural-generation-for-everyone- | A smaller set of clearly different things beats many indistinguishable ones; the fan-fiction test | opened |
| Elan Ruskin (Valve) | "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012 | https://www.gdcvault.com/play/1015528/AI-driven-Dynamic-Dialog-through | Context-matched dialogue from a database of rules; the slides were not reachable | indexed |
| Piotr Tomsiński (reported by GameAnim) | Account of his GDC 2016 talk on The Witcher 3's cinematic dialogues | https://www.gameanim.com/?p=10962 | A generator that recombines small animation units over voice-over, and can be re-run for a different result | opened |
| Know Your Meme (contributors) | "Another Settlement Needs Our Help" | https://knowyourmeme.com/memes/another-settlement-needs-our-help | How fast, and in what words, a player community names a template | opened |
| Digital Music News | "Spotify random shuffle feature", 18 March 2020 | https://www.digitalmusicnews.com/2020/03/18/spotify-random-shuffle-feature/ | The 2014 rewrite that spread each artist's songs, and Apple's earlier Smart Shuffle | opened |
| Joseph P. Redden | "Reducing Satiation: The Role of Categorization Level", *Journal of Consumer Research* 34(5), 2008 | https://ideas.repec.org/a/oup/jconrs/v34y2008i5p624-634.html | Finer categories slow satiation, so nameable differences hold interest longer | indexed |
| Jenny R. Saffran, Richard N. Aslin and Elissa L. Newport | "Statistical learning by 8-month-old infants", *Science* 274, 1996 | https://pubmed.ncbi.nlm.nih.gov/8943209/ | Transitions are learned from about two minutes of exposure | indexed |
| Trevor R. Agus, Simon J. Thorpe and Daniel Pressnitzer | "Rapid formation of robust auditory memories: insights from noise", *Neuron* 66(4), 2010 | https://pure.qub.ac.uk/en/publications/rapid-formation-of-robust-auditory-memories-insights-from-noise/ | Repetition is learned quickly and retained for weeks | indexed |
| Ruma Falk and Clifford Konold | "Making sense of randomness", *Psychological Review* 104, 1997 | https://srri.umass.edu/publications/falk-1997msr/ | People rate over-alternating sequences as most random, and perceived randomness tracks how hard a sequence is to encode | opened |
| Anil R. Doshi and Oliver P. Hauser | "Generative AI enhances individual creativity but reduces the collective diversity of novel content", *Science Advances* 10(28), 2024 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532 | Model-assisted stories were rated better and were more alike | indexed |
| Rudi Cilibrasi and Paul M. B. Vitányi | "Clustering by Compression", *IEEE Transactions on Information Theory* 51(4), 2005 | https://arxiv.org/pdf/cs/0312044 | A feature-free distance from compressed lengths | indexed |
| MusicMaster (vendor) | Scheduling help and blog pages | https://musicmaster.com/?p=11068 | How radio software states separation in time and in count, with defaults and overrides | indexed |
| Albert B. Lord | *The Singer of Tales*, Harvard University Press, 1960 | https://www.ebsco.com/research-starters/literature-and-writing/singer-tales-albert-b-lord | Singers compose live from formulas and themes, and the same story can be sung at very different lengths | read through a secondary summary |
| Kenneth Richards and Laura Richards | *The Commedia dell'Arte: A Documentary History*, Blackwell, 1990 | https://en.wikipedia.org/wiki/Commedia_dell%27arte | Scenario, lazzi and stock characters as a reusable-parts tradition, with caveats on how free it was | read through an encyclopedia page |
