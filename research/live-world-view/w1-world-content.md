# W1: world content for a slice of the city

**Status:** offline reader, Kabuki file and optional Holotable base layers implemented, 27 October 2026, pending independent code/UI review and integration. Reader `w1.7.1` adds raw periods, explicit quantities and registry identities (28 October 2026), following `w1.6`’s slice catalogue and shared records table; the agreed policies live in one `CONTENT_POLICY` constant.

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

One JSON file per slice: `local/holotable/world/<slice>.content.json`. It's private and regenerable, and is kept beside the world pack's own cache. It's keyed on the vanilla archive stamps, REDmod source/compiled-TweakDB stamps and the reader version, and is rebuilt when either changes.

```text
{
  schema: "xfh/world-content-1",
  slice: { id: "kabuki", title: "Kabuki", places: ["<place id>", …] },  // the world pack's place ids the slice covers
  source: { game: "2.31", archives: <stamp digest>, reader: "<version>", built: "<ISO time>", fingerprint: <shared input digest> },
  records: { [recordId]: ContentRecord }, // every community/spawner reference, once per distinct id
  communities: Community[],
  spots: Spot[],
  spawners: Spawner[],
  pois: Poi[],
  counts: { read: {…}, kept: {…}, dropped: {…}, reasons: {…} }  // per collection, like Holotable's channel coverage
}
```

All positions are world metres `[x, y, z]`, the same frame as recordings and the world pack. Every record carries a stable `id` (its node ref where it has one, else `<sector hash>:<placement index>`), and `place`: the smallest world-pack place that contains it (district, subdistrict or venue).

- **Community** `{ id, place, name?, registry?: { id, sourceObjectId }, area?: [x, y][], zlo?, zhi?, entries: { name, record?, phases: { name, time?: [from, to], periods: { name, quantity?, condition?, spots: id[] }[], spots: id[] }[] }[] }`. `registry.id` identifies the registry node’s placement; `registry.sourceObjectId` identifies its community instance, independently of the area’s placement `id`. Phase names are raw state names, not necessarily times of day. `periods` preserve raw `periodName` labels and per-period slice spot sets; phase `spots` remains their deduplicated union. Missing quantity/condition means unavailable, never one/unconditional. No separate entry quantity cap is currently verified.
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
| `communityCommunityEntrySpotsData` | `entryName`; `phasesData[].entryPhaseName`; `timePeriodsData[].periodName`; `spotNodeIds[].hash` | Entry/phase names, raw `periods[].name` and deduplicated per-period spot ids; phase-level union retained. Only retained slice spots become links, with reciprocal `spot.communities`. Missing period names omit/count the period but preserve its legacy phase links. Unavailable links are counted separately per period and per phase union. |
| `communityArea` | Stores entry/phase/spot bindings, **no polygon or vertical band** | `area`, `zlo`, `zhi` absent, counted together in `community.area`. Neither placement bounds nor streaming boxes are called a community outline. |
| Compiled community periods / registry `communityPhaseTimePeriod` | Compiled `periodName`; registry template entry `phases[].phaseName`, `timePeriods[].hour`, explicitly stored UInt16 `quantity` | An unambiguous join by source-object id, entry, phase and equal period label yields optional `period.quantity`, including zero. The verified `communityTimePeriod` constructor supplies omitted `hour = Day`; omitted quantity remains absent. Clock-label spellings are not translated. No verified condition or interval end: `condition`/`phase.time` absent and counted. Neither spot count nor phase name supplies quantity/condition. |
| `worldCommunityRegistryNode` | `communitiesData[].communityId.entityId.hash` = area `sourceObjectId.hash`; registry node placement id; item `template` handle → `communityCommunityTemplateData.entries[]` handles → `communitySpawnEntry.entryName`, `characterRecordId` | `community.registry = { id: registry placement id, sourceObjectId: joined instance hash }`, both strings; missing joins omit/count the pair. Join by community id **and entry name** gives the entry's `record` (unsigned decimal TweakDBID, not a resolved record name). Every retained Kabuki entry joins. The shared `records[record].name` is the full name reversed from REDmod declarations through `tweakDbId()`. `entriesInitialState` is not interpreted as observed activity; node variant defaults and entry activation are separate concepts. |
| `worldAISpotNode` / `AIActionSpot` | `spot` handle → `AIActionSpot.resource.DepotPath`; placement pose | `at`, `yaw`, optional `workspot.path`. A spot subtype without a stored resource omits workspot detail. Failed/missing workspot resources omit the optional workspot object and are counted. |
| `workWorkspotResource` / `workWorkspotTree` | `workspotTree` handle → `rootEntry` handle → **stored** `idleAnim`; `tags.tags[]` | `activity` is the raw root idle name when present, not a semantic guess from the filename or a descendant animation. Missing/sentinel idle names omit activity. Omitted `tags` means the source constructor's verified empty tag list. No rig/appearance/animation-set payload is exported. |
| `worldPopulationSpawnerNode` | `objectRecordId`; explicitly stored `spawnOnStart`; placement pose | `record`, optional `onStart`, `at`, `yaw`. Zero/missing record refuses that spawner. Omitted `spawnOnStart` remains absent and is counted, not assumed false. |
| `gameMappinResource` (`.mappins`) | `cookedData[].journalPathHash`, `position`; `cookedMultiData[]` and `cookedGpsData[]`: `journalPathHash`, `positions[]` | One pin per stored position. Stable id includes resource hash, array name, row and position index. GPS positions are retained as positions, not treated as a complete navigation route. |
| `gamePointOfInterestMappinResource` (`.poimappins`) | `cookedData[].journalPathHash`, `position`; also stores `entityID` | Same positional mapping; `entityID` is **not** a character record or a fabricated node ref. |
| Cooked journals (base and expansion) | Entry path through `entry`/`entries` handles and `id`; **Murmur3 x86-32, seed `0x5EEDBA5E`** joins path to pin hash | `journal` is the complete path, including the expansion's `ep1/` prefix. Ambiguous hashes refuse pins. No journal path is guessed from a numeric hash. |
| `gameJournalPointOfInterestMappin` | `mappinData.typedVariant` handle → `variant`; `recommendedLevelID` | `kind` through the sole `POI_KINDS` table, with unknown variants kept verbatim; `variant` also preserves the original name. Optional `record` is the content-assignment TweakDBID, **not** a resolved vendor or NPC. Optional `title` follows the verified journal/record routes below; unresolved titles remain absent. |
| `gameJournalQuestMapPin` | `mappinData.variant`; omitted variant's source constructor default `DefaultQuestVariant` | Same kind mapping. Compiled pins without a verified journal variant are counted and dropped. A default constructor is used only for this verified class, not for arbitrary journal entries. |

Selection reads the effective copies of both vanilla streaming blocks, then selects every descriptor whose **actual XY rectangle intersects Kabuki's polygon and whose Z interval overlaps its band**. This includes unbounded AlwaysLoaded/Quest descriptors; it is not W0's Exterior/Interior category filter. The always-loaded registry is therefore available without using its dummy placement origin to select communities. Placements use range 0, persistent range and descriptor ranges enabled by default. Each spatial output record must lie within the slice's outline/Z band. `place` is the smallest-footprint containing district or venue from the whole pack; boundaries and both Z endpoints are included, with a stable id tie-break. This is the offline index's explicit rule, not proof of the engine's location-stack priority. All declared child places and spatially contained venues are listed in `slice.places`.

The assembled cache key covers ordered vanilla and REDmod/compiled-TweakDB path/size/mtime stamps, the whole world pack, slice, reader versions and policy. Reader `w1.7.1` (periods and registry identities) and sector codec `103` invalidate earlier files and sector entries. Both cache boundaries validate required fields and nested structures, including finite poses, phase/period arrays, links, registry entries and workspot tags; valid JSON with missing fields or null members is regenerated. The assembled cache probes bounded JSON before opening archive indexes. Per-sector reads reuse W0's `SectorWorkers` and SQLite job owner through a content codec in a separate cache file (32 MiB entry cap, existing 512 MiB disk budget and 32 MiB memory budget). Writes are atomic; changed archives/mount order, cancellation or a failed structural check prevent publication. The CLI has a five-minute deadline. On success, cancellation or failure it awaits owner shutdown: close messages drain active reads, and a stalled worker is terminated at a one-second deadline. W0's requester cancellation and `closeIdle()` still preserve active/shared reads. The CLI owns generation. The service reads only bounded, validated prepared files through its stamp-keyed `worldContentFiles` owner and existing view-context leases; no view starts archive generation.

Decoder nesting scopes use `try/finally` for exports, inline objects, package chunks and nested CR2W lists. A refused content node therefore cannot leave false nesting depth for later nodes; value/byte counters remain cumulative for the resource. Synthetic regressions cover a refused nested handle followed by valid content under a two-level depth budget, and a real synthetic worker stalled in a synchronous decode that shuts down within the requested deadline.

Counts are source records, not NPC population estimates. `communities`, `spots`, `spawners`, `registries` count selected-sector placements before slice/variant filtering; `pois` counts flattened positions from both map resources before filtering. `workspots` counts unique resource references from retained spots; `sectors` counts selected decoded sectors. Additional dotted channels count optional-field attempts and relationships independently, so omitting a field does not pretend the whole record was dropped. Each channel satisfies `read = kept + dropped`; its reasons partition dropped. Refusal reasons are applied in processing order (for example missing variant before spatial pin filtering).

The compiled map resources and registry are a **potential world**, not a read of active quests, activated entries or live NPCs. Default sector ranges do not mean every listed community entry is spawned on start. Mods, quest-state resolution, appearance data, and semantic workspot classification remain outside this round.

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

All 1,958 community entries join to records. There are 2,673 phase records and 4,932 retained community-to-spot links; 533 links point to spots outside the slice, inactive or unavailable. Geometry is omitted for all 663 communities; times for all 2,673 phases. Only two of the 568 decoded workspots store a usable root idle name; 566 omit `activity`. These omissions are intentional evidence limits, not a declaration that the NPC has no activity. Pin titles resolve for 238/268 pins (30 omissions); 26 pins have linked content-assignment records, 242 do not. Source `spawnOnStart` is explicit for 14 retained spawners and omitted/count-reported for 152.

`spot.workspot` reads 7,534 optional fields: 7,438 kept, 96 omitted (91 spots have no stored resource; five spots reference the three missing resources).

| Build | Elapsed inside CLI | Guard peak |
|---|---:|---:|
| Cold W1 caches, reader `w1.2` | 5,565 ms | 1.0 GiB |
| Unchanged file, fresh process | 34 ms | Below guard's 0.1 GiB reporting precision |

The CLI elapsed value covers archive stamps, place selection, cache probe and, on cold, archive indexes/sector reads/joins/workspots/journals/atomic file write. Process startup and the guard's polling interval are excluded. The review rebuild's entire coverage object (read/kept/dropped/reasons for every channel) equals the previous build. Its final cold time is 5,565 ms versus the previous 6,418 ms; single shared-machine measurements do not establish a performance improvement or a validation cost. The JSON is 2,632,044 bytes; the reusable sector SQLite file is 30,105,600 bytes. Both stay private. The next cold-build cost to investigate is selective placement/resource decoding across the 3,824 descriptors; no performance claim is made for drawing these records.

Synthetic fixtures cover every source class's mapping, exact place/Z/box selection, default/persistent variants, id and yaw conversion, refusal bounds, both directions of community links, field/record counts, workspot omissions, journal hashing and all three pin arrays, unknown variants, cache key changes/reuse/corruption/cancellation and isolation from W0's codec. No game payload fixture is committed. Final timing/check results are recorded in the private handoff; independent code review belongs to the dispatching chat before integration.

Checks: Holotable `bun test` **120 pass**; native streaming-sector tests **8 pass, 4 opt-in real-sector comparisons skipped**; the native CR2W/package smoke file **6 pass**; both projects' full `bun run check` commands pass, including the Studio tools/experiment configurations. Each ran sequentially under the 4 GiB guard. Regressions cover repeated-placement sharing and nested budgets, valid-JSON corruption and rebuilding at both cache boundaries, exception-safe depth recovery, bounded stalled-worker shutdown and W0 shared-worker behavior. Repository link and privacy checks pass; new candidate files are separately privacy-scanned because the standard scripts enumerate tracked files. No full Studio test-suite run or game session is claimed or required by this reader brief.

## Readable names checkpoint

Reader `w1.6` keeps full names in `records[id].name` beside the raw entry ID: **1,949/1,958 entry occurrences**, **437/446 distinct records**, with nine unresolved records kept as IDs. A private declaration index hashes the installed REDmod `.tweak` package and record names through the Studio's `tweakDbId()`. The map is retained only for identical source stamps; adding, changing or removing a source invalidates both it and the assembled file. Compiled flats reuse `clothing-host.ts`'s `tweakDbOf()` owner; there is no second TweakDB locator. Its stamp-only `tweakDbSourceOf()` answers identity before the assembled-cache check, and `tweakDbOf()` loads only on a miss. The shared owner refuses files above 96 MiB with a typed budget error (measured largest installed blob: 48,192,743 bytes). REDmod discovery streams entries and bounds all entries/directories, not just accepted `.tweak` files: 20,000 entries, 4,000 directory visits and depth 32; all opened handles close on refusal.

**238/268 pin titles resolve**: 235 from a containing/linked journal quest's localized title, three from `Mappins.<journal id>.localizedName` with the game's ripperdoc prefix. The selected English base/expansion onscreens tables contain those keys; `TextTable` supplies the existing primary/secondary-key semantics. Race and vehicle/apartment purchase-offer routes follow the scripts and are covered synthetically, but do not occur among retained Kabuki pins. Thirty pins lack a verified offline display key; notably, a fixer's live character-record getter is not the compiled pin's content-assignment record. See [the source routes and evidence grades](../../knowledge/world-and-streaming.md#142-offline-record-names-and-poi-display-titles).

The CLI rebuild retains **663 communities, 7,534 spots, 166 spawners and 268 pins**, with previous coverage unchanged except the intentionally improved `poi.title` channel. A sector-cache-assisted rebuild took **3,272 ms, 1.0 GiB peak**; an assembled cache hit in a fresh process took **397 ms**. The first source read on this shared machine took 26,869 ms; the OS disk cache was not controlled, so these observations are not cold-cache or improvement claims. The added source scan is a remaining offline preparation cost; no view performs it.

Community cards count distinct Character records as types of people and vehicle entries separately. They prefer localized Character display names, otherwise cleaned record tails (only a prefix from the verified district/content table, body-code suffixes and word-ending digits removed; personal/role prefixes and the last word are retained), preserve acronym spelling from affiliation texts, and show at most four distinct people labels then a remaining count. Unknown kinds get a plain count; Technical retains raw IDs, full names and affiliation records. A shared resolved person affiliation titles both the card and map label; mixed/unknown groups remain Community. The map count is visible linked spots, while the card count includes all stored unique spot links. POI cards show the title or kind; map labels keep the kind. `capture-w1-layers.ts --names` starts/closes its own headless browser and writes eight private light/dark captures at 300/850 px beside component patterns. No game session was run. Independent code/UI review remains with the dispatching chat.

Affiliation enrichment uses compiled record types and `Character.affiliation → Affiliation.localizedName`, never character-name parsing. Of 1,958 entries, **1,843 are people, 106 vehicles and nine unknown**. Affiliation IDs and English names resolve for **all 1,843 people entries (384 distinct Character records)**; **578/663 communities** get a shared affiliation label. The other 85 are mixed, unknown, unlabelled or vehicle-only. Vehicles do not prevent a shared person affiliation. Localized person names are available for 481 entry occurrences; the rest use cleaned tails. See [population and affiliations](../../knowledge/population-and-affiliations.md#offline-holotable-affiliation-resolution). Reader `w1.6` invalidates older files; the records/index checkpoint below supersedes the earlier reader timing. Spatial collection counts and POI titles are unchanged. `--affiliations` refreshes the four community cards plus `affiliation-overview.png` in the same private evidence folder, retaining the approved POI captures.

## Records and slice catalogue (w1.6)

The CLI atomically updates `local/holotable/world/index.json` after a successful build **or assembled-cache hit**. `bun tools/build-world-content.ts --list [--out directory]` prints it without archive reads or a game/pack configuration. The catalogue is bounded to 1 MiB and 1,000 slices; files are same-directory `<id>.content.json` names. One publication owner prepares content outside the directory lease, then holds the exclusive lock across file-hash revalidation, catalogue reconciliation, staging and **both** slice-file/index replacements. It rereads the catalogue inside the lock and prunes missing files. A SHA-256 comparison detects a file replaced since preparation, including same-size replacements. A valid newer publication wins: the caller returns its content and preserves its matching source, counts, byte size, build time and bounds instead of applying older metadata. Cache hits are revalidated too; a disappeared/corrupt cache hit refuses rather than resurrecting stale data. Both outputs are validated/staged before replacement. Each rename is atomic; the two-file sequence is protected from competing publishers, not a crash-atomic filesystem transaction. The shared lock has a five-second acquisition deadline and reclaims abandoned dead-owner locks after 30 seconds. A changed catalogue source fingerprint invalidates its other slices until rebuilt; legacy indexes without it are refreshed. `--list` excludes deleted files from `slices` and reports them in `missing` with a reason. Holotable discovers prepared slices from the catalogue and loads them on demand.

```text
{
  schema: "xfh/world-index-1",
  source: { game, archives, reader, fingerprint },
  slices: [{ id, title, places, bounds: { min: [x,y,z], max: [x,y,z] },
             file, counts: { communities, spots, spawners, pois, records }, bytes, built }]
}
```

Bounds enclose the slice's district root polygons/Z bands, in world metres. Collection counts are emitted array lengths; `counts.records` is the **distinct records-table size**, not population. `bytes` is the minified content file's UTF-8 size. Explicit counts replace the ambiguous single index `records` count by agreement with the dispatching coordinator. `source.fingerprint` covers every non-slice cache input: ordered vanilla archives (including localisation resources), English localisation paths, compiled TweakDB and REDmod declaration stamps, world pack, reader/native/sector versions and policy. The slice cache key adds only the slice id to that shared fingerprint. `counts.records` uses the shared nested-record budget (100,000), independently of the 50,000 spatial-row cap; a synthetic 50,001-row table publishes successfully. The content file retains its complete cache key. Catalogue `bytes` reuses the actual file size returned by the cache reader/writer, without serialising the content again. Newly built content also stores this shared `source.fingerprint`, so a superseded caller can identify the winning provenance. Publication revision 2 participates in the cache key and regenerates older assembled files; the public reader remains w1.6. If a newer file lacks a matching catalogue and comes from different inputs, publication refuses pending a retry with current inputs rather than inventing its bounds.

| ContentRecord field | Verified source / meaning | Kabuki distinct records |
|---|---|---:|
| `name?` | Full REDmod declaration name, through `tweakDbId()` | 494/504 |
| `kind` | Actual compiled Character/Vehicle type hashes, otherwise `other` | 395 person; 99 vehicle; ten other |
| `displayName?` | Character `.fullDisplayName`, then `.displayName`, through English onscreens | 143/504 (143/395 people) |
| `affiliation?` | Character `.affiliation`, raw decimal TweakDBID | 395/504 |
| `affiliationName?` | Full declaration name of that affiliation, for Technical | 395/504 |
| `affiliationTitle?` | Affiliation `.localizedName`, through English onscreens | 395/504 |
| `role?` | Character `.archetypeName` CName, verbatim: humanoid, mech or drone here | 395/504 |
| `crowd?` | Character `.isCrowd` Bool, explicitly converted from stored 0/1 | 395/504; 120 true, 275 false |
| `gender?` | No verified scalar gender; `.genders` lists entity alternatives and all 395 stored arrays here are empty | 0/504 |
| Spot `capacity?`, `posture?` | No verified whole-spot fields; no inference from tags, animations, sync slots or entry counts | Both absent for all 7,534 spots |

Every community/spawner reference gets a table row, including ten unsupported/unresolved records. Field channels count each **distinct id**, not entry occurrences. `record.kind` reports 494 verified kinds and ten unverified `other` fallbacks. Missing optional fields are omitted and reasons counted; the 109 non-Character rows have no Character metadata. `records` counts 504 kept rows. `spot.capacity` and `spot.posture` each count 7,534 omissions with reason `not stored in workspot data`. The category finding and its limits are in [world knowledge](../../knowledge/world-and-streaming.md#141-w1-world-content-field-mapping); record evidence is in [population knowledge](../../knowledge/population-and-affiliations.md#offline-holotable-affiliation-resolution).

Entries retain their **entry name** (registry/phase identity), record id and phases. Duplicated record names, kinds, display names and affiliations are removed. The community-level shared-affiliation summary remains for consumers; Holotable cards/map labels read names and affiliation titles from `records`. View-context unions retain active responses' table rows. No appearance data is exported. `role` is a coarse archetype name, **not combat role**; `crowd` is a record flag, not proof of spawn origin/current activation.

Names still resolve for 1,949/1,958 entry occurrences. All 663 community cards and every drawing item compare identically with w1.5 after moving metadata into the table; existing private light/dark captures stay unchanged. Synthetic tests cover community/spawner references, typed metadata/fallbacks, true/false crowd flags, index build/update/list, malformed tables/references, cache/version invalidation, service/view-context table propagation and refusing capacity/posture guesses with clues present and absent. There is no positive capacity/posture adapter fixture because no whole-spot field was verified.

Preceding review verification, 28 October 2026, before the same-slice publication hardening (Bun 1.4.4, shared machine, OS caches not flushed): fresh assembled **and sector** caches **10,990 ms / 1.1 GiB peak**; unchanged-file hit **81 ms**, meeting the under-100-ms target. Warm guard peak is below its 0.1 GiB reporting precision. Earlier w1.6 hits were about 440–474 ms. That checkpoint preserved the payload/coverage and measured **2,800,195 bytes** (w1.5: 3,013,233); newly published files now additionally carry the shared source fingerprint. This follow-up round uses synthetic regressions and does not claim a fresh real-build timing or byte-size measurement. These single shared-machine samples are not a statistical benchmark. Cold decoding remains the standing load-time target.

Windows x64 source discovery now enumerates directory metadata once per CLI process: **2,684 tweak files / 554 directories / 3,236 entries**, with **zero per-file stat calls**. `FindFirstFileW`/`FindNextFileW` provide each file's size and write time alongside its name. A portable streaming scan with file stats is the fallback if native enumeration is unavailable; access/enumeration failures refuse rather than silently dropping sources. The inspected REDmod `metadata.json` contains type declarations, not a source-file manifest; no manifest exists under the enumerated tweak roots. Root-directory mtimes/counts alone miss in-place edits (synthetic regression), so they are not accepted as an unambiguous identity. The metadata fingerprint retains per-file write times without a separate stat call for each file. A rebuild rechecks captured file/directory stamps before publication without a second discovery traversal, and **re-evaluates `tweakDbSourceOf(root, ep1)`** to compare the selected path and stamps, including an originally absent blob. A newly appearing preferred `tweakdb_ep1.bin` therefore refuses publication even if the fallback base file is unchanged. The check also runs inside the publication lease before replacing rebuilt content; a cache hit avoids that redundant rebuild-only check. Source-fingerprint construction also runs only once per build. Fixtures compare native metadata with portable stat results and verify changes/additions/removals, scan count and reused bytes. Follow-up regressions exercise two same-slice publishers in separate processes, a superseded cache hit, deletion/refusal before publication, and preferred/previously absent TweakDB transitions.

Prepared content has a **256 MiB total estimated parsed-size cache budget**, shared across slices. The conservative reservation is `32 * fileBytes + 64 KiB` per slice, checked for the entire requested view before any parse; a changed-size read refuses. Unclaimed slices evict least recently used first. Each consumer's latest successful region claims its slices for the existing renewable demand lease; release/expiry withdraws claims. If a view alone exceeds the budget, or other consumers' claims prevent admission, the request refuses with an explicit budget reason and no partial response. The existing final-demand idle eviction still applies. Synthetic multi-slice tests verify reservation, LRU identity, pinned-consumer refusal, release and expiry. This is an allocation estimate, not a measured heap/RSS guarantee. Full coverage, source audit and final receipts stay private at `local/holotable/evidence/w1-records/review/`.

## What each side does with it

**Story Engine.** It reads the file directly, as the ground truth for where its simulated residents can be: which communities exist, when they're out, which spots they use and what they do there, and which places offer which services. Nothing passes through Holotable's service.

**Holotable.** Three base layers in Show, off by default below Solid shapes:
- **Places of interest:** glyph plates through one kind-to-Places table (`view/base-layers.ts`), with Place as the raw-variant fallback. They join clusters, the Places legend, selection and inspector cards.
- **Gathering spots:** muted 3 px dots, never labelled, plated, clustered or fanned out; overlapping dots retain their density. A cooperative nearest-selection heap admits at most 2,000 visible spots per frame, nearest the view centre first. The legend lists them as Gathering spots, after Places; communities have no legend row. Cards show comma-separated readable workspot tags, or “No activity recorded”, and community chips; workspot path, yaw and id stay under Technical.
- **Communities:** no outlines are inferred. Each label is the centroid of its linked spots in view and reads “Community · N spots”; overview opacity ramps from zero at 100 m through half at 150 m to full at 200 m. Community size order (unique source spot links, then ID) is cached per content response, with cooperative preparation. Labels share ordinary collision culling against text and plates in that order, stopping at 12 placed or 64 candidate attempts; label layout resumes under the existing frame deadline; one linked spot reads “Community · 1 spot”. Show counts every community with a linked spot in view even when its label is faded or culled. Cards show entry summaries and phase names under When. Short codes (three characters or fewer) and non-word names become “N time phases”, with raw names under Technical. Only linked spots that resolve in the current response become chips, at most 12, using the first tag in plain words (“Spot · sit bar”), else an ordered “Spot · N”. Extra resolvable spots retain “+N more”; unresolved links are counted separately in the plain, non-interactive “N more further away” line.

Community `record` remains a numeric TweakDBID. The shared `records[record]` table supplies names and affiliations for the readable summary; raw IDs and full names appear only under Technical. Missing names produce an unnamed-type count. Names are display labels, not evidence of live spawned characters.

The service looks up prepared slices through the reader's shared slice table when their world-pack places overlap the requested region. Existing per-view world-context leases include `content:true` only while a base layer is enabled. The file owner validates and caches by size/mtime/ctime. Explicit `world.content.demand` consumer acquire/release follows active view leases and enabled base layers. Consumer leases renew on the existing five-second `live.status` poll only while content is wanted, and on content region reads. Ten seconds without renewal expires the consumer, so a dropped release or abandoned page cannot retain the cache indefinitely. The final release or expiry starts a 30-second idle eviction, canceled by a reacquire. Any healthy remaining consumer retains the cache. A single shared expiry timer serves the file owner; no per-view renewal timers are added. Content region reads carry the same consumer identity so a restarted service reacquires demand; region responses contain only nearby spots/pins and their linked communities. Hiding/releasing views drops unshared region records. Missing files are ordinary: all three rows say “Not built yet”, with the hint “World content for this district hasn't been prepared”. No CLI command appears in the UI, and no view triggers a build. The bound view supplies its own counts/availability through the same binding as Focus. Counts retain the last completed frame during a budgeted redraw, including selection changes; an explicit scene clear resets them.

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

## Periods and registry identities (w1.7)

Verified offline on 28 October 2026 against effective vanilla game 2.31 with Phantom Liberty, using `readStreamingSectorContent`. Native receipts and full coverage live privately at `local/holotable/evidence/w1-periods/field-audit.json`; only asset-free findings belong here. All sector paths below are relative to `base\worlds\03_night_city\_compiled\default\`.

| Native resource | SHA-256 of decoded resource bytes | Verified fields |
|---|---|---|
| `exterior_-7_5_0_1.streamingsector` | `8c0e0ea478d0f39a617f2dd01992181e5cdd8ca663d6ef1266fc98f1eb44210a` | Raw compiled period labels and spot sets; `4:00 AM` differs from registry `hour = 4:00`, so no label translation is assumed. |
| `always_loaded_1.streamingsector` | `48997b5e57f019c979afce29aaeac147809f1c9f8c88c9b305f58ef1db02d824` | Registry node index 3256, placement ref `4713704252415006921`; instance hashes; template entry/phase/hour/quantity rows. Node 5582’s `drone`/`drone2` entries verify explicit quantity zero. |
| `always_loaded_2.streamingsector` | `01b3ce10b4a2e7cec957304b37c39a3c6134dda8bd818dc617b82924c3e6f3c6` | Node 0’s instance `1169663043168625753`, `Homeless` / `default` / `Day` joins to the first sector’s registry and explicit quantity 2; neighbouring entries omit quantity. |

Cross-check [source]: WolvenKit commit `11720772f1e20581301b3dec88a59f7b5ee05675`, `WolvenKit.RED4/Types/Classes/{communityPhaseTimePeriod,communityTimePeriod,communitySpawnEntry,communitySpawnPhase,communityCommunityEntryPhaseTimePeriodData,worldCommunityRegistryNode,worldCommunityRegistryItem,gameCommunityID}.cs`. `quantity` is UInt16 on the registry period, not on compiled bindings or the spawn entry. `communityTimePeriod`’s constructor sets omitted `hour` to `Day`. The quantity constructor default is deliberately **not** exported: only explicitly stored quantities are retained. An unstored quantity is not proof of zero or one. Equal raw labels join; clock aliases and custom labels stay raw (including `_22_00` if stored). Missing/ambiguous matches omit quantity. Registry-only periods without a compiled spot-period row are not synthesized into the output.

No condition field is verified in these period/phase classes or the inspected native rows, and no separate entry cap is verified in `communitySpawnEntry`. `condition` and an entry cap therefore remain absent, counted with reasons. A phase name mentioning a quest or alarm does not establish a condition; absence does not establish unconditional spawning. Zero quantities with spot bindings describe potential data, not occupancy.

| Field/channel | Read | Kept | Omitted | Reason |
|---|---:|---:|---:|---|
| `community.periods` (name + spot set) | 2,852 | 2,852 | 0 | Raw names retained under 2,673 phases |
| `community.period.quantity` | 2,852 | 432 | 2,420 | Explicit quantity unavailable under the verified join: 2,419; ambiguous registry period: 1 |
| `community.period.condition` | 2,852 | 0 | 2,852 | Period condition not verified |
| `community.registry` (both ids) | 663 | 663 | 0 | Registry node placement and community-instance join |
| `community.entry.quantity` (separate cap) | 1,958 | 0 | 1,958 | Separate entry quantity cap not verified |
| `community.period.spotLinks` | 6,342 | 5,809 | 533 | Spot outside slice, inactive or unavailable |

Quantities include **99 zeros** and **333 positive values** (2–25). Per-period links count repeated membership across periods; the unchanged phase union is still 4,932 kept / 533 omitted. Existing collection/record/name coverage is unchanged. No simultaneous occupancy, interval end, activation or game test is claimed.

The shared sector transport remains slice-independent. Adding all registry schedules would exceed the existing 100,000 nested-record cap: `always_loaded_1` alone has 91,338 registry periods. On an assembled-cache miss, a second native registry read selects admitted source ids before expanding schedule metadata; shared template objects expand once, with each retained copy budgeted. Quantities are accepted only from the same active registry placement that owns the instance join. Duplicate source-object instance rows must each resolve the same explicit quantity; disagreement, an omitted value/entry, incomplete enrichment or different registry owners omit/count `ambiguous registry instance quantity`. Duplicate phase names are retained as metadata even when a phase has an empty or absent period array, and omit/count `ambiguous registry phase` for every affected period. Duplicate entry/period identities also refuse the optional quantity. This review hardening is reader `w1.7.1`, which invalidates the earlier assembled files; sector codec 103 is unchanged. All retained period records, duplicated serialized placements, phase/period links and registry metadata consume the existing nested/link/byte budgets; none is raised. Worker ownership and bounded shutdown stay unchanged. This second native pass is a remaining cold-load cost to optimize.

Initial w1.7 guarded build: **7,880 ms cold / 1.5 GiB peak**, with neither assembled content nor sector cache in a fresh output directory; **73 ms cached** in a fresh process (below the guard’s 0.1 GiB reporting precision). The OS cache was not flushed, installed record-name/OS caches may be warm, and these are individual shared-machine measurements. Output JSON: **3,096,340 bytes**. Cached coverage equals cold coverage. CLI timings exclude process startup and guard polling. The cache hit remains below the 100-ms research target; the cold build still takes seconds.

Review rebuild (w1.7.1): **4,138 ms / 1.3 GiB peak**, using the existing sector cache, then **75 ms cached** in a fresh process. Every coverage channel/reason and every published quantity equals the prior w1.7 file: 432/2,852 quantities remain, with 2,419 unavailable and one ambiguous period. The two newly covered ambiguous cases do not alter this Kabuki output. JSON is **3,096,342 bytes**, two more solely from the reader-version text. These are single shared-machine observations, not a new cold-cache comparison.

Synthetic tests cover raw labels, quantities including zero, conditions/cap omissions, absent and partial registry ids, identity ambiguity, unrelated/inactive registry refusal, shared expansion, nested/link/byte limits and w1.6/v102 invalidation. Regression fixtures additionally exercise duplicate source rows in either order, explicit agreement including zero, omitted/disagreeing values, split enrichment calls, incomplete enrichment, empty duplicate phases, metadata cache validation and w1.7 invalidation. No view files or card layout changed. Final check results and clean-up receipts are in the private handoff; independent review belongs to the dispatching chat.
