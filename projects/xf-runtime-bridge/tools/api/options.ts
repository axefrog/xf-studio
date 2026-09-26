// game.options.read's plain summary: the handful of settings a capture's look depends on, taken from
// the raw user settings the bridge reads (groups and names from the game's own settings definition,
// r6/config/settings/platform/pc/options.json, 2.31). Values stay the game's own option texts
// ("DLAA", "High", "SDR" ...); nothing is guessed when a setting is missing.

export type SettingValue = { type: string; value?: unknown; index?: number };
export type SettingsGroups = Record<string, Record<string, SettingValue> | null | undefined>;

/** The resolution-scaling rows whose value is that upscaler's mode (DLAA is a DLSS mode). */
const UPSCALER_ROWS = ["DLSS", "FSR4", "FSR3", "FSR2", "XESS"] as const;

export type OptionsSummary = {
  upscaler: unknown;
  upscaler_mode: unknown;
  frame_generation: unknown;
  ray_tracing: unknown;
  ray_traced_lighting: unknown;
  path_tracing: unknown;
  path_tracing_photo_mode: unknown;
  sss_quality: unknown;
  hdr: unknown;
  camera_effects: Record<string, unknown>;
};

export function summarizeSettings(groups: SettingsGroups | undefined): OptionsSummary {
  const value = (group: string, name: string): unknown => {
    const entry = groups?.[group]?.[name];
    return entry && "value" in entry ? entry.value : null;
  };
  const scaling = value("/graphics/presets", "ResolutionScaling");
  const row = typeof scaling === "string" ? UPSCALER_ROWS.find((name) => scaling.toUpperCase().replace(/\s/g, "").includes(name)) : undefined;
  const basic = "/graphics/basic";
  return {
    upscaler: scaling,
    upscaler_mode: row ? value("/graphics/presets", row) : null,
    frame_generation: value("/graphics/presets", "FrameGeneration"),
    ray_tracing: value("/graphics/raytracing", "RayTracing"),
    ray_traced_lighting: value("/graphics/raytracing", "RayTracedLighting"),
    path_tracing: value("/graphics/raytracing", "RayTracedPathTracing"),
    path_tracing_photo_mode: value("/graphics/raytracing", "RayTracedPathTracingForPhotoMode"),
    sss_quality: value("/graphics/advanced", "SubsurfaceScatteringQuality"),
    hdr: value("/video/display", "HDRModes"),
    camera_effects: {
      film_grain: value(basic, "FilmGrain"),
      chromatic_aberration: value(basic, "ChromaticAberration"),
      depth_of_field: value(basic, "DepthOfField"),
      lens_flares: value(basic, "LensFlares"),
      motion_blur: value(basic, "MotionBlur"),
      vignette: value(basic, "Vignette"),
    },
  };
}
