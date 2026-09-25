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

/** What personal data a text holds, if any: a user-profile path or an e-mail address. */
export function personalDataIn(text: string): "user-path" | "email" | null {
  for (const pattern of USER_PATHS) for (const match of text.matchAll(pattern)) if (!PLACEHOLDER_USER.test(match[1] ?? "")) return "user-path";
  for (const match of text.matchAll(EMAIL)) {
    const local = match[1] ?? "", domain = match[2] ?? "";
    if (!ROLE_LOCAL.test(local) && !NOT_ADDRESS.some(rule => rule.test(domain))) return "email";
  }
  return null;
}
