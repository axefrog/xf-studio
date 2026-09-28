# Deep dive B3: photo mode, posing and capture

Batch B3 of the [installed-mod survey](README.md#proposed-deep-dive-plan): the photo-mode, posing and capture mods in the reference Mod Organizer 2 instance, read against the deep-dive checklist. It extends what [photo mode](../../knowledge/photo-mode.md), [poses](../../knowledge/poses.md) and [photo-mode lights](../../knowledge/photo-mode-lights.md) already held from earlier studies of the same mods; the distilled facts are there, and this page keeps the per-mod findings, the bugs and the recommendations.

**Evidence.** Everything here is offline, 29 September 2026. Mods were read in place under `PATH_TO_MO2/mods/<mod>/` (paths below are inside each mod's folder) and never modified. Upstream sources: [Photo Mode Ex](https://github.com/psiberx/cp2077-photomode-ex) at `v1.4.1` (`dd1245b`; the installed 1.4.0 is tag `v1.4.0`, whose native code differs only in the position-step flat) and [Appearance Menu Mod](https://github.com/MaximiliumM/appearancemenumod) at `5427235` (its Lua is byte-identical to the installed 2.12.5 apart from line endings). The two plugins without source (Photo Mode Pose Selector's bridge DLL and IGPT) were examined only by a string and byte search of the installed DLLs; nothing was disassembled or run. Game references are the decompiled 2.31 script bundle (redscript-cli 0.5.31, a private scratch copy), the REDmod TweakDB source `tools/redmod/tweaks/base/gameplay/static_data/photomode.tweak`, the game's `r6/config/input*.xml`, RED4ext.SDK `ad727771` and the RED4ext logs of the two most recent game starts (29 September 2026, one per profile). Grades follow the [knowledge rules](../../knowledge/README.md); **[resource]** here also covers a string or byte search of an installed binary.

## Summary

| Mod (installed) | What it is | Key takeaway for XF | Licence |
|---|---|---|---|
| Appearance Menu Mod 2.12.5 | 31k-line CET library | Moves photo-mode stand-ins with plain teleports and re-teleports them after the menu refreshes their transform; plays workspot poses on the stand-in; toggles the stand-in's makeup and earring components by name | None found: learn only |
| PhotoMode-EX 1.4.0 | RED4ext plugin + 2 redscript modules | The native photo-mode lifecycle (Activate → Finalize → Deactivate), the native attribute API, character layout and the placement pipeline; it silently changes placement semantics for every other tool (§2) | MIT: reuse allowed with the notice |
| Photo Mode Pose Selector 1.2.0 | CET + 2 redscript files + a small RED4ext DLL | Per-character freeze through individual time dilation; the photo-mode system's edit slot and spawn list read natively | All rights reserved: learn only |
| Hot-Sampled Photomode Renders (IGPT) 0.1.4 | RED4ext plugin + redscript + input XML | The engine's own screenshot renderer takes a custom resolution, a 1×/2×/4× multiplier, forced LOD0, PNG/EXR and render-debug view modes; its output has no UI and no ReShade | None found: learn only |
| CharLi 2.2a | CET light rig (already studied) | Nothing new for lights; per-frame cost is small | None found: learn only |
| Customisable Photo Mode UI 0.2 | 110-line redscript | The photo-mode ink tree and a way to restyle it each time it opens | None found: learn only |
| Photo Mode Preferences 0.1.1 | CET | Apply order and waits for setting photo-mode attributes; the effect rows' real ranges and steps come from TweakDB | "Copyright (c) 2026 cjsu. All rights reserved." (`README.md:93`): learn only |

InGamePhotomodeTweaks, the RED4ext plugin the brief asked about, **is** IGPT: the plugin's own name, loaded from `red4ext/plugins/InGamePhotomodeTweaks/` in the main profile's session and absent from the XF diagnostic profile's [runtime: RED4ext log, 29 September 2026].

## Answers to the batch's five questions

### 1. Opening photo mode without a key press

**None of the seven mods opens photo mode.** They only react to it: AMM, CharLi, Photo Mode Pose Selector (PMPS), Photo Mode Preferences (PMP) and Customisable Photo Mode UI (CPMUI) observe or wrap `gameuiPhotoModeMenuController.OnShow`/`OnHide`; AMM also watches the `TogglePhotoMode` key's release in `PlayerPuppet.OnAction` [source]. Photo Mode Ex hooks the native `PhotoModeSystem::Activate`, `Finalize` and `Deactivate` but never calls them [source] `PhotoModeExService.cpp:69-99`. IGPT's own action (`IGPTScreenshot_HiRes`) goes through an input listener registered on the player, not through any photo-mode entry [source] `red4ext/plugins/InGamePhotomodeTweaks/Scripts/IGPT.reds:103-129`.

What the batch adds is the **order of native steps** a plugin can hook: `Activate` (the system registers characters; Photo Mode Ex adds its extra NPCs and fetches its persistent state here) → `Finalize` (attributes exist; Photo Mode Ex writes its saved control scheme, snap-to-terrain and depth of field with `SetAttributeValue(…, apply = false)` here) → `Deactivate` (before the stand-ins go) [source] `PhotoModeExService.cpp:247-291`. A `HookAfter` on `Finalize` is a more exact "photo mode is ready" moment than the menu's `OnShow`, which the script mods use and which runs while the menu still sets up its rows (PMP waits 3 frames and 0.05 s after it, PMPS 2-3 frames) [source]. The key with the game in front stays the bridge's route; bridge 0.5.2's `gamePhotoModeEnableEvent` probe is untouched by anything here.

### 2. Placing the photo-mode camera

**No mod in the batch places photo mode's own camera.** Photo Mode Ex's decoded layout of the native system covers only characters (`0x130`-`0x370`: the player list, the player, the NPC list, background offsets, three spawn slots, the edit and spawn slot indices) and none of its 27 hooks touches the camera [source] `src/Red/PhotoMode.hpp:89-99`. AMM's cameras are its own spawned entities, deactivated when photo mode opens (`Tools:EnterPhotoMode`) [source] `Modules/tools.lua:4494-4500`. What the batch does show, for bridge 0.5.2's `photo.camera.place`:

- **Photo mode writes a stand-in's transform only when it flags one.** Its characters carry an `updateTransform` flag, set by attribute processing (yaw, pitch, roll, placement) and consumed by `ApplyPuppetTransforms`, which clears it [source] `PhotoModeExService.cpp:512-548, 600-720`. So a teleported stand-in stays where it was put until the next menu change for it. AMM relies on exactly this: it moves stand-ins with `TeleportationFacility.Teleport`, and when the player clicks any menu arrow (`PhotoModeMenuListItem.StartArrowClickedEffect`) it watches each stand-in for ten ticks and teleports it back if the menu moved it [source] AMM `init.lua:406-426`, `Modules/tools.lua:776-837, 2243-2262`. Photo mode's lights held a teleport in session 4 the same way ([photo mode §5.1](../../knowledge/photo-mode.md#51-photo-mode-lights)). The camera differs: it moves under continuous input every frame, so whether it keeps a teleport or is re-derived from its orbit state each frame is what `photo.camera.place`'s `held` decides [hypothesis].
- **Any route has to survive the camera's own limits:** `photo_mode.camera` holds distance (±40 m), pitch (-55° to 70°), up/down and left/right (50 m) and FOV (5-90°) limits, plus background-mode limits [resource] `photomode.tweak:81-163`.
- **Framing by V's placement depends on Photo Mode Ex** (§2 below): with it installed, ground snapping is off, the ±5 m range is fixed, and with its default control scheme the left/right and forward axes follow V's spawn orientation.

### 3. Reading and setting attributes, exposure included

| Layer | Read | Write | Evidence |
|---|---|---|---|
| Menu row (script) | `controller.GetMenuItem(key)` then `GetSliderValue()` or `GetSelectedOptionIndex()` | `GetMenuItem(key).ForceValue(value, true)`; fallback `controller.OnForceAttributeVaulue(key, value, true)` (the native event, misspelt in the game) | [source] PMPS `init.lua:628-655, 787-811`; PMP `init.lua:616-630` |
| Menu controller (native, script-visible) | Observe `OnAttributeUpdated(key, value, doApply)`; ranges from `OnSetupScrollBar(key, start, min, max, step, displayType)` and `OnSetupHueBar` | `OnAttributeUpdated(key, value, doApply)` is what a row calls on change | [source] 2.31 `photoModeMenuController.script:128`; Photo Mode Ex `PhotoModeMenuListItem.reds:9-18`; PMP `init.lua:1112-1119` |
| Photo-mode system (native only) | `PhotoModeSystem::GetAttributeValue(system, key, float&)` | `SetAttributeValue(system, key, value, apply)`, then the system's `ProcessAttribute(key)` | [source] Photo Mode Ex `src/Red/PhotoMode.hpp:112-122`, `Addresses/Library.hpp:21-23` |

- **Exposure is attribute 10**, raw range ±2.2 with step 0.022, shown in the menu as −100 to 100. The range is the TweakDB flat `photo_mode.postFX.brightness_range = 2.2`; the other effect rows follow the same rule (range from `photo_mode.postFX`, step = range / 100): contrast `contrast_range` 0.2, highlights `highlights_range` 0.75, chromatic aberration `chromatic_aberration_range` 2.0, grain `grain_max` 1.0 [resource] `photomode.tweak:180-194`; PMP's fallback steps match exactly [source] PMP `init.lua:106-133`. So a bridge value in menu units is `raw = shown × range / 100`, and a wider range needs only that flat. What one raw unit means (a stop of exposure?) is not established [hypothesis].
- **Order matters.** PMP sets child rows before the switch that enables them (focal distance, aperture and autofocus before depth of field; the colour-balance values before colour balance), waits 2 frames and 0.03 s between stages, and sets lights by selecting one (attribute 43), waiting 2 frames and 0.03 s, setting its values, then restoring the selection [source] PMP `init.lua:699-838`. PMPS waits for the menu's own setup event before a look-at body-part change that follows a look-at mode change (`pendingLookAtApply`) [source] PMPS `init.lua:895-983`.
- **Defaults are flats too:** `photo_mode.camera.default_fov` (60), `photo_mode.attributes.dof_aperture_default` (4) and `dof_focus_dist_default` (8) [resource] `photomode.tweak:113, 165-178`; AMM rewrites the first two from its settings in CET's `onTweak` event, when TweakDB loads, not while photo mode runs [source] AMM `init.lua:776-822`.
- **Race to plan for:** PMP applies its saved values 3 frames after every `OnShow`, and by default it always sets full collision off. A bridge write in that window can be overwritten; wait for the menu to settle (PMP needs about 10 frames when lights are included) or read back before relying on a value [source] PMP `init.lua:137, 699-705`.

### 4. Rendering above screen resolution

IGPT asks **the engine's own screenshot renderer** for a larger image, not a resized window or tiled captures:

- **The settings are the engine's screenshot request.** Its Mod Settings (a base resolution from 1280×720 to 3840×2160, a multiplier ×1/×2/×4, "Force LOD0", PNG/EXR/both) mirror the fields of the engine's `rendSingleScreenShotData`: `mode` (`rendScreenshotMode`, including `HIGH_RESOLUTION` = 5), `resolution` (`rend::dim::EPreset`), `resolutionMultiplier` (1, 2, 4), `forceLOD0`, `saveFormat` (`SF_PNG` 2, `SF_EXR` 32, both 34) and `emmModes` (an array of `EEnvManagerModifier`) [source] IGPT `Scripts/IGPT.reds:40-98`; SDK `rend/SingleScreenShotData.hpp`, `rend/ScreenshotMode.hpp`, `rend/ResolutionMultiplier.hpp`, `ESaveFormat.hpp`. The ×4 of 3840×2160 is the description's "up to 15360 × 8640".
- **The native side** is `InGamePhotomodeTweaks.TakeFancyScreenshot(resolution, scale, format)` and `WaitForRender(format)`, called from redscript: the key handler starts the render, then dispatches a Codeware callback-system event whose listener calls `WaitForRender`, deferring the wait out of the input handler [source] `IGPT.reds:1-38`. Its DLL resolves engine addresses through `RED4ext_ResolveAddress`, starts a watcher (`IGCTRenderWatcher`) on a temporary file named from `HIGH_RES_EMM_None` plus `.png`/`.exr`, and renames the result to `photomode_DDMMYYYY_HHMMSS.<ext>` under the user's Pictures `Cyberpunk 2077` folder (`SHGetKnownFolderPath`) [resource] strings in `InGamePhotoModeTweaks.dll`. Which engine function it calls is not visible without disassembly.
- **It blocks the game.** Long renders trip the engine's two-minute watchdog, so IGPT unprotects and patches the watchdog during a render and restores it after (its strings "Failed to set/restore watchdog memory protection"); renders over about five minutes don't arrive; crashes still happen [resource] DLL strings; its Nexus description in `meta.ini`. Game 2.31 only, and a ray- or path-tracing GPU is stated as required.
- **The output has no UI and no ReShade**, because it is the engine's render path, not a copy of the swap chain (the description: the UI will not be in the final screenshot; ReShade and IGCS depth of field don't apply) [resource] description; the mechanism [hypothesis].
- **Input.** IGPT appends its action to the `PhotoModeUI` context on Space and the pad's X/Square, and empties the vanilla `PhotoModeTakeScreenshot_HiRes` mapping, which is Space in vanilla (the vanilla `TakeScreenshot` is F) [resource] `r6/input/InGamePhotomodeTweaks.xml`; game `inputUserMappings.xml:2092-2103`.

**For XF captures this matters more than the resolution.** A capture from the engine renderer would be free of the photo-mode menu, the mouse cursor and ReShade, the three contaminations the bridge now works around (cursor hiding, menu fades, the [ReShade caveat](../../knowledge/creator-lighting.md)). `emmModes` also lists the engine's debug views (surface albedo, world and view normals, roughness, metalness, hair ID, depth, the multilayered masks and more) [source] SDK `EEnvManagerModifier.hpp`; if the shipping renderer still honours them, one request could return a face's albedo and normals for direct comparison with the Studio's G-buffer [hypothesis]. Recommendation: a research probe in the bridge plugin, written from the SDK types (never from IGPT, whose DLL has no licence), that first finds the engine's screenshot entry point in the address library or by our own reverse engineering; until then, when IGPT is installed, the bridge may call its public script class (`new InGamePhotomodeTweaks().TakeFancyScreenshot(…)`) as a supervised, optional research path with a crash warning.

### 5. Expression and pose control beyond the menu

| Lever | Scope | Evidence |
|---|---|---|
| Freeze one character: `SetIndividualTimeDilation(n"PMPSPhotoMode", 1.0, 0.0, n"None", n"None", false, false)` (the stand-in follows the frozen world's dilation); release by the same call with `ignoreGlobalDilation = true` | V's or one NPC's stand-in: pose clip, animated expression and look-at stop together; auto-released when that character's category, pose or expression changes, on `OnHide` and on shutdown | [source] PMPS `init.lua:19-26, 329-409, 2660-2663, 2738-2747`; 2.31 `orphans.script:11871` |
| Find the exact stand-in: V from `PhotoModePlayerEntityComponent.SetupInventory`'s `fakePuppet` (record `Character.Player_Puppet_Photomode`); an NPC from the photo-mode system's edit slot (`+0x36C`) and spawn list (`+0x1D0`, three `PhotoModeCharacter*`), whose `puppet` is the entity | Any stand-in; the NPC route needs native code | [source] PMPS `PhotoModeVTargetBridge.reds`; [resource] `mov eax,[rax+0x36C]` and `[rax+rbx*8+0x1D0]` in `PMPSPhotoTargetBridge.dll`, the offsets Photo Mode Ex documents |
| Play a workspot animation on a stand-in: spawn the pose's workspot entity at the stand-in (yaw + 180°), `PlayInDeviceSimple(workspot, stand-in, …, n"AMM_WORKSPOT")`, `SendJumpToAnimEnt(stand-in, clip, instant)` | Any pose clip in any workspot, beyond the menu's lists; AMM's custom poses | [source] AMM `Modules/anims.lua:328-376`, the stand-in joins AMM's targets through `SetupInventory` (`init.lua:392-404`) |
| Facial reaction on an NPC: `ReactionManager.ResetFacial(0)`, wait 0.5 s, `ApplyFeature(n"FacialReaction", AnimFeature_FacialReaction{category, idle})` | Spawned NPCs (needs a `ReactionManager`); not photo-mode stand-ins, which the menu drives (attributes 28 and 56) | [source] AMM `Modules/tools.lua:2368-2395` |
| Look-at kept through pose changes: note V's body-part choice (attribute 74; 78 for NPCs), and 3 frames and 0.05 s after a category, pose or character change put it back with `OnForceAttributeVaulue` | V | [source] PMPS `init.lua:11-17, 2805-2828` |
| Show or hide the stand-in's makeup and earrings: `FindComponentByName` then `Toggle(bool)` on `hx_000_pwa__basehead_makeup_lips_01` (the male lips makeup is the auto-named `MorphTargetSkinnedMesh1265`), `hx_000_<pwa|pma>__basehead_makeup_eyes_01`, `i1_000_<gender>__morphs_earring_01`…`04`, and every `*seamfix*` component | An A/B switch for XF's own decals on the stand-in | [source] AMM `Modules/tools.lua` `ToggleMakeup`, `ToggleAccessories`, `ToggleSeamfix` |

## 1. Appearance Menu Mod (photo-mode, posing, expression, spawn and teleport parts)

**How it works.** A CET mod that registers observers in `onInit` and polls with its own `Cron` timers. On the photo-mode key's release it assumes photo mode opened, adopts the stand-in (up to ten 0.1 s ticks), optionally hides the cursor and re-applies its makeup, accessory and seam-fix toggles after 1 s; on `ExitPhotoMode` it clears its stand-in list and restores slow motion and the look-at option [source] `init.lua:681-705`, `Modules/tools.lua:4494-4600`.

**Hook points** (photo-mode relevant; the [triage](README.md#cet-override-overlaps) lists the rest): `ObserveAfter PhotoModePlayerEntityComponent.SetupInventory` (adopt the stand-in), `Observe gameuiPhotoModeMenuController.OnSetNpcImage` (an NPC was spawned), `Observe PhotoModeMenuListItem.OnSliderHandleReleased` and `.StartArrowClickedEffect` (re-teleport moved stand-ins), `ObserveAfter gameuiPhotoModeMenuController.OnSetCategoryEnabled` (disable menu tabs), `Override CursorGameController.ProcessCursorContext` (cursor), `Observe PlayerPuppet.OnAction` (keys), `Observe Frame.OnScreenshotChanged` (picture-frame props showing gallery shots), `GameSession`'s `OnShow`/`OnHide` observers [source] `init.lua:336-451, 681`, `External/GameSession.lua:609-622`.

**Data added.** TweakDB flats in `onTweak`: photo-mode puppets' display names fixed from their NPC records, and with "photo mode enhancements" on: `dof_aperture_default`, `default_fov`, `min_fov` 1, roll ±180, an empty `onlyFPPPhotoModeInPlayerStates`, and `LookatPreset.PhotoMode_LookAtCamera.followingSpeedFactorOverride` 1200 [source] `init.lua:776-822`. An ArchiveXL scope file adds AMM's four player entities to `player_ma.ent`/`player_wa.ent` [resource] `archive/pc/mod/AMM_PlayerBodyTag.xl`.

**State.** SQLite `db.sqlite3` (settings, saved locations, props, components list) and JSON user data; nothing in saves. The HUD toggle and the look-at option change the player's real game options (see the photo-mode page's persistence note).

**UI.** ImGui windows; in-menu it only enables or disables native tabs.

**Undocumented engine knowledge.** The stand-in's makeup, earring and seam-fix component names; `Frame` entities' `activePhotoID`, `activePhotoHash` and `activePhotoUV` (an in-world frame shows a gallery screenshot); the look-at preset speed flat; photo-mode stand-ins accept workspot playback and teleports.

**Novelty.** The only installed mod that poses stand-ins with arbitrary workspot clips and re-asserts teleported stand-in positions against the menu.

**Bugs and fragility.**
- `EnterPhotoMode` runs on the key's release whether or not photo mode opened (combat, a scene, `NoPhotoMode`), and after two ticks it takes the player as the stand-in, so AMM can believe photo mode is open when it isn't. Photo mode opened any other way (the quest node) is never noticed [source] `init.lua:698-705`, `Modules/tools.lua:4502-4523`.
- Tab indices for the tab toggles are chosen by CET version (`< 34`), a proxy for the game version; the "DOF" label for tab 1 looks pre-2.0, so on 2.31 that toggle may disable a different tab [source] `init.lua:428-440`; effect [hypothesis].
- `FreezeNPC` freezes with individual time dilation under the reason `radialMenu` and releases with `UnsetIndividualTimeDilation`, which clears any individual dilation the NPC has, whatever set it [source] `Modules/tools.lua:2448-2475`.
- `ToggleMakeup`/`ToggleAccessories` assign an undeclared global `gender`; male lips makeup depends on an auto-generated component name.
- "Photo mode enhancements" checks the player's status-effect tags every frame to strip `NoPhotoMode` [source] `init.lua:1530-1534`.

**Performance.** That per-frame tag check; Cron timers at 0.001-0.1 s for up to ten ticks per stand-in after each menu click; the `OnAction` observer runs for every input action.

**Licence.** No licence in the repository or the installed package: learn only.

**Relevance.** Stand-in posing and the component toggles are the most direct route to XF's pose and makeup A/B tests in game; the teleport-then-reassert pattern is the model for any bridge placement.

**Conflicts with the bridge.** `CursorGameController.ProcessCursorContext`: AMM's override **always calls the original** (`wrapped(...)`), substituting `Hide` while its cursor toggle is on, so the bridge's `@wrapMethod` still runs; with AMM's toggle on the bridge sees `Hide` and cannot show the cursor [source] `init.lua:443-451`; CET `Override` passes the redscript-compiled function, wraps included, as `wrapped` [hypothesis, consistent with CET's override design]. `SetupInventory` is observed after the bridge's wrap runs. AMM's re-teleport after menu clicks would undo a bridge move of V's stand-in made just before a menu change.

**Adopt / avoid.** Adopt the stand-in teleport and re-assert pattern, workspot posing of stand-ins (in our own code) and component toggles for A/B; avoid global reasons like `radialMenu` and unconditional `Unset…` releases.

## 2. PhotoMode-EX

**How it works.** A RED4ext plugin (psiberx's shared RED4ext/RedLib framework, MinHook) that hooks 27 native photo-mode functions by address-library hash, patches one instruction sequence, and ships two small redscript modules [source] `src/App/Application.cpp`, `PhotoModeExService.cpp:67-99`, `PhotoModeNpcPatch.cpp`.

**Hook points.**
- `PhotoModeSystem`: `Activate` (after), `Finalize` (after), `Deactivate` (before); `RegisterPoses`, `RegisterWeaponPoses`, `PrepareCategories`, `PreparePoses`, `ResolveCurrentPose`, `GetAvailableCategoriesCount`, `GetAvailablePosesCount`, `UpdatePoseDependents` (remap extra characters to a stock body: Panam, Viktor, Jackie, Smasher or Nibbles by visual tag); `CalculateSpawnTransform` (after), `SpawnCharacter` (after), `ApplyPuppetTransforms`, `SetRelativePosition` (after), `SyncRelativePosition`, `ProcessAttribute` (after); **`AdjustPuppetPosition` and `CalculateGroundOffset` replaced outright**.
- `PhotoModeMenuController`: `AddMenuItem`, `SetAttributeEnabled` (after), `SetupOptionSelector`, `SetupGridSelector`, `SetupScrollBar`, `ForceAttributeVaulue` (before), `SetNpcImageCallback`.
- `TweakDB::LoadOptimized` (after): registers every `Character` record with `persistentName: PhotomodePuppet`, an existing entity template and an icon.
- A byte patch inside `ProcessAttribute`: the sequence `lea eax,[r12-2]; cmp eax,0x31` has its bound raised and the following `ja` removed ("Photo Mode NPC limit patch").
- redscript: wraps `PhotoModeMenuListItem.OnScrollBarValueChanged`/`SetupScrollBar` (fractional digits), `gameuiPhotoModeMenuController.SetCurrentMenuPage` (a tab title), `PhotoModePlayerEntityComponent.FindMatchingEquipmentInEquipArea` (NPCs use weapons from their own inventory).

**Data added.** Menu rows 3401 (control scheme), 3402 (snap to terrain), 3421/3422 (V's pitch and roll), 3431/3432 (NPC pitch and roll), 3433 (NPC appearance); the flat `photo_mode.character.position_adjust_step` (1.4.1); two hidden dummy character slots; extended `photo_mode.general.*PhotoModePuppet` and `photo_mode.npcs.npcRecordID` arrays [source].

**State.** `PhotoModeExPS : PersistentState` per save (`alternativeControls`, default **true**; `snapToTerrain`; `depthOfField`); pitch, roll and appearance per character only for the session [source] `PhotoModeExPS.hpp`.

**Undocumented engine knowledge.** The whole native side: the address-library hashes of 25 photo-mode functions, the `PhotoModeCharacter` layout (0x190 bytes: puppet, collider, index, type, `relativePosition`, `updateTransform`, look-at preset, spawn orientation and position, rotation and offsets), the system's character lists and slot indices, and the transform pipeline (spawn transform → spawn → relative position → flagged `ApplyPuppetTransforms`). The engine config variable `SnapToTerrainIk/Enabled` controls the stand-ins' foot IK [source].

**Placement semantics it imposes on every other tool** (this matters for `photo.frame`):
- **No ground offset, no position adjustment:** `CalculateGroundOffset` always returns 0 and `AdjustPuppetPosition` becomes a plain sum, whatever the settings [source] `PhotoModeExService.cpp:56-65`.
- **The ±5 m range is fixed**, not widened: `min(max(min, −1), −5)` is always −5 and the maximum always 5, so Photo Mode Unlocker XL's wider `max_position_adjust` never reaches the six placement rows [source] `:973-975` (the same in 1.4.0). This, not the vanilla limit, is where the bridge's framer hit the ends of the range in session 3.
- **With the alternative scheme (the default),** placement is right/forward along V's **spawn orientation**, rotated into world axes by `FixRelativePosition`, and the native `SyncRelativePosition` is skipped; NPCs spawn at V's spawn transform, offset ±0.75 m right or 0.75 m forward by slot [source] `:406-450, 550-598`. Session 3's "axes fixed in the world, not turned with V's rotation" fits: fixed to the spawn yaw, not to the current yaw [runtime] session 3; the explanation [source].

**Novelty.** The only native photo-mode extension; the extra-character registration is a data-driven framework (Photomode NPCs Extended relies on it).

**Bugs and fragility.**
- **A possible null dereference:** `OnActivate` returns before fetching the persistent state when the NPC character list is empty, but `OnFinalize`, `OnCalculateSpawnTransform`, `OnSpawnCharacter` and others dereference it. After one normal activation the static handle stays set, but then it may belong to the **previous save**, so settings can be written to the wrong save's state [source] `:247-273, 276-282`; when the list is empty [hypothesis].
- **The code-patch restore fails:** the second `VirtualProtect` passes `nullptr` for the old-protection out-parameter, which Windows rejects, so the patched page stays `PAGE_EXECUTE_WRITECOPY` [source] `PhotoModeNpcPatch.cpp:10, 30`. Harmless in practice.
- `Deactivate` forces `SnapToTerrainIk/Enabled` back to true, whatever it was before photo mode [source] `:287`.
- NPC outfit row 82 is always disabled [source] `:874-878`.
- Address hashes and the pattern patch break on game patches; the plugin states 2.3 compatibility.

**Performance.** Hooks run only in photo mode; `ApplyPuppetTransforms` builds a small vector per call. No per-frame script work.

**Licence.** MIT (copyright Pavel Siberx): code may be reused with the notice.

**Relevance.** The reference for any native photo-mode work in the bridge (attribute calls, lifecycle hooks, character layout); the extra-character framework is how an XF reference head could join photo mode as a character.

**Conflicts with the bridge.** Its native `AddMenuItem`/`SetupScrollBar`/`SetupOptionSelector` hooks run **before** the script events, so the bridge's wraps of `OnAddMenuItem`, `OnSetupScrollBar` and `OnSetupOptionSelector` see Photo Mode Ex's extra rows and its ±5 m ranges as if they were the game's. If the bridge ever hooks the same native functions, two MinHook users on one address chain but must never unhook out of order; prefer calling them. Its per-save `depthOfField` persists any depth-of-field change a bridge session makes.

**Adopt / avoid.** Adopt the lifecycle hooks and attribute calls (reuse permitted under MIT, with the notice); treat its presence as a mode of placement the framer must detect (rows 3401/3402 in the menu).

## 3. Photo Mode Pose Selector

**How it works.** A CET window (2,869 lines) listing the characters, categories, poses and expressions the menu builds, with favourites, arrow keys, quick placement controls, four saved positions, look-at choices and per-character freeze. Two redscript files: a page-sync method and a scriptable system that records V's stand-in. A RED4ext DLL (`PMPSPhotoTargetBridge` 1.2.0, author "CJ" in its plugin info [runtime: RED4ext log]) registers a native class with `GetEditedSlot()`, `GetPuppetEntityIDForSlot(slot) -> EntityID` and `GetTargetStatus(slot)` [resource] DLL strings.

**Hook points.** CET `Observe` on `gameuiPhotoModeMenuController.OnShow`, `OnHide`, `OnUninitialize`, `OnSetupOptionSelector`, `OnSetupScrollBar`, `SetCurrentMenuPage`, `OnAttributeUpdated`; `ObserveBefore`/`ObserveAfter` `OnAttributeOptionSelected` [source] `init.lua:2649-2802`. redscript: `@addMethod(gameuiPhotoModeMenuController) SetCurrentMenuPageSyncedPMPS` (toggles the top buttons so the tab highlight follows), `@wrapMethod(PhotoModePlayerEntityComponent)` `SetupInventory`, `OnGameAttach`, `OnGameDetach` [source]. CET inputs for freeze, unfreeze, save and cycle positions.

**Data added.** None in TweakDB or archives.

**State.** SQLite in its CET folder: favourites (by category and pose text), settings, four position slots (yaw, left/right, near/far, up/down per character) [source] `init.lua:1416-1540`.

**UI.** ImGui, keeping the native page and tab in step through its added method.

**Undocumented engine knowledge.** NPC look-at attributes (58 mode, 78 body part; V: 15 and 74), NPC expression 56, the character selector 68 [source] `init.lua:1-12`; that the stand-in follows the world's zero dilation once given an individual dilation that doesn't ignore it; the system offsets above.

**Novelty.** Per-character freeze and the native NPC resolution.

**Bugs and fragility.**
- The DLL reads raw offsets `0x36C` and `0x1D0` of the photo-mode system, which move with game patches; it holds no version check beyond RED4ext's hash resolution [resource].
- Release never calls `UnsetIndividualTimeDilation`; it leaves its named dilation at 1.0 ignoring the world. Harmless for a stand-in that is destroyed on exit; whether it overrides photo mode's own dilation handling for a stand-in that stays is untested [hypothesis].
- Saving four positions switches the menu's page and selection through each character with fixed frame waits [source] `init.lua:1750-1830`.

**Performance.** `onUpdate` does two small state machines; nothing scans while closed.

**Licence.** "Copyright (c) 2026 cjsu. All rights reserved." [source] `README.md`: learn only.

**Relevance.** Freeze and look-at persistence are already in the bridge's snapshot design; the NPC slot read is the route to per-NPC control.

**Conflicts with the bridge.** Both wrap `SetupInventory` (both call the original first; order doesn't matter). Its auto-unfreeze and look-at restore react to any attribute change, including the bridge's, so a bridge pose or expression change unfreezes a PMPS-frozen character, and a bridge look-at choice can be put back to PMPS's saved one 3 frames after a pose change.

## 4. Hot-Sampled Photomode Renders (IGPT)

Covered in answer 4 above. Checklist points not listed there:

- **Hook points:** `@wrapMethod(gameuiInGameMenuGameController)` `RegisterInputListenersForPlayer` and `UnregisterInputListenersForPlayer` (its `IGPTInputListener`); a Codeware `ScriptableService` registering a callback-system listener; the input XML above [source]. Native hooks, if any, are not visible offline.
- **Data added:** `IGPT.archive` (57 KB; not opened); Mod Settings class `InGamePhotomodeTweaksSettings` [source].
- **State:** Mod Settings only.
- **Bugs:** the "both" format produces only the EXR (stated in its description); the settings object is created fresh on each press (`new InGamePhotomodeTweaksSettings()`), which relies on Mod Settings injecting values into new instances [source]; the watchdog patch is a crash risk if the render thread dies; "Force LOD0" is a setting in the script but never passed to `TakeFancyScreenshot` (only resolution, scale and format are) [source] `IGPT.reds:31-37`, so where the DLL reads it is unknown.
- **Performance:** zero until triggered; then the frame blocks for the render.
- **Licence:** none found; author dragonzkiller (the plugin's own author field in the RED4ext log) [runtime]. Learn only.
- **Relevance:** the capture-quality route above. **Conflicts:** none with bridge hooks; it takes Space in photo mode.

## 5. CharLi (extension of the earlier lighting study)

The earlier study ([photo-mode lights §4](../../knowledge/photo-mode-lights.md#4-charli-a-character-light-rig-for-photo-mode)) stands. Added here:

- **Hooks:** CET `Observe` on `QuestTrackerGameController.OnInitialize`/`OnUninitialize` (in-world), `gameuiPhotoModeMenuController.OnShow`/`OnHide`, and `ObserveAfter PhotoModePlayerEntityComponent.SetupInventory` [source] `init.lua:14-35`.
- **Per frame:** three guarded reads (position, yaw, transform) of the tracked puppet and a teleport of every light only when V moved; paused while the game reports pause [source] `cl.core.lua:1567-1633`.
- **Bugs:** `GAME:Get` for a float calls `ShortenFloat` without a length, which formats `"%.nilf"` and throws if ever used [source] `cl.game.lua`; the tracked stand-in is never cleared on exit (harmless: the photo-mode flag gates it). Setup names are sanitised before SQL.
- **Licence:** none found; learn only. **Conflicts:** `SetupInventory` observed, like the bridge's wrap.

## 6. Customisable Photo Mode UI

**How it works.** A Codeware `ScriptableService` whose Mod Settings fields scale the menu (0.5-1.0) and show or hide the logo, frame lines, fluff, hotkey hints and scroll bars; it applies them on every settings change and in a `@wrapMethod(gameuiPhotoModeMenuController) OnShow` by walking `inkPhotoModeLayer`'s virtual window: `Root` → each child's `Root` → `options_panel`, `others/{logo, lines, lineNods, fluffFrame}`, `input_panel`, and `listContainer` children resized to 1500×1700 to drop the scroll bars [source] `r6/scripts/CustomisablePhotoModeUI.reds`.

- **Bugs:** the `OnShow` wrap discards the original's return value and returns nothing; every widget cast (`as inkCanvas`) is used without a null check, so a changed tree logs null calls; the Boolean settings default to **false**, so a fresh install hides the logo, lines, fluff, hotkey hints and scroll bars until the player turns them on [source].
- **Performance:** one walk per open. **Licence:** none found; author not evidenced in the package; learn only.
- **Conflicts with the bridge:** both wrap `OnShow`; independent.
- **Relevance:** hiding `input_panel` and `others` from script is a cleaner capture than fading the whole menu; the bridge can do the same per capture and restore it.

## 7. Photo Mode Preferences

**How it works.** A CET window that remembers chosen values for 34 attributes (camera, time and weather, light values for all three lights, effects, colour balance) and applies the checked ones in stages after each `OnShow` (answer 3) [source] `init.lua:3-38, 640-838`. Observers: `OnAddMenuItem`, `OnAddAdditionalMenuItem`, `OnSetupOptionSelector`, `OnSetupScrollBar`, `OnSetupHueBar`, `OnShow`, `OnHide`, `OnAttributeUpdated` [source] `:1097-1140`. State: SQLite in its folder.

- **Bugs and conflicts:** it overrides full collision (off) for every user by default; it loads the same light values into all three lights, and its selection restore can race a user's own selection in those frames; its apply window races any other writer (answer 3).
- **Licence:** "Copyright (c) 2026 cjsu. All rights reserved." [source] `README.md:93`: learn only.
- **Relevance:** the staged apply order and the range-reading from `OnSetupScrollBar` are what the bridge's photo-mode writes follow.

## Conflicts with XF's bridge, collected

| Function | Bridge | Others in this batch | Effect |
|---|---|---|---|
| `gameuiPhotoModeMenuController.OnShow` | wrap | CPMUI wrap; AMM, CharLi, PMPS, PMP observe | PMP writes up to about 10 frames later; don't set photo-mode values before it finishes |
| `OnAddMenuItem`, `OnSetupScrollBar`, `OnSetupOptionSelector` | wraps | Photo Mode Ex (native, runs first); PMPS, PMP observe | The bridge sees Photo Mode Ex's rows and ranges as the game's |
| `PhotoModePlayerEntityComponent.SetupInventory` | wrap | PMPS wrap; AMM, CharLi observe | Independent |
| `CursorGameController.ProcessCursorContext` | wrap | AMM `Override` (calls through) | AMM's cursor toggle forces `Hide` into the bridge's wrap |
| V's stand-in transform | `photo.frame` via attributes; `photo.camera.place` | AMM re-teleports stand-ins after menu clicks; Photo Mode Ex changes placement semantics | Detect both; re-read after each change |
| Character dilation | none yet | PMPS and AMM freeze by individual dilation | Bridge changes to pose or expression unfreeze PMPS's characters |

## Recommendations

1. **Bridge 0.5.2 camera:** test `photo.camera.place` against a menu change as AMM does for stand-ins (teleport, click an arrow, read back), not only after four frames.
2. **Bridge exposure:** send raw values (±`photo_mode.postFX.brightness_range`), report the menu's percentage, and wait for Photo Mode Preferences' apply window before writing.
3. **Framing:** read whether Photo Mode Ex is present (rows 3401/3402) and its control scheme; with it, V's placement moves along the spawn yaw and never beyond ±5 m.
4. **Capture:** open an R&D item for an engine-renderer capture (`rendSingleScreenShotData`: resolution, multiplier, LOD0, EXR, `emmModes`), built from the SDK; it removes the menu, cursor and ReShade from captures and may return albedo and normals.
5. **Poses and makeup A/B in game:** posing the stand-in through a workspot and toggling its makeup components are both available without menu work; both belong in the bridge's pose and makeup test commands.

## Related pages

[Survey triage](README.md) · [Photo mode](../../knowledge/photo-mode.md) · [Poses](../../knowledge/poses.md) · [Photo-mode lights](../../knowledge/photo-mode-lights.md) · [Runtime bridge design](../runtime/runtime-bridge-design.md)
