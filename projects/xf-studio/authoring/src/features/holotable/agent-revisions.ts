/** Diff resolved publication versions once per answer, outside painting and its preparation cursor. */
import type { AgentAnswer, AgentMarker, AgentRevisionChange, AgentRevisions } from "./agent-types";
type Revision = { version: number; layer: string; marker?: AgentMarker; fades: boolean };
export function agentRevisions(yieldTask: () => Promise<void> = () => Promise.resolve()) {
  let previous = new Map<string, Revision>(), initialized = false, generation = 0, sequence = 0;
  const reset = () => { generation++; previous = new Map(); initialized = false; };
  return {
    reset,
    async answer(answer: AgentAnswer, signal: AbortSignal): Promise<AgentRevisions> {
      const mine = ++generation, before = previous, baseline = !initialized;
      const next = new Map<string, Revision>(), current: Record<string, AgentMarker> = Object.create(null), changes: AgentRevisionChange[] = [];
      const check = () => { signal.throwIfAborted(); if (mine !== generation) throw new DOMException("Superseded revision answer", "AbortError"); };
      let visits = 0;
      for (const layer of answer.layers) for (const item of layer.items) {
        if (++visits % 256 === 0) { await yieldTask(); check(); }
        const rule = answer.specs.kinds[item.kind];
        const marker: AgentMarker | undefined = item.place && rule ? {
          point: [...item.place], tone: rule.style === "tone" ? item.tone ?? "signal" : rule.style, marker: rule.draw,
          ...(item.glyph === undefined ? {} : { glyph: item.glyph }),
        } : undefined;
        const row = { version: item.version ?? item.t ?? 0, layer: layer.id, marker, fades: item.kind !== "path" && item.kind !== "zone" };
        next.set(item.key, row); if (marker) current[item.key] = marker;
        const old = before.get(item.key);
        if (!baseline && marker && (!old || old.version !== row.version)) changes.push({ key: item.key, layer: layer.id, kind: "pulse", marker });
      }
      for (const [key, row] of before) {
        if (++visits % 256 === 0) { await yieldTask(); check(); }
        if (!next.has(key) && row.fades && row.marker) changes.push({ key, layer: row.layer, kind: "fade", marker: { ...row.marker, point: [...row.marker.point] } });
      }
      check(); previous = next; initialized = true;
      return { sequence: ++sequence, current, changes };
    },
  };
}
