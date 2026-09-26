# World, terminals, arcade and scripting: research queue

Requests of 26 September 2026. These are research items for later domains. They rank **below** getting the rest of V's appearance and body into the Studio (backlog track 2 and the standing direction's body and clothing steps), so they run as research only when a slot is free, and nothing here is built before it is discussed with the maintainer.

| # | Item | Starting points | First question |
|---|---|---|---|
| 1 | **Contributing to computer terminals** | Installed mods Browser Extension, Virtual Atelier, Virtual Atelier Delivery, Virtual Car Dealer and High Resolution Garment Preview (one family of terminal additions); the game's terminal and in-game browser UI | How terminal pages, sites and apps are registered and rendered, what those mods add and how; then what is possible beyond shops (tools, mini-apps, story content) |
| 2 | **Arcade machines** | The in-world arcade cabinets and their two or three built-in games | How a cabinet launches its game (UI, minigame systems, inputs); whether new games can be registered without replacing the built-in ones |
| 3 | **World, locations and assets** | The MO2 profile's "World" section, World Builder first, then the other mods there; the game's streaming sectors and world resources | How world additions are authored and loaded (sectors, entities, ArchiveXL world streaming), as groundwork for quest and area design |
| 4 | **Scripting in TypeScript** | CET's Lua scripting as the incumbent; the XF runtime bridge's command API; Monaco (or CodeMirror) in the Studio | Whether a TypeScript authoring layer (compiled to something the game runs, or driving the bridge) is a practical, friendlier way for people to program their own games and terminal content |

Constraints that already apply: additive, never replacing other mods' content ([CCXL-style additions](ccxl-character-creator-capabilities.md)); techniques learned from other mods' source are credited in the [community credits](../../docs/community-credits.md) and never copied without a licence; runtime work goes through the [runtime bridge](../../projects/xf-runtime-bridge/README.md) under the maintainer's supervision.
