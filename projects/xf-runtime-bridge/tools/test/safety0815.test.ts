import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catchUp } from "../testing/timeline.ts";
import { findCommand } from "../api/catalogue.ts";
import { validate } from "../api/schema.ts";
import { packageScripts } from "../redscript-natives.ts";
import { projectDir } from "./helpers.ts";
import type { Json, TestApi } from "../testing/windows.ts";
const source = (name: string) => readFileSync(join(projectDir, "redscript", name), "utf8");

test("2.31 weapon/upper-body interpretation is pinned to script writers, not the stale reflected enum", () => {
  // [source] final.redscripts SHA256 2119046f…ee86, R6 knowledge/navigation-and-safety.md §8:
  // weaponTransitions.script:756–769 Ready=5; :888–892 Safe=6; :1789–1819 Reload=2;
  // :1930–1935 Shoot=8; upperBodyTransitions.script:1326 Aiming=6.
  const player = source("XFRuntimeBridgePlayer.reds");
  for (const [value, name] of [[5, "Ready"], [6, "Safe"], [2, "Reload"], [8, "Shoot"]])
    expect(player).toContain(`case ${value}: name = "${name}";`);
  expect(player).toContain("upper == 6");
  expect(player).not.toContain('EnumValueToString("gamePSMWeaponStates"');
  for (const file of ["XFRuntimeBridgePlayer.reds", "XFRuntimeBridgeSenses.reds", "XFRuntimeBridgeRecording.reds"])
    expect(source(file)).toContain("XFPlayer.WeaponState(player)");
});

test("the car receipt precedes the original early-return handler and contact wrappers stay autonomous", () => {
  const normal = packageScripts(projectDir, "writes", false).map(s => s.text).join("\n");
  const autonomous = packageScripts(projectDir, "writes", true).map(s => s.text).join("\n");
  expect(normal).not.toContain("contact.car_hit_player");
  expect(normal).not.toContain("XFContactReports");
  expect(autonomous).toContain("scriptInterface.ownerEntityID != player.GetEntityID()");
  const callback = autonomous.slice(autonomous.indexOf("protected cb func OnCarHitPlayer("));
  expect(callback.indexOf('XFBridge_Record("contacts"')).toBeLessThan(callback.indexOf("wrappedMethod(evt)"));
  expect(callback).toContain("GetCollisionReport()");
});

test("unknown traffic is explicit and the displacement override is strictly boolean", () => {
  const schema = findCommand("player.teleport")!.input;
  expect(validate(schema, { position: [1, 2, 3], allow_road: true })).toEqual([]);
  expect(validate(schema, { position: [1, 2, 3], allow_road: "true" }).length).toBeGreaterThan(0);
  const navigation = source("XFRuntimeBridgeNavigation.reds");
  expect(navigation).toContain("INCONCLUSIVE");
  expect(navigation).toContain('\\"nearest_pavement\\":null');
  expect(navigation).toContain("IsPathIntersectingWithTraffic(path, 0.0, intersection)");
});

function fixture() {
  const rows: Json[] = [];
  const api: TestApi = { run: async (name, input: Json = {}) => {
    const records = rows.filter(r => r.seq > (input.since ?? 0));
    return { ok: true, command: name, cid: "test", result: name === "bridge.info" ? { sid: "s" } : name === "test.record.read" ? {
      run: 1, session: "s", world_generation: 1, channels: ["contacts"], active: true,
      records, latest: rows.length, next: records.at(-1)?.seq ?? input.since, lost: 0,
    } : { events: [], latest: 0, next: 0, dropped: 0 } };
  } };
  const add = (data: Json) => rows.push({ seq: rows.length + 1, run: 1, session: "s", world_generation: 1,
    valid: true, source_s: 10 + rows.length, channel: "contacts", data });
  return { api, add };
}

test("contact receipts raise alerts, carry identity/time/speed and stay latched across turns", async () => {
  const f = fixture();
  f.add({ event: "contact.car_hit_player", vehicle_hit_observed: true, other_entity: "42", speed_mps: 0.4, position: [1, 2, 3] });
  const first = await catchUp(f.api, { run: 1, digest: false });
  expect(first.alerts[0]).toMatchObject({ kind: "contact", source_s: 10, other_entity: "42", speed_mps: 0.4, position: [1, 2, 3] });
  expect(first.contact_summary).toMatchObject({ message: "contact observed", observed_in_run: true, no_contact_proof: false });
  const second = await catchUp(f.api, { cursor: first.cursor, digest: false });
  expect(second.contact_summary.observed_since_cursor).toBe(false);
  expect(second.contact_summary.observed_in_run).toBe(true);
  expect(second.contact_summary.vehicle_hit_observed_in_run).toBe(true);
  expect(validate(findCommand("game.catchup")!.input, { cursor: second.cursor })).toEqual([]);
});

test("coverage heartbeats are not contacts; controller contacts do not invent vehicle identity", async () => {
  const f = fixture(); f.add({ event: "contact.coverage", no_contact_proof: false });
  const empty = await catchUp(f.api, { run: 1, digest: false });
  expect(empty.alerts).toEqual([]);
  expect(empty.contact_summary.message).toStartWith("no contact observed (covered paths:");
  expect(empty.contact_summary.no_contact_proof).toBe(false);
  f.add({ event: "contact.controller_report", other_entity: null, vehicle_contact_observed: null, supporting_ground_may_be_included: true });
  const report = await catchUp(f.api, { cursor: empty.cursor, digest: false });
  expect(report.contact_summary.observed_since_cursor).toBe(true);
  expect(report.contact_summary.vehicle_hit_observed_in_run).toBe(false);
  expect(report.contact_summary.vehicle_contact_without_hit).toBe("INCONCLUSIVE");
});
