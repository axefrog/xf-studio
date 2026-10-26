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

V's sampled position sets its mirrored position, district and schematic cell.
District selection uses Holotable's real polygons. Kabuki's schematic XY grid is
exactly the writer's layout; its thin drawing slab is not a street elevation test.
Northside and Little China have real district bindings but no simulation cells.
Locations outside the index and districts without cells are counted explicitly;
leaving a cell clears the old reading with a declared unknown id.

Actors become session/run-scoped mirrored people with sampled entity and position.
They are labelled **Unidentified person**. Record, affiliation and crowd readings
are absent and never inferred. Entity anchors use Holotable's actor track; a
position-only actor uses its observed coordinates. An invalid/missing position
is counted and is never presented as a new position reading.

Typed incidents and per-channel omitted-row counts await Holotable's model.
The host reserves raw `game.incident` and `game.witness.report` kinds with no
effects or fills, but invents no incident input and derives nothing from them.
S1 schema admission for these reserved kinds is also pending: registration alone
does not extend the schema's event-kind enum. That engine interface change belongs
to the incident follow-up, after Holotable's contract lands.
There is no private recording parser or sidecar. Death, combat and crime events,
plus actor record, affiliation and crowd, are listed as absent from the recorder.
The V combat flag remains an unmapped sample field, not a synthesized combat event.

The summary counts unmapped modeled camera samples, timeline-event kinds and
unused V fields, and lists source channels the reader does not carry as
**unquantified**. Reader omissions are explicit; zero actors or incidents does
not establish an empty street. The next recording needs nonempty actor samples
and typed incident/witness reports, exposed by Holotable, to validate that path.

## Time, determinism and limits

The host uses sampled game time when available. Recorded game-time anchors are
held between their samples; actor samples hold the current explicit game time,
so a paused game's next V sample cannot roll the clock backwards. With no game
clock, it uses QPC elapsed seconds times eight from the session start, beginning
at the declared default game epoch zero (`--default-game-start` overrides it).
The summary names every rule used. Actual game-clock rollback refuses the run.

Every manifest uses `clock: "recording"` and binds its session and run. Item and
retraction times are the QPC observation that drove their completed window.
The game time remains in a facet, labelled `game time (derived)` when applicable.
Source game intervals remain in a facet rather than being mistaken for QPC.
An unfinished final window stays queued and its pending-input count is reported;
the host never advances beyond the feed just to flush it.

The existing publisher retains its bounds, glyphs, captions and branch rules.
Standalone mode retains its original manifest bytes. Recording spools and
`summary.json` contain no wall-clock timings; timing diagnostics go to stdout.
Live mode owns a read-only connection through Holotable's live source, whose
catch-up requests are capped at one per second. The only admitted commands are
`recorder.status` and `game.catchup` with `now:false`. The default deadline is
60 seconds, the maximum 3,600; Ctrl+C aborts and closes its own connection.

Live logs below the worktree's `.scratch-shadow/` record exact discovery results,
requests, cursors, returned pages and normalized batches consumed by the host.
Replaying those batches does not open a bridge. The private log stops at 64 MiB;
the ordinary 16 MiB/layer and distinct-item writer limits also remain enforced.
Retain a live log only while needed for replay, then delete it.

## Offline evidence

The named street recording has 6,524 V samples, no actors and 374 modeled
timeline events (373 voice, one line). It produces eight completed windows:
25 places, 1,597 people, four groups, two ties and one simulated event; all seven
other layers are empty. These people/events are simulation results, not mirrored
street observations. Its V stays in Little China, which has no simulation cells.
Its clock rule is QPC × 8 from the declared default game epoch. Twelve layer
spools are byte-identical across reruns. Its source marks coverage incomplete,
with five dropped rows. Three source channels (face, incidents, UI) are
unquantified until Holotable exposes reader omission counts. Bounded captions
report eight truncations in places; no unknown glyphs occur.

The alternate combat recording likewise has no actors. Synthetic fixtures test
V/cell mapping, game-layer actor readings, explicit absence, schema refusal,
read-only command enforcement, simulated live cadence and exact live-log replay.
No game session was run. See [performance evidence](PERFORMANCE.md) and
[Holotable's writer contract](HOLOTABLE.md).

Knowledge used: [game events](../../../knowledge/game-events.md),
[places](../../../knowledge/places.md), [HOLOTABLE.md](HOLOTABLE.md).
