import type { PreviewSetupAction, PreviewSetupButton } from "../preview-setup";
import type { ReadonlyDeep } from "../read-only";
import type { WolvenKitLink } from "../wolvenkit-setup";
import { applyCapability, button } from "./controls";
import { h, setText, uid } from "./dom";
import type { Frame, StudioRuntime } from "./runtime";

type Button = ReadonlyDeep<PreviewSetupButton> | null;

/**
 * The 3D preview setup card and the WolvenKit download consent. Both paint only the port's
 * `previewSetup` snapshot and dispatch its typed actions; the setup service decides what is shown,
 * when the card is open and what the next step is. "Not now" hides the card; the head pane then
 * offers the next step, which opens it again.
 */
export function previewSetupCard(rt: StudioRuntime) {
  const port = rt.port;
  // Stable IDs: the desktop review tools read the card by them.
  const titleId = "preview-card-title";
  const title = h("h2", { class: "setup-card-title", id: titleId, tabindex: "-1" });
  const body = h("p", { class: "setup-card-body", id: "preview-card-body" });
  const fill = h("span", { class: "progress-fill" });
  const bar = h("div", { class: "progress", id: "preview-card-progress", role: "progressbar", "aria-labelledby": titleId,
    "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  const step = h("p", { class: "setup-card-step", id: "preview-card-step", role: "status", "aria-live": "polite" });
  const notice = h("p", { class: "setup-card-notice", role: "alert" });
  const links = h("div", { class: "setup-card-links" });
  let primaryAction: PreviewSetupAction | undefined, secondaryAction: PreviewSetupAction | undefined;
  const later = button({ label: "Not now", variant: "quiet", onClick: () => {
    void run({ kind: "previewSetup.dismiss" }).then(() => requestAnimationFrame(focusHeadStep));
  } });
  const secondary = button({ label: "", onClick: () => { if (secondaryAction) void run(secondaryAction); } });
  const primary = button({ label: "", variant: "primary", onClick: () => { if (primaryAction) void run(primaryAction); } });
  primary.id = "preview-card-primary"; secondary.id = "preview-card-secondary";
  const element = h("section", { class: "setup-card", id: "preview-card", "aria-labelledby": titleId, hidden: true },
    title, body, bar, step, notice, links, h("div", { class: "setup-card-actions" }, later, secondary, primary));

  // The consent dialog: what will be downloaded, why, from where and under which licence.
  const consentTitleId = uid("consent-title");
  const consentTitle = h("h2", { id: consentTitleId, tabindex: "-1" });
  const intro = h("p", { class: "consent-intro" }), facts = h("dl", { class: "consent-facts" });
  const runtime = h("p", { class: "consent-runtime" }), consentLinks = h("div", { class: "setup-card-links" });
  let confirmAction: PreviewSetupAction | undefined;
  const own = button({ label: "I already have WolvenKit", variant: "quiet", onClick: () => void run({ kind: "previewSetup.openSetup" }) });
  const notNow = button({ label: "Not now", onClick: () => void run({ kind: "previewSetup.consentClose" }) });
  const confirm = button({ label: "Download", variant: "primary", onClick: () => { if (confirmAction) void run(confirmAction); } });
  confirm.id = "wolvenkit-consent-confirm";
  const consent = h("dialog", { class: "sheet consent-sheet", id: "wolvenkit-consent", "aria-labelledby": consentTitleId },
    consentTitle, intro, facts, runtime, consentLinks, h("div", { class: "setup-card-actions" }, own, notNow, confirm));
  // Escape is the same as "Not now": the port closes the consent and the next paint closes the dialog.
  consent.addEventListener("cancel", event => { event.preventDefault(); void run({ kind: "previewSetup.consentClose" }); });
  consent.addEventListener("close", () => { if (port.previewSetup.snapshot().consent) void run({ kind: "previewSetup.consentClose" }); });

  async function run(action: PreviewSetupAction) {
    const outcome = await port.previewSetup.dispatch(action);
    // The card shows a failed step itself; a closed card needs a toast.
    if (!outcome.ok && !port.previewSetup.snapshot().card.open) rt.feedback.toast("warning", "3D preview", outcome.message);
    rt.changed();
  }
  function focusHeadStep() {
    const next = document.querySelector<HTMLElement>(".viewport-state:not([hidden]) .btn:not([hidden])");
    next?.focus();
  }
  function paintButton(control: HTMLButtonElement, value: Button) {
    control.hidden = !value;
    control.dataset.action = value?.action.kind ?? "";
    if (!value) return undefined;
    setText(control.querySelector("span")!, value.label);
    applyCapability(control, port.previewSetup.capability(value.action as PreviewSetupAction));
    return value.action as PreviewSetupAction;
  }
  let linkKey = "", consentLinkKey = "", wasOpen: boolean | undefined;
  function paintLinks(root: HTMLElement, items: ReadonlyDeep<{ label: string; link: WolvenKitLink }[]>, key: string) {
    const next = JSON.stringify(items);
    if (next === key) return key;
    root.replaceChildren(...items.map(item => h("button", { class: "link-button", type: "button", text: item.label,
      onclick: () => void run({ kind: "previewSetup.openLink", link: item.link }) })));
    root.hidden = !items.length;
    return next;
  }

  return {
    element, consent,
    update(frame: Frame) {
      const setup = frame.previewSetup, card = setup.card;
      element.hidden = !card.open;
      // Re-opening from the head pane moves focus into the card; the first automatic showing doesn't.
      if (card.open && wasOpen === false) requestAnimationFrame(() => title.focus());
      wasOpen = card.open;
      if (card.open) {
        setText(title, card.title);
        setText(body, card.body);
        bar.hidden = card.progress === null;
        if (card.progress !== null) { fill.style.width = `${Math.round(card.progress * 100)}%`; bar.setAttribute("aria-valuenow", String(Math.round(card.progress * 100))); }
        setText(step, card.step ?? "");
        step.hidden = !card.step;
        setText(notice, card.notice ?? "");
        notice.hidden = !card.notice;
        linkKey = paintLinks(links, card.links, linkKey);
        later.hidden = !card.canDismiss;
        primaryAction = paintButton(primary, card.primary);
        secondaryAction = paintButton(secondary, card.secondary);
      }
      const offer = setup.consent;
      if (offer) {
        setText(consentTitle, offer.title);
        setText(intro, offer.intro);
        const factKey = JSON.stringify(offer.facts);
        if (facts.dataset.key !== factKey) {
          facts.dataset.key = factKey;
          facts.replaceChildren(...offer.facts.flatMap(fact => [h("dt", { text: fact.label }), h("dd", { text: fact.value })]));
        }
        setText(runtime, offer.runtimeNote ?? "");
        runtime.hidden = !offer.runtimeNote;
        consentLinkKey = paintLinks(consentLinks, offer.links, consentLinkKey);
        confirmAction = paintButton(confirm, offer.confirm);
        if (!consent.open) {
          consent.showModal();
          // Start at the heading, so the person reads what is offered before choosing; Download is never the default.
          consentTitle.focus();
        }
      } else if (consent.open) consent.close();
    },
  };
}
