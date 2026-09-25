/**
 * XF Studio's own public pages that the Help view can open. Hosts open only these named pages
 * (the desktop in the person's browser, localhost in a new tab); the view never supplies a URL.
 */
export type ProjectLink = "project-knowledge" | "project-issues";
export const PROJECT_LINKS: Readonly<Record<ProjectLink, string>> = Object.freeze({
  "project-knowledge": "https://axefrog.github.io/xf-studio/knowledge/",
  "project-issues": "https://github.com/axefrog/xf-studio/issues",
});
export const isProjectLink = (link: unknown): link is ProjectLink =>
  typeof link === "string" && Object.hasOwn(PROJECT_LINKS, link);
