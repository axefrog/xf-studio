// The capability registry's tool (tools/capabilities.ts, tools/capabilities-edit.ts): the real registry validates and its
// page is current; the validator catches each class of error on small fixtures; the render is stable; the changelog
// digest; and the edit commands refuse the wrong owner, invalid values and unknown ids, write nothing when the result
// would not validate, and log every change completely.

import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAP_DIR, PAGE, digest, formatChange, formatItems, itemDigest, load, realContext, renderHtml, renderMarkdown, testCardRows, validate, view,
  type Context,
} from "../capabilities.ts";
import { JOURNAL, LOCK, runEdit, suggestEvidence } from "../capabilities-edit.ts";
import { tempDir } from "./temp-dir.ts";

type Any = any;

const CONTEXT: Context = { commands: new Set(["a.read", "a.write"]), rows: new Set(["R1", "R2", "R3"]), repoDir: null, projectDir: null };
const itemSchema = JSON.parse(readFileSync(join(CAP_DIR, "schema", "item.schema.json"), "utf8"));
const changeSchema = JSON.parse(readFileSync(join(CAP_DIR, "schema", "changelog.schema.json"), "utf8"));

const REGISTRY = {
  schema: "xfb/capability-registry-1",
  owner: "runtime-bridge",
  areas: [
    { id: "alpha", title: "Alpha", summary: "The first area." },
    { id: "beta", title: "Beta", summary: "The second area." },
  ],
  consumers: [
    { id: "runtime-bridge", title: "XF · Runtime bridge", kind: "chat" },
    { id: "story-engine", title: "XF · Story Engine", kind: "chat" },
    { id: "studio", title: "XF · Studio", kind: "chat" },
  ],
};

const item = (id: string, extra: Any = {}): Any => ({
  id, title: `Title of ${id}`, summary: `What ${id} does.`, area: id.split(".")[0], kind: "verb",
  stage: "merged", evidence: "offline", health: "works", priority: "P3", updated: "2026-10-26", ...extra,
});

const added = (ids: string[], at = "2026-10-26T09:00:00+10:00") => ({ at, by: "runtime-bridge", kind: "added", items: ids, summary: "Added." });

/** A scratch registry: the real schemas, the fixture registry, items by area and changelog lines (all in the tool's format). */
function fixture(items: Record<string, Any[]>, changes: Any[] = [added(Object.values(items).flat().map((i) => i.id))], raw: Record<string, string> = {}): string {
  const dir = tempDir("xfb-capabilities-");
  cpSync(join(CAP_DIR, "schema"), join(dir, "schema"), { recursive: true });
  writeFileSync(join(dir, "registry.json"), JSON.stringify(REGISTRY, null, 2) + "\n");
  mkdirSync(join(dir, "items"));
  mkdirSync(join(dir, "changelog"));
  for (const [area, list] of Object.entries(items)) writeFileSync(join(dir, "items", `${area}.json`), formatItems(list, itemSchema));
  // Each line records the digest of the items it names, as the tool writes them (unless the test gave its own).
  const byId = new Map(Object.values(items).flat().map((i) => [i.id, i]));
  const withDigests = changes.map((c) => (c.digests || !c.items ? c : { ...c, digests: Object.fromEntries(c.items.filter((id: string) => byId.has(id)).map((id: string) => [id, itemDigest(byId.get(id), itemSchema)])) }));
  writeFileSync(join(dir, "changelog", "2026-10.jsonl"), withDigests.map((c) => formatChange(c, changeSchema)).join("\n") + "\n");
  for (const [path, text] of Object.entries(raw)) writeFileSync(join(dir, path), text);
  return dir;
}

const problems = (dir: string) => validate(load(dir), CONTEXT);
const expectProblem = (dir: string, pattern: RegExp) => {
  const errors = problems(dir);
  expect(errors.some((e) => pattern.test(e)), `expected ${pattern} in:\n${errors.join("\n")}`).toBe(true);
};

describe("the real registry", () => {
  test("validates", async () => {
    expect(validate(load(), await realContext())).toEqual([]);
  }, 60_000);
  test("CAPABILITIES.md is current (bun tools/capabilities.ts render)", () => {
    expect(readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n")).toBe(renderMarkdown(view(load())));
  });
});

describe("the validator", () => {
  test("a clean fixture passes", () => {
    expect(problems(fixture({ alpha: [item("alpha.one"), item("alpha.two", { depends_on: ["alpha.one"] })] }))).toEqual([]);
  });
  test("schema: a value outside its vocabulary, an unknown field, a bad date", () => {
    const dir = fixture({ alpha: [item("alpha.one", { stage: "shipped", colour: "red", updated: "2026-13-40" })] });
    expectProblem(dir, /alpha\.one: stage: 'shipped' is not one of/);
    expectProblem(dir, /unknown field 'colour'/);
    expectProblem(dir, /'2026-13-40' is not a date/);
  });
  test("unique ids and the area prefix of each id", () => {
    expectProblem(fixture({ alpha: [item("alpha.one"), item("alpha.one")] }), /the id is already used/);
    expectProblem(fixture({ alpha: [item("beta.one", { area: "alpha" })] }), /area prefix 'beta' doesn't match items\/alpha\.json/);
  });
  test("known areas and consumers", () => {
    expectProblem(fixture({ gamma: [item("gamma.one")] }), /'gamma' is not an area/);
    expectProblem(fixture({ alpha: [item("alpha.one", { demand: [{ consumer: "nobody", level: "needs", since: "2026-10-26" }] })] }), /'nobody' is not a consumer/);
  });
  test("depends_on and parent resolve, without cycles", () => {
    expectProblem(fixture({ alpha: [item("alpha.one", { depends_on: ["alpha.ghost"] })] }), /depends_on 'alpha\.ghost' is not an item/);
    expectProblem(fixture({ alpha: [item("alpha.one", { depends_on: ["alpha.two"] }), item("alpha.two", { depends_on: ["alpha.one"] })] }), /depends_on has a cycle/);
    expectProblem(fixture({ alpha: [item("alpha.one", { parent: "alpha.two" }), item("alpha.two", { parent: "alpha.one" })] }), /parent has a cycle/);
    expectProblem(fixture({ alpha: [item("alpha.one", { parent: "alpha.ghost" })] }), /parent 'alpha\.ghost' is not an item/);
  });
  test("commands against the catalogue, rows against the test card", () => {
    expectProblem(fixture({ alpha: [item("alpha.one", { surface: { commands: ["a.ghost"] } })] }), /'a\.ghost' is not in the command catalogue/);
    expectProblem(fixture({ alpha: [item("alpha.one", { verification: { rows: [{ row: "R9", verdict: "unrun" }] } })] }), /'R9' is not a row of the test card/);
  });
  test("evidence rules: proven needs a passed row; a verdict needs its session", () => {
    expectProblem(fixture({ alpha: [item("alpha.one", { evidence: "proven" })] }), /proven' needs at least one test-card row that passed/);
    expectProblem(fixture({ alpha: [item("alpha.one", { verification: { rows: [{ row: "R1", verdict: "pass" }] } })] }), /a pass verdict needs the session/);
  });
  test("P0 and P1 need a reason; building and built need a branch", () => {
    expectProblem(fixture({ alpha: [item("alpha.one", { priority: "P1" })] }), /P1 needs a priority_reason/);
    expectProblem(fixture({ alpha: [item("alpha.one", { stage: "built" })] }), /stage 'built' needs the branch/);
  });
  test("the changelog: schema, time order, month file, by, items", () => {
    const one = [item("alpha.one")];
    expectProblem(fixture({ alpha: one }, [added(["alpha.one"], "2026-10-26T10:00:00+10:00"), added(["alpha.one"], "2026-10-26T09:00:00+10:00")]), /earlier than/);
    expectProblem(fixture({ alpha: one }, [{ ...added(["alpha.one"]), kind: "shipped" }]), /kind: 'shipped' is not one of/);
    expectProblem(fixture({ alpha: one }, [added(["alpha.one"]), { ...added(["alpha.one"], "2026-11-01T09:00:00+10:00") }]), /the file is for 2026-10/);
    expectProblem(fixture({ alpha: one }, [{ ...added(["alpha.one"]), by: "someone" }]), /by 'someone' is not a consumer/);
    expectProblem(fixture({ alpha: one }, [added(["alpha.one", "alpha.ghost"])]), /'alpha\.ghost' is not an item/);
    expectProblem(fixture({ alpha: one }, [added(["alpha.one"]), { at: "2026-10-26T10:00:00+10:00", by: "runtime-bridge", kind: "stage", items: ["alpha.one"], summary: "x" }]), /a stage change gives from and to/);
  });
  test("every item's updated date has a changelog line touching it on or after it", () => {
    expectProblem(fixture({ alpha: [item("alpha.one", { updated: "2026-10-27" })] }), /updated 2026-10-27, but no changelog line touches it/);
    expectProblem(fixture({ alpha: [item("alpha.one")] }, [{ at: "2026-10-26T09:00:00+10:00", by: "runtime-bridge", kind: "registry", summary: "x" }]), /no changelog line touches it/);
  });
  test("a hand-edited file (not in the tool's format) is caught", () => {
    const dir = fixture({ alpha: [item("alpha.one")] });
    writeFileSync(join(dir, "items", "alpha.json"), JSON.stringify([item("alpha.one")]));
    expectProblem(dir, /items\/alpha\.json: not in the tool's format/);
  });
  test("test-card rows: the first cells of the test tables' body rows, never a header, never another table", () => {
    const card = [
      "| Row | Do |", "|---|---|", "| CS8181 — hostile | x |", "| B318-3b — stale | y |", "| **ST7** | z |", "",
      "| # | Who | Do |", "|---|---|---|", "| 11 | C | w |", "",
      "| Group | What |", "|---|---|", "| Z | launch |", "",
      "| File | SHA-256 |", "|---|---|", "| XFRuntimeBridge.dll | abc |", "",
      "text | Q9 |",
    ].join("\n");
    expect([...testCardRows(card)]).toEqual(["CS8181", "B318-3b", "ST7", "11"]);
    for (const header of ["Row", "#", "Group", "File", "Z"]) expect(testCardRows(card).has(header)).toBe(false);
  });
  test("proven needs every required row to pass; optional rows are marked", () => {
    const rows = (...r: Any[]) => ({ evidence: "proven", verification: { rows: r } });
    const pass = { row: "R1", verdict: "pass", session: "s" };
    expectProblem(fixture({ alpha: [item("alpha.one", rows(pass, { row: "R2", verdict: "unrun" }))] }), /proven' needs every required row to pass: R2 is unrun/);
    expectProblem(fixture({ alpha: [item("alpha.one", rows(pass, { row: "R2", verdict: "partial", session: "s" }))] }), /R2 is partial/);
    expect(problems(fixture({ alpha: [item("alpha.one", rows(pass, { row: "R2", verdict: "unrun", optional: true }))] }))).toEqual([]);
    expectProblem(fixture({ alpha: [item("alpha.one", rows({ row: "R2", verdict: "unrun", optional: true }))] }), /needs at least one test-card row that passed/);
  });
  test("an item changed without a new changelog line is caught, even on the same day", () => {
    const dir = fixture({ alpha: [item("alpha.one")] });
    writeFileSync(join(dir, "items", "alpha.json"), formatItems([item("alpha.one", { summary: "Quietly different." })], itemSchema));
    expectProblem(dir, /alpha\.one: changed since its last changelog line/);
  });
});

describe("render", () => {
  const dir = () => fixture({
    alpha: [item("alpha.one", { demand: [{ consumer: "story-engine", level: "blocking", ref: "S7", since: "2026-10-26" }], known_issues: [{ summary: "It breaks.", severity: "high", status: "open", since: "2026-10-26" }] }), item("alpha.two", { evidence: "partial", verification: { rows: [{ row: "R1", verdict: "pass", session: "s1" }] } })],
    beta: [item("beta.one", { stage: "planned", evidence: "none", health: "unknown" })],
  });
  test("is stable and generated-marked, with the summary sections", () => {
    const d = dir();
    const first = renderMarkdown(view(load(d)));
    expect(renderMarkdown(view(load(d)))).toBe(first);
    expect(first.startsWith("<!-- GENERATED by tools/capabilities.ts")).toBe(true);
    for (const heading of ["## Summary", "### Evidence debt", "### Open known issues", "### Unmet demand", "## Alpha", "## Beta"]) expect(first).toContain(heading);
    expect(first).toContain('<a id="alpha.one"></a>');
    expect(first).toMatch(/\| blocking \| S7 \|/);
    // alpha.one is merged with offline evidence: debt; alpha.two has a passed row: not.
    expect(first).toMatch(/\[`alpha\.one`\]\(#alpha\.one\) Title of alpha\.one \| merged \| offline/);
    expect(first).not.toMatch(/\[`alpha\.two`\]\(#alpha\.two\) Title of alpha\.two \| merged \| partial \| /);
  });
  test("the HTML page is self-contained: no external fetches, both themes, filters and a changelog tab", () => {
    const html = renderHtml(view(load(dir())));
    expect(html).not.toMatch(/(src|href)=["']https?:/);
    expect(html).not.toContain("fetch(");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('data-tab="changes"');
    for (const key of ["area", "stage", "evidence", "health", "consumer"]) expect(html).toContain(`${key}: ""`);
    expect(renderHtml(view(load(dir())))).toBe(html);
  });
  test("the changelog digest", () => {
    const d = fixture({ alpha: [item("alpha.one")] }, [added(["alpha.one"], "2026-10-20T09:00:00+10:00"), { at: "2026-10-26T09:00:00+10:00", by: "runtime-bridge", kind: "stage", items: ["alpha.one"], from: "built", to: "merged", summary: "Merged." }]);
    const text = digest(view(load(d)).changes, "2026-10-25");
    expect(text).toContain("Capability changes since 2026-10-25: 1.");
    expect(text).toContain('- stage "built" -> "merged" (runtime-bridge): Merged. [alpha.one]');
    expect(digest(view(load(d)).changes, "2026-11-01")).toBe("No capability changes since 2026-11-01.\n");
  });
});

describe("edits", () => {
  const AT = "2026-10-26T11:00:00+10:00";
  const base = () => fixture({ alpha: [item("alpha.one"), item("alpha.two", { depends_on: ["alpha.one"], verification: { rows: [{ row: "R1", verdict: "unrun" }] } })], beta: [item("beta.one", { parent: "alpha.one" })] });
  const edit = (dir: string, ...argv: string[]) => runEdit(argv, { capDir: dir, context: CONTEXT, at: AT });
  const lines = (dir: string) => readFileSync(join(dir, "changelog", "2026-10.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const read = (dir: string, area: string) => JSON.parse(readFileSync(join(dir, "items", `${area}.json`), "utf8")) as Any[];
  const snapshot = (dir: string) => ["items/alpha.json", "items/beta.json", "changelog/2026-10.jsonl"].map((p) => readFileSync(join(dir, p), "utf8")).join("\n---\n");

  test("refuses an owner field for anyone but the owner, and writes nothing", async () => {
    const dir = base();
    const before = snapshot(dir);
    const result = await edit(dir, "stage", "alpha.one", "built", "--as", "story-engine");
    expect(result.code).toBe(1);
    expect(result.err).toContain("owner field");
    expect((await edit(dir, "issue", "add", "alpha.one", "--summary", "x", "--severity", "low", "--as", "studio")).err).toContain("owner field");
    expect((await edit(dir, "add", "alpha", "alpha.three", "--title", "t", "--summary", "s", "--kind", "verb", "--as", "studio")).err).toContain("owner field");
    expect(snapshot(dir)).toBe(before);
  });
  test("refuses an unknown consumer, an unknown id and an invalid value", async () => {
    const dir = base();
    expect((await edit(dir, "stage", "alpha.one", "built", "--as", "nobody")).err).toContain("'nobody' is not a consumer");
    expect((await edit(dir, "stage", "alpha.ghost", "built")).err).toContain("'alpha.ghost' is not an item");
    expect((await edit(dir, "stage", "alpha.one", "shipped")).err).toContain("stage 'shipped' is not one of");
    expect((await edit(dir, "demand", "alpha.one", "--level", "urgent", "--as", "story-engine")).err).toContain("level 'urgent' is not one of");
    expect((await edit(dir, "set", "alpha.one", "demand", "[]")).err).toContain("demand entries change through");
  });
  test("a result that would not validate writes nothing and says why", async () => {
    const dir = base();
    const before = snapshot(dir);
    const p1 = await edit(dir, "priority", "alpha.one", "P1");
    expect(p1.code).toBe(1);
    expect(p1.err).toContain("nothing written");
    expect(p1.err).toContain("P1 needs a priority_reason");
    const proven = await edit(dir, "evidence", "alpha.one", "proven");
    expect(proven.err).toContain("needs at least one test-card row that passed");
    const command = await edit(dir, "set", "alpha.one", "surface.commands", '["a.ghost"]');
    expect(command.err).toContain("not in the command catalogue");
    expect(snapshot(dir)).toBe(before);
  });
  test("an axis change logs its kind, from, to, items and refs, and sets updated", async () => {
    const dir = base();
    const result = await edit(dir, "priority", "alpha.one", "P1", "--reason", "Blocks the next session.", "--ref", "abc123");
    expect(result.code, result.err).toBe(0);
    const line = lines(dir).at(-1);
    expect(line).toEqual({ at: AT, by: "runtime-bridge", kind: "priority", items: ["alpha.one"], from: "P3", to: "P1", summary: expect.any(String), refs: ["abc123"], digests: { "alpha.one": expect.any(String) } });
    const one = read(dir, "alpha").find((i) => i.id === "alpha.one");
    expect(one.priority_reason).toBe("Blocks the next session.");
    expect(one.updated).toBe("2026-10-26");
    expect(problems(dir)).toEqual([]);
  });
  test("a consumer adds, updates and meets its own demand; never another's", async () => {
    const dir = base();
    expect((await edit(dir, "demand", "alpha.one", "--level", "needs", "--ref", "S7", "--milestone", "M4", "--note", "One report per incident.", "--as", "story-engine")).code).toBe(0);
    expect((await edit(dir, "demand", "alpha.one", "--level", "blocking", "--ref", "S7", "--as", "story-engine")).code).toBe(0);
    let demand = read(dir, "alpha").find((i) => i.id === "alpha.one").demand;
    expect(demand).toEqual([{ consumer: "story-engine", level: "blocking", ref: "S7", milestone: "M4", note: "One report per incident.", since: "2026-10-26" }]);
    expect((await edit(dir, "demand-met", "alpha.one", "--consumer", "story-engine", "--as", "studio")).err).toContain("only story-engine");
    expect((await edit(dir, "demand-met", "alpha.one", "--as", "story-engine")).code).toBe(0);
    demand = read(dir, "alpha").find((i) => i.id === "alpha.one").demand;
    expect(demand[0].met).toBe("2026-10-26");
    expect(lines(dir).slice(-3).map((l) => [l.kind, l.by])).toEqual([["demand", "story-engine"], ["demand", "story-engine"], ["demand", "story-engine"]]);
    expect(problems(dir)).toEqual([]);
  });
  test("verdict updates every item listing the row and suggests, never silently applies, an evidence change", async () => {
    const dir = base();
    const result = await edit(dir, "verdict", "R1", "pass", "--session", "borg-5", "--build", "0.8.23");
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("suggestion: alpha.two evidence offline -> proven");
    const two = read(dir, "alpha").find((i) => i.id === "alpha.two");
    expect(two.verification.rows[0]).toEqual({ row: "R1", verdict: "pass", session: "borg-5", build: "0.8.23", date: "2026-10-26" });
    expect(two.evidence).toBe("offline");
    expect((await edit(dir, "verdict", "R1", "pass", "--session", "borg-5", "--apply")).code).toBe(0);
    expect(read(dir, "alpha").find((i) => i.id === "alpha.two").evidence).toBe("proven");
    expect(lines(dir).at(-1)).toMatchObject({ kind: "evidence", from: "offline", to: "proven", items: ["alpha.two"] });
    expect((await edit(dir, "verdict", "R9", "pass", "--session", "x")).err).toContain("no item lists row R9");
    expect(suggestEvidence("proven", ["fail"])).toBe("regressed");
    expect(suggestEvidence("offline", ["pass", "unrun"])).toBe("partial");
  });
  test("issues, quirks, unknowns and improvements each log a line", async () => {
    const dir = base();
    expect((await edit(dir, "issue", "add", "alpha.one", "--summary", "It drifts.", "--severity", "medium", "--ref", "RB-1")).code).toBe(0);
    expect((await edit(dir, "issue", "update", "alpha.one", "RB-1", "--status", "fixed-unverified")).code).toBe(0);
    expect((await edit(dir, "issue", "close", "alpha.one", "1")).code).toBe(0);
    expect((await edit(dir, "quirk", "add", "alpha.one", "It", "answers", "late.")).code).toBe(0);
    expect((await edit(dir, "unknown", "add", "alpha.one", "--question", "Why?", "--settle-by", "R2", "--needs-game")).code).toBe(0);
    expect((await edit(dir, "improve", "add", "alpha.one", "--summary", "Faster.", "--value", "high", "--effort", "small")).code).toBe(0);
    const one = read(dir, "alpha").find((i) => i.id === "alpha.one");
    expect(one.known_issues).toEqual([{ summary: "It drifts.", severity: "medium", status: "fixed", since: "2026-10-26", ref: "RB-1" }]);
    expect(one.quirks).toEqual(["It answers late."]);
    expect(one.unknowns).toEqual([{ question: "Why?", settle_by: "R2", needs_game: true }]);
    expect(lines(dir).slice(-6).map((l) => l.kind)).toEqual(["issue", "issue", "issue", "detail", "detail", "detail"]);
    expect(problems(dir)).toEqual([]);
  });
  test("a request filed by its consumer, then triaged into an item with its demand carried across", async () => {
    const dir = base();
    expect((await edit(dir, "request", "story-engine", "beta.ask", "--title", "An ask", "--summary", "Please.", "--kind", "verb", "--ref", "V9", "--as", "studio")).err).toContain("only story-engine");
    expect((await edit(dir, "request", "story-engine", "beta.ask", "--title", "An ask", "--summary", "Please.", "--kind", "verb", "--ref", "V9", "--as", "story-engine")).code).toBe(0);
    expect(existsSync(join(dir, "requests", "story-engine.json"))).toBe(true);
    expect((await edit(dir, "triage", "beta.ask", "--into", "alpha.one", "--as", "story-engine")).err).toContain("owner field");
    expect((await edit(dir, "triage", "beta.ask", "--into", "alpha.one")).code).toBe(0);
    expect(read(dir, "alpha").find((i) => i.id === "alpha.one").demand).toEqual([{ consumer: "story-engine", level: "needs", ref: "V9", since: "2026-10-26" }]);
    expect(JSON.parse(readFileSync(join(dir, "requests", "story-engine.json"), "utf8"))).toEqual([]);
    expect(problems(dir)).toEqual([]);
  });
  test("rename updates depends_on and parent everywhere and logs it; retire names the replacement", async () => {
    const dir = base();
    const result = await edit(dir, "rename", "alpha.one", "alpha.first");
    expect(result.code, result.err).toBe(0);
    expect(read(dir, "alpha").find((i) => i.id === "alpha.two").depends_on).toEqual(["alpha.first"]);
    expect(read(dir, "beta")[0].parent).toBe("alpha.first");
    expect(lines(dir).slice(-3).map((l) => [l.kind, l.items])).toEqual([["removed", ["alpha.one"]], ["added", ["alpha.first"]], ["detail", ["alpha.two", "beta.one"]]]);
    expect((await edit(dir, "retire", "alpha.two", "--by", "alpha.ghost")).err).toContain("'alpha.ghost' is not an item");
    expect((await edit(dir, "retire", "alpha.two", "--by", "alpha.first")).code).toBe(0);
    expect(lines(dir).at(-1)).toMatchObject({ kind: "retired", from: "merged", to: "retired", items: ["alpha.two", "alpha.first"] });
    expect(problems(dir)).toEqual([]);
  });
  test("a request promoted under its own id keeps every reference", async () => {
    const dir = base();
    expect((await edit(dir, "request", "story-engine", "beta.ask", "--title", "An ask", "--summary", "Please.", "--kind", "verb", "--as", "story-engine")).code).toBe(0);
    expect((await edit(dir, "set", "alpha.two", "depends_on", '["alpha.one","beta.ask"]')).code).toBe(0);
    const result = await edit(dir, "triage", "beta.ask", "--into", "beta.ask", "--stage", "planned");
    expect(result.code, result.err).toBe(0);
    const promoted = read(dir, "beta").find((i) => i.id === "beta.ask");
    expect(promoted).toMatchObject({ stage: "planned", area: "beta", demand: [{ consumer: "story-engine", level: "needs" }] });
    expect(JSON.parse(readFileSync(join(dir, "requests", "story-engine.json"), "utf8"))).toEqual([]);
    expect(read(dir, "alpha").find((i) => i.id === "alpha.two").depends_on).toEqual(["alpha.one", "beta.ask"]);
    expect(lines(dir).at(-1)).toMatchObject({ kind: "added", items: ["beta.ask"] });
    expect(problems(dir)).toEqual([]);
  });
  test("every edit regenerates CAPABILITIES.md in the same write, so the page never drifts", async () => {
    const dir = base();
    expect((await edit(dir, "health", "alpha.one", "caveats")).code).toBe(0);
    expect(readFileSync(join(dir, "CAPABILITIES.md"), "utf8")).toBe(renderMarkdown(view(load(dir))));
    expect(readFileSync(join(dir, "CAPABILITIES.md"), "utf8")).toContain("health **caveats**");
  });
  test("every edit's lines carry the digests of the items they name", async () => {
    const dir = base();
    expect((await edit(dir, "health", "alpha.one", "caveats")).code).toBe(0);
    const one = read(dir, "alpha").find((i) => i.id === "alpha.one");
    expect(lines(dir).at(-1).digests).toEqual({ "alpha.one": itemDigest(one, itemSchema) });
  });
  test("every successful edit leaves a valid registry with a line for each touched item (changelog completeness)", async () => {
    const dir = base();
    const edits: string[][] = [
      ["add", "beta", "beta.two", "--title", "Two", "--summary", "The second.", "--kind", "sense", "--commands", "a.read"],
      ["set", "beta.two", "notes", "Plain text value."],
      ["stage", "beta.two", "planned"],
      ["health", "alpha.one", "caveats"],
      ["limit", "add", "beta.two", "At most five."],
    ];
    for (const argv of edits) {
      const count = lines(dir).length;
      const result = await edit(dir, ...argv);
      expect(result.code, `${argv.join(" ")}: ${result.err}`).toBe(0);
      const added = lines(dir).slice(count);
      expect(added.length).toBeGreaterThan(0);
      for (const line of added) expect(line.at).toBe(AT);
      expect(problems(dir), argv.join(" ")).toEqual([]);
    }
    expect(lines(dir).slice(-5).map((l) => l.kind)).toEqual(["added", "detail", "stage", "health", "detail"]);
  });
});

describe("edit transactions and the lock", () => {
  const AT = "2026-10-26T11:00:00+10:00";
  const base = () => fixture({ alpha: [item("alpha.one"), item("alpha.two")], beta: [item("beta.one")] });
  const files = (dir: string) => ["items/alpha.json", "items/beta.json", "changelog/2026-10.jsonl"].map((p) => readFileSync(join(dir, p), "utf8")).join("\n---\n");
  const leftovers = (dir: string) => [".", "items", "changelog", "requests"].flatMap((d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter((f) => f.includes(".tmp-") || f === JOURNAL || f === LOCK) : []));

  test("a failure while writing the new files publishes nothing and leaves no temp file", async () => {
    const dir = base();
    const before = files(dir);
    let writes = 0;
    const result = await runEdit(["quirk", "add", "alpha.one", "Slow."], { capDir: dir, context: CONTEXT, at: AT, fault: (step) => { if (step === "temp" && ++writes === 2) throw new Error("disk full"); } });
    expect(result.code).toBe(1);
    expect(result.err).toContain("disk full");
    expect(files(dir)).toBe(before);
    expect(leftovers(dir)).toEqual([]);
  });
  test("a crash part-way through publishing is completed by recovery on the next start", async () => {
    const dir = base();
    let renames = 0;
    const crashed = await runEdit(["quirk", "add", "alpha.one", "Slow."], { capDir: dir, context: CONTEXT, at: AT, fault: (step) => { if (step === "rename" && ++renames === 2) throw new Error("power cut"); } });
    expect(crashed.code).toBe(1);
    expect(existsSync(join(dir, JOURNAL))).toBe(true);
    // Half published: the next start finishes it before anything else.
    const next = await runEdit(["list"], { capDir: dir, context: CONTEXT, at: AT });
    expect(next.code, next.err).toBe(0);
    expect(next.out).toContain("recovered");
    expect(leftovers(dir)).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "items", "alpha.json"), "utf8"))[0].quirks).toEqual(["Slow."]);
    expect(readFileSync(join(dir, "changelog", "2026-10.jsonl"), "utf8")).toContain("Slow.");
    expect(problems(dir)).toEqual([]);
  });
  test("validate reports an interrupted edit that awaits recovery", async () => {
    const dir = base();
    await runEdit(["quirk", "add", "alpha.one", "Slow."], { capDir: dir, context: CONTEXT, at: AT, fault: (step) => { if (step === "rename") throw new Error("power cut"); } });
    expectProblem(dir, /an interrupted edit awaits recovery/);
  });
  test("a lock held by a live process refuses after the wait; a stale lock is taken over", async () => {
    const dir = base();
    writeFileSync(join(dir, LOCK), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    const busy = await runEdit(["health", "alpha.one", "caveats"], { capDir: dir, context: CONTEXT, at: AT, lockWaitMs: 200 });
    expect(busy.code).toBe(1);
    expect(busy.err).toContain("another edit holds the registry");
    writeFileSync(join(dir, LOCK), JSON.stringify({ pid: 2_147_483_000, started: new Date().toISOString() }));
    const taken = await runEdit(["health", "alpha.one", "caveats"], { capDir: dir, context: CONTEXT, at: AT, lockWaitMs: 200 });
    expect(taken.code, taken.err).toBe(0);
    expect(existsSync(join(dir, LOCK))).toBe(false);
  });
  test("two consumers editing at once both land, each with its line", async () => {
    const dir = base();
    const script = join(tempDir("xfb-capabilities-child-"), "child.ts");
    writeFileSync(script, `
import { runEdit } from ${JSON.stringify(join(import.meta.dir, "..", "capabilities-edit.ts"))};
const [dir, as] = process.argv.slice(2);
const context = { commands: new Set(["a.read", "a.write"]), rows: new Set(["R1", "R2", "R3"]), repoDir: null, projectDir: null };
for (let n = 0; n < 5; n++) {
  const r = await runEdit(["demand", "alpha.one", "--level", "needs", "--ref", as + "-" + n, "--as", as], { capDir: dir, context, lockWaitMs: 30000 });
  if (r.code) { console.error(r.err); process.exit(1); }
}
`);
    const children = ["story-engine", "studio"].map((as) => Bun.spawn(["bun", script, dir, as], { stdout: "pipe", stderr: "pipe" }));
    const codes = await Promise.all(children.map((c) => c.exited));
    const errs = await Promise.all(children.map((c) => new Response(c.stderr).text()));
    expect(codes, errs.join("\n")).toEqual([0, 0]);
    const demand = JSON.parse(readFileSync(join(dir, "items", "alpha.json"), "utf8"))[0].demand;
    expect(demand.map((d: Any) => d.ref).sort()).toEqual(["story-engine-0", "story-engine-1", "story-engine-2", "story-engine-3", "story-engine-4", "studio-0", "studio-1", "studio-2", "studio-3", "studio-4"]);
    const log = readFileSync(join(dir, "changelog", "2026-10.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.filter((l) => l.kind === "demand").length).toBe(10);
    expect(problems(dir)).toEqual([]);
    expect(leftovers(dir)).toEqual([]);
  }, 60_000);
});
