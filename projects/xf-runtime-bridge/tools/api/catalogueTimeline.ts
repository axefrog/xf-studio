import type { CommandContext, CommandDef } from "./catalogue.ts";
import { bool, int, num, obj, oneOf, str } from "./schema.ts";
import { catchUp, type TimelineCursor } from "../testing/timeline.ts";
import type { CaptureArm } from "../testing/event-captures.ts";
import type { TestApi } from "../testing/windows.ts";

// Inside a local command, use its existing connection rather than recursively entering run's queue.
export function timelineApi(context: CommandContext): TestApi {
  return { run: async (name, input = {}, options = {}) => {
    if (!["bridge.info", "test.record.read", "session.events", "game.digest"].includes(name)) throw new Error("Unsupported timeline read");
    const signal = context.signal && options.signal ? AbortSignal.any([context.signal, options.signal]) : options.signal ?? context.signal;
    const answer = await context.api.callBridge(name, input as Record<string, unknown>, context.cid, undefined, signal);
    return answer.ok ? { ok: true, command: name, cid: context.cid, result: answer.result } : { ok: false, command: name, cid: context.cid, error: answer.error };
  } };
}
const previousV = { ...obj({
  position: { type: "array" as const, description: "Previous sampled position", items: num("Coordinate"), minItems: 3, maxItems: 3 },
  vitals: { ...obj({ health: num("Previous health"), in_combat: bool("Previous combat flag") }), description: "Previous vitals" },
  heat: str("Previous heat as canonical JSON", { maxLength: 2048 }),
  vehicle: { ...obj({ mounted: bool("Mounted"), id: str("Entity identity", { maxLength: 80 }) }), description: "Previous vehicle identity" },
  busy: str("Previous busy reason", { maxLength: 80 }),
}), description: "Small previous-sample baseline for alerts across turns" };
const cursorSchema = { ...obj({ schema: oneOf("Cursor schema", ["xfb/timeline-cursor-1"]), sid: str("Bridge session", { maxLength: 80 }),
  run: int("Recorder run", 1, Number.MAX_SAFE_INTEGER), world: int("World generation", 0, Number.MAX_SAFE_INTEGER),
  record: int("Recorder sequence", 0, Number.MAX_SAFE_INTEGER), event: int("Session event sequence", 0, Number.MAX_SAFE_INTEGER), last_v: previousV,
  file_chunk: int("Native writer chunk cursor", 1, 2048), file_offset: int("Native writer byte cursor", 0, 1048576),
  contact_observed: bool("Run contact latch; preserve returned value"), vehicle_hit_observed: bool("Run vehicle-hit latch; preserve returned value"),
  supervisor_seen: { type: "array", description: "Bounded receipt identities reconciled across both feeds; preserve unchanged", maxItems: 512, items: int("Receipt identity", 1, Number.MAX_SAFE_INTEGER) },
  supervisor_retired_through: int("Receipt reconciliation compaction boundary", 0, Number.MAX_SAFE_INTEGER),
  supervisor_reconciliation_lost: bool("Compaction made older reconciliation incomplete; preserve returned value"),
  supervisor_totals: { ...obj(Object.fromEntries(["violations", "actions", "refused", "cancellations", "writes"].map(k => [k, int(`The run's supervisor ${k} so far`, 0, Number.MAX_SAFE_INTEGER)])),
    ["violations", "actions", "refused", "cancellations", "writes"]), description: "The run's supervisor receipts and writes so far; preserve returned value" },
  supervisor_recent: { type: "array", description: "The run's latest supervisor receipts, compact; preserve returned value", maxItems: 8,
    items: { ...obj({ receipt_seq: int("Receipt identity", 1, Number.MAX_SAFE_INTEGER), event: str("Receipt event", { maxLength: 64 }), source_s: num("Source time"),
      actor: str("Actor key", { maxLength: 80 }), detail: str("What it said", { maxLength: 160 }) }, ["receipt_seq", "event", "actor", "detail"]), description: "A compact receipt" } },
  last_v_seq: int("Recorder sequence of the newest V sample seen; preserve returned value", 0, Number.MAX_SAFE_INTEGER),
  last_v_source_s: num("Source time of the newest V sample seen; preserve returned value"),
  incident_counters: { ...obj({ dropped: int("Observations the plugin refused (rate, invalid) at the cursor", 0, Number.MAX_SAFE_INTEGER), tap_dropped: int("Observations the taps' admission refused (cap, weak kinds) at the cursor", 0, Number.MAX_SAFE_INTEGER),
    report_gaps: int("Witnessed incidents whose report was lost at the cursor", 0, Number.MAX_SAFE_INTEGER) }, ["dropped", "tap_dropped", "report_gaps"]), description: "The incident counters at the cursor, so incompleteness describes the interval since it; preserve returned value" },
  source_counters: { ...obj({ dropped: int("Recorder drops at the cursor", 0, Number.MAX_SAFE_INTEGER), invalid: int("Invalid samples at the cursor", 0, Number.MAX_SAFE_INTEGER),
    missed_deadlines: int("Missed sample deadlines at the cursor", 0, Number.MAX_SAFE_INTEGER), file_error: bool("Native writer error at the cursor") },
    ["dropped", "invalid", "missed_deadlines", "file_error"]), description: "Source loss counts at the cursor, so coverage gaps describe the interval since it; preserve returned value" },
}, ["schema", "sid", "run", "world", "record", "event"]), description: "The complete returned cursor, unchanged" };
const matchSchema = { ...obj(Object.fromEntries(["who", "actor", "style", "quest", "objective", "state", "line_id", "widget_id", "speaker", "text", "source"].map(key => [key, str(`Exact ${key}`, { maxLength: 512 })]))), description: "At most eight exact event-data fields to match" };
export const TIMELINE_COMMANDS: CommandDef[] = [
  { name: "game.catchup", title: "Catch up with the moving session", permission: "read",
    description: "Autonomous test recorder required. Read this at the start of each turn: source path/health/combat/heat/vehicle/busy changes, F/U/subtitle/voice callbacks, session events and alerts since a cursor, plus the existing current digest. The page can be behind real time (more: true, with a backlog object of records, events and seconds behind and a summary line saying so): v.current is the newest V only when it comes from the digest (source digest, stale false); with the digest off it is a recorder sample explicitly marked historical and stale, with its age, and a recorder page counts as caught up only when the cursor has reached the latest sequence the recorder showed on the final read. v.latest, v.path and the counts describe only the page read. counts[channel] is every record read for that channel; count_detail[channel] says where they went (invalid ones, polled snapshots coalesced into <channel>_latest, listed events, those omitted from the compact list), so a count and its list reconcile. A cursor's source_counters baseline is checked against the recorder's totals and refused (invalid_cursor) if it could not have been a past reading. First call supplies run; subsequent calls replay cursor verbatim. Compact by default (last 24 events per channel with omitted counts); detail returns all retained records. Loss/invalid sources are explicit and describe the interval since the cursor, not the whole run; contact alerts require explicit receipts, partial car-hit entry and controller report paths are instrumented but uncommissioned, never full no-contact proof. Supervisor summaries reconcile both feeds across calls and include only this recorder run's world and source interval: counts and receipts are what is new since the cursor, already_reported says how many on these feeds an earlier call reported, run_totals and recent carry the run so far (the cursor keeps them), and writes lists the supervisor's own writes and refusals (linked to its actions by cid). Bounded reconciliation compaction is explicit incomplete history. Raw feeds remain available for audit. No second history store.",
    input: obj({ run: int("Recorder run for first read", 1, Number.MAX_SAFE_INTEGER), cursor: cursorSchema, detail: bool("Include all retained source records and events"), now: bool("Include current digest, default true; false avoids another game-thread read"), replay_files: bool("Recover older history from the native private chunks, default true; bounded 8 MiB/1024 rows per call, more requests the next page") }),
    local: async (input, context) => ({ value: await catchUp(timelineApi(context), { run: input.run as number | undefined, cursor: input.cursor as TimelineCursor | undefined, detail: input.detail as boolean | undefined, digest: input.now as boolean | undefined, archive: input.replay_files as boolean | undefined, signal: context.signal }) }), refusals: ["test_hooks_off", "recording_changed"] },
  { name: "capture.arm", title: "Arm a source-event capture", permission: "read",
    description: "Autonomous test recorder required. One tools-process-owned arm, polled through the same command connection. Fires screenshot/burst/recrop on future exact recorder data.event or session kind (line.widget_created, toast.created, npc.arrived, dm.quest with match). Match uses scalar equality on event data. Delay is measured from source time, with latency bounds recorded; the recorder's identity and activity are checked again just before the capture, and the arm is cancelled if the recorder stopped or restarted. Coverage depends on the trigger's feed: with channel (a recorder event such as line.widget_created on subtitles) the arm is cancelled, with the exact reason, by recorder loss after arming (dropped rows, a writer error, lost history, invalid samples on that channel, missed deadlines on a polled channel: v, actors, camera, ui); without channel it is a session-feed arm (dm.quest, npc.arrived, supervisor.*), cancelled only by session-feed loss, and recorder loss while armed is reported with its receipt (recorder_loss_while_armed). Busy commands/polling can make a capture late. Default keeps overlays for consumer evidence. Count <=8 and expiry <=120s; close/kill/handover cancels. Use a persistent MCP/session runner; a one-shot CLI closes and cancels its arm. Recrop processes an existing image and cannot observe a new event.",
    input: obj({ run: int("Recorder run", 1, Number.MAX_SAFE_INTEGER), event: str("Exact event name", { minLength: 1, maxLength: 64 }), channel: oneOf("The recorder channel that carries the event; omit for a session-feed event", ["v", "actors", "camera", "subtitles", "voice", "face", "ui", "contacts", "incidents"]), match: matchSchema, capture: oneOf("Capture command", ["screenshot", "burst", "recrop"]), args: { ...obj({}), description: "Arguments for the selected capture command; validated before arming" }, delay_ms: int("Source-timed delay, default 50", 0, 2000), count: int("Maximum captures, default 1", 1, 8), expires_s: int("Arm lifetime, default 30 seconds", 1, 120) }, ["run", "event", "capture"]),
    local: async (input, context) => ({ value: await context.api.eventCaptures.arm(input as CaptureArm, timelineApi(context)) }), refusals: [] },
  { name: "capture.armed", title: "Read armed capture receipts", permission: "read", description: "Current process-owned arm and last 32 receipts, including source event, capture paths and event-to-capture latency bounds. No new capture.", input: obj({}), local: async (_, context) => ({ value: context.api.eventCaptures.status() }), refusals: [] },
  { name: "capture.disarm", title: "Cancel the armed capture", permission: "read", description: "Cancel this tools process's pending capture and preserve its bounded receipts.", input: obj({}), local: async (_, context) => ({ value: context.api.eventCaptures.cancel() }), refusals: [] },
];

export function addWhen(list: CommandDef[]): CommandDef[] {
  const when = { ...obj({ phase: oneOf("Required phase", ["gameplay", "photo_mode", "main_menu", "menu", "paused", "character_menu"]), vehicle: bool("V must be mounted/unmounted"), combat: bool("V must be in/out of combat"), photo_mode: bool("Photo mode must be active/inactive"), spawned: { type: "array" as const, description: "Returned spawn handles that must still resolve", minItems: 1, maxItems: 16, items: int("Spawn handle", 1, 2147483647) } }), description: "Conditions compared on each executing game frame" };
  return list.map(command => {
    if (command.name === "capture.arm") command = { ...command, input: { ...command.input, properties: { ...command.input.properties,
      args: { description: "Arguments for selected screenshot, burst or recrop; exact command schema checked before arming", anyOf: list.filter(c => ["capture.screenshot", "capture.burst", "capture.recrop"].includes(c.name)).map(c => c.input) } } } };
    const timed = ["write-photo", "write-player", "act-player", "write-dm"].includes(command.permission) || command.name === "game.continue";
    if (!timed || command.name.startsWith("behave.") || /(?:^|\.)(?:stop|clear|remove|despawn)$/.test(command.name)) return command;
    return { ...command, input: { ...command.input, properties: { ...command.input.properties, when } },
      description: command.description + " Optional when compares live conditions immediately before each native changing frame; unmet conditions return precondition_failed with observed state. Autonomous test candidate only. Multi-step actions can refuse after earlier steps; external key routes cannot provide this guarantee.",
      refusals: [...(command.refusals ?? []), "precondition_failed", "precondition_unavailable"] };
  });
}
