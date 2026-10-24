import { expect, test } from "bun:test";
import { checkSubtitleRecording } from "../testing/subtitles.ts";
import type { Json } from "../testing/windows.ts";
const expected = { text: "Question?", type: "OverHeadAlwaysVisible", speaker: "scene-actor", minimum_reading_s: 2, from_s: 1, until_s: 5 };
function fixture() {
  const controllers = [{ controller: "SubtitlesGameController", controller_id: "1" }, { controller: "ChattersGameController", controller_id: "2" }];
  const data = { line_id: "42", text: expected.text, type: expected.type, speaker: expected.speaker, widget_id: "3", consumer: controllers[1] };
  const rows: Json[] = [];
  for (let time = 0; time <= 6; time++) for (const channel of ["subtitles", "voice"])
    rows.push({ channel, source_s: time, data: { event: "tap.coverage", valid: true, source_listeners: 3, controller_count: 2, controller_listeners: 6, controllers } });
  rows.push({ channel: "voice", source_s: 0.5, data: { event: "voice.requested", entity: "control-actor", trigger: "bump" } });
  for (const [event, source_s] of [["line.requested", 1.1], ["line.widget_created", 1.2], ["line.widget_bound", 1.21], ["line.widget_removed", 4]] as const)
    rows.push({ channel: "subtitles", source_s, data: { ...data, event, actual_text: expected.text, detached: true, effective_visible: true, opacity: 1 } });
  rows.sort((a, b) => a.source_s - b.source_s);
  rows.forEach((r, i) => Object.assign(r, { seq: i + 1, run: 1, session: "fixture", world_generation: 1, valid: true }));
  const status = { active: false, run: 1, session: "fixture", world_generation: 1, start_s: 0, end_s: 6,
    dropped: 0, invalid: 0, lost: 0, missed_deadlines: 0, channels: ["subtitles", "voice"], latest: rows.length };
  return { rows, status };
}
test("N3 proves question/widget lifetime and covered request absence, never audible silence", () => {
  const f = fixture(), out = checkSubtitleRecording(f.rows, f.status, expected);
  expect(out.verdict).toBe("PASS"); expect(out.reading_interval_s).toBeCloseTo(2.79); expect(out.audible_proof).toBe(false);
});
test("actual text, too-short interval and actor greeting are failures", () => {
  for (const mutation of ["text", "duration", "greeting"]) {
    const f = fixture();
    if (mutation === "text") f.rows.find(r => r.data.event === "line.widget_bound")!.data.actual_text = "Wrong";
    if (mutation === "duration") f.rows.find(r => r.data.event === "line.widget_removed")!.source_s = 1.5;
    if (mutation === "greeting") {
      f.rows.push({ ...f.rows[0], channel: "voice", source_s: 4.9, data: { event: "voice.requested", entity: expected.speaker, trigger: "greeting" } });
      f.rows.sort((a, b) => a.source_s - b.source_s); f.rows.forEach((r, i) => { r.seq = i + 1; });
      f.status.latest = f.rows.length;
    }
    expect(checkSubtitleRecording(f.rows, f.status, expected).verdict).toBe("FAIL");
  }
});
test("reading time requires positive visibility; hidden, transparent or later-hidden widgets fail", () => {
  for (const mode of ["missing", "hidden", "transparent", "later_hidden", "later_unknown"]) {
    const f = fixture(), bound = f.rows.find(r => r.data.event === "line.widget_bound")!;
    if (mode === "missing") { delete bound.data.effective_visible; delete bound.data.opacity; }
    if (mode === "hidden") bound.data.effective_visible = false;
    if (mode === "transparent") bound.data.opacity = 0;
    if (mode.startsWith("later_")) {
      f.rows.push({ ...bound, source_s: 2, data: { ...bound.data, event: "line.widget_state", effective_visible: mode === "later_hidden" ? false : undefined } });
      f.rows.sort((a, b) => a.source_s - b.source_s); f.rows.forEach((r, i) => { r.seq = i + 1; }); f.status.latest = f.rows.length;
    }
    const result = checkSubtitleRecording(f.rows, f.status, expected);
    expect(result.verdict, mode).toBe(mode === "missing" || mode === "later_unknown" ? "INCONCLUSIVE" : "FAIL");
    expect(result.reading_interval_s ?? null).toBeNull();
  }
});
test("loss, stale/missing listeners, duplicate controller, widget and incomplete drain stay inconclusive", () => {
  for (const mode of ["loss", "listeners", "duplicates", "widget", "drain", "heartbeat", "source", "identity", "interval", "voice_control"] ) {
    const f = fixture();
    if (mode === "loss") f.status.dropped = 1;
    if (mode === "listeners") f.rows.find(r => r.data.event === "tap.coverage" && r.source_s === 1)!.data.source_listeners = 6;
    if (mode === "duplicates") f.rows.find(r => r.data.event === "tap.coverage")!.data.controllers[1].controller_id = "1";
    if (mode === "widget") f.rows.find(r => r.data.event === "line.widget_created")!.data.event = "line.spawn_failed";
    if (mode === "drain") f.rows.pop();
    if (mode === "heartbeat") f.rows.find(r => r.channel === "voice" && r.source_s === 2)!.data.event = "missing";
    if (mode === "identity") f.rows.find(r => r.data.event === "line.widget_bound")!.data.consumer = { controller: "Other", controller_id: "99" };
    if (mode === "interval") (f.status as Json).start_s = undefined;
    if (mode === "voice_control") f.rows.find(r => r.data.event === "voice.requested")!.data.event = "missing";
    if (mode === "source") f.rows.find(r => r.data.event === "line.requested")!.data.text = "Other";
    expect(checkSubtitleRecording(f.rows, f.status, expected).verdict, mode).toBe("INCONCLUSIVE");
  }
});
