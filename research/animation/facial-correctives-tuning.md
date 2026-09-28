# Facial correctives tuning and XF Natural Face Overrides: design note

**Status: banked later feature (28 September 2026), not built.** It waits for the current product to be finished and polished ([backlog](../backlog/README.md#later-features--discuss-with-the-maintainer-before-building-each)), and the maintainer decides whether to build it. It starts from a diagnosed defect in the game's own facial setup: a smile bunches the cheek into a sharp lump beside the nose and upper lip instead of lifting and rounding the whole cheek under the eye. The same lump shows in game (report of 28 September) [runtime].

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[resource]** the game's files, **[source]** tool or engine source, **[offline]** measured here with the pinned solver, **[runtime]** seen in the running game, **[hypothesis]** not established. The facial rig itself is described in [facial animation §1](../../knowledge/facial-animation.md#1-from-control-values-to-moving-bones) and [facial expressions](../../knowledge/facial-expressions.md).

## 1. The diagnosis

**Not a preview bug.** The Studio's preview solves with the pinned, unmodified IO Suite solver (commit `7a4ee793`) and applies its local deltas to the head's joints; there is no port to disagree with. Replaying the solver's stages one by one (`tools/facial_attribution.py`) reproduces `solve_runtime` exactly (largest difference 0 in every rotation and translation), and the face driver's binding was matched to the same solver earlier (6 × 10⁻⁶ mm, [facial animation §6](../../knowledge/facial-animation.md#6-the-idles-upper-face)) [offline]. The game shows the same lump [runtime]. So the lump comes from the facial setup's data. Which setup the engine solves V with (the female head's own, or the male player setup the face rig names) is still open (R1); the male setup's poses move 5–15 % less but have the same structure [offline], and this note uses the female head's setup, as the preview does.

**Where the lump comes from** [offline, female `h0_000_pwa_c__basehead_rigsetup.facialsetup`, solved and posed on the rig; positions in model space; `projects/xf-studio/authoring/tools/facial_attribution.py`]:

| Joint (right side; the left mirrors) | Rest height (mm) | `lips_r_corner_up` at 1: up / out / forward (mm) |
|---|---:|---|
| `r_J_mug_mouth_rowB_3` (upper lip, beside the corner) | 1630 | 9.6 / 9.5 / −7.8 |
| `r_J_jaw_nosabial_rowA_1` (the fold line beside the nose and lip) | 1631 | 10.6 / 9.9 / −6.5 |
| `r_J_jaw_nosabial_rowB_1` (the next row out) | 1637 | 2.5 / 8.5 / −1.3 |
| `r_J_jaw_nosabial_rowC_1` | 1652 | 2.0 / 7.8 / 0.9 |
| `r_J_eye_check_rowE_0` (lower cheek) | 1666 | 2.0 / 4.5 / 0.7 |
| `r_J_eye_check_rowD_0` (malar cheek under the eye) | 1677 | 1.3 / 1.8 / 0.3 |

- **The main pose `lips_[lr]_corner_up` is the cause.** It has one in-between at 1.0 (linear in weight) and moves 107 joints. It lifts the fold line beside the nose and upper lip about 10.6 mm while the row just outside it rises 2.5 mm and the malar cheek 1.3 mm. The 8.0 mm between `jaw_nosabial_rowA_1` and `rowB_1` closes to 4.4 mm (−46 %): the tissue beside the nose is pushed up and back into a row that barely moves, and the skin between them folds into a ridge. The fold forms early and peaks mid-way: the gap closes by 31 % at weight 0.3, 47 % at 0.5, 56 % at 0.7 and 46 % at 1 [offline].
- **The cheek raiser cannot round it out.** `eye_[lr]_oculi_squint_outer_lower` (AU6; two in-betweens at 0.5 and 1.0, scope multiplier 2) moves the malar cheek mostly *forward* (3.7 mm at 1) and only 1.9 mm up, and doesn't touch the fold line. A smile with it (`corner_up` 0.7, raise 0.5) closes the fold gap by 54 %, against 56 % without it [offline].
- **No corrective shapes a smile's cheek.** Of the 255 face correctives, none combines any mouth control with the cheek raiser, the sneer or the nasolabial deepener. `lips_l_corner_up__lips_r_corner_up__Corr` (fires at the product of both corners) only rotates lip joints (up to 15.8°) and moves no cheek joint. In the reported expression, ablating each corrective in turn changes no cheek joint by more than 0.9 mm [resource] [offline].
- **An influence throws away the fill a person reaches for.** `lips_[lr]_nasolabialDeepener` is capped linearly by `lips_[lr]_corner_up` (weight ≤ 1 − corner_up), and `lips_[lr]_corner_wide` by corner_up, the mid shift, jaw open and corner stretch together. In the reported expression (Glee: corner up 0.74, deepener 1.0, corner wide 0.87) the solver uses the deepener at 0.26 and corner wide at 0.26; `lips_[lr]_purse` 0.30 is cancelled to 0 [resource] [offline]. The drawer shows the raw weights, so the person can't see this.
- **Limits play no part.** The 68 global limits (corner up, deepener, corner wide and stretch among them: min 0.35, mid 0.4, max 0.5 on the lips jali envelope) run only when `lipSyncEnvelope` is above 0, and it rests at 0; even then they pull only as far as `muzzleLips`, which also rests at 0. They matter for lip sync, not for a held expression [resource] [source].
- **In the reported expression** the rise at the fold line reaches 13.2 mm: `corner_up` 0.74 gives 7.8 of it, `lips_mid_shift_up` 1.0 adds 1.6, the deepener 1.3, the sneer 1.3 and `corner_sharp_up` 1.1; `jaw_mid_shift_back` 1.0 and `face_gravity_fwd` 0.63 push the same rows 1.5–3.5 mm back and forward [offline].

Real smiles lift the cheek 4.5–7.9 mm at 51–59° upward (Fishman et al. 2022, [natural expressions §9](natural-expressions.md#9-cheek-range-how-far-the-upper-cheek-can-move)) [literature]: the rig lifts the fold line more than that and the malar cheek far less.

## 2. What a retune would change

A data-driven retune edits the facial setup's own entries; nothing is hand-sculpted per expression.

1. **`lips_[lr]_corner_up`'s main pose** (the one that matters): keep the mouth corner's own motion (`mug_lip_corner_0` about 21.5 mm) and redistribute the lift over the cheek so it falls off smoothly outward and upward. A first target to test: the fold line (`jaw_nosabial_rowA_*`, `mug_mouth_rowB_2–4`) about 6–8 mm up with less backward push, `jaw_nosabial_rowB_*` 5–6 mm, `rowC_*` about 4 mm, `eye_check_rowD/E` 3–4 mm, so no neighbouring rows close by more than about 15 %. These joints are already in the pose, so the edit changes transform values only.
2. **A new corrective** `lips_[lr]_corner_up__eye_[lr]_oculi_squint_outer_lower__Corr` that lifts and rounds the malar cheek when both fire (a Duchenne smile), in place of the raiser's mostly forward push. New correctives change the setup's structure (names, corrective entries, counts), so this is phase 2.
3. **The deepener's influence**: relax the linear cap by `corner_up` (for example exponential instead of linear), so a smile keeps some fold depth.
4. **Wrinkles** stay as they are; the preview still doesn't draw them ([preview fidelity](../backlog/preview-fidelity.md)).

The measure of success is geometric and automatic: the gap between each pair of neighbouring cheek rows (the table above) stays within a set compression over a sweep of the smile controls, the mouth corner's path is unchanged, and every vanilla photo-mode expression and the idle still solve without new self-intersections.

## 3. In the preview

The preview already solves from the setup's JSON through the external solver. A tuning is a **setup patch**: a versioned, data-only list of edits (pose, joint, translation and rotation deltas or scale factors; influence type changes; later, new correctives), applied to the resolved setup JSON before it compiles. The rest follows from the view graph:

- **"With overrides" and "Vanilla".** The facial setup becomes an input of the scene's face node. One view can solve with the game's setup and another with the patched one, side by side, from the same control vector; a switch in the Expression drawer picks the one the main view uses. The preview's label says which it shows.
- **Per-control or per-region editing.** A tuning editor would show a control's pose as joint arrows on the head (region by region, mirrored left/right), with sliders for falloff and lift, and the geometric check above live. Region tools scale the pose's joints by the setup's own `JointRegions` (eyes, nose, mouth, jaw, ear).
- **An effective-weight readout** (independent of any retune, and useful now): the drawer could show when an influence cuts a weight (deepener 100 % → 26 %). That is polish on the existing drawer, banked with this note.

## 4. In game: two routes

### Route A: XF Natural Face Overrides (a setup override)

An **optional, opinionated core add-on** the Studio offers to install, with consent, like its other mods: "Install XF Natural Face Overrides". It is an XF-branded mod of its own, not part of any look or expression set.

**What exactly it overrides.** V's facial setup as the face rig uses it. Every vanilla player `face_rig`, female and male, in the creator, gameplay and photo-mode appearance files, names the male player setup `h0_001_ma_c__player_rigsetup.facialsetup` [resource]; whether the engine solves the female V with it is R1. The mod ships an XF-owned setup at its own path (`base\animations\xfs\facial\…`), a copy of the live setup with the patch applied, and an ArchiveXL `resource: patch:` of each face-rig `.app` (`h0_000__basehead_face_rig.app`, `…_photomode.app`, the ep1 app) whose appearances re-declare the `face_rig` component with only `facialSetup` changed.

**Keeping it additive and removable.** No vanilla file is replaced, so disabling the mod restores the vanilla face exactly; the Studio's install receipts already undo an install file by file. Uninstall and "use vanilla" are one action.

**Constraints and conflicts.**
- ArchiveXL merges a patch appearance's components by name and id, and a match **replaces the whole component** [source: ArchiveXL 1.27.3 `MergeComponents`]. Re-declaring `face_rig` therefore carries its graph, rig and animation sets too. Another mod that patches the same component (or replaces the face-rig `.app`) conflicts: the last one wins. The Mega Pack patches `PhotomodeAnimations`, a different component, so it doesn't conflict [resource]. The Studio's resolver finds every provider of these paths and components, and Check says in plain words which mod it would override or be overridden by; it never installs over a face mod silently.
- If another mod replaces the setup file itself, the override is still bypassed only where that mod's `.app` wins; the Studio reports it.
- The patched setup must be the one the engine uses (R1). If the engine substitutes its own setup (the Facial Customisation Rig Fix adds a facial-customisation component to every player entity [resource]), the patch might not reach it. R1 decides the target before anything is built.
- WolvenKit must write the setup's baked buffers back (`AnimFacialSetupBakedDataBuffer`, main and corrective pose buffers). Round-tripping a vanilla setup byte for byte is the first offline gate [hypothesis until tested]. Phase 1 changes values only (no counts), which keeps every buffer's layout.

**Where it shows.** Everything that solves V's face: the creator and its idle, photo mode (every vanilla, modded and XF expression), gameplay third-person, dialogue scenes and lip sync. That breadth is the point, and the main risk. Patching only `…_photomode.app` would limit it to photo mode, a safer first release.

**Risks.**
- Lip sync and scene animation were authored against the vanilla setup; a retuned smile changes every scene's smiles, for better or worse.
- If the male and female V share the male player setup, one retune changes both.
- NPC face rigs are expected to name their own setups, so NPC faces wouldn't change [hypothesis: only V's face-rig apps were read]; the test plan checks it.
- A game update can change the setup; the override must be rebuilt from the new one (the resolver's hashes notice).

**Layering with other face mods.** Expression mods (the Mega Pack, XF Expressions) drive controls, so they layer on top automatically: their faces play through the tuned poses. Mods that change the rig's joints (morph binds, the Facial Customisation Rig Fix) layer below: the patch edits pose values, not binds. Mods that replace the same `.app` or setup are the only real conflicts, reported by Check.

### Route B: per-expression compensation in XF clips

The Studio's own photo-mode expression clips could counter the lump in the expressions it exports, without touching anyone's setup.

- **Weights only (works today).** A clip carries the 141 control weights and nothing else. The Studio could offer a "natural smile assist" that re-balances weights toward less bunching (for example more `corner_sharp_up` with less `corner_up`: at 1, sharp-up closes the fold gap 5 %, corner-up 46 %) [offline]. It cannot change what a control's pose does, so it reduces the lump rather than removing it.
- **Joint offsets in the clip (unknown).** Vanilla static faces key all 344 joints at reference [resource]. Whether the photo-mode graph's `Sermo` node adds the solved face onto the incoming (clip) pose or overwrites the 266 face joints is not established [hypothesis]. If it adds, a clip could carry per-expression joint corrections computed by the Studio (tuned solve minus vanilla solve), exact and conflict-free. One probe clip with a 3 mm offset on one cheek joint answers it.
- **Conflicts**: none (XF's own clips). **Limits**: only XF expressions benefit; other mods' faces, scenes and the creator keep the lump; the 1 s cross-fade blends any joint keys along with the weights.

### Recommendation

Test route B's joint-offset question first (one probe clip, no risk to anyone's setup). If the graph adds clip joints, route B gives XF expressions natural cheeks with no conflicts, and route A becomes an opt-in for everything else. If it overwrites them, route A is the only way to fix smiles everywhere, and it ships photo-mode-only first.

## 5. Test plan (before any release of route A)

Batch into prepared sessions through the runtime bridge; record the game, ArchiveXL, TweakXL versions and the installed face mods.

1. **R1:** which setup the face rig uses live. **Answered for the female V in photo mode (session 4): the male player setup** ([facial expressions §1](../../knowledge/facial-expressions.md#which-facial-setup-v-actually-uses)); a route A override therefore patches the male player setup for photo mode, and the preview solves with it since 29 September. With it the smile's fold closes about 9 points less at weights 0.5–0.7 than with the female head's setup this note measured (38–46 % against 47–56 %) ([experiment 031](../../experiments/031-photo-mode-facial-setup/README.md)). Still to read: the male V, and the creator and gameplay faces.
2. **Probe clip** (route B): one XF expression with a joint offset on `r_J_eye_check_rowD_0`; photo mode close-up against the same expression without it.
3. **Photo mode**: the 12 vanilla expressions, five Mega Pack faces and the XF set, each with and without the override, fixed camera, look-at off; plus the cheek check smiles (first run in session 4: [N13 results](../../experiments/029-session-4/README.md#34-n13-cheek-check)).
4. **Creator**: the close-up idle and the eyes-section showcase, blink closure on four eye shapes.
5. **Dialogue**: two scenes where V smiles and talks (lip sync against the tuned mouth corners), captures at the same moments with and without.
6. **Male and female V** for every row above.
7. **NPCs**: one scene with a female and a male NPC close up; `face.rig.read` on them confirms they don't use the player setup.
8. **Removal**: disable the mod, relaunch, confirm the vanilla face returns in each context.
9. **Beside other face mods**: with the Mega Pack and the Facial Customisation Rig Fix enabled, Check's report and the in-game result agree.

## Related pages

[Facial animation](../../knowledge/facial-animation.md) · [Facial expressions](../../knowledge/facial-expressions.md) · [Natural expressions](natural-expressions.md) · [Expression editor design](expression-editor-design.md) · [Mod loading](../../knowledge/mod-loading.md) · [Next sessions](../runtime/next-sessions-plan.md)
