/**
 * The groups of the Settings panel (UI-109), in order: what "open Settings › Saves" names. Data only, so a feature's or module's view can
 * ask the shell to open a group without loading the panel.
 */
export const SETTINGS_SECTIONS = ["game", "saves", "tools", "appearance", "updates", "privacy"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export const SETTINGS_SECTION_TITLES: Readonly<Record<SettingsSection, string>> = {
  game: "Game", saves: "Saves", tools: "Tools", appearance: "Appearance", updates: "Updates", privacy: "Privacy & diagnostics" };
/** The Settings panel's catalogue ID (the shell's view contribution, `views/shell.ts`). */
export const SETTINGS_PANEL = "settings";
