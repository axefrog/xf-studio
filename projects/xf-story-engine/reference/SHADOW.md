# Shadow mode v0

The TypeScript reference model can run S1 beside a recording or a live read-only
Holotable source. It submits mirrored readings through S1's existing ReplayPort,
simulates Kabuki and appends the twelve diagnostic layers after each completed
600-game-second window. It never stages content or sends a changing bridge command.
S2/S3 packs are not installed by this host; their layers can therefore be empty.

Run from this directory under the repository's 4 GB memory guard:

```powershell
bun tools/shadow/run.ts <recording-run-directory> <fresh-output-directory> --world-pack <world-pack.json>
bun tools/shadow/run.ts --live <fresh-output-directory> --duration 60 --world-pack <world-pack.json>
bun tools/shadow/run.ts --replay-log <private-live-log.jsonl> <fresh-output-directory> --world-pack <world-pack.json>
```

The default reader is the repository's Holotable project. `--holotable-root`
optionally selects another **project directory**, not a repository root. The
world pack defaults to private `local/holotable/world-pack.json`. Recordings stay
in their original private folders. Neither command starts the recorder or the game.

Output enables Holotable's content hooks by default: `producer_title`, per-layer
`facet_titles`, and multiline detail with a short hover summary followed by the
cause lines. Detail permits only LF breaks, at most 40 lines and 4,000 characters.
For older Holotable builds, append `--no-holotable-hooks` to any mode, including
`--live`. This omits the hooks and folds detail into one line using
`<summary> Why: <cause> → <cause>`. `--holotable-hooks` is a no-op alias; the negative
flag wins when both appear. Code hosts may pass `{ holotableHooks: false }` as
`ShadowHost`'s final writer-options argument. See [Holotable layers](HOLOTABLE.md).

V's sampled position sets its mirrored position, district and schematic cell.
District selection uses Holotable's real polygons. Kabuki's schematic XY grid is
exactly the writer's layout; its thin drawing slab is not a street elevation test.
Northside and Little China have real district bindings but no simulation cells.
Locations outside the index and districts without cells are counted explicitly;
leaving a cell clears the old reading with a declared unknown id.

Actors become session/run-scoped mirrored people with sampled entity and position.
They are labelled **Someone nearby**, with no role, and the explanation
"Seen in the game; who they are isn't recorded yet." Recorder handles remain in
identity/citation fields. Record, affiliation and crowd readings are absent and
never inferred. Entity anchors use Holotable's actor track; a
position-only actor uses its observed coordinates. An invalid/missing position
is counted and is never presented as a new position reading. `valid:false` breaks
the actor's track even if a malformed sample carries coordinates. The host
immediately removes a previously published actor from the people snapshot, letting
the existing writer retract it on the current branch. A retrospective gap `[a,b]`
emits a tombstone at `a` and at every actually published actor revision time inside
the closed interval. The start hides older revisions between samples; the later
tombstones supersede revisions already published inside the gap. Holotable
chooses later spool order at equal timestamps (the [layer evaluator](../../xf-holotable/src/layers.ts)),
so equal-time tombstones win without replaying old item copies. The writer's
optional revision callback reports only item lines actually appended, including
their layer, time and branch. Up-front discovery emits the gap-start tombstone
and suppresses the affected items; consumer-visible state matches late discovery
between revisions, at revision times and after the gap.
Later windows suppress it until a valid position reobserves it. Historical game
readings remain evidence: S1 does not permit withdrawing them. Failed whole-channel
actor reads and shared recorder gaps invalidate every known actor at the gap's start,
before any window inside a missing interval can republish an old position.
An actor sample at the left endpoint remains historical, not a reobservation.
The end of a gap does not restore an actor without a valid reobservation.
Actor-only gaps leave V's track and the clock untouched, including batches with no V sample.

Typed `witness.report` receipts submit raw `game.witness.report` events through
ReplayPort, plus one raw `game.incident` per native incident id across the run.
Both use the observation's whole game second from the feed clock, including for
delayed reports; native `when` simulation intervals are not QPC and do not rewind
the clock. The source position selects the existing cell/district where possible;
the port's city fallback applies otherwise. Native participant roles are counted
as unmapped rather than guessed into S1 roles or turned into actor-track readings.
These raw kinds have no effects, fills or inferred derived events. Schema admission
and registration live entirely inside the [host adapter](src/shadow/host.ts): S1Data's raw-kind list
does not extend its schema enum, so the adapter extends only its own schema
instance and registers the two evidence-only kinds. Engine core is unchanged.

`witness.gap`, `witness.unwitnessed` and `incident.coverage` receipts are counted
under `unmapped` and listed individually under `incidentReceipts`, with their
QPC time, sequence and typed payload. Coverage values (including zeros and false)
are carried through per receipt; cumulative counters and gauges are never summed
across heartbeats. `mapped` counts the submitted raw kinds. Reports without a
native incident id still submit the witness report and count the missing identity.
There is no private recording parser or sidecar. Death, combat and crime events,
as separate channels, plus actor record, affiliation and crowd, are listed as
absent from the recorder. Native incident classifications remain incident evidence.
The V combat flag remains an unmapped sample field, not a synthesized combat event.

The summary counts unmapped modeled camera samples, timeline-event kinds and
unused V fields. `coverage.channels` carries Holotable's real per-channel
`{name, read, kept, dropped, reasons}`, sorted by name with sorted reason keys.
`unmappedSourceChannels` lists channels the shadow host does not map, including
modeled content that it only counts. Per-channel counts cover rows actually read;
they include intentional reader omissions, and are distinct from the manifest's
global dropped count and transport/chunk gaps. Zero actor observations or witness
reports does not establish an empty street. A further recording needs nonempty
actor samples and witness reports to validate those mappings with recorded data.

## Time, determinism and limits

The host uses sampled game time when available. Recorded game-time anchors are
held between their samples; actor and incident samples hold the last effective clock value
and its derived/recorded label, including after a V sample extrapolated an
intermittent explicit clock. A new explicit sample still refuses a real rollback.
With no game
clock, it uses QPC elapsed seconds times eight from the session start, beginning
at the declared default game epoch zero (`--default-game-start` overrides it).
The summary names every rule used. Actual game-clock rollback refuses the run.
CLI initialization uses this same clock at the earliest V, valid actor or incident observation.
The simulation starts at that observation's containing window through the existing
`Sim.startAt` interface; boundaries before that window never execute.

Readings use whole game seconds. Until a window closes, the adapter coalesces each
node/slot/second to its latest source observation, including across live batches,
so pin-hash arbitration cannot select an older subsecond position. Position,
district and cell therefore come from the same latest valid V sample. The summary's
`inputs` counts submitted coalesced readings and raw events; `pendingInputs`
includes buffered readings and queued events in the unfinished window.

Every manifest uses `clock: "recording"` and binds its session and run. Item and
retraction times are the QPC observation that drove their completed window.
Clock conversion and its derived/recorded rules remain in the summary. Raw game
times and source intervals are omitted from display facets. Timed cause sentences
use the shared wording renderer, with days counted from this run's start.
An unfinished final window stays queued and its pending-input count is reported;
the host never advances beyond the feed just to flush it.

The existing publisher retains its bounds, glyphs, captions and branch rules.
Standalone mode retains its game-clock binding; people now admits crowd points
alongside actors, as described in [Holotable layers](HOLOTABLE.md). Recording spools and
`summary.json` contain no wall-clock timings; timing diagnostics go to stdout.
Live mode owns a read-only connection through Holotable's live source, whose
catch-up requests are capped at one per second. The only admitted commands are
`recorder.status` and `game.catchup` with `now:false`. The default deadline is
60 seconds, the maximum 3,600; Ctrl+C aborts and closes its own connection.

Live logs below the worktree's `.scratch-shadow/` record exact discovery results,
requests, cursors, returned pages and normalized batches consumed by the host.
Replaying those batches does not open a bridge. The private log stops at 64 MiB;
the ordinary 16 MiB/layer and distinct-item writer limits also remain enforced.
Any transport-log budget or disk-write failure is fatal: the source closes,
retries stop, and heartbeat/close surface the failure so the CLI cannot report
successful partial consumption.
Retain a live log only while needed for replay, then delete it.

## Offline evidence

The named street recording has 6,524 V samples, no actor observations (despite
6,524 kept actor-channel rows), and 993 modeled timeline events (373 voice, one
line, 619 incident coverage receipts). It has no witness reports, witness gaps or
unwitnessed receipts: zero raw incidents and zero raw witness reports are mapped.
The raw-report path therefore has synthetic offline evidence only.
It produces eight completed windows:
25 places, 1,597 people, four groups, two ties and one simulated event; all seven
other layers are empty. These people/events are simulation results, not mirrored
street observations. Its V stays in Little China, which has no simulation cells.
Its clock rule is QPC × 8 from the declared default game epoch. Twelve layer
spools and `summary.json` are byte-identical across reruns (27 October 2026).
Its source marks coverage incomplete, with five globally dropped rows. The
per-channel counts total 25,062 read, 20,565 kept and 4,497 dropped; these include
intentional reader omissions and are not the same measure as the global five.

| Channel | Read | Kept | Dropped | Reasons |
|---|---:|---:|---:|---|
| actors | 6,524 | 6,524 | 0 | — |
| camera | 6,524 | 6,524 | 0 | — |
| contacts | 619 | 0 | 619 | no mapped content: 619 |
| face | 779 | 0 | 779 | not mapped: 779 |
| incidents | 619 | 619 | 0 | — |
| subtitles | 642 | 1 | 641 | invalid: 2; no mapped content: 639 |
| supervisor | 619 | 0 | 619 | no mapped content: 619 |
| ui | 1,030 | 0 | 1,030 | not mapped: 1,030 |
| v | 6,524 | 6,524 | 0 | — |
| voice | 1,182 | 373 | 809 | invalid: 2; no mapped content: 807 |

All 619 incident coverage payloads are retained. The final receipt reports 2,539
observed/accepted/admitted observations, zero reports, zero pending reports and
report gaps, and 1,470 repeat evidence coalescences. Unmapped host counts are
6,524 camera samples, 373 voice events, one line event and 619 coverage receipts;
all 6,524 V samples have unused non-position fields and are in a real district
without simulation cells. The seven unmapped source channels are camera,
contacts, face, subtitles, supervisor, UI and voice. Bounded captions
report eight truncations in places; no unknown glyphs occur.

The alternate combat recording previously likewise had no actors. Synthetic fixtures test
V/cell mapping, game-layer actor readings, invalid observations, immediate scoped
retractions and reappearance, actor-only gaps without V or clock advancement,
sorted channel coverage, raw incident deduplication/timing/schema admission,
unmapped incident receipts, schema refusal, byte-identical reruns with incidents
and breaks, read-only command enforcement, simulated live cadence and exact live-log replay.
Holotable's own spool reader and layer evaluator check late and up-front gap
discovery, equal-time tombstones, later revisions and sibling-branch preservation.
The live safety regression traverses the real shadow adapter and `CommandApi.run`
with an injected native transport that requires reader selection and rejects
every method outside the retained-data read allowlist. Transport-log failure tests
cover both discovery and catch-up receipts, with budget and disk failures.
Validation: 28 shadow tests pass; writer tests have 35 passes and one opt-in skip,
with the existing writer tests unchanged. The guarded default suite has 1,743 passes,
46 skips and no failures. The frozen v3 digest remains
`746601727380a3fdff647f873c91c971`, and v4 remains
`8fce55b19462a1e02f03ca5336bd8c16`. Typechecking, Markdown links and the
private-path scan pass. Scratch spools and logs are removed after verification.
No game session was run. See [performance evidence](PERFORMANCE.md) and
[Holotable's writer contract](HOLOTABLE.md).

Knowledge used: [game events](../../../knowledge/game-events.md),
[places](../../../knowledge/places.md), [HOLOTABLE.md](HOLOTABLE.md).
