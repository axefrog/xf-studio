/**
 * Where a change on the V spends its time in the page, as User Timing marks (`xfs:character:<stage>`), so a click → pixels measurement
 * reads them with `performance.getEntriesByType("mark")` (research/backlog/performance.md). The stages, in order: `ask` (a new request
 * leaves for the host), `answer` (the host has the record), `record` (the record is read), `loaded` (its parts are loaded, reused or
 * built), `prepared` (new parts' maps uploaded and programs linked ahead of their first frame, PREV-189), `placed` (the scene shows them) and `frame` (the first frame drawn after placing). Marks are cleared as they are read, and
 * at most `KEEP` stay, so a long session holds only the recent ones. DOM-free; a runtime without User Timing records nothing.
 */
const STAGES = ["ask", "answer", "record", "loaded", "prepared", "placed", "frame"] as const;
export type CharacterStage = typeof STAGES[number];
const PREFIX = "xfs:character:";
const KEEP = 240;
let count = 0;

export function markCharacter(stage: CharacterStage, detail?: Record<string, unknown>): void {
  try {
    performance.mark(`${PREFIX}${stage}`, detail ? { detail } : undefined);
    if (++count > KEEP) { for (const name of STAGES) performance.clearMarks(`${PREFIX}${name}`); count = 0; }
  } catch { /* No User Timing here: timings are evidence only. */ }
}

/** The recorded stages since the last read, oldest first, and clears them. */
export function takeCharacterTimings(): { stage: CharacterStage; at: number; detail: unknown }[] {
  try {
    const marks = performance.getEntriesByType("mark").filter(entry => entry.name.startsWith(PREFIX))
      .map(entry => ({ stage: entry.name.slice(PREFIX.length) as CharacterStage, at: Math.round(entry.startTime * 10) / 10,
        detail: (entry as PerformanceMark).detail ?? null }));
    for (const stage of STAGES) performance.clearMarks(`${PREFIX}${stage}`);
    count = 0;
    return marks;
  } catch { return []; }
}
