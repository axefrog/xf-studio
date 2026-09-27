import type { FolderField } from "../../local-setup-actions";
import type { LocalSetupFields } from "../../local-settings-server";
import { applyCapability, button, note, Segmented } from "../controls";
import { h, setAttr, setText, setValue, uid } from "../dom";
import { helpTip } from "../help-tip";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";

type Choice = { value: string; label: string };
const OTHER = "\u0000other";
const samePath = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b &&
  a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/** The one plain line about the game setup: damaged settings, the first thing to do before a Build, or ready. */
export function setupStatus(frame: Frame): { text: string; tone: "warning" | "ready" } {
  const setup = frame.localSetup, view = setup.view, readiness = view?.readiness;
  const damaged = view?.source === "backup";
  const firstIssue = readiness && [...readiness.build.issues, ...readiness.sourceDiscovery.issues][0];
  const onMo2 = view?.fields.launchRoute === "mo2";
  const text = setup.error ?? (!view ? "Loading your settings…" : damaged
    ? "Your settings file is damaged. Restore the previous copy to keep using it."
    : firstIssue ? `To build your mod files: ${firstIssue.reason}` : `Ready: XF Studio can build your mods and add them to ${onMo2 ? "Mod Organizer 2" : "your game folder"}.`);
  return { text, tone: damaged || firstIssue || setup.error ? "warning" : "ready" };
}

/**
 * The game, saves and tools settings (UI-83, UI-03, UI-109): the one setup form both hosts use, shown in the Settings panel's Game, Saves
 * and Tools groups (the desktop's Build setup and every "Open Settings" opens it). Every choice is saved the moment it is made
 * (`setup.update` merges only that field over the saved settings), so there is no second copy of the settings to go stale and no Save
 * button. Folders XF Studio found are offered as choices (`detect.gameInstalls`, `detect.mo2Instances`, with each instance's profiles);
 * "Another folder…" opens a text box, and the desktop app adds its native folder picker (`setup.pickFolder`). One plain line says what
 * is ready and, when something isn't, the one next step. The saves folder is detected; "Choose another folder…" and "Use the detected
 * folder" override it and go back.
 */
export function gameSetupForm(rt: StudioRuntime) {
  const port = rt.port;
  const status = h("p", { class: "setup-status", role: "status", "aria-live": "polite" });
  const save = async (fields: Partial<LocalSetupFields>, announce = "Saved on this computer.") => {
    const outcome = await port.localSetup.dispatch({ kind: "setup.update", fields });
    if (outcome.ok) rt.feedback.announce(announce);
    else rt.feedback.toast("warning", "Settings", outcome.message, [], { code: outcome.code });
    rt.changed();
    return outcome.ok;
  };
  const route = new Segmented<LocalSetupFields["launchRoute"]>({ label: "How you install mods", options: [
    { value: "mo2", label: "Mod Organizer 2", title: "Mods are managed in Mod Organizer 2" },
    { value: "direct", label: "Vortex or by hand", title: "Mods go into the game's own folder" }],
  onSelect: value => void save({ launchRoute: value }, value === "mo2" ? "Mod Organizer 2 chosen" : "Game folder chosen") });

  /** A folder setting: what XF Studio found as choices, another folder typed or picked, saved at once. */
  function folderField(field: FolderField, label: string, help: string, found: (frame: Frame) => Choice[]) {
    const id = uid("setup");
    const select = h("select", { id, class: "field" });
    const input = h("input", { class: "field", type: "text", spellcheck: "false", "aria-label": `${label}: type the folder`,
      placeholder: "Type the folder, e.g. C:\\Games\\Cyberpunk 2077" });
    const browse = button({ label: "Browse…", icon: "folder", small: true, onClick: () => void pick() });
    const typed = h("div", { class: "row gap-s setup-typed" }, input, browse);
    let other = false, signature = "";
    // What the folder is, in a help tip beside its label (help-tip.ts).
    const element = h("div", { class: "control" }, h("div", { class: "control-line" }, h("label", { class: "control-label", for: id, text: label }), helpTip(label, help)),
      h("div", { class: "select-wrap" }, select, icon("chevronDown")), typed);
    select.addEventListener("change", () => {
      if (select.value === OTHER) { other = true; rt.changed(); requestAnimationFrame(() => input.focus()); return; }
      other = false;
      void save({ [field]: select.value || null });
    });
    // A typed folder, once saved, is listed as the current choice, so the list shows it rather than "Another folder…".
    const commit = () => { const value = input.value.trim(); void save({ [field]: value || null }).then(ok => { if (ok && value) { other = false; rt.changed(); } }); };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commit(); } });
    async function pick() {
      const outcome = await port.localSetup.dispatch({ kind: "setup.pickFolder", field });
      if (outcome.ok) { other = false; rt.feedback.announce(`${label} saved`); }
      else if (outcome.code !== "cancelled") rt.feedback.toast("warning", "Settings", outcome.message, [], { code: outcome.code });
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
  const profileField = h("div", { class: "control" }, h("div", { class: "control-line" }, h("label", { class: "control-label", for: profileId, text: "Profile" }),
    helpTip("Profile", "The profile you play with. Your mods are added to its list, and the 3D preview reads the mods it uses.")),
    h("div", { class: "select-wrap" }, profile, icon("chevronDown")), profileText);
  profile.addEventListener("change", () => void save({ mo2ProfileId: profile.value || null }));
  profileText.addEventListener("change", () => void save({ mo2ProfileId: profileText.value.trim() || null }));
  let profileKey = "";

  const wolvenKit = h("input", { class: "field", type: "text", spellcheck: "false", "aria-label": "Your own WolvenKit (optional)" });
  wolvenKit.addEventListener("change", () => void save({ wolvenKitCli: wolvenKit.value.trim() || null }));
  const wolvenKitField = h("div", { class: "control" }, h("div", { class: "control-line" }, h("span", { class: "control-label", text: "Your own WolvenKit (optional)" }),
    helpTip("Your own WolvenKit", "Leave this empty and XF Studio sets WolvenKit up for you (it asks before downloading).")), wolvenKit);
  const plateHead = h("select", { class: "field" });
  const plateHeadLabel = h("span", { class: "control-label" });
  const plateHeadTip = helpTip("the head used for the eye plate", "Build cuts the eye plate from this head. Choose the unmodified head only if a head mod stops Build.");
  plateHead.addEventListener("change", () => void save({ eyePlateHead: plateHead.value as LocalSetupFields["eyePlateHead"] }));

  const findAgain = button({ label: "Find my game and mod manager again", icon: "search", small: true, variant: "quiet", onClick: () => void detect(true) });
  const restore = button({ label: "Restore previous settings", icon: "reset", small: true, onClick: () => void (async () => {
    const outcome = await port.localSetup.dispatch({ kind: "setup.restorePrevious" });
    if (outcome.ok) rt.feedback.toast("success", "Settings", "Your previous settings are back.");
    else rt.feedback.toast("warning", "Settings", outcome.message, [], { code: outcome.code });
  })() });
  const mo2Section = h("div", { class: "setup-mo2" }, mo2.element, profileField), directSection = h("div", { class: "setup-direct" }, direct.element);
  const gameElement = h("div", { class: "setup-section setup-game" },
    h("div", { class: "row wrap gap-s" }, restore), route.element, game.element, mo2Section, directSection,
    h("div", { class: "control" }, h("div", { class: "control-line" }, plateHeadLabel, plateHeadTip), plateHead), h("div", { class: "row wrap gap-s" }, findAgain));
  const toolsElement = h("div", { class: "setup-section setup-tools" }, wolvenKitField);
  const saves = savesFolderField(rt, save);
  // Finding is read only and quick: done once when the form is first shown, and again on request.
  let detected = false;
  async function detect(force = false) {
    if (detected && !force) return;
    detected = true;
    for (const kind of ["detect.gameInstalls", "detect.mo2Instances"] as const)
      if (port.installDetection.capability({ kind }).available) await port.installDetection.dispatch({ kind });
    rt.changed();
  }

  return {
    /** The one plain line (shown at the top of the Game group). */
    status,
    game: gameElement,
    saves: saves.element,
    tools: toolsElement,
    /** Find the game and mod manager, once (the first time Settings is shown). */
    detect: () => void detect(),
    /** Focus the first thing to choose in a group: the game folder or MO2 instance still missing, the saves folder, or WolvenKit. */
    focus(section: "game" | "saves" | "tools") {
      void detect();
      if (section === "saves") { saves.focus(); return; }
      if (section === "tools") { requestAnimationFrame(() => wolvenKit.focus()); return; }
      const view = port.localSetup.snapshot().view;
      const first = !view?.fields.gameRoot ? game.element : view.fields.launchRoute === "mo2" && !view.fields.mo2Root ? mo2.element : game.element;
      requestAnimationFrame(() => first.querySelector<HTMLElement>("select:not([hidden]), input")?.focus());
    },
    update(frame: Frame) {
      const setup = frame.localSetup, view = setup.view, fields = view?.fields;
      const damaged = view?.source === "backup";
      restore.hidden = !damaged;
      applyCapability(restore, port.localSetup.capability({ kind: "setup.restorePrevious" }));
      const onMo2 = fields?.launchRoute === "mo2";
      // One plain line: damaged settings, what is missing (the first thing to do), or ready.
      const line = setupStatus(frame);
      setText(status, line.text);
      status.className = `setup-status ${line.tone}`;
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
      saves.update(frame, locked);
    },
  };
}

/**
 * Settings › Saves (UI-109): where the Save Explorer reads saves. The detected Saved Games folder is the default and is only described
 * ("Detected: Saved Games › CD Projekt Red › Cyberpunk 2077" in words), never shown as a path with the person's profile in it. "Choose another
 * folder…" opens the desktop's folder picker, or a text box where there is none (localhost), whose refusals say what to do; "Use the
 * detected folder" goes back to the default.
 */
function savesFolderField(rt: StudioRuntime, save: (fields: Partial<LocalSetupFields>, announce?: string) => Promise<boolean>) {
  const port = rt.port;
  const current = h("p", { class: "setup-status saves-current", role: "status" });
  const input = h("input", { class: "field", type: "text", spellcheck: "false", "aria-label": "Your saves folder: type or paste it",
    placeholder: "e.g. D:\\Saves\\Cyberpunk 2077" });
  const guidance = note("Paste the folder that holds your save folders (ManualSave-0, AutoSave-1 and so on). In File Explorer, open that folder and copy its address bar.");
  const problem = h("p", { class: "note warning", role: "alert", hidden: true });
  const useTyped = button({ label: "Use this folder", icon: "check", small: true, onClick: () => void commit() });
  const typed = h("div", { class: "setup-typed-block", hidden: true }, h("div", { class: "row gap-s setup-typed" }, input, useTyped), guidance, problem);
  const choose = button({ label: "Choose another folder…", icon: "folder", small: true, onClick: () => void chooseAnother() });
  const useDetected = button({ label: "Use the detected folder", icon: "reset", small: true, variant: "quiet",
    onClick: () => void save({ savesDirectory: null }, "Saves are read from the detected folder.").then(ok => { if (ok) { typing = false; rt.changed(); } }) });
  const developer = note("", "info");
  const element = h("div", { class: "setup-section setup-saves" }, current, developer, h("div", { class: "row wrap gap-s" }, choose, useDetected), typed);
  let typing = false;
  const showProblem = (message: string | null) => { setText(problem, message ?? ""); problem.hidden = !message; setAttr(input, "aria-invalid", message ? "true" : undefined); };
  async function commit() {
    const value = input.value.trim();
    if (!value) { showProblem("Type or paste the folder your saves are in."); input.focus(); return; }
    const outcome = await port.localSetup.dispatch({ kind: "setup.update", fields: { savesDirectory: value } });
    // A refusal is said beside the field, in words that say what to do (the host checks the folder is there).
    if (!outcome.ok) { showProblem(outcome.message); input.focus(); rt.changed(); return; }
    showProblem(null); typing = false;
    rt.feedback.announce("Saves folder saved.");
    rt.changed();
  }
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void commit(); } });
  input.addEventListener("input", () => showProblem(null));
  async function chooseAnother() {
    if (port.localSetup.snapshot().canPickFolder) {
      const outcome = await port.localSetup.dispatch({ kind: "setup.pickFolder", field: "savesDirectory" });
      if (outcome.ok) { rt.feedback.announce("Saves folder saved."); typing = false; }
      // The picker couldn't open: the text box is the way instead.
      else if (outcome.code !== "cancelled") { typing = true; showProblem(outcome.message); }
      rt.changed();
      return;
    }
    // Shown at once, so focus lands in the box before the next paint.
    typing = true; typed.hidden = false; input.focus();
    rt.changed();
  }
  return {
    element,
    focus() { requestAnimationFrame(() => (typed.hidden ? choose : input).focus()); },
    update(frame: Frame, locked: boolean) {
      const view = frame.localSetup.view, saves = view?.saves, chosen = view?.fields.savesDirectory ?? null;
      const detected = saves?.detected;
      setText(current, !view ? "Loading your settings…" : chosen
        ? `Your folder: ${chosen}${saves?.chosenFound === false ? " (not found: choose it again, or use the detected folder)" : ""}`
        : detected ? `Detected: ${detected.display}${detected.found ? "" : " (not on this computer yet: save in the game, or choose where your saves are)"}`
          : "XF Studio can't detect a saves folder on this computer. Choose the folder your saves are in.");
      current.className = `setup-status saves-current ${(chosen ? saves?.chosenFound === false : !detected?.found) ? "warning" : "ready"}`;
      setText(developer, saves?.source === "developer" ? "XFS_SAVES_DIR is set, so this server reads that folder instead." : "");
      developer.hidden = saves?.source !== "developer";
      useDetected.hidden = !chosen;
      typed.hidden = !typing;
      if (document.activeElement !== input && !input.value) setValue(input, chosen ?? "");
      const reason = !view ? { available: false, reason: "Your settings are still loading." }
        : locked ? { available: false, reason: "Restore your previous settings first." } : { available: true };
      applyCapability(choose, reason); applyCapability(useDetected, reason); applyCapability(useTyped, reason);
      input.disabled = locked;
    },
  };
}
