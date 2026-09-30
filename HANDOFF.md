# Handoff: render gap fixes, code-only steps (claude/render-gaps-1)

Branch `claude/render-gaps-1` from main `ba97e6a`. Not merged. Worktree `%LOCALAPPDATA%/xfs-worktrees/render-gaps-1`. Plans: [render gap plans](research/character-customization/render-gap-plans.md). **Nothing here is proven against the game: every look waits for the maintainer's captures C1–C6** ([plans §8](research/character-customization/render-gap-plans.md#8-capture-requests-one-prepared-session)).

## What changed, per gap

1. **Teeth, PREV-147 step A** (`src/mouth-aperture.ts`, `src/mouth-occlusion.ts`, `platform/scene/mouth-aperture-sampler.ts`). The mouth interior is lit through the lips' parting measured on the posed head every drawn frame, floor 0.05 (was a fixed 10 mm and 0.3). Lip joints are chosen by the facial setup's `JointRegions`, the jaw's ancestry and rest heights, never by name; on the game's face that picks the four `_0` lip joints and reproduces experiment 034's 2.75 / 2.91 mm to 0.01 mm. The breaths now give the front teeth about 0.11 (was 0.36). Face records carry the regions (`FaceMotionRest.regions`; `FACE_BAKE_VERSION` 2 re-bakes cached idle faces). Without regions the old 10 mm stays. `?verify=1`: `xfStudioPinMouthInterior({parting: 0.010, floor: 0.3})` draws the old stand-in; `xfStudioSceneEvidence().mouth` shows the joints and aperture. Step B not built (waits for C1).
2. **Masculine beard cards.** Face options plan every chunk whose template a face option draws (decal family and `hair.mt`, `faceChunkDraws`), so cards draw with the hair adapter, hair draw order, casting like hair. Coverage honesty: plan and host name options drawn only in part in the record's additive `partial`; the Character panel settles a conditional row as drawn only when all of it draws, and marks a partly drawn row ("Only part of it is shown in the 3D view yet.", marker on, row not dimmed).
3. **Arm cyberware.** `save-loadout.ts` reads the `ArmsCW` active item (`SavedLoadout.arms`, additive); `arm-cyberware.ts` follows item → `holsteredItem` → `appearanceName` (compiled TweakDB) → the creator's `perspectiveInfo` tpp group (now read into `CcoResource.perspectives`; unsplit resources use the state's own group); request `xfs/character-request-9` `arms`; `BodyState.arms` drives the arms groups, so both halves of the state draw. Fallbacks draw the default with a record note. PREV-117: resolver carries `enableMask`, `metal_base` alpha-tests `BaseColor.a` vs `AlphaThreshold`. New `glass_onesided` adapter: transmission pass only (`src/glass-material.ts`). Offline on the maintainer's saves: Gorilla Arms → `holstered_strong_tpp`, Monowire → `holstered_nanowire_tpp`.
4. **Hair: per-fragment linear falloff** (`src/linear-falloff.ts`). Linear creator lights carry `linearRadius`; a negative `decay` marks them and a patch of Three's `getDistanceAttenuation` returns `1 − saturate(d/r)`. Other linear lights change ≤ 7 % across the head; Rim_Top's crown gets 1.97× (feminine), its chin none. Stored setups without the radius keep their folded intensity.
5. **PREV-142 not done** (time went to the captures). Reading the code: `prepare` already compiles a new part's scatter variants ahead with `compileAsync` (PREV-189), with the forward target bound, not the scatter's input target; whether the programs match (and so whether a hitch remains) needs measuring first. Noted in the plans page.

## Tests

New: `tests/mouth-aperture.test.ts` (synthetic rig; private game-derived fixture for 2.75/2.91 mm), `tests/arm-cyberware.test.ts` (chain, request, planner halves; private save-derived fixture), `tests/glass-material.test.ts`, `tests/linear-falloff.test.ts` (ten distances). Extended: mouth-occlusion (the lip-gap → darkening mapping), face-decal-plan and character-detail-service (beard cards, `partial`), character-panel-dom (partial row), character-renderer (face strands), metal-base (alpha test), save-loadout (`ArmsCW`), creator-lighting, fixtures. Private fixtures (ignored): `projects/xf-studio/authoring/data/private-fixtures/{mouth-aperture,arm-cyberware-save}.json`, written by `experiments/034-render-coverage-refresh/check_aperture.ts` and `check_arms.ts`.

Full authoring suite under the 4 GB guard: 3036 pass, 26 skip, 0 fail (peak 3.0 GB). `tsc` clean (main and tools); links and private paths clean.

## Captures (ignored, `local-evidence/render-gaps/`)

Isolated `?verify=1` servers on port 4521 (disposable data, copies of the preview caches), headless Chrome, one at a time under a 5 GB guard (the coordinator's allowance), `tools/render-gaps-look.ts`. "Before" is main `ba97e6a` run from an exported tree; "after" is this branch.

| Gap | Before | After | Numbers |
|---|---|---|---|
| Teeth, idle paused at 2.4 / 14.45 / 6.0 s, creator lighting | `before/teeth-t*.png` | `after/teeth-t*.png`, plus `after/teeth-t*-old-stand-in.png` (the old stand-in pinned in the new build) | Aperture measured 2.75 / 2.98 / 0.32 mm. Teeth-box mean scene-linear luminance at 14.45 s 0.066 → 0.019 (0.29×; the pinned old stand-in gives 0.069, matching main); at 2.4 s 0.048 → 0.039 (the box is part lip); closed mouth unchanged |
| Masculine default V, beard 05 (brown liquorice) | `before-beard/beard-*.png`: stubble only | `after-beard/beard-*.png`: stubble and cards | Record: `beard_shadow_01` and `beard` components for `beard_color5_0`; panel rows in dark/wide and light/narrow (`beard-panel-*.png`), no partial marker (the option draws whole) |
| Hair at three colours (positions 3, 12, 30), creator hair framing | `before/hair-colour-*.png` | `after/hair-colour-*.png` | Crown-box luminance +10–12 % (Rim_Top per fragment); lengths unchanged |
| Arm cyberware (a local save with Gorilla Arms) | – | `after-arms/record-body.json` only | The host's record draws both halves of `holstered_strong_tpp` (skin and cyberware: `multilayered`, `mesh_decal`, `metal_base` with `enableMask` 1, `glass_onesided`) and notes the state. **No page capture:** a saved V with its body loaded peaks over 5 GB (server ~1.9 GB + headless page), even at 800×560, 1K maps, hair and clothes off; per the coordinator I did not ask for more |

Observed in the after beard frames [offline]: the cards read noticeably lighter and warmer (golden) than the stubble decal and the hair of the same colour name; whether that is the beard `.mi`/profile or the hair light under the creator rig is not diagnosed.


## Unproven

Every look above is the preview's own; none is shown to match the game until the maintainer's captures: C1 (teeth breath), C2 (teeth page), C3 (hair ladder, RT off), C6 (arm cyberware); the beard's in-game look is the masculine V plan's check.

## Needs a decision

- **UI gate:** the partly-drawn row reuses the existing not-shown marker (eye-off icon) with its own tooltip and no dimming; not reachable with vanilla data (the DOM test covers it). The UI lead may want a distinct glyph (UI track).
- **Request and loadout versions:** `arms` is an additive field on the loadout (schema kept at `-1`) and a new request version (`-9`) rather than a loadout schema bump. Say if you want the bump.
- **The creator puppet and arm cyberware:** a saved V shows her equipped state whether or not a creator idle plays; the default V always shows the default state. The plans' line "the creator ... stay on the default state" could also mean the creator idle should force default; I chose the save's state.
- **TweakXL arm cyberware** is not followed (as for clothing): default state with a note.
- **Arm capture budget:** a page capture of a saved V with arm cyberware needs more than 5 GB here; either a higher allowance for one run while nothing else is active, or accept the record-level evidence until C6.
