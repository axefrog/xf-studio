# Lighting mirror: a Studio lighting setup in the game's photo mode

**Status: R&D design with an offline mapping prototype (27 September 2026); nothing runs in game yet.** The request: a lighting setup in XF Studio can be mirrored into the running game's photo mode on demand, through the [runtime bridge](../../projects/xf-runtime-bridge/README.md), with CharLi as the reference. This page answers the six research questions (prior art, photo mode's own lights, mapping, the reverse direction, the bridge design and the first session) and proposes phases. The graded facts it rests on are in [knowledge/photo-mode-lights.md](../../knowledge/photo-mode-lights.md); the game's creator rig and display transform are in [knowledge/creator-lighting.md](../../knowledge/creator-lighting.md). It is the concrete design for rank 10 of the [bridge autonomy backlog](../backlog/bridge-autonomy.md) (a spawned key light and light sweep) and P4 of the [parity measurement design](../authoring/game-parity-measurement.md#43-tooling-phased).

## In brief

- **Feasible, and most of it is proven in player mods.** CharLi and Appearance Menu Mod spawn light entities, set their colour, intensity, range and cone, and teleport them to follow V's photo-mode puppet; World Builder builds a light component with every field (unit, falloff, softness, shadows, source radius) from data as its entity assembles. The bridge can do the same from a Studio light list. [source] [installed]
- **Placement, aim, colour, cone and shadows map exactly or by the Studio's own conventions;** the prototype (`projects/xf-runtime-bridge/tools/lighting/mirror-map.ts`, 19 tests) does it and reads game lights back. [offline]
- **The creator rig should travel in its native game values** (lumens, falloff, radius, softness, shadow flags), not through the Studio's candela: the engine then does its own conversion, so the unknown lumen scale cancels. That makes the Character creator setup mirrored onto V in photo mode a direct test of the whole approach against the creator screen.
- **Absolute brightness needs one fitted scale per scene.** Photo mode keeps the world's automatic exposure and the world's own light (sky, probes, GI, street lights); the creator's box has neither. An "isolate V" option and an exposure pin make the result recognisable (§3.3).
- **The route:** our own empty light-host entity spawned through Codeware's static entity system with a light component added at assembly, tagged so one call removes every light; photo mode only; cleared on exit, on `lights.mirror.clear` and by the kill switch; nothing persists in saves. Codeware is detected, never installed.
- **Effort** to a first useful mirror: about 7–8 agent-days over three phases plus one supervised session (§7). Nine questions for the maintainer, each with a proposed default (§8).

## 1. Prior art

| Source | What it does | What we take | Grade |
|---|---|---|---|
| **CharLi – Character Lighting Suite for Photomode** (Nexus 8176, 2.2a; "2023 by FreakaZ (+FlowerD)" per its script headers) | A CET mod that spawns up to 10 groups of 1–10 lights (spot, area, point templates built on base-game lamp meshes) in a ring about V, aims them at V, sets colour, intensity (0–1000 × 1–100), range (0.5–25 m × 1–25) and spot angles (5–90°), follows V's photo-mode puppet by position and yaw every update, and removes everything when a save loads | The follow loop, the puppet catch, spawn-poll-set, removal on load; its limits (no light list from outside, no runtime shadow or softness change) | [installed] ([details](../../knowledge/photo-mode-lights.md#4-charli-a-character-light-rig-for-photo-mode)) |
| **Appearance Menu Mod** | Controllable point, spot and area light props; reads the component's fields; respawns a `_shadows` template to switch shadows | Reading a component's values from Lua; the shadow-twin workaround | [source] |
| **World Builder** (keanuWheeze) | Spawns an empty entity through Codeware's static entity system and adds a `gameLightComponent` with every field set from saved data on the entity's assembly callback | The route that sets every field without a template matrix | [source] `d9680f4d` |
| **Vanilla photo mode** | Three lights: on, type, shadow, brightness, range, cone, colour; no placement from the menu | The bridge already drives these (`photo.light.set`); a mirror switches them off while it runs | [runtime] menu |
| **ENV Tuner** (CyanideX) | Rewrites the environment's exposure curves in memory and restores them | How an exposure pin could work | [installed] |
| **Photo Mode Preferences**, **Photo Mode Unlocker XL** | Menu attribute numbers and ranges (exposure ±2.2); widened camera limits | Validation ranges | [installed] |

Credits are in [community credits](../../docs/community-credits.md); unresolved authorship in the [provenance follow-ups](../provenance-followups.md).

## 2. Where it belongs

**Build the engine side in the XF Runtime Bridge now; leave a player-facing in-game light editor to XF Photo Mode Tools later.**

- The mirror is Studio-driven: the setup lives in the Studio, the bridge carries it, and it needs the bridge's write gate, undo, kill switch and logs. That is the bridge's job, and its test builds already carry photo-mode writes.
- A CharLi-like in-game editor (saved rigs, sliders in the CET overlay, no Studio) is a Photo Mode Tools product, which stays an independent project. It can reuse the same light-host entity, placement arithmetic and **setup format**: a Studio setup exported as a file that the in-game tool loads is a mirror without the bridge.
- So the shared contract is the setup format (the lighting setups' `LightingSetup`, versioned as `xfs/lighting-setup-1`) and the mapping (`mirror-map.ts`), not a shared mod.

## 3. Mapping

### 3.1 Coordinates

- **Studio frame:** Y up, V faces −Z, V's right = +X, metres from V's feet; each setup has a `focus` (the head the lights were placed about) ([lighting setups](#9-design-implications-for-the-lighting-setups-work)).
- **V's local game frame:** X right, Y forward, Z up. Studio (x, y, z) = local (x, −z, y), the same map as the Studio's mesh export and creator rig; both frames are right-handed [offline].
- **World placement** uses V's measured facing (`photo.subject` returns the photo-mode stand-in's forward vector and head slot), so no Euler or yaw-sign convention is assumed: position = origin + x·right + y·forward + z·up, with right = forward × up [offline]. Each spawned entity is oriented by the shortest rotation taking its +Y onto the light's axis (a spot's axis is its +Y [hypothesis until one light is placed in game]).
- **Anchor:** by default the whole setup moves so its focus lands on V's live head slot (a seated or leaning V is still lit where the Studio lit her); `feet` keeps the rig about V's feet exactly as authored, which suits the creator rig with V standing. Only V's yaw is followed, as CharLi does; V's photo-mode pitch and roll offsets are ignored.
- **Following:** photo mode moves V only when her placement attributes change, so the bridge compares the stand-in's transform each tick and re-places the lights when it moves (CharLi's loop).

### 3.2 Units, colour, cones, falloff, shadows

| Property | Rule | Why | Grade |
|---|---|---|---|
| Intensity (spot) | Lumens Φ = 4π·I (candela), `unit` lumen, `EV` 0 | The exact inverse of the Studio's default reading (Φ/4π), so the game gets what the Studio drew | [offline]; the engine's own lumen scale [hypothesis] |
| Native lights | A light that came from the game (the creator rig, or a read) keeps its lumens, falloff, radius, cone, softness, colour and shadow flags; a later Studio edit of its strength scales the lumens by the ratio | The engine converts its own values, so its conversion cancels | [offline] |
| Falloff | Decay 2 with range r → inverse square, radius r; decay 0 (no falloff) → linear, radius 20× the distance to the head, lumens raised by 1/(1 − d/r) so the head gets the Studio's value | The decoded engine forms ([creator lighting §2](../../knowledge/creator-lighting.md#how-the-engine-evaluates-these-lights)); linear has no 1/d² term | [source] forms; [offline] fit |
| Directional | A linear spot 2 m out along the light's direction, aimed at the head, the same illuminance at the head, cone covering head and shoulders | The game has no directional local light; linear falloff keeps it flat, and 2 m keeps it clear of nearby walls | [offline] |
| Colour | Linear RGB → 8-bit sRGB (inverse of the Studio's decode); temperature off | The creator rig's colours are sRGB 8-bit, decoded to linear by the Studio | [offline] |
| Cone | Outer full angle = 2 × half-angle; inner = outer × (1 − penumbra); softness 2 unless native | The Studio's "full" reading; 2 is the rig's usual softness | [hypothesis] |
| Shadows | Studio shadows on → local shadows and character contact shadows; source radius 0.1 m unless native | The creator rig's shadowing lights carry these flags | [hypothesis] for the look |
| Budget | At most 16 lights and 6 shadow casters: the weakest lights at the head are left out, shadows go to the strongest; each drop is reported | Performance; the Studio's own shadow budget is 6 | [offline] |

**Absolute brightness** is one global `strength_scale` (default 1), fitted per scene from a capture, because photo mode's exposure is automatic (§3.3).

### 3.3 What doesn't carry over, and how to make it recognisable anyway

| Studio | In photo mode | Handling |
|---|---|---|
| Room environment (image-based ambient and reflections) | The world's own sky, probes, GI and street lights, which the creator's box doesn't have | Reported in plain words. Options below |
| Backdrop (studio gradient or black) | The world | Options below |
| Exposure: ACES exposure, or the game display's fixed `k` | Automatic world exposure, photo mode's compensation (attribute 10, ±2.2) | `strength_scale` and the compensation, fitted once per scene; an optional exposure pin |
| Display: ACES, or the game's LogC3 LUT | The game's LUT (and any LUT Switcher effect active in photo mode), photo mode's contrast, highlights and colour balance | Compare in the Studio's **game** display; read and record photo mode's effect values; ReShade off |
| Depth of field, grain, aberration | Photo mode's own | Grain and aberration 0 (bridge keys); depth of field read, never written (it persists in saves with Photo Mode Ex) |
| The creator's fixed camera | The drone camera | `photo.frame` at a face framing with a narrow field of view |

**Recognisable anyway,** in order of cost:

1. **A dark scene.** An interior at night with its own lights off or far away, NPCs hidden (attribute 54), photo mode's own lights off. The spawned rig then dominates. Cheap; works today.
2. **"Isolate V" backdrop.** Spawn six black panels around V at a few metres (our own entity referencing the base-game black box mesh the creator uses, `base\items\quest\q110__misc\q110_black_box.mesh`, by path; no game data copied). It hides the world behind V, but world lights without shadows still shine through, and the location's probes and GI still add ambient, so it is less isolated than it looks [hypothesis].
3. **Pin the exposure.** ENV Tuner's technique: rewrite the environment's `ExposureAreaSettings` curves in memory to one value and restore them on clear and on the kill switch [installed technique; effect hypothesis]. Research-only, behind its own switch.
4. **Use the creator's own box.** The mirror's box exists in Night City about 195 m below Westbrook, inside a second black enclosure, with collision and no probes or GI in its cells ([creator lighting §1, §10](../../knowledge/creator-lighting.md#101-the-render-target-and-the-box)). Teleporting V there before opening photo mode (autonomy rank 8's teleport) would give the creator's surroundings exactly, and if the box's own rig is streamed and lit outside the creator scene, V would be lit by the real rig with nothing spawned. Whether its sectors stream and its lights are on outside the creator is unknown; a disposable save and the maintainer's approval first [hypothesis].

## 4. The reverse direction

| Source | Route | Grade | Phase |
|---|---|---|---|
| **Our own mirrored lights** | `lights.read {scope: "mirror"}` reads each component and transform back; `readingToStudio` returns the Studio light with its native values, so the round trip is exact and shows any clamping the engine applied | [offline] round trip | L2 |
| **Photo mode's three lights** | Catch the `gamePhotomodeLightObject` entities as they are created (Codeware's `Entity/Initialize` callback filtered by class, or a callback for `PhotomodeLightInitializedEvent` added to the light indicator controller), read their components and transforms, convert. The same read gives the slider-to-component table and where each light starts | [hypothesis] | L1 |
| **Other mods' lights near V** (CharLi, AMM, World Builder previews) | The same entity callback sees every entity created after the bridge loads; filter to light components within a radius of V. Generic: no per-mod code | [hypothesis] | L5 |
| **The world's lights around V** | Offline: V's world position from `photo.subject`, then the static light nodes (`worldStaticLightNode`) of the streaming sectors around it through the native archive reader, each converted like a read (lumens and falloff are native). The world's sky and probes stay out of reach; a capture can fit a room-strength stand-in | [hypothesis]; sector data [resource] ([world and streaming](../../knowledge/world-and-streaming.md)) | L5 |
| **A capture** | Light-only difference frames (light on minus off, the world paused) fitted to a light position, as the parity design's C7 plans | [hypothesis] | parity P4 |

Units other than lumen at EV 0 are refused with a plain reason until their scale is known.

## 5. Bridge design

### 5.1 Commands

All `write-photo` except the read; every write behind `allow_writes`, its class and the save lock, logged with its undo, as the bridge's other photo-mode writes are ([design §4](runtime-bridge-design.md#4-safety-model)).

| Command | Class | Input | Result and undo |
|---|---|---|---|
| `lights.mirror.apply` | write-photo | `setup` (`xfs/lighting-setup-1`: lights, focus, environment, backdrop, display, exposure); `anchor` `head` (default) or `feet`; `strength_scale` (0.01–100, default 1); `yaw_offset` (degrees, research); `photo_lights` `off` (default) or `keep`; `replace` (default true) | Per light: id, name, world position, entity id, the values given; `dropped` and `not_carried` in plain words; undo `lights.mirror.clear` plus the photo-mode lights' earlier state |
| `lights.mirror.update` | write-photo | `lights`: partial changes by id | Continuous values (colour, intensity, radius, cone angles, position, aim) change in place through the setters and a teleport; a change to a fixed value (falloff, softness, shadows, source radius) respawns that light (AMM's approach). Undo: the earlier values |
| `lights.mirror.clear` | write-photo | none | Every light with the mirror's tag removed; photo mode's lights put back as they were |
| `lights.read` | read | `scope`: `mirror`, `photo_mode` (L1), `near_v` with `radius_m` (L5) | Each light's component fields and world transform, and the same light in the Studio frame about V |

**Refusals, in plain words with one next step:** not in photo mode ("Open photo mode first"); Codeware missing or too old ("Mirroring lights needs Codeware 1.20 or newer: get it from its official releases page"; the bridge never installs it); over a limit (a light further than 20 m from V, more than 16 lights: applied with the rest and reported, never refused outright); writes off or paused, as for every write.

### 5.2 How the game side works

1. **The light host.** Our own `xf\lighting\xfs_light_host.ent`, an empty entity template, in a small plain archive (a new path, so no ArchiveXL needed), built from JSON by WolvenKit in the bridge's build as the live-pose carrier is.
2. **Spawning** (redscript, compiled only with Codeware present through `@if(ModuleExists("Codeware"))`, so the vanilla-only core stays as it is): `StaticEntitySystem.SpawnEntity` with the placement, tag `xfs_light_mirror`; on Codeware's `Entity/Initialize` callback for that entity, add a `gameLightComponent` with every field from the plan (World Builder's route). Static entities have no persistence fields, and the tag removes the group in one call (`DespawnTagged`).
3. **Following:** the plugin's Running tick asks the redscript layer to compare the stand-in's transform (the `photo.subject` catch) with the last one and teleport the lights when it moved.
4. **Cleanup:** photo mode closing, `lights.mirror.clear`, the kill switch (added to its restore list), an idle disconnect and the end of a scripted session all despawn the tag. Loading a save removes world entities in any case.
5. **Without Codeware** (fallback, only if the maintainer wants no Codeware dependency): the CET layer's `exEntitySpawner` with a few of our own templates (spot with and without shadows); unit, falloff and softness then fixed per template.
6. **Native spawning** from the plugin (the game spawner CET wraps) stays a later option; it needs address-library work and brings nothing the first two routes lack.

### 5.3 Safety

- **Attach-only.** The maintainer starts the game; nothing launches it.
- **Photo mode only.** Lights exist only while photo mode is open (the `write-photo` promise: gone when it closes). CharLi-style lights in normal play would be a separate decision (§8).
- **Never in saves.** Static entities carry no persistence; the save lock is held while mirrored lights exist; the first session checks that a save loaded afterwards has none.
- **Removable.** One tag, one call; the kill switch removes them before anything else it restores.
- **Bounded.** 16 lights, 6 shadow casters, positions within 20 m of V, intensities and radii capped, request size within the bridge's 64 KiB.
- **The user's setup is untouched.** Codeware is detected and reported, never installed or updated; photo mode's own lights and any pinned exposure are restored; no photo-mode setting that persists (depth of field, saved photo-mode presets) is written.
- **Test builds first.** The host archive and the commands ship in the -diagnostic and -writes packages; the distribution package waits for a maintainer decision.

### 5.4 The MCP tools and the Studio

- **MCP:** the catalogue adds `lights_mirror_apply`, `lights_mirror_update`, `lights_mirror_clear` and `lights_read` with JSON Schemas generated from the setup type, `write-photo` or `read` permission, and the undo note; everything else (plain errors, audit log, session lock) comes from the existing command API.
- **The Studio:** a typed action `lighting.mirrorToGame(setupId, options)` in the application layer, a bridge adapter behind a `gameBridge.lights` capability (available only when the bridge answers and reports photo mode), and in presentation a "Show in game" control from the component library (the UI component track builds it: idle, sending with progress, shown, refused with the plain reason and its one next step, and a *Live* toggle). Following the reactive-graph rule, the game is one more consumer of the view's lights node: *Live* links it so each edit streams as a `lights.mirror.update` (debounced), and unlinking stops the stream without removing the lights.

## 6. The first game-session test plan

**Before the session (agent side):** the L1 and L2 builds; a session script (`tools/sessions/`) with the steps below and a `restore` list that clears the mirror; the Studio's Character creator setup exported with native values; a disposable save at a dim interior at night.

**Player checklist:**

1. Profile: the -writes bridge package, Codeware 1.20 or newer, ReShade effects off, LUT mods and LUT Switcher state noted. Load the disposable save and stand V in a clear spot at the dim interior.
2. Say when V is in place; the script does the rest and stops at each *ask*.

| Step | What the script does | What it answers |
|---|---|---|
| T1 | `game.options.read`, `bridge.info` (Codeware version); `world.time.set` 02:00; `photo.open`; grain and aberration 0; look-at off; `photo.frame {target: face}` | Preflight record |
| T2 | `lights.read {scope: photo_mode}` with light 1 off, then on; then brightness 0/50/100, range 0/50/100, cone 30/90, hue 0/120 one at a time, reading after each | Where a photo-mode light starts; which component values the sliders produce |
| T3 | Photo-mode lights off. `lights.mirror.apply` one white spot, 1.2 m from the head, 30° to V's left, 20° up, no shadows; capture; `lights.read {scope: mirror}` | The axis and handedness conventions; read-back equals the plan |
| T4 | `lights.mirror.update` the same light's azimuth to 90°, 180°, 270° (capture each) | Following and the light sweep; placement relative to V |
| T5 | Shadows on (character contact and local), capture; softness 1 and 5, capture; inverse square and linear at the same head illuminance, capture | Shadow flags, softness and the two falloffs in photo mode |
| T6 | `lights.mirror.apply {setup: Character creator (native values), anchor: feet}` at yaw offsets 0° and +10°; photo-mode exposure 0, then −1 and +1; capture each | The creator rig on V in photo mode |
| T7 | `lights.mirror.clear` (capture: gone); apply again, `photo.exit` (gone); apply again, the kill switch (gone), Reconnect | Every cleanup path |
| T8 | Open the creator with `cc.open`, face page (`cc.page`), capture the same V; `cc.back` | The reference to compare T6 with |
| T9 (optional, if approved) | The isolate backdrop, and separately a teleport into the creator's box before T6 | §3.3 options 2 and 4 |
| T10 | Load the safety save; `lights.read {scope: mirror}` | Nothing persisted |

**Evidence, versioned:** each step writes a manifest (`xfb/lighting-mirror-1`) into the session report: the setup JSON and its SHA-256, the plan from `mirror-map.ts` with the build commit, `photo.subject`, `photo.state`, every `lights.read`, the settings digest, the Codeware, CET and bridge versions, and each capture's hash. Captures stay private and ignored; the numbers go into the test card's results.

**A successful mirror looks like this:**

- **Placement (T3–T4):** each light reads back within 1 cm and 1° of the plan relative to the stand-in, and its highlight and shadow fall where the plan puts them.
- **The creator rig (T6 against T8), by eye:** the key from low front-left lights V's left cheek and casts the nose's shadow up toward V's right inner eye; a cyan-white rim on V's left and a magenta rim behind V's right catch the hair edges; the shadowed cheek reads cyan from the floor fill ([creator lighting §12](../../knowledge/creator-lighting.md#12-calibration-against-a-matched-pair)).
- **The creator rig, measured:** after one exposure scalar, the forehead-relative region ratios within 10 % of the creator capture and hue within 5°, the [capture protocol](../../knowledge/creator-lighting.md#8-capture-protocol)'s first targets. The world adds light the box doesn't, so expect the shadowed regions to read brighter; T9 tests whether isolation closes that.
- **Cleanup (T7, T10):** no light with the mirror's tag remains after any path, and none after loading.

## 7. Phases and effort

| Phase | Scope | Where | Effort |
|---|---|---|---|
| L0 | The mapping and read-back arithmetic, tested | `tools/lighting/mirror-map.ts` | **Done** (this branch) |
| L1 | Read-only: `lights.read {scope: photo_mode}` (catch photo mode's light entities, read components and transforms), Codeware detection in `bridge.info`, self-test simulation | Bridge (redscript, plugin, tools) | S–M, 1–1.5 days |
| L2 | The light host archive, Codeware-guarded spawning with the component at assembly, `lights.mirror.apply/update/clear` and `lights.read {scope: mirror}`, following V, every cleanup path, catalogue and MCP, the session script | Bridge | M–L, 3–4 days |
| — | **First session** (§6) | Maintainer | about 30 minutes |
| L3 | The Studio side: typed action, capability and adapter; the "Show in game" component request; native values carried by the creator setup's forks | Studio (after the lighting setups merge) | M, 2 days |
| L4 | Fidelity: the strength scale and yaw fit from the session, the isolate backdrop, the exposure pin (research switch), the creator-box probe | Bridge, Studio tools | M, 2–3 days and a session |
| L5 | The reverse direction beyond our own lights: photo-mode and nearby lights into the Studio as a setup; the world's lights around V from the sectors | Studio, bridge | M (lights), L (world) |

L1–L3 give the first useful mirror: about 7–8 agent-days and one session.

## 8. Questions for the maintainer

| # | Question | Proposed default |
|---|---|---|
| 1 | Engine side in the bridge now, a player-facing in-game light editor later in Photo Mode Tools, sharing the setup format? | Yes |
| 2 | May the mirror depend on Codeware (World Builder's route: every light field settable), or must it work with CET alone (CharLi's route: a few fixed templates)? | Codeware, detected and never installed, with plain guidance when it's missing |
| 3 | Place the setup about V's live head, or about her feet as authored? | Head (feet for the creator rig test) |
| 4 | Switch photo mode's own three lights off while a mirror is shown (restored afterwards)? | Off |
| 5 | Mirrored lights only in photo mode, or also in normal play like CharLi? | Photo mode only |
| 6 | Which isolation to try first: a dark interior, the black backdrop, or a teleport into the creator's own box (disposable save)? | Dark interior; the box probe as an optional T9 if you agree |
| 7 | May a research switch pin exposure by rewriting the environment's exposure curves in memory (restored on clear and by the kill switch), -writes build only? | Yes, off by default |
| 8 | On-demand "Show in game" first, then a *Live* link that streams edits? | Yes, in that order |
| 9 | Keep the mirror to the test builds until the desktop app can host the bridge as an off-by-default capability? | Yes |

## 9. Design implications for the lighting setups work

The lighting setups branch (`claude/lighting-setups`, in flight) stores each light as a Three-style light: position, target, linear colour, candela or lux, half-angle, penumbra, decay and range. Two small additions keep a later mirror exact:

- **An optional `game` block per light** (lumens, falloff, radius, softness, full inner and outer angles, 8-bit colour, local and contact shadows, source radius, and the Studio strength at the time), filled when the Character creator built-in is forked. The creator rig's linear lights are drawn with their falloff folded into a head-distance intensity (decay 0), which can't be undone without it; with it, the fork mirrors in native values. The prototype's `NativeLight` type is the proposed shape.
- **The setup's `focus` is the anchor.** It already exists; keeping it meaningful for every setup (the head the lights were placed about) is what lets the mirror move a setup onto a posed V.

**The mirror is also a calibration instrument.** The same V under the same native rig, once on the creator screen and once in photo mode, separates what the rig does from what the creator's render target does (its exposure, its missing world light). That answers parts of creator lighting's open questions 1 and 9 without a render-proxy read.

## Related

[knowledge/photo-mode-lights.md](../../knowledge/photo-mode-lights.md) · [knowledge/photo-mode.md](../../knowledge/photo-mode.md) · [knowledge/creator-lighting.md](../../knowledge/creator-lighting.md) · [runtime bridge design](runtime-bridge-design.md) · [bridge autonomy](../backlog/bridge-autonomy.md) · [parity measurement](../authoring/game-parity-measurement.md) · [next sessions plan](next-sessions-plan.md)
