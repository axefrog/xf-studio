# Spike S2: switching the drawn view

**Status:** run on 21 October 2026 for [profiles, views and layout tabs §9.1](../../research/authoring/profiles-views-layouts-design.md#91-spikes). **Result: S2 fails.** Two views of one scene pass once each view's lights have been drawn. Switching between two subjects fails on today's architecture, and passes only partly with the prototype. By the design's own rule, the scene-runtime split moves before phase 2. Below, the split is cut in two so that only the half tabs need moves.

These are offline browser measurements, not game evidence. Each figure comes from one or two runs on one machine that other work was sharing, so treat them as orders of magnitude.

## 1. Setup

| Item | Value |
|---|---|
| Code | Branch `claude/spike-views`, based on `385f3406`, plus the prototype below |
| Page | Headless Chrome 155 (ANGLE on D3D11, off-screen, fresh profile per run), 960 × 640 window; the 3D view docked at 358 × 278 CSS px |
| Machine | Intel Core Ultra 7 265KF, NVIDIA RTX 4070, Windows 11 |
| Server | Isolated, port 4561, `?verify=1&spike=views`. Data, preview cache, resolver cache, choice previews and tools all sat in a scratch folder (deleted afterwards), with a read-only copy of the local settings. The real installation was read through the normal resolver (MO2 route). |
| Subjects | The feminine and the masculine default V. A save V wasn't needed: every V of the other body goes down the same path. |
| Harness | [`measure.ts`](measure.ts) |
| Guards | Server `--limit 5` (it peaked at about 1.8 GB). Chrome `--limit 4`: one page with one whole-body V was killed at 3.1 GB under `--limit 3` (run 1). |

**How it was run:**

```
PORT=4561 XFAS_DATA_DIR=<scratch>/data XFS_SETTINGS_DIR= XFS_MOD_INSTALL=off XFS_PREVIEW_CORE_CACHE=<scratch>/preview-cache \
  XFS_RESOLVER_CACHE=<scratch>/resolver-cache XFS_CHOICE_PREVIEW_CACHE=<scratch>/choice-previews XFS_TOOLS_DIR=<scratch>/tools \
  python tools/memory_guard.py --limit 5 -- bun server.ts
python tools/memory_guard.py --limit 4 -- bun experiments/039-view-switch-spike/measure.ts 4561 <scratch>/run.json <scratch>/chrome
```

The environment variables select a part of the run:

- `SPIKE_PART=views` runs gate A only;
- `SPIKE_PRESET=creator` gives the second view the other lighting preset;
- `SPIKE_PART=resident` runs only the resident subjects, with the body hidden so the page fits the guard.

## 2. What the prototype needed

All of it is dev-only and changes no default behaviour.

| Piece | Where | What it does |
|---|---|---|
| `PreviewActions.drawView(view)` | `src/preview/preview-actions.ts` | The device draws another view of the same scene. Its fixed `shown` view became mutable, and the existing field-by-field `apply`, camera included, does the rest. |
| `sharedRenderer` and `setDrawing(on)` | `src/platform/scene/scene-host.ts` | A scene host can draw with another host's renderer: one WebGL context, with programs and the context shared. A host that isn't shown draws nothing. |
| Resident subjects | `spike-views.ts` (on branch `claude/spike-views`) | A second scene host for another subject on the shown head's renderer, with its own character-detail service. The shown subject is whichever host draws. Its loads are instrumented to time cancellation. It is mounted only in `?verify=1&spike=views` (`src/compose/studio-startup.ts`). |
| Ratchet entry | `tests/view-graph-audit.test.ts` | The spike module is a listed scene-host importer, marked spike-only |

The resident model is a crude scene-runtime split: each subject still carries a whole scene host (its own camera, controls, lighting stage and render targets). That it worked after about 60 lines of change is the main evidence for the effort estimate in §5.

## 3. Gates

### Two views of one scene

| Gate | Result | Numbers |
|---|---|---|
| ≤ 100 ms to first frame | **Pass** (warm) / **Fail** (first switch to a lighting rig not yet drawn) | **Same rig:** 12 switches drew in 6–8.5 ms and reached the compositor in 7–19 ms, with no long tasks. **Other rig** (creator preset on the second view, studio on the main view): after warm-up, 12 switches drew in 7.5–13 ms. The first switch to that rig drew after **94 s**: one 94 s long task linking 40 programs with a cold program cache. |
| No V reload | **Pass** | 0 character requests and 0 uploads on every switch; the detail status stayed ready |
| Stable shader program count | **Pass** after warm-up | 69 programs on one rig; 109 once both rigs had drawn, then flat through 12 switches |

The 94 s isn't specific to switching views. The rig's first draw links programs synchronously, so a preset change on a fresh browser profile pays the same cost. It belongs on the [performance track](../../research/backlog/performance.md). For views, it means a view's rig must be prepared before the switch (§4).

### Two subjects (feminine and masculine)

**Today** is the shipping code path: the head is released and loaded again with the other body. **Resident** is the prototype: both subjects stay loaded on one context.

| Gate | Today | Resident |
|---|---|---|
| First switch shows progress | **Fail.** The progress depends on what the host still has to prepare. When the host prepares the masculine head from the game files (cold, 18.5 s), the pane says "Preparing the masculine V's head…" and the detail service reports its stages. Every switch, though, first removes the shown V and its canvas. For 0.2–1.2 s the pane shows no V, no message and no progress, then "preparing" with no progress until ready. | **Partial.** The resident's service reports `preparing` while it loads (wiring it into the pane wasn't prototyped). Opening a resident takes 125–230 ms to build its scene, plus about 1.1 s to ready its details from a warm host. |
| A superseded preparation is cancelled within 100 ms | **Fail.** Masculine, then feminine 150 ms later: the masculine head loads anyway, because `reloadHead` leaves a load under way alone. The feminine request is refused (`not_ready`, "The creator options are still loading.") and lost. | **Pass, n = 1.** The superseded resident's in-flight load stopped **79.5 ms** after `cancel`, with no uploads afterwards. Caveat: building the scene host (125–230 ms) takes no signal and can't be cancelled. |
| A late result for a superseded subject is never shown | **Fail.** The superseded masculine V is shown at 1.3 s and stays: the person's last choice is lost. | **Pass**, but a glitch remains. The superseded resident's details were never drawn (frames unchanged after cancel). However, a newly built scene host drew **2 frames** of its bare head into the shared canvas before it could be hidden. |
| Warm switches ≤ 100 ms | **Fail.** The other body takes 1.3–2.2 s (each with a 220–300 ms long task). The cold first switch takes 5.4 s with a warm host cache and 18.5 s with a cold one. | **Pass after the first draw:** 10 warm switches drew in 2.3–4.2 ms and presented in 2.6–17 ms. The first draw took 94 ms (1 program, 1 upload), and the frame after it stalled **1.14 s** on deferred GPU uploads. |
| Within the memory budget | **Not defined:** the design names no per-subject budget | See the memory table below. Two whole-body Vs in one page exceeded the 4 GB process guard (run 3, killed at 4.1 GB); head-only Vs fit (3.4 GB peak). |

### Memory

| State | Dedicated VRAM | Shared GPU | GPU process private | JS heap | Textures / programs |
|---|---|---|---|---|---|
| Feminine V, whole body | 1.13–1.20 GB | 0.49–0.58 GB | 1.8–2.1 GB | 317 MB | 147 / 69 |
| Masculine V, whole body (after reload) | 0.71–0.78 GB | 0.22–0.24 GB | 1.2–1.3 GB | 251–266 MB | 146 / 65 |
| Feminine V, head only | 716 MB | 215 MB | 1.09 GB | 314 MB | 84 / 55 |
| Plus a resident masculine V, head only | 1.18 GB (+466 MB) | 414 MB (+199 MB) | 1.82 GB (+724 MB) | 492 MB (+178 MB) | 149 / 76 (+21 programs) |
| Resident closed | 1.18 GB (not returned) | 414 MB | 1.78 GB | 462 MB | 86 / 57 |
| After two more residents opened and closed | 936 MB (+220 MB vs before) | 287 MB | 1.39 GB | 524 MB (+210 MB) | 93 / 59 |

A second view of one scene adds nothing measurable: textures 147 → 150, VRAM within noise.

Disposing a resident doesn't give everything back: 7–9 textures, about 200 MB of heap and about 220 MB of VRAM remain. A scene host that disposes without its renderer (the shared case) leaks. Today's path never shows this, because it destroys the whole context.

## 4. What it means

- **The split moves before phase 2.** S2 fails, and the design says that moves the split. The reason is concrete, not formal: today a V of the other body is a new WebGL context, a full head load (1.3–2.2 s warm), a blank pane, and a lost request when superseded. A tab strip that switches between Vs would inherit all of that.
- **Only half of phase 4 has to move.** Views of one scene already switch within budget, so tabs that show one subject would work now. What tabs need is the *scene-runtime* half: one renderer, several resident subject runtimes, one drawn at a time. Several simultaneous drawn views, the offscreen blits, the linking UI and the per-view frame budget can stay in phase 4.
- **One GPU context per window holds up.** Two subjects shared one renderer and its program cache; the masculine head added 21 programs to 55. Warm switches cost almost nothing (2–4 ms).

## 5. Design changes it implies (for the design doc; not edited here)

1. **§9.2 phase order.** Split phase 4:
   - **4a, scene runtimes**, before phase 2: one renderer device, resident subject runtimes, one drawn view, with residency and pre-warm;
   - **4b, simultaneous views**, stays in place.

   Phase 2's gate "tab switch within S2's budget" then depends on 4a.
2. **A scene draws only when a view shows it.** A runtime is created hidden and never draws while building; the prototype showed 2 stray frames.
3. **Prepare before switch.**
   - A view, or a tab's views, is prepared before it can be switched to: rig programs compiled asynchronously (the lighting stage's `prepare`) and textures uploaded while hidden.
   - The same goes for a resident subject: its first draw cost 94 ms plus a 1.14 s GPU stall.
   - Until a target is prepared, the switch shows progress in place and keeps the previous view drawn. It never blocks the main thread, as the 94 s cold link did.
4. **Residency is a budget with numbers.** §3.7's memory table counts only views. It needs a **per-subject** cost (head only about 0.47 GB VRAM and 0.7 GB GPU-process memory; whole body roughly 0.7–1.2 GB VRAM and 1.2–2.1 GB GPU-process memory) and a residency policy:
   - the shown subject plus at most N warm ones (proposed N = 1);
   - least recently shown evicted first;
   - eviction is ordinary disposal that must return its memory, with a test (the leak above).

   The S2 memory gate needs those numbers to be measurable.
5. **Cancellation reaches runtime creation.** Creating a subject runtime (core head, rig, motion, features) takes an `AbortSignal`. Today only the detail load does, and building a scene host can't be stopped.
6. **A subject switch never drops the person's request.**
   - The body-switch path (`reloadHead` plus the `not_ready` refusal while the context reattaches) is replaced by a per-scene subject change that supersedes the earlier one.
   - The previous V stays drawn until the new one is ready, with progress shown.
7. **Input per view.** Two hosts' camera controls sat on one canvas (the prototype disabled the hidden one). In the split, input routes to the drawn view's camera node, never to every runtime on the canvas.
8. **Renderer state hygiene.** Each runtime's draw must set every renderer-level setting it relies on (tone mapping, exposure, render target, shadow settings), since several runtimes now share one renderer. The spike didn't check this visually.

## 6. Effort estimate for the scene-runtime work

In the design's units (provisional phase 4 total: 10–12).

| Part | Scope | Effort |
|---|---|---|
| **4a, scene runtimes** (before phase 2) | Split the scene host into a renderer device (context, scheduler, canvas, input routing) and per-scene runtimes (core head, rig, character renderer, feature renderers, lighting stage). Hidden creation with an `AbortSignal`. Prepare-before-switch (async program compile, texture upload) with progress. Residency policy and per-subject budget. Leak-free disposal with a memory test. Subject switch replaces `reloadHead`. Per-scene character services hand over from phase 1's de-singletoning. Gates: this spike's harness in CI-like form, warm switch ≤ 100 ms, cancel ≤ 100 ms, no stray frames, memory returned. | **7–9** |
| **4b, simultaneous views** (stays at phase 4) | Several drawn views: offscreen canvas and per-view blits, per-view frame budget and timing, linking UI, two bodies drawn at once within budget | **5–6** |
| **Total** | Up from 10–12, mainly for pre-warm, residency and the leak, which the original estimate didn't foresee | **12–15** |

Phase 2 then waits for 4a. The pre-beta total moves by +2–3, to about **61–74**.

## 7. Limits

- Each figure comes from one or two runs, with headless Chrome on a busy machine.
- Cancellation was sampled once in each mode.
- The pane's progress text for residents wasn't wired.
- Renderer state between runtimes wasn't checked visually.
- The 94 s cold link was measured on a fresh browser profile. A returning user's program cache would hide most of it, so the first-launch and new-rig cases deserve their own measurement on the performance track.
- Run 1 was killed by its guard before measuring anything. Run 3 was killed when the second whole-body V opened, and its resident figures were retaken head-only (run 4).
