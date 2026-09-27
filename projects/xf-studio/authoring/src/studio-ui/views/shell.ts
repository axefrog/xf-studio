/**
 * The shell's own view contribution: the platform's panels (collection and library, History, the 3D
 * head, the character and preview inspectors, Activity, Settings, Help) and the activity sources of the system
 * families (history, collection, camera and preview, motion, quality, saved V, 3D preview setup).
 */
import type { ViewContribution } from "./contribution";

export const SHELL_VIEW = {
  owner: "shell",
  panels: [
    { id: "presets", title: "Presets", icon: "presets", order: 10, slot: "collection",
      description: "Named looks in the current collection; each is one choice in the game selector." },
    { id: "history", title: "History", icon: "history", order: 30, slot: "stack",
      description: "Your recent changes to the current preset; click any step to go back to it." },
    { id: "library", title: "Library", icon: "library", order: 40, slot: "collection", heavy: true,
      description: "Saved versions of your collection, recovery and files." },
    { id: "package", title: "Mod package", icon: "package", order: 50, slot: "collection", heavy: true,
      description: "Check and build your mod files." },
    // The main view's panel keeps the ID `head` so saved layouts restore; its tab is titled from the view graph (viewTitles).
    { id: "head", title: "3D view", icon: "head", order: 60, slot: "stage",
      description: "Your V in 3D, with your makeup, editable on the head." },
    { id: "character", title: "Character", icon: "character", order: 120, slot: "inspect",
      description: "Your V's creator options from your game and mods: change, turn off or reset each, and save presets." },
    { id: "lighting", title: "Camera & light", icon: "lighting", order: 130, slot: "inspect",
      description: "Camera framing, lighting and display." },
    { id: "motion", title: "Motion", icon: "motion", order: 140, slot: "inspect",
      description: "The game's idles and blink." },
    { id: "quality", title: "Preview quality", icon: "quality", order: 150, slot: "inspect",
      description: "Makeup texture size and memory." },
    { id: "activity", title: "Activity", icon: "activity", order: 160, slot: "closed",
      description: "What happened this session: results, warnings and errors." },
    // Settings has no home among the docked groups: summoned, it opens floating, and later where the person last had it (`summonPanel`).
    { id: "settings", title: "Settings", icon: "settings", order: 165, slot: "closed",
      description: "Your game, mod manager, saves, tools, appearance and diagnostics." },
    // Help has no home in a group: summoned, it opens floating over the workspace (dock/layout.ts `summonPanel`).
    { id: "help", title: "Help", icon: "help", order: 170, slot: "closed",
      description: "Guided tours, answers to common questions and every keyboard and mouse shortcut." },
  ],
  activity: [
    { pattern: /^history\.(undo|redo)$/, label: "Undo" }, { pattern: /^history\./, label: "History" },
    { pattern: /^preset\./, label: "Presets" }, { pattern: /^camera\./, label: "Camera" }, { pattern: /^preview\./, label: "Preview" },
    { pattern: /^motion\./, label: "Motion" }, { pattern: /^quality\./, label: "Preview quality" },
    { pattern: /^collection\./, label: "Library" }, { pattern: /^package\./, label: "Mod package" }, { pattern: /^savedV\./, label: "Saved V" }, { pattern: /^character\./, label: "Character" },
    { pattern: /^previewSetup\./, label: "3D preview" }, { pattern: /^setup\./, label: "Settings" },
    { pattern: /^view\.(undo|redo)$/, label: "View and lighting" }, { pattern: /^view\./, label: "View" },
  ],
} as const satisfies ViewContribution;
