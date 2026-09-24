// Theme preference: follows the system by default; Light/Dark are persistent overrides.
// Loaded synchronously in <head> so a stored override applies before first paint.
// Without JavaScript the page still follows prefers-color-scheme and the switch stays hidden.
(() => {
  const KEY = "xf-studio-site:theme";
  const CHROME = { light: "#fcfdff", dark: "#16191c" };
  const root = document.documentElement;
  const read = () => {
    try { const value = localStorage.getItem(KEY); return value === "light" || value === "dark" ? value : "system"; }
    catch { return "system"; }
  };
  const write = choice => {
    try { if (choice === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); }
    catch { /* storage unavailable: the choice lasts for this page only */ }
  };
  const apply = choice => {
    if (choice === "system") delete root.dataset.theme; else root.dataset.theme = choice;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      const media = meta.getAttribute("media") || "";
      meta.setAttribute("content", CHROME[choice === "system" ? (media.includes("dark") ? "dark" : "light") : choice]);
    }
    for (const button of document.querySelectorAll("[data-theme-choice]"))
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
  };
  apply(read());
  document.addEventListener("DOMContentLoaded", () => {
    const group = document.querySelector("[data-theme-switch]");
    if (!group) return;
    apply(read());
    group.hidden = false;
    group.addEventListener("click", event => {
      const button = event.target.closest("[data-theme-choice]");
      if (!button) return;
      const choice = button.dataset.themeChoice;
      write(choice);
      apply(choice);
    });
  });
  addEventListener("storage", event => { if (event.key === KEY) apply(read()); });
})();
