# Community credits

XF Studio stands on the work of the Cyberpunk 2077 modding community: the people who build its frameworks and tools, document the game's inner workings, and share their mods and techniques. Much of what we know came from studying their work, and we are grateful to every one of them.

Credit here acknowledges what we learned or used. It does not imply endorsement by the people named, nor permission to reuse their work; where we use or depend on something, the entry says so.

## Contents

1. [Game developer](#game-developer)
2. [Frameworks and core mods](#frameworks-and-core-mods)
3. [Modding tools](#modding-tools)
4. [Libraries, runtimes and general tools](#libraries-runtimes-and-general-tools)
5. [Documentation and community knowledge](#documentation-and-community-knowledge)
6. [Mods and creators whose work we studied](#mods-and-creators-whose-work-we-studied)
7. [Story and game design](#story-and-game-design)
8. [Research papers](#research-papers)
9. [Reference imagery](#reference-imagery)
10. [Community members we are still identifying](#community-members-we-are-still-identifying)

## Game developer

### CD PROJEKT RED

Developer of Cyberpunk 2077. The game's own resources, shaders, rigs, animation and materials are the ground truth for nearly everything we study. Their article [A World Full of Substance](https://magazine.substance3d.com/cyberpunk-2077-a-world-full-of-substance/) explained the shared-surface and mask approach behind the game's materials, and their [modding support](https://www.cyberpunk.net/en/modding-support) and [technical support](https://support.cdprojektred.com/en/cyberpunk/pc) pages, which name the Steam, GOG and Epic Games Store editions, set the stores XF Studio looks for. The TweakDB sources that ship with the game's REDmod tools showed how photo mode's expressions, poses and lists are defined. The address library they ship with the game for native mods, which gives every engine function a stable ID, let us trace and name, without any signature scanning, the whole path from a material template through the shader cache to a GPU pipeline state. Game content is used only as a private local reference for the preview and experiments; none is redistributed. On quest design, Paweł Sasko's GDC 2023 talk, summarised by [Game Developer](https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3), taught us to bring early choices back later with visible consequences and to separate signal from noise. Philipp Weber's [interview with Game World Observer](https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077) (2019) describes Street Stories as small encounters with several ways through, in a studio that avoids sorting quests by type. The same interview records that quests there cannot be failed in the classical sense, only given consequences, which informed how we treat outcomes. [80.lv](https://80.lv/articles/cd-projekt-red-reveals-the-secret-key-to-impressive-side-quests) (2024) reported Sasko on pitching many ideas and the small share that are accepted. Weber's interview also sets out the studio's staged route from half-page pitch to design document to rough playable with placeholder dialogue, which we compared against when thinking about how an author moves from a sketch to a finished piece.

## Frameworks and core mods

### ArchiveXL

By psiberx and contributors. [GitHub](https://github.com/psiberx/cp2077-archive-xl). ArchiveXL's source taught us how character-creator options are registered, how appearance templates are cloned and how dynamic material paths expand. That understanding is the foundation of XF Studio's single-selector preset export, which avoids generating a separate material for every combination, and its archive-group, `.xl` discovery, scope, fix, patch, copy/link and dynamic-mesh rules are what XF Studio's character resolver replicates to interpret installed mods the way the game does. Its player-eye fix, which copies the eye morph resource without its base texture, showed us that a morph resource can override a material's normal map. Its localization extension showed how mods' texts join the game's, which XF Studio follows to label mod-added character-creator options. Its animation extension, which merges animation sets into a named component of an entity or scope, and its photo-mode scopes informed the expression export (whose resource patch adds its own animation component, because ArchiveXL merges a patch's components by name and id) and are the basis of XF Studio's pose catalogue, which finds the pose sets mods append to the photo-mode puppet the way it does. Its garment extension taught us how worn items pick their look (dynamic appearance names, conditions, and path substitution with body, feet, arm and sleeve states; its arm state, read from the drawn weapon's cyberware type, pointed us to the TweakDB records that choose V's arm-cyberware holster state), how visual tags hide other items and mask parts of the body, and that it sets garment offsets aside unless an outfit mod turns them on; its chunk-mask rules and factory index are what XF Studio's clothing render replicates to show a save's clothes and what they hide. Its component-prefix rule, by which `hide_Head` hides the head's decals and accessories with the head, set how XF Eye Artistry names its makeup component and how XF piercings will name theirs. Its ink-spawner and journal extensions showed how a mod attaches its own script controller to a spawned widget and merges new web pages, contacts and messages into the game's journal. Its world-streaming extension taught us how location mods stay additive: extra streaming blocks appended to the world, vanilla nodes hidden or moved in memory as each sector loads behind node-count and type checks, device and persistent-state patches, and quest phases injected into the game's quests, each started once per save through a fact that records it ran; its journal extension also showed how quest map pins find markers in a mod's own sectors and how the journal is rebuilt on a hot reload. It is an intended runtime dependency; no ArchiveXL code is included in XF Studio. Its hooking approach, typed engine functions resolved by address-library ID and detoured before, after or around the original, with a before-hook on the resource loader that rewrites a requested path, is the playbook for the XF Shaders design, which rewrites a shader-cache lookup key the same way.

### Audioware

Published under the cyb3rpsych0s1s account, per the documentation link on its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/12001). Its scripts showed how a mod shows its own subtitle or overhead chatter line: build the game's dialog-line struct in script, post it to the UI blackboard and hide it by id after its duration. That is the basis of the text-only barks planned for NPC reactions. Its scene-dialogue guide explained how new lines borrow existing lip-sync clips, that the game stops a clip when the line's `.wem` ends (hence its silent `.wem` files) and that line lengths live in a report file ArchiveXL can't merge, which frames the lip-sync export design. Studied only.

### Codeware and TweakXL

By psiberx and contributors. [Codeware](https://github.com/psiberx/cp2077-codeware), [TweakXL](https://github.com/psiberx/cp2077-tweak-xl). Their release notes and compatibility statements helped us choose stable framework versions for runtime testing. Their source, and psiberx's shared plugin framework within it, taught us how a well-built RED4ext plugin is structured, logs and ships its scripts, how to declare natives for redscript, and how TweakXL loads and types YAML tweaks, which shaped the XF Runtime Bridge; its TweakXL data marker is an optional runtime use. Codeware's quest-system access let the bridge run the game's own photo-mode quest node, which showed that this route opens only a restricted photo mode; its imports of photo-mode events pointed to the photo-mode cursor and camera. Codeware is an optional runtime use. The shared framework's function-call code confirmed that some functions scripts call as static need a context, which is how the bridge now calls the game. Codeware's attachment-slot data showed how a script can list what each slot shows, the basis of the planned worn-clothing snapshot. TweakXL's YAML reader (file priority markers, the last of which the bridge's camera presets now use to load after other mods' presets, `$base`, `$instances` templates, conditions, array operations and inline icon records) is what XF Studio's tweak reader follows to find the icons mods declare for their character-creator choices and the photo-mode poses they add, and its changeset shows the order in which list operations apply; later the items mods add. Its script-built widgets, popups, resource and raw-input callbacks and menu-resource imports showed how terminal pages and games can be written without ink resources. Its dynamic and static entity systems, world-state toggles and sector node access showed how a runtime bridge could spawn preview objects and hide world nodes in game. Its service and entity persistence showed which mod state lives in saves and which in a file beside the plugin. No code is copied. Its raw-input hook on the UI system's input processing showed the decoded input records the game passes around, one candidate point for synthetic input, and its re-declaration of the functional-test system confirmed that the retail build strips those natives' parameters. Its ink system access (layers, their windows and controllers, world widgets), its hook that attaches script-built widgets to the game's systems and its resolution watcher showed how a mod reaches the game's HUD and builds UI entirely from script, which the XF Runtime Bridge's in-game panel, nameplates and map-pin badges use. Its reflection API is how the bridge calls Equipment-EX's outfit functions by name and parameter types at run time, so a changed signature in another mod can't break the whole script compile. Its weather functions (set, reset and read the weather state) are the bridge's weather commands, its raw key callback is how the player answers the bridge's questions from the in-game panel, and its raw axis callback is how a look notices the player's mouse. Studied mods showed TweakXL's script API cloning and editing records at run time, and Codeware's localisation providers supplying a mod's texts from script. Codeware's callback system (its wiki table and the event classes under `scripts/Callback/Events/`) lists the session events (start, ready, before and after a save, end, pause), the entity lifecycle events and the input events a script can register for; the session events, with their restored and pre-game flags, are the generic route for a world event feed's save and load hooks.

### Cyber Engine Tweaks

By yamashi and contributors. [GitHub](https://github.com/maximegmd/CyberEngineTweaks). Its source showed us exactly what a Lua mod can do: its events, its sandbox (including that it has no networking), its logging and how Lua reaches game and plugin functions. That is why the XF Runtime Bridge keeps its external link in a native plugin and uses CET only for reporting and an on-screen status. Its function-call code showed how native code must call game and script functions (a caller frame with a stand-in caller and a context that is never empty), which explained the bridge's first in-game crash; the bridge's own calls follow that recipe, reimplemented rather than copied (CET is MIT-licensed). CET is a runtime dependency of the bridge's Lua layer. Its property code showed that a Lua write to a field a game class doesn't have stays on the Lua side, which is why an older creator mod's settings may not reach the game on 2.31. Its resource-list loader showed how the game's own Oodle decompressor is called, which XF Studio's archive reader does from the user's game folder. Its game-options interface is how the bridge's Lua layer reads the engine's hidden character render options for a settings record. Its per-mod database showed that Lua mods keep their state outside saves. Its game-options code also showed that a float written to an engine option reaches the engine unchanged, which ruled out one explanation of the old photo-mode gaze freeze. Its binding store, which keeps each mod's hotkeys under the mod's folder name and drops them once the folder is gone, and its separate context for each mod shaped how XF Photo Mode is proposed to succeed Photo Mode Tools without losing players' keys. Its creation of CD PROJEKT RED's functional-test game system as a singleton, and its re-declaration of a test native whose parameters the retail build strips, showed that the game's hidden test-input functions are reachable, the lead for driving V without window focus; its window-procedure hook showed which window messages carry game input. Its overlay and input code (much of it by Andrej Redeky, per its history), which draws from inside the engine's own frame presentation on the engine's queue, builds each frame on the game thread and hands it to the render thread, and takes input through the game window's message handler with the engine's own cursor, is the model for the XF overlay host the bridge now carries (reimplemented, not copied); its issue tracker's HDR and frame-generation reports shaped that design's risks. Its font setup (Dear ImGui's default Latin-1 ranges plus one chosen language) is why the bridge sends CET's windows a transliterated copy of its messages rather than changing the player's font.

### RED4ext and RED4ext SDK

By wopss and contributors. [RED4ext](https://github.com/wopss/RED4ext), [RED4ext SDK](https://github.com/wopss/RED4ext.SDK). RED4ext's releases set our framework baseline, and the SDK's resource-depot declarations clarified which parts of archive lookup order the game leaves unspecified. Its character-customization type declarations showed that the creator tracks an active flag per option. A dump of the game's scripting type information, exported for us by psiberx with his fork of wopss's RED4.RTTIDumper, named the puppet-preview controller and camera classes that led us to the character creator's scene and camera. The loader's source and the SDK's examples taught us the plugin contract, game-state callbacks, per-plugin logging and native function registration behind the XF Runtime Bridge, which is built against the SDK (MIT) and needs RED4ext at runtime. The SDK's resource-path declaration documents the path clean-up behind the game's resource hashes, which XF Studio's archive reader follows. Its generated layouts of the hair-profile resource and its gradient entries let us find the game's hair-profile bake in the executable. The SDK's reconstruction of how the engine runs native functions, together with the function names in the address library RED4ext ships, let us pin the bridge's first in-game crash to a missing call context. Its hand-written layouts of loaded animation buffers and their key frames, rigs, animation sets and the animation controller's IK and look-at controllers, with its generated animation-node types, mapped the routes by which the Studio could pose V live in game, and its resource loader declarations let the XF Runtime Bridge find a loaded animation set by its path to check that experiment's carrier clip. The loader's plugin discovery and script-path rules are the basis of the proposed XF Core plugin host. Its generated dangle layouts showed the simulation's fields and the external acceleration input one vanilla hairstyle wires, and let us name the fields the solver's code reads in the executable. The SDK's decoded GPU device data (swap chains with their HDR mode, the device and the direct queue) and the loader's hooking API and plugin start-up order are the basis of the XF overlay host the bridge now carries. Its address-library resolver and Detours-based hooking API are what that host builds on, and the SDK's GPU device-data and command-list layouts let us recognise the shader table, the pipeline-state block and the device calls in the executable.

### redscript

By jac3km4 and contributors. [GitHub](https://github.com/jac3km4/redscript). Its releases helped set a stable framework baseline for runtime testing. Its compiler source taught us how modules name classes and globals, how method wrapping resolves and where compilation logs go, and we use its official command-line release (MIT) to type-check the XF Runtime Bridge's scripts offline and to decompile the installed game's scripts for private study, which showed how the character creator lists, orders, labels and colours its options. Its bytecode instruction table gave the opcode numbers the bridge uses when it passes arguments to script functions. Its definitions of compiled script fields, including the `persistent` flag, showed where script mods' saved data comes from and where readable names for it can be found. Its bundle reader showed the compiled script bundle's header and name table, which XF Studio's Save Explorer reads (read-only) to name the hashes a save stores, and its compiler's settings showed where the modded bundle is written. Its compiler's failure path, which starts the game with no mod scripts in effect, is why the proposed XF Core gates its plugins' scripts and holds back a plugin that breaks compilation.

## Modding tools

### Cyberpunk 2077 Support for Vortex

By Ellie Peterson (E1337Kat), Auska, Bladehawke and contributors, published by Nexus Mods. [GitHub](https://github.com/E1337Kat/cyberpunk2077_ext_redux), [Nexus Mods](https://www.nexusmods.com/site/mods/196). Its source taught us how Vortex installs Cyberpunk mods: one installer pipeline for every layout, everything deployed from the game folder, archives left in the game's alphabetical order and a separate REDmod load order. Studied only.

### Cyberpunk Blender Add-on (IO Suite)

By its authors and the RED Modding maintainers. [GitHub](https://github.com/WolvenKit/Cyberpunk-Blender-add-on). Its facial solver turns the game's facial animation controls into real deformation; running it offline gave the studio's preview a working character-creator idle with blinks, gaze and mouth movement, and the game's own blink on V's lids, lashes and brows; kept running as a separate program, it also solves the expression editor's live face as each control moves. Its eye material setup also served as a useful precedent for our preview shaders, its multilayered node group's contrast curve showed how a layer's microblend contrast enters the game's mask arithmetic (as a reciprocal), and its material import code, originally by HitmanHimself building on Turk645's research with shader notes by Jato and current maintenance by DoctorPresto, showed how community tools read each shader template's parameters and texture channels, including its empirical hair-profile colour handling. Its world-sector importer's light conversion showed which local axis a light shines along, and its multilayered material setup was the community reading we compared with the game's compiled layer program when building the preview's layered materials. Its solver's lip-sync stages showed how speech limits set by JALI's jaw and lip strengths, override weights and added lip-sync poses layer a spoken line over an expression, and let the lip-sync proof of concept solve its generated clips. Its animation export also showed how facial control curves travel through glTF as float-track keys, the format a future expression export would write. Its facial solver, written by DoctorPresto, is also the behavioural reference for our clean-room solver specification and the external oracle an in-app solver is checked against. We run the unmodified solver as an external tool (GPL-3.0-or-later); no add-on code is included in XF Studio.

### IGCS Connector

By Frans Bouma (Otis Photomode Mods). [GitHub](https://github.com/FransBouma/IgcsConnector). Its source showed how a ReShade add-on cooperates with game camera tools and captures shots, which we assessed as an optional camera and capture path for agent-driven tests. Studied only.

### Mod Organizer 2

By the ModOrganizer2 contributors; the Cyberpunk game plugin credits 6788 and Zash. [GitHub](https://github.com/ModOrganizer2/modorganizer), [Cyberpunk plugin](https://github.com/ModOrganizer2/modorganizer-basic_games). The plugin and its load-order guide taught us to separate MO2's virtual file priority from the game's own archive load order, which shaped how XF Studio discovers installed mods. MO2's own source and its download handler showed us how profiles order mods, how instances configure their folders, and how installs register, which XF Studio follows when it finds and reads an existing MO2 setup. The download details MO2 keeps in each mod's `meta.ini` (mod and file IDs, installation file, repository) are how a problem report names a mod's source without copying it.

### ReShade

By Patrick Mours (crosire) and contributors. [GitHub](https://github.com/crosire/reshade). Its add-on API and examples showed how to capture frames before post-processing effects, read depth and toggle effects without touching a user's preset, which is the basis of an optional lossless-capture design for in-game tests. Its swap-chain proxies, its notes on frame generation's separate presentation queue and on an overlay that picks the wrong queue, its input layer (never swallowing a key-up whose key-down reached the game; reading raw mouse and text when legacy messages are off) and its HDR-aware overlay shader taught us where an XF overlay must and must not hook and how it should behave. Studied only (BSD-3-Clause); nothing is built on it yet.

### Vortex

By Black Tree Gaming Ltd. (Nexus Mods) and contributors. [GitHub](https://github.com/Nexus-Mods/Vortex). Vortex's source showed us how it stages mods, deploys the winning files into the game folder, records each deployment in a manifest and keeps each mod's Nexus Mods ids in its state, which is how XF Studio tells which Vortex mod put a file in the game folder and how a problem report says where a Vortex-installed mod came from. Studied only; XF Studio reads Vortex's files but includes no Vortex code, and our Vortex tests run in a disposable Windows Sandbox.

### WolvenKit

By the WolvenKit team and contributors. [GitHub](https://github.com/WolvenKit/WolvenKit). WolvenKit is the backbone of our export pipeline: we use its CLI to extract, convert, serialize and pack resources, including extracting the head that XF Studio's built-in eye plate is cut from and exporting each user's own head, eyes, resolved materials and textures for the 3D preview, and its source taught us the game's save, archive, mesh, morph target, animation and compiled appearance formats, plus the material type definitions and shader-cache layout (its reader named the cache's regions, which we then decoded to the engine's lookup key), and its multilayer-mask exporter showed how the mask atlas and tile tables decode. Its animation importer showed that facial float tracks and additive clip types survive a glTF round trip, which the expression export plan relies on, and its compressed animation buffer reader and writer showed the key layout and rotation encoding that the XF Runtime Bridge's live-pose carrier and its in-game layout check follow. Its wardrobe and script-system save parsers showed where a save keeps V's clothing and how a save's object packages are laid out, which XF Studio's loadout reader follows, and its list of known resource paths located the game's cooked table of item visual tags. Its type definitions named the fields, class defaults and enumerations of the game's dangle simulation, and the lip-sync map, scene actor and dialogue-line fields that tie a spoken line to its facial clip. Its streaming-sector, node-data and instance-transform readers showed how the world's sectors store their nodes and placements. Its TweakDB reader showed the compiled TweakDB layout XF Studio reads for the character creator's categories and swatch icons. Its save writer, node writer and chunk compression showed how a save's chunks, node table and footer are rebuilt, the basis of XF Studio's save write-back design. Its save parsers for inventory, facts and the world's hash-keyed persistency data, and how it keeps unknown classes and nodes, shaped XF Studio's save editor study. Its archive and package writers also informed XF Studio's pre-pack path checks, and its CLI output is the reference XF Studio's native archive reader is checked against, byte for byte and document for document, and its PNG texture and layer-mask exports the reference for XF Studio's native texture and mask decoders, texel for texel; its rig and animation-graph serialization was the reference XF Studio's reader of the body's deformation rig was checked against, and its morph-target export with the game folder writes the fingertip skin of nails morph mods; its GLB mesh exports, whose conventions its mesh tools document, are the reference for XF Studio's native mesh reader, vertex for vertex; its animation exporter is the reference for XF Studio's native animation decoder, key for key. The same buffer layout lets the expression editor read a clip's float keys to start from any installed expression. Used as an external tool (GPL-3.0): XF Studio downloads the official WolvenKit CLI release only when a user agrees, and neither includes nor redistributes any WolvenKit code or binaries. WolvenKit is the backbone of our export pipeline: we use its CLI to extract, convert, serialize and pack resources, including extracting the head that XF Studio's built-in eye plate is cut from and exporting each user's own head, eyes, resolved materials and textures for the 3D preview, and its source taught us the game's save, archive, mesh, morph target, animation and compiled appearance formats, plus the material type definitions and shader-cache layout, and its multilayer-mask exporter showed how the mask atlas and tile tables decode. Its archive and package writers also informed XF Studio's pre-pack path checks. Its CLI output is the reference XF Studio's native resource writer is checked against, byte for byte for every resource and archive a Build writes, and the writer follows the write order, default values and serialize-default classes of its generated classes, read from its CLI's type library; its CLI output is also the reference XF Studio's native archive reader is checked against, byte for byte and document for document, and its PNG texture and layer-mask exports the reference for XF Studio's native texture and mask decoders, texel for texel; its rig and animation-graph serialization was the reference XF Studio's reader of the body's deformation rig was checked against, and its morph-target export with the game folder writes the fingertip skin of nails morph mods; its GLB mesh exports, whose conventions its mesh tools document, are the reference for XF Studio's native mesh reader, vertex for vertex; its animation exporter is the reference for XF Studio's native animation decoder, key for key. Its TweakDB reader and name list showed how a record's type is keyed and let us name the game's 196,000 records offline when reading the population. A note in its area-outline type, that the outline's buffer is a count, that many points and a height, let us decode the polygons the game tests the player's district against.

## Libraries, runtimes and general tools

### Apple ARKit face tracking

By Apple. [Blend shape documentation](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation). Its 52 named facial blend shapes, which MediaPipe and many face tools share, are the vocabulary our face-capture prototype maps onto V's face controls. Only the names and their descriptions were used.

### articy:draft

By Articy Software GmbH & Co. KG. [Feature list](https://articy.com/en/articydraft/feature-list/). A commercial tool for writing branching narrative as flows. We read its feature list as a comparison for our own authoring tools: a view that plays the flow, a check for invalid references and duplicate names, localisation states that go stale when the source text changes, and version history. Nothing from it is used.

### Blender

By the Blender Foundation and contributors. [blender.org](https://www.blender.org/). Blender powers our offline mesh work, eye-plate clearance studies and diagnostic renders; its BVH ray-casting API made it possible to tell visible intersections from hidden ones. Its status bar, which shows what the mouse and held modifier keys do in the current context, is the model for the Studio's viewport input hints. Its workspaces, saved sets of editors and layout switched from header tabs, are the model for the Studio's planned named workspaces over combinable modules.

### Bun

By the Bun contributors. [GitHub](https://github.com/oven-sh/bun). Bun runs XF Studio's local service, its SQLite library and our test suites, and hosts the desktop shell's main process. Used as a runtime dependency.

### Capstone

By Nguyen Anh Quynh and contributors. [Website](https://www.capstone-engine.org), [GitHub](https://github.com/capstone-engine/capstone). Disassembling the game's executable with it showed where the hair lighting options get their default values and which shader constants they feed, and how the game bakes hair-colour profiles; it also traced how the game finds a material's compiled shaders and builds GPU pipeline states from them. Used as a research tool only; BSD-3-Clause-licensed.

### ChoiceScript random test and Rachel E. Towers

Rachel E. Towers, ["How to Get the Most out of Automated Testing, Part 2"](https://choiceofgames.com/2018/01/how-to-get-the-most-out-of-automated-testing-part-2) (Choice of Games blog, 2018). It explains how ChoiceScript's random test plays many seeded runs and reports coverage, and what it cannot do: it cannot judge a loop and it cannot prove that a line is unreachable. It taught us what a large automated survey of a story can and cannot tell an author.

### CSS Easing Functions

By the W3C CSS Working Group. [Specification](https://www.w3.org/TR/css-easing-1/). Its cubic Bézier timing function, two control points between (0, 0) and (1, 1) with x kept within 0–1, is the model of XF Studio's easing catalogue, which the animated expression transitions and the planned timeline editor share.

### Dear ImGui

By Omar Cornut and contributors. [GitHub](https://github.com/ocornut/imgui). Its DirectX 12 and Win32 backends showed how an immediate-mode UI is fed input and drawn with its own descriptor heap, and how its dynamic font atlas uploads glyphs during drawing, which shaped the XF overlay host. The XF Runtime Bridge embeds it (dependency use, MIT; the notice ships with the plugin): its core and DirectX 12 renderer draw the bridge's overlay panel.

### DirectXTex

By Microsoft (Chuck Walbourn and contributors). [GitHub](https://github.com/microsoft/DirectXTex). XF Studio's texture compressor is built from its encoders: BC4 and BC5 on the CPU and BC7 with its DirectCompute encoder, the same code WolvenKit's texture import runs, so a Build's textures come out byte for byte as WolvenKit would make them. A dependency, MIT-licensed; XF Studio builds it from the official source release.

### dxil-spirv

By Hans-Kristian Arntzen. [GitHub](https://github.com/HansKristian-Work/dxil-spirv). Translating the game's DXIL shader programs to SPIR-V made structured, decompiled listings of them possible in our shader research. Used as a research tool only; MIT-licensed.

### Easing Functions Cheat Sheet (easings.net)

By Andrey Sitnik and contributors. [Website](https://easings.net), [GitHub](https://github.com/ai/easings.net). Its cubic Bézier forms of the cubic easings are the control points of XF Studio's Strong ease in-out and Strong ease out curves.

### cyrb53

By bryc. [cyrb53](https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js), a public-domain 53-bit string hash. XF Studio's chunk store uses it as a fast content address for cached data.

### Electrobun and Hutch

By Blackboard Technologies Inc. and contributors. [Electrobun](https://github.com/blackboardsh/electrobun), [Hutch](https://github.com/blackboardsh/hutch). Electrobun's documentation shaped XF Studio's desktop packaging, update, shutdown and uninstall design, and it is the framework for our desktop packaging trial. Electrobun is MIT-licensed and its notice must accompany any distributed build, together with the notices of its bundled dependencies.

### fdlibm

[fdlibm](https://netlib.org/fdlibm/), the freely distributable maths library developed at SunSoft (Sun Microsystems). The Story Engine's reference model adapts its natural-logarithm routine, `e_log.c`, with its permission notice preserved, so that every implementation computes bit-identical results.

### glTF 2.0 Specification

By the Khronos Group. [Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html). XF Studio's native mesh reader writes the preview's GLB files to it, and its rule that an accessor holds at least one element is why the reader leaves a chunk without vertices or triangles to WolvenKit.

### ICT-FaceKit

By the USC Institute for Creative Technologies. [GitHub](https://github.com/ICT-VGL/ICT-FaceKit). Surveyed as an open (MIT) face model whose expression shapes follow the ARKit names split by side; it confirmed that convention for our blendshape mapping. Nothing from it is used.

### ink and Inky

By inkle. [ink](https://www.inklestudios.com/ink/), [Inky](https://github.com/inkle/inky). ink is a text-first scripting language for branching stories, and Inky is its editor. Inky compiles as you type, lists errors, warnings and to-dos together, and replays your earlier choices after each edit. We compared them against the kind of authoring loop we want to offer. Nothing from them is used.

### Inno Setup

By Jordan Russell and Martijn Laan. [Website](https://jrsoftware.org/isinfo.php), [source](https://github.com/jrsoftware/issrc). XF Studio's downloadable Windows setup is one Inno Setup program that carries Electrobun's setup and runs it. The setup runtime it redistributes is under the Inno Setup License, whose notice ships with the app's third-party notices.

### JSON Schema

The [JSON Schema](https://json-schema.org/) specification (draft 2020-12). The XF Runtime Bridge's command catalogue is written as JSON Schema, so every frontend and tool can check a command's input before sending it.

### JSON for Modern C++

By Niels Lohmann and contributors. [GitHub](https://github.com/nlohmann/json). The XF Runtime Bridge plugin parses and writes its protocol messages with it. It is compiled into the plugin (MIT), so its licence notice must ship with any distributed build.

### Khronos Data Format Specification

By the Khronos Group. [Specification 1.3](https://registry.khronos.org/DataFormat/specs/1.3/dataformat.1.3.html). Its chapters on the S3TC, RGTC and BPTC block formats, with their BC7 partition and anchor tables, are what XF Studio's own texture decoder is written from. Published under CC BY 4.0.

### LZ4

By the LZ4 authors and contributors. [Block format specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md). The specification let us write the independent decompression in XF Studio's save reader, and its length encoding bounds how far a block can expand, which the reader checks before it allocates anything.

### Mermaid CLI

By the Mermaid contributors. [GitHub](https://github.com/mermaid-js/mermaid-cli). Used to render and visually review the diagrams in our pipeline documentation.

### luaparse

By Oskar Schöldström and contributors. [GitHub](https://github.com/fstirlitz/luaparse). We use it (MIT) as a development tool to syntax-check the XF Runtime Bridge's Lua layer offline.

### MCP TypeScript SDK

By Anthropic and the Model Context Protocol contributors. [GitHub](https://github.com/modelcontextprotocol/typescript-sdk). The XF Runtime Bridge's MCP server, which lets an AI client drive in-game tests through the bridge, is built on it, and its client runs our end-to-end tests. It is a development dependency (MIT) of the bridge's tools.

### MediaPipe Face Landmarker

By Google (model cards by Ivan Grishchenko, Geng Yan, Andrei Zanfir and Eduard Gabriel Bazavan). [Guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker). Its web library and face model, which estimate 52 blendshape scores from a face image on the user's own computer, drive V's face in our face-capture prototype. Both are Apache-2.0 and run locally from the official downloads; the library's usage-metrics upload is blocked by the page. Nothing from it ships in XF Studio.

### Fengari

By Benoit Giannangeli, Daurnimator and contributors. [GitHub](https://github.com/fengari-lua/fengari). A Lua virtual machine written in JavaScript; we use it (MIT) as a development tool to run prepared CET console snippets against stand-in game objects before an in-game session.

### Microsoft platform tools and documentation

By Microsoft. The DirectX shader compiler and [DXIL reference](https://github.com/microsoft/DirectXShaderCompiler/blob/main/docs/DXIL.rst) let us read the game's compiled shaders, the Direct3D 12 documentation of pipeline-state descriptions, pipeline libraries and root signatures let us recognise them in the game's executable, the [Xbox store listing](https://www.xbox.com/en-us/games/store/cyberpunk-2077/bx3m8l83bbrw) and [Xbox Wire](https://news.xbox.com/en-us/2026/03/03/xbox-game-pass-march-2026-wave-1/) showed that Cyberpunk 2077 has no Xbox app edition for Windows, and the [WebView2 debugging documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code) enabled automated testing of the packaged desktop window. WebView2 is a platform dependency of the desktop app; its [distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) shaped the one-click install, and the installer includes Microsoft's unmodified Evergreen WebView2 bootstrapper, packaged as that guidance allows. [Detours](https://github.com/microsoft/Detours), the hooking library RED4ext uses, showed how a second hook on an already hooked function chains and why unhooking out of order is unsafe, which set the planned XF overlay host's hook rules.

### NVIDIA Streamline

By NVIDIA. [GitHub](https://github.com/NVIDIA-RTX/Streamline). Its DLSS Frame Generation programming guide explains the hudless and UI buffers frame generation uses and that presentation moves to another thread while it is on, which is why an overlay drawn into the game's final image may ghost or flicker and why the XF overlay host never hooks presentation below the engine. Its rules for third-party overlays and its documented way to reach the native object behind one of its proxies are how the overlay host now draws with DLSS frame generation on. Studied only.

### noble-hashes

[noble-hashes](https://github.com/paulmillr/noble-hashes) by Paul Miller (MIT licence). The Story Engine's reference model depends on its BLAKE3 implementation for the stable identifiers and keyed randomness its specification requires.

### PractRand (sfc32)

By Chris Doty-Humphrey. [PractRand](https://pracrand.sourceforge.net/) and its small fast counting generator, sfc32. XF Studio's seeded random helper uses sfc32, which makes tests and simulations repeatable from a seed.

### Pillow

By the Pillow contributors. [GitHub](https://github.com/python-pillow/Pillow). Used in research tooling to encode and measure generated test images; its BCn decoder reads the game's compressed textures so their levels, mips and normal-map conventions can be measured offline.

### PKWARE ZIP specification

By PKWARE. [APPNOTE.TXT](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). The ZIP file format specification that XF Studio's small report-file writer follows.

### red4ext-rs

By jekky and contributors. [GitHub](https://github.com/jac3km4/red4ext-rs). Its bindings showed what a Rust RED4ext plugin can do, which we weighed as an alternative native layer for the runtime bridge before choosing C++ with the SDK the loader itself uses; its call helpers showed that it always passes a context when calling static functions. Its resource-path code confirmed the path clean-up rules behind resource hashes.

### resvg

The resvg SVG renderer by Yevhenii Reizner and contributors, used through yisibl's [resvg-js](https://github.com/yisibl/resvg-js) bindings (MPL-2.0). Renders the app icon set from its SVG master at build time. Development dependency only; nothing from it ships in the app.

### Rhubarb Lip Sync

By Daniel Wolf. [GitHub](https://github.com/DanielSWolf/rhubarb-lip-sync) (MIT, with MIT- and BSD-licensed dependencies including the CMU Sphinx acoustic model). Used as a local tool in lip-sync R&D: its recogniser, guided by a transcript, gave the phone timing from which the proof of concept built JALI-style curves for the game's lip-sync channel. Not included in XF Studio.

### SciPy and NumPy

By the SciPy and NumPy developers. [SciPy](https://scipy.org/), [NumPy](https://numpy.org/). Their optimizers and array tools drove our eye-plate correction studies and image measurements. Used in research tooling only.

### Semantic Versioning

By Tom Preston-Werner. [semver.org](https://semver.org/). Its rule of major, minor and patch numbers, raised for breaking changes, compatible additions and compatible fixes, informed how we think about versioning content packs. Nothing from it is used.

### SPIRV-Cross

By the Khronos Group and SPIRV-Cross contributors. [GitHub](https://github.com/KhronosGroup/SPIRV-Cross). It turns SPIR-V translations of the game's shader programs back into readable HLSL or GLSL for our shader research. Used as a research tool only; Apache-2.0-licensed.

### SQLite

By the SQLite project. [sqlite.org](https://sqlite.org/). SQLite stores XF Studio's local library of immutable look and collection versions.

### Three.js

By mrdoob and the three.js authors. [GitHub](https://github.com/mrdoob/three.js). Three.js renders the studio's entire browser preview: skinned head, materials, camera controls, ray casting and the glitter studies. One isolated glitter study adapts its physical-lighting shader structure, so that code carries the Three.js MIT notice, which must also accompany any distributed build. Its multiple-views examples (one renderer drawing several cameras into scissored regions of one canvas) framed how the planned view graph shares one GPU context across views; its texture-upload implementation established how Hair Lab can supply complete manual mip chains and gamma-correct Flow inputs.

### Twine

By the Twine project. [Reference](https://twinery.org/reference/en/limitations/collaborating.html), [source control](https://twinery.org/reference/en/limitations/source-control.html). Its documentation says that Twine cannot be edited by several people at once, that compressed story files make version-control diffs hard to read, and that a story library should not sit in a cloud-synced folder. It taught us what plain-text, version-controlled authoring files need to avoid. Nothing from it is used.

### WHATWG DOM Standard

The [DOM Standard](https://dom.spec.whatwg.org/#aborting-ongoing-activities) (WHATWG). Its AbortController and AbortSignal define the cancellation XF Studio uses everywhere: work is cancelled by aborting once with a reason, and a signal follows its parent.

### WebKit

By Apple and the WebKit contributors. [GitHub](https://github.com/WebKit/WebKit). Its `UnitBezier` solver, Newton's method for the curve parameter with bisection where it stalls, is the method XF Studio's easing curves use to evaluate a cubic Bézier at a point in time; reimplemented, no code copied.

### wgpu

By the gfx-rs/wgpu contributors. [GitHub](https://github.com/gfx-rs/wgpu). Its documentation framed our assessment of native versus browser rendering backends and the current state of ray-tracing support.

### YAML 1.1 boolean type

By Oren Ben-Kiki, Clark Evans and Brian Ingerson. [Boolean Language-Independent Type for YAML 1.1](https://yaml.org/type/bool.html). The specification lists `yes`, `no`, `on` and `off` among the words read as booleans. It warned us that a file format with implicit typing would silently change words our authors need to write.

### Yarn Spinner

By Yarn Spinner Pty. Ltd. [Node groups](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/node-groups), [editor](https://yarnspinner.dev/editor/). Yarn Spinner picks one of several nodes that share a name by checking their conditions. Its editor checks as you write, suggests fixes, draws a graph of the nodes and previews dialogue with the real runtime. We compared them against our own plans for variants and authoring previews. Nothing from them is used.

## Documentation and community knowledge

### Cyberpunk 2077 Modding Wiki

By manavortex and the wiki's contributor community. [Wiki](https://wiki.redmodding.org/cyberpunk-2077-modding), [source](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs). Special thanks to manavortex, who wrote much of the wiki and keeps it available to modders. Its file-format page, with its archive-format tables, described the container XF Studio's archive reader decodes. Its guides and screenshots taught us the character resource chain, character-creator hair, eye and switcher setups (including the switcher guides' note that an option's index sets its place in the creator) (including the eye guide's note that eye albedo is sampled upside down while normal maps are not flipped, and its in-game image showing the iris drawn the same way up as the rest of the eye), material families and skin-shader parameters, decals and load order. We are particularly grateful to the guide authors and editors lumad11 (the CCXL eyebrows guide), icxrus, redacted-c01, nutboy, Mx_OrcBoi (custom facial piercings with PRC, whose guide showed how the community rigs a rigid piece and why patterned vanilla finishes break on new geometry) and minnierylands (load-order guide), saltypigloaf (facial-rig guide), Rebecca (whose multilayered clear-coat page demonstrated the view-angle coat tint), manavortex's multilayered guide and property pages, and the multilayered colour-blending guide, whose in-game grid of microblend contrast against mask levels showed that a low contrast sharpens a layer's mask rather than softening it, nullfractal (whose LUT guides explained that the game grades through 3D LUTs fed with ARRI LogC3 values), and to the CyberCAT documentation for pointing us to external preset files and for its warning that the editor's appearance tab has been disabled since 2.0, which shaped how cautiously XF Studio plans to write creator values into saves, and for its version table and its warnings that edited quest facts can break a save for good, which set the save editor study's safety rules. chromoxolon's custom voice-line guide showed how a `.wem` joins a scene line through a voice-over map registered with ArchiveXL. The save-file page added by darkcart described the save's header, chunk table and node table. The CCXL eye-texture guide by nutboy and another author, edited by icxrus, showed how mods make creator icons: an `.inkatlas` generated from PNGs and one `UIIcon` record per choice declared through a TweakXL template. For the character-creator file chain, icxrus's CCXL eyelashes guide showed that lash styles join ArchiveXL's lash scopes behind a core mod's own Eyelashes row, and that players should pick the vanilla lashes before removing a lash mod; the character-creator and options pages by manavortex and redacted-c01 set out how named and unnamed options merge; mana vortex's facial-cyberware guide showed the always-on route that patches a decal into every player entity, and the head guide that a custom head is a set of morph targets at the vanilla paths; and Yggnire's scar replacer guide showed that face scars share one texture set across both bodies. For facial expressions and photo mode, manavortex's facial-expression, photo-mode and pose guides, Simarilius's facial-animation page (based on research by Loomy and John CO), the AMM expression table by Maximilium, Pinkydude and Vitum, the pose-pack update pages by nutboy and Zwei Valerie, LadyLea's update of the pose-making guide (whose process and templates came from xbaebsae and Angy) and Akiway's lipsync guide showed how photo mode, AMM and scenes use facial clips (that guide also explained per-language lip-sync maps, clip names derived from each line's id, and that WolvenKit copies existing lip sync rather than generating it) and how the community registers poses; the guide on removing foot-snap IK from poses showed how the game plants a pose's feet and when creators turn it off, which shapes the pose editor's grounding choice. For the body, manavortex's body cheat sheet showed which meshes make V's body and its seam covers, and the suffix page's feet table which feet a V without shoes stands on. For arm cyberware, icxrus's switcher page, which ties each arm group to an equipped arm cyberware, and manavortex's arms cheat sheet, which maps each cyberware state to its entities and meshes, framed how the holster state is chosen. For clothing, manavortex's item-structure, suffix, dynamic-variant, tag and body-mod pages, LadyLea's tag diagrams of the body and head, the garment-support page (which credits psiberx and Auska, among others), revenantFun's guide to painting garment support and FronkenZeepa's first-person fixes showed how worn items resolve, layer and hide the body. For tattoos, LadyLea's texture-framework page and its vanilla and framework UV layout images (with AllKnowingLion's section on the UV framework and its account of Halvkyrie's Unique Arms), Yggnire's overlay-tattoo guide, YoursTrulyBilly's merging pages, Halk's replacer guide and the CCXL body-tattoo and additions pages, with their table of community tattoo rows, showed the three ways a tattoo reaches V: a skin overlay, a replaced texture or a creator addition. For hair physics, eagul's dangle-bone guides (how a mesh's swinging chains pair with a `.rig` and an `.animgraph`, the leverage effect, and collision shapes that make a moved chain explode), PinkyJulien's guide to transferring dangle bones and the documented-components page showed how the game's hair and jewellery physics is set up and how creators transplant a donor's physics. For the world, the streaming-sector and streaming-block pages (Sergey's block and variant page, based on psiberx's input, and mana vortex's sector pages), psiberx's collected notes on node references, Simarilius's node-type reference and Blender sector import, the removal guides by mana vortex and justarandomguyintheinternet, Sergey's community-registry guide, Kaoziun's sector-variant project, Akiway's embedded-collision page, Deceptious's occlusion notes collected by mana vortex, and the World Builder guides explained how Night City is streamed and how location mods add to it. Its quest-facts theory page (written by manavortex, later updated by Deceptious) explained that facts are named integers that read 0 until set, and its quest-id reference mapped journal paths to quest titles, which let us read the main story's quest structure by name, and the open-world gigs, NCPD hustles and cyberpsycho hunts by title and kind. Its [Visualize Quest files](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/quest/visualize-quest-files) guide showed that quest phases are graphs joined by handle references. The WolvenKit wiki's [Quest Editor](https://wiki.redmodding.org/wolvenkit/wolvenkit-app/editor/quest-editor) page noted that the editor has no undo and recommends soft deletion in published quests, which informed how we think about authoring tools and about retiring content safely. Its communities guide (written by keanuWheeze, with later edits by Yggnire and Kaoziun) and its crowds page (manavortex) taught us what a community entry, phase, time period and marking are, that communities spawn almost every non-crowd NPC, and where crowd pools are defined. For the channels to the player, Bill's custom-shards guide (extended with a text walkthrough by curricle) and text-message guide showed how a shard and a phone thread are built from a journal file, an onscreens text file and, for a shard, a TweakXL item record; daemon2077's guide to changing an NPC's scan information showed that the scan tab's header comes from the character record; and the custom video holocalls guide showed that a call is the phone's ring and panel with an ordinary scene played over it, filmed in a hidden studio (the page does not name its author). For places, the custom fast-travel-points guide (written for World Builder; the page names no author) showed that a fast-travel record carries its district and display name, which led us to the district records and the area volumes that choose them. Its troubleshooting guide's note that removing mods which store data in saves can break loading informs what the Story Engine keeps in the save.

### RPG Site

[Cyberpunk 2077 endings guide](https://www.rpgsite.net/feature/10580-cyberpunk-2077-endings-every-ending-epilogue-plus-how-to-get-them) (RPG Site). It described, from play, which side quests and choices each of the base game's endings needs and where the point of no return falls. We used it only to check our reading of the quest files against what players report, and treated its claims as unverified. Its [patch 1.2 report](https://www.rpgsite.net/news/10895-cyberpunk-2077-patch-12-update-changes-detailed) (Alex Donaldson, 2021) described the developers' change so that police take time to arrive after a crime and a recon drone appears to assess the scene. It informed our rule that a consequence must travel to the player from a cause that exists.

### PowerPyx NCPD scanner hustle guide

[Cyberpunk 2077 All NCPD Scanner Hustles Locations](https://powerpyx.com/?p=98075) (PowerPyx). It counted the open world's scanner hustles by kind and described an assault in progress as a short fight over a lootable item. We used its counts only to check how the game's hustle quest files group by kind, and treated its claims as unverified.

### EIP.gg Cyberpunk 2077 gangs guide

Mila Grish, [Cyberpunk 2077 Gangs](https://eip.gg/cyberpunk-2077/guides/cyberpunk-2077-gangs/) (EIP.gg, published September 2020, updated September 2022). Its per-gang territory entries gave us an outside check of which gang holds which district, against what the game's dynamic-event casts and district records say. We used it only as a cross-check and treated its claims as unverified.

### Electrobun Windows installer notes

By alxrepin ([aiusagebar pull request 16](https://github.com/alxrepin/aiusagebar/pull/16)) and djalmajr ([pinar pull request 32](https://github.com/djalmajr/pinar/pull/32)). Their pull requests recorded that Electrobun's Windows setup program only runs beside its hidden `.installer` folder, and aiusagebar showed wrapping it in an Inno Setup program so users download one file, the approach XF Studio's single-file setup takes.

### Minecraft Wiki: Pack format

By the Minecraft Wiki's community contributors. [Pack format](https://minecraft.wiki/w/Pack_format). It shows how packs declare the range of game versions they support and use minor numbers for non-breaking changes. It informed how we think about declaring what a content pack was checked against.

## Mods and creators whose work we studied

These mods were studied from local installations. Where the private preview displays one of their assets, it is a local reference only and is never packaged or redistributed; each mod's own terms continue to apply.

### AI NPC Cyberpunk Mod

By Alystria AI and contributors, per the copyright line of its licence. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/35436). Its scripts showed how a mod can run a holocall by driving only the phone HUD's call window, so that a quest's own call always takes precedence; how it stages a character out of sight and points the game's own holocall camera at it for a live picture; how it renames nameless NPCs by rewriting the scanner's name after the game has filled it; and how it writes holocall-style subtitle lines. Studied only; none of its code is used. Its save-identity scripts showed how a mod can carry a campaign and branch id in a bank of quest facts, close it with a check value, read it after the game restores a save, and fork a new branch when its external ledger does not recognise the restored point; the pattern behind the Story Engine's proposed save key. Studied only.

### Alliekat

[Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787) and [Eyeshadow Remix Pt. 1](https://www.nexusmods.com/cyberpunk2077/mods/15451). Natural Hair Tones supplies the saved character's brow colour gradient; comparing it with the base game's version taught us that an installed override need not change the visible colour. Its replacements of the shared hair colour profiles showed how one profile colours both V and every NPC wearing that colour, and how a replacement that keeps the base game's stop positions changes where the light and dark parts of a strand fall. Its mapping of several vivid colour names onto one natural gradient showed why the Character panel's swatches must come from the files that win, not from a colour's name or icon. Eyeshadow Remix is another in-place replacement of the base game's eye-makeup masks. Private local reference only.

### anruimurasaki

[High Ponytail Hair - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/25085). Its ponytail mesh showed that a working CCXL hairstyle can list fewer chunk materials than it has render chunks, keeping stub chunks for its lower levels of detail, and that a mesh whose render data lists fewer bone positions than it has bones can ship in a working mod although WolvenKit won't export it; the preview now exports such meshes from a repaired copy. Its two dangle components, one per part, are an example of the vanilla way CCXL hair declares physics. Private local reference only.

### Appearance Menu Mod

By MaximiliumM and contributors. [GitHub](https://github.com/MaximiliumM/appearancemenumod). Its Lua source showed how a mod sets time and weather, teleports, spawns a fixed camera, poses V and hides the HUD at runtime. Those techniques fill much of the capability matrix for agent-driven in-game tests. Its expression code showed a second facial route beside photo mode: resetting an NPC's reactions and applying a facial-reaction feature that selects one of the game's emotion idles. Its observer on the photo-mode setup is how we learned to catch the photo-mode puppet from Lua. Its cursor override showed how to hide the photo-mode mouse cursor for clean captures, its map markers (the mappin type and settings they use) are what the bridge's XF map pins copy, and its controllable lights, saved locations, NPC spawning through Codeware and friendly, immortal actors showed how a test session could light V, stand her in a fixed spot and keep a scene calm. Its decor presets and shareable location packs showed how players already save and exchange placed props and places. Its custom-pose collab files, small Lua tables naming a workspot entity and clips per body, showed the pose route that exists only inside AMM. Its look-at requests with weighted head and chest parts showed how a script can aim a character's eyes, head and chest, one of the channels the pose editor's live posing can use. Its gaze freeze through the global look-at option is one of the two routes the photo-mode snapshot design compares. Its re-teleporting of photo-mode stand-ins after menu changes showed when photo mode rewrites a stand-in's position, its workspot playback on the stand-in showed a pose route beyond the menu, and its makeup and earring switches showed how to hide a decal on V in photo mode. Its player teleport with a chosen facing and its free camera, a spawned camera entity moved by teleports while restriction effects hold V still, are the models for the bridge's planned teleport and free camera. Its Director, which scripts spawned actors through the game's AI commands (teleport, walk to a point, follow, turn), a voice trigger, a facial reaction, a look-at and a pose per step and cleans them up afterwards, is the model for the bridge's planned NPC direction commands. Studied only.

### Arkhe

[Beautiful EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168), [Beautiful EYEBROWS 2K Material Edit](https://www.nexusmods.com/cyberpunk2077/mods/18783), [Universal Skin Tone](https://www.nexusmods.com/cyberpunk2077/mods/15426), [Realistic Complexion III](https://www.nexusmods.com/cyberpunk2077/mods/19314) and [Character Rendering Editor](https://www.nexusmods.com/cyberpunk2077/mods/32842). The eyebrow mod taught us how ArchiveXL copy/patch declarations assemble complete resources from vanilla geometry, and how the game combines two alpha maps with a colour gradient for brows; it also showed that brow styles merge into the base game's brow row rather than adding a selector, and its own texture mips, which darken the strands as they shrink, showed that a brow's colour swatch must read the texture at close-up detail. The Material Edit showed the other route, replacing the base game's brow material and textures in place, which changes every NPC's brows too. The skin mods provided alternative skin maps for render-fidelity comparisons and showed how a complexion replacer works: same-path head textures plus replaced global skin resources, including the default skin profile the preview's skin lighting now reads. The Character Rendering Editor's list of hair, skin and eye rendering options with their vanilla values gave the preview's hair light its default tuning and names the runtime skin and rim-light options a capture must record. Private local reference only.

### Atomiic

[Smokey Diva Hair - Serena - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/29065), whose creator rows read "Atomiic - Serena Smokey Hair". Its fourth part mesh carries earrings and a hair pin on the engine's plain metal template, which showed that a hairstyle's own accessories are ordinary drawing components of its appearance and led the preview to draw that template. Studied only.

### Browser Extension

By r457 and gh057, per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/10038). Its small redscript framework showed how a mod adds a site to the in-game browser without replacing anything: a listener registers an address and icon for one browser, supplies its own page widget for that address, and joins a paginated home page that also lists every journal site. That is the basis of the terminal-content research. Studied only.

### Character Customization Anywhere

By keanuWheeze, per the support link on its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/3930). Its small Lua script showed how to open the character creator from anywhere, by opening the pause menu and redirecting it to the mirror's menu scenario, which the XF Runtime Bridge now does the same way in its own script, and led us to how the creator's Confirm and Back buttons finalise or discard a look. That it opens the creator in V's apartment, where the game reports a staged-gameplay scene tier, is why the XF Runtime Bridge accepts that tier when it opens the creator. Studied only.

### CharLi – Character Lighting Suite for Photomode

By FreakaZ (+FlowerD), per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/8176). It showed how to build a light rig from spawned light entities that follows V or the photo-mode puppet, set each light's colour, intensity, range and cone, aim a ring of lights at V and clean it up again. That loop is the basis of the planned scripted light sweep and of the XF Runtime Bridge's lighting mirror, which places a Studio lighting setup about V in photo mode; its teleporting of lights about the puppet is how the bridge now tries placing photo mode's own lights about V. Its turning of a whole rig about the subject as one group is the model for a planned XF light-rig controller. Studied only.

### CyanideX

[LUT Switcher 2](https://www.nexusmods.com/cyberpunk2077/mods/16310) and [ENV Tuner](https://www.nexusmods.com/cyberpunk2077/mods/23079) (per its script namespace). Studying LUT Switcher's installed package showed that runtime LUT mods apply grading as player effects that can switch off in menus, which the character-creator capture protocol now controls for. ENV Tuner showed that the environment's exposure curves can be rewritten in memory as their resources load and restored afterwards, the technique the lighting mirror's research exposure pin would use. Private local reference only.

### Dark Future

By DarkFortuneTeller. [GitHub](https://github.com/DarkFortuneTeller/DarkFuture), [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/16300). Its source showed how a large persistent gameplay system is structured to stay robust: one lifecycle shared by every system, a start-up ordered after the HUD is ready, a check that holds story beats back during cinematics, as Johnny and after the point of no return, a small save footprint, and quest phases driven from script by a single fact that selects which scene to play. Its phone therapist showed how much story a branching text conversation can carry. Its encounter spawns, made so they never reach a save, and its listener on the last dialogue choice informed the NPC direction design. Studied only; its CC BY-SA 4.0 licence would bind any reuse, and none is.

### dragonzkiller

[Hot-Sampled Photomode Renders (IGPT)](https://www.nexusmods.com/cyberpunk2077/mods/26318), named as author in the plugin's own RED4ext information. It showed that the engine's own screenshot renderer can produce photo-mode captures above screen resolution, at full detail and in EXR, without the photo-mode menu, and that such a render blocks the game long enough to trip the engine's watchdog. That is the basis of the capture route researched for XF Studio's in-game tests. Studied only.

### eagul

[PRC — Fully Modular Jewellery Framework](https://www.nexusmods.com/cyberpunk2077/mods/8590), [New Piercings Collection Vol. 1](https://www.nexusmods.com/cyberpunk2077/mods/8611) and [PRC Vanilla Piercing Mirrors](https://www.nexusmods.com/cyberpunk2077/mods/10236) taught us morph-compatible modular jewellery and the file-replacement route that lets the preview draw such frameworks through its generic resolver; the framework also credits Auska for morph-target import and manavortex for modding help. [Multicolored Hair](https://www.nexusmods.com/cyberpunk2077/mods/21613), its compatibility patch and modder's resources showed how a hairstyle split into up to three parts gets separate creator colour rows under one switcher. Private local reference only; the PRC pages require the author's permission for reuse or modification, and Multicolored Hair's reuse terms have not been checked.

### Even More Brows for Cyberpunk

[Even More Brows for Cyberpunk - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/26230). Its 16 styles ship complete brow geometry of their own inside ArchiveXL's brow scope, which confirmed that a brow style can join the base game's brow row with every hair colour without copying the base game's files. Studied only; its author is still being confirmed.

### Eviction Notice

[Nexus](https://www.nexusmods.com/cyberpunk2077/mods/23187) (author still being confirmed). Its quest data is the most complete mod-made quest we have studied: a journal quest with objectives and map pins on markers it places in its own sectors, trigger areas, pickup scenes, item rewards and landlords who text V, with quest graphs that ask the mod's scripts for answers through request and response facts. It also showed how a script can lock or unlock a door that is nowhere near V through the door's persistent state, and how fixed text messages can show live amounts. Studied only.

### FreeFly (Noclip)

By keanuWheeze, per its script header. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/780). Its small Lua script showed how a mod moves V without the game's locomotion: restriction effects hold her own movement off while teleports every frame carry her along the camera's vectors and turn her by the teleport's facing. That is the basis of the bridge's planned glide and instant turn. Studied only; its licence asks for credit or permission before code is reused, and none is.

### Gambling System

By Boe6, per its script headers. [Pachinko](https://www.nexusmods.com/cyberpunk2077/mods/19889). Its pachinko mod showed how a CET mod offers a betting interaction at fixed world positions and lets other mods add positions through JSON files in an addons folder, which is how Urmland Street Arcade joins it. Its Playable Roulette places the tables as world sectors but spawns the wheel, ball, chips and dealer from script, a clean split between static place and runtime game. Studied only; its code carries a no-reuse notice.

### Hair-colour packs

[MCH Focused Hair Colors Pt 1](https://www.nexusmods.com/cyberpunk2077/mods/30027), [Washed Out](https://www.nexusmods.com/cyberpunk2077/mods/29943), [Illegally Blonde](https://www.nexusmods.com/cyberpunk2077/mods/23002) and [Like totally — Pink](https://www.nexusmods.com/cyberpunk2077/mods/22664). Together they showed how hair colour profiles are scoped and layered by data: each adds its colours to every hairstyle's colour row, and to the brow, lash and beard rows, through slot overlays and one set of material templates, with no per-hairstyle materials. Comparing their profiles, cap gradients and swatches shaped the proposed XF hair-colour export and editor. Their individual authors are still being confirmed.

### High Resolution Garment Preview

[High Resolution Garment Preview](https://www.nexusmods.com/cyberpunk2077/mods/21745). Its file list showed which two base-game resources set up the inventory's garment preview, and that raising its quality is done by replacing them in place. Studied only; its author is still being confirmed.

### icxrus

[Heterochromia Eyes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/20349), [Soft Natural Eyelashes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/29582) and [Lush Manga Eyelashes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/28293). Heterochromia Eyes is a clear example of independently selected components; Soft Natural Eyelashes supplies the lash geometry and material used in the preview and showed how dynamic colour profiles bind to custom meshes. Soft Natural Eyelashes is a private local reference only. Lush Manga Eyelashes, studied only, showed that a lash mesh closes with the lid only as far as its weights follow the lid skin under it.


### A creator who asked not to be named (redacted-c01)

[Hair Color Profiles CCXL](https://www.nexusmods.com/cyberpunk2077/mods/19115) and [Photoreal Eyes CCXL](https://www.nexusmods.com/cyberpunk2077/mods/22412), both co-credited to psiberx and this creator. Their shared material templates and dynamic material paths showed how dramatically material duplication can be reduced, and the hair profiles drive the preview's saved-hair shading, with their selector icons serving as a colour check. This creator also generously explained a Substance glitter graph and reviewed our glitter preview; the lesson that facets need visibly varied tilts shaped every glitter model since. Private local reference and inspiration only; the glitter graph is not reused.

### Immersive Third Person - Best Of Both Worlds

Published with a support link to cyberdrake on its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/32203). Its scripts and plugins showed how the player state machine's own transform request turns V's body, how locomotion parameters make movement follow the camera, how a mod runs its own third-person camera component beside the first-person one, and that a plugin can swap the native handlers behind the state machine's input reads. Together they mapped what a script can and can't do to steer V. Studied only.

### InteractionUI module

By keanuWheeze, per the credit line in the scripts and Nexus description of [Immersive V Dialogue Expanded](https://www.nexusmods.com/cyberpunk2077/mods/24377), whose copy we read. This small Lua module adds a dialogue hub with its own text to the game's dialogue widget at run time and lets the player choose from it with the usual keys, which is how the bridge's planned NPC choices will ask V a question and hear the answer without authoring a scene. Immersive V Dialogue Expanded showed it in use for replies to Johnny. Studied only; no code is copied.

### Jack Humbert

[Let There Be Flight](https://github.com/jackhumbert/let_there_be_flight), [Mod Settings](https://github.com/jackhumbert/mod_settings) and [Input Loader](https://github.com/jackhumbert/cyberpunk2077-input-loader). Their RED4ext plugins showed how to ship redscript through the plugin itself and declare its natives, and Let There Be Flight's player-attach wrapper is the pattern our bridge's redscript layer follows. Mod Settings' menu-scenario extensions showed that a mod can add its own event to the game's menu scenarios, which is how the bridge asks the idle menu to open the character creator. Input Loader's source showed how mods register new input actions, by merging input files that the game then reads through a configuration redirect, and that it fires none. [Let There Be Flight](https://github.com/jackhumbert/let_there_be_flight) and [Mod Settings](https://github.com/jackhumbert/mod_settings). Mod Settings' menu-scenario extensions showed that a mod can add its own event to the game's menu scenarios, which is how the bridge asks the idle menu to open the character creator, and its pause-menu items showed how a mod adds its own entry to the pause and main menus. Studied only.

### Kala

[Kala's Eyes Standalone V2](https://www.nexusmods.com/cyberpunk2077/mods/3242), whose source eye texture is credited to Sarah Cartwright. Supplies the saved character's eye textures in the preview. Private local reference only; the page's credit, noncommercial and game-use conditions apply.

### KnowSo team

[-KS- UV Texture Framework](https://www.nexusmods.com/cyberpunk2077/mods/3783), crediting original authors Zosoab70 and AllKnowingLion and named contributors. Its skin template and seam-fix resources showed why each file's effective load-order winner must be resolved before changing preview materials, and its head-mesh appearance patch showed that an ArchiveXL patch can change the effective head material chain. Its player-only skin chain, which sets a tattoo overlay as the skin's secondary albedo with a glow mask and overlay normals, showed how overlay tattoo mods work and why only one can be active. Its arm meshes, whose UVs place both arms in the full-body texture, showed that a replaced mesh must be exported from the mod's own copy, never the base game's. Studied only; its asset-reuse conditions would need separate review.

### KOZMETIX

[KOZMETIX](https://www.nexusmods.com/cyberpunk2077/mods/29018), by meluminary per its title. It showed makeup worn as a clothing item with no geometry of its own: it patches its shades into the base game's makeup meshes, aliases their morph targets and hides the base game's lipstick while worn. Studied only.

### Kwek EquipmentEx earrings

An inventory-worn earring mod that provided a packaging precedent for our jewellery construction-set design. Its [Small Fancy Hoop Earrings with Physics](https://www.nexusmods.com/cyberpunk2077/mods/7020) showed how a worn item makes earrings swing: a small dangle rig and simulation of its own, driven by V's skeleton, with the mesh itself left bound to that skeleton. Studied only; its individual authorship is still being confirmed.

### Lizzie's Braindances

By ArmanIII, per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/11077). It showed how braindances can be staged as ordinary scenes and cast at run time: its menu rewrites a few character records before a scene plays so that any chosen character, or V, performs it, switches their outfits through quest events, and lets other mods register more characters. Studied only.

### Lime Makeup Atelier and Anrui's Netrunner Emporium

[Lime Makeup Atelier](https://www.nexusmods.com/cyberpunk2077/mods/18322) sells worn makeup items through a Virtual Atelier in-game shop, a distribution route for makeup that is not part of the character creator. With [Anrui's Netrunner Emporium](https://www.nexusmods.com/cyberpunk2077/mods/12328) it showed that a store mod needs only one registration call listing its items, and an icon. Studied only; their authors are still being confirmed.

### Limerence

[Limerence X AllieKat Winterkissed AXL Eyeshadows](https://www.nexusmods.com/cyberpunk2077/mods/18323) and [Limerence Liners](https://www.nexusmods.com/cyberpunk2077/mods/14780). Winterkissed is a collaboration with AllieKat per its title and description. Its eyeshadow mesh and morph target reuse the base game's eye-makeup geometry unchanged, which confirmed that working face-decal mods sit at the vanilla 0.40 mm offset above the head. Its glitter looks showed how a published glitter eyeshadow is built from the plain decal material (high-resolution metallic maps with embossed shape normals on the vanilla eye-makeup UVs), and led us to the eye plate's much lower texture density. The Liners replace the base game's eye-makeup masks in place, which showed how such replacers conflict per slot. Studied only; private local reference.

### MELUMINARY

[MELUMINARY Long Length Pak Vol. 3 #011](https://www.nexusmods.com/cyberpunk2077/mods/27125) supplies the reference character's optional hair preview. Its maps taught us to check whether an apparently missing texture is constant, and its reused vanilla dangle rig showed how modded hair can inherit the game's simulation. Private local reference only; no assets are redistributed.

### Hair modeling beginner tutorial — eagul and mana vortex

The [beginner hair-modelling tutorial](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial), created by eagul and edited by mana vortex, taught us dense base coverage, progressively lighter outer cards, root reattachment and controlled tilt variation for Hair Lab. Studied as an artist workflow; no tutorial assets are reused.

### ASH SIDESWEPT GLAM — MELUMINARY and Hamed Ghaeli

[ASH SIDESWEPT GLAM](https://www.nexusmods.com/cyberpunk2077/mods/21898) names MELUMINARY as its creator and credits its hair modelling to Hamed Ghaeli. It supplies a private benchmark for side parting and swept-fringe flow. The page prohibits asset reuse; no assets are copied into the project or distributed.

### MIME

[MIME](https://www.nexusmods.com/cyberpunk2077/mods/35483) (Mouse Interactive Model Enhancement; its author is still being confirmed). Its handling of the pointer over V's inventory puppet showed how a mod follows the menu cursor's position by wrapping the cursor controller, and hides and shows the cursor around a drag. Studied only.

### MisterChedda

[Responsive NPCs](https://www.nexusmods.com/cyberpunk2077/mods/14800) and [Responsive V](https://www.nexusmods.com/cyberpunk2077/mods/22694), per the creator link on both Nexus pages. Responsive NPCs showed how far the game's reaction manager can be bent from script: reactions to V's clothing, a naked or broke V, gang vehicles and the current district, read through NPC archetype visual tags and affiliations. Responsive V showed that a voiceset scene can be patched as it loads, the route we plan for voiced reactions. [V's Faceplate (H10)](https://www.nexusmods.com/cyberpunk2077/mods/24599), named by the creator link on its page and its archive's own paths, showed that V's own face, skin and makeup can appear on a prop in the world: it places Phantom Liberty's own V-in-a-tank entity, which carries only the character creator's controllers, with a quest phase, a scene and a sector, and that study shaped XF Finish Showroom's mannequin heads. Studied only.

### Nail mods

[Unique Nails For V - A Framework](https://www.nexusmods.com/cyberpunk2077/mods/10420), [North Oak Nail Spa - Pedicures and Nails](https://www.nexusmods.com/cyberpunk2077/mods/24993), [NC Nails - Pedicure for V](https://www.nexusmods.com/cyberpunk2077/mods/7084) and [Cute Nails - Base Game Nails Morph](https://www.nexusmods.com/cyberpunk2077/mods/21113). Together they showed the ways mods change V's nails: replacing the nail meshes with per-hand materials, patching new appearances into every nail mesh with ArchiveXL, adding wearable nails that hide V's own, and reshaping the nails with a morph. That shaped the proposed Nail Salon export. Studied only; their individual authors are still being confirmed.

### Native Interactions Framework

By keanuWheeze, per its script header. [GitHub](https://github.com/justarandomguyintheinternet/nativeInteractions), [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/21422). Its editor camera, which pulls the first-person camera behind V and widens its limits, and its usable spots built as scene interactions showed which interactions only input can choose. How it starts its scenes through one quest phase and a pair of facts, patches each scene as it loads (choice ids, node refs, option text) and hears a scene end through an event on the player is the route a later XF conversation scene would take. Studied only; its licence asks for credit or permission before code is reused, and none is.

### Night City Allies

By Andre Fuchs, per the copyright line of its bundled licence. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/27625). Its scripts showed how a mod raises a phone-message toast for a contact of its own, opens that contact's thread from the toast, and clones and edits TweakDB records at run time.  Its persistence code showed a `ScriptableSystem` that keeps its blackboard listeners (menu, phone, radial, scanner, quickhack panel, scene tier, elevator, workspot) and registers them with the player and unregisters them with it, the pattern a world event feed would follow. Studied only; none of its code is used. Its persistent data and migration scripts showed a stored version number with an ordered list of migrations run on load.

### RPG Progression System

[Nexus](https://www.nexusmods.com/cyberpunk2077/mods/35201). The scripts name no author. Its hook files showed which game methods a mod wraps to learn of kills, defeats, bounties, heat, vehicle entry and exit, vehicle purchases and rewards (`ScriptedPuppet` death and defeat, `NPCPuppet` status effects, `BountyManager`, the prevention system's private timers, `VehicleObject` mounting, the vehicle shop controller, `RPGManager.GiveReward`), that wrapping private methods works, and the pitfalls its authors recorded: a defeat and a later death are two events, a damage hook that receives every hit must be gated on the hit's class, and hooks run during load before the mod's own system attaches. Studied only; none of its code is used. Its comments also recorded that a system's persistent fields read as defaults in `OnAttach` and that persistent arrays of different lengths in an old save crashed the game.

### NightlyNow Core

By NightlyNow. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/28966). Its phone framework, whose header credits the original concept to r457 and gh057 with fixes by DigitalVixen, showed how a mod adds a phone contact and a whole text conversation with replies and typing dots without any journal entries, and how interaction prompts can appear where there is no device. Studied only.

### Nola Dreamer

Nola Dreamer's hair Sofie, per its title, one of the creator's "Physics enabled" CCXL hair packs ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/21844)). Its five parts, each with its own dangle rig and simulation driven by V's helper-joint rig, showed the second way CCXL hair declares physics, and its tuned and transplanted parts side by side showed how far creators adjust the game's physics values. Studied only; private local reference.

### NoraLee

[Morphtarget and AnimRig Additions](https://www.nexusmods.com/cyberpunk2077/mods/4673). Its alternative teeth resources reinforced the need to resolve each file's effective winner. Studied only; the page prohibits reuploads of the framework.

### nutboy

[Unique Eyes to CCXL](https://www.nexusmods.com/cyberpunk2077/mods/23263), which itself credits psiberx, icxrus, halvkyrie and another creator (redacted-c01). It resolves the saved character's eye choice and gave us a concrete case for reading character-creator option catalogues. Their CCXL hair-profiles guide on the modding wiki walks through the shared template that every hair-colour pack we studied follows, including why each colour needs a tag for hair under hats. Studied only; the page requires permission for asset reuse or modification.

### ObiOneStenobi

[Advanced Pose Mod](https://www.nexusmods.com/cyberpunk2077/mods/35013), by ObiOneStenobi (per the licence file in its package, MIT). Its pose-editor panel over photo mode showed how a mod keeps its own layer on top of photo mode's menu across sessions, takes the mouse from the camera while the pointer is over its panel, and measures where the interface sits on wider screens. Studied only; nothing is copied.

### Photo Mode UI Improvements and Character Creator UI Improvements

[Photo Mode UI Improvements](https://www.nexusmods.com/cyberpunk2077/mods/34353) and [Character Creator UI Improvements](https://www.nexusmods.com/cyberpunk2077/mods/34310) (their authors are still being confirmed). Their overlays inside the photo-mode menu and the character creator showed which controller callbacks, input contexts and root widgets a panel of ours can use, how it holds photo mode's own keys off while it has focus, how it measures the menu's width on an ultrawide screen, and which techniques crashed the game for them. Studied only.

### Photo-mode pose and tool mods

[Photo Mode Pose Selector](https://www.nexusmods.com/cyberpunk2077/mods/32633) and [Photo Mode Preferences](https://www.nexusmods.com/cyberpunk2077/mods/32736) (both by cjsu, per their Nexus descriptions), [Photo Mode Unlocker XL](https://www.nexusmods.com/cyberpunk2077/mods/4319) (SilverEzredes, per its tweak file), [Portrait Enhancer for Photo Mode](https://www.nexusmods.com/cyberpunk2077/mods/8237), [Customisable Photo Mode UI](https://www.nexusmods.com/cyberpunk2077/mods/32815), [Ziva Photoshoot Posepack](https://www.nexusmods.com/cyberpunk2077/mods/8463) (EzioMaverick, per its tweak file), [Action Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/8698), [Dancy - Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/18007), [Serene - Female Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/24430), [Venus pose pack](https://www.nexusmods.com/cyberpunk2077/mods/26081) (juztNea, per its pose file) and [Multi Pose Pack Framework](https://www.nexusmods.com/cyberpunk2077/mods/4098). Together they showed how poses reach photo mode (animation sets added to the photo-mode entities or scopes, plus pose and category records), how the menu's lists can be widened, and which menu attributes select V's and NPCs' expressions, which a future in-game test can drive directly. Photo Mode Pose Selector's small redscript system, which records the photo-mode V puppet when photo mode sets it up, showed us how to find that puppet from the CET console. Photo Mode Preferences and Photo Mode Pose Selector showed which menu attribute numbers drive the camera, V's placement, lights and expressions and how to set them through the menu's own items, which the XF Runtime Bridge's photo-mode commands use; Photo Mode Preferences also showed that settings re-applied as photo mode opens can race other changes, and that a light must be selected and given a moment before its values are set. Photo Mode Unlocker XL's tweaks showed the photo-mode camera limits and first-person restriction lists, which told us the bridge's restricted photo mode came from somewhere else; Portrait Enhancer showed that the camera presets are plain records, a route to repeatable framing, and its rolled portrait presets explained a sideways camera in our third test session, which is why the bridge's own presets now load last and the bridge levels the camera after selecting one; Customisable Photo Mode UI mapped the photo-mode menu's widget tree. Photo Mode Pose Selector's saved character positions (each character captured by switching the menu's selection and waiting for fresh values), its freeze of one character through time dilation, and its re-applied look-at after a reset shaped the photo-mode snapshot design's capture, restore order and gaze freeze. Photo Mode Pose Selector's searchable lists, starred favourites, arrow-key stepping and per-character freeze shaped the Studio's pose panel design, and its note that a browser across categories needs an index beyond the menu's own list is what the Studio's offline pose catalogue provides. Serene's records showed the everyday pose-pack shape (literal pose and category names, `!append-once` onto the pose lists, reuse on NPC lists), juztNea's 10,000 steps pose pack (per its tweak file) showed a category record naming itself in `categoryName`, the shape the bridge's live-pose test package follows, Venus pose pack showed the separate AMM-only pose list that photo mode never sees, and Multi Pose Pack Framework's replaced photo-mode entities showed the older route of empty numbered animation-set slots. Photo Mode Preferences' staged apply order and effect ranges showed how exposure and the other effect rows map to raw values, Photo Mode Pose Selector's native helper showed where photo mode keeps the NPC being edited, and Customisable Photo Mode UI's widget walk showed how to hide the menu's hint panels for a clean capture. Studied only.

### Physics earrings

[Claire's Jewellery with physics](https://www.nexusmods.com/cyberpunk2077/mods/12863) makes a worn earring swing by reusing the base game's own earring rig and simulation from an NPC's jewellery, which showed that vanilla dangle sets carry over to V unchanged. Studied only; its author is still being confirmed.

### psiberx

[Photo Mode Ex](https://github.com/psiberx/cp2077-photomode-ex), [Equipment-EX](https://github.com/psiberx/cp2077-equipment-ex), [Cyberware-EX](https://github.com/psiberx/cp2077-cyberware-ex), [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) and [CET Kit](https://github.com/psiberx/cp2077-cet-kit). Their source taught us how photo mode works internally, how scriptable systems and wrapped methods are written, how script logging is captured, and how to detect sessions and photo mode from Lua. Photo Mode Ex's native attribute calls, character layout and per-character pitch and roll showed why photo mode's own save slots miss its rows and how a snapshot can read them. Photo Mode Ex and Equipment-EX also confirmed photo-mode attribute numbers the bridge uses, and Photo Mode Ex showed that depth of field can persist into saves, which the bridge's session scripts avoid. Equipment-EX's source also showed how its outfits persist in saves, which extra outfit slots it adds with their layer offsets, and how it takes over the wardrobe. Photo Mode Ex's native hooks showed which parts of the photo-mode system scripts cannot reach, how extra photo-mode characters are registered from records, and how an option list and its label are rebuilt. Red Hot Tools' source showed how archives can be hot-reloaded into a running game, which the expression editor design proposes for previewing an authored expression in game, and that resources already held by the game keep their old data until they are requested again, which shapes the pose editor's hot-reload fallback, and its world inspector showed how a streamed node maps back to its sector and placement index and how the world can be streamed around any point. psiberx also exported the scripting RTTI dump we use to check native function names offline, to know each resource class's properties in XF Studio's archive reader, and to name the engine's enums and types inside saves. Equipment-EX's saved outfits were the test case showing that a script mod's save data decodes from the save's own type information. Photo Mode Ex's hooks also showed photo mode's native lifecycle and how it places characters, which explains the placement axes and range the bridge's framing met. Red Hot Tools' widget inspector showed how the game's UI layers, HUD entries and world widgets are organised and how the topmost layer can take the game's cursor for an in-game interact mode, and Equipment-EX's handling of the inventory puppet showed where the paperdoll's 3D preview can be reached. Equipment-EX's outfit system also explained session 6's contradictory wardrobe reading (it wraps the visual-set check and replaces the vanilla wardrobe calls), and its public outfit functions and its handling of the story's own disable and restore requests are how the bridge shows an item in its outfit or takes the outfit off for a capture; its outfit-slot configuration (which body slots each outfit slot covers) is how the bridge's wardrobe state says what V shows under its outfit. Studied only. The same dump told us which TweakDB record classes and getters exist, so the population records could be read by type. The reactive session observer in his CET Kit (`GameSession.lua`, as shipped inside other studied mods) showed which game methods mark a session's start, end, save, load, pause and the player's death, and that the main character's `OnTakeControl` is the late signal for a finished load. Studied only. CET Kit's GameSession showed how a mod can join a per-save file to its save with a quest fact that it renews after every save, and Codeware's wiki states that its before-save event holds the save until the callback returns; both inform the Story Engine's save-key proposal.

### Dark Future and Vehicle Navigation System

[Dark Future](https://www.nexusmods.com/cyberpunk2077/mods/16300) (DarkFortuneTeller, per the GitHub source its Nexus page links) and [Vehicle Navigation System](https://www.nexusmods.com/cyberpunk2077/mods/28241) (Scream81, per its script header). Their HUD meters and navigation panel showed how a mod adds its own widgets to the game's HUD layer, checks for ones it left there earlier, and scales them to the screen, the approach the XF Runtime Bridge's in-game panel follows. Studied only.

### Inventory HUD Night City UI

[Inventory HUD Night City UI](https://www.nexusmods.com/cyberpunk2077/mods/35277), by Charlotte (charlotte27k, per its own copyright notice). Its notes that the menu layer is laid out in screen pixels while the game scales each page root itself pointed us at measuring how the HUD layer's root maps onto the screen, instead of assuming it, which is how the XF Runtime Bridge's ink panel now finds the visible screen. Studied only; its terms forbid reuse, and none is made.

### Ascral - HUD Editor and Painter

[Ascral - HUD Editor and Painter](https://www.nexusmods.com/cyberpunk2077/mods/35236) (its author is still being confirmed). It measures the HUD's widgets against their rectangles on screen through the game's own layout, which showed that the HUD layer's units can be checked in game rather than guessed, and it builds its own pointer from input actions it consumes, which showed what a layer without a game cursor takes. Studied only.

### Sheng Noods Ramenshop

[Sheng Noods Ramenshop](https://www.nexusmods.com/cyberpunk2077/mods/25294) (its author is still being confirmed; its Nexus page thanks Hepero for its map-icon script). Its map pin showed how a mod registers a runtime map pin and gives it its own icon and tooltip by wrapping each pin controller's icon update, the technique behind the bridge's XF map pins, which draw their badge in ink instead of an icon file. Studied only.

### SEDTH

[Sandevistan CCXL Tattoo](https://www.nexusmods.com/cyberpunk2077/mods/20345) and [Photon Spine Cyberware](https://www.nexusmods.com/cyberpunk2077/mods/26973), by SEDTH per their file names. Sandevistan showed a tattoo added as its own character-creator row, with a head and a body decal fitted to each supported body and one choice per body, writing colour, relief, roughness and metalness; Photon Spine showed an overlay tattoo that also ships a glow mask and overlay normals. Studied only.

### Stock Market and News System

By keanuWheeze, per its script header. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/6319). Its Lua showed how news can be generated from what V does and from vanilla quests finishing, delivered as phone messages from a contact that exists only in the phone's lists, and how a CET mod ties its own per-save data file to a save. Studied only; its terms ask for credit or permission before code is reused, and none is. Its copy of psiberx's session code is one of those studied for the save key: a fact-held key renewed after each save and joined to a per-save data file.

### Street Sense

[Street Sense](https://www.nexusmods.com/cyberpunk2077/mods/28989), part of the DigitalVixen mod suite per its Nexus description. Its clothing-driven crowd reactions (revealing, positive, intimidating, fear and annoyed outfits, each with a distance, chance, voice trigger and facial reaction) are a worked example of the rule-based assessment layer we plan, and its note that ArchiveXL dynamic items can lose TweakXL tags explained why it keeps a list of mod items. Studied only.

### Tattoo overlay mods

Sun Moon And Stars Tattoo, Serpentine Heart and its Remix, Graceful Tattoo, Brooke Candy Inspired Tattoo Overlay, Floral Themed Tattoo Overlay, Deej's Mandala Geometry (by Deej per its title, with a KSUV conversion its description credits to MeltingAngels) and Bedellia's Bad Girl and Geometric overlays (by Bedellia per their titles). Together they showed that overlay tattoo mods each replace the texture framework's one overlay file, sometimes with the skin's roughness map for glossy ink, which is why they cannot be combined without merging images. Studied only; most of their authors are still being confirmed.

### Ultra+

[Ultra+](https://www.nexusmods.com/cyberpunk2077/mods/10490), by the Ultra Team per its licence, with its source at [sammilucia/cyberpunk-ultra-plus](https://github.com/sammilucia/cyberpunk-ultra-plus) per its own metadata. Its configuration showed which engine settings shape V's skin beyond the graphics menu: it sets the subsurface-scattering quality per quality tier and the skin's subsurface specular tint and ambient factors per rendering mode, and it exposes the character subsurface translucency toggle. Knowing this explained an inconclusive in-game skin comparison and made these settings part of every capture record. Studied only; nothing is copied (its licence is proprietary).

### Urmland Street Arcade

[Urmland Street Arcade](https://www.nexusmods.com/cyberpunk2077/mods/23908). Its world resources showed how a small location is added with ArchiveXL: the base game's own arcade, pachinko and vending devices placed in a new streaming block, a devices patch, and a few base-game nodes removed where it stands. Studied only; its author is still being confirmed.

### Vendor and bartender dialogue mods

[Immersive Food Vendors](https://www.nexusmods.com/cyberpunk2077/mods/7322) and [Immersive Bartenders](https://www.nexusmods.com/cyberpunk2077/mods/7203). Their packages showed that conversations with vendors are carried by scenes whose own text is registered through ArchiveXL's subtitle localisation, the route for custom choice text in a scene. Studied only; their authors are still being confirmed.

### Virtual Atelier, Virtual Atelier Delivery and Virtual Car Dealer

By DJ_Kovrik (djkovrik), whose [GPL-3.0 repository](https://github.com/djkovrik/CP77Mods) publishes their source. [Virtual Atelier](https://www.nexusmods.com/cyberpunk2077/mods/2987) showed how other mods plug stores into one framework through a registration event, how it reuses the base game's vendor screen, and how a new tab joins a computer's menu (a technique its code credits to NexusGuy999). Virtual Atelier Delivery showed how a mod sends phone messages by rewriting pre-authored journal messages from script, spawns its own devices with new interactions, and adds billboards through TweakXL records; Virtual Car Dealer showed a browser page with its own controller and prices set when the tweak database loads. Virtual Atelier Delivery also showed a delivery clock kept in game time that pauses during braindances, while V is Johnny and in the time-skip menu, and map pins that come with a spawned drop-point device. Studied only.

### Voiced quest mods

[I Really Want To Stay At Your House - Judy](https://www.nexusmods.com/cyberpunk2077/mods/8753), [Lizzie's Braindances](https://www.nexusmods.com/cyberpunk2077/mods/11077) (by ArmanIII, per its script headers) and [Roller Coaster Enhanced](https://www.nexusmods.com/cyberpunk2077/mods/14617) (authors of the other two not yet checked). Their packages showed how voiced quest mods give their scenes lip sync today: per-language lip-sync maps registered with ArchiveXL that point at the game's existing clips, with no generated animation. Studied only.

### Watson Tattoo Shops

[Watson Tattoo Shops](https://www.nexusmods.com/cyberpunk2077/mods/23896). Its two shop interiors with a chair that opens character customisation showed how a location mod can make getting a tattoo part of the world. Studied only; its author is still being confirmed.

### World Builder and Removal Editor

By keanuWheeze (GitHub account justarandomguyintheinternet) and contributors, per its source and commit history. [World Builder](https://github.com/justarandomguyintheinternet/CP77_entSpawner) ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/20660)) and its companion [Removal Editor](https://github.com/justarandomguyintheinternet/CP77_removalEditor). World Builder showed how the community builds locations in the running game and turns them into ordinary streaming sectors: one saved group per sector, its export format, how each placeable type maps to a world node, how communities, devices and variants are exported, and how previews are spawned as entities. Its light previews, an empty entity given a light component built from saved data as it assembles, showed how every light field can be set at run time, the route the XF Runtime Bridge's lighting mirror plans. The Removal Editor's deletion files showed that recording each removed node's name, reference, resource and position lets a removal be re-matched after a game update. Studied only; the source carries no open licence and asks for credit or permission before reuse, so only its data formats are described.

### World and location mods

World Objects Removed, Crunch Plaza Expanded, Japantown North Verticality Expanded, Northside Metro and Inside The NCART Station (both by tidusmd, per their script headers), Underground Casino, Apartments Enhanced, The Glen PROJECT, Corpo Rooftop Bar, Ghosts of Night City, Echos of Loss, People of Night City, Eden Plaza penthouse and New Lore Friendly Holographic Ads. Together they are the worked examples for XF Studio's world research: prop-built interiors in new sectors, removals and moved nodes in vanilla sectors, device patches for elevators and doors, a quest phase that runs a casino's doors, NPC scenes placed through AI spots and communities, compatibility builds that delete another mod's nodes, and, by contrast, an in-place texture replacement. Studied only; most of their authors are still being confirmed.

### xBaebsae

[Facial Customisation Rig Fix](https://www.nexusmods.com/cyberpunk2077/mods/7179) and [Photomode Facial Expression Mega Pack](https://www.nexusmods.com/cyberpunk2077/mods/7912), and [Photomode NPCs Extended](https://www.nexusmods.com/cyberpunk2077/mods/18837), whose records showed how any character becomes selectable in photo mode (with Photo Mode Ex), a route to a reference character beside V in tests. The expression pack showed the whole route by which photo mode gains expressions: new expression records, extra rows in the game's expression table, clips attached to the photo-mode face rig, and a face-graph change that lets animated expressions loop. It also showed that the table and graphs are files only one mod can own, which shapes the Studio's export plan. Its patch of the photo-mode face rig and its menu records, which name each face in plain text, showed what an expression mod's files contain, the shape XF Studio's expression export follows. The rig fix's alternative head morph reinforced the need to resolve each file's effective winner, and showed that a head fix can keep the geometry while renaming per-target bone names, which the built-in eye plate now carries over. That fix is also why we read morph targets' own joint binds as active at runtime, which the preview's blink now follows for each eye shape. Its `.xl` patches every feminine and masculine player entity, the always-on route the Studio's resolver does not follow yet. The Modding Docs' description of V Texture Kit showed a second overlay layout that keeps separate textures for each arm. Studied only.

### XUtils

[XUtils](https://www.nexusmods.com/cyberpunk2077/mods/30296). Its notification script showed that the game's banner and subtitle lines are one blackboard value each, with fifteen banner types. The package names no author. Studied only.

## Story and game design

These games, books, essays and talks informed the design of the planned Story Engine, our research into generated gigs, quests and encounters. Nothing from them is implemented yet. They are credited for ideas only, and no text, content, code or assets are used. The vendored copy of psiberx's GameSession in this package and in BetterFuelSystemReloaded was the version read for save keys.

### Emily Short and Failbetter Games

Emily Short, ["Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative Structures"](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/) (2016), and [Fallen London](https://www.fallenlondon.com/), created by Alexis Kennedy and developed by Failbetter Games. Failbetter's quality-based narrative offers small pieces of story, called storylets, when the numbers that track a player's skills and progress (qualities) allow them, and Short's essay sets it beside other ways of choosing what happens next. It taught us to gate content by state rather than by branches. Short's ["Storylets: You Want Them"](https://emshort.blog/2019/11/29/storylets-you-want-them/) (2019) defines a storylet as content, prerequisites and effects, and explains why a branching "time cave" loses the benefits; her ["Small-Scale Structures in CYOA"](https://emshort.blog/2016/11/05/small-scale-structures-in-cyoa/) (2016) catalogues beat-level choice patterns. Failbetter's [Fallen London Writer Guidelines, Part II](https://www.failbettergames.com/news/fallen-london-writer-guidelines-part-ii) (2015) advise keeping qualities few and never trapping a player in a chain of linked events, and Alexis Kennedy's [Sunless Sea postmortem](https://www.gamedeveloper.com/audio/postmortem-failbetter-games-i-sunless-sea-i-) (Game Developer, 2015) records how a reused story engine collected special cases and hand-edited data stopped scaling. Her [“Bowls of Oatmeal and Text Generation”](https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/) (2016) argues that generated text engages only where it connects to what happens in the game, and that procedural generation is a way of designing content, not a shortcut. Her recaps of James Ryan's thesis, [chapters 1 to 3](https://emshort.blog/2019/05/21/curating-simulated-storyworlds-james-ryan/) and [chapter 6 onward](https://emshort.blog/2019/05/28/curating-simulated-storyworlds-james-ryan-ch-6f/) (2019), gave an independent view that retelling alone does not make a generator succeed, and record Ryan's own admission that his simulated knowledge was not prone to narrative intrigue. Short's "Beyond Branching" essay also described the bookkeeping that quality-based authoring demands and how hard such systems are to test, which shaped how we think about authoring tools.

### Kate Compton

By Kate Compton. ["So you want to build a generator…"](https://galaxykate0.tumblr.com/post/139774965871/so-you-want-to-build-a-generator) (blog post, 2016). Her 10,000 bowls of oatmeal problem points out that thousands of bowls can all differ mathematically while the person looking sees only oatmeal. It taught us to measure variety by what people can tell apart, not by how many combinations exist. Katherine Cross's [report of her GDC talk](https://www.gamedeveloper.com/design/practical-procedural-generation-for-everyone-) (Game Developer, 2017) adds that a smaller set of clearly different things beats many that cannot be told apart, and suggests asking whether players would write fan fiction about a generated thing.

### Tynan Sylvester and Ludeon Studios

By Tynan Sylvester. ["The Simulation Dream"](https://www.gamedeveloper.com/design/the-simulation-dream) (essay, 2013), and [RimWorld](https://rimworldgame.com/), developed by Ludeon Studios. The essay argues that a simulation adds value only as far as players can perceive and understand it, and RimWorld puts a storyteller in charge of when events arrive. We took from them that simulation nobody perceives is wasted, and that a director who paces events can shape a story. The community-written RimWorld wiki pages on [Cassandra Classic](https://rimworldwiki.com/wiki/Cassandra) and the other storytellers show fixed On and Off cycles, guaranteed events and spacing, and a storyteller's cadence kept apart from the difficulty setting. They informed how we keep pacing separate from challenge. The wiki's [Thoughts](https://rimworldwiki.com/wiki/Thoughts) page lists mood memories that expire after a fixed number of days, a plain example of timed forgetting in a shipped game.

### Valve and Michael Booth

[Left 4 Dead](https://store.steampowered.com/app/500/Left_4_Dead/) (Valve, 2008) and Michael Booth's [The AI Systems of Left 4 Dead](https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf) (Valve's slides from his AIIDE 2009 invited talk). The AI Director estimates how intense each player's moment is, removes major threats for a while when intensity runs too high, and otherwise supplies them. It is our model for pacing intensity around the people playing. Elan Ruskin's GDC 2012 talk on dynamic dialogue at Valve, as recapped by Emily Short on [her blog](https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/), showed rule matching in which the most specific matching rule wins and general rules serve as fallbacks. Booth's slides also give the intensity number that decays towards zero unless enemies are actively engaging the player, and the director's four phases of build up, sustain peak, peak fade and relax, each with its own timing. They informed how we think about pacing as a loop of pressure and rest.

### Michael Mateas and Andrew Stern

[Façade](https://www.interactivestory.net/) (Procedural Arts, 2005) and their paper ["Façade: An Experiment in Building a Fully-Realized Interactive Drama"](https://faculty.cc.gatech.edu/~isbell/classes/reading/papers/MateasSternGDC03.pdf) (Game Developers Conference, 2003). A drama manager chooses the next beat, the smallest unit of dramatic action, from a pool of authored beats, each marked with preconditions and effects on the story state. We took from it the beat as a unit of authored content and the manager that sequences beats. Their paper ["Structuring Content in the Façade Interactive Drama Architecture"](https://ojs.aaai.org/index.php/AIIDE/article/view/18722) (AIIDE 2005) describes beats with preconditions, weights, priorities and effects on tension, and what authoring them cost. Mateas's ["A Preliminary Poetics for Interactive Drama and Games"](https://www.cs.uky.edu/~sgware/reading/papers/mateas2001preliminary.pdf) (2001) sets unity of action against episodic structure and treats agency as an effect that relates to the player's intent. That paper also counts the nested grains of Façade's content, from beats of 10 to 100 joint dialogue behaviours down to exchanges of one to five lines, and is candid that although thousands of beat sequences are possible, few of them play meaningfully differently. It taught us to count distinct outcomes, not combinations.

### Tarn and Zach Adams

[Dwarf Fortress](https://www.bay12games.com/dwarves/) (Bay 12 Games, first released 2006). Each world's history is simulated before play, and Legends mode lets players read it back. It taught us that a simulated world history is a rich source of background for stories to draw on.

### Worldwalker Games

[Wildermyth](https://wildermyth.com/) (Worldwalker Games; released 2021) and the developer's [interview with Turn Based Lovers](https://turnbasedlovers.com/10-turns-interview/with-wildermyth-developer) (2019). Each authored event has roles to fill, like a play, and the game casts its generated heroes into them according to personality and the writers' requirements. We took from it the casting of characters into authored story fragments.

### Vincent Baker and Meguey Baker

[Apocalypse World](https://lumpley.games/), by D. Vincent Baker (Lumpley Games, first edition 2010), with Meguey Baker as co-designer of the second edition (2016). Its fronts group the threats around the characters, and a threat can carry a countdown clock that says when it will act, so threats keep their own momentum whatever the characters do. We took from it threats that sit above the scene and move on their own timetables.

### John Harper

[Blades in the Dark](https://bladesinthedark.com/) (Evil Hat Productions, 2017). Flashbacks let players settle their preparation at the moment it matters, for a cost, and faction clocks advance during downtime so the city changes without the crew. We took from it preparation that resolves late and a world that keeps moving on its own. Its plan types, engagement roll, heat and entanglements also taught us how a job's approach shapes its opening and what it leaves behind. Its [progress clocks](https://bladesinthedark.com/progress-clocks) come in several sizes and types, and Mike Shea's [Progress Clocks for Complex Situations in D&D](https://slyflourish.com/progress_clocks_in_dnd.html) shows the same device as a danger clock, with the advice not to hide it from the players.

### Justin Alexander (The Alexandrian)

[Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule) (2008) and the nine-part series [Node-Based Scenario Design](https://thealexandrian.net/wordpress/8122/roleplaying-games/node-based-scenario-design-collectors-edition). The first says to give at least three clues for any conclusion the players must reach, because one may be missed, ignored or misread. The second builds a scenario from nodes that clues point to, so players can move through it in different orders. Together they taught us robust discovery, where no single missed clue stops the story. His [Scenario Structure Challenge #4: Heists](https://thealexandrian.net/wordpress/42867/roleplaying-games/scenario-structure-challenge-4-heists) (2019) breaks a heist scenario into five steps (identify the score, gather information, onsite surveillance, prep work and the operation), which gave us a reusable shape for job-style quests. His [Don't Prep Plots](https://thealexandrian.net/?p=4147) argues for preparing situations rather than plots, and for deciding what the opposition does if the players never step in. It informed how we think about a world that acts without the player. His [Open Table Manifesto, Part 3](https://thealexandrian.net/wordpress/38669/roleplaying-games/open-table-manifesto-part-3-organizing-your-open-table) (2016) ends each session with the characters back at base, which suits a table with a calendar. His [GMing on a Time Limit](https://thealexandrian.net/wordpress/53333/roleplaying-games/random-gm-tip-gming-on-a-time-limit) (2026) advises pruning towards the conclusion, framing scenes late and settling what is left in broad strokes. They informed how we think about session endings and playing to a time budget.

### Mike Shea (Sly Flourish)

By Michael Shea, who writes as Sly Flourish. [Return of the Lazy Dungeon Master](https://shop.slyflourish.com/products/return-of-the-lazy-dungeon-master) (2018) and his post [Types of Secrets](https://slyflourish.com/types_of_secrets.html) (2021). Secrets and clues are short statements about the world or the story, kept apart from where they are found so they can be dropped in wherever they fit. It taught us to hold story information that is not tied to a place. His [Quantum Ogres and the Eight Steps](https://slyflourish.com/quantum_ogres_and_the_eight_steps.html) taught us to prepare parts and assemble them to fit the choice a player makes. His [Starting Strong](https://slyflourish.com/starting_strong.html) (2015) advises opening a session with a strong scene that pulls players straight in. It informed how we think about how a stretch of play begins.

### Keith Johnstone

[Impro: Improvisation and the Theatre](https://www.taylorfrancis.com/books/9781136610462) (Faber and Faber, 1979; the link is the later Routledge edition). Johnstone's accounts of status, of accepting or blocking what a partner offers, and of reincorporating earlier material gave us a craft vocabulary for how characters and events respond to one another.

### Christopher Alexander and colleagues

[A Pattern Language](https://global.oup.com/academic/product/a-pattern-language-9780195019193) (Oxford University Press, 1977), by Christopher Alexander, Sara Ishikawa and Murray Silverstein, with Max Jacobson, Ingrid Fiksdahl-King and Shlomo Angel. Its 253 patterns run from whole regions down to construction details, and each points to related patterns above and below it in scale. It is the model for the Story Engine's design composite, a set of linked patterns at many scales.

### Maxis

[The Sims](https://en.wikipedia.org/wiki/The_Sims_%28video_game%29) (Maxis, 2000), designed by Will Wright. Each Sim has a small set of needs, such as hunger, comfort and social contact, which fall over time and which objects in the world can restore. It informed our draft catalogue of character drives. Kenneth Forbus and Will Wright's ["Some notes on programming objects in The Sims"](https://qrg.northwestern.edu/papers/Files/Programming_Objects_in_The_Sims.pdf) (2001) explains how objects advertise to needs and how a Sim's personality scales the effect.

### Bethesda Game Studios

The Radiant AI and Radiant Story systems of *The Elder Scrolls IV: Oblivion* (2006) and *The Elder Scrolls V: Skyrim* (2011), as described in Matt Bertz's [The Technology Behind The Elder Scrolls V: Skyrim](https://gameinformer.com/games/the_elder_scrolls_v_skyrim/b/pc/archive/2011/01/17/the-technology-behind-the-elder-scrolls-v-skyrim.aspx) (Game Informer, 2011). Radiant AI gives characters broad goals to work out for themselves, and Radiant Story fills reusable quest templates from a player's history and nearby characters. Bethesda took on both ideas early and at great scale, and we read them as a cautionary example: template quests need variety the player can feel, and free-running character simulation needs constraints to stay on the story. Bruce Nesmith's 2012 talk on Radiant Story, reported by [GamesBeat](https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/), showed that realistic reactions are not always good play and that job quests worked best when limited to characters who suited them. An unsigned GamesBeat column, ["Dimming the Radiant AI in Oblivion"](https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/) (2010), described how autonomous characters can remove the people a story needs.

### Ubisoft Toronto

Christopher Dragert and Jurie Horneman, as described in Daniel O'Connor's [Watch Dogs: Legion – The Tools That Built London](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london) (Ubisoft News, 2021), and Brandon Hennessy's GDC 2023 talk on the game's narrative design, as reported by Justin Carter in [How Watch Dogs: Legion changed Ubisoft's narrative design](https://www.gamedeveloper.com/marketing/how-i-watch-dogs-legion-i-made-ubisoft-rethink-its-storytelling) (Game Developer, 2023). The game's Player Attention System takes requests that each carry a priority, a lifetime and an attention need, and offers the player the most pressing one when they are ready; its writers made up for unknown cast members with fixed, authored characters and treated one-off missions as isolated. We took from them how to queue offers to the player, and what writers cannot assume about who will play a part. Jurie Horneman's own post, [Watch Dogs: Legion and the Player Attention System](https://toronto.ubisoft.com/watch-dogs-legion-and-the-player-attention-system/) (Ubisoft Toronto), adds that one arbiter handles both missions and dialogue, that a request can carry a maximum wait and tolerated distractions, and what a system cannot know about a player's attention.

### Crusader Kings III and RimWorld modding wikis

The community-written [Event modding](https://ck3.paradoxwikis.com/Event_modding) page of the Crusader Kings III wiki (Paradox Interactive's game) and the [Modding Tutorials/Quests](https://rimworldwiki.com/wiki/Modding_Tutorials/Quests) page of the RimWorld wiki (Ludeon Studios' game). The first shows triggers that must pass before an event fires and a fallback option that appears when no other option qualifies; the second shows a quest being test-run when it is considered for generation, before it takes effect. They taught us to plan for the case where nothing fits, and to check a quest before it is committed. The RimWorld wiki's [Modding Tutorials/PatchOperations](https://rimworldwiki.com/wiki/Modding_Tutorials/PatchOperations) page also showed how patching replaced whole-definition overwrites and how a failed patch can hide later errors. The Quests page's own warning that quests are hard to extend shaped how we think about what a pack author can reasonably write.

### Robin Laws

Robin D. Laws's GUMSHOE investigative role-playing system (Pelgrane Press, 2007), through Pelgrane's [GUMSHOE Rules Summary](https://pelgranepress.com/2017/09/29/gumshoe-rules-summary/) (2017). Clues the players must have are handed over when a character uses a fitting ability, and extra clues are optional. It taught us to separate what a story needs the player to learn from what merely enriches it.

### Justin Andress

By Justin Andress. [An Ode to Preston Garvey](https://www.inverse.com/article/14519-an-ode-to-preston-garvey-the-minuteman-of-fallout-4-who-deserves-a-defender) (Inverse, 2016), an essay on the character who keeps handing out generated quests in *Fallout 4*. It showed how a generated offer that keeps coming whatever the player is already doing reads as a nuisance.

### Sam Kabo Ashwell

By Sam Kabo Ashwell. [Standard Patterns in Choice-Based Games](https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/) (essay, 2015). It names recurring branching shapes, such as the time cave, the gauntlet, branch and bottleneck, the sorting hat and floating modules. It taught us which shapes collapse without a large volume of content.

### Josh Sawyer

Josh Sawyer of Obsidian Entertainment, in Kirk McKeand's [interview on branching dialogue](https://www.pcgamesn.com/josh-sawyer-branching-dialogue-ai) (PCGamesN, 2017). He names authorship, not storage, as the bottleneck of reactive writing. It taught us to count the cost of reactivity in writers' time.

### David Bordwell

By David Bordwell. [One last big job: how heist movies tell their stories](https://www.davidbordwell.net/blog/2017/10/12/one-last-big-job-how-heist-movies-tell-their-stories/) (essay, 2017). It lays out a five-stage heist plot of circumstances, recruitment, planning, execution and aftermath, and how suspense depends on what the audience knows. It gave us a stretchable shape for job-style quests. His [Hitchcock, Lessing, and the bomb under the table](https://www.davidbordwell.net/blog/2013/11/29/hitchcock-lessing-and-the-bomb-under-the-table/) (2013) shows that the familiar split between suspense and surprise has an older and murkier history than its legend suggests.

### Brandon Sanderson

Brandon Sanderson's 2025 writing-class lecture on plot, in the write-up on his [official blog](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2). A plot makes a promise, shows progress towards it and pays it off, and plots nest inside one another. It taught us a plain vocabulary for how a quest holds attention from start to finish.

### Warren Spector

By Warren Spector. [Postmortem: Ion Storm's Deus Ex](https://www.gamedeveloper.com/design/postmortem-ion-storm-s-i-deus-ex-i-) (Game Developer, 2000). It records the team's decision to build multiple solutions by hand where the simulation was too shallow to supply them. It taught us the cost of reactive quest design that rests on authored alternatives.

### Koichi Hayashida

Koichi Hayashida of Nintendo, in Christian Nutt's interview [The secret to Mario level design](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design) (Game Developer, 2012). He ties level design to a four-beat shape of setup, development, twist and conclusion, taken from four-panel comics, and stresses the surprise in the third beat. It gave us a compact beat shape for short encounters.

### Daggerfall Unity

The Daggerfall Unity project's [Quest System Status](https://www.dfworkshop.net/projects/daggerfall-unity/roadmap/quest-system-status/) page (Daggerfall Workshop). It describes the readable quest-scripting language of the 1996 game *Daggerfall*, with places, people, items, foes and clocks as resources, tasks that run when a condition holds, and actions that change the world. It showed how small and legible a quest language can be.

### R. Talsorian Games

[Cyberpunk RED Alert: Lifepath](https://rtalsoriangames.com/2020/10/16/cyberpunk-red-alert-lifepath/) (R. Talsorian Games, 2020), describing the Lifepath tables of the *Cyberpunk* tabletop game. A short run of rolls gives a character a background, relationships, enemies and life goals, with the relationships and enemies given causes. It is a compact example of how a character's history can produce relationships and wants.

### Gustave Perna

By General Gustave Perna. [Mission command requires sharp commander's intent](https://www.army.mil/article/215297/mission_command_requires_sharp_commanders_intent) (*Army Sustainment*, 2019, republished by the US Army), an essay on military practice. Intent is a task, a purpose, the critical factors and a vision of the end state, and the people carrying it out choose the means. It taught us to give authors a way to state what a piece of content is for without dictating how it is done.

### Telltale Games

Sean Vanaman and Jake Rodkin of Telltale Games, speaking on an empathy and character-choice panel at GDC 2013, as reported by [Game Informer](https://www.gameinformer.com/b/news/archive/2013/03/28/telltale-why-fewer-people-saved-doug-in-the-walking-dead.aspx) (2013). Players saved the companion they had shared more moments with, about three in four of them, which the team read as attachment following the number of relationship moments rather than described traits. It informed how we think about what builds attachment to a character. Telltale's Kevin Bruner, in [The Walking Dead and the art of providing no good choice](https://www.gamedeveloper.com/design/-i-the-walking-dead-i-and-the-art-of-providing-no-good-choice) (Game Developer, 2013), describes recording every choice in detail and finding the weight of a choice in equally compelling options. It informed how we think about choices with no good answer.

### Larian Studios

Baudelaire Welch and Lawrence Schick of Larian Studios, interviewed by Shannon Liao and Robin Bea for [Inverse](https://www.inverse.com/gaming/baldurs-gate-3-romance-sex-craft) (January 2024) about the romances of Baldur's Gate 3. They describe romances that can begin early and keep changing, so that sex is not the last step, and companions written with limits and histories of their own. It informed how we think about the pace and boundaries of relationships.

### Mike Laidlaw

Mike Laidlaw, lead designer of Dragon Age II at BioWare, in a [Destructoid interview](https://www.destructoid.com/keep-your-friends-close-character-interaction-in-dragon-age-ii/) (2011). The game removes negative standing: every choice moves a companion toward friendship or rivalry, and both ends unlock content. It informed how we treat opposition between characters as a relationship in its own right.

### Nikhil Murthy

Nikhil Murthy, [“Thoughts on romance in system-driven games”](https://www.gamedeveloper.com/design/thoughts-on-romance-in-system-driven-games) (Game Developer, 2018). It criticises the vending-machine pattern, in which gifts raise a meter that unlocks a result, and argues that it suits a game about trading goods better than one about a relationship. It informed what we avoid in relationship systems.

### Michelle Clough

Michelle Clough's GDC talks on romance and attraction, including [“Cooking with Chemistry: Recipes for Attraction in Narrative Design”](https://schedule.gdconf.com/session/game-narrative-summit-cooking-with-chemistry-recipes-for-attraction-in-narrative-design/901735) (Game Narrative Summit, 2024), which follows her 2022 talk on “kindness coins”. The session description looks for alternatives to treating approval as attraction. It informed how we think about attraction as chemistry between characters and not a reward for approval.

### Stardew Valley wiki contributors

The contributors' [Friendship page](https://stardewvalleywiki.com/Friendship) documents how friendship with each villager falls a little every day without contact, down to a floor, with gifts as the main way to raise it. It informed how we think about relationships that fade without upkeep.

### Spotify Engineering

Ludvig Borgne and Chidem Sahiner, [“Shuffle: Making Random Feel More Human”](https://engineering.atspotify.com/2025/11/shuffle-making-random-feel-more-human) (November 2025). A random draw can be statistically fair and still feel repetitive; generating several random candidates and keeping the one that is freshest against recent plays fixes this without changing the randomness. It informed how we think about repetition in generated quests.

### Boris the Brave

Boris, [“Oatmeal Spice”](https://www.boristhebrave.com/2026/07/05/oatmeal-spice/) (blog post, 2026), a reply to Kate Compton's oatmeal problem. Variation is noticed when a generator makes fewer, bigger, discrete and correlated decisions, not many independent random ones. It informed how we count variety.

### Piotr Tomsiński

GameAnim's account of his GDC 2016 talk, [“Cinematic Dialogue in The Witcher 3”](https://www.gameanim.com/?p=10962). A generator assembles a first draft of a scene from the recorded voice-over, taking idles and gestures from pools of small animation units, and designers can re-run it for a different result. It informed how small reusable units can be recombined while a person can still re-roll.

### Tommy Thompson

By Tommy Thompson. [“The Perfect Organism: The AI of Alien: Isolation”](https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation) (Game Developer), on Creative Assembly's *Alien: Isolation* (2014). A director that knows where the player is hands the hunting creature only hints, so the creature has to find the player, and a menace gauge pulls it away when the pressure has lasted long enough. Thompson also reports Andy Bray of Creative Assembly, in a 2016 talk at nucl.ai, saying that the creature is never allowed to cheat and that a player cannot be scared senseless all the time. It informed how we keep a pacing director fair.

### K Thor Jensen

By K Thor Jensen. [“How Much Friction?”](https://www.gamedeveloper.com/design/how-much-friction-) (Game Developer, 2014). Tension gave way to annoyance when the mechanics stopped testing the player's growing mastery. It informed how we think about pressure that has to keep pace with the player.

### Ben Serviss

By Ben Serviss. [“The Discomfort Zone: The Hidden Potential of Valve's AI Director”](https://www.gamedeveloper.com/design/the-discomfort-zone-the-hidden-potential-of-valve-s-ai-director) (Game Developer, 2013). The line between productive discomfort and toying with players is fine, and giving players options is the safeguard. It informed how far we think a director's pressure should go.

### Thomas Grip

Thomas Grip of Frictional Games, [“Game Design Deep Dive: Amnesia's 'Sanity Meter'”](https://www.gamedeveloper.com/design/game-design-deep-dive-i-amnesia-i-s-sanity-meter-) (Game Developer, 2014). A hidden meter, shown to the player only as an image, discourages looking at monsters, and players still found ways to exploit it. It informed how we think about hidden state that steers play.

### David Spira

By David Spira. [“An Exploration of Escape Room Hint Systems”](https://roomescapeartist.com/2019/10/24/escape-room-hint-systems/) (Room Escape Artist, 2019). It looks at when a hint should arrive, who triggers it, and the risk of a hint landing just as the team solves the puzzle. It informed how we think about when to nudge a player.

### Charles Turnitsa

By Charles Turnitsa. [“Adjudication in Wargaming for Discovery”](https://csiac.dtic.mil/articles/adjudication-in-wargaming-for-discovery/3) (CSIAC Journal, 2016). It describes rigid, free, semi-rigid, open and matrix adjudication and what each costs. It informed how we think about who decides what happens next, and how.

### theatrecrafts.com contributors

[The Prompt Book](https://theatrecrafts.com/pages/home/topics/stage-management/the-prompt-book/) on theatrecrafts.com. The stage manager's book holds the cues, and each cue is called with a warning and then a go. It informed how we think about timed cues.

### Tom Tango and FanGraphs

Tom Tango created Leverage Index, explained in FanGraphs' [Sabermetrics Library](https://library.fangraphs.com/misc/li). It is a baseball measure of how much the next moment can swing the outcome. It informed how we think about scoring the weight of a moment.

### Improwiki contributors

The [Accept](https://improwiki.com/en/wiki/accept) page on improwiki. Accepting an offer is not the same as agreeing with it, and the page names soft refusal, ignoring and steamrolling as ways of failing to accept. It informed how a story can respond to what a player attempts.

### Ben Robbins

Ben Robbins's West Marches campaign style, as described by Alex LeFort in [“What Is A West Marches Campaign?”](https://www.czepeku.com/blog/what-is-a-west-marches-campaign). It is a campaign with no plot, a shared record of what happened and destinations that the players choose. It informed how we think about worlds that go on without a central plot. Robbins's own post, [“Grand Experiments: West Marches”](https://arsludi.lamemage.com/index.php/78/west-marches-grand-experiment/) (Ars Ludi, 2007), sums it up as an overarching environment with no overarching plot, and shows continuity coming from a consistent, detailed setting.

### Gareth Damian Martin

Gareth Damian Martin of Jump Over the Age, developer of *Citizen Sleeper* (2022), as reported in [Rascal News](https://www.rascal.news/tracing-citizen-sleepers-circuitous-vector-from-tabletop-to-hit-video-game/). Clocks carried over from tabletop play make a game's variables visible to the player. It informed how we think about showing what is counting down.

### Doug Church

By Doug Church. [“Formal Abstract Design Tools”](https://www.gamedeveloper.com/design/formal-abstract-design-tools) (Game Developer, 1999). Among the tools it names is perceivable consequence: players must be able to see why something worked or failed. It informed how visible we make the results of a player's choices.

### Sage LaTorra and Adam Koebel

[Dungeon World](https://www.dungeonworldsrd.com/) by Sage LaTorra and Adam Koebel, through its SRD sections on [gamemastering](https://www.dungeonworldsrd.com/gamemastering/) and [fronts](https://www.dungeonworldsrd.com/gamemastering/fronts/). A game master answers with soft moves, which leave room to react, and hard moves, which do not; fronts carry portents and dooms and move while the players are elsewhere. It informed how we think about consequences that arrive in degrees. The [Fronts page](https://roll20.net/compendium/dw/Fronts) of the Roll20 compendium shows that its campaign front is slower and larger than its adventure fronts, with more portents and only a few fronts at a time. It informed how we think about story threads of different spans.

### David Mamet

David Mamet's 2005 memo to the writers of the television drama *The Unit*, as reproduced by David Chen on [SlashFilm](https://www.slashfilm.com/a-letter-from-david-mamet-to-the-writers-of-the-unit/) (2010). He asks of every scene who wants what, what happens if they do not get it, and why now. It gave us a plain test for whether a unit of story is doing any work.

### Philippa Burne

Philippa Burne of the University of Melbourne, ["Inside the story: the ABC of screenwriting as demonstrated by ABC's The Heights"](https://theconversation.com/inside-the-story-the-abc-of-screenwriting-as-demonstrated-by-abcs-the-heights-115854) (The Conversation, 2019). A, B and C stories differ in weight and tone, and the writers plan where they meet. It informed how we think about running several threads at once, at unequal weights.

### Monolith Productions

Michael de Plater, creative director of *Middle-earth: Shadow of Mordor* (2014), in a [GamesBeat interview](https://gamesbeat.com/shadow-of-mordors-nemesis-system-draws-from-burnout-football-and-an-architecture-book/) (2015), and Basilio Bazan III, ["Core System Analysis of Middle-Earth: Shadow of War"](https://www.gamedeveloper.com/design/core-system-analysis-of-middle-earth-shadow-of-war) (Game Developer, 2020). The Nemesis system gives detailed content at a few key moments and leaves players to imagine the story between them. An ordinary orc that kills the player is promoted to a captain with its own role, clan and traits. They informed how we think about promoting a minor character after a notable outcome, and about keeping the promoted few.

### Don Carson

Don Carson, ["Environmental Storytelling: Creating Immersive 3D Worlds Using Lessons Learned from the Theme Park Industry"](https://www.gamedeveloper.com/design/environmental-storytelling-creating-immersive-3d-worlds-using-lessons-learned-from-the-theme-park-industry) (Game Developer, 2000). Staged traces, such as a broken door or a blast mark, let visitors work out what happened, as long as the world keeps to its own rules. It informed how we think about showing events through their traces.

### Dustin Bailey

Dustin Bailey of PCGamesN, reporting the *Guild Wars 2* game director Mike Zadorojny, in ["Guild Wars 2 Season 1 'is always on our mind,' but it was built to 'fire and forget'"](https://www.pcgamesn.com/guild-wars-2/season-1) (2019). Later updates overwrote the first season's story, so it cannot be replayed and newcomers cannot play it. It informed how we think about keeping a story's record so that it can be reached later.

### Game Accessibility Guidelines contributors

The collaborative [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/include-an-option-to-adjust-the-game-speed/), in particular the guideline to include an option to adjust the game speed. Slowing the whole game eases tight timing and gives more time to follow the action, which helps players with motor or cognitive difficulties and older players. It informed how we think about a pace setting for the player.

### K. M. Weiland

K. M. Weiland, [“How to Write a Flat Character Arc, Pt. 1: The First Act”](https://www.helpingwritersbecomeauthors.com/flat-character-arc/) (Helping Writers Become Authors, 2014). In a flat arc, the hero already holds the truth, keeps it under pressure and changes the world around them. It taught us to treat a character who stays the same as a full result, not an absence of change.

### Mimimi Games and Shadow Gambit

Moritz Wagner, head of design at Mimimi Games, quoted in Bryant Francis's [Game Developer article](https://www.gamedeveloper.com/design/how-shadow-gambit-the-cursed-crew-was-able-to-make-save-scumming-a-central-mechanic) (2023) on *Shadow Gambit: The Cursed Crew*. The studio gave time rewinding an in-world reason and built saving and loading into the game's design. Wagner says many players still see reloading as cheating and feel cheap doing it. It informed our view that the engine should treat a reload as ordinary play and find the weight of a choice elsewhere.

### Andy Tockman

Andy Tockman, [“Correlated randomness in Slay the Spire 2”](https://tck.mn/blog/correlated-randomness-sts2/) (blog post, 2026). Giving each random generator its own seed is not enough when the generator's output is nearly linear in the seed, because the streams then predict one another. He suggests nonlinear or counter-based generators. It informed how we key our random draws.

### Raph Koster

Raph Koster, [“Did players destroy the UO ecology?”](https://www.raphkoster.com/?p=46439) (his site). He recalls that *Ultima Online*'s creature ecology was removed during beta, that its creature behaviour was switched off because it cost too much to run, and that the supply collapse in a closed economy came from players hoarding. It informed our rule that every stock in the city needs a source, a sink and a bounded cost.

### Chris Crawford

By Chris Crawford. ["End of An Era"](https://erasmatazz.com/personal/self/end-of-an-era.html) (erasmatazz.com). His account of why Storytron ended says it was too complicated for its audience and that potential users would not commit to learning it. It taught us to judge an authoring tool by how soon a newcomer gets a first result, not by what it can express.

### Tom Leonard

By Tom Leonard, lead programmer on the game. ["Postmortem: Thief: The Dark Project"](https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i-) (Game Developer, 1999). Designers set up much of the game's behaviour through graphical tools without programmer help, while the level editor stayed poorly documented. It taught us to treat an authoring tool as a product with its own owner and documentation.

### Ubisoft La Forge and Ghostwriter

Ben Swanson of Ubisoft La Forge, as reported by Bryant Francis in ["Here are more details on Ubisoft's Ghostwriter AI tool from GDC 2023"](https://www.gamedeveloper.com/marketing/here-are-more-details-on-ubisoft-s-narrative-ai-tools-from-gdc-2023) (Game Developer, 2023). Ghostwriter offers writers line options that they accept, edit or reject, and is not used for cinematics or lore. It showed us where writers accepted machine-made first drafts.

## Research papers

These papers informed our research. Unless an entry says otherwise, no algorithm from them was implemented.

### Ottosson (2020)

Björn Ottosson, [A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/). Its OKLab space is where the Studio compares colours: the creator-capture calibration and the planned game-parity measurements report hue and colour differences in it, and the stage backdrop interpolates its gradient in it. The conversion is implemented in the Studio from the published formulas.

### Lagarde and de Rousiers (2014)

Sébastien Lagarde and Charles de Rousiers, "Moving Frostbite to PBR" (EA DICE, SIGGRAPH 2014 course notes). The reference that let us recognise the game's diffuse and specular lighting formulas when reading its compiled shaders.

### Deliot and Belcour (2023)

Thomas Deliot and Laurent Belcour, [anisotropic-grid glint paper](https://arxiv.org/abs/2306.05051v1). A lead on counting glints within a pixel's footprint.

### Jakob et al. (2014)

Jakob, Hašan, Yan, Lawrence, Ramamoorthi and Marschner, [Discrete Stochastic Microfacet Models](https://research.cs.cornell.edu/stochastic-sg14/). Framed the aliasing and temporal-coherence problem of tiny normal-mapped glitter.

### Castaño (2013)

Ignacio Castaño (Thekla), ["Shadow Mapping Summary – Part 1"](http://the-witness.net/news/2013/09/shadow-mapping-summary-part-1/), and its filter as Matt Pettineo presents it in his [Shadows sample](https://github.com/TheRealMJP/Shadows) (MIT licence). Its optimized PCF, a tent filter built from a few hardware-filtered comparison taps whose positions and weights follow the receiver inside its texel, is the Studio's soft-shadow filter; the shader implements the published tap formulas.

### Karis (2013)

Brian Karis (Epic Games), "Real Shading in Unreal Engine 4" (SIGGRAPH 2013 course notes). Its spherical-Gaussian approximation of Schlick's Fresnel let us recognise the Fresnel term of the game's eye lighting when reading the compiled light program.

### Karis (2016)

Brian Karis (Epic Games), "Physically Based Hair Shading in Unreal" (SIGGRAPH 2016 course notes). The published hair lighting model that the game's decoded hair light matches, which let us read the compiled program term by term.

### Karis (2014)

Brian Karis (Epic Games), [Physically Based Shading on Mobile](https://www.unrealengine.com/en-US/blog/physically-based-shading-on-mobile) (Unreal Engine blog). Its analytic approximation of the environment BRDF let us recognise how the game's glass shader weights its reflections.

### Mitchell, McTaggart and Green (2006)

Jason Mitchell, Gary McTaggart and Chris Green (Valve), [Shading in Valve's Source Engine](https://advances.realtimerendering.com/s2006/Mitchell-ShadingInValvesSourceEngine.pdf) (SIGGRAPH 2006 course notes). Its ambient cube, six colours weighted by the squared normal components, let us recognise how the game's forward glass shader reads its probes' diffuse light.

### Kneiphof and Klein (2025)

Kneiphof and Klein, [Real-time Image-based Lighting of Glints](https://arxiv.org/abs/2507.02674v1). Showed that environment lighting is a separate filtering requirement.

### Barré-Brisebois and Hill (2012)

Colin Barré-Brisebois and Stephen Hill, [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/). Their reoriented normal mapping formula let us recognise how the game's decal composes a makeup normal map with the skin normal, which decided the Shimmer export design. Their survey of detail-normal blends also let us name the partial-derivative blend the game's skin shader uses for its detail and micro-detail normals.

### Jimenez et al. (2015)

Jorge Jimenez, Károly Zsolnai, Adrian Jarabo, Christian Freude, Thomas Auzinger, Xian-Chun Wu, Javier von der Pahlen, Michael Wimmer and Diego Gutierrez, [Separable Subsurface Scattering](https://www.iryoku.com/separable-sss/) (Computer Graphics Forum, 2015). Its per-profile separable kernel, scaled by depth, let us recognise the game's skin subsurface-scattering passes when reading their compiled programs, and its published reference code let us identify the game's CPU kernel builder, which follows it constant for constant. The Studio's 3D preview now reproduces that kernel and the separable blur, written from the game's decoded routine rather than copied from their code; as a precaution its release notices carry the notice their licence asks binary redistributions to reproduce, "Uses Separable SSS. Copyright (C) 2012 by Jorge Jimenez and Diego Gutierrez."

### d'Eon and Luebke (2007)

Eugene d'Eon and David Luebke, [Advanced Techniques for Realistic Real-Time Skin Rendering](https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-14-advanced-techniques-realistic-real-time-skin) (GPU Gems 3, chapter 14). Its sum-of-Gaussians fit of skin's diffusion profile let us recognise the variances and weights in the game's subsurface-scattering kernel.

### Cigolle et al. (2014)

Zina H. Cigolle, Sam Donow, Daniel Evangelakos, Michael Mara, Morgan McGuire and Quirin Meyer, [A Survey of Efficient Representations for Independent Unit Vectors](https://jcgt.org/published/0003/02/01/) (Journal of Computer Graphics Techniques, 2014). Its octahedral encoding let us recognise how the game's eye shader packs the iris normal into spare G-buffer bits.

### Policarpo, Oliveira and Comba (2005)

Fábio Policarpo, Manuel M. Oliveira and João L. D. Comba, "Real-Time Relief Mapping on Arbitrary Polygonal Surfaces" (ACM Symposium on Interactive 3D Graphics and Games, 2005). Its linear search followed by a binary refinement along the view ray let us recognise how the game's parallax decal template offsets its texture lookups.

### Toksvig (2005) and Olano and Baker (2010)

Michael Toksvig, "Mipmapping Normal Maps" (Journal of Graphics Tools), and Marc Olano and Dan Baker, [LEAN Mapping](https://www.csee.umbc.edu/~olano/papers/lean/). Their idea of turning normal variance lost to mipmapping into wider roughness shapes the Shimmer export's lower mip levels.

### Edwards, Landreth, Fiume and Singh (2016)

Pif Edwards, Chris Landreth, Eugene Fiume and Karan Singh, [JALI: An Animator-Centric Viseme Model for Expressive Lip Synchronization](https://www.dgp.toronto.edu/~elf/jali.html) (ACM Transactions on Graphics 35(4), SIGGRAPH 2016). Its separate jaw and lip strengths and its co-articulation and timing rules explained the `jaliJaw`/`jaliLips` tracks in the game's lip-sync clips, which JALI Research's tools generated for CD PROJEKT RED (as a [Game Anim article](https://www.gameanim.com/2020/12/05/cyberpunk-2077-procedural-facial-animation/) describes). The lip-sync proof of concept reimplements its published timing rules in simplified form; no JALI software or data is used.

### Ekman and Friesen: the Facial Action Coding System

Paul Ekman and Wallace V. Friesen, *Facial Action Coding System* (1978; manual with Joseph C. Hager, 2002), and their EMFACS emotion prototypes. The action units and intensity scale are the language our natural-expression recipes and the mapping onto V's face controls are written in.

### Ekman, Davidson and Friesen (1990)

Paul Ekman, Richard J. Davidson and Wallace V. Friesen, "The Duchenne smile: emotional expression and brain physiology II" (*Journal of Personality and Social Psychology*). With Duchenne's own work, it established that felt smiles involve the muscle around the eyes, which is why our warm smile narrows the eyes and why the vanilla smiles look posed.

### Ekman, Hager and Friesen (1981)

Paul Ekman, Joseph C. Hager and Wallace V. Friesen, "The symmetry of emotional and deliberate facial actions" (*Psychophysiology*). Its finding that asymmetric smiles are more typical of deliberate expressions shaped how much asymmetry our samples use.

### Rozin and Cohen (2003)

Paul Rozin and Adam B. Cohen, "High frequency of facial expressions corresponding to confusion, concentration, and worry in an analysis of naturally occurring facial expressions of Americans" (*Emotion*). It informed our confusion expression: knitted brows and a one-sided face.

### Glenberg, Schroeder and Robertson (1998)

Arthur M. Glenberg, Jennifer L. Schroeder and David A. Robertson, "Averting the gaze disengages the environment and facilitates remembering" (*Memory & Cognition*). The reason our thinking expression looks away.

### Casiez, Roussel and Vogel (2012)

Géry Casiez, Nicolas Roussel and Daniel Vogel, "1€ Filter: a simple speed-based low-pass filter for noisy input in interactive systems" (CHI 2012). The face-capture prototype smooths blendshape scores with this filter, implemented from the paper.

### Fishman, Kiss, Zuker, Fialkov and Whyne (2022)

Zachary Fishman, Alex Kiss, Ronald M. Zuker, Jeffrey A. Fialkov and Cari M. Whyne, [Measuring 3D facial displacement of increasing smile expressions](https://doi.org/10.1016/j.bjps.2022.08.024) (*Journal of Plastic, Reconstructive & Aesthetic Surgery*, 2022), measured on the Binghamton University 3D Facial Expression database. Their cheek and mouth-corner displacements at four smile intensities are the real-face yardstick for how far V's cheeks can and should move.

### Macklin, Müller and Chentanez

Miles Macklin, Matthias Müller and Nuttapong Chentanez, [XPBD: Position-Based Simulation of Compliant Constrained Dynamics](https://matthias-research.github.io/pages/publications/XPBD.pdf). Their compliant-constraint formulation informs the implemented Hair Lab styling solver, including accumulated multipliers and time-step scaling. Studied as a numerical method; no implementation was copied.

### Hair Tool — Bartosz Styperek

[Hair Tool documentation](https://joseconseco.github.io/HairTool_3_Documentation/). Its separation of scalp input, deformation stages and profile/UV assignment helped frame Hair Lab's generation stages; its baking workflow taught us to derive opacity, random strand ID, root position and flow from one groom, with thinning and end trimming as explicit decisions. Studied as an artist workflow; no add-on code or assets are reused.

### GS CurveTools

[Curve attributes documentation](https://gs-curvetools.readthedocs.io/en/latest/attributes.html). Its separate controls for orientation, twist, taper and curvature subdivision informed the proposed procedural card decisions. Studied as an artist workflow; no plug-in code or assets are reused.

### Polytricity

[Hair Strand Designer](https://polytricity.artstation.com/store/j7PY/hair-strand-designer-v1-7-0-full-perpetual-license-free-demo-and-sample-set) taught us the artist controls for strand count, spacing, width, length, taper and fine waviness, and the value of seeded regeneration across related map outputs. Workflow study only; no application code, presets or textures are reused.

### Eyosido Software

[HairTG-Cards 2](https://eyosido.com/hairtg-cards) informed the procedural atlas's shared and per-region parameters, rows of designs, density progressions and separation of texturing from card geometry. Workflow study only; no product code, presets or assets are reused.

### SideFX

[Houdini's Bake Texture documentation](https://www.sidefx.com/docs/houdini/nodes/out/baketexture.html) explained producing multiple texture planes from the same source geometry in a receiving UV chart. This informed the Hair Lab atlas's shared fibre sample; no implementation is copied.

### Epic Games

[Unreal Engine's groom cards documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-cards-and-meshes-for-grooms-in-unreal-engine) taught us how coverage, tangent, root coordinates and strand seeds are kept explicit in card texture layouts. Its layout was studied as a workflow reference; the Hair Lab atlas uses Cyberpunk's own shader encoding and includes no Unreal assets or code.

### Pedro F. Felzenszwalb and Daniel P. Huttenlocher

Their paper [Distance Transforms of Sampled Functions](https://cs.brown.edu/people/pfelzens/papers/dt-final.pdf) informed the separable Euclidean distance transform used in the Hair Lab collision-grid research. The transform is independently implemented from the mathematical construction; no reference source code is reused.

### James Ryan (2018) and Ryan and Mateas (2017)

James Ryan, [*Curating Simulated Storyworlds*](https://escholarship.org/uc/item/1340j5h2) (PhD thesis, University of California, Santa Cruz, 2018), and James Ryan and Michael Mateas, ["Simulating Character Knowledge Phenomena in Talk of the Town"](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter37_Simulating_Character_Knowledge_Phenomena_in_Talk_of_the_Town.pdf) (*Game AI Pro 3*, 2017). The thesis introduced story sifting, finding story-shaped patterns in a simulation's record of events, and argues that simulated worlds need curation to yield stories. James Ryan, Adam Summerville, Michael Mateas and Noah Wardrip-Fruin, [“Toward Characters Who Observe, Tell, Misremember, and Lie”](https://ojs.aaai.org/index.php/AIIDE/article/view/12825) (AIIDE, 2015), holds beliefs fact by fact, with evidence that decays and forgetting that depends on the kind of fact and how salient it is. It informed how we let characters forget.

### Kreminski et al. (2019, 2021)

Max Kreminski, Melanie Dickinson and Noah Wardrip-Fruin, ["Felt: A Simple Story Sifter"](https://doi.org/10.1007/978-3-030-33894-7_27) (*Interactive Storytelling*, ICIDS 2019), and Max Kreminski, Melanie Dickinson and Michael Mateas, ["Winnow: A Domain-Specific Language for Incremental Story Sifting"](https://ojs.aaai.org/index.php/AIIDE/article/view/18903) (AIIDE 2021). Felt writes sifting patterns as queries over a simulation's events, and Winnow runs such patterns incrementally, so a promising sequence can be flagged while it is still unfolding. They taught us sifting languages and incremental matching. Kreminski, Dickinson, Wardrip-Fruin and Mateas, [“Select the Unexpected: A Statistical Heuristic for Story Sifting”](https://mkremins.github.io/publications/StU_ICIDS2022.pdf) (ICIDS 2022), adds a second layer that ranks the matches of a pattern by how statistically unlikely they are. Kreminski, Wardrip-Fruin and Mateas, [“Toward Example-Driven Program Synthesis of Story Sifting Patterns”](https://ceur-ws.org/Vol-2862/paper18.pdf) (AIIDE workshop paper, 2020), shows that writing sifting patterns by hand is a bottleneck that examples can ease.

### Kreminski and Wardrip-Fruin (2018)

Max Kreminski and Noah Wardrip-Fruin, ["Sketching a Map of the Storylets Design Space"](https://doi.org/10.1007/978-3-030-04028-4_14) (*Interactive Storytelling*, ICIDS 2018). It defines the common parts of storylet-based narrative systems and sorts them along several dimensions. It gave us the storylet as the unit of authored content.

### Grinblat and Bucklew (2017)

Jason Grinblat and C. Brian Bucklew, ["Subverting historical cause & effect: generation of mythic biographies in Caves of Qud"](https://doi.org/10.1145/3102071.3110574) (Foundations of Digital Games, 2017). The game first decides that a historical event happens, then works out a cause from the states of the figures involved, instead of simulating the logic that would have produced it. It taught us to generate events first and justify their causes afterwards.

### Meehan (1976)

James R. Meehan, [*The Metanovel: Writing Stories by Computer*](https://apps.dtic.mil/sti/pdfs/ADA031625.pdf) (Yale University, 1976), the work behind the Tale-Spin story-writing program. Ryan's thesis cites Tale-Spin as a notable failure of the pure-simulation approach. We keep it in mind as the classic warning that simulating characters does not by itself give a story.

### Lehnert (1981)

Wendy Lehnert, ["Plot units and narrative summarization"](https://doi.org/10.1207/s15516709cog0504_1) (*Cognitive Science*, 1981). It describes a story as a graph of plot units whose overlaps encode the plot. It taught us to treat narrative as a graph of affect states.

### Fisher, Hammer, Byrd and Might (2016)

Dakota Fisher, Matthew A. Hammer, William Byrd and Matthew Might, ["miniAdapton: A Minimal Implementation of Incremental Computation in Scheme"](https://arxiv.org/abs/1609.05337) (Scheme Workshop, 2016). It shows how memoised computations can track what they read so that a change invalidates only what depends on it. It is the model for the Story Engine's optional fine-grained cache invalidation.

### Maslow (1943)

Abraham Maslow, ["A theory of human motivation"](https://psychclassics.yorku.ca/Maslow/motivation.htm) (*Psychological Review*, 1943). Its hierarchy of needs orders human needs from the basic to the higher. It is one of the sources behind our draft catalogue of character drives. The original paper is less rigid than the pyramid taught from it.

### Reiss (2004)

Steven Reiss, ["Multifaceted nature of intrinsic motivation: the theory of 16 basic desires"](https://doi.org/10.1037/1089-2680.8.3.179) (*Review of General Psychology*, 2004). It proposes sixteen basic desires that motivate people and that differ in strength from person to person. It is one of the sources behind our draft catalogue of character drives. Vengeance, honour and acceptance are among them.

### Ryan and Deci (2000)

Richard Ryan and Edward Deci, ["Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being"](https://doi.org/10.1037/0003-066X.55.1.68) (*American Psychologist*, 2000). Self-determination theory builds motivation on the needs for autonomy, competence and relatedness. It is one of the sources behind our draft catalogue of character drives.

### Schwartz (1992, 2012)

Shalom Schwartz, ["Universals in the Content and Structure of Values: Theoretical Advances and Empirical Tests in 20 Countries"](https://doi.org/10.1016/S0065-2601(08)60281-6) (*Advances in Experimental Social Psychology*, 1992), and ["An Overview of the Schwartz Theory of Basic Values"](https://doi.org/10.9707/2307-0919.1116) (*Online Readings in Psychology and Culture*, 2012). The theory sets out a small set of basic values recognised across cultures and how they relate to one another. It is one of the sources behind our draft catalogue of character drives.

### Wahba and Bridwell (1976)

Mahmoud Wahba and Lawrence Bridwell, ["Maslow reconsidered: a review of research on the need hierarchy theory"](https://doi.org/10.1016/0030-5073(76)90038-6) (*Organizational Behavior and Human Performance*, 1976). It found little consistent support for the strict ordering of needs. It taught us not to build the drive catalogue on a fixed ladder.

### Kenrick et al. (2010)

Douglas Kenrick, Vladas Griskevicius, Steven Neuberg and Mark Schaller, ["Renovating the pyramid of needs"](https://pmc.ncbi.nlm.nih.gov/articles/PMC3161123/) (*Perspectives on Psychological Science*, 2010). It proposes that motives overlap, that affiliation splits into several, and that self-actualisation is not a basic need. It shaped how we group and separate social drives.

### Tay and Diener (2011)

Louis Tay and Ed Diener, ["Needs and subjective well-being around the world"](https://doi.org/10.1037/a0023779) (*Journal of Personality and Social Psychology*, 2011). Across 123 countries, how well different needs are met relates to wellbeing largely independently. It taught us to treat needs as parallel rather than stacked.

### Sheldon and colleagues (1999, 2001)

Kennon Sheldon and Andrew Elliot, ["Goal striving, need satisfaction, and longitudinal well-being: the self-concordance model"](https://doi.org/10.1037/0022-3514.76.3.482) (*Journal of Personality and Social Psychology*, 1999), and Kennon Sheldon, Andrew Elliot, Youngmee Kim and Tim Kasser, ["What is satisfying about satisfying events? Testing 10 candidate psychological needs"](https://doi.org/10.1037/0022-3514.80.2.325) (same journal, 2001). Goals a person endorses as their own are pursued harder and satisfy more, and in the second study autonomy, competence, relatedness and self-esteem led while popularity and money trailed. They informed which needs rank high in the drive catalogue and how a chosen goal differs from an imposed one.

### Susan Fiske (2004)

Susan Fiske, *Social Beings: Core Motives in Social Psychology* (Wiley, first edition 2004; [publisher page](https://www.wiley-vch.de/en/areas-interest/humanities-social-sciences/social-beings-978-1-119-49273-3) is for the current edition). It organises social life around belonging, understanding, controlling, enhancing the self and trusting. It informed the social side of the drive catalogue.

### Alan Fiske (1992)

Alan Fiske, ["The four elementary forms of sociality: framework for a unified theory of social relations"](https://doi.org/10.1037/0033-295x.99.4.689) (*Psychological Review*, 1992). The kind of relationship, of four, decides what a tie obliges people to do for one another. It taught us to distinguish ties by what they owe.

### Baumeister and Leary (1995)

Roy Baumeister and Mark Leary, ["The need to belong: desire for interpersonal attachments as a fundamental human motivation"](https://doi.org/10.1037/0033-2909.117.3.497) (*Psychological Bulletin*, 1995). Belonging is a pervasive motive, and lacking it harms health and adjustment. It supports belonging as a strong drive.

### Anderson, Hildreth and Howland (2015)

Cameron Anderson, John Hildreth and Laura Howland, ["Is the desire for status a fundamental human motive? A review of the empirical literature"](https://doi.org/10.1037/a0038781) (*Psychological Bulletin*, 2015). Respect and voluntary deference from others emerge as a fundamental motive. It shaped how we describe the drive for standing.

### Parks-Leduc, Feldman and Bardi (2015)

Laura Parks-Leduc, Gilad Feldman and Anat Bardi, ["Personality traits and personal values: a meta-analysis"](https://doi.org/10.1177/1088868314538548) (*Personality and Social Psychology Review*, 2015). Traits and values are linked only modestly, so they are distinct things. It taught us to keep a character's temperament and values apart.

### Bardi and Goodwin (2011)

Anat Bardi and Robin Goodwin, ["The dual route to value change: individual processes and cultural moderators"](https://doi.org/10.1177/0022022110396916) (*Journal of Cross-Cultural Psychology*, 2011). Values can change by an automatic route and an effortful one. It informed how slowly and how suddenly a character's values may shift.

### DeYoung (2015)

Colin DeYoung, ["Cybernetic Big Five Theory"](https://doi.org/10.1016/j.jrp.2014.07.004) (*Journal of Research in Personality*, 2015). It treats personality traits as parameters of goal-directed control, with goals as characteristic adaptations. It informed how temperament colours the pursuit of goals.

### Carstensen, Isaacowitz and Charles (1999)

Laura Carstensen, Derek Isaacowitz and Susan Charles, ["Taking time seriously: a theory of socioemotional selectivity"](https://doi.org/10.1037/0003-066x.54.3.165) (*American Psychologist*, 1999). A shorter sense of future time reweights goals towards the present and the close-at-hand. It informed how a limited horizon changes what a character wants.

### Griskevicius et al. (2011)

Vladas Griskevicius, Andrew Delton, Theresa Robertson and Joshua Tybur, ["Environmental contingency in life history strategies: the influence of mortality and socioeconomic status on reproductive timing"](https://doi.org/10.1037/a0021082) (*Journal of Personality and Social Psychology*, 2011). Cues of danger move reproductive timing earlier for people raised in poverty and later for those raised comfortably. It taught us that the same threat reweights drives differently by upbringing.

### Pepper and Nettle (2017)

Gillian Pepper and Daniel Nettle, ["The behavioural constellation of deprivation: causes and consequences"](https://doi.org/10.1017/s0140525x1600234x) (*Behavioral and Brain Sciences*, 2017). Deprivation goes with present-oriented behaviour, though the commentaries dispute how general that is. It informed how scarcity shapes what a character pursues, with caution.

### Klein et al. (2022)

Richard Klein and colleagues, ["Many Labs 4: failure to replicate mortality salience effect with and without original author involvement"](https://doi.org/10.1525/collabra.35271) (*Collabra: Psychology*, 2022). The effect did not replicate across 21 labs. It taught us to leave out drives resting on that finding.

### Gal and Rucker (2018)

David Gal and Derek Rucker, ["The loss of loss aversion: will it loom larger than its gain?"](https://doi.org/10.1002/jcpy.1047) (*Journal of Consumer Psychology*, 2018). The evidence does not show that losses generally weigh more than equal gains. It taught us not to build in a blanket loss-aversion rule.

### Daan, Beersma and Borbély (1984)

Serge Daan, Domien Beersma and Alexander Borbély, ["Timing of human sleep: recovery process gated by a circadian pacemaker"](https://doi.org/10.1152/ajpregu.1984.246.2.r161) (*American Journal of Physiology*, 1984). Pressure to rest builds on a saturating curve, discharges faster, and is gated by the body clock. It shaped how a rest drive rises and falls.

### Tomova et al. (2020)

Livia Tomova and colleagues, ["Acute social isolation evokes midbrain craving responses similar to hunger"](https://hdl.handle.net/1721.1/138313) (*Nature Neuroscience*, 2020). After ten hours alone, people crave social contact in a way that resembles hunger. It supported modelling the need for company as a drive that builds with absence.

### Kivetz, Urminsky and Zheng (2006)

Ran Kivetz, Oleg Urminsky and Yuhuang Zheng, ["The goal-gradient hypothesis resurrected"](https://doi.org/10.1509/jmkr.43.1.39) (*Journal of Marketing Research*, 2006). People accelerate towards a reward as it nears. It shaped how urgency grows as a goal comes within reach.

### Boyd, Robinson and Fetterman (2011)

Ryan Boyd, Michael Robinson and Adam Fetterman, ["Miller (1944) revisited: movement times in relation to approach and avoidance conflicts"](https://doi.org/10.1016/j.jesp.2011.04.017) (*Journal of Experimental Social Psychology*, 2011). It replicates Neal Miller's finding that the pull to avoid rises more steeply with closeness than the pull to approach. It informed how fear and desire weigh against each other.

### Robinson and Berridge (2025)

Terry Robinson and Kent Berridge, ["The incentive-sensitization theory of addiction 30 years on"](https://doi.org/10.1146/annurev-psych-011624-024031) (*Annual Review of Psychology*, 2025). Wanting something is separate from liking it, and cues can drive wanting. It taught us to let a character want what they do not enjoy.

### McCullough, Kurzban and Tabak (2013)

Michael McCullough, Robert Kurzban and Benjamin Tabak, ["Cognitive systems for revenge and forgiveness"](https://doi.org/10.1017/S0140525X11002160) (*Behavioral and Brain Sciences*, 2013). Revenge works as a deterrence system, and forgiveness depends on how valuable the relationship is expected to be. It shaped how vengeance and forgiveness are modelled.

### Nisbett and Cohen (1996)

Richard Nisbett and Dov Cohen, *Culture of Honor: The Psychology of Violence in the South* (Westview Press, 1996; [abstract](https://ojp.gov/ncjrs/virtual-library/abstracts/culture-honor-psychology-violence-south)). Responses to insult differ between honour cultures and others, though the authors' reading of the American South is disputed. It informed how honour changes a character's response to an affront.

### Richardson, Elliott and Roberts (2013)

Thomas Richardson, Peter Elliott and Ronald Roberts, ["The relationship between personal unsecured debt and mental and physical health: a systematic review and meta-analysis"](https://doi.org/10.1016/j.cpr.2013.08.009) (*Clinical Psychology Review*, 2013). Debt is strongly associated with poor mental health, though the direction of cause is not established. It informed how debt weighs on a character.

### Blumberg (1996)

Bruce Blumberg, [*Old Tricks, New Dogs: Ethology and Interactive Creatures*](https://characters.media.mit.edu/Theses/blumberg_phd.pdf) (PhD thesis, MIT, 1996). Sticking with an activity needs some inertia, mutual inhibition between competing drives and a falling level of interest. It shaped how a character holds to one pursuit before switching.

### Tyrrell (1993)

Toby Tyrrell, [*Computational Mechanisms for Action Selection*](https://era.ed.ac.uk/items/f882b365-c98c-417f-b934-ecff1f710e29/full) (PhD thesis, University of Edinburgh, 1993). It tested drive-based and spreading-activation models of choosing what to do in simulation and found both wanting. It taught us to treat a simple drive-picks-action rule with suspicion.

### Locke and Latham (2002)

Edwin Locke and Gary Latham, ["Building a practically useful theory of goal setting and task motivation: a 35-year odyssey"](https://doi.org/10.1037/0003-066x.57.9.705) (*American Psychologist*, 2002). Specific, difficult goals direct effort, moderated by commitment and conflict between goals. It informed how a goal's specificity and difficulty shape effort.

### Ordóñez, Schweitzer, Galinsky and Bazerman (2009)

Lisa Ordóñez, Maurice Schweitzer, Adam Galinsky and Max Bazerman, ["Goals gone wild: the systematic side effects of overprescribing goal setting"](https://doi.org/10.5465/amp.2009.37007999) (*Academy of Management Perspectives*, 2009). Hard targets narrow attention and invite corner-cutting. It taught us what a driven character will sacrifice.

### Kruglanski et al. (2002)

Arie Kruglanski, James Shah, Ayelet Fishbach, Ron Friedman, Woo Young Chun and Daniel Sleeth-Keppler, ["A theory of goal systems"](https://doi.org/10.1016/s0065-2601(02)80008-9) (*Advances in Experimental Social Psychology*, 2002). Means that serve several goals are preferred, and means that harm other goals are penalised. It informed how a character picks among ways of getting what they want.

### Gollwitzer, Sheeran and Heckhausen

Peter Gollwitzer and Paschal Sheeran, ["Implementation intentions and goal achievement: a meta-analysis of effects and processes"](https://doi.org/10.1016/S0065-2601(06)38002-1) (*Advances in Experimental Social Psychology*, 2006), and Heinz Heckhausen and Peter Gollwitzer, ["Thought contents and cognitive functioning in motivational versus volitional states of mind"](https://doi.org/10.1007/bf00992338) (*Motivation and Emotion*, 1987). If-then plans raise the chance of reaching a goal, and weighing a goal differs from committing to it. They informed the step from wanting something to acting on it.

### Elliot (2006)

Andrew Elliot, ["The hierarchical model of approach-avoidance motivation"](https://doi.org/10.1007/s11031-006-9028-7) (*Motivation and Emotion*, 2006). Moving towards something and moving away from something are different kinds of motive. It shaped how we separate wants from fears.

### Higgins (1997)

Tory Higgins, ["Beyond pleasure and pain"](https://doi.org/10.1037/0003-066x.52.12.1280) (*American Psychologist*, 1997). Promotion (seeking gains) and prevention (guarding against loss) are distinct ways of pursuing a goal. It shaped how a character's manner of pursuit is described.

### Schank and Abelson (1977)

Roger Schank and Robert Abelson, [*Scripts, Plans, Goals and Understanding*](https://www.routledge.com/Scripts-Plans-Goals-and-Understanding-An-Inquiry-Into-Human-Knowledge-Structures/Schank-Abelson/p/book/9780898591385) (Lawrence Erlbaum, 1977). It sorts goals into kinds, including wishes, opportunities and duties, and describes how goals relate. We took from it the kinds of goal a character can hold.

### Harland et al. (2014)

James Harland, David Morley, John Thangarajah and Neil Yorke-Smith, ["An operational semantics for the goal life-cycle in BDI agents"](https://doi.org/10.1007/s10458-013-9238-9) (*Autonomous Agents and Multi-Agent Systems*, 2014). A goal passes through explicit states, and can be dropped, aborted, suspended or resumed. It shaped how a character's goal can be set aside and picked up again.

### Agnew (1992)

Robert Agnew, ["Foundation for a general strain theory of crime and delinquency"](https://doi.org/10.1111/j.1745-9125.1992.tb01093.x) (*Criminology*, 1992). Pressure builds from blocked goals, loss of valued things and unpleasant treatment. It informed how frustration turns into pressure to act.

### Merton (1938)

Robert Merton, ["Social structure and anomie"](https://faculty.washington.edu/matsueda/courses/517/Readings/Merton%201938.pdf) (*American Sociological Review*, 1938). A gap between prized goals and approved means drives different kinds of adaptation. It informed what a character does when the legitimate road is shut.

### Doran and Parberry (2011)

Jonathon Doran and Ian Parberry, ["A prototype quest generator based on a structural analysis of quests from four MMORPGs"](https://ianparberry.com/pubs/pcg2011.pdf) (*Proceedings of the 2nd International Workshop on Procedural Content Generation in Games*, 2011). It analyses more than 750 quests as a motivation plus a strategy, and finds the motivations fall into a few kinds, very unevenly. A grammar of motives gives plausible quest shapes but, unaided, long errand chains, and general planning proved impractical. It informed the drive catalogue and what to avoid in quest structure.

### Perrow (1961)

Charles Perrow, ["The analysis of goals in complex organizations"](https://doi.org/10.2307/2090570) (*American Sociological Review*, 1961). The goals an organisation announces differ from the operative goals revealed by where its resources go. It informed how we describe what a group is actually after.

### Cyert, March and Greve

Richard Cyert and James March, *A Behavioral Theory of the Firm* (Prentice-Hall, 1963), and Henrich Greve, [*Organizational Learning from Performance Feedback*](https://www.cambridge.org/core/product/660EE3B71FEAC74729EEA787967AF503) (Cambridge University Press, 2003). Results measured against a shifting aspiration drive how much an organisation searches for new ways and how much risk it takes. They informed how a group's recent fortunes change its behaviour.

### Levitt and Venkatesh (2000)

Steven Levitt and Sudhir Venkatesh, ["An economic analysis of a drug-selling gang's finances"](https://nber.org/papers/w6592) (*Quarterly Journal of Economics*, 2000). A gang behaves like a firm with a very uneven wage bill, and violence against a rival's turf has a price. It informed how we describe what gangs want and what they pay for it.

### Venkatesh (2006)

Sudhir Venkatesh, [*Off the Books: The Underground Economy of the Urban Poor*](https://publishersweekly.com/9780674023550) (Harvard University Press, 2006). Informal and formal work are interlinked in a neighbourhood, and a gang's activity sits among them. It informed the everyday economy that groups sit in.

### Simone (2004)

AbdouMaliq Simone, ["People as infrastructure: intersecting fragments in Johannesburg"](https://doi.org/10.1215/08992363-16-3-407) (*Public Culture*, 2004). In places where formal services are thin, relationships between people do the work infrastructure would. It informed how personal ties serve as practical resources.

### Meyer and Allen (1991)

John Meyer and Natalie Allen, ["A three-component conceptualization of organizational commitment"](https://doi.org/10.1016/1053-4822(91)90011-z) (*Human Resource Management Review*, 1991). Commitment can be affective, rest on the cost of leaving, or rest on obligation. It informed why a member stays.

### Le and Agnew (2003)

Benjamin Le and Christopher Agnew, ["Commitment and its theorized determinants: a meta-analysis of the investment model"](https://doi.org/10.1111/1475-6811.00035) (*Personal Relationships*, 2003). Satisfaction, the quality of alternatives and what has been invested predict commitment. It informed what keeps a person in a relationship or a group. Caryl Rusbult's [original test of the investment model](https://faculty.wcas.northwestern.edu/eli-finkel/documents/6_Rusbult1980_JournalOfExperimentalSocialPsychology.pdf) (“Commitment and satisfaction in romantic associations: a test of the investment model”, *Journal of Experimental Social Psychology*, 1980), and Peter Tran, Madeline Judge and Yoshihisa Kashima's [updated meta-analysis](https://findanexpert.unimelb.edu.au/scholarlywork/1387213-commitment-in-relationships--an-updated-meta-analysis-of-the-investment-model) (*Personal Relationships*, 2019), taught the same lesson, with satisfaction the strongest predictor of commitment.

### Hirschman (1970)

Albert Hirschman, [*Exit, Voice, and Loyalty*](https://casbs.stanford.edu/exit-voice-and-loyalty-responses-decline-firms-organizations-and-states) (Harvard University Press, 1970). Loyalty slows exit and gives complaint room to work. It informed how members respond when a group declines.

### Pyrooz, Decker and Webb

David Pyrooz and Scott Decker, ["Motives and methods for leaving the gang: understanding the process of gang desistance"](https://doi.org/10.1016/j.jcrimjus.2011.07.001) (*Journal of Criminal Justice*, 2011), and David Pyrooz, Scott Decker and Vincent Webb, ["The ties that bind: desistance from gangs"](https://doi.org/10.1177/0011128710372191) (*Crime & Delinquency*, 2010). Most exits from a gang are not hostile, and ties to it linger afterwards. They informed how a character can leave a group and not leave it behind.

### Lipsky (1980)

Michael Lipsky, [*Street-Level Bureaucracy*](https://muse.jhu.edu/book/15024) (Russell Sage Foundation, 1980). Frontline workers ration scarce services and favour easy cases, and their ways of coping become the effective policy. It informed how people at the counter shape what an institution does.

### Gómez-Mejía et al. (2007)

Luis Gómez-Mejía, Katalin Haynes, Manuel Núñez-Nickel, Kathyrn Jacobson and José Moyano-Fuentes, ["Socioemotional wealth and business risks in family-controlled firms: evidence from Spanish olive oil mills"](https://doi.org/10.2189/asqu.52.1.106) (*Administrative Science Quarterly*, 2007). Families protect identity, influence and the continuation of the dynasty, not only money. It informed what a family business is trying to keep.

### Burnstein, Crandall and Kitayama (1994)

Eugene Burnstein, Christian Crandall and Shinobu Kitayama, ["Some neo-Darwinian decision rules for altruism: weighing cues for inclusive fitness as a function of the biological importance of the decision"](https://doi.org/10.1037/0022-3514.67.5.773) (*Journal of Personality and Social Psychology*, 1994). People favour close kin in helping, most strongly when the stakes are high. It informed how kinship counts when the stakes are large.

### de Haas (2021)

Hein de Haas, ["A theory of migration: the aspirations-capabilities framework"](https://pmc.ncbi.nlm.nih.gov/articles/PMC7902564) (*Comparative Migration Studies*, 2021). Moving takes both the wish and the means, and staying is also a choice. It informed how wanting to leave differs from being able to.

### Black (1983)

Donald Black, ["Crime as social control"](https://doi.org/10.2307/2095143) (*American Sociological Review*, 1983). Where the law does not protect people, much crime works as self-help. It informed why people take matters into their own hands.

### Gould (2003)

Roger Gould, [*Collision of Wills: How Ambiguity about Social Rank Breeds Conflict*](https://chicagoreference.com/ucp/books/book/chicago/C/bo3616160.html) (University of Chicago Press, 2003). Conflict flares where social rank is unclear. It informed the quarrels of people whose standing is in doubt.

### Collins (2008)

Randall Collins, [*Violence: A Micro-Sociological Theory*](https://muse.jhu.edu/book/36669) (Princeton University Press, 2008). Violence is rarer and clumsier in practice than it appears in stories. It informed how we treat violence in a scene.

### Jervis (1978)

Robert Jervis, ["Cooperation under the security dilemma"](https://stafforini.com/works/jervis-1978-cooperation-security-dilemma/) (*World Politics*, 1978). When defensive measures are hard to tell from offensive ones, rivals arm and mistrust each other. It informed how one group's defence looks like a threat to another.

### Boehm (1984)

Christopher Boehm, [*Blood Revenge: The Enactment and Management of Conflict in Montenegro and Other Tribal Societies*](https://ci.nii.ac.jp/ncid/BA00372483?l=en) (University Press of Kansas, 1984). Feuds are managed, with elders helping to settle them. It informed how a feud can be brought to an end.

### Gouldner (1960)

Alvin Gouldner, ["The norm of reciprocity: a preliminary statement"](https://doi.org/10.2307/2092623) (*American Sociological Review*, 1960). Returning a favour is a social norm that holds across societies. It informed how debts and favours bind people.

### Sahlins (1972)

Marshall Sahlins, [*Stone Age Economics*](https://ci.nii.ac.jp/ncid/BA0403771X) (Aldine-Atherton, 1972). How readily a gift or help is returned depends on how close the two parties are. It informed how the expectation of return varies with distance.

### Turner (1969)

Victor Turner, *The Ritual Process: Structure and Anti-Structure* (Aldine, 1969; [catalogue record](https://search.worldcat.org/title/641307467)), which builds on Arnold van Gennep's *Les rites de passage*. A change of status is staged in public, with a threshold stage in between. It informed how a character's change in standing is marked.

### Malle (1999, 2006)

Bertram Malle, ["How people explain behavior: a new theoretical framework"](https://doi.org/10.1207/s15327957pspr0301_2) (*Personality and Social Psychology Review*, 1999), and ["The actor-observer asymmetry in attribution: a (surprising) meta-analysis"](https://doi.org/10.1037/0033-2909.132.6.895) (*Psychological Bulletin*, 2006). Explaining an action by the actor's reasons differs from explaining it by its causes, and the supposed difference between how actors and observers explain behaviour does not hold up. They informed how characters explain what others do.

### Gilbert and Malone (1995)

Daniel Gilbert and Patrick Malone, ["The correspondence bias"](https://doi.org/10.1037/0033-2909.117.1.21) (*Psychological Bulletin*, 1995). Observers infer a person's dispositions from their behaviour and adjust for the situation only partly. It informed how characters misjudge one another.

### Kreminski and colleagues (2022, 2023)

Max Kreminski, Melanie Dickinson, Noah Wardrip-Fruin and Michael Mateas, ["Loose Ends: A Mixed-Initiative Creative Interface for Playful Storytelling"](https://ojs.aaai.org/index.php/AIIDE/article/view/21955) (AIIDE 2022), and James Dameris, Rosaura Hernandez Roman and Max Kreminski, ["Praxish: A Rational Reconstruction of a Logic-Based DSL for Modeling Social Practices"](https://ojs.aaai.org/index.php/AIIDE/article/view/27537) (AIIDE 2023). We read the abstracts only. The first describes a game in which a person and a rules-based system co-write a story, and a preliminary expert evaluation reported a sense of co-authorship. The second reports that Versu's language has been unavailable for about a decade without a comparably flexible successor, and rebuilds it as open source. They informed how we think about co-creative authoring tools.

### Mirowski et al. (2022)

Piotr Mirowski, Kory W. Mathewson, Jaylen Pittman and Richard Evans, ["Co-Writing Screenplays and Theatre Scripts with Language Models: An Evaluation by Industry Professionals"](https://arxiv.org/abs/2209.14958) (arXiv, 2022). We read the abstract only. It describes a tool that chains prompts to draft scripts and a study in which 15 theatre and film professionals co-wrote with it, and it raises concerns about plagiarism and bias. It informed how cautiously we treat machine help in authoring.

### Evans and Short (2014)

Richard Evans and Emily Short, ["Versu: a simulationist storytelling system"](https://doi.org/10.1109/tciaig.2013.2287297) (*IEEE Transactions on Computational Intelligence and AI in Games*, 2014). Its authoring practice keeps scenes agnostic about who plays each role. It informed how we write fragments that can be cast with different people. It also keeps a single public relationship state beside many asymmetric evaluations that each remember their reason, which we compared against when designing relationship records. The paper also describes the tools the authors built around their language: a type checker, a state inspector, deterministic playback and a stress-test tool. It records the tuning effort that remained. We compared these against what an author needs from our own tools.

### McCoy et al. (2011)

Joshua McCoy, Mike Treanor, Ben Samuel, Noah Wardrip-Fruin and Michael Mateas, ["Comme il Faut: a system for authoring playable social models"](https://ojs.aaai.org/index.php/AIIDE/article/view/12454) (*AIIDE*, 2011). Social exchanges have roles, including an optional third party, and weighted rules of influence; tuning thousands of such rules is costly. It informed how roles are cast and how costly tuning becomes. Their later paper [“Social story worlds with Comme il Faut”](https://doi.org/10.1109/TCIAIG.2014.2304692) (*IEEE Transactions on Computational Intelligence and AI in Games*, 2014), with Aaron Reed as a further co-author, keeps relationships as binary, non-exclusive states beside directional scalar networks, and lets statuses expire when their conditions no longer hold. It informed how we separate kinds of relationship record.

### Nelson et al. (2006)

Mark Nelson, Michael Mateas, David Roberts and Charles Isbell, ["Declarative optimization-based drama management in interactive fiction"](https://doi.org/10.1109/mcg.2006.55) (*IEEE Computer Graphics and Applications*, 2006). An author's sense of a good story can be expressed as a weighted combination of features, though that is hard to specify. It informed how author preference can steer choices. The paper also reports that the online search it tried performed poorly on larger, more complex stories. It also sets out five kinds of drama-manager action, each with a score for how manipulative it is, and a feature that rewards leaving the player choices.

### Tearse et al. (2014)

Brandon Tearse, Peter Mawhorter, Michael Mateas and Noah Wardrip-Fruin, ["Skald: Minstrel reconstructed"](https://doi.org/10.1109/tciaig.2013.2292313) (*IEEE Transactions on Computational Intelligence and AI in Games*, 2014). Adapting stories from a library needs costed transformations and a library tuned to the operators that adapt it. It taught us why adaptation of stored material turns brittle.

### Haralick and Elliott (1980)

Robert Haralick and Gordon Elliott, ["Increasing tree search efficiency for constraint satisfaction problems"](https://doi.org/10.1016/0004-3702(80)90051-x) (*Artificial Intelligence*, 1980). Trying first the choices most likely to fail finds a dead end sooner. It informed the order in which parts are cast.

### Yu, Guzdial and Sturtevant (2021)

Yu, Matthew Guzdial and Nathan Sturtevant, ["The Definition-Context-Purpose paradigm and other insights from industry professionals about the definition of a quest"](https://doi.org/10.1609/aiide.v17i1.18897) (*AIIDE*, 2021). Developers define a quest by its purpose and circumstances rather than by its parts. It informed how we describe what a quest is for. Kristen Yu, Matthew Guzdial and Nathan Sturtevant's later [Evaluating the Effects of AI Directors for Quest Selection](https://arxiv.org/abs/2410.03733) (arXiv, 2024) reports a small human study of three quest-selection directors and notes that the best-known director has no comparative data. It informed how thin the evidence for directors is.

### Sullivan, Mateas and Wardrip-Fruin (2012)

Anne Sullivan, Michael Mateas and Noah Wardrip-Fruin, ["Making quests playable: choices, CRPGs, and the Grail framework"](https://ojs.gold.ac.uk/index.php/lea/article/view/183) (*Leonardo Electronic Almanac*, 2012). Role-playing quests are mostly task lists, varying only in a fight or one binary choice. It informed where quest structure is thin.

### Dhami, Belton and Mandel (2019)

Mandeep Dhami, Ian Belton and David Mandel, ["The 'analysis of competing hypotheses' in intelligence analysis"](https://doi.org/10.1002/acp.3550) (*Applied Cognitive Psychology*, 2019). The evidence that comparing rival explanations reduces bias is mixed. It tempered how much we expect from investigation structures.

### Cornish (1994)

Derek Cornish, ["The procedural analysis of offending and its relevance for situational prevention"](https://popcenter.asu.edu/sites/default/files/library/CrimePrevention/Volume_03/06_cornish.pdf) (*Crime Prevention Studies*, volume 3, 1994). It describes a crime as a script of stages, with alternative tracks and points where it can be interfered with. It informed how a job such as a heist breaks into stages.

### Reagan et al. (2016)

Andrew Reagan, Lewis Mitchell, Dilan Kiley, Christopher Danforth and Peter Dodds, ["The emotional arcs of stories are dominated by six basic shapes"](https://doi.org/10.1140/epjds/s13688-016-0093-1) (*EPJ Data Science*, 2016). Sentiment arcs of finished texts fall into a handful of shapes, with the authors' own stated limits. It informed which emotional shapes a quest can take.

### Tomlinson (2024)

Christine Tomlinson, [“Designing Romance and the ‘Playersexuality’ Debate: Love, Romance, Identity, and Player Perceptions of Baldur's Gate 3 and the Dragon Age Series”](https://revistas.ulusofona.pt/index.php/ijgsi/article/view/9461) (*The International Journal of Games and Social Impact*, 2024). Players are divided on romance that bends to the player's own orientation, want romance that feels real, and find persistent pursuit by characters uncomfortable. It informed how we think about romance in games.

### Smith and Whitehead (2010)

Gillian Smith and Jim Whitehead, [“Analyzing the Expressive Range of a Level Generator”](https://www.pcgworkshop.com/archive/smith2010analyzing.pdf) (*Workshop on Procedural Content Generation in Games*, 2010). It judges a generator by plotting the variety of what it can produce on chosen measures, not by how much it makes, and shows that doing so exposes unexpected biases and gaps. It informed how we measure the variety of generated quests.

### Shaib et al. (2024)

Chantal Shaib, Yanai Elazar, Junyi Jessy Li and Byron Wallace, [“Detection and Measurement of Syntactic Templates in Generated Text”](https://arxiv.org/abs/2407.00211) (EMNLP 2024). It defines a template over an abstraction and offers measures of how templated a body of text is. We adapt the idea, not the code, to the skeletons of generated quests.

### Redden (2008)

Joseph Redden, [“Reducing Satiation: The Role of Categorization Level”](https://ideas.repec.org/a/oup/jconrs/v34y2008i5p624-634.html) (*Journal of Consumer Research*, 2008). People tire of repeated experiences more slowly when they categorise them more finely, so differences that can be named hold interest longer. It informed why variety must be nameable.

### Saffran, Aslin and Newport (1996)

Jenny Saffran, Richard Aslin and Elissa Newport, [“Statistical learning by 8-month-old infants”](https://pubmed.ncbi.nlm.nih.gov/8943209/) (*Science*, 1996). Infants learned which sounds follow which from about two minutes of listening. It informed how quickly people pick up the patterns in repeated material.

### Agus, Thorpe and Pressnitzer (2010)

Trevor Agus, Simon Thorpe and Daniel Pressnitzer, [“Rapid formation of robust auditory memories: insights from noise”](https://pure.qub.ac.uk/en/publications/rapid-formation-of-robust-auditory-memories-insights-from-noise/) (*Neuron*, 2010). Listeners learned repeating noise clips without trying, and several stayed in memory for weeks. It informed how quickly and durably repetition is noticed.

### Falk and Konold (1997)

Ruma Falk and Clifford Konold, [“Making sense of randomness: implicit encoding as a basis for judgment”](https://srri.umass.edu/publications/falk-1997msr/) (*Psychological Review*, 1997). People rate sequences that alternate too much as the most random, and perceived randomness tracks how hard a sequence is to encode. It informed why a fair random draw can feel repetitive.

### Doshi and Hauser (2024)

Anil Doshi and Oliver Hauser, [“Generative AI enhances individual creativity but reduces the collective diversity of novel content”](https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532) (*Science Advances*, 2024). Stories written with model-generated ideas were rated better but were more like one another. It informed our caution about sameness in model-assisted writing.

### Cilibrasi and Vitányi (2005)

Rudi Cilibrasi and Paul Vitányi, [“Clustering by compression”](https://arxiv.org/abs/cs/0312044) (*IEEE Transactions on Information Theory*, 2005). A feature-free distance between two things can be computed from compressed lengths. It informed how we think about measuring similarity between generated items.

### Aron et al. (1997)

Arthur Aron, Edward Melinat, Elaine Aron, Robert Vallone and Renee Bator, [“The experimental generation of interpersonal closeness”](https://stafforini.com/works/aron-1997-experimental-generation-interpersonal/) (*Personality and Social Psychology Bulletin*, 1997). Escalating mutual self-disclosure over a short session produced a temporary feeling of closeness greater than small talk did. It informed how closeness builds within a conversation.

### Laurenceau et al. (1998, 2005)

Jean-Philippe Laurenceau, Lisa Feldman Barrett and Paula Pietromonaco, [a 1998 study](https://www.affective-science.org/pubs/1998/LaurenFBPl1998.pdf) (*Journal of Personality and Social Psychology*), and Laurenceau, Barrett and Michael Rovine, [“The interpersonal process model of intimacy in marriage: a daily-diary and multilevel modeling approach”](https://www.affective-science.org/pubs/2005/Laurenceauetal2005.pdf) (*Journal of Family Psychology*, 2005). Disclosure by either partner predicts intimacy, partly through how responsive the other is perceived to be. It informed how we think about responsiveness.

### Hall (2018)

Jeffrey Hall, "How many hours does it take to make a friend?" (*Journal of Social and Personal Relationships*, 2018), as [reported by the University of Kansas](https://news.ku.edu/news/article/2018/03/06/study-reveals-number-hours-it-takes-make-friend). Friendship takes tens to hundreds of hours together, and time spent working together counts for less. It informed the time that closeness takes.

### Aron et al. (2000)

Arthur Aron, Christina Norman, Elaine Aron, Caroline McKenna and Richard Heyman, [“Couples' shared participation in novel and arousing activities and experienced relationship quality”](https://doi.org/10.1037/0022-3514.78.2.273) (*Journal of Personality and Social Psychology*, 2000). A new shared activity raised relationship quality more than a mundane one. It informed why shared novelty counts for more than routine.

### Clark and Mills (1979)

Margaret Clark and Judson Mills, [“Interpersonal attraction in exchange and communal relationships”](https://clarkrelationshiplab.yale.edu/sites/default/files/files/Interpersonal%20attraction%20in%20exchance%20and%20commual%20relationships.pdf) (*Journal of Personality and Social Psychology*, 1979). Repaying a benefit raises attraction in an exchange relationship but lowers it in a communal one. It informed why repayment between close people can read as a refusal.

### Heyman and Slep (2001)

Richard Heyman and Amy Smith Slep, [“The hazards of predicting divorce without cross-validation”](https://pmc.ncbi.nlm.nih.gov/articles/PMC1622921/) (*Journal of Marriage and Family*, 2001). A prediction equation that looks accurate on the data it was built from does far worse on fresh data. It informed why we distrust predictions of relationship outcomes that have not been tested on new data.

### Gable et al. (2004)

Shelly Gable, Harry Reis, Emily Impett and Evan Asher, [“What do you do when things go right? The intrapersonal and interpersonal benefits of sharing positive events”](https://doi.org/10.1037/0022-3514.87.2.228) (*Journal of Personality and Social Psychology*, 2004). Sharing good news helps most when the listener responds actively and constructively, and such responses go with closer relationships. It informed how we think about responses to good news.

### Mayer, Davis and Schoorman (1995)

Roger Mayer, James Davis and F. David Schoorman, [“An integrative model of organizational trust”](https://doi.org/10.2307/258792) (*Academy of Management Review*, 1995). Trust rests on the trustee's perceived ability, benevolence and integrity. It informed how we describe what trust is built from.

### Kim et al. (2004)

Peter Kim, Donald Ferrin, Cecily Cooper and Kurt Dirks, [“Removing the shadow of suspicion: the effects of apology versus denial for repairing competence- versus integrity-based trust violations”](https://doi.org/10.1037/0021-9010.89.1.104) (*Journal of Applied Psychology*, 2004). An apology repairs a breach of competence better than a denial, and a denial repairs a breach of integrity better. It informed how repair depends on the kind of breach.

### Roberts and Dunbar (2011, 2015)

Sam Roberts and Robin Dunbar, [“Communication in social networks: effects of kinship, network size, and emotional closeness”](https://doi.org/10.1111/j.1475-6811.2010.01310.x) (*Personal Relationships*, 2011), and [“Managing relationship decay: network, gender, and contextual effects”](https://doi.org/10.1007/s12110-015-9242-7) (*Human Nature*, 2015). Kin ties appear cheaper to keep up than friendships, and friendships decline without effort, which women tend to offset with contact and men with shared activities. It informed how relationships fade and are maintained.

### Levin, Walter and Murnighan (2011)

Daniel Levin, Jorge Walter and J. Keith Murnighan, [“Dormant ties: the value of reconnecting”](https://doi.org/10.1287/orsc.1100.0576) (*Organization Science*, 2011). Reconnecting with a dormant tie can bring back trust and shared perspective that are usually linked to strong ties. It informed what a lapsed relationship keeps.

### Liu et al. (2023)

Peggy Liu, SoYon Rim, Lauren Min and Kate Min, [“The surprise of reaching out: appreciated more than we think”](https://pubmed.ncbi.nlm.nih.gov/35816566/) (*Journal of Personality and Social Psychology*, 2023). People underestimate how much others appreciate being reached out to. It informed how we think about contact after a gap.

### De Freitas et al. (2025)

Julian De Freitas, Zeliha Oğuz-Uğuralp and Ahmet Kaan-Uğuralp, [“Emotional manipulation by AI companions”](https://arxiv.org/abs/2508.19258) (Harvard Business School working paper, 2025). Guilt-tripping goodbyes from companion apps raised engagement while leaving people feeling manipulated. It informed what a character must not do when someone leaves.

### Zagal, Björk and Lewis (2013)

José Zagal, Staffan Björk and Chris Lewis, [“Dark patterns in the design of games”](https://research.chalmers.se/en/publication/177148) (*Foundations of Digital Games*, 2013). It names design elements that serve the maker over the player, including appointment play and grinding as temporal dark patterns. It informed what relationship and quest pacing must avoid. Its definition (a pattern that works against players' interests and without their consent) also shaped our checks on how the director may use what it knows about the player.

### Kilduff, Elfenbein and Staw (2010)

Gavin Kilduff, Hillary Elfenbein and Barry Staw, [“The psychology of rivalry: a relationally dependent analysis of competition”](https://web-docs.stern.nyu.edu/management/Kilduff/KilduffEtAl%20AMJ%202010.pdf) (*Academy of Management Journal*, 2010). Rivalry grows with similarity, closeness and a history of contests. It informed how a rivalry forms.

### Granovetter (1973)

Mark Granovetter, [“The strength of weak ties”](https://smg.media.mit.edu/classes/library/granovetter.weak.ties/granovetter.html) (*American Journal of Sociology*, 1973). The strength of a tie combines time, emotional intensity, intimacy and reciprocal services. It informed how we describe the strength of a relationship.

### Lessard et al. (2026)

Jonathan Lessard, Stephen Friedrich, Samuel Paré-Chouinard and Leila Kosseim, [“Narrative Gold Digging: Sifting and Narrating Stories from a Procedural Simulation”](https://www.pcgworkshop.com/archive/lessard2026narrative.pdf) (*Foundations of Digital Games*, 2026). In a reader test, sifting by unexpectedness or by dramatic situations made no significant difference to how the stories were rated, and the authors reflect candidly on why criteria for eventfulness are hard to compute. It tempered how much we expect from any single sifting measure.

### Lyu, Millard and Gibbins (2025)

Qianwen Lyu, David Millard and Nicholas Gibbins, [“Stories from the Bottom Up: Emergent Narratives with Composable Story Sifting Patterns”](https://eprints.soton.ac.uk/502632/2/3723498.3723809.pdf) (2025). Sifting patterns can be composed so that higher-level stories are built from lower-level ones, and stability and scaling were tested. It informed how sifting patterns combine.

### Leong, Porteous and Thangarajah (2022)

Wilkins Leong, Julie Porteous and John Thangarajah, [“Automated Sifting of Stories from Simulated Storyworlds”](https://www.ijcai.org/proceedings/2022/0686.pdf) (IJCAI, 2022). Stories are sifted by drawing the shape of a story arc and matching it to the changing relationship scores in the simulation, which lowers the cost of writing queries. It informed how sifting might be specified without code.

### Baroni (*Tellability*)

Raphaël Baroni, [“Tellability”](https://www-archiv.fdm.uni-hamburg.de/lhn/node/30.html) (*the living handbook of narratology*, Hamburg University Press). It maps the accounts of what makes a story worth telling and their open problems. It informed how we treat tellability as unsettled.

### Hühn (*Event and Eventfulness*)

Peter Hühn, [“Event and eventfulness”](https://www-archiv.fdm.uni-hamburg.de/lhn/node/39.html) (*the living handbook of narratology*, Hamburg University Press). It separates the two senses of event, and holds that an event is stronger as its change is less predictable and more intense, momentous, irreversible or unique. It informed how we describe the strength of an event.

### Jean-Louis Dessalles

Jean-Louis Dessalles, [Simplicity Theory](https://simplicitytheory.telecom-paris.fr/), and Dimulescu and Dessalles, “Understanding narrative interest: some evidence on the role of unexpectedness” (Cognitive Science Society, 2009). Unexpectedness is the gap between expected and observed complexity, judged by the observer, and it drives narrative interest. It informed how we think about unexpectedness as part of tellability.

### Harcup and O'Neill (2017)

Tony Harcup and Deirdre O'Neill, [“What is news? News values revisited (again)”](https://eprints.hud.ac.uk/id/eprint/27268/) (*Journalism Studies*, 2017). A content analysis of UK news yields an updated set of news values, with the caution that no list can explain everything. It informed how we treat a list of selection criteria.

### Riedl and Young (2010)

Mark Riedl and R. Michael Young, [“Narrative planning: balancing plot and character”](https://jair.org/index.php/jair/article/view/10669) (*Journal of Artificial Intelligence Research*, 2010). Plans whose character goals are explained were better understood by audiences than plans from conventional planners. It informed why a story's motives should be stated.

### Wilmot and Keller (2020)

David Wilmot and Frank Keller, [“Modelling suspense in short stories as uncertainty reduction over neural representation”](https://arxiv.org/abs/2004.14905) (ACL 2020). Forward-looking uncertainty reduction predicted human suspense judgements better than backward-looking surprise. It informed how we think about suspense as looking ahead.

### Deo, Chung and McCoy (2024)

Sage Deo, Jonathan Chung and Joshua McCoy, [“Shepherd: an incremental story sifting-based drama manager”](https://ojs.aaai.org/index.php/AIIDE/article/view/31887) (AIIDE 2024). Incremental sifting can steer fully autonomous characters toward narratively interesting choices. It informed how sifting might feed back into a running simulation.

### Fisher, Siler and Ware (2025)

Mira Fisher, Molly Siler and Stephen G. Ware, [“Structure, Agency, and Improvisation in Human-Led Digital Interactive Narrative Exercises”](https://www.cs.uky.edu/~sgware/reading/papers/fisher2025structure.pdf) (*AIIDE*, 2025). In a study of a player paired with a human game master, perceived structure and perceived agency went together, and poor agency read as a failed partnership. It informed how we think about agency as shared work between player and storyteller.

### Wardrip-Fruin et al. (2009)

Noah Wardrip-Fruin, Michael Mateas, Steven Dow and Serdar Sali, [“Agency Reconsidered”](https://dl.digra.org/index.php/dl/article/view/369) (*DiGRA*, 2009). Agency arises where what the player wants to do is what the system supports. It is a matter of the player and the system's model together, and more realism can lower it. It informed how we think about matching a player's intent to what a story can answer.

### Horvitz (1999)

Eric Horvitz, [“Principles of Mixed-Initiative User Interfaces”](https://www.interruptions.net/literature/Horvitz-CHI99-p159-horvitz.pdf) (*CHI*, 1999). A system should act only when the expected value of acting beats doing nothing, offer a cheap way to open a dialogue, and weigh the cost of bothering the user. It informed when a director should step in.

### Iqbal and Bailey (2008)

Shamsi Iqbal and Brian Bailey, [“Effects of Intelligent Notification Management on Users and Their Tasks”](https://www.interruptions.net/literature/Iqbal-CHI08.pdf) (*CHI*, 2008). Deferring notifications to breakpoints lowered frustration, how fine a breakpoint must be depends on how relevant the message is, and detecting breakpoints is imperfect. It informed when to deliver an offer.

### Trafton et al. (2003)

J. Gregory Trafton, Erik Altmann, Derek Brock and Farilee Mintz, [“Preparing to resume an interrupted task: effects of prospective goal encoding and retrospective rehearsal”](https://interruptions.net/literature/Trafton-IJHCS03.pdf) (*International Journal of Human-Computer Studies*, 2003). An eight-second warning before an interruption helped people prepare and resume. It informed how much notice an offer should give. It also showed that cues in the setting can revive a goal that had faded, which informed how a returning player is reminded.

### Adamczyk and Bailey (2004)

Piotr Adamczyk and Brian Bailey, [“If not now, when? The effects of interruption at different moments within task execution”](https://doi.org/10.1145/985692.985727) (*CHI*, 2004). Interruptions at different moments differ in their emotional effect. It informed our view that the moment of an offer matters as well as the offer.

### McFarlane (2002)

Daniel McFarlane, [“Comparison of Four Primary Methods for Coordinating the Interruption of People in Human-Computer Interaction”](https://www.interruptions.net/literature/McFarlane-HCI02_2.pdf) (*Human-Computer Interaction*, 2002). It compares immediate, negotiated, mediated and scheduled interruption, and finds an advantage for negotiation. It informed how an offer can be negotiated rather than imposed.

### Mark, Gudith and Klocke (2008)

Gloria Mark, Daniela Gudith and Ulrich Klocke, [“The Cost of Interrupted Work: More Speed and Stress”](https://www.interruptions.net/literature/Mark-CHI08.pdf) (*CHI*, 2008). People finish interrupted work faster at the price of stress, so an absence of complaints is weak evidence that an interruption did no harm. It informed how we judge whether pacing works.

### Fischer, Greenhalgh and Benford (2011)

Joel Fischer, Chris Greenhalgh and Steve Benford, [“Investigating Episodes of Mobile Phone Activity as Indicators of Opportune Moments to Deliver Notifications”](https://interruptions.net/literature/Fischer-MobileHCI11.pdf) (*MobileHCI*, 2011). Notifications were handled faster just after an episode of activity ended. It informed where in a player's activity an offer fits.

### Mehrotra and Musolesi (2017)

Abhinav Mehrotra and Mirco Musolesi, [“Intelligent Notification Systems: A Survey of the State of the Art and Research Challenges”](https://arxiv.org/abs/1711.10171) (arXiv, 2017). A survey of breakpoints, engagement and receptivity, with the size of the effects reported. It informed how large we expect timing effects to be.

### Hsieh et al. (2020)

Ching-Yu Hsieh, Yi-Shyuan Chiang, Hung-Yu Chiu and Yung-Ju Chang, [“Bridging the Virtual and Real Worlds: A Preliminary Study of Messaging Notifications in Virtual Reality”](https://doi.org/10.1145/3313831.3376228) (*CHI*, 2020). Higher engagement made notifications feel worse timed. It informed how we think about interrupting a player who is deeply absorbed.

### Chen, Nelson and Mateas (2009)

Sherol Chen, Mark Nelson and Michael Mateas, [“Evaluating the Authorial Leverage of Drama Management”](https://ojs.aaai.org/index.php/AIIDE/article/view/12377) (*AIIDE*, 2009). It gives three measures for asking whether a drama manager does better than a trigger script. It informed how we test whether a director earns its place.

### Thue et al. (2007)

David Thue, Vadim Bulitko, Marcia Spetch and Eric Wasylishen, [“Interactive Storytelling: A Player Modelling Approach”](https://ojs.aaai.org/index.php/AIIDE/article/view/18780) (*AIIDE*, 2007). Adapting a story to a learned play style helped some players in a study of 90 university students, but the results across all players did not strongly support it. It informed how much we expect adaptation to help.

### Lehne and Koelsch (2015)

Moritz Lehne and Stefan Koelsch, [“Toward a general psychological model of tension and suspense”](https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00079/full) (*Frontiers in Psychology*, 2015). Tension precedes events and rests on prediction under uncertainty; the effect of delay is left an open question. It informed how we think about building tension before an event.

### de Berker et al. (2016)

Archy de Berker and colleagues, [“Computations of uncertainty mediate acute stress responses in humans”](https://pmc.ncbi.nlm.nih.gov/articles/PMC4820542) (*Nature Communications*, 2016). Stress tracks uncertainty that cannot be reduced and peaks at even odds. It informed how we think about uncertainty as a source of pressure.

### Vachiratamporn et al. (2013)

Vanus Vachiratamporn, Paul Inventado, Roberto Legaspi, Koichi Moriyama and Masayuki Numao, [“An analysis of affective state transitions in survival horror game with the aid of player self-reports and physiological signals”](https://www.ai-gakkai.or.jp/jsai2013/webprogram/2013/paper-987.html) (JSAI, 2013). In these initial results, players already in a suspense state were more likely to become more fearful at a scare. It informed how we think about scares landing on built-up tension.

### Berns et al. (2006)

Gregory Berns, Jonathan Chappelow, Milos Cekic, Caroline Zink, Giuseppe Pagnoni and Megan Martin-Skurski, [“Neurobiological substrates of dread”](https://pubmed.ncbi.nlm.nih.gov/16675703/) (*Science*, 2006). Some people chose a worse outcome sooner rather than wait for it. It informed how we think about the cost of waiting.

### Mobbs et al. (2007)

Dean Mobbs and colleagues, [“When Fear Is Near: Threat Imminence Elicits Prefrontal-Periaqueductal Gray Shifts in Humans”](https://pmc.ncbi.nlm.nih.gov/articles/PMC2648508) (*Science*, 2007). Responses change as a threat gets closer, tracking dread. It informed how we think about a threat's approach.

### Loewenstein (1987, 1994)

George Loewenstein, [“Anticipation and the Valuation of Delayed Consumption”](https://ideas.repec.org/a/ecj/econjl/v97y1987i387p666-84.html) (*Economic Journal*, 1987). People savour good outcomes and want bad ones over with. It informed how we think about waiting for good and bad news. His [“The psychology of curiosity: A review and reinterpretation”](https://stafforini.com/works/loewenstein-1994-psychology-curiosity-review/) (*Psychological Bulletin*, 1994) describes curiosity as the felt lack that comes from noticing a gap in what one knows. It informed how we think about teasing a player without giving the answer away.

### Ely, Frankel and Kamenica (2015)

Jeffrey Ely, Alexander Frankel and Emir Kamenica, [“Suspense and Surprise”](https://www.journals.uchicago.edu/doi/10.1086/677350) (*Journal of Political Economy*, 2015). Suspense is the spread of what the audience expects to believe next, and surprise is the size of the change in belief. It informed how we tell the two apart.

### Cowan (2001)

Nelson Cowan, [“The magical number 4 in short-term memory: a reconsideration of mental storage capacity”](https://pubmed.ncbi.nlm.nih.gov/11515286/) (*Behavioral and Brain Sciences*, 2001). It proposes a central limit of about four items in the focus of attention. It informed how many threads we expect a player to follow at once.

### Ghibellini and Meier (2025)

Romain Ghibellini and Beat Meier, [“Interruption, recall and resumption: a meta-analysis of the Zeigarnik and Ovsiankina effects”](https://doi.org/10.1057/s41599-025-05000-w) (*Humanities and Social Sciences Communications*, 2025). Unfinished tasks are not remembered better, but people tend to resume them. It informed how we think about unfinished story threads.

### Cheong and Young (2015)

Yun-Gyung Cheong and R. Michael Young, [“Suspenser: A Story Generation System for Suspense”](https://www.cs.uky.edu/~sgware/reading/papers/cheong2015suspenser.pdf) (*IEEE Transactions on Computational Intelligence and AI in Games*, 2015). It counts the routes that remain to a goal as an estimate of suspense. It informed how suspense might be measured.

### Alston (2016)

Adam Alston, [*Beyond Immersive Theatre: Aesthetics, Politics and Productive Participation*](https://research.gold.ac.uk/28079) (Palgrave Macmillan, 2016). A critical study of immersive theatre and the productive participation it asks of audiences. It informed how we think about what a participant is asked to do.

### Mawhorter et al. (2014)

Peter Mawhorter, Michael Mateas, Noah Wardrip-Fruin and Arnav Jhala, [“Towards a Theory of Choice Poetics”](https://cs.wellesley.edu/~pmwh/research/papers/towards-choice-poetics-fdg-2014.pdf) (*FDG*, 2014). It offers a vocabulary for false, blind, flavour and delayed-effect choices, and for why delayed effects feel important yet can frustrate. It informed how we describe the kinds of choice a player meets. It also showed that false, blind and delayed choices can each carry a theme, and that flavour choices shape a player's sense of who their character is.

### Cardona-Rivera et al. (2014)

Rogelio Cardona-Rivera, Justus Robertson, Stephen Ware, Brent Harrison, David Roberts and R. Michael Young, [“Foreseeing Meaningful Choices”](https://ojs.aaai.org/index.php/AIIDE/article/view/12716) (*AIIDE*, 2014). Foreseeing that options differ in situation raises felt agency. It informed how clearly the results of options should be foreseeable.

### Thue et al. (2011)

David Thue, Vadim Bulitko, Marcia Spetch and Trevon Romanuik, [“A Computational Model of Perceived Agency in Video Games”](https://ojs.aaai.org/index.php/AIIDE/article/view/12437) (*AIIDE*, 2011). Perceived agency tracked the player's desire for outcomes, in one study with a significant sub-contrast. It informed how modestly we hold claims about agency.

### Fendt et al. (2012)

Matthew Fendt, Brent Harrison, Stephen Ware, Rogelio Cardona-Rivera and David Roberts, [“Achieving the Illusion of Agency”](https://www.cs.uky.edu/~sgware/reading/papers/fendt2012achieving.pdf) (2012). It measures how much felt agency immediate acknowledgement of a choice preserves, and where that stops working. It informed how quickly a choice should be acknowledged.

### Miller (2017)

Tim Miller, [“Explanation in Artificial Intelligence: Insights from the Social Sciences”](https://arxiv.org/abs/1706.07269) (arXiv, 2017). Explanations are contrastive, selected and social. It informed how we explain why something happened.

### Deci, Koestner and Ryan (1999)

Edward Deci, Richard Koestner and Richard Ryan, [“A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation”](https://doi.org/10.1037/0033-2909.125.6.627) (*Psychological Bulletin*, 1999). Contingent tangible rewards undermined free-choice motivation in the laboratory, while positive feedback enhanced it. It informed how we think about rewarding a player.

### Ryan, Rigby and Przybylski (2006)

Richard Ryan, C. Scott Rigby and Andrew Przybylski, [“The motivational pull of video games: a self-determination theory approach”](https://doi.org/10.1007/s11031-006-9051-8) (*Motivation and Emotion*, 2006). Autonomy and competence predicted enjoyment and later play. It informed how we weigh a player's sense of choice and skill.

### Kim, Chen and Zhang (2016)

Sara Kim, Rocky Peng Chen and Ke Zhang, [“Anthropomorphized helpers undermine autonomy and enjoyment in computer games”](https://ideas.repec.org/a/oup/jconrs/v43y2016i2p282-302..html) (*Journal of Consumer Research*, 2016). Unrequested humanlike help lowered autonomy and enjoyment. It informed how we think about help a player did not ask for.

### Rains (2013)

Stephen Rains, [“The nature of psychological reactance revisited: a meta-analytic review”](https://doi.org/10.1111/j.1468-2958.2012.01443.x) (*Human Communication Research*, 2013). Reactance after a threat to freedom is anger and negative thought. It informed how we think about a player who feels pushed.

### Pailhès, Kumari and Kuhn (2021)

Alice Pailhès, Shringi Kumari and Gustav Kuhn, [“The Magician's Choice: Providing illusory choice and sense of agency with the Equivoque forcing technique”](https://research.gold.ac.uk/29234) (2021). Illusory agency can survive repetition and prior preference. It informed how robust a sense of choice can be.

### Johansson et al. (2005)

Petter Johansson, Lars Hall, Sverker Sikström and Andreas Olsson, [“Failure to detect mismatches between intention and outcome in a simple decision task”](https://lup.lub.lu.se/record/220623) (*Science*, 2005). People missed mismatches between their choice and the outcome, and gave reasons for choices they had not made. It informed how reliable we think players' accounts of their own choices are.

### Buehner and May (2002)

Marc Buehner and Jon May, [“Knowledge mediates the timeframe of covariation assessment in human causal induction”](https://doi.org/10.1080/13546780244000060) (*Thinking & Reasoning*, 2002). Delay weakens causal judgement less when a delay is expected. It informed how delayed consequences can still be tied to their causes.

### Carey and Russell

Maggie Carey and Shona Russell (compilers), [“Re-authoring: some answers to commonly asked questions”](https://www.dulwichcentre.com.au/wp-content/uploads/2016/12/Re-authoring-Some-Answers-to-Commonly-Asked-Questions.pdf) (Dulwich Centre). A single exception to a dominant story is fragile until it is linked to others. It informed how we think about one-off events that change how a character is seen.

### Ignatius of Loyola

Ignatius of Loyola, [*The Spiritual Exercises*](https://ccel.org/ccel/ignatius/exercises.ix.html), in its opening Annotations (Christian Classics Ethereal Library). A guide stands neutral, asks about the person's responses and adapts to them. It informed how we think about a guide who adapts without steering.

### Sarian (2018)

Antranig Arek Sarian, [“No Going Back”: The Telltale Model as Thought Experiment](https://eludamos.org/index.php/eludamos/article/view/vol9no1-2) (*Eludamos: Journal for Computer Game Culture*, 2018). It reads why choices that do not seem to matter still work. It informed how we think about choices whose effects are mostly felt.

### McLaren, Oades and Deery (2026)

Patrick McLaren, Lindsay Oades and Ben Deery, [“How do dungeon masters and players contribute to the needs satisfaction (or frustration) in Dungeons & Dragons 5th Edition?”](https://doi.org/10.33063/ijrp.vi17.676) (*International Journal of Role-Playing*, issue 17, 2026). A large survey framed by self-determination theory, with agency as a theme. It informed how we think about what a game master gives players.

### Schibler, Hahn and Green (2024)

Katherine Schibler, Lindsay Hahn and Melanie C. Green, [“Investigating Responses to Narrative Cliffhangers Using Affective Disposition Theory”](https://researchconnect.buffalo.edu/en/publications/investigating-responses-to-narrative-cliffhangers-using-affective/) (*Media Psychology* 27(1), 2024). Readers of a cliffhanger ending wanted a next instalment more than readers of a resolved ending, and enjoyed the story no more. It informed why we do not use open endings to bring players back.

### Zwaan, Langston and Graesser (1995)

Rolf Zwaan, Mark Langston and Arthur Graesser, [“The construction of situation models in narrative comprehension: an event-indexing model”](https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1995.tb00513.x/) (*Psychological Science* 6(5), 1995). Readers follow a story's time, place, characters, causes and goals, and update their picture when one of them shifts. It informed how we re-orient a player after a jump in time or place.

### Fredrickson and Kahneman (1993)

Barbara Fredrickson and Daniel Kahneman, [“Duration neglect in retrospective evaluations of affective episodes”](https://pubmed.ncbi.nlm.nih.gov/8355141/) (*Journal of Personality and Social Psychology* 65(1), 1993). People judged an episode by its most intense moment and its end, and gave its length little weight. It informed how we think about how a stretch of play ends.

### Bae and Young (2014)

Byung-Chull Bae and R. Michael Young, [“A Computational Model of Narrative Generation for Surprise Arousal”](https://www.cs.uky.edu/~sgware/reading/papers/bae2014surprise.pdf) (*IEEE Transactions on Computational Intelligence and AI in Games* 6(2), 2014). Curiosity and surprise differ by whether the reader notices that the causes of an event are missing. In their test with generated stories, an added hint sentence gave no extra surprise and lowered the coherence ratings. It informed how we plant traces of events that are yet to come.

### Garrett, Lazzaro, Ariely and Sharot (2016)

Neil Garrett, Stephanie C. Lazzaro, Dan Ariely and Tali Sharot, [“The brain adapts to dishonesty”](https://www.nature.com/articles/nn.4426) (*Nature Neuroscience* 19(12), 2016). Repeated self-serving dishonesty dulled the brain's emotional response, and the size of the dulling predicted bigger lies later. It informed how we model gradual change for the worse in characters.

### Roberts, Walton and Viechtbauer (2006)

Brent W. Roberts, Kate E. Walton and Wolfgang Viechtbauer, [“Patterns of mean-level change in personality traits across the life course: a meta-analysis of longitudinal studies”](https://doi.org/10.1037/0033-2909.132.1.1) (*Psychological Bulletin* 132(1), 2006). Personality traits change slowly and by small amounts. It informed the pace at which we let characters change.

### Gentner, Rattermann and Forbus (1993)

D. Gentner, M. J. Rattermann and K. D. Forbus, [“The roles of similarity in transfer: separating retrievability from inferential soundness”](https://doi.org/10.1006/cogp.1993.1013) (*Cognitive Psychology* 25(4), 1993). People are reminded of earlier cases by surface likeness, but judge how sound a comparison is by shared structure. It informed how we link scenes that echo each other.

### Graesser, Singer and Trabasso (1994)

Arthur C. Graesser, Murray Singer and Tom Trabasso, [“Constructing inferences during narrative text comprehension”](https://doi.org/10.1037/0033-295X.101.3.371) (*Psychological Review* 101(3), 1994). Readers search for an explanation of why events happen. It informed why we make the causes of events findable.

### Roese and Vohs (2012)

Neal J. Roese and Kathleen D. Vohs, [“Hindsight bias”](https://doi.org/10.1177/1745691612454303) (*Perspectives on Psychological Science* 7(5), 2012). Once people know an outcome, they remember having expected it. It informed why we do not take players' claims of foresight as proof that a planted trace worked.

### Gerrig (1989)

Richard J. Gerrig, [“Suspense in the absence of uncertainty”](https://researchconnect.stonybrook.edu/en/publications/suspense-in-the-absence-of-uncertainty/) (*Journal of Memory and Language* 28(6), 1989). Readers can feel suspense about an outcome they already know. It informed how we think about foreshadowing that gives the outcome away.

### Jacobs, Werning, Jansz and Kneer (2021)

Ruud S. Jacobs, Stefan Werning, Jeroen Jansz and Julia Kneer, [“Procedural arguments of persuasive games: an elaboration likelihood perspective”](https://research.utwente.nl/en/publications/procedural-arguments-of-persuasive-games-an-elaboration-likelihoo-4/) (*Journal of Media Psychology* 33(2), 2021). In an experiment with 241 participants, games whose rules argued more strongly persuaded more. It informed how we think about a game's rules carrying a message.

### Sicart (2011)

Miguel Sicart, [“Against Procedurality”](https://gamestudies.org/1103/articles/sicart_ap) (*Game Studies* 11(3), 2011). A critique of the idea that rules carry a game's meaning: rules frame play, and meaning also arises in the playing. It informed why we expect players to read a system's message in their own way.

### Formosa, Ryan and Staines (2016)

Paul Formosa, Malcolm Ryan and Dan Staines, [“Papers, Please and the systemic approach to engaging ethical expertise in videogames”](https://researchers.mq.edu.au/en/publications/papers-please-and-the-systemic-approach-to-engaging-ethical-exper/) (*Ethics and Information Technology* 18(3), 2016). A game's systems can engage a player's moral judgement in ways scripted scenes do not. It informed how we think about carrying moral weight through costs and systems.

### Schacter (1999)

Daniel Schacter, [“The seven sins of memory: insights from psychology and cognitive neuroscience”](https://sites.harvard.edu/schacter-memory/files/2022/09/schacter1999.pdf) (*American Psychologist*, 1999). Memory fails in seven named ways, such as fading, blocking and misattribution, and retrieving a name is a common place to be blocked. It informed which kinds of mistake a character may make about the past.

### Farmer, Kelly and Jones-Rincon (2024, 2025)

George Farmer and Danielle Kelly, [“‘Save-scumming’ in role-playing games: a call for further psychological exploration”](https://bps.org.uk/news/save-scumming-role-playing-games-call-further-psychological-exploration) (British Psychological Society, 2024), and George Farmer, Danielle Kelly and Amanda Jones-Rincon, [“Save-scumming: a novel exploration of video game play”](https://dl.digra.org/index.php/dl/article/view/2509) (DiGRA, 2025). Players reload for several reasons, such as protecting a character or shaping the story, and the research is thin. It informed how we treat reloading without judging it.

### Park et al. (2023)

Joon Sung Park, Joseph O’Brien, Carrie Cai, Meredith Ringel Morris, Percy Liang and Michael Bernstein, [“Generative agents: interactive simulacra of human behavior”](https://arxiv.org/abs/2304.03442) (arXiv, 2023). Simulated characters scored each memory by recency, importance and how closely it matched the situation, and reflected when recent importance added up. It informed how we rate a memory's importance when it forms.

### Anderson and Schooler (1991)

John Anderson and Lael Schooler, [“Reflections of the environment in memory”](https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1991.tb00174.x/) (*Psychological Science*, 1991). How likely something is to be needed again follows how often, how recently and how regularly it came up, and memory follows the same pattern. It informed the shape of our forgetting curve.

### Wixted and Ebbesen (1991)

John Wixted and Ebbe Ebbesen, [“On the form of forgetting”](https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1991.tb00175.x/) (*Psychological Science*, 1991). In three experiments a power function fitted forgetting better than five other forms. It informed the shape of our forgetting curve.

### Rubin and Wenzel (1996)

David Rubin and A. E. Wenzel, [“One hundred years of forgetting: a quantitative description of retention”](https://cenl.ucsd.edu/Jclub/Rubin_Wenzel_1996.pdf) (*Psychological Review*, 1996). Four different curves fitted 210 sets of retention data about equally well, so the exact form of forgetting is not settled. It informed our decision to keep the curve open to testing.

### Murre and Dros (2015)

Jaap Murre and Joeri Dros, [“Replication and analysis of Ebbinghaus’ forgetting curve”](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644) (*PLOS ONE*, 2015). A one-person replication of the classic curve found forgetting steep early on, with a likely small rise at 24 hours. It informed how we picture early forgetting.

### Talarico and Rubin (2003)

Jennifer Talarico and David Rubin, [“Confidence, not consistency, characterizes flashbulb memories”](https://scholars.duke.edu/publication/651206) (*Psychological Science*, 2003). Vivid memories of a major event kept their confidence while their details drifted as fast as in ordinary memories. It informed keeping a character's confidence apart from how much they can recall.

### Roediger and Karpicke (2006)

Henry Roediger and Jeffrey Karpicke, [“Test-enhanced learning: taking memory tests improves long-term retention”](https://profiles.wustl.edu/en/publications/test-enhanced-learning-taking-memory-tests-improves-long-term-ret/) (*Psychological Science*, 2006). Recalling a passage protected it better than studying it again. It informed how telling a story and being asked about it keep a memory alive.

### Candia et al. (2019)

Cristian Candia, C. Jara-Figueroa, Carlos Rodriguez-Sickert, Albert-László Barabási and César Hidalgo, [“The universal decay of collective memory and attention”](https://research.ceu.edu/en/publications/the-universal-decay-of-collective-memory-and-attention/) (*Nature Human Behaviour*, 2019). Attention to cultural products fades in two stages that match a spoken and a recorded channel. We took only that two-channel shape, not its timescales, for how a city's memory of an event fades.

### Cuc, Koppel and Hirst (2007)

Alexandru Cuc, Jonathan Koppel and William Hirst, [“Silence is not golden: a case for socially shared retrieval-induced forgetting”](https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.2007.01967.x/) (*Psychological Science*, 2007). A listener who hears someone recall selectively forgets related things the speaker leaves out. It informed how retelling can make others forget as well as remember.

### Bergman and Roediger (1999)

Erik Bergman and Henry Roediger, [“Can Bartlett’s repeated reproduction experiments be replicated?”](https://profiles.wustl.edu/en/publications/can-bartletts-repeated-reproduction-experiments-be-replicated/) (*Memory & Cognition*, 1999). People retelling a story forgot more and distorted more as the delay grew, which replicated Bartlett’s classic result. It informed the ways a retold account can drift.

### Zhu and Seif El-Nasr (2021)

Jichen Zhu and Magy Seif El-Nasr, [“Open Player Modeling: Empowering Players through Data Transparency”](https://arxiv.org/abs/2110.05810) (arXiv, 2021). It sets out three levels of showing a player the model built from their play, and lists the costs: lost immersion, inaccuracy, gaming and privacy. It informed what the page of noticed behaviour shows and what it leaves out.

### Denisova and Cairns (2015, 2019)

Alena Denisova and Paul Cairns, [“Adaptation in Digital Games: The Effect of Challenge Adjustment on Player Performance and Experience”](https://www-users.york.ac.uk/~pc530/pubs/Denisova_CHIPLAY15.pdf) (*CHI PLAY*, 2015), and [“Player experience and deceptive expectations of difficulty adaptation in digital games”](https://eprints.whiterose.ac.uk/139704) (*Entertainment Computing*, 2019). Quiet adaptation raised immersion in a short study, and telling players a game adapts raised it whether or not it did. It informed our rule that adaptation must survive being revealed, and that a claim of personalisation is itself a lever.

### Susser, Roessler and Nissenbaum (2019)

Daniel Susser, Beate Roessler and Helen Nissenbaum, [“Technology, autonomy, and manipulation”](https://policyreview.info/articles/analysis/technology-autonomy-and-manipulation) (*Internet Policy Review*, 2019). They define online manipulation as covertly steering a person's decisions by exploiting their vulnerabilities. It informed where we draw the line between serving a player and steering them.

### Mathur, Mayer and Kshirsagar (2021)

Arunesh Mathur, Jonathan Mayer and Mihir Kshirsagar, [“What Makes a Dark Pattern... Dark? Design Attributes, Normative Considerations, and Measurement Methods”](https://arxiv.org/abs/2101.04843) (*CHI*, 2021). They argue that dark patterns share a small set of attributes and propose perspectives for judging them. It informed the checks we run on the director.

### Melhart et al. (2023)

David Melhart, Julian Togelius, Benedikte Mikkelsen, Christoffer Holmgård and Georgios Yannakakis, [“The Ethics of AI in Games”](https://arxiv.org/abs/2305.07392) (arXiv, 2023). It frames the ethics of sensing and adapting to a player's emotions, including the trade-off between privacy and safe spaces. It informed why the engine never infers feelings or health.

### Dietvorst, Simmons and Massey (2015, 2018)

Berkeley Dietvorst, Joseph Simmons and Cade Massey, [“Algorithm aversion: People erroneously avoid algorithms after seeing them err”](https://repository.upenn.edu/fnce_papers/58) (*Journal of Experimental Psychology: General*, 2015), and [“Overcoming algorithm aversion: People will use imperfect algorithms if they can (even slightly) modify them”](https://ideas.repec.org/a/inm/ormnsc/v64y2018i3p1155-1170.html) (*Management Science*, 2018). People lose faith in an algorithm after seeing it err, and a little control over its output restores their willingness to use it. It informed why every automatic choice comes with a control.

### Eslami et al. (2015)

Motahhare Eslami, Aimee Rickman, Kristen Vaccaro, Amirhossein Aleyasen, Andy Vuong, Karrie Karahalios, Kevin Hamilton and Christian Sandvig, [“'I always assumed that I wasn't really that close to [her]': Reasoning about invisible algorithms in the news feed”](https://www.ideals.illinois.edu/items/55412) (*CHI*, 2015). Most of 40 users did not know their feed was curated, reacted with surprise and anger on finding out, and later felt more in control. It informed why adaptation should be easy to discover.

### Rader, Cotter and Cho (2018)

Emilee Rader, Kelley Cotter and Janghee Cho, [“Explanations as Mechanisms for Supporting Algorithmic Transparency”](https://pure.psu.edu/en/publications/explanations-as-mechanisms-for-supporting-algorithmic-transparenc/) (*CHI Extended Abstracts*, 2018). Explanations raised awareness and helped people judge bias and control, but helped less with judging whether the output was correct. It informed how far a one-line reason can be expected to build trust.

### Kulesza et al. (2013)

Todd Kulesza, Simone Stumpf, Margaret Burnett, Sherry Yang, Irwin Kwan and Weng-Keen Wong, [“Too much, too little, or just right? Ways explanations impact end users' mental models”](https://openaccess.city.ac.uk/id/eprint/6344) (*VL/HCC*, 2013). Complete explanations helped people's mental models more than sound ones, but very unsound explanations cost trust. It informed our rule to say less than the model holds and to show the evidence for each line.

### Ur et al. (2012)

Blase Ur, Pedro Giovanni Leon, Lorrie Faith Cranor, Richard Shay and Yang Wang, [“Smart, Useful, Scary, Creepy: Perceptions of Online Behavioral Advertising”](https://fpf.org/wp-content/uploads/2021/05/Smart-Useful-Scary-Creepy.-Perceptions-of-Online-Behavioral-Advertising-.pdf) (*SOUPS*, 2012). In 48 interviews, people called targeting useful and invasive at once, and assumed more was collected than was. It informed how we treat personalisation as something that can unsettle people even when it helps.

### White et al. (2008)

Tiffany Barnett White, Debra Zahay, Helge Thorbjørnsen and Sharon Shavitt, [“Getting too personal: Reactance to highly personalized email solicitations”](https://link.springer.com/article/10.1007/s11002-007-9027-9) (*Marketing Letters*, 2008). Highly personalised offers that did not explain why they fitted drew resistance, less so where the service seemed useful. It informed why a personalised offer must be able to say why it was made.

### Nguyen et al. (2014)

Tien Nguyen, Pik-Mai Hui, F. Maxwell Harper, Loren Terveen and Joseph Konstan, [“Exploring the filter bubble: the effect of using recommender systems on content diversity”](https://experts.umn.edu/en/publications/exploring-the-filter-bubble-the-effect-of-using-recommender-syste/) (*WWW*, 2014). Recommenders slightly narrowed what people saw over time, and less so for people who took what was recommended. It informed our concern that the engine's own offers can narrow what a player is shown.

### Chaney, Stewart and Engelhardt (2018)

Allison Chaney, Brandon Stewart and Barbara Engelhardt, [“How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility”](https://arxiv.org/abs/1710.11214) (*RecSys*, 2018). Simulations showed that training on data the system itself influenced made behaviour more uniform without making it more useful. It informed counting responses against the offers actually shown, not against acceptances alone.

### Kirchner-Krath et al. (2024)

Jeanine Kirchner-Krath, Maximilian Altmeyer, Linda Schürmann, Bastian Kordyaka, Benedikt Morschheuser, Ana Carolina Tomé Klock, Lennart Nacke, Juho Hamari and Harald von Korflesch, [“Uncovering the theoretical basis of user types”](https://fis.uni-bamberg.de/handle/uniba/115001) (*International Journal of Human-Computer Studies*, 2024). A survey of 877 people found four popular player typologies overlap heavily and reduce to five continuous dimensions. It informed our choice to model observed rates, not player types.

### Hamari and Tuunanen (2014)

Juho Hamari and Janne Tuunanen, [“Player Types: A Meta-synthesis”](https://todigra.org/index.php/todigra/article/view/1697) (*Transactions of the Digital Games Research Association*, 2014). Earlier player typologies synthesise into seven dimensions. It informed how loosely we hold any categorisation of players.

### Wachter and Mittelstadt (2019)

Sandra Wachter and Brent Mittelstadt, [“A Right to Reasonable Inferences: Re-Thinking Data Protection Law in the Age of Big Data and AI”](https://ora.ox.ac.uk/objects/uuid:d53f7b6a-981c-4f87-91bc-743067d10167) (*Columbia Business Law Review*, 2019). They show that inferences about people are weakly protected and propose that they be justified in advance and open to challenge. It informed treating what the engine infers as data the player can see and delete.

### Nair et al. (2023)

Vivek Nair, Wenbo Guo, Justus Mattern, Rui Wang, James O'Brien, Louis Rosenberg and Dawn Song, [“Unique Identification of 50,000+ Virtual Reality Users from Head & Hand Motion Data”](https://usenix.org/conference/usenixsecurity23/presentation/nair-identification) (*USENIX Security*, 2023). About 94 per cent of users were identified from 100 seconds of motion. It informed treating play data as personal even when it stays on the machine.

### Raney (2004)

Arthur Raney, [“Expanding disposition theory: Reconsidering character liking, moral evaluations, and enjoyment”](https://researchconnect.buffalo.edu/en/publications/expanding-disposition-theory-reconsidering-character-liking-moral/) (*Communication Theory*, 2004). Liking for a character can form before any moral judgement, and viewers work to protect it. It informed how we read a player's stance toward a character from what they do.

### Hartmann, Toz and Brandon (2010)

Tilo Hartmann, Erik Toz and Marvin Brandon, [“Just a game? Unjustified virtual violence produces guilt in empathetic players”](https://research.vu.nl/en/publications/6d94c7ce-66fe-4c78-a0ac-7a94a4c37d14) (*Media Psychology*, 2010). Two experiments found guilt after unjustified virtual violence, stronger in more empathetic players. It informed why the engine offers a way back after a harmful act and never tells the player how they feel.

### Weaver and Lewis (2012)

Andrew Weaver and Nicky Lewis, [“Mirrored morality: An exploration of moral choice in video games”](https://journals.sagepub.com/doi/10.1089/cyber.2012.0235) (*Cyberpsychology, Behavior, and Social Networking*, 2012). In the first act of a commercial role-playing game, most of 75 players made moral choices that tracked a moral-foundations questionnaire. It informed how seriously we take a player's treatment of characters as people.

### Tarulli and Caplinger (2013)

Laurel Tarulli and Victoria Caplinger, [“In the Eye of the Beholder: Readers' Advisory from a Cataloging Perspective”](https://journals.ala.org/index.php/rusq/article/view/2892/2959) (*RUSQ*, 2013). It describes how libraries match readers to books by appeal factors and by Nancy Pearl's four doorways (story, character, setting, language), not by category. It informed matching offers on their features, not on genre.

### Conway, Cowan and Bunting (2001)

Andrew Conway, Nelson Cowan and Michael Bunting, [“The cocktail party phenomenon revisited: The importance of working memory capacity”](https://memory.psych.missouri.edu/assets/doc/articles/2001/conway-et-al-pbr-2001.pdf) (*Psychonomic Bulletin & Review*, 2001). About a third of listeners notice their own name in a message they were told to ignore, and they are more often the ones with less working-memory capacity. It informed how reliably a player will notice something aimed at them while attending to something else.

### Kidd, Piantadosi and Aslin (2012)

Celeste Kidd, Steven Piantadosi and Richard Aslin, [“The Goldilocks Effect: Human Infants Allocate Attention to Visual Sequences That Are Neither Too Simple Nor Too Complex”](https://pmc.ncbi.nlm.nih.gov/articles/PMC3359326) (*PLoS ONE*, 2012). Infants looked away least from events of middling complexity, and most from the very predictable and the very surprising. The effect was small and its link to learning was not tested. It informed how we think about pitching a new cue between boring and baffling.

### Strayer, Drews and Johnston (2003)

David Strayer, Frank Drews and William Johnston, [“Cell phone-induced failures of visual attention during simulated driving”](https://pubmed.ncbi.nlm.nih.gov/12710835/) (*Journal of Experimental Psychology: Applied*, 2003). A phone conversation slowed drivers' reactions to a braking car and weakened their memory for roadside signs. It informed why a player who is busy may not take in something in plain view.

### Drew, Võ and Wolfe (2013)

Trafton Drew, Melissa Võ and Jeremy Wolfe, [“The invisible gorilla strikes again: Sustained inattentional blindness in expert observers”](https://pmc.ncbi.nlm.nih.gov/articles/PMC3964612/) (*Psychological Science*, 2013). Twenty of 24 radiologists missed a gorilla added to a lung scan, and eye tracking showed that most of those who missed it had looked straight at it. It informed why we do not treat "on screen" as "seen".

### Alaybek and colleagues (2022)

Balca Alaybek, Reeshad Dalal and six co-authors, [“All's well that ends (and peaks) well? A meta-analysis of the peak-end rule and duration neglect”](https://ideas.repec.org/a/eee/jobhdp/v170y2022ics0749597822000334.html) (*Organizational Behavior and Human Decision Processes*, 2022). Looking back, people rate an experience by its most intense moment and its end, and its length counts for almost nothing. It informed how we weigh a session's high point and ending over its running time.

### Brysbaert (2019)

Marc Brysbaert, [“How many words do we read per minute? A review and meta-analysis of reading rate”](https://doi.org/10.1016/j.jml.2019.104047) (*Journal of Memory and Language*, 2019). Adults read about 238 words a minute for silent non-fiction and 260 for fiction, lower than the 300 often quoted. It informed how much text we budget for a player to read.

### Rankin and colleagues (2009)

Catharine Rankin and thirteen co-authors, [“Habituation revisited: An updated and revised description of the behavioral characteristics of habituation”](https://pmc.ncbi.nlm.nih.gov/articles/PMC2754195/) (*Neurobiology of Learning and Memory*, 2009). A fading response is specific to the repeated stimulus, returns after a rest, can be restored by a different stimulus, and fades faster the next time. It informed how we think about a cue that loses its force with repetition.

### Cepeda and colleagues (2006, 2008)

Nicholas Cepeda, Harold Pashler, Edward Vul, John Wixted and Doug Rohrer, [“Distributed practice in verbal recall tasks: A review and quantitative synthesis”](https://pubmed.ncbi.nlm.nih.gov/16719566/) (*Psychological Bulletin*, 2006), and Cepeda, Vul, Rohrer, Wixted and Pashler, [“Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention”](https://www.evullab.org/pdf/CepedaVulRohrerWixtedPashler-PS-2008.pdf) (*Psychological Science*, 2008). The best gap between two exposures grows with the delay before the test. It informed why we space the hints of a coming payoff rather than bunching them.

### Fazio, Brashier, Payne and Marsh (2015)

Lisa Fazio, Nadia Brashier, B. Keith Payne and Elizabeth Marsh, [“Knowledge does not protect against illusory truth”](https://scholars.duke.edu/publication/1090926) (*Journal of Experimental Psychology: General*, 2015). Repeated statements are judged truer, even by people who know better. It informed how repetition can make a false claim in a story feel believed.

### Lewandowsky and colleagues (2012)

Stephan Lewandowsky, Ullrich Ecker, Colleen Seifert, Norbert Schwarz and John Cook, [“Misinformation and its correction: Continued influence and successful debiasing”](https://research.monash.edu/en/publications/misinformation-and-its-correction-continued-influence-and-success/) (*Psychological Science in the Public Interest*, 2012). A correction rarely removes a claim someone has believed, and works better when it offers a replacement account. It informed how we handle a character's mistaken belief once the truth comes out.

### Leavitt and Christenfeld (2011)

Jonathan Leavitt and Nicholas Christenfeld, [“Story spoilers don't spoil stories”](https://www.psychologicalscience.org/news/releases/spoiler-alert-stories-are-not-spoiled-byspoilers.html) (*Psychological Science*, 2011). In short stories, readers preferred versions with a spoiler paragraph in front. Later studies found the opposite or no effect, so we treat it as weak evidence. It informed how far announcing a threat can weaken its pull.

### Sperber and colleagues (2010)

Dan Sperber, Fabrice Clément, Christophe Heintz, Olivier Mascaro, Hugo Mercier, Gloria Origgi and Deirdre Wilson, [“Epistemic vigilance”](https://research.ceu.edu/en/publications/epistemic-vigilance/) (*Mind & Language*, 2010). People are on guard against being misinformed and weigh a source by cues to its competence and good faith. It informed why a visible track record makes a source more believable.

### Short and colleagues (2008)

M. B. Short, M. R. D'Orsogna, V. B. Pasour, G. E. Tita, P. J. Brantingham, A. L. Bertozzi and L. B. Chayes, [“A statistical model of criminal behavior”](https://www.math.ucla.edu/~bertozzi/papers/M3AS-final.pdf) (*Mathematical Models and Methods in Applied Sciences*, 2008). A place's attractiveness to offenders is a fixed part plus a part that jumps at each offence, fades and spreads to neighbours. Hot spots then come in three regimes, and wandering ones appear when events are few. It informed how we let small counts, not movement rules, make hot spots wander.

### Hawkes and Oakes (1974)

Alan Hawkes and David Oakes, [“A cluster process representation of a self-exciting process”](https://doi.org/10.2307/3212693) (*Journal of Applied Probability*, 1974). A self-exciting process can be read as immigrants and their descendants. It informed how we generate city events with each event's parent recorded.

### Mohler and colleagues (2011)

Mohler, Short, Brantingham, Schoenberg and Tita, [“Self-exciting point process modeling of crime”](https://doi.org/10.1198/jasa.2011.ap09546) (*Journal of the American Statistical Association*, 2011). Burglary in Los Angeles fits a steady background plus a self-exciting part, and the authors note that gang violence clusters in a similar way. It informed how we separate a place's steady propensity from the aftershocks of recent events.

### Weisburd (2015)

David Weisburd, [“The law of crime concentration and the criminology of place”](https://doi.org/10.1111/1745-9125.12070) (*Criminology*, 2015). Across cities, about half of crime falls on a few percent of street segments. It informed how concentrated we make the city's incidents.

### Weisburd, Bushway, Lum and Yang (2004)

David Weisburd, Shawn Bushway, Cynthia Lum and Sue-Ming Yang, [“Trajectories of crime at places: a longitudinal study of street segments in the city of Seattle”](https://www.ojp.gov/ncjrs/virtual-library/abstracts/trajectories-crime-places-longitudinal-study-street-segments-city) (*Criminology*, 2004). Over fourteen years most street segments kept their rank. It informed why we build concentration as a stable property of each place.

### Chalfin, Kaplan and Cuellar (2020)

Aaron Chalfin, Jacob Kaplan and Maria Cuellar, [“Re-examining the law of crime concentration: between and within-city evidence”](https://crim.sas.upenn.edu/node/1935) (working paper). Concentration is real but weaker than reported, and partly a counting effect of how many crimes there are. It informed why we test our hot spots against a chance baseline.

### Johnson and colleagues (2007)

Johnson, Bernasco, Bowers, Elffers, Ratcliffe, Rengert and Townsley, [“Space-time patterns of risk: a cross national assessment of residential burglary victimization”](https://research-repository.griffith.edu.au/items/8ddc0a48-c032-5b7f-9ab6-071c62c881b1) (*Journal of Quantitative Criminology*, 2007). In ten areas in five countries, homes near a burgled home faced raised risk for at least two weeks, with the pattern differing by place. It informed the reach and duration we give an event's effect on nearby places.

### Ratcliffe and Rengert (2008)

Jerry Ratcliffe and George Rengert, [“Near-repeat patterns in Philadelphia shootings”](https://doi.org/10.1057/palgrave.sj.8350068) (*Security Journal*, 2008), and Ratcliffe's [near-repeat analysis page](https://www.jerryratcliffe.net/near-repeat-analysis). Shootings raise the risk of another within about two weeks and one block, and the pattern appears across many crime types. It informed how we model the echo of an event in space and time.

### Guerette and Bowers (2009)

Rob Guerette and Kate Bowers, [“Assessing the extent of crime displacement and diffusion of benefits: a review of situational crime prevention evaluations”](https://doi.org/10.1111/j.1745-9125.2009.00177.x) (*Criminology*, 2009). Across 102 evaluations, displacement was the exception and benefits spreading to nearby places was as common. It informed the odds we give for what happens next door when a place is cleared.

### Braga and colleagues (2019)

Anthony Braga, Brandon Turchan, Andrew Papachristos and David Hureau, [“Hot spots policing of small geographic areas effects on crime”](https://doi.org/10.1002/cl2.1046) (*Campbell Systematic Reviews*, 2019). Policing hot spots gives a small reduction in crime, with little displacement and some spread of benefit. It informed how large we let suppression effects be.

### Green, Horel and Papachristos (2017)

Ben Green, Thibaut Horel and Andrew Papachristos, [“Modeling contagion through social networks to explain and predict gunshot violence in Chicago, 2006 to 2014”](https://isps.yale.edu/research/publications/isps17-02) (*JAMA Internal Medicine*, 2017). Much gun violence follows the social ties between people, with a long lag between linked events. It informed why we let grievance travel along group and kin ties as well as along streets.

### Park, Schoenberg, Bertozzi and Brantingham (2021)

Junhyung Park, Frederic Paik Schoenberg, Andrea Bertozzi and P. Jeffrey Brantingham, [“Investigating clustering and violence interruption in gang-related violent crime data using spatial-temporal point processes with covariates”](https://ideas.repec.org/a/taf/jnlasa/v116y2021i536p1674-1687.html) (*Journal of the American Statistical Association*, 2021). Retaliation after gang violence can be measured, and an interruption programme was linked to 14 to 18 per cent less of it. It informed how we let retaliation between two groups be reduced but not removed.

### Bernasco and Nieuwbeerta (2005)

Wim Bernasco and Paul Nieuwbeerta, [“How do residential burglars select target areas? A new approach to the analysis of criminal location choice”](https://doi.org/10.1093/bjc/azh070) (*British Journal of Criminology*, 2005). Burglars in The Hague favoured areas near their homes. It informed why offenders in our city act close to their own ground.

### Ensign and colleagues (2017)

Danielle Ensign, Sorelle Friedler, Scott Neville, Carlos Scheidegger and Suresh Venkatasubramanian, [“Runaway feedback loops in predictive policing”](https://arxiv.org/abs/1706.09847) (2017). A system that learns from the crimes it finds can send police back to the same neighbourhoods whatever the true rate. It informed why we keep occurrence apart from report, and bound police attention.

### Lum and Isaac (2016)

Kristian Lum and William Isaac, [“To predict and serve?”](https://hrdag.org/publications/to-predict-and-serve/) (*Significance*, 2016). Predictive policing tools learn the patterns in police records, which are not the same as the patterns in crime. It informed the same separation of what happens from what is reported.

### Sankin and Mattu (2023)

Aaron Sankin and Surya Mattu, [“Predictive policing software terrible at predicting crimes”](https://themarkup.org/prediction-bias/2023/10/02/predictive-policing-software-terrible-at-predicting-crimes) (The Markup, with WIRED, 2023). Of 23,631 predictions made for one New Jersey police department, fewer than one in two hundred matched a later reported crime. It informed why we never present a hot spot as a forecast.

### Song and colleagues (2010)

Chaoming Song, Zehui Qu, Nicholas Blumm and Albert-László Barabási, [“Limits of predictability in human mobility”](https://pubmed.ncbi.nlm.nih.gov/20167789/) (*Science*, 2010). From phone records, an individual's movements are highly predictable in principle, and little affected by distance. It informed why we treat a person's missing a routine visit as an event worth recording.

### Simini and colleagues (2012)

Filippo Simini, Marta González, Amos Maritan and Albert-László Barabási, [“A universal model for mobility and migration patterns”](https://arxiv.org/abs/1111.0586) (*Nature*, 2012). Flows between places can be predicted from the populations alone, with no fitted parameters. It informed how we plan the coarse flow of people between districts.

### Lloyd-Smith and colleagues (2005)

J. O. Lloyd-Smith, S. J. Schreiber, P. E. Kopp and W. M. Getz, [“Superspreading and the effect of individual variation on disease emergence”](https://pubmed.ncbi.nlm.nih.gov/16292310/) (*Nature*, 2005). The number of people one case infects is highly skewed, so a few cases cause most onward spread. It informed why most of our events leave nothing behind and a few leave a cluster.

### Epstein (2002)

Joshua Epstein, [“Modeling civil violence: an agent-based computational approach”](https://pmc.ncbi.nlm.nih.gov/articles/PMC128592) (*Proceedings of the National Academy of Sciences*, 2002). Rebellion follows grievance weighed against perceived arrest risk, which falls as more people join, giving bursts and a tipping effect when policing is reduced. It informed how we model unrest as a district tipping process.

### Duan and Ganesh (2021)

Y. Duan and A. Ganesh, [“The proportion of the population never hearing a rumour”](https://arxiv.org/abs/2002.06821) (*Queueing Systems*, 2021). It restates the classic result that, in the Maki-Thompson rumour model, about a fifth of a large population never hears the rumour, and extends the analysis. It informed the reach we expect a rumour to have in a district.

### Centola, Willer and Macy (2005)

Damon Centola, Robb Willer and Michael Macy, [“The emperor's dilemma: a computational model of self-enforcing norms”](https://ndg.asc.upenn.edu/wp-content/uploads/2016/04/Centola-et-al-2005-AJS.pdf) (*American Journal of Sociology*, 2005). In their model, a norm that most people privately oppose could not take hold in a fully connected network. It could emerge and spread where people see only their neighbours, and more believers or more long-range ties made that less likely, not more. It informed the conditions under which we let an unpopular local norm hold in a district.

### Liben-Nowell and colleagues (2005)

David Liben-Nowell, Jasmine Novak, Ravi Kumar, Prabhakar Raghavan and Andrew Tomkins, [“Geographic routing in social networks”](https://pmc.ncbi.nlm.nih.gov/articles/PMC1187977) (*Proceedings of the National Academy of Sciences*, 2005). In a large blogging community, the chance that two people were friends fell with the number of people living closer to them, not with raw distance. About a third of friendships had nothing to do with geography. It informed how we weight nearness when we generate who knows whom.

### Jøsang and Ismail (2002)

Audun Jøsang and Roslan Ismail, [“The Beta Reputation System”](https://mn.uio.no/ifi/english/people/aca/josang/publications/ji2002-bled.pdf) (Bled Electronic Commerce Conference, 2002). It builds a reputation from counts of good and bad feedback, gives less weight to feedback from poorly regarded raters, and lets old feedback fade at an adjustable rate. It informed how we keep a running reputation from counted evidence.

### Leeson (2007)

Peter T. Leeson, [“An-arrgh-chy: the law and economics of pirate organization”](https://www.mercatus.org/hayekprogram/research/journal-articles/arrgh-chy-law-and-economics-pirate-organization) (*Journal of Political Economy*, 2007). Pirate crews had no courts, yet they limited their captains through crew oversight and kept order under a constitution the crew agreed. It informed how we think about order inside a criminal outfit that cannot call on the law.

### Blattman and colleagues (2024)

Christopher Blattman, Gustavo Duncan, Benjamin Lessing and Santiago Tobón, [“Gang rule: understanding and countering criminal governance”](https://www.restud.com/gang-rule-understanding-and-countering-criminal-governance/) (*The Review of Economic Studies*, 2024). In Medellín, gangs on blocks closer to state security forces came to govern more over time, mostly where drug profits were highest. State presence and gang rule can therefore reinforce each other. It informed how we treat policing and local gang order as linked, not as opposites.

### Magaloni, Franco-Vivanco and Melo (2020)

Beatriz Magaloni, Edgar Franco-Vivanco and Vanessa Melo, [“Killing in the slums: social order, criminal governance, and police violence in Rio de Janeiro”](https://ideas.repec.org/a/cup/apsrev/v114y2020i2p552-572_17.html) (*American Political Science Review*, 2020). Criminal regimes differ in whether they confront or collude with the state, abuse or cooperate with residents, and hold territory alone or contested. Police crackdowns had different results under each. It informed the kinds of criminal order we vary between districts.

### Lessing and Denyer Willis (2019)

Benjamin Lessing and Graham Denyer Willis, [“Legitimacy in criminal governance: managing a drug empire from behind bars”](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/S0003055418000928) (*American Political Science Review*, 2019). A Brazilian prison gang kept detailed records and punished mostly without violence, building a legitimacy that made mild sanctions effective. It informed how we make criminal sanctions procedural and usually mild.

### Skarbek (2011)

David Skarbek, [“Governance and prison gangs”](https://ideas.repec.org/a/cup/apsrev/v105y2011i04p702-716_00.html) (*American Political Science Review*, 2011). A prison gang with leverage over street dealers had a reason to provide institutions that enforce deals and settle disputes among those it taxed. It informed why a criminal outfit that takes a cut has a reason to keep order.

### Calderón and colleagues (2015)

Gabriela Calderón, Gustavo Robles, Alberto Díaz-Cayeros and Beatriz Magaloni, [“The beheading of criminal organizations and the dynamics of violence in Mexico”](https://doi.org/10.1177/0022002715587053) (*Journal of Conflict Resolution*, 2015). Arresting or killing cartel leaders raised both cartel-related violence and killings of the wider population. The cartel-related rise came mostly in the first six months, and the rise in general homicide lasted longer. It informed how we treat the removal of a boss as a source of lasting disorder.

### Kirk and Papachristos (2011)

David S. Kirk and Andrew V. Papachristos, [“The structural and cultural dynamics of neighborhood violence”](https://ojp.gov/ncjrs/virtual-library/abstracts/structural-and-cultural-dynamics-neighborhood-violence) (National Institute of Justice report, 2011), published in journal form as “Cultural mechanisms and the persistence of neighborhood violence” (*American Journal of Sociology*, 2011). Legal cynicism, a view that the law is illegitimate and unresponsive, affected violence in the short and long term and weakened a neighbourhood's collective efficacy. Tolerant attitudes to violence mattered little. It informed how we let distrust of the law persist in a district.

### Edwards and Ogilvie (2008)

Jeremy Edwards and Sheilagh Ogilvie, [“Contract enforcement, institutions and social capital: the Maghribi traders reappraised”](https://web.stanford.edu/~avner/Greif_Papers/2008_Edwards&Ogilvie_The_Maghribi_Traders_Reappraised_CESifo_2254.pdf) (CESifo working paper, 2008). They dispute Avner Greif's account of medieval Maghribi traders as a closed coalition enforcing contracts by reputation alone, noting that the traders also used formal courts and worked with outsiders. Greif's own paper is “Contract enforceability and economic institutions in early trade: the Maghribi traders' coalition” (*American Economic Review*, 1993). Together they taught us that a reputation mechanism can enforce agency without courts, and that the evidence for it is contested.

### Gambetta (2009)

Diego Gambetta, [*Codes of the Underworld: How Criminals Communicate*](https://press.princeton.edu/books/paperback/9780691152479/codes-of-the-underworld) (Princeton University Press, 2009). Criminals cannot advertise or rely on courts, so they lean on signals that are hard to fake, such as tattoos, nicknames and shared costly acts. It informed the kinds of trust signals we let characters in the underworld read.

### Burt (2004)

Ronald S. Burt, [“Structural holes and good ideas”](https://www.journals.uchicago.edu/doi/10.1086/421787) (*American Journal of Sociology*, 2004). In a large company, people whose ties span gaps between otherwise separate circles were more likely to voice ideas, and those ideas were more likely to be judged valuable. They were also better paid and promoted faster. It informed how we reward a go-between who holds ties across separate circles.

### Kossinets and Watts (2006)

Gueorgi Kossinets and Duncan J. Watts, [“Empirical analysis of an evolving social network”](https://doi.org/10.1126/science.1116869) (*Science*, 2006). In a year of university e-mail, new ties formed mostly through shared activities and affiliations, shared attributes and closing short cycles of existing ties. It informed how we choose which acquaintances form over time.

### Hoff, Raftery and Handcock (2002)

Peter D. Hoff, Adrian E. Raftery and Mark S. Handcock, [“Latent space approaches to social network analysis”](https://scholars.duke.edu/publication/1439538) (*Journal of the American Statistical Association*, 2002). The chance of a tie between two people can be modelled as a function of their positions in an unobserved social space. It informed how we generate ties from positions in a shared space.

### Mueller and Axhausen (2011)

Kirill Mueller and Kay W. Axhausen, [“Hierarchical IPF: generating a synthetic population for Switzerland”](https://ideas.repec.org/p/wiw/wiwrsa/ersa11p305.html) (European Regional Science Association conference paper, 2011). Plain iterative proportional fitting cannot match person and household totals at once. Their method fits both levels together. It informed how we plan to build a synthetic population that matches totals for people and for households.

### Stiller and Dunbar (2007)

James Stiller and Robin I. M. Dunbar, [“Perspective-taking and memory capacity predict social network size”](https://irep.ntu.ac.uk/id/eprint/13877) (*Social Networks*, 2007). The size of a person's innermost circle of close friends tracked their skill at reasoning about others' minds, while the size of the wider circle of frequent contacts tracked memory performance. It informed the sizes we allow for different layers of a person's acquaintances.

### Sommerfeld and colleagues (2007)

Ralf D. Sommerfeld, Hans-Jürgen Krambeck, Dirk Semmann and Manfred Milinski, [“Gossip as an alternative for direct observation in games of indirect reciprocity”](https://pmc.ncbi.nlm.nih.gov/articles/PMC2077274) (*Proceedings of the National Academy of Sciences*, 2007). In a lab game, players acted on gossip even when they could see the original behaviour, and they cooperated more after positive gossip than after negative. The authors warn that gossip can be used to manipulate reputations. It informed how strongly we let reported reputation drive behaviour.

### Leimar and Hammerstein (2001)

Olof Leimar and Peter Hammerstein, [“Evolution of cooperation through indirect reciprocity”](https://pmc.ncbi.nlm.nih.gov/articles/PMC1088665) (*Proceedings of the Royal Society B*, 2001). In their model, a strategy based on a partner's good standing usually did better than one based on a running image score. It informed how we judge a person's reputation.

### Feinberg and colleagues (2012)

Matthew Feinberg, Robb Willer, Jennifer Stellar and Dacher Keltner, [“The virtues of gossip: reputational information sharing as prosocial behavior”](https://sociology.stanford.edu/publications/virtues-gossip-reputational-information-sharing-prosocial-behavior) (*Journal of Personality and Social Psychology*, 2012). People who saw an antisocial act wanted to warn others, and warning them eased their distress. Such gossip also discouraged selfish behaviour. It informed why we let people pass on warnings about others.

### Bohnet and Zeckhauser (2004)

Iris Bohnet and Richard Zeckhauser, [“Trust, risk and betrayal”](https://irisbohnet.scholars.harvard.edu/publications/trust-risk-and-betrayal) (*Journal of Economic Behavior & Organization*, 2004). People wanted better odds before trusting a stranger than before taking an equal risk decided by chance. It informed how much more we weigh a betrayal by a person than a loss from bad luck.

### Kuran (1989)

Timur Kuran, [“Sparks and prairie fires: a theory of unanticipated political revolution”](https://link.springer.com/article/10.1007/BF00116762) (*Public Choice*, 1989). People who dislike a regime hide it while opposition looks weak, so a small rise in visible opposition can bring a secure-looking order down quickly. It informed how we model sudden collapse of an order that looked stable.

### Williamson (1983)

Oliver E. Williamson, [“Credible commitments: using hostages to support exchange”](https://ideas.repec.org/a/aea/aecrev/v73y1983i4p519-40.html) (*American Economic Review*, 1983). Parties who fear being cheated can trade more safely when one side holds something it would hurt to lose, a hostage, that is hard to reverse. It informed the guarantees we let characters hold over one another in deals.

### Eisenhardt (1989)

Kathleen M. Eisenhardt, [“Agency theory: an assessment and review”](https://doi.org/10.2307/258191) (*Academy of Management Review*, 1989). Her review of agency theory covers how information systems, uncertainty over outcomes, incentives and risk shape the control of a person acting for another. It informed how we model a principal's controls over an agent.

### Fehr and Gächter (2002)

Ernst Fehr and Simon Gächter, [“Altruistic punishment in humans”](https://www.nature.com/articles/415137a) (*Nature*, 2002). In experiments, cooperation flourished where people could punish defectors at a cost to themselves, and broke down where they could not. It informed why we let some characters enforce a norm at their own expense.

### Axelrod (1986)

Robert Axelrod, [“An evolutionary approach to norms”](https://ideas.repec.org/a/cup/apsrev/v80y1986i04p1095-1111_18.html) (*American Political Science Review*, 1986). His simulations showed the conditions under which norms evolve and stay stable, and that punishing people who fail to punish (a metanorm) can help. It informed how we let enforcement of a norm be itself enforced.

### Fiske, Cuddy and Glick (2007)

Susan T. Fiske, Amy J. C. Cuddy and Peter Glick, [“Universal dimensions of social cognition: warmth and competence”](https://collaborate.princeton.edu/en/publications/universal-dimensions-of-social-cognition-warmth-and-competence/) (*Trends in Cognitive Sciences*, 2007). People judge others on warmth, meaning friendly or hostile intent, and on competence, meaning the ability to act on it. Mixed judgements draw mixed feelings and behaviour. It informed the two dimensions we use to describe how one person is judged by another.

### Wilson (1968)

James Q. Wilson, [*Varieties of Police Behavior: The Management of Law and Order in Eight Communities*](https://www.degruyterbrill.com/document/doi/10.4159/9780674045200/html) (Harvard University Press, 1968). Departments policed in watchman, legalistic or service styles tied to local politics, and the lowest-ranking officer held wide discretion over the vaguest laws. It informed how we vary policing from district to district.

### Tyler (2006)

Tom R. Tyler, [*Why People Obey the Law*](https://www.degruyterbrill.com/document/doi/10.1515/9781400828609/html) (Princeton University Press, 2006 edition). People comply with the law mainly because they see it as legitimate, not because they fear punishment. It informed how much of compliance we tie to perceived legitimacy and how much to fear.

### Kempa, Stenning and Wood (2004)

Michael Kempa, Philip Stenning and Jennifer Wood, [“Policing communal spaces: a reconfiguration of the ‘mass private property’ hypothesis”](https://researchportalplus.anu.edu.au/en/publications/policing-communal-spaces-a-reconfiguration-of-the-mass-private-pr/) (*British Journal of Criminology*, 2004). They extend Clifford Shearing and Stenning's idea that privately owned spaces open to the public bring private security and private order, and argue that it is one case of a wider return of communal space. It informed how we give malls and other private spaces their own order.

### Reuter (1983)

Peter Reuter, [*Disorganized Crime: The Economics of the Visible Hand*](https://ci.nii.ac.jp/ncid/BA00256289?l=en) (MIT Press, 1983). He found the big illegal markets he studied were filled with small, marginal and short-lived firms, because suppressing competition was too costly. It informed how often we let small criminal outfits come and go.

### Palmer (2019)

Lindsay Palmer, [*The Fixers: Local News Workers and the Underground Labor of International Reporting*](https://blog.oup.com/2019/08/the-international-reporting-you-never-see/) (Oxford University Press, 2019). Fixers are local workers who help visiting reporters with language, terrain and hard-to-reach sources. Their work is often risky and goes uncredited. It informed how we write the go-between who arranges work for outsiders.

### Papachristos, Hureau and Braga (2013)

Andrew V. Papachristos, David M. Hureau and Anthony A. Braga, [“The corner and the crew: the influence of geography and social networks on gang violence”](https://doi.org/10.1177/0003122413486800) (*American Sociological Review*, 2013). In Chicago and Boston, gangs with adjacent turf and a history of conflict were likely to fight again, and reciprocity and status seeking added to it. It informed what we use to predict which rivals clash.

## Reference imagery

### Jewellery form and fit references

The Association of Professional Piercers' [jewellery](https://safepiercing.org/wp-content/uploads/2020/05/APP_Initial_Print.pdf) and [procedure](https://safepiercing.org/wp-content/uploads/2020/10/APP_Procedures_2013_A_Web.pdf) brochures, including measurement material by Elayne Angel and photographs credited to Paul King, Neometal and Industrial Strength Body Jewelry, together with product pages from [Anatometal](https://anatometal.com/), [Maria Tash](https://www.mariatash.com/), [Stone and Strand](https://www.stoneandstrand.com/) and [BVLA](https://www.bvla.com/). They taught us gauges, ring sizes, closures and connection patterns for the jewellery design. Viewed as references only; no image or design was copied, and the APP jewellery brochure is licensed CC BY-NC-ND 4.0.

### Nail polish finish references

Product and guide pages from [OPI](https://www.opi.com/collections/shimmer-nail-polish), [ILNP](https://www.ilnp.com/mega-l-100-pure-linear-holographic-nail-polish/), [Holo Taco](https://www.holotaco.com/pages/magnetics), [Ready Ready](https://www.thereadyready.com/blogs/nail-trends/cat-eye-nails-explained), [Beetles](https://www.beetlesgel.com/blogs/guides/chrome-nail-powder) and [Cirque Colors](https://www.cirquecolors.com/blogs/blog/jelly-is-our-jam). They taught us the vocabulary and intended looks of nail finishes (crème, shimmer, glitter, linear and scattered holographic, magnetic cat-eye, chrome powder and jelly) behind the proposed nail finish families. Viewed as references only.

### Duchenne de Boulogne's photographs

Guillaume-Benjamin-Amand Duchenne (de Boulogne), photographs for *Mécanisme de la physionomie humaine* (about 1856–1862), Figures 7, 32, 45, 51 and 54 in the [Cleveland Museum of Art](https://clevelandart.org/art/2018.9)'s open-access collection (CC0), via Wikimedia Commons. His study of the smile is the origin of the Duchenne marker, and these photographs were real-face test inputs for the face-capture prototype. Used locally; not redistributed.

### Hair style references

- [Batik Machida](https://beauty.hotpepper.jp/slnH000137560/style/L000156790.html): Their salon photograph informed the Hair Lab regression reference for a diagonal side-swept fringe merging into long layers. The photograph is retained only as a private reference and is not distributed.
- [Bamboo salon](https://ameblo.jp/momiji1013/entry-12385330289.html): Their rear-view bob photograph informed the shoulder-level tip line and inward-turning ends in the Hair Lab regression set. The photograph is a private visual reference, not a shipped asset.
- [Jean & Jacqueline](https://jean-jacqueline-friseur.de/blog/simplie-haarverlaengerung-kassel): Their high-ponytail photograph shows scalp lengths gathered into a rear tie and a free tail. It informed the structural regression case; the photograph is retained privately.
- [Visavis Friseur](https://visavis-friseur.de/damen/sidecut/): Their sidecut reference shows a distinct density boundary with the crown swept toward the long side. It informed the undercut regression case; no photograph is distributed.

## Community members we are still identifying

- A Discord community member who suggested shimmer as a makeup finish.
- A modder who recommended ArchiveXL dynamic expansion, which set the direction of our export design.
- The photographers and makeup artists behind the glitter makeup photographs, and the designers and photographers behind the earring photographs, that we used as visual references.

If you recognise your contribution here or anywhere in this project, please let us know so we can credit you properly.
