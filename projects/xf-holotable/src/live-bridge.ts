// Only transport mechanics live here. The source owns timing, cursors and budgets.
import { CommandApi, type CommandApiOptions } from "../../xf-runtime-bridge/tools/api/command-api.ts";

export interface RecorderStatus {
  active: boolean; run: number | null; session: string; world: number | null;
  channels: string[]; start: number | null; wallStart?: string; latest: number | null; stopReason: string | null;
}
export type Discovery = { available: true; recorder: RecorderStatus } | { available: false; reason: string };
export interface LiveBridge {
  discover(signal: AbortSignal): Promise<Discovery>;
  catchup(input: { run?: number; cursor?: unknown; now: false; detail: true }, signal: AbortSignal): Promise<Record<string, any>>;
  close(): void;
}

/** The only mapping of the bridge's 0.8.23 recorder.status contract (RS1 not yet commissioned). */
export function mapRecorderStatus(raw: Record<string, any>): RecorderStatus {
  if (typeof raw.active !== "boolean" || typeof raw.session !== "string" || !raw.session || !Array.isArray(raw.channels) || raw.channels.length > 16 || raw.channels.some((x: unknown) => typeof x !== "string" || x.length > 64)) throw Error("Invalid recorder status");
  if (raw.run === null && (raw.active || raw.channels.length !== 0 || ["world", "start", "latest", "stop_reason", "requested_hz", "duration_s", "byte_cap", "ack"].some(key => raw[key] !== null))) throw Error("Invalid empty recorder status");
  if (raw.active && raw.run === null || raw.run !== null && (!Number.isSafeInteger(raw.run) || raw.run < 1 || typeof raw.session !== "string" || !Number.isSafeInteger(raw.world) || !Number.isFinite(raw.start?.s))) throw Error("Invalid recorder identity");
  return { active: raw.active, run: raw.run, session: raw.session, world: raw.world, channels: raw.channels,
    // s shares the samples' QPC timeline; at is wall-clock display data only.
    start: raw.start?.s ?? null, wallStart: typeof raw.start?.at === "string" && Number.isFinite(Date.parse(raw.start.at)) ? raw.start.at : undefined,
    latest: raw.latest, stopReason: raw.stop_reason ?? null };
}

export function createLiveBridge(createApi: (options: CommandApiOptions) => Pick<CommandApi, "callBridge" | "run" | "close"> = options => new CommandApi(options)): LiveBridge {
  // No writer fallback. No emergency command is ever exposed by this adapter.
  const api = createApi({ readOnly: true, clientTimeoutMs: 2000, rateLimitPatienceMs: 0 });
  return {
    async discover(signal) {
      // callBridge allows using the new native command before all clients have the new catalogue.
      const answer = await api.callBridge("recorder.status", {}, "holotable-status", 2000, signal);
      if (!answer.ok) return { available: false, reason: answer.error.code };
      return { available: true, recorder: mapRecorderStatus(answer.result as Record<string, any>) };
    },
    async catchup(input, signal) {
      const answer = await api.run("game.catchup", input, { signal, source: "holotable" });
      if (!answer.ok) throw Object.assign(new Error(answer.error.message), { code: answer.error.code });
      return answer.result as Record<string, any>;
    },
    close: () => api.close(),
  };
}
