# Quests, story content and persistent systems from mods

**Maturity: Draft.** How mods add quests, phone conversations, objectives, map pins, scenes and long-lived systems to Cyberpunk 2077 without replacing the game's own quests; how script and quest graphs talk through facts; how braindances are built; what can be generated at run time; and what can be reloaded live. Consolidated on 29 September 2026 from six installed story mods (the [B1 deep dive](../research/mod-ecosystem/b1-story-systems.md)), their quest, scene and journal resources serialised with WolvenKit CLI 9.0.1 into a private scratch folder, the decompiled 2.31 script bundle (redscript-cli 0.5.31), and the source of ArchiveXL, Red Hot Tools and RED4ext.SDK. Nothing here has been seen in a game session. Grades follow the [knowledge rules](README.md); **[resource]** includes a mod resource read as serialised JSON.

This page answers: *what is a mod quest made of, how do the parts connect, how could XF Studio author, generate and live-test one, and how are braindances and persistent world systems built?*

## Sources

| Source | Version studied | Used for |
|---|---|---|
| Game scripts (decompiled bundle) | 2.31 | `QuestsSystem` facts, `JournalManager`, `TimeSystem` listeners, `BraindanceSystem`, messenger controllers |
| Game TweakDB source (REDmod `tools/redmod/tweaks`) | 2.31 | `timeSystem.settings.realTimeMultiplier` |
| Dark Future (Nexus 16300), by DarkFortuneTeller | installed 2.0.3; [GitHub](https://github.com/DarkFortuneTeller/DarkFuture) metadata at `a14f03c` | System architecture, fact channel, scenes played from script, phone therapist |
| Eviction Notice (23187) | installed 1.0.3 | A complete data-authored quest, request and response facts, remote device state |
| Lizzie's Braindances (11077), by ArmanIII per its script headers | installed 2.31.0.0 | Staged braindance scenes, runtime casting |
| Stock Market and News System (6319), by keanuWheeze per its `init.lua` | installed 1.4.0 | Generated news, journal-free phone contact, quest-completion observer |
| Virtual Atelier Delivery (21482), by DJ_Kovrik | installed 1.0.10 | Game-time clocks, drop-point pins ([terminals §6.1](terminals-and-arcade.md#61-virtual-atelier-delivery)) |
| NightlyNow Core (28966), by NightlyNow | installed 1.1.3 | Journal-free phone contact framework in redscript, HUD interaction prompts |
| [ArchiveXL](https://github.com/psiberx/cp2077-archive-xl) | `5474e34` | Quest-phase injection, journal merging, map pins, reload |
| [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) | `b4d3415` | Hot reload of archives, scripts and tweaks |
| RED4ext.SDK | `ad727771` | Braindance quest and scene types |

Installed-mod citations give paths inside each mod's folder in the mod manager. Who made each mod and what it taught us is in the [community credits](../docs/community-credits.md).

## 1. The short answers

| Question | Answer | Grade |
|---|---|---|
| How does a mod add a quest without replacing one? | It ships a `.questphase` and lists it under `quest: phases:` in an ArchiveXL `.xl` with a parent quest (`base\quest\cyberpunk2077.quest`); ArchiveXL wires it to the parent's start node and starts it once per save (§2.1). | [source] |
| Where do objectives, messages and pins live? | In the mod's `.journal`, merged by ArchiveXL's `journal:`; quest graph nodes change each entry's state (§2.3). | [source] [resource] |
| How do script and quest graph talk? | Through **facts**: named integers in the save. Graphs wait on and set them; script reads, writes and listens (§2.4, §4). | [source] [resource] |
| How are map pins placed? | A `gameJournalQuestMapPin` under an objective points at a node ref, usually a marker the mod placed in its own sector; ArchiveXL makes the pin (§2.5). | [source] [resource] |
| Can script create phone messages? | Not journal entries. It can activate pre-authored ones, rewrite or fill their text as they are drawn, or inject a journal-free contact into the phone's lists (§2.6). | [source] |
| Are braindances data? | Vanilla braindances are scenes played in braindance mode with clue nodes; the one braindance mod installed stages ordinary scenes and casts them at run time (§5). | [source] [resource] |
| Can a quest be generated? | No installed mod does; graphs are fixed data parametrised by facts and TweakDB flats (§6). | [resource] |
| Can quest content be reloaded live? | The journal, scenes (on their next start), scripts and tweaks can; a phase that is already running cannot (§7). | [source]; phases [hypothesis] |

## 2. The parts of a mod quest

### 2.1 Attaching a phase

- **Declaration.** `quest: phases:` takes `path` (the mod phase) and `parent` (a `.quest` or `.questphase`), and optionally `input`/`connection` and `output` as a node-id path plus socket, and `intercept` to cut an existing link [source] ArchiveXL `QuestPhase/Config.cpp:10-60`.
- **Default wiring.** With no `input`, the phase node is connected from the parent graph's start node (`Out` → `In1`) [source] `QuestPhase/Extension.cpp:178-238, 240-275`. With `output`, both `Out` and `Out1` of the mod phase connect to the named node's `In` (or `In1` for a phase node) [source] same.
- **Started once per save.** For phases merged into a `.quest`, ArchiveXL sets a fact keyed by the new node's path when a quest starts and, when a save is restored, force-starts the node (socket `In1`) if that fact is unset, then sets it. So a mod added mid-playthrough starts on the next load, and never twice [source] `Extension.cpp:97-176`.
- **Node ids are CRC-16.** The injected node's id is a 16-bit CRC of `"<phase path>:<parent node id>"`; if a node with that id already exists in the parent graph, the phase is skipped with a log warning [source] `Extension.cpp:354-392`. Collisions are rare but possible as more phases target the same quest [hypothesis].
- **New Game+ in one line.** An ArchiveXL resource scope (`resource: scope: df_combined_scope.quest: [cyberpunk2077.quest, mod\quest\newgameplus.quest, …]`) used as the `parent` expands to every listed quest [resource] Dark Future and Eviction Notice `.xl`; [source] `Extension.cpp:35-78` (`ExpandList`). Phantom Liberty's standalone start needs `ep1\quest\ep1_standalone.quest` as well [resource] Lizzie's Braindances `.xl`.
- **Sub-phases.** A root phase starts further mod phases with `questPhaseNodeDefinition` (`phaseResource`), entered through named `questInputNodeDefinition` sockets (`SystemStart`, `DeliveryStart`) and left through `questOutputNodeDefinition` (`Terminating`). Only root phases need listing in the `.xl` [resource] Eviction Notice (30 phases, 21 listed).

### 2.2 Node vocabulary seen in mod phases

| Node (`$type`) | Used for | Seen in |
|---|---|---|
| `questInputNodeDefinition` / `questOutputNodeDefinition` | Named entry and exit sockets | all |
| `questPauseConditionNodeDefinition` | Wait until a condition holds: `questFactsDBCondition` (`questVarComparison_ConditionType` with `comparisonType`, `factName`, `value`; `questVarVsVarComparison_ConditionType` comparing two facts), `questJournalCondition` (`questJournalEntryState_ConditionType`, e.g. a phone choice `Succeeded`), `questTriggerCondition` (player `IsInside`/`IsOutside` a trigger area node ref), `questTimeCondition` (`questRealtimeDelay_ConditionType`, `questGameTimeDelay_ConditionType`), `questUICondition` (`questMenuState_ConditionType` `Closed`), `questLogicalCondition` (and/or of these) | DF, EN |
| `questConditionNodeDefinition` | Branch `True`/`False` | EN |
| `questSwitchNodeDefinition` | `First_Fulfilled` cases on fact values | DF, EN |
| `questFactsDBManagerNodeDefinition` (`questSetVar_NodeType`) | Set a fact (`setExactValue`) or **add** to it (no `setExactValue`) | DF, EN |
| `questJournalNodeDefinition` (`questJournalQuestEntry_NodeType`) | Set an entry `Active`, `Succeeded`, `Failed`, `Inactive`; `sendNotification`, `trackQuest` | DF, EN |
| `questSceneNodeDefinition` | Play a `.scene` at a marker (`scnWorldMarker` node ref, `#player` for V), entering by entry-point socket, leaving by exit sockets | DF, EN, LBD |
| `questPhaseNodeDefinition` | Run a nested phase | EN, LBD |
| `questCutControlNodeDefinition` | Stop the sibling branches (the other replies) | DF, EN |
| `questLogicalHubNodeDefinition` | Join several inputs | EN |
| `questItemManagerNodeDefinition` (`questAddRemoveItem_NodeType`) | Give or take items (`AddItem`, `RemoveByItemID`) | EN |
| `questWorldDataManagerNodeDefinition` (`questShowWorldNode_NodeType`) | Show a hidden node | EN |
| `questInteractiveObjectManagerNodeDefinition` (`questDeviceManager_NodeType`) | Device actions on a node ref (`ForceON`, `ForceOFF`, `QuestStartGlitch`) | EN |
| `questUIManagerNodeDefinition` | Push or pop a UI context (`CinematicCamera`); show a journal onscreen popup (`questTutorial_NodeType` / `questShowPopup_NodeSubType`) | DF, EN |
| `questGameManagerNodeDefinition` (`questGameplayRestrictions_NodeType`) | Add or remove restrictions (`NoWorldInteractions`, `NoTimeSkip`, `NoPhone`, `BlockDeviceInteractions` …) around a scene | DF |
| `questAudioNodeDefinition`, `questVoicesetManagerNodeDefinition` | UI sounds; a voiceset line from V | EN |

[resource] the serialised phases of Dark Future, Eviction Notice and Lizzie's Braindances.

### 2.3 The journal

| Path shape | Class | Holds |
|---|---|---|
| `contacts/<contact>` | `gameJournalContact` | Name key, `type` (`Texter`), `avatarID` (a TweakDB `PhoneAvatars` record), `useFlatMessageLayout`, `isCallableDefault` |
| `contacts/<contact>/<conversation>` | `gameJournalPhoneConversation` | Title key |
| `…/<message>` | `gameJournalPhoneMessage` | Text key, `sender` (`NPC` or player), `delay` in seconds, optional image and attachment |
| `…/<choice group>/<choice>` | `gameJournalPhoneChoiceGroup` / `gameJournalPhoneChoiceEntry` | The player's replies; a choice becomes `Succeeded` when picked |
| `quests/minor_quest/<quest>` | `gameJournalQuest` (`type: MinorQuest`) with `gameJournalQuestDescription` and a `gameJournalQuestPhase` of `gameJournalQuestObjective`s | Title, description, objective texts |
| `…/<objective>/<pin>` | `gameJournalQuestMapPin` | Map pin (§2.5) |
| `…/<objective>/<link>` | `gameJournalQuestCodexLink` | Links an objective to a phone choice group ("text Avery") |
| `onscreens/<group>/<id>` | `gameJournalOnscreen` | Popup title and description |
| `codex/tutorials/<folder>/<entry>` | `gameJournalCodexEntry` + `gameJournalCodexDescription` | Codex pages; script turns them on with `JournalManager.ChangeEntryState` |

[resource] `darkfuture.journal`, `eviction_notice.journal`; [source] Dark Future `Main/DFMainSystem.reds` (`UpdateCodexEntries`).

- **Text keys.** Journal text fields hold plain string keys (`DarkFutureTextMsg_…`); ArchiveXL converts each to `LocKey#<FNV1a64 of the key>` when it merges the journal, and the mod's `localization: onscreens:` JSON supplies the strings under the same keys [source] ArchiveXL `Journal/Extension.cpp:478-501`.
- **Script can read and change entry states, not create entries** (`JournalManager` offers reads and `ChangeEntryState`; the entry classes are `importonly`) [source] ([terminals §3.3](terminals-and-arcade.md#33-messages-on-the-phone)).

### 2.4 Facts

- **What they are.** Named 32-bit integers in the save's `FactsDB`, keyed by the FNV-1a 32-bit hash of the name [source] ArchiveXL `src/Red/QuestsSystem.hpp:69-94`; [source] save layout in [save files](save-files.md). A fact never set reads 0.
- **Script API.** `QuestsSystem.GetFact(n"name")`, `SetFact(n"name", value)`, `RegisterListener(n"name", object, n"callback")` → id, `UnregisterListener(name, id)`; CET uses `GetFactStr`/`SetFactStr` [source] Dark Future `Utils/DFFactListenerUtils.reds`; Stock Market `questManager.lua`.
- **Facts are the story's public interface.** Mods read vanilla quest facts to react to the story: prologue done (`q001_01_go_to_sleep_done`, `q101_enable_activities_flat`), Phantom Liberty start (`q301_00_done`), point of no return (`q115_point_of_no_return`), apartments owned (`dlc6_apart_*_purchased`), story choices (`sq021_randy_saved`, `sq028_kerry_relationship`, `sq030_romance`, `q305_medal_given_away`), Dogtown open (`q302_done`), `wanted_level` [source] Dark Future `Services/DFGameStateService.reds`, `Conditions/DFConditionSystemHumanityLoss.reds:508-528`; NightlyNow `Utils/Quest.reds`; [resource] Eviction Notice `new_game_experience.questphase`.
- **Facts are also an inter-mod bus.** Idle Anywhere, Immersive Food Vendors and Immersive Bartenders publish what V consumed as `dec_dark_*` fact values (`-1` ready, `≥ 0` an item index), and Dark Future listens [source] `Gameplay/DFModCompatSystem.reds`.
- **Namespacing matters:** a fact is a global name; every mod here prefixes its own (`df_fact_…`, `en_fact_…`, `lizzies_bds_…`).

### 2.5 Map pins

| Route | How | Evidence |
|---|---|---|
| Journal pin on a mod marker | `gameJournalQuestMapPin` under an objective: `mappinData.mappinType` `Mappins.QuestStaticMappinDefinition`, `variant` `DefaultQuestVariant`, `visibleThroughWalls`, `enableGPS`, `offset`, `slotName` `UI_Interaction`, and `reference` a node ref to a static marker in the mod's World Builder sector (`$/mod/<sector>/#<marker>`). ArchiveXL collects the pin at journal load and resolves its position from the node ref, in new sectors too | [resource] `eviction_notice.journal`; [source] ArchiveXL `Journal/Extension.cpp:138-300, 504-541` |
| Pin on a dynamic entity | A reference by `dynamicEntityUniqueName` is left to the engine | [source] same, `CollectMappin` |
| A spawned device's own pin | Spawn a `DropPoint` device; the vanilla drop-point system registers its pin | [source] Virtual Atelier Delivery `VirtualAtelierDelivery.reds:3454-3468` |

The pin shows while its objective is active and the quest is tracked [hypothesis: standard journal behaviour; not checked here].

### 2.6 Phone messages and contacts

| Route | Dynamic text? | Needs the journal? | Evidence |
|---|---|---|---|
| Quest graph activates pre-authored messages and choices | No | Yes | [resource] Dark Future, Eviction Notice |
| Script rewrites a pre-authored message's `text`, then re-activates it with `JournalNotifyOption.Notify` | Yes, capped by the slots authored | Yes | [source] Virtual Atelier Delivery ([terminals §6.1](terminals-and-arcade.md#61-virtual-atelier-delivery)) |
| Wildcards (`{EN_ALIAS_…}`) in localised text, replaced in `MessangerItemRenderer.SetMessageView` and the reply renderer as each item is drawn | Yes, in fixed messages | Yes | [source] Eviction Notice `Gameplay/ENRentSystemBase.reds:858-890` |
| A journal-free contact: add a `ContactData` (own hash, `MessengerContactType.SingleThread`) in `MessengerUtils.GetSimpleContactDataArray` and `JournalManager.GetContactDataArray`, answer `GetMessageDataArrayForContact` for its hash, fill `MessengerDialogViewController` with messages and replies, and push a HUD toast (`JournalNotificationQueue.AddNewNotificationData` with `PhoneMessageNotificationViewData`) | Fully | No | [source] NightlyNow Core `Holo/HoloHook.reds`; Stock Market `modules/logic/newsManager.lua:154-290` |

### 2.7 Scenes

- A scene has named **entry points** and **exit points**; a quest scene node exposes them as input and output sockets [resource] every scene read.
- **Actors and props:** V as `scnPlayerActorDef` found in context; props as `scnPropDef` with `entityAcquisitionPlan: spawnDespawn`, so a scene can bring its own objects [resource] Dark Future `darkfuture_item_consume_anim_drink_sip_righthand.scene` (16 entry points, one per prop).
- **Events** seen: dialogue lines (`scnDialogLineEvent`, V's vanilla lines by string id), cinematic idle changes for V in a car seat (`scnChangeIdleAnimEvent`), skeletal animation (`scnPlaySkAnimEvent`), audio, VFX, camera parameters [resource] Dark Future scenes.
- **Pickup interactions:** a scene with a `show_choice` entry, a `hide_choice` entry driven by a trigger, and an `item_taken` exit makes a world pickup with a choice prompt [resource] Eviction Notice `glen_delivery.questphase` #23, #26, #34.
- **Scenes may contain quest nodes** (`scnQuestNode` wrapping fact, switch and condition nodes) [resource] Dark Future scenes.
- Voiced mod scenes get lip sync through ArchiveXL `localization: lipmaps:` ([lip sync §5](lipsync.md)).

### 2.8 World pieces

A quest's places are ordinary World Builder sectors in the mod's own streaming block: static markers for scenes and pins, trigger areas, hidden props revealed by `questShowWorldNode`, and devices registered through a `.devices` patch; always-loaded sectors hold markers that scenes must find from afar [resource] Eviction Notice (22 sectors, `custom_devices.devices`), Dark Future (`worldbuildergroup_df_consumableanim_alwaysloaded`). The streaming side is in [world and streaming](world-and-streaming.md).

## 3. A minimal quest recipe

The smallest complete quest built only from parts the installed mods prove, in the order a tool would emit them. XF names follow the [naming contract](../projects/xf-studio/data/naming.md) (`xfs_` identifiers, XF-branded titles).

1. **Place the world.** A World Builder sector in the mod's block: a static marker at the goal, a trigger area around it, optionally a hidden prop. Note their node refs (`$/mod/<sector>/#<name>`). [resource] Eviction Notice.
2. **Write the journal** (`xfs_…\journal\….journal`, listed under `journal:`):
   - `contacts/xfs_fixer` (`gameJournalContact`, `Texter`, an avatar record) with a conversation holding an intro message, a choice group with *Accept* and *Decline*, and a thanks message;
   - `quests/minor_quest/xfs_job` (`gameJournalQuest`, `MinorQuest`) with a description and one phase holding two objectives: *Go to the drop* (with a `gameJournalQuestMapPin` on the marker) and *Text the fixer* (with a `gameJournalQuestCodexLink` to the reply group).
   All texts are keys supplied by `localization: onscreens:` JSON. [resource] [source]
3. **Write the phase** (`xfs_…\quest\xfs_job.questphase`):
   `In1` → pause until `xfs_job_offer > 0` → message *intro* `Active` (with notification) → choice group `Active` → pause on *Accept* `Succeeded` (and a parallel pause on *Decline* into a cut-control node) → quest `Active`, objective 1 `Active` → pause until player `IsInside` the trigger → (optional) scene with a pickup choice → objective 1 `Succeeded`, add the reward item (`questAddRemoveItem_NodeType`) → objective 2 `Active` → reply group `Active` → pause on its choice `Succeeded` → objective 2 and quest `Succeeded` → set `xfs_job_done = 1`. [resource] Eviction Notice `glen_delivery.questphase`
4. **Attach it:** `quest: phases: - path: …\xfs_job.questphase, parent: <a scope covering cyberpunk2077.quest and the New Game+ quests>`; add `ep1\quest\ep1_standalone.quest` for Phantom Liberty starts. [source]
5. **Start it.** Either from the graph (a pause on vanilla facts such as `q101_enable_activities_flat`, then a game-time delay) or from script by setting `xfs_job_offer = 1`. Money rewards and anything computed go through a request fact answered by script (§4). [resource] [source]
6. **Package** the phase, journal and sectors in one archive, texts in a second (so translators replace only that), and the `.xl` beside them; version the facts, because saves keep them. [resource] Eviction Notice's split archives.

What this recipe does not yet cover: dialogue with voiced NPCs in the world (scenes with actors and lines), companions, and fail states; those need scene authoring, which the installed mods show only for V and props. Directing an NPC and offering V choices *without* a scene (runtime AI commands, text lines and a hub added to the game's dialogue widget) is on [NPC direction](npc-direction.md).

## 4. How script and quest graphs work together

| Pattern | Shape | Evidence |
|---|---|---|
| **Command channel** | A looping phase: pause until `fact > 0` → switch on the value → scene entry point → reset `fact = 0` → loop. Script plays scene *N* by `SetFact(fact, N)` | [resource] Dark Future `darkfuture_general_voicelines.questphase`, `darkfuture_item_consume_anim.questphase` |
| **Request and response** | Graph sets `…_action_… = 1` and pauses until it is 0; script's listener computes, writes result facts, resets the request; graph branches on the result | [resource] Eviction Notice `glen_delivery.questphase` #105-#106, #113-#115; [source] `ENRentSystemBase.reds:620-660` |
| **Readiness gate** | Scripts set `…_system_running = 1` at start; the root phase waits for all of them before starting sub-phases | [resource] Eviction Notice `new_game_experience.questphase` #7-#11, #54 |
| **Debug trace** | Graph writes numbered values to a debug fact; script logs them | [resource] same, #40-#45 |
| **Graph → entity events** | A named `ActionEvent` sent to an entity lands on an `@addMethod` handler of its class; Lizzie's Braindances receives such events on its performers (which of its graphs sends them was not read) | [source] Lizzie's Braindances `NPCPuppet.reds:57-106`; sender [hypothesis] |
| **Game-state gate** | Script refuses to start story beats before the prologue ends, after the point of no return, as Johnny (`PlayerPuppet.IsReplacer`), in cyberspace or fury, and when `PlayerStateMachine.SceneTier` is above 2 | [source] Dark Future `Services/DFGameStateService.reds` |
| **Game-time clock** | `TimeSystem.RegisterListener(entity, event, GameTime, repeat)` delivers an event at a game time (vanilla passes `-1` to repeat, `1` for once); `DelaySystem.DelayCallback(cb, seconds, affectedByTimeDilation)` for real-time intervals. Game time runs at `timeSystem.settings.realTimeMultiplier` (8.0) | [source] 2.31 `gameTimePrereq.script:39-43`; Eviction Notice `ENPropertyStateService.reds:158-162`; [resource] `time.tweak:5` |

## 5. Braindances

### 5.1 The vanilla braindance

| Piece | What it is | Evidence |
|---|---|---|
| The recording | A **scene** played in braindance mode, with conditions on layer (`Visual`, `Audio`, `Thermal`), perspective (first or third person), playback speed, and jump, pause, reset and rewind states | [source] SDK `scn/BraindanceLayer_ConditionType.hpp`, `BraindancePerspective_ConditionType.hpp`, `BraindancePlaying_ConditionType.hpp` and siblings |
| Per-performer presentation | Scene events: `BraindanceVisibilityEvent` (a performer's custom material parameter and first- and third-person render settings), `VFXBraindanceEvent` (effect and glitch effect, rewindable), `UIAnimationBraindanceEvent` | [source] SDK `scn/events/` |
| Clues | Quest nodes `AddBraindanceClue_NodeType` (`clueName`, `startTime`, `endTime`, `layer`), `DiscoverBraindanceClue_NodeType`, `EnableBraindanceFinish_NodeType` | [source] SDK `quest/` |
| Mode and controls | `BraindanceSystem` (persistent input mask, editor-state, pause and camera-toggle requests, `isInBraindance`), the player state machine's braindance locomotion (fly, fast fly) and controls | [source] 2.31 `core/systems/sceneSystem.script:2-160`, `cyberpunk/player/psm/locomotionBraindance.script` |
| UI | The `Braindance` blackboard (vision mode, progress, section time, clue, `IsFPP`, playback speed and direction) and `BraindanceGameController` (timeline, clue markers, layer bar) | [source] `core/blackboard/blackboardDefinitions.script:1064-1086`, `cyberpunk/UI/widgets/braindance/braindance.script` |

### 5.2 Staged braindances (Lizzie's Braindances)

The installed braindance mod plays ordinary scenes in real places and parametrises them:

1. The player picks a braindance and a cast in a menu; the menu writes **facts** for location, loops, music and each performer slot's character, appearance and flags [source] `MenuUIController.reds:3286-3306`.
2. **Casting:** six fixed `Character.LizziesBDs_Performer*` records are rewritten with `TweakDBManager.SetFlat` (`entityTemplatePath`, `appearanceName`, `genders`, names, attitude) and `UpdateRecord`, so the scene's spawn-by-record actors become the chosen vanilla NPCs, V's cutscene rig or another mod's character [source] `MenuUIController.reds:3787-3848`.
3. **Dressing:** named `ActionEvent`s (sent, presumably, from its graphs [hypothesis]) tell each performer to switch appearance (`ScheduleAppearanceChange`) [source] `NPCPuppet.reds:57-150`; **per-instance parts** are set by editing mesh components in `NPCPuppet.OnRequestComponents` before the entity streams [source] `NPCPuppet.reds:162-276`.
4. **Content packs** register extra characters through a `CustomCharacterLoaderEvent` handler [source] `Classes.reds:1081-1130`.

### 5.3 What player-made or generated braindances would need

- **A recording is a scene resource.** Recording V's play as a braindance means writing a `.scene` (tracks of positions, animations and camera) from captured data, the same export problem as a quest editor [hypothesis].
- **Casting by record rewrite** gives any number of variants of one authored scene [source, above]; a generator would vary cast, place and music through facts and flats.
- **Investigation gigs** would be a template scene plus generated `AddBraindanceClue` nodes over its timeline; whether clue nodes work on a mod scene in braindance mode is untested [hypothesis].
- **Entering braindance mode** from a mod has no installed example; the first probe is to replay a vanilla braindance quest's node sequence against a mod scene [hypothesis].

## 6. Persistent systems and generated content

### 6.1 Where long-lived state lives

| Mechanism | Example | Survives | Evidence |
|---|---|---|---|
| `persistent` fields on a `ScriptableSystem` (scalars, arrays, nested objects) | Dark Future (39 fields), Virtual Atelier Delivery (34, nested order objects), Lizzie's (arrays of storage objects, with old layouts kept for migration) | The save | [source] |
| `@addField` `persistent` on a vanilla device's persistent state | Eviction Notice adds three fields to `ApartmentScreenControllerPS` | The save, with that device | [source] `Devices/ENApartmentScreenControllerOverrides.reds:17-25` |
| Facts | Every mod's flags and counters | The save | [resource] |
| Codeware dynamic entities with `persistSpawn` | Delivery drop points | The save | [source] |
| A CET per-save file joined by a fact | Stock Market: psiberx's `GameSession` writes a session key fact (`_psxgs_session_key`) and a Lua data file named by save time in the mod folder | The file beside the mod; lost if the file goes | [source] `modules/external/GameSession.lua:60-300, 400-460` |
| Mod Settings | Every settings screen | Mod Settings' own storage, not the save | [source] |

More on save layout in [save files §4](save-files.md#4-where-mods-keep-their-data).

### 6.2 A robust architecture (Dark Future)

A base system class with a fixed lifecycle (`Init` → systems, blackboards, data, listeners, timers → `InitSpecific`; `Suspend`, `Resume`, `Stop`); start only after `RadialWheelController.OnLateInit` (safe for status effects), in dependency order, suspend in reverse; a game-state gate before any story beat; Codeware callback-system events for death, time skip and settings; published lifecycle events for add-ons; a tiny save footprint; and an uninstall path (switch off in settings, save, then remove files) [source] Dark Future `System/DFSystem.reds`, `Main/DFMainSystem.reds`; [resource] upstream `README.md`. Clocks that pause when they should: Virtual Atelier Delivery stops its order clock during braindances, as Johnny and in the time-skip menu [source] `VirtualAtelierDelivery.reds:566-595`.

### 6.3 What is generated at run time

Random encounters from the district's gang (`District_Record` chain → faction character lists → Codeware `DynamicEntitySystem`) [source] Dark Future `DFRandomEncounterSystem.reds`; news from gameplay observers and from vanilla quest completions (`JournalNotificationQueue.OnJournalUpdate`, `gameJournalQuest` `Succeeded`) [source] Stock Market `questManager.lua:24-48`; orders and their messages [source] Delivery. No installed mod generates quest graphs or journal entries; dynamic content is either fixed data parametrised by facts and flats, or journal-free UI.

## 7. Hot reload

| Change | Live? | Grade |
|---|---|---|
| Journal in a mod archive | Yes: Red Hot Tools moves archives from `archive/pc/hot` into `archive/pc/mod`, reloads them, forgets their resources and calls ArchiveXL's reload, which rebuilds the journal and keeps the tracked quest | [source] Red Hot Tools `Archives/ArchiveLoader.cpp:8-72, 273-358`; ArchiveXL `Journal/Extension.cpp:48-56` |
| A scene | On its next start, since the old resource is forgotten | [hypothesis] |
| A phase that is running | No; merged phases are patched at preload and running instances keep their definitions. Reload the save | [hypothesis from source] ArchiveXL `QuestPhase/Extension.cpp:80-139` |
| Facts | Yes: any script, CET or bridge write | [source] |
| redscript, TweakDB | Yes (`ReloadScripts`, `ReloadTweaks`), except struct fields and new request handlers | [source] Red Hot Tools `README.md` |

Under MO2, a hot-reloaded archive lands in MO2's overwrite folder, because the move targets the virtual `archive/pc/mod` [source] `ArchiveLoader.cpp:150-176` [hypothesis for the VFS effect].

## 8. What this means for XF Studio

- **A quest editor** is feasible as a writer of `.questphase`, `.journal`, sector and `.xl` files in WolvenKit's JSON form, using only the node types in §2.2; start from the §3 recipe [hypothesis].
- **Live testing** through the bridge needs fact read, write and watch, journal entry state, and a remote device event by node ref (the Eviction Notice route: `CreateNodeRef` → `EntityID.FromHash(NodeRefToHash(…))` → `CreatePersistentID(id, n"controller")` → `PersistencySystem.QueuePSEvent`) [source] Eviction Notice `ENRentSystemBase.reds:551-555, 756-774`; bridge side [hypothesis].
- **Keep quest logic restartable:** short phases started by facts can be retested after a hot reload without reloading the save [hypothesis].
- **An XF phone presence** (session notices, a Studio contact) can be built journal-free in our own code, NightlyNow style [source, pattern].

## Open questions

1. Does ArchiveXL's forced start run for a phase added to a save whose quest has already passed the start node, in every case (Act 2 saves, Phantom Liberty standalone)?
2. Does `TimeSystem.RegisterListener` with `repeat = 0` fire once or repeat? (Eviction Notice depends on it.)
3. Do `AddBraindanceClue_NodeType` and braindance mode work with a mod scene?
4. After a Red Hot Tools reload, does a newly started scene node load the new scene file?
5. How often do 16-bit injected phase ids collide across the installed phase mods, and with vanilla node ids in `cyberpunk2077.quest`?
6. Does a quest map pin on a node ref in an unloaded mod sector show at the right place before the sector streams?

## Related pages

[Terminals and arcade](terminals-and-arcade.md) · [World and streaming](world-and-streaming.md) · [Save files](save-files.md) · [Lip sync](lipsync.md) · [Player control](player-control.md) · [Runtime access](runtime-access.md) · [B1 deep dive](../research/mod-ecosystem/b1-story-systems.md) · [In-game possibilities](../research/backlog/in-game-possibilities.md)
