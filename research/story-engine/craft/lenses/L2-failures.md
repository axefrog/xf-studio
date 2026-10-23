# Lens L2: failures

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise. Its patent remarks are out of scope: the Story Engine does no patent searches for its own ideas ([D-20](../../decisions.md)).

**Method note.** Run on 22 October 2026 by one agent working alone, using web search and page fetch only. About 60 searches and about 45 page fetches. Roughly a dozen fetches failed or were blocked (Grand Text Auto, Giant Bomb, the Wayback Machine, one Nexus forum, a few PDFs), so a handful of claims rest on search-result summaries of a page I could not open. Those are tagged **[sec]**. Other tags: **[dev]** developer or author statement, **[crit]** critic or reviewer, **[comm]** player-community post (weakest), **[acad]** academic paper or thesis. Claims I could not corroborate are said to be unverified rather than dropped. Canonical books in Part B (Jacobs, Goffman, Meadows, McKee, Johnstone, the TTRPG rulebooks and similar) are cited from memory and were not re-checked online unless a URL is given. Every URL below was returned by a search or fetch in this session. No other file was read or written, and no other lens output was consulted.

---

## Part A: failure cases (27)

A shorthand used below: "the system" means the story-staging system described in the brief (observe the player, make offers, never control; city simulated at several levels of detail; authored content fitted into the living city).

### A1. Oblivion's Radiant AI (2006): autonomy that ate the authored content
- **Attempted.** NPCs were given goals (eat, sleep, work, steal) and left to pursue them, sold as a living world.
- **What went wrong.** Bethesda toned it down because emergent behaviour disrupted designed content. Most of the wildness was killing and stealing, which sometimes emptied areas and removed things the player needed. In testing, a skooma-dealing merchant needed by a Dark Brotherhood quest was found dead, killed by addicts who wanted his drugs. Designer Emil Pagliarulo is reported as describing the NPCs' penchant for murder and theft. The same writer thinks the shipped game then felt sedated and scripted (opinion). Skyrim's later answer was the blunt "essential" flag: NPCs tied to later quests cannot be killed at all (UESP documents the flag; the complaint that it undercuts the sandbox is from player forums [comm, sec]).
- **Root cause.** Agents optimised local goals with no representation of which facts the authored story depended on. Nothing at world scale checked that content could still be completed.
- **Missing knowledge.** Experience (drama) management that knows story-critical state (F1); simulation testing against invariants (F21); agent-based-modelling practice (F9).
- **Sources.** GamesBeat, "Dimming the Radiant AI in Oblivion", 17 Dec 2010 [dev quotes, writer's opinion]: https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/ . UESP, Skyrim: Essential NPCs: https://en.uesp.net/wiki/Skyrim:Essential_NPCs .

### A2. Skyrim's Radiant Story (2011): the response that makes sense but isn't fun
- **Attempted.** Generated quests that pick giver, target and location from the player's history, so content follows the player.
- **What went wrong.** Bruce Nesmith's own account: making the world respond to the player was far harder than expected; job quests felt mechanical so they were restricted to fitting NPCs such as innkeepers; repetition forced custom lines per voice type; some reactions fired too often (townspeople swarming whenever the player dropped an item); a "that's my stolen item" reaction was cut because players ended up killing the NPC every time. His lessons: a response that is realistic is not necessarily good gameplay, and a generated main quest would be far less compelling than a hand-made one. Player guides describe faction radiant quests as quickly repetitive and uninspired.
- **Root cause.** The generator filled what, where and who but supplied no why-now or stake. Reactions were specified without a model of frequency, tone or the player's attention.
- **Missing knowledge.** Quest design theory with motive (F5); habituation and pacing (F12); mixed-initiative offer timing (F11).
- **Sources.** GamesBeat (VentureBeat original), "Bethesda's Nesmith reflects on the difficult birth of Skyrim's 'Radiant Story' system", 27 Jan 2012 [dev]: https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/ . Player critique via search summary [comm, sec]: https://cyberpost.co/are-skyrim-quests-repetitive/ .

### A3. Fallout 4's Minutemen radiant quests (2015): an offer generator with no memory of what it just offered
- **Attempted.** Endless generated "a settlement needs help" jobs, so the Minutemen always have something for you.
- **What went wrong.** They keep coming, carry time limits, and land in the quest log whether wanted or not, delivered with one repeated line. A critic notes the game assigns them without regard to where the player has been or what else they are doing. The line became a meme within weeks. One forum poster claims the chance of an attack at an owned settlement is the same however well defended it is (unverified [comm]). Even a sympathetic defence concedes the only remedy is to ignore the offer and accept a failure message.
- **Root cause.** No model of the player's current activity, no cap or decay on repeated offers, no state linking the offer to the settlement's actual condition.
- **Missing knowledge.** Mixed-initiative interruption management (F11); self-determination research on controlling versus informational prompts (F22); habituation (F12).
- **Sources.** Inverse, Justin Andress, 19 Apr 2016 [crit]: https://www.inverse.com/article/14519-an-ode-to-preston-garvey-the-minuteman-of-fallout-4-who-deserves-a-defender . Know Your Meme, "Another Settlement Needs Our Help" (dates the meme) [comm, sec]: https://amp.knowyourmeme.com/memes/another-settlement-needs-our-help .

### A4. Starfield's procedural points of interest (2023)
- **Attempted.** Scale: a large number of planets filled by placing handmade locations procedurally.
- **What went wrong.** A reviewer calls the discoverable sites copy-and-paste jobs from a handful of prefabricated designs; clearing the same labs and outposts becomes a repetitive rhythm; many side quests are fetch or delivery. A forum observer's useful distinction: the placement is procedural but the content inside each site never varies, so a revisit shows the same interior, enemies and loot [comm, sec].
- **Root cause.** Variation lived in where a site appears, not in what happened there. Nothing inside a site depended on world history, so no two felt caused by anything.
- **Missing knowledge.** Perceptual variety (F4); environmental storytelling (F7).
- **Sources.** DSOGaming, Nick McCaskey review, 1 Feb 2024 [crit]: https://www.dsogaming.com/special/reviews/starfield-review-a-galactic-letdown/ . Forum observations via search summary [comm, sec]: https://steamcommunity.com/app/1716740/discussions/0/3824174554260086093/ .

### A5. No Man's Sky at launch (2016): ten thousand bowls of oatmeal
- **Attempted.** A vast set of generated planets and creatures.
- **What went wrong.** The review argues planets feel alike because a limited set of variables produces them ("infinite space does not equal infinite possibilities") and that players eventually notice rules such as creatures having a limited number of legs or eyes. It cites Kate Compton's point that mathematically unique output can be perceptually identical, and compares the launch hype to Spore.
- **Root cause.** Variation was counted in parameter space, not in perceived difference or in effect on play.
- **Missing knowledge.** Perceptual variety and expressive-range analysis (F4).
- **Sources.** Vice, Emanuel Maiberg, 21 Aug 2016 [crit]: https://www.vice.com/en/article/no-mans-sky-review/ . Katherine Cross, Game Developer, 27 Feb 2017, on Compton's talk [crit]: https://www.gamedeveloper.com/design/practical-procedural-generation-for-everyone- . Emily Short, "Bowls of Oatmeal and Text Generation", 21 Sep 2016: https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/ .

### A6. Watch Dogs: Legion's "play as anyone" (2020): content written for an unknown actor
- **Attempted.** Every pedestrian recruitable and playable, each with a generated job, traits, relationships and schedule.
- **What went wrong (developers' own account).** Writers could not know a character's age, gender, occupation or traits, so scripts could not refer to them; early fully procedural prototypes lacked narrative momentum; permadeath meant every character had to be treated as temporary; dialogue had to be written for 20 persona variants; cutscenes could not be pre-rendered; new recruits commented on everything for the first time, which became overwhelming until cooldowns were added; missions interrupted each other until a "player attention" system made missions request a calm moment. Generating a person from their job risked reinforcing professional, racial and gender stereotypes, so the team sometimes starts from other traits. The team added authored "Anchor" characters (mostly antagonists) for continuity and shared goals, and used recruitment missions as the only place to tell a story about a specific person. I found no reviewer complaint about generic dialogue in this search; the evidence here is developer-side.
- **Root cause.** Authored story and generated person met at an interface too thin to carry meaning. Generic lines or an exploding variant matrix were the only options, and pacing among competing missions had no owner.
- **Missing knowledge.** Controlled authoring and generation of text (F6); mixed-initiative timing (F11); dramaturgy on persistent protagonists and antagonists (F17).
- **Sources.** Game Developer, Justin Carter, 31 Mar 2023, on Hennessy's GDC 2023 talk [dev]: https://www.gamedeveloper.com/marketing/how-i-watch-dogs-legion-i-made-ubisoft-rethink-its-storytelling . Game Developer, "How Watch Dogs: Legion's Play as Anyone simulation works" [dev]: https://www.gamedeveloper.com/design/how-watch-dogs-legion-s-play-as-anyone-simulation-works .

### A7. The Nemesis system (Shadow of Mordor 2014, Shadow of War 2017): a personal-memory layer on top of unrelated missions
- **Attempted.** Procedurally generated enemy captains who remember you and rise, betray and return.
- **What went wrong.** Design director Michael de Plater's postmortem, as reported: the idea began as simple "personal villains", then feature creep (faction morale and discipline bars, warring fiefdoms) cluttered the interface and pulled it from the core, and the team lacked data showing the core systems would work, so effort went into peripheral features. The team did not communicate the promise clearly, making the game feel more mechanical than intended; players sharing stories helped others "get it". For the sequel, a reviewer says the missions are short, plain and repetitive and the Nemesis system does not apply to them [sec]; another notes recycled sound and combat that blurs individual orcs together. Note also a granted US patent (Warner Bros., No. 10,926,179, Feb 2021) on a method in which a non-player character's parameters change based on avatar interactions; check scope before building something Nemesis-like.
- **Root cause.** The memory system gave individual enemies a history, but the rest of the content did not read from or write to it, and the system's causes were not shown clearly to players.
- **Missing knowledge.** Dramaturgy of causal chains (F17); explanation design (F25); story-world coupling across content types.
- **Sources.** Kotaku, Yannick LeJacq, 22 Jan 2015, on de Plater's Gamasutra postmortem [dev]: https://kotaku.com/shadow-of-mordors-nemesis-system-couldve-been-way-more-1681120649 . Windows Central review [crit, sec]: https://www.windowscentral.com/middle-earth-shadow-war-xbox-one-review . GadgetMatch review [crit, sec]: https://www.gadgetmatch.com/middle-earth-shadow-war-review-system-overload . Patent: https://www.patentarcade.com/video-game-patent/US10926179/nemesis-characters-nemesis-forts-social-vendettas-and-followers-in-computer-games .

### A8. Shadow of War's endgame (2017 to 2018): business model bending the pacing of a systemic game
- **Attempted.** A generated-army endgame ("Shadow Wars") plus purchasable army items.
- **What went wrong.** A reviewer's opinion: the endgame seemed tailor-made to push impatient players toward loot boxes. Monolith later removed the microtransactions and streamlined the endgame (July 2018). Coverage of the reason is split between "backlash" and "plan all along"; I could not retrieve Monolith's own stated reason.
- **Root cause.** Pacing and difficulty of the generated content were tuned partly to a revenue goal, so the pacing the system produced was not the pacing the fiction needed.
- **Missing knowledge.** Motivation psychology and incentive alignment (F22); experience management with an explicit pacing target (F1).
- **Sources.** PCWorld, 17 Jul 2018 [crit]: https://www.pcworld.com/article/402284/middle-earth-shadow-of-war-loot-boxes-end-game.html . PCGamesN, 17 Jul 2018: https://pcgamesn.com/middle-earth-shadow-of-war/shadow-of-war-removes-microtransactions-loot-boxes .

### A9. Cyberpunk 2077's living city (2020): a promised simulation replaced by spawning
- **Attempted.** A dense dystopian city with NPC routines, reactive crowds and a police system that responds to crimes.
- **What went wrong.** Players complained police appeared out of nowhere, often behind them. CD Projekt said patch 1.2 would reduce spawning behind the player and make police take time to arrive, with a recon drone to suggest assessment. A Bloomberg report (Jason Schreier, 16 Jan 2021), as relayed, said the police AI was poor because it was added late, and that features shown in the 2018 demo were unfinished and many did not ship. Secondary lists of cut features say police spawn near the player rather than witnessing crimes, and that killing civilians does not change how NPCs treat you; another piece says NPCs out of the player's line of sight vanish, emptying a block with a turn of the head [sec]. Critics of the NCPD scanner "hustles" say one-step, one-time jobs sit oddly with the premise [sec, a repost of a ScreenRant piece].
- **Root cause.** The city's causal layer (a crime was committed, so police come) was reproduced by despawn and respawn near the camera rather than by a coarse simulation that continues out of sight. Consequences therefore had no visible causes.
- **Missing knowledge.** Agent-based modelling with consistent coarse and fine levels (F9); urban sociology of everyday life (F19); consequence legibility (F8).
- **Sources.** PureXbox, 19 Mar 2021 (patch 1.2 and the Schreier claim) [dev, sec]: https://www.purexbox.com/news/2021/03/cyberpunk_2077s_patch_1_2_will_attempt_to_fix_the_much_complained_about_police_ai . PCGamesN on the Bloomberg report: https://www.pcgamesn.com/cyberpunk-2077/report-crunch-e3 . Cut-features list (GameBanshee reproduction of PC Gamer) [sec]: https://gamebanshee.com/3hyfc . TechRadar, trailer features not delivered [sec]: https://www.techradar.com/news/cyberpunk-2077-failed-to-deliver-these-five-features-it-had-in-the-teaser-trailers . ScreenRant repost via IMDb [sec]: https://imdb.com/it/news/ni64945571 .

### A10. Ultima Online's dynamic ecology (1997): costly invisible simulation, and a myth about why it failed
- **Attempted.** Predator and prey AI plus per-creature resource values feeding crafting.
- **What went wrong.** Raph Koster, the original lead designer, says the ecology AI was cut during beta because its radial searches and pathfinding were too expensive, not because players wiped out the animals, which he calls a common but wrong story. The real collapse he describes was a closed economy fed by a fixed resource pool: players hoarded wool shirts, the central bank ran out of wool, and sheep could no longer spawn. He credits Zach Simpson's 2000 analysis with popularising "faucet-drain" thinking.
- **Root cause.** A continuous simulation priced without a budget, and resource flows with no designed sink or regeneration under hoarding. The wrong public story shows how hard system failures are to read from outside.
- **Missing knowledge.** Feedback-loop and economy design (F10); simulation levels of detail and budgets (F9).
- **Sources.** Raph Koster, "Did players destroy the UO ecology?" (updated 28 Aug 2024) [dev]: https://www.raphkoster.com/?p=46439 . Zachary Booth Simpson, "The In-Game Economics of Ultima Online", GDC 2000 (archived copy): https://gwern.net/doc/economics/mechanism-design/1999-04-07-simpson-theingameconomicsofultimaonline.html .

### A11. SimCity (2013): a headline agent simulation that behaved like nearest-neighbour rules
- **Attempted.** A city of individually simulated Sims (the publisher cited up to 100,000 per city).
- **What went wrong.** Players showed Sims going to the first available home or job, traffic taking the shortest path regardless of congestion, and side effects at city scale (casinos failing unless placed at the entrance, tourists sent to shopping districts); a residential-only city reached 200,000 residents with no commerce or industry. An anonymous developer told Rock Paper Shotgun the servers did not run the game's simulation. The agents were "mindless" because their rules were trivial, and the gap between the claim and the behaviour made the whole simulation look fake.
- **Root cause.** Aggregate behaviour at scale emerged from trivial agent rules nobody validated against intended city dynamics, and the marketing promised more than the model.
- **Missing knowledge.** Agent-based-model validation (F9); legibility of causes (F25).
- **Sources.** Kotaku, Owen Good, 13 Mar 2013 [crit]: https://kotaku.com/with-simple-ai-like-this-why-does-simcity-need-cloud-c-5990362 . PC Gamer, "SimCity: Inside the GlassBox engine" (developer description; listed by search, not retrieved) [sec]: https://pcgamer.com/simcity-inside-the-glassbox-engine .

### A12. Mass Effect 3's ending (2012): accumulated choices that did not pay off
- **Attempted.** A trilogy-long ledger of player decisions meant to shape the finale.
- **What went wrong.** Critics said the ending made earlier choices inconsequential and left plot holes and no closure. Casey Hudson conceded players deserved more closure; BioWare shipped a free Extended Cut (26 June 2012) with an epilogue that varies by prior choices and an "Effective Military Strength" score, which implies the original ending did not reflect them fully. Reaction to the fix was mixed.
- **Root cause.** The ending was authored as a small number of endpoints rather than a function of the recorded state. Setups were not tracked as debts to be paid.
- **Missing knowledge.** Dramaturgy (setup and payoff) with a ledger (F17); consequence legibility (F8).
- **Sources.** Wikipedia summary with contemporaneous citations (GameFront, Destructoid, Forbes, IGN, Eurogamer, March 2012; Kotaku and Game Informer, June 2012): https://en.wikipedia.org/wiki/Mass_Effect_3_ending_controversy . Reporting on Hudson's explanation and the Extended Cut [crit, sec]: https://www.rpgsite.net/news/1499-bioware-announce-mass-effect-3-extended-cut .

### A13. Façade (2005): hand-authored depth that could not be extended
- **Attempted.** A fully realised interactive drama with free-text input and a beat-based drama manager.
- **What went wrong.** Estimated at two years, it took over five; the authors reached about 30% of their vision. Only about 15 of 27 story beats appear in an average play; the beats comprise roughly 2,500 joint dialogue behaviours; over 800 hand-written rules map player text to about 30 discourse acts, with false positives and literal readings; the experience is about 20 minutes and no sequel followed. Absurd exchanges became a "let's play" attraction.
- **Root cause.** The authoring cost per minute of experience was extreme and the input channel hid what the system could understand.
- **Missing knowledge.** Authorial leverage as a design metric (F1); affordance design so the player knows what the system understands (F8); character-first AI (F24).
- **Sources.** Game Developer, "The story of Façade, the AI-powered interactive drama" [dev, sec]: https://www.gamedeveloper.com/design/the-story-of-facade-the-ai-powered-interactive-drama . Mateas and Stern, GDC 2003 paper: https://faculty.cc.gatech.edu/~isbell/classes/reading/papers/MateasSternGDC03.pdf .

### A14. TALE-SPIN (1976): character-simulation stories, and the "Tale-Spin effect"
- **Attempted.** James Meehan's Yale program simulated characters with goals and wrote the result up as fables ("a story is about a problem and how it gets solved").
- **What went wrong.** James Ryan cites it as a famous failure of emergent narrative (his dissertation abstract, via search summary [sec]). Noah Wardrip-Fruin names the "Tale-Spin effect": a system's internal depth fails to show on its surface, so audiences and critics misread what it does. I could not retrieve the specific "mis-spun" example stories, so I make no claim about them.
- **Root cause.** Simulation traces were rendered nearly verbatim instead of selected and framed, and the system's reasoning was not visible in what it produced.
- **Missing knowledge.** Story sifting and curation (F2); explanation design (F25).
- **Sources.** Wardrip-Fruin, *Expressive Processing* (MIT Press, 2009): https://elmcip.net/node/1540 . Wardrip-Fruin on the effect (page not retrievable; search summary only) [sec]: https://grandtextauto.soe.ucsc.edu/?p=1721 . Meehan, The Metanovel (Yale, 1976): https://elmcip.net/node/3766 ; IJCAI 1977 record: https://mlanthology.org/authors/m/meehan-james-r/ . Sussex course page summarising the design: https://users.sussex.ac.uk/~christ/crs/gc/lec11-slide4.html .

### A15. Generative Agents (Stanford, 2023): believable days, brittle worlds
- **Attempted.** 25 LLM agents in a Sims-like town with memory, reflection and planning.
- **What went wrong (the paper's own sections).** Location choice degraded as agents learned more places (a bar for lunch); agents misread physical norms (entering an occupied single-occupancy bathroom, entering shops after closing); instruction tuning made them overly formal and overly cooperative (one rarely turned down party suggestions and her interests drifted to match); retrieval failures and hallucinated embellishments in interviews; 6 of 453 claims about knowing other agents were hallucinated; robustness to prompt or memory hacking untested.
- **Root cause.** The world state was prose in a model context, not a grounded model; the base model's social habits (agreeableness) leaked into every character; norms had no mechanism.
- **Missing knowledge.** Agent-based-model validation (F9); character-first design (F24).
- **Sources.** Park et al., arXiv 2304.03442 (sections 6.5.2, 7.1.2, 7.2, 8.2) [acad]: https://arxiv.org/abs/2304.03442 ; full text https://ar5iv.labs.arxiv.org/html/2304.03442 .

### A16. LLM narrators and long-horizon commitments (2024 to 2026)
- **Attempted.** A language model as narrator or game master over many turns.
- **What went wrong.** An ICML 2026 benchmark reports even the best tested model kept its story commitments in only 42% of runs after 20 turns, with fact-conflict rates of 40% to 68% across models, and fluent output did not predict consistency. An earlier study of an AI game master found it goes off the rails on rules and flow and needed function calls to keep state under control.
- **Root cause.** Authoritative state lived in the text stream, not in a structured ledger the generator had to consult and update.
- **Missing knowledge.** Simulation-grade state and testing (F21); causal-chain dramaturgy with a commitments ledger (F17).
- **Sources.** Ma et al., "Can LLM Agents Stick to the Script?", arXiv 2608.08160, Aug 2026 [acad]: https://arxiv.org/abs/2608.08160 . Song, Zhu, Callison-Burch, arXiv 2409.06949, Sep 2024 [acad]: https://arxiv.org/abs/2409.06949 .

### A17. AI Dungeon (2021): ungoverned generation, then a blunt filter
- **Attempted.** GPT-3-driven open-ended adventures.
- **What went wrong.** The model inserted sexual and violent content players had not asked for, including a sexualised minor, traced in the report to web-scraped training material. The first filter flagged harmless phrases; the developer then suspended players for content the AI wrote; frozen accounts could not cancel subscriptions; players lost trust and moved to alternatives; the later policy moved to technical barriers on generation.
- **Root cause.** Content governance was added after launch as a filter on output, not designed in as constraints on generation and on what counts as consent.
- **Missing knowledge.** Participatory-design safety and consent practice (F16); simulation testing with adversarial inputs (F21).
- **Sources.** The Register, Katyanna Quach, 8 Oct 2021: https://www.theregister.com/2021/10/08/ai_game_abuse/ . Techdirt case study: https://archive.techdirt.com/articles/20211117/15225347965/content-moderation-case-study-game-developer-deals-with-sexual-content-generated-users-own-ai-2021.shtml . Vice: https://vice.com/en/article/text-adventure-game-community-in-chaos-over-moderators-reading-their-erotica .

### A18. Drama managers: a thirty-year evaluation gap
- **Attempted.** AI that steers an unfolding interactive story toward an author's goals while preserving player freedom.
- **What went wrong.** Chen, Nelson and Mateas (2009) note most drama-management work proposes architectures with abstract evaluation, a smaller body evaluates player experience, and almost none evaluates authorial leverage (whether the manager buys more story variety than script-and-trigger logic at equal authoring cost). Roberts (2011) argues a complete manager needs seven interrelated representational and computational problems solved, usually handled case by case. PaSSAGE's personalised stories improved enjoyment mainly for some player subsets; a Façade-era paper says interactive dramas were small prototypes, which made evaluation methods hard to develop [sec].
- **Root cause.** No accepted way to test "did the manager make the experience better?", and prototypes too small for the test to mean much.
- **Missing knowledge.** Player-experience research methods (F23); authorial-leverage criteria (F1).
- **Sources.** Chen, Nelson, Mateas, AIIDE 2009 [acad]: https://ojs.aaai.org/index.php/AIIDE/article/view/12377 . Roberts, AIIDE 2011 [acad]: https://ojs.aaai.org/index.php/AIIDE/article/view/12472 . Thue et al., AIIDE 2007 [acad]: https://ojs.aaai.org/index.php/AIIDE/article/view/18780 . Roberts and Isbell survey (2008): https://www.cs.uky.edu/~sgware/reading/papers/roberts2008survey.pdf . Façade evaluation paper, AAMAS 2007 (only its abstract was summarised in search results) [sec]: https://www.ifaamas.org/Proceedings/aamas07/html/pdf/AAMAS07_0464_d2a87474872bb6c315649be862b44b8c.pdf .

### A19. Simulated storyworlds without a curator
- **Attempted.** Let stories emerge from simulated characters (The Sims, Dwarf Fortress, academic generators).
- **What went wrong.** James Ryan's dissertation argues raw simulation traces almost always lack story structure. Successful emergent-narrative games succeed largely because players retell their events, while academic generators fail because nobody is moved to. Emily Short disputes the thesis as too simple, adding that interlocking systems, modelled stakes and range of outcomes also decide quality.
- **Root cause.** No stage between the event log and the audience that selects, frames and recounts.
- **Missing knowledge.** Story sifting and curation (F2).
- **Sources.** Ryan, *Curating Simulated Storyworlds*, UC Santa Cruz 2018 [acad]: https://escholarship.org/uc/item/1340j5h2 . Emily Short's review of it: https://emshort.blog/2019/05/21/curating-simulated-storyworlds-james-ryan/ . Kreminski et al., Winnow (AIIDE 2021): https://ojs.aaai.org/index.php/AIIDE/article/view/18903 .

### A20. Generated quests as task lists
- **Attempted.** Quest generators from structural analyses of existing quests.
- **What went wrong.** Doran and Parberry analysed over 750 quests from four MMORPGs and built a prototype generator aiming for quests "plausible to players"; Sullivan, Mateas and Wardrip-Fruin observe that in CRPGs quests are generally lists of tasks with variability only in combat or a binary choice at completion; a PCG textbook chapter quotes Ashmore and Nitsche to the effect that generated content without context and goals becomes insubstantial and tedious [sec].
- **Root cause.** Quest structure was extracted from fetch and kill templates, so generators reproduce the template, not the motive, relationship or consequence that makes a quest matter.
- **Missing knowledge.** Quest theory including motive and player-story levels (F5); dramaturgy (F17).
- **Sources.** Doran and Parberry, PCG workshop 2011 [acad]: https://ianparberry.com/pubs/pcg2011.pdf . Sullivan, Mateas, Wardrip-Fruin, "Making Quests Playable", 2011 [acad]: https://ojs.gold.ac.uk/index.php/lea/article/view/183 . Sullivan dissertation 2012: https://escholarship.org/uc/item/004129jn . Ashmore and Nitsche, DiGRA 2007: https://dl.digra.org/index.php/dl/article/view/312 ; textbook chapter: https://www.pcgbook.com/chapter07.pdf .

### A21. Alien: Isolation (2014): the near-failure that a director fixed
- **Attempted.** A xenomorph that hunts through behaviour trees with no scripted scares, so dread survives replays.
- **What went wrong (and was fixed).** The behaviour tree alone could trap the player in a corner or lose them entirely, and constant tension would tire players until they quit. The fix was a macro director with a "menace gauge" that rises with proximity, line of sight and nearby threats and then pulls the alien back to the vents. The director knows where the player is but only points the alien at the general area, and the alien must still find the player, so it does not visibly cheat. Behaviours unlock over time, but unlock conditions are not tied to player deaths, so players are not punished by rules they cannot learn.
- **Root cause (of the pre-fix problem).** Pure local AI had no model of pacing or of what the player was experiencing.
- **Missing knowledge.** Experience management with fairness rules (F1); consequence legibility (F8).
- **Sources.** Tommy Thompson, Game Developer, 31 Oct 2017 [dev, crit]: https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation . Thompson, 20 May 2020: https://www.gamedeveloper.com/design/revisiting-the-ai-of-alien-isolation . Booth, "The AI Systems of Left 4 Dead" (Valve, 2009): https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf .

### A22. Majestic (EA, 2001): an experience that set its own pace
- **Attempted.** A real-time alternate reality game delivering story by phone, fax, email and instant message.
- **What went wrong.** About 800,000 players tried the free pilot and about 71,200 finished it, with few paying; subscribers fell to about 15,000; EA cancelled in April 2002. Communications director Jeff Brown blamed pacing: players wanted to progress at their own speed but the game set the pace, so many waited for emails and calls. Daily progress was capped. The second episode landed days before 11 September 2001 and EA paused the service because its themes and phone calls felt too real. Some players said the calls were introduced with a disclaimer, which weakened the blur.
- **Root cause.** The system pushed content on its own schedule through intrusive channels and could not be paced by the participant.
- **Missing knowledge.** Mixed-initiative interruption management (F11); ARG and larp design practice (F16).
- **Sources.** Engadget, "The Game Archaeologist: EA's Majestic", 26 Jan 2013 [crit, sec]: https://www.engadget.com/2013-01-26-the-game-archaeologist-eas-majestic.html . Wikipedia: https://en.wikipedia.org/wiki/Majestic_(video_game) (cites GameSpot, CNN Money, New York Times, 2001 to 2002).

### A23. Sleep No More and fragmented immersive theatre
- **Attempted.** Parallel scenes across a large building; each audience member chooses whom to follow.
- **What went wrong.** A critic recalls leaving powerless and uneasy, sure she had missed the important parts, and contrasts it with Punchdrunk's later *The Burnt City*, whose opening guides the audience to a large central space where action starts at once, easing the fear of missing out. Rose Biggin's study treats audience "empowerment" and "choice" in Punchdrunk's work critically.
- **Root cause.** Dispersed story with no shared spine and no way for a participant to know what they missed.
- **Missing knowledge.** Immersive-theatre audience-agency design (F15).
- **Sources.** Duška Radosavljević, review of *The Burnt City* (24 May 2022) [crit]: https://thetheatretimes.com/?p=125901 . Biggin, *Immersive Theatre and Audience Experience* (Palgrave Macmillan, 2017), chapter 3 [acad]: https://www.palgrave.com/gb/book/9783319620381 and https://ophen.org/pub-208132 .

### A24. Star Wars: Galactic Starcruiser (2022 to 2023): responsiveness carried by people
- **Attempted.** A two-night, staffed, story-driven hotel where guests' choices steer storylines.
- **What went wrong.** Reviewers praised improvising cast, but one found his steering toward a different path a sign staff noticed his choices; another said decisions do not always map directly to what follows [sec]. Immersion depended on each guest's effort, and less committed guests made the illusion thinner for others. Disney announced closure in May 2023 after about 19 months; reported causes are price and demand, not story design, so treat the design lesson as partial.
- **Root cause.** Personalisation and causality were produced by human improvisers and committed guests, which does not scale and has no ledger for causes.
- **Missing knowledge.** Immersive-theatre and improv craft (F14, F15); tabletop GM practice for scalable consequence (F13).
- **Sources.** Laughing Place, Mike Celestino, 23 Mar 2022 [crit]: https://www.laughingplace.com/w/articles/2022/03/23/review-star-wars-galactic-starcruiser-can-be-a-transcendent-experience-for-those-willing-to-commit/ . Closure reporting [sec]: https://pastemagazine.com/travel/star-wars-galactic-starcruiser/disney-worlds-star-wars-galactic-starcruiser-is-shutting-down and https://fast.laughingplace.com/w/news/2023/05/25/new-details-on-galactic-starcruiser-closure .

### A25. The quantum ogre (tabletop): choice that changes nothing
- **Attempted.** A game master prepares an encounter and places it on whichever path the party picks.
- **What went wrong.** Critics say it removes meaningful choice since decisions never change what the party faces; defenders say only the felt choice matters. Mike Shea's advice is to prepare parts (secrets, locations, characters, monsters) and assemble during play, selecting by die roll or deliberately, so each path yields a different relevant situation. A 2011 critique by Courtney Campbell is cited as the main one (not retrieved).
- **Root cause.** Content prepared as a fixed object rather than a situation with several entry points; the world did not respond to the declined route.
- **Missing knowledge.** Tabletop GM craft (F13); improv "accepting offers" (F14).
- **Sources.** Mike Shea, Sly Flourish, "Quantum Ogres and the Eight Steps": https://slyflourish.com/quantum_ogres_and_the_eight_steps.html . Search listing citing Campbell [sec]: https://dmdavid.com/tag/faking-choices-for-dd-players/ .

### A26. Parser interactive fiction: hidden affordances
- **Attempted.** Free-text commands with a simulated world.
- **What went wrong.** Graham Nelson's "Bill of Player's Rights" lists protections designers routinely broke: no sudden, unwarned death; hints that need no explanation after the event; being able to win without knowledge from earlier lives. I did not retrieve a source that names guess-the-verb itself, so that example is common knowledge, not a cited finding here.
- **Root cause.** The player could not tell what the system understood or offered.
- **Missing knowledge.** Affordance design and fairness craft from the interactive-fiction tradition (F8).
- **Sources.** Graham Nelson, *The Craft of Adventure* (1995): https://ifarchive.org/if-archive/info/Craft.Of.Adventure.pdf ; summary: https://www.agiwiki.sierrahelp.com/index.php/The_Craft_of_Adventure_-_A_Bill_of_Player%27s_Rights .

### A27. Sunless Sea (2015): consumable story meets restart loops
- **Attempted.** Roguelike permadeath with narrative-heavy storylet play.
- **What went wrong.** Alexis Kennedy calls his biggest mistake the identity mix: punishing early difficulty and permadeath alongside slow CRPG-style story and a flat late game, so players who did not want to repeat the early story were frustrated. A "legacy" system meant to bridge the two still showed a seam, and the reused story engine accumulated special cases.
- **Root cause.** Text consumed once by design was exposed to repeat exposure by the game loop.
- **Missing knowledge.** Storylet and quality-based structure with explicit repeatability (F3); pacing and consumption psychology (F12).
- **Sources.** Alexis Kennedy, "Postmortem: Failbetter Games' Sunless Sea", Game Developer, 4 Mar 2015 [dev]: https://www.gamedeveloper.com/audio/postmortem-failbetter-games-i-sunless-sea-i- .

### Patterns across the cases
1. **Variation measured in the generator, not the player** (A2, A4, A5): fixes need perceptual tests (F4), not more parameters.
2. **Offers without memory** (A3, A6, A22): no model of what was just offered, what the player is doing, or who owns timing.
3. **Autonomy without story awareness** (A1, A9, A21): fixes are a manager that knows story-critical state and obeys fairness rules, plus tests.
4. **Invisible or faked simulation** (A9, A10, A11, A14): costs without credit, or claims that cannot survive inspection.
5. **Consequence without a ledger** (A12, A7, A25): the world cannot show what caused what.
6. **Authoring cost is the binding constraint** (A6, A13, A18).
7. **Generation without governance or state** (A15, A16, A17): language models need external structure.
8. **Human responsiveness does not scale** (A23, A24): live-experience craft still describes the behaviours the system must imitate.

---

## Part B: candidate fields (25)

### F1. Experience (drama) management for interactive narrative
- **Definition.** The AI and design subfield that models a player's unfolding experience and adjusts content toward author goals without removing the player's freedom.
- **Why it matters here.** The system's central job is choosing which offer to make, when, at every scale, while only observing. A1, A18 and A21 show both the failure (no story awareness) and a working fix (director plus fairness rules).
- **Key sources.** Riedl and Bulitko, "Interactive Narrative: An Intelligent Systems Approach", AI Magazine 34(1), 2013 (https://ojs.aaai.org/index.php/aimagazine/article/view/2449). Weyhrauch, *Guiding Interactive Drama*, CMU PhD, 1997. Nelson and Mateas, "Declarative optimization-based drama management in interactive fiction", IEEE CG&A, 2006 (https://www.kmjn.org/publications/DODM_IEEECGA-abstract.html). Roberts and Isbell, survey, 2008. Roberts, "Seven Design Challenges for Fully-realized Experience Management", AIIDE 2011.
- **Instance.** Alien: Isolation's menace gauge: a director that knows more than the alien but may only nudge it toward the general area, and withdraws it when pressure peaks.
- **Principles.** (1) A manager that knows more than any in-world actor must act only through channels an in-world actor could plausibly use; testable by blind replays in which players try to detect "cheating". (2) A manager earns its place only if it yields more story variety than script-and-trigger logic at equal authoring cost (Chen, Nelson, Mateas criteria); testable by counting rules and branching factor. (3) Intensity is a state with recovery: after a peak, the probability of another peak falls for a stated period; testable on telemetry.
- **Failure modes.** The field's own literature concedes the evaluation gap; most systems need hand-built plot-point and evaluation functions; prototypes are small (Façade used about 15 of 27 beats per play); player-type adaptation helped only some players.
- **Relevance.** Core. Confidence 0.9.
- **Surprise.** No.

### F2. Emergent narrative and story sifting
- **Definition.** Letting stories arise from simulated characters, with tools that search the event record for story-shaped sequences and frame them for retelling.
- **Why it matters here.** The simulated city produces far more events than stories. The staging layer must select which traces become offers or recaps (A14, A19).
- **Key sources.** Ryan, *Curating Simulated Storyworlds*, UC Santa Cruz, 2018. Kreminski, Dickinson, Wardrip-Fruin, "Felt: A Simple Story Sifter", ICIDS 2019 (https://github.com/mkremins/felt). Kreminski et al., "Winnow: A Domain-Specific Language for Incremental Story Sifting", AIIDE 2021. Louchart and Aylett, "Solving the narrative paradox in VEs" (IVA 2003) and "FearNot! – an experiment in emergent narrative" (IVA 2005). Wardrip-Fruin, *Expressive Processing*, 2009.
- **Instance.** Winnow runs patterns incrementally, so a story-shaped sequence (a violation of hospitality) can be flagged while it is still unfolding and staged, not just recapped afterwards.
- **Principles.** (1) A sifter over the event log surfaces more events that blind raters judge story-worthy than random sampling does; testable by rater study. (2) Generating events and presenting them are separable stages; testable by swapping presenters over one event log. (3) Detection must be incremental to allow staging in time; testable by measuring lead time before the sequence completes.
- **Failure modes.** Emily Short argues Ryan's account underweights interlocking systems, stakes and outcome range; sifting patterns are hand-written and few; hindsight bias in what looks "story-shaped".
- **Relevance.** Core. Confidence 0.85.
- **Surprise.** No.

### F3. Storylet, quality-based and salience-based narrative structure
- **Definition.** Content built as small units with preconditions over world state ("qualities"), selected by the player (quality-based) or by the system (salience-based).
- **Why it matters here.** It is the natural way to fit human-authored content into a living simulation: each piece states what it needs and what it changes (A27, A13).
- **Key sources.** Emily Short, "Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative Structures", 2016 (https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/). Kreminski and Wardrip-Fruin, "Sketching a Map of the Storylet Design Space", ICIDS 2018. Kennedy, Sunless Sea postmortem, 2015. Ingold, "Narrative Sorcery: Coherent Storytelling in an Open World", GDC (https://gdcvault.com/play/1023989/Narrative-Sorcery-Coherent-Storytelling-in).
- **Instance.** inkle's 80 Days and Sorcery! use defensive logic so the story reads coherently however a player reaches each piece (GDC Vault listing).
- **Principles.** (1) Every unit declares the facts it presupposes and the facts it establishes; testable by a static check that no unit can fire with an unsatisfied reference. (2) Repeatability is an explicit per-unit property; testable by audit. (3) When several units qualify, the most specific wins; testable by shuffling the pool.
- **Failure modes.** Tooling and data sprawl as scope grows (Kennedy); special cases when engines are repurposed; no arc or pacing without a layer above; opaque selection.
- **Relevance.** Core. Confidence 0.85.
- **Surprise.** No.

### F4. Perceptual variety and expressive-range analysis
- **Definition.** The study of how generated variation is perceived, and the measurement of what a generator can and cannot produce.
- **Why it matters here.** "Varied in ways players notice" is a stated requirement; A2, A4 and A5 failed on it.
- **Key sources.** Kate Compton on "10,000 bowls of oatmeal" (Game Developer summary, 2017). Smith and Whitehead, "Analyzing the Expressive Range of a Level Generator", PCG workshop 2010 (https://www.pcgworkshop.com/archive/smith2010analyzing.pdf). Emily Short, "Bowls of Oatmeal and Text Generation", 2016. Shaker, Togelius, Nelson, *Procedural Content Generation in Games*, Springer 2016 (https://www.pcgbook.com).
- **Instance.** Compton kept only seeds that produced appealing Spore planets; her heuristic is to ask whether a player would write fan fiction about the output.
- **Principles.** (1) Variation matters only when tied to mechanics or consequences (Short); testable by whether players sort N outputs into fewer than N groups. (2) Measure expressive range on features humans judge, not on parameters; testable by rater-versus-parameter agreement. (3) Curated seed or content lists beat unconstrained draws; testable by blind preference.
- **Failure modes.** The original metrics (linearity, leniency) suit platformers; perceptual features resist automation; curation does not scale; repetition is acceptable for background content.
- **Relevance.** Core. Confidence 0.9.
- **Surprise.** No.

### F5. Quest design theory and generation
- **Definition.** Scholarship that formalises quests as structures of goals, obstacles, motives and player-story levels.
- **Why it matters here.** Every offer is quest-shaped at some scale; generators that copy task structure produce A2, A3 and A20.
- **Key sources.** Jeff Howard, *Quests: Design, Theory, and History in Games and Narratives*, A K Peters 2008. Ashmore and Nitsche, "The Quest in a Generated World", DiGRA 2007. Doran and Parberry, PCG workshop 2011. Sullivan, Mateas, Wardrip-Fruin, "Making Quests Playable", 2011. Sullivan, *The Grail Framework*, 2012.
- **Instance.** Sullivan's Grail framework selects quest and game-level content with player-history data.
- **Principles.** (1) Every generated offer has a non-empty "because" chain to at least one prior world or player fact; testable by audit of offer records. (2) Variation should live in choices and outcomes, not only combat skin; testable by outcome-set size per offer type. (3) Structural analysis gives plausible shape but not motive, so a motive layer is needed.
- **Failure modes.** Taxonomies derived from MMO fetch and kill quests reproduce them; "quest" frames content as task lists and may exclude non-task story forms.
- **Relevance.** Supporting. Confidence 0.8.
- **Surprise.** No.

### F6. Dynamic dialogue and controlled-authoring text generation
- **Definition.** Rule-matching and template-grammar systems for short lines, with writer-facing control over specificity, repetition and agreement.
- **Why it matters here.** The smallest scale in the brief (a passer-by's worry) is a line or a gesture chosen from facts. Legion also needed names, gender and grammar across languages (A6).
- **Key sources.** Elan Ruskin, "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012 (https://www.gdcvault.com/play/1015528/AI-driven-Dynamic-Dialog-through). Reiter and Dale, *Building Natural Language Generation Systems*, Cambridge UP 2000. Compton, Filstrup, Mateas, "Tracery", 2014. The Legion Game Developer pieces cited in A6.
- **Instance.** Valve's system matches hundreds of world facts against thousands of lines, choosing the most specific rule and falling back to general ones (Emily Short's summary: https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/).
- **Principles.** (1) Most-specific-rule selection plus per-line recency lowers perceived repetition more than random choice; testable by listener studies. (2) Each line is tagged with the facts it presupposes; testable by a static check against the world model. (3) A line about the player's visible state beats a never-heard line; testable by recall.
- **Failure modes.** Authoring explosion (Legion's 20 variants); rule priority conflicts; localisation and gender agreement; language-model text avoids authorship but loses commitments (A16).
- **Relevance.** Supporting. Confidence 0.8.
- **Surprise.** No.

### F7. Environmental storytelling and spatial narrative
- **Definition.** Conveying events through arranged space and props that the audience reconstructs, with roots in theme-park design.
- **Why it matters here.** Mid-scale content (a passing scene, a heist site) must read as caused without cutscenes; A4 shows the failure.
- **Key sources.** Don Carson, "Environmental Storytelling", Gamasutra, 2000. Henry Jenkins, "Game Design as Narrative Architecture", in *First Person*, MIT Press 2004. Harvey Smith and Matthias Worch, "What Happened Here? Environmental Storytelling", GDC 2010 (https://gdcvault.com/play/1012647/What-Happened-Here-Environmental).
- **Instance.** The GDC session's technique of establishing a discernible chain of events players can reconstruct from traces (a slide summary: https://slidetodoc.com/level-design-workshop-what-happened-here-environmental-storytelling/).
- **Principles.** (1) A scene is legible if a viewer can state at least two events and their order from props alone; testable by viewer interviews. (2) Staged traces are true to the simulation log; testable by querying the log for each staged scene. (3) Detail reveals with distance in layers; testable at three approach distances.
- **Failure modes.** Pastiche (corpses and notes); labour cost; decoration without causality.
- **Relevance.** Supporting. Confidence 0.75.
- **Surprise.** Yes.

### F8. Immersive-sim systemic design: intention, affordance and perceivable consequence
- **Definition.** The design tradition (Looking Glass, Arkane and heirs, plus interactive-fiction fairness craft and affordance design) of supporting the player's own plans with perceivable offers and systemic, perceivable results.
- **Why it matters here.** "Legible" and "consequential" mean the player can attribute an effect to a cause within an attention window, and can tell an offer is an offer and how to decline it (A9, A12, A13, A21, A26).
- **Key sources.** Doug Church, "Formal Abstract Design Tools", Gamasutra/Game Developer, July/August 1999 (https://media.gdcvault.com/GD_Mag_Archives/GDM_August_1999.pdf). Hunicke, LeBlanc, Zubek, "MDA", 2004. Smith and Worch, GDC 2010. Graham Nelson, *The Craft of Adventure*, 1995 (https://ifarchive.org/if-archive/info/Craft.Of.Adventure.pdf). Donald Norman, *The Design of Everyday Things*, revised edition 2013.
- **Instance.** Alien: Isolation's rule that unlock conditions never depend on player deaths, so players are not punished by rules they cannot learn.
- **Principles.** (1) A consequence is credited only if attributable and timely; testable by asking players to name the cause when shown the effect. (2) State changes arrive in a form the player can attribute (diegetic or interface); testable by attribution rate per channel. (3) A new player can say what an offer asks and how to decline it within seconds; testable by think-aloud sessions.
- **Failure modes.** Over-signposting reduces discovery; the vocabulary is thin (Church's two tools were an opening, not a theory); the tradition is expensive and rarely scales to open worlds.
- **Relevance.** Core. Confidence 0.8.
- **Surprise.** No.

### F9. Agent-based-model validation (docking, ODD, pattern-oriented modelling)
- **Definition.** The social-science and ecology methodology for specifying, checking and aligning simulations of many interacting agents.
- **Why it matters here.** The city runs at several levels of detail; aggregate and individual levels must agree when focus changes. A9, A10, A11 and A15 failed on exactly this kind of consistency.
- **Key sources.** Axtell, Axelrod, Epstein, Cohen, "Aligning simulation models: A case study and results", *Computational and Mathematical Organization Theory* 1(2), 1996 (https://link.springer.com/doi/10.1007/BF01299065). Grimm et al., "A standard protocol for describing individual-based and agent-based models", *Ecological Modelling* 198, 2006. Railsback and Grimm, *Agent-Based and Individual-Based Modeling*, 2nd ed., Princeton UP 2019. Epstein, *Generative Social Science*, Princeton UP 2006.
- **Instance.** Axtell et al. modified Sugarscape to reproduce Axelrod's cultural-model results, checking whether two different models could produce the same outputs.
- **Principles.** (1) A coarse model reproduces the aggregate statistics of the fine model within a stated tolerance; testable by docking runs when switching level of detail. (2) Every agent rule is documented in a fixed protocol and reproducible by someone else; testable by independent reimplementation. (3) A model is credible only if it reproduces several independent macro patterns; testable against designer-intended patterns for a fictional city.
- **Failure modes.** Fictional cities have no empirical ground truth; "generatively sufficient" is not "true"; documentation overhead; time cost.
- **Relevance.** Core. Confidence 0.85.
- **Surprise.** Yes.

### F10. Feedback-loop, economy and systems-dynamics design
- **Definition.** Analysis of stocks, flows and reinforcing or balancing loops, including faucet-and-drain economies.
- **Why it matters here.** Any offer, resource or reputation loop in the city can run away or starve (A3, A10).
- **Key sources.** Donella Meadows, *Thinking in Systems*, Chelsea Green 2008. Adams and Dormans, *Game Mechanics: Advanced Game Design*, New Riders 2012. Simpson, "The In-Game Economics of Ultima Online", GDC 2000. Koster's post (A10).
- **Instance.** Koster's account of the wool pool draining until sheep could not spawn.
- **Principles.** (1) Each generated resource or offer type has a named source and sink, and a steady state is reachable under hoarding; testable with adversarial player bots. (2) Reinforcing loops in offers (more accepted, more offered) have a bounded cap; testable by extreme-behaviour runs. (3) Hoarding is the default adversary; testable by assigning bots to maximise stock.
- **Failure modes.** Abstract models miss texture; balance can flatten drama.
- **Relevance.** Supporting. Confidence 0.7.
- **Surprise.** Yes.

### F11. Mixed-initiative interaction and interruption management (HCI)
- **Definition.** HCI work on when an autonomous system should act or ask, weighing the cost of interrupting against the benefit of acting.
- **Why it matters here.** "The player is never controlled; the system only makes offers" is a mixed-initiative problem. A3, A6 and A22 failed on timing and ownership of offers.
- **Key sources.** Eric Horvitz, "Principles of Mixed-Initiative User Interfaces", CHI 1999 (https://erichorvitz.com/uiact.htm). McFarlane and Latorella, "The scope and importance of human interruption in HCI design", *Human-Computer Interaction* 17(1), 2002. Mark, Gudith, Klocke, "The cost of interrupted work: more speed and stress", CHI 2008.
- **Instance.** Legion's missions request a calm moment and fall back to lower-priority moments (A6), the same idea as Horvitz's weighing of interruption cost against benefit.
- **Principles.** (1) Offer only when expected benefit exceeds the cost of interrupting the current activity; testable by activity-conditioned acceptance rates. (2) Each declined offer lowers the prior for similar offers; testable by decline-then-frequency curves. (3) Defer to a natural breakpoint rather than dropping; testable by deferral latency.
- **Failure modes.** User-state models are noisy; games sometimes want interruption (horror, heists); much of the literature concerns desktop notification.
- **Relevance.** Core. Confidence 0.85.
- **Surprise.** Yes.

### F12. Habituation, attention and remembered-experience psychology
- **Definition.** Findings on response decrement to repeated stimuli and on how experiences are remembered (peak and end).
- **Why it matters here.** Repetition thresholds govern barks and offers; session recall governs how pacing should be spent (A2, A3, A27).
- **Key sources.** Thompson and Spencer, "Habituation", *Psychological Review* 73(1), 1966. Kahneman, Fredrickson, Schreiber, Redelmeier, "When more pain is preferred to less", *Psychological Science* 4(6), 1993. Nesmith's account of over-firing reactions (A2).
- **Instance.** Skyrim's townspeople-swarm reaction had to be tightened; Legion added cooldowns and flags for first-time operative comments.
- **Principles.** (1) Repetition becomes noticeable after a threshold of exposures within a window that depends on salience; testable by recognition tests. (2) Remembered quality is dominated by peaks and the end, so spend authored quality there and end sessions on resolution; testable by post-session ratings against moment-by-moment ratings. (3) Changing the attended dimension restores response; testable by A/B on which feature is varied.
- **Failure modes.** Peak-end evidence comes from short stimuli and replicates unevenly; habituation models do not say which dimension players attend to; individual differences.
- **Relevance.** Supporting. Confidence 0.7.
- **Surprise.** Yes.

### F13. Tabletop game-master craft: situations, fronts and clocks
- **Definition.** The practice of running unscripted shared fiction by preparing situations and threats, not plots, with a world that moves off-screen.
- **Why it matters here.** It is the living practice closest to the system's role: observe, offer, let consequences land, avoid the quantum ogre (A25, A24).
- **Key sources.** Vincent and Meguey Baker, *Apocalypse World*, 2010. Sage LaTorra and Adam Koebel, *Dungeon World*, 2012 (fronts: https://roll20.net/compendium/dw/Fronts). John Harper, *Blades in the Dark*, 2017 (clocks). Mike Shea, *Return of the Lazy Dungeon Master*, 2018.
- **Instance.** A Dungeon World front pairs dangers with "grim portents" that advance toward an impending doom unless the characters intervene, so the world visibly moves without the players.
- **Principles.** (1) Every active threat has a clock and visible portents; testable by a log of ticks and player-visible signs. (2) Prepare material with several entry points, not a path; testable by routes-to-content counts. (3) A decline resolves into a consequence, never a null; testable by auditing declined offers.
- **Failure modes.** Depends on a human reading the table; hidden adjustment is unauditable; the illusionism-versus-railroading debate is unresolved (A25).
- **Relevance.** Core. Confidence 0.85.
- **Surprise.** No.

### F14. Improvisational theatre craft (offers)
- **Definition.** The performance discipline of accepting and building on a partner's offers.
- **Why it matters here.** The player makes offers too (including declines and sideways moves). A system that blocks them (A25) feels railroaded.
- **Key sources.** Keith Johnstone, *Impro*, Faber and Faber 1979. Viola Spolin, *Improvisation for the Theater*, 1963. Halpern, Close, Johnson, *Truth in Comedy*, 1994. Patricia Ryan Madson, *Improv Wisdom*, 2005.
- **Instance.** The offer, accept, block vocabulary and Johnstone's status work, where every exchange between strangers carries a status transaction.
- **Principles.** (1) A player move outside the plan is reincorporated into world state within the same scene; testable by scripted off-plan moves. (2) A character's reaction raises the stakes of the player's chosen action rather than undercutting it; testable by rater comparison. (3) Every ambient NPC exchange carries a legible status; testable by observer coding.
- **Failure modes.** Improvisation is real-time human responsiveness, hard to automate; comedic bias; "yes, and" can accrete without continuity.
- **Relevance.** Supporting. Confidence 0.65.
- **Surprise.** Yes.

### F15. Immersive-theatre and audience-agency design
- **Definition.** The study and practice of designing audience paths, attention and agency in site-specific performance.
- **Why it matters here.** Parallel events across a city with a participant who can only be in one place (A23).
- **Key sources.** Rose Biggin, *Immersive Theatre and Audience Experience*, Palgrave Macmillan 2017. Josephine Machon, *Immersive Theatres*, Palgrave Macmillan 2013. Adam Alston, *Beyond Immersive Theatre*, Palgrave Macmillan 2016.
- **Instance.** *The Burnt City*'s opening gathers the audience in a central space where action begins at once, easing the fear of missing out (Radosavljević).
- **Principles.** (1) An early shared "gathering" beat lowers reported fear of missing out; testable by surveys. (2) Separate skippable fragments from spine beats that every participant must see; testable by coverage maps. (3) Special one-to-one encounters feel earned when selection is legible; testable by perceived-fairness ratings.
- **Failure modes.** Alston's critique of the politics of participation; exclusivity of one-to-ones; controlled spaces do not transfer to open worlds.
- **Relevance.** Supporting. Confidence 0.6.
- **Surprise.** Yes.

### F16. Participatory live-experience design: larp and alternate reality games
- **Definition.** Larp design (bleed, steering, safety tools) and ARG design (rabbit hole, "this is not a game").
- **Why it matters here.** Consent, opt-out and pacing around intense content in a dystopian setting (A17, A22).
- **Key sources.** Stenros and Montola (eds.), *Nordic Larp*, Fea Livia 2010. Montola, *On the Edge of the Magic Circle*, Tampere 2012. McGonigal, "This Is Not a Game", 2003. Dena, *Transmedia Practice*, Sydney 2009.
- **Instance.** Majestic is a counter-example: calls arrived on the system's schedule and were prefaced by a disclaimer (A22).
- **Principles.** (1) Participants set the pace (pull, not push); testable by pace variance across users. (2) Opt-out tools exist before intense content, not after; testable by checking placement. (3) Boundary crossings between fiction and real channels are explicit; testable by audit.
- **Failure modes.** ARGs favour puzzle communities; safety-tool practice is debated; larp norms do not transfer to solo play.
- **Relevance.** Peripheral to supporting. Confidence 0.5.
- **Surprise.** Yes.

### F17. Dramaturgy and causal-chain screenwriting
- **Definition.** Craft theory of linking beats by cause, with setup, payoff and stakes.
- **Why it matters here.** "Caused" and "consequential" have a testable form: each link reads as "therefore" or "but" and references a recorded fact (A7, A12, A16).
- **Key sources.** Aristotle, *Poetics* (probable or necessary sequence). Robert McKee, *Story*, 1997. Trey Parker and Matt Stone's NYU guest session on "therefore" and "but" (secondary accounts only; transcript listing: https://speakola.com/arts/tag/NYU). Mateas, "A Preliminary Poetics for Interactive Drama and Games", *Digital Creativity* 12(3), 2001.
- **Instance.** The Nemesis idea at its simplest: the captain who beat you returns promoted (de Plater, A7).
- **Principles.** (1) For any two consecutive offered events the link can be written as "therefore" or "but" referencing a world fact; "and then" is a defect; testable by audit. (2) Every setup is paid off or explicitly retired; testable by an open-setups ledger. (3) A consequence arrives with its cause in view; testable by attribution tests (F8).
- **Failure modes.** Formulaic; the heuristic comes from closed linear works; over-causal plots feel contrived; open-world players want slack.
- **Relevance.** Core. Confidence 0.85.
- **Surprise.** No.

### F18. Ludonarrative harmony and procedural rhetoric
- **Definition.** Analysis of agreement or conflict between what mechanics reward and what the fiction says.
- **Why it matters here.** A3's endless emergencies and any heist reward structure can undercut the dystopian fiction.
- **Key sources.** Clint Hocking, "Ludonarrative Dissonance in Bioshock", 2007 (origin discussed at https://www.inverse.com/gaming/ludonarrative-dissonance-meaning-video-games-origins-definition). Ian Bogost, *Persuasive Games*, MIT Press 2007. Mateas 2001.
- **Instance.** Hocking's BioShock reading: the Little Sisters choice is framed around compassion while the mechanics reward the opposite.
- **Principles.** (1) A repeatable offer is framed as routine, not emergency; testable by frame audit. (2) Rewards implied by a mechanic do not contradict the stakes the fiction states; testable by a table of mechanic, implied value, stated value. (3) Where dissonance is intended it is signalled; testable by designer annotation.
- **Failure modes.** The term is contested and loosely defined; some dissonance is deliberate (a 2025 paper reads BioShock's that way, per search summary).
- **Relevance.** Supporting. Confidence 0.7.
- **Surprise.** No.

### F19. Urban sociology of everyday life
- **Definition.** The study of how strangers share city space (civil inattention, eyes on the street, routines).
- **Why it matters here.** The smallest scale is "what an individual passer-by is worried about", and the setting is a dystopian city whose social texture must be true (A9).
- **Key sources.** Jane Jacobs, *The Death and Life of Great American Cities*, Random House 1961. Erving Goffman, *Behavior in Public Places*, Free Press 1963. Michel de Certeau, *The Practice of Everyday Life*, University of California Press 1984. William H. Whyte, *The Social Life of Small Urban Spaces*, 1980.
- **Instance.** Goffman's civil inattention: strangers briefly acknowledge each other and look away, so an NPC who stares, greets or barks at the player breaks the norm; fear, hustle and surveillance would change it in a dystopia.
- **Principles.** (1) The default NPC behaviour between strangers is civil inattention, with exceptions requiring a reason; testable by counting unprompted address events. (2) Ambient NPCs have a minimal place-and-time routine; testable by log queries. (3) Passive witnesses affect how a crime unfolds; testable by varying witness density.
- **Failure modes.** Jacobs and Goffman describe mid-century Euro-American cities; dystopian norms invert some of their claims; findings are descriptive.
- **Relevance.** Supporting. Confidence 0.6.
- **Surprise.** Yes.

### F20. Crime script analysis and situational crime prevention
- **Definition.** A criminological method that decomposes an offence into scenes with actors, resources and decision points.
- **Why it matters here.** The hour-scale heist and street crime need a true-to-setting structure, with preparation, execution and aftermath, and named places to insert complications.
- **Key sources.** Derek Cornish, "The procedural analysis of offending and its relevance for situational prevention", *Crime Prevention Studies* 3, 1994 (https://popcenter.asu.edu/sites/default/files/library/CrimePrevention/Volume_03/06_cornish.pdf). Leclerc and Wortley (eds.), *Cognition and Crime*, Routledge 2014. Borrion's crime-scripting work (https://discovery-pp.ucl.ac.uk/10072755/3/Borrion%20crime%20scripting_submitted.pdf).
- **Instance.** Cornish's stated aim: organise knowledge of how a crime is carried out so that intervention points across the whole sequence can be identified, which doubles as a map of where complications can attack.
- **Principles.** (1) Each phase has enumerated preconditions and resources, and any complication attacks a named one; testable by audit. (2) Aftermath (fencing, retaliation, laundering) is a scene in the script; testable by coverage. (3) Crew decisions follow perceived effort, risk and reward; testable by simulated offender choice.
- **Failure modes.** Scripts describe real, mundane offending retrospectively, not cinematic heists; the borrowed cognitive-script foundation is called unclear in one critique.
- **Relevance.** Supporting. Confidence 0.6.
- **Surprise.** Yes.

### F21. Simulation testing and deterministic replay
- **Definition.** Running the whole system in a seeded, deterministic simulation with fault injection and property checks.
- **Why it matters here.** The engine must never silently break authored content (A1); reproducible failures are the only way to debug emergent systems.
- **Key sources.** Will Wilson, "Testing Distributed Systems w/ Deterministic Simulation", Strange Loop 2014 (https://thestrangeloop.com/2014/testing-distributed-systems-w-slash-deterministic-simulation.html). Claessen and Hughes, "QuickCheck", ICFP 2000. Antithesis resources on deterministic simulation testing (https://antithesis.com/resources/deterministic_simulation_testing/).
- **Instance.** FoundationDB's team ran their database in a deterministic simulation of its environment to find rare failures; the analogue is a seeded multi-year city run under adversarial player bots with invariants such as "no authored-content dependency is left unfulfillable".
- **Principles.** (1) Given a seed and inputs, a full replay is identical; testable by hash comparison. (2) Invariants hold over millions of simulated days; testable by running them. (3) Failures shrink to a minimal event sequence; testable by shrinking real failures.
- **Failure modes.** Determinism is costly with threads or physics; simulated players are unlike real ones; properties are only as good as the authors' imagination.
- **Relevance.** Core. Confidence 0.8.
- **Surprise.** Yes.

### F22. Self-determination theory and motivation design
- **Definition.** Psychology of autonomy, competence and relatedness, and of how rewards and pressure change motivation.
- **Why it matters here.** The player is never controlled. Offers that feel like pressure, or rewards that cheapen intrinsic interest, are the failure (A3, A8).
- **Key sources.** Ryan, Rigby, Przybylski, "The motivational pull of video games", *Motivation and Emotion* 30, 2006. Deci, Koestner, Ryan, "A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation", *Psychological Bulletin* 125(6), 1999. Deci and Ryan, "The 'what' and 'why' of goal pursuits", *Psychological Inquiry* 11, 2000.
- **Instance.** Fallout 4's offers carry time limits and fail on expiry (A3), which is controlling framing; an informational framing ("there is an opening") leaves the choice with the player.
- **Principles.** (1) Informational framing yields higher voluntary acceptance than controlling framing; testable by A/B. (2) Tangible rewards for already-interesting activities can reduce later voluntary engagement; testable by a withdrawal design. (3) Declining carries no penalty; testable by audit.
- **Failure modes.** Lab-derived; overjustification effects depend on context; replication and operationalisation debates.
- **Relevance.** Supporting. Confidence 0.7.
- **Surprise.** Yes.

### F23. Player modelling and player-experience research
- **Definition.** Data-driven inference of player preferences, skill and affect, plus the methods (telemetry, playtests, questionnaires) for judging experience.
- **Why it matters here.** "Relevant to the player's own history" needs a model; every claim about offers needs an evaluation method (A18).
- **Key sources.** Yannakakis and Togelius, *Artificial Intelligence and Games*, Springer 2018. Thue, Bulitko, Spetch, Wasylishen, "Interactive Storytelling: A Player Modelling Approach", AIIDE 2007. Drachen, Mirza-Babaei, Nacke (eds.), *Games User Research*, OUP 2018.
- **Instance.** PaSSAGE learned a player's style and chose story content to match, with benefit mainly for some player types.
- **Principles.** (1) Inferred player types are hypotheses revised by evidence, not labels fixed after one session; testable by prediction error over time. (2) Evaluate against a non-adaptive baseline within subjects; testable by design. (3) Check for feedback loops where the model produces what it predicts; testable by holding out random offers.
- **Failure modes.** Type taxonomies have thin evidence; observation changes behaviour; privacy.
- **Relevance.** Supporting. Confidence 0.75.
- **Surprise.** No.

### F24. Believable agents and character-first AI (Oz Project lineage)
- **Definition.** The AI tradition that aims for audience belief in specific characters rather than for general intelligence.
- **Why it matters here.** Passers-by with worries need specific, legible character, not general reasoning (A14, A15, A13).
- **Key sources.** Joseph Bates, "The role of emotion in believable agents", *Communications of the ACM* 37(7), 1994. Loyall and Bates, "Hap", CMU 1991. Mateas, "An Oz-Centric Review of Interactive Drama and Believable Agents", CMU 1997. Mateas and Stern, Façade (GDC 2003).
- **Instance.** Façade's beats and the Oz Project's emphasis on authored personality over simulated cognition.
- **Principles.** (1) Characters are specific, so observers can predict an NPC's reaction from a paragraph; testable by prediction accuracy. (2) A character acts visibly on its worry, not only in text; testable by observer reports. (3) Emotion shown is legible; testable by recognition rates.
- **Failure modes.** Heavy authoring; "believability" lacks rigorous measures; language models now compete on surface plausibility.
- **Relevance.** Supporting. Confidence 0.7.
- **Surprise.** No.

### F25. Explanation science (contrastive, selective accounts of causes)
- **Definition.** The social-science literature on how people give and prefer explanations, applied to AI.
- **Why it matters here.** Legibility needs a form of "why is this happening" that does not dump exposition (A7, A11, A14).
- **Key sources.** Tim Miller, "Explanation in artificial intelligence: Insights from the social sciences", *Artificial Intelligence* 267, 2019 (https://apice.unibo.it/xwiki/bin/view/Publication/XaisocialsciencesAi267). Peter Lipton, "Contrastive explanation", 1990. Halpern and Pearl, "Causes and explanations: a structural-model approach", *British Journal for the Philosophy of Science* 56, 2005. Wardrip-Fruin on the Tale-Spin effect.
- **Instance.** The Tale-Spin effect (A14): the depth of a system is not visible unless something selects and states the causes.
- **Principles.** (1) Explanations that contrast with the expected alternative ("why this rather than that") are preferred; testable by choosing among generated accounts. (2) One or two selected causes beat the full chain; testable by comprehension. (3) A pull-based "why?" is preferred to pushing; testable by acceptance and annoyance ratings.
- **Failure modes.** Findings come from human explainers; explanations can be post-hoc rationalisation; too much explanation kills mystery.
- **Relevance.** Supporting. Confidence 0.6.
- **Surprise.** Yes.

---

## Fields considered and rejected
- **Affordances and signifiers as a separate field (Norman, Gaver).** Folded into F8 (offers must be perceivable as offers and declinable) to stay within 25 fields.
- **Formal story grammars (Propp, Todorov).** Subsumed by F5 and F17; adds structure without addressing the failures.
- **Behaviour trees, GOAP and utility AI as such.** Implementation techniques, not a field that prevents the failures found.
- **Reinforcement learning for pacing.** Reward-hacking risk and no found evidence of success for story pacing.
- **Cinematography and shot grammar.** Staging of seen events matters, but no failure case turned on it.
- **Wargaming and matrix-game adjudication.** Offers plausible-consequence reasoning, but no failure case maps to it; a possible later addition.
- **Cybernetics (requisite variety).** Conceptually apt, no operational advice found.
- **Dynamic music and game audio.** A pacing aid, not a source of the failures examined.
- **Behavioural economics (loss aversion, prospect theory).** A8 was a business-model issue; the useful part is covered by F22.
- **Patent law.** Relevant to Nemesis-like mechanisms (A7) but a constraint, not a craft.
- **Dynamic difficulty adjustment as a standalone field.** Only partial evidence found (a hidden-versus-announced DDA thesis whose results I could not retrieve); folded into F1 and F23.

---

## Ranking: the five most valuable for this system
1. **F1 Experience management**: the decision core, with a working model (Alien: Isolation) and an honest evaluation gap.
2. **F9 Agent-based-model validation**: makes level-of-detail consistency testable and prevents the faked-simulation failures (A9, A10, A11).
3. **F11 Mixed-initiative interruption management**: the only field that treats "offer, never control" as its own problem, and the one quest designers are least likely to consult.
4. **F2 Story sifting**: turns a flood of simulated events into the few that are worth staging.
5. **F17 Causal-chain dramaturgy**: gives "caused" and "consequential" an auditable form (therefore or but, plus a setup ledger).
