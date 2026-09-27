# Supporting a masculine V: resources, Studio gaps and a phased plan

**Status (28 September 2026): phases 1, 5 and 6 built (`claude/male-v-core`, `claude/masculine-export`), with phase 4 and the stubble of phase 3; phases 2 and 7 open. XF Eye Artistry now builds for both bodies, offline-verified; nothing here has runtime evidence.** Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** engine, framework or tool source; **[resource]** extracted game resources; **[wiki]** Modding Docs; **[runtime]** the running game; **[offline]** the Studio preview; **[hypothesis]** not yet established. Measurements, hashes and methods are under [provenance](#provenance).

The Studio draws a feminine V and a masculine V from the generic resolver's output, each on its own core head prepared from the player's game files ([head CC rendering](../../knowledge/head-cc-rendering.md), [body rendering](../../knowledge/body-rendering.md)). XF Eye Artistry builds a selector for both creators when the masculine plate can be prepared, and says plainly when a mod is for a feminine V only ([pipeline](../authoring/studio-to-mod-pipeline.md#the-masculine-vs-selector)). The product direction wants every character detail rendered and creator values editable "so users can check work on characters other than their own" (AGENTS.md, Character context). This page says what a masculine V needs in each layer, in what order, and [what is built](#phase-status).

## Findings in brief

1. **The resolver side is already gender-neutral.** CCO selection, the ArchiveXL merge, the creator catalogue, save reading, the character context and the host's resolve/plan/export path all take the body gender as data. What blocks a masculine V is a small set of female-only gates in the browser, and the **core head**, which is one female recipe (§3).
2. **The masculine head shares the feminine head's UV layout in the eye region, and his plate passes the plate's gates.** All 1,620 vertices of the feminine eye plate have an exact UV twin on the masculine head. The masculine triangles spanning those UVs number 3,010, the plate's own face count, and cover the same UV area to within 0.3 %. But the triangle order differs, and the surface sits a median 4.9 mm (up to 8.3 mm) away at the same UV. So a masculine V needs **his own plate mesh**, cut from his own head under the same skin-byte and 0.4 mm lift rules. The audited cut has native bytes in the mesh and the morph base buffer and all 100 targets; its extra boundary loops and pinched vertex are the male head's own unwelded seams, whose copies never part (§4.1). Every preset's **textures can be shared** between the two plates, because the plate's UV window depends only on those UVs (§4.1–4.2). Vanilla does the same: both genders' cheek decals list the same 55 textures [resource].
3. **The masculine face rig is simpler than the feminine one.** Every player `face_rig`, feminine included, names the **male** player facial setup. For a masculine V that is his own setup, with his own skeleton, graph and `ui_male_face.anims`, so the facial-setup question open for the feminine V does not arise (§2.6).
4. **Export needs a second customization resource and a second template, not a second look** (built). ArchiveXL merges customizations per gender, so XF Eye Artistry for a masculine V is a `male:` entry with its own `.inkcharcustomization`, a masculine plate component and an appearance template. ArchiveXL picks a dynamic appearance's template by **name prefix, first match wins**, so the two templates must not share a prefix; separate `.app`s per gender avoid the problem. His option needs its own creator index too: the feminine 311 is a beard colour option in his creator (§4.3).
5. **Brain gender (voice) changes nothing the Studio draws.** It must be carried through untouched on any save write-back (§1).

## 1. Body gender and brain gender

| Field | Where | What it decides | Grade |
|---|---|---|---|
| `isMale` (save), `bodyGender` (Studio) | save node `CharacetrCustomization_Appearances`; the Studio's request, catalogue and record | Which creator resource (`male_cco(_ep1)`), which player entity (`player_ma_*`), every resource the choices reach, clothing's `Gender` suffix and `{gender}` substitution | [source] [resource] |
| `isBrainGenderMale` (save), `isMaleVO` (UI presets) | save node; `.charcustpreset` | The voice. No creator option, group or resource depends on it | [source: field names] [resource: neither creator resource names it] |

- The Studio reads both flags (`save-reader.ts` `isMale`, `brainIsMale`). Only `isMale` is used. That is correct for rendering.
- The portable preset (`xfs/cc-preset-1`) stores `bodyGender` but not the voice. It needs no voice field until save write-back exists. When it does, the writer must copy `isBrainGenderMale` unchanged.
- Text variants: `onscreens` entries have `femaleVariant`/`maleVariant`, but no creator text has a male variant in 2.31 [resource]. `game-text.ts` picks the variant by body gender. Whether the game selects by body or brain gender is [open question 15 of the file chain](../../knowledge/cc-file-chain.md#open-questions), and it only matters once a mod ships a gendered label.
- Photo mode keeps `femalePoses` and `malePoses` lists [resource]. Choosing between them by body gender is a [hypothesis]; it matters only for a later pose feature.

## 2. What differs between the feminine and masculine V

Paths abbreviate `base\characters\head\player_base_heads\` as `…\`. Unless stated, the masculine resources are **twins** at `…\player_man_average\` with `pma` where the feminine path has `pwa`, named from the **same** `.app` files (every creator `.app` holds both genders' appearances, told apart by name and `visualTags`) [resource]. Option counts are from the EP1 creator resources (`female_cco_ep1`, `male_cco_ep1`).

### 2.1 Head, face shape and skin

| Part | Feminine | Masculine | Grade |
|---|---|---|---|
| Head morph target | `h0_000_pwa__morphs.morphtarget`: 7,186 vertices, 13,186 triangles, 105 targets (5 regions × 21) | `h0_000_pma__morphs.morphtarget`: **7,190** vertices, **13,186** triangles, **100** targets (5 × 20, `h011`…`h201`, `…h205`) | [resource] measured |
| Head skeleton | 254 joints | 254 joints, identical names | [resource] measured |
| Head bounds (bind pose, m) | x ±0.091, y 1.492–1.800, z −0.090–0.129 | x ±0.118, y 1.480–1.808, z −0.096–0.151 | [resource] measured |
| UV0 bounds | u 0.013–0.987, v 0.005–0.993 | identical | [resource] measured |
| Face-shape options | `eyes`, `nose`, `mouth`, `jaw`, `ear`: None + 21 each | None + 20 each; same `(target, region)` keys up to `h20N` | [resource] |
| Skin type and tone | `skin_type` → `skin_type_01…05` → `h0_000__basehead(_d0N).app`, definitions `h0_000_pwa__basehead__<tone>`; 12 tones | same apps and tones, definitions `h0_000_pma__basehead__<tone>`; head albedos `h0_000_pma_c__basehead_d01…d05` | [resource] |
| Mesh-appearance names | `03_ca_senna_d03` | `01_ca_pale__d05` (different form) | [resource] ([head CC rendering §1](../../knowledge/head-cc-rendering.md#1-every-head-option-at-a-glance)) |
| Head proxy | `tpp_head_proxy` 16 definitions (12 tones + 4 named) | 12 | [resource] |

### 2.2 Eyes, lashes, brows and hair

| Part | Masculine difference | Grade |
|---|---|---|
| Eyes | `he_000_pma_c__basehead.mesh` with its own `he_000_pma__morphs.morphtarget` (20 `eyes` targets). **Chunk roles swapped**: chunk 1 is the wetness shell and chunk 2 the eye (feminine: the reverse). 71 colours, definitions `he_000_pma__basehead__<colour>` | [resource] ([eye rendering](../../knowledge/eye-rendering.md)) |
| Lashes | `hel_000__basehead.app`, 35 colours, definitions `male__<colour>`; the same eye component, lash chunk | [resource] |
| Brows | `heb_000_pma_c__basehead.mesh`: 390 vertices and 664 triangles like the feminine one, 100 targets, **the same `heb__base_*` textures**, a different own UV0 (u 0.029–0.924, v 0.111–0.955), lift 0.338–0.356 mm; definitions `male__<colour>`; 13 styles + none | [resource] measured ([eyebrows](../../knowledge/brows.md)) |
| Hair | `hairstyle` has 51 choices in a **different order** (first choice `hair_color38`), with masculine apps (`hair_color1` → `hh_000_pma__hairs_045.app`). The cyberware twins differ: 9 masculine-only and 6 feminine-only `hair_color_cyberware_NN` options | [resource] |
| Beard (masculine only) | `beard` switcher (13) → per-style part switchers `beard0…12` (slot `beard_part`, up to 7 parts) → 57 `beard_colorN_M` options (slot `beard_color`, link `beard color`, 35 colours) in group `beards`, e.g. `facial_hairs\hb_000_pma__big_beard.app`, `hb_000_pma__jesse_beard__mustache.app`. Each part draws a stubble decal (`hb_000_pma_c__basehead_shadowbase_01.mesh`, `mesh_decal` via `beard_shadow.mi`, alpha 0.75) and hair cards (`hair.mt` via `<colour>__beard.mi` → `_master__beard.mi`, chunk 0 hidden). ArchiveXL's `PlayerCustomizationBeardFix.xl` adds `@beard` dynamic names | [resource] [source] |

### 2.3 Face decals, piercings and teeth

- **Every face decal family has masculine twins in the same apps**: eye makeup (Off + 36 styles × 14 colours, `hx_000_pma__basehead_makeup_eyes__NN_<colour>`), lipstick (the same finish tree, 38 styles), cheeks (Off + 24), blemishes, facial tattoos (Off + 15), scars (Off + 13, `h0_000_pma__scars_…`) and face cyberware (Off + 16) [resource].
- The masculine cheek mesh `hx_000_pma_c__basehead_makeup_freckles_01.mesh` has the feminine one's vertex and triangle counts and UV bounds. Its material lists **the same 55 textures** (`hx_makeup_01…20`, `m08`, `m16`, the freckle and cyberware maps), and its two chunks sit 0.40 mm above the masculine head (median; 0.392–0.406 and 0.376–0.406 mm) [resource] measured. Vanilla therefore shares face-decal textures across genders over one UV layout, and lifts masculine decals exactly as feminine ones.
- **Piercings**: Off + 16 styles (feminine Off + 14); `i0_000__earring_12/13.app` hold only masculine appearances; 16 metals, definitions `i0_000_pma__earring__NN_<metal>` [resource] ([jewellery](../../knowledge/jewellery-resources.md)). A mod choice labelled by position can overwrite masculine style 15 or 16 ([file chain §5](../../knowledge/cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)).
- **Teeth**: 5 appearances `male_ht_000__basehead…` [resource].

### 2.4 Body, arms, nails and feet

| Part | Masculine | Grade |
|---|---|---|
| Body skin | `body_color` → `t0_000_base__full.app`, definitions `t0_000_pma_base__<tone>`; geometry `player_man_average\t0_000_pma_base__full.mesh`, a **plain skinned mesh with no breast morph** | [resource] |
| Groups | `TPP_Body` holds the same kinds of options as the feminine group; `breast` exists but is **empty**; no `flat_feet`/`lifted_feet`; `perspectiveInfo` pairs only `FPP_Body`/`TPP_Body` | [resource] |
| Arms | `holstered_default` (not split per perspective) = `h_default_arms_colors` (`a0_000_base__full.app`, `a0_000_pma_base__<tone>`), `nails_color`, **`personal_link_simple`** and `holstered_data` (the feminine personal link comes inside the arms app) | [resource] |
| Nails | `nails_color` (54, `a0_000_pma_base__nails_*`), lengths `a0_000_pma_base__nails_l_001`/`_r_001` | [resource] |
| Feet | No feet options, and **no feet controller** on `player_ma_tpp.ent` (it has the genitals, hairstyle, beard, nails, face and arm-cyberware controllers) | [resource]. That the body mesh draws the feet itself is a [hypothesis] for the first resolver run |
| Body tattoos and scars | 7 tattoos (`t0_000_base__tattoo_NN.app`, definitions `m__<tone>`, garment meshes rather than morph components); 4 scars (`scars_000…003_base.app`, `scars_pma_001__<tone>`) | [resource] |
| Idle | Body clip in `base\animations\ui\male\ui_male.anims`; the feminine preview decodes against `woman_base.rig`. The masculine body rig is not yet identified (`man_base.rig` is the [hypothesis]) | [resource] for the clip |

### 2.5 Censorship defaults

| Option | Masculine rule | Feminine rule | Grade |
|---|---|---|---|
| `body_color` / `body_color_censored` | Deactivate / Activate; the censored twin points at **`t0_000_fpp__full_censored.app`** (`t0_000_pma_fpp__<tone>`), a first-person app | Deactivate / Activate, `t0_000_base__full_censored.app` | [resource] |
| `underpants` | Activate; `male_001…005`, default 0 | Activate; `female_001…005` | [resource] |
| `nipples` | **no rule**; default `nipples_01` (None), `nipples_02` → `i0_000_base__nipple.app` | Deactivate; the body albedo carries them | [resource] |
| `genitals` | Deactivate; choices none / penis / circumcised / vulva (`genitals_00…03`) | Deactivate; the same anatomies in a different order (`genitals_04`, `01…03`) | [resource] |
| Gameplay underwear | Scripts equip `Items.Underwear_Basic_01_Bottom` only (`_Top` is feminine only) | Bottom and top | [source] ([body rendering](../../knowledge/body-rendering.md)) |

Under the Studio's policy (`bodyOptionDraws`), a masculine V without clothing shows a bare chest, the underwear cover at the groin, and `nipples_02` when chosen, because that option has no rule. That matches the game's censored gameplay look [hypothesis until the in-game check]. The FPP-path censored twin is never drawn, because the policy draws the uncensored twin.

### 2.6 Face rig, idle and blink

| | Feminine appearance | Masculine appearance | Grade |
|---|---|---|---|
| `h0_000__basehead_face_rig.app` graph | `player_woman_paperdoll_sermo.animgraph` | `pma_paperdoll_sermo.animgraph` | [resource] |
| Creator face clips | `ui_female_face.anims` | `ui_male_face.anims`: the same nine clip names plus `ui_closeup_to_fullbody` and `ui_fullbody_to_closeup` | [resource] |
| Skeleton | `h0_000_pwa_c__basehead_skeleton.rig` | `h0_000_pma_c__basehead_skeleton.rig` | [resource] |
| Facial setup | `h0_001_ma_c__player_rigsetup.facialsetup` (the **male** setup; the Studio's idle bake solves with the feminine head's own setup instead) | the same file, which is the masculine V's own | [resource] ([facial expressions §1](../../knowledge/facial-expressions.md#which-facial-setup-v-actually-uses)) |
| Photo mode | `player_woman_photomode_sermo`, `photomode_female_facial.anims` | `player_man_photomode_sermo`, `photomode_male_facial.anims` | [resource] |

The gaze-triggered blink additives (`generic_facial_additives.anims`) are authored on the male player rig [resource]. For a masculine V, the idle, blink and a later expression editor would solve with the setup the game names, with no substitution. Whether the male setup's pose data deforms the masculine head as the game shows is still a [hypothesis] until an in-game comparison.

## 3. The Studio before phase 1

Audit of `projects/xf-studio/authoring` at `4193fcb` (26 September 2026). Line numbers are at that commit. The [phase status](#phase-status) says how phase 1 resolved the rows of §3.2 and which remain for later phases (the idle tools, the package resources and the verifier).

### 3.1 Already gender-neutral (flows through the generic resolver)

- **Resolver**: `ccoPath` picks `male_cco(_ep1)`; `loadMergedCco` merges `.xl` `customizations.male`; R3–R10 are keyed by names and paths, never by gender (`character-resolver.ts` 121–180).
- **Catalogue and panel**: built per body gender (`cc-catalogue*.ts`, `cc-panel.ts`); the masculine catalogue already lists Facial Hair and the rest ([CC controls](../backlog/cc-controls-and-presets.md)).
- **Character context and requests**: `bodyGender` travels in the context, presets and requests (`character-context.ts`, `character-detail-request.ts`); the host's preparation resolves with the request's gender (`character-detail-service.ts` 747–767).
- **Planning**: slots come from creator slots and groups (`DETAIL_UI_SLOTS`, `FACE_GROUPS` including `beards`, `BODY_GROUPS` listing both `holstered_default_tpp` and `holstered_default`; `character-detail-plan.ts` 60–78, 291–305). Eye chunk roles come from the template (`render-templates.ts`), so the swapped masculine order needs no case.
- **Materials**: skin, hair, brow, face-decal, layered and eye adapters read resolved parameters only.
- **Lighting**: the creator rig already has a masculine light set and head slot (`creator-lighting.ts` 87–90: head at 1.67 m against 1.62 m) and follows the save's body (`saved-appearance-actions.ts` `bodySexOf`).
- **Export writer**: `archiveXlText` already writes a `male:` list when one is given (`platform/api/export.ts` 186–188).

### 3.2 Hard-coded feminine

| Where | What it assumes | Change needed |
|---|---|---|
| `src/preview-core-recipe.ts` 49–60 | One core recipe `xfs-preview-core-female-average`: the feminine eye mesh and morph paths, `gradient_brown`, eyeball **chunk 1** / `submesh_01_LOD_1` | A recipe per body gender (masculine eye chunk 2), chosen by the shown V; or retire the core eye in favour of the resolved eye, as the eye plan already does |
| `src/eye-plate-recipe.json` (`source`, `selection`) | The plate's source is the feminine head (audited 2.31 hashes), with feminine face ranges and `morphTargetCount` 105 | A second, audited masculine recipe (§4.1). `eye-plate-cut.ts` 147/227 and `eye-plate-verify.ts` 150 read the count from the recipe, so they need nothing |
| `src/preview-core-service.ts` 126–147, `src/eye-plate-service.ts` 254 | Default to the single recipe pair | Take the recipe pair from the body gender |
| `src/character-context-actions.ts` 262, 332, 486 | Prefetch, the detail request and legacy migration are feminine only; **a masculine V's detail request is the feminine default V** | Remove the gates once a masculine core exists |
| `src/character-detail-request.ts` 34, 89, 110 | `DEFAULT_CHARACTER` is feminine; `characterRequestFor` shows the feminine default for a masculine save | Default by the shown body; keep the version gate for older hosts |
| `src/character-follow.ts` 25 | Face shape follows only a feminine view | Follow either |
| `src/platform/scene/head-rig.ts` 221–224 | `applySavedV` throws for a masculine save | Load the masculine core; the checks below it are generic |
| `src/saved-appearance-actions.ts` 47, `src/lighting-setup-stage.ts` (`setBodySex`) | Clearing a save returns to the feminine rig | Follow the context's default body |
| `src/studio-ui/panels/character.ts` 73, 324 | **Default V** is always the feminine default | Offer both (the action already takes `bodyGender`) |
| `src/cc-render-coverage.ts` 64, 73, 96, 104, 112 | Every masculine option reads "not drawn" | Drop the masculine branches as parts land |
| `src/character-detail-plan.ts` 299 | Feet state names `flat_feet`/`lifted_feet` | Harmless for a masculine V (no such group, so nothing is added) but should be documented |
| `tools/prepare_idle.py` 33–40, `tools/bake_idle_face.py` 64–65, `tools/bake_game_blink.py` 177–236 | Feminine clips, skeleton, setup and morph targets | Parameterise by body gender (the blink bake already infers it from the rig name, line 183) |
| `src/package-resources.ts` 183, 197–219 | The template's `visualTags` is `Female`; one feminine customization option; `eyeMakeupXl` declares only `female:` | Per-gender resources (§4.3). **Done in phase 6** |
| `src/features/eye-makeup/verify/resource-checks.ts` 657–680 | "customizations must declare only the female list"; one plate | A verifier plan per gender (§4.4). **Done in phase 6** |

### 3.3 What each preview device assumes

| Device | Assumption today | For a masculine V |
|---|---|---|
| Core head (`core-detail-loader.ts`, `preview-core-*`) | The feminine head, eyes and plate, derived from base-game content | The masculine head and plate from his own recipe |
| Head skin placement (`head-skin-placement.ts`) | The resolved skin is drawn on the core head when the surfaces match. Otherwise the resolved chunks are drawn, the core is hidden and `head-shape` is reported | A masculine head against the feminine core never matches, so the head would draw without the plate and idle binding the core carries. Hence the masculine core first |
| Eye-shape selector (`face-morphs.ts`, `head-rig.ts`) | Choices listed from the head's own `eyes` targets | Generic: 21 choices (None + 20) from the masculine head |
| Idle and blink (`idle-animation.ts`, baked clips) | The feminine clip, skeleton and setup; the body on `woman_base.rig` | Masculine bakes (§2.6); the body rig to identify |
| Detail loaders and adapters | Generic | The beard's hair cards need a home (§5, phase 3) |
| Creator lighting | Rig by body | Already there |

## 4. XF Eye Artistry for a masculine V

### 4.1 A masculine plate is required

The plate is cut byte for byte from the head it sits on, and keeps the head's native skin bytes in both the mesh and the morph resource's base buffer (AGENTS.md, Expanded eye plate). The feminine plate cannot be reused: at the same UV the masculine surface is 4.9 mm away (median; 95th percentile 6.3 mm, max 8.3 mm), and its bones' bind poses, skin weights and 100 morph targets are the masculine head's [resource] measured.

The masculine cut is well defined by the feminine one:

| Measurement (WolvenKit 9.0.1 GLB exports of the 2.31 morph targets) | Value |
|---|---|
| Feminine plate vertices with an exact UV twin on the masculine head | 1,620 of 1,620 |
| Masculine chunk-0 triangles whose three corners all sit on those UVs | **3,010** (the feminine plate: 3,010) |
| Their UV area | 0.041558 against 0.041417 (+0.3 %) |
| Masculine vertices on those UVs | 1,629 (9 more: 53 plate UVs map to more than one masculine vertex, i.e. split seams) |
| Plate faces matched triangle for triangle by corner UVs | 2,458 exactly, 22 ambiguous, 530 differently triangulated |
| The same face indices on the masculine head | Land elsewhere (UV shift up to 0.49), so face ranges do not transfer |

The rule for the masculine recipe: **the masculine chunk-0 triangles whose corner UVs all belong to the feminine plate's vertex UVs**, stored as the masculine recipe's own face ranges and topology ([`eye-plate-recipe-pma.json`](../../projects/xf-studio/authoring/src/eye-plate-recipe-pma.json), revision 2), audited against the 2.31 masculine hashes.

**Audit (phase 5, 28 September 2026).** The feminine plate's gates, run on the masculine cut:

| Gate | Result | Grade |
|---|---|---|
| Selection | 3,010 triangles, 1,627 vertices, UV area 0.041558 (feminine 0.041417); stored UV bounds U 0.2732–0.7266, V 0.6763–0.8213, **identical** to the feminine plate's, so the texture window and every window constant are the same | [resource] measured |
| Native bytes | Every retained vertex element (10), the triangles in native order and winding, and all 69,920 morph diff rows of the 100 targets equal the installed 2.31 male head's; skin indices and weights identical in the mesh and the morph resource's base buffer (skin rows SHA-256 `5dd1e957…` in both); head quantization kept | [offline] the plate verifier (`eye-plate-verify.ts`) on the real cut |
| Raw topology | Components 20, 20, 791 and 796; 252 boundary edges in **11 loops**, **one pinched vertex**, no non-manifold edge (feminine: 20, 20, 790, 790; 226 edges; 6 loops; none) | [offline] |
| What the extra loops are | Each of the five extra loops (4, 4, 4, 6 and 8 edges) consists **only of edges the whole head also uses once**: they are the head's own slits, not gaps in the selection. The head stores 23 plate vertices twice at one position, and each pair has byte-identical normal, tangent, skin indices and weights and every morph target's position, normal and tangent delta, so the two copies never part under skinning, any morph or the lift along the normal. The pinched vertex (glTF UV 0.6016, 0.2329, pma vertex 5979) is where two such slits meet. The feminine plate has 16 such pairs too, where its two 20-vertex corner strips meet the rings, and its raw topology is already closed | [resource] measured on the GLB exports; confirmed on native bytes by the verifier |
| Welded topology | Welding only those copies: **2 components of 802 vertices, 198 boundary edges in 4 loops, no pinch**: each eye ring with its outline and its eye opening, exactly the feminine plate's welded shape (loops 69/71 and 29/29 edges against 70/70 and 29/29) | [offline] |
| Morph targets | All 100 (`h011`…`h205` by region), names, order and metadata equal the head's | [offline] |
| Lift | 0.40 mm along his stored normals, morph-aware, like hers; 22 of 100 targets re-encoded to the lifted range (largest position error 3.0 µm, largest morph delta error 6.6 µm); the vanilla masculine decals sit at 0.40 mm too (§2.3) | [offline] the package verifier on a real Build |
| Determinism | WolvenKit CLI 8.17.4 and 9.0.1 cut identical files (mesh `7e8975c2…`, morph `4397f3aa…`) | [offline] |
| Eyelid contact and clearance | Not run offline, as for the feminine plate: its offline dense-idle and finite-contact gates were never passed either and the masculine idle doesn't exist yet (phase 2). The feminine plate's contact gates were closed **in game** (28 September); his are session checks 2 and 3 (§6) | [hypothesis] until the session |

**The repair.** No triangle was added or removed and no byte changed: the recipe now declares the head's native seams (`selection.seams`: 23 welded vertices and the welded topology), and the plate verifier checks both the raw topology (pinches counted, not refused) and, from the plate's own bytes, that only copies with identical position, normal, skin and morph rows weld and that the welded surface is closed, unpinched and exactly the declared one. A head whose copies differ, or whose half-welded slit pinches, fails the gate. Welding the plate's own index buffer instead would have made the plate's triangles differ from the head's, which the plate rule forbids.

**Head-surface correspondence.** As for the feminine plate, the cut is the head's own bytes (the verifier compares every retained element and diff row with the installed head), so the plate is the male head's surface at every vertex before the lift.

### 4.2 One texture set for both plates

The export samples a flat or faceted preset through the plate's **UV window**: the plate's stored UV0 bounds widened by 1/64 and mapped onto the texture (`uv-window.ts`). The masculine selection has exactly the feminine plate's UVs, so its bounds and window constants are identical, and so is every compiled texture [resource for the UVs; the window rule is source]. That the same texel lands on the same anatomical spot of both faces is a [hypothesis], supported by vanilla sharing its decal textures across genders over one UV layout (§2.3). Consequences:

- A preset is authored once. The Studio's UV editor and compositor work in head UV space and need no masculine variant.
- Build compiles textures once and writes two plate meshes whose local materials name the same textures. Build time and archive size grow by one plate mesh and one morph target, not by a second texture set.
- The preview can show the same look on either V.

### 4.3 Declaring the masculine selector

ArchiveXL merges `customizations.female` into the feminine creator resource and `customizations.male` into the masculine one; a mod supporting both registers two resources [source: `Extension.cpp` 254–332; [file chain §5](../../knowledge/cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)]. A masculine build therefore adds:

| Resource | Feminine (today) | Masculine (proposed) |
|---|---|---|
| `.archive.xl` | `customizations: female: <cc>`; scope `player_customization.app: <app>` | adds `male: <cc_pma>` and `<app_pma>` to the same scope |
| Customization | one head option (Off + presets) in `character_customization` and `face` | a twin with the same selector name, groups and label (each gender's creator is separate, so the names don't collide) |
| `.app` | Off + template `xfs_c<collection>__xfs_template`, `visualTags` `Female` | **its own `.app`**: Off + a template whose component uses the masculine plate morph target, `visualTags` `Male` |
| Plate | `xfs_eye_plate` mesh + morph | a masculine mesh + morph (a name such as `xfs_eye_plate_pma`; existing names stay unchanged under the [naming contract](../../projects/xf-studio/data/naming.md)) |
| Definitions | `xfs_c<collection>__xfs_p<preset>` | the same names, in the masculine `.app` |
| Option `index` | 311, right after teeth (310) and before eye makeup (450) | **541**, right after his teeth (540) and before his eye makeup (550). In `male_cco_ep1`, 311 is `beard_color5_0`, and two options with one index show only the first [wiki] |

**Why a separate `.app`.** ArchiveXL clones a dynamic customization appearance from a template. When an `.app` has several appearances, it takes **the first one whose name starts with the requested name's part before its last `__`** [source: ArchiveXL 1.27.3 `Customization/Extension.cpp` 779–840, `FixCustomizationAppearance`]. Consider a masculine template in the same `.app` named by extending the feminine prefix (`xfs_c<collection>_m__…`). A feminine request (`xfs_c<collection>__…`) would also match it whenever it is listed first. Separate `.app`s per gender keep the existing names and remove the ordering hazard. The save then stores a different app hash per gender, which is expected.

The product-level merger (`platform/api/export.ts`) already combines gender lists. Only the eye-makeup feature's fragment (`eyeMakeupXl`) and plan need a gender list.

### 4.4 The verifier

`checkArchiveXl` (`resource-checks.ts` 657–680) requires exactly one feminine registration, and the plan carries one plate. The verifier plan needs a list of gender entries (customization, `.app`, plate mesh and morph, `visualTags`), each checked as today:

- selector shape, Off first;
- template component and morph binding;
- plate geometry against **its own** source head (skin bytes, lift, target count 105 or 100);
- the UV window per plate (equal by construction, and still checked).

The declaration check then accepts exactly the planned `female:` and/or `male:` lists. Check and Build must report per gender, and the partial-export rules apply per gender. A masculine plate that fails a gate is **omitted and reported**, never packaged silently, and the feminine selector still builds. A verified masculine archive is not game-tested until the session in §6.

**Built (phase 6).** The verifier (`features/eye-makeup/verify/`, still importing nothing from the builder) restates the bodies from the plan (his four files must be the feminine ones' `_pma` twins), the per-body visual tag (`Female`, `Male`) and option index (311, 541), checks his customization, `.app` and plate against his own plate input with his recipe's 100 targets, requires his plate's UV window to equal hers and every look to resolve to the same textures, and accepts exactly the planned `female:` and `male:` lists. Pixel and mip checks run once, on her plate's UVs. The report and the manifest carry `bodies` and his plate's inputs and record.

## 5. Phased plan

Effort: **S** about a day of agent work, **M** a few days, **L** a week or more. The phases run in order within each column, but phases 1–4 (preview) and 5 (the plate recipe) are independent tracks.

| Phase | Work | Effort | Gives | Needs |
|---|---|---|---|---|
| 1. Masculine core head | A preview-core recipe per body gender (masculine head, eyes with chunk 2, a plate cut per §4.1 for preview only); choose it by the shown V; lift the browser gates of §3.2 (detail request, follow, `applySavedV`, Default V for both, coverage). Head, skin, eyes, brows, lashes, hair, face decals and piercings then draw through the existing adapters | M | Any masculine V from a save, the default or a preset, with the plate area shown | Nothing new in the resolver |
| 2. Masculine idle and blink | Parameterise `prepare_idle.py`, `bake_idle_face.py` and `bake_game_blink.py` by body gender (masculine skeleton, the setup the rig names, `ui_male_face.anims`); identify the masculine body rig and its `ui_male.anims` clip | S–M | The creator idle and blink on a masculine V | The masculine body rig [hypothesis `man_base.rig`] |
| 3. Beard | The stubble already qualifies for the face-decal path (slot `beard_color`, group `beards`). The cards (`hair.mt`) need the hair adapter: a `beard` detail slot on `beard_color`, drawn like hair (highest LOD, no physics) | M | Beards | `@beard` dynamic names already resolve (R3) |
| 4. Masculine body | Confirm the body mesh's chunks and feet on a resolver run; `holstered_default` with its personal-link part; nipples without a rule; body tattoos as garment meshes; body idle rig | S | The masculine body and whole-body view | Phase 2's rig |
| 5. Masculine plate recipe | Derive the selection by the §4.1 rule; audit topology; skin-byte mapping in mesh and morph; 0.40 mm lift; clearance and contact gates; record the audited masculine 2.31 hashes; Build's installed-head route for the masculine head | M | A masculine plate Build can trust | The feminine plate's open gates apply equally |
| 6. Masculine export | Per-gender plan (`CollectionPlan`), customization, `.app` and plate; `eyeMakeupXl` with `male:`; verifier per gender; Check/Build/manifest per gender; the export's gender choice (§7) | M | XF Eye Artistry on a masculine V | Phase 5 |
| 7. Session | The §6 checks in one prepared session | – | Runtime evidence | The maintainer |

Phases 1 and 5 can start at once in separate worktrees. Phase 1 touches the preview core and browser gates, phase 5 the plate recipe and its tools, and the two meet only at the recipe type.

### Phase status

| Phase | State | What is there |
|---|---|---|
| 1. Masculine core head | **Built** (27 September, `claude/male-v-core`) | Below |
| 2. Idle and blink | Open | A masculine head holds still: the prepared idle is the feminine V's, so it is not played on him (`IDLE_MASCULINE`, in plain words in the Motion panel). The game blink refuses his head through its own joint check ("made for a different head") |
| 3. Beard | **Stubble drawn** [offline]; cards open | The stubble decal draws through the face-decal path like the makeup (beard 05, part 2, checked). The hair cards need the hair adapter on a `beard` slot |
| 4. Masculine body | **Drawn** [offline] | The same planner, consumer groups and censorship rules as the feminine body, with the gender gate removed: body, arms, nails, personal link and the underwear cover `i0_000_pma_base_full_censored` draw, and the body mesh draws the feet (no feet controller, as §2.4 expected). His body idle rig is phase 2 |
| 5. Masculine plate recipe | **Built** (28 September, `claude/masculine-export`) | The audited recipe with the head's native seams (§4.1); the preview and Build cut from it |
| 6. Masculine export | **Built** (28 September, `claude/masculine-export`) [offline] | Below |
| 7. Session | Open | [N12 in the next-sessions plan](../runtime/next-sessions-plan.md#n12-masculine-v-xf-eye-artistry-for-him) |

**What phase 1 built.**

- **A core per body.** `preview-core-recipe.ts` holds `PREVIEW_CORE_RECIPES`: the feminine recipe, whose identity is unchanged (`body` is left out of the recipe hash, so every cached feminine preview stays valid), and `xfs-preview-core-male-average`, which names his head and morph target, his eye mesh with the eyeball on **chunk 2** (`submesh_02_LOD_1`), and his head mesh's first appearance `01_ca_pale` (his mesh has no `default`). The derived files share the cache, with a status file per recipe, and are served under `/assets/pma/` (the feminine core stays at `/assets/`).
- **Prepared on first use.** The host prepares one body at a time (`snapshot(body)`, `prepare(body)`; the endpoint takes `?body=male` and `{ action, body }`). The feminine core is still prepared with the preview, the masculine one when a masculine V is first shown, with progress in the head pane (`PreviewPreparationActions.ensureBody`); it took 65 s on the maintainer's machine. If it can't be prepared, the feminine head shows with a plain notice, so the Character panel stays usable.
- **The shown V picks the head.** The head attachment loads the core of the V that the stored context and the save name (`initialBodyGender`), and loads the head again when the V changes body (a masculine save, the other Default V, a preset), carrying the Character panel's Undo history across (`ContextHistory`). The details and the facial shape follow only their own head's body (`character-follow.ts` `headBody`). Undo across a body change works [offline].
- **The browser gates of §3.2 are gone.** The detail request, prefetch, `characterRequestFor`, the facial-shape follow, `applySavedV` (a V of the other body is applied by that body's head), the creator rig on clear (it follows the loaded head's body) and render coverage (both bodies follow the same rules; the beard is `conditional` like the makeup) no longer assume a feminine V. `migrateLegacy` stays feminine: the retired tried-piercing fields only ever came from a feminine V.
- **Default V for both.** The Character panel offers **Default V (feminine)** and **Default V (masculine)** (the existing `character.useDefault` action with its `bodyGender`), and so does the command palette. The masculine default V is always stored, so a reload shows him again.
- **Drawn on a masculine V** [offline, the maintainer's install, the default masculine V]: head and skin on his core head (the resolved skin matches its surface and draws on it), eyes (None + 20 eye shapes, the eyes following), brows, lashes, hair, teeth, face decals (the personal link, the stubble), the eye makeup on his preview plate, and the body. The screenshots are private renders (the worktree's ignored `evidence/screenshots/male-v-core/`).

**The masculine plate recipe** (`src/eye-plate-recipe-pma.json`, derived by `tools/derive-plate-selection.ts` by the §4.1 rule from WolvenKit 9.0.1 GLB exports of both heads; the tool now also prints the `seams` block) is the one the preview assembles for his core head and the one Build cuts; its audit is in §4.1. Changing it to revision 2 changed the masculine preview core's identity, so his preview head is prepared once more (about a minute) the first time he is shown.

**What phase 6 built.**

- **An optional masculine plate prerequisite** (`eye-makeup/plate-masculine`; `optionalPrerequisites`, a platform API addition: prepared when the host offers it, never required). Both hosts prepare it after the feminine plate with the same service, route resolution and cache (his status in `status-xfs-expanded-eye-plate-pma.json`). A failure never stops the Build; only cancellation does.
- **A plan per body.** `planCollection(…, { masculine })` adds `masculine: { app, customization, mesh, morph }` (`xfs_collection_pma.*`, `models/xfs_eye_plate_pma.*`) and nothing else; the looks, names, materials and textures are shared. The resource builder lifts his plate, gives it her appearances and materials, writes his `.app` (visual tag `Male`, component bound to his morph target) and customization (index 541) with their own handle counter, so her resources are byte for byte the feminine-only build's. `.archive.xl` gains `male:` and his `.app` in the scope.
- **Plain words.** When his plate can't be used the mod is for a feminine V only, and Check, Build (the result card now shows a Build's notes too) and the manifest say so with the reason and one next step, e.g. "This mod is for a feminine V only: your game's male player head isn't one XF Studio has checked (it supports Cyberpunk 2077 2.31). Update XF Studio to include a masculine V." Before any Build prepared his plate for the route, Check says "Whether it can also be made for a masculine V is checked when you Build."
- **Checked offline** [offline]: a real Build of the four-preset fixture for both bodies on the reference installation (WolvenKit 9.0.1, 28 September) passed the independent verifier with 20 members (16 feminine, byte-identical to a feminine-only build of the same collection, plus his four), and a real derivation test of his plate against the installed game passes. Not seen in game.

## 6. In-game checks worth batching

One session with a masculine V made in a new game (keep the save), plus the reference feminine V for comparison. Record the game, ArchiveXL and TweakXL versions.

The prepared sitting, with the save needed and a staging checklist, is [N12 in the next-sessions plan](../runtime/next-sessions-plan.md#n12-masculine-v-xf-eye-artistry-for-him).

1. **Selector registration.** With a both-gender XF Eye Artistry build, the masculine creator shows one XF Eye Artistry row (between Teeth and Eye makeup, index 541), with Off first, in the creator, gameplay and photo mode (the `face` group).
2. **Plate placement and depth.** One Matte preset and one Metallic preset on the masculine V, close-ups at the creator's eye camera. The look sits on the lids without breakup at close range (the 0.40 mm lift), closes with the blink and follows eye shapes `None`, `h091` and `h201`.
3. **Same look, both genders.** The same preset on the feminine and masculine V, same framing: the liner and lid areas land on the same anatomical spots (the shared UV window).
4. **Save round trip.** Save with the masculine V wearing a look, reload it and hand the save over. The save should list the masculine `.app` hash with the preset's definition in `face` and `character_customization`.
5. **Beard.** Beard 5, part 2, in brown liquorice, against the preview: the stubble's strength and the cards' colour.
6. **Masculine body without clothing.** Photo mode, all slots stripped: a bare chest and the underwear bottom, with `nipples_02` visible when chosen. The feet are unchanged by footwear (no feet controller).
7. **Voice independence.** Create a masculine body with the feminine voice. Nothing visible differs from the same V with the masculine voice, and the XF selector behaves the same.

## 7. Risks and decisions

**Risks.**

- *Plate seams.* Resolved (§4.1): the masculine selection's extra loops and pinch are the male head's own seams, declared and checked; the cut, skin-byte mapping and verifier read every count from the recipe.
- *Shared textures on another face.* The window is identical by construction, but whether the same texel lands on the same anatomical spot of his face is session check 3. A preset that reaches her plate only where his triangulation differs (530 faces) would be invisible on him; the reach filter judges her plate only [hypothesis: negligible, the outlines match to 0.3 % of UV area].
- *Clearance.* The masculine eyelids are unmeasured; the feminine plate's contact gates are still open, and a masculine plate inherits that uncertainty.
- *Template matching.* ArchiveXL's prefix rule (§4.3) makes template names or order load-bearing; the separate `.app` avoids it.
- *Head mods.* Masculine head replacers exist the same way feminine ones do. Build must use the installed masculine head through the same `eye-plate-head-source` rules and refuse an unaudited head as it does today.
- *Tests assert feminine-only behaviour* (the verifier's "only the female list", the default-V gate). They change deliberately with phases 1 and 6.
- *Idle fidelity.* The body rig and helper joints are unknown for the masculine body, as they are for the feminine one ([body rendering, open question 1](../../knowledge/body-rendering.md#open-questions)).

**Decisions for the maintainer** (a default is proposed for each):

1. *Which body genders an export targets.* Proposed default: both, once the masculine plate passes its offline gates, because the texture set is shared and the extra cost is one small mesh pair. Until then, feminine only, with Check saying in one line that a masculine V isn't supported yet. The user can always choose one gender. **Built:** both by default, feminine only (said plainly) when his plate can't be prepared. A person's own choice of one body is not built yet (it would be a package-plan option and a UI control, for the UI track).
2. *The Default V control.* Proposed: two choices, "Default V (feminine)" and "Default V (masculine)", replacing the single feminine button.
3. *The preview-only core plate for a masculine V before phase 5 is audited.* Proposed: derive it by the §4.1 rule for the preview, labelled like the feminine plate's preview until Build accepts it.

## Provenance

- **Creator resources**: `female_cco_ep1` and `male_cco_ep1` (2.31) as serialized by WolvenKit CLI 8.17.4 into the ignored `research/consumers/cc-file-chain/json/`; hashes in the [vanilla CCO evidence](vanilla-cco-evidence.md). Options, groups, `perspectiveInfo`, censorship fields and default indices were compared with a read-only script (not committed).
- **Face rig and entity**: `h0_000__basehead_face_rig.app` and `player_ma_tpp.ent`, serialized in the same folder; the `ui_*_face.anims` clip names read from the extracted files in `research/consumers/expressions/extracted/base/animations/ui/`.
- **Geometry**: WolvenKit CLI 9.0.1 `uncook` GLB exports in the ignored `research/consumers/brows-cheeks/extracted/uncook/` ([brows and cheeks evidence](brows-cheeks-evidence.md) has the commands). Source resources (SHA-256):

  | Resource | SHA-256 |
  |---|---|
  | `…\player_man_average\h0_000_pma_c__basehead\h0_000_pma_c__basehead.mesh` | `034db61306fea1a6c96546360f37115640b68a0fd211e10f484697db6bb25766` |
  | `…\player_man_average\h0_000_pma__morphs.morphtarget` | `e68817d2ddc4b6cac831bb7287f0d9a7287a6f91c70ae8fa5e6e1f6a78db9c1b` |
  | `…\player_man_average\h0_000_pma_c__basehead\hx_000_pma_c__basehead_makeup_freckles_01.mesh` | `ea3eacbd898d7a528b83c20c4cbc045c38e4faffab0b4c13a8e7e9f047669d4d` |
  | `…\player_female_average\h0_000_pwa_c__basehead\h0_000_pwa_c__basehead.mesh` | `e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6` (the plate recipe's audited 2.31 source) |
  | `…\player_female_average\h0_000_pwa__morphs.morphtarget` | `3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e` (likewise) |

- **Masculine plate selection** (phases 1 and 5): `bun tools/derive-plate-selection.ts --reference <pwa morphs GLB> --target <pma morphs GLB>` over the same two GLB exports prints the selection block of `src/eye-plate-recipe-pma.json` (1,627 vertices, 11 boundary loops, one pinched boundary vertex) and its `seams` block (23 welded vertices, welded 802 + 802, 198 edges, 4 loops). The seam analysis (which loop edges the whole head uses once, and which coincident copies have identical attributes and morph deltas) ran as an uncommitted script over the same inputs under `tools/memory_guard.py` (peak 0.2 GB).
- **Masculine plate derivation** (phase 5): `ensureEyePlate` with `EYE_PLATE_MASCULINE_RECIPE` against the reference installation's base-game content (game 2.31), WolvenKit CLI 9.0.1 and 8.17.4, private cache outside the repository, 24 s: mesh `7e8975c2d2a5f429560096d8f5b78406e391e50322479a396240e34ccad9aedc` (145,185 bytes), morph `4397f3aa4899cce4042bc3335b6c9e4f2b3c0de3710346789bf23f48b1c7c449` (6,769,933 bytes), from the audited source hashes above. Reproduced by the opt-in `tests/eye-plate-game.test.ts` (`XFS_TEST_GAME_ROOT`, `XFS_TEST_WOLVENKIT`).
- **Creator option indices** (§4.3): `female_cco_ep1` and `male_cco_ep1` as above; feminine teeth 310, eye makeup 450, 311 free; masculine teeth 540, eye makeup 550, 541 free, 311 = `beard_color5_0`.
- **Vanilla visual tags** (§4.3): `hx_000__basehead_makeup_eyes_01.app` in the same serialized folder: 14 `pwa` appearances tagged `Female`, 14 `pma` tagged `Male`.
- **Plate correspondence method**: the feminine plate's faces were expanded from the recipe's `faceRangesInclusive`. Vertex UVs were matched exactly (quantised at 1e-5); triangles by sorted corner UVs at 1e-3 and 1e-4; the 3D offset is taken between the feminine plate vertex and the masculine vertex with the same UV. Lift is the offset from the nearest head vertex along that vertex's normal, as in the brows and cheeks evidence. The scripts ran under `tools/memory_guard.py` (peak 0.7 GB) and are not committed; their inputs are listed above.
- **ArchiveXL**: 1.27.3, commit `5474e34d`, `src/App/Extensions/Customization/Extension.cpp` (template selection 779–840).
- **Studio code**: `projects/xf-studio/authoring` at `4193fcb`.

## Related pages

[Head CC rendering](../../knowledge/head-cc-rendering.md) · [Body rendering](../../knowledge/body-rendering.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [Eyebrows](../../knowledge/brows.md) · [Eye rendering](../../knowledge/eye-rendering.md) · [Facial expressions](../../knowledge/facial-expressions.md) · [Worn clothing](../../knowledge/clothing.md) · [Save import](../eye-artistry/save-import.md) · [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md) · [CC controls and presets](../backlog/cc-controls-and-presets.md)

**Provisional decisions (coordinator, 27 September 2026, for the maintainer's review):** the three proposed defaults are taken: export both genders by default once the masculine plate passes its offline gates (feminine only until then); split the "Default V" button into feminine and masculine (built); show a preview-only masculine plate until Build accepts one (built).

**No masculine save exists among the reference saves** (165 saves, every one's metadata `bodyGender` Female), so phase 1 was checked on the default masculine V. A masculine save from a new game would let the save path be checked too (his own descriptors, his saved facial shape on his head); it is worth making in the §6 session.

