/**
 * Content scan for the packaged app (REL-01). The package inventory checks which files ship; this
 * checks what the text files say. It refuses absolute Windows user-profile paths
 * (`C:\Users\<name>`, in any drive letter, slash direction or string escaping) and email-like
 * strings, so a build machine's home folder or someone's address can't ship inside an allowed
 * bundle. Obvious placeholders (`<name>`, `%USERNAME%`, `Public`, `Default`…) and example domains
 * pass; licence and notice files may carry contact addresses. Findings are redacted, because the
 * release workflow's log is public.
 */

/** Packaged members whose contents are scanned: text, scripts, styles, markup and metadata. */
export const SCANNED_TEXT = /\.(?:js|mjs|cjs|html?|css|json|md|txt|map|xml|svg|ya?ml|toml|ini|cfg)$/i;

/** Licence and notice files may name authors' addresses; user paths are still refused in them. */
export const LICENCE_TEXT = /(?:^|\/)(?:LICEN[CS]E|COPYING|NOTICE|THIRD_PARTY_NOTICES)[^/]*$/i;

/** A drive-letter user profile: `C:\Users\name`, `C:/Users/name`, `C:\\Users\\name`, `C:\/Users\/name`. */
const USER_PATH = /\b[A-Za-z]:(?:\\{1,2}|\/|\\\/)+Users(?:\\{1,2}|\/|\\\/)+(<[^<>\s]{1,40}>|%[A-Za-z_]{1,40}%|\$\{?[A-Za-z_]{1,40}\}?|\{[A-Za-z_]{1,40}\}|[A-Za-z0-9][^\\/"'`\s<>:*?|,;()[\]{}]*)/g;
/** Profile folders that belong to no one, and conventional placeholders. */
const PLACEHOLDER_USER = /^(?:<[^<>]*>|%[A-Za-z_]+%|\$\{?[A-Za-z_]+\}?|\{[A-Za-z_]+\}|public|default|default user|all users|defaultapppool|username|user|user ?name|your ?name|yourname|you|name|someone|example|me)$/i;

const EMAIL = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,63})@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b/g;
/** Domains reserved for documentation and tests (RFC 2606/6761). */
const EXAMPLE_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;
/** File names with a density suffix, e.g. `icon@2x.png`, are not addresses. */
const FILE_LIKE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|js|mjs|cjs|ts|css|json|html?|md|map|wasm|glb|dds|xbm)$/i;

export type ContentIssue = { member: string; line: number; kind: "user-path" | "email"; sample: string };

/** Keeps the first character of the personal part, so a public log never repeats it. */
function redact(kind: ContentIssue["kind"], match: string, personal: string) {
  const masked = `${personal.slice(0, 1)}${"*".repeat(Math.max(3, personal.length - 1))}`;
  return kind === "user-path" ? match.slice(0, match.length - personal.length) + masked
    : `${masked}@${match.slice(match.indexOf("@") + 1)}`;
}

/** Every personal path or address in one packaged text member. */
export function contentIssues(member: string, text: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const lineAt = (index: number) => text.slice(0, index).split("\n").length;
  for (const match of text.matchAll(USER_PATH)) {
    const name = match[1]!;
    if (PLACEHOLDER_USER.test(name)) continue;
    issues.push({ member, line: lineAt(match.index!), kind: "user-path", sample: redact("user-path", match[0], name) });
  }
  if (!LICENCE_TEXT.test(member)) {
    for (const match of text.matchAll(EMAIL)) {
      const [local, domain] = [match[0].slice(0, match[0].indexOf("@")), match[0].slice(match[0].indexOf("@") + 1)];
      if (EXAMPLE_DOMAIN.test(domain) || FILE_LIKE.test(match[0])) continue;
      issues.push({ member, line: lineAt(match.index!), kind: "email", sample: redact("email", match[0], local) });
    }
  }
  return issues;
}

/** Plain report lines for a failed scan. */
export function describeContentIssues(issues: ContentIssue[]): string[] {
  return issues.map(issue => `${issue.member}:${issue.line}: ${issue.kind === "user-path" ? "absolute user path" : "email address"} ${issue.sample}`);
}
