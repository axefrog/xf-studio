# Tattoos: research and design brief

**Status: research and discussion brief, 27 September 2026. Nothing is built.** Tattoos are later feature 6 in the [queue](../backlog/README.md#later-features--discuss-with-the-maintainer-before-building-each), after facial expressions, and "full body by then": the preview already draws V's whole body ([V's body](../../knowledge/body-rendering.md)). The feature is discussed with the maintainer before any editor, renderer or exporter work starts; the existing tattoo preview is not permission to build a tattoo editor. The facts are consolidated on the [tattoos knowledge page](../../knowledge/tattoos.md); this brief adds the design direction, a phased plan, the batched in-game checks, the questions for the maintainer and the evidence behind both.

## What the research established

| Finding | Grade |
|---|---|
| **Vanilla tattoos are lifted decal meshes with their own UV**, not skin textures. A face tattoo copies head triangles 0.2 mm out; a body tattoo copies body **and arm** triangles about 1 mm out, in one chunk with one atlas, so one decal crosses the shoulder seam. Both use `mesh_decal` and write colour only. | [resource] |
| **Vanilla ink is tone-tinted and never opaque**: `DiffuseColor` per skin tone multiplies the ink texture, and `DiffuseAlpha` 0.6–0.7 caps its strength. The player picks a design, not a colour. | [resource] [source] |
| **Vanilla texel density is modest**: about 0.28 mm per texel on face tattoos (1024²) and 0.48–0.67 mm on body tattoos (2048²). | [resource] |
| **The creator allows one face and one body tattoo**, in rows with position labels (`01`…`15`) and the `Ripperdoc` edit tag; both rows follow the skin-tone link. | [resource] |
| **Most installed tattoo mods replace one file.** Texture frameworks (KS UV, VTK) give V a player-only skin chain whose `SecondaryAlbedo` is an overlay texture in the skin's UV; each tattoo mod ships that overlay, so only one can be active and each targets one framework and body layout. | [resource] [wiki] |
| **The additive routes are CCXL**: a new row (SEDTH's Sandevistan: head and body decal meshes, one choice per body mod), extra choices in the vanilla `body_tattoo` row (the wiki's template), or the community region rows `neck_tattoo` 3300 … `right_leg_tattoo` 3309. A choice label that repeats a vanilla label replaces it. | [resource] [wiki] [source] |
| **Tags hide tattoos by component prefix**: `hide_Torso` hides every `tx_` component (so all of a vanilla body tattoo, arms and legs included), `hide_Head` every `hx_`; a mod can register its own components under any tag in its `.xl`. | [source] |
| **Body mods break copied decal meshes**: a decal cut from the vanilla body does not fit a refit, so CCXL tattoo mods ship one mesh per supported body. | [resource] |

## Design direction: XF Tattoos

### The central choice: decal canvas or skin overlay

| | **A. Decal canvas (recommended)** | B. Skin overlay through a texture framework |
|---|---|---|
| How it reaches the game | Lifted decal meshes cut from V's own skin, with the Studio's own UV atlas, as CCXL choices | Paint into a framework's `SecondaryAlbedo` overlay in the skin's UV |
| Additive | Yes: own components and choices; combines with vanilla tattoos, overlay mods and any framework | No: replaces the user's overlay file, requires a framework, and loses to or beats other tattoo mods by load order |
| Seams | Solved by construction: one decal can span head, body and arms, as vanilla body tattoos do | Each skin part is a separate image; designs across seams are matched by hand |
| Density | Chosen per look (see budgets) | Fixed by the framework's sheet (0.18–0.22 mm at 8192² on the reference install) |
| Finishes | Everything `mesh_decal` writes: colour, roughness and metalness (glossy or metallic ink), normal (raised ink, scarification), plus `mesh_decal_emissive` for glow ink | Colour, the framework's glow mask and overlay normal |
| Fit to body mods | The Studio builds each player's own copy, so it cuts the canvas from the V's **effective** body, arms and head as the resolver finds them: a refit body gets a fitting canvas without per-mod adapters | Depends on the framework's layout for that body |
| Project rules | Fits "additive, never replacing", "don't touch users' core mod setups" and the generic resolver | Conflicts with all three |

B is recorded only so the decision is explicit; it would also need the user's framework, which the Studio must never install or replace.

### Authoring: stencils on the body, painting on the canvas

Tattoos are placed art more than painted makeup, and they wrap around limbs and across seams. The proposal is a new engine beside the layered-makeup engine, reusing its finishes and compiler:

- **Placed stencils** (the primary tool): an imported image (PNG or SVG flash art) or a Studio-drawn shape, placed on the 3D body with a position, surface normal, up direction, size and wrap mode (planar, cylindrical around a limb, or surface-following). Each canvas texel evaluates the stencil at its 3D surface point, so a design is continuous across head, body and arm seams by construction; there is no UV painting step for the user.
- **Brush painting** on the same canvas for linework, shading and touch-ups, using the layered engine's brushes in canvas space.
- **Ink model**: authored ink colours (not tone-tinted by default), a "healed" softness and strength (vanilla stops at 60–70 %), optional tone-aware darkening to match vanilla, and finishes: plain ink (colour only), glossy or metallic ink (roughness and metalness), raised ink and scarification (normal), and glow ink (emissive). Two engine caveats bound these finishes: `mesh_decal_emissive` adds into GBuffer2's B/A over skin, where skin keeps its skin-profile and emissive bits, so its look there is not a clean glow ([decal reference §5.4](../materials/shader-decal.md#54-emissive-decals)); and any surface-writing ink blends GBuffer2.z towards 1/3, removing sun transmission on thin parts such as ears and fingers, while blended metalness above 0.1 also turns off skin SSS ([materials §2.4](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)).
- **Head tattoos** can use head UV0 directly (not mirrored, 0.13 mm per texel at 4096²), so the eye-makeup engine's region model applies unchanged for face work; stencils cover the neck and anything crossing the collar.

### Geometry: one canvas per region, cut per look

- **Canvas regions**: head and neck (head mesh), torso front and back, each arm and hand, each leg and foot; each a lifted copy of the V's effective skin triangles, keeping native skin bytes, the head's 105 facial targets and the female body's breast targets, like the eye plate ([skin-byte rule](../../AGENTS.md#expanded-eye-plate)). Lift starts from vanilla: 0.2 mm on the head, about 1 mm on the body (open question 5 on the knowledge page).
- **Per-look cut**: at Build, each look keeps only the canvas triangles under ink (with a margin) and packs them into a tight atlas at a uniform texel density. A small wrist piece then costs a small mesh and a small texture, where vanilla ships a body-wide canvas and a 2048² map per design.
- **Arm cyberware and first person** need the arm part split by holster state and a first-person twin, as vanilla does (test asks 3 and 6 below).

### Export: choices, rows and names

- **Default: whole looks in the vanilla rows.** Following the Selectors rule, an XF face look joins `facial_tattoo` and an XF body look joins `body_tattoo` (plus its first-person twin), with unique choice labels so no vanilla choice is overwritten. A look is everything the person placed for that row, so in-game combination is not needed: the person composes the full piece in the Studio. An XF look may also include a vanilla tattoo's component by depot path (for example vanilla design 03 plus an XF sleeve), without redistributing anything.
- **Option: region rows.** For mix-and-match in game, looks can be exported per region into the community rows (`neck_tattoo` 3300 … `right_leg_tattoo` 3309), joining rather than duplicating them. This adds rows to the creator; it is the maintainer's call (question 2).
- **Groups and tags**: face looks in `TPP`, `TPP_photomode` and `character_customization` (the lesson of the eye-makeup `face`-group fix); body looks in `TPP_Body`, `character_creation`, and the twin in `FPP_Body`. The mod's own `.xl` registers each region component under the tags that should hide it (`hide_Torso`, `hide_Chest`, `hide_Arms`, `hide_Legs`, `hide_Head` …), so tight garments hide exactly the ink they cover, which vanilla's single `tx_` rule cannot.
- **Tone**: the rows follow `skin color`, so each option carries 12 tone definitions; by default they all name one XF appearance (authored ink colour), and tone-aware darkening becomes 12 appearances that differ only in material parameters.
- **Names**: split mod "XF Tattoos"; merged with other features "XF Looks"; resources under `…/<key>/tattoos/` with `xfs_` names ([naming](../../projects/xf-studio/data/naming.md)).

### Performance and size budgets

The measured surface of a female V is about 1.63 m² (head 0.16, torso 0.47, thighs 0.37, lower legs and feet 0.31, arms 0.31). One `TCM_QualityColor` texel is about one byte, and mips add a third.

| Target density | Texels for the whole skin (70 % atlas packing) | Size | Use |
|---|---|---|---|
| 0.5 mm (vanilla body) | about 9 M: one 4096 × 2048 plus slack | about 12 MiB | Default for large body pieces |
| 0.25 mm | about 37 M: one 8192 × 4096 plus slack | about 47 MiB | "High detail" option |
| 0.13 mm (head UV0 at 4096²) | – | 21 MiB for the head alone | Face work |

Proposed defaults: 0.35 mm on the body and 0.15 mm on the head and hands, textures capped at 4096² per atlas, a Check warning when a look passes 32 MiB, and an optional high-detail build. Only inked regions ship. A glow finish adds one emissive map per look at the same size; normal and roughness finishes add one map each.

## Phased plan

| Phase | What | Effort | Depends on |
|---|---|---|---|
| 0 | Decisions on this brief | S | Maintainer |
| 1 | **Canvas geometry R&D**: cut and lift region canvases from the resolver's effective head, body and arm meshes; skin bytes and morph targets; clearance against the body at every breast size; a test canvas with a checker and seam bands at the collar, shoulder and ankle | M | Resolver, eye-plate cut code |
| 2 | **Stencil engine and preview**: placement on the skinned body (picking, planar and cylindrical wrap), per-texel evaluation into the canvas, preview drawing through the body decal path, a clothing toggle | L | Platform steps 7–8 (scene port, export host) |
| 3 | **Ink materials**: plain, healed, tone-aware; glossy, metallic, raised and glow finishes with preview adapters | M | Decal family |
| 4 | **Exporter**: per-look cut and atlas packing, `.app` with tone definitions, CCXL merges into `facial_tattoo` and `body_tattoo` with the first-person twin, `.xl` tag registrations, labels, Check and Build, verifier | L | Phases 1–3, feature exporter contract |
| 5 | **In-game session** (below) | S to prepare | Phase 4 build |
| 6 | Region rows (3300–3309), refit bodies, masculine V | M each | Phase 5 results |

## In-game checks to batch

One prepared session after phase 4, with a checklist, the exact candidate and profile, and captures; the vanilla checks can join an earlier session. Knowledge-page asks 1–5 ([tattoos](../../knowledge/tattoos.md#in-game-test-asks)) cover order, overlays, cyberarms, tags and strength. The XF build adds:

1. **Test canvas in `body_tattoo`**: position after the vanilla choices, 12-tone behaviour, drawn in the creator, gameplay and photo mode; no z-fighting at the chosen lift; ink follows small and big breasts.
2. **Seams**: the checker bands continue without a visible step at the collar, shoulders and ankles, in the idle and while moving.
3. **Tags**: a chest-only garment hides only the torso canvas, a leg garment only the leg canvases.
4. **Face canvas in `facial_tattoo`**: follows expressions and the blink; order against XF eye makeup and vanilla blush.
5. **Finishes**: glossy, metallic and glow ink under the creator's lighting and in a dark street.
6. **First person and cyberware**: ink on the first-person arms; arms with Gorilla Arms or Mantis Blades.
7. **Ripperdoc**: the XF choice can be changed at a ripperdoc like vanilla tattoos.

## Questions for the maintainer

1. **Scope of the first version**: head and body together, or body first (the head can reuse the eye-makeup engine later)?
2. **Combining in game**: whole looks in the vanilla rows (default: one face look, one body look; composed in the Studio), region rows in the community switchers 3300–3309, or both?
3. **Authoring model**: placed stencils (imported flash art and shapes) plus brushes, as proposed, or painting only?
4. **Ink colour**: authored colours by default with tone-aware darkening as an option, or follow vanilla's tone tinting by default? Is glow ink wanted in the first version?
5. **Body mods**: support refit bodies from the first version (the canvas is cut from the V's effective body), or vanilla body first?
6. **Detail default**: 0.35 mm body and 0.15 mm head and hands, with a high-detail option, or another budget?
7. **Names**: "XF Tattoos" split, "XF Looks" merged, and the creator label for XF choices.
8. **Overlay export**: confirm that exporting into texture-framework overlays is out of scope.

## Evidence and provenance

Offline only; no game launch, no save or game-file change; no payload leaves the ignored local folders. Scripts and outputs lived in the session scratch folder.

| Input | Version or identity | Used for |
|---|---|---|
| Game 2.31 resources in the Studio resolver cache | WolvenKit CLI 9.0.1 JSON, cached 25–26 September 2026 | Face and body tattoo `.app`, `.mesh`, `.mi` and `.xbm` headers; tone instances; vanilla and framework skin chains |
| Preview exports (WolvenKit 9.0.1 GLB) | Body tattoo 01 morph target (raw SHA-256 `2ba62e4a6eff87ed…`), face tattoo 02 morph target (`0446f97148bd7d6b…`), female body morph target (`ceca0e211ca503fb…`), left arm `a0_000_pwa_base_hq__l.mesh`, the preview core head | Footprints, lifts, UV matches, densities (below) |
| [Creator option inventory](cc-option-inventory.json) | 2.31 base and EP1 resources | Rows, choices, links, groups, edit tags |
| ArchiveXL | 1.27.3 source at `5474e34`, `bundle/source/resources/VisualTags.xl` | `hide_Torso` → `tx_`, `hide_Head` → `hx_` |
| Modding Docs clone | `be2f44eed8419342ec13f72ed9cab008e9f7b289` (canonical `upstream/main`, 22 September 2026) | Pages and images below |
| Reference MO2 install | Profiles `2025 (again)` and `XF Studio diagnostic 2026-09-25` (identical tattoo entries) | Installed tattoo mods (below) |

**Measurement method** [resource]. Each GLB was read directly (positions, normals, UV0, indices). For every decal vertex, the nearest skin vertex (head; or body chunks 0–7, the left arm and its mirror image) gave the lift (distance and offset along the skin normal), the part it copies and whether its UV equals the skin's UV0 (tolerance 0.002). Mirror symmetry of a decal's UV: for each vertex, a partner within 0.1 mm at −x, then whether the pair shares a UV. Coverage: the share of a skin part's vertices with a decal vertex within 2 mm. Density: √(surface area ÷ UV area) over triangles. Sums of skin areas: head 1,636 cm², body chunks 0–7 11,559 cm², one arm 1,562 cm² (hand included).

**Modding Docs pages and images** (paths relative to the clone; editor and layout illustrations, not runtime proof):

| Page (authorship as evidenced) | Images inspected | Used for |
|---|---|---|
| `for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-body-tattoos.md` (no author metadata) | `.gitbook/assets/image (261).png` (the template `.app`: 24 tone appearances, `entGarmentSkinnedMeshComponent`), `ccxl_tattoo_mesh_file.png` (nameless switcher, link `body_tattoo`) | CCXL additions to the vanilla row |
| `…/archivexl-character-creator-additions/README.md` (manavortex and redacted-c01; last edited by icxrus) | – | Vanilla switcher slots; community tattoo rows 3300–3309 |
| `…/archivexl-character-creator-additions/ccxl-creating-a-switcher.md` (original author unresolved; edited by icxrus) | – | Tattoo rows beside the vanilla ones |
| `modding-guides/npcs/custom-tattoos-and-scars/converting-between-tattoo-frameworks/README.md` (manavortex; overhaul and images by LadyLea; UV framework section last edited by AllKnowingLion) | `ORIGINAL - UV LAYOUT - FEMALE - BY LL.png`, `ORIGINAL - UV LAYOUT - ALL IN ONE PLACE - LEFT&RIGHT ARMS.png`, `KSUV - UV FULL BODY LAYOUT - FEM - BY LL.png` | Vanilla and framework UV layouts, framework paths and differences |
| `…/converting-between-tattoo-frameworks/overlay-list.md` (no author metadata) | – | Overlay file names and project prefixes per framework |
| `modding-guides/npcs/custom-tattoos-and-scars/how-to-create-an-overlay-tattoo.md` (Yggnire; edited by manavortex) | – | Overlay workflow; the 2048² advice |
| `…/how-to-import-a-custom-tattoo-replacer-back-into-the-game.md` (Halk, imported with permission) | – | Same-path replacement of vanilla tattoo textures |
| `…/merging-existing-tattoos/README.md` (manavortex, initial guide by Yggnire; edited by YoursTrulyBilly) and `merging-existing-tattoos-into-a-clean-template.md` (YoursTrulyBilly) | – | Overlays are hard-coded single files; merging by hand |
| `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md` (manavortex; updated by nutboy) and `cheat-sheet-body.md` (manavortex) | – | Body tattoo names, meshes and chest sizes |
| `for-mod-creators-theory/core-mods-explained/archivexl/archivexl-tags.md` | – | Custom tags; the VTK seam-fix tag |

**Installed mods inspected** (metadata and file lists only; the Sandevistan inkcc, one `.app`, two meshes and three `.mi` serialised with WolvenKit 9.0.1 into the scratch folder; no texture read):

| Mod (Nexus id, installed version) | State in the reference profile | What it showed |
|---|---|---|
| -KS- UV Texture Framework (3783, 4.1) | Enabled | `!!!_UV4.xl` (SHA-256 `34c90a065970e9d2…`) patches body, feet, FPP torso and head meshes with donor meshes on a player-only skin chain; overlay, glow and overlay-normal paths |
| Sun Moon And Stars Tattoo (25250, 1.0) | Enabled | Ships `fullbody_overlay_d01.xbm` (8192²) and the body roughness map (archive SHA-256 `c33141c76ac80396…`) |
| Sandevistan CCXL Tattoo (20345, 2.0; SEDTH per its file names) | Disabled | Own row, one choice per body, garment decal meshes for head and body with full surface writes (archive `a9f9bb7664ca7dd5…`, `.xl` `d85e01612fbe238e…`) |
| Photon Spine Cyberware (26973), Serpentine Heart (24813) and Remix (24816), Graceful Tattoo (25868), Brooke Candy Inspired (22245), Floral Themed (16394), Deej's Mandala Geometry (24226), Bedellia bad girl (5107), Bedellia Geometric (24252) | Disabled | Each ships the KS UV body overlay path, some also the head overlay, the body or head roughness map, the glow overlay or the overlay normal |
| Watson Tattoo Shops (23896, 1.2) | Enabled | Two shop interiors and a chair that opens character customisation |

**Corrections made to other pages in the same checkpoint.** The body's `base\4k\common\…` skin and overlay paths, earlier described as vanilla, are the KS UV framework's player-only chain on the reference install; the vanilla chain uses `base\characters\common\base_bodies\woman_average\textures\t0_000_wa__c_base_d02.xbm` and has no `SecondaryAlbedo` ([V's body §2](../../knowledge/body-rendering.md#2-skin-one-skin-model-for-the-head-and-the-body), [skin reference](../materials/shader-skin.md)). The facial-tattoo tone instances set alpha 0.6 on every tone read; the 0.7 comes from local overrides on meshes 06–10 ([head CC rendering §1](../../knowledge/head-cc-rendering.md#1-every-head-option-at-a-glance)).

## Related

[Tattoos](../../knowledge/tattoos.md) · [V's body](../../knowledge/body-rendering.md) · [Face makeup](../../knowledge/face-makeup.md) · [Worn clothing](../../knowledge/clothing.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [Brows and cheeks brief](../backlog/brows-and-cheeks-brief.md) · [Expressions and idles brief](../backlog/expressions-and-idles-brief.md)
