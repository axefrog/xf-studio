import { expect, test } from "bun:test";
import { DesktopWorkspaceClose, desktopFlushScript } from "../workspace-close";

test("native close is cancelled until the matching renderer write acknowledgement", () => {
  const requested: string[] = [], reports: string[] = [];
  let closed = 0;
  const gate = new DesktopWorkspaceClose({
    requestFlush: nonce => { requested.push(nonce); }, close: () => { closed++; },
    report: message => { reports.push(message); },
  });
  const event: { response?: { allow: boolean } } = {};
  gate.request(event);
  gate.request(event);
  expect(event.response).toEqual({ allow: false });
  expect(requested).toHaveLength(1);
  expect(gate.acknowledge("different", "saved")).toBe(false);
  expect(closed).toBe(0);
  expect(gate.acknowledge(requested[0], "saved")).toBe(true);
  expect(closed).toBe(1);
  expect(reports).toHaveLength(0);
  expect(gate.acknowledge(requested[0], "saved")).toBe(false);
  expect(desktopFlushScript(requested[0])).toContain(`nonce: "${requested[0]}"`);
  expect(desktopFlushScript(requested[0])).toContain("await window.xfDesktopWorkspaceFlush?.()");
});

test("failed or timed-out workspace writes leave the window open and allow a retry", async () => {
  const requested: string[] = [], reports: string[] = [];
  let closed = 0;
  const gate = new DesktopWorkspaceClose({
    requestFlush: nonce => { requested.push(nonce); }, close: () => { closed++; },
    report: message => { reports.push(message); },
  }, 15);
  gate.request({});
  expect(gate.acknowledge(requested[0], "failed")).toBe(true);
  expect(closed).toBe(0);
  gate.request({});
  await Bun.sleep(30);
  expect(closed).toBe(0);
  expect(reports).toHaveLength(2);
  expect(gate.acknowledge(requested[1], "saved")).toBe(false);
  gate.request({});
  expect(gate.acknowledge(requested[2], "saved")).toBe(true);
  expect(closed).toBe(1);
});
