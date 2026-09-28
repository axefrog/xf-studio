# Deep dive B1: story systems and world state

Batch B1 of the [installed-mod survey](README.md#proposed-deep-dive-plan): the mods that tell stories, keep long-lived state and add quest content, read against the deep-dive checklist. It is where the quest, living-world and braindance directions of the [vision](../../docs/vision.md) and the [in-game possibilities register](../backlog/in-game-possibilities.md) (entries 23, 26 and 32-43) learn their craft. The distilled, reusable answers are in the new knowledge page [quests and story content](../../knowledge/quests-and-story.md); this page keeps the per-mod findings, the bugs and the recommendations.

**Evidence.** Everything here is offline, 29 September 2026. Mods were read in place under `PATH_TO_MO2/mods/<mod>/` (paths below are inside each mod's folder) and never modified. Each mod's quest phases, scenes and journals were extracted from its archive with WolvenKit CLI 9.0.1 (`unbundle`, then `convert serialize`) into a private scratch folder and read as JSON through two small summarisers (graph nodes, fields and socket connections; scene entry points, actors, props and events); no resource payload is kept in the repository. **Limit:** Lizzie's Braindances' 116 phases and 116 scenes were not read: the machine's free memory stayed under the shared 16 GB floor for the rest of the session, and the memory guard stopped both extraction attempts. Its findings come from its scripts, tweaks, `.xl` files, archive listing and description; statements about what its phases do are marked accordingly. Upstream sources: [Dark Future](https://github.com/DarkFortuneTeller/DarkFuture) (repository metadata only, at `a14f03c`, "Dark Future 2.1 work in progress"; the installed 2.0.3 was read from its files), [ArchiveXL](https://github.com/psiberx/cp2077-archive-xl) at `5474e34`, [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) at `b4d3415` and RED4ext.SDK at `ad727771`. Game references are the decompiled 2.31 script bundle (redscript-cli 0.5.31, a private scratch copy) and the REDmod TweakDB source `tools/redmod/tweaks/base/gameplay/static_data/time.tweak`. Grades follow the [knowledge rules](../../knowledge/README.md); **[resource]** here also covers a mod resource read as serialised JSON.

## Summary

| Mod (installed, enabled main / XF diagnostic) | What it is | Key takeaway for XF | Licence |
|---|---|---|---|
| Dark Future - Urban Survival Gameplay 2.0.3 (off / off) | 30k lines of redscript in 43 files: needs, addictions, conditions, vehicle sleep, time-skip forecasts; 5 quest phases, a phone therapist, a codex | The reference architecture for a large persistent system: a base system class with a strict lifecycle, ordered start-up after the radial wheel's late init, a game-state gate, facts as a command channel into quest phases, and only 39 small persistent fields | CC BY-SA 4.0 (GitHub): learning is free; any reuse carries attribution and share-alike, so treat as learn only |
| Eviction Notice - Story-Driven Rent System 1.0.3 (on / on) | 5.8k lines of redscript plus 30 quest phases, 363 phone messages, 5 minor quests, World Builder sectors and a device patch | The most complete mod-made quest installed: journal quest, objectives, map pins on mod-placed markers, trigger areas, scenes with pickup choices, item nodes and a phone thread, all in data; script and quest graph talk through request and response facts | None found: learn only |
| Lizzie's Braindances 2.31.0.0 (on / on) | 11.5k lines of redscript, 116 quest phases, 116 scenes, 300+ castable characters | Braindances here are staged scenes, not the vanilla braindance editor: the menu **casts** a fixed scene by rewriting performer TweakDB records at run time and switches their appearances from quest events | None found; the script header asks users not to edit it: learn only |
| Stock Market and News System 1.4.0 (on / on) | 11k lines of CET Lua: a market, a browser site, and news driven by player actions and quest completions | Generated, journal-free phone messages: a synthetic contact injected into the messenger's lists and rendered by overriding three controllers; news triggered by play and by vanilla quests finishing | Custom terms in `init.lua` (no re-upload, credit or permission for reused code): learn only |
| Virtual Atelier Delivery 1.0.10 (on / on) | 3.6k lines of redscript: timed deliveries of Virtual Atelier orders to spawned drop points | Already studied for messages and devices ([terminals §6.1](../../knowledge/terminals-and-arcade.md#61-virtual-atelier-delivery)); new here: a game-time order clock paused during braindances, Johnny and the time-skip menu, and map pins that come free with a spawned drop-point device | GPL-3.0 (djkovrik's `CP77Mods`): learn only (XF is MIT; clean room) |
| NightlyNow Core 1.1.3 (on / on) | 2k lines of redscript shared by the author's crime mods | A redscript framework for journal-free phone contacts and threads (contact handlers with typed replies and typing delays), interaction prompts written straight onto the HUD's blackboard, persistent tutorials | None found: learn only |

The triage called NightlyNow Core's phone module "holocalls". It is not: `Holo/HoloHook.reds` names the phone HUD controller (`NewHudPhoneGameController`); the module does text threads only, and its contacts are never callable [source] `r6/scripts/NightlyNow/Holo/HoloHook.reds`.

## Answers to the batch's cross-cutting questions

### 1. The anatomy of a mod-added quest

Every quest mod in the batch builds the same machine from the same parts. The full recipe, graded, is in [quests and story §3](../../knowledge/quests-and-story.md#3-a-minimal-quest-recipe); in brief:

| Part | How the batch declares it | Evidence |
|---|---|---|
| **Attachment** | An `.xl` with `quest: phases:` naming a `.questphase` and a parent quest. With no `input`, ArchiveXL wires the phase to the parent's start node (`Out` → `In1`); it forces the phase to start once per save (a per-node fact records that it has), so a mod added to an existing save still runs. Dark Future and Eviction Notice declare a `resource: scope:` alias (`df_combined_scope.quest`, `en_combined_scope.quest`) that expands to `cyberpunk2077.quest` plus the three New Game+ quests, so one line covers both; Lizzie's Braindances lists the five parents separately | [source] ArchiveXL `QuestPhase/Config.cpp:10-60`, `Extension.cpp:97-176, 178-238, 354-378`; [resource] each mod's `.xl` |
| **Sub-phases** | A root phase starts further phases with `questPhaseNodeDefinition` nodes whose `phaseResource` is another mod `.questphase`, entered through named input sockets (`SystemStart`, `DeliveryStart`). Only the root phases appear in the `.xl`: Eviction Notice ships 30 phases and lists 21 | [resource] `new_game_experience.questphase` (#2-#6, #48, #66), `glen_payrent.questphase` |
| **Flow** | Pause nodes wait on facts (`questFactsDBCondition` with `questVarComparison_ConditionType` or `questVarVsVarComparison_ConditionType`), journal states (a phone choice `Succeeded`), trigger areas (player inside or outside a mod-placed trigger), game or real time, and UI state (menus closed). Switch nodes (`First_Fulfilled`) branch on a fact's value; `questCutControlNodeDefinition` kills the other branches once one reply is chosen | [resource] Eviction Notice and Dark Future phases |
| **Journal** | One `.journal` merged by ArchiveXL's `journal:`. Phone content is `contacts/<contact>/<conversation>/<message or choice group>/<choice>`; quests are `quests/minor_quest/<quest>` with a description, a phase, objectives and map pins; `onscreens/` holds popups; `codex/tutorials/` holds codex pages. Text fields hold string keys (`EvictionNotice_TextMsg_…`) that ArchiveXL turns into hashed `LocKey#` ids at load, resolved from the mod's `localization: onscreens:` JSON | [resource] both journals; [source] ArchiveXL `Journal/Extension.cpp:478-501` |
| **Objectives and map pins** | A `questJournalNodeDefinition` sets an objective `Active` or `Succeeded`. A pin is a `gameJournalQuestMapPin` under the objective: `Mappins.QuestStaticMappinDefinition`, `enableGPS`, an offset, and an entity reference to a **node ref in the mod's own sector** (`$/mod/worldbuildergroup_…/#…_static_marker`) placed with World Builder; ArchiveXL resolves it and synthesises the cooked mappin | [resource] `eviction_notice.journal` (`glen_loyaltyquest`); [source] ArchiveXL `Journal/Extension.cpp:504-541` |
| **Facts** | Written by `questFactsDBManagerNodeDefinition` (`setExactValue` sets, otherwise the value is **added**, which is how the loyalty quest counts found items to 3) and by script `QuestsSystem.SetFact`; read by conditions and by script listeners | [resource] `glen_delivery.questphase` #25, #33, #47, #24 |
| **Phone messages and contacts** | Journal nodes activate messages and choice groups in order (each message has a `delay` in seconds); a pause on each choice entry's `Succeeded` state picks the branch | [resource] `darkfuture_therapy.questphase` (129 journal nodes), EN phases |
| **Scenes** | `questSceneNodeDefinition` plays a `.scene` at a node-ref marker (`#player`, or a mod sector's marker), entering by a named entry point and leaving through named exit sockets. Eviction Notice's pickup scenes expose `show_choice`/`hide_choice` entries and an `item_taken` exit | [resource] `glen_delivery.questphase` #23, #26, #34, #41, #49 |
| **World** | `questShowWorldNode_NodeType` reveals a mod-placed prop; `questDeviceManager_NodeType` drives a mod-placed device (a screen's `ForceON`, `QuestStartGlitch`); `questTutorial_NodeType` with `questShowPopup_NodeSubType` shows a journal onscreen | [resource] `glen_delivery`, `glen_screenproximity`, `glen_rentpopup` phases |
| **Rewards** | Items by `questAddRemoveItem_NodeType` (add three quest items, later remove them); money and discounts from script (`TransactionSystem.GiveMoney`, `RemoveItemByTDBID`); status effects from script | [resource] `glen_delivery` #19, #32, #45, #55-57; [source] `Eviction Notice/Utils/ENCommon.reds:67-90` |

The two patterns worth copying exactly:

- **The fact command channel** (Dark Future). A phase loops on one pause node: wait until `df_fact_play_voice_line > 0`, switch on its value into one of ten scene entry points, play the scene, reset the fact to 0 with `setExactValue`, and loop. Script plays any of those scenes by setting one integer [resource] `darkfuture_general_voicelines.questphase` #2-#6; [source] `Conditions/DFConditionSystemHumanityLoss.reds:1538-1639`. The same shape runs the vehicle-sleep scene, the withdrawal animation and 16 consumable animations (`df_fact_action_play_anim_by_id`).
- **The request and response handshake** (Eviction Notice). A phase sets `en_fact_action_update_glen_has_available_discount = 1` and pauses until it reads 0; the script's fact listener computes the answer, writes it to a result fact, and resets the request to 0; the phase then branches on the result [resource] `glen_delivery.questphase` #113-#115, #105-#106; [source] `Gameplay/ENRentSystemBase.reds:620-660`. It lets data-authored quests ask script for anything (balances, settings, rent state) without script knowing the graph.

### 2. Braindances

**Lizzie's Braindances does not use the braindance editor.** Its "braindances" are staged scenes played in real places (Lizzie's booths, apartments, a Ferris wheel cabin), with V as participant or spectator; the editor's overlay is a cosmetic option (`bd_editor_overlay`, a setting fact) [source] `r6/scripts/LizziesBDs/Data.reds:1042`. What makes it a *system* rather than a set of scenes is how a fixed scene is parametrised:

| Step | Mechanism | Evidence |
|---|---|---|
| Choose | A full-screen menu (4.3k lines) injected into a HUD controller that is always alive (`NcartMetroMapController`), while a wrap of `DefaultTransition.AreChoiceHubsActive` tells the player state machine a choice hub is up, which holds V's actions | [source] `UI.reds:21-86`, `ChoiceHubsActiveTweak.reds` |
| Pass parameters | The menu writes facts: location, number of loops, music, and per performer slot the character, appearance, gender, size and flags (`lizzies_bds_…_<slot>`) | [source] `MenuUIController.reds:3286-3306` |
| **Cast** | Six fixed records `Character.LizziesBDs_Performer[_2…_6]` stand in the scenes. Before playback the menu rewrites each record's `entityTemplatePath`, `appearanceName`, `genders`, display names and attitude with `TweakDBManager.SetFlat` and `UpdateRecord`, so the scene's spawn-by-record actor becomes the chosen vanilla NPC, V's own cutscene rig (`Character.TPP_Player_Cutscene_Female/Male`) or another mod's entity | [source] `MenuUIController.reds:3787-3848`; [resource] `r6/tweaks/LizziesBDs/LizziesBDs.yaml` |
| Dress and undress | Named `ActionEvent`s (`Normalni_P1`, `BezObleceni_P1` …) reach the performers, presumably from its quest or scene graphs [hypothesis: the phases were not read]; an `@addMethod(NPCPuppet)` handler calls `ScheduleAppearanceChange` with the dressed or undressed appearance for that slot | [source] `NPCPuppet.reds:57-150` |
| Assemble the body per instance | A wrap of `NPCPuppet.OnRequestComponents` edits named mesh components (mesh path, chunk mask, mesh appearance, enabled) **before** the original call, so the entity streams in with the chosen parts | [source] `NPCPuppet.reds:162-276` |
| Extend | Other mods add characters by handling `CustomCharacterLoaderEvent` (queued on the UI system at player attach) and calling `AddCharacter(gender, price, entityPath, appearances)`; music the same way | [source] `LizziesBDsMain.reds:48-85`, `Classes.reds:1081-1130` |
| Remember | Favourites, purchases and replays in `persistent` arrays of objects on a scriptable system, with V2 → V3 migration classes kept in the code | [source] `Storage.reds:20-43, 328-342` |

**The vanilla braindance, for contrast,** is a scene resource played in braindance mode: `BraindanceSystem` (persistent input mask, editor-state and pause requests), the `Braindance` blackboard (vision mode, progress, section time, clue, first or third person, playback speed and direction), the HUD's `BraindanceGameController` timeline, scene conditions for layer (visual, audio, thermal), perspective and playback speed, scene events for per-performer visibility, VFX and UI animation, and quest nodes that add a clue on a layer over a time window (`AddBraindanceClue_NodeType`: `clueName`, `startTime`, `endTime`, `layer`), discover it, and enable finishing [source] 2.31 `core/systems/sceneSystem.script:2-160`, `core/blackboard/blackboardDefinitions.script:1064-1086`, `cyberpunk/UI/widgets/braindance/braindance.script`; SDK `quest/AddBraindanceClue_NodeType.hpp`, `scn/BraindanceLayer_ConditionType.hpp`, `scn/events/BraindanceVisibilityEvent.hpp`.

**What player-made or generated braindances would need** [hypothesis, from the above]:

1. **A recording is a scene.** The engine plays braindances as scenes with a timeline, so "recording V's own play" (register entry 43) means writing a `.scene` from a captured route (positions, animations, camera) rather than replaying input. That is an authoring and export problem, the same one a quest editor has.
2. **Casting by record rewrite is the cheapest parametrisation.** One authored scene serves any cast. A generator would emit a small number of template scenes and vary performers, appearances, place and music through facts and record flats, exactly as Lizzie's does.
3. **Investigation gigs need the clue nodes.** Clues are quest nodes bound to a scene's time and layer, so a generated gig is a template scene plus a generated clue list; nothing installed does this yet, and whether `AddBraindanceClue` works on a mod scene in braindance mode is untested.
4. **Entering braindance mode** from a mod has no installed example. The vanilla route goes through quest nodes and `BraindanceSystem` requests; a first probe would replay a vanilla braindance quest's node sequence against a mod scene.

### 3. Persistent systems: Dark Future's architecture

| Piece | What it does | Evidence |
|---|---|---|
| `DFSystem` base (`ScriptableSystem`) | Every system has `Init` → `DoInitActions` (get systems, blackboards, data, listeners, delay callbacks) → `InitSpecific`, plus `Suspend`, `Resume`, `Stop`, per-system setting toggles and time-skip hooks; a commented template lists the 17 required overrides | [source] `System/DFSystem.reds` |
| Event fan-out | A `ScriptableService` listener per system receives Codeware callback-system events (player death, time-skip start, cancel and finish, setting changed) and forwards them to the system | [source] `System/DFSystem.reds:39-82` |
| Ordered start | `DFMainSystem` starts everything only when the radial wheel finishes its late init ("safe to act on systems that might apply status effects"), in a fixed order: settings, lifecycle event, services, gameplay systems, needs, addictions, cyberware, conditions, nerve, UI, compatibility, then reconciliation, codex, first-run message and version upgrades; suspend runs in reverse. Lifecycle events (`MainSystemLifecycleInitEvent` … `SuspendDoneEvent`) are published for add-ons | [source] `Main/DFMainSystem.reds:129-143, 353-560` |
| Game-state gate | `DFGameStateService.GetGameState` refuses before the prologue's end (three facts), after the point of no return (`q115_point_of_no_return`), while playing Johnny (`IsReplacer`), in cyberspace or fury, while sleeping, and above a scene tier (2, or 3 for limited gameplay) | [source] `Services/DFGameStateService.reds` |
| Scheduler | `DelaySystem` callbacks wrapped so a duplicate registration never doubles a timer; game-time intervals divided by a `timescale` setting | [source] `DelayHelper/DFDelayHelper.reds`; `Needs/DFNeedSystemBase.reds:409, 1189` |
| Settings | Mod Settings fields with shadow copies; `ReconcileSettings` diffs them into a `SettingChangedEvent` of changed names; TweakDB flats are rewritten at `Session/Start` | [source] `Settings/DFSettings.reds:60-140, 549-620` |
| Save state | 39 `persistent` fields in all, mostly scalars (need values, stages, durations, last-restored days, once-only flags) | [source] `grep "persistent let"` |
| Story hooks | Fact listeners on vanilla quest facts (`sq021_randy_saved`, `sq028_kerry_relationship`, `sq030_romance`, `q305_medal_given_away` …) move humanity; metro, homeless-charity and confession facts restore it | [source] `Conditions/DFConditionSystemHumanityLoss.reds:508-528` |
| Mod compatibility | Six `ModuleExists` probes; other mods' facts read as events (Idle Anywhere, Immersive Food Vendors and Immersive Bartenders publish consumption as `dec_dark_*` fact values, `-1` meaning ready) | [source] `Gameplay/DFModCompatSystem.reds` |
| Uninstall | The page's procedure: switch the mod off in its settings (removing its status effects), save, then delete files | [resource] upstream `README.md` |

**Robust:** the lifecycle is uniform and reversible, systems never act outside the gate, the save footprint is tiny, and all story output goes through a handful of facts. **Fragile:** see the bugs in §1 of the per-mod findings (half the fact listeners survive `Stop`; the timescale is a setting, not the game's).

### 4. Generated and dynamic content

| Mod | What is generated at run time | From what |
|---|---|---|
| Dark Future | Random encounters while V sleeps in a car: the district's record chain yields a hostile gang, 2-4 NPCs of that gang (or city scavengers, 15%) spawn with Codeware's `DynamicEntitySystem` in eight slots 5 m around the car | [source] `Gameplay/DFRandomEncounterSystem.reds:139-330` |
| Stock Market | News items and price shocks: 33 trigger modules observe play (kills by faction, vehicle theft, vending machines, purchases, quickhacks, wanted level) and quest completions (the journal notification queue reporting a `gameJournalQuest` as `Succeeded`, keyed by the quest's title LocKey), decay over time and cross thresholds that queue a message with a delay | [source] `modules/logic/triggers/*.lua`, `questManager.lua`, `newsManager.lua` |
| Virtual Atelier Delivery | Orders with game-time timestamps, status updates and texts, delivered to a chosen spawned drop point | [source] `VirtualAtelierDelivery.reds:60-90, 1880-1995` |
| Eviction Notice | Rent cycles, late fees and evictions computed each midnight; messages are fixed text with `{EN_ALIAS_…}` wildcards filled when the phone draws them | [source] `Services/ENPropertyStateService.reds:155-250`; `Gameplay/ENRentSystemBase.reds:858-890` |
| NightlyNow Core | Whatever its client mods generate: contact handlers push free text and replies | [source] `Holo/HoloHook.reds` |

The hard limit is the journal: script cannot create journal entries, so everything dynamic is either a pre-authored entry with rewritten text (Delivery, Eviction Notice) or a journal-free UI injection (Stock Market, NightlyNow). **No installed mod generates quests or gigs**; all quest graphs are fixed data, parametrised by facts.

### 5. Hot reload

| What changes | Can it reload without restarting? | Evidence |
|---|---|---|
| Journal (`.journal` in a mod archive) | **Yes, through Red Hot Tools.** It moves archives from `archive/pc/hot` into `archive/pc/mod`, unloads and reloads them, forgets their resources, and calls ArchiveXL's reload, whose journal extension rebuilds the journal tree and restores the tracked quest and point of interest | [source] Red Hot Tools `Archives/ArchiveLoader.cpp:8-72, 150-358, 414-418`; ArchiveXL `Journal/Extension.cpp:48-56` and `ReloadJournal` |
| Scenes | Probably on the next start of a scene node: the loader forgot the old resource, so a newly started node loads the new file [hypothesis] | same |
| A quest phase already running | **No, in practice.** Merged phases are patched when the phase resource is preloaded; running graph instances keep their loaded definitions, and forced starts are recorded per save. Changes to a running phase need at least a save reload [hypothesis from source] | ArchiveXL `QuestPhase/Extension.cpp:80-139` |
| Facts | Yes, live: script, CET or a bridge can set any fact, which is how every mod here drives its graphs | [source] |
| redscript | Yes, with Red Hot Tools' `ReloadScripts`, with two limits: struct fields are not reinitialised, and new scriptable-system request handlers need a session reload | [source] Red Hot Tools `README.md` |
| TweakDB | Yes (`ReloadTweaks`), and script can rewrite flats live (Lizzie's casting) | [source] |
| CET Lua | "Reload all mods" reruns `init.lua`; Stock Market warns that this loses its session data, because its per-save file is only read at session start | [source] `init.lua:67-80` |

Two practical notes: a hot reload under MO2 moves the archive into the virtual `archive/pc/mod`, so the file lands in MO2's overwrite folder; and the quickest live test of a quest change is to keep the logic in facts and small phases that are started fresh (the fact-channel pattern), not in one long-running graph.

## 1. Dark Future - Urban Survival Gameplay

**How it works.** A family of `ScriptableSystem`s (§3 above) started after `RadialWheelController.OnLateInit`. Needs (hydration, nutrition, energy, nerve) fall on game-time timers and are restored by consuming items; addictions (alcohol, nicotine, narcotics) and conditions (injury, humanity loss with cyberpsychosis) build and decay; vehicle sleep and summoning, stash crafting and random encounters sit beside them. Visible output is status effects, HUD bars, notifications and quest-phase scenes.

**Hook points.** 258 annotations: 125 wraps, 10 replacements, 57 added methods and 66 added fields. The busiest targets: `PlayerPuppet` (15 wraps), `TimeskipGameController` (8, the time-skip forecast), `BackpackMainGameController` (5), `WarningMessageGameController`, `VehicleObject` and `InputContextTransitionEvents` (4 each). Replacements: `PlayerPuppet.ProcessTieredDrunkEffect`, `VehicleEventsTransition.HandleCameraInput` (camera while asleep in a car), both `InventoryGPRestrictionHelper.CanUse` overloads, `ItemQuantityPickerController.UpdateWeight`, `buffListGameController.UpdateBuffDebuffList`, `inkCooldownGameController.RequestCooldownVisualization` and `OnEffectUpdate`, `SingleCooldownManager.Update`, and `ProgressionNotification.SetNotificationData` [source]. Input Loader XML adds `DFVehicleSleepAction` (hold X, pad right) and a consume-choice action [resource] `r6/input/Dark Future.xml`.

**Data added.** Five phases (vehicle sleep, general voice lines, withdrawal animation, therapy, humanity-loss restore) plus the consumable-animation module's phase, all under the combined New Game+ scope; 10 scenes; a journal with one contact (`df_novamind`, 96 messages, 37 choice groups) and nine codex tutorials; a factory CSV; 19 languages of onscreens and subtitles; 33 TweakXL files; one World Builder block with an always-loaded sector for the animation props; two replaced drunk-effect `.effect` files under `base\fx\player\p_drunk_effect\` [resource].

**State and persistence.** 39 `persistent` fields (§3); a once-only fact list kept as a persistent `array<CName>` [source]. Settings live in Mod Settings, not the save.

**UI technique.** HUD bars and a conditions menu built from script and one `.inkwidget` (`darkfuture\gui\conditions.inkwidget`); tutorials through the game's popup with Bink videos; a status-effect list slotted into the radial wheel [source] [resource].

**Undocumented engine knowledge.**
- The radial wheel's `OnLateInit` as the "safe to apply status effects" moment; `PlayerPuppet.IsReplacer()` for Johnny sections; `PlayerStateMachine.SceneTier` as the cinematic gate [source].
- A scene can put V's cinematic idle into a car seat (`scnChangeIdleAnimEvent` with `sit_car_autodrive_*` clips) and play VFX, with `questGameplayRestrictions_NodeType` (no world interactions, time skip, phone, device interaction) and `questSetUIGameContext_NodeType` (`CinematicCamera` push and pop) around it [resource] `darkfuture_vehicle_sleep.scene`, `darkfuture_addiction_withdrawal_anim.questphase`.
- Consumable animations are scenes whose props are `spawnDespawn` actors: one scene per hand and grip, 16 entry points per scene, one per prop [resource] `darkfuture_item_consume_anim_drink_sip_righthand.scene`.
- V's voiced reactions reuse the base game's own lines (59 screenplay lines with vanilla string ids, no lip-sync names) in a scene played at `#player` [resource] `darkfuture_general_voice_lines.scene`.

**Novelty.** The only installed mod with a phone-based character (a therapist) whose sessions are journal-driven branching conversations; the only one forecasting its own state hour by hour for the time-skip screen.

**Bugs, fragility and conflicts.**
- **Half the fact listeners survive `Stop`.** `UnregisterAllDFFactListeners` removes the element at `i` and then increments `i`, so it skips every other entry; the skipped listeners stay registered with the quests system. On player death, or a restart through `PlayerAttachedCallback` (Act 2 and player replacers), `Init` registers them again, so callbacks can fire twice [source] `Utils/DFFactListenerUtils.reds` (`UnregisterAllDFFactListeners`).
- **The clock is a setting.** Timers use `interval / Settings.timescale` with a default of 8.0, which matches the game's `timeSystem.settings.realTimeMultiplier = 8.0`; a mod that changes that flat makes needs drift unless the player mirrors it by hand [source] `Settings/DFSettings.reds:2767-2773`; [resource] `time.tweak:5`.
- **Callbacks find their listener by stack trace.** `DFFactListenerCanRun` calls `GetStackTrace(1, true)` on every fact change to find the calling function's name [source] `Utils/DFFactListenerUtils.reds`. Costly and dependent on function naming.
- **Latent hard conflict** with DigitalVixen Core over `SingleCooldownManager.Update` and `inkCooldownGameController.RequestCooldownVisualization` (both replaced by both mods); **wrap-over-replace** with Immersive Timeskip on the time-skip controller ([triage](README.md#conflict-list)). Dark Future is disabled in both profiles, so neither is live.
- Many replacements of UI functions that patches touch (buff list, cooldowns, notifications) and a replaced vanilla `.effect`.

**Performance.** Timers at 300 game seconds (37.5 s real) per need, plus short FX timers; the gate check logs on every refusal (logging is off by default); the stack-trace lookup per fact change. No per-frame work found [source].

**Licence.** CC BY-SA 4.0 on GitHub. Learning is free; code or resources reused would bring attribution and share-alike obligations, which XF (MIT) should not take on. Learn only.

**Relevance.** The model for any long-lived XF system (a living-world layer, per-limb damage, relationships): the lifecycle, the gate and the fact channel are directly adoptable ideas. Its therapist shows how much story a phone thread can carry with no voice work.

**Conflicts with XF's mods or the bridge.** None with the bridge's hooks. Its game-state gate is the list of moments a bridge-driven story demo should also avoid.

**Adopt / avoid.** Adopt the lifecycle contract, the ordered start after late init, the gate, lifecycle events for add-ons, and the fact channel. Avoid removing from an array while indexing forward, a hand-set timescale (read `timeSystem.settings.realTimeMultiplier`), stack-trace dispatch, and replacing shared UI functions.

## 2. Eviction Notice - Story-Driven Rent System

**How it works.** Five rent systems (one per apartment) on a base class, a property-state service with a midnight clock, a bill-pay system, an estate-agent system (Bob), a game-state service and settings, all in the same architecture as Dark Future (`ENSystem` mirrors `DFSystem`). Script owns the numbers; 30 quest phases own the conversations, quests, popups and screens, and the two talk through `en_fact_action_*` request facts [source] [resource].

**Hook points.** `RadialWheelController.OnLateInit` and `DeathMenuGameController.OnInitialize` (lifecycle); `ApartmentScreenControllerPS` (three persistent `@addField`s and wraps of `UpdateCurrentOverdue`, `InitializeRentState`, `ReEvaluateRentStatus`, `GetInitialOverdueValue`, `GetStateChangeProbabilityValue`) so the vanilla rent screens show the mod's state; `MessangerItemRenderer.SetMessageView` and `MessangerReplyItemRenderer.OnJournalEntryUpdated` (wildcards); `JournalEntriesListController.PushEntries` (hides reply choices the settings rule out); `WebPage.FillPageFromJournal`/`FillPage` (prices on EZEstates pages); `WorldMapTooltipController.SetData`/`Reset`; `PopupsManager.ShowTutorial`; an `@addMethod(PlayerPuppet)` event handler for the midnight clock [source].

**Data added.** 21 root and 9 nested phases; 6 scenes; a journal with 8 contacts, 29 conversations, 363 messages, 55 choice groups, 5 minor quests (one built: the Glen loyalty quest), objectives, map pins and 4 onscreens; one replaced vanilla `.inkwidget` (`web_template_apartments_01_product_page`); 22 World Builder sectors in a block (screens, signage, trigger areas, scene-root markers, quest props) with a `.devices` patch onto `03_night_city.devices`; three Removal Editor `.xl` files deleting the vanilla apartment screens it replaces; four TweakXL files (text-message image, display names, quest items, rent-status messages) [resource].

**State and persistence.** 24 `persistent` fields: rent state, cycle days, balances and eviction days per property, plus three fields added to the vanilla screens' persistent state [source].

**UI technique.** Almost none of its own: phone threads, journal quests, vanilla popups and the vanilla rent screens, filled with data. Dynamic numbers come from wildcards substituted as the phone draws each message, so fixed localised text shows live amounts [source] `Gameplay/ENRentSystemBase.reds:858-890`.

**Undocumented engine knowledge.**
- **Reaching a device that is not streamed in.** `CreateNodeRef(path)` → `EntityID.FromHash(NodeRefToHash(ref))` → `CreatePersistentID(entityID, n"controller")` → `PersistencySystem.QueuePSEvent(id, n"DoorControllerPS", action)` locks or unlocks V's apartment doors from anywhere, with the door's own quest actions (`ActionQuestForceCloseImmediate`, `ActionQuestForceSeal`, `ActionQuestForceUnlock`) [source] `Gameplay/ENRentSystemBase.reds:186-187, 551-555, 756-774`.
- A one-shot game-time listener: `TimeSystem.RegisterListener(player, event, GameTime.MakeGameTime(days + 1, 0), 0)` delivers an event at midnight to an `@addMethod` on the player [source] `Services/ENPropertyStateService.reds:158-162`.
- A mod phase can glitch and switch a mod-placed screen through `questDeviceManager_NodeType` (`LcdScreenController`, `ForceON`, `QuestStartGlitch`) as V walks into a trigger [resource] `glen_screenproximity.questphase`.
- A graph-side debug channel: phases write numbered values to `en_fact_propertystateservice_debug`, which the script logs, to trace which branch ran [resource] `new_game_experience.questphase` #40-#45; [source].
- The authors tried and abandoned an `input`/`output` injection into `q001_apartment.questphase`; the commented-out block in the `.xl` shows the node-path form [resource] `eviction_notice.xl`.

**Novelty.** The only installed mod with a data-authored mini-quest using every part (journal quest, objectives, pins on mod markers, triggers, pickup scenes, items, a phone thread, a script-computed reward), and the only one that re-owns vanilla devices' persistent state.

**Bugs, fragility and conflicts.**
- **The midnight clock may fire once per session.** The listener is registered with `repeat = 0` and never re-registered; vanilla uses `-1` for repeating and `1` for once [source] 2.31 `core/gameplay/prereqs/gameTimePrereq.script:39-43`. `UpdateCurrentDay` is called from nowhere else, so if 0 means "once", rent cycles advance only on the first midnight after each load (missed days are caught up then). The mod's page says it runs every midnight, so 0 may repeat; this needs an in-game check.
- The start-up hand-off waits on five `en_fact_<property>_system_running` facts; if a property system fails to start, the whole new-game experience stalls silently [resource] `new_game_experience.questphase` #7-#11.
- Node deletions of vanilla screens by placement index and `expectedNodes` (Removal Editor presets) break quietly on a game patch that renumbers those sectors; the Apartments Enhanced variants ship "Eviction Notice" versions that delete each other's nodes (already in [world and streaming](../../knowledge/world-and-streaming.md#4-risks-and-conflicts)).
- Replaces the vanilla apartment product-page `.inkwidget` outright.
- Wraps `WorldMapTooltipController.SetData` like seven other installed mods; order-dependent only if two change the same tooltip.

**Performance.** One midnight event, fact listeners and render-time string checks on each phone message (`StrContains("{EN_ALIAS_")`) [source]. The page's claim of near-zero cost matches the code.

**Licence.** None found in the package; the Nexus description credits psiberx, keanuWheeze, MisterChedda, Bill, Deceptious, LiquidBronze and Fwum Chonion for help. Author not evidenced in the package (the description presents it as a sibling of Dark Future, and its code mirrors Dark Future's, but that is not attribution). Learn only.

**Relevance.** The worked example for XF's quest direction (register entry 23) and for "apartments as homes" (entry 34). The node-ref → persistent-ID route is a ready primitive for bridge world commands (open or seal a door, switch a device, far from V).

**Conflicts with XF's mods or the bridge.** None with the bridge's hooks. A bridge `world.door` or device command would share the door PS with Eviction Notice's locks; read its `rentState` facts before unlocking V's apartments in a test.

**Adopt / avoid.** Adopt the request and response facts, wildcards in localised text, sub-phases with named inputs, the debug fact, and remote PS events. Avoid a single start-up gate with no timeout, and replacing vanilla ink resources.

## 3. Lizzie's Braindances

**How it works.** A launcher phase (`lizzies_bds_launcher_2_31.questphase`) injected into the base quest, Phantom Liberty's standalone quest and the three New Game+ quests starts the mod after V first leaves the apartment (or after "Playing for Time" in New Game+) [resource] `.xl`; [resource] Nexus description in `meta.ini`. A catalogue NPC and a menu at Lizzie's Bar select a braindance and its cast; quest phases then stage the scene (§2 above). The rest is atmosphere: music events and switches from a fact (`lizzies_bds_ext_music`), a Ferris-wheel cabin whose rig is turned from script, private braindances in V's apartments after five viewings, a streaming service in V's apartment [source] `LizziesBDsMain.reds`.

**Hook points.** `NPCPuppet.OnGameAttached` and `OnRequestComponents` (performers), `@addMethod(NPCPuppet)` event handlers, `@addField`/`@addMethod(PlayerPuppet)` (saved position), `NcartMetroMapController.OnInitialize` (menu host), `DefaultTransition.AreChoiceHubsActive` (holds actions while the menu is open), and four map-pin icon wraps (`WorldMapTooltipController.SetData`, `MinimapPOIMappinController.UpdateIcon`, `BaseWorldMapMappinController.UpdateIcon`, `QuestMappinController.UpdateIcon`) that draw a braindance icon [source].

**Data added.** 116 phases, 116 scenes, 13 workspots, 36 animation sets, 255 entities, 221 appearance files, 123 `.wem` voice and music files and a sound bank, 11 lip-sync maps, 43 sectors in a block, a factory, overrides tags (`lizzies_bds_strapon_dildo`), two environment parameter sets and six Bink videos; TweakXL records for the performer slots, V's cutscene rigs and single characters [resource] archive listing; `.xl`; `r6/tweaks/LizziesBDs/`.

**State and persistence.** Persistent arrays of storage objects (favourites, purchases, replays) with V2 and V3 layouts both declared for migration; the rest in facts [source] `Storage.reds`.

**UI technique.** A full-screen ink menu from its own `.inkwidget` spawned into a HUD controller slot; Bink videos for backgrounds [source] [resource].

**Undocumented engine knowledge.**
- Rewriting a `Character` record's `entityTemplatePath` and appearance flats at run time recasts every later spawn of that record, including scene actors [source] `MenuUIController.reds:3787-3848`.
- Mesh components can be re-pointed per instance in `OnRequestComponents` before the entity streams [source] `NPCPuppet.reds:162-276`.
- An entity can receive named `ActionEvent`s on `@addMethod` handlers of its class [source] `NPCPuppet.reds:57-106`; that its phases send them is [hypothesis].
- `AreChoiceHubsActive` returning true holds V's actions as a dialogue would [source].
- The Codeware callback system can watch for one record's entity attaching (`RegisterCallback(n"Entity/Attached", …).AddTarget(EntityTarget.RecordID(…))`) [source] `LizziesBDsMain.reds:71-73`.

**Novelty.** Runtime casting of authored scenes; a public registration event for other mods' characters.

**Bugs, fragility and conflicts.**
- Record rewrites are global: while a braindance is set up, every other spawn of those six records (there should be none) would take the new cast. Rewritten flats persist until the next rewrite or a game restart, not in the save [source]; the save keeps only facts.
- Reset and update need a procedure in the bar's office before files are removed, or a CET command; map pins may remain after uninstall (the page says so) [resource] description.
- NPC detection compares record ids with `TDBID.Create("…")` for every non-crowd NPC that attaches while the mod's facts are set [source] `NPCPuppet.reds:20-55`.
- Game 2.31 only (Wwise data) [resource] description.
- Adult content: explicit mode is opt-in, forced off when the game's nudity censorship is on [resource] description; [source] `MenuUIController.reds:446-474, 808-811`. Any XF use of its findings keeps to the project's [nudity policy](../../AGENTS.md).

**Performance.** Two record-id comparison chains per attaching NPC while active; the menu is heavy but only while open [source].

**Licence.** None found; the script headers name the author ArmanIII and ask users not to edit the files [source] `LizziesBDsMain.reds:1-10`. Learn only.

**Relevance.** The braindance and "play as others" entries (42, 43) and any scene XF stages with the player's own V or chosen characters (the photo-mode film set, the director assistant).

**Conflicts with XF's mods or the bridge.** `NPCPuppet.OnRequestComponents` is also where any future XF appearance override on spawned characters would sit; two wraps compose, but both edit the same components only if they name the same ones. Its `AreChoiceHubsActive` wrap makes the player state machine report a choice hub while its menu is open, which a bridge reading "is a dialogue up?" from the state machine would misread.

**Adopt / avoid.** Adopt casting by record rewrite (with our own records only), component edits in `OnRequestComponents` for per-instance looks, and a registration event for content packs. Avoid editing shared records, and a menu hosted in an unrelated HUD controller.

## 4. Stock Market and News System

**How it works.** A CET mod. Every 120 s of unpaused play the market steps each stock by its triggers; every 30 s triggers decay; every 5 s the news queue ticks. 33 trigger modules (plus one per tracked vanilla quest) are observers on game functions (kills, vehicle theft and purchase, vendors, vending machines, ripperdocs, grenades, quickhacks, consumables, wanted level) and quest completions; strong triggers queue a news item with a delay, which arrives as a phone message from a synthetic contact and moves prices [source] `init.lua`, `modules/logic/*`.

**Hook points.** 96 per the triage. Overrides that others also touch: `ComputerControllerPS.GetMenuButtonWidgets`, `ComputerInkGameController.ShowMenuByName`, `BrowserController.LoadWebPage`, `BrowserController.SetDefaultPage`, `MessengerUtils.GetSimpleContactDataArray`, `MessangerItemRenderer.OnJournalEntryUpdated`, `PhoneMessagePopupGameController.OnInitialize`/`OnRefresh`; `ObserveAfter MessengerDialogViewController.UpdateData` [source] `modules/logic/newsManager.lua:154-270`, `modules/ui/browser.lua`.

**Data added.** 33 stock JSON files, a quest table (`data/static/quests/quests.json`, vanilla quest title LocKeys → fade and weight), news delays, 19 news localisations, 19 UI localisations; one archive of icons [resource].

**State and persistence.** psiberx's CET `GameSession.Persist`: a session key stored as a fact in the save (`_psxgs_session_key`) links the save to a Lua file of market data under the mod's `data/persistent/` folder [source] `modules/external/GameSession.lua:60-300, 400-460`.

**UI technique.** A computer tab and browser site built with ink from Lua: its address loads the vanilla home page so the browser holds a valid page widget, then, after `OnPageSpawned`, the page's children are removed and the mod's own widgets (`inkHelper.lua`, a price graph) are built in their place [source] `modules/ui/browser.lua:69-102`; phone messages without journal entries: a synthetic `ContactData` (hash 999999999999999999, `MessengerContactType.SingleThread`) appended to the contact list, `JournalPhoneMessage.new({id = …})` objects created in Lua purely to feed the list controller, the renderer overridden to draw each item's text, and a HUD notification pushed with `JournalNotificationQueue.AddNewNotificationData` [source] `newsManager.lua:154-290`.

**Undocumented engine knowledge.** Quest completion is observable at `JournalNotificationQueue.OnJournalUpdate` (entry class `gameJournalQuest`, state `Succeeded`); NCPD scanner jobs at `OnNCPDJobDoneEvent` (XP awarded) [source] `questManager.lua:24-48`. CET can instantiate `importonly` journal classes that redscript cannot `new`.

**Novelty.** The only installed mod reacting to vanilla quest completions generically, and the only generated news.

**Bugs, fragility and conflicts.**
- "Reload all mods" in CET loses the session's data; the mod shows an error popup saying so [source] `init.lua:67-80`.
- Overrides of browser, computer and messenger functions shared with Virtual Atelier, Virtual Car Dealer, Browser Extension and NightlyNow Core ([triage](README.md#cet-override-overlaps)); each override passes everything but its own address or contact to the original, so they chain, but the contact list order and the renderer's text depend on load order [source] `modules/ui/browser.lua:24-102`.
- Market time runs on CET's `onUpdate` wall clock, paused in menus, not on game time; a time skip is detected separately [source] `init.lua:96-102`.

**Performance.** `onUpdate` every frame (a Cron update and trigger polling); observers on hot functions such as `NPCPuppet.OnPotentialDeath` [source].

**Licence.** keanuWheeze's terms in `init.lua`: no re-upload, credit or permission for any reused code, no competing fork. Learn only.

**Relevance.** Generated messages and news (entry 36), the journal-free phone route for the Studio's own in-game notices, and quest-completion reactions for a living city.

**Conflicts with XF's mods or the bridge.** None with the bridge's hooks. An XF phone contact built the NightlyNow way would share `MessengerUtils.GetSimpleContactDataArray` with this override.

**Adopt / avoid.** Adopt the quest-completion observer and the per-save session key idea (a fact joining save and file). Avoid CET for anything that must survive a mod reload.

## 5. Virtual Atelier Delivery

Studied for messages, devices, popups and billboards in [terminals §6.1](../../knowledge/terminals-and-arcade.md#61-virtual-atelier-delivery); this section adds the checklist points that page does not cover.

- **Clock.** An order ticker (`OrderTrackingTicker`) is cancelled while the time-skip menu is open, during braindances (`HUDManager.OnBraindanceToggle`) and while V is Johnny (`PlayerSystem.OnLocalPlayerPossesionChanged`), and rescheduled after; orders carry game-time timestamps for purchase, shipment, delivery and receipt [source] `VirtualAtelierDelivery.reds:60-90, 566-595`.
- **Map pins without a journal.** Its drop points are spawned `DropPoint` devices; the vanilla `DropPointSystem.RegisterDropPointMappin` registers their pins, and a wrap records the mappin id for its own points to restyle them [source] `:3454-3468, 3522-3560`.
- **State.** 34 `persistent` fields over nested objects (bundles, cart items, history), all on scriptable systems; drop points persist through Codeware's `persistSpawn` [source].
- **Hooks shared with others.** `TimeskipGameController.OnInitialize`/`OnUninitialize` (replaced by Immersive Timeskip, wrapped by five mods), `PlayerPuppet.OnGameAttached`/`OnDetach` (with the bridge and 28 others), `WorldMapTooltipController.SetData` (with Eviction Notice, Lizzie's and five others), `VendingMachine.OnRequestComponents`, `InteractiveDevice.OnPerformedAction` [source]; conflicts in the [triage](README.md#replaced-by-one-mod-wrapped-or-observed-by-others).
- **Fragility.** A few vanilla destructible-mesh nodes deleted by placement index at four drop-point sites; a same-path vanilla van `.ent` [resource] `.xl`, `VirtualAtelierDeliveryColumbus.archive`. Version checks against Virtual Atelier through `ModuleExists` and a popup on the main menu when Atelier is missing [source] `:373-440`.
- **Licence.** GPL-3.0: learn only.
- **Relevance.** The pattern for any XF system with real-world timing (deliveries, appointments, a ripperdoc recovery): pause the clock in braindances, as Johnny and in the time-skip menu.

## 6. NightlyNow Core

**How it works.** Shared utilities for the author's crime mods: a phone framework (`HoloSystem`, contact handlers), side and centre notifications and a progress bar drawn into the health-bar HUD, persistent tutorials, a transaction helper that remembers items, proximity-driven interaction prompts, heat (wanted level), district, life path and time helpers, Mod Settings [source] `r6/scripts/NightlyNow/`.

**Hook points.** `JournalManager.GetContactDataArray`, `MessengerUtils.GetSimpleContactDataArray` and `GetMessageDataArrayForContact` (inject contacts and threads), `NewHudPhoneGameController.OnInitialize`/`OnUninitialize`/`GotoSmsMessenger`/`RefreshSmsMessager`, `MessengerDialogViewController.UpdateData`/`NavigateReplyOptions` plus added methods (`AddMessage`, `AddReply`, `ShowTypingDots`, `OpenDialog`), `PhoneMessagePopupGameController` focus, close, setup, action and choice, `healthbarWidgetGameController.OnInitialize` (notification widgets), `@addField(UsePhoneRequest) hash` [source] `Holo/HoloHook.reds`, `Notification/Notification.reds:395`.

**Data added.** One localisation archive; no records, no journal [resource].

**State and persistence.** `persistent` arrays for watched tutorials and remembered transactions [source] `Tutorial/Tutorial.reds:16`, `Transaction/Transaction.reds:7-8`.

**UI technique.** Journal-free phone threads in redscript: a client subclasses `ContactHandler` (a unique hash, `CreateContactData`, `OnDialogOpen` filling the messenger with `AddMessage`/`AddReply`, `OnReplySelected`, `QueueTypingDelay`/`OnTypingFinished` for typing dots) and registers it with `HoloSystem.AddContact`; `SendPushNotification` raises the HUD toast. Interaction prompts with no world object: push an `InteractionChoiceData` into the `UIInteractions` blackboard's `InteractionChoiceHub` and regenerate `VisualizersInfo`, with a blackboard listener to put it back when the game clears the hub [source] `Utils/Interaction.reds`, `Utils/ProximityDetection.reds`.

**Undocumented engine knowledge.** The messenger's full data path for a contact that has no journal entry; the HUD interaction hub as a writable surface [source].

**Novelty.** The redscript counterpart of Stock Market's Lua contact, built as a reusable framework. Its header credits the original concept to r457 and gh057 (Browser Extension's authors) with fixes by DigitalVixen [source] `Holo/HoloHook.reds:1-8`.

**Bugs, fragility and conflicts.**
- Contacts are held as `wref`s in `HoloSystem`: a client that does not keep its own strong reference loses its contact silently [source] `HoloHook.reds:123`.
- `ResolvePlayerFromHud` reaches the player through the HUD layer's controller on every contact-list call, which returns nothing before the HUD exists [source] `:262-267`.
- Writing the interaction hub directly fights the game's own writers; the hub listener re-adds the prompt, so it can flicker against real interactions [source].
- Overlaps Stock Market's messenger override and the vanilla functions both touch ([triage](README.md#cet-override-overlaps)).

**Performance.** Proximity checks on a delay-callback interval chosen by each client; list injection on every phone open [source].

**Licence.** None found; learn only.

**Relevance.** The best installed model for an XF phone presence (session notices, a Studio contact that answers with results), and for prompts at places that have no device.

**Conflicts with XF's mods or the bridge.** The bridge's planned interaction list reads the same `UIInteractions` blackboard ([player control](../../knowledge/player-control.md)); NightlyNow clients' prompts appear there with no interaction behind them, so "use" must check the choice's action before sending input.

## Conflicts with XF's bridge, collected

| Function or resource | Bridge | B1 mods | Effect |
|---|---|---|---|
| `PlayerPuppet.OnGameAttached` | wrap | Virtual Atelier Delivery wrap (and 28 others) | Independent |
| `UIInteractions.InteractionChoiceHub` (blackboard) | planned read for the interaction list | NightlyNow Core clients write synthetic choices | Filter choices by known actions before using one |
| Player state machine "choice hub active" | planned dialogue detection | Lizzie's Braindances forces true while its menu is open | Read the blackboard, not `AreChoiceHubsActive` |
| V's apartment doors' persistent state | planned door and device commands | Eviction Notice locks and seals them from script | Check its rent facts first in tests |
| Facts | bridge `fact.set` (planned) | All six drive graphs by facts | Namespaced XF facts only; never write another mod's `*_action_*` facts outside a supervised test |
| Save locks | `SaveLocksManager` added methods | Dark Future and Lizzie's phases add gameplay restrictions during scenes | None found; confirm in the next session |

## Recommendations

1. **Quest editor (register entry 23):** model a quest as root phase plus sub-phases, the journal, facts, sector markers and scenes, exactly the parts above; emit WolvenKit-JSON-compatible `.questphase` and `.journal` files and a `quest: phases:` `.xl`. Start with Eviction Notice's loyalty quest as the reference shape.
2. **Bridge commands to add** (research, not product): `fact.get`/`fact.set`/`fact.watch` for XF-namespaced facts; `journal.state` to read an entry's state; a remote persistent-state event for doors and devices by node ref (Eviction Notice's route). Together they let a test session jump to any step of a mod quest.
3. **Live iteration:** keep XF demo quests in short phases started by a fact (the fact channel), so a Red Hot Tools reload plus a fact write retests a change without reloading the save; keep the journal in its own archive so it can hot-reload.
4. **Phone presence:** prototype an XF contact NightlyNow-style (in our own code) for bridge session notices; no journal edits.
5. **Braindance R&D:** one probe that enters braindance mode on a mod scene and adds a clue with `AddBraindanceClue_NodeType`; if it works, generated investigation gigs are data.
6. **Finish Lizzie's Braindances' graphs** when memory allows: extract its launcher and `bdeditor_overlay` phases to confirm how events reach performers and whether any braindance-mode node is used.
7. **In-game checks to batch** into the next session: whether Eviction Notice's midnight listener repeats (`repeat = 0`); whether Dark Future's skipped listeners fire twice after a death-and-reload (Dark Future is disabled, so only on request).

## Related pages

[Survey triage](README.md) · [Quests and story content](../../knowledge/quests-and-story.md) · [Terminals and arcade](../../knowledge/terminals-and-arcade.md) · [World and streaming](../../knowledge/world-and-streaming.md) · [Save files](../../knowledge/save-files.md) · [Player control](../../knowledge/player-control.md) · [In-game possibilities](../backlog/in-game-possibilities.md)
