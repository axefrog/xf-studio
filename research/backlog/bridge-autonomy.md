# Runtime bridge autonomy

**Status: ranks 1, 2, 3, 5, 6 and 9 built and tested offline (claude/bridge-autonomy, 26 September 2026); none seen in game yet. The rest are queued.** In the first bridge session the player still had to open photo mode, open the character creator, press Confirm there, switch photo-mode light 1 on, move the mouse cursor out of shot, and stand V where the drone camera had room ([test card results](../runtime/runtime-bridge-test-card.md#first-session-bridge-checks)). This page ranks the bridge features that remove those steps, from the photo-mode and creator study in [knowledge/photo-mode.md](../../knowledge/photo-mode.md), which holds the evidence and citations. It is a queue for the [runtime bridge](../../projects/xf-runtime-bridge/README.md) track under [runtime access](../../knowledge/runtime-access.md).

Effort is rough agent effort once the bridge's redscript actions layer is in place: **S** is under half a day, **M** one to two days, **L** longer or research-heavy. Every write keeps the bridge's rules: behind `allow_writes` and its class, reversible with an `undo`, cleared by the kill switch, logged ([design §4](../runtime/runtime-bridge-design.md#4-safety-model)).

## Ranked features

| Rank | Feature | Technique | Source (see the knowledge page) | Effort | Risk |
|---|---|---|---|---|---|
| 1 | **Light on/off** in `photo.light.set` (`state`), plus `type`, `shadow`, `range` and cone angles | Menu attributes 44 (state), 45, 46, 48, 49/50 through the existing `GetMenuItem(key).ForceValue`, after selecting the light (43) and waiting three ticks | First-session menu dump [runtime]; Photo Mode Preferences' select-wait-set sequence [source] | S | Low: same path as brightness and hue, which worked |
| 2 | **Hide the photo-mode cursor** (`photo.cursor.hide`, and before every capture) | `@wrapMethod(CursorGameController)` on `ProcessCursorContext`: keep the controller, substitute `n"Hide"` while a flag is set, call it once with `force` to hide now; clearing the flag replays `Show`. The kill switch clears it | AMM's CET override of the same function [source] | S | Low. Check that menu clicks still work while hidden (the bridge doesn't click) |
| 3 | **Deterministic framing from camera presets** (`photo.camera.set {preset}`) | Attribute 23 selects `photo_mode.std_preset_1…9`, each a distance, pitch, yaw, roll, up/down, left/right and FOV. The test profile ships a TweakXL file that sets presets for *face*, *eyes* and *head and shoulders*, or the bridge writes the flats before photo mode opens and restores them after. Fine-tune with V's offsets (7/8/9/37). | Portrait Enhancer's overrides of the nine presets [resource]; the preset row in the menu dump [runtime] | S–M | Medium: whether presets are relative to V and how collision moves them is untested (knowledge open question 4). Writing flats changes the player's presets, so do it only in the test profile |
| 4 | **Open the creator from gameplay** (`cc.open`) | From redscript: capture `gameuiInGameMenuGameController`, send `OnOpenPauseMenu`, and in a wrapped `MenuScenario_PauseMenu.OnEnterScenario` call `SwitchToScenario(n"MenuScenario_CharacterCustomizationMirror", data)` with a `MorphMenuUserData` whose `m_updatingFinalizedState` is true (and an edit mode matching the mirror's, once traced). Let the vanilla scenario do the rest | Character Customization Anywhere's route, corrected for 2.31's `m_` field names [source] | M | Medium: the menu state machine. Refuse in combat, scenes and vehicles. Check first whether CCA's own F12 opens the new-game mode (knowledge open question 2) |
| 5 | **Leave the creator** (`cc.close {keep: false \| true}`) | Call the captured `characterCreationBodyMorphMenu`'s own `ConfirmBackConfirmation()` (discard) or `ConfirmCustomizedCharacter()` (keep) | 2.31 creator menu [source] | S | Discard is safe. Keep finalises V's look in the running game; a session that ends by loading its save undoes it. **Approved 26 September** for such sessions (below) |
| 6 | **Row labels follow scripted changes** in `cc.apply` | Apply through the row's own controller (`SetSelected…(info, index, true)`, as the arrows do) instead of the bare system call; fall back to `UpdateOption` or the row's `SetOption` after the call | 2.31 creator menu and row controller [source] | S–M | Low; the preview camera also moves to the body region, as it does for the player |
| 7 | **Hide NPCs and set the scene inside photo mode** | Attributes 54 (surrounding NPCs off), 69 (weather), 70 (time of day), 71 (game speed) through `ForceValue` | Menu dump [runtime] | S | Low. Photo-mode weather and time last only while photo mode is open [hypothesis] |
| 8 | **Put V in a fixed studio spot** (`world.teleport` to named spots) | `TeleportationFacility.Teleport(player, position, EulerAngles(0, 0, yaw))`, spots kept as JSON (x, y, z, yaw), then wait for streaming. Choose an open, quiet, evenly lit place that suits the camera presets | AMM's teleport and saved locations [source] | S–M | Medium: streaming delay, quest triggers at the destination; use a disposable save |
| 9 | **Open the full photo mode** (`photo.enter`, replacing the quest-node route) | Send the player's bound photo-mode key (`TogglePhotoMode`, default `N`) to the game window only, after checking `CanPhotoModeBeEnabled`; then `game.wait` for photo mode | Game input configuration [resource]; why the quest node fails [runtime] | M | Medium: needs focus; input injection must be allowlisted, target only the game window and read the player's actual binding. **Approved 26 September** for the one bound key only (below); built as `photo.open`. A native call is the alternative but needs reverse engineering (rank 13) |
| 10 | **Spawned key light and light sweep** (`light.rig.*`) | Spawn a light entity (Codeware `DynamicEntitySystem` from redscript), control it with `SetColor`/`SetIntensity`/`SetRadius`/`SetAngles`/`ToggleLight`, move it with `Teleport` relative to the photo-mode puppet (caught from `PhotoModePlayerEntityComponent.SetupInventory`); a sweep steps the azimuth around V's head and captures each step | CharLi's and AMM's light rigs [source] | L | Medium: needs our own light entity (CharLi's and AMM's may not be reused) or a suitable base-game one; entities must be removed on exit and by the kill switch |
| 11 | **Read and try to place the photo-mode camera entity** | Wrap `PhotomodeLightIndicatorController.OnSetActiveCamera` to keep the camera entity; read its transform into `photo.state`; try `Teleport` on it | 2.31 photo-mode light indicator [source]; placement [hypothesis] | S (read), M (place) | Low to read; placing may be overridden each frame |
| 12 | **A reference NPC beside V** | Photo Mode Ex's photo-mode characters (attribute 55, placement 60–62/66); outside photo mode Codeware `DynamicEntitySystem` with a friendly attitude and god mode | Photo Mode Ex, Photomode NPCs Extended, AMM [source] [resource] | M | Medium: depends on the player's installed mods; three NPC slots |
| 13 | **Native photo-mode entry** | Identify the native function behind `TogglePhotoMode` (the caller of `PhotoModeSystem::Activate`) and call it from the plugin on the main thread | Photo Mode Ex's address-library entries [source]; entry point unknown | L | High: a wrong call crashes; addresses change per game build |

**Built (offline, awaiting the next session's [autonomy checks](../runtime/runtime-bridge-test-card.md#next-session-autonomy-checks-expression-checks-then-session-2-continued)):**

| Rank | As built |
|---|---|
| 1 | `photo.light.set` takes `on`, `type` (spot, ambient) and `shadow` (keys 44–46), applied first after the light is selected; the undo restores them |
| 2 | `photo.hud.hide` hides the cursor with the menu by default (`cursor: false` leaves it): a flag read by our wrap of `CursorGameController.ProcessCursorContext`, cleared when photo mode opens or closes and by the kill switch. No separate `photo.cursor.hide` command: the cursor only matters for captures, which already hide the menu |
| 3 | `photo.camera.set {camera_preset}` (attribute 23) and `photo.frame {xf_preset: true}`; the TweakXL file `tweaks/test-profile/xf_photo_mode_presets.yaml` sets presets 7 (face), 8 (eyes) and 9 (head and shoulders), carried by the -diagnostic and -writes packages only. `photo.frame` fine-tunes from the game's own projection (`photo.subject`), with a coarse capture-based fallback |
| 5 | `cc.confirm` and `cc.back` (the menu's own `ConfirmCustomizedCharacter()` / `ConfirmBackConfirmation()`), refused unless `[bridge] allow_creator_leave = true`, which only the -writes build sets; refused in the new-game mode. `player.appearance` reports `menu.updating_finalized_state` and `edit_mode` (question 1 below) |
| 6 | `cc.apply` goes through the row (`SetSelected…(info, index, true)`), falling back to the bare call when no row shows the option; the result names the route |
| 9 | `photo.open` in the tools (`tools/input/photo-key.ts`): the player's binding from `UserSettings.json` or `IK_N`, sent only to the game's own window after the write gate, the phase and `photo_mode_can_open` pass; `sendinput` refuses unless the game window is in front. `photo.enter` now refuses without `route: "quest"` |

Also built: `capture.burst` (flicker and motion), the `cc-eyes` crop, grain and chromatic aberration in `photo.camera.set`, and session 2 and 3 scripts in this flow. Batch 2 (claude/bridge-batch2, offline) hardened these for the session: the key is sent only to `Cyberpunk2077.exe`, only on an explicit "photo mode allowed", re-checked after the window comes forward, never on an unbound or layout-dependent binding; the cursor hide works only in photo mode ([code-health ledger](../authoring/code-health.md#fixed-in-claudebridge-batch2), RB-34..41). **Next:** rank 4 (`cc.open`, after question 1), rank 7 (scene attributes), rank 8 (studio spot), then ranks 10–13.

## Questions for the next session

Batch these into the next bridge session's test card:

1. With the creator opened by Character Customization Anywhere's F12, read the morph menu's `m_updatingFinalizedState` and `m_editMode` (a read-only action), and note whether its bottom buttons show *Back*/*Next* or the mirror's labels.
2. Select each camera preset 1–9 in an open space and in a small room; record the camera's world transform against V's (rank 11's read) to learn whether presets follow V and how collision moves them.
3. Switch light 1 on through attribute 44 once rank 1 is built; note where it appears relative to the camera.
4. With the cursor hide built, capture with the cursor over V's face.

## Suggestions from the sessions plan

The [next-sessions plan](../runtime/next-sessions-plan.md#bridge-suggestions-for-the-autonomy-backlog) lists the player steps its ten sittings still need, as B1–B10 (unranked here until the autonomy checks have run):
- `cc.open` (rank 4) removes about 30 creator-opening asks.
- `world.time.set` in the appearance screen.
- `cc_apply` in the session scripts for the vanilla rows still asked by hand; a script generator change only.
- A read, then a write, of graphics settings (upscaler, RT/PT, SSS quality).
- A spawned light that moves in elevation (rank 10).
- A read-only GameOptions dump.
- A worn-item read, then equip and unequip.
- A full-body camera preset.
- `cc.page`, if `cc_apply` doesn't move the creator camera.
- Photo-mode NPC hiding (rank 7).

## Decisions for the maintainer

All three approved on 26 September 2026, each confined to the test profile's -writes build:

- **Confirm and Back in the creator** (rank 5): yes, only in sessions that end by loading the safety save, with the save lock held while changes are live. Built as `cc.confirm`/`cc.back` behind `allow_creator_leave`.
- **The photo-mode key** (rank 9): yes, one allowlisted key (the bound `TogglePhotoMode` key), only to the Cyberpunk window, only after `CanPhotoModeBeEnabled`, never any other input. Built as `photo.open`.
- **Our own camera presets** (rank 3): yes, in the -diagnostic and -writes packages; the distribution package must not carry them. Built as `xf_photo_mode_presets.yaml`.

## Constraints

- Techniques are learned from other mods' source, not copied; AMM and cjsu's mods state no open licence, and Photo Mode Ex is MIT. Credits are in [community credits](../../docs/community-credits.md).
- Never change the player's own profile, settings or mods: HUD settings, the look-at option and TweakDB changes are recorded and restored, or confined to the test profile.
