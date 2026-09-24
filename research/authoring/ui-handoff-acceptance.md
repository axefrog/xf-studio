# Replacement-UI handoff acceptance

24 September 2026. Run this once **after** the application, viewport and current-workflow I/O ports are stable and before dispatching the Opus 5.5 redesign. Use only an isolated `?verify=1` workspace and a disposable library; never touch Nathan's active draft. This checks the boundary the replacement UI will receive, not the visual redesign itself or game rendering.

## Existing focused evidence

| Behavior | Evidence already held | Final-pass requirement |
| --- | --- | --- |
| Typed actions, detached state, Undo, stale targets and gesture transactions | [Architecture checkpoint](ui-architecture-boundary.md), authoring tests and independent facade fixture | Exercise them through the final public application port. |
| UV/head point and shape editing | Isolated browser passes described in the architecture checkpoint | One UV and one on-head edit with Undo and Escape. |
| Workspace restore: saved V, camera, selection and history | [Workspace evidence](../../projects/xf-appearance-studio/authoring/evidence/workspace-persistence-2026-09-23.json) | Reload after edits and verify restored values through the public snapshot. |
| Library conflict/recovery, preset/layer order | [Collection evidence](../../projects/xf-appearance-studio/authoring/evidence/preset-collections-2026-09-23.json) | Repeat one conflict and one recovery, preserving unsaved work. |
| Worker cancellation and complete preview publication | [Raster evidence](../../projects/xf-appearance-studio/authoring/evidence/raster-scheduling-2026-09-23.json), [quality evidence](../../projects/xf-appearance-studio/authoring/evidence/preview-quality-2026-09-23.json) | Change quality during a live bake and confirm no partial/stale result is announced ready. |
| Unsaved draft Check/Build and partial omissions | [Package UI evidence](../../projects/xf-appearance-studio/authoring/evidence/package-ui-bridge-2026-09-24.md), [partial export](partial-mod-export-checkpoint.md) | Check a mixed eligible/Glitter collection; compare Build omissions and identities without installing it. |

## One compact final scenario

1. In `?verify=1`, create an empty preset and a densely layered preset. Give one preset and one layer long names; reorder both kinds and confirm stable identities and one-step Undo.
2. Edit a point, tangent or warp field in UV; drag a whole shape; use Undo and Escape. Repeat a point/shape edit on the head while the eye and accessory geometry are present. A disabled or stale target must explain its reason and reject dispatch.
3. Start a complex bake, change 1K/2K preview quality during it, and observe cancellation/recovery to a complete current bundle. Keep recipe and export settings unchanged.
4. Import saved V through the typed file port. Pan/orbit/zoom, change head direction, select a preset/layer/point and edit. Reload; verify imported V, camera/UV view, selections, draft and history. A missing optional asset should present an unavailable state without corrupting the draft.
5. Save to the disposable library, simulate a stale revision, resolve by the supported recovery route, then make an unsaved edit. Check a mixed Matte/Glitter collection and build the eligible portion. Compare omission warnings, kept identities and snapshot hashes; confirm no install/game-proof claim.
6. Capture the public action/request outcomes, state snapshots, concise screenshots and any console errors. Mark which calls still require a trusted `main.ts` or UI-specific path; any such current-workflow dependency keeps the code gate open.

The acceptance pass must use the eventual public ports, rather than succeeding only through today's controls. Existing focused tests remain regression evidence; no need to rerun every historical experiment or precompute menus for future features. The [Opus brief](../backlog/claude-ui-overhaul.md) separately requires light/dark, docking, context-menu and accessibility checks **after** the redesign.
