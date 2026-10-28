import type { StudioFileKind, StudioFilePort, StudioPickedFile } from "../studio-file-operations";
import type { AnyOwner, Registry } from "../../platform/core/registry";

type MaskBakeOptions = { document: Document; workerUrl?: string };
export type BrowserMaskBake = { create(options: MaskBakeOptions): NonNullable<StudioFilePort["bakeMask"]> };
export function registeredMaskBake(registry: Registry<AnyOwner>, model: { readonly live?: string }): BrowserMaskBake | undefined {
  const feature = model.live;
  const owner = feature === undefined ? undefined : registry.owner(feature);
  return owner?.owner === "feature" ? (owner as typeof owner & { maskBake?: BrowserMaskBake }).maskBake : undefined;
}

/** Browser mechanics for the file workflow. The shell supplies its own picker elements. */
export function createBrowserFileDevice(options: {
  document: Document;
  pickers: Record<StudioFileKind, HTMLInputElement>;
  workerUrl?: string;
  maskBake?: BrowserMaskBake;
}): StudioFilePort {
  const pick = (kind: StudioFileKind, signal?: AbortSignal): Promise<StudioPickedFile | undefined> => new Promise(resolve => {
    if (signal?.aborted) { resolve(undefined); return; }
    const picker = options.pickers[kind];
    const complete = (aborted = false) => {
      signal?.removeEventListener("abort", abort);
      picker.removeEventListener("change", selected);
      picker.removeEventListener("cancel", cancelled);
      const file = aborted ? undefined : picker.files?.[0]; picker.value = "";
      resolve(file ? { name: file.name, size: file.size, text: () => file.text(),
        bytes: async () => new Uint8Array(await file.arrayBuffer()) } : undefined);
    };
    const selected = () => complete(), cancelled = () => complete();
    const abort = () => complete(true);
    picker.value = "";
    picker.addEventListener("change", selected, { once: true });
    picker.addEventListener("cancel", cancelled, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    try { picker.click(); } catch (error) {
      picker.removeEventListener("change", selected);
      picker.removeEventListener("cancel", cancelled);
      signal?.removeEventListener("abort", abort);
      throw error;
    }
  });
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob), anchor = options.document.createElement("a");
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { pick, download, ...(options.maskBake ? { bakeMask: options.maskBake.create(options) } : {}) };
}
