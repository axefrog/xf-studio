# Dossier 19: rights, licences and platform rules

**Status:** v1, 23 October 2026. Dossier 19 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: ETH-16 (publisher fan-content and licence rules) and ETH-17 (performer and likeness rights; AI voice and disclosure norms). Supporting fields: ETH-11 (responsible-design process), ETH-14 (user-generated-content governance) and ETH-18 (copyright and IP in generated text and packs). It answers the pointers to "dossier 19" in [dossier 18](d18-content-boundaries.md) (§5.1 FLR-02 and FLR-03, §11 question 3, S18-S4-08, MM-9) and [dossier 16](d16-authoring-tools.md) (S16-S4-12), and it feeds P6 (the pack format, S4) and, lightly, S2. It takes [D-09](../decisions.md), [D-21](../decisions.md), [D-22](../decisions.md) and [D-23](../decisions.md) as given.

**This is a reading of published terms, not legal advice.** Every rule below is what a document says, as I read it, with its link, its date and how much of it I read. Where I infer beyond a document I say so. Quotations are short phrases.

**How far each source was read.** *Full* means I read the whole text (a PDF I converted to plain text). *Part* means I read the clauses named. *Page* means a web page read through a summarising fetch tool, so its wording is paraphrase unless I quote a phrase; where a clause mattered I fetched it a second time and asked for the exact words. *Abstract* means the abstract only. *Summary* means a search-engine summary; I cite only what it states. *Not read* means a primary source I could not open (Nexus Mods blocks automated fetches of its news posts, so those are known only through press reports and search summaries, and I say which).

## In brief

- **The publisher's terms are short, and they are about money, ownership and harm to people.** Mods are welcome ("software that modifies or works with our games"). Nothing may be charged for or paywalled; donations are fine. Everything in the game belongs to CD PROJEKT RED. Content must not be "racist, xenophobic, sexist, defamatory, illegal or offensive", and real people and brands in the game need their permission. The fan-content page says nothing about AI or sexual content. The enforcement I found concerns two things: a real person's likeness in explicit scenes (2021) and a paid mod (2026). I found no case against fiction as such (FAN-03, FAN-07).
- **A newer clause matters more than the fan-content page.** The publisher's User Agreement (updated 10 August 2026, in effect from 9 September 2026) bars using the games "or any works included there" for text and data mining, and that point has no fan-content carve-out. The engine must ship no model trained on game text or audio, and packs must carry no game content, only references to it by id. Calibrating lints or overlap checks on the game's own text is a use the clause may reach, so it needs care or permission (FAN-05, FAN-06).
- **Dossier 18's hate floor survives, but its footing changes.** The publisher's list is open-ended and discretionary ("offensive"); nothing I read bars a character's bigotry in fiction, but nothing protects it either. The narrower, better anchor is the host's rule about content "abusive toward real individuals or groups". The floor should be justified as prudence matched to the host, not as something the publisher's terms require (§5.8).
- **Voices: ship none, and never clone a person.** The engine ships text and no voices. Voice has four sources (the game's own lines, a consenting performer's recording in a pack, a generic synthetic voice, a clone). The first three are declared; the fourth is a floor. The game's cast are heard only in their recorded lines, whole and by id (VOX-01 to VOX-06).
- **Packs are third-party works and need a rights block.** Each pack declares a licence, a permissions block in the host's own convention, an AI-use declaration, a voice declaration and a play grant for recording and streaming. The play grant exists because the publisher allows monetised videos while a "non-commercial" pack licence may not (LIC-01 to LIC-04).
- **What the engine ships by default is small.** Engine code and a starter pack the project writes, with no game content, no voices, no network and no explicit source material. Everything else is something users add, with capabilities off until switched on (SHP-01 to SHP-03).

## 1. Scope and why it matters here

The mod's existence depends on documents the project does not write: the game's licence agreements, the publisher's fan-content rules and the hosting site's terms. Community packs will be written by other people under those same documents, and the engine may one day render lines in characters' voices. This dossier asks what those documents say about each thing the engine and its packs might contain, which rules are hard constraints on the design and which are prudence, what a pack must declare about its rights, and what the engine ships by default versus what only users add. It is deliberately short and is best read before the pack format is fixed.

### 1.1 What it informs

| Layer or concern | What this dossier gives it |
|---|---|
| 1. Simulation (S0, S1) | Nothing new. `ageClass` and the floors come from dossier 18 |
| 2. Seeding (S2) | Voice references that name existing game lines and nothing else; an unresolved-content fallback for withdrawn packs; two lint extensions (§13.1) |
| 3. Procedural engine (S3, P5) | The rule that generated text carries recorded provenance; no cloning path |
| 4. Authored content (S4, P6) | The rights block of the pack manifest: licence, permissions, play grant, AI and voice declarations, price, contact, terms snapshot (§13.2) |
| Expression (P8/X) | The unofficial-work notice, the credits panel, disclosure copy |
| Player configuration (C) | Capabilities that are off until the player turns them on (voice adapter, language model, network) |
| Evaluation (P9) | Nothing new |

### 1.2 What it does not cover

- **The floors' content** (minors, hate, representation): dossier 18. This dossier confirms or corrects only their footing in the terms.
- **Data protection for a local, free mod** (dossier 12's PRV-06): not researched here. It is an open question (§11).
- **Statutes on minors, publicity and personality rights, and text-and-data-mining law:** read only through the documents named. No statute was opened in this dossier.
- **Whether XF Core's own route to players is within the publisher's rules:** it is the bridge chat's. FAN-02 notes only what the companion process raises.
- **Patents:** out of scope under [D-20](../decisions.md).

### 1.3 Pointers answered

| Pointer | Where |
|---|---|
| Dossier 18 §11 question 3 and FLR-03 (the hate floor, "confirm") | §5.8 |
| Dossier 18 FLR-02 (real people; the game's cast; synthetic voice) | VOX-01 to VOX-06, PLT-04 |
| Dossier 18 S18-S4-08 (is the `real-slur` lexicon kept in the public repository?) | §5.8 and S19-S4-12 |
| Dossier 18 MM-9 (platform age assurance; fictional depictions of minors) | PLT-02, PLT-03 |
| Dossier 16 S16-S4-12 ("the build refuses obvious violations once dossier 19 fixes the rules") | §13.2 |

### 1.4 What is already settled and used as given

- **D-23.** The engine handles explicit content like any data; only the source material for such classes comes from human-written packs, each with a non-explicit partner. This dossier adds that the human author is also the rights holder, and says what the pack must declare.
- **D-09 and D-22.** Not touched.
- **The repository's credit policy** ([AGENTS.md, "Community credit"](../../../AGENTS.md)) is a public acknowledgement of what taught us something; it is not a pack-rights system. Pack authors' credits are a separate, in-app matter (LIC-03).
- **The repository's packaging rules** ([AGENTS.md, "Mod pipeline and packaging"](../../../AGENTS.md)): never package reference assets; add only our own mod to a user's manager; users' core setups are never touched. The community-credits page already states that game content is used as a private local reference and none is redistributed. FAN-05 turns that into a schema rule.

## 2. The failure record

### 2.1 Cases

| # | Case | What went wrong | Source and read |
|---|---|---|---|
| F-01 | **The "joytoy" model-swap mod (January 2021)** | A mod put a real actor's likeness, as a game character, onto characters in sex scenes without his permission. The publisher said its main rule for user content is that it "can't be harmful towards others", that creators need the permission of everyone concerned, and that fictional characters can be freely edited while models of real people need explicit permission in offensive situations. The mod was taken down | Stefan L, The Sixth Axis, 28 January 2021 (*page*) |
| F-02 | **A paid VR mod (January 2026)** | The publisher issued a DMCA takedown against a Cyberpunk 2077 VR mod sold through a subscription page, saying that it never allows monetisation of its IP without direct permission and would accept the mod returning free with optional donations. The modder disputed that independent software containing none of the publisher's code or assets is fan content. He removed the mod and dropped support | Hitmarker, 20 January 2026 (*page*; no author named) |
| F-03 | **Cloned actors' voices in explicit Skyrim mods (July 2023)** | Mods used a voice-cloning service to put voice actors' voices into pornographic content. Actors said they did not consent and called it degrading; the voice actors' association tagged the publisher. The host's stated position, from April, was that AI-generated mod content "is not against our rules", though it might be removed on a credible complaint from an affected creator or rights holder. The article reports no statement from the game's publisher | Imogen Donovan, NME, 7 July 2023 (*page*) |
| F-04 | **The studio's own cloned voice (October 2023)** | The studio used a voice-cloning tool to make a new actor's recording sound like a Polish actor who died in 2021. His family were consulted and "very supportive". The localisation director said the team "didn't like this approach". Reports left open whether the family was paid. The case shows that even a sanctioned, consented use is contested; it gives no one else a licence | Donovan Erskine, Shacknews, 12 October 2023; Joseph Kime, GGRecon, 13 October 2023 (both *page*) |
| F-05 | **"Hot Coffee" (2005 to 2006)** | A mod unlocked content already on the game's disc. The rating body moved the game to Adults Only; mod makers were first blamed for creating the content, then for enabling access. A year on, a modder said harmless work was going unreleased for fear of another controversy. The ratings body said it does not hold publishers responsible for third-party mods but wants them to know the risks | Brenda Brathwaite, Game Developer, 27 October 2006 (*page*) |
| F-06 | **Undisclosed AI use on a mod host** | The host now tags generated code, interface, voices, dialogue, translations, music and assets as AI-Generated Content; promotional material as AI Media; limited developer-led use as AI Assisted. Mis-tagging, including undisclosed use, "may be subject to moderation"; deliberate abuse of the tags is punished at once | TJ Denzer, Shacknews, 31 July 2026; the host's File Submission Guidelines, updated 20 October 2026 (both *page*) |

### 2.2 What the failures have in common

- **The harm is to a person, or the money moved.** F-01 to F-04 involve a real person's likeness or voice. F-02 involves a price. None involves a fictional character doing something dark.
- **The content that caused trouble was either already in the package (F-05) or added by someone other than the platform (F-01, F-03).** The first argues for keeping contested source material out of the engine package; the second means hosts moderate on notice, so a pack can disappear.
- **Disclosure rules came after the fact (F-03 to F-06).** The norm moved from "not against our rules" in April 2023 to required tags in 2026.

### 2.3 Where the advice itself fails, and what did not survive

- **"Packs declare no real-person likeness, with a blocklist check" (lens L10, principle 1 of its field 21).** A blocklist of names is always incomplete and only advisory. The declaration is kept; the blocklist is demoted to a review aid.
- **"Check generated text for verbatim overlap with the base game's scripts" (L10, field 23).** It sounds like a safeguard, but the check compares against game text, which the 2026 User Agreement's text-and-data-mining clause may reach (FAN-06). It survives only for packs and public text, and as a decision for the maintainer for game text.
- **"Text-only content sidesteps the voice-cloning controversy" (L9 field 21).** True for performers' rights, false for disclosure: the host's tags cover generated dialogue as well as voices (PLT-05).
- **"Block all synthetic voice."** Rejected: it hurts accessibility and screen reading (L10's own failure mode, not independently verified). The floor is on cloning real people, not on synthesis.
- **"The publisher's licence grant is broad, so pack authors must be warned".** The fan-content page asks for the grant in softer words than the lens reports (FAN-08).

## 3. Sources

| Source | Used for | Read |
|---|---|---|
| CD PROJEKT RED, [Fan Content Guidelines](https://www.cdprojektred.com/en/fan-content) (page says last updated 10 December 2020) | What fan content and mods may do; commercial use; the unofficial notice; conduct; real people; the grant to the publisher; changes | **page** (fetched three times; key sentences re-fetched for exact words) |
| CD PROJEKT RED, [Cyberpunk 2077 End User Licence Agreement](https://cdn1.epicgames.com/eulatracking-download/cp2077/en/v1/r2/ebdad01b0f2e8388d23b5750ca18a3ac.pdf) (last updated 10 December 2020) | Ownership of game content; rules 7(a) to 7(m); cheating; names | **part** (clauses 1, 6.1, 7, 8 read from the converted PDF) |
| CD PROJEKT RED, [REDmod End User Licence Agreement](https://cdn1.epicgames.com/eulatracking-download/redmod/en/v1/r2/bfa2a0e549d6deaaf540f12d85b71493.pdf) (last updated 6 September 2022) | Mods made with REDmod: non-commercial, Cyberpunk only, licence and waiver | **full** |
| CD PROJEKT RED, [User Agreement](https://regulations.cdprojektred.com/user_agreement) (updated 10 August 2026, in effect from 9 September 2026) | Commercial use, technical misuse, cheating, text and data mining, conduct | **page** (two fetches; point 25 re-fetched for its exact words) |
| Nexus Mods, [File Submission Guidelines](https://help.nexusmods.com/article/28-file-submission-guidelines) (updated 20 October 2026) | Permissions, credit, copyrighted content, adult content, child characters, real persons, AI tags, network use, donations | **page** |
| Nexus Mods, [Terms of Service](https://help.nexusmods.com/article/18-terms-of-service) (updated 12 May 2026) | Uploader's licence to the host; illegal content; rules for uploads | **page** (sections 22 to 24 as the fetch returned them) |
| Nexus Mods, "The Law and Adult Content" (July 2025) and "Age Verification for UK Users" | Age verification, adult tags | **not read** (blocked); known through Sam Sepiol, [Insider Gaming, 1 July 2025](https://insider-gaming.com/nexus-mods-plans-to-add-age-verification-for-adult-mods-in-uk-and-eu/) (*page*) and search summaries |
| Nexus Mods, "AI-Generated Content in Modding" | The AI tags | **not read** (blocked); known through [Shacknews, 31 July 2026](https://www.shacknews.com/article/150216/nexus-mods-gen-ai-tagging-moderation) and the Guidelines above |
| The Sixth Axis; Hitmarker; NME; Shacknews; GGRecon | The cases in §2.1 | **page** each |
| TheWrap, Jeremy Fuster, [12 June 2025](https://www.thewrap.com/sag-aftra-video-game-deal-details/) | SAG-AFTRA 2025 interactive agreement: consent, minimum rates, real-time generation | **page** (secondary account; the agreement itself not read) |
| [EU AI Act, Articles 50 and 3](https://artificialintelligenceact.eu/article/50/) | Disclosure duties; definitions of deep fake, provider, deployer | **page** (an unofficial reproduction; the Official Journal not read). The marking grace period is known only from secondary summaries |
| US Copyright Office, [*Copyright and Artificial Intelligence*, Part 2: Copyrightability](https://www.copyright.gov/ai/) (29 January 2025) | Authorship of AI-assisted output | **part** (conclusions and the prompts section, from the PDF) |
| Carlini and eleven co-authors, ["Extracting Training Data from Large Language Models"](https://arxiv.org/abs/2012.07805) | Memorisation | **abstract** |
| Raji and eight co-authors, ["Closing the AI Accountability Gap"](https://arxiv.org/abs/2001.00973); Mitchell and eight co-authors, ["Model Cards for Model Reporting"](https://arxiv.org/abs/1810.03993) | Documents at each stage; short reporting documents | **abstract** each |
| Santa Clara Principles on Transparency and Accountability in Content Moderation, [version 2.0](https://santaclaraprinciples.org/) | Notice, appeal and numbers in moderation | **page** |
| Creative Commons, [CC BY-NC-SA 4.0 deed](https://creativecommons.org/licenses/by-nc-sa/4.0/); SPDX, [identifier page](https://spdx.org/licenses/CC-BY-NC-SA-4.0.html) | What attribution, NonCommercial and ShareAlike say; the identifier | **page** (the deed is a summary with no legal value; the full legal code not read) |
| Tarleton Gillespie, *Custodians of the Internet* (Yale, 2018); Friedman and Hendry, *Value Sensitive Design* (MIT Press, 2019) | ETH-14 and ETH-11 background | **publisher page only** (Gillespie) and **not read** (Friedman and Hendry; its page was blocked). No principle rests on either |

## 4. What the documents show

### 4.1 Who owns what

- **The game is the publisher's.** The agreement lists the game's characters, storylines, artwork, music, dialogue, audio, text, code and databases as owned or licensed by the publisher, all rights reserved except as the agreement and the fan-content guidelines explain (EULA 6.1, *part*). The fan-content page repeats it: the publisher owns all content from its games, including characters, setting and gameplay.
- **Fan content is the creator's.** Creators own new, original fan content. The page "kindly" asks creators to give the publisher, from the moment of creation, a non-exclusive, permanent, irrevocable, worldwide, sub-licensable, royalty-free licence to use it "in connection with our games" (*page*).
- **Mods made with the official tool are fenced further.** Under the REDmod agreement a mod may be used only with Cyberpunk 2077 and only non-commercially, the publisher claims no ownership, and the mod's author waives claims over later similar content the publisher makes independently (*full*). The Story Engine does not depend on that tool, so this is context.

### 4.2 What mods may do

- **Permitted types** include gameplay videos and streams, fan art, screenshots, community sites, and "software that works alongside our games, like overlay software" (*page*).
- **Mods** are welcome "so long as" they do not breach the game's agreement, "no cheating" being the example. A mod "for another game or service using our content", or a mod made "a standalone product", needs asking in advance by email (*page*).
- **No commercial use.** Fan content may not be charged for or paywalled, though reasonable donations are accepted. Monetising videos and streams through the platforms' partner programmes is allowed (*page*; User Agreement point 19, *page*).
- **A disclaimer** must be shown clearly, saying the work is unofficial and not approved or endorsed (*page*).

### 4.3 What mods may not do

- **Conduct.** The page's golden rule is headed "Don't hurt us or others" and bars anything "regarding our games that is racist, xenophobic, sexist, defamatory, illegal or offensive" (*page*, exact words). The agreement's version for players lists "racist, harassing, xenophobic, sexist, discriminatory, abusive, defamatory or otherwise offensive or illegal" (EULA 7(m), *part*; User Agreement point 29, *page*).
- **Real people.** "Real-life brands and people included in our games" may be used only if they allow it, and creators must get permission from everyone concerned (*page*, exact words). The agreement separately bars infringing privacy or publicity rights (EULA 7(j), *part*).
- **Mining.** The User Agreement bars reproducing, extracting or otherwise using the games "or any works included there" for text and data mining (*page*, point 25, exact words in two parts). The 2020 licence's data-mining rule was about personal or confidential data (EULA 7(h), *part*), so the text-and-data-mining sentence is in the newer document.
- **Cheating.** The agreement defines cheats broadly, to include automation software, scripts and tools that read the game's memory (EULA 7(e), *part*; User Agreement point 22, *page*). The mod permission is conditional on "no cheating".
- **Unrelated use** of game footage or music, remixes of the publisher's music, games or apps based on its games, and domain names containing its names are barred on the fan-content page.

### 4.4 The host

- **Permissions belong to the original author, file by file.** The page must show them or say that permission must be asked for; credit is required and "does not replace permission"; permissions once given to another user cannot be withdrawn after that user's file is released; conversations should be recorded (*page*, File Submission Guidelines).
- **Rules:** copyrighted game files are banned without the owner's permission; mods must follow the licences of the titles they modify; adult content must be tagged; files that connect to the internet are banned unless crucial; there are AI tags (*page*).
- **Terms:** the uploader keeps ownership but grants the host and its partners a worldwide, non-exclusive, royalty-free, transferable licence that lasts "forever"; illegal content includes child sexual exploitation, hate offences and sexually explicit deepfakes (*page*, sections 22 to 24).

## 5. Principles

Grades follow [P1 §4](../p1-research-method.md#4-evidence-grades-for-craft-knowledge). A stated rule in a published document, with enforcement or community practice behind it, is graded **[practice]**; legal doctrine is **[analysis]**; the project's own inference is **[hypothesis]** and says what it extends. "Read" is the reading level from §3.

### 5.1 The publisher's terms (ETH-16)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| FAN-01 | **The governing documents are four, they change, and the stricter wins.** The fan-content page says the agreements win over it. Changes to the fan-content page bind 30 days after posting. A pack or release is checked against a named set of versions, and the set is recorded. | [practice] | Fan-content page, sections on legal rules and changes (*page*). Versions read: fan-content page 10 December 2020; EULA 10 December 2020; REDmod EULA 6 September 2022; User Agreement 10 August 2026 | all · 4, C | **Produce:** a `terms` snapshot in the manifest (S19-S4-09). **Check:** a release checklist step compares the dates of the four pages to the snapshot; neither a procedure nor the engine can read the pages at play time (and must not, PLT-06) |
| FAN-02 | **The companion process sits on the line between "works alongside our games" and "a standalone product", and the text does not settle which.** Mods that modify or work with the game are welcome; making "the mod a standalone product" needs prior permission. The engine ships as a companion process launched by XF Core's plugin system ([D-04](../decisions.md)). | [hypothesis], extending the Mods rule and the "works alongside" item | Fan-content page, mods rule and permitted types (*page*, exact words). Instance: an overlay is named as permitted; a separate executable that drives the game is not named | all · — | **Neither.** A question for the maintainer, who may email the publisher's legal address (the page offers that route and says silence is not consent). Recorded as open question 1 |
| FAN-03 | **Nothing is sold, nothing is paywalled; donations are the only money, and the host adds its own limits.** The 2026 takedown shows the rule is enforced against independent software, by DMCA, with the publisher offering a path back (free plus donations). The host bans actively soliciting donations and has its own donation rules. | [practice] | Fan-content page and User Agreement point 19 (*page*); Hitmarker, 20 January 2026 (*page*); File Submission Guidelines on donations (*page*) | all · 4, X | **Produce:** manifest `price: free` is the only allowed value (S19-S4-04); the tooling has no payment, unlock or subscription field and no tiered-content mechanism. **Check:** schema refuses any other value; a lint warns on payment words in pack text (advisory) |
| FAN-04 | **Every pack and the engine say plainly that they are unofficial fan work.** The notice is shown where a pack is enabled and in the engine's settings and about screens, and is added by the build, not typed by authors, so nobody can omit or alter it. | [practice] | Fan-content page, the "clearly unofficial" rule (*page*) | all · 4, X | **Produce:** S19-S4-10. **Check:** the build refuses a pack archive without the injected notice |
| FAN-05 | **Packs carry no game content: they refer to it by id, and the engine resolves the reference on the player's machine.** The game's text, audio, characters, setting and code are the publisher's. The host also bans copyrighted game files without the owner's permission. Existing project practice already treats game content as a private local reference. | [practice] | EULA 6.1 (*part*); fan-content page on ownership (*page*); File Submission Guidelines (*page*); [community credits](../../../docs/community-credits.md) ("none is redistributed") | all · 2, 4 | **Produce:** a `GameRef` content-reference kind that names a record or line by id; no content kind carries game text or audio inline (S19-S2-04). **Check:** structural: the pack format has nowhere to put game payloads; an advisory overlap review against public text only |
| FAN-06 | **The User Agreement bars using the game or its works for text and data mining, with no fan-content carve-out in that point. So the engine ships no model, index or training set built from game text or audio, and any use of game text as an analysis corpus is a decision, not a default.** | [practice] for the clause; [hypothesis] for its reach | User Agreement point 25 (*page*, exact words); contrast EULA 7(h) (*part*). Instance: dossier 18's lint calibration "on the game's own text" (S17-S4-16, M18-16), the overlap check proposed in lens L10, and the corpus decomposition in P2 are all uses of game text that the clause may reach. Whether a private, local analysis by the player or maintainer counts is not settled by the text; EU and UK law on text-and-data-mining exceptions and rights reservations was not read | all · 3, 4, P9 | **Produce:** outputs of any such analysis (thresholds, counts, word-list hashes) may ship; the corpus and any extract may not. **Check:** a build check that no game-derived file is in the engine or pack archive. **Neither:** whether the analysis is allowed. Recorded as open question 2; the fan-content page's exceptions route is the way to ask |
| FAN-07 | **The conduct list is open-textured and discretionary. The project reads it as a standard about harm to people, keeps its floors narrower than the list and wider than the evidence of enforcement, and states that reading in the open.** Observed enforcement concerns real people (F-01) and money (F-02), not fiction. The list includes "offensive", which no document defines. | [practice] for the text and cases; [hypothesis] for the reading | Fan-content page (*page*, exact words); The Sixth Axis, 28 January 2021 (*page*); EULA 7(m) (*part*). The absence of a case against in-fiction prejudice is an absence in my searches, not proof. The game's own treatment of prejudice was not checked here | all · 2, 4 | **Produce:** the floors of dossier 18; the pack's `content` declaration; a plain statement in the pack documentation. **Check:** M18-16 and the lints of dossier 18. **Limit:** a reading cannot be tested against a body that has not ruled on it |
| FAN-08 | **Authors keep ownership of their packs, and the publisher is asked for a wide licence over them.** The grant is worded as a request, "from the moment of creation", and runs "in connection with our games". A pack licence must therefore not claim to bar the publisher, and authors should be told. | [practice] | Fan-content page, ownership and licence (*page*, exact words); REDmod EULA (*full*) for the stronger version that applies to mods made with that tool | all · 4 | **Produce:** the licence template says "without limiting rights granted to the publisher under its Fan Content Guidelines"; the pack tool shows a one-line notice. **Check:** the licence field is from a known list (LIC-01); no check can read intent |

### 5.2 The host (ETH-14, ETH-16)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| PLT-01 | **The host's permission model is the de facto licence system for packs: the original author sets permissions per file, shows them on the page, and is credited; credit is not permission.** The pack manifest mirrors it so a pack carries its permissions with it. | [practice] | File Submission Guidelines, usage and accreditation, and the two permissions sections (*page*). Instance: a pack that forbids modification can still be played, but a "pack of packs" cannot bundle it | all · 4 | **Produce:** a `permissions` block with `modify`, `redistribute`, `reuseAssets` and `creditText` (S19-S4-02). **Check:** a tool that builds collections or extensions refuses to include a pack whose `redistribute` is `no` or whose permission is `ask` |
| PLT-02 | **Adult content is allowed on the host but must be tagged and, for some users, age-verified; the tag vocabulary is moving.** | [practice] | File Submission Guidelines (*page*); Insider Gaming, 1 July 2025 (*page*): age verification for UK and EU users, a planned set of tags (reported as Pornographic, Extreme Violence and Sexualised); search summaries of the host's later posts: verification began in the UK through a third-party service and in Brazil on 16 March 2026, and the current tag is "Adult" (*summary*). The host's own news posts were not read | all · 4, X | **Produce:** the manifest's content envelope (S18-S4-03) yields a suggested list of host tags, printed by the pack tool: it suggests, the author decides (S19-S4-08). **Check:** a pack whose envelope reaches the top of an adult class cannot be marked "all audiences" by the tool |
| PLT-03 | **The host's rules on child characters are wider than dossier 18's floor in two ways.** They define a child character by appearance, canonical age, presentation and context, so a character who looks like a child but is declared an adult is covered; and they ban "allusions" to grooming and child exploitation, not only sexual content. | [practice] | File Submission Guidelines, content related to child characters (*page*) | all · 1, 2, 4 | **Produce:** extend L-95 so a `minor` person (or one the author describes with child-coded words) is barred from `exploit.*` roles as well as `sex.*` (S19-S2-02). **Check:** the age-word lint of dossier 18 (L-107, a warning) is promoted to an error when it sits beside an `exploit.*` or `sex.*` tag. Declaration is not enough, because the rule reads appearance |
| PLT-04 | **The host moderates content "abusive toward real individuals or groups" and has specific bans; real-world issues need a tag.** Banned: Axis-power ideology; changing an NPC's race or gender identity to divide or marginalise; sociopolitical mods relating to the USA (the page says since 28 September 2020, extended indefinitely). Allowed with a "Real World Issues" tag and tasteful handling: real-world issues. | [practice] | File Submission Guidelines, real persons and real-world issues (*page*). The ban on sociopolitical mods "relating to the USA" sits oddly with a setting whose world has a fictional North American polity; I do not know how the host reads it | all · 2, 4 | **Produce:** pack `realWorld: none \| tagged` (S19-S4-05). **Check:** an advisory review list of real-world entity names (dossier 18's list); a tagged pack carries the host's tag in its suggested tags. Recorded as open question 4 |
| PLT-05 | **Generated content is allowed but must be disclosed by tag: AI-Generated Content (code, interface, voices, dialogue, translations, music, assets), AI Media (promotion, descriptions), AI Assisted (limited developer-led use, needing evidence of development history).** A mod that is primarily AI-generated gets the first tag from moderators. Undisclosed use may be moderated. | [practice] | Denzer, Shacknews, 31 July 2026; File Submission Guidelines (both *page*). Whether text a player's own machine generates at play time falls under the upload rules is not stated in what I read | all · 3, 4, X | **Produce:** the manifest's `ai` block, with per-unit `origin` (authored, assisted, generated), maps to the three tags (S19-S4-06). The engine itself, if it ships an optional language-model path, declares it. **Check:** the build derives the recommended tags and refuses a pack whose units are marked `generated` but are also marked human-authored (S19-S2-05). The engine cannot know whether a declaration is true |
| PLT-06 | **The host bans files that send or receive data over the internet unless crucial; auto-update does not count.** A cloud language model or voice service is therefore not a default; it is something the player configures, and the page says so. | [practice] | File Submission Guidelines, illegal activity and harmful files (*page*) | all · 3, C | **Produce:** the engine makes no network call by default; any provider adapter is off until the player enables it and supplies the endpoint or key (S19-S4-12). **Check:** a test that a default install opens no sockets |
| PLT-07 | **Hosts remove on notice, so a pack can vanish between sessions.** The host removes content on a credible complaint from an affected creator or rights holder, and takes copyright reports through its report function and a takedown form. A save that refers to a pack must survive its removal. | [practice] | NME, 7 July 2023 (the host's April statement, *page*); File Submission Guidelines, licence-related text (*page*) | all · 1, 2, 4 | **Produce:** an instance runs on its stored expanded document (S2 §1.2), and an unresolved `ContentRef` falls back to the implied form or a neutral placeholder and does not stall the seed (S19-S2-03). **Check:** a fixture that removes a pack mid-run and asserts that every open seed closes or continues cleanly |

### 5.3 Pack licences (ETH-18)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LIC-01 | **A pack is a third-party work. It declares who owns it, under what licence it is offered, and what others may do, in a form the loader reads.** The licence field takes a short identifier list (an SPDX identifier such as `CC-BY-4.0` or `CC-BY-NC-SA-4.0`) or `custom`, which needs a licence text and the permissions block (PLT-01). A `no-licence` pack is refused. | [practice] for the shape; [hypothesis] for the list | The host's permissions model (*page*); the CC deed (*page*); the SPDX page for `CC-BY-NC-SA-4.0` (*page*; the other identifiers are well known but I did not open their pages) | all · 4 | **Produce:** S19-S4-01. **Check:** the identifier is validated against the list; `custom` needs a file |
| LIC-02 | **A licence must be compatible with free distribution and with the publisher's rules, so a "non-commercial" family fits, and the pack must say plainly that recording and streaming play is allowed.** The publisher allows monetised videos and streams of its games. A NonCommercial licence is defined by use "primarily aimed at commercial advantage or monetary compensation", and a monetised stream showing a pack's text could be read as that. This is a design implication the engine can remove by asking for one explicit statement. | [hypothesis], extending the CC deed's NonCommercial wording and the fan-content page's video rule | CC BY-NC-SA 4.0 deed (*page*, a summary with no legal value); fan-content page, videos and streams (*page*) | all · 4, X | **Produce:** a required `playGrant` field with values `recording-and-streaming` (default offered), `recording`, `private-only` (S19-S4-03). **Check:** the loader shows the play grant in the pack's page; a pack without one is refused. The starter pack's own licence choice is open question 6 |
| LIC-03 | **Attribution is the engine's job: authors and licences are shown in the product, and exports carry a credits block.** Runtime recombination in a player's own game is private use, and the CC deed grants copying, sharing and remixing free of fee on stated conditions, mainly credit and, for ShareAlike, the same licence on contributions. Conditions mostly bite when something is shared: an exported story, a share code, a session trace, a screenshot with pack text. Whether text drawn from packs under incompatible licences can be combined in a shared export is unclear. | [hypothesis], extending the CC deed (*page*) | CC BY-NC-SA 4.0 deed (*page*); File Submission Guidelines on accreditation (*page*). The CC compatibility chart was not read | all · 4, X | **Produce:** an in-app credits panel generated from manifests; any export function writes an aggregated credits and licence block (S19-S4-11); by default no function exports pack text. **Check:** an export that would combine packs with a ShareAlike licence and an incompatible one warns |
| LIC-04 | **An authorship claim is the author's statement, and it is what the rights rest on.** The US Copyright Office concludes that purely AI-generated material is not protected, that prompts alone do not make a user the author, and that human expression perceptible in an output, and creative selection or arrangement, can be. Packs therefore mark each unit's origin, and a unit that is `generated` is not offered as the author's copyright work. Third-party assets inside a pack (images, audio, fonts) each declare source and licence. | [analysis] (US law, orientation only) | USCO Part 2, 29 January 2025 (*part*: summary and the prompts section); File Submission Guidelines, "assets used must be permitted by their owners" (*page*) | all · 4 | **Produce:** per-unit `origin` and a per-asset `source`/`licence` (S19-S4-06). **Check:** consistency only (S19-S2-05). Law outside the US was not read |

### 5.4 Voices, likeness and AI (ETH-17)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VOX-01 | **There are four sources of a spoken line, and each has its own rule.** (1) The game's own recorded line, played as it is, by id. (2) A recording in a pack, by its author or a consenting performer. (3) A synthetic voice that does not imitate a real person. (4) A synthetic clone of a real person's voice. The engine ships none of them. It supports declaring 1 to 3; 4 is a floor. | [hypothesis] (a composition of the findings below) | VOX-02 to VOX-06 | all · 1, 4, X | **Produce:** the `audio` declaration of dossier 18 (S18-S4-03) extended with the four kinds (S19-S4-07). **Check:** the build refuses a clone declaration; a missing declaration counts as `none` |
| VOX-02 | **Cloning a real performer's voice without consent is the community's sharpest line, and even a consented, studio-sanctioned use was contested.** Actors called the Skyrim clones degrading; the host's earlier stance was "not against our rules" unless a rights holder complains. The studio's own case had family consent and still drew its localisation director's reservation. Family consent for one studio's use is no precedent for anyone else. | [practice] | NME, 7 July 2023; Erskine, Shacknews, and Kime, GGRecon, October 2023 (all *page*) | all · 4 | **Floor.** The loader refuses a voice declared as a clone of a real person, including the game's cast. **Limit:** it rests on declaration and on review, and a sound-alike cannot be detected |
| VOX-03 | **The labour and legal context points the same way: consent, and payment for live use.** The 2025 interactive-media agreement between the performers' union and the studios requires informed consent for AI use of voice, likeness and movement, sets minimum rates for replicas, and sets at least 7.5 times scale for real-time generation (reported). The EU AI Act defines a deep fake as AI-generated audio, image or video that resembles real people and could pass as genuine, requires deployers to disclose it, and gives artistic and fictional works a lighter disclosure that does not hamper enjoyment; it counts a personal non-professional use outside "deployer" and puts the marking of synthetic audio and text on the provider of the system. Its transparency duties began on 2 August 2026; secondary summaries report a grace period for the marking duty to 2 December 2026. | [practice] for the agreement (secondary report); [analysis] for the Act (orientation only) | Fuster, TheWrap, 12 June 2025 (*page*); the Act's Articles 3 and 50 (*page*, an unofficial reproduction). The union agreement binds its signatories, not mods; I did not read it | all · 3, 4, X | **Produce:** a generated line carries recorded provenance (S2 §8.8 already records gating; S19-S4-06 adds `origin`). **Check:** none. A generic synthetic voice of an invented character does not resemble a real person, so I read it as outside the deep-fake definition [hypothesis]; whether shipping a language-model or voice adapter makes the project a "provider" is open question 7 |
| VOX-04 | **Text is the default, and it still needs disclosure.** Text avoids the performer-rights question entirely. It does not avoid the host's AI tags, which cover generated dialogue as much as voices. Text-only barks are already the plan in the project's credits. | [hypothesis], extending the host's tag definitions and lens L9 | File Submission Guidelines (*page*); Denzer, Shacknews (*page*) | all · 3, X | **Produce:** the default expression of any line is subtitle text; voice is an adapter output. **Check:** none |
| VOX-05 | **The game's cast speak only the lines they recorded, whole and by id.** The game's dialogue and audio are the publisher's; the fan-content page bars remixes of its music and unrelated use of its footage; the agreement bars infringing publicity rights. No splicing, re-timing into new sentences or training. By analogy the same holds for voice. | [hypothesis], extending the music and footage rules to voice | EULA 6.1 and 7(j) (*part*); fan-content page, music and videos (*page*) | all · 2, 4 | **Produce:** a voice reference in S2 names an existing game line id or a pack asset, and the language has no operator that concatenates or synthesises (S19-S2-01). **Check:** the lint. Whether reusing an existing line in a new context is itself a licensed use is not stated; community practice reuses lines in scenes, and I did not verify the publisher's view |
| VOX-06 | **Packs may carry their own recordings with a consent record, and synthetic voices with a provenance record.** A recording names the performer (or a pseudonym), what the performer agreed to, and whether use for training any voice model is allowed (default no). A synthetic voice names the model, its licence and its source, and states that it clones no real person. An undeclared voice is treated as `none`. | [hypothesis], extending the consent norms of VOX-02 and VOX-03; the host's pages say nothing on performer consent | As VOX-02, VOX-03; File Submission Guidelines (*page*, silent on performers) | all · 4 | **Produce:** S19-S4-07. **Check:** field presence; truth cannot be checked. The licence chain of any specific voice product was not read |

### 5.5 Generated text, memorisation and answerability (ETH-18, ETH-11)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| GEN-01 | **Runtime scenes the engine generates are probably nobody's copyright work, and that is fine for private play; what a pack owns is what a human wrote.** On the US Office's reading the engine's selection and arrangement of authored units in play is also not an authored work. This does not change what the engine may do; it changes what an author can claim. | [analysis] (US only, orientation) | USCO Part 2 (*part*) | all · 3, 4 | **Neither.** It informs the manifest's wording (LIC-04) |
| GEN-02 | **A language model can reproduce its training text verbatim, including copyrighted text and, if it was fed it, the game's.** Any model that renders text carries that risk. | [empirical] | Carlini and co-authors (*abstract*): a query-only attacker recovered hundreds of verbatim sequences from a language model; larger models were more vulnerable | all · 3, X | **Produce:** the engine ships no model; a user-configured model is the user's responsibility, stated in the capability's disclosure. **Check:** an overlap review against public and pack text is possible; against game text it meets FAN-06 |
| GEN-03 | **"The generator did it" must always resolve to a person who shipped the generator.** Every text unit carries its pack, author and origin; every generated output carries the engine version, the settings and, if used, the model id. The project writes a short content card for the engine and each pack saying what it can contain and produce, in the style of the reporting documents proposed for models and datasets. | [analysis] for the idea; [hypothesis] for the fields | Raji and co-authors propose documents at each lifecycle stage that check a system against its stated values (*abstract*); Mitchell and co-authors propose short reporting documents with intended use and evaluation (*abstract*); dossier 18 already asks for datasheets (S18-S4-07) | all · 3, 4, P9 | **Produce:** S19-S4-06 and S19-S4-09; the content card is generated from the manifest and the engine's own registry. **Check:** the build refuses a unit with no origin |

### 5.6 Governance (ETH-14)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| GOV-01 | **The project hosts nothing, so the host moderates what is uploaded and the project decides what its loader accepts and what its own packs contain.** If the project ever runs a pack index, moderation by notice, reason and appeal is the bar. Until then the player holds a local disable list. | [practice] for the host's practice; [analysis] for the principles | Santa Clara Principles 2.0 (*page*: notice, appeal and numbers); the host's report and takedown routes (*page*) | all · 4, C | **Produce:** a player-editable list of disabled packs; no network lookup (PLT-06). **Neither** for an index that does not exist |
| GOV-02 | **Keep the contested source material out of the engine package.** The 2005 case turned on content already on the disc; mod makers took the blame for access. D-23 already places explicit source material in packs people write. This adds the reason from the record, and the rule that the engine's registry of classes and ceilings is data without assets. | [practice] | Brathwaite, Game Developer, 2006 (*page*) | all · 4 | **Produce:** the default distribution holds no authored-source material for explicit classes (SHP-01). **Check:** a build check lists the authored-source classes with content present in the default archive; it must be empty |

### 5.7 What ships by default, and what only users add (SHP)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| SHP-01 | **By default the project ships: the engine; a starter pack the project writes, with its named licence, play grant and notice; no game content; no voices; no explicit source material; no network call.** The starter pack plays at the game's own default ceilings and uses the implied or fade form wherever a class has no human-written source. | [hypothesis], composed from FAN-03, FAN-05, FAN-06, PLT-06, GOV-02 and D-23 | The principles named | all · 4, C | **Produce:** the release build's content check (S19-S4-12); **Check:** the build's checks named in each principle |
| SHP-02 | **Only users add: other people's packs (including adult-tagged ones), a voice adapter, a language-model provider with its key or local model, any performer's recording, any network endpoint.** Each is a capability that is off until the player turns it on, with a short disclosure of what it does and who is responsible. | [hypothesis], extending PLT-05, PLT-06, VOX-06 and GEN-02 | As above | C, 3, X | **Produce:** a capability set in the player's settings (S19-S4-12), with closed disclosure copy. **Check:** a default install exercises none |
| SHP-03 | **The engine offers no cloning or training path, and its documentation says so.** What a user adds on their own machine is outside what the project distributes, and the project does not claim control it lacks. | [hypothesis], extending VOX-02 | VOX-02 | all · 3, 4, X | **Produce:** no feature that trains or fine-tunes on audio or on game text. **Check:** a code search finds none (the same style of check as dossier 18's INT-03) |

### 5.8 Dossier 18's hate floor: the reading confirmed, with three corrections

Dossier 18's FLR-03 bars real-world hate content from the system's own voice, treats a character's bigotry as an ordinary authored class, and rests on the publisher's terms "drawn narrowly". Its open question asked whether "offensive" reads as barring a character's bigotry in a mod that ships dark fiction.

**What the text says.** The fan-content rule bars anything "regarding our games that is racist, xenophobic, sexist, defamatory, illegal or offensive" and sits under "Don't hurt us or others". The player-conduct rules say much the same. None of the documents has a carve-out for fiction, defines "offensive", or says who decides. The publisher may change the page with 30 days' notice, and the page says that silence in answer to a request is not agreement.

**What the evidence says.** The two enforcement cases I found concern a real person's likeness (F-01, where the publisher's own words were that content "can't be harmful towards others") and money (F-02). I found no case where fiction alone was the ground. This is an absence in a handful of searches, not proof.

**Reading.** The narrow reading holds: the rule is a standard about harm to people, not a ban on a character having a prejudice. [hypothesis]. The practical argument is also strong: a reading that barred in-fiction prejudice would bar much of what a violent, adult game shows, though I did not check the game's own content for it (open question 8). But the reading is the project's own. Nothing I read guarantees it.

**Corrections.**
1. **Change FLR-03's footing.** It should not say the terms require the floor. It should say: the publisher's list is broad and discretionary; the host's rule is narrower and closer to the floor's shape ("abusive toward real individuals or groups", with a tag for tasteful treatment of real-world issues; hate offences in the terms); the floor is a prudent line for the engine's own voice. The host's rule is the better anchor.
2. **"Sexist" is in the publisher's list.** FLR-03's lexicon and examples should include sex- and gender-based slurs and demeaning stereotypes of real groups, not only race and ethnicity.
3. **The host adds specifics dossier 18 lacks:** Axis-power ideology, changing an NPC's race or gender identity to divide, and a `realWorld` tag (PLT-04). They become pack declarations.

**FLR-02 (real people).** The publisher's real-people rule concerns "real-life brands and people included in our games". It is narrower than FLR-02's "no real, identifiable person". The wider basis is the agreement's privacy and publicity clause (EULA 7(j)), the host's rules, and law I did not read. FLR-02 stands; its footing widens.

**S18-S4-08 (the `real-slur` lexicon).** Nothing I read forbids keeping such a list, and the repository already stores a name it must not print only as a hash (AGENTS.md, "Names people asked us not to use"). My call, as the dossier was asked: the public repository holds a list of normalised, salted hashes; the plaintext list lives only in the maintainers' private extension and in the lint's local build; contributions go through review. A hash list cannot catch obfuscation or inflections the normaliser misses, so the lint is advisory in authored dialogue as dossier 18 already says. [hypothesis].

## 6. Failure modes and critiques

- **Rules move.** In April 2023 AI-generated mod content was "not against our rules"; by July 2026 undisclosed use was moderated. A design that hard-codes today's tags will be wrong. The mapping from the manifest to tags is data (S19-S4-06, S19-S4-08), with a dated terms snapshot.
- **Reading a summary as the text.** Most documents here were read through a summarising tool, and the host's news posts were blocked. A rule I report may be missing a qualifier. The terms snapshot (S19-S4-09) should be checked against the pages before release.
- **The clause that matters most is new and unexplained.** The text-and-data-mining sentence is one line in a long document, with no carve-out and no guidance. It may be aimed at AI training and not at private design research; the text does not say.
- **Declarations are not truth.** Every rights field (authorship, performer consent, no clone, fictional persons) is a statement by the author. The engine can check presence and consistency only. A bad-faith pack is a host and community matter (GOV-01).
- **A watered-down notice.** A notice shown once and never again, or buried, satisfies nothing. The unofficial notice and the credits panel are always reachable.
- **Over-blocking.** A real-world name list and an age-word lint will misfire on legitimate fiction. Both stay advisory except where dossier 18 and PLT-03 make them errors.

## 7. Tensions

| With | Tension | Resolution |
|---|---|---|
| Dossier 18 (floors) | The host's child-character rule reads appearance and "allusions", wider than a declared `ageClass` | S19-S2-02 and the promoted lint (PLT-03) |
| Dossier 21 (words) | A model-written line is cheap; disclosure and memorisation risk follow it | Provenance on every unit; no shipped model (GEN-02, GEN-03) |
| Dossier 16 (authoring tools) | An authoring assistant that writes pack text makes the pack AI-assisted | The manifest's `ai` block is filled by the tool where it can (S19-S4-06) |
| Dossier 23 (evaluation) | Calibrating lints and measuring bias on the game's own text | FAN-06: keep outputs, not corpora; ask for permission |
| Dossier 11 and S0 (saves) | A removed pack must not break a save | PLT-07 and S19-S2-03 |
| Players' freedom to record and stream | A non-commercial pack licence can bar a monetised stream | The play grant (LIC-02) |
| Accessibility | A blanket ban on synthetic speech would remove screen-reading-style uses | The floor is on cloning, not on synthesis (§2.3) |

## 8. Lateral links

- A pack's rights block is the same idea as a **datasheet** in dossier 18 (S18-S4-07): a short document that travels with the data and says what it is, where it came from and what it is for.
- The play grant is the same idea as the **players' tools** in dossier 18 (§5.6): a convenience declared up front, so nobody needs to ask.
- Withdrawing a pack is the same problem as **retiring content safely** in the community-credits note on quest editors, and as the unattended ending in dossier 9: the world must continue when a part disappears.
- The hash-only lexicon is the same pattern as the repository's own hash-only treatment of a name it must not print.

## 9. Models the engine could run

### 9.1 The voice declaration

```text
audio:
  kind: none | game | pack-recorded | synthetic
  game:          lines are GameRef ids only
  pack-recorded: performer (name or pseudonym), consent: { scope, trainingAllowed: false }, file
  synthetic:     model id, licence, source, cloneOf: none        # anything else is refused
```

### 9.2 The pack rights block

```text
rights:
  licence:     SPDX id | custom (text file)
  permissions: { modify, redistribute, reuseAssets, creditText }
  playGrant:   recording-and-streaming | recording | private-only
  price:       free
  gameAssets:  none                       # structural, checked by the build
  persons:     fictional: true            # as dossier 18
  realWorld:   none | tagged
  ai:          { generated[], assisted[], media }   # derived tags, unit origins
  authors:     named; contact route
  terms:       { fanContent, eula, userAgreement, host }  # dates checked against
```

### 9.3 The default-install checklist

A release build passes if its content check finds: no game-derived file; no authored-source material for explicit classes; no audio; no model; every pack (the starter one) with a complete rights block; and a default run opens no network connection.

## 10. Walk-throughs

### 10.1 A third-party pack with an explicit scene and a recorded voice

An author submits a pack with one scene in an authored-source class, its fade partner, and a recording of the author reading two lines. The manifest declares `authored: human`, the licence `CC-BY-4.0`, `playGrant: recording-and-streaming`, `audio: pack-recorded` with the author as performer and `trainingAllowed: false`, `price: free`. The envelope reaches the top of `sex.explicit`, so the pack tool suggests the host's adult tag. The loader accepts it. The default ceiling is the game's, so the scene plays unless the player lowers it, and the fade plays otherwise. The notice and the credits show. If the pack is removed, the seed's stored document runs on and the `ContentRef` falls back to the implied form.

### 10.2 A pack that declares a cloned voice

A pack declares `synthetic` with `cloneOf` naming a game actor. The build refuses it with a plain message: the engine does not support cloning a real person's voice. The author can remove the voice (text plays) or record their own.

### 10.3 A streamer

A player streams a session with monetisation on. The pack's play grant allows it; the starter pack's does. A pack under a non-commercial licence with `playGrant: private-only` shows its restriction on its page, so the player knows before enabling it.

### 10.4 A calibration run

A lint is calibrated against the game's text. Under FAN-06 only the thresholds and counts are kept; the extracted text stays in a private folder and does not enter the repository or any archive. If the maintainer wants the analysis to be clearly allowed, the way to ask is the publisher's legal address.

## 11. Open questions

1. **Is the companion process "software that works alongside the games" or "a standalone product"?** The text does not say. The maintainer decides whether to ask the publisher (FAN-02). The bridge chat's own route may have already settled it for XF Core.
2. **Does the User Agreement's text-and-data-mining clause reach private design research, lint calibration and overlap checks on game text?** **Settled by the maintainer ([D-24](../decisions.md)):** reading and analysing game data for modding is normal modding, which the publisher endorses; the line is commercial use. FAN-06 is read accordingly: corpus work for modding continues, nothing is sold, and packs refer to game content by id.
3. **What tag does the engine itself take on the host?** It contains no explicit material, but it handles adult classes; and if it ships a language-model path, "AI-Generated Content" may apply. Ask the host's moderators when the page is drafted.
4. **How does the host read "sociopolitical mods relating to the USA" for a fictional North American polity?** Ask before a pack that depicts it politically.
5. **Does a data-protection regime attach to a free, local mod, and do exports change that?** Dossier 12's PRV-06; not researched here.
6. **Which licence does the starter pack take?** A project decision. I would offer `CC-BY-4.0` first, because it raises no question about monetised streams (LIC-02) and is simple to credit.
7. **Does shipping a language-model or voice adapter make the project a "provider" under the EU Act, with a marking duty?** The Official Journal text and the Commission's guidance were not read.
8. **How does the base game itself treat bigotry in fiction?** A game-substrate question (P2), to ground FAN-07's reading.
9. **Is reuse of an existing game line in a new scene within the publisher's terms?** The terms do not say; community practice does it. Not verified.
10. **Is the publisher's grant request automatic?** The page asks "kindly", and secondary accounts say it applies by creating. I do not know how it would be tested.

## 12. Testing agenda

| # | Test | Expected |
|---|---|---|
| T-01 | Build a pack with no `licence`, `permissions` or `playGrant` | Refused with one plain message per missing field |
| T-02 | Build a pack with a game text or audio payload in a content slot | The schema offers no slot; a file with a known game hash is refused if a hash list exists |
| T-03 | Build a pack declaring a clone voice | Refused |
| T-04 | A pack with units marked both `generated` and `authored: human` | Refused as inconsistent |
| T-05 | Default install, 10-minute run | No network connection; no model or voice loaded |
| T-06 | Remove an installed pack mid-run | Every open seed closes or continues; no stall |
| T-07 | Pack with a `minor` person in an `exploit.labour` role | Error (S19-S2-02) |
| T-08 | Release content check on the default archive | No game-derived file; no authored-source explicit material; no audio |
| T-09 | Compare terms snapshot to the live pages' dates before release | Differences listed for review |

## 13. Requirements

### 13.1 S2 (the language and its lints)

| # | Requirement | Traces to |
|---|---|---|
| S19-S2-01 | **Voice references name existing lines.** A `voice` reference on a text unit is a `GameRef` to an existing line id or a pack asset id. The language has no operator that concatenates, re-times or synthesises speech. A reference to anything else is an error | VOX-05 |
| S19-S2-02 | **Extend L-95.** A person with `ageClass: minor`, or one whose description contains child-coded words, is barred from `exploit.*` roles as well as `sex.*` roles. The age-word lint (L-107) beside any `sex.*` or `exploit.*` tag is an error, not a warning | PLT-03 |
| S19-S2-03 | **Unresolved content falls back.** A `ContentRef` that no active pack resolves plays the unit's `implied` form or a neutral placeholder, logs a neutral entry, and never stalls the seed. A fixture covers pack removal mid-run | PLT-07 |
| S19-S2-04 | **No game payloads.** A content reference to the game is a `GameRef` (kind, id). No text unit, asset or fragment may hold game text or audio inline. A pack-build check lists any unit whose text matches a published overlap list (advisory) | FAN-05 |
| S19-S2-05 | **Origin consistency.** Each text unit carries `origin: authored \| assisted \| generated`. A unit with `origin: generated` cannot satisfy `authored: 'human'` (L-97), and cannot occupy an authored-source class slot | LIC-04, PLT-05, D-23 |
| S19-S2-06 | **Real-world entity review (advisory).** A name-collision list (dossier 18) and a pack's `realWorld: tagged` declaration; a tagged pack's units mentioning a flagged entity are listed for review, never edited | PLT-04 |

### 13.2 S4 (pack manifests: rights, licence, attribution, content declarations)

| # | Requirement | Traces to |
|---|---|---|
| S19-S4-01 | **Licence.** Required `licence`: an SPDX identifier from a short allowed list, or `custom` with a licence text file and the permissions block. A pack with no licence is refused. `copyright` holders named | LIC-01 |
| S19-S4-02 | **Permissions block.** `modify`, `redistribute`, `reuseAssets` (each `yes`, `ask` or `no`) and `creditText`. Tools that bundle, extend or fork packs honour it | PLT-01 |
| S19-S4-03 | **Play grant.** Required `playGrant`: `recording-and-streaming`, `recording` or `private-only`. Shown on the pack's page and at enable | LIC-02 |
| S19-S4-04 | **Price.** `price: free` is the only accepted value. The format has no field for payment, unlock keys, subscriptions or tiered content. At most one donation link, shown as such | FAN-03 |
| S19-S4-05 | **Rights declarations.** `gameAssets: none` (checked by the build), `persons.fictional: true` (as S18-S4-03), `realWorld: none \| tagged` | FAN-05, PLT-04, VOX-05 |
| S19-S4-06 | **AI and origin.** Per-unit `origin` (authored, assisted, generated) and per-asset `source` and `licence`. A pack-level `ai` block lists generated and assisted parts and any AI media. The pack tool derives the host's recommended tags from it; the mapping is data, with a version | PLT-05, LIC-04, GEN-03 |
| S19-S4-07 | **Voice declaration.** `audio.kind` of `none`, `game`, `pack-recorded` or `synthetic` (extends S18-S4-03). `pack-recorded` requires a performer, a consent scope and `trainingAllowed` (default `false`). `synthetic` requires a model id, a licence, a source and `cloneOf: none`. A clone declaration is refused; an absent one means `none` | VOX-01, VOX-02, VOX-06 |
| S19-S4-08 | **Host tag suggestion.** The content envelope (S18-S4-03), the `ai` block and `realWorld` produce a printed list of the host's tags to set. The list is advice; the author decides. The mapping is versioned | PLT-02, PLT-04, PLT-05 |
| S19-S4-09 | **Terms snapshot, authors and contact.** `terms`: the dates of the fan-content page, the agreement, the User Agreement and the host guidelines the pack was checked against. Named authors and a contact route. A release checklist compares the snapshot to the live pages | FAN-01, GEN-03 |
| S19-S4-10 | **Unofficial notice.** The build injects the notice; it is shown at enable, in settings and in the credits panel, and is not an authored field | FAN-04 |
| S19-S4-11 | **Credits and exports.** An in-app credits panel generated from manifests. Any export writes an aggregated credits and licence block. By default nothing exports pack text; a combined export of packs with a ShareAlike licence and an incompatible one warns | LIC-03 |
| S19-S4-12 | **Capabilities and the default content check.** Settings hold capabilities that are off by default: voice adapter, language-model provider, network endpoint, each with closed disclosure copy. The release build's content check (no game-derived file, no explicit authored-source material, no audio, no model, no default network call) is a build step. The `real-slur` lexicon (S18-S4-08) is stored in the public repository only as normalised, salted hashes | PLT-06, SHP-01 to SHP-03, §5.8 |

## Corrections after reading

| Source | What the lens or map said | What the source shows |
|---|---|---|
| Map ETH-17 and lens L10, "GGRecon, 7 July 2023 (read)" | A GGRecon article of that date | The 7 July 2023 article I read is by Imogen Donovan at NME. The GGRecon piece I read is by Joseph Kime, 13 October 2023, on the cloned actor in the studio's own game |
| Lens L10 field 21, the fan-content page "leaves ownership with the creator while granting the company a broad licence" | A grant | The page "kindly" asks creators to give the licence from the moment of creation, "in connection with our games" |
| Lens L10 field 21, "it says nothing about AI-generated or sexual content as such" | | Confirmed for the fan-content page. The User Agreement (August 2026) does reach AI-adjacent activity through its text-and-data-mining clause (FAN-06), which the lens did not have |
| Map ETH-16, "Reports on CDPR's January 2026 DMCA takedown [sec]" | A secondary report | Read at Hitmarker (20 January 2026): the publisher's business-development vice president announced it on social media; the rule cited was the fan-content ban on monetising without permission |
| Map ETH-17, Nexus tagging guidelines "week of 31 July 2026" | A press report | Confirmed by Shacknews (31 July 2026, TJ Denzer). The tag definitions are in the host's File Submission Guidelines (updated 20 October 2026), which add that moderators apply the AI-Generated tag to mods that are primarily AI-generated, and that the AI Assisted tag needs evidence of development history |
| Dossier 18 MM-9, "Nexus Mods post (summary)" | A search summary | Read through Sam Sepiol, Insider Gaming, 1 July 2025: age verification for UK and EU users, planned tags, automated detection of child abuse material with reporting. The host's own post was not opened |
| Dossier 18 FLR-02, the publisher's terms "allow real people and brands from the games only with permission" | | Accurate to the page, and narrower than FLR-02's rule; the wider basis is in §5.8 |

## Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Text-and-data-mining law and rights reservations** (EU and UK exceptions; terms of service as an opt-out) | The publisher's User Agreement, point 25 (page); search summaries of the general framework (not opened) | Supporting under ETH-18; decides FAN-06. Worth one targeted lens |
| MM-2 | **Right of publicity and personality-rights law**, and sound-alike disputes | EULA 7(j) (part); the CC deed's carve-out for publicity rights (page). No statute or case opened | Supporting under ETH-17; legal, orientation only |
| MM-3 | **Terms-of-service versions as dependencies** (tracking changes in the documents the project relies on) | The fan-content page's 30-day change clause; the dated pages in §3 | Peripheral; an engineering checklist item (S19-S4-09) |
| MM-4 | **Voice-synthesis model and voice licensing** (licences of voices and models, consent behind trained voices) | None read | Supporting under ETH-17; needed before any voice adapter is built |
| MM-5 | **Mod-host permission systems as de facto licensing** (per-file permissions, credit and the limits of "credit is not permission") | File Submission Guidelines (page) | Supporting under ETH-14 or ETH-18; it shapes the pack format, so I would lift it to core for dossier 16's successor |
| MM-6 | **Rating-body treatment of mods** | Brathwaite, Game Developer, 2006 (page) | Peripheral; adds evidence to ETH-15 |

## Credit candidates

Each third-party work that taught us something used in the principles above. "Page" means a web page read through a summarising fetch tool. Creator names are as the pages show them. The publisher's documents, the host's terms, the EU Act, the US Copyright Office report and the Creative Commons and SPDX pages informed the principles but are terms, statutes and reports, not credits. Gillespie and Friedman and Hendry taught nothing here and are not listed.

| Creator as evidenced | Work | Link | What we learned | Link status |
|---|---|---|---|---|
| Stefan L | "Cyberpunk 2077 Keanu Reeves joytoy sex mod taken down after CD Projekt Red objects", The Sixth Axis, 28 January 2021 | https://www.thesixthaxis.com/2021/01/28/cyberpunk-2077-keanu-reeves-joytoy-sex-mod-taken-down-after-cd-projekt-red-objects/ | The publisher's stated rule that user content "can't be harmful towards others", applied to a real person's likeness in explicit scenes | page; ready |
| Hitmarker (no author named) | "CD Projekt RED issues DMCA takedown against paid Cyberpunk 2077 VR mod", 20 January 2026 | https://hitmarker.net/news/cd-projekt-red-issues-dmca-takedown-against-paid-cyberpunk-2077-vr-mod-1624038 | The fan-content ban on monetisation was enforced against independent software, with free-plus-donations offered as the way back | page; ready |
| Imogen Donovan | Report on voice actors and AI voice mods for Skyrim, NME, 7 July 2023 | https://www.nme.com/news/video-game-voice-actors-denounce-nsfw-mods-ai-deepfakes-voices-3466276 | Actors objected to cloned voices in explicit mods; the host's stated stance then was that AI-generated mod content was not against its rules | page; ready |
| Donovan Erskine | "Cyberpunk 2077 used AI to replicate the voice of a deceased voice actor", Shacknews, 12 October 2023 | https://www.shacknews.com/article/137388/cyberpunk-2077-ai-voice-actor | The studio's cloned voice had the family's support, and the localisation director said the team "didn't like this approach" | page; ready |
| Joseph Kime | "Cyberpunk 2077 confirms using AI to replace dead voice actor", GGRecon, 13 October 2023 | https://www.ggrecon.com/articles/cyberpunk-2077-confirms-using-ai-to-replace-dead-voice-actor | The same case; the actor himself could not consent, which the piece calls a grey area | page; ready |
| TJ Denzer | "Nexus Mods announces updated guidelines on generative AI tagging and moderation", Shacknews, 31 July 2026 | https://www.shacknews.com/article/150216/nexus-mods-gen-ai-tagging-moderation | The three AI tags, and that mis-tagging is moderated and deliberate abuse punished at once | page; ready |
| Sam Sepiol | "Nexus Mods plans to add age verification for adult mods in UK and EU", Insider Gaming, 1 July 2025 | https://insider-gaming.com/nexus-mods-plans-to-add-age-verification-for-adult-mods-in-uk-and-eu/ | The host keeps adult content, verifies the age of UK and EU users, plans new tags and detects child abuse material automatically | page; ready |
| Jeremy Fuster | "SAG-AFTRA Video Game Deal Includes AI Consent Guardrails, Minimum Rates for Digital Replica Use", TheWrap, 12 June 2025 | https://www.thewrap.com/sag-aftra-video-game-deal-details/ | Informed consent for AI use of performers' voice and likeness, and a minimum of 7.5 times scale for real-time generation | page (a secondary account); ready |
| Brenda Brathwaite | "Hot Coffee's Effects on the Mod Scene", Game Developer, 27 October 2006 | https://www.gamedeveloper.com/business/hot-coffee-s-effects-on-the-mod-scene | Content already on the disc led to blame on mod makers, a rating change and a chilling effect on harmless mods | page; the byline reads "Brenda Brathwaite, Blogger"; ready |
| Nicholas Carlini, Florian Tramèr, Eric Wallace, Matthew Jagielski, Ariel Herbert-Voss, Katherine Lee, Adam Roberts, Tom Brown, Dawn Song, Ulfar Erlingsson, Alina Oprea and Colin Raffel | "Extracting Training Data from Large Language Models" | https://arxiv.org/abs/2012.07805 | A query-only attacker could recover verbatim training sequences from a language model, and larger models were more vulnerable | abstract; ready |
| Inioluwa Deborah Raji, Andrew Smart, Rebecca N. White, Margaret Mitchell, Timnit Gebru, Ben Hutchinson, Jamila Smith-Loud, Daniel Theron and Parker Barnes | "Closing the AI Accountability Gap: Defining an End-to-End Framework for Internal Algorithmic Auditing" | https://arxiv.org/abs/2001.00973 | Internal audit documents at each lifecycle stage, checked against stated values, narrow the gap in accountability | abstract; ready |
| Margaret Mitchell, Simone Wu, Andrew Zaldivar, Parker Barnes, Lucy Vasserman, Ben Hutchinson, Elena Spitzer, Inioluwa Deborah Raji and Timnit Gebru | "Model Cards for Model Reporting" | https://arxiv.org/abs/1810.03993 | Short reporting documents with intended use and evaluation accompany a model | abstract; ready |
| The Santa Clara Principles coalition (Access Now, ACLU Foundation of Northern California, ARTICLE 19, Electronic Frontier Foundation and others, as the page lists them) | Santa Clara Principles on Transparency and Accountability in Content Moderation, version 2.0 | https://santaclaraprinciples.org/ | Notice, appeal and numbers as the bar for moderation by notice | page; ready |
