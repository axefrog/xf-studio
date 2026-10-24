import { LOCAL_PROJECT_PAGES, PROJECT_LINKS, type ProjectLink } from "../project-links";

/** Localhost opens its own guide; other project pages open on their public sites. */
export function openProjectLinkInNewTab(link: ProjectLink, page: Window = window): void {
  const opened = page.open(LOCAL_PROJECT_PAGES[link] ?? PROJECT_LINKS[link], "_blank");
  if (!opened) throw Error("Your browser blocked the new tab. Allow pop-ups for XF Studio, then try again.");
  if (link !== "project-style-guide") { opened.opener = null; return; }
  // A copied/bookmarked URL is no authority to close a tab: answer only the guide this call opened, on our own origin.
  const controller = new AbortController();
  page.addEventListener("pagehide", () => controller.abort(), { once: true, signal: controller.signal });
  page.addEventListener("message", event => {
    if (event.source !== opened || event.origin !== page.location.origin || event.data !== "xfs/guide-ready") return;
    opened.postMessage("xfs/guide-return", page.location.origin);
    controller.abort();
  }, { signal: controller.signal });
}
