/**
 * XF Studio's own public pages that the Help view can open. Hosts open only these named pages
 * (the desktop in the person's browser, localhost in a new tab); the view never supplies a URL.
 */
export type ProjectLink = "project-knowledge" | "project-issues" | "project-releases";
export const PROJECT_LINKS: Readonly<Record<ProjectLink, string>> = Object.freeze({
  "project-knowledge": "https://axefrog.github.io/xf-studio/knowledge/",
  "project-issues": "https://github.com/axefrog/xf-studio/issues",
  // Where a newer XF Studio is downloaded (a look made with one opens read-only here).
  "project-releases": "https://github.com/axefrog/xf-studio/releases",
});
export const isProjectLink = (link: unknown): link is ProjectLink =>
  typeof link === "string" && Object.hasOwn(PROJECT_LINKS, link);
