import type { PreviewSetupAction } from "../preview-setup";
import { applyCapability, button } from "./controls";
import { setText } from "./dom";
import type { Frame, StudioRuntime } from "./runtime";

/**
 * The one next step towards WolvenKit, offered where something waits for it while the 3D preview card isn't showing (the V's details,
 * the creator's labels; NATIVE-46, NATIVE-47). It paints the setup service's `wolvenKitStep` and dispatches its typed action: WolvenKit's
 * download consent, the copy found on this computer, .NET, or where WolvenKit is set. It never changes Game & tools, only opens it.
 */
export function wolvenKitStepButton(rt: StudioRuntime, options: { small?: boolean; className?: string } = {}) {
  let action: PreviewSetupAction | null = null;
  const element = button({ label: "Set up WolvenKit…", icon: "import", small: options.small ?? true, variant: "quiet", onClick: () => {
    if (!action) return;
    void rt.port.previewSetup.dispatch(action).then(outcome => {
      if (!outcome.ok) rt.feedback.toast("warning", "WolvenKit", outcome.message);
      rt.changed();
    });
  } });
  if (options.className) element.classList.add(options.className);
  element.hidden = true;
  return {
    element,
    /** Show the step while `wanted` and the service has one. */
    update(frame: Frame, wanted: boolean) {
      const step = wanted ? frame.previewSetup.wolvenKitStep : null;
      element.hidden = !step;
      action = step ? step.action as PreviewSetupAction : null;
      if (!step) return;
      setText(element.querySelector("span")!, step.label);
      element.dataset.action = step.action.kind;
      applyCapability(element, rt.port.previewSetup.capability(action!));
    },
  };
}
