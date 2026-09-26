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

By psiberx and contributors. [GitHub](https://github.com/psiberx/cp2077-archive-xl). ArchiveXL's source taught us how character-creator options are registered, how appearance templates are cloned and how dynamic material paths expand. That understanding is the foundation of XF Studio's single-selector preset export, which avoids generating a separate material for every combination, and its archive-group, `.xl` discovery, scope, fix, patch, copy/link and dynamic-mesh rules are what XF Studio's character resolver replicates to interpret installed mods the way the game does. Its player-eye fix, which copies the eye morph resource without its base texture, showed us that a morph resource can override a material's normal map. Its localization extension showed how mods' texts join the game's, which XF Studio follows to label mod-added character-creator options. Its animation extension, which merges animation sets into a named component of an entity or scope, and its photo-mode scopes are the basis of the planned expression export. Its garment extension taught us how worn items pick their look (dynamic appearance names, conditions, and path substitution with body, feet, arm and sleeve states), how visual tags hide other items and mask parts of the body, and that it sets garment offsets aside unless an outfit mod turns them on; that is the basis of the planned clothing render. Its ink-spawner and journal extensions showed how a mod attaches its own script controller to a spawned widget and merges new web pages, contacts and messages into the game's journal. Its world-streaming extension taught us how location mods stay additive: extra streaming blocks appended to the world, vanilla nodes hidden or moved in memory as each sector loads behind node-count and type checks, device and persistent-state patches, and quest phases injected into the game's quests. It is an intended runtime dependency; no ArchiveXL code is included in XF Studio.

### Codeware and TweakXL

By psiberx and contributors. [Codeware](https://github.com/psiberx/cp2077-codeware), [TweakXL](https://github.com/psiberx/cp2077-tweak-xl). Their release notes and compatibility statements helped us choose stable framework versions for runtime testing. Their source, and psiberx's shared plugin framework within it, taught us how a well-built RED4ext plugin is structured, logs and ships its scripts, how to declare natives for redscript, and how TweakXL loads and types YAML tweaks, which shaped the XF Runtime Bridge; its TweakXL data marker is an optional runtime use. Codeware's quest-system access let the bridge run the game's own photo-mode quest node, which showed that this route opens only a restricted photo mode; its imports of photo-mode events pointed to the photo-mode cursor and camera. Codeware is an optional runtime use. The shared framework's function-call code confirmed that some functions scripts call as static need a context, which is how the bridge now calls the game. Codeware's attachment-slot data showed how a script can list what each slot shows, the basis of the planned worn-clothing snapshot. Its script-built widgets, popups, resource and raw-input callbacks and menu-resource imports showed how terminal pages and games can be written without ink resources. Its dynamic and static entity systems, world-state toggles and sector node access showed how a runtime bridge could spawn preview objects and hide world nodes in game. No code is copied.

### Cyber Engine Tweaks

By yamashi and contributors. [GitHub](https://github.com/maximegmd/CyberEngineTweaks). Its source showed us exactly what a Lua mod can do: its events, its sandbox (including that it has no networking), its logging and how Lua reaches game and plugin functions. That is why the XF Runtime Bridge keeps its external link in a native plugin and uses CET only for reporting and an on-screen status. Its function-call code showed how native code must call game and script functions (a caller frame with a stand-in caller and a context that is never empty), which explained the bridge's first in-game crash; the bridge's own calls follow that recipe, reimplemented rather than copied (CET is MIT-licensed). CET is a runtime dependency of the bridge's Lua layer. Its property code showed that a Lua write to a field a game class doesn't have stays on the Lua side, which is why an older creator mod's settings may not reach the game on 2.31. Its resource-list loader showed how the game's own Oodle decompressor is called, which XF Studio's archive reader does from the user's game folder.

### RED4ext and RED4ext SDK

By wopss and contributors. [RED4ext](https://github.com/wopss/RED4ext), [RED4ext SDK](https://github.com/wopss/RED4ext.SDK). RED4ext's releases set our framework baseline, and the SDK's resource-depot declarations clarified which parts of archive lookup order the game leaves unspecified. Its character-customization type declarations showed that the creator tracks an active flag per option. A dump of the game's scripting type information, exported for us by psiberx with his fork of wopss's RED4.RTTIDumper, named the puppet-preview controller and camera classes that led us to the character creator's scene and camera. The loader's source and the SDK's examples taught us the plugin contract, game-state callbacks, per-plugin logging and native function registration behind the XF Runtime Bridge, which is built against the SDK (MIT) and needs RED4ext at runtime. The SDK's resource-path declaration documents the path clean-up behind the game's resource hashes, which XF Studio's archive reader follows. The SDK's reconstruction of how the engine runs native functions, together with the function names in the address library RED4ext ships, let us pin the bridge's first in-game crash to a missing call context.

### redscript

By jac3km4 and contributors. [GitHub](https://github.com/jac3km4/redscript). Its releases helped set a stable framework baseline for runtime testing. Its compiler source taught us how modules name classes and globals, how method wrapping resolves and where compilation logs go, and we use its official command-line release (MIT) to type-check the XF Runtime Bridge's scripts offline and to decompile the installed game's scripts for private study, which showed how the character creator lists, orders, labels and colours its options. Its bytecode instruction table gave the opcode numbers the bridge uses when it passes arguments to script functions.

## Modding tools

### Cyberpunk 2077 Support for Vortex

By Ellie Peterson (E1337Kat), Auska, Bladehawke and contributors, published by Nexus Mods. [GitHub](https://github.com/E1337Kat/cyberpunk2077_ext_redux), [Nexus Mods](https://www.nexusmods.com/site/mods/196). Its source taught us how Vortex installs Cyberpunk mods: one installer pipeline for every layout, everything deployed from the game folder, archives left in the game's alphabetical order and a separate REDmod load order. Studied only.

### Cyberpunk Blender Add-on (IO Suite)

By its authors and the RED Modding maintainers. [GitHub](https://github.com/WolvenKit/Cyberpunk-Blender-add-on). Its facial solver turns the game's facial animation controls into real deformation; running it offline gave the studio's preview a working character-creator idle with blinks, gaze and mouth movement, and the game's own blink on V's lids, lashes and brows. Its eye material setup also served as a useful precedent for our preview shaders, and its material import code, originally by HitmanHimself building on Turk645's research with shader notes by Jato and current maintenance by DoctorPresto, showed how community tools read each shader template's parameters and texture channels, including its empirical hair-profile colour handling. Its world-sector importer's light conversion showed which local axis a light shines along, and its multilayered material setup was the community reading we compared with the game's compiled layer program when building the preview's layered materials. Its animation export also showed how facial control curves travel through glTF as float-track keys, the format a future expression export would write. We run the unmodified solver as an external tool (GPL-3.0-or-later); no add-on code is included in XF Studio.

### IGCS Connector

By Frans Bouma (Otis Photomode Mods). [GitHub](https://github.com/FransBouma/IgcsConnector). Its source showed how a ReShade add-on cooperates with game camera tools and captures shots, which we assessed as an optional camera and capture path for agent-driven tests. Studied only.

### Mod Organizer 2

By the ModOrganizer2 contributors; the Cyberpunk game plugin credits 6788 and Zash. [GitHub](https://github.com/ModOrganizer2/modorganizer), [Cyberpunk plugin](https://github.com/ModOrganizer2/modorganizer-basic_games). The plugin and its load-order guide taught us to separate MO2's virtual file priority from the game's own archive load order, which shaped how XF Studio discovers installed mods. MO2's own source and its download handler showed us how profiles order mods, how instances configure their folders, and how installs register, which XF Studio follows when it finds and reads an existing MO2 setup. The download details MO2 keeps in each mod's `meta.ini` (mod and file IDs, installation file, repository) are how a problem report names a mod's source without copying it.

### ReShade

By Patrick Mours (crosire) and contributors. [GitHub](https://github.com/crosire/reshade). Its add-on API and examples showed how to capture frames before post-processing effects, read depth and toggle effects without touching a user's preset, which is the basis of an optional lossless-capture design for in-game tests. Studied only (BSD-3-Clause); nothing is built on it yet.

### Vortex

By Black Tree Gaming Ltd. (Nexus Mods) and contributors. [GitHub](https://github.com/Nexus-Mods/Vortex). Vortex's source showed us how it stages mods, deploys the winning files into the game folder, records each deployment in a manifest and keeps each mod's Nexus Mods ids in its state, which is how XF Studio tells which Vortex mod put a file in the game folder and how a problem report says where a Vortex-installed mod came from. Studied only; XF Studio reads Vortex's files but includes no Vortex code, and our Vortex tests run in a disposable Windows Sandbox.

### WolvenKit

By the WolvenKit team and contributors. [GitHub](https://github.com/WolvenKit/WolvenKit). WolvenKit is the backbone of our export pipeline: we use its CLI to extract, convert, serialize and pack resources, including extracting the head that XF Studio's built-in eye plate is cut from and exporting each user's own head, eyes, resolved materials and textures for the 3D preview, and its source taught us the game's save, archive, mesh, morph target, animation and compiled appearance formats, plus the material type definitions and shader-cache layout, and its multilayer-mask exporter showed how the mask atlas and tile tables decode. Its animation importer showed that facial float tracks and additive clip types survive a glTF round trip, which the expression export plan relies on. Its wardrobe and script-system save parsers showed where a save keeps V's clothing. Its streaming-sector, node-data and instance-transform readers showed how the world's sectors store their nodes and placements. Its TweakDB reader showed the compiled TweakDB layout XF Studio reads for the character creator's categories and swatch icons. Its archive and package writers also informed XF Studio's pre-pack path checks, and its CLI output is the reference XF Studio's experimental native archive reader is checked against, byte for byte and document for document. Used as an external tool (GPL-3.0): XF Studio downloads the official WolvenKit CLI release only when a user agrees, and neither includes nor redistributes any WolvenKit code or binaries.

## Libraries, runtimes and general tools

### Blender

By the Blender Foundation and contributors. [blender.org](https://www.blender.org/). Blender powers our offline mesh work, eye-plate clearance studies and diagnostic renders; its BVH ray-casting API made it possible to tell visible intersections from hidden ones. Its status bar, which shows what the mouse and held modifier keys do in the current context, is the model for the Studio's viewport input hints.

### Bun

By the Bun contributors. [GitHub](https://github.com/oven-sh/bun). Bun runs XF Studio's local service, its SQLite library and our test suites, and hosts the desktop shell's main process. Used as a runtime dependency.

### dxil-spirv

By Hans-Kristian Arntzen. [GitHub](https://github.com/HansKristian-Work/dxil-spirv). Translating the game's DXIL shader programs to SPIR-V made structured, decompiled listings of them possible in our shader research. Used as a research tool only; MIT-licensed.

### Electrobun and Hutch

By Blackboard Technologies Inc. and contributors. [Electrobun](https://github.com/blackboardsh/electrobun), [Hutch](https://github.com/blackboardsh/hutch). Electrobun's documentation shaped XF Studio's desktop packaging, update, shutdown and uninstall design, and it is the framework for our desktop packaging trial. Electrobun is MIT-licensed and its notice must accompany any distributed build, together with the notices of its bundled dependencies.

### Inno Setup

By Jordan Russell and Martijn Laan. [Website](https://jrsoftware.org/isinfo.php), [source](https://github.com/jrsoftware/issrc). XF Studio's downloadable Windows setup is one Inno Setup program that carries Electrobun's setup and runs it. The setup runtime it redistributes is under the Inno Setup License, whose notice ships with the app's third-party notices.

### JSON for Modern C++

By Niels Lohmann and contributors. [GitHub](https://github.com/nlohmann/json). The XF Runtime Bridge plugin parses and writes its protocol messages with it. It is compiled into the plugin (MIT), so its licence notice must ship with any distributed build.

### LZ4

By the LZ4 authors and contributors. [Block format specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md). The specification let us write the independent decompression in XF Studio's save reader.

### Mermaid CLI

By the Mermaid contributors. [GitHub](https://github.com/mermaid-js/mermaid-cli). Used to render and visually review the diagrams in our pipeline documentation.

### luaparse

By Oskar Schöldström and contributors. [GitHub](https://github.com/fstirlitz/luaparse). We use it (MIT) as a development tool to syntax-check the XF Runtime Bridge's Lua layer offline.

### MCP TypeScript SDK

By Anthropic and the Model Context Protocol contributors. [GitHub](https://github.com/modelcontextprotocol/typescript-sdk). The XF Runtime Bridge's MCP server, which lets an AI client drive in-game tests through the bridge, is built on it, and its client runs our end-to-end tests. It is a development dependency (MIT) of the bridge's tools.

### Fengari

By Benoit Giannangeli, Daurnimator and contributors. [GitHub](https://github.com/fengari-lua/fengari). A Lua virtual machine written in JavaScript; we use it (MIT) as a development tool to run prepared CET console snippets against stand-in game objects before an in-game session.

### Microsoft platform tools and documentation

By Microsoft. The DirectX shader compiler and [DXIL reference](https://github.com/microsoft/DirectXShaderCompiler/blob/main/docs/DXIL.rst) let us read the game's compiled shaders, the [Xbox store listing](https://www.xbox.com/en-us/games/store/cyberpunk-2077/bx3m8l83bbrw) and [Xbox Wire](https://news.xbox.com/en-us/2026/03/03/xbox-game-pass-march-2026-wave-1/) showed that Cyberpunk 2077 has no Xbox app edition for Windows, and the [WebView2 debugging documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code) enabled automated testing of the packaged desktop window. WebView2 is a platform dependency of the desktop app; its [distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) shaped the one-click install, and the installer includes Microsoft's unmodified Evergreen WebView2 bootstrapper, packaged as that guidance allows.

### Pillow

By the Pillow contributors. [GitHub](https://github.com/python-pillow/Pillow). Used in research tooling to encode and measure generated test images.

### PKWARE ZIP specification

By PKWARE. [APPNOTE.TXT](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). The ZIP file format specification that XF Studio's small report-file writer follows.

### red4ext-rs

By jekky and contributors. [GitHub](https://github.com/jac3km4/red4ext-rs). Its bindings showed what a Rust RED4ext plugin can do, which we weighed as an alternative native layer for the runtime bridge before choosing C++ with the SDK the loader itself uses; its call helpers showed that it always passes a context when calling static functions. Its resource-path code confirmed the path clean-up rules behind resource hashes.

### resvg

The resvg SVG renderer by Yevhenii Reizner and contributors, used through yisibl's [resvg-js](https://github.com/yisibl/resvg-js) bindings (MPL-2.0). Renders the app icon set from its SVG master at build time. Development dependency only; nothing from it ships in the app.

### SciPy and NumPy

By the SciPy and NumPy developers. [SciPy](https://scipy.org/), [NumPy](https://numpy.org/). Their optimizers and array tools drove our eye-plate correction studies and image measurements. Used in research tooling only.

### SPIRV-Cross

By the Khronos Group and SPIRV-Cross contributors. [GitHub](https://github.com/KhronosGroup/SPIRV-Cross). It turns SPIR-V translations of the game's shader programs back into readable HLSL or GLSL for our shader research. Used as a research tool only; Apache-2.0-licensed.

### SQLite

By the SQLite project. [sqlite.org](https://sqlite.org/). SQLite stores XF Studio's local library of immutable look and collection versions.

### Three.js

By mrdoob and the three.js authors. [GitHub](https://github.com/mrdoob/three.js). Three.js renders the studio's entire browser preview: skinned head, materials, camera controls, ray casting and the glitter studies. One isolated glitter study adapts its physical-lighting shader structure, so that code carries the Three.js MIT notice, which must also accompany any distributed build.

### wgpu

By the gfx-rs/wgpu contributors. [GitHub](https://github.com/gfx-rs/wgpu). Its documentation framed our assessment of native versus browser rendering backends and the current state of ray-tracing support.

## Documentation and community knowledge

### Cyberpunk 2077 Modding Wiki

By manavortex and the wiki's contributor community. [Wiki](https://wiki.redmodding.org/cyberpunk-2077-modding), [source](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs). Special thanks to manavortex, who wrote much of the wiki and keeps it available to modders. Its file-format page, with its archive-format tables, described the container XF Studio's archive reader decodes. Its guides and screenshots taught us the character resource chain, character-creator hair, eye and switcher setups (including the switcher guides' note that an option's index sets its place in the creator) (including the eye guide's note that eye albedo is sampled upside down while normal maps are not flipped), material families and skin-shader parameters, decals and load order. We are particularly grateful to the guide authors and editors lumad11 (the CCXL eyebrows guide), icxrus, redacted-c01, nutboy, Mx_OrcBoi (custom facial piercings with PRC) and minnierylands (load-order guide), saltypigloaf (facial-rig guide), Rebecca (whose multilayered clear-coat page demonstrated the view-angle coat tint), manavortex's multilayered guide and property pages (which describe microblend contrast as a crossfade between mask and microblend, the reading the preview follows), nullfractal (whose LUT guides explained that the game grades through 3D LUTs fed with ARRI LogC3 values), and to the CyberCAT documentation for pointing us to external preset files. For facial expressions and photo mode, manavortex's facial-expression, photo-mode and pose guides, Simarilius's facial-animation page (based on research by Loomy and John CO), the AMM expression table by Maximilium, Pinkydude and Vitum, the pose-pack update pages by nutboy and Zwei Valerie, LadyLea's update of the pose-making guide (whose process and templates came from xbaebsae and Angy) and Akiway's lipsync guide showed how photo mode, AMM and scenes use facial clips and how the community registers poses. For clothing, manavortex's item-structure, suffix, dynamic-variant, tag and body-mod pages, LadyLea's tag diagrams of the body, the garment-support page (which credits psiberx and Auska, among others), revenantFun's guide to painting garment support and FronkenZeepa's first-person fixes showed how worn items resolve, layer and hide the body. For the world, the streaming-sector and streaming-block pages (Sergey's block and variant page, based on psiberx's input, and mana vortex's sector pages), psiberx's collected notes on node references, Simarilius's node-type reference and Blender sector import, the removal guides by mana vortex and justarandomguyintheinternet, Sergey's community-registry guide, Kaoziun's sector-variant project, Akiway's embedded-collision page, Deceptious's occlusion notes collected by mana vortex, and the World Builder guides explained how Night City is streamed and how location mods add to it.

### Electrobun Windows installer notes

By alxrepin ([aiusagebar pull request 16](https://github.com/alxrepin/aiusagebar/pull/16)) and djalmajr ([pinar pull request 32](https://github.com/djalmajr/pinar/pull/32)). Their pull requests recorded that Electrobun's Windows setup program only runs beside its hidden `.installer` folder, and aiusagebar showed wrapping it in an Inno Setup program so users download one file, the approach XF Studio's single-file setup takes.

## Mods and creators whose work we studied

These mods were studied from local installations. Where the private preview displays one of their assets, it is a local reference only and is never packaged or redistributed; each mod's own terms continue to apply.

### Alliekat

[Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787) and [Eyeshadow Remix Pt. 1](https://www.nexusmods.com/cyberpunk2077/mods/15451). Natural Hair Tones supplies the saved character's brow colour gradient; comparing it with the base game's version taught us that an installed override need not change the visible colour. Its replacements of the shared hair colour profiles showed how one profile colours both V and every NPC wearing that colour, and how a replacement that keeps the base game's stop positions changes where the light and dark parts of a strand fall. Eyeshadow Remix is another in-place replacement of the base game's eye-makeup masks. Private local reference only.

### anruimurasaki

[High Ponytail Hair - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/25085). Its ponytail mesh showed that a working CCXL hairstyle can list fewer chunk materials than it has render chunks, keeping stub chunks for its lower levels of detail, and that a mesh whose render data lists fewer bone positions than it has bones can ship in a working mod although WolvenKit won't export it; the preview now exports such meshes from a repaired copy. Private local reference only.

### Appearance Menu Mod

By MaximiliumM and contributors. [GitHub](https://github.com/MaximiliumM/appearancemenumod). Its Lua source showed how a mod sets time and weather, teleports, spawns a fixed camera, poses V and hides the HUD at runtime. Those techniques fill much of the capability matrix for agent-driven in-game tests. Its expression code showed a second facial route beside photo mode: resetting an NPC's reactions and applying a facial-reaction feature that selects one of the game's emotion idles. Its observer on the photo-mode setup is how we learned to catch the photo-mode puppet from Lua. Its cursor override showed how to hide the photo-mode mouse cursor for clean captures, and its controllable lights, saved locations, NPC spawning through Codeware and friendly, immortal actors showed how a test session could light V, stand her in a fixed spot and keep a scene calm. Its decor presets and shareable location packs showed how players already save and exchange placed props and places. Studied only.

### Arkhe

[Beautiful EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168), [Beautiful EYEBROWS 2K Material Edit](https://www.nexusmods.com/cyberpunk2077/mods/18783), [Universal Skin Tone](https://www.nexusmods.com/cyberpunk2077/mods/15426), [Realistic Complexion III](https://www.nexusmods.com/cyberpunk2077/mods/19314) and [Character Rendering Editor](https://www.nexusmods.com/cyberpunk2077/mods/32842). The eyebrow mod taught us how ArchiveXL copy/patch declarations assemble complete resources from vanilla geometry, and how the game combines two alpha maps with a colour gradient for brows; it also showed that brow styles merge into the base game's brow row rather than adding a selector. The Material Edit showed the other route, replacing the base game's brow material and textures in place, which changes every NPC's brows too. The skin mods provided alternative skin maps for render-fidelity comparisons and showed how a complexion replacer works: same-path head textures plus replaced global skin resources, including the default skin profile the preview's skin lighting now reads. The Character Rendering Editor's list of hair, skin and eye rendering options with their vanilla values gave the preview's hair light its default tuning and names the runtime skin and rim-light options a capture must record. Private local reference only.

### Browser Extension

By r457 and gh057, per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/10038). Its small redscript framework showed how a mod adds a site to the in-game browser without replacing anything: a listener registers an address and icon for one browser, supplies its own page widget for that address, and joins a paginated home page that also lists every journal site. That is the basis of the terminal-content research. Studied only.

### Character Customization Anywhere

By keanuWheeze, per the support link on its [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/3930). Its small Lua script showed how to open the character creator from anywhere, by redirecting the pause menu to the mirror's menu scenario, and led us to how the creator's Confirm and Back buttons finalise or discard a look. Studied only.

### CharLi – Character Lighting Suite for Photomode

By FreakaZ (+FlowerD), per its script headers. [Nexus](https://www.nexusmods.com/cyberpunk2077/mods/8176). It showed how to build a light rig from spawned light entities that follows V or the photo-mode puppet, set each light's colour, intensity, range and cone, and clean it up again, which is the basis of the planned scripted light sweep for in-game tests. Studied only.

### CyanideX

[LUT Switcher 2](https://www.nexusmods.com/cyberpunk2077/mods/16310). Studying its installed package showed that runtime LUT mods apply grading as player effects that can switch off in menus, which the character-creator capture protocol now controls for. Private local reference only.

### eagul

[PRC — Fully Modular Jewellery Framework](https://www.nexusmods.com/cyberpunk2077/mods/8590), [New Piercings Collection Vol. 1](https://www.nexusmods.com/cyberpunk2077/mods/8611) and [PRC Vanilla Piercing Mirrors](https://www.nexusmods.com/cyberpunk2077/mods/10236); the framework also credits Auska for morph-target import and manavortex for modding help. PRC showed a working route to morph-compatible modular jewellery and informs our future jewellery design; working out why it works in game (file replacement alone) is what let the preview draw it, and any similar framework, through its generic resolver. Private local reference only; the pages require the author's permission for reuse or modification.

### Even More Brows for Cyberpunk

[Even More Brows for Cyberpunk - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/26230). Its 16 styles ship complete brow geometry of their own inside ArchiveXL's brow scope, which confirmed that a brow style can join the base game's brow row with every hair colour without copying the base game's files. Studied only; its author is still being confirmed.

### Gambling System

By Boe6, per its script headers. [Pachinko](https://www.nexusmods.com/cyberpunk2077/mods/19889). Its pachinko mod showed how a CET mod offers a betting interaction at fixed world positions and lets other mods add positions through JSON files in an addons folder, which is how Urmland Street Arcade joins it. Its Playable Roulette places the tables as world sectors but spawns the wheel, ball, chips and dealer from script, a clean split between static place and runtime game. Studied only; its code carries a no-reuse notice.

### Hair-colour packs

[MCH Focused Hair Colors Pt 1](https://www.nexusmods.com/cyberpunk2077/mods/30027), [Washed Out](https://www.nexusmods.com/cyberpunk2077/mods/29943), [Illegally Blonde](https://www.nexusmods.com/cyberpunk2077/mods/23002) and [Like totally — Pink](https://www.nexusmods.com/cyberpunk2077/mods/22664). Together they showed how hair colour profiles are scoped and layered by data. Their individual authors are still being confirmed.

### High Resolution Garment Preview

[High Resolution Garment Preview](https://www.nexusmods.com/cyberpunk2077/mods/21745). Its file list showed which two base-game resources set up the inventory's garment preview, and that raising its quality is done by replacing them in place. Studied only; its author is still being confirmed.

### icxrus

[Heterochromia Eyes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/20349) and [Soft Natural Eyelashes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/29582). Heterochromia Eyes is a clear example of independently selected components; Soft Natural Eyelashes supplies the lash geometry and material used in the preview and showed how dynamic colour profiles bind to custom meshes. Private local reference only.

### A creator who asked not to be named (redacted-c01)

[Hair Color Profiles CCXL](https://www.nexusmods.com/cyberpunk2077/mods/19115) and [Photoreal Eyes CCXL](https://www.nexusmods.com/cyberpunk2077/mods/22412), both co-credited to psiberx and this creator. Their shared material templates and dynamic material paths showed how dramatically material duplication can be reduced, and the hair profiles drive the preview's saved-hair shading, with their selector icons serving as a colour check. This creator also generously explained a Substance glitter graph and reviewed our glitter preview; the lesson that facets need visibly varied tilts shaped every glitter model since. Private local reference and inspiration only; the glitter graph is not reused.

### Jack Humbert

[Let There Be Flight](https://github.com/jackhumbert/let_there_be_flight) and [Mod Settings](https://github.com/jackhumbert/mod_settings). Their RED4ext plugins showed how to ship redscript through the plugin itself and declare its natives, and Let There Be Flight's player-attach wrapper is the pattern our bridge's redscript layer follows. Studied only.

### Kala

[Kala's Eyes Standalone V2](https://www.nexusmods.com/cyberpunk2077/mods/3242), whose source eye texture is credited to Sarah Cartwright. Supplies the saved character's eye textures in the preview. Private local reference only; the page's credit, noncommercial and game-use conditions apply.

### KnowSo team

[-KS- UV Texture Framework](https://www.nexusmods.com/cyberpunk2077/mods/3783), crediting original authors Zosoab70 and AllKnowingLion and named contributors. Its skin template and seam-fix resources showed why each file's effective load-order winner must be resolved before changing preview materials, and its head-mesh appearance patch showed that an ArchiveXL patch can change the effective head material chain. Studied only; its asset-reuse conditions would need separate review.

### KOZMETIX

[KOZMETIX](https://www.nexusmods.com/cyberpunk2077/mods/29018), by meluminary per its title. It showed makeup worn as a clothing item with no geometry of its own: it patches its shades into the base game's makeup meshes, aliases their morph targets and hides the base game's lipstick while worn. Studied only.

### Kwek EquipmentEx earrings

An inventory-worn earring mod that provided a packaging precedent for our jewellery construction-set design. Studied only; its individual authorship is still being confirmed.

### Lime Makeup Atelier and Anrui's Netrunner Emporium

[Lime Makeup Atelier](https://www.nexusmods.com/cyberpunk2077/mods/18322) sells worn makeup items through a Virtual Atelier in-game shop, a distribution route for makeup that is not part of the character creator. With [Anrui's Netrunner Emporium](https://www.nexusmods.com/cyberpunk2077/mods/12328) it showed that a store mod needs only one registration call listing its items, and an icon. Studied only; their authors are still being confirmed.

### Limerence

[Limerence X AllieKat Winterkissed AXL Eyeshadows](https://www.nexusmods.com/cyberpunk2077/mods/18323) and [Limerence Liners](https://www.nexusmods.com/cyberpunk2077/mods/14780). Winterkissed is a collaboration with AllieKat per its title and description. Its eyeshadow mesh and morph target reuse the base game's eye-makeup geometry unchanged, which confirmed that working face-decal mods sit at the vanilla 0.40 mm offset above the head. Its glitter looks showed how a published glitter eyeshadow is built from the plain decal material (high-resolution metallic maps with embossed shape normals on the vanilla eye-makeup UVs), and led us to the eye plate's much lower texture density. The Liners replace the base game's eye-makeup masks in place, which showed how such replacers conflict per slot. Studied only; private local reference.

### MELUMINARY

[MELUMINARY Long Length Pak Vol. 3 #011](https://www.nexusmods.com/cyberpunk2077/mods/27125). Supplies the saved character's hair geometry for the optional hair preview, and its maps taught us to check whether an apparently missing texture is genuinely constant. Private local reference only; its creator credits and permissions are still being confirmed.

### NoraLee

[Morphtarget and AnimRig Additions](https://www.nexusmods.com/cyberpunk2077/mods/4673). Its alternative teeth resources reinforced the need to resolve each file's effective winner. Studied only; the page prohibits reuploads of the framework.

### nutboy

[Unique Eyes to CCXL](https://www.nexusmods.com/cyberpunk2077/mods/23263), which itself credits psiberx, icxrus, halvkyrie and another creator (redacted-c01). It resolves the saved character's eye choice and gave us a concrete case for reading character-creator option catalogues. Studied only; the page requires permission for asset reuse or modification.

### Photo-mode pose and tool mods

[Photo Mode Pose Selector](https://www.nexusmods.com/cyberpunk2077/mods/32633) and [Photo Mode Preferences](https://www.nexusmods.com/cyberpunk2077/mods/32736) (both by cjsu, per their Nexus descriptions), [Photo Mode Unlocker XL](https://www.nexusmods.com/cyberpunk2077/mods/4319) (SilverEzredes, per its tweak file), [Portrait Enhancer for Photo Mode](https://www.nexusmods.com/cyberpunk2077/mods/8237), [Customisable Photo Mode UI](https://www.nexusmods.com/cyberpunk2077/mods/32815), [Ziva Photoshoot Posepack](https://www.nexusmods.com/cyberpunk2077/mods/8463) (EzioMaverick, per its tweak file), [Action Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/8698), [Dancy - Pose Pack](https://www.nexusmods.com/cyberpunk2077/mods/18007) and [Multi Pose Pack Framework](https://www.nexusmods.com/cyberpunk2077/mods/4098). Together they showed how poses reach photo mode (animation sets added to the photo-mode entities or scopes, plus pose and category records), how the menu's lists can be widened, and which menu attributes select V's and NPCs' expressions, which a future in-game test can drive directly. Photo Mode Pose Selector's small redscript system, which records the photo-mode V puppet when photo mode sets it up, showed us how to find that puppet from the CET console. Photo Mode Preferences and Photo Mode Pose Selector showed which menu attribute numbers drive the camera, V's placement, lights and expressions and how to set them through the menu's own items, which the XF Runtime Bridge's photo-mode commands use; Photo Mode Preferences also showed that settings re-applied as photo mode opens can race other changes, and that a light must be selected and given a moment before its values are set. Photo Mode Unlocker XL's tweaks showed the photo-mode camera limits and first-person restriction lists, which told us the bridge's restricted photo mode came from somewhere else; Portrait Enhancer showed that the camera presets are plain records, a route to repeatable framing; Customisable Photo Mode UI mapped the photo-mode menu's widget tree. Studied only.

### psiberx

[Photo Mode Ex](https://github.com/psiberx/cp2077-photomode-ex), [Equipment-EX](https://github.com/psiberx/cp2077-equipment-ex), [Cyberware-EX](https://github.com/psiberx/cp2077-cyberware-ex), [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) and [CET Kit](https://github.com/psiberx/cp2077-cet-kit). Their source taught us how photo mode works internally, how scriptable systems and wrapped methods are written, how script logging is captured, and how to detect sessions and photo mode from Lua. Photo Mode Ex and Equipment-EX also confirmed photo-mode attribute numbers the bridge uses, and Photo Mode Ex showed that depth of field can persist into saves, which the bridge's session scripts avoid. Equipment-EX's source also showed how its outfits persist in saves, which extra outfit slots it adds with their layer offsets, and how it takes over the wardrobe. Photo Mode Ex's native hooks showed which parts of the photo-mode system scripts cannot reach, how extra photo-mode characters are registered from records, and how an option list and its label are rebuilt. Red Hot Tools' source showed how archives can be hot-reloaded into a running game, which the expression editor design proposes for previewing an authored expression in game, and its world inspector showed how a streamed node maps back to its sector and placement index and how the world can be streamed around any point. psiberx also exported the scripting RTTI dump we use to check native function names offline and to know each resource class's properties in XF Studio's archive reader. Studied only.

### Urmland Street Arcade

[Urmland Street Arcade](https://www.nexusmods.com/cyberpunk2077/mods/23908). Its world resources showed how a small location is added with ArchiveXL: the base game's own arcade, pachinko and vending devices placed in a new streaming block, a devices patch, and a few base-game nodes removed where it stands. Studied only; its author is still being confirmed.

### Virtual Atelier, Virtual Atelier Delivery and Virtual Car Dealer

By DJ_Kovrik (djkovrik), whose [GPL-3.0 repository](https://github.com/djkovrik/CP77Mods) publishes their source. [Virtual Atelier](https://www.nexusmods.com/cyberpunk2077/mods/2987) showed how other mods plug stores into one framework through a registration event, how it reuses the base game's vendor screen, and how a new tab joins a computer's menu (a technique its code credits to NexusGuy999). Virtual Atelier Delivery showed how a mod sends phone messages by rewriting pre-authored journal messages from script, spawns its own devices with new interactions, and adds billboards through TweakXL records; Virtual Car Dealer showed a browser page with its own controller and prices set when the tweak database loads. Studied only.

### World Builder and Removal Editor

By keanuWheeze (GitHub account justarandomguyintheinternet) and contributors, per its source and commit history. [World Builder](https://github.com/justarandomguyintheinternet/CP77_entSpawner) ([Nexus](https://www.nexusmods.com/cyberpunk2077/mods/20660)) and its companion [Removal Editor](https://github.com/justarandomguyintheinternet/CP77_removalEditor). World Builder showed how the community builds locations in the running game and turns them into ordinary streaming sectors: one saved group per sector, its export format, how each placeable type maps to a world node, how communities, devices and variants are exported, and how previews are spawned as entities. The Removal Editor's deletion files showed that recording each removed node's name, reference, resource and position lets a removal be re-matched after a game update. Studied only; the source carries no open licence and asks for credit or permission before reuse, so only its data formats are described.

### World and location mods

World Objects Removed, Crunch Plaza Expanded, Japantown North Verticality Expanded, Northside Metro and Inside The NCART Station (both by tidusmd, per their script headers), Underground Casino, Apartments Enhanced, The Glen PROJECT, Corpo Rooftop Bar, Ghosts of Night City, Echos of Loss, People of Night City, Eden Plaza penthouse and New Lore Friendly Holographic Ads. Together they are the worked examples for XF Studio's world research: prop-built interiors in new sectors, removals and moved nodes in vanilla sectors, device patches for elevators and doors, a quest phase that runs a casino's doors, NPC scenes placed through AI spots and communities, compatibility builds that delete another mod's nodes, and, by contrast, an in-place texture replacement. Studied only; most of their authors are still being confirmed.

### xBaebsae

[Facial Customisation Rig Fix](https://www.nexusmods.com/cyberpunk2077/mods/7179) and [Photomode Facial Expression Mega Pack](https://www.nexusmods.com/cyberpunk2077/mods/7912), and [Photomode NPCs Extended](https://www.nexusmods.com/cyberpunk2077/mods/18837), whose records showed how any character becomes selectable in photo mode (with Photo Mode Ex), a route to a reference character beside V in tests. The expression pack showed the whole route by which photo mode gains expressions: new expression records, extra rows in the game's expression table, clips attached to the photo-mode face rig, and a face-graph change that lets animated expressions loop. It also showed that the table and graphs are files only one mod can own, which shapes the Studio's export plan. The rig fix's alternative head morph reinforced the need to resolve each file's effective winner, and showed that a head fix can keep the geometry while renaming per-target bone names, which the built-in eye plate now carries over. That fix is also why we read morph targets' own joint binds as active at runtime, which the preview's blink now follows for each eye shape. Studied only.

## Research papers

These papers informed our research. No algorithm from them was implemented.

### Lagarde and de Rousiers (2014)

Sébastien Lagarde and Charles de Rousiers, "Moving Frostbite to PBR" (EA DICE, SIGGRAPH 2014 course notes). The reference that let us recognise the game's diffuse and specular lighting formulas when reading its compiled shaders.

### Deliot and Belcour (2023)

Thomas Deliot and Laurent Belcour, [anisotropic-grid glint paper](https://arxiv.org/abs/2306.05051v1). A lead on counting glints within a pixel's footprint.

### Jakob et al. (2014)

Jakob, Hašan, Yan, Lawrence, Ramamoorthi and Marschner, [Discrete Stochastic Microfacet Models](https://research.cs.cornell.edu/stochastic-sg14/). Framed the aliasing and temporal-coherence problem of tiny normal-mapped glitter.

### Karis (2016)

Brian Karis (Epic Games), "Physically Based Hair Shading in Unreal" (SIGGRAPH 2016 course notes). The published hair lighting model that the game's decoded hair light matches, which let us read the compiled program term by term.

### Kneiphof and Klein (2025)

Kneiphof and Klein, [Real-time Image-based Lighting of Glints](https://arxiv.org/abs/2507.02674v1). Showed that environment lighting is a separate filtering requirement.

### Barré-Brisebois and Hill (2012)

Colin Barré-Brisebois and Stephen Hill, [Blending in Detail](https://blog.selfshadow.com/publications/blending-in-detail/). Their reoriented normal mapping formula let us recognise how the game's decal composes a makeup normal map with the skin normal, which decided the Shimmer export design.

### Toksvig (2005) and Olano and Baker (2010)

Michael Toksvig, "Mipmapping Normal Maps" (Journal of Graphics Tools), and Marc Olano and Dan Baker, [LEAN Mapping](https://www.csee.umbc.edu/~olano/papers/lean/). Their idea of turning normal variance lost to mipmapping into wider roughness shapes the Shimmer export's lower mip levels.

## Reference imagery

### Jewellery form and fit references

The Association of Professional Piercers' [jewellery](https://safepiercing.org/wp-content/uploads/2020/05/APP_Initial_Print.pdf) and [procedure](https://safepiercing.org/wp-content/uploads/2020/10/APP_Procedures_2013_A_Web.pdf) brochures, including measurement material by Elayne Angel and photographs credited to Paul King, Neometal and Industrial Strength Body Jewelry, together with product pages from [Anatometal](https://anatometal.com/), [Maria Tash](https://www.mariatash.com/), [Stone and Strand](https://www.stoneandstrand.com/) and [BVLA](https://www.bvla.com/). They taught us gauges, ring sizes, closures and connection patterns for the jewellery design. Viewed as references only; no image or design was copied, and the APP jewellery brochure is licensed CC BY-NC-ND 4.0.

## Community members we are still identifying

- A Discord community member who suggested shimmer as a makeup finish.
- A modder who recommended ArchiveXL dynamic expansion, which set the direction of our export design.
- The photographers and makeup artists behind the glitter makeup photographs, and the designers and photographers behind the earring photographs, that we used as visual references.

If you recognise your contribution here or anywhere in this project, please let us know so we can credit you properly.
