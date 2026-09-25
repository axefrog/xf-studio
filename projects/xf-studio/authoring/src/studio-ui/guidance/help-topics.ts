import { bindingReference, type ReferenceSection } from "../../input-bindings";
import { EYE_MAKEUP_MOD } from "../../mod-branding";
import { plainText } from "./content";
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
    body: "Each layer has a colour, an opacity and a finish. **Matte**, **Satin** and **Metallic** can go into your mod. **Glossy**, **Shimmer** and **Colour-shifting** can be built as experiments. **Glitter** is preview only for now: Check and Build leave those layers out and say so.",
    tours: ["onboarding"] },
  { id: "undo", title: "Undo, Redo and History", keywords: "undo redo history back step mistake",
    body: "Every change can be undone. [[key:shell.undo]] undoes, and [[key:shell.redo]] redoes. The **History** panel lists your recent changes to the current preset; click any step to go back to it.",
    tours: ["whats-new-0.1.0-alpha.1"] },
  { id: "library", title: "Saving and your library", keywords: "save library version autosave draft export import backup share file",
    body: "**Save** ([[key:shell.save]]) keeps your collection in the local library with its earlier versions. Your draft also saves itself between sessions.\n\nTo back up or share looks, export the collection as a file from the Library panel, and import it again on any computer.",
    tours: ["onboarding"] },
  { id: "package", title: "Making your mod: Check and Build", keywords: "mod package check build xf eye artistry archive install game",
    body: `Open **Mod package** when your looks are ready.\n\n- **Check** lists which presets and layers can become mod files, and names anything that would be left out and why. It needs no game files.\n- **Build** makes your own **${EYE_MAKEUP_MOD.modName}** mod files. Nothing is installed in your game or mod manager for you.`,
    tours: ["onboarding"] },
  { id: "character", title: "Your V in the preview", keywords: "save v character brows lashes hair eye shape load",
    body: "Load a save from the **Character** panel and the preview shows that V's own eyes, brows, lashes and hair, read from your game and mods. Your looks and library are never changed by loading a save.",
    tours: ["whats-new-0.1.0-alpha.1"] },
  { id: "layout", title: "Panels and layout", keywords: "panel dock float tab layout reset move window",
    body: "Drag a panel's tab to dock it beside another, or onto a floating spot. The **Panels** button in the header opens or closes any panel and resets the layout. [[key:shell.regions]] moves the keyboard focus between regions." },
];

/** Public pages the Help view links to; the host opens them in the person's browser. */
export const HELP_LINKS = [
  { link: "project-knowledge", label: "How the game works: knowledge pages", detail: "Research notes on the game's files, shaders and character creator." },
  { link: "project-issues", label: "Report a problem or ask a question", detail: "XF Studio's issue tracker on GitHub." },
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
