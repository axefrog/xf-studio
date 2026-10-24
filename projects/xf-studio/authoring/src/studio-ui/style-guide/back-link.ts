/** The guide's default link goes to the site; Studio-opened tabs can instead return to their opener. */
export function bindGuideBackLink(back: HTMLAnchorElement, page: Window = window): void {
  const opener = page.opener;
  if (!opener || !["localhost", "127.0.0.1", "[::1]"].includes(page.location.hostname) || new URLSearchParams(page.location.search).get("from") !== "studio") return;
  const controller = new AbortController();
  page.addEventListener("pagehide", () => controller.abort(), { once: true, signal: controller.signal });
  page.addEventListener("message", event => {
    if (event.source !== opener || event.origin !== page.location.origin || event.data !== "xfs/guide-return") return;
    controller.abort();
    page.opener = null;
    back.querySelector("span")!.textContent = "Back to XF Studio";
    back.title = "Close this guide and return to XF Studio";
    back.addEventListener("click", event => { event.preventDefault(); page.close(); });
  }, { signal: controller.signal });
  // No answer (a direct/bookmarked visit or an unrelated opener) leaves the ordinary site link intact.
  try { opener.postMessage("xfs/guide-ready", page.location.origin); }
  catch { controller.abort(); }
}
