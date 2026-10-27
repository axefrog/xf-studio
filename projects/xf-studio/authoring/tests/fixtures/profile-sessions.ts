/** A profile session opened as a window opens it (`studio-startup.ts`): the Studio's view graph over its views, recording through it. */
import { ProfileSessions } from "../../src/app/profiles/profile-sessions";
import type { ProfileSessionData } from "../../src/app/profiles/profile-session";
import type { PreviewState } from "../../src/app/workspace/makeup-workspace";
import { createHistoryService, type HistoryService } from "../../src/platform/core/history-service";
import { createStudioViewGraph, sessionViewGraph } from "../../src/preview/preview-view-graph";
import { freshWorkspace } from "./eye-region";

/** A deterministic source of randomness that doesn't repeat quickly (mulberry32). */
export function seededRandom(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function openSession(data: ProfileSessionData, options: { profile?: string; history?: HistoryService; preview?: PreviewState; random?: () => number } = {}) {
  const preview = options.preview ?? freshWorkspace().preview;
  return new ProfileSessions({ profile: options.profile ?? "p-1", data, history: options.history ?? createHistoryService(),
    graph: (views, owner) => createStudioViewGraph(preview, views, owner), stored: sessionViewGraph, random: options.random ?? seededRandom() });
}
