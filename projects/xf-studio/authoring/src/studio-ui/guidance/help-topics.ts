import { bindingReference, type ReferenceSection } from "../../input-bindings";
import { EYE_MAKEUP_MOD } from "../../mod-branding";
import { plainText } from "./content";
import { FINISH_EXPORT_TOKEN, withFinishText, type FinishSummary } from "./finish-text";
import { WHATS_NEW_TOUR_ID } from "./tours";
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
  { id: "head", title: "The 3D view", keywords: "head 3d preview camera orbit zoom pan front view wolvenkit setup",
    body: "The head shows your makeup on V. Drag off the makeup to turn the view, use the wheel to zoom and right-drag to pan; [[key:head.front]] returns to the front view.\n\nThe 3D view is built from your own Cyberpunk 2077 files the first time. If it isn't ready, the head pane shows the one next step. The UV map, library and Check all work without it." },
  { id: "finishes", title: "Colours and finishes", keywords: "colour color finish matte satin metallic shimmer glossy glitter colour-shift duochrome export preview only",
    body: `Each layer has a colour, an opacity and a finish. ${FINISH_EXPORT_TOKEN}`,
    tours: ["onboarding", WHATS_NEW_TOUR_ID] },
  { id: "undo", title: "Undo, Redo and History", keywords: "undo redo history back step mistake",
    body: "Every change can be undone. [[key:shell.undo]] undoes, and [[key:shell.redo]] redoes. The **History** panel lists your recent changes to the current preset; click any step to go back to it." },
  { id: "library", title: "Saving and your library", keywords: "save library version autosave draft export import backup share file",
    body: "**Save** ([[key:shell.save]]) keeps your collection in the local library with its earlier versions. Your draft also saves itself between sessions.\n\nOpening another collection keeps the draft you had open under **Recent drafts** in the Library panel, where **Recover** brings it back.\n\nTo back up or share looks, export the collection as a file from the Library panel, and import it again on any computer.",
    tours: ["onboarding", WHATS_NEW_TOUR_ID] },
  { id: "package", title: "Making your mod: Check and Build", keywords: "mod package check build xf eye artistry archive install game",
    body: `Open **Mod package** when your looks are ready.\n\n- **Check** lists which presets and layers can become mod files, and names anything that would be left out and why. It needs no game files.\n- **Build** makes your own **${EYE_MAKEUP_MOD.modName}** mod files. Nothing goes into your game until you add it: see **Installing your mod**.`,
    tours: ["onboarding"] },
  { id: "install", title: "Installing your mod", keywords: "install add mod manager mo2 mod organizer vortex game folder archive show in folder profile modlist separator",
    body: `After **Build**, each mod in the result has two buttons.\n\n- **Add to my mod manager** shows exactly what would be added and where before anything changes: with Mod Organizer 2, the mod's own folder and one new row in your profile's mod list, at the bottom of the lowest section that doesn't hold frameworks (your separators and every other mod stay where they are). Without Mod Organizer 2, its files go into the game folder: archive\\pc\\mod, and r6\\tweaks for a mod that has TweakXL files. Choose **Add** to go ahead.\n- **Show in folder** opens the built mod, to install it by hand: copy its **archive** folder (and its **r6** folder, when it has one) into your Cyberpunk 2077 folder, or add it to Vortex as a mod.\n\nXF Studio never replaces files it didn't put there, never changes your frameworks or other mods, and waits while Mod Organizer 2 is open (it rewrites its mod list when it closes). Adding a newer build replaces only the files it added before. Your game folder and mod manager are chosen in **Settings › Game** (the Settings button at the top right).` },
  { id: "settings", title: "Settings: your game, saves and tools", keywords: "settings preferences options configure where game folder mod manager mo2 mod organizer vortex profile saves folder saved games save explorer wolvenkit theme appearance diagnostics privacy",
    tours: ["your-v-and-view"],
    body: "Everything XF Studio needs to know about your computer is in **Settings**: the Settings button at the top right, or type “Settings” in the command palette ([[key:shell.palette]]).\n\n- **Game**: your Cyberpunk 2077 folder and how you install mods (Mod Organizer 2 and its profile, or Vortex and the game folder). XF Studio finds these for you.\n- **Saves**: where your saves are. XF Studio uses the game's own folder, Saved Games\\CD Projekt Red\\Cyberpunk 2077; choose another if you keep them somewhere else.\n- **Tools**: WolvenKit, which XF Studio sets up for you.\n- **Appearance**, and **Privacy & diagnostics**.\n\nEach choice is saved on this computer as you make it." },
  { id: "character", title: "Your V in the 3D view", keywords: "save v character brows lashes hair eye shape load",
    body: "Load a save from the **Character** panel and the 3D view shows that V's own skin, makeup and face details, eyes, brows, lashes, hair, piercings and body, read from your game and mods. Your looks and library are never changed by loading a save.\n\nYou can change any creator option there too, to check your looks on another face, and save a set of options as a preset to use again. None of this changes the save itself.",
    tours: ["your-v-and-view"] },
  { id: "camera", title: "Camera & light", keywords: "camera light lighting setup creator studio exposure backdrop grade field of view front view whole body lens direction dial",
    body: "**Camera & light** frames the 3D view and lights your V.\n\n- **Camera**: the front view ([[key:head.front]]), the whole body, the character creator's own face and hair cameras, and the field of view.\n- **Light**: choose a lighting setup. **Character creator** uses the game's own creator lights, to compare with what you see in the game. Make a new setup to change its lights, their colour and their direction on the dial.\n\nCamera and light are saved with your workspace. They never change your looks or your mod.",
    tours: ["your-v-and-view"] },
  { id: "report", title: "Reporting a problem", keywords: "bug error problem report issue github log diagnostics crash reference mod files privacy",
    body: "When something goes wrong, the notice shows a reference such as **XF-7K3Q** and a **Report this problem** button. You can also report from here, or from the command palette.\n\n- The report is prepared for you to review first. Nothing leaves your computer unless you send it.\n- Include each part or turn it off. Personal folder names and e-mail addresses are already replaced.\n- **Save report** makes one file to attach to a GitHub issue; **Open a GitHub issue** starts one for you.\n- XF Studio keeps the last half hour of what it worked out (which mod supplied what), so you don't have to make the problem happen again. **Diagnostic mode** keeps more, for a day.\n\nYour mods are identified by name, version and download source, never copied. Reports on GitHub are **public**: only include a mod's own files if you made it, or its permissions allow sharing it.",
    tours: [WHATS_NEW_TOUR_ID] },
  // The changelog's Known limitations for this version, for the people using it (projects/xf-studio/CHANGELOG.md): update both together.
  { id: "limitations", title: "What's not in this version yet", keywords: "limitations known problems missing not yet later version beta tried masculine male finish shimmer glitter research tools glossy colour-shifting mask helmet face blink expressions photo mode clothes mods updates releases windows warning signed smartscreen run anyway report",
    body: `This is a beta: what it doesn't do yet, and what hasn't been tried in the game.\n\n**In your mod**\n\n- **A masculine V: not tried in the game yet.** Build makes ${EYE_MAKEUP_MOD.modName} for both a feminine and a masculine V, but the masculine character creator's XF row hasn't been seen in the game yet.\n- **Shimmer and Glitter are waiting for a check in the game.** Both were reworked after they didn't look right in the game (Shimmer showed as glossy vinyl), and the new versions haven't been tried in the game yet. Until they pass, the finish picker offers them only with **Show research tools** on; a layer that already uses one keeps it, and Glitter isn't built into your mod.\n- **Some finishes are still experiments.** Glossy doesn't look different from Satin yet. A Colour-shifting look holds only one Colour-shifting layer. **Colours and finishes** says which finishes go into your mod.\n- **Full-face masks: not tried in the game yet.** An item that hides V's whole head should hide the makeup with it. An ordinary helmet covers the makeup, as it covers the game's own.\n- **Expression sets are checked by Build but not tried in photo mode yet.**\n\nIf something doesn't work in the game, use **Report a problem…** at the bottom of Help.\n\n**In the 3D view**\n\n- **Finishes look closer to each other in the game.** Under the character creator's soft light they barely separate; the 3D view shows them further apart.\n- **Face movement: not checked against the game yet.** The idle's face, the blink and the live face in Expressions come from your game's own facial setup, but may not match the game exactly.\n- **Clothes from mods aren't drawn.** The 3D view dresses V in the game's own clothes from your save; clothes that mods add aren't shown yet.\n\n**Installing and updating**\n\n- **No automatic updates.** **Check for updates** in Help opens the **Releases** page on GitHub, where new versions are published. Export your looks before installing one.\n- **Windows may warn before the setup runs,** because the app isn't signed yet. Choose **More info**, then **Run anyway**.` },
  { id: "layout", title: "Panels and layout", keywords: "panel dock float tab layout reset move window",
    body: "Drag a panel's tab to dock it beside another, or onto a floating spot. The **Panels** button in the header opens or closes any panel and resets the layout. [[key:shell.regions]] moves the keyboard focus between regions." },
];

/** The topics with the finish catalogue's words filled in (UI-44); the Help view shows and searches these. */
export function helpTopicsFor(finishes: readonly FinishSummary[]): readonly HelpTopic[] {
  return HELP_TOPICS.map(topic => ({ ...topic, body: withFinishText(topic.body, finishes) }));
}

/** Public pages the Help view links to; the host opens them in the person's browser. */
export const HELP_LINKS = [
  // A way to learn about updates (release-readiness-audit.md item 22): XF Studio never checks by itself.
  { link: "project-releases", label: "Check for updates", detail: "Opens the XF Studio releases page on GitHub, where each new version is published." },
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
