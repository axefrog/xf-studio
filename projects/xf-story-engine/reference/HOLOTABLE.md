# Holotable layers, v0

The reference model can publish a diagnostic run to Holotable's append-only
`xfh/layer-1` / `xfh/item-1` JSON-lines spool. This is offline model evidence;
it neither runs the game nor deploys content. All layers use producer
`story-engine` and full content. The standalone fixture uses the game clock and
one timeline set. [Shadow mode](SHADOW.md) instead binds manifests to the source
recording's session/run and uses recording QPC time, through the same publisher.

From the reference directory, under the repository memory guard:

```powershell
bun tools/holotable/publish-run.ts <fresh-output-directory> --world-pack <world-pack.json> [--game-epoch-seconds <number>]
```

This runs the shared, assertion-checked SF3-60 Kabuki fixture with its scripted
opening and 1,002 subsequent ten-minute windows, ending at GameTime 604,800.
It uses the default fixture density (one tenth of the full population), real
layers 1–3 and the existing authored fixture pack. Like SF3-60, only the mirror
simulation process is scheduled; other groups, ties and retaliation data are
published when a host run actually contains them. Empty layers still get a
manifest. This is an M3-style diagnostic fixture, not a new M3 evaluation.
The world pack defaults to the repository's private `local/holotable/world-pack.json`;
pass `--world-pack` when it lives in another checkout. It is read only.

For an existing run, construct a
[HolotableObserver](src/holotable/observe.ts) and a
[RunPublisher](tools/holotable/publish-run.ts), then call `publishBoundary`
after each completed window. Observation does not install engine hooks. The
host owns stepping and supplies the timeline's extent in converted game seconds.
Optional explicit entity bindings come from the host.

The writer refuses a directory containing existing JSONL spools. It validates
every record, citation, the bound of 5,000 distinct item ids across each layer's
whole history and all branches, and the 16 MiB file bound before appending an
observation. Individual JSON lines are bounded to 1 MiB (including their newline),
and retractions always include a time. Replacements and retraction records do not
add to the distinct-id count; expiry and retraction do not free an id. It republishes
only changed item payloads; a replacement takes effect
at the observation time. Event records and director decisions remain historical;
other items retract when they leave the sampled state. The CLI/service's two
batches per wall-clock second does not constrain offline file creation. A disk
failure can interrupt an append; this is an offline spool, not an atomic multi-file
database. Use a new output directory to retry a failed run.

## Layer mapping

| Layer | Contents |
|---|---|
| places | District and cell region zones: heat band and tone, regime, faction shares, refuge |
| detail | Focused locality region zones and their open detail tier |
| people | Existing resident/person nodes, names and community roles; doing, goal, planning, thinking, affiliation, detail in that order |
| groups | Group actors on their district territory; seats, drives, intention, compliance, books |
| items | Previously or currently held item points, holder anchor, kind, current holder and last two ownership records |
| ties | Exact materialised engine tie kinds, membership, leadership, held items, outstanding debts/promises and strength |
| events | Existing recorded event points and caused relations to their parent events |
| beliefs | Believer-to-subject relations, claim and original subject (`about`); known contradictions use believes-wrongly |
| stories | Live pattern instances, juncture states, thread, outcome and bound-actor role relations |
| director | Recorded sow/gate decisions and delivery holds; candidate kind, pattern, gate, score, hold reason and delivery when recorded |
| intentions | Group-to-protagonist intentions: rung, warned, presented |
| placement | Live seed placement, phase, recorded rung or not staged, and kit (logical) from the selected fragment/template |

People split into district layers above 4,000 items. Previously emitted district
layers remain in later samples even when empty, so their actors are retracted.
A district still exceeding the consumer's bound of 5,000 distinct item ids is
refused. All item references are fully
qualified with producer/layer/id. Frames resolve belief subjects to their actor,
places to their zone, events to their point and props to the items layer. Unknown
endpoints and region outlines remain unplaced.
Citations use `se:<kind>:<id>` with the brief's event/node/edge/frame/belief/
seed/inst/sow/stage vocabulary. Facets have at most 16 entries, 40-character keys
and 500-character values. Long list/map captions keep a complete prefix and end
`… (+N more)`; scalar text uses the omitted character count. Their full values go
in `detail` where possible. Labels are bounded to 160 characters and detail to
4,000. Overflow detail ends `… (truncated; full record at <se: citation>)`;
the item remains published. Each shortened label/facet/detail counts once per
published revision in the run summary's per-layer `truncations` total. Invalid
structure is refused. This producer emits no path/polygon/field kinds; it refuses
those rather than admitting geometry outside its supported schema subset.

## Fixture placement

The v0 fixture placement rule is explicitly schematic. District keys `wat_kab`,
`wat_nor` and `wat_lch` map to the world pack's `Districts.Kabuki`,
`Districts.Northside` and `Districts.LittleChina`. Those region anchors use the
real district polygons. The adapter sorts synthetic cell ids and lays out a
square-ish grid of shallow boxes within each district's actual bounding box.
Cell and detail zones use these boxes as their own geometry. Cell fallbacks on
points, actors and targets reference `story-engine/places/<cell-id>` through an
item anchor, including people, events, stories, director and placement. The consumer places it from that cell
item, rather than treating the synthetic cell id as a world-pack region. This is
not a surveyed floor or street location.
The layer title/description and each cell or cell-placed item's `layout` facet
say **schematic layout**. Real, already-recorded positions and explicit entity
bindings take precedence. The adapter reads the local world pack at run time;
no polygon asset is copied into source. Replace this adapter when the fixture
uses real cells.

## Observation and time

Observation reads only existing headers, slot caches, minted event constants,
process feeds/digests/state, frames, memorable beliefs, instance states and layer-3
pool/log records. It never calls resolution, addressing, event restoration, people
generation or routine evaluation. A cached scalar is the last opened observation,
not a new resolution. Unopened names/routines/values say **not opened (coarse)**.
Each actor's detail facet shows its already-opened/focused tier, or coarse.
Events include record evidence, factual digest feeds, real buffered events and
already-opened event caches/constants. Synthetic Sifter state-change envelopes
are excluded. Opened summary items use their cached descriptors and the recorded
materialisation owner's constants, including fields owned by `scene.acts`.
The observer never regenerates a forgotten summary item.

Beliefs are marked **believes-wrongly** only when a differing record value is
available at the belief's stated time (the current time when absent). Raw readings
must cover that time and precede withdrawal; resolved subject caches must match
the time and current revision. Event facts and current frame status are additional
record sources. Missing or stale truth remains unknown, without opening a slot.
Materialised tie strength uses the same pure history-and-time calculation as the
tie policy, rather than the edge's initial strength attribute.

A missing `city.events` digest leaves heat **not opened (coarse)** and supplies no
heat tone. An omitted cell in a present sparse digest means band zero, **quiet**.
Director patterns fall back from the decision to its known pool entry; an absent
pattern, candidate kind or score says **not recorded**.
Missing recorded decisions say **not recorded**; physical scene staging is not
implemented by this offline writer. Captions retain all source data in the
inspector when shortening is needed.

Each item's first facet is its plain-language caption; bookkeeping follows it.
Places start with `heat` (band and recorded regimes), groups with `intent`
(recorded active intention or no active intention, or not recorded when the
record is missing), events with `what` (kind, outcome and recorded place name),
stories with `now`, and the director with `decision`. People keep `doing` first;
when the act/routine is unopened, a known role supplies a caption such as
"a merchant (not yet opened)". Missing roles and names stay explicit.
Story captions name the next ready function and its recorded actor, the last
matched juncture, or the recorded ending. Caption construction never opens a
name, place, role, function or intention. Full ids and exact states remain in
the following facets and citations.

Every item carries a semantic `glyph` from the Holotable v1 vocabulary, including
documented family fallbacks. People use known role glyphs (vendors/stallholders
use `merchant`) or `person`; groups use `group`. Events map recorded kinds,
including gang-clash to `clash`, psycho-break to `cyberpsychosis`, commerce to
`trade` and tell to `rumour`; unknown event kinds use `event`. Stories use
`story`; their installed pattern family belongs in the facet and label, and is
not recorded when absent. A story badge prefers `ready`, then `pending`, then
`matched`, and is omitted when none applies; all seven exact engine states stay
in the junctures facet. No badge is invented for an item without a recorded state.
Sows use `sown`, failed gates/refusals `refused`, delivery holds `held`, items
`item`, placement `scene`, detail `place`, and diagnostic relations `diagnostic`.
Places prefer a recorded `crackdown`/`festival`, then `refuge` when refuge is
recorded yes, else `place`.

Glyph/badge fields must be lowercase slugs of at most 32 characters. Unknown
vocabulary names remain intact and are accepted for the consumer's kind-marker
fallback. The per-layer `unknownGlyphs` summary counts unknown glyph and badge
names per published revision, with no extra count for a deduplicated repeat.
Hold targets include reason, gate and delivery. Clearing a hold writes an explicit
retraction at the recorded clear time, without retracting the sow decision.
An entire hold between samples is emitted with its exact start/end interval and
clear retraction; repeated sampling does not republish that closed interval.

GameTime is signed seconds since a lineage epoch. Published time is
`GameTime + gameEpochSeconds`; the default offset is the fixture's `sod0` (or 0).
This gives a synthetic Day 1 with the simulated time of day, not an asserted
absolute game date. An explicit offset overrides it. Standalone layers share
`{ set, title, from, to, clock: "game" }`, with a lowercase set slug of at most
64 characters and `to > from`. A run without a save/load has no branch;
after saving/loading, the kernel's current save identity supplies the default
branch. An explicit item branch wins over that default.
Manifests stay unbranched. Every branch-specific retraction carries its own save
identity, including removal of an inherited item from the pre-save prefix.
That removes it only on that branch; sibling branches keep their prefix.
An unbranched retraction from this writer is global, and clears branch-specific
deduplication entries so a later reappearance is published correctly.
A global replacement also invalidates earlier branch signatures and scoped
tombstones, so returning to a branch republishes its value when necessary.

## Verification

The seven-day diagnostic output regenerated after fidelity, glyph and caption review (27 October
2026, default fixture density)
contains the following distinct item ids over the whole run, including relation
items and items later retracted. Both the temporary reload test spool and the
week spool pass Holotable's independent `validate` command without refusals.
The regenerated week's truncation and unknown-glyph counts are zero in every layer. Its events layer
excludes two synthetic state placeholders that appeared in the initial output.

| Layer | Distinct items |
|---|---:|
| places | 25 |
| detail | 2 |
| people | 291 |
| groups | 4 |
| items | 0 |
| ties | 0 |
| events | 20 |
| beliefs | 1 |
| stories | 18 |
| director | 9 |
| intentions | 0 |
| placement | 1 |

Consumer read-back at the end places all 25 zones, all four groups and 290 of
291 people. It places 1 of 20 event items, 8 of 18 story items, and 5 of the 8
remaining director items. The ninth director item is a delivery hold, retracted
at its recorded clear time. Unplaced event/story/director points have no recorded
place; relation items inherit those missing endpoints or V's missing position.
Cell references themselves resolve correctly. The writer does not invent the
missing locations.

The empty ties/items/intentions layers reflect this fixture's actual scheduling
and materialisation. The producer does not add sample ties, props or retaliation
to make the diagnostics look fuller. Fixtures cover those mappings separately.

[The tests](test/holotable/holotable.test.ts) compare observer-on and observer-off
executions byte for byte, including saved records, every sampled digest, the
fixture's identity/draw transcript and final state, both uninterrupted and with
save/load. They also compare the raw store (headers and caches included) before
and after repeated samples, and replace resolution/recovery methods with throwing
sentinels. The paired executions disable the process-global population memo to
give both arms equal starting cache conditions. Persisted/transcript comparisons
use JSON bytes; immediate raw-state checks use V8 images, whose internal numeric
encoding need not be identical between independent executions.
The [review regressions](test/holotable/review.test.ts) cover scene-owned summary
events, synthetic envelopes, time-valid belief truth, recorded tie strength,
branch precedence and replacement, empty district retractions, missing digests,
director patterns and standalone validation. They also check engine snapshots
with resolution and recovery disabled during observation.
The [glyph regressions](test/holotable/glyphs.test.ts) cover vocabulary coverage,
family labels, badges, unknown-name accounting and exact-time hold retractions,
including a complete hold between two samples. The
[caption regressions](test/holotable/captions.test.ts) check first-facet ordering,
recorded names, explicit missing values, cell references and group intentions.

Schema/bounds tests use temporary directories below the worktree's scratch folder
and remove them on exit. An optional interoperability test runs Holotable's own
read-only validator from its checkout:

```powershell
$env:HOLO_VALIDATOR_ROOT = '<Holotable checkout>'
bun test test/holotable
Remove-Item Env:HOLO_VALIDATOR_ROOT
```

Validate the real output from the consumer checkout with:

```powershell
bun projects/xf-holotable/tools/holo.ts validate <absolute-spool-directory>
```

Knowledge used: [places](../../../knowledge/places.md) (region geometry must be
known, never inferred from a display name), [save identity](../../../knowledge/save-identity.md)
(save identity is not a filename/time guess), and the reference-model
[test-performance evidence](PERFORMANCE.md). This v0 adds offline producer
evidence only; it confirms no new Cyberpunk runtime behaviour.
