# Holotable glyphs, and playback speed

## Playback speed and stepping

A week of game time is 168 hours, so watching it unfold needs speed, and following a story needs a way to stop where something happens. Recordings, live replay and layers-only sets get the same controls:

- **Speed** is a button set (the library's Segmented, compact) right after Play, with the options shown at once. Recordings and live replay: `1×`, `4×` (default), `16×`. Game-clock sets: `1×`, `1 min/s`, `10 min/s` (default), `1 h/s`, in game time per real second, so a week takes about 17 minutes at 10 min/s and about 3 minutes at 1 h/s. The choice is remembered per tab.
- **Previous change and next change** are two small quiet icon buttons right after the speed set (tooltips: "Previous change" and "Next change"). They jump to the previous or next moment when any visible layer's item appears, changes or is retracted, and pause. Hidden layers don't count.
- Items appear, change and retract as playback passes their times, the same projection as scrubbing. During playback a "since last frame" pulse (a 300 ms ring on markers that just appeared or changed) shows where things are happening. Retractions fade over the same 300 ms.
- At narrow widths the controls stay on one line: the readout ellipsises first, then the view presets collapse to the current one with a menu.

---

# Holotable glyphs

**Status:** design, 27 October 2026. Markers should say what they are at a glance: a view where everything looks like a pin is navigation half-blind. Producers still never draw. Instead, each item may name a **glyph**, a semantic category from the closed vocabulary below. Holotable maps it to an icon, and draws every glyph the same way in every surface (the Studio view now, the in-game overlay later).

## The field

`glyph?: "<name>"` on any item, and `badge?: "<name>"` for a state shown in the marker's corner.
- An unknown name is never refused. The item draws with its kind's default marker, and the layer row counts "N unknown glyphs" (tooltip: the names). A producer can therefore send a glyph before Holotable knows it.
- Glyphs carry no story text, so they're kept at the `structure` content level. That's what makes them useful with story content hidden.

## How a glyph is drawn

A round plate, 18 px across: the stage colour, stroked with the item's tone, with the glyph's 16 px icon inside at 12 px, stroked with the tone. A `badge` is a 6 px dot or mark at the plate's upper right. Selected, the plate grows to 22 px and takes the selection ring. Kinds keep their own geometry: a zone still draws its outline, a path its line, and the glyph sits at their label point. The plate is what reads over the solid shapes and the grid, in both themes.

## The vocabulary (version 1)

The icons come from the Studio's icon set (`studio-ui/icons.ts`: original 16 px line icons, path data). That makes the same definitions drawable on the Studio canvas and, later, in the overlay. The glyphs below that the set doesn't have yet are requested from the UI track. Until each exists, it falls back to its family's icon, shown in parentheses.

| Family (fallback) | Glyphs |
|---|---|
| **People** (`person`) | `person`, `fixer`, `merchant`, `collector`, `police`, `medic`, `courier`, `gang-member`, `gang-leader`, `netrunner`, `civilian` |
| **Groups** (`group`) | `group`, `gang`, `corp`, `crowd` |
| **Events** (`event`) | `theft`, `assault`, `clash`, `shakedown`, `police-action`, `cyberpsychosis`, `disorder`, `accident`, `outage`, `trade`, `rumour`, `warning`, `confrontation`, `death` |
| **Story** (`story`) | `story`, `juncture`, `scene` (an intended scene), `thread` |
| **Direction** (`direction`) | `sown`, `held`, `refused` |
| **Places** (`place`) | `place`, `refuge`, `hideout`, `market`, `clinic`, `crackdown`, `festival`, `hazard` |
| **Things** (`item`) | `item`, `vehicle`, `weapon`, `data`, `money` |
| **Diagnostics** (`diagnostic`) | `waypoint`, `control-point`, `sensor`, `goal`, `note`, `probe` |

**Badges:** `ready`, `pending`, `matched`, `blocked`, `done`, `new`. Story pattern families (tension, turn, closure, shape) aren't glyphs: they go in a facet and the label, where they're readable.

## Design rules for the icons (for the UI track)

- One family reads as a family: the people share a head-and-shoulders base with a distinguishing mark, the events an impact shape, the places a ground line.
- Each icon must be recognisable at 12 px inside the plate, in one stroke colour, light and dark.
- They're original, like the rest of the set, and drawn to its 16 px grid and stroke weight.
- No gore or real-world insignia (police is a badge shape, not any real force's emblem).
