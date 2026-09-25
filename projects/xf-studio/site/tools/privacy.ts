/**
 * Personal data that must never reach the public site: user-profile paths and e-mail addresses.
 * Used by the knowledge generator (fails the build) and by tools/check.ts (fails the check over dist/).
 * Placeholders such as %USERPROFILE% or PATH_TO_GAME are fine; a real profile folder name is not.
 *
 * The patterns, exemptions and test vectors are the repository's own (`tools/private-data.json`),
 * shared with tools/check_private_paths.py and the packaged-app content scan, so the three agree.
 * Matches are redacted: build and check logs are public.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type PatternSpec = { source: string; flags: string };
export type PrivateData = {
  userPaths: (PatternSpec & { id: string })[];
  placeholderUser: PatternSpec;
  email: PatternSpec;
  emailExemptions: { local: PatternSpec; domains: PatternSpec[] };
  vectors: { userPath: string[]; email: string[]; clean: string[] };
};
export const PRIVATE_DATA: PrivateData = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../tools/private-data.json"), "utf8"));

const regex = (spec: PatternSpec, global = false) => new RegExp(spec.source, spec.flags + (global ? "g" : ""));
const PATH_NAMES: Record<string, string> = { windows: "Windows user-profile path", wsl: "WSL user-profile path", posix: "user home path" };
const USER_PATHS = PRIVATE_DATA.userPaths.map(spec => ({ name: PATH_NAMES[spec.id] ?? "user-profile path", pattern: regex(spec, true) }));
const PLACEHOLDER_USER = regex(PRIVATE_DATA.placeholderUser);
const EMAIL = regex(PRIVATE_DATA.email, true);
const ROLE_LOCAL = regex(PRIVATE_DATA.emailExemptions.local);
const NOT_ADDRESS_DOMAINS = PRIVATE_DATA.emailExemptions.domains.map(spec => regex(spec));

/** The match with its personal part reduced to its first character. */
function redact(match: string, personal: string, at: number) {
  return match.slice(0, at) + personal.slice(0, 1) + "*".repeat(Math.max(3, personal.length - 1)) + match.slice(at + personal.length);
}

/** At most one finding per kind, each redacted. */
export function findPersonalData(text: string): { name: string; match: string }[] {
  const found: { name: string; match: string; start: number; end: number }[] = [];
  const add = (name: string, match: RegExpMatchArray, personal: string, at: number) => {
    const start = match.index!, end = start + match[0].length;
    if (found.some(item => item.name === name || (start < item.end && item.start < end))) return;
    found.push({ name, match: redact(match[0], personal, at), start, end });
  };
  for (const { name, pattern } of USER_PATHS)
    for (const match of text.matchAll(pattern))
      if (!PLACEHOLDER_USER.test(match[1]!)) add(name, match, match[1]!, match[0].length - match[1]!.length);
  for (const match of text.matchAll(EMAIL)) {
    const [, local, domain] = match as unknown as [string, string, string];
    if (ROLE_LOCAL.test(local) || NOT_ADDRESS_DOMAINS.some(rule => rule.test(domain))) continue;
    add("e-mail address", match, local, 0);
  }
  return found.map(({ name, match }) => ({ name, match }));
}
