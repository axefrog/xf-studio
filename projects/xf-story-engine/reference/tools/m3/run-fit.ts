// Phase 2 over every story state: R2 fitted with layer 3 absent, attached with tempo off, and sowing on (restless), and played to
// its end under three policies. Writes a table, and the transcript of the sowing-off play of each state.
// Usage: bun tools/m3/run-fit.ts <outdir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { Run, policies } from '../../src/m3/driver.ts';
import { fitKey, fitOfR2, semanticOfR2 } from '../../src/m3/fit.ts';
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

const rows: string[] = ['| State | Policy | Verdict | Windows | Cast | Draws | Exits | Same fit with layer 3 attached (off) | Same fit with sowing on | Same play (off) | Same play (on) | R2 ended as |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
let allSame = true;
for (const st of STATES) {
  for (const policy of ['decline', 'accept-first', 'accept-last']) {
    const runs = (['absent', 'attached-off', 'on'] as Arm[]).map((a) => make(a, st.id, policy));
    for (const r of runs) r.runWindows(2);
    const keys = runs.map((r) => fitKey(fitOfR2(r)));
    for (const r of runs) r.runWindows(24);
    const sem = runs.map((r) => JSON.stringify(semanticOfR2(r)));
    const k = keys.map((x) => JSON.stringify(x));
    const f1 = k[1] === k[0], f2 = k[2] === k[0], p1 = sem[1] === sem[0], p2 = sem[2] === sem[0];
    allSame &&= f1 && f2 && p1 && p2;
    const k0 = keys[0]!;
    const cast = Object.entries(k0.cast).map(([role, c]) => `${role}:${c.node ? 'cast' : 'unfilled'}`).join(' ');
    const ended = JSON.parse(sem[0]!)?.state ?? 'no instance';
    rows.push(`| ${st.id} | ${policy} | ${k0.verdict} | ${Object.entries(k0.windows).map(([w, s]) => `${w}:${s}`).join(' ')} | ${cast} | ${Object.keys(k0.draws).length} | ${k0.exits.length} | ${f1} | ${f2} | ${p1} | ${p2} | ${ended} |`);
    if (policy === 'decline') writeFileSync(`${out}/fit-${st.id}.txt`, transcript(runs[0]!, { week: false }));
  }
}
writeFileSync(`${out}/fit-results.md`, ['# R2 fitted and played with sowing off and on', '', ...rows, '', `All agree: ${allSame}`, ''].join('\n'));
console.log(`all agree: ${allSame}`);
