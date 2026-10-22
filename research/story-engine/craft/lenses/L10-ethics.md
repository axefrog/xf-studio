# Lens L10: ethics, representation and harm

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise. Its patent remarks are out of scope: the Story Engine does no patent searches for its own ideas ([D-20](../../decisions.md)).

**Method note.** Run on 22 October 2026 by one independent lens, working only from the web (no repository access, no other lens outputs, no subagents). I ran roughly 75 web searches and about 30 page fetches across these areas: techno-orientalism and cyberpunk criticism; Cyberpunk 2077's reception (gangs, trans representation, disability, epilepsy warnings, ratings, fan-content rules, the Keanu Reeves "joytoy" mod, the AI-voiced Polish dub); representation studies in games; procedural character and name generation; tabletop safety tools; trigger-warning research; romance and intimacy design; child-safety cases (AI Dungeon, Bethesda's children); generative-text safety; dark patterns and AI directors; player-modelling ethics; privacy law and inference; research ethics; content moderation; ratings; performer rights and voice cloning; copyright for generated output; patents on game AI; and accessibility. Convention: a claim marked **[sec]** rests only on a search-result summary that I did not open at source; unmarked factual claims come from a page, abstract or table of contents I fetched and read. Several primary sources could not be read (Wired, Nexus Mods' news pages, the full text of the Nemesis patent's claims, CDPR's REDmod licence), and I say where that limits a point. Everything is paraphrased; legal items are orientation, not legal advice. I also flag where a claim is my own inference rather than a source's.

**Index** (R = relevance, S = would a quest designer be unlikely to look here)

| # | Field | R | S |
|---|---|---|---|
| 1 | Techno-orientalism and cyberpunk-genre critique | Core | Yes |
| 2 | Representation studies and audits in games | Core | No |
| 3 | Demographic data, name generation and generator bias | Core | Yes |
| 4 | Disability representation and crip theory in cyberpunk | Supporting | Yes |
| 5 | Sensitivity reading and cultural consultation | Supporting | No |
| 6 | Ethical game design (Sicart, Zagal) | Core | No |
| 7 | Media-effects research on violent games | Supporting | No |
| 8 | Tabletop safety tools | Core | Yes |
| 9 | Content-notice research and design | Supporting | Yes |
| 10 | Consent and intimacy design in sexual and romantic content | Core | No |
| 11 | Child-safety hard constraints | Core | No |
| 12 | Generative-text safety engineering | Core if LLM text is used | No |
| 13 | Responsible-design process (value sensitive design, internal audit) | Supporting | Yes |
| 14 | Dark patterns and engagement-driven direction | Core | Yes |
| 15 | Wellbeing and autonomy science, safer-play tooling | Supporting | Yes |
| 16 | Ethics of player modelling and affective computing | Core | Yes |
| 17 | Privacy law and inference rights | Supporting | Yes |
| 18 | Research ethics for games user research and telemetry | Supporting | Yes |
| 19 | User-generated-content governance and trust and safety | Core | Yes |
| 20 | Ratings and classification | Supporting | No |
| 21 | Publisher fan-content and licence rules | Core | No |
| 22 | Performer and likeness rights | Core | Yes |
| 23 | Copyright and IP in generated text and packs | Supporting | No |
| 24 | Patents on game-AI techniques | Core constraint | Yes |
| 25 | Accessibility of generated content | Supporting | No |

---

## 1. Techno-orientalism and cyberpunk-genre critique

**Definition.** Scholarship on how Western speculative fiction imagines Asia and Asians as hyper-technological, inhuman or threatening; the term is credited to Morley and Robins (1995), and Nakamura's "cybertypes" extend the idea to online and cyberpunk imagery.

**Why it matters here.** A city simulation populated with megacorporations, gangs and fixers will reach for the genre's default palette: the Japanese megacorp, the yakuza-coded gang, the mystic hacker, neon kanji as a signifier of menace. Procedural generation reproduces that palette at volume and strips out whatever irony the original author intended. Concretely, the risk sits in faction templates, naming pools and aesthetic tags, and in which cultures get assigned which roles when the generator fills a district.

**Key sources.**
- David Morley and Kevin Robins, "Techno-Orientalism: Japan Panic" (1995), credited as the origin of the term; the book attribution (*Spaces of Identity*, Routledge) is from memory, the essay title and date are from reviews **[sec]**.
- David S. Roh, Betsy Huang and Greta A. Niu (eds.), *Techno-Orientalism: Imagining Asia in Speculative Fiction, History, and Media* (Rutgers University Press, 2015); reviewers give the working definition as imagining Asia in hypo- or hypertechnological terms **[sec]**.
- Lisa Nakamura, *Cybertypes: Race, Ethnicity, and Identity on the Internet* (Routledge, 2002); covers cyberpunk fiction and argues the net is not race-neutral **[sec]**.
- Chengkai Xu et al., "Tradition, Desire, Techno-Orientalism and Popularity: Oriental Elements in the 21st-century Cyberpunk Video Games", IHSI 2023 (content analysis of six games including Cyberpunk 2077) **[sec]**.
- Popular critique: Unseen Japan, "How Cyberpunk 2077 Resurrects the 1980s' 'Japan Panic'" (https://unseen-japan.com/?p=27799) **[sec]**.

**Instance.** Xu et al. conclude that oriental elements in these games reinforce techno-orientalist stereotypes to a degree, but are mostly decontextualised and used to set art style **[sec]**. Critics read Arasaka and the Tyger Claws through the 1980s "Japan panic" **[sec]**. Note that a University of Washington undergraduate essay applying the concept to 2077 exists but is student work.

**Principles.**
1. *Role independence from culture tags.* No generator rule may map a culture or ethnicity tag to a role class such as villain, enforcer, expendable or exotic-tech. Test: over a large sample of generated scenes, role distribution conditional on culture tag stays within a declared tolerance of the marginal distribution, unless an authored pack declares otherwise.
2. *Aesthetic assets are not menace signifiers.* Culture-coded set dressing (a ramen stall, a shrine) carries function tags, never danger or threat tags. Test: vocabulary lint finds no menace descriptors on culture-coded asset tags.
3. *Antagonist plurality.* Top-tier corporate and criminal antagonists come from several origins. Test: the ranking of antagonist power across generated factions is not dominated by one culture over repeated world seeds.

**Failure modes.** Over-correction yields a city with no cultural texture, which is its own erasure; the genre's debt to Japanese media and the setting's 1980s anxieties are real and part of what players enjoy. The scholarship concerns mostly US perceptions of East Asia and does not tell you what to do with, say, Latin American or Caribbean coding. Creators from affected communities disagree about specific cases (see field 2).

**Relevance.** Core. Confidence high that the setting is the canonical case; medium on how directly scholarship converts into enforceable rules.

**Surprise.** Yes: quest designers read lore and fiction, rarely Asian American studies.

---

## 2. Representation studies and audits in games

**Definition.** Empirical content analysis and qualitative audience research on who appears in games and how, plus social-psychology instruments for measuring stereotype content.

**Why it matters here.** "Names and demographics drawn from data" produces distributions, and the distribution of who is a gang member, a victim, a love interest or comic relief is a measurable property of the generator. It can be audited like a census. The research also warns that headcounts are not the whole story: players relate to characters through identification, not abstract diversity.

**Key sources.**
- Dmitri Williams, Nicole Martins, Mia Consalvo and James Ivory, "The virtual census: representations of gender, race and age in video games", *New Media & Society* 11(5), 2009, 815-834; sales-weighted sample of 150 games from 2005-06, found systematic over-representation of white male characters and under-representation of Hispanics, Native Americans, children and the elderly **[sec]**. A 2020 follow-up on 2017 UK bestsellers found small gains **[sec]**.
- Adrienne Shaw, *Gaming at the Edge: Sexuality and Gender at the Margins of Gamer Culture* (University of Minnesota Press; catalogues disagree on 2014 vs 2015), on identification versus representation **[sec]**.
- Kishonna L. Gray, *Intersectional Tech: Black Users in Digital Gaming* (LSU Press, 2020) **[sec]**.
- Susan T. Fiske, Amy J. C. Cuddy, Peter Glick and Jun Xu, "A model of (often mixed) stereotype content", *Journal of Personality and Social Psychology* 82(6), 2002, 878-902: stereotypes organise on warmth and competence, with status predicting competence **[sec]**; usable as an audit instrument.

**Instance.** Cyberpunk 2077's reception is a case series. The E3 2019 "Mix It Up" poster was criticised as fetishising trans bodies; the artist said it was meant to read as jarring corporate exploitation (PC Gamer headline read; details **[sec]**). The character creator decoupled genitals from gender but tied voice to a binary choice, which trans players criticised **[sec]**. TIME's reviewer Patrick Austin, who is Haitian-American, read the Voodoo Boys as one of several gangs divided along stereotypical racial lines and questioned placing the only Black gang in the poorest district. Mike Pondsmith defended the Voodoo Boys as a deliberate correction of the 2020 tabletop version, whose members were white appropriators, and told critics they were not entitled to judge his creation **[sec]**.

**Principles.**
1. *Population audit in the build.* The generator publishes its demographic priors, and a build step compares generated populations against them. Test: failing the comparison blocks release.
2. *Role-balance test.* For each demographic tag, the shares of generated antagonists, victims, sexualised roles and comic-relief roles stay within tolerance of the tag's population share, unless a pack declares otherwise.
3. *Warmth-competence audit.* Sample generated character descriptions, rate them (human or classifier) on warmth and competence by tag including class, disability and addiction status; no group is uniformly cold-and-incompetent. This is the "contempt quadrant" check and is the one most likely to catch class stereotyping in a cyberpunk underclass.

**Failure modes.** Matching real-world census shares yields implausible or tokenistic casts, and Night City is fictional with its own demography. Counts measure presence, not dignity: a perfectly balanced gang roster can still be written as caricature. Shaw's work warns that representation matters differently to different players, so no single audit settles it.

**Relevance.** Core; high confidence.

**Surprise.** No. Designers know representation matters; the measurement tradition and the warmth-competence instrument are the less familiar part.

---

## 3. Demographic data, name generation and generator bias

**Definition.** The practice of building NPC populations from datasets (names, ethnicity, gender, occupation, income) without baking in stereotype, and of documenting the data and the feedback loops a simulation creates.

**Why it matters here.** Correlation between name, ethnicity, occupation and gang membership is the channel by which stereotype enters a generated population. A second channel is the simulation itself: if gang membership or violence is seeded by neighbourhood demographics, and the simulation then spawns more violence where it already is, it reproduces the feedback loop documented in predictive policing.

**Key sources.**
- Ian Horswill, "Controllable, Demographically-Guided Character Generation using Stochastic Logic Programming", EXAG-INT 2025 (with AIIDE 2025), CEUR-WS vol. 4090: generates names, ethnicity and gender for a present-day San Francisco RPG using US census data; notes that violating expectations can be jarring or offensive **[sec]** (the PDF would not extract for me).
- Tommy Thompson, "How Watch Dogs: Legion's 'Play as Anyone' Simulation Works", *Game Developer*, 9 December 2020 (read): citizens get tags and a background "Census" system fills in plausible detail; occupation-to-income links are tendencies, not rules; the team's design test is that 100 generated lawyers should each read as lawyers yet differ. The article does not describe name or ethnicity handling or safeguards.
- Maan Qraitem, Kate Saenko and Bryan A. Plummer, "PersonaWeaver", arXiv 2609.26629, Sept-Oct 2026 (read abstract): LLM-generated characters are behaviourally homogeneous and overwhelmingly agree with positive moral norms.
- Timnit Gebru et al., "Datasheets for Datasets", *Communications of the ACM* 64(12), 2021 **[sec]**.
- Kristian Lum and William Isaac, "To predict and serve?", *Significance*, 2016: a predictive-policing model trained on arrest data concentrates patrols in the same places regardless of estimated underlying drug use **[sec]**.
- Patrick McKenzie, "Falsehoods Programmers Believe About Names" (2010), a catalogue of broken name assumptions **[sec]**.

**Instance.** Watch Dogs: Legion's Census and the "100 lawyers" test (read).

**Principles.**
1. *Independence by construction.* Names, appearance and culture tags are sampled independently of role and behaviour traits (occupation, criminality, violence propensity); roles come from simulation state (resources, grievances, beliefs). Test: estimated mutual information between culture tag and role is near zero over a large sample, excluding declared exceptions.
2. *Every dataset has a datasheet.* Origin, date, coverage, known skews and licence for every name pool and demographic table, with the build failing if one is missing.
3. *Feedback-loop test.* Run the simulation for many city-years from varied seeds; violence incidence per district must not rise with the district's demographic share beyond what declared economic variables explain.

**Failure modes.** Census names cluster by ethnicity, so strict independence can make unnatural combinations; Horswill's point is that expectations matter. Independence also erases real structural inequality, which cyberpunk's own critique is about (class, race and gang membership do correlate in many real cities). The honest fix is to make any correlation an authored, visible parameter (a city-history document), not an accident of the data. Fully hand-authored name lists are bland and labour-intensive.

**Relevance.** Core; high confidence.

**Surprise.** Yes for the documentation and feedback-loop literature; designers know name generators exist.

---

## 4. Disability representation and crip theory in cyberpunk

**Definition.** Disability-studies readings of prosthetic and cyborg fiction (Kafer), critiquing cure narratives and the equation of augmented bodies with loss of humanity.

**Why it matters here.** Cyberpunk makes the augmented body a moral stake. Generated NPCs with cyberware or prosthetics can be coded as villains or objects of pity, and cyberpsychosis, a violent breakdown attributed to augmentation, is a ready-made template for "mental illness as monster". The last point is my inference from the setting, not a finding in a source.

**Key sources.**
- Alison Kafer, *Feminist, Queer, Crip* (Indiana University Press, 2013), including its cyborg-theory thread and its critique of "no future" framings of disability **[sec]**.
- The Mary Sue, "Disabled Representation in Video Games and the Cyberpunk 2077 Problem": a disabled writer objected to pre-release framing of augmentation as losing connection to the body, noting that prosthetics are for many people a route to everyday function **[sec]**.
- AbleGamers' Accessible Player Experiences patterns (see field 25) for the player side.

**Instance.** The Mary Sue objection to the game director's pre-release framing **[sec]**.

**Principles.**
1. *Augmentation is independent of antagonism.* Probability of a generated NPC being an antagonist does not depend on cyberware level. Test: generated casts compared across cyberware strata.
2. *No mental-illness trigger for violence.* Violence templates draw motives from social variables (debt, grudge, ideology, coercion); none has a mental-illness precondition unless a pack authors it. Test: template lint.
3. *Disabled NPCs have their own goals and jobs.* Offer templates do not cast disabled or augmented NPCs only as rescuees or beneficiaries of a cure. Test: role census as in field 2.

**Failure modes.** Cyberpsychosis is canon in the setting and a pillar of the base game; removing it removes genre content. It can be handled well when blame sits with systems (exploitation, unaffordable maintenance, corporate cover-ups) rather than with the afflicted person. Disability and augmentation are not the same thing. Scholarship on games specifically is thin, and I found only commentary, not studies.

**Relevance.** Supporting; medium confidence.

**Surprise.** Yes.

---

## 5. Sensitivity reading and cultural consultation

**Definition.** The professional practice of commissioning readers or consultants from the communities depicted to flag harmful or inaccurate portrayals.

**Why it matters here.** Both the generator's vocabulary and human-authored community packs need some review step. But CDPR's experience shows consultation is not a guarantee, and publishing's experience shows silent over-editing triggers a different backlash.

**Key sources.**
- Mateusz Tomaszkiewicz, CDPR quest director, interviewed by TheGamer, reported 18 September 2020 (read): outside consultants for some gangs, internal discussion for others, and a localisation partner in Japan advising on culture.
- Patrick Austin, TIME's review of Cyberpunk 2077 (read): despite that work, he found tried stereotypes of people of colour.
- Coverage of the 2023 Roald Dahl edits (CBC, Vice and others): Puffin's sensitivity readers flagged content it judged offensive; critics including Salman Rushdie called it absurd censorship **[sec]**.
- Pondsmith's replies on the Voodoo Boys and the Animals (Video Games Chronicle, PC Gamer) **[sec]**.

**Instance.** The Dahl edits are the cautionary tale; CDPR's consultants plus the TIME critique are the in-genre case.

**Principles.**
1. *Review the vocabulary, not only the output.* Every culture-coded generator vocabulary file (name pools, faction templates, dialect markers) carries a reviewer, a review date and a scope note. Test: the build refuses files without that header.
2. *Credit and, where possible, pay reviewers;* record disagreements rather than hiding them.
3. *No silent rewriting.* Changes to shipped vocabulary go in a public changelog with reasons. This is the Dahl lesson.

**Failure modes.** A consultant is one voice, not a community consensus. A free mod has no budget, so reviewers are volunteers, which burdens the same marginalised people the review is meant to protect. Review can bland content down to what no reader could object to.

**Relevance.** Supporting; medium confidence.

**Surprise.** No.

---

## 6. Ethical game design (Sicart, Zagal)

**Definition.** Philosophy and design theory treating players as moral agents and games as designed ethical objects; "ethically notable" games create reflection rather than just moral choice points.

**Why it matters here.** The system generates violence and betrayal and the player is offered it. The ethical question is not violence versus none but whether the player holds a meaningful moral position, whether consequences carry weight, and whether the offer structure leaves the player free. "The generator did it" is not an answer to that question; a design that makes harm weightless is a design choice.

**Key sources.**
- Miguel Sicart, *Beyond Choices: The Design of Ethical Gameplay* (MIT Press, 2013); case studies include Spec Ops: The Line and Fallout: New Vegas **[sec]**.
- Miguel Sicart, *The Ethics of Computer Games* (MIT Press, 2009); my searches did not retrieve it, cited from memory.
- José P. Zagal, "Ethically Notable Videogames: Moral Dilemmas and Gameplay", DiGRA 2009: games that challenge the player's grasp of an ethical system or set the narrative against gameplay goals **[sec]**.
- José P. Zagal (ed.), *The Videogame Ethics Reader* (Cognella, 2012) **[sec]**.

**Instance.** Spec Ops: The Line as a deliberately complicity-focused design (Sicart case study) **[sec]**.

**Principles.**
1. *Declining is never worse than ignoring.* Refusing a generated offer carries no mechanical penalty and no hidden punishment beyond what the fiction's own characters decide. Test: for each offer template, a decline path exists and its world-state effect is neutral.
2. *Weight rule.* A lethal generated outcome attributable to the player surfaces in-world within a bounded time (a mourned name, a reprisal, a news item). Test: event log shows an echo for every attributed death.
3. *Victims have faces.* Violent events involving non-combatants draw victims from entities with names and at least a minimum number of relationship links. Test: victim entities in generated atrocity events meet the threshold, so cruelty is never anonymous shock.

**Failure modes.** Ethical design shades into moralising; a game that lectures is bland in a different way. Sicart's work is descriptive, not a rule set. The weight rule can become punitive scolding if the echoes are heavy-handed.

**Relevance.** Core; medium-high confidence.

**Surprise.** No: designers know Spec Ops; fewer read the philosophy.

---

## 7. Media-effects research on violent games

**Definition.** Psychology and communication research on whether violent games cause aggression or violence, and the professional bodies' positions.

**Why it matters here.** For proportion. This is a dark adult game; if the evidence for violence-as-such causing violence is weak, effort belongs elsewhere: sexual violence, hate, degradation, minors, manipulation and privacy.

**Key sources.**
- American Psychological Association, resolution update on violent video games, March 2020: insufficient evidence of a causal link to violent behaviour, with a small reliable association to milder aggressive outcomes **[sec]**.
- Christopher Ferguson and colleagues' critique and 2020 meta-analysis, which argues violent games are not linked to aggression **[sec]**.

**Instance.** The APA statement and the contested reaction **[sec]**.

**Principles.**
1. *Violence is a player-set intensity dial, not a ban.* Violence templates carry intensity levels and the director honours the setting. Test: toggling the dial changes emitted events as specified.
2. *Scope the harm policy explicitly.* The policy document lists in-scope harms (sexual violence, hate, minors, degradation, manipulation, privacy) and states that violence-as-such is handled by the intensity dial and the base game's descriptors.

**Failure modes.** "No strong causal evidence" must not become "no harm": the research is mostly short-term and says little about minors, content that dehumanises specific groups, or individual vulnerability.

**Relevance.** Supporting; medium confidence.

**Surprise.** No.

---

## 8. Tabletop safety tools

**Definition.** Lightweight consent and boundary protocols from tabletop role-playing: the X-Card (John Stavropoulos, 2013), lines and veils (credited in community sources to Ron Edwards), Script Change (Beau Jágr Sheldon), *Consent in Gaming* (Monte Cook Games, 2019), and session zero.

**Why it matters here.** The system is a game master for a single player. The tabletop tools were designed to make dark play possible with less risk, which is exactly "judgement and player control, not blandness". They translate directly: lines and veils become a pre-session boundary input to the director; an X-Card becomes an instant, no-questions retract of the current offer.

**Key sources.**
- X-Card (Wikipedia entry with citations, read): created 2013 for convention play with strangers, CC BY-SA 3.0; any player can pause and remove content without explanation; criticised as reactive (James D'Amato) and as curtailing play, with Vincent Baker first calling it harmful and later reversing.
- *Consent in Gaming*, Sean K. Reynolds and Shanna Germain, Monte Cook Games, 2019, free; includes a lines and veils worksheet **[sec]**.
- Script Change, Beau Jágr Sheldon: pause, rewind and fast-forward cards, CC BY 4.0, usable for some video games **[sec]**.
- TTRPG Safety Toolkit, Kienna Shaw and Lauren Bryant-Monk, an online collection **[sec]**.

**Instance.** The 2024 D&D Dungeon Master's Guide added an expectations sheet and an X-style gesture, and was criticised for not crediting the originators **[sec]**.

**Principles.**
1. *Lines are hard exclusions, veils are off-screen.* Content tagged with a line is never selected; veil content renders only as summary or fade. Test: with a given line set, no director run over a large number of steps emits a tagged event.
2. *One-input retract.* One input removes the current offer or scene, records the tag as soft-excluded, and asks no questions. Test: no confirmation dialog; effect immediate.
3. *Visible, editable boundaries.* The player can see and change what the system has recorded as excluded at any time.

**Failure modes.** X-Cards are reactive; the harm has already landed. Tools cannot replace good defaults and are only as good as the content tagging behind them. Long checklists can push players to opt out of anything interesting.

**Relevance.** Core; high confidence.

**Surprise.** Yes: CRPG designers rarely look at tabletop safety culture.

---

## 9. Content-notice research and design

**Definition.** Empirical research on whether content or trigger warnings reduce distress, plus advocacy guidance on photosensitivity warnings.

**Why it matters here.** Many designers assume warnings protect players. The evidence says they largely do not reduce distress and can raise anticipatory anxiety, so protection should come from controls and defaults, with notices serving informed choice.

**Key sources.**
- Bridgland, Jones and Bellet, "A meta-analysis of the efficacy of trigger warnings, content warnings, and content notes", *Clinical Psychological Science*, 2023 (DOI 10.1177/21677026231186625); APS summary (read): twelve studies; warnings raised anticipatory anxiety, did not reduce distress after viewing, and did not change avoidance.
- Video Games Chronicle, 10 December 2020 (read), on Cyberpunk 2077's seizure reports and Epilepsy Action's reaction.

**Instance.** Game Informer's Liana Ruppert reported a seizure while playing; CDPR added an in-game epilepsy warning on PC and promised a more permanent fix; Epilepsy Action said a start-of-game warning alone was not enough (read).

**Principles.**
1. *Descriptors and controls travel together.* Every offer exposes machine-readable content descriptors before acceptance, and each descriptor maps to a toggle. Test: no descriptor without a control.
2. *Warn sparingly.* Show notices only for content above the player's declared comfort or beyond the default intensity, to avoid the anticipatory-anxiety cost.
3. *Photosensitivity is fixed in the effect, not the label.* Generated screen effects pass an automated flash check, as the three-flashes rule requires, or are disabled by default. Test: automated flash analysis in the build.

**Failure modes.** The meta-analysis is mostly lab work with non-clinical samples, and the authors call for more research. "Warnings don't reduce distress" must not be turned into "no labels": informed choice is a separate function. Over-warning is another route to blandness.

**Relevance.** Supporting; high confidence on the evidence, medium on design translation.

**Surprise.** Yes.

---

## 10. Consent and intimacy design in sexual and romantic content

**Definition.** Practices ensuring sexual and romantic content is consensual in the fiction, between adults, and made with performer consent: intimacy direction for performance capture, NPC agency in romance systems, and research on romance design.

**Why it matters here.** "Consent in generated romance" has three exposure points. Generated romances where an NPC's acceptance is a function of player stats become vending-machine romance. Generated scenes could depict non-consent without authorial framing. And the performers whose voices and bodies are reused have their own consent.

**Key sources.**
- C. Tomlinson, "Designing Romance and the 'Playersexuality' Debate", *International Journal of Games and Social Impact* 2(2), 2024, 8-27 (record confirmed): content analysis of Baldur's Gate 3 and Dragon Age and player discussions; romance reduced to an on-demand system is a recurring concern **[sec]**.
- Coverage of Larian's use of intimacy coordinators on Baldur's Gate 3 (Den of Geek, BBC reporting via Yahoo): the claim that it was one of the first games to do so is Larian's own **[sec]**.
- The GGRecon report on voice actors objecting to AI-cloned voices in explicit Skyrim mods, 7 July 2023 (read).
- Australia's R18+ classification of Cyberpunk 2077, citing sex, violence and references to sexual violence **[sec]**.
- Valve's January 2024 rule that Adult Only sexual content created by live-generated AI will not be approved **[sec]**.

**Instance.** The Skyrim explicit voice-clone mods (read); Baldur's Gate 3's coordinators **[sec]**.

**Principles.**
1. *Explicit content is authored, not generated.* Procedural templates may offer an intimacy slot, but explicit scenes come only from human-authored pack scenes with a consent trail. Test: no procedural template emits explicit-tagged assets.
2. *NPC agency.* An NPC's acceptance or refusal derives from the NPC's own state, and repeated asking never flips a refusal. Test: no code path where repetition changes the outcome.
3. *Sexual violence is a default line.* It is excluded unless a pack and the player both opt in. Test: default boundary set contains it.

**Failure modes.** Sex work and sexuality are part of the base game's content; stripping them over-sanitises. "Refusals are final" frustrates players who want a particular romance; the answer is authored arcs, not unlock grinding. Intimacy coordination protects performers, and a free mod has none.

**Relevance.** Core; high confidence.

**Surprise.** No.

---

## 11. Child-safety hard constraints

**Definition.** Legal and industry practice treating sexualised or violently targeted depictions of minors as absolute exclusions, implemented structurally rather than by output filtering.

**Why it matters here.** A generator that fills a city from data including age can create a minor-coded entity in any slot unless the schema forbids it. The AI Dungeon case shows what happens when it does not, and shows that filter-plus-human-review remedies create their own privacy backlash.

**Key sources.**
- AI Dungeon, April 2021: OpenAI flagged sexual content involving minors; Latitude deployed a filter that also blocked innocent phrases and announced human review of flagged stories; users protested. Coverage via TechSpot, Vice, Utah Business and the AI Incident Database (#402) **[sec]**; the original Wired piece (Tom Simonite, 7 May 2021) was not readable by my tools.
- Todd Howard's explanation that Fallout 3 and Skyrim children cannot be killed but react, partly for marketability, quoted in fan and press interviews **[sec]**.
- Nexus Mods, "The Law and Adult Content", July 2025: UK Online Safety Act and EU Digital Services Act duties, age verification for adult content, and automated detection for child sexual abuse material **[sec]**.

**Instance.** AI Dungeon 2021; Bethesda's "kids can't be killed but will react" **[sec]**.

**Principles.**
1. *Structural exclusion.* The entity schema gives no minor-coded entity a targetable, victim or sexual role; where children exist they are non-targetable scenery or absent. Test: schema analysis plus fuzzing finds no generated minor-coded entity with those flags.
2. *Pack scanning.* Packs are scanned for minor-coded assets combined with sexual or violent tags.
3. *No moderation by reading private play.* The design needs no step where a human reads a player's private sessions (the AI Dungeon lesson).

**Failure modes.** Invincible children are artistically awkward and the world feels less real. Text filters produce false positives (a laptop described as 8 years old was blocked). Hash-based detection is for images, not generated prose. Jurisdictions differ.

**Relevance.** Core; high confidence.

**Surprise.** No; the structural approach is the non-obvious part.

---

## 12. Generative-text safety engineering

**Definition.** The ML engineering of toxicity and harm classifiers, prompt and response guards and red-teaming, relevant if any text (flavour, dialogue, rumour) comes from a language model.

**Why it matters here.** Neural text can emit slurs or sexual content even from innocuous prompts, and heavy safety tuning yields agreeable, homogeneous characters, the opposite of what a violent, morally grey city needs. Both failure directions are live.

**Key sources.**
- Samuel Gehman et al., "RealToxicityPrompts", Findings of EMNLP 2020: toxic output from benign prompts; no controllable-generation method fully prevents it **[sec]**.
- Hakan Inan et al., "Llama Guard", 2023: a classifier for prompts and responses with an adjustable harm taxonomy **[sec]**.
- Peter Lee, Microsoft Research, on Tay (March 2016): offline within about a day; the company said it took responsibility for not anticipating the attack **[sec]**.
- Qraitem et al., "PersonaWeaver" (read): the blandness problem.
- Valve's live-generated AI rules for Steam, January 2024: developers describe guardrails against illegal content, and an in-game reporting tool is provided **[sec]**.

**Instance.** Tay (2016) and Steam's live-generation rules **[sec]**.

**Principles.**
1. *Closed-world generation where it matters.* Text about protected groups comes from reviewed slot-fill grammars or constrained decoding, not open generation. Test: slur-lexicon and classifier checks return zero hits over a large seeded sample.
2. *Layered defence with logging.* Pre-generation constraints, post-generation classification and a record of which layer acted.
3. *Diversity floor.* Measure behavioural and moral diversity of generated characters, including disagreement with the player, so safety tuning does not flatten the cast.

**Failure modes.** Classifiers over-block and are weaker on dialect and reclaimed language; slur lists misfire on innocent words; the genre invents in-world slurs for augmented people, which a naive filter handles badly (my observation). If the system uses no LLM, this field shrinks to template linting.

**Relevance.** Core if LLM text is used, otherwise supporting; medium confidence because the architecture is unknown to me.

**Surprise.** No.

---

## 13. Responsible-design process: value sensitive design and internal audit

**Definition.** Method fields for surfacing stakeholders' values early (value sensitive design) and for auditing a system before release (internal algorithmic auditing, datasheets, model cards).

**Why it matters here.** A system whose outputs the authors cannot enumerate needs a chain of answerability for "the generator did it": who decided which classes of event are possible, what was tested, who answers. It also needs stakeholders beyond players: depicted communities, performers, pack authors and moderators.

**Key sources.**
- Batya Friedman and David G. Hendry, *Value Sensitive Design: Shaping Technology with Moral Imagination* (MIT Press, 2019; Envisioning Cards 2012) **[sec]**.
- Inioluwa Deborah Raji et al., "Closing the AI Accountability Gap: Defining an End-to-End Framework for Internal Algorithmic Auditing" (SMACTR), FAT* 2020, arXiv 2001.00973 **[sec]**.
- Margaret Mitchell et al., "Model Cards for Model Reporting", FAT* 2019; Gebru et al., "Datasheets for Datasets" **[sec]**.

**Instance.** Tay and AI Dungeon as the negative cases (fields 11, 12).

**Principles.**
1. *Provenance for every offer.* Each generated offer carries a record of generator version, rules fired, seed and packs involved, so a human can answer "why did this happen". Test: every offer resolves to a trace.
2. *Versioned content envelope.* A written description of what event classes and intensities the generator can emit; release is gated on humans reading an audit sample against it.
3. *Stakeholder map per major version,* listing indirect stakeholders and what changed for them.

**Failure modes.** Process theatre: checklists that change nothing. Heavy for a free hobby release. Value elicitation does not resolve conflicts between values.

**Relevance.** Supporting; medium-high confidence.

**Surprise.** Yes.

---

## 14. Dark patterns and engagement-driven direction

**Definition.** HCI and game-design research on interface and mechanic choices that serve the operator at the player's expense, together with the AI-director tradition that shows where engagement shaping lives.

**Why it matters here.** A director that observes the player and makes offers is a retention engine by construction. The line between pacing and manipulation is thin: appointment mechanics, loss framing, social obligation, tuned scarcity. A director optimised against any proxy for return rate will find these even if nobody intends it.

**Key sources.**
- José P. Zagal, Staffan Björk and Chris Lewis, "Dark Patterns in the Design of Games", Foundations of Digital Games 2013 (abstract read): design elements whose purpose may be questionable or unethical, with guiding questions for spotting them.
- Colin M. Gray et al., "The Dark (Patterns) Side of UX Design", CHI 2018; Arunesh Mathur et al., "Dark Patterns at Scale", CSCW 2019 **[sec]**.
- Michael Booth's Left 4 Dead AI Director talk (2009): the Director paces intensity in peaks and valleys; a 2024 paper notes there is no comparative evidence on whether it improves experience **[sec]**.
- Activision's US patent 9,789,406, "System and method for driving microtransactions in multiplayer video games": matchmaking designed to prompt purchases; a patent does not show deployment **[sec]**.

**Instance.** Warner Bros. and Monolith removed Shadow of War's microtransactions in 2018 after backlash; Monolith said buying risked undermining the Nemesis System **[sec]**.

**Principles.**
1. *Objective hygiene.* The director's optimisation target never includes session length, return frequency or streaks. Test: reward-function audit lists the metrics and none is a retention proxy.
2. *No loss framing.* Offers have no deadlines unless the fiction states one, and missed offers do not change the player's standing. Test: offer templates lint for expiry and decay.
3. *Dark-pattern review gate.* Each director mechanic is reviewed against Zagal et al.'s guiding questions before release.

**Failure modes.** Directors work because they shape tension; banning "engagement" yields a flat sandbox. Pacing is not manipulation. Proving a director benign requires telemetry, which conflicts with field 17.

**Relevance.** Core; high confidence.

**Surprise.** Yes: designers know mobile dark patterns, less often apply them to director logic.

---

## 15. Wellbeing and autonomy science, safer-play tooling

**Definition.** Self-determination theory on what makes play healthy; clinical and regulatory frameworks for compulsive play; safer-play tools from gambling regulation.

**Why it matters here.** It gives positive targets and harm thresholds. The system observes the player, so it could detect a compulsion pattern, but acting on that is paternalistic and itself a form of profiling.

**Key sources.**
- Richard M. Ryan, C. Scott Rigby and Andrew Przybylski, "The motivational pull of video games: a self-determination theory approach", *Motivation and Emotion* 30(4), 2006: autonomy, competence and relatedness predict enjoyment and well-being changes **[sec]**.
- WHO ICD-11, code 6C51, gaming disorder: impaired control, priority over other activities, continuation despite harm, usually over 12 months; criticised as vague **[sec]**.
- UK Gambling Commission remote technical standards, RTS 13B: customer-set reality checks showing elapsed time, which the customer acknowledges **[sec]**.

**Instance.** The UKGC reality-check rule **[sec]**.

**Principles.**
1. *Player-set time cues.* An optional session clock and break offer, with frequency chosen by the player. Test: exists in settings and never turns on unprompted.
2. *Autonomy-supportive language.* Offer copy avoids controlling phrasing ("you must", "don't miss out"). Test: copy lint.
3. *No covert wellbeing inference.* The director never changes behaviour on an inferred compulsion signal without a visible, opt-in feature.

**Failure modes.** Break prompts annoy; SDT evidence is largely correlational and self-reported; very long play is not itself harmful.

**Relevance.** Supporting; medium confidence.

**Surprise.** Yes.

---

## 16. Ethics of player modelling and affective computing

**Definition.** The game-AI subfield on player models and the "affective loop" (elicit, sense, detect), with a growing ethics literature.

**Why it matters here.** The system builds a model of the player. Models can drift toward inferring emotion, vulnerability, tolerance for violence or sex, even sensitive traits, and adaptation can become manipulation. The stated design rule, "offers, never control", needs a model design to match.

**Key sources.**
- Georgios N. Yannakakis and Julian Togelius, *Artificial Intelligence and Games*, 2nd ed. (Springer, 2025), chapter 15 "Ethics of AI and Games" (table of contents read); Part IV covers player modelling.
- David Melhart, Julian Togelius, Benedikte Mikkelsen, Christoffer Holmgård and Georgios Yannakakis, "The Ethics of AI in Games", arXiv 2305.07392 (read abstract): ethics of eliciting emotion, the privacy versus safe-spaces trade-off in sensing, and transparency and ownership in detection.
- Jichen Zhu and Magy Seif El-Nasr, "Open Player Modeling: Empowering Players through Data Transparency", arXiv 2110.05810 (read): making player models accessible to players.
- Magy Seif El-Nasr and Erica Kleinman, "Data-Driven Game Development: Ethical Considerations", FDG 2020 (read): bias, missing data for groups, black-box opacity, missing context.
- Robin Hunicke, "The case for dynamic difficulty adjustment in games", ACE 2005 **[sec]**.

**Instance.** The open player modelling proposal as the counter-design to opaque adaptation.

**Principles.**
1. *Inspectable and editable models.* A "what the director believes about me" view with per-feature reset. Test: every model feature has a plain-language label and a reset.
2. *Purpose limitation.* The model holds only whitelisted features used for declared purposes (content preference, pacing); no inference of health, orientation or politics. Test: feature schema audit.
3. *Stated beats inferred.* A declared line, veil or intensity always overrides an inferred preference. Test: conflict-resolution unit tests.

**Failure modes.** Showing the model can break immersion or invite gaming it. The authors of the open-modelling paper note models are rarely accurate, so displaying them may mislead. Inference is also where the product's value lies, so principle 2 trades capability for trust.

**Relevance.** Core; high confidence.

**Surprise.** Yes.

---

## 17. Privacy law and inference rights

**Definition.** Data-protection law and scholarship on inferred data, including the GDPR and privacy-by-design principles.

**Why it matters here.** Even local telemetry reveals traits, and any sharing (bug reports, community learning, cloud calls) triggers duties for UK and EU players.

**Key sources.**
- Sandra Wachter and Brent Mittelstadt, "A Right to Reasonable Inferences", *Columbia Business Law Review* 2019(2), 494-620 (OII abstract read): inferences about health, politics or orientation get the weakest protection ("economy class" personal data); proposes ex-ante justification and ex-post challenge.
- Jacob Leon Kröger et al., "Surveilling the Gamers: Privacy Impacts of the Video Game Industry": gameplay data can reveal identity, age, gender, emotions, skills and personality **[sec]**.
- Attribute inference from public Dota 2 data (Conti's group) and a study finding most of 45 attributes inferable from VR motion data **[sec]**.
- Ann Cavoukian's Privacy by Design principles and GDPR Article 25 on data protection by design and default **[sec]**.

**Instance.** The VR motion study and the Dota 2 attack **[sec]**.

**Principles.**
1. *Local by default.* The player model never leaves the machine without per-upload consent. Test: network audit shows zero outbound calls in the default configuration.
2. *Nothing about the player goes to a remote model.* If a remote LLM is used, no player-model features are sent.
3. *Inferences are data.* Derived features are documented, deletable and exportable.

**Failure modes.** The law lags on inferences (Wachter's point), so compliance is a floor. Local-only forecloses community learning from telemetry. For a free mod, enforcement is mostly self-imposed.

**Relevance.** Supporting; high confidence on local-only.

**Surprise.** Yes.

---

## 18. Research ethics for games user research and telemetry

**Definition.** Human-subjects ethics (Belmont, Menlo, AoIR guidelines) applied to playtests, telemetry and A/B experiments.

**Why it matters here.** Tuning a director means testing on players. Deliberately varying what content players see in order to change their behaviour or emotion is a human-subjects experiment.

**Key sources.**
- Adam Kramer, Jamie Guillory and Jeffrey Hancock, PNAS 2014, and PNAS's editorial expression of concern: the 2014 Facebook news-feed experiment raised consent and opt-out questions **[sec]**.
- The Belmont Report (1979), cited from memory; Menlo Report (2012), adapting Belmont to ICT research **[sec]**.
- AoIR, *Internet Research Ethics 3.0* (2019), covering big data and AI research **[sec]**.
- Seif El-Nasr and Kleinman 2020 (read), above.

**Instance.** The Facebook emotional contagion study **[sec]**.

**Principles.**
1. *No covert experiments.* Any director variation whose studied outcome is the player's emotion or behaviour needs opt-in. Test: an experiment registry with a consent flag.
2. *Opt-in telemetry with a viewer.* A plain-language list of what is sent and a "show me what was sent" view.
3. *Playtest consent names content intensity,* allows withdrawal at any time and avoids social pressure.

**Failure modes.** Bureaucratic for a hobby project; opt-in telemetry skews toward enthusiasts, which weakens the audits in fields 2 and 3.

**Relevance.** Supporting; medium confidence.

**Surprise.** Yes.

---

## 19. User-generated-content governance and trust and safety

**Definition.** The study and practice of content moderation, flagging, appeals and transparency, including modding-scene governance.

**Why it matters here.** Community packs ship content into a violent adult game. Someone must decide how packs are vetted, how a harmful pack is handled, who bears the load, and what the host owes legally.

**Key sources.**
- Tarleton Gillespie, *Custodians of the Internet* (Yale University Press, 2018) **[sec]**; Sarah T. Roberts, *Behind the Screen* (Yale University Press, 2019) **[sec]**.
- The Santa Clara Principles (2018): numbers, notice and appeal **[sec]**.
- Kate Crawford and Tarleton Gillespie, "What is a flag for?", *New Media & Society* (year given variously as 2014 or 2016) **[sec]**.
- Nexus Mods, "The Law and Adult Content" (July 2025): age verification for UK and EU users **[sec]**.
- Game Developer, "Hot Coffee's Effects on the Mod Scene" (read).

**Instance.** The Hot Coffee mod (June 2005) unlocked sexual content that already existed in San Andreas's code; the ESRB then required publishers to disclose locked content, and modders described a chilling effect that discouraged even harmless mods (read).

**Principles.**
1. *Declared descriptors, mechanically verified.* A pack manifest lists content descriptors and a maximum intensity; a static scan rejects assets or events beyond it, including dormant or locked content (the "Hot Coffee rule"). Test: the scanner finds undeclared tagged assets.
2. *Provenance and takedown.* Versioned packs, a reporting path and an appeal route.
3. *Moderator welfare.* No design requires humans to read explicit content in bulk; sample and tool instead.

**Failure modes.** Flags are brigaded; scanning misses semantic harm; strict gating pushes modders to unmoderated sites; and the Hot Coffee chill shows heavy-handed enforcement drives creators away.

**Relevance.** Core; high confidence.

**Surprise.** Yes.

---

## 20. Ratings and classification

**Definition.** Age-rating regimes (ESRB, PEGI, Australian Classification Board, CERO, USK) and their treatment of mods and user content.

**Why it matters here.** The base game carries an M rating. A mod adds content outside the original assessment, ratings bodies say they cannot rate mods, and regional law diverges.

**Key sources.**
- ESRB's listing for Cyberpunk 2077: Mature 17+, descriptors Blood and Gore, Intense Violence, Nudity, Strong Language, Strong Sexual Content, Use of Drugs and Alcohol **[sec]**.
- Game Developer on the ESRB's 3 May 2006 re-rating of Oblivion from T to M (read): ESRB said mods cannot be factored into a rating and some may be inconsistent with it.
- ESRB's "Users Interact" element and its statement that user-made content does not change Dreams' rating **[sec]**.
- Australia's R18+ for Cyberpunk 2077 (no cuts) and reported Japanese alterations **[sec]**.

**Instance.** Oblivion: a locked topless skin and more detailed gore than originally assessed led to the re-rating (read).

**Principles.**
1. *Stay inside the base game's descriptor set.* Every generated event class maps to a descriptor the base game already carries. Test: descriptor mapping table; unmapped classes block release.
2. *Region-aware defaults.* Content that touches regional law (nudity, sexual violence) is off until enabled.
3. *Say the mod is unrated,* in the manifest and the readme.

**Failure modes.** Boards do not assess systemic or emergent content; descriptors are blunt; "stay within the base game" can block legitimate new kinds of cruelty or satire.

**Relevance.** Supporting; medium-high confidence.

**Surprise.** No.

---

## 21. Publisher fan-content and licence rules

**Definition.** The legal terms (CDPR's Fan Content Guidelines, the REDmod licence, the game's EULA) governing what mods may contain and do commercially.

**Why it matters here.** The mod's existence depends on these rules, and they apply to community packs too.

**Key sources.**
- CD PROJEKT RED, Fan Content page (read): bans racist, xenophobic, sexist, defamatory, illegal or offensive material and use of real people's likeness or brands without permission, bans paywalls and sale, permits mods that respect the EULA, requires an "unofficial fan work" statement, leaves ownership with the creator while granting the company a broad licence; it says nothing about AI-generated or sexual content as such.
- The Sixth Axis, 28 January 2021 (read): the Keanu Reeves "joytoy" model-swap mod was pulled after CDPR said its main rule is that user content "can't be harmful towards others".
- Reports on CDPR's January 2026 DMCA takedown of a paid Cyberpunk VR mod on Patreon, and the dispute over whether independent framework code counts as using the IP **[sec]**.

**Instance.** The joytoy mod (2021, read); the VR mod (2026) **[sec]**.

**Principles.**
1. *Manifest declarations.* Packs declare no real-person likeness or brand, with a blocklist check. Test: pack validation.
2. *No paywall hooks in the tooling.* Donation links only.
3. *Unofficial-work notice* shown for every pack and for the system itself.

**Failure modes.** Silence on AI and sexual content leaves ambiguity; "offensive" is subjective; the licence grant is broad; the VR dispute shows enforcement can reach independent frameworks.

**Relevance.** Core; high confidence.

**Surprise.** No.

---

## 22. Performer and likeness rights

**Definition.** Labour and IP law on voice and likeness: union digital-replica terms, rights of publicity, and AI voice.

**Why it matters here.** Generated dialogue pulls toward synthetic voices; pack authors may clone the game's actors; real people's faces can be swapped into violent or sexual scenes. The brief rules out cloning the game's actors.

**Key sources.**
- SAG-AFTRA's 2025 video game agreement: written consent for digital replicas, a usage report, minimum rates, with real-time generation paying at least 7.5 times scale (TheWrap and wire coverage) **[sec]**.
- CDPR used Respeecher to adjust a different actor's recording to sound like the late Miłogost Reczek in Phantom Liberty's Polish release, reportedly with his family's permission; the localisation director said the studio disliked the approach (Fortune, GGRecon, Slashdot) **[sec]**.
- GGRecon, 7 July 2023 (read): several Skyrim and ESO actors and the National Association of Voice Actors objected to AI voice clones in explicit mods; Nexus Mods' stance then was that AI-generated mod content is not against its rules.
- *Keller v. Electronic Arts*, 724 F.3d 1268 (9th Cir. 2013): no First Amendment defence as a matter of law where avatars literally recreated a player **[sec]**.
- CDPR's real-person clause (field 21, read).
- EU AI Act Article 50 (in force from 2 August 2026): disclosure and deepfake labelling duties **[sec]**.

**Instance.** The Skyrim explicit voice-clone mods (read); the Reczek dub **[sec]**.

**Principles.**
1. *No synthetic voice of an identifiable performer.* Generated lines are text or generic voice with provenance. Test: no voice model with game audio in its training data.
2. *Pack voice policy.* Packs may ship their own recorded performances with a signed consent statement, but may not recombine or clone extracted game audio.
3. *No real-person name-plus-face.* Generated characters never combine a public figure's name and likeness. Test: public-figure name blocklist and likeness check on pack assets.

**Failure modes.** Consent is not the end of the ethics (Reczek's family consented, and the controversy continued). Blocking all synthetic voice hurts accessibility and screen reading. A generic voice can still evoke a specific actor. Text-only lines feel flat.

**Relevance.** Core; high confidence.

**Surprise.** Yes.

---

## 23. Copyright and IP in generated text and packs

**Definition.** IP law on authorship of AI-assisted output, memorisation of training data, trademarks and real brands, and licensing for community packs.

**Why it matters here.** It is unclear who owns generated scenes; a language model can regurgitate copyrighted or personal text; community packs need licences; brands and real people appear in dialogue.

**Key sources.**
- US Copyright Office, *Copyright and Artificial Intelligence*, Part 2 (Copyrightability), 29 January 2025 (page read; its conclusion that prompts alone do not establish authorship is from secondary summaries **[sec]**); Part 3 (training), pre-publication 9 May 2025 (read).
- Nicholas Carlini et al., "Extracting Training Data from Large Language Models", USENIX Security 2021 **[sec]**.
- Valve's AI-disclosure rules, under which developers remain liable for AI-generated assets **[sec]**.

**Instance.** Steam's live-generation disclosure regime **[sec]**.

**Principles.**
1. *Mark authorship.* Every pack asset is flagged human-authored or generated. Test: manifest field required.
2. *Overlap check.* Generated text is checked for verbatim overlap with the base game's scripts and quest corpus. Test: overlap below threshold.
3. *Closed brand lexicon.* Only fictional or in-canon brands appear in generated text.

**Failure modes.** Law is in flux. Overlap checks hamper legitimate in-universe catchphrases. A ban on real brands cuts against cyberpunk's tradition of satirical brand parody.

**Relevance.** Supporting; medium confidence.

**Surprise.** No.

---

## 24. Patents on game-AI techniques

**Definition.** The practical IP constraint of granted patents on game mechanics and AI, and how developers have designed around or lived with them.

**Why it matters here.** A system with NPCs that hold beliefs and grudges sits near the Nemesis System patent's territory. In the US a patent can constrain what a published mod does regardless of copyright or fan-content permission.

**Key sources.**
- US 10,926,179, Warner Bros., "Nemesis characters, nemesis forts, social vendettas and followers in computer games", granted 23 February 2021 (filed 25 March 2016, priority March 2015; listed expiry about 2035-36; inventors include Michael de Plater). Patent Arcade (read): claim 1 as granted covers a processor running game events involving a player avatar and an opposing NPC, detecting a defined event involving the avatar's interaction with that NPC, changing parameters of a second NPC, and outputting an indication; claims were narrowed over six rejections. I could not read the full claim text myself.
- Finnegan on whether game-mechanic patents survive the Alice test **[sec]**.
- US 9,789,406, Activision (field 14) **[sec]**.
- Namco's loading-screen minigame patent US 5,718,632, expired November 2015 **[sec]**.
- Nintendo US 12,403,397: the USPTO director ordered reexamination in November 2025 and the office later issued a non-final rejection of all claims; Pocketpair changed its summoning mechanic during the dispute **[sec]**.

**Instance.** The Nemesis patent; the Palworld dispute.

**Principles.**
1. *Patent-watch note per subsystem.* Any subsystem whose design resembles a known granted claim has a design note naming the patent and the architectural difference. Test: a release checklist blocks without it.
2. *Counsel before release for the grudge and hierarchy subsystem.* Not a legal conclusion; my inference is that exposure exists but is uncertain.
3. *Never lift implementation from patent text.* Design from the problem, not the specification.

**Failure modes.** Patent search is costly. Claims may be narrow or invalid (Alice), and the Nintendo reexamination shows validity can move. Patents are territorial. Over-avoidance produces worse design. My guess, not a finding, is that patentees rarely pursue free mods; the practical risk concentrates on funded releases.

**Relevance.** Core constraint for the grudge subsystem; medium confidence about actual exposure.

**Surprise.** Yes.

---

## 25. Accessibility of generated content

**Definition.** Game accessibility guidance (Game Accessibility Guidelines, Xbox Accessibility Guidelines, AbleGamers' APX) and web standards on flashing and cognitive load.

**Why it matters here.** Generated content has to be legible and playable for many players. Procedural effects can breach flash thresholds, timed offers exclude, and generated text has no editor checking reading level.

**Key sources.**
- Game Accessibility Guidelines (gameaccessibilityguidelines.com; read): basic, intermediate and advanced tiers by a group of studios, specialists and academics.
- Xbox Accessibility Guidelines v3.2 (June 2023) and AbleGamers' Accessible Player Experiences patterns **[sec]**.
- WCAG 2.3.1 Three Flashes or Below Threshold **[sec]**.
- W3C Working Group Note, *Making Content Usable for People with Cognitive and Learning Disabilities* **[sec]**.

**Instance.** Cyberpunk 2077's braindance seizure reports (field 9, read).

**Principles.**
1. *Flash audit.* All shipped and generated visual effects pass an automated check against the three-flashes thresholds.
2. *Untimed alternative.* Every generated offer has an untimed path and configurable text size and reading level.
3. *Never rely on colour or sound alone* to carry offer information.

**Failure modes.** The guidelines assume authored content; generated reading level and flash behaviour are under-explored. Mods often neglect options. Advanced tiers address niche mechanics and may not apply.

**Relevance.** Supporting; high confidence on flash safety, medium on the rest.

**Surprise.** No.

---

## Proportion

Most of these fields converge on a few enforceable ideas that cost little blandness: the player owns the boundaries (fields 8, 9, 16), the generator's causes of violence are social variables and never demographics (fields 2, 3, 4), a few absolutes are enforced by schema not by filter (fields 10, 11, 22), and the director's objectives are audited (fields 14, 15, 16). Graphic violence, cruelty and moral grayness are not what any of the evidence points at as the problem; the evidence points at stereotype at scale, lack of consent, minors, covert profiling and manipulation.

## Considered and rejected

- Online harassment and Gamergate scholarship: aimed at multiplayer culture; marginal for a single-player free mod (pack authors could be targeted, but I found nothing specific enough to act on).
- Loot-box and gambling law: no monetisation is planned; used only for the reality-check analogue (field 15).
- Children's privacy law (COPPA, UK Age Appropriate Design Code): an M-rated local mod with no data collection makes this peripheral; folded into field 17.
- Moral foundations theory and moral psychology of play: interesting, but I found no actionable, verifiable rules; the one study I wanted (Hartmann and Vorderer on moral disengagement) did not surface.
- Group-fairness metrics from machine learning (demographic parity and similar): designed for decisions about people, not roles in fiction; borrowed only as audit ideas in fields 2 and 3.
- Trauma-informed design: a real field, but I did not research it deeply enough to cite; the safety-tool literature covers the practical overlap.
- Postcolonial game studies as a separate field: folded into field 1.
- Literary narrative ethics (Booth, Nussbaum): peripheral for a systems design question.
- Religion and blasphemy law: varies by jurisdiction and is handled by regional rating defaults (field 20).
- Posthumous publicity rights: folded into field 22.
- Paradox-style historical-sensitivity practice (Crusader Kings, Victoria): I found no sourced guidance within time.
- Dataset licensing for model training: peripheral unless the project trains its own models.
