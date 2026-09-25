/**
 * Personal data that must never reach the public site: user-profile paths and e-mail addresses.
 * Used by the knowledge generator (fails the build) and by tools/check.ts (fails the check over dist/).
 * Placeholders such as %USERPROFILE% or PATH_TO_GAME are fine; a real profile folder name is not.
 */
export const PERSONAL_DATA: { name: string; pattern: RegExp }[] = [
  // C:\Users\name, C:/Users/name, C:\\Users\\name (JSON-escaped), file:///C:/Users/name
  { name: "Windows user-profile path", pattern: /\b[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+(?!Public\b|Default\b|All Users\b)[^\\/\s"'<>|*?]+/gi },
  // /Users/name (macOS) and /home/name (Linux); "/Users/" alone, e.g. in prose, is not enough.
  { name: "user home path", pattern: /(?<![\w.-])\/(?:Users|home)\/(?!Shared\/)[A-Za-z0-9._-]+\/[^\s"'<>]*/g },
  { name: "e-mail address", pattern: /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
];

/** ArchiveXL material references such as `ash_brown@long.mi` look like addresses; these game file extensions are not domains. */
const RESOURCE_EXTENSIONS = new Set(["mi", "mt", "remt", "mesh", "app", "ent", "xbm", "hp", "xl", "mlsetup", "mlmask", "mltemplate",
  "morphtarget", "inkcharcustomization", "json", "yaml", "yml", "archive", "anims", "rig", "glb", "png", "dds", "tga"]);

export function findPersonalData(text: string): { name: string; match: string }[] {
  const found: { name: string; match: string }[] = [];
  for (const { name, pattern } of PERSONAL_DATA) {
    for (const match of text.matchAll(pattern)) {
      if (name === "e-mail address" && RESOURCE_EXTENSIONS.has(match[0].slice(match[0].lastIndexOf(".") + 1).toLowerCase())) continue;
      found.push({ name, match: match[0] });
      break;
    }
  }
  return found;
}
