/**
 * The repository's one set of personal-data patterns (`tools/private-data.json`: user-profile paths and e-mail addresses), for text
 * the Studio writes into a portable file (a character preset; CORE-56): the same rules as the repository scan, the site's privacy check
 * and the packaged-app content scan. Only the pattern keys are imported, so a bundle never carries the file's test vectors (which the
 * packaged-app scan would rightly flag).
 */
import { email, emailExemptions, placeholderUser, userPaths } from "../../../../tools/private-data.json";

type PatternSpec = { source: string; flags: string };
const regex = (spec: PatternSpec, global = false) => new RegExp(spec.source, spec.flags + (global ? "g" : ""));
const USER_PATHS = (userPaths as PatternSpec[]).map(spec => regex(spec, true));
const PLACEHOLDER_USER = regex(placeholderUser as PatternSpec);
const EMAIL = regex(email as PatternSpec, true);
const ROLE_LOCAL = regex((emailExemptions as { local: PatternSpec }).local);
const NOT_ADDRESS = (emailExemptions as { domains: PatternSpec[] }).domains.map(spec => regex(spec));

/** A folder or account name that belongs to no one (a placeholder, a shared profile, a CI account). */
export const isPlaceholderUser = (name: string) => PLACEHOLDER_USER.test(name);

/** What personal data a text holds, if any: a user-profile path or an e-mail address. */
export function personalDataIn(text: string): "user-path" | "email" | null {
  for (const pattern of USER_PATHS) for (const match of text.matchAll(pattern)) if (!PLACEHOLDER_USER.test(match[1] ?? "")) return "user-path";
  for (const match of text.matchAll(EMAIL)) {
    const local = match[1] ?? "", domain = match[2] ?? "";
    if (!ROLE_LOCAL.test(local) && !NOT_ADDRESS.some(rule => rule.test(domain))) return "email";
  }
  return null;
}

/**
 * The text with every personal part replaced: a user-profile folder name becomes `<user>` (the rest of the path stays, so
 * `C:\Users\<user>\AppData\…` still says where) and an e-mail address becomes `<email>`. Placeholders, role accounts, versions and
 * file names that the shared rules pass are left as they are. The diagnostics log and report use this (docs/diagnostics.md).
 */
export function redactPersonalData(text: string): string {
  let out = text;
  for (const pattern of USER_PATHS)
    out = out.replace(pattern, (match: string, user: string | undefined) =>
      !user || PLACEHOLDER_USER.test(user) ? match : match.slice(0, match.length - user.length) + "<user>");
  return out.replace(EMAIL, (match: string, local: string | undefined, domain: string | undefined) =>
    ROLE_LOCAL.test(local ?? "") || NOT_ADDRESS.some(rule => rule.test(domain ?? "")) ? match : "<email>");
}
