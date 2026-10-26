// A small synthetic recorder run, written in the recorder's own format, so tests need no private recordings.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixture { root: string; dir: string; dispose(): void }

export interface FixtureOptions {
  /** Skip this sequence number (a dropped record). */
  skipSeq?: number;
  /** Pause one second before V's sample at this index. */
  pauseAt?: number;
  /** Write an extra V sample marked invalid just after this index. */
  invalidAt?: number;
  /** The manifest lists a second chunk that isn't on disk. */
  missingChunk?: boolean;
  /** The chunk ends with half a row (a writer cut off mid-line). */
  unfinishedTail?: boolean;
}

export function writeFixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "holotable-test-"));
  const session = "abc123", run = 1, dir = join(root, session, `run-${run}`);
  mkdirSync(dir, { recursive: true });
  const rows: string[] = [];
  let seq = 0, t = 1000;
  const row = (channel: string, data: object, valid = true) => {
    seq++;
    if (seq === options.skipSeq) seq++;
    rows.push(JSON.stringify({ channel, data, run, seq, session, schema: "xfb/source-record-1", source_s: t, valid, world_generation: 1 }));
  };
  for (let i = 0; i < 50; i++) {
    if (i === options.pauseAt) t += 1;
    row("v", { position: [i, 0, 10], yaw: 0, velocity: [1, 0, 0], vitals: { health: 100, health_max: 100, in_combat: i > 40 }, vehicle: { mounted: false }, busy: "" });
    row("camera", { camera: { position: [i - 2, 0, 12], forward: [1, 0, 0], up: [0, 0, 1], fov: 40, aspect: 1.8 } });
    if (i === options.invalidAt) { t += 0.05; row("v", { valid: false }, false); }
    if (i === 10) row("subtitles", { event: "line.requested", line_id: "1", text: "A secret line", speaker_name: "Someone", type: "OverHead" });
    if (i === 20) row("supervisor", { event: "supervisor.safe_position", at: [20, 0, 10], quiet_s: 3 });
    t += 0.1;
  }
  writeFileSync(join(dir, "chunk-1.jsonl"), rows.join("\n") + "\n" + (options.unfinishedTail ? '{"channel":"v","data":{' : ""));
  const chunks = [{ file: "chunk-1.jsonl", bytes: 0 }, ...(options.missingChunk ? [{ file: "chunk-2.jsonl", bytes: 0 }] : [])];
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    schema: "xfb/recording-1", session, run, world_generation: 1, plugin_version: "test", start_s: 1000, end_s: t,
    channels: ["v", "camera", "subtitles", "supervisor"], complete: true, dropped: 0, missed_deadlines: 0, largest_gap_s: 0.1,
    coverage: "synthetic", chunks,
  }));
  return { root, dir, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
