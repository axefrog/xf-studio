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
7. [Research papers](#research-papers)
8. [Reference imagery](#reference-imagery)
9. [Community members we are still identifying](#community-members-we-are-still-identifying)

## Game developer

### CD PROJEKT RED

Developer of Cyberpunk 2077. The game's own resources, shaders, rigs, animation and materials are the ground truth for nearly everything we study. Their article [A World Full of Substance](https://magazine.substance3d.com/cyberpunk-2077-a-world-full-of-substance/) explained the shared-surface and mask approach behind the game's materials, and their [modding support](https://www.cyberpunk.net/en/modding-support) and [technical support](https://support.cdprojektred.com/en/cyberpunk/pc) pages, which name the Steam, GOG and Epic Games Store editions, set the stores XF Studio looks for. The TweakDB sources that ship with the game's REDmod tools showed how photo mode's expressions, poses and lists are defined. Game content is used only as a private local reference for the preview and experiments; none is redistributed.

## Frameworks and core mods

### ArchiveXL

By psiberx and contributors. [GitHub](https://github.com/psiberx/cp2077-archive-xl). ArchiveXL's source taught us how character-creator options are registered, how appearance templates are cloned and how dynamic material paths expand. That understanding is the foundation of XF Studio's single-selector preset export, which avoids generating a separate material for every combination, and its archive-group, `.xl` discovery, scope, fix, patch, copy/link and dynamic-mesh rules are what XF Studio's character resolver replicates to interpret installed mods the way the game does. Its player-eye fix, which copies the eye morph resource without its base texture, showed us that a morph resource can override a material's normal map. Its localization extension showed how mods' texts join the game's, which XF Studio follows to label mod-added character-creator options. Its animation extension, which merges animation sets into a named component of an entity or scope, and its photo-mode scopes informed the expression export (whose resource patch adds its own animation component, because ArchiveXL merges a patch's components by name and id) and are the basis of XF Studio's pose catalogue, which finds the pose sets mods append to the photo-mode puppet the way it does. Its garment extension taught us how worn items pick their look (dynamic appearance names, conditions, and path substitution with body, feet, arm and sleeve states; its arm state, read from the drawn weapon's cyberware type, pointed us to the TweakDB records that choose V's arm-cyberware holster state), how visual tags hide other items and mask parts of the body, and that it sets garment offsets aside unless an outfit mod turns them on; its chunk-mask rules and factory index are what XF Studio's clothing render replicates to show a save's clothes and what they hide. Its component-prefix rule, by which `hide_Head` hides the head's decals with the head, set how XF Eye Artistry names its makeup component. Its ink-spawner and journal extensions showed how a mod attaches its own script controller to a spawned widget and merges new web pages, contacts and messages into the game's journal. Its world-streaming extension taught us how location mods stay additive: extra streaming blocks appended to the world, vanilla nodes hidden or moved in memory as each sector loads behind node-count and type checks, device and persistent-state patches, and quest phases injected into the game's quests. It is an intended runtime dependency; no ArchiveXL code is included in XF Studio.

### Audioware

Published under the cyb3rpsych0s1s account, per the documentation link on its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/12001). Its scripts showed how a mod shows its own subtitle or overhead chatter line: build the game's dialog-line struct in script, post it to the UI blackboard and hide it by id after its duration. That is the basis of the text-only barks planned for NPC reactions. Its scene-dialogue guide explained how new lines borrow existing lip-sync clips, that the game stops a clip when the line's `.wem` ends (hence its silent `.wem` files) and that line lengths live in a report file ArchiveXL can't merge, which frames the lip-sync export design. Studied only.

### Codeware and TweakXL

By psiberx and contributors. [Codeware](https://github.com/psiberx/cp2077-codeware), [TweakXL](https://github.com/psiberx/cp2077-tweak-xl). Their release notes and compatibility statements helped us choose stable framework versions for runtime testing. Their source, and psiberx's shared plugin framework within it, taught us how a well-built RED4ext plugin is structured, logs and ships its scripts, how to declare natives for redscript, and how TweakXL loads and types YAML tweaks, which shaped the XF Runtime Bridge; its TweakXL data marker is an optional runtime use. Codeware's quest-system access let the bridge run the game's own photo-mode quest node, which showed that this route opens only a restricted photo mode; its imports of photo-mode events pointed to the photo-mode cursor and camera. Codeware is an optional runtime use. The shared framework's function-call code confirmed that some functions scripts call as static need a context, which is how the bridge now calls the game. Codeware's attachment-slot data showed how a script can list what each slot shows, the basis of the planned worn-clothing snapshot. TweakXL's YAML reader (file priority markers, the last of which the bridge's camera presets now use to load after other mods' presets, `$base`, `$instances` templates, conditions, array operations and inline icon records) is what XF Studio's tweak reader follows to find the icons mods declare for their character-creator choices and the photo-mode poses they add, and its changeset shows the order in which list operations apply; later the items mods add. Its script-built widgets, popups, resource and raw-input callbacks and menu-resource imports showed how terminal pages and games can be written without ink resources. Its dynamic and static entity systems, world-state toggles and sector node access showed how a runtime bridge could spawn preview objects and hide world nodes in game. Its service and entity persistence showed which mod state lives in saves and which in a file beside the plugin. No code is copied.

### Cyber Engine Tweaks

By yamashi and contributors. [GitHub](https://github.com/maximegmd/CyberEngineTweaks). Its source showed us exactly what a Lua mod can do: its events, its sandbox (including that it has no networking), its logging and how Lua reaches game and plugin functions. That is why the XF Runtime Bridge keeps its external link in a native plugin and uses CET only for reporting and an on-screen status. Its function-call code showed how native code must call game and script functions (a caller frame with a stand-in caller and a context that is never empty), which explained the bridge's first in-game crash; the bridge's own calls follow that recipe, reimplemented rather than copied (CET is MIT-licensed). CET is a runtime dependency of the bridge's Lua layer. Its property code showed that a Lua write to a field a game class doesn't have stays on the Lua side, which is why an older creator mod's settings may not reach the game on 2.31. Its resource-list loader showed how the game's own Oodle decompressor is called, which XF Studio's archive reader does from the user's game folder. Its game-options interface is how the bridge's Lua layer reads the engine's hidden character render options for a settings record. Its per-mod database showed that Lua mods keep their state outside saves. Its game-options code also showed that a float written to an engine option reaches the engine unchanged, which ruled out one explanation of the old photo-mode gaze freeze. Its binding store, which keeps each mod's hotkeys under the mod's folder name and drops them once the folder is gone, and its separate context for each mod shaped how XF Photo Mode is proposed to succeed Photo Mode Tools without losing players' keys.

### RED4ext and RED4ext SDK

By wopss and contributors. [RED4ext](https://github.com/wopss/RED4ext), [RED4ext SDK](https://github.com/wopss/RED4ext.SDK). RED4ext's releases set our framework baseline, and the SDK's resource-depot declarations clarified which parts of archive lookup order the game leaves unspecified. Its character-customization type declarations showed that the creator tracks an active flag per option. A dump of the game's scripting type information, exported for us by psiberx with his fork of wopss's RED4.RTTIDumper, named the puppet-preview controller and camera classes that led us to the character creator's scene and camera. The loader's source and the SDK's examples taught us the plugin contract, game-state callbacks, per-plugin logging and native function registration behind the XF Runtime Bridge, which is built against the SDK (MIT) and needs RED4ext at runtime. The SDK's resource-path declaration documents the path clean-up behind the game's resource hashes, which XF Studio's archive reader follows. Its generated layouts of the hair-profile resource and its gradient entries let us find the game's hair-profile bake in the executable. The SDK's reconstruction of how the engine runs native functions, together with the function names in the address library RED4ext ships, let us pin the bridge's first in-game crash to a missing call context. Its hand-written layouts of loaded animation buffers and their key frames, rigs, animation sets and the animation controller's IK and look-at controllers, with its generated animation-node types, mapped the routes by which the Studio could pose V live in game, and its resource loader declarations let the XF Runtime Bridge find a loaded animation set by its path to check that experiment's carrier clip. The loader's plugin discovery and script-path rules are the basis of the proposed XF Core plugin host. Its generated dangle layouts showed the simulation's fields and the external acceleration input one vanilla hairstyle wires, and let us name the fields the solver's code reads in the executable.

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

By Patrick Mours (crosire) and contributors. [GitHub](https://github.com/crosire/reshade). Its add-on API and examples showed how to capture frames before post-processing effects, read depth and toggle effects without touching a user's preset, which is the basis of an optional lossless-capture design for in-game tests. Studied only (BSD-3-Clause); nothing is built on it yet.

### Vortex

By Black Tree Gaming Ltd. (Nexus Mods) and contributors. [GitHub](https://github.com/Nexus-Mods/Vortex). Vortex's source showed us how it stages mods, deploys the winning files into the game folder, records each deployment in a manifest and keeps each mod's Nexus Mods ids in its state, which is how XF Studio tells which Vortex mod put a file in the game folder and how a problem report says where a Vortex-installed mod came from. Studied only; XF Studio reads Vortex's files but includes no Vortex code, and our Vortex tests run in a disposable Windows Sandbox.

### WolvenKit

By the WolvenKit team and contributors. [GitHub](https://github.com/WolvenKit/WolvenKit). WolvenKit is the backbone of our export pipeline: we use its CLI to extract, convert, serialize and pack resources, including extracting the head that XF Studio's built-in eye plate is cut from and exporting each user's own head, eyes, resolved materials and textures for the 3D preview, and its source taught us the game's save, archive, mesh, morph target, animation and compiled appearance formats, plus the material type definitions and shader-cache layout, and its multilayer-mask exporter showed how the mask atlas and tile tables decode. Its animation importer showed that facial float tracks and additive clip types survive a glTF round trip, which the expression export plan relies on, and its compressed animation buffer reader and writer showed the key layout and rotation encoding that the XF Runtime Bridge's live-pose carrier and its in-game layout check follow. Its wardrobe and script-system save parsers showed where a save keeps V's clothing and how a save's object packages are laid out, which XF Studio's loadout reader follows, and its list of known resource paths located the game's cooked table of item visual tags. Its type definitions named the fields, class defaults and enumerations of the game's dangle simulation, and the lip-sync map, scene actor and dialogue-line fields that tie a spoken line to its facial clip. Its streaming-sector, node-data and instance-transform readers showed how the world's sectors store their nodes and placements. Its TweakDB reader showed the compiled TweakDB layout XF Studio reads for the character creator's categories and swatch icons. Its save writer, node writer and chunk compression showed how a save's chunks, node table and footer are rebuilt, the basis of XF Studio's save write-back design. Its save parsers for inventory, facts and the world's hash-keyed persistency data, and how it keeps unknown classes and nodes, shaped XF Studio's save editor study. Its archive and package writers also informed XF Studio's pre-pack path checks, and its CLI output is the reference XF Studio's native archive reader is checked against, byte for byte and document for document, and its PNG texture exports the reference for XF Studio's native texture decoder, texel for texel; its rig and animation-graph serialization was the reference XF Studio's reader of the body's deformation rig was checked against, and its morph-target export with the game folder writes the fingertip skin of nails morph mods; its GLB mesh exports, whose conventions its mesh tools document, are the reference for XF Studio's native mesh reader, vertex for vertex; its animation exporter is the reference for XF Studio's native animation decoder, key for key. The same buffer layout lets the expression editor read a clip's float keys to start from any installed expression. Used as an external tool (GPL-3.0): XF Studio downloads the official WolvenKit CLI release only when a user agrees, and neither includes nor redistributes any WolvenKit code or binaries.

## Libraries, runtimes and general tools

### Apple ARKit face tracking

By Apple. [Blend shape documentation](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation). Its 52 named facial blend shapes, which MediaPipe and many face tools share, are the vocabulary our face-capture prototype maps onto V's face controls. Only the names and their descriptions were used.

### Blender

By the Blender Foundation and contributors. [blender.org](https://www.blender.org/). Blender powers our offline mesh work, eye-plate clearance studies and diagnostic renders; its BVH ray-casting API made it possible to tell visible intersections from hidden ones. Its status bar, which shows what the mouse and held modifier keys do in the current context, is the model for the Studio's viewport input hints. Its workspaces, saved sets of editors and layout switched from header tabs, are the model for the Studio's planned named workspaces over combinable modules.

### Bun

By the Bun contributors. [GitHub](https://github.com/oven-sh/bun). Bun runs XF Studio's local service, its SQLite library and our test suites, and hosts the desktop shell's main process. Used as a runtime dependency.

### Capstone

By Nguyen Anh Quynh and contributors. [Website](https://www.capstone-engine.org), [GitHub](https://github.com/capstone-engine/capstone). Disassembling the game's executable with it showed where the hair lighting options get their default values and which shader constants they feed, and how the game bakes hair-colour profiles. Used as a research tool only; BSD-3-Clause-licensed.

### CSS Easing Functions

By the W3C CSS Working Group. [Specification](https://www.w3.org/TR/css-easing-1/). Its cubic Bézier timing function, two control points between (0, 0) and (1, 1) with x kept within 0–1, is the model of XF Studio's easing catalogue, which the animated expression transitions and the planned timeline editor share.

### dxil-spirv

By Hans-Kristian Arntzen. [GitHub](https://github.com/HansKristian-Work/dxil-spirv). Translating the game's DXIL shader programs to SPIR-V made structured, decompiled listings of them possible in our shader research. Used as a research tool only; MIT-licensed.

### Easing Functions Cheat Sheet (easings.net)

By Andrey Sitnik and contributors. [Website](https://easings.net), [GitHub](https://github.com/ai/easings.net). Its cubic Bézier forms of the cubic easings are the control points of XF Studio's Strong ease in-out and Strong ease out curves.

### Electrobun and Hutch

By Blackboard Technologies Inc. and contributors. [Electrobun](https://github.com/blackboardsh/electrobun), [Hutch](https://github.com/blackboardsh/hutch). Electrobun's documentation shaped XF Studio's desktop packaging, update, shutdown and uninstall design, and it is the framework for our desktop packaging trial. Electrobun is MIT-licensed and its notice must accompany any distributed build, together with the notices of its bundled dependencies.

### glTF 2.0 Specification

By the Khronos Group. [Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html). XF Studio's native mesh reader writes the preview's GLB files to it, and its rule that an accessor holds at least one element is why the reader leaves a chunk without vertices or triangles to WolvenKit.

### ICT-FaceKit

By the USC Institute for Creative Technologies. [GitHub](https://github.com/ICT-VGL/ICT-FaceKit). Surveyed as an open (MIT) face model whose expression shapes follow the ARKit names split by side; it confirmed that convention for our blendshape mapping. Nothing from it is used.

### Inno Setup

By Jordan Russell and Martijn Laan. [Website](https://jrsoftware.org/isinfo.php), [source](https://github.com/jrsoftware/issrc). XF Studio's downloadable Windows setup is one Inno Setup program that carries Electrobun's setup and runs it. The setup runtime it redistributes is under the Inno Setup License, whose notice ships with the app's third-party notices.

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

By Microsoft. The DirectX shader compiler and [DXIL reference](https://github.com/microsoft/DirectXShaderCompiler/blob/main/docs/DXIL.rst) let us read the game's compiled shaders, the [Xbox store listing](https://www.xbox.com/en-us/games/store/cyberpunk-2077/bx3m8l83bbrw) and [Xbox Wire](https://news.xbox.com/en-us/2026/03/03/xbox-game-pass-march-2026-wave-1/) showed that Cyberpunk 2077 has no Xbox app edition for Windows, and the [WebView2 debugging documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code) enabled automated testing of the packaged desktop window. WebView2 is a platform dependency of the desktop app; its [distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) shaped the one-click install, and the installer includes Microsoft's unmodified Evergreen WebView2 bootstrapper, packaged as that guidance allows.

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

### SPIRV-Cross

By the Khronos Group and SPIRV-Cross contributors. [GitHub](https://github.com/KhronosGroup/SPIRV-Cross). It turns SPIR-V translations of the game's shader programs back into readable HLSL or GLSL for our shader research. Used as a research tool only; Apache-2.0-licensed.

### SQLite

By the SQLite project. [sqlite.org](https://sqlite.org/). SQLite stores XF Studio's local library of immutable look and collection versions.

### Three.js

By mrdoob and the three.js authors. [GitHub](https://github.com/mrdoob/three.js). Three.js renders the studio's entire browser preview: skinned head, materials, camera controls, ray casting and the glitter studies. One isolated glitter study adapts its physical-lighting shader structure, so that code carries the Three.js MIT notice, which must also accompany any distributed build. Its multiple-views examples (one renderer drawing several cameras into scissored regions of one canvas) framed how the planned view graph shares one GPU context across views.

### WebKit

By Apple and the WebKit contributors. [GitHub](https://github.com/WebKit/WebKit). Its `UnitBezier` solver, Newton's method for the curve parameter with bisection where it stalls, is the method XF Studio's easing curves use to evaluate a cubic Bézier at a point in time; reimplemented, no code copied.

### wgpu

By the gfx-rs/wgpu contributors. [GitHub](https://github.com/gfx-rs/wgpu). Its documentation framed our assessment of native versus browser rendering backends and the current state of ray-tracing support.

## Documentation and community knowledge

### Cyberpunk 2077 Modding Wiki

By manavortex and the wiki's contributor community. [Wiki](https://wiki.redmodding.org/cyberpunk-2077-modding), [source](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs). Special thanks to manavortex, who wrote much of the wiki and keeps it available to modders. Its file-format page, with its archive-format tables, described the container XF Studio's archive reader decodes. Its guides and screenshots taught us the character resource chain, character-creator hair, eye and switcher setups (including the switcher guides' note that an option's index sets its place in the creator) (including the eye guide's note that eye albedo is sampled upside down while normal maps are not flipped, and its in-game image showing the iris drawn the same way up as the rest of the eye), material families and skin-shader parameters, decals and load order. We are particularly grateful to the guide authors and editors lumad11 (the CCXL eyebrows guide), icxrus, redacted-c01, nutboy, Mx_OrcBoi (custom facial piercings with PRC) and minnierylands (load-order guide), saltypigloaf (facial-rig guide), Rebecca (whose multilayered clear-coat page demonstrated the view-angle coat tint), manavortex's multilayered guide and property pages, and the multilayered colour-blending guide, whose in-game grid of microblend contrast against mask levels showed that a low contrast sharpens a layer's mask rather than softening it, nullfractal (whose LUT guides explained that the game grades through 3D LUTs fed with ARRI LogC3 values), and to the CyberCAT documentation for pointing us to external preset files and for its warning that the editor's appearance tab has been disabled since 2.0, which shaped how cautiously XF Studio plans to write creator values into saves, and for its version table and its warnings that edited quest facts can break a save for good, which set the save editor study's safety rules. chromoxolon's custom voice-line guide showed how a `.wem` joins a scene line through a voice-over map registered with ArchiveXL. The save-file page added by darkcart described the save's header, chunk table and node table. The CCXL eye-texture guide by nutboy and another author, edited by icxrus, showed how mods make creator icons: an `.inkatlas` generated from PNGs and one `UIIcon` record per choice declared through a TweakXL template. For facial expressions and photo mode, manavortex's facial-expression, photo-mode and pose guides, Simarilius's facial-animation page (based on research by Loomy and John CO), the AMM expression table by Maximilium, Pinkydude and Vitum, the pose-pack update pages by nutboy and Zwei Valerie, LadyLea's update of the pose-making guide (whose process and templates came from xbaebsae and Angy) and Akiway's lipsync guide showed how photo mode, AMM and scenes use facial clips (that guide also explained per-language lip-sync maps, clip names derived from each line's id, and that WolvenKit copies existing lip sync rather than generating it) and how the community registers poses; the guide on removing foot-snap IK from poses showed how the game plants a pose's feet and when creators turn it off, which shapes the pose editor's grounding choice. For the body, manavortex's body cheat sheet showed which meshes make V's body and its seam covers, and the suffix page's feet table which feet a V without shoes stands on. For arm cyberware, icxrus's switcher page, which ties each arm group to an equipped arm cyberware, and manavortex's arms cheat sheet, which maps each cyberware state to its entities and meshes, framed how the holster state is chosen. For clothing, manavortex's item-structure, suffix, dynamic-variant, tag and body-mod pages, LadyLea's tag diagrams of the body and head, the garment-support page (which credits psiberx and Auska, among others), revenantFun's guide to painting garment support and FronkenZeepa's first-person fixes showed how worn items resolve, layer and hide the body. For tattoos, LadyLea's texture-framework page and its vanilla and framework UV layout images (with AllKnowingLion's section on the UV framework and its account of Halvkyrie's Unique Arms), Yggnire's overlay-tattoo guide, YoursTrulyBilly's merging pages, Halk's replacer guide and the CCXL body-tattoo and additions pages, with their table of community tattoo rows, showed the three ways a tattoo reaches V: a skin overlay, a replaced texture or a creator addition. For hair physics, eagul's dangle-bone guides (how a mesh's swinging chains pair with a `.rig` and an `.animgraph`, the leverage effect, and collision shapes that make a moved chain explode), PinkyJulien's guide to transferring dangle bones and the documented-components page showed how the game's hair and jewellery physics is set up and how creators transplant a donor's physics. For the world, the streaming-sector and streaming-block pages (Sergey's block and variant page, based on psiberx's input, and mana vortex's sector pages), psiberx's collected notes on node references, Simarilius's node-type reference and Blender sector import, the removal guides by mana vortex and justarandomguyintheinternet, Sergey's community-registry guide, Kaoziun's sector-variant project, Akiway's embedded-collision page, Deceptious's occlusion notes collected by mana vortex, and the World Builder guides explained how Night City is streamed and how location mods add to it.

### Electrobun Windows installer notes

By alxrepin ([aiusagebar pull request 16](https://github.com/alxrepin/aiusagebar/pull/16)) and djalmajr ([pinar pull request 32](https://github.com/djalmajr/pinar/pull/32)). Their pull requests recorded that Electrobun's Windows setup program only runs beside its hidden `.installer` folder, and aiusagebar showed wrapping it in an Inno Setup program so users download one file, the approach XF Studio's single-file setup takes.

## Mods and creators whose work we studied

These mods were studied from local installations. Where the private preview displays one of their assets, it is a local reference only and is never packaged or redistributed; each mod's own terms continue to apply.

### Alliekat

[Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787) and [Eyeshadow Remix Pt. 1](https://www.nexusmods.com/cyberpunk2077/mods/15451). Natural Hair Tones supplies the saved character's brow colour gradient; comparing it with the base game's version taught us that an installed override need not change the visible colour. Its replacements of the shared hair colour profiles showed how one profile colours both V and every NPC wearing that colour, and how a replacement that keeps the base game's stop positions changes where the light and dark parts of a strand fall. Its mapping of several vivid colour names onto one natural gradient showed why the Character panel's swatches must come from the files that win, not from a colour's name or icon. Eyeshadow Remix is another in-place replacement of the base game's eye-makeup masks. Private local reference only.

### anruimurasaki

[High Ponytail Hair - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/25085). Its ponytail mesh showed that a working CCXL hairstyle can list fewer chunk materials than it has render chunks, keeping stub chunks for its lower levels of detail, and that a mesh whose render data lists fewer bone positions than it has bones can ship in a working mod although WolvenKit won't export it; the preview now exports such meshes from a repaired copy. Its two dangle components, one per part, are an example of the vanilla way CCXL hair declares physics. Private local reference only.

### Appearance Menu Mod

By MaximiliumM and contributors. [GitHub](https://github.com/MaximiliumM/appearancemenumod). Its Lua source showed how a mod sets time and weather, teleports, spawns a fixed camera, poses V and hides the HUD at runtime. Those techniques fill much of the capability matrix for agent-driven in-game tests. Its expression code showed a second facial route beside photo mode: resetting an NPC's reactions and applying a facial-reaction feature that selects one of the game's emotion idles. Its observer on the photo-mode setup is how we learned to catch the photo-mode puppet from Lua. Its cursor override showed how to hide the photo-mode mouse cursor for clean captures, and its controllable lights, saved locations, NPC spawning through Codeware and friendly, immortal actors showed how a test session could light V, stand her in a fixed spot and keep a scene calm. Its decor presets and shareable location packs showed how players already save and exchange placed props and places. Its custom-pose collab files, small Lua tables naming a workspot entity and clips per body, showed the pose route that exists only inside AMM. Its look-at requests with weighted head and chest parts showed how a script can aim a character's eyes, head and chest, one of the channels the pose editor's live posing can use. Its gaze freeze through the global look-at option is one of the two routes the photo-mode snapshot design compares. Studied only.

### Arkhe

[Beautiful EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168), [Beautiful EYEBROWS 2K Material Edit](https://www.nexusmods.com/cyberpunk2077/mods/18783), [Universal Skin Tone](https://www.nexusmods.com/cyberpunk2077/mods/15426), [Realistic Complexion III](https://www.nexusmods.com/cyberpunk2077/mods/19314) and [Character Rendering Editor](https://www.nexusmods.com/cyberpunk2077/mods/32842). The eyebrow mod taught us how ArchiveXL copy/patch declarations assemble complete resources from vanilla geometry, and how the game combines two alpha maps with a colour gradient for brows; it also showed that brow styles merge into the base game's brow row rather than adding a selector, and its own texture mips, which darken the strands as they shrink, showed that a brow's colour swatch must read the texture at close-up detail. The Material Edit showed the other route, replacing the base game's brow material and textures in place, which changes every NPC's brows too. The skin mods provided alternative skin maps for render-fidelity comparisons and showed how a complexion replacer works: same-path head textures plus replaced global skin resources, including the default skin profile the preview's skin lighting now reads. The Character Rendering Editor's list of hair, skin and eye rendering options with their vanilla values gave the preview's hair light its default tuning and names the runtime skin and rim-light options a capture must record. Private local reference only.

### Atomiic

[Smokey Diva Hair - Serena - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/29065), whose creator rows read "Atomiic - Serena Smokey Hair". Its fourth part mesh carries earrings and a hair pin on the engine's plain metal template, which showed that a hairstyle's own accessories are ordinary drawing components of its appearance and led the preview to draw that template. Studied only.

### Browser Extension

By r457 and gh057, per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/10038). Its small redscript framework showed how a mod adds a site to the in-game browser without replacing anything: a listener registers an address and icon for one browser, supplies its own page widget for that address, and joins a paginated home page that also lists every journal site. That is the basis of the terminal-content research. Studied only.

### Character Customization Anywhere

By keanuWheeze, per the support link on its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/3930). Its small Lua script showed how to open the character creator from anywhere, by opening the pause menu and redirecting it to the mirror's menu scenario, which the XF Runtime Bridge now does the same way in its own script, and led us to how the creator's Confirm and Back buttons finalise or discard a look. That it opens the creator in V's apartment, where the game reports a staged-gameplay scene tier, is why the XF Runtime Bridge accepts that tier when it opens the creator. Studied only.

### CharLi – Character Lighting Suite for Photomode

By FreakaZ (+FlowerD), per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/8176). It showed how to build a light rig from spawned light entities that follows V or the photo-mode puppet, set each light's colour, intensity, range and cone, aim a ring of lights at V and clean it up again. That loop is the basis of the planned scripted light sweep and of the XF Runtime Bridge's lighting mirror, which places a Studio lighting setup about V in photo mode; its teleporting of lights about the puppet is how the bridge now tries placing photo mode's own lights about V. Studied only.

### CyanideX

[LUT Switcher 2](https://www.nexusmods.com/cyberpunk2077/mods/16310) and [ENV Tuner](https://www.nexusmods.com/cyberpunk2077/mods/23079) (per its script namespace). Studying LUT Switcher's installed package showed that runtime LUT mods apply grading as player effects that can switch off in menus, which the character-creator capture protocol now controls for. ENV Tuner showed that the environment's exposure curves can be rewritten in memory as their resources load and restored afterwards, the technique the lighting mirror's research exposure pin would use. Private local reference only.

### eagul

[PRC — Fully Modular Jewellery Framework](https://www.nexusmods.com/cyberpunk2077/mods/8590), [New Piercings Collection Vol. 1](https://www.nexusmods.com/cyberpunk2077/mods/8611) and [PRC Vanilla Piercing Mirrors](https://www.nexusmods.com/cyberpunk2077/mods/10236); the framework also credits Auska for morph-target import and manavortex for modding help. PRC showed a working route to morph-compatible modular jewellery and informs our future jewellery design; working out why it works in game (file replacement alone) is what let the preview draw it, and any similar framework, through its generic resolver. [Multicolored Hair](https://www.nexusmods.com/cyberpunk2077/mods/21613), its compatibility patch and its modder's resources showed how multicoloured hair works in game: a hairstyle cut into up to three parts, each with its own creator colour row under one new switcher, which set how XF hair colours should reach split hairstyles. Private local reference only; the PRC pages require the author's permission for reuse or modification, and Multicolored Hair's reuse terms have not been checked.

### Even More Brows for Cyberpunk

[Even More Brows for Cyberpunk - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/26230). Its 16 styles ship complete brow geometry of their own inside ArchiveXL's brow scope, which confirmed that a brow style can join the base game's brow row with every hair colour without copying the base game's files. Studied only; its author is still being confirmed.

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

### Jack Humbert

[Let There Be Flight](https://github.com/jackhumbert/let_there_be_flight) and [Mod Settings](https://github.com/jackhumbert/mod_settings). Their RED4ext plugins showed how to ship redscript through the plugin itself and declare its natives, and Let There Be Flight's player-attach wrapper is the pattern our bridge's redscript layer follows. Mod Settings' menu-scenario extensions showed that a mod can add its own event to the game's menu scenarios, which is how the bridge asks the idle menu to open the character creator. Studied only.

### Kala

[Kala's Eyes Standalone V2](https://www.nexusmods.com/cyberpunk2077/mods/3242), whose source eye texture is credited to Sarah Cartwright. Supplies the saved character's eye textures in the preview. Private local reference only; the page's credit, noncommercial and game-use conditions apply.

### KnowSo team

[-KS- UV Texture Framework](https://www.nexusmods.com/cyberpunk2077/mods/3783), crediting original authors Zosoab70 and AllKnowingLion and named contributors. Its skin template and seam-fix resources showed why each file's effective load-order winner must be resolved before changing preview materials, and its head-mesh appearance patch showed that an ArchiveXL patch can change the effective head material chain. Its player-only skin chain, which sets a tattoo overlay as the skin's secondary albedo with a glow mask and overlay normals, showed how overlay tattoo mods work and why only one can be active. Its arm meshes, whose UVs place both arms in the full-body texture, showed that a replaced mesh must be exported from the mod's own copy, never the base game's. Studied only; its asset-reuse conditions would need separate review.

### KOZMETIX

[KOZMETIX](https://www.nexusmods.com/cyberpunk2077/mods/29018), by meluminary per its title. It showed makeup worn as a clothing item with no geometry of its own: it patches its shades into the base game's makeup meshes, aliases their morph targets and hides the base game's lipstick while worn. Studied only.

### Kwek EquipmentEx earrings

An inventory-worn earring mod that provided a packaging precedent for our jewellery construction-set design. Its [Small Fancy Hoop Earrings with Physics](https://www.nexusmods.com/cyberpunk2077/mods/7020) showed how a worn item makes earrings swing: a small dangle rig and simulation of its own, driven by V's skeleton, with the mesh itself left bound to that skeleton. Studied only; its individual authorship is still being confirmed.

### Lime Makeup Atelier and Anrui's Netrunner Emporium

[Lime Makeup Atelier](https://www.nexusmods.com/cyberpunk2077/mods/18322) sells worn makeup items through a Virtual Atelier in-game shop, a distribution route for makeup that is not part of the character creator. With [Anrui's Netrunner Emporium](https://www.nexusmods.com/cyberpunk2077/mods/12328) it showed that a store mod needs only one registration call listing its items, and an icon. Studied only; their authors are still being confirmed.

### Limerence

[Limerence X AllieKat Winterkissed AXL Eyeshadows](https://www.nexusmods.com/cyberpunk2077/mods/18323) and [Limerence Liners](https://www.nexusmods.com/cyberpunk2077/mods/14780). Winterkissed is a collaboration with AllieKat per its title and description. Its eyeshadow mesh and morph target reuse the base game's eye-makeup geometry unchanged, which confirmed that working face-decal mods sit at the vanilla 0.40 mm offset above the head. Its glitter looks showed how a published glitter eyeshadow is built from the plain decal material (high-resolution metallic maps with embossed shape normals on the vanilla eye-makeup UVs), and led us to the eye plate's much lower texture density. The Liners replace the base game's eye-makeup masks in place, which showed how such replacers conflict per slot. Studied only; private local reference.

### MELUMINARY

[MELUMINARY Long Length Pak Vol. 3 #011](https://www.nexusmods.com/cyberpunk2077/mods/27125). Supplies the saved character's hair geometry for the optional hair preview, and its maps taught us to check whether an apparently missing texture is genuinely constant. Its physics reuses the base game's long-hair dangle rig and simulation for both parts, which showed that modded hair physics is often a vanilla set transplanted whole. Private local reference only; its creator credits and permissions are still being confirmed.

### MisterChedda

[Responsive NPCs](https://www.nexusmods.com/cyberpunk2077/mods/14800) and [Responsive V](https://www.nexusmods.com/cyberpunk2077/mods/22694), per the creator link on both Nexus pages. Responsive NPCs showed how far the game's reaction manager can be bent from script: reactions to V's clothing, a naked or broke V, gang vehicles and the current district, read through NPC archetype visual tags and affiliations. Responsive V showed that a voiceset scene can be patched as it loads, the route we plan for voiced reactions. Studied only.

### Nail mods

[Unique Nails For V - A Framework](https://www.nexusmods.com/cyberpunk2077/mods/10420), [North Oak Nail Spa - Pedicures and Nails](https://www.nexusmods.com/cyberpunk2077/mods/24993), [NC Nails - Pedicure for V](https://www.nexusmods.com/cyberpunk2077/mods/7084) and [Cute Nails - Base Game Nails Morph](https://www.nexusmods.com/cyberpunk2077/mods/21113). Together they showed the ways mods change V's nails: replacing the nail meshes with per-hand materials, patching new appearances into every nail mesh with ArchiveXL, adding wearable nails that hide V's own, and reshaping the nails with a morph. That shaped the proposed Nail Salon export. Studied only; their individual authors are still being confirmed.

### Nola Dreamer

Nola Dreamer's hair Sofie, per its title, one of the creator's "Physics enabled" CCXL hair packs ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/21844)). Its five parts, each with its own dangle rig and simulation driven by V's helper-joint rig, showed the second way CCXL hair declares physics, and its tuned and transplanted parts side by side showed how far creators adjust the game's physics values. Studied only; private local reference.

### NoraLee

[Morphtarget and AnimRig Additions](https://www.nexusmods.com/cyberpunk2077/mods/4673). Its alternative teeth resources reinforced the need to resolve each file's effective winner. Studied only; the page prohibits reuploads of the framework.

### nutboy

[Unique Eyes to CCXL](https://www.nexusmods.com/cyberpunk2077/mods/23263), which itself credits psiberx, icxrus, halvkyrie and another creator (redacted-c01). It resolves the saved character's eye choice and gave us a concrete case for reading character-creator option catalogues. Their CCXL hair-profiles guide on the modding wiki walks through the shared template that every hair-colour pack we studied follows, including why each colour needs a tag for hair under hats. Studied only; the page requires permission for asset reuse or modification.

### Photo-mode pose and tool mods

[Photo Mode Pose Selector](https://www.nexusmods.com/cyberpunk2077/mods/32633) and [Photo Mode Preferences](https://www.nexusmods.com/cyberpunk2077/mods/32736) (both by cjsu, per their Nexus descriptions), [Photo Mode Unlocker XL](https://www.nexusmods.com/cyberpunk2077/mods/4319) (SilverEzredes, per its tweak file), [Portrait Enhancer for Photo Mode](https://www.nexusmods.com/cyberpunk2077/mods/8237), [Customisable Photo Mode UI](https://www.nexusmods.com/cyberpunk2077/mods/32815), [Ziva Photoshoot Posepack](https://www.nexusmods.com/cyberpunk2077/mods/8463) (EzioMaverick, per its tweak file), [Action Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/8698), [Dancy - Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/18007), [Serene - Female Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/24430), [Venus pose pack](https://www.nexusmods.com/cyberpunk2077/mods/26081) (juztNea, per its pose file) and [Multi Pose Pack Framework](https://www.nexusmods.com/cyberpunk2077/mods/4098). Together they showed how poses reach photo mode (animation sets added to the photo-mode entities or scopes, plus pose and category records), how the menu's lists can be widened, and which menu attributes select V's and NPCs' expressions, which a future in-game test can drive directly. Photo Mode Pose Selector's small redscript system, which records the photo-mode V puppet when photo mode sets it up, showed us how to find that puppet from the CET console. Photo Mode Preferences and Photo Mode Pose Selector showed which menu attribute numbers drive the camera, V's placement, lights and expressions and how to set them through the menu's own items, which the XF Runtime Bridge's photo-mode commands use; Photo Mode Preferences also showed that settings re-applied as photo mode opens can race other changes, and that a light must be selected and given a moment before its values are set. Photo Mode Unlocker XL's tweaks showed the photo-mode camera limits and first-person restriction lists, which told us the bridge's restricted photo mode came from somewhere else; Portrait Enhancer showed that the camera presets are plain records, a route to repeatable framing, and its rolled portrait presets explained a sideways camera in our third test session, which is why the bridge's own presets now load last and the bridge levels the camera after selecting one; Customisable Photo Mode UI mapped the photo-mode menu's widget tree. Photo Mode Pose Selector's saved character positions (each character captured by switching the menu's selection and waiting for fresh values), its freeze of one character through time dilation, and its re-applied look-at after a reset shaped the photo-mode snapshot design's capture, restore order and gaze freeze. Photo Mode Pose Selector's searchable lists, starred favourites, arrow-key stepping and per-character freeze shaped the Studio's pose panel design, and its note that a browser across categories needs an index beyond the menu's own list is what the Studio's offline pose catalogue provides. Serene's records showed the everyday pose-pack shape (literal pose and category names, `!append-once` onto the pose lists, reuse on NPC lists), juztNea's 10,000 steps pose pack (per its tweak file) showed a category record naming itself in `categoryName`, the shape the bridge's live-pose test package follows, Venus pose pack showed the separate AMM-only pose list that photo mode never sees, and Multi Pose Pack Framework's replaced photo-mode entities showed the older route of empty numbered animation-set slots. Studied only.

### Physics earrings

[Claire's Jewellery with physics](https://www.nexusmods.com/cyberpunk2077/mods/12863) makes a worn earring swing by reusing the base game's own earring rig and simulation from an NPC's jewellery, which showed that vanilla dangle sets carry over to V unchanged. Studied only; its author is still being confirmed.

### psiberx

[Photo Mode Ex](https://github.com/psiberx/cp2077-photomode-ex), [Equipment-EX](https://github.com/psiberx/cp2077-equipment-ex), [Cyberware-EX](https://github.com/psiberx/cp2077-cyberware-ex), [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) and [CET Kit](https://github.com/psiberx/cp2077-cet-kit). Their source taught us how photo mode works internally, how scriptable systems and wrapped methods are written, how script logging is captured, and how to detect sessions and photo mode from Lua. Photo Mode Ex's native attribute calls, character layout and per-character pitch and roll showed why photo mode's own save slots miss its rows and how a snapshot can read them. Photo Mode Ex and Equipment-EX also confirmed photo-mode attribute numbers the bridge uses, and Photo Mode Ex showed that depth of field can persist into saves, which the bridge's session scripts avoid. Equipment-EX's source also showed how its outfits persist in saves, which extra outfit slots it adds with their layer offsets, and how it takes over the wardrobe. Photo Mode Ex's native hooks showed which parts of the photo-mode system scripts cannot reach, how extra photo-mode characters are registered from records, and how an option list and its label are rebuilt. Red Hot Tools' source showed how archives can be hot-reloaded into a running game, which the expression editor design proposes for previewing an authored expression in game, and that resources already held by the game keep their old data until they are requested again, which shapes the pose editor's hot-reload fallback, and its world inspector showed how a streamed node maps back to its sector and placement index and how the world can be streamed around any point. psiberx also exported the scripting RTTI dump we use to check native function names offline, to know each resource class's properties in XF Studio's archive reader, and to name the engine's enums and types inside saves. Equipment-EX's saved outfits were the test case showing that a script mod's save data decodes from the save's own type information. Studied only.

### SEDTH

[Sandevistan CCXL Tattoo](https://www.nexusmods.com/cyberpunk2077/mods/20345) and [Photon Spine Cyberware](https://www.nexusmods.com/cyberpunk2077/mods/26973), by SEDTH per their file names. Sandevistan showed a tattoo added as its own character-creator row, with a head and a body decal fitted to each supported body and one choice per body, writing colour, relief, roughness and metalness; Photon Spine showed an overlay tattoo that also ships a glow mask and overlay normals. Studied only.

### Street Sense

[Street Sense](https://www.nexusmods.com/cyberpunk2077/mods/28989), part of the DigitalVixen mod suite per its Nexus description. Its clothing-driven crowd reactions (revealing, positive, intimidating, fear and annoyed outfits, each with a distance, chance, voice trigger and facial reaction) are a worked example of the rule-based assessment layer we plan, and its note that ArchiveXL dynamic items can lose TweakXL tags explained why it keeps a list of mod items. Studied only.

### Tattoo overlay mods

Sun Moon And Stars Tattoo, Serpentine Heart and its Remix, Graceful Tattoo, Brooke Candy Inspired Tattoo Overlay, Floral Themed Tattoo Overlay, Deej's Mandala Geometry (by Deej per its title, with a KSUV conversion its description credits to MeltingAngels) and Bedellia's Bad Girl and Geometric overlays (by Bedellia per their titles). Together they showed that overlay tattoo mods each replace the texture framework's one overlay file, sometimes with the skin's roughness map for glossy ink, which is why they cannot be combined without merging images. Studied only; most of their authors are still being confirmed.

### Ultra+

[Ultra+](https://www.nexusmods.com/cyberpunk2077/mods/10490), by the Ultra Team per its licence, with its source at [sammilucia/cyberpunk-ultra-plus](https://github.com/sammilucia/cyberpunk-ultra-plus) per its own metadata. Its configuration showed which engine settings shape V's skin beyond the graphics menu: it sets the subsurface-scattering quality per quality tier and the skin's subsurface specular tint and ambient factors per rendering mode, and it exposes the character subsurface translucency toggle. Knowing this explained an inconclusive in-game skin comparison and made these settings part of every capture record. Studied only; nothing is copied (its licence is proprietary).

### Urmland Street Arcade

[Urmland Street Arcade](https://www.nexusmods.com/cyberpunk2077/mods/23908). Its world resources showed how a small location is added with ArchiveXL: the base game's own arcade, pachinko and vending devices placed in a new streaming block, a devices patch, and a few base-game nodes removed where it stands. Studied only; its author is still being confirmed.

### Virtual Atelier, Virtual Atelier Delivery and Virtual Car Dealer

By DJ_Kovrik (djkovrik), whose [GPL-3.0 repository](https://github.com/djkovrik/CP77Mods) publishes their source. [Virtual Atelier](https://www.nexusmods.com/cyberpunk2077/mods/2987) showed how other mods plug stores into one framework through a registration event, how it reuses the base game's vendor screen, and how a new tab joins a computer's menu (a technique its code credits to NexusGuy999). Virtual Atelier Delivery showed how a mod sends phone messages by rewriting pre-authored journal messages from script, spawns its own devices with new interactions, and adds billboards through TweakXL records; Virtual Car Dealer showed a browser page with its own controller and prices set when the tweak database loads. Studied only.

### Voiced quest mods

[I Really Want To Stay At Your House - Judy](https://www.nexusmods.com/cyberpunk2077/mods/8753), [Lizzie's Braindances](https://www.nexusmods.com/cyberpunk2077/mods/11077) and [Roller Coaster Enhanced](https://www.nexusmods.com/cyberpunk2077/mods/14617) (authors not yet checked). Their packages showed how voiced quest mods give their scenes lip sync today: per-language lip-sync maps registered with ArchiveXL that point at the game's existing clips, with no generated animation. Studied only.

### Watson Tattoo Shops

[Watson Tattoo Shops](https://www.nexusmods.com/cyberpunk2077/mods/23896). Its two shop interiors with a chair that opens character customisation showed how a location mod can make getting a tattoo part of the world. Studied only; its author is still being confirmed.

### World Builder and Removal Editor

By keanuWheeze (GitHub account justarandomguyintheinternet) and contributors, per its source and commit history. [World Builder](https://github.com/justarandomguyintheinternet/CP77_entSpawner) ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/20660)) and its companion [Removal Editor](https://github.com/justarandomguyintheinternet/CP77_removalEditor). World Builder showed how the community builds locations in the running game and turns them into ordinary streaming sectors: one saved group per sector, its export format, how each placeable type maps to a world node, how communities, devices and variants are exported, and how previews are spawned as entities. Its light previews, an empty entity given a light component built from saved data as it assembles, showed how every light field can be set at run time, the route the XF Runtime Bridge's lighting mirror plans. The Removal Editor's deletion files showed that recording each removed node's name, reference, resource and position lets a removal be re-matched after a game update. Studied only; the source carries no open licence and asks for credit or permission before reuse, so only its data formats are described.

### World and location mods

World Objects Removed, Crunch Plaza Expanded, Japantown North Verticality Expanded, Northside Metro and Inside The NCART Station (both by tidusmd, per their script headers), Underground Casino, Apartments Enhanced, The Glen PROJECT, Corpo Rooftop Bar, Ghosts of Night City, Echos of Loss, People of Night City, Eden Plaza penthouse and New Lore Friendly Holographic Ads. Together they are the worked examples for XF Studio's world research: prop-built interiors in new sectors, removals and moved nodes in vanilla sectors, device patches for elevators and doors, a quest phase that runs a casino's doors, NPC scenes placed through AI spots and communities, compatibility builds that delete another mod's nodes, and, by contrast, an in-place texture replacement. Studied only; most of their authors are still being confirmed.

### xBaebsae

[Facial Customisation Rig Fix](https://www.nexusmods.com/cyberpunk2077/mods/7179) and [Photomode Facial Expression Mega Pack](https://www.nexusmods.com/cyberpunk2077/mods/7912), and [Photomode NPCs Extended](https://www.nexusmods.com/cyberpunk2077/mods/18837), whose records showed how any character becomes selectable in photo mode (with Photo Mode Ex), a route to a reference character beside V in tests. The expression pack showed the whole route by which photo mode gains expressions: new expression records, extra rows in the game's expression table, clips attached to the photo-mode face rig, and a face-graph change that lets animated expressions loop. It also showed that the table and graphs are files only one mod can own, which shapes the Studio's export plan. Its patch of the photo-mode face rig and its menu records, which name each face in plain text, showed what an expression mod's files contain, the shape XF Studio's expression export follows. The rig fix's alternative head morph reinforced the need to resolve each file's effective winner, and showed that a head fix can keep the geometry while renaming per-target bone names, which the built-in eye plate now carries over. That fix is also why we read morph targets' own joint binds as active at runtime, which the preview's blink now follows for each eye shape. The Modding Docs' description of V Texture Kit showed a second overlay layout that keeps separate textures for each arm. Studied only.

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

## Reference imagery

### Jewellery form and fit references

The Association of Professional Piercers' [jewellery](https://safepiercing.org/wp-content/uploads/2020/05/APP_Initial_Print.pdf) and [procedure](https://safepiercing.org/wp-content/uploads/2020/10/APP_Procedures_2013_A_Web.pdf) brochures, including measurement material by Elayne Angel and photographs credited to Paul King, Neometal and Industrial Strength Body Jewelry, together with product pages from [Anatometal](https://anatometal.com/), [Maria Tash](https://www.mariatash.com/), [Stone and Strand](https://www.stoneandstrand.com/) and [BVLA](https://www.bvla.com/). They taught us gauges, ring sizes, closures and connection patterns for the jewellery design. Viewed as references only; no image or design was copied, and the APP jewellery brochure is licensed CC BY-NC-ND 4.0.

### Nail polish finish references

Product and guide pages from [OPI](https://www.opi.com/collections/shimmer-nail-polish), [ILNP](https://www.ilnp.com/mega-l-100-pure-linear-holographic-nail-polish/), [Holo Taco](https://www.holotaco.com/pages/magnetics), [Ready Ready](https://www.thereadyready.com/blogs/nail-trends/cat-eye-nails-explained), [Beetles](https://www.beetlesgel.com/blogs/guides/chrome-nail-powder) and [Cirque Colors](https://www.cirquecolors.com/blogs/blog/jelly-is-our-jam). They taught us the vocabulary and intended looks of nail finishes (crème, shimmer, glitter, linear and scattered holographic, magnetic cat-eye, chrome powder and jelly) behind the proposed nail finish families. Viewed as references only.

### Duchenne de Boulogne's photographs

Guillaume-Benjamin-Amand Duchenne (de Boulogne), photographs for *Mécanisme de la physionomie humaine* (about 1856–1862), Figures 7, 32, 45, 51 and 54 in the [Cleveland Museum of Art](https://clevelandart.org/art/2018.9)'s open-access collection (CC0), via Wikimedia Commons. His study of the smile is the origin of the Duchenne marker, and these photographs were real-face test inputs for the face-capture prototype. Used locally; not redistributed.

## Community members we are still identifying

- A Discord community member who suggested shimmer as a makeup finish.
- A modder who recommended ArchiveXL dynamic expansion, which set the direction of our export design.
- The photographers and makeup artists behind the glitter makeup photographs, and the designers and photographers behind the earring photographs, that we used as visual references.

If you recognise your contribution here or anywhere in this project, please let us know so we can credit you properly.
