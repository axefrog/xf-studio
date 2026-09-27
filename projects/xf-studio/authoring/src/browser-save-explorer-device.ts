/**
 * The Save Explorer's browser device: the host's read-only saves endpoints (features/save-explorer/host/saves-server.ts, mounted by the
 * localhost server and the desktop app at the same paths) and a file picker for saves stored elsewhere. Browser mechanics only: responses
 * come back as they arrived (`unknown`), and the explorer's service validates them before using them. It names no feature; its shape is
 * the service's device port, structurally.
 */
export type BrowserSaveExplorerDevice = {
  list(): Promise<unknown>;
  read(folder: string): Promise<Uint8Array>;
  pick(): Promise<{ name: string; bytes: Uint8Array } | undefined>;
  names(): Promise<unknown>;
  thumbnail(folder: string): string | null;
};

export function createBrowserSaveExplorerDevice(doc: Document = document): BrowserSaveExplorerDevice {
  const get = async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw Error(`The host answered ${response.status}.`);
    return response;
  };
  return {
    list: async () => (await get("/api/saves")).json(),
    read: async folder => new Uint8Array(await (await get(`/api/saves/file?save=${encodeURIComponent(folder)}&part=data`)).arrayBuffer()),
    names: async () => (await get("/api/saves/types")).json(),
    thumbnail: folder => `/api/saves/file?save=${encodeURIComponent(folder)}&part=screenshot`,
    pick: () => new Promise((resolve, reject) => {
      const input = doc.createElement("input");
      input.type = "file"; input.accept = ".dat"; input.hidden = true;
      const done = async () => {
        input.remove();
        const file = input.files?.[0];
        if (!file) { resolve(undefined); return; }
        try { resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); } catch (error) { reject(error); }
      };
      input.addEventListener("change", () => { void done(); }, { once: true });
      input.addEventListener("cancel", () => { input.remove(); resolve(undefined); }, { once: true });
      doc.body.append(input);
      input.click();
    }),
  };
}
