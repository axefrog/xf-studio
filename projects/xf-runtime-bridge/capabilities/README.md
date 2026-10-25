# Bridge capabilities

The single record of what XF Runtime Bridge does, will do and is asked to do, and how far each thing is built, proven and healthy. It is data first: JSON files checked by a schema, with the readable pages generated from them. The bridge is a continuously evolving project, so there is no "1.0" here: each capability carries its own state.

## Layout

| Path | What it holds | Who edits it |
|---|---|---|
| `registry.json` | Areas and consumers ([schema](schema/registry.schema.json)) | The owner |
| `items/<area>.json` | An array of capabilities in that area ([schema](schema/item.schema.json)) | The owner; consumers edit only their own `demand` entries |
| `requests/<consumer>.json` | Asks not yet triaged, in the item schema with stage `requested` | That consumer |
| `changelog/<yyyy-mm>.jsonl` | One line per change, appended, never rewritten ([schema](schema/changelog.schema.json)) | Whoever made the change |
| `CAPABILITIES.md` | The generated overview (never edit by hand) | The generator |

## Three axes, kept apart

- **Stage:** how far it is built (requested → proposed → planned → building → built → merged → released; or retired).
- **Evidence:** how far it is proven in the game (none → offline → partial → proven; or regressed). Offline tests never make a capability `proven`; only test-card rows passed in a session do.
- **Health:** how well it works as far as anyone knows (unknown, works, caveats, degraded, broken).

A merged capability with no game evidence is normal while it waits for a session. A large number of them is evidence debt, and the generated page counts it.

## Rules

- **The owner is XF · Runtime bridge.** It alone changes stage, evidence, health, priority, surface, verification, limits, quirks, known issues, unknowns and improvements, and it triages requests into items.
- **Consumers record what they need in the registry.** A consumer adds or updates its own `demand` entry on an existing item, or files a new ask in `requests/<consumer>.json`. It adds a changelog line and sends XF · Runtime bridge a one-line heads-up naming the item. It never edits another consumer's entry or an owner field. If an owner field looks wrong, say so in the message.
- **Every change gets a changelog line,** with the date, who, the kind, the items and one plain sentence. Axis changes give `from` and `to`.
- **Verdicts come from sessions.** `verification.rows` mirrors the test card's latest verdicts; the test card stays the place the rows themselves are written.
- **Public repository.** No personal paths, credentials, save names or story content. Chats are named by their titles; people are not named.

## Tools

`bun tools/capabilities.ts validate` checks the schema, unique ids, known areas and consumers, `depends_on` (no unknown ids, no cycles), commands against the catalogue, rows against the test card, and that every changed file has a changelog line. `render` writes `CAPABILITIES.md` (and an HTML page to a given folder); `changes --since <date>` prints a digest of the changelog for a status update.
