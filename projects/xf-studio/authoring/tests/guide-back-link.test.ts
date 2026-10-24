import { expect, test } from "bun:test";
import { openProjectLinkInNewTab } from "../src/app/browser/project-links-device";
import { bindGuideBackLink } from "../src/studio-ui/style-guide/back-link";

class Page extends EventTarget {
  location: URL;
  opener: Page | null = null;
  opened: Page | null = null;
  closed = false;
  messages: { data: unknown; origin: string }[] = [];
  constructor(url: string) { super(); this.location = new URL(url); }
  open(url: string) { this.opened = new Page(new URL(url, this.location).href); this.opened.opener = this; return this.opened; }
  close() { this.closed = true; }
  postMessage(data: unknown, origin: string) { this.messages.push({ data, origin }); }
  receive(data: unknown, source: Page, origin = source.location.origin) {
    this.dispatchEvent(Object.assign(new Event("message"), { data, source, origin }));
  }
  window() { return this as unknown as Window; }
}
class BackLink extends EventTarget {
  label = { textContent: "XF Studio site" };
  title = "";
  querySelector() { return this.label; }
  click() { const event = new Event("click", { cancelable: true }); this.dispatchEvent(event); return event.defaultPrevented; }
  anchor() { return this as unknown as HTMLAnchorElement; }
}

test("only the tab the Studio opened can complete the same-origin handshake and close to return", () => {
  const studio = new Page("http://127.0.0.1:4349/?verify=1");
  openProjectLinkInNewTab("project-style-guide", studio.window());
  const guide = studio.opened!, back = new BackLink();
  bindGuideBackLink(back.anchor(), guide.window());
  expect(back.label.textContent).toBe("XF Studio site");
  expect(studio.messages).toHaveLength(1);
  // A different tab or origin cannot get a reply from this tab's opener.
  const stranger = new Page(guide.location.href);
  studio.receive(studio.messages[0]!.data, stranger);
  studio.receive(studio.messages[0]!.data, guide, "https://example.com");
  expect(guide.messages).toHaveLength(0);
  studio.receive(studio.messages[0]!.data, guide);
  expect(guide.messages).toHaveLength(1);
  guide.receive(guide.messages[0]!.data, stranger);
  guide.receive(guide.messages[0]!.data, studio, "https://example.com");
  expect(back.label.textContent).toBe("XF Studio site");
  guide.receive(guide.messages[0]!.data, studio);
  expect(back.label.textContent).toBe("Back to XF Studio");
  expect(back.title).toBe("Close this guide and return to XF Studio");
  expect(guide.opener).toBeNull();
  expect(back.click()).toBe(true);
  expect(guide.closed).toBe(true);
  expect(studio.closed).toBe(false);
});

test("direct and bookmarked guide URLs keep the site link, even with from=studio or an unrelated same-origin opener", () => {
  for (const url of ["http://127.0.0.1:4349/style-guide.html", "http://127.0.0.1:4349/style-guide.html?from=studio", "https://axefrog.github.io/xf-studio/style-guide.html?from=studio"]) {
    for (const opener of [null, new Page("http://127.0.0.1:4349/")]) {
      const guide = new Page(url), back = new BackLink();
      guide.opener = opener;
      bindGuideBackLink(back.anchor(), guide.window());
      expect(back.label.textContent).toBe("XF Studio site");
      expect(back.click()).toBe(false);
      expect(guide.closed).toBe(false);
    }
  }
});

test("other project links clear their opener as before", () => {
  const studio = new Page("http://127.0.0.1:4349/?verify=1");
  openProjectLinkInNewTab("project-knowledge", studio.window());
  expect(studio.opened!.opener).toBeNull();
});
