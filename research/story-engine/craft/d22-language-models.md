# Dossier 22: language-model narrative

**Status:** v1, 23 October 2026. Dossier 22 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core field: SEL-11 (language-model narrative: failure modes and hybrid architectures). Supporting field: ETH-10 (generative-text safety engineering). Feeds P8 (realisation and expression), P5, the seeding layer S2 ([spec](../spec/seeding.md)), the rendering layer S7 and the runtime placement P7. It serves quality bars 1, 3, 4, 6, 9 and 10 ([plan §1](../plan.md#1-what-doesnt-suck-means)). Decisions in force: D-09 (V is observed, never owned), D-21 (first-party concepts; outside work is comparison only), D-22 (NPC attribution lines), D-23 (author-fill seams), D-24 (reading game data for modding is normal modding) and the voice plan of S2 §2.20. I did not read anything under `research/runtime/live-dm/`, ran no heavy job, **ran no language model**, and read no game text. Every claim about how a model would behave on this engine's briefs is therefore a [hypothesis] to be measured (§11); what I report as measured is what the cited papers report about their own tests.

**How far each source was read.** *Text* means I read the paper or page in the part named. *Abstract* means the arXiv or proceedings abstract, fetched through a summarising tool, so its wording is paraphrase and I report only what it states. *Page* means a web page read through a summarising fetch tool. *Summary* means a search-engine summary. *Lens only* means I rely on a lens file and did not re-open the source. *Not retrieved* means I tried and could not read it. §3 lists every source with its level, and §3.3 says where a lens or map claim did not survive. Many of the benchmark papers are 2026 preprints (the map says so too); they are indicative, not settled.

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **[J]** marks a judgement value: a starting number I chose, to be replaced by a measurement. **contested** marks a claim two sources dispute. Example lines in this dossier are invented for it and are never content.

## In brief

- **The boundary is three questions, and a model may answer only the third.** *What* is said (the facts, their order, who speaks, to whom, in which channel and form) is fixed by layers 1 to 3 from the record. *Whether and when* it reaches V is the arbiter's. *How it is worded* is S7's, and only there may a model sit, after the facts are fixed. Nothing flows back: words are never parsed into facts, so a fragment's `leaves` write the same effects whatever the words say (LMB-01, LMB-02). A model never plans, decides an outcome, invents a fact, reads or writes the world state, touches the director's model of V, or speaks for V (LMB-03 to LMB-06). The evidence for keeping state out of the model is the strongest in the field: every consistency benchmark I read reports drift when state lives in prose (LME-01 to LME-03).
- **A model's output is data before it is input, so a reload shows the same words.** Model output is not reproducible, even with "deterministic" settings (Atil and colleagues; He). So the engine never regenerates. A model call is a layer-2 draw whose value is text: it is recorded when the delivery is released, it is immutable from then on, and a reload reads the record (LMD-01 to LMD-04). The structural trace (casts, draws, transitions, delivery ids) never reads the words or whether a model ran, so it is bit-identical with the model off, on, or returning any other lint-passing strings. That is a testable property (LMD-06, LMD-07). With no model the engine is complete: every model-eligible unit has a model-free form that leaves the same facts (LMD-05).
- **Safest use first: the model as a phrasing author, not a live narrator.** Two modes. **T** (phrasing author) runs at idle times or at pack install, writes new phrasings *with typed slot markers* from an authored source, passes the same gates and lint as authored text, and enters the engine as stored data. Run time is then plain template realisation, which is deterministic and fast. **R** (per-delivery render) writes a line for one queued delivery, ahead of its release, and persists it. Mode T also has the best privacy: its brief holds pack text and slot markers, never the playthrough (LMB-08, LMR-05).
- **Fidelity is engineered, not hoped for.** Open models writing from structured data produced at least one semantic error in more than 80 per cent of outputs in one 2024 study (Kasner and Dušek). So no ungated text reaches V. The model writes a template and the engine fills the values, so a name, count or time is never typed by the model. Then a closed-world check (no numerals, no unknown proper nouns, no quotation marks, no causal connectives without an atom), a coverage check, a two-way entailment check, a polarity check (models skew positive: Tian and colleagues) and the same lint as authored text. Anything that fails after two tries is replaced by the template form, never hand-repaired (LMF-01 to LMF-09).
- **Local first, service optional, off by default; the arbiter never waits.** The arbiter runs once a second on play time and a message may wait up to thirty minutes of play (S2 §2.12, §8.2). So model work happens ahead of release, at low priority, and fast channels (barks, ambient chat, calls) use pre-written or pre-generated pools and never wait on a model. Cost is per released delivery, not per character per tick: one 2023 study of 25 agents over two days reports token costs of "thousands of dollars" (Park and colleagues). Privacy follows D12: nothing about V leaves by default, and a remote service gets Mode T only unless the player opts in per session with a viewer of what is sent (LMR-01 to LMR-07).
- **Rights follow provenance.** A model line is `origin: generated` per instance, can never fill an authored-source slot (D-23), carries a record of the model, settings and brief hash, is never voiced by cloning (S2 §2.20), and is never built from game text (LMP-01 to LMP-08). Hosts now require disclosure of generated dialogue (D19 PLT-05), and a store I read requires a description of guardrails for any AI that runs while the game is played (Steamworks). So the model path ships as a separate optional add-on with no weights.
- **The evidence on commercial and modded model-driven NPCs is thin.** I found documentation, vendor claims and one press account of AI Dungeon, but no postmortem, no measured hallucination rate and no player study for Inworld, Convai or the modded companions. Where products document their structure, the author-defined graph decides and the model speaks: Convai's sections and triggers are authored (LME-05). The grade for most product claims is therefore [shipped] at best, weak, and [hypothesis] for what they imply for us.

## 1. Scope and why it matters here

The plan fixes one rule for expression: generated text renders fine detail and never plans ([plan §2](../plan.md#2-the-system-at-first-level)). This dossier makes that rule exact for this engine. It decides where a language model may sit in the pipeline, where it may not, how its output is made stable across reloads, how its claims are checked against the record, how it runs on the player's machine or as a service, and what its use does to rights and disclosure. It is also the place where the evidence about language models in interactive narrative is graded in one table (§2, §4 F).

| Layer or concern | What this dossier gives it |
|---|---|
| 1. Simulation (S0, S1) | Nothing new in the kernel. The model has no kernel access. It asks S1 for no extra data beyond what dossier 21 already asked (common ground, `witnessed` and `told` sets) |
| 2. Seeding (S2) | A `modelOk` field with a mode, an `aiUse` permission, two invariants (S2-I-15 words do not steer; S2-I-16 released words are immutable), a render ledger in the persisted state, and new lint (§12.1) |
| 3. Procedural engine (S3, P5) | Nothing. The director's hooks read no model state and the model reads no hook output (S2-I-13, S2-I-14) |
| 4. Authored content (P6, S4) | The pack's rights to say no (`aiUse`), the brief schema authors write against, exemplars, voice cards compiled for a model, and the classes where a model is barred (§5.1) |
| Realisation and rendering (S7, P8) | A model adapter, a brief builder, a gate pipeline, a pre-render queue, a ledger writer, a stub, a tape and a qualification run (§5, §12.2) |
| Runtime (P7) | A runner process, resource caps and watchdog, a no-socket default, lazy warm-up and crash isolation (§12.3) |
| Evaluation (E) | Fourteen measures (§7) and a testing agenda in which the gates are tested without a model (§11) |
| Player configuration (C) | Off, local or service; per-class and per-pack switches; a kill switch; origin shown in Details (LMR-06) |

**What it does not cover.** What the words should be like when they are good (dossier 21, used as given: voice cards, frames, channel budgets, lint L-119 to L-130). Rights and platform rules in general (dossier 19, used as given). Content ceilings and floors (dossier 18, used as given). The player model (dossier 12, used as given: the model never enters a brief). Authoring tools in general (dossier 16). Voice synthesis and recordings (S2 §2.20 and dossier 19 VOX). Using a language model as a *sifter* or as a *planner* is out of scope and is excluded (LMB-04); dossier 6 records the little evidence there is (S-07).

**What is already settled and used as given.**
- **The plan's boundary** (plan §2): generated text renders detail; it never does the planning.
- **S2 §2.19, author-fill seams (D-23):** model-driven tools do not write source material for authored-source classes; every such fragment has a non-explicit partner, so "model-written content always has a form it can produce".
- **S2 §2.20, origin:** `authored`, `assisted`, `generated`; a `generated` unit can never satisfy `authored: 'human'` or fill an authored-source slot (L-116).
- **S2 §2.22, words:** every non-colour phrasing reads the record (L-128); quotes and causes are claims (L-58 extended); V has no voice card; the option label list is closed; attribution lines use a fixed frame.
- **S2 §3.4 and §12.1:** a layer-2 draw is recorded in the instance's state and "a reload re-uses it rather than drawing again". This is the shape of the answer to reload stability.
- **S2 §8.8 and S2-I-13, S2-I-14:** the model of V has no entrance into seeds; hooks receive a closed list of inputs.
- **D12 PRV-01:** local by default; nothing about V leaves the machine; no model feature goes to a remote model. **D19 PLT-06, SHP-02, SHP-03:** no network call by default; a language-model provider is a capability off until the player turns it on; no cloning or training path.

## 2. The failure record

Failures come first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses the patterns, §2.3 lists where the literature's own advice fails.

### 2.1 Cases

| # | Case | What was tried | What went wrong | Evidence |
|---|---|---|---|---|
| F-01 | **AI Dungeon (2019 to 2021)** | A text adventure on a GPT-2 and then GPT-3 model, open to any input | The press account I read reports sexual content generated unprompted, including content involving minors, which it traces to scraped training stories. A later filter blocked harmless text (the example is "four watermelons"). Players were suspended for text the model wrote, and objected to the moderation of unpublished stories, fearing that people read them. The developer later said unpublished single-player content would no longer be moderated and that technical barriers would stop certain generation, with no human review. The supplier required better filters. Earlier, a humanities study of the GPT-2 version reports stories that "devolve into nonsense", a model that kept treating a player as human, and players who revert, edit and re-state facts by hand to hold the story together | *Page* (The Register, 8 October 2021); *Text, first 100,000 characters* (Hua and Raley, DHQ 2020). [shipped], [practice]. I found no developer primary source |
| F-02 | **Generative agents (Stanford, 2023)** | 25 model-driven agents in a small town with memory, reflection and planning | The authors report retrieval failures; embellishment (an invented "announcement tomorrow"); 6 of 453 answers about knowing other agents hallucinated (1.3 per cent); worse place choice as agents learned more places; misread physical norms (entering an occupied single-person bathroom, entering shops after closing); instruction-tuned habits (overly formal speech, overly cooperative agents who adopt others' interests); and a cost of "thousands of dollars" in tokens for 25 agents over two days, which limits real-time use. Prompt and memory hacking were not tested | *Text, first 100,000 of about 144,000 characters* (Park and colleagues, §6.5.2, §7.1.2, §7.2, §8.2). [empirical] |
| F-03 | **Commitments lost over turns** | Models as narrator against a structured specification of facts and commitments | One benchmark of 100 environments built from movie synopses reports that the best model tested kept its commitments in only 42 per cent of runs after 20 turns, with fact-conflict rates from 40 to 68 per cent across models, and that fluent text does not guarantee that commitments are kept. A second benchmark (2,000 prompts) finds long-story inconsistencies concentrate in factual and temporal details, cluster mid-narrative and occur more in high-entropy segments. A third separates sustained generation, canonical coherence and meaningful development, and reports that scale mainly improves the first | *Abstract* each (Ma and colleagues, ICML 2026; Li and colleagues, ACL Findings 2026; Chen and colleagues, 2026 preprint). [empirical], indicative |
| F-04 | **Semantic errors in data-to-text** | Open models (Llama 2, Mistral, Zephyr) write text from structured records | Per human annotators and a reference-free GPT-4 metric, more than 80 per cent of outputs contained at least one semantic error. An earlier neural system on a long-document data-to-text task wrote fluent text but failed to approximate human documents, and simple templates beat it on some metrics | *Abstract* (Kasner and Dušek, ACL 2024); *Abstract* (Wiseman and colleagues, EMNLP 2017). [empirical]; the models are 2023 and earlier |
| F-05 | **Homogeneity** | Models write stories, essays and characters | Model stories skew uniformly positive and lack tension (Tian and colleagues). In a controlled experiment with 293 writers and 600 evaluators, writers given model ideas wrote individually better stories that were more alike (similarity up by about 10.7 and 8.9 per cent of the range, for one and five ideas); a second study found less diverse essays for one tuned model, not for another; a 2026 paper reports that model-generated characters are "behaviorally homogeneous" and mostly agree with positive moral norms | *Abstract* (Tian, EMNLP 2024); *Page* (Doshi and Hauser, *Science Advances* 2024); *Abstract* (Padmakumar and He, ICLR 2024); *Abstract* (Qraitem and colleagues, 2026 workshop). [empirical] |
| F-06 | **Drift over turns** | Chatbots held to a system prompt for a whole dialogue | Instruction drift appears within eight rounds for popular models in one study; another reports a 39 per cent average drop from single-turn to multi-turn across six tasks, mostly as unreliability, with models that take a wrong turn not recovering | *Abstract* (Li and colleagues, COLM 2024; Laban and colleagues, 2025 preprint). [empirical] |
| F-07 | **"Deterministic" settings are not** | Five models, eight tasks, ten runs each, set to be deterministic | No model was consistently repeatable across tasks and identical output strings were rare. A served model at temperature zero gave 80 distinct completions in 1,000 identical runs, because the same request ran under different batch sizes; batch-invariant kernels made all 1,000 match, at a cost of speed | *Abstract* (Atil and colleagues, 2024); *Page* (He and colleagues, Thinking Machines, 10 September 2025). [empirical] |
| F-08 | **Filters over-block and under-block** | Ban words, add classifiers | Models can degenerate into toxic text from innocuous prompts, and "no current method is failsafe" (the authors, 2020). The AI Dungeon filter blocked harmless text (F-01). Heavy tuning produces the opposite fault: agreeable, assistant-like characters (F-02, F-05) | *Abstract* (Gehman and colleagues, Findings of EMNLP 2020); F-01; F-05. [empirical], [shipped] |
| F-09 | **Format constraints cost accuracy** | Force structured output (JSON, XML) | One preprint reports a significant decline in reasoning under format restrictions, larger for stricter formats. The tasks tested were reasoning tasks, not slot-filled wording | *Abstract* (Tam and colleagues, 2024 preprint). [empirical], narrow |
| F-10 | **Rules change after the fact** | Platforms' stance on generated content | In April 2023 a mod host said generated mod content was "not against our rules"; by July 2026 it required tags for generated dialogue and other content (D19 F-03, F-06). A store now requires developers to describe the guardrails on any AI that generates content while the game runs, and does not currently allow live-generated adult-only sexual content | *Via D19*; *Page* (Steamworks Content Survey). [practice] |
| F-11 | **Model-driven NPCs in mods are fragile and heavy** | A speech-to-text, model and speech pipeline for Skyrim and Fallout 4 | The project's README warns that its development version is "prone to error". A listing says it needs about 20 GB of disk if all voice models are installed, and one press test of the VR version reported noticeable latency. These are the only facts I have: no measured latency | *Page* (README excerpt); *Summary* (listing; press). [shipped], weak |
| F-12 | **A thin evidence base for commercial NPC products** | Inworld and Convai sell model-driven characters | I found vendor marketing, directory pages and one voice-model press item, and no studio lessons, postmortem or measured hallucination rate. Convai's documentation shows its narrative layer is an author-defined graph | *Page* (Convai docs); *Summary* (Inworld, third-party pages). [shipped], weak |

### 2.2 What the failures have in common

1. **State lived in the text** (F-01, F-02, F-03). Where the model's own prose was the world's record, facts and commitments drifted, and players or developers hand-built a ledger (Hua and Raley's players revert, edit and re-state facts). The common fix in the papers is an external structure that the generator consults.
2. **The model's habits show through the character** (F-02, F-05, F-08). Agreeableness, positivity, formality and sameness are properties of the model, so they are the same in every speaker.
3. **Fluency hides error** (F-03, F-04). Surface quality did not predict consistency or semantic accuracy in any benchmark read here.
4. **Output cannot be replayed** (F-07). A system that reloads from a seed will find different words, so reloads need a record.
5. **Governance was added after launch** (F-01, F-10). A filter on output, a policy after the fact. The engine's own floors are structural (S2 §2.19), and this dossier keeps them so.
6. **Cost and latency rule out per-character use** (F-02, F-11).
7. **The best evidence is narrow and young** (F-03 to F-09). It covers short texts, specific models and 2023 to 2026 versions, and none covers a live open-world game with a record under it.

### 2.3 Where the advice itself fails

- **"Ground the model in the world state at every call"** (the lens's first principle, LME-01) fails if the grounding is retrieval from prose, as in F-02. The engine's grounding is a closed brief of atoms and slot markers, not retrieval. I do not know of a study that tests that.
- **"Let the model propose and the symbolic layer verify"** (the lens) assumes the verifier is good. The verifier for relations (who did what to whom) is itself a model-based check, with the error rates of F-04 unmeasured for it here. The weaker form is the one used: verify the cheap things deterministically, verify relations with an entailment check, and restrict the classes where a missed error would hurt (LMB-07).
- **"Pre-generate offline for rare, high-value seeds"** (the lens) is right for Mode T and wrong for Mode R if read as "generate the whole quest": the plan keeps planning out of the model entirely.
- **"Structured intermediate representations improve steerability"** (StoryVerse) is a claim about *plot* steering with a model as planner, shown as a proof of concept with examples. Here the representation exists (the seed), but it is executed by deterministic code, not by a model.
- **Constrained decoding "guarantees structure"** (Willard and Louf) guarantees *form*, not meaning. A well-formed template can still say the wrong thing (LMF-04, LMF-05).
- **"A bigger model fixes it."** Scale did not reliably improve canonical coherence in the one benchmark that tested it (F-03), though it helped sustained generation. The design must not depend on it.

## 3. Sources

### 3.1 Read

| Source | Level | What I used |
|---|---|---|
| Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris, Percy Liang, Michael S. Bernstein, "Generative Agents: Interactive Simulacra of Human Behavior", arXiv 2304.03442 (v2, 6 August 2023; UIST 2023 per the map and lens, which I did not confirm; the arXiv page names no venue) | Text (first 100,000 of about 144,000 characters, via ar5iv) and abstract page | The reported errors and limits in F-02; the architecture (memory in natural language, reflection, planning) as a comparison only |
| Yingpeng Ma, Jianhao Yan, Bei Shi, Ka Hou Kam, Runnan Wang, Xuebo Liu, Yulong Chen, Yue Zhang, Derek F. Wong, "Can LLM Agents Stick to the Script? A Benchmark for Long-Horizon Consistency in Interactive Narratives", arXiv 2608.08160, ICML 2026 | Abstract page | The benchmark's design (100 environments, structured commitments and facts) and the 42 per cent and 40 to 68 per cent figures |
| Junjie Li, Xinrui Guo, Yuhao Wu, Roy Ka-Wei Lee, Hongzhi Li, Yutao Xie, "Lost in Stories: Consistency Bugs in Long Story Generation by LLMs", Findings of ACL 2026 | Abstract (ACL Anthology) | 2,000 prompts in four task scenarios; five error categories; where errors concentrate |
| Yuqi Chen, Sixuan Li, Yunfeng Cai, Xueai Li, Ka Man Yan, Ying Li, "When Stories Evolve: Benchmarking LLM Storytelling Across Agent Architectures in Open-Ended World Simulations", arXiv 2608.15654 (16 August 2026) | Abstract page | Three separate capacities; the consistency and richness frontier; the effect of structure and scale |
| Yufei Tian, Tenghao Huang, Miri Liu, Derek Jiang, Alexander Spangher, Muhao Chen, Jonathan May, Nanyun Peng, "Are Large Language Models Capable of Generating Human-Level Narratives?", EMNLP 2024 | Abstract page | Positivity and lack of tension; the gain from explicit discourse features |
| Anil R. Doshi, Oliver P. Hauser, "Generative AI enhances individual creativity but reduces the collective diversity of novel content", *Science Advances* 10(28), 2024 | Page (PubMed Central) | The design, the numbers and the authors' limitations |
| Vishakh Padmakumar, He He, "Does Writing with Language Models Reduce Content Diversity?", ICLR 2024 | Abstract page | The tuned-versus-untuned contrast |
| Maan Qraitem, Kate Saenko, Bryan A. Plummer, "PersonaWeaver: Controllable Diversity Beyond Conventional Archetypes in Procedural Character Generation", arXiv 2609.26629 (22 September 2026, v2 6 October 2026; PANDORA workshop) | Abstract page | Homogeneous, assistant-like generated characters; separating world building from behavioural specification |
| Kenneth Li, Tianle Liu, Naomi Bashkansky, David Bau, Fernanda Viégas, Hanspeter Pfister, Martin Wattenberg, "Measuring and Controlling Instruction (In)Stability in Language Model Dialogs", COLM 2024 (arXiv 2402.10962) | Abstract page | Drift within eight rounds |
| Philippe Laban, Hiroaki Hayashi, Yingbo Zhou, Jennifer Neville, "LLMs Get Lost In Multi-Turn Conversation", arXiv 2505.06120 (2025) | Abstract page | The 39 per cent figure and the stated cause |
| Zdeněk Kasner, Ondřej Dušek, "Beyond Traditional Benchmarks: Analyzing Behaviors of Open LLMs on Data-to-Text Generation", ACL 2024 (arXiv 2401.10186) | Abstract page; ACL listing (summary) | The 80 per cent figure and the models tested |
| Sam Wiseman, Stuart M. Shieber, Alexander M. Rush, "Challenges in Data-to-Document Generation", EMNLP 2017 | Abstract page | Fluent but poor; templates beat the neural system on some metrics |
| Ratish Puduppully, Li Dong, Mirella Lapata, "Data-to-Text Generation with Content Selection and Planning", arXiv 1809.00582 | Abstract page | The two-stage content plan then text design |
| Berk Atil and twelve co-authors, "Non-Determinism of 'Deterministic' LLM Settings", arXiv 2408.04667 | Abstract page | The scope of the study and its findings |
| Horace He and others at Thinking Machines, "Defeating Nondeterminism in LLM Inference", 10 September 2025 | Page | Batch invariance as the main cause; the 80-in-1,000 result; the speed cost |
| Brandon T. Willard, Rémi Louf, "Efficient Guided Generation for Large Language Models", arXiv 2307.09702 | Abstract page | Guided generation with regular expressions and grammars guarantees structure |
| Zhi Rui Tam, Cheng-Kuang Wu, Yi-Lin Tsai, Chieh-Yen Lin, Hung-yi Lee, Yun-Nung Chen, "Let Me Speak Freely?", arXiv 2408.02442 | Abstract page | Format restrictions and reasoning |
| llama.cpp project, grammars README (GBNF) | Page | Grammar constraint, the JSON-schema subset, its limits and speed caveat |
| Or Honovich and nine co-authors, "TRUE: Re-evaluating Factual Consistency Evaluation", NAACL 2022 | Abstract page | Entailment-based and question-answering-based checks perform strongly and complementarily across 11 datasets |
| Kaige Xie, Mark Riedl, "Creating Suspenseful Stories: Iterative Planning with Large Language Models", EACL 2024 | Abstract page | Models unreliable at suspense; an iterative planning scaffold |
| Yi Wang, Qian Zhou, David Ledo, "StoryVerse", FDG 2024 | Abstract page | A model-based planner grounding authored "abstract acts" in world state (the design this dossier declines) |
| Andrew Zhu, Lara J. Martin, Andrew Head, Chris Callison-Burch, "CALYPSO: LLMs as Dungeon Masters' Assistants", AIIDE 2023 | Abstract page | Model text judged usable directly, ideas judged rougher, with a human in the loop |
| Jaewoo Song, Andrew Zhu, Chris Callison-Burch, "You Have Thirteen Hours in Which to Solve the Labyrinth", Wordplay workshop at ACL 2024 | Abstract page | Function calling improved state-update consistency in an AI game master |
| Samuel Gehman, Suchin Gururangan, Maarten Sap, Yejin Choi, Noah A. Smith, "RealToxicityPrompts", Findings of EMNLP 2020 | Abstract page | Toxic degeneration from innocuous prompts; no failsafe method |
| Hakan Inan and ten co-authors, "Llama Guard", arXiv 2312.06674 | Abstract page | A customisable input and output classifier with an adjustable taxonomy |
| Minh Hua, Rita Raley, "Playing With Unicorns: AI Dungeon and Citizen NLP", *DHQ* 14(4), 2020 | Text (first 100,000 of about 142,000 characters) | The coherence faults and the players' steering strategies in F-01 |
| The Register (the lens names Katyanna Quach; the part I read shows no author), 8 October 2021 | Page | The AI Dungeon facts in F-01 |
| Convai documentation, "How narrative design works" (Unity SDK) | Page | An author-defined graph of sections and triggers; the game fires triggers |
| NVIDIA developer blog, on-device small language model for game character roleplay; NVIDIA GeForce news, ACE in inZOI and Naraka | Page each | A 4B model at about 2 GB with INT4 (vendor claim, no throughput or contention figures); Smart Zoi on-device, a roughly 0.5B model, GeForce RTX only, an experimental setting |
| Valve, Steamworks Content Survey, Part 3 (generative AI content) | Page | Pre-generated and live-generated content; guardrail description; adult-only live-generated content not allowed |
| art-from-the-machine, Mantella README (repository) | Page (excerpt) | The pipeline and the stability warning |
| The repository's S2 specification, dossiers 12, 19 and 21, the map and lenses L2, L8, L10 | Text | Everything marked as given in §1 |

### 3.2 Summary, abstract or lens only

| Source | Level | What I took, and what I did not |
|---|---|---|
| Nicholas Carlini and co-authors, "Extracting Training Data from Large Language Models" | Via D19 (abstract) | A model can emit verbatim training text (D19 GEN-02); not re-opened |
| Inworld AI product pages (directories, a review, a marketplace listing, a press item on a voice model) | Summary | Architecture claims only (a "Contextual Mesh" with safety constraints, goals and knowledge in natural language); no data. Not credited |
| Mantella Nexus listing and press test (UploadVR) | Summary | The 20 GB and "noticeable latency" statements, as the summaries state them |
| Trevor Ashby and four co-authors, a CHI 2023 paper on knowledge-graph and model-based quest and dialogue generation | Summary (a later paper's account of it) | Not used in principles. I could not retrieve the paper (the publisher refused the fetch) |
| Techdirt case study on AI Dungeon | Not retrieved | A certificate error on the archive host |
| Valmeekam and co-authors on planning abilities; Yang and co-authors, Re3 | Lens only | Not used |
| Nexus Mods AI-tag pages | Via D19 | PLT-05; not re-opened |
| OWASP and prompt-injection literature | Not researched | LMP-06 states the point as a [hypothesis] |
| Licences of open-weight models | Not read | The model is the player's choice; see open question 11 |

### 3.3 Lens and map claims checked

| Claim | Where | Result |
|---|---|---|
| "Wang, Zhou & Ledo 2024, StoryVerse, FDG 2024" | Map SEL-11 | Confirmed (abstract). The lens calls it a proof of concept "without a formal evaluation"; the abstract says it is a proof-of-concept system with examples, and does not mention evaluation either way |
| "Tian et al. 2024, EMNLP" | Map SEL-11 | Confirmed. The abstract page adds that explicit discourse features improved storytelling by more than 40 per cent on diversity, suspense and arousal |
| "Doshi & Hauser 2024: 293 writers, 600 evaluators; 10.7 and 8.9 per cent of range" | Lens L8:19 | Confirmed. The authors also note one model, one task, no interaction and no prompt variation |
| NCP-Bench: best model kept commitments in 42 per cent of runs after 20 turns; fact conflicts 40 to 68 per cent; 100 environments | Lens L2 A16, L8:19 | Confirmed from the abstract page. The best model on that page is named as GPT-5.2 |
| ConStory-Bench: "2,000 prompts, five error categories, 19 subtypes; errors concentrate in factual and temporal details, cluster mid-narrative, correlate with entropy" | Lens L8:19 | Confirmed. The lens leaves out "four task scenarios" |
| WSE-bench: "neither added structure nor model scale reliably improved coherence" | Lens L8:19 | Mostly confirmed. The abstract says added structure can enrich trajectories but does not uniformly improve coherence and may shorten them; scale mainly improves sustained generation |
| Generative agents: 6 of 453 hallucinated; place choice degraded; norms misread; over-formal and over-cooperative; instruction-tuned habits | Lens L2 A15 | Confirmed in the paper's own sections. The lens does not mention the stated cost, which matters here |
| "AI Dungeon, April 2021: OpenAI flagged sexual content involving minors; Latitude deployed a filter … human review" | Lens L10 field 11 | The facts about content, filter, bans, backlash and the later change are confirmed from the October 2021 press piece. The April date and the flagging by OpenAI as a first step I could not confirm; the piece says OpenAI required better filters |
| "AI game master goes off the rails on rules and flow and needed function calls" | Lens L2 A16 | The abstract says model limits make a consistent game master hard and that function calling improved narrative quality and the consistency of state updates; "off the rails" is not in it |
| "Qraitem et al. 2026, PersonaWeaver, arXiv 2609.26629" | Map ETH-10 | Confirmed (abstract, v2 dated 6 October 2026) |
| "Gehman et al. 2020"; "Inan et al. 2023, Llama Guard" | Map ETH-10 | Confirmed (abstracts) |
| Lens L8 principle 3: "GPT-4 produced executable plans only about 12 per cent of the time unaided" | Lens L8:19 | Not re-checked; not used |

## 4. Principles

IDs: LMB (boundary), LMD (determinism and persistence), LMF (fidelity), LMR (running it), LMP (rights, provenance and safety), LME (what the research shows). Grades are P1 §4's. Scale codes follow dossier 8 (gl glance, en encounter, vg vignette, gg gig, ar arc, se season). Layer codes: 1 to 4 are the four layers; C player configuration; E evaluation; X expression; S7 rendering; P7 runtime; P8 realisation; P10 tooling. "Produce" says what a procedure can do; "Check" says what it can test. Requirement IDs (`S22-S2-nn`, `S22-S7-nn`, `S22-P7-nn`) are in §12; measure IDs (`M22-nn`) are in §7. A "mode" is defined in §5.2: **T** is the model as phrasing author; **R** is a per-delivery render; **N** is no model.

### A. The boundary

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LMB-01 | **Every text delivery is decided by three questions. What is said, and to whom, comes from the record (layers 1 to 3). Whether and when it reaches V is the arbiter's. How it is worded is S7's, and only there may a model sit, after the first two are fixed.** | [hypothesis], extending plan §2 | The plan's "never does the planning"; the failures in F-01 to F-03, where state lived in the model's text. Instance: the cousin's message (§6) is chosen, cast, timed and sized before any model is asked for words | all · 2, 3, S7 | **Produce:** the model adapter is reachable only from S7's lexical-choice and realisation stages (dossier 21 §5.2 stages 4 and 5), with content determination (stage 1) already done. **Check:** a dependency check that the adapter module imports no kernel, seeding or arbiter write API; LMD-07 |
| LMB-02 | **Words never flow back into facts.** Effects, canon "perceived" events and record entries are written from declared atoms and delivery ids, never by parsing a rendered line. If something must be true after a line, it is in the fragment's `leaves`, whatever the words | [hypothesis] | S2 §2.8 (a fragment's `leaves`), §8.5 (what V perceives becomes canon). Instance: a model-written line mentions "the debt"; the debt exists only if an atom said so | all · 2, S7 | **Produce:** the renderer returns a string and a provenance record only. **Check:** S2-I-15 and the metamorphic test (LMD-06, LMD-07) |
| LMB-03 | **The model receives a brief, not the world.** The brief is built by S7 from a closed list: the unit and phrasing refs, atoms with canonical statements, a slot table with grammatical metadata (never values), the voice card compiled, a register band, a tone tag, a length range, the channel and form, a forbidden list, up to three pack-authored exemplars, and up to a few earlier lines of this speaker in this scene. The model has no tools, no retrieval, no kernel query and no memory | [hypothesis] | Park and colleagues report retrieval failures, embellishment and hallucinated awareness when agents retrieve from a memory stream (F-02); S2-I-14 already fences the director's hooks with a closed input list. Instance: the brief for a message names `{cousin}`, `{market}`, `{count}` as slots and states "the vendor is short for Friday" as an atom | all · S7 | **Produce:** a typed brief schema (§5.3) and a builder that cannot read anything else. **Check:** a brief audit (M22-12): every brief field has a declared source; none reads the world |
| LMB-04 | **A model never plans or decides.** It does not choose a beat, a target, a cast, a branch, a check result, an outcome, a consequence, a timing, a channel, an offer set or what the city does next. Not as a planner, not as a sifter, not as a "director assistant" at run time | [empirical] for drift when state sits in the model; the decision is ours | NCP-Bench, ConStory-Bench and WSE-bench (F-03); Xie and Riedl: models unreliable at suspense without an iterative scaffold. StoryVerse puts a model in the planner role as a proof of concept, and that is the design declined here. Convai documents that its story graph is authored and the game fires the triggers, and the page does not say the model picks transitions (LME-05) | all · 2, 3 | **Produce:** the adapter has no function that returns a decision. **Check:** the invariant S2-I-15; static check that no S3 or S2 code path calls the adapter |
| LMB-05 | **A model never reads or writes the director's model of V, and no brief carries a facet.** The model of V has no entrance into seeds (S2-I-13), and a remote model must receive a scene brief "with no facet in it" (D12 PRV-01) | [analysis] | D12 PRV-01, MDL-04; S2 §8.8. Instance: the same brief is built whatever the director believes about V | all · 3, S7 | **Produce:** the brief schema has no field whose type derives from a `director → v` belief (extends L-57). **Check:** the brief audit (M22-12) finds none |
| LMB-06 | **A model never speaks for V or states V's feelings, motives or reasons.** V has no voice card; option text is the recorded line's own words and a closed act label; system and narrator text has no second-person present-tense clause about V; NPC attribution lines keep their fixed frame, so the model neither writes the belief nor chooses the hedge | [analysis] | D-09, D-22; S2 §2.22 (L-20, L-21, L-52, L-122, L-129); the Fallout 4 label mismatch (D21 F-02) | all · 2, S7 | **Produce:** classes OFR and ATT are not eligible for `modelOk` (LMB-07). **Check:** the presumption read-through (M21-09) on generated lines |
| LMB-07 | **The classes are fixed in advance.** A pack author opts a unit in with `modelOk`. A model may be offered: colour (barks, ambient chat), document flavour that is not `mustReach`, scan descriptions, clause fills at seams, and paraphrase alternates of a `claim` unit. A model may **never** be offered: offers (options, labels, foresight, decline and null responses); attribution lines; any `mustReach` carrier; authored-source classes and `AuthorFill` slots; explicit scenes and their fade forms; humour frames; told-story evaluations; system, narrator and news voice; any text whose cast binds a person who could be a minor; and any unit tagged at intensity 2 or 3 in any class | [hypothesis] | D-23, S2 §2.19 (the model must never fill an authored-source slot; ceilings are enforced by structure); AI Dungeon (F-01: content the model added unprompted); dossier 13 `mustReach` (S2 §2.8, L-63); a missed error costs most where V acts on the text. The `mustReach` exclusion is cautious and may be relaxed when LMF-05's escape rate is measured | all · 2, 4, S7 | **Produce:** lint L-132 (§12.1) and a runtime refusal, because the cast is known only at casting. **Check:** a table-driven test that every excluded class refuses |
| LMB-08 | **Prefer the model as a phrasing author (Mode T) to the model as a live narrator (Mode R).** In Mode T the model writes new phrasings with typed slot markers from an authored source, at idle times or at pack install. They pass the gates, enter a player-local generated pack with `origin: generated`, and are drawn by layer 2 like any alternate. In Mode R it writes one delivery's line ahead of release. Fast channels use pools of either kind | [hypothesis] | Templates can do the tasks of a "real" generator (D21, van Deemter and colleagues); a templated baseline beat a neural system on some metrics (Wiseman and colleagues); more than 80 per cent of open-model outputs had a semantic error (Kasner and Dušek). A fresh phrasing with markers is checked once, not at every play | all · 4, S7 | **Produce:** two adapters on one interface (§5.2). **Check:** the share of model-origin lines that come from Mode T pools (M22-09); the escape rate by mode (M22-04) |

### B. Determinism and persistence (S2-I-1, S2-I-6)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LMD-01 | **Model output enters the engine only as stored data, never as a live stream.** It is gated, written as a document (a phrasing in a generated pack, or a ledger entry), and only then used. "The documents" are already inputs of S2-I-1; the words of a render are a document created before use | [hypothesis] | S2-I-1 (inputs: the documents, the seed, the kernel operations, V's responses, session inputs, settings); S2 §3.4 (each draw is recorded and "a reload re-uses it") | all · 2, S7 | **Produce:** the adapter returns a candidate to the gate pipeline, which returns an entry or a refusal. Nothing else reads it. **Check:** no code path displays an ungated string |
| LMD-02 | **Do not rely on seeded regeneration.** Settings called deterministic did not give repeatable output across five models and eight tasks (Atil and colleagues), and a served model at temperature zero gave 80 distinct completions in 1,000 identical requests, mainly because kernels give different numbers under different batch sizes (He and colleagues). A local single-user runner may repeat on one machine; it will not across hardware, drivers, quantisations or model updates [hypothesis]. The seed is passed for tests only | [empirical] for the failure; [hypothesis] for the local case | F-07. Instance: the same brief, run again after a driver update, gives different words | all · 2, S7 | **Produce:** persist the result (LMD-03). **Check:** the reload test (M22-02) never regenerates; a test that two runs of one brief may differ and nothing breaks |
| LMD-03 | **Persist at release, not before, and freeze at release.** A pre-render is disposable until its delivery is `released`. At release the line's entry is written to the render ledger, keyed by delivery id and line index, and from then on it is immutable. Switching model, backend or setting never rewrites it, and a pack edit never rewrites it | [hypothesis] | S2 §8.4 (prepare, then confirm: nothing invalid reaches V), §8.5, §12.1 (deliveries and draws persist), §12.3 (a text-only edit reaches live instances as corrected wording, which holds for template-rendered unreleased lines and not for frozen model lines). A phone thread or journal line is read again; it must read the same | all · 2, S7, P7 | **Produce:** a new invariant S2-I-16 (released words are immutable). **Check:** the reload test (M22-02): save, load, compare every displayed line |
| LMD-04 | **The ledger key is the delivery, not the brief; the model is provenance, not key.** The entry holds the shown text, the unit, phrasing and mode, the brief hash, the model reference (id, file hash, backend, config hash), the gates passed and the retry count, `origin: generated` and the game time. A new model never invalidates the record | [hypothesis] | S2 §12.1 (instance state records draws and deliveries); D19 GEN-03 (every generated output carries the engine version, the settings and the model id). Instance: §5.4 | all · 2, S7, P7 | **Produce:** `RenderEntry` (§5.3). **Check:** an audit that every shown model line has an entry (M22-03); the ledger size stays within a budget [J: well under 1 MB for a long campaign at about 200 bytes a line] |
| LMD-05 | **With no model the engine is complete.** Every `modelOk` unit has a model-free `says` that leaves the same facts. The model path is never required. The engine falls back silently, with a record entry, when the model is disabled, not yet warm, too slow for the deadline, over budget, has crashed, or fails the gates after two tries. A fallback line is final once released (LMD-08) | [hypothesis], extending S2 §2.19 (L-100) | S2 §2.19: "A seed therefore runs identically whether or not a pack supplies the material, and model-written content always has a form it can produce." Instance: §6 step 7 | all · 2, 4, S7 | **Produce:** lint L-131 (a `modelOk` unit with no model-free form is an error). **Check:** the whole fixture suite runs with the model off and gives the same structural trace (M22-01) |
| LMD-06 | **Words do not steer.** No draw, id, transition, wake-up, predicate, hook input, tie-break or structural record field reads rendered text, the model's availability or the model settings. The structural trace (casts, draws, transitions, delivery ids, windows, record entries without their text) is bit-identical with the model off, on, or returning any other lint-passing strings | [hypothesis] | S2-I-1, S2-I-11, S2-I-14 and L-61 (the `setting` atom cannot read the player-model settings; the same rule is applied to the model settings). §12.3's `structureHash` already excludes the contents of text units | all · 2, 3 | **Produce:** a new invariant S2-I-15; lint L-136 (a predicate reading a model setting). **Check:** the metamorphic test (LMD-07) |
| LMD-07 | **The reference model tests it without a model.** A stub renderer returns canned strings, a tape records `renderKey → text`, and tests run the fixtures with the stub, with a different tape, with another stub's outputs and with no model, then compare the structural trace. This needs no inference and no GPU | [hypothesis] | The reference model is the oracle (D-06); the test is a metamorphic property: change the words, and the structure must not change | E, S7 | **Produce:** `S22-S7-10`. **Check:** equal structural hashes (M22-01) |
| LMD-08 | **Never upgrade a released line in place.** A line shown from the template is never replaced later by a model version, nor the reverse. The model may improve a line only before release. Pools may be refilled, but a drawn pool item's text is frozen once it is released | [hypothesis] | S2-I-6 (a displayed offer has the same `Id` and is never shown as new); the same rule applies to any displayed text | all · 2, S7 | **Produce:** the ledger is write-once per key. **Check:** M22-02 |

### C. Fidelity (hallucination, contradiction, claims and quotes)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LMF-01 | **Expect error and check everything.** No model text reaches V ungated. Fluent text did not predict consistency or semantic accuracy in any study read here | [empirical] | F-02 (embellishment; 1.3 per cent hallucinated awareness), F-03 (fact-conflict rates of 40 to 68 per cent), F-04 (more than 80 per cent of outputs with a semantic error, for 2023 open models). The numbers for a small local model on this engine's briefs are unmeasured | all · S7 | **Produce:** the gate pipeline of §5.3. **Check:** the escape rate (M22-04) |
| LMF-02 | **The engine fills the values; the model never types a name, count, time, place or quote.** The model writes a template with typed slot markers, as an authored phrasing does. Grammar-constrained decoding admits only the markers named in the brief, each required marker exactly once, and no numerals, quotation marks or markup. The engine then substitutes values, with agreement from the slot's grammatical metadata (D21 LOC-01 to LOC-03) | [hypothesis], extending Willard and Louf (guided generation guarantees structure) and the grammar facility in llama.cpp | A grammar fixes form, not meaning (§2.3). Tam and colleagues report a reasoning drop under format constraints; the task here is wording to a fixed set of atoms, not reasoning, and must be measured (F-09). The JSON-Schema subset in llama.cpp has gaps and unsupported features "skipped silently", so the engine ships its own grammar | all · S7 | **Produce:** a grammar built from the brief's slot table (`S22-S7-04`). **Check:** M22-05, the share of candidates rejected at G0 |
| LMF-03 | **Closed world for specifics.** Any named entity, brand, price, place, date or numeral in the output must come from a slot or from a registry item the brief lists as allowed. Number words and unknown capitalised tokens are rejected. This is L-17 and L-76 applied to rendered text, and it stops invented facts at the surface | [hypothesis] | S2 §2.22 (L-17, L-76, L-127, L-128); D21 SPC-02 (bind every specific to the record). Instance: a model line that names an invented gang is rejected | all · S7 | **Produce:** a deterministic token pass against the brief's allowed set and the world's registries. **Check:** orphan-specific rate (M21-02, extended to model text) |
| LMF-04 | **Coverage: every required atom is carried.** Value atoms by marker presence. Relation atoms (who did what to whom; polarity; tense; modality) by an entailment check against the atom's canonical statement | [hypothesis], extending S2 §2.22 (a non-colour phrasing reads the record, L-128) | Kasner and Dušek: omissions and errors were the failure; instance: a line about the debt that never says who owes whom is rejected | all · S7 | **Produce:** gate G2 (§5.3). **Check:** coverage rate; M22-04 |
| LMF-05 | **Support: nothing is said that the brief does not entail.** Each sentence must be entailed by the atoms, with values substituted, using a small local entailment model. Entailment-based and question-answering-based checks performed strongly and complementarily across 11 datasets in a meta-evaluation (Honovich and colleagues), so they are the starting point. Example-level accuracy is not perfect, so the deterministic gates (LMF-02, LMF-03, LMF-07) come first and the classes in LMB-07 are fixed by the measured escape rate | [empirical] for the metric result; [hypothesis] for its use here | TRUE (abstract). The check is itself a model, with its own errors; I have not measured it on this engine's briefs | all · S7 | **Produce:** gate G3. **Check:** a human audit of a sample of gate-passed lines (M22-04) |
| LMF-06 | **Paraphrase is checked against its authored source in both directions, and the small words are checked directly.** The source is the authored phrasing with values filled. Negators, modals, quantifiers, tense and numerals are compared deterministically, because entailment checks are weakest on them [hypothesis] | [hypothesis] | The paraphrase mode is the lowest-risk use (LMB-08). The lens's testable form is the share of proposals that pass a symbolic validator after repair loops (L8:19) | all · S7 | **Produce:** gate G2b for Mode T and for R in paraphrase form. **Check:** a mutation test of the gate: scripted faults (negate, swap agents, change a number) are detected (M22-06) |
| LMF-07 | **Quotes and causes are claims, and the model may not make either on its own.** No quotation marks, and no causal connective ("because", "so", "since", "after that"), unless the brief carries a recorded-utterance atom or a cause atom for it. A count ("third time") comes only from a `count` slot witnessed by the speaker. An account of what someone said is marked `reconstructed` | [analysis] | S2 §2.22 (quotes and causes cite a recorded event or are marked `reconstructed`; L-58 extended to the system voice); D21 GEN-05 and the Qud rationalised cause (F-06). Instance: a model line "he left because of you" is rejected | all · 2, S7 | **Produce:** G1 rejects quotation marks and a connective list unless a matching atom is in the brief. **Check:** S21-S2-16's lint on rendered text |
| LMF-08 | **Retry is bounded, then fall back. Never repair by hand.** After two failures [J] the template form is used. The only repair is slot substitution. No regular-expression edit of a rejected line is accepted, because an edit makes new unreviewed words. Rejection reasons are logged for authors | [hypothesis] | The fallback rule (LMD-05). Instance: §6 step 3 | all · S7, P10 | **Produce:** a retry counter in the entry. **Check:** fallback rate (M22-07) and rejection mix |
| LMF-09 | **Tone follows the facts, and the gate checks polarity.** Models skew positive and soften dread (Tian and colleagues), so a dread beat must not come back jokey or warm. The brief carries a tone tag; a tone and polarity check compares the line with it (the same comparison as the beat tone lint, L-78). Humour is withheld unless an authored joke frame is satisfied | [empirical] for the positivity; [hypothesis] for the check | Tian and colleagues (abstract); D21 TON-07 and HUM rules (via D21). Instance: a grim line about the missed payment is not allowed to end on reassurance | all · S7 | **Produce:** gate G5. **Check:** the polarity-match rate on the trap set (M22-10) |

### D. Running it: local or service, timing, cost, privacy and choice

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LMR-01 | **Render ahead; the arbiter never waits on a model.** The arbiter releases once a second on the play clock, and prepare and confirm run in one step. A class-2 message has a default `maxWait` of 1,800 play seconds. A pre-render starts when a delivery is queued and must finish before its earliest release; if it has not, the template form plays. Barks, ambient chat, calls and approaches never wait: they draw from pools | [hypothesis] | S2 §2.12, §8.2, §8.3, §8.4. Instance: §6 step 2. Number of seconds of slack: [J], measured in the first session | gl, en · 2, S7, P7 | **Produce:** a pre-render queue with a deadline per delivery (`S22-S7-07`). **Check:** the share of model deliveries released from the model (M22-07), and the release-time delta |
| LMR-02 | **One model path, two backends, off by default.** A local runner (the default when the player turns the feature on) and a remote service share one adapter, one gate pipeline and one ledger. The local runner talks to the companion over a pipe and opens no socket by default | [hypothesis] | D19 PLT-06 (hosts ban files that send or receive data over the internet unless crucial; a default install opens no sockets, T-05), SHP-02 (a language-model provider is a capability off until turned on). Park and colleagues: cost and latency rule out remote per-agent use (LMR-04) | all · P7, C | **Produce:** a `ModelBackend` interface with `local` and `service`. **Check:** a default install opens no sockets (D19 T-05); with the feature on and local, still none beyond the pipe |
| LMR-03 | **The model costs the player nothing they can notice.** The runner has a low priority and capped GPU memory, system memory and threads; it pauses in combat and under load; it prefers loading screens, menus, photo mode and idle; and a frame-time watchdog turns it off. It never delays the engine's or the game's start: it warms up in the background and templates serve until it is ready | [hypothesis] | NVIDIA says a 4B model quantised to INT4 uses about 2 GB, with no throughput or contention figures (page); its inZOI feature is an on-device model of about 0.5B parameters, on GeForce RTX GPUs only, behind an experimental setting. The load-time goal in AGENTS.md; the plan's quality bar 9 (no perceivable cost). The cost of sharing a GPU with this game is unmeasured | all · P7 | **Produce:** caps, a pause rule and a watchdog (`S22-P7-03` to `S22-P7-05`). **Check:** frame-time with the runner off and on, in one booked session (M22-11) |
| LMR-04 | **Spend model calls per released delivery, never per character per tick.** The number of calls is the number of model-eligible deliveries released, times the retry factor, and director caps (D7 DIR-30) already bound deliveries per hour. A cap on renders per hour backs it up [J] | [empirical] for the cost of per-agent use | Park and colleagues: 25 agents over two days cost "thousands of dollars" in tokens and took days (§8.2). The lens's "pre-generate offline for rare, high-value seeds" (L8:20) points the same way | all · 3, S7, P7 | **Produce:** a render budget per hour and per class, with back-pressure to the template. **Check:** calls per released delivery (M22-08) |
| LMR-05 | **Privacy is a function of the mode.** Mode T briefs hold pack text, slot markers and the voice card: they carry no playthrough, so a remote service sees only the pack. Mode R briefs carry atoms about what happened in this game, though no names or values because those are slots, and no model facet (LMB-05). A remote Mode R is therefore a second, separate consent: per session, with a viewer of the exact briefs sent, content ceilings applied before sending, opaque ids, no save names and no game text | [analysis] | D12 PRV-01 to PRV-03; AI Dungeon's backlash over reading private stories (F-01). The Register reports the developer's later promise of no human review where barriers triggered | all · C, P7 | **Produce:** a send log and viewer (`S22-P7-08`). **Check:** the network audit shows zero outbound calls by default (D12 M12-15), and the brief audit (M22-12) shows no value, name or facet |
| LMR-06 | **The player decides, and the decision changes only the wording.** Off (default), local or service; a per-class allow list; per-pack and per-speaker switches; a kill switch that stops the runner at once; "clear generated pool". The setting never changes what happens (LMD-06). Origin is shown in Details and in "why this line?", in the settings voice | [hypothesis] | S2 §2.18 and §8.8 (player settings recorded; the settings voice); AGENTS.md (defaults first, show the options). Steam and the mod host both treat disclosure as a first duty (F-10) | all · C, P8 | **Produce:** `SettingsSet.text.model`. **Check:** the structural trace is equal across settings (M22-01) |
| LMR-07 | **Qualify the model before enabling it.** At enable time the engine runs a fixed set of trap briefs through the gates and reports a pass rate and the reject mix. A model that does poorly is restricted to Mode T and colour or refused; a model on the project's audited list (§5.8) may be offered Mode R classes. The player brings the model | [hypothesis] | Quality varies by model and the evidence is mostly 2023 to 2026 models (§2.2, item 7). Players choose arbitrary models; the engine cannot measure the escape rate on their machines, but it can measure rejects | C, P7, E | **Produce:** the qualification run (`S22-S7-12`). **Check:** its report; M22-13 |

### E. Rights, provenance and safety

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LMP-01 | **Origin is per instance.** A pack unit keeps the author's origin. A model line is a ledger entry with `origin: generated`. A phrasing written by the model in Mode T is a unit with `origin: generated` in a player-local generated pack, never merged into the author's pack | [hypothesis], extending S2 §2.20 | S2 §2.20; D19 LIC-04 (a `generated` unit is not offered as the author's copyright work). Instance: the player's own generated pack | all · 2, 4, S7 | **Produce:** the ledger and the generated pack. **Check:** origin audit (M22-03) |
| LMP-02 | **A generated line can never fill an authored-source slot, satisfy `authored: 'human'`, or fill an `AuthorFill` slot.** Enforced at the lint, and again at runtime | [analysis] | D-23; S2 §2.19, L-97, L-116; D21 MIX-03 and MIX-05. The reason is the maintainer's: the model-driven tools do not write that source material | all · 2, 4 | **Produce:** lint L-132 and the runtime refusal (LMB-07). **Check:** table-driven test |
| LMP-03 | **Disclosure follows provenance, and the model path is a separate optional add-on.** The engine's own page and each pack's manifest declare the model path and the generated parts; the pack tool derives the host's tags from the manifest (D19 PLT-05). No weights ship in the engine; the player supplies a model | [practice] for the host and store rules; [hypothesis] for the packaging | D19 PLT-05, SHP-01, SHP-02, open questions 3 and 7. Steamworks: for live-generated content a developer must describe the guardrails, and live-generated adult-only sexual content is not currently allowed. Whether text generated on a player's machine at play time falls under the host's upload tags is not stated in what D19 read | all · 4, C | **Produce:** the `ai` block (S19-S4-06) plus an `aiRuntime` line. **Check:** the release build's content check finds no model |
| LMP-04 | **No game text in a brief, and nothing trained on game text or audio.** Exemplars are pack-authored. The engine offers no fine-tuning path. A conservative reading of the User Agreement's text-and-data-mining clause (D19 FAN-06), taken because it costs little | [hypothesis] | D-24 settles that mining game data for modding is normal modding; FAN-06 leaves open whether prompting with game text counts. This rule makes the question moot. Also L-114 (no game text inline in a pack) | all · 4, S7 | **Produce:** the brief builder takes exemplars from pack refs only. **Check:** the brief audit (M22-12) finds no `GameRef` text |
| LMP-05 | **Model text is never voiced by cloning, and never by splicing recorded lines to fit it.** A synthetic non-clone voice may be a pack-declared adapter. Selecting which recorded line plays is the engine's job, from a closed list | [analysis] | S2 §2.20 (the floor is cloning, not editing); D19 VOX-01 to VOX-06 | all · S7, P8 | **Produce:** `audio.kind` stays `synthetic` with `cloneOf: none`. **Check:** L-115 |
| LMP-06 | **Safety is structural first and filtered second, and pack text is untrusted input.** The closed-world checks (LMF-03), the content ceilings, the minor floor and the slur lexicons (real and in-world) come first. A classifier is the backstop and is tuned against over-blocking. A failure leads to the template, never to a visible refusal. The model has no tools, so injected instructions in pack text can at worst change wording, which the gates then judge [hypothesis] | [empirical] for the limits of filters | RealToxicityPrompts (no failsafe); Llama Guard (a classifier with an adjustable taxonomy); AI Dungeon's filter blocked "four watermelons" (F-01); L10 ETH-10 (closed-world generation for text about protected groups). S2 §2.19: hate content is barred in system voices, and goes to a review queue in authored dialogue; a generated line has no review queue, so it is barred wherever an authored one would be queued | all · 2, S7 | **Produce:** gates G1, G4, G5. **Check:** zero hits from the lexicons over a large sampled run (M22-14); false-reject rate on benign text (M22-10) |
| LMP-07 | **Answerability.** "The generator did it" resolves to a person who shipped the generator. Every entry names the engine version, the settings, the model reference and the brief hash, and "why this line?" is answered from the ledger. Exports leave out briefs by default and mark generated lines | [analysis] | D19 GEN-03; D12 PRV-02 | all · P10, C | **Produce:** the entry fields (LMD-04). **Check:** a content card per model path (`S22-S4`, via D19) |
| LMP-08 | **Authors can say no.** A pack, or a unit, declares `aiUse`: `none` (never given to any model), `local` (to a local model only) or `allow`. Mode T gives pack text to a model, so it needs the permission; Mode R reads only the author's `modelOk` units | [practice] for permissions; [hypothesis] for the field | D19 PLT-01 (permissions travel with the pack), LIC-01. Instance: an author who wants no machine paraphrase of their voice | all · 4 | **Produce:** the field in the manifest (S19-S4-06's `ai` block) and the check in the brief builder. **Check:** L-137 |

### F. What the research shows about language models in interactive narrative

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LME-01 | **State kept in a model's prose drifts, and players build their own ledger to compensate.** Long-run benchmarks report fact conflicts and lost commitments; the humanities study of AI Dungeon records players who revert, edit and re-state facts | [empirical] for the benchmarks (indicative: preprints); [practice] for the players | Ma and colleagues; Li and colleagues; Hua and Raley (F-01, F-03). The engine's record is that ledger, supplied by the system | all · 1, 2 | **Neither** operationalises the principle; it motivates LMB-01 to LMB-05 |
| LME-02 | **Fluency and scale do not buy consistency.** Fluent text does not guarantee that commitments are kept (NCP-Bench abstract), and scale mainly improved sustained generation, not canonical coherence (WSE-bench abstract) | [empirical], indicative | F-03 | all · 3, E | Design must not depend on a larger model. **Check:** M22-04 on whichever model the player uses |
| LME-03 | **Single-shot calls from a full brief avoid the drift that multi-turn use shows.** Instruction drift appeared within eight rounds in one study, and another reported a 39 per cent average drop in multi-turn use with models that "do not recover" from a wrong turn | [empirical] for the drift; [hypothesis] for the remedy | Li and colleagues; Laban and colleagues (abstracts). The remedy is mine: each render is a fresh, stateless call whose brief states the voice again | gl, en · S7 | **Produce:** no conversation state in the adapter (`S22-S7-02`). **Check:** voice attribution on generated lines, long runs (M22-05) |
| LME-04 | **A model's habits leak into every character, so the engine must hold the voice.** Overly formal, overly cooperative and assistant-like characters (Park and colleagues; Qraitem and colleagues), positive and low-tension stories (Tian and colleagues), and collective sameness across writers (Doshi and Hauser; Padmakumar and He, for one of two tuned models) | [empirical] | F-02, F-05. The remedy tested by Qraitem and colleagues separates world building from behavioural specification: here that is the record plus the voice card. Model variants of one skeleton are not counted as extra variety unless the frame differs (D21 GEN-06) | gl, en, vg · 4, S7, E | **Produce:** voice-card markers enforced as lexical checks (G4); a frame-distance rule for Mode T. **Check:** voice attribution (M21-05), diversity across speakers (M22-05), repeated-frame detection (M21-03) |
| LME-05 | **Shipped hybrids document an authored structure with a model speaking inside it.** Convai's narrative layer is an author-defined graph of sections and triggers, and the game fires the triggers. NVIDIA's inZOI feature gives each character a life goal that guides an on-device model. Research prototypes (StoryVerse) hand the planning to a model; the closest to world writing (Song and colleagues) found function calls improved state-update consistency. The engine takes the stricter line: no state interface at all | [shipped], weak; [empirical] for Song and colleagues | Convai docs (page); NVIDIA GeForce news (page); the StoryVerse and Song abstracts. I have no data on how well the products work | all · 3, S7 | **Neither.** A comparison. It supports LMB-04 and LMB-03 |
| LME-06 | **Plan-then-render is the established pattern for text from structured data, and its renderer needs checking.** A content plan then a text stage (Puduppully and colleagues); fluent output that fails to approximate human documents and loses to templates on some metrics (Wiseman and colleagues); semantic errors in most outputs from open models (Kasner and Dušek) | [empirical] | F-04. The engine's content determination is a deterministic planner; its realiser is optional and gated | all · S7 | **Produce:** LMB-01 and the gates. **Check:** M22-04 |
| LME-07 | **A model writing for an author who reviews is useful; a model writing for the player unreviewed is a risk to be gated.** Dungeon Masters judged CALYPSO's text suitable for direct presentation and its ideas rougher, with creative control kept by the DM | [empirical], small (abstract) | Zhu and colleagues. In this engine the reviewer is the gate pipeline (Mode T) or, for authors, the authoring tools of dossier 16 | all · 4, P10 | **Produce:** drafting is an authoring-tool feature (dossier 16), with `origin: assisted` if a person edits it. **Neither** otherwise |

## 5. Models the engine could run

### 5.1 The boundary, drawn

The pipeline is dossier 21's stages. The model has one door, at the point marked below.

| Stage | Who decides | May a model be involved? |
|---|---|---|
| Sowing, casting, scheduling, beat and fragment choice | Layers 2 and 3, deterministic | **No** |
| Content determination (which atoms are said, which are dropped as already shared) | S7, from the record | **No** |
| Choice of phrasing (eligibility, specificity, recency, the layer-2 draw) | S7 and layer 2 | **No**, but a generated phrasing may be one of the alternates it draws among (Mode T) |
| Referring expressions, lexical choice, agreement | S7 | **No** (a model may write the wording that surrounds slots, not decide which entity is meant) |
| **Wording of one text unit from a brief** | S7 | **Yes: the one door.** Modes T and R, only for classes in LMB-07 |
| Gates and lint | S7 | Entailment and tone checks use small models; they return a verdict and never text |
| Release, display, exposure | Arbiter | **No** |
| Effects on the world, canon, record | Kernel and layer 2 | **No**, and the words are never an input (LMB-02) |

| Text class | Model offered? | Why |
|---|---|---|
| Colour: barks, ambient chat, conversation | Yes (pool, Mode T first) | Low stakes; no claim; speed (LMR-01) |
| Document flavour: shards, notes that are not `mustReach` | Yes (Mode R or T) | Long text, rationed, static; the sole class where templates are weakest |
| Scan descriptions of ordinary civilians | Yes, brief only (open question 9 of D21 is a booked test) | Terse, observational |
| Paraphrase alternates of a `claim` unit | Yes (Mode T) | The semantic content is already in the authored source |
| Message and call lines that are `claim` | Not in the first cut (R) | The cousin's terms are facts V acts on; wait for M22-04 |
| `mustReach` carriers | **Never** | A missed error costs most here |
| Offers, option text, labels, foresight, decline and null responses | **Never** | Frozen at display (S2 §8.8); V's words are recorded lines |
| Attribution lines (D-22) | **Never** | Fixed frame; the belief is the NPC's, from a `believes` result |
| Told stories | **Never** in the first cut | Evaluation is the teller's own; open question |
| Humour | **Never** | Authored joke frames only (D21 HUM) |
| Authored-source classes, explicit scenes, `AuthorFill` slots | **Never** | D-23 |
| System, narrator, news voice | **Never** | No review queue at run time; hate floor |
| Anything binding a possible minor, or tagged intensity 2 or 3 | **Never** | Structural floors (S2 §2.19) |

### 5.2 Three modes

| Mode | What the model writes | When | Output | Run-time cost | Privacy of a remote call | Determinism |
|---|---|---|---|---|---|---|
| **N** (none) | Nothing | | Authored and assembled text only | None | None | Full |
| **T** (phrasing author) | New phrasings with slot markers, from an authored source phrasing and a voice card, for one situation class | Idle, menus, pack install, "grow my phrasings" | A generated pack: units with `origin: generated`, stored, drawn like alternates | None (draws are template realisation) | Pack text and markers only. No playthrough | A phrasing is data. Draws are as for any alternate |
| **R** (render) | One line for one queued delivery, with markers | After the delivery is queued, before its earliest release | A ledger entry written at release | One pre-render per delivery | Atoms about what happened in this game, with no names or values | Persisted at release; immutable |

### 5.3 The brief, the gates and the ledger

```ts
interface RenderBrief {
  mode: 'phrasing' | 'delivery';
  unit: TextUnitId; source?: PhrasingRef;        // the authored phrasing a paraphrase starts from
  purpose: TextUnit['purpose']; channel: ChannelId; form: 'short' | 'standard' | 'full';
  length: { minWords: number; maxWords: number };
  voice: CompiledVoice;                          // the card flattened: at most four markers, register band, taboo list, idiom set names
  tone: ToneTag;
  atoms: Array<{ id: AtomId; need: 'required' | 'allowed'; statement: string; slots: SlotKey[] }>;   // canonical statements with markers, never values
  slots: Record<SlotKey, { type: SlotType; gender?: string; number?: string; gloss: string; marker: string }>;
  forbid: { lexemes: LexemeRef[]; connectives: string[]; quoteMarks: true; numerals: true; markup: true };
  exemplars: PhrasingRef[];                      // up to three, pack-authored, never game text
  recent: string[];                              // a few earlier lines of this speaker in this scene, already rendered
  // No tools. No world query. No director belief. No save name, no player name, no values.
}

interface RenderEntry {                          // written once, at release
  key: Id;                                       // H("render", worldSeed, deliveryId, lineIndex)
  delivery: Id; line: number;
  unit: TextUnitId; phrasing?: PhrasingId; mode: 'phrasing' | 'delivery';
  text: string;                                  // as shown, values substituted
  origin: 'generated';
  briefHash: Hash;
  model: { id: string; fileHash?: string; backend: 'local' | 'service'; configHash: Hash };
  gates: { passed: GateId[]; retries: number; rejected: Array<{ gate: GateId; reason: string }> };
  at: GameTime;
}
```

**The gates, in order.** Each is deterministic unless marked.

| Gate | Checks | Principles |
|---|---|---|
| G0 form | Parses as a template; only brief markers; each required marker exactly once; word range; no numerals, quotation marks or markup (also enforced by the decoding grammar) | LMF-02 |
| G1 closed world | Unknown capitalised tokens, number words, brands, places and dates not in the brief's allowed set; causal connectives and quotation marks without a matching atom; taboo and forbidden lexemes | LMF-03, LMF-07 |
| G2 coverage | Every required atom: marker present; relation atoms by G3. For paraphrase: negators, modals, quantifiers and tense compared with the source | LMF-04, LMF-06 |
| G3 support (small entailment model) | Each sentence entailed by the atoms with values substituted; for paraphrase, two-way entailment with the source | LMF-05 |
| G4 voice and address | Voice-card markers present; register band; idioms from the speaker's groups only; no second-person mental verb, no leading question about V's feelings | LMB-06, LME-04 |
| G5 tone and content (small classifier) | Polarity against the tone tag; content classes at or below the brief's ceilings; slur lexicons (real and in-world); backstop safety classifier | LMF-09, LMP-06 |
| G6 originality | Not a copy of an exemplar or of a recent line; for Mode T, a frame distance from sibling phrasings above a floor [J] | LME-04 |
| G7 lint | The same lint as authored text: L-17, L-58, L-76, L-120, L-124, L-126, L-127, L-128 | S2 §11.1 |

A candidate that passes is substituted with values and, in Mode R, held until release. After two rejections [J] the template form is used.

### 5.4 Reload, step by step

1. A seed's beat becomes available. A delivery is queued with a stable id (S2 §8.1) and a text unit with `modelOk: 'delivery'`.
2. S7 builds the brief and starts a pre-render. The result, if it passes, waits in memory only. It is not in the save.
3. The arbiter releases the delivery (prepare, confirm). At that moment the entry is written to the ledger and the game port receives the text.
4. The player saves. The ledger entry is in the saved state beside the delivery record.
5. On load, layer 2 rebuilds the instance from its record (S2 §12.2), resets delivery states as §8.5 says, and shows displayed text from the ledger by delivery id and line index. No model is called. If the model setting is now off, the same text appears.
6. A delivery that was queued but not released at save time is rebuilt without its pre-render and is rendered again. Its words may differ from any earlier pre-render, because the pre-render was never shown.
7. A pool item (Mode T) is drawn with a layer-2 draw whose options are item ids. Once drawn and released, its text is frozen in the ledger. A pool item missing at load is treated like a missing pack: the implied or template form plays (S2 §12.3).

### 5.5 Local and service, side by side

| Concern | Local runner | Remote service |
|---|---|---|
| Latency against the arbiter | Hidden by pre-render; competes with the game for GPU and CPU (unmeasured here) | Network time hidden by pre-render; cannot be guaranteed offline |
| Cost to the player | Hardware, disk, power | Their own key and fees; an estimate shown before enabling |
| Cost to the project | None. No hosting (D19 GOV-01) | None. The project runs no service |
| Privacy | Nothing leaves the machine | Mode T: pack text only. Mode R: event structure of the playthrough, no names or values, only with a per-session opt-in and a viewer |
| Determinism | Not guaranteed across hardware or versions; the ledger fixes it | Not guaranteed; the ledger fixes it |
| Availability | Needs a model on disk and VRAM headroom | Needs a connection; fails to template |
| Rights | The player's model licence | The provider's terms; the pack's `aiUse` must allow it |
| Distribution | A separate optional add-on, no weights | A separate optional adapter; the host's network rule applies (D19 PLT-06) |
| Default | Off | Off, and never offered ahead of local |

### 5.6 Budget arithmetic [J]

| Item | Value | How it is used |
|---|---|---|
| Model-eligible deliveries released per hour | Bounded by director caps (D7 DIR-30) | Upper bound on Mode R |
| Words per line | 12 to 40, by channel (D21 §5.4) | Tokens out about 1.4 per word [J] |
| Brief size | A few hundred tokens [J] | Prompt processing |
| Retry factor | 1.0 to 3.0 [J] | Rejections |
| Pre-render slack | At least the time to render at the model's measured rate, with margin [J] | The deadline in LMR-01 |
| Render cap | A per-hour and per-class cap [J] | Back-pressure |

I give no tokens-per-second figure, because none of my sources states one for a model on a consumer GPU alongside a game.

### 5.7 Qualification and the audited list

The qualification run feeds about 80 briefs through the gates [J]: normal briefs, and trap briefs in six families (negation; swapped agents; counts and times; quotes and causes; voice and register; content ceiling). It reports the pass rate, the reject mix and the fallback rate. It cannot measure the escape rate, because that needs a human to read the passed lines. So the project audits a short list of models and configurations offline (500 passed lines each [J], read by a panel), and only those are offered Mode R classes. An unlisted model gets Mode T and colour. The list is data in the add-on, with the file hash of each model.

## 6. Walk-through: Friday at stall 7, with a model

The scene is dossier 21's, which dossier 20 stages. *All lines are invented.* The player has turned on a local model and allowed colour and paraphrase.

1. **The delivery is queued.** The vendor's cousin's message thread is a delivery with the seed's beat, a class-2 channel and `maxWait` 1,800 play seconds. The pack author marked the first message `modelOk: 'delivery'` with an authored template as the fallback, and marked the second message (the one carrying the terms, which V needs to answer) as authored only, because it is `mustReach`.
2. **A pre-render starts.** The brief names `{cousin}`, `{market}` and `{vendor}` as slots with gender and number, the required atom "the cousin asks V whether V is near {market}", the voice card (short sentences, one hedge, no slang from other groups), tone `worried`, 8 to 14 words, and one pack exemplar. It contains no values and nothing about V.
3. **Gate rejection.** The first candidate reads "You near {market}? He owes them two thousand." G1 rejects the number word. The second reads "Hey, you anywhere near {market}? Need someone to look in on {vendor}." The markers are right and the entailment check passes. The cousin's hesitation is in the delay field, not the wording.
4. **The arbiter releases it.** Three minutes of play later the arbiter releases the message. The entry is written to the ledger (key from the delivery id), with the model reference and `retries: 1`. The text shown fills the markers from the cast.
5. **V replies, with recorded lines.** The options are recorded lines with act labels and `foresight`, frozen at display. The model has no part. The cousin's next message is authored.
6. **A bark.** A passer-by says "Closed again." It is drawn from a pool of three authored alternates and two generated ones. The generated ones were written at idle time (Mode T), passed the same lint, and are marked `generated` in the generated pack. The draw cannot tell them apart.
7. **Model off.** The same save is replayed with no model. The delivery ids, casts, draws and transitions are identical. The first message is the template form. The structural trace is equal (M22-01).
8. **Reload.** The player saves after step 4 and reloads. The thread shows the model's words from the ledger. If the model is now off, the words are the same.
9. **A crash.** The runner is killed at step 2 in another run. The delivery is released with the template form after the deadline, and a one-line entry records `fallback: runner-unavailable`. The player sees nothing; Details says why if asked.
10. **The attribution response.** If V cleared the tag, the neighbour's line is the fixed frame of D-22 with a hedge, the act, the belief as the neighbour's view and a reply that corrects it. The model does not write it and cannot choose the hedge.

## 7. Measures

| ID | Measure | How | Target | Principles |
|---|---|---|---|---|
| M22-01 | Structural invariance | Automatic: run the fixtures with the model off, on, with a different stub and with a different tape; compare structural hashes | Equal in every case | LMD-06, LMD-07, LMR-06 |
| M22-02 | Reload stability | Automatic: save after displaying lines; load; compare every displayed line; repeat with the model off and a different model | 100 per cent equal; no model call during load | LMD-02, LMD-03, LMD-08 |
| M22-03 | Provenance coverage | Automatic: every shown model line has an entry with origin, model reference and brief hash; no generated unit satisfies `authored: 'human'` | 100 per cent; zero violations | LMD-04, LMP-01, LMP-02 |
| M22-04 | Escape rate | A panel reads a sample of gate-passed lines against the brief: lines that omit a required atom, add a fact, flip polarity or presume V's feelings | Near zero for any class enabled. A threshold [J: below 1 per cent for colour] decides which classes a model may have | LMF-01, LMF-04, LMF-05, LME-02, LME-06 |
| M22-05 | Voice and diversity | Panel: voice attribution on generated lines against cards (M21-05); automatic: distinct n-grams and frame distance across speakers | Voices matched above chance; diversity not below authored text | LME-03, LME-04 |
| M22-06 | Gate detection | Automatic mutation test: scripted faults on good lines (negate, swap agents, change a number, add a quote, add a brand, flip tone) | Detection near 100 per cent for deterministic faults; measured for entailment faults | LMF-02, LMF-03, LMF-06 |
| M22-07 | Fallback and timing | Automatic: share of model deliveries released from the model; fallbacks by cause; release time against the deadline | A rate set after the first runs; zero waits on the arbiter | LMD-05, LMR-01 |
| M22-08 | Calls per delivery | Automatic: renders per released delivery; per hour | Within the cap | LMR-04 |
| M22-09 | Source of model lines | Automatic: share from Mode T pools against Mode R | Reported; T preferred | LMB-08 |
| M22-10 | False rejects and polarity | Automatic over a benign set: share of good lines rejected; polarity-match on the trap set | Low false rejects; polarity matched | LMF-09, LMP-06 |
| M22-11 | Cost to the game | In the booked session: frame time with the runner off and on; start-up time with the feature enabled | No perceivable change; start-up unchanged | LMR-03 |
| M22-12 | Brief audit | Automatic: every brief field has a declared source; none holds a value, name, save name, facet or game text | Zero violations | LMB-03, LMB-05, LMP-04, LMR-05 |
| M22-13 | Qualification | Per model: pass rate, reject mix, class set granted | Reported | LMR-07 |
| M22-14 | Lexicon hits | Automatic over a large sampled run: slur-lexicon and content-ceiling hits in generated text | Zero | LMP-06 |

## 8. Tensions

| With | Tension | Resolution |
|---|---|---|
| Dossier 21 (variety, frames) | A model writes many strings but often one skeleton, so volume may not read as variety | A frame-distance floor for Mode T (G6); model variants count as variety only if the frame differs (LME-04); test with M21-03 |
| Dossier 21 (authors prefer to write every line) | Machine paraphrase of an author's voice | `aiUse` per pack (LMP-08); the author's source stays primary |
| Dossier 12 (privacy) and fidelity | A better brief carries more of the playthrough | Mode T for services; Mode R remote only with consent and a viewer (LMR-05); names and values are slots |
| Dossier 19 (no network, no model in the default) | A model path needs software and a model | A separate optional add-on, off by default, no weights, a pipe for the local runner (LMR-02, LMP-03) |
| Dossier 13 (`mustReach`) | The most important text is where an error costs most, and where authors most want help | Excluded in the first cut (LMB-07); revisit with the escape rate |
| Load-time goal (AGENTS.md) | Loading a model takes time and memory | Background warm-up; templates serve until ready (LMR-03) |
| D-09 and rich NPCs | A model could make NPC speech feel more aware of V | The aware parts are fixed frames the model does not write (LMB-06) |
| Determinism and freedom | Fresh words each time feel alive; a frozen record feels fixed | Freshness lives in pools and in pre-release rendering; released words are the record (LMD-03) |
| Quality and cost | Stronger models fail less but need more hardware | Qualification and an audited list (LMR-07); the design does not depend on a bigger model (LME-02) |
| Authors' effort and the "no ceremony" rule (AGENTS.md) | Gates, ledger, qualification, packs | Each is small, deterministic and testable without a model; the whole path is optional and off by default |

## 9. Lateral links

- **A model call is a layer-2 draw whose value is text.** S2 §3.4 records each draw in the instance state and a reload re-uses it. The render ledger is that rule applied to words.
- **`structureHash` already excludes text.** S2 §12.3 lets a text-only edit change wording without changing structure. LMD-06 is the same separation, for model words.
- **Hua and Raley's players are the symbolic layer, done by hand:** they revert, edit and re-state facts so a model keeps a story straight. The engine's record does that for them.
- **The gate pipeline is the lint list applied to rendered text.** The same checks apply to a human-written line and a model-written one (D21 MIX-02).
- **The audited list is the pack manifest's rights block, applied to a model.** It names a file, a hash and what it is allowed to do.
- **A pool of generated alternates is an authored alternate set** (S2 §7.2), drawn by the same rule.
- **Mode T is the authoring assistant of dossier 16 running on the player's machine,** with the gates standing in for the reviewer.
- **Qualification is the fit report for a model:** it says in plain words what the model can safely be asked.

## 10. Open questions

1. **Do the host's AI tags cover text a player's machine generates at play time?** D19 did not find it stated. It asks whether the engine itself takes a tag if it ships a model path (D19 open question 3). Ask the host's moderators when the page is drafted.
2. **Which local model sizes can pass the gates on this engine's briefs?** Nothing I read tests this. M22-04 and M22-06 answer it.
3. **How good is the entailment gate on relation errors?** TRUE reports strong averages over 11 datasets; the engine's briefs are different, and the gate is untested here.
4. **What does a local runner cost a game this heavy?** NVIDIA's figures are about memory, and only for its own models. The first booked session measures frame time, start-up and memory (M22-11).
5. **Can a small model respect a grammar-constrained template without losing quality?** Tam and colleagues' result is for reasoning tasks; ours is a constrained rewrite.
6. **Is a consented in-app download of a model acceptable?** AGENTS.md prefers doing things for the player with consent; D19 SHP-02 says only users add. A decision for the maintainer.
7. **Should a remote Mode R ever be offered?** The privacy cost is real and the benefit over Mode T unproven.
8. **Can a model render a told story's parts from the teller's own record?** Not in the first cut. A test of LMF-05 on teller-bound atoms would tell.
9. **Do players perceive generated pools as variety?** The sort test (M21-01) and repeated-frame detection (M21-03) on generated lines.
10. **Is a short disclosure on a generated line wanted in the fiction, or only in Details?** Details only, for now; the honest voice rule (S2 §8.8) argues against in-fiction notices.
11. **What licence terms follow a player's chosen model, and do they restrict game use?** Not read. The player chooses the model, and the add-on's page should say so.
12. **Does the EU marking duty reach a free mod with a model adapter?** D19's open question 7, not resolved.
13. **Does a pack's licence (for example a no-derivatives term) forbid Mode T?** `aiUse` lets an author say so, but a pack with no `aiUse` is ambiguous. Default it to `local`.

## 11. Testing agenda

### 11.1 Offline, on the reference model, with no inference (do first)

1. **The metamorphic test** (M22-01). Add a stub renderer and a tape to the reference model. Run every fixture with the stub, a different stub and no model, and compare structural hashes.
2. **Reload.** Save after release, load, compare text, with the model on and off (M22-02).
3. **Gate tests with hand-made candidates.** Write a set of good and faulty candidates for each gate (a swapped agent, a negation, a number word, a quotation, a brand, a causal clause, a flipped tone, a second-person mental verb, a copy of an exemplar) and check each is caught or passed as expected. No model is needed (M22-06).
4. **Brief audit.** A script that checks every brief field has a declared source and that no value, name, facet or game text is present (M22-12).
5. **No-socket check.** A default install, and one with the local runner enabled, opens no socket beyond the pipe (D19 T-05).
6. **Lint.** Run L-131 to L-137 over invented fixtures: a `modelOk` unit with no fallback, on an authored-source class, on a `mustReach` beat, with a possible minor in the cast, with an exemplar that is game text.

### 11.2 With a model, away from the game (the maintainer's machine, later)

- **The qualification run** on two or three candidate models, local and, if wanted, one service. Report the pass rate and the reject mix (M22-13).
- **The escape audit.** A panel reads 500 gate-passed lines per model against the briefs (M22-04).
- **Voice and sameness.** Voice attribution on generated lines, diversity across speakers, and the sort test against authored and assembled lines (M22-05; M21-01).
- **Time to render.** Tokens per second and time to first token on the actual machine, for the budget table (§5.6).

### 11.3 In the game: one prepared session (the maintainer runs it)

A checklist to add to a booked session, not a new one:
- frame time, GPU memory and start-up time with the runner off, warming and generating (M22-11);
- whether the runner pauses in combat and resumes in menus as designed;
- whether a message pre-rendered during play is ready at release;
- friction log: anything awkward about installing, enabling, qualifying or switching off the model.

### 11.4 Longitudinal, with early testers

Whether testers can tell the lines apart, whether they find the model setting understandable, how often the fallback shows, and whether any generated line was reported as wrong, with the brief to hand.

## 12. Requirements

Requirement IDs are `S22-S2-nn` (language and lint), `S22-S7-nn` (the rendering layer's model adapter) and `S22-P7-nn` (runtime: the companion process, local inference, budgets). Lint numbers are provisional and continue S2 §11.1 (L-131 onwards; the last used is L-130).

### 12.1 S2 (language and lint), for v0.15

| ID | Requirement | Principles |
|---|---|---|
| S22-S2-01 | A text unit may carry `modelOk: 'phrasing' \| 'delivery' \| 'both'`, a `brief` block (required and allowed atoms, slots with grammatical metadata, forbidden list, exemplar refs, length by form, tone) and an `aiUse` of `none`, `local` or `allow` (default `local`). Absent `modelOk` means no model | LMB-07, LMB-08, LMP-08 |
| S22-S2-02 | Lint L-131 (error): a `modelOk` unit without a model-free `says` that leaves the same facts. Extends L-100 | LMD-05 |
| S22-S2-03 | Lint L-132 (error): `modelOk` on a unit in an authored-source class, with `authored: 'human'`, in an `AuthorFill` slot, in an offer, response or attribution template, on a `mustReach` carrier, in a humour frame, as a told-story evaluation, in a system, narrator or news voice, or on a fragment tagged at intensity 2 or 3. Extends L-97 and L-116 | LMB-06, LMB-07, LMP-02 |
| S22-S2-04 | A new invariant **S2-I-15, words do not steer**: no draw, id, transition, wake-up, predicate, hook input, tie-break or structural record field reads rendered text, whether a model ran, or the model settings | LMD-06 |
| S22-S2-05 | A new invariant **S2-I-16, released words are immutable**: the text of a released delivery, whatever its origin, is not replaced. A text-only pack edit reaches only lines not yet released (amends §12.3 for generated lines) | LMD-03, LMD-08 |
| S22-S2-06 | A **render ledger** in the persisted instance state: `renders: Record<RenderKey, RenderEntry>`, written at release, write-once, compactable for terminal seeds to the lines still displayed. `Delivery` gains `render?: RenderKey`. Pool items of a generated pack are ids referenced by draws | LMD-03, LMD-04 |
| S22-S2-07 | `origin` is per instance: a ledger entry and a generated-pack unit carry `origin: generated` with a model reference. A generated pack lives beside the saves and is referenced by id and hash. A missing item is treated like a missing pack (§12.3) | LMP-01 |
| S22-S2-08 | Lint L-133 (error, at cast time): a model render when the cast binds a person whose `ageClass` is not adult (or is missing). The renderer falls back to the template | LMB-07 |
| S22-S2-09 | Lint L-134 (error): a `brief` with no required atom; an exemplar that is a `GameRef` text; a brief field that reads a `director → v` belief. Extends L-57 and L-114 | LMB-03, LMB-05, LMP-04 |
| S22-S2-10 | `SettingsSet.text.model`: `off`, `local` or `service`, a per-class allow list, per-pack and per-speaker switches. The `setting` atom cannot read them (L-136, extends L-61) | LMR-06, LMD-06 |
| S22-S2-11 | A fit-report section for model-eligible units: the fallback form present, the classes excluded, the qualification outcome per model, and the counts of rendered, fallback and rejected lines by cause | LMD-05, LMR-07 |
| S22-S2-12 | Lint L-135 (error): a text unit whose text carries a quotation or a causal connective without a matching atom, applied to rendered model text. Lint L-137 (warning): a brief that gives pack text to a model when the pack's `aiUse` is `none` | LMF-07, LMP-08 |
| S22-S2-13 | A closed vocabulary of fallback causes for record entries: `disabled`, `warming`, `deadline`, `budget`, `runner-unavailable`, `gates`, `class-excluded`, `minor-cast` | LMD-05 |

### 12.2 S7 (the rendering layer's model adapter)

| ID | Requirement | Principles |
|---|---|---|
| S22-S7-01 | A `ModelRealiser` interface: `render(brief, signal: AbortSignal) → Candidate \| Refusal`, with `local` and `service` backends behind one `ModelBackend`. Cancellation uses `AbortSignal` (architecture contract). One owner of in-flight renders: it deduplicates by brief hash and cancels when the delivery is withdrawn, expired or superseded | LMB-01, LMR-02 |
| S22-S7-02 | Every call is stateless. No conversation history; the voice is restated in each brief | LME-03 |
| S22-S7-03 | A brief builder with a typed schema (§5.3) that reads only declared sources, and compiles a voice card into at most four markers. No value, name, save name, facet or game text | LMB-03, LMB-05, LMP-04, LMR-05 |
| S22-S7-04 | A decoding grammar generated from the brief's slot table: only listed markers, required ones once, no numerals, quotation marks or markup. The engine ships its own grammar generator and does not depend on a backend's JSON-Schema subset | LMF-02 |
| S22-S7-05 | The gate pipeline G0 to G7 (§5.3), deterministic except the small entailment and classifier models, which return verdicts only. Two tries, then the template form. No edit of a rejected line | LMF-01 to LMF-09 |
| S22-S7-06 | Values are substituted by the engine, with agreement from slot metadata, after the gates (dossier 21 S21-S7-07) | LMF-02 |
| S22-S7-07 | A pre-render queue: starts when a delivery is queued, has a deadline from the delivery's earliest release minus the measured render time, yields to user actions, and drops a result on supersession. Fast channels draw from pools | LMR-01 |
| S22-S7-08 | A ledger writer called at release; write-once; entries as §5.3. The game port receives text only after the write | LMD-03, LMD-04 |
| S22-S7-09 | Mode T: a pool builder that runs at idle or install, writes generated phrasings from an authored source, applies a frame-distance floor, and stores them in the generated pack | LMB-08, LMP-01 |
| S22-S7-10 | A stub renderer and a tape (`renderKey → text`) for the reference model; the metamorphic test of M22-01 and the reload test of M22-02 in CI | LMD-07 |
| S22-S7-11 | A fallback path with causes (S22-S2-13) and a "why this line?" answer from the ledger, in the settings voice | LMD-05, LMP-07 |
| S22-S7-12 | A qualification run: trap briefs in six families, a report, and class restriction by result; an audited-list check by model file hash | LMR-07 |
| S22-S7-13 | The text of any model line is lint-checked by the same list as authored text (extends dossier 21 S21-S7-01 stage 6) | LMF-01, LMP-06 |
| S22-S7-14 | A refusal for the excluded classes (LMB-07) at render time, whatever the pack says | LMB-07, LMP-02 |

### 12.3 P7 (runtime: the companion process, local inference, budgets)

| ID | Requirement | Principles |
|---|---|---|
| S22-P7-01 | The model runs in a separate runner process, started by the companion on demand and killed by it. A crash, out-of-memory or hang never reaches the engine except as a fallback cause | LMD-05, LMR-03 |
| S22-P7-02 | The local runner talks over a pipe. No socket is opened by default. The engine ships no model weights. The player points at a model file, and its file hash is recorded in each entry | LMR-02, LMP-03 |
| S22-P7-03 | Resource caps: GPU memory, system memory and threads, set by the player with safe defaults, and a low priority for the runner | LMR-03 |
| S22-P7-04 | A scheduler: render during loading screens, menus, photo mode and idle; pause in combat and under load; resume afterwards. It reads only the game port's session states and aggregate frame time, and stores neither (D12 PRV-03) | LMR-03 |
| S22-P7-05 | A frame-time watchdog that turns the runner off if the game's frame time degrades beyond a threshold [J], with a plain notice once per branch (S2 §12.2's notice pattern) | LMR-03 |
| S22-P7-06 | Lazy warm-up in the background after the world is up. The engine's start and the game's start are never delayed. Until ready, templates serve | LMR-03 |
| S22-P7-07 | A render budget per hour and per class, with back-pressure to the template. Counters are local, aggregated and never uploaded | LMR-04 |
| S22-P7-08 | A remote backend is a separate optional adapter, with its own consent and key entry in settings. A **send log and viewer** show every brief sent; the send log stays local; a per-session switch for Mode R. Content ceilings are applied before sending | LMR-05 |
| S22-P7-09 | The ledger and generated pack are written through S6 persistence with the save, are branch-local, and are compacted without losing a displayed line | LMD-03, LMD-04 |
| S22-P7-10 | A kill switch in the in-game and Studio settings that stops the runner and clears pre-renders at once | LMR-06 |
| S22-P7-11 | A release-build check that the default distribution contains no model, no network call by default and no voice adapter (extends D19 S19-S4-12) | LMP-03 |

### 12.4 Other owners, and briefs for the research queue

| Owner | Ask | Principles |
|---|---|---|
| S4 (packs, via dossier 19) | The manifest's `ai` block gains `aiUse` and a model-eligible unit list; the content card for the model path | LMP-03, LMP-07, LMP-08 |
| P9 (evaluation) | The measures M22-01 to M22-14, with M22-01 and M22-02 in CI, and the escape audit as a standing panel | §7 |
| P10 (tooling) | A view of brief, candidate, gate verdicts and the final line, for authors; a diff of the generated pack | LMF-08, LMB-08 |
| Research queue (meta-coordinator) | **Brief: local-model feasibility.** For two or three current open-weight small models and two inference runners, on the maintainer's hardware, measure: memory with the game running, tokens per second, time to first token, repeatability for a fixed seed on one machine, and the gate pass rate on the trap set. No game text is used | LMR-03, LMD-02 |
| Dossier 16 | Drafting for authors with `origin: assisted` when a person edits | LME-07 |

## Map-miss log

| Field met | Source | Tier I would give it |
|---|---|---|
| **Faithfulness and hallucination detection in text generation** (entailment and question-answering checks, attribution) | Honovich and colleagues 2022; Kasner and Dušek 2024 (abstracts) | Core for this dossier, supporting for S7. It is the main tool for LMF-04 to LMF-06. Not on the map |
| **Constrained and structured decoding** | Willard and Louf 2023; Tam and colleagues 2024 (abstracts); llama.cpp grammars (page) | Supporting. Shapes LMF-02 |
| **Reproducibility and nondeterminism of model inference** | Atil and colleagues 2024 (abstract); He and colleagues 2025 (page) | Core for S2-I-1 and S2-I-6 under language models. Not on the map |
| **On-device small-model inference beside a game, and resource contention** | NVIDIA developer blog and GeForce news (pages) | Supporting for P7. The evidence is vendor claims only, with no contention data |
| **Persona and instruction drift, multi-turn degradation** | Li and colleagues 2024; Laban and colleagues 2025 (abstracts) | Supporting. Shapes LME-03 |
| **Data-to-text generation and content planning** | Puduppully and colleagues 2018; Wiseman and colleagues 2017 (abstracts) | Supporting under EXP-03. Shapes LME-06 |
| **Live-generated content rules on a game store** | Steamworks Content Survey (page) | Supporting under ETH-17 and dossier 19 |
| **Model-driven NPC products and mods** (Inworld, Convai, NVIDIA ACE, Mantella) | Convai docs, NVIDIA pages, Mantella README (pages); Inworld (summary only) | Peripheral to supporting. The evidence is thin and mostly vendor-made |
| **Prompt injection through untrusted pack text** | None read | Supporting under ETH-10 and S4. LMP-06 says only that the model has no tools, as a hypothesis |
| **Licences of open-weight models** | None read | Supporting under ETH-16 and dossier 19 MM-4 |
| **Faithfulness benchmarks for long stories** (for example sampling-based self-checks) | Not read | Peripheral |
| **Map corrections** | None. The map's SEL-11 and ETH-10 citations checked out; a lens claim about an AI game master and one about an AI Dungeon date did not fully (§3.3) | Note in the lens, not on the map |

## Corrections after credit verification

| Source | What this dossier said | What the source shows |
|---|---|---|
| The Register, on AI Dungeon | Author not shown | The article names Katyanna Quach; the canonical URL differs from the one cited |
| NVIDIA ACE (GeForce page) | "Shipped" | The page is a pre-launch announcement of a launch date: a vendor claim, not a shipped result |

## Credit candidates

Each work below taught us something used in the principles. Authors are as the source pages show them; links were retrieved in this session.

| Creator | Title | Link | What we learned |
|---|---|---|---|
| Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris, Percy Liang, Michael S. Bernstein | "Generative Agents: Interactive Simulacra of Human Behavior", arXiv 2304.03442 | https://arxiv.org/abs/2304.03442 | The authors' own account of retrieval failures, embellishment, instruction-tuned habits and the cost of running many model agents |
| Yingpeng Ma, Jianhao Yan, Bei Shi, Ka Hou Kam, Runnan Wang, Xuebo Liu, Yulong Chen, Yue Zhang, Derek F. Wong | "Can LLM Agents Stick to the Script? A Benchmark for Long-Horizon Consistency in Interactive Narratives" (ICML 2026) | https://arxiv.org/abs/2608.08160 | Fluent output does not guarantee that narrative commitments are kept over a long run (abstract only) |
| Junjie Li, Xinrui Guo, Yuhao Wu, Roy Ka-Wei Lee, Hongzhi Li, Yutao Xie | "Lost in Stories: Consistency Bugs in Long Story Generation by LLMs" (Findings of ACL 2026) | https://aclanthology.org/2026.findings-acl.410/ | Where long-story inconsistencies concentrate (abstract only) |
| Yuqi Chen, Sixuan Li, Yunfeng Cai, Xueai Li, Ka Man Yan, Ying Li | "When Stories Evolve: Benchmarking LLM Storytelling Across Agent Architectures in Open-Ended World Simulations", arXiv 2608.15654 | https://arxiv.org/abs/2608.15654 | Coherence, richness and sustained generation are separate capacities, and scale mainly improves the last (abstract only) |
| Yufei Tian, Tenghao Huang, Miri Liu, Derek Jiang, Alexander Spangher, Muhao Chen, Jonathan May, Nanyun Peng | "Are Large Language Models Capable of Generating Human-Level Narratives?", EMNLP 2024 | https://arxiv.org/abs/2407.13248 | Model stories skew positive and lack tension, which a tone gate must catch (abstract only) |
| Anil R. Doshi, Oliver P. Hauser | "Generative AI enhances individual creativity but reduces the collective diversity of novel content", *Science Advances* 10(28), 2024 | https://doi.org/10.1126/sciadv.adn5290 | Model help made individual stories better and the set of stories more alike |
| Vishakh Padmakumar, He He | "Does Writing with Language Models Reduce Content Diversity?", ICLR 2024 | https://arxiv.org/abs/2309.05196 | Diversity fell for one tuned model and not another (abstract only) |
| Maan Qraitem, Kate Saenko, Bryan A. Plummer | "PersonaWeaver: Controllable Diversity Beyond Conventional Archetypes in Procedural Character Generation", arXiv 2609.26629 | https://arxiv.org/abs/2609.26629 | Model-generated characters are homogeneous and agreeable unless behaviour is specified separately from world building (abstract only) |
| Kenneth Li, Tianle Liu, Naomi Bashkansky, David Bau, Fernanda Viégas, Hanspeter Pfister, Martin Wattenberg | "Measuring and Controlling Instruction (In)Stability in Language Model Dialogs", COLM 2024 | https://arxiv.org/abs/2402.10962 | Instruction drift appears within a few rounds, so each render should be a fresh call (abstract only) |
| Philippe Laban, Hiroaki Hayashi, Yingbo Zhou, Jennifer Neville | "LLMs Get Lost In Multi-Turn Conversation", arXiv 2505.06120 | https://arxiv.org/abs/2505.06120 | Multi-turn use lost much of single-turn performance, mostly as unreliability (abstract only) |
| Zdeněk Kasner, Ondřej Dušek | "Beyond Traditional Benchmarks: Analyzing Behaviors of Open LLMs on Data-to-Text Generation", ACL 2024 | https://aclanthology.org/2024.acl-long.651 | Most outputs of open models writing from structured records contained a semantic error (abstract only) |
| Sam Wiseman, Stuart M. Shieber, Alexander M. Rush | "Challenges in Data-to-Document Generation", EMNLP 2017 | https://arxiv.org/abs/1707.08052 | Fluent neural output can lose to simple templates on some measures (abstract only) |
| Ratish Puduppully, Li Dong, Mirella Lapata | "Data-to-Text Generation with Content Selection and Planning", arXiv 1809.00582 | https://arxiv.org/abs/1809.00582 | The content-plan-then-text pattern for text from structured data (abstract only) |
| Berk Atil and twelve co-authors | "Non-Determinism of 'Deterministic' LLM Settings", arXiv 2408.04667 | https://arxiv.org/abs/2408.04667 | Settings called deterministic still gave non-repeatable output (abstract only) |
| Horace He and others at Thinking Machines | "Defeating Nondeterminism in LLM Inference" | https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/ | Varying batch size is the main cause of run-to-run differences in served models; batch-invariant kernels remove them at a cost in speed |
| Brandon T. Willard, Rémi Louf | "Efficient Guided Generation for Large Language Models", arXiv 2307.09702 | https://arxiv.org/abs/2307.09702 | Grammar-guided decoding can guarantee the form of generated text (abstract only) |
| Zhi Rui Tam, Cheng-Kuang Wu, Yi-Lin Tsai, Chieh-Yen Lin, Hung-yi Lee, Yun-Nung Chen | "Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models", arXiv 2408.02442 | https://arxiv.org/abs/2408.02442 | Format constraints can cost reasoning accuracy, so constrained wording must be measured (abstract only) |
| llama.cpp project | Grammar (GBNF) documentation | https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md | A grammar facility for constraining output, with a limited JSON-Schema subset and a speed caveat |
| Or Honovich, Roee Aharoni, Jonathan Herzig, Hagai Taitelbaum, Doron Kukliansy, Vered Cohen, Thomas Scialom, Idan Szpektor, Avinatan Hassidim, Yossi Matias | "TRUE: Re-evaluating Factual Consistency Evaluation", NAACL 2022 | https://arxiv.org/abs/2204.04991 | Entailment-based and question-answering-based checks perform strongly and complementarily at checking generated text against its source (abstract only) |
| Kaige Xie, Mark Riedl | "Creating Suspenseful Stories: Iterative Planning with Large Language Models", EACL 2024 | https://arxiv.org/abs/2402.17119 | Models are unreliable at suspense without a planning scaffold (abstract only) |
| Yi Wang, Qian Zhou, David Ledo | "StoryVerse: Towards Co-authoring Dynamic Plot with LLM-based Character Simulation via Narrative Planning", FDG 2024 | https://arxiv.org/abs/2405.13042 | The model-as-planner design, shown as a proof of concept, which this engine declines (abstract only) |
| Andrew Zhu, Lara J. Martin, Andrew Head, Chris Callison-Burch | "CALYPSO: LLMs as Dungeon Masters' Assistants", AIIDE 2023 | https://arxiv.org/abs/2308.07540 | Dungeon Masters found model text usable as presented and its ideas rougher, with a human in the loop (abstract only) |
| Jaewoo Song, Andrew Zhu, Chris Callison-Burch | "You Have Thirteen Hours in Which to Solve the Labyrinth: Enhancing AI Game Masters with Function Calling" | https://arxiv.org/abs/2409.06949 | Function calling improved state-update consistency for a model game master (abstract only) |
| Samuel Gehman, Suchin Gururangan, Maarten Sap, Yejin Choi, Noah A. Smith | "RealToxicityPrompts: Evaluating Neural Toxic Degeneration in Language Models", Findings of EMNLP 2020 | https://arxiv.org/abs/2009.11462 | Models can degenerate into toxic text from innocuous prompts, and no method is failsafe (abstract only) |
| Hakan Inan and ten co-authors | "Llama Guard: LLM-based Input-Output Safeguard for Human-AI Conversations", arXiv 2312.06674 | https://arxiv.org/abs/2312.06674 | A classifier with an adjustable taxonomy as a backstop for model output (abstract only) |
| Minh Hua, Rita Raley | "Playing With Unicorns: AI Dungeon and Citizen NLP", *Digital Humanities Quarterly* 14(4), 2020 | https://dhq.digitalhumanities.org/vol/14/4/000533/000533.html | Players of a model-driven story game revert, edit and re-state facts by hand to hold a story together |
| The Register (author not shown in the part read; the lens names Katyanna Quach) | Report on AI Dungeon's content problems, filter and moderation, 8 October 2021 | https://www.theregister.com/2021/10/08/ai_game_abuse/ | What went wrong when a model-driven game filtered output after launch, and what the developer changed |
| Convai | Documentation, "How narrative design works" (Unity SDK) | https://docs.convai.com/api-docs/plugins-and-integrations/convai-unity-sdk/features/narrative-design/how-narrative-design-works | A commercial model-driven NPC product structures its narrative as an author-defined graph that the game drives |
| NVIDIA | Developer blog on an on-device small language model for game character roleplay; GeForce news on ACE in inZOI and Naraka | https://developer.nvidia.com/blog/deploy-the-first-on-device-small-language-model-for-improved-game-character-roleplay ; https://www.nvidia.com/en-gb/geforce/news/nvidia-ace-naraka-bladepoint-inzoi-launch-this-month/ | Vendor claims for a 4B on-device model at about 2 GB, and a shipped opt-in on-device feature on RTX GPUs only |
| Valve | Steamworks documentation, Content Survey, Part 3 (generative AI content) | https://partner.steamgames.com/doc/gettingstarted/contentsurvey | A store distinguishes pre-generated from live-generated content and asks for a description of guardrails on the latter |
| art-from-the-machine | Mantella (repository) | https://github.com/art-from-the-machine/Mantella | A community mod that wires speech-to-text, a model and speech into Skyrim and Fallout 4, with a warning that its development version is error-prone |
