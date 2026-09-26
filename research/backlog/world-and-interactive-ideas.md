# World, terminals, arcade and scripting: research queue

Requests of 26 September 2026. These are research items for later domains. They rank **below** getting the rest of V's appearance and body into the Studio (backlog track 2 and the standing direction's body and clothing steps), so they run as research only when a slot is free, and nothing here is built before it is discussed with the maintainer.

| # | Item | Starting points | Status |
|---|---|---|---|
| 1 | **Contributing to computer terminals** | Installed mods Browser Extension, Virtual Atelier, Virtual Atelier Delivery, Virtual Car Dealer and High Resolution Garment Preview; the game's terminal and in-game browser UI | **First pass done** (source and mod study, no game session): [terminals and arcade](../../knowledge/terminals-and-arcade.md) §2-7 |
| 2 | **Arcade machines** | The in-world arcade cabinets and their built-in games; Urmland Street Arcade | **First pass done** (source and resource study): [terminals and arcade](../../knowledge/terminals-and-arcade.md) §8 |
| 3 | **World, locations and assets** | The MO2 profile's "World" section, World Builder first, then the other mods there; the game's streaming sectors and world resources | **First pass done** (source, resource, wiki and mod study, no game session): [world and streaming](../../knowledge/world-and-streaming.md); plan and ideas [below](#world-phased-plan) |
| 4 | **Scripting in TypeScript** | CET's Lua scripting as the incumbent; the XF runtime bridge's command API; Monaco (or CodeMirror) in the Studio | **Options recorded**, no prototype: [terminals and arcade](../../knowledge/terminals-and-arcade.md) §9.3 |

Constraints that already apply: additive, never replacing other mods' content ([CCXL-style additions](ccxl-character-creator-capabilities.md)); techniques learned from other mods' source are credited in the [community credits](../../docs/community-credits.md) and never copied without a licence; runtime work goes through the [runtime bridge](../../projects/xf-runtime-bridge/README.md) under the maintainer's supervision.

## What the first pass found

- **Browser pages are journal data.** The browser asks the journal for an address and spawns the page's own `.inkwidget`, filled by widget name. A mod can add a site additively as an ArchiveXL-merged `.journal`, as a Browser Extension listener that returns its own widget, or as a new computer menu tab.
- **Browser Extension and Virtual Atelier are small, clean plug-in points.** A site is one listener class; a Virtual Atelier store is one `AddStore` call on a registration event, listing TweakDB items. Virtual Atelier reuses the vanilla vendor screen under a special vendor id.
- **Phone messages can be dynamic within pre-authored slots**, as Virtual Atelier Delivery does by rewriting journal message text and reactivating the entry. Scripts cannot create journal entries.
- **Pages can hold anything ink can:** script-built widgets (Codeware), popups, animations, delay-callback game loops, pointer, key and pad input, and save persistence. Camera-zoom terminals give only a cursor and click, so fullscreen popups suit games better.
- **Arcade cabinets:** only Roach Race and the shooter are playable; both run on a native minigame engine behind a native enum. A new game would be a pure-script ink game reached by wrapping the cabinet's name switch and playable check; adding its menu entry is the open question.
- **Urmland Street Arcade** places vanilla cabinets and pachinko machines as a new World Builder block and adds betting spots through the Gambling System's addon JSON. It adds places, not games.

## Ranked ideas (for discussion, nothing scheduled)

| Rank | Idea | Why | Effort | Main unknowns |
|---|---|---|---|---|
| 1 | **An XF site that lists the player's own looks and opens the character creator** ("XF Salon"): a Browser Extension site or computer tab exported with XF Eye Artistry | Ties terminals to the current product; reuses the known route into the creator ([photo mode §3](../../knowledge/photo-mode.md#3-opening-confirming-and-leaving-the-character-creator)); text-only output (redscript, `.xl`, icon atlas) | Low to medium | Whether opening the creator from a computer is safe outside the pause menu; thumbnails need an atlas per build |
| 2 | **Virtual Atelier store export** for worn items the Studio authors later (makeup or jewellery as items) | One `AddStore` call per build; players already use Atelier | Low, once worn-item export exists | Depends on the clothing and item export track |
| 3 | **XF phone notifications** (a contact with pre-authored slots rewritten from script) | Friendly in-game confirmation that an XF mod is active, or delivery-style flavour | Low | Slot count; journal authoring tool |
| 4 | **A data-driven XF app runtime** (one versioned redscript mod interpreting exported app definitions, script-built ink) with bridge live preview | Makes terminal apps authorable in the Studio without generating new code per app; basis for TypeScript option E | Medium to high | Interpreter speed; which widgets and events the first version needs |
| 5 | **A new arcade game on vanilla cabinets** | Showpiece for the app runtime; additive by tagging cabinets | High | The menu-entry question; ending the scenario and workspot cleanly; frame budget |
| 6 | **TypeScript authoring** (options A-E in the knowledge page) | The maintainer's scripting idea; D (Studio scripts driving the bridge) is useful for tests right away | Varies | Choice of option is the maintainer's |
| 7 | **XF-branded billboards** through TweakXL advert records | Trivial, cosmetic | Low | Whether it is wanted at all |

The next useful step is a short runtime checklist for the open questions in the [knowledge page](../../knowledge/terminals-and-arcade.md#open-questions) when a session slot is free, starting with whether a journal-only site appears on the home page and whether an appended menu entry opens.

## What the world pass found

- **The world is data the Studio can already open.** One `.streamingworld` lists two streaming blocks (24,132 and 2,186 sector descriptors, Phantom Liberty's copies winning by mount order). Sectors are ordinary CR2W files: node definitions plus 144-byte placement records, which are also the engine's in-memory layout. The native reader read the tables of all 26,318 sectors in 22 s (7.8 million objects, 64,612 distinct meshes). Only the sector's trailing block, the placement records and the instance buffers are left to decode.
- **A location is big.** One Watson point sits inside 251 sectors' streaming boxes (about 248,000 objects). The 83 near sectors alone reference 6,022 meshes (514 MB raw). A viewer needs native mesh decoding, instancing and the game's own level-of-detail structure; WolvenKit launches cannot serve it.
- **Every current location mod is additive** through ArchiveXL: new blocks, soft deletions and mutations of vanilla placements checked by node count and type, device and persistent-state patches, quest phases. World Builder is the common authoring tool; its export is a WolvenKit-JSON intermediate turned into sectors by a WolvenKit script.
- **Overlap is common but mostly benign.** 62 enabled mods in the reference list stream world content; 26 sectors are edited by more than one mod, all agreeing on node counts, and only one node is deleted twice (harmless). The fragile parts are stale node counts after game updates, navigation (no tool authors navmesh) and collision.

## World: phased plan

Nothing here is scheduled; it ranks below V's appearance and body work, and each phase is discussed with the maintainer before it starts.

| Phase | Scope | Effort | Depends on |
|---|---|---|---|
| W0. Sector reader | Native decoding of the sector trailing block, placement records, instance transforms and collision actors, with WolvenKit JSON as the oracle; the block and world root | 2–4 days | Native reader (done) |
| W1. World index | Effective blocks (vanilla plus mods' `.xl` blocks through the existing mount plan), a spatial index of descriptors, mods' deletions and mutations applied the way ArchiveXL applies them, and a per-sector report of which mods touch it | 3–5 days | W0 |
| W2. Offline location viewer | Pick a point or a named place; load levels 0–1 plus proxies; draw static and instanced meshes with resolved materials; show collision, AI spots and deleted nodes as overlays | 2–4 weeks | W1, native mesh decoding (reader phase 4) and textures (phase 3) |
| W3. Mod conflict view | For a sector or area: which mods add, delete or move what, stale `expectedNodes`, same-path `.xl` files | 3–5 days | W1 |
| W4. Authoring additions | Place vanilla props and meshes in the viewer; export a block, sectors and `.xl` (and optionally World Builder's JSON); deletions with re-matching data | 3–6 weeks | W2 |
| W5. Bridge preview | Teleport V, stream a location, spawn previews through Codeware, hide nodes, hot-reload a built block | 1–2 weeks | Runtime bridge phase 2, Red Hot Tools installed |

## World: ranked ideas (for discussion, nothing scheduled)

| Rank | Idea | Why | Effort | Main unknowns |
|---|---|---|---|---|
| 1 | **Offline location viewer** (W0–W2) | First visible step; reuses the native reader, resolver and viewport; lets the maintainer and users look at any place, vanilla or modded, without the game | Medium to high | Mesh decoding speed; how far proxies suffice for the skyline |
| 2 | **World conflict report** (W1 + W3) | Cheap once W1 exists; the reference list already has 26 shared sectors; fits the resolver's "which file wins" role | Low to medium | How to present it plainly for players |
| 3 | **Placing V's looks in context**: character preview inside a chosen vanilla location (the creator backdrop, V's apartment) | Ties the world domain to the current product; lighting from nearby lights and probes | Medium | Environment probes and GI are large; start with lights only |
| 4 | **Prop-based location authoring** exporting sectors and `.xl` (W4) | The community's World Builder workflow is in game only; an offline editor with the same output would be new | High | Collision authoring; navigation cannot be authored |
| 5 | **Removal authoring with re-matching** | Players' removals break on game updates; storing type, name, resource and transform lets the Studio re-find nodes and rewrite `expectedNodes` | Medium | Matching rules when a sector is re-cooked |
| 6 | **Bridge-driven location captures** (W5) | Teleport and stream a place, capture reference images for the viewer's fidelity | Low to medium once the bridge has writes | Streaming waits; quest triggers at the destination |
