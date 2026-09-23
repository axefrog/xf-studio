import { PREVIEW_TEXTURE_SIZES, type PreviewTextureSize } from "./preview-quality";

/** Presentation adapter; quality changes do not edit portable recipes or Undo. */
export function setupPreviewQuality(elements: { choices: HTMLElement; note: HTMLElement; retry: HTMLButtonElement },
  hooks: { current(): PreviewTextureSize; describe(): string; set(size: PreviewTextureSize): void; rebuild(): void }) {
  const buttons = PREVIEW_TEXTURE_SIZES.map(size => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = size === 512 ? "512" : `${size / 1024}K`;
    button.setAttribute("aria-label", `Preview textures ${button.textContent}`);
    button.onclick = () => hooks.set(size);
    elements.choices.append(button);
    return { button, size };
  });
  elements.retry.onclick = hooks.rebuild;
  return () => {
    for (const { button, size } of buttons) button.setAttribute("aria-pressed", String(size === hooks.current()));
    elements.note.textContent = hooks.describe();
  };
}
