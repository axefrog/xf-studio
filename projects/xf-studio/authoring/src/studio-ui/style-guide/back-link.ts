/** The guide's default link goes to the site; Studio-opened tabs can instead return to their opener. */
export const XF_STUDIO_SITE = "https://axefrog.github.io/xf-studio/";

export function bindGuideBackLink(back: HTMLAnchorElement, page: Window = window): void {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(page.location.hostname);
  // On the published site "./" is the site's front page; a localhost copy's "./" would be the Studio app itself.
  if (local) back.href = XF_STUDIO_SITE;
  const opener = page.opener;
  if (!opener || !local || new URLSearchParams(page.location.search).get("from") !== "studio") return;
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
