// Asset-free evidence replays; these records are deliberately NOT a native ABI trace.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAssertion, type AssertionSpec } from "../testing/assertions.ts";
import { readR1Trace } from "../testing/input-evidence.ts";
import { TestSession } from "../testing/script.ts";
import { planScript } from "../session.ts";
import { tempDir } from "./temp-dir.ts";
const check = (kind: string, input: object) => evaluateAssertion({ do: "assert", check: kind, ...input } as AssertionSpec);
const window = (data: object[] = [{ request_id: 7, run_id: "test", result: { held: true } }]) => ({ complete: true, cursor: { complete: true, dropped: 0 }, events: data.map((data, i) => ({ seq: i + 1, kind: "input.result", t_ms: i, data })) });
function trace(): any {
  const record = (kind: string, fields = {}) => ({ kind, receiver: "fixture-receiver", t_ms: 1, thread_id: 1, evidence: "asset-free replay reference", ...fields });
  return { schema: "xfb/r1-readonly-trace-1", game: "2.31", sid: "fixture-sid", exe_sha256: "a7de82945c03e041fc7339fcf9066224d98db2f5d80fea50f7947bb350a60991", read_only: true, synthetic_submissions: [], records: [
    record("receiver_acquired", { owner: "fixture-owner", receiver_type: "fixture-type", owner_member_offset: "0x10", acquisition_rva: "0x1", ownership_evidence: "fixture ownership excerpt" }),
    record("dispatch_implementation", { target_rva: "0x2", vtable_slot: "0x1f8", abi_evidence: "fixture disassembly reference" }),
    record("release_implementation", { target_rva: "0x3", helper_rva: "0x29b63f0", caller_rva: "0x29c3bec", abi_evidence: "fixture disassembly reference" }),
    record("axis_zero_implementation", { target_rva: "0x2", vtable_slot: "0x1f8", abi_evidence: "fixture disassembly reference" }),
    ...["pause", "handover", "load"].map((context) => record("lifecycle", { context, lifetime_evidence: "fixture lifetime excerpt" })),
    record("receiver_teardown", { t_ms: 2, lifetime_evidence: "fixture teardown excerpt" }),
  ] };
}
function pin(t: any) {
  const path = join(tempDir("xfb-r1-evidence-"), "trace.json"), raw = JSON.stringify(t);
  writeFileSync(path, raw);
  return { path, sha256: createHash("sha256").update(raw).digest("hex") };
}
describe("input session evidence", () => {
  test("both Borg-mode fixtures plan with returned bindings and no native pulse", () => {
    for (const name of ["input-and-choices", "input-r1-readonly"]) {
      const s = JSON.parse(readFileSync(join(import.meta.dir, `../testing/fixtures/${name}.json`), "utf8"));
      expect(planScript(s).problems).toEqual([]);
      expect(s.steps.some((s: any) => ["test.input.pulse", "player.choice.select"].includes(s.command))).toBe(false);
      if (name === "input-r1-readonly") expect(s.steps.filter((s: any) => s.do === "run").map((s: any) => s.command)).toEqual(["input.probe", "bridge.info"]);
    }
  });
  test("exact event counts match request/run and nested receipt fields", () => {
    expect(check("event_count", { window: window(), kind: "input.result", data: { request_id: 7, result: { held: true } }, count: 1 }).verdict).toBe("PASS");
    expect(check("event_count", { window: window(), kind: "input.result", data: { request_id: 8 }, count: 1 }).verdict).toBe("FAIL");
    expect(check("event_count", { window: window([{}, {}]), kind: "input.result", count: 1 }).verdict).toBe("FAIL");
    expect(check("event_count", { window: { ...window(), events: [{ kind: "save" }] }, kind: "save", count: 1 }).verdict).toBe("PASS");
  });
  test("no event and exact counts never pass on dropped or open history", () => {
    for (const w of [{ ...window([]), complete: false }, { ...window([]), cursor: { complete: true, dropped: 1 } }]) expect(check("event_count", { window: w, kind: "save", count: 0 }).verdict).toBe("INCONCLUSIVE");
    expect(check("event_count", { window: window([{ cut: true }]), kind: "input.result", data: { request_id: 7 }, count: 0 }).verdict).toBe("INCONCLUSIVE");
  });
  test("one save needs settled lists, one addition and no deletion/duplicate", () => {
    const baseline = { ready: true, names: ["fixture-old"] }, actual = { ready: true, names: ["fixture-old", "fixture-new"] };
    expect(check("save_delta", { baseline, actual }).verdict).toBe("PASS");
    for (const names of [["fixture-old"], ["fixture-new"], ["fixture-old", "a", "b"]]) expect(check("save_delta", { baseline, actual: { ready: true, names } }).verdict).toBe("FAIL");
    expect(check("save_delta", { baseline, actual: { ...actual, ready: false } }).verdict).toBe("INCONCLUSIVE");
    expect(check("save_delta", { baseline, actual: { ready: true, names: ["fixture-old", "fixture-new", "fixture-new"] } }).verdict).toBe("INCONCLUSIVE");
  });
  test("R1 rejects status flags, a missing capture and a changed capture hash", () => {
    expect(check("r1_trace", { sid: "fixture-sid", actual: { available: false } }).verdict).toBe("INCONCLUSIVE");
    expect(check("r1_trace", { sid: "fixture-sid", actual: readR1Trace({ path: "absent", sha256: "0".repeat(64) }) }).verdict).toBe("INCONCLUSIVE");
    const ref = pin(trace()); ref.sha256 = "0".repeat(64);
    expect(check("r1_trace", { sid: "fixture-sid", actual: readR1Trace(ref) }).verdict).toBe("FAIL");
  });
  test("R1 records are paired and complete; PASS does not enable the adapter", () => {
    const result = check("r1_trace", { sid: "fixture-sid", actual: readR1Trace(pin(trace())) });
    expect(result.verdict).toBe("PASS"); expect(result.actual).toMatchObject({ adapter_enabled: false });
    for (const kind of ["receiver_acquired", "release_implementation", "axis_zero_implementation", "receiver_teardown"]) {
      const t = trace(); t.records = t.records.filter((r: any) => r.kind !== kind);
      expect(check("r1_trace", { sid: t.sid, actual: readR1Trace(pin(t)) }).verdict).toBe("INCONCLUSIVE");
    }
    const t = trace(); t.records.at(-1).receiver = "different";
    expect(check("r1_trace", { sid: t.sid, actual: readR1Trace(pin(t)) }).verdict).toBe("INCONCLUSIVE");
  });
  test("R1 refuses a different executable/session or any synthetic submission", () => {
    for (const change of [(t: any) => t.exe_sha256 = "0".repeat(64), (t: any) => t.sid = "other", (t: any) => t.synthetic_submissions.push("press"), (t: any) => t.read_only = false]) {
      const t = trace(); change(t);
      expect(check("r1_trace", { sid: "fixture-sid", actual: readR1Trace(pin(t)) }).verdict).toBe("FAIL");
    }
    const t = trace(); t.records[1].t_ms = -1;
    expect(check("r1_trace", { sid: t.sid, actual: readR1Trace(pin(t)) }).verdict).toBe("INCONCLUSIVE");
  });
  test("session execution reads the pinned trace and retains its file evidence", async () => {
    const t = trace(), ref = pin(t);
    const session = new TestSession({ run: async () => { throw new Error("No game command permitted"); } }, { fixtures: { trace: ref } }, tempDir("xfb-r1-session-"), false);
    const result = await session.execute({ do: "assert", check: "r1_trace", row: "IC5", actual: "$fixture.trace", sid: t.sid });
    expect(result.ok).toBe(true); expect((result.result as any).evidence[0]).toMatchObject({ path: ref.path, sha256: ref.sha256 });
  });
});
