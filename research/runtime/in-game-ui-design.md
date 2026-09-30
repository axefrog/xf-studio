# In-game UI: route map and first demos

**Status:** research and design, 29 September 2026. Three demos are built into the XF Runtime Bridge 0.5.3 as **temporary test features** and tested offline only; nothing here has been seen in game. The facts, sources and grades behind every route are in [the ink knowledge page](../../knowledge/ink-ui.md); this page decides routes, orders the work and names the in-game proofs. The ambition list it maps is the coordinator's register `research/backlog/in-game-possibilities.md` (entry numbers below are its numbers).

## Principles

- **The engine's own UI (ink) for anything the player sees**, in the game's own font family and colour tokens (bound to `main_colors.inkstyle`, not copied values), so XF features look and behave like the game. An own ImGui overlay is for development tools only (§5).
- **Our own routes, never another mod's screens.** XF UI hangs under the game's layers or its own controllers, wraps vanilla functions (call the game first, then add), and names every widget `xfs_…` so it can be found, replaced and removed. Where installed mods replace a function we wrap (Mod Settings' pause menu, Equipment-EX's inventory), the wrap composes on top.
- **Pull, don't push, across the plugin boundary.** Script UI reads plugin state through natives that only read bookkeeping (the demos' `XFBridge_Hud`); the plugin calls into scripts only for commands, through the game gate ([game crashes §2.3](../../knowledge/game-crashes.md#23-calling-scripts-while-a-save-loads)). Script UI touches world systems only while the gate reports a live session.
- **Every UI object has an owner and a teardown**: a scriptable system of the session, a screen's controller, or a widget's own animation; delay callbacks and listeners are released in `OnDetach`/`OnUninitialize`.
- **Temporary test features are marked in code and docs** and stay in the bridge until XF Core's plugin split ([XF Core architecture](xf-core-architecture.md)), where UI moves to the plugin that owns the feature.

## Route map

Legend for the route: **HUD** (widgets under the HUD layer's root), **Menu** (a wrapped screen or an own menu scenario), **Proj** (world-anchored screen-space projection), **WW** (world widget component, render-to-texture on a mesh), **Pin** (mappin system), **Prev** (a UI preview scene's puppet), **Journal** (journal resources through ArchiveXL), **Native** (a RED4ext hook), **CET** (Cyber Engine Tweaks overlay, development only).

| # | Ambition | Route | First proof (session) | Unknowns first |
|---|---|---|---|---|
| 1 | XF HUD panel | HUD (Codeware `inkHUDLayer` → `Root`) | **Built: Demo A** (session 7) | root units; tick while hidden; layer visibility in photo mode |
| 2 | World-space labels | Proj now; WW for true in-world plates | **Built: Demo B** (Proj) | ProjectPoint's space; lag; the WW route (below) |
| 3 | Own map pins and markers | Pin + `UpdateIcon` wraps; quest markers need Journal | **Built: Demo C** | which controller draws each variant; load clears |
| 4 | Holographic V damage display | Prev (paperdoll puppet appearance per limb) or an ink vector body (HUD) | appearance switch on the inventory puppet only | preview-only change; hologram material on V's meshes |
| 5 | A phone app | Menu: wrap `NewHudPhoneGameController` contact list; messages as Journal | an XF contact that opens an ink page | phone state is quest-driven |
| 6 | Terminal program | WW on the apartment computer: a computer tab (as Virtual Car Dealer adds one) | an XF tab on V's apartment computer ([terminals](../../knowledge/terminals-and-arcade.md#7-what-is-possible-inside-a-page-or-terminal)) | tab registration without Browser Extension |
| 7 | Creator widgets | Menu: wraps of `characterCreationBodyMorphMenu` setup, widgets under its root | an XF strip showing the bridge's `cc.apply` state | CCXL and CCA hook the same menu |
| 8 | Own menu from the pause menu | Menu: wrap `PauseMenuGameController.PopulateMenuItemList` (+ `AddMenuItem`), `@addMethod(MenuScenario_PauseMenu) cb OnXF…` switching to an XF menu (a `.inkwidget` or a script-built full-screen canvas on the menu layer) | an "XF" pause-menu item that opens an empty XF screen and returns | a menu of our own needs a menu name the scenario can switch to; the lighter route is a full-screen popup on the notifications layer (Codeware `InMenuPopup`) |
| 9 | Radial wheel of quick actions | Menu: the radial menu (`RadialMenuHubGameController`, `RadialWheelController`) or an own ink radial on the notifications layer with an Input Loader action | own radial first (no vanilla wheel changes) | input capture without opening a menu |
| 10 | Diegetic optics UI | HUD, styled as the scanner (`scannerGameController`, `scannerBorderGameController`), shown with the scanner's own state | an XF readout that appears only while scanning | scanner blackboard states |
| 11-13 | Camera and studio | not UI; the bridge's photo and world commands | — | — |
| 14-15 | Live face and posing gizmos | Proj for gizmo handles (joints projected like nameplates), input through an interact mode (§5) | joint dots over V in photo mode | per-frame cost of 71 projections |
| 17-18 | NPC reactions, actors | not UI; labels over actors reuse Proj | — | — |
| 22 | Working arcade, own TV channel | WW (arcade screens, `inkVideo` for a channel) | [terminals §8](../../knowledge/terminals-and-arcade.md#8-arcade-cabinets) | Bink encoding of our own video |
| 23 | Micro-quest (message, pin, objective, reward) | Journal (quest, objective and message entries through ArchiveXL) + Pin for the marker | a phone message with a pin | journal entries' runtime activation from script |
| 24 | Own dialogue choices | the interaction hub (`InteractionUIBase`, `dialogWidgetGameController`), as ten installed CET mods override it through shared helpers | read-only first: log what the hub receives | the ten-mod overlap ([conflict list](../mod-ecosystem/README.md#conflict-list)) |
| 25, 40 | Per-limb damage as gameplay | HUD readout + Prev display; the mechanic is stat pools and status effects | — | — |
| 28-30 | Recorder, director assistant, note hotkey | HUD status line (Demo A's panel) + Input Loader hotkey | the note hotkey writing to the bridge log with a panel line | — |
| 31 | XF mod manager | Studio, not in game | — | — |
| 33, 36 | Enterable venues, reactive media | WW for screens and ads (TweakXL advert records point at our `.inkwidget`, as Virtual Atelier Delivery does) | an XF billboard | — |
| 37, 44 | Careers, photography jobs | Journal + Pin + phone messages; HUD for job timers | — | — |
| 43 | Braindances | the braindance editor's HUD (`BraindanceGameController`) and scene tools | read-only study first | — |

Entries not named are engine-side rather than UI (camera, world, AI); their UI needs reduce to the HUD panel, pins and projected labels built here.

## The three demos (bridge 0.5.3)

### Demo A: the XF HUD panel

- **What:** a dark translucent panel with a thin red edge, a state diamond, "XF RUNTIME BRIDGE" in the HUD's red, a status line in the state's colour (read-only green, changes allowed or paused yellow, killed red, off grey) and up to four `ui.message` lines coloured by level (info cyan, ask yellow, warn active red, done green); top right by default.
- **How:** `XFRuntimeBridgeInk.reds`. A scriptable system (`XFInkOverlay`) mounts after the player attaches, retrying once a second for up to 30 s, on the layer the plugin's frame names; it removes any earlier `xfs_overlay` it finds there, builds the widgets in script and ticks from a looping animation on a hidden 1×1 widget (about 30 Hz). Every sixth tick it reads `XFBridge_Hud()`, whose tab-separated frame (`core/InkUi.cpp`) carries the panel settings, the bridge's state, the script gate and the message lines. The overlay is 2160 units high and scaled uniformly by the screen's height.
- **Control:** `ui.hud` (notify class, so read-only sessions can use it): `show`, `anchor`, `x`, `y`, `scale`, `layer` (`hud`, `notifications`, `top`), `nameplates`, `cet_label`, `reset`; its undo is the earlier settings. `[ui] hud_panel`, `cet_label` and `nameplates` in `config.ini` set the start. The CET label hides when `cet_label` is off, except when the bridge is stopped (its panel's Reconnect lives there).
- **Safety:** the plugin never calls the overlay. A disabled bridge's frame hides the panel; a killed one shows the stopped state and no messages.

### Demo B: pedestal nameplates

- **What:** each spawned showroom head's number and preset name at the front of its pedestal (the column's front face, 1.35 m above the entity's origin), shrinking with distance from 3 m and fading out between 10 and 15 m.
- **How:** the same tick projects each head's plate point with `CameraSystem.ProjectPoint`, detecting the screen space from a point ahead of the camera as `photo.frame` does; heads come from the showroom's registry and Codeware's static entity system; nothing is spawned for the labels, so they appear and vanish with the heads. World queries run only while the frame says `live 1` (the script gate open).
- **Limits:** the labels are screen-space: no occlusion by the head or other geometry, and at most one tick behind a moving camera. They draw in the overlay's layer, so on the HUD layer they hide in photo mode; `ui.hud {layer: "top"}` is the test of the alternative.

#### World-space panels

The next step to true in-world labels is a **world widget component** (render-to-texture, [knowledge §5.1](../../knowledge/ink-ui.md#51-render-to-texture-on-a-surface-terminals-screens-holograms)):

1. **Template route (preferred, deterministic):** the showroom build adds to `xfs_showroom.ent` a small plate mesh (a quad on the column's front, UV 0-1) with the game's UI material and a `worlduiWidgetComponent` naming a one-item `.inkwidget` (a text on a canvas) and binding to that mesh; the bridge finds the component on the spawned entity and sets its text through `GetGameController()`/`GetWidget()`. This is an XF Studio authoring change (the showroom build), not a bridge change.
2. **Assembly route (no archive change):** Codeware's `Entity/Assemble` callback adds the component with a vanilla library while the entity assembles. No mod was found doing this for a world widget; one test decides it.

Test plan (one session, after the template build): spawn one head; expect the plate's text readable at 1 m and 3 m, lit like a screen (emissive), occluded by the head from behind; change the text through the bridge; clear and reload with nothing left.

### Demo C: XF map pins

- **What:** `world.pin` places a pin at a world point, above a showroom head (bound to the head's entity, so it follows it) or above where V stands, with a label (1-48 characters) and an allowlisted variant (`custom`, `apartment`, `clothes`, `default`; never `FastTravelVariant`, which the world map treats as a fast-travel point). At most 8. `world.pin.clear` removes one or all; the kill switch removes all; loading a save removes them with the session.
- **How:** `XFRuntimeBridgePins.reds`: `MappinSystem.RegisterMappin(WithObject)` with `Mappins.DefaultStaticMappin`, `visibleThroughWalls`, the label as the data's caption; a session registry keyed by `NewMappinID`. Wraps of `UpdateIcon` on the world map's, the in-world (`QuestMappinController`, `GameplayMappinController`) and the minimap's pin controllers fade the variant icon and add an ink-drawn XF badge (a cyan diamond with "XF", the label under it on the map and in the world); the world map's tooltip gets the label as its title. A controller reused for another mappin loses the badge.
- **Class:** `write-world` (the -writes build lists it), with the save lock like every change.

## An XF overlay: ImGui or ink

| | Own ImGui host (native) | Ink interact layer (engine UI) |
|---|---|---|
| Look | tool-like, not the game's | the game's own |
| Drawing | a chained hook on the engine's present (`GpuApi::Present`, where CET draws), on the engine's direct queue; before ReShade and frame generation, which may tint, ghost or drop its pixels | the top ink layer, drawn by the engine |
| Input | window-procedure subclass swallowing only the mouse's Raw Input in a hotkey interact mode (default F10), the engine's cursor, keyboard left to the game, yielding while CET's overlay is open | make `inkWatermarksLayer` interactive with the game's cursor (as Red Hot Tools does), hotkey from Input Loader or the bridge |
| Cost | about two weeks in three stages (draw-only, interact mode, HDR renderer and kit), a session after each of the first two; crash risk in the render path, contained by refusal gates | about three days (layer toggling in the plugin, widgets in script); lower risk |
| Use | development tools (live-pose gizmos, graphs) | player-facing and development panels |

Recommendation: try the ink interact layer first for anything player-facing (it also answers the demos' open layer questions). The ImGui host is feasible and is the recommended route for dense development tools; its architecture, first prototype and test card are in [ImGui overlay feasibility](imgui-overlay-feasibility.md), and its draw-only first stage is small enough to run beside the ink work. Both belong in XF Core ([XF Core architecture](xf-core-architecture.md)), not in feature plugins.

## Session-7 proofs

The checks are on the [test card](runtime-bridge-test-card.md#ink-demo-rows-bridge-053). What they settle: the HUD root's units and the panel's look against the game's HUD (captures), whether the tick runs while hidden, which layers show in photo mode, ProjectPoint's space and the nameplates' lag, which pin controller draws each view and where the badge sits, and that load and the kill switch leave nothing.

## Order after the session

1. Fix what session 7 finds in the three demos; record the answers in the knowledge page.
2. The ink interact layer (§5) with one XF menu (entry 8), which every later panel reuses.
3. Pedestal plates as world widgets through the showroom build (template route).
4. A micro-quest (entry 23): phone message, journal objective, pin.
5. The paperdoll hologram probe (entry 4).
