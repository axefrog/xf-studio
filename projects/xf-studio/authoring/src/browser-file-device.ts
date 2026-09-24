import type { Layer } from "./recipe";
import type { StudioFileKind, StudioFilePort, StudioPickedFile } from "./studio-file-operations";

/** Browser mechanics for the file workflow. The shell supplies its own picker elements. */
export function createBrowserFileDevice(options: {
  document: Document;
  pickers: Record<StudioFileKind, HTMLInputElement>;
  workerUrl?: string;
}): StudioFilePort {
  const pick = (kind: StudioFileKind): Promise<StudioPickedFile | undefined> => new Promise(resolve => {
    const picker = options.pickers[kind];
    const complete = () => {
      picker.removeEventListener("change", selected);
      picker.removeEventListener("cancel", cancelled);
      const file = picker.files?.[0]; picker.value = "";
      resolve(file ? { name: file.name, size: file.size, text: () => file.text(),
        bytes: async () => new Uint8Array(await file.arrayBuffer()) } : undefined);
    };
    const selected = () => complete(), cancelled = () => complete();
    picker.value = "";
    picker.addEventListener("change", selected, { once: true });
    picker.addEventListener("cancel", cancelled, { once: true });
    try { picker.click(); } catch (error) {
      picker.removeEventListener("change", selected);
      picker.removeEventListener("cancel", cancelled);
      throw error;
    }
  });
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob), anchor = options.document.createElement("a");
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const bakeMask = (layer: Layer): Promise<Blob> => new Promise((resolve, reject) => {
    const bake = new Worker(options.workerUrl ?? "/build/raster-worker.js", { type: "module" });
    bake.onmessage = e => {
      try {
        const canvas = options.document.createElement("canvas"); canvas.width = canvas.height = 2048;
        canvas.getContext("2d")!.putImageData(new ImageData(e.data.data, 2048, 2048), 0, 0);
        bake.terminate();
        canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("Mask export failed.")));
      } catch (error) { bake.terminate(); reject(error); }
    };
    bake.onerror = () => { bake.terminate(); reject(Error("Mask export failed.")); };
    bake.postMessage({ i: 0, version: 0, layer: { ...layer, enabled: true }, size: 2048 });
  });
  return { pick, download, bakeMask };
}
