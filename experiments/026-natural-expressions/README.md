# Natural expressions and face capture

**Status:** done, 27 September 2026. Offline only: no game launch, nothing written under the game or mod folders, no game data or third-party media committed. The findings are in [natural expressions](../../research/animation/natural-expressions.md) and the [facial expressions](../../knowledge/facial-expressions.md#8-natural-expressions-facs-on-vs-rig) knowledge page.

Evidence grades as in the knowledge base: **[offline]** measured here with the pinned solver and forward kinematics of the face skeleton; **[observed]** seen in the Studio's live preview; **[hypothesis]** not established. Nothing here has runtime evidence.

## Question

Vanilla photo-mode expressions look fake. Can FACS knowledge, mapped onto V's 141 main-pose controls, give natural-looking expressions (a warm smile, confusion, disgust, mild surprise, thinking)? And can MediaPipe blendshapes from a photo or webcam drive V's face live?

## Inputs

| Input | Identity |
|---|---|
| Face rig | The Studio's facial host on the reference route: `h0_000_pwa_c__basehead_skeleton.rig` (344 joints) and `h0_000_pwa_c__basehead_rigsetup.facialsetup` (141 main poses), from the main checkout's preview cache |
| Solver | The pinned, unmodified IO Suite solver (Cyberpunk Blender add-on checkout beside the repository), kept warm by `projects/xf-studio/authoring/tools/facial_solver_server.py` |
| Installed expressions | `GET /api/facial/expressions` on the reference setup (217 rows; the 12 listed vanilla faces used here) |
| MediaPipe | `@mediapipe/tasks-vision` 1.0.1 (npm tarball SHA-256 `ee318eaa…aca505f`) and `face_landmarker.task` float16 (SHA-256 `64184e22…e0bc9ff`, dated 3 May 2023), both Apache-2.0, in `D:/Dev/tools/` (rows in `D:/Dev/tools/README.md`) |
| Real-face test images | Duchenne de Boulogne, Figures 7, 32, 45, 51 and 54 (Cleveland Museum of Art 2018.7–2018.11, CC0), 1280 px renditions from Wikimedia Commons, in the ignored `research/consumers/natural-expressions/raw/duchenne/` |

## Scripts

All take `--server http://127.0.0.1:<port>`, an isolated Studio server (its own port, `XFAS_DATA_DIR` and `XFS_SETTINGS_DIR` scratch folders, `XFS_MOD_INSTALL=off`, run under the memory guard at 3 GB). Game-derived output goes to the ignored `generated/`; renders to the ignored `projects/xf-studio/authoring/evidence/screenshots/natural-expressions/`.

| Script | What it does |
|---|---|
| [`lib.ts`](lib.ts) | The server's rig and solver, forward kinematics, the face frame (left = V's left) |
| [`control-atlas.ts`](control-atlas.ts) | Solves each control alone at 0.5 and 1: which regions move, how far, which way, and how linear |
| [`region-balance.ts`](region-balance.ts) | Eye opening, lower-lid rise, corner lift, controls at 0.7 or more, and regional peaks for vanilla faces and the samples |
| [`make-samples.ts`](make-samples.ts) | The five FACS recipes; writes `projects/xf-studio/authoring/data/expression-samples/*.json` in the editor's preset format (`--post <server>/api/verification/part-presets` also saves them) |
| [`expression-look.ts`](expression-look.ts) | Fixed-camera renders (front, three-quarter) of vectors, samples or installed expressions in a throwaway headless Chrome on `?verify=1`, applied with `expression.startFrom` and solved live |
| [`sheet.py`](sheet.py) | Contact sheets |
| [`face-capture/`](face-capture/) | The webcam and photo prototype: `serve.ts` (page, MediaPipe files, proxy to the Studio, with a CSP), `index.html` and `app.js` (camera, landmarker, smoothing, neutral, mapping, Studio driving, capture), `mapping.js`, `filters.js` (1€ filter), `make_media.py` (stills and a Y4M clip for Chrome's fake camera) and `evaluate.ts` (headless run: stills round trip, fake-camera session, capture, network audit) |

## Results

1. **Control atlas.** Most controls are exactly linear in weight; a few bend by 10 to 22 %. Seven move no joint in this setup (`lips_tighten_up`, `lips_tighten_dn`, `jaw_mid_clench`, `lips_corner_sticky`, both `eye_*_pupil_narrow`, `neck_throat_adamsApple_up`). The neck and head turn and tilt controls deform neck and jaw-line skin up to 24 mm but leave the head, nose and brow where they are. `nose_*_breathe_in` flares the nostril (the drawer says it narrows it), and `lips_*_lower_raise` lowers the lower lip [offline] [observed]. The full mapping is in the [research note](../../research/animation/natural-expressions.md#3-facs-action-units-on-vs-controls).
2. **Vanilla against natural.** `facial_happy` keeps the eyes 85 % open (lower lid +0.8 mm) with the mouth corners up 5.5 to 8.2 mm. The warm smile sample has the corners up 6 mm with the eyes at 62 to 65 % (lower lid +2.4 mm). Vanilla faces drive up to 19 controls at 0.7 or more; the samples none, except the smile's cheek raise [offline].
3. **Samples.** Five presets, 9 to 23 controls each, all at 0.9 or below; validated by `tests/expression-samples.test.ts` (the editor's codec, control groups, unlinked asymmetric pairs, every control explained by an AU).
4. **Face capture.** Detection 7 to 12 ms per frame on the GPU, solve round trip 6 to 8 ms, so face to V is about 32 ms plus the camera's delay. MediaPipe's Left is the subject's left on unmirrored frames. Round-trip cosine on V renders: 0.82 to 0.97 for gaze, blinks, brow raises and smiles; 0.3 to 0.6 where brow lowering, the nose wrinkle, the upper-lip raise or one-sided mouth movements carry the expression. The library's usage-metrics upload to Google is blocked by the page's CSP, and the headless session made no request off 127.0.0.1 [offline].

## Running the face-capture prototype with a real camera (maintainer)

1. Start an isolated Studio server on a free port (not 4317) with scratch `XFAS_DATA_DIR` and `XFS_SETTINGS_DIR` and `XFS_MOD_INSTALL=off`, under the memory guard.
2. `bun experiments/026-natural-expressions/face-capture/serve.ts --studio http://127.0.0.1:<studio port> --port <free port>`.
3. Open `http://127.0.0.1:<free port>/face-capture/` in a normal browser tab and wait for V to appear in the Studio pane.
4. Press **Turn camera on** and allow the camera. Look straight at it with a relaxed face and press **Set my neutral face**.
5. Make faces. Adjust **Strength** and **Upper face**. **Capture this expression** saves the numbers (never the picture) to the verification library, where the Expression drawer's Start from › Your saved expressions finds them.
6. Press **Turn camera off** when done; the "Camera on" badge disappears.

Worth reporting: whether V follows smiles, blinks and brows naturally; how the frown, sneer and one-sided mouth look (the weak spots on V renders); the frame rate and "estimated face-to-V" line in the page's metrics; and any lag you notice.

## Limits

- Preview only: the female head's own facial setup, no wrinkle rendering, no look-at. Nothing is proven in game.
- The round trip used V's own renders, a synthetic domain. Real faces behave differently (better on AU4 and AU9, with resting offsets), so gains need a real-camera session.
- Each capture frame is one Undo step in the verification workspace (the feature would use one gesture transaction).
- The Studio server peaked above 3 GB twice while first preparing a V for a page (killed by the guard); warm, a page load peaked at 0.8 GB.
