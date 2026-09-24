# Viewport and editor controls

## Status (25 Sep 2026)

Nathan's 23 September viewport/layer requests are implemented, with two bounded caveats.

| Request | State |
|---|---|
| Pause/resume idle — hold current body/face phase, resume from there, persist across reload; never via the reset path | **Done** |
| Idle subsets — independent *Head movement* and *Facial movement* (stationary head while gaze, lids, mouth continue) | **Done** for the two decoded clips. Finer facial masks are later expression work; approximate channel separation is not engine graph parity. [Design record](../animation/idle-controls-design.md) |
| FOV-aware close zoom | **Bounded improvement** — 10° front view fits at narrow widths; zoom reaches the 0.1 close limit with no observed near-plane hole. **Nathan's specific close-zoom symptom is still unreproduced**; reopen if he sees it again. [Checkpoint](../authoring/camera-zoom-design.md#implementation-checkpoint--24-september-2026) |
| Keep framing while changing FOV | **Done** for the viewed surface plane (centre-ray hit held through the slider gesture; visible warning when bounds prevent it). A selected off-centre control is not yet an anchor — open refinement. |
| Pan | **Done** — right-drag pans camera and target together; persists. A more visible pan mode for narrow viewports is an optional refinement. [Findings](../authoring/camera-control-findings.md) |
| Layer reorder feedback (live insertion line, dragged-row state, edge scroll, Escape, keyboard alternative) | **Done**; the dock UI keeps keyed rows and Alt+↑/↓ reordering |
| Compact layer rows | **Done** |
| Discoverable layer rename | **Done** (dock UI: inline F2 rename) |
| Sidebar width follow-up (640 px cap removal, per-panel widths) | **Obsolete** — the dock UI replaced fixed sidebars (`95516b2`); layout is now a versioned dock preference with its own recovery |

## Invariants

- Pausing never uses the reset path; muting both subsets stays enabled and retains phase.
- Keep phase-zero neutral-space camera normalisation consistent across subset changes and reload.
- Preserve camera/motion state across reload and context changes; do not confuse orbit with pan or break direct surface dragging.
- Verify gesture feedback in the isolated `?verify=1` browser, never Nathan's active draft; check source animation composition offline.

## Sidebar width follow-up — 23 September 2026

**Obsolete.** The 640 px cap removal and per-sidebar preferred widths applied to the legacy fixed-sidebar shell (still at `/legacy.html`); the dock UI replaced sidebars on 24 September.

The brow-area idle motion question (default `ui_closeup_shot` vs the stronger `ui_closeup_shot_eyes` brow tracks) belongs to [preview fidelity](preview-fidelity.md#missing-brow-area-idle-movement).
