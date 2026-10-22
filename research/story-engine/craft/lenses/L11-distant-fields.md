# Lens L11: distant fields

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise.

**Method note.** Run on 22 October 2026 by one independent lens, working alone: I read nothing in the repository and no other lens output, and started no subagents. I ran about 52 web searches and 9 page fetches. The searches were checks on candidate fields and sources: bibliographic details, the headline findings, and the main published criticisms. The fetches were Wikipedia pages (news values, Music for Airports, Life: A User's Manual, A Pattern Language, Notes on the Synthesis of Form) and the full text of Rankin et al. 2009 on habituation; two further fetches (the Huddersfield repository page for Harcup and O'Neill, and a blog summary of Murch) returned little. Most claims about findings come from search-result summaries rather than the primary texts, which I mostly could not open. I mark those `[sec]`. I mark `[mem]` where I am relying on my own recall of a standard source and could not confirm it this session. Unmarked bibliographic details were confirmed by at least one search hit or are standard. Where the web gave me a counter-finding (Intermediate Disturbance Hypothesis contested, ACH's weak debiasing evidence, Kuleshov replication, Kaplan "legibility" evidence), I report it inside the entry. Terms used throughout: "the engine" is the procedural system; "authored content" is what human authors supply, precise or vague; "far ring" and "near ring" are the LOD simulation levels around the player; "offer" is anything the system surfaces for the player to take up or ignore; "trace" is a persisted consequence of something that happened.

## Index

| # | Field | Relevance | Surprise |
|---|---|---|---|
| 1 | Cartography: generalisation by scale | core | yes |
| 2 | Multiresolution modelling and coarse-graining | core | yes |
| 3 | Architecture: Alexander's pattern languages | core | partly |
| 4 | Urban vitality (Jacobs) | supporting | yes |
| 5 | Landscape and environmental psychology (Kaplan, Lynch) | supporting | yes |
| 6 | Music cognition: expectation | core | yes |
| 7 | Generative and process music (Eno, Reich, Cage) | supporting | yes |
| 8 | Ecology: succession, niches, disturbance | supporting | yes |
| 9 | Epidemiology: transmission and cascades | core | yes |
| 10 | Seismology: magnitude laws, aftershocks, self-exciting processes | core | yes |
| 11 | Cooking and habituation science: sensory-specific satiety | supporting | yes |
| 12 | Law and forensics: traces, precedent, standards of proof | core | yes |
| 13 | Journalism: news values and the inverted pyramid | core | yes |
| 14 | Intelligence analysis: competing hypotheses and diagnosticity | supporting | yes |
| 15 | Military planning: mission command | core | no |
| 16 | Sports analytics: leverage and win probability | supporting | yes |
| 17 | Magic and conjuring | supporting | yes |
| 18 | Oulipo and combinatorial design | supporting | yes |
| 19 | Film editing and event perception | supporting | yes |
| 20 | Pragmatics: relevance theory and Grice | core | yes |
| 21 | Social anthropology and social ontology | supporting | yes |
| 22 | Foraging theory and information scent | core | yes |
| 23 | Alarm management and queueing | supporting | yes |
| 24 | Control theory and cybernetics | supporting | no |
| 25 | Signalling theory | supporting | yes |

---

## 1. Cartography: generalisation by scale

- **Definition.** The craft and science of deriving a smaller-scale map from a larger-scale one by selecting, simplifying, aggregating, displacing and exaggerating features, so that the result stays legible and truthful for its purpose.
- **Why it matters here.** The simulation is held at levels of detail around the player, and story content exists at every scale from a street encounter to a heist. Cartography is the one mature discipline that has asked, for a century, what should survive at scale s, how many items, which ones, and how the sheets stay consistent with each other. Mapping the analogy: a LOD ring is a map scale; "three shootings in the Heywood arcade this week" held at far ring is a small-scale sheet; the specific shooter on the specific corner is the large-scale sheet. Generalisation is not deletion. The operators include typification (replace twelve buildings by four representative symbols), aggregation (merge adjacent items), exaggeration (draw a minor but critical item larger than its true size) and displacement (shift items to resolve conflicts). Applied here: the far ring should hold typified composites ("a turf war"), not many tiny exact events, and an item with a thin statistical footprint but a heavy link to this player's history should be exaggerated, so it survives to the point where the player arrives.
- **Key sources.**
  - Töpfer, F. and Pillewizer, W. (1966). "The Principles of Selection." *The Cartographic Journal* 3(1): 10–16.
  - McMaster, R. B. and Shea, K. S. (1992). *Generalization in Digital Cartography.* Association of American Geographers.
  - Brassel, K. E. and Weibel, R. (1988). "A review and conceptual framework of automated map generalization." *International Journal of Geographical Information Systems* 2(3): 229–244 [mem on pages].
  - Monmonier, M. (1991). *How to Lie with Maps.* University of Chicago Press.
  - Jiang, B. and Liu, X., "Scaling of geographic space as a universal rule for map generalization", arXiv:1102.1561 (https://arxiv.org/abs/1102.1561) [sec on authorship].
- **Instance.** The "radical law" gives the number of features kept on a derived map as N_d = N_s √(M_s / M_d), with M the scale denominators. Going from 1:500,000 to 1:1,000,000 keeps about 71 % of the objects, not half. The law says how many survive, not which ones. [sec]
- **Principles.**
  1. *Sublinear survival.* The number of distinct story-bearing items held per unit area should fall more slowly than the area-to-detail ratio between rings, roughly with a square root, so far rings keep proportionally more per unit than a linear thinning would. Test: compare per-ring item counts against a linear-thinning baseline, and record player reports of "dead" or "cluttered" districts.
  2. *Typify, then conserve.* Far-ring content should be stored as typified composites, and on approach the engine disaggregates into instances whose totals match the composite (casualties, hostility, who owes whom). Test: promote and demote a district repeatedly; the stated aggregate facts must stay within tolerance and a blind player must not see the seam.
  3. *Exaggeration by purpose.* A small item that carries a link to the player's history or to a live thread is retained at far ring at a rate above its size would predict. Test: survival rate of history-linked items against matched items without links.
- **Failure modes.** Maps are static snapshots and the reader picks the scale; the player moves continuously and the world changes under them. Map scale is a clean ratio, while LOD rings are heterogeneous. The radical law is an empirical regularity for geographic features and has no reason to hold for narrative items; treat the exponent as a hypothesis to calibrate, not a law. There is no narrative analogue of geometric conflict (symbols overlapping) that makes displacement necessary.
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Yes. Story-design literature talks about "LOD" as a rendering idea; the cartographic body of work on purposeful selection and exaggeration is rarely used.

## 2. Multiresolution modelling and coarse-graining (simulation science, statistical physics)

- **Definition.** Methods for building a family of models of the same system at different resolutions and keeping their answers consistent when state is aggregated or disaggregated; the defence-modelling literature calls it variable-resolution or multiresolution modelling, and its physics cousin is coarse-graining and the renormalisation group.
- **Why it matters here.** This is the LOD problem stated in its own terms. When the player walks toward a far-ring district, the engine must promote an aggregate ("rising unrest, two armed crews, one grudge against V") into individuals, and the promoted detail must be consistent with what the player was told or inferred at far ring. The defence community has worked on aggregation and disaggregation since at least the early 1990s and found that consistency across resolutions is not free: it must be designed and calibrated. [sec] Three lessons transfer. First, aggregation loses information, so disaggregation is sampling from a distribution conditional on the aggregate, and the choice of that distribution is a modelling decision that should be explicit. Second, the coarse model's update rules should be fitted to the fine model's behaviour, not authored independently. Third, statistics depend on how space is aggregated: the modifiable areal unit problem (MAUP) shows that results change with the zoning, so "hot districts" can be artefacts of where the boundaries were drawn.
- **Key sources.**
  - Davis, P. K. and Hillestad, R. (1993). "Families of Models that Cross Levels of Resolution: Issues for Design, Calibration and Management." *Proceedings of the 1993 Winter Simulation Conference*, 1003–1012 (DOI 10.1109/WSC.1993.718351) [sec].
  - Davis, P. K. and Bigelow, J. H. (1998). *Experiments in Multiresolution Modeling (MRM).* RAND MR-1004-DARPA (https://apps.dtic.mil/sti/pdfs/ADA355041.pdf) [sec; I could not retrieve the body text].
  - Davis, P. K. (1993). *An Introduction to Variable-Resolution Modeling and Cross-Resolution Model Connection.* RAND R-4252-DARPA (https://www.rand.org/pubs/reports/R4252.html).
  - Openshaw, S. (1984). *The Modifiable Areal Unit Problem.* CATMOG 38, Geo Books, Norwich [mem].
  - Crow, J. F. and Kimura, M. (1970). *An Introduction to Population Genetics Theory.* Harper and Row, for the 1/N scaling of drift [mem].
- **Instance.** In a ground-combat model a brigade is held as an aggregate with attrition coefficients; to connect it to a unit-level model, the aggregate parameters have to be calibrated against unit-level runs, and mismatches between the two levels are the classic failure. [sec] The same logic in population genetics: random drift in allele frequency has variance proportional to 1/N, so small populations are inherently noisy and large ones nearly deterministic. [mem]
- **Principles.**
  1. *Invariants at the seam.* Declare a short list of aggregate quantities that disaggregation must conserve (hostility level, count of armed parties, open grudges involving the player). Test: round-trip promote and demote many times; every invariant stays within tolerance.
  2. *Calibrate coarse from fine.* The far-ring update rules for "narrative weather" should be fitted to statistics measured from near-ring runs of the same district, and re-fitted when content changes. Test: event rates (fights per night, arrests per day) from the near-ring run and the far-ring model agree within a stated band; a drift beyond the band triggers recalibration.
  3. *Noise should scale with population, and zoning must not leak.* Near-ring (few agents) outcomes should be visibly noisier than far-ring aggregates, in the 1/√N sense; forcing smoothness onto small populations or noise onto large ones makes the transition detectable. Separately, per-district event rates should be computed over jittered or overlapping units so that "hot" districts are not zoning artefacts (MAUP). Test: variance of an observable across seeds versus population size follows 1/N within tolerance; re-draw the district boundaries and the set of hot areas stays stable.
- **Failure modes.** The defence problem has physical ground truth (attrition), so cross-resolution error is measurable. Narrative aggregates carry meanings and relationships, many not conserved quantities. There is no external ground truth: the fine-level sim is whatever the engine says it is. The engine may also invent detail on disaggregation, which a physical model cannot. MAUP is about statistics; the engine controls its own zoning.
- **Relevance.** Core; confidence high.
- **Surprise.** Yes. The defence-modelling literature is the nearest thing to an engineering theory of LOD consistency and it is almost unknown outside that field.

## 3. Architecture: Alexander's pattern languages

- **Definition.** Christopher Alexander's method of recording design knowledge as named solutions to recurring problems in context, each stating the competing forces it resolves, linked in a network from regional scale down to detail.
- **Why it matters here.** Authors "write content precisely or vaguely, and the engine fits it into the world." A pattern has the shape of a good vague spec: it says in what context it applies, what tension (forces) it resolves, and what to do, while leaving the instance open. The links give multi-scale composition: a heist pattern contains smaller patterns (the inside man, the getaway, the witness) and sits inside larger ones (a faction arc). Three transferable parts that game design has mostly not taken from him: (a) *forces* as the applicability condition rather than simple triggers; (b) the *generative sequence*, where you apply the largest relevant pattern first and let each smaller choice be made in the context the larger one set; (c) the argument that real cities are semilattices (overlapping units), not trees, so decompositions into strictly nested pieces produce lifeless results.
- **Key sources.**
  - Alexander, C., Ishikawa, S., Silverstein, M. et al. (1977). *A Pattern Language: Towns, Buildings, Construction.* Oxford University Press (253 patterns; each is treated as a hypothesis with a confidence marker, per Wikipedia).
  - Alexander, C. (1979). *The Timeless Way of Building.* Oxford University Press.
  - Alexander, C. (1964). *Notes on the Synthesis of Form.* Harvard University Press.
  - Alexander, C. (1965). "A City Is Not a Tree." *Architectural Forum* 122(1–2).
  - Alexander, C. (2002–2005). *The Nature of Order*, 4 vols. Center for Environmental Structure.
- **Instance.** In the book every pattern links upward to the larger patterns it helps complete and downward to the smaller ones that complete it, and it carries asterisks marking how confident the authors are in it. [sec/Wikipedia]
- **Principles.**
  1. *Match on forces, not only triggers.* Each content item declares the 1–3 tensions it needs present in the world (a debt and a rival and a witness); the engine selects by force match. Test: relevance ratings of force-matched selections against trigger-only selections for the same budget.
  2. *Large-to-small unfolding.* Choose the largest applicable structure first and fix the constraints it implies before choosing smaller pieces. Test: the rate of incoherent combinations (an NPC in two places, a reference to an event that has not happened) when generation proceeds large-to-small versus random order.
  3. *Semilattice participation.* Allow people, places and objects to be members of several threads. Test: fraction of persistent NPCs belonging to two or more live threads, against players' ratings of the world feeling interconnected; a pure-tree decomposition is the control.
- **Failure modes.** Alexander's patterns concern static physical settings used over long periods; stories are temporal and the player's attention is serial. Patterns are hypotheses that were never systematically tested, and the later work (*The Nature of Order*) is hard to falsify [mem]. The "patterns" idea is already in software and game design (Björk and Holopainen, *Patterns in Game Design*, 2005 [mem]), so only the forces, unfolding and semilattice parts are fresh.
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Partly. Patterns as such are familiar; the semilattice argument and generative sequence are not.

## 4. Urban vitality (Jacobs)

- **Definition.** Jane Jacobs's account of what makes city districts diverse, lively and self-policing, and of the conditions that generate that diversity rather than planning it.
- **Why it matters here.** The setting is a city and the requirement is variety "in ways players notice." Jacobs's central claim is that diversity is not designed piece by piece; it is generated when conditions make many small unrelated enterprises viable in the same place and time. She names four: mixed primary uses (more than one main function, so different people are present at different hours), short blocks (many routes), a mix of old and new buildings (cheap niches for marginal enterprises), and dense concentration (enough people to support variety). [sec] The analogy: variety of ambient encounters comes from the world state having several independent reasons for people to be in one place at different times, not from a variety quota. Her "eyes on the street" is a witness model: events are noticed, remembered and reported because bystanders with persistent routines are present. That is the substrate for consequences that feel caused.
- **Key sources.**
  - Jacobs, J. (1961). *The Death and Life of Great American Cities.* Random House (esp. chs. 2 and 7–10).
  - Jacobs, J. (1969). *The Economy of Cities.* Random House.
  - Weaver, W. (1948). "Science and Complexity." *American Scientist* 36(4): 536–544, on problems of organised complexity, which Jacobs cites [mem].
- **Instance.** Jacobs's account of a Greenwich Village sidewalk as a sequence of unplanned, complementary routines through the day, which produces safety and chance contact without anyone planning either. [mem]
- **Principles.**
  1. *Two reasons to be here.* Zones with two or more independent primary uses (workers, residents, nightlife) produce more varied ambient encounters per hour than single-use zones. Test: entropy of encounter types per hour in matched mixed-use and single-use zones.
  2. *Cheap old content sustains variety.* A population of small, low-production, long-authored fragments coexists with and supports the large arcs; remove it and perceived variety falls by more than its share of volume. Test: ablate the cheap fragments in a play session and rate variety.
  3. *Witness capacity.* The share of player acts that later feel caused rises with the density of persistent observers who could have seen them. Test: vary observer density in a district and measure how often players, asked "why is this happening", can name the cause.
- **Failure modes.** Jacobs's conditions describe economic viability, not attention, and the engine can supply "mixed use" at no real cost. Her claims are observational; later empirical work on "eyes on the street" and crime is mixed [mem, unverified here]. Past the near ring there are no individuals to be witnesses at all.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes (moderate): the witness-capacity and generator-of-diversity framing is not standard in quest design.

## 5. Landscape and environmental psychology (Kaplan, Lynch)

- **Definition.** The study of how people read and prefer environments. Kaplan and Kaplan's preference matrix says environments are liked for coherence, complexity, legibility and mystery; Kevin Lynch's *The Image of the City* says a city is legible when people can form a clear mental image from a few element types (paths, edges, districts, nodes, landmarks).
- **Why it matters here.** "Legible" is a stated requirement, and variety must be noticeable. The Kaplan matrix splits what you can take in now (coherence, complexity) from what you must infer about moving on (legibility: can I find my way and know what I'm getting into; mystery: the promise of more information if I go further). [sec] An offer needs both: readable stakes and first step, plus a lead the player can follow to learn more. Mystery requires an apparent path; a blocked view is not mystery. Lynch gives a small vocabulary for the player's mental map of the *story state*: ongoing threads as paths, recurring hubs as nodes, memorable people and incidents as landmarks, factions' turf as districts, boundaries of hostility as edges.
- **Key sources.**
  - Kaplan, R. and Kaplan, S. (1989). *The Experience of Nature: A Psychological Perspective.* Cambridge University Press.
  - Kaplan, S. (1987). "Aesthetics, affect, and cognition: environmental preference from an evolutionary perspective." *Environment and Behavior* 19(1): 3–32 [mem].
  - Lynch, K. (1960). *The Image of the City.* MIT Press.
  - Appleton, J. (1975). *The Experience of Landscape.* Wiley (prospect and refuge) [mem].
- **Instance.** A path that bends out of sight into woods has mystery; a closed wall does not. [mem] Coherence and complexity can be judged from the scene directly; legibility and mystery have to be inferred from its layout. [sec]
- **Principles.**
  1. *Legibility plus mystery.* Offers that state their kind and first step while promising reachable further information are taken up more than offers high on only one. Test: A/B with the two cues crossed; measure uptake and "that wasn't what I expected" reports.
  2. *Mystery needs a path.* The same hidden detail, with and without a visible lead (someone who knows, a place to go), produces more investigation with the lead. Test: matched pair.
  3. *Few element types.* The player's story state should be organisable into about five stable element types. Test: players can sketch their story map from memory after N hours, and the sketch matches the engine's model.
- **Failure modes.** Preference studies use photographs and student subjects; the empirical support for legibility specifically is weak in a 2013 review, and results on complexity conflict (an inverted U in some, linear in others). [sec] Story is not spatial. Lynch's method was interviews in three 1950s American cities [mem].
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes for the Kaplans' mystery-needs-a-path point; no for Lynch, which level design already uses.

## 6. Music cognition: expectation

- **Definition.** The study of how listeners predict upcoming musical events and how fulfilled, delayed and violated predictions produce feeling; Meyer's 1956 theory and Huron's ITPRA model are the main frameworks.
- **Why it matters here.** The system has to pace tension and release and produce surprise that reads as earned. Huron's ITPRA says responses form in five systems with different timescales: Imagination and Tension before the outcome; Prediction, Reaction and Appraisal after. [sec] Reaction is fast and crude; Appraisal is slow and considered; they can disagree, and Huron's "contrastive valence" holds that a negative fast reaction followed by a positive appraisal is felt as stronger pleasure than a positive alone. [sec] A quantified version: Cheung et al. (2019) scored uncertainty and surprise for 80,000 chords in popular songs and found that pleasure was high either when a chord broke expectations after low uncertainty, or matched them under high uncertainty, with the amygdala, hippocampus and auditory cortex tracking the interaction. [sec] Mapped here: for each live thread the engine should estimate how sure the player is about what comes next, and place twists where they are sure and confirmations where they are unsure. The same mechanism underlies the comedic rule of three: a pattern has to be established before it can be broken.
- **Key sources.**
  - Meyer, L. B. (1956). *Emotion and Meaning in Music.* University of Chicago Press.
  - Huron, D. (2006). *Sweet Anticipation: Music and the Psychology of Expectation.* MIT Press.
  - Cheung, V. K. M., Harrison, P. M. C., Meyer, L., Pearce, M. T., Haynes, J.-D., Koelsch, S. (2019). "Uncertainty and surprise jointly predict musical pleasure and amygdala, hippocampus, and auditory cortex activity." *Current Biology* 29(23): 4084–4092 [mem on pages; DOI 10.1016/j.cub.2019.09.067].
  - Narmour, E. (1990). *The Analysis and Cognition of Basic Melodic Structures.* University of Chicago Press [mem].
- **Instance.** Huron's surprise-party example: the startle registers as threat, and within roughly half a second appraisal recognises friends and converts fear into celebration. [sec]
- **Principles.**
  1. *Uncertainty × surprise.* A beat's payoff is highest for surprise where the player's uncertainty was low and for confirmation where it was high, and lowest for expected-and-certain or surprising-and-uncertain beats. Test: have the engine estimate player uncertainty per thread (count of live hypotheses, time since last clarifying beat) and A/B matched against random beats on player ratings.
  2. *Appraisal must arrive.* A startling beat needs a reappraisal within a short window (seconds to a minute here) or the negative reaction stands. Test: vary the latency between shock and meaning; rate the beat.
  3. *Establish before subvert.* A planned subversion is rated lower if the player has not witnessed the pattern at least twice. Test: subversions with and without verified exposure.
- **Failure modes.** Musical expectation is learned from a lifetime of exposure to an idiom, at timescales of seconds; a player's expectations about this world form over hours. Cheung's results concern chord progressions; extension to minutes of play is a hypothesis. The player's uncertainty is not directly observable. ITPRA is a framework, not a calibrated model.
- **Relevance.** Core; confidence medium.
- **Surprise.** Yes (the 2×2 rule).

## 7. Generative and process music (Eno, Reich, Cage)

- **Definition.** Composition by designing materials and rules that produce music when run, rather than fixing a sequence.
- **Why it matters here.** The engine must produce variety from a finite pool of authored pieces without noticeable repetition. Brian Eno's tape-loop pieces combine a few short fixed elements of different lengths, started together and left to configure themselves; he wanted "complicated rather than simple relationships" between the loops, and the loops in "2/1" came out uneven in length. [Wikipedia, fetched] The arithmetic is that loops with periods that share no small factor produce combined patterns repeating only after the least common multiple. Reich adds a perceptual requirement: he wanted the process to be audible throughout the sounding music ("perceptible processes"), and the person listening hears a *system*, not noise. Cage supplies the warning: chance operations make output statistically varied but often perceptually undifferentiated.
- **Key sources.**
  - Eno, B. (1996). "Generative Music." Lecture, Imagination Conference, San Francisco, 8 June 1996; transcript at https://inmotionmagazine.com/eno1.html.
  - Reich, S. (1968). "Music as a Gradual Process," in *Writings on Music 1965–2000* (Oxford University Press, 2002); text at https://ccrma.stanford.edu/courses/220b/readings/Reich_Gradual-Process.pdf.
  - Eno, B. (1978). *Ambient 1: Music for Airports.* Polydor.
  - Cage, J. (1961). *Silence.* Wesleyan University Press.
  - Reich, S. *It's Gonna Rain* (1965) and *Piano Phase* (1967) as the phasing pieces.
- **Instance.** Three singers' loops of uneven length in "2/1" are set running and drift against each other. [Wikipedia, fetched]
- **Principles.**
  1. *Incommensurate cycles.* Give recurring world rhythms (patrol loops, market days, shift changes, broadcast slots) periods without small common divisors; distinct world configurations before exact repeat then scale with the LCM. Test: simulate time until the same joint phase reappears on a route; players' "I've seen this exact thing" rate falls as the LCM grows.
  2. *Audible process.* The rule behind variation should be perceivable (the shift change visibly in progress), so variation reads as a system. Test: after N exposures players can predict the next occurrence of a cycle but not the specific instance.
  3. *Randomness is not variety.* At equal entropy, a structured category change (different kind of event) is rated more varied than random parameter perturbation (a different number). Test: head-to-head rating.
- **Failure modes.** Music is passive, one-dimensional and heard in sequence; the player acts and the same configuration is never met identically anyway. The LCM of three loops gives minutes, not astronomical variety. Reich's phasing is fully deterministic, which works against surprise.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes.

## 8. Ecology: succession, niches, disturbance

- **Definition.** The study of how populations of different kinds coexist, replace one another over time, and respond to disturbance.
- **Why it matters here.** Content types compete for the same openings and earlier events prepare, block or ignore what comes later. Three ideas carry over. (a) Connell and Slatyer (1977) name three ways earlier occupants affect later ones: facilitation (they prepare the ground), inhibition (they hold the space) and tolerance (neutral). [sec] A gang war can facilitate a fixer's rise; a dominant long arc can inhibit new street stories. The engine can classify pairwise interactions and watch for inhibition. (b) Competitive exclusion and the niche idea (Gause; Hutchinson): two items with the same requirements and the same register compete and one starves, so coexistence needs niche partitioning (different times, districts, moods). (c) Disturbance regimes. The popular intermediate-disturbance hypothesis, that diversity peaks at moderate disturbance, is contested: Fox (2013) argued it should be abandoned on empirical and theoretical grounds, and Sheil and Burslem replied that his criticism targets the wrong thing. [sec] I therefore do not use it. A better-supported piece is the fire-suppression result: suppressing small fires lets fuel build up and shifts the size distribution toward large fires; Malamud et al. (1998) found power-law frequency-area statistics for fires and suggested small and medium fires inform the risk of large ones. [sec]
- **Key sources.**
  - Connell, J. H. and Slatyer, R. O. (1977). "Mechanisms of succession in natural communities and their role in community stability and organization." *American Naturalist* 111: 1119–1144.
  - Gause, G. F. (1934). *The Struggle for Existence.* Williams and Wilkins.
  - Hutchinson, G. E. (1957). "Concluding remarks." *Cold Spring Harbor Symposia on Quantitative Biology* 22: 415–427 [mem].
  - Fox, J. W. (2013). "The intermediate disturbance hypothesis should be abandoned." *Trends in Ecology and Evolution* 28(2): 86–92.
  - Malamud, B. D., Morein, G. and Turcotte, D. L. (1998). "Forest fires: an example of self-organized critical behavior." *Science* 281: 1840–1842 [page range varies by source].
  - Paine, R. T. (1966). "Food web complexity and species diversity." *American Naturalist* 100: 65–75 (keystone predator).
- **Instance.** Paine removed the top predator starfish from a rocky shore and the community collapsed to fewer species. [mem] The analogue: a few recurring characters or places hold up a district's diversity of small stories.
- **Principles.**
  1. *Classify the interaction.* Every pair of sequenced threads is facilitation, inhibition or neutral, and the engine tracks inhibition. Test: when a long arc is active, the starting rate of new street-level threads in its district falls; if so, schedule around it.
  2. *Partition niches.* Authored items with high niche overlap (context requirements × emotional register) show unequal play frequency. Test: compute pairwise overlap; compare frequency ratios; partition and re-measure.
  3. *Don't suppress small fires.* If far-ring tension is damped to keep the city calm, rare large events become larger. Test: simulate with and without damping and compare event-size distributions and the largest event.
- **Failure modes.** Ecological populations have no intentions and cannot be edited; authors set niches, and players choose. Ecological metaphors are notoriously loose, and the contested IDH is a live warning. The fire-suppression result concerns physical fuel, not attention; transfer is by mechanism (accumulating stored tension), which the engine must actually model.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes (the three-way succession vocabulary and the suppression point).

## 9. Epidemiology: transmission and cascades

- **Definition.** The mathematics of how something spreads through a population through contacts: reproduction numbers, thresholds, individual variation in transmission, and reconstruction of who infected whom.
- **Why it matters here.** Consequences must spread through a simulated city and feel caused, and the engine must not let a thread die in one beat or take over the world. Treat a story seed (a rumour, a grudge, a bounty) as an infection with an effective reproduction number R, the mean number of follow-on events per event. With R below 1, chains fizzle; above 1, they sustain and can run away. Real transmission is overdispersed: individual infectiousness is highly skewed, so models with that variation predict more fade-outs and rarer but more explosive outbreaks than the average suggests (Lloyd-Smith et al. 2005, using contact-tracing data from eight diseases). [sec] Network structure matters: on scale-free networks, with a few hubs, Pastor-Satorras and Vespignani (2001) found no epidemic threshold at all, so even weakly transmissible items persist. [sec] In a social graph where fixers, gossips and journalists are hubs, how fast news of the player's acts moves depends on which hubs they reach. Contact tracing is the third borrowed idea: keep the provenance chain for every spawned event so the explanation "this is happening because of A, via B and C" can be rendered.
- **Key sources.**
  - Kermack, W. O. and McKendrick, A. G. (1927). "A contribution to the mathematical theory of epidemics." *Proceedings of the Royal Society A* 115: 700–721 [mem].
  - Anderson, R. M. and May, R. M. (1991). *Infectious Diseases of Humans.* Oxford University Press.
  - Lloyd-Smith, J. O., Schreiber, S. J., Kopp, P. E. and Getz, W. M. (2005). "Superspreading and the effect of individual variation on disease emergence." *Nature* 438: 355–359 (https://pubmed.ncbi.nlm.nih.gov/16292310/).
  - Pastor-Satorras, R. and Vespignani, A. (2001). "Epidemic spreading in scale-free networks." *Physical Review Letters* 86: 3200 (https://arxiv.org/abs/cond-mat/0010317).
  - Watson, H. W. and Galton, F. (1875). "On the probability of the extinction of families." *Journal of the Anthropological Institute* 4: 138–144 (branching processes) [mem].
- **Instance.** Lloyd-Smith et al.: for SARS and measles a few cases cause most onward transmission. [sec]
- **Principles.**
  1. *Control the offspring mean.* Track the mean number of follow-up events per seed type over a rolling window. Short-lived seeds should sit below 1, and only designated arc seeds above 1, with a cap. Test: simulate cascades from many seeds; check extinction and runaway frequencies against targets.
  2. *Choose the skew.* Most acts leave a small trace and a few produce many follow-ups, with the offspring distribution chosen deliberately (a negative binomial with small dispersion). Test: the distribution of experienced consequences per player act matches the target and players do not report "nothing ever comes of anything".
  3. *Every spawned event carries a trace of its cause.* Test: a reviewer picks 50 spawned events at random and recovers a chain of at most four links to a prior event; the share that succeeds should be near 100 %.
- **Failure modes.** Pathogens do not choose to transmit; the engine does, so R is a design knob rather than an observation. The player is not a susceptible node. The engine already knows each cause, so the tracing problem is presentation, not inference. A story "contact" has no reliable definition.
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Yes.

## 10. Seismology: magnitude laws, aftershocks, self-exciting processes

- **Definition.** The statistics of earthquake occurrence: the Gutenberg–Richter magnitude–frequency law, Omori's law of aftershock decay, and the ETAS (Epidemic-Type Aftershock Sequence) model, a self-exciting point process in which every event can trigger others.
- **Why it matters here.** The system spans "passing street encounters to multi-part heists" and must also schedule consequences. Gutenberg–Richter says the number of events falls log-linearly with magnitude (b close to 1, so each step up is about ten times rarer) [mem]; it is a template for how many items of each scale to author and spawn. Omori says the rate of aftershocks decays roughly as 1/(t+c)^p with p near 1 [mem]: many follow-ups soon after the main event and a long, thin tail. That fits the intuition that the world reacts to a heist heavily at first, then less, and never entirely stops. ETAS (Ogata 1988) puts background events and triggered events in one intensity: λ(t) = μ + Σ K·exp(α·m_i)/(t − t_i + c)^p, where the triggering productivity of a parent grows with its magnitude. [sec] The same self-exciting structure has been used for near-repeat patterns in burglary (Mohler et al. 2011). [sec] This gives a cheap, principled far-ring engine: simulate district intensity with an ETAS-like model, then sample concrete instances on approach (see entry 2).
- **Key sources.**
  - Gutenberg, B. and Richter, C. F. (1944). "Frequency of earthquakes in California." *Bulletin of the Seismological Society of America* 34(4): 185–188.
  - Omori, F. (1894). "On the aftershocks of earthquakes." *Journal of the College of Science, Imperial University of Tokyo* 7: 111–200 [mem].
  - Hawkes, A. G. (1971). "Spectra of some self-exciting and mutually exciting point processes." *Biometrika* 58(1): 83–90.
  - Ogata, Y. (1988). "Statistical models for earthquake occurrences and residual analysis for point processes." *Journal of the American Statistical Association* 83(401): 9–27.
  - Mohler, G. O., Short, M. B., Brantingham, P. J., Schoenberg, F. P. and Tita, G. E. (2011). "Self-exciting point process modeling of crime." *Journal of the American Statistical Association* 106(493): 100–108 (DOI 10.1198/jasa.2011.ap09546).
- **Instance.** Mohler et al. applied it to residential burglary data from Los Angeles, borrowing the aftershock analogy for near-repeat victimisation. [sec]
- **Principles.**
  1. *Log-linear tiers.* The count of authored and spawned items per scale tier falls on a straight line on a log scale. Test: plot per-tier counts; ask players how rare they perceive the biggest events; flattening the curve (many large events) should depress the felt weight of each.
  2. *Omori timing of consequences.* After a major act, reactions are scheduled with density roughly proportional to 1/(t+c)^p rather than uniformly or as one delayed reaction. Test: players' "the world reacted" versus "the world forgot" reports at 5 minutes, 1 hour and 1 day (in play time).
  3. *Aftershocks are smaller than the mainshock.* The largest follow-up of an event is typically about a magnitude step below it (Båth's law [mem]); if the largest follow-up equals the parent it reads as a second main event. Test: distribution of follow-up sizes against parent size.
- **Failure modes.** Earthquakes are physical, with no one choosing; the constants (b, p, c, K, α) are not transferable and must be tuned to play-time, not clock time. The player may log off between mainshock and aftershocks. Magnitude has no narrative definition without a deliberate scale. In a self-exciting model the stationary rate is only stable if the branching ratio is below 1, which links back to entry 9.
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Yes.

## 11. Cooking and habituation science: sensory-specific satiety

- **Definition.** The study of how pleasure in a food declines specifically with eating it, and how course structure and variety reset appetite.
- **Why it matters here.** "Varied in ways players notice" and "well paced." In humans, liking for a food just eaten falls more than liking for foods not eaten. Subjects ate a third more when offered sandwiches with four fillings than with one, and in a four-course meal energy intake rose by about 60 % mainly because of the third and fourth courses. [sec] The general science is habituation, and Rankin et al. (2009) list the properties: response decline with repetition, spontaneous recovery, stimulus specificity within a modality (a novel stimulus is not the same as dishabituation), dishabituation (a different stimulus restores the response to the original), and habituation of dishabituation (the restoring trick wears out with repetition). [fetched, PMC2754195] Mapped here: the player's appetite for a kind of content declines along specific feature dimensions (the car-park shootout, the fetch job, the sardonic informant), not along content IDs, and switching dimension restores appetite. A tasting menu is a sequence of courses chosen so that no sensory dimension is carried for too long.
- **Key sources.**
  - Rolls, B. J., Rolls, E. T., Rowe, E. A. and Sweeney, K. (1981). "Sensory specific satiety in man." *Physiology and Behavior* 27: 137–142.
  - Rolls, B. J., Rowe, E. A., Rolls, E. T. et al. (1981). "Variety in a meal enhances food intake in man." *Physiology and Behavior* (https://pure.psu.edu/en/publications/variety-in-a-meal-enhances-food-intake-in-man/) [volume and pages unconfirmed; I recall 26: 215–221].
  - "Pleasantness changes and food intake in a varied four-course meal" (https://pure.psu.edu/en/publications/pleasantness-changes-and-food-intake-in-a-varied-four-course-meal/) [authors and year from memory: Rolls, Van Duijvenvoorde and Rolls, *Appetite*, 1984].
  - Rankin, C. H. et al. (2009). "Habituation revisited: an updated and revised description of the behavioral characteristics of habituation." *Neurobiology of Learning and Memory* 92(2): 135–138 (https://pmc.ncbi.nlm.nih.gov/articles/PMC2754195/).
- **Instance.** The four-sandwich experiment: n = 36, a third more eaten with variety (p < 0.001). [sec]
- **Principles.**
  1. *Per-dimension satiety.* Keep a satiety vector over content features that recovers over time, and choose the next offer from the least-satiated dimensions. Test: A/B against random choice at equal total volume; measure self-reported fatigue and session length.
  2. *Gimmicks habituate.* A variety device (the twist, the unreliable informant, the ambush) loses its variety value on repeated use, so each device is tracked as its own feature. Test: the same device used at increasing frequency; plot the rating.
  3. *Courses.* After high-intensity content, a deliberate contrast on a different dimension (a quiet comic encounter, a travel vista) restores appetite better than rest at the same intensity. Test: palate-cleanser types compared on the rating of the next high-intensity beat.
- **Failure modes.** Eating is gated by physiology, entertainment fatigue partly by boredom, a different (informational) process. The food-variety effect makes people eat *more*, which is a warning: variety can be used to keep a player in, which conflicts with "the player is never controlled." The engine needs content annotated by feature, which is a cost.
- **Relevance.** Supporting; confidence medium-high.
- **Surprise.** Yes (moderate): satiety per dimension and habituation of the variety device itself.

## 12. Law and forensics: traces, precedent, standards of proof

- **Definition.** Three bodies of practice about how a past event becomes a basis for present decisions: forensic trace evidence (Locard), precedent reasoning (ratio decidendi, case-based argument), and standards of proof scaled to the cost of error.
- **Why it matters here.** The content must "feel caused" and be "relevant to the player's history", which is a requirement to refer to the past reliably and fairly. (a) *Traces.* Locard's principle, usually put as "every contact leaves a trace", says physical contact transfers material in both directions [sec]; the data-model reading is that each consequential act should write a trace with location, persistence and who could perceive it, and later content should read the traces, not a global flag list. (b) *Precedent.* Goodhart proposed that the principle of a case is found from the facts the judge treated as material plus the decision; Stone's reply was that the result depends on how generally the facts are described. [sec] Ashley's HYPO program modelled argument from cases with "dimensions", citing the most on-point cases and "distinguishing" the current one from them. [sec] For callbacks the question is which features of the past act are material, and what distinguishes the present situation. (c) *Standards of proof.* John Kaplan's decision-theoretic account: convict only when the expected cost of wrongly convicting is below the expected cost of wrongly acquitting, so the standard rises with the harm of error. [sec] NPCs that act on beliefs about the player should need evidence proportional to the cost of being wrong.
- **Key sources.**
  - Locard, E. (1934). *Traité de criminalistique.* Lyon: Desvignes [exact volume and wording unverified; the "every contact leaves a trace" phrasing is a later summary].
  - Goodhart, A. L. (1930). "Determining the ratio decidendi of a case." *Yale Law Journal* 40(2): 161–183 [mem]; the criticism by Stone and the defence by Lücke are in an article in the *Bond Law Review* (https://blr.scholasticahq.com/article/5173.pdf) [exact title unconfirmed].
  - Ashley, K. D. (1990). *Modeling Legal Argument: Reasoning with Cases and Hypotheticals.* MIT Press; Ashley and Rissland (1987), AAAI-87 (https://cdn.aaai.org/AAAI/1987/AAAI87-049.pdf).
  - Kaplan, J. (1968). "Decision theory and the factfinding process." *Stanford Law Review* 20: 1065.
- **Instance.** HYPO takes a new trade-secret case, retrieves the most on-point precedents by shared dimensions, and builds arguments that cite, distinguish and rebut. [sec]
- **Principles.**
  1. *Trace-first consequences.* Every callback must resolve through an existing trace. Test: for a random sample of callbacks, the fraction that can show a trace path ("how do they know?") should be 100 %.
  2. *Match on material features, then try to distinguish.* A callback fires on shared material features and is suppressed or altered when a distinguishing feature exists (the player acted under duress; the NPC was not present). Test: the rate of "that doesn't apply to what I did" complaints, with and without the distinguishing step.
  3. *Stakes-scaled evidence.* The evidence threshold for an NPC's action scales with the cost of error: a glance on a weak trace, a hit order only on a strong one. Test: plot action severity against evidence strength; unfairness reports should concentrate where severity exceeds evidence.
- **Failure modes.** Law is adversarial, textual and institutional; precedent binds by institutional norm. The engine can read ground truth, so a "standard of proof" governs NPC epistemics only. HYPO's dimensions needed hand-built knowledge. Stone's objection is a warning: relevance matching depends on the granularity of description.
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Yes (trace-as-data-model and stakes-scaled evidence).

## 13. Journalism: news values and the inverted pyramid

- **Definition.** The study and craft of selecting which events become news and how a news item is ordered for a reader who may stop reading at any point.
- **Why it matters here.** The sim produces far more candidate events than the player can attend, and choosing what to surface is the news selection problem. Galtung and Ruge (1965) proposed twelve factors describing events, with three hypotheses: additivity (more factors, more likely selected), complementarity (factors can substitute for one another), and exclusion (events with none or very few are not selected). [sec] Several of the factors translate directly. *Frequency*: an event is more likely to be reported when its time-span fits the medium's cycle, so long processes go unreported. *Meaningfulness* (cultural proximity) is relevance. *Continuity*: a story already in the news gains inertia. *Composition*: stories compete for limited space, so selection depends on what else is being selected. [sec] Harcup and O'Neill revised the list (2001; 2017), adding follow-up, entertainment and the news organisation's own agenda among others. [sec] The inverted pyramid orders a story with the most important facts first and details in descending importance, so it can be cut from the bottom. Applied here: a surfaced encounter should deliver its lead in the first seconds, with detail for those who stay.
- **Key sources.**
  - Galtung, J. and Ruge, M. H. (1965). "The structure of foreign news." *Journal of Peace Research* 2(1): 64–91.
  - Harcup, T. and O'Neill, D. (2001). "What is news? Galtung and Ruge revisited." *Journalism Studies* 2(2): 261–280.
  - Harcup, T. and O'Neill, D. (2017). "What is news? News values revisited (again)." *Journalism Studies* 18(12): 1470–1488 (https://eprints.hud.ac.uk/id/eprint/27268/).
  - White, D. M. (1950). "The 'gate keeper': a case study in the selection of news." *Journalism Quarterly* 27: 383–390 [mem].
  - Pöttker, H. (2003). "News and its communicative quality: the inverted pyramid." *Journalism Studies* 4(4): 501–511 [mem].
- **Instance.** Galtung and Ruge tested their factors on how four Norwegian newspapers covered the Congo, Cuba and Cyprus crises. [sec]
- **Principles.**
  1. *Compose, don't take top-K.* The set of offers made in a stretch of play should be optimised as a mix (a front page), not by independent scores. Test: at equal mean score, top-K against composition-constrained selection on perceived variety and relevance.
  2. *Frequency fit and the news peg.* Events must unfold on the player's timescale to be noticed; slow simulation processes are surfaced through a punctuating event that hangs the process on something observable. Test: the same slow process, surfaced with and without a peg, on notice rate.
  3. *Lead first.* A surfaced encounter delivers who, what and stakes in its opening seconds, with detail in descending order of importance. Test: players who disengage after ten seconds can still state what the encounter was about.
- **Failure modes.** News values are descriptive of what editors did select, with a Western newspaper sample from the 1960s; later tests of Galtung and Ruge gave conflicting conclusions. [sec] There is a bias toward negativity. A news reader does not act on the world; a player does. Composition here also means pacing across a session, which news did not formalise.
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Yes (frequency fit and the news-peg idea are not in game-design practice, as far as I know).

## 14. Intelligence analysis: competing hypotheses and diagnosticity

- **Definition.** Structured analytic technique for assessing uncertain situations. Richards Heuer's Analysis of Competing Hypotheses (ACH) lists all plausible hypotheses, records for each piece of evidence whether it is consistent with each, and works by seeking to reject hypotheses rather than confirm one.
- **Why it matters here.** Mysteries, investigations and heist planning give the player a set of live hypotheses (who betrayed me; which route is unwatched). The usable idea is *diagnosticity*: evidence consistent with every hypothesis does not help choose among them. [sec] If authored content declares the hypotheses it supports, the engine can compute each clue's discriminating power against the hypotheses the player plausibly holds, prefer clues that eliminate one, and flag non-diagnostic filler. A second idea is calibrated language: in-world sources should speak in a fixed mapping from confidence phrases to probability bands (Sherman Kent's "words of estimative probability" [mem]), so uncertainty is legible.
- **Key sources.**
  - Heuer, R. J. Jr. (1999). *Psychology of Intelligence Analysis.* CIA Center for the Study of Intelligence, ch. 8 (https://www.cia.gov/resources/csi/static/Pyschology-of-Intelligence-Analysis.pdf).
  - Heuer, R. J. Jr. and Pherson, R. H. (2010). *Structured Analytic Techniques for Intelligence Analysis.* CQ Press.
  - Kent, S. (1964). "Words of Estimative Probability." *Studies in Intelligence* 8(4) [mem].
  - Dhami, M. K., Belton, I. K. and Mandel, D. R. (2019). "The 'analysis of competing hypotheses' in intelligence analysis." *Applied Cognitive Psychology* 33(6): 1080–1090 (https://strathprints.strath.ac.uk/69049/).
- **Instance.** Heuer's matrix has hypotheses as columns and evidence as rows, each cell marked consistent, inconsistent or neutral, and attention goes to the inconsistent cells. [mem; secondary summary agrees]
- **Principles.**
  1. *Every clue discriminates.* Each placed clue is inconsistent with at least one hypothesis the player plausibly holds. Test: build the clue-by-hypothesis matrix for an investigation; count clues that eliminate nothing; compare solve satisfaction with and without filler.
  2. *Keep two alive.* The truth should not be the only consistent hypothesis before the discriminating beat. Test: plot live hypotheses against time; players' tension ratings.
  3. *Calibrated phrases.* A source's wording maps to a fixed probability band and its reliability stays consistent across the game. Test: whether players' trust in sources, measured after play, tracks the sources' true hit rates.
- **Failure modes.** Players hold hypotheses implicitly, so the engine must infer or ask (a journal). Game evidence is usually authored as conclusive, not probabilistic. ACH's benefit for human judgement is disputed: trained analysts did not follow all the steps, and the evidence for debiasing was mixed. [sec] Use ACH here as a design tool for clue structure, not as a claim about player cognition.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes (moderate).

## 15. Military planning: mission command

- **Definition.** The command philosophy in which a commander states purpose, key tasks and desired end state, and subordinates choose the means and adapt when the plan meets reality.
- **Why it matters here.** The authoring format has a spectrum from precise scripts to vague wishes, and the engine fills the gap. The vague end is exactly a commander's intent: say what the beat is *for* and what must be true after, leave the how open. US Army doctrine describes intent as a concise statement of the purpose and desired end state, which lets subordinates exercise disciplined initiative when the plan fails. [sec] Clausewitz's "friction" is the name for plans meeting an uncooperative world, here the world state. Mapped: an authored beat is (purpose; facts that must be communicated; end state; things that must not happen), with a suggested path that the engine may replace. The doctrine also asks subordinates to understand the intent one level up, so a fragment should carry the purpose of its enclosing arc.
- **Key sources.**
  - US Army (2019). *ADP 6-0: Mission Command: Command and Control of Army Forces.*
  - Van Creveld, M. (1985). *Command in War.* Harvard University Press.
  - Clausewitz, C. von (1832). *On War*, trans. Howard and Paret (Princeton University Press, 1976), Book 1, ch. 7 on friction.
  - Shattuck, L. G. and Woods, D. D. (2000). "Communication of intent in military command and control systems," in McCann and Pigeau (eds.), *The Human in Command.* Kluwer [mem].
- **Instance.** An order to "seize the bridge to stop the crossing" lets the company commander take the ford instead when the bridge is down, because the purpose was stated. [constructed illustration]
- **Principles.**
  1. *Intent triple.* An authored beat carries purpose, end state and must-not constraints; an engine adaptation is accepted iff it satisfies the triple. Test: a verifier checks adaptations; blind authors rate adaptations "on message" and the two agree.
  2. *Two-up.* Each fragment carries the purpose of its enclosing arc. Test: adaptation quality with and without the parent purpose.
  3. *Adapt before dropping.* When a precondition fails, the engine first looks for another path that still meets the intent. Test: the fraction of failed-precondition cases rescued rather than skipped, and the rescue's acceptance by authors.
- **Failure modes.** Mission command presumes subordinates with shared training, trust and judgement; the engine has only what is encoded. Story purposes are fuzzier than a military end state, and authors may be unable to state them. An enemy supplies friction; the world here is not adversarial.
- **Relevance.** Core for the authoring format; confidence medium-high.
- **Surprise.** No. The analogy is natural and goal-directed planning is familiar; the value is in the specific triple and two-up rule.

## 16. Sports analytics: leverage and win probability

- **Definition.** Tom Tango's Leverage Index measures how much a single event can move a team's win probability, scaled so that 1.0 is average; win probability added attributes each change to the play that caused it.
- **Why it matters here.** The engine needs a measure of how much a moment matters that is not intensity. Define for each thread a probability distribution over its endings, and the leverage of a beat as the expected swing in that distribution. A quiet conversation can have high leverage; a gunfight at the wrong time can have low. Leverage is also skewed: about 10 % of real baseball situations exceed 2 and about 60 % are below 1. [sec] Broadcast practice adds a staging idea: play-by-play says what happened, colour commentary says why it matters, and good broadcasts alternate.
- **Key sources.**
  - Tango, T., Lichtman, M. and Dolphin, A. (2007). *The Book: Playing the Percentages in Baseball.* Potomac Books.
  - MLB Glossary, "Leverage Index" (https://www.mlb.com/glossary/advanced-stats/leverage-index).
  - FanGraphs Library, "Leverage Index" (https://library.fangraphs.com/misc/li).
  - Baseball-Reference, "Win Expectancy (WE) and Run Expectancy (RE) Stats" (https://baseball-reference.com/about/wpa.shtml).
- **Instance.** A team down three with bases loaded and two out in the eighth is an above-1.0 situation. [sec]
- **Principles.**
  1. *Importance is leverage, not spectacle.* Players' ratings of "that mattered" correlate more with computed leverage than with intensity. Test: collect ratings and compare.
  2. *Keep the skew.* A session's beat leverage is distributed with many low and few high values. Test: flatten the distribution (every beat high stakes) and measure perceived stakes; I predict they fall.
  3. *Spend high leverage on attention.* High-leverage beats are placed where the player is demonstrably attending (not mid-menu or in a long traversal), because a missed high-leverage beat is a waste. Test: attention proxy at delivery against recall of the beat.
- **Failure modes.** Sport has one clear win condition and a century of data; stories have neither. The player's belief state is unobservable. Leverage measures outcome swing, not emotional significance.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes.

## 17. Magic and conjuring

- **Definition.** The craft of constructing an audience's perception and causal beliefs: controlling attention, distorting perception, influencing choice.
- **Why it matters here.** Magic is the inverse of our brief in one respect and the same in another. The magician hides the method; the system must make cause legible and never deceive to control. The same craft has measured facts about attention that the engine can use honestly. Kuhn, Amlani and Rensink (2008) argue that cognitive science has overlooked what magicians know about controlling attention, distorting perception and influencing choice. [sec] Teller's published principles include exploiting the audience's pattern recognition: a pattern of four coins produced invites the expectation of a fifth. [sec] The use here: (a) attention is limited, and what the player did not see does not count as having happened for relevance, so track what was perceived; (b) a consequence feels caused only when the audience can rule out coincidence, which is what a magician does by closing alternative explanations, so show the link; (c) use transparent direction (framing, sound, movement) for essential information and never rely on peripheral cues.
- **Key sources.**
  - Kuhn, G., Amlani, A. A. and Rensink, R. A. (2008). "Towards a science of magic." *Trends in Cognitive Sciences* 12(9): 349–354 (https://www2.psych.ubc.ca/~rensink/publications/abs.08.1.html).
  - Macknik, S., Martinez-Conde, S. and Blakeslee, S. (2010). *Sleights of Mind.* Henry Holt.
  - Lamont, P. and Wiseman, R. (1999). *Magic in Theory.* University of Hertfordshire Press [mem].
  - Teller (2012). "Teller Reveals His Secrets." *Smithsonian Magazine*, March (https://www.smithsonianmag.com/arts-culture/teller-reveals-his-secrets-100744801/).
  - Ortiz, D. (1994). *Strong Magic.* Ortiz Publications [mem].
- **Instance.** Teller's four-coin sequence followed by an empty palm shows how an established pattern sets up a false expectation. [sec]
- **Principles.**
  1. *Perception ledger.* Record for each beat whether the player demonstrably perceived it (line of sight, dwell, camera); callbacks may only cite perceived events. Test: the rate of "I didn't see that" complaints at callbacks, with and without the ledger.
  2. *Rule out coincidence.* A consequence presented with one clear anchor to its cause is judged "caused" more often than the same consequence with the anchor removed. Test: matched pair.
  3. *Direct attention openly.* Essential information is delivered through the central channel, not the periphery. Test: recall of peripheral and central deliveries.
- **Failure modes.** Magic is staged in minutes before a seated audience with a fixed viewpoint; players control the camera and self-direct attention. Deception for control is excluded by the brief. The field is anecdote-heavy; Kuhn et al. is a call to a science rather than a settled body of findings.
- **Relevance.** Supporting; confidence medium-low.
- **Surprise.** Yes.

## 18. Oulipo and combinatorial design

- **Definition.** The Oulipo (founded 1960) pursued literature produced under explicit mathematical or formal constraints, including combinatorial texts and schemes for distributing elements evenly.
- **Why it matters here.** Authors write fragments and the engine combines them, so the question is how to write fragments so that every combination is valid, and how to cover attribute combinations evenly. Queneau's *Cent mille milliards de poèmes* has ten sonnets cut into strips; every line at a given position shares the rhyme sounds and is a grammatical unit with no enjambment, so any line can replace the same-position line of another sonnet, giving 10^14 valid poems from 140 lines. [sec] The principle is *interchangeability by interface contract*. Perec's *La Vie mode d'emploi* used 21 Graeco-Latin "bi-squares" to spread 42 lists of ten elements across 99 chapters so that each paired combination of elements occurs in a controlled way, ordered by a knight's tour of the 10×10 grid. [Wikipedia, fetched] That is design-of-experiments thinking (Latin squares, orthogonal arrays) used to guarantee coverage without clumping.
- **Key sources.**
  - Queneau, R. (1961). *Cent mille milliards de poèmes.* Gallimard.
  - Perec, G. (1978). *La Vie mode d'emploi.* Hachette; trans. D. Bellos (1987), *Life: A User's Manual.*
  - Mathews, H. and Brotchie, A. (eds.) (1998). *Oulipo Compendium.* Atlas Press.
  - Le Lionnais, F. (1962). "La Lipo (le premier manifeste)," in *La littérature potentielle* (Gallimard, 1973) [mem].
  - Bose, R. C., Shrikhande, S. S. and Parker, E. T. (1960). "Further results on the construction of mutually orthogonal Latin squares and the falsity of Euler's conjecture." *Canadian Journal of Mathematics* 12: 189–203 [mem].
- **Instance.** The count: each of the first ten lines combines with ten second lines, and so on across fourteen lines, giving 10^14. [sec]
- **Principles.**
  1. *Slot contracts.* Define the small interface of world state that a fragment may assume and must leave; any fragment from the right slot then fits. Test: sample 1,000 random combinations through an automated validator; invalid combinations should be under 1 %.
  2. *Orthogonal coverage.* Over a session, pairs of attribute values (tone × setting × device) appear equally often under an orthogonal array and with clumps under random draws. Test: count pair coverage across 30 encounters under each scheme.
  3. *Validity is not coherence.* Validity checks are mechanical; meaning across combinations needs a separate check. Test: players' coherence ratings against validity pass rate.
- **Failure modes.** Poems are read once, linearly. The "no enjambment" rule bans cross-fragment dependence, which stories need for callbacks. Latin-square designs assume equal-sized factors and free choice; the engine's choices are constrained by world state.
- **Relevance.** Supporting; confidence medium-high.
- **Surprise.** Yes.

## 19. Film editing and event perception

- **Definition.** The craft of joining shots into a continuous experience, and the cognitive science of how viewers segment and connect what they see.
- **Why it matters here.** Editing is the art of deciding what to show, what to skip and what to place next to what. Three transfers. (a) Murch's "rule of six" orders what a cut must satisfy: emotion first, then story, rhythm, eye-trace, the two-dimensional plane of the screen and the three-dimensional space of action. Emotion is said to be worth over half, and story 23 % [sec]; I recall the full weighting as 51/23/10/7/5/4 [mem]. When you cannot satisfy everything, sacrifice from the bottom. The engine needs an explicit priority ladder for conflicts. (b) The Kuleshov effect: juxtaposition leads viewers to infer connection and emotion. A replication found that some version of the effect exists, with participants picking the expected emotion category more often and ratings moving as predicted. [sec] Adjacent events are read as linked whether or not they are, so the engine should audit adjacency. (c) Event segmentation theory: perceivers forecast the near future and register an event boundary when the forecast fails, and boundaries shape attention and memory. [sec] Beats should align to perceived boundaries, and time-skips should show an effect of elapsed time at a boundary, as a film's ellipsis does.
- **Key sources.**
  - Murch, W. (1995/2001). *In the Blink of an Eye.* Silman-James Press.
  - Barratt, D., Rédei, A. C., Innes-Ker, Å. and van de Weijer, J. (2016). "Does the Kuleshov effect really exist? Revisiting a classic film experiment on facial expressions and emotional contexts." *Perception* 45(8): 847–874 (https://research.cbs.dk/en/publications/does-the-kuleshov-effect-really-exist-revisiting-a-classic-film-e-2/).
  - Prince, S. and Hensley, W. E. (1992). "The Kuleshov effect: recreating the classic experiment." *Cinema Journal* 31(2): 59–75 [mem].
  - Zacks, J. M., Speer, N. K., Swallow, K. M., Braver, T. S. and Reynolds, J. R. (2007). "Event perception: a mind-brain perspective." *Psychological Bulletin* 133(2): 273–293 (https://pubmed.ncbi.nlm.nih.gov/17338600/).
- **Instance.** Murch's argument that a cut that gets the emotion right survives violations of eyeline or geometry that the audience does not notice. [mem]
- **Principles.**
  1. *Explicit conflict ladder.* When requirements conflict, a fixed order decides, with inviolable constraints named separately (for example, setting truth). Test: log conflicts and outcomes; check that lower-rung violations are noticed less often than upper-rung ones.
  2. *Adjacency audit.* Before dispatching a beat, check the previous beats and concurrent threads for unintended implied links in tone or causality. Test: players' reports of spurious connections, with and without the audit.
  3. *Boundary alignment.* Offers begin and end at perceived event boundaries, and time skips show an elapsed-time effect. Test: memory for beats that straddle boundaries compared with aligned ones.
- **Failure modes.** A film is edited with total control of order and framing, for a passive viewer; the player controls the camera. The Kuleshov effect has a contested replication history (the original footage is lost, and earlier replications conflicted [sec]). Murch's weights are an editor's heuristic with no derivation. Event segmentation results come from short clips, and a 2024 preprint found prediction uncertainty fit human segmentation better than prediction error. [sec]
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes (priority ladder, adjacency audit).

## 20. Pragmatics: relevance theory and Grice

- **Definition.** The study of how meaning is communicated beyond literal content. Sperber and Wilson's relevance theory defines the relevance of an input to an individual by the balance of positive cognitive effects against processing effort; Grice's cooperative principle and maxims explain implicature.
- **Why it matters here.** "Relevant to the player's history" needs an operational definition. Relevance theory gives one: the more positive cognitive effects, the more relevant; the more processing effort, the less. [sec] The main effect is a contextual implication, a conclusion that follows from the new input combined with existing assumptions but from neither alone; others are strengthening or revising or abandoning existing assumptions. [sec] Applied to callbacks: a reference to something the player barely remembers has potentially large effect and large retrieval effort, so low relevance unless a cue lowers the effort; a reference to something fresh costs little but adds little. The best callbacks sit at mid distance with a cheap cue. Grice's maxims (quantity, quality, relation, manner) apply to authored briefings and rumours, and a deliberate flout creates subtext (an NPC who answers a different question implies a refusal).
- **Key sources.**
  - Sperber, D. and Wilson, D. (1986/1995). *Relevance: Communication and Cognition.* Blackwell.
  - Wilson, D. and Sperber, D. (2004). "Relevance Theory," in Horn and Ward (eds.), *The Handbook of Pragmatics.* Blackwell (https://www.dan.sperber.fr/wp-content/uploads/2004_wilson_relevance-theory.pdf).
  - Grice, H. P. (1975). "Logic and Conversation," in Cole and Morgan (eds.), *Syntax and Semantics 3: Speech Acts.* Academic Press, 41–58.
  - Clark, H. H. (1996). *Using Language.* Cambridge University Press (common ground).
- **Instance.** Offered coffee, "Coffee would keep me awake" is understood as a refusal by flouting the maxim of relation. [standard textbook example, mem]
- **Principles.**
  1. *Relevance = effects ÷ effort.* The relevance a player assigns to a callback is better predicted by (number and weight of their existing assumptions it touches) ÷ (time since and number of intervening similar events) than by either term alone. Test: fit player-rated relevance against the ratio, the numerator and the denominator.
  2. *Cheap cues scale with elapsed time.* The cue (a name, a token, a phrase) included in a callback should grow with time since the original event. Test: the same callback at 20 minutes and 20 hours, with and without a cue.
  3. *Brief to the maxims.* Authored briefs are lint-checked for excess information, ambiguity and irrelevance, and any flout is flagged as intentional. Test: player comprehension of briefs before and after lint.
- **Failure modes.** Relevance theory is about communicative utterances, and effects and effort are not measurable without a model of the hearer; it has been criticised for being hard to quantify [mem]. Player memory is unobservable. Grice assumes cooperative speakers; the setting is full of liars (which is itself a use of the maxims, flouting them).
- **Relevance.** Core; confidence medium-high.
- **Surprise.** Yes.

## 21. Social anthropology and social ontology

- **Definition.** Accounts of how societies create obligations and social facts: the gift and reciprocity (Mauss, Gouldner, Bourdieu), rites of passage (Van Gennep, Turner), constitutive rules and status functions (Searle) and speech acts (Austin).
- **Why it matters here.** "Consequential" and "true to the setting" need social consequences that are real in the world rather than flags. (a) *Reciprocity and delay.* Favours create obligations (Mauss; Gouldner's norm of reciprocity), and Bourdieu stressed that the interval between gift and return is part of the practice: one commentary quotes him as saying that abolishing the interval abolishes strategy. [sec] Obligations returning after a socially plausible delay feel natural; immediate or never feels contrived. (b) *Status functions.* Searle's formula "X counts as Y in context C" says institutional facts exist by collective acceptance of a status imposed on something. [sec] A bounty, a ban, a membership or a debt should be modelled as a declared status with a declarer, a scope and a set of acceptors, so there is always an answer to "who says so?". (c) *Rites of passage.* Van Gennep's separation, liminality and incorporation suggest that status changes become real when publicly performed; the engine should stage the initiation, the blacklisting, the offer, and not flip a variable. Austin's felicity conditions give the failure cases: a performative can misfire.
- **Key sources.**
  - Mauss, M. (1925). "Essai sur le don." *L'Année Sociologique*; trans. W. D. Halls (1990), *The Gift*, Routledge.
  - Gouldner, A. W. (1960). "The norm of reciprocity: a preliminary statement." *American Sociological Review* 25(2): 161–178.
  - Bourdieu, P. (1977). *Outline of a Theory of Practice.* Cambridge University Press.
  - Searle, J. R. (1995). *The Construction of Social Reality.* Free Press.
  - Austin, J. L. (1962). *How to Do Things with Words.* Oxford University Press.
  - Van Gennep, A. (1909). *Les rites de passage*; Turner, V. (1969). *The Ritual Process.* Aldine.
- **Instance.** Searle's president example: a person counts as President in a country only because of collective acceptance. [sec]
- **Principles.**
  1. *Declared status.* Every social consequence has a declarer, a scope and acceptors, and players can answer "who says so?" for each. Test: ask players, per consequence, and check their answers match the engine's record.
  2. *Plausible lag.* Obligations return after a delay drawn from a distribution that depends on the favour's size. Test: naturalness ratings of callbacks as a function of lag.
  3. *Staged thresholds.* Status transitions are performed publicly under felicity conditions, and a failed performance becomes content. Test: players' recall and understanding of staged against silent transitions.
- **Failure modes.** These are interpretive theories with large cultural variation; Bourdieu's reading is of a specific ethnography and not universal. Searle's formula is a mnemonic, and it strains for free-standing statuses such as electronic money. [sec] A 2077 corporate city has more legal and contractual machinery than gift exchange. The sim's agents do not "collectively accept" anything; the engine encodes rules.
- **Relevance.** Supporting (core for consequences and setting); confidence medium.
- **Surprise.** Yes (moderate).

## 22. Foraging theory and information scent

- **Definition.** Optimal foraging theory models how an animal allocates time among patches with diminishing returns; information foraging theory carries it to people seeking information, with "information scent" as the proximal cue that predicts the value of a distant path.
- **Why it matters here.** The player forages for interesting activity. Charnov's marginal value theorem says leave a patch when the capture rate falls to the average rate across the environment. [sec] A district, a hub or a heist's planning phase is a patch whose yield declines as it is worked. Pirolli and Card (1999) separate patch models, scent models (judging value from proximal cues) and diet models (choosing which items to pursue). [sec] Mapped: (a) the engine should open a new lead when a patch's yield approaches the city average, or let the player leave gracefully; (b) the cue on an offer is its scent, and it must correlate with the payoff or players learn to ignore cues. Simon's observation that a wealth of information creates a poverty of attention frames both.
- **Key sources.**
  - Charnov, E. L. (1976). "Optimal foraging, the marginal value theorem." *Theoretical Population Biology* 9(2): 129–136.
  - Pirolli, P. and Card, S. (1999). "Information foraging." *Psychological Review* 106(4): 643–675 (DOI 10.1037/0033-295X.106.4.643).
  - Pirolli, P. (2007). *Information Foraging Theory.* Oxford University Press.
  - Simon, H. A. (1971). "Designing organizations for an information-rich world," in Greenberger (ed.), *Computers, Communications, and the Public Interest.* Johns Hopkins Press, 37–72.
  - Stephens, D. W. and Krebs, J. R. (1986). *Foraging Theory.* Princeton University Press.
- **Instance.** Web users follow links whose text carries strong scent and abandon a path when the scent fails. [sec]
- **Principles.**
  1. *Honest scent.* The correlation between cue strength and eventual payoff, measured per cue type, is positive and stable; cues that lose the correlation are retired. Test: log cue type, uptake and rated payoff.
  2. *Patch depletion.* Interest within a patch decays; when its marginal rate nears the city average the engine introduces a new lead. Test: when players leave patches, are they satisfied or frustrated; vary the timing of the new lead.
  3. *Attention has a price.* Each extra concurrent offer reduces uptake of the others. Test: vary the number of open offers and measure per-offer uptake.
- **Failure modes.** Players do not maximise rate of gain; they play for meaning and mood. MVT assumes a known average and an observable instantaneous rate. Information scent was studied in web navigation, where the cost of a wrong click is small. Patches in a game are designed, not found.
- **Relevance.** Core for legibility; confidence medium-high.
- **Surprise.** Yes (moderate).

## 23. Alarm management and queueing

- **Definition.** The process-industry discipline of designing, rationalising and monitoring plant alarms so operators are not overwhelmed (ISA-18.2, EEMUA 191), together with queueing theory, which relates delay to load and variability.
- **Why it matters here.** Offers, prompts and live events are alarms and the player is the operator. The alarm literature formalised what fails: floods and standing, stale or chattering alarms. Common figures from guidance and vendor material are a steady-state target of about one alarm per ten minutes per operator, a flood defined as ten or more alarms in ten minutes, an alarm priority split near 80/15/5, and a target of under 1 % of time in flood. [sec; mostly vendor and consultancy pages, not the standards] Each alarm should be relevant, unique, timely, prioritised, understandable, diagnostic, advisory and focused [mem]. Queueing adds the quantitative part: Kingman's approximation makes mean wait scale with ρ/(1−ρ) times a variability factor, so delay grows without bound as utilisation approaches one, and variable arrival or service times make it worse. [sec] The engine should treat the player's attention as a server with utilisation to keep well below one.
- **Key sources.**
  - ISA/ANSI (2016). *ISA-18.2: Management of Alarm Systems for the Process Industries.*
  - EEMUA (2013). *Publication 191: Alarm Systems: A Guide to Design, Management and Procurement*, 3rd ed.
  - Kingman, J. F. C. (1961). "The single server queue in heavy traffic." *Proceedings of the Cambridge Philosophical Society* 57(4): 902–904.
  - Little, J. D. C. (1961). "A proof for the queuing formula L = λW." *Operations Research* 9(3): 383–387.
  - Bransby, M. L. and Jenkinson, J. (1998). *The Management of Alarm Systems.* UK HSE Contract Research Report 166/1998 [mem].
- **Instance.** An example in Kingman-formula write-ups: utilisation rising from 0.83 to 0.95 nearly quadruples the wait. [sec]
- **Principles.**
  1. *Offer budget.* Cap new near-ring offers per ten minutes and track "flood" intervals as a metric. Test: players' overload reports against rate; find the knee.
  2. *Rationalise at authoring.* Every offer states why it is relevant, what the player can do, and its priority, or it is not shown. Test: engagement of offers passing and failing the checklist.
  3. *Utilisation ceiling.* Estimate attention utilisation ρ (arrival rate × mean engagement time) and keep it well below one, and cut variance by breaking long content into steady-length beats. Test: backlog of open, unattended threads against ρ.
- **Failure modes.** Operators monitor a plant on duty; players seek novelty, and a game that matched one alarm per ten minutes would feel empty. The numbers do not transfer, only the structure. Players balk and renege, so the queue is not FIFO. Kingman assumes a stationary single server.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes (moderate).

## 24. Control theory and cybernetics

- **Definition.** The theory of regulating a system by feedback: stability, delay, saturation, and what a regulator must know about the system it regulates.
- **Why it matters here.** The pacing logic is a feedback controller whose plant is a person. A director that adjusts pacing from measured intensity already exists in games (Booth's AI Director for Left 4 Dead [sec]), so the value here is in what that experience does not mention. (a) *Delay*: the player's response to an offer arrives minutes later, and a controller with loop delay oscillates unless its gain is lowered. (b) *Hysteresis and deadband*: without them the controller flips between "needs excitement" and "needs rest". (c) *Integral windup*: while actuation is saturated (the player is in a safe zone and nothing can spawn), a controller that keeps accumulating error will overshoot badly when released; the standard remedies are back-calculation and conditional integration. [sec] (d) *Good regulator*: Conant and Ashby showed that a maximally successful and simple regulator must be isomorphic to the system it regulates, which is a statement that the engine needs a player model. [sec] (e) *Goodhart/Campbell*: a measure used as a target stops measuring what it did. These are the failure modes the pacing logic will meet.
- **Key sources.**
  - Åström, K. J. and Murray, R. M. (2008). *Feedback Systems: An Introduction for Scientists and Engineers.* Princeton University Press.
  - Ashby, W. R. (1956). *An Introduction to Cybernetics.* Chapman and Hall (requisite variety).
  - Conant, R. C. and Ashby, W. R. (1970). "Every good regulator of a system must be a model of that system." *International Journal of Systems Science* 1(2): 89–97 (DOI 10.1080/00207727008920220).
  - Campbell, D. T. (1979). "Assessing the impact of planned social change." *Evaluation and Program Planning* 2(1): 67–90 [mem]; Strathern, M. (1997). "'Improving ratings': audit in the British university system." *European Review* 5(3): 305–321 [mem].
  - Booth, M. (2009). "The AI Systems of Left 4 Dead." Valve, AIIDE keynote (https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf).
- **Instance.** A PID controller driving a saturated actuator winds up and overshoots; MathWorks documents back-calculation and conditional integration as the fixes. [sec]
- **Principles.**
  1. *Delay-aware gain.* The pacing correction rate is limited by the response delay. Test: simulate with a synthetic player; the oscillation of beat intensity falls as gain is reduced to the stable range.
  2. *Anti-windup.* Cap accumulated "owed" content and clamp it while no valid delivery exists. Test: no content dump after a long safe period.
  3. *Do not regulate to a proxy.* Regulate on several experience estimates, reviewed against ratings. Test: divergence between the proxy and the ratings over time; Goodhart predicts it widens.
- **Failure modes.** The plant is non-stationary, partly adversarial (players learn to game a director) and unobservable. The setpoint is aesthetic, not physical. A too-responsive controller reads as manipulation, which conflicts with "the player is never controlled."
- **Relevance.** Supporting; confidence medium-high.
- **Surprise.** No (a pacing director is known in games); windup and delay are the underused parts.

## 25. Signalling theory

- **Definition.** The theory of when signals can be trusted: signals are reliable when they are costly to fake in a way that depends on the quality signalled (Zahavi's handicap principle; Spence's job-market signalling).
- **Why it matters here.** "True to the setting" and "legible": a dystopian city is saturated with signals of status and affiliation (gang colours, cyberware, brands, scars, speech codes), and the player learns to read them. Gambetta's *Codes of the Underworld* analyses how criminals, who cannot freely advertise or rely on institutions, use costly signals such as tattoos and scars as credentials. [sec] Bliege Bird and Smith (2005) apply the theory to human social domains. [sec] Consequence for the engine: signal reliability is a shared resource. If cheap signals (a jacket) are unreliable too often, reading signals becomes worthless and the world is illegible; if signals are never false, deception content (an undercover cop, a forged credential) has no force. Track a per-signal honesty rate and treat deception content as spending from it.
- **Key sources.**
  - Zahavi, A. (1975). "Mate selection: a selection for a handicap." *Journal of Theoretical Biology* 53(1): 205–214.
  - Grafen, A. (1990). "Biological signals as handicaps." *Journal of Theoretical Biology* 144(4): 517–546.
  - Spence, M. (1973). "Job market signaling." *Quarterly Journal of Economics* 87(3): 355–374.
  - Gambetta, D. (2009). *Codes of the Underworld: How Criminals Communicate.* Princeton University Press (https://press.princeton.edu/books/paperback/9780691152479/codes-of-the-underworld).
  - Bliege Bird, R. and Smith, E. A. (2005). "Signaling theory, strategic interaction, and symbolic capital." *Current Anthropology* 46(2): 221–248.
  - Veblen, T. (1899). *The Theory of the Leisure Class.*
- **Instance.** Gambetta reads a criminal's tattoos and scars as lines on a résumé. [sec]
- **Principles.**
  1. *Cost–reliability link.* NPC signals that are costlier to produce are more often honest, and sampled NPCs show a positive correlation. Test: sample NPCs, compute honesty rate by signal cost, and measure whether players infer correctly more often.
  2. *Budgeted deception.* Per-signal honesty rates are tracked; deception beats are throttled when a rate falls below a floor. Test: players' accuracy in reading signals over a session against the deception rate.
  3. *Costly signals mark serious roles.* The more consequential an NPC's role, the more costly their identifying signals, so threat is inferable. Test: players' threat estimates from signals against the NPC's actual role.
- **Failure modes.** Biological signals reach equilibrium over generations; NPC signals are assigned by the generator, and the "cost" is real only if the sim implements costs (money, risk, time). Cronk's commentary argues that not all honest signals are costly and not all costs guarantee honesty. [sec] Players may not read signals at all without UI support.
- **Relevance.** Supporting; confidence medium.
- **Surprise.** Yes.

---

## Fields tried and rejected

- **Typography and layout** (Bringhurst, Müller-Brockmann): hierarchy by contrast reduces to "not everything can be loud", already covered by pacing and alarm management. Knuth–Plass optimal line-breaking is a good global-optimisation idea, but it needs the whole paragraph in advance and the player's future is not known; at best it becomes generic rolling-horizon planning.
- **Comedy writing** (callbacks, rule of three): the mechanism is the expectation mechanism in entry 6 and ordinary set-up and pay-off; improv's "accept the offer" is well mined in the drama-manager literature already.
- **Poetry and rhyme schemes**: metrical substitution is expectation again; only the Oulipo combinatorics survived (entry 18).
- **Pace layers / shearing layers** (Duffy, Brand, Holling's panarchy): sound, but it restates that slow layers constrain fast ones, which a multi-scale story hierarchy already is; I found no testable principle beyond "keep layers decoupled enough to slip".
- **Perfumery and wine** (top, heart and base notes): decay at different rates, a metaphor for the above with no test.
- **Thermodynamics and entropy**: "story entropy" is a loose metaphor; the useful Shannon-information content is already in the surprise entries.
- **Chaos and dynamical systems**: sensitivity to initial conditions is true and unhelpful, since designers want robustness, and the control entry covers the usable part.
- **Game theory and mechanism design**: the closest to games, not distant, and the engine's offers are not a strategic game against a player who is never coerced.
- **Immunology** (self and non-self, tolerance): a pleasant metaphor for the world rejecting out-of-place content, equivalent to a filter.
- **Air traffic control** (sector handoffs): exactly-one-owner-at-handoff is sound distributed-systems practice, but it is engineering, not story.
- **Hospital triage**: reduces to a precision and recall trade-off with asymmetric costs, covered by entry 12, principle 3.
- **Museum exhibition design** ("museum fatigue", visitor flow): restates habituation (entry 11) and level-design commonplaces.
- **Archaeology and site-formation processes**: useful for generating plausible layered history in worldbuilding, little for staging stories.
- **Traffic engineering and pedestrian dynamics**: serves the crowd sim, not story; phantom jams at high density are covered by entries 9 and 23.
- **Actuarial and insurance risk pooling**: nothing beyond heavy-tailed event sizes (entry 10).
- **Sports scheduling** (traveling tournament problem): real combinatorics, but our scheduling is online with an uncontrolled player; only leverage survived (entry 16).
- **Incident Command System** (scalable modular command, span of control about five): a tidy scaling of structure from small to large incidents, but it duplicates the pattern hierarchy (entry 3) and the span-of-control number rests on weak evidence.
- **Evolutionary biology as a selection engine**: evolving content against engagement invites Goodhart (entry 24), and the distinct pieces, exaptation (Gould and Vrba 1982 [mem]) as reuse of existing world features and drift scaling with population size, are a restatement of reuse and a part of entry 2.
- **The Barnum or Forer effect** (people accept generic statements as personal): real, and it would make relevance cheap, but exploiting it makes relevance fake, which is the opposite of "caused"; keep it as a risk, not a technique.
