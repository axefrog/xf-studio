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
- **Ambient life:** new ambient NPC behaviours and scenes at chosen places (workspots, community spawns), authored in the Studio's world tools (phases W4–W5 in [world ideas](world-and-interactive-ideas.md)).
- **Reactive surroundings:** NPCs noticing V's look, weather-reactive crowds, and time-of-day routines.
- **Places that remember:** persistent, player-driven changes to locations (decor, props left behind), stored in the save generically, as the [save editor study](../save/save-editor-design.md) shows the save can describe mod data.

## Related

[Pose editor](../animation/pose-editor-design.md) · [Pose library](../animation/pose-library-design.md) · [Expressions and idles brief](expressions-and-idles-brief.md) · [Hair physics plan](../animation/hair-physics-plan.md) · [World and interactive ideas](world-and-interactive-ideas.md)
