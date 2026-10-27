# Holotable glyphs, and playback speed

## Playback speed and stepping

A week of game time is 168 hours, so watching it unfold needs speed, and following a story needs a way to stop where something happens. Recordings, live replay and layers-only sets get the same controls:

- **Speed** is a button set (the library's Segmented, compact) right after Play, with the options shown at once. Recordings and live replay: `1×`, `4×` (default), `16×`. Game-clock sets: `1×`, `1 min/s`, `10 min/s` (default), `1 h/s`, in game time per real second, so a week takes about 17 minutes at 10 min/s and about 3 minutes at 1 h/s. The choice is remembered per clock family in one experiment-owned workspace document (`holotable-view-state/playback`), shared by all views of the same playback clock. Following live is always 1× and disables speed changes; pausing or scrubbing restores the replay choice, and Back to live resumes following.
- **Previous change and next change** are two small quiet icon buttons right after the speed set (tooltips: "Previous change ([)" and "Next change (])"). Their registered actions are `holo.change.previous` (`[`) and `holo.change.next` (`]`), scoped to the focused Holotable view. They jump to the previous or next moment when any visible layer's item appears, changes or is retracted, and pause. Hidden layers don't count.
- **Layer scope** is shared, temporary playback state. A layer row's target menu offers "Step through this layer" (`holo.change.scope`, with the layer ID; null clears). While set, the step buttons name the layer and skip every other layer's changes. Mixed-case muted note text and a compact library close icon button sit after the step buttons; its tooltip is "Stepping through Stories only. Clear to step through all visible layers" and the clear button is named "Stop stepping through Stories only". The approved `scopeChip(title, onClear)` composition uses layout-only CSS and is one swap when the UI track supplies the dismissible chip. Hiding or removing the layer, hiding its producer, or opening another set clears scope. It is not persisted.
- Items appear, change and retract as playback passes their times, the same projection as scrubbing. During playback a "since last frame" pulse (a 300 ms ring on markers that just appeared or changed) shows where things are happening. Retractions fade over the same 300 ms.
- At narrow widths the readout ellipsises first, then the stepping-scope chip title ellipsises (keeping about six characters); before that minimum is squeezed, the view presets collapse to the current one with a menu. Then speed collapses to one compact current-speed button. That button opens the library menu with all speeds visible and the current one checked, using the same mutually exclusive checked-action pattern as view presets. A click applies and closes immediately, with no confirmation step or duplicated heading; its accessible label names the setting (for example, "Playback speed: 10 min/s") and `aria-haspopup="menu"`. Play and both step buttons remain visible. A ResizeObserver measures the bar itself, with 16 px expansion hysteresis. Below about 220 px it may wrap to two lines.

---

# Holotable glyphs

**Status:** implemented in the playback candidate, 27 October 2026; independent code and UI review remain with the coordinator. Markers should say what they are at a glance: a view where everything looks like a pin is navigation half-blind. Producers still never draw. Instead, each item may name a **glyph**, a semantic category from the closed vocabulary below. Holotable maps it to an icon, and draws every glyph the same way in every surface (the Studio view now, the in-game overlay later).

## View navigation and world demand

Left-drag orbits, right-drag and middle-drag pan with any modifiers, the wheel zooms, and a left click picks. The view suppresses the browser context menu; an unmoved right press does nothing. Panning grabs the ground plane at the target's height: the press point stays under the cursor. Its world-XY offset belongs to this view's Orbit, persists as the centre follows V, and resets on a preset or fit on open. A pan cannot move the target farther than one orbit distance outside the full world/set extent (including its corners). Without a world pack, the observed recording span supplies the known extent. The cursor is `grabbing` during pan. No keyboard pan is bound; Shift+arrows is not assigned.

Each visible view holds an AbortSignal-owned world-context lease. The service debounces target changes per view for 250 ms; a newer pan immediately cancels that view's pending request, while other views keep theirs. Ordinary following refreshes after the target travels 150 m. `world.around` honours explicit centres for recordings, standalone sets and live watches. Identical region reads share one in-flight job; the existing sector owner deduplicates overlapping sector reads and disk cache hits. The service retains a unique union of at most 12,000 solids, selected round-robin across ready leases so distant views have fair shares. Each view independently selects its existing roughly 900 size-ranked visible solids within its own 350 m extent. Hiding or disposing a view releases its lease, cancels its work and drops geometry only it wanted; remaining views can reclaim its quota from the source cache. Live source updates refresh geometry only through active world-view leases; Details-only polling cannot fetch or restore solids after the final lease ends. The legacy headless cached-live route starts demand only when explicitly requested, shared by watch and ended by its latest request AbortSignal or a 2 s idle timeout. No producer, tool or Story Engine caller requires always-on prefetch. This read-demand API carries no camera or pan state into the service.

Synthetic pan coverage is in `holotable-pan.test.ts` and `holotable-context.test.ts`: the ground-grab invariant is within 0.5 px for every preset at 300/460/850 px, with clamp, fit/preset reset, follow-offset, debounce, independent cancellation, shared reads, release and union-cap cases. Headless tests cover explicit recording/live centres, and `sector-cache.test.ts` proves one shared decode and persistent reuse. The browser fixture checks real right/middle handlers under all 16 modifier combinations, inert right presses, context-menu suppression, preset reset and refetch around the panned target.

## The field

`glyph?: "<name>"` on any item, and `badge?: "<name>"` for a state shown in the marker's corner. Both names are lowercase slugs (`[a-z0-9-]`), at most 40 characters, validated identically by CLI, spool and service.
- An unknown name is never refused. The item draws with its kind's default marker, and the layer row counts "N unknown glyphs" (tooltip: the names). A producer can therefore send a glyph before Holotable knows it.
- Glyphs carry no story text, so they're kept at the `structure` content level. That's what makes them useful with story content hidden.

## How a glyph is drawn

A round plate, 18 px across: the existing flat stage token `--pv-ground`, stroked with the item's tone, with the glyph's 16 px icon inside at 12 px, stroked with the tone. A `badge` is a 6 px dot or mark at the plate's upper right. Badge colours use semantic state tones: ready/done good (`--success`), pending muted, matched/new accent, blocked warning. Selected, the plate grows to 22 px and takes the selection ring. Kinds keep their own geometry: a zone still draws its outline, a path its line, and the glyph sits at their label point. The plate is what reads over the solid shapes and the grid, in both themes.

## The vocabulary (version 1)

The icons come from the Studio's icon set (`studio-ui/icons.ts`: original 16 px line icons, path data). That makes the same definitions drawable on the Studio canvas and, later, in the overlay. The glyphs below that the set doesn't have yet are requested from the UI track. Until each exists, it falls back to its family's icon, shown in parentheses. None of the family icons is present yet. When neither icon exists, the plate encloses the kind's default marker scaled to fit. Known names without icons are not unknown glyphs. The single mapping table is `features/holotable/view/glyphs.ts`; new icon definitions are picked up without renderer changes. The two step buttons use the `dot` placeholder from one constant until the UI track supplies their icons.

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


## Implementation and verification

The headless layer projection supplies a story-free, sorted `changes` history for the chosen branch and a publication `version` on each item. It preserves timestamp-first, spool-order-second revision resolution, including same-time tombstones and untimed records. It includes appearance, replacement, effective expiry and retraction; a superseded expiry and a retraction of an absent item do not introduce false stops. The Studio binary-searches each visible history, includes both timeline ends, and pauses on a jump. Histories are reused until a spool appends, the clock mapping/span changes, or the branch changes.

The renderer retains the world data of animated items and uses the same geometry interpreter for normal drawing and retired fades. Camera following reprojects rings, fade geometry and labels each frame without restarting their 300 ms age. Navigation continuity uses the view's explicit discontinuity epoch rather than camera coordinates; pause and reduced motion also clear effects. Snapshot admission is lazy: full answers without a changed-item index compare publication versions in resumable slices of at most 256 revision/removal candidates within the existing draw deadline. New answers coalesce behind the current preparation so frequent updates cannot starve it. No 5,000-item visual allocation or revision diff occurs at admission. A separate rotating queue visits at most 256 effects and draws within a 1 ms overlay slice; agent layers still precede solids inside the existing 8 ms steady/12 ms cold allowance. Saturated frames need not show every effect. Theme tokens are resolved once per invalidation, never per marker or animation frame.

Ordinary labels are culled against neighbouring glyph plates as well as other labels; their own plate is exempt. The selected item's name always shows and takes precedence over hover, ordinary labels and plate obstacles. A conservative 8 px screen-space occupancy index is built inside the marker's budgeted draw slice, so dense plates do not add a plate scan per label.

Item Detail and event Said values preserve line breaks with `white-space: pre-line`, while long lines still wrap. Other properties retain their existing rendering.

Synthetic coverage: `holotable-playback.test.ts`, `holotable-agent-canvas.test.ts`, `holotable-live.test.ts` and headless `layers.test.ts`. The injected-clock tests cover half-time and expiry, reduced motion, navigation discontinuities, moving-camera pulse/fade projection, lazy 5,000-revision preparation and removal bounds, deadline admission, coalescing and retraction geometry. Live module actions use the same action registry as system families and disappear with their registration generation; captured facades hold a registration lifetime token and refuse after withdrawal or replacement, including off/on cycles that reuse the service instance.

`bun projects/xf-holotable/tools/capture-playback.ts` owns a headless browser and an ephemeral loopback server; it requires `?verify=1` and uses synthetic items only. Ignored evidence is under `local/holotable/evidence/playback/`: recording/game clock × light/dark × 300/460/850 px panels, beside the library patterns, plus all speed choices at 300 px, a 150 ms pulse frame, a half-time retraction fade, a panned view, and a second selected item at 300 px in both themes. The browser check verifies no horizontal overflow, a single control line at both narrow sizes, the collapsed button label, marked menu choices, immediate speed application, the scope chip and clear action, row target-menu routing, Detail/Said line breaks and focused stepping in both directions. These are offline UI checks, not game evidence or an independent design PASS. No game session is needed for this slice.
