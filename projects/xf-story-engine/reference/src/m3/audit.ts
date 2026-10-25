// The content audit of M3: words that must not appear in any M3 transcript, packet, fixture text or record (the maintainer's
// request: M3's output is shown to someone whose interest is a main-story character, and M3 does not use that arc).
// The patterns are built from parts so that a search of M3's own files for the name finds nothing.

const NAME = ['take', 'mura'].join('');
const ARC = ['q1', '12'].join('');

export const FORBIDDEN: RegExp[] = [new RegExp(NAME, 'i'), new RegExp(`${ARC}_`, 'i'), new RegExp(`\b${['go', 'ro'].join('')}\b`, 'i'), /\boda\b/i];

/** The forbidden patterns a text trips, for a failure message. */
export function tripped(text: string): string[] {
  return FORBIDDEN.filter((re) => re.test(text)).map((re) => String(re));
}
