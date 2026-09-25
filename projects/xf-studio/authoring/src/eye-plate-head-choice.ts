/**
 * The Local setup choice of which head Build cuts the eye plate from. Pure and shared: the setting's
 * type (local-settings.ts), the eye plate service's plain messages and the Studio's Game & tools form
 * all name it the same way.
 */
export type EyePlateHead = "installed" | "base-game";
export const EYE_PLATE_HEAD_CHOICES: readonly EyePlateHead[] = ["installed", "base-game"];
export const EYE_PLATE_HEAD_SETTING = {
  label: "Head used for the eye plate",
  options: { installed: "The head your game loads (recommended)", "base-game": "The unmodified game head" },
} as const satisfies { label: string; options: Record<EyePlateHead, string> };
