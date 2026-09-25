import type { IconName } from "./icons";
import type { StudioPanelId } from "./layout-defaults";

/** Single source for panel titles, icons and purposes (app, menus, palette and style guide). */
export const PANEL_META: Record<StudioPanelId, { title: string; icon: IconName; description: string }> = {
  presets: { title: "Presets", icon: "presets", description: "Named looks in the current collection; each is one choice in the game selector." },
  layers: { title: "Layers", icon: "layers", description: "The current preset's layer stack, front first." },
  history: { title: "History", icon: "history", description: "Your recent changes to the current preset; click any step to go back to it." },
  library: { title: "Library", icon: "library", description: "Local library revisions, recovery and portable files." },
  package: { title: "Mod package", icon: "package", description: "Check and build private local mod candidates." },
  head: { title: "Head", icon: "head", description: "Live 3D preview on V's head with on-surface editing." },
  uv: { title: "UV map", icon: "uv", description: "Flat editor for the same contour, handles and warps in texture space." },
  finish: { title: "Colour & finish", icon: "finish", description: "Pigment colour, opacity and finish of the selected layer." },
  shape: { title: "Shape", icon: "shape", description: "Contour points, Bézier handles and mirroring for the selected layer." },
  edge: { title: "Pigment & edge", icon: "edge", description: "Point pigment strength and edge softness, independent of each other." },
  warp: { title: "Warp", icon: "warp", description: "Smooth displacement fields that bend the selected layer's mask." },
  character: { title: "Character", icon: "character", description: "V from your save, eye shape and preview-only details." },
  lighting: { title: "Camera & light", icon: "lighting", description: "Field of view, framing, exposure, key light and display studies." },
  motion: { title: "Motion", icon: "motion", description: "Game close-up idle and the synthetic eyelid study." },
  quality: { title: "Preview quality", icon: "quality", description: "Resolution of generated preview textures, readiness and resource use." },
  help: { title: "Help", icon: "help", description: "Guided tours, answers to common questions and every keyboard and mouse shortcut." },
  activity: { title: "Activity", icon: "activity", description: "Session log of results, warnings and errors." },
};
