# Photo-mode and spawned lights (game 2.31)

**Maturity: Draft.** How lights reach V in photo mode: the engine's light component, photo mode's own three lights, how mods spawn and steer extra lights (CharLi, Appearance Menu Mod, World Builder), what exposure does to the result, and how a lighting setup authored in XF Studio maps onto game lights. Consolidated on 27 September 2026 from RED4ext.SDK's generated types, the decompiled 2.31 script bundle, the game's input configuration, the installed CharLi 2.2a, Appearance Menu Mod, Photo Mode Preferences and ENV Tuner packages in the reference MO2 instance (read only), the World Builder, Codeware and Cyber Engine Tweaks sources, and the lighting mirror's offline prototype. **Nothing on this page has been seen in game yet** except the photo-mode menu attributes, which the bridge's first session dumped. The mirror design that builds on it is [research/runtime/lighting-mirror-design.md](../research/runtime/lighting-mirror-design.md).

**Grades** follow the [knowledge rules](README.md). [installed] is a mod package in the reference install, read only (paths are inside the mod's folder, `mods/<mod name>/` under MO2). [offline] is the mirror prototype's own tests.

## In brief

- **Every game light is an `entLightComponent`** with a colour, a type (point, spot, area), a unit (lumen, watt, lux, nit, EV100), an intensity, an attenuation (inverse square or linear) and radius, inner and outer cone angles, a softness exponent, a source radius and per-light shadow switches. Scripts can change only the colour, intensity, radius, cone angles, temperature, strength and on/off at run time; everything else is fixed when the component is created. [source]
- **Photo mode has three lights of its own,** each switched, typed (spot or ambient), shadowed, and set by brightness, range, cone angles and hue/saturation/luminance sliders (attributes 43–53). No menu value places a light, and how the sliders map to component values is unknown. [runtime] menu; mapping [hypothesis]
- **Mods add lights by spawning entities,** then steering them through the component's setters and moving them with the teleportation facility. CharLi and AMM spawn their own light templates through Cyber Engine Tweaks; World Builder spawns an empty entity through Codeware and adds a light component with **every** field set from data when the entity assembles. [source] [installed]
- **Placing lights about V is solved in the mods:** CharLi re-reads the photo-mode puppet's position and yaw on every update and teleports its lights to follow. [installed]
- **A Studio setup can be mirrored** with the same techniques: positions and aim convert exactly, colour and cones convert by the Studio's own conventions, and a light that came from the game (the creator rig) can be carried in its native lumens. Absolute brightness is the one thing that needs fitting, because photo mode's automatic exposure and the world's own light are not the Studio's. [offline] mapping; the match [hypothesis]

## 1. The light component

`entLightComponent` (alias `LightComponent`), and its game subclass `gameLightComponent`, carry these fields [source] RED4ext.SDK `ad727771` `include/RED4ext/Scripting/Natives/Generated/ent/LightComponent.hpp` and the enums beside it:

| Group | Fields | Values |
|---|---|---|
| What it is | `type` | `LT_Point`, `LT_Spot`, `LT_Area` (`areaShape`: sphere or capsule; `areaTwoSided`, `areaRectSideA/B`, `capsuleLength`, `spotCapsule`) |
| Brightness | `unit`, `intensity`, `EV`, `color` (8-bit), `temperature` (−1 = off) | `unit`: `LU_Lumen`, `LU_Watt`, `LU_Lux`, `LU_Nit`, `LU_EV100` |
| Reach | `attenuation`, `radius`, `clampAttenuation` | `LA_InverseSquare`, `LA_Linear` |
| Cone | `innerAngle`, `outerAngle`, `softness` | degrees; the creator rig reads as full angles, softness 1–5 ([creator lighting §2](creator-lighting.md#2-the-box-and-its-lights)) |
| Shadows | `enableLocalShadows`, `contactShadows`, `shadowSoftnessMode`, `shadowAngle`, `shadowRadius`, `shadowFadeDistance/Range`, `sourceRadius`, `rayTracingLightSourceRadius`, `rayTracingContactShadowRange` | `contactShadows`: `CSR_None`, `CSR_CharacterOnly`, `CSR_All`; softness modes extra soft to extra sharp |
| Where it counts | `sceneDiffuse`, `sceneSpecularScale`, `roughnessBias`, `useInTransparents`, `useInParticles`, `scaleGI`, `scaleEnvProbes`, `scaleVolFog`, `lightChannel`, `group`, `pathTracingLightUsage` | |

**The evaluation** of spot and point lights, decoded from the clustered local-light shader, is in [creator lighting §2](creator-lighting.md#how-the-engine-evaluates-these-lights): inverse-square `saturate(1 − (d/r)⁴)² / d²`, linear `1 − saturate(d/r)` with no 1/d² term, and a cone `pow(saturate(a·cosθ + b), softness)` [source]. How the CPU turns lumens and cone angles into the shader's constants is not known; the Studio reads lumens as candela Φ/4π [hypothesis].

**What scripts can change at run time** [source] 2.31 `core/components/lightComponent.script`, `gameLightComponent.script`:

| Class | Setters |
|---|---|
| `LightComponent` | `SetColor`, `SetIntensity`, `SetRadius`, `SetTemperature`, `SetFlickerParams`; `Toggle` through `ToggleLightEvent` |
| `gameLightComponent` | the same with an optional blend time (`inTime`), plus `SetAngles(inner, outer)`, `SetStrength`, `ToggleLight(on)`, `SetParameters(gameLightSettings)` (strength, intensity, radius, colour, inner and outer angle), `GetCurrentSettings`, `IsOn` |

Unit, EV, attenuation, softness, source radius, type and the shadow switches have no setter. A mod that needs another value either spawns a different template (AMM keeps a `_shadows` twin of each light and respawns it, [photo mode §5.2](photo-mode.md#52-spawned-lights-charli-and-amm)) or builds the component from data before it attaches (World Builder, §3) [source]. Whether writing those fields on a live component and toggling it takes effect is untested [hypothesis].

**Reading a component works from Lua:** AMM reads `intensity`, `radius`, `color`, `innerAngle`, `outerAngle`, `type` and `contactShadows` straight off the component it finds by class name [source] AMM `Modules/light.lua:3-27, 571-590`.

## 2. Photo mode's own lights

| Attribute | Meaning | Range | Grade |
|---|---|---|---|
| 43 | Which light (1–3) the rows below edit | | [runtime] |
| 44 | On / off | | [runtime] |
| 45 | Spot / ambient | | [runtime] |
| 46 | Shadow on / off | | [runtime] |
| 47, 48 | Brightness, range | 0–100 each | [runtime]; [installed] Photo Mode Preferences `init.lua:102-103` |
| 49, 50 | Inner and outer cone angle | 15–175° | [runtime] |
| 51, 52, 53 | Hue, saturation, luminance | 0–360, 0–100, 0–100 | [runtime] |
| 10 | Exposure (Effects page) | −2.2 to +2.2 | [installed] Photo Mode Preferences `init.lua:109` |

- **The lights are native entities:** `gamePhotomodeLightObject` with a `gamePhotomodeLightComponent`, a subclass of `entLightComponent` with no script-visible fields of its own [source] SDK `game/PhotomodeLightObject.hpp`, `game/PhotomodeLightComponent.hpp`. The menu receives `PhotomodeLightInitializedEvent { light: wref<Entity> }` for each, and `PhotomodeLightResetEvent` exists [source] 2.31 `orphans.script:53440-53443`; SDK `game/ui/PhotomodeLightResetEvent.hpp`. No script handles the initialised event, so the controller that receives it is native.
- **An off-screen light keeps its place.** The light indicator projects the active light's position and shows an arrow at the screen edge while it is off screen [source] 2.31 `photoModeLightIndicatorController.script:54-110`. So a light stays in the world while the camera moves; where it starts is not traced. The input `ResetCurrentLight` (`IK_R`, left thumbstick) exists in the photo-mode context [resource] `r6/config/inputContexts.xml:207`, `inputUserMappings.xml:2071-2074`; that it puts the light back at the camera is a [hypothesis].
- **Lights reset each time photo mode opens** [runtime], so any tool sets them each time.
- **Which component values the sliders produce** (brightness to lumens or another unit, range to radius, hue/saturation/luminance to colour) is unknown. One read of the three components after setting each slider answers it (§7, question 1).

## 3. Spawning lights from a mod

| Route | How | Every field? | Persistence | Grade |
|---|---|---|---|---|
| **CET spawner and a light template** (CharLi, AMM) | `exEntitySpawner.Spawn(template, transform, …)`, poll `Game.FindEntityByID`, then the setters; remove with `entity:GetEntity():Destroy()` or `Despawn` | No: fixed by the template | CET runs a native game spawner instance that it initialises when the world attaches and tears down before it detaches | [source] CET `9a8522f` `src/reverse/RTTIExtender.cpp:200-290, 394-470`; [installed] CharLi `cl.glow.lua:1466-1470` |
| **Codeware dynamic entities and a template** | `DynamicEntitySystem.CreateEntity(spec)` with `persistState` and `persistSpawn` false, tags, `DeleteTagged(tag)` | No | Chosen per spec | [source] Codeware `613a1cb8` `scripts/World/DynamicEntitySpec.reds`, `DynamicEntitySystem.reds` |
| **Codeware static entities and a component added at assembly** (World Builder) | `StaticEntitySystem.SpawnEntity(spec)` of an empty entity template, then on the `Entity/Initialize` callback `entity:AddComponent(gameLightComponent.new())` with colour, intensity, angles, radius, type, EV, softness, attenuation, source radius, local and contact shadows and the rest set from saved data | **Yes** | The spec has no persistence fields; `DespawnTagged(tag)` removes a group | [source] World Builder `d9680f4d` `modules/classes/spawn/light/light.lua:114-150`, `spawnable.lua:135-175`, `r6/scripts/entBuilder.reds`; Codeware `scripts/World/StaticEntitySpec.reds`, `StaticEntitySystem.reds` |

- **Moving a spawned light:** `GetTeleportationFacility():Teleport(entity, position, EulerAngles)`, every time the target moves [installed] CharLi `cl.glow.lua:1473-1482`.
- **Aiming:** a spot light's own +Y is its axis, the convention of the Blender add-on's sector importer ([creator lighting §2](creator-lighting.md#2-the-box-and-its-lights)) [hypothesis for spawned entities until one is placed in a session].
- **Templates are the mod's own assets.** A tool that spawns lights needs its own entity template (an empty entity is enough on the World Builder route); CharLi's, AMM's and World Builder's templates may not be reused ([provenance follow-ups](../research/provenance-followups.md)).
- **Redscript without Codeware** has no script-visible way to spawn an arbitrary template in 2.31 (no spawn function in the decompiled bundle) [source]; Codeware-dependent script can be compiled only when Codeware is present with `@if(ModuleExists("Codeware"))`, as World Builder does [source] `entBuilder.reds:1`.

## 4. CharLi: a character light rig for photo mode

**What and who.** "CharLi – Character Lighting Suite for Photomode", Nexus mod 8176, version 2.2a in the reference install. Its script headers read "2023 by FreakaZ (+FlowerD)" and thank Beethy, Cyanide and PewPew [installed] `bin/x64/plugins/cyber_engine_tweaks/mods/CharLi/init.lua:1-7`. The Nexus page itself could not be checked (automated access is blocked), so the page's author field, permissions and any stated performance notes are unverified ([provenance follow-ups](../research/provenance-followups.md)). It is a Cyber Engine Tweaks mod (seven Lua files, 7,133 lines) plus `archive/pc/mod/charli.archive` (16 resources: light and prop templates under `base\charli\`) [installed].

**What it does.** It spawns groups of lights in a ring around V that follow V, in photo mode or in normal play. Its description allows up to 10 groups of 1, 2, 4, 6, 8 or 10 lights, 100 lights in all [installed] `meta.ini` description.

| Aspect | How | Grade |
|---|---|---|
| Light sources | Four templates, each a base-game lamp mesh plus one light component, the mesh switchable: *Spotlight* (spot; component `Light5520`; `spotlight_a.mesh`), *Entropy* (area, length 0.1–20), *Industrial* (point), *Favelas* (area, fluorescent tube, length 0.1–20) | [installed] `cl.glow.lua:40-95`; archive names |
| Also | *Lightblockers*: one-sided scalable walls ("Ray & Path") that block light; props (a sign, a glass skylight, animated fog) | [installed] `cl.glow.lua:96-175` |
| Placement | Lights on a circle about V: radius 1.35 m + 0.15 m per light by default, 1.3 m above the feet, evenly spaced by azimuth, the ring turned by V's yaw so it keeps its place relative to V's facing. *Offset compensation* aims each light at V horizontally and, for spots, at a height of 1.5 m. A group can also be detached to stay at a world position | [installed] `cl.glow.lua:534-775, 865-900` |
| Controls per group | Intensity 0–1000 (default 500) × a multiplier 1–100; range 0.5–25 m (default 25) × a multiplier 1–25; spot inner and outer angles 5–90° (defaults 5° and 25°); an 8-bit RGB colour; ring radius, rotation, convergence, position and angle offsets; per-light overrides of intensity, colour, position and angles | [installed] `cl.core.lua:505-575`, `cl.glow.lua:900-925, 1540-1690` |
| Master controls | One set applied to all groups: intensity ±100 %, radius, rotation, convergence, offsets | [installed] `cl.core.lua:285-300`, `cl.glow.lua:1808-1830` |
| How it sets a light | `FindComponentByName(name)`, then `SetColor(Color)`, `SetIntensity`, `SetRadius`, `SetAngles(inner, outer)`, `ToggleLight`; nothing else is changed at run time, so unit, falloff, softness and shadows are whatever the template holds | [installed] `cl.glow.lua:1540-1690` |
| Following V | On every CET update it reads the tracked puppet's position and yaw (the photo-mode puppet, caught from `PhotoModePlayerEntityComponent.SetupInventory`, else the player) and teleports every light when either changed | [installed] `init.lua:26-39`, `cl.core.lua:26-43, 1567-1633` |
| Lifetime | Spawned with the CET spawner; all destroyed when a save loads or unloads and on CET shutdown; closing photo mode leaves them in the world | [installed] `init.lua:14-23, 42-44`, `cl.core.lua:1646-1665` |
| Presets | Setups and groups saved as JSON rows in its CET SQLite database; the reference install holds no such database, so no presets | [installed] `cl.data.lua:115-200`; install state |

**Not verified.** The templates' own light settings (unit, attenuation, softness, shadows, source radius) sit in each entity's compressed component buffer. WolvenKit 9.0.1 refused to serialise these 2023-era entities (`entMeshComponent.castShadows` stored as a Bool where 2.x expects an enum), and WolvenKit 8.17.4 needed more memory than this study's 1 GB budget. So what CharLi's intensity numbers mean in lumens, and whether its lights cast shadows, stay open (question 4).

**What it teaches.** The whole mirror loop already exists in a player mod: spawn, set, follow V's photo-mode puppet by position and yaw, remove on load. What CharLi does not do is place lights from outside data: its positions come from ring parameters, not from a light list.

## 5. Exposure and what else changes the result

- **Photo mode inherits the world's automatic exposure** and offers its own compensation (attribute 10, ±2.2) [installed]; the creator camera instead uses fixed manual exposure ([creator lighting §4](creator-lighting.md#4-exposure)). Automatic exposure adapts to the frame, so the same lights look brighter on a dark surround.
- **Exposure can be pinned in memory.** ENV Tuner (CyanideX, per its script namespace) catches the environment resources as they load (Codeware resource callbacks on `worldEnvironmentDefinition` and `worldEnvironmentAreaParameters`), then rewrites each `ExposureAreaSettings` curve (minimum, maximum, compensation, adaptation speeds) to one point, and keeps the originals to restore [installed] `r6/scripts/ENVTuner/ENVTuner.reds:395-445`, `modules/exposure.reds:84-160`. Setting minimum equal to maximum should hold exposure fixed [hypothesis].
- **The grade is the same LUT in the creator and in photo mode,** but runtime LUT mods such as LUT Switcher apply as player effects that may switch off in menus, so photo mode can be graded differently from the mirror screen ([creator lighting §5](creator-lighting.md#5-tone-mapping-and-grading)) [installed].
- **The world keeps lighting V:** its sky, probes, GI and street lights all add to anything a tool spawns, and local lights without shadows shine through walls. The creator's box has none of that ([creator lighting §10](creator-lighting.md#10-indirect-light-what-reaches-v)) [resource].

## 6. Mapping a Studio setup onto game lights

The prototype is `projects/xf-runtime-bridge/tools/lighting/mirror-map.ts` with its tests (`tools/test/lighting-mirror.test.ts`, 19 passing) [offline]. The design and its reasons are in the [lighting mirror design](../research/runtime/lighting-mirror-design.md#3-mapping).

| Studio | Game | Grade |
|---|---|---|
| Frame: Y up, V faces −Z, V's right +X, metres from the feet | V's local frame: X right, Y forward, Z up. Studio (x, y, z) = local (x, −z, y); both right-handed. World placement uses V's measured facing vector, never an assumed yaw sign | [offline]; the local axes [source] (the mesh export's map) |
| Position and target | The light at the position, its +Y aimed along target − position; the whole setup moved so its focus sits on V's live head slot, or kept about V's feet | [offline]; +Y as the axis [hypothesis] |
| Spot, candela, decay 2, range r | Spot in lumens, Φ = 4π·I, inverse square, radius r | inverse of the Studio's reading [offline]; the engine's absolute scale [hypothesis] |
| Spot, no falloff (decay 0) | Linear light with a radius 20× its distance to the head (flat within 1 % across the head), Φ = 4π·I / (1 − d/r) | [offline] |
| Directional, lux | A linear spot 2 m out along its direction, aimed at the head, the same illuminance at the head | [offline] |
| Linear RGB colour | 8-bit sRGB, the exact inverse of the Studio's decode | [offline] |
| Half-angle, penumbra | Full outer angle, inner = outer × (1 − penumbra), softness 2 | the Studio's "full" reading [hypothesis] |
| Shadows on | Local shadows and character contact shadows | [hypothesis] for the look |
| A light that came from the game (the creator rig) | Its native lumens, falloff, radius, cone, softness and shadow flags, unchanged; a later Studio edit scales the lumens by the ratio | [offline] |
| Room environment, backdrop, exposure, the Studio's display transform | Not carried; reported in plain words | [offline] |

## Open questions

1. What component values do photo mode's brightness, range and colour sliders produce, and where does each light start? (Catch the three `gamePhotomodeLightObject` entities and read their components and transforms; also answers [photo mode](photo-mode.md) open question 5.)
2. Does a light spawned through Codeware's static entity system with a component added at assembly render and shadow like a sector light with the same values?
3. Is a spot light's +Y its axis for a spawned entity, and does the engine's lumen conversion treat inverse-square and linear lights the same way (the creator calibration's open question 9)?
4. CharLi's template light settings (unit, falloff, softness, shadows): read with a WolvenKit build that accepts the 2023 format, within a memory budget.
5. Does pinning `ExposureAreaSettings` hold photo mode's exposure fixed, and is it restored cleanly?
6. Can the photo-mode lights themselves be moved with the teleportation facility, or does photo mode re-place them every frame?

## Sources

- RED4ext.SDK `ad727771`: `ent/LightComponent.hpp`, `ELightUnit.hpp`, `ELightType.hpp`, `ELightShadowSoftnessMode.hpp`, `rend/LightAttenuation.hpp`, `rend/ContactShadowReciever.hpp`, `game/LightSettings.hpp`, `game/PhotomodeLight*.hpp`, `game/ui/PhotomodeLight*.hpp`.
- Decompiled 2.31 script bundle (redscript-cli 0.5.31): `core/components/lightComponent.script`, `gameLightComponent.script`, `cyberpunk/UI/fullscreen/photoMode/photoModeLightIndicatorController.script`, `photoModeMenuController.script`, `orphans.script`.
- Game input configuration: `r6/config/inputContexts.xml`, `inputUserMappings.xml` (2.31).
- Installed packages, read only: CharLi 2.2a (Nexus 8176), Appearance Menu Mod (repository `5427235`, same Lua as the installed 2.12.5), Photo Mode Preferences 0.1.1 (Nexus 32736), ENV Tuner 1.10 (Nexus 23079).
- Source: World Builder `d9680f4d`, Codeware `613a1cb8`, Cyber Engine Tweaks `9a8522f`.
- Who made each and what it taught us: [community credits](../docs/community-credits.md).

## Related pages

[Photo mode](photo-mode.md) · [Character-creator lighting](creator-lighting.md) · [Runtime access](runtime-access.md) · [Lighting mirror design](../research/runtime/lighting-mirror-design.md) · [Bridge autonomy backlog](../research/backlog/bridge-autonomy.md)
