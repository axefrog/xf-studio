/**
 * The browser's facial device (research/animation/expression-editor-design.md §5.2): the host's face data, installed expressions and
 * warm solver over same-origin HTTP. It decodes the solver's base64 float buffers; everything else is the preview service's.
 */
import { FACIAL_ENDPOINT, FACIAL_EXPRESSIONS_ENDPOINT, FACIAL_SOLVE_ENDPOINT, type FacialHostState, type FacialSolveAnswer,
  type FacialSolveRequest, type FacialStartPoints } from "./platform/api/facial";
import type { FacialDevicePort, FacialSolved } from "./facial-preview";

const floats = (text: string) => {
  const bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0));
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

/** This page's id for its solves (the host lets pages take turns instead of replacing each other's, CORE-104). */
const pageId = () => globalThis.crypto?.randomUUID?.() ?? `page-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export function createBrowserFacialDevice(fetcher: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)): FacialDevicePort {
  const client = pageId();
  const get = async <T>(url: string): Promise<T> => {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) throw Error(`The face data answered ${response.status}.`);
    return await response.json() as T;
  };
  return {
    state: () => get<FacialHostState>(FACIAL_ENDPOINT),
    expressions: options => get<FacialStartPoints>(options?.prefetch ? `${FACIAL_EXPRESSIONS_ENDPOINT}?prefetch=1` : FACIAL_EXPRESSIONS_ENDPOINT),
    async solve(request: FacialSolveRequest): Promise<FacialSolved> {
      const response = await fetcher(FACIAL_SOLVE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, client }) });
      const answer = await response.json() as FacialSolveAnswer;
      if (!answer.ok) return answer;
      return { ok: true, frames: answer.frames, ...(answer.rate ? { rate: answer.rate } : {}), pose: { q: floats(answer.q), t: floats(answer.t) },
        ms: answer.ms, skipped: answer.skipped };
    },
  };
}
