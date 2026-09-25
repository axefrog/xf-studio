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

Developer of Cyberpunk 2077. The game's own resources, shaders, rigs, animation and materials are the ground truth for nearly everything we study, and their article [A World Full of Substance](https://magazine.substance3d.com/cyberpunk-2077-a-world-full-of-substance/) explained the shared-surface and mask approach behind the game's materials. Game content is used only as a private local reference for the preview and experiments; none is redistributed.

## Frameworks and core mods

### ArchiveXL

By psiberx and contributors. [GitHub](https://github.com/psiberx/cp2077-archive-xl). ArchiveXL's source taught us how character-creator options are registered, how appearance templates are cloned and how dynamic material paths expand. That understanding is the foundation of XF Studio's single-selector preset export, which avoids generating a separate material for every combination, and its archive-group, `.xl` discovery, scope, fix, patch, copy/link and dynamic-mesh rules are what XF Studio's character resolver replicates to interpret installed mods the way the game does. It is an intended runtime dependency; no ArchiveXL code is included in XF Studio.

### Codeware and TweakXL

By psiberx and contributors. [Codeware](https://github.com/psiberx/cp2077-codeware), [TweakXL](https://github.com/psiberx/cp2077-tweak-xl). Their release notes and compatibility statements helped us choose stable framework versions for runtime testing. Their source, and psiberx's shared plugin framework within it, taught us how a well-built RED4ext plugin is structured, logs and ships its scripts, how to declare natives for redscript, and how TweakXL loads and types YAML tweaks, which shaped the XF Runtime Bridge; its TweakXL data marker is an optional runtime use. No code is copied.

### Cyber Engine Tweaks

By yamashi and contributors. [GitHub](https://github.com/maximegmd/CyberEngineTweaks). Its source showed us exactly what a Lua mod can do: its events, its sandbox (including that it has no networking), its logging and how Lua reaches game and plugin functions. That is why the XF Runtime Bridge keeps its external link in a native plugin and uses CET only for reporting and an on-screen status. CET is a runtime dependency of the bridge's Lua layer.

### RED4ext and RED4ext SDK

By wopss and contributors. [RED4ext](https://github.com/wopss/RED4ext), [RED4ext SDK](https://github.com/wopss/RED4ext.SDK). RED4ext's releases set our framework baseline, and the SDK's resource-depot declarations clarified which parts of archive lookup order the game leaves unspecified. Its character-customization type declarations showed that the creator tracks an active flag per option. A dump of the game's scripting type information, exported for us by psiberx with his fork of wopss's RED4.RTTIDumper, named the puppet-preview controller and camera classes that led us to the character creator's scene and camera. The loader's source and the SDK's examples taught us the plugin contract, game-state callbacks, per-plugin logging and native function registration behind the XF Runtime Bridge, which is built against the SDK (MIT) and needs RED4ext at runtime.

### redscript

By jac3km4 and contributors. [GitHub](https://github.com/jac3km4/redscript). Its releases helped set a stable framework baseline for runtime testing. Its compiler source taught us how modules name classes and globals, how method wrapping resolves and where compilation logs go, and we use its official command-line release (MIT) to type-check the XF Runtime Bridge's scripts offline.

## Modding tools

### Cyberpunk Blender Add-on (IO Suite)

By its authors and the RED Modding maintainers. [GitHub](https://github.com/WolvenKit/Cyberpunk-Blender-add-on). Its facial solver turns the game's facial animation controls into real deformation; running it offline gave the studio's preview a working character-creator idle with blinks, gaze and mouth movement. Its eye material setup also served as a useful precedent for our preview shaders, and its material import code, originally by HitmanHimself building on Turk645's research with shader notes by Jato and current maintenance by DoctorPresto, showed how community tools read each shader template's parameters and texture channels, including its empirical hair-profile colour handling. Its world-sector importer's light conversion showed which local axis a light shines along. We run the unmodified solver as an external tool (GPL-3.0-or-later); no add-on code is included in XF Studio.

### IGCS Connector

By Frans Bouma (Otis Photomode Mods). [GitHub](https://github.com/FransBouma/IgcsConnector). Its source showed how a ReShade add-on cooperates with game camera tools and captures shots, which we assessed as an optional camera and capture path for agent-driven tests. Studied only.

### Mod Organizer 2

By the ModOrganizer2 contributors; the Cyberpunk game plugin credits 6788 and Zash. [GitHub](https://github.com/ModOrganizer2/modorganizer), [Cyberpunk plugin](https://github.com/ModOrganizer2/modorganizer-basic_games). The plugin and its load-order guide taught us to separate MO2's virtual file priority from the game's own archive load order, which shaped how XF Studio discovers installed mods. MO2's own source and its download handler showed us how profiles order mods, how instances configure their folders, and how installs register, which XF Studio follows when it finds and reads an existing MO2 setup.

### ReShade

By Patrick Mours (crosire) and contributors. [GitHub](https://github.com/crosire/reshade). Its add-on API and examples showed how to capture frames before post-processing effects, read depth and toggle effects without touching a user's preset, which is the basis of an optional lossless-capture design for in-game tests. Studied only (BSD-3-Clause); nothing is built on it yet.

### WolvenKit

By the WolvenKit team and contributors. [GitHub](https://github.com/WolvenKit/WolvenKit). WolvenKit is the backbone of our export pipeline: we use its CLI to extract, convert, serialize and pack resources, including extracting the head that XF Studio's built-in eye plate is cut from and exporting each user's own head, eyes, resolved materials and textures for the 3D preview, and its source taught us the game's save, archive, mesh, morph target, animation and compiled appearance formats, plus the material type definitions and shader-cache layout. Its archive and package writers also informed XF Studio's pre-pack path checks. Used as an external tool (GPL-3.0): XF Studio downloads the official WolvenKit CLI release only when a user agrees, and neither includes nor redistributes any WolvenKit code or binaries.

## Libraries, runtimes and general tools

### Blender

By the Blender Foundation and contributors. [blender.org](https://www.blender.org/). Blender powers our offline mesh work, eye-plate clearance studies and diagnostic renders; its BVH ray-casting API made it possible to tell visible intersections from hidden ones. Its status bar, which shows what the mouse and held modifier keys do in the current context, is the model for the Studio's viewport input hints.

### Bun

By the Bun contributors. [GitHub](https://github.com/oven-sh/bun). Bun runs XF Studio's local service, its SQLite library and our test suites, and hosts the desktop shell's main process. Used as a runtime dependency.

### dxil-spirv

By Hans-Kristian Arntzen. [GitHub](https://github.com/HansKristian-Work/dxil-spirv). Translating the game's DXIL shader programs to SPIR-V made structured, decompiled listings of them possible in our shader research. Used as a research tool only; MIT-licensed.

### Electrobun and Hutch

By Blackboard Technologies Inc. and contributors. [Electrobun](https://github.com/blackboardsh/electrobun), [Hutch](https://github.com/blackboardsh/hutch). Electrobun's documentation shaped XF Studio's desktop packaging, update, shutdown and uninstall design, and it is the framework for our desktop packaging trial. Electrobun is MIT-licensed and its notice must accompany any distributed build, together with the notices of its bundled dependencies.

### JSON for Modern C++

By Niels Lohmann and contributors. [GitHub](https://github.com/nlohmann/json). The XF Runtime Bridge plugin parses and writes its protocol messages with it. It is compiled into the plugin (MIT), so its licence notice must ship with any distributed build.

### LZ4

By the LZ4 authors and contributors. [Block format specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md). The specification let us write the independent decompression in XF Studio's save reader.

### Mermaid CLI

By the Mermaid contributors. [GitHub](https://github.com/mermaid-js/mermaid-cli). Used to render and visually review the diagrams in our pipeline documentation.

### luaparse

By Oskar Schöldström and contributors. [GitHub](https://github.com/fstirlitz/luaparse). We use it (MIT) as a development tool to syntax-check the XF Runtime Bridge's Lua layer offline.

### Microsoft platform tools and documentation

By Microsoft. The DirectX shader compiler and [DXIL reference](https://github.com/microsoft/DirectXShaderCompiler/blob/main/docs/DXIL.rst) let us read the game's compiled shaders, and the [WebView2 debugging documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code) enabled automated testing of the packaged desktop window. WebView2 is a platform dependency of the desktop app; its [distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) shaped the one-click install, and the installer includes Microsoft's unmodified Evergreen WebView2 bootstrapper, packaged as that guidance allows.

### Pillow

By the Pillow contributors. [GitHub](https://github.com/python-pillow/Pillow). Used in research tooling to encode and measure generated test images.

### red4ext-rs

By jekky and contributors. [GitHub](https://github.com/jac3km4/red4ext-rs). Its bindings showed what a Rust RED4ext plugin can do, which we weighed as an alternative native layer for the runtime bridge before choosing C++ with the SDK the loader itself uses.

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

By manavortex and the wiki's contributor community. [Wiki](https://wiki.redmodding.org/cyberpunk-2077-modding), [source](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs). Special thanks to manavortex, who wrote much of the wiki and keeps it available to modders. Its guides and screenshots taught us the character resource chain, character-creator hair, eye and switcher setups, material families and skin-shader parameters, decals and load order. We are particularly grateful to the guide authors and editors icxrus, island_dancer, nutboy, Mx_OrcBoi (custom facial piercings with PRC) and minnierylands (load-order guide), saltypigloaf (facial-rig guide), Rebecca (whose multilayered clear-coat page demonstrated the view-angle coat tint), nullfractal (whose LUT guides explained that the game grades through 3D LUTs fed with ARRI LogC3 values), and to the CyberCAT documentation for pointing us to external preset files.

## Mods and creators whose work we studied

These mods were studied from local installations. Where the private preview displays one of their assets, it is a local reference only and is never packaged or redistributed; each mod's own terms continue to apply.

### Alliekat

[Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787). Supplies the saved character's brow colour gradient; comparing it with the base game's version taught us that an installed override need not change the visible colour. Private local reference only.

### Appearance Menu Mod

By MaximiliumM and contributors. [GitHub](https://github.com/MaximiliumM/appearancemenumod). Its Lua source showed how a mod sets time and weather, teleports, spawns a fixed camera, poses V and hides the HUD at runtime. Those techniques fill much of the capability matrix for agent-driven in-game tests. Studied only.

### Arkhe

[Beautiful EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168), [Universal Skin Tone](https://www.nexusmods.com/cyberpunk2077/mods/15426), [Realistic Complexion III](https://www.nexusmods.com/cyberpunk2077/mods/19314) and [Character Rendering Editor](https://www.nexusmods.com/cyberpunk2077/mods/32842). The eyebrow mod taught us how ArchiveXL copy/patch declarations assemble complete resources from vanilla geometry, and how the game combines two alpha maps with a colour gradient for brows. The skin mods provided alternative skin maps for render-fidelity comparisons and showed how a complexion replacer works: same-path head textures plus replaced global skin resources, including the default skin profile the preview's skin lighting now reads. The Character Rendering Editor's list of hair, skin and eye rendering options with their vanilla values gave the preview's hair light its default tuning and names the runtime skin and rim-light options a capture must record. Private local reference only.

### CyanideX

[LUT Switcher 2](https://www.nexusmods.com/cyberpunk2077/mods/16310). Studying its installed package showed that runtime LUT mods apply grading as player effects that can switch off in menus, which the character-creator capture protocol now controls for. Private local reference only.

### eagul

[PRC — Fully Modular Jewellery Framework](https://www.nexusmods.com/cyberpunk2077/mods/8590), [New Piercings Collection Vol. 1](https://www.nexusmods.com/cyberpunk2077/mods/8611) and [PRC Vanilla Piercing Mirrors](https://www.nexusmods.com/cyberpunk2077/mods/10236); the framework also credits Auska for morph-target import and manavortex for modding help. PRC showed a working route to morph-compatible modular jewellery and informs our future jewellery design. Private local reference only; the pages require the author's permission for reuse or modification.

### Hair-colour packs

[MCH Focused Hair Colors Pt 1](https://www.nexusmods.com/cyberpunk2077/mods/30027), [Washed Out](https://www.nexusmods.com/cyberpunk2077/mods/29943), [Illegally Blonde](https://www.nexusmods.com/cyberpunk2077/mods/23002) and [Like totally — Pink](https://www.nexusmods.com/cyberpunk2077/mods/22664). Together they showed how hair colour profiles are scoped and layered by data. Their individual authors are still being confirmed.

### icxrus

[Heterochromia Eyes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/20349) and [Soft Natural Eyelashes - CCXL](https://www.nexusmods.com/cyberpunk2077/mods/29582). Heterochromia Eyes is a clear example of independently selected components; Soft Natural Eyelashes supplies the lash geometry and material used in the preview and showed how dynamic colour profiles bind to custom meshes. Private local reference only.

### island_dancer

[Hair Color Profiles CCXL](https://www.nexusmods.com/cyberpunk2077/mods/19115) and [Photoreal Eyes CCXL](https://www.nexusmods.com/cyberpunk2077/mods/22412), both co-credited to island_dancer and psiberx. Their shared material templates and dynamic material paths showed how dramatically material duplication can be reduced, and the hair profiles drive the preview's saved-hair shading, with their selector icons serving as a colour check. island_dancer also generously explained a Substance glitter graph and reviewed our glitter preview; the lesson that facets need visibly varied tilts shaped every glitter model since. Private local reference and inspiration only; the glitter graph is not reused.

### Jack Humbert

[Let There Be Flight](https://github.com/jackhumbert/let_there_be_flight) and [Mod Settings](https://github.com/jackhumbert/mod_settings). Their RED4ext plugins showed how to ship redscript through the plugin itself and declare its natives, and Let There Be Flight's player-attach wrapper is the pattern our bridge's redscript layer follows. Studied only.

### Kala

[Kala's Eyes Standalone V2](https://www.nexusmods.com/cyberpunk2077/mods/3242), whose source eye texture is credited to Sarah Cartwright. Supplies the saved character's eye textures in the preview. Private local reference only; the page's credit, noncommercial and game-use conditions apply.

### KnowSo team

[-KS- UV Texture Framework](https://www.nexusmods.com/cyberpunk2077/mods/3783), crediting original authors Zosoab70 and AllKnowingLion and named contributors. Its skin template and seam-fix resources showed why each file's effective load-order winner must be resolved before changing preview materials, and its head-mesh appearance patch showed that an ArchiveXL patch can change the effective head material chain. Studied only; its asset-reuse conditions would need separate review.

### Kwek EquipmentEx earrings

An inventory-worn earring mod that provided a packaging precedent for our jewellery construction-set design. Studied only; its individual authorship is still being confirmed.

### Limerence

[Limerence X AllieKat Winterkissed AXL Eyeshadows](https://www.nexusmods.com/cyberpunk2077/mods/18323), a collaboration with AllieKat per its title and description. Its eyeshadow mesh and morph target reuse the base game's eye-makeup geometry unchanged, which confirmed that working face-decal mods sit at the vanilla 0.40 mm offset above the head. Its glitter looks showed how a published glitter eyeshadow is built from the plain decal material (high-resolution metallic maps with embossed shape normals on the vanilla eye-makeup UVs), and led us to the eye plate's much lower texture density. Studied only; private local reference.

### MELUMINARY

[MELUMINARY Long Length Pak Vol. 3 #011](https://www.nexusmods.com/cyberpunk2077/mods/27125). Supplies the saved character's hair geometry for the optional hair preview, and its maps taught us to check whether an apparently missing texture is genuinely constant. Private local reference only; its creator credits and permissions are still being confirmed.

### NoraLee

[Morphtarget and AnimRig Additions](https://www.nexusmods.com/cyberpunk2077/mods/4673). Its alternative teeth resources reinforced the need to resolve each file's effective winner. Studied only; the page prohibits reuploads of the framework.

### nutboy

[Unique Eyes to CCXL](https://www.nexusmods.com/cyberpunk2077/mods/23263), which itself credits psiberx, icxrus, island dancer and halvkyrie. It resolves the saved character's eye choice and gave us a concrete case for reading character-creator option catalogues. Studied only; the page requires permission for asset reuse or modification.

### psiberx

[Photo Mode Ex](https://github.com/psiberx/cp2077-photomode-ex), [Equipment-EX](https://github.com/psiberx/cp2077-equipment-ex), [Cyberware-EX](https://github.com/psiberx/cp2077-cyberware-ex), [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) and [CET Kit](https://github.com/psiberx/cp2077-cet-kit). Their source taught us how photo mode works internally, how scriptable systems and wrapped methods are written, how script logging is captured, and how to detect sessions and photo mode from Lua. psiberx also exported the scripting RTTI dump we use to check native function names offline. Studied only.

### xBaebsae

[Facial Customisation Rig Fix](https://www.nexusmods.com/cyberpunk2077/mods/7179). Its alternative head morph reinforced the need to resolve each file's effective winner, and showed that a head fix can keep the geometry while renaming per-target bone names, which the built-in eye plate now carries over. Studied only.

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
