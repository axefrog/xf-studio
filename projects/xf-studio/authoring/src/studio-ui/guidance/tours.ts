import { FINISH_EXPORT_TOKEN, FINISH_MOD_TOKEN, withFinishText, type FinishSummary } from "./finish-text";
import type { Tour } from "./types";

/**
 * Built-in tours. Plain data: each step names an anchor, its text and optional "Do it for me"
 * buttons that dispatch ordinary typed actions. `tests/guidance.test.ts` checks every anchor,
 * command and key token against the registries.
 */
export const ONBOARDING_TOUR_ID = "onboarding";
/** The tour of the Studio's other stable parts: your V, Camera & light, and Settings. */
export const STUDIO_TOUR_ID = "your-v-and-view";
/** This version's "What's new" tour: one per release, replaced when the next one ships. */
export const WHATS_NEW_TOUR_ID = "whats-new-0.1.0-beta.1";

export const TOURS: readonly Tour[] = [
  {
    id: ONBOARDING_TOUR_ID, audience: "onboarding", title: "Getting started",
    summary: "A two-minute look at layers, drawing, the 3D view, colour and finish, your library and making the mod.",
    steps: [
      { anchor: "layers.add", content: { title: "Looks are made of layers",
        body: "Each layer is one shape of makeup with its own colour and finish. Layers stack like real makeup: the top of the list sits in front.\n\nStart by adding a layer, or use one that's already there." },
        buttons: [{ label: "Add a layer for me", action: { kind: "studio", action: { kind: "layer.edit", command: { kind: "add" } } } }],
        advanceWhen: { event: "layer.added" } },
      { anchor: "uv.canvas", placement: "auto", content: { title: "Draw on the UV map",
        body: "This flat map is where you shape the selected layer.\n\n- Drag a point to reshape it; drag inside the shape to move it.\n- Double-click the outline to add a point.\n- Hold **Shift** and drag to rotate, or Shift-wheel to scale.\n- The wheel zooms and right-drag pans. [[key:uv.fit]] fits the shape.\n\nTry moving a point. [[key:shell.undo]] takes any change back." },
        advanceWhen: { event: "recipe.edited" } },
      { anchor: "head.view", content: { title: "See it on V's head",
        body: "Your changes appear on the 3D head as you work. Drag to turn the view, use the wheel to zoom and right-drag to pan. [[key:head.front]] returns to the front view.\n\nIf the 3D view isn't set up yet, this pane shows the one next step. The UV map works without it." },
        buttons: [{ label: "Show the front view", action: { kind: "studio", action: { kind: "camera.front" } } }] },
      { anchor: "finish.picker", content: { title: "Choose a colour and a finish",
        body: `Pick the layer's colour, then its finish. ${FINISH_MOD_TOKEN}; the picker groups the others by how far they can go.` },
        buttons: [{ label: "Try Metallic", action: { kind: "studio.activeLayer", action: { kind: "layer.setFinish", finish: "metallic" } } }],
        advanceWhen: { any: [{ event: "finish.changed" }, { event: "color.changed" }] } },
      { anchor: "presets.list", content: { title: "Presets are complete looks",
        body: "A preset is one finished look. Each preset becomes one choice in the game's eye makeup selector, so a collection of presets is the set of looks you'll pick from in the character creator." } },
      { anchor: "header.save", content: { title: "Keep your work in the library",
        body: "**Save** ([[key:shell.save]]) keeps your collection in the local library, with its earlier versions. Your draft also saves itself between sessions, so closing the app never loses work." } },
      { anchor: "header.package", content: { title: "Make your mod",
        body: "When your looks are ready, open **Mod package**.\n\n- **Check** lists which looks can become mod files, and names anything that would be left out and why. It needs no game files.\n- **Build** makes the mod files. **Add to my mod manager** adds them to your game when you choose to." },
        buttons: [{ label: "Open Mod package", action: { kind: "panel", panel: "package" } }] },
      { anchor: "header.help", content: { title: "Help is always here",
        body: "Open **Help** with [[key:shell.help]] for tours, answers and every keyboard and mouse shortcut. [[key:shell.palette]] finds any command by name." } },
    ],
  },
  {
    id: STUDIO_TOUR_ID, audience: "howto", title: "Your V, camera and settings",
    summary: "Where your V's creator options, the camera and lights, and your game and mod manager settings live.",
    steps: [
      { anchor: "panel.character", content: { title: "Your V",
        body: "The **Character** panel holds your V's character-creator options, read from your game and mods.\n\n- Load a save to see your own V.\n- Change any option to try your looks on another face, and save a set of options as a preset.\n\nNone of this changes your looks or your save." },
        buttons: [{ label: "Load V from a save…", action: { kind: "file", action: { kind: "savedV.import" } } }] },
      { anchor: "panel.lighting", content: { title: "Camera & light",
        body: "**Camera & light** frames the view and lights your V. Choose a lighting setup, such as **Character creator** to compare with the game, or make your own and aim its lights with the direction dial.\n\nCamera and light never change your looks or your mod." },
        buttons: [{ label: "Use creator lighting", action: { kind: "studio", action: { kind: "preview.selectLightingSetup", setup: "creator" } } }] },
      { anchor: "header.settings", content: { title: "Your game and mod manager",
        body: "**Settings** holds what XF Studio needs to know about your computer: your game folder, your mod manager, your saves and WolvenKit. XF Studio finds these for you; change one here if it guessed wrong." },
        buttons: [{ label: "Open Settings", action: { kind: "panel", panel: "settings" } }] },
      { anchor: "header.help", content: { title: "Help is always here",
        body: "Open **Help** with [[key:shell.help]] for the other tours, answers for each part of the Studio, and **What's not in this version yet**." } },
    ],
  },
  {
    // The beta's tour (release-readiness-audit.md items 21 and 23): what changed since 0.1.0-alpha.2, in the order a person meets it.
    id: WHATS_NEW_TOUR_ID, audience: "whats-new", version: "0.1.0-beta.1", title: "What's new in the beta",
    summary: "Finishes that go into your mod first, presets that start ready, a masculine V, and where to report a problem.",
    steps: [
      { anchor: "finish.picker", content: { title: "Finishes that go into your mod",
        body: `The finish picker now shows the finishes that go into your mod first. ${FINISH_EXPORT_TOKEN}` },
        buttons: [{ label: "Try Metallic", action: { kind: "studio.activeLayer", action: { kind: "layer.setFinish", finish: "metallic" } } }] },
      { anchor: "presets.list", content: { title: "New presets start ready",
        body: "**Add preset** now starts with a layer, like your first preset, so there's something to shape straight away. **Save as new collection** gives the copy its own name, and the Library panel lists your **Recent drafts** to bring any of them back." } },
      { anchor: "header.package", content: { title: "For a masculine V too",
        body: "**Build** makes your mod for a feminine and a masculine V: the masculine character creator gets its own row with the same looks. The masculine row hasn't been tried in the game yet; **What's not in this version yet** in Help lists what's still to check." },
        buttons: [{ label: "Open Mod package", action: { kind: "panel", panel: "package" } }] },
      { anchor: "header.help", content: { title: "Tell us what doesn't work",
        body: "This is a beta, and your reports make it work on more setups. **Report a problem…** in Help prepares a report you review first; nothing is sent by itself. XF Studio tells you when a newer version is out; **Check for updates** in Help looks now.\n\nEvery tour, including this one, is in **Help** ([[key:shell.help]])." } },
    ],
  },
];

export const tourById = (id: string) => TOURS.find(tour => tour.id === id);

/** The tours with the finish catalogue's words filled in (UI-44); the runner shows these. */
export function toursFor(finishes: readonly FinishSummary[]): readonly Tour[] {
  return TOURS.map(tour => ({ ...tour, steps: tour.steps.map(step => ({ ...step, content: { ...step.content, body: withFinishText(step.content.body, finishes) } })) }));
}
