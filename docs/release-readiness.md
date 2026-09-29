# 1.0 readiness: "ready to publish on Nexus for the first time"

**Status:** the acceptance bar for XF Studio's first public release (set 29 September 2026). The first public release is a **beta**: its job is to confirm, across other people's installs and mod setups, that things "just work" about 99 % of the time. This page is the checklist; each line is either met (with evidence) or open (with the work that closes it). Current state lives in [status](status.md), and open findings in the [code-health ledger](../research/authoring/code-health.md).

## The bar

| Area | Ready means | How it's checked |
|---|---|---|
| Consistency | UI and UX consistent down to minor details: wording, spacing, states, icons, help tips, naming | A full UI consistency audit against the style guide and the [visual QA checklist](../research/authoring/ui-visual-qa-checklist.md), light and dark, narrow and wide; every UI finding closed |
| No glitches | Nothing flickers, freezes, jumps, loses work or shows stale state | Scripted walkthroughs of every panel; the "respond instantly" rules held; no open High or Medium UX findings |
| No annoyances | Nothing makes the user wait, repeat themselves, dismiss noise or hunt for things | A friction pass over the first-run, authoring, Check, Build and install flows |
| Discoverable | Every main action obvious where it's needed; plain-language guidance; no dead ends | First-run and task walkthroughs by someone who hasn't seen the Studio |
| Exportable first | What fills the UI is mainly features that export and work in game; preview-only and research features are out of the default path | An inventory of every visible feature by export status; preview and research items behind research tools or removed |
| Fast | No multi-second wait for anything the user does; first paint and every interaction snappy | Budgets in the [performance backlog](../research/backlog/performance.md), measured end to end on the reference installation; every budget met |
| Works in game | XF Eye Artistry's shipped finishes verified in game; install and uninstall clean | In-game sessions ([next sessions plan](../research/runtime/next-sessions-plan.md)); the desktop acceptance |
| Beta scope | Clear beta labelling, easy problem reports, a way to learn about updates | The release notes and the in-app Report a problem flow; the update notifier |

## Known open items (29 September 2026)

The first full [readiness audit](../research/authoring/release-readiness-audit.md) (29 September 2026) inventories every visible feature by export status, lists the consistency, speed and first-run gaps, and ranks the closing work by track.

- **Speed:** choosing a finish no longer freezes the page (PREV-188 fixed: Colour-shifting drawn in about 15 ms, Glitter's programs compiled ahead), and a hairstyle switch no longer freezes it either (PREV-189 fixed: a prepared hairstyle the pointer rested on shows in about 80 ms, one new to the page in 0.25–0.9 s, never with a task over 50 ms). A hairstyle never prepared no longer waits for WolvenKit (PREV-190 fixed: layer masks read natively, two decode workers; the host 0.2–1.2 s, click to frame 0.3–2.3 s), and a restart to the player's own V went from 12–13 s to 2.8–3.0 s after the page starts (PREV-196: kept route discovery and V answers, the page's warm start). Still open: that restart against its 2 s budget (the page loads its head's motion before it asks for its V, and the host's other start-up work contends for its thread), a cold hairstyle with 4096² maps (up to 2.3 s), and first-run preparation (about 55 s before; a cold V now launches no WolvenKit at all, to be measured again; a one-time step with progress, but still measured against a budget).
- **Finishes:** Glitter and Shimmer reworked offline and waiting for in-game verdicts; Glossy and Colour-shifting still experimental.
- **Clutter:** audited and cleared from the default path (audit items 5–8): Shimmer and Glitter, the rendering and display studies and the raw exports sit behind research tools until they pass in game or are needed.
- **Beta scope:** a Beta badge, the beta's What's new tour, Help's limitations and Report a problem in the first-run texts are in place; the way to learn about updates is **Check for updates** in Help (the releases page). A network update check awaits a consent design (audit item 22).
- **Consistency:** the layout and spacing pass (audit item 19, C-26 to C-33) is done, with the findings it covered (UI-139..162, DESK-06), and so are copy, terminology and states (items 15–18 and 20: finish names, "3D view", plain units and words, one place per state, quiet reasons). Still open: UI-142's build steps and layer names repeating after a removal (CORE-125).
