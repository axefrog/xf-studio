// N3's source oracle. Call with a fully drained recording; acquisition/reading is still owned by recording.ts.
// UI widget lifetime is a reading opportunity, never proof of pixels, comprehension or audible output.
import type { Json } from "./windows.ts";
export type SubtitleExpectation = { text: string; type: string; speaker: string; minimum_reading_s: number; from_s: number; until_s: number };
export function checkSubtitleRecording(rows: Json[], status: Json, expected: SubtitleExpectation): Json {
  const inconclusive = (reason: string): Json => ({ verdict: "INCONCLUSIVE", reason, coverage: "subtitle_widget_and_covered_script_requests", audible_proof: false });
  if (![expected.from_s, expected.until_s, expected.minimum_reading_s].every(Number.isFinite) || expected.until_s <= expected.from_s || expected.minimum_reading_s < 0)
    throw new Error("Invalid subtitle observation interval");
  if (!Number.isSafeInteger(status.run) || status.run < 1 || !Number.isSafeInteger(status.world_generation) ||
      typeof status.session !== "string" || !status.session || !Number.isFinite(status.start_s) || !Number.isFinite(status.end_s) ||
      !Number.isSafeInteger(status.latest) || !expected.speaker || status.active !== false || status.dropped !== 0 || status.invalid !== 0 || status.missed_deadlines !== 0 || status.lost !== 0 || status.file_error)
    return inconclusive("Recording is active, incomplete or has loss/invalid samples");
  if (!Array.isArray(status.channels) || !["subtitles", "voice"].every(c => status.channels.includes(c)) || status.start_s > expected.from_s || status.end_s < expected.until_s)
    return inconclusive("Recording does not cover both channels and the whole requested interval");
  let previous = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.seq) || row.seq !== previous + 1 || row.run !== status.run || row.session !== status.session || row.world_generation !== status.world_generation ||
        row.valid !== true || !Number.isFinite(row.source_s) || !row.data) return inconclusive("Record identity, sequence or validity is incomplete");
    previous = row.seq;
  }
  if (previous !== status.latest) return inconclusive("Recording has not been completely drained");
  const voiceControl = rows.find(r => r.channel === "voice" && r.data.event === "voice.requested" &&
    r.source_s < expected.from_s && typeof r.data.entity === "string" && r.data.entity.length > 0 &&
    typeof r.data.trigger === "string" && r.data.trigger.length > 0);
  if (!voiceControl) return inconclusive("Missing positive script-voice control before the observation interval");
  const interval = rows.filter(r => r.source_s >= expected.from_s && r.source_s <= expected.until_s);
  // Heartbeats must bracket the fixture, and continue at 1 Hz (with modest game-update jitter).
  for (const channel of ["subtitles", "voice"]) {
    const beats = rows.filter(r => r.channel === channel && r.data.event === "tap.coverage");
    const before = beats.filter(r => r.source_s <= expected.from_s).at(-1);
    const after = beats.find(r => r.source_s >= expected.until_s);
    if (!before || !after) return inconclusive(`Missing ${channel} coverage at interval boundaries`);
    const range = beats.filter(r => r.source_s >= before.source_s && r.source_s <= after.source_s);
    for (let i = 0; i < range.length; i++) {
      const b = range[i]!.data;
      const controllers = b.controllers;
      if (b.valid !== true || b.source_listeners !== 3 || b.registry_overflow || !Array.isArray(controllers) ||
          controllers.length !== b.controller_count || b.controller_listeners !== controllers.length * 3 ||
          new Set(controllers.map((c: Json) => c.controller_id)).size !== controllers.length ||
          !["SubtitlesGameController", "ChattersGameController"].every(c => controllers.some((entry: Json) => entry.controller === c)) ||
          (i > 0 && range[i]!.source_s - range[i - 1]!.source_s > 1.5)) return inconclusive("Listener/controller coverage is missing, duplicated or stale");
    }
  }
  const sameLine = (r: Json) => r.channel === "subtitles" && r.data.text === expected.text && r.data.type === expected.type && r.data.speaker === expected.speaker;
  const requests = interval.filter(r => r.data.event === "line.requested" && sameLine(r));
  if (requests.length !== 1) return inconclusive("Expected one unambiguous question source request");
  const line = requests[0]!.data.line_id;
  const creations = interval.filter(r => r.data.event === "line.widget_created" && r.data.line_id === line && sameLine(r));
  if (creations.length !== 1 || !creations[0]!.data.widget_id) return inconclusive("Missing or ambiguous actual widget creation");
  const created = creations[0]!, widget = created.data.widget_id, consumer = created.data.consumer;
  if (!consumer?.controller_id || !consumer.controller) return inconclusive("Missing widget consumer identity");
  const bound = interval.filter(r => r.data.event === "line.widget_bound" && r.data.widget_id === widget && sameLine(r));
  const removals = interval.filter(r => r.data.event === "line.widget_removed" && r.data.widget_id === widget && r.data.line_id === line);
  if (bound.length !== 1 || removals.length !== 1 || removals[0]!.data.detached !== true || bound[0]!.source_s < created.source_s || removals[0]!.source_s < bound[0]!.source_s)
    return inconclusive("Missing or ambiguous widget binding/removal");
  if (![bound[0]!, removals[0]!].every(r => r.data.consumer?.controller_id === consumer.controller_id && r.data.consumer?.controller === consumer.controller))
    return inconclusive("Widget consumer identity changed");
  const reading = removals[0]!.source_s - bound[0]!.source_s;
  // Binding alone is not a reading opportunity. Track visibility observations until removal;
  // the removal's detached/hidden state itself is expected and is not part of the interval.
  const visibility = [bound[0]!, ...interval.filter(r => r.channel === "subtitles" && r.data.event === "line.widget_state" &&
    r.data.widget_id === widget && r.data.line_id === line && r.source_s >= bound[0]!.source_s && r.source_s < removals[0]!.source_s)];
  const hidden = visibility.some(r => r.data.effective_visible === false || (Number.isFinite(r.data.opacity) && r.data.opacity <= 0));
  const visibilityKnown = visibility.every(r => r.data.effective_visible === true && Number.isFinite(r.data.opacity) && r.data.opacity > 0 &&
    r.data.ancestor_limit !== true && r.data.consumer?.controller_id === consumer.controller_id && r.data.consumer?.controller === consumer.controller);
  const greetings = interval.filter(r => r.channel === "voice" && r.data.event === "voice.requested" && r.data.entity === expected.speaker && r.data.trigger === "greeting");
  const failures: string[] = [];
  if (hidden) failures.push("Widget was hidden or transparent during the reading interval");
  if (bound[0]!.data.actual_text !== expected.text) failures.push("Widget text differs from the question");
  if (reading < expected.minimum_reading_s) failures.push("Widget reading interval is too short");
  if (greetings.length) failures.push("Script greeting request observed from scene actor");
  if (!failures.length && !visibilityKnown) return inconclusive("Missing positive widget visibility during the reading interval");
  return { verdict: failures.length ? "FAIL" : "PASS", failures, line_id: line, widget_id: widget,
    widget_lifetime_s: reading, reading_interval_s: visibilityKnown && !hidden ? reading : null, events_for_line: interval.filter(r => r.data.line_id === line).length,
    voice_control_seq: voiceControl.seq,
    voice_result: greetings.length ? "script greeting request observed" : "no greeting voice request observed on covered paths",
    coverage: "subtitle_widget_visibility_and_covered_script_requests", audible_proof: false, rendered_proof: false };
}
