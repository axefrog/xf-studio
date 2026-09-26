import type { Frame } from "./runtime";

/**
 * The makeup preview's readiness in one wording (UI-92): the status bar, the head's corner badge and Preview quality all say it the
 * same way. The subject is the 3D preview once the head is shown, else the UV map; the size is the preview texture's.
 */
export function readinessText(frame: Pick<Frame, "readiness" | "viewport">): { phase: string; label: string; detail: string } {
  const r = frame.readiness, size = r.size >= 1024 ? `${r.size / 1024}K` : String(r.size);
  const head = frame.viewport.head.phase === "ready", subject = head ? "Preview" : "UV map";
  if (r.phase === "ready") return { phase: r.phase, label: `${subject} ${size} · ready`,
    detail: head ? "Every shown layer has its latest texture in the 3D preview." : "The UV map is up to date. The 3D preview isn't shown yet." };
  if (r.phase === "updating") return { phase: r.phase, label: `${subject} ${size} · updating`,
    detail: `${r.pending ? `${r.pending} texture${r.pending === 1 ? "" : "s"} still to make. ` : ""}Until then, layers show their last finished texture.` };
  return { phase: r.phase, label: `${subject} couldn't update`, detail: r.error ?? "The makeup textures couldn't be made. Try Rebuild preview in Preview quality." };
}
