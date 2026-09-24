/** Application-facing viewport lifecycle. Concrete UV and head editors own their own input/picking/render resources. */
export type ViewportPort = {
  resize(): void;
  cancelInput(): void;
  inputCapture(): boolean;
  dispose(): void;
};
export type ViewportKind = "uv" | "surface";

export class ViewportAdapter {
  private ports: Partial<Record<ViewportKind, ViewportPort>> = {};
  attach(kind: ViewportKind, port: ViewportPort) {
    if (this.ports[kind] === port) return;
    this.detach(kind);
    this.ports[kind] = port;
    port.resize();
  }
  detach(kind?: ViewportKind) {
    for (const key of kind ? [kind] : ["uv", "surface"] as const) {
      const port = this.ports[key];
      if (!port) continue;
      delete this.ports[key];
      port.cancelInput();
      port.dispose();
    }
  }
  resize(kind?: ViewportKind) {
    for (const key of kind ? [kind] : ["uv", "surface"] as const) this.ports[key]?.resize();
  }
  cancelInput(kind?: ViewportKind) {
    for (const key of kind ? [kind] : ["uv", "surface"] as const) this.ports[key]?.cancelInput();
  }
  capture(): Readonly<Record<ViewportKind, boolean>> {
    return { uv: this.ports.uv?.inputCapture() ?? false, surface: this.ports.surface?.inputCapture() ?? false };
  }
}
