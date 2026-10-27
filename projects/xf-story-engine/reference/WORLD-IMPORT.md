# S1 world import v0

Additional offline Kabuki index, built 28 October 2026 from the player's private
world pack and W1 w1.6 content. Existing stand-ins, FX-3, transcripts, digests and
M3 archives are unchanged. No game or bridge command was run. Independent review
and the full suite belong to the coordinator before integration.

## Use

From this directory:

```powershell
bun tools/world/import-w1.ts <world-pack.json> <content.json> <private-output-directory>/kabuki.index.json
```

The tool writes `kabuki.import.json` beside the index (`--report <file>` overrides
that location). Canonical private output is `local/story-engine/world/` at the
repository root. Pass the parsed index through the existing optional world
`index` option. The observer automatically selects its real geometry; an explicit
schematic layout cannot replace imported geometry. The pure importer performs no
file reads and the file tool refuses input/output path collisions.

Same inputs produce identical index and report bytes (stable key order, no
timestamp). Input content hashes and the index hash pin the lineage. A changed
input creates a new lineage. Grid coordinates are stable keys; the mandated
venue-first ordinal IDs shift if a preceding cell is inserted. No existing
fixture identity changes.

## Real import summary

**28 cells:** 25 clipped origin-anchored 200 m blocks, three venues retaining all
seven polygon/Z volumes. Block area totals **485,616.59 m²**;
venue XY footprint unions total **4,228.52 m²**. The
reported union counts stacked/overlapping venue footprints once. Population
floor applies in six blocks. All 7,534 spots and 268 pins have a cell.

| Cell | Area m² | Residents¹ | Spots | Services | Presence top three |
|---|---:|---:|---:|---:|---|
| Judy's Apartment | 269.3 | 0 | 45 | 1 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |
| Lizzie's Bar | 1701.6 | 0 | 433 | 1 | civilian 74.1%, TheMox 22.2%, Arasaka 1.2% |
| No-Tell Motel | 2257.6 | 0 | 28 | 0 | civilian 100.0% |
| 4 (-7,4) | 2192.9 | 13 | 16 | 0 | civilian 100.0% |
| 5 (-7,5) | 14362.8 | 88 | 230 | 0 | civilian 94.4%, Scavengers 3.4%, ncpd 2.2% |
| 6 (-7,6) | 12082.2 | 74 | 136 | 0 | civilian 92.0%, TygerClaws 6.0%, Scavengers 2.0% |
| 7 (-7,7) | 9801.6 | 60 | 157 | 0 | civilian 77.2%, TheMox 22.8% |
| 8 (-7,8) | 7521.0 | 46 | 59 | 0 | civilian 83.0%, Militech 10.6%, TygerClaws 6.4% |
| 9 (-7,9) | 14980.8 | 91 | 351 | 2 | civilian 87.6%, TygerClaws 8.7%, TraumaTeam 2.1% |
| 10 (-7,10) | 16549.1 | 101 | 305 | 2 | civilian 89.5%, Animals 4.7%, ncpd 3.5% |
| 11 (-6,4) | 7935.2 | 48 | 0 | 0 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |
| 12 (-6,5) | 38464.6 | 235 | 318 | 0 | civilian 84.4%, Militech 5.4%, TygerClaws 4.8% |
| 13 (-6,6) | 40000.0 | 244 | 748 | 1 | civilian 68.8%, TygerClaws 23.2%, ncpd 5.9% |
| 14 (-6,7) | 40000.0 | 244 | 1195 | 4 | civilian 78.9%, TygerClaws 11.0%, Scavengers 3.7% |
| 15 (-6,8) | 40000.0 | 244 | 1319 | 1 | civilian 91.5%, TygerClaws 4.4%, Militech 1.9% |
| 16 (-6,9) | 40000.0 | 244 | 647 | 0 | civilian 71.8%, TygerClaws 23.8%, Scavengers 2.3% |
| 17 (-6,10) | 37112.0 | 227 | 694 | 3 | civilian 72.9%, Scavengers 14.6%, TygerClaws 5.8% |
| 18 (-6,11) | 235.7 | 1 | 0 | 0 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |
| 19 (-5,5) | 1751.2 | 11 | 0 | 0 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |
| 20 (-5,6) | 8701.3 | 53 | 12 | 0 | TygerClaws 100.0% |
| 21 (-5,7) | 20921.8 | 128 | 33 | 0 | civilian 53.8%, TygerClaws 38.5%, Militech 7.7% |
| 22 (-5,8) | 39997.3 | 244 | 481 | 2 | civilian 69.0%, TygerClaws 19.5%, Animals 7.3% |
| 23 (-5,9) | 39682.8 | 242 | 185 | 0 | civilian 60.2%, TygerClaws 25.4%, Animals 5.9% |
| 24 (-5,10) | 35911.6 | 219 | 104 | 0 | civilian 66.7%, Scavengers 26.7%, Maelstrom 6.7% |
| 25 (-5,11) | 4655.8 | 28 | 3 | 0 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |
| 26 (-4,8) | 8473.9 | 52 | 2 | 0 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |
| 27 (-4,9) | 3979.0 | 24 | 33 | 0 | Maelstrom 64.0%, civilian 20.0%, ncpd 12.0% |
| 28 (-4,10) | 304.0 | 2 | 0 | 0 | civilian 79.0%, TygerClaws 6.9%, Others 4.7% |

¹ Residents here means S1's rounded cell headcount, not a measured live count or
an enumeration of generated household members. Area allocation targets 2,964;
unchanged per-cell rounding yields **2,963** (delta −1), zero in venues.
Household counts and membership draws retain the existing recipe. Venue zero-link
presence uses the same explicit census-share fallback as other empty-link cells.

## W1 beside the census

| Affiliation | Census quantity | W1 person entries | W1 person/spot links |
|---|---:|---:|---:|
| AfterlifeMercs | — | 4 | 6 |
| Aldecaldos | — | 1 | 3 |
| Animals | 18 | 18 | 39 |
| Arasaka | — | 4 | 6 |
| Maelstrom | — | 24 | 45 |
| Militech | 41 | 43 | 50 |
| Others | 140 | 0 | 0 |
| Scavengers | 48 | 51 | 120 |
| SixthStreet | — | 5 | 6 |
| TheMox | 112 | 48 | 137 |
| TraumaTeam | — | 3 | 5 |
| TygerClaws | 205 | 211 | 467 |
| UnaffiliatedCorpo | — | 11 | 15 |
| Valentinos | — | 5 | 6 |
| civilian | 2341 | 1356 | 3774 |
| ncpd | 59 | 59 | 100 |

The census column remains the recipe input. W1 counts authored person entries,
without quantities, and is not substituted for it. Census `Others` is the
stand-in aggregate, not an unresolved W1 affiliation. Records total 504: 395
person, 99 vehicle, ten unsupported/unresolved. Entries total 1,958: 1,843 person,
106 vehicle and nine unknown. All person-entry affiliations resolve.

## Dropped, missing and unused

- **4,917 binding tuples** from 4,932 phase links; 15 same-entry phase repeats
  deduplicated. All 72 spots shared across two communities keep both tuples.
- **4,779 person-entry/spot links** feed presence; 138 vehicle/unknown links do
  not. The binding table retains non-person tuples for later binding decisions.
- **3,847 spots** have no community entry; **132 entries** have no spots.
  Missing spot references, out-of-cell spots/pins and unknown person affiliation
  links: **zero**.
- **17 services**, **zero** dropped by the 15-per-cell cap. **247 coverage pins**,
  four other pins, zero unknown pin kinds. Raw `QuestGiverVariant` (84) and
  `Zzz06_NCPDGigVariant` (two) are explicit evidence kinds, never services.
- Fallback IDs: **663 communities**, **48 spots**, **268 pins**. Registry IDs and
  ordinals are unavailable and absent from binding tuples.
- **166 spawners** remain unused for population to avoid inventing quantities or
  double counting entries. Workspot tags do not determine population magnitude.

## Assumptions and implementation choices

- **derived — geometry:** Origin-anchored 200 m clipped blocks; venues first by place id, then (gx, gy); all venue volumes/Z bands retained. Venue precedence, then cell order on closed boundaries. Venue area is the XY footprint union; stacked volumes count once.
- **derived — neighbours:** Grid edge neighbours, diagonal second neighbours, venue/retained-grid-bin XY overlap. Geometry only; traversability unknown. Venue host is the nearest overlapping block centre.
- **derived — headShare:** Clipped block area / district area; no subtraction of venue footprints. Venues have zero residents. S1 rounds headcounts per cell and draws households unchanged; realised household membership can differ.
- **derived — presence/pop:** One vote per distinct person-entry/spot link across phases, retaining cross-community tuples. Affiliation from records, civilian/Unaffiliated merged, NCPD normalized. Exclude vehicle/other/unresolved affiliation. Flat periods (06:00, 12:00, 18:00, 00:00): schedule unknown. Pop distributes the census scale over all cells by votes; empty blocks get 1% of mean block votes (mean 1 if all empty). Empty cells use census affiliation shares. No simultaneous occupancy claim.
- **derived — services:** One plain-kind table; nearest 15 in 3D to footprint-weighted cell centre, ties by POI id. Unknown kinds counted, never guessed. Evidence pins never become services.
- **derived — binding:** All linked entry types retained; exact (community id, entry name, spot id), deduplicated only across phases of the same entry. Registry ids and ordinals unavailable; no runtime binding. Fallback ids counted by colon format.
- **derived — coverage evidence:** Static counts by original POI kind only, separate from S1 fractional coverage. Calibration remains open.
- **stand-in — census/recipe:** 2964, rho, age, role, income, affiliation, household, tenure and wealth marginals, trust and price anchor unchanged. W1 entry counts compare authored types, not quantities.
- **stand-in — opportunity/security:** Copy public, marketCell, A, F, pairs and calibrated gameCoverage unchanged from existing grid/venue templates cyclically in each kindâ€™s cell order. Re-sum district staticTotalA; stub and rest totals unchanged. No claim of measured police/security, propensity, pair hostility or opportunity. S1Data defaults unchanged.
- **derived — future W1:** Quantities and period names await a versioned W1 revision. No census flag or schedule interpretation until that contract exists; records/spawners do not supply a census.

The POI-kind table is the only service classifier. Nearest-service distance is
3D to the area-weighted centre of a cell's volumes, with POI-ID ties. Overlapping
venues choose ascending place ID; closed grid-boundary ties use cell order.
Additional venue volumes are separate zone items linked by their cell citation;
each cell's primary item retains its ordinal ID. Venue names use explicit display
labels for the three known place IDs (the pack stores unresolved localization
keys); this does not alter geometric membership.

`gameCoverageEvidence` is a static count by raw POI kind. It never becomes S1's
fractional `gameCoverage`; calibration remains open in [SPEC-NOTES](SPEC-NOTES.md#s1-world-import-v0-28-october-2026).
Quantity/period-name handling and the optional W1 census await a versioned export
contract. There is no runtime body binding.

## Verification and responsiveness evidence

- `bun run check`: pass. Targeted importer, day, Holotable, shadow, public API,
  digests and S1/S3 transcript tests: **79 pass, four expected skips, zero fail**.
- The real imported world runs **86,400 seconds / 144 windows**, with **145
  observer samples**; every sample preserves a complete captured mutable-engine
  image. Its 12-layer spool has **35 place items** (28 cells, three districts,
  four additional venue volumes), **134 item records** across layers, zero text
  truncations, and passes the independent internals checker and Holotable
  consumer validator with no refusals. No fixtures or golden files were edited.
- Existing frozen digests: v3 `746601727380a3fdff647f873c91c971`, v4
  `8fce55b19462a1e02f03ca5336bd8c16`; both unchanged. The full suite is deferred
  to the coordinator as requested.
- One guarded CLI import took **213 ms** inside the CLI (file reads, validation,
  geometry/joins, hashing and writes; startup excluded). The final real day took
  **18.74 s**, including observation and spool validation,
  with a **1.5 GB** peak for the whole targeted test job. Earlier real-day sample:
  22.76 s. Shared-machine samples establish no speed trend. These are offline
  authoring/simulation measurements, not live rendering or game latency budgets.
- Private index, report and spools remain uncommitted under `local/` and ignored
  `.scratch-w1/`. The coordinator owns scratch cleanup. No retained output for
  this task exceeds 5 GB.

Knowledge used: [Places](../../../knowledge/places.md),
[Population and affiliations](../../../knowledge/population-and-affiliations.md),
[World and streaming](../../../knowledge/world-and-streaming.md), and
[W1 content](../../../research/live-world-view/w1-world-content.md).
No knowledge page was contradicted; the pages now distinguish the imported
observer from the unchanged default shadow host and record the downstream counts.
