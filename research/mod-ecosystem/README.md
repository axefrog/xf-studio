# Installed mod ecosystem survey: triage

This is the first stage of a survey of the installed Cyberpunk 2077 mods in the reference Mod Organizer 2 instance (1,008 mod folders under `PATH_TO_MO2/mods/`). It sorts the mods by what they are, ranks the ones that change behaviour by their likely research value to XF Studio, aggregates their script hook points into a first extension-point table and conflict list, and proposes the batches for the deep-dive stage.

Everything here is **file-level evidence** [offline]: the scanner reads `meta.ini`, the mods' text files and two `modlist.txt` files. It never reads archives, never runs the game and never proves runtime behaviour. A hook listed here is a hook declared in a file; whether it compiles, loads, wins or works in game is for the deep dives and for in-game tests.

## Method

### The scanner

[`tools/mod_survey.py`](../../tools/mod_survey.py) walks each mod folder read-only and writes two JSON files:

```
python tools/mod_survey.py --mo2 PATH_TO_MO2 --out experiments/mod-ecosystem/generated
```

It takes the MO2 folder from `--mo2` or `XFS_RESOLVER_MO2_ROOT`, and profiles from `--profile` (default: the XF diagnostic profile `XF Studio diagnostic 2026-09-25` and the main play profile `2025 (again)`). The output names installed mods and profiles, so it goes to the ignored `experiments/mod-ecosystem/generated/` folder: `survey.json` (one record per mod) and `hooks.json` (the aggregated hook points, conflicts and `@addMethod` name collisions). A full run takes well under a minute and stays under 0.1 GB.

Per mod it records:

- **Identity:** folder name, Nexus id, version and install file from `meta.ini`. MO2's `meta.ini` has **no author field**, so the author is recorded only as evidenced: a script or readme header, a licence of the mod's own (not of a bundled library), a GitHub source link, a support link on the Nexus page (stored in `meta.ini`'s `nexusDescription`), or an existing entry in the [community credits](../../docs/community-credits.md). Namespaces and depot folders are leads, not attribution.
- **File counts by kind:** redscript `.reds` (and line counts), CET Lua split into the mod's own CET mods (a folder under `cyber_engine_tweaks/mods/` with its own `init.lua`) and data it drops into another mod's folder, RED4ext `.dll` under `red4ext/plugins`, `.asi`, TweakXL `.yaml`/`.yml`/`.tweak`, ArchiveXL `.xl` (with each file's top-level keys), `.archive`, input-loader XML under `r6/input`, localisation JSON, `.ini`, ReShade `.fx`, audio and CET SQLite files.
- **Content signals:** `.xl` files with `quest` or `journal` sections, `streaming` sections or `localization`; TweakXL top-level record prefixes and `$type`s, and whether they look like item or clothing records.
- **Framework use from file evidence:** Codeware, ArchiveXL, TweakXL, RedFileSystem, RedData, Mod Settings, Native Settings UI, Audioware, AMM and 0-Engine, from the imports and calls in scripts (the patterns are in the scanner).
- **Dependencies:** *evident* (from file evidence: `.reds` needs redscript, `.xl` ArchiveXL, and so on), *declared* (the mod's Nexus page links the framework's Nexus page; a page that lists its author's other mods can add a false entry here, so the tables below use evident dependencies only), *mentioned* (the framework's name appears in the page text) and **inter-mod edges**: which installed mod declares each redscript `module` a script `import`s (preferring a framework when another mod bundles copies of the framework's modules, as CustomHackingSystem bundles Codeware UI modules), which CET mod each `GetMod()` names, and which modules each mod probes with `ModuleExists()` (its optional soft dependencies).
- **Source and licence:** redscript and Lua are source; for a DLL, any GitHub link in its files or page. Licence files are listed with their paths, so a bundled library's licence (for example `tween/LICENSE.txt`) is not mistaken for the mod's.
- **Persistence and structure signals:** `persistent let` fields, `ScriptableSystem` and `ScriptableService` subclasses, and `native func` declarations.
- **Enablement** in each profile's `modlist.txt` (`+` enabled, `-` disabled, absent).
- **Hook points:** redscript `@wrapMethod`, `@replaceMethod`, `@addMethod`, `@addField`, `@replaceGlobal` and `@wrapConstructor` with the class and the member declared after the annotation (comments stripped first); CET `Override`, `Observe`, `ObserveBefore` and `ObserveAfter` calls with literal class and function names (a `;signature` suffix is dropped). Calls whose class or function is a variable are counted as unresolved (217 in this survey, mostly inside helper wrappers).
- **Bundled Lua libraries:** a Lua file name that appears in three or more mods (psiberx's `GameUI.lua` and `GameSession.lua` from CET Kit, a shared `interactionUI.lua`, `hud.lua` and others) is treated as a bundled library copy. Hooks found only in such copies are counted separately from the mod's own hooks, so "30 mods observe `PlayerPuppet.OnGameAttached`" can be split into mods that do it themselves and mods that carry a helper that does.

### Classification

Each mod gets one class, from file evidence first:

1. **Separator:** an MO2 `_separator` folder.
2. **XF first-party:** the project's own test, bridge and export mods (names starting `XF `); excluded from the ranking but kept in the hook scan.
3. **Name rule (fashion or hair, not checked further):** a triage shortcut. Mods whose names contain one of a list of creators known for fashion or hair only (matched loosely at a word start: nola dreamer, meluminary, atomiic, raenef, axellysse, veegee, phoebe, se7en, mayo, yusei, lebronze, beaniebby, cyb3r…, alliekat, limerence, xrx, rvc00n, kmkc, breezy, rosa) or whose titles match `.+Archive ?XL`, `Casual`, `CCXL`, `Dress` or `.+ Outfit` (case-insensitive) are classed as fashion or hair without deeper checks. This rule took 580 mods. Of those, only two carry scripts with hooks: **Bring Your Outfit** (a CET mod that reapplies V's own outfit in quests; three hooks) and **Multicolored Hair CCXL - Core - Resources** (one redscript wrap of `characterCreationBodyMorphMenu.GetSlotName`, which adds a second hair switcher to the creator). Both are noted in the ranking section; the other 35 scripted mods it caught are Virtual Atelier store registrations. Four photo-mode pose packs with "Archive XL" or "casual" in their titles also fall to this rule instead of the pose-pack class.
4. **Framework or library:** an installed framework the scanner recognises (ArchiveXL, TweakXL, Codeware, redscript, Mod Settings, Input Loader, RedFileSystem, RedData, Audioware, Native Settings UI, Appearance Menu Mod, Virtual Atelier, Equipment-EX), the Nexus category *Modders Resources*, or a mod whose modules or CET name at least two other installed mods import and whose name marks it as a core or framework.
5. **Functionality:** redscript, a CET mod of its own, a RED4ext plugin, input-loader XML or ArchiveXL quest or journal content; or TweakXL tweaks whose record prefixes go beyond item and pose additions (six tweak-only mods).
6. **Asset-only fashion or hair** (items, creator options, appearance archives, Virtual Atelier store shims whose only script is the store-registration `@addMethod`) and **asset or other visuals** (pose and expression packs, world locations built only with ArchiveXL streaming, AMM data add-ons, ReShade shaders, overwrite captures and other archives without scripts).

The heuristics are coarse on purpose; the deep dives re-check every mod they take. Known misfits: CET Lua with a variable hook target is not attributed; a redscript `import` of a module no installed mod declares (a mod not installed) is not an edge; the class names of redscript and CET hooks are compared as written, so a CET hook written with a native name that differs from the script name would count as a different function.

## What is installed

| Class | Mods | Enabled in the main profile | Enabled in the XF diagnostic profile |
|---|---|---|---|
| Asset-only fashion or hair | 738 (580 by the name rule, 119 by file evidence, 39 Virtual Atelier store shims) | 687 | 688 |
| Asset or other visuals | 120 (46 world locations, 42 pose or expression packs, 9 AMM add-ons, 1 ReShade pack, 1 overwrite capture, 21 other) | 112 | 112 |
| **Functionality** | **102** (96 scripted, 6 tweak-only) | 90 | 81 |
| Framework or library | 29 (15 code frameworks, 14 modders' asset resources) | 29 | 29 |
| XF first-party | 8 | 2 | 7 |
| Separator | 11 | — | — |
| **Total** | **1,008** | 920 | 917 |

149 mods carry redscript, 54 carry a CET mod of their own and 17 carry RED4ext plugins. Cyber Engine Tweaks and RED4ext themselves are not MO2 mods in this instance (no mod folder; they are installed in the game folder), so their Nexus ids (107 and 2380) come from the links other mods' pages make to them.

How many installed mods show file evidence of needing each framework (all classes):

| Framework | Mods | Of which functionality |
|---|---|---|
| ArchiveXL | 766 | 43 |
| TweakXL | 567 | 31 |
| redscript | 149 | 58 |
| Cyber Engine Tweaks | 82 | 49 |
| Codeware | 47 | 36 |
| Mod Settings | 35 | 28 |
| Appearance Menu Mod (as a data host or by `GetMod`) | 30 | 3 |
| RED4ext | 17 | 8 |
| Native Settings UI | 14 | 14 |
| Input Loader | 9 | 7 |
| RedData / RedFileSystem | 5 / 4 | 2 / 2 |

Observations worth carrying into the deep dives:

- **Persistence is concentrated.** Only 25 mods declare `persistent let` fields. ENV Tuner declares 369 of them (the largest by far, and a save-size question), then Codeware (211), Dark Future (39), Virtual Atelier Delivery (34), Night City Remembers (29), Eviction Notice and Shattered Chrome (24 each). File-backed state instead of save state appears through RedFileSystem (Street Sense, True First Person Camera 2.0, Redscript Configuration Framework) and CET SQLite databases (eight mods, including AMM, Character Rendering Editor and Appearance Creator Mod).
- **Soft dependencies are common.** 98 `ModuleExists()` probes across the scripted mods. DigitalVixen Core alone probes 16 modules of its suite and others; Dark Future probes six mods it adapts to; Street Sense probes Equipment-EX, Night City Remembers and others. That is a ready-made compatibility graph for the mod-management direction.
- **Store and registration patterns dominate `@addMethod`.** 74 mods add a method to `gameuiInGameMenuGameController` (Virtual Atelier's store-registration event), 17 add to `PlayerPuppet`. `@addField` is led by `PlayerPuppet` (18 mods) and `PlayerPuppetPS` (5).
- **The creator's own menu is almost untouched.** Only the XF Runtime Bridge (ten functions of `characterCreationBodyMorphMenu`), Multicolored Hair's core (`GetSlotName`) and Custom Level Cap (the stats and gender-selection menus) hook character-creation controllers. Photo mode, by contrast, is crowded (next section).
- **Two named exemplars are not both active.** Eviction Notice is enabled in both profiles; Dark Future is disabled in both (its sibling Consumable Animations, whose page says Dark Future users already have it, is also disabled).

## Ranked functionality

Ranked by likely research value to XF Studio: the character creator and appearance, photo mode and posing, facial expressions and animation, lighting and rendering, the world and interiors, NPCs and routines, quests and story, UI techniques, persistence and save state, input, performance, and mod management. Size of scripted behaviour, novelty and hook breadth count too. Code frameworks and libraries that behave like systems (AMM, Equipment-EX, 0-Engine and similar) are ranked alongside and marked "(library)"; core frameworks already studied as frameworks (ArchiveXL, TweakXL, Codeware, redscript, CET, RED4ext) are not ranked. "Enabled" is main profile / XF diagnostic profile. Frameworks are from file evidence (AXL ArchiveXL, TXL TweakXL, CW Codeware, CET, R4E RED4ext plugin, reds redscript, MS Mod Settings, NSUI Native Settings UI, IL Input Loader, RFS RedFileSystem, RD RedData, AMM, VA Virtual Atelier, EEX Equipment-EX, 0-E 0-Engine). "Batch" is the proposed deep-dive batch below; "—" means no deep dive planned.

Mods the name rule classed as fashion that would otherwise rank: **Multicolored Hair CCXL - Core - Resources** ([21613](https://www.nexusmods.com/cyberpunk2077/mods/21613), eagul per the provenance follow-ups) adds a second hair switcher to the creator through one wrap of `characterCreationBodyMorphMenu.GetSlotName`, worth a look in batch B4; **Bring Your Outfit** ([19279](https://www.nexusmods.com/cyberpunk2077/mods/19279)) is low value.

| Rank | Mod | Author as evidenced | Nexus | Frameworks | Enabled | Why it matters to XF | Batch |
|---|---|---|---|---|---|---|---|
| 1 | Dark Future - Urban Survival Gameplay | DarkFortuneTeller (GitHub source linked from its Nexus page) | [16300](https://www.nexusmods.com/cyberpunk2077/mods/16300) | AXL, CW, IL, MS, TXL, reds | off / off | Named exemplar of deep integration: 30k lines of redscript, 133 hooks, scriptable services, quest phases in a combined NG+ scope, journal, factories, input, 18-language onscreens and a mod-compat system; the model for a large, well-structured script mod. | B1 |
| 2 | Eviction Notice - Story-Driven Rent System | not evidenced (description presents it as a sibling of Dark Future) | [23187](https://www.nexusmods.com/cyberpunk2077/mods/23187) | AXL, CW, MS, TXL, reds | on / on | Named exemplar: rent and eviction told through 450+ phone messages, quest phases, journal, apartment-screen overrides, streaming changes and 24 persistent fields; world state driven by story. | B1 |
| 3 | Appearance Menu Mod (library) | MaximiliumM (existing credit) | [790](https://www.nexusmods.com/cyberpunk2077/mods/790) | AXL, CW, CET, TXL | on / on | Library used by 30 installed mods; spawning, appearance swaps, expressions, photo-mode posing, props and time/weather, all from 31k lines of CET Lua; partly studied, not end to end. | B3 |
| 4 | PhotoMode-EX | psiberx (licence, existing credit) | [18839](https://www.nexusmods.com/cyberpunk2077/mods/18839) | R4E, reds | on / on | RED4ext plugin that adds characters, appearance and look-at selectors and precise positioning to photo mode; the native side of photo-mode extension, with source and licence. | B3 |
| 5 | Photo Mode Pose Selector | cjsu (existing credit) | [32633](https://www.nexusmods.com/cyberpunk2077/mods/32633) | CET, R4E, reds | on / on | CET plus a small RED4ext bridge: searchable poses and expressions, per-character animation freezing and saved positions; closest to XF's pose and expression tooling. | B3 |
| 6 | Street Sense | DigitalVixen suite (existing credit) | [28989](https://www.nexusmods.com/cyberpunk2077/mods/28989) | CW, MS, RD, RFS, TXL, reds | on / off | Clothing- and context-driven NPC perception (9k lines, 74 hooks, RedFileSystem data files); the reaction layer an appearance-aware 'alive' feature needs. | B2 |
| 7 | Responsive NPCs | MisterChedda (existing credit) | [14800](https://www.nexusmods.com/cyberpunk2077/mods/14800) | AXL, MS, reds | on / on | Replaces three reaction-manager functions to make crowds react to V's clothing and nudity; the main conflict hub for NPC reactions. | B2 |
| 8 | ENV Tuner (Weather - Lighting - Vignette Adjustments without… | CyanideX (script namespace, existing credit) | [23079](https://www.nexusmods.com/cyberpunk2077/mods/23079) | CW, CET, reds | on / on | Real-time exposure, bloom, vignette and weather parameters from redscript plus CET (28k lines, 369 persistent fields); rendering controls and a save-state cost to measure. | B4 |
| 9 | Character Rendering Editor - Real-time Control on Skin Hair… | not evidenced | [32842](https://www.nexusmods.com/cyberpunk2077/mods/32842) | CET | on / on | Live skin, hair and eye rendering settings with vanilla values (CET, SQLite presets); directly relevant to preview fidelity and material RE. | B4 |
| 10 | Immersive Third Person - Best Of Both Worlds | cyberdrake (Ko-fi link on its Nexus page; see provenance follow-ups) | [32203](https://www.nexusmods.com/cyberpunk2077/mods/32203) | AXL, CW, CET, NSUI, R4E, TXL, reds | on / off | Three RED4ext plugins plus 14k lines of scripts: third-person camera, reworked female animations and 360-degree movement; animation and camera hooks at native depth. | B5 |
| 11 | World Builder | keanuWheeze (existing credit) | [20660](https://www.nexusmods.com/cyberpunk2077/mods/20660) | AMM, AXL, CW, CET, reds | on / on | In-game world authoring over all node types (23k lines of Lua); already studied for world knowledge, not yet for its UI, persistence and spawn techniques. | B6 |
| 12 | Native Interactions Framework | keanuWheeze (GitHub owner justarandomguyintheinternet) | [21422](https://www.nexusmods.com/cyberpunk2077/mods/21422) | AXL, CW, CET, reds | on / on | Places workspot interactions (sit, TV and 19 more) in the world from an in-game UI, with quest phases; how mods add usable places without scenes. | B5 |
| 13 | Lizzie's Braindances | not evidenced (provenance follow-up) | [11077](https://www.nexusmods.com/cyberpunk2077/mods/11077) | AXL, CW, TXL, reds | on / on | Voiced quest content with journal, quest phases, factories, streaming and overrides plus 11k lines of redscript; the richest quest-plus-script mod after Dark Future. | B1 |
| 14 | Immersive V Dialogue Expanded | skyrayfox (script header) | [24377](https://www.nexusmods.com/cyberpunk2077/mods/24377) | CET, NSUI, TXL | on / on | Plays 200+ of V's own base-game voice lines on gameplay events; voiceset and lip-sync routing from script, relevant to expressions and lip sync. | B2 |
| 15 | Consumable Animations | not evidenced | [26762](https://www.nexusmods.com/cyberpunk2077/mods/26762) | AXL, CW, IL, MS, TXL, reds | off / off | Item-in-hand consume animations through a quest phase and a scriptable service; a compact recipe for triggering body animation on V from script. | B5 |
| 16 | Stock Market and News System | keanuWheeze (support link on its Nexus page) | [6319](https://www.nexusmods.com/cyberpunk2077/mods/6319) | CET | on / on | 11k lines of CET: a computer app, news driven by quest facts and player actions, and persistent market state; 96 hooks, overrides computer and browser functions others wrap. | B1 |
| 17 | Equipment-EX (library) | psiberx (licence, existing credit) | [6945](https://www.nexusmods.com/cyberpunk2077/mods/6945) | AXL, CW, TXL, reds | on / on | Transmog with 50+ slots, its own UI and photo-mode hooks; already mined for clothing knowledge, worth a UI and persistence pass. | B8 |
| 18 | Hot-Sampled Photomode Renders (IGPT) | not evidenced | [26318](https://www.nexusmods.com/cyberpunk2077/mods/26318) | CW, IL, MS, R4E, reds | on / off | RED4ext plugin that renders photo-mode shots above screen resolution; relevant to capture quality for tests and to the render pipeline. | B3 |
| 19 | Virtual Atelier Delivery | not evidenced | [21482](https://www.nexusmods.com/cyberpunk2077/mods/21482) | AXL, CW, MS, TXL, reds | on / on | Deliveries to world drop points with SMS, journal, streaming, map pins and 34 persistent fields; a worked example of state spanning world, phone and time. | B1 |
| 20 | Night City Remembers | not evidenced | [29008](https://www.nexusmods.com/cyberpunk2077/mods/29008) | CW, MS, reds | on / on | Persistent faction memory (29 persistent fields) layered on NPC attitude; how long-lived world state is kept in saves. | B2 |
| 21 | 0-Engine (library) | not evidenced | [27967](https://www.nexusmods.com/cyberpunk2077/mods/27967) | CET | on / on | CET runtime layer: player lifecycle, PSM blackboard cache, zones, spatial hash and redscript-side NPC spawn filtering; directly informs the bridge's own state model. | B7 |
| 22 | Organic Hair | not evidenced | [21476](https://www.nexusmods.com/cyberpunk2077/mods/21476) | CET | on / on | CET suite over the engine's hair rendering settings; a check on the hair-shading knowledge page's parameters. | B4 |
| 23 | Shift (Dynamic First Person Camera) | not evidenced | [22340](https://www.nexusmods.com/cyberpunk2077/mods/22340) | CW, CET | on / on | 20k lines of CET camera control with 55 hooks; camera transforms and FOV at runtime. | B5 |
| 24 | True First Person Camera 2.0 | not evidenced | [30558](https://www.nexusmods.com/cyberpunk2077/mods/30558) | CW, RD, RFS, TXL, reds | off / off | 9.5k lines of redscript for a body-aware first-person camera, using RedData and RedFileSystem; a second, script-side camera design to compare with Shift. | B5 |
| 25 | Appearance Creator Mod | not evidenced | [10795](https://www.nexusmods.com/cyberpunk2077/mods/10795) | AMM, CET | on / on | Edits NPC appearances live (meshes, chunk masks, mesh appearances) and exports for AMM; in-game appearance assembly close to XF's resolver. | B4 |
| 26 | CharLi - Character Lighting Suite for Photomode | FreakaZ (+FlowerD) (existing credit) | [8176](https://www.nexusmods.com/cyberpunk2077/mods/8176) | CET | on / on | Spawned light rigs around V in photo mode; already studied for lights. | B3 |
| 27 | Deceptious Quest Core | Deceptious (the mod's own name) | [7831](https://www.nexusmods.com/cyberpunk2077/mods/7831) | AXL | on / on | A shared quest trigger in V's apartment so several quest mods start from one hook; quest-mod compatibility by design. | B6 |
| 28 | NightlyNow Core (library) | NightlyNow (the mod's own name) | [28966](https://www.nexusmods.com/cyberpunk2077/mods/28966) | AXL, CW, MS, reds | on / on | Phone messages, holocalls and tutorials for a suite of crime mods; message and phone UI techniques. | B1 |
| 29 | Drive an Aerial Vehicle - Flight Mod Using AV and Helicopter | tidusmd (script header) | [13842](https://www.nexusmods.com/cyberpunk2077/mods/13842) | AW, CW, CET, NSUI, R4E, TXL, reds | on / on | RED4ext plus 12k lines of CET and Audioware; vehicle physics, HUD and camera at scale. | B6 |
| 30 | Character Customization Anywhere | keanuWheeze (existing credit) | [3930](https://www.nexusmods.com/cyberpunk2077/mods/3930) | CET | on / on | Opens the creator anywhere via the pause-menu redirect the bridge now uses; overrides the same menu scenario the bridge wraps. | B4 |
| 31 | Customisable Photo Mode UI | not evidenced (existing credit, author not checked) | [32815](https://www.nexusmods.com/cyberpunk2077/mods/32815) | CW, MS, reds | on / on | Rescales and toggles photo-mode UI elements; widget-tree knowledge already partly used. | B3 |
| 32 | Photo Mode Preferences | cjsu (existing credit) | [32736](https://www.nexusmods.com/cyberpunk2077/mods/32736) | CET | on / on | Persists chosen photo-mode settings and reapplies them on open; how photo-mode state can be saved and restored. | B3 |
| 33 | Redscript Configuration Framework (library) | not evidenced | [30726](https://www.nexusmods.com/cyberpunk2077/mods/30726) | CW, IL, MS, RD, RFS, reds | on / on | Config UI, input and file-backed settings for redscript mods (RedData, RedFileSystem, Mod Settings); a persistence and settings pattern. | B7 |
| 34 | DigitalVixen Core (library) | DigitalVixen (the mod's own name) | [28390](https://www.nexusmods.com/cyberpunk2077/mods/28390) | CW, IL, MS, TXL, reds | on / on | Shared core for a mod suite: hotkeys, settings, 16 ModuleExists probes; the most explicit soft-dependency graph installed. | B2 |
| 35 | Combat Evolved | not evidenced (imports DigitalVixen Core) | [29125](https://www.nexusmods.com/cyberpunk2077/mods/29125) | CW, MS, TXL, reds | on / on | Per-faction AI personalities; replaces shooting functions also replaced by Immersive Shooting AI (a hard conflict). | B2 |
| 36 | Enemies of Night City | not evidenced | [8467](https://www.nexusmods.com/cyberpunk2077/mods/8467) | CET, NSUI, reds | off / off | 19k lines of CET for faction abilities and movesets; large NPC behaviour change from Lua. | B2 |
| 37 | Reinforcements System | not evidenced | [21532](https://www.nexusmods.com/cyberpunk2077/mods/21532) | MS, TXL, reds | on / on | NPCs call backup with phone icons over their heads; AI actions and prevention hooks. | B2 |
| 38 | Responsive V | MisterChedda (existing credit) | [22694](https://www.nexusmods.com/cyberpunk2077/mods/22694) | AXL, CW, MS, reds | on / on | V answers bumps and hits with unused voiceset lines; the voiced-reaction route already noted. | B2 |
| 39 | Sit Anywhere | keanuWheeze (support link on its Nexus page) | [7299](https://www.nexusmods.com/cyberpunk2077/mods/7299) | CET, NSUI | off / off | Places V into sit workspots on arbitrary geometry; body placement and workspots from CET. | B5 |
| 40 | Lean Anywhere | keanuWheeze (support link on its Nexus page) | [9938](https://www.nexusmods.com/cyberpunk2077/mods/9938) | CET, NSUI | off / off | Lean workspots on railings and barriers; pairs with Sit Anywhere. | B5 |
| 41 | Coffee maker and drink for other apartments | keanuWheeze (scripts, per its Nexus description) | [19609](https://www.nexusmods.com/cyberpunk2077/mods/19609) | AXL, CET | off / off | Interactive apartment props with streaming sectors and 132 hooks; also overrides the pause and mirror menu scenarios the bridge relies on. | B6 |
| 42 | E3 Smart Windows | keanuWheeze (support link on its Nexus page) | [7026](https://www.nexusmods.com/cyberpunk2077/mods/7026) | AXL, CET, reds | on / on | Adds a smart-window panel to apartments, linked to the Stock Market mod; interactive world UI. | B6 |
| 43 | Inside Station - Idiosyncratic | not evidenced (update of tidusmd's mod, per its description) | [19362](https://www.nexusmods.com/cyberpunk2077/mods/19362) | CET | on / on | Metro stations with proximity detection and teleport UI. | B6 |
| 44 | Inside The NCART Station - Opening Metro Platform | tidusmd (existing credit) | [15212](https://www.nexusmods.com/cyberpunk2077/mods/15212) | AXL, CET | on / on | Opens metro platforms with streaming changes and interaction UI. | B6 |
| 45 | Enhanced Air Traffic | not evidenced | [20208](https://www.nexusmods.com/cyberpunk2077/mods/20208) | AXL, CET, NSUI | on / on | Spawns 50 AVs with a quest phase and CET control; traffic spawning. | B6 |
| 46 | Sheng Noods Ramenshop | not evidenced | [25294](https://www.nexusmods.com/cyberpunk2077/mods/25294) | AMM, AXL, CET, TXL, reds | on / on | A small location with a scripted vendor and map pins; world-plus-script example. | B6 |
| 47 | VendorsXL (library) | not evidenced (Deceptious style, unconfirmed) | [19679](https://www.nexusmods.com/cyberpunk2077/mods/19679) | AXL, CW, TXL, reds | on / on | In-world vendors defined by TweakXL records (workspot, appearance, stock) with quest phases; data-driven NPC placement. | B6 |
| 48 | V's Faceplate (H10) | MisterChedda (existing credit) | [24599](https://www.nexusmods.com/cyberpunk2077/mods/24599) | AXL | off / off | Keeps V's faceplate in the apartment through a quest phase; already studied for skin on spawned objects. | B6 |
| 49 | Virtual Atelier (library) | DJ_Kovrik (existing credit) | [2987](https://www.nexusmods.com/cyberpunk2077/mods/2987) | AXL, CW, MS, reds | on / on | Store framework used by 74 installed store mods; studied. | B8 |
| 50 | Virtual Car Dealer | not evidenced | [4454](https://www.nexusmods.com/cyberpunk2077/mods/4454) | AXL, CW, TXL, reds | on / on | Vehicle store that discovers vehicle mods from their TweakXL records; data-driven discovery of other mods' content. | B8 |
| 51 | Browser Extension (library) | r457 and gh057 (existing credit) | [10038](https://www.nexusmods.com/cyberpunk2077/mods/10038) | MS, reds | on / on | Browser site registration; studied. | B8 |
| 52 | Revised Backpack | not evidenced | [17642](https://www.nexusmods.com/cyberpunk2077/mods/17642) | AXL, CW, IL, MS, reds | on / on | A new backpack screen with previews and tabs; custom inventory UI from redscript. | B8 |
| 53 | Cyberware-EX | psiberx (licence) | [9429](https://www.nexusmods.com/cyberpunk2077/mods/9429) | CW, TXL, reds | on / on | New cyberware slots and combinations; replaces several functions others wrap. | B8 |
| 54 | Immersive Timeskip | not evidenced | [5115](https://www.nexusmods.com/cyberpunk2077/mods/5115) | IL, MS, reds | on / on | Replaces the time-skip controller; five installed mods wrap the same functions, the clearest replace-versus-wrap hotspot. | B8 |
| 55 | Improved Vehicle Persistence | not evidenced | [12812](https://www.nexusmods.com/cyberpunk2077/mods/12812) | CET, reds | on / on | Keeps parked vehicles from despawning (14 persistent fields); world persistence. | B7 |
| 56 | Enhanced Craft | not evidenced | [4378](https://www.nexusmods.com/cyberpunk2077/mods/4378) | AXL, CW, IL, MS, TXL, reds | on / on | Crafting UI extensions with hotkeys and input XML. | B8 |
| 57 | Stash and Backpack Search | not evidenced | [14264](https://www.nexusmods.com/cyberpunk2077/mods/14264) | CW, reds | on / on | Text-input search in stash and backpack screens (Codeware text input). | B8 |
| 58 | Thread Locker | not evidenced | [28397](https://www.nexusmods.com/cyberpunk2077/mods/28397) | CW, MS, reds | on / off | Restricts wardrobe changes to in-world wardrobes; wraps a function Equipment-EX replaces. | B8 |
| 59 | Outfit Lock no More | thisfrontenddev (GitHub source link) | [15034](https://www.nexusmods.com/cyberpunk2077/mods/15034) | MS, reds | on / on | Removes quest outfit locks; wraps an Equipment-EX replacement. | B8 |
| 60 | Flesh And Chrome | not evidenced (imports DigitalVixen Core) | [27988](https://www.nexusmods.com/cyberpunk2077/mods/27988) | AXL, MS, TXL, reds | on / off | Fatigue and recovery system with a quest phase; body-state systems. | B9 |
| 61 | Injuries | not evidenced (imports DigitalVixen Core) | [30508](https://www.nexusmods.com/cyberpunk2077/mods/30508) | AXL, CW, MS, TXL, reds | on / on | Region-based injuries such as limping; possible link to body animation. | B9 |
| 62 | Shattered Chrome | DigitalVixen (per DigitalVixen Core's description) | [29105](https://www.nexusmods.com/cyberpunk2077/mods/29105) | AXL, CW, MS, TXL, reds | on / off | Cyberware wear and breakage. | B9 |
| 63 | Chrome Plating | DigitalVixen (per DigitalVixen Core's description) | [29101](https://www.nexusmods.com/cyberpunk2077/mods/29101) | CW, MS, reds | on / off | Armour rework. | B9 |
| 64 | Neuralware - Chipware Expansion | not evidenced | [19798](https://www.nexusmods.com/cyberpunk2077/mods/19798) | AXL, CW, CET, IL, MS, TXL, reds | on / on | Chipware items and limits (11k lines, 69 tweak files); replaces a function Cyberware-EX also replaces. | B9 |
| 65 | Immersive Cyberware | not evidenced | [21916](https://www.nexusmods.com/cyberpunk2077/mods/21916) | AXL, CW, CET, MS, TXL, reds | on / on | Locks UI behind cyberware lenses; UI gating. | B9 |
| 66 | LUT Switcher 2 (Custom Pack Support - LUT Adjustments - Hotkeys) | CyanideX (existing credit) | [16310](https://www.nexusmods.com/cyberpunk2077/mods/16310) | CET | on / on | Runtime LUT switching; already studied for grading. | B4 |
| 67 | Ultra Plus Best Performance and Visuals for Everyone | Ultra Team (licence, existing credit) | [10490](https://www.nexusmods.com/cyberpunk2077/mods/10490) | AXL, CET, R4E | on / off | Engine render and performance settings with a RED4ext tool; performance direction. | B4 |
| 68 | Hangout Romances | not evidenced | [18972](https://www.nexusmods.com/cyberpunk2077/mods/18972) | AXL, reds | on / on | Quest-phase romance hangouts. | B6 |
| 69 | Romance Hangouts Enhanced | not evidenced | [11590](https://www.nexusmods.com/cyberpunk2077/mods/11590) | AXL | on / on | Quest and journal changes to hangouts. | B6 |
| 70 | Roller Coaster Enhanced | not evidenced (provenance follow-up) | [14617](https://www.nexusmods.com/cyberpunk2077/mods/14617) | AXL | on / on | Companions on the roller coaster via quest content. | B6 |
| 71 | New Quest - Hot Fuzz | not evidenced | [7832](https://www.nexusmods.com/cyberpunk2077/mods/7832) | AXL, TXL | on / on | A cloned-and-altered quest built on Deceptious Quest Core. | B6 |
| 72 | New Quest - One More Light | not evidenced | [7834](https://www.nexusmods.com/cyberpunk2077/mods/7834) | AXL | on / on | A new quest reusing existing dialogue, on Deceptious Quest Core. | B6 |
| 73 | Underground Casino ( Working Roulette ) | not evidenced | [20280](https://www.nexusmods.com/cyberpunk2077/mods/20280) | AXL | on / on | Reopened casino interior with a quest phase. | — |
| 74 | Weeee (New H10 Exit) | not evidenced | [22334](https://www.nexusmods.com/cyberpunk2077/mods/22334) | AXL, CW, reds | on / on | A garbage-chute exit added to the megabuilding (streaming plus a service). | — |
| 75 | The Zenitex Military Store | CyanideX (per its Nexus description) | [21735](https://www.nexusmods.com/cyberpunk2077/mods/21735) | AXL, TXL | on / on | A physical store that auto-lists a suite's items; journal and quest content. | — |
| 76 | FreeFly (Noclip) | keanuWheeze (support link on its Nexus page) | [780](https://www.nexusmods.com/cyberpunk2077/mods/780) | CET, NSUI | on / on | Free camera flight; small but a useful camera tool for tests. | B7 |
| 77 | Inventory Zoom | keanuWheeze (support link on its Nexus page) | [4776](https://www.nexusmods.com/cyberpunk2077/mods/4776) | CET | on / on | Zooms the inventory puppet; relevant to the puppet preview. | B8 |
| 78 | Photo Mode Tools | not evidenced (existing credit) | [1560](https://www.nexusmods.com/cyberpunk2077/mods/1560) | CET | on / on | Look-at speed and hotkeys; already studied. | — |
| 79 | In-World Navigation | Jack Humbert (licence) | [4583](https://www.nexusmods.com/cyberpunk2077/mods/4583) | MS, R4E, reds | on / on | RED4ext-drawn in-world navigation paths. | B7 |
| 80 | Vehicle Navigation System (VNS) | Scream81 (script header) | [28241](https://www.nexusmods.com/cyberpunk2077/mods/28241) | CET, reds | on / on | A GPS dashboard on the vehicle HUD. | — |
| 81 | Custom Level Cap | not evidenced | [2909](https://www.nexusmods.com/cyberpunk2077/mods/2909) | CET, NSUI | on / on | Hooks character-creation stats menus; small. | — |
| 82 | Immersive First Person | not evidenced | [2675](https://www.nexusmods.com/cyberpunk2077/mods/2675) | CET | off / off | Free look and torso visibility in first person (CET). | B5 |
| 83 | Immersive First Person Camera - Extended | not evidenced | [27615](https://www.nexusmods.com/cyberpunk2077/mods/27615) | 0-E, CET, reds | off / off | Procedural first-person camera on 0-Engine; disabled in both profiles; overrides what TFPC 2.0 wraps. | — |
| 84 | Immersive Third Person - True Camera-Oriented Controls | not evidenced | [33789](https://www.nexusmods.com/cyberpunk2077/mods/33789) | CET, NSUI, reds | on / off | Superseded by ITP 1.3 per its own page. | — |
| 85 | Better Camera Auto 2.1 | not evidenced | [6889](https://www.nexusmods.com/cyberpunk2077/mods/6889) | CET, NSUI | on / on | Camera TweakDB values from CET. | — |
| 86 | CoolCam - Immersive Vehicle Cameras | not evidenced | [9443](https://www.nexusmods.com/cyberpunk2077/mods/9443) | CET | off / off | Vehicle camera values. | — |
| 87 | Playable Roulette - Gambling System | Boe6 (existing credit) | [15450](https://www.nexusmods.com/cyberpunk2077/mods/15450) | AXL, CW, CET | on / on | Animated roulette with physics; studied. | — |
| 88 | Playable Blackjack - Gambling System | Boe6 (existing credit) | [19575](https://www.nexusmods.com/cyberpunk2077/mods/19575) | AXL, CW, CET, NSUI | on / on | Card game with holographic UI; studied. | — |
| 89 | Pachinko Button - Gambling System | Boe6 (existing credit) | [19889](https://www.nexusmods.com/cyberpunk2077/mods/19889) | CW, CET, NSUI | on / on | Studied. | — |
| 90 | Northside Metro - Expanding New Stations and Route | tidusmd (existing credit) | [19487](https://www.nexusmods.com/cyberpunk2077/mods/19487) | AXL, CET | on / on | Metro route changes; studied. | — |
| 91 | Specialized Ripperdocs | not evidenced | [23399](https://www.nexusmods.com/cyberpunk2077/mods/23399) | CET | on / on | Ripperdoc stock rules including modded cyberware. | — |
| 92 | Ripperdoc Service Charge | not evidenced | [11200](https://www.nexusmods.com/cyberpunk2077/mods/11200) | AXL, CW, MS, TXL, reds | on / on | Charges for installation. | — |
| 93 | Ripperdoc Vendor UI Enhancements - Great for Ripperdoc Cyber… | not evidenced | [23180](https://www.nexusmods.com/cyberpunk2077/mods/23180) | MS, reds | on / on | Map tooltips for ripperdoc stock. | — |
| 94 | Sort Ripperdoc Inventory | not evidenced | [17630](https://www.nexusmods.com/cyberpunk2077/mods/17630) | MS, reds | on / on | Sorting. | — |
| 95 | Immersive Shooting AI | not evidenced | [22782](https://www.nexusmods.com/cyberpunk2077/mods/22782) | AXL, CW, TXL, reds | on / on | NPC firing cadence; hard conflict with Combat Evolved. | — |
| 96 | Fighting Gangs Allowed - Reasonable Police | not evidenced | [19189](https://www.nexusmods.com/cyberpunk2077/mods/19189) | reds | on / on | Replaces the hostility check Street Sense wraps. | — |
| 97 | Street Vendors | not evidenced | [2894](https://www.nexusmods.com/cyberpunk2077/mods/2894) | reds | on / on | Trade with street vendors. | — |
| 98 | Real Vendor Names | not evidenced | [4941](https://www.nexusmods.com/cyberpunk2077/mods/4941) | reds | on / on | Map tooltip names. | — |
| 99 | Hide Read Shards | not evidenced | [2820](https://www.nexusmods.com/cyberpunk2077/mods/2820) | reds | on / on | Hides read shards. | — |
| 100 | Vendor Search | Deceptious (Ko-fi name in its description) | [26188](https://www.nexusmods.com/cyberpunk2077/mods/26188) | CW, reds | on / on | Vendor-screen search. | — |
| 101 | Replace Weapon Mods | not evidenced | [15409](https://www.nexusmods.com/cyberpunk2077/mods/15409) | AXL, MS, reds | on / on | Replaces a function Equipment-EX wraps. | — |
| 102 | Immersive Stamina FX | v1ld (GitHub source link) | [4142](https://www.nexusmods.com/cyberpunk2077/mods/4142) | CET, NSUI, reds | on / on | Stamina effects. | — |
| 103 | Bug Fix - Base Fists and Arm Cyberware Attack Speed Fix | not evidenced | [14130](https://www.nexusmods.com/cyberpunk2077/mods/14130) | CET, reds | off / off | Melee fix. | — |
| 104 | Immersive Breathing | not evidenced | [9423](https://www.nexusmods.com/cyberpunk2077/mods/9423) | TXL | on / on | Tweak-only breathing effects. | — |
| 105 | Immersive Food Vendors | not evidenced | [7322](https://www.nexusmods.com/cyberpunk2077/mods/7322) | AXL, TXL | on / on | Tweak-only eating animation at vendors. | — |
| 106 | Fixed NPC Vehicle Reactions | not evidenced | [19530](https://www.nexusmods.com/cyberpunk2077/mods/19530) | TXL | on / on | Tweak-only reaction change. | — |
| 107 | Mantis Blade Sound FX | not evidenced | [19594](https://www.nexusmods.com/cyberpunk2077/mods/19594) | TXL | on / on | Tweak-only sound change. | — |
| 108 | Militech Sight Pack | not evidenced | [25490](https://www.nexusmods.com/cyberpunk2077/mods/25490) | AXL, TXL | on / on | Weapon parts with vendor records. | — |
| 109 | No More Out-Leveling Vendor Items | not evidenced | [12500](https://www.nexusmods.com/cyberpunk2077/mods/12500) | TXL | on / on | Vendor loot prerequisites. | — |
| 110 | CET Window Manager | not evidenced | [18448](https://www.nexusmods.com/cyberpunk2077/mods/18448) | CET, R4E | on / on | RED4ext plugin managing CET overlay windows. | B7 |
| 111 | Window Switcher (Taskbar - Groups - Utilities for CET) | not evidenced | [30005](https://www.nexusmods.com/cyberpunk2077/mods/30005) | CET | on / on | A taskbar for CET windows. | — |

## Extension points

The most-hooked game functions. "Mods (own)" counts mods whose own files hook the function; "Mods (all)" adds mods that carry a bundled library copy (such as CET Kit's `GameUI.lua`) that hooks it. "reds / CET" splits the own hooks by language. `@addMethod` and `@addField` are not hooks of an existing function and are left out (see the observations above). The full table (894 functions) is in `hooks.json`.

| Function | Mods (own) | Mods (all) | reds / CET | Mods replacing or overriding it |
|---|---|---|---|---|
| `PlayerPuppet.OnGameAttached` | 21 | 30 | 15 / 6 |  |
| `PlayerPuppet.OnAction` | 15 | 23 | 3 / 12 |  |
| `RadialWheelController.OnIsInMenuChanged` | 13 | 13 | 0 / 13 |  |
| `PlayerPuppet.OnDetach` | 10 | 10 | 9 / 1 |  |
| `WorldMapTooltipController.SetData` | 8 | 8 | 7 / 1 |  |
| `gameuiPhotoModeMenuController.OnShow` | 6 | 27 | 3 / 3 |  |
| `PhotoModePlayerEntityComponent.SetupInventory` | 6 | 6 | 4 / 2 |  |
| `PlayerPuppet.OnItemAddedToSlot` | 6 | 6 | 5 / 1 |  |
| `TimeskipGameController.OnInitialize` | 6 | 6 | 6 / 0 | 1 |
| `QuestTrackerGameController.OnInitialize` | 5 | 26 | 2 / 3 |  |
| `PlayerPuppet.OnStatusEffectApplied` | 5 | 24 | 5 / 0 |  |
| `MenuHubLogicController.OnInitialize` | 5 | 5 | 5 / 0 |  |
| `PlayerPuppet.OnItemRemovedFromSlot` | 5 | 5 | 5 / 0 |  |
| `VehicleObject.OnMountingEvent` | 5 | 5 | 4 / 1 |  |
| `gameuiPhotoModeMenuController.OnHide` | 4 | 25 | 1 / 3 |  |
| `BackpackMainGameController.OnInitialize` | 4 | 4 | 4 / 0 |  |
| `BrowserController.OnPageSpawned` | 4 | 4 | 3 / 1 |  |
| `BrowserGameController.OnUninitialize` | 4 | 4 | 3 / 1 |  |
| `HubTimeSkipController.OnTimeSkipButtonPressed` | 4 | 4 | 4 / 0 | 1 |
| `ItemTooltipBottomModule.NEW_Update` | 4 | 4 | 4 / 0 |  |
| `ItemTooltipHeaderController.NEW_Update` | 4 | 4 | 4 / 0 |  |
| `ItemTooltipHeaderController.Update` | 4 | 4 | 4 / 0 |  |
| `NPCPuppet.OnDeath` | 4 | 4 | 4 / 0 |  |
| `RadialWheelController.OnLateInit` | 4 | 4 | 4 / 0 |  |
| `ScriptedPuppet.OnDefeated` | 4 | 4 | 4 / 0 |  |
| `SingleplayerMenuGameController.OnInitialize` | 4 | 4 | 4 / 0 |  |
| `TimeskipGameController.OnUninitialize` | 4 | 4 | 4 / 0 | 1 |
| `VehicleObject.OnUnmountingEvent` | 4 | 4 | 4 / 0 |  |
| `gameuiInventoryGameController.OnInitialize` | 4 | 4 | 3 / 1 |  |
| `gameuiInventoryGameController.OnUninitialize` | 4 | 4 | 3 / 1 |  |

What the table says:

- **Lifecycle is the universal entry point.** `PlayerPuppet.OnGameAttached` (21 mods, 30 with bundled helpers) and `OnDetach` (10) are how mods start and stop their systems; 0-Engine's page argues for centralising exactly this, and the XF bridge wraps `OnGameAttached` too.
- **Input is still read by hooking `PlayerPuppet.OnAction`** (15 mods, 12 of them CET), rather than through registered input listeners.
- **"Am I in a menu?" is copied idiom.** 13 CET mods observe `RadialWheelController.OnIsInMenuChanged`; the photo-mode open and close events (`gameuiPhotoModeMenuController.OnShow`/`OnHide`) are observed by 27 and 25 mods, but 21 of those come from bundled `GameUI.lua` copies. Anything the XF bridge does on photo-mode entry shares that moment with every CET mod carrying CET Kit.
- **Map tooltips, time skip, the backpack, item tooltips and the browser** are the UI surfaces most mods extend (`WorldMapTooltipController.SetData` 8, `TimeskipGameController.OnInitialize` 6, tooltip `Update`/`NEW_Update` 4 each, browser controllers 4).

## Conflict list

Functions `@replaceMethod`'d by more than one mod, replaced by one and wrapped by others, or overridden from CET (`Override`) while others hook them. Whether each is a live problem depends on load order and on what each replacement does: [hypothesis] redscript applies wraps on top of whichever replacement wins, so a replace-plus-wrap usually still runs the wraps but loses the other replacement's behaviour; and a CET `Override` receives the original as its last argument and behaves like a wrap only if it calls it. Both need confirming from the redscript and CET sources in the deep dives, and every "live" row below needs an in-game check before it is called a bug. "Enabled" is main / XF diagnostic.

### Two replacements of the same function (at most one can take effect)

| Function | Mods (enabled) | Status in the profiles |
|---|---|---|
| `AISubActionShootWithWeapon_Record_Implementation.QueueFirstShot`, `.QueueNextShot`, `TargetShootComponent.ShouldBeHit` | Combat Evolved (on/on), Immersive Shooting AI (on/on) | Live in both profiles |
| `CyberwareInventoryMiniGrid.GetSlotToEquipe` | Cyberware-EX (on/on), Neuralware - Chipware Expansion (on/on) | Live in both profiles |
| `SingleCooldownManager.Update`, `inkCooldownGameController.RequestCooldownVisualization` | Dark Future (off/off), DigitalVixen Core (on/on) | Latent: would go live if Dark Future is enabled |

Two `@addMethod` name collisions (a redscript compile error if both load, [hypothesis]): `PlayerPuppet.OnFinalizeActivationTPPRepresentationEvent` and `OnFinalizeDeactivationTPPRepresentationEvent`, added by both Immersive First Person Camera - Extended and True First Person Camera 2.0 (both disabled in both profiles).

### Replaced by one mod, wrapped or observed by others

| Function | Replaced by | Also hooked by |
|---|---|---|
| `TimeskipGameController.OnInitialize`, `.OnUninitialize`, `HubTimeSkipController.OnTimeSkipButtonPressed` | Immersive Timeskip (on/on) | Dark Future (off/off), DigitalVixen Core, Injuries, Virtual Atelier Delivery (on/on), Flesh And Chrome, Shattered Chrome (on/off) |
| `ReactionManagerComponent.HandleStimEvent`, `.OnBumpEvent`, `.OnDetectedEvent` | Responsive NPCs (on/on) | Combat Evolved, Reinforcements System, Responsive V (on/on), Street Sense (on/off) |
| `AIActionHelper.TryChangingAttitudeToHostile` | Fighting Gangs Allowed - Reasonable Police (on/on) | Street Sense (on/off) |
| `EquipCycleInitEvents.OnEnter` | Immersive Third Person - Best Of Both Worlds (on/off) | Appearance Menu Mod (observe), True First Person Camera 2.0 (off/off) |
| `WardrobeUIGameController.OnInitialize` | Equipment-EX | Thread Locker (on/off) |
| `EquipmentSystemPlayerData.OnQuestDisableWardrobeSetRequest` | Equipment-EX | Outfit Lock no More |
| `InventoryItemModeLogicController.HandleItemClick` | Replace Weapon Mods | Equipment-EX |
| `TimeDilationFocusModeDecisions.EnterCondition` | Cyberware-EX | Immersive Cyberware |
| `healthbarWidgetGameController.IsCyberdeckEquipped` | Cyberware-EX | Neuralware - Chipware Expansion |
| `PlayerPuppet.ActivateIconicCyberware` | Cyberware-EX | Drive an Aerial Vehicle (CET `Override`, in its own `core.lua`) |

### CET `Override` overlaps

| Function | Overridden by | Also hooked by | Note |
|---|---|---|---|
| `InteractionUIBase.OnDialogsData`, `.OnDialogsSelectIndex`, `.OnInteractionData`, `dialogWidgetGameController.OnDialogsActivateHub` | 10 mods: the gambling trio, Sit and Lean Anywhere, Coffee maker, Immersive V Dialogue Expanded (each through a bundled `interactionUI.lua`), and Drive an Aerial Vehicle and both NCART station mods (through a bundled `hud.lua`) | — | The largest overlap: ten copies of two shared helpers overriding the same four dialogue-choice functions. Whether they chain safely is the first CET question for batch B6. |
| `MenuScenario_PauseMenu.OnEnterScenario` | Character Customization Anywhere (on/on), Coffee maker (off/off) | **XF Runtime Bridge** (wrap) | The pause-menu redirect the bridge also uses to open the creator. |
| `MenuScenario_CharacterCustomizationMirror.OnCCOPuppetReady` | Character Customization Anywhere, Coffee maker | — | Same creator route. |
| `CursorGameController.ProcessCursorContext` | Appearance Menu Mod (on/on) | **XF Runtime Bridge** (wrap) | Both hide the cursor in photo mode ([photo mode](../../knowledge/photo-mode.md)). |
| `SettingsCategoryController.Setup`, `SettingsSelectorControllerKeyBinding.Refresh` | Native Settings UI | Mod Settings | The two settings frameworks touch the same controllers. |
| `ComputerControllerPS.GetMenuButtonWidgets`, `ComputerInkGameController.ShowMenuByName`, `BrowserController.LoadWebPage`, `MessengerUtils.GetSimpleContactDataArray` | Stock Market and News System | Virtual Atelier, Virtual Car Dealer, Browser Extension, NightlyNow Core | Computer, browser and messenger surfaces. |
| `WarningMessageGameController.OnShown`, `.UpdateWidgets` | 0-Engine, Drive an Aerial Vehicle (both through a bundled `GameHUD.lua`) | Dark Future (off/off) | |
| `PocketRadio.HandleRestriction`, `.OnStatusEffectApplied` | Sit Anywhere, Lean Anywhere (both off/off) | — | |
| Six aiming and cover functions (`AimingStateEvents.*`, `ActivateCoverEvents.OnEnter`, `InactiveCoverEvents.OnEnter`, `CoverActionTransition.IsPlayerInCorrectStateToPeek`) and `FirstEquipSystem.HasPlayedFirstEquip` | Immersive First Person Camera - Extended (off/off); Shift (on/on) for `HasPlayedFirstEquip` | True First Person Camera 2.0 (off/off); Neuralware wraps `AimingStateEvents.OnEnter` | The first-person camera mods are mutually exclusive in practice; two of three are disabled. |

### Where the XF Runtime Bridge meets other mods

The bridge (enabled only in the XF diagnostic profile) wraps functions that many installed mods also hook: `PlayerPuppet.OnGameAttached` (29 other mods), `gameuiPhotoModeMenuController.OnShow`/`OnHide` (26 and 24 others), `PhotoModePlayerEntityComponent.SetupInventory` (AMM, CharLi, Codeware, Equipment-EX, Photo Mode Pose Selector), `gameuiPhotoModeMenuController.OnSetupOptionSelector`/`OnSetupScrollBar`/`OnAddMenuItem` (Photo Mode Pose Selector, Photo Mode Preferences, Equipment-EX), plus the two CET-overridden functions above. Its ten `characterCreationBodyMorphMenu` wraps are unshared. None is a replacement, but the two CET overrides mean the bridge's wraps run only if AMM's and Character Customization Anywhere's overrides call through; batch B3 and B4 should check that from their sources.

## Proposed deep-dive plan

Nine batches of five to eight mods, grouped by theme, in priority order. Each batch is one agent with a bounded scope, reading the installed files read-only, with the upstream source where a mod publishes it (Dark Future, the psiberx mods, keanuWheeze's, Ultra+ and others link GitHub). Findings go into the knowledge pages named per batch; mods that teach something get their credit in the same checkpoint.

| Batch | Theme | Mods | Knowledge pages to feed |
|---|---|---|---|
| **B1** | Story-driven systems and world state | Dark Future, Eviction Notice, Lizzie's Braindances, Stock Market and News System, Virtual Atelier Delivery, NightlyNow Core | [save files](../../knowledge/save-files.md), [terminals and arcade](../../knowledge/terminals-and-arcade.md), [world and streaming](../../knowledge/world-and-streaming.md); a new page on quest phases and journal content from mods |
| **B2** | NPCs, reactions and voice | Street Sense, Responsive NPCs, Responsive V, Immersive V Dialogue Expanded, Night City Remembers, Combat Evolved, Reinforcements System, Enemies of Night City (plus DigitalVixen Core as the suite's hub) | [NPC reactions](../../knowledge/npc-reactions.md), [lip sync](../../knowledge/lipsync.md), [facial expressions](../../knowledge/facial-expressions.md) |
| **B3** | Photo mode, posing and capture | PhotoMode-EX, Photo Mode Pose Selector, Photo Mode Preferences, Hot-Sampled Photomode Renders (IGPT), Customisable Photo Mode UI, Appearance Menu Mod (photo-mode and expression side), CharLi | [photo mode](../../knowledge/photo-mode.md), [poses](../../knowledge/poses.md), [photo-mode lights](../../knowledge/photo-mode-lights.md) |
| **B4** | Rendering and appearance at runtime | ENV Tuner, Character Rendering Editor, Organic Hair, Appearance Creator Mod, Character Customization Anywhere, Multicolored Hair CCXL core, LUT Switcher 2, Ultra+ | [materials and shaders](../../knowledge/materials-and-shaders.md), [hair shading](../../knowledge/hair-shading.md), [creator lighting](../../knowledge/creator-lighting.md), [CC file chain](../../knowledge/cc-file-chain.md) |
| **B5** | Body animation, workspots and cameras | Immersive Third Person - Best Of Both Worlds, Consumable Animations, Native Interactions Framework, Sit Anywhere, Lean Anywhere, Shift, True First Person Camera 2.0, Immersive First Person | [body animation](../../knowledge/body-animation.md), [poses](../../knowledge/poses.md) |
| **B6** | World interactives and quest content without scripts | World Builder (UI, persistence, spawning), Deceptious Quest Core with Hot Fuzz and One More Light, VendorsXL, V's Faceplate, Coffee maker, E3 Smart Windows, Drive an Aerial Vehicle (and the NCART station mods for the shared `hud.lua`) | [world and streaming](../../knowledge/world-and-streaming.md), [skin on spawned objects](../../knowledge/skin-on-spawned-objects.md) |
| **B7** | Runtime infrastructure: lifecycle, settings, persistence, input | 0-Engine, Redscript Configuration Framework, Mod Settings, Native Settings UI, Input Loader, RedFileSystem and RedData, CET Window Manager, Improved Vehicle Persistence | [runtime access](../../knowledge/runtime-access.md), [save files](../../knowledge/save-files.md) |
| **B8** | Inventory, equipment and menu UI techniques | Equipment-EX, Cyberware-EX, Revised Backpack, Stash and Backpack Search, Virtual Car Dealer, Immersive Timeskip, Thread Locker, Inventory Zoom | [clothing](../../knowledge/clothing.md), [body animation](../../knowledge/body-animation.md) (inventory puppet) |
| **B9** (optional) | Body-state gameplay systems | Flesh And Chrome, Injuries, Shattered Chrome, Chrome Plating, Neuralware - Chipware Expansion, Immersive Cyberware | Only if B2 or B5 show a use for body state (injury limps, fatigue) in the "alive" direction |

### The checklist every deep dive answers

For each mod in its batch, the deep-dive agent writes a short section that answers:

1. **How it works:** the moving parts, from entry point to effect.
2. **Hook points:** every wrap, replace, add, observe and override, with what it changes and why; cross-check this triage's list.
3. **Data and records added:** TweakDB records, ArchiveXL resources, quest phases, journal entries, localisation, factories.
4. **State and persistence:** what it keeps, where (persistent fields, scriptable systems, files, SQLite, facts), and what survives a save, a reload and an uninstall.
5. **UI technique:** how it builds or changes screens (ink widgets, Codeware controllers, CET ImGui, reused game controllers).
6. **Undocumented engine knowledge:** anything it relies on that the Modding Docs and our knowledge pages don't say.
7. **Novelty:** what it does that no other installed mod does.
8. **Bugs, fragility and conflicts:** assume it may be wrong. Check its conflicts from this list, version assumptions, error handling and what breaks on a game patch.
9. **Performance:** per-frame work, polling, hook cost on hot paths (for example `OnAction` or `OnGameAttached`), load-time cost.
10. **Licence:** whether it can only be learned from, or also reused, and on what terms.
11. **Relevance to the XF roadmap:** which direction it serves and how.
12. **Conflicts with XF's own mods or the bridge:** shared hooks (see above), shared records or resources.
13. **What to adopt or avoid:** concrete recommendations.

## Evidence limits

- All of this is offline, file-level evidence from one MO2 instance on 29 September 2026 (the scan date); versions are those in each `meta.ini`. Nothing here was checked in game.
- The name rule classes 580 mods without looking at their files beyond what the hook scan reads; the hook scan still covers them.
- Author columns are incomplete by design; no name is guessed. Unresolved authors of mods a deep dive learns from go on the [provenance follow-ups](../provenance-followups.md).
- This triage is an inventory, so it adds no [community credits](../../docs/community-credits.md) of its own; the deep dives credit what they learn.

## Related pages

- [Runtime access](../../knowledge/runtime-access.md) and the [runtime bridge design](../runtime/runtime-bridge-design.md)
- [Mod loading](../../knowledge/mod-loading.md)
- [World and interactive ideas](../backlog/world-and-interactive-ideas.md), where Dark Future and Eviction Notice were first noted as integration sources
- [Alive ideas](../backlog/alive-ideas.md)
