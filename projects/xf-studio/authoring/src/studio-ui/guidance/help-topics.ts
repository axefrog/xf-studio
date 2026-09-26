import { bindingReference, type ReferenceSection } from "../../input-bindings";
import { EYE_MAKEUP_MOD } from "../../mod-branding";
import { plainText } from "./content";
import { FINISH_EXPORT_TOKEN, withFinishText, type FinishSummary } from "./finish-text";
import type { HelpTopic, Tour } from "./types";

/**
 * Help view content as data: searchable topics, the public links and the keyboard and mouse
 * reference, which is generated from the input binding catalogue and never written by hand.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: "layers", title: "Layers and presets", keywords: "layer stack order preset look collection selector front",
    body: "A **preset** is one complete look; each preset becomes one choice in the game's eye makeup selector. A preset is built from **layers**, which stack like real makeup: the top of the Layers list sits in front.\n\n- Add, duplicate, hide and remove layers from the Layers panel.\n- Drag a row's grip, or use [[key:rows.reorder]], to change the order.\n- [[key:rows.rename]] renames the focused row.",
    tours: ["onboarding"] },
  { id: "drawing", title: "Drawing and shaping", keywords: "draw uv map point curve bezier shape move rotate scale warp soft edge",
    body: "Shape the selected layer on the **UV map** or directly on the head.\n\n- Drag a point to reshape the outline; drag inside the shape to move it.\n- Double-click the outline in the UV map to add a point.\n- Hold **Shift** and drag to rotate the shape, or Shift-wheel to scale it.\n- Esc cancels a drag while you're still holding it.\n\nThe Shape, Pigment & edge and Warp panels hold the finer controls.",
    tours: ["onboarding"] },
  { id: "head", title: "The 3D head view", keywords: "head 3d preview camera orbit zoom pan front view wolvenkit setup",
    body: "The head shows your makeup on V. Drag off the makeup to turn the view, use the wheel to zoom and right-drag to pan; [[key:head.front]] returns to the front view.\n\nThe 3D preview is built from your own Cyberpunk 2077 files the first time. If it isn't ready, the head pane shows the one next step. The UV map, library and Check all work without it." },
  { id: "finishes", title: "Colours and finishes", keywords: "colour color finish matte satin metallic shimmer glossy glitter colour-shift duochrome export preview only",
    body: `Each layer has a colour, an opacity and a finish. ${FINISH_EXPORT_TOKEN}`,
    tours: ["onboarding"] },
  { id: "undo", title: "Undo, Redo and History", keywords: "undo redo history back step mistake",
    body: "Every change can be undone. [[key:shell.undo]] undoes, and [[key:shell.redo]] redoes. The **History** panel lists your recent changes to the current preset; click any step to go back to it.",
    tours: ["whats-new-0.1.0-alpha.1"] },
  { id: "library", title: "Saving and your library", keywords: "save library version autosave draft export import backup share file",
    body: "**Save** ([[key:shell.save]]) keeps your collection in the local library with its earlier versions. Your draft also saves itself between sessions.\n\nTo back up or share looks, export the collection as a file from the Library panel, and import it again on any computer.",
    tours: ["onboarding"] },
  { id: "package", title: "Making your mod: Check and Build", keywords: "mod package check build xf eye artistry archive install game",
    body: `Open **Mod package** when your looks are ready.\n\n- **Check** lists which presets and layers can become mod files, and names anything that would be left out and why. It needs no game files.\n- **Build** makes your own **${EYE_MAKEUP_MOD.modName}** mod files. Nothing goes into your game until you add it: see **Installing your mod**.`,
    tours: ["onboarding"] },
  { id: "install", title: "Installing your mod", keywords: "install add mod manager mo2 mod organizer vortex game folder archive show in folder profile modlist separator",
    body: `After **Build**, each mod in the result has two buttons.\n\n- **Add to my mod manager** shows exactly what would be added and where before anything changes: with Mod Organizer 2, the mod's own folder and one new row in your profile's mod list, at the bottom of the lowest section that doesn't hold frameworks (your separators and every other mod stay where they are). Without Mod Organizer 2, its two files go into the game's archive\\pc\\mod folder. Choose **Add** to go ahead.\n- **Show in folder** opens the built mod, to install it by hand: copy its **archive** folder into your Cyberpunk 2077 folder, or add it to Vortex as a mod.\n\nXF Studio never replaces files it didn't put there, never changes your frameworks or other mods, and waits while Mod Organizer 2 is open (it rewrites its mod list when it closes). Adding a newer build replaces only the files it added before. Your game folder and mod manager are chosen in **Game & tools**, in the Mod package panel.` },
  { id: "character", title: "Your V in the preview", keywords: "save v character brows lashes hair eye shape load",
    body: "Load a save from the **Character** panel and the preview shows that V's own skin, makeup and face details, eyes, brows, lashes, hair, piercings and body, read from your game and mods. Your looks and library are never changed by loading a save.",
    tours: ["whats-new-0.1.0-alpha.1"] },
  { id: "report", title: "Reporting a problem", keywords: "bug error problem report issue github log diagnostics crash reference mod files privacy",
    body: "When something goes wrong, the notice shows a reference such as **XF-7K3Q** and a **Report this problem** button. You can also report from here, or from the command palette.\n\n- The report is prepared for you to review first. Nothing leaves your computer unless you send it.\n- Tick or untick each part. Personal folder names and e-mail addresses are already replaced.\n- **Save report** makes one file to attach to a GitHub issue; **Open a GitHub issue** starts one for you.\n- XF Studio keeps the last half hour of what it worked out (which mod supplied what), so you don't have to make the problem happen again. **Diagnostic mode** keeps more, for a day.\n\nYour mods are identified by name, version and download source, never copied. Reports on GitHub are **public**: only include a mod's own files if you made it, or its permissions allow sharing it." },
  { id: "layout", title: "Panels and layout", keywords: "panel dock float tab layout reset move window",
    body: "Drag a panel's tab to dock it beside another, or onto a floating spot. The **Panels** button in the header opens or closes any panel and resets the layout. [[key:shell.regions]] moves the keyboard focus between regions." },
];

/** The topics with the finish catalogue's words filled in (UI-44); the Help view shows and searches these. */
export function helpTopicsFor(finishes: readonly FinishSummary[]): readonly HelpTopic[] {
  return HELP_TOPICS.map(topic => ({ ...topic, body: withFinishText(topic.body, finishes) }));
}

/** Public pages the Help view links to; the host opens them in the person's browser. */
export const HELP_LINKS = [
  { link: "project-knowledge", label: "How the game works: knowledge pages", detail: "Research notes on the game's files, shaders and character creator." },
  { link: "project-issues", label: "Ask a question or see known problems", detail: "XF Studio's issue tracker on GitHub." },
] as const;

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, query: string) => { const haystack = text.toLowerCase(); return terms(query).every(term => haystack.includes(term)); };

/** Topics whose title, keywords or text contain every search term, title matches first. */
export function searchTopics(query: string, topics: readonly HelpTopic[] = HELP_TOPICS): HelpTopic[] {
  if (!terms(query).length) return [...topics];
  const found = topics.filter(topic => matches(`${topic.title} ${topic.keywords} ${plainText(topic.body)}`, query));
  return found.sort((a, b) => Number(matches(b.title, query)) - Number(matches(a.title, query)));
}
export function searchTours(query: string, tours: readonly Tour[]): Tour[] {
  return tours.filter(tour => matches(`${tour.title} ${tour.summary} ${tour.steps.map(step => step.content.title).join(" ")}`, query));
}
/** The keyboard and mouse reference, filtered by the search; generated from the binding catalogue. */
export function helpReference(query = ""): ReferenceSection[] {
  const sections = bindingReference();
  if (!terms(query).length) return sections;
  // Every row belongs to "Keyboard & mouse", so those words (and "shortcut") narrow nothing on their own.
  return sections.map(section => ({ ...section, rows: section.rows.filter(row =>
    matches(`keyboard mouse shortcuts keys ${section.title} ${row.input} ${row.label} ${row.where ?? ""}`, query)) }))
    .filter(section => section.rows.length);
}
