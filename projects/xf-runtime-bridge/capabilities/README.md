# Bridge capabilities

The single record of what XF Runtime Bridge does, will do and is asked to do, and how far each thing is built, proven and healthy. It is data first: JSON files checked by a schema, with the readable pages generated from them. The bridge is a continuously evolving project, so there is no "1.0" here: each capability carries its own state.

## Layout

| Path | What it holds | Who edits it |
|---|---|---|
| `registry.json` | Areas and consumers ([schema](schema/registry.schema.json)) | The owner |
| `items/<area>.json` | An array of capabilities in that area ([schema](schema/item.schema.json)) | The owner; consumers change only their own `demand` entries |
| `requests/<consumer>.json` | Asks not yet triaged, in the item schema with stage `requested` | That consumer (or the owner, triaging) |
| `changelog/<yyyy-mm>.jsonl` | One line per change, appended, never rewritten ([schema](schema/changelog.schema.json)) | Written by the tool with every edit |
| `CAPABILITIES.md` | The generated overview (never edit by hand) | The generator |

## Three axes, kept apart

- **Stage:** how far it is built (requested → proposed → planned → building → built → merged → released; or retired).
- **Evidence:** how far it is proven in the game (none → offline → partial → proven; or regressed). Offline tests never make a capability `proven`; only test-card rows passed in a session do.
- **Health:** how well it works as far as anyone knows (unknown, works, caveats, degraded, broken).

A merged capability with no game evidence is normal while it waits for a session. A large number of them is evidence debt, and the generated page counts it.

## Rules

- **The owner is XF · Runtime bridge.** It alone changes stage, evidence, health, priority, surface, verification, limits, quirks, known issues, unknowns and improvements, and it triages requests into items.
- **Consumers record what they need in the registry.** A consumer adds or updates its own `demand` entry on an existing item, or files a new ask in `requests/<consumer>.json`. It adds a changelog line and sends XF · Runtime bridge a one-line heads-up naming the item. It never edits another consumer's entry or an owner field. If an owner field looks wrong, say so in the message.
- **Every edit goes through the tool, never by hand** (see [Editing](#editing)). The tool writes the changelog line for each change, with the date, who, the kind, the items and one plain sentence (axis changes give `from` and `to`), sets the item's `updated` date, and refuses anything that wouldn't validate. A hand-edited file fails `validate`, because it is no longer in the tool's format.
- **Verdicts come from sessions.** `verification.rows` mirrors the test card's latest verdicts; the test card stays the place the rows themselves are written.
- **Public repository.** No personal paths, credentials, save names or story content. Chats are named by their titles; people are not named.

## Tools

All commands run from `projects/xf-runtime-bridge` as `bun tools/capabilities.ts <command>`.

- **`validate`** checks everything and exits 1 with readable errors: the JSON Schemas; unique ids whose area prefix matches their file; known areas and consumers; `depends_on` and `parent` resolve, with no cycles; `surface.commands` exist in the catalogue; `verification.rows` exist in the test card; docs links (files and headings); a merged item's code and test paths; `proven` only when every required row passed (a row marked `optional` doesn't count), P0 and P1 with a reason, built items with a branch; changelog lines valid, in time order and in their month's file; every item's `updated` date matched by a changelog line touching it on or after that date; every item's content matching the digest on the newest changelog line that names it, so any change without its own line is caught; no interrupted edit waiting for recovery; and every file in the tool's format. `bun run check` runs it, and `tools/test/capabilities.test.ts` runs it on the real registry.
- **`render`** writes `CAPABILITIES.md` (generated; never edit it), `render --check` exits 1 when it is out of date, and `render --html <dir>` also writes one self-contained page (`<dir>/index.html`) with filters and a changelog tab.
- **`changes --since <date>`** prints a plain digest of the changelog for a status update.
- **`show <id>`** prints one item; **`list`** lists items, filtered by `--area`, `--stage`, `--evidence`, `--health`, `--priority`, `--kind` or `--consumer` (open demand).

## Editing

Every edit takes the registry's exclusive lock (`.edit.lock`; a lock whose process has gone, or older than ten minutes, is taken over), finishes any interrupted edit, loads the whole registry, applies the change in memory, sets the item's `updated` date, appends the matching changelog line with the digest of each item it names, validates the whole result and only then publishes, together with the regenerated `CAPABILITIES.md`, in a fixed format so diffs stay small. Publishing is a transaction: the journal (`.edit-journal.json`) lists every temporary file before it is written, a commit mark follows the last one, and the renames that follow are completed by the next run if they are interrupted; a failure before the mark publishes nothing and leaves no temporary file. An edit that would add a validation problem writes nothing and says why. Every edit takes `--as <consumer>` (default `runtime-bridge`, the owner): a consumer may change only its own `demand` entries and its own `requests/<consumer>.json`; owner fields are refused for anyone else. Values are JSON where they parse (`'["a","b"]'`, `null` removes a field) and plain text otherwise; a list flag takes commas or repeats.

| Command | Who | Example |
|---|---|---|
| `add <area> <id> --title --summary --kind [--stage --evidence --health --priority --reason --parent --depends --commands --events --config --code --doc --since --branch --notes]` | owner | `add npc npc.workspots --title "Workspots" --summary "Send an actor to use a workspot." --kind verb --stage proposed` |
| `set <id> <field> <value> [--summary --ref]` | owner | `set npc.direct surface.commands '["npc.move","npc.follow"]'` |
| `stage`, `evidence`, `health`, `priority` `<id> <value> [--reason --ref --summary]` | owner | `priority lifecycle.continue P1 --reason "Unattended launches need it."` |
| `demand <id> --level blocking\|needs\|wants [--ref --milestone --note]` | the consumer | `demand incidents.declared --level needs --ref S7 --milestone M4 --note "One outcome per incident." --as story-engine` |
| `demand-met <id> [--ref] [--consumer, owner only]` | the consumer, or the owner | `demand-met world.district --ref S4 --as story-engine` |
| `request <consumer> <id> --title --summary --kind [--level --ref --milestone --note]` | that consumer | `request story-engine story.shards --title "Shards" --summary "Readable shards with our own text." --kind verb --ref V6 --as story-engine` |
| `triage <request> --into <id> [--stage --priority]` | owner | `triage story.shards --into world.props` (merges, carrying the demand across) or `--into story.shards --stage planned` (a new item) |
| `issue add <id> --summary --severity [--status --ref]`; `issue update\|close <id> <number or ref> [--status --severity]` | owner | `issue close capture.event-armed 2949a677` |
| `quirk add <id> <text>`, `limit add <id> <text>` | owner | `limit add npc.actors "At most five XF actors."` |
| `unknown add <id> --question [--settle-by --needs-game]` | owner | `unknown add npc.fighters --question "Do fighters turn on bystanders?" --settle-by CS8187 --needs-game` |
| `improve add <id> --summary [--value --effort]` | owner | `improve add recorder.catchup --summary "A compact summary client." --value medium --effort small` |
| `verdict <row> <verdict> --session [--build --date --note --item <id> --apply]` | owner | `verdict ST7 pass --session borg-5 --build "0.8.23 abcdef12"` (updates every item listing the row and suggests evidence changes; `--apply` applies them, each with its own line; `--item` limits it to, or adds the row to, one item) |
| `rename <old> <new>` | owner | `rename npc.direct npc.movement` (every `depends_on` and `parent` follows) |
| `retire <id> --by <replacement>` | owner | `retire npc.scenario --by supervisor.plan-module` |
| `format` | owner | `format` (rewrites every file in the tool's format; no data change, so no changelog line) |
| `audit --baseline` | owner | `audit --baseline` (records the digest of every item whose newest line has none; the one-time migration to digests) |
| `recover` | anyone | `recover` (finishes or rolls back an interrupted edit; every command also does this first) |
