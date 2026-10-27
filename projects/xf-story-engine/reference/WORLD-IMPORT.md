# S1 world import v0.1

Offline additional Kabuki index, verified 28 October 2026 against W1 reader
**w1.7.1**. Integer-millimetre geometry, the stand-in fixture, FX-3, frozen
transcripts/digests and M3 archives are unchanged. No game or bridge command was
run. Independent review and the full suite belong to the coordinator.

## Use

From this directory:

```powershell
bun tools/world/import-w1.ts <world-pack.json> <content.json> <private-output-directory>/kabuki.index.json
```

The tool writes `kabuki.import.json` beside the index (`--report <file>` overrides
the location). Canonical private output is `local/story-engine/world/`; this
checkpoint leaves its candidate and evidence in untracked `.scratch-w1b/` for the
coordinator. Never stage scratch. The pure importer performs no file reads; the
tool refuses input/output collisions. Pass the parsed index through `WorldOpts.index`.
The observer publishes real polygons/volumes for imported indexes.

Same inputs produce identical index/report bytes, with stable key order and no
timestamp. Content/pack hashes and the index hash pin the lineage. Changed input
means a new lineage. Grid keys stay origin-anchored; inserting an earlier cell
can shift the venue-first ordinal member ids.

## Periods: declared derived assumptions

[The data table](src/world/periods.json) maps named periods to starts, and valid
`_HH_MM` and `H:MM AM` / `H:MM PM` labels to their clock times. `Noon` is
12:00; `Midnight` is 00:00. Twelve-hour clocks map 12:xx AM to 00:xx and
12:xx PM to 12:xx. Other names remain unknown and run all day.
These starts and inferred spans need an in-game check; W1 does not verify ends.

| Raw Kabuki label | Count | Start | Rule |
|---|---:|---|---|
| `10:00 AM` | 3 | 10:00 | clock-12h |
| `1:00 AM` | 2 | 01:00 | clock-12h |
| `1:00 PM` | 1 | 13:00 | clock-12h |
| `6:00 AM` | 69 | 06:00 | clock-12h |
| `6:00 PM` | 128 | 18:00 | clock-12h |
| `Day` | 2,048 | 12:00 | named |
| `Evening` | 233 | 18:00 | named |
| `Morning` | 201 | 06:00 | named |
| `Night` | 162 | 22:00 | named |
| `Noon` | 5 | 12:00 | named |

All **2,852** raw periods are counted. **zero** have unknown names. The 203
12-hour-clock rows and five `Noon` rows now map explicitly. `Midnight` maps to 00:00 and `_22_00` to 22:00, but neither occurs in this
Kabuki file. Quantity is stated on **432** periods (**99 explicit zero**, 333
positive) and absent on **2,420**. Absence means an unexported class default:
the importer treats it as **one unit**, not as a verified game default.

Within a phase, sort distinct known starts; each runs to the next, wrapping
midnight. Duplicate starts share the whole span. Unknowns run all day without
splitting known spans; one known start also runs all day. The report retains
each phase identity/ordinal, its mode and a separate `allDay` flag. Modes:
**zero all-day** (empty/absent or all-unknown), **2,504 single-period**, **169
multi-period**; **2,504** phases have only 24-hour spans. Single-period
phases still run all day, as required by the brief.

Every person-entry period/spot link contributes `quantity × overlap hours / 6`
to S1 windows starting **06:00 / 12:00 / 18:00 / 00:00**, in that order. Explicit
zero contributes nothing. One global normalisation makes the district mean over
the four windows **3,135** (observed 3,134.9999999999986, floating-point residue).
This target is derived before replacing the stand-in cells: its district `pop`
totals are **2,820 / 3,240 / 3,900 / 2,580**, whose mean is **3,135**.
It is independent of the **2,964 residential census**. The report records the
source totals, target and realised mean separately from residential headcount.
Alternative phases sum as potential content; no activation or occupancy is
claimed. Presence has no per-period S1 slot: one quantity/duration-weighted
affiliation share is integrated over all spans. Vehicles/other/unresolved
affiliations do not contribute. Empty-weight presence uses census shares.

Implementation choices: legacy phases lacking periods use distinct all-day
entry/spot links, preserving v0. Blocks with no eligible person links receive
the v0 floor (1% of mean block weight, or a mean of one if all empty), all day.
Explicit-zero links do not trigger this floor. Six real blocks receive it.
If every block has zero schedule weight and none qualifies for the floor, import
refuses because normalisation cannot preserve both zero and the stand-in pop scale.
Nonempty period arrays must agree with the retained phase spot union.

## Real cells and population

**28 cells:** 25 clipped origin-anchored 200 m blocks and three venues retaining
seven polygon/Z volumes. Geometry and residential shares compare exactly with
the v0 importer on the same inputs. Retained block area is **485,616.813989 m²**,
quantised district area **485,616.587650 m²**, difference **+0.226339 m²** from
rounded clip intersections. Venue XY footprint union: **4,228.52 m²**. Residential
area allocation still targets 2,964; unchanged rounding gives **2,963** (−1), zero
in venues. Census, marginals, rho and household draws are unchanged.

Pop is a normalised model weight, not observed simultaneous occupancy.

| Cell (grid key) | Area m² | Residents | Spots | Services | 06:00 | 12:00 | 18:00 | 00:00 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Judy's Apartment | 269.310 | 0 | 45 | 1 | 0.000 | 0.000 | 0.000 | 0.000 |
| Lizzie's Bar | 1701.590 | 0 | 433 | 1 | 340.874 | 340.874 | 339.173 | 339.173 |
| No-Tell Motel | 2257.618 | 0 | 28 | 0 | 7.775 | 4.616 | 5.669 | 7.775 |
| block 4 (-7,4) | 2192.870 | 13 | 16 | 0 | 44.219 | 44.219 | 42.761 | 42.761 |
| block 5 (-7,5) | 14362.700 | 88 | 230 | 0 | 222.552 | 221.823 | 192.263 | 192.425 |
| block 6 (-7,6) | 12082.300 | 74 | 136 | 0 | 30.370 | 28.750 | 29.722 | 30.856 |
| block 7 (-7,7) | 9801.700 | 60 | 157 | 0 | 28.912 | 28.912 | 29.236 | 29.884 |
| block 8 (-7,8) | 7521.100 | 46 | 59 | 0 | 38.388 | 36.444 | 35.148 | 37.416 |
| block 9 (-7,9) | 14980.805 | 91 | 351 | 2 | 100.100 | 107.632 | 105.121 | 100.100 |
| block 10 (-7,10) | 16549.084 | 101 | 305 | 2 | 84.550 | 91.839 | 86.980 | 71.430 |
| block 11 (-6,4) | 7935.177 | 48 | 0 | 0 | 1.113 | 1.113 | 1.113 | 1.113 |
| block 12 (-6,5) | 38464.569 | 235 | 318 | 0 | 103.015 | 105.688 | 132.009 | 133.143 |
| block 13 (-6,6) | 40000.000 | 244 | 748 | 1 | 235.672 | 234.214 | 234.538 | 232.757 |
| block 14 (-6,7) | 40000.000 | 244 | 1195 | 4 | 461.140 | 484.950 | 476.851 | 464.055 |
| block 15 (-6,8) | 40000.000 | 244 | 1319 | 1 | 651.378 | 636.557 | 637.448 | 665.956 |
| block 16 (-6,9) | 40000.000 | 244 | 647 | 0 | 193.640 | 195.341 | 206.517 | 207.974 |
| block 17 (-6,10) | 37111.990 | 227 | 694 | 3 | 207.974 | 240.531 | 205.707 | 159.868 |
| block 18 (-6,11) | 235.714 | 1 | 0 | 0 | 1.113 | 1.113 | 1.113 | 1.113 |
| block 19 (-5,5) | 1751.162 | 11 | 0 | 0 | 1.113 | 1.113 | 1.113 | 1.113 |
| block 20 (-5,6) | 8701.298 | 53 | 12 | 0 | 2.187 | 2.187 | 2.187 | 2.187 |
| block 21 (-5,7) | 20921.841 | 128 | 33 | 0 | 3.158 | 3.158 | 3.158 | 3.158 |
| block 22 (-5,8) | 39997.285 | 244 | 481 | 2 | 144.805 | 161.812 | 196.555 | 180.520 |
| block 23 (-5,9) | 39682.786 | 242 | 185 | 0 | 62.927 | 82.364 | 78.800 | 61.955 |
| block 24 (-5,10) | 35911.668 | 219 | 104 | 0 | 118.565 | 116.135 | 116.945 | 118.565 |
| block 25 (-5,11) | 4655.815 | 28 | 3 | 0 | 1.113 | 1.113 | 1.113 | 1.113 |
| block 26 (-4,8) | 8473.879 | 52 | 2 | 0 | 1.113 | 1.113 | 1.113 | 1.113 |
| block 27 (-4,9) | 3979.021 | 24 | 33 | 0 | 6.074 | 6.074 | 6.074 | 6.074 |
| block 28 (-4,10) | 304.049 | 2 | 0 | 0 | 1.113 | 1.113 | 1.113 | 1.113 |

The five busiest blocks by mean pop are **15, 14, 13, 5 and 17**. Judy’s Apartment
has 45 spots but **zero binding/person links**. Its zero population is correct:
only blocks receive the empty-link floor; venues do not.

Lizzie’s Bar has **490 person-entry/spot links**. Previously, 286 clock-label
links (`6:00 AM` / `6:00 PM`) were unknown and therefore all day; its remaining
204 `Day` links also ran all day from single-period phases. That explains the
old flat result and was correct under the original table. With clock mapping,
**459 links remain all day** and **31 run in 12-hour spans** (06:00–18:00 or
18:00–06:00); no labels are unknown. It now varies slightly: 340.874 at 06:00 /
12:00, 339.173 at 18:00 / 00:00. This is correct under the amended brief.
Evidence: private `venue-audit.json` beside the candidate import; joins follow
binding tuple → owning entry → period spot set and span, not venue placement.

## Binding, evidence and unchanged priors

All **4,917 tuples** retain community placement id, entry name and spot id, now
also copying `registry: { id, sourceObjectId }` from the owning community. All
**663 communities** have registry metadata; IDs stay strings, including 64-bit
values. Legacy missing registry metadata is omitted. No runtime binding or
binding ordinal is added. **72** spots shared between two communities keep both
tuples; **15** repeated links across same-entry phases are deduplicated for binding.

- **7,534 spots**, all assigned to cells; **3,847** without entry links. **132**
  entries have no spots; zero missing references or out-of-cell pins.
- **1,843 person entries**, 106 vehicle and nine unknown entries. All person
  affiliations resolve. **4,779** distinct person-entry/spot links remain the
  unweighted coverage count; weighted schedule integration is a separate channel.
- **17 services**, zero dropped by the 15-per-cell cap; **247 coverage-evidence
  pins**, four other pins, zero unknown pin kinds. Evidence is never S1’s
  fractional coverage rate; calibration remains open.
- Fallback placement IDs: 663 communities, 48 spots, 268 pins. Registry identity
  is separate from those placement ids. **166 spawners** remain unused for population.

Geometry remains integer millimetres through clipping, containment, centres,
neighbours and service-distance sorting, with BigInt predicates and the 1 mm²
intersection gate. Only the final output projection converts to metres/m².
Neighbourhood is geometric; traversability is unknown. Services use the shared
kind table, nearest 15 and id tie-breaks. Venue hosts require genuine footprint
overlap. Census/age/role/income/household/tenure/wealth, trust and prices remain
stand-ins. Templates remain block g4 and venue v5; opportunity/security/pairs
are unchanged. Neither quantities nor affiliation counts replace the census.

## Verification and bytes

Name mapping, wraparound, duplicate starts, S1 overlap arithmetic, stated/absent/
zero weights, duration presence, all-zero cells, registry preservation, bounded
metadata and normalisation have focused tests. Existing geometry/service/binding
regressions and both byte goldens remain covered. The new synthetic period fixture
has its own byte golden; existing source fixtures are untouched.

The guarded targeted world/digest run passed **36 tests**, with three existing
profile-gated digest checks skipped, in **41.49 s / 0.6 GB peak**; `bun run check`
passed. This rerun checks the corrected stand-in population target separately
from residential census/headcount, plus the existing schedule and binding regressions. The private imported day covered 86,400 seconds /
144 windows, **145**
read-only observer samples, **132** records and **35** place items over 13 layers,
with zero truncations; the external Holotable validator reported no refusals.
Its run took **16.68 s**. Both frozen digests remain v3
`746601727380a3fdff647f873c91c971`, v4 `8fce55b19462a1e02f03ca5336bd8c16`.

All three byte goldens deliberately change **cell pop arrays and index hashes**
for the corrected normalisation target. Report bytes change in cell `pop`,
`indexHash`, the normalisation assumption and the population audit (stand-in
period totals, `popTarget`, `popMean`). All other index fields compare unchanged
against f49078d3, including geometry, headShare, presence, registry bindings,
services and source hashes. Stand-in source fixtures and frozen digests are
untouched. Local attributes preserve JSON bytes across Windows/Linux.

| Golden | UTF-8 bytes | SHA-256 |
|---|---:|---|
| [import.golden.json](test/world/fixtures/import.golden.json) | 57,459 | `5657c25419d9bc2763636d8c916f6ed3453689a8cff52a68f391616de3039067` |
| [fractional-import.golden.json](test/world/fixtures/fractional-import.golden.json) | 93,109 | `c169bacfffb73fe4c96db145bc15855617e5f45da8f146b1f283bb6cd13f43e2` |
| [period-import.golden.json](test/world/fixtures/period-import.golden.json) | 57,861 | `12b11b60238176678d1d46d869974e2b66d7d686419f3eab98b82bf96c8860ca` |

Two real CLI imports produced byte-identical index/report outputs in **283 ms**
and **200 ms**, peaking at **0.3 GB** under the 4 GB guard. Process startup is
excluded; shared-machine samples do not establish a performance trend. Import
preparation still exceeds the standing 100 ms target. No retained task output
exceeds 5 GB. The coordinator owns scratch cleanup.

Knowledge used: [Places](../../../knowledge/places.md),
[Population and affiliations](../../../knowledge/population-and-affiliations.md),
[World and streaming](../../../knowledge/world-and-streaming.md) §1.4.1, and
[W1 periods/registry](../../../research/live-world-view/w1-world-content.md#periods-and-registry-identities-w17).
Their downstream S1 notes now describe v0.1; the source findings are unchanged.
