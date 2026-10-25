import { EYE_MAKEUP_MOD } from "../../legacy/eye-makeup/mod-branding";
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

/** The walk from nothing to an eye makeup mod added to the game: two looks, Check, Build, add it, and what to look for in the game. */
export const EYE_TOUR_ID = "first-eye-mod";
/** What the eye tour's "Do it for me" makes: contributed starter shapes (`features/eye-makeup/starters.ts`), a colour and a finish for each look. */
export const EYE_TOUR_LOOKS = {
  first: { starter: "lid-wash", color: "#a8576b", finish: "regular" },
  second: { starter: "classic-wing", color: "#2c3a5e", finish: "metallic" },
} as const;

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
        body: "Your work saves itself to the local library as you go, so closing the app never loses it. **Save version** ([[key:shell.save]]) keeps a version of your collection there, beside its earlier versions, that you can go back to." } },
      { anchor: "header.package", content: { title: "Make your mod",
        body: "When your looks are ready, open **Mod package**.\n\n- **Check** lists which looks can become mod files, and names anything that would be left out and why. It needs no game files.\n- **Build** makes the mod files. **Add to my mod manager** adds them to your game when you choose to." },
        buttons: [{ label: "Open Mod package", action: { kind: "panel", panel: "package" } }] },
      { anchor: "header.help", content: { title: "Help is always here",
        body: "Open **Help** with [[key:shell.help]] for tours, answers and every keyboard and mouse shortcut. [[key:shell.palette]] finds any command by name.\n\n**Your first eye makeup mod**, in Help's Guided tours, takes you from two looks to a mod in your game." } },
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
    id: EYE_TOUR_ID, audience: "howto", title: "Your first eye makeup mod",
    summary: "Make two eye makeup looks, build them into a mod and add it to your game, ready to try in the character creator.",
    keywords: "first mod eye makeup make looks check build install add mod manager character creator walkthrough how to",
    steps: [
      // Only this one shows in a window that can't make changes (another window holds the workspace).
      { id: "read-only", when: { writable: false }, content: { title: "This window can't make changes",
        body: "XF Studio is open in another window, so this one is read-only. This tour makes looks and a mod, so it needs the window that can make changes.\n\nUse that window, or choose **Use it here** at the top of this window to work here instead, then start the tour again from Help." } },
      { id: "intro", when: { writable: true }, content: { title: "Your first eye makeup mod",
        body: `In a few minutes you'll make **two eye makeup looks**, build them into your own **${EYE_MAKEUP_MOD.modName}** mod and add it to your game, ready to try in the character creator.\n\nWhere a step is fiddly, **Do it for me** does it for you, and you can undo it like anything else. The two looks are added to the collection you have open; nothing you already made is changed.` } },
      { id: "first-look-add", when: { writable: true }, anchor: "presets.add", content: { title: "First look: add a preset",
        body: "A **preset** is one complete look, and each one becomes a choice in the game. **Add preset** starts it with a layer shaped like the **Lid wash** starter shape: a soft wash over the eyelid.\n\nPress **Add preset**, or let me do it." },
        buttons: [{ label: "Do it for me", then: "next", action: { kind: "sequence", steps: [
          { kind: "studio", action: { kind: "preset.edit", command: { kind: "add" } } },
          { kind: "studio.resetActiveLayer", starter: EYE_TOUR_LOOKS.first.starter }] } }],
        advanceWhen: { event: "preset.added" } },
      { id: "first-look-style", when: { writable: true }, anchor: "panel.finish", content: { title: "First look: colour and finish",
        body: `Choose the layer's colour, then its finish. ${FINISH_MOD_TOKEN}. A rose colour with the Satin finish suits a first look.` },
        buttons: [{ label: "Do it for me", then: "next", action: { kind: "sequence", steps: [
          { kind: "studio.activeLayer", action: { kind: "layer.setColor", color: EYE_TOUR_LOOKS.first.color } },
          { kind: "studio.activeLayer", action: { kind: "layer.setFinish", finish: EYE_TOUR_LOOKS.first.finish } }] } }],
        advanceWhen: { event: "finish.changed" } },
      { id: "second-look-add", when: { writable: true }, anchor: "presets.add", content: { title: "Second look: add another preset",
        body: "Add a second preset for a different look. It starts with the same Lid wash layer; the next step adds a second layer to it." },
        buttons: [{ label: "Do it for me", then: "next", action: { kind: "studio", action: { kind: "preset.edit", command: { kind: "add" } } } }],
        advanceWhen: { event: "preset.added" } },
      { id: "second-look-shape", when: { writable: true }, anchor: "layers.starters", content: { title: "Second look: a different starter shape",
        body: "A look can have several layers, like real makeup: a wash on the lid with a liner on top. Open the arrow beside **Add layer** and choose **Classic wing**, a clean liner with a flick past the outer corner.\n\nThe other starter shapes are in the same menu." },
        buttons: [{ label: "Do it for me", then: "next", action: { kind: "studio", action: { kind: "layer.edit", command: { kind: "add", starter: EYE_TOUR_LOOKS.second.starter } } } }],
        advanceWhen: { event: "layer.added" } },
      { id: "second-look-style", when: { writable: true }, anchor: "panel.finish", content: { title: "Second look: colour and finish",
        body: "Give the new layer its own colour and finish. A deep blue with the Metallic finish stands well apart from the first look." },
        buttons: [{ label: "Do it for me", then: "next", action: { kind: "sequence", steps: [
          { kind: "studio.activeLayer", action: { kind: "layer.setColor", color: EYE_TOUR_LOOKS.second.color } },
          { kind: "studio.activeLayer", action: { kind: "layer.setFinish", finish: EYE_TOUR_LOOKS.second.finish } }] } }],
        advanceWhen: { event: "finish.changed" } },
      { id: "check", when: { writable: true }, anchor: "package.check", content: { title: "Check your looks",
        body: "Open **Mod package** and press **Check**. It lists which looks can become mod files, and names anything it would leave out and why.\n\nCheck creates no files and changes nothing." },
        buttons: [{ label: "Check for me", action: { kind: "file", action: { kind: "package.check" } } }],
        advanceWhen: { event: "package.checked" } },
      // Until the game and mod manager are set up, the Package steps point at the setup card's one next step; the tour carries on when it's done.
      { id: "setup", when: { writable: true, setup: "needs" }, anchor: "package.setup", content: { title: "One thing first: your game and mod manager",
        body: "XF Studio needs to know where your game and mod manager are before it can build your mod. The **Game** card here says the one thing to do next, with a button where it can.\n\n**Settings › Game** holds the rest. Once the card says it's ready, this tour carries on by itself." },
        buttons: [{ label: "Open Settings › Game", action: { kind: "settings", section: "game" } }] },
      { id: "build", when: { writable: true, setup: "ready" }, anchor: "package.build", content: { title: "Build your mod",
        body: "Press **Build mod files** and confirm. Building can take a minute or two, and you can stop it with **Stop** beside the progress.\n\nNothing goes into your game yet: Build only makes the mod files." },
        advanceWhen: { event: "package.built" } },
      { id: "install", when: { writable: true, setup: "ready", built: true }, anchor: "package.install", content: { title: "Add it to your game",
        body: `Press **Add to my mod manager**. It shows exactly what will be added and where before anything changes. If you install mods by hand, **Show in folder** opens the built mod instead.\n\nEither way only the **${EYE_MAKEUP_MOD.modName}** mod is added: your other mods and frameworks are never changed.` },
        advanceWhen: { event: "mod.installed" } },
      { id: "in-game", when: { writable: true }, content: { title: "What to check in the game",
        body: `Start the game (through Mod Organizer 2, if you use it) and open the character creator.\n\n- Among the head options, near the eye makeup, there's a new row labelled **${EYE_MAKEUP_MOD.selectorLabel}**. The mod itself is called ${EYE_MAKEUP_MOD.modName}.\n- Its choices are **Off** and your two looks, named as in your Presets list.\n- Choose each look and check the eyes show the colour, shape and finish you made.\n\nIf the row isn't there: [[help:install|Installing your mod]] in Help.\n\nThe masculine V row is not yet game-tested.` } },
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
