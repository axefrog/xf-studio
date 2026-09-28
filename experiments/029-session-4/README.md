# Session 4: finish sweep, cheek check, photo-mode expressions and parity, creator colour checks

**Status:** run on 28 September 2026 through the runtime bridge; results and the offline analysis are below. The coordinator drove the bridge; the maintainer was at the game, opened the creator with F12 and gave the judgement answers. The session took rows from the [next-sessions plan](../../research/runtime/next-sessions-plan.md): the 0.4.1 preflight, N1's Gloss verdict (1.5), N2's headgear row (2.6), N13, N7, N5 and N6. Structure follows [session 3](../028-session-3/README.md#5-results-28-september-2026).

**Evidence.** Private and ignored, never committed: the notes with verdicts word for word and the full bridge log with every JSON answer (`local/sessions/2026-09-28-session-4/`), and the 599 capture files (full frames, crops and JSON sidecars), copied to their canonical home `experiments/029-session-4/generated/captures/`. This page names captures by their capture name only (`s4-glossC-yaw0` is `<timestamp>-s4-glossC-yaw0.full.png`). The offline numbers in §4 come from [`analyse_captures.py`](analyse_captures.py), which reads those captures and prints every figure quoted here.

**Grades.** **Pass** and **Fail** answer the step's own criterion. **Inconclusive** means the step ran but can't answer (a confound, a missing frame, or a criterion that the frames can't resolve). **Void** means the frames don't test what the step asked. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[runtime]** seen in the game, **[offline]** measured from the captures, **[hypothesis]** not established.

## 1. Setup

| Item | State |
|---|---|
| Game | 2.31 (product 2.3.1, file 3.0.80.51928), borderless window 3840 × 1600, captures by `printwindow` |
| Bridge | **0.4.1 `-writes`**, build commit `911ad89941accdbe34500f1db1b2dfd603efad14` (not dirty), protocol 1, 10 natives. Write classes photo, world, character, **inventory** (approved for this session) and save |
| MO2 profile | `XF Studio diagnostic 2026-09-25` |
| XF Eye Artistry | Still the **session 2 diagnostic build** (`xfs_c0200a5e52e554c029d0b0000000000d0`, Off + 12; [experiment 020](../020-session-2/README.md#build-record-25-september-2026)). The alpha.2-built (`hx_`) export was not staged, so the headgear row couldn't test it. The sweep left **Metal ramp · lifted confirmed on V** for the rest of the session, including N5 and N6 (the plan wanted XF Off there) |
| XF Expressions | "Cheek check" set staged ([plan N13](../../research/runtime/next-sessions-plan.md#n13-cheek-check-smiles-in-photo-mode)); it showed as the last three of 210 photo-mode expressions |
| Creator | Opened with F12 (Character Customization Anywhere): `edit_mode` `NewGame`, `updating_finalized_state` true. The bridge's `cc.open` was used once, at the start of the finish sweep (§5) |
| Other mods that mattered | Photomode Facial Expression Mega Pack, Photo Mode Ex, Realistic Complexion III, **Ultra+ v9.0.0_rc2**, **Thread Locker**, **Hide Body Parts - Body Toggles** |

**Ultra+ was enabled, and it confounds the skin and parity results.** Its panel and user config (MO2 overwrite, `UltraPlusConfig.ini`) showed:
- mode RT, denoiser NRD DLSS, ray-traced lighting with path-traced bounce (RT+PT), More Bounce Light on;
- **quality Auto** with a 45 fps target, SHaRC High, streaming Auto, Hair Lighting Fixes and Preem Hair Support on;
- rendering features: **CAS sharpening on**, tonemapping, bloom, SSAO, **Object/NPC Rim Enhancement on**, Character Subsurface Scattering on and **Character Subsurface Translucency on** (the mod ships it off; its own tooltip gives the game's default as On).

Its shipped configuration explains why this matters [resource: the mod's `config/graphics.ini`, `config/skin.ini`, `lib/GameMenu.lua`]:
- `graphics.ini` writes `/graphics/advanced/SubsurfaceScatteringQuality` per quality tier (High 2, Med 2, Fast 1, Potato 0, 3077 2), and `GameMenu.lua` manages that setting, so with quality on Auto Ultra+ can override a menu change;
- `skin.ini` sets skin tuning per mode; for RT: `SubsurfaceSpecularTintWeight` 0.5, tint (0.19, 0.18, 0.22), `AllowSkinAmbientMix` false, `SkinAmbientIntensity_Factor` 0.3, `UseAOOnEyes` true.

So every frame of this session, creator and photo mode alike, carries Ultra+'s RT skin tuning, CAS sharpening and rim enhancement, and the photo-mode frames an automatically varying quality tier. CAS and rim enhancement both change how the face reads against the Studio. **Every parity and skin number below is provisional.** Whether Ultra+ was enabled in sessions 1–3 isn't recorded, so those sessions' frames should be treated as having unknown Ultra+ settings too.

**After the session** the test profile has Ultra+, Thread Locker and Body Toggles **disabled**: Thread Locker hid equipped headwear, and the Body Toggles head item didn't hide the head. The plan's "Before every sitting" now checks this and re-checks the game's SSS quality setting, which Ultra+ may have written.

## 2. Run order

1. Preflight (bridge 0.4.1).
2. Finish sweep (plan 1.5): three runs, the third complete.
3. Headgear (2.6).
4. N13 cheek check: three passes (`n13-*`, `n13c-*`, `n13d-*`).
5. N7: R1, R2, parity E4–E7, the parting line, the first back-lit ear try.
6. N5 creator colour block.
7. 7.7 back-lit ear, rerun with an ear-clear hairstyle.
8. 7.6 skin scattering quality.
9. N6 creator sweep B, discarded with Back.

## 3. Results

### 3.1 Preflight (bridge 0.4.1)

The rows of the [test card's session-4 preflight](../../research/runtime/runtime-bridge-test-card.md#session-4-preflight-bridge-041) that were recorded:

| Check | Result | Grade |
|---|---|---|
| P1 build | 0.4.1, commit `911ad89`, 10 natives, all five write classes | Pass |
| P2 message line | `ui.message` readable in game | Pass |
| P3 framing | `photo.frame` converged on the first try with the camera level (`s4-p-face-full`, `s4-p-face`) | Pass |
| P6 light placed about V | Placement by azimuth, elevation and distance lights the face well; `placement.route: "moved"`, `held: true` (`s4-p-light-az`) | Pass |
| P7 light placed at the camera | Doesn't light the face | Fail |
| P9 `cc.open` in the apartment | Opens (mirror scenario, `HairDresser`) away from a mirror, but leaves the creator's backdrop half-open over gameplay and the busy flag stuck; `cc.confirm` refused `busy`, and only loading a save recovered (§5) | Fail |
| P11b Confirm keeps a change | `changes` 1, `closed_with: "confirm"`, the change kept | Pass |
| P13 helmet | `inventory.equip Items.Helmet_01_basic_01` put the helmet into the Head slot (`equipped: true`), but it doesn't draw on V: Thread Locker hides equipped headwear (the inventory said the item was restricted to the inventory) | Void |
| Other rows | Not recorded | — |

### 3.2 Finish sweep: Gloss A–D, Shimmer, Metal (plan 1.5)

Per preset: `cc.apply` the XF row, the creator's eye framing (`s4-<preset>-creator`), Confirm, midnight, photo mode, face framing, **light 1 neutral (hue 0, saturation 0), brightness 45, placed at azimuth 25°, elevation 20°, 1 m**, HUD hidden, captures at yaw 0, ±15 and ±30 and the eyes framing (`s4-<preset>-yaw<n>`, `s4-<preset>-eyes`).

- **Run 1 void:** `cc.open` left the creator stuck (§5).
- **Run 2 partial:** A and B complete; C's frames failed while a stopped background run kept driving the game (§5).
- **Run 3 complete:** A, B, C, D, Shimmer and Metal, the verdict set.

| Preset | Verdict | Grade |
|---|---|---|
| Gloss A–D | **Gloss C (all rough) is clearly the flattest, so the written roughness drives the shine.** A, B and D show wet highlights, A the strongest. The four stripes of A and D don't separate at face framing, so no preset reads as four distinct finishes there. The maintainer on the sheet: "I think they look okay?" | Pass that roughness is what shows; Inconclusive for four distinct finishes |
| Shimmer · strong | The maintainer: "The dots are way too big... like it's trying to show them at the scale you'd see under a microscope." A regular grid of dots | Fail: Shimmer needs randomised, much finer facets (the plate UV window allows them) or a sheen-first design |
| Metal ramp · lifted | The ramp's stripes are the test pattern itself (the board's steps), not an artefact | Pass (as session 3) |

### 3.3 Headgear (plan 2.6)

| Step | Result | Grade |
|---|---|---|
| Vanilla helmet | Equipped (Head slot) but not drawn, because of Thread Locker (`s4-helmet`, `s4-helmet-side`, `s4-helmet2`) | Void |
| Head-hiding item | The Body Toggles head item (`Items.scorpion_zenitex_body_toggle_head`, slot InnerChest, "Head: Full") didn't hide the head in photo mode or in the inventory preview (`s4-hide-head`); the inventory preview may be a separate system [hypothesis]. It is not a `hide_Head` garment test either way | Void |
| `hx_` component | The alpha.2-built export wasn't staged | Not run |

### 3.4 N13 cheek check

| # | Result | Grade |
|---|---|---|
| 13.1 Listed | The set's three entries appear as the last three of **210** photo-mode expressions, as "Glee", "Cheek check smile" and "Cheek check smile and raise", with **menu values 207, 208 and 209**. The card's 217–219 are their table indices (faceIds), which `photo.expression.set` refuses: it takes the menu's value (R2 below). The ArchiveXL log wasn't checked | Pass (listing); log not checked |
| 13.2 The lump | First pass (`n13-*`) **void**: the 217–219 selections were refused, and the framer drifted (FOV 21° → 93°, then 3° at `near_far` −5 with the camera behind a wall; §5). Second pass (`n13c-*`, pose reset before each frame) converged on the **default face framing: FOV about 60–66° at `near_far` 0.75, about 35 cm**, a selfie lens that inflates the nose and cheeks. Third pass (`n13d-*`, seeded at FOV 22 and `near_far` −1.2) converged at **about 9°**, a portrait lens, at yaw 0, −25 and −45, plus neutral (faceId 0). The bunched cheek beside the nostril and upper lip shows in game at the same place as in the Studio's renders. At the portrait lens it reads milder than those renders, but the lens, the lighting and the facial setup (R1 below) all differ, so size isn't settled. From long photo-mode experience, the maintainer reports that **the cheek bulge on smiling is a consistent trait of the game's rig at every framing**: the wide lens exaggerates it but doesn't cause it | Pass for place; Inconclusive for size |
| 13.3 Smile against smile and raise | At the portrait lens, −45°, 208 and 209 look nearly identical: the cheek raiser doesn't visibly round the cheek, as offline | Pass (by eye) |

The maintainer's reading of the frames: the expressions "look better in the studio, more comical in game... lighting makes a massive difference to render quality in game". The Studio's render quality is something the game reaches only under near-perfect lighting. Photo-mode expressions usually read as unrealistic and undercut a photo's gravity, unless frozen at a very subtle intensity. Two ideas from this are banked in the [backlog](../../research/backlog/README.md): export at a chosen intensity (or a small intensity ladder), and a bridge-applied photo-mode lighting rig that matches the Studio's. The [XF Natural Face Overrides](../../research/animation/facial-correctives-tuning.md) idea stays valid.

### 3.5 N7 photo mode: expressions, parity, eye and skin light

| # | Result | Grade |
|---|---|---|
| 7.1 R1 | **`face_rig` lives on the NPCPuppet stand-in, not on the head item.** The stand-in's `face_rig` (`entAnimatedComponent`) has facial setup `6833a322173f7bdd`, graph `5e58ab89d2287d68` and rig `5af1e771498830a5`, and its own animation lists are empty. The same entity carries `man_face_base_animations` (57 gameplay sets) and `PhotomodeAnimations` (16 sets), all at priority 200, with the Mega Pack and the Cheek check set installed. The head item `Items.PlayerWaPhotomodeHead` (`gameItemObject`) has none of the three components. This is the opposite of the card's expectation. **The hashes resolve** by FNV-1a64 of depot paths [offline]: the facial setup is the **male player setup** `base\characters\head\pma\h0_001_ma_c__player\h0_001_ma_c__player_rigsetup.facialsetup`, the graph is `base\animations\facial\_facial_graphs\player_woman_photomode_sermo.animgraph`, and the rig is `base\characters\head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\h0_000_pwa_c__basehead_skeleton.rig` | Pass (answered) |
| 7.2 R2 | **The menu value is not the table index.** Menu 56 is "Static: Sleeping", which is `photo.expression.index` 60; menu 52, "Static: Skeptical", matches index 56. That is an offset of 4 at this point of the list in this install; by the end of the list it is 10 (faceIds 217–219 at menu 207–209). **Only the stand-in (target `puppet`) takes `photo.expression.index`**; the head target changes nothing, as R1 predicts. The face holds for at least 5 s, and undo through the menu restores it (`r2-menu-56`, `r2-neutral`, `r2-puppet-56`, `r2-head-56`, `r2-puppet-60`, `r2-head-60`, `r2-hold`, `r2-neutral2`, `r2-head-only-60`, `r2-menu-52-skeptical`, `r2-puppet-56b`, `r2-undo`) | Pass |
| 7.3 Parity E4–E7 | E4 ran at midnight, not 02:00: `world.time.set` refuses in photo mode (`not_in_gameplay`). Light 1 at brightness 60 **overexposes the face at 1 m**. E5's light-on frame was lost (the capture step asked for an unknown region); `e5-light-off` and `e5-light-off2` were kept. E6 yaw −30/0/+30 (`e6-yaw*`) and E7 eyes 0, ±15, ±30, 45 (`e7-eyes-yaw*`) were taken with their `photo.subject` JSON, and the eyes again at brightness 45 (`e7b-eyes-yaw*`). What the JSON gives is in §4.5 | Inconclusive: frames and readings captured; the light fit (C7) lacks its light-on frame; the analysis waits for the parity tooling; Ultra+ Auto quality makes it provisional |
| 7.4 Cornea against iris | The eyes framing puts the eyes at the bottom edge of the `eyes` crop (both passes, §5), and at 45° the fringe covers the near eye. Catch lights are small and sharp at yaw 0 | Inconclusive |
| 7.5 Wetness shell | — | Not run |
| 7.6 SSS quality | Menu confirmed High. Raking light (azimuth 90°, elevation 10°, 0.8 m, brightness 45), camera yaw −60/0/+60 and a double-span frame, full resolution. **The first High run is void**: it started inside the ear test's photo-mode session, so scene light and reflections differ (17.8–24.5/255 from Low). Repeatability, Low against Low with each run started from gameplay: **1.67–1.82/255**. High against Low: **1.45–1.70/255**, the same as the noise floor. The quality setting made no visible difference at these framings. That fits the stochastic-blur reading, but Ultra+ manages this setting under Auto quality (§1), so the menu change may not have reached the renderer. A restart need is unverified. The setting was left on High | Inconclusive (Ultra+) |
| 7.7 Back-lit ear | First try (`ear-az*-yaw*`, Kala Messy Pixie, then Valby Curtain Bob): `yaw_offset` is capped at ±90; one warm rim at azimuth 180/yaw 90, not conclusive. **Rerun** (`ear2-*`, an ear-clear hairstyle, 3840 × 1600; light 1 at brightness 45, elevation 5°, 0.5 m; azimuth 180, ±150, ±120; yaw ±60, ±90; no-light references): **at azimuth −150/yaw −90 the whole ear glows deep red-orange, redder than the directly lit neck beside it**; at azimuth 150/yaw 90 and −120/yaw −90 the helix rim shows red-orange transmission; the no-light frames are neutral grey-brown. Azimuth 180 sits directly behind the head, which blocks the light. Caveat: the glass behind V reflects her and the light; the ear crops exclude the reflection, but it may add a little fill. Measurements in §4.6 | **Pass: translucency runs**, with Character Subsurface Translucency on |
| 7.8 Parting line | Neutral face, yaw −30/0/+30 (`part-yaw*`): no thin bright line along the closed-mouth parting at any yaw, under light 1 | Pass (none shows) |

### 3.6 N5 creator colour block (the creator's own lighting)

| # | Result | Grade |
|---|---|---|
| 5.1 Parity E0–E2 | — | Not run |
| 5.2 Tint encoding | Skin type 1 with tones 1 (**warm ivory**), 5 (**senna amber**) and 2 (**limestone**); type 3 with tone 5; type 5 with tone 2 (`n5-5.2-*`). Every apply went through, with no busy lock. The plan's tone numbers were the creator's one-based labels (1 pale, 5 senna, 2 warm ivory), but they were applied as `cc_apply` indices, which count from 0, so the frames show other tones than the plan's pass marks assume. §4.2 fits the tones actually shown. **The darkening points to sRGB-decoded `TintColor`** | Inconclusive leaning sRGB (provisional) |
| 5.5 Piercings and the heart eye | Style 9 black, style 1 silver and gold (head page), eye colour 24 (`n5-5.5-*`). **Gold shows gold** (the ring's bright pixels average (210, 195, 182)); **black plastic keeps its colour** and a narrow highlight; **the heart sits upright**. The silver highlight's colour and the metal body are in §4.1 | Pass for colour mask and heart; key-light colour neutral (§4.1); metal body Fail (not near black) |
| 5.6 Decal order | Eye makeup 5, cheeks 10, facial tattoo 2 then 8, brows 1 (`n5-5.6-order-*`). What the frames show is in §4.4 | Inconclusive (XF Metal on V; brow tails under hair) |
| 5.7 Strength anchors | Blush 5 against 1; tattoos 9 and 2 on tone 1, default colours (`n5-5.7-*`). **Cheek choice 1 is a freckle pattern, not a blush**, so the blush pair doesn't compare strengths. Tattoo 2 reads slightly stronger than tattoo 9 (§4.4); no dark-tone frame | Inconclusive (blush); Pass for relative tattoo strength |
| 5.8, 5.9 | 5.8 was done in session 3; 5.9 (ray tracing off) not run | — |

Rows recorded on the way [runtime]:
- **Hairstyle switcher indices follow the option list's order.** With installed packs the row has 283 styles: 90 Grace Bob V4, 96 Kala Messy Pixie, 100 Viessa Bun, 217 Valby Curtain Bob, 220 Viv Loose Waves. The reference V wears 142, "LONG PAK - #011" (`lm097_hair`, ash brown 58).
- **Piercing colour order (per style):** 0 silver, 1 gold, 2 pearl, 3 copper, 4 red, 5 pink, 6 black, 7 blue, 8 mixed, 9 mixed 2, 10 neon teal, 11 pink metallic, 12 rainbow, 13 rose gold, 14 steel, 15 wood.
- The appearance diff after restoring every option showed only the hairstyle and its linked hair-colour rows changed.

### 3.7 N6 creator sweep B (discarded with Back)

| # | Result | Grade |
|---|---|---|
| 6.1 Choice counts | `player.appearance`, Off and installed mods included: eye makeup 37, lip styles 38 per finish (Default, Glossy, Matte, plus Off in `makeupLips_type`), cheeks 25, face cyberware 17, facial tattoos 16, piercings 15, teeth 5, eyebrows 70, hairstyles 283 (285 cyberware variants), eye colours 254. **The resources' counts plus Off (36/38/24/16/15), not the wiki's** | Pass |
| 6.2 Link propagation | `skin_color` 3 (limestone beige), `skin_type` 1 → 5, `facial_tattoo` 6 (`n6-link-*`). `skin_color` stays 3 through both type changes, and **the body keeps tone 3** (§4.3). The creator's body framing doesn't show the hands | Pass for body; hands not framed |
| 6.3 Lip finish tree | `makeupLips_type` 0 Off, 1 Default, 2 Glossy, 3 Matte. **The style position carries across finishes**: style 8 (value "09") stayed at 8 through Default → Glossy → Matte → Off → Glossy, each finish's own style row taking the position (`n6-lips-*`). The colour sub-row can't be set from the lips page (`makeupLips_08` "can't be changed on this screen"; the colour row for value 09 is probably `makeupLips_09`), so colour carry-over is untested | Pass for style; colour not tested |
| 6.4 Linked hairstyle | Hairstyle 5 (value "06"); face cyberware 1 switches the row to `hairstyle_cyberware` at the **same index 5** (value "06"); cyberware 2–4 don't switch it. The hair looks the same with and without (`n6-hair5`, `n6-hair5-cyber1`, `n6-hair5-cyber0`, `n6-hair5-cyber4`) | Pass (see the caveat in [CC file chain](../../knowledge/cc-file-chain.md#in-game-results-session-4)) |
| 6.8 Teeth | Choices 0–4 are base, silver, gold, copper (labelled "cooper") and pink. The frames (`n6-teeth0`…`4`) show a closed mouth under the CET overlay's Ultra+ window, so they hold no teeth colour | Labels Pass; colour frames Void |
| 6.9 Body | Breast choice 2 (`full_breast_big`) captured (`n6-body-breast2`, private); not yet compared with the preview | Inconclusive |
| 6.5–6.7, 6.10 | — | Not run |

## 4. Offline analysis

Method for every figure: [`analyse_captures.py`](analyse_captures.py) on the full-resolution captures, run under the memory guard (peak 0.9 GB). Pixels are the game's 8-bit SDR output after tone mapping, grading and Ultra+'s CAS sharpening. "Linear" means only the sRGB transfer undone, not the grade (the parity design's LUT inversion isn't built), so ratios are display-derived. The idle moves V by a few pixels between frames, so the boxes sit in smooth regions away from edges.

### 4.1 N5.5: the silver highlight and the metal body

Frame `n5-5.5-p1-silver`. The nose ring (box 2050,1028, 40 × 85) separated from skin by its chroma (skin is warm, R − B about 20–30; metal pixels have R − B < 5). Metal pixels bucketed by luminance:

| Luminance | Pixels | Mean RGB | B/R | G/R |
|---|---:|---|---:|---:|
| 235–255 (highlight cores) | 39 | (238.3, 241.6, 242.3) | 1.016 | 1.014 |
| 200–235 | 130 | (216.8, 222.8, 224.2) | 1.034 | 1.028 |
| 150–200 | 83 | (161.1, 177.0, 183.4) | 1.138 | 1.098 |
| 100–150 | 68 | (120.6, 132.6, 137.6) | 1.141 | 1.100 |
| 30–100 (body between highlights) | 14 | (81.7, 85.4, 87.1) | 1.066 | 1.045 |

- **The highlight cores are neutral within about 2 %**: the key lights read white. By the pass mark, the preview's warmer lit skin then lies in the albedo's decode (candidate 3 of [skin §11.8](../../research/materials/shader-skin.md#118-checks-and-measurements)), not in an unset light colour. Limits: the cores sit within 15 levels of clipping, where tone mapping pulls chroma toward white, so a small tint can't be excluded.
- **The unclipped flanks are cool (cyan, B/R about 1.14).** That is the side facing V's left, where the creator's cyan-white rim and cyan fills shine ([creator lighting](../../knowledge/creator-lighting.md)), so it reads as those lights, not the key.
- **The metal body between highlights isn't near black**: its darkest pixels are about 58, and the dark inner arc averages (88, 94, 95), against the pass mark of under 10/255. So something lights the metal between the highlights: ambient, environment reflections, or the ray-traced reflections that Ultra+'s RT mode runs. Step 5.9 (ray tracing off, with Ultra+ off) separates them before `a` is fitted ([creator lighting §11](../../knowledge/creator-lighting.md#11-an-environment-for-the-creator-preset-recommended)).
- Gold for comparison: bright ring pixels (luminance over 150) average (209.8, 194.7, 182.2), B/R 0.87.

### 4.2 N5.2: tone strength and TintColor encoding

Frames `n5-5.2-type1-tone1`, `-tone5` and `-tone2`. They are warm ivory (tone 1: `TintColor` 255,245,181, `TintScale` −0.15, an overlay), senna amber (tone 5: 199,116,112, 0.52, a multiply) and limestone (tone 2: 131,149,83, 0.38) on skin type 1 ([head CC rendering §2](../../knowledge/head-cc-rendering.md#2-skin-type-tone-and-the-complexion-texture-set)). The plan's pass marks (a fifth or two fifths) were written for plain senna against pale, so the test uses the shader's own arithmetic instead. It predicts each tone's albedo multiplier under both encodings at tint-mask weight `m`, with albedo under 0.5 so the overlay is `a(1 + w(2T − 1))`, and fits `m` per region.

Predicted at full mask weight (m = 1):

| Encoding | Amber/ivory (R, G, B) | Luminance | Limestone/ivory (R, G, B) | Luminance | Limestone B/G |
|---|---|---:|---|---:|---:|
| byte/255 | 0.770, 0.630, 0.666 | 0.662 | 0.709, 0.740, 0.700 | 0.730 | 0.946 |
| sRGB-decoded | 0.676, 0.508, 0.571 | 0.548 | 0.614, 0.653, 0.660 | 0.645 | 1.011 |

Measured (display-decoded ratios, same framing and light):

| Region | Amber/ivory (R, G, B) | Luminance | Limestone/ivory (R, G, B) | Luminance | Limestone B/G | Fit, byte: m, rms | Fit, sRGB: m, rms |
|---|---|---:|---|---:|---:|---|---|
| Lit cheek | 0.742, 0.652, 0.702 | 0.678 | 0.777, 0.772, 0.807 | 0.776 | 1.045 | 0.85, 0.039 | 0.65, 0.027 |
| Shadowed cheek | 0.631, 0.527, 0.570 | 0.555 | 0.708, 0.706, 0.717 | 0.707 | 1.016 | 1.22, 0.059 | 0.92, 0.045 |
| Chin | 0.708, 0.612, 0.647 | 0.637 | 0.719, 0.718, 0.724 | 0.719 | 1.008 | 1.05, 0.028 | 0.79, 0.019 |
| Upper chest (body) | 0.646, 0.540, 0.579 | 0.569 | 0.651, 0.663, 0.667 | 0.660 | 1.007 | 1.29, 0.035 | 0.97, 0.021 |

**Reading: sRGB decoding fits better in every region**, for three reasons:
- **Lower residual.** sRGB fits every region with a plausible mask weight (0.65–0.97).
- **Byte/255 runs out of range.** It needs weights above 1 in three regions, which the mask can't give; at m = 1 it can't darken the shadowed cheek or the chest as far as the game does.
- **Limestone's hue.** Its blue-to-green ratio is above 1 in every region (1.007–1.045). Under byte/255 it must fall below 1 at any weight, because limestone's multiply takes more blue than green. This test is nearly independent of `m`.

Amber darkens this skin by 32–44 % in luminance: nearer the "two fifths" reading.

**Limits.** The ratios are display-referred: the grade's curve and Ultra+'s RT skin tuning and CAS sit between the albedo and the pixel, and the complexion replacer's albedo and the mask values per region are unknown. So this **supports sRGB decoding [offline, provisional]** and doesn't settle [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions). The confirming frame is the same five tones with Ultra+ off, beside the Studio's render of the same tones under both decodings. Warm ivory against pale (the plan's "warmer and a little brighter") wasn't taken.

### 4.3 N6.2: tone 3 on the body across skin types

Frames `n6-link-type1-body` and `n6-link-type5-body`.

| Region | Type 1 | Type 5 | Ratio (R, G, B) |
|---|---|---|---|
| Upper chest, left | (136.8, 119.9, 98.0) | (137.4, 119.8, 97.2) | 1.004, 0.999, 0.992 |
| Upper chest, right | (172.8, 156.1, 137.5) | (169.1, 152.1, 133.4) | 0.978, 0.974, 0.971 |
| Left shoulder (edge-lit) | (145.0, 127.4, 107.6) | (137.8, 118.6, 97.8) | 0.950, 0.932, 0.908 |
| The creator's tone swatch | (126.3, 99.1, 68.2) | (126.3, 99.1, 68.2) | 1, 1, 1 |

The whole frame differs by 2.4/255 on average, which is idle motion. The chest keeps its colour within 3 % and the swatch is identical, so **the body follows tone 3 through the type change**. The shoulder's 5–9 % is on its lit edge, where the idle moves the highlight. The hands are not in the creator's body framing, so the hands half of the ask stays open.

### 4.4 N5.6/5.7: decal draw order and strengths

The draw-order frames carry the XF Metal ramp look, which the sweep had confirmed, so the lids and brow are its colour. What they show [runtime, read by eye from full-resolution crops]:
- **Tattoos over blush.** Tattoo 8's diagonal stripe and tattoo 2's gun draw dark over the cheek blush (cheeks 10), with no blush tint on the ink.
- **Tattoos and the XF plate.** A vanilla facial tattoo stays visible where it crosses the XF band: tattoo 2's script line and tattoo 9's line show across the blue band, and tattoo 8's grey mask darkens the band where they overlap. Whether the tattoo draws over the plate or shows through a partly transparent band isn't separable in these frames. At the upper lid, the XF lid colour covers tattoo 8's grey.
- **Not readable:** the lower lid (vanilla eye makeup 5 sits under the XF Metal look) and the brow tail (under the fringe of Kala Messy Pixie).

Strength (display luminance, ink against skin on the same rows, tone 1):

| Tattoo | Ink | Skin | Ratio |
|---|---:|---:|---:|
| 2, star core | 40 | 118 | 0.34 |
| 2, gun (row 900 / row 920) | 39 / 42 | 78 / 91 | 0.49 / 0.46 |
| 9, line (row 900 / row 920) | 41 / 50 | 80 / 91 | 0.52 / 0.55 |

Tattoo 2 reads slightly stronger than tattoo 9, as the ask expects. Ink colour and opacity aren't separable without the ink's tint for this tone.

### 4.5 R2 and parity E5–E7: what the JSON gives

- **Default face framing:** FOV 66.4°, camera 0.363 m from the head (`e5-subject`, `e6-subject-0`), `near_far` 0.75, `up_down` −0.03, `approximate: false`.
- **Yaw frames:** `yaw_offset` −30 and +30 converged at V's yaw **+36.3° and −37.9°** (FOV 64.3° and 64.6°, 0.37 m), ±15 at ∓18.5°, and 45 at −56.2°. The framer's `yaw_offset` is opposite in sign to photo mode's yaw attribute and about 1.25 times smaller, apparently compensating for the wide lens's off-axis view [hypothesis].
- **Eyes framing:** FOV 38.4°, 0.393 m, `near_far` 0.728 (`e7-subject`). Residuals under 0.006 of the frame.
- **Light:** E5's light-on frame is missing, so the light-only difference (C7) can't be formed from this session. P6's placements are recorded in each `photo.light.set` answer (`placement.after`, `head`).
- **R2:** everything is in §3.5. The expression list JSON (`photo.state` key 28) has 210 options; data values run 0–209, and every selection answered with the menu value it applied.

### 4.6 N7.6 and N7.7

- **SSS quality** (face box 1650,480, 550 × 670, mean absolute difference per channel value):

  | View | Low/Low2 | High2/Low2 | High2/Low | Void High/Low |
  |---|---:|---:|---:|---:|
  | yaw −60 | 1.67 | 1.64 | 1.60 | 17.77 |
  | yaw 0 | 1.66 | 1.53 | 1.57 | 18.20 |
  | yaw 60 | 1.69 | 1.45 | 1.61 | 24.49 |
  | double span | 1.82 | 1.63 | 1.70 | 23.50 |

- **Back-lit ear** (ear box 1540,800, 110 × 190; neck box 1360,1080, 100 × 100):

  | Frame | Ear mean | Ear R/G | Lit neck R/G |
  |---|---|---:|---:|
  | Azimuth −150, yaw −90 | (128, 90, 74) | 1.42 | 1.04 |
  | Azimuth −120, yaw −90 | (179, 144, 122) | 1.25 | 1.11 |
  | No light, yaw −90 | (30, 28, 32) | 1.07 | 1.17 (unlit) |

  The ear is far redder than the lit neck beside it, and neutral without the light. The decoded `UseTranslucency` setup adds only a **sun** term ([skin §6.4](../../research/materials/shader-skin.md#64-translucency-the-usetranslucency-setup)), but this light is a photo-mode local light at midnight. So local lights reach a transmission path too: either an unread variant, or the ray-traced lighting Ultra+'s RT mode runs [hypothesis].

## 5. Bridge and tooling problems found

1. **`cc.open` away from a mirror** (the mirror scenario) leaves the creator's backdrop half-open over gameplay and the busy flag stuck; only loading a save recovers. F12 with Character Customization Anywhere worked all session. Switch `cc.open` to that mod's route when it is installed.
2. **A stopped background sweep kept running.** Stopping the task didn't kill its bash and bun grandchildren, which went on driving the game and spoiled run 2. They were killed by command-line match. Run sweeps in the foreground, and give the session runner a stop file and a parent-exit check.
3. **`photo.open` by SendInput steals focus** and caught the maintainer's typing. Open photo mode in-engine in the next build. After an inventory change it also refused (`photo_not_allowed`, a menu was up).
4. **Framer drift.** `photo.frame` starts from the current pose. Across repeated yaw frames `near_far` walked to −4.7 and −5 and the FOV to 3°, and the camera ended behind a wall. Workaround: reset the pose with `photo.camera.set` before each frame. Fix: bound `near_far` per target, or reseed from a known pose.
5. **The default face lens is a selfie lens** (about 66° at about 35 cm). Seed face captures at FOV 22 and `near_far` −1.2, which converges to about 9°.
6. **Limits:** `photo.frame`'s `yaw_offset` is capped at ±90, so the back of the head can't be framed; the light's azimuth accepts at most 180. `yaw_offset`'s sign and scale differ from the yaw attribute's (§4.5).
7. **`world.time.set` refuses in photo mode** (`not_in_gameplay`); photo mode's own time attribute (70) is the route there.
8. **Light placed at the camera doesn't light the face** (P7); placement about V does (P6).
9. **The `eyes` region sits the eyes at its bottom edge** at the eyes framing (`e7-*`, `e7b-*`, `s4-*-eyes`): the framing target and the crop disagree by roughly the brow-to-eye height.
10. **`photo.expression.set` takes the menu's value, not the faceId.** The session card listed faceIds (217–219), which it refused; say which in the card, or accept a faceId and map it through the menu data.
11. **Creator labels against indices.** N5.2's tone numbers were one-based creator labels but went to `cc_apply` as zero-based indices. The plan's index convention covers piercings and eye shapes; it needs a line for skin tones, and the card should give the value (`03_ca_senna`) rather than a number.
12. **Session tooling:** the capture helper asked for an unknown region for `e5-light-on`, which was lost. The first SSS High run started inside an open photo-mode session: each run of a comparison must start from gameplay.

## 6. What this settles and where it went

| Result | Updated |
|---|---|
| R1, R2, face framing, lens, drift, lights, time | [Facial expressions](../../knowledge/facial-expressions.md), [photo mode](../../knowledge/photo-mode.md), [expression editor design §8](../../research/animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge) |
| Gloss verdict, Shimmer | [Experiment 020](../020-session-2/README.md), [decal reference §13](../../research/materials/shader-decal.md#13-in-game-test-asks-batch-into-the-prepared-session), [Shimmer design](../../research/materials/finish-designs/shimmer.md), [materials and shaders](../../knowledge/materials-and-shaders.md#in-game-test-asks) |
| Ear translucency, SSS quality, key-light colour, tint encoding | [Skin reference §10–§11.8](../../research/materials/shader-skin.md#10-in-game-test-asks-batch-into-the-prepared-session), [materials and shaders](../../knowledge/materials-and-shaders.md#in-game-test-asks), [creator lighting](../../knowledge/creator-lighting.md#125-refitting-from-new-matched-captures), [head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks) |
| Counts, links, lip tree, hairstyle rule and order, piercing colours | [CC file chain](../../knowledge/cc-file-chain.md#in-game-results-session-4) |
| Capture settings for parity | [Game parity measurement §1.6](../../research/authoring/game-parity-measurement.md#16-exposure-grade-and-post-processing) |
| Plan, backlog, status | [Next-sessions plan](../../research/runtime/next-sessions-plan.md), [backlog](../../research/backlog/README.md), [status](../../docs/status.md) |

**Decided or unblocked:**
- **The expression editor's facial setup (question D1).** The live photo-mode face solves with the male player setup, so by D1 the preview switches its default setup to match. That is a follow-up, not done here.
- **The Gloss question is answered as far as face framing allows:** written roughness is what shows, and roughness 1 is visibly flattest.
- **Shimmer's rework direction:** randomised, much finer facets, or a sheen-first design.
- **Ear translucency runs.**

**Still open:**
- the `hx_` headgear check, now possible with Thread Locker off;
- 7.6 with Ultra+ off;
- the ray-tracing-off metal frame (5.9);
- the tint encoding's confirming frame with Ultra+ off;
- the hands for the tone link;
- lip colour carry-over;
- the Glitter board and the piercing probe;
- the masculine sitting, which still needs a masculine save made in a new game.
