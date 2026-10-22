# Events the game emits: hook points for a world event feed

**Maturity: Draft.** Where a script can learn that something happened in Cyberpunk 2077: deaths and knockdowns, crimes and police heat, district and interior entry, vehicle use and purchases, quest and journal updates, dialogue choices, time skips, save and load. For each, the class, the method or callback, how a mod attaches, what the hook carries, how often it fires, which pitfalls are known, and whether the XF runtime bridge already uses it. Consolidated on 22 October 2026 from the game's 2.31 scripts (`final.redscripts`, SHA-256 `2119046f…ee86`, decompiled with redscript-cli 0.5.31; the same bundle as [channels to the player](player-channels.md) and the [main story](main-story-state.md) page), Codeware's callback-system source and wiki (commit `a652bbb`), and the scripts of the studied mods listed in [Sources](#sources). **Nothing here is new runtime evidence.** The [runtime] grades come from the bridge's earlier sessions, cited where used.

Grades follow the [knowledge rules](README.md) plus one this page defines:

- **[source]** read in the game's decompiled 2.31 scripts (file and line given, paths relative to the decompiled bundle, for example `cyberpunk/player/player.script:3976`).
- **[community]** a mod's published scripts or a framework's documentation does it. It shows the route works for that author; we have not run it.
- **[runtime]** the bridge already does it in game; the session is cited.
- **[hypothesis]** not established.

Every row says what the script shows, not what the engine does behind a native call. A native method (declared `native` in the bundle) cannot be read, so a hook placed on one is a [hypothesis] until a probe compiles and fires.

This page answers requirement S1 of the [runtime requirements](../research/story-engine/runtime-requirements.md) for the bridge chat (area F of [P2](../research/story-engine/p2-game-substrate.md#f-events-the-game-emits)): *which script-visible hooks could feed a world event stream, and which should go in first?*

## 1. The short answers

| Family | Best hook for a feed | Carries | Rate | Grade | Bridge today |
|---|---|---|---|---|---|
| Deaths and knockdowns | `@wrapMethod(ScriptedPuppet) OnDeath` and `OnDefeated`; `ApplyStatusEffectEvent` of type `Knockdown` for knockdowns | The victim (the wrapped object) and `instigator` | Per death; bursts in a fight | [source], [community] | No |
| Combat start and end | `PlayerPuppet.OnCombatStateChanged(newState)` | `gamePSMCombat` 0 to 3 | Per change | [source] | Polled by `player.state` only |
| Crimes and heat | Facts `wanted_level` and `wanted_chase_active`; `PreventionSystem.ChangeHeatStage` for the reason | Stage 0 to 5, star state, a reason string | Per change | [source], [community] | No |
| District entry | `UI_Map` blackboard string `currentLocationEnumName` | Enum name of the innermost district (134 values, 105 of them sub-areas such as `Kabuki_NoTellMotel`) | Per border | [source] | No |
| Interior entry | Polled `IsEntityInInteriorArea(player)`; sub-area districts may cover many interiors | A bool | Poll | [source] / [hypothesis] | No |
| Vehicle use | `PlayerPuppet.OnMountingEvent` and `OnUnmountingEvent` | Vehicle id, seat slot | Per mount | [source], [community] | `player.state` reads `in_vehicle` |
| Vehicle theft | `VehicleObject.StealVehicle(thief)` | The thief | Rare | [source] | No |
| Vehicle purchase | `VehiclePurchaseData.PurchasedVehicleRecordID` blackboard; the shop's ownership fact | Vehicle record id | Rare | [source] | No |
| Quest and journal | `JournalManager.RegisterScriptCallback` (State, Tracked, Counter) and `QuestsSystem.RegisterListener` for named facts | Entry hash, class name, change type; fact value | Per update | [source] | `world.state` reads up to 16 facts |
| Dialogue choices | `UIInteractions.DialogChoiceHubs` and `SelectedIndex` blackboards | The offered choices' text; the highlighted index | Per hub | [source] | `ui.state` reads the hubs once |
| Calls | `UI_ComDevice.PhoneCallInformation` blackboard | Contact, phase (incoming, started, ended) | Per call | [source] | No |
| Time skips | Poll `TimeSystem.GetGameTime()`; wrap `GameTimeUtils.FastForwardPlayerState` for the menu's skip | Clock; hours skipped | Poll | [source] | `world.state` reads the clock |
| Save and load | Codeware `Session/BeforeSave`, `Session/AfterSave`, `Session/Start`, `Session/Ready`; `PlayerPuppet.OnGameAttached` and `OnTakeControl` | Restored and pre-game flags | Rare | [community], [runtime] for `OnGameAttached` | Yes, session lifecycle |

The one thing to read before building anything is [section 2](#2-how-a-mod-attaches): the bridge has no hook yet that carries a game event into its event ring, and the ring has to survive a firefight.

## 2. How a mod attaches

| Mechanism | What it is | Grade | Notes |
|---|---|---|---|
| `@wrapMethod(Class)` on a script-implemented method | Run our code around the game's. Call `wrappedMethod(...)` first, then read | [runtime] (`PlayerPuppet.OnGameAttached`, [runtime access](runtime-access.md#1-load-order-and-entry-points); the bridge's photo-mode and creator wraps) | The cheapest hook for any `cb func`. Many mods may wrap one method; each calls the next |
| `@wrapMethod` on a **private** script method | Same, on `private final func` | [community] RPGProgressionSystem wraps `PreventionSystem.StartSearchingTimerRequest` and `StartBlinkingTimerRequest`; `DamageSystem.ProcessVehicleHit` | Works for script-implemented methods of native classes too |
| `@wrapMethod` on a **native** method | Wrapping a method declared `native` (`gameAutoSaveSystem.RequestCheckpoint`) | [hypothesis] | Avoid; wrap the script-side caller instead |
| `@addMethod` / `@addField` | Add a helper to a game class | [runtime] (`PlayerPuppet.XFBridgeDescribe`, `SaveLocksManager.XFBridgeOtherLocks`) | Needed to read private fields |
| Blackboard listener | `IBlackboard.RegisterListenerInt/Bool/String/Name/Uint/Variant(id, object, funcName, opt fireIfValueExist)`, plus `RegisterDelayedListener…` that coalesces within a frame | [source] the game's own UI does it (`orphans.script:17415-17535`); [community] Night City Allies keeps its listeners in a `ScriptableSystem` | The callback is a `cb func` on the object with the value as its argument. The bridge reads blackboards but registers no listener |
| Fact listener | `QuestsSystem.RegisterListener(factName, object, funcName) -> Uint32`; the callback takes the new `Int32` | [source] `core/gameplay/prereqs/factValuePrereq.script:39`, `player.script:6047` | One listener per fact name; there is **no** "any fact changed" hook |
| Journal listener | `JournalManager.RegisterScriptCallback(object, funcName, gameJournalListenerType)`; the callback takes `(hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType)` | [source] `core/systems/journalManager.script:90`, `cyberpunk/UI/quests/quest_tracker.script:51-65` | Types: State, Visited, Tracked, Untracked, Counter, StateDelay, ObjectiveOptional, ChoiceEntry |
| `ScriptableSystem` | A class the game instantiates once per session: `OnAttach`, `OnDetach`, `OnRestored(saveVersion, gameVersion)`, `OnPlayerAttach(PlayerAttachRequest)` | [runtime] `XFBridgeSystem` | The natural home for listeners; its `OnPlayerAttach` opens the bridge's script gate |
| Codeware callback system | `GameInstance.GetCallbackSystem().RegisterCallback(eventName, object, funcName)`. Events: `Session/BeforeStart`, `Start`, `Ready`, `BeforeEnd`, `End`, `BeforeSave`, `AfterSave`, `Pause`, `Resume` (`GameSessionEvent`: `IsRestored()`, `IsPreGame()`); `Entity/Assemble`, `Initialize`, `Reassemble`, `Attach`, `AfterAttach`, `Detach`, `Uninitialize` (`EntityLifecycleEvent.GetEntity()`); `Resource/Load`, `PostLoad`; `Component/Toggle`; `Input/Key`, `Input/Axis`; `InkWidget/Spawn` | [runtime] for the registration and `Input/Axis` (a mouse move ended a smooth look, [session 10 D2](../experiments/041-session-10/README.md)); `Input/Key` is registered for the ink panel's answer keys, but the write-ups read here do not record an answer given by key; [community] for the rest (Codeware wiki, "Callback system") | `Session/*` and `Entity/*` are the generic, version-stable route. Their field lists are in Codeware's `scripts/Callback/Events/`; the wiki gives none |
| Cyber Engine Tweaks `Observe` / `ObserveAfter` / `Override` | Lua hooks on any scripted or native method | [community] psiberx's `GameSession.lua` | The bridge's CET layer registers none; it would put game logic in the layer the bridge keeps thin |
| Polling | Read state on a timer from a `ScriptableSystem` delay or the plugin's tick | [runtime] (the bridge's reads) | Right for slow, bounded state (clock, zone, wanted fact) |

**Delivering an event to the feed.** The bridge's event ring (`session.events`, [`core/Events.hpp`](../projects/xf-runtime-bridge/native/src/core/Events.hpp)) holds 1,000 events, 300 characters of text and 4 KiB of data each, and tells a late reader how many it missed. A script reaches it today only through `XFBridge_Note(level, text)` (a note from inside the game) [source] [`Natives.reds`](../projects/xf-runtime-bridge/redscript/Natives.reds). Answers and comments to `session.wait` share that ring. A firefight of dozens of deaths could evict an unread answer, so a world feed needs its own ring and cursor ([section 12](#12-recommended-minimal-hook-set-for-a-first-event-feed)).

**The script gate.** The plugin calls into scripts only between `XFBridgeSystem.OnPlayerAttach` and `OnDetach` ([runtime access](runtime-access.md)). After a load, `PlayerPuppet.OnGameAttached` came 9 s after the session attached but `OnPlayerAttach` 83 s later, when the maintainer pressed a key on the press-any-key screen [runtime: session 9]. Hooks that fire on the game's side (a wrap or a listener) do not need the gate to run, but should not call into the plugin or queue a native call before `OnPlayerAttach` has fired; the plugin's `XFBridge_ScriptLayer` is the signal to check ([game crashes §2.3](game-crashes.md#23-calling-scripts-while-a-save-loads)).

**Payload rule.** Hooks hand over `GameObject`s of unknown type. Read an id (`GetEntityID()`) and the record only after a cast to `gamePuppetBase` or `VehicleObject`, and never call display-name or interaction natives on an object of unknown type: that crashed session 7 ([game crashes §2.4](game-crashes.md#24-a-string-operator-with-a-null-operand-session-7)).

## 3. Deaths, knockdowns and combat

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| NPC dies | `ScriptedPuppet.OnDeath(evt: gameDeathEvent)` (`cyberpunk/puppet/scriptedPuppet.script:2134`); `NPCPuppet.OnDeath` calls it first (`cyberpunk/NPC/NPCPuppet.script:3024`) | `@wrapMethod(ScriptedPuppet) protected cb func OnDeath(evt: ref<gameDeathEvent>) -> Bool` | `this` is the victim; `evt.instigator: wref<GameObject>` (`orphans.script:34839`) | Per death | [source]; [community] RPGProgressionSystem wraps exactly this, with `evt.instigator as PlayerPuppet` for "killed by V" |
| NPC is defeated, not killed | `ScriptedPuppet.OnDefeated(evt: DefeatedEvent)` (`scriptedPuppet.script:2130`), queued by `SendDefeatedEvent` when a `Defeated` status effect is first applied (`:1920-1927`) | `@wrapMethod(ScriptedPuppet) protected cb func OnDefeated(evt: ref<DefeatedEvent>) -> Bool` | The victim only. The instigator is `this.GetKiller()` (`:402`) | Per defeat | [source]; [community] same mod |
| NPC about to die | `NPCPuppet.OnPotentialDeath(evt: gamePotentialDeathEvent)` (`NPCPuppet.script:3069`) | Wrap | `evt.instigator`. This is where the game decides kill, defeat or unconscious and applies the status effect | Per lethal hit | [source] |
| V neutralised an NPC | `PlayerPuppet.OnTargetNeutraliziedEvent(evt: TargetNeutraliziedEvent)` (`player.script:5362`), queued on V by `ScriptedPuppet.RewardKiller` (`scriptedPuppet.script:2268`) | Wrap | `evt.type: ENeutralizeType` (None, Killed, Defeated, Unconscious; `orphans.script:10270`), `evt.targetID` | Per V kill | [source] |
| Reward for a kill | `ScriptedPuppet.OnKillRewardEvent(evt: KillRewardEvent)` (`:2359`) | Wrap | `evt.victim`, `evt.killType: gameKillType` (Normal, Defeat) | Per kill | [source] |
| Bounty paid | `BountyManager.CompleteBounty(target: NPCPuppet)` static | Wrap | The NPC; the wrap can compare `target.GetBounty().m_awarded` before and after | Rare | [community] RPGProgressionSystem |
| Knockdown (NPC) | `ApplyStatusEffectEvent` with `evt.staticData.StatusEffectType().Type()` equal to `gamedataStatusEffectType.Knockdown` (`orphans.script:4362`) arrives at `NPCPuppet.OnStatusEffectApplied` (`NPCPuppet.script:1253`) and `ScriptedPuppet.OnStatusEffectApplied` (`scriptedPuppet.script:1898`) | Wrap and filter on type | `evt.instigatorEntityID`, `evt.isNewApplication` | Per knockdown, but the callback runs for every status effect | [source]; [community] RPGProgressionSystem wraps `NPCPuppet.OnStatusEffectApplied` and filters on `isNewApplication` |
| Knockdown (V) | `PlayerStateMachine.LocomotionDetailed` equal to `Knockdown` (29) or `Felled` (31) (`orphans.script:6855`); `PlayerPuppet.OnFelledEvent` (`player.script:4856`) | Register our own listener on `LocomotionDetailed`. The game's `PlayerPuppet` listens to `Locomotion` only (`player.script:1001`) | The state | Per change | [source] |
| V dies | `PlayerPuppet.OnDeath(evt: gameDeathEvent)` (`player.script:5341`); `PlayerStateMachine.DisplayDeathMenu` | Wrap | `evt.instigator` | Rare | [source]; [community] `GameSession.lua` observes `PlayerPuppet.OnDeath` |
| V in or out of combat | `PlayerPuppet.OnCombatStateChanged(newState: Int32)` (`player.script:3976`), a listener on `PlayerStateMachine.Combat` registered at `:1002`; `gamePSMCombat` Default, InCombat, OutOfCombat, Stealth (`orphans.script:6891`) | Wrap, or register our own on the same blackboard | The new state | Per change | [source] |
| Hostile count | `PlayerPuppet.OnNumberOfCombatantsChanged(value: Uint32)` (`:4178`), listener on `UI_Stealth.numberOfCombatants` | Wrap | Count | Per change | [source] |
| Hostiles tracking V | `PlayerPuppet.OnStartedBeingTrackedAsHostile` and `OnStoppedBeingTrackedAsHostile` (`:6230-6236`) | Wrap | The tracking event | Per hostile | [source] |
| Damage dealt | `ScriptedPuppet.OnDamageDealt(evt: gameTargetDamageEvent)` (`:2335`); `GameObject.OnHit(evt: gameHitEvent)` (`core/entity/gameObject.script:984`) | Wrap | Target, damage, attack data | **Every hit** | [source]; do not feed |

**Pitfalls**

- **A defeat and a later death are two events for one NPC.** RPGProgressionSystem's authors found that wrapping only `OnDeath` missed "enemies that go down defeated first" and added `OnDefeated`, then deduplicated so one NPC pays once [community]. A feed should key on the victim's entity id and say `defeated` then `died`.
- **`SendDataTrackingEvent` skips civilians and crowd** (`NPCPuppet.script:2957-2970`): the game's own kill statistics ignore them. `OnDeath` itself does not, so use it and add a `crowd` and `civilian` flag from `IsCrowd()` and `IsCharacterCivilian()`.
- **`OnDeath` fires for every NPC in the streamed world, killed by anything.** `evt.instigator` can be another NPC, a vehicle or null. Whether NPCs far from V die at all, and how many callbacks reach a script when a crowd is shot, is a game question ([questions](#questions-only-the-game-can-answer), rows 10 and 11).
- **`KillRewardEvent` and `TargetNeutraliziedEvent` are V-only**, so they cannot be the world-wide hook.
- **`OnStatusEffectApplied` runs for every status effect on every puppet** (burning, bleeding, buffs). Filter first, before any string work.
- **`UI_Stealth.numberOfCombatants` and the PSM `Combat` int are separate signals.** The first counts hostiles that track V; the second is V's own state. Detection without combat can change one without the other.
- **A "killing blow" flag exists** (`hitFlag.WasKillingBlow`, `scriptedPuppet.script:2350`), but `OnHit` is far too frequent to carry it.

## 4. Crimes and police heat

The prevention system is a `ScriptableSystem` named `PreventionSystem` (`core/systems/preventionSystem.script`). It keeps the wanted level in three places.

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| Heat stage changes | `PreventionSystem.ChangeHeatStage(newHeatStage: EPreventionHeatStage, heatChangeReason: String)` (`:2141`) is the single place the stage is set; it then calls `OnHeatChanged(previousHeat)` (`:2162`) | `@wrapMethod(PreventionSystem) private final func ChangeHeatStage(newHeatStage: EPreventionHeatStage, heatChangeReason: String) -> Void`; read `this.GetHeatStage()` after `wrappedMethod` | Stage `Heat_0`..`Heat_5` (`orphans.script:9733`) and the **reason**: `"PlayerStoleVehicle"`, `"EnterCombat"`, `"CrimeWitness"` and the others the pipeline passes | Per change | [source]; [community] the pattern (a wrap of a private `PreventionSystem` method) is RPGProgressionSystem's |
| Wanted level as a fact | `SetWantedLevelFact(level)` writes the fact `wanted_level` (`:1088`) after every heat change (`TryUpdateWantedLevelFact`, `:1928`); `SetWantedStateFact` writes `wanted_chase_active` as 1 only in the `Active` star state (`:1095`) | `QuestsSystem.RegisterListener(n"wanted_level", this, n"OnWanted")` | Int | Per change | [source]. The cleanest hook: public API, no wrap |
| Star state | `SetStarStateUI(newState: EStarState)` (`:1047`): Default, Active, Searching (grey stars), Blinking (`orphans.script:9775`) | Wrap `protected final func`, or listen to the blackboard | The state | Per change | [source] |
| Wanted bar | `UI_WantedBar` blackboard: `CurrentWantedLevel` (Int), `CurrentChaseState` (Name: Active, Searching, Dropping, Default), `IsDogtown` (`blackboardDefinitions.script:1409`) | `RegisterListenerInt/Name` | The values | Per change | [source] |
| Chasing now | `PreventionSystem.IsChasingPlayer(game)` static (`:3431`); `GetHeatStage()` | Poll | Bool, stage | Poll | [source] |
| A crime scored | `PreventionSystem.CreateNewPreventionDamageRequest(game, target, attackTime, attackType, damageDealt, isTargetKilled)` static (`:2947`), called from `DamageSystem` (`cyberpunk/damage/damageSystem.script:1349`) and `GameObject` (`gameObject.script:1308`) | Wrap | Target, attack type, killed or not. Scoring itself is `CalculateCrimeScoreForNPC` and `…ForVehicle` (`:899-975`): killing a civilian, police or a vehicle adds the district-multiplied score | Per scored hit | [source] |
| Combat started near police | `CombatStartedRequestToPreventionSystem(game, requester)` static (`:3584`) | Wrap | The requesting object | Per combat | [source] |
| Crime witnessed | `CrimeWitnessRequestToPreventionSystem(game, criminalPosition)` static (`:3595`) | Wrap | A position | Per witness | [source] |
| Vehicle stolen (police car) | `PreventionVehicleStolenRequest` handled at `:2730`; **nothing in the scripts creates it**, so it is sent natively | Wrap `OnVehicleStolenRequest` | Position, affiliation | Rare | [source] |
| Quest forces a level | `SetWantedLevel` event handled at `:3259` | Wrap | The level | Rare | [source] |
| Witness reaction | Stims `CrimeWitness`, `CrowdIllegalAction`, `IllegalAction`, `Gunshot`, `DeadBody`, `Explosion`, `Terror`, `Scream` (`orphans.script:4482`) go through `StimBroadcasterComponent.TriggerSingleBroadcast(contextOwner, stimType, radius, …)` (`core/components/stimBroadcasterComponent.script:162`) | Wrap and filter on `stimType` | Sender, type, radius | **Very frequent** (footsteps are stims too) | [source]; [hypothesis] as a feed source |
| Scanner job paid | `NCPDJobDoneEvent` (`orphans.script:38959`) is queued from `RPGManager.GiveReward` (`cyberpunk/managers/rpgManager.script:2122-2170`) | Wrap `RPGManager.GiveReward(gi, rewardID, amount, target, moneyMultiplier)` static, or `JournalNotification.OnNCPDJobDoneEvent` | Reward id, XP | Rare | [source] |

**Pitfalls**

- **Do not count stars from the fact alone while the star state is Searching.** `TryUpdateWantedLevelFact` writes 0 when `m_forceEternalGreyStars` is set and the state is Searching (`:1928-1936`); a quest can hold the level at grey.
- **Heat is clamped by quest limits.** `ChangeHeatStage` clamps to `m_minHeatLevel` and `m_maxHeatLevel` unless the default limits apply (`:2141-2150`), so a crime can score without the stage moving.
- **Dogtown has its own matrix** (`GetPreventionMatrixPresetForCurrentDistrict`, `:3078`) and the wanted bar says so with `IsDogtown`. A feed that names stars should carry `district`.
- **`PreventionSystem` ignores input in scenes.** `CanPreventionReactToInput()` refuses by scene tier (`:1129`), and a security area suppresses damage requests (`:2070`). A crime in an apartment or a story scene can score nothing.
- **Private-method wraps are version-fragile.** `ChangeHeatStage` is `private final`; a game patch that renames it breaks the compile for the whole script bundle (a redscript error blocks every mod, [runtime access §2](runtime-access.md#2-rules-learned-the-hard-way-from-source)). Prefer the fact listener and read the reason from the stage change only if the reason is wanted.

## 5. District and interior entry

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| District stack changes | `DistrictEnteredEvent` (a `ScriptableSystemRequest`: `entered: Bool`, `district: TweakDBID`, `sendNewLocationNotification`; `orphans.script:32609`) is sent natively when V crosses an area trigger; `PreventionSystem.OnDistrictAreaEntered` (`preventionSystem.script:3052`) passes it to `DistrictManager.Update`, which pushes or pops a stack of `District` and calls `Refresh` (`core/systems/prevention/districtManager.script:111-185`) | `@wrapMethod(DistrictManager) public final func Update(evt: ref<DistrictEnteredEvent>) -> Void`, or the blackboard below | `entered`, `district` as a `TweakDBID` | Per border crossing | [source] |
| Current location as a blackboard | `Refresh` writes `UI_Map.currentLocationEnumName` (the `gamedataDistrict` enum name), `currentLocation` (localised) and `newLocationDiscovered` (true on the first visit) after every push and pop (`districtManager.script:173-177`; `blackboardDefinitions.script:1702`) | `RegisterListenerString(UI_Map.currentLocationEnumName, this, n"OnDistrict")` | Name; first-visit flag | Per change | [source]. The cleanest hook: public API |
| Visited districts | `DistrictManager.m_visitedDistricts` is `persistent` (`districtManager.script:105`), so first visits survive saves | `@addMethod` to read | List of ids | Poll | [source] |
| What is current now | `PreventionSystem.GetCurrentDistrict() -> wref<District>` (`:403`); `District.GetDistrictRecord()`, `.IsDogTown()`, `.IsBadlands()`, `.GetCrimeMultiplier()` | Poll | Record | Poll | [source] |
| V's district notification | `PlayerPuppet.OnDistrictChanged(evt: PlayerEnteredNewDistrictEvent)` (`player.script:5830`) | Wrap | **Only the gunshot and explosion ranges**, not the district | Per border | [source]. Useless as a place signal; a timing signal at best |
| Zone type (public, safe, restricted, dangerous) | The quest fact `CityAreaType` drives `PlayerPuppet.OnZoneFactChanged(val)` (`player.script:6119`), which writes `PlayerStateMachine.Zones` (`gamePSMZones` 0 to 4: `orphans.script:6715`); `SecurityZoneData` carries a `SecurityAreaData` (`securityAreaType`, `zoneName`) | `QuestsSystem.RegisterListener(n"CityAreaType", …)` or a listener on `PlayerStateMachine.Zones` | Zone int; area name | Per change | [source] |
| Interior or not | `IsEntityInInteriorArea(entity: wref<Entity>) -> Bool` global native (`orphans.script:32255`), used by the weapon code and the reaction component | Poll, a few times a second | Bool | Poll | [source]. No event exists |

**What the district list holds.** `gamedataDistrict` has 134 values (`orphans.script:4717`): 27 districts and subdistricts (`Watson`, `Kabuki`, `LittleChina`, `CorpoPlaza`, `Dogtown`, `Badlands`, and so on) and 105 named sub-areas of the form `Parent_Place`: `Kabuki_NoTellMotel`, `LittleChina_VictorsClinic`, `JapanTown_DarkMatter`, `Arroyo_ClairesGarage`, `CorpoPlaza_Apartment`, `ArasakaWaterfront_AbandonedWarehouse`. They have a parent (`District_Record.ParentDistrict()`), so the stack is usually `[district, subdistrict, place]`. If the game raises `DistrictEnteredEvent` for the shops, clinics and apartments in that list, the district hook covers **interior entry for those places** with no extra work. Which interiors have an entry, and whether V walking through a door pushes one, is a game question ([questions](#questions-only-the-game-can-answer), rows 6 and 7). The district records' fields are in [population and affiliations](population-and-affiliations.md).

**Pitfalls**

- **The stack pops back to the parent.** Leaving a place fires `entered=false` and `Refresh` then writes the parent's name. A feed built on `currentLocationEnumName` sees "enter Kabuki_NoTellMotel", then "Kabuki"; it should emit `left` itself by remembering the previous value.
- **`Refresh` returns early when the stack is empty** (`districtManager.script:160-165`): leaving the last district leaves the old name on the blackboard. Do not treat a stale name as a position.
- **`newLocationDiscovered` is a bool that is set on every refresh,** true or false. A listener that fires only on change sees it flip. Read it in the same callback as the name.
- **District is not position.** `world.probe` and `player.state` carry the coordinates; the district is the level above. A fast travel or teleport pops and pushes the stack, which is a burst of two to four events.

## 6. Vehicles

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| V mounts or dismounts | `PlayerPuppet.OnMountingEvent(evt: MountingEvent)` (`player.script:1359`) and `OnUnmountingEvent(evt: UnmountingEvent)` (`:1391`); also `VehicleObject.OnMountingEvent` (`core/gameplay/vehicles.script:395`) | Wrap | `evt.request.lowLevelMountingInfo.{parentId, childId, slotId}`; `this.GetMountedVehicle()` (`player.script:1414`) after the wrap | Per mount | [source]; [community] RPGProgressionSystem wraps `VehicleObject` for both and filters `child.IsPlayer()` |
| Mounted state | `PlayerStateMachine.MountedToVehicle` (Bool), `MountedToVehicleInDriverSeat`, `MountedToCombatVehicle`, `InArmoredVehicle`; the PSM `Vehicle` int is `gamePSMVehicle` (Default, Driving, Combat, Passenger, Transition, Turret, DriverCombat, Scene; `orphans.script:6791`) | Listener on the blackboard; the game's own is `PlayerPuppet.OnVehicleStateChange(newState)` (`:4112`, registered at `:1008`) | State | Per change | [source] |
| Seat | The slot id is `seat_front_left` for the driver, as the radio and the miss-shot code test it (`player.script:1381`, `:1408`) | In the mounting wrap | `CName` | Per mount | [source] |
| Driving and passenger tell-apart | `VehicleComponent.IsMountedToVehicle(game, player)` and `GetVehicle(game, id, out vehicle)`, as the bridge's `player.state` uses | Poll | Bool, object | Poll | [runtime] |
| Vehicle theft | `VehicleObject.StealVehicle(thief)` (`vehicles.script:473`) broadcasts `CrowdIllegalAction` and `CrimeWitness` and sets the persistent "stolen" flag; chosen by `ReevaluateStealing` (`:453`): an NCPD-affiliated car, or one tagged `TriggerPrevention`, entered at `seat_front_left` and not already stolen or owned | `@wrapMethod(VehicleObject) private final func StealVehicle(thief: wref<GameObject>) -> Void` | The thief | Rare | [source] |
| Summon state | `VehicleSummonData` blackboard: `SummonState` (Uint: 1 summoning, 2 waiting, 4 arrived in the notification code), `GarageState`, `SummonedVehicleEntityID` (`blackboardDefinitions.script:997`; consumer `cyberpunk/UI/widgets/notifications/vehicle_summon_notification.script:70-90`) | `RegisterListenerUint` | State | Per change | [source] |
| Owned vehicles | `VehicleSystem.GetPlayerUnlockedVehicles(out [PlayerVehicle])`, `IsVehiclePlayerUnlocked(recordID)` (`core/systems/vehicleSystem.script`) | Poll and diff | List | Poll | [source] |
| Vehicle bought | The `VehiclePurchaseData.PurchasedVehicleRecordID` blackboard (Variant, a `TweakDBID`); its only reader is the summon notification widget (`vehicle_summon_notification.script:58, 84`) | `RegisterListenerVariant` | Record id | Rare | [source]; **no script sets it**, so the engine does |
| Vehicle bought, web shop | `VehicleShopPurchaseEvent` (`orphans.script:57057`) is queued by the shop's Purchase button and handled by `gameuiVehicleShopGameController.OnVehicleShopPurchaseEventEvent` (`cyberpunk/devices/UI/internet/vehicleShopGameController.script:284`), which takes the money and sets the offer's **ownership fact** | Wrap the handler, or `RegisterListener` on a known `OwnershipFact` (from `VehicleOffer_Record.OwnershipFact()`) | `evt.m_offerRecord`: price, availability fact, ownership fact | Rare | [source]; [community] RPGProgressionSystem wraps this controller's `UpdateDiscount` and `ResetDiscount` (the latter runs after a purchase) |
| Vehicle destroyed | `VehicleComponent.OnDeath(evt: gameDeathEvent)` (`core/components/scriptComponents/vehicleComponent.script:2419`) | Wrap | The vehicle; instigator | Rare | [source] |
| Vehicle hit a person | `DamageSystem.ProcessVehicleHit(hitEvent)` receives every hit, not only collisions; the real collisions are `gameVehicleHitEvent` | Wrap and cast | The hit | **Every hit** | [community] RPGProgressionSystem (it scaled all hits for a while before gating on the cast) |

**Pitfalls**

- **`UI_ActiveVehicleData.IsPlayerMounted` is written by the vehicle HUD controller** (`cyberpunk/UI/vehicles/vcar_controller.script:238`), not by the game core. With the HUD hidden or a mod that replaces it, the bool does not move. Use the PSM bool or the mount wrap.
- **A passenger seat is a mount too.** Filter on `seat_front_left` (and the player-driver PSM bool) for "V is driving".
- **A "purchase" has several routes.** The web shop sets an ownership fact; story and gift vehicles unlock with quest nodes; the engine writes `PurchasedVehicleRecordID`. Which of them write which signal is a game question ([questions](#questions-only-the-game-can-answer), rows 8 and 9). The ownership facts are data (offer records in TweakDB), not names in the scripts.
- **A stolen NCPD car is also a crime hook** (section 4): `PlayerStoleVehicle` is a heat reason, and `StealVehicle` is how V's mount becomes one.
- **Summoned, delivered and spawned cars are mounts like any other.** A summon arrival does not mount V.

## 7. Quest and journal updates, dialogue, calls

### 7.1 Journal and facts

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| Entry state changed (quest, phase, objective, message, contact, shard, site) | `JournalManager.RegisterScriptCallback(obj, funcName, gameJournalListenerType.State)` (`core/systems/journalManager.script:90`); the game's tracker does it for `State`, `Tracked`, `Counter`, `ObjectiveOptional` (`cyberpunk/UI/quests/quest_tracker.script:51-54`) | A `ScriptableSystem` registers once; the callback is `func On…(hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType)` | The entry's hash and class; `changeType` Direct, Indirect, IndirectDependent | Per update, bursts at a quest step | [source] |
| What the entry is | `JournalManager.GetEntry(hash) -> wref<JournalEntry>`, `GetEntryState(entry)` (Inactive, Active, Succeeded, Failed; `orphans.script:8572`), `GetParentEntry`, `GetQuestType`, `GetEntryTimestamp`, `GetObjectiveCurrentCounter` and `…TotalCounter` | In the callback | State, parent chain, type | In the callback | [source] |
| Tracked quest or objective | `gameJournalListenerType.Tracked` and `Untracked`; `JournalManager.GetTrackedEntry()` | As above | Hash | Per change | [source] |
| Message received or read | `State` on `gameJournalPhoneMessage` entries; `Visited` for read; `OnJournalUpdate` is the phone HUD's own callback (`cyberpunk/UI/hud/phone/newHudPhoneGameController.script:318`) | As above | Hash and class | Per message | [source]; see [player channels §3.1](player-channels.md) |
| A fact changed | `QuestsSystem.RegisterListener(factName, obj, funcName) -> Uint32`; the callback takes `(value: Int32)`; `UnregisterListener(factName, id)` (`orphans.script:17071-17088`). `QuestsSystem.RegisterEntity(factName, entityId)` queues a `FactChangedEvent` (`GetFactName()`) on an entity instead (`player.script:5045`) | Register from a `ScriptableSystem` for a **watch list**: the [main-story fact table](../research/story-engine/main-story-facts.json) is the natural first one | The new value | Per change | [source]; [community] Night City Allies and the subtitle controller register fact listeners |
| Reward given | `RPGManager.GiveReward(gi, rewardID, amount, target, moneyMultiplier)` static (`rpgManager.script:2122`) | Wrap | A TweakDB reward id | Per reward | [source]; [community] RPGProgressionSystem |
| XP and level | `PlayerPuppet.OnExperienceGained(evt: ExperiencePointsEvent)` (`player.script:1871`), `OnLevelUp(evt: LevelUpdateEvent)` (`:1877`) | Wrap | The event | Per grant | [source] |
| Money and items | `PlayerPuppet.OnItemAddedToInventory(evt: ItemAddedEvent)` (`:2091`; `itemID`, `itemData`, `currentQuantity`, `flaggedAsSilent`; `orphans.script:43148`) and `OnItemBeingRemovedFromInventory` (`:3109`) | Wrap | The item | **Frequent** (looting, crafting, quest items) | [source] |

**Pitfalls**

- **There is no "any fact changed" hook.** A listener is registered per fact name, so the feed needs a watch list; reading all facts means polling `world.state`, 16 names at a time.
- **A fact listener can fire at load.** Facts are restored with the save, and a listener registered before the restore may see old values as changes. Register after `OnPlayerAttach` and diff against a first read.
- **The journal's states change in cascades.** One objective completing moves its parent phase and quest (`changeType` Indirect); a feed should key on `changeType == Direct` or on the entry class to avoid three events for one step.
- **`StateDelay`** exists as a separate listener type (`messengerDialogView.script:74`): message state changes that the UI delays so the typing dots show. A feed that wants the player-visible moment uses it for messages.
- **The tracked-entry callback is also how the HUD redraws,** so a callback written to read the journal on every call costs a journal walk. Cache by hash.

### 7.2 Dialogue choices and spoken lines

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| A choice hub appears or changes | `UIInteractions.DialogChoiceHubs` (Variant of `DialogChoiceHubs { choiceHubs: [ListChoiceHubData] }`; `blackboardDefinitions.script:805-809`, `orphans.script:42023`); the UI controllers listen with `RegisterDelayedListenerVariant` (`cyberpunk/UI/interactions/interactionUIBase.script:40`) | `RegisterDelayedListenerVariant(UIInteractions.DialogChoiceHubs, this, n"OnHubs")` | Per hub: `id`, `activityState`, `title`, `isPhoneLockActive`, and each choice's `localizedName`, `type`, `inputActionName`, `captionParts` (`orphans.script:54489-54513`) | Per hub | [source]; the bridge reads it once per `ui.state` ([runtime]) |
| The highlighted choice | `UIInteractions.SelectedIndex` (Int) and `ActiveChoiceHubID` (`:815-817`) | `RegisterListenerInt` | Index | Per scroll | [source] |
| A choice was taken | **No script callback names it.** The scene system takes the pick natively. Infer it: when the hub becomes inactive, the last `SelectedIndex` is the pick | Combine the two above | Index, text | Per choice | [hypothesis] |
| Quest choices in messages | `gameJournalListenerType.ChoiceEntry` (`orphans.script:8588`) for a player reply in a text thread | `RegisterScriptCallback` | Hash | Per reply | [source] |
| A world interaction was tried | `UIInteractions.LastAttemptedChoice` (Variant `InteractionAttemptedChoice { visualizerType, choice, choiceIdx, isSuccess }`; `orphans.script:33653`); the prevention system listens (`preventionSystem.script:1150`) and the interaction widget plays success or fail (`interactionsUI.script:92`) | `RegisterListenerVariant` | Choice, index, success | Per use | [source]. Devices and loot, not conversation |
| An interaction event reached an object | `InteractionChoiceEvent` on the hotspot (`PlayerPuppet.OnInteraction`, `player.script:3540`; devices' `OnInteractionUsed`) | Wrap on the class of interest | `choice.choiceMetaData.tweakDBName`, activator, hotspot | Per use | [source] |
| A line is spoken | `UIGameData.ShowDialogLine` (Variant; an array of `scnDialogLineData { id, text, type, speaker: wref<GameObject>, speakerName, isPersistent, duration }`; `orphans.script:44905`) and `HideDialogLine`; the subtitles controller registers `RegisterDelayedListenerVariant(…ShowDialogLine, this, n"OnShowDialogLine")` (`cyberpunk/UI/subtitles/baseSubtitlesControllers.script:122`) | Same | Speaker, text, duration | **Per line** (a long scene is hundreds) | [source] |
| Scene tier | `PlayerStateMachine.SceneTier` (Int 0 to 5) and `HighLevel` (`gamePSMHighLevel`: SceneTier1..5, Swimming; `orphans.script:6685`); `PlayerPuppet.OnSceneTierChange(newState)` (`player.script:4078`, registered at `:1014`) | Wrap | Tier | Per change | [source]; the bridge reads it in `player.state` ([runtime], session 7 fix) |

**Pitfalls**

- **The text is localised and may be a key.** `ListChoiceData.localizedName` is a string for display; for a stable id use the hub `id` plus the index, and keep the text as a label. Dialogue text is also the vanilla game's writing: a feed that stores it stores spoiler text. See the [live-DM rule on spoilers](../research/story-engine/decisions.md) (D-14) before logging lines for anyone but the maintainer's own tooling.
- **The hub delayed listener coalesces.** `RegisterDelayedListener…` fires once per frame at most, so a hub that appears and is chosen inside a frame is seen only if the immediate form is used.
- **Selecting a choice needs input** ([player control §4](player-control.md#4-interactions-and-dialogue)), but reading what was shown does not.

### 7.3 Phone calls

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| Call state | `UI_ComDevice.PhoneCallInformation` (Variant `PhoneCallInformation { callMode, isAudioCall, contactName: CName, isPlayerCalling, isPlayerTriggered, callPhase: questPhoneCallPhase, isRejectable, showAvatar, visuals }`; `orphans.script:41573`); `PhoneSystem.TriggerCall` writes it for IncomingCall, StartCall and EndCall (`cyberpunk/systems/phoneSystem.script:103-119`) | `RegisterListenerVariant` | Contact, phase | Per call phase | [source] |
| Answered or rejected | `PhoneSystem.OnPickupPhone(request: PickupPhoneRequest)` (`phoneSystem.script:121`; `request.shouldBeRejected`) and `OnUsePhone` (`:139`) set the fact `phonecall_<from>_with_<to>` (lower case; `GetPhoneCallFactName`, `:376`) to `questPhoneTalkingState`: Ended 0, Initializing 1, Talking 2, Rejected 3 | A fact listener on the call's name, or wrap `PhoneSystem.SetPhoneFact` (`:204`, private) | State | Per call | [source] |
| Message window | `UI_ComDevice.ContactsActive`, `SmsMessengerActive`, `isDisplayingMessage` | `RegisterListenerBool` | Bool | Per open | [source]; [community] Night City Allies listens to `ContactsActive` |

## 8. Time skips

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| The menu's skip | `TimeskipGameController.Apply()` calls `TimeSystem.SetGameTimeByHMS(hours, minutes, seconds, n"ui_menu_timeskip")` then `GameTimeUtils.FastForwardPlayerState(player)` (`cyberpunk/UI/fullscreen/time_management/timeSkipPopup.script:268-276`) | `@wrapMethod(GameTimeUtils) public final static func FastForwardPlayerState(player: ref<GameObject>) -> Void`; the clock before and after is read by a poll | Nothing; hours come from the clock difference | Per skip | [source] |
| The skip popup closed | `TimeSkipPopupCloseData.timeChanged: Bool` to the hub's `OnTimeSkipPopupClosed` (`cyberpunk/UI/fullscreen/hub/hubMenuTimeSkipController.script:77`) | Wrap | Whether time changed | Per use | [source] |
| Any clock jump | `TimeSystem.GetGameTime() -> GameTime`, `GetGameTimeStamp() -> Float`, `GetSimTime()`; `SetGameTimeByHMS(…, reason: CName)` and `SetGameTimeBySeconds` are **native** (`orphans.script:18607-18650`) | A poll: compare the game-time delta with the sim-time delta; a difference of more than a few seconds is a skip | Before and after | Poll | [source] / [hypothesis] |
| A scheduled moment | `TimeSystem.RegisterListener(entity, event, GameTime, repeat)`, `RegisterIntervalListener(entity, event, expectedHour, timeout, repeat)`, `RegisterScriptableSystemIntervalListener(systemName, request, …)` | Register once; the entity receives the event | The event we chose | Per moment | [source] |
| Pause | `TimeSystem.IsPausedState()`, `SetPausedState()`; Codeware `Session/Pause`, `Session/Resume` | Poll or callback | Bool | Per change | [source], [community] |
| Time dilation | `TimeSystem.SetTimeDilation(reason, dilation, …)`, `IsTimeDilationActive`, `GetActiveTimeDilation` | Poll | Float | Poll | [source] |
| Weather | `WeatherSystem.RegisterWeatherListener(callback: WeatherScriptListener) -> Uint32`; a subclass overrides `OnRainIntensityChanged(Float)` and `OnRainIntensityTypeChanged(worldRainIntensity)` (`core/systems/cityLightSystem.script:73-91, 150`) | Subclass and register | Rain only. The named weather state is Codeware's `GetWeatherState` [community] | Per change | [source] |

**Pitfalls**

- **The scripts see only the menu's skip.** Sleeping, quest jumps and fast travel set the clock natively, so only the poll sees them. A poll of the game-time stamp against the sim-time stamp costs one call per tick or less.
- **The menu's skip changes V.** `FastForwardPlayerState` heals to the passive-regeneration threshold, refills stamina and removes every timed status effect (`timeSkip.script:48-70`). A feed that follows the status effect of V should expect a burst of removals at a skip.
- **`SetGameTimeByHMS` takes a `reason`.** The menu uses `ui_menu_timeskip`. A native hook on the call would see the reason; a script cannot.
- **The bridge's own clock writes are skips too.** `world.time.set` moves the clock; a feed on the poll must label those as the bridge's own (the write already logs in the event ring).

## 9. Save and load

| Hook | Class and method | How to attach | Carries | Rate | Grade |
|---|---|---|---|---|---|
| The session starts | Codeware `Session/BeforeStart`, `Session/Start`, `Session/Ready` (`GameSessionEvent`: `IsRestored()`, `IsPreGame()`) | `GameInstance.GetCallbackSystem().RegisterCallback(n"Session/Start", this, n"OnSessionStart")` | Restored (from a save) and pre-game (the main menu) flags | Per session | [community] Codeware wiki and source; `GetCallbackSystem` itself is [runtime] |
| The session ends | `Session/BeforeEnd`, `Session/End` | As above | Same | Per session | [community] |
| A save is about to be written, and was | `Session/BeforeSave`, `Session/AfterSave` | As above | Same | Per save | [community] |
| V's puppet attaches (a load, a new game, a replacer swap) | `PlayerPuppet.OnGameAttached()` (`player.script:1065`), which also sends `PlayerAttachRequest` to every scriptable system (`:1070-1072`) and sets the fact `game_was_loaded` to 1, then back to 0 one second later (`:1148`) | The bridge already wraps it. `this.IsReplacer()` tells a replacer (Johnny, a quest body) from V | The puppet | Per load | [runtime] (session 9: it came 9 s after the session attached) |
| Control returns | `PlayerPuppet.OnTakeControl(ri)` (`:704`); `GameSession.lua` treats it as "load finished" for the main V (entity hash 1) | Wrap | | Per load | [community] |
| The script gate opens | `ScriptableSystem.OnPlayerAttach(request: PlayerAttachRequest)` | Override in our system | The request | Per load | [runtime] (83 s after `OnGameAttached` in session 9, on the press-any-key screen) |
| The system's own state restored | `ScriptableSystem.OnRestored(saveVersion: Int32, gameVersion: Int32)` and `WasRestored()` (`core/systems/scriptableSystem.script`) | Override | Both versions | Per load of a save with this system's data | [source] |
| A save finished | The system requests handler's callback `OnSavingComplete(success: Bool, locks: [gameSaveLock])`: `handler.RegisterToCallback(n"OnSavingComplete", obj, n"OnX")` (`cyberpunk/UI/fullscreen/ingame/inGameMenuGameController.script:46, 528`; `pauseMenu.script:65`) | The bridge registers it for its own save (`XFRuntimeBridgeGame.reds:489`) | Success flag and the save locks that refused | Per save | [runtime] for the registration; whether it fires for autosaves is unknown. `GameSession.lua` observes `gameuiInGameMenuGameController.OnSavingComplete` [community] |
| An autosave requested | `GameObject.RequestAutoSave(isForced)` (private script, `core/entity/gameObject.script:2668`); `FastTravelSystem.RequestAutoSave` (`fastTravelSystem.script:620`); the native `gameAutoSaveSystem.RequestCheckpoint()` (`orphans.script:34078`); callers include legendary loot (`player.script:2326`), disarm components, drop points, the time-skip scenario (`inGameScenarios.script:268`) | Wrap the script-side callers | Forced or not | Per request | [source] |
| Save list and details | `RequestSavesForLoad` then `OnSavesForLoadReady`, `OnSaveMetadataReady(SaveMetadataInfo)` (load menu) | The bridge registers both | Names, details | On request | [runtime] (`game_saves`, sessions 8 to 10) |
| A load requested from the menu | `LoadGameMenuGameController.LoadSaveInGame(saveIndex)` (`loadGameMenu.script`); `LoadListItem.SetMetadata(saveInfo)` fills the list | CET `Observe` [community]; wrap in redscript [hypothesis] | The index | Per load | [community] |
| Fast travel | `FastTravelSystem.OnPerformFastTravelRequest(request)` and `OnLoadingScreenFinished(finished)` | Wrap | Destination point | Per travel | [community] `GameSession.lua`; [source] `fastTravelSystem.script` |
| Save lock reasons | `SaveLocksManager` (`core/systems/saveLocksManager.script`): `RequestSaveLockAdd/Remove(game, reason)`; `GameInstance.IsSavingLocked(game, out locks)` | The bridge adds a read method | Reasons | Poll | [runtime] |

**Pitfalls**

- **The press-any-key stretch.** Between `OnGameAttached` and `OnPlayerAttach` the game waits on a screen that can last minutes. Do not emit `loaded` at `OnGameAttached`; emit `session.ready` at `OnPlayerAttach` and say so ([runtime access §5](runtime-access.md)).
- **`OnGameAttached` is also a replacer swap and a new game.** `IsReplacer()` and `Session/Start`'s `IsRestored()` tell them apart. `IsRestored` is a [community] claim and unproven in game.
- **`game_was_loaded` reads 1 for one second after the attach.** The press-any-key wait outlasts it, so a poll after `OnPlayerAttach` never sees it ([questions](#questions-only-the-game-can-answer), row 3).
- **Save identity.** `GameSession.lua` finds a save's lineage by writing a "session key" fact before each save and reading it back after a load, and by matching the load menu's metadata ([save files](save-files.md)). That is area G's subject; the hooks above are what it would sit on.
- **Calling scripts while a save loads crashed the game** ([game crashes §2.3](game-crashes.md#23-calling-scripts-while-a-save-loads)). Everything above runs on the game's side; do not make the plugin call a script from a save event.

## 10. Hooks that cost: rates and what to do

Rates are [hypothesis] until a probe measures them ([questions](#questions-only-the-game-can-answer), rows 11 and 16).

| Hook | Why it is hot | What to do |
|---|---|---|
| `GameObject.OnHit`, `ScriptedPuppet.OnDamageDealt`, `DamageSystem.ProcessVehicleHit` | One call per bullet, per tick of a DoT, per vehicle hit | Do not hook. Use death and defeat instead |
| `StimBroadcasterComponent.TriggerSingleBroadcast` | Every footstep, reload and bump is a stim | Hook only with a first-line `switch` on the stim type that returns for everything outside a short allow list (`CrimeWitness`, `CrowdIllegalAction`, `Gunshot`, `Explosion`, `DeadBody`, `Terror`, `Scream`), and count instead of log |
| `NPCPuppet.OnStatusEffectApplied` and `ScriptedPuppet.OnStatusEffectApplied` | Every status effect on every NPC | Return at once unless the type is `Knockdown`, `Defeated`, `Unconscious` or `Kill` |
| `PlayerPuppet.OnItemAddedToInventory` | Looting; crafting | Filter to money and quest items, or leave to polling |
| `UIGameData.ShowDialogLine` | One per spoken line | Optional; count lines per scene rather than keep text |
| `PlayerPuppet.OnAction` (`ListenerAction`) | Every input | Not a game event; the bridge's `Input/Key` handler already exists for keys |
| `UIInteractions` hubs | Each look at a door or item changes `InteractionChoiceHub` | Use `DialogChoiceHubs`, not `InteractionChoiceHub`, for dialogue |
| `PlayerStateMachine.Locomotion` | Per step of movement state | Not needed |
| Blackboard `…Delayed…` listeners | Coalesced to a frame, cheaper than immediate ones | Use delayed where a frame's delay is fine |

A blackboard listener costs one script call per change of a value that changes rarely; the cost concern is the `cb func` body, so keep bodies to reading two or three values and one native call.

## 11. What the bridge has and what it should add

| Event family | Bridge today | Gap |
|---|---|---|
| Session lifecycle | `PlayerPuppet.OnGameAttached` wrap and `XFBridgeSystem.OnAttach/OnDetach/OnPlayerAttach`, reported to the plugin through `XFBridge_ScriptLayer` [runtime] | None for the gate. A `session.ready` event for the feed is missing |
| Saves | `OnSavingComplete` for its own `game.save`; `OnSavesForLoadReady`, `OnSaveMetadataReady` for the list [runtime] | `Session/BeforeSave` and `AfterSave`; autosaves; the player's own saves |
| Deaths, combat, crimes, districts, vehicles, journal, dialogue, calls, time | Reads only, on request: `player.state` (`in_combat`, `in_vehicle`, `tier`), `ui.state` (dialogue hubs, menus), `world.state` (clock, up to 16 facts), `scene.read` (people nearby) [runtime] | Every hook in sections 3 to 8 |
| Notes into the ring | `XFBridge_Note(level, text)` [source] | A typed event native with a kind and a JSON body, and its own ring |
| Keys and axes | Codeware `Input/Key` and `Input/Axis` registered; `Input/Axis` seen working [runtime] | None |

The branch with `npc.*` events (`npc.spawned`, `npc.arrived`, `npc.said`, `npc.choice`, `npc.died` and others, [NPC direction](npc-direction.md)) covers NPCs the bridge spawned, not the world. The maintainer's live-DM watchers on another branch (enter, leave, gaze, weapon, combat, vehicle, interact, choice, timer, clock) are named in S1 of the [runtime requirements](../research/story-engine/runtime-requirements.md); this page did not read them.

## 12. Recommended minimal hook set for a first event feed

Twelve kinds, chosen so each is one public registration or one small wrap, none is expected to fire faster than a few times a second in normal play [hypothesis; questions, rows 11 and 16], and together they cover every family in S1. All run on the game's side and push one record through a new native; none calls into the game from the plugin.

| # | Kind | Hook | Attach | Why this one |
|---|---|---|---|---|
| 1 | `session` | `Session/Start`, `Session/Ready`, `Session/BeforeSave`, `Session/AfterSave`, `Session/End`; `OnPlayerAttach` as the gate | Codeware `RegisterCallback` from the bridge's `ScriptableSystem` | Generic and stable; carries `restored` and `pre_game` |
| 2 | `death` | `ScriptedPuppet.OnDeath` and `OnDefeated` | `@wrapMethod` | The only world-wide kill signal; carry victim id, record after the cast, `crowd`, `civilian`, `by_v`, `instigator` id |
| 3 | `combat` | `PlayerPuppet.OnCombatStateChanged` | `@wrapMethod` | V's combat edges in one wrap |
| 4 | `heat` | Facts `wanted_level` and `wanted_chase_active` | `QuestsSystem.RegisterListener` | Public API, no private wrap |
| 5 | `district` | `UI_Map.currentLocationEnumName` and `newLocationDiscovered` | `RegisterListenerString` | Covers districts and, probably, many interiors |
| 6 | `vehicle` | `PlayerPuppet.OnMountingEvent` and `OnUnmountingEvent`; `VehicleObject.StealVehicle` | `@wrapMethod` | Mount, dismount, seat, theft |
| 7 | `vehicle.acquired` | `VehiclePurchaseData.PurchasedVehicleRecordID` | `RegisterListenerVariant` | One listener for the engine's own signal; the web shop's ownership fact comes later |
| 8 | `journal` | `State`, `Tracked` and `Counter` callbacks | `JournalManager.RegisterScriptCallback` | Quests and gigs, texts and calls' phone entries; resolve the entry's path with `GetEntry` |
| 9 | `fact` | A watch list of the [main-story facts](../research/story-engine/main-story-facts.json) | `QuestsSystem.RegisterListener` per fact | Story windows ([main story state](main-story-state.md)); grows by configuration |
| 10 | `dialogue` | `DialogChoiceHubs` (shown and hidden) and `SelectedIndex` | `RegisterDelayedListenerVariant`, `RegisterListenerInt` | What was offered and what was highlighted last; the pick is inferred |
| 11 | `call` | `UI_ComDevice.PhoneCallInformation` | `RegisterListenerVariant` | Incoming, answered (with the `phonecall_*` fact), ended |
| 12 | `time` | A poll of game time against sim time, each second; `GameTimeUtils.FastForwardPlayerState` wrap | `ScriptableSystem` delay | Skips of any cause and the menu's one |

`vehicle.acquired` and `fact` are the two the first build may defer.

**Plumbing the feed needs**

1. **A native `XFBridge_Event(kind: String, json: String) -> Bool`,** beside `XFBridge_Note`, that writes to a **separate ring** with its own cursor (a `world.events {since, kinds, limit}` method), so a firefight cannot evict an answer. Size the ring in kinds: `death` bursts, `dialogue` and `journal` do not.
2. **Every event stamps** game time, sim time and the session counter (from `session` events), so a consumer can order events across a load.
3. **Ids, not names.** Entity id (as a string), TweakDB record id, district enum name. Text only for the dialogue choice labels and journal entry titles, and these stay local.
4. **Register in the `ScriptableSystem`'s `OnPlayerAttach` and unregister in `OnDetach`,** as the Night City Allies and the game's own controllers do for blackboard listeners; a listener left on a dead blackboard after a load is a crash risk.
5. **Add a rate guard in the native:** at most N events of a kind per second, with a `dropped` counter in the next event, instead of back-pressure into the game.

**Left out of the first build:** stim tap (needs the rate test), `OnHit`, item and money events, spoken lines, weather, interior polling (wait for the district test), the world-wide perception feed.

## Questions only the game can answer

For a booked session on the [runtime bridge](../projects/xf-runtime-bridge/README.md). `C` is Claude, `M` is the maintainer. Rows marked **today** need no new build: `world_state {facts: [...]}` reads at most 16 named facts and a name that does not exist reads 0; `ui_state`, `player_state` and `scene_read` read their usual fields. Rows marked **probe** need a bridge build with the section 12 hooks in a log-only mode (each hook writes one line to the session log through `XFBridge_Note`, tagged `ev:<kind>`), read with `session_log`. The maintainer picks saves; `game_saves` lists them. `M` plays; `C` reads the log and never presses keys.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| 1 | C, M | **today.** On a save with no heat, `world_state {facts: ["wanted_level","wanted_chase_active"]}`; `ask "Shoot a civilian in public, then wait until police arrive. Say Done."` [Done]; read again; `ask "Break line of sight and hide until the stars go grey. Say Done."` [Done]; read; `ask "Wait until the stars clear. Say Done."` [Done]; read | 0,0; then level at least 1 and chase 1; then level kept above 0 and chase 0 (grey stars); then 0,0 | Chase stays 1 while grey, or level drops to 0 early: the chase fact does not mean the Active star state. Record each reading with the wanted bar's look |
| 2 | C, M | **today.** `world_state {facts: ["CityAreaType"]}` at a street spot, in V's apartment, in a shop and in a restricted area (`ask` for each, one reading each) | 1 on the street (public), 2 in the apartment (safe), 3 in a restricted area | The fact stays at one value everywhere: it is quest-set, and the zone comes from the security area instead. Record the pairs and what the HUD showed |
| 3 | C | **today.** Right after `game_wait` reports gameplay on a load, `world_state {facts: ["game_was_loaded"]}` | 0 (it reset one second after the attach, long before the press-any-key screen ended) | 1: the fact survives the wait; the game's delay clock was paused while the loading screen showed. Then the fact can mark a load |
| 4 | C, M | **probe.** Load a save from the main menu; then start a new game to the first control point (or load a quest save) and note the replacer, if any; fast travel once | Log lines in order for the load: `Session/BeforeStart`, `Start`, `OnGameAttached`, `Session/Ready`, `OnTakeControl`, `OnPlayerAttach`; `restored` true; `pre_game` false after the menu. A fast travel shows an end and a start, or only a loading screen | The order differs, or `IsRestored` is false on a load: record the sequence. `session.ready` is placed on the line the log shows last |
| 5 | C, M | **probe.** `ask "Quick-save with F5. Say Done."`; then `game_save`; then trigger an autosave (sell an item at a vendor and leave, or pick up a legendary item) | `Session/BeforeSave`, `AfterSave` and the handler's `OnSavingComplete` each fire for the manual save and the quick-save | Only some fire for autosaves: record which of the three each kind produces. If none does for autosaves, the feed notes the autosave by the file list |
| 6 | C, M | **probe.** Walk across a district border (Kabuki into Little China), then back; then a subdistrict border inside Watson | One `district` event per crossing with the enum name of the new innermost area and `newLocationDiscovered` false (true only on a first visit); the name changes to the parent on leaving a place | Two events per crossing, or none: record the sequence and the stack the log shows. The expected-value in section 5 changes |
| 7 | C, M | **probe.** Walk into and out of: a shop, an apartment building lobby, a motel room, a clinic, a bar | A `district` event naming a `Parent_Place` value for the places listed in the enum, and `IsEntityInInteriorArea` flips (poll at 2 Hz) at about the same moment | Some interiors flip the poll but give no district event (or the reverse): record which places do which; interiors then need the poll in the feed |
| 8 | C, M | **probe.** Get into and out of V's car as driver, then as passenger in a taxi or a friend's car; then steal an NCPD car | `vehicle` mount with `seat_front_left` as driver, another slot as passenger; the NCPD car also gives a `StealVehicle` line and the heat reason `PlayerStoleVehicle` | No theft line: the car did not meet `ReevaluateStealing` (not NCPD, or occupied). Record the car and the seat |
| 9 | C, M | **probe.** On a save with enough money, buy a vehicle from the web shop; then accept a story or gift vehicle if one is available | A `vehicle.acquired` line with the record id for the purchase; the offer's ownership fact goes above 0 | No line for the purchase: the blackboard is set only on delivery or by quests. Record which events do give it |
| 10 | C, M | **probe.** In a fight: kill a gang member with a gun; defeat one non-lethally (blunt weapon); knock one down (shotgun or a car); kill a civilian; let an NPC kill another NPC | `death` for the kills with `by_v` true for V's; `defeated` for the blunt takedown, then a later `death` if they die; a knockdown from the status-effect filter; the civilian's `civilian` flag true; the NPC-on-NPC kill with an NPC instigator | A kind is missing, or two events appear for one kill: record the sequence per victim id |
| 11 | C | **probe.** Stand still in a crowded street for a minute; then in a busy fight; read the count of `death` events and the log's rate | The log's rate stays at a few lines per second; no frame hitch (ask `M`) | A hitch or a dropped-counter above 0: the hook body is too heavy. Record the rates and which kind caused it |
| 12 | C, M | **probe.** Accept a gig, advance an objective, finish it; receive and read a text; track and untrack a quest | `journal` lines with `State`, `Counter`, `Tracked` and the entry hash and class; the parent quest changes with `changeType` Indirect; the tracked line follows the track | The callback fires only for some entries (not messages, not contacts): record which classes arrive |
| 13 | C, M | **probe.** Hold a conversation with at least two choice hubs, then a timed choice; also a phone-text reply. `ask "Say which line you picked."` [free text] after each | `dialogue` shows the hub with its choices; `SelectedIndex` lines show the scroll; the last index before the hub closes equals the pick `M` names | The last index differs from the pick, or the hub closes before the index settles: the inference fails. Record the sequence and note what else changes at the pick |
| 14 | C, M | **probe.** An incoming call: answer it; another: reject it; one V makes from the contact list | `call` lines: incoming, then started with the `phonecall_*` fact 2 for the answer, 3 for the reject; ended with 0 | No `started` line, or the fact does not move: record the fact name the game used (the log lists the value of `phonecall_*` facts the probe was given) |
| 15 | C, M | **probe.** Use the menu's time skip for 6 hours; sleep or wait in V's apartment if available; read the log; fast travel across the city | A `time` line with about 6 h of game time and about 0 s of sim time for the menu skip; the other two as jumps or none | The sleep or the fast travel produces no jump line: they do not move the clock the poll watches. Record the clock before and after each |
| 16 | C | **probe.** Enable the section 10 stim filter on top of the others and run a busy street, then a firefight, for a minute each; compare the frame time `M` reads on the performance overlay with the hooks off | No visible change; the filtered stim counter in the thousands per minute | A drop in frame rate: the stim tap stays out of the first build and the count moves to the native side |
| 17 | C | **probe.** Compile a build that wraps `gameAutoSaveSystem.RequestCheckpoint` (a native method) beside the script-side callers | The build compiles and loads, or the script log names the wrap as unresolved | The game fails to start: the wrap is removed; native methods stay unhooked. (Run last; a bad wrap blocks every mod's scripts) |

## Open questions

- Whether `DistrictEnteredEvent` is raised for the shops, clinics, apartments and motels in `gamedataDistrict`, and which interiors have no entry (rows 6 and 7).
- Whether `ScriptedPuppet.OnDeath` is reached for NPCs outside V's streaming range, for crowd NPCs killed by others, and how many reach a script when a crowd is shot (rows 10 and 11).
- Which of `Session/BeforeSave`, `Session/AfterSave` and the handler's `OnSavingComplete` fire for autosaves, quick-saves and the player's manual saves (row 5), and whether `IsRestored` tells a load from a new game.
- What writes `VehiclePurchaseData.PurchasedVehicleRecordID`, and whether story and gift vehicles raise it (row 9).
- Whether a dialogue pick can be read as the last `SelectedIndex` of a hub that closes (row 13), or whether a scene-system callback (`scn*` events) exposes it through Codeware.
- Whether `@wrapMethod` resolves on native methods of native classes (row 17).
- The cost of the stim tap, and whether `RegisterDelayedListener…` loses a hub that opens and closes inside one frame (rows 11, 13 and 16).
- Whether the clock jumps of sleeping, quest skips and fast travel can be told apart from the menu's (row 15), and whether a native `SetGameTimeByHMS` reason can be read from a script at all.
- Whether the `inkISystemRequestsHandler` callback list is shared, so a callback registered once sees every save or only those the caller started.
- How the version-fragile private wraps (`ChangeHeatStage`, `StealVehicle`) behave across game patches: the bridge's compile lint should name each private wrap so a patch's failure points at it.

## Sources

- **The decompiled 2.31 scripts** (`final.redscripts`, SHA-256 `2119046f…ee86`), read from a copy of the bundle on a fast drive; every [source] claim names the file and line. Method: [quest corpus manifest](../research/story-engine/quest-corpus-e-manifest.json) for the bundle's provenance.
- **Codeware** (psiberx and contributors), `scripts/Callback/` and the wiki's "Callback system", repository commit `a652bbb` (read 22 October 2026). Event names and classes come from the wiki table; `GameSessionEvent.IsRestored/IsPreGame` and `EntityLifecycleEvent.GetEntity` from the source files.
- **GameSession.lua** (Copyright 2021 psiberx, version 1.4.5 as vendored in the studied XUtils 1.0.2 and BetterFuelSystemReloaded 1.6.0). Technique only: which methods it observes for session start, end, save and load, death and pause. No code is used.
- **RPGProgressionSystem 1.0.3** (Nexus 35201): its hook file and batch file show wraps of `ScriptedPuppet.OnDeath`/`OnDefeated`, `NPCPuppet.OnStatusEffectApplied`, `BountyManager.CompleteBounty`, `PreventionSystem` timers, `VehicleObject` mount and unmount, `gameuiVehicleShopGameController` and `RPGManager.GiveReward`, and records the pitfalls (the defeat-then-death split, the per-hit `ProcessVehicleHit`, hooks that fire during load before their system attaches). Studied only.
- **Night City Allies 1.6.10** (Nexus 27625): blackboard listeners kept in a `ScriptableSystem` and registered and unregistered with the player. Studied only.
- **The bridge's own scripts** under [`projects/xf-runtime-bridge/redscript`](../projects/xf-runtime-bridge/redscript/) and the [hook inventory](../research/runtime/bridge-hook-inventory.md), for what is already hooked.

Related: [runtime access](runtime-access.md) · [player control](player-control.md) · [main story state](main-story-state.md) · [quests and story](quests-and-story.md) · [open-world activities](open-world-activities.md) · [channels to the player](player-channels.md) · [NPC reactions](npc-reactions.md) · [world and streaming](world-and-streaming.md) · [save files](save-files.md) · [game crashes](game-crashes.md) · [runtime requirements S1](../research/story-engine/runtime-requirements.md).
