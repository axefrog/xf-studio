# W1: world content for a slice of the city

**Status:** offline reader, Kabuki file and optional Holotable base layers implemented, 27 October 2026, pending independent code/UI review and integration. The Story Engine's four format decisions remain provisional; the defaults below are implemented in one `CONTENT_POLICY` constant.

W0 gave Holotable the city's solid shapes. W1 adds what the world is *for*: where people gather and work, what they do there, and the places the game marks. Both the Story Engine (as the ground its simulation stands on) and Holotable's static base layers read it. So it's one file, produced once, from the game's own data, with no game session needed.

## Sources

All offline, from the effective vanilla archives (the same mount order and provenance rules as W0). See [world and streaming §1.4](../../knowledge/world-and-streaming.md#14-what-is-in-the-world-node-classes).

| What | Where it comes from |
|---|---|
| Districts, subdistricts and venues | The existing world pack (`xfh/world-pack-1`): outlines, Z bands, label points |
| Communities | Streamable compiled community areas (`worldCompiledCommunityAreaNode_Streamable`), with their spawn entries and phases, and the always-loaded community registries that name them |
| Spots | AI spot nodes (`worldAISpotNode`): position, facing, the `.workspot` they run, and the community entries that use them |
| Workspots | The `.workspot` resources the spots reference, reduced to what they show: an activity name and tags |
| Population spawners | `worldPopulationSpawnerNode`: position, record, and whether it's spawned on start |
| Points of interest | The world's `.mappins` and `.poimappins`: position, mappin variant (the kind of place), and any linked record or journal path |

The reader records the exact field mapping per source in the [world knowledge page](../../knowledge/world-and-streaming.md) as it's built and verified. It never invents a field: anything it can't read is left out and counted.

## The file

One JSON file per slice: `local/holotable/world/<slice>.content.json`. It's private and regenerable, and is kept beside the world pack's own cache. It's keyed on the vanilla archive stamps and the reader version, and is rebuilt when either changes.

```text
{
  schema: "xfh/world-content-1",
  slice: { id: "kabuki", title: "Kabuki", places: ["<place id>", …] },  // the world pack's place ids the slice covers
  source: { game: "2.31", archives: <stamp digest>, reader: "<version>", built: "<ISO time>" },
  communities: Community[],
  spots: Spot[],
  spawners: Spawner[],
  pois: Poi[],
  counts: { read: {…}, kept: {…}, dropped: {…}, reasons: {…} }  // per collection, like Holotable's channel coverage
}
```

All positions are world metres `[x, y, z]`, the same frame as recordings and the world pack. Every record carries a stable `id` (its node ref where it has one, else `<sector hash>:<placement index>`), and `place`: the smallest world-pack place that contains it (district, subdistrict or venue).

- **Community** `{ id, place, name?, area?: [x, y][], zlo?, zhi?, entries: { name, record?, phases: { name, time?: [from, to], spots: id[] }[] }[] }`. These are the groups the game populates: which character records spawn, in which phases (times of day), at which spots.
- **Spot** `{ id, place, at: [x, y, z], yaw, workspot?: { path, activity?, tags: string[] }, communities: id[] }`. A place a character stands, sits or works, and what they do there.
- **Spawner** `{ id, place, at, yaw, record, onStart?: boolean }`.
- **Poi** `{ id, place, at, kind, variant?, title?, record?, journal? }`. `kind` is the mappin variant in plain form ("Fixer", "Ripperdoc", "Food vendor", "Clothing", "Gun shop", "Drop point" and so on), mapped from the game's variant names in one table, and unknown variants are kept by their raw name. `variant` also retains the original variant for Technical details.

**Bounds:** a slice is about one district. The real Kabuki build keeps 663 communities and 7,534 spots. More than 50,000 combined community/spot/spawner/pin records, or 32 MiB of JSON, is refused with a message suggesting a smaller slice.

Assembly also enforces incremental limits of **100,000 nested records**, **200,000 links** and **32 MiB of estimated bytes** before extending an array, set or retained registry index. Estimates include worst-case JSON string escaping. Shared community nodes expand once in memory and placements reference the same entry array; each placement's serialized copy and reciprocal memberships still consume the budget. There is no unbounded `flatMap` expansion. Cache validation applies the same nested/link/estimated-byte limits to the complete serialized structure.

## Implemented reader and exact field mapping

Run `bun tools/build-world-content.ts --slice kabuki` from `projects/xf-holotable`. It uses the configured game folder and `local/holotable/world-pack.json`; `--game`, `--pack` and `--out` override those inputs/output directory. It prints counts and elapsed milliseconds only. The resulting file is `local/holotable/world/kabuki.content.json`. All game-derived content and caches are private and ignored.

The native addition is `readStreamingSectorContent`. It reuses W0's sector appendix and 144-byte placement decoder, selecting only the content classes. Ordinary properties, structs and handles already decode natively; **no new binary payload layout was needed**. It does not decode unrelated collision/instance buffers. Failed node decodes return typed refusals; budget failures stop the resource. After a failed handle decode, a fresh decoder prevents another node from seeing a partially cached object. W0's existing entry points are unchanged.

Evidence: effective vanilla game 2.31 resources decoded natively on 27 October 2026, cross-checked against WolvenKit source `11720772f1e20581301b3dec88a59f7b5ee05675`, `WolvenKit.RED4/Types/Classes/` (the class-named files below), plus the Modding Docs community guide at `be2f44eed841`, `modding-guides/quest/how-to-use-worldcommunityregistry-and-worldcompiledcommunity.md`. These are [resource], [source] and [wiki] evidence, never runtime proof. The [knowledge page](../../knowledge/world-and-streaming.md#141-w1-world-content-field-mapping) consolidates the verified findings.

| Source | Exact stored fields / join | Output and omission policy |
|---|---|---|
| Sector placement | `questPrefabRefHash`; `position`; `orientation` quaternion; original placement index | Nonzero global node-ref hash as decimal-string `id`; otherwise `<depot hash>:<original placement index>`. XYZ is world metres; `yaw` is quaternion rotation about world Z in **degrees**. No Number conversion of 64-bit ids. |
| `worldCompiledCommunityAreaNode_Streamable` and its base `worldCompiledCommunityAreaNode` | `debugName`; `sourceObjectId.hash`; `area` handle → `communityArea.entriesData[]` | `name` is the stored debug name. The base class's regular always-loaded communities are included too. Community `place` comes from the area's **placement origin**, not a fabricated polygon or a centroid of spots. |
| `communityCommunityEntrySpotsData` | `entryName`; `phasesData[].entryPhaseName`; `timePeriodsData[].periodName`; `spotNodeIds[].hash` | Entry/phase names and deduplicated spot ids. The period's spot sets are unioned within a phase; only retained slice spots become links, with reciprocal `spot.communities`. Out-of-slice/inactive/unavailable links are counted. |
| `communityArea` | Stores entry/phase/spot bindings, **no polygon or vertical band** | `area`, `zlo`, `zhi` absent, counted together in `community.area`. Neither placement bounds nor streaming boxes are called a community outline. |
| Compiled community periods | `periodName` labels exist; no verified interval end | `phase.time` absent, counted in `community.time`. Unioned phase links do **not** claim simultaneous occupancy or a time schedule. |
| `worldCommunityRegistryNode` | `communitiesData[].communityId.entityId.hash` = area `sourceObjectId.hash`; item `template` handle → `communityCommunityTemplateData.entries[]` handles → `communitySpawnEntry.entryName`, `characterRecordId` | Join by community id **and entry name** gives the entry's `record` (unsigned decimal TweakDBID, not a resolved record name). Every retained Kabuki entry joins. `entriesInitialState` is not interpreted as observed activity; node variant defaults and entry activation are separate concepts. |
| `worldAISpotNode` / `AIActionSpot` | `spot` handle → `AIActionSpot.resource.DepotPath`; placement pose | `at`, `yaw`, optional `workspot.path`. A spot subtype without a stored resource omits workspot detail. Failed/missing workspot resources omit the optional workspot object and are counted. |
| `workWorkspotResource` / `workWorkspotTree` | `workspotTree` handle → `rootEntry` handle → **stored** `idleAnim`; `tags.tags[]` | `activity` is the raw root idle name when present, not a semantic guess from the filename or a descendant animation. Missing/sentinel idle names omit activity. Omitted `tags` means the source constructor's verified empty tag list. No rig/appearance/animation-set payload is exported. |
| `worldPopulationSpawnerNode` | `objectRecordId`; explicitly stored `spawnOnStart`; placement pose | `record`, optional `onStart`, `at`, `yaw`. Zero/missing record refuses that spawner. Omitted `spawnOnStart` remains absent and is counted, not assumed false. |
| `gameMappinResource` (`.mappins`) | `cookedData[].journalPathHash`, `position`; `cookedMultiData[]` and `cookedGpsData[]`: `journalPathHash`, `positions[]` | One pin per stored position. Stable id includes resource hash, array name, row and position index. GPS positions are retained as positions, not treated as a complete navigation route. |
| `gamePointOfInterestMappinResource` (`.poimappins`) | `cookedData[].journalPathHash`, `position`; also stores `entityID` | Same positional mapping; `entityID` is **not** a character record or a fabricated node ref. |
| Cooked journals (base and expansion) | Entry path through `entry`/`entries` handles and `id`; **Murmur3 x86-32, seed `0x5EEDBA5E`** joins path to pin hash | `journal` is the complete path, including the expansion's `ep1/` prefix. Ambiguous hashes refuse pins. No journal path is guessed from a numeric hash. |
| `gameJournalPointOfInterestMappin` | `mappinData.typedVariant` handle → `variant`; `recommendedLevelID` | `kind` through the sole `POI_KINDS` table, with unknown variants kept verbatim; `variant` also preserves the original name. Optional `record` is the content-assignment TweakDBID, **not** a resolved vendor or NPC. No localized `title` is invented. |
| `gameJournalQuestMapPin` | `mappinData.variant`; omitted variant's source constructor default `DefaultQuestVariant` | Same kind mapping. Compiled pins without a verified journal variant are counted and dropped. A default constructor is used only for this verified class, not for arbitrary journal entries. |

Selection reads the effective copies of both vanilla streaming blocks, then selects every descriptor whose **actual XY rectangle intersects Kabuki's polygon and whose Z interval overlaps its band**. This includes unbounded AlwaysLoaded/Quest descriptors; it is not W0's Exterior/Interior category filter. The always-loaded registry is therefore available without using its dummy placement origin to select communities. Placements use range 0, persistent range and descriptor ranges enabled by default. Each spatial output record must lie within the slice's outline/Z band. `place` is the smallest-footprint containing district or venue from the whole pack; boundaries and both Z endpoints are included, with a stable id tie-break. This is the offline index's explicit rule, not proof of the engine's location-stack priority. All declared child places and spatially contained venues are listed in `slice.places`.

The assembled cache key covers ordered vanilla path/size/mtime stamps, the whole world pack, slice, reader versions and policy. Reader `w1.3` (raw pin variants retained) and sector codec `102` invalidate the earlier weaker validation. Both cache boundaries validate required fields and nested structures, including finite poses, phase/period arrays, links, registry entries and workspot tags; valid JSON with missing fields or null members is regenerated. The assembled cache probes bounded JSON before opening archive indexes. Per-sector reads reuse W0's `SectorWorkers` and SQLite job owner through a content codec in a separate cache file (32 MiB entry cap, existing 512 MiB disk budget and 32 MiB memory budget). Writes are atomic; changed archives/mount order, cancellation or a failed structural check prevent publication. The CLI has a five-minute deadline. On success, cancellation or failure it awaits owner shutdown: close messages drain active reads, and a stalled worker is terminated at a one-second deadline. W0's requester cancellation and `closeIdle()` still preserve active/shared reads. The CLI owns generation. The service reads only bounded, validated prepared files through its stamp-keyed `worldContentFiles` owner and existing view-context leases; no view starts archive generation.

Decoder nesting scopes use `try/finally` for exports, inline objects, package chunks and nested CR2W lists. A refused content node therefore cannot leave false nesting depth for later nodes; value/byte counters remain cumulative for the resource. Synthetic regressions cover a refused nested handle followed by valid content under a two-level depth budget, and a real synthetic worker stalled in a synchronous decode that shuts down within the requested deadline.

Counts are source records, not NPC population estimates. `communities`, `spots`, `spawners`, `registries` count selected-sector placements before slice/variant filtering; `pois` counts flattened positions from both map resources before filtering. `workspots` counts unique resource references from retained spots; `sectors` counts selected decoded sectors. Additional dotted channels count optional-field attempts and relationships independently, so omitting a field does not pretend the whole record was dropped. Each channel satisfies `read = kept + dropped`; its reasons partition dropped. Refusal reasons are applied in processing order (for example missing variant before spatial pin filtering).

The compiled map resources and registry are a **potential world**, not a read of active quests, activated entries or live NPCs. Default sector ranges do not mean every listed community entry is spawned on start. Mods, quest-state resolution, character-record expansion, semantic workspot classification remain outside this round.

## Kabuki offline checkpoint

Game 2.31 with Phantom Liberty; Bun 1.4.4; 27 October 2026, shared Windows machine. Final measurement starts without the assembled file **or** W1 sector cache; the OS disk cache is not flushed. Commands run sequentially under the 4 GiB memory guard. Full private coverage/timing receipts are in `local/holotable/evidence/w1/`.

| Collection | Read | Kept | Dropped | Reasons |
|---|---:|---:|---:|---|
| Communities | 4,570 | 663 | 3,907 | Outside slice 3,907 |
| Spots | 48,759 | 7,534 | 41,225 | Outside slice 41,039; inactive variant 185; duplicate id 1 |
| Spawners | 3,425 | 166 | 3,259 | Outside slice 3,209; missing `objectRecordId` 29; inactive variant 21 |
| Pins | 5,378 | 268 | 5,110 | Outside slice 4,702; journal variant unavailable 408 |
| Unique workspots | 571 | 568 | 3 | Resource absent from effective vanilla archives 3 |
| Registry nodes | 1 | 1 | 0 | — |
| Selected sectors | 3,824 | 3,824 | 0 | — |

All 1,958 community entries join to records. There are 2,673 phase records and 4,932 retained community-to-spot links; 533 links point to spots outside the slice, inactive or unavailable. Geometry is omitted for all 663 communities; times for all 2,673 phases. Only two of the 568 decoded workspots store a usable root idle name; 566 omit `activity`. These omissions are intentional evidence limits, not a declaration that the NPC has no activity. Pin titles are unresolved (268 omissions); 26 pins have linked content-assignment records, 242 do not. Source `spawnOnStart` is explicit for 14 retained spawners and omitted/count-reported for 152.

`spot.workspot` reads 7,534 optional fields: 7,438 kept, 96 omitted (91 spots have no stored resource; five spots reference the three missing resources).

| Build | Elapsed inside CLI | Guard peak |
|---|---:|---:|
| Cold W1 caches, reader `w1.2` | 5,565 ms | 1.0 GiB |
| Unchanged file, fresh process | 34 ms | Below guard's 0.1 GiB reporting precision |

The CLI elapsed value covers archive stamps, place selection, cache probe and, on cold, archive indexes/sector reads/joins/workspots/journals/atomic file write. Process startup and the guard's polling interval are excluded. The review rebuild's entire coverage object (read/kept/dropped/reasons for every channel) equals the previous build. Its final cold time is 5,565 ms versus the previous 6,418 ms; single shared-machine measurements do not establish a performance improvement or a validation cost. The JSON is 2,632,044 bytes; the reusable sector SQLite file is 30,105,600 bytes. Both stay private. The next cold-build cost to investigate is selective placement/resource decoding across the 3,824 descriptors; no performance claim is made for drawing these records.

Synthetic fixtures cover every source class's mapping, exact place/Z/box selection, default/persistent variants, id and yaw conversion, refusal bounds, both directions of community links, field/record counts, workspot omissions, journal hashing and all three pin arrays, unknown variants, cache key changes/reuse/corruption/cancellation and isolation from W0's codec. No game payload fixture is committed. Final timing/check results are recorded in the private handoff; independent code review belongs to the dispatching chat before integration.

Checks: Holotable `bun test` **120 pass**; native streaming-sector tests **8 pass, 4 opt-in real-sector comparisons skipped**; the native CR2W/package smoke file **6 pass**; both projects' full `bun run check` commands pass, including the Studio tools/experiment configurations. Each ran sequentially under the 4 GiB guard. Regressions cover repeated-placement sharing and nested budgets, valid-JSON corruption and rebuilding at both cache boundaries, exception-safe depth recovery, bounded stalled-worker shutdown and W0 shared-worker behavior. Repository link and privacy checks pass; new candidate files are separately privacy-scanned because the standard scripts enumerate tracked files. No full Studio test-suite run or game session is claimed or required by this reader brief.

## What each side does with it

**Story Engine.** It reads the file directly, as the ground truth for where its simulated residents can be: which communities exist, when they're out, which spots they use and what they do there, and which places offer which services. Nothing passes through Holotable's service.

**Holotable.** Three base layers in Show, off by default below Solid shapes:
- **Places of interest:** glyph plates through one kind-to-Places table (`view/base-layers.ts`), with Place as the raw-variant fallback. They join clusters, the Places legend, selection and inspector cards.
- **Gathering spots:** muted 3 px dots, never labelled, plated, clustered or fanned out; overlapping dots retain their density. A cooperative nearest-selection heap admits at most 2,000 visible spots per frame, nearest the view centre first. The legend lists them as Gathering spots, after Places; communities have no legend row. Cards show comma-separated readable workspot tags, or “No activity recorded”, and community chips; workspot path, yaw and id stay under Technical.
- **Communities:** no outlines are inferred. Each label is the centroid of its linked spots in view and reads “Community · N spots”; overview opacity ramps from zero at 100 m through half at 150 m to full at 200 m. Community size order (unique source spot links, then ID) is cached per content response, with cooperative preparation. Labels share ordinary collision culling against text and plates in that order, stopping at 12 placed or 64 candidate attempts; label layout resumes under the existing frame deadline; one linked spot reads “Community · 1 spot”. Show counts every community with a linked spot in view even when its label is faded or culled. Cards show entry summaries and phase names under When. Short codes (three characters or fewer) and non-word names become “N time phases”, with raw names under Technical. Only linked spots that resolve in the current response become chips, at most 12, using the first tag in plain words (“Spot · sit bar”), else an ordered “Spot · N”. Extra resolvable spots retain “+N more”; unresolved links are counted separately in the plain, non-interactive “N more further away” line.

Community `record` is currently a numeric TweakDBID. Per the coordinator's scope decision, numeric ids appear only under Technical as Character records; the summary says “N character types” (singular at one). A reader follow-up will reverse-map TweakDB source record names through `tweakDbId()`. Already readable dotted record names use their last segment with underscores replaced by spaces.

The service looks up prepared slices through the reader's shared slice table when their world-pack places overlap the requested region. Existing per-view world-context leases include `content:true` only while a base layer is enabled. The file owner validates and caches by size/mtime/ctime. Explicit `world.content.demand` consumer acquire/release follows active view leases and enabled base layers; the final release starts a 30-second idle eviction, canceled by a reacquire. Any remaining consumer retains the cache. Content region reads carry the same consumer identity so a restarted service reacquires demand; region responses contain only nearby spots/pins and their linked communities. Hiding/releasing views drops unshared region records. Missing files are ordinary: all three rows say “Not built yet”, with the hint “World content for this district hasn't been prepared”. No CLI command appears in the UI, and no view triggers a build. The bound view supplies its own counts/availability through the same binding as Focus. Counts retain the last completed frame during a budgeted redraw, including selection changes; an explicit scene clear resets them.

Base layers never enter the agent spool, change timelines, Quiet until or pulse/retraction snapshots. Their opacity changes only with overview distance. Explicit focus and exact cluster membership work independently of the 2,000-dot drawing cap.

Synthetic tests cover file laziness/stamp replacement, missing files, region selection, lease demand/release, glyphs, nearest-first cap and yielding, centroids/opacity, cards, bounded chips, bound-view counts, legend counts and effects/stepping exclusion. The isolated capture tool serves the real private Kabuki file and world pack with offline W0 geometry, using its own headless browser and ephemeral server. It saves light/dark × 300/850 px overview, close, three selected cards, Show and missing-file captures beside component patterns. No game is launched; independent design PASS remains with the coordinator.

The design-review capture refresh uses `bun tools/capture-w1-layers.ts --design-fixes` for overview, close and community cards in both themes at 300/850 px. It leaves the earlier timing/baseline receipts intact.

### W1 plus W0 drawing measurement

Before the design-review fixes, 27 October 2026, Bun 1.4.4, own headless Chrome with GPU disabled, shared Windows machine, sequential under a 4 GiB guard (1.3 GiB peak). The real rebuilt `w1.3` Kabuki file has unchanged counts and raw variants; its sector-cache-assisted rebuild took 1,432 ms (not a cold-cache comparison). The orbit uses all three content layers, actual world-pack districts and a real 12,000-solid W0 pool; wide frames draw up to the 900-solid cap.

| Theme | Panel | Frame median | Frame p95 | Maximum | Draw calls | Resumed/pending |
|---|---:|---:|---:|---:|---:|---:|
| Light | 300 px | 4.5 ms | 5.3 ms | 6.8 ms | 367 | 366 |
| Light | 850 px | 4.8 ms | 5.8 ms | 7.4 ms | 379 | 379 |
| Dark | 300 px | 4.6 ms | 5.3 ms | 6.2 ms | 368 | 365 |
| Dark | 850 px | 4.8 ms | 5.9 ms | 7.1 ms | 382 | 378 |

These are per-draw CPU times, including resumed preparation/drawing, over 120 pointer-driven orbit moves per combination. Nearly all orbit draws are incomplete/resumed because a camera change restarts bounded marker/solid preparation. A stopped view converges; captures await completion. They meet the 8 ms per-frame allowance but do **not** establish complete-scene throughput at 60 Hz, GPU presentation time or game performance. The next responsiveness cost is complete-scene convergence while moving a dense camera, not file loading.

The same 120-move orbit was then measured with all three W1 layers off, leaving the same solids and existing (empty) agent projection on. “Pending” means the draw needs another continuation; the rate includes preparation and drawing, not only missing geometry.

| Theme | Panel | W1 off median / p95 / max | W1 off pending | W1 on pending |
|---|---:|---|---:|---:|
| Light | 300 px | 2.9 / 3.5 / 4.4 ms | 324/361 (89.8%) | 366/367 (99.7%) |
| Light | 850 px | 5.4 / 5.9 / 6.4 ms | 369/444 (83.1%) | 379/379 (100.0%) |
| Dark | 300 px | 3.0 / 3.5 / 4.0 ms | 295/356 (82.9%) | 365/368 (99.2%) |
| Dark | 850 px | 5.6 / 5.9 / 6.3 ms | 458/476 (96.2%) | 378/382 (99.0%) |

Solids alone already resume often. W1 raises the pending share in all four combinations; the comparison is a shared-machine sequential observation, not a statistical benchmark. The coordinator queued motion convergence as R&D: explore a coarser complete moving scene, refining after movement stops. No further optimisation was made in this round.
 Private `measurements.json` and the handoff hold the receipts; no game-derived payload or capture is committed.

## Open questions for the Story Engine

1. Is a per-slice file right, or do you want one file for the whole city with slices as a filter? The cost is size: the whole city may be tens of MB.
2. Do you need workspot detail beyond an activity name and tags (for example the animation sequence names, or whether a spot is sitting, standing or leaning)?
3. Do you need the character record's own data (gender, faction, appearance) resolved, or are record ids enough, since you can resolve them yourself?
4. Do quest-variant spots matter to you, or is the default world enough? The default is variant 0 and the enabled-by-default variants only, as for W0.
