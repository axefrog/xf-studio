# Holotable: the live world view

Research for Holotable, a private, game-external and in-game view of what the game and XF's own systems believe is happening in the world right now. It is built as a typed, time-indexed model of the world with layers from several producers (the runtime bridge, offline world data, the Story Engine), and every surface is a projection of that model: a translucent in-game overlay, its CET settings window, a Holotable view in XF Studio (an early-access module behind a flag), agent-readable reports and stills. The data side runs headless, so agent tools work without the Studio open.

| Document | What it holds |
|---|---|
| [Proposal (phase 1)](proposal.md) | Value, presentation, architecture, data sources, the performance constraint, the first bridge wants, the Story Engine's layers and the spoiler switch, coordination and the phased plan |
| [Mock-up](mockup.html) | An interactive, data-driven sketch of the in-game overlay, its CET settings window and the Studio view |
| [Playback and glyphs](glyphs.md) | Speed by clock family, visible-layer stepping, reduced-motion-aware pulses/fades, semantic plates and unknown-name diagnostics |
| [W0 sector reader and solids](w0-sector-reader.md) | Implemented slice, all-level overlap evidence and shape census, cold/cache/frame measurements, validation and remaining limits |
| [W1 world-content reader](w1-world-content.md) | Offline Kabuki file, verified community/spot/spawner/workspot/pin field mapping, coverage/cache rules, optional POI/spot/community base layers and frame evidence |

The brief is [research/backlog/briefs/live-world-view.md](../backlog/briefs/live-world-view.md). The headless replay service lives in `projects/xf-holotable/`, the Studio view in the Studio's `features/holotable/` (agreed with XF · Studio), ignored payloads and caches in `local/holotable/`, and experiments under `experiments/046-*`. The CET module remains planned. The work is coordinated by its own chat, XF · Holotable.
