# Character-creator render coverage

**Status: audit refreshed 30 September 2026 against `projects/xf-studio/authoring` at `2d6752b` (first audit 27 September at `36b5c87`). Nothing on this page has runtime evidence beyond what the linked pages mark [runtime].** Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[resource]** extracted game or mod resources, **[source]** engine, framework, tool or Studio source, **[wiki]** Modding Docs, **[runtime]** the running game, **[offline]** measured with the Studio's own code on game data, **[hypothesis]** not yet established. The plans for the top gaps are in [render gap plans](render-gap-plans.md); the measurements behind this refresh are in [experiment 034](../../experiments/034-render-coverage-refresh/README.md). Provenance is [at the end](#provenance).

This page answers one question for the build tracks: for every character-creator option, what does the game draw, what does the Studio viewport draw today, how faithfully, and what would closing each gap take? The feminine creator comes first; the masculine creator is in [§5](#5-the-masculine-creator). The per-option resources are in [head CC rendering](../../knowledge/head-cc-rendering.md), [body rendering](../../knowledge/body-rendering.md) and the [CC file chain](../../knowledge/cc-file-chain.md#4-every-cc-detail-and-what-drives-it); this page scores coverage against them.

## Findings in brief

1. **Selection is complete for every creator row a player sees, on both bodies, with three exceptions** [offline: every option of the host's cached catalogues through the Studio's own coverage rules, [experiment 034 §2](../../experiments/034-render-coverage-refresh/README.md#2-coverage-walk)]. Of the feminine creator's visible head rows, 628 draw and 280 are face decals that draw once resolved; the only visible rows left out are first-person parts and one CCXL hair cap option whose appearance lists no consumer group. The exceptions: **the masculine beard's cards** (the stubble draws, the `hair.mt` cards don't, and the rows don't say so), **arm cyberware**, which is equipment-driven rather than a row and always draws the default holster state, and a CCXL heterochromia mod's second eye.
2. **Since the first audit** the teeth, the hair bake and the ambient hair path, the game's screen-space subsurface scatter, head-scoped shadow maps and contact shadows, the masculine head, body and export, the body's deformation rig (helper and elbow joints), the nails' skinning, the creator's lifted feet, the facial setup the face rig names, the `Color` parameters' sRGB decode and the reciprocal microblend contrast have landed, and session 3 and 4 frames settled several asks (gradient iris read raw; layered eye designs, gold, black plastic and the heart piercing as in the preview).
3. **The biggest gaps left are fidelity on drawn parts** ([§6](#6-ranked-gaps)): the teeth reading as gritted when the idle parts the lips (PREV-147), the masculine face holding still, the lit skin reading warmer than the game, arm cyberware, the hair ladder's missing light and the scatter's unfitted screen scale.
4. **PREV-147 is now narrowed to light** [offline]. Under the facial setup the preview now uses, the breaths part the lips about 18 % less (2.75–2.91 mm) with the same jaw, and none of the solver's open readings changes them, so the bite is the game data's. The mouth-interior stand-in lights the front teeth about three times brighter than its own model gives for that parting ([plans §1](render-gap-plans.md#1-teeth-and-the-mouth-interior-prev-147)).
5. **The decoded hair bake is done and holds** [runtime, session 3]; the hair gap left is light the preview doesn't have, not the bake ([plans §2](render-gap-plans.md#2-hair-the-ladders-missing-light)).

## 1. Reading the tables

| Status | Meaning |
|---|---|
| **Drawn** | Resolved by the generic resolver for any V (save, default V or a Character-panel choice) and drawn through an adapter that follows the decompiled program's surface arithmetic |
| **Drawn, approximate** | Drawn, but a named part of the game's look is missing or stood in for |
| **Resolved, not drawn** | The resolver finds the parts; the planner or renderer leaves them out |
| **Not drawn by policy** | Deliberately never drawn (the censorship floor, first-person parts, quest-only parts) |

"Adapter" names the Studio module that turns a resolved chunk into a material: `skin-material.ts` (skin, with the screen-space scatter in `platform/scene/skin-scatter.ts`), `face-decal-material.ts` (decal family), `brow-material.ts` (brows), `hair-shading.ts` (strands and caps), `eye-material.ts` (eyeball and wetness shell), `layered-material.ts` (`multilayered.mt`) and `metal-base-material.ts` (`metal_base.remt`). Effort: **S** about a day of agent work, **M** a few days, **L** a week or more.

## 2. Head (feminine creator)

Counts are the 2.31 feminine creator resource's (`female_cco_ep1`); paths abbreviate `base\characters\head\player_base_heads\` as `…\`.

| Option group | Creator choices | Game resources (template) | Studio today | Known fidelity gaps | Next step |
|---|---|---|---|---|---|
| **Skin tone** | 12, colour-only controller (link `skin color`) | `TintColor`/`TintScale`/tint mask in the `.mi` chain of every linked follower (`skin.mt`) [resource] | **Drawn**: tint multiply or overlay, `Color` sRGB-decoded [source; session 4 leans the same way, provisional] | Lit skin reads warmer than the game (forehead R/G 1.33–1.41 against 0.97–1.07, two captures) [runtime]; not the tone's encoding | Capture C5 ([plans §4](render-gap-plans.md#4-lit-skin-hue)) |
| **Skin type** | 5 × 12 tones | `h0_000__basehead(_d0N).app` → head morph target → `h0_000_pwa_c__basehead.mesh`, `skin.mt` [resource] | **Drawn, approximate**: albedo, RG normal, roughness, detail normal, microdetail, secondary albedo, the dual lobe; **the game's screen-space scatter** (kernel from the `.sp`, blur, combine; wrap as fallback); head-scoped shadow maps and contact shadows for the flagged lights [source] | Scatter screen scale unfitted; first-frame compile hitch (PREV-142); translucency not drawn (runs in game for a back light [runtime]; local-light path undecoded); wrinkles and blood flow not drawn (neutral at rest); emissive mask (`skin-glow`) | [Plans §3](render-gap-plans.md#3-subsurface-scattering) |
| **Face shape** (eyes, nose, mouth, jaw, ears) | 5 regions × (None + 21) | `(target, region)` on every morph component carrying the pair [resource] | **Drawn**: every drawn part follows by pair; the face is solved with the facial setup the face rig names (the male player setup) since 29 September [source] | – | – |
| **Eye colour** | 71 (18 gradient, 16 texture, 37 layered) | `he_000__basehead.app` → `eye_gradient.mt` / `eye.mt` / `multilayered.mt` + `eye_shadow.mt` shell [resource] | **Drawn**: refracted iris, two-normal Eye light, own roughness, wetness shell; layered designs through the layered adapter with the reciprocal contrast (PREV-127) [source] | Iris axis and depth, wetness and cornea (head CC test asks 10–12); the iris mask is read raw, as session 3 showed [runtime] | Test asks 10–12 |
| **Heterochromia** | Not a vanilla row; CCXL eye mods add a second component | [resource] on installed mods | **Resolved, first eye only** (`eyes_color_2` is not planned) | – | S–M ([plans §7](render-gap-plans.md#7-smaller-gaps)) |
| **Eyelashes** | 35 colours (CCXL adds styles) | Eye mesh chunk 0 via `hel_000__basehead.app`, `hair.mt` + `.hp` [resource] | **Drawn** (hair adapter, the decoded bake) [source] | Lashes draw after the makeup plate | – |
| **Eyebrows** | 13 styles + none, × 35 colours | `heb_000__basehead_NN.app` → one shared brow mesh, `mesh_decal_double_diffuse.mt` [resource] | **Drawn, approximate** (`brow-material.ts`) | Normal and roughness writes not drawn (a fixed roughness 0.8) | S ([plans §7](render-gap-plans.md#7-smaller-gaps)) |
| **Hair** | 51 styles × 35 colours; `hairstyle_cyberware` twin | `hh_NNN_pwa__hairs_XXX.app` → `hair.mt` cards + `mesh_decal_gradientmap_recolor.mt` cap, a shadow-only mesh, a dangle graph [resource] | **Drawn, approximate**: any vanilla or CCXL hairstyle, every part of a multi-part style and its accessories; **the decoded `.hp` bake and ambient path** (27 September); Hair look (Crisp to Game-like); hair kept out of the contact-only rims' maps (PREV-171); physics built, off by default [source] | Game's ladder 1.5–1.8× steeper and cooler than the preview's: missing light, not the bake [runtime, session 3]; the cap blends linearly; physics waits for checks H1–H6 | [Plans §2](render-gap-plans.md#2-hair-the-ladders-missing-light) |
| **Eye makeup** | 36 styles × 14 colours + Off | One shared `hx_` mesh, `mesh_decal.mt` [resource] | **Drawn** (face-decal family) [source] | Decal order within a priority [hypothesis]; each decal lit with an interpolated surface, not the plate's residual light | Head CC test asks 3, 13 |
| **Lipstick** | 3 finishes × 38 styles + none | `mesh_decal_double_diffuse.mt` or `mesh_decal.mt` [resource] | **Drawn** (face-decal family) [source] | As eye makeup; the bright lip seam the preview once drew has no counterpart in game [runtime, session 4] (the current preview not re-measured) | Test asks 4, 13 |
| **Cheeks, blemishes, face scars, facial tattoos, face cyberware** | 24, 3 × 6, 13, 15 × 12 tones, 16 × 12 tones (each + Off) | `mesh_decal.mt` meshes, chunk masks per style [resource] | **Drawn** (face-decal family; scars with their normal write; tattoos and cyberware in the saved tone) [source] | As eye makeup; emissive decal members are placeholders (mods only) | Test asks 3, 13 |
| **Piercings** | 14 styles × 16 metals + Off | `i0_000__earring_NN.app` → up to three `i1_` components, `multilayered.mt` [resource] | **Drawn** (layered adapter), vanilla and frameworks alike [source] | Gold, black plastic and the heart match the preview [runtime, session 4]; a skinless framework part stays at its export pose (`rigid-part`) | – |
| **Teeth** | 5 (default, silver, gold, copper, pink) | `ht_000__basehead.app` → a morph-target teeth mesh, one chunk; `teeth_001` `skin.mt` with `customisation_teeth.sp`; the four finishes `multilayered.mt` [resource] | **Drawn** in the `teeth` slot, following the `mouth` shapes and the idle; a mouth-interior occlusion stand-in (fixed 10 mm parting, floor 0.3) [source] | **PREV-147**: the idle's breaths part the lips 2.75–2.91 mm over a nearly closed bite (the game data's) and the stand-in lights the front teeth about 3× brighter than its model gives for that parting, so both rows read bright, as if gritted [offline] | [Plans §1](render-gap-plans.md#1-teeth-and-the-mouth-interior-prev-147); captures C1, C2 |
| **Personal-link port** (not a row) | Brought by every skin type's `.app` | `mesh_decal.mt` [resource] | **Drawn** as a face detail [source] | – | – |

## 3. Body and arms (feminine creator)

Paths abbreviate `base\characters\common\player_base_bodies\` as `…\`. The third-person body's consumers read `TPP_Body`, `genitals`, the feet state's group and the holster state's third-person group ([body rendering §1](../../knowledge/body-rendering.md#1-which-parts-make-the-third-person-body)).

| Option group | Creator choices | Game resources (template) | Studio today | Known fidelity gaps | Next step |
|---|---|---|---|---|---|
| **Body skin** (follows tone) | hidden, 12 tones | `t0_000_base__full.app` → breast morph target over `t0_000_pwa_base__full.mesh`, `skin.mt` [resource] | **Drawn, approximate** (skin adapter and scatter), UV frameworks and body replacers by precedence [source] | As the head's skin; one SSS profile across the neck seam | Skin test ask 3 |
| **Breast size** | 3 | Morph targets on the body [resource] | **Drawn** [source] | The underwear follows by a nearest-vertex shape transfer, not the game's garment support [hypothesis] | Body test ask 2 |
| **Arms and hands** (follow tone) | hidden | `a0_000_base__full.app`: two arm meshes `skin.mt`, the personal link `multilayered.mt` [resource] | **Drawn**; helper, twist and elbow correctives follow the game's deformation rig (PREV-111, PREV-149) [source] | Shoulder and wrist shape in the idle unchecked in game | Body test ask 3 |
| **Nail colour and length** | 54 colours; 2 lengths (morphs) | `a0_000_base__nails.app`, `skin.mt` or `multilayered.mt` [resource] | **Drawn**, skinned to the fingertips (PREV-112) [source] | A skinless nails mod export moves whole with the hand (`rigid-body-part`) | – |
| **Feet** (not a row) | `flat_feet` / `lifted_feet`, set by footwear | `l0_000_base__cs_flat.app`, `l0_000_base__full.app` [resource] | **Drawn**: flat without footwear, lifted in footwear and under the creator idles (PREV-113); overrides only hide (PREV-128) [source] | – | – |
| **Body tattoos, body scars** | 7 × 12 tones; 3 over 5 options | `mesh_decal.mt` morph components [resource] | **Drawn** (face-decal family over the body skin) [source] | Forearm ink under arm cyberware [hypothesis] | Tattoo test ask 3 |
| **Underwear cover** (not a row) | hidden, censorship | `t0_000_base__censored_items.app`, `mesh_decal.mt` [resource] | **Drawn** as the game's cover; fail-closed [source] | Garment support [hypothesis] | Body test ask 2 |
| **Nipples, genitals** | switchers | `i0_000_base__nipple.app`, `i0_000_base__genitals.app` [resource] | **Not drawn by policy** by default; drawn as the game does with the opt-in uncensored setting [source] | – | – |
| **Arm cyberware states** (not rows) | chosen by equipped cyberware | `holstered_strong_tpp`, `…_mantis_tpp`, `…_nanowire_tpp`, `…_launcher_tpp`: each two options (the skin half and the cyberware half) filling the same components; `skin.mt`, `multilayered.mt`, `mesh_decal.mt`, `metal_base.remt`, `glass_onesided.mt` [resource] | **Not drawn**: the plan reads only `holstered_default_tpp`; the loadout reader keeps clothing areas only [source] | `glass_onesided.mt` has no adapter; `metal_base` has no alpha test (PREV-117) | M ([plans §5](render-gap-plans.md#5-arm-cyberware)); capture C6 |

Worn clothing is not a creator row; it draws over this body since 26 September (phases 1–4; [worn clothing](../../knowledge/clothing.md#6-how-the-studio-draws-worn-clothing)).

## 4. Parts that are not creator rows

| Part | Resources | Studio | Why |
|---|---|---|---|
| Face rig (`tpp_head_face_rig`, photo-mode twin) | Animation components only [resource] | The creator idle, the blink and expressions are solved live by XF Studio's own solver with the facial setup the rig names ([facial animation §3](../../knowledge/facial-animation.md#3-which-facial-setup-v-uses)) | Animation, not geometry |
| Head proxies (`tpp_head_proxy`, `fpp_head_proxy`) | `TPP_proxy`, `FPP_proxy` groups [resource] | Not drawn | Low-detail stand-ins [hypothesis for their consumer] |
| First-person parts (`neck`, `fpp_*`, `*_fpp` arms, `FPP_hairs`) | `FPP`, `FPP_Body`, `holstered_*_fpp` groups [resource] | Not drawn by policy | The preview is third person |
| Body seam fix | `t0_000_pwa_base__full_seamfix.mesh`: both chunks `MCF_RenderInShadows` only [resource] | Not drawn | Shadow-only |
| Quest bruises (`finalSceneBruises`) | `hx_000__beatenup_q_307.app` [resource] | Not drawn by policy | Quest-driven |
| `holstered_data` | Audio and effect components only [resource] | – | No drawing component |

## 5. The masculine creator

The masculine creator (666 options on the reference install) resolves and draws on his own core head and body by the same rules as the feminine creator [offline]; his XF Eye Artistry export is built ([masculine V plan](male-v-plan.md#phase-status), phases 5 and 6). What differs:

| Group | Masculine resources | Studio today |
|---|---|---|
| Head, skin, face shape, eyes, lashes, brows, hair, face decals, piercings, teeth | `pma` twins in the same `.app`s; 20 targets per region [resource] | **Drawn**, but **his face holds still**: the idle, the blink and live expressions refuse his head (`IDLE_MASCULINE`, `FACE_MASCULINE`) until his own face rig, setup and clips are prepared (plan phase 2) [source] |
| **Beard** (masculine only) | `beard` (12 styles + Off) → part switchers (slot `beard_part`, up to 7 parts) → 57 `beard_colorN_M` options (35 colours). Each part is a stubble decal (`mesh_decal` via `beard_shadow.mi`) and, for all but the stubble-only style, a `hair.mt` card mesh [resource] | **Stubble drawn; cards not drawn**: face options are planned only through their decal chunks. The rows read as drawn because the stubble is, with no "not shown" mark for the cards [source] ([plans §6](render-gap-plans.md#6-masculine-v-beard-cards-and-face-motion)) |
| Body | Plain body mesh; no feet groups; the arms' groups not split per perspective (`holstered_default`, `holstered_strong`, …) [resource] | **Drawn**; his body idle waits for phase 2 |

## 6. Ranked gaps

Ranked by visual gain on a typical V per effort. "Typical V" is a V of either body with hair, brows, a skin type, eye colour, perhaps lipstick and a piercing, framed from the head to the full body, often with the creator idle playing.

| Rank | Gap | Who sees it | Effort | Plan |
|---|---|---|---|---|
| 1 | **Teeth read as gritted in the idle's breaths** (PREV-147): geometry matches the game data; the interior is lit about 3× brighter than the stand-in's own model for a 3 mm parting | Every V, for about a third of the idle loop | **S** (pose-aware interior term), then **M** (per-light interior shadowing) | [§1](render-gap-plans.md#1-teeth-and-the-mouth-interior-prev-147) |
| 2 | **Masculine V: beard cards and face motion** | About half of all Vs; the cards every bearded V | **M** (cards) + **M–L** (face, motion track) | [§6](render-gap-plans.md#6-masculine-v-beard-cards-and-face-motion) |
| 3 | **Lit skin warmer than the game** (lighting track) | Every V, the whole face and body | **S** once capture C5 separates the leads | [§4](render-gap-plans.md#4-lit-skin-hue) |
| 4 | **Arm cyberware from the save** (holster state, `glass_onesided`, PREV-117) | Vs with arm cyberware (common after the early game) | **M** | [§5](render-gap-plans.md#5-arm-cyberware) |
| 5 | **Hair ladder's missing light** (the bake is done) | Every V with light or grey hair; the crown most | **S–M** + capture C3 | [§2](render-gap-plans.md#2-hair-the-ladders-missing-light) |
| 6 | **Scatter calibration** (screen scale, PREV-142) | Every V; small visual change | **S** + **S** | [§3](render-gap-plans.md#3-subsurface-scattering) |
| 7 | **Brow surface writes** | Every V, under a moving light | **S** | [§7](render-gap-plans.md#7-smaller-gaps) |
| 8 | **Face decals' residual light** | Vs with vanilla makeup or matte lipstick | **S** | §7 |
| 9 | **Wrinkle maps and blood flow** | Expressions and poses only | **M** | §7 |
| 10 | **Heterochromia** | Vs with a heterochromia mod | **S–M** | §7 |
| 11 | **Hair physics** (built, off by default) | Long hairstyles, physics earrings | In-game checks H1–H6, not build work | [Dangle physics](../../knowledge/hair-physics.md) |
| 12 | **Emissive paths**, **local-light translucency** | Mod complexions and cyberware; back-lit ears | Research first | §7, §3 |

Not gaps: nipples, genitals and pubic hair stay under the censorship floor by default; first-person parts, head proxies and the quest bruises are not part of the third-person V; the body seam fix is shadow-only.

## 7. In-game checks for the drawn groups

To batch into one prepared session; record the game, ArchiveXL, the texture and body frameworks, the Character Rendering Editor preset, Ultra+ (off for parity) and the SSS quality. The new capture requests C1–C6 are in [render gap plans §8](render-gap-plans.md#8-capture-requests-one-prepared-session); the [next-sessions plan](../runtime/next-sessions-plan.md) holds the rest.

| Group | Check | Ask |
|---|---|---|
| Skin type and tone | Pale against senna with Ultra+ off; the complexion replacer on and off | Head CC 2, 8; C5 |
| Skin scatter | Raking light at SSS Low and High, Ultra+ off | Skin test ask 4; C4 |
| Face shape | Eye shapes 01, 10, 12 closed and open | [Facial animation](../../knowledge/facial-animation.md#in-game-test-asks) 1–2 |
| Eyes | Iris axis and depth, wetness shell, cornea against iris | Head CC 10–12 |
| Lashes and hair | Replaced `.hp` profiles on and off; the ladder with ray tracing off | Head CC 7; C3 |
| Brows | Colour and density, then the roughness write under a moving light | [Eyebrows](../../knowledge/brows.md#in-game-test-asks) |
| Face decals | Decal order; lip finish roughness; the reference save's lips and cheek | Head CC 3, 4, 13 |
| **Teeth** | The breath (both rows, or darkness?) and the teeth page's five choices | Head CC 15; C1, C2 |
| Body, arms, nails | Tone at the neck and wrists, flat feet, underwear coverage, shoulder and wrist in the idle | [Body](../../knowledge/body-rendering.md#in-game-test-asks) 1–3 |
| **Arm cyberware** | Photo mode with Gorilla Arms and with Mantis Blades, arms at rest | Body open question 4; C6 |
| Hair and earring physics | Creator sway, head-turn response, collision, gameplay inertia | [Dangle physics](../../knowledge/hair-physics.md#in-game-test-asks) H1–H6 |
| Clothing | Reference outfit per layer, wardrobe set, hide flags | [Worn clothing](../../knowledge/clothing.md#in-game-test-asks) 1–5 |
| Masculine V | Beard, body, his eye plate | [Masculine V plan §6](male-v-plan.md#6-in-game-checks-worth-batching) |

## 8. Corrections made to the knowledge pages

This refresh:

- **Head CC rendering §6** said the screen-space scatter was decoded but not ported, and that the masculine export remained; both landed (27 and 28 September). The PREV-147 paragraph gains the male-setup and solver-alternative measurements.
- **Body rendering §1** still said the preview draws no masculine V and that `metal_base.remt` has no adapter; both are out of date. It gains the two-option structure of each holster state.

The first audit (27 September) established that the body seam fix is shadow-only, that feminine nipples 02–04 name a resource, and the teeth's resources.

## Provenance

- **Studio code** at `2d6752b`: `src/character-detail-plan.ts` (`DETAIL_UI_SLOTS`, `FACE_GROUPS`, `BODY_GROUPS`, `planChunk`, `planFace`, `planBody`), `src/render-templates.ts`, `src/cc-render-coverage.ts`, `src/detail-limits.ts`, `src/mouth-occlusion.ts`, `src/saved-v.ts`, `src/studio-ui/panels/character.ts` (the conditional rows' settling), `src/platform/scene/head-rig.ts` and `face-driver.ts` (the masculine gates); the [code-health ledger](../authoring/code-health.md) for the PREV rows cited.
- **Coverage walk**: [experiment 034 §2](../../experiments/034-render-coverage-refresh/README.md#2-coverage-walk), over the host's cached feminine and masculine catalogues (26 September, the reference installation), read only.
- **Breath measurement**: [experiment 034 §1](../../experiments/034-render-coverage-refresh/README.md#1-the-idles-breaths-under-each-facial-setup-prev-147), from the installed base archives with XF Studio's own readers and solver.
- **Resolved parts**: the ignored resolver cache of the reference MO2 installation (`reports/reference-save.json`, 25 September), read only; the first audit's resource hashes (the teeth mesh and `.app`, the seam fix, the nipple mesh and `.app`) are listed below (first audit, unchanged).

  | Resource (`basegame_4_appearance`) | SHA-256 of the extracted file |
  |---|---|
  | `…head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\ht_000_pwa_c__basehead.mesh` | `076cb660a2e72b1c3e4a43eee53ea12d865ca45389b465ead445111f4fae2e48` |
  | `…head\player_base_heads\appearances\head\ht_000__basehead.app` | `764c4167bf0063be2559172abf1948dbd9fb1c3847bccdac208fb61d35cb86ac` |
  | `…common\player_base_bodies\player_female_average\t0_000_pwa_base__full_seamfix.mesh` | `9e149d861525c037be67271e95cbbcca4b826e5eeca8088543bf3fc7518baf36` |
  | `…common\player_base_bodies\player_female_average\genitals\i0_000_pwa_base__nipple.mesh` | `924b20a0c993cf9ddfebb2eb223452eed0b670148877239dc6d6df73e6d9c25e` |
  | `…common\player_base_bodies\appearances\i0_000_base__nipple.app` | `4e0768f6f0cc9893a5b6334a225fafeeb1f62e83f99314b218ae073ed09e57a7` |

  The teeth `.app` is replaced by a morph and rig additions mod on the reference profile (`ebab1c5ce79795a5dcac0d25ca106a01cb419632dfad62e61910eb0039fb2e99`). No cache was refreshed and WolvenKit was not run.
- The viewport was not run for this refresh: the source, the ledger, the offline measurements and the evidence pages cited above carry every status.

## Related pages

[Render gap plans](render-gap-plans.md) · [Head CC rendering](../../knowledge/head-cc-rendering.md) · [Body rendering](../../knowledge/body-rendering.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [Masculine V plan](male-v-plan.md) · [Worn clothing](../../knowledge/clothing.md) · [Preview fidelity backlog](../backlog/preview-fidelity.md) · [Research and work queue](../backlog/README.md)
