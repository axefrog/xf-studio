import type { Tour } from "./types";

/**
 * Built-in tours. Plain data: each step names an anchor, its text and optional "Do it for me"
 * buttons that dispatch ordinary typed actions. `tests/guidance.test.ts` checks every anchor,
 * command and key token against the registries.
 */
export const ONBOARDING_TOUR_ID = "onboarding";

export const TOURS: readonly Tour[] = [
  {
    id: ONBOARDING_TOUR_ID, audience: "onboarding", title: "Getting started",
    summary: "A two-minute look at layers, drawing, the head view, colour and finish, your library and making the mod.",
    steps: [
      { anchor: "layers.add", content: { title: "Looks are made of layers",
        body: "Each layer is one shape of makeup with its own colour and finish. Layers stack like real makeup: the top of the list sits in front.\n\nStart by adding a layer, or use one that's already there." },
        buttons: [{ label: "Add a layer for me", action: { kind: "studio", action: { kind: "layer.edit", command: { kind: "add" } } } }],
        advanceWhen: { event: "layer.added" } },
      { anchor: "uv.canvas", placement: "auto", content: { title: "Draw on the UV map",
        body: "This flat map is where you shape the selected layer.\n\n- Drag a point to reshape it; drag inside the shape to move it.\n- Double-click the outline to add a point.\n- Hold **Shift** and drag to rotate, or Shift-wheel to scale.\n- The wheel zooms and right-drag pans. [[key:uv.fit]] fits the shape.\n\nTry moving a point. [[key:shell.undo]] takes any change back." },
        advanceWhen: { event: "recipe.edited" } },
      { anchor: "head.view", content: { title: "See it on V's head",
        body: "Your changes appear on the 3D head as you work. Drag to turn the view, use the wheel to zoom and right-drag to pan. [[key:head.front]] returns to the front view.\n\nIf the 3D preview isn't set up yet, this pane shows the one next step. The UV map works without it." },
        buttons: [{ label: "Show the front view", action: { kind: "studio", action: { kind: "camera.front" } } }] },
      { anchor: "finish.picker", content: { title: "Choose a colour and a finish",
        body: "Pick the layer's colour, then its finish: Matte, Satin, Metallic and more. The picker groups finishes by what can go into your mod today; preview-only finishes are marked." },
        buttons: [{ label: "Try Metallic", action: { kind: "studio.activeLayer", action: { kind: "layer.setFinish", finish: "metallic" } } }],
        advanceWhen: { any: [{ event: "finish.changed" }, { event: "color.changed" }] } },
      { anchor: "presets.list", content: { title: "Presets are complete looks",
        body: "A preset is one finished look. Each preset becomes one choice in the game's eye makeup selector, so a collection of presets is the set of looks you'll pick from in the character creator." } },
      { anchor: "header.save", content: { title: "Keep your work in the library",
        body: "**Save** ([[key:shell.save]]) keeps your collection in the local library, with its earlier versions. Your draft also saves itself between sessions, so closing the app never loses work." } },
      { anchor: "header.package", content: { title: "Make your mod",
        body: "When your looks are ready, open **Mod package**.\n\n- **Check** lists which looks can become mod files, and names anything that would be left out and why. It needs no game files.\n- **Build** makes the mod files. Nothing is installed in your game for you." },
        buttons: [{ label: "Open Mod package", action: { kind: "panel", panel: "package" } }] },
      { anchor: "header.help", content: { title: "Help is always here",
        body: "Open **Help** with [[key:shell.help]] for tours, answers and every keyboard and mouse shortcut. [[key:shell.palette]] finds any command by name." } },
    ],
  },
  {
    id: "whats-new-0.1.0-alpha.1", audience: "whats-new", version: "0.1.0-alpha.1", title: "What's new in 0.1.0-alpha.1",
    summary: "The History panel, your V's own brows, lashes and hair, and the character-creator lighting added since.",
    steps: [
      { anchor: "history.list", content: { title: "Every change, listed",
        body: "The **History** panel lists your recent changes to this preset. Click any step to go back to it, or a dimmed step to go forward again. [[key:shell.undo]] and [[key:shell.redo]] still work as usual." } },
      { anchor: "panel.character", content: { title: "Your V's brows, lashes and hair",
        body: "Load a save and the 3D preview shows that V's own eyebrows, eyelashes and hair, read from your game and mods the way the game picks them. Without a save you see the character creator's default V." },
        buttons: [{ label: "Load V from a save…", action: { kind: "file", action: { kind: "savedV.import" } } }] },
      { anchor: "panel.lighting", content: { title: "Character-creator lighting",
        body: "New since this version: under **Camera & light**, choose **Character creator** lighting to see your V under the game's own creator lights, to compare with what you see in the game. Switch back to **Studio** at any time." },
        buttons: [{ label: "Use creator lighting", action: { kind: "studio", action: { kind: "preview.setLightingPreset", preset: "creator" } } }] },
      { anchor: "header.help", content: { title: "Replay tours any time",
        body: "Every tour, including this one, is in **Help** ([[key:shell.help]])." } },
    ],
  },
];

export const tourById = (id: string) => TOURS.find(tour => tour.id === id);
