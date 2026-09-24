const editKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Input event translation only; application transactions own history and cancellation. */
export function bindControlEdit(input: HTMLInputElement, hooks: {
  begin(): void; commit(): void; cancel(): void;
}) {
  input.addEventListener("pointerdown", () => { if (!input.disabled) hooks.begin(); });
  input.addEventListener("keydown", event => {
    if (editKeys.has(event.key)) hooks.begin();
    else if (event.key === "Escape") { hooks.cancel(); event.preventDefault(); }
  });
  input.addEventListener("change", hooks.commit);
  input.addEventListener("blur", hooks.commit);
  input.addEventListener("pointercancel", hooks.commit);
}
