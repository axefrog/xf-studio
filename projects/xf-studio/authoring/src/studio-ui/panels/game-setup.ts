import type { FolderField } from "../../local-setup-actions";
import type { LocalSetupFields } from "../../local-settings-server";
import { applyCapability, button, note, Segmented } from "../controls";
import { h, setAttr, setText, setValue, uid } from "../dom";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";

type Choice = { value: string; label: string };
const OTHER = "\u0000other";
const samePath = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b &&
  a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/**
 * Game & tools (UI-83, UI-03): the one setup form both hosts use (the desktop's Build setup opens it too). Every choice is saved
 * the moment it is made (`setup.update` merges only that field over the saved settings), so there is no second copy of the
 * settings to go stale and no Save button. Folders XF Studio found are offered as choices (`detect.gameInstalls`,
 * `detect.mo2Instances`, with each instance's profiles); "Another folder…" opens a text box, and the desktop app adds its native
 * folder picker (`setup.pickFolder`). One plain line says what is ready and, when something isn't, the one next step.
 */
export function gameSetupSection(rt: StudioRuntime) {
  const port = rt.port;
  const status = h("p", { class: "setup-status", role: "status", "aria-live": "polite" });
  const save = async (fields: Partial<LocalSetupFields>, announce = "Saved on this computer.") => {
    const outcome = await port.localSetup.dispatch({ kind: "setup.update", fields });
    if (outcome.ok) rt.feedback.announce(announce);
    else rt.feedback.toast("warning", "Game & tools", outcome.message, [], { code: outcome.code });
    rt.changed();
  };
  const route = new Segmented<LocalSetupFields["launchRoute"]>({ label: "How you install mods", options: [
    { value: "mo2", label: "Mod Organizer 2", title: "Mods are managed in Mod Organizer 2" },
    { value: "direct", label: "Vortex or by hand", title: "Mods go into the game's own folder" }],
  onSelect: value => void save({ launchRoute: value }, value === "mo2" ? "Mod Organizer 2 chosen" : "Game folder chosen") });

  /** A folder setting: what XF Studio found as choices, another folder typed or picked, saved at once. */
  function folderField(field: FolderField, label: string, help: string, found: (frame: Frame) => Choice[]) {
    const id = uid("setup");
    const select = h("select", { id, class: "field", "aria-describedby": `${id}-help` });
    const input = h("input", { class: "field", type: "text", spellcheck: "false", "aria-label": `${label}: type the folder`,
      placeholder: "Type the folder, e.g. C:\\Games\\Cyberpunk 2077" });
    const browse = button({ label: "Browse…", icon: "folder", small: true, onClick: () => void pick() });
    const typed = h("div", { class: "row gap-s setup-typed" }, input, browse);
    let other = false, signature = "";
    const element = h("div", { class: "control" }, h("label", { class: "control-label", for: id, text: label }),
      h("div", { class: "select-wrap" }, select, icon("chevronDown")), typed,
      h("small", { class: "control-help", id: `${id}-help`, text: help }));
    select.addEventListener("change", () => {
      if (select.value === OTHER) { other = true; rt.changed(); requestAnimationFrame(() => input.focus()); return; }
      other = false;
      void save({ [field]: select.value || null });
    });
    const commit = () => { const value = input.value.trim(); void save({ [field]: value || null }); };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commit(); } });
    async function pick() {
      const outcome = await port.localSetup.dispatch({ kind: "setup.pickFolder", field });
      if (outcome.ok) { other = false; rt.feedback.announce(`${label} saved`); }
      else if (outcome.code !== "cancelled") rt.feedback.toast("warning", "Game & tools", outcome.message, [], { code: outcome.code });
      rt.changed();
    }
    return {
      element,
      update(frame: Frame, value: string | null, disabled: boolean) {
        const choices = found(frame);
        const current = value && !choices.some(choice => samePath(choice.value, value)) ? [{ value, label: value }] : [];
        const all = [...current, ...choices];
        // Nothing found and nothing chosen: the text box and Browse… are the whole field.
        const listed = all.length > 0;
        const key = JSON.stringify(all);
        if (key !== signature) {
          signature = key;
          select.replaceChildren(...all.map(choice => h("option", { value: choice.value, text: choice.label })),
            h("option", { value: OTHER, text: "Another folder…" }), ...(value ? [] : [h("option", { value: "", text: "Not chosen yet" })]));
        }
        const selected = all.find(choice => samePath(choice.value, value))?.value ?? "";
        if (document.activeElement !== select) select.value = other ? OTHER : selected;
        select.closest<HTMLElement>(".select-wrap")!.hidden = !listed;
        typed.hidden = listed && !other;
        setValue(input, value ?? "");
        select.disabled = disabled; input.disabled = disabled;
        const canPick = frame.localSetup.canPickFolder;
        browse.hidden = !canPick;
        if (canPick) applyCapability(browse, disabled ? { available: false, reason: "Restore your previous settings first." }
          : port.localSetup.capability({ kind: "setup.pickFolder", field }));
      },
    };
  }

  const game = folderField("gameRoot", "Cyberpunk 2077 folder", "The folder the game is installed in. XF Studio reads your game here; it never changes it.",
    frame => (frame.installDetection?.games?.candidates ?? []).map(candidate => ({ value: candidate.root,
      label: `${candidate.root} (${[...new Set(candidate.evidence.map(item => ({ steam: "Steam", gog: "GOG", epic: "Epic", mo2: "Mod Organizer 2" })[item.source]))].join(", ")})` })));
  const mo2 = folderField("mo2Root", "Mod Organizer 2 instance", "The Mod Organizer 2 you play Cyberpunk 2077 with (the folder with ModOrganizer.ini).",
    frame => (frame.installDetection?.mo2?.instances ?? []).filter(instance => instance.managesCyberpunk || instance.kind === "configured")
      .map(instance => ({ value: instance.root, label: `${instance.name} (${instance.root})` })));
  const direct = folderField("manualModRoot", "Extra mod folder (optional)", "Only if you keep mods in a folder outside the game as well. Leave it empty otherwise.",
    () => []);

  // Profiles of the chosen instance, as choices; a text box where the instance isn't one XF Studio could read.
  const profileId = uid("setup");
  const profile = h("select", { id: profileId, class: "field" });
  const profileText = h("input", { class: "field", type: "text", spellcheck: "false", "aria-label": "Mod Organizer 2 profile: type its name" });
  const profileField = h("div", { class: "control" }, h("label", { class: "control-label", for: profileId, text: "Profile" }),
    h("div", { class: "select-wrap" }, profile, icon("chevronDown")), profileText,
    h("small", { class: "control-help", text: "The profile you play with. Your mods are added to its list, and the 3D preview reads the mods it uses." }));
  profile.addEventListener("change", () => void save({ mo2ProfileId: profile.value || null }));
  profileText.addEventListener("change", () => void save({ mo2ProfileId: profileText.value.trim() || null }));
  let profileKey = "";

  const wolvenKit = h("input", { class: "field", type: "text", spellcheck: "false", "aria-label": "Your own WolvenKit (optional)" });
  wolvenKit.addEventListener("change", () => void save({ wolvenKitCli: wolvenKit.value.trim() || null }));
  const wolvenKitField = h("label", { class: "control" }, h("span", { class: "control-label", text: "Your own WolvenKit (optional)" }), wolvenKit,
    h("small", { class: "control-help", text: "Leave this empty and XF Studio sets WolvenKit up for you (it asks before downloading)." }));
  const plateHead = h("select", { class: "field" });
  const plateHeadLabel = h("span", { class: "control-label" });
  plateHead.addEventListener("change", () => void save({ eyePlateHead: plateHead.value as LocalSetupFields["eyePlateHead"] }));

  const findAgain = button({ label: "Find my game and mod manager again", icon: "search", small: true, variant: "quiet", onClick: () => void detect(true) });
  const restore = button({ label: "Restore previous settings", icon: "reset", small: true, onClick: () => void (async () => {
    const outcome = await port.localSetup.dispatch({ kind: "setup.restorePrevious" });
    if (outcome.ok) rt.feedback.toast("success", "Game & tools", "Your previous settings are back.");
    else rt.feedback.toast("warning", "Game & tools", outcome.message, [], { code: outcome.code });
  })() });
  const element = h("details", { class: "section setup-section" }, h("summary", { text: "Game & tools" }),
    note("Saved on this computer as you choose. XF Studio finds your game and mod manager and sets up WolvenKit for you; change a choice only if it picked the wrong one."),
    status, h("div", { class: "row wrap gap-s" }, restore),
    route.element, game.element, h("div", { class: "setup-mo2" }, mo2.element, profileField), h("div", { class: "setup-direct" }, direct.element),
    wolvenKitField, h("label", { class: "control" }, plateHeadLabel, plateHead),
    h("div", { class: "row wrap gap-s" }, findAgain));
  // Finding is read only and quick: done once when the form is first shown, and again on request.
  let detected = false;
  async function detect(force = false) {
    if (detected && !force) return;
    detected = true;
    for (const kind of ["detect.gameInstalls", "detect.mo2Instances"] as const)
      if (port.installDetection.capability({ kind }).available) await port.installDetection.dispatch({ kind });
    rt.changed();
  }
  element.addEventListener("toggle", () => { if (element.open) void detect(); });
  const mo2Section = element.querySelector<HTMLElement>(".setup-mo2")!, directSection = element.querySelector<HTMLElement>(".setup-direct")!;

  return {
    element,
    /** Open the form, find folders if not yet done, and focus the first thing to choose. */
    show() {
      element.open = true;
      void detect();
      element.scrollIntoView?.({ block: "nearest" });
      const view = port.localSetup.snapshot().view;
      const first = !view?.fields.gameRoot ? game.element : view.fields.launchRoute === "mo2" && !view.fields.mo2Root ? mo2.element : game.element;
      requestAnimationFrame(() => first.querySelector<HTMLElement>("select:not([hidden]), input")?.focus());
    },
    update(frame: Frame) {
      const setup = frame.localSetup, view = setup.view, fields = view?.fields;
      const damaged = view?.source === "backup";
      restore.hidden = !damaged;
      applyCapability(restore, port.localSetup.capability({ kind: "setup.restorePrevious" }));
      const readiness = view?.readiness;
      const onMo2 = fields?.launchRoute === "mo2";
      // One plain line: damaged settings, what is missing (the first thing to do), or ready.
      const firstIssue = readiness && [...readiness.build.issues, ...readiness.sourceDiscovery.issues][0];
      setText(status, setup.error ?? (!view ? "Loading your settings…" : damaged
        ? "Your settings file is damaged. Restore the previous copy to keep using it."
        : firstIssue ? `To build your mod files: ${firstIssue.reason}` : `Ready: XF Studio can build your mods and add them to ${onMo2 ? "Mod Organizer 2" : "your game folder"}.`));
      status.className = `setup-status${damaged || firstIssue || setup.error ? " warning" : " ready"}`;
      route.update(fields?.launchRoute, () => view && !damaged ? { available: true } : { available: false, reason: damaged ? "Restore your previous settings first." : "Loading your settings…" });
      const locked = !view || damaged;
      game.update(frame, fields?.gameRoot ?? null, locked);
      mo2.update(frame, fields?.mo2Root ?? null, locked);
      direct.update(frame, fields?.manualModRoot ?? null, locked);
      mo2Section.hidden = !onMo2; directSection.hidden = onMo2;
      const instance = frame.installDetection?.mo2?.instances.find(item => samePath(item.root, fields?.mo2Root));
      const profiles = instance?.profiles ?? [];
      const current = fields?.mo2ProfileId ?? null;
      const choices = [...(current && !profiles.includes(current) ? [current] : []), ...profiles];
      const key = JSON.stringify([choices, !current]);
      if (key !== profileKey) {
        profileKey = key;
        profile.replaceChildren(...(current ? [] : [h("option", { value: "", text: "Choose a profile" })]),
          ...choices.map(name => h("option", { value: name, text: name === instance?.selectedProfile ? `${name} (last used)` : name })));
      }
      if (document.activeElement !== profile) profile.value = current ?? "";
      profile.closest<HTMLElement>(".select-wrap")!.hidden = !profiles.length;
      profileText.hidden = profiles.length > 0;
      setValue(profileText, current ?? "");
      setValue(wolvenKit, fields?.wolvenKitCli ?? "");
      if (view) {
        const choice = view.eyePlateHead;
        setText(plateHeadLabel, choice.label);
        setAttr(plateHead, "aria-label", choice.label);
        if (plateHead.options.length !== choice.options.length)
          plateHead.replaceChildren(...choice.options.map(option => h("option", { value: option.value, text: option.label })));
        if (document.activeElement !== plateHead) plateHead.value = view.fields.eyePlateHead;
      }
      for (const control of [profile, profileText, wolvenKit, plateHead]) control.disabled = locked;
      applyCapability(findAgain, frame.installDetection?.busy ? { available: false, reason: "XF Studio is looking now." }
        : port.installDetection.capability({ kind: "detect.gameInstalls" }));
    },
  };
}
