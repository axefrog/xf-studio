/**
 * The Save Explorer's browser device: the host's read-only saves endpoints (features/save-explorer/host/saves-server.ts, mounted by the
 * localhost server and the desktop app at the same paths) and a file picker for saves stored elsewhere. Browser mechanics only: responses
 * come back as they arrived (`unknown`), and the explorer's service validates them before using them. It names no feature; its shape is
 * the service's device port, structurally.
 *
 * A verification workspace reads `/api/verification/saves`, whose saves folder is its own settings' (UI-98). `locationChanged` tells the
 * service when the saves folder chosen in Settings › Saves changed, so its list follows at once.
 */
import type { LocalSetupActions } from "./local-setup-actions";

export type BrowserSaveExplorerDevice = {
  list(): Promise<unknown>;
  read(folder: string): Promise<Uint8Array>;
  pick(): Promise<{ name: string; bytes: Uint8Array } | undefined>;
  names(): Promise<unknown>;
  thumbnail(folder: string): string | null;
  locationChanged?(listener: () => void): () => void;
};

/** Calls `listener` when the saves folder saved in the settings changes (not when they first load). */
export function savesLocationSignal(settings: Pick<LocalSetupActions, "snapshot" | "subscribe">) {
  return (listener: () => void) => {
    let known = settings.snapshot().view?.fields;
    return settings.subscribe(() => {
      const fields = settings.snapshot().view?.fields;
      if (!fields) return;
      const changed = !!known && (known.savesDirectory ?? null) !== (fields.savesDirectory ?? null);
      known = fields;
      if (changed) listener();
    });
  };
}

export function createBrowserSaveExplorerDevice(doc: Document = document,
  options: { verification?: boolean; locationChanged?: (listener: () => void) => () => void } = {}): BrowserSaveExplorerDevice {
  const base = options.verification ? "/api/verification/saves" : "/api/saves";
  const get = async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw Error(`The host answered ${response.status}.`);
    return response;
  };
  return {
    list: async () => (await get(base)).json(),
    read: async folder => new Uint8Array(await (await get(`${base}/file?save=${encodeURIComponent(folder)}&part=data`)).arrayBuffer()),
    names: async () => (await get(`${base}/types`)).json(),
    thumbnail: folder => `${base}/file?save=${encodeURIComponent(folder)}&part=screenshot`,
    ...(options.locationChanged ? { locationChanged: options.locationChanged } : {}),
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
