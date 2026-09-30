# NPC direction from the runtime bridge (bridge 0.8 design)

**Status: offline research and design, 30 September 2026. Nothing is built and nothing has run in game.** The ask: drive a simple NPC scenario from the runtime bridge: choose or spawn an NPC, have them walk somewhere, say something, do something, and offer V dialogue choices whose answer comes back to the session. This page holds the findings with their evidence, the proposed 0.8 command set, a first scenario, the risks, a planned session-9 card and an effort estimate. The distilled facts are on the [NPC direction knowledge page](../../knowledge/npc-direction.md); crowd reactions, voicesets and overhead barks are on [NPC reactions](../../knowledge/npc-reactions.md).

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** decompiled game scripts, framework or mod source; **[resource]** game or mod resources and data; **[wiki]** Modding Docs; **[runtime]** seen in game; **[hypothesis]** not yet established. Game-script citations are paths inside the decompiled bundle; installed-mod citations are paths inside the mod's folder in the mod manager (`mods/<mod name>/`).

## Contents

1. [Sources and provenance](#1-sources-and-provenance)
2. [Feasibility at a glance](#2-feasibility-at-a-glance)
3. [Findings](#3-findings)
4. [Proposed 0.8 command set](#4-proposed-08-command-set)
5. [How it fits the bridge](#5-how-it-fits-the-bridge)
6. [The first scenario](#6-the-first-scenario)
7. [Risks](#7-risks)
8. [Session-9 test card (planned only)](#8-session-9-test-card-planned-only)
9. [Effort estimate](#9-effort-estimate)
10. [Decisions for the maintainer](#10-decisions-for-the-maintainer)
11. [Open questions](#11-open-questions)

## 1. Sources and provenance

| Source | Version or commit | What it established |
|---|---|---|
| Game scripts, decompiled with redscript-cli 0.5.31 (`decompile -f`) from a copy of the installed `r6/cache/final.redscripts` into a private scratch folder | 2.31, SHA-256 `2119046f3f3466206d8a16a4803b0ef0f3c90926ab689f9abbd5b8e42e28ee86` (the bundle the other knowledge pages cite) | AI commands and their states, `AIComponent` command API, workspot system, look-at events, facial reaction feature, dialogue hub structs and the dialogue UI's blackboard listeners, input listeners, `PlayVoiceOver`, crowd and puppet classification |
| Game TweakDB sources (REDmod `tools/redmod/tweaks`, read in place) | 2.31 | Crowd character records and their base (`isCrowd`, reaction preset, attitude group), reaction presets |
| [Codeware](https://github.com/psiberx/cp2077-codeware) (MIT) | clone `v1.20.4` (`613a1cb8`); installed 1.20.5 | `DynamicEntitySystem` and `DynamicEntitySpec` (`scripts/World/*.reds`), their save and restore logic (`src/App/World/DynamicEntitySystem.cpp`), `QuestsSystem.ExecuteNode`, the `ListChoiceHubData.hubPriority` field |
| [TweakXL](https://github.com/psiberx/cp2077-tweak-xl) | `v1.11.4` (`f8da6be`) | `$base` record cloning (`src/App/Tweaks/Declarative/Yaml/YamlReader.cpp:8`) |
| [ArchiveXL](https://github.com/psiberx/cp2077-archive-xl) | `v1.27.3` (`5474e34`) | `localization:` kinds `onscreens`, `subtitles`, `lipmaps`, `vomaps` (`src/App/Extensions/Localization/Config.cpp:8-36`) |
| [Appearance Menu Mod](https://github.com/MaximiliumM/appearancemenumod) (no licence file; techniques only) | clone `1.8.4-167-g5427235`; installed 2.12.5 | Its Director (NPC scripts: spawn, move, teleport, voice trigger, facial reaction, look-at, pose), companion and follow commands, workspot playback, its NPC search |
| [Native Interactions Framework](https://github.com/justarandomguyintheinternet/nativeInteractions) (licence asks for credit or permission before code reuse; techniques only) | clone `041f17e`; installed f1.05b | Scenes started through a quest-phase fact channel, scene patching at load (choice node ids, choice text, node refs), scene end events on the player |
| keanuWheeze's InteractionUI Lua module, as shipped inside Immersive V Dialogue Expanded (Nexus 24377, installed 1.1.0.0) | `mods/Immersive V Dialogue Expanded/bin/x64/plugins/cyber_engine_tweaks/mods/ImmersiveVDialogueExpanded/modules/interactionUI.lua` (413 lines) | A dialogue hub with arbitrary text added to the game's own dialogue UI at run time, navigated with the player's choice keys, answered through callbacks. The same module ships in at least five other installed CET mods |
| Dark Future (Nexus 16300) | installed 2.0.3-for-2.31 | Encounter NPCs spawned non-persistent through Codeware (`r6/scripts/Dark Future/Gameplay/DFRandomEncounterSystem.reds:511-534`); reading the last choice from the blackboard (`DFInteractionSystem.reds:405-408, 1088-1101`) |
| Audioware (Nexus 12001) | installed 1.8.0 | Script API for sound on an entity or emitter with a subtitle line type (`r6/scripts/Audioware/Ext.reds:11-36`) |
| Immersive Food Vendors (Nexus 7322) | installed 1.2.2.0 | A dialogue mod registering its scene text through ArchiveXL `localization: subtitles:` (`archive/pc/mod/ImmersiveFoodVendorsLoc.archive.xl`) |
| Modding Docs | `a54b0873` | `modding-guides/quest/scene-node-definitions.md` (choice nodes, options and their screenplay text; the choice section added in commit `a3c8c0eb` by nolvalir; its example image `.gitbook/assets/choice_nodes_options_icon_tags_example.png` shows a scene choice drawn by the ordinary dialogue widget with a hub title and an icon); `modding-guides/quest/custom-video-holocalls.md` (commit `2740b0c8`; its `holocall-phase-3-answer-wait.png` shows the answer arriving as a fact compared in a pause and a condition node); `modding-guides/quest/how-to-make-npcs-patrol.md` (World Builder patrol splines) |
| XF Runtime Bridge | 0.7.0 branch `claude/bridge-070` (`754f29e`) | The safety model, write classes, save lock, kill-switch restore, showroom spawning (`redscript/XFRuntimeBridgeShowroom.reds`), NPC reads in `scene.read`, in-game answers and `session.wait` |

No mod code is copied into this design; AMM, NIF and InteractionUI are studied for technique only. Who made each is in the [community credits](../../docs/community-credits.md); unresolved authorship is on the [provenance follow-ups](../provenance-followups.md).

## 2. Feasibility at a glance

| Capability | Route for 0.8 | Confidence | Evidence |
|---|---|---|---|
| Spawn an NPC near V, gone on load and never saved | Codeware `DynamicEntitySystem.CreateEntity` with `persistState = false`, `persistSpawn = false`, a tag, from an XF actor record | **High** | [source] Codeware; AMM and Dark Future ship it; the bridge already spawns showroom heads through Codeware [runtime] |
| Pick an existing NPC near V | `GetNPCsAroundObject` plus a protection filter; read-only identity by the world-object rule | **High** to read; **medium** to direct (crowd NPCs) | [source]; crowd limits [hypothesis] |
| Walk or run to a point, to V, follow V, turn, hold, teleport | `AIMoveToCommand`, `AIFollowTargetCommand`, `AIRotateToCommand`, `AIHoldPositionCommand`, `AITeleportCommand` through `AIHumanComponent.SendCommand`; state by `GetCommandState`, cancel by `CancelCommand`/`StopExecutingCommand` | **High** for spawned non-crowd actors; **medium** for crowd NPCs | [source]; AMM's Director does exactly this |
| Say a line, voiced | `GameObject.PlayVoiceOver(npc, trigger)`: the NPC's own voiceset line for a generic trigger (`greeting`, `bump`, …), with audio and lip sync | **High** that it plays; the words are the voice's own, not ours | [source]; AMM Director |
| Say a line, text only | `scnDialogLineData` on the `UIGameData.ShowDialogLine` blackboard: bottom subtitle (`Regular`), overhead bubble (`OverHead`) or `Holocall` style, hidden by id | **High** | [source]; Audioware ships it |
| Mouth moving for a text-only line | none without audio; a facial reaction and look-at stand in | **Not feasible in 0.8** | [hypothesis] (no audio, no lip-sync clip) |
| Dialogue choices with V, answer back | A runtime hub added to the game's own dialogue widget (`InteractionUIBase.OnDialogsData`), navigated by the player's choice keys, the pick sent as an `npc.choice` event to `session.wait` | **Medium-high** (a shipping CET technique; our redscript port is untested) | [source] InteractionUI module; vanilla listeners |
| Choices inside a real conversation (camera, timers, voiced lines, lip sync) | An authored XF `.scene` template started through a quest-phase fact channel | **High** that it works; **not 0.8** (authoring, save footprint) | [resource] NIF, Dark Future, Eviction Notice; [wiki] |
| Facial expression | `AnimFeature_FacialReaction { category, idle }` on the NPC | **High** | [source]; AMM |
| Look at V or a point | `LookAtAddEvent` / `LookAtRemoveEvent.QueueRemoveLookatEvent` | **High** | [source]; AMM |
| Body gesture or idle (wave, talk, lean) | A workspot: `WorkspotGameSystem.PlayInDeviceSimple` on a small carrier entity, then `SendJumpToAnimEnt` | **Medium**: needs our own carrier entity built with WolvenKit | [source]; AMM ships its own carrier |
| Clean up at release, kill switch, load and save | Tag-delete, command cancel, look-at and workspot stop; save lock; Codeware drops non-persistent entities at world detach and never writes them | **High** | [source] |

## 3. Findings

### 3.1 Spawning and choosing an NPC

**Codeware's dynamic entity system** is the route every studied mod uses for NPCs.

- `DynamicEntitySpec` takes a `recordID` *or* a `templatePath`, an `appearanceName`, `position`, `orientation`, `persistState`, `persistSpawn`, `alwaysSpawned`, `spawnInView`, `active` and `tags`; `DynamicEntitySystem` has `CreateEntity`, `DeleteEntity`, `IsSpawned`, `GetEntity`, `GetTagged`, `DeleteTagged` and tag listeners with `Created`, `Deleted`, `Spawned`, `Despawned` and `Dead` events [source] Codeware `scripts/World/DynamicEntitySpec.reds:1-30`, `DynamicEntitySystem.reds:1-63`, `DynamicEntityEvent.reds:1-13`.
- A record spawn becomes an entity stub registered with the **population system**, so it streams by distance like community NPCs, honouring `spawnInView` and `alwaysSpawned` [source] `src/App/World/DynamicEntitySystem.cpp:247-280`.
- **Persistence is opt-in.** Before a save, only entity states with `persistState` or `persistSpawn` are written; after a load only `persistSpawn` entities are recreated; at world detach every state, tag and listener is cleared [source] `DynamicEntitySystem.cpp:24-49, 51-69, 85-100`. A non-persistent spec also takes a transient entity id rather than a persistable one (`:282-296`), and its persistency record is removed (`:312-325`) [source]. So an actor spawned with both flags off never reaches a save file and is gone after any load.
- Dark Future spawns its random encounters exactly so (`persistState = false`, `persistSpawn = false`, `spawnInView = true`, `appearanceName = n"random"`, its own tag), ground-snapped with `GetNearestNavmeshPointBelowOnlyHumanNavmesh` [source] `DFRandomEncounterSystem.reds:511-547`. AMM's Director does the same per actor, then makes each immortal (`GodModeSystem.AddGodMode(id, Immortal)`) and friendly to V (`GetAttitudeAgent().SetAttitudeTowards(player, AIA_Friendly)`), and on stop teleports each behind V and deletes it [source] AMM `Modules/director.lua:83-117, 1051-1091, 1384-1438`, `Modules/util.lua:906-916`.

**Which record to spawn.** Crowd citizens derive from `Crowd_NPC_Base`: `isCrowd = true`, `baseAttitudeGroup = "civilian"`, `reactionPreset = "ReactionPresets.Civilian_Neutral"`, senses off at start, and the `GenericInteraction.Talk` object action [resource] REDmod `characters/bases/base_records.tweak:42-68`. 122 crowd records derive from it (for example `CorpoMan`, `CorpoWoman`, `NightlifeWoman`, `HomelessMan`), several with Phantom Liberty templates (`ep1\characters\entities\citizen\…`) [resource] `characters/npcs/records/crowds/communities.tweak`. `ScriptedPuppet.IsCrowd()` is true when the record says so *or* the crowd member component reports it is in a crowd [source] `cyberpunk/puppet/scriptedPuppet.script:1425-1427`. A crowd NPC is moved by the crowd system's traffic lanes (`CrowdMemberComponent.TryStopTrafficMovement`, `ChangeMoveType`, `AllowWorkspotsUsage`) [source] `orphans.script:24142-24175`, and AMM notes that a crowd NPC can change AI role only once, so it respawns crowd companions instead [source] AMM `Modules/util.lua:871-893`. **Design choice:** spawn our own TweakXL clones, `Character.xfs_actor_*` with `$base` a crowd record and `isCrowd: false`, so the actor is a full AI puppet that takes commands, never a vanilla record changed in place (AMM rewrites vanilla records' flats to arm its spawns, which then applies to every NPC of that record for the session [source] AMM `Modules/spawn.lua:588-594`). That a non-crowd clone of a crowd record accepts move commands like AMM's named spawns do is [hypothesis] (N4 below).

**Choosing an NPC already near V.** The bridge's `scene.read` already lists NPCs near V through `GameObject.GetNPCsAroundObject` (a targeting-system query) under the world-object rule [source] bridge 0.7 `redscript/XFRuntimeBridgeScene.reds:1-60`, `core/entity/gameObject.script:715-731`. The protection filter for a pick uses only typed checks after a cast to `ScriptedPuppet`: `IsQuest()` (quest mark or quest items) `scriptedPuppet.script:3000-3002`, `IsPlayerCompanion()` `:1693`, `IsBoss()` `:1299`, `IsVendor()` `:1336-1342`, `IsCharacterPolice()` `:1398`, `IsCharacterChildren()` `:1414`, `IsOnAutonomousAI()` (the AI story tier is `Gameplay`, not `Cinematic`) `:1603-1611`, `SceneSystemInterface.IsEntityInScene` and `IsEntityInDialogue` [source] `orphans.script:32250-32252`, and `WorkspotGameSystem.IsActorInWorkspot` [source] `orphans.script:18381+`. Picked NPCs are community spawns that re-roll on load [wiki] ([world and streaming §4](../../knowledge/world-and-streaming.md#4-risks-and-conflicts)); nothing the bridge does to one is saved unless it changes persistent state, which 0.8 avoids.

### 3.2 Directing movement and actions

- **The command objects** [source] `orphans.script`:

  | Class (line) | Fields | Use |
  |---|---|---|
  | `AICommand` (25056) | `id`, `state: AICommandState`, `Copy()`, category | Base |
  | `AIMoveCommand` (28774) | `removeAfterCombat`, `ignoreInCombat`, `alwaysUseStealth` | Base of moves |
  | `AIMoveToCommand` (44519) | `movementTarget: AIPositionSpec`, `facingTarget`, `rotateEntityTowardsFacingTarget`, `movementType` (Walk, Run, Sprint), `ignoreNavigation`, `useStart`, `useStop`, `desiredDistanceFromTarget`, `finishWhenDestinationReached` | Walk to a point or an entity |
  | `AIFollowTargetCommand` (47171) | `target`, `desiredDistance`, `tolerance`, `stopWhenDestinationReached`, `movementType`, `lookAtTarget`, `matchSpeed`, `teleport` | Follow V |
  | `AIRotateToCommand` (47141) | `target: AIPositionSpec`, `angleTolerance`, `angleOffset`, `speed` | Turn to face |
  | `AIHoldPositionCommand` (28790) | `duration` | Stand still |
  | `AITeleportCommand` (47349) | `position`, `rotation`, `doNavTest` | Place with the AI's consent |
  | `AIUseWorkspotCommand` (47369) | `workspotNode: NodeRef`, `jumpToEntry`, `entryId`; base `moveToWorkspot`, `forceEntryAnimName`, `continueInCombat`, `movementType` (47358) | Use a *placed* workspot by node ref |
  | `AIInjectLookatTargetCommand` (47443) | `targetNodeRef`, `targetPuppetRef`, `duration` | Look-at through AI (a combat-related command) |
  | `AIEquipCommand`, `AIUnequipCommand` (47378, 47389) | slot, item, duration | Hold a prop or weapon |
  | `AIJoinCrowdCommand` (47190) | none | Hand an NPC back to the crowd |

  `AIPositionSpec` holds either an entity or a `WorldPosition` (`SetEntity`, `SetWorldPosition`) [source] `orphans.script:29704-29720`. There is **no voice-over command**: speech is an event (§3.3), not an AI command [source] (no `AIPlayVoiceOverCommand` class exists in the bundle).
- **Issuing and tracking** [source] `core/components/aiComponent.script`: `AIComponent.SendCommand(cmd)`, `CancelCommand(cmd)`, `CancelCommandById(id, doNotRepeat)`, `StopExecutingCommand(cmd, success)`, `CancelOrInterruptCommand(className, useInheritance, success)`, `IsCommandExecuting(className, …)`, `IsCommandWaiting(className, …)`, `GetCommandState(cmd)` (lines 14-34); `AICommandState` is NotExecuting, Enqueued, Executing, Cancelled, Interrupted, Success, Failure `orphans.script:276-284`; `AIHumanComponent.GetActiveCommandID(className)` `aiComponent.script:977-983`. The game's own ForceMoveInCombat effector shows the whole life cycle: build an `AIMoveToCommand` subclass with a world or entity target, a facing target, `desiredDistanceFromTarget`, `movementType` and `finishWhenDestinationReached`, `SendCommand` it, and on cleanup stop it if executing or cancel it if still waiting `core/gameplay/effectors/quickhackEffectors.script:883-925`. The prevention system parks units with `AIHoldPositionCommand` `core/systems/preventionSystem.script:3623-3627`.
- **`AICommandEvent { command }`** queued on the entity is the other route, used for vehicles and police (`preventionSystem.script:3690-3700`) [source]; puppets take `SendCommand` directly.
- **AMM's Director** is the working prior art: per node it teleports the actor with `AITeleportCommand` (no nav test), sends an `AIMoveToCommand` (desired distance 2 m, walk or sprint, finish at destination), decides arrival by distance (< 1 m to the node) rather than command state, then applies the node's look-at, voice trigger, facial expression and pose, holds for a set time and moves on; its follow uses `AIFollowTargetCommand` (`matchSpeed`, tolerance 2, look at the target), its turn `AIRotateToCommand` [source] AMM `Modules/director.lua:1151-1377, 1440-1450`, `Modules/util.lua:576-583, 610-732`. That it judges arrival by distance is a hint that command state alone is not dependable for "arrived" [hypothesis]; the design reads both.
- **Behaviour trees** consume commands natively; scripts see only the command objects and `InvokeBehaviorCallback`, `SetBehaviorArgument` [source] `aiComponent.script:3-5, 88-95`. Roles (`AIFollowerRole` for companions, `AINoRole`) change which behaviours run; AMM's companion route sets a follower role, calls `OnAttach` and joins V's attitude group [source] AMM `Modules/spawn.lua:693-736`. 0.8 needs no role change: commands work on an NPC with no role in AMM's Director [source].
- **Paths:** moves use the navmesh unless `ignoreNavigation`; the bridge already snaps points with `FindPointInSphereOnlyHumanNavmesh` and checks `IsNavmeshStreamedInLocation` ([player control](../../knowledge/player-control.md#2-moving-v)); patrols along splines are authored in World Builder [wiki] `how-to-make-npcs-patrol.md`.

### 3.3 Speech

- **Voiced, in the NPC's own voice:** `GameObject.PlayVoiceOver(npc, voName, debugContext, delay, answeringEntityID, canPlayInVehicle)` queues `SoundPlayVo { voContext = voName }` on the NPC [source] `core/entity/gameObject.script:743-770`, `orphans.script:22303-22316`. The voice's voiceset scene picks a random line for that trigger, with audio, subtitle and lip sync ([NPC reactions §3](../../knowledge/npc-reactions.md#3-how-an-npc-picks-and-plays-a-voice-line)). AMM offers 26 such triggers in its Director (greeting, fear, stealth, warnings, damage…) [source] AMM `init.lua:2792-2830`, calling the static through CET as `gameObject::PlayVoiceOver;GameObjectCNameCNameFloatEntityIDBool` [source] `Modules/util.lua:568-570`. What the NPC says is the voice's choice, not ours.
- **Text only:** `scnDialogLineData { id, text, type, speaker, speakerName, isPersistent, duration }` posted to `UIGameData.ShowDialogLine` and hidden by id; types include `Regular` (bottom subtitle, speaker name shown), `OverHead`, `OverHeadAlwaysVisible`, `Holocall`, `Narrator` [source] `orphans.script:7396-7410, 44905-44926`, `cyberpunk/UI/subtitles/baseSubtitlesControllers.script:120-252`; Audioware ships the pattern [source] ([NPC reactions §4](../../knowledge/npc-reactions.md#4-text-only-barks-and-subtitles)). The player's subtitle and chatter settings still apply.
- **Custom audio:** Audioware's `AudioSystemExt.Play(event, entityID, emitter, lineType, settings)` and emitters play a mod's sound from an NPC with a subtitle type [source] Audioware `r6/scripts/Audioware/Ext.reds:11-36`. It needs recorded audio from a consenting voice; out of scope for 0.8.
- **Lip sync:** a vanilla voiceset line brings its own clip. A text-only line moves no mouth [hypothesis]; our lip-sync generator could later animate new lines ([lip sync §6-7](../../knowledge/lipsync.md#6-building-blocks-for-our-own-generator)), but that needs audio and a scene or a clip player on NPCs.
- **Holocall-style lines:** the `Holocall` subtitle type renders a line in the holocall style [source]. A real holocall (ring, caller card, video feed) is phone machinery plus an ordinary scene played over it, started from a quest phase, with the player's answer returned as a fact [wiki] `custom-video-holocalls.md` (Summary; `holocall-phase-3-answer-wait.png`). Later work.

### 3.4 Dialogue choices with V

- **The game's dialogue widget draws whatever is on the blackboard.** `UIInteractions.DialogChoiceHubs` holds `DialogChoiceHubs { choiceHubs: [ListChoiceHubData { id, activityState, flags, isPhoneLockActive, title, choices: [ListChoiceData { localizedName, type, inputActionName, captionParts, timeProvider }], timeProvider }] }`, with `ActiveChoiceHubID` and `SelectedIndex` beside it; `InteractionUIBase` registers delayed listeners `OnDialogsData`, `OnDialogsActivateHub`, `OnDialogsSelectIndex` and `OnInteractionData` [source] `orphans.script:42023-42026, 54489-54517`, `cyberpunk/UI/interactions/interactionUIBase.script:32-89`. Codeware adds the `hubPriority` field [source] Codeware `scripts/Base/Addons/ListChoiceHubData.reds`.
- **Picking a vanilla line needs input**, and the chosen world choice becomes an `InteractionChoiceEvent` natively ([player control §4](../../knowledge/player-control.md#4-interactions-and-dialogue)). For *our* hub that is not a limitation: the player chooses with the keys they always use.
- **keanuWheeze's InteractionUI module** (Lua, CET) is the proven runtime route [source] `interactionUI.lua`:
  - builds `gameinteractionsvisListChoiceData` (text, optional caption icon, choice type) and a `…ListChoiceHubData` (title, choices, `Active`, `hubPriority = -1`, a random id) (lines 117-154);
  - overrides `InteractionUIBase.OnDialogsData` to append its hub to whatever the game sends, and re-sends the current data to show or hide it (lines 161-231);
  - watches the player's `ChoiceScrollUp`, `ChoiceScrollDown` and `ChoiceApply` actions, moves `ActiveChoiceHubID` and `SelectedIndex` itself, consumes the input it handles, and calls the callback for the chosen index (lines 241-370);
  - keeps the game from resetting its index (`OnDialogsSelectIndex`), from flickering with device interactions (`OnInteractionData`) and from switching hubs (`dialogWidgetGameController.OnDialogsActivateHub`), and runs an update each frame (lines 372-413).
  Immersive V Dialogue Expanded uses it for three-way replies to Johnny (`init.lua:788-827`); Lean Anywhere, Playable Blackjack, Pachinko and the coffee-maker mods ship copies [source]. It works in open world without a scene.
- **In redscript** the same pieces exist: `@wrapMethod(InteractionUIBase) OnDialogsData(value: Variant)`; `GameObject.RegisterInputListener(listener, n"ChoiceApply")` as the tutorial popup does (`gameObject.script:152`, `cyberpunk/UI/popups/tutorialGameController.script:105-108`); the listener's `OnAction(action: ListenerAction, consumer: ListenerActionConsumer)` with `ListenerAction.GetName/GetType` and `ListenerActionConsumer.Consume` [source] `orphans.script:31981-32023`. Whether a registered listener sees `ChoiceScrollUp/Down` while a dialogue hub is shown, and whether consuming there keeps the interaction manager from acting on `ChoiceApply`, is [hypothesis] (N8).
- **Reading a pick of any hub:** `UIInteractions.LastAttemptedChoice` (`InteractionAttemptedChoice { choice.caption, captionParts, … }`), which Dark Future listens to [source] `DFInteractionSystem.reds:405-408, 1088-1101`.
- **Scenes instead.** A `.scene`'s `scnChoiceNode` shows its options in the same widget (title, icon, key) and continues through one output socket per option; option text comes from the scene's `screenplayStore.options[].locstringId`; reminder timers can make the NPC prompt V [wiki] `scene-node-definitions.md` (Choice Nodes; the example image). Mods start their scenes from a quest phase injected by ArchiveXL and pick the scene with a fact (Dark Future's command channel; NIF's `nif_start_signal` and `nif_interaction_id`), and learn that a scene ended from an `ActionEvent` it sends to the player (NIF adds `PlayerPuppet.OnNIFSceneEvent` and observes it) [source] NIF `init.lua:139-146`, `modules/classes/interaction.lua:88-142`, `r6/scripts/nativeInteractions.reds:1-21`, `modules/utils/resourceHelper.lua:47-72`. NIF patches each scene as it loads (Codeware `Resource/PostLoad`): it shifts choice-node ids so several instances don't collide, retargets actor and prop node refs, and swaps option text for another locstring id [source] `resourceHelper.lua:110-146, 199-240, 333-349`. Custom option text reaches a scene through ArchiveXL `localization: subtitles:` [source] ArchiveXL `Localization/Config.cpp:8-36`; [resource] Immersive Food Vendors' `.archive.xl`.
- **What `.scene` authoring adds over a runtime hub:** the conversation state (V held, the NPC and V facing, a dialogue camera, scene tier), timed choices and reminders, lines with vanilla audio and their lip sync, skeletal animations placed on a timeline (`scnPlaySkAnimEvent`), props, and quest nodes inside the scene ([quests and story §2.7](../../knowledge/quests-and-story.md#27-scenes)). What it costs: WolvenKit scene authoring, an ArchiveXL quest phase that starts once in every save it meets, facts that live in saves, and a build per change (hot reload only on the scene's next start [hypothesis]). **0.8 uses the runtime hub; an XF conversation template scene is the phase after.**

### 3.5 Animations, gestures and look-at

- **Facial reactions:** `AnimFeature_FacialReaction { category, idle }` applied as `FacialReaction` through the NPC's `AnimationControllerComponent` [source] `orphans.script:32382-32387`, `reactionComponent.script:2869-2917`; AMM resets the NPC's reaction face first and lists 19 labelled pairs (joy 3/5, smile 3/6, sad 3/3, surprise 3/8, anger 3/1, disgust 3/7, fear 3/11 …) [source] AMM `init.lua:2832-2857`, `Modules/director.lua:1452-1468`.
- **Look-at:** `LookAtAddEvent.SetEntityTarget(target, n"pla_default_tgt", offset)` (or a point), style, limits and optional head and chest parts, queued on the NPC; removed with `LookAtRemoveEvent.QueueRemoveLookatEvent(npc, event)` [source] `reactionComponent.script:3539-3600, 3657-3670`, `core/events/lookAtEvents.script:2-10`. The reaction component's own `ActivateReactionLookAt` is private and refuses in combat and during lore animations [source]; AMM builds the event itself [source] `Modules/util.lua:762-804`.
- **Body gestures and idles are workspots.** `WorkspotGameSystem.PlayInDeviceSimple(device, actor, allowCameraMov, actorDataCompName, deviceDataCompName, …)`, `SendJumpToAnimEnt(actor, animName, instant)`, `StopInDevice`, `SendFastExitSignal`, `IsActorInWorkspot` [source] `orphans.script:18381-18420`. AMM spawns its own carrier entity (`base\amm_workspots\entity\workspot_anim.ent`, a workspot component `amm_workspot_base`) at the NPC, plays it and jumps to one of 43,963 catalogued clips by name (per rig: Woman Average, Man Average, Big, …; for example `dirt__stand__2h_on_hip__01__talk__01`) [source] AMM `Modules/anims.lua:328-400`; [resource] AMM `db.sqlite3` table `workspots`. The carrier is AMM's archive, so using it would make the bridge depend on AMM; the self-contained route is our own XF gesture carrier (`.ent` + `.workspot` listing vanilla clips), built with WolvenKit [hypothesis for the exact resource shape]. `AIUseWorkspotCommand` only takes a *placed* workspot's node ref [source].

### 3.6 Safety

- **Story.** Refuse while V is in a scene of tier 3 or higher, in dialogue (`IsEntityInDialogue(player)`), in combat or a vehicle, or busy (the existing player checks, [player control](../../knowledge/player-control.md#what-the-bridge-builds-on-06-and-061-offline)). Never pick a protected NPC (§3.1). Never spawn named characters by default (duplicates of Judy or Panam near a quest confuse the story and the player). Use no facts and no quest phases in 0.8, so nothing enters the quest graph. If a scene starts or combat begins while actors exist, release them at once.
- **Saves.** Non-persistent specs never reach a save [source] Codeware (§3.1); the bridge also holds its save lock from the first spawn ([bridge design §4](runtime-bridge-design.md#4-safety-model)). Attitude changes and god mode on our own actors vanish with them; 0.8 makes no persistent change to a picked NPC.
- **Combat and police.** Actors are friendly to V and immortal (AMM's settings [source]); a reaction preset without crime reactions keeps a stray hit from calling the police [hypothesis: which preset is quietest is N5]. Moves set `ignoreInCombat = false` and `removeAfterCombat = true` so combat takes precedence [source: the fields].
- **Busy NPCs.** A picked NPC in a workspot, a scene, a reaction or a vehicle is refused (`npc_busy`).
- **Kill switch, pause and handover.** Everything an NPC command holds is remembered and given back by one stop step: withdraw the hub, hide lines, cancel commands, stop workspots, remove look-ats, reset faces, delete tagged actors ([§5.3](#53-undo-kill-switch-and-load)).

### 3.7 Prior art

| Mod | What it does | What we take |
|---|---|---|
| Appearance Menu Mod (MaximiliumM and contributors) | Spawns any character record; companions (follower role), friendly or hostile attitude, god mode; the **Director**: scripts of actors with nodes (position, facing, gait, hold time, look-at target, voice trigger, facial expression, pose, appearance switch), triggers by distance, auto-talk when V comes near, stop and clean-up | The command vocabulary and its order of operations; arrival by distance; clean-up by teleport and delete |
| Native Interactions Framework (keanuWheeze) | Usable spots and apartment interactions as patched scenes started by a fact channel | The `.scene` route for phase 2: one generic phase, scenes patched per instance at load, end events on the player |
| InteractionUI module (keanuWheeze), in Immersive V Dialogue Expanded and others | Runtime dialogue hubs with arbitrary text in the game's widget | The 0.8 choice route |
| Dark Future (DarkFortuneTeller) | Non-persistent encounter spawns; last-choice listener; scene command channel | Spawn flags; reading the pick; the phase-2 channel |
| Audioware | Script subtitles and custom audio on entities | Text lines; later, consenting voiced lines |
| Immersive Food Vendors, Immersive Bartenders | Dialogue with vendors and bartenders through scenes (archives only, no scripts) | Evidence that the scene route carries custom text (`localization: subtitles:`) [resource] |
| Immersive Rippers | Not installed; not studied | — |

## 4. Proposed 0.8 command set

A new write class **`write-npc`** (config name `npc`) gates every NPC write; like `showroom` and `player` it is listed only in the test profile's -writes build. Reads stay `read`. Every write answers `undo {method, params}` or `undo: null` with a note, logs `write.done … undo=`, takes the save lock first and is refused while writes are paused or handed over.

| Command | Class | What it does | Undo | Refuses with |
|---|---|---|---|---|
| `npc.list` | read | NPCs within `radius` (default 15 m, max 40): handle, record, class, position, distance, `crowd`, `protected` with reasons, `busy`, `ours` | — | `not_in_world` |
| `npc.pick {handle}` | read | Adopts an unprotected NPC for the session's look, face and say commands; returns a session handle (`n1`) | `npc.release {who}` | `npc_protected {reasons}`, `npc_busy`, `too_far` |
| `npc.spawn {cast, at, face, appearance?}` | write-npc | Spawns an XF actor (`cast` names an XF actor record: `woman_corpo`, `man_nightlife`, …; `at` is a point, or `{ahead_m, side_m}` from V, snapped to walkable ground within 30 m, never inside V's view if asked); immortal, friendly, tagged `xfs_npc`; answers when spawned | `npc.release {who, how: "despawn"}` | `codeware_missing`, `record_missing`, `not_walkable`, `too_far`, `limit` (3 actors) |
| `npc.move {who, to, gait, stop_m, face?}` | write-npc | `AIMoveToCommand` to a point, V (`"v"`) or another actor; `gait` walk/run; events `npc.arrived` or `npc.move_failed {state}` | `npc.stop {who}` (the actor stays where it stopped: `undo_note`) | `not_ours` (picked NPCs don't move in 0.8), `not_walkable`, `too_far` |
| `npc.follow {who, target, distance_m}` | write-npc | `AIFollowTargetCommand` on V or an actor, until stopped | `npc.stop` | as move |
| `npc.turn {who, to}` | write-npc | `AIRotateToCommand` to V, a point or an actor | `npc.stop` | `not_ours` |
| `npc.place {who, at, yaw}` | write-npc | `AITeleportCommand` (for staging, not for drama) | `npc.place` back to the earlier place | `not_ours`, `not_walkable` |
| `npc.stop {who}` | write-npc | Cancels or stops the actor's XF commands, exits a gesture, holds position | — (nothing to undo) | — |
| `npc.say {who, text?, trigger?, style, seconds}` | write-npc | A text line (`style`: `subtitle` with the speaker's name, `overhead`, `holocall`) and/or a voiceset trigger in the NPC's own voice (`greeting`, `bump`, `fear_foll`, …; allow-listed); `npc.said` event when the line's time ends | hide the line by id | `line_too_long` (200 characters), `trigger_unknown` |
| `npc.look {who, at \| off}` | write-npc | Look-at on V, a point or an actor, optional head and chest weights | `npc.look {off}` or the earlier target | `npc_in_combat` |
| `npc.face {who, expression \| off}` | write-npc | A facial reaction by label (joy, smile, sad, surprise, anger, disgust, fear, interested, neutral) | `npc.face {off}` | `expression_unknown` |
| `npc.act {who, gesture \| off}` | write-npc | A body gesture from the XF gesture carrier's list (talk, wave, nod, shrug, lean, arms crossed), per rig; `npc.act_done` event | `npc.act {off}` | `not_ours`, `carrier_missing`, `rig_unsupported` |
| `npc.choices {who, title, choices[2-4], max_s}` | write-npc | Shows a dialogue hub in the game's own widget (title = the speaker's name) while V is within 4 m and no vanilla hub is up; the player chooses with their usual keys; answers at once with a hub id; the pick arrives as an `npc.choice {hub, index, label}` event, or `{timeout: true}` | `npc.choices {withdraw: hub}` | `choices_busy` (a vanilla hub or an interaction prompt is up), `too_far`, `one_hub_at_a_time` |
| `npc.release {who, how}` | write-npc | Ends an actor or a pick: stops everything the bridge holds on it; `how`: `despawn` (default for actors), `walk_away` (walks 15 m away from V, then despawns), `leave` (a pick goes back to its own AI) | — | — |
| `npc.status` | read | The session's actors and picks with their commands, lines, hub, look-at, face, gesture and last events | — | — |

**Events** (into the session stream, returned by `session.wait` with `kinds`): `npc.spawned`, `npc.arrived`, `npc.move_failed`, `npc.said`, `npc.act_done`, `npc.choice`, `npc.released`, `npc.lost` (streamed out or deleted by the game), `npc.died` (Codeware's `Dead` event), `npc.auto_released {reason: combat | scene | load}`.

**Behaviours** (the 0.6 model: one per target, stopped by the kill switch, pause and handover): `npc.move`, `npc.follow` and `npc.choices` run as behaviours with `max_s` (move 60, follow 300, choices 120).

## 5. How it fits the bridge

### 5.1 Layers

- **redscript** `XFRuntimeBridgeNpc.reds` (module `XFRuntimeBridge`, compiled only with Codeware, like the showroom file): the registry (a `ScriptableSystem`, new per game session), spawn and release, commands and their tracking, lines, look-at, faces, gestures, and the hub. A `ScriptableSystem` tick (or the plugin's existing drain) polls command states and distances four times a second and raises events through a native, as the answers do (`XFBridge_Event`).
- **The hub** is a redscript port of InteractionUI's technique (wrap `OnDialogsData`, `OnDialogsSelectIndex`, `OnInteractionData`; an input listener for the three choice actions; blackboard index updates). No CET Lua is needed; if N8 shows a registered listener can't see or consume the choice keys, the fallback is the bridge's CET layer observing `PlayerPuppet.OnAction`, as the module does.
- **TweakXL data** in the -writes package only: `Character.xfs_actor_<cast>` records (`$base` a base-game crowd record, `isCrowd: false`, the chosen reaction preset, `Factions.Unaffiliated`), so no vanilla record is ever changed. The gesture carrier (`xfs\bridge\npc\gesture_carrier.ent` and its `.workspot`) is a small archive in the same test package, built with WolvenKit.
- **Plugin**: the new class `npc`, the method table, `undo` rules in `core/Writes.cpp`, restore on kill, and the self-test host's simulated NPC layer.
- **Tools**: catalogue entries (one definition each, so MCP, CLI and session scripts get them), `session.wait` kinds, and a **scenario runner** (§6) that executes a declarative scenario, so a scenario is data an agent or a script can write, check and replay, not code.

### 5.2 Refusal order for every NPC write

1. Writes allowed, class `npc` listed, not paused, not handed over.
2. V in the world, not in combat, a vehicle, dialogue or a tier-3+ scene, not busy.
3. Codeware present (`codeware_missing` with a plain next step).
4. The target is ours (or a pick, for look, face, say) and still spawned (`npc_lost`).
5. Distances: spawn and move targets within 30 m of V and on walkable, streamed navmesh.
6. Limits: 3 actors, one hub, one move or follow per actor.

### 5.3 Undo, kill switch and load

| Held by the bridge | Given back by `npc.release`, the kill switch, pause-stop and handover |
|---|---|
| Spawned actors | `DynamicEntitySystem.DeleteTagged(n"xfs_npc")` after their commands are cancelled |
| AI commands | `StopExecutingCommand(cmd, false)` if executing, else `CancelCommand(cmd)` (the vanilla effector's order) |
| Text lines | `HideDialogLine` by their ids |
| The hub | Removed from the widget data; the waiting `session.wait` ends with `hub_withdrawn` |
| Look-ats | `LookAtRemoveEvent.QueueRemoveLookatEvent` with the stored event |
| Faces | Facial reaction reset (category 0) |
| Gestures | `StopInDevice`, carrier deleted |
| Picks | Look, face and line only; nothing else to restore |

A load needs nothing: the script gate refuses from the detach, Codeware drops every non-persistent entity at world detach, and the new session's registry starts empty [source]. The save lock stays from the first spawn until a save is loaded, as for every bridge write.

## 6. The first scenario

**"A stranger with a question":** an XF actor walks up to V, says a line, offers two choices, and reacts to the one picked. The runner reads steps in order; `wait` steps block on events with a limit; `on` branches on the choice. Every command's undo is recorded; the runner's end (or any failure) releases every actor it spawned.

```json
{
  "scenario": "xfs_stranger_question",
  "requires": { "classes": ["npc"], "codeware": true, "v": "on_foot_no_combat" },
  "actors": { "stranger": { "cast": "woman_corpo" } },
  "steps": [
    { "do": "npc.spawn", "who": "stranger", "at": { "ahead_m": 12, "side_m": 4 }, "face": "v", "out_of_view": true },
    { "wait": "npc.spawned", "who": "stranger", "max_s": 10 },
    { "do": "npc.move", "who": "stranger", "to": "v", "gait": "walk", "stop_m": 1.6 },
    { "wait": "npc.arrived", "who": "stranger", "max_s": 40 },
    { "do": "npc.turn", "who": "stranger", "to": "v" },
    { "do": "npc.look", "who": "stranger", "at": "v" },
    { "do": "npc.face", "who": "stranger", "expression": "interested" },
    { "do": "npc.say", "who": "stranger", "trigger": "greeting" },
    { "do": "npc.say", "who": "stranger", "style": "subtitle", "seconds": 4,
      "text": "Sorry to bother you. You look like someone who knows the city. Is the market still open?" },
    { "wait": "npc.said", "who": "stranger", "max_s": 6 },
    { "do": "npc.act", "who": "stranger", "gesture": "talk" },
    { "do": "npc.choices", "who": "stranger", "title": "Stranger", "max_s": 60,
      "choices": ["Two blocks down, still open.", "No idea. Ask someone else."] },
    { "wait": "npc.choice", "who": "stranger", "max_s": 60, "as": "answer" },
    { "on": "answer", "cases": {
        "0": [
          { "do": "npc.face", "who": "stranger", "expression": "joy" },
          { "do": "npc.say", "who": "stranger", "style": "subtitle", "seconds": 3, "text": "Thanks, you're a lifesaver." },
          { "do": "npc.act", "who": "stranger", "gesture": "wave" },
          { "wait": "npc.said", "who": "stranger", "max_s": 5 },
          { "do": "npc.release", "who": "stranger", "how": "walk_away" }
        ],
        "1": [
          { "do": "npc.face", "who": "stranger", "expression": "disgust" },
          { "do": "npc.say", "who": "stranger", "style": "subtitle", "seconds": 3, "text": "Wow. Okay. Have a nice night." },
          { "do": "npc.look", "who": "stranger", "off": true },
          { "wait": "npc.said", "who": "stranger", "max_s": 5 },
          { "do": "npc.release", "who": "stranger", "how": "walk_away" }
        ],
        "timeout": [
          { "do": "npc.say", "who": "stranger", "style": "subtitle", "seconds": 3, "text": "Never mind." },
          { "do": "npc.release", "who": "stranger", "how": "walk_away" }
        ]
    } },
    { "wait": "npc.released", "who": "stranger", "max_s": 30 }
  ]
}
```

The `greeting` trigger adds a vanilla line in the actor's own voice before the subtitle (both show; whether they read well together is a session judgement, N10). Without the gesture carrier, `npc.act` is skipped with a warning, and the scenario still runs.

## 7. Risks

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| A non-crowd clone of a crowd record still ignores commands (behaviour tree without command support) | Medium | Walking fails | N4 compares an XF clone with a crowd record and one non-crowd civilian record; fall back to a non-crowd civilian base, chosen offline from the TweakDB sources before the session |
| Arrival never reported (command state stays `Executing` near the target) | Medium | Scenario stalls | Arrival by distance as AMM does, with the command state as a second signal and a timeout |
| The hub's keys also trigger a world interaction, or the game resets our index | Medium | Wrong pick or a door opens | Refuse `choices_busy` when any interaction prompt or vanilla hub is up; wrap `OnDialogsSelectIndex` and `OnInteractionData` as the module does; N8 and N9 |
| Choice text without localisation | Certain | English-only test text | Test-profile feature; a later XF product would use ArchiveXL `localization` |
| The subtitle setting or chatter setting is off | Low | Lines don't show | `npc.status` reports the settings (the options read exists); the test profile turns subtitles on |
| An actor blocks a quest NPC's path or stands in a quest area | Low | Story oddity | Auto-release on a scene tier change, combat or dialogue; 30 m limit; never in quest scenes |
| Police or crowd panic from a stray hit or gunfire | Low | Wanted level | Immortal, friendly, a quiet reaction preset; auto-release on combat |
| Codeware or TweakXL absent or a different version | Low | Refused | Detected; plain refusal; the -writes package declares them |
| Name collisions with other mods' tags or records | Low | Clean-up removes theirs | `xfs_` names only |
| Crowd NPC picks misbehave (role changes once) | Medium | Odd pick behaviour | 0.8 never moves or changes roles on picks |
| Gesture carrier resource shape wrong | Medium | No body gesture | Built and tested offline with WolvenKit; skipped cleanly when missing |
| Save-file contamination | Very low | A spawned actor in a save | Non-persistent flags [source], save lock, session ends by loading its save |

## 8. Session-9 test card (planned only)

**Not scheduled; for the sitting after session 8, once 0.8 is built and passes offline.** Build: 0.8.0 -writes (`--allow-npc`), Codeware and TweakXL, the XF actor records and the gesture carrier in the test package. Place: a quiet street at night in Japantown or Kabuki with 15 m of open pavement, V on foot, a fresh manual save. Friction log throughout. Evidence per row: the bridge log slice, `npc.status` JSON, a capture at the named moment, and the event stream.

| # | Step (the coordinator drives) | Pass when | Records |
|---|---|---|---|
| N1 | `npc.list {radius: 20}` | Nearby NPCs listed with record, `crowd` and `protected`; no crash on any object | JSON; which reasons appear |
| N2 | `npc.pick` on a crowd NPC; `npc.look at v`, `npc.face joy`, `npc.say {trigger: "greeting"}`, `npc.say {text, style: "overhead"}`; `npc.release` | Head turns to V, face changes, a voiced line and a bubble show; release returns the NPC to its walk | Capture at each; whether the crowd NPC stopped walking |
| N3 | `npc.pick` on a vendor or a quest-marked NPC | Refused `npc_protected` with the reason | JSON |
| N4 | `npc.spawn` three casts 10 m ahead: an XF clone (`isCrowd: false`), a crowd record, a non-crowd civilian | All three appear on the ground, out of view if asked; `npc.spawned` events | Capture; spawn time |
| N5 | `npc.move` each to V (walk), then one run | The XF clone walks with its own locomotion and stops about 1.6 m from V; `npc.arrived`; which of the others moved | Video or captures every 2 s; command states over time; the distance at arrival |
| N6 | `npc.follow v` while the player walks 20 m, then `npc.stop` | The actor follows at its distance and stops on command | Capture |
| N7 | `npc.say` with each style: subtitle (speaker name), overhead, holocall | Each shows as expected and hides after its time | Captures; the subtitle setting |
| N8 | `npc.choices` with two options; the player scrolls and picks the second | The game's own widget shows the title and two options; scrolling moves the highlight; the pick returns `npc.choice {index: 1}`; no world interaction fires | Capture; event; whether the choice keys reached the listener |
| N9 | `npc.choices` near a door or vending machine | Refused `choices_busy`, or (if shown) no device action on Apply | JSON; friction note |
| N10 | The §6 scenario, twice (pick each answer once) | Runs end to end; reactions differ; the actor walks away and despawns | Video; event stream; timings; how the vanilla greeting and the subtitle read together |
| N11 | `npc.act talk`, `wave` on the XF actor | The gesture plays and ends; `npc.act_done` | Capture |
| N12 | Mid-scenario kill switch | Hub gone, lines hidden, actors deleted, look-ats off; nothing left | Capture; log |
| N13 | Spawn an actor, then start combat nearby (or draw and fire in the air) | `npc.auto_released {reason: "combat"}`; no police | Log; wanted level |
| N14 | Spawn an actor, then load the session's save | The actor is gone after the load; `npc.status` empty; no refusals afterwards | JSON before and after |
| N15 | Spawn an actor, then make a manual save through `game.save` with `override_lock`, load it | The loaded save has no actor (the non-persistent flags) | Capture after the load |

## 9. Effort estimate

Agent time, offline, including tests in the self-test host and redscript lint against the 2.31 bundle with Codeware; one agent.

| Part | Scope | Estimate |
|---|---|---|
| P0 | Class `npc`, registry, `npc.list`, `npc.pick`, `npc.spawn`, `npc.release`, `npc.status`, XF actor records, kill and load clean-up, events plumbing | 1.5 days |
| P1 | `npc.move`, `follow`, `turn`, `place`, `stop` with command tracking, arrival and failure events, auto-release on combat or scene | 1.5 days |
| P2 | `npc.say` (text styles, voiceset triggers), `npc.look`, `npc.face` | 1 day |
| P3 | `npc.choices`: the hub port, input listener, blackboard handling, `session.wait` kinds, the CET fallback | 2 days |
| P4 | `npc.act`: the XF gesture carrier (WolvenKit `.ent`/`.workspot`, a clip list per rig) and playback | 1.5-2 days |
| Runner | The declarative scenario runner, its schema and validation, the §6 scenario as a fixture | 1 day |
| Docs and card | Test card rows, build record, knowledge updates | 0.5 day |
| **Total** | | **9-9.5 days** (P0-P3 plus the runner: about 7) |

The in-game session is about 60 minutes. A phase-2 XF conversation template scene (a generic scene with N option slots and line slots, driven through an ArchiveXL phase and one fact channel) is a separate estimate of about 4-6 days once 0.8 has shown what the runtime route can't do.

## 10. Decisions for the maintainer

1. **A new write class `npc`**, listed only in the test profile's -writes build, like `showroom` and `player`. Default: yes.
2. **Casting.** Default: XF actor records cloned from base-game civilians; named characters (Judy, Panam, …) and Phantom Liberty-only templates excluded unless asked.
3. **Picked NPCs.** Default: picks get look, face and say only; moving or re-roling someone else's NPC waits for evidence from N2 and N5.
4. **Voiced lines.** Default: vanilla voiceset triggers (the voice's own random line) plus text; no new voiced audio (it needs a consenting voice).
5. **The gesture carrier** is a small archive in the test package, built with WolvenKit. Default: build it in P4.
6. **Phase 2** (an XF conversation template `.scene`) is discussed after session 9.

## 11. Open questions

1. Does a TweakXL clone of a crowd record with `isCrowd: false` take move commands like a named NPC (N4, N5)?
2. Is `AICommandState.Success` reported on arrival, or must arrival be judged by distance (N5)?
3. Does a registered input listener receive `ChoiceScrollUp/Down` and `ChoiceApply` while the dialogue widget shows our hub, and does consuming them stop native handling (N8, N9)?
4. Which reaction preset keeps an actor calm, silent to crime and still able to face and look (`Civilian_Passive`, `Civilian_NoReaction`, `NoReaction`)?
5. Does a spawned actor's own proximity look-at and greeting (vanilla reaction) fight our look and lines, and does `NoReaction` suppress it?
6. Does the `Holocall` subtitle style render without a call in progress?
7. Can a workspot carrier play vanilla gesture clips on every rig we cast, and which clip names are generic enough (talk, wave, nod)?
8. Do a vanilla voiceset line and our subtitle collide on screen, and should `npc.say` choose one or queue them?
</content>
</invoke>
