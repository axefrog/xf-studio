# Gig decompositions (sample of seven)

**Status:** v1, 22 October 2026. Companion to [Open-world activities](../../knowledge/open-world-activities.md), answering area B of [P2](p2-game-substrate.md) ("what each gig's journal and phase structure look like"). This is a first-pass decomposition into the **observed shape of the game's graph**; it is not yet in the composite's representation, which waits for the schema (P1 phase D, see [P2 area H](p2-game-substrate.md#h-the-quest-corpus)).

Sources: the serialised quest and phase files of each gig (game 2.31, WolvenKit CLI 9.0.1, listed with hashes in [the corpus manifest](quest-corpus-b-manifest.json)), and the TweakDB reward records. Grades follow the [knowledge base](../../knowledge/README.md#rules-for-knowledge-pages): everything here is **[resource]** (read in the files) unless marked **[hypothesis]**; nothing is runtime-proven. Titles come from the Modding Wiki's quest-id list (`a54b0873`). Fact names are given as written without the gig prefix where the prefix is obvious (`kab_02_finished`).

## How the sample was chosen

Seven gigs from six fixers, chosen from the extracted set for **different shapes** rather than for quality (the P2 plan's opinion-based sample for the larger set of side quests is a separate step):

| Gig | Fixer / district | Why it is in the sample |
|---|---|---|
| `sts_wat_kab_02` *Hippocratic Oath* | Regina, Kabuki | Escort with a persuasion branch, a scan, a failure by distance |
| `sts_cct_cpz_01` *Serial Suicide* | Dino, Corpo Plaza | Smallest in the set (178 nodes): a hack and an escape, one reward |
| `sts_hey_spr_01` *On a Tight Leash* | Padre, Wellsprings | Lethal or non-lethal route, drop-point reward, 60 spawn actions |
| `sts_std_arr_11` *Hacking the Hacker* | El Capitan, Arroyo | Stealth ("perfect") debrief variants, retaliation |
| `sts_bls_ina_04` *Radar Love* | Dakota, Inland Avenue | Vehicle theft and chase, message plus call brief |
| `sts_wbr_jpn_12` *Greed Never Pays* | Wakako, Japantown | Two linked locations, optional code, a cameo scene gated by main-story progress |
| `sts_wbr_hil_06` *Family Heirloom* | Rogue's thread (pinned by Wakako), Charter Hill | Vehicle delivery, 80 vehicle spawners, "perfect" and pacifist variants |

A Phantom Liberty gig (`sts_ep1_03`) is added at the end for contrast.

## Shape shared by all seven

| Layer | What every sample has |
|---|---|
| Quest file | Two or three nodes: a test-definition fact, the main phase, and `holocall_initializers` |
| Main phase | `openworld` + `combat` (+ `bugfixing`, sometimes `prestate_control` and `cleanup`) |
| Journal | One quest entry (the cooked journal flags some objectives optional; per gig below); a `brief` description; 5 to 11 objectives; fixer thread entries for brief, debrief (success/fail or perfect/not perfect) and sometimes a reward text; a point-of-interest mappin with discovered and completed phases |
| Gating | A pin made discoverable by the fixer phase and a tier fact (see the knowledge page §3.3); a content-token block while active |
| Brief | Trigger-area arrival, then prebrief holocall scene, or the same text as a thread entry if calls are muted or content is locked |
| Outcome | `<id>_finished` always; a failure fact in one of the seven (`kab_02_failed`; `ina_04` fails its quest by journal state alone) |
| Reward | `QuestRewards.<gig>_completion` TweakDB record, plus a district achievement counter |

## 1. Hippocratic Oath (`sts_wat_kab_02`)

**Fixer and offer.** Regina Jones; pin `points_of_interest/street_stories/sts_wat_kab_02` discovered by her phase (and tier-gated by `sts_wat_kab_tier_*`). **Files:** `.quest`, `_phase`, `_openworld`, `_combat`, `_bugfixing`; 461 nodes.

**Brief.** Prebrief holocall scene `…_holocall_prebrief.scene` (a call from Regina on arrival at `#kab_02_tr_main`); fallback entry `contacts/regina_jones/sts_wat_kab_02/…_brief`. The call machinery is a scene node with `Holocall INT/RET` sockets, a `PhoneMuted` test (group `fixer_briefs_and_debriefs`), a content-lock test, the two `holo_reggie_calls_v_*_activate` facts, the thread entry, and a skipped-call fact (`welcome_holocall_skipped`).

**Journal tree** (`quests/street_stories/watson/kabuki/sts_wat_kab_02/…`), 9 objectives used by the quest nodes (the journal also lists `filler`, `filler_inject` and `main`); `scan`, `blood`, `blood_inject`, `filler` and `filler_inject` are flagged optional. The chain, with a parallel middle (order read from the graph edges; the branching is not fully traced): `get_inside` (with a `briefing` description) → `find` → `tlk` → `persuade` → [parallel: `scan`, `blood`, `blood_inject`] → `escor` → `escort_to_car`. The parallel block is an inline sub-phase with the facts `start_scan`, `ganger_scanned`, `take_blood`, `take_blood_pickup` and `blood_injected`; the item `Items.sts_wat_kab_02_synth_blood` is the objective's physical object (an inventory test), and two world nodes are shown or hidden around it.

**Outcomes.** Success: `escort_to_car` succeeds → the quest succeeds → `kab_02_finished`, reward, achievement tick. Failure: `kab_02_patient_dead` (also `sts_wat_kab_02_patient_dead`) or a distance test (`DistanceCondition … Greater`) sets `kab_02_failed` and fails the quest. A third path stores `kab_02_never_succed` (spelled so). Debriefs: `…holocall_debrief_success` and `…holocall_debrief_fail`.

**Spawns.** Community `#kab_02_com_chester` with the entries `chester`, `patient`, `gang_car`, `transport`, `driver`, activated and re-activated by phase of the story; a spawner `#kab_02_spwn_chester_car`; reinforcements `#kab_02_com_ar` and `#kab_02_com_backup` shut down at the end. Seventeen community actions, one legacy, one spawner. A chase flag, `kab_02_gang_chase`, is set for the retaliation.

**Scenes (4).** Prebrief, debriefs, `…_scene.scene` (used four times for the patient), `…_chats.scene`.

**Reward.** `QuestRewards.sts_wat_kab_02_completion`: 3,000 eddies, 1,000 level experience, 707 street-cred experience. The district counter is `wat_achievement` for `Achievements.YipMan`. Retaliation facts: `kab_02_gang_retaliation` and `sts_maelstroms_retaliation`; a 3-hour game-time delay appears in the phase before the follow-up.

## 2. Serial Suicide (`sts_cct_cpz_01`)

**Fixer and offer.** Dino Dinovic; pin discovered by Dino's phase. **Files:** `.quest`, `.questphase`, `_openworld`, `_combat`, `_bugfixing`; 178 nodes.

**Brief.** Prebrief holocall (`…_holocall_prebrief.scene`), text fallback `contacts/dino_dinovic/sts_cct_cpz_01/…_brief`.

**Journal.** 5 objectives (order read from the graph edges): `security_building` → `server_room` → `data` (hack a terminal: a `ProgressBar` UI node with duration 5 and a "personal link connected" device condition on `#cpz_01_dvc_computer_002`) → `steal_recording` → `escape`. A text from Dino arrives when the data is in (`…_data_received`), then the debrief (`…_debrief`).

**Outcomes.** One success path: `cpz_01_finished` after the escape trigger. No failure fact. The combat phase has two community groups and a reinforcement group; an `AND` of two "all defeated" tests ends the fight.

**Spawns.** Nine community actions: the default street community `#cct_cpz_01_default_community` is *deactivated* for the gig and re-activated at the end; arrested prisoner and homeless entries in `#cpz_01_com_arested`; combat communities `#cpz_01_combat_com`, `#cpz_01_combat_arrest_com`, `#cpz_01_combat_reinforcement_com`.

**Scenes (5).** Prebrief, debrief, guards' chat, workers' chat, prisoner chat (ambient scenes triggered by areas; `cpz_01_guards_chat_end`, `cpz_01_workers_chat_end`).

**Reward.** 21,000 eddies, 1,000 level, 1,710 street cred; `Achievements.Bladerunner` counter `cct_achievement`; the content token is spawned at the end.

## 3. On a Tight Leash (`sts_hey_spr_01`)

**Fixer and offer.** Padre; pin discovered by Padre's phase. **Files:** five (`.quest`, `_openworld_phase`, `_combat_phase`, `_bugfix`, and the quest phase); 532 nodes.

**Brief.** Prebrief holocall scene with the text `contacts/sebastian_padre_perez/sts_hey_spr_01/brief` as fallback. The gig also sets `glossary_valentinos` (a glossary fact; a codex entry is the likely meaning [hypothesis]).

**Journal.** 10 objectives (`find_out` is flagged optional): `get_inside`, `find_jose_luise`, `find_out`, `take_down`, `take_body`, `take_to_fixer`, `talk_padre`, `phone` (with a `contact` entry), `get_out`, `get_reward`; the route is `take_down` then `take_body` for the kill, `take_to_fixer` for the live route, then `talk_padre`. The quest branches on a fact, `spr_01_corpo` (its meaning is not read from the name), and on the target being killed (`spr_01_jose_luise_killed`) or taken alive (`spr_01_non_lethal_path`, with a fixer car and driver `#spr_01_fixer_car`, `#spr_01_fixer_driver_com`).

**Outcomes.** Two reward records (`sts_hey_spr_01_completion` and `…_pacifist`, here both 8,570 eddies). The reward is collected at a drop point: a `DropPointControllerPS` device whose `IsRewardCollected` the quest waits on, behind a `get_reward` objective and a `message_reward` text. Padre's two `sts_warning_fail_001/002` texts exist for this region.

**Spawns.** 60 spawn actions, the highest of the sample after Family Heirloom: a legacy community `#spr_01_com` with entries `enemy_004` … `enemy_015` activated one by one (a counter `spr_01_spawn` reaches 12), `#spr_01_jose_com` for the target, `#spr_01_backup_com` (`backup_001` to `003`), vehicle spawners `#spr_01_car_002` … and a security-system test (`IsSystemInCombat` on `#spr_01_security_system`) that is probably what sends reinforcements when an alarm trips [hypothesis].

**Scenes (5).** A chats scene reused for the enemies' talk, `…_jose.scene`, `…_johnny_clues.scene`, the Padre conversation and the prebrief.

**Reward.** 8,570 eddies, 1,000 level, 1,710 street cred.

## 4. Hacking the Hacker (`sts_std_arr_11`)

**Fixer and offer.** El Capitan; pin discovered by his phase. **Files:** `.quest`, `_phase`, `_gameplay`, `_openworld`; 248 nodes. The `.quest` sets `arr_11_track`, which the openworld phase tests when choosing the first objective to activate.

**Brief.** `sts_std_arr_11_holocall_prebiref.scene` (the file name carries a typo) with the text fallback `contacts/muamar_el_capitan_reyes/sts_std_arr_11/brief`.

**Journal.** 6 objectives (order read loosely from the graph; `eliminate_lucius` is flagged optional, which makes the kill the optional branch): `get_inside`, `get_inside_megabuilding`, `delete` (the hack: a personal-link connection on `#arr_11_dvc_computer_blueprints_002`), `eliminate_lucius` (the lethal side), `get_out`, and `get_to_the_drop_point` (drop-point reward).

**Outcomes.** `arr_11_perfect` or `arr_11__not_perfect` (set near a lift-floor device condition, `IsFloorSelected`; the exact test is not traced), with the debriefs `…_debrief_perfect` and `…_debrief_not_perfect` (played from the debrief scene or sent as text). If the target is killed (`arr_11_lucius_dead`) the gig sets `arr_11_gang_chase` and `sts_6thstreet_retaliation`. One reward record (16,600 eddies), the same for both debriefs.

**Spawns.** A single community `#arr_11_com` with an `enemy_003` scene entry; reinforcements `#arr_11_reinforcement`; a tenant community `#arr_11_tenant_com`, deactivated at the end. Six actions; nine combat nodes in the gameplay phase.

**Scenes (3).** Prebrief, debrief (used for both variants), an enemy scene.

**Reward.** 16,600 eddies, 1,000 level, 1,710 street cred; `Achievements.TradeUnion`, counter `std_achievement`.

## 5. Radar Love (`sts_bls_ina_04`)

**Fixer and offer.** Dakota; pin discovered by Dakota's phase. **Files:** `.quest`, main, `_gameplay`, `_openworld`, `_bufixing` (sic), and a `test/` copy of the chase (`…_chase.quest`, `…_gameplay_chase`, `…_openworld_chase`) which looks like a developer variant [hypothesis]. 710 nodes in nine files.

**Brief.** Both channels: a phone-manager send/open/close for `contacts/dakota_smith/sts_bls_ina_04_brief` and the prebrief holocall scene; the usual mute and lock tests choose.

**Journal** (`quests/street_stories/badlands/inland_avenue/sts_bls_ina_04/retrieve_the_van/…`), 9 objectives (order read loosely from the graph): `go_to_motel`, `find_the_mobile_radar`, `leave_workshop`, `steal_the_van`, `deliver_car`, with `kill_chasing_militech`, `lose_chase`, `get_back_to_van` and `get_out_of_the_van` as the chase branch. The chase objective is toggled by a fact (`sts_bls_ina_04_chase_objective_active`) with a loop: while it is 1 the player sees `lose_chase`, when it returns to 0 `get_back_to_van`.

**Outcomes.** `steal_the_van` can fail (the quest fails); success runs the debrief success scene. One reward record (21,780 eddies).

**Spawns.** 16 actions: communities `#ina_04_com_outpost_crew`, `#ina_04_com_reinforcements`, `#ina_04_com_stat_reinf`; facts for the chase's downed cars (`#ina_04__downed_raffens_car_01` and `_02`).

**Scenes (3).** Prebrief, debriefs, guards' chats. **Reward.** 21,780 eddies, 1,000 level, 1,710 street cred; `bls_achievement`.

## 6. Greed Never Pays (`sts_wbr_jpn_12`)

**Fixer and offer.** Wakako; pin discovered by her phase. **Files:** a second quest (`quests/sts_wbr_jpn_12b_quest.quest`) and phases `12a`, `12b`, `12b_combat`, `12b_openworld`, `_main_phase`, `_prestate_control`; 301 nodes in eleven files.

**Brief.** Prebrief holocall `sts_wat_jpn_12_holocall_prebrief.scene` (the scene names say `wat`, not `wbr`), thread `contacts/wakako_okada/sts_wbr_jpn_12/brief`; debrief `…_holocall_debrief`.

**Journal.** Two parts. Part A (`12a`): `get_to_the_apartment_block` → `get_into_ozzies_apartment` → `search_the_apartment_for_evidence` → `search_the_secret_room`, with `use_code` (flagged optional in the journal; waits for `jpn_12_optional_code`) and `find_the_way` (a movable fridge, `jpn_12_movable_object_scanned`) as alternative routes. Part B (`12b`, activated by `jpn_12_second_location_active`): `get_to_the_comples` → `secure_evidence_in_bd_bar` → `retrive_corpo_cracker` → `escape` → `leave_device_in_droppoint`.

**Outcomes.** `jpn_12a_start/finished`, `jpn_12b_start/finished`, then `jpn_12_finished`. If the second location's fight happened (`jpn_12_gang_retaliation`) the debrief sets `sts_tygerclaws_retaliation`. One reward record (3,800 eddies).

**Spawns.** 14 actions: `#jpn_12_com`, `#jpn_12a_com_combat`, `#jpn_12b_com_combat`, `#jpn_12b_com_galden`, `#jpn_12b_com_reinforcement`, civilians `#sts_wbr_jpn_12a_civilians_com`, vehicle spawners. **Scenes (4).** Prebrief, debrief, `…_12b.scene`, and `…_silverhand.scene`, a cameo gated by `q101_done` (main-story progress) [resource].

**Reward.** 3,800 eddies, 1,000 level, 979 street cred; `Achievements.LittleTokyo`.

## 7. Family Heirloom (`sts_wbr_hil_06`)

**Fixer and offer.** Pin discovered by Wakako's phase; the thread belongs to Rogue (`contacts/rogue/sts_wbr_hil_06/…`: brief, two debriefs, reward message). **Files:** `.quest`, quest/openworld/gameplay phases, bugfix; 428 nodes.

**Journal.** 11 objectives (order not traced): `get_inside`, `find_bootleg`, `retrieve_bootleg`, `take_car`, `deliver_bootleg`, `deliver_car`, `get_out_car`, `get_back_car`, `get_out_from_dan`, `escape`, `get_reward` (`take_car`, `get_back_car` and `deliver_car` are flagged optional). Facts for the car state (`hil_06_deliver_car`, `hil_06_not_deliver_car`, `hil_06_parked_car`), a `hil_06_kill_count` and a spawn counter; the gig also tests `sts_wbr_hil_tier_4`.

**Outcomes.** Two debriefs (`…_debrief_perfect`, `…_debrief_not_perfect`) and two reward records (`…_completion` and `…_completion_pacifist`, equal at 16,600 eddies). A `get_reward` objective with a drop point and a `message_reward` text.

**Spawns.** 107 actions, 80 of them spawner nodes (`#hil_06_car_001` to `015` and more, presumably cars): the gig fills a car lot [hypothesis]; also `#hil_06_client_com`, legacy communities for guards. **Scenes (5).** Prebrief, debriefs, `sts_wbr_hil_06.scene`, a Johnny cameo (`…_johnny.scene`), and the shared `base\open_world\scenes\sts_characters\dan_default.scene` for the character Dan, which is another gig-wide shared scene.

**Reward.** 16,600 eddies, 1,000 level, 1,710 street cred; `Achievements.LittleTokyo`.

## 8. For contrast: Phantom Liberty, `sts_ep1_03`

Mr. Hands' Dogtown loop (see the knowledge page §9). **Files:** quest, `_phase`, `_openworld`, `_gameplay`, `_cleanup`, `_bugfixing`; 1,028 nodes; 19 objectives (`follow_briana`, `find_wagner`, `confront_wagner`, `scan_the_clues`, `crack_the_shard`, `kill_rinder`, `take_dogtag_from_rinder_body` and more), 14 journal entries of phone messages and choice groups from two contacts, 11 entries in Mr. Hands' and Regina's threads (`rinder_dead_regina`, `rinder_safe_regina`, answers), outcome-specific debriefs (`…_holocall_debrief_wagner_dead`, `…_hands_answer_holocall_debrief_rinder_01/02`), 25 scene nodes, and 60 spawn-manager nodes. It shares the world-story phases `wst_ep1_03` and `wst_ep1_04`. **Reward:** from the Dogtown loop, not read here.

## What the seven show together

- **The invariant is the wiring, not the content.** Brief → trigger → objectives → outcome fact → debrief → reward → counter is the same in all seven, even when the gameplay differs.
- **Spawn is by reference, with a lifecycle.** Each gig turns on named communities and spawners placed in the world and turns the same references off at the end; the ambient street community of the spot is often switched off for the gig and back on after.
- **Variants live in facts.** A gig's alternative endings come from three or four facts (perfect, pacifist, killed, delivered) that pick a debrief thread entry and a reward record; the objectives themselves are journal states, driven by those facts.
- **Pay is data.** The quest only names the reward record; amounts sit in TweakDB and follow the district, not the size of the gig: 21,780 eddies is paid by Radar Love (710 nodes) and by five other Badlands and Pacifica gigs of 300 to 450 nodes.
- **Retaliation and district counters are the cross-gig layer.** They are the only state that outlives a gig, apart from `_finished`, `_failed` and the journal.
