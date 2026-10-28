import type { AnchorInfo } from "../../../../studio-ui/guidance/anchors";

export const MAKEUP_ANCHORS: readonly (AnchorInfo & { order: number })[] = [
  { id: "layers.add", panel: "layers", label: "Add layer", order: 8 },
  { id: "layers.list", panel: "layers", label: "Layer list", order: 9 },
  { id: "layers.starters", panel: "layers", label: "Starter shapes", order: 10 },
  { id: "uv.canvas", panel: "uv", label: "UV map", order: 11 },
  { id: "finish.color", panel: "finish", label: "Colour", order: 13 },
  { id: "finish.picker", panel: "finish", label: "Finish picker", order: 14 },
  { id: "presets.list", panel: "presets", label: "Preset list", order: 15 },
  { id: "presets.add", panel: "presets", label: "Add preset", order: 16 },
];
