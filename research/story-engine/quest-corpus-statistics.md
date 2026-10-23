# Quest corpus statistics

Structure statistics of the game's authored quest data (game 2.31, base game and Phantom Liberty), generated from the corpus database by `research/consumers/quest-corpus/scripts/quest_stats.py`. Rerun it after any rebuild; do not edit the numbers by hand. The database and how to rebuild it are described in the [scripts README](../consumers/quest-corpus/scripts/README.md). This is offline data from the game's files: it describes how the quests are built, not how they play.

## 1. What is counted

Resources in the database, by type and the research area that extracted them (A: main story, B: gigs and fixers, C: population and communities, H: everything else):

| Type | Area A | Area B | Area C | Area H | Total |
|---|---:|---:|---:|---:|---:|
| quest | 12 | 110 | 22 | 590 | 734 |
| questphase | 725 | 1,146 | 93 | 1,874 | 3,838 |
| scene | 0 | 0 | 0 | 8,553 | 8,553 |
| journal | 0 | 0 | 0 | 3 | 3 |
| app | 0 | 0 | 6 | 0 | 6 |
| community | 0 | 0 | 2,727 | 0 | 2,727 |
| csv | 0 | 0 | 3 | 0 | 3 |
| ent | 0 | 0 | 47 | 0 | 47 |
| gamedef | 0 | 0 | 1 | 0 | 1 |
| streamingsector | 0 | 0 | 1 | 0 | 1 |
| **all** | 737 | 1,256 | 2,900 | 11,020 | 15,913 |

Only quests, quest phases, scenes and journals have structure tables; the other types (communities, appearance and entity files, CSV tables, a streaming sector) are stored as JSON for later areas.

**Variants.** `live` resources are the shipped ones. `version` resources are older copies the game keeps under `versions/` folders (`gold`, `patchN`), and `test` resources sit in `test/` or `tests/` folders. Statistics below count `live` only, so each quest is counted once and test content does not distort the shape.

| Type | live | version | test |
|---|---:|---:|---:|
| quest | 621 | 0 | 113 |
| questphase | 3,808 | 0 | 30 |
| scene | 4,026 | 4,384 | 143 |
| journal | 3 | 0 | 0 |

**Categories.** `main`: `base/quest/main_quests` and the master graph `cyberpunk2077.quest`. `side`: `side_quests` and `minor_quests`. `gig`: `open_world/street_stories` (the gigs). `phantom_liberty`: everything under `ep1/`. `other`: the rest of the base game (holocalls, minor activities, combat events, city scenes, vendors, bug-fix and framework phases, media). A **quest** below means a `quest_key`: the folder that owns a quest or a gig, with all its phases and scenes.

| Category | Quest folders with a .quest | .quest files | Phases | Scenes |
|---|---:|---:|---:|---:|
| Main | 24 | 27 | 436 | 344 |
| Side | 67 | 67 | 510 | 351 |
| Gig | 85 | 90 | 356 | 358 |
| Other | 281 | 354 | 1,535 | 2,280 |
| Phantom Liberty | 71 | 83 | 971 | 693 |

## 2. Node types

Live quests and phases hold **405,958 nodes** and **449,670 connections** in 20,180 graphs (a phase node can carry an inline graph of its own), using 60 node types. Counts per type, with the share of all nodes and the split by category:

| Node type | Nodes | Share | Main | Side | Gig | Other | Phantom Liberty |
|---|---:|---:|---:|---:|---:|---:|---:|
| `questPauseConditionNodeDefinition` | 90,255 | 22.2% | 9,615 | 10,269 | 6,219 | 28,339 | 35,813 |
| `questSpawnManagerNodeDefinition` | 30,997 | 7.6% | 3,314 | 2,577 | 1,409 | 11,515 | 12,182 |
| `questFactsDBManagerNodeDefinition` | 27,051 | 6.7% | 2,199 | 3,282 | 1,778 | 8,573 | 11,219 |
| `questInputNodeDefinition` | 22,906 | 5.6% | 2,847 | 3,224 | 2,057 | 8,442 | 6,336 |
| `questJournalNodeDefinition` | 20,569 | 5.1% | 2,367 | 4,702 | 2,812 | 4,538 | 6,150 |
| `questPhaseNodeDefinition` | 20,414 | 5.0% | 2,134 | 2,379 | 2,029 | 7,884 | 5,988 |
| `questConditionNodeDefinition` | 19,979 | 4.9% | 1,831 | 1,850 | 1,799 | 7,283 | 7,216 |
| `questOutputNodeDefinition` | 19,575 | 4.8% | 2,201 | 2,742 | 1,537 | 6,536 | 6,559 |
| `questLogicalHubNodeDefinition` | 15,411 | 3.8% | 1,502 | 1,565 | 443 | 4,806 | 7,095 |
| `questEventManagerNodeDefinition` | 11,477 | 2.8% | 950 | 1,096 | 1,118 | 2,544 | 5,769 |
| `questVehicleNodeDefinition` | 11,192 | 2.8% | 1,268 | 2,358 | 796 | 2,847 | 3,923 |
| `questWorldDataManagerNodeDefinition` | 10,409 | 2.6% | 1,445 | 1,907 | 234 | 4,132 | 2,691 |
| `questCharacterManagerNodeDefinition` | 8,973 | 2.2% | 1,392 | 1,380 | 454 | 1,575 | 4,172 |
| `questCombatNodeDefinition` | 8,857 | 2.2% | 1,502 | 1,198 | 235 | 1,526 | 4,396 |
| `questInteractiveObjectManagerNodeDefinition` | 8,667 | 2.1% | 2,280 | 893 | 1,314 | 726 | 3,454 |
| `questDeletionMarkerNodeDefinition` | 7,029 | 1.7% | 722 | 849 | 1,385 | 3,578 | 495 |
| `questCutControlNodeDefinition` | 6,509 | 1.6% | 503 | 899 | 354 | 1,762 | 2,991 |
| `questSceneNodeDefinition` | 5,067 | 1.2% | 1,255 | 1,159 | 537 | 913 | 1,203 |
| `questLogicalXorNodeDefinition` | 4,904 | 1.2% | 564 | 621 | 406 | 922 | 2,391 |
| `questMiscAICommandNode` | 4,894 | 1.2% | 841 | 299 | 426 | 645 | 2,683 |
| `questLogicalAndNodeDefinition` | 4,791 | 1.2% | 628 | 765 | 328 | 965 | 2,105 |
| `questCrowdManagerNodeDefinition` | 4,588 | 1.1% | 199 | 380 | 120 | 3,241 | 648 |
| `questGameManagerNodeDefinition` | 4,003 | 1.0% | 707 | 1,257 | 546 | 310 | 1,183 |
| `questRandomizerNodeDefinition` | 3,186 | 0.8% | 49 | 115 | 73 | 1,290 | 1,659 |
| `questCheckpointNodeDefinition` | 2,899 | 0.7% | 475 | 516 | 242 | 1,188 | 478 |
| `questUIManagerNodeDefinition` | 2,738 | 0.7% | 558 | 292 | 33 | 738 | 1,117 |
| `questAudioNodeDefinition` | 2,617 | 0.6% | 413 | 352 | 132 | 932 | 788 |
| `questVoicesetManagerNodeDefinition` | 2,579 | 0.6% | 109 | 46 | 238 | 560 | 1,626 |
| `questMovePuppetNodeDefinition` | 2,531 | 0.6% | 654 | 205 | 116 | 556 | 1,000 |
| `questUseWorkspotNodeDefinition` | 2,037 | 0.5% | 314 | 131 | 200 | 248 | 1,144 |
| `questMappinManagerNodeDefinition` | 1,808 | 0.4% | 455 | 252 | 201 | 56 | 844 |
| `questItemManagerNodeDefinition` | 1,731 | 0.4% | 272 | 200 | 182 | 417 | 660 |
| `questVehicleNodeCommandDefinition` | 1,539 | 0.4% | 38 | 605 | 89 | 233 | 574 |
| `questTeleportPuppetNodeDefinition` | 1,201 | 0.3% | 353 | 269 | 10 | 283 | 286 |
| `questFXManagerNodeDefinition` | 1,185 | 0.3% | 342 | 108 | 9 | 63 | 663 |
| `questTimeManagerNodeDefinition` | 1,108 | 0.3% | 397 | 377 | 4 | 34 | 296 |
| `questFlowControlNodeDefinition` | 1,070 | 0.3% | 37 | 15 | 8 | 604 | 406 |
| `questEntityManagerNodeDefinition` | 1,048 | 0.3% | 496 | 126 | 73 | 134 | 219 |
| `questPhoneManagerNodeDefinition` | 1,025 | 0.3% | 200 | 279 | 38 | 144 | 364 |
| `questPuppetAIManagerNodeDefinition` | 799 | 0.2% | 217 | 137 | 29 | 106 | 310 |

20 further node types make up the remaining 1.6% (query `v_node_type_counts` for them).

**Subtypes.** Manager and condition nodes carry their real meaning in a subtype. The most used:

| Node type | Subtype | Nodes |
|---|---|---:|
| `questFactsDBManagerNodeDefinition` | `questSetVar_NodeType` | 27,050 |
| `questPauseConditionNodeDefinition` | `questTimeCondition/questRealtimeDelay_ConditionType` | 15,224 |
| `questJournalNodeDefinition` | `questJournalQuestEntry_NodeType` | 15,129 |
| `questPauseConditionNodeDefinition` | `questTriggerCondition` | 13,980 |
| `questPauseConditionNodeDefinition` | `questFactsDBCondition/questVarComparison_ConditionType` | 11,673 |
| `questConditionNodeDefinition` | `questFactsDBCondition/questVarComparison_ConditionType` | 9,261 |
| `questPauseConditionNodeDefinition` | `questLogicalCondition` | 8,917 |
| `questInteractiveObjectManagerNodeDefinition` | `questDeviceManager_NodeType` | 8,518 |
| `questWorldDataManagerNodeDefinition` | `questTogglePrefabVariant_NodeType` | 8,496 |
| `questPauseConditionNodeDefinition` | `questCharacterCondition/questCharacterSpawned_ConditionType` | 8,342 |
| `questCharacterManagerNodeDefinition` | `questCharacterManagerParameters_NodeType` | 7,516 |
| `questPauseConditionNodeDefinition` | `questCharacterCondition/questCharacterKilled_ConditionType` | 5,422 |
| `questPauseConditionNodeDefinition` | `questTimeCondition/questGameTimeDelay_ConditionType` | 4,458 |
| `questCrowdManagerNodeDefinition` | `questCrowdManagerNodeType_EnableNullArea` | 4,451 |
| `questJournalNodeDefinition` | `questJournalEntry_NodeType` | 4,052 |
| `questVehicleNodeDefinition` | `questAssignCharacter_NodeType` | 3,701 |
| `questPauseConditionNodeDefinition` | `questDistanceCondition/questDistanceComparison_ConditionType` | 3,127 |
| `questPauseConditionNodeDefinition` | `questCharacterCondition/questCharacterMount_ConditionType` | 2,958 |
| `questVehicleNodeDefinition` | `questToggleDoor_NodeType` | 2,422 |
| `questPauseConditionNodeDefinition` | `questJournalCondition/questJournalEntryState_ConditionType` | 2,298 |
| `questVoicesetManagerNodeDefinition` | `questPlayVoiceset_NodeType` | 2,232 |
| `questPauseConditionNodeDefinition` | `questObjectCondition/questDevice_ConditionType` | 2,033 |
| `questGameManagerNodeDefinition` | `questContentTokenManager_NodeType` | 2,012 |
| `questConditionNodeDefinition` | `questJournalCondition/questJournalEntryState_ConditionType` | 1,984 |
| `questConditionNodeDefinition` | `questLogicalCondition` | 1,781 |

## 3. Phase sizes

Nodes per quest or phase resource (a `.quest` is a top-level graph that starts phases; a `.questphase` is a graph that can nest others):

| Category | Kind | Resources | Mean nodes | Median | 90th pct | Max |
|---|---|---:|---:|---:|---:|---:|
| Main | questphase | 436 | 111.0 | 53.0 | 309 | 874 |
| Main | quest | 27 | 22.5 | 14 | 48 | 149 |
| Side | questphase | 510 | 101.9 | 41.0 | 244 | 1,604 |
| Side | quest | 67 | 18.7 | 11 | 42 | 155 |
| Gig | questphase | 356 | 83.3 | 48.0 | 223 | 573 |
| Gig | quest | 90 | 9.3 | 5.0 | 13 | 218 |
| Other | questphase | 1,535 | 78.2 | 35 | 172 | 1,664 |
| Other | quest | 354 | 7.2 | 3.0 | 7 | 317 |
| Phantom Liberty | questphase | 971 | 151.9 | 63 | 343 | 2,905 |
| Phantom Liberty | quest | 83 | 37.6 | 4 | 53 | 1,797 |
| **All** | questphase | 3,808 | 104.4 | 45.0 | 260 | 2,905 |
| **All** | quest | 621 | 13.5 | 5 | 17 | 1,797 |

Distribution of phase sizes (live `.questphase` files):

| Nodes | Phases | Share |
|---|---:|---:|
| 0-5 | 281 | 7.4% |
| 6-10 | 414 | 10.9% |
| 11-25 | 617 | 16.2% |
| 26-50 | 828 | 21.7% |
| 51-100 | 658 | 17.3% |
| 101-250 | 592 | 15.5% |
| 251-500 | 300 | 7.9% |
| 501+ | 118 | 3.1% |

The ten largest live phases:

| Phase | Nodes | Connections | Nested depth |
|---|---:|---:|---:|
| `ep1\quest\main_quests\q303\phases\q303_06b_paradise_technical_combat.questphase` | 2,905 | 3,266 | 2 |
| `ep1\quest\main_quests\q303\phases\q303_06b_paradise_technical.questphase` | 2,527 | 3,122 | 4 |
| `ep1\quest\main_quests\q303\q303.quest` | 1,797 | 1,728 | 5 |
| `ep1\quest\main_quests\q305\phases\q305_06_outer_bunker.questphase` | 1,732 | 2,228 | 4 |
| `ep1\quest\main_quests\q305\phases\q305_07_inner_bunker.questphase` | 1,730 | 2,233 | 4 |
| `ep1\quest\main_quests\q305\phases\combat\q305_03_ambush_combat.questphase` | 1,724 | 2,132 | 5 |
| `ep1\openworld\sandbox_activities\courier_spot\loop_phases\sa_ep1_courier_timers_reworked.questphase` | 1,677 | 2,595 | 2 |
| `base\media\radio\radio_content.questphase` | 1,664 | 2,220 | 7 |
| `base\quest\minor_quests\mq056\phases\mq056_04_big_race.questphase` | 1,604 | 1,806 | 3 |
| `base\open_world\city_scenes\badlands\inland_avenue_se1\cs_bls_ina_se1_phase.questphase` | 1,583 | 1,921 | 3 |

## 4. Graph size and shape by category

Per quest folder (all its live phases together), by category. Edges per node measures how connected the graphs are (a pure chain is about 1.0); nested depth is how deeply inline graphs sit inside each other.

| Category | Quest folders | Nodes | Connections | Edges per node | Mean nodes per folder | Median | 90th pct | Max | Max nested depth |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Main | 29 | 49,010 | 53,065 | 1.08 | 1,690 | 1,137 | 4,258 | 7,355 | 4 |
| Side | 69 | 53,207 | 58,052 | 1.09 | 771.1 | 416 | 1,792 | 6,983 | 5 |
| Gig | 114 | 30,505 | 32,200 | 1.06 | 267.6 | 258.0 | 524 | 1,392 | 5 |
| Other | 939 | 122,581 | 133,249 | 1.09 | 130.5 | 40 | 258 | 4,553 | 7 |
| Phantom Liberty | 352 | 150,655 | 173,104 | 1.15 | 428.0 | 238.0 | 665 | 13,506 | 5 |

Largest quest folders by node count:

| Folder | Category | Resources | Nodes | Connections | Scene nodes |
|---|---|---:|---:|---:|---:|
| `ep1\quest\main_quests\q305` | Phantom Liberty | 45 | 13,506 | 16,193 | 141 |
| `ep1\quest\main_quests\q303` | Phantom Liberty | 23 | 12,143 | 13,596 | 127 |
| `ep1\quest\main_quests\q301` | Phantom Liberty | 40 | 7,830 | 8,585 | 107 |
| `base\quest\main_quests\part1\q114` | Main | 43 | 7,355 | 7,787 | 106 |
| `ep1\openworld\sandbox_activities\courier_spot\loop_phases` | Phantom Liberty | 56 | 7,135 | 10,045 | 8 |
| `base\quest\minor_quests\mq056` | Side | 8 | 6,983 | 7,991 | 70 |
| `ep1\quest\main_quests\q306` | Phantom Liberty | 71 | 5,969 | 6,708 | 99 |
| `base\quest\side_quests\sq024` | Side | 19 | 5,690 | 6,384 | 68 |
| `ep1\quest\main_quests\q304` | Phantom Liberty | 63 | 5,539 | 6,031 | 104 |
| `base\quest` | Other | 13 | 4,553 | 4,786 | 81 |
| `base\quest\main_quests\part1\q112` | Main | 21 | 4,508 | 4,959 | 92 |
| `base\quest\main_quests\part1\q110` | Main | 59 | 4,258 | 4,729 | 69 |

## 5. Branching factor

Out-degree is the number of connections leaving a node. A node with out-degree 2 or more is a **fork**: it either starts parallel branches (several connections from one socket) or has several exits (a condition's True and False). Dead ends are nodes with no way on (terminating outputs, end-of-branch nodes).

| Category | Nodes | Out-degree 0 | Out-degree 1 | Forks (2+) | Mean out-degree | Mean where > 0 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| Main | 49,010 | 21.6% | 63.1% | 15.3% | 1.08 | 1.38 | 91 |
| Side | 53,207 | 18.3% | 67.3% | 14.4% | 1.09 | 1.34 | 34 |
| Gig | 30,505 | 23.3% | 60.8% | 15.9% | 1.06 | 1.38 | 41 |
| Other | 122,581 | 21.3% | 62.4% | 16.2% | 1.09 | 1.38 | 63 |
| Phantom Liberty | 150,655 | 18.2% | 64.9% | 16.9% | 1.15 | 1.40 | 63 |
| **All** | 405,958 | 20.0% | 64.0% | 16.1% | 1.11 | 1.38 | 91 |

Branching by node type (the types that fork most often, among types with at least 200 nodes):

| Node type | Nodes | Mean out-degree | Forks | Max |
|---|---:|---:|---:|---:|
| `questRandomizerNodeDefinition` | 3,186 | 3.20 | 98.0% | 32 |
| `questSwitchNodeDefinition` | 481 | 5.79 | 96.7% | 32 |
| `questCutControlNodeDefinition` | 6,509 | 2.84 | 84.8% | 51 |
| `questConditionNodeDefinition` | 19,979 | 1.84 | 68.5% | 42 |
| `questDeletionMarkerNodeDefinition` | 7,029 | 1.29 | 33.9% | 41 |
| `questLogicalHubNodeDefinition` | 15,411 | 1.89 | 33.4% | 63 |
| `questInputNodeDefinition` | 22,906 | 1.85 | 30.8% | 63 |
| `questSceneNodeDefinition` | 5,067 | 1.47 | 28.0% | 91 |
| `questStartNodeDefinition` | 599 | 1.53 | 25.4% | 12 |
| `questLogicalAndNodeDefinition` | 4,791 | 1.39 | 18.6% | 15 |
| `questLogicalXorNodeDefinition` | 4,904 | 1.29 | 16.2% | 23 |
| `questPhaseNodeDefinition` | 20,414 | 0.78 | 15.7% | 34 |
| `questPauseConditionNodeDefinition` | 90,255 | 1.23 | 13.9% | 31 |
| `questFlowControlNodeDefinition` | 1,070 | 1.15 | 12.9% | 6 |
| `questJournalNodeDefinition` | 20,569 | 0.96 | 9.1% | 15 |

Distinct exit sockets used per node (a measure of true alternatives, as opposed to parallel starts):

| Category | Nodes with an exit | One socket used | Two or more sockets used | Mean sockets used |
|---|---:|---:|---:|---:|
| Main | 38,415 | 93.4% | 6.6% | 1.10 |
| Side | 43,444 | 93.3% | 6.7% | 1.10 |
| Gig | 23,393 | 92.9% | 7.1% | 1.09 |
| Other | 96,442 | 92.2% | 7.8% | 1.11 |
| Phantom Liberty | 123,266 | 90.8% | 9.2% | 1.13 |

## 6. Fact usage

Quest nodes and scenes mention **19,202 distinct fact names**: 48,967 reads (conditions), 48,635 writes (set or add) and 238 other references (achievement progress). Only literal names in the data count: facts set or read from scripts, or built at run time, are not visible here. Scenes contribute only the reads inside their graphs and interruption rules.

| Category | Distinct facts | Read references | Write references |
|---|---:|---:|---:|
| Main | 2,705 | 5,257 | 5,188 |
| Side | 3,443 | 7,804 | 8,601 |
| Gig | 1,589 | 3,689 | 3,321 |
| Other | 7,584 | 14,879 | 14,329 |
| Phantom Liberty | 6,350 | 17,338 | 17,196 |

Most read facts:

| Fact | Reads | Writes | Resources |
|---|---:|---:|---:|
| `holo_setup_active` | 1,262 | 972 | 424 |
| `holo_setup_started` | 980 | 469 | 601 |
| `holo_interrupt_call` | 935 | 8 | 440 |
| `travelling_merchant_lives` | 613 | 0 | 484 |
| `disable_combat_events` | 461 | 34 | 241 |
| `holo_setup_ended` | 458 | 463 | 454 |
| `sa_ep1_start_encounter_cleanup` | 429 | 272 | 138 |
| `sq024_current_race_checkpoint_fact_add` | 424 | 27 | 9 |
| `wanted_level` | 423 | 1 | 136 |
| `sa_ep1_courier_quest_silencer_active` | 316 | 2 | 106 |
| `mirror_interactions_facials` | 290 | 2 | 58 |
| `sa_ep1_start_randomizer_cleanup` | 169 | 169 | 108 |
| `ue_metro_active_station` | 169 | 49 | 28 |
| `sa_ep1_courier_randomizer_activated` | 167 | 118 | 107 |
| `mq304_assassin_female` | 163 | 2 | 13 |
| `city_scenes_advanced_spawning_system_enabled` | 159 | 0 | 16 |
| `q303_lizzy_start` | 153 | 4 | 4 |
| `sa_ep1_couriers_active` | 150 | 152 | 136 |
| `q303_lizzy_end` | 137 | 2 | 6 |
| `sa_ep1_courier_ready_to_start` | 133 | 119 | 120 |
| `sa_ep1_courier_car_mounted_1st_time` | 129 | 17 | 113 |
| `sa_ep1_courier_loop_pause_randomizers` | 124 | 2 | 30 |
| `prostitutes_play_all_anims` | 123 | 0 | 4 |
| `q108_active` | 121 | 3 | 16 |
| `q112_takemura_dead` | 121 | 6 | 38 |

Most written facts:

| Fact | Writes | Reads | Resources |
|---|---:|---:|---:|
| `holo_setup_active` | 972 | 1,262 | 424 |
| `holo_setup_started` | 469 | 980 | 601 |
| `holo_setup_ended` | 463 | 458 | 454 |
| `ma_token` | 341 | 1 | 338 |
| `sa_ep1_start_encounter_cleanup` | 272 | 429 | 138 |
| `holo_reggie_calls_v_start_activate` | 207 | 26 | 108 |
| `radio_on` | 204 | 2 | 111 |
| `CYB-12345` | 183 | 1 | 182 |
| `ma_resource_tutorial` | 179 | 1 | 180 |
| `air_traffic_off` | 170 | 13 | 113 |
| `sa_ep1_start_randomizer_cleanup` | 169 | 169 | 108 |
| `sa_ep1_couriers_active` | 152 | 150 | 136 |
| `sa_ep1_dynamic_spot_on` | 147 | 76 | 28 |
| `holo_reggie_calls_v_end_activate` | 146 | 1 | 109 |
| `de_enemies_defeated` | 124 | 8 | 61 |
| `sa_ep1_courier_ready_to_start` | 119 | 133 | 120 |
| `sa_ep1_courier_randomizer_activated` | 118 | 167 | 107 |
| `sa_ep1_number_ofcouriers_activated` | 114 | 1 | 110 |
| `sq024_player_race_place_counter` | 114 | 6 | 2 |
| `ma_gang_watch_tutorial` | 113 | 1 | 114 |
| `sa_ep1_courier_expanded_spot_cleanup` | 112 | 111 | 57 |
| `holo_reggie_calls_v_rejectable` | 105 | 1 | 64 |
| `sa_ep1_courier_spots_spawned_alltime` | 105 | 0 | 105 |
| `holo_mr_hands_calls_v_start_activate` | 100 | 17 | 50 |
| `saved_time_period` | 100 | 96 | 4 |

Of 19,202 facts: 12,446 are both written and read in the data, 5,121 are written but never read here (read by scripts, by other mods, or left over), 1,635 are read but never written here (set by scripts or by the engine), and 4,824 appear exactly once.

Distinct facts touched per quest folder:

| Category | Folders with facts | Mean | Median | 90th pct | Max |
|---|---:|---:|---:|---:|---:|
| Main | 29 | 111.2 | 88 | 258 | 384 |
| Side | 72 | 57.7 | 31.0 | 134 | 485 |
| Gig | 108 | 25.5 | 25.0 | 44 | 125 |
| Other | 964 | 12.8 | 4.0 | 32 | 581 |
| Phantom Liberty | 359 | 31.0 | 15 | 37 | 812 |

## 7. Scenes

4,026 live scenes. A scene's **role** is judged from where it lives; a scene is **referenced** when a quest scene node points at it.

| Role | Scenes | Referenced by a quest node | Share | Screenplay lines | Choice nodes |
|---|---:|---:|---:|---:|---:|
| voiceset | 661 | 2 | 0% | 20,032 | 0 |
| ambient_chat | 616 | 4 | 1% | 4,156 | 0 |
| main_quest | 477 | 456 | 96% | 40,557 | 3,174 |
| side_quest | 373 | 366 | 98% | 25,003 | 2,596 |
| ambient_conversation | 335 | 1 | 0% | 830 | 0 |
| holocall | 299 | 289 | 97% | 2,251 | 88 |
| gig | 283 | 245 | 87% | 6,289 | 509 |
| media | 255 | 96 | 38% | 3,513 | 18 |
| city_scene | 214 | 2 | 1% | 212 | 1 |
| ambient_other | 180 | 94 | 52% | 1,043 | 225 |
| vendor | 156 | 132 | 85% | 2,140 | 266 |
| open_world_activity | 92 | 82 | 89% | 536 | 87 |
| quest_other | 61 | 56 | 92% | 2,342 | 241 |
| other | 13 | 7 | 54% | 55 | 34 |
| fixer | 11 | 10 | 91% | 415 | 22 |

Scenes per quest folder, by category (folders that own at least one live scene):

| Category | Folders with scenes | Scenes | Mean per folder | Median | 90th pct | Max |
|---|---:|---:|---:|---:|---:|---:|
| Main | 24 | 344 | 14.3 | 13.0 | 29 | 35 |
| Side | 70 | 351 | 5.0 | 4.0 | 12 | 19 |
| Gig | 87 | 358 | 4.1 | 4 | 6 | 15 |
| Other | 381 | 2,280 | 6.0 | 1 | 18 | 93 |
| Phantom Liberty | 129 | 693 | 5.4 | 1 | 15 | 93 |

Scenes per quest proper, counting only folders that have a `.quest` file (folders with no scene count as 0):

| Category | Quests | With no scene | Mean scenes | Median | 90th pct | Max |
|---|---:|---:|---:|---:|---:|---:|
| Main | 24 | 2 | 14.2 | 13.0 | 29 | 35 |
| Side | 67 | 3 | 5.1 | 4 | 12 | 19 |
| Gig | 85 | 10 | 4.0 | 4 | 6 | 15 |
| Other | 281 | 208 | 0.6 | 0 | 1 | 47 |
| Phantom Liberty | 71 | 36 | 4.0 | 0 | 11 | 37 |

Quests (folders with a `.quest`) with the most scenes:

| Folder | Category | Scenes | Screenplay lines | Choice nodes |
|---|---|---:|---:|---:|
| `base\open_world\scenes\mirrors` | Other | 47 | 309 | 152 |
| `ep1\quest\main_quests\q305` | Phantom Liberty | 37 | 3,366 | 230 |
| `base\quest\main_quests\part1\q105` | Main | 35 | 2,859 | 274 |
| `base\quest\main_quests\part1\q110` | Main | 31 | 1,814 | 102 |
| `base\quest\main_quests\prologue\q001` | Main | 29 | 736 | 59 |
| `ep1\quest\main_quests\q306` | Phantom Liberty | 27 | 2,170 | 180 |
| `base\quest\main_quests\prologue\q000` | Main | 24 | 1,669 | 169 |
| `ep1\quest\main_quests\q304` | Phantom Liberty | 23 | 2,759 | 210 |
| `base\quest\main_quests\part1\q115` | Main | 22 | 2,274 | 130 |
| `base\quest\main_quests\part1\q108` | Main | 21 | 653 | 76 |
| `base\quest\main_quests\part1\q114` | Main | 20 | 1,623 | 96 |
| `base\quest\main_quests\prologue\q003` | Main | 20 | 1,059 | 72 |

Scene size and dialogue shape, by category (live scenes, excluding voiceset barks):

| Category | Scenes | Mean graph nodes | Median lines | Mean lines | Choice nodes | Options per choice node | Mean actors |
|---|---:|---:|---:|---:|---:|---:|---:|
| Main | 344 | 183.7 | 50.5 | 72.1 | 2,080 | 2.0 | 6.9 |
| Side | 351 | 192.9 | 41 | 64.8 | 2,378 | 2.0 | 4.3 |
| Gig | 358 | 27.8 | 4.0 | 11.8 | 245 | 2.2 | 1.8 |
| Other | 1,698 | 20.3 | 5.0 | 7.6 | 730 | 2.5 | 1.7 |
| Phantom Liberty | 614 | 122.2 | 6.0 | 40.2 | 1,828 | 2.3 | 4.5 |

Most common scene graph node types and section event types (live scenes):

| Scene node type | Count |
|---|---:|
| `scnQuestNode` | 156,252 |
| `scnSectionNode` | 62,226 |
| `scnStartNode` | 36,278 |
| `scnHubNode` | 12,839 |
| `scnRandomizerNode` | 8,853 |
| `scnEndNode` | 7,684 |
| `scnChoiceNode` | 7,261 |
| `scnCutControlNode` | 4,027 |
| `scnAndNode` | 3,055 |
| `scnXorNode` | 2,388 |
| `scnInterruptManagerNode` | 1,244 |
| `scnDeletionMarkerNode` | 1,160 |

| Section event type | Count |
|---|---:|
| `scnDialogLineEvent` | 89,071 |
| `scnPlaySkAnimEvent` | 65,820 |
| `scneventsSocket` | 51,925 |
| `scnLookAtEvent` | 50,093 |
| `scnChangeIdleAnimEvent` | 18,221 |
| `scneventsVFXEvent` | 7,799 |
| `scnIKEvent` | 6,790 |
| `scnAudioEvent` | 6,093 |
| `scneventsSetAnimFeatureEvent` | 4,691 |
| `scnGameplayTransitionEvent` | 3,129 |
| `scnUnmountEvent` | 3,097 |
| `scneventsCameraParamsEvent` | 2,474 |
| `scneventsAttachPropToPerformer` | 2,394 |
| `scnLookAtAdvancedEvent` | 1,912 |
| `scneventsAttachPropToWorld` | 1,490 |

## 8. Journal

The cooked journals hold 28,476 entries (`base\journal\cooked_journal.journal` from `basegame_4_gamedata.archive`), 28,476 entries (`base\journal\cooked_journal.journal` from `ep1_2_gamedata.archive`), 10,147 entries (`ep1\journal\cooked_journal.journal` from `ep1_2_gamedata.archive`). The base journal is stored twice, once per archive that ships it; the Phantom Liberty archive's copy wins at run time. The class table counts the base-game copy.

| Entry class | Entries |
|---|---:|
| `gameJournalQuestCodexLink` | 7,853 |
| `gameJournalQuestMapPin` | 4,276 |
| `gameJournalQuestObjective` | 4,008 |
| `gameJournalPhoneMessage` | 2,876 |
| `gameJournalOnscreen` | 1,398 |
| `gameJournalPhoneChoiceEntry` | 1,204 |
| `gameJournalFolderEntry` | 663 |
| `gameJournalPhoneChoiceGroup` | 594 |
| `gameJournalPointOfInterestMappin` | 552 |
| `gameJournalQuestPhase` | 549 |
| `gameJournalInternetPage` | 548 |
| `gameJournalEmail` | 544 |
| `gameJournalOnscreenGroup` | 521 |
| `gameJournalPhoneConversation` | 452 |
| `gameJournalQuestDescription` | 402 |
| `gameJournalCodexEntry` | 379 |
| `gameJournalCodexDescription` | 377 |
| `gameJournalQuest` | 360 |
| `gameJournalEmailGroup` | 214 |
| `gameJournalFile` | 196 |

Journal quests by their type field (base game): `StreetStory` 80, `MainQuest` 68, `MinorQuest` 67, `Contract` 47, `SideQuest` 46, `VehicleQuest` 35, `CyberPsycho` 17.

Quest graphs reach the journal through 20,569 journal nodes pointing at 9,318 distinct entries.

## 9. How to query

Open the database read-only with any SQLite client (`sqlite3 quest-corpus.sqlite`, Python's `sqlite3`, DB Browser). Tables: `resources`, `graphs`, `nodes`, `edges`, `fact_refs`, `phases`, `scenes`, `scene_node_types`, `scene_event_types`, `journal_entries`, `ingest_log`, `meta`; views `v_node_type_counts`, `v_fact_usage`, `v_quest_scenes`, `v_quest_graph_size`, `v_scene_refs`, `v_resource_counts`. Join structure tables to `resources` by `resource_id` and filter `variant = 'live'`. The JSON of non-scene resources is in `resources.json` (use `json_extract`); scenes are zlib-compressed in `resources.json_z` (the `read_json()` helper in `qc_lib.py` decompresses them; the structure tables already hold the usual scene counts).

```sql
-- Which phases write a fact, and how?
SELECT r.path, fr.op, fr.value FROM fact_refs fr JOIN resources r ON r.id = fr.resource_id
WHERE fr.fact = 'q101_done' AND fr.role = 'write';

-- The biggest gigs by node count
SELECT quest_key, n_nodes, n_edges, scene_nodes FROM v_quest_graph_size
WHERE category = 'gig' ORDER BY n_nodes DESC LIMIT 10;

-- Nodes that fork, in one phase, with where they lead
SELECT n.node_id, n.node_type, e.src_socket, e.dst_node, n2.node_type
FROM phases p JOIN graphs g ON g.resource_id = p.resource_id
JOIN nodes n ON n.graph_id = g.graph_id AND n.n_out >= 2
JOIN edges e ON e.graph_id = n.graph_id AND e.src_node = n.node_id
JOIN nodes n2 ON n2.graph_id = e.dst_graph_id AND n2.node_id = e.dst_node
WHERE p.path LIKE '%q101_j_03_hallway.questphase';

-- Scenes a quest folder plays, with their size
SELECT s.path, s.n_lines, s.n_choice_nodes FROM scenes s
WHERE s.quest_key LIKE '%sq027' AND s.variant = 'live' ORDER BY s.n_lines DESC;

-- Facts read by a gig but never written anywhere in the corpus
SELECT DISTINCT fr.fact FROM fact_refs fr JOIN resources r ON r.id = fr.resource_id
WHERE r.category = 'gig' AND fr.role = 'read'
  AND NOT EXISTS (SELECT 1 FROM fact_refs w WHERE w.fact = fr.fact AND w.role = 'write');

-- Raw JSON of one node type, straight from the stored text
SELECT json_extract(json, '$.Data.RootChunk.graph.Data.nodes[0].Data."$type"') FROM resources
WHERE path LIKE '%q101_cleanup.questphase';
```

## 10. Limits

- Counts come from the serialised data only. A quest also lives in scripts, TweakDB records and the journal; none of those add nodes here.
- Nested graphs are counted as part of their phase; a `questPhaseNodeDefinition` that points at another `.questphase` is a reference, not a copy, so reused phases are counted once per file and the folder totals do not multiply them.
- Fact names are literal strings in the data. Facts built in scripts and facts the engine sets are invisible; "never written" therefore means "not written in the data".
- Scene statistics read the scene graph and screenplay store, not the dialogue text.
- The category split is by folder. The master graph `cyberpunk2077.quest` is counted as main.


*Database built 2026-10-22 with WolvenKit CLI 9.0.1 (archive -l, extract, convert serialize with default settings).*
