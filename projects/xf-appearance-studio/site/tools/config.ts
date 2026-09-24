/** Shared site configuration. The site is independent of the Studio app: no imports from ../authoring. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const siteRoot = resolve(import.meta.dir, "..");
export const repoRoot = resolve(siteRoot, "../../..");

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
  /** "unreleased" requires the home page to carry a visible [data-release-status] statement. */
  releaseStatus: "unreleased" | "released";
  nav: NavItem[];
  budgets: { totalBytes: number; fileBytes: number };
};

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    throw Error(`Site base URL must use https: ${value}`);
  url.search = ""; url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function loadConfig(overrides: { baseUrl?: string } = {}): SiteConfig {
  const config = JSON.parse(readFileSync(resolve(siteRoot, "site.config.json"), "utf8")) as SiteConfig;
  const baseUrl = overrides.baseUrl || process.env.SITE_BASE_URL || config.baseUrl;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.statusReviewed)) throw Error("statusReviewed must be an ISO date (YYYY-MM-DD)");
  return { ...config, baseUrl: normalizeBaseUrl(baseUrl), repoUrl: config.repoUrl.replace(/\/+$/, "") };
}

export const basePath = (config: SiteConfig) => new URL(config.baseUrl).pathname;

export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}
