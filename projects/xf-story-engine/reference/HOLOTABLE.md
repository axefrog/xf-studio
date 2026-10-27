# Holotable layers v1: readable world-map content

The Story Engine reference model publishes read-only observations to Holotable's
append-only `xfh/layer-1` / `xfh/item-1` JSON-lines spools. All layers use producer
`story-engine` and full content. This is offline model evidence: it never runs the
game, deploys content, opens a resident, resolves a slot or evaluates an engine draw.

The shared, pure [wording renderer](src/wording/index.ts) reads copied record views.
Its [wording data](src/wording/wording.json) contains the coordinator's 27 function
mood tables and 29 pattern titles, event sentences, community and participant role
words, group names, intention phrases and noun overrides. The composite library is
read only. M3's thread renderer is a future second consumer.

## Publish the fixture

From this directory, under the repository memory guard:

```powershell
bun tools/holotable/publish-run.ts <fresh-output-directory> --world-pack <world-pack.json> [--game-epoch-seconds <number>] [--no-holotable-hooks]
```

The default world pack is the repository's private `local/holotable/world-pack.json`.
It is read only. Output must be a fresh directory; existing spools are refused.
This CLI uses the SF3-60 scripted Kabuki fixture: the opening, followed by
1,002 ten-minute windows, with the nominal seven-day timeline. Its action remains
concentrated in the opening. It remains a test fixture; use the real-week CLI below
for the full simulation.

For an existing host run, construct a [HolotableObserver](src/holotable/observe.ts)
and a [RunPublisher](tools/holotable/publish-run.ts), and call `publishBoundary` after
each completed boundary. The host supplies the timeline extent and any explicit
entity bindings. [Shadow mode](SHADOW.md) uses the same observer and wording with
recording-clock bindings; it issues no game writes.

## Real week

From this directory, under the repository memory guard:

```powershell
bun tools/holotable/publish-m3-week.ts <fresh-out-dir> [--run <run-id>] [--world-pack <world-pack.json>] [--no-holotable-hooks]
```

The default is `E-m3c-w2-restless-engage`: the reviewed M3 run-3 engine arm,
the busiest Kabuki world, and a simulated player who accepts offers. It uses
the [same week harness](src/m3/week3.ts) as `tools/m3/run3-week.ts` and the
[run-3 matrix](../m3/run3/protocol.md): squeezed state, eightfold incident rates,
walking, 1,008 ten-minute game windows, 100 play seconds per window, daily controls
and observation-time snapshots. Stories and decisions unfold during the week.
Places and cells retain the declared schematic placement; this is offline model
evidence, not a recording of the game.

The observer samples the opening and every completed window, before the thread
archive drains the diagnostic log. The publisher keeps a copied history of director
and hold entries; their recorded game/play clock and local sequence distinguish
decisions when the drained sink restarts its sequence. Cross-window hold clearances
retain their original start. No engine log is resequenced or restored.
Output stays in a
private `<fresh-out-dir>.pending` sibling until the regenerated record matches
the archive, loaded through the [run-record reader](src/m3/run-record.ts). SHA-256 covers canonical JSON
with sorted object keys and unchanged array order, excluding only
`diagnostics.seconds` (wall-clock duration). A mismatch reports the first differing
field and leaves the candidate unpromoted. Existing outputs or staging directories
are refused. The fixture command is unchanged.

The standalone title is **Kabuki week (simulated)**. Its `from` is the actual start
and its `to` is the final simulation clock reading, including the observer's game
epoch. The staging bound is replaced and every record's times checked before
promotion. The regenerated gzip record and timing/count/identity summary sit
beside the spool as `<fresh-out-dir>.run.json.gz` and `.summary.json`.

Allow tens of minutes: archived weeks took roughly 20–40 minutes, with machine load
affecting wall time. The summary profiles log copies, observer sampling, writing,
identity verification and finalisation, and reports publishing overhead relative
to the remaining harness time in the same execution; it is not a second bare-run
benchmark. Run the independent complete-spool audit with:

```powershell
bun tools/holotable/check-spool.ts <spool-directory>
```

It checks every manifest and line against producer bounds and Holotable's current
validator, scans every readable item field for internals, and checks actual timeline
bounds. The short [publish regression](test/holotable/m3-week.test.ts) runs a small
run-3-style Kabuki world, compares observer-on/off records, checks the actual bounds
and validates every output line. It also proves a mismatched record cannot promote.

Verified on 28 October 2026 with Bun 1.4.4 and the private world pack: the default
run's regenerated record matches the archive (canonical SHA-256
`503de19353e822e388de7c71168242d900370b8a9fc252c7dc437ae5a35eb828`).
It published 1,009 observations over game seconds **0–604,800**: Day 1, 00:00 to
Day 8, 00:00, with stories on all seven days. All 13 manifests and 4,291 records
passed producer checks, the independent internals scan and Holotable's validator,
with zero refusals, truncations or unknown glyphs. At the end, 19 developed story
points remain and 183 possible stories occupy eight place buckets. There were no
intention items.

Elapsed time was **19 min 33.4 s**: **18 min 37.7 s** in harness phases and
**55.7 s** publishing overhead (**5.0 %** of harness time). The publishing profile
attributes 43.3 s to the observer and 12.3 s to writing; copying, setup, identity
verification and finalisation together took under 0.2 s. This subtraction measures
direct publishing work in one execution, not a separately scheduled bare week.
The archived bare run reports 18 min 32 s; machine load prevents treating that
older wall time as a controlled overhead benchmark. Peak memory was **1.3 GB**
under the 4 GB guard. The targeted Holotable/shadow set passed **100**, skipped
**1** existing opt-in test and failed **0**, in **54.50 s**. The possible-story
regressions include conservation throughout the full fixture week, and the audit
regression checks manifest and record byte limits before trimming or parsing.
The full suite is left to the coordinator.

### Default hooks and compatibility option

Holotable's playback round accepts the content hooks and multiline detail.
The writer now enables them by default for standalone and shadow output:

- `producer_title: "Story Engine"` (1–80 characters, no controls);
- `facet_titles`, containing only that layer's keys (at most 16, keys 1–40 and
  display titles 1–60 characters, no controls);
- multiline detail, whose first line is a self-contained hover summary. Only LF
  line breaks are permitted: at most 40 lines and 4,000 characters.

For older Holotable builds, pass `--no-holotable-hooks` to the fixture, real-week
or shadow CLI, or use
`{ holotableHooks: false }` as the third `RunPublisher` constructor argument.
`ShadowHost` accepts the same writer options as its final constructor argument.
Compatibility output omits the manifest hooks and uses one detail line:
`<summary> Why: <cause> → <cause>`. A summary without causes stays on its own;
current-story text stays with the summary. The fixture's `--holotable-hooks` remains
a no-op alias; its negative flag takes precedence if both are supplied.

The producer's bounds apply in both modes. Both complete fixture outputs are
checked against Holotable's current validator, imported read only.

## What the layers say

| Layer | Content and caption order |
|---|---|
| places | Real district names, schematic `<district>, block <n>` labels in layout order; mood, who's here, refuge only when yes |
| people | Opened residents have pool names and plain roles; doing, wants, planning, believes, with, omitting unknown values. Background residents form one crowd point per cell: who, about |
| groups | Plain group names; leaders, intends, keeping to its rules, wants, when recorded |
| items | Held item names and named holder, omitting unknown fields |
| ties | Plain relation captions and weak/moderate/strong inspector strength; numeric strength retained for line weight |
| events | One historical point per recorded event; a past-tense sentence, what happened, named participants, and a timed cause chain |
| beliefs | Believes or is wrong about, with a sentence describing the belief; unknown claims are absent |
| stories | Developed stories only: at least two matched steps, a nonambient presentation receipt for an associated seed, or an outcome. Their role links appear with them. The agreed title; now, so far, could go, kind, thread, and cause chain |
| possible-stories | One point per entry place for the remaining live stories; count, top three title prefixes with counts and others, then the explanation. Detail lists up to twenty complete titles newest first |
| director | One historical target per decision or hold, with its sentence, story, checks for decisions where informative (omitted for holds), and relative low/medium/high score |
| intentions | Watching, warned or hunting toward V; stage, warned, and the recorded act blamed on you |
| placement | Scene set and the story title; phase in words and the authored logical kit's purpose. No physical staging is claimed |
| detail | Simulated in full detail or Simulated in outline |

Unknown information is omitted, including unavailable role bindings. A template
cannot leak a variable, identifier or placeholder. The protagonist is V in names
and you in prose. Existing recorded names win on first use; when the engine has
not opened a name, a stable display-only assignment from its name pool is used.
The observer keeps that first display name for the run so historical event labels,
current people and cause chains agree. This assignment is not an engine draw and
does not assert a value for the unresolved name slot.

**Possible stories** uses the tension-family `story` glyph and its own Kinds/About
facet titles. A sow decision alone does not count as presentation: an associated
seed needs a presented or confirmed receipt. When a story develops, its individual
point and role links appear, and its possible bucket decreases or retracts if empty.
Buckets revise only when their count or kinds line changes; title/detail-only changes
do not add stepping stops. Reappearance after an empty bucket starts a new stop.
The [possible-story regressions](test/holotable/possible-stories.test.ts) check that
developed plus possible conserves the live pool throughout the fixture week.

The [spool audit regression](test/holotable/check-spool.test.ts) checks raw UTF-8
line lengths, including manifests and LF bytes, before trimming or JSON parsing.
Oversized trailing whitespace cannot evade the line bound.

Crowds are estimates from the population recipe: whole household count times
mean household size, rounded to a person, minus individually opened residents in
that home cell (never below zero). They say "About N people in the background"
and "Numbers are estimates until people are simulated individually." The estimate
reads only the index and existing fit; ordinary reads and cold resident headers
cannot change it. Crowd affiliation shares come from the cell's presence model.
An opening requires durable evidence: a name header, recorded event participation,
a story binding or a frame record, including ended frames. Pins alone and
cache-only reads do not open a resident. A resident known only through pins stays
in the crowd before save, after save and after replacement load, even when the
writer retains those pins as dependencies. Opening never runs retention traversal.
Shares show the three largest named affiliations as whole percentages, then others.

People stay in one `people` layer until the published count (opened people plus
nonempty crowd items) exceeds 4,000. Only then do they move to district layers;
that split stays in place for the run. Unopened headers never trigger a split.

Death events name their victim, with "Someone died" when no victim is known.
Beliefs describe the asserted path/value or each finite-region alternative,
including effects, news, causes, reasons and grievances. They never substitute the
true event for a mistaken claim. Unsupported claims are omitted. Crew ties say
"in a crew with"; neighbour ties say "neighbours with". One wording display-text
guard rejects unsafe externally sourced text before interpolation/publication,
including facet keys; unnamed items use a plain kind noun. Subject agreement and
protagonist possessives come from wording data ("you owe", "your delivery").
The guard rejects hex runs of 16 or more characters even inside a token, numeric
digit runs of 10 or more, and decimal/exponent numbers, including `.5` and `-.5`.
Unsafe item labels become a plain noun before publication. The fixture's independent
checker scans runs and parses exponent parts without calling the producer guard.

Detail shows the summary, the current story step when available, a blank line,
then one timed sentence per cause, oldest first. Non-event story fillers start from their recorded cause events. Known event causes are followed
up to five events, including the subject; clipped chains end with
`(earlier causes not shown)`. Cycles terminate. Times are game time from the run's
start. Missing cause records never become invented prose.

### Placement and glyphs

District bindings use the world pack's real region ids. Synthetic cells use a
sorted, deterministic schematic grid within each district's actual bounds; they
are not measured streets or floors. Each schematic cell ends with the about facet
"A sketch of this block, not the real streets yet." Other items omit this note.
Known cell fallbacks reference their places-layer item. Events without a cell use
their participant's district, otherwise the simulated district, and explicitly say
Placed by district when its name is known. Unknown endpoints stay unplaced.

People use community-role glyphs, crowds `crowd`, groups `gang`, `corp` or `group`,
and events the vocabulary's semantic event icons. Story families use `story` for
tensions and closures, `juncture` for turns and `thread` for larger shapes; a
closure/outcome also has the done badge. The family remains readable in kind.
Director decisions use rumour, direction, note, sown or held as appropriate.
Relations with no vocabulary icon use diagnostic. Unknown event kinds use event;
unknown people roles use person. No new glyph slug is invented.

### Revision and spool guarantees

A story changes only for a matched step, outcome or change to its next open steps.
Pending bookkeeping, scores, ready timestamps and map reordering do not add stops.
Events and director decisions retain their first published prose. People/crowds
revise only when their visible content or placement changes. Other disappearing
items retract; events and decisions remain historical. Holds retain exact clear
retractions, including an entire hold between observations.

All records are validated before an observation is appended. Labels are capped at
160 characters; facets at 16 entries, 40-character keys and 500-character values;
detail at 4,000 characters/40 lines. Overflow remains prose and points to the
record link without exposing a citation inside content. Citations alone retain
`se:<kind>:<id>`. Spools retain the 1 MiB line, 16 MiB layer and 5,000 distinct item
id bounds across revisions, retractions and branches. Explicit branch identities,
retrospective tombstones and global/branch deduplication retain their v0 semantics.
A failed append may leave partial files; retry with a fresh output directory.

## Verification

[Holotable tests](test/holotable/) cover the complete fixture week in both writer
modes, wording coverage, readable text, crowd conservation/opening, optional titles,
cause order/caps/cycles, consumer compatibility, hooks/bounds and meaningful stops.
The shadow run uses the same readable-content check. Observer-on/off tests still
compare records, every sampled digest, draw transcript and saves byte for byte,
with and without replacement loads. Sentinels prohibit resolution/recovery during
observation, and raw-state images include ephemeral caches. Both frozen kernel
digests are unchanged by this work.

Offline verification on 27 October 2026 (Bun 1.4.4): `bun run check` passed;
the guarded Holotable/shadow tests passed **88 tests**, with **1 skipped**, **0 failed**
and **0.7 GB** peak memory (89 tests across 9 files). The S3 mixed-pattern tests
passed **11 tests**, **0 failed**, using **0.5 GB** peak memory. Two final default-suite
attempts stopped at the machine-wide 4 GB free-memory floor; the maintainer will
run that final suite. Observer-on/off and both frozen-digest checks passed in the
earlier suite run. The real-world-pack default fixture CLI published 1,010 observations
in 14.6 seconds, using 0.5 GB peak memory;
both default and compatibility runs have 12 spools with zero truncations and unknown
glyphs, and Holotable's standalone validator reported **Valid: no refusals** for
both complete runs. This measures offline fixture publishing,
not interactive playback or game responsiveness. The v3 digest remains
`746601727380a3fdff647f873c91c971`, and v4 remains
`8fce55b19462a1e02f03ca5336bd8c16`.

Run `bun run check`, the default suite under
`& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun test`,
and the repository link/private-path checks. Test spool folders are below
`.scratch-holo1/`; the maintainer requested that this hand-off leave it for them to delete.

Knowledge used: [places](../../../knowledge/places.md) (region geometry and
schematic placement boundaries) and [quests and story](../../../knowledge/quests-and-story.md)
(offline story/placement evidence is not a runtime quest or physical scene).
No new Cyberpunk runtime behaviour is claimed.
