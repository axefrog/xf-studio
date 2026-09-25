/**
 * Content scan for the packaged app (REL-01, REL-02). The package inventory checks which files
 * ship; this checks what the text files say. It refuses user-profile paths (Windows
 * `C:\Users\<name>` in any case, drive, slash direction, string escaping or percent-encoding, WSL
 * `/mnt/c/Users/<name>`, macOS `/Users/<name>` and Linux `/home/<name>`) and e-mail addresses, so a
 * build machine's home folder or someone's address can't ship inside an allowed bundle.
 * Placeholders (`<name>`, `%USERNAME%`, `Public`, `Default`…), example domains, role accounts such
 * as an SSH remote's `git@`, versions (`pkg@1.0.0-beta.rc`) and file names (`icon@2x.png`) pass;
 * licence and notice files may carry contact addresses. Findings are redacted, because the release
 * workflow's log is public.
 *
 * The patterns and test vectors are shared with the repository check and the site's privacy check
 * in `tools/private-data.json` at the repository root.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Packaged members whose contents are scanned: text, scripts, styles, markup and metadata. */
export const SCANNED_TEXT = /\.(?:js|mjs|cjs|html?|css|json|md|txt|map|xml|svg|ya?ml|toml|ini|cfg)$/i;

/** Licence and notice files may name authors' addresses; user paths are still refused in them. */
export const LICENCE_TEXT = /(?:^|\/)(?:LICEN[CS]E|COPYING|NOTICE|THIRD_PARTY_NOTICES)[^/]*$/i;

type PatternSpec = { source: string; flags: string };
export type PrivateData = {
  userPaths: (PatternSpec & { id: string })[];
  placeholderUser: PatternSpec;
  email: PatternSpec;
  emailExemptions: { local: PatternSpec; domains: PatternSpec[] };
  vectors: { userPath: string[]; email: string[]; clean: string[] };
};
export const PRIVATE_DATA_FILE = resolve(import.meta.dir, "../../../../tools/private-data.json");
export const PRIVATE_DATA: PrivateData = JSON.parse(readFileSync(PRIVATE_DATA_FILE, "utf8"));

const regex = (spec: PatternSpec, global = false) => new RegExp(spec.source, spec.flags + (global ? "g" : ""));
const USER_PATHS = PRIVATE_DATA.userPaths.map(spec => regex(spec, true));
const PLACEHOLDER_USER = regex(PRIVATE_DATA.placeholderUser);
const EMAIL = regex(PRIVATE_DATA.email, true);
const ROLE_LOCAL = regex(PRIVATE_DATA.emailExemptions.local);
const NOT_ADDRESS_DOMAINS = PRIVATE_DATA.emailExemptions.domains.map(spec => regex(spec));

export type ContentIssue = { member: string; line: number; kind: "user-path" | "email"; sample: string };

/** Keeps the first character of the personal part, so a public log never repeats it. */
function redact(match: string, personal: string, at: number) {
  const masked = `${personal.slice(0, 1)}${"*".repeat(Math.max(3, personal.length - 1))}`;
  return match.slice(0, at) + masked + match.slice(at + personal.length);
}

/** Every personal path or address in one packaged text member. */
export function contentIssues(member: string, text: string): ContentIssue[] {
  const found: (ContentIssue & { start: number; end: number })[] = [];
  const lineAt = (index: number) => text.slice(0, index).split("\n").length;
  const add = (kind: ContentIssue["kind"], match: RegExpMatchArray, personal: string) => {
    const start = match.index!, end = start + match[0].length;
    // One path is reported once, even when a second pattern also sees it.
    if (found.some(issue => start < issue.end && issue.start < end)) return;
    const at = kind === "email" ? 0 : match[0].length - personal.length;
    found.push({ member, line: lineAt(start), kind, sample: redact(match[0], personal, at), start, end });
  };
  for (const pattern of USER_PATHS)
    for (const match of text.matchAll(pattern))
      if (!PLACEHOLDER_USER.test(match[1]!)) add("user-path", match, match[1]!);
  if (!LICENCE_TEXT.test(member)) {
    for (const match of text.matchAll(EMAIL)) {
      const [, local, domain] = match as unknown as [string, string, string];
      if (ROLE_LOCAL.test(local) || NOT_ADDRESS_DOMAINS.some(rule => rule.test(domain))) continue;
      add("email", match, local);
    }
  }
  return found.sort((a, b) => a.start - b.start).map(({ start: _start, end: _end, ...issue }) => issue);
}

/** Plain report lines for a failed scan. */
export function describeContentIssues(issues: ContentIssue[]): string[] {
  return issues.map(issue => `${issue.member}:${issue.line}: ${issue.kind === "user-path" ? "absolute user path" : "email address"} ${issue.sample}`);
}
