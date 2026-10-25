import { FRAMEWORK_LINK_URLS, type FrameworkLinkId } from "../installation/framework-catalogue";

/**
 * XF Studio's own public pages that the Help view can open, and the official release pages of the frameworks the Settings check names
 * (ArchiveXL on Nexus Mods and GitHub, and so on; their URLs live with the framework catalogue). Hosts open only these named pages
 * (the desktop in the person's browser, localhost in a new tab); the view never supplies a URL.
 */
export type ProjectLink = "project-knowledge" | "project-issues" | "project-releases" | "project-style-guide" | FrameworkLinkId;
export const PROJECT_LINKS: Readonly<Record<ProjectLink, string>> = Object.freeze({
  "project-knowledge": "https://axefrog.github.io/xf-studio/knowledge/",
  "project-issues": "https://github.com/axefrog/xf-studio/issues",
  // Where a newer XF Studio is downloaded (a look made with one opens read-only here).
  "project-releases": "https://github.com/axefrog/xf-studio/releases",
  // The interface guide (the style guide), as published with the site; localhost opens its own copy (LOCAL_PROJECT_PAGES).
  "project-style-guide": "https://axefrog.github.io/xf-studio/style-guide.html",
  ...FRAMEWORK_LINK_URLS,
});
/**
 * Pages the localhost server serves itself, so a developer's Help opens the guide of the build that runs, not the published one. The
 * desktop app doesn't ship them: it opens the published page.
 */
export const LOCAL_PROJECT_PAGES: Readonly<Partial<Record<ProjectLink, string>>> = Object.freeze({ "project-style-guide": "style-guide.html?from=studio" });
export const isProjectLink = (link: unknown): link is ProjectLink =>
  typeof link === "string" && Object.hasOwn(PROJECT_LINKS, link);
