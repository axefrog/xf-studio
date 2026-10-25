# Bringing V and the world to life: idea register

**Status:** a standing direction, not a feature request (27 September 2026). The maintainer wants V, and later the world around V, to feel more alive and real than the rigid vanilla systems allow. That covers more idles, freer posing and freestyle animation, and more dynamic surroundings. Ideas are collected here as they come up during the work. Each is discussed before anything is built. Ideas that become features move to their own backlog pages.

## What we already know the engine can do

| Capability | Evidence |
|---|---|
| Photo-mode body graph with head/chest rotation, look-at (eyes, head, chest, hands) and two-bone IK on all limbs | [poses](../../knowledge/poses.md) |
| A facial rig of 141 artist-meaningful main poses, additive clips and many NPC emotion idles | [facial expressions](../../knowledge/facial-expressions.md), [facial animation](../../knowledge/facial-animation.md) |
| Dangle physics declared per hairstyle and per item, with a particle solver and collision capsules | [hair physics](../../knowledge/hair-physics.md) |
| A live bridge into the running game (RED4ext, redscript, CET) | [runtime access](../../knowledge/runtime-access.md) |
| Additive world content through ArchiveXL blocks and World Builder | [world and streaming](../../knowledge/world-and-streaming.md) |

## Ideas (unranked, for discussion)

### V

- **An idle wardrobe:** authored idles (pose editor plus animated poses) that the game plays as variants of V's standing idle, with a mood setting (relaxed, tired, confident, restless). The game already picks between idle variants in several graphs.
- **Micro-motion layer:** breathing, small weight shifts, blink-rate variety and eye saccades (tiny, constant eye movements), layered additively over any pose or idle. This is where much of "alive" comes from, and the facial rig and look-at channels already exist.
- **Eyes that look at things:** point of interest for the eyes and head, taken from the camera, nearby NPCs, a light or a moving object, using the graph's own look-at channels. That works in photo mode and possibly in gameplay.
- **Expressions that react to context:** subtle emotion additives driven by state, such as low health, rain, combat just ended or a friend nearby, through redscript feeding the facial clip additives.
- **Skin that responds:** wetness in rain, flushed cheeks after sprinting, sweat or grime building up and washing off, scars that stay. These are material parameters driven live, building on the skin and decal shader study.
- **Physics on everything that should move:** hair (planned), earrings, jewellery, coat tails and straps, all through the same solver.
- **Photo-mode direction:** live posing from the Studio, look-at targets, expression and pose timelines. "Directing" V rather than choosing presets.
  - **Live facial control through a carrier clip** (banked 28 September 2026; waits until the current product reaches 1.0, except one early check). Select an XF expression entry as a carrier in photo mode and rewrite its 414 constant track keys in memory, as the body's `pose.live.apply` carrier does. The game's own face solver then shows any control vector live, so the Studio's expression editor drives V's face in the running game.
    - It is the likely first route for the expression editor's later `face.controls.apply` ([expression editor §7](../animation/expression-editor-design.md#7-the-runtime-bridge-and-in-game-preview)).
    - The early check is a face-carrier variant of the live-pose L0 check ([pose editor §7.4](../animation/pose-editor-design.md#74-first-experiment-plan-one-supervised-session)).
    - Session 4 found that photo mode's face solves on the stand-in with the male player setup, and that XF expression entries list and play there ([facial expressions](../../knowledge/facial-expressions.md#which-facial-setup-v-actually-uses)).
- **Light V like a set:** the Studio's lighting setups mirrored onto V in photo mode ([lighting mirror design](../runtime/lighting-mirror-design.md)), and later the reverse: the lights around V at a real place in Night City read into the Studio, so a look is authored under the light it will be seen in. A light that moves with V in normal play (a CharLi-style portrait light) is a separate decision.
- **New voiced lines with lip sync:** voice new lines for V or other characters and have the mouth follow them, as JALI's baked clips do for the game's own lines. Later this could feed consented real-time voice swap and the quest designer.

  **Feasibility (27 September 2026, offline study; details in [lip sync](../../knowledge/lipsync.md) and the [lip-sync design](../animation/lipsync-design.md)):**
  - *How the game does it.* Every voiced line has a baked 30 fps facial clip found through a per-language lip-sync map (scene, voice tag, line). The clip drives a separate lip-sync channel: a fade envelope, JALI's jaw and lip strengths, pose values added over the expression, and override weights that mute the expression's mouth. V has such clips in 456 scenes, despite the wiki's "V has no lipsync".
  - *What modders do today.* They reuse vanilla clips (WolvenKit's generator, Audioware's guide, installed quest mods). Nobody generates new lip sync.
  - *What we showed.* Rhubarb (MIT) phone timing plus our own JALI-style rules produced a clip in the game's channel whose solved lip gap, mouth width and jaw rotation match a vanilla V clip's ranges, with lips closed on every bilabial ([experiment 027](../../experiments/027-lipsync-poc/README.md)).
  - *Plan.* Play vanilla lip-sync clips on V in the preview (S), then generate from audio and a transcript with a timeline (M), then export clip, lipmap, voice-over map and scene (L), then one in-game session (M), then quest integration.
  - *Risks.* Game audio (`.wem`) needs the user's own Wwise; whether V's face shows lip sync outside mirror scenes and in photo mode is untested; rule-based speech may look mechanical beside JALI's; JALI patents need a check; voices need consent, and the game's actors are never cloned.
  - *Questions for the maintainer:* in the [design](../animation/lipsync-design.md#6-questions-for-the-maintainer), each with a proposed default.

### The world

- **NPCs who notice V (appearance and context awareness).** NPCs react to how V looks and what V drives, relative to where V is:
  - naked: shock or amusement;
  - clownish or out-of-place outfits: stares and comments;
  - a knockout: compliments;
  - a cool car in a poor district: "hey, cool car, man!";
  - a wreck in a rich one: snickers.

  Layers, cheapest first:
  - (1) **Appearance facts from data:** what V wears and its tags (TweakDB item tags, visual tags, iconic/rarity), empty slots, the car's record (class, price, condition), the district and subdistrict. The Studio already resolves most of this.
  - (2) **An assessment layer:** a rule-based "how does V read here" score (fancy, shabby, bizarre, revealing, out of place), with thresholds per district. It could later be learned from tagged examples, but rules first.
  - (3) **Reactions through the game's own systems:** stims and the NPC reaction manager, crowd barks and look-at, driven by redscript.
  - (4) **Lines:** reuse the game's existing crowd voice lines chosen by context, or text-only barks (subtitles or chat bubbles) from a pre-generated library. Generative AI can help author the library offline. Cloning the original voice actors' voices isn't an option (their rights); new voiced lines would need consenting voices.

  **Feasibility (27 September 2026, offline study; details and grades in [NPC reactions](../../knowledge/npc-reactions.md)):**
  - *Reachable now.* The game already has the right moment: a crowd NPC's proximity look-at, which picks a facial reaction and a voice trigger, and already reacts to a naked V with disgust and a "stop following me" line. Scripts can wrap that moment, read everything layer 1 needs (drawn items and tags, hidden slots, V's gender, the observer's `anim_*` archetype tags and faction, V's vehicle record and damage level, the district record), set any of the generic emotion faces, hold a stare, and show an overhead text bubble that looks like vanilla chatter. Two installed mods (Street Sense, Responsive NPCs) already run rule-based clothing reactions this way.
  - *The gap is lines.* Generic voices pick a random line per trigger, and civilians only have greeting, bump, phone, fear and security triggers. About 15 of 538 civilian greetings comment on looks, each in one voice; none mentions cars. Neither district nor vehicle records carry a wealth attribute.
  - *Cheapest convincing prototype:* one redscript file (plus Codeware) that wraps `TriggerFacialLookAtReaction`: if V shows no top and no bottom (drawn items, not gameplay slots) or wears a hand-picked test outfit, the NPC stares (repeating look-at), shows shock or joy by its `anim_*` archetype, and posts one of a few localised overhead text lines; otherwise vanilla runs. One test session: walk through a Japantown crowd in three outfits. No audio, no assets, no voice rights.
  - *Next step after that:* voiced reuse of vanilla lines in the NPC's own voice by adding XF entry points to voiceset scenes at load, pointing only at that voice's fitting lines (needs a game test that new entry names are accepted); an offline tagging pass over all 14,003 voiceset lines; car and district reads.
  - *Risks:* conflicts with mods that replace the same `ReactionManagerComponent` methods (Responsive NPCs replaces several); spamming (the vanilla cooldowns must stay); players who turn chatter off see no text; sensitivity of nudity and body-based comments (Street Sense makes reactions depend on V's gender; ours should be the maintainer's call and configurable); game patches renaming private methods.
  - *Questions for the maintainer:* text-only first, or wait for voiced reuse? Should reactions depend on V's gender or body at all? Ship as its own XF mod or as part of a larger "alive" mod? How should it coexist with Street Sense and Responsive NPCs if both are installed (detect and step aside, or layer)?
- **Ambient life:** new ambient NPC behaviours and scenes at chosen places (workspots, community spawns), authored in the Studio's world tools (phases W4–W5 in [world ideas](world-and-interactive-ideas.md)). The runtime building blocks (spawn, walk, speak, gesture, dialogue choices with V) are designed as bridge 0.8 in [NPC direction](../runtime/npc-direction-design.md); a scripted scenario there is the smallest directed scene.
- **Reactive surroundings:** NPCs noticing V's look, weather-reactive crowds, and time-of-day routines.
- **Places that remember:** persistent, player-driven changes to locations (decor, props left behind), stored in the save generically, as the [save editor study](../save/save-editor-design.md) shows the save can describe mod data.

- **Sit anywhere, done properly** (banked until after 1.0): V can sit on any bench, ledge or chair through the game's own workspot system, which today works only where the story placed a prompt. The existing community approach offers seats targeted through walls and then clips V through the wall to reach them; the sit itself works. Ours would offer a seat only when a sight-line ray from V reaches it, a navmesh path leads there and the seat's space is free, using the checks the bridge's scene report already runs.

- **Procedural gigs, quests and encounters over a level-of-detail world simulation:** now an active R&D vertical, the [Story Engine](../story-engine/README.md), raised and started on 22 October 2026. Its hub holds the [plan](../story-engine/plan.md), the [design seeds](../story-engine/design-seeds.md) and the [runtime requirements](../story-engine/runtime-requirements.md).

### V's life: ventures, standing and consequences

The aim is a world where there is always something to do, where everything seems to have a life of its own, and where the vanilla systems are a small part of what runs. These examples show the range; each one waits for the current product to be finished (the 1.0 rule), and is discussed before it is built.

- **Businesses V runs:** an electronics repair shop (customers arrive with jobs, parts cost money, word of mouth grows the trade); a rental empire of apartments (tenants, rent, repairs, disputes), later with V's own gang and henchmen to collect and protect.
- **Lasting conflict:** a war with a gang that V can win, lose or have to lie low from; territory, retaliation and truces that persist across days.
- **Permanent wanted status:** the police keep after V until she changes her identity and appearance. The police come to V's apartment and ransack it for evidence, and what they take or break stays taken and broken.
- **Places the designers never built:** a network of under-city tunnels V discovers and explores, leading to areas that aren't in the base game.
- **V's own AI:** V writes an AI and lets it loose on her enemies. Its counterpart is the rogue AI that invades V, perhaps through a ripperdoc's dodgy implant: a character with its own voice and goals that hops between hosts (V, NPCs, cars, the drone).
- **V's own surveillance:** cameras V installs around the neighbourhood, feeding a wall of monitors in her apartment that show what's going on nearby.

More in the same vein, each grown from something already built or planned:

- **Word gets around.** What V does travels through people instead of a global counter. A witnessed incident becomes a rumour carried by the people who saw it. It spreads along their networks (friends, workplaces, gangs, fixers) and fades with distance and time. A vendor two blocks away has heard about the shootout; a district that never saw it hasn't. Built on the bridge's witness reports (S7) and the Story Engine's people networks.
- **The news reports V.** In-world screens, radio and the news feed carry stories generated from the record: what V did, slanted by each outlet's politics and by what was actually witnessed. A quiet week is reported as a quiet week. After a long absence (sleep, a time skip), a short catch-up of what the city did meanwhile.
- **V's exploits as braindances.** The bridge's session recorder already captures everything V does with its context. In game, a recording becomes a braindance V can sell, trade or leak. It's also evidence the police can seize in a raid (above), and a fixer can demand one as proof a job was done.
- **People V met come back changed.** A clerk V saved gets promoted and owes a favour. A ganger V humiliated returns with friends and a scar. Someone V ignored is a corpse in the news. The record keeps a thread for anyone who mattered, and the Story Engine picks them up again.
- **Photos as currency.** Photo mode turns into a working tool: shots V takes can be sold to a news outlet, used for blackmail, filed as evidence or posted to a fixer as proof. It connects to the Photo Mode Tools project, since the bridge already knows what is in frame.
- **A Trauma Team that actually comes.** V's subscription tier decides who turns up when she goes down: a platinum extraction under fire, a slow ambulance, or nobody. The bill, the debt and the stories (the team saw what V was doing) follow her.
- **Districts with moods.** Each district carries a tension that responds to events: a gang war raises patrols and empties the streets, a festival fills them, a blackout brings looters. Crowds, prices, traffic and police behaviour follow the mood.

**What they share.** Most of these rest on a handful of substrates, so each substrate built serves many of them:

| Substrate | Serves | Where it is today |
|---|---|---|
| A persistent world record tied to the save (who owns what, who owes whom, what happened where) | businesses, rentals, gang war, wanted status, ransacked rooms | the Story Engine's record and XF Core's save ledger (planned) |
| A simulated population with roles, factions, loyalty and routines | customers, tenants, henchmen, rival gangs, police | the Story Engine's level-of-detail simulation; the bridge's actors, crowd substitution and NPC direction |
| Plans that anticipate outcomes, run at frame rate and report back | every staged moment: a raid, a collection, a customer visit, a henchman's job, an AI's attack | the bridge's plan module (agreement with the Story Engine, 26 October) |
| Changing V's appearance and identity in game | permanent wanted status, laying low, disguise | the Studio's character editing (CC values) and live application through the bridge |
| Persistent changes to places (props moved, taken or broken; decor added) | ransacked apartments, shop fit-outs, camera installs | "places that remember" (above); the bridge's props and doors |
| New authored spaces streamed into the world | tunnels and hidden areas, V's shop | the Studio's world tools (phases W4–W5 in [world ideas](world-and-interactive-ideas.md)) |
| Script-owned cameras rendered to in-world screens | the monitor wall; cockpit-style views | the bridge's camera control; community mods show script-owned cockpit cameras are possible |
| An agent that can take control of actors and devices | V's AI, the rogue AI | the supervisor's actors and the bridge's handovers; a realtime controller later |

## Related

[Pose editor](../animation/pose-editor-design.md) · [Pose library](../animation/pose-library-design.md) · [Expressions and idles brief](expressions-and-idles-brief.md) · [Hair physics plan](../animation/hair-physics-plan.md) · [World and interactive ideas](world-and-interactive-ideas.md)
