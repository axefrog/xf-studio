// Run one model rater over one rater sheet of a blind packet, through its CLI, and write the answer file the scorer reads.
// Usage: bun tools/m3/rate.ts <codex|claude> <model> <sheet.md> <answer.json> <rater name> [effort]
//   codex: `codex exec -m <model> -c model_reasoning_effort=<effort>`, read-only, no user config or rules, in an empty folder.
//   claude: `claude -p --model <model>` with no tools, no slash commands, no settings, no session kept, a one-line system prompt, in an empty
//           folder: no memory, no project files, no tools (the harness still attaches the account's email line, which says nothing about the cards).
// The sheet is the whole instruction and the cards and pairs in this rater's order; the reply must be one JSON object. The raw reply is kept beside
// the answer as `<answer>.raw.txt`; the answer is the JSON found in it. A reply that is not valid JSON, or that leaves a card or pair out, is an error.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [kind, model, sheet, answer, rater, effort = 'high'] = process.argv.slice(2);
if (!kind || !model || !sheet || !answer || !rater) throw new Error('usage: rate <codex|claude> <model> <sheet.md> <answer.json> <rater name> [effort]');
const cwd = process.env.M3_RATER_CWD;
if (!cwd) throw new Error('set M3_RATER_CWD to an empty folder');
mkdirSync(cwd, { recursive: true });
const prompt = readFileSync(sheet, 'utf8') + `\n\nReply with the JSON object only, with "rater" set to "${rater}". No text before or after it.\n`;
const t0 = Date.now();
const args = kind === 'codex'
  ? ['exec', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-C', cwd, '-']
  : ['-p', '--model', model, '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--setting-sources', '', '--strict-mcp-config', '--system-prompt', 'You are a careful blind rater of short texts.'];
const r = spawnSync(kind, args, { input: prompt, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && kind === 'claude' ? false : false });
if (r.error) throw r.error;
const raw = `${r.stdout ?? ''}`;
writeFileSync(`${answer}.raw.txt`, raw + (r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''));
const start = raw.indexOf('{"rater"') >= 0 ? raw.indexOf('{"rater"') : raw.indexOf('{');
const end = raw.lastIndexOf('}');
if (start < 0 || end < start) throw new Error(`no JSON in the reply (see ${answer}.raw.txt)`);
const parsed = JSON.parse(raw.slice(start, end + 1)) as { rater: string; cards: Record<string, unknown>; pairs: Record<string, unknown> };
const need = (re: RegExp): string[] => [...readFileSync(sheet, 'utf8').matchAll(re)].map((m) => m[1]!);
const cards = new Set(need(/^### (H-\d+)/gm)), pairs = new Set(need(/^### (P-\d+)/gm));
const missingCards = [...cards].filter((c) => !(c in parsed.cards)), missingPairs = [...pairs].filter((p) => !(p in parsed.pairs));
if (missingCards.length || missingPairs.length) throw new Error(`the reply leaves out ${missingCards.length} cards and ${missingPairs.length} pairs (see ${answer}.raw.txt)`);
parsed.rater = rater;
writeFileSync(answer, JSON.stringify(parsed, null, 1));
console.log(`${rater}: ${cards.size} cards, ${pairs.size} pairs, ${Math.round((Date.now() - t0) / 1000)} s`);
