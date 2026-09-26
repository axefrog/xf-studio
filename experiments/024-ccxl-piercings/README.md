# Experiment 024: scripted CCXL piercing probe ("XF Piercings Probe")

**Status:** built and verified offline on 26 September 2026. **Not staged, not installed, not seen in game.** The coordinator stages it for the next in-game session and runs the [test card](#test-card-the-12-checks) through the runtime bridge.

**Purpose.** The [CCXL piercing feasibility study](../../research/jewellery/ccxl-piercing-feasibility.md) proposes piercings as XF-branded character-creator rows added by ArchiveXL, with owned pieces fitted to the head at their attachment point. Its [§6 test plan](../../research/jewellery/ccxl-piercing-feasibility.md#6-in-game-test-plan) asks for a scripted fixture: no editor and no third-party assets, three simple procedural pieces and the plan's fitting step, packaged as a throwaway XF-branded mod. This is that fixture, adjusted to the [decisions of 26 September](../../research/jewellery/ccxl-piercing-feasibility.md#decisions-26-september-2026): own XF rows **per area** after the vanilla Piercings row, fixed materials per piece, studs, hoops and septum rings first, female V first. Its twelve checks decide the attachment solver's defaults before any authoring UI is built.

Evidence grades: **[resource]** installed game or mod resources, **[source]** framework or tool source, **[offline]** checked here without the game, **[runtime]** seen in game, **[hypothesis]** not yet established.

## What the probe contains

| Row (creator label) | Option, index, slot | Choices (Off first) |
|---|---|---|
| **XF Ears** | `xfs_probe_piercings_ears`, 306, own `uiSlot` | Off · **Probe hoop** (silver, all 105 head targets) · **Probe hoop (ear targets only)** (same hoop, only the 21 `ear` targets) |
| **XF Nose** | `xfs_probe_piercings_nose`, 307, own `uiSlot` | Off · **Probe nostril stud** (silver) · **Probe septum ring** (silver) · **Probe stud + gold septum** (silver stud and gold ring in one look: per-piece materials) |

Both rows are female `gameuiAppearanceInfo` options with `useThumbnails = 0` (a stepper, like XF Eye Artistry), `editTags` `NewGame`/`HairDresser`/`Ripperdoc`, `randomizeCategory` `FaceModification`, and join the `face` and `character_customization` groups as vanilla `piercings_NN` do. Vanilla Piercings sits at 290–305 and teeth at 310, so the rows appear directly after the Piercings rows.

| Piece | Site | Shape | Placement (calibration) | Anchor head vertex |
|---|---|---|---|---|
| Hoop | V's left ear lobe | Ring, 1.2 mm wire, centreline radius 5.10 mm, 48 × 12 segments (637 vertices, 1,152 triangles) | Centre, plane and radius of the vanilla lobe hoop `earring_01` piece 2 (the one style 01 shows) | 4792, 0.81 mm from the ring's centreline |
| Septum ring | Columella | Ring, 1.2 mm wire, centreline radius 5.98 mm (637 vertices, 1,152 triangles) | Vanilla septum ring `earring_03` piece 0 | 5922, 0.69 mm from the centreline |
| Nostril stud | V's right ala | Flattened ellipsoid 2.5 mm across, 0.7 mm proud of the skin, lower half inside the head (187 vertices, 288 triangles) | Vanilla left nostril piece `earring_03` piece 1, mirrored to V's right; the head vertex within 2.5 mm of it that faces most outward | 2739 (the stud sits on it) |

V's left is −X (the head's `l_` joints sit at negative X). The right-side stud and the left-lobe hoop avoid every site vanilla style **06** uses (upper-cheek stud, labret, brows: `earring_02` pieces 0, 5, 10 and 12, decoded from the installed `.app` masks), which makes 06 the clean layering partner for check 2.

### How the pieces are fitted (the plan's fitting step)

The pieces are generated in [`fixture.ts`](fixture.ts) directly over WolvenKit's JSON form of the installed head, the way the eye plate is cut ([experiment 012](../012-native-plate-bootstrap/README.md#built-in-production-plate)):

- **Head resources.** The head mesh and morph target the launch route loads, resolved with the Studio's own route resolver ([`eye-plate-head-source.ts`](../../projects/xf-studio/authoring/src/eye-plate-head-source.ts)). On the reference installation the morph target comes from the Facial Customisation Rig Fix (same geometry as the base game) and the mesh from the base game. Build refuses a route whose head is changed by an `.xl` patch.
- **Skin: preserved bytes.** Every vertex of a piece carries the anchor's eight skin indices and weights, byte for byte (16 bytes; the head's 254-joint bone list is kept). The piece moves as one rigid body with the skin at that point, like PRC's linked meshes but without re-weighting.
- **Slider response: the anchor's own rows.** For each head morph target that moves the anchor, every piece vertex gets the anchor's 12-byte diff row, and the target keeps the head's quantization. The decoded position delta is therefore exactly the anchor's. The normal and tangent deltas are the word `0x5ff7fdff` that the vanilla banks use for "no change", so the piece translates rigidly. The head's target list is kept with its per-target rig matrices, as in the eye plate and PRC's linked pieces. The ear-only twin keeps only the 21 `ear` targets, as the vanilla ear banks do.
  - Hoop: 42 targets move the anchor (`ear` and `jaw`); the largest is `h115`, (5.05, −3.71, −1.74) mm.
  - Septum and stud: 42 each (`nose` and `mouth`); the largest are `h172` (1.35, −6.08, 3.10) mm and `h102` (3.49, −3.71, 4.86) mm.
  - So the ear-only hoop loses the **jaw** targets, which makes the jaw slider the discriminating test in check 5.
- **Vertex layout.** The head's layout minus its extra-data and light-blocker streams (vertex factory 4, eight influences), the same as the eye plate and the vanilla 8-influence bank pieces. Positions use the head's quantization; normals are Dec4 with top bits `01`; tangents `00`; vertex colour zero, as in the vanilla banks. Triangles follow the head's winding.
- **Materials by reference.** Each piece mesh has two appearances, `silver` and `gold`, whose local material instances have the vanilla `base\characters\common\character_customisation_items\earrings\i1_000_base_01__silver.mi` / `__gold.mi` as their base, as the vanilla banks do. Nothing from the game is shipped. The pieces' own UVs run along the ring (0–1) and around the wire (0–0.15), like the vanilla hoop's; that plain metals don't depend on the shared mask is a [hypothesis] this session tests.
- **Other deliberate details.** Each mesh gets a tight bounding box plus 10 mm for morph travel (as the vanilla banks have) and a geometry hash of its own bytes rather than the head's. Component names are `<morph>_<finish>`. The `.app` has an Off appearance that draws nothing, as XF Eye Artistry's does. No `.app` scope is declared, because nothing is dynamic.

### Differences from the §6 plan, and why

- **Rows per area instead of one row A**, following the 26 September decision. Check 3 (the Row B choice appended to the vanilla switcher) is therefore replaced by the per-area mix check: the XF Ears, XF Nose and vanilla Piercings rows worn together. Nothing is added to or merged into any vanilla option.
- **A septum ring instead of a brow bar** (first scope is studs, hoops and septum rings). The stud moved from the left nostril to the right one so that it never overlaps the vanilla left nostril piece.
- **Look 2's per-piece materials are the "Probe stud + gold septum" look**, and Look 3 is the ear-only hoop, compared with the all-targets hoop.

## Reproduce

```powershell
python tools/memory_guard.py --limit 6 -- bun experiments/024-ccxl-piercings/build.ts
```

The script reads the game folder, launch route and WolvenKit from XF Studio's saved setup (or the `XFS_RESOLVER_*` / `XFS_WOLVENKIT_CLI` variables). It is read-only towards the game and MO2. Everything it writes goes under the ignored `generated/<run>/`: extracted and serialized inputs, the resource JSON, logs, the staging tree, `package/archive/pc/mod/XF Piercings Probe.archive` and `.archive.xl`, the independent verification and `build.json`. The first run on a route fills `generated/resolver-cache/` (about 15 minutes on the reference installation, mostly reading 242 installed creator resources and the mods' texts once); `--resolver-cache <dir>` reuses another cache.

## Build record (26 September 2026)

Built with WolvenKit CLI 9.0.1 on the reference installation's MO2 route (Phantom Liberty installed, 1,079 mounted archives, 242 installed CCXL creator resources). The run `generated/20260926T132240/` holds the full record in `build.json`.

| Input | Provider | SHA-256 of the extracted resource |
|---|---|---|
| `h0_000_pwa_c__basehead.mesh` | base game (`basegame_4_appearance.archive`) | `e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6` (the eye plate's audited 2.31 head) |
| `h0_000_pwa__morphs.morphtarget` | Facial Customisation Rig Fix (`zz_FacialCustomizationFix_xBaebsae.archive`) | `16ec1faef790a0fcadb67d369d7cb2e1082594f31c336471412ac5ca6aecc5b2` |
| `i1_000_pwa_c__basehead_earring_01.mesh` (calibration only) | base game | `e6ff17ee8efbea93202401f3ec2aaa64f5aa4f0e2be1f9097da187f7a34e7c6b` |
| `i1_000_pwa_c__basehead_earring_03.mesh` (calibration only) | base game | `3d7969d3808955c77b17009d33877c9640f700a7e3a783104273d359cbb7fea4` |
| `i1_000_base_01__silver.mi`, `__gold.mi` (referenced, not shipped) | base game wins both paths | — |

| Output | Bytes | SHA-256 |
|---|---:|---|
| **`XF Piercings Probe.archive`** | 417,792 | `a52853e2c98162119bdee03cdcc8d63e7151787b3fab1aaf840bca8737486ff7` |
| **`XF Piercings Probe.archive.xl`** | 120 (CRLF) | `2bf9a071b481291333df7b2581c32487b067694da8e9aae58cd02eb2bfa143ae` |
| `…/models/xfs_probe_hoop.mesh` | 96,166 | `3c38eb68e26f8d2a39b42287ae49609ac882a9e7a425d5907e541fb0c0e08ea8` |
| `…/models/xfs_probe_hoop.morphtarget` | 6,482,679 | `60fa837969ab84fbf4fcade7aa2596c05d67c252cefceae1ff62688dc3eb8430` |
| `…/models/xfs_probe_hoop_ear.morphtarget` | 1,323,587 | `36c251b0cefd2efc189fe41408e23ae26a2091b91e4ccfbcf3a793bb2fcafab6` |
| `…/models/xfs_probe_septum.mesh` | 96,199 | `aebabc35b201a3e44de57cc22756da130607df86ac3630fdd110886085ee28a1` |
| `…/models/xfs_probe_septum.morphtarget` | 6,482,713 | `4d390e79e3021ec78135de1a760625ea80e738e59565624615cd13e3aafd2e8a` |
| `…/models/xfs_probe_stud.mesh` | 91,192 | `4295640623aa74729017f903b3a0e06dad9e3c527873129869e2525d9922a203` |
| `…/models/xfs_probe_stud.morphtarget` | 6,477,403 | `fa98340a1d24ba4f911a17d297de11eb7ce7a8b3729a97d9912e1c0990b1b96b` |
| `…/xfs_probe_piercings_ears.app` | 2,689 | `712b59ce370645a494656d47b6f0ab19120378863b4356b1d8a1c93655f60f95` |
| `…/xfs_probe_piercings_nose.app` | 3,609 | `16c582cc89124bce9a0e9f7e1a279b2f6d47054aa96ca9c6839223fbb04ba9fd` |
| `…/xfs_probe_piercings_pwa.inkcharcustomization` | 2,166 | `b8c5562c4a07b21b6bc05794d0160558ef44ff0bee43526c1141f8324b495d17` |

`…` is `axefrog\appearance_studio\probes\piercings_024`. The `.archive.xl` is exactly:

```yaml
customizations:
  female: axefrog\appearance_studio\probes\piercings_024\xfs_probe_piercings_pwa.inkcharcustomization
```

The morph targets are about 6.5 MB each because each carries the head's 254-joint rig matrices for all 105 targets (the ear-only twin, 21 targets, is 1.3 MB). A later production build could share one piece mesh and morph across looks and drop targets that don't move the anchor, once check 5 says which are needed.

## Offline verification (24 checks, all passed)

[`verify.ts`](verify.ts) re-reads everything itself, without the generator's encoders. The Studio's product verifier ([`product-verifier.ts`](../../projects/xf-studio/authoring/src/platform/export/product-verifier.ts)) first unbundles a copy of the archive and requires exactly the ten staged members by path, length and hash, and the `.archive.xl` text byte for byte. Each member is then serialized again with WolvenKit and checked:

| Check | Result [offline] |
|---|---|
| Members and paths | Exactly the 10 planned resources, all below `axefrog/appearance_studio/probes/piercings_024/`: no vanilla or third-party depot path is shipped |
| `.archive.xl` | Only `customizations.female`; no scope, fix, patch, copy or link |
| Creator resource | Two head options exactly as in the table above (names, own slots, indices 306/307, labels, Off first); no body or arms options; both rows in `character_customization` and `face` only |
| `.app` files | Off draws nothing; each look's compiled components name the right morph target and finish; visual tag `Female` |
| Meshes | One chunk, vertex factory 4, the head's bone list (254) and position quantization; **every vertex's skin bytes equal the anchor's**, in the head mesh and in the head morph's base buffer alike; finishes point at the vanilla `.mi` paths; no external materials; geometry hash differs from the head's |
| Morph targets | The head's targets (all 105, or the 21 `ear`) with their rig matrices unchanged; exactly the targets that move the anchor carry rows, on every vertex, with the anchor's position word and the head's quantization (decoded deltas equal the anchor's bit for bit) and neutral normal/tangent words; base blob identical to the mesh's |
| **Additive merge** | The installed female creator (base resource, ArchiveXL fix, 242 installed CCXL resources) merged by the Studio's replica of ArchiveXL 1.27.3's merge (`cco-model.ts`) with and without the probe: all **1,236 head, 73 body and 32 arms options are deep-equal**; only the probe's two rows are appended; only the `character_customization` and `face` groups gain entries, and only those two |
| Unique names, slots, indices, labels, paths | No installed option, slot or definition uses the probe's names; 306 and 307 are free (neighbours 305 `piercings_14` and 310 `teeth`); none of the seven labels is shown by an installed option or choice, and none is numeric; no mounted archive provides any probe path |

A private render of the three pieces on the extracted head (not committed) showed the hoop passing through the left lobe, the septum ring through the columella and hanging to the lip, and the stud half-buried on the right ala.

**Limits.** None of this shows how the game renders or deforms the pieces. In particular, whether rigid anchor-copied pieces stay seated through sliders and facial animation, whether the vanilla `.mi` looks right on these UVs, and how headgear treats the new components are exactly what the session answers.

## Staging notes for the coordinator

- Stage the two files from `generated/20260926T132240/package/archive/pc/mod/` as one MO2 mod named **XF Piercings Probe** in the test profile, next to XF Eye Artistry, without changing anything else. Check the hashes above first.
- Needs ArchiveXL (1.27.3 is current and installed). Female V only.
- Checks 12 and the PRC half of check 2 need eagul's PRC framework enabled in that profile; record whether it is.
- Check 11 needs the mod switched off between two launches and then back on.

## Test card: the 12 checks

Tool names are the runtime bridge's MCP names ([bridge test card](../../research/runtime/runtime-bridge-test-card.md) for conventions). **M** is the maintainer, **C** the coordinator. `cc_apply` takes the option's internal name and the choice's position in the merged row. For the probe rows that is 0 = Off, then the looks in the order above. For vanilla `piercings`, *N* is style *N* (0 = Off). For the morph sliders `ear`, `nose`, `mouth` and `jaw`, 0 = None and 1–21 are the shapes. The bridge never confirms by itself. Every capture is `capture_screenshot {region: "face", name: "024-<step>"}` after a 1.5 s wait unless noted.

**Before the session.**
- C records the game, ArchiveXL, TweakXL and Codeware versions (framework check), whether Phantom Liberty and PRC are enabled, and the staged archive's SHA-256.
- M loads a save beside a mirror (or uses Character Customization Anywhere's F12, if A10 of the bridge card showed that it opens the edit mode), then makes a manual safety save before the first change.
- Stage the ordering so the creator block comes first, then photo mode, then the save and reload, and the missing-mod check last.

| # | Who | Do | Expect | Settles |
|---|---|---|---|---|
| 1 | M, C | M opens the mirror creator. C: `game_wait {phase: ["character_menu"]}`, `player_appearance {option: "xfs_probe_piercings_ears"}`, `player_appearance {option: "xfs_probe_piercings_nose"}`, `player_appearance {option: "piercings"}`. M looks at the list: **XF Ears** and **XF Nose** directly after the Piercings rows and before Teeth; M scrolls the Piercings row once. *Optional:* M checks the same in a new game's creator (the bridge only drives the edit mode) | Both XF rows are read with Off + 2 and Off + 3 choices. Vanilla Piercings still lists Off + 14, with PRC's option 12 intact if PRC is on | Registration, index placement, nothing replaced |
| 2 | C | `cc_apply {option: "piercings", index: 6}`, `cc_apply {option: "xfs_probe_piercings_ears", index: 1}`, `cc_apply {option: "xfs_probe_piercings_nose", index: 3}`, capture `02-layer` | Vanilla style 06 (cheek stud, labret, brows), the silver hoop, the stud and the gold septum all visible at once | Layering of own rows with vanilla |
| 3 | C | With check 2's state: `cc_apply {option: "xfs_probe_piercings_nose", index: 1}`, capture; `index: 2`, capture; then `cc_apply {option: "piercings", index: 0}`, capture `03-xf-only` | Each XF row changes on its own; the ears row keeps its hoop while the nose row changes; vanilla Off leaves both XF rows as they were | Rows per area mix and match (replaces the plan's Row B check) |
| 4 | C | Ears 1, nose 3, vanilla Off. For `ear`, `nose` and `mouth`: `cc_apply {option: <slider>, index: k}` for k = 1, 6, 11, 16, 21, capture each (`04-<slider>-<k>`), then back to the V's own value (read it first with `player_appearance {option: <slider>}`) | Hoop stays on the lobe under `ear`; septum and stud stay seated under `nose` and `mouth` (no gap, no sinking) | Morph following of generated pieces |
| 5 | C | For ears index 1 (all targets) and then index 2 (ear targets only): `cc_apply {option: "jaw", index: k}` for k = 1, 11, 21 and `ear` for k = 11, 21; capture each (`05-<look>-<slider>-<k>`); restore | Look 1 follows the jaw slider; the ear-only hoop does not (the anchor moves under 21 `jaw` targets), so it may float off or sink into the lobe under jaw shapes; both follow `ear` equally | Which regions a piece needs |
| 6 | M, C | With looks on (ears 1, nose 3), C: `cc_confirm`. C: `photo_open`, wait 2 s, `photo_frame {target: "face", look_at: "off", xf_preset: true}`, `photo_hud_hide {}`, capture `06-front`. Then `photo_frame {target: "face", yaw_offset: 60}` and `-60` with captures (one shows the left ear). Then `photo_expression_set` with two strong expressions (a wide smile and an open mouth; pick from `photo_state {options: true}`), capture each, front and at the left-ear angle. M also watches the creator idle before confirming | Pieces move with the face, no gap or penetration in profile or close views | Skinning of generated pieces |
| 7 | C | In photo mode, the front and close captures of the gold septum and silver stud (nose look 3). Then `photo_exit`; M reopens the creator; C: `cc_apply {option: "xfs_probe_piercings_nose", index: 2}` and capture silver on silver | Gold ring and silver stud together in one look; silver and gold read as the vanilla metals do | Per-piece materials (and the vanilla `.mi` on our UVs) |
| 8 | C | Photo-mode captures from check 6 against the creator captures of checks 2–5; `capture_screenshot {region: "head-and-shoulders"}` in third person if a mirror scene is available | Same look in photo mode and gameplay third person as in the creator | The `face` group consumer |
| 9 | M, C | C: `cc_confirm` (if the creator is open). M makes a manual save, reloads it and opens the mirror. C: `player_appearance` for both XF rows; capture. Then `cc_apply` both XF rows to 0, capture `09-off`, `cc_back` | The looks persist after reload and the mirror shows them selected; Off clears both rows; Back discards the Off | Persistence and clearing |
| 10 | M, C | M equips a full helmet, then a face mask (inventory). C: in photo mode, `photo_frame {target: "face"}`, capture each | Record whether the XF pieces hide when vanilla piercings hide (put vanilla 06 on too for comparison) | Headgear interaction |
| 11 | M, C | M makes a throwaway save with ears 1 and nose 3 and quits. C switches **XF Piercings Probe** off in MO2 (nothing else). M launches, loads the throwaway save and opens the mirror; C: `player_appearance` for `piercings` and the face, capture; M notes any load warning. M quits; C switches the probe back on; M loads the throwaway save again and C reads both XF rows | Record what the face shows and whether the load warns, and whether the choices come back once the mod is back | Missing-mod behaviour (tombstones needed or not) |
| 12 | C | With PRC enabled: `cc_apply {option: "piercings", index: 12}`, ears 1, nose 3; capture | PRC's bank and both XF looks visible together; PRC's option 12 unchanged | Coexistence with a replacement framework |

**Evidence to keep.** The bridge JSON of every step, the captures (private), the ArchiveXL log lines naming `xfs_probe_piercings_pwa.inkcharcustomization`, and the versions above. Results go into this README's results section and into the [feasibility study](../../research/jewellery/ccxl-piercing-feasibility.md) and [jewellery knowledge page](../../knowledge/jewellery-resources.md). Checks 4–6 decide the attachment solver's defaults (rigid anchor copy or per-vertex transfer like the vanilla banks), check 5 decides which regions a piece carries, check 10 may add a visual-tag task, and check 11 decides whether tombstone definitions are needed.

## Files

- [`fixture.ts`](fixture.ts): the probe's identity, pieces and rows; site calibration, anchors and procedural geometry; the byte-level mesh and morph writers; the `.app`, creator resource and `.archive.xl`. Pure.
- [`verify.ts`](verify.ts): the independent structural checks and the additive-merge check. Pure.
- [`build.ts`](build.ts): the host script (route, extraction, conversion, packing, verification, build record).

## Staging

26 September 2026: the two files of run `20260926T132240` (hashes above) are in the MO2 mod folder `XF Piercings Probe`, not yet enabled: MO2 was open, so its profile list wasn't edited under it. Before the session, enable `XF Piercings Probe` in the test profile (it appears after a refresh), or the coordinator adds it once MO2 is closed. Nothing else changes.

