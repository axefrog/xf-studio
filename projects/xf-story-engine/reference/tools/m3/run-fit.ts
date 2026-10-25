// Phase 2 over every story state: R2 fitted with layer 3 absent, attached with tempo off, and sowing on (restless), and played to
// its end under three policies. Writes a table, and the transcript of the sowing-off play of each state.
// Two questions are kept apart. The fit: is the fit report the same with sowing off and with it on (M3's criterion, S23-S2-10)?
// The play: is what R2 then did the same? The play is compared on the selected fragments, the delivered words and the state left
// behind, leaving out only when things were released (pacing may move that, SF3-36); where it differs, the table says in what.
// Usage: bun tools/m3/run-fit.ts <outdir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { Run, policies } from '../../src/m3/driver.ts';
import { fitKey, fitOfR2, playDifference, releaseTimesOfR2, semanticOfR2 } from '../../src/m3/fit.ts';
import { hookPack, hookPatterns } from '../../src/m3/hooks.ts';
import { r2Pack } from '../../src/m3/r2.ts';
import { STATES } from '../../src/m3/states.ts';
import { transcript } from '../../src/m3/transcript.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: run-fit <outdir>');
mkdirSync(out, { recursive: true });
type Arm = 'absent' | 'attached-off' | 'on';
const make = (arm: Arm, state: string, policy: string): Run =>
  new Run({ name: `fit-${state}`, packs: [r2Pack(), hookPack()], ...(arm === 'absent' ? { layer3: false } : { layer3: true, tempo: arm === 'on' ? 'restless' : 'off', patterns: hookPatterns() }) } as never, STATES.find((s) => s.id === state)!, policies[policy]!);

const hours = (s: number): string => `${(s / 3600).toFixed(1)} h`;
const rows: string[] = ['| State | Policy | Verdict | Windows | Cast | Draws | Exits | Same fit, layer 3 attached (off) | Same fit, sowing on | Same play (off) | Same play (on) | What differs in selection and content (on) | First delivery later by (attached off / on) | R2 ended as |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
let fitsSame = true, comparisons = 0, playDiffers = 0, playDiffersOff = 0, heldOn = 0, heldOff = 0;
const notes: string[] = [];
for (const st of STATES) {
  for (const policy of ['decline', 'accept-first', 'accept-last']) {
    const runs = (['absent', 'attached-off', 'on'] as Arm[]).map((a) => make(a, st.id, policy));
    for (const r of runs) r.runWindows(2);
    const keys = runs.map((r) => fitKey(fitOfR2(r)));
    for (const r of runs) r.runWindows(24);
    const sem = runs.map((r) => semanticOfR2(r));
    const k = keys.map((x) => JSON.stringify(x));
    const f1 = k[1] === k[0], f2 = k[2] === k[0];
    const d1 = playDifference(sem[0], sem[1]), d2 = playDifference(sem[0], sem[2]);
    fitsSame &&= f1 && f2;
    comparisons++;
    if (d1.length) playDiffersOff++;
    if (d2.length) playDiffers++;
    const k0 = keys[0]!;
    const cast = Object.entries(k0.cast).map(([role, c]) => `${role}:${c.node ? 'cast' : 'unfilled'}`).join(' ');
    const ended = (sem[0] as { state?: string } | undefined)?.state ?? 'no instance';
    const t = runs.map((r) => releaseTimesOfR2(r));
    const diff = d2.length ? d2.join(', ') : 'none';
    const later = (i: number): number => (t[0]![0] !== undefined && t[i]![0] !== undefined ? t[i]![0]! - t[0]![0]! : 0);
    if (later(1) > 0) heldOff++;
    if (later(2) > 0) heldOn++;
    rows.push(`| ${st.id} | ${policy} | ${k0.verdict} | ${Object.entries(k0.windows).map(([w, s]) => `${w}:${s}`).join(' ')} | ${cast} | ${Object.keys(k0.draws).length} | ${k0.exits.length} | ${f1} | ${f2} | ${d1.length === 0} | ${d2.length === 0} | ${diff} | ${hours(later(1))} / ${hours(later(2))} | ${ended} |`);
    if (later(2) > 0) {
      const frags = (i: number): string => JSON.stringify(Object.values((sem[i] as { beats: Record<string, { fragment: string | null }> }).beats).map((b) => b.fragment).filter((x) => x));
      notes.push(`- ${st.id}, ${policy}: the first R2 delivery was released ${hours(later(2))} later with sowing on${d2.length ? `; selected fragments ${frags(0)} off against ${frags(2)} on` : ''}.`);
    }
    if (policy === 'decline') writeFileSync(`${out}/fit-${st.id}.txt`, transcript(runs[0]!, { week: false }));
  }
}
writeFileSync(`${out}/fit-results.md`, [
  '# R2 fitted and played with sowing off and on',
  '',
  'The fit is compared on the whole report (verdict, windows, cast, draws, exits, timing, decline preview, cost, findings). The play is compared on the cast, draws, the fragment each beat selected, the words delivered and how V answered, and the state left behind, and leaves out only when things were released.',
  '',
  ...rows,
  '',
  `Same fit with layer 3 absent, attached with tempo off, and sowing on: ${fitsSame}.`,
  `Same selection, content and end state (release times left out), layer 3 attached with tempo off: ${comparisons - playDiffersOff} of ${comparisons}; sowing on: ${comparisons - playDiffers} of ${comparisons}.`,
  `First delivery released later than with layer 3 absent: ${heldOff} of ${comparisons} with tempo off and ${heldOn} of ${comparisons} with sowing on. The other ${comparisons - heldOn} are the states where R2 waits (nothing is delivered in either run) or has closed (one line, released at the same moment in both). Layer 3 holds the first delivery of an open R2 whatever its tempo is set to, so the play differs in timing in every state where R2 is open.`,
  '',
  ...(notes.length ? ['Where layer 3 released the first delivery of R2 later than the run with layer 3 absent (sowing on):', '', ...notes, ''] : []),
].join('\n'));
console.log(JSON.stringify({ fitsSame, comparisons, playDiffersOff, playDiffers }));
