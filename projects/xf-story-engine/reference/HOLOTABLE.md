# Holotable layers v1: readable world-map content

The Story Engine reference model publishes read-only observations to Holotable's
append-only `xfh/layer-1` / `xfh/item-1` JSON-lines spools. All layers use producer
`story-engine` and full content. This is offline model evidence: it never runs the
game, deploys content, opens a resident, resolves a slot or evaluates an engine draw.

The shared, pure [wording renderer](src/wording/index.ts) reads copied record views.
Its [wording data](src/wording/wording.json) contains the coordinator's 27 function
mood tables and 29 pattern titles, event sentences, community and participant role
words, group names, intention phrases and noun overrides. The composite library is
read only. M3's thread renderer is a future second consumer; `src/m3/` is unchanged.

## Publish the fixture

From this directory, under the repository memory guard:

```powershell
bun tools/holotable/publish-run.ts <fresh-output-directory> --world-pack <world-pack.json> [--game-epoch-seconds <number>] [--holotable-hooks]
```

The default world pack is the repository's private `local/holotable/world-pack.json`.
It is read only. Output must be a fresh directory; existing spools are refused.
The CLI still uses the SF3-60 scripted Kabuki fixture: the opening, followed by
1,002 ten-minute windows, with the nominal seven-day timeline. Its action remains
concentrated in the opening. Replacing this with the coordinator's named M3 engine
week is **step 2**, waiting for that branch; it is not part of this pass.

For an existing host run, construct a [HolotableObserver](src/holotable/observe.ts)
and a [RunPublisher](tools/holotable/publish-run.ts), and call `publishBoundary` after
each completed boundary. The host supplies the timeline extent and any explicit
entity bindings. [Shadow mode](SHADOW.md) uses the same observer and wording with
recording-clock bindings; it issues no game writes.

### Compatibility option

Current Holotable on main rejects the new optional manifest hooks and multiline
detail. The writer therefore defaults to compatibility mode: no hooks, and detail
is one line: `<summary> Why: <cause> → <cause>`. A summary without causes
stays on its own; current-story text stays with the summary.

`--holotable-hooks`, or the third constructor argument
`{ holotableHooks: true }`, enables:

- `producer_title: "Story Engine"` (1–80 characters, no controls);
- `facet_titles`, containing only that layer's keys (at most 16, keys 1–40 and
  display titles 1–60 characters, no controls);
- multiline detail, whose first line is a self-contained hover summary. Only LF
  line breaks are permitted: at most 40 lines and 4,000 characters.

The producer validates both forms. Default-mode fixture output is checked directly
against Holotable's current validator, imported read only. Hook-mode interoperability
awaits Holotable's matching round; it is not claimed to work in today's consumer.

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
| stories | The agreed title; now, so far, could go, kind, and a multi-story thread's first title; library summary and latest matched step's cause chain in detail |
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

Crowds are estimates from the population recipe: whole household count times
mean household size, rounded to a person, minus individually opened residents in
that home cell (never below zero). They say "About N people in the background"
and "Numbers are estimates until people are simulated individually." The estimate
reads only the index and existing fit; ordinary reads and cold resident headers
cannot change it. Crowd affiliation shares come from the cell's presence model.
An opening requires durable evidence: a name header, a detailed-slot pin, recorded
event participation, a story binding or a frame record, including ended frames.
Cache-only reads do not open a resident; replacement loads preserve openings.
Shares show the three largest named affiliations as whole percentages, then others.

Death events name their victim, with "Someone died" when no victim is known.
Beliefs describe the asserted path/value or each finite-region alternative,
including effects, news, causes, reasons and grievances. They never substitute the
true event for a mistaken claim. Unsupported claims are omitted. Crew ties say
"in a crew with"; neighbour ties say "neighbours with". One wording display-text
guard rejects unsafe externally sourced text before interpolation/publication,
including facet keys; unnamed items use a plain kind noun. Subject agreement and
protagonist possessives come from wording data ("you owe", "your delivery").

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
the guarded default suite passed **1,763 tests**, with **46 skipped**, **0 failed**
and **1.4 GB** peak memory (1,809 tests across 130 files). The real-world-pack
fixture CLI published 1,010 observations in 12.6 seconds, using 0.5 GB peak memory;
its 12 spools have zero truncations and unknown glyphs, and Holotable's standalone
validator reported **Valid: no refusals**. This measures offline fixture publishing,
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
