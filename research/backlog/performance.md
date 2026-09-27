# Load time and responsiveness (standing research track)

**Goal (asymptotic):** the moment the interface appears, every last thing is already loaded, visible and ready to interact with, and every click that needs other or new assets shows its result with no perceivable load time. Reality falls short; the track keeps closing the gap. Set on 27 September 2026.

## How the track works

- **Measure end to end, not per function:**
  - page shown → interactive;
  - V visible and complete, cold and warm;
  - click on a choice → pixels on screen;
  - first time and repeat.

  The host's preparation log line already times every stage ([mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction)).
- **Keep budgets** (below). A regression past a budget is a bug.
- **Attack the biggest measured cost next.** Record each finding and its before/after in [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction) or the relevant knowledge page.
- **Perceived speed counts as much as raw speed:**
  - instant, optimistic feedback, and the person's actions pre-empt background work (the "respond instantly" rule in AGENTS.md);
  - progressive display: show what's ready, fill in the rest;
  - [Activity view](README.md) for what's still happening.

## Scheduling rule for background work (27 September 2026)

- Priorities: the active selection, then what's under the pointer, then the current row, then the current feature set, then everything else.
- A job that has passed a progress threshold is not cancelled when priorities change. It finishes at low priority and its result is cached for next time.
- The person's own actions always come first.

## Budgets (initial targets)

| Moment | Target |
|---|---|
| Click on a choice → selection shown | immediate (same frame) |
| Click on a prepared choice → V updated | < 100 ms |
| Click on an unprepared choice → V updated | < 1 s typical, progress shown at once |
| Page shown → interactive | < 1 s |
| Restart, warm caches → own V complete | < 2 s |
| First ever run, cold → own V complete | as low as measurable; progress throughout |

## Known costs and candidate work (27 September 2026)

| Cost | Measured | Candidate |
|---|---|---|
| WolvenKit geometry export on a cold V | ~17–27 s | native mesh decoding ([native reader](native-archive-reader.md) phase 4) |
| Clothing factory `.csv` files on first use | 642 files, ~35 s through WolvenKit | native `C2dArray` decoding (PIPE-105) |
| Texture decodes on a cold V | 11–16 s for 66 textures | already native; parallel workers or GPU transcoding if it becomes the longest stage |
| Warm restart | ~5–6 s (open 1.7 s, resolve 1–2 s) | persist the resolved graph and mount plan across restarts; start preparing the V before the page asks |
| Choice clicks | host answers in 0.1–0.2 s, but the selection lagged seconds | optimistic selection and pre-emption (fix in progress); prefetch likely next choices |
| Hair and other parts dropped after a failed export | the part never shows | never let one refused input drop a whole archive (PIPE-108) |

## Related

[Mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction) · [Native archive reader](native-archive-reader.md) · [CC controls and presets](cc-controls-and-presets.md) · [View graph design](../authoring/view-graph-design.md)
