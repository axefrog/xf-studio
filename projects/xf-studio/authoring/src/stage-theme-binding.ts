import { effectiveTheme, type ThemePreference } from "./ui-preferences";
import type { StageTheme } from "./stage-backdrop";

/** The OS colour-scheme query, reduced to what the binding needs (a MediaQueryList in the browser). */
export type SystemColourScheme = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};

/**
 * Feeds the resolved UI theme (the stored preference, or the OS scheme when it is "system") to the
 * renderer's typed stage input. Calls `setStage` once at bind time and then only when the resolved
 * theme changes. Returns the unbind function.
 */
export function bindStageTheme(
  target: { setStage(theme: StageTheme): void },
  preferences: { snapshot(): { readonly theme: ThemePreference }; subscribe(listener: () => void): () => void },
  system: SystemColourScheme,
): () => void {
  let applied: StageTheme | undefined;
  const apply = () => {
    const theme = effectiveTheme(preferences.snapshot().theme, system.matches);
    if (theme === applied) return;
    applied = theme;
    target.setStage(theme);
  };
  const unsubscribe = preferences.subscribe(apply);
  system.addEventListener("change", apply);
  apply();
  return () => { unsubscribe(); system.removeEventListener("change", apply); };
}
