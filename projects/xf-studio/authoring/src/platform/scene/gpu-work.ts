/** A map step names its destination so only its own texture calls are exempt from non-map GPU-work tracking. */
const mapUploads = new WeakMap<object, object>();

export function withMapUpload<T>(renderer: object, texture: object, send: () => T): T {
  const previous = mapUploads.get(renderer);
  mapUploads.set(renderer, texture);
  try { return send(); }
  finally { if (previous) mapUploads.set(renderer, previous); else mapUploads.delete(renderer); }
}

/**
 * Observe the renderer's submission boundary, including internal Three passes (PMREM, shadows, bakes) and morph texture uploads. A
 * notification dirties upload admission; it does not insert a fence. Admission checkpoints intervening work when no barrier is pending;
 * an existing barrier may complete and admit one burst before the next turn covers work submitted during its wait.
 * Only admitted map init/copy calls are exempt; a draw or another texture's upload inside an onUpdate still invalidates admission.
 *
 * One shared upload-budget owner installs this observer while any uploader wants the renderer. Restoring the original methods on release
 * leaves no observers/fences on an otherwise idle renderer. Wrapping preserves the receiver, arguments, return value and thrown errors.
 */
export function observeGpuWork(renderer: object, submitted: () => void): () => void {
  const names = ["render", "compile", "compileAsync", "initTexture", "copyTextureToTexture", "copyFramebufferToTexture", "initRenderTarget", "setRenderTarget",
    "clear", "clearColor", "clearDepth", "clearStencil"] as const;
  type Method = typeof names[number];
  const methods = renderer as Partial<Record<Method, (...args: never[]) => unknown>>;
  const restore: (() => void)[] = [];
  for (const name of names) {
    const original = methods[name];
    if (typeof original !== "function") continue;
    const wrapped = new Proxy(original, {
      apply(target, receiver, args: unknown[]) {
        const map = mapUploads.get(renderer);
        const admitted = !!map && (name === "initTexture" && args[0] === map || name === "copyTextureToTexture" && args[1] === map);
        try { return Reflect.apply(target, receiver, args); }
        // Binding a target can allocate its attachments. Returning to the canvas only changes state, and must not pace map-only turns.
        finally { if (!admitted && !(name === "setRenderTarget" && args[0] === null)) submitted(); }
      },
    });
    methods[name] = wrapped;
    restore.push(() => { if (methods[name] === wrapped) methods[name] = original; });
  }
  return () => { for (const release of restore.splice(0).reverse()) release(); };
}
