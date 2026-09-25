/**
 * The shell's own view contribution: the platform's panels (collection and library, History, the 3D
 * head, the character and preview inspectors, Activity, Help) and the activity sources of the system
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
      description: "Local library revisions, recovery and portable files." },
    { id: "package", title: "Mod package", icon: "package", order: 50, slot: "collection", heavy: true,
      description: "Check and build private local mod candidates." },
    { id: "head", title: "Head", icon: "head", order: 60, slot: "stage",
      description: "Live 3D preview on V's head with on-surface editing." },
    { id: "character", title: "Character", icon: "character", order: 120, slot: "inspect",
      description: "V from your save, eye shape and preview-only details." },
    { id: "lighting", title: "Camera & light", icon: "lighting", order: 130, slot: "inspect",
      description: "Field of view, framing, exposure, key light and display studies." },
    { id: "motion", title: "Motion", icon: "motion", order: 140, slot: "inspect",
      description: "Game close-up idle and the synthetic eyelid study." },
    { id: "quality", title: "Preview quality", icon: "quality", order: 150, slot: "inspect",
      description: "Resolution of generated preview textures, readiness and resource use." },
    { id: "activity", title: "Activity", icon: "activity", order: 160, slot: "closed",
      description: "Session log of results, warnings and errors." },
    // Help reads beside the inspectors rather than covering the head or the collection.
    { id: "help", title: "Help", icon: "help", order: 170, slot: "closed", opensBeside: ["finish", "layers"],
      description: "Guided tours, answers to common questions and every keyboard and mouse shortcut." },
  ],
  activity: [
    { pattern: /^history\.(undo|redo)$/, label: "Undo" }, { pattern: /^history\./, label: "History" },
    { pattern: /^preset\./, label: "Presets" }, { pattern: /^camera\./, label: "Camera" }, { pattern: /^preview\./, label: "Preview" },
    { pattern: /^motion\./, label: "Motion" }, { pattern: /^quality\./, label: "Preview quality" },
    { pattern: /^collection\./, label: "Library" }, { pattern: /^savedV\./, label: "Saved V" },
    { pattern: /^previewSetup\./, label: "3D preview" },
  ],
} as const satisfies ViewContribution;
