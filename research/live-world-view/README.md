# Holotable: the live world view

Research for Holotable, a private, game-external and in-game view of what the game and XF's own systems believe is happening in the world right now. It is built as a typed, time-indexed model of the world with layers from several producers (the runtime bridge, offline world data, the Story Engine), and every surface is a projection of that model: a translucent in-game overlay, its CET settings window, a Holotable view in XF Studio (an early-access module behind a flag), agent-readable reports and stills. The data side runs headless, so agent tools work without the Studio open.

| Document | What it holds |
|---|---|
| [Proposal (phase 1)](proposal.md) | Value, presentation, architecture, data sources, the performance constraint, the first bridge wants, the Story Engine's layers and the spoiler switch, coordination and the phased plan |
| [Mock-up](mockup.html) | An interactive, data-driven sketch of the in-game overlay, its CET settings window and the Studio view |

The brief is [research/backlog/briefs/live-world-view.md](../backlog/briefs/live-world-view.md). The headless service and the CET module will live in `projects/xf-holotable/`, the Studio view in the Studio's `features/holotable/` (agreed with XF · Studio), ignored payloads (spools, replays) in `local/holotable/`, and experiments under `experiments/046-*`. The work is coordinated by its own chat, XF · Holotable.
