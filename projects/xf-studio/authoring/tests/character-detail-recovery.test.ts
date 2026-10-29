import { expect, test } from "bun:test";
import { CharacterDetailActions, type CharacterDetailPort, type HostCharacterState } from "../src/character/character-detail-actions";
import { DEFAULT_CHARACTER, type CharacterRequest } from "../src/character/character-detail-request";
import { abortable } from "../src/platform/api/abortable";

const failed = (message = "Choose a game folder."): HostCharacterState => ({ key: "old", phase: "failed", message, progress: null, record: null });
const ready: HostCharacterState = { key: "fresh", phase: "ready", message: "", progress: null, record: "prepared.json" };
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function transaction() {
  const validated = Promise.withResolvers<void>();
  const reads: { kind: "request" | "poll"; request?: CharacterRequest; signal: AbortSignal;
    reply: ReturnType<typeof Promise.withResolvers<HostCharacterState>> }[] = [];
  let placements = 0;
  const read = (kind: "request" | "poll", signal: AbortSignal, request?: CharacterRequest) => {
    const reply = Promise.withResolvers<HostCharacterState>(); reads.push({ kind, request, signal, reply });
    return abortable(reply.promise, signal);
  };
  const port: CharacterDetailPort = { request: (request, signal) => read("request", signal, request), poll: (_key, signal) => read("poll", signal),
    clear() {}, wait: async () => {}, show: async () => { placements++; return { slots: [] }; } };
  const actions = new CharacterDetailActions(port, validated.promise), phases: string[] = [];
  actions.subscribe(() => phases.push(actions.snapshot().phase));
  const pending = actions.setCharacter(DEFAULT_CHARACTER);
  return { actions, validated, reads, phases, pending, placements: () => placements,
    release() { actions.dispose(); validated.resolve(); for (const read of reads) read.reply.resolve(failed()); } };
}

test.each(["before", "after"] as const)("a speculative failure %s validation stays unpublished, recovers once and retains explicit retry semantics", async timing => {
  const f = transaction();
  try {
    if (timing === "after") f.validated.resolve();
    f.reads[0]!.reply.resolve(failed()); await turn();
    expect(f.phases).not.toContain("failed"); expect(f.actions.snapshot().phase).toBe("preparing");
    if (timing === "before") { expect(f.reads).toHaveLength(1); f.validated.resolve(); await turn(); }
    expect(f.reads).toHaveLength(2); expect(f.reads[1]!.signal).toBe(f.reads[0]!.signal);
    f.reads[1]!.reply.resolve(failed("Fresh failure")); await f.pending;
    expect(f.actions.snapshot()).toMatchObject({ phase: "failed", message: "Fresh failure" });
    await f.actions.setCharacter(DEFAULT_CHARACTER); expect(f.reads).toHaveLength(2);
    const explicit = f.actions.retry(); expect(f.reads).toHaveLength(3);
    f.reads[2]!.reply.resolve(failed("Explicit failure")); await explicit;
    expect(f.actions.snapshot().message).toBe("Explicit failure"); expect(f.reads).toHaveLength(3);
    expect(f.placements()).toBe(0);
  } finally { f.release(); }
});

test.each(["validation", "fresh request"] as const)("disposal cancels speculative recovery while waiting for %s", async waiting => {
  const f = transaction();
  try {
    f.reads[0]!.reply.resolve(failed()); await turn();
    if (waiting === "fresh request") { f.validated.resolve(); await turn(); }
    const count = f.reads.length;
    f.actions.dispose(); await f.pending;
    f.validated.resolve(); await turn();
    expect(f.reads).toHaveLength(count); expect(f.reads.every(read => read.signal.aborted)).toBe(true);
    expect(f.phases).not.toContain("failed"); expect(f.placements()).toBe(0);
  } finally { f.release(); }
});

test.each(["validation", "fresh request"] as const)("supersession cancels recovery waiting for %s without passing its allowance to the replacement", async waiting => {
  const f = transaction();
  try {
    f.reads[0]!.reply.resolve(failed()); await turn();
    if (waiting === "fresh request") { f.validated.resolve(); await turn(); }
    const count = f.reads.length;
    const next = f.actions.setCharacter({ ...DEFAULT_CHARACTER, bodyGender: "male" });
    expect(f.reads[0]!.signal.aborted).toBe(true);
    const replacement = f.reads[count]!;
    expect(replacement.signal).not.toBe(f.reads[0]!.signal);
    replacement.reply.resolve(failed("Replacement failure")); await next; await f.pending;
    expect(f.actions.snapshot().message).toBe("Replacement failure");
    f.validated.resolve(); await turn();
    expect(f.reads).toHaveLength(count + 1); expect(f.placements()).toBe(0);
  } finally { f.release(); }
});

test("successful speculative work places once without consuming another request, and later requests have no recovery allowance", async () => {
  const f = transaction();
  try {
    f.reads[0]!.reply.resolve(ready); await f.pending;
    expect(f.placements()).toBe(1); expect(f.reads).toHaveLength(1);
    const next = f.actions.setCharacter({ ...DEFAULT_CHARACTER, bodyGender: "male" });
    f.reads[1]!.reply.resolve(failed("Later failure")); await next;
    expect(f.actions.snapshot().message).toBe("Later failure"); expect(f.reads).toHaveLength(2);
  } finally { f.release(); }
});

test.each(["dispose", "supersede"] as const)("%s immediately after validation resolves prevents the recovery microtask from sending", async cancellation => {
  const f = transaction();
  try {
    f.reads[0]!.reply.resolve(failed()); await turn();
    f.validated.resolve();
    if (cancellation === "dispose") f.actions.dispose();
    else {
      const next = f.actions.setCharacter({ ...DEFAULT_CHARACTER, bodyGender: "male" });
      f.reads[1]!.reply.resolve(failed("Replacement failure")); await next;
    }
    await f.pending; await turn();
    expect(f.reads).toHaveLength(cancellation === "dispose" ? 1 : 2);
    expect(f.reads[0]!.signal.aborted).toBe(true); expect(f.placements()).toBe(0);
  } finally { f.release(); }
});

test("an old-setup poll failure recovers before publication under its original signal", async () => {
  const f = transaction();
  try {
    f.reads[0]!.reply.resolve({ key: "old", phase: "preparing", message: "", progress: null, record: null }); await turn();
    expect(f.reads[1]!.kind).toBe("poll");
    f.reads[1]!.reply.resolve(failed()); await turn();
    expect(f.phases).not.toContain("failed"); expect(f.reads).toHaveLength(2);
    f.validated.resolve(); await turn();
    expect(f.reads[2]!.kind).toBe("request"); expect(f.reads[2]!.signal).toBe(f.reads[0]!.signal);
    f.reads[2]!.reply.resolve(ready); await f.pending;
    expect(f.placements()).toBe(1); expect(f.actions.snapshot().phase).toBe("ready");
  } finally { f.release(); }
});

test("a speculative transport rejection recovers once without publishing the old failure", async () => {
  const f = transaction();
  try {
    f.reads[0]!.reply.reject(Error("old setup transport")); await turn();
    expect(f.phases).not.toContain("failed"); expect(f.reads).toHaveLength(1);
    f.validated.resolve(); await turn();
    f.reads[1]!.reply.resolve(ready); await f.pending;
    expect(f.placements()).toBe(1); expect(f.reads).toHaveLength(2);
  } finally { f.release(); }
});
