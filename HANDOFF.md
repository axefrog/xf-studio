# Handoff: update check (`claude/update-check`)

Branch `claude/update-check` from `70cbf2f`, commits `46be6cb`, `2af5395` (plus this file). Not merged.

## What it does
- The host checks the public GitHub releases of `axefrog/xf-studio` (unauthenticated, pre-releases in, drafts out, SemVer precedence with pre-release ordering).
- Check at start: the page asks after first paint plus 2 s (clock source, inside `UpdateCheckActions`). The host skips it when **Settings › Updates** is off. It runs once per host start and reuses an answer from the last 6 h. A rate limit backs off 6 h. Failures are silent. A newer version shows a fading toast with **Open the releases page** and **Skip this version**. Skipping stops that version being announced; a newer one is announced again.
- Manual check: **Check for updates** in Help (in place), the palette (as a toast) and **Settings › Updates › Check now** (in place). Each says one of: newest version; newer version is out (with the releases page); couldn't check (with the releases page).
- Settings › Updates: a new section holding the switch "Check for updates when XF Studio starts". It is on by default.
- About (desktop) and Help's limitations topic, the beta tour and the CHANGELOG say the same thing. Installing stays manual.

## Layers
- Policy: `src/update-check.ts`. `UpdateCheckService` and SemVer. It has no I/O.
- GitHub adapter: `src/update-check-github.ts`. The host's `fetch` is injected. It also holds the simulated source.
- Host: `src/update-check-host.ts`. It has a JSON store over an injected text-file port and the `/api/update-check` and `/api/verification/update-check` handlers. The file I/O and `fetch` come from `server.ts` and `desktop/server.ts`. Memory is kept in `<settings>/update-check.json`.
- Page: `src/update-check-actions.ts` (the actions and state) and `src/browser-update-check-device.ts`. The port gains `updates`.
- UI: `src/studio-ui/update-check.ts`, plus edits to Help, Settings and the palette. It uses only library `button`/`Toggle`/toast and Help's existing link rows.
- Catalogue: `UPDATE_CHECK_DESCRIPTORS` (`updates.startupCheck`, `updates.check`, `updates.skipVersion`).
- Models: 3 actions, `request:check-for-release`, `driver:release-check` and `process:release-check-fetch`. `type:host-settings` now has `updates.checkOnStart`. The Help and Settings panels are updated and INDEX is regenerated.

## Decisions for the coordinator
1. **Direct-read ratchet exception.** `browser-update-check-device` (network: 1) was added to `GRANDFATHERED` in `tests/graph-direct-reads.test.ts`. The ratchet's rule is that no module is added. It is recorded as boundary open work 17 with a removal criterion. The alternative is to fold the request into an existing page device's request helper.
2. **Setting renamed.** `updates.checkAutomatically` became `updates.checkOnStart`. Every existing settings file holds `checkAutomatically: false`, written by default while nothing used it. Keeping that field would have left the check off for every current user, against the "default on" decision. The old field is dropped on load (`migrated: true`).
3. **Toast dismissal.** The toast's close button has no hook, so closing it or letting it fade means "remind me at next start". Only **Skip this version** stops a version being announced. If X should also skip, the UI track needs to add an `onDismiss` (or `onClose`) callback option to `Feedback.toast`. A sticky option already exists.
4. A deep code-health review is due per `tools/review_due.py`. This was already due before this branch.

## Tests
- Full authoring suite under guard 6 GB: 2976 pass, 32 skip, 0 fail, peak 3.0 GB.
- `tsc` main, tools and experiments are clean.
- `check_links` and `check_private_paths` are clean.
- New `tests/update-check.test.ts` covers SemVer, the policy, the adapter with a simulated fetch, the host endpoint, the actions and the notice. `tests/ui-polish-dom.test.ts` also covers Settings › Updates.

## UI evidence (ignored, `local-evidence/update-check/`)
- The captures were taken from isolated `?verify=1` servers on port 4392, one fixture each: `XFS_UPDATE_CHECK_FIXTURE=newer|current|offline`.
- The script is `local-evidence/capture.ts`. It runs headless Chrome through `tools/cdp`.
- Files follow `{notice|help-check|settings-updates}-{newer|current|offline}-{light|dark}-{narrow|wide}.png`.
- There are 24 files. Settings captures exist for `current` and `offline` only; the `newer` state appears in the notice and Help captures.
- Narrow is a 1100×760 window and wide is 1680×1000. The dock gives Help and Settings the same width at both sizes, so the panel width barely differs.
