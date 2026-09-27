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
- Implementation on the host (27 September 2026): background loops take a turn between units of work (`src/event-loop.ts` `timeSlicer`: a macrotask once 8 ms are used, so waiting requests are answered); checking which choices are ready runs one manifest entry at a time; while a person's change is asked for, prepared or its files are read, background work waits until the page has been quiet for 400 ms (`QUIET_MS`), and a batch in progress is stopped at once, even when the change's answer was already ready (`ChoicePrefetcher.pause`). Selection and hover order the queue; a feature-set tier is not built (one row is prepared ahead at a time).

## Measuring click → pixels

`tools/measure-character-page.ts` drives a headless GPU Chrome against an isolated server (its own port, `XFAS_DATA_DIR` and `XFS_SETTINGS_DIR`; never 4317) and reads the page's `xfs:character:*` marks (`src/character-timing.ts`): ask, answer, record, loaded, placed, first frame. It runs hairstyle, colour, makeup on, hide makeup, Reset all and a burst of three hairstyles, optionally on a save copy's V and with a row prepared ahead (`XFS_MEASURE_PREFETCH`), and can profile one change (`XFS_MEASURE_PROFILE`). Pair it with a `/health` probe loop to see whether the host answers while it works.

## Budgets (initial targets)

| Moment | Target |
|---|---|
| Click on a choice → selection shown | immediate (same frame) |
| Click on a prepared choice → V updated | < 100 ms (met for parts shown before on the page: 73–111 ms on the reference save V, with or without a row prepared ahead; a part new to the page adds its first frame, above) |
| Click on an unprepared choice → V updated | < 1 s typical, progress shown at once |
| Page shown → interactive | < 1 s |
| Restart, warm caches → own V complete | < 2 s |
| First ever run, cold → own V complete | as low as measurable; progress throughout |

## Known costs and candidate work (27 September 2026)

| Cost | Measured | Candidate |
|---|---|---|
| WolvenKit geometry export on a cold V | ~17–27 s | **Done**: native mesh decoding ([native reader](native-archive-reader.md) phase 4); the default V's 18 meshes and morph targets decode in 1.75 s, and a cold preparation took 19.9–20.0 s against 56–63 s with WolvenKit's geometry export the same day |
| Clothing factory `.csv` files on first use | 642 files, ~35 s through WolvenKit | native `C2dArray` decoding (PIPE-105) |
| Texture decodes on a cold V | 11–16 s for 66 textures | already native; parallel workers or GPU transcoding if it becomes the longest stage |
| Warm restart | ~5–6 s (open 1.7 s, resolve 1–2 s) | persist the resolved graph and mount plan across restarts; start preparing the V before the page asks |
| Choice clicks | host answers in 0.1–0.2 s, but the selection lagged seconds | optimistic selection and pre-emption (fix in progress); prefetch likely next choices |
| Character changes took seconds (hide makeup "many seconds", Reset all 30 s+) while the host log said 0.2–0.3 s | Not the page: it already reused unchanged parts (PREV-68). The host's event loop was blocked for up to 26.6 s at a time by work prepared ahead for an open Character row, and the log timed only the preparation, not the wait. Reference save V, row open: most changes took several seconds, up to 27.8 s; after, 0.08–0.11 s once prepared and 0.1–1.1 s the first time (PREV-118; [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction)) | **Done** (27 September 2026): background work yields the event loop and steps aside for a person's request; parts kept for reuse on the page; faster answer polling |
| A part never shown on this page costs its first frame | 150–220 ms on a new hairstyle: texture upload about 125 ms, program link about 60 ms | upload a new part's textures a few per frame before swapping it in, and compile its programs with the render target the scene draws into; smaller preview mips or GPU-compressed textures |
| Each change asked for checks the mod setup | about 55–90 ms of a prepared change's 75–110 ms (9,334 watched paths on the reference route) | let a clean check vouch for the requests of the next moment, or answer from the known state while checking |
| Host start with a fresh data folder (a verification server on its own port) | `bun server.ts` passed 3 GB of private memory while mounting 1,079 archives (80 not mounted) and reading their indexes, before any page loaded; killed twice by the memory guard at 3.1 GB (27 September 2026, reference MO2 route, with a copy of the resolver cache) | measure where the index read peaks; stream or share index tables so a second server fits in 3 GB |
| Hair and other parts dropped after a failed export | the part never shows | never let one refused input drop a whole archive (PIPE-108) |

## Related

[Mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction) · [Native archive reader](native-archive-reader.md) · [CC controls and presets](cc-controls-and-presets.md) · [View graph design](../authoring/view-graph-design.md)
