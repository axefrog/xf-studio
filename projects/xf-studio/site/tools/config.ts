/** Shared site configuration. The site is independent of the Studio app: no imports from ../authoring. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const siteRoot = resolve(import.meta.dir, "..");
export const repoRoot = resolve(siteRoot, "../../..");
/** Generated, self-contained Studio design reference published verbatim beside the site. */
export const styleGuideSource = resolve(siteRoot, "../authoring/public/style-guide.html");

export type NavItem = { id: string; label: string; href: string };
export type SiteConfig = {
  siteName: string;
  /** Absolute URL of the published site, with a trailing slash. CI overrides it from actions/configure-pages. */
  baseUrl: string;
  repoUrl: string;
  repoBranch: string;
  author: { name: string; url: string };
  /** ISO date on which the status wording was last checked against docs/status.md. */
  statusReviewed: string;
  /**
   * Drives the hero statement and the #download section (tools/release.ts). "unreleased" (default) links no
   * release; "prerelease" and "released" need `release` and point at that GitHub release. The home page
   * always carries a visible [data-release-status] statement.
   */
  releaseStatus: "unreleased" | "prerelease" | "released";
  /** The published GitHub release, e.g. { "tag": "v0.1.0-alpha.1", "title": "XF Studio 0.1.0 alpha 1" }. */
  release: { tag: string; title: string } | null;
  nav: NavItem[];
  budgets: { totalBytes: number; fileBytes: number; styleGuideBytes: number };
};

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    throw Error(`Site base URL must use https: ${value}`);
  url.search = ""; url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

/** Release tags as produced by the desktop release workflow: v<MAJOR.MINOR.PATCH>[-alpha|beta|rc.N]. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-(alpha|beta|rc)\.[1-9]\d*)?$/;

export function validateRelease(config: Pick<SiteConfig, "releaseStatus" | "release">): void {
  const { releaseStatus: status, release } = config;
  if (!["unreleased", "prerelease", "released"].includes(status)) throw Error(`Unknown releaseStatus "${status}"`);
  if (status === "unreleased") {
    if (release) throw Error("release must be null while releaseStatus is unreleased");
    return;
  }
  const match = release && RELEASE_TAG.exec(release.tag);
  if (!release || !match || !release.title?.trim()) throw Error(`releaseStatus "${status}" needs release.tag (e.g. v0.1.0-alpha.1) and release.title`);
  if ((status === "prerelease") !== !!match[1])
    throw Error(`release.tag ${release.tag} ${match[1] ? "is a pre-release; use releaseStatus prerelease" : "has no pre-release suffix; use releaseStatus released"}`);
}

export function loadConfig(overrides: { baseUrl?: string } & Partial<Pick<SiteConfig, "releaseStatus" | "release">> = {}): SiteConfig {
  const file = JSON.parse(readFileSync(resolve(siteRoot, "site.config.json"), "utf8")) as SiteConfig;
  const config: SiteConfig = { ...file, release: file.release ?? null };
  if (overrides.releaseStatus) { config.releaseStatus = overrides.releaseStatus; config.release = overrides.release ?? null; }
  const baseUrl = overrides.baseUrl || process.env.SITE_BASE_URL || config.baseUrl;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.statusReviewed)) throw Error("statusReviewed must be an ISO date (YYYY-MM-DD)");
  validateRelease(config);
  return { ...config, baseUrl: normalizeBaseUrl(baseUrl), repoUrl: config.repoUrl.replace(/\/+$/, "") };
}

export const basePath = (config: SiteConfig) => new URL(config.baseUrl).pathname;

export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}
