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
- Choice previews follow the same rule (choice-preview-service.ts): the chosen choice, then the one under the pointer, then the row in view order, then other rows of the same kind shown this session; a started job always finishes and is kept; on the host a source derivation goes before the next batch prepared ahead but never stops a running one.
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
| Memory of a fresh `?verify=1` load | With cold preview and resolver caches, a fresh `?verify=1` load (server + Chrome) peaks above 4 GB before any panel is used: a capture run was stopped at 2.2 GB and again at 4.2 GB, 0.2 s after the page appeared, while V was still loading. With warm caches, the same run peaked at 3.2 GB in all (27 September 2026, `tools/expression-drawer-look.ts`) | measure where the cold peak sits (server resolve and decode versus Chrome's first textures) and bound it; stream or cap texture decodes on a cold V |
| Each change asked for checks the mod setup | about 55–90 ms of a prepared change's 75–110 ms (9,334 watched paths on the reference route) | let a clean check vouch for the requests of the next moment, or answer from the known state while checking |
| Host start with a fresh data folder (a verification server on its own port) | `bun server.ts` passed 3 GB of private memory while mounting 1,079 archives (80 not mounted) and reading their indexes, before any page loaded; killed twice by the memory guard at 3.1 GB (27 September 2026, reference MO2 route, with a copy of the resolver cache) | measure where the index read peaks; stream or share index tables so a second server fits in 3 GB |
| The skin scatter's first frame (27 September 2026) | 70–120 ms once per V: the first frame that scatters compiles one input-variant program per distinct drawn material (19 on the reference save's V); after that 0.2–0.45 ms per drawn frame for its passes on an RTX 4070 at up to 2600 × 1536 ([skin reference §11.5](../materials/shader-skin.md#115-performance)) | compile the variants in the background (`compileAsync` with the input target bound) while the wrap shows, then switch |
| Hair and other parts dropped after a failed export | the part never shows | never let one refused input drop a whole archive (PIPE-108) |
| Choice previews for the largest row (283 hairstyles, reference installation, every choice already prepared ahead; 27 September 2026) | **Cold** (no source or picture stored): first picture 17 s after the row opened (behind the V's own preparation), 30 in 57 s, all 282 (one draws nothing) in 146 s. Source derivation on the host: median 0.15 s, p90 1.4 s, max 4.8 s, 117 s in all (it plans and writes the prepared request's record). Drawing in the worker per picture: median 184 ms end to end, p90 850 ms (fetch 58 ms of a median 8.5 MB source, texture decode 36 ms, draw 27 ms for a median 57k triangles, WebP encode 19 ms); 8 KB per picture, 3.0 MB for the row plus 1.3 MB of sources. **Warm** (a later session): all 282 in 0.76 s once the lookups answer; the first picture waited 6.8 s for preparing ahead's readiness check before lookups were made for every shown choice (fixed the same day). A click during drawing: selection at once, host answer 187 ms, placed 265 ms (the same choice new to the page idle: 319 ms; repeats 73–79 ms), so drawing doesn't slow clicks. The studio page's JS heap was 350 MB with the row filled ([choice previews §10](../character-customization/choice-previews-design.md#phase-1-status-hairstyles)) | derive sources without planning the whole V (a slot-only plan from the prepared caches); compact sources (design phase 7); fetch coverage at a served mip instead of decoding 1–4K PNGs |
| Choice preview turntables (phase 2: 24-frame strips drawn on request for the hovered or large-shown choice; reference installation, headless Chromium, RTX 4070; 27 September 2026) | 44 strips cold: end to end median 250 ms (base-game styles, 4 MB sources) and 335 ms (mod styles, 19 MB, 192k triangles), p90 480–520 ms, max 725 ms; per strip: 24 frames drawn in 32–41 ms, WebP encode 89 ms (the largest step), fetch 64–168 ms, texture decode 34–38 ms. 139 KB median per strip (361 KB the largest): a fully turned 283-choice row would be about 40 MB, but only hovered choices are ever drawn. Hover to strip: median 247–328 ms; hover to first turn: median 415 ms (the 400 ms dwell dominates), max 739 ms. Main thread: no long task in 35 s of hovering while 20 strips were drawn; the page's JS heap flat at 243–261 MB. Not measured: a click while a strip is drawn (the capture page ran out of its 2 GB budget once clicks prepared new V's beside the server); the strip is drawn and encoded entirely in the worker and the service starts nothing new while a person's change is prepared, so no effect is expected ([choice previews phase 2](../character-customization/choice-previews-design.md#phase-2-status-layouts-and-turntables)) | time a click during a strip in a session with more memory; lower the strip's encode cost (quality 0.8, or 192 px frames) if hover-to-strip ever exceeds the dwell for large sources |
| Choice preview live turns (the one picture being turned drawn at the exact angle by the preview worker, ImageBitmap to a `bitmaprenderer` canvas; grid M, base-game style, headless Chromium, RTX 4070; 27 September 2026) | 29 frames a second (capped at 30, one request at a time); worker per frame median 0.1 ms to submit and 0.2 ms with the GPU waited for (about 6 ms of GPU a second); main thread 0.45 ms a second to show them; no long tasks in 4 s of turning, light and dark. Starting a live turn: 0.8 s after the strip is there (re-fetching and uploading the source while the worker finishes its current drawing); the strip turns meanwhile. Paused while a person's change is prepared ([choice previews](../character-customization/choice-previews-design.md#phase-2-status-layouts-and-turntables)) | keep the strip job's upload for the live turn instead of loading it again (would remove most of the 0.8 s) |
| A hairstyle's dangle spec (hair physics) | Reported as "dangles 5.5 s (2 WolvenKit launches)" on a preparation of an already-prepared hairstyle while deriving preview sources (which now skip dangles, `skipDangles`). Measured 27 September 2026 (`serveDangle` for `hh_033` and `hh_064`, reference MO2 route, fresh resolver cache): the first read of each set was one WolvenKit launch, 3.2–3.4 s; after that the resolver's JSON cache answered (0.3–38 ms in the same process, 1.4–9 ms after reopening the installation or restarting the process). The "each time" report didn't reproduce on a persistent cache; it was most likely a fresh worktree's cache | **Done** (27 September 2026): both roots read natively (NATIVE-64) and compiled specs cached by the files' content (`dangle-host.ts`). Fresh caches: 6–47 ms for the first set (47 ms includes the decode worker's start), no WolvenKit launch; same process 0.1–3.6 ms; after a restart 2–11 ms. Specs byte-identical to the WolvenKit route's |

## Related

[Mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction) · [Native archive reader](native-archive-reader.md) · [CC controls and presets](cc-controls-and-presets.md) · [View graph design](../authoring/view-graph-design.md)
