# World, terminals, arcade and scripting: research queue

Requests of 26 September 2026. These are research items for later domains. They rank **below** getting the rest of V's appearance and body into the Studio (backlog track 2 and the standing direction's body and clothing steps), so they run as research only when a slot is free, and nothing here is built before it is discussed with the maintainer.

| # | Item | Starting points | Status |
|---|---|---|---|
| 1 | **Contributing to computer terminals** | Installed mods Browser Extension, Virtual Atelier, Virtual Atelier Delivery, Virtual Car Dealer and High Resolution Garment Preview; the game's terminal and in-game browser UI | **First pass done** (source and mod study, no game session): [terminals and arcade](../../knowledge/terminals-and-arcade.md) §2-7 |
| 2 | **Arcade machines** | The in-world arcade cabinets and their built-in games; Urmland Street Arcade | **First pass done** (source and resource study): [terminals and arcade](../../knowledge/terminals-and-arcade.md) §8 |
| 3 | **World, locations and assets** | The MO2 profile's "World" section, World Builder first, then the other mods there; the game's streaming sectors and world resources | Not started. Urmland Street Arcade is a small worked example (a streaming block, a devices patch and node deletions) |
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
