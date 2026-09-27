# Nail Salon: design for discussion

**Status:** design for discussion, 27 September 2026; nothing built. "Discuss before building later features" applies: this page proposes a model, an editor, a material, a preview, an export and phases, with questions for the maintainer. The shared vector features it needs (text, gradients, strokes, compound shapes, the mottle effect) are designed once, for eye makeup, nails and later tattoos, in [vector engine extensions](../authoring/vector-engine-extensions.md).

It builds on the [feature-module platform](../authoring/feature-module-platform.md), the [selectors design](../authoring/selectors-design.md), the [layered-makeup engine](../../projects/xf-studio/authoring/src/engines/layered-makeup/) and the game facts in [V's body](../../knowledge/body-rendering.md) and the [CC file chain](../../knowledge/cc-file-chain.md). Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** engine, framework or tool source; **[resource]** extracted game or mod resources; **[wiki]** Modding Docs; **[runtime]** the running game; **[hypothesis]** not yet established. Nothing on this page has runtime evidence.

## Contents

- [0. Summary](#0-summary)
- [1. Game side: how V's nails work](#1-game-side-how-vs-nails-work)
- [2. What an XF export is](#2-what-an-xf-export-is)
- [3. The editor](#3-the-editor)
- [4. Material and finishes](#4-material-and-finishes)
- [5. Preview on V's hands](#5-preview-on-vs-hands)
- [6. Export pipeline](#6-export-pipeline)
- [7. Phases and effort](#7-phases-and-effort)
- [8. Risks](#8-risks)
- [9. In-game checks to batch](#9-in-game-checks-to-batch)
- [10. Questions, with proposed defaults](#10-questions-with-proposed-defaults)
- [11. Evidence and provenance](#11-evidence-and-provenance)

## 0. Summary

**The request (maintainer, 27 September).** A "nano Illustrator" for nails: just enough vector freedom to be creative. Shapes drawn with Bézier curves as in eye makeup (stars, hearts, butterflies); **editable text** that the player types, with font, size, spacing, alignment and layout (along a path, across the nails) and the same fills, strokes and effects as any shape; solid or gradient fills with colour and opacity stops; strokes with per-point caps, before and after segment styles, alignment and feather; and a nail-polish material with finishes that are normal for nails.

**Game side in one paragraph.** Each hand's nails are one skinned mesh with a length morph, drawn by the `nails_color` creator row (54 choices, a colour grid) that selects a mesh appearance by name on both hands' meshes [resource]. The five nails of a hand are five separate UV islands, and **both hands share one UV layout** (the right hand's islands have exactly the left hand's UV bounds) [resource, §1.3]. Plain colours are `skin.mt` with a tint; the 45 `__multilayer` designs are separate material instances [resource]. Mods change nails in three ways: replace the vanilla nail meshes (Unique Nails For V), patch new mesh appearances into them with ArchiveXL (North Oak Nail Spa), or add wearable nail items that hide V's own (North Oak, NC Nails) [resource].

**The proposal in one paragraph.**

- A **Nails** selector type that adds the player's looks as extra swatches at the end of the game's **Nails colour grid** (the selectors design's slot-overlay shape, as proposed for hair colours).
- The creator's `nails_color` link carries a choice to first-person and arm-cyberware nails.
- Each look becomes one new mesh appearance, `xfs_n<look>`, patched into every nail mesh the resolver finds, **one material per hand**. The hands can differ ("S C R E W" on the left, "C O R P S" on the right) because the left and right meshes are separate resources.
- The material is `metal_base.remt`, which vanilla already uses for the Mantis Blades' nails [resource]: per-texel colour, roughness, metalness and normal carry every nail finish.
- The editor is a **nail board**: ten nail tiles drawn upright in millimetres, hand strips for designs that span nails, hand modes (same, mirrored, independent), and snapping to each nail's outline.
- The preview draws the compiled maps on V's own nails, with a **Hands** camera that frames them as the creator's nails page does.

**Plan.** About 32–40 agent-days for the nail feature (N0–N6), after or beside about 20–26 days of shared vector work (V1–V4). One offline fact-finding phase and one in-game probe come first (§7).

## 1. Game side: how V's nails work

### 1.1 Creator rows and resources [resource]

| Fact | Evidence |
|---|---|
| The nails are the arms part's `nails_color` row: `nails_color_tpp` (54 colour definitions, `useThumbnails`, link `nails_color`) with the followers `nails_color_fpp` and the launcher and Mantis Blades variants, plus the length morphs `nails_l` / `nails_r` (link `nails_size`) | [CC file chain §4](../../knowledge/cc-file-chain.md#4-every-cc-detail-and-what-drives-it), [V's body §1](../../knowledge/body-rendering.md#1-which-parts-make-the-third-person-body) |
| The colour option lives in the holster groups (`holstered_default_tpp` and the other states), the morphs in the `nails` group | [V's body §1](../../knowledge/body-rendering.md#1-which-parts-make-the-third-person-body) |
| `a0_000_base__nails.app` has 116 appearances, one per body gender and choice: `a0_000_pwa_base__nails_<choice>` (female) and `…_pma_…` (male). Each has **two components**, `a0_000_pwa_base_nails_l` and `…_r` (`entMorphTargetSkinnedMeshComponent`), on `…\arms_hq\nails\a0_000_pwa_base__nails_l.morphtarget` / `…_r.morphtarget`, with the **same `meshAppearance` on both hands** (`beige`, `01_red_heart__multilayer`, `03_arasaka__multilayer`, …) | `research/consumers/cc-file-chain/json/chain/a0_000_base__nails.app.json` |
| Other nail apps: `a0_000_fpp__nails.app` (first person), `…\arms\mantisblade\a0_000_unholstered_mantisblade__nails.app`, `…\arms\launcher\a0_000_unholstered_launcher__nails.app` | Resolver cache (§11) |
| Other nail meshes, each with a `_long` twin: first-person `…\fpp\a0_000_pwa_fpp__nails_l/_r.mesh`; `a0_003_wa__mantisblade_nails_l/_r.mesh`; `a0_006_wa__launcher_nails_l/_r.mesh`; and `…\arms_hq\nails\a0_000_pwa_base__nails_l_long.mesh` / `_r_long.mesh` | North Oak Nail Spa's `.archive.xl` patch list; resolver cache |
| ArchiveXL reads V's nail colour from the nails component's appearance name and exposes it as the `{nails_color}` substitution for garments (components `a0_000_pwa_base_nails_l`, `a0_000_pwa_fpp__nails_l`, `a0_000_pma_base__nails_l`; the Mantis group's `u_mantise_nails_color` option as a fallback) | [source] ArchiveXL 1.27.3 `src/App/Extensions/Garment/Dynamic.cpp` |
| The creator's nails page uses the camera slot `UI_FingerNails` (height 1.45 m, zoom 2.2) and selects the `ui_expose_hand` clip | [creator lighting](../../knowledge/creator-lighting.md), [facial expressions §5](../../knowledge/facial-expressions.md#5-the-character-creator-idle) |

### 1.2 Materials [resource]

The female base nail mesh (`a0_000_pwa_base__nails_l.mesh`, `basegame_4_appearance.archive`) has 59 appearances, one chunk each, with local material instances:

| Choices | Material chain | What it means |
|---|---|---|
| `beige`, `beige_dark`, `gray_light`, `checker`, `dots_01` | `female_nails_<name>.mi` → `__parameters\default_nails__parameters.mi` → `base\materials\skin.mt`, with shared nail albedo, normal and roughness maps (`…\man_average\textures\arms_hq\nails\an_000_ma__c_base_d01/n01/rm01.xbm`) and a `TintColor`/`TintScale` (beige: 179 grey, 0.25) | Natural nails are skin: tone tint and subsurface |
| 45 `…__multilayer` designs, including `03_arasaka` and `02_valentinos` gang designs | `female_nails_<design>.mi` (one per design) | Base template not read yet; the Studio already draws them with its layered adapter ([V's body §4](../../knowledge/body-rendering.md#4-how-the-studio-draws-the-body)), so `multilayered.mt` is likely [hypothesis until read in N0] |
| `holo_nails_right` | `female_nails_holo.mi` | Template not read; the name suggests a hologram shader (a projected sci-fi nail, not holographic polish) [hypothesis] |

Unique Nails For V replaces the same mesh at the same depot path: 39 appearances keep the vanilla names but point at the framework's material instances, which are `default_nails__parameters.mi` (so `skin.mt`) with only the `Albedo` replaced (`base\unique_nails_framework\textures\nails_NN_d01.xbm`), with **separate instances for the left and right hands** (`material_instances\left\…`, `…\right\…`). Other mods then replace the framework's textures. It is an old-school replacer, like PRC for piercings: it shows that a nail design can be just an albedo on the nail's own UVs, and that per-hand materials are normal. It is not a route we follow.

### 1.3 UVs: five islands per hand, one layout for both hands [resource]

Read from the preview cache's WolvenKit exports of the two hands' effective nail morph targets on the reference profile (the morph target resources come from a nails morph mod, so their embedded geometry is that mod's; the vanilla meshes' own UVs are to be confirmed in N0):

| Island | UV bounds (left hand) | Right hand | Note |
|---|---|---|---|
| 1 | u 0.007–0.230, v 0.503–0.741 | identical | |
| 2 | u 0.161–0.406, v 0.700–0.991 | identical | |
| 3 | u 0.290–0.616, v 0.333–0.666 | identical | The largest island (about 24 mm of extent): the thumb [hypothesis] |
| 4 | u 0.427–0.707, v 0.677–0.985 | identical | |
| 5 | u 0.719–0.984, v 0.688–0.986 | identical | |
| 6–10 | the same five shapes at u + 1 (u 1.02–1.97) | identical | A second shell per nail whose average normal points the other way (the underside or free edge); with wrap sampling it reads about the same texels as the top [hypothesis] |

Each hand's mesh has 1,120 vertices, 1,972 triangles, one primitive, `TEXCOORD_0` and `TEXCOORD_1`, and one morph target (`…_nails_l_nails_l`; empty in this mod's copy). Consequences:

- **One texture paints the same art on both hands**, each nail on its counterpart. Different art per hand needs one material per hand, which is possible because the hands are different mesh resources (Unique Nails does exactly this).
- **Per-nail canvases are natural.** Each island is one nail. The editor can show each nail upright in millimetres through a per-island frame (§3.1), and clip everything to its island.
- **Texel density.** An island spans about 0.22–0.33 of the texture's width for a 10–15 mm nail. At 512² that is about 0.09 mm per texel, finer than the eye plate's 0.13 mm; at 1024², about 0.045 mm.
- **Which island is which finger**, and which shell is the top, come from the geometry and the rig in N0 (nearest finger joints, normal against the back of the hand). They are data, derived per mesh, never a hard-coded table.

### 1.4 How nail mods add designs [resource]

| Route | Example | What it ships | Additive? |
|---|---|---|---|
| **Replace the nail meshes** | Unique Nails For V (Nexus 10420, one archive) | The vanilla nail mesh at its vanilla path, remapped to the framework's materials | No: it replaces the vanilla file, and the last archive wins |
| **Patch new appearances into the nail meshes** | North Oak Nail Spa (Nexus 24993) | ArchiveXL `resource.patch`: one `manicure_materials.mesh` patched into 16 nail meshes (base, long, Mantis, launcher and first-person, each hand) | Yes: new appearance names added to whatever mesh wins |
| **Wearable nail items** | North Oak Nail Spa, NC Nails Pedicure (Nexus 7084) | TweakXL clothing items (`Items.GenericLegClothing`, Virtual Atelier stores), their own meshes, and an ArchiveXL tag (`lw_hide_basegame_nails`) that hides every vanilla nail component while worn | Yes, but it is clothing, not a creator choice |
| **Reshape the nails** | Cute Nails - Base Game Nails Morph (Nexus 21113) | Replacement nail morph targets | No (a shape replacer); a look must still fit it |

The generic resolver already reads all of these the way the game does: a replacer by archive precedence, a patch by ArchiveXL's patch rules, a tag by the clothing rules ([V's body §4](../../knowledge/body-rendering.md#4-how-the-studio-draws-the-body)). No nails mod is named in Studio code.

## 2. What an XF export is

### 2.1 Choice: extra swatches in the game's Nails row

Nail polish is one choice at a time, as the game's own row is. The selectors rule applies ("a feature gets its own selector only where that's genuinely the best option; otherwise its looks are contributed as extra choices to the matching vanilla option set"). So the proposal is:

**The Nails selector type: vanilla row `nails_color`, slot-overlay shape, cap 1.**

| Part | Emitted | Evidence |
|---|---|---|
| Creator entries | One anonymous appearance option per nail slot found in the merged catalogue: `nails_color` and every follower that carries the vanilla nail definitions (discovered, not named: base, first person, Mantis Blades, launcher). Each lists the selector's looks as definitions `xfs_n<look-uuid>`, appended in the same order, with a `color` swatch | The slot-overlay shape of the [selectors design](../authoring/selectors-design.md#22-how-a-selector-reaches-a-vanilla-row-three-shapes) and the [hair colour export](../hair/hair-colour-authoring-feasibility.md#3-what-an-xf-export-would-emit) |
| Appearances | A `patch.app` with one appearance `xfs_n<look>` per look, patched into each nail `.app`. Its components are copies of the vanilla appearance's components (same names, morph targets and chunk masks), with `meshAppearance` `xfs_n<look>` | ArchiveXL patches `.app` `appearances` [source: `ResourcePatch/Extension.cpp`, `OnAppearanceResourceLoad`] |
| Mesh appearances | Two patch meshes, `patch_l.mesh` and `patch_r.mesh`, each holding `xfs_n<look>` with that hand's material, patched into every left-hand and every right-hand nail mesh the resolver finds | North Oak's patch of a materials mesh into the 16 nail meshes [resource] |
| Materials | Per look and hand, one `metal_base.remt` instance (§4) with that hand's maps; hands in "same" mode share textures | Vanilla Mantis nails use `metal_base` [resource] |
| Label | Look names as plain `localizedName`, as in the hair export | [hair colour §3.3](../hair/hair-colour-authoring-feasibility.md#33-swatch-and-label) |

Why this route:

- It stays inside the creator's own row, so the player finds XF nails where nails are.
- The `nails_color` link carries the choice to first person (seen constantly in gameplay) and to the arm-cyberware nails, provided our definitions sit at the same index in every follower (risk R2).
- It adds only new-named appearances. Under Unique Nails or any other replacer, the patch lands on whichever mesh wins [hypothesis: ArchiveXL patches the loaded resource whatever its archive; §9 check NS2].
- Nothing replaces a vanilla or third-party file.

**Tension with the selectors design.** Its §2.3 says "we never use `resource.patch` on vanilla resources", while its slot-overlay shape (hair colours) patches new-named appearances into vanilla meshes, which the hair study's additive audit allows. This design follows the hair precedent and extends it to `.app` patches (question Q3).

**Rejected or deferred routes.**

- **An own XF row** would draw a second nail mesh over V's own. Coincident geometry breaks up, as the eye plate did at 0 mm. It would only work as a lifted decal shell, which is route B below.
- **Route B, a nail-art overlay** (later, optional): an own row whose look is a decal shell lifted 0.1–0.4 mm off the nails like the eye plate, drawn over whatever polish V wears, with the eye makeup's decal routes (including Colour-shifting). It needs our own copies of the nail geometry per holster state and perspective, with the length morph carried over. It is worth doing only if players want art over vanilla colours (question Q5).
- **Wearable nail items** are clothing, not creator choices, and need Virtual Atelier or similar. That is out of scope.

### 2.2 Names and identity

Per the [naming contract](../../projects/xf-studio/data/naming.md) and [selectors §1.5](../authoring/selectors-design.md#15-identity):

- Definition, `.app` appearance and mesh appearance: `xfs_n<look-uuid-without-hyphens>`. It never contains `__`, never matches the vanilla `NN_` shape, and cannot collide.
- Depot folder: `axefrog\appearance_studio\selectors\<selector-uuid>\`. Textures `xfs_n<look>_<hand>_<map>.xbm`, materials `xfs_n<look>_<hand>.mi`.
- Default mod name **"XF Nail Artistry"** when split out; in the default merged product it joins "XF Looks" (question Q1). "XF Salon" is already the working name of an in-game site idea in the [world ideas](../backlog/world-and-interactive-ideas.md), so it is avoided here.
- The Studio module is **Nail Salon**.

## 3. The editor

### 3.1 Canvases: nail, hand strip, both hands

A look holds two **hands**, L and R. Each hand holds five **nail slots**, derived per mesh from its UV islands in N0: island, finger, the top shell, and a frame. The frame maps nail-local millimetres to UV:

- `s` runs across the nail and `t` from cuticle to tip, both in millimetres on the surface;
- it is a least-squares affine fit of the island's UV against its surface positions, the same derivative the eye editor uses for [projected tangents](../authoring/projected-tangent-controls.md);
- a 2 mm heart is therefore 2 mm on every nail, even though the thumb's island has a different UV scale.

Layers are authored in one of three **spaces** (the vector engine's surface spaces; [extensions §2](../authoring/vector-engine-extensions.md#2-surface-spaces-where-a-shape-lives)):

| Space | Canvas | Use |
|---|---|---|
| **Nail** | One nail, upright, its outline drawn from the island boundary | A design on one nail, or repeated on chosen nails ("a star on each ring finger") |
| **Every nail** | A normalised nail (0–1 across, 0–1 cuticle to tip), applied to each chosen nail through its own frame | French tips, ombré, a heart centred on every nail, patterns |
| **Hand strip** | The five nails of a hand laid out side by side, in the order they read with the back of the hand to the viewer, with real gaps between them | Text or a shape that runs across nails and is cut by the gaps |

The **nail board** is the main 2D view, the nails' equivalent of the UV map. It shows the ten nails as upright tiles in two rows (left hand, right hand), back of hand to the viewer. A strip layer is drawn across its hand's tiles, and a selected layer highlights the nails it reaches. The 3D view edits on the nails too, through the same surface-editing rules as the eye plate. A layer lives in one space; "Move to space" converts it without changing what it looks like.

### 3.2 Hands and mirroring

| Hand mode | Right hand | Default |
|---|---|---|
| **Same** | Each nail gets the left hand's art for the matching finger, unmirrored (text reads correctly). The two materials share textures | Yes |
| **Mirrored** | The left hand's art reflected across each nail's centre line, as the hands are reflections of each other. Text layers stay unmirrored unless asked | |
| **Independent** | Its own layers ("S C R E W" left, "C O R P S" right) | |

A layer can also be marked "both hands" in independent mode, for a shared base coat under per-hand text. Hand mode is part of the look and is stored.

### 3.3 Text across nails

Text is the shared text shape ([extensions §3](../authoring/vector-engine-extensions.md#3-text-shapes)): the player types any text and chooses font, size, tracking, alignment and layout, with fills, strokes and effects like any shape. Nails add one layout, **slots**:

- **One cluster per nail**: each grapheme cluster, or a word split by a chosen separator, is centred on the next nail in reading order. Spaces are dropped, so "S C R E W" and "SCREW" give the same result. The size fits the smallest nail unless it is set. Overflow is reported ("7 letters, 5 nails: the last 2 aren't shown").
- **Continuous**: the text is laid out on the hand strip and cut by the gaps, like a banner.
- **Along a path** on one nail or on the strip, as for any text.

Rotation follows each nail's axis by default (upright letters on every finger); "Keep horizontal" is an option. The thumb, whose nail faces sideways, is included in the order by default and can be skipped.

### 3.4 Snapping and nail-aware tools

- **Snap to nail**: points snap to the island outline, to its cuticle and tip ends, to the centre line and to a proportional grid (thirds, the classic French-tip line). The snap targets are the nail frame's features, so they are the same on every finger.
- **Fit to nail**: scales a shape or text to the nail's inner margin.
- **Clip**: everything is clipped to its island, and export pads each island by dilation so mips don't bleed the gap colour.
- **Nail shape presets** (square, round, almond, stiletto) are **not** geometry changes: the game's nail shape is the mesh or a morph mod's. They are guide overlays for designs that follow a shape (question Q7).
- The shared **shape library**: star, heart, butterfly, lightning, flame, drop, sparkle, all authored as editable Bézier compound shapes. It serves eye makeup too.

### 3.5 Presets panel, looks and the reactive graph

A look (a preset) holds one `xfs/nails-part-1`: its hand mode, its layers per hand and space, its finish settings, and a stored reference to the mesh identity it was authored on (§8, R4). As the selectors design requires, the Nails selector is a document node. Its worn look feeds, all derived and none written:

- the nail renderer's maps (§5);
- the Character panel's Nails row, which shows "XF: <look>";
- the swatch colour;
- the export plan.

Text layout, glyph outlines, nail frames and per-hand rasters are memoised derived nodes, never stored.

## 4. Material and finishes

### 4.1 Template

**`metal_base.remt`**, one instance per look and hand:

- `BaseColor` (RGB) with `BaseColorScale`;
- `Metalness` and `Roughness` (the R channel each) with scale and bias;
- `Normal` (RG) with `NormalStrength`;
- the emissive group, unused for now.

It is opaque, Standard class and lit like every Standard pixel ([metal and glass reference §3](../materials/shader-metal-glass.md#3-metal_baseremt)) [source-level observation]. Vanilla uses it for the Mantis Blades' nails [resource].

- A map that is constant over the whole look is not shipped: the default white or black texture with scale and bias gives the constant. A crème look is then just one colour map per hand.
- **Natural nail showing through.** Negative space, French tips and sheer finishes need the bare nail under the polish. Build bakes it from the player's own game files: the vanilla nail albedo with the natural tint the player chose. This is the same principle as the eye plate, which is cut from the player's own head. The bare nail then draws Standard rather than `skin.mt`, so it loses its slight subsurface glow [hypothesis: small at nail scale].
- **Alternatives considered.** `skin.mt` with an albedo (Unique Nails' route) cannot vary gloss, metal or normals. Plain `multilayered.mt` (vanilla designs) needs an `.mlsetup` and `.mlmask` writer and limits colours to its templates; it gains nothing over baked maps for a single surface ([multilayered §8](../materials/shader-multilayered.md#8-what-this-means-for-makeup-on-a-face-plate)). **`multilayered_clear_coat.mt`** is the one real upgrade: a genuine top-coat lobe over a glitter or cat-eye base. It is a later phase (N7) once the Studio has a clear-coat adapter.

### 4.2 Finish taxonomy for nails

Like the [makeup finish taxonomy](../materials/makeup-finish-taxonomy.md): practical families, defined by their intended look and checked against brand and trade references. Names overlap between brands. **Finish** (the surface optics) is kept separate from **design** (French, ombré, nail art) and **formula** (lacquer, gel, dip).

| Family | Intended look | `metal_base` bake | Preview | Honest limit |
|---|---|---|---|---|
| **Crème** | Opaque, even colour, no particles, glossy top coat | Colour; roughness about 0.15; metalness 0 | Same values | The default |
| **Gloss** (high-shine / gel) | Crème with a wetter, mirror-like shine | Roughness about 0.06 | Same | One lobe; no separate coat until N7 |
| **Matte** | Velvety, no shine | Roughness about 0.85–1.0 | Same | |
| **Satin** | Soft sheen between matte and gloss | Roughness about 0.4 | Same | Mirrors eye makeup's Satin |
| **Shimmer / pearl** | Fine particles giving a soft, moving sparkle | Shimmer facet normal map composed with the nail's own normal, variance-widened roughness mips: the eye makeup's faceted route ([shimmer design](../materials/finish-designs/shimmer.md)) at nail texel density | Same bake | Sub-texel sparkle averages out at distance |
| **Metallic / chrome** | Metallic: foil-like continuous reflection. Chrome: a mirror (powder burnished over gel) | Metallic: metalness 0.8–1, roughness 0.25. Chrome: metalness 1, roughness about 0.05, the colour as F0 tint | Same | Chrome reflects whatever the scene's probes hold; it reads grey in flat lighting (as in game) |
| **Glitter** | Individually visible flecks, often in a clear or tinted base | Flake cells baked as per-texel facets (normal, metalness, roughness) at the nail's fine density, 0.3–1 mm flecks | Same bake | Visible flecks are feasible here, unlike on the eye plate: a nail texel is about 0.09 mm, so a 0.5 mm fleck is several texels. The Glitter guard is unchanged for eye makeup |
| **Holographic** (linear or scattered) | Rainbow prism that moves with the light; linear holo shows a smooth rainbow band, scattered holo a sparkle of colours | Faceted normals whose facet orientation also selects a baked **hue** per facet: colour, metalness about 0.9, roughness about 0.15 | Same bake | **Approximation**: the game has no spectral or view-dependent colour on `metal_base`. The rainbow is fixed in the texture; its sparkle moves with the light, its colours don't. Labelled "Holographic (approximation)" until checked in game |
| **Cat-eye / magnetic** | A glowing stripe of aligned particles across the nail that shifts with angle | Facets aligned to a user-placed **band** (position, width, angle, softness per nail; "same line on every nail" by default), strongly metallic and smooth inside the band, over a darker base | Same bake | The band's highlight moves with light and view through the facet normals, which is the real mechanism; how strongly it reads in game is check NS5 |
| **Jelly / sheer** | Translucent, glassy colour through which the nail shows | Colour composited over the baked natural nail at the chosen sheerness, glossy roughness, a slight darkening at the free edge | Same | No real depth or light transmission: an opaque bake of the translucent look |

**Modifiers**, not families:

- **Top coat**: gloss, matte or none over any family. It changes roughness only until N7 brings a real coat.
- **Glow**: an emissive colour, a cyberpunk extra and not a cosmetic finish. It uses `metal_base`'s emissive group and needs its own check (question Q6).

**Layer finishes.** One look is one material per hand, and per-texel maps allow mixed finishes: a crème base, a chrome French tip and glitter text on one nail. The layer stack flattens per texel in the compiler, like the eye makeup's flat and faceted routes. Only two finishes can't be mixed freely: holographic and cat-eye each own the normal map where they are, so the topmost faceted layer wins at a texel. The editor says so.

**Validation.** Each family gets a reference sheet before its preview model is called matched: brand and trade pages (§11) for the intended look, and in-game captures of the finish board (check NS5) for the result. The values above are starting points, not measurements.

## 5. Preview on V's hands

- **Nail renderer.** A layered-surface renderer on the nail meshes the resolver already delivers (the body slot's nail components). It supersedes V's own nail choice while an XF look is worn, as lip makeup would supersede V's own lips decal ([platform §9](../authoring/feature-module-platform.md#9-how-module-2-plugs-in)). It draws the compiled maps per hand through a **`metal_base` preview adapter**, which the Studio doesn't have yet; it is item 1 of the [metal and glass adapters](../materials/shader-metal-glass.md#7-recommended-preview-adapters-ranked) and also unlocks the Mantis nails and cyberware decals.
- **Maps are the export's maps.** The preview uploads what Build would compile, at the preview's resolution, so the preview never shows a look the export can't make.
- **Hands camera.** A view tool, "Hands", frames both hands at the creator's nails distance (slot `UI_FingerNails`: 1.45 m, zoom 2.2 [resource]). A "Hands up" pose option plays the creator's `ui_expose_hand` clip once decoded, **named as the game's clip** and never faked. If it has no body tracks (N0 checks), a plain hands-forward pose is offered and labelled "posed by XF Studio", not "the game's". The camera orbit is limited to the hands' neighbourhood.
- **Skinned nails.** The reference profile's nails from a morph mod export without skin and move rigidly ([V's body, open question 5](../../knowledge/body-rendering.md#open-questions)). A close-up makes that visible, so N3 fixes the export or binds each nail island to its finger's distal joint (islands are per finger, §1.3).
- **Nail board ↔ 3D.** Hovering a tile highlights that nail in 3D and the reverse. Surface editing on the nails uses the eye plate's rules (front-facing, occlusion, one Undo per gesture).
- **First person.** A "first-person hands" framing is a later nicety; the first-person meshes are exported and verified in Build anyway.

## 6. Export pipeline

The [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md) and its diagrams are updated, with visual review, in the checkpoint that builds N5, not by this design.

1. **Eligibility** per look: every layer compiles; text layers need their font available with a matching hash; a layer beyond a supported finish is omitted with a plain reason (partial export).
2. **Discovery** (Check, from the merged catalogue and the resolver):
   - the nail slots, meaning the options carrying the vanilla nail definitions, and their definition counts (R2);
   - the nail `.app`s those options name;
   - every nail mesh those apps reach, per hand, with its UV layout hash.

   A mesh whose layout differs from the authored one is reported (for example, a morph mod's reshaped nails).
3. **Compile** per look and hand: flatten the layers into `BaseColor`, `Roughness`, `Metalness` and `Normal` over the island canvases (512² default, 1024² for fine text; question Q8). Build then:
   - bakes the natural nail under uncovered texels;
   - dilates each island;
   - builds mips (variance-widened roughness mips for faceted finishes, as the shimmer route does);
   - drops constant maps;
   - shares textures between hands in "same" mode.
4. **Resources**: the §2.1 table, plus a swatch colour per look (the look's mean visible colour). Icon swatches (TweakXL and an `.inkatlas`) follow the [choice icons](../character-customization/choice-icons-design.md) route as an option.
5. **Verification** (independent of the exporter):
   - every definition has an `.app` appearance, and every `.app` appearance a mesh appearance in both hands' patch meshes;
   - every material names existing textures;
   - definitions sit at the same index in every discovered nail slot;
   - no name exists in the merged catalogue;
   - the resolver, reading the built archive like any installed mod, resolves each look on the base, long, first-person and cyberware meshes.
6. **Manifest**: selector, looks, hands, finishes, omissions, maps and sizes.

**Budget.** 512² per map is about 0.35 MB with mips (BC7 colour) or 0.18 MB (BC4 roughness or metalness). A crème look in "same" mode is about 0.35 MB; the worst case (four maps, two hands, 1024²) is about 8 MB. Check reports the product's total.

## 7. Phases and effort

Effort in agent-days. The V phases are shared ([extensions §9](../authoring/vector-engine-extensions.md#9-phases-and-effort)); nails need V1 and V3 for their core and V2 for strokes.

| # | Phase | Scope | Gates | Effort |
|---|---|---|---|---|
| N0 | Offline facts | Vanilla nail meshes' UVs (base, long, first person, cyberware, male); finger and top-shell mapping from the rig; the `…__multilayer` and holo templates; definition counts of every nail slot; how the `nails_l`/`_r` morph applies to patched appearances; whether `ui_expose_hand` moves the body. Output: `knowledge/nails.md` | Every fact graded; the per-mesh slot derivation as a pure function with tests on the cached meshes | 3 |
| N1 | In-game probe | Hand-made archive through the proposed route: two looks (a `metal_base` crème, and a test pattern with the finger number and L/R on each nail) | Checks NS1–NS4 | 2 + session |
| N2 | Nail feature module | `LayeredMakeupRegion` generalised to surface spaces (extensions §2); nails region with slots and hands; `xfs/nails-part-1`; nail board; hand modes; snapping; slot text layout | Pure tests for frames, slots and hand modes; `?verify=1` authoring of "S C R E W"/"C O R P S" | 7 |
| N3 | Preview on hands | `metal_base` adapter; nail renderer with supersede; Hands camera and pose; skinned-nail fix | Adapter parity with the compiler's maps; `?verify=1` close-ups | 5 |
| N4 | Finishes | Nail finish catalogue; facet bakes for shimmer, glitter, holographic and cat-eye; natural-nail bake; top-coat modifier | Bake determinism; reference sheets per family | 6 |
| N5 | Export | Nails selector type (slot overlay, cap 1); discovery; compile; patch `.app`/`.mesh`; materials; swatches; verifier; manifest; pipeline doc and diagrams | Offline verification on the reference profile and on a vanilla-only profile; byte-identical rebuild | 7 |
| N6 | Finish board and session | A nail finish board (every family, both hands, one light) and calibration | Check NS5; values recorded as runtime evidence | 2 + session |
| N7 | Later | Clear-coat route; route B overlay; icon swatches; male V; pedicure (toenail meshes) | Discuss first | — |

**N0–N6: about 32 days** (range 32–40), plus two sessions. N0 and N1 can start now. N2 needs the view graph's module work and selector S1; N5 needs S3 and S6.

## 8. Risks

| Risk | Mitigation |
|---|---|
| R1. ArchiveXL's `.app` patch doesn't make a patched appearance selectable by a creator definition, or the nails controller ignores it | NS1 before any product work; fallback: route B (own row) |
| R2. Nail followers (first person, Mantis Blades, launcher) have different definition counts, so the link lands on a wrong index | N0 counts them; the verifier refuses misaligned slots; fallback: first-person and cyberware slots get their own XF entries, which need no link |
| R3. The Mantis and launcher nails use other materials or UVs | N0; omit those states with a plain note until supported |
| R4. A nails morph mod or replacer changes the UVs, so a design lands wrongly | The UV layout hash per mesh in Check; a mismatch is a plain warning naming the effect, not the mod |
| R5. Chrome, holographic and cat-eye read weakly or wrongly under game lighting | Labelled approximations; NS5 before calling them matched |
| R6. Skinless morph-mod nails and the rigid preview | N3 fix; until then the Hands view says why the nails don't bend |
| R7. Size creep with many looks at 1024² | 512² default, constant maps dropped, shared hands, the total shown in Check |

## 9. In-game checks to batch

| # | Check | Expected | Settles |
|---|---|---|---|
| NS1 | Creator nails page with the N1 probe: find the two XF swatches at the end of the Nails grid; choose each, then a vanilla colour, then XF again; save, reload, mirror | Both looks shown on both hands; switching and saves persist | R1; the route |
| NS2 | The same with Unique Nails For V enabled, and with a nails morph mod | XF looks still draw; with the morph mod, the placement follows its UVs or Check's warning explains why not | Patching the winner; R4 |
| NS3 | Test pattern: read the finger numbers and L/R on each nail; long nails on; first person (look at your hands, draw a weapon); Mantis Blades and launcher equipped | The mapping matches N0; the design follows into first person and cyberware nails | R2, R3; finger mapping |
| NS4 | Photo mode close-up of the hands | Same as the creator | Photo-mode groups |
| NS5 | Finish board (N6) under the creator's light and two gameplay lights | Each family reads as its reference sheet intends; record where it doesn't | Finish values |

## 10. Questions, with proposed defaults

| # | Question | Proposed default |
|---|---|---|
| Q1 | The exported mod's name when split out? | "XF Nail Artistry" (the Studio module stays "Nail Salon"). Merged: part of "XF Looks" |
| Q2 | Where do XF nail looks appear in the creator? | At the end of the game's Nails colour grid (slot overlay), carried to first person and cyberware nails by the game's link |
| Q3 | Accept ArchiveXL `resource.patch` that adds new-named appearances to vanilla nail `.app` and `.mesh` files, as the hair-colour design already does for meshes? | Yes, additive only, verified to add names and replace nothing; and record the exception in the selectors design's §2.3 |
| Q4 | Selector cap? | 1: every look sits in one grid, and a second selector would only split it |
| Q5 | Also offer route B, art overlaid on V's own vanilla nail colour? | Not now; revisit after NS1 |
| Q6 | Include a Glow (emissive) modifier? | Yes, as an extra outside the cosmetic list, after its own check |
| Q7 | Nail shape (square, almond, stiletto): geometry or guides only? | Guides only. Real shape changes are morph-mod territory and a later body-customisation topic |
| Q8 | Texture size per hand? | 512² default (finer than the eye plate); 1024² per look for fine text |
| Q9 | Hand mode default? | Same (right hand repeats the left per finger, unmirrored) |
| Q10 | Does the thumb take a letter in across-nails text? | Yes, in reading order, with "skip thumbs" one click away |
| Q11 | Male V? | Female first, like every feature; male nails after the masculine V plan's body phase |
| Q12 | Pedicure (toenails)? | Later: the feet meshes are a separate surface; the same editor applies |

## 11. Evidence and provenance

- **Game resources** (installed 2.31, read offline): `a0_000_base__nails.app` from `research/consumers/cc-file-chain/`; the female nail mesh and its material instances from the Studio's resolver cache (`basegame_4_appearance.archive`, extracted SHA-256 `e3bccdce…`); the nail morph targets' WolvenKit 9.0.1 exports in the preview cache (the left hand's `export.glb` SHA-256 `3ecb820a…`). The UV analysis is a scratchpad script over those exports; it is not committed.
- **Mods** (reference MO2 profile, read offline): Unique Nails For V - A Framework (Nexus 10420, 1.0.0.0; its replaced mesh SHA-256 `ed582073…`, material instances `base\unique_nails_framework\material_instances\left|right\nails_NN.mi`); North Oak Nail Spa - Pedicures and Nails (Nexus 24993, 1.4.0.0; `luvwich_pedicure_00.archive.xl`); NC Nails - Pedicure for V (Nexus 7084, 1.5.0.0; `NC_Nails_Pedicure_xBaebsae.xl`, its TweakXL YAML); Cute Nails - Base Game Nails Morph (Nexus 21113, 1.2.0.0; the effective nail morph targets). Authorship is on the [provenance follow-ups](../provenance-followups.md).
- **ArchiveXL** 1.27.3 source, commit `5474e34d56112f5d8843ae863e1e72ff510957c0`: `src/App/Extensions/Garment/Dynamic.cpp` (the `nails_color` attribute and components), `src/App/Extensions/ResourcePatch/Extension.cpp` (`.app` appearance patching); no `PlayerCustomization*Nails*` scope exists in `bundle/source/resources/`.
- **Modding Docs** clone at `be2f44eed8419342ec13f72ed9cab008e9f7b289`: `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-arms.md` (Mantis Blades and launcher nail components and their hide tags).
- **Finish references** (the intended looks, 27 September 2026):
  - OPI's [shimmer](https://www.opi.com/collections/shimmer-nail-polish) and [glitter](https://www.opi.com/collections/glitter-nail-polish) collections (crème, shimmer, glitter, matte and sheer vocabulary);
  - ILNP's [My Private Rainbow](https://www.ilnp.com/my-private-rainbow-linear-scattered-holographic-nail-polish-topper/) and [MEGA (L)](https://www.ilnp.com/mega-l-100-pure-linear-holographic-nail-polish/) pages (linear and scattered holographic);
  - Holo Taco's [magnetics](https://www.holotaco.com/pages/magnetics) and Ready Ready's [cat eye explainer](https://www.thereadyready.com/blogs/nail-trends/cat-eye-nails-explained) (aligned magnetic particles and the moving stripe);
  - Beetles' [chrome powder guide](https://www.beetlesgel.com/blogs/guides/chrome-nail-powder) (burnished platelets forming a mirror);
  - Cirque Colors' [jelly guide](https://www.cirquecolors.com/blogs/blog/jelly-is-our-jam) (sheer, buildable, the nail showing through).

  These are vocabulary and intent references, not optical measurements.

## Related

[Vector engine extensions](../authoring/vector-engine-extensions.md) · [Selectors design](../authoring/selectors-design.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [V's body](../../knowledge/body-rendering.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [Makeup finish taxonomy](../materials/makeup-finish-taxonomy.md) · [Metal and glass shaders](../materials/shader-metal-glass.md) · [Multilayered shader](../materials/shader-multilayered.md) · [Hair colour export](../hair/hair-colour-authoring-feasibility.md) · [Tattoos brief](../character-customization/tattoos-brief.md)
