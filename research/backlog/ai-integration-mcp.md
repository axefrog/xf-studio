# AI integration through MCP (optional capability)

**Status: direction set 26 September 2026; not started.** The runtime bridge's MCP server (`projects/xf-runtime-bridge`, phase 2) is being built first for the project's own in-game testing. This item makes the same capability, and more, available to XF Studio's users as an optional feature, so they can connect their own AI tools and subscriptions.

## Requirement

XF Studio offers an optional, off-by-default MCP (Model Context Protocol) server that a user's own AI client can connect to. Two tool families:

1. **Game tools** (through the runtime bridge, when the game runs with the bridge enabled): game status, photo mode, camera, light, creator options, screenshots with region crops and downscaling.
2. **Studio tools** (later): the Studio's own typed actions and read-only snapshots, from the action/capability catalogue, so an assistant can inspect and edit looks, run Check and Build, and read results through the same capabilities and refusals the UI uses.

## One command API, many frontends

MCP is one frontend. Underneath sits a transport-agnostic command API: typed commands with schemas, permission classes and plain results or refusals, from one catalogue. The MCP server, the command line, the JSON session runner and, later, the desktop app and user scripts or macros all derive their commands from that catalogue, so a command added once is available everywhere. That makes the same interface the base for scriptable extras: batch screenshots of every preset, regression runs after an update, turntables, look comparisons across Vs.

## Design constraints

- **Off by default, explicit opt-in.** A plain explanation of what an AI client can then do, per tool family.
- **Permissions as data.** Every tool is classified (read, write-studio, write-photo, write-world) so a consent screen can offer per-class switches; writes are off until the user enables them. Game writes stay limited to what the bridge allows in its own configuration.
- **Local only.** Loopback transport (stdio for a local client, or loopback HTTP/SSE with a per-session token); never listening on the network.
- **The same contract as the UI.** Studio tools go through typed actions and capabilities, so Undo, validation and plain refusals behave exactly as in the app. No private back doors.
- **Plain, user-facing tool text** and errors; diagnostics references (see [diagnostics](../../docs/diagnostics.md)) on failures.
- **Privacy.** Tool results never include personal paths or account identifiers; the shared private-data patterns apply.
- **Honest labelling.** Screenshots and results come from the user's own game; nothing is sent anywhere by XF Studio itself.

## Slices

1. The bridge's MCP module, reusable and hostable (phase 2 of the runtime bridge).
2. Desktop hosting with a Settings switch, consent screen and connection instructions for common clients.
3. Studio tools over the action catalogue (read-only first, then writes behind consent).
4. Documentation and a Help topic.

Related: [runtime access baseline](runtime-access-baseline.md), [runtime bridge design](../runtime/runtime-bridge-design.md).
