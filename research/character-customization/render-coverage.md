# Character-creator render coverage

**Status: audit, 27 September 2026, of `projects/xf-studio/authoring` at `36b5c87`. Nothing on this page has runtime evidence beyond what the linked knowledge pages mark [runtime].** Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[resource]** extracted game or mod resources, **[source]** engine, framework, tool or Studio source, **[wiki]** Modding Docs, **[runtime]** the running game, **[hypothesis]** not yet established. Provenance is [at the end](#provenance).

This page answers one question for the next build tracks: for every character-creator option, what does the game draw, what does the Studio viewport draw today, how faithfully, and what would closing each gap take? The feminine creator comes first; the masculine creator is covered in [§5](#5-the-masculine-creator). The per-option resources are consolidated in [head CC rendering](../../knowledge/head-cc-rendering.md), [body rendering](../../knowledge/body-rendering.md) and the [CC file chain](../../knowledge/cc-file-chain.md#4-every-cc-detail-and-what-drives-it); this page does not repeat their detail, it scores coverage against them.

## Findings in brief

1. **For a feminine V the Studio already resolves and draws every creator row a player sees on a typical character, except the teeth.** Skin type and tone, all five face-shape regions, eyes, lashes, brows, hair (including the face-cyberware hairstyle twin), every face decal (eye makeup, lipstick in all three finishes, cheeks and freckles, blemishes, scars, facial tattoos, face cyberware), piercings, the body, arms, hands, nails (colour and length), flat feet, breast size, body tattoos and body scars all go through the generic resolver and a material adapter chosen by the template's own name [source].
2. **The teeth are the one feminine head row that resolves but is never drawn.** They are `skin.mt` on a morph-target mesh that follows the `mouth` region, and the face slot deliberately takes only decal templates, so the planner drops them [source: `character-detail-plan.ts` `planChunk`]. They are also a prerequisite of the closed subsurface-scattering gate, which needs the mouth interior present ([ownership gate](../../projects/xf-studio/authoring/evidence/render-fidelity-ownership-gate-2026-09-25.md)).
3. **A masculine V draws nothing.** The resolver, catalogue and planner are gender-neutral, but the core head and a handful of browser gates are feminine ([masculine V plan](male-v-plan.md)). This is the largest gap by absolute impact.
4. **The biggest fidelity gaps on drawn parts are lighting, not selection:** the subsurface stand-in on all skin (decoded down to the kernel, not ported), the hair profile bake and ambient hair path (decoded on 27 September, not ported), and hair physics (none).
5. **Arm cyberware is the only appearance-changing gameplay state the Studio ignores.** It always draws the default holster state; the other states' chunks also use `metal_base.remt` and `glass_onesided.mt`, which have no adapter [resource] [source].
6. **Two knowledge corrections came out of the audit** ([§8](#8-corrections-made-to-the-knowledge-pages)): the body seam-fix mesh is shadow-only, and the feminine nipple choices 02–04 do name a resource.

## 1. Reading the tables

| Status | Meaning |
|---|---|
| **Drawn** | Resolved by the generic resolver for any V (save, default V or a Character-panel choice) and drawn through an adapter that follows the decompiled program's surface arithmetic |
| **Drawn, approximate** | Drawn, but a named part of the game's look is missing or stood in for |
| **Resolved, not drawn** | The resolver finds the parts; the planner or renderer leaves them out |
| **Not drawn by policy** | Deliberately never drawn (the Studio's censorship floor, first-person parts, quest-only parts) |
| **Not resolved** | The request never reaches the resolver (today: a masculine V) |

"Adapter" names the Studio module that turns a resolved chunk into a material: `skin-material.ts` (skin), `face-decal-material.ts` (decal family), `brow-material.ts` (brows), `hair-shading.ts` (strands and caps), `eye-material.ts` (eyeball and wetness shell) and `layered-material.ts` (`multilayered.mt`). Effort follows the [head CC render plan](../../knowledge/head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort): **S** about a day of agent work, **M** a few days, **L** a week or more.

## 2. Head (feminine creator)

Counts are the 2.31 feminine creator resource's (`female_cco_ep1`); paths abbreviate `base\characters\head\player_base_heads\` as `…\`.

| Option group | Creator choices | Game resources (template) | Studio today | Known fidelity gaps | Next step |
|---|---|---|---|---|---|
| **Skin tone** | 12, colour-only controller (link `skin color`) | Tone is only `TintColor`/`TintScale`/tint mask in the `.mi` chain of every linked follower (`skin.mt`) [resource] | **Drawn**: the resolved chain's tint, multiply or overlay [source] | `TintColor` encoding (byte/255 or sRGB) [hypothesis], test ask 8 | Settle by test ask 8; one constant |
| **Skin type** | 5 × 12 tones | `h0_000__basehead(_d0N).app` → head morph target → `h0_000_pwa_c__basehead.mesh`, 60 local `skin.mt` materials [resource] | **Drawn, approximate** (`skin-material.ts`): albedo, RG normal, roughness, detail normal, microdetail atlas, secondary albedo, skin profile; complexion replacers and ArchiveXL patches resolve [source] | Subsurface is a per-channel wrap chosen by eye [hypothesis]; the screen-space path is decoded ([skin reference §6.3](../materials/shader-skin.md#63-blur-kernel-and-combine)) but not ported; wrinkle maps and blood flow not drawn (neutral at rest); emissive mask not drawn (`skin-glow`); character `GameOptions` not modelled | Port the SSS blur (rank 4 below) |
| **Face shape** (eyes, nose, mouth, jaw, ears) | 5 regions × (None + 21) | `(target, region)` on every morph component carrying the pair [resource] | **Drawn**: every drawn part follows by pair [source] | Face rig 000 whatever the sliders, as in game [wiki]; eye-shape joint binds a [hypothesis] ([facial animation §4](../../knowledge/facial-animation.md#4-eye-shapes-move-the-joints-too)) | None for coverage |
| **Eye colour** | 71 (18 gradient, 16 texture, 37 layered designs) | `he_000__basehead.app` → eye mesh chunks `eye_gradient.mt` / `eye.mt` / `multilayered.mt` + `eye_shadow.mt` shell [resource] | **Drawn** (`eye-material.ts`, `layered-material.ts`): refracted iris, two-normal Eye light, own roughness, wetness shell; layered designs baked [source] | Iris-mask and gamma-normal encoding [hypothesis] (test ask 9); iris axis turn (test ask 10); layered designs have no Eye light (nor does the game's layered program) | Test asks 9–12 |
| **Heterochromia** | Not a vanilla row; CCXL eye mods add two components | [resource] on installed mods | **Resolved, first eye only** (eye plan rank 6 open) | – | S–M ([eye rendering §6.6](../../knowledge/eye-rendering.md#66-implementation-status)) |
| **Eyelashes** | 35 colours (vanilla has no style; CCXL adds styles) | The eye mesh's chunk 0 via `hel_000__basehead.app`, `hair.mt` + `.hp` [resource] | **Drawn** (`hair-shading.ts`), any vanilla or CCXL lash [source] | Profile bake differs from the game's (rank 2 below); lashes draw after the makeup plate | Rank 2 |
| **Eyebrows** | 13 styles + none, × 35 colours | `heb_000__basehead_NN.app` → one shared brow mesh, `mesh_decal_double_diffuse.mt` [resource] | **Drawn, approximate** (`brow-material.ts`) | The brow's normal write (0.4, mode 1) and roughness write (≈ 0.50) are not drawn: a fixed roughness 0.8 [source] ([eyebrows §5](../../knowledge/brows.md#5-what-the-studio-draws-today)); browser-built mips | Route brows through the face-decal family, which already draws both writes for this template (rank 6) |
| **Hair** | 51 styles × 35 colours; `hairstyle_cyberware` twin (51) when face cyberware changes the scalp | `hh_NNN_pwa__hairs_XXX.app` → strand cards `hair.mt` + cap `mesh_decal_gradientmap_recolor.mt`, a shadow-only mesh, a dangle animgraph [resource] | **Drawn, approximate** (`hair-shading.ts`): any vanilla or CCXL hairstyle, highest LOD, shadow-only chunks skipped by `renderMask` [source] | Profile bake (no 0–1 rescale, `k/(N−1)` samples, no byte truncation) and the ambient hair path differ from the decoded game ([hair shading §8](../../knowledge/hair-shading.md#8-browser-preview-mapping)); ambient-lit dark hair several times too bright under the Studio stage; cap blends linearly; **no physics** (the dangle graph is not played) | Rank 2 (bake, ambient), rank 7 (physics) |
| **Eye makeup** | 36 styles × 14 colours + Off | One shared `hx_` mesh, `mesh_decal.mt` [resource] | **Drawn** (face-decal family) [source] | Forward approximation of the G-buffer blend; decal order within a priority [hypothesis]; each decal lit with an interpolated surface, not the residual light the authored plate uses (rank 8) | Test asks 3, 13 |
| **Lipstick** | 3 finishes × 38 styles (1–14 colours each) + none | One shared mesh; `mesh_decal_double_diffuse.mt` (36 style options) or `mesh_decal.mt` [resource] | **Drawn** (face-decal family) [source] | As eye makeup; `Color` encoding [hypothesis] | Test asks 4, 13 |
| **Cheeks** (freckles 1–4, blush 5–24) | 24 + Off | One shared 2-chunk mesh, `mesh_decal.mt`, metallic blush on some [resource] | **Drawn** [source] | As eye makeup | Test ask 3 |
| **Blemishes** | 3 × 6 + Off | `hx_000__basehead_pimples_01.app`, chunk mask per style, `mesh_decal.mt` [resource] | **Drawn** [source] | As eye makeup | – |
| **Face scars** | 13 + Off | One 11-chunk mesh, chunk mask per scar, `mesh_decal.mt` with normal and roughness [resource] | **Drawn**, normal write included [source] | No toggle to hide the V's own scars | – |
| **Facial tattoos** | 15 × 12 tones + Off | `hx_000__tattoo_NN.app`, tone-tinted `mesh_decal.mt` [resource] | **Drawn** in the saved tone [source] | Order against makeup [hypothesis] (tattoo test ask 1) | – |
| **Face cyberware** | 16 × 12 tones + Off | `hx_000__cyberware.app`; newer designs are appearances of the freckle and tattoo meshes; all `mesh_decal.mt` [resource] | **Drawn**; an emissive decal template would be reported (`decal-template`); none in vanilla [source] | Emissive decal family members are placeholders (mods only) | Rank 11 |
| **Piercings** | 14 styles × 16 metals + Off | `i0_000__earring_NN.app` → up to three `i1_` components, `multilayered.mt` [resource] | **Drawn** (`layered-material.ts`), vanilla and frameworks alike [source] | Colour-mask mapping [hypothesis] (test ask 14); a skinless framework part stays at its export pose (`rigid-part`); no dangle physics | Test ask 14 |
| **Teeth** | 5 (default, silver, gold, copper (spelled `cooper` in the resources), pink) | `ht_000__basehead.app` → `ht_000_pwa__basehead.ent` → `ht_000_pwa__morphs.morphtarget` (21 `mouth` targets) → `ht_000_pwa_c__basehead.mesh`: **one chunk, 3,210 vertices**, drawn in scene and shadows; 8 mesh appearances (the creator reaches 5; `teeth_004__metal`, `teeth_005__metal_rusty` and `default`, whose material is `metal_base.remt`, are unreached). `teeth_001` → `teeth_base.mi` → `skin.mt` with `customisation_teeth.sp`; the metal and pink appearances each have their own `.mi` [resource] | **Resolved, not drawn**: in groups `TPP`/`TPP_photomode`, so the face slot plans it, and drops it because only decal templates draw there [source]. The Character panel labels it "conditional", settled to not drawn [source: `cc-render-coverage.ts`] | – | Rank 1 |
| **Personal-link port** (not a row) | Brought by every skin type's `.app` | `hx_000_pwa_c__basehead_personal_slot_dec.mesh`, `mesh_decal.mt` [resource] | **Drawn** as a face detail [source] | – | – |

## 3. Body and arms (feminine creator)

Paths abbreviate `base\characters\common\player_base_bodies\` as `…\`. The third-person body's consumers read `TPP_Body`, `genitals`, the feet state's group and `holstered_default_tpp` ([body rendering §1](../../knowledge/body-rendering.md#1-which-parts-make-the-third-person-body)).

| Option group | Creator choices | Game resources (template) | Studio today | Known fidelity gaps | Next step |
|---|---|---|---|---|---|
| **Body skin** (follows tone) | hidden, 12 tones | `t0_000_base__full.app` → breast morph target over `t0_000_pwa_base__full.mesh`, 8 chunks `skin.mt` [resource] | **Drawn, approximate** (`skin-material.ts`), UV frameworks and body replacers by precedence [source] | Skin gaps as for the head; one SSS profile across the neck seam | Rank 4 |
| **Breast size** | 3 (small, none, big) | Morph targets on the body [resource] | **Drawn** (shape keys at full weight) [source] | The underwear follows by a nearest-vertex shape transfer, not the game's garment support [hypothesis] | Body test ask 2 |
| **Arms and hands** (follow tone) | hidden | `a0_000_base__full.app`: two arm meshes `skin.mt`, the personal link `multilayered.mt` [resource] | **Drawn** [source] | Helper and twist joints move rigidly with the nearest rig segment [hypothesis] | Body test ask 3 |
| **Nail colour** | 54 (plain and `__multilayer` designs) | `a0_000_base__nails.app`, `skin.mt` or `multilayered.mt` [resource] | **Drawn** [source] | A skinless nails mod export moves whole with the hand (`rigid-body-part`) | Body open question 5 |
| **Nail length** | 2 (morph `nails_l`, follower `nails_r`) | Morph targets on the nails [resource] | **Drawn** [source] | – | – |
| **Feet** (not a row) | `flat_feet` / `lifted_feet`, set by footwear | `l0_000_base__cs_flat.app`, `l0_000_base__full.app`, `skin.mt` [resource] | **Drawn**: flat without footwear, lifted when worn footwear sets it [source] | Heel states come from garment tags; `FeetState` suffixes not evaluated for clothing ([worn clothing §6](../../knowledge/clothing.md#6-how-the-studio-draws-worn-clothing)) | Clothing checks |
| **Body tattoos** | 7 × 12 tones + Off | `t0_000_base__tattoo_NN.app`, morph component with the breast targets, `mesh_decal.mt` [resource] | **Drawn** (face-decal family over the body skin) [source] | Forearm ink under arm cyberware [hypothesis] (tattoo test ask 3) | – |
| **Body scars** | 3 choices over 5 options | `scars_000_base.app`, chunk mask per scar, `mesh_decal.mt` [resource] | **Drawn** [source] | – | – |
| **Underwear cover** (not a row) | hidden, censorship | `t0_000_base__censored_items.app`, `mesh_decal.mt` [resource] | **Drawn** as the game's cover; fail-closed floor [source] | Garment support [hypothesis] | Body test ask 2 |
| **Nipples** | 4 (switcher; the choice labelled Off activates `nipples_04`) | `nipples_02…04` → `i0_000_base__nipple.app` → a morph-target nipple mesh (`i0_000_pwa_base__nipple.mesh`, one chunk, `skin.mt`, one style per mesh appearance `<tone>`, `<tone>__02`, `<tone>__03`); `nipples_01` names none [resource] | **Not drawn by policy** (censorship `Deactivate`, under the cover) [source] | – | None (policy) |
| **Genitals, size, pubic hair** | 4 combinations, size morphs, hair switchers | `i0_000_base__genitals.app`, `…_hairstyle_NN.app` [resource] | **Not drawn by policy** [source] | – | None (policy) |
| **Arm cyberware states** (not rows) | chosen by equipped cyberware | `holstered_strong_tpp`, `…_nanowire_tpp`, `…_launcher_tpp`, `…_mantis_tpp` groups: meshes mixing `skin.mt`, `multilayered.mt`, `mesh_decal.mt`, `metal_base.remt` and `glass_onesided.mt` [resource] | **Not drawn**: the plan reads only `holstered_default_tpp` [source] | The state rule is read offline: the equipped `ArmsCW` item's `holsteredItem` has an `appearanceName` equal to the `perspectiveInfo` group name [resource] [source]; only the engine's final lookup is [hypothesis] ([body rendering §1.1](../../knowledge/body-rendering.md#11-how-equipped-arm-cyberware-picks-the-holster-state)). `metal_base.remt` and `glass_onesided.mt` have no adapter; the [metal and glass reference](../materials/shader-metal-glass.md#7-recommended-preview-adapters-ranked) specifies them | Rank 5 |

## 4. Parts that are not creator rows

| Part | Resources | Studio | Why |
|---|---|---|---|
| Face rig (`tpp_head_face_rig`, photo-mode twin) | `h0_000__basehead_face_rig(_ep1).app`: animation components only [resource] | The creator idle and blink are baked offline instead ([facial animation §5](../../knowledge/facial-animation.md#5-the-studios-blink)) | Animation, not geometry |
| Head proxies (`tpp_head_proxy`, `fpp_head_proxy`) | `TPP_proxy`, `FPP_proxy` groups [resource] | Not drawn | Low-detail stand-ins [hypothesis for their consumer] |
| First-person parts (`neck`, `fpp_*`, `*_fpp` arms, `FPP_hairs`) | `FPP`, `FPP_Body`, `holstered_*_fpp` groups [resource] | Not drawn by policy | The preview is third person |
| Body seam fix | `t0_000_pwa_base__full_seamfix.mesh` (brought by the skin type's `.app`): two chunks, both `MCF_RenderInShadows` only, material `metal_base.remt` [resource] | Not drawn | **Shadow-only**, so correctly skipped by the render-mask rule ([§8](#8-corrections-made-to-the-knowledge-pages)) |
| Quest bruises (`finalSceneBruises`) | `hx_000__beatenup_q_307.app`, an 11-chunk `mesh_decal.mt` scar mesh, group `finalSceneBruises` [resource] | Not drawn by policy (not a face group) [source] | Quest-driven |
| `holstered_data` | `a0_000_holstered_data.app`: no drawing component on the reference install [resource] | – | Data only [hypothesis for its purpose] |

## 5. The masculine creator

The masculine creator (483 head, 52 body, 23 arms options) resolves and fills the Character panel, but **nothing of a masculine V is drawn**: `cc-render-coverage.ts` marks every option "not drawn", and `planBody` refuses the body [source]. The [masculine V plan](male-v-plan.md) phases the work. What differs from the feminine audit above, beyond the gate:

| Group | Masculine resources | What drawing it needs |
|---|---|---|
| Head, skin, face shape, eyes, lashes, brows, hair, face decals, piercings, teeth | `pma` twins in the same `.app`s; 20 targets per region; eye chunk roles swapped (handled by templates) [resource] | The masculine core head (plan phase 1, M); the adapters need nothing new |
| **Beard** (masculine only) | `beard` (12 styles + Off) → per-style part switchers `beard0…12` (slot `beard_part`, up to 7 parts) → 57 `beard_colorN_M` options (slot `beard_color`, group `beards`, 35 colours). Each part is a stubble decal (`hb_000_pma_c__basehead_shadowbase_01.mesh`: one 1,142-vertex chunk, `mesh_decal` via `beard_shadow.mi`) and, for all but the stubble-only style, a card mesh (for example `hb_000_pma_c__basehead_jesse_beard.mesh`: two two-sided chunks of 2,744 and 6,522 vertices, `hair.mt` via `<colour>__beard.mi`) [resource] | The stubble already qualifies for the face slot (`beards` is a face group). The cards need a detail slot on `beard_color` drawn by the hair adapter, as the plan's phase 3 proposes (M) |
| Body | Plain body mesh without breast morph; no feet groups or feet controller; nipples without a censorship rule; body tattoos as garment meshes [resource] | Plan phase 4 (S) |

## 6. Ranked gaps

Ranked by visual gain on a typical V per effort. "Typical V" is a feminine V with hair, brows, a skin type, eye colour, perhaps lipstick and a piercing, framed from the head to the full body.

| Rank | Gap | Who sees it | Effort | Dependencies | Risks |
|---|---|---|---|---|---|
| 1 | **Teeth and mouth interior**: a `teeth` detail slot on the creator slot `teeth` (groups `TPP`), drawn by the skin adapter with the chunk's own skin profile (`customisation_teeth.sp`); the metal and pink appearances through whatever templates their `.mi` chains reach | Every V, whenever the lips part (idle, blink frames, later expressions and photo-mode faces) | **S** (the resolver, exporter and skin adapter exist) | None. Unblocks the subsurface gate (the ownership gate asks for the teeth to be present) and later expression work | The metal teeth `.mi` templates are unread [hypothesis: `skin.mt` or `metal_base.remt`; the second would need rank 5's adapter]; a mod that replaces the teeth `.app` (one on the reference profile lists 20 inline components per appearance) must be de-duplicated by component name, as `planBody` already does; the decal underlay (`skinSurfaceUnderlay`) must not read the teeth as the skin under a lip decal |
| 2 | **Hair colour and ambient light as the game bakes them**: the `.hp` bake (sort, rescale to 0–1, sample at `k/N`, truncate to bytes) and the decoded ambient hair path ([hair reference §11.1](../materials/shader-hair.md#111-recommended-preview-changes-for-a-code-track)) | Every V with hair, lashes or brows that use a gradient | **S** (bake), **S–M** (ambient) | Specified; no new data | Changes every hair colour at once; re-run the swatch comparison (median 4.2° hue error expected) |
| 3 | **Masculine V**: core head, gates, idle and blink, beard cards, body ([plan](male-v-plan.md) phases 1–4) | About half of all Vs, who today see no character at all | **L** in total (M + S–M + M + S); phase 1 alone gives the head | Masculine core recipe; masculine body rig [hypothesis `man_base.rig`] | Head replacers for masculine heads; tests that assert feminine-only behaviour change deliberately |
| 4 | **Subsurface scattering as the game does it**: port the decoded blur, kernel and combine ([skin reference §6.3](../materials/shader-skin.md#63-blur-kernel-and-combine)) in place of the wrap stand-in, as planned in [skin reference §11](../materials/shader-skin.md#11-preview-port-plan-screen-space-scatter-in-threejs) | Every V's face and body | **M–L** | The input-pass machinery shared with the [parity measurement design](../authoring/game-parity-measurement.md)'s ID, albedo and depth passes; rank 1 (teeth) for parted lips; one parity capture for the kernel's screen scale | The game blurs across the lip parting and onto the teeth (class mask only, no depth test), so the [diffuse SSS gate](../../projects/xf-studio/authoring/evidence/diffuse-sss-gate-2026-09-24.md)'s no-bleed criterion should become "no scatter outside the class-1 mask"; memory of about 36 bytes per drawing-buffer pixel |
| 5 | **Arm cyberware from the save**: pick the holster state's third-person group from the V's equipped arm cyberware, and add `metal_base.remt` and `glass_onesided.mt` adapters | Vs with Gorilla Arms, Mantis Blades, Monowire or a Projectile Launch System (common after the early game) | **M** | The save's equipment reader (the clothing path reads equipment already); the TweakDB reader for `holsteredItem` → `appearanceName` ([body rendering §1.1](../../knowledge/body-rendering.md#11-how-equipped-arm-cyberware-picks-the-holster-state)) | The engine's final item-to-group step is unread; the adapters are ranked in the [metal and glass reference](../materials/shader-metal-glass.md#7-recommended-preview-adapters-ranked) and also help clothing and the unreached teeth appearance |
| 6 | **Brow surface writes**: draw brows through the face-decal family's double-diffuse member, which already writes the normal and roughness | Every V | **S** | None | Brow colour must stay identical (the current adapter's colour path is checked against captures in waiting) |
| 7 | **Hair physics**: play or approximate the dangle animgraph | Long hairstyles, dangling earrings | **L** | How the graph drives the dangle joints is unread | Motion that differs from the game is worse than none; keep it off until decoded |
| 8 | **Face decals' residual light**: light each face decal as the authored plate is lit (one blended surface) | Vs with vanilla eye makeup or matte lipstick, where the decal's roughness differs from the skin's | **S** | None | Small visual change; re-run the plate parity tests |
| 9 | **Body helper joints and garment support**: rig constraints for twist and muscle joints; the game's garment-support offsets | Whole-body views in the idle; clothing layers | **M–L** | Which rig resource holds the constraints (body open question 1); the cooked garment parameters (clothing open question 4) | Offline evidence is thin; needs the in-game checks first |
| 10 | **Heterochromia** (CCXL two-eye components; eye plan rank 6) | Vs with a heterochromia mod | **S–M** | None | – |
| 11 | **Emissive paths**: the skin's `EmissiveMask` and the emissive decal family members | Mod complexions and mod face cyberware only (no vanilla feminine option emits) | **S–M** | `EmissiveEV` decoding (materials track) | – |
| 12 | **Wrinkle maps and blood flow** | Only with animated or posed expressions | **M** | The wrinkle driver is decoded ([skin reference §5.6](../materials/shader-skin.md#56-the-wrinkle-driver-vertex-program)); which solver outputs feed it is a [hypothesis] | Belongs with the expressions feature |

Not gaps: nipples, genitals and pubic hair stay under the Studio's censorship floor ([body rendering §3](../../knowledge/body-rendering.md#3-censorship-and-nudity-resource-source)); first-person parts, head proxies and the quest bruises are not part of the third-person V; the body seam fix is shadow-only.

## 7. In-game checks for the drawn groups

To batch into one prepared session with the reference feminine V, a new-game feminine V and, once rank 3 lands, a masculine V; record the game, ArchiveXL, the texture and body frameworks and the Character Rendering Editor preset. The [parity measurement design](../authoring/game-parity-measurement.md) supplies the camera and the per-region metrics; each row names the existing ask where one exists.

| Group | Check | Existing ask |
|---|---|---|
| Skin type and tone | Tone strength (senna against pale) and warm ivory's overlay | [Head CC](../../knowledge/head-cc-rendering.md#in-game-test-asks) 1, 8 |
| Complexion mods | Replacer and texture framework on and off | Head CC 2 |
| Face shape | Eye shapes 01, 10, 12 closed and open (with the blink) | [Facial animation](../../knowledge/facial-animation.md#in-game-test-asks) 1–2 |
| Eyes | Gradient coordinate, iris axis and depth, wetness shell, cornea against iris | Head CC 9–12 |
| Lashes and hair | Replaced `.hp` profiles on and off; hairstyle 1 brown liquorice and 5 blonde platinum | Head CC 7 |
| Brows | Colour and density against the preview, then the roughness write under a moving light (after rank 6) | [Eyebrows](../../knowledge/brows.md#in-game-test-asks) |
| Face decals | Decal order where eye makeup, blush and a tattoo overlap; lip finish roughness; the reference save's lips and cheek | Head CC 3, 4, 13; [tattoos](../../knowledge/tattoos.md#in-game-test-asks) 1, 5 |
| Piercings and layered eyes | Style 9 black, style 1 silver and gold, eye colour 24 | Head CC 14 |
| **Teeth** (after rank 1) | Creator teeth page (`UI_Teeth` camera), each of the five choices under one light, and one photo-mode smile: colour, the metal choices' highlight, and whether the gums and tongue read inside the mouth | New |
| Body, arms, nails | Tone at the neck and wrists, flat feet, underwear coverage at every breast size, shoulder and wrist shape in the idle | [Body](../../knowledge/body-rendering.md#in-game-test-asks) 1–3 |
| Nails | Long nails with a layered design (for example a heart design), one close-up of each hand | New |
| Body tattoos and scars | Tattoo 1 over the overlay framework; forearm ink with arm cyberware | Tattoos 2, 3 |
| **Arm cyberware** (after rank 5) | Photo mode with Gorilla Arms and with Mantis Blades equipped, arms at rest: which holster-state meshes show | New; also answers body open question 4 |
| Clothing | Reference outfit per layer, wardrobe set, hide flags | [Worn clothing](../../knowledge/clothing.md#in-game-test-asks) 1–5 |
| Masculine V (after rank 3) | Plan checks 5–6 (beard, body) | [Masculine V plan §6](male-v-plan.md#6-in-game-checks-worth-batching) |

## 8. Corrections made to the knowledge pages

- **The body seam fix is shadow-only** [resource]. Both chunks of `t0_000_pwa_base__full_seamfix.mesh` carry `MCF_RenderInShadows` without `MCF_RenderInScene`, so the render-mask rule skips it whatever its template. This answers [head CC rendering open question 10](../../knowledge/head-cc-rendering.md#open-questions) and [body rendering open question 7](../../knowledge/body-rendering.md#open-questions): both statements were partly right (it is the shadow proxy the render-mask note describes, and its material is `metal_base.remt`), and "no seam-fix component" in body rendering §1 needed the qualifier that the skin type's `.app` brings one.
- **Feminine nipples 02–04 name a resource** [resource]. `nipples_02`, `_03` and `_04` point at `i0_000_base__nipple.app`, whose feminine definitions draw a morph-target nipple mesh (`i0_000_pwa_base__nipple.mesh`, 304 vertices, one `skin.mt` chunk) with one mesh appearance per tone and style; only `nipples_01` names none, and the creator's Off label sits on `nipples_04`. Body rendering §1 said the feminine options name no resource. Nothing changes in the Studio: the censorship rule keeps every nipple option under the cover.
- **Teeth** facts were added to head CC rendering §1 (mesh, appearances, why the preview drops them).

## Provenance

- **Studio code**: `projects/xf-studio/authoring` at `36b5c87`: `src/character-detail-plan.ts` (`DETAIL_UI_SLOTS`, `FACE_GROUPS`, `planChunk`, `planFace`, `BODY_GROUPS`, `planBody`, `censorRole`), `src/render-templates.ts` (the adapters and the placeholder decal family), `src/cc-render-coverage.ts` (the Character panel's coverage labels), `src/detail-limits.ts` (limit codes), `src/render-detail.ts` (`DETAIL_SLOTS`).
- **Creator options**: the committed [CC option inventory](cc-option-inventory.json) (`female_cco`, `male_cco` and their EP1 diffs), read with a short read-only script (not committed).
- **Resolved parts**: the ignored resolver cache of the reference MO2 installation (`projects/xf-studio/authoring/data/resolver-cache/`), read only: the reference save's resolved character (`reports/reference-save.json`, 25 September) and the WolvenKit-serialized resources below (`json/`). No cache was refreshed and WolvenKit was not run.

  | Resource (archive) | SHA-256 of the extracted file |
  |---|---|
  | `…head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\ht_000_pwa_c__basehead.mesh` (`basegame_4_appearance`) | `076cb660a2e72b1c3e4a43eee53ea12d865ca45389b465ead445111f4fae2e48` |
  | `…head\player_base_heads\appearances\head\ht_000__basehead.app` (`basegame_4_appearance`) | `764c4167bf0063be2559172abf1948dbd9fb1c3847bccdac208fb61d35cb86ac` |
  | the same path replaced by a morph and rig additions mod on the reference profile | `ebab1c5ce79795a5dcac0d25ca106a01cb419632dfad62e61910eb0039fb2e99` |
  | `…common\player_base_bodies\player_female_average\t0_000_pwa_base__full_seamfix.mesh` (`basegame_4_appearance`) | `9e149d861525c037be67271e95cbbcca4b826e5eeca8088543bf3fc7518baf36` |
  | `…common\player_base_bodies\player_female_average\genitals\i0_000_pwa_base__nipple.mesh` (`basegame_4_appearance`) | `924b20a0c993cf9ddfebb2eb223452eed0b670148877239dc6d6df73e6d9c25e` |
  | `…common\player_base_bodies\appearances\i0_000_base__nipple.app` (`basegame_4_appearance`) | `4e0768f6f0cc9893a5b6334a225fafeeb1f62e83f99314b218ae073ed09e57a7` |

  Chunk counts, vertex counts and render masks are the render blob header's `renderChunkInfos`; mesh appearances and material bases are the serialized `appearances`, `materialEntries` and local material buffer. The masculine beard meshes (`hb_000_pma_c__basehead_shadowbase_01.mesh`, `hb_000_pma_c__basehead_jesse_beard.mesh`) were read the same way.

## Related pages

[Head CC rendering](../../knowledge/head-cc-rendering.md) · [Body rendering](../../knowledge/body-rendering.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [Masculine V plan](male-v-plan.md) · [Worn clothing](../../knowledge/clothing.md) · [Preview fidelity backlog](../backlog/preview-fidelity.md) · [Research and work queue](../backlog/README.md)
